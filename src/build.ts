import path from 'node:path';
import url from 'node:url';
import { generateSsrCloudformationTemplate } from './cloudformation/cloudformation';
import {
  buildNextjs,
  generateNextJsCloudformationTemplate,
} from './nextjs/nextjs';
import { buildRemixClient, buildRemixLambda } from './remix/remix';
import {
  buildSveltekitClient,
  buildSveltekitLambda,
} from './sveltekit/sveltekit';
import { syncS3Buckets } from './utils/s3';

const SRC_DIR = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(SRC_DIR);
const OUT_DIR = path.join(ROOT_DIR, 'out');
const FRAMEWORK = process.env.FRAMEWORK || 'remix';

switch (FRAMEWORK) {
  case 'remix':
    await buildRemixLambda(ROOT_DIR);
    await buildRemixClient(ROOT_DIR);
    await generateSsrCloudformationTemplate(ROOT_DIR);
    break;
  case 'sveltekit':
    await buildSveltekitLambda(ROOT_DIR);
    await buildSveltekitClient(ROOT_DIR);
    await generateSsrCloudformationTemplate(ROOT_DIR);
    break;
  case 'nextjs':
    await buildNextjs(ROOT_DIR);
    await generateNextJsCloudformationTemplate(ROOT_DIR);
    break;
  default:
    throw new Error('Invalid FRAMEWORK: ' + FRAMEWORK);
}

await syncS3Buckets(
  OUT_DIR,
  `s3://appius-${process.env.UUID}-bucket/appius-deploy-code-build/out`,
  {},
);
