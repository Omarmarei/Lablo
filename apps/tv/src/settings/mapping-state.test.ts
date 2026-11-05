import type { EpgNowNext, EpgStatus, GuideChannel, GuideChannelsPage, GuideChannelsRequest, LoadedProfile, ProfileDoc, ProfileEdit, SourceMeta, SourceRecord } from '@zoma/data';
import { applyProfileEdit, emptyProfile } from '@zoma/data';
import type { Intent, KeyLike, TextKey } from '@zoma/platform-api';
import type { EditableLike } from '@zoma/ui';
import { SCREEN, createNavigator } from '@zoma/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MappingCurrent, MappingEngine, MappingRow } from './mapping-state';
import {
  MAPPING,
  MAPPING_BODY,
  MAPPING_CHANNELS,
  MAPPING_SCREEN,
  MAPPING_SEARCH,
  MAPPING_VISIBLE,
  SEARCH_FIELD_ID,
  createMapping,
  currentOf,
  fixedRows,
  isCurrent,
  pinFor,
  pinOf,
} from './mapping-state';

const PANEL: SourceRecord = {
  id: 's1',
  type: 'xtream',
  name: 'My panel',
  account: { base: 'http://panel.test:8080', username: 'user', password: 'secret' },
  added: 1,
};
const KEY = 'x:s1:live:109';
const TARGET = { key: KEY, name: '18+ Test Pattern' };

function sourceMeta(src: string): SourceMeta {
  return { src, gen: 1, building: null, nextGen: 2, updatedAt: 1, counts: { live: 10 } };
}

/** Guide channel `i`: the user's guide's for even numbers below 10, the panel's for the rest. */
function guideChannel(i: number): GuideChannel {
  return { epgSrc: i < 10 && i % 2 === 0 ? 'u~g1' : 's1:xmltv', id: `c${i}`, name: `Guide ${i}` };
}

type Kind = 'read' | 'page' | 'lookup' | 'edit';

interface Held {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** The data engine: `total` guide channels searched by their names and ids, the profile's edits applied for real. */
class FakeEngine implements MappingEngine {
  doc: ProfileDoc = { ...emptyProfile(), sources: [PANEL], guides: [{ id: 'g1', url: 'http://guides.test/a.xml?key=k' }] };
  /** What the guides matched the channel to (its now/next). */
  match: Pick<EpgNowNext, 'epgSrc' | 'channel'> = { epgSrc: null, channel: null };
  total = 120;
  version = 1;
  readonly status: EpgStatus = { guides: [], matched: 0, sources: [sourceMeta('s1')], mapping: '-' };
  readonly asks: GuideChannelsRequest[] = [];
  readonly nowNexts: string[][] = [];
  readonly edits: ProfileEdit[] = [];
  reads = 0;
  readonly fail = new Set<Kind>();
  hold = new Set<Kind>();
  readonly held: Record<Kind, Held[]> = { read: [], page: [], lookup: [], edit: [] };

  private answer<T>(kind: Kind, value: () => T): Promise<T> {
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
    this.reads += 1;
    return this.answer('read', () => ({ doc: this.doc, newer: false, migratedFrom: null }));
  }

  epgStatus(): Promise<EpgStatus> {
    return this.answer('read', () => this.status);
  }

  nowNext(keys: string[]): Promise<EpgNowNext[]> {
    this.nowNexts.push(keys);
    return this.answer('read', () => keys.map((key) => ({ key, ...this.match, method: this.match.epgSrc === null ? null : 'xtream-id', now: null, next: null })));
  }

  guideChannels(req: GuideChannelsRequest): Promise<GuideChannelsPage> {
    this.asks.push(req);
    return this.answer(req.epgSrc === undefined ? 'page' : 'lookup', () => {
      const words = req.query.toLowerCase().split(' ').filter((w) => w !== '');
      const found: GuideChannel[] = [];
      for (let i = 0; i < this.total; i += 1) {
        const c = guideChannel(i);
        if (req.epgSrc !== undefined && c.epgSrc !== req.epgSrc) continue;
        if (words.every((w) => c.name.toLowerCase().indexOf(w) !== -1 || c.id.indexOf(w) !== -1)) found.push(c);
      }
      return { version: this.version, count: found.length, offset: req.offset, rows: found.slice(req.offset, req.offset + req.limit) };
    });
  }

