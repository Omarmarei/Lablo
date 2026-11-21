// The changed channels (RELAY step 36a): the checks on read (channel-edits.ts), the edits and the
// re-match (channel-changes.ts), and their place in `applyProfileEdit`.

import type { CatalogItem } from '@lablo/core';
import { describe, expect, it } from 'vitest';
import type { ChannelChange } from './channel-changes';
import { applyChannelChange } from './channel-changes';
import { relinkChannelEdits, trackedRefs } from './channel-relink';
import type { ChannelEdit } from './channel-edits';
import { CHANNEL_NAME_MAX, CHANNEL_NUMBER_MAX, MAX_CHANNEL_EDITS, channelEditsOf, cleanNamesOn, isChannelName, isChannelNumber } from './channel-edits';
import type { FavouriteItem } from './favourite-edits';
import type { CatalogView } from './favourites';
import { FavouriteMatcher, MISSING_KEEP_MS, reconcileFavourites } from './favourites';
import type { FavouriteRef, ProfileDoc } from './profile';
import { applyProfileEdit, emptyProfile } from './profile';
import { item as catalogItem } from './test-support';

const NOW = Date.UTC(2026, 10, 21, 12);
const key = (n: number): string => `x:s1:live:${n}`;
const item = (n: number, extra: Partial<FavouriteItem> = {}): FavouriteItem => ({ key: key(n), src: 's1', kind: 'live', normName: `channel ${n}`, added: 100 + n, ...extra });
const ref = (n: number, extra: Partial<FavouriteRef> = {}): FavouriteRef => ({ ...item(n), missingSince: null, ...extra });
const edit = (n: number, changes: Partial<ChannelEdit>, extra: Partial<FavouriteRef> = {}): ChannelEdit => ({ ...ref(n, extra), ...changes });
const docOf = (edits: unknown, more: Partial<ProfileDoc> = {}): ProfileDoc => ({ ...emptyProfile(), channelEdits: edits as ChannelEdit[], ...more });
const change = (edits: ChannelEdit[], c: ChannelChange): ChannelEdit[] | null => applyChannelChange(docOf(edits), c);

