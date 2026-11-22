/**
 * Parental control in the profile (RELAY step 38, its shape in RELAY.md): the PIN's hash, whether
 * adult groups are locked by themselves, and the user's own lock or opening of single groups. A
 * single live channel's lock is one of its channel edits (`ChannelEdit.locked`, channel-edits.ts).
 *
 * - **The PIN** is four digits. The profile keeps only its salt and hash (`pinHash`), set by the
 *   query worker (`QueryService.setPin`), which also checks it (`unlock`).
 * - **What is locked:** a category the user locked; else, while "Lock adult groups" is on (the
 *   default), an adult one (its name, core `adultName`, or its panel's flag, `CategoryInfo.adult`)
 *   that the user didn't open. A group's choice is kept by its source, kind and name, as hidden
 *   groups are: a provider that renames a group the user locked by hand loses that lock, and an
 *   adult group renamed is found again by its words.
 *
 * Pure, with no data module behind it: the app's main reads it through `@lablo/data/client`.
 * Written in the TV's subset (no spread, no `for…of`, no regex `.test`).
 */

import type { ContentKind } from '@lablo/core';

/** A source's category of one kind, by its name (`''`: the provider gave none). */
export type LockRef = { src: string; kind: ContentKind; name: string };

/** The user's choice for one category: locked, or opened (an adult one the user unlocked for good). */
export type GroupLock = LockRef & { locked: boolean };

/** The PIN as kept: the salt drawn when it was set, and `pinHash(salt, pin)`. */
export type ParentalPin = { salt: string; hash: string };

/** The profile's `parental` field (version 9, optional: no field is no PIN, adult groups locked, no choices). */
export type ParentalDoc = {
  /** With `hash`: the PIN (`ParentalPin`). */
  salt?: string;
  hash?: string;
  /** `false`: "Lock adult groups" is off. No field: on. */
  adult?: false;
  /** The user's choices, in the order made (a group's newest choice in its place). */
  groups?: GroupLock[];
};

/** The parental part of a profile as the app and the query worker read it (`parentalOf`). */
export type ParentalState = {
  pin: ParentalPin | null;
  /** "Lock adult groups". */
  adult: boolean;
  groups: GroupLock[];
};

/** A change to the parental part (`applyProfileEdit`'s `parental` edit). */
export type ParentalChange =
  /** A new PIN (the query worker hashes it: `QueryService.setPin`). */
  | { op: 'pin'; salt: string; hash: string }
  /** "Lock adult groups" on or off. */
  | { op: 'adult'; on: boolean }
  /** A group locked or opened by the user. */
  | { op: 'group'; group: LockRef; locked: boolean };

/** The digits of a PIN. */
export const PIN_LENGTH = 4;
/** The most group choices a profile keeps. */
export const MAX_GROUP_LOCKS = 2000;

const KINDS: readonly string[] = ['live', 'movie', 'series'];

/** `doc[name]`, or `undefined` for a document that isn't an object. */
function field(doc: unknown, name: string): unknown {
  return typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>)[name] : undefined;
}

/** Whether `value` is a PIN: `PIN_LENGTH` ASCII digits. */
export function isPin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== PIN_LENGTH) return false;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** Whether `value` names a category this version keeps a lock for: a source's id, a kind, a name. */
export function isLockRef(value: unknown): value is LockRef {
  if (typeof value !== 'object' || value === null) return false;
  const { src, kind, name } = value as Record<string, unknown>;
  return typeof src === 'string' && src !== '' && typeof kind === 'string' && KINDS.indexOf(kind) !== -1 && typeof name === 'string';
}

const SEP = String.fromCharCode(1);

/** A group's identity as one string (sources' ids never hold U+0001). */
export function lockId(group: LockRef): string {
  return group.src + SEP + group.kind + SEP + group.name;
}

/**
 * The parental part of a profile document of any version: the PIN when its salt and hash are both
 * strings; "Lock adult groups" off only when stored `false`; the choices that are a group and a
 * boolean, a repeated group's later one left out, at most `MAX_GROUP_LOCKS`. Copies, field by field.
 */
export function parentalOf(doc: unknown): ParentalState {
  const stored = field(doc, 'parental');
  const salt = field(stored, 'salt');
  const hash = field(stored, 'hash');
  const out: ParentalState = {
    pin: typeof salt === 'string' && typeof hash === 'string' ? { salt, hash } : null,
    adult: field(stored, 'adult') !== false,
    groups: [],
  };
  const groups = field(stored, 'groups');
  if (!Array.isArray(groups)) return out;
  const seen = Object.create(null) as Record<string, true>;
  for (let i = 0; i < groups.length && out.groups.length < MAX_GROUP_LOCKS; i += 1) {
    const entry = groups[i] as unknown;
    if (!isLockRef(entry)) continue;
    const locked = (entry as { locked?: unknown }).locked;
    const id = lockId(entry);
    if (typeof locked !== 'boolean' || seen[id] === true) continue;
    seen[id] = true;
    out.groups.push({ src: entry.src, kind: entry.kind, name: entry.name, locked });
  }
  return out;
}

/** `state` as the profile's field: `null` when it holds nothing (the field goes). */
function docOf(state: ParentalState): ParentalDoc | null {
  const out: ParentalDoc = {};
  if (state.pin !== null) {
    out.salt = state.pin.salt;
    out.hash = state.pin.hash;
  }
  if (!state.adult) out.adult = false;
  if (state.groups.length > 0) out.groups = state.groups;
  return out.salt === undefined && out.adult === undefined && out.groups === undefined ? null : out;
}

/**
 * The parental field of `doc` with `change` applied: the new field (`null`: it goes), or
 * `undefined` when nothing changes (one that isn't a change, or a choice past the cap, too).
 */
export function applyParentalChange(doc: unknown, change: ParentalChange): ParentalDoc | null | undefined {
  const state = parentalOf(doc);
  if (change.op === 'pin') {
    const { salt, hash } = change;
    if (typeof salt !== 'string' || typeof hash !== 'string' || salt === '' || hash === '') return undefined;
    if (state.pin !== null && state.pin.salt === salt && state.pin.hash === hash) return undefined;
    state.pin = { salt, hash };
    return docOf(state);
  }
  if (change.op === 'adult') {
    if (typeof change.on !== 'boolean' || change.on === state.adult) return undefined;
    state.adult = change.on;
    return docOf(state);
  }
  // (An op this version doesn't know changes nothing.)
  if (change.op !== 'group' || !isLockRef(change.group) || typeof change.locked !== 'boolean') return undefined;
  const id = lockId(change.group);
  let at = -1;
  for (let i = 0; i < state.groups.length; i += 1) if (lockId(state.groups[i]!) === id) at = i;
  const entry: GroupLock = { src: change.group.src, kind: change.group.kind, name: change.group.name, locked: change.locked };
  if (at === -1) {
    if (state.groups.length >= MAX_GROUP_LOCKS) return undefined;
    state.groups.push(entry);
  } else if (state.groups[at]!.locked === change.locked) return undefined;
  else state.groups[at] = entry;
  return docOf(state);
}
