/**
 * Xtream Codes addresses: the server base a user types, the API and stream URLs built from it,
 * and the reverse: reading an Xtream account out of an M3U link (`get.php?username=…`) or an
 * Xtream-shaped stream URL. The M3U→Xtream upgrade (PLAN.md §4) and `catchup="xc"` use the
 * reverse direction.
 *
 * Every URL here carries credentials: never log one, never key on one, never send one anywhere
 * but the provider (CLAUDE.md legal guardrails).
 */

export interface XtreamAccount {
  /** `scheme://host[:port][/path]`, no trailing slash: what `normalizeXtreamBase` returns. */
  base: string;
  username: string;
  password: string;
}

export type XtreamStreamKind = 'live' | 'movie' | 'series';

/** An Xtream stream URL taken apart. */
export interface XtreamStreamUrl extends XtreamAccount {
  kind: XtreamStreamKind;
  /** The stream (or episode) id, digits only. */
  id: string;
  /** Extension without the dot (`ts`, `m3u8`, `mp4`…), or `null` when the URL has none. */
  ext: string | null;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
/** Pages a pasted panel URL may end in; the base is what comes before them. */
const PANEL_PAGES = /\/(?:player_api|panel_api|get|xmltv)\.php$/i;
const EXT = /^[a-z0-9]{1,5}$/i;
const DIGITS = /^\d{1,19}$/;

/** `encodeURIComponent` for a path segment or query value (credentials can hold `/?&#@+ `). */
const enc = encodeURIComponent;

/**
 * The server address as a base URL, from what a user typed: `example.com:8080`,
 * `http://example.com:8080/`, or a pasted `…/player_api.php?username=…`. `http://` is assumed
 * when no scheme is given. `null` when it is not an http(s) address with a host.
 */
export function normalizeXtreamBase(input: string): string | null {
  let text = input.trim();
  if (text.length === 0 || /\s/.test(text)) return null;
  const scheme = SCHEME.exec(text);
  if (!scheme) text = `http://${text}`;
  else if (!/^https?$/i.test(scheme[1]!)) return null;
  const cut = text.search(/[?#]/);
  if (cut !== -1) text = text.slice(0, cut);
  const authorityStart = text.indexOf('://') + 3;
  const slash = text.indexOf('/', authorityStart);
  const authority = slash === -1 ? text.slice(authorityStart) : text.slice(authorityStart, slash);
  // Credentials in the authority (`user:pass@host`) are not an Xtream login; reject them.
  if (authority.length === 0 || authority.indexOf('@') !== -1 || !/^[^:/]+(?::\d{1,5})?$/.test(authority)) return null;
  let path = slash === -1 ? '' : text.slice(slash);
  path = path.replace(PANEL_PAGES, '').replace(/\/+$/, '');
  return `${text.slice(0, authorityStart).toLowerCase()}${authority.toLowerCase()}${path}`;
}

function query(params: Record<string, string | number | undefined>): string {
  let out = '';
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined) continue;
    out += `&${key}=${enc(String(value))}`;
  }
  return out;
}

/** `player_api.php` with the credentials, plus `action` and any extra parameters. */
export function xtreamApiUrl(account: XtreamAccount, action?: string, params: Record<string, string | number | undefined> = {}): string {
  return `${account.base}/player_api.php?username=${enc(account.username)}&password=${enc(account.password)}${query({ action, ...params })}`;
}

/** The account's M3U export (`get.php`, m3u_plus, TS output). */
export function xtreamM3uUrl(account: XtreamAccount, output: 'ts' | 'm3u8' = 'ts'): string {
  return `${account.base}/get.php?username=${enc(account.username)}&password=${enc(account.password)}&type=m3u_plus&output=${output}`;
}

/** The account's XMLTV guide (`xmltv.php`). */
export function xtreamXmltvUrl(account: XtreamAccount): string {
  return `${account.base}/xmltv.php?username=${enc(account.username)}&password=${enc(account.password)}`;
}

/** A sanitized file extension: `fallback` when the panel sent nothing usable. */
export function streamExtension(ext: string | null | undefined, fallback: string): string {
  if (typeof ext !== 'string') return fallback;
  const text = ext.trim().replace(/^\./, '').toLowerCase();
  return EXT.test(text) ? text : fallback;
}

/** `/live/`, `/movie/` or `/series/` URL of a stream or episode id. */
export function xtreamStreamUrl(account: XtreamAccount, kind: XtreamStreamKind, id: string | number, ext: string): string {
  return `${account.base}/${kind}/${enc(account.username)}/${enc(account.password)}/${enc(String(id))}.${ext}`;
}

/** Splits `scheme://authority/path?query#fragment`; `null` without an http(s) scheme or host. */
function splitUrl(url: string): { origin: string; path: string; query: string } | null {
  const text = url.trim();
  const scheme = SCHEME.exec(text);
  if (!scheme || !/^https?$/i.test(scheme[1]!)) return null;
  const hash = text.indexOf('#');
  const noHash = hash === -1 ? text : text.slice(0, hash);
  const q = noHash.indexOf('?');
  const beforeQuery = q === -1 ? noHash : noHash.slice(0, q);
  const authorityStart = beforeQuery.indexOf('://') + 3;
  const slash = beforeQuery.indexOf('/', authorityStart);
  const authority = slash === -1 ? beforeQuery.slice(authorityStart) : beforeQuery.slice(authorityStart, slash);
  if (authority.length === 0 || authority.indexOf('@') !== -1) return null;
  return {
    origin: `${beforeQuery.slice(0, authorityStart).toLowerCase()}${authority.toLowerCase()}`,
    path: slash === -1 ? '' : beforeQuery.slice(slash),
    query: q === -1 ? '' : noHash.slice(q + 1),
  };
}

/** Decodes a percent-encoded path segment; the raw text when the encoding is broken. */
function decodeSegment(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Query parameters, form-decoded the way PHP panels read them (`+` is a space); first value wins. */
export function parseQuery(text: string): Map<string, string> {
  const out = new Map<string, string>();
  if (text.length === 0) return out;
  for (const part of text.split('&')) {
    if (part.length === 0) continue;
    const eq = part.indexOf('=');
    const key = decodeSegment((eq === -1 ? part : part.slice(0, eq)).replace(/\+/g, ' '));
    const value = eq === -1 ? '' : decodeSegment(part.slice(eq + 1).replace(/\+/g, ' '));
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/**
 * The Xtream account behind an M3U link such as
 * `http://host:8080/get.php?username=u&password=p&type=m3u_plus&output=ts`, so the app can offer
 * the Xtream API instead (categories, metadata, catch-up). Also accepts pasted `player_api.php`,
 * `panel_api.php` and `xmltv.php` links. `null` for any other URL.
 */
export function xtreamFromM3uUrl(url: string): XtreamAccount | null {
  const parts = splitUrl(url);
  if (!parts) return null;
  const page = PANEL_PAGES.exec(parts.path);
  if (!page) return null;
  const params = parseQuery(parts.query);
  const username = params.get('username');
  const password = params.get('password');
  if (username === undefined || password === undefined || username.length === 0 || password.length === 0) return null;
  return { base: `${parts.origin}${parts.path.slice(0, page.index).replace(/\/+$/, '')}`, username, password };
}

/**
 * Takes apart an Xtream-shaped stream URL: `…/live|movie|series/{u}/{p}/{id}.{ext}`, or the
 * short live form `http://host:port/{u}/{p}/{id}` (exactly three path segments). `null` for
 * anything else.
 */
export function parseXtreamStreamUrl(url: string): XtreamStreamUrl | null {
  const parts = splitUrl(url);
  if (!parts) return null;
  const segments = parts.path.split('/');
  // segments[0] is '' (the path starts with '/').
  if (segments.length < 4 || segments[0] !== '') return null;
  const file = segments[segments.length - 1]!;
  const dot = file.lastIndexOf('.');
  const id = dot === -1 ? file : file.slice(0, dot);
  const ext = dot === -1 ? null : file.slice(dot + 1);
  if (!DIGITS.test(id) || (ext !== null && !EXT.test(ext))) return null;
  const n = segments.length;
  const marker = n >= 5 ? segments[n - 4]!.toLowerCase() : '';
  let kind: XtreamStreamKind;
  let prefixEnd: number;
  if (marker === 'live' || marker === 'movie' || marker === 'series') {
    kind = marker;
    prefixEnd = n - 4;
  } else if (n === 4) {
    kind = 'live';
    prefixEnd = 1;
  } else {
    return null;
  }
  const username = decodeSegment(segments[n - 3]!);
  const password = decodeSegment(segments[n - 2]!);
  if (username.length === 0 || password.length === 0) return null;
  const prefix = segments.slice(0, prefixEnd).join('/');
  return { base: `${parts.origin}${prefix}`, username, password, kind, id, ext: ext === null ? null : ext.toLowerCase() };
}