describe('channel-edits: the checks on read', () => {
  it('reads none from a document without them, or from what is not a document', () => {
    expect(channelEditsOf(emptyProfile())).toEqual([]);
    for (const doc of [null, undefined, 3, 'x', []]) expect(channelEditsOf(doc)).toEqual([]);
    for (const stored of [null, {}, 'e', 7, { length: 1, 0: edit(1, { hidden: true }) }]) expect(channelEditsOf({ channelEdits: stored })).toEqual([]);
  });

  it('keeps the entries in their order, each copied field by field, and leaves out what is not a changed live channel', () => {
    const hidden = edit(1, { hidden: true }, { group: 'News', epgId: 'one.ae' });
    const named = edit(2, { name: 'Two' }, { epgId: null, missingSince: NOW });
    const numbered = edit(3, { number: 3 });
    const stored: unknown[] = [
      null,
      'e',
      { ...edit(4, { hidden: true }), key: '' },
      { ...edit(4, { hidden: true }), key: 4 },
      { ...edit(4, { hidden: true }), src: '' },
      { ...edit(4, { hidden: true }), kind: 'movie' },
      { ...edit(4, { hidden: true }), normName: 4 },
      { ...edit(4, { hidden: true }), group: 4 },
      { ...edit(4, { hidden: true }), epgId: 4 },
      { ...edit(4, { hidden: true }), added: Number.NaN },
      { ...edit(4, { hidden: true }), added: Infinity },
      { ...edit(4, { hidden: true }), added: '1' },
      { ...edit(4, { hidden: true }), missingSince: '1' },
      { ...edit(4, { hidden: true }), missingSince: undefined },
      // No change at all, or none that is one.
      ref(5),
      { ...ref(5), hidden: false, name: '', number: 0 },
      hidden,
      { ...named, extra: 'dropped' },
      numbered,
      // A repeated key: the first entry stands.
      edit(1, { name: 'Again' }),
    ];
    expect(channelEditsOf({ channelEdits: stored })).toEqual([hidden, named, numbered]);
    expect(Object.keys(channelEditsOf({ channelEdits: [{ ...named, extra: 1 }] })[0]!)).toEqual(['key', 'src', 'kind', 'normName', 'added', 'missingSince', 'epgId', 'name']);
  });

  it('leaves a change that is not one out of its entry, and the entry out when none is left', () => {
    const stored = [
      { ...edit(1, { hidden: true }), name: 'n'.repeat(CHANNEL_NAME_MAX + 1), number: 1.5 },
      { ...edit(2, { name: 'Two' }), hidden: 'yes', number: CHANNEL_NUMBER_MAX + 1 },
      { ...edit(3, { number: 3 }), name: 7 },
      { ...ref(4), hidden: 1, name: null, number: '4' },
    ];
    expect(channelEditsOf({ channelEdits: stored })).toEqual([edit(1, { hidden: true }), edit(2, { name: 'Two' }), edit(3, { number: 3 })]);
  });

  it("leaves a number an earlier entry holds out of a later one: a number is one channel's", () => {
    const stored = [edit(1, { number: 7 }), edit(2, { number: 7, hidden: true }), edit(3, { number: 7 }), edit(4, { number: 8 })];
    expect(channelEditsOf({ channelEdits: stored })).toEqual([edit(1, { number: 7 }), edit(2, { hidden: true }), edit(4, { number: 8 })]);
  });

  it('reads keys and numbers whatever an object inherits', () => {
    const stored = [
      { ...edit(1, { hidden: true }), key: 'constructor' },
      { ...edit(2, { hidden: true }), key: 'toString' },
      { ...edit(3, { hidden: true }), key: '__proto__' },
      { ...edit(4, { hidden: true }), key: '__proto__' },
      { ...edit(5, { hidden: true }), key: 'constructor' },
    ];
    expect(channelEditsOf({ channelEdits: stored }).map((e) => [e.key, e.added])).toEqual([
      ['constructor', 101],
      ['toString', 102],
      ['__proto__', 103],
    ]);
  });

  it('reads at most MAX_CHANNEL_EDITS entries, the left-out ones not counted', () => {
    const stored: unknown[] = [null, ref(0)];
    for (let n = 1; n <= MAX_CHANNEL_EDITS + 5; n += 1) stored.push(edit(n, { hidden: true }));
    const read = channelEditsOf({ channelEdits: stored });
    expect(read).toHaveLength(MAX_CHANNEL_EDITS);
    expect(read[MAX_CHANNEL_EDITS - 1]!.key).toBe(key(MAX_CHANNEL_EDITS));
  });

  it('checks names and numbers at their bounds', () => {
    expect([isChannelName('n'), isChannelName('n'.repeat(CHANNEL_NAME_MAX)), isChannelName(''), isChannelName('n'.repeat(CHANNEL_NAME_MAX + 1)), isChannelName(5), isChannelName(['n'])]).toEqual([true, true, false, false, false, false]);
    expect([1, CHANNEL_NUMBER_MAX, 0, CHANNEL_NUMBER_MAX + 1, 2.5, -3, Number.NaN, '5'].map(isChannelNumber)).toEqual([true, true, false, false, false, false, false, false]);
    expect(CHANNEL_NUMBER_MAX).toBe(9999);
  });

  it('reads "Clean channel names" as on only for `true`', () => {
    expect(cleanNamesOn({ cleanNames: true })).toBe(true);
    for (const doc of [emptyProfile(), { cleanNames: 'true' }, { cleanNames: 1 }, { cleanNames: false }, null, 'x']) expect(cleanNamesOn(doc)).toBe(false);
  });
});

describe('channel-changes: hide and show', () => {
  it('hides a channel: a new entry at the end, made from the item field by field', () => {
    const before = [edit(1, { name: 'One' })];
    const after = change(before, { op: 'hide', item: { ...item(2, { group: 'News', epgId: null }), extra: 1 } as FavouriteItem })!;
    expect(after).toEqual([before[0], edit(2, { hidden: true }, { group: 'News', epgId: null })]);
    expect('extra' in after[1]!).toBe(false);
  });

  it("hides a changed channel in its place, keeping its ref (its add time) and its other changes", () => {
    const before = [edit(1, { name: 'One' }), edit(2, { number: 2 }, { added: 5, missingSince: NOW })];
    expect(change(before, { op: 'hide', item: item(2, { added: 999 }) })).toEqual([before[0], edit(2, { number: 2, hidden: true }, { added: 5, missingSince: NOW })]);
  });

  it('refuses to hide a hidden channel again', () => {
    expect(change([edit(1, { hidden: true })], { op: 'hide', item: item(1) })).toBeNull();
  });

  it('shows a hidden channel again: its entry goes when nothing else is changed', () => {
    expect(change([edit(1, { hidden: true }), edit(2, { hidden: true, name: 'Two' })], { op: 'show', key: key(1) })).toEqual([edit(2, { hidden: true, name: 'Two' })]);
    expect(change([edit(1, { hidden: true }), edit(2, { hidden: true, name: 'Two' })], { op: 'show', key: key(2) })).toEqual([edit(1, { hidden: true }), edit(2, { name: 'Two' })]);
  });

  it('refuses to show a channel that is not hidden, or has no entry', () => {
    expect(change([edit(1, { name: 'One' })], { op: 'show', key: key(1) })).toBeNull();
    expect(change([edit(1, { hidden: true })], { op: 'show', key: key(2) })).toBeNull();
  });
});

