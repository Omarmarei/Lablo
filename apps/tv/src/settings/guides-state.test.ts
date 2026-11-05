import type { EpgMeta, EpgStatus, EpgSummary, LoadedProfile, ProfileDoc, ProfileEdit, SourceMeta, SourceRecord, UnmatchedPage, UnmatchedRequest, UserGuide } from '@zoma/data';
import { applyProfileEdit, emptyProfile } from '@zoma/data';
import type { Intent, KeyLike, TextKey } from '@zoma/platform-api';
import type { EditableLike } from '@zoma/ui';
import { SCREEN, createNavigator } from '@zoma/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuideRow, GuidesEngine } from './guides-state';
import {
  GUIDES,
  GUIDES_BODY,
  GUIDES_VISIBLE,
  LINK_FIELD_ID,
  HEADER_ADD,
  HEADER_UNMATCHED,
  OFFSETS,
  OFFSET_STEPS,
  checkLink,
  createGuides,
  guideList,
  guideState,
  menuActions,
  nextGuideId,
  shownLink,
  summaryOf,
} from './guides-state';
import { SETTINGS_ITEMS, SETTINGS_SCREENS, createSettings } from './settings-state';

const PANEL: SourceRecord = {
  id: 's1',
  type: 'xtream',
  name: 'My panel',
  account: { base: 'http://panel.test:8080', username: 'user', password: 'secret' },
  added: 1,
};
const LIST: SourceRecord = { id: 's2', type: 'm3u', name: 'Home list', url: 'http://lists.test/a.m3u', added: 2 };
const PANEL_GUIDE = 'http://panel.test:8080/xmltv.php?username=user&password=secret';

function meta(epgSrc: string, patch: Partial<EpgMeta> = {}): EpgMeta {
  return { epgSrc, gen: 1, building: null, nextGen: 2, updatedAt: 1, checkedAt: 1, rank: 0, ...patch };
}

function sourceMeta(src: string, epgUrls?: string[]): SourceMeta {
  return { src, gen: 1, building: null, nextGen: 2, updatedAt: 1, counts: { live: 10 }, ...(epgUrls === undefined ? {} : { epgUrls }) };
}

function doc(guides: UserGuide[], sources: SourceRecord[] = [PANEL, LIST]): ProfileDoc {
  return { ...emptyProfile(), sources, guides };
}

interface Held {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** The data engine: the profile's guide edits applied for real, the status as set, answers held on request. */
class FakeEngine implements GuidesEngine {
  doc: ProfileDoc = doc([
    { id: 's1', url: 'http://guides.test/a.xml' },
    { id: 'g2', url: 'http://guides.test/b.xml?key=k' },
  ]);
  status: EpgStatus = {
    guides: [meta('u~s1'), meta('u~g2', { gen: 0, failure: { code: 'http', status: 404 }, failedAt: 5 }), meta('s1:xmltv'), meta('s2:tvg0', { gen: 0 })],
    matched: 3,
    sources: [sourceMeta('s1'), sourceMeta('s2', ['http://lists.test/guide.xml'])],
  };
  readonly edits: ProfileEdit[] = [];
  profileCalls = 0;
  statusCalls = 0;
  failRead = false;
  failEdit = false;
  /** What `unmatched` counts (step 24c), the asks it had, and whether it fails. */
  unmatchedCount = 4;
  readonly counts: UnmatchedRequest[] = [];
  failCount = false;
  hold = new Set<'read' | 'edit' | 'count'>();
  readonly held: Record<'read' | 'edit' | 'count', Held[]> = { read: [], edit: [], count: [] };

  private answer<T>(kind: 'read' | 'edit' | 'count', value: () => T): Promise<T> {
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
    this.profileCalls += 1;
    return this.answer('read', () => {
      if (this.failRead) throw new Error('no IndexedDB');
      return { doc: this.doc, newer: false, migratedFrom: null };
    });
  }

  epgStatus(): Promise<EpgStatus> {
    this.statusCalls += 1;
    return this.answer('read', () => this.status);
  }

  unmatched(req: UnmatchedRequest): Promise<UnmatchedPage> {
    this.counts.push(req);
    return this.answer('count', () => {
      if (this.failCount) throw new Error('worker gone');
      return { version: 1, count: this.unmatchedCount, offset: req.offset, rows: [] };
    });
  }

