import archiver from 'archiver';
import fs from 'fs/promises';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import path from 'path';

export function zipDir(dir: string, dest: string) {
  const promise = new Promise((resolve, reject) => {
    // Check if the directory exists
    // If not, reject with an error
    if (!existsSync(dir)) {
      reject(new Error('Directory does not exist'));
      return;
    }

    // Check if the destination directory exists
    // If not, create it
    const destDir = path.dirname(dest);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Create the zip file
    const zipFileStream = createWriteStream(dest);
    const archive = archiver('zip');
    archive.pipe(zipFileStream);
    archive.directory(dir, false);
    archive.finalize();
    zipFileStream.on('close', function () {
      console.log(`Zipped ${dir} to ${dest}`);
      resolve(null);
    });
    zipFileStream.on('error', function (err) {
      reject(err);
    });
  });
  return promise;
}

export async function zipFile(src: string, dest: string) {
  const handle = await fs.open(dest, 'w');
  await zip();
  function zip() {
    const output = handle.createWriteStream();

    const promise = new Promise((resolve, reject) => {
      try {
        const archive = archiver('zip');
        archive.pipe(output);
        archive.file(src, { name: 'index.js' });
        archive.finalize();
        output.on('close', function () {
          fs.rm(src).then(() => {
            resolve(null);
          });
        });
      } catch (error) {
        reject(error);
      }
    });
    return promise;
  }
}