describe('channel-changes: rename', () => {
  it('names a channel (trimmed), and renames it', () => {
    const named = change([], { op: 'rename', item: item(1), name: '  My News  ' })!;
    expect(named).toEqual([edit(1, { name: 'My News' })]);
    expect(change(named, { op: 'rename', item: item(1), name: 'Other' })).toEqual([edit(1, { name: 'Other' })]);
  });

  it("gives the provider's name back with null: the entry goes when nothing else is changed", () => {
    expect(change([edit(1, { name: 'One' })], { op: 'rename', item: item(1), name: null })).toEqual([]);
    expect(change([edit(1, { name: 'One', number: 4 })], { op: 'rename', item: item(1), name: null })).toEqual([edit(1, { number: 4 })]);
  });

  it('refuses the same name, null with no name, and names that are not one', () => {
    expect(change([edit(1, { name: 'One' })], { op: 'rename', item: item(1), name: ' One ' })).toBeNull();
    expect(change([edit(1, { hidden: true })], { op: 'rename', item: item(1), name: null })).toBeNull();
    expect(change([], { op: 'rename', item: item(1), name: null })).toBeNull();
    for (const name of ['', '   ', 'n'.repeat(CHANNEL_NAME_MAX + 1), 5 as unknown as string, undefined as unknown as string]) {
      expect(change([], { op: 'rename', item: item(1), name })).toBeNull();
    }
    expect(change([], { op: 'rename', item: item(1), name: ` ${'n'.repeat(CHANNEL_NAME_MAX)} ` })).toEqual([edit(1, { name: 'n'.repeat(CHANNEL_NAME_MAX) })]);
  });
});

describe('channel-changes: numbers', () => {
  it('numbers a channel, and numbers it again', () => {
    const numbered = change([], { op: 'number', item: item(1), number: 101 })!;
    expect(numbered).toEqual([edit(1, { number: 101 })]);
    expect(change(numbered, { op: 'number', item: item(1), number: 1 })).toEqual([edit(1, { number: 1 })]);
    expect(change([], { op: 'number', item: item(1), number: CHANNEL_NUMBER_MAX })).toEqual([edit(1, { number: CHANNEL_NUMBER_MAX })]);
  });

  it("gives the provider's number back with null", () => {
    expect(change([edit(1, { number: 5 })], { op: 'number', item: item(1), number: null })).toEqual([]);
    expect(change([edit(1, { number: 5, hidden: true })], { op: 'number', item: item(1), number: null })).toEqual([edit(1, { hidden: true })]);
  });

  it('refuses the same number, null with no number, and numbers that are not one', () => {
    expect(change([edit(1, { number: 5 })], { op: 'number', item: item(1), number: 5 })).toBeNull();
    expect(change([edit(1, { name: 'One' })], { op: 'number', item: item(1), number: null })).toBeNull();
    for (const number of [0, CHANNEL_NUMBER_MAX + 1, 2.5, -1, Number.NaN, '5' as unknown as number, undefined as unknown as number]) {
      expect(change([], { op: 'number', item: item(1), number })).toBeNull();
    }
  });

  it("moves a number another channel has: that one goes back to its own, or out with nothing else changed", () => {
    const before = [edit(1, { number: 7, name: 'One' }), edit(2, { number: 8 }), edit(3, { hidden: true })];
    expect(change(before, { op: 'number', item: item(3), number: 7 })).toEqual([edit(1, { name: 'One' }), edit(2, { number: 8 }), edit(3, { hidden: true, number: 7 })]);
    expect(change(before, { op: 'number', item: item(4), number: 8 })).toEqual([before[0], before[2], edit(4, { number: 8 })]);
    // From a later entry to an earlier one.
    expect(change([edit(1, { hidden: true }), edit(2, { number: 9 })], { op: 'number', item: item(1), number: 9 })).toEqual([edit(1, { hidden: true, number: 9 })]);
  });
});

