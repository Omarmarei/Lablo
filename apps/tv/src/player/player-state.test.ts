import type { CatalogItem, ContentKey } from '@zoma/core';
import type { EpgNowNext } from '@zoma/data';
import type { Intent } from '@zoma/platform-api';
import type { PictureMode, PlaybackFailure, PlayerState, PlayerStatus, PlayerTracks, PlayOptions, PlayRequest, StreamStats, SubtitleView } from '@zoma/player';
import { NO_STATS, NO_TRACKS } from '@zoma/player';
import { createNavigator } from '@zoma/ui';
import { describe, expect, it } from 'vitest';
import type { LiveRow, Timers } from '../live/live-state';
import type { ArchiveProgramme } from './catchup';
import { HELD_PRESSES, JUMP_STEP_MS, MOVIE_STEP_MS } from './catchup';
import type { MoviePlay, PlayerLike, PlayerOptions, ZapList } from './player-state';
import {
  CHANNEL_ACTIONS,
  DIGITS_MS,
  HOLD_MS,
  INFO_MS,
  MISSING_MS,
  MOVIE_ACTIONS,
  PICTURE_ACTION,
  PLAY_ON_MS,
  POSITION_MS,
  SEEK_DELAY_MS,
  STATS_ACTION,
  TRACKS_ACTION,
  ZAP_DELAY_MS,
  createPlayer,
  liveRequest,
} from './player-state';
import { STATS_MS } from './stream-info';
import type { SubtitleSize } from './track-menu';
import { DEFAULT_SUBTITLE_SIZE, DELAY_STEP_MS, MAX_DELAY_MS, MENU_ROWS } from './track-menu';

const COUNT = 20;

function row(i: number): LiveRow {
  const item: CatalogItem = {
    key: `x:s1:live:${i}`,
    src: 's1',
    kind: 'live',
    name: `Channel ${i}`,
    normName: '',
    group: '',
    url: `http://panel.test/live/u/p/${100 + i}.ts`,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
  return { item, number: i + 1 };
}

/** The live screen's list: rows `0…COUNT-1`, those in `loaded` known at once; loads and searches held until the test answers. */
class FakeList implements ZapList {
  readonly loaded = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  readonly loads: { index: number; resolve: () => void }[] = [];
  /** One read per row while it is on its way (the live screen joins reads of a chunk). */
  private readonly reading = new Map<number, Promise<LiveRow | null>>();
  readonly finds: { n: number; answer: (index: number) => void; fail: () => void }[] = [];
  readonly locates: { key: ContentKey; guess: number; answer: (index: number) => void; fail: () => void }[] = [];
  readonly guides = new Map<ContentKey, EpgNowNext>();
  readonly asked: ContentKey[] = [];
  /** The live screen's list is in (else it has no rows to zap through). */
  ready = true;

  count(): number {
    return this.ready ? COUNT : 0;
  }

  row(index: number): LiveRow | null {
    return this.loaded.has(index) ? row(index) : null;
  }

  load(index: number): Promise<LiveRow | null> {
    if (this.loaded.has(index)) return Promise.resolve(row(index));
    const running = this.reading.get(index);
    if (running !== undefined) return running;
    const read = new Promise<LiveRow | null>((resolve) => {
      this.loads.push({
        index,
        resolve: () => {
          this.reading.delete(index);
          if (index >= 0 && index < COUNT) this.loaded.add(index);
          resolve(index >= 0 && index < COUNT ? row(index) : null);
        },
      });
    });
    this.reading.set(index, read);
    return read;
  }

  find(n: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.finds.push({ n, answer: resolve, fail: () => reject(new Error('read failed')) });
    });
  }

  locate(key: ContentKey, guess: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.locates.push({ key, guess, answer: resolve, fail: () => reject(new Error('read failed')) });
    });
  }

  guide(key: ContentKey): EpgNowNext | undefined {
    return this.guides.get(key);
  }

  askGuide(key: ContentKey): void {
    this.asked.push(key);
  }
}

const IDLE: PlayerStatus = { state: 'idle', session: 0, key: null, container: null, attempt: 0, failure: null, tracks: NO_TRACKS };
const NOT_FOUND: PlaybackFailure = { category: 'provider', code: 'PRV-HTTP-404', detail: 'MEDIA_ERR_SRC_NOT_SUPPORTED', account: null };

/** The controller, as the player sees it: it records plays and stops, and the test sets its state. */
class FakeController implements PlayerLike {
  status: PlayerStatus = IDLE;
  readonly plays: PlayRequest[] = [];
  stops = 0;
  /** The stream's tracks, in every status from `set` on. */
  tracks: PlayerTracks = NO_TRACKS;
  /** Track switches the menu asked for, answered by the test. */
  readonly switches: { readonly call: string; readonly answer: (ok: boolean) => void }[] = [];
  private listeners: ((status: PlayerStatus) => void)[] = [];
  subtitles: SubtitleView = { feed: null, cues: [] };
  /** The timings the menu set. */
  readonly delays: number[] = [];
  /** The content playing's timing; a play sets the one in `delayFor` (else 0), like the controller. */
  subtitleDelay = 0;
  readonly delayFor: Record<string, number> = {};
  private subtitleListeners: ((view: SubtitleView) => void)[] = [];
  /** What `stats()` answers, and how often it was asked. */
  statsValue: StreamStats | null = null;
  statsReads = 0;
  /** The modes the engine can show, and each mode the player asked for. */
  pictureModes: PictureMode[] = ['fit', 'zoom', 'stretch', '4:3'];
  readonly pictures: PictureMode[] = [];
  /** The stream's container in every status from `set` on (`hls`: a catch-up seeks inside it). */
  container: PlayerStatus['container'] = 'ts';
  /** The media time a picture shows at; each seek asked for, answered by `seekOk`; pauses and resumes. */
  media = 0;
  readonly seeks: number[] = [];
  seekOk = true;
  readonly pauses: string[] = [];
  /** The length a VOD shows (step 26c), and each play's options. */
  duration = 0;
  readonly options: PlayOptions[] = [];

  durationMs(): number {
    const state = this.status.state;
    return state === 'playing' || state === 'paused' || state === 'buffering' ? this.duration : 0;
  }

  pause(): void {
    this.pauses.push('pause');
    if (this.status.state === 'playing' || this.status.state === 'buffering') this.set('paused');
  }

  resume(): void {
    this.pauses.push('resume');
    if (this.status.state === 'paused') this.set('playing');
  }

  positionMs(): number {
    const state = this.status.state;
    return state === 'playing' || state === 'paused' || state === 'buffering' ? this.media : 0;
  }

  seek(ms: number): Promise<boolean> {
    this.seeks.push(ms);
    if (this.seekOk) this.media = ms;
    return Promise.resolve(this.seekOk);
  }

  setPicture(mode: PictureMode): PictureMode {
    this.pictures.push(mode);
    return this.pictureModes.indexOf(mode) === -1 ? 'fit' : mode;
  }

  stats(): StreamStats | null {
    this.statsReads += 1;
    return this.statsValue;
  }

  subscribeSubtitles(listener: (view: SubtitleView) => void): () => void {
    this.subtitleListeners.push(listener);
    return () => {
      this.subtitleListeners = this.subtitleListeners.filter((l) => l !== listener);
    };
  }

  /** What to draw, published like the controller does. */
  setSubtitles(view: SubtitleView): void {
    this.subtitles = view;
    for (const listener of this.subtitleListeners.slice()) listener(view);
  }

  get subtitleListening(): number {
    return this.subtitleListeners.length;
  }

  setSubtitleDelay(ms: number): void {
    this.delays.push(ms);
  }

  subscribe(listener: (status: PlayerStatus) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  get listening(): number {
    return this.listeners.length;
  }

  play(req: PlayRequest, opts: PlayOptions = {}): Promise<void> {
    this.plays.push(req);
    this.options.push(opts);
    this.subtitleDelay = this.delayFor[req.key] ?? 0;
    this.set('opening', null, req.key);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stops += 1;
    this.set('idle', null, null);
    return Promise.resolve();
  }

  set(state: PlayerState, failure: PlaybackFailure | null = null, key: ContentKey | null = this.status.key): void {
    this.status = { state, session: this.status.session + (state === 'opening' && failure === null ? 1 : 0), key, container: this.container, attempt: 0, failure, tracks: this.tracks };
    for (const listener of this.listeners.slice()) listener(this.status);
  }

  /** New track lists, published like the controller does (the state stays). */
  setTracks(tracks: PlayerTracks): void {
    this.tracks = tracks;
    this.set(this.status.state, this.status.failure);
  }

  selectAudio(id: string): Promise<boolean> {
    return new Promise((resolve) => this.switches.push({ call: `audio ${id}`, answer: resolve }));
  }

  selectText(id: string | null): Promise<boolean> {
    return new Promise((resolve) => this.switches.push({ call: `text ${String(id)}`, answer: resolve }));
  }

  calls(): string[] {
    return this.switches.map((s) => s.call);
  }

  /** The rows played, by their stream URL's id. */
  played(): number[] {
    return this.plays.map((p) => Number(/(\d+)\.ts$/.exec(p.candidates[0]!.url)![1]) - 100);
  }
}

function manualTimers() {
  let now = 0;
  let seq = 0;
  const queue: { id: number; at: number; run: () => void }[] = [];
  const timers: Timers = {
    set: (run, ms) => {
      seq += 1;
      queue.push({ id: seq, at: now + ms, run });
      return seq;
    },
    clear: (handle) => {
      const i = queue.findIndex((t) => t.id === handle);
      if (i !== -1) queue.splice(i, 1);
    },
  };
  return {
    timers,
    now: () => now,
    pending: () => queue.length,
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function setup(
  dir: 'ltr' | 'rtl' = 'ltr',
  kept: {
    subtitleSize?: SubtitleSize;
    outputFormats?: (src: string) => readonly string[] | null;
    picture?: PictureMode;
    catchupRequest?: PlayerOptions['catchupRequest'];
    programmeAt?: PlayerOptions['programmeAt'];
    /** The wall clock's time when the test starts (it moves with the test's clock). */
    wallAt?: number;
  } = {},
) {
  const list = new FakeList();
  /** Each `tuned` call: the channel's key and its row. */
  const tuned: string[] = [];
  const sized: SubtitleSize[] = [];
  const pictured: PictureMode[] = [];
  const controller = new FakeController();
  const clock = manualTimers();
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: COUNT }] },
    dir,
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const chrome: boolean[] = [];
  const closed: number[] = [];
  let made = 0;
  const player = createPlayer({
    nav,
    list,
    player: () => {
      made += 1;
      return controller;
    },
    chrome: (on) => chrome.push(on),
    closed: (index) => closed.push(index),
    tuned: (r, index) => tuned.push(`${r.item.key} @${index}`),
    sized: (size) => sized.push(size),
    pictured: (mode) => pictured.push(mode),
    ...(kept.subtitleSize === undefined ? {} : { subtitleSize: kept.subtitleSize }),
    ...(kept.outputFormats === undefined ? {} : { outputFormats: kept.outputFormats }),
    ...(kept.picture === undefined ? {} : { picture: kept.picture }),
    ...(kept.catchupRequest === undefined ? {} : { catchupRequest: kept.catchupRequest }),
    ...(kept.programmeAt === undefined ? {} : { programmeAt: kept.programmeAt }),
    ...(kept.wallAt === undefined ? {} : { clock: () => kept.wallAt! + clock.now() }),
    timers: clock.timers,
    now: clock.now,
  });
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  return { list, controller, clock, nav, player, chrome, closed, tuned, sized, pictured, press, at, made: () => made };
}

