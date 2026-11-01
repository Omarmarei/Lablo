import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { APP_VARIANT, NO_POLYFILLS_VARIANT, SEEDS, mustPass, seedBundle, stageApp, stageSeed } from './variants';

const parses = (code: string, ecmaVersion: 2016 | 2017 | 2018 | 2019 | 2020): boolean => {
  try {
    parse(code, { ecmaVersion, sourceType: 'script' });
    return true;
  } catch {
    return false;
  }
};

function fakeDist(): string {
  const dist = mkdtempSync(path.join(tmpdir(), 'zoma-engines-'));
  for (const platform of ['tizen', 'webos']) {
    mkdirSync(path.join(dist, platform));
    writeFileSync(path.join(dist, platform, 'index.html'), '<!DOCTYPE html>');
    writeFileSync(path.join(dist, platform, 'main.js'), `!function(){window.app="${platform}"}();`);
  }
  return dist;
}

describe('seeded variants', () => {
  it.each(SEEDS)('$id uses exactly ES$ecmaVersion syntax, which the build gate (ES2016) would reject', (seed) => {
    expect(parses(seed.code, seed.ecmaVersion)).toBe(true);
    expect(parses(seed.code, (seed.ecmaVersion - 1) as 2017 | 2019)).toBe(false);
    expect(parses(seed.code, 2016)).toBe(false);
  });

  it('includes an ES2018 seed (the RELAY step 2b requirement)', () => {
    expect(SEEDS.some((seed) => seed.ecmaVersion === 2018)).toBe(true);
  });

  it('prepends the seed to the bundle', () => {
    expect(seedBundle('main();', SEEDS[0]!)).toBe(`${SEEDS[0]!.code}\nmain();`);
  });

  it('expects failures exactly below each variant\'s minimum engine', () => {
    expect(mustPass(APP_VARIANT, 53)).toBe(true);
    const spread = SEEDS.find((seed) => seed.id === 'seed-es2018-object-spread')!;
    expect([53, 56, 68].map((major) => mustPass(spread, major))).toEqual([false, false, true]);
    const chaining = SEEDS.find((seed) => seed.id === 'seed-es2020-optional-chaining')!;
    expect([53, 56, 68].map((major) => mustPass(chaining, major))).toEqual([false, false, false]);
    expect([53, 56, 68].map((major) => mustPass(NO_POLYFILLS_VARIANT, major))).toEqual([false, false, false]);
  });

  it('stages the real builds and the seeded copies side by side', () => {
    const dist = fakeDist();
    const root = mkdtempSync(path.join(tmpdir(), 'zoma-variants-'));
    stageApp(dist, root);
    const seed = SEEDS[0]!;
    stageSeed(dist, root, seed);
    for (const platform of ['tizen', 'webos']) {
      const original = readFileSync(path.join(dist, platform, 'main.js'), 'utf8');
      expect(readFileSync(path.join(root, 'app', platform, 'main.js'), 'utf8')).toBe(original);
      expect(readFileSync(path.join(root, seed.id, platform, 'main.js'), 'utf8')).toBe(`${seed.code}\n${original}`);
      expect(readFileSync(path.join(root, seed.id, platform, 'index.html'), 'utf8')).toBe('<!DOCTYPE html>');
    }
    // The real build is never modified.
    expect(readFileSync(path.join(dist, 'webos', 'main.js'), 'utf8')).toBe('!function(){window.app="webos"}();');
  });

  it('asks for pnpm build:tv when there is nothing to test', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'zoma-empty-'));
    expect(() => stageApp(empty, path.join(empty, 'out'))).toThrow(/run pnpm build:tv first/);
  });
});
