import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { EpgMeta, EpgStatus, GuideChange, LoadedProfile, ProfileEdit } from '@zoma/data';
// The client entry only: the package index would pull every data module's polyfills into main.
import { epgGuides } from '@zoma/data/client';
import type { Platform } from '@zoma/platform-api';
import type { EditorBinding, Focus, Navigator, Screen, ScreenSpec, TextEditorOptions, ZoneSpec } from '@zoma/ui';
import { SCREEN, bindEditor, createTextEditor, fits } from '@zoma/ui';
import { catalogOf, storedSources, userGuides } from '../onboarding/engine-loader';
import { normalizeLink } from '../onboarding/form';

/**
 * The guides screen (RELAY step 22b2, architecture.md §1.5 "Built in step 22b2"): the guides the
 * programmes come from, in their order, pushed on the live navigator from the settings screen.
 *
 *   add     ("Add a guide", in the header)
 *   guides  (the user's guides in their order, then each source's own: a playlist's `url-tvg`,
 *            a panel's `xmltv.php`; OK on one of the user's opens its menu)
 *
 * - **Rows:** the link (the host and path: never a login or a query), and what the refresh kept
 *   of it (`EpgStatus`): the programmes' end, the match rate, why the last try failed; or
 *   "Reading…" while a change's refresh runs, or "Not read yet".
 * - **The menu** (`guide-menu`): Move up, Move down (each only where the guide can go), Remove,
 *   Cancel.
 * - **The add form** (`guide-add`): a link field (onboarding's `normalizeLink`) and Add / Cancel.
 *   A link already on the screen is refused. A new guide's id is `g<n>`, one past the highest
 *   `g` id in the list and in the stored guides (`u~g<n>`), so an id whose records weren't
 *   deleted yet is never reused.
 * - **Each change:** `editProfile`, the list read again (the focus follows a moved or added
 *   guide), then the scheduler's `refreshNow` (a new guide is read, a removed one deleted, a
 *   moved one gets its rank), then the status read again once it settles. Changes run one
 *   after another; reads that a newer one replaced are dropped.
 */

/** Sizes, all layout constants (no DOM measuring). settings.css uses the same numbers. */
export const GUIDES = {
  headerHeight: 56,
  headerGap: 24,
  /** The line under the header that says how the order counts. */
  introHeight: 56,
  /** A guide's row: its link, then one or two lines of status. */
  rowHeight: 120,
  rowGap: 8,
} as const;

export const GUIDES_BODY = SCREEN.height - 2 * SCREEN.safeY - GUIDES.headerHeight - GUIDES.headerGap - GUIDES.introHeight;
export const GUIDES_VISIBLE = fits(GUIDES_BODY, GUIDES.rowHeight, GUIDES.rowGap);

/** The DOM id of the add form's link input (the text editor finds it by this). */
export const LINK_FIELD_ID = 'guides-link';

/** The add form's buttons. */
export const ADD_CONFIRM = 0;
export const ADD_CANCEL = 1;

/** One row of the guides screen. */
export interface GuideRow {
  /** `mine`: the user's (OK opens its menu); `source`: a playlist's or panel's own. */
  readonly kind: 'mine' | 'source';
  /** The guide's id in the refresh (`u~<id>`, `<src>:xmltv`, `<src>:tvg<n>`). */
  readonly epgSrc: string;
  /** The user's guide id (`''` for a source's). */
  readonly id: string;
  /** The link as shown: the host and path. */
  readonly link: string;
  /** The source's name, for a source's guide (`''` for the user's). */
  readonly source: string;
  /** What the refresh keeps of it (`null`: nothing stored yet). */
  readonly meta: EpgMeta | null;
}

export type GuideAction = 'up' | 'down' | 'remove' | 'cancel';

/** Why the add form refused the link. */
export type AddProblem = 'required' | 'url' | 'spaces' | 'listed';

export type GuidesStatus = 'loading' | 'ready' | 'failed';

