import type { Intent } from '@lablo/platform-api';
import type { PictureMode } from '@lablo/player';
import { createNavigator } from '@lablo/ui';
import { describe, expect, it, vi } from 'vitest';
import type { PlayerValues } from './player-settings';
import { CLOCK_CHOICES, PLAYER_SETTINGS_ROWS, PLAYER_SETTINGS_SCREEN, TRACK_CHOICES, createPlayerSettings, nextValue } from './player-settings';

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
  const options = {
    modes: vi.fn(() => modes),
    values: vi.fn(() => values),
    setAudio: vi.fn((lang: string | null) => told.push(`audio ${String(lang)}`)),
    setSubtitles: vi.fn((lang: string | null) => told.push(`subtitles ${String(lang)}`)),
    setSize: vi.fn((size: string) => told.push(`size ${size}`)),
    setPicture: vi.fn((mode: string) => told.push(`picture ${mode}`)),
    setClock: vi.fn((on: boolean) => told.push(`clock ${String(on)}`)),
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
  return { nav, settings, page, options, told, at, press, shown };
}

const START: PlayerValues = { audio: null, subtitles: null, size: 'm', picture: 'fit', clock: false };

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
  it('opens its five rows over the settings, the modes read before the values', () => {
    const t = setup({ audio: 'en', subtitles: 'ar', size: 'l', picture: 'stretch', clock: true }, ['fit', 'stretch', '4:3']);
    expect(PLAYER_SETTINGS_ROWS).toEqual(['audio', 'subtitles', 'size', 'picture', 'clock']);
    expect(TRACK_CHOICES).toEqual([null, 'ar', 'en']);
    expect(CLOCK_CHOICES).toEqual([false, true]);
    // Nothing read before it opens.
    expect(t.options.modes).not.toHaveBeenCalled();
    expect(t.options.values).not.toHaveBeenCalled();
    t.page.open();
    expect(t.nav.top.id).toBe(PLAYER_SETTINGS_SCREEN);
    expect(t.nav.top.zone('rows')).toMatchObject({ kind: 'list', axis: 'vertical', count: 5 });
    expect(t.at()).toBe('player-settings · rows 0');
    expect(t.options.modes.mock.invocationCallOrder[0]!).toBeLessThan(t.options.values.mock.invocationCallOrder[0]!);
    expect(t.shown()).toEqual(['en', 'ar', 'l', 'stretch', true]);
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
    values = { audio: 'ar', subtitles: 'en', size: 's', picture: 'zoom', clock: true };
    t.page.open();
    expect(t.shown()).toEqual(['ar', 'en', 's', 'zoom', true]);
    expect(t.options.modes).toHaveBeenCalledTimes(2);
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
