import { afterEach, describe, expect, it } from 'vitest';
import type { XtreamAccount } from '@lablo/core';
import { XtreamError } from '@lablo/core';
import { NetworkError } from './bytes';
import { createDataClient } from './client';
import { openDatabase } from './idb';
import { QueryService } from './query-service';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';
import { SERIES_INFO_TTL_MS, SeriesInfoCache, seriesInfoTarget } from './series-info';
import { textTransport } from './short-epg';
import type { FakeResponse } from './test-support';
import { fakeTransport, freshFactory } from './test-support';

const NOW = Date.UTC(2026, 10, 12, 20);
const account: XtreamAccount = { base: 'http://p.test', username: 'u', password: 'secret-pw' };
const infoUrl = (id: string, base = 'http://p.test', username = 'u', password = 'secret-pw'): string =>
  `${base}/player_api.php?username=${username}&password=${password}&action=get_series_info&series_id=${id}`;

/** A panel's `get_series_info` answer for show `id`: two seasons, the second listed first. */
function answer(id: string, name = `Show ${id}`): string {
  const episode = (n: number, season: number, num: number) => ({
    id: String(n),
    episode_num: num,
    title: `E${num}`,
    container_extension: 'mkv',
    info: { duration_secs: 300, plot: `Plot ${n}`, movie_image: `http://p.test/e/${n}.jpg` },
    season,
  });
  return JSON.stringify({
    seasons: [
      { season_number: 1, name: 'Season 1', episode_count: 2 },
      { season_number: 2, name: 'The End', episode_count: 1 },
    ],
    info: { name, plot: `About ${name}`, genre: 'Drama', releaseDate: '2019-05-01', rating: '8', cover: `http://p.test/c/${id}.jpg` },
    episodes: { '2': [episode(Number(id) * 10 + 3, 2, 1)], '1': [episode(Number(id) * 10 + 2, 1, 2), episode(Number(id) * 10 + 1, 1, 1)] },
  });
}

const opened: MessagePort[] = [];
afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

describe('seriesInfoTarget', () => {
  it("takes the show's id from its key and the account from its source", () => {
    expect(seriesInfoTarget('s1', 'x:s1:series:301', account)).toEqual({ account, seriesId: '301' });
    // Not a show of that source: another source's, a movie, an episode, a playlist's line, no key at all.
    expect(seriesInfoTarget('s1', 'x:s2:series:301', account)).toBeNull();
    expect(seriesInfoTarget('s1', 'x:s1:movie:301', account)).toBeNull();
    expect(seriesInfoTarget('s1', 'x:s1:episode:3001', account)).toBeNull();
    expect(seriesInfoTarget('s1', 'm:s1:1dp8o63arjt:0', account)).toBeNull();
    expect(seriesInfoTarget('s1', 'x:s1:series:', account)).toBeNull();
    // A plain playlist has no panel.
    expect(seriesInfoTarget('s1', 'x:s1:series:301', null)).toBeNull();
  });
});

