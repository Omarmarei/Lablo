import type { LifecycleEvent } from '@zoma/platform-api';
import { describe, expect, it } from 'vitest';
import { createAvplayPlayer } from '../avplay-player';
import { NO_AVPLAY } from '../avplay-deps';
import { PLACEHOLDER_NOTE } from '../battery';
import type { AvplayPlan } from '../fakes';
import { FIVE_AUDIO, FakeAvplay, FakeClock, LAB_MEDIA_FIXTURE, fakeAvplayStage } from '../fakes';
import { runSpikes } from '../runner';
import type { CheckResult, LabContext } from '../types';
import type { S4Deps } from './s4';
import { NOT_TIZEN, createS4 } from './s4';

/** How a 2020 Samsung might answer each of the lab's URLs (a fake AVPlay). */
const TV_PLAN = (url: string): AvplayPlan => {
  // AVPlay's freeze on a chain of 302s: the prepare never answers.
  if (url.indexOf('mock_fault=redirect') !== -1) return { prepareAfterMs: null };
  if (url.indexOf('/205.') !== -1) return { prepareAfterMs: 900, video: { width: 3840, height: 2160 } };
  if (url.indexOf('/206.') !== -1) return { prepareAfterMs: 800, audio: FIVE_AUDIO };
  if (url.indexOf('/3001.') !== -1 || url.indexOf('/3011.mp4') !== -1) return { prepareAfterMs: 700, text: [{ lang: 'eng', codec: 'srt' }], stallAfterMs: url.indexOf('stall') !== -1 ? 20_000 : undefined };
  if (url.indexOf('.m3u8') !== -1) return { prepareAfterMs: 1500 };
  return { prepareAfterMs: 600, stallAfterMs: url.indexOf('stall') !== -1 ? 18_000 : undefined };
};

function s4(options: { plan?: (url: string, n: number) => AvplayPlan; media?: unknown; missing?: string | null } = {}) {
  const clock = new FakeClock();
  const api = new FakeAvplay(clock, options.plan ?? TV_PLAN);
  const stages: Array<ReturnType<typeof fakeAvplayStage>> = [];
  const probed: string[] = [];
  let resolved = 0;
  const deps: S4Deps = {
    missing: () => options.missing ?? null,
    createPlayer: () => {
      const stage = fakeAvplayStage();
      stages.push(stage);
      return createAvplayPlayer(api, stage, { timers: clock.timers, now: clock.now });
    },
    getJson: () => Promise.resolve(options.media ?? LAB_MEDIA_FIXTURE),
    clock,
    probeRedirect: (url) => {
      probed.push(url);
      return Promise.resolve({ finalUrl: url.replace(/\?mock_fault=.*$/, ''), redirected: true, status: 200, ms: 30 });
    },
  };
  const spike = createS4(() => {
    resolved += 1;
    return deps;
  });
  /** Home 2 s after the suspend row starts waiting, back 3 s later. */
  const listeners: Array<(event: LifecycleEvent) => void> = [];
  let armedAt: number | null = null;
  clock.ticks.push((t) => {
    if (armedAt === null) return;
    const event = t - armedAt === 2000 ? 'hidden' : t - armedAt === 5000 ? 'visible' : null;
    if (event !== null) for (const l of listeners.slice()) l(event);
  });
  const context = (over: Partial<LabContext> = {}): LabContext =>
    ({
      server: 'http://lab:8080',
      info: { tier: 'full', modelYear: 2020 },
      interactive: false,
      soakMinutes: 1,
      platform: {
        onLifecycle: (listener: (event: LifecycleEvent) => void) => {
          listeners.push(listener);
          if (armedAt === null) armedAt = clock.t;
          return () => listeners.splice(listeners.indexOf(listener), 1);
        },
      },
      ...over,
    }) as unknown as LabContext;
  const runAll = async (over: Partial<LabContext> = {}): Promise<Record<string, CheckResult>> => {
    const out: Record<string, CheckResult> = {};
    await runSpikes([spike], context(over), (o) => (out[o.check] = o.result));
    return out;
  };
  return { clock, api, stages, probed, spike, runAll, resolved: () => resolved };
}

const statusesOf = (results: Record<string, CheckResult>): Array<[string, string]> => Object.entries(results).map(([id, r]) => [id, r.status]);

