import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { IngestResult, LinkSource, LoadedProfile, ProfileDoc, ProfileEdit, SourceMeta, SourceRecord, StoredSource } from '@lablo/data';
import { sourceFavouriteCount } from '@lablo/data/client';
import type { Platform } from '@lablo/platform-api';
import type { Navigator, Screen, ScreenSpec, TextEditorOptions, ZoneSpec } from '@lablo/ui';
import { SCREEN, fits } from '@lablo/ui';
import { sourceUrlOf } from '../data/engine';
import { ingestSourceOf, loadError, needsLogin, storedSources } from '../onboarding/engine-loader';
import type { LoadErrorCode, SourceLoader } from '../onboarding/loader';
import type { Refusal } from '../gate/gate-state';
import type { AddForm } from './source-add';
import { createAddForm } from './source-add';
import { GUIDES, shownLink } from './guides-state';
import type { LoginForm } from './source-login';
import { createLoginForm } from './source-login';

/**
 * The sources screen (RELAY step 30c3a): the playlists and panels the user added, opened by the
 * settings screen's "Sources" row and pushed on the live navigator.
 *
 *   header   ("Add from your phone", step 31c2a: the pairing screen; only when the app can pair, and
 *             "Add a source", step 40f: the form on the TV, `source-add.ts`)
 *   sources  (one row per stored source, in the profile's order: its name, its kind and server,
 *             and when its catalog was last updated; OK opens its menu)
 *
 * - **Reads,** when it opens: the profile (the sources, their names and their links), every
 *   catalog's record (`sourceStatus`: when it was last checked), then the signed config's
 *   blocklist for each source's server (`blocked`). A source on a blocked server isn't updated
 *   (the data engine refuses its refresh), and its row says so.
 * - **The server** shown is the host (and port) only: never the login, the path or the query
 *   (an M3U link may carry the login in either).
 * - **A source without its login** (step 32d4b: a backup made without logins brought it back) says
 *   it needs its login (Xtream) or link (M3U); OK opens the login form (`source-login.ts`). "Save"
 *   writes the source with its login (`editProfile`), then refreshes it (`login.refresh`: the data
 *   engine's own refresh, with no other running), and the row shows the answer: "Updating…", then
 *   when it was updated, or why it failed (OK opens the form again). The answers last as long as
 *   the settings, so a screen opened again still shows them.
 * - **A row's menu** (step 40f, OK on the row): "Change server and login" (the login form again, for
 *   a source with a login or a link; a phone's file has none) and "Remove". "Remove" asks first
 *   (`SOURCE_REMOVE`): the confirm says how many favourites go, and "Cancel" has the focus. A
 *   removal takes the source's catalog, favourites, locks, places and mappings with it
 *   (`DataEngine.removeSource`); the row says "Removing…" until it is done. One that fails leaves the
 *   row with its failure line. Adding the same source again starts fresh.
 * - Back closes it (the navigator's own Back).
 */

export const SOURCES_SCREEN = 'sources';
/** A row's menu and the removal's confirm (step 40f), over the sources screen. */
export const SOURCE_MENU = 'source-menu';
export const SOURCE_REMOVE = 'source-remove';

/** Under the header and its line, as on the guides screen; a source's row is a guide's. */
export const SOURCES_BODY = SCREEN.height - 2 * SCREEN.safeY - GUIDES.headerHeight - GUIDES.headerGap - GUIDES.introHeight;
export const SOURCES_VISIBLE = fits(SOURCES_BODY, GUIDES.rowHeight, GUIDES.rowGap);

/** One row of the sources screen. */
export interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly type: StoredSource['type'];
  /** The server as shown: its host and port, nothing else (a file from the phone has none: empty). */
  readonly host: string;
  /** When its catalog was last checked (`checkedAt`, else `updatedAt`; `null`: never). */
  readonly checkedAt: number | null;
  /** Its server is on the signed config's blocklist: it isn't updated. */
  readonly blocked: boolean;
  /** Its last refresh in this run failed because Lablo's storage is full (step 39s1). */
  readonly storage: boolean;
  /** A backup without logins brought it back without its login (Xtream) or link (M3U) (step 32d4b; `null`: it has it). */
  readonly needs: 'login' | 'link' | null;
  /** Its last save's answer (step 32d4b; `null`: none, or it worked). */
  readonly answer: SaveAnswer | null;
}

