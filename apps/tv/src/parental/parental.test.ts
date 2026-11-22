import type { LockState, UnlockAnswer } from '@lablo/data/client';
import type { Intent, LifecycleEvent } from '@lablo/platform-api';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParentalEngine } from './parental';
import { NO_PIN_SCREEN, PAD_CANCEL, PAD_CELLS, PAD_DELETE, PAD_ZERO, PIN_PAD, PIN_SCREEN, cellDigit, createParental, padStep } from './parental';

/**
 * Parental control in main.js (RELAY step 38b): the rails' entry, the PIN pad by the number keys
 * and by the grid, its answers, and the end of an unlocked session when the app is hidden.
 */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

interface Held<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

class FakeEngine implements ParentalEngine {
  state: LockState = { pin: true, unlocked: false, kinds: ['live'] };
  /** The PIN the worker takes; `wrong` after it until `waitAfter` wrong ones, then `wait`. */
  pin = '1234';
  answer: ((pin: string) => UnlockAnswer) | null = null;
  readonly pins: string[] = [];
  relocks = 0;
  failUnlock = false;
  failState = false;
  holdUnlock = false;
  readonly held: Held<UnlockAnswer>[] = [];

  lockState(): Promise<LockState> {
    return this.failState ? Promise.reject(new Error('worker gone')) : Promise.resolve({ ...this.state, kinds: this.state.kinds.slice() });
  }

  unlock(pin: string): Promise<UnlockAnswer> {
    this.pins.push(pin);
    if (this.holdUnlock) return new Promise((resolve, reject) => this.held.push({ resolve, reject }));
    if (this.failUnlock) return Promise.reject(new Error('worker gone'));
    if (this.answer !== null) return Promise.resolve(this.answer(pin));
    if (pin !== this.pin) return Promise.resolve({ result: 'wrong', waitMs: 0 });
    this.state = { ...this.state, unlocked: true };
    return Promise.resolve({ result: 'ok', waitMs: 0 });
  }

  /** The PINs `checkPin` was asked about (the session left as it is). */
  readonly checks: string[] = [];
  /** The PINs `setPin` kept; `refuseSet` answers `false`, `failSet` rejects, `holdSet` waits. */
  readonly kept: string[] = [];
  refuseSet = false;
  failSet = false;
  holdSet = false;
  readonly heldSets: Held<boolean>[] = [];

  checkPin(pin: string): Promise<UnlockAnswer> {
    this.checks.push(pin);
    if (this.answer !== null) return Promise.resolve(this.answer(pin));
    return Promise.resolve({ result: pin === this.pin ? 'ok' : 'wrong', waitMs: 0 });
  }

  setPin(pin: string): Promise<boolean> {
    if (this.holdSet) return new Promise((resolve, reject) => this.heldSets.push({ resolve, reject }));
    if (this.failSet) return Promise.reject(new Error('worker gone'));
    if (this.refuseSet) return Promise.resolve(false);
    this.kept.push(pin);
    this.pin = pin;
    return Promise.resolve(true);
  }

  relock(): Promise<void> {
    this.relocks += 1;
    this.state = { ...this.state, unlocked: false };
    return Promise.resolve();
  }
}