/** What the screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface GuidesEngine {
  profile(): Promise<LoadedProfile | null>;
  epgStatus(): Promise<EpgStatus>;
  editProfile(edit: ProfileEdit): Promise<boolean>;
}

export interface GuidesOptions {
  readonly nav: Navigator;
  readonly engine: GuidesEngine;
  /** Reads the guides now (`RefreshScheduler.refreshNow`): settles when that pass has ended. */
  readonly refreshNow: () => Promise<void>;
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds the link's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  /** The clock (the click pairing in the editor). */
  readonly now?: () => number;
}

export interface GuidesMenu {
  readonly row: GuideRow;
  readonly actions: readonly GuideAction[];
}

export interface Guides {
  /** The guides screen while it is on the stack (its menu and add form cover it). */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly editor: EditorBinding;
  readonly status: ReadonlySignal<GuidesStatus>;
  readonly rows: ReadonlySignal<readonly GuideRow[]>;
  /** Refreshes that changes started and that haven't settled yet ("Reading…"). */
  readonly reading: ReadonlySignal<number>;
  /** Requests in flight (reads, edits, refreshes): 0 means the screen is settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  /** The menu while it shows. */
  readonly menu: ReadonlySignal<GuidesMenu | null>;
  /** The add form's link and why it was refused. */
  readonly text: ReadonlySignal<string>;
  readonly problem: ReadonlySignal<AddProblem | null>;
  /** Opens the screen and reads the guides. */
  open(): void;
  setText(value: string): void;
  dispose(): void;
}

const SCHEME_END = '://';

/**
 * A guide's link as the screen shows it: the host and path, with no scheme, query, fragment or
 * login (an Xtream `xmltv.php` link carries the login in its query).
 */
export function shownLink(url: string): string {
  let text = url;
  const scheme = text.indexOf(SCHEME_END);
  if (scheme !== -1) text = text.slice(scheme + SCHEME_END.length);
  let end = text.length;
  for (const mark of ['?', '#']) {
    const found = text.indexOf(mark);
    if (found !== -1 && found < end) end = found;
  }
  text = text.slice(0, end);
  const slash = text.indexOf('/');
  // After the last `@` of the host part (`-1 + 1`: from the start when there is none).
  return text.slice((slash === -1 ? text : text.slice(0, slash)).lastIndexOf('@') + 1);
}

const GUIDE_NUMBER = /^g(\d{1,9})$/;

/** The next id of a guide added on this screen: `g1`, `g2`… one past the highest `g` id in `taken`. */
export function nextGuideId(taken: readonly string[]): string {
  let highest = 0;
  for (const id of taken) {
    const match = GUIDE_NUMBER.exec(id);
    if (match !== null) highest = Math.max(highest, Number(match[1]));
  }
  return `g${highest + 1}`;
}

const USER_PREFIX = 'u~';

function metaOf(status: EpgStatus, epgSrc: string): EpgMeta | null {
  for (const meta of status.guides) if (meta.epgSrc === epgSrc) return meta;
  return null;
}

/** What the screen lists: its rows, and every guide's full link (the add form's check). */
export interface GuideList {
  readonly rows: GuideRow[];
  readonly urls: string[];
}

/** The rows: the user's guides in their order, then each source's own in the refresh's order. */
export function guideList(profile: LoadedProfile | null, status: EpgStatus): GuideList {
  const user = userGuides(profile);
  const records = storedSources(profile);
  const rows: GuideRow[] = [];
  const urls: string[] = [];
  for (const guide of user) {
    const epgSrc = `${USER_PREFIX}${guide.id}`;
    rows.push({ kind: 'mine', epgSrc, id: guide.id, link: shownLink(guide.url), source: '', meta: metaOf(status, epgSrc) });
    urls.push(guide.url);
  }
  for (const guide of epgGuides(records.map(catalogOf), status.sources, user)) {
    if (guide.epgSrc.indexOf(USER_PREFIX) === 0) continue;
    const src = guide.epgSrc.slice(0, guide.epgSrc.indexOf(':'));
    let source = '';
    for (const record of records) if (record.id === src) source = record.name;
    rows.push({ kind: 'source', epgSrc: guide.epgSrc, id: '', link: shownLink(guide.url), source, meta: metaOf(status, guide.epgSrc) });
    urls.push(guide.url);
  }
  return { rows, urls };
}

