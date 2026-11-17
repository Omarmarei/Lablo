/**
 * The signed config's blocklist on the TV (architecture.md §3.3 C, RELAY step 30b1): is a
 * provider's host, or one of its parents, among the doc's `blocklistHash(salt, host)` entries?
 * The app asks when a source is added (its API host), on refresh, and before playing (the
 * stream's host, and on Tizen the host after redirects), step 30c.
 *
 * Hosts are compared in the blocklist's form (`blocklistHost` in `@lablo/core`, which the signer
 * uses too): ASCII, lowercase, no trailing dot. A Unicode host is first mapped the way browsers
 * map one (UTS #46, simplified: NFKC, each code point lowercased, the ignored code points
 * dropped, NFC, the ideographic full stops read as dots, each non-ASCII label as `xn--`
 * punycode), so it hashes as its `xn--` form, the one an operator gives the signer. It follows the
 * current UTS #46 (Unicode 17): wherever Node 24's `url.domainToASCII` gives an answer,
 * `asciiHost` gives the same host (blocklist.test.ts), except where UTS #46 case-folds beyond
 * lowercase: the Greek letters with an iota subscript, the combining ypogegrammeni, the lunate and
 * mathematical final sigmas, the old Cyrillic letter variants (U+1C80 to U+1C88) and Cherokee;
 * and marks newer than Unicode 15. A Latin host is never one of those, and a table of them isn't
 * worth its bytes on a TV. Older IDNA (Node 22, the TV engines' own) maps a few letters
 * differently (U+1E9E to "ss"; Chromium before 110 also `ß` to "ss") and refuses some code points
 * the current one ignores; none of that touches a Latin host either.
 *
 * IP addresses are taken as written (`127.1` is not rewritten as `127.0.0.1`), as the signer
 * takes them (step 30a).
 *
 * The query worker keeps one `Blocklist`, from the cached config record (`cachedBlocklist`, step
 * 30b2), and answers the app's `blocked(urls)`.
 *
 * TV code (the query worker): no `URL` (core-js's URL polyfill is about 25 KB), no `split`, no
 * `Array.from`, no regex built from a string, no `Set`; non-ASCII code points are numbers.
 */
import { blocklistCandidates, blocklistHost } from '@lablo/core';
import { blocklistHash } from '@lablo/crypto';

/** Schemes whose URLs browsers parse as "special": `\` is a slash, and any slashes may follow the colon. */
const SPECIAL_SCHEMES = ['http', 'https', 'ws', 'wss', 'ftp'];

function isAsciiLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isSchemeChar(c: number): boolean {
  return isAsciiLetter(c) || (c >= 48 && c <= 57) || c === 43 /* + */ || c === 45 /* - */ || c === 46 /* . */;
}

/**
 * The host part of an absolute URL with an authority (`scheme://…`), as written: the login, port,
 * path, query and fragment dropped; an IPv6 address keeps its brackets. Tabs and line breaks
 * anywhere and controls or spaces at either end are ignored, as browsers ignore them. For http,
 * https, ws, wss and ftp, `\` counts as `/` and any number of slashes may follow the colon.
 * `null` when there is no host.
 */
export function urlHost(input: string): string | null {
  let url = '';
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c !== 9 && c !== 10 && c !== 13) url += input.charAt(i);
  }
  let start = 0;
  let end = url.length;
  while (start < end && url.charCodeAt(start) <= 32) start++;
  while (end > start && url.charCodeAt(end - 1) <= 32) end--;
  let at = start;
  if (!(at < end && isAsciiLetter(url.charCodeAt(at)))) return null;
  while (at < end && isSchemeChar(url.charCodeAt(at))) at++;
  if (!(at < end && url.charCodeAt(at) === 58 /* : */)) return null;
  const special = SPECIAL_SCHEMES.indexOf(url.slice(start, at).toLowerCase()) !== -1;
  at++;
  if (special) {
    while (at < end && (url.charCodeAt(at) === 47 /* / */ || url.charCodeAt(at) === 92 /* \ */)) at++;
  } else {
    if (!(url.charCodeAt(at) === 47 && url.charCodeAt(at + 1) === 47)) return null;
    at += 2;
  }
  let stop = at;
  for (; stop < end; stop++) {
    const c = url.charCodeAt(stop);
    if (c === 47 || c === 63 /* ? */ || c === 35 /* # */ || (special && c === 92)) break;
  }
  // The login ends at the authority's last `@` (a loop: `lastIndexOf` would pull an array polyfill).
  // Finding one moves `at` past `i`, which ends the loop.
  for (let i = stop - 1; i >= at; i--) if (url.charCodeAt(i) === 64 /* @ */) at = i + 1;
  let host: string;
  if (url.charCodeAt(at) === 91 /* [ */) {
    const close = url.indexOf(']', at);
    if (close === -1 || close >= stop) return null;
    host = url.slice(at, close + 1);
  } else {
    const port = url.indexOf(':', at);
    host = url.slice(at, port === -1 || port > stop ? stop : port);
  }
  return host.length > 0 ? host : null;
}

