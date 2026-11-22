import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LockState, UnlockAnswer } from '@lablo/data/client';
import type { Intent, LifecycleEvent } from '@lablo/platform-api';
import { DIGIT_INTENTS } from '@lablo/platform-api';
import type { Focus, Navigator, Screen, ZoneSpec } from '@lablo/ui';

/**
 * Parental control in main.js (RELAY step 38b, architecture.md §1.4 item 10 "Built in step 38b"):
 * the PIN pad, the rails' last entry ("Locked groups" / "Lock again") and the end of an unlocked
 * session when the app is hidden. The query worker is the gate (step 38a): it checks the PIN and
 * serves nothing locked while the session is locked; this module only asks it and tells the
 * screens to read again.
 *
 * - **The rails' entry** (`toggle`): the session as stored now decides. Unlocked: `relock`, then
 *   the screens read again. Locked with a PIN: the pad; the right PIN unlocks and the screens read
 *   again. Locked with no PIN: a dialog says locked groups need one (step 38c sets it).
 * - **The pad** (`PIN_SCREEN`): four boxes, then a 3 × 4 grid `1 2 3 / 4 5 6 / 7 8 9 / Delete 0
 *   Cancel`, left to right in every language (LEFT and RIGHT are the pad's own, so Arabic doesn't
 *   mirror them). The number keys type at once; the fourth digit asks the worker. A wrong PIN
 *   clears the boxes; after too many, digits do nothing until the worker's wait is over. Back and
 *   Cancel close it. The digits typed stay in this closure, never in a signal.
 * - **The app hidden while unlocked** (`lifecycle`): the session locks at once. When the app comes
 *   back the pad covers the screen (purpose `return`), and every listener of `heldLifecycle` (the
 *   player's) hears `visible` only after the right PIN, so the stream stays held meanwhile. Back
 *   or Cancel there start the app again (`restart`), locked.
 */

export const PIN_SCREEN = 'pin';
export const PIN_PAD = 'pad';
export const NO_PIN_SCREEN = 'no-pin';
export const NO_PIN_BUTTONS = 'buttons';
/** A PIN's digits. */
export const PIN_LENGTH = 4;
/** The pad's columns, and its cells after 1–9. */
export const PAD_COLUMNS = 3;
export const PAD_DELETE = 9;
export const PAD_ZERO = 10;
export const PAD_CANCEL = 11;
export const PAD_CELLS = 12;

/** Why the pad shows: the rail's "Locked groups", or the app back after an unlocked session. */
export type PinPurpose = 'rail' | 'return';

/** What the pad says under the boxes. */
export type PinProblem = 'wrong' | 'wait' | 'failed' | null;

/** The pad as drawn: how many digits are typed (never which), the problem, and whether the worker is checking them. */
export interface PinPadView {
  readonly purpose: PinPurpose;
  readonly typed: number;
  readonly problem: PinProblem;
  readonly busy: boolean;
}

/** What parental control needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface ParentalEngine {
  lockState(): Promise<LockState>;
  unlock(pin: string): Promise<UnlockAnswer>;
  relock(): Promise<void>;
}

export type LifecycleSource = (listener: (event: LifecycleEvent) => void) => () => void;

export interface ParentalOptions {
  /** The live screen's navigator: the pad and the dialog are screens on it. */
  readonly nav: Navigator;
  readonly engine: ParentalEngine;
  /** The platform's lifecycle (the app hidden and shown). */
  readonly lifecycle?: LifecycleSource;
  /** The session unlocked (`true`) or locked again (`false`): every screen reads again. */
  readonly changed: (unlocked: boolean) => void;
  /** Back on the return's pad: the app starts again, locked. */
  readonly restart: () => void;
  /** The clock in ms (the worker's wait). */
  readonly now?: () => number;
}

