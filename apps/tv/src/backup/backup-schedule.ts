import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { BackupCallRequest, BackupUploadResult } from '@lablo/data';
import type { LifecycleEvent } from '@lablo/platform-api';
import type { SchedulerTimers } from '../data/refresh-scheduler';

/**
 * The backup's upload while the app runs (RELAY step 32c2, architecture.md §3.3 B). The backup
 * worker decides what is sent (`DataEngine.uploadBackup`: nothing when the profile is unchanged
 * since the last send); this schedule decides when it is asked:
 *
 * - **After a change:** `changed()` (the data engine's `onProfileChanged`: an edit that changed the
 *   profile, a catalog refresh that committed) asks for a run `BACKUP_CHANGE_MS` after the first
 *   change not yet sent, and never sooner than `BACKUP_GAP_MS` after the last run began, so a movie
 *   whose place is kept every 10 s is sent at most every 5 minutes.
 * - **Its own start counts as a change:** onboarding's answers and source were written before the
 *   live screen opened.
 * - **Hidden:** a pending change runs at once (a TV may end a hidden app without warning), and so
 *   does one that comes while hidden (the player keeps a movie's place as the app hides): at most
 *   `HIDDEN_RUNS` runs for each time the app is hidden, none again after a failure. Nothing is
 *   timed while hidden; the schedule is armed again when the app is visible.
 * - **One at a time:** a change during a run is pending for the next.
 * - **Answers:** `sent`, `same`, `none`, `off` (step 32d2a: the backup is off) and `too-large`
 *   settle the change; `failed` (and a worker that died) keeps it pending for the next run, 5
 *   minutes on; `held` (a backup this TV hasn't seen is on the server) ends the timed runs until
 *   an answer says otherwise: Settings' backup page (step 32d2b) offers to restore it or replace
 *   it. `held`, `failed`, `too-large` and a dead worker are logged.
 * - **Each run** asks `request()` afresh: the profile's consent decides whether the device ID is
 *   read (`backupRequest`).
 * - **Stop:** the config's `disable-app` stops the schedule (`stop`), and `start` arms it again.
 * - **One backup worker at a time** (step 32d2b): Settings' backup page switches the backup and
 *   restores a held one inside `hold`, which waits for the run in progress and starts none until
 *   it ends (else a `PUT` could land after off's `DELETE`); "Replace it" is a run of its own
 *   (`replaceNow`).
 */

/** A run comes this long after the first change not yet sent. */
export const BACKUP_CHANGE_MS = 60_000;
/** At least this long between the starts of two runs (the hidden app's run aside). */
export const BACKUP_GAP_MS = 5 * 60_000;
/** At most this many runs each time the app is hidden. */
export const HIDDEN_RUNS = 2;

/** What the schedule needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface BackupScheduleEngine {
  uploadBackup(request: BackupCallRequest): Promise<BackupUploadResult>;
  /** "Replace it" (step 32d2b): the profile sent over a held backup, with no `GET`. */
  replaceHeldBackup(request: BackupCallRequest): Promise<BackupUploadResult>;
}

export interface BackupScheduleOptions {
  readonly engine: BackupScheduleEngine;
  /** The next run's request: the build's salt, the device ID only after "Allow", the API base. */
  readonly request: () => Promise<BackupCallRequest>;
  /** Subscribes to the app's visibility (`Platform.onLifecycle`). */
  readonly lifecycle?: (listener: (event: LifecycleEvent) => void) => () => void;
  readonly now?: () => number;
  readonly timers?: SchedulerTimers;
  /** Where a run that sent nothing is told (default: `console.warn`). */
  readonly warn?: (message: string, detail: unknown) => void;
}

export interface BackupSchedule {
  /**
   * A backup this TV hasn't seen is on the server: no timed runs until an answer says otherwise
   * (Settings' backup page shows it, step 32d2b). Any answer but `held` and `failed` clears it.
   */
  readonly held: ReadonlySignal<boolean>;
  /** The last run's answer (`null` before the first, or when its worker died). */
  readonly last: ReadonlySignal<BackupUploadResult | null>;
  /** Arms the schedule, as a change: the first run `BACKUP_CHANGE_MS` from now. Again after `stop`. */
  start(): void;
  /** The profile changed. */
  changed(): void;
  /**
   * A run now, or right after the one running (calls meanwhile share it), resolving with its
   * answer: `null` when its worker died, before `start` and once disposed. For the test hook,
   * and for Settings when the backup is turned on (step 32d2b).
   */
  uploadNow(): Promise<BackupUploadResult | null>;
  /**
   * "Replace it" (step 32d2b): a run now, or right after the one running, that sends the profile
   * over a held backup with no `GET` (`uploadNow` calls meanwhile share it). As `uploadNow`.
   */
  replaceNow(): Promise<BackupUploadResult | null>;
  /**
   * Runs `job` with no backup run beside it (step 32d2b): waits for the run in progress, and
   * starts none until `job` has settled (a run asked meanwhile comes after). Settles as `job`.
   */
  hold<T>(job: () => Promise<T>): Promise<T>;
  /** No run in progress and no `hold`: no backup worker of the schedule's or Settings' is in the database. */
  idle(): boolean;
  /** No more runs until `start` (a run in progress finishes); changes stay pending. */
  stop(): void;
  dispose(): void;
}

