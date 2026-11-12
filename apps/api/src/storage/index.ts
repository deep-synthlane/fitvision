import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';

/**
 * Private object storage for user files (e.g. body-scan photos). Keys are relative paths
 * like `scans/<userId>/<scanId>/front.jpg`. Files are never served directly — only through
 * authenticated routes that check ownership.
 */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Removes every object under a prefix such as `scans/<userId>/` (account deletion). */
  deletePrefix(prefix: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.[a-z0-9]+$/i;

const PREFIX_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)*\/$/i;

function assertKey(key: string) {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
}

/** Prefixes must be a non-empty folder path ending in "/" — never the whole store, never "..". */
function assertPrefix(prefix: string) {
  if (!PREFIX_PATTERN.test(prefix)) throw new Error(`Invalid storage prefix: ${prefix}`);
}

export class LocalDiskStorage implements Storage {
  constructor(private readonly baseDir: string) {}

  private resolve(key: string) {
    assertKey(key);
    return path.join(this.baseDir, key);
  }

  async put(key: string, data: Buffer) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { mode: 0o600 });
  }

  async get(key: string) {
    try {
      return await readFile(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string) {
    assertPrefix(prefix);
    await rm(path.join(this.baseDir, prefix), { recursive: true, force: true });
  }
}

/** In-memory storage for tests. */
export class MemoryStorage implements Storage {
  readonly files = new Map<string, Buffer>();

  async put(key: string, data: Buffer) {
    assertKey(key);
    this.files.set(key, data);
  }

  async get(key: string) {
    return this.files.get(key) ?? null;
  }

  async delete(key: string) {
    this.files.delete(key);
  }

  async deletePrefix(prefix: string) {
    assertPrefix(prefix);
    for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) this.files.delete(k);
  }
}

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** For S3-compatible services (Cloudflare R2, MinIO, …). */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Key prefix inside the bucket, e.g. "production/". */
  keyPrefix?: string;
  forcePathStyle?: boolean;
}

/**
 * Private S3-compatible object storage. Objects are never public: the API streams them to their
 * owner after an authorisation check (authenticated proxy), so no bucket policy or signed URL is
 * exposed to browsers.
 */
export class S3Storage implements Storage {
  private clientPromise: Promise<S3Client> | null = null;
  constructor(private readonly opts: S3StorageOptions) {}

  private async sdk() {
    const mod = await import('@aws-sdk/client-s3');
    this.clientPromise ??= Promise.resolve(
      new mod.S3Client({
        region: this.opts.region,
        endpoint: this.opts.endpoint,
        forcePathStyle: this.opts.forcePathStyle,
        credentials: { accessKeyId: this.opts.accessKeyId, secretAccessKey: this.opts.secretAccessKey },
      }),
    );
    return { mod, client: await this.clientPromise };
  }

  private full(key: string) {
    return `${this.opts.keyPrefix ?? ''}${key}`;
  }

  async put(key: string, data: Buffer) {
    assertKey(key);
    const { mod, client } = await this.sdk();
    await client.send(new mod.PutObjectCommand({ Bucket: this.opts.bucket, Key: this.full(key), Body: data, ServerSideEncryption: 'AES256' }));
  }

  async get(key: string) {
    assertKey(key);
    const { mod, client } = await this.sdk();
    try {
      const res = await client.send(new mod.GetObjectCommand({ Bucket: this.opts.bucket, Key: this.full(key) }));
      return Buffer.from(await res.Body!.transformToByteArray());
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async delete(key: string) {
    assertKey(key);
    const { mod, client } = await this.sdk();
    await client.send(new mod.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.full(key) }));
  }

  async deletePrefix(prefix: string) {
    assertPrefix(prefix);
    const { mod, client } = await this.sdk();
    let token: string | undefined;
    do {
      const page = await client.send(new mod.ListObjectsV2Command({ Bucket: this.opts.bucket, Prefix: this.full(prefix), ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) await client.send(new mod.DeleteObjectsCommand({ Bucket: this.opts.bucket, Delete: { Objects: keys, Quiet: true } }));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
