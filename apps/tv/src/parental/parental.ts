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
 *   again. Locked with no PIN: a dialog says locked groups need one; its "Set a PIN" (step 38c2)
 *   runs the login check (`check`, settings.js), then the pad's new PIN, and once that is kept
 *   the session unlocks with it (the user asked to see the locked groups).
 * - **The pad** (`PIN_SCREEN`): four boxes, then a 3 × 4 grid `1 2 3 / 4 5 6 / 7 8 9 / Delete 0
 *   Cancel`, left to right in every language (LEFT and RIGHT are the pad's own, so Arabic doesn't
 *   mirror them). The number keys type at once; the fourth digit asks the worker. A wrong PIN
 *   clears the boxes; after too many, digits do nothing until the worker's wait is over. Back and
 *   Cancel close it. The digits typed stay in this closure, never in a signal.
 * - **The app hidden while unlocked** (`lifecycle`): the session locks at once. When the app comes
 *   back the pad covers the screen (purpose `return`), and every listener of `heldLifecycle` (the
 *   player's) hears `visible` only after the right PIN, so the stream stays held meanwhile. Back
 *   or Cancel there start the app again (`restart`), locked.
 * - **Asked by Settings** (step 38c): `ask` checks the PIN with the session left as it is (the
 *   worker's `checkPin`, its wrong tries counting towards the same wait) and goes on after the
 *   right one; `choose` takes a new PIN typed twice (purposes `set`, then `again`: two different
 *   ones say so and start again, no wait counts) and keeps it (`setPin`). Back or Cancel close
 *   the pad, and nothing goes on.
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

/**
 * Why the pad shows: the rail's "Locked groups", the app back after an unlocked session, Settings'
 * check (step 38c), or a new PIN (`set`) and the same again (`again`).
 */
export type PinPurpose = 'rail' | 'return' | 'check' | 'set' | 'again';

/** What the pad says under the boxes (`mismatch`: the new PIN typed differently twice; `unsaved`: it wasn't kept). */
export type PinProblem = 'wrong' | 'wait' | 'failed' | 'mismatch' | 'unsaved' | null;

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
  checkPin(pin: string): Promise<UnlockAnswer>;
  setPin(pin: string): Promise<boolean>;
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
  /** The PIN's login check (step 38c2, settings.js): `matched` once a source's login was typed again. Without it the no-PIN dialog has only its OK. */
  readonly check?: (matched: () => void) => void;
}

export interface Parental {
  /** The pad while it is open. */
  readonly pad: ReadonlySignal<PinPadView | null>;
  /** Calls to the worker in flight (e2e: 0 means settled). */
  readonly pending: ReadonlySignal<number>;
  /** The no-PIN dialog offers "Set a PIN" (step 38c2: the app gave the login check). */
  readonly canSetPin: boolean;
  /** OK on a rail's last entry: the pad, the no-PIN dialog, or the session locked again. */
  toggle(): void;
  /** The pad, the session left as it is (step 38c): `done` after the right PIN; never after Back or Cancel. */
  ask(done: () => void): void;
  /** The pad for a new PIN, typed twice (step 38c): `done` once it is kept; never after Back or Cancel. */
  choose(done: () => void): void;
  /**
   * The platform's lifecycle for the player: `visible` after an unlocked session waits until the
   * return's pad takes the right PIN (the stream stays held, no picture or sound).
   */
  heldLifecycle: LifecycleSource;
  dispose(): void;
}

const PAD_ZONE: ZoneSpec = { kind: 'grid', id: PIN_PAD, columns: PAD_COLUMNS, count: PAD_CELLS };
/** The no-PIN dialog's "Set a PIN" (step 38c2; then "Cancel"), when it has it; else its only button is "OK". */
export const NO_PIN_SET = 0;

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
  /** What goes on after Settings' pad (step 38c): the right PIN, or a new one kept. */
  let after: (() => void) | null = null;
  /** The new PIN as first typed, while the pad asks for it again (set at each first typing, so never cleared). */
  let first = '';
  /** The new PIN, once kept, unlocks the session (step 38c2: asked for from the rails' no-PIN dialog). */
  let unlockKept = false;

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

  /** Settings' pad did its part: it closes, then what was asked for goes on. */
  const goOn = (): void => {
    const next = after;
    closePad();
    if (next !== null) next();
  };

  /** The right PIN: the pad closes, the screens read again, and after a return the player hears `visible`. */
  const opened = (): void => {
    unlocked = true;
    asking = false;
    closePad();
    options.changed(true);
    releaseHeld();
  };

  const check = (pin: string, purpose: PinPurpose): void => {
    show(null, true);
    track(() => (purpose === 'check' ? engine.checkPin(pin) : engine.unlock(pin))).then(
      (answer) => {
        if (disposed || pad.peek() === null) return;
        digits = '';
        if (answer.result === 'ok') {
          if (purpose === 'check') goOn();
          else opened();
        } else if (answer.result === 'wait') {
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

  /**
   * The new PIN was kept from the rails' dialog: the session unlocks with it (the pad stays busy
   * meanwhile). Unlocked, main follows even if Back closed the pad meanwhile (the worker is the
   * truth); otherwise only the pad that asked closes.
   */
  const unlockWith = (pin: string): void => {
    const mine = padScreen;
    track(() => engine.unlock(pin)).then(
      (answer) => {
        if (disposed) return;
        // (Kept but not unlocked, which a restore in between could do: the rail's entry asks it.)
        if (answer.result === 'ok') opened();
        else if (padScreen === mine) closePad();
      },
      (error: unknown) => {
        if (disposed) return;
        console.warn('The session could not be unlocked with the new PIN', error);
        if (padScreen === mine) closePad();
      },
    );
  };

  /** Keeps the new PIN; one the worker didn't keep starts the new PIN again. */
  const save = (pin: string): void => {
    show(null, true);
    const restart = (): void => {
      digits = '';
      pad.value = { purpose: 'set', typed: 0, problem: 'unsaved', busy: false };
    };
    track(() => engine.setPin(pin)).then(
      (ok) => {
        if (disposed || pad.peek() === null) return;
        if (ok) {
          // (A wait the worker held is over with a new PIN.)
          waitUntil = 0;
          if (unlockKept) unlockWith(pin);
          else goOn();
        } else restart();
      },
      (error: unknown) => {
        if (disposed || pad.peek() === null) return;
        console.warn('The PIN could not be kept', error);
        restart();
      },
    );
  };

  /** The fourth digit of a new PIN: the first time asks for it again; the second keeps it, or starts again when they differ. */
  const chosen = (purpose: PinPurpose): void => {
    const pin = digits;
    // (Its four dots stay while the worker keeps it.)
    if (purpose === 'again' && pin === first) {
      save(pin);
      return;
    }
    digits = '';
    if (purpose === 'set') {
      first = pin;
      pad.value = { purpose: 'again', typed: 0, problem: null, busy: false };
    } else {
      pad.value = { purpose: 'set', typed: 0, problem: 'mismatch', busy: false };
    }
  };

  const type = (digit: number): void => {
    const open = pad.peek();
    if (open === null || open.busy) return;
    const choosing = open.purpose === 'set' || open.purpose === 'again';
    // (A new PIN isn't checked: no wait holds it.)
    if (!choosing && clockNow() < waitUntil) return;
    digits += String(digit);
    // (Four digits always come with `busy` or a new purpose: the fourth one acts.)
    if (digits.length < PIN_LENGTH) show(null);
    else if (choosing) chosen(open.purpose);
    else check(digits, open.purpose);
  };

  const erase = (): void => {
    const open = pad.peek();
    if (open === null || open.busy) return;
    digits = digits.substring(0, digits.length - 1);
    show(open.problem);
  };

  const openPad = (purpose: PinPurpose, next: (() => void) | null = null, unlock = false): void => {
    if (padScreen !== null) return;
    digits = '';
    after = next;
    unlockKept = unlock;
    pad.value = { purpose, typed: 0, problem: purpose !== 'set' && clockNow() < waitUntil ? 'wait' : null, busy: false };
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

  const loginCheck = options.check;
  const openNoPin = (): void => {
    nav.push({
      id: NO_PIN_SCREEN,
      zones: [{ kind: 'list', id: NO_PIN_BUTTONS, axis: 'horizontal', count: loginCheck === undefined ? 1 : 2 }],
      onSelect: (focus) => {
        nav.pop();
        if (loginCheck === undefined || focus.index !== NO_PIN_SET) return;
        loginCheck(() => {
          if (!disposed) openPad('set', null, true);
        });
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
            // Whatever is on top: the pad over it all (once, however often the app shows). Settings'
            // pad, open when the app was hidden, goes first: what it asked for doesn't go on.
            const open = pad.peek();
            if (open !== null && open.purpose !== 'return') closePad();
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
    canSetPin: loginCheck !== undefined,
    toggle,
    ask(done: () => void): void {
      if (!disposed) openPad('check', done);
    },
    choose(done: () => void): void {
      if (!disposed) openPad('set', done);
    },
    heldLifecycle,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopLifecycle();
      held = [];
    },
  };
}
