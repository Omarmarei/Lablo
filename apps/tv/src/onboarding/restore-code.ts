import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import { BACKUP_CODE_LENGTH, readBackupCode } from '@lablo/crypto/backup-code';
import type { LoadedProfile } from '@lablo/data';
import type { BackupCodeRequest, BackupRestoreResult, CancelToken } from '@lablo/data/client';
import { CancelSource } from '@lablo/data/client';
import type { Navigator, Screen, TextEditor, ZoneSpec } from '@lablo/ui';
import type { SchedulerTimers } from '../data/refresh-scheduler';
import { codeGroups } from '../settings/backup-state';
import { storedSources } from './engine-loader';

/**
 * "Restore with a backup code" at the first start (RELAY step 32d3c, architecture.md §3.3 B): the
 * source screen's last row opens this screen on onboarding's navigator. A TV that backed up
 * under its backup code (no device ID: "Not now", or a platform that gives none) gets its
 * profile back after a wipe by typing the code that Settings › Backup showed.
 *
 *   typing     the field (its letters drawn in upper case, in groups of four as typed) and
 *              "Restore". OK on "Restore" checks the field first (`codeProblem`): text that can't
 *              be a code puts its problem under the field and the focus back on it, and no
 *              worker starts. An answer that wasn't a restore shows over the button.
 *   restoring  "Opening your backup", scrypt's progress, "Cancel" (Back too). It first waits for
 *              the data engine's refresh slot (`slotFree`): a load cancelled just before may still
 *              be committing a catalog, which the restore's clear must come after. The time limit
 *              is the look-up's (`CODE_LIMIT_MS`), from the worker's start.
 *   restarting the profile has a source now: the app starts again (`restart`). `restored`: as after
 *              Settings' "Restore it" ("Welcome back", then the live screen); `kept` (a source got
 *              there meanwhile): a plain start on that profile.
 *
 * - **What can be trusted:** the worker's answers say what it wrote (`none`, `newer`,
 *   `unreadable` and `failed` wrote nothing: onboarding stays where it was). A rejection (Cancel,
 *   the time limit, a worker that died) may come just after the restore committed, so the
 *   profile is read again then: a source there is a restore.
 * - **Once:** an answer from a restore that was cancelled is dropped, unless it says the profile
 *   has a source (`restored`, `kept`): the app starts again whatever the screen shows.
 */

export const RESTORE_CODE_SCREEN = 'restore-code';
/**
 * A restore gives up after this long: the look-up's `LOOKUP_LIMIT_MS` (its test pins the two
 * equal; importing it here would close an import cycle through onboarding's start).
 */
export const CODE_LIMIT_MS = 30_000;
/** The field's input (the text editor finds it by this DOM id). */
export const CODE_FIELD = 'onboarding-code';
/** The screen's zones: the field (not while restoring), and the button. */
export const CODE_ZONE = 'field';
export const CODE_ACTIONS = 'actions';

/** Why the typed text can't be a code: nothing typed, too few or many characters, or a character no code has. */
export type CodeProblem = 'required' | 'length' | 'invalid';
/** What an end that wasn't a restore says: the worker's answer, or `network` for the time limit too, `other` for a worker that died. */
export type RestoreNotice = 'none' | 'newer' | 'unreadable' | 'network' | 'rate' | 'status' | 'other';
export type RestorePhase = 'typing' | 'restoring' | 'restarting';

/** What the screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface RestoreCodeEngine {
  restoreBackupCode(request: BackupCodeRequest, options: { readonly onProgress?: (fraction: number) => void; readonly cancel?: CancelToken }): Promise<BackupRestoreResult>;
  profile(): Promise<LoadedProfile | null>;
}

/** What the screen needs from the app around it (main.tsx): onboarding stays free of `location`. */
export interface RestoreCodeHost {
  readonly engine: RestoreCodeEngine;
  /** The request's half from the build: the scrypt salt's platform and app id, and the API's origin. */
  readonly build: { readonly platform: string; readonly appId: string; readonly base: string };
  /** Resolves once no catalog or guide refresh holds the data engine's slot. */
  slotFree(): Promise<void>;
  /** The app starts again on the profile: `true` after a restore ("Welcome back"), `false` plainly. */
  restart(restored: boolean): void;
  readonly limitMs?: number;
  readonly timers?: SchedulerTimers;
  /** Where a worker that died is told (default `console.warn`). */
  readonly warn?: (message: string, detail: unknown) => void;
}

