// RELAY step 9b: the EPG refresh through the data layer (fake-indexeddb) against the in-process
// mock provider over a real socket, with the real fetch transport. The mock imports nothing from
// core or data, so its programme schedule is an independent oracle. "Done when": a refresh of the
// mock stores exactly the mock's schedule, and now/next comes back from the store (the crash case
// is in packages/data/src/epg-ingest.test.ts).

import type { CatalogItem, EpgBucket } from '@zoma/core';
import { epgProgrammes } from '@zoma/core';
import type { ByteTransport, EpgRefreshJob } from '@zoma/data';
import { QueryService, STORE, epgGuides, fetchTransport, getEpgMeta, getSources, openDatabase, runEpgRefresh, runIngest } from '@zoma/data';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalog, loadServerFixture } from '../apps/mock-provider/src/config';
import { epgWindow as mockWindow, programmes } from '../apps/mock-provider/src/epg';
import type { MockServer } from '../apps/mock-provider/src/server';
import { NOW, P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { dumpStore, freshFactory } from '../packages/data/src/test-support';

const catalog = loadCatalog();
const fixture = loadServerFixture();
const MINUTE = 60_000;
const DAY = 86_400_000;

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
  app.mockState.catalog = catalog;
  db = await openDatabase(freshFactory());
});
afterEach(() => {
  db.close();
});

/** The real fetch transport, with a mock fault added to every request (a whole panel session). */
function transport(fault?: string): ByteTransport {
  const inner = fetchTransport();
  return { get: (url, request) => inner.get(fault === undefined ? url : `${url}&mock_fault=${encodeURIComponent(fault)}`, request) };
}

/** The mock's own schedule per XMLTV id, cut to [from, to). */
function oracle(from = -Infinity, to = Infinity): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of catalog.live) {
    const id = c.xmltvId ?? c.epgId;
    if (id === null || out.has(id)) continue;
    const w = mockWindow(c, NOW, fixture.server.epgFutureDays);
    const list = programmes(c, w.from, w.to).filter((p) => p.stop > from && p.start < to);
    out.set(
      id,
      list.map((p) => `${p.start / MINUTE}-${p.stop / MINUTE} ${p.title} | ${p.description} | ${p.category}`),
    );
  }
  return out;
}

/** What the store holds for a guide's active generation, per XMLTV channel in time order. */
async function storedSchedule(epgSrc: string): Promise<Map<string, string[]>> {
  const gen = (await getEpgMeta(db, epgSrc))!.gen;
  const buckets: EpgBucket[] = [];
  for (const [key, value] of await dumpStore(db, STORE.epgBuckets)) {
    const [src, g, channel, day] = key as [string, number, string, number];
    if (src === epgSrc && g === gen) buckets.push({ channel, day, merge: false, ...(value as Omit<EpgBucket, 'channel' | 'day' | 'merge'>) });
  }
  buckets.sort((a, b) => a.day - b.day);
  const out = new Map<string, string[]>();
  for (const b of buckets) {
    const rows = epgProgrammes(b).map((p) => `${p.start}-${p.end} ${p.title} | ${p.desc} | ${p.category}`);
    out.set(b.channel, [...(out.get(b.channel) ?? []), ...rows]);
  }
  return out;
}

const refresh = (job: EpgRefreshJob, fault?: string) => runEpgRefresh(job, { db, transport: transport(fault), now: () => NOW, flushAt: 50 });

async function liveItems(src: string): Promise<CatalogItem[]> {
  const q = new QueryService({ openDb: async () => db });
  const out: CatalogItem[] = [];
  for (const cat of await q.categories(src, 'live')) for (let n = 0; n < cat.chunks.length; n++) out.push(...(await q.chunk({ src, kind: 'live', catIdx: cat.catIdx, chunk: n })));
  return out;
}

