import { describe, expect, it } from 'vitest';
import type { ControllerOptions, PlayerStatus } from './controller';
import { PlayerController } from './controller';
import type { EngineSource, PlaybackError } from './engine';
import type { FakeScript } from './fake-engine';
import { FakeClock, FakeEngine } from './fake-engine';
import type { AccountStatus } from './failure';
import type { PlayRequest } from './request';
import { MemorySourceMemory, streamCandidates } from './request';

const BASE = 'http://panel.example:8080';

/** A live Xtream channel of source `src`: `.ts`, then `.m3u8`. */
function live(id: number, src = 's1'): PlayRequest {
  return { key: `${src}:live:${id}`, src, mode: 'live', candidates: streamCandidates(`${BASE}/live/u/p/${id}.ts`, 'live') };
}

function vod(id: number, src = 's1'): PlayRequest {
  return { key: `${src}:movie:${id}`, src, mode: 'vod', candidates: streamCandidates(`${BASE}/movie/u/p/${id}.mp4`, 'vod') };
}

const NETWORK: PlaybackError = { kind: 'network', code: 'MEDIA_ERR_NETWORK' };

interface Rig {
  clock: FakeClock;
  engine: FakeEngine;
  player: PlayerController;
  statuses: PlayerStatus[];
  /** The states the listener saw, in order. */
  states(): string[];
}

/** A controller on a fake engine; `clock` is shared with the options' callbacks when given. */
function rig(script?: (source: EngineSource, n: number) => FakeScript, options: ControllerOptions = {}, clock = new FakeClock()): Rig {
  const engine = new FakeEngine(clock, script);
  const player = new PlayerController(engine, { clock, ...options });
  const statuses: PlayerStatus[] = [];
  player.subscribe((s) => statuses.push(s));
  return { clock, engine, player, statuses, states: () => statuses.map((s) => s.state) };
}

/** Every load starts after the previous load's connection closed. */
function expectCloseBeforeOpen(engine: FakeEngine): void {
  let open = false;
  for (const entry of engine.log) {
    if (entry.indexOf('load') === 0) {
      expect(open, `a load while a connection was open: ${engine.log.join(', ')}`).toBe(false);
      open = true;
    }
    if (entry === 'closed') open = false;
  }
  expect(engine.maxOpen).toBeLessThanOrEqual(1);
}

