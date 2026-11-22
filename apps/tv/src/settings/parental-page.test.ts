import type { ContentKind } from '@lablo/core';
import type { CategoryInfo, LoadedProfile, ProfileDoc, ProfileEdit, SourceRecord } from '@lablo/data';
import { applyProfileEdit, emptyProfile, lockId } from '@lablo/data';
import { parentalOf } from '@lablo/data/client';
import type { Intent, KeyLike, LifecycleEvent, TextKey } from '@lablo/platform-api';
import type { EditableLike } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GROUPS_VISIBLE } from './groups-state';
import type { ParentalAsk, ParentalPageEngine } from './parental-page';
import { LOCKED_SCREEN, LOCK_KINDS, PARENTAL_SCREEN, PARENTAL_SCREENS, createParentalPage, lockRows, parentalRows } from './parental-page';
import { CHECK_SCREEN, NONE_SCREEN, PICK_SCREEN } from './pin-check';

/**
 * Settings › "Parental control" (RELAY step 38c1): the rows with and without a PIN, the PIN once a
 * visit (and again after the app was hidden), "Change the PIN", "Lock adult groups" and "Locked
 * groups", each edit and its re-reads; "Set a PIN" and "Forgot your PIN?" through a source's
 * login (step 38c2).
 */

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };
const S2: SourceRecord = { id: 's2', type: 'xtream', name: 'Panel', account: { base: 'http://panel.test', username: 'u', password: 'p' }, added: 2 };
const PIN = { salt: 'c2FsdA', hash: 'aGFzaA' };

