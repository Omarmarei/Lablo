import type { LifecycleEvent } from '@zoma/platform-api';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserEnv } from './index';
import { browserKeyToIntent, createBrowserPlatform } from './index';

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
  ])('%j -> %s', (k, intent) => {
    expect(browserKeyToIntent(key(k))).toBe(intent);
  });

  it.each(['a', 'F5', 'Tab', 'Shift', 'constructor', '__proto__'])('ignores %j', (k) => {
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

  it('routes exitApp to the injected handler', () => {
    const onExit = vi.fn();
    createBrowserPlatform(fakeEnv({ onExit })).exitApp();
    expect(onExit).toHaveBeenCalledOnce();
  });
});