export interface RestoreCodeOptions {
  readonly nav: Navigator;
  /** Opens the field's edit (OK on the field). */
  readonly editor: Pick<TextEditor, 'open'>;
  readonly host: RestoreCodeHost;
}

export interface RestoreCode {
  /** The field's text as drawn: upper case, in groups of four. */
  readonly text: ReadonlySignal<string>;
  readonly problem: ReadonlySignal<CodeProblem | null>;
  readonly notice: ReadonlySignal<RestoreNotice | null>;
  readonly phase: ReadonlySignal<RestorePhase>;
  /** scrypt's progress, 0 to 1 (`null` before the first report of a restore). */
  readonly progress: ReadonlySignal<number | null>;
  /** Each change of the field: drawn again, and its problem and the last answer cleared. */
  setText(value: string): void;
  /** Pushes the screen (the text typed before is kept). */
  open(): void;
  /** Cancels a restore running; nothing settles after it. */
  dispose(): void;
}

const REAL_TIMERS: SchedulerTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function skipped(char: string): boolean {
  return char === ' ' || char === '-' || char === '\t' || char === '\n';
}

/** The field's text as drawn: spaces and dashes dropped, upper case, in groups of four. */
export function codeTyped(value: string): string {
  let plain = '';
  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (!skipped(char)) plain += char.toUpperCase();
  }
  return codeGroups(plain);
}

/** Why `typed` can't be a code (`null`: it can). */
export function codeProblem(typed: string): CodeProblem | null {
  if (readBackupCode(typed) !== null) return null;
  let count = 0;
  for (let i = 0; i < typed.length; i++) if (!skipped(typed.charAt(i))) count += 1;
  if (count === 0) return 'required';
  return count === BACKUP_CODE_LENGTH ? 'invalid' : 'length';
}

/** What an answer that isn't a restore says (`null` for `restored` and `kept`, which start the app again). */
export function restoreNotice(result: BackupRestoreResult): RestoreNotice | null {
  if (result.state === 'failed') {
    if (result.failure === 'rate') return 'rate';
    return result.failure === 'status' ? 'status' : 'network';
  }
  if (result.state === 'none' || result.state === 'newer' || result.state === 'unreadable') return result.state;
  return null;
}

function zones(field: number): readonly ZoneSpec[] {
  return [
    { kind: 'list', id: CODE_ZONE, axis: 'vertical', count: field, neighbours: { down: CODE_ACTIONS } },
    { kind: 'list', id: CODE_ACTIONS, axis: 'horizontal', count: 1, neighbours: { up: CODE_ZONE } },
  ];
}

/** One restore: its cancel, its time limit, and whether the limit ended it. */
interface Run {
  readonly cancel: CancelSource;
  limit: unknown;
  limited: boolean;
}

