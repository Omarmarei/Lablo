import { signal } from '@preact/signals';
import type { ConfigResult } from '@lablo/data';
import { noPolicy } from '@lablo/data/client';
import { describe, expect, it } from 'vitest';
import { createFocusDemo } from './focus-demo';
import type { ConfigHookSource, TestHookTarget } from './test-hook';
import { configView, focusPath, installTestHook } from './test-hook';

function demo() {
  return createFocusDemo({ rootBackPolicy: () => 'exit-dialog', exitApp: () => undefined });
}

describe('window.__LABLO_TEST__', () => {
  it('writes a focus as screen/zone/index', () => {
    expect(focusPath({ screen: 'live', zone: 'channels', index: 3 })).toBe('live/channels/3');
    expect(focusPath({ screen: 'exit', zone: 'buttons', index: 0 })).toBe('exit/buttons/0');
    // An empty zone has no item.
    expect(focusPath({ screen: 'live', zone: 'channels', index: -1 })).toBe('live/channels/-1');
  });

  it('reads the focus from the navigator of the screen on show, as it moves', () => {
    const target: TestHookTarget = {};
    const show = installTestHook(target);
    const hook = target.__LABLO_TEST__;
    expect(hook).toBeDefined();
    // Nothing on show yet (the start still reads the profile).
    expect(hook?.focusPath()).toBeNull();
    const first = demo();
    show(first.nav);
    expect(hook?.focusPath()).toBe('home/list/0');
    // The engine's focus, read when asked: no render in between.
    first.nav.handle('DOWN');
    first.nav.handle('DOWN');
    expect(hook?.focusPath()).toBe('home/list/2');
    first.nav.handle('OK');
    expect(hook?.focusPath()).toBe('details/buttons/0');
  });

  it('follows the screen that shows next, and nothing once none does', () => {
    const target: TestHookTarget = {};
    const show = installTestHook(target);
    const first = demo();
    const second = demo();
    show(first.nav);
    first.nav.handle('UP');
    expect(target.__LABLO_TEST__?.focusPath()).toBe('home/rail/0');
    show(second.nav);
    // The new screen's own focus, not the one left behind.
    expect(target.__LABLO_TEST__?.focusPath()).toBe('home/list/0');
    first.nav.handle('DOWN');
    expect(target.__LABLO_TEST__?.focusPath()).toBe('home/list/0');
    show(null);
    expect(target.__LABLO_TEST__?.focusPath()).toBeNull();
  });
});

const MESSAGE = { en: 'Read this', ar: 'Arabic text' };

function answer(fields: Partial<ConfigResult> = {}): ConfigResult {
  return {
    status: 'fresh',
    policy: {
      ...noPolicy(),
      kill: { id: 'stop-play', mode: 'disable-playback', message: MESSAGE },
      notices: [
        { id: 'n-one', mode: 'notice', message: MESSAGE },
        { id: 'n-two', mode: 'notice', message: null },
      ],
      updateRequired: true,
      minVersion: '9.0.0',
    },
    issuedAt: 1_000,
    expiresAt: 2_000,
    failure: null,
    stored: true,
    ...fields,
  };
}

describe('the config in the test hook (step 30c1)', () => {
  it('shows an answer as plain data: the rules by id, no texts', () => {
    expect(configView(null)).toBeNull();
    const view = configView(answer());
    expect(view).toEqual({
      status: 'fresh',
      failure: null,
      issuedAt: 1_000,
      kill: { id: 'stop-play', mode: 'disable-playback' },
      notices: ['n-one', 'n-two'],
      updateRequired: true,
    });
    // It survives the trip out of the page.
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(configView({ status: 'cached', policy: noPolicy(), issuedAt: 5, expiresAt: 6, failure: 'timeout', stored: true })).toEqual({
      status: 'cached',
      failure: 'timeout',
      issuedAt: 5,
      kill: null,
      notices: [],
      updateRequired: false,
    });
  });

  it("reads the schedule's last answer when asked, and refreshes through it", async () => {
    const last = signal<ConfigResult | null>(null);
    const asked: number[] = [];
    const source: ConfigHookSource = {
      last,
      refreshNow: () => {
        asked.push(1);
        last.value = answer({ issuedAt: 3_000 });
        return Promise.resolve(last.value);
      },
    };
    const target: TestHookTarget = {};
    installTestHook(target, source);
    const hook = target.__LABLO_TEST__!;
    expect(hook.config()).toBeNull();
    last.value = answer({ status: 'cached', failure: 'network' });
    expect(hook.config()?.status).toBe('cached');
    expect(hook.config()?.failure).toBe('network');
    await expect(hook.refreshConfig()).resolves.toMatchObject({ status: 'fresh', issuedAt: 3_000 });
    expect(asked).toEqual([1]);
    expect(hook.config()?.issuedAt).toBe(3_000);
    // A run whose worker died answers null.
    installTestHook(target, { last, refreshNow: () => Promise.resolve(null) });
    await expect(target.__LABLO_TEST__!.refreshConfig()).resolves.toBeNull();
  });

  it('has no config on the developer screens (no schedule)', async () => {
    const target: TestHookTarget = {};
    installTestHook(target);
    expect(target.__LABLO_TEST__?.config()).toBeNull();
    await expect(target.__LABLO_TEST__?.refreshConfig()).resolves.toBeNull();
  });
});
