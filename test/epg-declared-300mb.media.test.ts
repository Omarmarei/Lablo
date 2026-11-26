// RELAY step 24d "Done when", at scale: the 300 MB guide's 5,000 declared channels (`pnpm
// fixtures`) stored and searched. The guide is read as the EPG worker reads it (core's
// EpgGuideReader, every live channel of the 200k playlist wanted; its buckets aren't stored here),
// then its declared channels are built and written as the refresh writes them (`epgDeclared`,
// `putEpgDeclared`), and the query service searches them as the manual mapping's picker will: the
// first page, a channel by its number, a title in English, Arabic and French (accents dropped), a
// word nothing has, and the last page. Each answer is checked against the fixture generator's own
// names, and timed against a budget; the times are printed. Runs in `pnpm test:media` (CI job
// `media`).

import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { EpgGuideReader, EpgWantedSet } from '@lablo/core';
import type { GuideChannelsPage, GuideChannelsRequest } from '@lablo/data';
import { QueryService, beginEpgGeneration, commitEpgGeneration, epgDeclared, openDatabase, putEpgChannels, putEpgDeclared } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { freshFactory } from '../packages/data/src/test-support';
import { EPG_BENCH_NOW, parsePlaylistItems } from '../tools/bench/src/suites';
import { epgId } from '../tools/fixtures/src/catalog';

const fixtures = process.env['LABLO_FIXTURES_DIR'] ?? join(import.meta.dirname, '..', '.cache', 'fixtures');
const guide = join(fixtures, 'xmltv-300mb.xml.gz');
const playlist = join(fixtures, 'playlist.m3u');
const CHANNELS = 5_000;

/**
 * The budgets, in calibrations (RELAY step 53). A calibration is a fixed piece of work of the
 * store's shape in this file's own code (`calibration` below), timed in the same process between
 * the measured runs, so a slow or busy machine slows it as much as the work it measures: the
 * budgets hold the code's speed against the machine's, not against a clock. Each time is the
 * fastest of `SAMPLES` runs (a collection or a busy moment only adds time), as is the calibration.
 *
 * What is timed: building and writing the record, once per refresh in the EPG worker (the store);
 * the first search after a reload, which reads the record as the picker opens (first); each later
 * search, a key typed, which scans it in memory. Each budget is about twice what the work took on
 * this project's desktop and on CI (2026-11-26: store 1.2, first 0.5, the slowest search 0.07
 * calibrations), so work made 3× slower fails (`LABLO_SLOWDOWN=3`). In time, a calibration took
 * about 10 ms on the desktop and 10–30 ms on CI; a 2018 TV is about 15× slower than the desktop
 * (architecture.md §1.5 step 10), so the store's budget is about half a second there, the first
 * search's 0.2 s and a later search's 25 ms.
 *
 * Until step 53 the budgets were milliseconds of one run (store 60, first 20, each search 5):
 * CI runners took 9.6 to 89 ms for the store, and one run in five or six failed.
 */
const LIMIT = { store: 2.5, first: 1, search: 0.15 };
const SAMPLES = 5;
/**
 * Runs each timed piece of work this many times, as code that many times slower would. With 3
 * every budget must fail: the check that they aren't blind (`LABLO_SLOWDOWN=3 pnpm test:media
 * test/epg-declared-300mb.media.test.ts`).
 */
const SLOWDOWN = Number(process.env['LABLO_SLOWDOWN'] ?? '1');

/**
 * One calibration, in ms: 5,000 records of three strings (an id, a name with an accent, a
 * lower-cased NFKD search text) built and put into a fresh fake IndexedDB in one transaction.
 */
