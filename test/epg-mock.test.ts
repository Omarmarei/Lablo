// RELAY step 9: core's EPG reader (matching cascade, window, time repair, buckets) against the
// mock provider in-process. The mock imports nothing from core, so its catalog and programme
// schedule are an independent oracle. Root test/ because core and the mock are separate
// boundary elements.

import type { CatalogItem, DeviceTier, EpgBucket, EpgGuideOptions, EpgProgramme, ZoneOffset } from '@lablo/core';
import { EpgGuideReader, EpgWantedSet, M3uCatalogParser, XtreamClient, epgProgrammes, formatEpgReport, mergeEpgBuckets, xtreamM3uUrl } from '@lablo/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalog, loadServerFixture } from '../apps/mock-provider/src/config';
import { epgWindow as mockWindow, programmes } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { NOW, listen, mock } from '../apps/mock-provider/test/helpers';

const catalog = loadCatalog();
const fixture = loadServerFixture();
const MINUTE = 60_000;
const DAY = 86_400_000;

let app: MockServer;
let base: string;

beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
afterAll(async () => {
  await app.close();
});

const account = (): { base: string; username: string; password: string } => ({ base, username: 'lablo', password: 'lablo-test' });
const withFault = (url: string, fault?: string): string => (fault === undefined ? url : `${url}&mock_fault=${encodeURIComponent(fault)}`);

async function liveItems(): Promise<CatalogItem[]> {
  const res = await fetch(xtreamM3uUrl(account(), 'ts'));
  const parser = new M3uCatalogParser('mock');
  const items = [...parser.push(await res.text()), ...parser.end()];
  return items.filter((i) => i.kind === 'live');
}

/** The panel's zone, as an Xtream source learns it at login (under `fault`). */
async function panelZone(fault?: string): Promise<ZoneOffset> {
  const client = new XtreamClient(account(), {
    async get(url) {
      const res = await fetch(withFault(url, fault));
      let body: string | null = await res.text();
      return {
        status: res.status,
        read: async () => {
          const out = body;
          body = null;
          return out;
        },
        cancel: () => undefined,
      };
    },
  }, 'mock');
  await client.login();
  return client.zone().offset;
}

/** Reads the panel's xmltv.php in odd-sized chunks; fragments are merged as the store will. */
async function readGuide(options: Partial<EpgGuideOptions> & { wanted: EpgWantedSet }, fault?: string): Promise<{ reader: EpgGuideReader; rows: Map<string, EpgProgramme[]> }> {
  const res = await fetch(withFault(`${base}/xmltv.php?username=lablo&password=lablo-test`, fault));
  const text = await res.text();
  const reader = new EpgGuideReader({ epgSrc: 'mock', tier: 'full', nowMs: NOW, languages: ['ar', 'en'], flushAt: 50, ...options });
  const merged = new Map<string, EpgBucket>();
  const take = (list: EpgBucket[]): void => {
    for (const b of list) {
      const key = `${b.channel}|${b.day}`;
      const stored = merged.get(key);
      merged.set(key, stored === undefined ? b : mergeEpgBuckets(stored, b));
    }
  };
  for (let i = 0; i < text.length; i += 4093) take(reader.push(text.slice(i, i + 4093)));
  take(reader.end());
  const rows = new Map<string, EpgProgramme[]>();
  for (const key of [...merged.keys()].sort((a, b) => Number(a.split('|')[1]) - Number(b.split('|')[1]))) {
    const channel = key.split('|')[0]!;
    rows.set(channel, [...(rows.get(channel) ?? []), ...epgProgrammes(merged.get(key)!)]);
  }
  return { reader, rows };
}

/**
 * The mock's own schedule per XMLTV id, cut to [from, to) when given. `moved` maps a true
 * programme boundary (epoch ms) to the instant the reader is expected to give it.
 */
function oracle(from = -Infinity, to = Infinity, moved: (id: string, starts: number[]) => Map<number, number> = () => new Map()): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of catalog.live) {
    const id = c.xmltvId ?? c.epgId;
    if (id === null || out.has(id)) continue;
    const w = mockWindow(c, NOW, fixture.server.epgFutureDays);
    const list = programmes(c, w.from, w.to).filter((p) => p.stop > from && p.start < to);
    const move = moved(
      id,
      list.map((p) => p.start),
    );
    const at = (ms: number): number => (move.get(ms) ?? ms) / MINUTE;
    out.set(
      id,
      list.map((p) => `${at(p.start)}-${at(p.stop)} ${p.title} | ${p.description} | ${p.category}`),
    );
  }
  return out;
}

/**
 * New York repeats 01:00-02:00 on 2026-11-01: 05:00-06:00 UTC, then 06:00-07:00 UTC. A guide
 * written in wall time without offsets is repaired from per-channel ordering (ADR-010), which
 * decides every boundary in that hour except a lone one: a channel whose only boundary there
 * falls in the second pass (90-minute slots: 04:30, 06:00, 07:30 UTC) reads the same with either
 * instant, and the earlier one is taken, an hour early.
 */
