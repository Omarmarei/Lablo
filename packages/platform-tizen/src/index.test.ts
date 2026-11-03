import { describe, expect, it } from 'vitest';
import { TIZEN_IME_CANCEL, TIZEN_IME_DONE, buildTizenKeyMap, tizenChromiumVersion, tizenKeysToRegister, tizenModelYear, tizenTextKey } from './index';

describe('Tizen key registration', () => {
  it('registers every non-mandatory key when the supported-key list is unavailable', () => {
    const names = tizenKeysToRegister(null);
    expect(names).toEqual(expect.arrayContaining(['ChannelUp', 'ChannelDown', 'ColorF0Red', '0', '9', 'PreviousChannel']));
    // Arrows, Enter and Back always reach the app and cannot be registered.
    expect(names).not.toContain('ArrowUp');
    expect(names).not.toContain('Enter');
    expect(names).not.toContain('Back');
  });

  it('registers only keys the TV supports', () => {
    const supported = [
      { name: 'ChannelUp', code: 427 },
      { name: 'ColorF0Red', code: 403 },
      { name: 'Exit', code: 10182 },
    ];
    expect(tizenKeysToRegister(supported)).toEqual(['ChannelUp', 'ColorF0Red']);
  });
});

describe('Tizen key map', () => {
  it.each([
    [38, 'UP'],
    [13, 'OK'],
    [10009, 'BACK'],
    [427, 'CH_UP'],
    [428, 'CH_DOWN'],
    [48, 'DIGIT_0'],
    [57, 'DIGIT_9'],
    [10252, 'PLAY_PAUSE'],
    [415, 'PLAY_PAUSE'],
    [19, 'PLAY_PAUSE'],
    [413, 'STOP'],
    [417, 'FF'],
    [412, 'RW'],
    [457, 'INFO'],
    [458, 'GUIDE'],
    [403, 'RED'],
    [406, 'BLUE'],
    [10190, 'PREV_CH'],
  ])('default code %i -> %s', (code, intent) => {
    expect(buildTizenKeyMap(null).get(code)).toBe(intent);
  });

  it('prefers the codes the TV reports', () => {
    const map = buildTizenKeyMap([{ name: 'ColorF0Red', code: 9403 }]);
    expect(map.get(9403)).toBe('RED');
    expect(map.get(403)).toBeUndefined();
    expect(map.get(404)).toBe('GREEN');
  });
});

describe('Tizen version tables', () => {
  it.each([
    ['4.0', 2018, 56],
    ['4.0.0.3', 2018, 56],
    ['5.5', 2020, 69],
    ['7.0', 2023, 94],
    ['9.0', 2025, 120],
  ])('%s -> %i, Chromium %i', (version, year, chromium) => {
    expect(tizenModelYear(version)).toBe(year);
    expect(tizenChromiumVersion(version)).toBe(chromium);
  });

  it.each(['unknown', '', '42.0'])('unknown version %j -> null', (version) => {
    expect(tizenModelYear(version)).toBeNull();
    expect(tizenChromiumVersion(version)).toBeNull();
  });
});

describe('tizenTextKey (a text field being edited, RELAY step 13a)', () => {
  const code = (keyCode: number) => ({ keyCode });

  it.each([
    [13, 'done'],
    [TIZEN_IME_DONE, 'done'],
    [TIZEN_IME_CANCEL, 'close'],
    [10009, 'close'],
    [38, 'up'],
    [40, 'down'],
  ] as const)('key %i ends the edit as %s', (keyCode, textKey) => {
    expect(tizenTextKey(code(keyCode))).toBe(textKey);
  });

  it("uses the IME codes from Samsung's guide", () => {
    expect([TIZEN_IME_DONE, TIZEN_IME_CANCEL]).toEqual([65376, 65385]);
  });

  it.each([37, 39, 8, 46, 48, 65, 427, 403])('leaves key %i to the field', (keyCode) => {
    expect(tizenTextKey(code(keyCode))).toBeNull();
  });

  it('no remote key is an Intent and a different text key by accident', () => {
    // Back is BACK as an Intent and close in a field; OK is OK and done.
    const intents = buildTizenKeyMap(null);
    expect(intents.get(10009)).toBe('BACK');
    expect(intents.get(13)).toBe('OK');
    expect(intents.has(TIZEN_IME_DONE)).toBe(false);
    expect(intents.has(TIZEN_IME_CANCEL)).toBe(false);
  });
});