describe('channel-changes: reset, refusals and caps', () => {
  it("takes every change of a channel away", () => {
    expect(change([edit(1, { hidden: true, name: 'One', number: 1 }), edit(2, { hidden: true })], { op: 'reset', key: key(1) })).toEqual([edit(2, { hidden: true })]);
    expect(change([edit(2, { hidden: true })], { op: 'reset', key: key(1) })).toBeNull();
  });

  it('refuses an item that is not one, one that is not a live channel, and an op this version does not know', () => {
    const bad = [null, { ...item(1), key: '' }, { ...item(1), added: 'x' }, { ...item(1), kind: 'movie' }, { ...item(1), kind: 'series' }] as unknown as FavouriteItem[];
    for (const it of bad) {
      expect(change([], { op: 'hide', item: it })).toBeNull();
      expect(change([], { op: 'rename', item: it, name: 'X' })).toBeNull();
      expect(change([], { op: 'number', item: it, number: 3 })).toBeNull();
    }
    expect(change([edit(1, { hidden: true })], { op: 'show', key: 5 as unknown as string })).toBeNull();
    expect(change([edit(1, { hidden: true })], { op: 'unhide', key: key(1), item: item(1) } as unknown as ChannelChange)).toBeNull();
    expect(change([edit(1, { hidden: true })], { op: 'swap', item: item(1), number: 3, name: 'X' } as unknown as ChannelChange)).toBeNull();
  });

  it('refuses a new entry past MAX_CHANNEL_EDITS, and still changes the entries it has', () => {
    const full: ChannelEdit[] = [];
    for (let n = 1; n <= MAX_CHANNEL_EDITS; n += 1) full.push(edit(n, { hidden: true }));
    expect(change(full, { op: 'hide', item: item(MAX_CHANNEL_EDITS + 1) })).toBeNull();
    expect(change(full, { op: 'rename', item: item(MAX_CHANNEL_EDITS + 1), name: 'X' })).toBeNull();
    expect(change(full, { op: 'number', item: item(MAX_CHANNEL_EDITS + 1), number: 1 })).toBeNull();
    expect(change(full, { op: 'rename', item: item(5), name: 'Five' })![4]).toEqual(edit(5, { hidden: true, name: 'Five' }));
    expect(change(full.slice(1), { op: 'hide', item: item(MAX_CHANNEL_EDITS + 1) })).toHaveLength(MAX_CHANNEL_EDITS);
  });

  it('reads the stored entries through their checks', () => {
    const stored = [null, edit(1, { hidden: true }), edit(1, { name: 'Twice' })];
    expect(applyChannelChange(docOf(stored), { op: 'rename', item: item(1), name: 'One' })).toEqual([edit(1, { hidden: true, name: 'One' })]);
  });
});

describe('applyProfileEdit: the channel and cleanNames edits (step 36a)', () => {
  it('writes the changed channels; the last one gone takes the field away', () => {
    const hidden = applyProfileEdit(emptyProfile(), { kind: 'channel', change: { op: 'hide', item: item(1) } })!;
    expect(hidden.channelEdits).toEqual([edit(1, { hidden: true })]);
    const shown = applyProfileEdit(hidden, { kind: 'channel', change: { op: 'show', key: key(1) } })!;
    expect('channelEdits' in shown).toBe(false);
    expect(applyProfileEdit(emptyProfile(), { kind: 'channel', change: { op: 'show', key: key(1) } })).toBeNull();
  });

  it('turns "Clean channel names" on and off; the same, or not a boolean, changes nothing', () => {
    const on = applyProfileEdit(emptyProfile(), { kind: 'cleanNames', on: true })!;
    expect(on.cleanNames).toBe(true);
    expect(applyProfileEdit(on, { kind: 'cleanNames', on: true })).toBeNull();
    const off = applyProfileEdit(on, { kind: 'cleanNames', on: false })!;
    expect('cleanNames' in off).toBe(false);
    expect(applyProfileEdit(emptyProfile(), { kind: 'cleanNames', on: false })).toBeNull();
    expect(applyProfileEdit(emptyProfile(), { kind: 'cleanNames', on: 'yes' as unknown as boolean })).toBeNull();
  });
});

