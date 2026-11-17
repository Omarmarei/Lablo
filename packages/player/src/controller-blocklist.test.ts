import { describe, expect, it } from 'vitest';
import type { ControllerOptions, PlayerStatus } from './controller';
import { PlayerController } from './controller';
import type { EngineSource, PlaybackError } from './engine';
import type { FakeScript } from './fake-engine';
import { FakeClock, FakeEngine } from './fake-engine';
import { BLOCKED_CODE, blockedFailure, wantsAccountCheck } from './failure';
import type { PlayRequest } from './request';
import { streamCandidates } from './request';

/**
 * The config's blocklist in the controller (RELAY step 30c3b): every URL asked about before the
 * engine opens it (alongside the close), the redirect probe's answer too, a blocked one given up
 * at once, and `checkBlocklist` after a config refresh.
 */

const PANEL = 'http://panel.example:8080';
const CDN = 'http://cdn.other.example';
const NETWORK: PlaybackError = { kind: 'network', code: 'MEDIA_ERR_NETWORK' };

function live(id: number): PlayRequest {
  return { key: `s1:live:${id}`, src: 's1', mode: 'live', candidates: streamCandidates(`${PANEL}/live/u/p/${id}.ts`, 'live') };
}

function vod(id: number): PlayRequest {
  return { key: `s1:movie:${id}`, src: 's1', mode: 'vod', candidates: streamCandidates(`${PANEL}/movie/u/p/${id}.mp4`, 'vod') };
}

/** A blocklist the test answers: each call's URLs, answered at once from `hosts` or held. */
class FakeBlocklist {
  /** Servers on the list (a URL starting with one is blocked). */
  hosts: string[] = [];
  /** Each call's URLs, and when it came. */
  readonly calls: { urls: string[]; at: number }[] = [];
  /** The answer comes this long after the call (0: at once). */
  delayMs = 0;

  constructor(private readonly clock: FakeClock) {}

  readonly blocked = (urls: string[]): Promise<boolean[]> => {
    this.calls.push({ urls: urls.slice(), at: this.clock.now() });
    const answer = urls.map((url) => this.hosts.some((host) => url.indexOf(host) === 0));
    if (this.delayMs === 0) return Promise.resolve(answer);
    return new Promise((resolve) => {
      this.clock.setTimeout(() => resolve(answer), this.delayMs);
    });
  };

  asked(): string[][] {
    return this.calls.map((c) => c.urls);
  }
}

interface Rig {
  clock: FakeClock;
  engine: FakeEngine;
  player: PlayerController;
  list: FakeBlocklist;
  statuses: PlayerStatus[];
  online: number;
  accounts: number;
}

function rig(script?: (source: EngineSource, n: number) => FakeScript, options: ControllerOptions = {}): Rig {
  const clock = new FakeClock();
  const engine = new FakeEngine(clock, script);
  const list = new FakeBlocklist(clock);
  const r: Rig = { clock, engine, player: null as unknown as PlayerController, list, statuses: [], online: 0, accounts: 0 };
  r.player = new PlayerController(engine, {
    clock,
    blocked: list.blocked,
    online: () => {
      r.online += 1;
      return true;
    },
    checkAccount: () => {
      r.accounts += 1;
      return Promise.resolve(null);
    },
    ...options,
  });
  r.player.subscribe((s) => r.statuses.push(s));
  return r;
}

const BLOCKED = { state: 'failed', failure: { category: 'blocked', code: 'CFG-BLOCKLIST', detail: 'BLOCKLIST', account: null } };

describe('the blocked failure', () => {
  it('has its own category and code, no account, and wants no account check', () => {
    expect(blockedFailure()).toEqual({ category: 'blocked', code: BLOCKED_CODE, detail: 'BLOCKLIST', account: null });
    expect(BLOCKED_CODE).toBe('CFG-BLOCKLIST');
    expect(wantsAccountCheck('blocked')).toBe(false);
    // A fresh object each time: no caller can change another's.
    expect(blockedFailure()).not.toBe(blockedFailure());
  });
});