describe('PlayerController: the state machine', () => {
  it('opens, plays from the first frame, and reports the stream', async () => {
    const r = rig();
    void r.player.play(live(1));
    expect(r.player.status).toMatchObject({ state: 'opening', session: 1, key: 's1:live:1', container: 'ts', attempt: 0, failure: null });
    await r.clock.advance(450);
    expect(r.player.status.state).toBe('opening');
    await r.clock.advance(50);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:1', container: 'ts' });
    expect(r.engine.loads.map((l) => l.source)).toEqual([{ url: `${BASE}/live/u/p/1.ts`, container: 'ts', live: true }]);
    expect(r.states()).toEqual(['opening', 'playing']);
  });

  it('follows buffering and playing events once it plays, and ignores them before', async () => {
    const r = rig(() => ({ frameMs: 500, bufferingMs: 2000, playingMs: 4000 }));
    const early = rig(() => ({ frameMs: 1000, bufferingMs: 500, playingMs: 700 }));
    void r.player.play(live(1));
    void early.player.play(live(1));
    await r.clock.advance(2000);
    await early.clock.advance(800);
    expect(r.player.status.state).toBe('buffering');
    expect(early.player.status.state).toBe('opening');
    await r.clock.advance(2000);
    expect(r.player.status.state).toBe('playing');
    expect(r.states()).toEqual(['opening', 'playing', 'buffering', 'playing']);
    // A stray `playing` while playing changes nothing.
    r.engine.emit(r.engine.loads[0]!.token, { type: 'playing' });
    expect(r.statuses).toHaveLength(4);
  });

  it('pauses and resumes only a playing stream', async () => {
    const r = rig();
    void r.player.play(live(1));
    r.player.pause();
    r.player.resume();
    expect(r.player.status.state).toBe('opening');
    await r.clock.advance(500);
    r.player.pause();
    r.player.pause();
    expect(r.player.status.state).toBe('paused');
    r.player.resume();
    r.player.resume();
    expect(r.player.status.state).toBe('playing');
    expect(r.engine.log.filter((e) => e === 'pause' || e === 'play')).toEqual(['pause', 'play']);
    expect(r.states()).toEqual(['opening', 'playing', 'paused', 'playing']);
  });

  it('pauses while buffering', async () => {
    const r = rig(() => ({ bufferingMs: 1000 }));
    void r.player.play(live(1));
    await r.clock.advance(1000);
    r.player.pause();
    expect(r.player.status.state).toBe('paused');
  });

  it('stops: idle, nothing loaded, the connection closed, late events ignored', async () => {
    const r = rig(() => ({ frameMs: 500, error: { atMs: 900, error: NETWORK } }));
    r.engine.leaky = true;
    void r.player.play(live(1));
    await r.clock.advance(100);
    const stopped = r.player.stop();
    expect(r.player.status).toEqual({ state: 'idle', session: 2, key: null, container: null, attempt: 0, failure: null });
    await r.clock.advance(50);
    await stopped;
    expect(r.engine.open).toBe(0);
    await r.clock.advance(60_000);
    expect(r.player.status.state).toBe('idle');
    expect(r.engine.loads).toHaveLength(1);
    expect(r.states()).toEqual(['opening', 'idle']);
  });

  it('ends a VOD file and keeps the watchdog quiet after the end', async () => {
    const r = rig(() => ({ endMs: 3000 }));
    void r.player.play(vod(9));
    await r.clock.advance(3000);
    expect(r.player.status.state).toBe('ended');
    expect(r.clock.pending).toBe(0);
    await r.clock.advance(60_000);
    expect(r.player.status.state).toBe('ended');
    expect(r.engine.loads).toHaveLength(1);
  });

  it('reopens a live stream that ended', async () => {
    const r = rig((_s, n) => ({ endMs: n === 1 ? 3000 : undefined }));
    void r.player.play(live(1));
    await r.clock.advance(3000);
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 1 });
    await r.clock.advance(550);
    expect(r.player.status).toMatchObject({ state: 'playing', attempt: 0 });
    expect(r.engine.loads.map((l) => l.source.container)).toEqual(['ts', 'ts']);
  });

  it('fails a request without URLs as an app error and stops what played', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(500);
    void r.player.play({ key: 's1:live:2', src: 's1', mode: 'live', candidates: [] });
    await r.clock.advance(100);
    expect(r.player.status).toMatchObject({ state: 'failed', key: 's1:live:2', container: null, failure: { category: 'app', code: 'APP-ERROR', detail: 'NO_URL' } });
    expect(r.engine.open).toBe(0);
    // A late event of the old stream changes nothing.
    r.engine.emit(r.engine.loads[0]!.token, { type: 'error', error: NETWORK });
    expect(r.player.status.state).toBe('failed');
  });

  it('lets listeners go, and lets go of the engine on dispose', async () => {
    const r = rig();
    const seen: string[] = [];
    const off = r.player.subscribe((s) => seen.push(s.state));
    void r.player.play(live(1));
    off();
    await r.clock.advance(500);
    expect(seen).toEqual(['opening']);
    expect(r.engine.listenerCount).toBe(1);
    r.player.dispose();
    expect(r.engine.listenerCount).toBe(0);
    expect(r.player.status.state).toBe('idle');
    await r.clock.advance(50);
    expect(r.engine.open).toBe(0);
    const count = r.statuses.length;
    void r.player.play(live(2));
    expect(r.statuses).toHaveLength(count);
  });
});

