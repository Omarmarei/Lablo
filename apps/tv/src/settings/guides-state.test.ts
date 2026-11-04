import type { EpgMeta, EpgStatus, LoadedProfile, ProfileDoc, ProfileEdit, SourceMeta, SourceRecord, UserGuide } from '@zoma/data';
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
  checkLink,
  createGuides,
  guideList,
  guideState,
  menuActions,
  nextGuideId,
  shownLink,
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
  hold = new Set<'read' | 'edit'>();
  readonly held: Record<'read' | 'edit', Held[]> = { read: [], edit: [] };

  private answer<T>(kind: 'read' | 'edit', value: () => T): Promise<T> {
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
  const guides = createGuides({ nav, engine, refreshNow: refresh.refreshNow, platform, find, now: () => 10_000 });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const sources = (): string[] => guides.rows.value.map((r) => r.epgSrc);
  return { nav, engine, refresh, guides, input, find, stopKeyboard, at, press, sources };
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
  it('offers a move only where the guide can go', () => {
    expect(menuActions(0, 1)).toEqual(['remove', 'cancel']);
    expect(menuActions(0, 3)).toEqual(['down', 'remove', 'cancel']);
    expect(menuActions(1, 3)).toEqual(['up', 'down', 'remove', 'cancel']);
    expect(menuActions(2, 3)).toEqual(['up', 'remove', 'cancel']);
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
  const row = (m: EpgMeta | null): GuideRow => ({ kind: 'mine', epgSrc: 'u~g1', id: 'g1', link: '', source: '', meta: m });
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
    // UP: "Add a guide"; DOWN: back to the list.
    await t.press('UP');
    expect(t.at()).toBe('guides · add 0');
    await t.press('DOWN');
    expect(t.at()).toBe('guides · guides 0');
  });

  it('puts the focus on "Add a guide" when there is none, and when they could not be read', async () => {
    const engine = new FakeEngine();
    engine.doc = doc([], []);
    engine.status = { guides: [], matched: 0, sources: [] };
    const t = await opened(engine);
    expect(t.guides.status.value).toBe('ready');
    expect(t.at()).toBe('guides · add 0');

    const failing = new FakeEngine();
    failing.failRead = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = await opened(failing);
    expect(f.guides.status.value).toBe('failed');
    expect(f.at()).toBe('guides · add 0');
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

  it('opens no menu for a source’s guide', async () => {
    const t = await opened();
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.at()).toBe('guides · guides 2');
    expect(t.guides.menu.value).toBeNull();
  });

  it('opens the menu of the user’s guide on OK, and closes it with Back or Cancel without a change', async () => {
    const t = await opened();
    await t.press('OK');
    expect(t.at()).toBe('guide-menu · actions 0');
    expect(t.guides.menu.value).toEqual({ row: t.guides.rows.value[0], actions: ['down', 'remove', 'cancel'] });
    await t.press('BACK');
    expect(t.at()).toBe('guides · guides 0');
    expect(t.guides.menu.value).toBeNull();
    await t.press('DOWN', 'OK');
    expect(t.guides.menu.value?.actions).toEqual(['up', 'remove', 'cancel']);
    await t.press('DOWN', 'DOWN', 'OK');
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
    await t.press('DOWN', 'OK', 'DOWN', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'guide', change: { op: 'remove', id: 'g2' } }]);
    expect(t.sources()).toEqual(['u~s1']);
    expect(t.at()).toBe('guides · guides 0');
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(1);
    await t.press('OK', 'OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'guide', change: { op: 'remove', id: 's1' } });
    expect(t.sources()).toEqual([]);
    expect(t.at()).toBe('guides · add 0');
    expect(t.refresh.refreshNow).toHaveBeenCalledTimes(2);
  });

  it('runs the changes one after another', async () => {
    const engine = new FakeEngine();
    const t = await opened(engine);
    engine.hold = new Set(['edit']);
    // Move s1 down, then remove it before the move is saved.
    await t.press('OK', 'OK');
    await t.press('OK', 'DOWN', 'OK');
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
    expect(t.at()).toBe('guides · add 0');
    await t.press('OK');
    expect(t.guides.text.value).toBe('');
    expect(t.guides.problem.value).toBeNull();
    await t.press('OK');
    expect(t.guides.editor.editing.value).toBe(LINK_FIELD_ID);
    await t.press('BACK');
    expect(t.guides.editor.editing.value).toBeNull();
    expect(t.at()).toBe('guides · add 0');
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
    const settings = createSettings({ nav: t.nav, engine: t.engine, refreshNow: t.refresh.refreshNow, platform: { textKey: () => null, onSoftKeyboard: () => () => undefined } });
    expect(SETTINGS_ITEMS).toEqual(['guides']);
    expect(SETTINGS_SCREENS).toEqual(['settings', 'guides', 'guide-menu', 'guide-add']);
    settings.open();
    expect(t.at()).toBe('settings · items 0');
    expect((t.nav.top.zone('items') as { count: number }).count).toBe(1);
    await t.press('OK');
    expect(t.at()).toBe('guides · guides 0');
    expect(settings.guides.rows.value).toHaveLength(4);
    await t.press('BACK');
    expect(t.at()).toBe('settings · items 0');
    await t.press('BACK');
    expect(t.at()).toBe('live · channels 0');
    settings.dispose();
  });
});