  editProfile(edit: ProfileEdit): Promise<boolean> {
    this.edits.push(edit);
    return this.answer('edit', () => {
      if (this.failEdit) throw new Error('worker gone');
      const next = applyProfileEdit(this.doc, edit);
      if (next === null) return false;
      this.doc = next;
      return true;
    });
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
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const refresh = refresher();
  const input: EditableLike & { focused: number } = {
    focused: 0,
    focus() {
      this.focused += 1;
    },
    blur: () => undefined,
  };
  const find = vi.fn((id: string) => (id === LINK_FIELD_ID ? input : null));
  const stopKeyboard = vi.fn();
  const platform = {
    textKey: (event: KeyLike): TextKey | null => (event.key === 'Enter' ? 'done' : event.key === 'Escape' ? 'close' : null),
    onSoftKeyboard: () => stopKeyboard,
  };
  const offsetChanged = vi.fn();
  const openUnmatched = vi.fn();
  const guides = createGuides({ nav, engine, refreshNow: refresh.refreshNow, offsetChanged, openUnmatched, platform, find, now: () => 10_000 });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const sources = (): string[] => guides.rows.value.map((r) => r.epgSrc);
  return { nav, engine, refresh, offsetChanged, openUnmatched, guides, input, find, stopKeyboard, at, press, sources };
}

/** Opens the guides screen and lets its first read land. */
async function opened(engine = new FakeEngine()) {
  const t = setup(engine);
  t.guides.open();
  await flush();
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the guides screen’s layout numbers', () => {
  it('fits 6 rows of 120 px under the header and the line on the order', () => {
    expect(GUIDES_BODY).toBe(SCREEN.height - 2 * SCREEN.safeY - 56 - 24 - 56);
    expect(GUIDES_VISIBLE).toBe(6);
    expect(GUIDES_VISIBLE * (GUIDES.rowHeight + GUIDES.rowGap) - GUIDES.rowGap).toBeLessThanOrEqual(GUIDES_BODY);
  });
});

describe('shownLink', () => {
  it.each([
    ['http://guides.test/epg/a.xml', 'guides.test/epg/a.xml'],
    ['https://Guides.test:8443/a.xml.gz', 'Guides.test:8443/a.xml.gz'],
    ['http://panel.test/xmltv.php?username=u&password=p', 'panel.test/xmltv.php'],
    ['http://guides.test/a.xml#top', 'guides.test/a.xml'],
    ['http://guides.test/a.xml#x?y', 'guides.test/a.xml'],
    ['http://guides.test/a.xml?k=v#top', 'guides.test/a.xml'],
    ['http://user:pass@guides.test/a.xml', 'guides.test/a.xml'],
    ['http://guides.test/a@b.xml', 'guides.test/a@b.xml'],
    ['http://user@guides.test', 'guides.test'],
    ['guides.test/a.xml', 'guides.test/a.xml'],
  ])('shows %s as %s', (url, shown) => {
    expect(shownLink(url)).toBe(shown);
  });
});

describe('nextGuideId', () => {
  it('is one past the highest g id, ignoring every other id', () => {
    expect(nextGuideId([])).toBe('g1');
    expect(nextGuideId(['s1', 's7', 'g', 'gx', 'g2b', 'xg9'])).toBe('g1');
    expect(nextGuideId(['g3', 's1', 'g1'])).toBe('g4');
    expect(nextGuideId(['g10', 'g9'])).toBe('g11');
  });
});

describe('menuActions', () => {
  it('offers a move only where the guide can go, then the time offset', () => {
    expect(menuActions(0, 1)).toEqual(['offset', 'remove', 'cancel']);
    expect(menuActions(0, 3)).toEqual(['down', 'offset', 'remove', 'cancel']);
    expect(menuActions(1, 3)).toEqual(['up', 'down', 'offset', 'remove', 'cancel']);
    expect(menuActions(2, 3)).toEqual(['up', 'offset', 'remove', 'cancel']);
    expect(menuActions(2, 3, 'mine')).toEqual(['up', 'offset', 'remove', 'cancel']);
  });

  it("offers a source's own guide its time offset alone", () => {
    expect(menuActions(0, 0, 'source')).toEqual(['offset', 'cancel']);
    expect(menuActions(3, 5, 'source')).toEqual(['offset', 'cancel']);
  });

  it('offers the matches after the time offset for a guide that was read (step 24c)', () => {
    expect(menuActions(0, 1, 'mine', true)).toEqual(['offset', 'matches', 'remove', 'cancel']);
    expect(menuActions(1, 3, 'mine', true)).toEqual(['up', 'down', 'offset', 'matches', 'remove', 'cancel']);
    expect(menuActions(3, 5, 'source', true)).toEqual(['offset', 'matches', 'cancel']);
    expect(menuActions(1, 3, 'mine', false)).toEqual(['up', 'down', 'offset', 'remove', 'cancel']);
  });
});

describe('checkLink', () => {
  const listed = ['http://guides.test/a.xml'];
  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['guides.test/a b.xml', 'spaces'],
    ['ftp://guides.test/a.xml', 'url'],
    ['http://user:pw@guides.test/a.xml', 'url'],
    ['guides.test/a.xml', 'listed'],
    [' HTTP://Guides.Test/a.xml ', 'listed'],
  ])('refuses %j: %s', (text, problem) => {
    expect(checkLink(text, listed)).toEqual({ link: null, problem });
  });

  it('gives the link as onboarding does: trimmed, http:// added, the host in lower case', () => {
    expect(checkLink(' Guides.Test/B.xml ', listed)).toEqual({ link: 'http://guides.test/B.xml', problem: null });
    expect(checkLink('https://guides.test/a.xml', listed)).toEqual({ link: 'https://guides.test/a.xml', problem: null });
  });
});

describe('guideState', () => {
  const row = (m: EpgMeta | null): GuideRow => ({ kind: 'mine', epgSrc: 'u~g1', id: 'g1', link: '', source: '', meta: m, offset: 0 });
  it('is read once programmes are stored, failed or not', () => {
    expect(guideState(row(meta('u~g1')), 0)).toBe('read');
    expect(guideState(row(meta('u~g1', { failure: { code: 'network', status: null } })), 1)).toBe('read');
  });
  it('is failed when nothing is stored and the last try failed, reading or not', () => {
    expect(guideState(row(meta('u~g1', { gen: 0, failure: { code: 'format', status: null } })), 0)).toBe('failed');
    expect(guideState(row(meta('u~g1', { gen: 0, failure: { code: 'format', status: null } })), 2)).toBe('failed');
  });
  it('is reading while a change’s refresh runs, else not read yet', () => {
    for (const m of [null, meta('u~g1', { gen: 0 }), meta('u~g1', { gen: 0, failure: null })]) {
      expect(guideState(row(m), 1)).toBe('reading');
      expect(guideState(row(m), 0)).toBe('unread');
    }
  });
});

