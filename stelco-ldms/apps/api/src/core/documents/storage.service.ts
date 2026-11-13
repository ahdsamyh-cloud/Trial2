import { Injectable } from '@nestjs/common';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../../config';

export type Area = 'quarantine' | 'clean';

/**
 * Object storage behind the S3 API (MinIO / SeaweedFS / Garage / Ceph), or a local
 * directory for development. Objects use random keys; nothing is under the web root.
 */
@Injectable()
export class StorageService {
  private s3?: S3Client;

  private client() {
    const c = config();
    this.s3 ??= new S3Client({
      endpoint: c.S3_ENDPOINT, region: c.S3_REGION, forcePathStyle: c.S3_FORCE_PATH_STYLE,
      credentials: c.S3_ACCESS_KEY ? { accessKeyId: c.S3_ACCESS_KEY, secretAccessKey: c.S3_SECRET_KEY ?? '' } : undefined,
    });
    return this.s3;
  }

  private bucket(area: Area) {
    return area === 'quarantine' ? config().S3_QUARANTINE_BUCKET : config().S3_BUCKET;
  }

  private path(area: Area, key: string) {
    if (!/^[a-zA-Z0-9/_-]+$/.test(key)) throw new Error('invalid storage key');
    return join(resolve(config().STORAGE_FS_ROOT), area, key);
  }

  async put(area: Area, key: string, body: Buffer, contentType = 'application/octet-stream') {
    if (config().STORAGE_DRIVER === 'fs') {
      const p = this.path(area, key);
      await mkdir(dirname(p), { recursive: true, mode: 0o700 });
      await writeFile(p, body, { mode: 0o600 });
      return;
    }
    await this.client().send(new PutObjectCommand({ Bucket: this.bucket(area), Key: key, Body: body, ContentType: contentType, ServerSideEncryption: process.env.S3_SSE === 'true' ? 'AES256' : undefined }));
  }

  async get(area: Area, key: string): Promise<Buffer> {
    if (config().STORAGE_DRIVER === 'fs') return readFile(this.path(area, key));
    const out = await this.client().send(new GetObjectCommand({ Bucket: this.bucket(area), Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async promote(key: string) {
    if (config().STORAGE_DRIVER === 'fs') {
      const to = this.path('clean', key);
      await mkdir(dirname(to), { recursive: true, mode: 0o700 });
      await rename(this.path('quarantine', key), to);
      return;
    }
    await this.client().send(new CopyObjectCommand({ Bucket: this.bucket('clean'), Key: key, CopySource: `${this.bucket('quarantine')}/${key}` }));
    await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket('quarantine'), Key: key }));
  }

  async remove(area: Area, key: string) {
    if (config().STORAGE_DRIVER === 'fs') return rm(this.path(area, key), { force: true });
    await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket(area), Key: key }));
  }
}
