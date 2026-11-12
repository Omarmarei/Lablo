import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { CatalogItem, SearchHit, SearchResult } from '@lablo/core';
import type { CancelToken, ItemRef, LoadedProfile, SearchRequest } from '@lablo/data';
import { CancelSource } from '@lablo/data/client';
import type { Platform } from '@lablo/platform-api';
import type { EditorBinding, Navigator, Screen, TextEditorOptions, ZoneSpec } from '@lablo/ui';
import { SCREEN, bindEditor, createTextEditor, fits } from '@lablo/ui';
import { storedSources } from '../onboarding/engine-loader';

/**
 * The search screen (RELAY step 28a, architecture.md §1.2 "Built in step 28a"): the live
 * channels, movies and series whose names hold every word typed, across the sources. Pushed on
 * the live navigator by the header's "Search".
 *
 *   field    (the search field: OK opens the TV's keyboard; each change searches again)
 *   results  (the hits, best first, as the core ranks them: OK opens one, `select`)
 *
 * - **A search per change of the text** (`find`, the query worker's `search` over the sources the
 *   profile holds, in its order), at most `SEARCH.limit` hits: the search before is cancelled,
 *   and an answer for older text, an older opening or a closed screen is dropped. Until the new
 *   answer comes, the rows of the last one stay. Nothing typed (spaces only) searches nothing.
 * - **The rows' items** are read a page at a time (`SEARCH.page` hits, through `items`), only
 *   the pages around the window; every page of the answer on show is kept (at most 10).
 * - **OK on a row** whose item is read calls `select` with the item and its hit; the screen stays
 *   under what opens (the player, the details), and Back there returns to the same row.
 * - **Back** in the results goes to the field; on the field it closes the screen.
 * - **A catalog swap** (`catalogChanged`) searches the text again; the focus keeps its row.
 */

/** The screen's id on the navigator, and its zones'. */
export const SEARCH_SCREEN = 'search';
export const SEARCH_FIELD = 'field';
export const SEARCH_RESULTS = 'results';
/** The DOM id of the search field's input (the text editor finds it by this). */
export const SEARCH_FIELD_ID = 'search-field';

/** Sizes, all layout constants (no DOM measuring). search.css uses the same numbers. */
export const SEARCH = {
  /** The header (as the settings screens'): 56 px and a 24 px gap. */
  headerHeight: 56,
  headerGap: 24,
  /** The search field: its 32 px label and 8 px gap, its 72 px box, an 8 px gap and its 30 px note (TextField.css). */
  fieldHeight: 150,
  fieldGap: 16,
  /** A row: the item's name, then its kind and group. */
  rowHeight: 88,
  rowGap: 8,
  /** Hits per read of their items. */
  page: 20,
  /** The most hits a search lists (core's `SEARCH_LIMIT`). */
  limit: 200,
} as const;

/** Under the header and the field, the results. */
export const SEARCH_BODY = SCREEN.height - 2 * SCREEN.safeY - SEARCH.headerHeight - SEARCH.headerGap - SEARCH.fieldHeight - SEARCH.fieldGap;
export const SEARCH_VISIBLE = fits(SEARCH_BODY, SEARCH.rowHeight, SEARCH.rowGap);

/**
 * `idle`: nothing typed; `searching`: the first answer for the text isn't in (the last rows stay);
 * `ready`: the rows are this text's; `failed`: its search failed.
 */
export type SearchStatus = 'idle' | 'searching' | 'ready' | 'failed';

/** What the screen needs from the data engine (a `DataEngine` fits; tests pass a fake). */
export interface SearchEngine {
  profile(): Promise<LoadedProfile | null>;
  find(req: SearchRequest, cancel?: CancelToken): Promise<SearchResult>;
  items(refs: ItemRef[]): Promise<(CatalogItem | null)[]>;
}

export interface SearchOptions {
  /** The live screen's navigator: the search is a screen on it. */
  readonly nav: Navigator;
  readonly engine: SearchEngine;
  /** OK on a row: a channel plays, a movie's or a show's details open. */
  readonly select: (item: CatalogItem, hit: SearchHit) => void;
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds the search field's input (tests); default `document.getElementById`. */
  readonly find?: TextEditorOptions['find'];
  /** The clock (the click pairing in the editor). */
  readonly now?: () => number;
}

