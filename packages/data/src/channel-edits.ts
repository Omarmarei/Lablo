/**
 * The user's changes to single live channels (RELAY step 36, architecture.md §1.3): hidden,
 * renamed or renumbered, and the "Clean channel names" switch.
 *
 * - `channelEdits` holds one entry per changed channel: the channel's ref, with what re-matching
 *   needs as a favourite's (favourites.ts, step 8), so a refresh that renumbers or renames the
 *   channel re-keys its entry as it does a favourite; plus what the user changed (`hidden`,
 *   `name`, `number`). An entry with nothing changed left goes. A number is one channel's: no two
 *   entries hold the same.
 * - `cleanNames: true` shows live channels' names without their leading country or category tags
 *   (core's `cleanName`); no field when it is off.
 *
 * Main and settings.js read these through `@lablo/data/client`, so this module imports nothing at
 * run time and uses nothing Babel would polyfill in main.js (no `trim`, `sort`, regex `test`,
 * `for…of`): the edits, which need more, are the query worker's (channel-changes.ts).
 */

import type { FavouriteRef } from './profile';

/** A changed live channel: its ref (`kind: 'live'`) and the user's changes, at least one of them. */
export type ChannelEdit = FavouriteRef & {
  /** Out of "All channels" and its group (search and favourites lists still have it). */
  hidden?: true;
  /** The name shown instead of the provider's (1 to `CHANNEL_NAME_MAX` code units). */
  name?: string;
  /** The number shown and dialled instead of the provider's (a whole 1 to `CHANNEL_NUMBER_MAX`). */
  number?: number;
  /** Locked by the user (step 38): while the session is locked, nothing of it is served anywhere. */
  locked?: true;
};

/** The most changed channels a profile keeps. */
export const MAX_CHANNEL_EDITS = 2000;
/** A channel's name: at most this many UTF-16 code units, after trimming. */
export const CHANNEL_NAME_MAX = 60;
/** The highest channel number (four digits, as number entry takes). */
export const CHANNEL_NUMBER_MAX = 9999;

/** `doc[name]`, or `undefined` for a document that isn't an object. */
function field(doc: unknown, name: string): unknown {
  return typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>)[name] : undefined;
}

/** A stored channel name: 1 to `CHANNEL_NAME_MAX` code units (an edit trims it first). */
export function isChannelName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= CHANNEL_NAME_MAX;
}

/** A channel number: a whole 1 to `CHANNEL_NUMBER_MAX`. */
export function isChannelNumber(value: unknown): value is number {
  return typeof value === 'number' && value >= 1 && value <= CHANNEL_NUMBER_MAX && Math.floor(value) === value;
}

/** `value` when it is a time in epoch ms (a finite number). */
function isTime(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

/**
 * The changed channels of a profile document of any version (`channelEdits`), in its order:
 * entries that aren't a live channel's ref left out, and those with no valid change; a change that
 * isn't valid left out of its entry; a repeated key's later entry left out, and a number an earlier
 * entry holds left out of a later one; at most `MAX_CHANNEL_EDITS`. A document without them
 * (written before step 36) has none. Each entry is a copy, field by field.
 */
export function channelEditsOf(doc: unknown): ChannelEdit[] {
  const stored = field(doc, 'channelEdits');
  const out: ChannelEdit[] = [];
  if (!Array.isArray(stored)) return out;
  // (No inherited names: a key or a number never finds what an object inherits.)
  const keys = Object.create(null) as Record<string, true>;
  const numbers = Object.create(null) as Record<string, true>;
  for (let i = 0; i < stored.length && out.length < MAX_CHANNEL_EDITS; i += 1) {
    const entry = stored[i] as unknown;
    if (typeof entry !== 'object' || entry === null) continue;
    const { key, src, kind, normName, group, epgId, added, missingSince, hidden, name, number, locked } = entry as Record<string, unknown>;
    if (typeof key !== 'string' || key === '' || keys[key] === true) continue;
    if (typeof src !== 'string' || src === '' || kind !== 'live' || typeof normName !== 'string') continue;
    if ((group !== undefined && typeof group !== 'string') || (epgId !== undefined && epgId !== null && typeof epgId !== 'string')) continue;
    if (!isTime(added) || (missingSince !== null && !isTime(missingSince))) continue;
    const edit: ChannelEdit = { key, src, kind, normName, added, missingSince };
    if (group !== undefined) edit.group = group;
    if (epgId !== undefined) edit.epgId = epgId;
    if (hidden === true) edit.hidden = true;
    if (isChannelName(name)) edit.name = name;
    if (isChannelNumber(number) && numbers[number] !== true) edit.number = number;
    if (locked === true) edit.locked = true;
    if (edit.hidden === undefined && edit.name === undefined && edit.number === undefined && edit.locked === undefined) continue;
    keys[key] = true;
    if (edit.number !== undefined) numbers[edit.number] = true;
    out.push(edit);
  }
  return out;
}

/** Whether "Clean channel names" is on (`cleanNames: true`); off in an older document. */
export function cleanNamesOn(doc: unknown): boolean {
  return field(doc, 'cleanNames') === true;
}

/**
 * How many channels the query worker serves of each chunk of a live category (step 36a2): its
 * `chunks` less the `hidden` places in each (the places ascending, as the worker gives them).
 */
export function shownChunks(info: { readonly chunks: readonly number[]; readonly hidden?: readonly number[] }): number[] {
  const hidden = info.hidden === undefined ? [] : info.hidden;
  const out: number[] = [];
  let start = 0;
  let h = 0;
  for (let c = 0; c < info.chunks.length; c += 1) {
    const size = info.chunks[c]!;
    let shown = size;
    for (; h < hidden.length && hidden[h]! < start + size; h += 1) shown -= 1;
    out.push(shown);
    start += size;
  }
  return out;
}
