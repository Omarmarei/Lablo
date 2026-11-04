/**
 * The error classifier (architecture.md §2, complaint #9): every playback failure the player
 * gives up on becomes one of four categories the user can act on, with a diagnostic code for
 * support and telemetry. Codes never hold a URL, host or channel name.
 *
 * | Category | When |
 * |---|---|
 * | `internet` | the TV is offline (the app's connectivity check says so) |
 * | `provider` | the account (auth, expired, blocked, connection limit), HTTP errors, unreachable or silent streams, broken stream data |
 * | `device` | the TV can't play the format or codec (unless the account re-check finds a problem: panels answer an expired account with a page or clip a `<video>` calls unsupported) |
 * | `app` | anything else (a bug, an unexpected engine state) |
 */

import type { XtreamUserInfo } from '@zoma/core';
import { xtreamAccountProblem } from '@zoma/core';
import type { PlaybackError } from './engine';

export type FailureCategory = 'internet' | 'provider' | 'device' | 'app';

/** What a re-check of the account (Xtream `player_api.php`) said, shown on the error card. */
export type AccountStatus = Pick<XtreamUserInfo, 'auth' | 'status' | 'expDate' | 'activeCons' | 'maxConnections'>;

export interface PlaybackFailure {
  readonly category: FailureCategory;
  /** `NET-OFFLINE`, `PRV-HTTP-404`, `TV-UNSUPPORTED`… */
  readonly code: string;
  /** The engine's or watchdog's own code (`MEDIA_ERR_DECODE`, `FROZEN`), for support. */
  readonly detail: string;
  /** The account re-check after a provider failure, when one was made and answered. */
  readonly account: AccountStatus | null;
}

/** The categories after which the player re-checks the account (the stream may hide an account problem). */
export function wantsAccountCheck(category: FailureCategory): boolean {
  return category === 'provider' || category === 'device';
}

export interface FailureFacts {
  readonly error: PlaybackError;
  /** The TV can reach the internet (beyond the stream's own host, where the app can tell). */
  readonly online: boolean;
  /** The account re-check's answer, or `null` when none was made or it failed. */
  readonly account?: AccountStatus | null;
}

/** The account's own problem, if it has one: refused login, expired, blocked, or at its connection limit. */
function accountCode(account: AccountStatus): string | null {
  if (!account.auth) return 'PRV-AUTH';
  const problem = xtreamAccountProblem(account);
  if (problem === 'expired') return 'PRV-EXPIRED';
  if (problem === 'blocked') return 'PRV-BLOCKED';
  const max = account.maxConnections;
  if (max !== null && max > 0 && account.activeCons !== null && account.activeCons >= max) return 'PRV-MAX-CONNECTIONS';
  return null;
}

/** The category and code of a failure (first rule that applies). */
export function classifyFailure(facts: FailureFacts): PlaybackFailure {
  const { error } = facts;
  const account = facts.account ?? null;
  const make = (category: FailureCategory, code: string): PlaybackFailure => ({ category, code, detail: error.code, account });
  if (!facts.online) return make('internet', 'NET-OFFLINE');
  if (error.kind === 'app') return make('app', 'APP-ERROR');
  // Before `unsupported`: panels answer an expired or blocked account with an error page or a
  // short "expired" clip, which a `<video>` reports as an unsupported format.
  if (account !== null) {
    const code = accountCode(account);
    if (code !== null) return make('provider', code);
  }
  switch (error.kind) {
    case 'unsupported':
      return make('device', 'TV-UNSUPPORTED');
    case 'http':
      return make('provider', error.status === undefined ? 'PRV-HTTP' : `PRV-HTTP-${error.status}`);
    case 'network':
      return make('provider', 'PRV-UNREACHABLE');
    case 'timeout':
      return make('provider', 'PRV-TIMEOUT');
    case 'stall':
      return make('provider', 'PRV-STALLED');
    case 'decode':
      return make('provider', 'PRV-BAD-STREAM');
  }
}

/**
 * An error that a retry of the same URL can't fix: the format is unsupported, or the server
 * refused the request (4xx other than 408 timeout and 429 too many requests). Another URL
 * (the other container) may still play.
 */
export function isDefinitive(error: PlaybackError): boolean {
  if (error.kind === 'unsupported') return true;
  if (error.kind !== 'http' || error.status === undefined) return false;
  return error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}
