/**
 * The hello screen's catalog debug parameters (RELAY step 8b), read from `location.search`:
 *
 *   ?screen=hello&q=news&source=http://127.0.0.1:8080/get.php?username=…&password=…&type=m3u_plus
 *
 * - `source` must come **last**: its value runs to the end of the address, so a playlist URL
 *   with its own `?` and `&` can be pasted as it is. A percent-encoded value works too.
 * - `q` is a search run after the refresh (or over the stored catalog when there is no source).
 * - `force=1` rebuilds the catalog even when the playlist hasn't changed (the old-engine harness
 *   uses it, so every run really downloads, parses and commits).
 *
 * Hand-parsed on purpose: `URLSearchParams` would pull core-js's URL polyfill (about 25 KB)
 * into the TV bundle. The onboarding screens (RELAY step 13) replace this debug path.
 */

export interface DebugParams {
  /** The playlist URL to ingest, or null. */
  readonly source: string | null;
  /** The search to run, or null. */
  readonly query: string | null;
  /** Ignore validators and the byte hash: always commit a new generation. */
  readonly force: boolean;
  /** Why `source` was rejected (it is then null). */
  readonly error: string | null;
}

const SOURCE = /(?:^\?|&)source=/;
const HTTP_URL = /^https?:\/\/[^/?#\s]+/i;

function decode(value: string, plusIsSpace: boolean): string | null {
  try {
    return decodeURIComponent(plusIsSpace ? value.replace(/\+/g, ' ') : value);
  } catch {
    return null;
  }
}

function readParam(head: string, name: string): string | null {
  const pairs = head.replace(/^\?/, '').split('&');
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    if (key !== name) continue;
    return decode(eq === -1 ? '' : pair.slice(eq + 1), true);
  }
  return null;
}

export function readDebugParams(search: string): DebugParams {
  const match = SOURCE.exec(search);
  const head = match === null ? search : search.slice(0, match.index);
  const rawQuery = readParam(head, 'q');
  const query = rawQuery === null || rawQuery.trim() === '' ? null : rawQuery;
  const force = readParam(head, 'force') === '1';
  if (match === null) return { source: null, query, force, error: null };

  let source: string | null = search.slice(match.index + match[0].length);
  // An encoded value (`http%3A%2F%2F…`) is decoded; a pasted URL is taken as it is.
  if (source.indexOf('://') === -1) source = decode(source, false);
  source = source === null ? '' : source.trim();
  if (source === '') return { source: null, query, force, error: '?source= is empty' };
  if (!HTTP_URL.test(source)) return { source: null, query, force, error: '?source= must be an http:// or https:// URL' };
  return { source, query, force, error: null };
}

/**
 * The screen the app opens on: onboarding (RELAY step 13a), or a developer screen: the hello
 * screen's diagnostics (`?screen=hello`, which the old-engine harness's data runs use) or the
 * component gallery (`?screen=gallery`, step 11b).
 */
export type AppScreen = 'onboarding' | 'hello' | 'gallery';

/** `?screen=hello` or `?screen=gallery` open those screens; anything else onboarding. */
export function readScreen(search: string): AppScreen {
  const match = SOURCE.exec(search);
  const screen = readParam(match === null ? search : search.slice(0, match.index), 'screen');
  return screen === 'gallery' || screen === 'hello' ? screen : 'onboarding';
}