describe('the player: opening and closing (RELAY step 20a)', () => {
  it('opens on a row: its screen on the navigator, the page transparent, the stream at once, the info bar', () => {
    const t = setup();
    t.player.show(2);
    expect(t.at()).toBe('player · actions 0');
    expect(t.nav.snapshot().depth).toBe(2);
    expect(t.chrome).toEqual([true]);
    expect(t.player.open.value).toBe(true);
    expect(t.controller.plays).toEqual([liveRequest(row(2))]);
    expect(t.controller.plays[0]!.candidates.map((c) => c.url)).toEqual(['http://panel.test/live/u/p/102.ts', 'http://panel.test/live/u/p/102.m3u8']);
    expect(t.player).toMatchObject({ target: { value: 2 }, playing: { value: 2 }, previous: { value: -1 }, plays: { value: 1 }, info: { value: true } });
    expect(t.player.status.value.state).toBe('opening');
    expect(t.list.asked).toEqual(['x:s1:live:2']);
  });

  it("asks only for the formats the source's account allows, read again on every play (step 20c2a)", async () => {
    const asked: string[] = [];
    let formats: readonly string[] | null = ['m3u8'];
    const t = setup('ltr', {
      outputFormats: (src) => {
        asked.push(src);
        return formats;
      },
    });
    t.player.show(2);
    expect(t.controller.plays[0]!.candidates).toEqual([{ url: 'http://panel.test/live/u/p/102.m3u8', container: 'hls' }]);
    expect(t.controller.plays[0]).toEqual(liveRequest(row(2), ['m3u8']));
    expect(asked).toEqual(['s1']);
    // The account's formats came in late (or changed): the next play takes them.
    formats = null;
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.plays[1]!.candidates.map((c) => c.container)).toEqual(['ts', 'hls']);
    expect(asked).toEqual(['s1', 's1']);
  });

  it('makes the controller once, on the first play', async () => {
    const t = setup();
    expect(t.made()).toBe(0);
    t.player.show(1);
    await t.press('BACK');
    t.player.show(3);
    expect(t.made()).toBe(1);
    expect(t.controller.played()).toEqual([1, 3]);
    expect(t.controller.listening).toBe(1);
  });

  it('closes on Back: the screen goes, the stream stops, the page shows again, the list focuses the row that played', async () => {
    const t = setup();
    t.player.show(4);
    await t.press('CH_UP');
    // The zap still waits: the row that played is 4.
    await t.press('BACK');
    expect(t.at()).toBe('live · channels 0');
    expect(t.controller.stops).toBe(1);
    expect(t.chrome).toEqual([true, false]);
    expect(t.closed).toEqual([4]);
    expect(t.player).toMatchObject({ open: { value: false }, screen: { value: null }, info: { value: false } });
    // The zap that waited never plays, and every timer is gone.
    t.clock.advance(10_000);
    expect(t.controller.played()).toEqual([4]);
    expect(t.clock.pending()).toBe(0);
    // A second close changes nothing.
    t.player.close();
    expect(t.closed).toEqual([4]);
  });

  it('closes on STOP too, and dispose lets go of the controller', async () => {
    const t = setup();
    t.player.show(1);
    await t.press('STOP');
    expect(t.closed).toEqual([1]);
    t.player.show(2);
    t.player.dispose();
    expect(t.closed).toEqual([1, 2]);
    expect(t.controller.listening).toBe(0);
  });

  it("closes before a row's chunk arrives without playing it", async () => {
    const t = setup();
    t.player.show(15);
    expect(t.controller.plays).toEqual([]);
    await t.press('BACK');
    t.list.loads[0]!.resolve();
    await flush();
    expect(t.controller.plays).toEqual([]);
    expect(t.closed).toEqual([15]);
  });

  it('ignores a second show while it is open', () => {
    const t = setup();
    t.player.show(1);
    t.player.show(2);
    expect(t.controller.played()).toEqual([1]);
    expect(t.nav.snapshot().depth).toBe(2);
  });
});

describe('the player: zapping', () => {
  it('moves the info bar at once and opens the stream 350 ms after the last key', async () => {
    const t = setup();
    t.player.show(2);
    await t.press('CH_UP');
    t.clock.advance(200);
    await t.press('CH_UP');
    t.clock.advance(200);
    await t.press('UP');
    expect(t.player.target.value).toBe(5);
    expect(t.player.playing.value).toBe(2);
    t.clock.advance(ZAP_DELAY_MS - 1);
    await flush();
    expect(t.controller.played()).toEqual([2]);
    t.clock.advance(1);
    await flush();
    expect(t.controller.played()).toEqual([2, 5]);
    expect(t.player).toMatchObject({ playing: { value: 5 }, previous: { value: 2 }, plays: { value: 2 } });
    await t.press('CH_DOWN', 'DOWN');
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    expect(t.controller.played()).toEqual([2, 5, 3]);
    expect(t.player.previous.value).toBe(5);
  });

  it('wraps at both ends of the list', async () => {
    const t = setup();
    t.player.show(0);
    await t.press('CH_DOWN');
    expect(t.player.target.value).toBe(COUNT - 1);
    await t.press('CH_UP', 'CH_UP');
    expect(t.player.target.value).toBe(1);
  });

  it("reads the chunk of a row it zaps to, and opens it once it arrives (a newer zap wins)", async () => {
    const t = setup();
    t.player.show(9);
    await t.press('CH_UP');
    expect(t.player.target.value).toBe(10);
    expect(t.list.loads.map((l) => l.index)).toEqual([10]);
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    expect(t.controller.played()).toEqual([9]);
    t.list.loads[0]!.resolve();
    await flush();
    expect(t.controller.played()).toEqual([9, 10]);
    expect(t.list.asked).toEqual(['x:s1:live:9', 'x:s1:live:10']);
    // A row still loading when a newer zap opens: the older one never plays.
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    await t.press('CH_DOWN', 'CH_DOWN');
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    for (const load of t.list.loads.splice(0)) load.resolve();
    await flush();
    expect(t.controller.played()).toEqual([9, 10, 9]);
  });

  it('hides the card of the channel it zaps away from, and brings the focus back to the bar when the new stream opens', async () => {
    const t = setup();
    t.player.show(1);
    t.controller.set('failed', NOT_FOUND);
    expect(t.at()).toBe('player · card 0');
    expect(t.nav.top.zone('card')).toMatchObject({ count: 2 });
    await t.press('CH_UP');
    // The target moved on: the view hides the old card (target !== playing).
    expect(t.player.target.value).not.toBe(t.player.playing.value);
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    expect(t.at()).toBe('player · actions 0');
    expect(t.nav.top.zone('card')).toMatchObject({ count: 0 });
  });
});

describe('the player: number entry', () => {
  it('collects digits for 1.5 s after the last one, then opens the channel with that number', async () => {
    const t = setup();
    t.player.show(0);
    await t.press('DIGIT_1');
    t.clock.advance(1000);
    await t.press('DIGIT_2');
    expect(t.player.entry.value).toEqual({ digits: '12', phase: 'typing' });
    t.clock.advance(DIGITS_MS - 1);
    expect(t.list.finds).toEqual([]);
    t.clock.advance(1);
    expect(t.list.finds.map((f) => f.n)).toEqual([12]);
    expect(t.player.entry.value).toEqual({ digits: '12', phase: 'finding' });
    t.list.finds[0]!.answer(7);
    await flush();
    expect(t.player.entry.value).toBeNull();
    // Straight there, no zap delay.
    expect(t.controller.played()).toEqual([0, 7]);
    expect(t.player).toMatchObject({ target: { value: 7 }, previous: { value: 0 }, info: { value: true } });
  });

  it('ends early on OK, keeps at most four digits, and Back cancels it without closing', async () => {
    const t = setup();
    t.player.show(0);
    await t.press('DIGIT_9', 'DIGIT_8', 'DIGIT_7', 'DIGIT_6', 'DIGIT_5');
    expect(t.player.entry.value?.digits).toBe('9876');
    await t.press('OK');
    expect(t.list.finds.map((f) => f.n)).toEqual([9876]);
    // OK again while it looks: nothing more.
    await t.press('OK');
    expect(t.list.finds).toHaveLength(1);
    await t.press('BACK');
    expect(t.player.entry.value).toBeNull();
    expect(t.player.open.value).toBe(true);
    t.list.finds[0]!.answer(3);
    await flush();
    expect(t.controller.played()).toEqual([0]);
    await t.press('DIGIT_4', 'BACK');
    t.clock.advance(DIGITS_MS);
    expect(t.list.finds).toHaveLength(1);
    expect(t.player.open.value).toBe(true);
  });

  it('says no channel has the number for 2 s', async () => {
    const t = setup();
    t.player.show(0);
    await t.press('DIGIT_5', 'DIGIT_7', 'OK');
    t.list.finds[0]!.answer(-1);
    await flush();
    expect(t.player.entry.value).toEqual({ digits: '57', phase: 'missing' });
    t.clock.advance(MISSING_MS - 1);
    expect(t.player.entry.value?.phase).toBe('missing');
    t.clock.advance(1);
    expect(t.player.entry.value).toBeNull();
    expect(t.controller.played()).toEqual([0]);
  });

  it('starts over on a digit while it looks or after "none", dropping the old answer', async () => {
    const t = setup();
    t.player.show(0);
    await t.press('DIGIT_3', 'OK', 'DIGIT_4');
    expect(t.player.entry.value).toEqual({ digits: '4', phase: 'typing' });
    t.list.finds[0]!.answer(2);
    await flush();
    expect(t.controller.played()).toEqual([0]);
    expect(t.player.entry.value).toEqual({ digits: '4', phase: 'typing' });
    await t.press('OK');
    t.list.finds[1]!.answer(-1);
    await flush();
    await t.press('DIGIT_6');
    expect(t.player.entry.value).toEqual({ digits: '6', phase: 'typing' });
    // The "none" timer of the old entry doesn't end the new one.
    t.clock.advance(MISSING_MS);
    expect(t.list.finds.map((f) => f.n)).toEqual([3, 4, 6]);
  });

  it('gives up quietly when the search fails, and a zap or PRE-CH cancels the entry', async () => {
    const t = setup();
    t.player.show(0);
    await t.press('DIGIT_1', 'OK');
    t.list.finds[0]!.fail();
    await flush();
    expect(t.player.entry.value).toBeNull();
    await t.press('DIGIT_2', 'CH_UP');
    expect(t.player.entry.value).toBeNull();
    await t.press('DIGIT_3', 'PREV_CH');
    expect(t.player.entry.value).toBeNull();
    t.clock.advance(DIGITS_MS);
    expect(t.list.finds).toHaveLength(1);
  });
});

describe('the player: previous channel, the info bar and the card', () => {
  it('goes back to the channel watched before with PRE-CH or the bar button, and back again', async () => {
    const t = setup();
    t.player.show(1);
    // Nothing before the first channel.
    await t.press('PREV_CH');
    expect(t.controller.played()).toEqual([1]);
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    await t.press('PREV_CH');
    expect(t.controller.played()).toEqual([1, 2, 1]);
    expect(t.player).toMatchObject({ target: { value: 1 }, previous: { value: 2 } });
    // The bar is up: OK presses its button.
    await t.press('OK');
    expect(t.controller.played()).toEqual([1, 2, 1, 2]);
  });

  it('shows a hidden bar on the first OK or arrow, and only then presses its button', async () => {
    const t = setup();
    t.player.show(1);
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    t.controller.set('playing');
    t.clock.advance(INFO_MS);
    expect(t.player.info.value).toBe(false);
    await t.press('OK');
    expect(t.player.info.value).toBe(true);
    expect(t.controller.played()).toEqual([1, 2]);
    t.clock.advance(INFO_MS);
    await t.press('RIGHT');
    expect(t.player.info.value).toBe(true);
    await t.press('LEFT', 'OK');
    expect(t.controller.played()).toEqual([1, 2, 1]);
  });

  it('hides the bar 5 s after the last key once a picture shows, keeps it while opening or failed, and INFO toggles it', async () => {
    const t = setup();
    t.player.show(1);
    t.clock.advance(INFO_MS * 3);
    expect(t.player.info.value).toBe(true);
    t.controller.set('playing');
    t.clock.advance(INFO_MS);
    expect(t.player.info.value).toBe(false);
    await t.press('INFO');
    expect(t.player.info.value).toBe(true);
    t.clock.advance(INFO_MS - 1);
    // A key keeps it up for another 5 s.
    await t.press('RIGHT');
    t.clock.advance(INFO_MS - 1);
    expect(t.player.info.value).toBe(true);
    t.clock.advance(1);
    expect(t.player.info.value).toBe(false);
    await t.press('INFO', 'INFO');
    expect(t.player.info.value).toBe(false);
    expect(t.clock.pending()).toBe(0);
    t.controller.set('failed', NOT_FOUND);
    t.clock.advance(INFO_MS * 3);
    expect(t.player.info.value).toBe(true);
  });

  it("puts the focus on the card's buttons when the player gives up: Try again plays the channel again, Channels closes", async () => {
    const t = setup();
    t.player.show(3);
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    t.controller.set('failed', NOT_FOUND);
    expect(t.at()).toBe('player · card 0');
    await t.press('OK');
    expect(t.controller.played()).toEqual([3, 4, 4]);
    // Trying again isn't a new channel: the previous one stays.
    expect(t.player.previous.value).toBe(3);
    expect(t.at()).toBe('player · actions 0');
    t.controller.set('failed', NOT_FOUND);
    await t.press('RIGHT');
    expect(t.at()).toBe('player · card 1');
    await t.press('OK');
    expect(t.closed).toEqual([4]);
    expect(t.at()).toBe('live · channels 0');
  });

  it('keeps the card while digits are typed, and ignores keys it has no use for', async () => {
    const t = setup();
    t.player.show(3);
    t.controller.set('failed', NOT_FOUND);
    await t.press('GUIDE', 'RED', 'FF');
    expect(t.at()).toBe('player · card 0');
    expect(t.controller.played()).toEqual([3]);
  });
});

