import { execSync } from 'child_process';
import esbuild from 'esbuild';
import fs from 'fs/promises';
import path from 'node:path';
import { zipDir } from '../utils/zip';

export async function buildSveltekitLambda(ROOT_DIR: string) {
  const BUILD_COMMAND = process.env.BUILD_COMMAND || 'npm run build';
  const REPO_DIR = path.join(ROOT_DIR, 'repo');
  const SVELET_CONFIG_PATH = path.join(REPO_DIR, 'svelte.config.js');
  const OUT_DIR = path.join(ROOT_DIR, 'out');
  const LAMBDA_DIR = path.join(ROOT_DIR, 'lambda');

  // Modify svelte.config.js to use svelte-kit-sst adapter
  const svelteConfigContent = (
    await fs.readFile(SVELET_CONFIG_PATH)
  ).toString();
  const updatedSvelteConfigContent = svelteConfigContent.replace(
    /import adapter from .*/,
    "import adapter from 'svelte-kit-sst';",
  );
  await fs.writeFile(SVELET_CONFIG_PATH, updatedSvelteConfigContent);

  execSync('npm install --save-dev svelte-kit-sst', {
    cwd: REPO_DIR,
    stdio: 'inherit',
  });

  // Build the repo
  execSync(BUILD_COMMAND, { cwd: REPO_DIR, stdio: 'inherit' });

  // Generate the lambda function build
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(LAMBDA_DIR, { recursive: true });
  await esbuild.build({
    entryPoints: [
      path.join(
        REPO_DIR,
        '.svelte-kit/svelte-kit-sst/server/lambda-handler/index.js',
      ),
    ],
    bundle: true,
    minify: true,
    outdir: LAMBDA_DIR,
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
    path.join(REPO_DIR, '.svelte-kit/svelte-kit-sst/prerendered'),
    path.join(LAMBDA_DIR, 'prerendered'),
    {
      recursive: true,
    },
  );

  // Zip the lambda function build
  await zipDir(LAMBDA_DIR, path.join(OUT_DIR, 'lambda/index.zip'));

  // Clean up
  await fs.rm(LAMBDA_DIR, { recursive: true });
}

export async function buildSveltekitClient(ROOT_DIR: string) {
  await fs.mkdir(path.join(ROOT_DIR, 'out/s3'), { recursive: true });
  await fs.cp(
    path.join(ROOT_DIR, 'repo/.svelte-kit/svelte-kit-sst/client'),
    path.join(ROOT_DIR, 'out/s3'),
    { recursive: true },
  );
}
