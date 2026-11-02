// RELAY step 8b: the old-engine harness checks exact numbers (items committed, search hits),
// so its fixture's expectations are cross-checked here against core's real M3U parser and
// name normalization, and its app URLs against the app's own parameter parser.

import { gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeName, parseM3uCatalog } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import { readDebugParams } from '../apps/tv/src/data/params';
import { FIXTURE_ORIGIN, FIXTURE_SIZE, appUrl, dataChecks, fixtureEntries, fixtureM3u, stageFixtures } from '../tools/engines/src/fixture';

describe('the engines catalog fixture', () => {
  const entries = fixtureEntries();
  const checks = dataChecks(entries);
  const { items } = parseM3uCatalog('debug', fixtureM3u(entries));

  it('parses to exactly the expected items and kinds', () => {
    expect(items).toHaveLength(FIXTURE_SIZE);
    expect(checks.tizen.items).toBe(FIXTURE_SIZE);
    expect(checks.webos.items).toBe(FIXTURE_SIZE);
    expect(items.filter((i) => i.kind === 'live')).toHaveLength(2400);
    expect(items.filter((i) => i.kind === 'movie')).toHaveLength(600);
    expect(new Set(items.map((i) => i.key)).size).toBe(FIXTURE_SIZE);
  });

  it('expects the hit counts that normalized substring matching gives', () => {
    for (const check of [checks.tizen, checks.webos]) {
      const word = normalizeName(check.query);
      const hits = items.filter((i) => normalizeName(i.name).includes(word)).length;
      expect([check.query, hits]).toEqual([check.query, check.total]);
      expect(check.total).toBeGreaterThan(100);
    }
    expect(checks.tizen.total).toBe(308);
    expect(checks.webos.total).toBe(240);
    // The Arabic query only matches through normalization (bare alef against hamza).
    expect(items.filter((i) => i.name.includes(checks.webos.query))).toHaveLength(0);
  });

  it('stages the plain and gzipped playlists with the same bytes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zoma-fixture-'));
    stageFixtures(dir);
    const plain = readFileSync(path.join(dir, 'fixtures', checks.tizen.file));
    const gz = readFileSync(path.join(dir, 'fixtures', checks.webos.file));
    expect(gz[0]).toBe(0x1f);
    expect(gz[1]).toBe(0x8b);
    expect(gunzipSync(gz).equals(plain)).toBe(true);
    expect(plain.toString('utf8')).toBe(fixtureM3u(entries));
  });

  it('builds app URLs that the app reads back as force + query + source', () => {
    for (const platform of ['tizen', 'webos'] as const) {
      const check = checks[platform];
      const url = appUrl('app', platform, check);
      expect(url.startsWith(`file:///app/app/${platform}/index.html?`)).toBe(true);
      const params = readDebugParams(url.slice(url.indexOf('?')));
      expect(params).toEqual({ source: `${FIXTURE_ORIGIN}/${check.file}`, query: check.query, force: true, error: null });
    }
  });
});