/** A stream with Arabic (playing) and English sound, and English and Arabic subtitles (off). */
const TRACKS: PlayerTracks = {
  audio: [
    { id: '0', lang: 'ar', streamLang: 'ara', label: '', selected: true },
    { id: '1', lang: 'en', streamLang: 'eng', label: '', selected: false },
  ],
  text: [
    { id: '2', lang: 'en', streamLang: 'eng', label: '', selected: false },
    { id: '3', lang: 'ar', streamLang: 'ara', label: '', selected: false },
  ],
  switching: 'reliable',
};

/** TRACKS with the audio track `audio` and the subtitle `text` (`null`: none) selected. */
function choose(audio: number, text: number | null): PlayerTracks {
  return {
    audio: TRACKS.audio.map((t, i) => ({ ...t, selected: i === audio })),
    text: TRACKS.text.map((t, i) => ({ ...t, selected: i === text })),
    switching: 'reliable',
  };
}

/** The player on row 1, playing, with `tracks`. */
async function playing(tracks: PlayerTracks = TRACKS, dir: 'ltr' | 'rtl' = 'ltr') {
  const t = setup(dir);
  t.player.show(1);
  t.controller.set('playing');
  t.controller.setTracks(tracks);
  await flush();
  return t;
}

describe('the track menu (RELAY step 20b)', () => {
  it("opens from the info bar's button on the playing audio track; the bar makes room, and Back brings it back", async () => {
    const t = await playing();
    await t.press('RIGHT');
    expect(t.at()).toBe(`player · actions ${TRACKS_ACTION}`);
    await t.press('OK');
    expect(t.at()).toBe('tracks · audio 0');
    expect(t.nav.snapshot().depth).toBe(3);
    expect(t.player.info.value).toBe(false);
    expect(t.player.menu.screen.value).not.toBeNull();
    await t.press('BACK');
    expect(t.at()).toBe(`player · actions ${TRACKS_ACTION}`);
    expect(t.player.menu.screen.value).toBeNull();
    expect(t.player.info.value).toBe(true);
    // Still playing: Back closed only the menu.
    expect(t.controller.stops).toBe(0);
  });

  it('opens on the audio list with the audio key and on the subtitles with the subtitle key; the same key closes, the other moves', async () => {
    const t = await playing(choose(1, null));
    await t.press('AUDIO');
    expect(t.at()).toBe('tracks · audio 1');
    await t.press('SUBTITLES');
    // No subtitles show: "Off".
    expect(t.at()).toBe('tracks · text 0');
    await t.press('AUDIO');
    expect(t.at()).toBe('tracks · audio 1');
    await t.press('AUDIO');
    expect(t.at()).toBe('player · actions 0');
    await t.press('SUBTITLES');
    expect(t.at()).toBe('tracks · text 0');
    await t.press('SUBTITLES');
    expect(t.player.menu.screen.value).toBeNull();
    // A subtitle that shows is where the subtitle key lands.
    t.controller.setTracks(choose(1, 1));
    await t.press('SUBTITLES');
    expect(t.at()).toBe('tracks · text 2');
  });

  it('switches to the track OK is pressed on and stays open; the selected track and an "Off" with nothing showing do nothing', async () => {
    const t = await playing();
    await t.press('AUDIO', 'OK');
    expect(t.controller.calls()).toEqual([]);
    await t.press('DOWN', 'OK');
    expect(t.controller.calls()).toEqual(['audio 1']);
    expect(t.player.menu.pending.value).toBe(1);
    t.controller.switches[0]!.answer(true);
    await flush();
    expect(t.player.menu.pending.value).toBe(0);
    expect(t.player.menu.refused.value).toBeNull();
    expect(t.at()).toBe('tracks · audio 1');
    // Down from the audio list to the subtitles: "Off" with none showing, then Arabic.
    await t.press('DOWN', 'OK');
    expect(t.at()).toBe('tracks · text 0');
    expect(t.controller.calls()).toEqual(['audio 1']);
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.controller.calls()).toEqual(['audio 1', 'text 3']);
    // With a subtitle showing, "Off" turns it off.
    t.controller.setTracks(choose(0, 1));
    await t.press('UP', 'UP', 'OK');
    expect(t.controller.calls()).toEqual(['audio 1', 'text 3', 'text null']);
  });

  it('says when the TV refused a switch, until the next one', async () => {
    const t = await playing();
    await t.press('AUDIO', 'DOWN', 'OK');
    t.controller.switches[0]!.answer(false);
    await flush();
    expect(t.player.menu.refused.value).toBe('audio');
    await t.press('OK');
    expect(t.player.menu.refused.value).toBeNull();
    t.controller.switches[1]!.answer(true);
    await flush();
    expect(t.player.menu.refused.value).toBeNull();
    // On its own list.
    await t.press('DOWN', 'DOWN', 'OK');
    t.controller.switches[2]!.answer(false);
    await flush();
    expect(t.player.menu.refused.value).toBe('text');
  });

  it('drops the answer of a switch from a menu that closed', async () => {
    const t = await playing();
    await t.press('AUDIO', 'DOWN', 'OK', 'BACK');
    await t.press('AUDIO');
    t.controller.switches[0]!.answer(false);
    await flush();
    expect(t.player.menu.refused.value).toBeNull();
    expect(t.player.menu.pending.value).toBe(0);
  });

  it("has no audio list where the TV can't switch: it opens on the subtitles, and the audio key closes it", async () => {
    const t = await playing({ ...TRACKS, switching: 'none' });
    await t.press('AUDIO');
    expect(t.at()).toBe('tracks · text 0');
    await t.press('UP');
    expect(t.at()).toBe('tracks · text 0');
    await t.press('AUDIO');
    expect(t.player.menu.screen.value).toBeNull();
    // With no tracks at all: the subtitles' "Off".
    const none = await playing({ audio: [], text: [], switching: 'reliable' });
    await none.press('AUDIO');
    expect(none.at()).toBe('tracks · text 0');
  });

  it('follows the tracks while it shows: a longer list scrolls by the visible rows', async () => {
    const t = await playing({ audio: [], text: [], switching: 'reliable' });
    await t.press('SUBTITLES');
    const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i), lang: 'en', streamLang: 'eng', label: `Sub ${i}`, selected: false }));
    t.controller.setTracks({ audio: TRACKS.audio, text: many, switching: 'reliable' });
    const menu = t.player.menu.screen.value!;
    expect(menu.zone('text')).toMatchObject({ count: 9, visible: MENU_ROWS });
    expect(menu.zone('audio')).toMatchObject({ count: 2 });
    for (let i = 0; i < 8; i += 1) await t.press('DOWN');
    expect(t.at()).toBe('tracks · text 8');
    expect(menu.position('text').top).toBe(9 - MENU_ROWS);
    for (let i = 0; i < 9; i += 1) await t.press('UP');
    // Into the audio list at its remembered row.
    expect(t.at()).toBe('tracks · audio 0');
  });

  it("closes when the player gives up (the card takes the focus), and doesn't open over the card", async () => {
    const t = await playing();
    await t.press('AUDIO');
    t.controller.set('failed', NOT_FOUND);
    expect(t.player.menu.screen.value).toBeNull();
    expect(t.at()).toBe('player · card 0');
    expect(t.nav.snapshot().depth).toBe(2);
    await t.press('AUDIO', 'SUBTITLES');
    expect(t.at()).toBe('player · card 0');
  });

  it('closes the player on STOP, and with the player', async () => {
    const t = await playing();
    await t.press('AUDIO', 'STOP');
    expect(t.player.menu.screen.value).toBeNull();
    expect(t.closed).toEqual([1]);
    expect(t.at()).toBe('live · channels 0');
    expect(t.controller.stops).toBe(1);
    const u = await playing();
    await u.press('SUBTITLES');
    u.player.close();
    expect(u.at()).toBe('live · channels 0');
    expect(u.nav.snapshot().depth).toBe(1);
    expect(u.player.info.value).toBe(false);
    expect(u.clock.pending()).toBe(0);
  });

  it('ignores the keys it has no use for, and number entry ends when it opens', async () => {
    const t = await playing();
    await t.press('DIGIT_4', 'AUDIO');
    expect(t.player.entry.value).toBeNull();
    await t.press('DIGIT_7', 'PREV_CH', 'INFO', 'RED');
    expect(t.at()).toBe('tracks · audio 0');
    t.clock.advance(DIGITS_MS * 2);
    await flush();
    expect(t.list.finds).toEqual([]);
    expect(t.controller.played()).toEqual([1]);
  });
});

/** TRACKS with an English and an Arabic subtitle file after the stream's own subtitles (file `on` showing). */
function withFiles(on: number | null): PlayerTracks {
  const files = [
    { id: 'ext:0', lang: 'en', streamLang: 'eng', label: '', selected: on === 0 },
    { id: 'ext:1', lang: 'ar', streamLang: 'ara', label: '', selected: on === 1 },
  ];
  return { ...TRACKS, text: TRACKS.text.concat(files) };
}

