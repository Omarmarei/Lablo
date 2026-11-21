import type { CatalogItem } from '@lablo/core';
import type { LoadedProfile, ProfileDoc, ProfileEdit, SourceRecord } from '@lablo/data';
import { applyProfileEdit, emptyProfile } from '@lablo/data';
import type { ChannelEdit, KeyItemsRequest } from '@lablo/data/client';
import { MAX_CHANNEL_EDITS } from '@lablo/data/client';
import type { Intent, KeyLike, TextKey } from '@lablo/platform-api';
import type { EditableLike } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditTarget } from './channel-edit';
import { CHANNEL_NAME_FIELD, CHANNEL_NUMBER_FIELD, EDIT_NUMBER, EDIT_RENAME, EDIT_SCREEN, EDIT_SCREENS, FORM_CANCEL, FORM_SAVE, createChannelEditor, editActions, editOf, trimmed, typedNumber } from './channel-edit';
import type { EditedEngine } from './edited-channels';
import { CHANNELS_SCREEN, CLEAN_ROW, createEditedChannels, editedRows } from './edited-channels';

/**
 * "Edit channel" and Settings › "Channels" (RELAY step 36c): the menu over the player and from
 * the page, its forms, and the page's switch and rows, against a fake data engine that applies
 * the profile's edits for real (the query worker's `applyProfileEdit`). The e2e
 * (`channel-edit-screens.spec.ts`) drives them in the app.
 */

function item(key: string, name: string, chno: number | null = null): CatalogItem {
  return {
    key,
    src: 's1',
    kind: 'live',
    name,
    normName: name.toLowerCase(),
    group: 'News',
    url: `http://panel.test/${key}.ts`,
    logo: null,
    epgId: `${key}.tv`,
    tvgName: null,
    matchName: null,
    chno,
    tvgShift: 0,
    catchup: null,
    radio: false,
    hints: null,
  };
}

function edit(key: string, change: Partial<Pick<ChannelEdit, 'hidden' | 'name' | 'number'>>): ChannelEdit {
  return { key, src: 's1', kind: 'live', normName: `${key} stored`, group: 'News', added: 1, missingSince: null, ...change };
}

const S1: SourceRecord = { id: 's1', type: 'm3u', name: 'Home', url: 'http://lists.test/a.m3u', added: 1 };

/** The catalog's live items by key, as the worker shows them (a's name is the user's here). */
const ITEMS: Record<string, CatalogItem> = { a: item('a', 'Alpha', 7), b: item('b', 'Beta'), c: item('c', 'Gamma', 3) };

interface Held {
  readonly go: () => void;
}

/** The data engine: the profile's edits applied for real, answers held on request. */
class FakeEngine implements EditedEngine {
  doc: ProfileDoc = { ...emptyProfile(), sources: [S1] } as ProfileDoc;
  readonly edits: ProfileEdit[] = [];
  readonly keyCalls: KeyItemsRequest[] = [];
  failRead = false;
  failEdit = false;
  hold = new Set<'read' | 'edit' | 'keys'>();
  readonly held: Record<'read' | 'edit' | 'keys', Held[]> = { read: [], edit: [], keys: [] };

  private answer<T>(kind: 'read' | 'edit' | 'keys', value: () => T): Promise<T> {
    const run = (): Promise<T> => {
      try {
        return Promise.resolve(value());
      } catch (error) {
        return Promise.reject(error);
      }
    };
    if (!this.hold.has(kind)) return run();
    return new Promise<T>((resolve, reject) => {
      this.held[kind].push({ go: () => run().then(resolve, reject) });
    });
  }

  profile(): Promise<LoadedProfile | null> {
    return this.answer('read', () => {
      if (this.failRead) throw new Error('no IndexedDB');
      return { doc: this.doc, newer: false, migratedFrom: null };
    });
  }

  itemsByKey(req: KeyItemsRequest): Promise<CatalogItem[]> {
    this.keyCalls.push(req);
    return this.answer('keys', () => req.keys.filter((k) => ITEMS[k] !== undefined).map((k) => ITEMS[k]!));
  }

