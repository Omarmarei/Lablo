import type { LoadedProfile, SourceRecord, UnmatchedChannel, UnmatchedPage, UnmatchedRequest } from '@lablo/data';
import { emptyProfile } from '@lablo/data';
import type { Intent } from '@lablo/platform-api';
import { SCREEN, createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UnmatchedEngine } from './unmatched-state';
import { UNMATCHED, UNMATCHED_BODY, UNMATCHED_VISIBLE, createUnmatchedList } from './unmatched-state';

const PANEL: SourceRecord = {
  id: 's1',
  type: 'xtream',
  name: 'My panel',
  account: { base: 'http://panel.test:8080', username: 'user', password: 'secret' },
  added: 1,
};
const LIST: SourceRecord = { id: 's2', type: 'm3u', name: 'Home list', url: 'http://lists.test/a.m3u', added: 2 };

interface Held {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** Channel `i` of the worker's list: the first half from s1, the rest from s2. */
function channel(i: number, total: number): UnmatchedChannel {
  return { key: `k${i}`, name: `Channel ${i}`, src: i < total / 2 ? 's1' : 's2', category: i % 3 === 0 ? '' : 'News' };
}

/** The query worker: `total` channels without a guide at `version`, worked out when an answer is let go. */
class FakeEngine implements UnmatchedEngine {
  sources: SourceRecord[] = [PANEL, LIST];
  total = 120;
  version = 1;
  readonly asks: UnmatchedRequest[] = [];
  failProfile = false;
  failPage = false;
  hold = new Set<'profile' | 'page'>();
  readonly held: Record<'profile' | 'page', Held[]> = { profile: [], page: [] };

