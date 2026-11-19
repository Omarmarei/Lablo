import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LoadedProfile } from '@lablo/data';
import type { BackupCallRequest, BackupRestoreResult, CancelToken } from '@lablo/data/client';
import { CancelSource } from '@lablo/data/client';
import type { FocusBinding, Language, Navigator, ScreenSpec, ZoneSpec } from '@lablo/ui';
import { bindFocus, createNavigator } from '@lablo/ui';
import { needsLogin, storedSources, userGuides } from '../onboarding/engine-loader';
import { startPoint } from '../onboarding/start';
import type { SchedulerTimers } from '../data/refresh-scheduler';

/**
 * The look-up at a start with no profile (RELAY step 32c2, Omar's decision in step 32): "Looking
 * for your backup" while the backup worker derives this TV's keys and asks the API, then "Welcome
 * back" when the profile came back, else onboarding.
 *
 * - **Waits:** onboarding's first answer would create a profile, and a restore never writes over
 *   one, so the start waits for the look-up rather than switching mid-onboarding.
 * - **Ends:** the answer, "Skip" (or Back), or `LOOKUP_LIMIT_MS`; the last two cancel the worker.
 *   However it ends, the profile is read again: a cancel may come just after the restore committed,
 *   and a profile with a source is a restore whatever the worker said.
 * - **"Welcome back":** in the restored profile's language (`null`: the TV's), for `WELCOME_MS` or
 *   until OK, so the restore needs no key at all (step 32's "Done when"). A backup made without
 *   logins and links (step 32d4b) brought sources back without them: one line says how many, and
 *   the end opens Settings › Sources (`toSources`), however it comes. The user's guides without
 *   their link (step 32d4c) get a line of their own; with no source to give its login, the end
 *   opens Settings › TV guides (`toGuides`).
 * - **After Settings' "Restore it"** (step 32d2b) the app starts again with `restored`: no look-up,
 *   "Welcome back" on that profile at once.
 */

/** The look-up gives up after this long (CI: 4.2 s on Chromium 56; a 2018 TV is slower). */
export const LOOKUP_LIMIT_MS = 30_000;
/** "Welcome back" shows this long before the live screen. */
export const WELCOME_MS = 5_000;

/** The navigator's screens, and their one zone of one button. */
export const LOOKING_SCREEN = 'looking';
export const WELCOME_SCREEN = 'welcome';
export const BACKUP_START_ZONE = 'actions';

export type BackupStartScreen = typeof LOOKING_SCREEN | typeof WELCOME_SCREEN;

/** What the look-up needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface BackupStartEngine {
  restoreBackup(request: BackupCallRequest, options: { readonly onProgress?: (fraction: number) => void; readonly cancel?: CancelToken }): Promise<BackupRestoreResult>;
  profile(): Promise<LoadedProfile | null>;
}

interface BackupStartCommon {
  readonly engine: BackupStartEngine;
  readonly limitMs?: number;
  readonly welcomeMs?: number;
  readonly timers?: SchedulerTimers;
  /** Where an answer that isn't a restore is told (default: `console.warn`). */
  readonly warn?: (message: string, detail: unknown) => void;
}

export type BackupStartOptions = BackupStartCommon &
  (
    | {
        /** `lookupRequest`'s answer: the device ID, read with no consent asked. */
        readonly request: BackupCallRequest;
      }
    | {
        /** A start after Settings' "Restore it" (step 32d2b): the profile it restored, no look-up. */
        readonly restored: LoadedProfile;
      }
  );

/**
 * How the look-up ended: the profile read after it, whether that is a restore (it has a source),
 * and whether the sources screen opens next (a restored source needs its login, step 32d4b), else
 * the guides screen (a restored guide of the user's needs its link, step 32d4c).
 */
export interface BackupStartEnd {
  readonly profile: LoadedProfile | null;
  readonly restored: boolean;
  readonly toSources: boolean;
  readonly toGuides: boolean;
}

export interface BackupStart {
  readonly nav: Navigator;
  readonly binding: FocusBinding;
  readonly screen: ReadonlySignal<BackupStartScreen>;
  /** scrypt's progress, 0 to 1 (`null` before the first report). */
  readonly progress: ReadonlySignal<number | null>;
  /** "Skip" was pressed (or Back): the look-up is being cancelled. */
  readonly skipped: ReadonlySignal<boolean>;
  /** "Welcome back": the restored profile's language (`null`: the TV's). */
  readonly language: ReadonlySignal<Language | null>;
  /** "Welcome back": how many sources came back, and how many of them are files sent from a phone. */
  readonly sources: ReadonlySignal<number>;
  readonly files: ReadonlySignal<number>;
  /** "Welcome back": how many of them came back without their login or link (step 32d4b). */
  readonly logins: ReadonlySignal<number>;
  /** "Welcome back": how many of the user's guides came back without their link (step 32d4c). */
  readonly guides: ReadonlySignal<number>;
  /** Settles once: after onboarding's look-up ends, or after "Welcome back". */
  readonly done: Promise<BackupStartEnd>;
  /** Ends the look-up's worker and the screen's focus; `done` settles no more after it. */
  dispose(): void;
}