const defaultTimers: SchedulerTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createBackupSchedule(options: BackupScheduleOptions): BackupSchedule {
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? defaultTimers;
  const warn = options.warn ?? ((message: string, detail: unknown) => console.warn(message, detail));
  const held = signal(false);
  const last = signal<BackupUploadResult | null>(null);
  let started = false;
  let disposed = false;
  let running = false;
  let hidden = false;
  /** Runs since the app was last hidden. */
  let hiddenRuns = 0;
  /** The last run's answer was `failed`, or its worker died. */
  let failed = false;
  /** When the first change not yet sent came (`null`: none pending). */
  let pendingSince: number | null = null;
  /** When the last run began. */
  let lastStart = -Infinity;
  let timer: unknown = null;
  let unsubscribe: (() => void) | null = null;
  /** `uploadNow` and `replaceNow` calls waiting for the next run. */
  let waiters: ((result: BackupUploadResult | null) => void)[] = [];
  /** The next run is "Replace it" (`replaceNow`). */
  let replacing = false;
  /** `hold` jobs waiting or running: no run starts meanwhile. */
  let holds = 0;
  /** `hold` calls waiting for the run in progress to end. */
  let idleWaiters: (() => void)[] = [];

  const clearTimer = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  /** Times the next run for the pending change, when one may come. */
  const arm = (): void => {
    clearTimer();
    // (Never called while hidden or once disposed: `stop` and `dispose` end `started`.)
    if (!started || running || holds > 0 || held.peek() || pendingSince === null) return;
    const due = Math.max(pendingSince + BACKUP_CHANGE_MS, lastStart + BACKUP_GAP_MS);
    timer = timers.set(
      () => {
        timer = null;
        void run();
      },
      Math.max(0, due - now()),
    );
  };

  /** While hidden: a run now for a pending change, unless the cap or a failure says no. */
  const runHidden = (): void => {
    if (held.peek() || pendingSince === null || failed || hiddenRuns >= HIDDEN_RUNS) return;
    void run();
  };

  async function run(): Promise<void> {
    if (running || holds > 0) return;
    clearTimer();
    running = true;
    lastStart = now();
    if (hidden) hiddenRuns += 1;
    // This run sends the changes so far; one made during it is pending for the next.
    const since = pendingSince;
    pendingSince = null;
    const answered = waiters;
    waiters = [];
    const replace = replacing;
    replacing = false;
    let answer: BackupUploadResult | null = null;
    try {
      const request = await options.request();
      answer = await (replace ? options.engine.replaceHeldBackup(request) : options.engine.uploadBackup(request));
    } catch (error) {
      warn('The backup upload failed', error);
    }
    running = false;
    last.value = answer;
    failed = answer === null || answer.state === 'failed';
    if (answer === null || answer.state === 'failed') {
      // Kept for the next run (the gap holds it 5 minutes).
      // (A change made during the run came later.)
      if (since !== null) pendingSince = since;
      if (answer !== null) warn('The backup was not sent', answer.failure);
    } else {
      // A held backup stays until an answer says otherwise (sent over it, the backup off…).
      held.value = answer.state === 'held';
      if (answer.state === 'held') warn('The backup was not sent', 'held: a backup this TV has not seen is on the server');
      else if (answer.state === 'too-large') warn('The backup was not sent', 'too-large');
    }
    for (let i = 0; i < answered.length; i++) answered[i]!(disposed ? null : answer);
    // A `hold` waiting for this run goes first: no run starts while it holds.
    const idled = idleWaiters;
    idleWaiters = [];
    for (let i = 0; i < idled.length; i++) idled[i]!();
    if (disposed) return;
    if (waiters.length > 0) {
      void run();
      return;
    }
    if (hidden) runHidden();
    else arm();
  }

  const onLifecycle = (event: LifecycleEvent): void => {
    if (event === 'hidden') {
      if (hidden) return;
      hidden = true;
      hiddenRuns = 0;
      failed = false;
      // A pending change runs now (its run clears the timer); with none, no timer is set.
      runHidden();
      return;
    }
    hidden = false;
    arm();
  };

  return {
    held,
    last,
    start() {
      if (disposed || started) return;
      started = true;
      if (unsubscribe === null && options.lifecycle) unsubscribe = options.lifecycle(onLifecycle);
      if (pendingSince === null) pendingSince = now();
      arm();
    },
    changed() {
      if (disposed) return;
      if (pendingSince === null) pendingSince = now();
      if (hidden) runHidden();
      else arm();
    },
    uploadNow() {
      if (!started || disposed) return Promise.resolve(null);
      return new Promise<BackupUploadResult | null>((resolve) => {
        waiters.push(resolve);
        void run();
      });
    },
    replaceNow() {
      if (!started || disposed) return Promise.resolve(null);
      replacing = true;
      return new Promise<BackupUploadResult | null>((resolve) => {
        waiters.push(resolve);
        void run();
      });
    },
    hold<T>(job: () => Promise<T>): Promise<T> {
      holds += 1;
      clearTimer();
      const quiet = running ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve();
      // (While another hold remains, `run` and `arm` still refuse.)
      const release = (): void => {
        holds -= 1;
        if (disposed) return;
        if (waiters.length > 0) void run();
        else if (hidden) runHidden();
        else arm();
      };
      return quiet.then(job).then(
        (value) => {
          release();
          return value;
        },
        (error: unknown) => {
          release();
          throw error;
        },
      );
    },
    idle() {
      return !running && holds === 0;
    },
    stop() {
      started = false;
      clearTimer();
      unsubscribe?.();
      unsubscribe = null;
      hidden = false;
    },
    dispose() {
      disposed = true;
      started = false;
      clearTimer();
      unsubscribe?.();
      unsubscribe = null;
      const left = waiters;
      waiters = [];
      for (let i = 0; i < left.length; i++) left[i]!(null);
    },
  };
}
