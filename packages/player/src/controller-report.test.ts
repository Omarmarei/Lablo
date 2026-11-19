import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControllerOptions, PlayerReport } from './controller';
import { PlayerController } from './controller';
import type { EngineSource, PlaybackError } from './engine';
import type { FakeScript } from './fake-engine';
import { FakeClock, FakeEngine } from './fake-engine';
import type { PlayRequest } from './request';
import { streamCandidates } from './request';

/**
 * Telemetry's reports (RELAY step 33b2): each play's result once, at its first frame or at its
 * give-up before one, and each stall's end, recovered or given up, with its retries.
 */

const BASE = 'http://panel.example:8080';
const NETWORK: PlaybackError = { kind: 'network', code: 'MEDIA_ERR_NETWORK' };

function live(id: number): PlayRequest {
  return { key: `s1:live:${id}`, src: 's1', mode: 'live', candidates: streamCandidates(`${BASE}/live/u/p/${id}.ts`, 'live') };
}

function vod(id: number): PlayRequest {
  return { key: `s1:movie:${id}`, src: 's1', mode: 'vod', candidates: streamCandidates(`${BASE}/movie/u/p/${id}.mp4`, 'vod') };
}

function catchup(id: number): PlayRequest {
  return { key: `s1:live:${id}`, src: 's1', mode: 'catchup', candidates: streamCandidates(`${BASE}/timeshift/u/p/60/2026-11-19:20-00/${id}.m3u8`, 'catchup') };
}

interface Rig {
  clock: FakeClock;
  engine: FakeEngine;
  player: PlayerController;
  reports: PlayerReport[];
}

function rig(script?: (source: EngineSource, n: number) => FakeScript, options: ControllerOptions = {}): Rig {
  const clock = new FakeClock();
  const engine = new FakeEngine(clock, script);
  const reports: PlayerReport[] = [];
  const player = new PlayerController(engine, { clock, report: (report) => reports.push(report), ...options });
  return { clock, engine, player, reports };
}

/** A play's report as the controller makes it. */
function played(fields: Partial<Extract<PlayerReport, { type: 'play' }>>): PlayerReport {
  return { type: 'play', engine: 'html5', container: 'ts', mode: 'live', ttffMs: null, error: null, ...fields };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlayerController: a play reports its result once (RELAY step 33b2)', () => {
  it('at its first frame: the time from play(), the engine, the container and the mode', async () => {
    const r = rig(() => ({ frameMs: 700 }));
    await r.clock.advance(250);
    void r.player.play(live(1));
    await r.clock.advance(699);
    expect(r.reports).toEqual([]);
    await r.clock.advance(1);
    expect(r.reports).toEqual([played({ ttffMs: 700 })]);
    await r.clock.advance(5000);
    expect(r.reports).toHaveLength(1);
  });

  it("names the engine and the container that played, and the request's mode", async () => {
    const r = rig((source) => ({ frameMs: source.container === 'mp4' ? 300 : 400 }));
    // The engine at the moment of the report (a fallback engine names the one that played).
    Object.defineProperty(r.engine, 'kind', { value: 'avplay' });
    void r.player.play(vod(1));
    await r.clock.advance(300);
    // A zap: the first play's connection closes in 50 ms, then the next one loads.
    void r.player.play(catchup(2));
    await r.clock.advance(450);
    expect(r.reports).toEqual([played({ engine: 'avplay', container: 'mp4', mode: 'vod', ttffMs: 300 }), played({ engine: 'avplay', container: 'hls', mode: 'catchup', ttffMs: 450 })]);
  });

  it('counts the retries before the first frame in its time, and names the URL that played', async () => {
    // The .ts URL never shows a frame: the open times out at 10 s and the .m3u8 plays.
    const r = rig((source) => ({ frameMs: source.container === 'ts' ? null : 500 }));
    void r.player.play(live(1));
    await r.clock.advance(10_600);
    expect(r.reports).toEqual([played({ container: 'hls', ttffMs: 10_550 })]);
  });

  it('at its give-up before any frame: no time, the last error and the URL it was on', async () => {
    const http: PlaybackError = { kind: 'http', code: 'PROBE_HTTP', status: 404 };
    const refused = rig(() => ({ loadError: http, frameMs: null }));
    void refused.player.play(live(1));
    await refused.clock.advance(100);
    // Both URLs answered 404 (definitive): given up at once, on the .m3u8.
    expect(refused.player.status.state).toBe('failed');
    expect(refused.reports).toEqual([played({ container: 'hls', error: http })]);

    const silent = rig(() => ({ frameMs: null }));
    void silent.player.play(live(1));
    await silent.clock.advance(51_000);
    expect(silent.player.status.state).toBe('failed');
    expect(silent.reports).toEqual([played({ error: { kind: 'timeout', code: 'OPEN' } })]);
    await silent.clock.advance(60_000);
    expect(silent.reports).toHaveLength(1);
  });

  it("reports a request with no URL as the app's error, its container 'other'", async () => {
    const r = rig();
    await r.player.play({ key: 's1:movie:9', src: 's1', mode: 'vod', candidates: [] });
    expect(r.reports).toEqual([played({ container: 'other', mode: 'vod', error: { kind: 'app', code: 'NO_URL' } })]);
  });

  it('reports nothing for a play left before either, or refused by the blocklist', async () => {
    const r = rig(() => ({ frameMs: 2000 }));
    void r.player.play(live(1));
    await r.clock.advance(300);
    // A zap: the first play is left.
    void r.player.play(live(2));
    await r.clock.advance(1000);
    void r.player.stop();
    await r.clock.advance(5000);
    expect(r.reports).toEqual([]);
    void r.player.play(live(3));
    await r.clock.advance(2000);
    expect(r.reports).toEqual([played({ ttffMs: 2000 })]);

    const blocked = rig(undefined, { blocked: (urls) => Promise.resolve(urls.map(() => true)) });
    void blocked.player.play(live(1));
    await blocked.clock.advance(1000);
    expect(blocked.player.status).toMatchObject({ state: 'failed', failure: { category: 'blocked' } });
    expect(blocked.reports).toEqual([]);
  });

  it('starts the clock again when a play hidden while it opens opens again on show', async () => {
    const r = rig(() => ({ frameMs: 2000 }));
    void r.player.play(live(1));
    await r.clock.advance(300);
    r.player.hide();
    await r.clock.advance(30_000);
    expect(r.reports).toEqual([]);
    r.player.show();
    await r.clock.advance(2000);
    expect(r.player.status.state).toBe('playing');
    expect(r.reports).toEqual([played({ ttffMs: 2000 })]);
  });
});

