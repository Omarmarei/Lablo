import type { ReadonlySignal } from '@preact/signals';
import { effect, signal } from '@preact/signals';
import type { BackupCallRequest, BackupPrepareRequest, BackupRestoreResult, BackupStatus, BackupSwitchRequest, BackupSwitchResult, BackupUploadResult, LoadedProfile, ProfileEdit } from '@lablo/data';
import type { Navigator, Screen, ZoneSpec } from '@lablo/ui';
import type { BackupSchedule } from '../backup/backup-schedule';

/**
 * Settings' backup page (RELAY step 32d2b, architecture.md §3.3 B), opened by the settings
 * screen's "Backup" row and pushed on the live navigator:
 *
 *   switch  ("Backup", on or off; under it the last send, the session's last failure, or that
 *            it is off and still deleting the copy on the server; then, while on, "Include logins
 *            and links", step 32d4b: the profile's `backupLogins`)
 *   held    ("Restore it", "Replace it": only while on with a held backup, a backup this TV
 *            hasn't sent under its lookup ID)
 *
 * Between them, while on with the backup code as the secret, the code in groups of four to note
 * down. Off, "Restore it" and "Replace it" ask first (`backup-confirm`): off deletes the copy on
 * the server, a restore replaces the profile (the app starts again on it), and a replace loses
 * what the old backup held for good. Turning on asks nothing and sends at once; so does switching
 * the logins either way (off takes them out of the copy on the server, it loses nothing).
 *
 * - **Reads,** when it opens and after each action: the backup worker's status (`backupStatus`),
 *   with the request the upload schedule uses (the device ID only after "Allow"), and the profile
 *   (whether the backup includes the logins and links).
 * - **One backup worker at a time:** a switch, the logins' edit and a restore run inside the schedule's `hold` (it
 *   waits for a run in progress and starts none meanwhile); "Replace it" is the schedule's own run
 *   (`replaceNow`). A restore also waits for quiet (`quiet`: no catalog refresh running, none
 *   started), since it clears the catalogs; a restore that worked starts the app again (`restart`).
 * - Back closes it (the navigator's own Back); an action running goes on.
 */

export const BACKUP_SCREEN = 'backup';
export const BACKUP_CONFIRM = 'backup-confirm';

/** The switch zone's rows: the backup, then (while on) its logins and links (step 32d4b). */
export const SWITCH_BACKUP = 0;
export const SWITCH_LOGINS = 1;

/** The held box's buttons, and the confirm dialog's. */
export const HELD_RESTORE = 0;
export const HELD_REPLACE = 1;
export const CONFIRM_YES = 0;
export const CONFIRM_NO = 1;

export type BackupPageStatus = 'loading' | 'ready' | 'failed';
/** The action running (its worker in the database). */
export type BackupBusy = 'off' | 'on' | 'logins' | 'restore' | 'replace';
/** What an action that didn't work says, until the next action or opening. */
export type BackupNotice = 'off-failed' | 'on-failed' | 'logins-failed' | 'replace-failed' | 'restore-failed' | 'restore-newer' | 'restore-other';
/** What the confirm dialog asks. */
export type BackupQuestion = 'off' | 'restore' | 'replace';

/** What the page needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface BackupPageEngine {
  backupStatus(request: BackupPrepareRequest): Promise<BackupStatus>;
  setBackup(request: BackupSwitchRequest): Promise<BackupSwitchResult>;
  restoreHeldBackup(request: BackupCallRequest): Promise<BackupRestoreResult>;
  /** The profile: whether the backup includes the logins and links (step 32d4b). */
  profile(): Promise<LoadedProfile | null>;
  /** The `backupLogins` edit (step 32d4b). */
  editProfile(edit: ProfileEdit): Promise<boolean>;
}

/** What the page needs from the app around it (main.tsx). */
export interface BackupPageHost {
  /** The backup worker's request, as the upload schedule's: the build's salt, the device ID only after "Allow", the API base. */
  request(): Promise<BackupCallRequest>;
  /** The upload schedule: its held backup and last answer, and the runs and the hold the page asks for. */
  readonly schedule: Pick<BackupSchedule, 'held' | 'last' | 'uploadNow' | 'replaceNow' | 'hold'>;
  /** Runs `job` with no catalog or guide refresh running or starting (they start again after). */
  quiet<T>(job: () => Promise<T>): Promise<T>;
  /** A held backup was restored: the app starts again on it ("Welcome back"). */
  restart(): void;
}

