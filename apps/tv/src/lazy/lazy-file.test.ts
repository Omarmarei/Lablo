import type { Navigator } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SchedulerTimers } from '../data/refresh-scheduler';
import { LOADING_RETRY, LOADING_SCREEN, LOAD_LIMIT_MS, SPINNER_AFTER_MS, createLazyFile } from './lazy-file';

function manualTimers() {
  let now = 0;
  let seq = 0;
  const queue: { id: number; at: number; run: () => void }[] = [];
  const timers: SchedulerTimers = {
    set: (run, ms) => {
      seq += 1;
      queue.push({ id: seq, at: now + ms, run });
      return seq;
    },
    clear: (handle) => {
      const i = queue.findIndex((t) => t.id === handle);
      if (i !== -1) queue.splice(i, 1);
    },
  };
  return {
    timers,
    pending: () => queue.length,
    advance(ms: number): void {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at || a.id - b.id);
        const next = queue[0];
        if (next === undefined || next.at > end) break;
        queue.shift();
        now = next.at;
        next.run();
      }
      now = end;
    },
  };
}

interface Loads {
  /** How many times the file was asked for. */
  count: number;
  resolve(value: string): void;
  reject(error: unknown): void;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const path = (nav: Navigator): string => {
  const focus = nav.snapshot();
  return `${focus.screen}/${focus.zone}/${focus.index}`;
};

function setup() {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 6 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  nav.top.focus('header', 5);
  const clock = manualTimers();
  let settle: { resolve(value: string): void; reject(error: unknown): void } | null = null;
  const loads: Loads = {
    count: 0,
    resolve: (value) => settle?.resolve(value),
    reject: (error) => settle?.reject(error),
  };
  const file = createLazyFile<string>({
    nav,
    timers: clock.timers,
    load: () => {
      loads.count += 1;
      return new Promise<string>((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
  });
  const opened: string[] = [];
  /** What `use` opens: a screen of its own, named after the value. */
  const open = (value: string): void => {
    opened.push(value);
    nav.push({ id: `opened-${value}`, zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 3 }] });
  };
  return { nav, clock, loads, file, opened, open };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a file loaded on first use (RELAY step 35e)', () => {
  it('shows nothing new while it loads quickly, then opens what was asked over the screen it came from', async () => {
    const { nav, clock, loads, file, opened, open } = setup();
    file.use(open);
    expect(path(nav)).toBe(`${LOADING_SCREEN}/${LOADING_RETRY}/-1`);
    expect(file.phase.value).toBe('quiet');
    expect(file.under.value).toMatchObject({ screen: 'live', zone: 'header', index: 5 });
    expect(file.loaded.value).toBeNull();
    expect(loads.count).toBe(1);
    clock.advance(SPINNER_AFTER_MS - 1);
    expect(file.phase.value).toBe('quiet');
    loads.resolve('settings');
    await flush();
    expect(opened).toEqual(['settings']);
    expect(path(nav)).toBe('opened-settings/items/0');
    expect(file.loaded.value).toBe('settings');
    // The loading screen is gone: Back from what opened returns to where it was asked.
    nav.back();
    expect(path(nav)).toBe('live/header/5');
    // No timer is left behind.
    expect(clock.pending()).toBe(0);
    expect(file.phase.value).toBe('quiet');
  });

  it('shows a spinner after a short wait, then opens', async () => {
    const { nav, clock, loads, file, opened, open } = setup();
    file.use(open);
    clock.advance(SPINNER_AFTER_MS);
    expect(file.phase.value).toBe('spinner');
    expect(path(nav)).toBe(`${LOADING_SCREEN}/${LOADING_RETRY}/-1`);
    loads.resolve('settings');
    await flush();
    expect(opened).toEqual(['settings']);
    expect(clock.pending()).toBe(0);
  });

  it('opens at once, with no loading screen, once it has loaded', async () => {
    const { nav, loads, file, opened, open } = setup();
    file.use(open);
    loads.resolve('settings');
    await flush();
    nav.back();
    file.use(open);
    expect(opened).toEqual(['settings', 'settings']);
    expect(path(nav)).toBe('opened-settings/items/0');
    expect(loads.count).toBe(1);
  });

  it('says a failed load, with OK on "Try again" asking for the file again', async () => {
    const { nav, clock, loads, file, opened, open } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    file.use(open);
    loads.reject(new Error('settings.js did not load'));
    await flush();
    expect(file.phase.value).toBe('failed');
    expect(path(nav)).toBe(`${LOADING_SCREEN}/${LOADING_RETRY}/0`);
    expect(clock.pending()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    // OK: the file again, quietly first.
    nav.handle('OK');
    expect(file.phase.value).toBe('quiet');
    expect(path(nav)).toBe(`${LOADING_SCREEN}/${LOADING_RETRY}/-1`);
    expect(loads.count).toBe(2);
    clock.advance(SPINNER_AFTER_MS);
    expect(file.phase.value).toBe('spinner');
    loads.resolve('settings');
    await flush();
    expect(opened).toEqual(['settings']);
    nav.back();
    expect(path(nav)).toBe('live/header/5');
  });

  it('takes OK only on the failure', async () => {
    const { nav, clock, loads, file, open } = setup();
    file.use(open);
    nav.handle('OK');
    clock.advance(SPINNER_AFTER_MS);
    nav.handle('OK');
    expect(loads.count).toBe(1);
    expect(file.phase.value).toBe('spinner');
  });

  it('gives up after the time limit, keeps a value that comes later, and opens it on "Try again" with no second load', async () => {
    const { nav, clock, loads, file, opened, open } = setup();
    file.use(open);
    clock.advance(LOAD_LIMIT_MS - 1);
    expect(file.phase.value).toBe('spinner');
    clock.advance(1);
    expect(file.phase.value).toBe('failed');
    expect(path(nav)).toBe(`${LOADING_SCREEN}/${LOADING_RETRY}/0`);
    loads.resolve('late');
    await flush();
    // Nothing opens over the failure by itself.
    expect(opened).toEqual([]);
    expect(file.phase.value).toBe('failed');
    expect(file.loaded.value).toBe('late');
    nav.handle('OK');
    await flush();
    expect(opened).toEqual(['late']);
    expect(loads.count).toBe(1);
  });

  it('waits for the same load when "Try again" comes before a slow one ends', async () => {
    const { clock, loads, file, opened, open, nav } = setup();
    file.use(open);
    clock.advance(LOAD_LIMIT_MS);
    nav.handle('OK');
    expect(loads.count).toBe(1);
    loads.resolve('settings');
    await flush();
    expect(opened).toEqual(['settings']);
  });

  it('opens nothing after Back, and keeps what comes for the next time', async () => {
    const { nav, clock, loads, file, opened, open } = setup();
    file.use(open);
    clock.advance(100);
    nav.back();
    expect(path(nav)).toBe('live/header/5');
    clock.advance(SPINNER_AFTER_MS);
    expect(file.phase.value).toBe('quiet');
    loads.resolve('settings');
    await flush();
    expect(opened).toEqual([]);
    expect(path(nav)).toBe('live/header/5');
    expect(file.loaded.value).toBe('settings');
    expect(clock.pending()).toBe(0);
    file.use(open);
    expect(opened).toEqual(['settings']);
    expect(loads.count).toBe(1);
  });

  it('starts again after Back while it loads: the same load, a new loading screen over the screen on show', async () => {
    const { nav, clock, loads, file, opened, open } = setup();
    file.use(open);
    clock.advance(SPINNER_AFTER_MS);
    nav.back();
    nav.top.focus('header', 2);
    file.use(open);
    expect(file.phase.value).toBe('quiet');
    expect(file.under.value).toMatchObject({ screen: 'live', zone: 'header', index: 2 });
    expect(loads.count).toBe(1);
    loads.resolve('settings');
    await flush();
    expect(opened).toEqual(['settings']);
  });

  it('closes on Back after a failure', async () => {
    const { nav, loads, file, open } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    file.use(open);
    loads.reject(new Error('no'));
    await flush();
    nav.back();
    expect(path(nav)).toBe('live/header/5');
  });

  it('runs only the last use asked while it loads, on one load and one loading screen', async () => {
    const { nav, clock, loads, file, opened, open } = setup();
    const other = (value: string): void => {
      opened.push(`other ${value}`);
    };
    file.use(open);
    clock.advance(200);
    file.use(other);
    // (The spinner keeps the first use's time.)
    clock.advance(100);
    expect(file.phase.value).toBe('spinner');
    loads.resolve('settings');
    await flush();
    expect(opened).toEqual(['other settings']);
    expect(loads.count).toBe(1);
    expect(path(nav)).toBe('live/header/5');
  });

  it('says a load that throws at once as a failure', async () => {
    const nav = createNavigator({
      root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 6 }] },
      rootBack: 'exit-dialog',
      exit: () => undefined,
      exitDialog: () => undefined,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const file = createLazyFile<string>({
      nav,
      timers: manualTimers().timers,
      load: () => {
        throw new Error('no import()');
      },
    });
    file.use(() => undefined);
    await flush();
    expect(file.phase.value).toBe('failed');
  });
});
