import { execSync } from 'child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeCleanDir } from '../utils/io';
import { zipDir } from '../utils/zip';
// import { fileExists } from '../utils/io';
// import { zipFile } from '../utils/zip';

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

export function generateNextJsCloudformationTemplate() {
  const UUID = process.env.UUID;
  if (!UUID) {
    throw new Error('UUID environment variable is not set');
  }

  return `
AWSTemplateFormatVersion: 2010-09-09
Mappings:
  CloudFrontCachePolicyIds:
    CachingDisabled:
      CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    CachingOptimized:
      CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6"
    CachingOptimizedForUncompressedObjects:
      CachePolicyId: "b2884449-e4de-46a7-ac36-70bc7f1ddd6d"
    Elemental-MediaPackage:
      CachePolicyId: "08627262-05a9-4f76-9ded-b50ca2e3a84f"
    Amplify:
      CachePolicyId: "2e54312d-136d-493c-8eb9-b001f22f67d2"
  CloudFrontOriginRequestPolicyIds:
    AllViewer:
      OriginRequestPolicyId: "216adef6-5c7f-47e4-b989-5492eafa07d3"
    AllViewerExceptHostHeader:
      OriginRequestPolicyId: "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    AllViewerAndCloudFrontHeaders-2022-06:
      OriginRequestPolicyId: "33f36d7e-f396-46d9-90e0-52428a34d9dc"
    CORS-CustomOrigin:
      OriginRequestPolicyId: "59781a5b-3903-41f3-afcb-af62929ccde1"
    CORS-S3Origin:
      OriginRequestPolicyId: "88a5eaf4-2fd4-4709-b370-b4c650ea3fcf"
    Elemental-MediaTailor-PersonalizedManifests:
      OriginRequestPolicyId: "775133bc-15f2-49f9-abea-afb2e0bf67d2"
    UserAgentRefererHeaders:
      OriginRequestPolicyId: "acba4595-bd28-49b8-b9fe-13317c0390fa"
Resources:
  S3Bucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: appius-project-${UUID}-bucket
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: false
        IgnorePublicAcls: false
        BlockPublicPolicy: false
        RestrictPublicBuckets: false
`;
}