async function calibration(): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = freshFactory().open('calibration', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('records');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const t = performance.now();
  const record = { ids: [] as string[], names: [] as string[], search: [] as string[] };
  for (let k = 0; k < CHANNELS; k++) {
    const id = `calibration${k}.example.test`;
    const name = `Calibration Channel ${k} Évening`;
    record.ids.push(id);
    record.names.push(name);
    record.search.push(`${id} ${name.normalize('NFKD').toLowerCase()}`);
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('records', 'readwrite');
    tx.objectStore('records').put(record, ['calibration', 1, 'declared']);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const ms = performance.now() - t;
  db.close();
  return ms;
}

/** The fastest calibration so far (ms). */
let calibrationMs = Infinity;

/**
 * The fastest of `SAMPLES` runs of `run` (ms), each after a calibration and `prepare` (neither
 * timed). With `SLOWDOWN` above 1, a run is `prepare` and `run` that many times, the `run`s timed.
 */
async function fastest(run: () => Promise<unknown>, prepare?: () => Promise<unknown>): Promise<number> {
  let best = Infinity;
  for (let s = 0; s < SAMPLES; s++) {
    calibrationMs = Math.min(calibrationMs, await calibration());
    let ms = 0;
    for (let k = 0; k < SLOWDOWN; k++) {
      await prepare?.();
      const t = performance.now();
      await run();
      ms += performance.now() - t;
    }
    best = Math.min(best, ms);
  }
  return best;
}

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
  it(`stores the 5,000 in ≤ ${LIMIT.store} calibrations and searches them in ≤ ${LIMIT.first} (first) and ≤ ${LIMIT.search} (each)`, async () => {
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
    // The same record each time, under the same key: each run writes it again.
    times['store'] = await fastest(() => putEpgDeclared(db, epgSrc, gen, epgDeclared(reader.matcher.declaredChannels())));
    await putEpgChannels(db, epgSrc, gen, { matches: [], channels: [], unmatched: [] });
    await commitEpgGeneration(db, epgSrc, gen, EPG_BENCH_NOW);

    const q = new QueryService({ openDb: async () => db, now: () => EPG_BENCH_NOW });
    let first: GuideChannelsPage | null = null;
    // A reload forgets the record read, so each run reads it again.
    times['first'] = await fastest(
      async () => (first = await q.guideChannels({ query: '', offset: 0, limit: 50 })),
      () => q.reload(),
    );
    expect(first!.count).toBe(CHANNELS);
    // The shown name is the display name in the UI's language (English channels: "Evening News 0").
    expect(first!.rows[0]).toEqual({ epgSrc, id: epgId(0), name: 'Evening News 0' });
    expect(first!.rows[4]).toEqual({ epgSrc, id: epgId(4), name: 'Top Tracks 4' });

    for (const s of SEARCHES) {
      let page: GuideChannelsPage | null = null;
      times[s.name] = await fastest(async () => (page = await q.guideChannels(s.req)));
      expect(page!.count, s.name).toBe(s.count);
      expect(
        page!.rows.map((row) => row.id),
        s.name,
      ).toEqual(s.rows);
    }
    const tenths = (v: number): number => Math.round(v * 10) / 10;
    const units = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, v / calibrationMs]));
    const shown = (o: Record<string, number>, round: (v: number) => number): string => JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])));
    console.log(`declared channels (fastest of ${SAMPLES}${SLOWDOWN === 1 ? '' : `, slowed ${SLOWDOWN}×`}): calibration ${tenths(calibrationMs)} ms; ms ${shown(times, tenths)}; calibrations ${shown(units, (v) => Math.round(v * 1000) / 1000)}`);
    const over = (name: string, limit: number): string => `${name}: ${tenths(times[name]!)} ms is ${units[name]!.toFixed(3)} calibrations of ${tenths(calibrationMs)} ms (budget ${limit})`;
    expect(units['store'], over('store', LIMIT.store)).toBeLessThanOrEqual(LIMIT.store);
    expect(units['first'], over('first', LIMIT.first)).toBeLessThanOrEqual(LIMIT.first);
    for (const s of SEARCHES) expect(units[s.name], over(s.name, LIMIT.search)).toBeLessThanOrEqual(LIMIT.search);
    db.close();
  }, 300_000);
});
