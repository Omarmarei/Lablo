/**
 * Streaming M3U / M3U Plus parser (architecture.md §1.4 step 5): a line-by-line state machine
 * fed string chunks (the caller decodes bytes with `TextDecoder({ stream: true })`). Each
 * `push` returns the entries completed by that chunk, so a 60 MB playlist never has to be one
 * string. Syntax only: `m3u-catalog.ts` turns entries into catalog items.
 *
 * Tolerance rules (a broken line never throws and never loses the entries around it):
 * - line ends may be `\n`, `\r\n` or `\r`, split anywhere between chunks; a BOM, blank lines
 *   and surrounding whitespace are ignored; directives are matched case-insensitively;
 * - an `#EXTINF` that never gets a URL is dropped when the next `#EXTINF` (or the end) comes;
 * - a URL line needs a `scheme://`; other non-`#` lines are junk and skipped;
 * - a URL with no `#EXTINF` before it is an entry only in a simple M3U (no `#EXTM3U`, no
 *   `#EXTINF` so far); in an extended playlist it is an orphan and skipped;
 * - attributes may be double-quoted, single-quoted or bare; the first comma outside quotes
 *   starts the title; with an unbalanced quote the last comma on the line does;
 * - a non-numeric duration counts as -1; `#EXTGRP` and `#EXTVLCOPT` lines apply to the next
 *   entry, wherever they sit before its URL;
 * - lines longer than `maxLineLength` are skipped without buffering them.
 * Every skip is counted in `stats`, for the diagnostics screen.
 */

export interface M3uEntry {
  /** Text after the attributes' comma (`''` when there is none). */
  title: string;
  /** `#EXTINF` duration in seconds; -1 when absent or not a number. */
  duration: number;
  /** `#EXTINF` attributes, keys lower-cased; the first of a repeated key wins. */
  attrs: Map<string, string>;
  /** Stream URL, without any `|User-Agent=…` suffix. */
  url: string;
  /** `#EXTGRP` group, when one came before the URL. */
  group: string | null;
  /** From `#EXTVLCOPT:http-user-agent` or a `|User-Agent=` URL suffix. */
  userAgent: string | null;
  /** From `#EXTVLCOPT:http-referrer` or a `|Referer=` URL suffix. */
  referrer: string | null;
  /** 1-based line number of the URL (for diagnostics). */
  line: number;
}

export interface M3uHeader {
  /** `#EXTM3U` attributes (keys lower-cased), merged over every header line. */
  attrs: Map<string, string>;
  /** EPG URLs from `url-tvg`, `x-tvg-url` and `tvg-url` (comma-separated lists allowed). */
  epgUrls: string[];
}

export interface M3uStats {
  /** Lines read, blank ones included. */
  lines: number;
  entries: number;
  /** `#EXTINF` lines dropped because no URL followed. */
  extinfWithoutUrl: number;
  /** URL lines with no `#EXTINF` in an extended playlist. */
  orphanUrls: number;
  /** Non-blank lines that are neither directives nor URLs. */
  junkLines: number;
  overlongLines: number;
  unbalancedQuotes: number;
  badDurations: number;
  vlcOpts: number;
  extgrp: number;
  /** `#` lines we don't use (`#KODIPROP`, comments…). */
  otherDirectives: number;
  /** `#EXT-X-…` tags: the text is probably an HLS stream playlist, not a channel list. */
  hlsTags: number;
}

export interface M3uParserOptions {
  /** Longest line kept, in UTF-16 code units (default 32 KiB). */
  maxLineLength?: number;
}

export const DEFAULT_MAX_LINE_LENGTH = 32 * 1024;
/** Attributes kept per `#EXTINF` line; the rest are ignored. */
export const MAX_ATTRIBUTES = 64;

const EPG_URL_ATTRIBUTES = ['url-tvg', 'x-tvg-url', 'tvg-url'];
const URL_LINE = /^[A-Za-z][A-Za-z0-9+.-]{0,15}:\/\//;
const CR = /\r\n?/g;

interface PendingExtinf {
  title: string;
  duration: number;
  attrs: Map<string, string>;
}

function emptyStats(): M3uStats {
  return {
    lines: 0,
    entries: 0,
    extinfWithoutUrl: 0,
    orphanUrls: 0,
    junkLines: 0,
    overlongLines: 0,
    unbalancedQuotes: 0,
    badDurations: 0,
    vlcOpts: 0,
    extgrp: 0,
    otherDirectives: 0,
    hlsTags: 0,
  };
}