const FIRST_PASS = Date.UTC(2026, 10, 1, 5);
const SECOND_PASS = Date.UTC(2026, 10, 1, 6);
const AFTER = Date.UTC(2026, 10, 1, 7);
function loneSecondPass(_id: string, starts: number[]): Map<number, number> {
  const inHour = starts.filter((ms) => ms >= FIRST_PASS && ms < AFTER);
  const lone = inHour.length === 1 && inHour[0]! >= SECOND_PASS ? inHour[0]! : null;
  return lone === null ? new Map() : new Map([[lone, lone - 3_600_000]]);
}

const show = (rows: Map<string, EpgProgramme[]>): Map<string, string[]> =>
  new Map([...rows].map(([id, list]) => [id, list.map((p) => `${p.start}-${p.end} ${p.title} | ${p.desc} | ${p.category}`)]));

describe('EPG against the mock provider', () => {
  it('matches every live channel it can, by id and by match name, and reports the rest', async () => {
    const live = await liveItems();
    expect(live).toHaveLength(catalog.live.length);
    const { reader } = await readGuide({ wanted: EpgWantedSet.fromItems(live) });
    const r = reader.report();
    // 10 channels carry an EPG id (Lablo.Kids only case-insensitively); "Lablo Sports Test FHD"
    // has none but shares the match name of "Lablo Sports Test HD"; "18+ Test Pattern" has nothing.
    expect(r.match).toMatchObject({ wanted: 12, matched: 11, byMethod: { id: 10, 'match-name': 1, name: 0 }, declared: 9, used: 9, ambiguous: 0 });
    expect(r.unmatched.map((u) => u.name)).toEqual(['18+ Test Pattern']);
    const methods = Object.fromEntries(reader.matcher.matches().map((m) => [live.find((i) => i.key === m.key)!.name, `${m.channel} ${m.method}`]));
    expect(methods).toMatchObject({ 'Lablo Kids Test': 'lablo.kids id', 'Lablo Sports Test FHD': 'lablo.sports match-name', 'Lablo Sports Test HD': 'lablo.sports id' });
    expect(formatEpgReport(r)).toContain('EPG source mock: 11 of 12 live channels matched (91.7%)');
  });

  it('keeps exactly the mock schedule, as UTC minutes, in the full-tier window', async () => {
    const { reader, rows } = await readGuide({ wanted: EpgWantedSet.fromItems(await liveItems()) });
    expect(show(rows)).toEqual(oracle());
    expect(reader.window).toMatchObject({ pastDays: 7, futureDays: 7 });
    expect(reader.stats).toMatchObject({ outOfWindow: 0, invalidTime: 0, repaired: 0, stopGuessed: 0 });
    expect(reader.stats.fragments).toBeGreaterThan(0);
  });

  it('cuts the low-tier window: 2 past days at most, 3 future days', async () => {
    const { reader, rows } = await readGuide({ wanted: EpgWantedSet.fromItems(await liveItems()), tier: 'low' as DeviceTier });
    expect(show(rows)).toEqual(oracle((NOW - 2 * DAY) / MINUTE * MINUTE, NOW + 3 * DAY));
    expect(reader.stats.outOfWindow).toBeGreaterThan(0);
  });

  it.each([
    ['local offsets', 'timezone:tz=America/New_York:xmltv=local'],
    ['no offsets, no DST', 'timezone:tz=Asia/Kathmandu:xmltv=none'],
  ])('gives the same buckets from a guide written with %s', async (_label, fault) => {
    const wanted = EpgWantedSet.fromItems(await liveItems());
    const { reader, rows } = await readGuide({ wanted, fallback: await panelZone(fault) }, fault);
    expect(show(rows)).toEqual(oracle());
    expect(reader.stats.repaired).toBe(0);
  });

  it('repairs the repeated DST hour of a guide without offsets from per-channel ordering', async () => {
    const fault = 'timezone:tz=America/New_York:xmltv=none';
    const wanted = EpgWantedSet.fromItems(await liveItems());
    const { reader, rows } = await readGuide({ wanted, fallback: await panelZone(fault) }, fault);
    const expected = oracle(-Infinity, Infinity, loneSecondPass);
    expect(show(rows)).toEqual(expected);
    // Repairs happened, and only the lone boundary of the 90-minute channel stays an hour early.
    expect(reader.stats.repaired).toBeGreaterThan(0);
    const exact = oracle();
    expect([...expected.keys()].filter((id) => JSON.stringify(expected.get(id)) !== JSON.stringify(exact.get(id)))).toEqual(['lablo.ar3']);
    // Without the repair, every channel with a boundary in the second pass would be off.
    const unrepaired = await readGuide({ wanted, fallback: -240 }, fault);
    expect(show(unrepaired.rows)).not.toEqual(expected);
  });
});