function setup(options: { dir?: 'ltr' | 'rtl'; engine?: FakeEngine } = {}) {
  const engine = options.engine ?? new FakeEngine();
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'rail', axis: 'vertical', count: 5 }] },
    dir: options.dir ?? 'ltr',
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  let now = 1_000;
  const listeners: ((event: LifecycleEvent) => void)[] = [];
  const lifecycle = (listener: (event: LifecycleEvent) => void): (() => void) => {
    listeners.push(listener);
    return () => listeners.splice(listeners.indexOf(listener), 1);
  };
  const changed = vi.fn();
  const restart = vi.fn();
  const parental = createParental({ nav, engine, lifecycle, changed, restart, now: () => now });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const emit = async (event: LifecycleEvent): Promise<void> => {
    for (const listener of listeners.slice()) listener(event);
    await flush();
  };
  /** Opens the pad from the rail. */
  const open = async (): Promise<void> => {
    parental.toggle();
    await flush();
  };
  return {
    engine,
    nav,
    parental,
    changed,
    restart,
    at,
    press,
    emit,
    open,
    listeners,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the pad (RELAY step 38b)', () => {
  it('numbers its cells 1–9, then Delete, 0 and Cancel, and steps LEFT and RIGHT left to right in a row', () => {
    expect([0, 1, 8, PAD_DELETE, PAD_ZERO, PAD_CANCEL].map(cellDigit)).toEqual([1, 2, 9, -1, 0, -1]);
    expect(PAD_CELLS).toBe(12);
    expect(padStep(4, 'LEFT')).toBe(3);
    expect(padStep(4, 'RIGHT')).toBe(5);
    expect(padStep(3, 'LEFT')).toBe(3);
    expect(padStep(5, 'RIGHT')).toBe(5);
    expect(padStep(PAD_ZERO, 'LEFT')).toBe(PAD_DELETE);
  });

  it('opens from the rail with a PIN set, on its first cell, and unlocks with the number keys', async () => {
    const t = setup();
    await t.open();
    expect(t.at()).toBe(`${PIN_SCREEN} · ${PIN_PAD} 0`);
    expect(t.parental.pad.value).toEqual({ purpose: 'rail', typed: 0, problem: null, busy: false });
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3');
    expect(t.parental.pad.value!.typed).toBe(3);
    expect(t.engine.pins).toEqual([]);
    await t.press('DIGIT_4');
    expect(t.engine.pins).toEqual(['1234']);
    expect(t.parental.pad.value).toBeNull();
    expect(t.at()).toBe('live · rail 0');
    expect(t.changed).toHaveBeenCalledWith(true);
    expect(t.changed).toHaveBeenCalledTimes(1);
  });

  it('takes the digits by the grid too: the arrows and OK, Delete taking the last one back', async () => {
    const t = setup();
    await t.open();
    // 1, then 5 (DOWN, RIGHT), then Delete; then 9, 0 and 8.
    await t.press('OK', 'DOWN', 'RIGHT', 'OK');
    expect(t.parental.pad.value!.typed).toBe(2);
    await t.press('DOWN', 'DOWN', 'LEFT', 'OK');
    expect(t.at()).toBe(`${PIN_SCREEN} · ${PIN_PAD} ${PAD_DELETE}`);
    expect(t.parental.pad.value!.typed).toBe(1);
    await t.press('UP', 'RIGHT', 'RIGHT', 'OK', 'DOWN', 'LEFT', 'OK', 'UP', 'OK');
    expect(t.engine.pins).toEqual(['1908']);
    expect(t.parental.pad.value).toEqual({ purpose: 'rail', typed: 0, problem: 'wrong', busy: false });
  });

  it('keeps LEFT and RIGHT left to right in Arabic', async () => {
    const t = setup({ dir: 'rtl' });
    await t.open();
    await t.press('RIGHT');
    expect(t.at()).toBe(`${PIN_SCREEN} · ${PIN_PAD} 1`);
    await t.press('RIGHT', 'RIGHT');
    expect(t.at()).toBe(`${PIN_SCREEN} · ${PIN_PAD} 2`);
    await t.press('LEFT');
    expect(t.at()).toBe(`${PIN_SCREEN} · ${PIN_PAD} 1`);
  });

  it('clears the boxes on a wrong PIN and says so; the next digit takes the word away', async () => {
    const t = setup();
    await t.open();
    await t.press('DIGIT_9', 'DIGIT_9', 'DIGIT_9', 'DIGIT_9');
    expect(t.parental.pad.value).toEqual({ purpose: 'rail', typed: 0, problem: 'wrong', busy: false });
    await t.press('DIGIT_1');
    expect(t.parental.pad.value).toEqual({ purpose: 'rail', typed: 1, problem: null, busy: false });
    expect(t.changed).not.toHaveBeenCalled();
  });

  it('asks the worker once for four digits: digits, Delete and a fifth key wait while it checks', async () => {
    const t = setup();
    t.engine.holdUnlock = true;
    await t.open();
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.parental.pad.value!.busy).toBe(true);
    expect(t.parental.pending.value).toBe(1);
    await t.press('DIGIT_5');
    t.nav.top.focus(PIN_PAD, PAD_DELETE);
    await t.press('OK');
    expect(t.engine.pins).toEqual(['1234']);
    expect(t.parental.pad.value!.typed).toBe(4);
    t.engine.held[0]!.resolve({ result: 'ok', waitMs: 0 });
    await flush();
    expect(t.parental.pad.value).toBeNull();
    expect(t.parental.pending.value).toBe(0);
  });

  it('waits after too many wrong ones: no digit counts until the worker’s wait is over', async () => {
    const t = setup();
    t.engine.answer = () => ({ result: 'wait', waitMs: 60_000 });
    await t.open();
    await t.press('DIGIT_1', 'DIGIT_1', 'DIGIT_1', 'DIGIT_1');
    expect(t.parental.pad.value).toEqual({ purpose: 'rail', typed: 0, problem: 'wait', busy: false });
    await t.press('DIGIT_2');
    expect(t.parental.pad.value!.typed).toBe(0);
    t.advance(59_999);
    await t.press('DIGIT_2');
    expect(t.parental.pad.value!.typed).toBe(0);
    // Closed and opened again inside the wait: it still says so.
    await t.press('BACK');
    await t.open();
    expect(t.parental.pad.value!.problem).toBe('wait');
    t.advance(1);
    t.engine.answer = null;
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.parental.pad.value).toBeNull();
    expect(t.engine.pins).toEqual(['1111', '1234']);
  });

  it('says it couldn’t check the PIN when the worker fails, and lets the user try again', async () => {
    const t = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.engine.failUnlock = true;
    await t.open();
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.parental.pad.value).toEqual({ purpose: 'rail', typed: 0, problem: 'failed', busy: false });
    t.engine.failUnlock = false;
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.parental.pad.value).toBeNull();
  });

  it('closes on Back and on Cancel without asking the worker or reading anything again', async () => {
    const t = setup();
    await t.open();
    await t.press('DIGIT_1', 'BACK');
    expect(t.at()).toBe('live · rail 0');
    expect(t.parental.pad.value).toBeNull();
    await t.open();
    expect(t.parental.pad.value!.typed).toBe(0);
    t.nav.top.focus(PIN_PAD, PAD_CANCEL);
    await t.press('OK');
    expect(t.at()).toBe('live · rail 0');
    expect(t.engine.pins).toEqual([]);
    expect(t.changed).not.toHaveBeenCalled();
    expect(t.restart).not.toHaveBeenCalled();
  });

  it('drops an answer that comes after the pad closed', async () => {
    const t = setup();
    t.engine.holdUnlock = true;
    await t.open();
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4', 'BACK');
    expect(t.parental.pad.value).toBeNull();
    t.engine.held[0]!.resolve({ result: 'ok', waitMs: 0 });
    await flush();
    expect(t.changed).not.toHaveBeenCalled();
    expect(t.at()).toBe('live · rail 0');
  });

  it('turns to the no-PIN dialog when the PIN went away under the pad (a restore)', async () => {
    const t = setup();
    t.engine.answer = () => ({ result: 'no-pin', waitMs: 0 });
    await t.open();
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.parental.pad.value).toBeNull();
    expect(t.at()).toBe(`${NO_PIN_SCREEN} · buttons 0`);
    await t.press('OK');
    expect(t.at()).toBe('live · rail 0');
  });
});

