import { afterEach, describe, expect, it } from 'vitest';
import type { XtreamAccount } from '@zoma/core';
import { XtreamError } from '@zoma/core';
import { NetworkError } from './bytes';
import { createDataClient } from './client';
import { openDatabase } from './idb';
import { QueryService } from './query-service';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';
import { textTransport } from './short-epg';
import type { FakeResponse } from './test-support';
import { fakeTransport, freshFactory } from './test-support';
import { VOD_INFO_TTL_MS, VodInfoCache, vodInfoTarget } from './vod-info';

const NOW = Date.UTC(2026, 10, 11, 20);
const account: XtreamAccount = { base: 'http://p.test', username: 'u', password: 'secret-pw' };
const infoUrl = (id: string, base = 'http://p.test', username = 'u', password = 'secret-pw'): string =>
  `${base}/player_api.php?username=${username}&password=${password}&action=get_vod_info&vod_id=${id}`;

/** A panel's `get_vod_info` answer for movie `id`. */
function answer(id: string, name = `Film ${id}`): string {
  return JSON.stringify({
    info: { name, plot: `About ${name}`, genre: 'Drama', releasedate: '2010-05-01', duration_secs: 5400, rating: '7.5', cover_big: `http://p.test/c/${id}.jpg` },
    movie_data: { stream_id: id, name, container_extension: 'mkv' },
  });
}

const opened: MessagePort[] = [];
afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

describe('vodInfoTarget', () => {
  it("takes the movie's id from its URL and the account from its source", () => {
    expect(vodInfoTarget('http://p.test/movie/u/secret-pw/201.mp4', account)).toEqual({ account, vodId: '201' });
    // A load-balanced stream URL: the request still goes to the panel the user added.
    expect(vodInfoTarget('http://edge.test:25461/movie/other/creds/7.mkv', account)).toEqual({ account, vodId: '7' });
    expect(vodInfoTarget('http://p.test/live/u/secret-pw/101.ts', account)).toBeNull();
    expect(vodInfoTarget('http://p.test/series/u/secret-pw/5.mkv', account)).toBeNull();
    expect(vodInfoTarget('http://cdn.test/films/sintel.mp4', account)).toBeNull();
    // A plain playlist has no panel, whatever its URLs look like.
    expect(vodInfoTarget('http://p.test/movie/u/secret-pw/201.mp4', null)).toBeNull();
  });
});

describe('VodInfoCache', () => {
  const target = { account, vodId: '201' };

  it('asks the panel once per movie and keeps the answer for 24 hours', async () => {
    const clock = { now: NOW };
    const panel = fakeTransport((url) => ({ body: answer(url.slice(url.lastIndexOf('=') + 1)) }));
    const cache = new VodInfoCache(textTransport(panel), () => clock.now);

    const first = await cache.info('x:s1:movie:201', target);
    expect(first).toMatchObject({ name: 'Film 201', plot: 'About Film 201', genre: 'Drama', releaseDate: '2010-05-01', durationSecs: 5400, rating: 7.5, cover: 'http://p.test/c/201.jpg', ext: 'mkv' });
    expect(panel.requests.map((r) => r.url)).toEqual([infoUrl('201')]);

    clock.now += VOD_INFO_TTL_MS - 1;
    expect(await cache.info('x:s1:movie:201', target)).toEqual(first);
    expect(panel.requests).toHaveLength(1);
    // Another movie has its own answer.
    expect(await cache.info('x:s1:movie:202', { account, vodId: '202' })).toMatchObject({ name: 'Film 202' });
    expect(panel.requests.map((r) => r.url)).toEqual([infoUrl('201'), infoUrl('202')]);
    // A day on, the panel is asked again.
    clock.now += 1;
    expect(await cache.info('x:s1:movie:201', target)).toMatchObject({ name: 'Film 201' });
    expect(panel.requests).toHaveLength(3);
  });

  it('shares one request between asks while it runs', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const panel = fakeTransport(() => ({ body: answer('201'), beforeChunk: () => gate }));
    const cache = new VodInfoCache(textTransport(panel), () => NOW);
    const a = cache.info('x:s1:movie:201', target);
    const b = cache.info('x:s1:movie:201', target);
    open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb).toEqual(ra);
    expect(panel.requests).toHaveLength(1);
  });

  it("keeps no failure (the next open asks again), and keeps the panel's 'not found'", async () => {
    const answers: FakeResponse[] = [{ status: 404, body: 'nope' }, { body: 'not json' }, { body: answer('201'), failAfter: 10 }, { status: 401 }, { body: '[]' }];
    const panel = fakeTransport(() => answers.shift()!);
    const cache = new VodInfoCache(textTransport(panel), () => NOW);
    const fails: unknown[] = [];
    for (let i = 0; i < 4; i++) fails.push(await cache.info('x:s1:movie:201', target).catch((error: unknown) => error));
    expect(fails.map((e) => (e instanceof XtreamError ? `${e.code} ${e.status}` : e instanceof NetworkError ? 'network' : String(e)))).toEqual(['http 404', 'format null', 'network', 'auth 401']);
    for (const e of fails) expect((e as Error).message).not.toContain('secret-pw');
    // The panel doesn't know the movie (`[]`): that answer is kept.
    expect(await cache.info('x:s1:movie:201', target)).toBeNull();
    expect(await cache.info('x:s1:movie:201', target)).toBeNull();
    expect(panel.requests).toHaveLength(5);
  });

  it('keeps the 100 most recent answers', async () => {
    const clock = { now: NOW };
    const panel = fakeTransport((url) => ({ body: answer(url.slice(url.lastIndexOf('=') + 1)) }));
    const cache = new VodInfoCache(textTransport(panel), () => clock.now);
    const ask = (id: number) => cache.info(`x:s1:movie:${id}`, { account, vodId: String(id) });
    for (let id = 1; id <= 101; id++) await ask(id);
    expect(panel.requests).toHaveLength(101);
    // The first answer made room for the 101st; the second is still there.
    await ask(2);
    expect(panel.requests).toHaveLength(101);
    await ask(1);
    expect(panel.requests).toHaveLength(102);
    // An answer asked for again goes to the back of the line: the next one dropped is the oldest.
    clock.now += VOD_INFO_TTL_MS;
    await ask(3);
    await ask(999);
    await ask(3);
    expect(panel.requests).toHaveLength(104);
  });
});