  editProfile(edit: ProfileEdit): Promise<boolean> {
    this.edits.push(edit);
    return this.answer('edit', () => {
      const next = applyProfileEdit(this.doc, edit);
      if (next === null) return false;
      this.doc = next as ProfileDoc;
      return true;
    });
  }

  /** The pages of all the guides' channels asked, by number (`query`: only those of that query). */
  pages(query?: string): number[] {
    return this.asks.filter((a) => a.epgSrc === undefined && (query === undefined || a.query === query)).map((a) => a.offset / MAPPING.page);
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/** The scheduler's `refreshNow`: each call held until the test settles it. */
function refresher() {
  const calls: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  const refreshNow = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  return { refreshNow, calls };
}

function setup(engine = new FakeEngine()) {
  const nav = createNavigator({
    root: { id: 'unmatched', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  const refresh = refresher();
  const mapped = vi.fn();
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
  const mapping = createMapping({ nav, engine, refreshNow: refresh.refreshNow, mapped, platform, find, now: () => 10_000 });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  /** The rows `from` to `to - 1` as text (`-` for one not read). */
  const rows = (from: number, to: number): string[] => {
    const out: string[] = [];
    for (let i = from; i < to; i += 1) {
      const row = mapping.row(i);
      out.push(row === null ? '-' : row.kind === 'channel' ? row.channel.id : row.kind);
    }
    return out;
  };
  return { nav, engine, refresh, mapped, input, find, mapping, at, press, rows };
}

/** Opens the picker on the test channel and lets its reads land. */
async function opened(engine = new FakeEngine()) {
  const t = setup(engine);
  t.mapping.open(TARGET);
  await flush();
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const off: MappingRow = { kind: 'off' };
const auto: MappingRow = { kind: 'auto' };
const row = (epgSrc: string, id: string): MappingRow => ({ kind: 'channel', channel: { epgSrc, id, name: id } });

describe('the picker’s layout numbers', () => {
  it('fits 7 rows of 88 px under the header, its line and the search field', () => {
    expect(MAPPING_BODY).toBe(SCREEN.height - 2 * SCREEN.safeY - 56 - 24 - 56 - 150 - 16);
    expect(MAPPING_VISIBLE).toBe(7);
    expect(MAPPING_VISIBLE * (MAPPING.rowHeight + MAPPING.rowGap) - MAPPING.rowGap).toBeLessThanOrEqual(MAPPING_BODY);
    expect([MAPPING.page, MAPPING.pages, MAPPING.lookup]).toEqual([50, 6, 50]);
    expect([MAPPING_SCREEN, MAPPING_SEARCH, MAPPING_CHANNELS, SEARCH_FIELD_ID]).toEqual(['guide-map', 'search', 'channels', 'mapping-search']);
  });
});

describe('pinOf', () => {
  const docWith = (overrides: unknown): unknown => ({ ...emptyProfile(), epgOverrides: overrides });

  it('reads a mapping to a guide’s channel and one to no guide', () => {
    const doc = docWith({ [KEY]: { epgSrc: 's1:xmltv', channel: 'zoma.kids' }, 'x:s1:live:1': { epgSrc: '', channel: null } });
    expect(pinOf(doc, KEY)).toEqual({ epgSrc: 's1:xmltv', channel: 'zoma.kids' });
    expect(pinOf(doc, 'x:s1:live:1')).toEqual({ epgSrc: '', channel: null });
  });

  it('finds none for another channel, a document without mappings, or no document', () => {
    expect(pinOf(docWith({ 'x:s1:live:1': { epgSrc: '', channel: null } }), KEY)).toBeNull();
    expect(pinOf(emptyProfile(), KEY)).toBeNull();
    expect(pinOf(docWith(null), KEY)).toBeNull();
    expect(pinOf(null, KEY)).toBeNull();
    expect(pinOf(undefined, KEY)).toBeNull();
    // A name every object inherits is not a mapping.
    expect(pinOf(docWith({}), 'toString')).toBeNull();
  });

  it.each([
    ['no guide naming a guide', { epgSrc: 's1:xmltv', channel: null }],
    ['a channel without its guide', { epgSrc: '', channel: 'zoma.kids' }],
    ['a guide that is no text', { epgSrc: 7, channel: 'zoma.kids' }],
    ['a channel that is no text', { epgSrc: 's1:xmltv', channel: 7 }],
    ['no channel at all', { epgSrc: 's1:xmltv' }],
    ['a number', 7],
    ['null', null],
  ])('finds none in %s', (_name, pin) => {
    expect(pinOf(docWith({ [KEY]: pin }), KEY)).toBeNull();
  });
});

describe('the current match', () => {
  it('is the mapping when there is one, else what the guides matched, else none', () => {
    const matched = { epgSrc: 's1:xmltv', channel: 'zoma.test1' };
    expect(currentOf({ epgSrc: '', channel: null }, matched)).toEqual({ kind: 'off' });
    expect(currentOf({ epgSrc: 'u~g1', channel: 'kids' }, matched)).toEqual({ kind: 'pin', epgSrc: 'u~g1', channel: 'kids' });
    expect(currentOf(null, matched)).toEqual({ kind: 'auto', epgSrc: 's1:xmltv', channel: 'zoma.test1' });
    expect(currentOf(null, { epgSrc: null, channel: null })).toEqual({ kind: 'none' });
    expect(currentOf(null, null)).toEqual({ kind: 'none' });
  });

  it('puts "Match automatically" after "No guide" only for a channel with a mapping', () => {
    expect(fixedRows({ kind: 'none' })).toBe(1);
    expect(fixedRows({ kind: 'auto', epgSrc: 'a', channel: 'b' })).toBe(1);
    expect(fixedRows({ kind: 'pin', epgSrc: 'a', channel: 'b' })).toBe(2);
    expect(fixedRows({ kind: 'off' })).toBe(2);
  });

  const cases: [string, MappingCurrent][] = [
    ['none', { kind: 'none' }],
    ['off', { kind: 'off' }],
    ['auto', { kind: 'auto', epgSrc: 's1:xmltv', channel: 'c1' }],
    ['pin', { kind: 'pin', epgSrc: 's1:xmltv', channel: 'c1' }],
  ];

  it.each(cases)('marks the row that is the match (%s)', (kind, current) => {
    expect(isCurrent(off, current)).toBe(kind === 'off');
    expect(isCurrent(auto, current)).toBe(false);
    expect(isCurrent(row('s1:xmltv', 'c1'), current)).toBe(kind === 'auto' || kind === 'pin');
    // The same id in another guide, another id in the same guide.
    expect(isCurrent(row('u~g1', 'c1'), current)).toBe(false);
    expect(isCurrent(row('s1:xmltv', 'c2'), current)).toBe(false);
  });

  it.each(cases)('saves what OK on a row changes, and nothing on the match (%s)', (kind, current) => {
    expect(pinFor(off, current)).toEqual(kind === 'off' ? undefined : { epgSrc: '', channel: null });
    expect(pinFor(auto, current)).toBeNull();
    expect(pinFor(row('s1:xmltv', 'c1'), current)).toEqual(kind === 'auto' || kind === 'pin' ? undefined : { epgSrc: 's1:xmltv', channel: 'c1' });
    expect(pinFor(row('u~g1', 'c1'), current)).toEqual({ epgSrc: 'u~g1', channel: 'c1' });
  });
});

describe('the picker (step 24e)', () => {
  it('opens on the search field and reads the profile, the channel’s now/next and the guides, then the first page', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['read', 'page']);
    const t = setup(engine);
    t.mapping.open(TARGET);
    await flush();
    expect(t.at()).toBe('guide-map · search 0');
    expect(t.mapping.screen.value).toBe(t.nav.top);
    expect(t.mapping.target.value).toEqual(TARGET);
    expect(t.nav.top.zone(MAPPING_SEARCH)).toMatchObject({ kind: 'list', axis: 'vertical', count: 1, neighbours: { down: MAPPING_CHANNELS } });
    expect(t.nav.top.zone(MAPPING_CHANNELS)).toMatchObject({ kind: 'list', axis: 'vertical', count: 0, visible: 7, neighbours: { up: MAPPING_SEARCH } });
    expect([t.mapping.status.value, t.mapping.current.value, t.mapping.fixed(), t.mapping.row(0), t.mapping.pending.value]).toEqual(['loading', null, 0, null, 1]);
    expect(t.engine.nowNexts).toEqual([[KEY]]);
    expect(t.engine.asks).toEqual([]);
    engine.held.read.splice(0).forEach((h) => h.resolve());
    await flush();
    // The match is in: "No guide" shows; the first page is out.
    expect(t.mapping.current.value).toEqual({ kind: 'none' });
    expect(t.mapping.fixed()).toBe(1);
    expect(t.rows(0, 2)).toEqual(['off', '-']);
    expect((t.nav.top.zone(MAPPING_CHANNELS) as { count: number }).count).toBe(1);
    expect(t.engine.asks).toEqual([{ query: '', offset: 0, limit: 50 }]);
    expect([t.mapping.status.value, t.mapping.pending.value]).toEqual(['loading', 1]);
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    expect([t.mapping.status.value, t.mapping.count.value, t.mapping.pending.value]).toEqual(['ready', 120, 0]);
    expect((t.nav.top.zone(MAPPING_CHANNELS) as { count: number }).count).toBe(121);
    expect(t.rows(0, 4)).toEqual(['off', 'c0', 'c1', 'c2']);
    expect(t.rows(50, 52)).toEqual(['c49', '-']);
    expect(t.mapping.drawn.value).toBeGreaterThan(0);
    // The guides' links as the guides screen shows them: never a login.
    expect([t.mapping.link('u~g1'), t.mapping.link('s1:xmltv'), t.mapping.link('s9:xmltv')]).toEqual(['guides.test/a.xml', 'panel.test:8080/xmltv.php', '']);
    // Down: "No guide" first.
    await t.press('DOWN');
    expect(t.at()).toBe('guide-map · channels 0');
    await t.press('UP');
    expect(t.at()).toBe('guide-map · search 0');
  });

  it('marks the channel the guides matched, and names it from its own guide', async () => {
    const engine = new FakeEngine();
    engine.match = { epgSrc: 's1:xmltv', channel: 'c3' };
    const t = await opened(engine);
    expect(t.mapping.current.value).toEqual({ kind: 'auto', epgSrc: 's1:xmltv', channel: 'c3' });
    expect(engine.asks[0]).toEqual({ epgSrc: 's1:xmltv', query: 'c3', offset: 0, limit: 50 });
    expect(t.mapping.currentName.value).toBe('Guide 3');
    expect(t.mapping.fixed()).toBe(1);
    const marked: number[] = [];
    for (let i = 0; i < 52; i += 1) {
      const r = t.mapping.row(i);
      if (r !== null && t.mapping.marked(r)) marked.push(i);
    }
    expect(marked).toEqual([4]);
  });

  it('marks a mapping, with "Match automatically" after "No guide"; a mapping to no guide marks "No guide"', async () => {
    const engine = new FakeEngine();
    engine.doc = { ...engine.doc, epgOverrides: { [KEY]: { epgSrc: 'u~g1', channel: 'c2' } } };
    engine.match = { epgSrc: 'u~g1', channel: 'c2' };
    const t = await opened(engine);
    expect(t.mapping.current.value).toEqual({ kind: 'pin', epgSrc: 'u~g1', channel: 'c2' });
    expect(t.mapping.currentName.value).toBe('Guide 2');
    expect(t.rows(0, 4)).toEqual(['off', 'auto', 'c0', 'c1']);
    expect((t.nav.top.zone(MAPPING_CHANNELS) as { count: number }).count).toBe(122);
    expect(t.mapping.marked(t.mapping.row(4)!)).toBe(true);
    expect(t.mapping.marked(t.mapping.row(0)!)).toBe(false);
    await t.press('BACK');

    engine.doc = { ...engine.doc, epgOverrides: { [KEY]: { epgSrc: '', channel: null } } };
    engine.match = { epgSrc: null, channel: null };
    t.mapping.open(TARGET);
    await flush();
    expect(t.mapping.current.value).toEqual({ kind: 'off' });
    expect(t.mapping.marked(t.mapping.row(0)!)).toBe(true);
    expect(t.rows(0, 3)).toEqual(['off', 'auto', 'c0']);
    // No lookup for no guide.
    expect(engine.asks.filter((a) => a.epgSrc !== undefined)).toHaveLength(1);
    expect(t.mapping.currentName.value).toBe('');
  });

  it('leaves the name out when the guide doesn’t list the channel, or its lookup fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.match = { epgSrc: 's1:xmltv', channel: 'gone' };
    const t = await opened(engine);
    expect(t.mapping.currentName.value).toBe('');
    await t.press('BACK');
    engine.match = { epgSrc: 's1:xmltv', channel: 'c3' };
    engine.fail.add('lookup');
    t.mapping.open(TARGET);
    await flush();
    expect(t.mapping.currentName.value).toBe('');
    expect(t.mapping.status.value).toBe('ready');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('asks only the pages around the window, past the fixed rows, and keeps six', async () => {
    const engine = new FakeEngine();
    engine.total = 20_000;
    const t = await opened(engine);
    expect(engine.pages()).toEqual([0]);
    // To row 50 (channel 49): the window starts at 44, channels 36 to 56 are wanted: page 1 too.
    t.nav.top.focus(MAPPING_CHANNELS, 50);
    await flush();
    expect(t.nav.top.position(MAPPING_CHANNELS).top).toBe(44);
    expect(engine.pages()).toEqual([0, 1]);
    // Row 49 alone (channels 35 to 55 from top 43 less one) would still be page 1: the fixed row counts.
    t.nav.top.focus(MAPPING_CHANNELS, 10_001);
    await flush();
    expect(engine.pages().slice(2)).toEqual([199, 200]);
    expect(t.mapping.row(10_001)).toEqual({ kind: 'channel', channel: guideChannel(10_000) });
    for (const at of [5_001, 15_001, 19_998]) {
      t.nav.top.focus(MAPPING_CHANNELS, at);
      await flush();
    }
    expect(engine.pages().slice(4)).toEqual([99, 100, 299, 300, 399]);
    // Pages 0, 1 and 199 went, the least recently wanted.
    expect([t.mapping.row(1), t.mapping.row(51), t.mapping.row(9_951)]).toEqual([null, null, null]);
    expect(t.mapping.row(10_001)).not.toBeNull();
    // Page 100 again: held, nothing asked.
    const asked = engine.asks.length;
    t.nav.top.focus(MAPPING_CHANNELS, 5_011);
    await flush();
    expect(engine.asks.length).toBe(asked);
  });

  it('never asks a page past the end', async () => {
    const engine = new FakeEngine();
    engine.total = 50;
    const t = await opened(engine);
    t.nav.top.focus(MAPPING_CHANNELS, 50);
    await flush();
    expect(engine.pages()).toEqual([0]);
    expect(t.rows(49, 51)).toEqual(['c48', 'c49']);
  });

  it('takes a newer version: the pages held go and the window is asked again; an older answer is dropped', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    t.nav.top.focus(MAPPING_CHANNELS, 60);
    await flush();
    expect(engine.pages()).toEqual([0, 1]);
    engine.version = 2;
    engine.total = 100;
    engine.hold = new Set(['page']);
    t.nav.top.focus(MAPPING_CHANNELS, 110);
    await flush();
    expect(engine.pages()).toEqual([0, 1, 2]);
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    // Version 2 dropped pages 0 and 1: the window wants page 1 again.
    expect(t.mapping.count.value).toBe(100);
    expect(engine.pages().slice(3)).toEqual([1]);
    // An answer of version 1 landing now is dropped, and the page stays asked.
    engine.version = 1;
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    expect(t.mapping.row(61)).toBeNull();
    expect(t.mapping.count.value).toBe(100);
  });

  it('searches again at each change of the words: the list from its top, older answers dropped', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    t.nav.top.focus(MAPPING_CHANNELS, 30);
    await flush();
    engine.hold = new Set(['page']);
    const drawn = t.mapping.drawn.value;
    t.mapping.setQuery('guide 1');
    expect(t.mapping.query.value).toBe('guide 1');
    expect(t.mapping.drawn.value).toBe(drawn + 1);
    expect(t.rows(0, 2)).toEqual(['off', '-']);
    expect(t.nav.top.position(MAPPING_CHANNELS).index).toBe(0);
    t.mapping.setQuery('guide 11');
    expect(engine.pages('guide 1')).toEqual([0]);
    expect(engine.pages('guide 11')).toEqual([0]);
    // The first query's answer lands last: dropped.
    const [first, second] = engine.held.page.splice(0);
    second!.resolve();
    await flush();
    first!.resolve();
    await flush();
    expect(t.mapping.count.value).toBe(11);
    expect(t.rows(0, 4)).toEqual(['off', 'c11', 'c110', 'c111']);
    // No words: every channel again.
    engine.hold = new Set();
    t.mapping.setQuery('');
    await flush();
    expect(t.mapping.count.value).toBe(120);
  });

  it('keeps words typed before the match is read for the first page; a failed later search keeps the list ready', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.hold = new Set(['read']);
    const t = setup(engine);
    t.mapping.open(TARGET);
    t.mapping.setQuery('guide 7');
    expect(engine.asks).toEqual([]);
    engine.held.read.splice(0).forEach((h) => h.resolve());
    await flush();
    expect(engine.asks).toEqual([{ query: 'guide 7', offset: 0, limit: 50 }]);
    expect(t.rows(0, 3)).toEqual(['off', 'c7', 'c17']);
    engine.fail.add('page');
    t.mapping.setQuery('guide 8');
    await flush();
    expect(t.mapping.status.value).toBe('ready');
    expect(warn).toHaveBeenCalledTimes(1);
    // Asked again once the focus moves.
    engine.fail.delete('page');
    await t.press('DOWN', 'DOWN');
    expect(engine.pages('guide 8')).toEqual([0, 0]);
    expect(t.rows(0, 2)).toEqual(['off', 'c8']);
  });

  it('says it failed when the first reads or the first page fail, and drops failures of a closed picker', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.fail.add('read');
    const t = await opened(engine);
    expect(t.mapping.status.value).toBe('failed');
    expect(t.mapping.current.value).toBeNull();
    expect(engine.asks).toEqual([]);
    await t.press('BACK');
    engine.fail.delete('read');
    engine.fail.add('page');
    t.mapping.open(TARGET);
    await flush();
    expect(t.mapping.status.value).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(2);
    // Closed while its reads and its page are out: nothing lands.
    await t.press('BACK');
    engine.hold = new Set(['read']);
    t.mapping.open(TARGET);
    await t.press('BACK');
    engine.held.read.splice(0).forEach((h) => h.reject(new Error('late')));
    await flush();
    engine.fail.delete('page');
    engine.hold = new Set(['page']);
    t.mapping.open(TARGET);
    await flush();
    await t.press('BACK');
    engine.held.page.splice(0)[0]!.reject(new Error('late'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(t.mapping.status.value).toBe('loading');
  });

  it('opens afresh: the last opening’s words, match and rows are gone, and its answers dropped', async () => {
    const engine = new FakeEngine();
    engine.match = { epgSrc: 's1:xmltv', channel: 'c3' };
    const t = await opened(engine);
    t.mapping.setQuery('guide 3');
    await flush();
    await t.press('BACK');
    expect(t.mapping.screen.value).toBeNull();
    expect(t.mapping.target.value).toBeNull();
    expect(t.at()).toBe('unmatched · channels 0');
    engine.match = { epgSrc: null, channel: null };
    engine.hold = new Set(['read', 'lookup']);
    t.mapping.open({ key: 'x:s1:live:1', name: 'Other' });
    expect([t.mapping.query.value, t.mapping.current.value, t.mapping.currentName.value, t.mapping.count.value, t.mapping.status.value]).toEqual(['', null, '', 0, 'loading']);
    expect(t.mapping.row(1)).toBeNull();
    engine.held.read.splice(0).forEach((h) => h.resolve());
    await flush();
    expect(t.mapping.current.value).toEqual({ kind: 'none' });
    expect(engine.nowNexts[1]).toEqual(['x:s1:live:1']);
  });

  it('opens the TV’s keyboard on OK on the search field', async () => {
    const t = await opened();
    await t.press('OK');
    expect(t.find).toHaveBeenCalledWith(SEARCH_FIELD_ID);
    expect(t.input.focused).toBe(1);
    expect(t.mapping.editor.editing.value).toBe(SEARCH_FIELD_ID);
    // The edit ends on the keyboard's own Back: the focus stays on the field.
    t.mapping.editor.field(SEARCH_FIELD_ID).onEditKey({ key: 'Escape', keyCode: 27, preventDefault: () => undefined, stopPropagation: () => undefined });
    expect(t.mapping.editor.editing.value).toBeNull();
    expect(t.at()).toBe('guide-map · search 0');
  });

  it('closes on Back with nothing saved, the keyboard closed first', async () => {
    const t = await opened();
    await t.press('OK');
    expect(t.mapping.editor.editing.value).toBe(SEARCH_FIELD_ID);
    // (A remote's Back while typing reaches the keyboard; a pointer's Back here.)
    await t.press('BACK');
    expect(t.mapping.editor.editing.value).toBeNull();
    expect(t.at()).toBe('unmatched · channels 0');
    expect(t.engine.edits).toEqual([]);
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
  });

  it('saves "No guide", reads the guides again, says so until that settles, then tells the lists', async () => {
    const t = await opened();
    await t.press('DOWN', 'OK');
    expect(t.at()).toBe('unmatched · channels 0');
    expect(t.mapping.screen.value).toBeNull();
    expect(t.engine.edits).toEqual([{ kind: 'epgOverride', key: KEY, pin: { epgSrc: '', channel: null } }]);
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(1);
    expect([t.mapping.reading.value, t.mapping.pending.value]).toEqual([1, 1]);
    expect(t.mapped).not.toHaveBeenCalled();
    t.refresh.calls[0]!.resolve();
    await flush();
    expect([t.mapping.reading.value, t.mapping.pending.value]).toEqual([0, 0]);
    expect(t.mapped).toHaveBeenCalledTimes(1);
  });

  it('saves a guide’s channel, and "Match automatically" takes a mapping away', async () => {
    const t = await opened();
    // The third channel: c2 of the user's guide.
    await t.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'epgOverride', key: KEY, pin: { epgSrc: 'u~g1', channel: 'c2' } }]);
    t.refresh.calls[0]!.resolve();
    await flush();
    t.mapping.open(TARGET);
    await flush();
    expect(t.mapping.current.value).toEqual({ kind: 'pin', epgSrc: 'u~g1', channel: 'c2' });
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'epgOverride', key: KEY, pin: null });
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(2);
    expect(t.engine.doc.epgOverrides).toEqual({});
  });