/**
 * The code points UTS #46 ignores (maps to nothing), as first-last pairs, as Node's ICU 78 has them
 * (blocklist.test.ts compares every code point): soft hyphen, combining grapheme joiner, the
 * Hangul fillers, the Khmer inherent vowels, the Mongolian free variation selectors and vowel
 * separator, zero width space, the invisible operators and deprecated format characters, the
 * variation selectors, the byte order mark, the shorthand format controls, the musical symbol
 * formatting characters, the variation selectors supplement. The two other Hangul fillers
 * (U+3164, U+FFA0) aren't listed: NFKC makes them U+1160 first.
 */
const IGNORED = [
  0xad, 0xad, 0x34f, 0x34f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180f, 0x200b, 0x200b, 0x2060, 0x2064, 0x206a, 0x206f, 0xfe00, 0xfe0f, 0xfeff, 0xfeff,
  0x1bca0, 0x1bca3, 0x1d173, 0x1d17a, 0xe0100, 0xe01ef,
];

function isIgnored(c: number): boolean {
  for (let i = 0; i < IGNORED.length; i += 2) if (c >= IGNORED[i]! && c <= IGNORED[i + 1]!) return true;
  return false;
}

/**
 * Each code point lowercased on its own (`toLowerCase` of a whole word turns a word-final capital
 * sigma into the final small sigma; UTS #46 maps it to the plain small sigma), the ignored ones
 * dropped.
 */
function lowerEach(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    let piece = text.charAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
        piece = text.slice(i, i + 2);
        i++;
      }
    }
    if (!isIgnored(c)) out += piece.toLowerCase();
  }
  return out;
}

function hasNonAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) return true;
  return false;
}

const PUNY_BASE = 36;
const PUNY_TMIN = 1;
const PUNY_TMAX = 26;
const PUNY_SKEW = 38;
const PUNY_DAMP = 700;