  editProfile(e: ProfileEdit): Promise<boolean> {
    this.edits.push(e);
    return this.answer('edit', () => {
      if (this.failEdit) throw new Error('worker gone');
      const next = applyProfileEdit(this.doc, e);
      if (next === null) return false;
      this.doc = next;
      return true;
    });
  }

  release(kind: 'read' | 'edit' | 'keys'): void {
    for (const h of this.held[kind].splice(0)) h.go();
  }

  /** The stored changed channels, in short: `key:h` hidden, `:n=name`, `:#number`. */
  stored(): string[] {
    const list = ((this.doc as { channelEdits?: ChannelEdit[] }).channelEdits ?? []) as ChannelEdit[];
    return list.map((e) => `${e.key}${e.hidden === true ? ':h' : ''}${e.name !== undefined ? `:n=${e.name}` : ''}${e.number !== undefined ? `:#${e.number}` : ''}`);
  }
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

function setup(engine = new FakeEngine()) {
  const nav = createNavigator({
    root: { id: 'player', zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 6 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
    now: () => 0,
  });
  const input: EditableLike & { focused: string[] } = {
    focused: [],
    focus() {
      this.focused.push('x');
    },
    blur: () => undefined,
  };
  const find = vi.fn((id: string) => (id === CHANNEL_NAME_FIELD || id === CHANNEL_NUMBER_FIELD ? input : null));
  const platform = {
    textKey: (event: KeyLike): TextKey | null => (event.key === 'Enter' ? 'done' : null),
    onSoftKeyboard: () => () => undefined,
  };
  const changed = vi.fn();
  const editor = createChannelEditor({ nav, engine, changed, platform, find, now: () => 5_000 });
  const closed = vi.fn();
  const stop = vi.fn();
  const at = (): string => {
    const f = nav.snapshot();
    return `${f.screen} · ${f.zone} ${f.index}`;
  };
  const press = async (...keys: Intent[]): Promise<void> => {
    for (const key of keys) nav.handle(key);
    await flush();
  };
  /** OK on action `name` of the menu on show. */
  const choose = async (name: string): Promise<void> => {
    const index = editor.actions.value.indexOf(name as never);
    expect(index).not.toBe(-1);
    nav.top.focus('actions', index);
    await press('OK');
  };
  return { nav, engine, editor, find, input, changed, closed, stop, at, press, choose };
}

/** The menu over the player for `channel`, its read landed. */
async function over(channel = ITEMS.b!, engine = new FakeEngine()) {
  const t = setup(engine);
  t.editor.openOver(channel, t.closed, t.stop);
  await flush();
  return t;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the menu’s words and checks (RELAY step 36c)', () => {
  const target = (e: ChannelEdit | null, found = true): EditTarget => ({ key: 'a', item: found ? ITEMS.a! : null, edit: e, name: 'Alpha' });

  it('offers Rename, Channel number and Hide, "Undo my changes" with a change, Show for a hidden one, only Undo for a channel not in the sources', () => {
    expect(editActions(target(null))).toEqual(['rename', 'number', 'hide', 'cancel']);
    expect(editActions(target(edit('a', { name: 'X' })))).toEqual(['rename', 'number', 'hide', 'reset', 'cancel']);
    expect(editActions(target(edit('a', { hidden: true })))).toEqual(['rename', 'number', 'show', 'reset', 'cancel']);
    expect(editActions(target(edit('a', { hidden: true }), false))).toEqual(['reset', 'cancel']);
    expect(editActions(target(null, false))).toEqual(['cancel']);
    expect(EDIT_SCREENS).toEqual([EDIT_SCREEN, EDIT_RENAME, EDIT_NUMBER]);
  });

  it('trims the spaces at the ends, the no-break and ideographic ones too, and keeps those inside', () => {
    expect(trimmed('  My  SMPTE \t')).toBe('My  SMPTE');
    expect(trimmed(' قناتي　')).toBe('قناتي');
    expect(trimmed('   ')).toBe('');
    expect(trimmed('x')).toBe('x');
    expect(trimmed('')).toBe('');
  });

  it('reads a number from digits alone: empty is none, 1 to 9999, leading zeros allowed', () => {
    expect(typedNumber('')).toBeNull();
    expect(typedNumber('  ')).toBeNull();
    expect(typedNumber('42')).toBe(42);
    expect(typedNumber(' 7 ')).toBe(7);
    expect(typedNumber('0042')).toBe(42);
    expect(typedNumber('1')).toBe(1);
    expect(typedNumber('9999')).toBe(9999);
    for (const wrong of ['0', '000', '10000', '4a', '-1', '4.0', '1e3', '٤٢', '+7', '4 2', '/', ':']) expect(typedNumber(wrong)).toBeUndefined();
  });

  it('finds a channel’s stored changes by key', () => {
    const doc = { channelEdits: [edit('a', { name: 'X' }), edit('b', { hidden: true })] };
    expect(editOf(doc, 'b')).toEqual(edit('b', { hidden: true }));
    expect(editOf(doc, 'a')!.name).toBe('X');
    expect(editOf(doc, 'c')).toBeNull();
    expect(editOf(null, 'a')).toBeNull();
  });

  it('makes the page’s rows in the profile’s order: the item’s name, else the user’s, else the stored one', () => {
    const rows = editedRows([edit('z', {}), edit('a', { hidden: true }), edit('y', { name: 'Mine' })], [ITEMS.a!]);
    expect(rows.map((r) => [r.key, r.item === null ? null : r.item.key, r.name])).toEqual([
      ['z', null, 'z stored'],
      ['a', 'a', 'Alpha'],
      ['y', null, 'Mine'],
    ]);
    expect(rows[1]!.edit).toEqual(edit('a', { hidden: true }));
  });
});

describe('"Edit channel" over the player (the info bar’s pencil)', () => {
  it('reads the channel’s changes first: no action and OK waits until then', async () => {
    const engine = new FakeEngine();
    engine.doc = { ...engine.doc, channelEdits: [edit('b', { hidden: true })] } as ProfileDoc;
    engine.hold.add('read');
    const t = setup(engine);
    t.editor.openOver(ITEMS.b!, t.closed, t.stop);
    // (No item to focus yet.)
    expect(t.at()).toBe(`${EDIT_SCREEN} · actions -1`);
    expect(t.editor.over.value).toBe(true);
    expect(t.editor.target.value).toEqual({ key: 'b', item: ITEMS.b, edit: null, name: 'Beta' });
    expect(t.editor.actions.value).toEqual([]);
    expect(t.editor.pending.value).toBe(1);
    await t.press('OK');
    expect(t.engine.edits).toEqual([]);
    engine.release('read');
    await flush();
    expect(t.editor.pending.value).toBe(0);
    expect(t.editor.target.value!.edit).toEqual(edit('b', { hidden: true }));
    expect(t.editor.actions.value).toEqual(['rename', 'number', 'show', 'reset', 'cancel']);
    expect(t.nav.top.zone('actions')).toMatchObject({ count: 5 });
    expect(t.at()).toBe(`${EDIT_SCREEN} · actions 0`);
  });

  it('offers what a channel with no changes has when the read fails', async () => {
    const engine = new FakeEngine();
    engine.failRead = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = await over(ITEMS.b!, engine);
    expect(t.editor.actions.value).toEqual(['rename', 'number', 'hide', 'cancel']);
    expect(t.editor.pending.value).toBe(0);
  });

  it('drops a read that lands after the menu closed', async () => {
    const engine = new FakeEngine();
    engine.hold.add('read');
    const t = setup(engine);
    t.editor.openOver(ITEMS.b!, t.closed, t.stop);
    await t.press('BACK');
    expect(t.closed).toHaveBeenCalledTimes(1);
    engine.release('read');
    await flush();
    expect(t.editor.target.value).toBeNull();
    expect(t.editor.actions.value).toEqual([]);
    expect(t.editor.pending.value).toBe(0);
  });

  it('closes on Back and Cancel (the bar shows again), and with the player on STOP', async () => {
    const t = await over();
    await t.press('BACK');
    expect(t.at()).toBe('player · actions 0');
    expect(t.editor.screen.value).toBeNull();
    expect(t.closed).toHaveBeenCalledTimes(1);
    expect(t.stop).not.toHaveBeenCalled();
    t.editor.openOver(ITEMS.b!, t.closed, t.stop);
    await flush();
    await t.choose('cancel');
    expect(t.closed).toHaveBeenCalledTimes(2);
    expect(t.engine.edits).toEqual([]);
    t.editor.openOver(ITEMS.b!, t.closed, t.stop);
    await flush();
    await t.press('STOP');
    expect(t.closed).toHaveBeenCalledTimes(3);
    expect(t.stop).toHaveBeenCalledTimes(1);
    expect(t.at()).toBe('player · actions 0');
  });

  it('opens once: a second pencil while it shows does nothing', async () => {
    const t = await over(ITEMS.b!);
    const other = vi.fn();
    t.editor.openOver(ITEMS.c!, other, other);
    expect(t.editor.target.value!.key).toBe('b');
    await t.press('BACK');
    expect(other).not.toHaveBeenCalled();
    expect(t.closed).toHaveBeenCalledTimes(1);
  });

  it('hides the channel with one edit (the shown item’s ref), then closes and tells the live screen', async () => {
    const t = await over(ITEMS.b!);
    await t.choose('hide');
    expect(t.engine.edits).toEqual([{ kind: 'channel', change: { op: 'hide', item: { key: 'b', src: 's1', kind: 'live', normName: 'beta', group: 'News', epgId: 'b.tv', added: 5_000 } } }]);
    expect(t.engine.stored()).toEqual(['b:h']);
    expect(t.editor.screen.value).toBeNull();
    expect(t.closed).toHaveBeenCalledTimes(1);
    expect(t.changed).toHaveBeenCalledTimes(1);
    expect(t.at()).toBe('player · actions 0');
  });

  it('shows a hidden channel again, and undoes every change, each by its key', async () => {
    const engine = new FakeEngine();
    engine.doc = { ...engine.doc, channelEdits: [edit('b', { hidden: true, number: 9 })] } as ProfileDoc;
    const t = await over(ITEMS.b!, engine);
    await t.choose('show');
    expect(t.engine.edits[0]).toEqual({ kind: 'channel', change: { op: 'show', key: 'b' } });
    expect(t.engine.stored()).toEqual(['b:#9']);
    t.editor.openOver(ITEMS.b!, t.closed, t.stop);
    await flush();
    expect(t.editor.actions.value).toContain('reset');
    await t.choose('reset');
    expect(t.engine.edits[1]).toEqual({ kind: 'channel', change: { op: 'reset', key: 'b' } });
    expect(t.engine.stored()).toEqual([]);
    expect(t.changed).toHaveBeenCalledTimes(2);
  });

  it('keeps the menu up and says so when the worker refuses an edit, or fails', async () => {
    // The changed channels' cap: the worker refuses a new one.
    const full: ChannelEdit[] = [];
    for (let i = 0; i < MAX_CHANNEL_EDITS; i += 1) full.push(edit(`k${i}`, { hidden: true }));
    const engine = withEdits(...full);
    const t = await over(ITEMS.b!, engine);
    await t.choose('hide');
    expect(t.engine.edits).toHaveLength(1);
    expect(t.editor.problem.value).toBe('refused');
    expect(t.editor.screen.value).not.toBeNull();
    expect(t.closed).not.toHaveBeenCalled();
    expect(t.changed).not.toHaveBeenCalled();
    engine.failEdit = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await t.choose('rename');
    expect(t.editor.problem.value).toBeNull();
    t.editor.setText('X');
    t.nav.top.focus('actions', FORM_SAVE);
    await t.press('OK');
    expect(t.editor.problem.value).toBe('refused');
    expect(t.at()).toBe(`${EDIT_RENAME} · actions 0`);
    expect(t.editor.pending.value).toBe(0);
  });

  it('waits for an edit on its way: OK does nothing meanwhile; one that lands after Back still tells the live screen', async () => {
    const engine = new FakeEngine();
    engine.hold.add('edit');
    const t = await over(ITEMS.b!, engine);
    await t.choose('hide');
    expect(t.editor.pending.value).toBe(1);
    await t.press('OK');
    expect(t.engine.edits).toHaveLength(1);
    await t.press('BACK');
    expect(t.closed).toHaveBeenCalledTimes(1);
    engine.release('edit');
    await flush();
    expect(t.changed).toHaveBeenCalledTimes(1);
    expect(t.closed).toHaveBeenCalledTimes(1);
    expect(t.editor.problem.value).toBeNull();
    expect(t.editor.pending.value).toBe(0);
  });

  it('drops a refusal that lands after the menu closed', async () => {
    const engine = new FakeEngine();
    engine.hold.add('edit');
    engine.doc = { ...engine.doc, channelEdits: [edit('b', { hidden: true })] } as ProfileDoc;
    const t = await over(ITEMS.b!, engine);
    await t.choose('show');
    t.editor.close();
    engine.failEdit = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.release('edit');
    await flush();
    expect(t.editor.problem.value).toBeNull();
  });

  describe('Rename', () => {
    it('starts with the name on show; OK on the field opens the keyboard; Save renames, trimmed', async () => {
      const t = await over(ITEMS.b!);
      await t.choose('rename');
      expect(t.at()).toBe(`${EDIT_RENAME} · field 0`);
      expect(t.editor.text.value).toBe('Beta');
      await t.press('OK');
      expect(t.find).toHaveBeenCalledWith(CHANNEL_NAME_FIELD);
      expect(t.editor.editor.editing.value).toBe(CHANNEL_NAME_FIELD);
      t.editor.editor.field(CHANNEL_NAME_FIELD).onEditBlur();
      t.editor.setText('  My Beta ');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.engine.edits).toEqual([{ kind: 'channel', change: { op: 'rename', item: expect.objectContaining({ key: 'b', normName: 'beta' }), name: 'My Beta' } }]);
      expect(t.engine.stored()).toEqual(['b:n=My Beta']);
      expect(t.at()).toBe('player · actions 0');
      expect(t.closed).toHaveBeenCalledTimes(1);
      expect(t.changed).toHaveBeenCalledTimes(1);
    });

    it('makes no edit for the name on show, or empty with no name of the user’s; empty with one is the provider’s again', async () => {
      const engine = new FakeEngine();
      const t = await over(ITEMS.b!, engine);
      await t.choose('rename');
      t.editor.setText(' Beta ');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.engine.edits).toEqual([]);
      expect(t.editor.screen.value).toBeNull();
      expect(t.closed).toHaveBeenCalledTimes(1);
      t.editor.openOver(ITEMS.b!, t.closed, t.stop);
      await flush();
      await t.choose('rename');
      t.editor.setText('  ');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.engine.edits).toEqual([]);
      engine.doc = { ...engine.doc, channelEdits: [edit('b', { name: 'Beta' })] } as ProfileDoc;
      t.editor.openOver(ITEMS.b!, t.closed, t.stop);
      await flush();
      await t.choose('rename');
      t.editor.setText('');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.engine.edits).toEqual([{ kind: 'channel', change: { op: 'rename', item: expect.objectContaining({ key: 'b' }), name: null } }]);
      expect(t.engine.stored()).toEqual([]);
    });

    it('goes back to the menu on Cancel and on Back, with nothing saved', async () => {
      const t = await over(ITEMS.b!);
      await t.choose('rename');
      t.editor.setText('Other');
      t.nav.top.focus('actions', FORM_CANCEL);
      await t.press('OK');
      expect(t.at()).toBe(`${EDIT_SCREEN} · actions 0`);
      await t.choose('rename');
      expect(t.editor.text.value).toBe('Beta');
      await t.press('BACK');
      expect(t.at()).toBe(`${EDIT_SCREEN} · actions 0`);
      expect(t.engine.edits).toEqual([]);
      expect(t.closed).not.toHaveBeenCalled();
    });

    it('stays up and says so when the worker refuses it', async () => {
      const engine = new FakeEngine();
      engine.failEdit = true;
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const t = await over(ITEMS.b!, engine);
      await t.choose('rename');
      t.editor.setText('New');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.at()).toBe(`${EDIT_RENAME} · actions 0`);
      expect(t.editor.problem.value).toBe('refused');
      // Back to the menu: the word goes.
      await t.press('BACK');
      expect(t.editor.problem.value).toBeNull();
    });
  });

  describe('Channel number', () => {
    it('starts empty with no number of the user’s, or with it; the remote’s digits type, the first in its place', async () => {
      const engine = new FakeEngine();
      const t = await over(ITEMS.b!, engine);
      await t.choose('number');
      expect(t.at()).toBe(`${EDIT_NUMBER} · field 0`);
      expect(t.editor.text.value).toBe('');
      await t.press('DIGIT_4', 'DIGIT_2');
      expect(t.editor.text.value).toBe('42');
      await t.press('BACK');
      engine.doc = { ...engine.doc, channelEdits: [edit('b', { number: 77 })] } as ProfileDoc;
      await t.press('BACK');
      t.editor.openOver(ITEMS.b!, t.closed, t.stop);
      await flush();
      await t.choose('number');
      expect(t.editor.text.value).toBe('77');
      await t.press('DIGIT_5');
      expect(t.editor.text.value).toBe('5');
      await t.press('DIGIT_0', 'DIGIT_0', 'DIGIT_1');
      expect(t.editor.text.value).toBe('5001');
      // A fifth digit starts a new number.
      await t.press('DIGIT_9');
      expect(t.editor.text.value).toBe('9');
      // On the buttons too.
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('DIGIT_3');
      expect(t.editor.text.value).toBe('93');
      // OK on the field opens the TV's number keyboard; typed there, the next digit goes on from it.
      t.nav.top.focus('field', 0);
      await t.press('OK');
      expect(t.find).toHaveBeenCalledWith(CHANNEL_NUMBER_FIELD);
      t.editor.editor.field(CHANNEL_NUMBER_FIELD).onEditBlur();
      t.editor.setText('12');
      await t.press('DIGIT_3');
      expect(t.editor.text.value).toBe('123');
    });

    it('saves the number with one edit; the stored one again is no edit; empty is the channel’s own again', async () => {
      const engine = new FakeEngine();
      const t = await over(ITEMS.b!, engine);
      await t.choose('number');
      await t.press('DIGIT_4', 'DIGIT_2');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.engine.edits).toEqual([{ kind: 'channel', change: { op: 'number', item: expect.objectContaining({ key: 'b', added: 5_000 }), number: 42 } }]);
      expect(t.engine.stored()).toEqual(['b:#42']);
      expect(t.closed).toHaveBeenCalledTimes(1);
      t.editor.openOver(ITEMS.b!, t.closed, t.stop);
      await flush();
      await t.choose('number');
      expect(t.editor.text.value).toBe('42');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.engine.edits).toHaveLength(1);
      expect(t.editor.screen.value).toBeNull();
      t.editor.openOver(ITEMS.b!, t.closed, t.stop);
      await flush();
      await t.choose('number');
      t.editor.setText('');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.engine.edits[1]).toEqual({ kind: 'channel', change: { op: 'number', item: expect.objectContaining({ key: 'b' }), number: null } });
      expect(t.engine.stored()).toEqual([]);
      // Empty with no number of the user’s: nothing to change.
      t.editor.openOver(ITEMS.b!, t.closed, t.stop);
      await flush();
      await t.choose('number');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.engine.edits).toHaveLength(2);
      expect(t.editor.screen.value).toBeNull();
    });

    it('says a wrong number is one and saves nothing; the next digit starts a new number and takes the word away', async () => {
      const t = await over(ITEMS.b!);
      await t.choose('number');
      await t.press('DIGIT_0');
      t.nav.top.focus('actions', FORM_SAVE);
      await t.press('OK');
      expect(t.editor.problem.value).toBe('number');
      expect(t.engine.edits).toEqual([]);
      expect(t.at()).toBe(`${EDIT_NUMBER} · actions 0`);
      await t.press('DIGIT_7');
      expect(t.editor.text.value).toBe('7');
      expect(t.editor.problem.value).toBeNull();
      t.editor.setText('12x');
      await t.press('OK');
      expect(t.editor.problem.value).toBe('number');
      await t.press('BACK');
      expect(t.editor.problem.value).toBeNull();
    });

    it('leaves the digits to the rename form’s screens and the menu (number entry is the player’s)', async () => {
      const t = await over(ITEMS.b!);
      await t.press('DIGIT_4');
      expect(t.at()).toBe(`${EDIT_SCREEN} · actions 0`);
      await t.choose('rename');
      await t.press('DIGIT_4');
      expect(t.editor.text.value).toBe('Beta');
    });
  });

  it('closes its form and itself when the host closes it (the player closing, or a card)', async () => {
    const t = await over(ITEMS.b!);
    await t.choose('number');
    t.editor.close();
    expect(t.at()).toBe('player · actions 0');
    expect(t.editor.screen.value).toBeNull();
    expect(t.editor.target.value).toBeNull();
    expect(t.closed).toHaveBeenCalledTimes(1);
    t.editor.close();
    expect(t.closed).toHaveBeenCalledTimes(1);
  });

  it('offers a channel not in the sources only "Undo my changes"', async () => {
    const t = setup();
    const done = vi.fn();
    t.engine.doc = { ...t.engine.doc, channelEdits: [edit('z', { hidden: true })] } as ProfileDoc;
    t.editor.open({ key: 'z', item: null, edit: edit('z', { hidden: true }), name: 'z stored' }, done);
    expect(t.editor.actions.value).toEqual(['reset', 'cancel']);
    expect(t.editor.over.value).toBe(false);
    await t.choose('reset');
    expect(t.engine.stored()).toEqual([]);
    expect(done).toHaveBeenCalledTimes(1);
    expect(t.closed).not.toHaveBeenCalled();
  });
});

