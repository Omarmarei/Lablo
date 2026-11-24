import type { Intent } from '@lablo/platform-api';
import type { PictureMode } from '@lablo/player';
import { createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import type { SleepTimer } from '../player/watch-guard';
import { DEFAULT_STILL_HOURS, SLEEP_MINUTES, STILL_HOURS } from '../player/watch-guard';
import { BUFFER_MODES } from '../player/play-tuning';
import type { PlayerValues } from './player-settings';
import { CLOCK_CHOICES, PLAYER_SETTINGS_ROWS, PLAYER_SETTINGS_SCREEN, SLEEP_CHOICES, STILL_CHOICES, TRACK_CHOICES, createPlayerSettings, nextValue } from './player-settings';

/**
 * Settings › "Player" (RELAY step 38d3): four rows, each changed in place by OK (round its values)
 * and by LEFT and RIGHT (towards the reading end, stopping at the ends); each change told to main
 * once, a value already shown told nothing.
 */

const ROW = 5;

function setup(values: PlayerValues, modes: readonly PictureMode[] = ['fit', 'zoom', 'stretch', '4:3']) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const settings = nav.push({ id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 10, visible: 7 }] });
  settings.focus('items', ROW);
  const told: string[] = [];
  /** The player's sleep timer, as main would give it: `setSleep` starts it at the test's time. */
  const timer: { set: SleepTimer | null } = { set: null };
  const options = {
    modes: vi.fn(() => modes),
    values: vi.fn(() => values),
    setAudio: vi.fn((lang: string | null) => told.push(`audio ${String(lang)}`)),
    setSubtitles: vi.fn((lang: string | null) => told.push(`subtitles ${String(lang)}`)),
    setSize: vi.fn((size: string) => told.push(`size ${size}`)),
    setPicture: vi.fn((mode: string) => told.push(`picture ${mode}`)),
    setClock: vi.fn((on: boolean) => told.push(`clock ${String(on)}`)),
    setStill: vi.fn((hours: number | null) => told.push(`still ${String(hours)}`)),
    sleep: vi.fn(() => timer.set),
    setSleep: vi.fn((minutes: number | null) => {
      told.push(`sleep ${String(minutes)}`);
      timer.set = minutes === null ? null : { minutes, until: 1000 + minutes * 60_000 };
    }),
    setBuffer: vi.fn((mode: string) => told.push(`buffer ${mode}`)),
  };
  const page = createPlayerSettings(nav, options);
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = (...keys: Intent[]): void => {
    for (const key of keys) nav.handle(key);
  };
  const shown = (): unknown[] => [page.audio.value, page.subtitles.value, page.size.value, page.picture.value, page.clock.value];
  return { nav, settings, page, options, told, timer, at, press, shown };
}

const START: PlayerValues = { audio: null, subtitles: null, size: 'm', picture: 'fit', clock: false, still: 4, buffer: 'fast' };

describe('nextValue (RELAY step 38d3)', () => {
  it('goes round the list on OK, and towards an end on LEFT or RIGHT, stopping there', () => {
    const list = ['a', 'b', 'c'];
    expect([nextValue(list, 'a', 0), nextValue(list, 'b', 0), nextValue(list, 'c', 0)]).toEqual(['b', 'c', 'a']);
    expect([nextValue(list, 'a', 1), nextValue(list, 'b', 1), nextValue(list, 'c', 1)]).toEqual(['b', 'c', 'c']);
    expect([nextValue(list, 'a', -1), nextValue(list, 'b', -1), nextValue(list, 'c', -1)]).toEqual(['a', 'a', 'b']);
  });

  it('moves a value the list lacks to its first, whichever way', () => {
    for (const step of [0, 1, -1] as const) expect(nextValue(['fit', 'stretch'], 'zoom', step)).toBe('fit');
    expect(nextValue([null, 'ar', 'en'], null, 0)).toBe('ar');
  });

  it('keeps a list of one where it is', () => {
    for (const step of [0, 1, -1] as const) expect(nextValue(['fit'], 'fit', step)).toBe('fit');
  });
});