describe('PlayerController: zapping races', () => {
  it('awaits the stop before the next load and skips the zaps that came meanwhile', async () => {
    const r = rig();
    r.engine.stopMs = 300;
    void r.player.play(live(1));
    await r.clock.advance(100);
    void r.player.play(live(2));
    await r.clock.advance(100);
    void r.player.play(live(3));
    // Channel 1 is still closing: nothing new loads.
    await r.clock.advance(150);
    expect(r.engine.loads).toHaveLength(1);
    await r.clock.advance(50);
    expect(r.engine.loads.map((l) => l.source.url)).toEqual([`${BASE}/live/u/p/1.ts`, `${BASE}/live/u/p/3.ts`]);
    expect(r.engine.log).toEqual(['stop', 'load 1 ts', 'stop', 'closed', 'load 3 ts']);
    expectCloseBeforeOpen(r.engine);
    await r.clock.advance(500);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:3', session: 3 });
    expect(r.statuses.filter((s) => s.state === 'playing').map((s) => s.key)).toEqual(['s1:live:3']);
  });

  it("doesn't count the old load's abort as a failure of the new stream", async () => {
    // Channel 1's load takes 300 ms; the zap at 100 aborts it (the engine rejects the pending load).
    const r = rig(() => ({ loadMs: 300, frameMs: 400 }));
    void r.player.play(live(1));
    await r.clock.advance(100);
    void r.player.play(live(2));
    await r.clock.advance(1000);
    expect(r.engine.loads.map((l) => l.source.url)).toEqual([`${BASE}/live/u/p/1.ts`, `${BASE}/live/u/p/2.ts`]);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:2', container: 'ts', attempt: 0 });
    expect(r.statuses.every((s) => s.attempt === 0)).toBe(true);
  });

  it('drops events that carry an old token', async () => {
    // A leaky engine: channel 1's frame (500) and error (800) still arrive after the zap.
    const r = rig((s) => (s.url.indexOf('/1.ts') !== -1 ? { frameMs: 500, error: { atMs: 800, error: NETWORK } } : { frameMs: 600 }));
    r.engine.leaky = true;
    void r.player.play(live(1));
    await r.clock.advance(100);
    void r.player.play(live(2));
    await r.clock.advance(50);
    expect(r.engine.loads).toHaveLength(2);
    await r.clock.advance(350);
    // Channel 1's frame at 500: still opening channel 2.
    expect(r.player.status).toMatchObject({ state: 'opening', key: 's1:live:2' });
    await r.clock.advance(250);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:2' });
    await r.clock.advance(100);
    // Channel 1's error at 800, and a hand-made stale one: no retry, no failure.
    r.engine.emit(1, { type: 'ended' });
    await r.clock.advance(5000);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:2', attempt: 0 });
    expect(r.engine.loads).toHaveLength(2);
  });

  it('never loads a stale zap that was waiting for the redirect probe', async () => {
    const clock = new FakeClock();
    const probed: string[] = [];
    const r = rig(
      undefined,
      {
        resolveUrl: (url) =>
          new Promise((resolve) => {
            probed.push(url);
            clock.setTimeout(() => resolve(`${url}?final`), 300);
          }),
      },
      clock,
    );
    void r.player.play(live(1));
    await clock.advance(100);
    void r.player.play(live(2));
    await clock.advance(400);
    expect(probed).toEqual([`${BASE}/live/u/p/1.ts`, `${BASE}/live/u/p/2.ts`]);
    expect(r.engine.loads.map((l) => l.source.url)).toEqual([`${BASE}/live/u/p/2.ts?final`]);
  });

  it('cancels a pending retry on a zap', async () => {
    // Movie 1 plays, fails at 1000, and its reopens fail before a frame.
    const r = rig((s, n) => (s.url.indexOf('/1.') === -1 ? {} : n === 1 ? { frameMs: 500, error: { atMs: 1000, error: NETWORK } } : { frameMs: null, error: { atMs: 300, error: NETWORK } }));
    void r.player.play(vod(1));
    // One URL: reopened at once (loaded at 1050), failed again at 1350, so the next waits 1 s.
    await r.clock.advance(1800);
    expect(r.engine.loads).toHaveLength(2);
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 2 });
    // Zap away while the retry waits.
    void r.player.play(live(2));
    await r.clock.advance(5000);
    expect(r.engine.loads.map((l) => l.source.url)).toEqual([`${BASE}/movie/u/p/1.mp4`, `${BASE}/movie/u/p/1.mp4`, `${BASE}/live/u/p/2.ts`]);
    expect(r.player.status).toMatchObject({ state: 'playing', key: 's1:live:2' });
  });

  it('keeps fifty random zaps in order: one connection, close before open, the last one plays', async () => {
    let seed = 20261104;
    const random = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const r = rig(() => ({ loadMs: 50 * random(4), frameMs: 300 + 50 * random(6) }));
    r.engine.stopMs = 120;
    r.engine.leaky = true;
    let requested = '';
    r.player.subscribe((s) => {
      if (s.state === 'playing') expect(s.key).toBe(requested);
    });
    for (let i = 0; i < 50; i++) {
      const req = live(1 + random(5), random(2) === 0 ? 's1' : 's2');
      requested = req.key;
      void r.player.play(req);
      await r.clock.advance(50 * random(14));
    }
    await r.clock.advance(5000);
    expectCloseBeforeOpen(r.engine);
    expect(r.player.status).toMatchObject({ state: 'playing', key: requested, attempt: 0 });
    const tokens = r.engine.loads.map((l) => l.token);
    expect(tokens.slice().sort((a, b) => a - b)).toEqual(tokens);
    // No load ever failed, so no zap left its first URL.
    expect(r.engine.loads.every((l) => l.source.container === 'ts')).toBe(true);
    expect(r.engine.loads.length).toBeLessThan(50);
  });
});