describe('subtitle files and the subtitle style in the track menu (RELAY step 20b2b)', () => {
  it("lists the files after the stream's own subtitles and switches to one like a track", async () => {
    const t = await playing(withFiles(null));
    await t.press('SUBTITLES');
    expect(t.player.menu.screen.value!.zone('text')).toMatchObject({ count: 5 });
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    expect(t.controller.calls()).toEqual(['text ext:0']);
    t.controller.switches[0]!.answer(true);
    await flush();
    expect(t.player.menu.refused.value).toBeNull();
  });

  it("says when a file couldn't be loaded, apart from the TV's refusals, and only for the newest switch", async () => {
    const t = await playing(withFiles(null));
    await t.press('SUBTITLES', 'DOWN', 'DOWN', 'DOWN', 'OK');
    t.controller.switches[0]!.answer(false);
    await flush();
    expect(t.player.menu.refused.value).toBe('file');
    // Two switches at once: the older one's refusal arrives last and isn't shown.
    await t.press('DOWN', 'OK', 'UP', 'UP', 'OK');
    expect(t.controller.calls()).toEqual(['text ext:0', 'text ext:1', 'text 3']);
    t.controller.switches[2]!.answer(true);
    t.controller.switches[1]!.answer(false);
    await flush();
    expect(t.player.menu.refused.value).toBeNull();
    expect(t.player.menu.pending.value).toBe(0);
  });

  it('shows no style rows while the app draws no subtitles; "Size" for an engine\'s, "Size" and "Timing" for a file', async () => {
    const t = await playing(withFiles(null));
    await t.press('SUBTITLES');
    const menu = t.player.menu.screen.value!;
    expect(menu.zone('style')).toMatchObject({ count: 0 });
    // Down past the last subtitle: nowhere to go.
    for (let i = 0; i < 6; i += 1) await t.press('DOWN');
    expect(t.at()).toBe('tracks · text 4');
    t.controller.setSubtitles({ feed: 'engine', cues: [] });
    expect(menu.zone('style')).toMatchObject({ count: 1 });
    t.controller.setSubtitles({ feed: 'file', cues: ['Hello'] });
    expect(menu.zone('style')).toMatchObject({ count: 2 });
    await t.press('DOWN');
    expect(t.at()).toBe('tracks · style 0');
    await t.press('DOWN');
    expect(t.at()).toBe('tracks · style 1');
    await t.press('UP', 'UP');
    expect(t.at()).toBe('tracks · text 4');
    t.controller.setSubtitles({ feed: null, cues: [] });
    expect(menu.zone('style')).toMatchObject({ count: 0 });
  });

  it('changes the size with LEFT and RIGHT, stopping at the ends, and goes round them with OK', async () => {
    const t = await playing(withFiles(0));
    t.controller.setSubtitles({ feed: 'file', cues: [] });
    expect(t.player.menu.size.value).toBe(DEFAULT_SUBTITLE_SIZE);
    await t.press('SUBTITLES', 'DOWN', 'DOWN');
    expect(t.at()).toBe('tracks · style 0');
    await t.press('RIGHT');
    expect(t.player.menu.size.value).toBe('l');
    await t.press('RIGHT');
    expect(t.player.menu.size.value).toBe('l');
    await t.press('LEFT', 'LEFT', 'LEFT');
    expect(t.player.menu.size.value).toBe('s');
    await t.press('OK');
    expect(t.player.menu.size.value).toBe('m');
    await t.press('OK', 'OK');
    expect(t.player.menu.size.value).toBe('s');
    // The focus stayed on the row.
    expect(t.at()).toBe('tracks · style 0');
    expect(t.controller.delays).toEqual([]);
    expect(t.controller.calls()).toEqual([]);
  });

  it("moves a file's timing by steps with LEFT and RIGHT up to the limit, tells the controller, and OK puts it back", async () => {
    const t = await playing(withFiles(1));
    t.controller.setSubtitles({ feed: 'file', cues: [] });
    await t.press('SUBTITLES', 'DOWN', 'DOWN');
    expect(t.at()).toBe('tracks · style 1');
    await t.press('RIGHT', 'RIGHT');
    expect(t.player.menu.delay.value).toBe(2 * DELAY_STEP_MS);
    await t.press('LEFT', 'LEFT', 'LEFT');
    expect(t.player.menu.delay.value).toBe(-DELAY_STEP_MS);
    expect(t.controller.delays).toEqual([DELAY_STEP_MS, 2 * DELAY_STEP_MS, DELAY_STEP_MS, 0, -DELAY_STEP_MS]);
    await t.press('OK');
    expect(t.player.menu.delay.value).toBe(0);
    // Already on time: nothing to tell.
    await t.press('OK');
    expect(t.controller.delays).toEqual([DELAY_STEP_MS, 2 * DELAY_STEP_MS, DELAY_STEP_MS, 0, -DELAY_STEP_MS, 0]);
    for (let i = 0; i < MAX_DELAY_MS / DELAY_STEP_MS + 3; i += 1) await t.press('LEFT');
    expect(t.player.menu.delay.value).toBe(-MAX_DELAY_MS);
    for (let i = 0; i < (2 * MAX_DELAY_MS) / DELAY_STEP_MS + 3; i += 1) await t.press('RIGHT');
    expect(t.player.menu.delay.value).toBe(MAX_DELAY_MS);
    expect(t.controller.delays[t.controller.delays.length - 1]).toBe(MAX_DELAY_MS);
    expect(t.controller.delays.filter((d) => d === MAX_DELAY_MS)).toHaveLength(1);
  });

  it('goes the other way in Arabic: LEFT is larger and later', async () => {
    const t = await playing(withFiles(0), 'rtl');
    t.controller.setSubtitles({ feed: 'file', cues: [] });
    await t.press('SUBTITLES', 'DOWN', 'DOWN');
    await t.press('LEFT');
    expect(t.player.menu.size.value).toBe('l');
    await t.press('DOWN', 'LEFT');
    expect(t.player.menu.delay.value).toBe(DELAY_STEP_MS);
    await t.press('RIGHT', 'RIGHT');
    expect(t.player.menu.delay.value).toBe(-DELAY_STEP_MS);
  });

  it("leaves LEFT and RIGHT to the navigator outside the style rows, and keeps the size and timing for the player's run", async () => {
    const t = await playing(withFiles(0));
    t.controller.setSubtitles({ feed: 'file', cues: [] });
    await t.press('AUDIO', 'RIGHT');
    expect(t.at()).toBe('tracks · audio 0');
    await t.press('SUBTITLES', 'RIGHT');
    expect(t.at()).toBe('tracks · text 3');
    expect(t.player.menu.size.value).toBe(DEFAULT_SUBTITLE_SIZE);
    expect(t.player.menu.delay.value).toBe(0);
    expect(t.controller.delays).toEqual([]);
    await t.press('DOWN', 'DOWN', 'RIGHT', 'DOWN', 'RIGHT', 'BACK');
    expect(t.player.menu.screen.value).toBeNull();
    await t.press('SUBTITLES');
    expect(t.player.menu).toMatchObject({ size: { value: 'l' }, delay: { value: DELAY_STEP_MS } });
  });

  it("follows the controller's subtitles from the first play, and stops listening when disposed", async () => {
    const t = setup();
    expect(t.player.subtitles.value).toEqual({ feed: null, cues: [] });
    t.controller.subtitles = { feed: 'engine', cues: ['Before'] };
    t.player.show(1);
    expect(t.player.subtitles.value).toEqual({ feed: 'engine', cues: ['Before'] });
    t.controller.setSubtitles({ feed: 'engine', cues: ['Hello'] });
    expect(t.player.subtitles.value.cues).toEqual(['Hello']);
    expect(t.controller.subtitleListening).toBe(1);
    t.player.dispose();
    expect(t.controller.subtitleListening).toBe(0);
  });
});

describe('the player: the stream info (RELAY step 20c2a)', () => {
  it("turns on and off from the info bar's third button, stays through a zap, and goes with the player", async () => {
    const t = setup();
    t.player.show(2);
    t.controller.statsValue = { ...NO_STATS, width: 960, height: 540, decodedFrames: 0, container: 'ts', engine: 'html5', load: 1 };
    await t.press('RIGHT', 'RIGHT');
    expect(t.at()).toBe(`player · actions ${STATS_ACTION}`);
    expect(t.controller.statsReads).toBe(0);
    await t.press('OK');
    expect(t.player.streamInfo.shown.value).toBe(true);
    expect(t.player.streamInfo.info.value).toMatchObject({ width: 960, fps: null });
    // The bar stays, and the focus on the button.
    expect(t.player.info.value).toBe(true);
    expect(t.at()).toBe(`player · actions ${STATS_ACTION}`);
    // Measured by the player's clock.
    t.controller.statsValue = { ...t.controller.statsValue, decodedFrames: 25 };
    t.clock.advance(STATS_MS);
    expect(t.player.streamInfo.info.value).toMatchObject({ fps: 25 });
    // A zap: still on.
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.played()).toEqual([2, 3]);
    expect(t.player.streamInfo.shown.value).toBe(true);
    // OK again: off, and nothing is read any more.
    await t.press('OK');
    expect(t.player.streamInfo.shown.value).toBe(false);
    const reads = t.controller.statsReads;
    t.clock.advance(5 * STATS_MS);
    expect(t.controller.statsReads).toBe(reads);
    // On again, then Back: the player closes and the panel with it.
    await t.press('OK');
    expect(t.player.streamInfo.shown.value).toBe(true);
    await t.press('BACK');
    expect(t.player.open.value).toBe(false);
    expect(t.player.streamInfo.shown.value).toBe(false);
    expect(t.clock.pending()).toBe(0);
  });

  it('reads nothing before the first play made the controller', () => {
    const t = setup();
    t.player.streamInfo.toggle();
    expect(t.made()).toBe(0);
    expect(t.player.streamInfo.info.value).toBeNull();
    t.player.streamInfo.hide();
  });
});

describe('the player: the picture (RELAY step 20c2b)', () => {
  it("goes round the modes from the info bar's fourth button, for every channel, and tells the app each one", async () => {
    const t = setup();
    expect(t.player.picture.value).toBe('fit');
    t.player.show(2);
    // The controller gets the mode when it is made, before the first play.
    expect(t.controller.pictures).toEqual(['fit']);
    expect(t.controller.plays).toHaveLength(1);
    await t.press('RIGHT', 'RIGHT', 'RIGHT');
    expect(t.at()).toBe(`player · actions ${PICTURE_ACTION}`);
    await t.press('OK');
    expect([t.player.picture.value, t.controller.pictures.slice(1), t.pictured]).toEqual(['zoom', ['zoom'], ['zoom']]);
    // The bar stays, with the focus on the button; the stream isn't touched.
    expect(t.player.info.value).toBe(true);
    expect(t.at()).toBe(`player · actions ${PICTURE_ACTION}`);
    expect(t.controller.plays).toHaveLength(1);
    expect(t.controller.stops).toBe(0);
    await t.press('OK', 'OK', 'OK');
    expect(t.pictured).toEqual(['zoom', 'stretch', '4:3', 'fit']);
    // A zap keeps the mode (the engine does), and nothing is asked again.
    await t.press('OK', 'CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.played()).toEqual([2, 3]);
    expect(t.player.picture.value).toBe('zoom');
    expect(t.controller.pictures).toEqual(['fit', 'zoom', 'stretch', '4:3', 'fit', 'zoom']);
    // Closed and opened again: the same mode, still not asked again.
    await t.press('BACK');
    t.player.show(1);
    expect(t.player.picture.value).toBe('zoom');
    expect(t.controller.pictures).toHaveLength(6);
  });

  it("starts with the kept mode, or shows fit where the engine can't show it (keeping the kept one)", async () => {
    const kept = setup('ltr', { picture: '4:3' });
    expect(kept.player.picture.value).toBe('4:3');
    kept.player.show(1);
    expect(kept.controller.pictures).toEqual(['4:3']);
    expect(kept.player.picture.value).toBe('4:3');
    const t = setup('ltr', { picture: 'zoom' });
    t.controller.pictureModes = ['fit', 'stretch', '4:3'];
    t.player.show(1);
    expect(t.player.picture.value).toBe('fit');
    expect(t.pictured).toEqual([]);
    // AVPlay's round: fit, stretch, 4:3.
    await t.press('RIGHT', 'RIGHT', 'RIGHT', 'OK', 'OK', 'OK');
    expect(t.pictured).toEqual(['stretch', '4:3', 'fit']);
  });
});

describe('the player: what the app keeps (RELAY step 20c1)', () => {
  it('tells the app each channel whose stream opens, with its row, and shows its timing', async () => {
    const t = setup();
    t.controller.delayFor['x:s1:live:3'] = 750;
    t.player.show(2);
    expect(t.tuned).toEqual(['x:s1:live:2 @2']);
    expect(t.player.menu.delay.value).toBe(0);
    await t.press('CH_UP');
    // Not before the debounce: the bar moved, the stream not yet.
    expect(t.tuned).toEqual(['x:s1:live:2 @2']);
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.tuned).toEqual(['x:s1:live:2 @2', 'x:s1:live:3 @3']);
    expect(t.player.menu.delay.value).toBe(750);
    // Shown, not sent back.
    expect(t.controller.delays).toEqual([]);
    await t.press('PREV_CH');
    expect(t.tuned).toEqual(['x:s1:live:2 @2', 'x:s1:live:3 @3', 'x:s1:live:2 @2']);
    expect(t.player.menu.delay.value).toBe(0);
  });

  it("starts with the kept subtitle size and tells the app each change", async () => {
    const t = setup('ltr', { subtitleSize: 'l' });
    expect(t.player.menu.size.value).toBe('l');
    t.player.show(1);
    t.controller.setTracks(withFiles(0));
    t.controller.set('playing');
    t.controller.setSubtitles({ feed: 'file', cues: [] });
    await t.press('SUBTITLES', 'DOWN', 'DOWN');
    expect(t.at()).toBe('tracks · style 0');
    await t.press('RIGHT');
    expect(t.sized).toEqual([]);
    await t.press('LEFT', 'OK', 'OK');
    expect(t.player.menu.size.value).toBe('s');
    expect(t.sized).toEqual(['m', 'l', 's']);
  });
});

