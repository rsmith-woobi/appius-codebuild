import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { fileExists } from '../utils/io';

export async function generateSsrCloudformationTemplate(ROOT_DIR: string) {
  const UUID = process.env.UUID;
  if (!UUID) {
    throw new Error('UUID environment variable is not set');
  }

  const CFN_TEMPLATE_PATH = path.join(
    ROOT_DIR,
    'src/cloudformation/cfn-template.yaml',
  );
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
  if (!(await fileExists(OUT_CFN_DIR))) {
    await fs.mkdir(OUT_CFN_DIR);
  }
  const CFN_PATH = path.join(OUT_CFN_DIR, 'appius-deploy.yaml');
  if (await fileExists(CFN_PATH)) {
    await fs.rm(CFN_PATH);
  }
  await fs.writeFile(CFN_PATH, cfnOutput);
}
