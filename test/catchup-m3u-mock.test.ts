// RELAY step 25b: catch-up from an M3U source, below the screens. The mock's get.php playlist is
// ingested as an M3U link (runIngest over a real socket), which logs in to its panel once for the
// zone (ADR-010); the player's `catchupCandidates`, called as the app's `catchupRequest` calls it
// (apps/tv/src/player/catchup.ts: the programme's times as the guide shows them, the source's
// facts as `DataEngine.sourceFacts` reads them), then makes each stored channel's URLs, and the
// mock's X-Mock-Archive-* headers say which window it served. The mock imports nothing from core,
// data or the player, so it is an independent oracle. (The app's module itself can't be imported
// here: its types reach @zoma/ui, which the root typecheck can't read without JSX.)

import type { CatalogItem } from '@zoma/core';
import { panelZone } from '@zoma/core';
import { QueryService, fetchTransport, getSource, openDatabase, runIngest } from '@zoma/data';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LiveChannel } from '../apps/mock-provider/src/config';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { Programme } from '../apps/mock-provider/src/epg';
import { programmes } from '../apps/mock-provider/src/epg';
import { parseScenario } from '../apps/mock-provider/src/faults';
import type { MockServer } from '../apps/mock-provider/src/server';
import { NOW, P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import type { SourceFacts } from '../apps/tv/src/data/engine';
import { freshFactory } from '../packages/data/src/test-support';
import type { PlayCandidate } from '../packages/player/src/request';
import { catchupCandidates } from '../packages/player/src/request';

const catalog = loadCatalog();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let app: MockServer;
let base: string;
let db: IDBDatabase;

beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  db = await openDatabase(freshFactory());
});
afterEach(() => {
  app.mockState.scenario = null;
  db.close();
});

/** A panel in `tz` (XMLTV with offsets), and optionally a panel API that answers 503. */
function panel(tz: string, loginFails = false): void {
  const rules: unknown[] = [{ match: { path: '**' }, faults: [{ type: 'timezone', tz }] }];
  if (loginFails) rules.push({ match: { path: '/player_api.php' }, faults: [{ type: 'status', status: 503 }] });
  app.mockState.scenario = parseScenario({ rules }, `panel-${tz}`);
}

/** The mock's playlist ingested as an M3U link, and the facts the app reads from its record (`DataEngine.sourceFacts`). */
async function ingestLink(output: 'ts' | 'm3u8'): Promise<{ items: CatalogItem[]; facts: SourceFacts }> {
  const url = `${base}/get.php?username=${U}&password=${P}&type=m3u_plus&output=${output}`;
  expect(await runIngest({ src: 'pl', source: { type: 'm3u', url } }, { db, transport: fetchTransport(), now: () => NOW })).toMatchObject({ status: 'committed' });
  const meta = (await getSource(db, 'pl'))!;
  const q = new QueryService({ openDb: async () => db });
  const items: CatalogItem[] = [];
  for (const cat of await q.categories('pl', 'live')) for (let n = 0; n < cat.chunks.length; n++) items.push(...(await q.chunk({ src: 'pl', kind: 'live', catIdx: cat.catIdx, chunk: n })));
  return { items, facts: { outputFormats: meta.outputFormats ?? null, zone: panelZone(meta.server ?? null).offset } };
}

const itemOf = (items: CatalogItem[], id: number): CatalogItem => items.find((i) => new RegExp(`/${id}(?:\\.(?:ts|m3u8)|/mpegts|/index\\.m3u8)$`).test(i.url))!;

/** The URLs `catchupRequest` asks for: the shown times (UTC minutes) as the window, the source's facts. */
function candidates(item: CatalogItem, programme: { start: number; end: number }, facts: SourceFacts): PlayCandidate[] {
  return catchupCandidates(item.url, item.catchup, { startMs: programme.start * MINUTE, endMs: programme.end * MINUTE, nowMs: NOW }, { zone: facts.zone, outputFormats: facts.outputFormats });
}

/** A programme that ended at least an hour ago, started within `ago` of now. */
function pastProgramme(c: LiveChannel, ago: number): Programme {
  return programmes(c, NOW - ago, NOW).find((p) => p.stop <= NOW - HOUR)!;
}

/** The programme as the guide shows it, `offset` minutes on (UTC minutes). */
const shown = (p: Programme, offset = 0) => ({ start: p.start / MINUTE + offset, end: p.stop / MINUTE + offset });

