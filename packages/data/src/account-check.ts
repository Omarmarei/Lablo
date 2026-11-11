/**
 * The account re-check behind the player's error card (RELAY step 20a, architecture.md §2 "Error
 * classifier"). When the player gives up on a stream with a provider or device verdict, it asks
 * the channel's Xtream panel how the account stands (`player_api.php` without an action), so the
 * card can say "expired", "blocked", "login refused" or "2 of 2 connections in use" instead of a
 * bare stream error.
 *
 * - The panel is the source's: an Xtream source's account, or the account in an M3U source's
 *   `get.php` link. A plain playlist has no panel (`null`).
 * - A panel that refuses the login (HTTP 401/403) is `auth: false`. Other failures reject (the
 *   player then shows the stream's own failure); the error never holds the URL.
 * - Not `XtreamClient`: it would bring the list parser into the query worker.
 */

import type { TextTransport, XtreamAccount, XtreamUserInfo } from '@lablo/core';
import { XtreamError, decodeLogin, xtreamApiUrl, xtreamFromM3uUrl, xtreamJson } from '@lablo/core';
import type { SourceRecord } from './profile';

/** What the re-check says (the player's `AccountStatus` has the same shape). */
export type AccountCheck = Pick<XtreamUserInfo, 'auth' | 'status' | 'expDate' | 'activeCons' | 'maxConnections'>;

/** A panel that refused the login outright (HTTP 401 or 403). */
export const LOGIN_REFUSED: AccountCheck = { auth: false, status: '', expDate: null, activeCons: null, maxConnections: null };

/** The Xtream account behind a stored source, or `null` for a playlist with no panel. */
export function sourceAccount(source: SourceRecord): XtreamAccount | null {
  return source.type === 'xtream' ? source.account : xtreamFromM3uUrl(source.url);
}

/** Asks the panel how `account` stands; `null` when the answer has no `user_info`. */
export async function checkAccount(account: XtreamAccount, transport: TextTransport): Promise<AccountCheck | null> {
  let answer: unknown;
  try {
    answer = await xtreamJson(transport, xtreamApiUrl(account));
  } catch (error) {
    if (error instanceof XtreamError && error.code === 'auth') return LOGIN_REFUSED;
    throw error;
  }
  const login = decodeLogin(answer);
  if (login === null) return null;
  const user = login.user;
  return { auth: user.auth, status: user.status, expDate: user.expDate, activeCons: user.activeCons, maxConnections: user.maxConnections };
}
