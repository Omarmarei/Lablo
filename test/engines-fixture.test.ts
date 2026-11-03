// RELAY steps 8b and 9b: the old-engine harness checks exact numbers (items committed, search
// hits, guide matches), so its fixture's expectations are cross-checked here against core's real
// M3U parser, name normalization and EPG reader, and its app URLs against the app's own
// parameter parser.

import { gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EpgGuideReader, EpgWantedSet, epgNowNext, normalizeName, parseM3uCatalog } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import { readDebugParams, readScreen } from '../apps/tv/src/data/params';
import { CatalogChunker } from '../packages/data/src/chunker';
import { FIXTURE_ORIGIN, FIXTURE_SIZE, appUrl, dataChecks, fixtureEntries, fixtureM3u, fixtureXmltv, liveCategories, stageFixtures } from '../tools/engines/src/fixture';

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
    // Onboarding's done screen counts them (step 13c).
    for (const check of [checks.tizen, checks.webos]) {
      expect(check.live).toBe(items.filter((i) => i.kind === 'live').length);
      expect(check.movies).toBe(items.filter((i) => i.kind === 'movie').length);
    }
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

  it('stages the plain and gzipped playlists and guides, each playlist naming its guide', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'zoma-fixture-'));
    const now = Date.UTC(2026, 10, 2, 12, 34);
    stageFixtures(dir, now);
    const read = (file: string): Buffer => readFileSync(path.join(dir, 'fixtures', file));
    const gz = read(checks.webos.file);
    expect([gz[0], gz[1]]).toEqual([0x1f, 0x8b]);
    expect(read(checks.tizen.file).toString('utf8')).toBe(fixtureM3u(entries, 'guide.xml'));
    expect(gunzipSync(gz).toString('utf8')).toBe(fixtureM3u(entries, 'guide.xml.gz'));
    expect(parseM3uCatalog('debug', gunzipSync(gz).toString('utf8')).summary.epgUrls).toEqual([`${FIXTURE_ORIGIN}/guide.xml.gz`]);
    expect(gunzipSync(read(checks.webos.guide)).equals(read(checks.tizen.guide))).toBe(true);
    expect(read(checks.tizen.guide).toString('utf8')).toBe(fixtureXmltv(entries, now));
  });

  it('expects the guide matches and a now/next that core gives', () => {
    const now = Date.UTC(2026, 10, 2, 12, 34);
    const live = items.filter((i) => i.kind === 'live');
    const reader = new EpgGuideReader({ epgSrc: 'debug:tvg0', wanted: EpgWantedSet.fromItems(live), tier: 'low', nowMs: now + 3_600_000 });
    const buckets = [...reader.push(fixtureXmltv(entries, now)), ...reader.end()];
    const r = reader.report();
    expect(r.match).toMatchObject({ wanted: checks.webos.epgWanted, matched: checks.webos.epgMatched, declared: checks.webos.epgMatched + 1, used: checks.webos.epgMatched });
    expect(checks.tizen.epgMatched).toBe(300);
    // The first live channel has programmes on air for days after the fixture is staged.
    const first = buckets.filter((b) => b.channel === 'fixture.1');
    for (const later of [0, 1, 47]) {
      const at = now + later * 3_600_000;
      expect(epgNowNext(first, at).now?.title).toBe(`fixture.1 ${new Date(at).getUTCHours()}h`);
    }
  });

  it("lists the live screen's categories as the ingest numbers them, each channel with its guide or none (RELAY step 14c)", () => {
    const chunker = new CatalogChunker('live');
    const chunks = items.filter((i) => i.kind === 'live').flatMap((item) => chunker.push(item));
    chunks.push(...chunker.end());
    const listed = liveCategories(entries);
    // The rail's order is the ingest's catIdx; each category's channels in chunk order.
    expect(listed.map((c) => [c.name, c.channels.length])).toEqual(chunker.categories().map((c) => [c.name, c.count]));
    for (const [catIdx, category] of listed.entries()) {
      const stored = chunks.filter((c) => c.catIdx === catIdx).sort((a, b) => a.chunk - b.chunk).flatMap((c) => c.items.map((i) => i.name));
      expect(category.channels.map((c) => c.name)).toEqual(stored);
    }
    // "All channels" numbers a channel by its place in it: each category starts after the ones before.
    expect(listed.map((c) => c.allStart)).toEqual(listed.map((_c, i) => listed.slice(0, i).reduce((n, c) => n + c.channels.length, 0)));
    expect(listed.reduce((n, c) => n + c.channels.length, 0)).toBe(checks.tizen.live);
    expect(listed).toHaveLength(14);
    // The guide has programmes for exactly the channels marked with one.
    const guided = new Set([...fixtureXmltv(entries, Date.UTC(2026, 10, 2, 12)).matchAll(/<channel id="([^"]+)">/g)].map((m) => m[1]));
    const all = listed.flatMap((c) => c.channels);
    expect(all.filter((c) => c.guide).map((c) => c.tvgId)).toEqual(all.map((c) => c.tvgId).filter((id) => guided.has(id)));
    expect(all.filter((c) => c.guide)).toHaveLength(checks.tizen.epgMatched);
  });

  it('builds app URLs that the app reads back as the hello screen + force + query + source', () => {
    for (const platform of ['tizen', 'webos'] as const) {
      const check = checks[platform];
      const url = appUrl('app', platform, check);
      expect(url.startsWith(`file:///app/app/${platform}/index.html?`)).toBe(true);
      expect(readScreen(url.slice(url.indexOf('?')))).toBe('hello');
      const params = readDebugParams(url.slice(url.indexOf('?')));
      expect(params).toEqual({ source: `${FIXTURE_ORIGIN}/${check.file}`, query: check.query, force: true, error: null });
    }
  });
});
