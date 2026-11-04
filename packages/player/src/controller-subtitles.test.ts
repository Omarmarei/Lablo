import type { SubtitleCue } from '@zoma/core';
import { describe, expect, it } from 'vitest';
import type { ControllerOptions, SubtitleView } from './controller';
import { CUE_TICK_MS, ENGINE_CUE_MS, MAX_ENGINE_CUES, PlayerController } from './controller';
import type { EngineSource, Track } from './engine';
import type { FakeScript } from './fake-engine';
import { FakeClock, FakeEngine } from './fake-engine';
import type { ExternalSub, PlayRequest } from './request';
import type { PlayerTrack } from './tracks';
import { MemoryTrackMemory, fileIndex, fileTracks } from './tracks';

/**
 * The subtitles the app draws (RELAY step 20b2b): a request's subtitle files listed after the
 * stream's own subtitles (`ext:n`), loaded once per session when chosen, their cues looked up by
 * the media clock (`subscribeSubtitles`), and the cues an engine delivers (AVPlay's `cue` events).
 */

const BASE = 'http://panel.example:8080';
const EN_URL = `${BASE}/subs/7.en.srt`;
const AR_URL = `${BASE}/subs/7.ar.srt`;
const SUBS: readonly ExternalSub[] = [
  { lang: 'eng', url: EN_URL, fmt: 'srt' },
  { lang: 'Arabic', url: AR_URL, fmt: 'vtt' },
];

function vod(id: number, externalSubs: readonly ExternalSub[] = SUBS): PlayRequest {
  return { key: `s1:vod:${id}`, src: 's1', mode: 'vod', candidates: [{ url: `${BASE}/movie/u/p/${id}.mkv`, container: 'mkv' }], externalSubs };
}

const cue = (startMs: number, endMs: number, text: string): SubtitleCue => ({ startMs, endMs, text });

/** Out of order on purpose: the track sorts them. */
const EN: readonly SubtitleCue[] = [cue(1000, 2000, 'two'), cue(0, 1000, 'one'), cue(1500, 2500, 'overlap'), cue(4000, 5000, 'four')];
const AR: readonly SubtitleCue[] = [cue(0, 3000, 'واحد')];

const track = (id: string, lang: string, selected = false): Track => ({ id, lang, label: '', selected });

interface Rig {
  clock: FakeClock;
  engine: FakeEngine;
  player: PlayerController;
  memory: MemoryTrackMemory;
  /** Every view the listeners got. */
  views: SubtitleView[];
  /** The URLs `loadSubtitles` was asked for. */
  loads: string[];
  /** What each URL answers (an `Error`: a refusal), and how long it takes on the clock. */
  files: Record<string, readonly SubtitleCue[] | Error>;
  loadMs: number;
  switches(): string[];
  /** The last load's token (for engine events). */
  token(): number;
}

/** The stream's own subtitles: English (off) and Arabic (off); every load lists them 200 ms in, before its first frame (500 ms). */
function rig(options: ControllerOptions = {}, script: (source: EngineSource, n: number) => FakeScript = () => ({ tracksMs: 200 })): Rig {
  const clock = new FakeClock();
  const engine = new FakeEngine(clock, script);
  engine.text = [track('3', 'eng'), track('4', 'ara')];
  const memory = new MemoryTrackMemory();
  const views: SubtitleView[] = [];
  const loads: string[] = [];
  const r: Rig = {
    clock,
    engine,
    memory,
    views,
    loads,
    files: { [EN_URL]: EN, [AR_URL]: AR },
    loadMs: 0,
    player: null as unknown as PlayerController,
    switches: () => engine.log.filter((e) => e.indexOf('select') === 0),
    token: () => engine.loads[engine.loads.length - 1]!.token,
  };
  const loadSubtitles = (sub: ExternalSub): Promise<readonly SubtitleCue[]> => {
    loads.push(sub.url);
    return new Promise((resolve, reject) => {
      const answer = (): void => {
        const file = r.files[sub.url];
        if (file === undefined || file instanceof Error) reject(file ?? new Error('404'));
        else resolve(file);
      };
      if (r.loadMs === 0) answer();
      else clock.setTimeout(answer, r.loadMs);
    });
  };
  r.player = new PlayerController(engine, { clock, trackMemory: memory, loadSubtitles, ...options });
  r.player.subscribeSubtitles((v) => views.push(v));
  return r;
}

