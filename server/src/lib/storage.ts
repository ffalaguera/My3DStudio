import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';

/** Almacén de archivos. El navegador sube y descarga directamente con URLs firmadas: Express no hace de proxy. */
export interface Storage {
  signedPut(key: string, contentType: string, maxBytes: number): Promise<{ url: string; headers: Record<string, string> }>;
  signedGet(key: string, downloadName?: string, ttlSeconds?: number): Promise<string>;
  read(key: string): Promise<Buffer>;
  write(key: string, body: Buffer, contentType: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
}

const KEY = /^[a-z0-9][a-z0-9/_.-]{0,300}$/i;
export function assertKey(key: string): void {
  if (!KEY.test(key) || key.includes('..')) throw new Error(`clave de almacenamiento no válida: ${key}`);
}

// ------------------------------------------------------------------ disco local (desarrollo)

export function signLocal(secret: string, method: 'GET' | 'PUT', key: string, exp: number, extra = ''): string {
  return createHmac('sha256', secret).update(`${method}\n${key}\n${exp}\n${extra}`).digest('base64url');
}

export function verifyLocal(secret: string, method: 'GET' | 'PUT', key: string, exp: number, sig: string, extra = ''): boolean {
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  const a = Buffer.from(signLocal(secret, method, key, exp, extra));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class LocalStorage implements Storage {
  private readonly root: string;
  constructor(private readonly cfg: Config) {
    this.root = resolve(cfg.LOCAL_STORAGE_DIR);
  }
  path(key: string): string {
    assertKey(key);
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('ruta fuera del almacén');
    return p;
  }
  private url(method: 'GET' | 'PUT', key: string, ttl: number, extra: Record<string, string> = {}): string {
    // GET: caducidad redondeada a la hora para que la misma URL se repita y el navegador la cachee
    const now = Math.floor(Date.now() / 1000);
    const exp = method === 'GET' ? Math.ceil((now + ttl) / 3600) * 3600 : now + ttl;
    const extraStr = Object.entries(extra).map(([k, v]) => `${k}=${v}`).join('&');
    const sig = signLocal(this.cfg.FILE_URL_SECRET!, method, key, exp, extraStr);
    const q = new URLSearchParams({ exp: String(exp), sig, ...extra });
    return `${this.cfg.PUBLIC_API_URL}/files/${key}?${q}`;
  }
  async signedPut(key: string, contentType: string, maxBytes: number) {
    return { url: this.url('PUT', key, 600, { ct: contentType, max: String(maxBytes) }), headers: { 'Content-Type': contentType } };
  }
  async signedGet(key: string, downloadName?: string, ttl = 3600) {
    return this.url('GET', key, ttl, downloadName ? { dl: downloadName } : {});
  }
  async read(key: string) {
    return readFile(this.path(key));
  }
  async write(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async removePrefix(prefix: string) {
    await rm(this.path(prefix.replace(/\/$/, '')), { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ Cloudflare R2 (producción)

export class R2Storage implements Storage {
  private readonly s3: S3Client;
  private readonly bucket: string;
  constructor(cfg: Config) {
    this.bucket = cfg.R2_BUCKET!;
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.R2_ACCESS_KEY_ID!, secretAccessKey: cfg.R2_SECRET_ACCESS_KEY! },
    });
  }
  async signedPut(key: string, contentType: string, maxBytes: number) {
    assertKey(key);
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: maxBytes }), { expiresIn: 600 });
    // ContentLength firmado = tamaño declarado: R2 rechaza una subida de otro tamaño.
    return { url, headers: { 'Content-Type': contentType } };
  }
  async signedGet(key: string, downloadName?: string, ttl = 3600) {
    assertKey(key);
    // firmar con la hora redondeada: la URL no cambia en esa hora y el navegador la cachea
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    return getSignedUrl(this.s3, new GetObjectCommand({
      Bucket: this.bucket, Key: key,
      ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName.replace(/"/g, '')}"` : undefined,
    }), { expiresIn: ttl + 3600, signingDate: hour });
  }
  async read(key: string) {
    const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await out.Body!.transformToByteArray());
  }
  async write(key: string, body: Buffer, contentType: string) {
    assertKey(key);
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async removePrefix(prefix: string) {
    for (;;) {
      const list = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: 1000 }));
      const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (!keys.length) return;
      await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys } }));
      if (!list.IsTruncated) return;
    }
  }
}

export function createStorage(cfg: Config): Storage {
  return cfg.STORAGE_DRIVER === 'r2' ? new R2Storage(cfg) : new LocalStorage(cfg);
}