function punyAdapt(delta: number, points: number, first: boolean): number {
  let d = first ? Math.floor(delta / PUNY_DAMP) : delta >> 1;
  d += Math.floor(d / points);
  let k = 0;
  while (d > ((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) >> 1) {
    d = Math.floor(d / (PUNY_BASE - PUNY_TMIN));
    k += PUNY_BASE;
  }
  return k + Math.floor(((PUNY_BASE - PUNY_TMIN + 1) * d) / (d + PUNY_SKEW));
}

/** Punycode digit `d` (0 to 35): `a` to `z`, then `0` to `9`. */
function punyDigit(d: number): string {
  return String.fromCharCode(d < 26 ? 97 + d : 22 + d);
}

/**
 * RFC 3492's encoding of one label (without the `xn--` prefix): the ASCII code points as they
 * are, a `-` if there were any, then the others as deltas. `null` for a lone surrogate.
 */
export function punycode(label: string): string | null {
  const points: number[] = [];
  let out = '';
  for (let i = 0; i < label.length; i++) {
    let c = label.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdfff) {
      const d = i + 1 < label.length ? label.charCodeAt(i + 1) : 0;
      if (c > 0xdbff || d < 0xdc00 || d > 0xdfff) return null;
      c = (c - 0xd800) * 0x400 + (d - 0xdc00) + 0x10000;
      i++;
    }
    points.push(c);
    if (c < 128) out += String.fromCharCode(c);
  }
  const basic = out.length;
  if (basic > 0) out += '-';
  let n = 128;
  let delta = 0;
  let bias = 72;
  let handled = basic;
  while (handled < points.length) {
    let next = 0x110000;
    for (let i = 0; i < points.length; i++) if (points[i]! >= n && points[i]! < next) next = points[i]!;
    delta += (next - n) * (handled + 1);
    n = next;
    for (let i = 0; i < points.length; i++) {
      const c = points[i]!;
      if (c < n) delta++;
      if (c !== n) continue;
      let q = delta;
      for (let k = PUNY_BASE; ; k += PUNY_BASE) {
        const t = k <= bias ? PUNY_TMIN : k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias;
        if (q < t) break;
        out += punyDigit(t + ((q - t) % (PUNY_BASE - t)));
        q = Math.floor((q - t) / (PUNY_BASE - t));
      }
      out += punyDigit(q);
      bias = punyAdapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return out;
}

/**
 * The host in the blocklist's form (`blocklistHost`), a Unicode host first mapped as browsers map
 * it and each non-ASCII label written as `xn--` punycode; percent escapes are decoded first, as
 * URL parsers decode them in a host. `null` when it has no such form (`blocklistHost` refuses it,
 * a broken escape, a lone surrogate).
 */
export function asciiHost(host: string): string | null {
  if (host.charCodeAt(0) === 91 /* [ */) return blocklistHost(host);
  let text = host;
  if (text.indexOf('%') !== -1) {
    try {
      text = decodeURIComponent(text);
    } catch {
      return null;
    }
  }
  if (!hasNonAscii(text)) return blocklistHost(text);
  // NFKC first: lowercasing first gets some letters wrong (the capital lunate sigma would end
  // up final). Every TV engine has `normalize`; without it, lowercase only.
  text = typeof text.normalize === 'function' ? lowerEach(text.normalize('NFKC')).normalize('NFC') : lowerEach(text);
  let out = '';
  let start = 0;
  while (start <= text.length) {
    let end = start;
    // Dots: `.` and the ideographic full stop (NFKC has already made the full-width ones `.`). A
    // last empty label (a trailing dot) adds no dot after it: blocklistHost drops one trailing dot.
    while (end < text.length && text.charCodeAt(end) !== 46 && text.charCodeAt(end) !== 0x3002) end++;
    const label = text.slice(start, end);
    if (hasNonAscii(label)) {
      const encoded = punycode(label);
      if (encoded === null) return null;
      out += 'xn--' + encoded;
    } else {
      out += label;
    }
    if (end < text.length) out += '.';
    start = end + 1;
  }
  return blocklistHost(out);
}

/** The doc's blocklist, ready to ask: `{salt, hashes}` as `configDocSchema` gives it. */
export class Blocklist {
  private readonly table: Record<string, true> = Object.create(null) as Record<string, true>;
  /** Hashes in the list (duplicates once). */
  readonly size: number;

  constructor(
    private readonly salt: string,
    hashes: readonly string[],
  ) {
    let size = 0;
    for (let i = 0; i < hashes.length; i++) {
      if (this.table[hashes[i]!] === true) continue;
      this.table[hashes[i]!] = true;
      size++;
    }
    this.size = size;
  }

  /** True when the host (as a URL gives it) or one of its parents is listed. */
  blocksHost(host: string): boolean {
    if (this.size === 0) return false;
    const ascii = asciiHost(host);
    if (ascii === null) return false;
    const candidates = blocklistCandidates(ascii);
    for (let i = 0; i < candidates.length; i++) {
      if (this.table[blocklistHash(this.salt, candidates[i]!)] === true) return true;
    }
    return false;
  }

  /** True when the URL's host or one of its parents is listed (`false` for a URL without a host). */
  blocksUrl(url: string): boolean {
    if (this.size === 0) return false;
    const host = urlHost(url);
    return host !== null && this.blocksHost(host);
  }
}

/** `value[name]` when `value` is an object, else `undefined`. */
function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[name] : undefined;
}

/**
 * The blocklist of the cached config record (the `kv` store's `config`: `{doc, sig, …}`, where
 * `doc` is the doc's signed text), read by hand: the query worker takes no schema and no signature
 * check. Only the config worker writes that record, after its checks, and it deletes a copy this
 * build no longer trusts. Anything else (no record, a broken one) gives an empty list: nothing is
 * blocked.
 */
export function cachedBlocklist(record: unknown): Blocklist {
  const doc = field(record, 'doc');
  // A string only: JSON.parse would read an array holding the text as the text itself.
  if (typeof doc !== 'string') return new Blocklist('', []);
  let parsed: unknown;
  try {
    parsed = JSON.parse(doc);
  } catch {
    return new Blocklist('', []);
  }
  const list = field(parsed, 'blocklist');
  const salt = field(list, 'salt');
  const hashes = field(list, 'hashes');
  if (typeof salt !== 'string' || !Array.isArray(hashes)) return new Blocklist('', []);
  const kept: string[] = [];
  for (let i = 0; i < hashes.length; i++) {
    const hash: unknown = hashes[i];
    if (typeof hash === 'string') kept.push(hash);
  }
  return new Blocklist(salt, kept);
}
