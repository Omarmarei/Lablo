import type { CatalogItem, ContentKey } from '@zoma/core';
import type { EpgNowNext } from '@zoma/data';
import type { Intent } from '@zoma/platform-api';
import type { PlaybackFailure, PlayerState, PlayerStatus, PlayerTracks, PlayRequest, SubtitleView } from '@zoma/player';
import { NO_TRACKS } from '@zoma/player';
import { createNavigator } from '@zoma/ui';
import { describe, expect, it } from 'vitest';
import type { LiveRow, Timers } from '../live/live-state';
import type { PlayerLike, ZapList } from './player-state';
import { DIGITS_MS, INFO_MS, MISSING_MS, TRACKS_ACTION, ZAP_DELAY_MS, createPlayer, liveRequest } from './player-state';
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

  play(req: PlayRequest): Promise<void> {
    this.plays.push(req);
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
    this.status = { state, session: this.status.session + (state === 'opening' && failure === null ? 1 : 0), key, container: 'ts', attempt: 0, failure, tracks: this.tracks };
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

function setup(dir: 'ltr' | 'rtl' = 'ltr', kept: { subtitleSize?: SubtitleSize } = {}) {
  const list = new FakeList();
  /** Each `tuned` call: the channel's key and its row. */
  const tuned: string[] = [];
  const sized: SubtitleSize[] = [];
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
    ...kept,
    timers: clock.timers,
  });
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  return { list, controller, clock, nav, player, chrome, closed, tuned, sized, press, at, made: () => made };
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