describe('guideList', () => {
  it('lists the user’s guides in their order, then each source’s own, with what is stored of each', () => {
    const engine = new FakeEngine();
    const { rows, urls } = guideList({ doc: engine.doc, newer: false, migratedFrom: null }, engine.status);
    expect(rows.map((r) => [r.kind, r.epgSrc, r.id, r.link, r.source])).toEqual([
      ['mine', 'u~s1', 's1', 'guides.test/a.xml', ''],
      ['mine', 'u~g2', 'g2', 'guides.test/b.xml', ''],
      ['source', 's1:xmltv', '', 'panel.test:8080/xmltv.php', 'My panel'],
      ['source', 's2:tvg0', '', 'lists.test/guide.xml', 'Home list'],
    ]);
    expect(rows.map((r) => r.meta)).toEqual(engine.status.guides);
    expect(urls).toEqual(['http://guides.test/a.xml', 'http://guides.test/b.xml?key=k', PANEL_GUIDE, 'http://lists.test/guide.xml']);
  });

  it('lists a source’s guide that has the user’s link once, as the user’s, and a guide never stored with nothing', () => {
    const status: EpgStatus = { guides: [], matched: 0, sources: [sourceMeta('s1'), sourceMeta('s2', ['http://lists.test/guide.xml', 'http://guides.test/a.xml'])] };
    const { rows } = guideList({ doc: doc([{ id: 'g1', url: PANEL_GUIDE }, { id: 'g2', url: 'http://guides.test/a.xml' }]), newer: false, migratedFrom: null }, status);
    expect(rows.map((r) => r.epgSrc)).toEqual(['u~g1', 'u~g2', 's2:tvg0']);
    expect(rows.every((r) => r.meta === null)).toBe(true);
  });

  it('is empty with no profile, and names nothing for a guide whose source is gone', () => {
    const status: EpgStatus = { guides: [], matched: 0, sources: [] };
    expect(guideList(null, status)).toEqual({ rows: [], urls: [] });
    const gone = guideList({ doc: doc([], [PANEL]), newer: false, migratedFrom: null }, { ...status, sources: [sourceMeta('s9', ['http://x.test/g.xml'])] });
    expect(gone.rows.map((r) => r.epgSrc)).toEqual(['s1:xmltv']);
  });
});