describe('PlayerController: the blocklist at open', () => {
  it('asks about the URL before the engine opens it, while the old connection closes', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(r.list.asked()).toEqual([[`${PANEL}/live/u/p/1.ts`]]);
    expect(r.player.status.state).toBe('playing');
    // A zap: the close takes 50 ms; an answer in 30 ms doesn't hold the load back.
    r.list.delayMs = 30;
    const zapAt = r.clock.now();
    void r.player.play(live(2));
    await r.clock.advance(0);
    expect(r.list.calls[1]).toEqual({ urls: [`${PANEL}/live/u/p/2.ts`], at: zapAt });
    await r.clock.advance(600);
    expect(r.engine.loads[1]!.at).toBe(zapAt + 50);
    // A slower answer (100 ms) holds the load until it comes.
    r.list.delayMs = 100;
    const nextAt = r.clock.now();
    void r.player.play(live(3));
    await r.clock.advance(700);
    expect(r.engine.loads[2]!.at).toBe(nextAt + 100);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:3' });
  });

  it('gives up at once on a blocked URL: no load, no retry, no connectivity or account check', async () => {
    const r = rig();
    r.list.hosts = [PANEL];
    void r.player.play(live(1));
    await r.clock.advance(60_000);
    expect(r.engine.loads).toEqual([]);
    expect(r.player.status).toMatchObject({ ...BLOCKED, key: 's1:live:1', container: 'ts', attempt: 0 });
    expect(r.statuses.map((s) => s.state)).toEqual(['opening', 'failed']);
    // Only the first URL was asked about: the request's other URL (.m3u8) is on the same server.
    expect(r.list.asked()).toEqual([[`${PANEL}/live/u/p/1.ts`]]);
    expect(r.online).toBe(0);
    expect(r.accounts).toBe(0);
    expect(r.engine.open).toBe(0);
    // No timer is left (the open timeout went with it), and nothing is asked again.
    expect(r.clock.pending).toBe(0);
    r.player.checkBlocklist();
    await r.clock.advance(100);
    expect(r.list.calls).toHaveLength(1);
  });

  it('stops a blocked zap: the old stream closes and nothing new opens', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(600);
    r.list.hosts = [PANEL];
    void r.player.play(live(2));
    await r.clock.advance(5000);
    expect(r.engine.loads).toHaveLength(1);
    expect(r.engine.open).toBe(0);
    expect(r.player.status).toMatchObject({ ...BLOCKED, key: 's1:live:2' });
  });

  it('plays when the check rejects or throws (the blocklist is unknown)', async () => {
    const rejecting = rig(undefined, { blocked: () => Promise.reject(new Error('no worker')) });
    void rejecting.player.play(live(1));
    await rejecting.clock.advance(600);
    expect(rejecting.player.status.state).toBe('playing');
    const throwing = rig(undefined, {
      blocked: () => {
        throw new Error('no worker');
      },
    });
    void throwing.player.play(live(1));
    await throwing.clock.advance(600);
    expect(throwing.player.status.state).toBe('playing');
  });

  it('plays when no answer says blocked (one false among others)', async () => {
    const r = rig(undefined, { blocked: (urls) => Promise.resolve(urls.map(() => false)) });
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(r.player.status.state).toBe('playing');
  });

  it('asks again for each URL it opens: a retry on the next URL, blocked there', async () => {
    // The .ts fails before a frame; the .m3u8 would play.
    const r = rig((s) => (s.container === 'ts' ? { frameMs: null, loadError: NETWORK } : {}));
    void r.player.play(live(1));
    await r.clock.advance(5000);
    expect(r.list.asked()).toEqual([[`${PANEL}/live/u/p/1.ts`], [`${PANEL}/live/u/p/1.m3u8`]]);
    expect(r.player.status).toMatchObject({ state: 'playing', container: 'hls' });
    // Again, with the .m3u8 blocked (another server in this request).
    const other: PlayRequest = { key: 's1:live:9', src: 's1', mode: 'live', candidates: [{ url: `${PANEL}/live/u/p/9.ts`, container: 'ts' }, { url: `${CDN}/live/9.m3u8`, container: 'hls' }] };
    const b = rig((s) => (s.container === 'ts' ? { frameMs: null, loadError: NETWORK } : {}));
    b.list.hosts = [CDN];
    void b.player.play(other);
    await b.clock.advance(5000);
    expect(b.engine.loads.map((l) => l.source.container)).toEqual(['ts']);
    expect(b.player.status).toMatchObject({ ...BLOCKED, container: 'hls', attempt: 1 });
  });

  it('drops an answer that lands after a zap or a stop', async () => {
    const r = rig();
    r.list.hosts = [`${PANEL}/live/u/p/1.`];
    r.list.delayMs = 300;
    void r.player.play(live(1));
    await r.clock.advance(100);
    void r.player.play(live(2));
    await r.clock.advance(1000);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:2' });
    expect(r.statuses.some((s) => s.state === 'failed')).toBe(false);
    void r.player.play(live(1));
    await r.clock.advance(100);
    void r.player.stop();
    await r.clock.advance(1000);
    expect(r.player.status.state).toBe('idle');
    expect(r.engine.loads).toHaveLength(1);
  });

  it('drops an answer that lands after the app hid, and asks again when it is back', async () => {
    const r = rig();
    r.list.delayMs = 300;
    void r.player.play(live(1));
    await r.clock.advance(100);
    r.player.hide();
    await r.clock.advance(1000);
    expect(r.engine.loads).toEqual([]);
    r.player.show();
    await r.clock.advance(1000);
    expect(r.list.calls).toHaveLength(2);
    expect(r.player.status.state).toBe('playing');
  });
});