const texts = (tracks: readonly PlayerTrack[]): string[] => tracks.map((t) => `${t.id} ${t.lang}${t.selected ? ' on' : ''}`);
const shown = (r: Rig): string => `${String(r.player.subtitles.feed)}: ${r.player.subtitles.cues.join(' | ')}`;

/** Plays a VOD and lets it reach its first frame (t = 600: media time 100 ms). */
async function playing(r: Rig, req: PlayRequest = vod(7)): Promise<void> {
  void r.player.play(req);
  await r.clock.advance(600);
  expect(r.player.status.state).toBe('playing');
}

describe('fileIndex and fileTracks', () => {
  it('reads only the ids it wrote', () => {
    expect([fileIndex('ext:0'), fileIndex('ext:12'), fileIndex('3'), fileIndex('ext:'), fileIndex('ext:01'), fileIndex('ext:-2'), fileIndex('ext:1.5'), fileIndex('ext:1e1'), fileIndex('xext:1'), fileIndex('12345')]).toEqual([0, 12, -1, -1, -1, -1, -1, -1, -1, -1]);
  });

  it("lists files with their languages normalized and as the provider wrote them, no label, the shown one on", () => {
    expect(fileTracks(SUBS, 1)).toEqual([
      { id: 'ext:0', lang: 'en', streamLang: 'eng', label: '', selected: false },
      { id: 'ext:1', lang: 'ar', streamLang: 'Arabic', label: '', selected: true },
    ]);
  });
});

describe('PlayerController: subtitle files in the track list', () => {
  it("lists a request's files after the stream's own subtitles, from the start and through a retry", async () => {
    const r = rig({}, (_s, n) => (n === 1 ? { tracksMs: 200, error: { atMs: 1000, error: { kind: 'network', code: 'X' } } } : { tracksMs: 200 }));
    void r.player.play(vod(7));
    expect(texts(r.player.status.tracks.text)).toEqual(['ext:0 en', 'ext:1 ar']);
    await r.clock.advance(200);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar', 'ext:0 en', 'ext:1 ar']);
    await r.clock.advance(800);
    expect(r.player.status.state).toBe('reconnecting');
    expect(texts(r.player.status.tracks.text)).toEqual(['ext:0 en', 'ext:1 ar']);
    void r.player.stop();
    expect(r.player.status.tracks.text).toEqual([]);
    // Nothing is loaded until one is chosen.
    expect(r.loads).toEqual([]);
  });

  it('lists none without a loader, or for a request without files', async () => {
    const r = rig({ loadSubtitles: undefined });
    await playing(r);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar']);
    expect(await r.player.selectText('ext:0')).toBe(false);
    const plain = rig();
    await playing(plain, vod(8, []));
    expect(texts(plain.player.status.tracks.text)).toEqual(['3 en', '4 ar']);
    const none: PlayRequest = { key: 's1:vod:9', src: 's1', mode: 'vod', candidates: [{ url: `${BASE}/movie/u/p/9.mkv`, container: 'mkv' }] };
    await playing(plain, none);
    expect(texts(plain.player.status.tracks.text)).toEqual(['3 en', '4 ar']);
  });
});

