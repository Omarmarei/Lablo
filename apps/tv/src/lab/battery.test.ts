import type { LifecycleEvent } from '@lablo/platform-api';
import { describe, expect, it } from 'vitest';
import type { FrameResult, SoakResult } from './battery';
import { BATTERY, PLACEHOLDER_NOTE, STALLS_RECORDED, batteryChecks, frameVerdict, lifecycleEvent, noPicture, openAndWait, soak, soakVerdict, switchAudio, switchByService, switchOutcome } from './battery';
import type { LabMedia } from './media';
import type { LabPlayer, LabPlayerEvent, LabTrack, OpenOptions, PlayerError, TrackService } from './player';
import type { RedirectProbe } from './http';
import { FIVE_AUDIO, FakeClock, LAB_MEDIA_FIXTURE as MEDIA, labMediaItem as item } from './fakes';
import { runSpikes } from './runner';
import type { CheckResult, LabContext } from './types';

/** How the fake engine answers one open. */
interface Plan {
  /** ms from the open to the first frame; null: never. */
  frameAfterMs: number | null;
  error?: { afterMs: number; error: PlayerError };
  width?: number;
  height?: number;
  /** ms after the first frame when the clock stops moving (a stall). */
  stallAfterMs?: number;
  /** The clock moves without a picture (sound alone). */
  soundOnly?: boolean;
  /** ms after the first frame when a VOD file ends. */
  endAfterMs?: number;
}

