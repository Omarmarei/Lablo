/**
 * Subtitle files (architecture.md §2 "Subtitles", RELAY step 20b2a): a streaming parser for SRT,
 * WebVTT and ASS/SSA, fed string chunks like `M3uParser` (the app decodes the bytes), giving
 * cues of plain text for the player's overlay. Syntax only: the overlay times and draws them.
 *
 * The format comes from the first line that isn't blank: `WEBVTT` is WebVTT, a `[section]`
 * header is ASS/SSA, anything else is what the caller expects (`format`, default SRT; SRT and
 * WebVTT cues are read alike).
 *
 * Tolerance rules (a broken cue never throws and never loses the cues around it):
 * - line ends may be `\n`, `\r\n` or `\r`, split anywhere between chunks; a BOM, blank lines and
 *   the whitespace around lines are ignored; lines longer than `maxLineLength` are skipped;
 * - SRT and WebVTT: a cue is an optional id line (the SRT index), a timing line
 *   (`[h:]mm:ss[,.]fff --> [h:]mm:ss[,.]fff`, WebVTT's settings after it ignored) and its text up
 *   to a blank line. A timing line anywhere starts a cue, so a file that lost the blank line
 *   between two cues keeps both (the number line just before the timing is the next cue's
 *   index, not text). Two lines without a timing are junk, skipped up to the next blank line,
 *   and so are WebVTT's header, `NOTE`, `STYLE` and `REGION` blocks;
 * - ASS/SSA: the `Dialogue:` lines of `[Events]`, with the fields in the order of its `Format:`
 *   line (default: v4+'s, whose order v4 shares), the text being everything after the field
 *   before it (commas included);
 * - a cue whose end isn't after its start, or whose text is empty once tags are gone, is dropped;
 *   cues past `maxCues` are dropped.
 * Every skip is counted in `stats`.
 *
 * The text: HTML-like tags (`<i>`, `<font …>`, WebVTT's `<v …>`, `<c.…>` and timestamps) and ASS
 * override blocks (`{\an8}`; in ASS any `{…}`) are removed, WebVTT's entities decoded, ASS's
 * `\N` and `\n` become a line break and a space, and ASS drawings (`{\p1}…{\p0}`) are dropped.
 * Lines are trimmed and joined by `\n`. The text is the provider's: the overlay draws each cue
 * with `dir=auto`.
 */

import { cutText } from './text';

export type SubtitleFormat = 'srt' | 'vtt' | 'ass';

export interface SubtitleCue {
  /** From the start of the media, in ms. */
  readonly startMs: number;
  /** After `startMs`. */
  readonly endMs: number;
  /** Plain text, its lines joined by `\n` (never empty). */
  readonly text: string;
}

export interface SubtitleStats {
  /** Lines read, blank ones included. */
  lines: number;
  cues: number;
  /** Timing lines that don't parse, or whose end isn't after the start. */
  badTimings: number;
  /** Blocks with no timing line (SRT, WebVTT), `Dialogue:` lines with too few fields, `Format:` lines without the start, end and text (ASS). */
  junk: number;
  /** Cues with no text once tags are gone. */
  emptyCues: number;
  overlongLines: number;
  /** Cues past `maxCues`. */
  droppedCues: number;
}

export interface SubtitleParserOptions {
  /** The format the caller expects when the text has no header (`PlayRequest.externalSubs`' `fmt`; default `srt`). */
  format?: 'srt' | 'vtt';
  /** Longest line kept, in UTF-16 code units (default 16 KiB). */
  maxLineLength?: number;
  /** Cues kept (default 20,000). */
  maxCues?: number;
}

export const DEFAULT_SUBTITLE_LINE_LENGTH = 16 * 1024;
export const DEFAULT_MAX_CUES = 20_000;
/** A cue's text is cut to this many code units. */
export const MAX_CUE_TEXT = 2000;

const CR = /\r\n?/g;
const NBSP = String.fromCharCode(0xa0);
const REPLACEMENT = String.fromCharCode(0xfffd);
const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,6});/g;
/** WebVTT's named character references, as far as subtitles use them. */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: NBSP,
  lrm: String.fromCharCode(0x200e),
  rlm: String.fromCharCode(0x200f),
};

/** ASS v4+ `Format:` (`Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`); v4's `Marked` sits where `Layer` does. */
interface AssFields {
  readonly count: number;
  readonly start: number;
  readonly end: number;
}

