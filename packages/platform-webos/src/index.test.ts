import { deviceTier } from '@zoma/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWebosPlatform,
  parsePalmDeviceInfo,
  watchCursorState,
  watchKeyboardState,
  webosChromiumVersion,
  webosKeyToIntent,
  webosMajorFromChromium,
  webosModelYear,
  webosTextKey,
  webosVersionFacts,
} from './index';

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

describe('webOS key registration (spike S10)', () => {
  it('has nothing to register: webOS delivers every key', () => {
    expect(createWebosPlatform().registerKeys()).toEqual({ skipped: 'webOS delivers every key', supported: null, registered: [], unsupported: [], refused: [] });
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
  it('reads the model, the two version fields, the firmware and the keys', () => {
    const raw = JSON.stringify({
      modelName: '43UK6300PLB',
      platformVersion: '4.1.0',
      platformVersionMajor: '4',
      firmwareVersion: '05.10.20',
      sdkVersion: '4.1.0',
    });
    expect(parsePalmDeviceInfo(raw)).toEqual({
      modelName: '43UK6300PLB',
      platformVersion: '4.1.0',
      firmwareVersion: '05.10.20',
      sdkVersion: '4.1.0',
      keys: ['modelName', 'platformVersion', 'platformVersionMajor', 'firmwareVersion', 'sdkVersion'],
    });
  });

  it('keeps the keys of an object whose values it cannot use', () => {
    expect(parsePalmDeviceInfo('{"modelName": 7}')).toEqual({ keys: ['modelName'] });
  });

  it.each([undefined, null, 42, '', 'not json', '"a string"', 'null'])('tolerates %j', (raw) => {
    expect(parsePalmDeviceInfo(raw)).toEqual({});
  });
});

describe('webosMajorFromChromium', () => {
  it.each([
    [38, 3],
    [53, 4],
    [68, 5],
    [79, 6],
    [87, 7],
    [94, 8],
    [108, 9],
    [120, 10],
  ])('Chromium %i -> webOS %i', (chromium, major) => {
    expect(webosMajorFromChromium(chromium)).toBe(major);
  });

  it.each([0, 52, 54, 80, 156])('Chromium %i ships with no webOS release -> null', (chromium) => {
    expect(webosMajorFromChromium(chromium)).toBeNull();
  });
});

describe('webosVersionFacts (relay step 16a: the year is not the firmware)', () => {
  /** What the 2021 OLED55A1PVA reported in leg 34: `platformVersion` is its firmware. */
  const OLED_2021 = { modelName: 'OLED55A1PVA', platformVersion: '03.53.45' };

  it('takes the year from sdkVersion when the TV gives one', () => {
    expect(webosVersionFacts({ ...OLED_2021, sdkVersion: '6.5.3' }, 79)).toEqual({
      osVersion: '6.5.3',
      modelYear: 2021,
      chromiumVersion: 79,
      firmware: '03.53.45',
      versionFrom: 'sdkVersion',
    });
  });

  it('prefers sdkVersion to the engine, and takes the engine from it without a user agent', () => {
    expect(webosVersionFacts({ sdkVersion: '4.5.0' }, 53)).toMatchObject({ modelYear: 2019, versionFrom: 'sdkVersion' });
    expect(webosVersionFacts({ sdkVersion: '5.0.0' }, null)).toMatchObject({ modelYear: 2020, chromiumVersion: 68, versionFrom: 'sdkVersion' });
  });

  it('never reads the firmware in platformVersion as the version: 03.53.45 is not 2017', () => {
    const facts = webosVersionFacts(OLED_2021, 79);
    expect(facts).toEqual({ osVersion: '6', modelYear: 2021, chromiumVersion: 79, firmware: '03.53.45', versionFrom: 'chromium' });
    expect(deviceTier(facts)).toBe('full');
  });

  it.each([
    [53, 2018],
    [68, 2020],
    [79, 2021],
    [87, 2022],
    [94, 2023],
    [108, 2024],
    [120, 2025],
  ])('without sdkVersion, the user agent Chromium %i gives %i', (chromium, year) => {
    expect(webosVersionFacts({}, chromium)).toMatchObject({ modelYear: year, chromiumVersion: chromium, versionFrom: 'chromium' });
  });

  it('falls back to the engine when sdkVersion is one the table does not know', () => {
    expect(webosVersionFacts({ sdkVersion: '24.1.0' }, 108)).toMatchObject({ osVersion: '9', modelYear: 2024, versionFrom: 'chromium' });
  });

  it('knows no year when neither names a release, and the tier then follows the engine', () => {
    expect(webosVersionFacts({}, null)).toEqual({ osVersion: 'unknown', modelYear: null, chromiumVersion: null, firmware: 'unknown', versionFrom: 'none' });
    const desktop = webosVersionFacts({}, 156);
    expect(desktop).toMatchObject({ modelYear: null, chromiumVersion: 156, versionFrom: 'none' });
    expect(deviceTier(desktop)).toBe('full');
  });

  it('takes the firmware from firmwareVersion first, then platformVersion', () => {
    expect(webosVersionFacts({ firmwareVersion: '05.10.20', platformVersion: '03.53.45' }, 79).firmware).toBe('05.10.20');
    expect(webosVersionFacts({ platformVersion: '03.53.45' }, null).firmware).toBe('03.53.45');
  });
});

describe('createWebosPlatform().info() on a webOS 6 TV', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tv = (deviceInfo: string): void => {
    vi.stubGlobal('window', { PalmSystem: { deviceInfo } });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager',
      language: 'en-GB',
    });
  };

  it('reports 2021 and the full tier, and records where the version came from', async () => {
    tv(JSON.stringify({ modelName: 'OLED55A1PVA', platformVersion: '03.53.45', platformVersionMajor: '3' }));
    expect(await createWebosPlatform().info()).toEqual({
      platform: 'webos',
      model: 'OLED55A1PVA',
      modelYear: 2021,
      osVersion: '6',
      firmware: '03.53.45',
      chromiumVersion: 79,
      tier: 'full',
      locale: 'en-GB',
      country: null,
      details: { versionFrom: 'chromium', deviceInfoKeys: 'modelName platformVersion platformVersionMajor', platformVersion: '03.53.45' },
    });
  });

  it('uses sdkVersion when deviceInfo has it', async () => {
    tv(JSON.stringify({ modelName: 'OLED55A1PVA', platformVersion: '03.53.45', sdkVersion: '6.5.3' }));
    expect(await createWebosPlatform().info()).toMatchObject({
      modelYear: 2021,
      osVersion: '6.5.3',
      tier: 'full',
      details: { versionFrom: 'sdkVersion', sdkVersion: '6.5.3' },
    });
  });
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

/** A stage whose document makes elements with what `createStageVideo` and `Html5Engine` touch. */
function fakeStage(mediaId?: string): { stage: HTMLElement; made: Array<{ tag: string }> } {
  const made: Array<{ tag: string }> = [];
  const stage = {
    ownerDocument: {
      createElement: (tag: string) => {
        const el = { tag, mediaId, style: {}, setAttribute: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined };
        made.push(el);
        return el;
      },
    },
    appendChild: () => undefined,
  } as unknown as HTMLElement;
  return { stage, made };
}

describe('createEngines (RELAY step 18)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives one Html5Engine whose audio fallback is luna selectTrack by the element's mediaId", async () => {
    const calls: Array<{ uri: string; params: string }> = [];
    class Bridge {
      onservicecallback: ((message: string) => void) | null = null;
      call(uri: string, params: string): void {
        calls.push({ uri, params });
        setTimeout(() => this.onservicecallback?.('{"returnValue":true}'), 0);
      }
    }
    vi.stubGlobal('window', { PalmServiceBridge: Bridge });
    const { stage, made } = fakeStage('_media7');
    const engines = createWebosPlatform().createEngines(stage);
    expect(engines.map((e) => e.kind)).toEqual(['html5']);
    expect(made.map((el) => el.tag)).toEqual(['video']);
    // The fake element has no audioTracks, so the luna route is all it has.
    expect(engines[0]!.caps.trackSwitch).toBe('unreliable');
    expect(await engines[0]!.selectAudio('2')).toBe(true);
    expect(calls).toEqual([{ uri: 'luna://com.webos.media/selectTrack', params: '{"mediaId":"_media7","type":"audio","index":2}' }]);
  });
});