describe('PlayerController: the redirect probe and the blocklist', () => {
  const redirecting = (r: { calls: string[] }): ControllerOptions => ({
    resolveUrl: (url) => {
      r.calls.push(url);
      return Promise.resolve(url.replace(PANEL, CDN));
    },
  });

  it("asks about the probe's answer when it differs, and gives up when it is blocked", async () => {
    const probes = { calls: [] as string[] };
    const r = rig(undefined, redirecting(probes));
    r.list.hosts = [CDN];
    void r.player.play(live(1));
    await r.clock.advance(5000);
    expect(r.list.asked()).toEqual([[`${PANEL}/live/u/p/1.ts`], [`${CDN}/live/u/p/1.ts`]]);
    expect(r.engine.loads).toEqual([]);
    expect(r.player.status).toMatchObject(BLOCKED);
    expect(probes.calls).toEqual([`${PANEL}/live/u/p/1.ts`]);
  });

  it("plays the probe's answer when it isn't blocked", async () => {
    const probes = { calls: [] as string[] };
    const r = rig(undefined, redirecting(probes));
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(r.engine.loads.map((l) => l.source.url)).toEqual([`${CDN}/live/u/p/1.ts`]);
    expect(r.player.status.state).toBe('playing');
  });

  it("doesn't probe a blocked URL, and asks once when the probe answers the same URL", async () => {
    const probes = { calls: [] as string[] };
    const blocked = rig(undefined, redirecting(probes));
    blocked.list.hosts = [PANEL];
    void blocked.player.play(live(1));
    await blocked.clock.advance(1000);
    expect(probes.calls).toEqual([]);
    const same = rig(undefined, { resolveUrl: (url) => Promise.resolve(url) });
    void same.player.play(live(1));
    await same.clock.advance(600);
    expect(same.list.asked()).toEqual([[`${PANEL}/live/u/p/1.ts`]]);
    expect(same.player.status.state).toBe('playing');
  });

  it("drops a late answer about the probe's URL after a zap", async () => {
    const probes = { calls: [] as string[] };
    const r = rig(undefined, redirecting(probes));
    r.list.hosts = [`${CDN}/live/u/p/1.`];
    r.list.delayMs = 200;
    void r.player.play(live(1));
    // The first answer at 200, the probe's asked at 200 and answered at 400: the zap at 300 wins.
    await r.clock.advance(300);
    void r.player.play(live(2));
    await r.clock.advance(2000);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:2' });
    expect(r.statuses.some((s) => s.state === 'failed')).toBe(false);
  });
});

