import { execSync } from 'child_process';
import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileExists } from '../utils/io';
import { zipFile } from '../utils/zip';

export async function buildRemixLambda(ROOT_DIR: string) {
  const REPO_DIR = path.join(ROOT_DIR, 'repo');
  const OUT_DIR = path.join(ROOT_DIR, 'out');
  const OUT_LAMBDA_DIR = path.join(OUT_DIR, './lambda');
  const BUILD_COMMAND = process.env.BUILD_COMMAND || 'npm run build';

  const IS_VITE = await fileExists(path.join(REPO_DIR, 'vite.config.ts'));

  const BUILD_PATH = IS_VITE
    ? path.join(REPO_DIR, 'build/server')
    : path.join(REPO_DIR, 'build');

  execSync(BUILD_COMMAND, { cwd: REPO_DIR, stdio: 'inherit' });

  // Copy the polyfill.js file to the build directory
  const POLYFILL_JS_PATH = path.join(BUILD_PATH, 'polyfill.js');
  await fs.copyFile(
    path.join(ROOT_DIR, 'src/remix/polyfill.js'),
    POLYFILL_JS_PATH,
  );

  // Copy the handler.js file to the build directory
  const HANDLER_JS_PATH = path.join(BUILD_PATH, 'handler.js');
  await fs.copyFile(
    path.join(ROOT_DIR, 'src/remix/handler.js'),
    HANDLER_JS_PATH,
  );

  // Make sure the out directory exists
  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const INDEX_JS_PATH = path.join(OUT_DIR, 'index.js');
  // Create the lambda function build using esbuild
  await esbuild.build({
    entryPoints: [HANDLER_JS_PATH],
    bundle: true,
    minify: true,
    outfile: INDEX_JS_PATH,
    inject: [POLYFILL_JS_PATH],
    platform: 'node',
  });

  await fs.rm(POLYFILL_JS_PATH);
  await fs.rm(HANDLER_JS_PATH);

  await fs.mkdir(OUT_LAMBDA_DIR, { recursive: true });
  await zipFile(INDEX_JS_PATH, path.join(OUT_LAMBDA_DIR, 'index.zip'));
}

export async function buildRemixClient(ROOT_DIR: string) {
  const OUT_S3_DIR = path.join(ROOT_DIR, 'out/s3');
  await fs.mkdir(OUT_S3_DIR, { recursive: true });

  const REPO_DIR = path.join(ROOT_DIR, 'repo');
  const IS_VITE = await fileExists(path.join(REPO_DIR, 'vite.config.ts'));
  const CLIENT_DIR = IS_VITE
    ? path.join(REPO_DIR, 'build/client')
    : path.join(REPO_DIR, 'public');

  await fs.cp(CLIENT_DIR, OUT_S3_DIR, { recursive: true });
}