export interface Search {
  /** The screen while it is on the stack. */
  readonly screen: ReadonlySignal<Screen | null>;
  readonly editor: EditorBinding;
  readonly status: ReadonlySignal<SearchStatus>;
  /** What is typed in the field. */
  readonly query: ReadonlySignal<string>;
  /** The text the rows on show were found for (`''`: none). */
  readonly answered: ReadonlySignal<string>;
  /** The rows on show (at most `SEARCH.limit`). */
  readonly count: ReadonlySignal<number>;
  /** How many items matched in all (more than `count` when the list is cut). */
  readonly total: ReadonlySignal<number>;
  /** Bumps when rows come in or go: the list draws again. */
  readonly drawn: ReadonlySignal<number>;
  /** Requests in flight: 0 means the screen is settled (e2e). */
  readonly pending: ReadonlySignal<number>;
  /** Row `index`'s item, or `null` while its page isn't read (or the item is gone). */
  row(index: number): CatalogItem | null;
  /** Row `index`'s hit (`null`: no such row). */
  hit(index: number): SearchHit | null;
  /** Opens the screen on the field, with nothing typed. */
  open(): void;
  setQuery(value: string): void;
  /** A catalog swapped in: the text is searched again. */
  catalogChanged(): void;
  dispose(): void;
}

const FIELD_ZONE: ZoneSpec = { kind: 'list', id: SEARCH_FIELD, axis: 'vertical', count: 1, neighbours: { down: SEARCH_RESULTS } };

function resultsZone(count: number): ZoneSpec {
  return { kind: 'list', id: SEARCH_RESULTS, axis: 'vertical', count, visible: SEARCH_VISIBLE, neighbours: { up: SEARCH_FIELD } };
}

/** Where a hit's item is stored. */
function refOf(hit: SearchHit): ItemRef {
  return { src: hit.src, kind: hit.kind, gen: hit.gen, catIdx: hit.catIdx, chunk: hit.chunk, slot: hit.slot };
}