// The re-match: a new generation as the ingest sees it.
const live = (id: number, name: string, group = 'G', epgId: string | null = null): CatalogItem => ({ ...catalogItem('tv', 'live', id, name, group), epgId });
const tvRef = (i: CatalogItem, extra: Partial<FavouriteRef> = {}): FavouriteRef => ({ key: i.key, src: 'tv', kind: 'live', normName: i.normName, group: i.group, epgId: i.epgId, added: 1, missingSince: null, ...extra });

/** Runs a refresh's re-match as the ingest does: the favourites, then the changed channels. */
function refresh(favourites: FavouriteRef[], edits: ChannelEdit[], items: CatalogItem[], now = NOW, kinds?: ('live' | 'movie' | 'series')[]) {
  const m = new FavouriteMatcher('tv', trackedRefs(favourites, edits));
  for (const i of items) m.see(i);
  const view: CatalogView = { has: (f) => m.saw(f.key) ?? false, byName: (k, n) => m.byName(k, n), byEpgId: (k, e) => m.byEpgId(k, e) };
  const r = reconcileFavourites(favourites, 'tv', view, now, kinds);
  return { favourites: r.favourites, edits: relinkChannelEdits({ channelEdits: edits }, favourites, r.report, r.favourites, 'tv', view, now, kinds) };
}

describe('channel-changes: the refs a refresh tracks', () => {
  it('tracks the favourites, then each changed channel no favourite has', () => {
    const a = tvRef(live(1, 'A'));
    const b = tvRef(live(2, 'B'));
    const editA = { ...a, hidden: true as const };
    const editC = { ...tvRef(live(3, 'C')), name: 'See' };
    expect(trackedRefs([a, b], [editA, editC])).toEqual([a, b, editC]);
  });
});