describe('Settings › "Player" (RELAY step 38d3)', () => {
  it('opens its eight rows over the settings, seven in view, the modes read before the values', () => {
    const t = setup({ audio: 'en', subtitles: 'ar', size: 'l', picture: 'stretch', clock: true, still: 6, buffer: 'stable' }, ['fit', 'stretch', '4:3']);
    expect(PLAYER_SETTINGS_ROWS).toEqual(['audio', 'subtitles', 'size', 'picture', 'clock', 'still', 'sleep', 'buffer']);
    expect(TRACK_CHOICES).toEqual([null, 'ar', 'en']);
    expect(CLOCK_CHOICES).toEqual([false, true]);
    // Nothing read before it opens.
    expect(t.options.modes).not.toHaveBeenCalled();
    expect(t.options.values).not.toHaveBeenCalled();
    t.page.open();
    expect(t.nav.top.id).toBe(PLAYER_SETTINGS_SCREEN);
    expect(t.nav.top.zone('rows')).toMatchObject({ kind: 'list', axis: 'vertical', count: 8, visible: 7 });
    expect(t.at()).toBe('player-settings · rows 0');
    expect(t.options.modes.mock.invocationCallOrder[0]!).toBeLessThan(t.options.values.mock.invocationCallOrder[0]!);
    expect(t.shown()).toEqual(['en', 'ar', 'l', 'stretch', true]);
    expect(t.page.still.value).toBe(6);
    expect(t.page.buffer.value).toBe('stable');
    expect(t.page.modes.value).toEqual(['fit', 'stretch', '4:3']);
    // Back returns to the settings' row.
    t.press('BACK');
    expect(t.at()).toBe('settings · items 5');
    expect(t.told).toEqual([]);
  });

  it('goes round each row on OK, telling main each new value once', () => {
    const t = setup(START);
    t.page.open();
    t.press('OK', 'OK', 'OK');
    expect(t.page.audio.value).toBeNull();
    expect(t.told).toEqual(['audio ar', 'audio en', 'audio null']);
    t.told.length = 0;
    t.press('DOWN', 'OK', 'OK', 'OK');
    expect(t.at()).toBe('player-settings · rows 1');
    expect(t.told).toEqual(['subtitles ar', 'subtitles en', 'subtitles null']);
    t.told.length = 0;
    t.press('DOWN', 'OK', 'OK', 'OK');
    expect(t.told).toEqual(['size l', 'size s', 'size m']);
    t.told.length = 0;
    t.press('DOWN', 'OK', 'OK', 'OK', 'OK');
    expect(t.told).toEqual(['picture zoom', 'picture stretch', 'picture 4:3', 'picture fit']);
    t.told.length = 0;
    t.press('DOWN', 'OK', 'OK', 'OK');
    expect(t.at()).toBe('player-settings · rows 4');
    expect(t.told).toEqual(['clock true', 'clock false', 'clock true']);
    expect(t.shown()).toEqual([null, null, 'm', 'fit', true]);
  });

  it("turns the clock on by the reading end's arrow and off by the other, stopping at each (step 39a)", () => {
    for (const dir of ['ltr', 'rtl'] as const) {
      const t = setup(START);
      t.nav.setDir(dir);
      const on: Intent = dir === 'ltr' ? 'RIGHT' : 'LEFT';
      const off: Intent = dir === 'ltr' ? 'LEFT' : 'RIGHT';
      t.page.open();
      t.press('DOWN', 'DOWN', 'DOWN', 'DOWN', off);
      expect(t.told).toEqual([]);
      t.press(on, on);
      expect(t.page.clock.value).toBe(true);
      t.press(off, off);
      expect(t.told).toEqual(['clock true', 'clock false']);
      expect(t.page.clock.value).toBe(false);
    }
  });

  it('steps by RIGHT towards the end in English, stopping there; LEFT back towards the start', () => {
    const t = setup(START);
    t.page.open();
    t.press('RIGHT', 'RIGHT', 'RIGHT');
    expect(t.page.audio.value).toBe('en');
    // The end told nothing more.
    expect(t.told).toEqual(['audio ar', 'audio en']);
    t.press('LEFT', 'LEFT', 'LEFT');
    expect(t.page.audio.value).toBeNull();
    expect(t.told).toEqual(['audio ar', 'audio en', 'audio ar', 'audio null']);
    // The focus stays on the row.
    expect(t.at()).toBe('player-settings · rows 0');
    t.told.length = 0;
    t.press('DOWN', 'DOWN', 'LEFT', 'LEFT', 'RIGHT');
    expect(t.told).toEqual(['size s', 'size m']);
  });

  it('steps by LEFT towards the end in Arabic', () => {
    const t = setup(START);
    t.nav.setDir('rtl');
    t.page.open();
    t.press('DOWN', 'DOWN', 'DOWN', 'LEFT', 'LEFT');
    expect(t.page.picture.value).toBe('stretch');
    t.press('RIGHT');
    expect(t.told).toEqual(['picture zoom', 'picture stretch', 'picture zoom']);
    t.press('UP', 'LEFT');
    expect(t.told.slice(-1)).toEqual(['size l']);
  });

  it("offers only the engine's picture modes: a TV without Zoom goes from Fit to Stretch", () => {
    const t = setup(START, ['fit', 'stretch', '4:3']);
    t.page.open();
    t.press('DOWN', 'DOWN', 'DOWN', 'OK', 'OK', 'OK');
    expect(t.told).toEqual(['picture stretch', 'picture 4:3', 'picture fit']);
    t.told.length = 0;
    // One mode only: nothing to change.
    const one = setup(START, ['fit']);
    one.page.open();
    one.press('DOWN', 'DOWN', 'DOWN', 'OK', 'RIGHT', 'LEFT');
    expect(one.told).toEqual([]);
  });

  it('reads the values again at each opening', () => {
    let values: PlayerValues = START;
    const t = setup(START);
    t.options.values.mockImplementation(() => values);
    t.page.open();
    t.press('BACK');
    values = { audio: 'ar', subtitles: 'en', size: 's', picture: 'zoom', clock: true, still: null, buffer: 'stable' };
    t.page.open();
    expect(t.shown()).toEqual(['ar', 'en', 's', 'zoom', true]);
    expect(t.page.still.value).toBeNull();
    expect(t.page.buffer.value).toBe('stable');
    expect(t.options.modes).toHaveBeenCalledTimes(2);
  });

  it('"Still watching?" (step 39c): never, then the guard\'s hours; 4 hours until main says otherwise', () => {
    expect(STILL_CHOICES).toEqual([null, ...STILL_HOURS]);
    expect(SLEEP_CHOICES).toEqual([null, ...SLEEP_MINUTES]);
    const t = setup(START);
    // Before the page opens: the default.
    expect(t.page.still.value).toBe(DEFAULT_STILL_HOURS);
    t.page.open();
    t.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN');
    expect(t.at()).toBe('player-settings · rows 5');
    // OK goes round: 6, never, 2, 4.
    t.press('OK', 'OK', 'OK', 'OK');
    expect(t.told).toEqual(['still 6', 'still null', 'still 2', 'still 4']);
    expect(t.page.still.value).toBe(4);
    t.told.length = 0;
    // The arrows stop at the ends.
    t.press('RIGHT', 'RIGHT', 'LEFT', 'LEFT', 'LEFT', 'LEFT');
    expect(t.told).toEqual(['still 6', 'still 4', 'still 2', 'still null']);
    expect(t.page.still.value).toBeNull();
    expect(t.options.setSleep).not.toHaveBeenCalled();
  });

  it("the sleep timer (step 39c): the row shows the player's own timer, and each new value starts it", () => {
    const t = setup(START);
    t.page.open();
    for (let i = 0; i < 6; i += 1) t.press('DOWN');
    expect(t.at()).toBe('player-settings · rows 6');
    expect(t.page.sleep()).toBeNull();
    // Off's start: LEFT changes nothing; RIGHT steps to the end and no further.
    t.press('LEFT');
    expect(t.told).toEqual([]);
    t.press('RIGHT', 'RIGHT', 'RIGHT', 'RIGHT', 'RIGHT');
    expect(t.told).toEqual(['sleep 30', 'sleep 60', 'sleep 90', 'sleep 120']);
    expect(t.page.sleep()).toEqual({ minutes: 120, until: 1000 + 120 * 60_000 });
    // OK goes round, to off after the last.
    t.told.length = 0;
    t.press('OK', 'OK');
    expect(t.told).toEqual(['sleep null', 'sleep 30']);
    // The timer ended by itself (the player's): the row starts from off again.
    t.timer.set = null;
    t.told.length = 0;
    t.press('RIGHT');
    expect(t.told).toEqual(['sleep 30']);
    // In Arabic LEFT steps towards the end.
    t.nav.setDir('rtl');
    t.press('LEFT', 'RIGHT', 'RIGHT');
    expect(t.told).toEqual(['sleep 30', 'sleep 60', 'sleep 30', 'sleep null']);
    expect(t.options.setStill).not.toHaveBeenCalled();
    // The clock's row is still its own.
    t.press('UP', 'UP', 'OK');
    expect(t.told.slice(-1)).toEqual(['clock true']);
  });

  it('"Buffering" (step 39d): Fast start, then Stable; the arrows stop at the ends, OK goes round', () => {
    expect(BUFFER_MODES).toEqual(['fast', 'stable']);
    const t = setup(START);
    // Before the page opens: Fast start.
    expect(t.page.buffer.value).toBe('fast');
    t.page.open();
    for (let i = 0; i < 7; i += 1) t.press('DOWN');
    expect(t.at()).toBe('player-settings · rows 7');
    // The window scrolled: the eighth row is the last in view.
    expect(t.nav.top.position('rows').top).toBe(1);
    t.press('LEFT');
    expect(t.told).toEqual([]);
    t.press('RIGHT', 'RIGHT');
    expect(t.told).toEqual(['buffer stable']);
    expect(t.page.buffer.value).toBe('stable');
    t.press('OK', 'OK');
    expect(t.told).toEqual(['buffer stable', 'buffer fast', 'buffer stable']);
    // In Arabic LEFT steps towards the end.
    t.nav.setDir('rtl');
    t.press('RIGHT', 'RIGHT', 'LEFT');
    expect(t.told.slice(3)).toEqual(['buffer fast', 'buffer stable']);
    expect(t.options.setSleep).not.toHaveBeenCalled();
    // The sleep timer's row is still its own.
    t.press('UP', 'OK');
    expect(t.told.slice(-1)).toEqual(['sleep 30']);
  });

  it('leaves other keys to the navigator', () => {
    const t = setup(START);
    t.page.open();
    t.press('DOWN');
    expect(t.at()).toBe('player-settings · rows 1');
    t.press('UP', 'UP');
    expect(t.at()).toBe('player-settings · rows 0');
    expect(t.told).toEqual([]);
  });
});