async function archive(url: string): Promise<{ status: number; channel: number; start: number; duration: number }> {
  const res = await fetch(url);
  await res.body?.cancel();
  return {
    status: res.status,
    channel: Number(res.headers.get('x-mock-archive-channel')),
    start: Number(res.headers.get('x-mock-archive-start')),
    duration: Number(res.headers.get('x-mock-archive-duration')),
  };
}

/** `YYYY-MM-DD:HH-MM` of `ms` in a zone `minutes` east of UTC (the /timeshift/ form). */
function wall(ms: number, minutes: number): string {
  const iso = new Date(ms + minutes * MINUTE).toISOString();
  return `${iso.slice(0, 10)}:${iso.slice(11, 13)}-${iso.slice(14, 16)}`;
}

describe("catch-up from an M3U source's stored channels, against the mock (RELAY step 25b)", () => {
  for (const [tz, east] of [
    ['UTC', 0],
    ['Asia/Riyadh', 180],
  ] as const) {
    for (const output of ['ts', 'm3u8'] as const) {
      it(`every mode plays the programme's window, on a ${tz} panel (output=${output})`, async () => {
        panel(tz);
        const { items, facts } = await ingestLink(output);
        // The panel's login: its zone, and the account's formats.
        expect(facts.outputFormats).toEqual(['m3u8', 'ts']);
        expect(facts.zone(NOW)).toBe(east);
        const modes = new Set<string>();
        for (const c of catalog.live.filter((x) => x.archiveDays > 0)) {
          const item = itemOf(items, c.id);
          expect(item.catchup, c.name).toMatchObject({ mode: c.catchup, days: c.archiveDays });
          const p = pastProgramme(c, 3 * HOUR);
          const start = p.start / 1000;
          const length = (p.stop - p.start) / 1000;
          const urls = candidates(item, shown(p), facts);
          // From the programme's start; to its end, or on to now where the mode asks for that.
          const hls = c.catchup === 'flussonic' && output === 'm3u8';
          const duration = c.catchup === 'append' || c.catchup === 'shift' || (c.catchup === 'flussonic' && !hls) ? NOW / 1000 - start : length;
          if (c.catchup === 'xc') {
            // The .ts form, then the .m3u8, with the start in the panel's wall time.
            expect(urls.map((x) => [x.url, x.container])).toEqual([
              [`${base}/timeshift/${U}/${P}/${length / 60}/${wall(p.start, east)}/${c.id}.ts`, 'ts'],
              [`${base}/timeshift/${U}/${P}/${length / 60}/${wall(p.start, east)}/${c.id}.m3u8`, 'hls'],
            ]);
          } else {
            expect(urls, c.name).toHaveLength(1);
          }
          for (const candidate of urls) {
            expect(await archive(candidate.url), `${c.id} ${candidate.url}`).toEqual({ status: 200, channel: c.id, start, duration });
          }
          modes.add(c.catchup!);
        }
        expect([...modes].sort()).toEqual(['append', 'default', 'flussonic', 'shift', 'xc']);
      });
    }
  }

  it("asks for the shown start with a guide's time offset: an hour on with +1:00 (24b)", async () => {
    panel('Asia/Riyadh');
    const { items, facts } = await ingestLink('ts');
    for (const id of [101, 102, 103, 105, 106]) {
      const c = catalog.live.find((x) => x.id === id)!;
      const p = pastProgramme(c, 4 * HOUR);
      const got = await archive(candidates(itemOf(items, id), shown(p, 60), facts)[0]!.url);
      expect([got.status, got.channel, got.start], c.name).toEqual([200, id, p.start / 1000 + 3600]);
    }
  });

  it("keeps UTC when the panel's login fails, so an xc start is read three hours early on a Riyadh panel", async () => {
    panel('Asia/Riyadh', true);
    const { items, facts } = await ingestLink('ts');
    // The playlist still came in, with no panel facts.
    expect(items.length).toBe(catalog.live.length);
    expect([facts.outputFormats, facts.zone(NOW)]).toEqual([null, 0]);
    const c = catalog.live.find((x) => x.id === 112)!;
    const p = pastProgramme(c, 5 * DAY);
    const got = await archive(candidates(itemOf(items, 112), shown(p), facts)[0]!.url);
    expect([got.status, p.start / 1000 - got.start]).toEqual([200, 3 * 3600]);
    // The other modes carry epoch times: no zone to get wrong.
    const d = catalog.live.find((x) => x.id === 102)!;
    const q = pastProgramme(d, 5 * HOUR);
    expect((await archive(candidates(itemOf(items, 102), shown(q), facts)[0]!.url)).start).toBe(q.start / 1000);
  });
});
