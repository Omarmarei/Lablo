/**
 * Streaming JSON-array splitter (architecture.md §1.4 step 5). Xtream list endpoints answer with
 * one big array (60 MB for a large VOD list); the splitter yields the text of each top-level
 * element as soon as it is complete, so the caller can `JSON.parse` one small element at a time
 * and never holds the whole response as one string.
 *
 * It tracks nesting depth, strings and escapes across chunk boundaries, and it never throws.
 * Tolerated, because panels send all of these:
 * - a UTF-8 BOM and any whitespace before the value;
 * - an empty array `[]`, missing or doubled commas;
 * - an object instead of an array: `{}` for "nothing", an error object, or a list keyed by
 *   index. Each member's value is yielded as if it were an array element (keys are skipped);
 * - a cut-off response: complete elements come out, the incomplete tail is dropped and
 *   `stats.truncated` is set;
 * - anything else at the top (an HTML error page, `null`): nothing is yielded, `stats.shape` is
 *   `'other'`.
 *
 * It does not validate JSON: a malformed element is yielded as text and fails in `JSON.parse`.
 */

export type JsonShape = 'unknown' | 'array' | 'object' | 'other';

export interface JsonSplitterStats {
  /** The top-level value: `unknown` until its first character arrives. */
  shape: JsonShape;
  /** Elements yielded. */
  elements: number;
  /** The top-level array or object was never closed (a cut-off response). */
  truncated: boolean;
  /** Elements dropped because they were longer than `maxElementLength`. */
  oversized: number;
  /** Characters skipped where an element or separator was expected (`:` in an array, say). */
  stray: number;
  /** Non-whitespace characters after the top-level value closed. */
  trailing: number;
}

export interface JsonSplitterOptions {
  /** Longest element kept, in UTF-16 code units (default 4 Mi). Longer ones are counted and dropped. */
  maxElementLength?: number;
}

export const DEFAULT_MAX_ELEMENT_LENGTH = 4 * 1024 * 1024;

// Plain constants rather than enums: the TV build strips types with Babel.
/** Where the scanner is: before the top-level value… */
const TOP = 0;
/** …inside the top-level array or object, between elements… */
const BETWEEN = 1;
/** …inside an element… */
const ELEMENT = 2;
/** …or after the top-level value (or after a top level it doesn't read). */
const DONE = 3;

/** What the current element is. */
const CONTAINER = 0;
const STRING = 1;
const PRIMITIVE = 2;

const QUOTE = 34;
const BACKSLASH = 92;
const COMMA = 44;
const COLON = 58;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const BOM = 0xfeff;

function isSpace(c: number): boolean {
  return c === 32 || c === 10 || c === 13 || c === 9;
}

/** Splits a streamed top-level JSON array (or object) into element texts. One instance per response. */
export class JsonArraySplitter {
  readonly stats: JsonSplitterStats = { shape: 'unknown', elements: 0, truncated: false, oversized: 0, stray: 0, trailing: 0 };

  private readonly maxElementLength: number;
  private level = TOP;
  /** Object top level: the next string is a value (after `:`), not a key. */
  private expectValue = false;
  /** Inside an object key string (object top level only). */
  private inKey = false;
  private kind = CONTAINER;
  /** Nesting depth inside a container element. */
  private depth = 0;
  private inString = false;
  private escaped = false;
  /** Text of the current element from earlier chunks. */
  private pending = '';
  /** The current element outgrew `maxElementLength`: it is being skipped. */
  private skipping = false;
  /** Nothing read yet: a BOM is allowed only here. */
  private atStart = true;

  constructor(options: JsonSplitterOptions = {}) {
    this.maxElementLength = Math.max(1, options.maxElementLength ?? DEFAULT_MAX_ELEMENT_LENGTH);
  }

