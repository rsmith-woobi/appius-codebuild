import {
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import * as fs from 'node:fs/promises';
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