/**
 * What a row says of its guide: `read` (programmes stored: their end and the match rate),
 * `failed` (nothing stored, and the last try failed), `reading` (nothing stored yet while a
 * change's refresh runs) or `unread`. A stored guide whose last try failed is `read`, and
 * says why too (`meta.failure`).
 */
export type GuideState = 'read' | 'failed' | 'reading' | 'unread';

export function guideState(row: GuideRow, reading: number): GuideState {
  const meta = row.meta;
  if (meta !== null && meta.gen > 0) return 'read';
  if (meta !== null && meta.failure !== undefined && meta.failure !== null) return 'failed';
  return reading > 0 ? 'reading' : 'unread';
}

/** The menu's actions for the user's guide at `place` of `count`: a move only where it can go. */
export function menuActions(place: number, count: number): GuideAction[] {
  const actions: GuideAction[] = [];
  if (place > 0) actions.push('up');
  if (place < count - 1) actions.push('down');
  actions.push('remove', 'cancel');
  return actions;
}

const WHITESPACE = /\s/;

/** The add form's check: the link `normalizeLink` gives, or why it is refused. */
export function checkLink(text: string, listed: readonly string[]): { readonly link: string | null; readonly problem: AddProblem | null } {
  const typed = text.trim();
  if (typed === '') return { link: null, problem: 'required' };
  const link = normalizeLink(typed);
  if (link === null) return { link: null, problem: WHITESPACE.test(typed) ? 'spaces' : 'url' };
  if (listed.indexOf(link) !== -1) return { link: null, problem: 'listed' };
  return { link, problem: null };
}

const ADD_ZONE: ZoneSpec = { kind: 'list', id: 'add', axis: 'horizontal', count: 1, neighbours: { down: 'guides' } };

function guidesZone(count: number): ZoneSpec {
  return { kind: 'list', id: 'guides', axis: 'vertical', count, visible: GUIDES_VISIBLE, neighbours: { up: 'add' } };
}

const FORM_ZONES: ScreenSpec['zones'] = [
  { kind: 'list', id: 'field', axis: 'vertical', count: 1, neighbours: { down: 'actions' } },
  { kind: 'list', id: 'actions', axis: 'horizontal', count: 2, neighbours: { up: 'field' } },
];

/** Where the focus goes once the list is read again: a guide's row by its id. */
type Follow = { readonly id: string } | null;