  /** Feeds the next chunk of text; returns the elements it completed, in order. */
  push(chunk: string): string[] {
    const out: string[] = [];
    const n = chunk.length;
    let i = 0;
    // Where the current element starts in this chunk (0 when it began in an earlier chunk).
    let start = 0;
    while (i < n) {
      const level = this.level;
      if (level === ELEMENT) {
        const end = this.scanElement(chunk, i);
        if (end === -1) break;
        this.emit(out, chunk, start, end);
        // A primitive ends before its delimiter, which is then read between elements.
        i = this.kind === PRIMITIVE ? end : end + 1;
        this.level = BETWEEN;
        // Object top level: after a value comes a key, even if the panel forgot the comma.
        this.expectValue = false;
        continue;
      }
      const c = chunk.charCodeAt(i);
      if (level === BETWEEN) {
        if (this.inKey) {
          i = this.scanKey(chunk, i);
          continue;
        }
        if (isSpace(c)) {
          i++;
        } else if (c === COMMA) {
          this.expectValue = false;
          i++;
        } else if (c === COLON) {
          if (this.stats.shape === 'object') this.expectValue = true;
          else this.stats.stray++;
          i++;
        } else if (c === CLOSE_BRACKET || c === CLOSE_BRACE) {
          this.level = DONE;
          i++;
        } else if (c === QUOTE && this.stats.shape === 'object' && !this.expectValue) {
          this.inKey = true;
          this.escaped = false;
          i++;
        } else {
          this.startElement(c);
          start = i;
          // Containers and strings: their opening character is consumed here.
          i = this.kind === PRIMITIVE ? i : i + 1;
          this.level = ELEMENT;
        }
        continue;
      }
      if (level === TOP) {
        if (c === BOM && this.atStart) {
          i++;
        } else if (isSpace(c)) {
          i++;
        } else if (c === OPEN_BRACKET || c === OPEN_BRACE) {
          this.stats.shape = c === OPEN_BRACKET ? 'array' : 'object';
          this.level = BETWEEN;
          i++;
        } else {
          this.stats.shape = 'other';
          this.level = DONE;
        }
        this.atStart = false;
        continue;
      }
      // Done: count what follows a closed top level; ignore everything after an unread one.
      if (this.stats.shape === 'other') break;
      if (!isSpace(c)) this.stats.trailing++;
      i++;
    }
    if (this.level === ELEMENT) this.keep(chunk, start);
    return out;
  }

  /** Ends the input. An element still open is incomplete: it is dropped and `truncated` is set. */
  end(): string[] {
    if (this.level === ELEMENT || this.level === BETWEEN) this.stats.truncated = true;
    this.level = DONE;
    this.pending = '';
    this.skipping = false;
    return [];
  }

  private startElement(c: number): void {
    this.depth = 0;
    this.inString = false;
    this.escaped = false;
    this.pending = '';
    this.skipping = false;
    if (c === QUOTE) {
      this.kind = STRING;
      this.inString = true;
    } else if (c === OPEN_BRACE || c === OPEN_BRACKET) {
      this.kind = CONTAINER;
      this.depth = 1;
    } else {
      this.kind = PRIMITIVE;
    }
  }

  /**
   * Scans the current element from `i`. Returns the index of its last character (for a
   * primitive: of the delimiter after it), or -1 when the chunk ends first.
   */
  private scanElement(s: string, i: number): number {
    const n = s.length;
    if (this.kind === PRIMITIVE) {
      for (; i < n; i++) {
        const c = s.charCodeAt(i);
        if (c === COMMA || c === CLOSE_BRACKET || c === CLOSE_BRACE || c === COLON || isSpace(c)) return i;
      }
      return -1;
    }
    let inString = this.inString;
    let escaped = this.escaped;
    let depth = this.depth;
    for (; i < n; i++) {
      const c = s.charCodeAt(i);
      if (inString) {
        if (escaped) escaped = false;
        else if (c === BACKSLASH) escaped = true;
        else if (c === QUOTE) {
          inString = false;
          if (depth === 0) {
            this.inString = false;
            return i;
          }
        }
      } else if (c === QUOTE) {
        inString = true;
      } else if (c === OPEN_BRACE || c === OPEN_BRACKET) {
        depth++;
      } else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) {
        depth--;
        if (depth === 0) {
          this.depth = 0;
          return i;
        }
      }
    }
    this.inString = inString;
    this.escaped = escaped;
    this.depth = depth;
    return -1;
  }

  /** Skips an object key string; returns the index after it (or the chunk end). */
  private scanKey(s: string, i: number): number {
    const n = s.length;
    for (; i < n; i++) {
      const c = s.charCodeAt(i);
      if (this.escaped) this.escaped = false;
      else if (c === BACKSLASH) this.escaped = true;
      else if (c === QUOTE) {
        this.inKey = false;
        return i + 1;
      }
    }
    return n;
  }

  private emit(out: string[], s: string, start: number, end: number): void {
    // A primitive's end is its delimiter (exclusive); containers and strings end inclusive.
    const stop = this.kind === PRIMITIVE ? end : end + 1;
    if (this.skipping || this.pending.length + (stop - start) > this.maxElementLength) {
      this.stats.oversized++;
    } else {
      out.push(this.pending.length > 0 ? this.pending + s.slice(start, stop) : s.slice(start, stop));
      this.stats.elements++;
    }
    this.pending = '';
    this.skipping = false;
  }

  /** Keeps the start of an element that continues in the next chunk. */
  private keep(s: string, start: number): void {
    if (this.skipping) return;
    this.pending += s.slice(start);
    if (this.pending.length > this.maxElementLength) {
      this.pending = '';
      this.skipping = true;
    }
  }
}

/** Splits a whole text at once (tests, small responses). */
export function splitJsonArray(text: string, options: JsonSplitterOptions = {}): { elements: string[]; stats: JsonSplitterStats } {
  const splitter = new JsonArraySplitter(options);
  const elements = splitter.push(text);
  for (const e of splitter.end()) elements.push(e);
  return { elements, stats: splitter.stats };
}