describe('PlayerController: choosing a subtitle file', () => {
  it("loads the file, turns the stream's own subtitles off, shows it on and remembers it for the content", async () => {
    const r = rig();
    await playing(r);
    expect(await r.player.selectText('3')).toBe(true);
    expect(await r.player.selectText('ext:0')).toBe(true);
    expect(r.loads).toEqual([EN_URL]);
    expect(r.switches()).toEqual(['selectText 3', 'selectText null']);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar', 'ext:0 en on', 'ext:1 ar']);
    expect(r.memory.choice('s1:vod:7')).toEqual({ audio: null, text: { id: 'ext:0', lang: 'en', label: '' } });
    expect(shown(r)).toBe('file: one');
  });

  it("loads each file once per session, and again in a new one", async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('ext:0');
    await r.player.selectText('ext:1');
    await r.player.selectText('ext:0');
    expect(r.loads).toEqual([EN_URL, AR_URL]);
    // The stream's own subtitles were off all along: nothing for the engine to do.
    expect(r.switches()).toEqual([]);
    await playing(r, vod(8));
    await r.player.selectText('ext:0');
    expect(r.loads).toEqual([EN_URL, AR_URL, EN_URL]);
  });

  it("is false and changes nothing when the file can't be loaded or has no cues, and tries again next time", async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('3');
    r.files[EN_URL] = new Error('404');
    expect(await r.player.selectText('ext:0')).toBe(false);
    r.files[EN_URL] = [];
    expect(await r.player.selectText('ext:0')).toBe(false);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en on', '4 ar', 'ext:0 en', 'ext:1 ar']);
    expect(r.memory.choice('s1:vod:7')).toEqual({ audio: null, text: { id: '3', lang: 'en', label: '' } });
    expect(r.player.subtitles.feed).toBeNull();
    r.files[EN_URL] = EN;
    expect(await r.player.selectText('ext:0')).toBe(true);
    expect(r.loads).toEqual([EN_URL, EN_URL, EN_URL]);
    // A loader that throws at once is a failure too.
    const thrower = rig({
      loadSubtitles: () => {
        throw new Error('bad URL');
      },
    });
    await playing(thrower);
    expect(await thrower.player.selectText('ext:0')).toBe(false);
  });

  it('turns a file off without the engine, and the stream\'s own subtitles replace it through the engine', async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('ext:0');
    expect(await r.player.selectText(null)).toBe(true);
    expect(r.switches()).toEqual([]);
    expect(r.memory.choice('s1:vod:7')?.text).toBe('off');
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar', 'ext:0 en', 'ext:1 ar']);
    expect(shown(r)).toBe('null: ');
    await r.player.selectText('ext:1');
    expect(await r.player.selectText('4')).toBe(true);
    expect(r.switches()).toEqual(['selectText 4']);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar on', 'ext:0 en', 'ext:1 ar']);
    expect(r.player.subtitles.feed).toBeNull();
  });

  it('keeps the file when the engine refuses the switch to its own subtitles', async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('ext:0');
    r.engine.switchOk = false;
    expect(await r.player.selectText('4')).toBe(false);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar', 'ext:0 en on', 'ext:1 ar']);
    expect(shown(r)).toBe('file: one');
  });

  it('lets the newest choice win while a slow file loads', async () => {
    const r = rig();
    await playing(r);
    r.loadMs = 300;
    const first = r.player.selectText('ext:0');
    const second = r.player.selectText('ext:1');
    await r.clock.advance(300);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar', 'ext:0 en', 'ext:1 ar on']);
    // Off while a file loads: it stays off.
    const late = r.player.selectText('ext:0');
    expect(await r.player.selectText(null)).toBe(true);
    await r.clock.advance(300);
    expect(await late).toBe(false);
    expect(r.player.subtitles.feed).toBeNull();
    expect(r.memory.choice('s1:vod:7')?.text).toBe('off');
    // The stream's own track while a file loads: the engine's switch wins.
    const slow = r.player.selectText('ext:1');
    expect(await r.player.selectText('3')).toBe(true);
    await r.clock.advance(300);
    expect(await slow).toBe(false);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en on', '4 ar', 'ext:0 en', 'ext:1 ar']);
  });

  it('drops a file that finished loading after a zap, and one whose own-subtitles switch ended after it', async () => {
    const r = rig();
    await playing(r);
    r.loadMs = 300;
    const slow = r.player.selectText('ext:0');
    void r.player.play(vod(8));
    await r.clock.advance(300);
    expect(await slow).toBe(false);
    expect(r.player.subtitles.feed).toBeNull();
    expect(r.memory.choice('s1:vod:7')).toBeNull();
    // The file is loaded at once, but turning the stream's own subtitle off takes 300 ms.
    await r.clock.advance(300);
    r.loadMs = 0;
    await r.player.selectText('3');
    r.engine.switchMs = 300;
    const turning = r.player.selectText('ext:0');
    await r.clock.advance(100);
    void r.player.play(vod(9));
    await r.clock.advance(200);
    expect(await turning).toBe(false);
    expect(r.player.subtitles.feed).toBeNull();
  });

  it("lets a file win over a slower switch to the stream's own subtitles", async () => {
    const r = rig();
    await playing(r);
    r.engine.switchMs = 300;
    const own = r.player.selectText('3');
    const file = r.player.selectText('ext:0');
    await r.clock.advance(300);
    expect(await own).toBe(false);
    expect(await file).toBe(true);
    expect(shown(r)).toBe('file: one');
  });

  it("leaves the next stream's cues alone when the last stream's file, or its own-subtitles switch, ends after a zap", async () => {
    const r = rig();
    r.engine.deliversText = true;
    await playing(r);
    r.loadMs = 2000;
    const late = r.player.selectText('ext:0');
    void r.player.play(vod(8));
    await r.clock.advance(600);
    await r.player.selectText('3');
    r.engine.emit(r.token(), { type: 'cue', text: 'New', durationMs: 5000 });
    await r.clock.advance(1400);
    expect(await late).toBe(false);
    expect(r.player.subtitles).toEqual({ feed: 'engine', cues: ['New'] });
    // The same with a slow switch of the stream's own subtitles off.
    r.loadMs = 0;
    r.engine.switchMs = 2000;
    const turning = r.player.selectText('ext:0');
    // The file is loaded; the stream's own subtitles are still going off.
    await r.clock.advance(100);
    expect(r.switches().slice(-1)).toEqual(['selectText null']);
    void r.player.play(vod(9));
    await r.clock.advance(600);
    r.engine.switchMs = 0;
    r.engine.text = [track('3', 'eng', true)];
    await r.player.selectText('3');
    r.engine.emit(r.token(), { type: 'cue', text: 'Newer', durationMs: 5000 });
    await r.clock.advance(1400);
    expect(await turning).toBe(false);
    expect(r.player.subtitles).toEqual({ feed: 'engine', cues: ['Newer'] });
  });

  it('lets a newer choice win over a file whose own-subtitles switch was still running', async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('3');
    r.engine.switchMs = 300;
    const turning = r.player.selectText('ext:0');
    await r.clock.advance(100);
    r.engine.switchMs = 0;
    const off = r.player.selectText(null);
    await r.clock.advance(200);
    expect(await turning).toBe(false);
    expect(await off).toBe(true);
    expect(r.player.subtitles.feed).toBeNull();
  });
});

