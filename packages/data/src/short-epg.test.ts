import type { CatalogItem, XtreamAccount } from '@zoma/core';
import { EPG_FLAG_STOP_GUESSED, XtreamError } from '@zoma/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NetworkError } from './bytes';
import { runEpgRefresh } from './epg-ingest';
import { openDatabase } from './idb';
import { QueryService } from './query-service';
import type { ShortEpgSource } from './short-epg';
import { SHORT_EPG_LIMIT, SHORT_EPG_TTL_MS, ShortEpgCache, shortEpgNowNext, shortEpgTarget } from './short-epg';
import type { FakeResponse } from './test-support';
import { fakeTransport, freshFactory, ingest, item } from './test-support';

const NOW = Date.UTC(2026, 10, 2, 12, 10);
const MIN = 60_000;
const account: XtreamAccount = { base: 'http://p.test', username: 'u', password: 'secret-pw' };
const XTREAM: ShortEpgSource = { type: 'xtream', account };
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** A panel's `get_short_epg` answer: `count` slots of `slot` minutes from the one on air at `at`. */
function listings(at: number, count = SHORT_EPG_LIMIT, slot = 30, title = 'Show'): string {
  const first = Math.floor(at / (slot * MIN)) * slot * MIN;
  const list = Array.from({ length: count }, (_, i) => {
    const start = first + i * slot * MIN;
    return { title: b64(`${title} ${i}`), description: b64(`About ${title} ${i}`), start_timestamp: String(start / 1000), stop_timestamp: String((start + slot * MIN) / 1000) };
  });
  return JSON.stringify({ epg_listings: list });
}

const shortEpgUrl = (streamId: string, base = 'http://p.test', password = 'secret-pw'): string =>
  `${base}/player_api.php?username=u&password=${password}&action=get_short_epg&stream_id=${streamId}&limit=${SHORT_EPG_LIMIT}`;

describe('shortEpgTarget', () => {
  it('takes the stream id from the channel URL and the account from its source', () => {
    expect(shortEpgTarget('http://p.test/live/u/secret-pw/101.ts', XTREAM)).toEqual({ account, streamId: '101' });
    // A load-balanced stream URL: the request still goes to the panel the user added.
    expect(shortEpgTarget('http://edge.test:25461/live/other/creds/101.m3u8', XTREAM)).toEqual({ account, streamId: '101' });
    expect(shortEpgTarget('http://p.test/movie/u/secret-pw/5.mp4', XTREAM)).toBeNull();
    expect(shortEpgTarget('http://p.test/hls/news/index.m3u8', XTREAM)).toBeNull();

    const panel: ShortEpgSource = { type: 'm3u', url: 'http://p.test:8080/get.php?username=u&password=secret-pw&type=m3u_plus&output=ts' };
    const fromPanel = { base: 'http://p.test:8080', username: 'u', password: 'secret-pw' };
    expect(shortEpgTarget('http://p.test:8080/live/u/secret-pw/7.ts', panel)).toEqual({ account: fromPanel, streamId: '7' });
    expect(shortEpgTarget('http://p.test:8080/u/secret-pw/7', panel)).toEqual({ account: fromPanel, streamId: '7' });
    expect(shortEpgTarget('http://p.test:8080/series/u/secret-pw/7.mkv', panel)).toBeNull();
    // A playlist that is no panel export is never asked, whatever its stream URLs look like.
    expect(shortEpgTarget('http://p.test/live/u/secret-pw/7.ts', { type: 'm3u', url: 'http://lists.test/mine.m3u' })).toBeNull();
  });
});