describe('SeriesInfoCache', () => {
  const target = { account, seriesId: '301' };

  it('keeps an answer a day', () => {
    expect(SERIES_INFO_TTL_MS).toBe(86_400_000);
  });

  it('asks the panel once per show and keeps the answer for 24 hours', async () => {
    const clock = { now: NOW };
    const panel = fakeTransport((url) => ({ body: answer(url.slice(url.lastIndexOf('=') + 1)) }));
    const cache = new SeriesInfoCache(textTransport(panel), () => clock.now);

    const first = (await cache.info('s1', 'x:s1:series:301', target))!;
    expect(first).toMatchObject({ name: 'Show 301', plot: 'About Show 301', genre: 'Drama', releaseDate: '2019-05-01', rating: 8, cover: 'http://p.test/c/301.jpg' });
    // The seasons, and the episodes in order, each with the source's key and the account's URL.
    expect(first.seasons.map((s) => [s.number, s.name])).toEqual([
      [1, 'Season 1'],
      [2, 'The End'],
    ]);
    expect(first.episodes.map((e) => [e.key, e.season, e.episodeNum, e.url])).toEqual([
      ['x:s1:episode:3011', 1, 1, 'http://p.test/series/u/secret-pw/3011.mkv'],
      ['x:s1:episode:3012', 1, 2, 'http://p.test/series/u/secret-pw/3012.mkv'],
      ['x:s1:episode:3013', 2, 1, 'http://p.test/series/u/secret-pw/3013.mkv'],
    ]);
    expect(panel.requests.map((r) => r.url)).toEqual([infoUrl('301')]);

    clock.now += SERIES_INFO_TTL_MS - 1;
    expect(await cache.info('s1', 'x:s1:series:301', target)).toEqual(first);
    expect(panel.requests).toHaveLength(1);
    // Another show has its own answer.
    expect(await cache.info('s1', 'x:s1:series:302', { account, seriesId: '302' })).toMatchObject({ name: 'Show 302' });
    expect(panel.requests.map((r) => r.url)).toEqual([infoUrl('301'), infoUrl('302')]);
    // A day on, the panel is asked again.
    clock.now += 1;
    expect(await cache.info('s1', 'x:s1:series:301', target)).toMatchObject({ name: 'Show 301' });
    expect(panel.requests).toHaveLength(3);
  });

  it('shares one request between asks while it runs', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const panel = fakeTransport(() => ({ body: answer('301'), beforeChunk: () => gate }));
    const cache = new SeriesInfoCache(textTransport(panel), () => NOW);
    const a = cache.info('s1', 'x:s1:series:301', target);
    const b = cache.info('s1', 'x:s1:series:301', target);
    open();
    const both = await Promise.all([a, b]);
    expect(both[1]).toEqual(both[0]);
    expect(panel.requests).toHaveLength(1);
  });

  it("keeps no failure (the next open asks again), and keeps the panel's 'not found'", async () => {
    const answers: FakeResponse[] = [{ status: 404, body: 'nope' }, { body: 'not json' }, { body: answer('301'), failAfter: 10 }, { status: 401 }, { body: '[]' }];
    const panel = fakeTransport(() => answers.shift()!);
    const cache = new SeriesInfoCache(textTransport(panel), () => NOW);
    const fails: unknown[] = [];
    for (let i = 0; i < 4; i++) fails.push(await cache.info('s1', 'x:s1:series:301', target).catch((error: unknown) => error));
    expect(fails.map((e) => (e instanceof XtreamError ? `${e.code} ${e.status}` : e instanceof NetworkError ? 'network' : String(e)))).toEqual(['http 404', 'format null', 'network', 'auth 401']);
    for (const e of fails) expect((e as Error).message).not.toContain('secret-pw');
    // The panel doesn't know the show (`[]`): that answer is kept.
    expect(await cache.info('s1', 'x:s1:series:301', target)).toBeNull();
    expect(await cache.info('s1', 'x:s1:series:301', target)).toBeNull();
    expect(panel.requests).toHaveLength(5);
  });

  it('keeps the 20 most recent shows', async () => {
    const panel = fakeTransport((url) => ({ body: answer(url.slice(url.lastIndexOf('=') + 1)) }));
    const cache = new SeriesInfoCache(textTransport(panel), () => NOW);
    const ask = (id: number) => cache.info('s1', `x:s1:series:${id}`, { account, seriesId: String(id) });
    for (let id = 1; id <= 21; id++) await ask(id);
    expect(panel.requests).toHaveLength(21);
    // The first answer made room for the 21st; the second is still there.
    await ask(2);
    expect(panel.requests).toHaveLength(21);
    await ask(1);
    expect(panel.requests).toHaveLength(22);
  });
});