describe('the guides screen', () => {
  it('opens on the first guide once read, with nothing focused while it loads', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['read']);
    const t = setup(engine);
    t.guides.open();
    await flush();
    expect(t.guides.status.value).toBe('loading');
    expect(t.at()).toBe('guides · guides -1');
    expect(t.guides.pending.value).toBe(1);
    for (const held of engine.held.read.splice(0)) held.resolve();
    await flush();
    expect(t.guides.status.value).toBe('ready');
    expect(t.sources()).toEqual(['u~s1', 'u~g2', 's1:xmltv', 's2:tvg0']);
    expect(t.at()).toBe('guides · guides 0');
    expect(t.guides.pending.value).toBe(0);
    expect(t.guides.screen.value).toBe(t.nav.top);
    // UP: "Add a guide" (the header's first); DOWN: back to the list.
    await t.press('UP');
    expect(t.at()).toBe('guides · header 0');
    await t.press('DOWN');
    expect(t.at()).toBe('guides · guides 0');
  });

  it('puts the focus on "Add a guide" when there is none, and when they could not be read', async () => {
    const engine = new FakeEngine();
    engine.doc = doc([], []);
    engine.status = { guides: [], matched: 0, sources: [] };
    const t = await opened(engine);
    expect(t.guides.status.value).toBe('ready');
    expect(t.at()).toBe('guides · header 0');

    const failing = new FakeEngine();
    failing.failRead = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = await opened(failing);
    expect(f.guides.status.value).toBe('failed');
    expect(f.at()).toBe('guides · header 0');
    expect(warn).toHaveBeenCalledWith('The guides could not be read', expect.any(Error));
  });

  it('keeps the rows it has when a later read fails', async () => {
    const t = await opened();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.engine.failRead = true;
    await t.press('BACK');
    t.guides.open();
    await flush();
    expect(t.guides.status.value).toBe('ready');
    expect(t.sources()).toHaveLength(4);
    expect(t.at()).toBe('guides · guides 0');
  });

  it('drops a read that a newer one replaced', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['read']);
    const t = setup(engine);
    t.guides.open();
    await flush();
    const first = engine.held.read.splice(0);
    // Back, and open again: a second read.
    await t.press('BACK');
    t.guides.open();
    await flush();
    const second = engine.held.read.splice(0);
    engine.doc = doc([{ id: 'g7', url: 'http://guides.test/new.xml' }]);
    for (const held of second) held.resolve();
    await flush();
    expect(t.sources()[0]).toBe('u~g7');
    // The first answers now, with the newer list: dropped all the same.
    engine.doc = doc([]);
    for (const held of first) held.resolve();
    await flush();
    expect(t.sources()[0]).toBe('u~g7');
    expect(t.guides.pending.value).toBe(0);
  });

  it('drops a failure that a newer read replaced', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['read']);
    const t = setup(engine);
    t.guides.open();
    await flush();
    const first = engine.held.read.splice(0);
    await t.press('BACK');
    t.guides.open();
    await flush();
    for (const held of engine.held.read.splice(0)) held.resolve();
    await flush();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const held of first) held.reject(new Error('late'));
    await flush();
    expect(warn).not.toHaveBeenCalled();
    expect(t.guides.status.value).toBe('ready');
  });

  it('opens a menu with the time offset alone for a source’s guide', async () => {
    const t = await opened();
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe('guide-menu · actions 0');
    expect(t.guides.menu.value).toEqual({ row: t.guides.rows.value[2], actions: ['offset', 'cancel'] });
    await t.press('DOWN', 'OK');
    expect(t.at()).toBe('guides · guides 2');
    expect(t.guides.menu.value).toBeNull();
    expect(t.engine.edits).toEqual([]);
  });

  it('opens the menu of the user’s guide on OK, and closes it with Back or Cancel without a change', async () => {
    const t = await opened();
    await t.press('OK');
    expect(t.at()).toBe('guide-menu · actions 0');
    expect(t.guides.menu.value).toEqual({ row: t.guides.rows.value[0], actions: ['down', 'offset', 'remove', 'cancel'] });
    await t.press('BACK');
    expect(t.at()).toBe('guides · guides 0');
    expect(t.guides.menu.value).toBeNull();
    await t.press('DOWN', 'OK');
    expect(t.guides.menu.value?.actions).toEqual(['up', 'offset', 'remove', 'cancel']);
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe('guides · guides 1');
    expect(t.guides.menu.value).toBeNull();
    expect(t.engine.edits).toEqual([]);
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
  });

  it('moves a guide down: the edit, the list read again with the focus on it, then the refresh and a read once it settles', async () => {
    const t = await opened();
    await t.press('OK', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'guide', change: { op: 'move', id: 's1', to: 1 } }]);
    expect(t.sources().slice(0, 2)).toEqual(['u~g2', 'u~s1']);
    expect(t.at()).toBe('guides · guides 1');
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(1);
    expect(t.guides.reading.value).toBe(1);
    // "Reading…" for a guide with nothing stored while it runs.
    expect(guideState(t.guides.rows.value[3]!, t.guides.reading.value)).toBe('reading');
    const reads = t.engine.statusCalls;
    t.engine.status = { ...t.engine.status, guides: t.engine.status.guides.map((g) => (g.epgSrc === 's2:tvg0' ? { ...g, gen: 3 } : g)) };
    t.refresh.calls[0]!.resolve();
    await flush();
    expect(t.guides.reading.value).toBe(0);
    expect(t.engine.statusCalls).toBe(reads + 1);
    expect(t.guides.rows.value[3]!.meta?.gen).toBe(3);
    expect(t.guides.pending.value).toBe(0);
  });

  it('leaves the focus where the user put it once the moved guide was followed', async () => {
    const t = await opened();
    await t.press('OK', 'OK');
    expect(t.at()).toBe('guides · guides 1');
    await t.press('DOWN', 'DOWN');
    t.refresh.calls[0]!.resolve();
    await flush();
    expect(t.at()).toBe('guides · guides 3');
  });

  it('moves a guide up, the focus following it', async () => {
    const t = await opened();
    await t.press('DOWN', 'OK', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'guide', change: { op: 'move', id: 'g2', to: 0 } }]);
    expect(t.sources().slice(0, 2)).toEqual(['u~g2', 'u~s1']);
    expect(t.at()).toBe('guides · guides 0');
  });

  it('follows a moved guide even when the focus moved meanwhile', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    await t.press('OK', 'OK');
    await t.press('DOWN', 'DOWN', 'DOWN');
    expect(t.at()).toBe('guides · guides 3');
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(t.at()).toBe('guides · guides 1');
  });

  it('removes a guide: the focus stays on its place, and goes to "Add a guide" with the last one gone', async () => {
    const engine = new FakeEngine();
    engine.doc = doc([{ id: 's1', url: 'http://guides.test/a.xml' }, { id: 'g2', url: 'http://guides.test/b.xml' }], []);
    engine.status = { guides: [], matched: 0, sources: [] };
    const t = await opened(engine);
    await t.press('DOWN', 'OK', 'DOWN', 'DOWN', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'guide', change: { op: 'remove', id: 'g2' } }]);
    expect(t.sources()).toEqual(['u~s1']);
    expect(t.at()).toBe('guides · guides 0');
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(1);
    await t.press('OK', 'DOWN', 'OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'guide', change: { op: 'remove', id: 's1' } });
    expect(t.sources()).toEqual([]);
    expect(t.at()).toBe('guides · header 0');
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(2);
  });

  it('runs the changes one after another', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    // Move s1 down, then remove it before the move is saved.
    await t.press('OK', 'OK');
    await t.press('OK', 'DOWN', 'DOWN', 'OK');
    expect(engine.edits).toHaveLength(1);
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(engine.edits).toHaveLength(2);
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(engine.edits.map((e) => (e.kind === 'guide' ? e.change.op : ''))).toEqual(['move', 'remove']);
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(2);
  });

  it('reads and refreshes after an edit that failed, and after a refresh that failed', async () => {
    const t = await opened();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.engine.failEdit = true;
    const reads = t.engine.profileCalls;
    await t.press('OK', 'OK');
    expect(warn).toHaveBeenCalledWith('The guide change was not saved', expect.any(Error));
    expect(t.engine.profileCalls).toBe(reads + 1);
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(1);
    t.refresh.calls[0]!.reject(new Error('slot'));
    await flush();
    expect(warn).toHaveBeenCalledWith('The guides were not refreshed', expect.any(Error));
    expect(t.guides.reading.value).toBe(0);
    expect(t.engine.profileCalls).toBe(reads + 2);
    expect(t.guides.pending.value).toBe(0);
  });

  it('counts each change’s refresh until it settles', async () => {
    const t = await opened();
    await t.press('OK', 'OK');
    await t.press('OK', 'OK');
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(2);
    expect(t.guides.reading.value).toBe(2);
    expect(t.guides.pending.value).toBe(2);
    t.refresh.calls[1]!.resolve();
    await flush();
    expect(t.guides.reading.value).toBe(1);
    t.refresh.calls[0]!.resolve();
    await flush();
    expect(t.guides.reading.value).toBe(0);
    expect(t.guides.pending.value).toBe(0);
  });
});

