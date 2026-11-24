import type { VNode } from 'preact';
import { stripIsolates } from '@lablo/core';
import type { LoadedProfile, ProfileEdit, SourceMeta, SourceRecord, StoredSource } from '@lablo/data';
import { emptyProfile } from '@lablo/data';
import type { ItemBinding } from '@lablo/ui';
import { SCREEN, Spinner, VirtualList, bindFocus, createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appI18n } from '../i18n';
import { GUIDES } from './guides-state';
import { SourceItem, SourcesPage, sourceKindText, statusText, warns } from './SettingsScreen';
import type { SourceRow, SourcesEngine } from './sources-state';
import { SOURCES_BODY, SOURCES_SCREEN, SOURCES_VISIBLE, createSourcesList, shownHost, sourceRows } from './sources-state';

/**
 * The sources screen (RELAY step 30c3a): the list's reads and rows over a fake engine, and the
 * page and a row as drawn, called as functions (their components are not expanded). The e2e draws
 * the mock's source in English and Arabic, blocked and not.
 */

const PANEL: SourceRecord = {
  id: 's1',
  type: 'xtream',
  name: 'My panel',
  account: { base: 'http://user:pw@panel.test:8080', username: 'user', password: 'secret' },
  added: 1,
};
const LIST: SourceRecord = { id: 's2', type: 'm3u', name: 'قائمتي', url: 'https://lists.test/get.php?username=u&password=p', added: 2 };
const GONE: SourceRecord = { id: 's3', type: 'm3u', name: 'Wiped', url: 'http://wiped.test/a.m3u', added: 3 };

/** 2026-11-17 15:00 UTC. */
const T = Date.UTC(2026, 10, 17, 15);

function meta(src: string, patch: Partial<SourceMeta> = {}): SourceMeta {
  return { src, gen: 1, building: null, nextGen: 2, updatedAt: T - 60_000, counts: { live: 10 }, ...patch };
}

const profileOf = (sources: StoredSource[]): LoadedProfile => ({ doc: { ...emptyProfile(), sources } as LoadedProfile['doc'], newer: false, migratedFrom: null });

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

interface Held<T> {
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** The data engine: answers as set, each read held when asked. */
class FakeEngine implements SourcesEngine {
  sources: StoredSource[] = [PANEL, LIST, GONE];
  metas: SourceMeta[] = [meta('s1', { checkedAt: T }), meta('s2'), meta('s3', { gen: 0, updatedAt: null })];
  blockedUrls: string[] = [];
  failProfile = false;
  failBlocked = false;
  readonly blockAsks: string[][] = [];
  hold = false;
  readonly held: Held<unknown>[] = [];
  reads = 0;

  private answer<T>(value: () => T): Promise<T> {
    if (!this.hold) {
      try {
        return Promise.resolve(value());
      } catch (error) {
        return Promise.reject(error);
      }
    }
    return new Promise<T>((resolve, reject) => {
      this.held.push({ resolve: () => resolve(value()), reject } as Held<unknown>);
    });
  }

  profile(): Promise<LoadedProfile | null> {
    this.reads += 1;
    return this.answer(() => {
      if (this.failProfile) throw new Error('no IndexedDB');
      return profileOf(this.sources);
    });
  }

  sourceStatus(): Promise<SourceMeta[]> {
    return this.answer(() => this.metas);
  }

  blocked(urls: string[]): Promise<boolean[]> {
    this.blockAsks.push(urls.slice());
    return this.answer(() => {
      if (this.failBlocked) throw new Error('worker gone');
      return urls.map((url) => this.blockedUrls.indexOf(url) !== -1);
    });
  }

  /** The login form's saves (step 32d4b): each recorded, the source replaced by id as the query worker does. */
  readonly edits: ProfileEdit[] = [];
  editFails = false;

  editProfile(edit: ProfileEdit): Promise<boolean> {
    this.edits.push(edit);
    if (this.editFails) return Promise.reject(new Error('no query worker'));
    if (edit.kind === 'source') this.sources = this.sources.map((s) => (s.id === edit.source.id ? edit.source : s));
    return Promise.resolve(true);
  }