/** A save's answer (step 32d4b): its refresh running, or why the save or the refresh failed. */
export type SaveAnswer = { readonly state: 'updating' } | { readonly state: 'removing' } | { readonly state: 'failed'; readonly code: LoadErrorCode; readonly status: number | null };

const UPDATING: SaveAnswer = { state: 'updating' };
const REMOVING: SaveAnswer = { state: 'removing' };

/** What a row's menu offers (step 40f), in screen order. */
export type SourceAction = 'edit' | 'remove' | 'cancel';

/** The menu on show: its source and its buttons. */
export interface SourceMenu {
  readonly row: SourceRow;
  readonly actions: readonly SourceAction[];
}

/** The removal's confirm on show: the source, and how many of its favourites go with it. */
export interface SourceRemoval {
  readonly row: SourceRow;
  readonly favourites: number;
}

/** The confirm's buttons: "Remove", then "Cancel" (which has the focus). */
export const REMOVE_CONFIRM = 0;
export const REMOVE_CANCEL = 1;

/** A row's menu buttons: "Change server and login" for a source that has a login or a link (never a phone's file), "Remove", "Cancel". */
export function menuActions(row: SourceRow, canEdit: boolean): readonly SourceAction[] {
  return canEdit && row.type !== 'm3u-file' ? ['edit', 'remove', 'cancel'] : ['remove', 'cancel'];
}

export type SourcesStatus = 'loading' | 'ready' | 'failed';

/** What the screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface SourcesEngine {
  profile(): Promise<LoadedProfile | null>;
  sourceStatus(): Promise<SourceMeta[]>;
  blocked(urls: string[]): Promise<boolean[]>;
  /** The login form's save: the `source` edit (step 32d4b). */
  editProfile(edit: ProfileEdit): Promise<boolean>;
  /** A source's removal (step 40f): its catalog and everything in the profile that names it. */
  removeSource(src: string): Promise<boolean>;
}

/** The login form's needs (step 32d4b): the TV's keyboard and the save's refresh. */
export interface SourceLoginOptions {
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds a field's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  readonly now?: () => number;
  /**
   * Refreshes the source given its login, with no other refresh running (main's `quiet`), then
   * tells the screens; resolves with the refresh's result, rejects with its error. Without it the
   * save only writes the login (the schedule reads the source later).
   */
  readonly refresh?: (src: string, source: LinkSource) => Promise<IngestResult>;
}

export interface SourcesOptions {
  readonly nav: Navigator;
  readonly engine: SourcesEngine;
  /**
   * The header's "Add from your phone" (step 31c2a). The list keeps the first focus; an empty
   * list gives it to the button. Without it the screen has no header.
   */
  readonly addFromPhone?: () => void;
  /**
   * "Add a source" (step 40f): the form on the TV, loaded by `loader`. It needs `login` (the
   * keyboard). The list keeps the first focus, as with the phone's add.
   */
  readonly add?: {
    readonly loader: SourceLoader;
    readonly refusal?: ReadonlySignal<Refusal | null>;
    readonly busy?: (on: boolean) => void;
    readonly setPin?: (kept: () => void) => void;
  };
  /** A source was added or removed here: the screens read the catalogs again (main's `sourceAdded`). */
  readonly changed?: () => void;
  /** Runs a removal with the refreshes held and no refresh running (main's `quiet`); without it the removal runs as it is. */
  readonly quiet?: <T>(job: () => Promise<T>) => Promise<T>;
  /** The login form for a source without its login (step 32d4b); without it, OK on a row does nothing. */
  readonly login?: SourceLoginOptions;
  /** Whether a source's last refresh failed for space (step 39s1, main's storage state); without it, none did. */
  readonly storageFull?: (src: string) => boolean;
}