describe('the add form', () => {
  it('opens from "Add a guide" with an empty link, edits it on OK, and Done moves to "Add"', async () => {
    const t = await opened();
    await t.press('UP', 'OK');
    expect(t.at()).toBe('guide-add · field 0');
    expect(t.guides.text.value).toBe('');
    await t.press('OK');
    expect(t.find).toHaveBeenCalledWith(LINK_FIELD_ID);
    expect(t.input.focused).toBe(1);
    expect(t.guides.editor.editing.value).toBe(LINK_FIELD_ID);
    t.guides.setText('guides.test/c.xml');
    const key = { key: 'Enter', keyCode: 13, preventDefault: () => undefined, stopPropagation: () => undefined };
    t.guides.editor.field(LINK_FIELD_ID).onEditInput();
    t.guides.editor.field(LINK_FIELD_ID).onEditKey(key);
    await flush();
    expect(t.guides.editor.editing.value).toBeNull();
    expect(t.at()).toBe('guide-add · actions 0');
    await t.press('RIGHT', 'UP');
    expect(t.at()).toBe('guide-add · field 0');
  });

  it('refuses an empty link, one with spaces, one that is no http(s) link, and one already listed, on the field', async () => {
    const t = await opened();
    await t.press('UP', 'OK', 'DOWN', 'OK');
    expect(t.guides.problem.value).toBe('required');
    expect(t.at()).toBe('guide-add · field 0');
    for (const [typed, problem] of [
      ['guides.test/a b.xml', 'spaces'],
      ['ftp://guides.test/c.xml', 'url'],
      ['guides.test/a.xml', 'listed'],
      // A source's own guide (the panel's, with its login): on the screen already.
      [PANEL_GUIDE, 'listed'],
    ]) {
      t.guides.setText(typed!);
      expect(t.guides.problem.value).toBeNull();
      await t.press('DOWN', 'OK');
      expect(t.guides.problem.value).toBe(problem);
      expect(t.at()).toBe('guide-add · field 0');
    }
    expect(t.engine.edits).toEqual([]);
  });

  it('adds a guide at the end of the user’s, one past the highest g id stored or listed, the focus on it', async () => {
    const engine = new FakeEngine();
    // A removed guide whose records weren't deleted yet still holds its id.
    engine.status = { ...engine.status, guides: engine.status.guides.concat([meta('u~g4', { gen: 0 })]) };
    const t = await opened(engine);
    await t.press('UP', 'OK');
    t.guides.setText('Guides.test/C.xml');
    await t.press('DOWN', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'guide', change: { op: 'add', guide: { id: 'g5', url: 'http://guides.test/C.xml' } } }]);
    expect(t.sources().slice(0, 3)).toEqual(['u~s1', 'u~g2', 'u~g5']);
    expect(t.at()).toBe('guides · guides 2');
    expect(t.guides.rows.value[2]!.link).toBe('guides.test/C.xml');
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(1);
    expect(guideState(t.guides.rows.value[2]!, t.guides.reading.value)).toBe('reading');
  });

  it('never gives the id of a guide in the list whose records are not stored yet', async () => {
    const engine = new FakeEngine();
    engine.doc = doc([{ id: 'g6', url: 'http://guides.test/new.xml' }]);
    const t = await opened(engine);
    await t.press('UP', 'OK');
    t.guides.setText('guides.test/c.xml');
    await t.press('DOWN', 'OK');
    expect(engine.edits).toEqual([{ kind: 'guide', change: { op: 'add', guide: { id: 'g7', url: 'http://guides.test/c.xml' } } }]);
  });

  it('never gives an id twice, nor a link, though the list was not read again in between', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    await t.press('UP', 'OK');
    t.guides.setText('guides.test/c.xml');
    await t.press('DOWN', 'OK');
    await t.press('UP', 'OK');
    t.guides.setText('guides.test/c.xml');
    await t.press('DOWN', 'OK');
    expect(t.guides.problem.value).toBe('listed');
    t.guides.setText('guides.test/d.xml');
    await t.press('DOWN', 'OK');
    for (let i = 0; i < 4 && engine.held.edit.length > 0; i += 1) {
      engine.held.edit.splice(0)[0]!.resolve();
      await flush();
    }
    expect(engine.edits.map((e) => (e.kind === 'guide' && e.change.op === 'add' ? e.change.guide.id : ''))).toEqual(['g3', 'g4']);
  });

  it('closes with Cancel or Back without a change, ending the edit first, and opens empty again', async () => {
    const t = await opened();
    await t.press('UP', 'OK');
    t.guides.setText('guides.test/a.xml');
    await t.press('DOWN', 'OK');
    expect(t.guides.problem.value).toBe('listed');
    await t.press('DOWN', 'RIGHT', 'OK');
    expect(t.at()).toBe('guides · header 0');
    await t.press('OK');
    expect(t.guides.text.value).toBe('');
    expect(t.guides.problem.value).toBeNull();
    await t.press('OK');
    expect(t.guides.editor.editing.value).toBe(LINK_FIELD_ID);
    await t.press('BACK');
    expect(t.guides.editor.editing.value).toBeNull();
    expect(t.at()).toBe('guides · header 0');
    expect(t.engine.edits).toEqual([]);
  });

  it('drops what lands after dispose, and stops listening to the keyboard', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['read', 'edit']);
    await t.press('OK', 'OK');
    t.guides.dispose();
    t.guides.dispose();
    expect(t.stopKeyboard).toHaveBeenCalledTimes(1);
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(engine.profileCalls).toBe(1);
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
    const depth = t.nav.snapshot().depth;
    t.guides.open();
    expect(t.nav.snapshot().depth).toBe(depth);
    // The editing signal no longer follows the editor.
    t.guides.editor.editor.open(LINK_FIELD_ID);
    expect(t.guides.editor.editing.value).toBeNull();
  });

  it('drops a read that lands after dispose, and asks no refresh or read after one', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['read']);
    const t = setup(engine);
    t.guides.open();
    await flush();
    t.guides.dispose();
    for (const held of engine.held.read.splice(0)) held.resolve();
    await flush();
    expect(t.guides.status.value).toBe('loading');
    expect(t.guides.rows.value).toEqual([]);
    const failing = setup(new FakeEngine());
    failing.engine.hold = new Set(['read']);
    failing.engine.failRead = true;
    failing.guides.open();
    await flush();
    failing.guides.dispose();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const held of failing.engine.held.read.splice(0)) held.resolve();
    await flush();
    expect(warn).not.toHaveBeenCalled();
    expect(failing.guides.status.value).toBe('loading');

    // A change whose read lands after dispose: saved, with no refresh.
    const late = await opened();
    late.engine.hold = new Set(['read']);
    await late.press('OK', 'OK');
    expect(late.engine.edits).toHaveLength(1);
    late.guides.dispose();
    for (const held of late.engine.held.read.splice(0)) held.resolve();
    await flush();
    expect(late.refresh.refreshNow).not.toHaveBeenCalled();

    // A refresh that settles after dispose: no read.
    const settling = await opened();
    await settling.press('OK', 'OK');
    const reads = settling.engine.profileCalls;
    settling.guides.dispose();
    settling.refresh.calls[0]!.resolve();
    await flush();
    expect(settling.engine.profileCalls).toBe(reads);
    expect(settling.guides.reading.value).toBe(0);
  });

  it('saves a change made while the screen goes', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    await t.press('OK', 'OK');
    await t.press('OK', 'UP', 'OK');
    t.guides.dispose();
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(engine.edits).toHaveLength(2);
  });
});