export interface BackupPageOptions {
  readonly nav: Navigator;
  readonly engine: BackupPageEngine;
  readonly host: BackupPageHost;
}

export interface BackupPage {
  /** The page's screen once opened (the confirm dialog covers it; its zones stay). */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<BackupPageStatus>;
  /** The worker's last status (`null` before the first read, or when it failed). */
  readonly info: ReadonlySignal<BackupStatus | null>;
  /** Whether the backup includes the logins and links, as the last read found (`null` with `info`; step 32d4b). */
  readonly logins: ReadonlySignal<boolean | null>;
  readonly busy: ReadonlySignal<BackupBusy | null>;
  readonly notice: ReadonlySignal<BackupNotice | null>;
  /** The confirm dialog's question while it shows. */
  readonly question: ReadonlySignal<BackupQuestion | null>;
  /** The upload schedule's held backup and last answer, as the page draws them. */
  readonly held: ReadonlySignal<boolean>;
  readonly last: ReadonlySignal<BackupUploadResult | null>;
  /** Data requests in flight (0: the page is done with the workers). */
  readonly pending: ReadonlySignal<number>;
  /** Opens the page and reads the status. */
  open(): void;
  dispose(): void;
}

/** The held box shows: the backup is on and the schedule found a backup this TV hasn't sent. */
export function showsHeld(info: BackupStatus | null, held: boolean): boolean {
  return info !== null && info.on && held;
}

/** What a restore that didn't restore says. */
export function restoreNotice(result: BackupRestoreResult): BackupNotice {
  if (result.state === 'failed') return 'restore-failed';
  return result.state === 'newer' ? 'restore-newer' : 'restore-other';
}

/** Whether a profile's backup includes the logins and links: unless it says `backupLogins: false` (step 32d4a). */
export function includesLogins(profile: LoadedProfile | null): boolean {
  return profile === null || (profile.doc as { backupLogins?: unknown }).backupLogins !== false;
}

/** The switch zone's rows: the backup, and its logins while it is on (with the profile read). */
export function switchRows(info: BackupStatus | null, logins: boolean | null): number {
  return info !== null && info.on && logins !== null ? 2 : 1;
}

function switchZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'switch', axis: 'vertical', count, neighbours: { down: 'held' } };
}

function heldZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'held', axis: 'horizontal', count, neighbours: { up: 'switch' } };
}

/** The worker's status request: the call's salt and secret, without its API base. */
function prepareOf(request: BackupCallRequest): BackupPrepareRequest {
  return { platform: request.platform, appId: request.appId, secret: request.secret };
}

function switchOf(request: BackupCallRequest, on: boolean): BackupSwitchRequest {
  return { platform: request.platform, appId: request.appId, secret: request.secret, base: request.base, on };
}

