// RELAY step 30b2: the TV app's build constants (tv-defines.config.ts at the repo root).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEV_API_BASE, PRODUCTION_API_BASE, defineValues, readConfigKeys, trustedConfigKeys, tvDefines } from '../../../tv-defines.config';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const DEV = 'XSL7BTMmu8T8z5VeovgdDDUYpXucxAgRpaNV8mOUSxc';
// Two made-up production keys (the last character holds two unused bits: A, E, I…).
const P1 = `${'A'.repeat(42)}E`;
const P2 = `${'B'.repeat(42)}w`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repo-shaped folder with these keys and this app version. */
function repo(keys: unknown, version = '1.2.3'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lablo-defines-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'config'));
  mkdirSync(path.join(dir, 'apps/tv'), { recursive: true });
  writeFileSync(path.join(dir, 'config/keys.json'), JSON.stringify(keys));
  writeFileSync(path.join(dir, 'apps/tv/package.json'), JSON.stringify({ name: '@lablo/app-tv', version }));
  return dir;
}

describe('tvDefines', () => {
  it("reads this repo: the app's version, the dev API base and the committed keys", () => {
    const keys = JSON.parse(readFileSync(path.join(ROOT, 'config/keys.json'), 'utf8')) as { production: string[]; dev: string };
    const { version } = JSON.parse(readFileSync(path.join(ROOT, 'apps/tv/package.json'), 'utf8')) as { version: string };
    expect(keys.dev).toBe(DEV);
    expect(tvDefines('dev')).toEqual({ apiBase: DEV_API_BASE, version, configKeys: [...keys.production, DEV] });
    expect(tvDefines('package').version).toBe(version);
    // No production domain before step 34: the TV build asks the dev address (on a TV, itself).
    expect(PRODUCTION_API_BASE).toBeNull();
    expect(tvDefines('package').apiBase).toBe('http://127.0.0.1:3100');
  });

  it('gives a TV build the dev key while there are no production keys', () => {
    const dir = repo({ production: [], dev: DEV });
    expect(tvDefines('package', dir)).toEqual({ apiBase: DEV_API_BASE, version: '1.2.3', configKeys: [DEV] });
    expect(tvDefines('dev', dir).configKeys).toEqual([DEV]);
  });

  it('never gives a TV build the dev key once production keys exist; the dev app trusts both', () => {
    const dir = repo({ production: [P1, P2], dev: DEV });
    expect(tvDefines('package', dir).configKeys).toEqual([P1, P2]);
    expect(tvDefines('dev', dir).configKeys).toEqual([P1, P2, DEV]);
  });

  it('turns the constants into define values (JSON literals)', () => {
    expect(defineValues({ apiBase: 'http://a.test', version: '0.1.0', configKeys: [P1, DEV] })).toEqual({
      __API_BASE__: '"http://a.test"',
      __APP_VERSION__: '"0.1.0"',
      __CONFIG_KEYS__: `["${P1}","${DEV}"]`,
    });
  });
});

describe('readConfigKeys and trustedConfigKeys', () => {
  it('refuses a keys file without valid keys', () => {
    const bad: [unknown, RegExp][] = [
      [{ dev: DEV }, /production must be a list/],
      [{ production: 'x', dev: DEV }, /production must be a list/],
      [{ production: [P1.slice(1)], dev: DEV }, /production must be a list/],
      [{ production: [`${'A'.repeat(42)}B`], dev: DEV }, /production must be a list/],
      [{ production: [`${'A'.repeat(42)}=`], dev: DEV }, /production must be a list/],
      [{ production: [5], dev: DEV }, /production must be a list/],
      // A regex test alone would read [key] as the key's text.
      [{ production: [[P1]], dev: DEV }, /production must be a list/],
      [{ production: [] }, /dev must be a 32-byte base64url key/],
      [{ production: [], dev: `${DEV}A` }, /dev must be a 32-byte base64url key/],
      [{ production: [], dev: 7 }, /dev must be a 32-byte base64url key/],
      [{ production: [DEV], dev: DEV }, /the dev key is listed as a production key/],
    ];
    for (const [keys, message] of bad) expect(() => readConfigKeys(JSON.stringify(keys))).toThrow(message);
    expect(() => tvDefines('package', repo({ production: [DEV], dev: DEV }))).toThrow(/dev key is listed/);
    expect(readConfigKeys(JSON.stringify({ production: [P1, P2], dev: DEV }))).toEqual({ production: [P1, P2], dev: DEV });
    // Every last character with its two unused bits clear is a key's.
    for (const last of 'AEIMQUYcgkosw048') expect(readConfigKeys(JSON.stringify({ production: [], dev: `${'A'.repeat(42)}${last}` })).dev).toHaveLength(43);
  });

  it('copies the lists it gives', () => {
    const keys = { production: [P1], dev: DEV };
    const packaged = trustedConfigKeys('package', keys);
    packaged.push('x');
    expect(keys.production).toEqual([P1]);
  });
});
