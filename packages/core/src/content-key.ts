/**
 * ContentKey: the stable identity of a catalog item across provider refreshes (architecture.md
 * §1.4 step 6, ADR-009). Favourites, progress and overrides reference keys, so a key must
 * survive renumbered streams and changed credentials, and is never derived from a URL.
 *
 * - Xtream: `x:<src>:<kind>:<id>`, with the panel's stream, series or episode id.
 * - M3U: `m:<src>:<hash>:<dup>`, where `<hash>` is `hash53` (base 36) of
 *   - `i` + tvg-id (lower case) + normalized name, when the entry has a tvg-id, or
 *   - `n` + normalized name + normalized group, when it has none;
 *   and `<dup>` counts earlier entries of the same source with the same hash (0 for the first).
 *
 * FROZEN: changing any of this (including `normalizeName` and `hash53`) changes stored keys;
 * it needs a profile migration. The golden tests pin real key values.
 */

import { hash53Base36 } from './hash';
import type { ContentKey, ContentKind } from './model';

/** Xtream keys also name episodes, which get their own ids from `get_series_info`. */
export type XtreamKeyKind = ContentKind | 'episode';

const XTREAM_KINDS: readonly XtreamKeyKind[] = ['live', 'movie', 'series', 'episode'];
const SOURCE_ID = /^[A-Za-z0-9_-]{1,32}$/;
const XTREAM_ID = /^[^\s:]{1,64}$/;
const M3U_HASH = /^[0-9a-z]{1,11}$/;
const SEP = String.fromCharCode(1);

/** Whether `src` can be a source id inside keys: 1-32 of `A-Z a-z 0-9 _ -`. */
export function isSourceId(src: string): boolean {
  return SOURCE_ID.test(src);
}

function assertSourceId(src: string): void {
  if (!SOURCE_ID.test(src)) throw new RangeError(`Invalid source id ${JSON.stringify(src)}`);
}

/**
 * The key of an Xtream item. `id` is the panel's id (panels send numbers or numeric strings);
 * it must be a non-negative integer, or a string with no whitespace or colons.
 */
export function xtreamKey(src: string, kind: XtreamKeyKind, id: string | number): ContentKey {
  assertSourceId(src);
  let text: string;
  if (typeof id === 'number') {
    if (!Number.isSafeInteger(id) || id < 0) throw new RangeError(`Invalid Xtream id ${id}`);
    text = String(id);
  } else {
    text = id.trim();
    if (!XTREAM_ID.test(text)) throw new RangeError(`Invalid Xtream id ${JSON.stringify(id)}`);
  }
  return `x:${src}:${kind}:${text}`;
}

/** The fields an M3U key is derived from (all already normalized except the tvg-id). */
export interface M3uKeyFields {
  tvgId: string | null;
  normName: string;
  normGroup: string;
}

/** The `<hash>` part of an M3U key. */
export function m3uKeyHash(fields: M3uKeyFields): string {
  const tvgId = fields.tvgId === null ? '' : fields.tvgId.trim().toLowerCase();
  return hash53Base36(tvgId ? `i${SEP}${tvgId}${SEP}${fields.normName}` : `n${SEP}${fields.normName}${SEP}${fields.normGroup}`);
}

/**
 * Hands out M3U keys for one source in playlist order, numbering entries that share a hash
 * (the same channel listed twice in a group, say). Use one allocator per refresh, so the same
 * playlist always gets the same keys.
 */
export class M3uKeyAllocator {
  private readonly counts = new Map<string, number>();

  constructor(private readonly src: string) {
    assertSourceId(src);
  }

  next(fields: M3uKeyFields): ContentKey {
    const hash = m3uKeyHash(fields);
    const dup = this.counts.get(hash) ?? 0;
    this.counts.set(hash, dup + 1);
    return `m:${this.src}:${hash}:${dup}`;
  }
}

export type ParsedContentKey =
  | { type: 'xtream'; src: string; kind: XtreamKeyKind; id: string }
  | { type: 'm3u'; src: string; hash: string; dup: number };

/** Splits a key into its parts, or `null` when it is not a well-formed key. */
export function parseContentKey(key: string): ParsedContentKey | null {
  const parts = key.split(':');
  if (parts.length !== 4) return null;
  const [type, src, third, fourth] = parts as [string, string, string, string];
  if (!SOURCE_ID.test(src)) return null;
  if (type === 'x') {
    const kind = third as XtreamKeyKind;
    if (XTREAM_KINDS.indexOf(kind) === -1 || !XTREAM_ID.test(fourth)) return null;
    return { type: 'xtream', src, kind, id: fourth };
  }
  if (type === 'm') {
    if (!M3U_HASH.test(third) || !/^(?:0|[1-9][0-9]{0,8})$/.test(fourth)) return null;
    return { type: 'm3u', src, hash: third, dup: Number(fourth) };
  }
  return null;
}
