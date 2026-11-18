import type { ReadonlySignal } from '@preact/signals';
import type { BackupUploadResult, ConfigResult, ConfigStatus } from '@lablo/data';
import type { Focus, Navigator } from '@lablo/ui';

/**
 * `window.__LABLO_TEST__` (RELAY step 14b, architecture.md §4): what the focus engine has
 * focused, for the e2e `RemoteDriver` (e2e/remote-driver.ts) and the old-engine harness.
 *
 * - **Engine, not DOM:** the path comes from the navigator of the screen on show, so a test can
 *   tell a focus that moved from one that only rendered.
 * - **In every build:** the old-engine harness tests the bundles that ship, so they carry it. It
 *   holds no data: a screen, a zone and an index, and the config's verdict.
 * - **The config** (step 30c1): the last config answer as plain data, and a refresh now. The
 *   refresh is the same fetch the schedule makes every 6 h, so a test can serve a changed config
 *   and see it arrive without waiting.
 * - **The backup** (step 32c2): whether a backup worker may be in the database (the look-up at a
 *   start with no profile, an upload), for the old-engine walk's idle wait; and an upload now, so
 *   an e2e test needn't wait 60 s for one.
 */
export interface LabloTestHook {
  /** `screen/zone/index` of the screen on show (`live/channels/3`), or null before one shows. */
  focusPath(): string | null;
  /** The last config answer, or null before the first (and on the developer screens). */
  config(): ConfigView | null;
  /** A config run now (`ConfigSchedule.refreshNow`), resolving with its answer. */
  refreshConfig(): Promise<ConfigView | null>;
  /**
   * No config run in progress or due (`ConfigSchedule.idle`): the old-engine walk waits for it
   * before leaving a page, so no worker is in the database then. True without a schedule.
   */
  configIdle(): boolean;
  /** No backup look-up or upload running (step 32c2). True without a backup schedule. */
  backupIdle(): boolean;
  /** An upload now (`BackupSchedule.uploadNow`), resolving with its state (`null`: none ran). */
  uploadBackup(): Promise<string | null>;
}

/** A config answer as a test reads it (JSON-safe; `LabloConfigView` in env.d.ts). */
export interface ConfigView {
  readonly status: ConfigStatus;
  /** A `ConfigFailure`. */
  readonly failure: string | null;
  readonly issuedAt: number | null;
  /** The kill rule in force (not a notice), or null. */
  readonly kill: { readonly id: string; readonly mode: string } | null;
  /** The matching notices' ids, in the doc's order. */
  readonly notices: readonly string[];
  readonly updateRequired: boolean;
}

/** What the hook reads the config from (the app's `ConfigSchedule`). */
export interface ConfigHookSource {
  readonly last: ReadonlySignal<ConfigResult | null>;
  refreshNow(): Promise<ConfigResult | null>;
  idle(): boolean;
}

/** What the hook reads the backup from (main.tsx: the look-up's flag and the upload schedule). */
export interface BackupHookSource {
  idle(): boolean;
  uploadNow(): Promise<BackupUploadResult | null>;
}

export interface TestHookTarget {
  __LABLO_TEST__?: LabloTestHook;
}

/** `live/channels/3`: the focus as a path. */
export function focusPath(focus: Pick<Focus, 'screen' | 'zone' | 'index'>): string {
  return focus.screen + '/' + focus.zone + '/' + focus.index;
}

/** A config answer as plain data (no message texts: a test asks about rules by id). */
export function configView(result: ConfigResult | null): ConfigView | null {
  if (result === null) return null;
  const { kill, notices, updateRequired } = result.policy;
  return {
    status: result.status,
    failure: result.failure,
    issuedAt: result.issuedAt,
    kill: kill === null ? null : { id: kill.id, mode: kill.mode },
    notices: notices.map((notice) => notice.id),
    updateRequired,
  };
}

/**
 * Puts the hook on `target` (the window). Returns the setter main.tsx calls with each screen's
 * navigator as it shows (`null`: none, e.g. while the start reads the profile). Without
 * `config` (the developer screens), `config()` is null and `refreshConfig()` resolves null;
 * without `backup`, `backupIdle()` is true and `uploadBackup()` resolves null.
 */
export function installTestHook(target: TestHookTarget, config: ConfigHookSource | null = null, backup: BackupHookSource | null = null): (nav: Pick<Navigator, 'snapshot'> | null) => void {
  let current: Pick<Navigator, 'snapshot'> | null = null;
  target.__LABLO_TEST__ = {
    focusPath: () => (current === null ? null : focusPath(current.snapshot())),
    config: () => (config === null ? null : configView(config.last.peek())),
    refreshConfig: () => (config === null ? Promise.resolve(null) : config.refreshNow().then(configView)),
    configIdle: () => config === null || config.idle(),
    backupIdle: () => backup === null || backup.idle(),
    uploadBackup: () => (backup === null ? Promise.resolve(null) : backup.uploadNow().then((result) => (result === null ? null : result.state))),
  };
  return (nav) => {
    current = nav;
  };
}
