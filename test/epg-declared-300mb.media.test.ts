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
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { createGunzip } from 'node:zlib';
import { EpgGuideReader, EpgWantedSet } from '@lablo/core';
import type { DeclaredChannel, GuideChannelsPage, GuideChannelsRequest } from '@lablo/data';
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
 * The budgets, in calibrations (RELAY step 53). A calibration is the store's kind of work in this
 * file's own code (`calibration` below), timed in the same process just before each measured run,
 * so a slow or busy machine slows both alike: the budgets hold the code's speed against the
 * machine's, not against a clock. Each figure is the median of `SAMPLES` runs, each run's time
 * over its own calibration's.
 *
 * What is timed: building and writing the record, once per refresh in the EPG worker (the store);
 * the first search after a reload, which reads the record as the picker opens (first); each later
 * search, a key typed, which scans it in memory. Measured 2026-11-26 on three CI runners (alone and
 * beside the other media tests) and on this project's desktop (idle and with 14 busy cores):
 *
 *   store  1.09–1.64 calibrations, 3.3–4.3 with the work done 3 times (`LABLO_SLOWDOWN=3`)
 *   first  0.36–0.67, 1.19–1.47
 *   the slowest search ("by number")  0.05–0.24, 0.34–0.67
 *
 * Each budget sits between the two, so work made 3× slower fails while a busy machine passes. A
 * calibration took about 4 ms on CI's runners and 15 ms on the desktop; the store 5.5–6 ms on CI.
 *
 * Until step 53 the budgets were milliseconds of a single run (store 60, first 20, each search 5):
 * CI's runners took 9.6 to 89 ms for the store, and about one run in five failed.
 */
const LIMIT = { store: 2.5, first: 0.9, search: 0.33 };
const SAMPLES = 9;
/**
 * Runs each timed piece of work this many times, as code that many times slower would. With 3 the
 * store's budget fails, and so do the first search's and the slowest search's: the check that the
 * budgets aren't blind (`LABLO_SLOWDOWN=3 pnpm test:media test/epg-declared-300mb.media.test.ts`).
 */
const SLOWDOWN = Number(process.env['LABLO_SLOWDOWN'] ?? '1');

let codes = new Uint16Array(256);
/**
 * A character loop of `normalizeName`'s shape, for the calibration: ASCII letters lowered, digits
 * and every non-ASCII character kept, any run of the rest one space.
 */
function lowered(input: string): string {
  const n = input.length;
  if (codes.length < n) codes = new Uint16Array(n * 2);
  let len = 0;
  let space = false;
  for (let i = 0; i < n; i++) {
    let c = input.charCodeAt(i);
    if (c >= 65 && c <= 90) c += 32;
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c > 127) {
      if (space && len > 0) codes[len++] = 32;
      space = false;
      codes[len++] = c;
    } else space = true;
  }
  return String.fromCharCode.apply(null, codes.subarray(0, len) as unknown as number[]);
}

/**
 * One calibration, in ms: the guide's declared channels made into three columns as the store's
 * record is (each search text the id and the names through `lowered`), and put into a fresh fake
 * IndexedDB in one transaction.
 */