describe('PlayerController: checkBlocklist (a config refresh)', () => {
  it('stops a playing stream whose server is now blocked: its tracks go, no watchdog or retry is left', async () => {
    const r = rig();
    r.engine.audio = [{ id: '0', lang: 'ara', label: '', selected: true }];
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(r.player.status.tracks.audio).toHaveLength(1);
    r.list.hosts = [PANEL];
    r.player.checkBlocklist();
    await r.clock.advance(0);
    expect(r.list.asked()[1]).toEqual([`${PANEL}/live/u/p/1.ts`]);
    expect(r.player.status).toMatchObject({ ...BLOCKED, key: 's1:live:1' });
    expect(r.player.status.tracks.audio).toEqual([]);
    await r.clock.advance(100);
    expect(r.engine.open).toBe(0);
    expect(r.clock.pending).toBe(0);
    // No retry follows, and nothing is asked again.
    r.player.checkBlocklist();
    await r.clock.advance(60_000);
    expect(r.list.calls).toHaveLength(2);
    expect(r.engine.loads).toHaveLength(1);
    expect(r.player.status).toMatchObject(BLOCKED);
  });

  it("asks about the URL that plays: the request's second when the first failed", async () => {
    const r = rig((s) => (s.container === 'ts' ? { frameMs: null, loadError: NETWORK } : {}));
    void r.player.play(live(1));
    await r.clock.advance(5000);
    expect(r.player.status).toMatchObject({ state: 'playing', container: 'hls' });
    r.list.hosts = [`${PANEL}/live/u/p/1.m3u8`];
    r.player.checkBlocklist();
    await r.clock.advance(0);
    expect(r.list.asked().pop()).toEqual([`${PANEL}/live/u/p/1.m3u8`]);
    expect(r.player.status).toMatchObject(BLOCKED);
  });

  it('stops a paused movie too, and leaves an allowed stream playing', async () => {
    const r = rig();
    void r.player.play(vod(1));
    await r.clock.advance(600);
    r.player.checkBlocklist();
    await r.clock.advance(100);
    expect(r.player.status.state).toBe('playing');
    r.player.pause();
    r.list.hosts = [PANEL];
    r.player.checkBlocklist();
    await r.clock.advance(100);
    expect(r.player.status).toMatchObject(BLOCKED);
  });

  it("asks about the probe's answer too", async () => {
    const r = rig(undefined, { resolveUrl: (url) => Promise.resolve(url.replace(PANEL, CDN)) });
    void r.player.play(live(1));
    await r.clock.advance(600);
    r.list.hosts = [CDN];
    r.player.checkBlocklist();
    await r.clock.advance(0);
    expect(r.list.asked()[2]).toEqual([`${PANEL}/live/u/p/1.ts`, `${CDN}/live/u/p/1.ts`]);
    expect(r.player.status).toMatchObject(BLOCKED);
  });

  it('asks about the URL opening, not the one before it, during a retry', async () => {
    const probes = { n: 0 };
    // The first load plays and fails; the reopen's probe hangs until the test looks.
    const r = rig((_s, n) => (n === 1 ? { frameMs: 500, error: { atMs: 1000, error: NETWORK } } : {}), {
      resolveUrl: (url) => {
        probes.n += 1;
        return probes.n === 1 ? Promise.resolve(url.replace(PANEL, CDN)) : new Promise<string>(() => undefined);
      },
    });
    void r.player.play(live(1));
    await r.clock.advance(1100);
    expect(r.player.status.state).toBe('reconnecting');
    r.player.checkBlocklist();
    await r.clock.advance(0);
    // The .ts reopens: its earlier probe answer (on the CDN) isn't the load's any more.
    expect(r.list.asked().pop()).toEqual([`${PANEL}/live/u/p/1.ts`]);
  });

  it('asks nothing while idle, between loads, after a failure or once a movie ended', async () => {
    const r = rig((s) => (s.url.indexOf('/movie/') !== -1 ? { endMs: 1000 } : s.url.indexOf('/7.') !== -1 ? { frameMs: null, loadError: { kind: 'unsupported', code: 'X' } } : {}));
    r.player.checkBlocklist();
    void r.player.play(vod(1));
    await r.clock.advance(1600);
    expect(r.player.status.state).toBe('ended');
    r.list.hosts = [PANEL];
    r.player.checkBlocklist();
    await r.clock.advance(100);
    expect(r.player.status.state).toBe('ended');
    r.list.hosts = [];
    void r.player.play(live(7));
    await r.clock.advance(5000);
    expect(r.player.status.state).toBe('failed');
    const before = r.list.calls.length;
    r.player.checkBlocklist();
    void r.player.stop();
    r.player.checkBlocklist();
    await r.clock.advance(100);
    expect(r.list.calls).toHaveLength(before);
  });

  it('asks nothing between loads (a retry waiting for its turn)', async () => {
    // Plays, then fails before each reopen's frame: the third attempt waits 1 s.
    const r = rig((_s, n) => (n === 1 ? { frameMs: 500, error: { atMs: 1000, error: NETWORK } } : { frameMs: null, error: { atMs: 300, error: NETWORK } }));
    const one: PlayRequest = { key: 's1:live:1', src: 's1', mode: 'live', candidates: [{ url: `${PANEL}/live/u/p/1.ts`, container: 'ts' }] };
    void r.player.play(one);
    await r.clock.advance(1500);
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 2 });
    const before = r.list.calls.length;
    r.list.hosts = [PANEL];
    r.player.checkBlocklist();
    await r.clock.advance(0);
    expect(r.list.calls).toHaveLength(before);
  });

  it('drops its answer when a zap or a stop came first', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(600);
    r.list.hosts = [`${PANEL}/live/u/p/1.`];
    r.list.delayMs = 300;
    r.player.checkBlocklist();
    void r.player.play(live(2));
    await r.clock.advance(1000);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:2' });
    r.list.hosts = [PANEL];
    r.player.checkBlocklist();
    void r.player.stop();
    await r.clock.advance(1000);
    expect(r.player.status.state).toBe('idle');
  });

  it('does nothing without a blocklist', async () => {
    const r = rig(undefined, { blocked: undefined });
    void r.player.play(live(1));
    await r.clock.advance(600);
    r.player.checkBlocklist();
    await r.clock.advance(100);
    expect(r.player.status.state).toBe('playing');
    expect(r.list.calls).toEqual([]);
  });

  it('while hidden: a blocked stream stops, and nothing resumes when the app is back', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(600);
    r.player.hide();
    r.list.hosts = [PANEL];
    r.player.checkBlocklist();
    await r.clock.advance(100);
    expect(r.player.status).toMatchObject(BLOCKED);
    r.player.show();
    await r.clock.advance(5000);
    expect(r.engine.log.indexOf('resume')).toBe(-1);
    expect(r.player.status).toMatchObject(BLOCKED);
    expect(r.engine.loads).toHaveLength(1);
  });
});
