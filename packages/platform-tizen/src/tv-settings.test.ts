import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TizenError, TvSettingsApi } from './tv-settings';
import { tizenScreenReader, tizenSetScreenSaver, voiceGuideOn } from './tv-settings';
import { createTizenPlatform } from './index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Answer = { kind: 'success' } | { kind: 'error'; error: TizenError } | { kind: 'throw' } | { kind: 'silent' };

/** `webapis.appcommon` answering each call as `answer`, recording the states asked for. */
function appcommon(answer: Answer, enums = true) {
  const states: number[] = [];
  const api: TvSettingsApi = {
    appcommon: {
      ...(enums ? { AppCommonScreenSaverState: { SCREEN_SAVER_OFF: 10, SCREEN_SAVER_ON: 11 } } : {}),
      setScreenSaver: (state, onsuccess, onerror) => {
        states.push(state);
        if (answer.kind === 'throw') throw Object.assign(new Error('bad state'), { name: 'TypeMismatchError' });
        if (answer.kind === 'success') onsuccess?.();
        if (answer.kind === 'error') onerror?.(answer.error);
      },
    },
  };
  return { api, states };
}

describe('the screensaver on Tizen (RELAY step 15b2)', () => {
  it("asks for off or on with Samsung's constants, falling back to 0 and 1", async () => {
    const withEnums = appcommon({ kind: 'success' });
    expect(await tizenSetScreenSaver(withEnums.api, false)).toBe('done');
    expect(await tizenSetScreenSaver(withEnums.api, true)).toBe('done');
    expect(withEnums.states).toEqual([10, 11]);
    const bare = appcommon({ kind: 'success' }, false);
    await tizenSetScreenSaver(bare.api, false);
    await tizenSetScreenSaver(bare.api, true);
    expect(bare.states).toEqual([0, 1]);
  });

  it('is unsupported without webapis.appcommon (a desktop browser)', async () => {
    expect(await tizenSetScreenSaver(undefined, false)).toBe('unsupported');
    expect(await tizenSetScreenSaver({ appcommon: {} }, false)).toBe('unsupported');
  });

  it("rejects with the TV's error, a throw, or no answer", async () => {
    await expect(tizenSetScreenSaver(appcommon({ kind: 'error', error: { name: 'UnknownError', code: 0, message: 'busy' } }).api, false)).rejects.toThrow(
      'setScreenSaver failed: UnknownError, code 0, busy',
    );
    await expect(tizenSetScreenSaver(appcommon({ kind: 'error', error: {} }).api, false)).rejects.toThrow('setScreenSaver failed: no details');
    await expect(tizenSetScreenSaver(appcommon({ kind: 'throw' }).api, false)).rejects.toThrow('setScreenSaver threw: TypeMismatchError, bad state');
    vi.useFakeTimers();
    const silent = tizenSetScreenSaver(appcommon({ kind: 'silent' }).api, false, 3000);
    const settled = expect(silent).rejects.toThrow('setScreenSaver did not call back within 3000 ms');
    await vi.advanceTimersByTimeAsync(2999);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
  });

  it('answers once, whatever the TV calls after', async () => {
    const api: TvSettingsApi = {
      appcommon: {
        setScreenSaver: (_state, onsuccess, onerror) => {
          onsuccess?.();
          onerror?.({ message: 'late' });
        },
      },
    };
    expect(await tizenSetScreenSaver(api, false)).toBe('done');
  });
});

describe('Voice Guide on Tizen', () => {
  it('reads both answers the docs give (1/0 and "true"), and nothing else', () => {
    for (const on of [1, true, '1', 'true', 'ON']) expect(voiceGuideOn(on)).toBe(true);
    for (const off of [0, false, '0', 'false', 'OFF']) expect(voiceGuideOn(off)).toBe(false);
    for (const unknown of [2, 'on', null, undefined, {}]) expect(voiceGuideOn(unknown)).toBeNull();
  });

  it("asks for VOICE_GUIDE_KEY (Samsung's constant, else 15) and records the raw answer", () => {
    const keys: number[] = [];
    const tvinfo = (raw: unknown, key?: number): TvSettingsApi => ({
      tvinfo: {
        ...(key === undefined ? {} : { TvInfoMenuKey: { VOICE_GUIDE_KEY: key } }),
        getMenuValue: (k) => {
          keys.push(k);
          return raw;
        },
      },
    });
    expect(tizenScreenReader(tvinfo(1, 99))).toEqual({ on: true, detail: 'getMenuValue(VOICE_GUIDE_KEY) = 1 (number)' });
    expect(tizenScreenReader(tvinfo('false'))).toEqual({ on: false, detail: 'getMenuValue(VOICE_GUIDE_KEY) = false (string)' });
    expect(keys).toEqual([99, 15]);
    expect(tizenScreenReader(undefined)).toEqual({ on: null, detail: 'no webapis.tvinfo' });
    const throwing: TvSettingsApi = {
      tvinfo: {
        getMenuValue: () => {
          throw Object.assign(new Error('denied'), { name: 'SecurityError' });
        },
      },
    };
    expect(tizenScreenReader(throwing)).toEqual({ on: null, detail: 'getMenuValue(VOICE_GUIDE_KEY) threw: SecurityError, denied' });
  });

  it('is what the adapter uses; Tizen web apps have no speech API', async () => {
    vi.stubGlobal('window', { webapis: { ...appcommon({ kind: 'success' }).api, tvinfo: { getMenuValue: () => 0 } } });
    const platform = createTizenPlatform();
    expect(await platform.setScreenSaver(false)).toBe('done');
    expect(await platform.screenReader()).toEqual({ on: false, detail: 'getMenuValue(VOICE_GUIDE_KEY) = 0 (number)' });
    expect(await platform.speak('x')).toBe('unsupported');
    vi.stubGlobal('window', {});
    expect(await platform.setScreenSaver(false)).toBe('unsupported');
  });
});
