import { createHash } from 'node:crypto';
import { gunzipSync as nodeGunzip, gzipSync as nodeGzip } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BACKUP_PLAIN_MAX_BYTES, backupPlain, profileHash, readBackupPlain } from './backup-plain';
import { emptyProfile } from './profile';

const DOC = {
  ...emptyProfile(),
  sources: [{ id: 's1', type: 'xtream', name: 'قنواتي 📺', account: { base: 'http://panel.test:8080', username: 'u', password: 'p' }, added: 1 }],
};

/** `bytes` with the gzip trailer's plain length set to `size` (little-endian). */
function withTrailer(bytes: Uint8Array, size: number): Uint8Array {
  const out = bytes.slice();
  const n = out.length;
  out[n - 4] = size & 255;
  out[n - 3] = (size >>> 8) & 255;
  out[n - 2] = (size >>> 16) & 255;
  out[n - 1] = (size >>> 24) & 255;
  return out;
}

/** A gzip (Node's zlib) of `text`'s UTF-8. */
const gz = (text: string | Uint8Array): Uint8Array => new Uint8Array(nodeGzip(typeof text === 'string' ? Buffer.from(text, 'utf8') : text));

/** The JSON text `{"v":1,"pad":"…"}` of exactly `length` UTF-8 bytes. */
function jsonOf(length: number): string {
  const head = '{"v":1,"pad":"';
  return head + 'a'.repeat(length - head.length - 2) + '"}';
}

describe('backupPlain', () => {
  it("is the JSON's UTF-8, gzipped, with no time in its header: one document gives one byte string", () => {
    const json = JSON.stringify(DOC);
    const plain = backupPlain(json);
    expect([plain[0], plain[1], plain[2]]).toEqual([0x1f, 0x8b, 8]);
    // MTIME (bytes 4 to 7) is 0.
    expect([plain[4], plain[5], plain[6], plain[7]]).toEqual([0, 0, 0, 0]);
    expect(Buffer.from(nodeGunzip(plain)).toString('utf8')).toBe(json);
    expect(Buffer.from(backupPlain(json)).equals(Buffer.from(plain))).toBe(true);
    // Compressed: the JSON of a long list is far smaller gzipped.
    const long = JSON.stringify({ ...DOC, favourites: Array.from({ length: 200 }, (_, i) => ({ key: `x:s1:live:${i}`, src: 's1', kind: 'live', normName: 'channel', added: 1, missingSince: null })) });
    expect(backupPlain(long).length).toBeLessThan(long.length / 5);
  });
});

describe('readBackupPlain', () => {
  it('has a cap of 8 MB (pinned)', () => {
    expect(BACKUP_PLAIN_MAX_BYTES).toBe(8 * 1024 * 1024);
  });

  it('reads back the document backupPlain wrote, Arabic text and emoji included', () => {
    expect(readBackupPlain(backupPlain(JSON.stringify(DOC)))).toEqual(DOC);
  });

  it('reads any gzip of a profile (another writer, other options)', () => {
    expect(readBackupPlain(gz(JSON.stringify(DOC)))).toEqual(DOC);
  });

  it(`takes a plaintext of exactly ${BACKUP_PLAIN_MAX_BYTES} bytes, and refuses one byte more before inflating it`, () => {
    const atCap = jsonOf(BACKUP_PLAIN_MAX_BYTES);
    expect(Buffer.byteLength(atCap)).toBe(BACKUP_PLAIN_MAX_BYTES);
    expect(readBackupPlain(backupPlain(atCap))).toMatchObject({ v: 1 });
    expect(readBackupPlain(backupPlain(jsonOf(BACKUP_PLAIN_MAX_BYTES + 1)))).toBeNull();
    // The trailer alone decides: a small stream saying it is over the cap isn't inflated.
    expect(readBackupPlain(withTrailer(backupPlain('{"v":1}'), BACKUP_PLAIN_MAX_BYTES + 1))).toBeNull();
    expect(readBackupPlain(withTrailer(backupPlain('{"v":1}'), 0xffffffff))).toBeNull();
  });

  it("refuses a stream whose length isn't the trailer's", () => {
    const plain = backupPlain('{"v":1}');
    expect(readBackupPlain(withTrailer(plain, 8))).toBeNull();
    expect(readBackupPlain(withTrailer(plain, 6))).toBeNull();
    expect(readBackupPlain(withTrailer(plain, 7))).toEqual({ v: 1 });
  });

  it.each([
    ['nothing', new Uint8Array(0)],
    ['17 bytes', gz('{"v":1}').slice(0, 17)],
    ['bytes that are not gzip', new Uint8Array(40).fill(7)],
    ['a gzip cut short', gz(JSON.stringify(DOC)).slice(0, 30)],
    ['a gzip that is not UTF-8', gz(Uint8Array.from([0x7b, 0x22, 0x76, 0x22, 0x3a, 0x31, 0x2c, 0x22, 0x6e, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]))],
    ['a lone surrogate encoded as UTF-8 bytes', gz(Uint8Array.from([0x7b, 0x22, 0x6e, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x2c, 0x22, 0x76, 0x22, 0x3a, 0x31, 0x7d]))],
    ['a gzip that is not JSON', gz('{"v":1')],
    ['JSON null', gz('null')],
    ['a number', gz('1')],
    ['a string', gz('"v"')],
    ['an array', gz('[1]')],
    ['an object with no version', gz('{"sources":[]}')],
    ['version 0', gz('{"v":0}')],
    ['version -1', gz('{"v":-1}')],
    ['version 1.5', gz('{"v":1.5}')],
    ['version "1"', gz('{"v":"1"}')],
    ['version 2^53', gz('{"v":9007199254740992}')],
  ])('refuses %s', (_, bytes) => {
    expect(readBackupPlain(bytes)).toBeNull();
  });

  it('takes any whole version of 1 or more (a newer one is the caller to refuse)', () => {
    expect(readBackupPlain(gz('{"v":1}'))).toEqual({ v: 1 });
    expect(readBackupPlain(gz('{"v":99,"x":true}'))).toEqual({ v: 99, x: true });
    expect(readBackupPlain(gz('{"v":9007199254740991}'))).toEqual({ v: 9007199254740991 });
  });
});

describe('profileHash', () => {
  it("is b64url(SHA-256(the JSON's UTF-8))", () => {
    const json = JSON.stringify(DOC);
    expect(profileHash(json)).toBe(createHash('sha256').update(json, 'utf8').digest('base64url'));
    expect(profileHash(json)).not.toBe(profileHash(json + ' '));
  });
});