describe("the rails' entry (RELAY step 38b)", () => {
  it('shows the no-PIN dialog with no PIN; OK or Back closes it', async () => {
    const t = setup();
    t.engine.state = { pin: false, unlocked: false, kinds: ['live'] };
    await t.open();
    expect(t.at()).toBe(`${NO_PIN_SCREEN} · buttons 0`);
    expect(t.parental.pad.value).toBeNull();
    await t.press('OK');
    expect(t.at()).toBe('live · rail 0');
    await t.open();
    await t.press('BACK');
    expect(t.at()).toBe('live · rail 0');
  });

  it('locks an unlocked session again, then the screens read again', async () => {
    const t = setup();
    t.engine.state = { pin: true, unlocked: true, kinds: ['live'] };
    await t.open();
    expect(t.engine.relocks).toBe(1);
    expect(t.changed).toHaveBeenCalledWith(false);
    expect(t.at()).toBe('live · rail 0');
  });

  it('does nothing while the pad is open, nor when the session can’t be read', async () => {
    const t = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await t.open();
    t.parental.toggle();
    await flush();
    expect(t.nav.top.id).toBe(PIN_SCREEN);
    await t.press('BACK');
    t.engine.failState = true;
    await t.open();
    expect(t.at()).toBe('live · rail 0');
    expect(warn).toHaveBeenCalled();
  });

  it('opens one pad for two OKs while the session is read', async () => {
    const t = setup();
    t.parental.toggle();
    t.parental.toggle();
    await flush();
    expect(t.nav.top.id).toBe(PIN_SCREEN);
    await t.press('BACK');
    expect(t.at()).toBe('live · rail 0');
  });
});

