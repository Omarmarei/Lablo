import type { CatalogItem, ContentKey } from '@zoma/core';
import type { EpgNowNext } from '@zoma/data';
import type { Intent } from '@zoma/platform-api';
import type { PlaybackFailure, PlayerState, PlayerStatus, PlayerTracks, PlayRequest } from '@zoma/player';
import { NO_TRACKS } from '@zoma/player';
import { createNavigator } from '@zoma/ui';
import { describe, expect, it } from 'vitest';
import type { LiveRow, Timers } from '../live/live-state';
import type { PlayerLike, ZapList } from './player-state';
import { DIGITS_MS, INFO_MS, MISSING_MS, TRACKS_ACTION, ZAP_DELAY_MS, createPlayer, liveRequest } from './player-state';
import { MENU_ROWS } from './track-menu';

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
  readonly guides = new Map<ContentKey, EpgNowNext>();
  readonly asked: ContentKey[] = [];

  count(): number {
    return COUNT;
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

function setup() {
  const list = new FakeList();
  const controller = new FakeController();
  const clock = manualTimers();
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: COUNT }] },
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
  return { list, controller, clock, nav, player, chrome, closed, press, at, made: () => made };
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
async function playing(tracks: PlayerTracks = TRACKS) {
  const t = setup();
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