describe('PlayerController: a stall reports its end (RELAY step 33b2)', () => {
  it('recovered at the next first frame, with its retries; never a second play report', async () => {
    // The first load plays, then breaks 1 s after its frame; the second fails to load; the third plays.
    const r = rig((_source, n) => (n === 1 ? { error: { atMs: 1500, error: NETWORK } } : n === 2 ? { loadError: NETWORK } : {}));
    void r.player.play(live(1));
    await r.clock.advance(1500);
    expect(r.player.status).toMatchObject({ state: 'reconnecting', attempt: 1 });
    expect(r.reports).toEqual([played({ ttffMs: 500 })]);
    await r.clock.advance(5000);
    expect(r.player.status).toMatchObject({ state: 'playing', attempt: 0 });
    expect(r.reports).toEqual([played({ ttffMs: 500 }), { type: 'stall', recovered: true, attempts: 2 }]);
  });

  it('given up, with the retries it took', async () => {
    const r = rig((_source, n) => (n === 1 ? { error: { atMs: 1500, error: NETWORK } } : { loadError: NETWORK }));
    void r.player.play(vod(1));
    await r.clock.advance(60_000);
    expect(r.player.status.state).toBe('failed');
    expect(r.reports).toEqual([played({ container: 'mp4', mode: 'vod', ttffMs: 500 }), { type: 'stall', recovered: false, attempts: 4 }]);
  });

  it('each stall once: a second one after a recovery counts its own retries', async () => {
    // Every load plays, then breaks 1 s after its frame: four recoveries, then the card (the
    // ladder's four attempts in 60 s are spent).
    const r = rig(() => ({ error: { atMs: 1500, error: NETWORK } }));
    void r.player.play(live(1));
    await r.clock.advance(12_000);
    expect(r.player.status.state).toBe('failed');
    const recovered = { type: 'stall', recovered: true, attempts: 1 } as const;
    expect(r.reports).toEqual([played({ ttffMs: 500 }), recovered, recovered, recovered, recovered, { type: 'stall', recovered: false, attempts: 0 }]);
  });

  it('no stall for a resume after a hide, or for a buffering the stream gets over', async () => {
    const r = rig();
    void r.player.play(live(1));
    await r.clock.advance(500);
    r.player.hide();
    await r.clock.advance(30_000);
    r.player.show();
    expect(r.player.status.state).toBe('reconnecting');
    await r.clock.advance(500);
    expect(r.player.status.state).toBe('playing');
    expect(r.reports).toEqual([played({ ttffMs: 500 })]);

    const buffering = rig(() => ({ bufferingMs: 1000, playingMs: 3000 }));
    void buffering.player.play(live(1));
    await buffering.clock.advance(5000);
    expect(buffering.player.status.state).toBe('playing');
    expect(buffering.reports).toEqual([played({ ttffMs: 500 })]);
  });

  it('nothing for a stall left by a zap or a stop', async () => {
    const r = rig((_source, n) => (n === 1 ? { error: { atMs: 1500, error: NETWORK } } : n === 2 ? { frameMs: null } : { frameMs: 800 }));
    void r.player.play(live(1));
    await r.clock.advance(2000);
    expect(r.player.status.state).toBe('reconnecting');
    void r.player.play(live(2));
    await r.clock.advance(850);
    expect(r.reports).toEqual([played({ ttffMs: 500 }), played({ ttffMs: 850 })]);

    const stopped = rig((_source, n) => (n === 1 ? { error: { atMs: 1500, error: NETWORK } } : { frameMs: null }));
    void stopped.player.play(live(1));
    await stopped.clock.advance(2000);
    void stopped.player.stop();
    await stopped.clock.advance(60_000);
    expect(stopped.reports).toEqual([played({ ttffMs: 500 })]);
  });
});

describe('PlayerController: reports never break playback (RELAY step 33b2)', () => {
  it('plays on through a report that throws, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig((_source, n) => (n === 1 ? { error: { atMs: 1500, error: NETWORK } } : {}), {
      report: () => {
        throw new Error('the telemetry broke');
      },
    });
    void r.player.play(live(1));
    await r.clock.advance(500);
    expect(r.player.status.state).toBe('playing');
    // Broken at 1.5 s, reopened after the 50 ms close, its frame 500 ms later.
    await r.clock.advance(1600);
    expect(r.player.status).toMatchObject({ state: 'playing', attempt: 0 });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('plays without a reporter', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clock = new FakeClock();
    const player = new PlayerController(new FakeEngine(clock), { clock });
    void player.play(live(1));
    await clock.advance(500);
    expect(player.status.state).toBe('playing');
    expect(warn).not.toHaveBeenCalled();
  });
});