async function calibration(channels: readonly DeclaredChannel[]): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = freshFactory().open('calibration', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('records');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const t = performance.now();
  const record = { ids: [] as string[], names: [] as string[], search: [] as string[] };
  for (const c of channels) {
    let search = lowered(c.id);
    for (const name of c.names) search += String.fromCharCode(1) + lowered(name);
    record.ids.push(c.id);
    record.names.push(c.name);
    record.search.push(search);
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

/**
 * A full collection, as `pnpm bench` makes before each run (`--expose-gc`): taken before each
 * calibration and each measured run, so neither pays for the other's garbage or for the guide's.
 */
setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** A timed piece of work: its median time (ms), and the median of its runs' times in calibrations. */
interface Timing {
  ms: number;
  units: number;
}

/**
 * `run` timed `SAMPLES` times, each after `prepare` and a calibration (neither timed), each of
 * the two from a collection. With `SLOWDOWN` above 1, a run is `run` that many times, each after
 * `prepare`.
 */
async function timed(channels: readonly DeclaredChannel[], run: () => Promise<unknown>, prepare?: () => Promise<unknown>): Promise<Timing> {
  const ms: number[] = [];
  const units: number[] = [];
  for (let s = 0; s < SAMPLES; s++) {
    await prepare?.();
    collect();
    const calibrated = await calibration(channels);
    collect();
    let took = 0;
    for (let k = 0; k < SLOWDOWN; k++) {
      if (k > 0) await prepare?.();
      const t = performance.now();
      await run();
      took += performance.now() - t;
    }
    ms.push(took);
    units.push(took / calibrated);
  }
  return { ms: median(ms), units: median(units) };
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

/** The guide's declared channels, read as the EPG worker reads the guide (its reader is then let go). */
async function declaredChannels(epgSrc: string): Promise<readonly DeclaredChannel[]> {
  const live = await parsePlaylistItems(playlist, 'live');
  const reader = new EpgGuideReader({ epgSrc, wanted: EpgWantedSet.fromItems(live), tier: 'full', nowMs: EPG_BENCH_NOW, languages: ['en'] });
  const decoder = new TextDecoder();
  for await (const chunk of createReadStream(guide).pipe(createGunzip())) reader.push(decoder.decode(chunk as Uint8Array, { stream: true }));
  reader.push(decoder.decode());
  reader.end();
  expect(reader.report().match.declared).toBe(CHANNELS);
  return reader.matcher.declaredChannels();
}

describe("the 300 MB guide's declared channels", () => {
  it(`stores the 5,000 in ≤ ${LIMIT.store} calibrations and searches them in ≤ ${LIMIT.first} (first) and ≤ ${LIMIT.search} (each)`, async () => {
    if (!existsSync(guide) || !existsSync(playlist)) throw new Error(`${fixtures} lacks the guide or playlist: run pnpm fixtures (pnpm verify:media does)`);
    const epgSrc = 'fx:tvg0';
    const channels = await declaredChannels(epgSrc);
    expect(channels.length).toBe(CHANNELS);
    const db = await openDatabase(freshFactory());
    const gen = await beginEpgGeneration(db, epgSrc, 0);
    const times: Record<string, Timing> = {};
    // The same record each time, under the same key: each run writes it again.
    times['store'] = await timed(channels, () => putEpgDeclared(db, epgSrc, gen, epgDeclared(channels)));
    await putEpgChannels(db, epgSrc, gen, { matches: [], channels: [], unmatched: [] });
    await commitEpgGeneration(db, epgSrc, gen, EPG_BENCH_NOW);

    const q = new QueryService({ openDb: async () => db, now: () => EPG_BENCH_NOW });
    let first: GuideChannelsPage | null = null;
    // A reload forgets the record read, so each run reads it again.
    times['first'] = await timed(
      channels,
      async () => (first = await q.guideChannels({ query: '', offset: 0, limit: 50 })),
      () => q.reload(),
    );
    expect(first!.count).toBe(CHANNELS);
    // The shown name is the display name in the UI's language (English channels: "Evening News 0").
    expect(first!.rows[0]).toEqual({ epgSrc, id: epgId(0), name: 'Evening News 0' });
    expect(first!.rows[4]).toEqual({ epgSrc, id: epgId(4), name: 'Top Tracks 4' });

    for (const s of SEARCHES) {
      let page: GuideChannelsPage | null = null;
      times[s.name] = await timed(channels, async () => (page = await q.guideChannels(s.req)));
      expect(page!.count, s.name).toBe(s.count);
      expect(
        page!.rows.map((row) => row.id),
        s.name,
      ).toEqual(s.rows);
    }
    const shown = (pick: (t: Timing) => number, digits: number): string => JSON.stringify(Object.fromEntries(Object.entries(times).map(([k, t]) => [k, Number(pick(t).toFixed(digits))])));
    console.log(`declared channels (medians of ${SAMPLES}${SLOWDOWN === 1 ? '' : `, slowed ${SLOWDOWN}×`}): calibrations ${shown((t) => t.units, 3)}; ms ${shown((t) => t.ms, 2)}`);
    const over = (name: string, limit: number): string => `${name}: ${times[name]!.units.toFixed(3)} calibrations (${times[name]!.ms.toFixed(2)} ms), budget ${limit}`;
    expect(times['store']!.units, over('store', LIMIT.store)).toBeLessThanOrEqual(LIMIT.store);
    expect(times['first']!.units, over('first', LIMIT.first)).toBeLessThanOrEqual(LIMIT.first);
    for (const s of SEARCHES) expect(times[s.name]!.units, over(s.name, LIMIT.search)).toBeLessThanOrEqual(LIMIT.search);
    db.close();
  }, 300_000);
});