describe('the player: the start on the last channel (RELAY step 20c1)', () => {
  /** The profile's channel: row 12's, with the name and URL it had when it last played. */
  const KEPT: LiveRow = { item: { ...row(12).item, name: 'Kept 12', url: 'http://panel.test/live/u/p/912.ts' }, number: 13 };

  function resumed() {
    const t = setup();
    t.list.ready = false;
    t.player.resume(KEPT, 12);
    return t;
  }

  /** Answers every row read on its way (rows 10 and up aren't loaded). */
  async function answerReads(t: ReturnType<typeof setup>): Promise<void> {
    for (const read of t.list.loads.splice(0)) read.resolve();
    await flush();
  }

  it('plays the kept channel at once, before the list has it, and shows it at its row', async () => {
    performance.clearMarks('zoma:resume');
    const t = resumed();
    expect(t.at()).toBe('player · actions 0');
    expect(t.chrome).toEqual([true]);
    expect(t.player.info.value).toBe(true);
    expect(t.controller.plays).toEqual([liveRequest(KEPT)]);
    expect([t.player.target.value, t.player.playing.value, t.player.previous.value]).toEqual([12, 12, -1]);
    expect(t.player.row(12)).toBe(KEPT);
    expect(t.player.row(11)).toBeNull();
    // It was the last channel already.
    expect(t.tuned).toEqual([]);
    expect(t.list.locates.map((l) => [l.key, l.guess])).toEqual([['x:s1:live:12', 12]]);
    expect(performance.getEntriesByName('zoma:resume')).toHaveLength(1);
    // No rows to zap through yet.
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.plays).toHaveLength(1);
    expect(t.player.target.value).toBe(12);
    // A second resume or a show changes nothing while it shows.
    t.player.resume(row(3), 3);
    t.player.show(3);
    expect(t.controller.plays).toHaveLength(1);
  });

  it("moves to the row the list found it at, showing it until that row's chunk is in, then zaps from there", async () => {
    const t = resumed();
    t.list.ready = true;
    t.list.locates[0]!.answer(15);
    await flush();
    expect([t.player.target.value, t.player.playing.value]).toEqual([15, 15]);
    // Row 15's chunk is on its way: still the kept row, never an empty bar.
    expect(t.player.row(15)).toBe(KEPT);
    expect(t.player.row(12)).toBeNull();
    expect(t.tuned).toEqual([]);
    await answerReads(t);
    // (The fake list's row 15 stands for the channel it found there.)
    expect(t.player.row(15)).toEqual(row(15));
    expect(t.tuned).toEqual(['x:s1:live:15 @15']);
    expect(t.controller.plays).toHaveLength(1);
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    await answerReads(t);
    expect(t.controller.played()).toEqual([812, 16]);
    expect(t.player.previous.value).toBe(15);
    expect(t.tuned).toEqual(['x:s1:live:15 @15', 'x:s1:live:16 @16']);
    await t.press('PREV_CH');
    expect(t.controller.plays[2]).toEqual(liveRequest(row(15)));
  });

  it('found at its own row, a loaded one: the list takes over at once', async () => {
    const t = resumed();
    t.list.ready = true;
    t.list.loaded.add(12);
    t.list.locates[0]!.answer(12);
    await flush();
    expect(t.player.row(12)).toEqual(row(12));
    expect(t.tuned).toEqual(['x:s1:live:12 @12']);
  });

  it("not in the list: keeps showing it, zaps from its row, and Try again plays it again", async () => {
    const t = resumed();
    t.list.ready = true;
    t.list.locates[0]!.answer(-1);
    await flush();
    expect(t.player.row(12)).toBe(KEPT);
    t.controller.set('failed', NOT_FOUND);
    expect(t.at()).toBe('player · card 0');
    await t.press('OK');
    expect(t.controller.plays).toEqual([liveRequest(KEPT), liveRequest(KEPT)]);
    expect(t.tuned).toEqual([]);
    await t.press('CH_DOWN');
    t.clock.advance(ZAP_DELAY_MS);
    await answerReads(t);
    expect(t.controller.played()).toEqual([812, 812, 11]);
    // Back on row 12 now: the list's own channel.
    t.list.loaded.add(12);
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.plays[3]).toEqual(liveRequest(row(12)));
  });

  it('a zap before the list found it wins; so does a close', async () => {
    const t = resumed();
    t.list.ready = true;
    await t.press('CH_UP');
    // The bar moved on: a late answer moves nothing.
    t.list.locates[0]!.answer(15);
    await flush();
    expect(t.player.target.value).toBe(13);
    t.clock.advance(ZAP_DELAY_MS);
    await answerReads(t);
    expect(t.controller.played()).toEqual([812, 13]);
    expect(t.player.previous.value).toBe(12);
    expect(t.tuned).toEqual(['x:s1:live:13 @13']);
    // Row 12 is the list's own now.
    expect(t.player.row(12)).toBeNull();

    const c = resumed();
    await c.press('BACK');
    expect(c.closed).toEqual([12]);
    c.list.ready = true;
    c.list.locates[0]!.answer(15);
    await flush();
    expect([c.player.target.value, c.player.playing.value]).toEqual([12, 12]);
    expect(c.tuned).toEqual([]);
  });

  it("says nothing of a row found after another play or a close, and nothing when the search fails", async () => {
    const t = resumed();
    t.list.ready = true;
    t.list.locates[0]!.answer(15);
    await flush();
    // The chunk is still on its way when the user zaps.
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    // Row 15's read answers first, then row 16's.
    await answerReads(t);
    expect(t.list.loads).toEqual([]);
    expect(t.tuned).toEqual(['x:s1:live:16 @16']);
    const f = resumed();
    f.list.locates[0]!.fail();
    await flush();
    expect([f.player.target.value, f.player.row(12)]).toEqual([12, KEPT]);
  });

  it('marks the kept channel\'s first frame once, and no other', async () => {
    performance.clearMarks('zoma:resume-frame');
    const t = resumed();
    t.controller.set('opening');
    expect(performance.getEntriesByName('zoma:resume-frame')).toHaveLength(0);
    t.controller.set('playing');
    t.controller.set('buffering');
    t.controller.set('playing');
    expect(performance.getEntriesByName('zoma:resume-frame')).toHaveLength(1);
    const s = setup();
    s.player.show(2);
    s.controller.set('playing');
    // A zap or a close before its frame: no mark.
    const z = resumed();
    z.list.ready = true;
    z.list.loaded.add(13);
    await z.press('CH_UP');
    z.clock.advance(ZAP_DELAY_MS);
    expect(z.controller.played()).toEqual([812, 13]);
    z.controller.set('playing');
    const c = resumed();
    c.player.close();
    c.controller.set('playing');
    expect(performance.getEntriesByName('zoma:resume-frame')).toHaveLength(1);
  });

  it('moves nothing when the channel played again is the list\'s own row', async () => {
    const t = resumed();
    t.list.ready = true;
    t.list.loaded.add(12);
    t.list.loaded.add(13);
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    await t.press('CH_DOWN');
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.plays.slice(1)).toEqual([liveRequest(row(13)), liveRequest(row(12))]);
    t.list.locates[0]!.answer(15);
    await flush();
    expect([t.player.target.value, t.player.playing.value]).toEqual([12, 12]);
    expect(t.player.row(12)).toEqual(row(12));
  });

  it("keeps showing the kept channel when its found row can't be read, and says nothing", async () => {
    const t = resumed();
    t.list.ready = true;
    // (The fake's reads of rows past its end answer nothing, as a failed chunk read does.)
    t.list.locates[0]!.answer(25);
    await flush();
    await answerReads(t);
    expect([t.player.target.value, t.player.row(25)]).toEqual([25, KEPT]);
    expect(t.tuned).toEqual([]);
  });
});

describe('the player: a catalog refresh while it plays (RELAY step 22a)', () => {
  /** Row 1 played, then row 2 (row 1 is PRE-CH's). */
  async function zapped() {
    const t = setup();
    t.player.show(1);
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    expect(t.controller.played()).toEqual([1, 2]);
    expect([t.player.playing.value, t.player.previous.value]).toEqual([2, 1]);
    t.tuned.length = 0;
    return t;
  }

  /** The list is replaced: no row is known until it is read again. */
  function replaced(t: ReturnType<typeof setup>): void {
    t.list.loaded.clear();
  }

  it("keeps the stream and its row on show, then moves it and PRE-CH's channel to their rows in the new list", async () => {
    const t = await zapped();
    t.player.listChanging();
    replaced(t);
    expect(t.list.locates.map((l) => [l.key, l.guess])).toEqual([
      ['x:s1:live:2', 2],
      ['x:s1:live:1', 1],
    ]);
    // Until the new list answers, the bar keeps the channel playing.
    expect(t.player.row(2)).toEqual(row(2));
    t.list.locates[0]!.answer(7);
    t.list.locates[1]!.answer(5);
    await flush();
    expect([t.player.target.value, t.player.playing.value, t.player.previous.value]).toEqual([7, 7, 5]);
    expect(t.player.row(7)).toEqual(row(2));
    for (const read of t.list.loads.splice(0)) read.resolve();
    await flush();
    // (The fake list's row 7 stands for the channel it found there.)
    expect(t.player.row(7)).toEqual(row(7));
    expect(t.tuned).toEqual(['x:s1:live:7 @7']);
    // Never played again, never stopped.
    expect(t.controller.played()).toEqual([1, 2]);
    expect(t.controller.stops).toBe(0);
    await t.press('PREV_CH');
    for (const read of t.list.loads.splice(0)) read.resolve();
    await flush();
    expect(t.controller.played()).toEqual([1, 2, 5]);
  });

  it("keeps a channel gone from the new list on show at its row; PRE-CH's goes", async () => {
    const t = await zapped();
    t.player.listChanging();
    replaced(t);
    t.list.locates[0]!.answer(-1);
    t.list.locates[1]!.answer(-1);
    await flush();
    expect([t.player.target.value, t.player.playing.value, t.player.previous.value]).toEqual([2, 2, -1]);
    expect(t.player.row(2)).toEqual(row(2));
    await t.press('PREV_CH');
    expect(t.controller.played()).toEqual([1, 2]);
  });

  it('a zap or PRE-CH before the new list answers wins', async () => {
    const t = await zapped();
    t.player.listChanging();
    await t.press('PREV_CH');
    expect(t.controller.played()).toEqual([1, 2, 1]);
    expect(t.player.previous.value).toBe(2);
    t.list.locates[0]!.answer(9);
    t.list.locates[1]!.answer(8);
    await flush();
    expect([t.player.target.value, t.player.playing.value, t.player.previous.value]).toEqual([1, 1, 2]);
    expect(t.tuned).toEqual(['x:s1:live:1 @1']);
  });

  it("leaves PRE-CH's channel as it is when its row isn't known", async () => {
    const t = await zapped();
    t.list.loaded.delete(1);
    t.player.listChanging();
    expect(t.list.locates.map((l) => l.key)).toEqual(['x:s1:live:2']);
    expect(t.player.previous.value).toBe(1);
  });

  it('a search that fails changes nothing', async () => {
    const t = await zapped();
    t.player.listChanging();
    t.list.locates[0]!.fail();
    t.list.locates[1]!.fail();
    await flush();
    expect([t.player.target.value, t.player.playing.value, t.player.previous.value]).toEqual([2, 2, 1]);
  });

  it('asks nothing while closed, and nothing for PRE-CH before a second channel', async () => {
    const t = setup();
    t.player.listChanging();
    expect(t.list.locates).toEqual([]);
    t.player.show(3);
    t.player.listChanging();
    expect(t.list.locates.map((l) => [l.key, l.guess])).toEqual([['x:s1:live:3', 3]]);
    t.player.close();
    t.player.listChanging();
    expect(t.list.locates).toHaveLength(1);
  });

  it("pins nothing before a stream opened: a waiting zap plays the new list's row, and the app hears of it", async () => {
    const t = setup();
    t.list.loaded.delete(4);
    t.player.show(4);
    // Row 4's chunk is on its way: nothing plays yet.
    expect(t.controller.plays).toEqual([]);
    await t.press('CH_UP');
    t.player.listChanging();
    expect(t.list.locates).toEqual([]);
    t.clock.advance(ZAP_DELAY_MS);
    await flush();
    expect(t.controller.played()).toEqual([5]);
    expect(t.tuned).toEqual(['x:s1:live:5 @5']);
  });
});

