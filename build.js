import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import esbuild from "esbuild";
import archiver from "archiver";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  S3Client,
} from '@aws-sdk/client-s3';
import { S3SyncClient } from 's3-sync-client';

export async function syncS3Buckets(
  source,
  dest,
  options,
) {
  const { sync } = new S3SyncClient({ client: new S3Client({}) });
  await sync(source, dest, { del: true, ...options });
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

const isVite = await fileExists(path.join(__dirname, "./repo/vite.config.ts"));

const buildPath = isVite ? "./repo/build/server" : "./repo/build";
const installCommand = "npm install";
const buildCommand = "npm run build";

console.log("Building the app...");
// Remove the build directory in case it exists
await fs.rm(buildPath, { recursive: true, force: true });
// Run the install command
// execSync(installCommand, { cwd: "./repo", stdio: "inherit" });
// Run the build command
execSync(buildCommand, { cwd: "./repo", stdio: "inherit" });

console.log("Building server lambda...");
await build_remix_lambda(buildPath);

await fs.mkdir(path.join(__dirname, "./out/s3"), { recursive: true });
if (isVite) {
  await fs.cp(
    path.join(__dirname, "./repo/build/client"),
    path.join(__dirname, "./out/s3"),
    { recursive: true }
  );
} else {
  await fs.cp(
    path.join(__dirname, "./repo/public"),
    path.join(__dirname, "./out/s3"),
    { recursive: true }
  );
}

console.log("Generating CloudFormation template...");
await generateCloudformationTemplate();

await syncS3Buckets('./out/', 's3://appius-deploy-bucket/appius-deploy-code-build/out');

// Generate the CloudFormation template
// It will create a Cloudfront Cache Behavior for each file and folder in the out/s3 directory
async function generateCloudformationTemplate() {
  const cfnTemplatePath = path.join(__dirname, "./cfn-template.yaml");
  const cfnTemplate = await fs.readFile(cfnTemplatePath, "utf8");

  const cacheBehavior = `          - PathPattern: {{PathPattern}}
            TargetOriginId: cloud-deploy-s3
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
  let cacheBehaviors = "";
  const s3FolderPath = path.join(__dirname, "./out/s3");
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
    const section = cacheBehavior.replace("{{PathPattern}}", pathPattern);
    cacheBehaviors += section;
  });
  const cfnOutput = cfnTemplate.replace("{{CacheBehaviors}}", cacheBehaviors);
  const cfnOutputDir = path.join(__dirname, "out/cfn");
  if (!await fileExists(cfnOutputDir)) {
    await fs.mkdir(cfnOutputDir);
  }
  const cfnOutputPath = path.join(cfnOutputDir, "./appius-deploy.yaml");
  if (await fileExists(cfnOutputPath)) {
    await fs.rm(cfnOutputPath);
  }
  await fs.writeFile(cfnOutputPath, cfnOutput);
}

async function build_remix_lambda(buildPath) {
  // Copy the polyfill.js file to the build directory
  const polyfillDest = path.join(buildPath, "polyfill.js");
  await fs.copyFile(path.resolve(__dirname, "./remix/polyfill.js"), polyfillDest);

  // Copy the handler.js file to the build directory
  const handlerDest = path.join(buildPath, "handler.js");
  await fs.copyFile(path.resolve(__dirname, "./remix/handler.js"), handlerDest);

  // Make sure the out directory exists
  const outPath = path.join(__dirname, "./out");
  await fs.rm(outPath, { recursive: true, force: true });
  await fs.mkdir(outPath, { recursive: true });

  const outFile = path.join(__dirname, "./out/index.js");
  // Create the lambda function build using esbuild
  await esbuild.build({
    entryPoints: [handlerDest],
    bundle: true,
    minify: true,
    outfile: outFile,
    inject: [polyfillDest],
    platform: "node",
  });

  await fs.rm(polyfillDest);
  await fs.rm(handlerDest);


  await fs.mkdir(path.join(outPath, "./lambda"), { recursive: true });
  const handle = await fs.open(path.join(__dirname, "./out/lambda/index.zip"), 'w')
  await zip();
  function zip() {
    const output = handle.createWriteStream();
  
    const promise = new Promise((resolve, reject) => { 
      try {
        const archive = archiver("zip");
        archive.pipe(output);
        archive.file(outFile, { name: "index.js" });
        archive.finalize();
        output.on("close", function () {
          console.log(archive.pointer() + " total bytes");
          console.log(
            "archiver has been finalized and the output file descriptor has closed."
          );
          fs.rm(outFile).then(() => {
            resolve();
          });
        });
      } catch (error) {
        reject(error);
      }   
    });
    return promise;
  }
}

