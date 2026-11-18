import { describe, expect, it } from 'vitest';
import { isBlobKey, MemoryBlobStore } from '../src/server/blob-store';

const KEY = 'pair/kkkkkkkkkkkkkkkkkkkkkg/Ab-_Ab-_Ab-_Ab-_Ab-_AA';
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

function store(start = 1_800_000_000_000): { blobs: MemoryBlobStore; clock: { now: number } } {
  const clock = { now: start };
  return { blobs: new MemoryBlobStore({ baseUrl: 'http://127.0.0.1:3100/dev/blob', now: () => clock.now }), clock };
}

describe('blob keys', () => {
  it("are the server's own: a prefix and one to three base64url segments", () => {
    for (const key of ['pair/a', 'pair/a/b', 'backup/a/b/c', KEY]) expect([key, isBlobKey(key)]).toEqual([key, true]);
    for (const key of ['', 'pair', 'pair/', 'pair//a', 'pair/a/', 'Pair/a', 'pair/../a', 'pair/a.b', 'pair/a b', 'pair/a/b/c/d', '/pair/a', `pair/${'a'.repeat(65)}`]) {
      expect([key, isBlobKey(key)]).toEqual([key, false]);
    }
  });
});

describe('MemoryBlobStore', () => {
  it('puts, gets and deletes copies of the bytes', async () => {
    const { blobs } = store();
    const data = bytes(1, 2, 3);
    await blobs.put(KEY, data);
    data[0] = 9;
    const got = await blobs.get(KEY);
    expect(got).toEqual(bytes(1, 2, 3));
    got![1] = 9;
    expect(await blobs.get(KEY)).toEqual(bytes(1, 2, 3));
    expect(blobs.size).toBe(1);
    await blobs.delete(KEY);
    expect(await blobs.get(KEY)).toBeNull();
    await blobs.delete(KEY);
    expect(blobs.size).toBe(0);
  });

  it('refuses keys that are not blob keys', async () => {
    const { blobs } = store();
    expect(() => blobs.put('pair/../x', bytes(1))).toThrow(RangeError);
    expect(() => blobs.get('x')).toThrow(RangeError);
    expect(() => blobs.delete('x')).toThrow(RangeError);
    expect(() => blobs.presignPut('x', 1, 60_000)).toThrow(RangeError);
    expect(() => blobs.presignGet('x', 60_000)).toThrow(RangeError);
  });

  it('presigns a PUT of exactly its size, until it expires', async () => {
    const { blobs, clock } = store();
    const put = await blobs.presignPut(KEY, 3, 60_000);
    expect(put).toMatchObject({ method: 'PUT', expiresAt: clock.now + 60_000 });
    expect(put.url.startsWith(`http://127.0.0.1:3100/dev/blob/${KEY}?`)).toBe(true);
    expect(await blobs.redeem('PUT', put.url, bytes(1, 2))).toEqual({ status: 400 });
    expect(await blobs.redeem('PUT', put.url, bytes(1, 2, 3, 4))).toEqual({ status: 400 });
    expect(await blobs.redeem('PUT', put.url)).toEqual({ status: 400 });
    expect(blobs.size).toBe(0);
    clock.now += 60_000;
    expect(await blobs.redeem('PUT', put.url, bytes(7, 8, 9))).toEqual({ status: 200 });
    expect(await blobs.get(KEY)).toEqual(bytes(7, 8, 9));
    clock.now += 1;
    expect(await blobs.redeem('PUT', put.url, bytes(1, 2, 3))).toEqual({ status: 403 });
    expect(await blobs.get(KEY)).toEqual(bytes(7, 8, 9));
  });

  it('presigns a GET, which a PUT cannot use and which finds nothing once deleted', async () => {
    const { blobs, clock } = store();
    await blobs.put(KEY, bytes(4, 5));
    const get = await blobs.presignGet(KEY, 5_000);
    expect(get).toMatchObject({ method: 'GET', expiresAt: clock.now + 5_000 });
    expect(await blobs.redeem('GET', get.url)).toEqual({ status: 200, body: bytes(4, 5) });
    expect(await blobs.redeem('PUT', get.url, bytes(1))).toEqual({ status: 403 });
    const put = await blobs.presignPut(KEY, 1, 5_000);
    expect(await blobs.redeem('GET', put.url)).toEqual({ status: 403 });
    await blobs.delete(KEY);
    expect(await blobs.redeem('GET', get.url)).toEqual({ status: 404 });
    clock.now += 5_001;
    expect(await blobs.redeem('GET', get.url)).toEqual({ status: 403 });
  });

  it('refuses a URL with anything changed: key, size, expiry, method, signature, host, extra parameters', async () => {
    const { blobs } = store();
    await blobs.put(KEY, bytes(1));
    await blobs.put('pair/other', bytes(2));
    const put = await blobs.presignPut(KEY, 3, 60_000);
    const get = await blobs.presignGet(KEY, 60_000);
    const changed = [
      put.url.replace(KEY, 'pair/other'),
      put.url.replace('n=3', 'n=4'),
      put.url.replace(/e=(\d+)/, (_m, e: string) => `e=${Number(e) + 1000}`),
      put.url.replace('m=PUT', 'm=GET'),
      put.url.replace(/s=(.)/, (_m, c: string) => `s=${c === 'A' ? 'B' : 'A'}`),
      put.url.slice(0, -1),
      `${put.url}x`,
      `${put.url}&x=1`,
      put.url.replace('127.0.0.1:3100', 'evil.example'),
      put.url.replace('127.0.0.1:3100', '127.0.0.9:3100'),
      put.url.split('?')[0]!,
    ];
    for (const url of changed) expect([url, await blobs.redeem('PUT', url, bytes(1, 2, 3))]).toEqual([url, { status: 403 }]);
    expect(await blobs.redeem('GET', get.url.replace(KEY, 'pair/other'))).toEqual({ status: 403 });
    expect(await blobs.redeem('put', put.url, bytes(1, 2, 3))).toEqual({ status: 403 });
    // Another store's URL for the same key: another secret.
    const other = store().blobs;
    expect(await other.redeem('PUT', put.url, bytes(1, 2, 3))).toEqual({ status: 403 });
    expect(await blobs.get(KEY)).toEqual(bytes(1));
  });

  it('presigns for 1 s to 24 h, and whole sizes only', async () => {
    const { blobs } = store();
    for (const ttl of [999, 86_400_001, 1.5, Number.NaN]) {
      expect(() => blobs.presignPut(KEY, 1, ttl)).toThrow(RangeError);
      expect(() => blobs.presignGet(KEY, ttl)).toThrow(RangeError);
    }
    await expect(blobs.presignGet(KEY, 1000)).resolves.toMatchObject({ method: 'GET' });
    await expect(blobs.presignGet(KEY, 86_400_000)).resolves.toMatchObject({ method: 'GET' });
    for (const size of [-1, 1.5, Number.NaN]) expect(() => blobs.presignPut(KEY, size, 60_000)).toThrow(RangeError);
    const empty = await blobs.presignPut(KEY, 0, 60_000);
    expect(await blobs.redeem('PUT', empty.url, new Uint8Array(0))).toEqual({ status: 200 });
  });

  it('points its URLs at the development route on the API’s own origin by default (RELAY step 31d1)', async () => {
    const put = await new MemoryBlobStore().presignPut(KEY, 1, 60_000);
    expect(put.url.startsWith('/dev/blob/pair/')).toBe(true);
  });
});
