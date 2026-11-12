/**
 * A show's seasons and episodes from its Xtream panel (architecture.md §1.4, RELAY step 27b):
 * `get_series_info`, asked only when the user opens the show's details, and kept 24 h per show.
 *
 * - The panel is the show's source's: an Xtream source's account (an M3U source's `get.php` link
 *   has one too, but such a playlist lists episodes, never shows). The panel's id for the show
 *   comes from its key (`x:<src>:series:<id>`): a show's catalog item has no URL.
 * - The cache (`PanelAnswers`) works as the movies' (`vod-info.ts`): a failed request isn't
 *   kept, a panel's "not found" (`null`) is, and two asks for one show share a request. It keeps
 *   fewer shows than movies: a show's answer holds all of its episodes.
 * - The episodes' URLs hold the account's credentials, as the catalog's do. Error messages never
 *   hold the request's URL (`XtreamError`, `NetworkError`).
 * - Not `XtreamClient`: it would bring the list parser into the query worker.
 */

import type { ContentKey, TextTransport, XtreamAccount, XtreamSeriesInfo } from '@lablo/core';
import { decodeSeriesInfo, parseContentKey, xtreamApiUrl, xtreamJson } from '@lablo/core';
import { PanelAnswers } from './panel-answers';

/** How long a show's answer is kept. */
export const SERIES_INFO_TTL_MS = 24 * 3_600_000;
/** Shows kept (the oldest answer goes first). */
const CACHE_SIZE = 20;

/** A show whose details opened. */
export interface SeriesInfoRequest {
  /** Its source's id: the panel is that source's. */
  src: string;
  /** The show (`x:<src>:series:<id>`): the cache is keyed by it, and the panel's id read from it. */
  key: ContentKey;
}

/** Where a show's details are asked for. */
export interface SeriesInfoTarget {
  account: XtreamAccount;
  seriesId: string;
}

/**
 * The panel and the panel's id for a show, or `null` when it has none: the source must be an
 * Xtream panel (`account`, from `sourceAccount`) and the key an Xtream show's of that source.
 * The account always comes from the source, so credentials only go to the panel the user added.
 */
export function seriesInfoTarget(src: string, key: ContentKey, account: XtreamAccount | null): SeriesInfoTarget | null {
  if (account === null) return null;
  const parsed = parseContentKey(key);
  return parsed !== null && parsed.type === 'xtream' && parsed.kind === 'series' && parsed.src === src ? { account, seriesId: parsed.id } : null;
}

/** Asks panels for shows' seasons and episodes, and keeps each answer for `SERIES_INFO_TTL_MS`. */
export class SeriesInfoCache {
  private readonly answers: PanelAnswers<XtreamSeriesInfo>;

  constructor(
    private readonly text: TextTransport,
    now: () => number = () => Date.now(),
  ) {
    this.answers = new PanelAnswers<XtreamSeriesInfo>(SERIES_INFO_TTL_MS, CACHE_SIZE, now);
  }

  /**
   * The show's details (`null`: the panel doesn't know it), from the cache while its answer is
   * under 24 h old. Its episodes' keys are of `src`, their URLs of the target's account.
   */
  info(src: string, key: ContentKey, target: SeriesInfoTarget): Promise<XtreamSeriesInfo | null> {
    return this.answers.get(key, async () =>
      decodeSeriesInfo(await xtreamJson(this.text, xtreamApiUrl(target.account, 'get_series_info', { series_id: target.seriesId })), { src, account: target.account }),
    );
  }
}
