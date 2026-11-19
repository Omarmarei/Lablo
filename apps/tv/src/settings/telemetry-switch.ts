import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LoadedProfile, ProfileEdit } from '@lablo/data';
import { telemetryOn } from '../telemetry/telemetry-state';

/**
 * Settings' "Usage and crash reports" row (RELAY step 33b3, architecture.md §3.4): the profile's
 * telemetry switch, on unless it says `telemetry: false`. OK switches it in place: no page and no
 * question, since neither way loses anything of the user's ("off" is the private direction, and
 * "on" again is one OK).
 *
 * - **Read at each opening** of Settings (`read`), from the stored profile: the telemetry worker
 *   reads that one before each send, so the row shows what it will find. Until the read answers
 *   the row has no value, and OK reads again; a read that fails only logs.
 * - **An OK:** the profile's edit, then the profile read back, then main's telemetry told what it
 *   says (`setOn`: off drops what main holds and sends once, so the worker deletes the queue and
 *   the install ID). The edit comes first so that a send between the two finds "off" stored.
 *   The read-back is the truth: `editProfile` answers `false` both when nothing changed and when a
 *   newer app's profile refused the edit, and a privacy switch must never show "Off" while the
 *   stored one says on. When it isn't what was asked, or the edit failed, the row says so (`failed`).
 * - **Busy** until `setOn` resolves (off: after its clearing send). OK does nothing meanwhile: a
 *   second OK would store "on" before the worker reads the switch, and the old queue would go out
 *   under the old ID, the link between before and after that deleting the ID prevents.
 */

/** What the switch needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface TelemetrySwitchEngine {
  profile(): Promise<LoadedProfile | null>;
  editProfile(edit: ProfileEdit): Promise<boolean>;
}

export interface TelemetrySwitchOptions {
  readonly engine: TelemetrySwitchEngine;
  /** Main's telemetry (`Telemetry.setOn`): off resolves after its clearing send. */
  readonly setOn: (on: boolean) => Promise<void>;
}

export interface TelemetrySwitch {
  /** The stored switch as last read (`null`: not read yet, or the read failed). */
  readonly value: ReadonlySignal<boolean | null>;
  /** A change is running: OK does nothing until it ends. */
  readonly busy: ReadonlySignal<boolean>;
  /** The last change didn't take, until the next OK or opening. */
  readonly failed: ReadonlySignal<boolean>;
  /** Data requests in flight, the clearing send included (0: the row is done with the workers). */
  readonly pending: ReadonlySignal<number>;
  /** Reads the stored switch (each opening of Settings); a change running reads it back itself. */
  read(): void;
  /** OK on the row: switches it, or reads it again while it has no value. */
  press(): void;
  dispose(): void;
}

export function createTelemetrySwitch(options: TelemetrySwitchOptions): TelemetrySwitch {
  const { engine } = options;
  const value = signal<boolean | null>(null);
  const busy = signal(false);
  const failed = signal(false);
  const pending = signal(0);
  let disposed = false;
  /** Bumps on each read and each change: an older read's answer is dropped. */
  let readSeq = 0;

  /** Runs `request`, counting it in `pending` until it settles either way. */
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

  const read = (): void => {
    if (disposed || busy.peek()) return;
    readSeq += 1;
    const seq = readSeq;
    failed.value = false;
    void track(() => engine.profile()).then(
      (profile) => {
        if (disposed || seq !== readSeq) return;
        value.value = telemetryOn(profile);
      },
      (error: unknown) => {
        if (disposed || seq !== readSeq) return;
        console.warn("The usage reports' switch could not be read", error);
        value.value = null;
      },
    );
  };

  const press = (): void => {
    if (disposed || busy.peek()) return;
    const now = value.peek();
    if (now === null) {
      read();
      return;
    }
    const want = !now;
    busy.value = true;
    failed.value = false;
    // An opening's read still out is dropped: this change reads the switch back.
    readSeq += 1;
    void track(() =>
      engine
        .editProfile({ kind: 'telemetry', on: want })
        .then(() => engine.profile())
        .then((profile) => {
          const stored = telemetryOn(profile);
          if (!disposed) {
            value.value = stored;
            failed.value = stored !== want;
          }
          // Main follows the stored switch, even with Settings gone.
          return options.setOn(stored);
        }),
    ).then(
      () => {
        busy.value = false;
      },
      (error: unknown) => {
        console.warn("The usage reports' switch could not be changed", error);
        if (!disposed) failed.value = true;
        busy.value = false;
      },
    );
  };

  return {
    value,
    busy,
    failed,
    pending,
    read,
    press,
    dispose(): void {
      disposed = true;
    },
  };
}
