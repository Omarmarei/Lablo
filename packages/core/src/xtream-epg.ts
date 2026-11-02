/**
 * The Xtream short EPG (`get_short_epg`, `get_simple_data_table`): decoding, the request, and
 * guide programmes from it. In a file of its own (RELAY step 9c), so the query worker, which
 * asks for a focused channel's short EPG, doesn't take the list parser along.
 */

import type { EpgProgramme } from './epg-guide';
import { EPG_DEFAULT_LENGTH, EPG_FLAG_CUT, EPG_FLAG_STOP_GUESSED, EPG_MAX_LENGTH } from './epg-guide';
import { cutText, decodeBase64Utf8 } from './text';
import type { TextTransport } from './xtream-base';
import { isObj, positiveInt, xFlag, xText, xtreamJson } from './xtream-base';
import type { XtreamAccount } from './xtream-url';
import { xtreamApiUrl } from './xtream-url';

export interface XtreamEpgEntry {
  title: string;
  description: string;
  /** Epoch ms from `start_timestamp`; `null` when the panel gave none. */
  startMs: number | null;
  endMs: number | null;
  /** `start`/`end` as written (wall time in the panel's zone). */
  start: string;
  end: string;
  /** `get_simple_data_table` only. */
  nowPlaying: boolean | null;
  hasArchive: boolean | null;
}

/** Base64 text as panels send EPG titles; plain text when it isn't base64. */
function epgText(v: unknown, max: number): string {
  const raw = xText(v);
  return cutText(decodeBase64Utf8(raw) ?? raw, max);
}

/** Decodes `get_short_epg` / `get_simple_data_table` (`{ epg_listings: [...] }`). */
export function decodeShortEpg(v: unknown): XtreamEpgEntry[] {
  const list = isObj(v) ? v['epg_listings'] : v;
  if (!Array.isArray(list)) return [];
  const out: XtreamEpgEntry[] = [];
  for (const e of list) {
    if (!isObj(e)) continue;
    const start = positiveInt(e['start_timestamp']);
    const stop = positiveInt(e['stop_timestamp']) ?? positiveInt(e['end_timestamp']);
    out.push({
      title: epgText(e['title'], 256),
      description: epgText(e['description'], 1000),
      startMs: start === null ? null : start * 1000,
      endMs: stop === null ? null : stop * 1000,
      start: xText(e['start']),
      end: xText(e['end']) || xText(e['stop']),
      nowPlaying: 'now_playing' in e ? xFlag(e['now_playing']) : null,
      hasArchive: 'has_archive' in e ? xFlag(e['has_archive']) : null,
    });
  }
  return out;
}

const MINUTE_MS = 60_000;

/**
 * The short EPG as guide programmes (UTC epoch minutes, the shape `EpgGuideReader` stores), in
 * time order, so now/next reads the same whichever way it came (RELAY step 9c):
 * - an entry without `start_timestamp` is skipped: its wall-clock `start` would need the panel's
 *   zone, and the timestamp is what panels get right;
 * - a missing (or not later) stop becomes the next start, or `EPG_DEFAULT_LENGTH` for the last
 *   entry (`EPG_FLAG_STOP_GUESSED`), and a length over `EPG_MAX_LENGTH` is cut (`EPG_FLAG_CUT`);
 * - equal starts keep the first entry, as in a guide.
 */
export function xtreamEpgProgrammes(entries: readonly XtreamEpgEntry[]): EpgProgramme[] {
  const timed: { e: XtreamEpgEntry; start: number; i: number }[] = [];
  entries.forEach((e, i) => {
    if (e.startMs !== null) timed.push({ e, start: Math.floor(e.startMs / MINUTE_MS), i });
  });
  // Array.prototype.sort isn't stable on Chromium 53: the index breaks ties.
  timed.sort((a, b) => a.start - b.start || a.i - b.i);
  const out: EpgProgramme[] = [];
  timed.forEach(({ e, start }, k) => {
    if (k > 0 && timed[k - 1]!.start === start) return;
    let flags = 0;
    let end = e.endMs === null ? start : Math.floor(e.endMs / MINUTE_MS);
    if (end <= start) {
      flags |= EPG_FLAG_STOP_GUESSED;
      let next: number | null = null;
      for (let j = k + 1; j < timed.length && next === null; j++) if (timed[j]!.start > start) next = timed[j]!.start;
      end = next ?? start + EPG_DEFAULT_LENGTH;
    }
    if (end - start > EPG_MAX_LENGTH) {
      end = start + EPG_MAX_LENGTH;
      flags |= EPG_FLAG_CUT;
    }
    out.push({ start, end, title: e.title, sub: '', desc: e.description, category: '', episode: '', flags });
  });
  return out;
}

/** A live stream's next programmes from its panel (`XtreamClient.shortEpg` is the same call). */
export async function xtreamShortEpg(account: XtreamAccount, transport: TextTransport, streamId: string | number, limit = 4): Promise<XtreamEpgEntry[]> {
  return decodeShortEpg(await xtreamJson(transport, xtreamApiUrl(account, 'get_short_epg', { stream_id: streamId, limit })));
}
