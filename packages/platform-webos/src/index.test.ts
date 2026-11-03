import { describe, expect, it } from 'vitest';
import { parsePalmDeviceInfo, watchCursorState, watchKeyboardState, webosChromiumVersion, webosKeyToIntent, webosModelYear, webosTextKey } from './index';

describe('webOS key map', () => {
  it.each([
    [38, 'UP'],
    [40, 'DOWN'],
    [37, 'LEFT'],
    [39, 'RIGHT'],
    [13, 'OK'],
    [461, 'BACK'],
    [33, 'CH_UP'],
    [34, 'CH_DOWN'],
    [48, 'DIGIT_0'],
    [53, 'DIGIT_5'],
    [57, 'DIGIT_9'],
    [415, 'PLAY_PAUSE'],
    [19, 'PLAY_PAUSE'],
    [413, 'STOP'],
    [417, 'FF'],
    [412, 'RW'],
    [457, 'INFO'],
    [403, 'RED'],
    [404, 'GREEN'],
    [405, 'YELLOW'],
    [406, 'BLUE'],
  ])('code %i -> %s', (keyCode, intent) => {
    expect(webosKeyToIntent({ keyCode })).toBe(intent);
  });

  it.each([8, 27, 65, 10009])('ignores code %i', (keyCode) => {
    expect(webosKeyToIntent({ keyCode })).toBeNull();
  });
});

describe('webOS version tables', () => {
  it.each([
    ['4.1.0', 2018, 53],
    ['4.5.0', 2019, 53],
    ['3.5.0', 2017, 38],
    ['5.0.0', 2020, 68],
    ['6.3.1', 2021, 79],
    ['7.2.0', 2022, 87], // webOS TV 22
    ['8.0.0', 2023, 94], // webOS TV 23
    ['10.1.0', 2025, 120], // webOS TV 25
  ])('%s -> %i, Chromium %i', (version, year, chromium) => {
    expect(webosModelYear(version)).toBe(year);
    expect(webosChromiumVersion(version)).toBe(chromium);
  });

  it.each(['unknown', '', '99.0.0'])('unknown version %j -> null', (version) => {
    expect(webosModelYear(version)).toBeNull();
    expect(webosChromiumVersion(version)).toBeNull();
  });
});

describe('parsePalmDeviceInfo', () => {
  it('reads the model, platform version and firmware', () => {
    const raw = JSON.stringify({
      modelName: '43UK6300PLB',
      platformVersion: '4.1.0',
      platformVersionMajor: '4',
      firmwareVersion: '05.10.20',
    });
    expect(parsePalmDeviceInfo(raw)).toEqual({
      modelName: '43UK6300PLB',
      platformVersion: '4.1.0',
      firmwareVersion: '05.10.20',
    });
  });

  it.each([undefined, null, 42, '', 'not json', '"a string"', 'null', '{"modelName": 7}'])(
    'tolerates %j',
    (raw) => {
      expect(parsePalmDeviceInfo(raw)).toEqual({});
    },
  );
});

describe('watchCursorState (Magic Remote pointer)', () => {
  const cursor = (detail: unknown): Event => new CustomEvent('cursorStateChange', { detail });

  it('reports the pointer shown and hidden until unsubscribed', () => {
    const target = new EventTarget();
    const seen: boolean[] = [];
    const stop = watchCursorState(target, (visible) => seen.push(visible));
    target.dispatchEvent(cursor({ visibility: true }));
    target.dispatchEvent(cursor({ visibility: false }));
    stop();
    target.dispatchEvent(cursor({ visibility: true }));
    expect(seen).toEqual([true, false]);
  });

  it.each([null, undefined, {}, { visibility: 'true' }, { visibility: 1 }])('ignores the detail %j', (detail) => {
    const target = new EventTarget();
    const seen: boolean[] = [];
    watchCursorState(target, (visible) => seen.push(visible));
    target.dispatchEvent(cursor(detail));
    expect(seen).toEqual([]);
  });
});

describe('webosTextKey (a text field being edited, RELAY step 13a)', () => {
  const code = (keyCode: number) => ({ keyCode });

  it.each([
    [13, 'done'],
    [461, 'close'],
    [38, 'up'],
    [40, 'down'],
  ] as const)('key %i ends the edit as %s', (keyCode, textKey) => {
    expect(webosTextKey(code(keyCode))).toBe(textKey);
  });

  it.each([37, 39, 8, 46, 48, 65, 33, 403])('leaves key %i to the field', (keyCode) => {
    expect(webosTextKey(code(keyCode))).toBeNull();
  });
});

describe('watchKeyboardState (the virtual keyboard, RELAY step 13a)', () => {
  const keyboard = (detail: unknown): Event => new CustomEvent('keyboardStateChange', { detail });

  it('reports the keyboard shown and hidden until unsubscribed', () => {
    const target = new EventTarget();
    const seen: boolean[] = [];
    const stop = watchKeyboardState(target, (visible) => seen.push(visible));
    target.dispatchEvent(keyboard({ visibility: true }));
    target.dispatchEvent(keyboard({ visibility: false }));
    stop();
    target.dispatchEvent(keyboard({ visibility: true }));
    expect(seen).toEqual([true, false]);
  });

  it.each([null, undefined, {}, { visibility: 'false' }, { visibility: 0 }])('ignores the detail %j', (detail) => {
    const target = new EventTarget();
    const seen: boolean[] = [];
    watchKeyboardState(target, (visible) => seen.push(visible));
    target.dispatchEvent(keyboard(detail));
    expect(seen).toEqual([]);
  });

  it('is not the pointer event', () => {
    const target = new EventTarget();
    const seen: boolean[] = [];
    watchKeyboardState(target, (visible) => seen.push(visible));
    target.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: true } }));
    expect(seen).toEqual([]);
  });
});