describe('the player: catch-up (RELAY step 25a)', () => {
  const EVENING: ArchiveProgramme = { start: 29_000_000, end: 29_000_060, title: 'Evening News' };
  /** The app's request: a timeshift URL named by the row and the programme's start (`null` for row 9). */
  const archiveOf = (r: LiveRow, p: ArchiveProgramme): PlayRequest | null =>
    r.number === 10 ? null : { key: r.item.key, src: r.item.src, mode: 'catchup', candidates: [{ url: `http://panel.test/timeshift/u/p/60/${p.start}/${r.number + 99}.ts`, container: 'ts' }] };
  const asked: string[] = [];
  const catchupRequest = (r: LiveRow, p: ArchiveProgramme): PlayRequest | null => {
    asked.push(`${r.item.key} ${p.start}`);
    return archiveOf(r, p);
  };

  it("opens on a row and plays the programme from its archive: the info bar shows it, the last channel isn't changed", () => {
    asked.length = 0;
    const t = setup('ltr', { catchupRequest });
    t.player.catchup(4, EVENING);
    // Step 25d: on the seek bar.
    expect(t.at()).toBe('player · seek 0');
    expect(t.chrome).toEqual([true]);
    expect(asked).toEqual([`x:s1:live:4 ${EVENING.start}`]);
    expect(t.controller.plays).toEqual([archiveOf(row(4), EVENING)]);
    expect(t.player.archive.value).toEqual(EVENING);
    expect(t.player).toMatchObject({ target: { value: 4 }, playing: { value: 4 }, plays: { value: 1 }, info: { value: true } });
    expect(t.tuned).toEqual([]);
    // A second open while it shows does nothing.
    t.player.catchup(5, EVENING);
    t.player.show(5);
    expect(t.controller.plays).toHaveLength(1);
  });

  it('plays the channel live when its URL carries no catch-up, or the app has no catch-up', () => {
    const t = setup('ltr', { catchupRequest });
    t.player.catchup(9, EVENING);
    expect(t.controller.plays).toEqual([liveRequest(row(9))]);
    expect(t.player.archive.value).toBeNull();
    expect(t.tuned).toEqual(['x:s1:live:9 @9']);
    const bare = setup();
    bare.player.catchup(2, EVENING);
    expect(bare.controller.plays).toEqual([liveRequest(row(2))]);
    expect(bare.player.archive.value).toBeNull();
  });

  it("reads the row's chunk first when the list hasn't it yet", async () => {
    const t = setup('ltr', { catchupRequest });
    t.player.catchup(12, EVENING);
    expect(t.controller.plays).toEqual([]);
    t.list.loads[0]!.resolve();
    await flush();
    expect(t.controller.plays).toEqual([archiveOf(row(12), EVENING)]);
    expect(t.player.archive.value).toEqual(EVENING);
  });

  it('leaves the archive for the live channels on a zap, a number or the previous channel', async () => {
    const t = setup('ltr', { catchupRequest });
    t.player.show(2);
    t.player.close();
    t.player.catchup(4, EVENING);
    // The channel watched before (it stays across a close).
    expect(t.player.previous.value).toBe(2);
    // A zap: the archive's programme stays until the new channel's stream opens.
    await t.press('CH_UP');
    expect(t.player.archive.value).toEqual(EVENING);
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.plays[2]).toEqual(liveRequest(row(5)));
    expect(t.player.archive.value).toBeNull();
    expect(t.player.previous.value).toBe(4);
    // The previous channel is row 4, live.
    await t.press('PREV_CH');
    expect(t.controller.plays[3]).toEqual(liveRequest(row(4)));
    expect(t.player.archive.value).toBeNull();
    t.player.close();
    // A number.
    t.player.catchup(4, EVENING);
    await t.press('DIGIT_7');
    t.clock.advance(DIGITS_MS);
    await flush();
    t.list.finds[0]!.answer(6);
    await flush();
    expect(t.controller.plays[5]).toEqual(liveRequest(row(6)));
    expect(t.player.archive.value).toBeNull();
  });

  it('plays the programme again from "Try again", and closes on Back without it', async () => {
    asked.length = 0;
    const t = setup('ltr', { catchupRequest });
    t.player.catchup(4, EVENING);
    t.controller.set('failed', NOT_FOUND);
    expect(t.at()).toBe('player · card 0');
    await t.press('OK');
    expect(t.controller.plays).toEqual([archiveOf(row(4), EVENING), archiveOf(row(4), EVENING)]);
    expect(asked).toHaveLength(2);
    expect(t.player.archive.value).toEqual(EVENING);
    expect(t.player.previous.value).toBe(-1);
    await t.press('BACK');
    expect(t.closed).toEqual([4]);
    expect(t.controller.stops).toBe(1);
    expect(t.player.archive.value).toBeNull();
    // Opened live afterwards, nothing of the archive is left.
    t.player.show(4);
    expect(t.controller.plays[2]).toEqual(liveRequest(row(4)));
    expect(t.player.archive.value).toBeNull();
  });
});

