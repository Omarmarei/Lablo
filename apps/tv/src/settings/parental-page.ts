import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { ContentKind } from '@lablo/core';
import type { CategoryInfo, LoadedProfile, ProfileEdit } from '@lablo/data';
import type { LockRef, ParentalChange } from '@lablo/data/client';
import { parentalOf } from '@lablo/data/client';
import type { LifecycleEvent, Platform } from '@lablo/platform-api';
import type { Navigator, Screen, TextEditorOptions, ZoneSpec } from '@lablo/ui';
import { storedSources } from '../onboarding/engine-loader';
import type { SourceDraft } from '../onboarding/form';
import { GROUPS_VISIBLE } from './groups-state';
import type { PinCheck } from './pin-check';
import { PIN_CHECK_SCREENS, createPinCheck } from './pin-check';

/**
 * Settings › "Parental control" (RELAY step 38c1, architecture.md §1.4 item 10 "Built in step
 * 38c1"), pushed on the live navigator from the settings screen:
 *
 *   rows  (with a PIN: "Change the PIN", "Lock adult groups" with its value, "Locked groups",
 *         "Forgot your PIN?"; with none, "Set a PIN")
 *
 * - **The PIN, once a visit:** the first row chosen asks it on the PIN pad (`ParentalAsk.ask`:
 *   the query worker checks it, the session left as it is); the page then stays open until it
 *   closes or the app is hidden. The page itself shows nothing locked.
 * - **"Change the PIN":** the pad's new PIN, typed twice (`ParentalAsk.choose`); then the row's
 *   line says it changed.
 * - **"Lock adult groups":** OK switches it (the `parental` edit `adult`), as "Usage and crash
 *   reports" does; the screens read again (`changed`).
 * - **"Locked groups"** (`LOCKED_SCREEN`): every group of every source, live, then movies, then
 *   series, each with its lock (the worker's `categories` marks them, names included); OK switches
 *   one (the `parental` edit `group`, kept both ways), then the rows and the screens read again.
 * - **"Set a PIN" and "Forgot your PIN?"** (step 38c2) ask no PIN: one source's login typed again
 *   (`pin-check.ts`), or sent from the phone (step 38c4, `phone`), then the pad's new PIN; once
 *   kept, the page reads again and the visit counts as granted (the login was just given).
 *
 * Main-safe as the settings are: no `trim`, `.sort(` or regex.
 */

export const PARENTAL_SCREEN = 'parental';
export const LOCKED_SCREEN = 'locked-groups';
/** The page's screens, for the settings' list of screens (the PIN's check, step 38c2, too). */
export const PARENTAL_SCREENS: readonly string[] = [PARENTAL_SCREEN, LOCKED_SCREEN].concat(PIN_CHECK_SCREENS);

export type ParentalRow = 'change' | 'adult' | 'groups' | 'forgot' | 'set';

/** The kinds in "Locked groups"' order. */
export const LOCK_KINDS: readonly ContentKind[] = ['live', 'movie', 'series'];

/** A group on "Locked groups". */
export interface LockRow {
  readonly group: LockRef;
  readonly adult: boolean;
  readonly locked: boolean;
  /** Its source's name when there are two sources or more (`''`: one source). */
  readonly source: string;
}

export type PageStatus = 'loading' | 'ready' | 'failed';

/** The PIN pad, as main.js's parental control gives it (`Parental.ask`, `Parental.choose`). */
export interface ParentalAsk {
  /** The PIN, the session left as it is: `done` after the right one. */
  ask(done: () => void): void;
  /** A new PIN typed twice: `done` once it is kept. */
  choose(done: () => void): void;
}

/** What the page needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface ParentalPageEngine {
  profile(): Promise<LoadedProfile | null>;
  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]>;
  editProfile(edit: ProfileEdit): Promise<boolean>;
}

export interface ParentalPageOptions {
  readonly nav: Navigator;
  readonly engine: ParentalPageEngine;
  readonly pad: ParentalAsk;
  /** The locks changed: the live, movies, series, search and Home screens read again. */
  readonly changed?: () => void;
  /** The platform's lifecycle: the page asks the PIN again after the app was hidden. */
  readonly lifecycle?: (listener: (event: LifecycleEvent) => void) => () => void;
  /** The TV's keyboard for the PIN's login check (step 38c2). */
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** The pairing screen for the check by phone (step 38c4, `Pairing.check`); without it the check is typed only. */
  readonly phone?: (matches: (source: SourceDraft) => boolean, matched: () => void) => void;
  /** Finds a field's input (tests). */
  readonly find?: TextEditorOptions['find'];
  /** The clock (the click pairing in the editor). */
  readonly now?: () => number;
}

