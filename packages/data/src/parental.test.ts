// Parental control in the profile (RELAY step 38): the PIN's hash, "Lock adult groups" and the
// user's choices for single groups, read from any document and changed by the `parental` edit.

import { describe, expect, it } from 'vitest';
import type { ParentalChange, ParentalDoc } from './parental';
import { MAX_GROUP_LOCKS, PIN_LENGTH, applyParentalChange, isLockRef, isPin, lockId, parentalOf } from './parental';
import type { ProfileDoc } from './profile';
import { applyProfileEdit, emptyProfile } from './profile';

const NEWS = { src: 's1', kind: 'live' as const, name: 'News' };
const XXX = { src: 's1', kind: 'live' as const, name: 'XXX' };
const FILMS = { src: 's1', kind: 'movie' as const, name: 'News' };
const withParental = (parental: unknown): unknown => ({ v: 9, parental });

describe('isPin (step 38)', () => {
  it('takes four ASCII digits only', () => {
    expect(PIN_LENGTH).toBe(4);
    for (const pin of ['0000', '1234', '9999', '0429']) expect(isPin(pin)).toBe(true);
    for (const pin of ['', '123', '12345', '12a4', ' 123', '12.4', '١٢٣٤', '/000', ':000', 1234, null, undefined]) expect(isPin(pin), String(pin)).toBe(false);
  });
});

