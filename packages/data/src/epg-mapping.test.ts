// Manual EPG mapping, the data (RELAY step 24d): the mappings kept in the profile are read by the
// EPG refresh, honoured by the matcher, and seen through the query worker after the refresh (now/
// next, the grid's rows); every declared channel of each guide is stored and can be searched.

import type { CatalogItem } from '@lablo/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EpgIngestOptions, EpgRefreshJob } from './epg-ingest';
import { EPG_INGEST_VERSION, runEpgRefresh } from './epg-ingest';
import { epgMappingKey } from './epg-overrides';
import type { EpgGuide } from './epg-sources';
import { epgRefreshDue } from './epg-sources';
import { getEpgMeta, readEpgDeclared } from './epg-store';
import { openDatabase } from './idb';
import type { EpgPin } from './epg-overrides';
import { readEpgOverrides } from './profile';
import { QueryService } from './query-service';
import type { FakeResponse } from './test-support';
import { fakeTransport, freshFactory, ingest, item } from './test-support';

const NOW = Date.UTC(2026, 10, 2, 12);
const MIN = 60_000;
const HOUR = 3_600_000;
const NOW_MIN = NOW / MIN;
const pad = (n: number): string => String(n).padStart(2, '0');
const time = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`;
};

/**
 * A guide declaring `channels` (id, then display names), each with hourly programmes from a day
 * before NOW to a day after, titled `<id> <UTC hour>`.
 */
function guideXml(channels: [string, ...string[]][]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>'];
  for (const [id, ...names] of channels) lines.push(`<channel id="${id}">${names.map((n) => `<display-name>${n}</display-name>`).join('')}</channel>`);
  for (const [id] of channels) {
    for (let ms = NOW - 24 * HOUR; ms < NOW + 24 * HOUR; ms += HOUR) {
      lines.push(`<programme start="${time(ms)}" stop="${time(ms + HOUR)}" channel="${id}"><title>${id} ${new Date(ms).getUTCHours()}</title></programme>`);
    }
  }
  lines.push('</tv>', '');
  return lines.join('\n');
}

/** Alpha and Bravo match by id (an Xtream source's: `xtream-id`), Charlie by name; Lost matches nothing. */
const CHANNELS: [string, ...string[]][] = [
  ['a.tv', 'Alpha Channel'],
  ['b.tv', 'Bravo'],
  ['c.tv', 'Charlie TV', 'Charlie'],
  ['z.tv', 'Zulu News', 'Zoulou'],
  ['y.tv'],
];

const live = (id: number, name: string, epgId: string | null): CatalogItem => ({ ...item('tv', 'live', id, name), epgId });
const KEY = { alpha: 'x:tv:live:1', bravo: 'x:tv:live:2', charlie: 'x:tv:live:3', lost: 'x:tv:live:4' } as const;

const G: EpgGuide = { epgSrc: 'u~g1', url: 'http://g.test/one.xml', zone: { minutes: 0 } };
const H: EpgGuide = { epgSrc: 'u~g2', url: 'http://g.test/two.xml', zone: { minutes: 0 } };

let db: IDBDatabase;
let q: QueryService;
beforeEach(async () => {
  db = await openDatabase(freshFactory());
  await ingest(db, 'tv', [live(1, 'Alpha', 'a.tv'), live(2, 'Bravo', 'b.tv'), live(3, 'Charlie', null), live(4, 'Lost', 'lost.tv'), item('tv', 'movie', 9, 'A Film')]);
  q = new QueryService({ openDb: async () => db, now: () => NOW });
});
afterEach(() => {
  db.close();
});

/** One refresh of `guides`, each answered by `bodies[epgSrc]`, then the query worker reloads. */
async function refresh(bodies: Record<string, () => FakeResponse>, job: Partial<EpgRefreshJob> = {}, options: Partial<EpgIngestOptions> = {}) {
  const transport = fakeTransport((url, headers) => {
    for (const g of [G, H]) if (g.url === url) return bodies[g.epgSrc]!();
    throw new Error(`asked ${url} ${JSON.stringify(headers)}`);
  });
  const result = await runEpgRefresh({ guides: [G], tier: 'full', languages: ['en'], ...job }, { db, transport, now: () => NOW, ...options });
  await q.reload();
  return { transport, result };
}

const pin = (key: string, to: EpgPin | null): Promise<boolean> => q.editProfile({ kind: 'epgOverride', key, pin: to });

/** Each key's programme on air now, as `<epgSrc> <channel> <method>: <title>`. */
async function onAir(...keys: string[]): Promise<string[]> {
  return (await q.nowNext(keys)).map((n) => (n.epgSrc === null ? 'none' : `${n.epgSrc} ${n.channel} ${n.method}: ${n.now?.title ?? '-'}`));
}

/** Each key's grid row over the hour before and after now, as its titles. */
async function rows(...keys: string[]): Promise<string[][]> {
  return (await q.guide({ keys, from: NOW_MIN - 60, to: NOW_MIN + 60 })).map((r) => r.title);
}

describe("a guide's declared channels (step 24d)", () => {
  it('stores every channel the guide declares, used or not, in its order', async () => {
    const { result } = await refresh({ [G.epgSrc]: () => ({ body: guideXml(CHANNELS) }) });
    expect(result.outcomes[0]!.result?.summary).toMatchObject({ declared: 5, used: 3, matched: 3 });
    const declared = await readEpgDeclared(db, G.epgSrc, 1);
    expect(declared?.ids).toEqual(['a.tv', 'b.tv', 'c.tv', 'z.tv', 'y.tv']);
    expect(declared?.names).toEqual(['Alpha Channel', 'Bravo', 'Charlie TV', 'Zulu News', 'y.tv']);
    expect((await q.guideChannels({ query: 'zoulou', offset: 0, limit: 10 })).rows).toEqual([{ epgSrc: G.epgSrc, id: 'z.tv', name: 'Zulu News' }]);
    expect((await q.guideChannels({ query: '', offset: 0, limit: 10 })).count).toBe(5);
  });
});

describe('manual mappings, honoured after a refresh (step 24d)', () => {
  it("gives a channel mapped to a guide's channel that channel's now/next and grid row, and one mapped to no guide none", async () => {
    await refresh({ [G.epgSrc]: () => ({ body: guideXml(CHANNELS) }) });
    expect(await onAir(KEY.alpha, KEY.bravo, KEY.charlie, KEY.lost)).toEqual(['u~g1 a.tv xtream-id: a.tv 12', 'u~g1 b.tv xtream-id: b.tv 12', 'u~g1 c.tv name: c.tv 12', 'none']);

    // Lost to the channel nothing used, Bravo to Charlie's, Alpha to no guide.
    expect(await pin(KEY.lost, { epgSrc: G.epgSrc, channel: 'z.tv' })).toBe(true);
    expect(await pin(KEY.bravo, { epgSrc: G.epgSrc, channel: 'C.TV' })).toBe(true);
    expect(await pin(KEY.alpha, { epgSrc: G.epgSrc, channel: null })).toBe(true);
    // Nothing changes until the guide is read again.
    expect(await onAir(KEY.alpha, KEY.bravo, KEY.lost)).toEqual(['u~g1 a.tv xtream-id: a.tv 12', 'u~g1 b.tv xtream-id: b.tv 12', 'none']);

    const { transport, result } = await refresh({ [G.epgSrc]: () => ({ body: guideXml(CHANNELS) }) });
    expect(transport.requests).toHaveLength(1);
    expect(result.outcomes[0]!.result).toMatchObject({ status: 'committed', gen: 2 });
    expect(result.outcomes[0]!.result!.summary).toMatchObject({ matched: 3, byMethod: { override: 2, 'xtream-id': 0, name: 1 } });
    expect(await onAir(KEY.alpha, KEY.bravo, KEY.charlie, KEY.lost)).toEqual(['none', 'u~g1 c.tv override: c.tv 12', 'u~g1 c.tv name: c.tv 12', 'u~g1 z.tv override: z.tv 12']);
    expect(await rows(KEY.alpha, KEY.bravo, KEY.lost)).toEqual([[], ['c.tv 11', 'c.tv 12'], ['z.tv 11', 'z.tv 12']]);

    // Taken away: matched as the guide says again, after the next refresh.
    expect(await pin(KEY.alpha, null)).toBe(true);
    await refresh({ [G.epgSrc]: () => ({ body: guideXml(CHANNELS) }) });
    expect(await onAir(KEY.alpha)).toEqual(['u~g1 a.tv xtream-id: a.tv 12']);
  });

  it('reads the profile at each refresh; a job that names mappings uses those instead', async () => {
    await pin(KEY.lost, { epgSrc: G.epgSrc, channel: 'y.tv' });
    await refresh({ [G.epgSrc]: () => ({ body: guideXml(CHANNELS) }) }, { overrides: [{ key: KEY.lost, epgSrc: G.epgSrc, channel: 'z.tv' }] });
    expect(await onAir(KEY.lost)).toEqual(['u~g1 z.tv override: z.tv 12']);
    await refresh({ [G.epgSrc]: () => ({ body: guideXml(CHANNELS) }) }, { overrides: [] });
    expect(await onAir(KEY.lost)).toEqual(['none']);
    await refresh({ [G.epgSrc]: () => ({ body: guideXml(CHANNELS) }) });
    expect(await onAir(KEY.lost)).toEqual(['u~g1 y.tv override: y.tv 12']);
  });

  it('pins a channel to one guide: another guide can no longer match it', async () => {
    const other: [string, ...string[]][] = [['b.tv', 'Bravo'], ['q.tv', 'Quebec']];
    const bodies = { [G.epgSrc]: () => ({ body: guideXml(CHANNELS) }), [H.epgSrc]: () => ({ body: guideXml(other) }) };
    await refresh(bodies, { guides: [G, H] });
    expect(await onAir(KEY.bravo)).toEqual(['u~g1 b.tv xtream-id: b.tv 12']);
    await pin(KEY.bravo, { epgSrc: H.epgSrc, channel: 'q.tv' });
    await refresh(bodies, { guides: [G, H] });
    expect(await onAir(KEY.bravo)).toEqual(['u~g2 q.tv override: q.tv 12']);
    // Mapped to the second guide's own b.tv: the first one's (listed first) doesn't win any more.
    await pin(KEY.bravo, { epgSrc: H.epgSrc, channel: 'b.tv' });
    await refresh(bodies, { guides: [G, H] });
    expect(await onAir(KEY.bravo)).toEqual(['u~g2 b.tv override: b.tv 12']);
  });

  it("leaves a channel without a guide when a newer guide no longer declares the one it is mapped to, and keeps the mapping", async () => {
    let body = guideXml(CHANNELS);
    await pin(KEY.bravo, { epgSrc: G.epgSrc, channel: 'z.tv' });
    await refresh({ [G.epgSrc]: () => ({ body }) });
    expect(await onAir(KEY.bravo)).toEqual(['u~g1 z.tv override: z.tv 12']);

    // The guide drops z.tv; Bravo's own b.tv is still there, but the mapping holds.
    body = guideXml(CHANNELS.filter(([id]) => id !== 'z.tv'));
    const { result } = await refresh({ [G.epgSrc]: () => ({ body }) });
    expect(result.outcomes[0]!.result).toMatchObject({ status: 'committed', gen: 2 });
    expect(await onAir(KEY.bravo)).toEqual(['none']);
    expect(await rows(KEY.bravo)).toEqual([[]]);
    expect(result.outcomes[0]!.result!.summary).toMatchObject({ wanted: 4, matched: 2, declared: 4 });
    // It is listed as without a guide (step 24c), and found again once the guide declares it again.
    expect((await q.unmatched({ sources: ['tv'], offset: 0, limit: 10 })).rows.map((r) => r.key)).toEqual([KEY.bravo, KEY.lost]);
    expect(await readEpgOverrides(db)).toEqual([{ key: KEY.bravo, epgSrc: G.epgSrc, channel: 'z.tv' }]);
    body = guideXml(CHANNELS);
    await refresh({ [G.epgSrc]: () => ({ body }) });
    expect(await onAir(KEY.bravo)).toEqual(['u~g1 z.tv override: z.tv 12']);
  });
});

describe('a refresh after the mappings changed (step 24d)', () => {
  it('reads an unchanged guide again, stores the mappings it was matched with, and makes it due until then', async () => {
    const body = guideXml(CHANNELS);
    // The server answers 304 to a conditional request.
    const server = (): (() => FakeResponse) => () => ({ body, headers: { etag: '"v1"' } });
    const conditional = (headers: Record<string, string>): FakeResponse => (headers['If-None-Match'] === '"v1"' ? { status: 304 } : { body, headers: { etag: '"v1"' } });
    const transport = fakeTransport((_url, headers) => conditional(headers));
    const run = () => runEpgRefresh({ guides: [G], tier: 'full', languages: ['en'] }, { db, transport, now: () => NOW });

    await refresh({ [G.epgSrc]: server() });
    expect(await getEpgMeta(db, G.epgSrc)).toMatchObject({ gen: 1, mapping: '-', basis: `v${EPG_INGEST_VERSION}|full|tv:1|-` });
    expect(EPG_INGEST_VERSION).toBe(2);
    expect((await run()).outcomes[0]!.result!.status).toBe('unchanged');
    expect(transport.requests.at(-1)!.headers).toEqual({ 'If-None-Match': '"v1"' });

    await pin(KEY.lost, { epgSrc: G.epgSrc, channel: 'z.tv' });
    const status = await q.epgStatus();
    const key = epgMappingKey([{ key: KEY.lost, epgSrc: G.epgSrc, channel: 'z.tv' }]);
    expect(status.mapping).toBe(key);
    expect(epgRefreshDue(status.guides[0], NOW, status.mapping)).toBe('mapping');

    // Read again with no validator, though the server would have said 304.
    const again = await run();
    expect(transport.requests.at(-1)!.headers).toEqual({});
    expect(again.outcomes[0]!.result).toMatchObject({ status: 'committed', gen: 2 });
    const meta = await getEpgMeta(db, G.epgSrc);
    expect(meta).toMatchObject({ gen: 2, mapping: key, basis: `v${EPG_INGEST_VERSION}|full|tv:1|${key}` });
    const after = await q.epgStatus();
    expect(after.mapping).toBe(key);
    expect(epgRefreshDue(after.guides[0], NOW, after.mapping)).toBeNull();
    // And it is conditional again.
    expect((await run()).outcomes[0]!.result!.status).toBe('unchanged');
    expect(transport.requests.at(-1)!.headers).toEqual({ 'If-None-Match': '"v1"' });
  });

  it('epgStatus gives the mappings of the profile now, NO_MAPPING without any', async () => {
    expect((await q.epgStatus()).mapping).toBe('-');
    await pin(KEY.lost, { epgSrc: '', channel: null });
    expect((await q.epgStatus()).mapping).toBe(epgMappingKey([{ key: KEY.lost, epgSrc: '', channel: null }]));
    await pin(KEY.lost, null);
    expect((await q.epgStatus()).mapping).toBe('-');
  });
});