export interface ParentalPage {
  /** The page while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<PageStatus>;
  /** A PIN is set (`null`: not read yet). */
  readonly pin: ReadonlySignal<boolean | null>;
  /** "Lock adult groups" (`null`: not read yet). */
  readonly adult: ReadonlySignal<boolean | null>;
  readonly rows: ReadonlySignal<readonly ParentalRow[]>;
  /** The last change didn't take. */
  readonly failed: ReadonlySignal<boolean>;
  /** The PIN was changed in this visit. */
  readonly changedPin: ReadonlySignal<boolean>;
  /** "Locked groups" while it is on the stack. */
  readonly lockedScreen: ReadonlySignal<Screen | null>;
  readonly lockedStatus: ReadonlySignal<PageStatus>;
  readonly groups: ReadonlySignal<readonly LockRow[]>;
  /** Reads and edits in flight: 0 means settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  /** The PIN's login check (step 38c2): this page's rows, and the rails' no-PIN dialog. */
  readonly check: PinCheck;
  /** Opens the page and reads it. */
  open(): void;
  dispose(): void;
}

/** The page's rows: with a PIN, the three behind it and "Forgot your PIN?"; with none, "Set a PIN" (step 38c2). */
export function parentalRows(pin: boolean): ParentalRow[] {
  return pin ? ['change', 'adult', 'groups', 'forgot'] : ['set'];
}

/**
 * The groups of `found` (each source's categories of each kind, in `LOCK_KINDS`' order inside a
 * source) as rows: every kind's groups across the sources, live first, each source's in its order.
 */
export function lockRows(found: readonly { readonly src: string; readonly name: string; readonly kinds: readonly (readonly CategoryInfo[])[] }[]): LockRow[] {
  const rows: LockRow[] = [];
  for (let k = 0; k < LOCK_KINDS.length; k += 1) {
    for (let s = 0; s < found.length; s += 1) {
      const source = found[s]!;
      const infos = source.kinds[k] ?? [];
      for (let i = 0; i < infos.length; i += 1) {
        const info = infos[i]!;
        rows.push({
          group: { src: source.src, kind: LOCK_KINDS[k]!, name: info.name },
          adult: info.adult === true,
          locked: info.locked === true,
          source: found.length > 1 ? source.name : '',
        });
      }
    }
  }
  return rows;
}