describe('EPG refresh of the mock provider through the data layer', () => {
  it('takes the guide from the M3U header and stores exactly the mock schedule', async () => {
    await runIngest({ src: 'pl', source: { type: 'm3u', url: `${base}/get.php?username=${U}&password=${P}&type=m3u_plus` } }, { db, transport: transport(), now: () => NOW });
    const guides = epgGuides([{ src: 'pl', type: 'm3u' }], await getSources(db));
    expect(guides).toEqual([{ epgSrc: 'pl:tvg0', url: `${base}/xmltv.php?username=${U}&password=${P}`, zone: { minutes: 0 } }]);

    const r = await refresh({ guides, tier: 'full', languages: ['ar', 'en'] });
    expect(r.wanted).toBe(12);
    const result = r.outcomes[0]!.result!;
    expect(result).toMatchObject({ status: 'committed', gen: 1, summary: { wanted: 12, matched: 11, declared: 9, used: 9, pastDays: 7, futureDays: 7 } });
    expect(await storedSchedule('pl:tvg0')).toEqual(oracle());

    // Now and next for every live channel, from the store.
    const items = await liveItems('pl');
    const q = new QueryService({ openDb: async () => db });
    const got = await q.nowNext(items.map((i) => i.key), NOW + 60_000);
    const schedule = oracle();
    for (const [i, it] of items.entries()) {
      const mockChannel = catalog.live.find((c) => c.name === it.name)!;
      const id = mockChannel.xmltvId ?? mockChannel.epgId;
      const nn = got[i]!;
      if (it.name === '18+ Test Pattern') {
        expect(nn).toMatchObject({ epgSrc: null, now: null, next: null });
        continue;
      }
      // "Zoma Sports Test FHD" has no id of its own: it shares zoma.sports by match name.
      const rows = schedule.get(id ?? 'zoma.sports')!;
      const onAir = rows.findIndex((row) => {
        const [span] = row.split(' ');
        const [s, e] = span!.split('-').map(Number);
        return s! * MINUTE <= NOW + 60_000 && NOW + 60_000 < e! * MINUTE;
      });
      expect(`${nn.now!.start}-${nn.now!.end} ${nn.now!.title} | ${nn.now!.desc} | ${nn.now!.category}`, it.name).toBe(rows[onAir]);
      expect(`${nn.next!.start}-${nn.next!.end} ${nn.next!.title} | ${nn.next!.desc} | ${nn.next!.category}`, it.name).toBe(rows[onAir + 1]);
    }
    expect(await q.epgStatus()).toMatchObject({ matched: 11, guides: [{ epgSrc: 'pl:tvg0', gen: 1, summary: { matched: 11 } }] });

    // Nothing changed at the provider: the bytes hash the same, and the stored guide stays.
    const again = await refresh({ guides, tier: 'full', languages: ['ar', 'en'] });
    expect(again.outcomes[0]!.result).toMatchObject({ status: 'unchanged', gen: 1 });
  });

  it('reads a gzipped guide URL the user added, in the low tier', async () => {
    await runIngest({ src: 'pl', source: { type: 'm3u', url: `${base}/get.php?username=${U}&password=${P}&type=m3u_plus` } }, { db, transport: transport(), now: () => NOW });
    const guides = epgGuides([{ src: 'pl', type: 'm3u' }], await getSources(db), [{ id: 'mine', url: `${base}/epg/guide.xml.gz` }]);
    expect(guides.map((g) => g.epgSrc)).toEqual(['u~mine', 'pl:tvg0']);
    const r = await refresh({ guides, only: ['u~mine'], tier: 'low', languages: ['ar', 'en'] });
    expect(r.outcomes[0]!.result).toMatchObject({ status: 'committed', gzipped: true, summary: { matched: 11, pastDays: 2, futureDays: 3 } });
    expect(await storedSchedule('u~mine')).toEqual(oracle(NOW - 2 * DAY, NOW + 3 * DAY));
  });

  it('reads an Xtream panel guide without offsets in the panel zone learnt at login', async () => {
    // Kathmandu is 5:45 east of UTC: a guide read in the wrong zone would be off by that much.
    const fault = 'timezone:tz=Asia/Kathmandu:xmltv=none';
    const account = { base, username: U, password: P };
    await runIngest({ src: 'xt', source: { type: 'xtream', account, kinds: ['live'] } }, { db, transport: transport(fault), now: () => NOW });
    expect((await getSources(db))[0]!.server).toMatchObject({ timezone: 'Asia/Kathmandu' });
    const guides = epgGuides([{ src: 'xt', type: 'xtream', account }], await getSources(db));
    expect(guides).toEqual([{ epgSrc: 'xt:xmltv', url: `${base}/xmltv.php?username=${U}&password=${P}`, zone: { panel: 'xt' } }]);
    const r = await refresh({ guides, tier: 'full', languages: ['ar', 'en'] }, fault);
    expect(r.outcomes[0]!.result).toMatchObject({ status: 'committed', summary: { matched: 11 } });
    expect(await storedSchedule('xt:xmltv')).toEqual(oracle());
  });
});
