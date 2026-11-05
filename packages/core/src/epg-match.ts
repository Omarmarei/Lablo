/**
 * EPG matching (architecture.md §1.5 steps 2 and 4): which XMLTV channel of a guide feeds which
 * live channel of the playlists.
 *
 * - **Wanted set** (`EpgWantedSet`): every live channel of every catalog source, indexed by its
 *   playlist id (tvg-id or Xtream `epg_channel_id`, case-insensitive), its normalized names
 *   (name and tvg-name) and its match names. Built once before a guide is read.
 * - **Cascade**, first hit wins: user override, exact id (case-insensitive; reported as
 *   `xtream-id` for an Xtream source), normalized display name, match name (tags and quality
 *   stripped; the XMLTV id's stem, `BBCOne.uk@HD` → `bbcone`, counts as a display name here),
 *   no match.
 * - **One guide** (`EpgMatcher`): each XMLTV channel is matched as it is declared. A playlist
 *   channel keeps the best method offered by any XMLTV channel of the guide; at the same level
 *   the first declared one wins, and a different one offering the same name level marks the
 *   match `ambiguous` (the diagnostics screen lists those).
 * - **Several guides** (`combineEpgMatches`): the stronger method wins over guide priority (an
 *   exact id in the second guide beats a name match in the first); at the same level the guide
 *   listed first wins.
 * - **Overrides** pin a playlist channel to one XMLTV channel of one guide (no other guide or
 *   method can match it), or to none.
 */

import type { CatalogItem, ContentKey } from './model';
import { matchName, normalizeName } from './normalize';
import type { XmltvChannel } from './xmltv';

export type EpgMatchMethod = 'override' | 'id' | 'xtream-id' | 'name' | 'match-name';

/** In cascade order. */
export const EPG_MATCH_METHODS: readonly EpgMatchMethod[] = ['override', 'id', 'xtream-id', 'name', 'match-name'];

/** A method's position in `EPG_MATCH_METHODS`. */
const RANK: Record<EpgMatchMethod, number> = { override: 0, id: 1, 'xtream-id': 2, name: 3, 'match-name': 4 };
const NO_RANK = 255;

/** Cascade position of a method (lower is stronger). */
export function epgMethodRank(method: EpgMatchMethod): number {
  return RANK[method];
}

/** A live channel of the playlists, as matching sees it. */
export interface EpgWantedChannel {
  key: ContentKey;
  /** Display name, for the report's unmatched list. */
  name: string;
  /** tvg-id (M3U) or `epg_channel_id` (Xtream), as written. */
  epgId: string | null;
  /** From an Xtream source: an id match is reported as `xtream-id`. */
  xtream: boolean;
  /** `normalizeName` of the name and the tvg-name (distinct, non-empty). */
  names: string[];
  /** `matchName` of the name and the tvg-name (distinct, non-empty). */
  matchNames: string[];
  /** Catch-up depth in days (0: none). The full tier keeps that much past programme data. */
  catchupDays: number;
  /** `tvg-shift` in hours. Applied when reading, per playlist channel (see epg-guide.ts). */
  shiftHours: number;
}

/** A user's manual mapping (step 24): this playlist channel takes `channel` of guide `epgSrc`, or no EPG (`null`). */
export interface EpgOverride {
  key: ContentKey;
  epgSrc: string;
  channel: string | null;
}

function distinct(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (v.length > 0 && out.indexOf(v) === -1) out.push(v);
  return out;
}

/** The wanted-set entry of a catalog item; `null` for movies and series. */
export function epgWantedChannel(item: CatalogItem): EpgWantedChannel | null {
  if (item.kind !== 'live') return null;
  const epgId = item.epgId !== null && item.epgId.trim().length > 0 ? item.epgId.trim() : null;
  const tvg = item.tvgName;
  return {
    key: item.key,
    name: item.name,
    epgId,
    // ContentKey layout is frozen (ADR-009): Xtream keys are `x:<src>:<kind>:<id>`.
    xtream: item.key.charCodeAt(0) === 120 && item.key.charCodeAt(1) === 58,
    names: distinct([item.normName, tvg === null ? '' : normalizeName(tvg)]),
    matchNames: distinct([item.matchName ?? matchName(item.name), tvg === null ? '' : matchName(tvg)]),
    catchupDays: item.catchup?.days ?? 0,
    shiftHours: item.tvgShift,
  };
}

