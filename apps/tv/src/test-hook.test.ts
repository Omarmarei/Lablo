import { describe, expect, it } from 'vitest';
import { createFocusDemo } from './focus-demo';
import type { TestHookTarget } from './test-hook';
import { focusPath, installTestHook } from './test-hook';

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
