/**
 * Where the backend keeps encrypted blobs (architecture.md §3.2; RELAY step 29b2a): Cloudflare
 * R2 in production, `MemoryBlobStore` in development and tests. Every byte stored is ciphertext:
 * the pairing files the phone uploads (deleted after 24 h by R2's lifecycle rule) and anything
 * else a later step chooses to keep outside Postgres.
 *
 * Large bodies never pass through the backend: the phone PUTs the encrypted M3U file straight to
 * a presigned URL, and the TV GETs it from one. The R2 adapter (step 31 or 34) signs those with
 * R2's S3 API and gets a narrow, tested exception in the outbound-network lint (eslint.config.js
 * `NO_OUTBOUND_RULES`). The fake is in memory: it can't serve a deployment with more than one
 * instance, so production must never use it.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A presigned request: whoever holds `url` may make this one request until `expiresAt`. */
export interface PresignedRequest {
  readonly method: 'PUT' | 'GET';
  readonly url: string;
  /** Epoch ms. */
  readonly expiresAt: number;
}

export interface BlobStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The object's bytes, or null when there is none. */
  get(key: string): Promise<Uint8Array | null>;
  /** Removes the object; nothing happens when there is none. */
  delete(key: string): Promise<void>;
  /** A URL to PUT exactly `size` bytes to, for `ttlMs`. */
  presignPut(key: string, size: number, ttlMs: number): Promise<PresignedRequest>;
  /** A URL to GET the object from, for `ttlMs`. */
  presignGet(key: string, ttlMs: number): Promise<PresignedRequest>;
}

/**
 * Object keys are the server's own: a lower-case prefix, then one to three base64url segments
 * (`pair/<sid>/<file id>`). Nothing a client typed, no dots, no empty segment.
 */
const KEY = /^[a-z]{1,16}(?:\/[A-Za-z0-9_-]{1,64}){1,3}$/;

export function isBlobKey(key: string): boolean {
  return KEY.test(key);
}

function checkKey(key: string): void {
  if (!isBlobKey(key)) throw new RangeError('not a blob key');
}

function checkTtl(ttlMs: number): void {
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 86400000) throw new RangeError('a presigned URL lives 1 s to 24 h');
}

/** The answer a presigned request gets from the fake, as R2 would give it. */
export interface BlobResponse {
  readonly status: 200 | 400 | 403 | 404;
  readonly body?: Uint8Array;
}

export interface MemoryBlobStoreOptions {
  /** Where the presigned URLs point (a development route); the fake answers them itself (`redeem`). */
  readonly baseUrl?: string;
  readonly now?: () => number;
}

/**
 * The blob store in memory, for development and tests. Its presigned URLs carry an HMAC of the
 * method, key, size and expiry under a secret it makes at start, and `redeem` checks them the
 * way R2 checks its own: a changed, expired or reused-for-another-method URL gets a 403, a PUT
 * of another length a 400.
 */
export class MemoryBlobStore implements BlobStore {
  private readonly objects = new Map<string, Uint8Array>();
  private readonly secret = randomBytes(32);
  private readonly baseUrl: string;
  private readonly now: () => number;

  constructor(options: MemoryBlobStoreOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://127.0.0.1:3100/dev/blob';
    this.now = options.now ?? Date.now;
  }

  put(key: string, bytes: Uint8Array): Promise<void> {
    checkKey(key);
    this.objects.set(key, Uint8Array.from(bytes));
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array | null> {
    checkKey(key);
    const bytes = this.objects.get(key);
    return Promise.resolve(bytes === undefined ? null : Uint8Array.from(bytes));
  }

  delete(key: string): Promise<void> {
    checkKey(key);
    this.objects.delete(key);
    return Promise.resolve();
  }

  /** How many objects it holds (tests). */
  get size(): number {
    return this.objects.size;
  }

  presignPut(key: string, size: number, ttlMs: number): Promise<PresignedRequest> {
    checkKey(key);
    if (!Number.isSafeInteger(size) || size < 0) throw new RangeError('a size is a whole number of bytes');
    checkTtl(ttlMs);
    return Promise.resolve(this.presign('PUT', key, size, ttlMs));
  }

  presignGet(key: string, ttlMs: number): Promise<PresignedRequest> {
    checkKey(key);
    checkTtl(ttlMs);
    return Promise.resolve(this.presign('GET', key, null, ttlMs));
  }

  /** Answers a request to one of its presigned URLs, as R2 would. */
  async redeem(method: string, url: string, body?: Uint8Array): Promise<BlobResponse> {
    const signed = this.verify(method, url);
    if (signed === null) return { status: 403 };
    if (method === 'PUT') {
      if (body === undefined || body.length !== signed.size) return { status: 400 };
      await this.put(signed.key, body);
      return { status: 200 };
    }
    const bytes = await this.get(signed.key);
    return bytes === null ? { status: 404 } : { status: 200, body: bytes };
  }

  private presign(method: 'PUT' | 'GET', key: string, size: number | null, ttlMs: number): PresignedRequest {
    const expiresAt = this.now() + ttlMs;
    const query = `m=${method}&n=${size ?? ''}&e=${expiresAt}`;
    return { method, url: `${this.baseUrl}/${key}?${query}&s=${this.sign(key, query)}`, expiresAt };
  }

  private sign(key: string, query: string): string {
    return createHmac('sha256', this.secret).update(`${key}?${query}`).digest('base64url');
  }

  /** The key and size a valid, unexpired URL for `method` names; null for anything else. */
  private verify(method: string, url: string): { key: string; size: number | null } | null {
    const prefix = `${this.baseUrl}/`;
    if (!url.startsWith(prefix)) return null;
    const at = url.indexOf('?');
    if (at === -1) return null;
    const key = url.slice(prefix.length, at);
    const params = new URLSearchParams(url.slice(at + 1));
    const signature = params.get('s');
    const query = `m=${params.get('m') ?? ''}&n=${params.get('n') ?? ''}&e=${params.get('e') ?? ''}`;
    if (!isBlobKey(key) || signature === null || url.slice(at + 1) !== `${query}&s=${signature}`) return null;
    const expected = Buffer.from(this.sign(key, query));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    if (params.get('m') !== method || Number(params.get('e')) < this.now()) return null;
    const n = params.get('n');
    return { key, size: n === '' ? null : Number(n) };
  }
}
