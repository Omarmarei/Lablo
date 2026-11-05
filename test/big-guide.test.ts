// The throttled e2e run (RELAY step 14b) checks a row's now and next programme from the guide that
// e2e/big-catalog.ts writes at the start of the run. On CI the run once started at 23:59:50 UTC,
// a few seconds before a 2-hour slot ended, and lost its next programme at midnight: the guide must
// cover the whole run (the test's 5-minute timeout) wherever on the clock it starts.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DENSE_MINUTES, bigCatalog, denseProgrammes, gridGuide, writeBigGuide } from '../e2e/big-catalog';
import { epgWindow } from '../packages/core/src/epg-guide';

/** `20261104000000` (XMLTV, UTC) in ms. */
function xmltvMs(stamp: string): number {
  const n = (from: number, to: number): number => Number(stamp.slice(from, to));
  return Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(8, 10), n(10, 12), n(12, 14));
}

/** One channel's programmes in the guide file: `[start, stop]` in ms, in order. */
function programmes(xml: string, channel: string): Array<[number, number]> {
  return xml
    .split('\n')
    .filter((line) => line.startsWith('<programme ') && line.includes(`channel="${channel}"`))
    .map((line) => {
      const m = /start="(\d{14}) \+0000" stop="(\d{14}) \+0000"/.exec(line);
      return [xmltvMs(m![1]!), xmltvMs(m![2]!)] as [number, number];
    });
}

/** Every channel's programmes in the guide file, read in one pass. */
function byChannel(xml: string): Map<string, Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  for (const line of xml.split('\n')) {
    const m = /^<programme start="(\d{14}) \+0000" stop="(\d{14}) \+0000" channel="([^"]+)"/.exec(line);
    if (m === null) continue;
    const list = out.get(m[3]!) ?? [];
    list.push([xmltvMs(m[1]!), xmltvMs(m[2]!)]);
    out.set(m[3]!, list);
  }
  return out;
}

describe('the big catalog guide of the throttled run', () => {
  const RUN_MS = 300_000;
  const catalog = bigCatalog({ channels: 30, categories: 3 });
  const dir = mkdtempSync(path.join(tmpdir(), 'zoma-big-guide-'));

  it.each([
    ['a few seconds before a slot ends (CI, 2026-11-03 23:59:50 UTC)', Date.UTC(2026, 10, 3, 23, 59, 50)],
    ['as a slot starts', Date.UTC(2026, 10, 4, 12, 0, 0)],
    ['inside a slot', Date.UTC(2026, 10, 4, 13, 17, 0)],
  ])('has a programme on and a next one for the whole run, started %s', (_when, start) => {
    const file = path.join(dir, `guide-${start}.xml`);
    writeBigGuide(catalog, start, file);
    const xml = readFileSync(file, 'utf8');
    const guided = catalog.live.filter((c) => c.epgId !== null);
    expect(guided.length).toBeGreaterThan(0);
    for (const channel of guided) {
      const slots = programmes(xml, channel.epgId!);
      for (const at of [start, start + RUN_MS]) {
        const on = slots.findIndex(([from, to]) => from <= at && at < to);
        expect(on, `${channel.epgId!} at ${new Date(at).toISOString()}`).toBeGreaterThanOrEqual(0);
        expect(slots[on + 1], `${channel.epgId!}: a next programme at ${new Date(at).toISOString()}`).toBeDefined();
      }
    }
  });
});

describe("the dense guide of the grid's throttled run (step 23d)", () => {
  const catalog = bigCatalog({ channels: 300, categories: 3 });
  const dir = mkdtempSync(path.join(tmpdir(), 'zoma-grid-guide-'));
  const MINUTE_MS = 60_000;

  it.each([
    ['at midnight UTC', Date.UTC(2026, 10, 5, 0, 0, 0)],
    ['in the evening', Date.UTC(2026, 10, 5, 19, 47, 13)],
  ])('gives the first 200 rows programmes back to back over the full tier EPG window, started %s', (_when, now) => {
    const dense = gridGuide(now);
    expect(dense.channels).toBe(200);
    const file = path.join(dir, `grid-${now}.xml`);
    writeBigGuide(catalog, now, file, dense);
    const guide = byChannel(readFileSync(file, 'utf8'));
    // What the full tier's store keeps (a day back, 7 on), in ms.
    const window = epgWindow(now, 'full', 0);
    const lengths = new Set<number>();
    for (let j = 0; j < catalog.live.length; j += 1) {
      const channel = catalog.live[j]!;
      if (channel.epgId === null) {
        expect(guide.has(`big${j + 1}.zoma`)).toBe(false);
        continue;
      }
      const slots = guide.get(channel.epgId) ?? [];
      if (j >= dense.channels) {
        expect(slots, channel.epgId).toHaveLength(4);
        continue;
      }
      expect(slots[0]![0]).toBeLessThanOrEqual(window.from * MINUTE_MS);
      expect(slots[0]![0]).toBeGreaterThan(dense.fromMs - 35 * MINUTE_MS);
      expect(slots[slots.length - 1]![1]).toBeGreaterThanOrEqual(window.to * MINUTE_MS);
      for (let i = 0; i < slots.length; i += 1) {
        const [start, stop] = slots[i]!;
        lengths.add((stop - start) / MINUTE_MS);
        if (i > 0) expect(start, `${channel.epgId} ${i}`).toBe(slots[i - 1]![1]);
      }
      // A TV channel's density: about 33 programmes a day.
      expect(slots.length / ((dense.toMs - dense.fromMs) / 86_400_000)).toBeGreaterThan(30);
    }
    expect([...lengths].sort((a, b) => a - b)).toEqual([...new Set(DENSE_MINUTES)].sort((a, b) => a - b));
  });

  it("draws neighbouring rows' programmes at different times, some across midnight", () => {
    const now = Date.UTC(2026, 10, 5, 12, 0, 0);
    const { fromMs, toMs } = gridGuide(now);
    // The first programme to start after now, on each of 9 rows.
    const next = new Set<number>();
    let acrossMidnight = 0;
    for (let id = 100_000; id < 100_009; id += 1) {
      const rows = denseProgrammes(id, fromMs, toMs);
      next.add(rows.find((p) => p.start > now)!.start);
      acrossMidnight += rows.filter((p) => Math.floor(p.start / 86_400_000) !== Math.floor((p.stop - 1) / 86_400_000)).length;
    }
    expect(next.size).toBeGreaterThanOrEqual(5);
    expect(acrossMidnight).toBeGreaterThan(0);
  });
});
