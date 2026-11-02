// RELAY step 9 "Done when", at full scale: the 300 MB guide (`pnpm fixtures`) read against the
// 200k playlist's live channels, as the TV reads it (core's EpgGuideReader), checked against an
// oracle built from the fixture's own catalog.json and generator constants:
// - `pnpm epg:report` in a child Node with a 96 MB heap: the worst case (every guide channel
//   matched, the full tier's 7 + 7 days kept) fits, and every number of the report is exact;
// - S6's scenario in-process: the low tier with every tenth live channel.
// Timing is `pnpm bench epg-ingest-*` (limits in tools/bench/src/suites.ts, architecture.md §1.5).
// Runs in `pnpm test:media` (CI job `media`).

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { EPG_WINDOWS } from '@zoma/core';
import type { EpgSourceReport } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import { EPG_BENCH_NOW, epgWanted, readEpgStream } from '../tools/bench/src/suites';
import { EPG_CHANNELS } from '../tools/fixtures/src/catalog';
import { XMLTV_ANCHOR_MS, channelProgrammes, slotOf } from '../tools/fixtures/src/xmltv';

const root = join(import.meta.dirname, '..');
const fixtures = process.env['ZOMA_FIXTURES_DIR'] ?? join(root, '.cache', 'fixtures');
const guide = join(fixtures, 'xmltv-300mb.xml.gz');
const playlist = join(fixtures, 'playlist.m3u');
const MINUTE = 60_000;
const DAY = 86_400_000;
/** The heap the worst case must fit in (architecture.md §1.5 step 10). */
const HEAP_MB = 96;

interface LiveEntry {
  epg_id?: string;
  archive_days?: number;
}

/** catalog.json's live channels, in playlist order (the independent oracle). */
function catalogLive(): LiveEntry[] {
  if (!existsSync(guide) || !existsSync(playlist)) throw new Error(`${fixtures} lacks the guide or playlist: run pnpm fixtures (pnpm verify:media does)`);
  return (JSON.parse(readFileSync(join(fixtures, 'catalog.json'), 'utf8')) as { live: LiveEntry[] }).live;
}

/** The guide channel an id names (`epg{k}.zoma.test`, any case), or -1. */
function guideChannel(id: string | undefined): number {
  const m = /^epg(\d+)\.zoma\.test$/i.exec(id ?? '');
  return m && Number(m[1]) < EPG_CHANNELS ? Number(m[1]) : -1;
}

/** What a wanted set of live channels should match, and the programmes kept in [from, to). */
function expected(live: LiveEntry[], window: (maxCatchupDays: number) => { from: number; to: number }) {
  const used = new Set<number>();
  let matched = 0;
  let maxCatchup = 0;
  for (const l of live) {
    const k = guideChannel(l.epg_id);
    if (k < 0) continue;
    matched++;
    used.add(k);
    maxCatchup = Math.max(maxCatchup, l.archive_days ?? 0);
  }
  const { from, to } = window(maxCatchup);
  const first = XMLTV_ANCHOR_MS - 7 * DAY;
  let kept = 0;
  let skipped = 0;
  for (let k = 0; k < EPG_CHANNELS; k++) {
    const n = channelProgrammes(k);
    if (!used.has(k)) {
      skipped += n;
      continue;
    }
    const slot = slotOf(k) * MINUTE;
    for (let j = 0; j < n; j++) if (first + j * slot < to && first + (j + 1) * slot > from) kept++;
  }
  return { matched, used: used.size, kept, skipped, maxCatchup };
}

describe('EPG over the 300 MB guide', () => {
  it(`reports every number exactly for the worst case, in a ${HEAP_MB} MB heap`, async () => {
    const live = catalogLive();
    const want = expected(live, () => ({ from: -Infinity, to: Infinity }));
    const dir = mkdtempSync(join(tmpdir(), 'zoma-epg-'));
    try {
      const json = join(dir, 'report.json');
      const args = [`--max-old-space-size=${HEAP_MB}`, '--import', 'tsx', 'tools/bench/epg-report.ts'];
      args.push('--playlist', playlist, '--xmltv', guide, '--tier', 'full', '--now', new Date(EPG_BENCH_NOW).toISOString(), '--unmatched', '0', '--json', json);
      const { stdout } = await promisify(execFile)(process.execPath, args, { cwd: root, maxBuffer: 1 << 24 });
      expect(stdout).toContain(`EPG source guide1: ${want.matched} of ${live.length} live channels matched`);
      const out = JSON.parse(readFileSync(json, 'utf8')) as { live: number; matched: number; guides: (EpgSourceReport & { ms: number })[] };
      const r = out.guides[0]!;
      expect(out).toMatchObject({ live: live.length, matched: want.matched });
      expect(r.match).toEqual({
        wanted: live.length,
        matched: want.matched,
        byMethod: { override: 0, id: want.matched, 'xtream-id': 0, name: 0, 'match-name': 0 },
        ambiguous: 0,
        declared: EPG_CHANNELS,
        used: want.used,
      });
      expect(r.unmatched).toHaveLength(live.length - want.matched);
      expect(r.window).toMatchObject({ pastDays: 7, futureDays: 7 });
      expect(r.programmes).toMatchObject({ programmes: want.kept, kept: want.kept, outOfWindow: 0, invalidTime: 0, repaired: 0, orphansDropped: 0, fragments: 0 });
      expect(r.xmltv).toMatchObject({ filtered: want.skipped, malformed: 0, truncated: false, lateChannels: 0 });
      // One bucket per used channel per UTC day it has starts on (the guide spans 14 days, anchored at midnight).
      expect(r.programmes.buckets).toBeGreaterThanOrEqual(want.used * 14);
      expect(r.programmes.buckets).toBeLessThanOrEqual(want.used * 15);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it("keeps S6's case exact: the low tier with every tenth live channel", async () => {
    const live = catalogLive().filter((_, i) => i % 10 === 0);
    const low = EPG_WINDOWS.low;
    const want = expected(live, (catchup) => {
      const past = Math.min(low.maxPastDays, Math.max(low.minPastDays, catchup));
      return { from: EPG_BENCH_NOW - past * DAY, to: EPG_BENCH_NOW + low.futureDays * DAY };
    });
    const r = await readEpgStream(createReadStream(guide).pipe(createGunzip()), (await epgWanted(guide)).tenth, 'low');
    expect(r.match).toMatchObject({ wanted: live.length, matched: want.matched, used: want.used, byMethod: { id: want.matched } });
    expect(r.programmes.kept).toBe(want.kept);
    expect(r.xmltv.filtered).toBe(want.skipped);
    expect(r.window).toMatchObject({ pastDays: Math.min(2, Math.max(1, want.maxCatchup)), futureDays: 3, descLimit: 300 });
    // Over 90% of the guide is skipped before it is tokenized (architecture.md §1.5 step 5).
    expect(r.xmltv.filtered / (r.xmltv.filtered + r.programmes.programmes)).toBeGreaterThan(0.85);
  }, 300_000);
});