export interface Parental {
  /** The pad while it is open. */
  readonly pad: ReadonlySignal<PinPadView | null>;
  /** Calls to the worker in flight (e2e: 0 means settled). */
  readonly pending: ReadonlySignal<number>;
  /** OK on a rail's last entry: the pad, the no-PIN dialog, or the session locked again. */
  toggle(): void;
  /**
   * The platform's lifecycle for the player: `visible` after an unlocked session waits until the
   * return's pad takes the right PIN (the stream stays held, no picture or sound).
   */
  heldLifecycle: LifecycleSource;
  dispose(): void;
}

const PAD_ZONE: ZoneSpec = { kind: 'grid', id: PIN_PAD, columns: PAD_COLUMNS, count: PAD_CELLS };
const NO_PIN_ZONE: ZoneSpec = { kind: 'list', id: NO_PIN_BUTTONS, axis: 'horizontal', count: 1 };

/** The digit a pad cell types (`-1`: Delete or Cancel). */
export function cellDigit(index: number): number {
  if (index >= 0 && index < PAD_DELETE) return index + 1;
  return index === PAD_ZERO ? 0 : -1;
}

/** The cell LEFT or RIGHT reaches from `index`, left to right in every language (the same cell at an edge). */
export function padStep(index: number, intent: 'LEFT' | 'RIGHT'): number {
  const column = index % PAD_COLUMNS;
  if (intent === 'LEFT') return column > 0 ? index - 1 : index;
  return column < PAD_COLUMNS - 1 ? index + 1 : index;
}