describe("the player: catch-up's position, pause, seeking and end (RELAY step 25d)", () => {
  const MIN = 60_000;
  const EVENING: ArchiveProgramme = { start: 29_000_000, end: 29_000_060, title: 'Evening News' };
  const START = EVENING.start * MIN;
  /** Two days after the evening: every seek stays in the archive. */
  const LATER = (EVENING.end + 2 * 1440) * MIN;
  /** The app's request: a timeshift URL naming its start (epoch ms) and the row. */
  const archiveOf = (r: LiveRow, p: ArchiveProgramme, from?: number): PlayRequest => ({
    key: r.item.key,
    src: r.item.src,
    mode: 'catchup',
    candidates: [{ url: `http://panel.test/timeshift/${from ?? p.start * MIN}/${r.number}.ts`, container: 'ts' }],
  });
  /** Each play's start: a catch-up's (epoch ms), or `live`. */
  const starts = (t: ReturnType<typeof setup>): (number | string)[] => t.controller.plays.map((p) => (p.mode === 'catchup' ? Number(p.candidates[0]!.url.split('/')[4]) : 'live'));
  /** Opens row 4's evening and shows its picture at `media` ms. */
  const opened = (options: Parameters<typeof setup>[1] = {}, programme = EVENING, media = 90_000, dir: 'ltr' | 'rtl' = 'ltr') => {
    const t = setup(dir, { catchupRequest: archiveOf, wallAt: LATER, ...options });
    t.player.catchup(4, programme);
    t.controller.media = media;
    t.controller.set('playing');
    return t;
  };

  it('opens on the seek bar, reads the position every second, and moves between the bar and the buttons with UP and DOWN', async () => {
    const t = setup('ltr', { catchupRequest: archiveOf, wallAt: LATER });
    t.player.catchup(4, EVENING);
    expect(t.at()).toBe('player · seek 0');
    // Until the picture shows, the position is the stream's start.
    expect(t.player.position.value).toEqual({ time: START, seeking: false, live: false });
    t.controller.media = 90_000;
    t.controller.set('playing');
    t.clock.advance(POSITION_MS);
    expect(t.player.position.value).toEqual({ time: START + 90_000, seeking: false, live: false });
    // UP and DOWN: the bar and its buttons, no zap; CH+ still zaps.
    await t.press('DOWN');
    expect(t.at()).toBe('player · actions 0');
    await t.press('DOWN');
    expect(t.at()).toBe('player · actions 0');
    await t.press('UP');
    expect(t.at()).toBe('player · seek 0');
    await t.press('UP');
    expect(t.at()).toBe('player · seek 0');
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.plays).toHaveLength(1);
    // LEFT and RIGHT on the buttons move between them.
    await t.press('DOWN', 'RIGHT');
    expect(t.at()).toBe('player · actions 1');
    // The bar hides: the keys are the seek bar's again.
    t.clock.advance(INFO_MS);
    expect(t.player.info.value).toBe(false);
    expect(t.at()).toBe('player · seek 0');
    // Hidden, UP or DOWN only shows the bar.
    await t.press('DOWN');
    expect(t.player.info.value).toBe(true);
    expect(t.at()).toBe('player · seek 0');
    await t.press('CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    expect(starts(t)).toEqual([START, 'live']);
    expect(t.player.position.value).toBeNull();
    expect(t.at()).toBe('player · actions 0');
    expect(t.player.screen.value!.zone('seek')).toMatchObject({ count: 0 });
    // Live, the bar hides with the focus on its buttons, and no position is read.
    t.controller.set('playing');
    t.clock.advance(INFO_MS);
    expect(t.player.info.value).toBe(false);
    expect(t.at()).toBe('player · actions 0');
    expect(t.clock.pending()).toBe(0);
  });

  it('takes the focus to the seek bar on FF from the buttons, and pauses on a pointer click on the bar', async () => {
    const t = opened();
    await t.press('DOWN', 'FF');
    expect(t.at()).toBe('player · seek 0');
    expect(t.player.position.value).toEqual({ time: START + 90_000 + 5 * MIN, seeking: true, live: false });
    t.player.screen.value!.click('seek', 0);
    expect(t.controller.pauses).toEqual(['pause']);
  });

  it('pauses and plays on: OK on the seek bar or with the bar hidden, and PLAY/PAUSE; the bar stays while paused', async () => {
    const t = opened();
    await t.press('OK');
    expect(t.controller.pauses).toEqual(['pause']);
    expect(t.controller.status.state).toBe('paused');
    // Paused, the bar stays up.
    t.clock.advance(3 * INFO_MS);
    expect(t.player.info.value).toBe(true);
    await t.press('PLAY_PAUSE');
    expect(t.controller.pauses).toEqual(['pause', 'resume']);
    t.clock.advance(INFO_MS);
    expect(t.player.info.value).toBe(false);
    // Hidden: OK pauses and shows the bar.
    await t.press('OK');
    expect(t.controller.pauses).toEqual(['pause', 'resume', 'pause']);
    expect(t.player.info.value).toBe(true);
    // On a button, OK presses it ("Stream info").
    await t.press('PLAY_PAUSE', 'DOWN', 'RIGHT', 'RIGHT', 'OK');
    expect(t.controller.pauses).toHaveLength(4);
    expect(t.player.streamInfo.shown.value).toBe(true);
    // Buffering pauses too.
    t.controller.set('buffering');
    await t.press('PLAY_PAUSE');
    expect(t.controller.status.state).toBe('paused');
    // Before the picture, nothing to pause.
    const early = setup('ltr', { catchupRequest: archiveOf, wallAt: LATER });
    early.player.catchup(4, EVENING);
    await early.press('OK');
    expect(early.controller.pauses).toEqual([]);
  });

  it('seeks a stream that cannot seek inside by a new URL from the target cut to the minute, once the keys rest', async () => {
    const t = opened();
    await t.press('RIGHT', 'RIGHT', 'RIGHT');
    // The bar shows the target while it waits; the stream is untouched.
    expect(t.player.position.value).toEqual({ time: START + 90_000 + 3 * MIN, seeking: true, live: false });
    expect(t.player.info.value).toBe(true);
    t.clock.advance(SEEK_DELAY_MS - 1);
    expect(t.controller.plays).toHaveLength(1);
    t.clock.advance(1);
    // 4:30 in: the new URL starts at 5:00, and the position is there until the picture shows.
    expect(starts(t)).toEqual([START, START + 5 * MIN]);
    expect(t.controller.seeks).toEqual([]);
    expect(t.player.position.value).toEqual({ time: START + 5 * MIN, seeking: false, live: false });
    expect(t.player.archive.value).toEqual(EVENING);
    expect(t.at()).toBe('player · seek 0');
    // The new stream's media time counts from its own start.
    t.controller.media = 30_000;
    t.controller.set('playing');
    t.clock.advance(POSITION_MS);
    expect(t.player.position.value!.time).toBe(START + 5 * MIN + 30_000);
    // Back past the programme's start stops there.
    for (let i = 0; i < 7; i += 1) await t.press('LEFT');
    expect(t.player.position.value!.time).toBe(START);
    t.clock.advance(SEEK_DELAY_MS);
    expect(starts(t)).toEqual([START, START + 5 * MIN, START]);
  });

  it('moves further while a key is held, FF and RW further still, and stops at the last minute', async () => {
    const t = opened();
    // Ten RIGHTs 100 ms apart: eight minutes, then five minutes each.
    for (let i = 0; i < 10; i += 1) {
      await t.press('RIGHT');
      t.clock.advance(100);
    }
    expect(t.player.position.value!.time).toBe(START + 90_000 + 8 * MIN + 2 * 5 * MIN);
    // A pause longer than a held key's starts a new run: one minute again.
    t.clock.advance(250);
    await t.press('RIGHT');
    expect(t.player.position.value!.time).toBe(START + 90_000 + 19 * MIN);
    // A turn back starts a new run: one minute, even straight after a held RIGHT (eight minutes, then five).
    t.clock.advance(400);
    for (let i = 0; i < 9; i += 1) await t.press('RIGHT');
    await t.press('LEFT');
    expect(t.player.position.value!.time).toBe(START + 90_000 + 31 * MIN);
    // So does another key: RW straight after a held LEFT moves five minutes, not ten.
    for (let i = 0; i < 8; i += 1) await t.press('LEFT');
    expect(t.player.position.value!.time).toBe(START + 90_000 + 19 * MIN);
    await t.press('RW');
    expect(t.player.position.value!.time).toBe(START + 90_000 + 14 * MIN);
    // FF held: five minutes, then ten, to the programme's last minute at most.
    for (let i = 0; i < 12; i += 1) await t.press('FF');
    expect(t.player.position.value!.time).toBe(START + 59 * MIN);
    t.clock.advance(SEEK_DELAY_MS);
    expect(starts(t)).toEqual([START, START + 59 * MIN]);
  });

  it('seeks inside an HLS archive on show, playing or paused, and by URL where the engine refuses or the target is before its start', async () => {
    const t = opened();
    t.controller.container = 'hls';
    t.controller.set('playing');
    await t.press('RIGHT');
    t.clock.advance(SEEK_DELAY_MS);
    await flush();
    expect(t.controller.seeks).toEqual([90_000 + MIN]);
    expect(t.controller.plays).toHaveLength(1);
    expect(t.player.position.value).toEqual({ time: START + 90_000 + MIN, seeking: false, live: false });
    // Paused: the seek keeps it paused.
    await t.press('OK', 'LEFT', 'LEFT');
    t.clock.advance(SEEK_DELAY_MS);
    await flush();
    expect(t.controller.seeks).toEqual([150_000, 30_000]);
    expect(t.controller.status.state).toBe('paused');
    // The engine refuses: the URL from the target, to the minute.
    t.controller.seekOk = false;
    await t.press('FF');
    t.clock.advance(SEEK_DELAY_MS);
    await flush();
    expect(t.controller.seeks).toEqual([150_000, 30_000, 330_000]);
    expect(starts(t)).toEqual([START, START + 6 * MIN]);
    // An HLS stream from 6:00: back to 1:00 is before its start, so a URL.
    t.controller.seekOk = true;
    t.controller.media = 0;
    t.controller.set('playing');
    await t.press('RW');
    t.clock.advance(SEEK_DELAY_MS);
    await flush();
    expect(t.controller.seeks).toHaveLength(3);
    expect(starts(t)).toEqual([START, START + 6 * MIN, START + MIN]);
    // Before the picture, a URL too.
    await t.press('RIGHT');
    t.clock.advance(SEEK_DELAY_MS);
    expect(starts(t)).toEqual([START, START + 6 * MIN, START + MIN, START + 2 * MIN]);
  });

  it('goes live when a seek passes now, and comes back from "Live" with a step back', async () => {
    // A programme on air, reached from 25 minutes in: now is 5 minutes ahead.
    const wallMin = 29_500_000;
    const onAir: ArchiveProgramme = { start: wallMin - 30, end: wallMin + 30, title: 'On Air' };
    const t = opened({ wallAt: wallMin * MIN }, onAir, 25 * MIN);
    await t.press('FF');
    expect(t.player.position.value).toEqual({ time: wallMin * MIN, seeking: true, live: true });
    // A close drops it: opened again, the position is the stream's start, not "Live".
    t.player.close();
    t.player.catchup(4, onAir);
    t.controller.set('playing');
    expect(t.player.position.value).toEqual({ time: onAir.start * MIN, seeking: false, live: false });
    await t.press('FF');
    // A step back leaves "Live": a minute before now.
    await t.press('LEFT');
    expect(t.player.position.value).toEqual({ time: (wallMin - 1) * MIN, seeking: true, live: false });
    await t.press('RIGHT', 'RIGHT');
    expect(t.player.position.value!.live).toBe(true);
    t.clock.advance(SEEK_DELAY_MS);
    expect(starts(t)).toEqual([onAir.start * MIN, onAir.start * MIN, 'live']);
    expect(t.controller.plays[2]).toEqual(liveRequest(row(4)));
    expect(t.player.archive.value).toBeNull();
    expect(t.player.position.value).toBeNull();
    expect(t.tuned).toEqual(['x:s1:live:4 @4']);
    expect(t.at()).toBe('player · actions 0');
    // Live, the catch-up's keys do nothing.
    t.controller.set('playing');
    await t.press('FF', 'PLAY_PAUSE');
    t.clock.advance(SEEK_DELAY_MS);
    expect(t.controller.plays).toHaveLength(3);
    expect(t.controller.pauses).toEqual([]);
  });

  it('runs the timeline left to right in Arabic too: RIGHT goes forward', async () => {
    const t = opened({}, EVENING, 90_000, 'rtl');
    await t.press('RIGHT');
    expect(t.player.position.value!.time).toBe(START + 90_000 + MIN);
  });

  it('plays on past the programme: the info bar moves on to the programme aired then, asked once per end', async () => {
    const asked: number[] = [];
    const answers: ((p: ArchiveProgramme | null) => void)[] = [];
    const programmeAt = (r: LiveRow, at: number): Promise<ArchiveProgramme | null> => {
      asked.push(at);
      expect(r.item.key).toBe('x:s1:live:4');
      return new Promise((resolve) => answers.push(resolve));
    };
    const t = opened({ programmeAt }, EVENING, 59 * MIN);
    t.clock.advance(POSITION_MS);
    expect(asked).toEqual([]);
    // At the end and just past it, a stream that ends may still send `ended`.
    t.controller.media = 60 * MIN + PLAY_ON_MS - 1000;
    t.clock.advance(POSITION_MS);
    expect(asked).toEqual([]);
    t.controller.media = 60 * MIN + PLAY_ON_MS;
    t.clock.advance(POSITION_MS);
    t.clock.advance(POSITION_MS);
    expect(asked).toEqual([START + 60 * MIN + PLAY_ON_MS]);
    const next: ArchiveProgramme = { start: EVENING.end, end: EVENING.end + 30, title: 'Late Show' };
    answers[0]!(next);
    await flush();
    expect(t.player.archive.value).toEqual(next);
    // Its own end later asks again; an answer that isn't later keeps the programme, and isn't asked again.
    t.controller.media = 90 * MIN + PLAY_ON_MS;
    t.clock.advance(POSITION_MS);
    answers[1]!(EVENING);
    await flush();
    t.clock.advance(3 * POSITION_MS);
    expect(asked).toHaveLength(2);
    expect(t.player.archive.value).toEqual(next);
    // Seeks within the new programme stop at its start.
    for (let i = 0; i < 40; i += 1) await t.press('LEFT');
    expect(t.player.position.value!.time).toBe(next.start * MIN);
  });

  it("doesn't move on past the programme while a seek waits", async () => {
    const asked: number[] = [];
    const programmeAt = (_r: LiveRow, at: number): Promise<ArchiveProgramme | null> => {
      asked.push(at);
      return Promise.resolve(null);
    };
    // Past the end; the first reading comes at 1 s, while a LEFT pressed at 0.5 s waits.
    const t = opened({ programmeAt }, EVENING, 60 * MIN + PLAY_ON_MS);
    t.clock.advance(500);
    await t.press('LEFT');
    t.clock.advance(500);
    expect(asked).toEqual([]);
    t.clock.advance(100);
    expect(starts(t)).toEqual([START, START + 59 * MIN]);
    expect(asked).toEqual([]);
  });

  it('shows the end card when the stream ends: "Watch live" plays the channel live, "Back to the guide" closes', async () => {
    const t = opened();
    await t.press('RIGHT');
    t.controller.set('ended');
    // The card takes over: no seek waits.
    expect(t.at()).toBe('player · card 0');
    expect(t.player.info.value).toBe(true);
    t.clock.advance(SEEK_DELAY_MS + INFO_MS);
    expect(t.controller.plays).toHaveLength(1);
    expect(t.player.info.value).toBe(true);
    // The catch-up's keys are the card's: FF seeks nothing.
    await t.press('FF');
    t.clock.advance(SEEK_DELAY_MS);
    expect(t.controller.plays).toHaveLength(1);
    await t.press('OK');
    expect(starts(t)).toEqual([START, 'live']);
    expect(t.player.archive.value).toBeNull();
    t.player.close();
    t.player.catchup(4, EVENING);
    t.controller.set('ended');
    await t.press('RIGHT');
    expect(t.at()).toBe('player · card 1');
    await t.press('OK');
    expect(t.closed).toEqual([4, 4]);
    expect(t.player.open.value).toBe(false);
    // Live, an end shows no card (the controller calls a live end a failure).
    t.player.show(2);
    t.controller.set('ended');
    expect(t.at()).toBe('player · actions 0');
  });

  it('drops a waiting seek on a zap, a number, the previous channel or a close', async () => {
    const t = opened();
    // Zapping for longer than the seek's delay: the zap plays, the seek never does.
    await t.press('RIGHT', 'CH_DOWN');
    t.clock.advance(300);
    await t.press('CH_DOWN');
    t.clock.advance(300);
    await t.press('CH_DOWN');
    t.clock.advance(ZAP_DELAY_MS + SEEK_DELAY_MS);
    expect(starts(t)).toEqual([START, 'live']);
    expect(t.player.playing.value).toBe(1);
    t.player.close();
    t.player.catchup(4, EVENING);
    await t.press('RIGHT', 'DIGIT_3');
    t.clock.advance(SEEK_DELAY_MS);
    expect(t.controller.plays).toHaveLength(3);
    await t.press('BACK', 'RIGHT', 'PREV_CH');
    t.clock.advance(SEEK_DELAY_MS);
    expect(starts(t)).toEqual([START, 'live', START, 'live']);
    t.player.close();
    t.player.catchup(4, EVENING);
    await t.press('RIGHT');
    t.player.close();
    expect(t.clock.pending()).toBe(0);
    expect(t.controller.plays).toHaveLength(5);
    expect(t.player.position.value).toBeNull();
    // A zap to a row still being read: the seek doesn't come first and drop it.
    t.player.catchup(9, EVENING);
    t.controller.set('playing');
    await t.press('RIGHT', 'CH_UP');
    t.clock.advance(ZAP_DELAY_MS + SEEK_DELAY_MS);
    expect(t.controller.plays).toHaveLength(6);
    t.list.loads[0]!.resolve();
    await flush();
    expect(starts(t)).toEqual([START, 'live', START, 'live', START, START, 'live']);
  });
});