describe('the app hidden while unlocked (RELAY step 38b)', () => {
  async function unlocked() {
    const t = setup();
    await t.open();
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    t.changed.mockClear();
    return t;
  }

  it('locks the session when hidden, and asks the PIN over everything when it comes back', async () => {
    const t = await unlocked();
    t.nav.push({ id: 'player', zones: [{ kind: 'list', id: 'seek', axis: 'horizontal', count: 1 }] });
    await t.emit('hidden');
    expect(t.engine.relocks).toBe(1);
    expect(t.nav.top.id).toBe('player');
    await t.emit('visible');
    expect(t.parental.pad.value).toEqual({ purpose: 'return', typed: 0, problem: null, busy: false });
    expect(t.nav.top.id).toBe(PIN_SCREEN);
    // Shown again before the PIN: still one pad, and no second relock.
    await t.emit('hidden');
    expect(t.engine.relocks).toBe(1);
    await t.emit('visible');
    t.nav.pop();
    expect(t.nav.top.id).toBe('player');
  });

  it('holds `visible` for the player until the right PIN, then lets it through and reads everything again', async () => {
    const t = await unlocked();
    const heard: LifecycleEvent[] = [];
    const stop = t.parental.heldLifecycle((event) => heard.push(event));
    await t.emit('hidden');
    await t.emit('visible');
    expect(heard).toEqual(['hidden']);
    await t.press('DIGIT_9', 'DIGIT_9', 'DIGIT_9', 'DIGIT_9');
    expect(heard).toEqual(['hidden']);
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(heard).toEqual(['hidden', 'visible']);
    expect(t.parental.pad.value).toBeNull();
    expect(t.changed).toHaveBeenCalledWith(true);
    // Shown again with no hide since: heard at once.
    await t.emit('visible');
    expect(heard).toEqual(['hidden', 'visible', 'visible']);
    // Unlocked again: the next hide asks again.
    await t.emit('hidden');
    expect(t.engine.relocks).toBe(2);
    stop();
  });

  it('starts the app again on Back or Cancel there, the player still held', async () => {
    const t = await unlocked();
    const heard: LifecycleEvent[] = [];
    t.parental.heldLifecycle((event) => heard.push(event));
    await t.emit('hidden');
    await t.emit('visible');
    await t.press('BACK');
    expect(t.restart).toHaveBeenCalledTimes(1);
    expect(heard).toEqual(['hidden']);
    t.nav.top.focus(PIN_PAD, PAD_CANCEL);
    await t.press('OK');
    expect(t.restart).toHaveBeenCalledTimes(2);
  });

  it('asks nothing after a hide in a locked session, and passes `visible` straight on', async () => {
    const t = setup();
    const heard: LifecycleEvent[] = [];
    t.parental.heldLifecycle((event) => heard.push(event));
    await t.emit('hidden');
    await t.emit('visible');
    expect(heard).toEqual(['hidden', 'visible']);
    expect(t.engine.relocks).toBe(0);
    expect(t.nav.top.id).toBe('live');
    // Locked again from the rail: the same.
    const u = await unlocked();
    await u.open();
    await u.emit('hidden');
    await u.emit('visible');
    expect(u.nav.top.id).toBe('live');
  });

  it('says it couldn’t check the PIN when the PIN went away on the return’s pad', async () => {
    const t = await unlocked();
    await t.emit('hidden');
    await t.emit('visible');
    t.engine.answer = () => ({ result: 'no-pin', waitMs: 0 });
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.parental.pad.value).toEqual({ purpose: 'return', typed: 0, problem: 'failed', busy: false });
  });

  it('stops listening once disposed', async () => {
    const t = await unlocked();
    t.parental.dispose();
    expect(t.listeners).toHaveLength(0);
    t.parental.dispose();
  });
});