describe('S4, the AVPlay battery on a fake AVPlay (RELAY step 15c2)', () => {
  it("runs S5's rows and the redirect probe's on AVPlay", async () => {
    const b = s4();
    expect(b.spike).toMatchObject({ id: 'S4', title: 'AVPlay battery' });
    const results = await b.runAll();
    expect(statusesOf(results)).toEqual([
      ['formats', 'info'],
      ['ts', 'pass'],
      ['hls', 'pass'],
      ['redirect', 'fail'],
      ['redirect-probe', 'pass'],
      ['hevc-4k', 'pass'],
      ['audio-tracks', 'pass'],
      ['ac3', 'pass'],
      ['subtitles', 'pass'],
      ['suspend', 'skip'],
      ['soak', 'skip'],
    ]);
    expect(results['formats']).toMatchObject({ value: { media: 'files', engine: { engine: 'avplay', version: 'fake-avplay 1.0' } }, note: '10 media items on the lab server' });
    // Prepared at 600 ms, the clock moving at 700 ms, seen at 750 ms; no canPlayType on AVPlay.
    expect(results['ts']).toMatchObject({ note: 'first frame in 750 ms (1920×1080)', value: { canPlay: null } });
    expect(results['hls']?.note).toBe('first frame in 1650 ms (1920×1080)');
    // The 302 freeze, then the same stream at the probe's URL.
    expect(results['redirect']).toMatchObject({ note: 'TS through redirects: no picture within 10000 ms: no answer', value: { container: 'ts', played: false } });
    expect(b.probed).toEqual(['http://lab/live/104.ts?mock_fault=redirect:hops=3']);
    expect(results['redirect-probe']?.note).toBe('probe 30 ms (HTTP 200), then the first frame in 750 ms; without the probe it froze');
    expect(results['hevc-4k']?.note).toBe('3840×2160, first frame in 1050 ms');
    expect(results['audio-tracks']).toMatchObject({ note: '5 of 5 tracks listed (ara "AAC 2ch", eng "AAC 2ch", spa "AAC 2ch", eng "AC3 6ch", eng "EAC3 6ch"); switched to eng "AAC 2ch" in 200 ms', value: { route: 'setSelectTrack' } });
    expect(results['ac3']?.note).toBe('ac3 in 200 ms, eac3 in 200 ms (setSelectTrack); both played on (whether they sound right is for the ear)');
    expect(results['subtitles']?.note).toBe('subs-mkv: 1 tracks, a cue in 5000 ms; subs-mp4: 1 tracks, a cue in 5000 ms');
    // AVPlay was told each stream, with the tracks chosen by their stream index.
    expect(b.api.calls).toContain('setSelectTrack AUDIO 2');
    expect(b.api.calls).toContain('setSelectTrack AUDIO 4');
    expect(b.api.calls).toContain('setSelectTrack AUDIO 5');
    expect(b.api.calls).toContain('setSelectTrack TEXT 2');
    // No URL in any record; every row's stage gone, and AVPlay closed.
    expect(JSON.stringify(results)).not.toMatch(/http:|zoma-test/);
    expect(b.stages.every((s) => s.removed === 1)).toBe(true);
    expect(b.api.state).toBe('NONE');
    expect(b.clock.running).toBe(0);
  });

  it('runs Home and back through suspend and restore, and the soak, when a person starts it', async () => {
    const b = s4();
    const results = await b.runAll({ interactive: true });
    expect(results['suspend']).toMatchObject({ status: 'pass', value: { container: 'ts', awayMs: 3000, resumeMs: 350, error: null }, note: 'back after 3.0 s away: playing again in 350 ms' });
    expect(b.api.calls).toContain('suspend');
    expect(b.api.calls).toContain('restore');
    // The live TS stalls 18 s after each start; the watchdog reopens after 6 s without progress.
    expect(results['soak']?.status).toBe('pass');
    expect(results['soak']?.value).toMatchObject({ source: 'stall-ts', minutes: 1, slow: 0 });
    expect((results['soak']?.value as { stalls: number }).stalls).toBeGreaterThanOrEqual(2);
    expect((results['soak']?.value as { worstMs: number }).worstMs).toBeLessThan(10_000);
  });

  it('records what a TV that plays less answers', async () => {
    const plan = (url: string): AvplayPlan => {
      if (url.indexOf('/205.') !== -1) return { prepareAfterMs: 300, prepareError: { name: 'PLAYER_ERROR_NOT_SUPPORTED_FORMAT', message: 'HEVC' } };
      if (url.indexOf('/206.') !== -1) return { prepareAfterMs: 300, audio: FIVE_AUDIO, restartOnSwitch: true };
      if (url.indexOf('/3001.') !== -1 || url.indexOf('/3011.') !== -1) return { prepareAfterMs: 300 };
      return TV_PLAN(url);
    };
    const results = await s4({ plan }).runAll();
    expect(results['hevc-4k']).toMatchObject({ status: 'fail', value: { unsupported: true }, note: 'no picture: prepareAsync: PLAYER_ERROR_NOT_SUPPORTED_FORMAT, HEVC (only 2020+ TVs need it)' });
    expect(results['audio-tracks']).toMatchObject({ status: 'fail', value: { route: null } });
    expect(results['audio-tracks']?.note).toMatch(/; the switch took \d+ ms and the stream started over$/);
    expect(results['subtitles']).toMatchObject({ status: 'fail', note: 'subs-mkv: no text track; subs-mp4: no text track' });
  });

  it('skips every row without AVPlay, and on placeholder bytes all but formats', async () => {
    const none = createS4(() => null);
    expect(none.checks.map((c) => c.id)).toEqual(['formats', 'ts', 'hls', 'redirect', 'redirect-probe', 'hevc-4k', 'audio-tracks', 'ac3', 'subtitles', 'suspend', 'soak']);
    for (const check of none.checks) expect(await check.run({} as LabContext)).toEqual({ status: 'skip', note: NOT_TIZEN });
    const desktop = s4({ missing: NO_AVPLAY });
    const results = await desktop.runAll();
    expect(Object.values(results).every((r) => r.status === 'skip' && r.note === NO_AVPLAY)).toBe(true);
    expect(desktop.api.calls).toEqual([]);
    const placeholder = await s4({ media: { ...LAB_MEDIA_FIXTURE, media: 'placeholder' } }).runAll();
    expect(statusesOf(placeholder).filter(([, s]) => s !== 'skip')).toEqual([['formats', 'info']]);
    expect(placeholder['redirect-probe']).toEqual({ status: 'skip', note: PLACEHOLDER_NOTE });
  });

  it('looks for AVPlay once, on the first run, not at import', async () => {
    const b = s4();
    expect(b.resolved()).toBe(0);
    await b.runAll();
    await b.runAll();
    expect(b.resolved()).toBe(1);
  });
});
