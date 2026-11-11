// RELAY step 23a "Done when", at scale: the grid guide's read over the 300 MB guide's 5,000
// channels (`pnpm fixtures`). The guide is read as the EPG worker reads it (core's EpgGuideReader,
// every live channel of the 200k playlist wanted, the full tier's 7 + 7 days), and its buckets and
// match table are written into IndexedDB (fake-indexeddb) as the refresh writes them. Then the query
// service answers grid windows: the rows of a screen and a page either side, over the hours in view,
// over two days, and in the catch-up days. Every programme's times are checked against the fixture
// generator's own schedule, and each window is timed (best of 3) against a limit; the times are
// printed. Runs in `pnpm test:media` (CI job `media`).

import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import type { EpgBucket } from '@lablo/core';
import { EpgGuideReader, EpgWantedSet } from '@lablo/core';
import type { GuideRow } from '@lablo/data';
import { QueryService, beginEpgGeneration, commitEpgGeneration, openDatabase, putEpgBuckets, putEpgChannels } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { freshFactory } from '../packages/data/src/test-support';
import { EPG_BENCH_NOW, parsePlaylistItems } from '../tools/bench/src/suites';
import { XMLTV_ANCHOR_MS, slotOf } from '../tools/fixtures/src/xmltv';

const fixtures = process.env['LABLO_FIXTURES_DIR'] ?? join(import.meta.dirname, '..', '.cache', 'fixtures');
const guide = join(fixtures, 'xmltv-300mb.xml.gz');
const playlist = join(fixtures, 'playlist.m3u');
const MINUTE = 60_000;
const DAY_MS = 86_400_000;
/**
 * Each window's answer in Node, best of 3. A page of new rows should fill within about 300 ms on a
 * 2018 TV, taken as about 15 times slower than the CI runner (architecture.md §1.5 step 10): 20 ms.
 * Measured: 1.4 ms (the hours in view), 1.4 ms (two days), 4.1 ms (three catch-up days) on a
 * desktop (2026-11-05).
 */
const LIMIT_MS = 20;

/**
 * 24 live channels of the 200k playlist in a row (a screen of 8 and a page either side), matched
 * or not. They include a guide channel of 150-minute slots, the only length that runs across
 * midnight (the others divide a day), so the windows that start at midnight need the day before.
 */
const GRID_ROWS = { at: 1_000, count: 24 };

/** The windows read, in minutes around the bench's now: the hours in view, two days ahead, three catch-up days. */
const GRID_WINDOWS: readonly { name: string; from: number; to: number }[] = [
  { name: 'view', from: -30, to: 90 },
  { name: 'two-days', from: 0, to: 2 * 1440 },
  { name: 'catch-up', from: -3 * 1440, to: 0 },
];

/**
 * The schedule the fixture generator wrote for guide channel `epg<k>.lablo.test` that the reader
 * keeps (`win`, in guide time), over [from, to), shifted.
 */
function generated(channel: string, win: { from: number; to: number }, from: number, to: number, shift: number): string[] {
  const k = Number(/^epg(\d+)\.lablo\.test$/.exec(channel)![1]);
  const slot = slotOf(k);
  const first = (XMLTV_ANCHOR_MS - 7 * DAY_MS) / MINUTE;
  const s = Math.round(shift * 60);
  const out: string[] = [];
  for (let t = first; t < first + 14 * 1440; t += slot) {
    if (t < win.to && t + slot > win.from && t + s < to && t + slot + s > from) out.push(`${t + s}-${t + slot + s}`);
  }
  return out;
}

describe('the grid guide over the 300 MB guide', () => {
  it(`reads a screen's rows over the hours in view, two days and the catch-up days in ≤ ${LIMIT_MS} ms each`, async () => {
    if (!existsSync(guide) || !existsSync(playlist)) throw new Error(`${fixtures} lacks the guide or playlist: run pnpm fixtures (pnpm verify:media does)`);
    const live = await parsePlaylistItems(playlist, 'live');
    expect(live).toHaveLength(20_000);

    const db = await openDatabase(freshFactory());
    const epgSrc = 'fx:tvg0';
    let t = performance.now();
    const gen = await beginEpgGeneration(db, epgSrc, 0);
    const reader = new EpgGuideReader({ epgSrc, wanted: EpgWantedSet.fromItems(live), tier: 'full', nowMs: EPG_BENCH_NOW, languages: ['ar', 'en'] });
    const write = async (list: EpgBucket[]): Promise<void> => {
      for (let i = 0; i < list.length; i += 500) await putEpgBuckets(db, epgSrc, gen, list.slice(i, i + 500));
    };
    const decoder = new TextDecoder();
    for await (const chunk of createReadStream(guide).pipe(createGunzip())) await write(reader.push(decoder.decode(chunk as Uint8Array, { stream: true })));
    await write(reader.push(decoder.decode()));
    await write(reader.end());
    const shifts = new Map(live.map((i) => [i.key, i.tvgShift]));
    const matches = reader.matcher.matches().map((m) => ({ key: m.key, channel: m.channel, method: m.method, ambiguous: m.ambiguous, shift: shifts.get(m.key) ?? 0 }));
    await putEpgChannels(db, epgSrc, gen, { matches, channels: [], unmatched: [] });
    await commitEpgGeneration(db, epgSrc, gen, EPG_BENCH_NOW);
    const storeMs = performance.now() - t;
    const report = reader.report();
    const win = reader.window!;
    expect(report.programmes.kept).toBeGreaterThan(1_000_000);

    const q = new QueryService({ openDb: async () => db, now: () => EPG_BENCH_NOW });
    await q.reload();
    const byKey = new Map(matches.map((m) => [m.key, m]));
    // A run of the playlist's live channels, matched or not, as a category's rows would be.
    const keys = live.slice(GRID_ROWS.at, GRID_ROWS.at + GRID_ROWS.count).map((i) => i.key);
    expect(keys.filter((k) => byKey.has(k)).length).toBeGreaterThan(GRID_ROWS.count / 2);
    expect(keys.some((k) => !byKey.has(k))).toBe(true);

    const times: Record<string, number> = {};
    const nowMin = EPG_BENCH_NOW / MINUTE;
    for (const w of GRID_WINDOWS) {
      const from = nowMin + w.from;
      const to = nowMin + w.to;
      let best = Infinity;
      let rows: GuideRow[] = [];
      for (let r = 0; r < 3; r++) {
        t = performance.now();
        rows = await q.guide({ keys, from, to });
        best = Math.min(best, performance.now() - t);
      }
      times[w.name] = Math.round(best * 10) / 10;
      let programmes = 0;
      rows.forEach((row, i) => {
        const m = byKey.get(keys[i]!);
        expect(row.epgSrc, keys[i]).toBe(m === undefined ? null : epgSrc);
        const want = m === undefined ? [] : generated(m.channel, win, from, to, m.shift);
        expect(row.start.map((s, j) => `${s}-${row.end[j]}`), `${w.name} ${keys[i]}`).toEqual(want);
        expect(row.title.every((x) => x.length > 0)).toBe(true);
        programmes += row.start.length;
      });
      expect(programmes, w.name).toBeGreaterThan(GRID_ROWS.count);
    }
    console.log(`grid guide: stored ${report.programmes.kept} programmes in ${Math.round(storeMs)} ms; windows (ms, best of 3): ${JSON.stringify(times)}`);
    for (const [name, ms] of Object.entries(times)) expect(ms, name).toBeLessThanOrEqual(LIMIT_MS);
    db.close();
  });
});