describe('PlayerController: a file chosen by itself', () => {
  it("shows the content's remembered file again on its next play", async () => {
    const r = rig();
    r.memory.remember('s1:vod:7', { audio: null, text: { id: 'ext:1', lang: 'ar', label: '' } });
    void r.player.play(vod(7));
    await r.clock.advance(200);
    expect(r.loads).toEqual([AR_URL]);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar', 'ext:0 en', 'ext:1 ar on']);
    expect(r.player.subtitles.feed).toBe('file');
    // Not before the picture.
    expect(r.player.subtitles.cues).toEqual([]);
    await r.clock.advance(300);
    expect(shown(r)).toBe('file: واحد');
  });

  it('takes a file in a preferred language when the stream has none in it', async () => {
    const r = rig({ preferences: () => ({ audio: [], text: ['fr', 'ar'] }) });
    r.engine.text = [track('3', 'eng')];
    await playing(r);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', 'ext:0 en', 'ext:1 ar on']);
    // Not remembered: the user didn't choose it.
    expect(r.memory.choice('s1:vod:7')).toBeNull();
  });

  it("keeps the file through a retry, turning off the new load's own default subtitles", async () => {
    const r = rig({}, (_s, n) => (n === 1 ? { tracksMs: 200, error: { atMs: 1000, error: { kind: 'network', code: 'X' } } } : { tracksMs: 200 }));
    await playing(r);
    await r.player.selectText('ext:0');
    // The reopened stream shows its English subtitles by default.
    r.engine.text = [track('3', 'eng', true), track('4', 'ara')];
    await r.clock.advance(400);
    expect(r.player.status.state).toBe('reconnecting');
    expect(r.player.subtitles).toEqual({ feed: 'file', cues: [] });
    await r.clock.advance(250);
    expect(r.switches()).toEqual(['selectText null']);
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar', 'ext:0 en on', 'ext:1 ar']);
    expect(r.loads).toEqual([EN_URL]);
  });

  it('turns a file off on content remembered "off", without the engine', async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('ext:0');
    r.memory.remember('s1:vod:7', { audio: null, text: 'off' });
    // A resume chooses again.
    r.player.hide();
    r.player.show();
    await r.clock.advance(500);
    expect(r.player.subtitles.feed).toBeNull();
    expect(texts(r.player.status.tracks.text)).toEqual(['3 en', '4 ar', 'ext:0 en', 'ext:1 ar']);
    expect(r.switches()).toEqual([]);
  });
});

