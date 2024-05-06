import { S3Client } from '@aws-sdk/client-s3';
import mime from 'mime-types';
import { S3SyncClient } from 's3-sync-client';

export async function syncS3Buckets(
  source: string,
  dest: string,
  options: any,
) {
  const { sync } = new S3SyncClient({ client: new S3Client({}) });
  await sync(source, dest, {
    del: true,
    commandInput: (input: any) => ({
      ContentType: mime.lookup(input.Key) || 'text/html',
    }),
    ...options,
  });
}
