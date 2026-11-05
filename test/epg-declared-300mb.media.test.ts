// RELAY step 24d "Done when", at scale: the 300 MB guide's 5,000 declared channels (`pnpm
// fixtures`) stored and searched. The guide is read as the EPG worker reads it (core's
// EpgGuideReader, every live channel of the 200k playlist wanted; its buckets aren't stored here),
// then its declared channels are built and written as the refresh writes them (`epgDeclared`,
// `putEpgDeclared`), and the query service searches them as the manual mapping's picker will: the
// first page, a channel by its number, a title in English, Arabic and French (accents dropped), a
// word nothing has, and the last page. Each answer is checked against the fixture generator's own
// names, and timed against a limit; the times are printed. Runs in `pnpm test:media` (CI job
// `media`).

import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { EpgGuideReader, EpgWantedSet } from '@zoma/core';
import type { GuideChannelsPage, GuideChannelsRequest } from '@zoma/data';
import { QueryService, beginEpgGeneration, commitEpgGeneration, epgDeclared, openDatabase, putEpgChannels, putEpgDeclared } from '@zoma/data';
import { describe, expect, it } from 'vitest';
import { freshFactory } from '../packages/data/src/test-support';
import { EPG_BENCH_NOW, parsePlaylistItems } from '../tools/bench/src/suites';
import { epgId } from '../tools/fixtures/src/catalog';

const fixtures = process.env['ZOMA_FIXTURES_DIR'] ?? join(import.meta.dirname, '..', '.cache', 'fixtures');
const guide = join(fixtures, 'xmltv-300mb.xml.gz');
const playlist = join(fixtures, 'playlist.m3u');
const CHANNELS = 5_000;

/**
 * Node's times, taken as about 15 times faster than a 2018 TV (architecture.md §1.5 step 10):
 * building and writing the record happens once per refresh in the EPG worker (60 ms: about 1 s on
 * a TV, beside minutes of reading); the first search after a reload reads it as the picker opens
 * (20 ms: about 300 ms, as a page of the grid's rows); each later search, a key typed, scans it in
 * memory (5 ms: about 75 ms). Measured on a desktop (2026-11-05): store 8.4 ms, first 2.2 ms, the
 * searches 0.5 ms at most.
 */
const LIMIT_MS = { store: 60, first: 20, search: 5 };

/** The fixture's channels whose number holds `digits` (their names and ids hold no other digit). */
const numbered = (digits: string): string[] => {
  const out: string[] = [];
  for (let k = 0; k < CHANNELS; k++) if (String(k).indexOf(digits) !== -1) out.push(epgId(k));
  return out;
};
/** The fixture's channels `k` with `k % 20 === rest` (one title of one language). */
const every20 = (rest: number): string[] => {
  const out: string[] = [];
  for (let k = rest; k < CHANNELS; k += 20) out.push(epgId(k));
  return out;
};
const range = (from: number, to: number): string[] => {
  const out: string[] = [];
  for (let k = from; k < to; k++) out.push(epgId(k));
  return out;
};

/** The searches, and the ids each must find (`count`) and list (`rows`, from `offset`). */
const SEARCHES: { name: string; req: Omit<GuideChannelsRequest, 'epgSrc'>; count: number; rows: string[] }[] = [
  { name: 'first page', req: { query: '', offset: 0, limit: 50 }, count: CHANNELS, rows: range(0, 50) },
  { name: 'by number', req: { query: 'CH 4321', offset: 0, limit: 50 }, count: 1, rows: [epgId(4321)] },
  { name: 'digits', req: { query: '123', offset: 0, limit: 50 }, count: numbered('123').length, rows: numbered('123') },
  // English channels are k % 4 = 0, Arabic 1, French 2; their title is TITLES[lang][k % 10].
  { name: 'english', req: { query: 'evening news', offset: 0, limit: 500 }, count: 250, rows: every20(0) },
  { name: 'arabic', req: { query: 'السوق إغلاق', offset: 0, limit: 500 }, count: 250, rows: every20(9) },
  { name: 'french', req: { query: 'METEO', offset: 0, limit: 500 }, count: 250, rows: every20(18) },
  { name: 'nothing', req: { query: 'zzzz', offset: 0, limit: 50 }, count: 0, rows: [] },
  { name: 'last page', req: { query: '', offset: CHANNELS - 50, limit: 50 }, count: CHANNELS, rows: range(CHANNELS - 50, CHANNELS) },
];

describe("the 300 MB guide's declared channels", () => {
  it(`stores the 5,000 in ≤ ${LIMIT_MS.store} ms and searches them in ≤ ${LIMIT_MS.first} ms (first) and ≤ ${LIMIT_MS.search} ms (each)`, async () => {
    if (!existsSync(guide) || !existsSync(playlist)) throw new Error(`${fixtures} lacks the guide or playlist: run pnpm fixtures (pnpm verify:media does)`);
    const live = await parsePlaylistItems(playlist, 'live');
    const db = await openDatabase(freshFactory());
    const epgSrc = 'fx:tvg0';
    const gen = await beginEpgGeneration(db, epgSrc, 0);
    const reader = new EpgGuideReader({ epgSrc, wanted: EpgWantedSet.fromItems(live), tier: 'full', nowMs: EPG_BENCH_NOW, languages: ['en'] });
    const decoder = new TextDecoder();
    for await (const chunk of createReadStream(guide).pipe(createGunzip())) reader.push(decoder.decode(chunk as Uint8Array, { stream: true }));
    reader.push(decoder.decode());
    reader.end();
    expect(reader.report().match.declared).toBe(CHANNELS);

    const times: Record<string, number> = {};
    let t = performance.now();
    await putEpgDeclared(db, epgSrc, gen, epgDeclared(reader.matcher.declaredChannels()));
    times['store'] = performance.now() - t;
    await putEpgChannels(db, epgSrc, gen, { matches: [], channels: [], unmatched: [] });
    await commitEpgGeneration(db, epgSrc, gen, EPG_BENCH_NOW);

    const q = new QueryService({ openDb: async () => db, now: () => EPG_BENCH_NOW });
    await q.reload();
    t = performance.now();
    const first = await q.guideChannels({ query: '', offset: 0, limit: 50 });
    times['first'] = performance.now() - t;
    expect(first.count).toBe(CHANNELS);
    // The shown name is the display name in the UI's language (English channels: "Evening News 0").
    expect(first.rows[0]).toEqual({ epgSrc, id: epgId(0), name: 'Evening News 0' });
    expect(first.rows[4]).toEqual({ epgSrc, id: epgId(4), name: 'Top Tracks 4' });

    for (const s of SEARCHES) {
      let best = Infinity;
      let page: GuideChannelsPage | null = null;
      for (let r = 0; r < 3; r++) {
        t = performance.now();
        page = await q.guideChannels(s.req);
        best = Math.min(best, performance.now() - t);
      }
      times[s.name] = best;
      expect(page!.count, s.name).toBe(s.count);
      expect(
        page!.rows.map((row) => row.id),
        s.name,
      ).toEqual(s.rows);
    }
    const shown = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v * 10) / 10]));
    console.log(`declared channels (ms; searches best of 3): ${JSON.stringify(shown)}`);
    expect(times['store']).toBeLessThanOrEqual(LIMIT_MS.store);
    expect(times['first']).toBeLessThanOrEqual(LIMIT_MS.first);
    for (const s of SEARCHES) expect(times[s.name], s.name).toBeLessThanOrEqual(LIMIT_MS.search);
    db.close();
  }, 300_000);
});