describe('the player: a movie (RELAY step 26c)', () => {
  const MIN = 60_000;
  const film: CatalogItem = { ...row(0).item, key: 'x:s1:movie:201', kind: 'movie', name: 'Sintel', url: 'http://panel.test/movie/u/p/201.mkv' };
  const request: PlayRequest = { key: film.key, src: 's1', mode: 'vod', candidates: [{ url: film.url, container: 'mkv' }] };
  /** Opens the movie from its details (`closed` counts the returns to them). */
  const watch = (lengthMs: number | null = 90 * MIN, dir: 'ltr' | 'rtl' = 'ltr') => {
    const t = setup(dir);
    const back: string[] = [];
    const play: MoviePlay = { item: film, request, lengthMs, closed: () => back.push('details') };
    t.player.playMovie(play);
    return { ...t, back, play };
  };
  /** Its picture at `media` ms. */
  const showing = (t: ReturnType<typeof watch>, media = 600_000): void => {
    t.controller.media = media;
    t.controller.set('playing');
  };

  it('opens on the seek bar and plays the request from the start; its buttons have no "Previous channel"', () => {
    const t = watch();
    expect(t.at()).toBe('player · seek 0');
    expect(t.nav.snapshot().depth).toBe(2);
    expect(t.chrome).toEqual([true]);
    expect(t.controller.plays).toEqual([request]);
    expect(t.controller.options).toEqual([{}]);
    expect(t.player.movie.value).toEqual({ item: film, lengthMs: 90 * MIN });
    expect(t.player.actions.value).toEqual(MOVIE_ACTIONS);
    expect(t.player.screen.value!.zone('actions')).toMatchObject({ count: 3 });
    expect(t.player).toMatchObject({ plays: { value: 1 }, info: { value: true }, archive: { value: null } });
    expect(t.player.position.value).toEqual({ time: 0, seeking: false, live: false });
    // No channel: the live list isn't read, and the last channel isn't changed.
    expect(t.list.asked).toEqual([]);
    expect(t.tuned).toEqual([]);
    // Open, a second movie or a channel opens nothing.
    t.player.playMovie({ item: film, request, lengthMs: null, closed: () => undefined });
    t.player.show(2);
    expect(t.controller.plays).toHaveLength(1);
  });

  it("reads the position every second, and takes the engine's length once it knows one", () => {
    const t = watch(null);
    expect(t.player.movie.value!.lengthMs).toBeNull();
    showing(t, 5000);
    t.clock.advance(POSITION_MS);
    expect(t.player.position.value).toEqual({ time: 5000, seeking: false, live: false });
    expect(t.player.movie.value!.lengthMs).toBeNull();
    t.controller.duration = 52 * MIN;
    t.controller.media = 6000;
    t.clock.advance(POSITION_MS);
    expect(t.player.position.value!.time).toBe(6000);
    expect(t.player.movie.value).toEqual({ item: film, lengthMs: 52 * MIN });
    // The engine's length wins over the panel's.
    const u = watch(90 * MIN);
    u.controller.duration = 89 * MIN;
    showing(u);
    u.clock.advance(POSITION_MS);
    expect(u.player.movie.value!.lengthMs).toBe(89 * MIN);
  });

  it('does nothing on CH±, the digits and PRE-CH; UP and DOWN move between the bar and the buttons', async () => {
    const t = watch();
    showing(t);
    await t.press('CH_UP', 'CH_DOWN', 'PREV_CH', 'DIGIT_5', 'DIGIT_7');
    t.clock.advance(DIGITS_MS + ZAP_DELAY_MS);
    expect(t.controller.plays).toHaveLength(1);
    expect(t.player.entry.value).toBeNull();
    expect(t.player.target.value).toBe(0);
    expect(t.list.finds).toEqual([]);
    expect(t.at()).toBe('player · seek 0');
    await t.press('DOWN');
    expect(t.at()).toBe('player · actions 0');
    await t.press('UP');
    expect(t.at()).toBe('player · seek 0');
    // With a card up the zapping keys still zap nothing.
    t.controller.set('failed', NOT_FOUND);
    await t.press('UP', 'DOWN', 'CH_UP');
    t.clock.advance(ZAP_DELAY_MS);
    expect(t.controller.plays).toHaveLength(1);

    // A channel watched before the movie: PRE-CH still doesn't leave the movie for it.
    const u = setup();
    u.player.show(2);
    await u.press('CH_UP');
    u.clock.advance(ZAP_DELAY_MS);
    await u.press('BACK');
    expect(u.player.previous.value).toBe(2);
    u.player.playMovie({ item: film, request, lengthMs: null, closed: () => undefined });
    await u.press('PREV_CH');
    expect(u.controller.plays.map((p) => p.mode)).toEqual(['live', 'live', 'vod']);
  });

  it("starts at its own start after a catch-up, and keeps the movie's subtitle timing", () => {
    const t = setup('ltr', {
      catchupRequest: (r, p) => ({ key: r.item.key, src: r.item.src, mode: 'catchup', candidates: [{ url: `http://panel.test/timeshift/${p.start}/${r.number}.ts`, container: 'ts' }] }),
      wallAt: 30_000_000 * MIN,
    });
    t.player.catchup(4, { start: 29_000_000, end: 29_000_060, title: 'Evening News' });
    t.player.close();
    t.controller.delayFor[film.key] = 500;
    t.player.playMovie({ item: film, request, lengthMs: null, closed: () => undefined });
    expect(t.player.position.value).toEqual({ time: 0, seeking: false, live: false });
    expect(t.player.menu.delay.value).toBe(500);
    // Its picture: the media time, not the programme's.
    t.controller.media = 5000;
    t.controller.set('playing');
    t.clock.advance(POSITION_MS);
    expect(t.player.position.value).toEqual({ time: 5000, seeking: false, live: false });
  });

  it("plays from the newest seek's target when the engine refuses: an older refusal, or one after a new play, is dropped", async () => {
    const t = watch();
    showing(t, 600_000);
    const answers: ((ok: boolean) => void)[] = [];
    t.controller.seek = (ms) => {
      t.controller.seeks.push(ms);
      return new Promise((resolve) => answers.push(resolve));
    };
    await t.press('RIGHT');
    t.clock.advance(SEEK_DELAY_MS);
    await t.press('RIGHT', 'RIGHT');
    t.clock.advance(SEEK_DELAY_MS);
    // (The engine is still at 10:00 while the first seek is out.)
    expect(t.controller.seeks).toEqual([610_000, 620_000]);
    answers[0]!(false);
    await flush();
    expect(t.controller.plays).toHaveLength(1);
    answers[1]!(false);
    await flush();
    expect(t.controller.options).toEqual([{}, { startMs: 620_000 }]);
    // A refusal that comes after "Try again" played again: dropped.
    showing(t, 630_000);
    await t.press('RIGHT');
    t.clock.advance(SEEK_DELAY_MS);
    t.controller.set('failed', NOT_FOUND);
    await t.press('OK');
    expect(t.controller.options).toEqual([{}, { startMs: 620_000 }, { startMs: 630_000 }]);
    answers[2]!(false);
    await flush();
    expect(t.controller.plays).toHaveLength(3);
  });

  it('presses its buttons: "Audio and subtitles", "Stream info" and "Picture"', async () => {
    const t = watch();
    showing(t);
    await t.press('DOWN', 'OK');
    expect(t.player.menu.screen.value).not.toBeNull();
    await t.press('BACK');
    expect(t.player.menu.screen.value).toBeNull();
    t.player.screen.value!.focus('actions', 1);
    await t.press('OK');
    expect(t.player.streamInfo.shown.value).toBe(true);
    await t.press('RIGHT', 'OK');
    expect(t.pictured).toEqual(['zoom']);
    // A channel's buttons again after it: "Previous channel" first.
    await t.press('BACK');
    t.player.show(2);
    expect(t.player.actions.value).toEqual(CHANNEL_ACTIONS);
    expect(t.player.screen.value!.zone('actions')).toMatchObject({ count: 4 });
    expect(t.player.movie.value).toBeNull();
  });

  it('pauses and plays on: OK on the seek bar or with the bar hidden, and PLAY/PAUSE', async () => {
    const t = watch();
    showing(t);
    // Hidden, the keys are the seek bar's again.
    await t.press('DOWN');
    expect(t.at()).toBe('player · actions 0');
    t.clock.advance(INFO_MS);
    expect(t.at()).toBe('player · seek 0');
    await t.press('OK');
    expect(t.controller.status.state).toBe('paused');
    await t.press('PLAY_PAUSE');
    expect(t.controller.pauses).toEqual(['pause', 'resume']);
    t.clock.advance(INFO_MS);
    expect(t.player.info.value).toBe(false);
    await t.press('OK');
    expect(t.controller.pauses).toEqual(['pause', 'resume', 'pause']);
    expect(t.player.info.value).toBe(true);
  });

  it('seeks inside the stream once the keys rest: LEFT/RIGHT ten seconds (a minute once held), FF/RW five minutes, in every language', async () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      const t = watch(90 * MIN, dir);
      showing(t, 600_000);
      await t.press('RIGHT', 'RIGHT', 'RIGHT');
      expect(t.player.position.value).toEqual({ time: 630_000, seeking: true, live: false });
      t.clock.advance(SEEK_DELAY_MS - 1);
      expect(t.controller.seeks).toEqual([]);
      t.clock.advance(1);
      await flush();
      expect(t.controller.seeks).toEqual([630_000]);
      expect(t.player.position.value).toEqual({ time: 630_000, seeking: false, live: false });
      expect(t.controller.plays).toHaveLength(1);
      // FF and RW: five minutes; LEFT back.
      await t.press('FF', 'LEFT');
      expect(t.player.position.value!.time).toBe(630_000 + JUMP_STEP_MS - MOVIE_STEP_MS);
      t.clock.advance(SEEK_DELAY_MS);
      await flush();
      expect(t.controller.seeks).toEqual([630_000, 920_000]);
      // A held RIGHT: after `HELD_PRESSES` presses, a minute each.
      for (let i = 0; i < HELD_PRESSES + 2; i += 1) {
        await t.press('RIGHT');
        t.clock.advance(HOLD_MS);
      }
      expect(t.player.position.value!.time).toBe(920_000 + HELD_PRESSES * MOVIE_STEP_MS + 2 * MIN);
    }
  });

  it("stops at the start, and forward at the last step before the end (anywhere while the length isn't known)", async () => {
    const t = watch(20 * MIN);
    showing(t, 5000);
    await t.press('LEFT');
    expect(t.player.position.value!.time).toBe(0);
    await t.press('FF', 'FF', 'FF', 'FF', 'FF');
    expect(t.player.position.value!.time).toBe(20 * MIN - MOVIE_STEP_MS);
    // A film shorter than a step: its start.
    const short = watch(5000);
    showing(short, 1000);
    await short.press('RIGHT');
    expect(short.player.position.value!.time).toBe(0);
    const unknown = watch(null);
    showing(unknown, 5000);
    await unknown.press('FF', 'FF');
    expect(unknown.player.position.value!.time).toBe(5000 + 2 * JUMP_STEP_MS);
  });

  it('plays again from the target where the engine refuses the seek, and before the picture shows', async () => {
    const t = watch();
    showing(t, 600_000);
    t.controller.seekOk = false;
    await t.press('RIGHT');
    t.clock.advance(SEEK_DELAY_MS);
    await flush();
    expect(t.controller.seeks).toEqual([610_000]);
    expect(t.controller.plays).toEqual([request, request]);
    expect(t.controller.options).toEqual([{}, { startMs: 610_000 }]);
    expect(t.player.position.value).toEqual({ time: 610_000, seeking: false, live: false });
    // Opening: no seek inside, a new play from the target.
    await t.press('RW');
    t.clock.advance(SEEK_DELAY_MS);
    await flush();
    expect(t.controller.seeks).toEqual([610_000]);
    expect(t.controller.options[2]).toEqual({ startMs: 310_000 });
    expect(t.player.plays.value).toBe(3);
    // A refusal that answers after Back plays nothing, even with another movie on by then.
    showing(t, 310_000);
    let answer: (ok: boolean) => void = () => undefined;
    t.controller.seek = (ms) => {
      t.controller.seeks.push(ms);
      return new Promise((resolve) => (answer = resolve));
    };
    await t.press('RIGHT');
    t.clock.advance(SEEK_DELAY_MS);
    await t.press('BACK');
    t.player.playMovie({ item: film, request, lengthMs: null, closed: () => undefined });
    answer(false);
    await flush();
    expect(t.controller.options).toEqual([{}, { startMs: 610_000 }, { startMs: 310_000 }, {}]);
  });

  it('closes onto the details on Back, never onto the live list', async () => {
    const t = watch();
    showing(t);
    await t.press('BACK');
    expect(t.back).toEqual(['details']);
    expect(t.closed).toEqual([]);
    expect(t.chrome).toEqual([true, false]);
    expect(t.controller.stops).toBe(1);
    expect(t.player.open.value).toBe(false);
    expect(t.player.movie.value).toBeNull();
    expect(t.player.position.value).toBeNull();
    expect(t.nav.snapshot().depth).toBe(1);
    expect(t.clock.pending()).toBe(0);
    // A channel after it closes onto the list again.
    t.player.show(3);
    await t.press('BACK');
    expect(t.closed).toEqual([3]);
    expect(t.back).toEqual(['details']);
  });

  it('shows "The movie has ended" with "Back" at its end, and the error card plays on from where it was', async () => {
    const t = watch();
    showing(t, 600_000);
    t.clock.advance(POSITION_MS);
    t.controller.set('ended');
    expect(t.at()).toBe('player · card 0');
    expect(t.player.screen.value!.zone('card')).toMatchObject({ count: 1 });
    expect(t.player.info.value).toBe(true);
    await t.press('OK');
    expect(t.back).toEqual(['details']);

    const u = watch();
    showing(u, 600_000);
    u.clock.advance(POSITION_MS);
    u.controller.set('failed', NOT_FOUND);
    expect(u.at()).toBe('player · card 0');
    expect(u.player.screen.value!.zone('card')).toMatchObject({ count: 2 });
    await u.press('OK');
    expect(u.controller.options).toEqual([{}, { startMs: 600_000 }]);
    expect(u.at()).toBe('player · seek 0');
    u.controller.set('failed', NOT_FOUND);
    await u.press('RIGHT', 'OK');
    expect(u.back).toEqual(['details']);
    expect(u.controller.plays).toHaveLength(2);
  });

  it("ignores a catalog refresh: a movie isn't in the list", async () => {
    const t = setup();
    t.player.show(2);
    await t.press('BACK');
    t.player.playMovie({ item: film, request, lengthMs: null, closed: () => undefined });
    t.player.listChanging();
    expect(t.list.locates).toEqual([]);
    // (A channel's player looks for its row.)
    await t.press('BACK');
    t.player.show(2);
    t.player.listChanging();
    expect(t.list.locates.map((l) => l.guess)).toEqual([2]);
  });
});