const UNSUPPORTED: PlayerError = { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED', unsupported: true };
const AUDIO = (n: number): LabTrack[] => Array.from({ length: n }, (_, i) => ({ index: i, id: String(i + 2), lang: ['ara', 'eng', 'spa', 'eng', 'eng'][i] ?? '', label: `Track ${i + 1}`, kind: 'main', selected: i === 0 }));

/** A scripted engine on the fake clock. */
class FakePlayer implements LabPlayer {
  readonly kind = 'video' as const;
  readonly opens: Array<{ url: string; options: OpenOptions }> = [];
  readonly calls: string[] = [];
  readonly captions: string[] = [];
  disposed = false;
  audio: LabTrack[] | null = null;
  text: LabTrack[] | null = null;
  /** ms after showText until a cue; null: none. */
  cueAfterMs: number | null = null;
  /** selectAudio's answer, and whether it makes the stream start over. */
  acceptSwitch = true;
  restartOnSwitch = false;
  /** The clock goes back by this much on a switch. */
  backOnSwitchMs = 0;
  error: PlayerError | null = null;
  /** The platform's track service (webOS luna), or none. */
  service: TrackService | null = null;
  private readonly listeners: Array<(event: LabPlayerEvent) => void> = [];
  private plan: Plan = { frameAfterMs: null };
  private openedAt = 0;
  private frameAt: number | null = null;
  private startMs = 0;
  private positionBase = 0;
  private cueAt: number | null = null;
  private errorSent = false;
  private ended = false;
  private open_ = false;

  constructor(
    private readonly clock: FakeClock,
    private readonly script: (url: string, options: OpenOptions, n: number) => Plan,
  ) {
    clock.ticks.push((t) => this.tick(t));
  }

  private emit(event: LabPlayerEvent): void {
    for (const listener of this.listeners.slice()) listener(event);
  }

  private tick(t: number): void {
    if (!this.open_) return;
    const p = this.plan;
    if (p.error !== undefined && !this.errorSent && t - this.openedAt >= p.error.afterMs) {
      this.errorSent = true;
      this.error = p.error.error;
      this.emit({ type: 'error', error: p.error.error });
    }
    if (this.frameAt === null && p.frameAfterMs !== null && t - this.openedAt >= p.frameAfterMs) {
      this.frameAt = this.openedAt + p.frameAfterMs;
      if (p.soundOnly !== true) this.emit({ type: 'frame' });
    }
    if (this.frameAt !== null && p.endAfterMs !== undefined && !this.ended && t - this.frameAt >= p.endAfterMs) {
      this.ended = true;
      this.emit({ type: 'ended' });
    }
    if (this.cueAt !== null && t >= this.cueAt) {
      this.cueAt = null;
      this.emit({ type: 'cue', track: 0, text: 'English subtitle 00:05' });
    }
  }

  describe(): Record<string, unknown> {
    return { engine: 'fake' };
  }
  canPlay(mime: string): string | null {
    return mime === 'video/mp2t' ? '' : 'maybe';
  }
  open(url: string, options: OpenOptions): void {
    this.opens.push({ url, options });
    this.plan = this.script(url, options, this.opens.length);
    this.openedAt = this.clock.t;
    this.frameAt = null;
    this.errorSent = false;
    this.ended = false;
    this.error = null;
    this.open_ = true;
    this.startMs = options.startMs ?? 0;
    this.positionBase = 0;
  }
  snapshot() {
    const p = this.plan;
    let position = this.startMs + this.positionBase;
    if (this.open_ && this.frameAt !== null) {
      const until = p.stallAfterMs === undefined ? this.clock.t : Math.min(this.clock.t, this.frameAt + p.stallAfterMs);
      const end = p.endAfterMs === undefined ? until : Math.min(until, this.frameAt + p.endAfterMs);
      position += Math.max(0, end - this.frameAt);
    }
    const picture = this.frameAt !== null && p.soundOnly !== true;
    return { positionMs: position, width: picture ? (p.width ?? 960) : 0, height: picture ? (p.height ?? 540) : 0, frames: null, paused: !this.open_, muted: false, state: 'fake', error: this.error };
  }
  on(listener: (event: LabPlayerEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const at = this.listeners.indexOf(listener);
      if (at !== -1) this.listeners.splice(at, 1);
    };
  }
  audioTracks(): readonly LabTrack[] | null {
    return this.audio;
  }
  selectAudio(index: number): boolean {
    this.calls.push(`audio ${index}`);
    if (!this.acceptSwitch || this.audio === null || this.audio[index] === undefined) return false;
    this.audio = this.audio.map((t) => ({ ...t, selected: t.index === index }));
    if (this.backOnSwitchMs > 0) this.positionBase -= this.backOnSwitchMs;
    if (this.restartOnSwitch) this.emit({ type: 'restart' });
    return true;
  }
  audioService(): TrackService | null {
    return this.service;
  }
  /** The stream starts over without a word: the clock back to 0. */
  restartClock(): void {
    this.positionBase -= this.snapshot().positionMs;
  }
  textTracks(): readonly LabTrack[] | null {
    return this.text;
  }
  showText(index: number | null): boolean {
    this.calls.push(`text ${String(index)}`);
    if (this.cueAfterMs !== null) this.cueAt = this.clock.t + this.cueAfterMs;
    return true;
  }
  suspend(): void {
    this.calls.push('suspend');
    this.open_ = false;
  }
  resume(): void {
    this.calls.push('resume');
    const last = this.opens[this.opens.length - 1];
    if (last !== undefined) this.open(last.url, last.options);
  }
  caption(text: string): void {
    this.captions.push(text);
  }
  stop(): void {
    this.open_ = false;
  }
  dispose(): void {
    this.open_ = false;
    this.disposed = true;
  }
}

const URL_ = 'http://lab:8080/live/lablo/lablo-test/104.ts';

describe('the first frame', () => {
  it('times the open to the frame event', async () => {
    const clock = new FakeClock();
    const player = new FakePlayer(clock, () => ({ frameAfterMs: 1250 }));
    const r = await openAndWait(player, URL_, { live: true }, 10_000, clock);
    expect(r).toEqual({ played: true, ms: 1250, width: 960, height: 540, positionMs: 0, error: null, muted: false });
    expect(player.opens).toEqual([{ url: URL_, options: { live: true } }]);
  });

  it('stops at an error, or gives up after the wait', async () => {
    const clock = new FakeClock();
    const failing = new FakePlayer(clock, () => ({ frameAfterMs: null, error: { afterMs: 300, error: UNSUPPORTED } }));
    expect(await openAndWait(failing, URL_, { live: true }, 10_000, clock)).toMatchObject({ played: false, ms: 300, error: UNSUPPORTED });
    const silent = new FakePlayer(clock, () => ({ frameAfterMs: null }));
    expect(await openAndWait(silent, URL_, { live: true }, 10_000, clock)).toMatchObject({ played: false, ms: 10_000, error: null });
  });

  it('keeps the first error and the first frame, and stops listening when done', async () => {
    const clock = new FakeClock();
    const player = new FakePlayer(clock, () => ({ frameAfterMs: 100 }));
    const r = await openAndWait(player, URL_, { live: true }, 10_000, clock);
    expect(r.ms).toBe(100);
    // Later events don't reach the finished wait.
    (player as unknown as { emit(e: LabPlayerEvent): void }).emit({ type: 'error', error: UNSUPPORTED });
    expect(r.error).toBeNull();
  });

  const result = (over: Partial<FrameResult>): FrameResult => ({ played: true, ms: 1000, width: 960, height: 540, positionMs: 500, error: null, muted: false, ...over });

  it('passes within the limit and fails past it', () => {
    expect(frameVerdict(result({ ms: 2500 }), 2500, 'maybe', 'video/mp2t')).toMatchObject({ status: 'pass', note: 'first frame in 2500 ms (960×540)', value: { played: true, ms: 2500, limitMs: 2500, canPlay: 'maybe' } });
    expect(frameVerdict(result({ ms: 2501 }), 2500, 'maybe', 'video/mp2t')).toMatchObject({ status: 'fail', note: 'first frame in 2501 ms, over the 2500 ms limit (960×540)' });
  });

  it('says why there was no picture, and whether the engine said it cannot play the format', () => {
    const none = result({ played: false, width: 0, height: 0, positionMs: 0 });
    expect(noPicture({ ...none, error: UNSUPPORTED }, 'maybe', 'video/mp2t')).toEqual({ reason: 'MEDIA_ERR_SRC_NOT_SUPPORTED', unsupported: true });
    const network: PlayerError = { code: 2, message: 'MEDIA_ERR_NETWORK', unsupported: false };
    expect(noPicture({ ...none, error: network }, 'maybe', 'video/mp2t')).toEqual({ reason: 'MEDIA_ERR_NETWORK', unsupported: false });
    expect(noPicture({ ...none, error: network }, '', 'video/mp2t')).toEqual({ reason: 'MEDIA_ERR_NETWORK', unsupported: true });
    expect(noPicture({ ...none, positionMs: 4200 }, 'maybe', 'video/mp4')).toEqual({ reason: 'sound without a picture (the clock reached 4.2 s)', unsupported: true });
    expect(noPicture(none, '', 'video/mp2t')).toEqual({ reason: "no answer, and the engine says it can't play video/mp2t (canPlayType '')", unsupported: true });
    expect(noPicture(none, null, 'video/mp2t')).toEqual({ reason: 'no answer', unsupported: false });
    expect(noPicture(none, 'maybe', 'video/mp2t')).toEqual({ reason: 'no answer', unsupported: false });
    // A picture with a size and a moving clock is no "sound alone".
    expect(noPicture({ ...none, width: 960, positionMs: 4200 }, 'maybe', 'video/mp4').reason).toBe('no answer');
    expect(frameVerdict({ ...none, ms: 10_000 }, 2500, '', 'video/mp2t')).toMatchObject({ status: 'fail', note: "no picture within 10000 ms: no answer, and the engine says it can't play video/mp2t (canPlayType '')", value: { unsupported: true, error: null, positionMs: 0 } });
  });
});

describe('the audio switch', () => {
  const playing = async (setup: (p: FakePlayer) => void = () => undefined) => {
    const clock = new FakeClock();
    const player = new FakePlayer(clock, () => ({ frameAfterMs: 100 }));
    player.audio = AUDIO(3);
    setup(player);
    await openAndWait(player, URL_, { live: false }, 10_000, clock);
    await clock.sleep(1000);
    return { clock, player };
  };

  it('times the switch to the track alone selected and playback moved on', async () => {
    const { clock, player } = await playing();
    const r = await switchAudio(player, 1, clock);
    expect(r).toEqual({ accepted: true, ms: 200, restarted: false, beforeMs: 1000, afterMs: 1200 });
    expect(player.audioTracks()?.map((t) => t.selected)).toEqual([false, true, false]);
  });

  it('notices a restart, from the engine or from the clock going back', async () => {
    const restarting = await playing((p) => (p.restartOnSwitch = true));
    expect(await switchAudio(restarting.player, 1, restarting.clock)).toMatchObject({ accepted: true, restarted: true });
    // The first look comes 50 ms after the switch, so 1051 ms back reads as 1001 ms back.
    const back = await playing((p) => (p.backOnSwitchMs = 1051));
    expect(await switchAudio(back.player, 1, back.clock, 600)).toMatchObject({ restarted: true, ms: null });
    // Back by exactly a second is still "the same place".
    const same = await playing((p) => (p.backOnSwitchMs = 1050));
    expect(await switchAudio(same.player, 1, same.clock, 600)).toMatchObject({ restarted: false });
  });

  it('reports a refused switch, and one that never took over', async () => {
    const refused = await playing((p) => (p.acceptSwitch = false));
    expect(await switchAudio(refused.player, 1, refused.clock)).toEqual({ accepted: false, ms: null, restarted: false, beforeMs: 1000, afterMs: 1000 });
    const stuck = await playing();
    stuck.player.audioTracks = () => AUDIO(3);
    expect(await switchAudio(stuck.player, 1, stuck.clock, 1000)).toMatchObject({ accepted: true, ms: null });
    // Two tracks on at once isn't a switch either.
    const both = await playing();
    both.player.audioTracks = () => AUDIO(3).map((t) => ({ ...t, selected: t.index >= 1 }));
    expect(await switchAudio(both.player, 1, both.clock, 1000)).toMatchObject({ ms: null });
  });

  it('waits until playback moved on 200 ms past the switch', async () => {
    const { clock, player } = await playing();
    // A stalled clock: the track is on, but nothing plays.
    player.snapshot = () => ({ positionMs: 1000, width: 960, height: 540, frames: null, paused: false, muted: false, state: 'fake', error: null });
    expect(await switchAudio(player, 1, clock, 1000)).toMatchObject({ ms: null, afterMs: 1000 });
  });
});

describe('the soak', () => {
  it('reopens after 6 s without progress and times each stall back to a picture', async () => {
    const clock = new FakeClock();
    // Every open plays 18 s, then stalls; a reopen shows a picture after 1.5 s.
    const player = new FakePlayer(clock, (_url, _o, n) => ({ frameAfterMs: n === 1 ? 800 : 1500, stallAfterMs: 18_000 }));
    const r = await soak(player, URL_, { live: true }, 60_000, clock);
    expect(r.first.played).toBe(true);
    expect(r.stalls.length).toBe(2);
    // The stall begins at the last move; the watchdog notices 6 s later, the picture 1.5 s after.
    for (const s of r.stalls) expect(s).toMatchObject({ recoveredMs: 7500, reopens: 1 });
    expect(r.stalls[0]?.atMs).toBe(18_000);
    expect(r.reopens).toBe(2);
    expect(player.opens.every((o) => o.url === URL_ && o.options.live && o.options.startMs === undefined)).toBe(true);
    expect(soakVerdict(r, 'stall-ts')).toMatchObject({ status: 'pass', value: { stalls: 2, recovered: 2, slow: 0, worstMs: 7500, medianMs: 7500, reopens: 2 } });
  });

  it('reopens again every 6 s until a picture comes, and keeps a stall that never ended', async () => {
    const clock = new FakeClock();
    // The first open plays 10 s; the next three reopens never show a picture, the fourth does.
    const player = new FakePlayer(clock, (_u, _o, n) => ({ frameAfterMs: n === 1 ? 500 : n < 5 ? null : 1000, stallAfterMs: n === 1 ? 10_000 : undefined }));
    const r = await soak(player, URL_, { live: true }, 45_000, clock);
    expect(r.stalls).toEqual([{ atMs: 10_000, recoveredMs: 6000 * 4 + 1000, reopens: 4 }]);
    expect(soakVerdict(r, 'stall-ts')).toMatchObject({ status: 'fail', note: 'stall-ts: 1 of 1 stalls took 10 s or more; worst 25000 ms' });

    const never = new FakePlayer(new FakeClock(), () => ({ frameAfterMs: null }));
    const neverClock = (never as unknown as { clock: FakeClock }).clock;
    const first = new FakePlayer(neverClock, (_u, _o, n) => ({ frameAfterMs: n === 1 ? 500 : null, stallAfterMs: 10_000 }));
    const stuck = await soak(first, URL_, { live: true }, 30_000, neverClock);
    expect(stuck.stalls).toHaveLength(1);
    expect(stuck.stalls[0]).toMatchObject({ atMs: 10_000, recoveredMs: null });
    expect(stuck.stalls[0]?.reopens).toBeGreaterThanOrEqual(2);
    expect(soakVerdict(stuck, 'stall-ts').note).toMatch(/^stall-ts: 1 of 1 stalls took 10 s or more \(1 never recovered\); worst — ms$/);
  });

  it('reopens a VOD file where it stopped, and starts it again at its end without calling that a stall', async () => {
    const clock = new FakeClock();
    const player = new FakePlayer(clock, (_u, o, n) => ({ frameAfterMs: 500, stallAfterMs: n === 1 ? 20_000 : undefined, endAfterMs: o.startMs === undefined && n > 2 ? 5000 : 15_000 }));
    const r = await soak(player, 'http://lab/3011.mp4', { live: false }, 60_000, clock);
    // First open: plays 15 s and ends (lap); the lap's open stalls at 20 s? no: the lap is open 3.
    expect(r.laps).toBeGreaterThanOrEqual(1);
    const reopened = player.opens.filter((o) => o.options.startMs !== undefined);
    for (const o of reopened) expect(o.options.startMs).toBeGreaterThan(0);
    const laps = player.opens.slice(1).filter((o) => o.options.startMs === undefined);
    expect(laps.length).toBe(r.laps);
    expect(r.stalls.every((s) => s.recoveredMs !== null)).toBe(true);
  });

  it('carries the position into the VOD reopen', async () => {
    const clock = new FakeClock();
    const player = new FakePlayer(clock, (_u, _o, n) => ({ frameAfterMs: 500, stallAfterMs: n === 1 ? 12_000 : undefined }));
    const r = await soak(player, 'http://lab/3011.mp4', { live: false }, 30_000, clock);
    expect(r.stalls).toEqual([{ atMs: 12_000, recoveredMs: 6500, reopens: 1 }]);
    expect(player.opens[1]?.options).toEqual({ live: false, startMs: 12_000 });
  });

  it('never starts the watchdog on a stream that never played', async () => {
    const clock = new FakeClock();
    const player = new FakePlayer(clock, () => ({ frameAfterMs: null, error: { afterMs: 200, error: UNSUPPORTED } }));
    const r = await soak(player, URL_, { live: true }, 60_000, clock);
    expect(r).toMatchObject({ durationMs: 0, stalls: [], reopens: 0 });
    expect(player.opens).toHaveLength(1);
    expect(soakVerdict(r, 'stall-ts')).toMatchObject({ status: 'fail', note: 'stall-ts never played: MEDIA_ERR_SRC_NOT_SUPPORTED' });
  });

  const soaked = (stalls: SoakResult['stalls']): SoakResult => ({ first: { played: true, ms: 900, width: 960, height: 540, positionMs: 0, error: null, muted: false }, durationMs: 120_000, stalls, reopens: stalls.length, laps: 0 });

  it('passes only when every stall came back in under 10 s', () => {
    expect(soakVerdict(soaked([{ atMs: 18_000, recoveredMs: 9999, reopens: 1 }]), 'stall-ts')).toMatchObject({ status: 'pass', note: 'stall-ts: 1 stalls in 2 min, each recovered in under 10 s (worst 9999 ms, median 9999 ms)' });
    expect(soakVerdict(soaked([{ atMs: 18_000, recoveredMs: 10_000, reopens: 1 }]), 'stall-ts')).toMatchObject({ status: 'fail', value: { slow: 1 } });
    expect(soakVerdict(soaked([]), 'stall-vod')).toMatchObject({ status: 'fail', note: 'stall-vod: no stall in 2 min: the stall URL should stall about every 20 s' });
    const medians = soakVerdict(soaked([7000, 8000, 7600, 9000].map((ms, i) => ({ atMs: i * 20_000, recoveredMs: ms, reopens: 1 }))), 'stall-ts');
    expect(medians.value).toMatchObject({ medianMs: 7800, worstMs: 9000, list: [[0, 7000, 1], [20, 8000, 1], [40, 7600, 1], [60, 9000, 1]] });
    expect(soakVerdict(soaked([7000, 8000, 7600].map((ms) => ({ atMs: 0, recoveredMs: ms, reopens: 1 }))), 'stall-ts').value).toMatchObject({ medianMs: 7600 });
    const many = soakVerdict(soaked(Array.from({ length: STALLS_RECORDED + 5 }, (_, i) => ({ atMs: i * 1000, recoveredMs: 7000, reopens: 1 }))), 'stall-ts');
    expect((many.value as { list: unknown[]; stalls: number }).list).toHaveLength(STALLS_RECORDED);
    expect((many.value as { stalls: number }).stalls).toBe(STALLS_RECORDED + 5);
  });
});

describe('the lifecycle wait', () => {
  it('waits for one of the events it was asked for, or gives up', async () => {
    const clock = new FakeClock();
    const listeners: Array<(event: LifecycleEvent) => void> = [];
    const platform = {
      onLifecycle: (listener: (event: LifecycleEvent) => void) => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    };
    clock.ticks.push((t) => {
      if (t === 1500) for (const l of listeners.slice()) l('hidden');
      if (t === 2000) for (const l of listeners.slice()) l('relaunch');
    });
    expect(await lifecycleEvent(platform, ['visible', 'relaunch'], 5000, clock)).toBe(true);
    expect(clock.t).toBe(2000);
    expect(listeners).toHaveLength(0);
    expect(await lifecycleEvent(platform, ['hidden'], 300, clock)).toBe(false);
    expect(clock.t).toBe(2300);
  });
});

// ---------------------------------------------------------------------------------------------
// The checks

/** How the fake engine plays each URL in a battery run (a desktop browser: no TS). */
const DESKTOP_PLAN = (url: string): Plan => {
  if (url.indexOf('.ts') !== -1) return { frameAfterMs: null };
  if (url.indexOf('/205.') !== -1) return { frameAfterMs: 700, width: 3840, height: 2160 };
  return { frameAfterMs: 900, stallAfterMs: url.indexOf('stall') !== -1 ? 18_000 : undefined };
};

function battery(options: { media?: unknown; plan?: (url: string, o: OpenOptions, n: number) => Plan; setup?: (p: FakePlayer) => void; lifecycle?: Array<[number, LifecycleEvent]>; probe?: (url: string) => Promise<RedirectProbe> } = {}) {
  const clock = new FakeClock();
  const players: FakePlayer[] = [];
  const urls: string[] = [];
  const checks = batteryChecks('S5', {
    createPlayer: () => {
      const p = new FakePlayer(clock, options.plan ?? DESKTOP_PLAN);
      options.setup?.(p);
      players.push(p);
      return p;
    },
    getJson: (url) => {
      urls.push(url);
      return options.media instanceof Error ? Promise.reject(options.media) : Promise.resolve(options.media ?? MEDIA);
    },
    ...(options.probe === undefined ? {} : { probeRedirect: options.probe }),
    clock,
  });
  const listeners: Array<(event: LifecycleEvent) => void> = [];
  const start = clock.t;
  clock.ticks.push((t) => {
    for (const [at, event] of options.lifecycle ?? []) if (t - start === at) for (const l of listeners.slice()) l(event);
  });
  const context = (over: Partial<LabContext> = {}): LabContext =>
    ({
      server: 'http://lab:8080',
      info: { tier: 'full' },
      interactive: false,
      soakMinutes: 1,
      platform: {
        onLifecycle: (listener: (event: LifecycleEvent) => void) => {
          listeners.push(listener);
          return () => listeners.splice(listeners.indexOf(listener), 1);
        },
      },
      ...over,
    }) as unknown as LabContext;
  const runAll = async (over: Partial<LabContext> = {}): Promise<Record<string, CheckResult>> => {
    const out: Record<string, CheckResult> = {};
    await runSpikes([{ id: 'S5', title: '', question: '', checks }], context(over), (o) => (out[o.check] = o.result));
    return out;
  };
  return { clock, players, urls, checks, context, runAll };
}

const statusesOf = (results: Record<string, CheckResult>): Array<[string, string]> => Object.entries(results).map(([id, r]) => [id, r.status]);

describe('the battery checks', () => {
  it('asks the lab server for its media, and skips every playback row on placeholder bytes', async () => {
    const b = battery({ media: { ...MEDIA, media: 'placeholder' } });
    const results = await b.runAll();
    expect(b.urls).toEqual(['http://lab:8080/__lab/media']);
    expect(statusesOf(results)).toEqual([
      ['formats', 'info'],
      ['ts', 'skip'],
      ['hls', 'skip'],
      ['redirect', 'skip'],
      ['hevc-4k', 'skip'],
      ['audio-tracks', 'skip'],
      ['ac3', 'skip'],
      ['subtitles', 'skip'],
      ['suspend', 'skip'],
      ['soak', 'skip'],
    ]);
    expect(results['formats']).toEqual({ status: 'info', value: { media: 'placeholder', items: Object.keys(MEDIA.items), engine: { engine: 'fake' } }, note: PLACEHOLDER_NOTE });
    expect(results['ts']?.note).toBe(PLACEHOLDER_NOTE);
    // Only `formats` made a player (to describe the engine), and it is gone again.
    expect(b.players).toHaveLength(1);
    expect(b.players[0]?.disposed).toBe(true);
  });

  it('fails formats on an answer that is no media list, and the rows then skip', async () => {
    const b = battery({ media: { hello: 1 } });
    const results = await b.runAll();
    expect(results['formats']).toEqual({ status: 'fail', note: 'the lab server answered something else than a media list' });
    expect(results['hls']).toEqual({ status: 'skip', note: "needs the lab server's media list (the first check)" });
    const down = await battery({ media: new Error('HTTP 503') }).runAll();
    expect(down['formats']).toMatchObject({ status: 'fail', note: 'threw Error: HTTP 503' });
  });

  it('runs every row a desktop browser can answer, with no URL in any record', async () => {
    const b = battery({
      setup: (p) => {
        p.audio = AUDIO(3);
        p.text = [];
      },
    });
    const results = await b.runAll();
    expect(statusesOf(results)).toEqual([
      ['formats', 'info'],
      ['ts', 'fail'],
      ['hls', 'pass'],
      ['redirect', 'pass'],
      ['hevc-4k', 'pass'],
      ['audio-tracks', 'pass'],
      ['ac3', 'fail'],
      ['subtitles', 'fail'],
      ['suspend', 'skip'],
      ['soak', 'skip'],
    ]);
    expect(results['formats']?.note).toBe('10 media items on the lab server');
    expect(results['ts']).toMatchObject({ note: "no picture within 10000 ms: no answer, and the engine says it can't play video/mp2t (canPlayType '')", value: { unsupported: true, limitMs: 2500 } });
    expect(results['hls']).toMatchObject({ note: 'first frame in 900 ms (960×540)', value: { limitMs: 4000 } });
    // TS never played, so the redirect row took HLS.
    expect(results['redirect']).toMatchObject({ note: 'HLS through redirect:hops=3: first frame in 900 ms', value: { container: 'hls' } });
    expect(results['hevc-4k']?.note).toBe('3840×2160, first frame in 700 ms');
    expect(results['audio-tracks']?.note).toBe('3 of 5 tracks listed (ara "Track 1", eng "Track 2", spa "Track 3"); switched to eng "Track 2" in 200 ms');
    expect(results['ac3']).toMatchObject({ note: "the engine lists 3 of the file's 5 audio tracks: it drops the ones it can't decode (AC3, E-AC3)", value: { unsupported: true } });
    expect(results['subtitles']?.note).toBe('subs-mkv: no text track; subs-mp4: no text track');
    expect(results['suspend']?.note).toBe('run S5 alone (OK on its row) and press Home while it plays');
    expect(results['soak']?.note).toBe('run S5 alone (OK on its row): 1 min of live TS with stalls');
    expect(JSON.stringify(results)).not.toMatch(/http:|lablo-test/);
    // A player per row, each gone when its row ended.
    expect(b.players.every((p) => p.disposed)).toBe(true);
    expect(b.players.map((p) => p.captions[0])).toEqual([undefined, 'S5: live TS', 'S5: live HLS', 'S5: live HLS through redirects', 'S5: 4K HEVC', 'S5: audio tracks', 'S5: AC3 and E-AC3', 'S5: subtitles (MKV)', 'S5: subtitles (MP4)']);
  });

  it('judges TS against 4 s on the low tier, and uses TS for the later rows once it played', async () => {
    const plan = (url: string): Plan => ({ frameAfterMs: url.indexOf('.ts') !== -1 ? 3000 : 900 });
    const full = await battery({ plan }).runAll();
    expect(full['ts']).toMatchObject({ status: 'fail', note: 'first frame in 3000 ms, over the 2500 ms limit (960×540)' });
    const low = battery({ plan });
    const results = await low.runAll({ info: { tier: 'low' } } as Partial<LabContext>);
    expect(results['ts']).toMatchObject({ status: 'pass', value: { limitMs: 4000 } });
    expect(results['redirect']).toMatchObject({ status: 'pass', value: { container: 'ts', fault: 'redirect:hops=3' } });
    expect(low.players[3]?.opens[0]?.url).toBe('http://lab/live/104.ts?mock_fault=redirect:hops=3');
  });

  it('fails the redirect row when nothing plays, with the reason', async () => {
    const results = await battery({ plan: () => ({ frameAfterMs: null, error: { afterMs: 400, error: { code: 2, message: 'MEDIA_ERR_NETWORK', unsupported: false } } }) }).runAll();
    expect(results['redirect']).toMatchObject({ status: 'fail', note: 'TS through redirects: no picture within 400 ms: MEDIA_ERR_NETWORK', value: { container: 'ts', unsupported: true } });
    expect(results['hevc-4k']).toMatchObject({ status: 'fail', note: 'no picture: MEDIA_ERR_NETWORK (only 2020+ TVs need it)' });
    expect(results['audio-tracks']).toMatchObject({ status: 'fail', note: 'the MKV never played: MEDIA_ERR_NETWORK' });
  });

  it('fails 4K that plays smaller or only as sound', async () => {
    const smaller = await battery({ plan: (url) => ({ frameAfterMs: 500, width: url.indexOf('205') !== -1 ? 1920 : 960, height: url.indexOf('205') !== -1 ? 1080 : 540 }) }).runAll();
    expect(smaller['hevc-4k']).toMatchObject({ status: 'fail', note: 'plays at 1920×1080, not 3840×2160' });
    const narrow = await battery({ plan: (url) => ({ frameAfterMs: 500, width: url.indexOf('205') !== -1 ? 3840 : 960, height: url.indexOf('205') !== -1 ? 1600 : 540 }) }).runAll();
    expect(narrow['hevc-4k']).toMatchObject({ status: 'fail', note: 'plays at 3840×1600, not 3840×2160' });
    const sound = await battery({ plan: (url) => (url.indexOf('205') !== -1 ? { frameAfterMs: 500, soundOnly: true } : { frameAfterMs: 500 }) }).runAll();
    expect(sound['hevc-4k']).toMatchObject({ status: 'fail', value: { unsupported: true, expected: { width: 3840 } } });
    expect(sound['hevc-4k']?.note).toMatch(/^no picture: sound without a picture \(the clock reached 9\.5 s\) \(only 2020\+ TVs need it\)$/);
  });

  it('fails the audio row without the API, with one track, a refused, slow or restarting switch', async () => {
    const noApi = await battery().runAll();
    expect(noApi['audio-tracks']).toMatchObject({ status: 'fail', note: 'this engine has no audioTracks API', value: { api: false, expected: ['ara:aac', 'eng:aac', 'spa:aac', 'eng:ac3', 'eng:eac3'] } });
    expect(noApi['ac3']).toEqual({ status: 'skip', note: 'this engine has no audioTracks API, so the 5.1 tracks cannot be chosen' });
    const one = await battery({ setup: (p) => (p.audio = AUDIO(1)) }).runAll();
    expect(one['audio-tracks']?.note).toBe("the engine lists 1 of the file's 5 audio tracks: nothing to switch to");
    const refused = await battery({ setup: (p) => ((p.audio = AUDIO(5)), (p.acceptSwitch = false)) }).runAll();
    expect(refused['audio-tracks']?.note).toMatch(/; the switch was refused$/);
    const restart = await battery({ setup: (p) => ((p.audio = AUDIO(5)), (p.restartOnSwitch = true)) }).runAll();
    expect(restart['audio-tracks']).toMatchObject({ status: 'fail' });
    expect(restart['audio-tracks']?.note).toMatch(/; the switch took 200 ms and the stream started over$/);
    const stuck = await battery({
      setup: (p) => {
        p.audio = AUDIO(5);
        p.audioTracks = () => AUDIO(5);
      },
    }).runAll();
    expect(stuck['audio-tracks']?.note).toMatch(/; the second track never took over$/);
    const slow = battery({ setup: (p) => (p.audio = AUDIO(5)) });
    const original = slow.clock.sleep;
    slow.clock.sleep = (ms) => original(ms === BATTERY.pollMs ? 2000 : ms);
    const slowResults = await slow.runAll();
    expect(slowResults['audio-tracks']).toMatchObject({ status: 'fail' });
    expect(slowResults['audio-tracks']?.note).toMatch(/switched to eng "Track 2" in 2000 ms$/);
  });

  it('plays the AC3 and E-AC3 tracks when the engine lists all five', async () => {
    const b = battery({ setup: (p) => (p.audio = AUDIO(5)) });
    const results = await b.runAll();
    expect(results['ac3']).toMatchObject({ status: 'pass', note: 'ac3 in 200 ms, eac3 in 200 ms (audioTracks); both played on (whether they sound right is for the ear)' });
    expect(b.players[6]?.calls).toEqual(['audio 3', 'audio 4']);
    // A track that stops the clock didn't play.
    const failing = battery({
      setup: (p) => {
        p.audio = AUDIO(5);
        const select = p.selectAudio.bind(p);
        p.selectAudio = (index) => {
          const ok = select(index);
          if (index === 4) p.error = { code: 3, message: 'MEDIA_ERR_DECODE', unsupported: false };
          return ok;
        };
      },
    });
    expect((await failing.runAll())['ac3']).toMatchObject({ status: 'fail', note: 'eac3 did not play (audioTracks)' });
    // A 5.1 track that takes over but stops the clock didn't play either.
    const stalling = battery({
      setup: (p) => {
        p.audio = AUDIO(5);
        const select = p.selectAudio.bind(p);
        const snapshot = p.snapshot.bind(p);
        let frozen: number | null = null;
        p.selectAudio = (index) => {
          const ok = select(index);
          if (index === 3) frozen = snapshot().positionMs + 300;
          return ok;
        };
        p.snapshot = () => (frozen === null ? snapshot() : { ...snapshot(), positionMs: Math.min(snapshot().positionMs, frozen) });
      },
    });
    expect((await stalling.runAll())['ac3']).toMatchObject({ status: 'fail', note: 'ac3 and eac3 did not play (audioTracks)' });
    // One that never takes over (the engine keeps the first track) didn't play, whatever the clock does.
    const ignored = battery({
      setup: (p) => {
        p.audio = AUDIO(5);
        p.audioTracks = () => AUDIO(5);
      },
    });
    expect((await ignored.runAll())['ac3']).toMatchObject({ status: 'fail', note: 'ac3 and eac3 did not play (audioTracks)' });
  });

  it('skips AC3 when the media lists none', async () => {
    const media: LabMedia = { ...MEDIA, items: { ...MEDIA.items, 'multi-audio': item('http://lab/movie/206.mkv', { kind: 'vod', container: 'mkv', audio: FIVE_AUDIO.slice(0, 3) }) } };
    expect((await battery({ media }).runAll())['ac3']).toEqual({ status: 'skip', note: 'the lab media lists no AC3 or E-AC3 track' });
  });

  it('passes subtitles when both files list a track and a cue arrives', async () => {
    const b = battery({
      setup: (p) => {
        p.text = [{ index: 0, id: '1', lang: 'ara', label: '', kind: 'subtitles', selected: false }];
        p.cueAfterMs = 4000;
      },
    });
    const results = await b.runAll();
    expect(results['subtitles']).toMatchObject({ status: 'pass', note: 'subs-mkv: 1 tracks, a cue in 4000 ms; subs-mp4: 1 tracks, a cue in 4000 ms' });
    expect((results['subtitles']?.value as { files: Array<{ cue: string }> }).files.map((f) => f.cue)).toEqual(['English subtitle 00:05', 'English subtitle 00:05']);
    const late = await battery({
      setup: (p) => {
        p.text = [{ index: 0, id: '1', lang: 'ara', label: '', kind: 'subtitles', selected: false }];
        p.cueAfterMs = BATTERY.cueWaitMs + 100;
      },
    }).runAll();
    expect(late['subtitles']).toMatchObject({ status: 'fail', note: 'subs-mkv: 1 tracks, no cue; subs-mp4: 1 tracks, no cue' });
    const noApi = await battery().runAll();
    expect(noApi['subtitles']?.note).toBe('subs-mkv: no text track API; subs-mp4: no text track API');
    // Only one of the two files gives a cue: not enough.
    const one = await battery({
      setup: (p) => {
        p.text = [{ index: 0, id: '1', lang: 'ara', label: '', kind: 'subtitles', selected: false }];
        const open = p.open.bind(p);
        p.open = (url, options) => {
          p.cueAfterMs = url.indexOf('3001') !== -1 ? 4000 : null;
          open(url, options);
        };
      },
    }).runAll();
    expect(one['subtitles']).toMatchObject({ status: 'fail', note: 'subs-mkv: 1 tracks, a cue in 4000 ms; subs-mp4: 1 tracks, no cue' });
    // No track: nothing to show, and no wait for a cue.
    const none = battery({ setup: (p) => (p.text = []) });
    await none.runAll();
    expect(none.players.slice(7).map((p) => p.calls)).toEqual([[], []]);
    const unplayed = await battery({ plan: () => ({ frameAfterMs: null }) }).runAll();
    expect(unplayed['subtitles']?.note).toBe('subs-mkv: never played; subs-mp4: never played');
  });

  it('skips a row whose item the catalog lacks', async () => {
    const items = { ...MEDIA.items };
    delete items['subs-mp4'];
    delete items['live-hls'];
    const results = await battery({ media: { media: 'files', items } }).runAll();
    expect(results['subtitles']).toEqual({ status: 'skip', note: "the lab server's catalog has no subs-mp4 item" });
    expect(results['hls']).toEqual({ status: 'skip', note: "the lab server's catalog has no live-hls item" });
  });

  it('soaks on the live TS when TS played, on the VOD file when it did not, only when a person started it', async () => {
    const ts = battery({ plan: (url) => ({ frameAfterMs: 900, stallAfterMs: url.indexOf('stall') !== -1 ? 18_000 : undefined }), lifecycle: [] });
    const tsResults = await ts.runAll({ interactive: true, soakMinutes: 1 } as Partial<LabContext>);
    expect(tsResults['soak']).toMatchObject({ status: 'pass', value: { source: 'stall-ts', stalls: 2 } });
    const soakPlayer = ts.players[ts.players.length - 1];
    expect(soakPlayer?.opens[0]?.url).toBe('http://lab/live/104.ts?mock_fault=stall:after_bytes=600000');
    expect(soakPlayer?.captions[0]).toBe('S5: 1 min with a stall every ~20 s; each must recover in under 10 s');

    const vod = battery({ lifecycle: [] });
    const vodResults = await vod.runAll({ interactive: true, soakMinutes: 1 } as Partial<LabContext>);
    expect(vodResults['soak']).toMatchObject({ status: 'pass', value: { source: 'stall-vod' } });
    expect(vod.players[vod.players.length - 1]?.opens[1]?.options).toEqual({ live: false, startMs: 18_000 });
  });

  it('times Home and back to a picture, live in the container that played', async () => {
    // Within S5 the suspend row comes after eight others; time the trip from its own start.
    const b = battery({ plan: (url) => ({ frameAfterMs: url.indexOf('.ts') !== -1 ? null : 900 }) });
    const results: Record<string, CheckResult> = {};
    const checks = b.checks;
    const context = b.context({ interactive: true });
    for (const check of checks.slice(0, 8)) results[check.id] = await check.run(context);
    const suspend = checks[8];
    expect(suspend?.id).toBe('suspend');
    const start = b.clock.t;
    const platformListeners: Array<(e: LifecycleEvent) => void> = [];
    const ctx = {
      ...context,
      platform: {
        onLifecycle: (l: (e: LifecycleEvent) => void) => {
          platformListeners.push(l);
          return () => platformListeners.splice(platformListeners.indexOf(l), 1);
        },
      },
    } as unknown as LabContext;
    b.clock.ticks.push((t) => {
      if (t - start === 3000) for (const l of platformListeners.slice()) l('hidden');
      if (t - start === 9000) for (const l of platformListeners.slice()) l('visible');
    });
    const r = await suspend!.run(ctx);
    expect(r).toMatchObject({ status: 'pass', value: { container: 'hls', awayMs: 6000, resumeMs: 900 }, note: 'back after 6.0 s away: playing again in 900 ms' });
    const player = b.players[b.players.length - 1]!;
    expect(player.calls).toEqual(['suspend', 'resume']);
    expect(player.opens.map((o) => o.url)).toEqual(['http://lab/live/104.m3u8', 'http://lab/live/104.m3u8']);
    expect(player.captions[0]).toBe('S5: press Home, wait a few seconds, then come back to the Lablo Lab');
  });

  it('fails a slow or missing comeback, and skips when nobody pressed Home', async () => {
    const run = async (plan: (url: string, o: OpenOptions, n: number) => Plan, events: Array<[number, LifecycleEvent]>) => {
      const b = battery({ plan, media: { media: 'files', items: { 'live-ts': MEDIA.items['live-ts'] } } });
      const context = b.context({ interactive: true });
      await b.checks[0]!.run(context);
      await b.checks[1]!.run(context);
      const start = b.clock.t;
      const listeners: Array<(e: LifecycleEvent) => void> = [];
      b.clock.ticks.push((t) => {
        for (const [at, e] of events) if (t - start === at) for (const l of listeners.slice()) l(e);
      });
      return b.checks[8]!.run({ ...context, platform: { onLifecycle: (l: (e: LifecycleEvent) => void) => (listeners.push(l), () => listeners.splice(listeners.indexOf(l), 1)) } } as unknown as LabContext);
    };
    const slow = await run((_u, _o, n) => ({ frameAfterMs: n === 1 ? 900 : 5000 }), [
      [2000, 'hidden'],
      [4000, 'visible'],
    ]);
    expect(slow).toMatchObject({ status: 'fail', value: { resumeMs: 5000 } });
    // Back by launching it again from the launcher (webOS sends a relaunch).
    const edge = await run((_u, _o, n) => ({ frameAfterMs: n === 1 ? 900 : 4950 }), [
      [2000, 'hidden'],
      [4000, 'relaunch'],
    ]);
    expect(edge).toMatchObject({ status: 'pass', value: { resumeMs: 4950 } });
    const never = await run((_u, _o, n) => ({ frameAfterMs: n === 1 ? 900 : null }), [
      [2000, 'hidden'],
      [4000, 'visible'],
    ]);
    expect(never).toMatchObject({ status: 'fail', note: 'no picture within 10000 ms of coming back', value: { resumeMs: null } });
    // AVPlay's restore can refuse: the row says so at once, not after the wait.
    const refused: PlayerError = { code: null, message: 'restore: InvalidStateError', unsupported: false };
    const broken = await run((_u, _o, n) => (n === 1 ? { frameAfterMs: 900 } : { frameAfterMs: null, error: { afterMs: 300, error: refused } }), [
      [2000, 'hidden'],
      [4000, 'visible'],
    ]);
    expect(broken).toEqual({ status: 'fail', note: 'coming back failed: restore: InvalidStateError', value: { container: 'ts', awayMs: 2000, resumeMs: null, error: refused } });
    // An error after the picture is back changes nothing.
    // An error first, then a picture after all: the error ends the wait.
    const first = await run((_u, _o, n) => (n === 1 ? { frameAfterMs: 900 } : { frameAfterMs: 400, error: { afterMs: 300, error: refused } }), [
      [2000, 'hidden'],
      [4000, 'visible'],
    ]);
    expect(first).toMatchObject({ status: 'fail', value: { resumeMs: null, error: refused } });
    const late = await run((_u, _o, n) => (n === 1 ? { frameAfterMs: 900 } : { frameAfterMs: 400, error: { afterMs: 450, error: refused } }), [
      [2000, 'hidden'],
      [4000, 'visible'],
    ]);
    expect(late).toMatchObject({ status: 'pass', value: { resumeMs: 400, error: null } });
    const nobody = await run(() => ({ frameAfterMs: 900 }), []);
    expect(nobody).toEqual({ status: 'skip', note: 'nobody pressed Home within 5 min' });
    const gone = await run(() => ({ frameAfterMs: 900 }), [[2000, 'hidden']]);
    expect(gone).toEqual({ status: 'fail', note: 'the lab never came back within 30 min' });
    const unplayed = await run(() => ({ frameAfterMs: null }), []);
    expect(unplayed).toMatchObject({ status: 'fail', note: 'the live TS never played' });
  });

  it('forgets the media list of an earlier run when the next one gets none', async () => {
    let answer: unknown = MEDIA;
    const clock = new FakeClock();
    const checks = batteryChecks('S5', { createPlayer: () => new FakePlayer(clock, () => ({ frameAfterMs: 900 })), getJson: () => Promise.resolve(answer), clock });
    const context = { server: 'http://lab:8080', info: { tier: 'full' }, interactive: false } as unknown as LabContext;
    expect((await checks[2]!.run(context)).status).toBe('skip');
    await checks[0]!.run(context);
    expect((await checks[2]!.run(context)).status).toBe('pass');
    answer = { nothing: true };
    expect((await checks[0]!.run(context)).status).toBe('fail');
    expect(await checks[2]!.run(context)).toEqual({ status: 'skip', note: "needs the lab server's media list (the first check)" });
  });

  it('starts each run afresh: what TS did in an earlier run is forgotten', async () => {
    let tsPlays = true;
    const b = battery({ plan: (url) => ({ frameAfterMs: url.indexOf('.ts') !== -1 && !tsPlays ? null : 900 }) });
    const first = await b.runAll();
    expect(first['redirect']?.value).toMatchObject({ container: 'ts' });
    tsPlays = false;
    const second = await b.runAll();
    expect(second['redirect']?.value).toMatchObject({ container: 'hls' });
  });
});

// ---------------------------------------------------------------------------------------------
// The platform's track service (webOS luna selectTrack, RELAY step 15c2)

/** A service that answers each call with what `answer` gives. */
function fakeService(answer: (index: number) => Promise<string>) {
  const calls: number[] = [];
  const service: TrackService = {
    name: 'luna',
    selectAudio: (index) => {
      calls.push(index);
      return answer(index);
    },
  };
  return { service, calls };
}

describe("the platform's track service", () => {
  const playing = async () => {
    const clock = new FakeClock();
    const player = new FakePlayer(clock, () => ({ frameAfterMs: 100 }));
    await openAndWait(player, URL_, { live: false }, 10_000, clock);
    await clock.sleep(1000);
    return { clock, player };
  };

  it('times the switch to the service accepting and playback moving on', async () => {
    const { clock, player } = await playing();
    const s = fakeService(() => Promise.resolve('{"returnValue":true}'));
    expect(await switchByService(player, s.service, 2, clock)).toEqual({ accepted: true, ms: 200, restarted: false, beforeMs: 1000, afterMs: 1200, detail: '{"returnValue":true}' });
    expect(s.calls).toEqual([2]);
  });

  it('waits for a late answer, and stops at a refusal', async () => {
    const { clock, player } = await playing();
    const start = clock.t;
    let release: (answer: string) => void = () => undefined;
    const late = fakeService(() => new Promise<string>((resolve) => (release = resolve)));
    clock.ticks.push((t) => {
      if (t - start === 1500) release('ok');
    });
    expect(await switchByService(player, late.service, 1, clock)).toMatchObject({ accepted: true, ms: 1500, detail: 'ok' });
    const refused = await playing();
    const no = fakeService(() => Promise.reject(new Error('luna://com.webos.media/selectTrack failed: invalid mediaId (-1)')));
    expect(await switchByService(refused.player, no.service, 1, refused.clock)).toEqual({
      accepted: false,
      ms: null,
      restarted: false,
      beforeMs: 1000,
      afterMs: 1050,
      detail: 'luna://com.webos.media/selectTrack failed: invalid mediaId (-1)',
    });
    const odd = await playing();
    const busy = fakeService(() => Promise.reject('busy'));
    expect(await switchByService(odd.player, busy.service, 1, odd.clock)).toMatchObject({ accepted: false, detail: 'busy' });
  });

  it('gives up on a service that never answers, and notices a restart', async () => {
    const silent = await playing();
    const never = fakeService(() => new Promise<string>(() => undefined));
    expect(await switchByService(silent.player, never.service, 1, silent.clock, 600)).toEqual({ accepted: false, ms: null, restarted: false, beforeMs: 1000, afterMs: 1600, detail: 'no answer' });
    const restarting = await playing();
    const s = fakeService(() => {
      (restarting.player as unknown as { emit(e: LabPlayerEvent): void }).emit({ type: 'restart' });
      return Promise.resolve('ok');
    });
    expect(await switchByService(restarting.player, s.service, 1, restarting.clock)).toMatchObject({ accepted: true, restarted: true });
  });

  it('says how a switch went', () => {
    const base = { beforeMs: 0, afterMs: 0 };
    expect(switchOutcome({ ...base, accepted: false, ms: null, restarted: false }, 'x')).toEqual({ ok: false, text: 'the switch was refused' });
    expect(switchOutcome({ ...base, accepted: false, ms: null, restarted: false, detail: 'no answer' }, 'x')).toEqual({ ok: false, text: 'the switch was refused (no answer)' });
    expect(switchOutcome({ ...base, accepted: true, ms: null, restarted: false }, 'x')).toEqual({ ok: false, text: 'the second track never took over' });
    expect(switchOutcome({ ...base, accepted: true, ms: 300, restarted: true }, 'x')).toEqual({ ok: false, text: 'the switch took 300 ms and the stream started over' });
    expect(switchOutcome({ ...base, accepted: true, ms: 300, restarted: false }, 'eng "Track 2"')).toEqual({ ok: true, text: 'switched to eng "Track 2" in 300 ms' });
  });

  it('switches by the service where the engine has no audioTracks', async () => {
    const s = fakeService(() => Promise.resolve('{"returnValue":true}'));
    const b = battery({ setup: (p) => (p.service = s.service) });
    const results = await b.runAll();
    expect(results['audio-tracks']).toMatchObject({
      status: 'pass',
      note: 'this engine has no audioTracks API; luna: switched to the second track in 200 ms (by ear: the second language?)',
      value: { api: false, route: 'luna', service: { accepted: true, ms: 200, detail: '{"returnValue":true}' } },
    });
    expect((results['audio-tracks']?.value as { switch?: unknown }).switch).toBeUndefined();
    // Straight to the service: the file was opened once.
    expect(b.players[5]?.opens).toHaveLength(1);
    // The AC3 row chooses the 5.1 tracks by their place in the file.
    expect(results['ac3']).toMatchObject({ status: 'pass', note: 'ac3 in 200 ms, eac3 in 200 ms (luna); both played on (whether they sound right is for the ear)', value: { listed: null, route: 'luna' } });
    expect(s.calls).toEqual([1, 3, 4]);
  });

  it("tries the service on the file opened again when the engine's own switch fails", async () => {
    const s = fakeService(() => Promise.resolve('ok'));
    const b = battery({
      setup: (p) => {
        p.audio = AUDIO(5);
        p.acceptSwitch = false;
        p.service = s.service;
      },
    });
    const results = await b.runAll();
    expect(results['audio-tracks']).toMatchObject({ status: 'pass', value: { api: true, route: 'luna', switch: { accepted: false }, service: { accepted: true } } });
    expect(results['audio-tracks']?.note).toBe('5 of 5 tracks listed (ara "Track 1", eng "Track 2", spa "Track 3", eng "Track 4", eng "Track 5"); the switch was refused; luna: switched to the second track in 200 ms (by ear: the second language?)');
    expect(b.players[5]?.opens).toHaveLength(2);
    expect(b.players[5]?.captions).toEqual(['S5: audio tracks', 'S5: audio tracks (luna)']);
    // The engine lists every track: AC3 keeps to the list, and the service isn't asked.
    expect(results['ac3']?.value).toMatchObject({ route: 'audioTracks' });
    expect(s.calls).toEqual([1]);
  });

  it('keeps the engine route when it works, and fails a refusing service', async () => {
    const unused = fakeService(() => Promise.resolve('ok'));
    const fine = await battery({ setup: (p) => ((p.audio = AUDIO(5)), (p.service = unused.service)) }).runAll();
    expect(fine['audio-tracks']).toMatchObject({ status: 'pass', value: { route: 'audioTracks' } });
    expect(unused.calls).toEqual([]);
    const no = fakeService(() => Promise.reject(new Error('invalid mediaId')));
    const refused = await battery({ setup: (p) => (p.service = no.service) }).runAll();
    expect(refused['audio-tracks']).toMatchObject({ status: 'fail', note: 'this engine has no audioTracks API; luna: the switch was refused (invalid mediaId)', value: { route: null } });
    const none = await battery().runAll();
    expect(none['audio-tracks']).toEqual({ status: 'fail', value: { api: false, expected: FIVE_AUDIO.map((a) => `${a.lang}:${a.codec}`), route: null }, note: 'this engine has no audioTracks API' });
  });

  it('judges the service switch against 2 s', async () => {
    const answerAfter = async (ms: number) => {
      let release: ((answer: string) => void) | null = null;
      let askedAt = 0;
      const b = battery({
        setup: (p) =>
          (p.service = fakeService(() => {
            askedAt = b.clock.t;
            return new Promise<string>((resolve) => (release = resolve));
          }).service),
      });
      b.clock.ticks.push((t) => {
        if (release !== null && t - askedAt >= ms) {
          release('ok');
          release = null;
        }
      });
      return (await b.runAll())['audio-tracks'];
    };
    expect(await answerAfter(1950)).toMatchObject({ status: 'pass', value: { service: { ms: 1950 } } });
    expect(await answerAfter(2000)).toMatchObject({ status: 'fail', value: { route: 'luna', service: { ms: 2000 } }, note: 'this engine has no audioTracks API; luna: switched to the second track in 2000 ms (by ear: the second language?)' });
  });

  it('sees a service switch that starts the stream over, after 2 s of play', async () => {
    const b = battery({
      setup: (p) =>
        (p.service = fakeService(() => {
          p.restartClock();
          return Promise.resolve('ok');
        }).service),
    });
    const results = await b.runAll();
    expect(results['audio-tracks']).toMatchObject({ status: 'fail', value: { route: null, service: { restarted: true } } });
    expect(results['audio-tracks']?.note).toMatch(/; luna: the switch took \d+ ms and the stream started over$/);
  });

  it('ends the row when the file does not play again for the service', async () => {
    const s = fakeService(() => Promise.resolve('ok'));
    const multi = (url: string, _o: OpenOptions, n: number): Plan => (url.indexOf('206') !== -1 && n === 2 ? { frameAfterMs: null, error: { afterMs: 300, error: UNSUPPORTED } } : DESKTOP_PLAN(url));
    const results = await battery({ plan: multi, setup: (p) => ((p.audio = AUDIO(2)), (p.acceptSwitch = false), (p.service = s.service)) }).runAll();
    expect(results['audio-tracks']).toMatchObject({ status: 'fail', note: '2 of 5 tracks listed (ara "Track 1", eng "Track 2"); the switch was refused; the MKV never played: MEDIA_ERR_SRC_NOT_SUPPORTED' });
    expect(s.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// The redirect probe's row (AVPlay, S4: RELAY step 15c2)

describe('the redirect probe row', () => {
  const FOUND = (over: Partial<RedirectProbe> = {}): RedirectProbe => ({ finalUrl: 'http://lab/live/lablo/lablo-test/104.m3u8', redirected: true, status: 200, ms: 40, ...over });

  it('comes after redirect, and plays the URL the probe found', async () => {
    const asked: string[] = [];
    const b = battery({
      probe: (url) => {
        asked.push(url);
        return Promise.resolve(FOUND());
      },
    });
    expect(b.checks.map((c) => c.id)).toEqual(['formats', 'ts', 'hls', 'redirect', 'redirect-probe', 'hevc-4k', 'audio-tracks', 'ac3', 'subtitles', 'suspend', 'soak']);
    const results = await b.runAll();
    // TS never played (the desktop plan): HLS through the probe.
    expect(asked).toEqual(['http://lab/live/104.m3u8?mock_fault=redirect:hops=3']);
    expect(results['redirect-probe']).toEqual({
      status: 'pass',
      value: { container: 'hls', probeMs: 40, status: 200, redirected: true, withoutProbe: 'played', played: true, ms: 900 },
      note: 'probe 40 ms (HTTP 200), then the first frame in 900 ms; it played without the probe too',
    });
    expect(b.players[4]?.opens[0]?.url).toBe('http://lab/live/lablo/lablo-test/104.m3u8');
    expect(b.players[4]?.captions).toEqual(['S5: live HLS at the URL the probe found']);
    expect(JSON.stringify(results)).not.toMatch(/http:|lablo-test/);
  });

  it('notes the freeze without the probe (AVPlay on a 302), or a failure', async () => {
    const froze = await battery({ plan: (url) => ({ frameAfterMs: url.indexOf('redirect') !== -1 ? null : 900 }), probe: () => Promise.resolve(FOUND()) }).runAll();
    expect(froze['redirect']).toMatchObject({ status: 'fail', value: { container: 'ts', played: false, error: null } });
    expect(froze['redirect-probe']).toMatchObject({ status: 'pass', value: { container: 'ts', withoutProbe: 'froze' }, note: 'probe 40 ms (HTTP 200), then the first frame in 900 ms; without the probe it froze' });
    const failed = await battery({
      plan: (url) => (url.indexOf('redirect') !== -1 ? { frameAfterMs: null, error: { afterMs: 300, error: { code: null, message: 'PLAYER_ERROR_CONNECTION_FAILED', unsupported: false } } } : { frameAfterMs: 900 }),
      probe: () => Promise.resolve(FOUND()),
    }).runAll();
    expect(failed['redirect-probe']).toMatchObject({ status: 'pass', value: { withoutProbe: 'error' }, note: 'probe 40 ms (HTTP 200), then the first frame in 900 ms; without the probe it failed' });
  });

  it('fails a probe that fails, sees no redirect, or leads to nothing that plays', async () => {
    const failing = await battery({ probe: () => Promise.reject(new Error('no headers within 8000 ms')) }).runAll();
    expect(failing['redirect-probe']).toEqual({ status: 'fail', value: { container: 'hls' }, note: 'the probe failed: no headers within 8000 ms' });
    const odd = await battery({ probe: () => Promise.reject('down') }).runAll();
    expect(odd['redirect-probe']?.note).toBe('the probe failed: down');
    const direct = battery({ probe: () => Promise.resolve(FOUND({ redirected: false, status: 302 })) });
    const straight = await direct.runAll();
    expect(straight['redirect-probe']).toMatchObject({ status: 'fail', note: 'the probe saw no redirect (HTTP 302, responseURL unchanged)', value: { redirected: false } });
    // Nothing was opened for it.
    expect(direct.players.map((p) => p.captions[0])).not.toContain('S5: live HLS at the URL the probe found');
    const dead = await battery({ plan: (url) => ({ frameAfterMs: url.indexOf('lablo-test') !== -1 || url.indexOf('.ts') !== -1 ? null : 900 }), probe: () => Promise.resolve(FOUND()) }).runAll();
    expect(dead['redirect-probe']).toMatchObject({ status: 'fail', note: 'probe 40 ms, then no picture within 10000 ms: no answer', value: { played: false, ms: 10_000, unsupported: false } });
  });

  it('skips on placeholder bytes, and forgets an earlier run', async () => {
    const placeholder = await battery({ media: { ...MEDIA, media: 'placeholder' }, probe: () => Promise.resolve(FOUND()) }).runAll();
    expect(placeholder['redirect-probe']).toEqual({ status: 'skip', note: PLACEHOLDER_NOTE });
    const b = battery({ probe: () => Promise.resolve(FOUND()) });
    await b.runAll();
    // A new run without the redirect row: nothing to compare with.
    const context = b.context();
    await b.checks[0]!.run(context);
    expect(await b.checks[4]!.run(context)).toMatchObject({ status: 'pass', value: { container: 'ts', withoutProbe: null }, note: 'probe 40 ms (HTTP 200), then the first frame in 900 ms' });
  });
});
