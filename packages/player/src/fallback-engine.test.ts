import { describe, expect, it, vi } from 'vitest';
import type { EngineEvent, EngineSource, PlaybackError, PlayerEngine } from './engine';
import { FallbackEngine, hlsRefused } from './fallback-engine';
import type { FakeScript } from './fake-engine';
import { FakeClock, FakeEngine } from './fake-engine';

const HLS: EngineSource = { url: 'http://panel.example/live/u/p/1.m3u8', container: 'hls', live: true };
const TS: EngineSource = { url: 'http://panel.example/live/u/p/1.ts', container: 'ts', live: true };
const UNSUPPORTED: PlaybackError = { kind: 'unsupported', code: 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT' };
const NETWORK: PlaybackError = { kind: 'network', code: 'PLAYER_ERROR_CONNECTION_FAILED' };

interface Outcome {
  state: 'pending' | 'resolved' | 'rejected';
  error: unknown;
}

function watch(p: Promise<void>): Outcome {
  const o: Outcome = { state: 'pending', error: null };
  p.then(
    () => {
      o.state = 'resolved';
    },
    (e: unknown) => {
      o.state = 'rejected';
      o.error = e;
    },
  );
  return o;
}

/** A primary that refuses what `refuse` says 100 ms after the load, and a fallback that plays everything. */
function rig(refuse: (source: EngineSource) => PlaybackError | null = (s) => (s.container === 'hls' ? UNSUPPORTED : null), accepts?: (source: EngineSource, error: PlaybackError) => boolean) {
  const clock = new FakeClock();
  const primaryScript = (source: EngineSource): FakeScript => {
    const error = refuse(source);
    return error === null ? {} : { loadMs: 100, loadError: error, frameMs: null };
  };
  const primary = new FakeEngine(clock, primaryScript);
  const fallback = new FakeEngine(clock);
  Object.defineProperty(primary, 'kind', { value: 'avplay' });
  Object.defineProperty(primary, 'caps', { value: { ...primary.caps, maxHeight: 2160 } });
  const active: PlayerEngine[] = [];
  const engine = new FallbackEngine(primary, fallback, { onActive: (e) => active.push(e), ...(accepts === undefined ? {} : { accepts }) });
  const events: string[] = [];
  engine.on((e: EngineEvent & { readonly token: number }) => events.push(e.type + ' ' + String(e.token)));
  return { clock, primary, fallback, engine, active, events };
}

describe('hlsRefused: the default fallback rule (RELAY step 19)', () => {
  it('takes HLS the primary called unsupported, nothing else', () => {
    expect(hlsRefused(HLS, UNSUPPORTED)).toBe(true);
    expect(hlsRefused(HLS, NETWORK)).toBe(false);
    expect(hlsRefused(TS, UNSUPPORTED)).toBe(false);
  });
});

describe('FallbackEngine', () => {
  it('plays on the primary, which is the active engine from the start', async () => {
    const r = rig();
    expect(r.active).toEqual([r.primary]);
    const load = watch(r.engine.load(TS, 1));
    await r.clock.advance(500);
    expect(load.state).toBe('resolved');
    expect(r.primary.log).toEqual(['load 1 ts']);
    expect(r.fallback.log).toEqual([]);
    expect(r.events).toEqual(['firstFrame 1']);
    expect(r.engine.kind).toBe('avplay');
    expect(r.engine.caps.maxHeight).toBe(2160);
    expect(r.engine.current).toBe(r.primary);
  });

  it('hands HLS the primary refuses to the fallback, with the same token and start, once the primary closed', async () => {
    const r = rig();
    const load = watch(r.engine.load(HLS, 4, { startMs: 0 }));
    await r.clock.advance(100);
    expect(load.state).toBe('pending');
    expect(r.primary.log).toEqual(['load 4 hls', 'stop']);
    expect(r.fallback.log).toEqual([]);
    await r.clock.advance(50);
    expect(r.primary.log).toEqual(['load 4 hls', 'stop', 'closed']);
    expect(r.fallback.loads).toEqual([{ token: 4, source: HLS, opts: { startMs: 0 }, at: 150 }]);
    expect(r.active).toEqual([r.primary, r.fallback]);
    expect(r.engine.kind).toBe('html5');
    expect(r.engine.caps.maxHeight).toBe(1080);
    await r.clock.advance(0);
    expect(load.state).toBe('resolved');
    await r.clock.advance(500);
    expect(r.events).toEqual(['firstFrame 4']);
  });

  it("forwards only the active engine's events", async () => {
    const r = rig();
    void r.engine.load(HLS, 1);
    r.fallback.emit(1, { type: 'buffering' });
    await r.clock.advance(150);
    r.primary.emit(1, { type: 'ended' });
    r.fallback.emit(1, { type: 'tracks' });
    expect(r.events).toEqual(['tracks 1']);
  });

  it('passes on every other refusal, and the fallback never loads', async () => {
    for (const [source, error] of [
      [TS, UNSUPPORTED],
      [HLS, NETWORK],
    ] as const) {
      const r = rig(() => error);
      const load = watch(r.engine.load(source, 1));
      await r.clock.advance(1000);
      expect(load.error).toBe(error);
      expect(r.fallback.log).toEqual([]);
      expect(r.primary.log).toEqual(['load 1 ' + source.container]);
    }
  });

  it('asks its own rule when given one', async () => {
    const asked: string[] = [];
    const r = rig(
      () => NETWORK,
      (source, error) => {
        asked.push(source.container + ' ' + error.code);
        return source.container === 'ts';
      },
    );
    const ts = watch(r.engine.load(TS, 1));
    await r.clock.advance(150);
    expect(r.fallback.log).toEqual(['load 1 ts']);
    void r.engine.stop();
    await r.clock.advance(50);
    const hls = watch(r.engine.load(HLS, 2));
    await r.clock.advance(1000);
    expect(asked).toEqual(['ts PLAYER_ERROR_CONNECTION_FAILED', 'hls PLAYER_ERROR_CONNECTION_FAILED']);
    expect(ts.state).toBe('resolved');
    expect(hls.error).toBe(NETWORK);
  });

  it('passes on a rejection that is no PlaybackError, whatever its rule says', async () => {
    const clock = new FakeClock();
    const primary = new FakeEngine(clock);
    const fallback = new FakeEngine(clock);
    const bug = new TypeError('x is not a function');
    vi.spyOn(primary, 'load').mockReturnValue(Promise.reject(bug));
    const engine = new FallbackEngine(primary, fallback, { accepts: () => true });
    const load = watch(engine.load(HLS, 1));
    await clock.advance(1000);
    expect(load.error).toBe(bug);
    expect(fallback.loads).toEqual([]);
  });

  it('rejects as aborted when a stop comes while the primary closes, and the fallback stays shut', async () => {
    const r = rig();
    const load = watch(r.engine.load(HLS, 1));
    await r.clock.advance(120);
    const stopped = r.engine.stop();
    await r.clock.advance(100);
    await stopped;
    expect(load.error).toEqual({ kind: 'app', code: 'ABORTED' });
    expect(r.fallback.loads).toEqual([]);
    expect(r.engine.current).toBe(r.primary);
  });

  it('drops the refusal of a load that a newer load replaced', async () => {
    const r = rig();
    const old = watch(r.engine.load(HLS, 1));
    await r.clock.advance(50);
    const next = watch(r.engine.load(TS, 2));
    await r.clock.advance(1000);
    // The old load's refusal arrived after the new load began: passed on, not handed over.
    expect(old.error).toBe(UNSUPPORTED);
    expect(next.state).toBe('resolved');
    expect(r.fallback.loads).toEqual([]);
  });

  it('goes back to the primary for the next load', async () => {
    const r = rig();
    void r.engine.load(HLS, 1);
    await r.clock.advance(150);
    void r.engine.stop();
    await r.clock.advance(100);
    void r.engine.load(TS, 2);
    expect(r.active).toEqual([r.primary, r.fallback, r.primary]);
    expect(r.engine.current).toBe(r.primary);
  });

  it('stops both engines', async () => {
    const r = rig();
    void r.engine.load(HLS, 1);
    await r.clock.advance(150);
    r.primary.log.length = 0;
    r.fallback.log.length = 0;
    const stopped = watch(r.engine.stop());
    await r.clock.advance(0);
    expect(stopped.state).toBe('pending');
    expect(r.primary.log).toEqual(['stop']);
    expect(r.fallback.log).toEqual(['stop']);
    await r.clock.advance(50);
    expect(stopped.state).toBe('resolved');
  });

  it('sends the calls to the active engine, the rect to both, and destroys both', async () => {
    const r = rig();
    const calls = (engine: FakeEngine): string[] => {
      const out: string[] = [];
      for (const name of ['seek', 'setRect', 'setFit', 'getTracks', 'selectAudio', 'selectText', 'positionMs', 'durationMs', 'stats', 'suspend', 'resume', 'destroy'] as const) {
        vi.spyOn(engine, name).mockImplementation(((...args: unknown[]) => {
          out.push(name + (args.length === 0 ? '' : ' ' + args.map((a) => String(typeof a === 'object' && a !== null ? 'rect' : a)).join(',')));
          return name === 'positionMs' ? 42 : name === 'durationMs' ? 5_400_000 : name === 'getTracks' ? { audio: [], text: [] } : name === 'stats' ? { width: 1, height: 1, bitrate: null, droppedFrames: null } : Promise.resolve(true);
        }) as never);
      }
      return out;
    };
    const primary = calls(r.primary);
    const fallback = calls(r.fallback);
    const use = async (): Promise<void> => {
      r.engine.play();
      r.engine.pause();
      await r.engine.seek(5);
      r.engine.getTracks();
      await r.engine.selectAudio('1');
      await r.engine.selectText(null);
      expect(r.engine.positionMs()).toBe(42);
      expect(r.engine.durationMs()).toBe(5_400_000);
      r.engine.stats();
      r.engine.suspend();
      r.engine.resume();
    };
    await use();
    r.engine.setRect('full');
    r.engine.setFit('fill');
    expect(primary).toEqual(['seek 5', 'getTracks', 'selectAudio 1', 'selectText null', 'positionMs', 'durationMs', 'stats', 'suspend', 'resume', 'setRect full', 'setFit fill']);
    expect(fallback).toEqual(['setRect full', 'setFit fill']);
    expect(r.primary.log).toEqual(['play', 'pause']);
    void r.engine.load(HLS, 1);
    await r.clock.advance(150);
    primary.length = 0;
    fallback.length = 0;
    r.primary.log.length = 0;
    await use();
    expect(fallback).toEqual(['seek 5', 'getTracks', 'selectAudio 1', 'selectText null', 'positionMs', 'durationMs', 'stats', 'suspend', 'resume']);
    expect(primary).toEqual([]);
    expect(r.fallback.log.slice(-2)).toEqual(['play', 'pause']);
    expect(r.primary.log).toEqual([]);
    r.engine.destroy();
    expect(primary).toEqual(['destroy']);
    expect(fallback.slice(-1)).toEqual(['destroy']);
    expect(r.primary.listenerCount).toBe(0);
    expect(r.fallback.listenerCount).toBe(0);
  });

  it('sends nothing to a listener that unsubscribed', async () => {
    const r = rig();
    const mine: string[] = [];
    const off = r.engine.on((e) => mine.push(e.type));
    off();
    void r.engine.load(TS, 1);
    await r.clock.advance(500);
    expect(mine).toEqual([]);
    expect(r.events).toEqual(['firstFrame 1']);
  });
});

describe('FallbackEngine: the picture (RELAY step 20c2b)', () => {
  it('offers only the fits both engines have, whichever plays, with the active engine caps otherwise', async () => {
    const clock = new FakeClock();
    const primary = new FakeEngine(clock, (s) => (s.container === 'hls' ? { loadMs: 100, loadError: UNSUPPORTED, frameMs: null } : {}));
    const fallback = new FakeEngine(clock);
    primary.fits = ['contain', 'fill'];
    primary.trackSwitch = 'reliable';
    fallback.trackSwitch = 'none';
    const engine = new FallbackEngine(primary, fallback);
    expect(engine.caps.fits).toEqual(['contain', 'fill']);
    expect(engine.caps.trackSwitch).toBe('reliable');
    void engine.load(HLS, 1);
    await clock.advance(150);
    expect(engine.current).toBe(fallback);
    expect(engine.caps.fits).toEqual(['contain', 'fill']);
    expect(engine.caps.trackSwitch).toBe('none');
    fallback.fits = ['contain', 'cover'];
    expect(engine.caps.fits).toEqual(['contain']);
    engine.setFit('fill');
    expect([primary.fit, fallback.fit]).toEqual(['fill', 'fill']);
  });
});