describe('PlayerController: the watchdog', () => {
  it('reopens a live stream whose position stopped for 6 s while playing', async () => {
    // Frame at 500; the picture freezes at 3200; the 3500 tick is the last to see it move.
    const r = rig((_s, n) => ({ frameMs: 500, freezeMs: n === 1 ? 3200 : undefined }));
    void r.player.play(live(1));
    await r.clock.advance(9450);
    expect(r.player.status.state).toBe('playing');
    await r.clock.advance(50);
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 1, container: 'ts' });
    // Reopened at the live edge, after the stop.
    await r.clock.advance(50);
    expect(r.engine.loads).toHaveLength(2);
    expect(r.engine.loads[1]!.opts).toEqual({});
    expectCloseBeforeOpen(r.engine);
    await r.clock.advance(500);
    expect(r.player.status).toMatchObject({ state: 'playing', attempt: 0 });
  });

  it('never calls a frozen VOD file a stall; only buffering counts there', async () => {
    const r = rig(() => ({ freezeMs: 1000 }));
    void r.player.play(vod(1));
    await r.clock.advance(60_000);
    expect(r.player.status.state).toBe('playing');
    expect(r.engine.loads).toHaveLength(1);
  });

  it('reopens live after 12 s of buffering, and not on the frozen rule meanwhile', async () => {
    const r = rig((_s, n) => ({ bufferingMs: n === 1 ? 2000 : undefined }));
    void r.player.play(live(1));
    await r.clock.advance(13_950);
    expect(r.player.status.state).toBe('buffering');
    expect(r.engine.loads).toHaveLength(1);
    await r.clock.advance(50);
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 1 });
  });

  it('waits 20 s of buffering on VOD', async () => {
    const r = rig((_s, n) => ({ bufferingMs: n === 1 ? 2000 : undefined }));
    void r.player.play(vod(1));
    await r.clock.advance(21_950);
    expect(r.player.status.state).toBe('buffering');
    await r.clock.advance(50);
    expect(r.player.status.state).toBe('reconnecting');
  });

  it('counts the frozen time again from a buffering that ended', async () => {
    // Buffering from 2000 to 10000, playing on after it.
    const r = rig(() => ({ bufferingMs: 2000, playingMs: 10_000 }));
    void r.player.play(live(1));
    await r.clock.advance(30_000);
    expect(r.player.status.state).toBe('playing');
    expect(r.engine.loads).toHaveLength(1);
  });

  it('rests while paused, and counts the frozen time from the resume', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(1000);
    r.player.pause();
    expect(r.clock.pending).toBe(0);
    await r.clock.advance(60_000);
    expect(r.player.status.state).toBe('paused');
    expect(r.engine.loads).toHaveLength(1);
    // An engine that resumes without moving: a stall 6 s after the resume, not at once.
    r.engine.resumeMoves = false;
    r.player.resume();
    await r.clock.advance(5500);
    expect(r.player.status.state).toBe('playing');
    await r.clock.advance(500);
    expect(r.player.status.state).toBe('reconnecting');
  });

  it('times out an open after 10 s and tries the .m3u8 URL next', async () => {
    const r = rig((s) => ({ frameMs: s.container === 'ts' ? null : 500 }));
    void r.player.play(live(1));
    await r.clock.advance(9950);
    expect(r.player.status).toMatchObject({ state: 'opening', attempt: 0 });
    await r.clock.advance(50);
    // Nothing played yet: still "opening", on the next URL.
    expect(r.player.status).toMatchObject({ state: 'opening', attempt: 1, container: 'hls' });
    await r.clock.advance(550);
    expect(r.player.status).toMatchObject({ state: 'playing', container: 'hls' });
    expect(r.engine.loads.map((l) => l.source.container)).toEqual(['ts', 'hls']);
  });

  it('gives up after 4 attempts within 60 s: the error card', async () => {
    const r = rig(() => ({ frameMs: null }));
    void r.player.play(live(1));
    // Opens at 0, then retries at 10 s (.m3u8), 20 s (reopen), 30 s (switch), 41 s (after 1 s; the
    // connection closed long before, so that load needs no wait).
    await r.clock.advance(50_950);
    expect(r.player.status).toMatchObject({ state: 'opening', attempt: 4 });
    expect(r.engine.loads.map((l) => [l.at, l.source.container])).toEqual([
      [0, 'ts'],
      [10_050, 'hls'],
      [20_050, 'hls'],
      [30_050, 'ts'],
      [41_000, 'ts'],
    ]);
    await r.clock.advance(50);
    expect(r.player.status).toMatchObject({ state: 'failed', key: 's1:live:1', failure: { category: 'provider', code: 'PRV-TIMEOUT', detail: 'OPEN', account: null } });
    await r.clock.advance(60_000);
    expect(r.engine.loads).toHaveLength(5);
    expect(r.engine.open).toBe(0);
  });

  it('shows "reconnecting" for retries after the stream played, and starts the ladder over after a frame', async () => {
    // Every load plays, then fails 1 s after its frame.
    const r = rig(() => ({ frameMs: 500, error: { atMs: 1500, error: NETWORK } }));
    void r.player.play(live(1));
    await r.clock.advance(1500);
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 1 });
    await r.clock.advance(550);
    expect(r.player.status).toMatchObject({ state: 'playing', attempt: 0 });
    // The ladder restarted at "reopen" each time: always the .ts URL. Four in 60 s, then the card.
    await r.clock.advance(10_000);
    expect(r.engine.loads.map((l) => l.source.container)).toEqual(['ts', 'ts', 'ts', 'ts', 'ts']);
    expect(r.player.status).toMatchObject({ state: 'failed', failure: { code: 'PRV-UNREACHABLE' } });
  });
});

