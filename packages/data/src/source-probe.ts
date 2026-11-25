/**
 * Settings › "Check the connection" (RELAY step 40a): asks each source's server how it stands,
 * the way the app reads it, so the page can tell the viewer whether a problem is the internet's,
 * the provider's or the app's (PLAN.md §4 pillar 4, "Is it the app or my provider?").
 *
 * - **An Xtream source** (or an M3U source's `get.php` link): its panel's `player_api.php`, as the
 *   player's account re-check asks it: the HTTP status, the time to the answer's headers, and the
 *   account (`accountOf`; `LOGIN_REFUSED` for 401 and 403).
 * - **A plain M3U link:** a GET of the playlist, its status and time, and whether its first bytes
 *   start a playlist (`#EXT`, past a byte-order mark and blank space); the rest is never read.
 * - **No server:** a file from the phone (`file`); a source a backup brought back without its
 *   login (`no-login`, step 32d4a).
 * - Each source within `PROBE_TIMEOUT_MS`: no headers by then is `timeout` (headers after it are
 *   cancelled); a body still coming then is cut, and the answer says what was read. A connection
 *   that fails is `unreachable`. Nothing here holds or throws the URL: it carries the login.
 * - Run in a fresh ingest worker (`IngestService`'s `probe`), which writes nothing.
 */

import { xtreamApiUrl } from '@lablo/core';
import type { AccountCheck } from './account-check';
import { LOGIN_REFUSED, accountOf, sourceAccount } from './account-check';
import type { ByteResponse, ByteTransport } from './bytes';
import { decodeUtf8 } from './bytes';
import type { StoredSource } from './profile';

/** How long one source's server gets to answer (its headers and the bytes read after them). */
export const PROBE_TIMEOUT_MS = 10_000;

/** Past this much of a panel's `player_api.php` answer (UTF-16 code units; it is a few hundred) the reading stops. */
export const PROBE_ANSWER_MAX = 65_536;

/** The most of a playlist read to see whether it starts like one. */
const PLAYLIST_HEAD = 1024;

/** What the check found for one source. */
export type SourceProbe =
  /** A file sent from the phone: no server to ask. */
  | { readonly kind: 'file' }
  /** Brought back by a backup without its login (step 32d4a): nothing can be asked. */
  | { readonly kind: 'no-login' }
  /** Its server is on the config's blocklist (the data engine's answer): never asked. */
  | { readonly kind: 'blocked' }
  /** The check itself failed (the worker): nothing is known. */
  | { readonly kind: 'error' }
  /** The connection failed: no HTTP answer. */
  | { readonly kind: 'unreachable' }
  /** No answer within `PROBE_TIMEOUT_MS`. */
  | { readonly kind: 'timeout' }
  | {
      readonly kind: 'answered';
      /** The HTTP status. */
      readonly status: number;
      /** Milliseconds from the request to the answer's headers. */
      readonly ms: number;
      /** A panel's account (`null`: a plain playlist, or an answer without `user_info`). */
      readonly account: AccountCheck | null;
      /** A plain playlist's first bytes start one (`null`: a panel, or an error status). */
      readonly playlist: boolean | null;
    };

const FILE: SourceProbe = { kind: 'file' };
const NO_LOGIN: SourceProbe = { kind: 'no-login' };
const UNREACHABLE: SourceProbe = { kind: 'unreachable' };
const TIMEOUT: SourceProbe = { kind: 'timeout' };

export interface ProbeOptions {
  readonly transport: ByteTransport;
  readonly now: () => number;
  /** Tests shorten it. */
  readonly timeoutMs?: number;
}

/** Asks `source`'s server how it stands (see the file's comment). Never rejects. */
export function probeSource(source: StoredSource, options: ProbeOptions): Promise<SourceProbe> {
  if (source.type === 'm3u-file') return Promise.resolve(FILE);
  if (source.type === 'xtream' ? source.account === null : source.url === null) return Promise.resolve(NO_LOGIN);
  const account = sourceAccount(source);
  const url = account !== null ? xtreamApiUrl(account) : (source as { url: string }).url;
  let late = false;
  let held: ByteResponse | null = null;
  const asked = ask(url, account !== null, options, (res) => {
    held = res;
    return late;
  });
  return new Promise<SourceProbe>((resolve) => {
    const timer = setTimeout(() => {
      late = true;
      // The headers came: the reading stops, and the answer says what was read. Else none came.
      if (held !== null) held.cancel();
      else resolve(TIMEOUT);
    }, options.timeoutMs ?? PROBE_TIMEOUT_MS);
    asked.then(
      (probe) => {
        clearTimeout(timer);
        resolve(probe);
      },
      () => {
        clearTimeout(timer);
        resolve(UNREACHABLE);
      },
    );
  });
}

/**
 * One request: `arrived` is told of the response as it comes and answers whether the time was
 * already up (the response is then cancelled, and nothing is read).
 */
async function ask(url: string, panel: boolean, options: ProbeOptions, arrived: (res: ByteResponse) => boolean): Promise<SourceProbe> {
  const start = options.now();
  let res: ByteResponse;
  try {
    res = await options.transport.get(url);
  } catch {
    return UNREACHABLE;
  }
  const ms = options.now() - start;
  if (arrived(res)) {
    res.cancel();
    return TIMEOUT;
  }
  const status = res.status;
  if (status < 200 || status >= 300) {
    res.cancel();
    return { kind: 'answered', status, ms, account: panel && (status === 401 || status === 403) ? LOGIN_REFUSED : null, playlist: null };
  }
  const text = await head(res, panel ? PROBE_ANSWER_MAX : PLAYLIST_HEAD);
  if (!panel) return { kind: 'answered', status, ms, account: null, playlist: text !== null && startsPlaylist(text) };
  let account: AccountCheck | null = null;
  if (text !== null) {
    try {
      account = accountOf(JSON.parse(text));
    } catch {
      account = null;
    }
  }
  return { kind: 'answered', status, ms, account, playlist: null };
}

/**
 * The answer's text, the reading stopped (and the rest cancelled) once `max` code units are in;
 * `null` when the connection broke while it was read.
 */
async function head(res: ByteResponse, max: number): Promise<string | null> {
  const source = decodeUtf8(res);
  let text = '';
  try {
    for (;;) {
      const chunk = await source.read();
      if (chunk === null) return text;
      text += chunk;
      if (text.length >= max) {
        source.cancel();
        return text;
      }
    }
  } catch {
    source.cancel();
    return null;
  }
}

/** Whether a playlist's first text starts like one: `#EXT…` past a byte-order mark and blank space. */
export function startsPlaylist(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c !== 0xfeff && c !== 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) break;
    i++;
  }
  return text.slice(i, i + 4).toUpperCase() === '#EXT';
}