  private answer<T>(kind: 'profile' | 'page', value: () => T): Promise<T> {
    if (!this.hold.has(kind)) {
      try {
        return Promise.resolve(value());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise<T>((resolve, reject) => {
      this.held[kind].push({
        resolve: () => {
          try {
            resolve(value());
          } catch (error) {
            reject(error);
          }
        },
        reject,
      });
    });
  }

  profile(): Promise<LoadedProfile | null> {
    return this.answer('profile', () => {
      if (this.failProfile) throw new Error('no IndexedDB');
      return { doc: { ...emptyProfile(), sources: this.sources }, newer: false, migratedFrom: null };
    });
  }

  unmatched(req: UnmatchedRequest): Promise<UnmatchedPage> {
    this.asks.push(req);
    return this.answer('page', () => {
      if (this.failPage) throw new Error('worker gone');
      const rows: UnmatchedChannel[] = [];
      for (let i = req.offset; i < Math.min(this.total, req.offset + req.limit); i += 1) rows.push(channel(i, this.total));
      return { version: this.version, count: this.total, offset: req.offset, rows };
    });
  }

  /** The pages asked, by number. */
  pages(): number[] {
    return this.asks.map((a) => a.offset / UNMATCHED.page);
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function setup(engine = new FakeEngine(), map?: (target: { key: string; name: string }) => void) {
  const nav = createNavigator({
    root: { id: 'guides', zones: [{ kind: 'list', id: 'header', axis: 'horizontal', count: 2 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  nav.top.focus('header', 1);
  const list = createUnmatchedList({ nav, engine, ...(map === undefined ? {} : { map }) });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  /** The names of rows `from` to `to - 1` (`-` for a row not read). */
  const names = (from: number, to: number): string[] => {
    const out: string[] = [];
    for (let i = from; i < to; i += 1) out.push(list.row(i)?.name ?? '-');
    return out;
  };
  return { nav, engine, list, at, press, names };
}

async function opened(engine = new FakeEngine()) {
  const t = setup(engine);
  t.list.open();
  await flush();
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the list’s layout numbers', () => {
  it('fits 8 rows of 88 px under the header and its line, as on the guides screen', () => {
    expect(UNMATCHED_BODY).toBe(SCREEN.height - 2 * SCREEN.safeY - 56 - 24 - 56);
    expect(UNMATCHED_VISIBLE).toBe(8);
    expect(UNMATCHED_VISIBLE * (UNMATCHED.rowHeight + UNMATCHED.rowGap) - UNMATCHED.rowGap).toBeLessThanOrEqual(UNMATCHED_BODY);
    expect([UNMATCHED.page, UNMATCHED.pages]).toEqual([50, 6]);
  });
});

describe('"Channels without a guide" (step 24c)', () => {
  it('reads the profile, then the first page over its sources in their order; the focus on the first row', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['profile', 'page']);
    const t = setup(engine);
    t.list.open();
    await flush();
    expect(t.at()).toBe('unmatched · channels -1');
    expect(t.list.screen.value).toBe(t.nav.top);
    expect([t.list.status.value, t.list.pending.value]).toEqual(['loading', 1]);
    expect(engine.asks).toEqual([]);
    engine.held.profile.splice(0)[0]!.resolve();
    await flush();
    expect(engine.asks).toEqual([{ sources: ['s1', 's2'], offset: 0, limit: 50 }]);
    expect([t.list.status.value, t.list.pending.value]).toEqual(['loading', 1]);
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    expect([t.list.status.value, t.list.count.value, t.list.pending.value]).toEqual(['ready', 120, 0]);
    expect(t.at()).toBe('unmatched · channels 0');
    expect((t.nav.top.zone('channels') as { count: number; visible: number }).count).toBe(120);
    expect((t.nav.top.zone('channels') as { count: number; visible: number }).visible).toBe(8);
    expect(t.names(0, 3)).toEqual(['Channel 0', 'Channel 1', 'Channel 2']);
    expect(t.list.row(49)?.key).toBe('k49');
    expect(t.list.row(50)).toBeNull();
    expect(t.list.drawn.value).toBeGreaterThan(0);
    // Each row's source by its name; a source the profile doesn't have, none.
    expect([t.list.sourceName('s1'), t.list.sourceName('s2'), t.list.sourceName('s9')]).toEqual(['My panel', 'Home list', '']);
  });

  it('asks only the pages around the window, as the focus moves, and keeps six', async () => {
    const engine = new FakeEngine();
    engine.total = 20_000;
    const t = await opened(engine);
    // Rows 0 to 15 (the window and one more): page 0 alone.
    expect(engine.pages()).toEqual([0]);
    // To row 41: the window starts at 34, so rows 26 to 49 are wanted (page 0 still).
    for (let i = 0; i < 41; i += 1) await t.press('DOWN');
    expect(t.nav.top.position('channels').top).toBe(34);
    expect(engine.pages()).toEqual([0]);
    // One more: rows 27 to 50, page 1 too.
    await t.press('DOWN');
    expect(t.at()).toBe('unmatched · channels 42');
    expect(engine.pages()).toEqual([0, 1]);
    expect(t.names(49, 51)).toEqual(['Channel 49', 'Channel 50']);
    // Far down: two pages around the window, and nothing in between.
    t.nav.top.focus('channels', 10_000);
    await flush();
    expect(engine.pages().slice(2)).toEqual([199, 200]);
    expect(t.list.row(10_000)?.name).toBe('Channel 10000');
    expect(t.list.row(9_000)).toBeNull();
    // More places: the pages wanted least recently go first, never one the window needs.
    for (const row of [5_000, 15_000, 19_999]) {
      t.nav.top.focus('channels', row);
      await flush();
    }
    expect(t.at()).toBe('unmatched · channels 19999');
    expect(engine.pages().slice(4)).toEqual([99, 100, 299, 300, 399]);
    expect(t.list.row(19_999)?.name).toBe('Channel 19999');
    expect(t.list.row(15_000)?.name).toBe('Channel 15000');
    expect(t.list.row(5_000)?.name).toBe('Channel 5000');
    // Pages 0, 1 and 199 went, the least recently wanted: six are kept.
    expect([t.list.row(0), t.list.row(50), t.list.row(9_950)]).toEqual([null, null, null]);
    expect(t.list.row(10_000)?.name).toBe('Channel 10000');
    // Back up to page 100: held, so nothing is asked.
    const asked = engine.asks.length;
    t.nav.top.focus('channels', 5_010);
    await flush();
    expect(engine.asks.length).toBe(asked);
    // Page 1 went: wanted again, it is asked again.
    t.nav.top.focus('channels', 60);
    await flush();
    expect(engine.pages().slice(asked)).toEqual([1]);
    expect(t.list.row(60)?.name).toBe('Channel 60');
  });

  it('never asks a page past the end, also when the list ends on a page boundary', async () => {
    const engine = new FakeEngine();
    engine.total = 50;
    const t = await opened(engine);
    for (let i = 0; i < 49; i += 1) await t.press('DOWN');
    expect(t.at()).toBe('unmatched · channels 49');
    expect(engine.pages()).toEqual([0]);
    expect(t.list.row(49)?.name).toBe('Channel 49');
  });

  it('keeps a page wanted again over older ones', async () => {
    const engine = new FakeEngine();
    engine.total = 20_000;
    const t = await opened(engine);
    // Pages 0, 100, 200, 300, then 0 again, then 390, 50 and 150: one page too many.
    for (const row of [5_020, 10_020, 15_020, 0, 19_520, 2_520, 7_520]) {
      t.nav.top.focus('channels', row);
      await flush();
    }
    expect(engine.pages()).toEqual([0, 100, 200, 300, 390, 50, 150]);
    // Page 0 was wanted again after 100: page 100 went instead.
    expect(t.list.row(0)?.name).toBe('Channel 0');
    expect(t.list.row(5_020)).toBeNull();
    expect(t.list.row(10_020)?.name).toBe('Channel 10020');
  });

  it('takes a newer version: every page held goes, the count and the zone follow, and the window is asked again', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    for (let i = 0; i < 45; i += 1) await t.press('DOWN');
    expect(engine.pages()).toEqual([0, 1]);
    // A guide swapped in the worker: 60 channels now. The next page asked says so.
    engine.version = 2;
    engine.total = 60;
    engine.hold = new Set(['page']);
    t.nav.top.focus('channels', 110);
    await flush();
    expect(engine.pages()).toEqual([0, 1, 2]);
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    // Page 2 is past the new end: the focus goes to the last row, and pages 0 and 1 are asked again.
    expect(t.list.count.value).toBe(60);
    expect((t.nav.top.zone('channels') as { count: number }).count).toBe(60);
    expect(t.at()).toBe('unmatched · channels 59');
    expect(t.list.row(0)).toBeNull();
    expect(engine.pages()).toEqual([0, 1, 2, 0, 1]);
    for (const held of engine.held.page.splice(0)) held.resolve();
    await flush();
    expect(t.names(58, 60)).toEqual(['Channel 58', 'Channel 59']);
    expect(t.list.row(30)?.name).toBe('Channel 30');
  });

  it('drops an answer older than the pages held; the page asked again at the new version stays asked', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    // Page 1 asked at version 1 and held (A); the worker reloads before it answers.
    engine.hold = new Set(['page']);
    for (let i = 0; i < 45; i += 1) await t.press('DOWN');
    expect(engine.pages()).toEqual([0, 1]);
    const [a] = engine.held.page.splice(0);
    engine.version = 2;
    // Page 2 (B) answers first, at version 2: the pages held go, and page 1 is asked again (C).
    t.nav.top.focus('channels', 110);
    await flush();
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    expect(engine.pages()).toEqual([0, 1, 2, 1]);
    expect(t.list.row(110)?.name).toBe('Channel 110');
    expect(t.list.row(0)).toBeNull();
    // A lands now, from version 1: dropped (taking it would drop the pages again), and C is still
    // the one asked: a move asks nothing more.
    engine.version = 1;
    a!.resolve();
    await flush();
    expect(t.list.row(110)?.name).toBe('Channel 110');
    await t.press('DOWN');
    expect(engine.pages()).toEqual([0, 1, 2, 1]);
    engine.version = 2;
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    expect(t.list.row(60)?.name).toBe('Channel 60');
  });

  it('says it could not read the list when the profile or the first page fails; a later page that fails is asked again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const noProfile = new FakeEngine();
    noProfile.failProfile = true;
    let t = await opened(noProfile);
    expect([t.list.status.value, t.list.pending.value]).toEqual(['failed', 0]);
    expect(warn).toHaveBeenCalledWith('The sources could not be read', expect.any(Error));
    expect(noProfile.asks).toEqual([]);

    const noPage = new FakeEngine();
    noPage.failPage = true;
    t = await opened(noPage);
    expect(t.list.status.value).toBe('failed');
    expect(warn).toHaveBeenCalledWith('The channels without a guide could not be read', expect.any(Error));

    const later = new FakeEngine();
    t = await opened(later);
    later.failPage = true;
    // Row 42: page 1 is wanted first (and fails); each move after asks it again.
    for (let i = 0; i < 42; i += 1) await t.press('DOWN');
    expect(later.pages()).toEqual([0, 1]);
    expect(t.list.status.value).toBe('ready');
    expect(t.list.row(50)).toBeNull();
    later.failPage = false;
    await t.press('DOWN');
    expect(later.pages()).toEqual([0, 1, 1]);
    expect(t.list.row(50)?.name).toBe('Channel 50');
  });

  it('lists none with a count of 0, and OK on a row of a list with no mapping does nothing', async () => {
    const empty = new FakeEngine();
    empty.total = 0;
    let t = await opened(empty);
    expect([t.list.status.value, t.list.count.value]).toEqual(['ready', 0]);
    expect(t.at()).toBe('unmatched · channels -1');
    expect(empty.asks).toHaveLength(1);

    t = await opened();
    await t.press('DOWN', 'OK');
    expect(t.at()).toBe('unmatched · channels 1');
    expect(t.list.screen.value).toBe(t.nav.top);
  });

  it('closes on Back, the focus back on the header, and drops what lands after; it opens afresh', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['page']);
    const t = await opened(engine);
    await t.press('BACK');
    expect(t.at()).toBe('guides · header 1');
    expect(t.list.screen.value).toBeNull();
    for (const held of engine.held.page.splice(0)) held.resolve();
    await flush();
    expect(t.list.status.value).toBe('loading');
    expect(t.list.row(0)).toBeNull();

    // Again, with a held profile read from the first opening landing late.
    engine.hold = new Set(['profile']);
    t.list.open();
    await flush();
    const first = engine.held.profile.splice(0)[0]!;
    await t.press('BACK');
    t.list.open();
    await flush();
    engine.hold = new Set();
    first.resolve();
    await flush();
    expect(engine.asks).toHaveLength(1);
    engine.held.profile.splice(0)[0]!.resolve();
    await flush();
    expect(engine.asks).toHaveLength(2);
    expect(t.list.status.value).toBe('ready');
    expect(t.names(0, 1)).toEqual(['Channel 0']);
  });

  it('drops a failure that lands after the screen closed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.hold = new Set(['profile']);
    const t = await opened(engine);
    await t.press('BACK');
    engine.held.profile.splice(0)[0]!.reject(new Error('late'));
    await flush();
    expect(warn).not.toHaveBeenCalled();
    expect(t.list.status.value).toBe('loading');

    engine.hold = new Set(['page']);
    t.list.open();
    await flush();
    await t.press('BACK');
    engine.held.page.splice(0)[0]!.reject(new Error('late'));
    await flush();
    expect(warn).not.toHaveBeenCalled();
    expect(t.list.status.value).toBe('loading');
  });

  it('opens afresh after a list was read: loading, no rows, no count, until the new answer', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    expect(t.list.count.value).toBe(120);
    await t.press('BACK');
    engine.hold = new Set(['page']);
    t.list.open();
    await flush();
    expect([t.list.status.value, t.list.count.value, t.list.row(0)]).toEqual(['loading', 0, null]);
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    expect([t.list.status.value, t.list.count.value, t.list.row(0)?.name]).toEqual(['ready', 120, 'Channel 0']);
  });