describe('PlayerController: the file feed', () => {
  it('looks the cues up by the media clock every tick, and tells the listeners only when they change', async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('ext:0');
    const seen = (): string[] => r.views.map((v) => `${String(v.feed)}: ${v.cues.join(' | ')}`);
    expect(seen()).toEqual(['file: one']);
    // Media time 100 + 250 per tick: 1100 is "two", 1600 "two" and "overlap", 2100 "overlap", 2600 nothing.
    await r.clock.advance(4 * CUE_TICK_MS);
    expect(seen()).toEqual(['file: one', 'file: two']);
    await r.clock.advance(2 * CUE_TICK_MS);
    expect(seen()).toEqual(['file: one', 'file: two', 'file: two | overlap']);
    await r.clock.advance(2 * CUE_TICK_MS);
    expect(seen()).toEqual(['file: one', 'file: two', 'file: two | overlap', 'file: overlap']);
    await r.clock.advance(2 * CUE_TICK_MS);
    expect(seen()).toEqual(['file: one', 'file: two', 'file: two | overlap', 'file: overlap', 'file: ']);
    // Media time 4100: "four", found by the tick at once.
    await r.clock.advance(6 * CUE_TICK_MS);
    expect(shown(r)).toBe('file: four');
    await r.clock.advance(CUE_TICK_MS - 1);
    expect(r.views).toHaveLength(6);
  });

  it('shows the cues later or earlier by the delay, at once', async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('ext:0');
    r.player.setSubtitleDelay(-1000);
    expect(shown(r)).toBe('file: two');
    r.player.setSubtitleDelay(-1500);
    expect(shown(r)).toBe('file: two | overlap');
    r.player.setSubtitleDelay(500);
    expect(shown(r)).toBe('file: ');
    // For every file of the content until changed.
    await r.player.selectText('ext:1');
    expect(shown(r)).toBe('file: ');
    await r.clock.advance(2 * CUE_TICK_MS);
    expect(shown(r)).toBe('file: واحد');
    r.player.setSubtitleDelay(0);
    expect(shown(r)).toBe('file: واحد');
    r.player.setSubtitleDelay(1000);
    expect(shown(r)).toBe('file: ');
  });

  it("keeps the timing with the content's choice: another content starts at none, the content's comes back (step 20c1)", async () => {
    const r = rig();
    expect(r.player.subtitleDelay).toBe(0);
    await playing(r);
    await r.player.selectText('ext:0');
    r.player.setSubtitleDelay(500);
    expect(r.player.subtitleDelay).toBe(500);
    expect(r.memory.choice('s1:vod:7')).toEqual({ audio: null, text: { id: 'ext:0', lang: 'en', label: '' }, delayMs: 500 });
    // A switch keeps the timing in the choice, and the timing keeps the switch.
    await r.player.selectText('ext:1');
    expect(r.memory.choice('s1:vod:7')).toEqual({ audio: null, text: { id: 'ext:1', lang: 'ar', label: '' }, delayMs: 500 });
    r.player.setSubtitleDelay(250);
    expect(r.memory.choice('s1:vod:7')).toEqual({ audio: null, text: { id: 'ext:1', lang: 'ar', label: '' }, delayMs: 250 });
    // The same timing again remembers nothing new.
    r.memory.remember('s1:vod:7', { audio: null, text: null, delayMs: 250 });
    r.player.setSubtitleDelay(250);
    expect(r.memory.choice('s1:vod:7')).toEqual({ audio: null, text: null, delayMs: 250 });
    r.memory.remember('s1:vod:7', { audio: null, text: { id: 'ext:0', lang: 'en', label: '' }, delayMs: 250 });
    // Another content: no delay, and its own choice made without one.
    await playing(r, vod(8));
    expect(r.player.subtitleDelay).toBe(0);
    await r.player.selectText('ext:0');
    expect(shown(r)).toBe('file: one');
    expect(r.memory.choice('s1:vod:8')).toEqual({ audio: null, text: { id: 'ext:0', lang: 'en', label: '' } });
    // The first again: its file and its timing come back (at media time 100 ms, 'one' shows 250 ms later).
    await playing(r);
    expect(r.player.subtitleDelay).toBe(250);
    expect(shown(r)).toBe('file: ');
    await r.clock.advance(2 * CUE_TICK_MS);
    expect(shown(r)).toBe('file: one');
    // Nothing playing: the timing applies, and nothing is remembered.
    void r.player.stop();
    r.player.setSubtitleDelay(1000);
    expect(r.player.subtitleDelay).toBe(1000);
    expect(r.memory.choice('s1:vod:7')).toEqual({ audio: null, text: { id: 'ext:0', lang: 'en', label: '' }, delayMs: 250 });
  });

  it('keeps the cues while paused or buffering, and shows none while it reconnects or after the end', async () => {
    const r = rig({}, (_s, n) => (n === 1 ? { tracksMs: 200, bufferingMs: 800, playingMs: 1200, error: { atMs: 3000, error: { kind: 'network', code: 'X' } } } : { tracksMs: 200, endMs: 2000 }));
    await playing(r);
    await r.player.selectText('ext:0');
    await r.clock.advance(200);
    expect(r.player.status.state).toBe('buffering');
    expect(shown(r)).toBe('file: one');
    await r.clock.advance(400);
    r.player.pause();
    expect(shown(r)).toBe('file: one');
    await r.clock.advance(3 * CUE_TICK_MS);
    expect(shown(r)).toBe('file: one');
    r.player.resume();
    await r.clock.advance(1000);
    expect(shown(r)).toBe('file: two');
    // The error at 3000: a retry, no cues until the new load's first frame.
    await r.clock.advance(50);
    expect(r.player.status.state).toBe('reconnecting');
    expect(shown(r)).toBe('file: ');
    // The reopen (loaded at 3050) resumes where the watchdog last saw it (media time 1300), in "two".
    await r.clock.advance(549);
    expect(shown(r)).toBe('file: ');
    await r.clock.advance(1);
    expect(r.player.status.state).toBe('playing');
    expect(shown(r)).toBe('file: two');
    await r.clock.advance(1500);
    expect(r.player.status.state).toBe('ended');
    expect(shown(r)).toBe('file: ');
  });

  it('shows nothing while the app is hidden, and the cues again once the picture is back', async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('ext:0');
    r.player.hide();
    expect(shown(r)).toBe('file: ');
    // No lookups while hidden.
    const before = r.views.length;
    await r.clock.advance(10 * CUE_TICK_MS);
    expect(r.views).toHaveLength(before);
    expect(r.clock.pending).toBe(0);
    r.player.show();
    await r.clock.advance(499);
    expect(shown(r)).toBe('file: ');
    await r.clock.advance(1 + CUE_TICK_MS);
    expect(shown(r)).toBe('file: one');
  });

  it('stops on a zap and a stop, with no lookups left running', async () => {
    const r = rig();
    await playing(r);
    await r.player.selectText('ext:0');
    void r.player.play(vod(8));
    expect(r.player.subtitles).toEqual({ feed: null, cues: [] });
    await r.clock.advance(600);
    await r.player.selectText('ext:0');
    void r.player.stop();
    expect(r.player.subtitles).toEqual({ feed: null, cues: [] });
    await r.clock.advance(100);
    expect(r.clock.pending).toBe(0);
  });

  it('stops telling a listener once it unsubscribed or the controller was disposed', async () => {
    const r = rig();
    const extra: SubtitleView[] = [];
    const off = r.player.subscribeSubtitles((v) => extra.push(v));
    await playing(r);
    await r.player.selectText('ext:0');
    off();
    await r.clock.advance(4 * CUE_TICK_MS);
    expect(extra).toHaveLength(1);
    // Disposing stops the stream: the last view says nothing shows, and none follow.
    r.player.dispose();
    expect(r.views[r.views.length - 1]).toEqual({ feed: null, cues: [] });
    const count = r.views.length;
    await r.clock.advance(4 * CUE_TICK_MS);
    expect(r.views).toHaveLength(count);
  });
});

