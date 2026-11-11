/**
 * The short-EPG fallback (architecture.md §1.5 item 1, RELAY step 9c). For a live channel of an
 * Xtream panel that no stored guide matches, the panel's own `get_short_epg` gives now/next.
 *
 * - The query worker asks for it (`QueryService.shortEpg`) only when the UI has kept the channel
 *   focused for 600 ms (`DataEngine.focusChannel`), and keeps each channel's answer for 30 min.
 * - The channel's panel: an Xtream source's account, or the account in an M3U source's `get.php`
 *   URL. The stream id comes from the channel's stream URL. Any other playlist has no panel.
 * - The cache is keyed by ContentKey, which holds no credentials. A failed request isn't kept,
 *   so the next focus asks again; two asks for one channel while a request runs share it.
 * - Error messages never hold the URL (`XtreamError`, `NetworkError`).
 */

import type { ContentKey, EpgProgramme, TextTransport, XtreamAccount } from '@lablo/core';
import { buildEpgBucket, epgNowNext, parseXtreamStreamUrl, xtreamEpgProgrammes, xtreamFromM3uUrl, xtreamShortEpg } from '@lablo/core';
import type { ByteTransport } from './bytes';
import { decodeUtf8 } from './bytes';

/** How long a channel's answer is kept. */
export const SHORT_EPG_TTL_MS = 30 * 60_000;
/** Programmes asked for: the one on air, the next, and two more for a preview. */
export const SHORT_EPG_LIMIT = 4;
/** Channels kept (the oldest answer goes first). */
const CACHE_SIZE = 200;

/** The catalog source a channel came from, as the app refreshes it (`IngestSource` fits). */
export type ShortEpgSource = { type: 'xtream'; account: XtreamAccount } | { type: 'm3u'; url: string };

export interface ShortEpgRequest {
  /** The channel (the cache is keyed by it). */
  key: ContentKey;
  /** The channel's stream URL: the stream id is read from it. */
  url: string;
  source: ShortEpgSource;
  /** The time now/next is read at (default: now). */
  at?: number;
}

/** Where a channel's short EPG is asked for. */
export interface ShortEpgTarget {
  account: XtreamAccount;
  streamId: string;
}

/**
 * The panel and stream id for a live channel, or `null` when it has none: the source must be
 * an Xtream panel (an Xtream source, or an M3U source whose URL is a `get.php` export), and the
 * channel's stream URL an Xtream live URL (`…/live/{u}/{p}/{id}.ts` or `…/{u}/{p}/{id}`). The
 * account always comes from the source, so credentials only go to the panel the user added.
 * (Not `parseContentKey`: the URL has the id for both kinds of source, and content-key.ts would
 * bring a JSON.stringify polyfill into the query worker.)
 */
export function shortEpgTarget(url: string, source: ShortEpgSource): ShortEpgTarget | null {
  const account = source.type === 'xtream' ? source.account : xtreamFromM3uUrl(source.url);
  const stream = account === null ? null : parseXtreamStreamUrl(url);
  return account !== null && stream !== null && stream.kind === 'live' ? { account, streamId: stream.id } : null;
}

/** Text over a byte transport (fetch already undoes a `Content-Encoding: gzip`). */
export function textTransport(bytes: ByteTransport): TextTransport {
  return {
    async get(url) {
      const res = await bytes.get(url);
      const text = decodeUtf8(res);
      return { status: res.status, read: () => text.read(), cancel: () => text.cancel() };
    },
  };
}

/** Now and next among a channel's short-EPG programmes. */
export function shortEpgNowNext(programmes: readonly EpgProgramme[], nowMs: number): { now: EpgProgramme | null; next: EpgProgramme | null } {
  // Copies: building a bucket sorts and cuts the rows it is given.
  return epgNowNext([buildEpgBucket('', 0, programmes.map((p) => ({ ...p })))], nowMs);
}

export interface ShortEpgAnswer {
  programmes: EpgProgramme[];
  /** From the cache: no request was made. */
  cached: boolean;
}

/** Asks panels for channels' short EPG, and keeps each answer for `SHORT_EPG_TTL_MS`. */
export class ShortEpgCache {
  private readonly kept = new Map<ContentKey, { at: number; programmes: EpgProgramme[] }>();
  private readonly running = new Map<ContentKey, Promise<EpgProgramme[]>>();
  private readonly text: TextTransport;

  constructor(
    transport: ByteTransport,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.text = textTransport(transport);
  }

  /** The channel's programmes, from the cache while its answer is under 30 min old. */
  async programmes(key: ContentKey, target: ShortEpgTarget): Promise<ShortEpgAnswer> {
    const hit = this.kept.get(key);
    if (hit !== undefined && this.now() - hit.at < SHORT_EPG_TTL_MS) return { programmes: hit.programmes, cached: true };
    let request = this.running.get(key);
    if (request === undefined) {
      request = this.ask(key, target);
      this.running.set(key, request);
    }
    return { programmes: await request, cached: false };
  }

  private async ask(key: ContentKey, target: ShortEpgTarget): Promise<EpgProgramme[]> {
    try {
      // Not `XtreamClient`: it would bring the list parser into the query worker.
      const programmes = xtreamEpgProgrammes(await xtreamShortEpg(target.account, this.text, target.streamId, SHORT_EPG_LIMIT));
      this.kept.delete(key);
      this.kept.set(key, { at: this.now(), programmes });
      while (this.kept.size > CACHE_SIZE) this.kept.delete(this.kept.keys().next().value as ContentKey);
      return programmes;
    } finally {
      this.running.delete(key);
    }
  }
}