describe('ShortEpgCache', () => {
  const target = { account, streamId: '101' };

  it('asks the panel once per channel and keeps the answer for 30 minutes', async () => {
    const clock = { now: NOW };
    const panel = fakeTransport(() => ({ body: listings(clock.now) }));
    const cache = new ShortEpgCache(panel, () => clock.now);

    const first = await cache.programmes('x:tv:live:101', target);
    expect(first.cached).toBe(false);
    expect(panel.requests.map((r) => r.url)).toEqual([shortEpgUrl('101')]);
    const start = Date.UTC(2026, 10, 2, 12) / MIN;
    expect(first.programmes).toEqual([0, 1, 2, 3].map((i) => ({ start: start + 30 * i, end: start + 30 * (i + 1), title: `Show ${i}`, sub: '', desc: `About Show ${i}`, category: '', episode: '', flags: 0 })));

    clock.now += SHORT_EPG_TTL_MS - 1;
    expect(await cache.programmes('x:tv:live:101', target)).toEqual({ programmes: first.programmes, cached: true });
    expect(panel.requests).toHaveLength(1);
    // Another channel has its own answer.
    await cache.programmes('x:tv:live:102', { account, streamId: '102' });
    expect(panel.requests.map((r) => r.url)).toEqual([shortEpgUrl('101'), shortEpgUrl('102')]);
    // 30 minutes on, the panel is asked again.
    clock.now += 1;
    const again = await cache.programmes('x:tv:live:101', target);
    expect(again.cached).toBe(false);
    expect(again.programmes[0]!.start).toBe(start + 30);
    expect(panel.requests).toHaveLength(3);
  });

  it('shares one request between asks while it runs', async () => {
    let answer: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (answer = resolve));
    const panel = fakeTransport(() => ({ body: listings(NOW), beforeChunk: () => gate }));
    const cache = new ShortEpgCache(panel, () => NOW);
    const a = cache.programmes('x:tv:live:101', target);
    const b = cache.programmes('x:tv:live:101', target);
    answer();
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb.programmes).toEqual(ra.programmes);
    expect(panel.requests).toHaveLength(1);
    expect((await cache.programmes('x:tv:live:101', target)).cached).toBe(true);
  });

  it('keeps no failure: the next ask tries again', async () => {
    const answers: FakeResponse[] = [{ status: 404, body: 'nope' }, { body: 'not json' }, { body: listings(NOW), failAfter: 10 }, { status: 401 }, { body: listings(NOW) }];
    const panel = fakeTransport(() => answers.shift()!);
    const cache = new ShortEpgCache(panel, () => NOW);
    const fails: unknown[] = [];
    for (let i = 0; i < 4; i++) fails.push(await cache.programmes('x:tv:live:101', target).catch((error: unknown) => error));
    expect(fails.map((e) => (e instanceof XtreamError ? `${e.code} ${e.status}` : e instanceof NetworkError ? 'network' : String(e)))).toEqual(['http 404', 'format null', 'network', 'auth 401']);
    for (const e of fails) expect((e as Error).message).not.toContain('secret-pw');
    expect((await cache.programmes('x:tv:live:101', target)).cached).toBe(false);
    expect((await cache.programmes('x:tv:live:101', target)).cached).toBe(true);
    expect(panel.requests).toHaveLength(5);
  });

  it('keeps the 200 most recent answers', async () => {
    const clock = { now: NOW };
    const panel = fakeTransport(() => ({ body: listings(NOW, 1) }));
    const cache = new ShortEpgCache(panel, () => clock.now);
    for (let id = 1; id <= 201; id++) await cache.programmes(`x:tv:live:${id}`, { account, streamId: String(id) });
    expect(panel.requests).toHaveLength(201);
    // The first answer made room for the 201st; the second is still there.
    expect((await cache.programmes('x:tv:live:2', { account, streamId: '2' })).cached).toBe(true);
    expect((await cache.programmes('x:tv:live:1', { account, streamId: '1' })).cached).toBe(false);
    expect(panel.requests).toHaveLength(202);

    // An answer asked for again goes to the back of the line: the next one dropped is the oldest.
    clock.now += SHORT_EPG_TTL_MS;
    await cache.programmes('x:tv:live:3', { account, streamId: '3' });
    await cache.programmes('x:tv:live:999', { account, streamId: '999' });
    expect((await cache.programmes('x:tv:live:3', { account, streamId: '3' })).cached).toBe(true);
    expect(panel.requests).toHaveLength(204);
  });

  it('keeps an empty answer too (the panel has no programmes for the channel)', async () => {
    const panel = fakeTransport(() => ({ body: '{"epg_listings":[]}' }));
    const cache = new ShortEpgCache(panel, () => NOW);
    expect(await cache.programmes('x:tv:live:109', target)).toEqual({ programmes: [], cached: false });
    expect(await cache.programmes('x:tv:live:109', target)).toEqual({ programmes: [], cached: true });
    expect(panel.requests).toHaveLength(1);
  });
});