const DEFAULT_ASS_FIELDS: AssFields = { count: 10, start: 1, end: 2 };

/** Where the reader of SRT and WebVTT cues is. */
type CueState =
  /** Between blocks. */
  | 'idle'
  /** After a block's first line, which had no timing (an id or index line). */
  | 'id'
  /** Reading a cue's text. */
  | 'text'
  /** In a block that isn't a cue (junk, WebVTT's header, `NOTE`, `STYLE`, `REGION`), up to a blank line. */
  | 'skip';

function emptyStats(): SubtitleStats {
  return { lines: 0, cues: 0, badTimings: 0, junk: 0, emptyCues: 0, overlongLines: 0, droppedCues: 0 };
}

/** The number written in `text[from, to)`: 1 to `max` ASCII digits, else -1. */
function digitsAt(text: string, from: number, to: number, max: number): number {
  if (to <= from || to - from > max) return -1;
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return -1;
    n = n * 10 + c;
  }
  return n;
}

/**
 * A subtitle clock in ms: `[h:]mm:ss[,.]fff` (SRT, WebVTT) or `h:mm:ss.cc` (ASS). The fraction
 * is decimal (`.5` and `.50` are 500 ms; digits past the third are ignored); minutes and
 * seconds have one or two digits up to 59. -1 when `text` isn't one.
 */
export function parseSubtitleClock(text: string): number {
  let end = text.length;
  let fraction = 0;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text.charCodeAt(i);
    if (c === 58) break;
    if (c === 46 || c === 44) {
      if (i + 1 < text.length && digitsAt(text, i + 1, text.length, 9) < 0) return -1;
      const digits = text.slice(i + 1, i + 4);
      fraction = digits === '' ? 0 : digitsAt(digits, 0, digits.length, 3) * (digits.length === 1 ? 100 : digits.length === 2 ? 10 : 1);
      end = i;
      break;
    }
  }
  const c2 = text.lastIndexOf(':', end - 1);
  if (c2 <= 0) return -1;
  const c1 = text.lastIndexOf(':', c2 - 1);
  const seconds = digitsAt(text, c2 + 1, end, 2);
  const minutes = digitsAt(text, c1 + 1, c2, 2);
  const hours = c1 === -1 ? 0 : digitsAt(text, 0, c1, 5);
  if (seconds < 0 || seconds > 59 || minutes < 0 || minutes > 59 || hours < 0) return -1;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction;
}

/** A timing line's start and end (`arrow`: where its `-->` is), or `null` when either doesn't parse. */
function parseTiming(line: string, arrow: number): { start: number; end: number } | null {
  const start = parseSubtitleClock(line.slice(0, arrow).trim());
  const rest = line.slice(arrow + 3).trim();
  let stop = rest.length;
  for (let i = 0; i < rest.length; i++) {
    const c = rest.charCodeAt(i);
    if (c === 32 || c === 9) {
      stop = i;
      break;
    }
  }
  const end = parseSubtitleClock(rest.slice(0, stop));
  return start < 0 || end < 0 ? null : { start, end };
}

/** A line of ASCII digits only (an SRT index). */
function isNumberLine(line: string): boolean {
  return digitsAt(line, 0, line.length, line.length) >= 0;
}

/** WebVTT blocks that aren't cues: `NOTE …`, `STYLE`, `REGION` (the line is trimmed). */
function isVttBlock(line: string): boolean {
  if (line === 'STYLE' || line === 'REGION' || line === 'NOTE') return true;
  const c = line.charCodeAt(4);
  return line.slice(0, 4) === 'NOTE' && (c === 32 || c === 9);
}

/** `<` followed by a letter, a digit or `/` starts a tag. */
function startsTag(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 47 && c <= 57);
}

/** In an ASS override block `text[from, to)`: `\p` with a digit turns drawing on (not 0) or off (0). */
function drawingAfter(text: string, from: number, to: number, drawing: boolean): boolean {
  let on = drawing;
  for (let at = text.indexOf('\\p', from); at !== -1 && at < to; at = text.indexOf('\\p', at + 2)) {
    const d = text.charCodeAt(at + 2);
    if (d >= 48 && d <= 57) on = d !== 48;
  }
  return on;
}

/**
 * One line of cue text without its markup:
 * - `html`: `<…>` tags (SRT, WebVTT);
 * - `allBraces`: any `{…}` block (ASS), else only `{\…}` override blocks;
 * - `escapes`: ASS's `\N` (line break), `\n` (space) and `\h` (no-break space).
 * A drawing (`{\p1}` up to `{\p0}`) is dropped. The result may hold line breaks (`\N`).
 */