function pageSetup(engine = new FakeEngine()) {
  const t = setup(engine);
  const page = createEditedChannels({ nav: t.nav, engine, editor: t.editor, changed: t.changed });
  return { ...t, page };
}

async function page(engine = new FakeEngine()) {
  const t = pageSetup(engine);
  t.page.open();
  await flush();
  return t;
}

function withEdits(...edits: ChannelEdit[]): FakeEngine {
  const engine = new FakeEngine();
  engine.doc = { ...engine.doc, channelEdits: edits } as ProfileDoc;
  return engine;
}

describe('Settings › "Channels"', () => {
  it('reads the switch and the changed channels, each by key, and puts the switch first', async () => {
    const t = await page(withEdits(edit('a', { name: 'Alpha' }), edit('z', { hidden: true })));
    expect(t.at()).toBe(`${CHANNELS_SCREEN} · rows ${CLEAN_ROW}`);
    expect(t.page.status.value).toBe('ready');
    expect(t.page.clean.value).toBe(false);
    expect(t.page.rows.value.map((r) => [r.key, r.name, r.item === null])).toEqual([
      ['a', 'Alpha', false],
      ['z', 'z stored', true],
    ]);
    expect(t.nav.top.zone('rows')).toMatchObject({ count: 3 });
    expect(t.engine.keyCalls).toEqual([{ keys: ['a', 'z'], kind: 'live', sources: ['s1'], limit: 2 }]);
    expect(t.page.pending.value).toBe(0);
  });

  it('reads the channels 100 keys a call', async () => {
    const many: ChannelEdit[] = [];
    for (let i = 0; i < 150; i += 1) many.push(edit(`k${i}`, { hidden: true }));
    const t = await page(withEdits(...many));
    expect(t.engine.keyCalls.map((c) => [c.keys.length, c.limit, c.keys[0]])).toEqual([
      [100, 100, 'k0'],
      [50, 50, 'k100'],
    ]);
    expect(t.page.rows.value).toHaveLength(150);
  });

  it('has only the switch with no changed channel, and says why there are no rows when the read fails', async () => {
    const t = await page();
    expect(t.page.rows.value).toEqual([]);
    expect(t.nav.top.zone('rows')).toMatchObject({ count: 1 });
    expect(t.engine.keyCalls).toEqual([]);
    const engine = new FakeEngine();
    engine.failRead = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const u = await page(engine);
    expect(u.page.status.value).toBe('failed');
    expect(u.page.clean.value).toBeNull();
  });

  it('switches "Clean channel names" with one edit, then the live screen and the page read again', async () => {
    const t = await page();
    await t.press('OK');
    expect(t.engine.edits).toEqual([{ kind: 'cleanNames', on: true }]);
    expect(t.page.clean.value).toBe(true);
    expect(t.changed).toHaveBeenCalledTimes(1);
    await t.press('OK');
    expect(t.engine.edits[1]).toEqual({ kind: 'cleanNames', on: false });
    expect(t.page.clean.value).toBe(false);
    expect(t.page.failed.value).toBe(false);
  });

  it('says a switch that didn’t take, and takes one OK at a time', async () => {
    const engine = new FakeEngine();
    engine.hold.add('edit');
    const t = await page(engine);
    await t.press('OK', 'OK');
    expect(t.engine.edits).toHaveLength(1);
    engine.failEdit = true;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.release('edit');
    await flush();
    expect(t.page.failed.value).toBe(true);
    expect(t.page.clean.value).toBe(false);
    expect(t.changed).not.toHaveBeenCalled();
    engine.hold.clear();
    engine.failEdit = false;
    // Refused (the same value: as if another screen had changed it).
    engine.doc = { ...engine.doc, cleanNames: true } as ProfileDoc;
    await t.press('OK');
    expect(t.page.failed.value).toBe(true);
    // Opened again: the word goes.
    await t.press('BACK');
    t.page.open();
    expect(t.page.failed.value).toBe(false);
  });

  it('opens "Edit channel" over the page on a row; after an edit the rows read again, the focus on the channel', async () => {
    const t = await page(withEdits(edit('a', { name: 'Alpha' }), edit('b', { hidden: true }), edit('c', { number: 3 })));
    await t.press('DOWN', 'DOWN');
    await t.press('OK');
    expect(t.at()).toBe(`${EDIT_SCREEN} · actions 0`);
    expect(t.editor.target.value!.key).toBe('b');
    expect(t.editor.actions.value).toEqual(['rename', 'number', 'show', 'reset', 'cancel']);
    await t.choose('number');
    await t.press('DIGIT_8');
    t.nav.top.focus('actions', FORM_SAVE);
    await t.press('OK');
    expect(t.at()).toBe(`${CHANNELS_SCREEN} · rows 2`);
    expect(t.page.rows.value[1]!.edit).toEqual(edit('b', { hidden: true, number: 8 }));
    expect(t.changed).toHaveBeenCalledTimes(1);
    // Undo: the row goes, the focus stays on its place (the next channel).
    await t.press('OK');
    await t.choose('reset');
    expect(t.page.rows.value.map((r) => r.key)).toEqual(['a', 'c']);
    expect(t.at()).toBe(`${CHANNELS_SCREEN} · rows 2`);
    expect(t.page.pending.value).toBe(0);
  });

  it('opens nothing while a read is out, and drops an older read that lands late', async () => {
    const engine = withEdits(edit('a', { name: 'Alpha' }));
    engine.hold.add('keys');
    const t = pageSetup(engine);
    t.page.open();
    await flush();
    await t.press('DOWN');
    await t.press('OK');
    expect(t.editor.screen.value).toBeNull();
    // A second read (the page opened again): the first one’s answer comes after it and is dropped.
    engine.doc = { ...engine.doc, channelEdits: [edit('b', { hidden: true })] } as ProfileDoc;
    await t.press('BACK');
    t.page.open();
    await flush();
    const [first, second] = engine.held.keys.splice(0);
    second!.go();
    await flush();
    expect(t.page.rows.value.map((r) => r.key)).toEqual(['b']);
    first!.go();
    await flush();
    expect(t.page.rows.value.map((r) => r.key)).toEqual(['b']);
  });

  it('pops itself on Back, and reads nothing more once disposed', async () => {
    const engine = withEdits(edit('a', { name: 'Alpha' }));
    const t = await page(engine);
    await t.press('BACK');
    expect(t.page.screen.value).toBeNull();
    expect(t.at()).toBe('player · actions 0');
    engine.hold.add('read');
    t.page.open();
    t.page.dispose();
    engine.doc = { ...engine.doc, channelEdits: [] } as ProfileDoc;
    engine.release('read');
    await flush();
    expect(t.page.rows.value.map((r) => r.key)).toEqual(['a']);
    const top = t.nav.top;
    t.page.open();
    expect(t.nav.top).toBe(top);
  });
});