describe("Settings' check (RELAY step 38c)", () => {
  it('checks the PIN with the session left as it is, then goes on; the screens read nothing again', async () => {
    const t = setup();
    const done = vi.fn();
    t.parental.ask(done);
    expect(t.at()).toBe(`${PIN_SCREEN} · ${PIN_PAD} 0`);
    expect(t.parental.pad.value).toEqual({ purpose: 'check', typed: 0, problem: null, busy: false });
    await t.press('DIGIT_9', 'DIGIT_9', 'DIGIT_9', 'DIGIT_9');
    expect(t.parental.pad.value).toEqual({ purpose: 'check', typed: 0, problem: 'wrong', busy: false });
    expect(done).not.toHaveBeenCalled();
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.engine.checks).toEqual(['9999', '1234']);
    expect(t.engine.pins).toEqual([]);
    expect(t.parental.pad.value).toBeNull();
    expect(t.at()).toBe('live · rail 0');
    expect(done).toHaveBeenCalledTimes(1);
    expect(t.changed).not.toHaveBeenCalled();
  });

  it('goes on with the pad gone: what goes on can push its own screen', async () => {
    const t = setup();
    t.parental.ask(() => {
      t.nav.push({ id: 'next', zones: [{ kind: 'list', id: 'rows', axis: 'vertical', count: 2 }] });
    });
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.at()).toBe('next · rows 0');
    await t.press('BACK');
    expect(t.at()).toBe('live · rail 0');
  });

  it('closes on Back and Cancel, and nothing goes on; a second ask while open is dropped', async () => {
    const t = setup();
    const done = vi.fn();
    const other = vi.fn();
    t.parental.ask(done);
    t.parental.ask(other);
    await t.press('DIGIT_1', 'BACK');
    expect(t.at()).toBe('live · rail 0');
    t.parental.ask(done);
    expect(t.parental.pad.value!.typed).toBe(0);
    t.nav.top.focus(PIN_PAD, PAD_CANCEL);
    await t.press('OK');
    expect(t.at()).toBe('live · rail 0');
    // Opened from the rail after a cancelled ask: the right PIN unlocks, and the ask's `done` doesn't run.
    await t.open();
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.changed).toHaveBeenCalledWith(true);
    expect(done).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(t.engine.checks).toEqual([]);
  });

  it("holds the worker's wait: no digit counts, and it says so when opened", async () => {
    const t = setup();
    t.engine.answer = () => ({ result: 'wait', waitMs: 60_000 });
    const done = vi.fn();
    t.parental.ask(done);
    await t.press('DIGIT_1', 'DIGIT_1', 'DIGIT_1', 'DIGIT_1');
    expect(t.parental.pad.value).toEqual({ purpose: 'check', typed: 0, problem: 'wait', busy: false });
    await t.press('DIGIT_2', 'BACK');
    t.parental.ask(done);
    expect(t.parental.pad.value).toEqual({ purpose: 'check', typed: 0, problem: 'wait', busy: false });
    await t.press('DIGIT_2');
    expect(t.parental.pad.value!.typed).toBe(0);
    t.advance(60_000);
    t.engine.answer = null;
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('turns to the no-PIN dialog when no PIN is set any more', async () => {
    const t = setup();
    t.engine.answer = () => ({ result: 'no-pin', waitMs: 0 });
    const done = vi.fn();
    t.parental.ask(done);
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.at()).toBe(`${NO_PIN_SCREEN} · buttons 0`);
    expect(done).not.toHaveBeenCalled();
  });

  it("gives way to the return's pad when the app is hidden while unlocked, and what it asked for never goes on", async () => {
    const t = setup();
    await t.open();
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    const done = vi.fn();
    t.parental.ask(done);
    await t.press('DIGIT_1');
    await t.emit('hidden');
    await t.emit('visible');
    expect(t.parental.pad.value).toEqual({ purpose: 'return', typed: 0, problem: null, busy: false });
    expect(t.nav.snapshot().screen).toBe(PIN_SCREEN);
    await t.press('DIGIT_1', 'DIGIT_2', 'DIGIT_3', 'DIGIT_4');
    expect(t.at()).toBe('live · rail 0');
    expect(t.engine.pins).toEqual(['1234', '1234']);
    expect(done).not.toHaveBeenCalled();
  });
});