describe("PlayerController: an engine's cues (AVPlay)", () => {
  /** AVPlay: the engine delivers the text of the stream's own subtitles. */
  async function avplay(r: Rig = rig()): Promise<Rig> {
    r.engine.deliversText = true;
    await playing(r);
    await r.player.selectText('3');
    expect(r.player.subtitles).toEqual({ feed: 'engine', cues: [] });
    return r;
  }

  it('shows a cue, cleaned of its markup, for its duration', async () => {
    const r = await avplay();
    r.engine.emit(r.token(), { type: 'cue', text: '<i>Hello</i>\r\n{\\an8}there ', durationMs: 1200 });
    expect(r.player.subtitles).toEqual({ feed: 'engine', cues: ['Hello\nthere'] });
    await r.clock.advance(1199);
    expect(r.player.subtitles.cues).toEqual(['Hello\nthere']);
    await r.clock.advance(1);
    expect(r.player.subtitles.cues).toEqual([]);
    expect(r.clock.pending).toBe(1);
  });

  it(`shows a cue with no duration for ${ENGINE_CUE_MS} ms, and the same text again only stays longer`, async () => {
    const r = await avplay();
    r.engine.emit(r.token(), { type: 'cue', text: 'Hello', durationMs: 0 });
    await r.clock.advance(1000);
    expect(r.player.subtitles.cues).toEqual(['Hello']);
    r.engine.emit(r.token(), { type: 'cue', text: 'Hello', durationMs: 2000 });
    r.engine.emit(r.token(), { type: 'cue', text: 'World', durationMs: 500 });
    expect(r.player.subtitles.cues).toEqual(['Hello', 'World']);
    await r.clock.advance(500);
    expect(r.player.subtitles.cues).toEqual(['Hello']);
    await r.clock.advance(1499);
    expect(r.player.subtitles.cues).toEqual(['Hello']);
    await r.clock.advance(1);
    expect(r.player.subtitles.cues).toEqual([]);
    // A negative duration is no duration.
    r.engine.emit(r.token(), { type: 'cue', text: 'Again', durationMs: -5 });
    await r.clock.advance(ENGINE_CUE_MS - 1);
    expect(r.player.subtitles.cues).toEqual(['Again']);
    await r.clock.advance(1);
    expect(r.player.subtitles.cues).toEqual([]);
  });

  it('lets each cue go at its own time, to the millisecond', async () => {
    const r = await avplay();
    r.engine.emit(r.token(), { type: 'cue', text: 'A', durationMs: 1000 });
    r.engine.emit(r.token(), { type: 'cue', text: 'B', durationMs: 1001 });
    await r.clock.advance(1000);
    expect(r.player.subtitles.cues).toEqual(['B']);
    await r.clock.advance(1);
    expect(r.player.subtitles.cues).toEqual([]);
  });

  it(`shows at most ${MAX_ENGINE_CUES} at once, the oldest going first`, async () => {
    const r = await avplay();
    for (let i = 1; i <= MAX_ENGINE_CUES + 1; i++) r.engine.emit(r.token(), { type: 'cue', text: `cue ${i}`, durationMs: 1000 });
    expect(r.player.subtitles.cues).toEqual(['cue 2', 'cue 3', 'cue 4', 'cue 5']);
  });

  it('ignores empty cues, cues with no own subtitles on, from an engine that draws them itself, or while a file shows', async () => {
    const r = await avplay();
    r.engine.emit(r.token(), { type: 'cue', text: '<b> </b>', durationMs: 1000 });
    expect(r.player.subtitles.cues).toEqual([]);
    await r.player.selectText(null);
    const pending = r.clock.pending;
    r.engine.emit(r.token(), { type: 'cue', text: 'Off', durationMs: 1000 });
    expect(r.player.subtitles).toEqual({ feed: null, cues: [] });
    // Not even kept for later: no timer for it.
    expect(r.clock.pending).toBe(pending);
    await r.player.selectText('ext:0');
    r.engine.emit(r.token(), { type: 'cue', text: 'Under the file', durationMs: 1000 });
    expect(shown(r)).toBe('file: one');
    const webos = rig();
    await playing(webos);
    await webos.player.selectText('3');
    const before = webos.clock.pending;
    webos.engine.emit(webos.token(), { type: 'cue', text: 'Drawn by the TV', durationMs: 1000 });
    expect(webos.player.subtitles).toEqual({ feed: null, cues: [] });
    expect(webos.views).toEqual([]);
    expect(webos.clock.pending).toBe(before);
  });

  it("drops a stale load's cues, and the cues showing on a track switch, a retry, a zap or a hide", async () => {
    const r = await avplay(rig({}, (_s, n) => (n === 1 ? { tracksMs: 200, error: { atMs: 2000, error: { kind: 'network', code: 'X' } } } : { tracksMs: 200 })));
    r.engine.emit(r.token() - 1, { type: 'cue', text: 'Stale', durationMs: 1000 });
    expect(r.player.subtitles.cues).toEqual([]);
    r.engine.emit(r.token(), { type: 'cue', text: 'One', durationMs: 5000 });
    await r.player.selectText('4');
    expect(r.player.subtitles).toEqual({ feed: 'engine', cues: [] });
    r.engine.emit(r.token(), { type: 'cue', text: 'Two', durationMs: 5000 });
    // The error at 2000.
    await r.clock.advance(1400);
    expect(r.player.status.state).toBe('reconnecting');
    expect(r.player.subtitles.cues).toEqual([]);
    // The reopened stream lists the same subtitle on: the failed load's cue is gone.
    await r.clock.advance(600);
    expect(r.player.subtitles).toEqual({ feed: 'engine', cues: [] });
    r.engine.text = [track('3', 'eng', true)];
    await r.player.selectText('3');
    r.engine.emit(r.token(), { type: 'cue', text: 'Three', durationMs: 5000 });
    r.player.hide();
    expect(r.player.subtitles.cues).toEqual([]);
    r.player.show();
    await r.clock.advance(600);
    r.engine.emit(r.token(), { type: 'cue', text: 'Four', durationMs: 5000 });
    expect(r.player.subtitles.cues).toEqual(['Four']);
    void r.player.play(vod(8));
    expect(r.player.subtitles).toEqual({ feed: null, cues: [] });
    // The next stream shows its own subtitles by default: none of the last one's cues.
    await r.clock.advance(600);
    expect(r.player.subtitles).toEqual({ feed: 'engine', cues: [] });
    void r.player.stop();
    await r.clock.advance(100);
    expect(r.clock.pending).toBe(0);
  });

  it("can't be moved by the delay", async () => {
    const r = await avplay();
    r.player.setSubtitleDelay(2000);
    r.engine.emit(r.token(), { type: 'cue', text: 'Now', durationMs: 1000 });
    expect(r.player.subtitles.cues).toEqual(['Now']);
  });
});
