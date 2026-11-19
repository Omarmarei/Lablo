import { PAIR_FILE_MAX_BYTES, pairFileUrlResponseSchema, pairUploadResponseSchema } from '@lablo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import * as route from '../src/app/dev/blob/[...key]/route';
import type { BlobStore } from '../src/server/blob-store';
import { DEV_BLOB_PATH, MemoryBlobStore } from '../src/server/blob-store';
import { devBlob } from '../src/server/dev-blob';
import { readBytes } from '../src/server/http';
import type { Services } from '../src/server/services';
import { MemoryRateLimiter } from '../src/server/rate-limit';
import { resetServices, services } from '../src/server/services';

/**
 * The development blob route (RELAY step 31d1): the memory store's presigned URLs, which are paths
 * on the API's own origin, answered as R2 answers its own; never on Vercel.
 */

const FILE_ID = 'Ab-_Ab-_Ab-_Ab-_Ab-_AA';
const KEY = `pair/kkkkkkkkkkkkkkkkkkkkkg/${FILE_ID}`;
const ORIGIN = 'http://192.168.1.5:3100';
const bytes = (...values: number[]): Uint8Array<ArrayBuffer> => Uint8Array.from(values);

function servicesWith(blobs: BlobStore): (env: unknown) => Services {
  return () => ({ blobs, limiter: new MemoryRateLimiter(), rateSecret: 'r'.repeat(40) });
}

/** A request for a presigned path, from whatever address the API was reached at. */
function request(method: string, path: string, body?: Uint8Array | ReadableStream<Uint8Array>, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method, body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit);
}

async function read(response: Response): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }> {
  return { status: response.status, headers: Object.fromEntries(response.headers), body: new Uint8Array(await response.arrayBuffer()) };
}

const env = {};

describe('the memory store’s URLs', () => {
  it('are paths on the API’s origin by default, which the upload answer’s schema takes', async () => {
    const blobs = new MemoryBlobStore();
    expect(DEV_BLOB_PATH).toBe('/dev/blob');
    const put = await blobs.presignPut(KEY, 2, 60_000);
    const get = await blobs.presignGet(KEY, 60_000);
    expect(put.url).toMatch(new RegExp(`^/dev/blob/${KEY}\\?m=PUT&n=2&e=\\d+&s=[A-Za-z0-9_-]{43}$`));
    expect(get.url).toMatch(new RegExp(`^/dev/blob/${KEY}\\?m=GET&n=&e=\\d+&s=[A-Za-z0-9_-]{43}$`));
    expect(pairUploadResponseSchema.safeParse({ url: put.url, key: FILE_ID, exp: put.expiresAt }).success).toBe(true);
    expect(pairFileUrlResponseSchema.safeParse({ url: get.url, key: FILE_ID, exp: get.expiresAt }).success).toBe(true);
    // Redeemed as given: a host in front of the path is another URL.
    expect(await blobs.redeem('PUT', `${ORIGIN}${put.url}`, bytes(1, 2))).toEqual({ status: 403 });
    expect(await blobs.redeem('PUT', put.url, bytes(1, 2))).toEqual({ status: 200 });
    expect(await blobs.redeem('GET', get.url)).toEqual({ status: 200, body: bytes(1, 2) });
  });
});

