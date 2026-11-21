/**
 * The changed channels' edits (RELAY step 36a), applied by the query worker (`applyProfileEdit`).
 * Pure: each returns the changed channels as new objects, or `null` when the edit changes nothing
 * (one past a cap, or naming nothing, too). The stored entries are read through channel-edits.ts's
 * checks, so a malformed one is read as the app would show it. A refresh's side is the ingest
 * worker's (channel-relink.ts), so the query worker gets none of the re-match.
 */

import type { ContentKey } from '@lablo/core';
import type { ChannelEdit } from './channel-edits';
import { CHANNEL_NAME_MAX, MAX_CHANNEL_EDITS, channelEditsOf, isChannelNumber } from './channel-edits';
import type { FavouriteItem } from './favourite-edits';
import { isFavouriteItem } from './favourite-edits';

/** A change to a single live channel (step 36a). `item` names the channel where the change may make its entry. */
export type ChannelChange =
  /** Out of "All channels" and its group. */
  | { op: 'hide'; item: FavouriteItem }
  /** Back in them. */
  | { op: 'show'; key: ContentKey }
  /** Shown under `name` (trimmed, 1 to `CHANNEL_NAME_MAX`); `null`: the provider's name again. */
  | { op: 'rename'; item: FavouriteItem; name: string | null }
  /**
   * Shown and dialled as `number` (a whole 1 to `CHANNEL_NUMBER_MAX`); a number another channel
   * has moves here, and that one goes back to its own. `null`: the provider's number again.
   */
  | { op: 'number'; item: FavouriteItem; number: number | null }
  /** Every change of the channel gone. */
  | { op: 'reset'; key: ContentKey };

/**
 * A copy of `edit`, field by field, with its changes as `set` gives them (`undefined` leaves one,
 * `null` takes it away), or `null` when nothing is left.
 */
export function changed(edit: ChannelEdit, set: { hidden?: true | null; name?: string | null; number?: number | null }): ChannelEdit | null {
  const next: ChannelEdit = { key: edit.key, src: edit.src, kind: edit.kind, normName: edit.normName, added: edit.added, missingSince: edit.missingSince };
  if (edit.group !== undefined) next.group = edit.group;
  if (edit.epgId !== undefined) next.epgId = edit.epgId;
  const hidden = set.hidden === undefined ? edit.hidden : set.hidden;
  const name = set.name === undefined ? edit.name : set.name;
  const number = set.number === undefined ? edit.number : set.number;
  if (hidden === true) next.hidden = true;
  if (typeof name === 'string') next.name = name;
  if (typeof number === 'number') next.number = number;
  return next.hidden === undefined && next.name === undefined && next.number === undefined ? null : next;
}

/** A new entry for `item`, present now, with nothing changed yet. Its fields one by one: the app's object may carry more. */
function entryOf(item: FavouriteItem): ChannelEdit {
  const edit: ChannelEdit = { key: item.key, src: item.src, kind: item.kind, normName: item.normName, added: item.added, missingSince: null };
  if (item.group !== undefined) edit.group = item.group;
  if (item.epgId !== undefined) edit.epgId = item.epgId;
  return edit;
}

/** `name` trimmed when it is a channel name then, `null` for none, else `undefined`. */
function channelName(name: unknown): string | null | undefined {
  if (name === null) return null;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= CHANNEL_NAME_MAX ? trimmed : undefined;
}

/**
 * The changed channels with `change` applied (a new array: `[]` means the field goes), or `null`
 * when it changes nothing. `doc` is a stored profile document.
 */
export function applyChannelChange(doc: unknown, change: ChannelChange): ChannelEdit[] | null {
  const edits = channelEditsOf(doc);
  const named = change.op === 'show' || change.op === 'reset' ? change.key : isFavouriteItem(change.item) && change.item.kind === 'live' ? change.item.key : null;
  if (typeof named !== 'string') return null;
  let at = -1;
  for (let i = 0; i < edits.length; i += 1) if (edits[i]!.key === named) at = i;
  const next = edits.slice();
  /** `entry` in its place (a new one at the end), or out when `null`. */
  const put = (entry: ChannelEdit | null): ChannelEdit[] => {
    if (at === -1) {
      if (entry !== null) next.push(entry);
    } else if (entry === null) next.splice(at, 1);
    else next[at] = entry;
    return next;
  };
  if (change.op === 'show' || change.op === 'reset') {
    if (at === -1) return null;
    if (change.op === 'reset') return put(null);
    return edits[at]!.hidden === true ? put(changed(edits[at]!, { hidden: null })) : null;
  }
  // (An op this version doesn't know changes nothing.)
  if (change.op !== 'hide' && change.op !== 'rename' && change.op !== 'number') return null;
  if (at === -1 && edits.length >= MAX_CHANNEL_EDITS) return null;
  const entry = at === -1 ? entryOf(change.item) : edits[at]!;
  if (change.op === 'hide') return entry.hidden === true ? null : put(changed(entry, { hidden: true }));
  if (change.op === 'rename') {
    const name = channelName(change.name);
    if (name === undefined || name === (entry.name ?? null)) return null;
    return put(changed(entry, { name }));
  }
  const number = change.number;
  if ((number !== null && !isChannelNumber(number)) || number === (entry.number ?? null)) return null;
  put(changed(entry, { number }));
  // The number was another channel's: that one goes back to its own (and out, with nothing else
  // changed). (A number of `null` is no other entry's.)
  for (let i = 0; i < next.length; i += 1) {
    const other = next[i]!;
    if (other.key === named || other.number !== number) continue;
    const kept = changed(other, { number: null });
    if (kept === null) next.splice(i, 1);
    else next[i] = kept;
    break;
  }
  return next;
}