  release(): void {
    for (const held of this.held.splice(0)) held.resolve(undefined);
  }
}

function setup(engine = new FakeEngine()) {
  const nav = createNavigator({
    root: { id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 2 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const list = createSourcesList({ nav, engine });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  return { nav, engine, list, at };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the sources screen’s layout numbers', () => {
  it('fits 6 rows of a guide’s size under the header and its line', () => {
    expect(SOURCES_BODY).toBe(SCREEN.height - 2 * SCREEN.safeY - 56 - 24 - 56);
    expect(SOURCES_VISIBLE).toBe(6);
    expect(SOURCES_VISIBLE * (GUIDES.rowHeight + GUIDES.rowGap) - GUIDES.rowGap).toBeLessThanOrEqual(SOURCES_BODY);
  });
});

describe('shownHost', () => {
  it.each([
    ['http://panel.test:8080', 'panel.test:8080'],
    ['http://user:pw@panel.test:8080', 'panel.test:8080'],
    ['https://lists.test/get.php?username=u&password=p', 'lists.test'],
    ['http://lists.test/u/p/list.m3u#x', 'lists.test'],
    ['http://lists.test?u=x', 'lists.test'],
    ['http://[::1]:8080/a.m3u', '[::1]:8080'],
    ['lists.test/a.m3u', 'lists.test'],
  ])('shows %s as %s', (url, host) => {
    expect(shownHost(url)).toBe(host);
  });
});

describe('sourceRows', () => {
  it('lists the sources in the profile’s order: the host only, the last check, the blocklist’s answer', () => {
    const engine = new FakeEngine();
    const rows = sourceRows(profileOf(engine.sources), engine.metas, [false, true]);
    expect(rows).toEqual([
      { id: 's1', name: 'My panel', type: 'xtream', host: 'panel.test:8080', checkedAt: T, blocked: false, storage: false, needs: null, answer: null },
      { id: 's2', name: 'قائمتي', type: 'm3u', host: 'lists.test', checkedAt: T - 60_000, blocked: true, storage: false, needs: null, answer: null },
      { id: 's3', name: 'Wiped', type: 'm3u', host: 'wiped.test', checkedAt: null, blocked: false, storage: false, needs: null, answer: null },
    ]);
  });

  it('marks the sources whose refresh failed for space (step 39s1)', () => {
    const engine = new FakeEngine();
    const rows = sourceRows(profileOf(engine.sources), engine.metas, [], {}, (src) => src === 's2');
    expect(rows.map((r) => [r.id, r.storage])).toEqual([
      ['s1', false],
      ['s2', true],
      ['s3', false],
    ]);
  });

  it('has no check time for a source with no record, or a record with no catalog; nothing with no profile', () => {
    expect(sourceRows(profileOf([PANEL]), [], []).map((r) => r.checkedAt)).toEqual([null]);
    expect(sourceRows(profileOf([PANEL]), [meta('s1', { gen: 0, checkedAt: T })], []).map((r) => r.checkedAt)).toEqual([null]);
    expect(sourceRows(profileOf([PANEL]), [meta('s1', { checkedAt: null, updatedAt: null })], []).map((r) => r.checkedAt)).toEqual([null]);
    expect(sourceRows(profileOf([PANEL]), [meta('s9', { checkedAt: T })], []).map((r) => r.checkedAt)).toEqual([null]);
    expect(sourceRows(null, [meta('s1')], [true])).toEqual([]);
  });

  it('lists a file from the phone with no server, never blocked, whatever the blocklist answers (step 31d2b1)', () => {
    const file: SourceRecord = { id: 's4', type: 'm3u-file', name: 'Kitchen', added: 4 };
    expect(sourceRows(profileOf([PANEL, file]), [meta('s1', { checkedAt: T }), meta('s4', { checkedAt: T - 5_000 })], [true, true])).toEqual([
      { id: 's1', name: 'My panel', type: 'xtream', host: 'panel.test:8080', checkedAt: T, blocked: true, storage: false, needs: null, answer: null },
      { id: 's4', name: 'Kitchen', type: 'm3u-file', host: '', checkedAt: T - 5_000, blocked: false, storage: false, needs: null, answer: null },
    ]);
  });

  it('lists a source without its login with the server it kept, and asks the blocklist about it (step 32d4a)', () => {
    const panel: StoredSource = { id: 's5', type: 'xtream', name: 'Bare panel', account: null, base: 'http://bare.test:8080', added: 5 };
    const link: StoredSource = { id: 's6', type: 'm3u', name: 'Bare list', url: null, origin: 'https://lists.bare.test', added: 6 };
    expect(sourceRows(profileOf([panel, link]), [], [true, false])).toEqual([
      { id: 's5', name: 'Bare panel', type: 'xtream', host: 'bare.test:8080', checkedAt: null, blocked: true, storage: false, needs: 'login', answer: null },
      { id: 's6', name: 'Bare list', type: 'm3u', host: 'lists.bare.test', checkedAt: null, blocked: false, storage: false, needs: 'link', answer: null },
    ]);
  });

  it('gives each row its save’s answer by source id (step 32d4b)', () => {
    const failed = { state: 'failed', code: 'auth', status: null } as const;
    const rows = sourceRows(profileOf([PANEL, LIST, GONE]), [], [], { s1: { state: 'updating' }, s3: failed });
    expect(rows.map((r) => r.answer)).toEqual([{ state: 'updating' }, null, failed]);
  });
});

describe('the sources list', () => {
  it('opens loading with nothing focused, then lists every source and asks the blocklist for their full links', async () => {
    const engine = new FakeEngine();
    engine.hold = true;
    engine.blockedUrls = ['https://lists.test/get.php?username=u&password=p'];
    const t = setup(engine);
    t.list.open();
    await flush();
    expect(t.list.status.value).toBe('loading');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources -1`);
    expect(t.list.pending.value).toBe(1);
    engine.release();
    await flush();
    // The profile and the records are in; the blocklist's answer is still out.
    expect(t.list.status.value).toBe('loading');
    expect(t.list.pending.value).toBe(1);
    expect(engine.blockAsks).toEqual([['http://user:pw@panel.test:8080', 'https://lists.test/get.php?username=u&password=p', 'http://wiped.test/a.m3u']]);
    engine.release();
    await flush();
    expect(t.list.status.value).toBe('ready');
    expect(t.list.pending.value).toBe(0);
    expect(t.list.rows.value.map((r) => [r.id, r.blocked])).toEqual([
      ['s1', false],
      ['s2', true],
      ['s3', false],
    ]);
    expect(t.at()).toBe('sources · sources 0');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    t.nav.handle('DOWN');
    expect(t.at()).toBe('sources · sources 2');
    // OK does nothing yet; Back closes it.
    t.nav.handle('OK');
    expect(t.at()).toBe('sources · sources 2');
    t.nav.handle('BACK');
    expect(t.at()).toBe('settings · items 0');
  });

  it('asks the blocklist about no server for a file from the phone: an empty URL in its place (step 31d2b1)', async () => {
    const engine = new FakeEngine();
    engine.sources = [PANEL, { id: 's4', type: 'm3u-file', name: 'Kitchen', added: 4 }, LIST];
    const t = setup(engine);
    t.list.open();
    await flush();
    expect(engine.blockAsks).toEqual([['http://user:pw@panel.test:8080', '', 'https://lists.test/get.php?username=u&password=p']]);
    expect(t.list.rows.value.map((r) => [r.id, r.type, r.host])).toEqual([
      ['s1', 'xtream', 'panel.test:8080'],
      ['s4', 'm3u-file', ''],
      ['s2', 'm3u', 'lists.test'],
    ]);
  });

  it("lists the sources unblocked when the blocklist can't be read", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.blockedUrls = ['http://wiped.test/a.m3u'];
    engine.failBlocked = true;
    const t = setup(engine);
    t.list.open();
    await flush();
    expect(t.list.status.value).toBe('ready');
    expect(t.list.rows.value.map((r) => r.blocked)).toEqual([false, false, false]);
    expect(warn).toHaveBeenCalledWith('The blocklist could not be read', expect.any(Error));
    expect(t.list.pending.value).toBe(0);
  });

  it("fails when the profile can't be read, with nothing listed", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.failProfile = true;
    const t = setup(engine);
    t.list.open();
    await flush();
    expect(t.list.status.value).toBe('failed');
    expect(t.list.rows.value).toEqual([]);
    expect(engine.blockAsks).toEqual([]);
    expect(warn).toHaveBeenCalledWith('The sources could not be read', expect.any(Error));
    expect(t.list.pending.value).toBe(0);
  });

  it('reads again at each opening, and drops what an older opening or a disposed list gets', async () => {
    const engine = new FakeEngine();
    engine.hold = true;
    const t = setup(engine);
    t.list.open();
    await flush();
    t.nav.handle('BACK');
    engine.sources = [LIST];
    t.list.open();
    await flush();
    // Both openings' reads land, the older first: only the newer one's rows show.
    engine.release();
    await flush();
    engine.release();
    await flush();
    expect(engine.reads).toBe(2);
    // The older opening never asked the blocklist.
    expect(engine.blockAsks).toEqual([['https://lists.test/get.php?username=u&password=p']]);
    expect(t.list.rows.value.map((r) => r.id)).toEqual(['s2']);
    expect(t.list.status.value).toBe('ready');
    // A disposed list keeps what it had.
    t.nav.handle('BACK');
    engine.sources = [PANEL];
    t.list.open();
    expect(t.list.status.value).toBe('loading');
    t.list.dispose();
    engine.release();
    await flush();
    engine.release();
    await flush();
    expect(t.list.rows.value).toEqual([]);
    expect(t.list.status.value).toBe('loading');
    // Opened once disposed: nothing happens.
    t.nav.handle('BACK');
    t.list.open();
    expect(t.at()).toBe('settings · items 0');
  });

  it('drops a blocklist answer that lands after a newer opening, or after a dispose', async () => {
    const engine = new FakeEngine();
    engine.hold = true;
    const t = setup(engine);
    t.list.open();
    await flush();
    // The profile and the records are in: the blocklist's answer is out.
    engine.release();
    await flush();
    expect(engine.blockAsks).toHaveLength(1);
    t.nav.handle('BACK');
    engine.sources = [LIST];
    t.list.open();
    await flush();
    // The older opening's blocklist answer lands: nothing shows from it.
    engine.held.shift()!.resolve(undefined);
    await flush();
    expect(t.list.status.value).toBe('loading');
    expect(t.list.rows.value).toEqual([]);
    // The newer opening's reads land, then the list is disposed before its blocklist answer.
    engine.release();
    await flush();
    expect(engine.blockAsks).toHaveLength(2);
    t.list.dispose();
    engine.release();
    await flush();
    expect(t.list.status.value).toBe('loading');
    expect(t.list.rows.value).toEqual([]);
  });

  it('puts no failure up for an older opening, either', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.hold = true;
    engine.failProfile = true;
    const t = setup(engine);
    t.list.open();
    await flush();
    t.nav.handle('BACK');
    t.list.open();
    await flush();
    // The older opening's failure lands first: the newer one still loads.
    engine.held.shift()!.reject(new Error('no IndexedDB'));
    await flush();
    expect(t.list.status.value).toBe('loading');
    expect(warn).not.toHaveBeenCalled();
  });
});

type Props = Record<string, unknown> & { children?: unknown };

/** Every element under `node` (components not expanded), depth first. */
function walk(node: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return out;
  const v = node as VNode;
  out.push(v);
  walk((v.props as Props).children, out);
  return out;
}
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => (v.props as Props)['data-testid'] === id || (v.props as Props).testId === id);
/** The text under `node`, in order. */
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf(((node as VNode).props as Props).children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA');
const item: ItemBinding = { state: 'focused', onHover: () => undefined, onPress: () => undefined };
const row = (patch: Partial<SourceRow> = {}): SourceRow => ({ id: 's1', name: 'My panel', type: 'xtream', host: 'panel.test:8080', checkedAt: T, blocked: false, storage: false, needs: null, answer: null, ...patch });

describe('a source’s row as drawn', () => {
  it('names the kind, the format isolated in Arabic', () => {
    expect(sourceKindText(en.t, row())).toBe('Xtream login');
    expect(sourceKindText(en.t, row({ type: 'm3u' }))).toBe('M3U playlist');
    expect(stripIsolates(sourceKindText(ar.t, row()))).toBe('تسجيل دخول Xtream');
    expect(stripIsolates(sourceKindText(ar.t, row({ type: 'm3u' })))).toBe('قائمة تشغيل M3U');
    // A file from the phone (step 31d2b1).
    expect(sourceKindText(en.t, row({ type: 'm3u-file', host: '' }))).toBe('M3U file');
    expect(stripIsolates(sourceKindText(ar.t, row({ type: 'm3u-file', host: '' })))).toBe('ملف M3U');
  });

  it('says when a file from the phone was sent: it is never updated by itself (step 31d2b1)', () => {
    const at = new Date(T);
    const file = row({ type: 'm3u-file', host: '' });
    expect(statusText(en, file)).toBe(`Sent from your phone ${en.date(at, 'day')}, ${en.time(at)}`);
    expect(stripIsolates(statusText(ar, file))).toBe(stripIsolates(`أُرسل من هاتفك ${ar.date(at, 'day')}، ${ar.time(at)}`));
    // No catalog (a restored backup holds no file, step 32c2; a wiped database): send it again, even on a blocked list.
    expect(statusText(en, row({ type: 'm3u-file', host: '', checkedAt: null }))).toBe('Not loaded yet: send this file again from your phone.');
    expect(statusText(ar, row({ type: 'm3u-file', host: '', checkedAt: null }))).toBe('لم يُحمَّل بعد: أرسل هذا الملف من هاتفك مرة أخرى.');
    expect(statusText(en, row({ type: 'm3u-file', host: '', checkedAt: null, blocked: true }))).toBe('Not loaded yet: send this file again from your phone.');
  });

  it('draws a file from the phone with its kind and no server', () => {
    const drawn = SourceItem({ i18n: en, row: row({ id: 's4', name: 'Kitchen', type: 'm3u-file', host: '' }), index: 1, item });
    expect(drawn.props as Props).toMatchObject({ 'data-src': 's4', 'data-type': 'm3u-file', 'data-blocked': 'false' });
    expect(textOf(byTestId(drawn, 'source-1-kind')[0])).toBe('M3U file');
    expect(walk(byTestId(drawn, 'source-1-kind')[0]).filter((v) => (v.props as Props).dir === 'ltr')).toEqual([]);
    expect(textOf(byTestId(drawn, 'source-1-status')[0])).toBe(`Sent from your phone ${en.date(new Date(T), 'day')}, ${en.time(new Date(T))}`);
  });

  it('says when it was last updated, in the TV’s day and time, or that it never was', () => {
    const at = new Date(T);
    expect(statusText(en, row())).toBe(`Updated ${en.date(at, 'day')}, ${en.time(at)}`);
    expect(statusText(en, row({ checkedAt: null }))).toBe('Not updated yet');
    expect(stripIsolates(statusText(ar, row()))).toBe(stripIsolates(`حُدّث ${ar.date(at, 'day')}، ${ar.time(at)}`));
    expect(statusText(ar, row({ checkedAt: null }))).toBe('لم يُحدَّث بعد');
  });

  it('says a source is not updated because the storage is full, since when when it ever was (step 39s1)', () => {
    const at = new Date(T);
    expect(statusText(en, row({ storage: true }))).toBe(`Not updated since ${en.date(at, 'day')}, ${en.time(at)}: Lablo's storage on this TV is full.`);
    expect(statusText(en, row({ storage: true, checkedAt: null }))).toBe("Not updated: Lablo's storage on this TV is full.");
    expect(stripIsolates(statusText(ar, row({ storage: true })))).toBe(stripIsolates(`لم يُحدَّث منذ ${ar.date(at, 'day')}، ${ar.time(at)}: مساحة تخزين لابلو على هذا التلفزيون ممتلئة.`));
    expect(statusText(ar, row({ storage: true, checkedAt: null }))).toBe('لم يُحدَّث: مساحة تخزين لابلو على هذا التلفزيون ممتلئة.');
    // A save's answer and a missing login say more; the storage comes before the blocklist.
    expect(statusText(en, row({ storage: true, needs: 'login' }))).toBe(en.t('sources.needsLogin'));
    expect(statusText(en, row({ storage: true, blocked: true, checkedAt: null }))).toBe("Not updated: Lablo's storage on this TV is full.");
    // A file from the phone says when it was sent.
    expect(statusText(en, row({ storage: true, type: 'm3u-file' }))).toBe(en.t('sources.fileSent', { day: en.date(at, 'day'), time: en.time(at) }));
    expect(warns(row({ storage: true }))).toBe(true);
    expect(warns(row())).toBe(false);
    const drawn = SourceItem({ i18n: en, row: row({ storage: true }), index: 2, item });
    expect(drawn.props as Props).toMatchObject({ 'data-storage': 'true' });
    expect((byTestId(drawn, 'source-2-status')[0]!.props as Props).class).toBe('guides__failure');
    expect((SourceItem({ i18n: en, row: row(), index: 2, item }).props as Props)['data-storage']).toBe('false');
  });

  it('says a blocked source is no longer updated, since when when it ever was', () => {
    const at = new Date(T);
    expect(statusText(en, row({ blocked: true }))).toBe(`Not updated since ${en.date(at, 'day')}, ${en.time(at)}: this server can't be used with Lablo.`);
    expect(statusText(en, row({ blocked: true, checkedAt: null }))).toBe("Not updated: this server can't be used with Lablo.");
    expect(stripIsolates(statusText(ar, row({ blocked: true })))).toBe(stripIsolates(`لم يُحدَّث منذ ${ar.date(at, 'day')}، ${ar.time(at)}: لا يمكن استخدام هذا الخادم مع لابلو.`));
    expect(statusText(ar, row({ blocked: true, checkedAt: null }))).toBe('لا يُحدَّث: لا يمكن استخدام هذا الخادم مع لابلو.');
  });

  it('draws the name as data, the kind and server, and one line under them: the update, or the warning when blocked', () => {
    const plain = SourceItem({ i18n: en, row: row(), index: 0, item });
    const props = plain.props as Props;
    expect(props).toMatchObject({ 'data-testid': 'source-0', 'data-src': 's1', 'data-type': 'xtream', 'data-state': 'focused', 'data-checked': T, 'data-blocked': 'false' });
    expect(String(props.class)).toBe('guides__row sources__row is-focused');
    const name = byTestId(plain, 'source-0-name')[0]!;
    expect((name.props as Props).dir).toBe('auto');
    expect((name.props as Props).translate).toBe(false);
    expect(textOf(name)).toBe('My panel');
    expect(textOf(byTestId(plain, 'source-0-kind')[0])).toBe('Xtream login · panel.test:8080');
    const server = walk(byTestId(plain, 'source-0-kind')[0]).filter((v) => (v.props as Props).dir === 'ltr');
    expect(server.map(textOf)).toEqual(['panel.test:8080']);
    const status = byTestId(plain, 'source-0-status');
    expect(status).toHaveLength(1);
    expect((status[0]!.props as Props).class).toBe('guides__status');
    expect(textOf(status[0])).toBe(statusText(en, row()));
    expect(walk(plain).filter((v) => v.type === 'p')).toHaveLength(1);

    const blocked = SourceItem({ i18n: en, row: row({ blocked: true, checkedAt: null }), index: 3, item: { ...item, state: 'memory' } });
    expect(blocked.props as Props).toMatchObject({ 'data-blocked': 'true', 'data-checked': '' });
    expect(String((blocked.props as Props).class)).toBe('guides__row sources__row is-memory');
    const warning = byTestId(blocked, 'source-3-status')[0]!;
    expect((warning.props as Props).class).toBe('guides__failure');
    expect(textOf(warning)).toBe("Not updated: this server can't be used with Lablo.");
    expect(walk(blocked).filter((v) => v.type === 'p')).toHaveLength(1);
    const arabic = SourceItem({ i18n: ar, row: row({ blocked: true, checkedAt: null }), index: 0, item: { ...item, state: 'idle' } });
    expect(textOf(byTestId(arabic, 'source-0-status')[0])).toBe('لا يُحدَّث: لا يمكن استخدام هذا الخادم مع لابلو.');
    expect(String((arabic.props as Props).class)).toBe('guides__row sources__row');
  });
});

describe('the sources page as drawn', () => {
  async function page(engine: FakeEngine) {
    const t = setup(engine);
    t.list.open();
    await flush();
    const binding = bindFocus(t.nav);
    return { ...t, draw: (i18n = en) => SourcesPage({ i18n, binding, focus: t.nav.snapshot(), list: t.list })! };
  }

  it('shows a spinner while it reads, then the list with its counts', async () => {
    const engine = new FakeEngine();
    engine.hold = true;
    engine.blockedUrls = ['http://wiped.test/a.m3u'];
    const t = await page(engine);
    let root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-testid': 'sources', 'data-status': 'loading', 'data-count': 0, 'data-blocked': 0 });
    expect(walk(root).filter((v) => v.type === Spinner)).toHaveLength(1);
    expect(walk(root).filter((v) => v.type === VirtualList)).toHaveLength(0);
    expect(textOf(walk(root).filter((v) => v.type === 'h1')[0])).toBe('Sources');
    expect(textOf(walk(root).filter((v) => v.type === 'p')[0])).toBe('The playlists and logins you added, and when Lablo last updated them.');
    engine.release();
    await flush();
    engine.release();
    await flush();
    root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-status': 'ready', 'data-count': 3, 'data-blocked': 1 });
    expect(walk(root).filter((v) => v.type === Spinner)).toHaveLength(0);
    const list = walk(root).filter((v) => v.type === VirtualList)[0]!;
    expect(list.props as Props).toMatchObject({ zone: 'sources', itemSize: GUIDES.rowHeight, gap: GUIDES.rowGap, testId: 'sources-list' });
    const render = (list.props as unknown as { renderItem: (i: number, item: ItemBinding) => VNode | null }).renderItem;
    expect(render(2, item)!.type).toBe(SourceItem);
    expect((render(2, item)!.props as unknown as { row: SourceRow; index: number }).row.id).toBe('s3');
    expect((render(2, item)!.props as unknown as { row: SourceRow; index: number }).index).toBe(2);
    expect(render(3, item)).toBeNull();
    expect(textOf(walk(t.draw(ar)).filter((v) => v.type === 'h1')[0])).toBe('المصادر');
  });

  it("says so when the sources can't be read", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new FakeEngine();
    engine.failProfile = true;
    const t = await page(engine);
    const root = t.draw();
    expect(root.props as Props).toMatchObject({ 'data-status': 'failed', 'data-count': 0 });
    expect(textOf(byTestId(root, 'sources-failed')[0])).toBe("Couldn't read your sources.");
    expect(walk(root).filter((v) => v.type === VirtualList)).toHaveLength(0);
  });
});

describe('"Add from your phone" (RELAY step 31c2a)', () => {
  function phoneSetup(engine = new FakeEngine()) {
    const nav = createNavigator({
      root: { id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 2 }] },
      rootBack: 'exit-dialog',
      exit: () => undefined,
      exitDialog: () => undefined,
    });
    let adds = 0;
    const list = createSourcesList({
      nav,
      engine,
      addFromPhone: () => {
        adds += 1;
      },
    });
    const at = (): string => {
      const f = nav.snapshot();
      return `${f.screen} · ${f.zone} ${f.index}`;
    };
    return { nav, engine, list, at, adds: () => adds };
  }

  it('puts a header button over the list: the list keeps the first focus, UP reaches the button, OK opens the pairing', async () => {
    const t = phoneSetup();
    expect(t.list.canAdd).toBe(true);
    t.list.open();
    expect(t.nav.top.zone('header')).toMatchObject({ count: 1, neighbours: { down: 'sources' } });
    expect(t.nav.top.zone('sources')).toMatchObject({ neighbours: { up: 'header' } });
    await flush();
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 0`);
    t.nav.handle('UP');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · header 0`);
    t.nav.handle('OK');
    expect(t.adds()).toBe(1);
    t.nav.handle('DOWN');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 0`);
    // OK on a source does nothing yet.
    t.nav.handle('OK');
    expect(t.adds()).toBe(1);
  });

  it('gives the focus to the button when there is no source', async () => {
    const engine = new FakeEngine();
    engine.sources = [];
    const t = phoneSetup(engine);
    t.list.open();
    await flush();
    expect(t.at()).toBe(`${SOURCES_SCREEN} · header 0`);
  });

  it('has no header without a way to pair', () => {
    const t = setup();
    expect(t.list.canAdd).toBe(false);
    t.list.open();
    expect(t.nav.top.zone('sources').neighbours).toBeUndefined();
    expect(() => t.nav.top.zone('header')).toThrow();
  });

  it('reads the sources again on reload while the screen is open, the focus kept; not once closed', async () => {
    const t = phoneSetup();
    t.list.reload();
    expect(t.engine.reads).toBe(0);
    t.list.open();
    await flush();
    t.nav.handle('DOWN');
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 1`);
    t.engine.sources = [PANEL, LIST, GONE, { id: 's4', type: 'm3u', name: 'From the phone', url: 'http://phone.test/a.m3u', added: 4 }];
    t.list.reload();
    expect(t.list.status.value).toBe('ready');
    await flush();
    expect(t.engine.reads).toBe(2);
    expect(t.list.rows.value.map((r) => r.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(t.at()).toBe(`${SOURCES_SCREEN} · sources 1`);
    t.nav.back();
    t.list.reload();
    await flush();
    expect(t.engine.reads).toBe(2);
    t.list.dispose();
    t.list.open();
    expect(t.engine.reads).toBe(2);
  });

  it('drops what an older read answers after a reload', async () => {
    const engine = new FakeEngine();
    const t = phoneSetup(engine);
    t.list.open();
    await flush();
    engine.hold = true;
    // The first reload reads three sources; its blocklist answer is held.
    t.list.reload();
    engine.release();
    await flush();
    expect(engine.held).toHaveLength(1);
    // The second reads one, and finishes first.
    engine.sources = [PANEL];
    t.list.reload();
    for (const held of engine.held.splice(1, 2)) held.resolve(undefined);
    await flush();
    engine.held.splice(1, 1)[0]!.resolve(undefined);
    await flush();
    expect(t.list.rows.value.map((r) => r.id)).toEqual(['s1']);
    // The first one's late answer changes nothing.
    engine.held.splice(0, 1)[0]!.resolve(undefined);
    await flush();
    expect(t.list.rows.value.map((r) => r.id)).toEqual(['s1']);
  });

  it('draws the button in the header only when the app can pair', async () => {
    const t = phoneSetup();
    t.list.open();
    await flush();
    const binding = bindFocus(t.nav);
    const header = walk(SourcesPage({ i18n: en, binding, focus: t.nav.snapshot(), list: t.list })).filter((v) => v.type === 'header')[0]!;
    const button = walk(header).filter((v) => typeof v.type === 'function' && (v.type as { name?: string }).name === 'AddFromPhone')[0]!;
    // Its own component, with the zone's hook (the e2e draws its label).
    expect(button.props as Props).toMatchObject({ i18n: en, binding });
    const plain = setup();
    plain.list.open();
    const none = walk(SourcesPage({ i18n: en, binding: bindFocus(plain.nav), focus: plain.nav.snapshot(), list: plain.list })).filter((v) => typeof v.type === 'function' && (v.type as { name?: string }).name === 'AddFromPhone');
    expect(none).toEqual([]);
  });
});
