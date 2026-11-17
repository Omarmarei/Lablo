import { describe, expect, it } from 'vitest';
import type { BackupEnvelope } from './backup';
import { BACKUP_KDF, BACKUP_SCRYPT, backupKeys, backupSalt, deriveBackupMaster, openBackup, sealBackup, tokenHash } from './backup';
import { fromBase64Url, toBase64Url, utf8 } from './bytes';
import { hkdfSha256, hmacSha256, scrypt, sha256 } from './hash';
import { flip, patternBytes } from './test-support';

describe('the backup master', () => {
  it("is scrypt N=2^15, r=8, p=1 over the device secret, salted with the platform and the app's id", async () => {
    expect(BACKUP_SCRYPT).toEqual({ N: 32768, r: 8, p: 1, dkLen: 32 });
    expect(BACKUP_KDF).toBe('scrypt-15-8-1');
    expect(backupSalt('webos', 'com.lablo.iptv')).toBe('lablo.backup.v1|webos|com.lablo.iptv');
    const master = await deriveBackupMaster('LGUDID-1', 'webos', 'com.lablo.iptv');
    expect(master).toEqual(await scrypt(utf8('LGUDID-1'), utf8('lablo.backup.v1|webos|com.lablo.iptv'), BACKUP_SCRYPT));
    expect(master).toHaveLength(32);
  });

  it('differs by secret, platform and app id', async () => {
    const base = await deriveBackupMaster('secret', 'tizen', 'app');
    expect(await deriveBackupMaster('secret2', 'tizen', 'app')).not.toEqual(base);
    expect(await deriveBackupMaster('secret', 'webos', 'app')).not.toEqual(base);
    expect(await deriveBackupMaster('secret', 'tizen', 'app2')).not.toEqual(base);
  });

  it('reports its progress', async () => {
    const seen: number[] = [];
    await deriveBackupMaster('secret', 'tizen', 'app', (fraction) => seen.push(fraction));
    expect(seen[seen.length - 1]).toBe(1);
  });
});

describe('backupKeys', () => {
  const master = patternBytes(32, 3);

  it('derives the lookup id and write token by HMAC, the two keys by HKDF', () => {
    const keys = backupKeys(master);
    expect(keys.lookupId).toBe(toBase64Url(hmacSha256(master, utf8('lookup'))));
    expect(keys.writeToken).toBe(toBase64Url(hmacSha256(master, utf8('write'))));
    expect(keys.encKey).toEqual(hkdfSha256(master, utf8('enc')));
    expect(keys.localKey).toEqual(hkdfSha256(master, utf8('local')));
    expect(keys.lookupId).toHaveLength(43);
    expect(keys.writeToken).toHaveLength(43);
    expect(keys.encKey).toHaveLength(32);
    expect(keys.localKey).toHaveLength(32);
    expect(new Set([keys.lookupId, keys.writeToken, toBase64Url(keys.encKey), toBase64Url(keys.localKey)]).size).toBe(4);
  });

  it('refuses a master that is not 32 bytes', () => {
    expect(() => backupKeys(new Uint8Array(31))).toThrow(RangeError);
    expect(() => backupKeys(new Uint8Array(33))).toThrow(RangeError);
  });
});

describe('tokenHash', () => {
  it("is b64url(sha256(the token's bytes)) for a 32-byte token", () => {
    const token = toBase64Url(patternBytes(32));
    expect(tokenHash(token)).toBe(toBase64Url(sha256(patternBytes(32))));
    expect(tokenHash(backupKeys(patternBytes(32, 9)).writeToken)).toHaveLength(43);
  });

  it('is null for anything else', () => {
    expect(tokenHash(toBase64Url(patternBytes(31)))).toBeNull();
    expect(tokenHash(toBase64Url(patternBytes(33)))).toBeNull();
    expect(tokenHash(`${toBase64Url(patternBytes(32)).slice(0, 42)}=`)).toBeNull();
    expect(tokenHash('')).toBeNull();
  });
});

describe('the backup envelope', () => {
  const key = patternBytes(32, 1);
  const plain = utf8('{"v":7,"sources":[]}');

  it('seals with secretbox under a fresh nonce and opens again', () => {
    const one = sealBackup(plain, key);
    const two = sealBackup(plain, key);
    expect(one.v).toBe(1);
    expect(one.kdf).toBe('scrypt-15-8-1');
    expect(Object.keys(one).sort()).toEqual(['ct', 'kdf', 'nonce', 'v']);
    expect(fromBase64Url(one.nonce)).toHaveLength(24);
    expect(fromBase64Url(one.ct)).toHaveLength(plain.length + 16);
    expect(one.nonce).not.toBe(two.nonce);
    expect(openBackup(one, key)).toEqual(plain);
    expect(openBackup(two, key)).toEqual(plain);
  });

  it('takes a given nonce (test vectors)', () => {
    const nonce = patternBytes(24, 5);
    const sealed = sealBackup(plain, key, nonce);
    expect(sealed.nonce).toBe(toBase64Url(nonce));
    expect(sealBackup(plain, key, nonce)).toEqual(sealed);
    expect(() => sealBackup(plain, key, new Uint8Array(23))).toThrow(RangeError);
  });

  it('seals an empty plaintext', () => {
    const sealed = sealBackup(new Uint8Array(0), key);
    expect(openBackup(sealed, key)).toEqual(new Uint8Array(0));
  });

  it('opens to null under another key, or when anything was changed', () => {
    const sealed = sealBackup(plain, key, patternBytes(24, 5));
    expect(openBackup(sealed, patternBytes(32, 2))).toBeNull();
    const ct = fromBase64Url(sealed.ct)!;
    flip(ct, 3, 1);
    expect(openBackup({ ...sealed, ct: toBase64Url(ct) }, key)).toBeNull();
    const nonce = fromBase64Url(sealed.nonce)!;
    flip(nonce, 0, 1);
    expect(openBackup({ ...sealed, nonce: toBase64Url(nonce) }, key)).toBeNull();
  });

  it('opens to null when the envelope is not ours', () => {
    const sealed = sealBackup(plain, key);
    const variants: unknown[] = [
      { ...sealed, v: 2 },
      { ...sealed, kdf: 'scrypt-14-8-1' },
      { ...sealed, nonce: toBase64Url(patternBytes(23)) },
      { ...sealed, nonce: `${sealed.nonce}=` },
      { ...sealed, ct: toBase64Url(patternBytes(15)) },
      { ...sealed, ct: 42 },
      { v: 1, kdf: 'scrypt-15-8-1' },
    ];
    for (const variant of variants) expect(openBackup(variant as BackupEnvelope, key)).toBeNull();
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => sealBackup(plain, new Uint8Array(16))).toThrow(RangeError);
    expect(() => openBackup(sealBackup(plain, key), new Uint8Array(16))).toThrow(RangeError);
  });
});