describe('QueryService.vodInfo: a movie of a stored source over RPC', () => {
  it("asks the source's panel for the movie's details, kept, and has nothing for a playlist", async () => {
    const factory = freshFactory();
    const db = await openDatabase(factory);
    const clock = { now: NOW };
    const panel = fakeTransport((url) => ({ body: answer(url.slice(url.lastIndexOf('=') + 1)) }));
    const svc = new QueryService({ openDb: () => openDatabase(factory), transport: panel, now: () => clock.now });
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    serveRpc(port1, svc.handlers());
    const client = createDataClient(port2 as unknown as RpcPort);
    const film = { src: 's1', key: 'x:s1:movie:201', url: 'http://p.test/movie/u/secret-pw/201.mp4' };
    // No profile yet.
    expect(await client.call('vodInfo', film)).toBeNull();
    await client.call('editProfile', { kind: 'source', source: { id: 's1', type: 'xtream', name: 'P', account, added: 1 } });
    await client.call('editProfile', { kind: 'source', source: { id: 's2', type: 'm3u', name: 'L', url: 'http://lists.test/tv.m3u', added: 2 } });
    await client.call('editProfile', {
      kind: 'source',
      source: { id: 's3', type: 'm3u', name: 'G', url: 'http://g.test:8080/get.php?username=g&password=pw&type=m3u_plus', added: 3 },
    });
    expect(await client.call('vodInfo', film)).toMatchObject({ name: 'Film 201', durationSecs: 5400, ext: 'mkv' });
    expect(await client.call('vodInfo', film)).toMatchObject({ name: 'Film 201' });
    expect(panel.requests.map((r) => r.url)).toEqual([infoUrl('201')]);
    // An M3U source's get.php link is a panel too.
    expect(await client.call('vodInfo', { src: 's3', key: 'm:s3:abc', url: 'http://g.test:8080/movie/g/pw/9.mkv' })).toMatchObject({ name: 'Film 9' });
    expect(panel.requests.map((r) => r.url)).toEqual([infoUrl('201'), infoUrl('9', 'http://g.test:8080', 'g', 'pw')]);
    // A plain playlist, a source that isn't stored, and a URL that isn't a panel's movie: nothing asked.
    expect(await client.call('vodInfo', { src: 's2', key: 'm:s2:abc', url: 'http://p.test/movie/u/secret-pw/5.mp4' })).toBeNull();
    expect(await client.call('vodInfo', { src: 's9', key: 'x:s9:movie:201', url: film.url })).toBeNull();
    expect(await client.call('vodInfo', { ...film, key: 'x:s1:movie:5', url: 'http://p.test/films/5.mp4' })).toBeNull();
    expect(panel.requests).toHaveLength(2);
    // A day on, the panel is asked again (the service's clock).
    clock.now += VOD_INFO_TTL_MS;
    await client.call('vodInfo', film);
    expect(panel.requests).toHaveLength(3);
    // A worker without a network never asks.
    const offline = new QueryService({ openDb: () => openDatabase(factory) });
    expect(await offline.vodInfo(film)).toBeNull();
    expect(panel.requests).toHaveLength(3);
    db.close();
  });

  it("rejects with the panel's error, without the URL", async () => {
    const factory = freshFactory();
    const db = await openDatabase(factory);
    const panel = fakeTransport(() => ({ status: 503, body: 'busy' }));
    const svc = new QueryService({ openDb: () => openDatabase(factory), transport: panel, now: () => NOW });
    await svc.editProfile({ kind: 'source', source: { id: 's1', type: 'xtream', name: 'P', account, added: 1 } });
    const failed = svc.vodInfo({ src: 's1', key: 'x:s1:movie:201', url: 'http://p.test/movie/u/secret-pw/201.mp4' });
    await expect(failed).rejects.toMatchObject({ name: 'XtreamError', code: 'http', status: 503 });
    await expect(failed).rejects.not.toThrow(/secret-pw/);
    db.close();
  });
});
