import { describe, expect, it } from 'vitest';
import type { EngineEvent, EngineSource, PlaybackError } from '@zoma/player';
import { NO_STATS } from '@zoma/player';
import type { AvplayEngineOptions } from './avplay-engine';
import { AvplayEngine, PREPARE_TIMEOUT_MS, avplayError, createAvplayPlane } from './avplay-engine';
import { FakeAvplay, FakeClock } from './fake-avplay';

const LIVE: EngineSource = { url: 'http://panel.example/live/u/p/1.ts', container: 'ts', live: true };
const VOD: EngineSource = { url: 'http://panel.example/movie/u/p/7.mp4', container: 'mp4', live: false };

function describeEvent(e: EngineEvent): string {
  if (e.type === 'error') return 'error ' + e.error.kind + ' ' + e.error.code;
  if (e.type === 'cue') return 'cue ' + e.text + ' ' + String(e.durationMs);
  return e.type;
}

function rig(options: AvplayEngineOptions = {}) {
  const clock = new FakeClock();
  const avplay = new FakeAvplay(clock);
  const engine = new AvplayEngine(avplay, { clock, ...options });
  const seen: Array<EngineEvent & { readonly token: number }> = [];
  engine.on((e) => seen.push(e));
  return { clock, avplay, engine, seen, events: (): string[] => seen.map(describeEvent) };
}

type Rig = ReturnType<typeof rig>;

interface Outcome {
  state: 'pending' | 'resolved' | 'rejected';
  error: PlaybackError | null;
}

/** How a `load()` settles. */
function watch(p: Promise<void>): Outcome {
  const o: Outcome = { state: 'pending', error: null };
  p.then(
    () => {
      o.state = 'resolved';
    },
    (e: PlaybackError) => {
      o.state = 'rejected';
      o.error = e;
    },
  );
  return o;
}

/** A load the test stops: its rejection is expected. */
function quiet(p: Promise<void>): void {
  p.then(undefined, () => undefined);
}

/** Loads `source`, answers its prepare and moves the clock to the first frame. */
async function playing(r: Rig, source: EngineSource = LIVE, token = 1): Promise<Outcome> {
  const load = watch(r.engine.load(source, token));
  r.avplay.answerPrepare();
  r.avplay.move();
  await r.clock.advance(100);
  expect(load.state).toBe('resolved');
  expect(r.events()).toContain('firstFrame');
  return load;
}

