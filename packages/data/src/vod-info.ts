/**
 * A movie's details from its Xtream panel (architecture.md §1.4, RELAY step 26c): `get_vod_info`,
 * asked only when the user opens the movie's details, and kept 24 h per movie.
 *
 * - The panel is the movie's source's: an Xtream source's account, or the account in an M3U
 *   source's `get.php` link. The panel's id for the movie comes from its URL
 *   (`…/movie/{u}/{p}/{id}.{ext}`). A plain playlist has no panel: its movies show what their
 *   lines have.
 * - The cache (`PanelAnswers`) is keyed by ContentKey, which holds no credentials. A failed
 *   request isn't kept, so the next open asks again; a panel's "not found" (`null`) is an answer
 *   and is kept. Two asks for one movie while a request runs share it.
 * - Error messages never hold the URL (`XtreamError`, `NetworkError`).
 * - Not `XtreamClient`: it would bring the list parser into the query worker.
 */

import type { ContentKey, TextTransport, XtreamAccount, XtreamVodInfo } from '@lablo/core';
import { decodeVodInfo, parseXtreamStreamUrl, xtreamApiUrl, xtreamJson } from '@lablo/core';
import { PanelAnswers } from './panel-answers';

/** How long a movie's answer is kept. */
export const VOD_INFO_TTL_MS = 24 * 3_600_000;
/** Movies kept (the oldest answer goes first). */
const CACHE_SIZE = 100;

/** A movie whose details opened. */
export interface VodInfoRequest {
  /** Its source's id: the panel is that source's. */
  src: string;
  /** The movie (the cache is keyed by it). */
  key: ContentKey;
  /** Its stream URL: the panel's id for it is read from it. */
  url: string;
}

/** Where a movie's details are asked for. */
export interface VodInfoTarget {
  account: XtreamAccount;
  vodId: string;
}

/**
 * The panel and the panel's id for a movie, or `null` when it has none: the source must be an
 * Xtream panel (`account`, from `sourceAccount`) and the movie's URL an Xtream movie URL. The
 * account always comes from the source, so credentials only go to the panel the user added.
 */
export function vodInfoTarget(url: string, account: XtreamAccount | null): VodInfoTarget | null {
  if (account === null) return null;
  const stream = parseXtreamStreamUrl(url);
  return stream !== null && stream.kind === 'movie' ? { account, vodId: stream.id } : null;
}

/** Asks panels for movies' details, and keeps each answer for `VOD_INFO_TTL_MS`. */
export class VodInfoCache {
  private readonly answers: PanelAnswers<XtreamVodInfo>;

  constructor(
    private readonly text: TextTransport,
    now: () => number = () => Date.now(),
  ) {
    this.answers = new PanelAnswers<XtreamVodInfo>(VOD_INFO_TTL_MS, CACHE_SIZE, now);
  }

  /** The movie's details (`null`: the panel doesn't know it), from the cache while its answer is under 24 h old. */
  info(key: ContentKey, target: VodInfoTarget): Promise<XtreamVodInfo | null> {
    return this.answers.get(key, async () => decodeVodInfo(await xtreamJson(this.text, xtreamApiUrl(target.account, 'get_vod_info', { vod_id: target.vodId }))));
  }
}