describe('QueryService.seriesInfo: a show of a stored source over RPC', () => {
  it("asks the source's panel for the show's seasons and episodes, kept, and has nothing for a playlist", async () => {
    const factory = freshFactory();
    const db = await openDatabase(factory);
    const clock = { now: NOW };
    const panel = fakeTransport((url) => ({ body: answer(url.slice(url.lastIndexOf('=') + 1)) }));
    const svc = new QueryService({ openDb: () => openDatabase(factory), transport: panel, now: () => clock.now });
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    serveRpc(port1, svc.handlers());
    const client = createDataClient(port2 as unknown as RpcPort);
    const show = { src: 's1', key: 'x:s1:series:301' };
    // No profile yet.
    expect(await client.call('seriesInfo', show)).toBeNull();
    await client.call('editProfile', { kind: 'source', source: { id: 's1', type: 'xtream', name: 'P', account, added: 1 } });
    await client.call('editProfile', { kind: 'source', source: { id: 's2', type: 'm3u', name: 'L', url: 'http://lists.test/tv.m3u', added: 2 } });
    await client.call('editProfile', {
      kind: 'source',
      source: { id: 's3', type: 'm3u', name: 'G', url: 'http://g.test:8080/get.php?username=g&password=pw&type=m3u_plus', added: 3 },
    });
    const info = await client.call('seriesInfo', show);
    expect(info).toMatchObject({ name: 'Show 301', releaseDate: '2019-05-01' });
    expect(info!.episodes.map((e) => e.key)).toEqual(['x:s1:episode:3011', 'x:s1:episode:3012', 'x:s1:episode:3013']);
    expect(await client.call('seriesInfo', show)).toMatchObject({ name: 'Show 301' });
    expect(panel.requests.map((r) => r.url)).toEqual([infoUrl('301')]);
    // A get.php link's panel: its account, and keys of that source.
    const linked = await client.call('seriesInfo', { src: 's3', key: 'x:s3:series:9' });
    expect(linked!.episodes.map((e) => [e.key, e.url])[0]).toEqual(['x:s3:episode:91', 'http://g.test:8080/series/g/pw/91.mkv']);
    expect(panel.requests.map((r) => r.url)).toEqual([infoUrl('301'), infoUrl('9', 'http://g.test:8080', 'g', 'pw')]);
    // A plain playlist, a source that isn't stored, another source's key, a movie's: nothing asked.
    expect(await client.call('seriesInfo', { src: 's2', key: 'x:s2:series:301' })).toBeNull();
    expect(await client.call('seriesInfo', { src: 's9', key: 'x:s9:series:301' })).toBeNull();
    expect(await client.call('seriesInfo', { src: 's1', key: 'x:s3:series:301' })).toBeNull();
    expect(await client.call('seriesInfo', { src: 's1', key: 'x:s1:movie:301' })).toBeNull();
    expect(panel.requests).toHaveLength(2);
    // A day on, the panel is asked again (the service's clock).
    clock.now += SERIES_INFO_TTL_MS;
    await client.call('seriesInfo', show);
    expect(panel.requests).toHaveLength(3);
    // A worker without a network never asks.
    const offline = new QueryService({ openDb: () => openDatabase(factory) });
    expect(await offline.seriesInfo(show)).toBeNull();
    expect(panel.requests).toHaveLength(3);
    db.close();
  });

  it("rejects with the panel's error, without the URL", async () => {
    const factory = freshFactory();
    const db = await openDatabase(factory);
    const panel = fakeTransport(() => ({ status: 503, body: 'busy' }));
    const svc = new QueryService({ openDb: () => openDatabase(factory), transport: panel, now: () => NOW });
    await svc.editProfile({ kind: 'source', source: { id: 's1', type: 'xtream', name: 'P', account, added: 1 } });
    const failed = svc.seriesInfo({ src: 's1', key: 'x:s1:series:301' });
    await expect(failed).rejects.toMatchObject({ name: 'XtreamError', code: 'http', status: 503 });
    await expect(failed).rejects.not.toThrow(/secret-pw/);
    db.close();
  });
});
