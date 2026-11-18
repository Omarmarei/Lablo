import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { consentOf } from './backup-request';
import { lookupRequest } from './lookup-request';

// RELAY step 32c2: the look-up at a start with no profile reads the device ID with no consent
// asked (Omar's decision in step 32), and nothing else does.

const BUILD = { platform: 'tizen', appId: 'LabloIPTV1.Lablo' };
const BASE = 'http://127.0.0.1:3100';
const SRC = join(__dirname, '..');

function platform(answer: () => Promise<string | null>) {
  let calls = 0;
  return {
    calls: () => calls,
    deviceSecret: () => {
      calls++;
      return answer();
    },
  };
}

/** Every non-test source file of the app, as `[path from src, text]`. The lab is a developer page of its own. */
function appSources(): [string, string][] {
  const found: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== 'lab') walk(path);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
        found.push([relative(SRC, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')]);
      }
    }
  };
  walk(SRC);
  return found;
}

/** The files whose text matches `pattern`, with how many times. */
function callers(pattern: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [path, text] of appSources()) {
    const n = text.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
    if (n > 0) out[path] = n;
  }
  return out;
}

describe('lookupRequest', () => {
  it('reads the device ID with no consent asked, and passes it with the build and the API base', async () => {
    const p = platform(() => Promise.resolve('DUID-1'));
    expect(await lookupRequest(p, BUILD, BASE)).toEqual({ platform: 'tizen', appId: 'LabloIPTV1.Lablo', secret: 'DUID-1', base: BASE });
    expect(p.calls()).toBe(1);
  });

  it('gives null when there is no ID: none, blank, a rejection, a throw', async () => {
    expect(await lookupRequest(platform(() => Promise.resolve(null)), BUILD, BASE)).toBeNull();
    expect(await lookupRequest(platform(() => Promise.resolve(' \t')), BUILD, BASE)).toBeNull();
    expect(await lookupRequest(platform(() => Promise.reject(new Error('denied'))), BUILD, BASE)).toBeNull();
    const throwing = {
      deviceSecret: (): Promise<string | null> => {
        throw new Error('no webapis');
      },
    };
    expect(await lookupRequest(throwing, BUILD, BASE)).toBeNull();
  });

  it('keeps the ID as the platform gave it (spaces kept: the salt is exact)', async () => {
    expect((await lookupRequest(platform(() => Promise.resolve(' Q3CN ')), BUILD, BASE))?.secret).toBe(' Q3CN ');
  });
});

describe('who reads the device ID (a scan of apps/tv/src)', () => {
  it('only the backup requests call the platform', () => {
    expect(callers(/\.deviceSecret\(/)).toEqual({ 'backup/backup-request.ts': 1 });
    expect(callers(/\breadDeviceSecret\(/)).toEqual({ 'backup/backup-request.ts': 2, 'backup/lookup-request.ts': 1 });
    expect(callers(/\bbackupRequest\(/)).toEqual({ 'backup/backup-request.ts': 1, 'main.tsx': 1 });
  });

  it('only the start with no profile calls lookupRequest', () => {
    expect(callers(/\blookupRequest\(/)).toEqual({ 'backup/lookup-request.ts': 1, 'main.tsx': 1 });
    const main = readFileSync(join(SRC, 'main.tsx'), 'utf8');
    // Inside `startWithoutProfile`, which is called once, right under `profile === null`.
    const fn = main.indexOf('function startWithoutProfile(');
    expect(fn).toBeGreaterThan(-1);
    const body = main.slice(fn, main.indexOf('\n}\n', fn));
    expect(body).toMatch(/\blookupRequest\(/);
    expect(main.match(/\bstartWithoutProfile\(/g)).toHaveLength(2);
    expect(main).toMatch(/if \(profile === null\) \{?\s*startWithoutProfile\(/);
  });
});

describe('consentOf', () => {
  it("reads the profile's answer: true, false, else null", () => {
    const profile = (onboarding: unknown) => ({ version: 8, doc: { v: 8, onboarding } }) as never;
    expect(consentOf(null)).toBeNull();
    expect(consentOf(profile({ consent: true }))).toBe(true);
    expect(consentOf(profile({ consent: false }))).toBe(false);
    expect(consentOf(profile({ consent: null }))).toBeNull();
    expect(consentOf(profile({ consent: 'yes' }))).toBeNull();
    expect(consentOf(profile({}))).toBeNull();
    expect(consentOf(profile(null))).toBeNull();
    expect(consentOf(profile(undefined))).toBeNull();
  });
});
