import { execSync } from 'child_process';
import esbuild from 'esbuild';
import fs from 'fs/promises';
import mime from 'mime-types';
import path from 'path';

import { S3Client } from '@aws-sdk/client-s3';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3SyncClient } from 's3-sync-client';
import { v4 as uuidv4 } from 'uuid';
import { zipDir } from './utils/zip.js';

async function syncS3Buckets(source, dest, options) {
  const { sync } = new S3SyncClient({ client: new S3Client({}) });
  await sync(source, dest, {
    del: true,
    commandInput: (input) => ({
      ContentType: mime.lookup(input.Key) || 'text/html',
    }),
    ...options,
  });
}

const __dirname = dirname(fileURLToPath(import.meta.url));

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

const buildCommand = 'npm run build';

const svelteConfigPath = path.join(__dirname, './repo/svelte.config.js');
const svelteConfigContent = (await fs.readFile(svelteConfigPath)).toString();
const updatedSvelteConfigContent = svelteConfigContent.replace(
  /import adapter from .*/,
  "import adapter from 'svelte-kit-sst';",
);
await fs.writeFile(svelteConfigPath, updatedSvelteConfigContent);

execSync('npm install --save-dev svelte-kit-sst', {
  cwd: './repo',
  stdio: 'inherit',
});

execSync(buildCommand, { cwd: './repo', stdio: 'inherit' });

const outPath = path.join(__dirname, './out');
await fs.mkdir(outPath, { recursive: true });
const lambdaPath = path.join(__dirname, './lambda');
await fs.mkdir(lambdaPath, { recursive: true });
await esbuild.build({
  entryPoints: [
    path.join(
      __dirname,
      './repo/.svelte-kit/svelte-kit-sst/server/lambda-handler/index.js',
    ),
  ],
  bundle: true,
  // minify: true,
  outdir: lambdaPath,
  platform: 'node',
  target: ['esnext'],
  format: 'esm',
  outExtension: {
    '.js': '.mjs',
  },
  banner: {
    js: [
      `import { createRequire as topLevelCreateRequire } from 'module';`,
      `const require = topLevelCreateRequire(import.meta.url);`,
    ].join(''),
  },
});
await fs.cp(
  path.join(__dirname, './repo/.svelte-kit/svelte-kit-sst/prerendered'),
  path.join(lambdaPath, 'prerendered'),
  {
    recursive: true,
  },
);

await zipDir(lambdaPath, path.join(outPath, 'lambda/index.zip'));
await fs.rm(lambdaPath, { recursive: true });

await fs.mkdir(path.join(__dirname, './out/s3'), { recursive: true });
await fs.cp(
  path.join(__dirname, './repo/.svelte-kit/svelte-kit-sst/client'),
  path.join(__dirname, './out/s3'),
  { recursive: true },
);

console.log('Generating CloudFormation template...');
await generateCloudformationTemplate();

await syncS3Buckets(
  './out/',
  `s3://appius-${process.env.UUID}-bucket/appius-deploy-code-build/out`,
);

// Generate the CloudFormation template
// It will create a Cloudfront Cache Behavior for each file and folder in the out/s3 directory
async function generateCloudformationTemplate() {
  const cfnTemplatePath = path.join(__dirname, './cfn-template.yaml');
  const cfnTemplate = await fs.readFile(cfnTemplatePath, 'utf8');

  const cacheBehavior = `          - PathPattern: {{PathPattern}}
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
  const s3FolderPath = path.join(__dirname, './out/s3');
  const files = await fs.readdir(s3FolderPath);

  const pathPatternsPromises = files.map(async (file) => {
    const filePath = path.join(s3FolderPath, file);
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
  cfnOutput = cfnOutput.replaceAll('{{UUID}}', process.env.UUID);
  cfnOutput = cfnOutput.replaceAll('{{DEPLOYMENT_UUID}}', uuidv4());
  const cfnOutputDir = path.join(__dirname, 'out/cfn');
  if (!(await fileExists(cfnOutputDir))) {
    await fs.mkdir(cfnOutputDir);
  }
  const cfnOutputPath = path.join(cfnOutputDir, './appius-deploy.yaml');
  if (await fileExists(cfnOutputPath)) {
    await fs.rm(cfnOutputPath);
  }
  await fs.writeFile(cfnOutputPath, cfnOutput);
}
