import type { RootBackPolicy } from '@zoma/platform-api';
import { describe, expect, it, vi } from 'vitest';
import { createFocusDemo } from './focus-demo';

function demo(rootBack: RootBackPolicy) {
  const exitApp = vi.fn();
  return { exitApp, ...createFocusDemo({ rootBackPolicy: () => rootBack, exitApp }) };
}

describe('the hello screen’s focus demo', () => {
  it('starts on the list, and the signal follows the focus', () => {
    const d = demo('exit-dialog');
    expect(d.focus.value).toMatchObject({ screen: 'home', zone: 'list', index: 0, depth: 1, dir: 'ltr' });
    d.nav.handle('DOWN');
    expect(d.focus.value).toMatchObject({ zone: 'list', index: 1 });
    d.nav.setDir('rtl');
    expect(d.focus.value.dir).toBe('rtl');
  });

  it('opens details on OK, deeper on More, and closes them with Back or Close', () => {
    const d = demo('exit-dialog');
    d.nav.handle('DOWN');
    d.nav.handle('OK');
    expect(d.focus.value).toMatchObject({ screen: 'details', zone: 'buttons', index: 0, depth: 2 });
    expect(d.opened.value).toEqual(['list 2']);
    d.nav.handle('RIGHT');
    d.nav.handle('OK');
    expect(d.focus.value).toMatchObject({ screen: 'details', depth: 3 });
    expect(d.opened.value).toEqual(['list 2', 'list 2 › more']);
    d.nav.handle('BACK');
    expect(d.focus.value).toMatchObject({ screen: 'details', index: 1, depth: 2 });
    d.nav.handle('LEFT');
    d.nav.handle('OK');
    expect(d.focus.value).toMatchObject({ screen: 'home', zone: 'list', index: 1, depth: 1 });
    // A new details screen replaces the closed ones' labels.
    d.nav.handle('UP');
    d.nav.handle('UP');
    d.nav.handle('OK');
    expect(d.opened.value).toEqual(['rail 1']);
    expect(d.exitApp).not.toHaveBeenCalled();
  });

  it('asks before exiting on Back at the root under exit-dialog (Tizen, browser)', () => {
    const d = demo('exit-dialog');
    d.nav.handle('BACK');
    expect(d.focus.value).toMatchObject({ screen: 'exit', index: 0, depth: 2 });
    d.nav.handle('OK');
    expect(d.focus.value).toMatchObject({ screen: 'home', depth: 1 });
    expect(d.exitApp).not.toHaveBeenCalled();
    d.nav.handle('BACK');
    d.nav.handle('BACK');
    expect(d.focus.value.depth).toBe(1);
    expect(d.exitApp).not.toHaveBeenCalled();
    d.nav.handle('BACK');
    d.nav.handle('RIGHT');
    d.nav.handle('OK');
    expect(d.exitApp).toHaveBeenCalledTimes(1);
    expect(d.exitRequested.value).toBe(true);
  });

  it('hands Back at the root to the platform under platform-back (webOS)', () => {
    const d = demo('platform-back');
    d.nav.handle('OK');
    d.nav.handle('BACK');
    expect(d.exitApp).not.toHaveBeenCalled();
    d.nav.handle('BACK');
    expect(d.exitApp).toHaveBeenCalledTimes(1);
    expect(d.exitRequested.value).toBe(true);
    expect(d.focus.value).toMatchObject({ screen: 'home', depth: 1 });
  });
});