export function createParentalPage(options: ParentalPageOptions): ParentalPage {
  const { nav, engine, pad } = options;
  const screen = signal<Screen | null>(null);
  const status = signal<PageStatus>('loading');
  const pin = signal<boolean | null>(null);
  const adult = signal<boolean | null>(null);
  const rows = signal<readonly ParentalRow[]>([]);
  const failed = signal(false);
  const changedPin = signal(false);
  const lockedScreen = signal<Screen | null>(null);
  const lockedStatus = signal<PageStatus>('loading');
  const groups = signal<readonly LockRow[]>([]);
  const pending = signal(0);
  const check = createPinCheck({ nav, engine, platform: options.platform, find: options.find, now: options.now, phone: options.phone });
  let disposed = false;
  /** The PIN was given in this visit. */
  let granted = false;
  /** Bumps on each read: an older read's answer is dropped. */
  let readSeq = 0;
  let groupsSeq = 0;

  /** Runs `request`, counting it in `pending` until it settles either way. */
  function track<T>(request: () => Promise<T>): Promise<T> {
    pending.value += 1;
    let running: Promise<T>;
    try {
      running = request();
    } catch (error) {
      running = Promise.reject(error);
    }
    const settle = (): void => {
      pending.value -= 1;
    };
    running.then(settle, settle);
    return running;
  }

  const zone = (count: number): ZoneSpec => ({ kind: 'list', id: 'rows', axis: 'vertical', count });
  const groupsZone = (count: number): ZoneSpec => ({ kind: 'list', id: 'rows', axis: 'vertical', count, visible: GROUPS_VISIBLE });

  /** Reads the PIN and "Lock adult groups" again. */
  const read = (): void => {
    readSeq += 1;
    const seq = readSeq;
    track(() => engine.profile()).then(
      (profile) => {
        if (disposed || seq !== readSeq) return;
        const state = parentalOf(profile === null ? null : profile.doc);
        pin.value = state.pin !== null;
        adult.value = state.adult;
        rows.value = parentalRows(state.pin !== null);
        status.value = 'ready';
        screen.value?.update(zone(rows.value.length));
      },
      (error: unknown) => {
        if (disposed || seq !== readSeq) return;
        console.warn('Parental control could not be read', error);
        status.value = 'failed';
      },
    );
  };

  /** Reads "Locked groups"' rows again (a lock moves no row: the focus stays on its place). */
  const readGroups = (): void => {
    groupsSeq += 1;
    const seq = groupsSeq;
    track(async () => {
      const sources = storedSources(await engine.profile());
      const found = await Promise.all(
        sources.map((source) =>
          Promise.all(LOCK_KINDS.map((kind) => engine.categories(source.id, kind))).then((kinds) => ({ src: source.id, name: source.name, kinds })),
        ),
      );
      return lockRows(found);
    }).then(
      (got) => {
        if (disposed || seq !== groupsSeq) return;
        groups.value = got;
        lockedStatus.value = 'ready';
        lockedScreen.value?.update(groupsZone(got.length));
      },
      (error: unknown) => {
        if (disposed || seq !== groupsSeq) return;
        console.warn('The groups could not be read', error);
        if (lockedStatus.value === 'loading') lockedStatus.value = 'failed';
      },
    );
  };

  /** A `parental` edit; once it went through, `after` and the screens read again; refused, the page says so. */
  const edit = (change: ParentalChange, after: () => void): void => {
    failed.value = false;
    track(() => engine.editProfile({ kind: 'parental', change })).then(
      (ok) => {
        if (disposed) return;
        if (!ok) {
          failed.value = true;
          return;
        }
        after();
        options.changed?.();
      },
      (error: unknown) => {
        if (disposed) return;
        failed.value = true;
        console.warn('Parental control was not changed', error);
      },
    );
  };

  const openGroups = (): void => {
    lockedStatus.value = 'loading';
    groups.value = [];
    lockedScreen.value = nav.push({
      id: LOCKED_SCREEN,
      zones: [groupsZone(0)],
      onSelect: (focus) => {
        const row = groups.value[focus.index];
        if (row === undefined || pending.value > 0) return;
        edit({ op: 'group', group: row.group, locked: !row.locked }, readGroups);
      },
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        groupsSeq += 1;
        lockedScreen.value = null;
        nav.pop();
        return true;
      },
    });
    readGroups();
  };

  /** A new PIN after a source's login: kept, the page reads again and the visit is granted. */
  const newPin = (): void => {
    check.run(() => {
      pad.choose(() => {
        if (disposed) return;
        granted = true;
        changedPin.value = true;
        read();
      });
    });
  };

  /** What a row does once the PIN was given ("Set a PIN" and "Forgot your PIN?" need none). */
  const act = (row: ParentalRow): void => {
    if (row === 'set' || row === 'forgot') newPin();
    else if (row === 'change') {
      pad.choose(() => {
        if (!disposed) changedPin.value = true;
      });
    } else if (row === 'adult') {
      const on = adult.value;
      if (on === null) return;
      edit({ op: 'adult', on: !on }, () => {
        adult.value = !on;
      });
    } else openGroups();
  };

  const stopLifecycle =
    options.lifecycle === undefined
      ? () => undefined
      : options.lifecycle((event) => {
          if (event === 'hidden') granted = false;
        });

  return {
    screen,
    status,
    pin,
    adult,
    rows,
    failed,
    changedPin,
    lockedScreen,
    lockedStatus,
    groups,
    pending,
    check,
    open(): void {
      if (disposed || screen.value !== null) return;
      granted = false;
      failed.value = false;
      changedPin.value = false;
      status.value = 'loading';
      screen.value = nav.push({
        id: PARENTAL_SCREEN,
        zones: [zone(rows.value.length)],
        onSelect: (focus) => {
          const row = rows.value[focus.index];
          if (row === undefined || pending.value > 0) return;
          if (granted || row === 'set' || row === 'forgot') act(row);
          else
            pad.ask(() => {
              if (disposed) return;
              granted = true;
              act(row);
            });
        },
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          readSeq += 1;
          screen.value = null;
          nav.pop();
          return true;
        },
      });
      read();
    },
    dispose(): void {
      disposed = true;
      stopLifecycle();
      check.dispose();
    },
  };
}