describe('the settings screen', () => {
  it('lists "TV guides", which opens the guides screen; Back goes back one screen at a time', async () => {
    const t = setup();
    const settings = createSettings({
      nav: t.nav,
      engine: t.engine,
      refreshNow: t.refresh.refreshNow,
      offsetChanged: t.offsetChanged,
      platform: { textKey: () => null, onSoftKeyboard: () => () => undefined },
    });
    expect(SETTINGS_ITEMS).toEqual(['guides']);
    expect(SETTINGS_SCREENS).toEqual(['settings', 'guides', 'guide-menu', 'guide-offset', 'guide-matches', 'guide-add', 'unmatched']);
    settings.open();
    expect(t.at()).toBe('settings · items 0');
    expect((t.nav.top.zone('items') as { count: number }).count).toBe(1);
    await t.press('OK');
    expect(t.at()).toBe('guides · guides 0');
    expect(settings.guides.rows.value).toHaveLength(4);
    // The header's second button opens "Channels without a guide" (step 24c); Back comes back to it.
    await t.press('UP', 'RIGHT', 'OK');
    expect(t.at()).toBe('unmatched · channels 0');
    expect(settings.unmatched.screen.value).toBe(t.nav.top);
    await t.press('BACK');
    expect(t.at()).toBe('guides · header 1');
    expect(settings.unmatched.screen.value).toBeNull();
    await t.press('BACK');
    expect(t.at()).toBe('settings · items 0');
    await t.press('BACK');
    expect(t.at()).toBe('live · channels 0');
    settings.dispose();
  });
});

/** A read guide's summary: 11 of 12, mostly by id. */
const SUMMARY: EpgSummary = {
  wanted: 12,
  matched: 11,
  byMethod: { override: 0, id: 10, 'xtream-id': 0, name: 0, 'match-name': 1 },
  ambiguous: 0,
  declared: 9,
  used: 9,
  programmes: 900,
  kept: 800,
  buckets: 40,
  pastDays: 1,
  futureDays: 7,
};

