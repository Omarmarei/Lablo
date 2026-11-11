import type { LifecycleEvent } from '@lablo/platform-api';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserEnv } from './index';
import { browserKeyToIntent, browserTextKey, createBrowserPlatform } from './index';

const key = (k: string, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}) => ({
  keyCode: 0,
  key: k,
  ...mods,
});

describe('browserKeyToIntent (keyboard as remote, architecture.md §4)', () => {
  it.each([
    ['ArrowUp', 'UP'],
    ['ArrowDown', 'DOWN'],
    ['ArrowLeft', 'LEFT'],
    ['ArrowRight', 'RIGHT'],
    ['Enter', 'OK'],
    ['Escape', 'BACK'],
    ['Backspace', 'BACK'],
    ['PageUp', 'CH_UP'],
    ['PageDown', 'CH_DOWN'],
    ['0', 'DIGIT_0'],
    ['7', 'DIGIT_7'],
    ['9', 'DIGIT_9'],
    ['F1', 'RED'],
    ['F2', 'GREEN'],
    ['F3', 'YELLOW'],
    ['F4', 'BLUE'],
    [' ', 'PLAY_PAUSE'],
    ['i', 'INFO'],
    ['I', 'INFO'],
    ['g', 'GUIDE'],
    ['s', 'STOP'],
    ['f', 'FF'],
    ['r', 'RW'],
    ['p', 'PREV_CH'],
    ['a', 'AUDIO'],
    ['c', 'SUBTITLES'],
  ])('%j -> %s', (k, intent) => {
    expect(browserKeyToIntent(key(k))).toBe(intent);
  });

  it.each(['q', 'F5', 'Tab', 'Shift', 'constructor', '__proto__'])('ignores %j', (k) => {
    expect(browserKeyToIntent(key(k))).toBeNull();
  });

  it('leaves browser shortcuts alone', () => {
    expect(browserKeyToIntent(key('r', { ctrlKey: true }))).toBeNull();
    expect(browserKeyToIntent(key('ArrowLeft', { altKey: true }))).toBeNull();
    expect(browserKeyToIntent(key('1', { metaKey: true }))).toBeNull();
  });

  it('ignores events without a key value', () => {
    expect(browserKeyToIntent({ keyCode: 38 })).toBeNull();
  });
});

function fakeEnv(overrides: Partial<BrowserEnv> = {}): BrowserEnv & { doc: EventTarget & { hidden: boolean } } {
  const doc = Object.assign(new EventTarget(), { hidden: false });
  return {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    language: 'en-GB',
    search: '',
    document: doc,
    onExit: () => undefined,
    ...overrides,
    doc,
  };
}

describe('createBrowserPlatform', () => {
  it('reports fake desktop device info', async () => {
    const info = await createBrowserPlatform(fakeEnv()).info();
    expect(info).toEqual({
      platform: 'browser',
      model: 'Desktop browser',
      modelYear: null,
      osVersion: 'n/a',
      firmware: 'n/a',
      chromiumVersion: 141,
      tier: 'full',
      locale: 'en-GB',
      country: null,
    });
  });

  it('applies the tier, locale and country URL overrides', async () => {
    const info = await createBrowserPlatform(fakeEnv({ search: '?tier=low&locale=ar-SA&country=SA' })).info();
    expect(info).toMatchObject({ tier: 'low', locale: 'ar-SA', country: 'SA' });
  });

  it('turns visibility changes into lifecycle events until unsubscribed', () => {
    const env = fakeEnv();
    const events: LifecycleEvent[] = [];
    const off = createBrowserPlatform(env).onLifecycle((e) => events.push(e));
    env.doc.hidden = true;
    env.doc.dispatchEvent(new Event('visibilitychange'));
    env.doc.hidden = false;
    env.doc.dispatchEvent(new Event('visibilitychange'));
    off();
    env.doc.dispatchEvent(new Event('visibilitychange'));
    expect(events).toEqual(['hidden', 'visible']);
  });

  it('has no pointer events of its own (a mouse shows itself by moving)', () => {
    const listener = vi.fn();
    const off = createBrowserPlatform(fakeEnv()).onPointer(listener);
    expect(off()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('has no soft keyboard (the desktop types on a real one)', () => {
    const listener = vi.fn();
    const off = createBrowserPlatform(fakeEnv()).onSoftKeyboard(listener);
    expect(off()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('has no screensaver, screen reader setting or TV speech (RELAY step 15b2)', async () => {
    const platform = createBrowserPlatform(fakeEnv());
    expect(await platform.setScreenSaver(false)).toBe('unsupported');
    expect(await platform.screenReader()).toEqual({ on: null, detail: 'a desktop browser has no screen reader setting' });
    expect(await platform.speak('x')).toBe('unsupported');
  });

  it('has no device ID (deviceSecret)', async () => {
    expect(await createBrowserPlatform(fakeEnv()).deviceSecret()).toBeNull();
    // Nor keys to register (spike S10).
    expect(createBrowserPlatform(fakeEnv()).registerKeys()).toEqual({ skipped: 'a desktop keyboard delivers every key', supported: null, registered: [], unsupported: [], refused: [] });
  });

  it('routes exitApp to the injected handler', () => {
    const onExit = vi.fn();
    createBrowserPlatform(fakeEnv({ onExit })).exitApp();
    expect(onExit).toHaveBeenCalledOnce();
  });
});

describe('browserTextKey (a text field being edited, RELAY step 13a)', () => {
  it.each([
    ['Enter', 'done'],
    ['Escape', 'close'],
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
  ] as const)('%s ends the edit as %s', (k, textKey) => {
    expect(browserTextKey(key(k))).toBe(textKey);
    expect(createBrowserPlatform(fakeEnv()).textKey(key(k))).toBe(textKey);
  });

  it.each(['Backspace', 'ArrowLeft', 'ArrowRight', 'a', 'ض', '1', ' ', 'Home', 'Delete'])('leaves %j to the field', (k) => {
    expect(browserTextKey(key(k))).toBeNull();
  });

  it('Backspace deletes in a field although it is Back elsewhere', () => {
    expect(browserKeyToIntent(key('Backspace'))).toBe('BACK');
    expect(browserTextKey(key('Backspace'))).toBeNull();
  });

  it('leaves shortcuts (Ctrl+Enter, Alt+ArrowUp) and key-less events alone', () => {
    expect(browserTextKey(key('Enter', { ctrlKey: true }))).toBeNull();
    expect(browserTextKey(key('ArrowUp', { altKey: true }))).toBeNull();
    expect(browserTextKey(key('Escape', { metaKey: true }))).toBeNull();
    expect(browserTextKey({ keyCode: 13 })).toBeNull();
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
  it('gives one Html5Engine on a <video> in the stage; desktop Chromium has no audioTracks unless flagged', () => {
    const { stage, made } = fakeStage();
    const engines = createBrowserPlatform(fakeEnv()).createEngines(stage);
    expect(engines.map((e) => e.kind)).toEqual(['html5']);
    expect(made.map((el) => el.tag)).toEqual(['video']);
    expect(engines[0]!.caps.trackSwitch).toBe('none');
  });
});
