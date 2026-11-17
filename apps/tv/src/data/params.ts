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

/** One parameter of a query string (`?a=1&b=2`), decoded (`+` as a space), or null when absent. */
export function readParam(head: string, name: string): string | null {
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

/** Every value of one parameter, decoded (`+` as a space) and trimmed, in order; empty and broken ones left out. */
export function readParams(head: string, name: string): string[] {
  const found: string[] = [];
  for (const pair of head.replace(/^\?/, '').split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1 || pair.slice(0, eq) !== name) continue;
    const value = decode(pair.slice(eq + 1), true);
    if (value !== null && value.trim() !== '') found.push(value.trim());
  }
  return found;
}

/** The parameters before `source` (whose value runs to the end of the address). */
function headOf(search: string): string {
  const match = SOURCE.exec(search);
  return match === null ? search : search.slice(0, match.index);
}

/**
 * The hello screen's blocklist probes (RELAY step 30c1): each `?check=<url>`, in order, before
 * `source` (percent-encode a URL with its own `&`). The config row asks `blocked` about them.
 */
export function readChecks(search: string): string[] {
  return readParams(headOf(search), 'check');
}

/** `http(s)://host[:port]` and nothing after it but one slash: the host as `[1]`. */
const ORIGIN = /^https?:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?\/?$/;
/** Hosts that name this device: a TV build takes `?api=` only for them. */
const LOOPBACK = /^(?:127\.0\.0\.1|localhost|\[::1\])$/i;

/**
 * The config's API base for this run (RELAY step 30c1): `?api=<origin>` before `source`, so the
 * e2e tests and the old-engine harness can serve a config of their own; otherwise `fallback`
 * (the build's `__API_BASE__`).
 *
 * Only an origin is taken (`http(s)://host[:port]`, one trailing slash dropped), and in a TV
 * build only one on this device (`127.0.0.1`, `localhost`, `[::1]`): a store build's address
 * can't point the app at another server. The desktop dev app (`devApp`) takes any origin.
 */
export function readApiBase(search: string, fallback: string, devApp: boolean): string {
  const value = readParams(headOf(search), 'api')[0];
  if (value === undefined) return fallback;
  const origin = ORIGIN.exec(value);
  if (origin === null) return fallback;
  if (!devApp && !LOOPBACK.test(origin[1]!)) return fallback;
  return value.replace(/\/$/, '');
}

/**
 * The screen the app opens on: onboarding (RELAY step 13a), or a developer screen: the hello
 * screen's diagnostics (`?screen=hello`, which the old-engine harness's data runs use) or the
 * component gallery (`?screen=gallery`, step 11b) and its grid guide page (`?screen=gallery-guide`,
 * step 23b).
 */
export type AppScreen = 'onboarding' | 'hello' | 'gallery' | 'gallery-guide';

/** `?screen=hello`, `?screen=gallery` or `?screen=gallery-guide` open those screens; anything else onboarding. */
export function readScreen(search: string): AppScreen {
  const match = SOURCE.exec(search);
  const screen = readParam(match === null ? search : search.slice(0, match.index), 'screen');
  return screen === 'gallery' || screen === 'gallery-guide' || screen === 'hello' ? screen : 'onboarding';
}