describe('devBlob', () => {
  it('takes the upload of exactly its size, then gives it to any origin', async () => {
    const blobs = new MemoryBlobStore();
    const deps = servicesWith(blobs);
    const put = await blobs.presignPut(KEY, 3, 60_000);
    const stored = await read(await devBlob(request('PUT', put.url, bytes(7, 8, 9)), env, deps));
    expect(stored).toEqual({ status: 200, headers: { 'cache-control': 'no-store' }, body: bytes() });
    const get = await blobs.presignGet(KEY, 60_000);
    const got = await read(await devBlob(request('GET', get.url), env, deps));
    expect(got).toEqual({
      status: 200,
      headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream' },
      body: bytes(7, 8, 9),
    });
  });

  it('answers as R2 would: 403 for a changed URL, 400 for another length, 404 for nothing there', async () => {
    const blobs = new MemoryBlobStore();
    const deps = servicesWith(blobs);
    const put = await blobs.presignPut(KEY, 3, 60_000);
    const get = await blobs.presignGet(KEY, 60_000);
    const status = async (r: Request): Promise<number> => (await devBlob(r, env, deps)).status;
    expect(await status(request('GET', get.url))).toBe(404);
    expect(await status(request('PUT', put.url.replace('n=3', 'n=2'), bytes(1, 2)))).toBe(403);
    expect(await status(request('PUT', get.url, bytes(1, 2, 3)))).toBe(403);
    expect(await status(request('GET', put.url))).toBe(403);
    expect(await status(request('PUT', put.url, bytes(1, 2)))).toBe(400);
    expect(await status(request('PUT', put.url, bytes(1, 2, 3, 4)))).toBe(400);
    expect(await status(request('PUT', put.url))).toBe(400);
    expect(blobs.size).toBe(0);
    // Every refusal of a GET is readable by the TV too.
    expect((await devBlob(request('GET', put.url), env, deps)).headers.get('access-control-allow-origin')).toBe('*');
    expect((await devBlob(request('PUT', put.url, bytes(1)), env, deps)).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('reads no more of a body than the URL’s size, and checks the URL first', async () => {
    const blobs = new MemoryBlobStore();
    const deps = servicesWith(blobs);
    const put = await blobs.presignPut(KEY, 3, 60_000);
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(2));
      },
    });
    expect((await devBlob(request('PUT', put.url, endless), env, deps)).status).toBe(400);
    expect(pulled).toBeLessThan(5);
    // Declared too long: not read at all.
    const declared = request('PUT', put.url, bytes(1, 2, 3, 4), { 'content-length': '4' });
    expect((await devBlob(declared, env, deps)).status).toBe(400);
    expect(declared.bodyUsed).toBe(false);
    // A body past a 0-byte URL's size is no body it can take.
    const none = await blobs.presignPut(KEY, 0, 60_000);
    expect((await devBlob(request('PUT', none.url, bytes(1)), env, deps)).status).toBe(400);
    expect(blobs.size).toBe(0);
    expect((await devBlob(request('PUT', none.url), env, deps)).status).toBe(200);
    // A changed URL is refused as one, whatever the body's length. (The signature's first character
    // changed to another: base64url starts with `_` one time in 64.)
    const changed = put.url.replace(/s=(.)/, (_all: string, first: string) => `s=${first === '_' ? '-' : '_'}`);
    expect(changed).not.toBe(put.url);
    expect((await devBlob(request('PUT', changed, bytes(1, 2, 3, 4)), env, deps)).status).toBe(403);
    // A query naming no usable size reads nothing.
    for (const n of ['', 'x', '-1', '1.5', String(PAIR_FILE_MAX_BYTES + 1)]) {
      const r = request('PUT', put.url.replace('n=3', `n=${n}`), bytes(1), { 'content-length': '1' });
      expect([n, (await devBlob(r, env, deps)).status, r.bodyUsed]).toEqual([n, 403, false]);
    }
  });

  it('takes the largest upload there can be', async () => {
    const blobs = new MemoryBlobStore();
    const deps = servicesWith(blobs);
    const put = await blobs.presignPut(KEY, PAIR_FILE_MAX_BYTES, 60_000);
    expect((await devBlob(request('PUT', put.url, new Uint8Array(PAIR_FILE_MAX_BYTES)), env, deps)).status).toBe(200);
    expect((await blobs.get(KEY))?.length).toBe(PAIR_FILE_MAX_BYTES);
  });

  it('answers 404 on Vercel, before asking for the services', async () => {
    const blobs = new MemoryBlobStore();
    const put = await blobs.presignPut(KEY, 1, 60_000);
    let asked = false;
    const deps = (): Services => {
      asked = true;
      return servicesWith(blobs)(null);
    };
    for (const method of ['GET', 'PUT']) {
      const answer = await read(await devBlob(request(method, put.url, method === 'PUT' ? bytes(1) : undefined), { VERCEL: '1' }, deps));
      expect([method, answer.status, answer.body]).toEqual([method, 404, bytes()]);
    }
    expect(asked).toBe(false);
    expect(blobs.size).toBe(0);
    // An empty VERCEL is not Vercel.
    expect((await devBlob(request('PUT', put.url, bytes(1)), { VERCEL: '' }, deps)).status).toBe(200);
  });

  it('answers 404 when the store isn’t the memory one (R2 serves its own URLs)', async () => {
    const other: BlobStore = {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(bytes(1)),
      delete: () => Promise.resolve(),
      presignPut: () => Promise.reject(new Error('unused')),
      presignGet: () => Promise.reject(new Error('unused')),
    };
    expect((await devBlob(request('GET', `/dev/blob/${KEY}?m=GET&n=&e=1&s=x`), env, servicesWith(other))).status).toBe(404);
    expect((await devBlob(request('PUT', `/dev/blob/${KEY}?m=PUT&n=1&e=1&s=x`, bytes(1)), env, servicesWith(other))).status).toBe(404);
  });

  it('answers 404 to any other method', async () => {
    const blobs = new MemoryBlobStore();
    const get = await blobs.presignGet(KEY, 60_000);
    await blobs.put(KEY, bytes(1));
    for (const method of ['POST', 'DELETE', 'HEAD']) expect([method, (await devBlob(request(method, get.url), env, servicesWith(blobs))).status]).toEqual([method, 404]);
    expect(blobs.size).toBe(1);
  });
});

describe('the route', () => {
  afterEach(() => resetServices());

  it('serves the process’s own memory store', async () => {
    resetServices();
    const blobs = services({}).blobs;
    const put = await blobs.presignPut(KEY, 2, 60_000);
    expect((await route.PUT(request('PUT', put.url, bytes(4, 5)))).status).toBe(200);
    const get = await blobs.presignGet(KEY, 60_000);
    const got = await read(await route.GET(request('GET', get.url)));
    expect([got.status, got.body]).toEqual([200, bytes(4, 5)]);
    expect(route.dynamic).toBe('force-dynamic');
  });
});

describe('readBytes', () => {
  const post = (body: Uint8Array<ArrayBuffer> | null, headers: Record<string, string> = {}): Request => new Request('http://x/', { method: 'POST', body, headers });

  it('gives the body’s bytes up to the cap, and none for no body', async () => {
    expect(await readBytes(post(bytes(1, 2, 3)), 3)).toEqual(bytes(1, 2, 3));
    expect(await readBytes(post(null), 3)).toEqual(bytes());
    expect(await readBytes(post(bytes(1, 2, 3, 4)), 3)).toBeNull();
    expect(await readBytes(post(bytes(1), { 'content-length': '4' }), 3)).toBeNull();
  });
});