export function createBackupPage(options: BackupPageOptions): BackupPage {
  const { nav, engine, host } = options;
  const schedule = host.schedule;
  const status = signal<BackupPageStatus>('loading');
  const info = signal<BackupStatus | null>(null);
  const logins = signal<boolean | null>(null);
  const busy = signal<BackupBusy | null>(null);
  const notice = signal<BackupNotice | null>(null);
  const question = signal<BackupQuestion | null>(null);
  const pending = signal(0);
  const screen = signal<Screen | null>(null);
  let disposed = false;
  /** Bumps on each read: an older read's answer is dropped. */
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

  /**
   * The switch rows and the held box's buttons follow the status, the profile and the schedule: a
   * focus in the held box moves up when it goes, one on the logins' row clamps to the backup's.
   */
  const stopZones = effect(() => {
    const rows = switchRows(info.value, logins.value);
    const count = showsHeld(info.value, schedule.held.value) ? 2 : 0;
    const shown = screen.value;
    if (shown === null || !shown.open) return;
    shown.update(switchZone(rows));
    shown.update(heldZone(count));
    if (count === 0 && shown.active === 'held') shown.focus('switch', SWITCH_BACKUP);
  });

  /** Reads the status (again): the page shows the last read's answer. */
  const read = (): Promise<void> => {
    readSeq += 1;
    const seq = readSeq;
    return track(() => host.request().then((request) => Promise.all([engine.backupStatus(prepareOf(request)), engine.profile()]))).then(
      (both) => {
        if (disposed || seq !== readSeq) return;
        logins.value = includesLogins(both[1]);
        info.value = both[0];
        status.value = 'ready';
      },
      (error: unknown) => {
        if (disposed || seq !== readSeq) return;
        console.warn("The backup's status could not be read", error);
        info.value = null;
        logins.value = null;
        status.value = 'failed';
      },
    );
  };

  /**
   * Runs an action: `busy` while it runs, `notice` when it didn't work, then the status again.
   * (Never while another runs: the page's OK starts nothing while busy.)
   */
  const act = (kind: BackupBusy, run: () => Promise<BackupNotice | null | 'restarting'>, failed: BackupNotice): void => {
    if (disposed) return;
    busy.value = kind;
    notice.value = null;
    void track(run)
      .catch((error: unknown): BackupNotice => {
        console.warn('The backup action failed', kind, error);
        return failed;
      })
      .then((said) => {
        // The app is starting again on the restored profile: the page stays as it is.
        if (said === 'restarting' || disposed) return;
        notice.value = said;
        return read().then(() => {
          busy.value = null;
        });
      });
  };

  const turn = (on: boolean): void => {
    act(
      on ? 'on' : 'off',
      () =>
        host.request().then((request) =>
          schedule
            .hold(() => engine.setBackup(switchOf(request, on)))
            // On: a run at once (after the hold, so it sends as the backup now is).
            .then(() => (on ? schedule.uploadNow().then(() => null) : null)),
        ),
      on ? 'on-failed' : 'off-failed',
    );
  };

  /**
   * The logins and links in the backup, on or off (step 32d4b): the profile's edit inside the hold,
   * then a run at once (the copy on the server loses them, or gets them, now).
   */
  const setLogins = (on: boolean): void => {
    act(
      'logins',
      () =>
        schedule
          .hold(() => engine.editProfile({ kind: 'backupLogins', on }))
          .then(() => schedule.uploadNow())
          .then(() => null),
      'logins-failed',
    );
  };

  const restore = (): void => {
    act(
      'restore',
      () =>
        host.request().then((request) =>
          schedule.hold(() =>
            host.quiet(() =>
              engine.restoreHeldBackup(request).then((result): BackupNotice | 'restarting' => {
                if (result.state !== 'restored') return restoreNotice(result);
                host.restart();
                return 'restarting';
              }),
            ),
          ),
        ),
      'restore-failed',
    );
  };

  const replace = (): void => {
    act(
      'replace',
      () => schedule.replaceNow().then((answer) => (answer === null || answer.state === 'failed' ? 'replace-failed' : null)),
      'replace-failed',
    );
  };

  /** Closes the confirm dialog (it is on top: only its own keys call this). */
  const closeQuestion = (): void => {
    question.value = null;
    nav.pop();
  };

  const ask = (what: BackupQuestion): void => {
    question.value = what;
    const shown = nav.push({
      id: BACKUP_CONFIRM,
      zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 2 }],
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        closeQuestion();
        return true;
      },
      onSelect: (focus) => {
        closeQuestion();
        if (focus.index !== CONFIRM_YES) return;
        if (what === 'off') turn(false);
        else if (what === 'restore') restore();
        else replace();
      },
    });
    // The safe answer first: each of them changes what can't be had back by this page.
    shown.focus('actions', CONFIRM_NO);
  };

  return {
    screen,
    status,
    info,
    logins,
    busy,
    notice,
    question,
    held: schedule.held,
    last: schedule.last,
    pending,
    open(): void {
      if (disposed) return;
      status.value = 'loading';
      info.value = null;
      logins.value = null;
      notice.value = null;
      screen.value = nav.push({
        id: BACKUP_SCREEN,
        zones: [switchZone(1), heldZone(0)],
        onSelect: (focus) => {
          if (busy.peek() !== null) return;
          const now = info.peek();
          if (focus.zone === 'switch') {
            if (now === null) return;
            const included = logins.peek();
            // (The logins' row is there only while on, with the profile read.)
            if (focus.index === SWITCH_LOGINS && included !== null) setLogins(!included);
            else if (now.on) ask('off');
            else turn(true);
          } else if (focus.zone === 'held') {
            ask(focus.index === HELD_RESTORE ? 'restore' : 'replace');
          }
        },
      });
      void read();
    },
    dispose(): void {
      disposed = true;
      stopZones();
    },
  };
}