describe('channel-changes: a refresh re-keys the changed channels (relinkChannelEdits)', () => {
  it('is null with no changed channels, or when every one is where it was', () => {
    const one = { ...tvRef(live(1, 'One')), hidden: true as const };
    expect(refresh([], [], [live(1, 'One')]).edits).toBeNull();
    expect(refresh([], [one], [live(1, 'One')]).edits).toBeNull();
    expect(refresh([tvRef(live(1, 'One'))], [one], [live(1, 'One')]).edits).toBeNull();
  });

  it('re-matches a renumbered channel by its name, its changes kept, in its place', () => {
    const a = { ...tvRef(live(1, 'Sport', 'News', 'sport.ae')), name: 'My sport', number: 5 };
    const b = { ...tvRef(live(2, 'Kids')), hidden: true as const };
    const { edits } = refresh([], [a, b], [live(1001, 'Sport', 'Sports', 'sport.ae'), live(2, 'Kids')]);
    expect(edits).toEqual([{ ...a, key: 'x:tv:live:1001', group: 'Sports' }, b]);
  });

  it('follows a favourite on the same key: re-keyed, missing, back and dropped with it', () => {
    const f = tvRef(live(1, 'Sport', 'G', 'sport.ae'));
    const e = { ...f, hidden: true as const };
    // Renumbered: the favourite and the entry move together.
    const moved = refresh([f], [e], [live(9, 'Sport', 'H', 'sport.ae')]);
    expect(moved.favourites[0]!.key).toBe('x:tv:live:9');
    expect(moved.edits).toEqual([{ ...e, key: 'x:tv:live:9', group: 'H' }]);
    // Missing.
    const missing = refresh([f], [e], []);
    expect(missing.edits).toEqual([{ ...e, missingSince: NOW }]);
    // Back.
    const gone = { ...f, missingSince: NOW - 1000 };
    expect(refresh([gone], [{ ...e, missingSince: NOW - 1000 }], [live(1, 'Sport', 'G', 'sport.ae')]).edits).toEqual([e]);
    // Dropped after 30 days, with the favourite.
    const old = { ...f, missingSince: NOW - MISSING_KEEP_MS };
    expect(refresh([old], [{ ...e, missingSince: NOW - MISSING_KEEP_MS }, { ...tvRef(live(2, 'Two')), number: 2 }], [live(2, 'Two')]).edits).toEqual([
      { ...tvRef(live(2, 'Two')), number: 2 },
    ]);
  });

  it("follows the favourite's re-match, not one of its own (once per key)", () => {
    // Two "Sport" channels: the favourite's group picks one; the entry, read with the favourite's ref, follows it.
    const f = tvRef(live(1, 'Sport', 'B'));
    const e = { ...f, group: 'A', name: 'Mine' };
    const { favourites, edits } = refresh([f], [e], [live(8, 'Sport', 'A'), live(9, 'Sport', 'B')]);
    expect(favourites[0]!.key).toBe('x:tv:live:9');
    expect(edits).toEqual([{ ...e, key: 'x:tv:live:9', group: 'B' }]);
  });

  it("marks a channel missing, gives it back, and drops it after 30 days missing", () => {
    const e = { ...tvRef(live(1, 'One')), hidden: true as const };
    expect(refresh([], [e], [live(2, 'Two')]).edits).toEqual([{ ...e, missingSince: NOW }]);
    expect(refresh([], [{ ...e, missingSince: NOW - 5 }], [live(1, 'One')]).edits).toEqual([e]);
    expect(refresh([], [{ ...e, missingSince: NOW - MISSING_KEEP_MS + 1 }], []).edits).toBeNull();
    expect(refresh([], [{ ...e, missingSince: NOW - MISSING_KEEP_MS }], []).edits).toEqual([]);
  });

  it("never re-matches to a key another entry has, or one an entry following its favourite takes", () => {
    // Entry 1 lost its channel; the only "Sport" left is channel 2, which has an entry of its own.
    const one = { ...tvRef(live(1, 'Sport')), hidden: true as const };
    const two = { ...tvRef(live(2, 'Sport')), name: 'Two' };
    expect(refresh([], [one, two], [live(2, 'Sport')]).edits).toEqual([{ ...one, missingSince: NOW }, two]);
    // Channel 3's favourite moves to 30, which entry 4 would take too.
    const f = tvRef(live(3, 'News', 'G', 'news.ae'));
    const followed = { ...f, number: 3 };
    const four = { ...tvRef(live(4, 'News', 'G')), hidden: true as const };
    const { edits } = refresh([f], [followed, four], [live(30, 'News', 'G', 'news.ae')]);
    expect(edits).toEqual([{ ...followed, key: 'x:tv:live:30' }, { ...four, missingSince: NOW }]);
  });

  it("takes its favourite's group and tvg-id: on the same key, and from a re-match", () => {
    // The same key, the favourite's ref newer than the entry's.
    const f = tvRef(live(1, 'One', 'New group', 'one.ae'));
    const e = { ...f, group: 'Old group', epgId: null, hidden: true as const };
    expect(refresh([f], [e], [live(1, 'One', 'New group', 'one.ae')]).edits).toEqual([{ ...e, group: 'New group', epgId: 'one.ae' }]);
    expect(refresh([f], [{ ...e, group: 'New group' }], [live(1, 'One', 'New group', 'one.ae')]).edits).toEqual([{ ...e, group: 'New group', epgId: 'one.ae' }]);
    expect(refresh([f], [{ ...e, epgId: 'one.ae' }], [live(1, 'One', 'New group', 'one.ae')]).edits).toEqual([{ ...e, group: 'New group', epgId: 'one.ae' }]);
    expect(refresh([f], [{ ...e, group: 'New group', epgId: 'one.ae', normName: 'old one' }], [live(1, 'One', 'New group', 'one.ae')]).edits).toEqual([{ ...e, group: 'New group', epgId: 'one.ae' }]);
    // A favourite without a group or a tvg-id leaves none on the entry, which then stays as it is.
    const bare: FavouriteRef = { key: f.key, src: 'tv', kind: 'live', normName: f.normName, added: 1, missingSince: null };
    const followed = refresh([bare], [e], [live(1, 'One', 'New group', 'one.ae')]).edits!;
    expect(followed).toEqual([{ ...bare, hidden: true }]);
    expect(Object.keys(followed[0]!)).not.toContain('group');
    expect(Object.keys(followed[0]!)).not.toContain('epgId');
    expect(refresh([bare], followed, [live(1, 'One', 'New group', 'one.ae')]).edits).toBeNull();
    // Re-matched by name to a channel that has a tvg-id now.
    const g = tvRef(live(2, 'Two'));
    expect(refresh([g], [{ ...g, number: 2 }], [live(22, 'Two', 'G', 'two.ae')]).edits).toEqual([{ ...g, key: 'x:tv:live:22', epgId: 'two.ae', number: 2 }]);
  });

  it('leaves other sources, and kinds the refresh skipped, alone', () => {
    const other = { ...tvRef(live(1, 'One')), src: 'radio', key: 'x:radio:live:1', hidden: true as const };
    expect(refresh([], [other], []).edits).toBeNull();
    const skipped = { ...tvRef(live(2, 'Two')), hidden: true as const };
    expect(refresh([], [skipped], [], NOW, ['movie']).edits).toBeNull();
  });
});