describe('a new PIN (RELAY step 38c)', () => {
  it('takes it twice, then keeps it and goes on', async () => {
    const t = setup();
    const done = vi.fn();
    t.parental.choose(done);
    expect(t.at()).toBe(`${PIN_SCREEN} · ${PIN_PAD} 0`);
    expect(t.parental.pad.value).toEqual({ purpose: 'set', typed: 0, problem: null, busy: false });
    await t.press('DIGIT_4', 'DIGIT_8', 'DIGIT_2');
    expect(t.parental.pad.value).toEqual({ purpose: 'set', typed: 3, problem: null, busy: false });
    await t.press('DIGIT_0');
    expect(t.parental.pad.value).toEqual({ purpose: 'again', typed: 0, problem: null, busy: false });
    expect(t.engine.kept).toEqual([]);
    await t.press('DIGIT_4', 'DIGIT_8', 'DIGIT_2', 'DIGIT_0');
    expect(t.engine.kept).toEqual(['4820']);
    expect(t.parental.pad.value).toBeNull();
    expect(t.at()).toBe('live · rail 0');
    expect(done).toHaveBeenCalledTimes(1);
    expect(t.engine.pins).toEqual([]);
    expect(t.engine.checks).toEqual([]);
  });

  it('starts again when the second differs, and says so; Delete works in both', async () => {
    const t = setup();
    const done = vi.fn();
    t.parental.choose(done);
    await t.press('DIGIT_1', 'DIGIT_1', 'DIGIT_1', 'DIGIT_1', 'DIGIT_2', 'DIGIT_2', 'DIGIT_2', 'DIGIT_2');
    expect(t.parental.pad.value).toEqual({ purpose: 'set', typed: 0, problem: 'mismatch', busy: false });
    // The first one again doesn't keep 1111: the pair starts over.
    await t.press('DIGIT_1', 'DIGIT_1', 'DIGIT_1', 'DIGIT_1');
    expect(t.parental.pad.value).toEqual({ purpose: 'again', typed: 0, problem: null, busy: false });
    await t.press('DIGIT_1', 'DIGIT_5');
    t.nav.top.focus(PIN_PAD, PAD_DELETE);
    await t.press('OK');
    expect(t.parental.pad.value).toEqual({ purpose: 'again', typed: 1, problem: null, busy: false });
    await t.press('DIGIT_1', 'DIGIT_1', 'DIGIT_1');
    expect(t.engine.kept).toEqual(['1111']);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('pays no heed to a wait, and ends the one it held once kept', async () => {
    const t = setup();
    t.engine.answer = () => ({ result: 'wait', waitMs: 60_000 });
    t.parental.ask(() => undefined);
    // (BACK after the answer: one sent with the digits would close the pad before the wait came.)
    await t.press('DIGIT_1', 'DIGIT_1', 'DIGIT_1', 'DIGIT_1');
    expect(t.parental.pad.value!.problem).toBe('wait');
    await t.press('BACK');
    t.parental.choose(() => undefined);
    expect(t.parental.pad.value).toEqual({ purpose: 'set', typed: 0, problem: null, busy: false });
    await t.press('DIGIT_5', 'DIGIT_5', 'DIGIT_5', 'DIGIT_5');
    expect(t.parental.pad.value!.purpose).toBe('again');
    await t.press('DIGIT_5', 'DIGIT_5', 'DIGIT_5', 'DIGIT_5');
    expect(t.engine.kept).toEqual(['5555']);
    // The wait is over: the next ask takes digits at once.
    t.engine.answer = null;
    t.parental.ask(() => undefined);
    expect(t.parental.pad.value!.problem).toBeNull();
    await t.press('DIGIT_5');
    expect(t.parental.pad.value!.typed).toBe(1);
  });

  it('starts again and says so when the worker refuses it or fails; waits while it keeps it', async () => {
    const t = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const done = vi.fn();
    t.engine.refuseSet = true;
    t.parental.choose(done);
    await t.press('DIGIT_4', 'DIGIT_8', 'DIGIT_2', 'DIGIT_0', 'DIGIT_4', 'DIGIT_8', 'DIGIT_2', 'DIGIT_0');
    expect(t.parental.pad.value).toEqual({ purpose: 'set', typed: 0, problem: 'unsaved', busy: false });
    t.engine.refuseSet = false;
    t.engine.failSet = true;
    await t.press('DIGIT_4', 'DIGIT_8', 'DIGIT_2', 'DIGIT_0', 'DIGIT_4', 'DIGIT_8', 'DIGIT_2', 'DIGIT_0');
    expect(t.parental.pad.value).toEqual({ purpose: 'set', typed: 0, problem: 'unsaved', busy: false });
    t.engine.failSet = false;
    t.engine.holdSet = true;
    await t.press('DIGIT_4', 'DIGIT_8', 'DIGIT_2', 'DIGIT_0', 'DIGIT_4', 'DIGIT_8', 'DIGIT_2', 'DIGIT_0');
    expect(t.parental.pad.value).toEqual({ purpose: 'again', typed: 4, problem: null, busy: true });
    expect(t.parental.pending.value).toBe(1);
    await t.press('DIGIT_1', 'BACK');
    expect(t.parental.pad.value).toBeNull();
    t.engine.heldSets[0]!.resolve(true);
    await flush();
    expect(done).not.toHaveBeenCalled();
    expect(t.parental.pending.value).toBe(0);
  });

  it('closes on Back and Cancel at either step, and nothing is kept', async () => {
    const t = setup();
    const done = vi.fn();
    t.parental.choose(done);
    await t.press('DIGIT_4', 'DIGIT_8', 'DIGIT_2', 'DIGIT_0', 'DIGIT_4', 'BACK');
    expect(t.at()).toBe('live · rail 0');
    t.parental.choose(done);
    expect(t.parental.pad.value!.purpose).toBe('set');
    t.nav.top.focus(PIN_PAD, PAD_CANCEL);
    await t.press('OK');
    expect(t.at()).toBe('live · rail 0');
    expect(t.engine.kept).toEqual([]);
    expect(done).not.toHaveBeenCalled();
    expect(t.restart).not.toHaveBeenCalled();
  });

  it('does nothing once disposed', () => {
    const t = setup();
    t.parental.dispose();
    t.parental.choose(() => undefined);
    t.parental.ask(() => undefined);
    expect(t.parental.pad.value).toBeNull();
    expect(t.at()).toBe('live · rail 0');
  });
});