export interface SourcesList {
  /** The sources screen while it is on the stack (the login form covers it). */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly status: ReadonlySignal<SourcesStatus>;
  readonly rows: ReadonlySignal<readonly SourceRow[]>;
  /** Data requests in flight (0: the screen is done with the workers). */
  readonly pending: ReadonlySignal<number>;
  /** The screen has the header's "Add from your phone" (step 31c2a), or "Add a source" (step 40f). */
  readonly canAdd: boolean;
  /** The header's first button is "Add from your phone". */
  readonly phone: boolean;
  /** The form on the TV (step 40f), when the screen has one. */
  readonly add: AddForm | null;
  /** A row's menu while it shows (step 40f). */
  readonly menu: ReadonlySignal<SourceMenu | null>;
  /** The removal's confirm while it shows (step 40f). */
  readonly removing: ReadonlySignal<SourceRemoval | null>;
  /** The login form (step 32d4b), when the screen has one. */
  readonly form: LoginForm | null;
  /** Opens the screen and reads the sources. */
  open(): void;
  /** Reads the sources again while the screen is open (a source was added): the focus stays. */
  reload(): void;
  dispose(): void;
}

/** A source's server as the screen shows it: the host and port of its link, nothing else. */
export function shownHost(url: string): string {
  const link = shownLink(url);
  const slash = link.indexOf('/');
  return slash === -1 ? link : link.slice(0, slash);
}

/** A stored source's link or server (`''` for a file from the phone, which has none; what a source without its login kept, step 32d4a). */
function linkOf(record: StoredSource): string {
  const source = ingestSourceOf(record);
  return source === null ? '' : sourceUrlOf(source);
}

/**
 * The rows, in the profile's order; `blocked[i]` is the i-th source's answer (missing: not
 * blocked), `answers` the saves' answers by source id (step 32d4b), `full` whether a source's
 * refresh failed for space (step 39s1).
 */
export function sourceRows(
  profile: LoadedProfile | null,
  metas: readonly SourceMeta[],
  blocked: readonly boolean[],
  answers: Readonly<Record<string, SaveAnswer>> = {},
  full: (src: string) => boolean = () => false,
): SourceRow[] {
  const rows: SourceRow[] = [];
  const records = storedSources(profile);
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    let meta: SourceMeta | null = null;
    for (let m = 0; m < metas.length; m += 1) if (metas[m]!.src === record.id) meta = metas[m]!;
    const checkedAt = meta === null ? null : (meta.checkedAt ?? meta.updatedAt);
    rows.push({
      id: record.id,
      name: record.name,
      type: record.type,
      // A file from the phone: no link, no server shown (`shownHost('')` is empty).
      host: shownHost(linkOf(record)),
      checkedAt: meta !== null && meta.gen > 0 ? checkedAt : null,
      // A file has no server to block (its URL is empty; its streams are checked as they play).
      blocked: record.type !== 'm3u-file' && blocked[i] === true,
      storage: full(record.id),
      needs: needsLogin(record) ? (record.type === 'xtream' ? 'login' : 'link') : null,
      answer: answers[record.id] ?? null,
    });
  }
  return rows;
}

/** The header's buttons (step 31c2a: "Add from your phone"; step 40f: "Add a source"). */
function headerZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'header', axis: 'horizontal', count, neighbours: { down: 'sources' } };
}

function sourcesZone(count: number, header: boolean): ZoneSpec {
  return header
    ? { kind: 'list', id: 'sources', axis: 'vertical', count, visible: SOURCES_VISIBLE, neighbours: { up: 'header' } }
    : { kind: 'list', id: 'sources', axis: 'vertical', count, visible: SOURCES_VISIBLE };
}