function info(catIdx: number, name: string, adult = false): CategoryInfo {
  return adult ? { catIdx, name, count: 1, chunks: [1], adult: true } : { catIdx, name, count: 1, chunks: [1] };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

class FakeEngine implements ParentalPageEngine {
  doc: ProfileDoc = { ...emptyProfile(), sources: [S1], parental: PIN } as ProfileDoc;
  /** Each source's categories by kind, as the ingest kept them (the worker marks the locks). */
  catalog: Record<string, Partial<Record<ContentKind, CategoryInfo[]>>> = {
    s1: { live: [info(0, 'News'), info(1, 'XXX Night', true)], movie: [info(0, 'Films')], series: [info(0, 'Shows')] },
    s2: { live: [info(0, 'Sport')] },
  };
  readonly edits: ProfileEdit[] = [];
  readonly asked: string[] = [];
  failRead = false;
  failEdit = false;
  refuseEdit = false;
  holdEdit = false;
  readonly held: (() => void)[] = [];
  profileCalls = 0;

  profile(): Promise<LoadedProfile | null> {
    this.profileCalls += 1;
    if (this.failRead) return Promise.reject(new Error('no IndexedDB'));
    return Promise.resolve({ doc: this.doc, newer: false, migratedFrom: null });
  }

  /** As the query worker marks them: a user's choice, else adult while "Lock adult groups" is on. */
  categories(src: string, kind: ContentKind): Promise<CategoryInfo[]> {
    this.asked.push(`${src}:${kind}`);
    const state = parentalOf(this.doc);
    const choices: Record<string, boolean> = {};
    for (const g of state.groups) choices[lockId(g)] = g.locked;
    return Promise.resolve(
      (this.catalog[src]?.[kind] ?? []).map((c) => {
        const choice = choices[lockId({ src, kind, name: c.name })];
        const locked = choice === undefined ? state.adult && c.adult === true : choice;
        return locked ? { ...c, locked: true } : c;
      }),
    );
  }

  editProfile(edit: ProfileEdit): Promise<boolean> {
    this.edits.push(edit);
    const run = (): boolean => {
      if (this.failEdit) throw new Error('worker gone');
      if (this.refuseEdit) return false;
      const next = applyProfileEdit(this.doc, edit);
      if (next === null) return false;
      this.doc = next;
      return true;
    };
    if (this.holdEdit) return new Promise((resolve, reject) => this.held.push(() => Promise.resolve().then(run).then(resolve, reject)));
    return Promise.resolve().then(run);
  }
}

class FakePad implements ParentalAsk {
  readonly asks: (() => void)[] = [];
  readonly chooses: (() => void)[] = [];
  ask(done: () => void): void {
    this.asks.push(done);
  }
  choose(done: () => void): void {
    this.chooses.push(done);
  }
}

function setup(engine = new FakeEngine()) {
  const nav = createNavigator({
    root: { id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 8 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  const pad = new FakePad();
  const changed = vi.fn();
  const listeners: ((event: LifecycleEvent) => void)[] = [];
  const lifecycle = (listener: (event: LifecycleEvent) => void): (() => void) => {
    listeners.push(listener);
    return () => listeners.splice(listeners.indexOf(listener), 1);
  };
  const inputs: Record<string, EditableLike> = {};
  const find = (id: string): EditableLike => {
    inputs[id] ??= { focus: () => undefined, blur: () => undefined };
    return inputs[id]!;
  };
  const platform = {
    textKey: (event: KeyLike): TextKey | null => (event.key === 'Enter' ? 'done' : null),
    onSoftKeyboard: () => () => undefined,
  };
  const page = createParentalPage({ nav, engine, pad, changed, lifecycle, platform, find });
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  const open = async (): Promise<void> => {
    page.open();
    await flush();
  };
  /** The groups as `<kind>:<name>` with ` locked` and ` adult`. */
  const groups = (): string[] => page.groups.value.map((r) => `${r.group.kind}:${r.group.name}${r.locked ? ' locked' : ''}${r.adult ? ' adult' : ''}${r.source === '' ? '' : ` @${r.source}`}`);
  const emit = (event: LifecycleEvent): void => {
    for (const listener of listeners.slice()) listener(event);
  };
  return { engine, nav, pad, changed, page, at, press, open, groups, emit, listeners };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the rows (RELAY step 38c1)', () => {
  it('are the three behind the PIN and "Forgot your PIN?" with one, "Set a PIN" without (step 38c2)', () => {
    expect(parentalRows(true)).toEqual(['change', 'adult', 'groups', 'forgot']);
    expect(parentalRows(false)).toEqual(['set']);
    expect(PARENTAL_SCREENS).toEqual([PARENTAL_SCREEN, LOCKED_SCREEN, PICK_SCREEN, CHECK_SCREEN, NONE_SCREEN]);
  });

  it('opens on the first row once read, the PIN and "Lock adult groups" as stored', async () => {
    const t = setup();
    t.page.open();
    expect(t.page.status.value).toBe('loading');
    expect(t.at()).toBe(`${PARENTAL_SCREEN} · rows -1`);
    await flush();
    expect(t.page.status.value).toBe('ready');
    expect(t.page.pin.value).toBe(true);
    expect(t.page.adult.value).toBe(true);
    expect(t.page.rows.value).toEqual(['change', 'adult', 'groups', 'forgot']);
    expect(t.at()).toBe(`${PARENTAL_SCREEN} · rows 0`);
    // Nothing asked or changed by opening it.
    expect(t.pad.asks).toHaveLength(0);
    expect(t.engine.edits).toEqual([]);
  });

  it('has "Set a PIN" alone without a PIN, and reads "Lock adult groups" off as stored', async () => {
    const engine = new FakeEngine();
    engine.doc = { ...emptyProfile(), sources: [S1], parental: { adult: false } } as ProfileDoc;
    const t = setup(engine);
    await t.open();
    expect(t.page.pin.value).toBe(false);
    expect(t.page.adult.value).toBe(false);
    expect(t.page.rows.value).toEqual(['set']);
    await t.press('OK');
    // No PIN to ask: the login check instead.
    expect(t.pad.asks).toHaveLength(0);
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 0`);
  });

  it('says it could not read, and closes on Back', async () => {
    const engine = new FakeEngine();
    engine.failRead = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup(engine);
    await t.open();
    expect(t.page.status.value).toBe('failed');
    await t.press('BACK');
    expect(t.at()).toBe('settings · items 0');
    expect(t.page.screen.value).toBeNull();
  });

  it('drops a read that lands after Back, and opens once for two calls', async () => {
    const t = setup();
    t.page.open();
    t.page.open();
    expect(t.engine.profileCalls).toBe(1);
    await t.press('BACK');
    expect(t.page.status.value).toBe('loading');
    expect(t.page.rows.value).toEqual([]);
  });
});

describe('the PIN, once a visit (RELAY step 38c1)', () => {
  it('asks it at the first row chosen, then not again until the page opens again', async () => {
    const t = setup();
    await t.open();
    await t.press('DOWN', 'DOWN', 'OK');
    expect(t.pad.asks).toHaveLength(1);
    expect(t.page.lockedScreen.value).toBeNull();
    t.pad.asks[0]!();
    await flush();
    expect(t.at()).toBe(`${LOCKED_SCREEN} · rows 0`);
    await t.press('BACK', 'UP', 'OK');
    expect(t.pad.asks).toHaveLength(1);
    expect(t.engine.edits).toHaveLength(1);
    // Closed and opened again: asked again.
    await t.press('BACK');
    await t.open();
    await t.press('OK');
    expect(t.pad.asks).toHaveLength(2);
    expect(t.pad.chooses).toHaveLength(0);
  });

  it('does nothing when the pad closes without the PIN', async () => {
    const t = setup();
    await t.open();
    await t.press('DOWN', 'OK');
    expect(t.pad.asks).toHaveLength(1);
    await t.press('OK');
    expect(t.pad.asks).toHaveLength(2);
    expect(t.engine.edits).toEqual([]);
  });

  it('asks again after the app was hidden, the page still open', async () => {
    const t = setup();
    await t.open();
    await t.press('DOWN', 'OK');
    t.pad.asks[0]!();
    await flush();
    expect(t.engine.edits).toHaveLength(1);
    t.emit('visible');
    await t.press('OK');
    expect(t.pad.asks).toHaveLength(1);
    expect(t.engine.edits).toHaveLength(2);
    t.emit('hidden');
    t.emit('visible');
    await t.press('OK');
    expect(t.pad.asks).toHaveLength(2);
    expect(t.engine.edits).toHaveLength(2);
  });

  it('stops listening to the lifecycle once disposed', () => {
    const t = setup();
    expect(t.listeners).toHaveLength(1);
    t.page.dispose();
    expect(t.listeners).toHaveLength(0);
  });
});

describe('"Change the PIN" (RELAY step 38c1)', () => {
  it('asks the PIN, then a new one twice; the line says it changed, until the page opens again', async () => {
    const t = setup();
    await t.open();
    await t.press('OK');
    t.pad.asks[0]!();
    await flush();
    expect(t.pad.chooses).toHaveLength(1);
    expect(t.page.changedPin.value).toBe(false);
    t.pad.chooses[0]!();
    expect(t.page.changedPin.value).toBe(true);
    expect(t.changed).not.toHaveBeenCalled();
    await t.press('BACK');
    await t.open();
    expect(t.page.changedPin.value).toBe(false);
  });
});

describe('"Set a PIN" and "Forgot your PIN?" (RELAY step 38c2)', () => {
  /** Types `link` into the check's form (S1, a playlist) and presses "Check". */
  const typeLink = async (t: ReturnType<typeof setup>, link: string): Promise<void> => {
    t.page.check.form.setValue('playlist', link);
    t.nav.top.focus('actions', 0);
    await t.press('OK');
  };

  it('sets a first PIN after the source’s login: no PIN asked, the new PIN, then the rows read again and the visit granted', async () => {
    const engine = new FakeEngine();
    engine.doc = { ...emptyProfile(), sources: [S1] } as ProfileDoc;
    const t = setup(engine);
    await t.open();
    await t.press('OK');
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 0`);
    await typeLink(t, 'http://lists.test/a.m3u');
    expect(t.at()).toBe(`${PARENTAL_SCREEN} · rows 0`);
    expect(t.pad.chooses).toHaveLength(1);
    expect(t.pad.asks).toHaveLength(0);
    const reads = engine.profileCalls;
    // The pad keeps it (the worker's PIN), then the page reads again.
    engine.doc = { ...engine.doc, parental: PIN } as ProfileDoc;
    t.pad.chooses[0]!();
    await flush();
    expect(engine.profileCalls).toBe(reads + 1);
    expect(t.page.rows.value).toEqual(['change', 'adult', 'groups', 'forgot']);
    expect(t.page.changedPin.value).toBe(true);
    expect(t.changed).not.toHaveBeenCalled();
    // Granted: "Lock adult groups" switches with no PIN asked.
    await t.press('DOWN', 'OK');
    expect(t.pad.asks).toHaveLength(0);
    expect(t.engine.edits).toEqual([{ kind: 'parental', change: { op: 'adult', on: false } }]);
  });

  it('sets a new PIN in place of a forgotten one the same way, from the last row', async () => {
    const t = setup();
    await t.open();
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    expect(t.pad.asks).toHaveLength(0);
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 0`);
    await typeLink(t, 'http://lists.test/a.m3u');
    expect(t.pad.chooses).toHaveLength(1);
    t.pad.chooses[0]!();
    await flush();
    await t.press('UP', 'UP', 'OK');
    expect(t.pad.asks).toHaveLength(0);
    expect(t.engine.edits).toHaveLength(1);
  });

  it('goes no further on a wrong login, nor when the pad closes before the new PIN is kept', async () => {
    const t = setup();
    await t.open();
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    await typeLink(t, 'http://lists.test/b.m3u');
    expect(t.page.check.form.mismatch.value).toBe(true);
    expect(t.at()).toBe(`${CHECK_SCREEN} · fields 0`);
    expect(t.pad.chooses).toHaveLength(0);
    await t.press('BACK');
    expect(t.at()).toBe(`${PARENTAL_SCREEN} · rows 3`);
    // The right login, the pad closed with no PIN kept: still not granted.
    await t.press('OK');
    await typeLink(t, 'http://lists.test/a.m3u');
    expect(t.pad.chooses).toHaveLength(1);
    await t.press('UP', 'UP', 'OK');
    expect(t.pad.asks).toHaveLength(1);
    expect(t.page.changedPin.value).toBe(false);
  });

  it('drops the new PIN’s end once disposed', async () => {
    const t = setup();
    await t.open();
    await t.press('DOWN', 'DOWN', 'DOWN', 'OK');
    await typeLink(t, 'http://lists.test/a.m3u');
    const reads = t.engine.profileCalls;
    t.page.dispose();
    t.pad.chooses[0]!();
    await flush();
    expect(t.engine.profileCalls).toBe(reads);
    expect(t.page.changedPin.value).toBe(false);
    // Its check went with it.
    t.page.check.run(() => undefined);
    await flush();
    expect(t.engine.profileCalls).toBe(reads);
  });
});

describe('"Lock adult groups" (RELAY step 38c1)', () => {
  it('switches it in place, then the screens read again', async () => {
    const t = setup();
    await t.open();
    await t.press('DOWN', 'OK');
    t.pad.asks[0]!();
    await flush();
    expect(t.engine.edits).toEqual([{ kind: 'parental', change: { op: 'adult', on: false } }]);
    expect(t.page.adult.value).toBe(false);
    expect(parentalOf(t.engine.doc).adult).toBe(false);
    expect(t.changed).toHaveBeenCalledTimes(1);
    await t.press('OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'parental', change: { op: 'adult', on: true } });
    expect(t.page.adult.value).toBe(true);
    expect(t.changed).toHaveBeenCalledTimes(2);
    expect(t.at()).toBe(`${PARENTAL_SCREEN} · rows 1`);
  });

  it('says so when the change did not take, refused or failed; the next one clears it', async () => {
    const t = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    t.engine.refuseEdit = true;
    await t.open();
    await t.press('DOWN', 'OK');
    t.pad.asks[0]!();
    await flush();
    expect(t.page.failed.value).toBe(true);
    expect(t.page.adult.value).toBe(true);
    t.engine.refuseEdit = false;
    t.engine.failEdit = true;
    await t.press('OK');
    expect(t.page.failed.value).toBe(true);
    t.engine.failEdit = false;
    await t.press('OK');
    expect(t.page.failed.value).toBe(false);
    expect(t.page.adult.value).toBe(false);
    expect(t.changed).toHaveBeenCalledTimes(1);
  });

  it('waits for a change on its way before taking another', async () => {
    const t = setup();
    t.engine.holdEdit = true;
    await t.open();
    await t.press('DOWN', 'OK');
    t.pad.asks[0]!();
    await flush();
    expect(t.page.pending.value).toBe(1);
    await t.press('OK', 'DOWN', 'OK');
    expect(t.engine.edits).toHaveLength(1);
    expect(t.page.lockedScreen.value).toBeNull();
    t.engine.held[0]!();
    await flush();
    expect(t.page.adult.value).toBe(false);
    expect(t.page.pending.value).toBe(0);
  });
});

describe('"Locked groups" (RELAY step 38c1)', () => {
  it('orders every group live, then movies, then series, each source in its order', () => {
    const rows = lockRows([
      { src: 's1', name: 'Home', kinds: [[info(0, 'News'), info(1, 'XXX', true)], [info(0, 'Films')], []] },
      { src: 's2', name: 'Panel', kinds: [[{ ...info(0, 'Sport'), locked: true }], [], [info(0, 'Shows', true)]] },
    ]);
    expect(rows.map((r) => `${r.group.src}:${r.group.kind}:${r.group.name}:${String(r.adult)}:${String(r.locked)}:${r.source}`)).toEqual([
      's1:live:News:false:false:Home',
      's1:live:XXX:true:false:Home',
      's2:live:Sport:false:true:Panel',
      's1:movie:Films:false:false:Home',
      's2:series:Shows:true:false:Panel',
    ]);
    // One source: no source names.
    expect(lockRows([{ src: 's1', name: 'Home', kinds: [[info(0, 'News')]] }])[0]!.source).toBe('');
    expect(LOCK_KINDS).toEqual(['live', 'movie', 'series']);
  });

  const toGroups = async (t: ReturnType<typeof setup>): Promise<void> => {
    await t.open();
    await t.press('DOWN', 'DOWN', 'OK');
    t.pad.asks[0]!();
    await flush();
  };

  it('lists every group of each source and kind with its lock, the adult ones locked by default', async () => {
    const engine = new FakeEngine();
    engine.doc = { ...emptyProfile(), sources: [S1, S2], parental: PIN } as ProfileDoc;
    const t = setup(engine);
    await toGroups(t);
    expect(t.page.lockedStatus.value).toBe('ready');
    expect(t.groups()).toEqual(['live:News @Home', 'live:XXX Night locked adult @Home', 'live:Sport @Panel', 'movie:Films @Home', 'series:Shows @Home']);
    expect(t.engine.asked).toEqual(['s1:live', 's1:movie', 's1:series', 's2:live', 's2:movie', 's2:series']);
    expect(t.nav.top.zone('rows')).toMatchObject({ count: 5, visible: GROUPS_VISIBLE });
  });

  it('switches a group by OK, both ways, the focus staying on it, and the screens read again', async () => {
    const t = setup();
    await toGroups(t);
    expect(t.groups()).toEqual(['live:News', 'live:XXX Night locked adult', 'movie:Films', 'series:Shows']);
    await t.press('DOWN', 'OK');
    expect(t.engine.edits).toEqual([{ kind: 'parental', change: { op: 'group', group: { src: 's1', kind: 'live', name: 'XXX Night' }, locked: false } }]);
    expect(t.groups()).toEqual(['live:News', 'live:XXX Night adult', 'movie:Films', 'series:Shows']);
    expect(t.changed).toHaveBeenCalledTimes(1);
    expect(t.at()).toBe(`${LOCKED_SCREEN} · rows 1`);
    await t.press('DOWN', 'OK');
    expect(t.groups()).toEqual(['live:News', 'live:XXX Night adult', 'movie:Films locked', 'series:Shows']);
    expect(t.at()).toBe(`${LOCKED_SCREEN} · rows 2`);
    await t.press('OK');
    expect(t.groups()).toEqual(['live:News', 'live:XXX Night adult', 'movie:Films', 'series:Shows']);
    // Kept both ways: an adult group opened by the user, a group locked then opened again.
    expect(parentalOf(t.engine.doc).groups).toEqual([
      { src: 's1', kind: 'live', name: 'XXX Night', locked: false },
      { src: 's1', kind: 'movie', name: 'Films', locked: false },
    ]);
    expect(t.changed).toHaveBeenCalledTimes(3);
  });

  it('keeps the page on a change that did not take and says so', async () => {
    const t = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await toGroups(t);
    t.engine.refuseEdit = true;
    await t.press('OK');
    expect(t.page.failed.value).toBe(true);
    expect(t.groups()[0]).toBe('live:News');
    expect(t.changed).not.toHaveBeenCalled();
  });

  it('back on Back to its row on the page; nothing listed with no source, and a failed read says so', async () => {
    const engine = new FakeEngine();
    engine.doc = { ...emptyProfile(), parental: PIN } as ProfileDoc;
    const t = setup(engine);
    await toGroups(t);
    expect(t.page.lockedStatus.value).toBe('ready');
    expect(t.page.groups.value).toEqual([]);
    await t.press('BACK');
    expect(t.at()).toBe(`${PARENTAL_SCREEN} · rows 2`);
    expect(t.page.lockedScreen.value).toBeNull();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.failRead = true;
    await t.press('OK');
    expect(t.page.lockedStatus.value).toBe('failed');
  });

  it('drops a read that lands after Back', async () => {
    const t = setup();
    await t.open();
    await t.press('DOWN', 'DOWN', 'OK');
    t.pad.asks[0]!();
    // (Back before the read lands.)
    await t.press('BACK');
    expect(t.page.groups.value).toEqual([]);
    expect(t.page.lockedStatus.value).toBe('loading');
  });

  it('opens again on its spinner, the last rows gone, until they are read again', async () => {
    const t = setup();
    await toGroups(t);
    expect(t.page.groups.value).toHaveLength(4);
    await t.press('BACK');
    t.engine.failRead = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await t.press('OK');
    expect(t.page.groups.value).toEqual([]);
    expect(t.page.lockedStatus.value).toBe('failed');
  });

  it('waits for a change on its way before taking another', async () => {
    const t = setup();
    await toGroups(t);
    t.engine.holdEdit = true;
    await t.press('OK');
    expect(t.page.pending.value).toBe(1);
    await t.press('DOWN', 'OK');
    expect(t.engine.edits).toHaveLength(1);
    t.engine.held[0]!();
    await flush();
    expect(t.groups()).toEqual(['live:News locked', 'live:XXX Night locked adult', 'movie:Films', 'series:Shows']);
  });
});
