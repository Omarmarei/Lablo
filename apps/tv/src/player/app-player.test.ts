import type { LifecycleEvent, PlatformCall } from '@zoma/platform-api';
import type { AccountStatus, EngineCaps, EngineEvent, EngineSource, PlayerEngine, Track, TrackPreferences } from '@zoma/player';
import { NO_STATS } from '@zoma/player';
import { describe, expect, it, vi } from 'vitest';
import type { AppPlayerDeps } from './app-player';
import { appPlayer, uiTrackPreferences } from './app-player';

/** An engine whose loads show a frame at once, recording what the controller asks of it. */
class StubEngine implements PlayerEngine {
  readonly kind = 'html5' as const;
  readonly caps: EngineCaps = { maxHeight: 1080, trackSwitch: 'none', deliversSubtitleText: false, preloadSlots: 0, rates: [1] };
  readonly log: string[] = [];
  failLoads = false;
  /** Arabic sound (playing) and English. */
  audio: Track[] = [
    { id: '0', lang: 'ara', label: '', selected: true },
    { id: '1', lang: 'eng', label: '', selected: false },
  ];
  private listeners: ((e: EngineEvent & { readonly token: number }) => void)[] = [];

  load(source: EngineSource, token: number): Promise<void> {
    this.log.push(`load ${source.url}`);
    if (this.failLoads) return Promise.reject({ kind: 'http', code: 'HTTP', status: 404 });
    for (const listener of this.listeners.slice()) listener({ type: 'firstFrame', token });
    return Promise.resolve();
  }
  play(): void {}
  pause(): void {}
  seek(): Promise<void> {
    return Promise.resolve();
  }
  stop(): Promise<void> {
    this.log.push('stop');
    return Promise.resolve();
  }
  setRect(): void {}
  getTracks() {
    return { audio: this.audio, text: [] };
  }
  selectAudio(id: string): Promise<boolean> {
    this.log.push(`selectAudio ${id}`);
    return Promise.resolve(false);
  }
  selectText(): Promise<boolean> {
    return Promise.resolve(false);
  }
  positionMs(): number {
    return 0;
  }
  stats() {
    return NO_STATS;
  }
  suspend(): void {
    this.log.push('suspend');
  }
  resume(): void {
    this.log.push('resume');
  }
  on(cb: (e: EngineEvent & { readonly token: number }) => void): () => void {
    this.listeners.push(cb);
    return () => undefined;
  }
  destroy(): void {}
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const live = (url: string) => ({ key: 'x:s1:live:1', src: 's1', mode: 'live' as const, candidates: [{ url, container: 'ts' as const }] });

function setup(
  options: {
    resolveUrl?: AppPlayerDeps['platform']['resolveUrl'];
    engines?: PlayerEngine[];
    refuseScreenSaver?: boolean;
    preferences?: () => TrackPreferences;
    loadSubtitles?: AppPlayerDeps['loadSubtitles'];
    memory?: AppPlayerDeps['memory'];
    trackMemory?: AppPlayerDeps['trackMemory'];
  } = {},
) {
  const engine = new StubEngine();
  const stages: object[] = [];
  const screenSaver: boolean[] = [];
  let lifecycle: ((event: LifecycleEvent) => void) | null = null;
  const accounts: string[] = [];
  const account: AccountStatus = { auth: true, status: 'Expired', expDate: null, activeCons: null, maxConnections: null };
  const platform: AppPlayerDeps['platform'] = {
    id: 'browser',
    createEngines: (stage) => {
      stages.push(stage);
      return options.engines ?? [engine];
    },
    setScreenSaver: (allowed): Promise<PlatformCall> => {
      screenSaver.push(allowed);
      return options.refuseScreenSaver === true ? Promise.reject(new Error('refused')) : Promise.resolve('done');
    },
    onLifecycle: (listener) => {
      lifecycle = listener;
      return () => undefined;
    },
    ...(options.resolveUrl === undefined ? {} : { resolveUrl: options.resolveUrl }),
  };
  const stage = {} as HTMLElement;
  const make = appPlayer({
    platform,
    stage: () => stage,
    checkAccount: (src) => {
      accounts.push(src);
      return Promise.resolve(account);
    },
    online: () => true,
    ...(options.preferences === undefined ? {} : { preferences: options.preferences }),
    ...(options.loadSubtitles === undefined ? {} : { loadSubtitles: options.loadSubtitles }),
    ...(options.memory === undefined ? {} : { memory: options.memory }),
    ...(options.trackMemory === undefined ? {} : { trackMemory: options.trackMemory }),
  });
  return { engine, stages, screenSaver, accounts, make, stage, lifecycle: (event: LifecycleEvent) => lifecycle?.(event) };
}

describe('appPlayer (RELAY step 20a)', () => {
  it('makes one controller on the first call: the stage and the engines once', () => {
    const t = setup();
    expect(t.stages).toEqual([]);
    const first = t.make();
    expect(t.make()).toBe(first);
    expect(t.stages).toEqual([t.stage]);
  });

  it("plays from the memories it is given: the source's container first, the content's choice (step 20c1)", async () => {
    const remembered: string[] = [];
    const t = setup({
      memory: { preferred: (src) => (src === 's1' ? 'hls' : null), remember: (src, container) => remembered.push(`${src} ${container}`) },
      trackMemory: { choice: () => ({ audio: { id: '1', lang: 'en', label: '' }, text: null, delayMs: 500 }), remember: () => undefined },
    });
    const controller = t.make();
    void controller.play({ ...live('http://panel.test/live/u/p/1.ts'), candidates: [{ url: 'http://panel.test/live/u/p/1.ts', container: 'ts' }, { url: 'http://panel.test/live/u/p/1.m3u8', container: 'hls' }] });
    await flush();
    // The channel's remembered English, switched to when the tracks appear.
    expect(t.engine.log).toEqual(['stop', 'load http://panel.test/live/u/p/1.m3u8', 'selectAudio 1']);
    expect(remembered).toEqual(['s1 hls']);
    expect(controller.subtitleDelay).toBe(500);
  });

  it('throws when the platform builds no engine', () => {
    expect(() => setup({ engines: [] }).make()).toThrow(/browser platform built no playback engine/);
  });

  it("plays through the platform's redirect probe when it has one", async () => {
    const probed: string[] = [];
    const t = setup({
      resolveUrl: (url, src, fresh) => {
        probed.push(`${src} ${String(fresh)}`);
        return Promise.resolve(url.replace('panel', 'edge'));
      },
    });
    void t.make().play(live('http://panel.test/live/u/p/1.ts'));
    await flush();
    expect(probed).toEqual(['s1 false']);
    expect(t.engine.log).toEqual(['stop', 'load http://edge.test/live/u/p/1.ts']);
    const plain = setup();
    void plain.make().play(live('http://panel.test/live/u/p/1.ts'));
    await flush();
    expect(plain.engine.log).toEqual(['stop', 'load http://panel.test/live/u/p/1.ts']);
  });

  it('keeps the screensaver away while it plays and lets it back on stop; a refusal changes nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup({ refuseScreenSaver: true });
    const controller = t.make();
    void controller.play(live('http://panel.test/1.ts'));
    await flush();
    expect(controller.status.state).toBe('playing');
    void controller.stop();
    await flush();
    expect(t.screenSaver).toEqual([false, true]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('passes the lifecycle to the controller: hidden suspends the stream, visible resumes it', async () => {
    const t = setup();
    const controller = t.make();
    void controller.play(live('http://panel.test/1.ts'));
    await flush();
    t.lifecycle('hidden');
    t.lifecycle('relaunch');
    t.lifecycle('visible');
    expect(t.engine.log.slice(-2)).toEqual(['suspend', 'resume']);
    expect(controller.status.state).toBe('reconnecting');
    void controller.stop();
  });

  it("re-checks the source's account when it gives up on the provider", async () => {
    const t = setup();
    t.engine.failLoads = true;
    const controller = t.make();
    void controller.play(live('http://panel.test/1.ts'));
    await flush();
    expect(t.accounts).toEqual(['s1']);
    expect(controller.status.failure).toMatchObject({ category: 'provider', code: 'PRV-EXPIRED' });
  });
});

describe('the track languages (RELAY step 20b)', () => {
  it("prefers sound in the UI's language, then the other one the app speaks, and no subtitles", () => {
    expect(uiTrackPreferences('ar-SA')).toEqual({ audio: ['ar', 'en'], text: [] });
    expect(uiTrackPreferences('en-US')).toEqual({ audio: ['en', 'ar'], text: [] });
    expect(uiTrackPreferences('en-XA')).toEqual({ audio: ['en', 'ar'], text: [] });
    expect(uiTrackPreferences('fr-CA')).toEqual({ audio: ['fr', 'en', 'ar'], text: [] });
    expect(uiTrackPreferences('')).toEqual({ audio: [], text: [] });
  });

  it('hands them to the controller, which reads them when a stream lists its tracks', async () => {
    const asked: string[] = [];
    const t = setup({
      preferences: () => {
        asked.push('asked');
        return uiTrackPreferences('en-GB');
      },
    });
    const controller = t.make();
    expect(asked).toEqual([]);
    void controller.play(live('http://panel.test/1.ts'));
    await flush();
    expect(asked).toEqual(['asked']);
    expect(t.engine.log).toContain('selectAudio 1');
    // Without them, the stream's own sound stays.
    const plain = setup();
    const other = plain.make();
    void other.play(live('http://panel.test/1.ts'));
    await flush();
    expect(plain.engine.log.filter((e) => e.indexOf('select') === 0)).toEqual([]);
  });

  it("lists a request's subtitle files with the app's loader, and loads one when it is chosen", async () => {
    const subs = [{ lang: 'ara', url: 'http://panel.test/subs/1.srt', fmt: 'srt' as const }];
    const plain = setup().make();
    void plain.play({ ...live('http://panel.test/1.ts'), externalSubs: subs });
    expect(plain.status.tracks.text.map((t) => `${t.id} ${t.lang}`)).toEqual(['ext:0 ar']);
    const asked: string[] = [];
    const controller = setup({
      loadSubtitles: (sub) => {
        asked.push(sub.url);
        return Promise.resolve([{ startMs: 0, endMs: 1000, text: 'cue' }]);
      },
    }).make();
    void controller.play({ ...live('http://panel.test/1.ts'), externalSubs: subs });
    await flush();
    expect(await controller.selectText('ext:0')).toBe(true);
    expect(asked).toEqual(['http://panel.test/subs/1.srt']);
    expect(controller.subtitles).toEqual({ feed: 'file', cues: ['cue'] });
  });
});