export function createGuides(options: GuidesOptions): Guides {
  const { nav, engine } = options;
  const status = signal<GuidesStatus>('loading');
  const rows = signal<readonly GuideRow[]>([]);
  const reading = signal(0);
  const pending = signal(0);
  const menu = signal<GuidesMenu | null>(null);
  const text = signal('');
  const problem = signal<AddProblem | null>(null);

  let disposed = false;
  const screen = signal<Screen | null>(null);
  /** Every listed guide's full link (never shown). */
  let urls: string[] = [];
  /** The ids the list and the stored guides held at the last read. */
  let known: string[] = [];
  /** The ids given out here (a read may not have them yet): with `known`, never given again. */
  const given: string[] = [];
  /** Bumps on each read: an older read's answer is dropped. */
  let readSeq = 0;
  /** A guide the focus goes to when the next read lands. */
  let follow: Follow = null;
  /** The changes, one after another. */
  let chain: Promise<void> = Promise.resolve();

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

  /** The guides screen's zones for the rows read; the focus on `follow`'s row, or on "Add" when none. */
  const place = (): void => {
    const shown = screen.value;
    // (A closed screen ignores updates and focus moves itself.)
    if (shown === null) return;
    const list = rows.value;
    shown.update(guidesZone(list.length));
    const wanted = follow;
    follow = null;
    if (wanted !== null) {
      // (A source's row has no id.)
      for (let i = 0; i < list.length; i += 1) if (list[i]!.id === wanted.id) shown.focus('guides', i);
    }
    // An empty list (only reads call this: never while loading): the focus on "Add a guide".
    if (list.length === 0) shown.focus('add', 0);
  };

  /** Reads the list and the guides' status again; settles either way. */
  const read = (): Promise<void> => {
    readSeq += 1;
    const seq = readSeq;
    return track(() => Promise.all([engine.profile(), engine.epgStatus()])).then(
      ([profile, epg]) => {
        if (disposed || seq !== readSeq) return;
        const list = guideList(profile, epg);
        urls = list.urls;
        known = userGuides(profile).map((guide) => guide.id);
        for (const meta of epg.guides) if (meta.epgSrc.indexOf(USER_PREFIX) === 0) known.push(meta.epgSrc.slice(USER_PREFIX.length));
        status.value = 'ready';
        rows.value = list.rows;
        place();
      },
      (error: unknown) => {
        if (disposed || seq !== readSeq) return;
        console.warn('The guides could not be read', error);
        if (status.value === 'loading') status.value = 'failed';
        place();
      },
    );
  };

  /** A change's refresh: "Reading…" until it settles, then the status read again. */
  const refresh = (): void => {
    reading.value += 1;
    const settled = (): void => {
      reading.value -= 1;
      if (!disposed) void read();
    };
    track(() => options.refreshNow()).then(settled, (error: unknown) => {
      console.warn('The guides were not refreshed', error);
      settled();
    });
  };

  /** Saves `change` after the changes before it, reads the list again (the focus on `then`), then refreshes. */
  const change = (edit: GuideChange, then: Follow): void => {
    chain = chain.then(async () => {
      // A change the user made is saved even when the screen went meanwhile.
      try {
        await track(() => engine.editProfile({ kind: 'guide', change: edit }));
      } catch (error) {
        console.warn('The guide change was not saved', error);
      }
      if (disposed) return;
      follow = then;
      await read();
      if (!disposed) refresh();
    });
  };

  /** Closes the menu (it is on top: only its own keys call this). */
  const closeMenu = (): void => {
    menu.value = null;
    nav.pop();
  };

  const act = (action: GuideAction | undefined, row: GuideRow, index: number): void => {
    closeMenu();
    if (action === 'up') change({ op: 'move', id: row.id, to: index - 1 }, { id: row.id });
    else if (action === 'down') change({ op: 'move', id: row.id, to: index + 1 }, { id: row.id });
    else if (action === 'remove') change({ op: 'remove', id: row.id }, null);
  };

  const openMenu = (index: number): void => {
    const list = rows.value;
    const row = list[index];
    if (row === undefined || row.kind !== 'mine') return;
    let mine = 0;
    for (const r of list) if (r.kind === 'mine') mine += 1;
    const actions = menuActions(index, mine);
    menu.value = { row, actions };
    nav.push({
      id: 'guide-menu',
      zones: [{ kind: 'list', id: 'actions', axis: 'vertical', count: actions.length }],
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        closeMenu();
        return true;
      },
      onSelect: (focus) => act(actions[focus.index], row, index),
    });
  };

  /** Closes the add form (it is on top: only its own keys call this), ending the edit first. */
  const closeForm = (): void => {
    textEditor.close();
    nav.pop();
  };

  const submit = (): void => {
    const checked = checkLink(text.value, urls);
    problem.value = checked.problem;
    if (checked.link === null) {
      nav.top.focus('field', 0);
      return;
    }
    const id = nextGuideId(known.concat(given));
    given.push(id);
    urls = urls.concat([checked.link]);
    closeForm();
    change({ op: 'add', guide: { id, url: checked.link } }, { id });
  };

  const openForm = (): void => {
    text.value = '';
    problem.value = null;
    nav.push({
      id: 'guide-add',
      zones: FORM_ZONES,
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        closeForm();
        return true;
      },
      onSelect: (focus: Focus) => {
        if (focus.zone === 'field') textEditor.open(LINK_FIELD_ID);
        else if (focus.index === ADD_CONFIRM) submit();
        else closeForm();
      },
    });
  };

  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);

  return {
    screen,
    editor,
    status,
    rows,
    reading,
    pending,
    menu,
    text,
    problem,
    open(): void {
      if (disposed) return;
      screen.value = nav.push({
        id: 'guides',
        zones: [ADD_ZONE, guidesZone(rows.value.length)],
        initial: 'guides',
        onSelect: (focus) => {
          if (focus.zone === 'add') openForm();
          else openMenu(focus.index);
        },
      });
      void read();
    },
    setText(value: string): void {
      text.value = value;
      problem.value = null;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      editor.dispose();
      textEditor.dispose();
    },
  };
}