  it('changes nothing on OK on the current match, and on a row not read yet', async () => {
    const engine = new FakeEngine();
    engine.match = { epgSrc: 's1:xmltv', channel: 'c1' };
    engine.total = 20_000;
    const t = await opened(engine);
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe('unmatched · channels 0');
    expect(engine.edits).toEqual([]);
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
    // A row whose page is on its way: the picker stays.
    t.mapping.open(TARGET);
    await flush();
    engine.hold = new Set(['page']);
    t.nav.top.focus(MAPPING_CHANNELS, 10_001);
    await flush();
    await t.press('OK');
    expect(t.at()).toBe('guide-map · channels 10001');
    expect(engine.edits).toEqual([]);
    // Before the match is read, nothing either.
    await t.press('BACK');
    engine.hold = new Set(['read']);
    t.mapping.open(TARGET);
    t.nav.top.focus(MAPPING_CHANNELS, 0);
    await t.press('OK');
    expect(t.nav.top.id).toBe(MAPPING_SCREEN);
  });

  it('reads nothing again when the edit changed nothing or failed; a failed refresh still settles', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.editProfile = (edit: ProfileEdit): Promise<boolean> => {
      engine.edits.push(edit);
      return Promise.resolve(false);
    };
    await t.press('DOWN', 'OK');
    expect(engine.edits).toHaveLength(1);
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
    expect(t.mapping.reading.value).toBe(0);
    engine.editProfile = (): Promise<boolean> => Promise.reject(new Error('worker gone'));
    t.mapping.open(TARGET);
    await flush();
    await t.press('DOWN', 'OK');
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    engine.editProfile = (): Promise<boolean> => Promise.resolve(true);
    t.mapping.open(TARGET);
    await flush();
    await t.press('DOWN', 'OK');
    t.refresh.calls[0]!.reject(new Error('slot gone'));
    await flush();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(t.mapping.reading.value).toBe(0);
    expect(t.mapped).toHaveBeenCalledTimes(1);
  });

  it('counts two mappings’ refreshes until both settle', async () => {
    const t = await opened();
    await t.press('DOWN', 'OK');
    t.mapping.open({ key: 'x:s1:live:1', name: 'Other' });
    await flush();
    await t.press('DOWN', 'OK');
    expect(t.mapping.reading.value).toBe(2);
    t.refresh.calls[1]!.resolve();
    await flush();
    expect(t.mapping.reading.value).toBe(1);
    t.refresh.calls[0]!.resolve();
    await flush();
    expect(t.mapping.reading.value).toBe(0);
    expect(t.mapped).toHaveBeenCalledTimes(2);
  });

  it('once disposed: no answer lands, no refresh starts, nobody is told, and it no longer opens', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    await t.press('DOWN', 'OK');
    engine.hold = new Set(['read', 'edit']);
    t.mapping.open(TARGET);
    await flush();
    t.mapping.dispose();
    t.mapping.dispose();
    engine.held.edit.splice(0)[0]!.resolve();
    engine.held.read.splice(0).forEach((h) => h.resolve());
    await flush();
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
    expect(t.mapping.current.value).toBeNull();
    // A refresh out when it goes: settles, tells nobody.
    const s = await opened();
    await s.press('DOWN', 'OK');
    s.mapping.dispose();
    s.refresh.calls[0]!.resolve();
    await flush();
    expect(s.mapping.reading.value).toBe(0);
    expect(s.mapped).not.toHaveBeenCalled();
    s.mapping.open(TARGET);
    expect(s.mapping.screen.value).toBeNull();
    // The focus no longer asks pages either.
    const pages = engine.asks.length;
    t.nav.top.focus(MAPPING_CHANNELS, 60);
    await flush();
    expect(engine.asks.length).toBe(pages);
  });
});