function stripMarkup(line: string, html: boolean, allBraces: boolean, escapes: boolean): string {
  const lastGt = html ? line.lastIndexOf('>') : -1;
  const lastBrace = line.lastIndexOf('}');
  let out = '';
  let from = 0;
  let drawing = false;
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    let close = -1;
    let sub: string | null = null;
    if (c === 60 && i + 2 <= lastGt && startsTag(line.charCodeAt(i + 1))) close = line.indexOf('>', i + 2);
    else if (c === 123 && i < lastBrace && (allBraces || line.charCodeAt(i + 1) === 92)) close = line.indexOf('}', i + 1);
    else if (c === 92 && escapes) {
      const e = line.charCodeAt(i + 1);
      sub = e === 78 ? '\n' : e === 110 ? ' ' : e === 104 ? NBSP : null;
    }
    if (close !== -1) {
      if (!drawing) out += line.slice(from, i);
      drawing = drawingAfter(line, i + 1, close, drawing);
      i = close + 1;
      from = i;
    } else if (sub !== null) {
      if (!drawing) out += line.slice(from, i) + sub;
      i += 2;
      from = i;
    } else {
      i++;
    }
  }
  return drawing ? out : out + line.slice(from);
}

/** A code point as text; U+FFFD for none, a surrogate or a NUL. */
function codePoint(cp: number): string {
  if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return REPLACEMENT;
  if (cp < 0x10000) return String.fromCharCode(cp);
  const v = cp - 0x10000;
  return String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
}

/** WebVTT's character references: the named ones subtitles use, and numeric ones; others stay. */
function decodeEntities(text: string): string {
  if (text.indexOf('&') === -1) return text;
  return text.replace(ENTITY, (whole: string, body: string) => {
    if (body.charCodeAt(0) === 35) {
      const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
      return codePoint(hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10));
    }
    // ENTITY's names are 2 to 6 letters: none of Object.prototype's.
    return NAMED[body] ?? whole;
  });
}

/** `text`'s lines trimmed, the empty ones dropped, joined by `\n`, cut to `MAX_CUE_TEXT`. */
function tidy(text: string): string {
  let out = '';
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    const line = (nl === -1 ? text.slice(start) : text.slice(start, nl)).trim();
    if (line !== '') out = out === '' ? line : `${out}\n${line}`;
    if (nl === -1) break;
    start = nl + 1;
  }
  return cutText(out, MAX_CUE_TEXT);
}

/**
 * The text of a cue an engine delivers (AVPlay's `onsubtitlechange`), without its markup: tags,
 * `{\…}` override blocks and ASS escapes; lines trimmed, the empty ones dropped.
 */
export function cueText(raw: string): string {
  const text = raw.indexOf('\r') === -1 ? raw : raw.replace(CR, '\n');
  let out = '';
  let start = 0;
  for (;;) {
    const nl = text.indexOf('\n', start);
    out += stripMarkup(nl === -1 ? text.slice(start) : text.slice(start, nl), true, false, true);
    if (nl === -1) break;
    out += '\n';
    start = nl + 1;
  }
  return tidy(out);
}

export class SubtitleParser {
  readonly stats: SubtitleStats = emptyStats();
  private readonly declared: 'srt' | 'vtt';
  private readonly maxLine: number;
  private readonly maxCues: number;
  /** The format, once the first line that isn't blank was read. */
  private detected: SubtitleFormat | null = null;
  /** The unfinished last line, in pieces (joined once its line end arrives). */
  private carry: string[] = [];
  private carryLength = 0;
  /** Inside a line longer than `maxLine`: drop text up to the next line end. */
  private skipping = false;
  /** The last chunk ended with `\r`: a `\n` starting the next one belongs to it. */
  private pendingCR = false;
  private state: CueState = 'idle';
  private cueStart = 0;
  private cueEnd = 0;
  private cueLines: string[] = [];
  private cueLength = 0;
  /** The current ASS section's name, lower-cased. */
  private section = '';
  private fields: AssFields = DEFAULT_ASS_FIELDS;
  private out: SubtitleCue[] = [];
  private ended = false;