export function createRestoreCode(options: RestoreCodeOptions): RestoreCode {
  const { nav, editor, host } = options;
  const { engine } = host;
  const timers = host.timers ?? REAL_TIMERS;
  const warn = host.warn ?? ((message: string, detail: unknown) => console.warn(message, detail));
  const text = signal('');
  const problem = signal<CodeProblem | null>(null);
  const notice = signal<RestoreNotice | null>(null);
  const phase = signal<RestorePhase>('typing');
  const progress = signal<number | null>(null);
  let screen: Screen | null = null;
  /** The restore whose answers count (`null`: none yet, or it was cancelled, or the app is starting again). */
  let current: Run | null = null;
  let disposed = false;

  const stopLimit = (run: Run): void => {
    if (run.limit !== null) timers.clear(run.limit);
    run.limit = null;
  };

  /** The field and "Restore" again, the focus on `zone` (the screen can't be left while restoring). */
  const typing = (zone: string): void => {
    phase.value = 'typing';
    screen?.update(zones(1)[0]!);
    screen?.focus(zone, 0);
  };

  /** The profile has a source now: the app starts again, once; a restore still running answers to nobody. */
  const restart = (restored: boolean): void => {
    if (disposed || phase.peek() === 'restarting') return;
    current = null;
    phase.value = 'restarting';
    host.restart(restored);
  };

  /** Cancel or Back while restoring: the field again at once; the worker's end is still read. */
  const cancelRun = (): void => {
    const run = current;
    if (run === null) return;
    current = null;
    stopLimit(run);
    run.cancel.cancel();
    typing(CODE_ACTIONS);
  };

  const answered = (run: Run, result: BackupRestoreResult): void => {
    stopLimit(run);
    if (result.state === 'restored' || result.state === 'kept') {
      restart(result.state === 'restored');
      return;
    }
    if (current !== run) return;
    notice.value = restoreNotice(result);
    typing(result.state === 'none' ? CODE_ZONE : CODE_ACTIONS);
  };

  /** A rejection: a cancel, the time limit or a worker that died, maybe after the restore committed. */
  const broke = (run: Run, error: unknown): void => {
    stopLimit(run);
    const cancelled = (error as { code?: unknown } | null)?.code === 'cancelled';
    if (!cancelled) warn('The backup code restore failed', error);
    engine
      .profile()
      .catch((): LoadedProfile | null => null)
      .then((profile) => {
        if (storedSources(profile).length > 0) {
          restart(true);
          return;
        }
        if (current !== run) return;
        notice.value = run.limited ? 'network' : cancelled ? null : 'other';
        typing(CODE_ACTIONS);
      });
  };

  const run = (typed: string): void => {
    const mine: Run = { cancel: new CancelSource(), limit: null, limited: false };
    current = mine;
    phase.value = 'restoring';
    progress.value = null;
    notice.value = null;
    // "Restore" was pressed: the focus is on the button, which stays as "Cancel".
    screen?.update(zones(0)[0]!);
    void host.slotFree().then(() => {
      // Cancelled or disposed while waiting (both drop it).
      if (current !== mine) return;
      mine.limit = timers.set(
        () => {
          mine.limited = true;
          mine.cancel.cancel();
        },
        host.limitMs ?? CODE_LIMIT_MS,
      );
      const request: BackupCodeRequest = { platform: host.build.platform, appId: host.build.appId, base: host.build.base, code: typed };
      let answer: Promise<BackupRestoreResult>;
      try {
        answer = engine.restoreBackupCode(request, {
          onProgress: (fraction) => {
            if (current === mine) progress.value = fraction;
          },
          cancel: mine.cancel.token,
        });
      } catch (error) {
        answer = Promise.reject(error);
      }
      answer.then(
        (result) => answered(mine, result),
        (error: unknown) => broke(mine, error),
      );
    });
  };

  const submit = (): void => {
    const typed = text.peek();
    const found = codeProblem(typed);
    problem.value = found;
    if (found !== null) {
      screen?.focus(CODE_ZONE, 0);
      return;
    }
    run(typed);
  };

  return {
    text,
    problem,
    notice,
    phase,
    progress,
    setText(value: string): void {
      text.value = codeTyped(value);
      problem.value = null;
      notice.value = null;
    },
    open(): void {
      if (disposed) return;
      problem.value = null;
      notice.value = null;
      screen = nav.push({
        id: RESTORE_CODE_SCREEN,
        zones: zones(1),
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          const now = phase.peek();
          if (now === 'restoring') cancelRun();
          // Typing: the navigator's own Back (the source screen again).
          return now !== 'typing';
        },
        onSelect: (focus) => {
          const now = phase.peek();
          if (now === 'restoring') cancelRun();
          else if (now === 'typing') {
            if (focus.zone === CODE_ZONE) editor.open(CODE_FIELD);
            else submit();
          }
        },
      });
    },
    dispose(): void {
      disposed = true;
      const running = current;
      current = null;
      if (running !== null) {
        stopLimit(running);
        running.cancel.cancel();
      }
    },
  };
}