export function createParental(options: ParentalOptions): Parental {
  const { nav, engine } = options;
  const clockNow = options.now ?? (() => Date.now());
  const pad = signal<PinPadView | null>(null);
  const pending = signal(0);

  let disposed = false;
  /** The digits typed so far (never in a signal). */
  let digits = '';
  /** The pad's screen while it is on the stack. */
  let padScreen: Screen | null = null;
  /** No digit counts before this (the worker's wait after too many wrong PINs). */
  let waitUntil = 0;
  /** Whether this app unlocked the session (and hasn't locked it since). */
  let unlocked = false;
  /** The app was hidden while unlocked: it asks the PIN before anything shows again. */
  let asking = false;
  /** `visible` calls held until the return's pad takes the right PIN. */
  let held: (() => void)[] = [];

  function track<T>(request: () => Promise<T>): Promise<T> {
    pending.value += 1;
    let running: Promise<T>;
    try {
      running = request();
    } catch (error) {
      running = Promise.reject(error);
    }
    const done = (): void => {
      pending.value -= 1;
    };
    running.then(done, done);
    return running;
  }

  const show = (problem: PinProblem, busy = false): void => {
    const open = pad.peek();
    if (open !== null) pad.value = { purpose: open.purpose, typed: digits.length, problem, busy };
  };

  const closePad = (): void => {
    const screen = padScreen;
    padScreen = null;
    digits = '';
    pad.value = null;
    if (screen !== null && nav.top === screen) nav.pop();
  };

  /** Back or Cancel: the rail's pad closes; the return's starts the app again. */
  const cancel = (): void => {
    const open = pad.peek();
    if (open === null) return;
    if (open.purpose === 'return') {
      options.restart();
      return;
    }
    closePad();
  };

  const releaseHeld = (): void => {
    const waiting = held;
    held = [];
    for (let i = 0; i < waiting.length; i += 1) waiting[i]!();
  };

  /** The right PIN: the pad closes, the screens read again, and after a return the player hears `visible`. */
  const opened = (): void => {
    unlocked = true;
    asking = false;
    closePad();
    options.changed(true);
    releaseHeld();
  };

  const check = (pin: string): void => {
    show(null, true);
    track(() => engine.unlock(pin)).then(
      (answer) => {
        if (disposed || pad.peek() === null) return;
        digits = '';
        if (answer.result === 'ok') opened();
        else if (answer.result === 'wait') {
          waitUntil = clockNow() + answer.waitMs;
          show('wait');
        } else if (answer.result === 'wrong') show('wrong');
        else {
          // No PIN any more (a restore took it away): the rail's pad says so; the return's waits for one.
          if (pad.peek()!.purpose === 'return') show('failed');
          else {
            closePad();
            openNoPin();
          }
        }
      },
      (error: unknown) => {
        if (disposed || pad.peek() === null) return;
        console.warn('The PIN could not be checked', error);
        digits = '';
        show('failed');
      },
    );
  };

  const type = (digit: number): void => {
    const open = pad.peek();
    // (Four digits always come with `busy`: the check starts at the fourth.)
    if (open === null || open.busy || clockNow() < waitUntil) return;
    digits += String(digit);
    if (digits.length === PIN_LENGTH) check(digits);
    else show(null);
  };

  const erase = (): void => {
    const open = pad.peek();
    if (open === null || open.busy) return;
    digits = digits.substring(0, digits.length - 1);
    show(open.problem);
  };

  const openPad = (purpose: PinPurpose): void => {
    if (padScreen !== null) return;
    digits = '';
    pad.value = { purpose, typed: 0, problem: clockNow() < waitUntil ? 'wait' : null, busy: false };
    padScreen = nav.push({
      id: PIN_SCREEN,
      zones: [PAD_ZONE],
      onIntent: (intent: Intent, focus: Focus): boolean => {
        const d = DIGIT_INTENTS.indexOf(intent as (typeof DIGIT_INTENTS)[number]);
        if (d !== -1) {
          type(d);
          return true;
        }
        if (intent === 'BACK') {
          cancel();
          return true;
        }
        // Left to right in every language, as phone pads are.
        if (intent === 'LEFT' || intent === 'RIGHT') {
          padScreen?.focus(PIN_PAD, padStep(focus.index, intent));
          return true;
        }
        return false;
      },
      onSelect: (focus: Focus): void => {
        const digit = cellDigit(focus.index);
        if (digit !== -1) type(digit);
        else if (focus.index === PAD_DELETE) erase();
        else if (focus.index === PAD_CANCEL) cancel();
      },
    });
  };

  const openNoPin = (): void => {
    nav.push({
      id: NO_PIN_SCREEN,
      zones: [NO_PIN_ZONE],
      onSelect: () => {
        nav.pop();
      },
    });
  };

  const toggle = (): void => {
    if (disposed || padScreen !== null) return;
    track(() => engine.lockState()).then(
      (state) => {
        // (A second OK while the first read ran: the pad it opened takes the second answer's place.)
        if (disposed || padScreen !== null) return;
        if (state.unlocked) {
          unlocked = false;
          track(() => engine.relock()).then(
            () => {
              if (!disposed) options.changed(false);
            },
            (error: unknown) => console.warn('The session could not be locked again', error),
          );
        } else if (state.pin) openPad('rail');
        else openNoPin();
      },
      (error: unknown) => console.warn('The locks could not be read', error),
    );
  };

  const stopLifecycle =
    options.lifecycle === undefined
      ? () => undefined
      : options.lifecycle((event) => {
          if (disposed) return;
          if (event === 'hidden') {
            if (!unlocked) return;
            unlocked = false;
            asking = true;
            void track(() => engine.relock()).catch((error: unknown) => console.warn('The session could not be locked again', error));
          } else if (event === 'visible' && asking) {
            // Whatever is on top: the pad over it all (once, however often the app shows).
            openPad('return');
          }
        });

  const heldLifecycle: LifecycleSource = (listener) => {
    if (options.lifecycle === undefined) return () => undefined;
    return options.lifecycle((event) => {
      if (event === 'visible' && asking) held.push(() => listener(event));
      else listener(event);
    });
  };

  return {
    pad,
    pending,
    toggle,
    heldLifecycle,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopLifecycle();
      held = [];
    },
  };
}