  constructor(options: SubtitleParserOptions = {}) {
    this.declared = options.format ?? 'srt';
    this.maxLine = options.maxLineLength ?? DEFAULT_SUBTITLE_LINE_LENGTH;
    this.maxCues = options.maxCues ?? DEFAULT_MAX_CUES;
  }

  /** The text's format (`null` until a line that isn't blank was read). */
  get format(): SubtitleFormat | null {
    return this.detected;
  }

  /** Feeds the next chunk of text; returns the cues it completed. */
  push(chunk: string): SubtitleCue[] {
    if (this.ended) throw new Error('SubtitleParser.push() after end()');
    const out: SubtitleCue[] = [];
    this.out = out;
    if (chunk.length === 0) return out;
    let text = chunk;
    if (this.pendingCR && text.charCodeAt(0) === 10) text = text.slice(1);
    this.pendingCR = text.length > 0 && text.charCodeAt(text.length - 1) === 13;
    if (text.length === 0) return out;
    if (text.indexOf('\r') !== -1) text = text.replace(CR, '\n');
    if (text.indexOf('\n') === -1) {
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
    // The first line end ended any skipping.
    if (start < text.length) this.carryPiece(text.slice(start));
    return out;
  }

  /** Ends the input: reads a last line without a line end, and ends the last cue. */
  end(): SubtitleCue[] {
    const out: SubtitleCue[] = [];
    if (this.ended) return out;
    this.ended = true;
    this.out = out;
    if (this.skipping) {
      this.stats.lines++;
    } else if (this.carry.length > 0) {
      this.stats.lines++;
      this.line(this.carry.join(''));
    }
    this.carry = [];
    this.carryLength = 0;
    if (this.state === 'text') this.finishCue();
    else if (this.state === 'id') this.stats.junk++;
    this.state = 'idle';
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
    if (this.detected === null) {
      if (line === '') return;
      if (line.slice(0, 6) === 'WEBVTT') {
        this.detected = 'vtt';
        this.state = 'skip';
        return;
      }
      this.detected = line.charCodeAt(0) === 91 ? 'ass' : this.declared;
    }
    if (this.detected === 'ass') this.assLine(line);
    else this.cueLine(line);
  }

  /** A line of SRT or WebVTT (trimmed). */
  private cueLine(line: string): void {
    if (line === '') {
      if (this.state === 'text') this.finishCue();
      else if (this.state === 'id') this.stats.junk++;
      this.state = 'idle';
      return;
    }
    const arrow = line.indexOf('-->');
    const timing = arrow === -1 ? null : parseTiming(line, arrow);
    if (timing !== null) {
      if (this.state === 'text') {
        // A cue that lost its blank line: a number just before the timing is the new cue's index.
        const last = this.cueLines[this.cueLines.length - 1];
        if (last !== undefined && isNumberLine(last)) this.cueLines.pop();
        this.finishCue();
      }
      this.state = 'text';
      this.cueStart = timing.start;
      this.cueEnd = timing.end;
      return;
    }
    switch (this.state) {
      case 'text':
        if (this.cueLength <= this.maxLine) {
          this.cueLines.push(line);
          this.cueLength += line.length;
        }
        return;
      case 'idle':
        if (arrow !== -1) {
          this.stats.badTimings++;
          this.state = 'skip';
        } else {
          this.state = this.detected === 'vtt' && isVttBlock(line) ? 'skip' : 'id';
        }
        return;
      case 'id':
        if (arrow !== -1) this.stats.badTimings++;
        else this.stats.junk++;
        this.state = 'skip';
        return;
      case 'skip':
        return;
    }
  }

  /** The cue being read is complete. */
  private finishCue(): void {
    const lines = this.cueLines;
    this.cueLines = [];
    this.cueLength = 0;
    if (this.cueEnd <= this.cueStart) {
      this.stats.badTimings++;
      return;
    }
    const vtt = this.detected === 'vtt';
    let text = '';
    for (let i = 0; i < lines.length; i++) {
      const clean = stripMarkup(lines[i]!, true, false, false);
      text += (i === 0 ? '' : '\n') + (vtt ? decodeEntities(clean) : clean);
    }
    this.emit(this.cueStart, this.cueEnd, tidy(text));
  }

  /** A line of ASS (trimmed). */
  private assLine(line: string): void {
    if (line === '') return;
    if (line.charCodeAt(0) === 91) {
      const close = line.indexOf(']');
      this.section = (close === -1 ? line.slice(1) : line.slice(1, close)).trim().toLowerCase();
      return;
    }
    if (this.section !== 'events') return;
    const colon = line.indexOf(':');
    if (colon === -1) return;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key === 'format') this.assFormat(line.slice(colon + 1));
    else if (key === 'dialogue') this.dialogue(line.slice(colon + 1));
  }