/**
 * The stem of an XMLTV id used as one more name: an `@variant` suffix and a 2-3 letter country
 * suffix removed (`BBCOne.uk@HD` → `BBCOne`), `null` when nothing is left or nothing was removed.
 */
export function xmltvIdStem(id: string): string | null {
  const stem = id.replace(/@[^@]*$/, '').replace(/\.[A-Za-z]{2,3}$/, '');
  return stem.length > 0 && stem !== id ? stem : null;
}

const push = (map: Map<string, number[]>, key: string, index: number): void => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [index]);
  else if (list[list.length - 1] !== index) list.push(index);
};

/** Pinned by an override: to a channel of a guide, or to none. */
interface Pin {
  epgSrc: string;
  channel: string | null;
}

/** The live channels a guide can match, indexed for the cascade. Read-only once built. */
export class EpgWantedSet {
  readonly channels: readonly EpgWantedChannel[];
  private readonly byId = new Map<string, number[]>();
  private readonly byName = new Map<string, number[]>();
  private readonly byMatchName = new Map<string, number[]>();
  private readonly pins: (Pin | undefined)[];

  constructor(channels: readonly EpgWantedChannel[], overrides: readonly EpgOverride[] = []) {
    this.channels = channels;
    const index = new Map<ContentKey, number>();
    channels.forEach((c, i) => {
      index.set(c.key, i);
      if (c.epgId !== null) push(this.byId, c.epgId.toLowerCase(), i);
      for (const n of c.names) push(this.byName, n, i);
      for (const n of c.matchNames) push(this.byMatchName, n, i);
    });
    this.pins = new Array<Pin | undefined>(channels.length);
    for (const o of overrides) {
      const i = index.get(o.key);
      if (i !== undefined) this.pins[i] = { epgSrc: o.epgSrc, channel: o.channel === null ? null : o.channel.trim() };
    }
  }

  /** The live items of a catalog (anything else is skipped). */
  static fromItems(items: Iterable<CatalogItem>, overrides: readonly EpgOverride[] = []): EpgWantedSet {
    const channels: EpgWantedChannel[] = [];
    for (const item of items) {
      const c = epgWantedChannel(item);
      if (c !== null) channels.push(c);
    }
    return new EpgWantedSet(channels, overrides);
  }

  get size(): number {
    return this.channels.length;
  }

  /** @internal Playlist channels whose id equals `id` (case-insensitive). */
  withId(id: string): readonly number[] {
    return this.byId.get(id.toLowerCase()) ?? EMPTY;
  }

  /** @internal Playlist channels with this normalized name. */
  withName(name: string): readonly number[] {
    return this.byName.get(name) ?? EMPTY;
  }

  /** @internal Playlist channels with this match name. */
  withMatchName(name: string): readonly number[] {
    return this.byMatchName.get(name) ?? EMPTY;
  }

  /** @internal The override of a playlist channel, if any. */
  pin(index: number): Pin | undefined {
    return this.pins[index];
  }

  /** @internal Overrides into guide `epgSrc`: lower-cased XMLTV id → playlist channels. */
  pinsInto(epgSrc: string): Map<string, number[]> {
    const out = new Map<string, number[]>();
    this.pins.forEach((p, i) => {
      if (p !== undefined && p.epgSrc === epgSrc && p.channel !== null) push(out, p.channel.toLowerCase(), i);
    });
    return out;
  }
}

const EMPTY: readonly number[] = [];

/**
 * A copy of `s` that doesn't keep a larger string alive. The tokenizer's ids and attribute
 * values are substrings of the decoded chunk they came from, and V8 keeps the whole chunk alive
 * for as long as such a substring lives: one id kept per channel would pin one chunk per channel
 * (5,000 channels × 50 KB in the 300 MB guide). Prepending forces a flat copy.
 */
export function ownString(s: string): string {
  return (' ' + s).slice(1);
}

/** How a playlist channel gets its programmes from one guide. */
export interface EpgChannelMatch {
  key: ContentKey;
  /** The XMLTV channel id, as the guide declares it. */
  channel: string;
  method: EpgMatchMethod;
  /** Another XMLTV channel of the guide offered the same name level. */
  ambiguous: boolean;
}

export interface EpgMatchStats {
  /** Playlist channels this guide may match (not pinned to another guide or to none). */
  wanted: number;
  matched: number;
  byMethod: Record<EpgMatchMethod, number>;
  ambiguous: number;
  /** XMLTV channels declared (`<channel>` elements, plus programme-only ids matched by id). */
  declared: number;
  /** XMLTV channels feeding at least one playlist channel. */
  used: number;
}

