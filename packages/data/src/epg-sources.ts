/**
 * Which guides a refresh reads, and when (architecture.md §1.5 steps 1 and 8). Pure and small:
 * the app (`@zoma/data/client`) decides with it what to send to the ingest worker.
 *
 * - **Guides**, in priority order (`combineEpgMatches` breaks ties between methods of equal
 *   strength by it): the user's XMLTV URLs in the user's order, then each catalog source's own
 *   guide: Xtream `xmltv.php`, or the URLs an M3U header names (`url-tvg`, `x-tvg-url`). The
 *   user's come first because a guide added by hand is there to win. A URL listed twice is read
 *   once, under its first id.
 * - **Ids** (`epgSrc`): `<src>:xmltv`, `<src>:tvg<n>` and `u~<id>`. Source ids can't hold `:` or
 *   `~` (content-key.ts), so the three never collide.
 * - **Zones** for times written without an offset: the panel zone of an Xtream source (learnt at
 *   login, `SourceMeta.server`), and of a playlist whose header names its panel's `xmltv.php`
 *   (step 25b: a `get.php` link's ingest logs in for it; UTC until it has); UTC for every other
 *   guide.
 * - **The user's time offset** per guide (step 24b): a whole number of half hours from −12 h to
 *   +12 h, kept in the profile by guide id (`epgOffsets`) and added to every time the guide gives
 *   when the query worker reads it, as a channel's tvg-shift is. It is never applied at ingest:
 *   a change shows at once, with nothing downloaded or read again.
 * - **Due:** a guide is refreshed every 12 h, or sooner when its stored programmes end less than
 *   24 h ahead (but not more than every 2 h, or a guide that only ever covers a few hours would
 *   be fetched in a loop). After a failure it waits 2 h too. A guide matched with other manual
 *   mappings than the profile's (step 24d, epg-overrides.ts) is due at once.
 */

import type { XtreamAccount } from '@zoma/core';
import { xtreamFromM3uUrl, xtreamXmltvUrl } from '@zoma/core';
import type { SourceMeta } from './catalog-store';
import type { EpgMeta } from './epg-store';

const MINUTE = 60_000;
const HOUR = 3_600_000;
/** A guide older than this is refreshed. */
export const EPG_REFRESH_MS = 12 * HOUR;
/** A guide whose programmes end sooner than this is refreshed early. */
export const EPG_AHEAD_MS = 24 * HOUR;
/** The shortest wait between two refreshes (or after a failure) of one guide. */
export const EPG_RETRY_MS = 2 * HOUR;

/** One guide to read. */
export interface EpgGuide {
  /** Records and overrides are scoped by it. */
  epgSrc: string;
  /** May carry credentials (Xtream `xmltv.php`): never log it. */
  url: string;
  /** Times without an offset: the panel zone of this catalog source (Xtream, or a playlist naming its panel's guide), or fixed minutes east of UTC. */
  zone: { panel: string } | { minutes: number };
}

/** A guide the user added (step 22 manages the list). */
export interface UserGuide {
  id: string;
  url: string;
  /** Zone of times written without an offset, in minutes east of UTC (default UTC). */
  offsetMinutes?: number;
}

/** A catalog source as the guides need it: Xtream sources bring their account. */
export type EpgCatalogSource = { src: string; type: 'm3u' } | { src: string; type: 'xtream'; account: XtreamAccount };

/** The guides to read, in priority order (see the module comment). */
export function epgGuides(catalogs: readonly EpgCatalogSource[], sources: readonly SourceMeta[], user: readonly UserGuide[] = []): EpgGuide[] {
  const out: EpgGuide[] = [];
  const urls: string[] = [];
  const add = (guide: EpgGuide): void => {
    if (urls.indexOf(guide.url) !== -1) return;
    urls.push(guide.url);
    out.push(guide);
  };
  for (const u of user) add({ epgSrc: `u~${u.id}`, url: u.url, zone: { minutes: u.offsetMinutes ?? 0 } });
  for (const c of catalogs) {
    if (c.type === 'xtream') {
      add({ epgSrc: `${c.src}:xmltv`, url: xtreamXmltvUrl(c.account), zone: { panel: c.src } });
      continue;
    }
    let meta: SourceMeta | undefined;
    for (const s of sources) if (s.src === c.src) meta = s;
    const named = meta && meta.epgUrls ? meta.epgUrls : [];
    // A panel's own guide (`xmltv.php` with a login) writes its times in the panel's zone.
    named.forEach((url, i) => add({ epgSrc: `${c.src}:tvg${i}`, url, zone: xtreamFromM3uUrl(url) === null ? { minutes: 0 } : { panel: c.src } }));
  }
  return out;
}

/** The time offset's step and its largest size either way, in minutes (step 24b). */
export const EPG_OFFSET_STEP = 30;
export const EPG_OFFSET_MAX = 12 * 60;

/** Whether `minutes` is a time offset a guide can have: a whole number of steps up to 12 h either way. */
export function isEpgOffset(minutes: unknown): minutes is number {
  return typeof minutes === 'number' && minutes % EPG_OFFSET_STEP === 0 && Math.abs(minutes) <= EPG_OFFSET_MAX;
}

/**
 * The guides' time offsets in a profile document of any version (`epgOffsets`), in minutes by
 * guide id: only the ones that are offsets (`isEpgOffset`) and not 0. A document without them
 * (written before step 24b) has none.
 */
export function epgOffsetsOf(doc: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const stored = typeof doc === 'object' && doc !== null ? (doc as { epgOffsets?: unknown }).epgOffsets : undefined;
  if (typeof stored !== 'object' || stored === null) return out;
  const record = stored as Record<string, unknown>;
  const ids = Object.keys(record);
  for (let i = 0; i < ids.length; i += 1) {
    const value = record[ids[i]!];
    if (isEpgOffset(value) && value !== 0) out[ids[i]!] = value;
  }
  return out;
}

export type EpgDueReason = 'new' | 'mapping' | 'stale' | 'running-out';

/**
 * Why a guide should be refreshed now (`null`: it shouldn't). `mapping` is the key of the
 * profile's manual mappings (`EpgStatus.mapping`; `-`: none): a guide matched with others is due
 * at once, unless it failed less than 2 h ago.
 */
export function epgRefreshDue(meta: EpgMeta | null | undefined, nowMs: number, mapping = '-'): EpgDueReason | null {
  if (meta && typeof meta.failedAt === 'number' && nowMs - meta.failedAt < EPG_RETRY_MS) return null;
  if (!meta || meta.gen === 0) return 'new';
  // (A generation committed before step 24d has no key: it was matched with none.)
  if ((meta.mapping ?? '-') !== mapping) return 'mapping';
  if (meta.checkedAt === null || nowMs - meta.checkedAt >= EPG_REFRESH_MS) return 'stale';
  if (nowMs - meta.checkedAt < EPG_RETRY_MS) return null;
  if (typeof meta.until !== 'number' || meta.until * MINUTE - nowMs < EPG_AHEAD_MS) return 'running-out';
  return null;
}
