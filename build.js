import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import archiver from "archiver";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  S3Client,
} from '@aws-sdk/client-s3';
import path from 'node:path';
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

const isVite = fs.existsSync(path.join(__dirname, "./repo/vite.config.ts"));

const buildPath = isVite ? "./repo/build/server" : "./repo/build";
const installCommand = "npm install";
const buildCommand = "npm run build";

console.log("Building the app...");
// Remove the build directory in case it exists
fs.rmSync(buildPath, { recursive: true, force: true });
// Run the install command
// execSync(installCommand, { cwd: "./repo", stdio: "inherit" });
// Run the build command
execSync(buildCommand, { cwd: "./repo", stdio: "inherit" });

console.log("Building server lambda...");
build_remix_lambda(buildPath);

fs.mkdirSync(path.join(__dirname, "./out/s3"), { recursive: true });
if (isVite) {
  fs.cpSync(
    path.join(__dirname, "./repo/build/client"),
    path.join(__dirname, "./out/s3"),
    { recursive: true }
  );
} else {
  fs.cpSync(
    path.join(__dirname, "./repo/public"),
    path.join(__dirname, "./out/s3"),
    { recursive: true }
  );
}

console.log("Generating CloudFormation template...");
generateCloudformationTemplate();

await syncS3Buckets('./out', 's3://appius-deploy-bucket/appius-deploy-code-build', { del: true });

// Generate the CloudFormation template
// It will create a Cloudfront Cache Behavior for each file and folder in the out/s3 directory
function generateCloudformationTemplate() {
  const cfnTemplatePath = path.join(__dirname, "./cfn-template.yaml");
  const cfnTemplate = fs.readFileSync(cfnTemplatePath, "utf8");

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
  const files = fs.readdirSync(s3FolderPath);

  const pathPatterns = files.map((file) => {
    const filePath = path.join(s3FolderPath, file);
    if (fs.lstatSync(filePath).isDirectory()) {
      return `${file}/*`;
    } else {
      return file;
    }
  });

  pathPatterns.forEach((pathPattern) => {
    const section = cacheBehavior.replace("{{PathPattern}}", pathPattern);
    cacheBehaviors += section;
  });
  const cfnOutput = cfnTemplate.replace("{{CacheBehaviors}}", cacheBehaviors);
  const cfnOutputDir = path.join(__dirname, "out/cfn");
  if (!fs.existsSync(cfnOutputDir)) {
    fs.mkdirSync(cfnOutputDir);
  }
  const cfnOutputPath = path.join(cfnOutputDir, "./appius-deploy.yaml");
  if (fs.existsSync(cfnOutputPath)) {
    fs.rmSync(cfnOutputPath);
  }
  fs.writeFileSync(cfnOutputPath, cfnOutput);
}

function build_remix_lambda(buildPath) {
  // Copy the polyfill.js file to the build directory
  const polyfillDest = path.join(buildPath, "polyfill.js");
  fs.copyFileSync(path.resolve(__dirname, "./remix/polyfill.js"), polyfillDest);

  // Copy the handler.js file to the build directory
  const handlerDest = path.join(buildPath, "handler.js");
  fs.copyFileSync(path.resolve(__dirname, "./remix/handler.js"), handlerDest);

  // Make sure the out directory exists
  const outPath = path.join(__dirname, "./out");
  fs.rmSync(outPath, { recursive: true, force: true });
  fs.mkdirSync(outPath, { recursive: true });

  const outFile = path.join(__dirname, "./out/index.js");
  // Create the lambda function build using esbuild
  esbuild.buildSync({
    entryPoints: [handlerDest],
    bundle: true,
    minify: true,
    outfile: outFile,
    inject: [polyfillDest],
    platform: "node",
  });

  fs.rmSync(polyfillDest);
  fs.rmSync(handlerDest);

  fs.mkdirSync(path.join(outPath, "./lambda"), { recursive: true });
  const output = fs.createWriteStream(
    path.join(__dirname, "./out/lambda/index.zip")
  );
  const archive = archiver("zip");
  archive.pipe(output);
  archive.file(outFile, { name: "index.js" });
  archive.finalize();
  output.on("close", function () {
    console.log(archive.pointer() + " total bytes");
    console.log(
      "archiver has been finalized and the output file descriptor has closed."
    );
    fs.rmSync(outFile);
  });
}