describe('isLockRef and lockId (step 38)', () => {
  it('takes a source, a known kind and a name', () => {
    expect(isLockRef(NEWS)).toBe(true);
    expect(isLockRef({ src: 's1', kind: 'series', name: '' })).toBe(true);
    for (const bad of [null, 'News', { src: '', kind: 'live', name: 'News' }, { src: 's1', kind: 'radio', name: 'News' }, { src: 's1', kind: 'live' }, { src: 1, kind: 'live', name: 'N' }, { src: 's1', kind: 'live', name: 3 }]) {
      expect(isLockRef(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('tells groups apart by source, kind and name', () => {
    const ids = [lockId(NEWS), lockId(FILMS), lockId(XXX), lockId({ src: 's2', kind: 'live', name: 'News' }), lockId({ src: 's1', kind: 'live', name: 'News ' })];
    expect(new Set(ids).size).toBe(ids.length);
    // A source id never holds U+0001, so a name can't pass for another source's.
    expect(lockId({ src: 's1', kind: 'live', name: `x${String.fromCharCode(1)}live` })).not.toBe(lockId({ src: 's1', kind: 'live', name: 'x' }));
  });
});

describe('parentalOf (step 38)', () => {
  it('reads no PIN, adult groups locked and no choices from a document without the field, or no document', () => {
    for (const doc of [null, undefined, 'x', {}, { v: 9 }, withParental(null), withParental('x'), withParental({})]) {
      expect(parentalOf(doc)).toEqual({ pin: null, adult: true, groups: [] });
    }
  });

  it('reads the PIN only when its salt and hash are both strings', () => {
    expect(parentalOf(withParental({ salt: 's', hash: 'h' })).pin).toEqual({ salt: 's', hash: 'h' });
    expect(parentalOf(withParental({ salt: 's' })).pin).toBeNull();
    expect(parentalOf(withParental({ hash: 'h' })).pin).toBeNull();
    expect(parentalOf(withParental({ salt: 1, hash: 'h' })).pin).toBeNull();
    expect(parentalOf(withParental({ salt: 's', hash: 2 })).pin).toBeNull();
  });

  it('reads "Lock adult groups" off only from a stored false', () => {
    expect(parentalOf(withParental({ adult: false })).adult).toBe(false);
    for (const adult of [true, 0, null, 'false']) expect(parentalOf(withParental({ adult })).adult).toBe(true);
  });

  it('reads the choices that are a group and a boolean, the first of a repeat, as copies', () => {
    const groups = [
      { ...NEWS, locked: true, extra: 1 },
      { ...XXX, locked: false },
      { ...NEWS, locked: false },
      { ...FILMS, locked: 'yes' },
      { src: 's1', kind: 'tv', name: 'A', locked: true },
      null,
      { ...FILMS, locked: true },
    ];
    const state = parentalOf(withParental({ groups }));
    expect(state.groups).toEqual([
      { ...NEWS, locked: true },
      { ...XXX, locked: false },
      { ...FILMS, locked: true },
    ]);
    expect(Object.keys(state.groups[0]!)).toEqual(['src', 'kind', 'name', 'locked']);
    expect(parentalOf(withParental({ groups: 'x' })).groups).toEqual([]);
  });

  it('reads at most MAX_GROUP_LOCKS choices', () => {
    const groups = Array.from({ length: MAX_GROUP_LOCKS + 3 }, (_, i) => ({ src: 's1', kind: 'live', name: `G${i}`, locked: true }));
    const state = parentalOf(withParental({ groups }));
    expect(state.groups).toHaveLength(MAX_GROUP_LOCKS);
    expect(state.groups[MAX_GROUP_LOCKS - 1]!.name).toBe(`G${MAX_GROUP_LOCKS - 1}`);
  });
});

describe('applyParentalChange (step 38)', () => {
  const doc = (parental?: ParentalDoc): unknown => (parental === undefined ? { v: 9 } : withParental(parental));
  const apply = (parental: ParentalDoc | undefined, change: ParentalChange) => applyParentalChange(doc(parental), change);

  it('sets a PIN, and a new one over it; the same one again changes nothing', () => {
    expect(apply(undefined, { op: 'pin', salt: 's', hash: 'h' })).toEqual({ salt: 's', hash: 'h' });
    expect(apply({ salt: 's', hash: 'h', adult: false }, { op: 'pin', salt: 't', hash: 'h' })).toEqual({ salt: 't', hash: 'h', adult: false });
    expect(apply({ salt: 's', hash: 'h' }, { op: 'pin', salt: 's', hash: 'i' })).toEqual({ salt: 's', hash: 'i' });
    expect(apply({ salt: 's', hash: 'h' }, { op: 'pin', salt: 's', hash: 'h' })).toBeUndefined();
  });

  it('refuses a PIN without a salt or a hash', () => {
    for (const change of [
      { op: 'pin', salt: '', hash: 'h' },
      { op: 'pin', salt: 's', hash: '' },
      { op: 'pin', salt: 1, hash: 'h' },
      { op: 'pin', salt: 's', hash: null },
    ]) {
      expect(apply(undefined, change as ParentalChange), JSON.stringify(change)).toBeUndefined();
    }
  });

  it('turns "Lock adult groups" off and on; the field goes when it holds nothing', () => {
    expect(apply(undefined, { op: 'adult', on: false })).toEqual({ adult: false });
    expect(apply({ adult: false }, { op: 'adult', on: true })).toBeNull();
    expect(apply({ adult: false, salt: 's', hash: 'h' }, { op: 'adult', on: true })).toEqual({ salt: 's', hash: 'h' });
    expect(apply(undefined, { op: 'adult', on: true })).toBeUndefined();
    expect(apply({ adult: false }, { op: 'adult', on: false })).toBeUndefined();
    expect(apply(undefined, { op: 'adult', on: 'no' } as unknown as ParentalChange)).toBeUndefined();
  });

  it("keeps a group's newest choice in its place, a new one at the end", () => {
    const first = apply(undefined, { op: 'group', group: NEWS, locked: true });
    expect(first).toEqual({ groups: [{ ...NEWS, locked: true }] });
    const second = apply(first!, { op: 'group', group: XXX, locked: false });
    expect(second).toEqual({ groups: [{ ...NEWS, locked: true }, { ...XXX, locked: false }] });
    expect(apply(second!, { op: 'group', group: NEWS, locked: false })).toEqual({ groups: [{ ...NEWS, locked: false }, { ...XXX, locked: false }] });
    // The same choice again: nothing.
    expect(apply(second!, { op: 'group', group: XXX, locked: false })).toBeUndefined();
    // Only the ref's own fields are kept.
    expect(apply(undefined, { op: 'group', group: { ...FILMS, extra: 2 } as typeof FILMS, locked: true })).toEqual({ groups: [{ ...FILMS, locked: true }] });
  });

  it('refuses a choice that names no group, or no boolean, and one past the cap', () => {
    for (const change of [
      { op: 'group', group: { src: '', kind: 'live', name: 'A' }, locked: true },
      { op: 'group', group: NEWS, locked: 1 },
      { op: 'group', group: null, locked: true },
      { op: 'nothing' },
    ]) {
      expect(apply(undefined, change as ParentalChange), JSON.stringify(change)).toBeUndefined();
    }
    const full: ParentalDoc = { groups: Array.from({ length: MAX_GROUP_LOCKS }, (_, i) => ({ src: 's1', kind: 'live' as const, name: `G${i}`, locked: true })) };
    expect(apply(full, { op: 'group', group: NEWS, locked: true })).toBeUndefined();
    // A choice for a group the list holds still changes at the cap.
    expect(apply(full, { op: 'group', group: { src: 's1', kind: 'live', name: 'G7' }, locked: false })!.groups![7]).toEqual({ src: 's1', kind: 'live', name: 'G7', locked: false });
  });
});

describe("the profile's parental edit (step 38)", () => {
  const base = (): ProfileDoc => emptyProfile();

  it('writes the field, and takes it away when it holds nothing', () => {
    const locked = applyProfileEdit(base(), { kind: 'parental', change: { op: 'adult', on: false } });
    expect(locked!.parental).toEqual({ adult: false });
    const back = applyProfileEdit(locked!, { kind: 'parental', change: { op: 'adult', on: true } });
    expect(back).not.toBeNull();
    expect('parental' in back!).toBe(false);
    expect(applyProfileEdit(base(), { kind: 'parental', change: { op: 'pin', salt: 's', hash: 'h' } })!.parental).toEqual({ salt: 's', hash: 'h' });
  });

  it('changes nothing for an edit that changes nothing', () => {
    expect(applyProfileEdit(base(), { kind: 'parental', change: { op: 'adult', on: true } })).toBeNull();
  });

  it('needs no migration: the profile stays at version 9', () => {
    expect(base().v).toBe(9);
    expect('parental' in base()).toBe(false);
  });
});