  /** `Format:`: where the start, the end and the text are (the text is always the last field). */
  private assFormat(value: string): void {
    let start = -1;
    let end = -1;
    let count = 0;
    let last = '';
    let from = 0;
    for (;;) {
      const comma = value.indexOf(',', from);
      last = (comma === -1 ? value.slice(from) : value.slice(from, comma)).trim().toLowerCase();
      if (last === 'start') start = count;
      else if (last === 'end') end = count;
      count++;
      if (comma === -1) break;
      from = comma + 1;
    }
    if (start === -1 || end === -1 || last !== 'text') {
      this.stats.junk++;
      return;
    }
    this.fields = { count, start, end };
  }

  /** `Dialogue:`: its fields up to the text, which is the rest of the line. */
  private dialogue(value: string): void {
    const { count, start, end } = this.fields;
    let from = 0;
    let startText = '';
    let endText = '';
    for (let f = 0; f < count - 1; f++) {
      const comma = value.indexOf(',', from);
      if (comma === -1) {
        this.stats.junk++;
        return;
      }
      if (f === start) startText = value.slice(from, comma).trim();
      else if (f === end) endText = value.slice(from, comma).trim();
      from = comma + 1;
    }
    const startMs = parseSubtitleClock(startText);
    const endMs = parseSubtitleClock(endText);
    if (startMs < 0 || endMs <= startMs) {
      this.stats.badTimings++;
      return;
    }
    this.emit(startMs, endMs, tidy(stripMarkup(value.slice(from), false, true, true)));
  }

  private emit(startMs: number, endMs: number, text: string): void {
    if (text === '') {
      this.stats.emptyCues++;
      return;
    }
    if (this.stats.cues >= this.maxCues) {
      this.stats.droppedCues++;
      return;
    }
    this.stats.cues++;
    this.out.push({ startMs, endMs, text });
  }
}

export interface ParsedSubtitles {
  readonly format: SubtitleFormat | null;
  /** In the file's order. */
  readonly cues: SubtitleCue[];
  readonly stats: SubtitleStats;
}

/** Parses a whole subtitle file. */
export function parseSubtitles(text: string, options?: SubtitleParserOptions): ParsedSubtitles {
  const parser = new SubtitleParser(options);
  const cues = parser.push(text);
  const rest = parser.end();
  for (const cue of rest) cues.push(cue);
  return { format: parser.format, cues, stats: parser.stats };
}

/**
 * A file's cues for the overlay: sorted by start (stable: files list cues out of order), and
 * `cuesAt(ms)`, the cues showing at a media time.
 */
export class SubtitleTrack {
  readonly cues: readonly SubtitleCue[];
  /** `reach[i]`: the latest end among `cues[0..i]`, so a look back stops where nothing reaches `ms`. */
  private readonly reach: number[] = [];

  constructor(cues: readonly SubtitleCue[]) {
    const order: number[] = [];
    for (let i = 0; i < cues.length; i++) order.push(i);
    order.sort((a, b) => cues[a]!.startMs - cues[b]!.startMs || a - b);
    const sorted: SubtitleCue[] = [];
    let reach = 0;
    for (const i of order) {
      const cue = cues[i]!;
      sorted.push(cue);
      if (cue.endMs > reach) reach = cue.endMs;
      this.reach.push(reach);
    }
    this.cues = sorted;
  }

  /** The cues showing at `ms` (start ≤ `ms` < end), in start order; a text already showing isn't repeated (ASS layers). */
  cuesAt(ms: number): SubtitleCue[] {
    const cues = this.cues;
    let lo = 0;
    let hi = cues.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cues[mid]!.startMs <= ms) lo = mid + 1;
      else hi = mid;
    }
    const found: SubtitleCue[] = [];
    for (let i = lo - 1; i >= 0 && this.reach[i]! > ms; i--) if (cues[i]!.endMs > ms) found.push(cues[i]!);
    const out: SubtitleCue[] = [];
    for (let i = found.length - 1; i >= 0; i--) {
      const cue = found[i]!;
      let seen = false;
      for (const shown of out) if (shown.text === cue.text) seen = true;
      if (!seen) out.push(cue);
    }
    return out;
  }
}