export class M3uParser {
  readonly stats: M3uStats = emptyStats();
  readonly header: M3uHeader = { attrs: new Map(), epgUrls: [] };
  private readonly maxLine: number;
  /** The unfinished last line, in pieces (joined once its line end arrives). */
  private carry: string[] = [];
  private carryLength = 0;
  /** Inside a line longer than `maxLine`: drop text up to the next line end. */
  private skipping = false;
  /** The last chunk ended with `\r`: a `\n` starting the next one belongs to it. */
  private pendingCR = false;
  private extended = false;
  private pending: PendingExtinf | null = null;
  private group: string | null = null;
  private userAgent: string | null = null;
  private referrer: string | null = null;
  private out: M3uEntry[] = [];
  private ended = false;

  constructor(options: M3uParserOptions = {}) {
    this.maxLine = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  }

  /** Feeds the next chunk of text; returns the entries it completed. */
  push(chunk: string): M3uEntry[] {
    if (this.ended) throw new Error('M3uParser.push() after end()');
    const out: M3uEntry[] = [];
    this.out = out;
    if (chunk.length === 0) return out;
    let text = chunk;
    if (this.pendingCR && text.charCodeAt(0) === 10) text = text.slice(1);
    this.pendingCR = text.length > 0 && text.charCodeAt(text.length - 1) === 13;
    if (text.length === 0) return out;
    if (text.indexOf('\r') !== -1) text = text.replace(CR, '\n');
    if (text.indexOf('\n') === -1) {
      // Still inside the same line: queue the piece, so tiny chunks cost O(n), not O(n^2).
      if (!this.skipping) this.carryPiece(text);
      return out;
    }
    if (this.carry.length > 0) {
      this.carry.push(text);
      text = this.carry.join('');
      this.carry = [];
      this.carryLength = 0;
    }
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl === -1) break;
      this.stats.lines++;
      if (this.skipping) this.skipping = false;
      else if (nl - start > this.maxLine) this.stats.overlongLines++;
      else this.line(text.slice(start, nl));
      start = nl + 1;
    }
    if (!this.skipping && start < text.length) this.carryPiece(text.slice(start));
    return out;
  }

  /** Ends the input: parses a last line without a line end. Returns its entry, if any. */
  end(): M3uEntry[] {
    const out: M3uEntry[] = [];
    if (this.ended) return out;
    this.ended = true;
    this.out = out;
    if (!this.skipping && this.carry.length > 0) {
      this.stats.lines++;
      this.line(this.carry.join(''));
    }
    this.carry = [];
    this.carryLength = 0;
    if (this.pending !== null) {
      this.stats.extinfWithoutUrl++;
      this.pending = null;
    }
    return out;
  }

  /** Adds text of the unfinished line; starts skipping it once it is over `maxLine`. */
  private carryPiece(piece: string): void {
    this.carryLength += piece.length;
    if (this.carryLength > this.maxLine) {
      this.stats.overlongLines++;
      this.skipping = true;
      this.carry = [];
      this.carryLength = 0;
    } else {
      this.carry.push(piece);
    }
  }

  private line(raw: string): void {
    const line = raw.trim();
    if (line.length === 0) return;
    if (line.charCodeAt(0) === 35) this.directive(line);
    else this.urlLine(line);
  }

  private directive(line: string): void {
    const head = (line.length > 12 ? line.slice(0, 12) : line).toUpperCase();
    if (head.startsWith('#EXTINF:')) {
      if (this.pending !== null) this.stats.extinfWithoutUrl++;
      this.extended = true;
      this.pending = parseExtinf(line.slice(8), this.stats);
    } else if (head.startsWith('#EXTM3U')) {
      this.extended = true;
      this.headerLine(line.slice(7));
    } else if (head.startsWith('#EXTGRP:')) {
      this.stats.extgrp++;
      const group = line.slice(8).trim();
      this.group = group.length > 0 ? group : null;
    } else if (head.startsWith('#EXTVLCOPT:')) {
      this.stats.vlcOpts++;
      this.vlcOpt(line.slice(11));
    } else if (head.startsWith('#EXT-X-')) {
      this.stats.hlsTags++;
    } else {
      this.stats.otherDirectives++;
    }
  }

  private headerLine(body: string): void {
    const attrs = new Map<string, string>();
    parseAttributes(body, 0, attrs, this.stats);
    attrs.forEach((value, key) => {
      if (!this.header.attrs.has(key)) this.header.attrs.set(key, value);
      if (EPG_URL_ATTRIBUTES.indexOf(key) === -1) return;
      for (const part of value.split(',')) {
        const url = part.trim();
        if (url.length > 0 && this.header.epgUrls.indexOf(url) === -1) this.header.epgUrls.push(url);
      }
    });
  }

  private vlcOpt(option: string): void {
    const eq = option.indexOf('=');
    if (eq === -1) return;
    const key = option.slice(0, eq).trim().toLowerCase();
    const value = option.slice(eq + 1).trim();
    if (value.length === 0) return;
    if (key === 'http-user-agent') this.userAgent = value;
    else if (key === 'http-referrer' || key === 'http-referer') this.referrer = value;
  }

  private urlLine(line: string): void {
    if (!URL_LINE.test(line)) {
      this.stats.junkLines++;
      return;
    }
    let url = line;
    let userAgent = this.userAgent;
    let referrer = this.referrer;
    const pipe = url.indexOf('|');
    if (pipe !== -1 && url.indexOf('=', pipe) !== -1) {
      // Kodi-style request headers: `http://host/stream.ts|User-Agent=X&Referer=Y`.
      for (const pair of url.slice(pipe + 1).split('&')) {
        const eq = pair.indexOf('=');
        if (eq === -1) continue;
        const key = pair.slice(0, eq).trim().toLowerCase();
        const value = decodeComponent(pair.slice(eq + 1).trim());
        if (value.length === 0) continue;
        if (key === 'user-agent') userAgent = value;
        else if (key === 'referer' || key === 'referrer') referrer = value;
      }
      url = url.slice(0, pipe).trim();
    }
    const pending = this.pending;
    if (pending !== null || !this.extended) {
      this.stats.entries++;
      this.out.push({
        title: pending === null ? '' : pending.title,
        duration: pending === null ? -1 : pending.duration,
        attrs: pending === null ? new Map() : pending.attrs,
        url,
        group: this.group,
        userAgent,
        referrer,
        line: this.stats.lines,
      });
    } else {
      this.stats.orphanUrls++;
    }
    this.pending = null;
    this.group = null;
    this.userAgent = null;
    this.referrer = null;
  }
}

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parses the text after `#EXTINF:`: duration, attributes, title. */
function parseExtinf(body: string, stats: M3uStats): PendingExtinf {
  const n = body.length;
  let i = 0;
  while (i < n && isSpace(body.charCodeAt(i))) i++;
  let j = i;
  while (j < n) {
    const c = body.charCodeAt(j);
    if (c === 32 || c === 9 || c === 44) break;
    j++;
  }
  let duration = -1;
  if (j > i) {
    const token = body.slice(i, j);
    // `#EXTINF:tvg-id="x",Name` has no duration: the token is the first attribute.
    if (token.indexOf('=') === -1) {
      const value = Number(token);
      if (isFinite(value)) duration = value;
      else stats.badDurations++;
      i = j;
    }
  }
  const attrs = new Map<string, string>();
  const title = parseAttributes(body, i, attrs, stats);
  return { title: title === null ? '' : title, duration, attrs };
}