describe('PlayerController: retries and URLs', () => {
  it('reopens VOD where it stopped, and at the requested start before it played', async () => {
    const r = rig((_s, n) => (n === 1 ? { frameMs: 500, error: { atMs: 5000, error: NETWORK } } : n === 2 ? { frameMs: null, error: { atMs: 300, error: NETWORK } } : {}));
    void r.player.play(vod(1), { startMs: 60_000 });
    await r.clock.advance(5050);
    // The last tick before the error (4500) saw 64000.
    expect(r.engine.loads.map((l) => l.opts)).toEqual([{ startMs: 60_000 }, { startMs: 64_000 }]);
    // The second load fails before a frame (at 5350): the retry after 1 s still starts at 64000.
    await r.clock.advance(1400);
    expect(r.engine.loads[2]!.opts).toEqual({ startMs: 64_000 });
    const fresh = rig((_s, n) => (n === 1 ? { frameMs: null, error: { atMs: 300, error: NETWORK } } : {}));
    void fresh.player.play(vod(2), { startMs: 7000 });
    await fresh.clock.advance(400);
    expect(fresh.engine.loads.map((l) => l.opts)).toEqual([{ startMs: 7000 }, { startMs: 7000 }]);
    const plain = rig();
    void plain.player.play(vod(3));
    await plain.clock.advance(100);
    // Live always starts at the live edge.
    void plain.player.play(live(4), { startMs: 5000 });
    await plain.clock.advance(100);
    expect(plain.engine.loads.map((l) => l.opts)).toEqual([{}, {}]);
  });

  it("remembers the source's container that played, for live requests only", async () => {
    const memory = new MemorySourceMemory();
    const r = rig((s) => (s.container === 'ts' ? { loadError: { kind: 'http', code: 'PROBE', status: 404 } } : {}), { memory });
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(r.player.status).toMatchObject({ state: 'playing', container: 'hls' });
    expect(memory.preferred('s1')).toBe('hls');
    // A VOD play of the same source leaves it alone.
    void r.player.play(vod(5));
    await r.clock.advance(600);
    expect(memory.preferred('s1')).toBe('hls');
    // The next channel of the source starts with .m3u8; another source with .ts.
    void r.player.play(live(2));
    await r.clock.advance(600);
    void r.player.play(live(3, 's2'));
    await r.clock.advance(100);
    expect(memory.preferred('s2')).toBeNull();
    expect(r.engine.loads.map((l) => l.source.container)).toEqual(['ts', 'hls', 'mp4', 'hls', 'ts', 'hls']);
  });

  it('goes back to the .m3u8 that played when the switch to .ts fails for good (RELAY step 20a)', async () => {
    const unsupported: PlaybackError = { kind: 'unsupported', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
    const memory = new MemorySourceMemory();
    memory.remember('s1', 'hls');
    const script = (recovers: boolean) => (source: EngineSource, n: number): FakeScript => {
      if (source.container === 'ts') return { loadError: unsupported };
      if (n === 1) return { error: { atMs: 1000, error: NETWORK } };
      return recovers && n === 4 ? {} : { loadError: NETWORK };
    };
    const back = rig(script(true), { memory });
    void back.player.play(live(1));
    await back.clock.advance(20_000);
    expect(back.engine.loads.map((l) => l.source.container)).toEqual(['hls', 'hls', 'ts', 'hls']);
    expect(back.player.status).toMatchObject({ state: 'playing', container: 'hls' });
    // When the .m3u8 never comes back, the verdict is the provider's, not "this TV can't play this".
    const gone = rig(script(false), { memory });
    void gone.player.play(live(1));
    await gone.clock.advance(30_000);
    expect(gone.engine.loads.map((l) => l.source.container)).toEqual(['hls', 'hls', 'ts', 'hls', 'hls']);
    expect(gone.player.status).toMatchObject({ state: 'failed', failure: { category: 'provider', code: 'PRV-UNREACHABLE' } });
  });

  it('gives up at once when every URL failed definitively', async () => {
    const r = rig(() => ({ loadError: { kind: 'http', code: 'PROBE', status: 404 } }));
    void r.player.play(live(1));
    await r.clock.advance(5000);
    expect(r.engine.loads).toHaveLength(2);
    expect(r.player.status).toMatchObject({ state: 'failed', failure: { category: 'provider', code: 'PRV-HTTP-404' } });
  });

  it('re-probes on its rung and plays what the probe answers', async () => {
    const calls: [string, string, boolean][] = [];
    // The first load plays and fails 1.5 s in; the others fail before a frame.
    const r = rig((_s, n) => (n === 1 ? { frameMs: 500, error: { atMs: 1500, error: NETWORK } } : { frameMs: null, error: { atMs: 300, error: NETWORK } }), {
      resolveUrl: (url, src, fresh) => {
        calls.push([url, src, fresh]);
        return Promise.resolve(`${url}?r=${calls.length}`);
      },
    });
    const one: PlayRequest = { key: 's1:live:1', src: 's1', mode: 'live', candidates: [{ url: `${BASE}/live/u/p/1.ts`, container: 'ts' }] };
    void r.player.play(one);
    // Fails at 1500 and reopens (the probe's remembered answer); that load fails at 1850 and re-probes.
    await r.clock.advance(1550);
    expect(calls.map((c) => c[2])).toEqual([false, false]);
    await r.clock.advance(350);
    expect(calls.map((c) => c[2])).toEqual([false, false, true]);
    expect(calls.every((c) => c[0] === `${BASE}/live/u/p/1.ts` && c[1] === 's1')).toBe(true);
    expect(r.engine.loads.map((l) => l.source.url)).toEqual([`${BASE}/live/u/p/1.ts?r=1`, `${BASE}/live/u/p/1.ts?r=2`, `${BASE}/live/u/p/1.ts?r=3`]);
  });

  it('treats a failed probe as a failure of its URL', async () => {
    const r = rig(undefined, {
      resolveUrl: (url) => (url.indexOf('.ts') !== -1 ? Promise.reject({ kind: 'http', code: 'PROBE', status: 403 }) : Promise.resolve(url)),
    });
    void r.player.play(live(1));
    await r.clock.advance(600);
    expect(r.engine.loads.map((l) => l.source.container)).toEqual(['hls']);
    expect(r.player.status.state).toBe('playing');
  });

  it('calls anything an engine throws an app error', async () => {
    const r = rig();
    r.engine.load = () => Promise.reject(new Error('boom'));
    void r.player.play(live(1));
    await r.clock.advance(10_000);
    expect(r.player.status).toMatchObject({ state: 'failed', failure: { category: 'app', code: 'APP-ERROR', detail: 'EXCEPTION' } });
  });
});

describe('PlayerController: the error card', () => {
  const failing = (): FakeScript => ({ loadError: { kind: 'unsupported', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' } });
  const one = (src = 's1'): PlayRequest => ({ key: `${src}:live:1`, src, mode: 'live', candidates: [{ url: `${BASE}/live/u/p/1.ts`, container: 'ts' }] });

  it('says "your internet" when the TV is offline', async () => {
    let asked = 0;
    const r = rig(() => ({ loadError: NETWORK }), {
      online: () => Promise.resolve(false),
      checkAccount: () => {
        asked++;
        return Promise.resolve(null);
      },
    });
    void r.player.play(vod(1));
    await r.clock.advance(20_000);
    expect(r.player.status.failure).toMatchObject({ category: 'internet', code: 'NET-OFFLINE' });
    expect(asked).toBe(0);
  });

  it("re-checks the account and shows what it says", async () => {
    const expired: AccountStatus = { auth: true, status: 'Expired', expDate: 1_700_000_000, activeCons: 0, maxConnections: 1 };
    const asked: string[] = [];
    const r = rig(failing, {
      checkAccount: (src) => {
        asked.push(src);
        return Promise.resolve(expired);
      },
    });
    void r.player.play(one('s7'));
    await r.clock.advance(100);
    expect(asked).toEqual(['s7']);
    expect(r.player.status).toMatchObject({ state: 'failed', failure: { category: 'provider', code: 'PRV-EXPIRED', account: expired } });
  });

  it('keeps the stream verdict when the account check fails or finds nothing', async () => {
    const thrown = rig(failing, { checkAccount: () => Promise.reject(new Error('offline')) });
    void thrown.player.play(one());
    await thrown.clock.advance(100);
    expect(thrown.player.status.failure).toMatchObject({ category: 'device', code: 'TV-UNSUPPORTED', account: null });
    const fine = rig(failing, { checkAccount: () => Promise.resolve({ auth: true, status: 'Active', expDate: null, activeCons: 0, maxConnections: 2 }) });
    void fine.player.play(one());
    await fine.clock.advance(100);
    expect(fine.player.status.failure).toMatchObject({ category: 'device', code: 'TV-UNSUPPORTED', account: { status: 'Active' } });
  });

  it('treats a broken connectivity check as online', async () => {
    const r = rig(failing, {
      online: () => {
        throw new Error('no idea');
      },
    });
    void r.player.play(one());
    await r.clock.advance(100);
    expect(r.player.status.failure).toMatchObject({ category: 'device', code: 'TV-UNSUPPORTED' });
  });

  it('does not re-check the account for app errors', async () => {
    let asked = 0;
    const r = rig(undefined, {
      checkAccount: () => {
        asked++;
        return Promise.resolve(null);
      },
    });
    void r.player.play({ key: 'k', src: 's1', mode: 'vod', candidates: [] });
    await r.clock.advance(100);
    expect(r.player.status.failure).toMatchObject({ category: 'app' });
    expect(asked).toBe(0);
  });

  it('drops a verdict that arrives after a zap', async () => {
    const clock = new FakeClock();
    const slow = (ms: number) => <T,>(value: T) => new Promise<T>((resolve) => clock.setTimeout(() => resolve(value), ms));
    for (const which of ['online', 'account'] as const) {
      const engine = new FakeEngine(clock, (s) => (s.url.indexOf('/1.') !== -1 ? failing() : {}));
      const player = new PlayerController(engine, {
        clock,
        online: which === 'online' ? () => slow(1000)(true) : () => true,
        checkAccount: which === 'account' ? () => slow(1000)(null) : undefined,
      });
      void player.play(one());
      await clock.advance(100);
      void player.play(live(2));
      await clock.advance(2000);
      expect(player.status, which).toMatchObject({ state: 'playing', key: 's1:live:2', failure: null });
    }
  });
});

describe('PlayerController: the screensaver (RELAY step 19)', () => {
  it('keeps it away while a stream opens, plays and buffers, and lets it back when paused, ended or stopped', async () => {
    const calls: boolean[] = [];
    const r = rig(() => ({ frameMs: 500, bufferingMs: 1000, playingMs: 1500, endMs: 4000 }), { screenSaver: (allowed) => calls.push(allowed) });
    // The TV's default (allowed) is where it starts: nothing to say yet.
    expect(calls).toEqual([]);
    void r.player.play(vod(1));
    expect(calls).toEqual([false]);
    await r.clock.advance(2000);
    expect(r.states()).toEqual(['opening', 'playing', 'buffering', 'playing']);
    expect(calls).toEqual([false]);
    r.player.pause();
    expect(calls).toEqual([false, true]);
    r.player.resume();
    expect(calls).toEqual([false, true, false]);
    await r.clock.advance(2000);
    expect(r.player.status.state).toBe('ended');
    expect(calls).toEqual([false, true, false, true]);
    void r.player.play(live(2));
    void r.player.play(live(3));
    expect(calls).toEqual([false, true, false, true, false]);
    void r.player.stop();
    expect(calls).toEqual([false, true, false, true, false, true]);
  });

  it('stays away through a reconnect, and comes back when the player gives up', async () => {
    const calls: boolean[] = [];
    const unsupported: PlaybackError = { kind: 'unsupported', code: 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT' };
    const r = rig((_source, n) => (n === 1 ? { error: { atMs: 1000, error: NETWORK } } : { loadError: unsupported }), { screenSaver: (allowed) => calls.push(allowed) });
    void r.player.play(live(1));
    await r.clock.advance(1000);
    expect(r.player.status.state).toBe('reconnecting');
    expect(calls).toEqual([false]);
    await r.clock.advance(20_000);
    expect(r.player.status.state).toBe('failed');
    expect(calls).toEqual([false, true]);
  });
});

describe('PlayerController: the app lifecycle (RELAY step 20a)', () => {
  it('suspends a stream that plays while hidden: the watchdog rests, its events are dropped, and show resumes it', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(500);
    expect(r.player.status.state).toBe('playing');
    r.player.hide();
    expect(r.engine.log.slice(-1)).toEqual(['suspend']);
    expect(r.engine.open).toBe(0);
    // Far past the 6 s frozen rule and the open timeout: nothing happens while hidden.
    await r.clock.advance(30_000);
    r.engine.emit(1, { type: 'error', error: NETWORK });
    r.engine.emit(1, { type: 'ended' });
    expect(r.engine.loads).toHaveLength(1);
    expect(r.player.status.state).toBe('playing');
    r.player.show();
    expect(r.engine.log.slice(-1)).toEqual(['resume']);
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 0 });
    await r.clock.advance(500);
    expect(r.player.status.state).toBe('playing');
    expect(r.engine.loads).toHaveLength(1);
    expect(r.states()).toEqual(['opening', 'playing', 'reconnecting', 'playing']);
  });

  it('suspends a buffering or paused stream too, and only once', async () => {
    const buffering = rig(() => ({ bufferingMs: 1000 }));
    void buffering.player.play(live(1));
    await buffering.clock.advance(1000);
    expect(buffering.player.status.state).toBe('buffering');
    buffering.player.hide();
    buffering.player.hide();
    await buffering.clock.advance(30_000);
    expect(buffering.engine.log.filter((e) => e === 'suspend')).toHaveLength(1);
    expect(buffering.engine.loads).toHaveLength(1);
    const paused = rig();
    void paused.player.play(vod(1));
    await paused.clock.advance(500);
    paused.player.pause();
    paused.player.hide();
    expect(paused.engine.log.slice(-1)).toEqual(['suspend']);
    paused.player.show();
    await paused.clock.advance(500);
    expect(paused.player.status.state).toBe('playing');
  });

  it('times out a resume that shows no picture, and reopens by the ladder', async () => {
    const r = rig();
    r.engine.resumeFrameMs = null;
    void r.player.play(live(1));
    await r.clock.advance(500);
    r.player.hide();
    r.player.show();
    await r.clock.advance(9_950);
    expect(r.engine.loads).toHaveLength(1);
    await r.clock.advance(100);
    expect(r.engine.loads).toHaveLength(2);
    expect(r.engine.loads[1]?.source.container).toBe('ts');
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 1 });
  });

  it('closes a stream that is still opening, and opens it again on show', async () => {
    const r = rig(() => ({ frameMs: 2000 }));
    void r.player.play(live(1));
    await r.clock.advance(300);
    r.player.hide();
    await r.clock.advance(30_000);
    expect(r.engine.log).toEqual(['stop', 'load 1 ts', 'stop', 'closed']);
    expect(r.player.status.state).toBe('opening');
    r.player.show();
    await r.clock.advance(2000);
    expect(r.engine.loads.map((l) => l.source.url)).toEqual([`${BASE}/live/u/p/1.ts`, `${BASE}/live/u/p/1.ts`]);
    expect(r.player.status).toMatchObject({ state: 'playing', attempt: 0 });
    expectCloseBeforeOpen(r.engine);
  });

  it('drops a retry waiting out its backoff while hidden, and retries on show', async () => {
    const r = rig((_source, n) => (n === 1 ? { error: { atMs: 1000, error: NETWORK } } : { loadError: NETWORK }));
    void r.player.play(vod(1));
    await r.clock.advance(1100);
    // The first rung reopened at once and failed: a 1 s backoff waits.
    expect(r.engine.loads).toHaveLength(2);
    expect(r.player.status.state).toBe('reconnecting');
    r.player.hide();
    await r.clock.advance(30_000);
    expect(r.engine.loads).toHaveLength(2);
    r.player.show();
    await r.clock.advance(100);
    expect(r.engine.loads).toHaveLength(3);
    expectCloseBeforeOpen(r.engine);
  });

  it("doesn't reopen a stream that gave up while hidden", async () => {
    let answer: (account: AccountStatus | null) => void = () => undefined;
    const r = rig(() => ({ loadError: { kind: 'http', code: 'HTTP', status: 404 } }), {
      checkAccount: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    void r.player.play({ key: 's1:live:1', src: 's1', mode: 'live', candidates: [{ url: `${BASE}/live/u/p/1.ts`, container: 'ts' }] });
    await r.clock.advance(100);
    // The verdict waits for the account check: still opening.
    expect(r.player.status.state).toBe('opening');
    r.player.hide();
    answer(null);
    await r.clock.advance(100);
    expect(r.player.status.state).toBe('failed');
    r.player.show();
    await r.clock.advance(20_000);
    expect(r.engine.loads).toHaveLength(1);
    expect(r.player.status.state).toBe('failed');
  });

  it('has nothing to do while idle, and a play or stop while hidden forgets the hide', async () => {
    const r = rig();
    r.player.hide();
    r.player.show();
    r.player.hide();
    void r.player.play(live(1));
    await r.clock.advance(500);
    // Its events count: the hide before the play is forgotten.
    expect(r.player.status.state).toBe('playing');
    r.player.hide();
    void r.player.stop();
    r.player.show();
    await r.clock.advance(1000);
    expect(r.engine.log.indexOf('resume')).toBe(-1);
    expect(r.player.status.state).toBe('idle');
  });
});