describe('shortEpgNowNext', () => {
  it('reads now and next at any time, without changing the programmes', async () => {
    const cache = new ShortEpgCache(
      fakeTransport(() => ({ body: listings(NOW) })),
      () => NOW,
    );
    const { programmes } = await cache.programmes('k', { account, streamId: '1' });
    const copy = JSON.stringify(programmes);
    const titles = (at: number) => {
      const nn = shortEpgNowNext(programmes, at);
      return [nn.now?.title ?? null, nn.next?.title ?? null];
    };
    const noon = Date.UTC(2026, 10, 2, 12);
    expect(titles(NOW)).toEqual(['Show 0', 'Show 1']);
    expect(titles(noon + 30 * MIN)).toEqual(['Show 1', 'Show 2']);
    expect(titles(noon - 1)).toEqual([null, 'Show 0']);
    expect(titles(noon + 110 * MIN)).toEqual(['Show 3', null]);
    expect(titles(noon + 120 * MIN)).toEqual([null, null]);
    expect(JSON.stringify(programmes)).toBe(copy);
    // Overlapping programmes are cut for reading only: the kept answer stays as it came.
    const overlapping = [{ ...programmes[0]!, end: programmes[1]!.end }, programmes[1]!];
    const before = JSON.stringify(overlapping);
    expect(shortEpgNowNext(overlapping, NOW).now).toMatchObject({ title: 'Show 0', end: programmes[0]!.end });
    expect(JSON.stringify(overlapping)).toBe(before);
    // A guessed stop reads like any other.
    const guessed = shortEpgNowNext([{ ...programmes[0]!, flags: EPG_FLAG_STOP_GUESSED }], NOW);
    expect(guessed.now?.flags).toBe(EPG_FLAG_STOP_GUESSED);
  });
});

