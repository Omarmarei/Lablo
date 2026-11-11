/**
 * The user's manual EPG mappings (step 24d, architecture.md §1.5 step 4): a live channel pinned to
 * one XMLTV channel of one guide, or to no guide at all. Core's matcher honours them (`EpgOverride`:
 * no other guide or method can match a pinned channel). They are kept in the profile by ContentKey
 * (`epgOverrides`); the EPG worker reads them at each refresh, and the query worker at each reload.
 *
 * A guide stores which mappings it was matched with (`EpgMeta.mapping`, `epgMappingKey`): when the
 * profile holds others, the guide is due at once (`epgRefreshDue`), and since the mappings are in
 * the refresh's basis, it is read again even when its bytes are the same.
 */

import type { ContentKey, EpgOverride } from '@lablo/core';
import { hash53Base36 } from '@lablo/core';

/**
 * A live channel's mapping as the profile keeps it: XMLTV channel `channel` (its id, as the guide
 * declares it) of guide `epgSrc`, or no guide (`channel: null`, `epgSrc: ''`).
 */
export type EpgPin = { epgSrc: string; channel: string | null };

/** The mappings of a document with none: no guide's channels were matched by hand. */
export const NO_MAPPING = '-';

/** Whether `pin` is a mapping the profile can keep (see `EpgPin`). */
export function isEpgPin(pin: unknown): pin is EpgPin {
  if (typeof pin !== 'object' || pin === null) return false;
  const { epgSrc, channel } = pin as { epgSrc?: unknown; channel?: unknown };
  if (channel === null) return epgSrc === '';
  return typeof epgSrc === 'string' && epgSrc !== '' && typeof channel === 'string' && channel.trim() !== '';
}

/**
 * The manual mappings in a profile document of any version (`epgOverrides`), as core's matcher
 * takes them: only the ones that are mappings (`isEpgPin`). A document without them (written
 * before step 24d) has none.
 */
export function epgOverridesOf(doc: unknown): EpgOverride[] {
  const out: EpgOverride[] = [];
  // (Any other value has no such field.)
  const stored = doc === null || doc === undefined ? undefined : (doc as { epgOverrides?: unknown }).epgOverrides;
  if (typeof stored !== 'object' || stored === null) return out;
  const record = stored as Record<string, unknown>;
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    const pin = record[keys[i]!];
    if (isEpgPin(pin)) out.push({ key: keys[i]! as ContentKey, epgSrc: pin.epgSrc, channel: pin.channel });
  }
  return out;
}

const SEP = String.fromCharCode(1);
const END = String.fromCharCode(2);

/**
 * A short key of a set of mappings, the same whatever their order (`NO_MAPPING` for none): a
 * guide matched with another key is matched again. A mapping to no guide is the same whichever
 * guide it names.
 */
export function epgMappingKey(overrides: readonly EpgOverride[]): string {
  if (overrides.length === 0) return NO_MAPPING;
  const parts = overrides.map((o) => (o.channel === null ? o.key : o.key + SEP + o.epgSrc + SEP + o.channel));
  parts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return hash53Base36(parts.join(END));
}
