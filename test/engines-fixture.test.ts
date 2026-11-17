// RELAY steps 8b and 9b: the old-engine harness checks exact numbers (items committed, search
// hits, guide matches), so its fixture's expectations are cross-checked here against core's real
// M3U parser, name normalization and EPG reader, and its app URLs against the app's own
// parameter parser.

import { gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EpgGuideReader, EpgWantedSet, epgNowNext, normalizeName, parseM3uCatalog } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import { fromBase64Url } from '@lablo/crypto';
import { readApiBase, readChecks, readDebugParams, readScreen } from '../apps/tv/src/data/params';
import { asciiHost, cachedBlocklist } from '../packages/data/src/blocklist';
import { CatalogChunker } from '../packages/data/src/chunker';
import { checkConfigResponse } from '../packages/data/src/config-check';
import { configPolicy } from '../packages/data/src/config-policy';
import { ARABIC_HOST, BLOCKED_HOSTS, CONFIG_FILE, CONFIG_PROBES, configCheck, devSignedAnswer, harnessConfigDoc, trustsDevKey } from '../tools/engines/src/config';
import { FIXTURE_ORIGIN, FIXTURE_SIZE, POSTER_FILES, POSTER_SIZE, appUrl, dataChecks, fixtureEntries, fixtureM3u, fixtureXmltv, liveCategories, movieCategories, stageFixtures } from '../tools/engines/src/fixture';
import { pngSize } from '../tools/engines/src/poster';

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

  it("gives core's parser the movies' groups and posters the movies screen is checked against (RELAY step 26b)", () => {
    const movies = items.filter((i) => i.kind === 'movie');
    const listed = movieCategories(entries);
    expect(listed.map((c) => c.name)).toEqual([...new Set(movies.map((m) => m.group))]);
    expect(movies.map((m) => [m.name, m.logo ?? null])).toEqual(listed.flatMap((c) => c.movies.map((m) => [m.name, m.poster])));
    expect(movies.filter((m) => m.logo === undefined || m.logo === null)).toHaveLength(12);
  });

  it('stages the plain and gzipped playlists and guides, each playlist naming its guide', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lablo-fixture-'));
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
    // The posters: real PNGs at the tile's size.
    for (const poster of POSTER_FILES) expect(pngSize(read(poster.file))).toEqual(POSTER_SIZE);
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
    // Catch-up (step 25c): the playlist gives exactly the channels the walk expects marks on seven days of `shift`.
    const archived = new Map(items.filter((i) => i.kind === 'live' && i.catchup !== null).map((i) => [i.epgId, i.catchup]));
    expect(all.filter((c) => c.catchup > 0).map((c) => c.tvgId)).toEqual(all.map((c) => c.tvgId).filter((id) => archived.has(id)));
    for (const info of archived.values()) expect(info).toMatchObject({ mode: 'shift', days: 7 });
    expect(all.filter((c) => c.catchup > 0).every((c) => c.guide && c.catchup === 7)).toBe(true);
    expect(archived.size).toBe(all.filter((c) => c.guide).length / 2);
  });

  it('builds app URLs that the app reads back as the hello screen + force + query + source', () => {
    for (const platform of ['tizen', 'webos'] as const) {
      const check = checks[platform];
      const url = appUrl('app', platform, check);
      expect(url.startsWith(`file:///app/app/${platform}/index.html?`)).toBe(true);
      expect(readScreen(url.slice(url.indexOf('?')))).toBe('hello');
      const params = readDebugParams(url.slice(url.indexOf('?')));
      expect(params).toEqual({ source: `${FIXTURE_ORIGIN}/${check.file}`, query: check.query, force: true, error: null });
      // The config's base and the blocklist's probes (RELAY step 30c1): a TV build takes the loopback origin.
      expect(readApiBase(url.slice(url.indexOf('?')), 'http://127.0.0.1:3100', false)).toBe(FIXTURE_ORIGIN);
      expect(readChecks(url.slice(url.indexOf('?')))).toEqual(check.config.checks);
    }
  });
});

describe("the engines' signed config (RELAY step 30c1)", () => {
  const now = Date.UTC(2026, 10, 17, 12, 0);
  const keys = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'config/keys.json'), 'utf8')) as { production: string[]; dev: string };
  const devKey = fromBase64Url(keys.dev)!;

  it("is staged as a dev-signed answer that the TV's own check takes, with the notice and the blocklist expected", () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lablo-fixture-'));
    stageFixtures(dir, now);
    const text = readFileSync(path.join(dir, 'fixtures', CONFIG_FILE), 'utf8');
    expect(text).toBe(devSignedAnswer(harnessConfigDoc(now)));
    // The TV's check, as the config worker runs it, a minute later.
    const checked = checkConfigResponse(text, [devKey], null, now + 60_000);
    if (!checked.ok) throw new Error(`refused: ${checked.refusal}`);
    const policy = configPolicy(checked.config.doc, { platform: 'webos', version: '0.1.0', country: checked.config.cached.country });
    const expected = configCheck(true);
    expect([policy.kill, policy.notices.map((n) => n.id).join(','), policy.updateRequired]).toEqual([null, expected.notices, false]);
    // The TV's blocklist, as the query worker reads it from the stored copy.
    const list = cachedBlocklist({ doc: checked.config.cached.doc });
    expect(list.size).toBe(BLOCKED_HOSTS.length);
    expect(expected.checks.map((url) => String(list.blocksUrl(url))).join(',')).toBe(expected.blocked);
    expect(expected.blocked).toBe('true,true,false');
    // Valid for a week, longer than any harness run: expired after that, and refused under any other key.
    expect(checkConfigResponse(text, [devKey], null, now + 6 * 86_400_000).ok).toBe(true);
    expect(checkConfigResponse(text, [devKey], null, now + 8 * 86_400_000)).toEqual({ ok: false, refusal: 'expired' });
    expect(checkConfigResponse(text, [new Uint8Array(32).fill(7)], null, now)).toEqual({ ok: false, refusal: 'bad-signature' });
  });

  it('blocks the Arabic host in its xn-- form, and checks it as written', () => {
    expect(BLOCKED_HOSTS).toEqual(['blocked.lablo.test', 'xn--mgbh0fb.lablo.test']);
    expect(asciiHost(ARABIC_HOST)).toBe('xn--mgbh0fb.lablo.test');
    expect(CONFIG_PROBES.map((probe) => probe.url)[1]).toBe(`http://${ARABIC_HOST}/live/4.m3u8`);
    expect(ARABIC_HOST.charCodeAt(0)).toBe(0x645);
  });

  it("expects the copy refused, and nothing blocked, once a TV build trusts only production keys (step 34)", () => {
    expect(trustsDevKey('{"production": [], "dev": "x"}')).toBe(true);
    expect(trustsDevKey('{"production": ["a"], "dev": "x"}')).toBe(false);
    expect(() => trustsDevKey('{"dev": "x"}')).toThrow(/production must be a list/);
    expect(trustsDevKey(readFileSync(path.join(import.meta.dirname, '..', 'config/keys.json'), 'utf8'))).toBe(keys.production.length === 0);
    expect(configCheck(false)).toEqual({ checks: configCheck(true).checks, status: 'none', failure: 'bad-signature', notices: '', blocked: 'false,false,false' });
    const dir = mkdtempSync(path.join(tmpdir(), 'lablo-fixture-'));
    expect(stageFixtures(dir, now, false).webos.config).toEqual(configCheck(false));
    expect(stageFixtures(dir, now).tizen.config).toEqual(configCheck(true));
  });
});