describe('avplayError: AVPlay errors by kind (RELAY step 19)', () => {
  it('sorts the names, keeping each as the code', () => {
    const cases: Array<[unknown, string, string]> = [
      ['PLAYER_ERROR_NOT_SUPPORTED_FILE', 'unsupported', 'PLAYER_ERROR_NOT_SUPPORTED_FILE'],
      ['PLAYER_ERROR_NOT_SUPPORTED_FORMAT', 'unsupported', 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT'],
      ['PLAYER_ERROR_NOT_SUPPORTED_AUDIO_CODEC', 'unsupported', 'PLAYER_ERROR_NOT_SUPPORTED_AUDIO_CODEC'],
      ['PLAYER_ERROR_NOT_SUPPORTED_VIDEO_CODEC', 'unsupported', 'PLAYER_ERROR_NOT_SUPPORTED_VIDEO_CODEC'],
      ['PLAYER_ERROR_GENEREIC', 'decode', 'PLAYER_ERROR_GENEREIC'],
      ['PLAYER_ERROR_GENERIC', 'decode', 'PLAYER_ERROR_GENERIC'],
      ['PLAYER_ERROR_INVALID_PARAMETER', 'app', 'PLAYER_ERROR_INVALID_PARAMETER'],
      ['PLAYER_ERROR_INVALID_OPERATION', 'app', 'PLAYER_ERROR_INVALID_OPERATION'],
      ['PLAYER_ERROR_INVALID_STATE', 'app', 'PLAYER_ERROR_INVALID_STATE'],
      ['PLAYER_ERROR_SEEK_FAILED', 'app', 'PLAYER_ERROR_SEEK_FAILED'],
      ['PLAYER_ERROR_CONNECTION_FAILED', 'network', 'PLAYER_ERROR_CONNECTION_FAILED'],
      ['PLAYER_ERROR_NO_SUCH_FILE', 'network', 'PLAYER_ERROR_NO_SUCH_FILE'],
      ['PLAYER_ERROR_INVALID_URI', 'network', 'PLAYER_ERROR_INVALID_URI'],
      // A name another firmware may add: retried, never "this TV can't play this".
      ['PLAYER_ERROR_STREAMING_SOMETHING', 'network', 'PLAYER_ERROR_STREAMING_SOMETHING'],
      // WebAPIExceptions and errors the calls throw.
      [{ name: 'InvalidStateError', message: 'play in IDLE' }, 'app', 'InvalidStateError'],
      [{ name: 'InvalidValuesError' }, 'app', 'InvalidValuesError'],
      [{ name: 'TypeMismatchError' }, 'app', 'TypeMismatchError'],
      [new TypeError('x is not a function'), 'app', 'TypeError'],
      [{ name: 'PLAYER_ERROR_CONNECTION_FAILED', message: 'prepare' }, 'network', 'PLAYER_ERROR_CONNECTION_FAILED'],
      [{ name: 'UnknownError' }, 'network', 'UnknownError'],
      ['', 'network', 'NO_DETAILS'],
      [null, 'network', 'NO_DETAILS'],
      [{ name: 7 }, 'network', 'NO_DETAILS'],
      [42, 'network', 'NO_DETAILS'],
    ];
    for (const [reason, kind, code] of cases) expect(avplayError(reason), String(JSON.stringify(reason))).toEqual({ kind, code });
  });
});

describe('AvplayEngine: opening a source', () => {
  it('opens, sets its listener and the full-screen rect, prepares, then plays; load() resolves at play', async () => {
    const r = rig();
    const load = watch(r.engine.load(LIVE, 1));
    expect(r.avplay.log).toEqual(['open ' + LIVE.url, 'setListener', 'setDisplayRect 0,0,1920,1080', 'prepareAsync']);
    await r.clock.advance(1000);
    expect(load.state).toBe('pending');
    r.avplay.answerPrepare();
    expect(r.avplay.log.slice(4)).toEqual(['play']);
    await r.clock.advance(0);
    expect(load.state).toBe('resolved');
    // The track list is readable from READY on.
    expect(r.events()).toEqual(['tracks']);
    expect(r.engine.kind).toBe('avplay');
    expect(r.engine.caps).toEqual({ maxHeight: 2160, trackSwitch: 'reliable', deliversSubtitleText: true, preloadSlots: 0, rates: [1] });
  });

  it('sees the first frame when the clock moves while PLAYING, once, with the load token', async () => {
    const r = rig();
    void r.engine.load(LIVE, 7);
    r.avplay.answerPrepare();
    // Playing, but nothing moves yet: no frame however long it waits.
    await r.clock.advance(3000);
    expect(r.events()).toEqual(['tracks']);
    // The next reading differs from the last one.
    r.avplay.move();
    await r.clock.advance(50);
    expect(r.events()).toEqual(['tracks', 'firstFrame']);
    expect(r.seen.map((e) => e.token)).toEqual([7, 7]);
    await r.clock.advance(5000);
    expect(r.events()).toEqual(['tracks', 'firstFrame']);
    // The poll stopped at the frame.
    expect(r.clock.pending).toBe(0);
  });

  it('reads the clock only in PLAYING (a paused player that moved is no frame)', async () => {
    const r = rig();
    void r.engine.load(LIVE, 1);
    r.avplay.answerPrepare();
    r.avplay.state = 'PAUSED';
    r.avplay.move();
    await r.clock.advance(500);
    expect(r.events()).toEqual(['tracks']);
    r.avplay.state = 'PLAYING';
    await r.clock.advance(100);
    expect(r.events()).toEqual(['tracks', 'firstFrame']);
  });

  it('also sees the first frame from oncurrentplaytime callbacks', async () => {
    const r = rig({ framePollMs: 10_000 });
    void r.engine.load(LIVE, 1);
    r.avplay.answerPrepare();
    r.avplay.fire('oncurrentplaytime', 0);
    // Not a time: ignored.
    r.avplay.fire('oncurrentplaytime', '250' as unknown as number);
    r.avplay.fire('oncurrentplaytime', 0);
    expect(r.events()).toEqual(['tracks']);
    r.avplay.fire('oncurrentplaytime', 500);
    expect(r.events()).toEqual(['tracks', 'firstFrame']);
    // The poll that was waiting stops too.
    expect(r.clock.pending).toBe(0);
    r.avplay.fire('oncurrentplaytime', 1000);
    expect(r.events()).toEqual(['tracks', 'firstFrame']);
  });

  it('keeps the rect setRect gave for the next open, and moves the picture of an open one', async () => {
    const r = rig();
    r.engine.setRect({ x: 1112.4, y: 556.6, width: 768, height: 432 });
    expect(r.avplay.log).toEqual([]);
    quiet(r.engine.load(LIVE, 1));
    expect(r.avplay.log).toContain('setDisplayRect 1112,557,768,432');
    r.engine.setRect('full');
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('setDisplayRect 0,0,1920,1080');
    await r.engine.stop();
    r.avplay.log.length = 0;
    r.engine.setRect({ x: 0, y: 0, width: 960, height: 540 });
    expect(r.avplay.log).toEqual([]);
  });

  it('plays on when AVPlay refuses the rect', async () => {
    const r = rig();
    r.avplay.throws.setDisplayRect = 'InvalidValuesError';
    await playing(r);
  });
});

describe('AvplayEngine: errors', () => {
  it('rejects load() with the error that comes before play, and reports later ones as error events', async () => {
    const before = rig();
    const load = watch(before.engine.load(LIVE, 1));
    before.avplay.fire('onerror', 'PLAYER_ERROR_CONNECTION_FAILED');
    await before.clock.advance(0);
    expect(load).toEqual({ state: 'rejected', error: { kind: 'network', code: 'PLAYER_ERROR_CONNECTION_FAILED' } });
    expect(before.events()).toEqual([]);

    const after = rig();
    await playing(after, LIVE, 3);
    after.avplay.fire('onerror', 'PLAYER_ERROR_NOT_SUPPORTED_VIDEO_CODEC');
    expect(after.events()).toEqual(['tracks', 'firstFrame', 'error unsupported PLAYER_ERROR_NOT_SUPPORTED_VIDEO_CODEC']);
    expect(after.seen[2]?.token).toBe(3);
    // One failure per load: AVPlay's next callbacks change nothing.
    after.avplay.fire('onerror', 'PLAYER_ERROR_GENEREIC');
    after.avplay.fire('onstreamcompleted');
    after.avplay.fire('onbufferingstart');
    expect(after.events()).toHaveLength(3);
  });

  it("rejects with prepareAsync's error callback, and with the call that throws", async () => {
    const prepare = rig();
    const failed = watch(prepare.engine.load(LIVE, 1));
    prepare.avplay.failPrepare({ name: 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', message: 'prepare failed' });
    await prepare.clock.advance(0);
    expect(failed.error).toEqual({ kind: 'unsupported', code: 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT' });

    for (const method of ['open', 'setListener', 'prepareAsync', 'play']) {
      const r = rig();
      r.avplay.throws[method] = method === 'open' ? 'InvalidValuesError' : 'InvalidStateError';
      const load = watch(r.engine.load(LIVE, 1));
      if (r.avplay.preparePending) r.avplay.answerPrepare();
      await r.clock.advance(0);
      expect(load.state, method).toBe('rejected');
      expect(load.error?.kind, method).toBe('app');
      expect(r.clock.pending, method).toBe(0);
    }
  });

  it('fails a prepare that has not answered in 8 s (the 302 freeze), and ignores its late answer', async () => {
    const r = rig();
    const load = watch(r.engine.load(LIVE, 1));
    await r.clock.advance(PREPARE_TIMEOUT_MS - 50);
    expect(load.state).toBe('pending');
    await r.clock.advance(50);
    expect(load).toEqual({ state: 'rejected', error: { kind: 'timeout', code: 'PREPARE_TIMEOUT' } });
    r.avplay.answerPrepare();
    await r.clock.advance(1000);
    expect(r.avplay.log).not.toContain('play');
    expect(r.events()).toEqual([]);
  });

  it('fails a load once: a late prepare error after the timeout changes nothing', async () => {
    const r = rig();
    const load = watch(r.engine.load(LIVE, 1));
    await r.clock.advance(PREPARE_TIMEOUT_MS);
    r.avplay.failPrepare({ name: 'PLAYER_ERROR_CONNECTION_FAILED' });
    await r.clock.advance(0);
    expect(load.error).toEqual({ kind: 'timeout', code: 'PREPARE_TIMEOUT' });
    expect(r.events()).toEqual([]);
  });

  it('runs no prepare timer once the prepare answered', async () => {
    const r = rig();
    void r.engine.load(LIVE, 1);
    r.avplay.answerPrepare();
    await r.clock.advance(PREPARE_TIMEOUT_MS * 2);
    expect(r.events()).toEqual(['tracks']);
  });
});

describe('AvplayEngine: stop', () => {
  it('stops and closes, which ends the connection, and rejects a pending load as aborted', async () => {
    const r = rig();
    const load = watch(r.engine.load(LIVE, 1));
    expect(r.avplay.connections).toBe(1);
    await r.engine.stop();
    expect(load).toEqual({ state: 'rejected', error: { kind: 'app', code: 'ABORTED' } });
    expect(r.avplay.log.slice(-2)).toEqual(['stop', 'close']);
    expect(r.avplay.connections).toBe(0);
    expect(r.clock.pending).toBe(0);
  });

  it('closes even when the stop is refused', async () => {
    const r = rig();
    await playing(r);
    r.avplay.throws.stop = 'InvalidStateError';
    await r.engine.stop();
    expect(r.avplay.connections).toBe(0);
  });

  it('drops the callbacks of a closed open, including a late prepare answer', async () => {
    const r = rig();
    quiet(r.engine.load(LIVE, 1));
    const stale = r.avplay.currentListener!;
    await r.engine.stop();
    stale.onerror?.('PLAYER_ERROR_CONNECTION_FAILED');
    stale.onstreamcompleted?.();
    stale.oncurrentplaytime?.(0);
    stale.oncurrentplaytime?.(900);
    expect(r.events()).toEqual([]);

    const late = rig();
    const first = watch(late.engine.load(LIVE, 1));
    const second = watch(late.engine.load(VOD, 2));
    await late.clock.advance(0);
    expect(first.error).toEqual({ kind: 'app', code: 'ABORTED' });
    // A load without a stop closed the first open before opening the second.
    expect(late.avplay.log).toEqual(['open ' + LIVE.url, 'setListener', 'setDisplayRect 0,0,1920,1080', 'prepareAsync', 'stop', 'close', 'open ' + VOD.url, 'setListener', 'setDisplayRect 0,0,1920,1080', 'prepareAsync']);
    late.avplay.answerPrepare();
    await late.clock.advance(0);
    expect(second.state).toBe('resolved');
    expect(late.seen.map((e) => e.token)).toEqual([2]);
  });

  it('calls nothing when nothing is open', async () => {
    const r = rig();
    await r.engine.stop();
    await playing(r);
    await r.engine.stop();
    r.avplay.log.length = 0;
    await r.engine.stop();
    expect(r.avplay.log).toEqual([]);
  });

  it('refuses loads once destroyed', async () => {
    const r = rig();
    await playing(r);
    r.engine.destroy();
    expect(r.avplay.connections).toBe(0);
    const load = watch(r.engine.load(LIVE, 2));
    await r.clock.advance(0);
    expect(load.error).toEqual({ kind: 'app', code: 'DESTROYED' });
    expect(r.avplay.log.filter((e) => e.indexOf('open') === 0)).toHaveLength(1);
  });

  it('sends nothing to a listener that unsubscribed', async () => {
    const r = rig();
    const mine: string[] = [];
    const off = r.engine.on((e) => mine.push(e.type));
    off();
    await playing(r);
    expect(mine).toEqual([]);
  });
});

describe('AvplayEngine: while it plays', () => {
  it('reports buffering and playing around waits after the first frame, once each, and the end', async () => {
    const r = rig();
    void r.engine.load(VOD, 1);
    r.avplay.answerPrepare();
    // AVPlay buffers while it prepares and starts: that is no wait of a playing stream.
    r.avplay.fire('onbufferingstart');
    r.avplay.fire('onbufferingcomplete');
    r.avplay.move();
    await r.clock.advance(100);
    r.avplay.fire('onbufferingstart');
    r.avplay.fire('onbufferingstart');
    r.avplay.fire('onbufferingcomplete');
    r.avplay.fire('onbufferingcomplete');
    r.avplay.fire('onstreamcompleted');
    expect(r.events()).toEqual(['tracks', 'firstFrame', 'buffering', 'playing', 'ended']);
  });

  it('reads the position from AVPlay, keeps the last one when it refuses, and says 0 when stopped', async () => {
    const r = rig();
    expect(r.engine.positionMs()).toBe(0);
    await playing(r);
    await r.clock.advance(1000);
    expect(r.engine.positionMs()).toBe(1100);
    r.avplay.state = 'IDLE';
    expect(r.engine.positionMs()).toBe(1100);
    await r.engine.stop();
    expect(r.engine.positionMs()).toBe(0);
  });

  it('pauses, and plays again only from PAUSED', async () => {
    const r = rig();
    r.engine.play();
    r.engine.pause();
    expect(r.avplay.log).toEqual([]);
    await playing(r);
    r.engine.play();
    expect(r.avplay.log.filter((e) => e === 'play')).toHaveLength(1);
    r.engine.pause();
    expect(r.avplay.state).toBe('PAUSED');
    r.engine.play();
    expect(r.avplay.state).toBe('PLAYING');
    expect(r.avplay.log.filter((e) => e === 'play')).toHaveLength(2);
  });

  it('gives the picture size, the codecs, the audio channels and the declared bitrate from the first frame on', async () => {
    const r = rig();
    void r.engine.load(LIVE, 1);
    r.avplay.answerPrepare();
    expect(r.engine.stats()).toEqual(NO_STATS);
    r.avplay.move();
    await r.clock.advance(100);
    // The playing streams: the video, and the first audio (AAC stereo).
    expect(r.engine.stats()).toEqual({ ...NO_STATS, width: 1920, height: 1080, bitrate: 4_500_000, videoCodec: 'H264', audioCodec: 'AAC', audioChannels: 2 });
    await r.engine.selectAudio('2');
    expect(r.engine.stats()).toMatchObject({ audioCodec: 'AC3', audioChannels: 6 });
    r.avplay.streams = [{ index: 0, type: 'VIDEO', extra_info: '{"fourCC":"HEVC","Width":"3840","Height":"2160"}' }];
    expect(r.engine.stats()).toEqual({ ...NO_STATS, width: 3840, height: 2160, videoCodec: 'HEVC' });
    // Radio: no picture, the audio still named.
    // (The fake's playing audio is stream 2 now.)
    r.avplay.streams = [{ index: 2, type: 'AUDIO', extra_info: '{"language":"ara","fourCC":"MP3","channels":"2"}' }];
    expect(r.engine.stats()).toEqual({ ...NO_STATS, audioCodec: 'MP3', audioChannels: 2 });
    r.avplay.streams = [{ index: 2, type: 'AUDIO', extra_info: '{"language":"ara"}' }];
    expect(r.engine.stats()).toEqual(NO_STATS);
  });

  it('seeks with seekTo, rejecting what AVPlay refuses', async () => {
    const r = rig();
    const none = watch(r.engine.seek(1000));
    await r.clock.advance(0);
    expect(none.error).toEqual({ kind: 'app', code: 'NO_SEEK' });
    await playing(r, VOD);
    const ok = watch(r.engine.seek(60_000));
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('seekTo 60000');
    r.avplay.landSeek();
    await r.clock.advance(0);
    expect(ok.state).toBe('resolved');
    expect(r.engine.positionMs()).toBe(60_000);
    const refused = watch(r.engine.seek(1));
    r.avplay.landSeek({ name: 'PLAYER_ERROR_SEEK_FAILED' });
    r.avplay.throws.seekTo = 'InvalidStateError';
    const thrown = watch(r.engine.seek(2));
    await r.clock.advance(0);
    expect(refused.error).toEqual({ kind: 'app', code: 'PLAYER_ERROR_SEEK_FAILED' });
    expect(thrown.error).toEqual({ kind: 'app', code: 'InvalidStateError' });

    const bare = rig();
    await playing(bare, VOD);
    (bare.avplay as { seekTo?: unknown }).seekTo = undefined;
    const missing = watch(bare.engine.seek(1000));
    await bare.clock.advance(0);
    expect(missing.error).toEqual({ kind: 'app', code: 'NO_SEEK' });
  });
});

describe('AvplayEngine: a VOD start position', () => {
  it('plays, then jumps to the start; the jump is no frame, the clock moving after it is', async () => {
    const r = rig();
    const load = watch(r.engine.load(VOD, 1, { startMs: 20_000 }));
    r.avplay.answerPrepare();
    expect(r.avplay.log.slice(-2)).toEqual(['play', 'seekTo 20000']);
    await r.clock.advance(0);
    expect(load.state).toBe('resolved');
    r.avplay.move();
    // The clock moves from 0 before the jump lands: no frame yet.
    await r.clock.advance(200);
    expect(r.events()).toEqual(['tracks']);
    r.avplay.landSeek();
    await r.clock.advance(50);
    expect(r.events()).toEqual(['tracks']);
    await r.clock.advance(50);
    expect(r.events()).toEqual(['tracks', 'firstFrame']);
    expect(r.engine.positionMs()).toBe(20_100);
  });

  it('watches the clock at once when the seek throws, or when the firmware has no seekTo', async () => {
    const thrown = rig();
    thrown.avplay.throws.seekTo = 'InvalidStateError';
    void thrown.engine.load(VOD, 1, { startMs: 5000 });
    thrown.avplay.answerPrepare();
    expect(thrown.avplay.log[thrown.avplay.log.length - 1]).toBe('seekTo 5000');
    thrown.avplay.move();
    await thrown.clock.advance(100);
    expect(thrown.events()).toEqual(['tracks', 'firstFrame']);

    const bare = rig();
    (bare.avplay as { seekTo?: unknown }).seekTo = undefined;
    void bare.engine.load(VOD, 1, { startMs: 5000 });
    bare.avplay.answerPrepare();
    bare.avplay.move();
    await bare.clock.advance(100);
    expect(bare.events()).toEqual(['tracks', 'firstFrame']);
  });

  it('starts live at the live edge and a VOD from 0 without a seek', async () => {
    for (const [source, startMs] of [
      [LIVE, 20_000],
      [VOD, 0],
    ] as const) {
      const r = rig();
      void r.engine.load(source, 1, { startMs });
      r.avplay.answerPrepare();
      expect(r.avplay.log.filter((e) => e.indexOf('seekTo') === 0)).toEqual([]);
    }
  });
});

describe('AvplayEngine: suspend and resume (app hidden and shown)', () => {
  it('live: suspend(), then restore() without a resume time, and a new first frame', async () => {
    const r = rig();
    await playing(r);
    r.engine.suspend();
    r.engine.suspend();
    expect(r.avplay.log.filter((e) => e === 'suspend')).toHaveLength(1);
    expect(r.clock.pending).toBe(0);
    r.engine.resume();
    r.engine.resume();
    expect(r.avplay.log.filter((e) => e.indexOf('restore') === 0)).toEqual(['restore']);
    r.avplay.move();
    await r.clock.advance(100);
    expect(r.events()).toEqual(['tracks', 'firstFrame', 'firstFrame']);
    // The player was kept: no second open.
    expect(r.avplay.log.filter((e) => e.indexOf('open') === 0)).toHaveLength(1);
  });

  it('VOD: restores at the position it had', async () => {
    const r = rig();
    await playing(r, VOD);
    await r.clock.advance(4900);
    r.engine.suspend();
    r.engine.resume();
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('restore null 5000');
    // The next suspend reads the position again.
    r.avplay.move();
    await r.clock.advance(1000);
    r.engine.suspend();
    r.engine.resume();
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('restore null 6000');
  });

  it('VOD hidden while it jumps to its start position: restores at that position, not where the clock was', async () => {
    const r = rig();
    void r.engine.load(VOD, 1, { startMs: 45_000 });
    r.avplay.answerPrepare();
    r.avplay.move();
    await r.clock.advance(200);
    r.engine.suspend();
    r.engine.resume();
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('restore null 45000');
  });

  it('VOD at its very start: restore() without a resume time (0 is not one)', async () => {
    const r = rig();
    void r.engine.load(VOD, 1);
    r.avplay.answerPrepare();
    r.engine.suspend();
    r.engine.resume();
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('restore');
  });

  it('closes a source that is still preparing, and opens it again on resume (the load resolves then)', async () => {
    const r = rig();
    const load = watch(r.engine.load(VOD, 1, { startMs: 30_000 }));
    r.engine.suspend();
    expect(r.avplay.log.slice(-2)).toEqual(['stop', 'close']);
    expect(r.avplay.connections).toBe(0);
    // Nothing runs while hidden: not the prepare timer either.
    await r.clock.advance(PREPARE_TIMEOUT_MS * 2);
    expect(load.state).toBe('pending');
    r.engine.resume();
    expect(r.avplay.log.slice(-4)).toEqual(['open ' + VOD.url, 'setListener', 'setDisplayRect 0,0,1920,1080', 'prepareAsync']);
    r.avplay.answerPrepare();
    await r.clock.advance(0);
    expect(load.state).toBe('resolved');
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('seekTo 30000');
  });

  it('ignores the callbacks of the open a hide closed: its prepare answer or error, its seek landing', async () => {
    const r = rig();
    const load = watch(r.engine.load(VOD, 1, { startMs: 30_000 }));
    const closed = r.avplay.prepares[0]!;
    r.engine.suspend();
    r.engine.resume();
    closed.ok?.();
    closed.error?.({ name: 'PLAYER_ERROR_CONNECTION_FAILED' });
    await r.clock.advance(0);
    expect(load.state).toBe('pending');
    expect(r.avplay.log.filter((e) => e === 'play')).toEqual([]);
    // The reopened source plays and seeks; a hide AVPlay refuses closes it while it seeks.
    r.avplay.answerPrepare();
    r.avplay.throws.suspend = 'InvalidStateError';
    r.engine.suspend();
    r.engine.resume();
    r.avplay.answerPrepare();
    // The jump hadn't landed when it hid: the reopen goes to the same place.
    expect(r.avplay.log.filter((e) => e.indexOf('seekTo') === 0)).toEqual(['seekTo 30000', 'seekTo 30000']);
    r.avplay.move();
    // The first open's seek lands late: the second open's jump is still under way.
    r.avplay.seeks[0]!.ok?.();
    await r.clock.advance(200);
    expect(r.events().filter((e) => e === 'firstFrame')).toEqual([]);
    r.avplay.landSeek();
    await r.clock.advance(100);
    expect(r.events().filter((e) => e === 'firstFrame')).toEqual(['firstFrame']);
  });

  it('closes again on a second hide while it reopens (nothing prepared to suspend)', async () => {
    const r = rig();
    void r.engine.load(LIVE, 1);
    r.engine.suspend();
    r.engine.resume();
    r.engine.suspend();
    expect(r.avplay.log.filter((e) => e === 'suspend')).toEqual([]);
    expect(r.avplay.connections).toBe(0);

    // The same after a refused suspend of a playing source: the reopened one isn't prepared yet.
    const refused = rig();
    await playing(refused);
    refused.avplay.throws.suspend = 'InvalidStateError';
    refused.engine.suspend();
    refused.engine.resume();
    delete refused.avplay.throws.suspend;
    refused.engine.suspend();
    expect(refused.avplay.log.filter((e) => e === 'suspend')).toEqual(['suspend']);
    expect(refused.avplay.connections).toBe(0);
  });

  it('closes and reopens at the position when AVPlay refuses suspend, or restore', async () => {
    for (const refused of ['suspend', 'restore']) {
      const r = rig();
      await playing(r, VOD);
      await r.clock.advance(2900);
      r.avplay.throws[refused] = 'InvalidStateError';
      r.engine.suspend();
      r.engine.resume();
      expect(r.avplay.log.filter((e) => e.indexOf('open') === 0), refused).toHaveLength(2);
      expect(r.avplay.connections, refused).toBe(1);
      r.avplay.answerPrepare();
      expect(r.avplay.log[r.avplay.log.length - 1], refused).toBe('seekTo 3000');
    }
  });

  it('does nothing for a failed or stopped load', async () => {
    const r = rig();
    r.engine.suspend();
    r.engine.resume();
    await playing(r);
    r.avplay.fire('onerror', 'PLAYER_ERROR_CONNECTION_FAILED');
    r.engine.suspend();
    r.engine.resume();
    expect(r.avplay.log.filter((e) => e === 'suspend' || e.indexOf('restore') === 0)).toEqual([]);
  });
});

describe('AvplayEngine: tracks and subtitles', () => {
  it('lists audio and text streams by index, with the selection', async () => {
    const r = rig();
    expect(r.engine.getTracks()).toEqual({ audio: [], text: [] });
    await playing(r);
    expect(r.engine.getTracks()).toEqual({
      audio: [
        { id: '1', lang: 'ara', label: 'AAC 2ch', selected: true },
        { id: '2', lang: 'eng', label: 'AC3 6ch', selected: false },
      ],
      text: [{ id: '3', lang: 'eng', label: 'SRT', selected: false }],
    });
  });

  it('switches audio with setSelectTrack, refusing ids that are not audio streams', async () => {
    const r = rig();
    await playing(r);
    expect(await r.engine.selectAudio('2')).toBe(true);
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('setSelectTrack AUDIO 2');
    expect(r.engine.getTracks().audio.map((t) => t.selected)).toEqual([false, true]);
    r.avplay.log.length = 0;
    for (const id of ['0', '3', '9', '', '-1', '1.5', 'x']) expect(await r.engine.selectAudio(id), id).toBe(false);
    expect(r.avplay.log).toEqual([]);
    r.avplay.throws.setSelectTrack = 'InvalidValuesError';
    expect(await r.engine.selectAudio('1')).toBe(false);
  });

  it('shows a text track (its cues go out) and hides it again', async () => {
    const r = rig();
    await playing(r);
    r.avplay.fire('onsubtitlechange', '2000', 'not selected', '0');
    expect(await r.engine.selectText('3')).toBe(true);
    expect(r.avplay.log.slice(-2)).toEqual(['setSelectTrack TEXT 3', 'setSilentSubtitle false']);
    expect(r.engine.getTracks().text[0]?.selected).toBe(true);
    r.avplay.fire('onsubtitlechange', '2000', 'مرحبا', '0');
    r.avplay.fire('onsubtitlechange', 1500, 'Hello', 0);
    r.avplay.fire('onsubtitlechange', 'x', 'No time', '0');
    r.avplay.fire('onsubtitlechange', '2000', '', '0');
    r.avplay.fire('onsubtitlechange', '2000', 'a picture', '1');
    expect(r.events().slice(2)).toEqual(['cue مرحبا 2000', 'cue Hello 1500', 'cue No time 0']);
    expect(r.seen[2]?.token).toBe(1);
    expect(await r.engine.selectText(null)).toBe(true);
    expect(r.avplay.log[r.avplay.log.length - 1]).toBe('setSilentSubtitle true');
    expect(r.engine.getTracks().text[0]?.selected).toBe(false);
    r.avplay.fire('onsubtitlechange', '2000', 'hidden', '0');
    expect(r.events()).toHaveLength(5);
  });

  it('refuses a text id that is no text stream, nothing loaded, and a refused switch', async () => {
    const r = rig();
    expect(await r.engine.selectText('3')).toBe(false);
    expect(await r.engine.selectText(null)).toBe(true);
    await playing(r);
    expect(await r.engine.selectText('1')).toBe(false);
    r.avplay.throws.setSelectTrack = 'InvalidValuesError';
    expect(await r.engine.selectText('3')).toBe(false);
    expect(r.engine.getTracks().text[0]?.selected).toBe(false);
  });

  it('starts every load with its subtitles hidden', async () => {
    const r = rig();
    await playing(r);
    await r.engine.selectText('3');
    await r.engine.stop();
    await playing(r, LIVE, 2);
    r.avplay.fire('onsubtitlechange', '2000', 'old choice', '0');
    expect(r.events().filter((e) => e.indexOf('cue') === 0)).toEqual([]);
  });
});

describe("AVPlay's plane", () => {
  it('is an application/avplayer object filling the stage', () => {
    const made: Array<{ tag: string; attrs: Record<string, string>; style: Record<string, string> }> = [];
    const appended: unknown[] = [];
    const stage = {
      ownerDocument: {
        createElement: (tag: string) => {
          const attrs: Record<string, string> = {};
          const el = { tag, attrs, style: {} as Record<string, string>, setAttribute: (k: string, v: string) => (attrs[k] = v) };
          made.push(el);
          return el;
        },
      },
      appendChild: (el: unknown) => appended.push(el),
    } as unknown as HTMLElement;
    const plane = createAvplayPlane(stage);
    expect(made).toHaveLength(1);
    expect(appended).toEqual([plane]);
    expect(made[0]).toEqual({ tag: 'object', attrs: { type: 'application/avplayer', 'data-testid': 'player-avplay' }, style: { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' }, setAttribute: expect.any(Function) });
  });
});