  it('asks again, after reopening, a page that was still being read when the list closed', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['page']);
    for (let i = 0; i < 42; i += 1) await t.press('DOWN');
    expect(engine.pages()).toEqual([0, 1]);
    await t.press('BACK');
    engine.hold = new Set();
    t.list.open();
    await flush();
    for (let i = 0; i < 42; i += 1) await t.press('DOWN');
    expect(engine.pages()).toEqual([0, 1, 0, 1]);
    expect(t.list.row(50)?.name).toBe('Channel 50');
  });

  it('stops following the focus and drops every answer once disposed; it no longer opens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ready = new FakeEngine();
    const r = await opened(ready);
    r.list.dispose();
    r.nav.top.focus('channels', 110);
    await flush();
    expect(ready.pages()).toEqual([0]);

    const engine = new FakeEngine();
    engine.hold = new Set(['page']);
    const t = await opened(engine);
    t.list.dispose();
    t.list.dispose();
    engine.held.page.splice(0)[0]!.resolve();
    await flush();
    expect(t.list.status.value).toBe('loading');
    await t.press('BACK');
    t.list.open();
    await flush();
    expect(t.list.screen.value).toBeNull();
    expect(t.at()).toBe('guides · header 1');

    const failing = new FakeEngine();
    failing.hold = new Set(['profile']);
    const f = await opened(failing);
    f.list.dispose();
    failing.held.profile.splice(0)[0]!.reject(new Error('late'));
    await flush();
    expect(warn).not.toHaveBeenCalled();
  });
});