/**
 * Reads `key="value"` / `key='value'` / `key=value` pairs from `s` starting at `i` into
 * `attrs`. Returns the text after the first comma outside quotes (the title), or `null` when
 * there is no such comma.
 */
function parseAttributes(s: string, i: number, attrs: Map<string, string>, stats: M3uStats): string | null {
  const n = s.length;
  while (i < n) {
    let c = s.charCodeAt(i);
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === 44) return s.slice(i + 1).trim();
    const keyStart = i;
    while (i < n) {
      c = s.charCodeAt(i);
      if (c === 61 || c === 44 || isSpace(c)) break;
      i++;
    }
    if (i >= n || c !== 61) continue; // a bare word: skip it
    const key = s.slice(keyStart, i);
    i++;
    const quote = i < n ? s.charCodeAt(i) : -1;
    let value: string;
    if (quote === 34 || quote === 39) {
      const close = s.indexOf(quote === 34 ? '"' : "'", i + 1);
      if (close === -1) {
        stats.unbalancedQuotes++;
        const comma = s.lastIndexOf(',');
        if (comma > i) {
          setAttribute(attrs, key, s.slice(i + 1, comma));
          return s.slice(comma + 1).trim();
        }
        setAttribute(attrs, key, s.slice(i + 1));
        return null;
      }
      value = s.slice(i + 1, close);
      i = close + 1;
    } else {
      const valueStart = i;
      while (i < n) {
        c = s.charCodeAt(i);
        if (c === 44 || isSpace(c)) break;
        i++;
      }
      value = s.slice(valueStart, i);
    }
    setAttribute(attrs, key, value);
  }
  return null;
}

function setAttribute(attrs: Map<string, string>, key: string, value: string): void {
  if (key.length === 0 || attrs.size >= MAX_ATTRIBUTES) return;
  const k = key.toLowerCase();
  if (!attrs.has(k)) attrs.set(k, value.trim());
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9;
}