describe("a guide's matches (step 24c)", () => {
  /** The fake's guides with summaries on the user's first and on the panel's. */
  function summarized(): FakeEngine {
    const engine = new FakeEngine();
    engine.status = { ...engine.status, guides: engine.status.guides.map((m) => (m.epgSrc === 'u~s1' || m.epgSrc === 's1:xmltv' ? { ...m, summary: SUMMARY } : m)) };
    return engine;
  }

  it('is in the menu of a guide that was read, and nowhere else', async () => {
    const t = await opened(summarized());
    expect(t.guides.rows.value.map((r) => summaryOf(r) !== null)).toEqual([true, false, true, false]);
    await t.press('OK');
    expect(t.guides.menu.value?.actions).toEqual(['down', 'offset', 'matches', 'remove', 'cancel']);
    await t.press('BACK', 'DOWN', 'OK');
    expect(t.guides.menu.value?.actions).toEqual(['up', 'offset', 'remove', 'cancel']);
    await t.press('BACK', 'DOWN', 'OK');
    expect(t.guides.menu.value?.actions).toEqual(['offset', 'matches', 'cancel']);
    await t.press('BACK', 'DOWN', 'OK');
    expect(t.guides.menu.value?.actions).toEqual(['offset', 'cancel']);
  });

  it('shows the guide of the row it opened from; OK on Close or Back closes it on that row, with no read', async () => {
    const t = await opened(summarized());
    const reads = t.engine.statusCalls;
    // The panel's guide: Time offset, Matches, Cancel.
    await t.press('DOWN', 'DOWN', 'OK', 'DOWN', 'OK');
    expect(t.at()).toBe('guide-matches · actions 0');
    expect(t.guides.matches.value).toBe(t.guides.rows.value[2]);
    expect(t.guides.menu.value).toBeNull();
    await t.press('OK');
    expect(t.at()).toBe('guides · guides 2');
    expect(t.guides.matches.value).toBeNull();
    // The user's first: Move down, Time offset, Matches…
    await t.press('UP', 'UP', 'OK', 'DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe('guide-matches · actions 0');
    expect(t.guides.matches.value?.epgSrc).toBe('u~s1');
    // Other keys do nothing; Back closes.
    await t.press('LEFT', 'DOWN');
    expect(t.at()).toBe('guide-matches · actions 0');
    await t.press('BACK');
    expect(t.at()).toBe('guides · guides 0');
    expect(t.guides.matches.value).toBeNull();
    expect(t.engine.statusCalls).toBe(reads);
    expect(t.engine.edits).toEqual([]);
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
  });
});

describe('the header’s "Channels without a guide" (step 24c)', () => {
  it('is the header’s second button: counted over the profile’s sources at each read, OK opens the list', async () => {
    expect([HEADER_ADD, HEADER_UNMATCHED]).toEqual([0, 1]);
    const t = await opened();
    expect(t.guides.unmatched.value).toBe(4);
    expect(t.engine.counts).toEqual([{ sources: ['s1', 's2'], offset: 0, limit: 0 }]);
    expect(t.guides.pending.value).toBe(0);
    await t.press('UP', 'RIGHT');
    expect(t.at()).toBe('guides · header 1');
    await t.press('OK');
    expect(t.openUnmatched).toHaveBeenCalledTimes(1);
    expect(t.at()).toBe('guides · header 1');
    // A change's refresh settles: the list is read again, and counted again.
    t.engine.unmatchedCount = 2;
    // (Move down: the first action of the first guide's menu.)
    await t.press('DOWN', 'OK', 'OK');
    t.refresh.calls[0]!.resolve();
    await flush();
    expect(t.guides.unmatched.value).toBe(2);
    expect(t.engine.counts.length).toBeGreaterThanOrEqual(2);
  });

  it('is not counted until a read lands, and keeps the newest read’s count', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['count']);
    const t = await opened(engine);
    expect(t.guides.status.value).toBe('ready');
    expect(t.guides.unmatched.value).toBeNull();
    expect(t.guides.pending.value).toBe(1);
    // A move: the list is read again before the first count answers.
    await t.press('OK', 'OK');
    expect(engine.held.count).toHaveLength(2);
    engine.unmatchedCount = 7;
    engine.held.count[1]!.resolve();
    await flush();
    expect(t.guides.unmatched.value).toBe(7);
    engine.unmatchedCount = 4;
    engine.held.count[0]!.resolve();
    await flush();
    expect(t.guides.unmatched.value).toBe(7);
  });

  it('says why a count failed and keeps the last one; after the screen goes, nothing', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    expect(t.guides.unmatched.value).toBe(4);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.failCount = true;
    await t.press('OK', 'OK');
    expect(warn).toHaveBeenCalledWith('The channels without a guide could not be counted', expect.any(Error));
    expect(t.guides.unmatched.value).toBe(4);
    expect(t.guides.pending.value).toBe(1);

    warn.mockClear();
    engine.failCount = false;
    engine.hold = new Set(['count']);
    t.refresh.calls[0]!.resolve();
    await flush();
    engine.held.count[0]!.reject(new Error('late'));
    engine.unmatchedCount = 9;
    t.guides.dispose();
    await flush();
    expect(warn).not.toHaveBeenCalled();
    expect(t.guides.unmatched.value).toBe(4);
  });

  it('drops a count that lands after the screen went', async () => {
    const engine = new FakeEngine();
    engine.hold = new Set(['count']);
    const t = await opened(engine);
    t.guides.dispose();
    engine.held.count[0]!.resolve();
    await flush();
    expect(t.guides.unmatched.value).toBeNull();
  });
});

