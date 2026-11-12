import type { CatalogItem, ContentKind, SearchHit, SearchResult } from '@lablo/core';
import type { CancelToken, ItemRef, LoadedProfile, ProfileDoc, SearchRequest, SourceRecord } from '@lablo/data';
import { CancelError, emptyProfile } from '@lablo/data';
import type { Intent, KeyLike, TextKey } from '@lablo/platform-api';
import type { EditableLike } from '@lablo/ui';
import { SCREEN, createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchEngine } from './search-state';
import { SEARCH, SEARCH_BODY, SEARCH_FIELD, SEARCH_FIELD_ID, SEARCH_RESULTS, SEARCH_SCREEN, SEARCH_VISIBLE, createSearch } from './search-state';

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };
const S2: SourceRecord = {
  id: 's2',
  type: 'xtream',
  name: 'Panel',
  account: { base: 'http://panel.test', username: 'u', password: 'p' },
  added: 2,
};

/** Item `i` of the fake catalog: 300 channels, then 100 movies, then 50 series. */
function kindOf(i: number): ContentKind {
  return i < 300 ? 'live' : i < 400 ? 'movie' : 'series';
}

function catalogItem(i: number): CatalogItem {
  const kind = kindOf(i);
  return {
    key: `x:s1:${kind}:${i}`,
    src: 's1',
    kind,
    name: `Lablo ${kind} ${i}`,
    normName: `lablo ${kind} ${i}`,
    group: `Group ${i % 3}`,
    url: kind === 'series' ? '' : `http://panel.test/${i}.ts`,
    logo: null,
    epgId: null,
    tvgName: null,
    matchName: null,
    chno: null,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
}

const CATALOG: CatalogItem[] = [];
for (let i = 0; i < 450; i += 1) CATALOG.push(catalogItem(i));

function hitOf(i: number): SearchHit {
  return { src: 's1', kind: kindOf(i), gen: 1, index: i, catIdx: 0, chunk: Math.floor(i / 500), slot: i % 500, match: 'word', favourite: false };
}

type Kind = 'profile' | 'find' | 'items';

interface Held {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** The data engine: the catalog's names searched by their words, each kind held or failed on demand. */
class FakeEngine implements SearchEngine {
  doc: ProfileDoc = { ...emptyProfile(), sources: [S1, S2] };
  readonly finds: SearchRequest[] = [];
  readonly tokens: CancelToken[] = [];
  readonly reads: number[][] = [];
  profiles = 0;
  /** Whether a held search rejects when its token is cancelled (the RPC client does). */
  honoursCancel = true;
  readonly fail = new Set<Kind>();
  hold = new Set<Kind>();
  readonly held: Record<Kind, Held[]> = { profile: [], find: [], items: [] };

  private answer<T>(kind: Kind, value: () => T, cancel?: CancelToken): Promise<T> {
    const run = (): T => {
      if (this.fail.has(kind)) throw new Error(`${kind} failed`);
      return value();
    };
    if (!this.hold.has(kind)) {
      try {
        return Promise.resolve(run());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise<T>((resolve, reject) => {
      if (cancel !== undefined && this.honoursCancel) cancel.onCancel(() => reject(new CancelError()));
      this.held[kind].push({
        resolve: () => {
          try {
            resolve(run());
          } catch (error) {
            reject(error);
          }
        },
        reject,
      });
    });
  }

  profile(): Promise<LoadedProfile | null> {
    this.profiles += 1;
    return this.answer('profile', () => ({ doc: this.doc, newer: false, migratedFrom: null }));
  }

  find(req: SearchRequest, cancel?: CancelToken): Promise<SearchResult> {
    this.finds.push(req);
    if (cancel !== undefined) this.tokens.push(cancel);
    // As the RPC client: a search cancelled before it is sent is never sent.
    if (cancel?.cancelled === true) return Promise.reject(new CancelError());
    return this.answer(
      'find',
      () => {
        const words = req.query.toLowerCase().split(' ').filter((w) => w !== '');
        const found: SearchHit[] = [];
        for (const item of CATALOG) if (words.every((w) => item.normName.indexOf(w) !== -1)) found.push(hitOf(CATALOG.indexOf(item)));
        return { query: req.query, hits: found.slice(0, req.limit), total: found.length };
      },
      cancel,
    );
  }

  items(refs: ItemRef[]): Promise<(CatalogItem | null)[]> {
    this.reads.push(refs.map((r) => r.chunk * 500 + r.slot));
    // Each ref must be its hit's place, whole.
    const at = (r: ItemRef): CatalogItem | null => {
      const i = r.chunk * 500 + r.slot;
      const want = hitOf(i);
      return r.src === want.src && r.kind === want.kind && r.gen === want.gen && r.catIdx === want.catIdx ? (CATALOG[i] ?? null) : null;
    };
    return this.answer('items', () => refs.map(at));
  }

  /** The first row of each read. */
  pages(): number[] {
    return this.reads.map((r) => r[0]!);
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function setup(engine = new FakeEngine()) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 5 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  // The navigator's listeners held (the screen's and its editor's).
  let following = 0;
  const subscribe = nav.subscribe.bind(nav);
  vi.spyOn(nav, 'subscribe').mockImplementation((listener) => {
    following += 1;
    const stop = subscribe(listener);
    return () => {
      following -= 1;
      stop();
    };
  });
  const select = vi.fn();
  const input: EditableLike & { focused: number; blurred: number } = {
    focused: 0,
    blurred: 0,
    focus() {
      this.focused += 1;
    },
    blur() {
      this.blurred += 1;
    },
  };
  const find = vi.fn((id: string) => (id === SEARCH_FIELD_ID ? input : null));
  const platform = {
    textKey: (event: KeyLike): TextKey | null => (event.key === 'Enter' ? 'done' : event.key === 'Escape' ? 'close' : null),
    onSoftKeyboard: () => () => undefined,
  };
  const search = createSearch({ nav, engine, select, platform, find, now: () => 10_000 });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  /** The rows `from` to `to - 1` by their catalog numbers (`-` for one not read). */
  const rows = (from: number, to: number): string[] => {
    const out: string[] = [];
    for (let i = from; i < to; i += 1) {
      const row = search.row(i);
      out.push(row === null ? '-' : row.key.split(':')[3]!);
    }
    return out;
  };
  return { nav, engine, select, input, search, at, press, rows, following: () => following };
}

/** Opens the screen and lets the profile's read land. */
async function opened(engine = new FakeEngine()) {
  const t = setup(engine);
  t.search.open();
  await flush();
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the search screen’s layout numbers', () => {
  it('fits 7 rows of 88 px under the header and the search field', () => {
    expect(SEARCH_BODY).toBe(SCREEN.height - 2 * SCREEN.safeY - 56 - 24 - 150 - 16);
    expect(SEARCH_VISIBLE).toBe(7);
    expect(SEARCH_VISIBLE * (SEARCH.rowHeight + SEARCH.rowGap) - SEARCH.rowGap).toBeLessThanOrEqual(SEARCH_BODY);
    expect([SEARCH.page, SEARCH.limit]).toEqual([20, 200]);
    expect([SEARCH_SCREEN, SEARCH_FIELD, SEARCH_RESULTS, SEARCH_FIELD_ID]).toEqual(['search', 'field', 'results', 'search-field']);
  });
});

describe('the search screen', () => {
  it('opens on the field with nothing typed, and OK there opens the keyboard', async () => {
    const t = await opened();
    expect(t.at()).toBe('search · field 0');
    expect(t.search.screen.value).not.toBeNull();
    expect([t.search.status.value, t.search.query.value, t.search.count.value, t.search.total.value]).toEqual(['idle', '', 0, 0]);
    expect(t.engine.profiles).toBe(1);
    expect(t.engine.finds).toEqual([]);
    await t.press('OK');
    expect(t.input.focused).toBe(1);
    expect(t.search.editor.editing.value).toBe(SEARCH_FIELD_ID);
    // A second open while it shows does nothing.
    t.search.open();
    expect(t.engine.profiles).toBe(1);
  });

  it('searches each change of the text over the profile’s sources, and reads only the first pages', async () => {
    const t = await opened();
    t.search.setQuery('live');
    expect(t.search.status.value).toBe('searching');
    expect(t.search.query.value).toBe('live');
    await flush();
    expect(t.engine.finds).toEqual([{ query: 'live', sources: ['s1', 's2'], limit: 200 }]);
    expect([t.search.status.value, t.search.answered.value, t.search.count.value, t.search.total.value]).toEqual(['ready', 'live', 200, 300]);
    // The window (7 rows) and one window below: the first page alone.
    expect(t.engine.pages()).toEqual([0]);
    expect(t.rows(0, 21)).toEqual([...Array.from({ length: 20 }, (_v, i) => String(i)), '-']);
    expect(t.search.hit(3)).toEqual(hitOf(3));
    expect(t.search.hit(200)).toBeNull();
    // Fewer than the limit: every match listed.
    t.search.setQuery('movie 31');
    await flush();
    expect([t.search.count.value, t.search.total.value]).toEqual([11, 11]);
    expect(t.rows(0, 3)).toEqual(['310', '311', '312']);
  });

  it('keeps the last rows while the next text is searched, and drops older answers', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    t.search.setQuery('movie');
    await flush();
    engine.hold = new Set(['find']);
    t.search.setQuery('movie 3');
    t.search.setQuery('movie 31');
    expect(t.search.status.value).toBe('searching');
    expect(t.search.answered.value).toBe('movie');
    expect(t.search.count.value).toBe(100);
    expect(t.rows(0, 2)).toEqual(['300', '301']);
    // The search before each new one is cancelled (here before the profile's read let it go; the
    // first had answered: cancelling it does nothing).
    await flush();
    expect(engine.tokens.map((token) => token.cancelled)).toEqual([true, true, false]);
    expect(engine.held.find.length).toBe(1);
    expect(t.search.status.value).toBe('searching');
    engine.held.find.shift()!.resolve();
    await flush();
    expect([t.search.answered.value, t.search.count.value]).toEqual(['movie 31', 11]);
    // An engine that answers a cancelled search anyway: the older answer is dropped.
    engine.honoursCancel = false;
    t.search.setQuery('series');
    await flush();
    t.search.setQuery('series 44');
    await flush();
    engine.held.find.pop()!.resolve();
    await flush();
    expect([t.search.answered.value, t.search.count.value]).toEqual(['series 44', 10]);
    engine.held.find.pop()!.resolve();
    await flush();
    expect([t.search.answered.value, t.search.count.value]).toEqual(['series 44', 10]);
  });

  it('searches nothing for spaces, and clears the rows when the text is gone', async () => {
    const t = await opened();
    t.search.setQuery('live 1');
    await flush();
    expect(t.search.count.value).toBeGreaterThan(0);
    await t.press('DOWN', 'DOWN');
    expect(t.at()).toBe('search · results 1');
    t.search.setQuery('   ');
    await flush();
    expect(t.engine.finds.length).toBe(1);
    expect([t.search.status.value, t.search.answered.value, t.search.count.value, t.search.total.value]).toEqual(['idle', '', 0, 0]);
    expect(t.search.row(0)).toBeNull();
    expect(t.search.hit(0)).toBeNull();
    // The focus leaves the empty list for the field, and DOWN finds no list.
    expect(t.at()).toBe('search · field 0');
    await t.press('DOWN');
    expect(t.at()).toBe('search · field 0');
  });

  it('starts new text’s rows at the top, and reads the pages around the window as it moves', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    t.search.setQuery('live');
    await flush();
    await t.press('DOWN');
    expect(t.at()).toBe('search · results 0');
    // Down to row 13: the window is rows 7–13, so rows 0–20: row 20 is the second page's first.
    for (let i = 0; i < 13; i += 1) await t.press('DOWN');
    expect(t.at()).toBe('search · results 13');
    expect(engine.pages()).toEqual([0, 20]);
    // Down to row 15: the window is rows 9–15, so the pages of rows 2–29.
    for (let i = 0; i < 2; i += 1) await t.press('DOWN');
    expect(t.at()).toBe('search · results 15');
    expect(engine.pages()).toEqual([0, 20]);
    expect(t.rows(19, 22)).toEqual(['19', '20', '21']);
    // A held page shows its rows once it comes; an answer for older text is dropped.
    engine.hold = new Set(['items']);
    for (let i = 0; i < 20; i += 1) await t.press('DOWN');
    expect(t.rows(40, 41)).toEqual(['-']);
    engine.held.items.shift()!.resolve();
    await flush();
    expect(t.rows(40, 41)).toEqual(['40']);
    for (let i = 0; i < 20; i += 1) await t.press('DOWN');
    expect(engine.held.items.length).toBe(1);
    t.search.setQuery('live 2');
    await flush();
    expect(t.at()).toBe('search · results 0');
    engine.held.items.shift()!.resolve();
    await flush();
    expect(t.search.row(60)).toBeNull();
    // The new text's first page is asked (held), and taken when it comes.
    expect(t.rows(0, 1)).toEqual(['-']);
    engine.held.items.shift()!.resolve();
    await flush();
    expect(t.rows(0, 2)).toEqual(['2', '12']);
  });

  it('opens a row’s item with its hit on OK, and nothing for a row not read yet', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    t.search.setQuery('movie');
    await flush();
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.select).toHaveBeenCalledTimes(1);
    expect(t.select).toHaveBeenCalledWith(CATALOG[301], hitOf(301));
    // The screen stays on the stack under what opened.
    expect(t.at()).toBe('search · results 1');
    engine.hold = new Set(['items']);
    t.search.setQuery('series');
    await flush();
    await t.press('OK');
    expect(t.at()).toBe('search · results 0');
    expect(t.select).toHaveBeenCalledTimes(1);
  });

  it('goes from the results to the field on Back, and closes from the field', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    t.search.setQuery('live');
    await flush();
    await t.press('DOWN', 'DOWN', 'BACK');
    expect(t.at()).toBe('search · field 0');
    expect(t.search.screen.value).not.toBeNull();
    // Closed with a search on its way: it is cancelled, and its answer dropped.
    engine.hold = new Set(['find']);
    engine.honoursCancel = false;
    t.search.setQuery('movie');
    await flush();
    await t.press('BACK');
    expect(t.at()).toBe('live · header 0');
    expect(t.search.screen.value).toBeNull();
    expect(engine.tokens.pop()!.cancelled).toBe(true);
    // Typing after it closed searches nothing (the field shows only with the screen), nor does a catalog swap.
    t.search.setQuery('series');
    await flush();
    expect(engine.finds.length).toBe(2);
    t.search.catalogChanged();
    await flush();
    expect(engine.finds.length).toBe(2);
    // The live screen's keys go on with the search closed.
    await t.press('RIGHT');
    expect(t.at()).toBe('live · header 1');
    // Opened again: empty, and a late answer of the last opening changes nothing.
    t.search.open();
    await flush();
    expect([t.search.status.value, t.search.query.value, t.search.answered.value, t.search.count.value, t.search.total.value]).toEqual(['idle', '', '', 0, 0]);
    expect(t.search.row(0)).toBeNull();
    expect(t.search.hit(0)).toBeNull();
    engine.held.find.shift()!.resolve();
    await flush();
    expect([t.search.status.value, t.search.count.value]).toEqual(['idle', 0]);
    t.search.setQuery('series');
    await flush();
    engine.held.find.shift()!.resolve();
    await flush();
    expect([t.search.answered.value, t.search.count.value]).toEqual(['series', 50]);
  });

  it('says a search failed, keeping no rows; the next text searches again', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    t.search.setQuery('live');
    await flush();
    engine.fail.add('find');
    t.search.setQuery('live 1');
    await flush();
    expect([t.search.status.value, t.search.answered.value, t.search.count.value, t.search.total.value]).toEqual(['failed', '', 0, 0]);
    expect(t.search.row(0)).toBeNull();
    engine.fail.delete('find');
    t.search.setQuery('live 12');
    await flush();
    expect([t.search.status.value, t.search.count.value]).toEqual(['ready', 13]);
  });

  it('leaves a row empty when its page can’t be read, and asks it again only for new rows', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.fail.add('items');
    t.search.setQuery('movie');
    await flush();
    expect(t.search.status.value).toBe('ready');
    expect(t.search.row(0)).toBeNull();
    engine.fail.delete('items');
    await t.press('DOWN');
    expect(t.rows(0, 1)).toEqual(['300']);
  });

  it('searches with no source when the profile can’t be read', async () => {
    const engine = new FakeEngine();
    engine.fail.add('profile');
    const t = await opened(engine);
    t.search.setQuery('live');
    await flush();
    expect(engine.finds[0]!.sources).toEqual([]);
  });

  it('waits for the profile before the first search, and reads it at each opening', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['profile']);
    const t = await opened(engine);
    t.search.setQuery('live');
    await flush();
    expect(engine.finds).toEqual([]);
    expect(t.search.pending.value).toBe(2);
    engine.held.profile.shift()!.resolve();
    await flush();
    expect(engine.finds.length).toBe(1);
    expect(t.search.pending.value).toBe(0);
    await t.press('BACK');
    t.search.open();
    expect(engine.profiles).toBe(2);
  });

  it('searches the text again after a catalog swap, keeping the focus’s row', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    // Nothing typed: nothing to search.
    t.search.catalogChanged();
    await flush();
    expect(engine.finds).toEqual([]);
    t.search.setQuery('movie');
    await flush();
    await t.press('DOWN', 'DOWN', 'DOWN');
    expect(t.at()).toBe('search · results 2');
    engine.hold = new Set(['find']);
    t.search.catalogChanged();
    expect(t.search.status.value).toBe('ready');
    await flush();
    engine.held.find.shift()!.resolve();
    await flush();
    expect(engine.finds.map((f) => f.query)).toEqual(['movie', 'movie']);
    expect(t.at()).toBe('search · results 2');
    expect(t.search.status.value).toBe('ready');
    // The swapped catalog has nothing for the text: the focus leaves the empty list for the field.
    t.search.setQuery('movie 999');
    t.search.catalogChanged();
    await flush();
    engine.held.find.pop()!.resolve();
    await flush();
    expect(t.search.count.value).toBe(0);
    expect(t.at()).toBe('search · field 0');
    // Closed: nothing.
    await t.press('BACK');
    expect(t.search.screen.value).toBeNull();
    const finds = engine.finds.length;
    t.search.catalogChanged();
    expect(engine.finds.length).toBe(finds);
  });

  it('moves down from the field when the keyboard says done', async () => {
    const t = await opened();
    await t.press('OK');
    const field = t.search.editor.field(SEARCH_FIELD_ID);
    field.onEditInput();
    t.search.setQuery('movie 31');
    await flush();
    field.onEditKey({ key: 'Enter', keyCode: 13, preventDefault: () => undefined, stopPropagation: () => undefined });
    await flush();
    expect(t.at()).toBe('search · results 0');
    expect(t.input.blurred).toBe(1);
  });

  it('cancels its search and follows nothing once disposed', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['find']);
    t.search.setQuery('live');
    await flush();
    t.search.dispose();
    expect(engine.tokens[0]!.cancelled).toBe(true);
    // A cancelled search's rejection changes nothing.
    expect(t.search.status.value).toBe('searching');
    engine.honoursCancel = false;
    t.search.open();
    expect(engine.profiles).toBe(1);
    t.search.catalogChanged();
    await flush();
    expect(engine.finds.length).toBe(1);
    // It lets go of the navigator (its editor too).
    expect(t.following()).toBe(0);
    // Closed after the dispose, it opens no more.
    await t.press('BACK');
    expect(t.at()).toBe('live · header 0');
    t.search.open();
    await flush();
    expect(t.at()).toBe('live · header 0');
    expect([t.search.screen.value, engine.profiles]).toEqual([null, 1]);
  });

  it('drops the answers that come after the dispose, and reads no page for the keys after it', async () => {
    const engine = new FakeEngine();
    engine.honoursCancel = false;
    const t = await opened(engine);
    t.search.setQuery('live');
    await flush();
    await t.press('DOWN');
    engine.hold = new Set(['find', 'items']);
    for (let i = 0; i < 20; i += 1) await t.press('DOWN');
    expect(engine.held.items.length).toBe(1);
    t.search.setQuery('live 1');
    await flush();
    t.search.dispose();
    engine.held.find.shift()!.resolve();
    engine.held.items.shift()!.resolve();
    await flush();
    expect([t.search.answered.value, t.search.count.value]).toEqual(['live', 200]);
    expect(t.search.row(20)).toBeNull();
    engine.hold = new Set();
    const reads = engine.reads.length;
    for (let i = 0; i < 20; i += 1) await t.press('DOWN');
    expect(engine.reads.length).toBe(reads);
  });

  it('asks the window and one window either side after a catalog swap, and no page past the end', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    t.search.setQuery('movie');
    await flush();
    await t.press('DOWN');
    for (let i = 0; i < 30; i += 1) await t.press('DOWN');
    expect(t.at()).toBe('search · results 30');
    engine.reads.length = 0;
    // The window is rows 24–30: rows 17–37 are wanted (one window above it, one below), pages 0 and 1.
    t.search.catalogChanged();
    await flush();
    expect(engine.pages()).toEqual([300, 320]);
    // Down to the last row: the last page, and none after it.
    for (let i = 30; i < 99; i += 1) await t.press('DOWN');
    expect(t.at()).toBe('search · results 99');
    expect(t.rows(98, 100)).toEqual(['398', '399']);
    expect(engine.reads.every((r) => r.length > 0)).toBe(true);
    await t.press('UP', 'UP');
    for (let i = 0; i < 97; i += 1) await t.press('UP');
    expect(t.at()).toBe('search · results 0');
    await t.press('UP');
    expect(t.at()).toBe('search · field 0');
  });

  it('asks the new answer’s first page even while the last one’s is on its way, and draws each page read', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['items']);
    const t = await opened(engine);
    t.search.setQuery('live');
    await flush();
    expect(engine.held.items.length).toBe(1);
    t.search.setQuery('movie');
    await flush();
    expect(engine.held.items.length).toBe(2);
    const drawn = t.search.drawn.value;
    engine.held.items.pop()!.resolve();
    await flush();
    expect(t.search.drawn.value).toBe(drawn + 1);
    expect(t.rows(0, 1)).toEqual(['300']);
    // The older answer's page, coming last, is dropped.
    engine.held.items.pop()!.resolve();
    await flush();
    expect(t.search.drawn.value).toBe(drawn + 1);
    expect(t.rows(0, 1)).toEqual(['300']);
    // An older answer's page that fails changes nothing either: the new one's isn't asked twice.
    t.search.setQuery('live');
    await flush();
    t.search.setQuery('series');
    await flush();
    expect(engine.held.items.length).toBe(2);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.held.items.shift()!.reject(new Error('gone'));
    await flush();
    await t.press('DOWN');
    expect(engine.held.items.length).toBe(1);
  });
});