describe('QueryService.shortEpg', () => {
  const pad = (n: number): string => String(n < 10 ? `0${n}` : n);
  const t = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`;
  };
  /** A guide for `a.tv` only: hourly "Guide H" from a day back to a day ahead. */
  const guideXml = (): string => {
    const lines = ['<?xml version="1.0"?>', '<tv>', '<channel id="a.tv"><display-name>Alpha</display-name></channel>'];
    const noon = Date.UTC(2026, 10, 2, 12);
    for (let ms = noon - 86_400_000; ms < noon + 86_400_000; ms += 3_600_000) {
      lines.push(`<programme start="${t(ms)}" stop="${t(ms + 3_600_000)}" channel="a.tv"><title>Guide ${new Date(ms).getUTCHours()}</title></programme>`);
    }
    lines.push('</tv>');
    return lines.join('\n');
  };
  const live = (id: number, name: string, epgId: string | null): CatalogItem => ({ ...item('tv', 'live', id, name), epgId, url: `http://p.test/live/u/secret-pw/${id}.ts` });

  let db: IDBDatabase;
  beforeEach(async () => {
    db = await openDatabase(freshFactory());
    await ingest(db, 'tv', [live(1, 'Alpha', 'a.tv'), live(2, 'Lost Channel', null), item('tv', 'movie', 9, 'A Film')]);
    const r = await runEpgRefresh(
      { guides: [{ epgSrc: 'tv:xmltv', url: 'http://p.test/xmltv.php?username=u&password=secret-pw', zone: { minutes: 0 } }], tier: 'full', languages: ['en'] },
      { db, transport: fakeTransport(() => ({ body: guideXml() })), now: () => NOW },
    );
    expect(r.outcomes[0]!.result?.summary).toMatchObject({ wanted: 2, matched: 1 });
  });
  afterEach(() => {
    db.close();
  });

  const ask = (q: QueryService, id: number, source: ShortEpgSource = XTREAM, at?: number) => q.shortEpg({ key: `x:tv:live:${id}`, url: `http://p.test/live/u/secret-pw/${id}.ts`, source, at });

  it("gives a matched channel its guide's now/next and an unmatched one its panel's, cached", async () => {
    const panel = fakeTransport(() => ({ body: listings(NOW, 4, 30, 'Panel') }));
    const q = new QueryService({ openDb: async () => db, transport: panel, now: () => NOW });

    const matched = await ask(q, 1);
    expect(matched).toMatchObject({ key: 'x:tv:live:1', epgSrc: 'tv:xmltv', channel: 'a.tv', from: 'guide', cached: false, now: { title: 'Guide 12' }, next: { title: 'Guide 13' } });
    expect(panel.requests).toHaveLength(0);

    const unmatched = await ask(q, 2);
    expect(unmatched).toMatchObject({ key: 'x:tv:live:2', epgSrc: null, channel: null, method: null, from: 'panel', cached: false, now: { title: 'Panel 0' }, next: { title: 'Panel 1' } });
    expect(panel.requests.map((r) => r.url)).toEqual([shortEpgUrl('2')]);
    // Within 30 minutes: no request, and now/next read at the time asked.
    const later = await ask(q, 2, XTREAM, NOW + 30 * MIN);
    expect(later).toMatchObject({ from: 'panel', cached: true, now: { title: 'Panel 1' }, next: { title: 'Panel 2' } });
    expect(panel.requests).toHaveLength(1);
  });

  it('asks no panel for a channel of a playlist that is none, or without a transport', async () => {
    const panel = fakeTransport(() => ({ body: listings(NOW) }));
    const q = new QueryService({ openDb: async () => db, transport: panel, now: () => NOW });
    expect(await ask(q, 2, { type: 'm3u', url: 'http://lists.test/mine.m3u' })).toEqual({ key: 'x:tv:live:2', epgSrc: null, channel: null, method: null, now: null, next: null, from: 'none', cached: false });
    expect(panel.requests).toHaveLength(0);
    const offline = new QueryService({ openDb: async () => db, now: () => NOW });
    expect(await ask(offline, 2)).toMatchObject({ from: 'none', now: null, next: null });
    // A matched channel still gets its guide there.
    expect(await ask(offline, 1)).toMatchObject({ from: 'guide', now: { title: 'Guide 12' } });
  });

  it('asks no panel for a channel the user mapped to no guide, at once and after a reload (step 24d)', async () => {
    const panel = fakeTransport(() => ({ body: listings(NOW, 4, 30, 'Panel') }));
    const q = new QueryService({ openDb: async () => db, transport: panel, now: () => NOW });
    // Loaded first: the edit itself must apply it, not a first load after it.
    await q.reload();
    expect(await q.editProfile({ kind: 'epgOverride', key: 'x:tv:live:2', pin: { epgSrc: '', channel: null } })).toBe(true);
    expect(await ask(q, 2)).toEqual({ key: 'x:tv:live:2', epgSrc: null, channel: null, method: null, now: null, next: null, from: 'none', cached: false });
    expect(panel.requests).toHaveLength(0);
    // Read from the profile at a reload (another worker's start).
    const fresh = new QueryService({ openDb: async () => db, transport: panel, now: () => NOW });
    expect(await ask(fresh, 2)).toMatchObject({ from: 'none', now: null });
    expect(panel.requests).toHaveLength(0);
    // A mapping to a guide's channel isn't "no guide": until a refresh reads it, the panel answers.
    await q.editProfile({ kind: 'epgOverride', key: 'x:tv:live:2', pin: { epgSrc: 'tv:xmltv', channel: 'a.tv' } });
    expect(await ask(q, 2)).toMatchObject({ from: 'panel', now: { title: 'Panel 0' } });
    expect(panel.requests).toHaveLength(1);
    // A matched channel mapped to no guide keeps its guide until the guide is read again.
    await q.editProfile({ kind: 'epgOverride', key: 'x:tv:live:1', pin: { epgSrc: '', channel: null } });
    expect(await ask(q, 1)).toMatchObject({ from: 'guide', now: { title: 'Guide 12' } });
  });

  it("rejects with the panel's error, and asks again next time", async () => {
    const answers: FakeResponse[] = [{ status: 500 }, { body: listings(NOW) }];
    const panel = fakeTransport(() => answers.shift()!);
    const q = new QueryService({ openDb: async () => db, transport: panel, now: () => NOW });
    await expect(ask(q, 2)).rejects.toThrow(new XtreamError('http', 500));
    expect(await ask(q, 2)).toMatchObject({ from: 'panel', cached: false, now: { title: 'Show 0' } });
    expect(panel.requests).toHaveLength(2);
  });
});