/** Matches the channels of one guide against the wanted set, as they are declared. */
export class EpgMatcher {
  private readonly best: Int32Array;
  private readonly bestRank: Uint8Array;
  private readonly ambiguousFlag: Uint8Array;
  /** 1: pinned to another guide or to none; never matched here. */
  private readonly blocked: Uint8Array;
  /** 1: pinned to a channel of this guide; only that override matches it. */
  private readonly pinnedHere: Uint8Array;
  private readonly pinned: Map<string, number[]>;
  private readonly declaredIds = new Map<string, number>();
  private readonly list: XmltvChannel[] = [];
  /** Per XMLTV channel: how many playlist channels it feeds. */
  private readonly uses: number[] = [];
  private usedCount = 0;

  constructor(
    readonly epgSrc: string,
    readonly wanted: EpgWantedSet,
  ) {
    const n = wanted.size;
    this.best = new Int32Array(n).fill(-1);
    this.bestRank = new Uint8Array(n).fill(NO_RANK);
    this.ambiguousFlag = new Uint8Array(n);
    this.blocked = new Uint8Array(n);
    this.pinnedHere = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const pin = wanted.pin(i);
      if (pin === undefined) continue;
      if (pin.channel === null || pin.epgSrc !== epgSrc) this.blocked[i] = 1;
      else this.pinnedHere[i] = 1;
    }
    this.pinned = wanted.pinsInto(epgSrc);
  }

  /** Matches a declared channel. A repeated id adds its names to the first declaration. */
  addChannel(channel: XmltvChannel): void {
    let c = this.declaredIds.get(channel.id);
    if (c === undefined) {
      c = this.declare(channel);
    } else {
      const known = this.list[c]!;
      for (const n of channel.names) if (known.names.indexOf(n) === -1) known.names.push(ownString(n));
      if (known.icon === null && channel.icon !== null) known.icon = ownString(channel.icon);
    }
    const lower = channel.id.toLowerCase();
    for (const w of this.pinned.get(lower) ?? EMPTY) this.offer(w, c, 'override');
    for (const w of this.wanted.withId(lower)) this.offer(w, c, this.wanted.channels[w]!.xtream ? 'xtream-id' : 'id');
    for (const n of channel.names) {
      for (const w of this.wanted.withName(normalizeName(n))) this.offer(w, c, 'name');
      for (const w of this.wanted.withMatchName(matchName(n))) this.offer(w, c, 'match-name');
    }
    const stem = xmltvIdStem(channel.id);
    if (stem !== null) for (const w of this.wanted.withMatchName(matchName(stem))) this.offer(w, c, 'match-name');
  }

  /**
   * A programme's channel that was never declared: declared now (with no names) when an
   * override or the id alone matches it. Returns whether it feeds a playlist channel.
   */
  declareById(id: string): boolean {
    if (this.declaredIds.has(id)) return this.isUsed(id);
    const lower = id.toLowerCase();
    if (!this.pinned.has(lower) && this.wanted.withId(lower).length === 0) return false;
    this.addChannel({ type: 'channel', id, name: id, names: [], icon: null });
    return this.isUsed(id);
  }

  isDeclared(id: string): boolean {
    return this.declaredIds.has(id);
  }

  /** Whether the XMLTV channel `id` feeds at least one playlist channel right now. */
  isUsed(id: string): boolean {
    const c = this.declaredIds.get(id);
    return c !== undefined && this.uses[c]! > 0;
  }

  /** The declaration number of XMLTV channel `id` (0, 1, ...), or -1 when it isn't declared. */
  channelIndex(id: string): number {
    return this.declaredIds.get(id) ?? -1;
  }

  /** The id of declared channel `c`, as an owned string (see `ownString`). */
  channelId(c: number): string {
    return this.list[c]!.id;
  }

  /** Whether declared channel `c` feeds at least one playlist channel right now. */
  usedAt(c: number): boolean {
    return this.uses[c]! > 0;
  }

  /** Longest catch-up (days) among the matched playlist channels. */
  maxCatchupDays(): number {
    let max = 0;
    for (let w = 0; w < this.best.length; w++) if (this.best[w]! >= 0) max = Math.max(max, this.wanted.channels[w]!.catchupDays);
    return max;
  }

  /** Largest |tvg-shift| (hours) among the matched playlist channels. */
  maxShiftHours(): number {
    let max = 0;
    for (let w = 0; w < this.best.length; w++) if (this.best[w]! >= 0) max = Math.max(max, Math.abs(this.wanted.channels[w]!.shiftHours));
    return max;
  }

  /** One entry per matched playlist channel, in wanted-set order. */
  matches(): EpgChannelMatch[] {
    const out: EpgChannelMatch[] = [];
    for (let w = 0; w < this.best.length; w++) {
      const c = this.best[w]!;
      if (c < 0) continue;
      const method = EPG_MATCH_METHODS[this.bestRank[w]!]!;
      out.push({ key: this.wanted.channels[w]!.key, channel: this.list[c]!.id, method, ambiguous: this.ambiguousFlag[w] === 1 });
    }
    return out;
  }

  /** Playlist channels this guide may match but doesn't (wanted-set order). */
  unmatched(): EpgWantedChannel[] {
    const out: EpgWantedChannel[] = [];
    for (let w = 0; w < this.best.length; w++) if (this.best[w]! < 0 && this.blocked[w] === 0) out.push(this.wanted.channels[w]!);
    return out;
  }

  /** The XMLTV channels feeding at least one playlist channel, in declaration order. */
  usedChannels(): XmltvChannel[] {
    return this.list.filter((_, c) => this.uses[c]! > 0);
  }

  /**
   * Every XMLTV channel declared so far, in declaration order (step 24d: a channel nothing matched
   * can be mapped by hand). Their ids and names are owned strings (see `ownString`). Read-only.
   */
  declaredChannels(): readonly XmltvChannel[] {
    return this.list;
  }

  stats(): EpgMatchStats {
    const byMethod: Record<EpgMatchMethod, number> = { override: 0, id: 0, 'xtream-id': 0, name: 0, 'match-name': 0 };
    let wanted = 0;
    let matched = 0;
    let ambiguous = 0;
    for (let w = 0; w < this.best.length; w++) {
      if (this.blocked[w] === 0) wanted++;
      if (this.best[w]! < 0) continue;
      matched++;
      byMethod[EPG_MATCH_METHODS[this.bestRank[w]!]!]++;
      if (this.ambiguousFlag[w] === 1) ambiguous++;
    }
    return { wanted, matched, byMethod, ambiguous, declared: this.list.length, used: this.usedCount };
  }

  private declare(channel: XmltvChannel): number {
    const c = this.list.length;
    const id = ownString(channel.id);
    this.list.push({
      type: 'channel',
      id,
      name: ownString(channel.name),
      names: channel.names.map(ownString),
      icon: channel.icon === null ? null : ownString(channel.icon),
    });
    this.uses.push(0);
    this.declaredIds.set(id, c);
    return c;
  }

  private offer(w: number, c: number, method: EpgMatchMethod): void {
    if (this.blocked[w] === 1 || (this.pinnedHere[w] === 1 && method !== 'override')) return;
    const rank = RANK[method];
    const current = this.bestRank[w]!;
    if (rank < current) {
      const previous = this.best[w]!;
      if (previous >= 0) this.release(previous);
      this.best[w] = c;
      this.bestRank[w] = rank;
      this.ambiguousFlag[w] = 0;
      if (this.uses[c]!++ === 0) this.usedCount++;
    } else if (rank === current && this.best[w] !== c && rank >= RANK.name) {
      this.ambiguousFlag[w] = 1;
    }
  }

  private release(c: number): void {
    if (--this.uses[c]! === 0) this.usedCount--;
  }
}

/** Where a playlist channel's programmes come from, after every guide was read. */
export interface EpgSourceMatch extends EpgChannelMatch {
  epgSrc: string;
}

/**
 * The best match per playlist channel over several guides, given in priority order: the
 * stronger method wins, then the guide listed first.
 */
export function combineEpgMatches(guides: readonly { epgSrc: string; matches: readonly EpgChannelMatch[] }[]): Map<ContentKey, EpgSourceMatch> {
  const out = new Map<ContentKey, EpgSourceMatch>();
  for (const guide of guides) {
    for (const m of guide.matches) {
      const current = out.get(m.key);
      if (current === undefined || RANK[m.method] < RANK[current.method]) out.set(m.key, { ...m, epgSrc: guide.epgSrc });
    }
  }
  return out;
}