/** An engine whose profile holds `overrides` (step 24d's mappings), counting its reads. */
function mappedEngine(overrides: Record<string, unknown> | null) {
  const engine = new FakeEngine();
  const state = { overrides, reads: 0, none: false };
  // Through the engine's own read: held and failed as it is.
  const read = engine.profile.bind(engine);
  engine.profile = (): Promise<LoadedProfile | null> => {
    state.reads += 1;
    return read().then((loaded) => {
      if (state.none || loaded === null) return null;
      const doc = { ...loaded.doc, ...(state.overrides === null ? {} : { epgOverrides: state.overrides }) };
      return { ...loaded, doc: doc as LoadedProfile['doc'] };
    });
  };
  return { engine, state };
}

describe('"Channels without a guide" and the manual mapping (step 24e)', () => {
  it('opens the mapping on OK with the channel’s key and name; a row not read yet opens nothing', async () => {
    const map = vi.fn();
    const engine = new FakeEngine();
    engine.total = 20_000;
    const t = setup(engine, map);
    t.list.open();
    await flush();
    await t.press('DOWN', 'OK');
    expect(map).toHaveBeenCalledTimes(1);
    expect(map).toHaveBeenCalledWith({ key: 'k1', name: 'Channel 1' });
    // The list stays: the mapping goes over it.
    expect(t.at()).toBe('unmatched · channels 1');
    // Far down, before its page is read.
    engine.hold = new Set(['page']);
    t.nav.top.focus('channels', 10_000);
    await flush();
    await t.press('OK');
    expect(map).toHaveBeenCalledTimes(1);
  });

  it('says which channels the profile maps to no guide, from its read at the opening', async () => {
    const { engine } = mappedEngine({ k1: { epgSrc: '', channel: null }, k2: { epgSrc: 's1:xmltv', channel: 'lablo.kids' }, k3: 7 });
    engine.hold = new Set(['profile']);
    const t = setup(engine);
    t.list.open();
    await flush();
    // Not read yet: none.
    expect(t.list.noGuide('k1')).toBe(false);
    engine.held.profile.splice(0)[0]!.resolve();
    await flush();
    expect(['k0', 'k1', 'k2', 'k3'].map((key) => t.list.noGuide(key))).toEqual([false, true, false, false]);
    // A profile without mappings, or none at all.
    const bare = await opened(mappedEngine(null).engine);
    expect(bare.list.noGuide('k1')).toBe(false);
    const gone = mappedEngine({ k1: { epgSrc: '', channel: null } });
    gone.state.none = true;
    const none = await opened(gone.engine);
    expect(none.list.noGuide('k1')).toBe(false);
  });

  it('reads the profile and the window again on reload, dropping the pages held and the answers still out', async () => {
    const { engine, state } = mappedEngine({});
    engine.total = 20_000;
    const t = await opened(engine);
    t.nav.top.focus('channels', 10_000);
    await flush();
    expect(engine.pages()).toEqual([0, 199, 200]);
    // A page out when the reload comes: its answer is dropped.
    engine.hold = new Set(['page']);
    t.nav.top.focus('channels', 15_000);
    await flush();
    expect(engine.held.page).toHaveLength(2);
    const drawn = t.list.drawn.value;
    state.overrides = { k10000: { epgSrc: '', channel: null } };
    engine.total = 19_999;
    engine.hold = new Set();
    t.list.reload();
    expect(t.list.drawn.value).toBe(drawn + 1);
    // Every page held went at once; the profile is read again, then the window asked again.
    expect(t.list.row(15_000)).toBeNull();
    expect(t.list.row(10_000)).toBeNull();
    await flush();
    expect(state.reads).toBe(2);
    expect(engine.pages().slice(5)).toEqual([0, 299, 300]);
    expect(t.list.count.value).toBe(19_999);
    expect(t.list.noGuide('k10000')).toBe(true);
    expect(t.list.row(15_000)?.name).toBe('Channel 15000');
    // The answers of before the reload land late (from a newer version, a longer list): dropped.
    engine.version = 2;
    engine.total = 20_000;
    engine.held.page.splice(0).forEach((h) => h.resolve());
    await flush();
    expect(t.list.count.value).toBe(19_999);
    expect(t.list.row(15_000)?.name).toBe('Channel 15000');
    expect(t.list.status.value).toBe('ready');
  });

  it('reloads nothing once closed, never opened or disposed', async () => {
    const { engine, state } = mappedEngine({});
    const t = await opened(engine);
    await t.press('BACK');
    t.list.reload();
    await flush();
    expect(state.reads).toBe(1);
    const fresh = mappedEngine({});
    const never = setup(fresh.engine);
    never.list.reload();
    await flush();
    expect(fresh.state.reads).toBe(0);
    const gone = mappedEngine({});
    const d = await opened(gone.engine);
    d.list.dispose();
    d.list.reload();
    await flush();
    expect(gone.state.reads).toBe(1);
  });

  it('says it could not read the list when the profile read of a reload fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.failProfile = true;
    t.list.reload();
    await flush();
    expect(t.list.status.value).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