export function createSearch(options: SearchOptions): Search {
  const { nav, engine } = options;
  const screen = signal<Screen | null>(null);
  const status = signal<SearchStatus>('idle');
  const query = signal('');
  const answered = signal('');
  const count = signal(0);
  const total = signal(0);
  const drawn = signal(0);
  const pending = signal(0);
  let disposed = false;
  /** Bumps at each opening and closing: answers for another one are dropped. */
  let openSeq = 0;
  /** Bumps at each search: answers for an older one are dropped. */
  let searchSeq = 0;
  /** The search running now (cancelled by the next). */
  let running: CancelSource | null = null;
  /** The profile's sources, in its order, read at each opening. */
  let sources: Promise<string[]> = Promise.resolve([]);
  /** The answer on show. */
  let hits: SearchHit[] = [];
  /** Its pages read, by page number. */
  let pages = new Map<number, (CatalogItem | null)[]>();
  /** Its pages asked for and not answered yet. */
  let asking = new Set<number>();

  function track<T>(request: () => Promise<T>): Promise<T> {
    pending.value += 1;
    let started: Promise<T>;
    try {
      started = request();
    } catch (error) {
      started = Promise.reject(error);
    }
    const done = (): void => {
      pending.value -= 1;
    };
    started.then(done, done);
    return started;
  }

  /** The pages the window needs: its rows and one window either side. */
  const wanted = (shown: Screen): number[] => {
    const top = shown.position(SEARCH_RESULTS).top;
    const first = Math.max(0, top - SEARCH_VISIBLE);
    const last = Math.min(hits.length, top + 2 * SEARCH_VISIBLE) - 1;
    const out: number[] = [];
    for (let p = Math.floor(first / SEARCH.page); p * SEARCH.page <= last; p += 1) out.push(p);
    return out;
  };

  /** Asks the pages the window needs that aren't read or asked for. */
  const fill = (): void => {
    const shown = screen.value;
    if (shown === null) return;
    wanted(shown).forEach((p) => {
      if (!pages.has(p) && !asking.has(p)) ask(p);
    });
  };

  function ask(page: number): void {
    // (Every answer taken, and every clearing, brings a new array: older pages are dropped.)
    const from = hits;
    asking.add(page);
    track(() => engine.items(from.slice(page * SEARCH.page, (page + 1) * SEARCH.page).map(refOf))).then(
      (items) => {
        if (disposed || from !== hits) return;
        asking.delete(page);
        pages.set(page, items);
        drawn.value += 1;
      },
      (error: unknown) => {
        if (disposed || from !== hits) return;
        asking.delete(page);
        console.warn('The items found could not be read', error);
      },
    );
  }

  /** No rows: nothing typed (`idle`), or the search failed. */
  const clear = (shown: Screen, next: SearchStatus): void => {
    hits = [];
    pages = new Map();
    asking = new Set();
    answered.value = '';
    count.value = 0;
    total.value = 0;
    status.value = next;
    shown.reset(SEARCH_RESULTS);
    shown.update(resultsZone(0));
    // (Only a catalog swap's search, or the pointer, finds the focus in the list.)
    if (shown.active === SEARCH_RESULTS) shown.focus(SEARCH_FIELD, 0);
    drawn.value += 1;
  };

  /** Takes a search's answer: its hits replace the rows on show. */
  const take = (shown: Screen, text: string, result: SearchResult, keep: boolean): void => {
    hits = result.hits;
    pages = new Map();
    asking = new Set();
    answered.value = text;
    count.value = hits.length;
    total.value = result.total;
    status.value = 'ready';
    // New text lists from the top; a catalog swap keeps the focus's row.
    if (!keep) shown.reset(SEARCH_RESULTS);
    shown.update(resultsZone(hits.length));
    if (hits.length === 0 && shown.active === SEARCH_RESULTS) shown.focus(SEARCH_FIELD, 0);
    drawn.value += 1;
    fill();
  };

  /** Searches `text` (`keep`: the focus keeps its row). */
  const run = (text: string, keep: boolean): void => {
    searchSeq += 1;
    const seq = searchSeq;
    const opening = openSeq;
    running?.cancel();
    running = null;
    // (Only an open screen searches.)
    const shown = screen.value!;
    if (text.trim() === '') {
      clear(shown, 'idle');
      return;
    }
    const cancel = new CancelSource();
    running = cancel;
    if (status.value !== 'ready' || answered.value !== text) status.value = 'searching';
    track(() => sources.then((order) => engine.find({ query: text, sources: order, limit: SEARCH.limit }, cancel.token))).then(
      (result) => {
        if (disposed || seq !== searchSeq || opening !== openSeq) return;
        running = null;
        take(shown, text, result, keep);
      },
      (error: unknown) => {
        if (disposed || seq !== searchSeq || opening !== openSeq) return;
        running = null;
        console.warn('The search failed', error);
        clear(shown, 'failed');
      },
    );
  };

  const close = (): void => {
    textEditor.close();
    openSeq += 1;
    searchSeq += 1;
    running?.cancel();
    running = null;
    hits = [];
    pages = new Map();
    asking = new Set();
    screen.value = null;
    nav.pop();
  };

  const choose = (index: number): void => {
    const hit = hits[index];
    const item = api.row(index);
    // Its page may still be on its way.
    if (hit === undefined || item === null) return;
    options.select(item, hit);
  };

  const textEditor = createTextEditor({ platform: options.platform, nav, find: options.find, now: options.now });
  const editor = bindEditor(textEditor);

  // (A focus move elsewhere finds the screen closed: fill does nothing then.)
  const stopFollowing = nav.subscribe(() => fill());

  const api: Search = {
    screen,
    editor,
    status,
    query,
    answered,
    count,
    total,
    drawn,
    pending,
    row(index: number): CatalogItem | null {
      return pages.get(Math.floor(index / SEARCH.page))?.[index % SEARCH.page] ?? null;
    },
    hit(index: number): SearchHit | null {
      return hits[index] ?? null;
    },
    open(): void {
      if (disposed || screen.value !== null) return;
      openSeq += 1;
      query.value = '';
      answered.value = '';
      count.value = 0;
      total.value = 0;
      status.value = 'idle';
      hits = [];
      pages = new Map();
      asking = new Set();
      sources = track(() => engine.profile()).then(
        (profile) => storedSources(profile).map((s) => s.id),
        (error: unknown) => {
          console.warn('The sources could not be read', error);
          return [];
        },
      );
      screen.value = nav.push({
        id: SEARCH_SCREEN,
        zones: [FIELD_ZONE, resultsZone(0)],
        onIntent: (intent, focus) => {
          if (intent !== 'BACK') return false;
          if (focus.zone === SEARCH_RESULTS) screen.value!.focus(SEARCH_FIELD, 0);
          else close();
          return true;
        },
        onSelect: (focus) => {
          if (focus.zone === SEARCH_FIELD) textEditor.open(SEARCH_FIELD_ID);
          else choose(focus.index);
        },
      });
    },
    setQuery(value: string): void {
      query.value = value;
      // (The field shows only with the screen.)
      if (screen.value === null) return;
      run(value, false);
    },
    catalogChanged(): void {
      if (disposed || screen.value === null || query.value.trim() === '') return;
      run(query.value, true);
    },
    dispose(): void {
      disposed = true;
      running?.cancel();
      running = null;
      stopFollowing();
      editor.dispose();
      textEditor.dispose();
    },
  };
  return api;
}
