import { execSync } from 'child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { makeCleanDir } from '../utils/io';
import { zipDir } from '../utils/zip';

export async function buildNextjs(ROOT_DIR: string) {
  const REPO_DIR = path.join(ROOT_DIR, 'repo');

  const OUT_DIR = path.join(ROOT_DIR, 'out');
  await makeCleanDir(OUT_DIR);
  const OUT_LAMBDA_DIR = path.join(OUT_DIR, 'lambda');
  await fs.mkdir(OUT_LAMBDA_DIR);
  const OUT_S3_DIR = path.join(OUT_DIR, 's3');
  await fs.mkdir(OUT_S3_DIR);
  const OUT_S3_ASSET_DIR = path.join(OUT_S3_DIR, 'assets');
  await fs.mkdir(OUT_S3_ASSET_DIR);

  const OPEN_NEXT_DIR = path.join(REPO_DIR, '.open-next');
  const OPEN_NEXT_SERVER_DIR = path.join(
    OPEN_NEXT_DIR,
    'server-functions/default',
  );
  const OPEN_NEXT_IMG_OPT_DIR = path.join(
    OPEN_NEXT_DIR,
    'image-optimization-function',
  );
  const OPEN_NEXT_ASSETS_DIR = path.join(OPEN_NEXT_DIR, 'assets');

  // Run Open-next build
  execSync('npx open-next build', {
    cwd: REPO_DIR,
    stdio: 'inherit',
  });

  // Zip the server lambda bundle as out/lambda/server-lambda.zip
  await zipDir(
    OPEN_NEXT_SERVER_DIR,
    path.join(OUT_LAMBDA_DIR, 'server-lambda.zip'),
  );

  // Zip the image optimization lambda bundle as out/lambda/img-opt-lambda.zip
  await zipDir(
    OPEN_NEXT_IMG_OPT_DIR,
    path.join(OUT_LAMBDA_DIR, 'img-opt-lambda.zip'),
  );

  await fs.cp(OPEN_NEXT_ASSETS_DIR, OUT_S3_ASSET_DIR, { recursive: true });
}

export async function generateNextJsCloudformationTemplate(ROOT_DIR: string) {
  const UUID = process.env.UUID;
  if (!UUID) {
    throw new Error('UUID environment variable is not set');
  }

  const CFN_TEMPLATE_PATH = path.join(ROOT_DIR, 'src/nextjs/cfn-template.yaml');
  const cfnTemplate = await fs.readFile(CFN_TEMPLATE_PATH, 'utf8');

  const cacheBehavior = `          - PathPattern: "{{PathPattern}}"
            TargetOriginId: appius-project-${process.env.UUID}-s3
            ViewerProtocolPolicy: redirect-to-https
            AllowedMethods:
              - GET
              - HEAD
              - OPTIONS
            SmoothStreaming: "false"
            Compress: "true"
            CachePolicyId:
              !FindInMap [
                CloudFrontCachePolicyIds,
                CachingOptimized,
                CachePolicyId,
              ]
`;
  let cacheBehaviors = '';
  const OUT_S3_DIR = path.join(ROOT_DIR, './out/s3');
  const files = await fs.readdir(OUT_S3_DIR);

  const pathPatternsPromises = files.map(async (file) => {
    const filePath = path.join(OUT_S3_DIR, file);
    const fileStat = await fs.lstat(filePath);
    if (fileStat.isDirectory()) {
      return `${file}/*`;
    } else {
      return file;
    }
  });

  const pathPatterns = await Promise.all(pathPatternsPromises);

  pathPatterns.forEach((pathPattern) => {
    const section = cacheBehavior.replace('{{PathPattern}}', pathPattern);
    cacheBehaviors += section;
  });
  let cfnOutput = cfnTemplate.replace('{{CacheBehaviors}}', cacheBehaviors);
  cfnOutput = cfnOutput.replace(/{{UUID}}/g, UUID);
  cfnOutput = cfnOutput.replace(/{{DEPLOYMENT_UUID}}/g, uuidv4());

  const OUT_CFN_DIR = path.join(ROOT_DIR, 'out/cfn');
  await makeCleanDir(OUT_CFN_DIR);
  const CFN_PATH = path.join(OUT_CFN_DIR, 'appius-deploy.yaml');
  await fs.writeFile(CFN_PATH, cfnOutput);
}