const ONE: readonly ZoneSpec[] = [{ kind: 'list', id: BACKUP_START_ZONE, axis: 'horizontal', count: 1 }];

const defaultTimers: SchedulerTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The answers that say something went wrong (none found and a kept profile are no news). */
function worthTelling(result: BackupRestoreResult): string | null {
  if (result.state === 'failed') return 'failed: ' + result.failure;
  if (result.state === 'unreadable' || result.state === 'newer') return result.state;
  return null;
}

export function createBackupStart(options: BackupStartOptions): BackupStart {
  const { engine } = options;
  const timers = options.timers ?? defaultTimers;
  const warn = options.warn ?? ((message: string, detail: unknown) => console.warn(message, detail));
  const screen = signal<BackupStartScreen>(LOOKING_SCREEN);
  const progress = signal<number | null>(null);
  const skipped = signal(false);
  const language = signal<Language | null>(null);
  const sources = signal(0);
  const files = signal(0);
  const logins = signal(0);
  const guides = signal(0);
  const cancel = new CancelSource();
  let limit: unknown = null;
  let welcome: unknown = null;
  let disposed = false;
  let end: BackupStartEnd | null = null;
  let settle: (value: BackupStartEnd) => void = () => undefined;
  const done = new Promise<BackupStartEnd>((resolve) => {
    settle = resolve;
  });

  const clear = (handle: unknown): null => {
    if (handle !== null) timers.clear(handle);
    return null;
  };

  /** The look-up has ended (its limit is cleared by then): `done` settles, once (a promise does). */
  const finish = (value: BackupStartEnd): void => {
    welcome = clear(welcome);
    settle(value);
  };

  /** Skip or Back: the worker is cancelled (a second cancel does nothing). */
  const skip = (): void => {
    skipped.value = true;
    cancel.cancel();
  };

  const welcomeSpec: ScreenSpec = {
    id: WELCOME_SCREEN,
    zones: ONE,
    onIntent: (intent) => {
      if (intent !== 'BACK') return false;
      if (end !== null) finish(end);
      return true;
    },
    onSelect: () => {
      if (end !== null) finish(end);
    },
  };

  const nav: Navigator = createNavigator({
    root: {
      id: LOOKING_SCREEN,
      zones: ONE,
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        skip();
        return true;
      },
      onSelect: () => skip(),
    },
    rootBack: 'platform-back',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const binding = bindFocus(nav);

  /** "Welcome back" for a profile with a source, else the end: onboarding. */
  const welcomeOr = (profile: LoadedProfile | null): void => {
    const records = storedSources(profile);
    if (records.length === 0) {
      finish({ profile, restored: false, toSources: false, toGuides: false });
      return;
    }
    let fromPhone = 0;
    let withoutLogin = 0;
    for (let i = 0; i < records.length; i++) {
      if (records[i]!.type === 'm3u-file') fromPhone += 1;
      if (needsLogin(records[i]!)) withoutLogin += 1;
    }
    let withoutLink = 0;
    const kept = userGuides(profile);
    for (let i = 0; i < kept.length; i++) if (kept[i]!.url === null) withoutLink += 1;
    // The sources first: a guide can wait, a source without its login has no channels.
    end = { profile, restored: true, toSources: withoutLogin > 0, toGuides: withoutLogin === 0 && withoutLink > 0 };
    language.value = startPoint(profile).language;
    sources.value = records.length;
    files.value = fromPhone;
    logins.value = withoutLogin;
    guides.value = withoutLink;
    screen.value = WELCOME_SCREEN;
    nav.reset(welcomeSpec);
    welcome = timers.set(
      () => {
        welcome = null;
        if (end !== null) finish(end);
      },
      options.welcomeMs ?? WELCOME_MS,
    );
  };

  /** The look-up has ended, however: the profile decides. */
  const ended = (): void => {
    if (disposed) return;
    limit = clear(limit);
    engine
      .profile()
      .catch((error: unknown) => {
        warn('The profile could not be read after the backup look-up', error);
        return null;
      })
      .then((profile) => {
        if (!disposed) welcomeOr(profile);
      });
  };

  const parts = {
    nav,
    binding,
    screen,
    progress,
    skipped,
    language,
    sources,
    files,
    logins,
    guides,
    done,
    dispose() {
      disposed = true;
      limit = clear(limit);
      welcome = clear(welcome);
      cancel.cancel();
      binding.dispose();
    },
  };
  if ('restored' in options) {
    welcomeOr(options.restored);
    return parts;
  }

  limit = timers.set(
    () => {
      limit = null;
      cancel.cancel();
    },
    options.limitMs ?? LOOKUP_LIMIT_MS,
  );
  engine
    .restoreBackup(options.request, {
      onProgress: (fraction) => {
        if (!disposed) progress.value = fraction;
      },
      cancel: cancel.token,
    })
    .then(
      (result) => {
        const told = worthTelling(result);
        if (told !== null) warn('No backup was restored', told);
        ended();
      },
      (error: unknown) => {
        // A cancel (Skip, Back, the time limit) or a worker that died.
        if ((error as { code?: unknown } | null)?.code !== 'cancelled') warn('The backup look-up failed', error);
        ended();
      },
    );
  return parts;
}
