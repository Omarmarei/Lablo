// The throttled e2e run (RELAY step 14b) checks a row's now and next programme from the guide that
// e2e/big-catalog.ts writes at the start of the run. On CI the run once started at 23:59:50 UTC,
// a few seconds before a 2-hour slot ended, and lost its next programme at midnight: the guide must
// cover the whole run (the test's 5-minute timeout) wherever on the clock it starts.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bigCatalog, writeBigGuide } from '../e2e/big-catalog';

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