export function createSourcesList(options: SourcesOptions): SourcesList {
  const { nav, engine } = options;
  const phone = options.addFromPhone !== undefined;
  const addOptions = options.add;
  // (The form needs the keyboard: the login's.)
  const canAddHere = addOptions !== undefined && options.login !== undefined;
  const header = phone || canAddHere;
  const headerCount = (phone ? 1 : 0) + (canAddHere ? 1 : 0);
  const full = options.storageFull ?? ((): boolean => false);
  const status = signal<SourcesStatus>('loading');
  const rows = signal<readonly SourceRow[]>([]);
  const pending = signal(0);
  const screen = signal<Screen | null>(null);
  const menu = signal<SourceMenu | null>(null);
  const removing = signal<SourceRemoval | null>(null);
  let disposed = false;
  /** Bumps on each opening: an older opening's answer is dropped. */
  let openSeq = 0;
  /** The last read: what the rows are drawn from again when an answer changes. */
  let last: { readonly profile: LoadedProfile | null; readonly metas: readonly SourceMeta[]; readonly blocked: readonly boolean[] } | null = null;
  /** The saves' answers by source id (step 32d4b), for as long as the settings live. */
  const answers: Record<string, SaveAnswer> = {};

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

  const read = (seq: number): void => {
    const current = (): boolean => !disposed && seq === openSeq;
    track(() => Promise.all([engine.profile(), engine.sourceStatus()]))
      .then((both) => {
        if (!current()) return null;
        const profile = both[0];
        const metas = both[1];
        // A file from the phone has no server: an empty URL, never blocked (its streams are checked as they play).
        const urls = storedSources(profile).map((record) => linkOf(record));
        // An unknown blocklist blocks nothing (as the data engine reads it).
        const asked = track(() => engine.blocked(urls)).catch((error: unknown): boolean[] => {
          console.warn('The blocklist could not be read', error);
          return [];
        });
        return asked.then((blocked) => {
          if (!current()) return;
          last = { profile, metas, blocked };
          rows.value = sourceRows(profile, metas, blocked, answers, full);
          status.value = 'ready';
          // (A closed screen ignores updates and focus moves.)
          screen.value?.update(sourcesZone(rows.value.length, header));
          if (header && rows.value.length === 0) screen.value?.focus('header', 0);
        });
      })
      .catch((error: unknown) => {
        if (!current()) return;
        console.warn('The sources could not be read', error);
        status.value = 'failed';
      });
  };

  /** Reads the rows again while the screen is open: the focus stays. */
  const reload = (): void => {
    if (disposed || screen.value === null || !screen.value.open) return;
    openSeq += 1;
    read(openSeq);
  };

  /** The rows drawn again from the last read, with the answers as they are now. */
  const draw = (): void => {
    if (last !== null) rows.value = sourceRows(last.profile, last.metas, last.blocked, answers, full);
  };

  /**
   * The login form's "Save" (step 32d4b): the source with its login written, then refreshed; the
   * row says "Updating…" until the answer, then the rows are read again. A login the server
   * refused stays written: the row says so, and OK opens the form again with it.
   */
  const save = (record: SourceRecord): void => {
    if (disposed) return;
    answers[record.id] = UPDATING;
    draw();
    const refresh = options.login?.refresh;
    // (The form gives a login or a link: never a file.)
    const source = ingestSourceOf(record) as LinkSource;
    track(() => engine.editProfile({ kind: 'source', source: record }))
      .then(() => {
        // Its mark goes at once: the login is stored.
        reload();
        return refresh === undefined ? null : track(() => refresh(record.id, source));
      })
      .then(
        () => {
          delete answers[record.id];
        },
        (error: unknown) => {
          const failure = loadError(error);
          answers[record.id] = { state: 'failed', code: failure.code, status: failure.status };
          console.warn("The source's login was not saved or not read", error);
        },
      )
      // The rows with the answer (a screen opened again reads them too).
      .then(reload);
  };

  const form = options.login === undefined ? null : createLoginForm({ nav, platform: options.login.platform, find: options.login.find, now: options.login.now, save });
  const add: AddForm | null =
    !canAddHere || options.login === undefined || addOptions === undefined
      ? null
      : createAddForm({
          nav,
          platform: options.login.platform,
          find: options.login.find,
          now: options.login.now,
          loader: addOptions.loader,
          refusal: addOptions.refusal,
          busy: addOptions.busy,
          setPin: addOptions.setPin,
          added: () => {
            reload();
            options.changed?.();
          },
        });

  const closeMenu = (): void => {
    menu.value = null;
    nav.pop();
  };

  const closeRemoval = (): void => {
    removing.value = null;
    nav.pop();
  };

  /** The removal (step 40f): "Removing…" on the row until the engine is done, then the rows again. */
  const remove = (row: SourceRow): void => {
    if (disposed) return;
    answers[row.id] = REMOVING;
    draw();
    const run = (): Promise<boolean> => engine.removeSource(row.id);
    track(() => (options.quiet === undefined ? run() : options.quiet(run)))
      .then(
        () => {
          delete answers[row.id];
          options.changed?.();
        },
        (error: unknown) => {
          answers[row.id] = { state: 'failed', code: loadError(error).code, status: loadError(error).status };
          console.warn('The source was not removed', error);
        },
      )
      .then(reload);
  };

  /** The confirm (step 40f): what goes with the source, "Cancel" focused. */
  const confirmRemoval = (row: SourceRow): void => {
    removing.value = { row, favourites: sourceFavouriteCount(last === null || last.profile === null ? null : (last.profile.doc as ProfileDoc), row.id) };
    const shown = nav.push({
      id: SOURCE_REMOVE,
      zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 2 }],
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        closeRemoval();
        return true;
      },
      onSelect: (focus) => {
        closeRemoval();
        if (focus.index === REMOVE_CONFIRM) remove(row);
      },
    });
    shown.focus('actions', REMOVE_CANCEL);
  };

  const act = (action: SourceAction | undefined, row: SourceRow): void => {
    closeMenu();
    if (action === 'remove') {
      confirmRemoval(row);
      return;
    }
    if (action !== 'edit' || form === null) return;
    const records = storedSources(last === null ? null : last.profile);
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i]!;
      if (record.id === row.id && record.type !== 'm3u-file') form.open(record);
    }
  };

  /** OK on a row: its menu (step 40f). A row whose removal runs has none. */
  const select = (index: number): void => {
    const row = rows.value[index];
    if (row === undefined || (row.answer !== null && row.answer.state !== 'failed')) return;
    const actions = menuActions(row, form !== null);
    menu.value = { row, actions };
    nav.push({
      id: SOURCE_MENU,
      zones: [{ kind: 'list', id: 'actions', axis: 'vertical', count: actions.length }],
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        closeMenu();
        return true;
      },
      onSelect: (focus) => act(actions[focus.index], row),
    });
  };

  /** The header's buttons: "Add from your phone" first when there is one, then "Add a source". */
  const addAt = (index: number): void => {
    if (phone && index === 0) options.addFromPhone?.();
    else add?.open();
  };

  return {
    screen,
    status,
    rows,
    pending,
    canAdd: header,
    phone,
    add,
    menu,
    removing,
    form,
    open(): void {
      if (disposed) return;
      openSeq += 1;
      status.value = 'loading';
      rows.value = [];
      const spec: ScreenSpec = header
        ? {
            id: SOURCES_SCREEN,
            zones: [headerZone(headerCount), sourcesZone(0, true)],
            initial: 'sources',
            onSelect: (focus) => {
              if (focus.zone === 'header') addAt(focus.index);
              else select(focus.index);
            },
          }
        : { id: SOURCES_SCREEN, zones: [sourcesZone(0, false)], onSelect: (focus) => select(focus.index) };
      screen.value = nav.push(spec);
      read(openSeq);
    },
    reload,
    dispose(): void {
      disposed = true;
      form?.dispose();
      add?.dispose();
    },
  };
}