describe("a guide's time offset (step 24b)", () => {
  /** The chooser's focused step and the first step in view. */
  const chooserAt = (t: ReturnType<typeof setup>): [number, number] => {
    const p = t.nav.top.position('steps');
    return [p.index, p.top];
  };

  it('lists the steps from -12 h to +12 h in half hours, seven in view', () => {
    expect(OFFSET_STEPS).toHaveLength(49);
    expect(OFFSET_STEPS.every((minutes, i) => minutes === -720 + 30 * i)).toBe(true);
    expect(OFFSET_STEPS[24]).toBe(0);
    expect(OFFSETS.visible).toBe(7);
  });

  it('gives each row its offset from the profile, 0 for none', () => {
    const engine = new FakeEngine();
    engine.doc = { ...engine.doc, epgOffsets: { 'u~g2': -90, 's1:xmltv': 60, 'u~gone': 30 } };
    const { rows } = guideList({ doc: engine.doc, newer: false, migratedFrom: null }, engine.status);
    expect(rows.map((r) => [r.epgSrc, r.offset])).toEqual([
      ['u~s1', 0],
      ['u~g2', -90],
      ['s1:xmltv', 60],
      ['s2:tvg0', 0],
    ]);
    // A stored entry that is no offset reads as none.
    const odd = guideList({ doc: { ...engine.doc, epgOffsets: { 'u~s1': 45 } }, newer: false, migratedFrom: null }, engine.status);
    expect(odd.rows[0]!.offset).toBe(0);
  });

  it("opens from the menu on the guide's own step, in the middle of the seven in view where it can", async () => {
    const engine = new FakeEngine();
    engine.doc = { ...engine.doc, epgOffsets: { 'u~g2': 720, 's1:xmltv': -720 } };
    const t = await opened(engine);
    // s1's menu: Move down, Time offset, Remove, Cancel.
    await t.press('OK', 'DOWN', 'OK');
    expect(t.at()).toBe('guide-offset · steps 24');
    expect(chooserAt(t)).toEqual([24, 21]);
    expect(t.guides.chooser.value).toEqual({ row: t.guides.rows.value[0], steps: OFFSET_STEPS });
    expect(t.guides.menu.value).toBeNull();
    await t.press('BACK');
    expect(t.at()).toBe('guides · guides 0');
    expect(t.guides.chooser.value).toBeNull();
    // g2 at +12 h: the last step, the list at its end.
    await t.press('DOWN', 'OK', 'DOWN', 'OK');
    expect(t.at()).toBe('guide-offset · steps 48');
    expect(chooserAt(t)).toEqual([48, 42]);
    await t.press('BACK');
    // The panel's own guide at -12 h: its menu has the offset first.
    await t.press('DOWN', 'OK', 'OK');
    expect(t.at()).toBe('guide-offset · steps 0');
    expect(chooserAt(t)).toEqual([0, 0]);
    await t.press('BACK');
    expect(t.at()).toBe('guides · guides 2');
    expect(engine.edits).toEqual([]);
  });

  it('saves another step: the edit, the screens told, the list read again, and nothing refreshed', async () => {
    const t = await opened();
    // The panel's own guide.
    await t.press('DOWN', 'DOWN', 'OK', 'OK');
    expect(t.at()).toBe('guide-offset · steps 24');
    const reads = t.engine.profileCalls;
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'epgOffset', epgSrc: 's1:xmltv', minutes: 60 }]);
    expect(t.offsetChanged).toHaveBeenCalledTimes(1);
    expect(t.engine.profileCalls).toBe(reads + 1);
    expect(t.guides.rows.value[2]!.offset).toBe(60);
    expect(t.at()).toBe('guides · guides 2');
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
    expect(t.guides.reading.value).toBe(0);
    expect(t.guides.pending.value).toBe(0);
    // Opened again on +1:00, and back to none.
    await t.press('OK', 'OK');
    expect(t.at()).toBe('guide-offset · steps 26');
    await t.press('UP', 'UP', 'OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'epgOffset', epgSrc: 's1:xmltv', minutes: 0 });
    expect(t.guides.rows.value[2]!.offset).toBe(0);
    expect(t.offsetChanged).toHaveBeenCalledTimes(2);
    expect(t.refresh.refreshNow).not.toHaveBeenCalled();
  });

  it("changes nothing on the guide's own step, or with Back", async () => {
    const t = await opened();
    await t.press('OK', 'DOWN', 'OK', 'OK');
    expect(t.at()).toBe('guides · guides 0');
    expect(t.guides.chooser.value).toBeNull();
    await t.press('OK', 'DOWN', 'OK', 'DOWN', 'BACK');
    expect(t.at()).toBe('guides · guides 0');
    expect(t.guides.chooser.value).toBeNull();
    await flush();
    expect(t.engine.edits).toEqual([]);
    expect(t.offsetChanged).not.toHaveBeenCalled();
  });

  it("follows the guide's row once the list is read again, though the focus moved meanwhile", async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    // g2's menu: Move up, Time offset…; one step up: -0:30.
    await t.press('DOWN', 'OK', 'DOWN', 'OK', 'UP', 'OK');
    await t.press('DOWN', 'DOWN');
    expect(t.at()).toBe('guides · guides 3');
    expect(t.offsetChanged).not.toHaveBeenCalled();
    // The edit counts as a request in flight until it settles.
    expect(t.guides.pending.value).toBe(1);
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(engine.edits).toEqual([{ kind: 'epgOffset', epgSrc: 'u~g2', minutes: -30 }]);
    expect(t.offsetChanged).toHaveBeenCalledTimes(1);
    expect(t.at()).toBe('guides · guides 1');
    expect(t.guides.pending.value).toBe(0);
    // A source's own guide (its row has no id of the user's) is followed too.
    await t.press('DOWN', 'OK', 'OK', 'DOWN', 'OK');
    await t.press('UP', 'UP');
    expect(t.at()).toBe('guides · guides 0');
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(engine.edits[1]).toEqual({ kind: 'epgOffset', epgSrc: 's1:xmltv', minutes: 30 });
    expect(t.at()).toBe('guides · guides 2');
  });

  it('tells no screen when the edit failed or saved nothing, and still reads the list', async () => {
    const t = await opened();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.engine.failEdit = true;
    const reads = t.engine.profileCalls;
    await t.press('OK', 'DOWN', 'OK', 'DOWN', 'OK');
    expect(warn).toHaveBeenCalledWith('The time offset was not saved', expect.any(Error));
    expect(t.offsetChanged).not.toHaveBeenCalled();
    expect(t.engine.profileCalls).toBe(reads + 1);
    expect(t.guides.pending.value).toBe(0);
    // Saved nothing: the profile had that offset already (set meanwhile, the row not read since).
    t.engine.failEdit = false;
    t.engine.doc = { ...t.engine.doc, epgOffsets: { 'u~s1': 30 } };
    await t.press('OK', 'DOWN', 'OK', 'DOWN', 'OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'epgOffset', epgSrc: 'u~s1', minutes: 30 });
    expect(t.offsetChanged).not.toHaveBeenCalled();
    expect(t.guides.rows.value[0]!.offset).toBe(30);
  });

  it('tells the screens of an offset saved after the screen went, and reads nothing then', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    await t.press('OK', 'DOWN', 'OK', 'DOWN', 'OK');
    t.guides.dispose();
    const reads = engine.profileCalls;
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(engine.edits).toEqual([{ kind: 'epgOffset', epgSrc: 'u~s1', minutes: 30 }]);
    expect(t.offsetChanged).toHaveBeenCalledTimes(1);
    expect(engine.profileCalls).toBe(reads);
  });

  it('is saved after the changes before it', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    // Move s1 down (held), then its offset (the row is still first: the list wasn't read again).
    await t.press('OK', 'OK');
    await t.press('OK', 'DOWN', 'OK', 'DOWN', 'OK');
    expect(engine.edits).toHaveLength(1);
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(engine.edits).toHaveLength(2);
    expect(engine.edits[1]).toEqual({ kind: 'epgOffset', epgSrc: 'u~s1', minutes: 30 });
    expect(t.offsetChanged).not.toHaveBeenCalled();
    engine.held.edit.splice(0)[0]!.resolve();
    await flush();
    expect(t.offsetChanged).toHaveBeenCalledTimes(1);
    expect(t.at()).toBe('guides · guides 1');
  });
});
