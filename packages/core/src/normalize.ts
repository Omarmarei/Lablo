/**
 * Name normalization (architecture.md §1.4 step 6): the form search and EPG matching compare.
 *
 * `normalizeName`:
 * - Unicode compatibility forms are folded (NFKD): `ᴴᴰ` → `hd`, fullwidth and math letters →
 *   ASCII, Arabic presentation forms → base letters, `①` → `1`;
 * - lower case; Latin accents removed (`é` → `e`), `ß` → `ss`, `œ` → `oe`, `æ` → `ae`, `ø` → `o`,
 *   `ł` → `l`, `đ`/`ð` → `d`, `þ` → `th`, `ı` → `i`;
 * - Arabic: harakat, Quranic marks and tatweel removed; `أ إ آ ٱ` → `ا`; `ة` → `ه`; `ى` → `ي`;
 *   hamza carriers lose the hamza (`ؤ` → `و`, `ئ` → `ي`); Persian `ی` → `ي`, `ک` → `ك`;
 * - Arabic-Indic (`٠-٩`) and extended (`۰-۹`) digits → ASCII digits;
 * - `'`, `` ` ``, `.`, soft hyphens, zero-width and bidi controls, variation selectors removed;
 * - other punctuation, symbols and emoji become spaces (`+` and `&` are kept: `Canal+`);
 * - whitespace collapsed to single spaces and trimmed.
 *
 * FROZEN: M3U ContentKeys hash this output (ADR-009). Any change to what it returns changes
 * keys and orphans users' favourites, so it needs a profile migration; the golden tests in
 * `normalize.test.ts` and `content-key.test.ts` fail on purpose when it changes.
 *
 * ES2017 only (runs on Chromium 53): no Unicode property escapes, no lookbehind.
 */

const KEEP = 0;
const DROP = 1;
const SPACE = 2;
const MAP = 3;

/** What to do with each UTF-16 code unit after NFKD and lower-casing. */
const ACTION = new Uint8Array(0x10000);
/** Replacements for `MAP` code units. */
const REPLACE = new Map<number, string>();

function fill(from: number, to: number, action: number): void {
  for (let c = from; c <= to; c++) ACTION[c] = action;
}
function map(code: number, to: string): void {
  ACTION[code] = MAP;
  REPLACE.set(code, to);
}

// ASCII: letters and digits stay, `+ &` stay, `' ` .` vanish, the rest separates words.
fill(0x00, 0x7f, SPACE);
fill(0x30, 0x39, KEEP);
fill(0x61, 0x7a, KEEP);
for (let c = 0x41; c <= 0x5a; c++) map(c, String.fromCharCode(c + 32));
ACTION[0x2b] = KEEP; // +
ACTION[0x26] = KEEP; // &
ACTION[0x27] = DROP; // '
ACTION[0x60] = DROP; // `
ACTION[0x2e] = DROP; // .
// Latin-1: C1 controls, NBSP and the symbol block separate; soft hyphen vanishes.
fill(0x80, 0xbf, SPACE);
ACTION[0xad] = DROP;
ACTION[0xd7] = SPACE; // ×
ACTION[0xf7] = SPACE; // ÷
// Latin letters NFKD leaves alone.
for (const [code, to] of [
  [0xc6, 'ae'], [0xe6, 'ae'], [0xd0, 'd'], [0xf0, 'd'], [0xd8, 'o'], [0xf8, 'o'], [0xde, 'th'], [0xfe, 'th'],
  [0xdf, 'ss'], [0x110, 'd'], [0x111, 'd'], [0x126, 'h'], [0x127, 'h'], [0x131, 'i'], [0x141, 'l'], [0x142, 'l'],
  [0x152, 'oe'], [0x153, 'oe'], [0x166, 't'], [0x167, 't'],
] as const) {
  map(code, to);
}
fill(0x2b0, 0x2ff, DROP); // spacing modifier letters (ʻ ˈ …)
fill(0x300, 0x36f, DROP); // combining diacritics (the accents NFKD splits off)
fill(0x483, 0x489, DROP); // Cyrillic combining marks
// Arabic.
fill(0x600, 0x605, DROP); // number signs
fill(0x606, 0x60f, SPACE); // ، and other signs
fill(0x610, 0x61a, DROP); // honorific marks
ACTION[0x61b] = SPACE; // ؛
ACTION[0x61c] = DROP; // Arabic letter mark
fill(0x61d, 0x61f, SPACE); // ؟
map(0x622, 'ا'); // آ (NFKD splits it already; kept for safety)
map(0x623, 'ا'); // أ
map(0x625, 'ا'); // إ
map(0x629, 'ه'); // ة
ACTION[0x640] = DROP; // tatweel
map(0x649, 'ي'); // ى
fill(0x64b, 0x65f, DROP); // harakat, hamza above/below, maddah
for (let d = 0; d < 10; d++) {
  map(0x660 + d, String(d)); // ٠-٩
  map(0x6f0 + d, String(d)); // ۰-۹
}
ACTION[0x66a] = SPACE; // ٪
ACTION[0x66b] = DROP; // decimal separator
ACTION[0x66c] = DROP; // thousands separator
ACTION[0x66d] = SPACE; // ٭
ACTION[0x670] = DROP; // superscript alef
map(0x671, 'ا'); // ٱ
map(0x672, 'ا');
map(0x673, 'ا');
map(0x6a9, 'ك'); // Persian ک
map(0x6cc, 'ي'); // Persian ی
ACTION[0x6d4] = SPACE; // ۔
fill(0x6d6, 0x6dc, DROP); // Quranic marks
ACTION[0x6dd] = SPACE;
ACTION[0x6de] = SPACE;
fill(0x6df, 0x6e8, DROP);
ACTION[0x6e9] = SPACE;
fill(0x6ea, 0x6ed, DROP);
ACTION[0x6fd] = SPACE;
ACTION[0x6fe] = SPACE;
fill(0x8d3, 0x8ff, DROP); // Arabic Extended-A marks
ACTION[0x1680] = SPACE; // Ogham space mark (whitespace to JS)
ACTION[0x180e] = DROP; // Mongolian vowel separator
fill(0x1ab0, 0x1aff, DROP); // combining marks (extended, supplement)
fill(0x1dc0, 0x1dff, DROP);
// General punctuation: spaces and dashes separate; zero-width and bidi controls vanish.
fill(0x2000, 0x200a, SPACE);
fill(0x200b, 0x200f, DROP);
fill(0x2010, 0x2029, SPACE);
fill(0x202a, 0x202e, DROP);
fill(0x202f, 0x205f, SPACE);
fill(0x2060, 0x206f, DROP);
fill(0x20a0, 0x20cf, SPACE); // currency
fill(0x20d0, 0x20ff, DROP); // combining marks for symbols
fill(0x2190, 0x2bff, SPACE); // arrows, maths, technical, boxes, shapes, symbols, dingbats
fill(0x2e00, 0x2e7f, SPACE); // supplemental punctuation
fill(0x3000, 0x303f, SPACE); // CJK punctuation
fill(0xd800, 0xdfff, SPACE); // astral code points left after NFKD: emoji and symbols
fill(0xe000, 0xf8ff, SPACE); // private use
ACTION[0xfd3e] = SPACE; // ornate parentheses
ACTION[0xfd3f] = SPACE;
fill(0xfe00, 0xfe0f, DROP); // variation selectors (emoji style)
fill(0xfe20, 0xfe2f, DROP); // combining half marks
ACTION[0xfeff] = DROP; // BOM / zero-width no-break space
fill(0xfff0, 0xffff, SPACE); // specials (U+FFFD replacement character)

/** `™` and `℠` decompose to letters under NFKD (`Zoma™` → `zomatm`), so they go first. */
const TRADEMARKS = new RegExp(`[${String.fromCharCode(0x2120, 0x2122)}]`, 'g');
let buffer = new Uint16Array(256);

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** The normalized form of a name: see the module comment. Never throws. */
export function normalizeName(input: string): string {
  let s = input;
  if (!isAscii(s)) s = s.replace(TRADEMARKS, ' ').normalize('NFKD');
  s = s.toLowerCase();
  const n = s.length;
  // Expansions (ß → ss, þ → th…) at most double the length.
  if (buffer.length < n * 2) buffer = new Uint16Array(n * 2);
  let len = 0;
  let pendingSpace = false;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    const action = ACTION[c];
    if (action === KEEP) {
      if (pendingSpace) {
        if (len > 0) buffer[len++] = 0x20;
        pendingSpace = false;
      }
      buffer[len++] = c;
    } else if (action === SPACE) {
      pendingSpace = true;
    } else if (action === MAP) {
      const to = REPLACE.get(c)!;
      if (pendingSpace) {
        if (len > 0) buffer[len++] = 0x20;
        pendingSpace = false;
      }
      for (let k = 0; k < to.length; k++) buffer[len++] = to.charCodeAt(k);
    }
    // DROP: nothing.
  }
  return fromCodes(buffer, len);
}

function fromCodes(codes: Uint16Array, len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 4096) {
    out += String.fromCharCode.apply(null, codes.subarray(i, Math.min(len, i + 4096)) as unknown as number[]);
  }
  return out;
}

/** Quality and format tokens `matchName` drops (after normalization). */
const QUALITY_TOKENS = new Set([
  'sd', 'hd', 'hd+', 'fhd', 'uhd', 'hq', 'lq', '2k', '4k', '8k', 'hevc', 'avc', 'h264', 'h265', 'x264', 'x265',
  '480p', '576p', '720p', '1080p', '1080i', '2160p', '4320p', 'hdr', 'hdr10', 'hdr10+', 'sdr', '25fps', '50fps', '60fps', 'fps',
]);

/**
 * A leading country or category tag with a separator: `AR: `, `|UK| `, `UK | `, `FR - `, `[AR] `,
 * `(US) `, `VIP: `. Two letters in any case, or three or four capitals (`UAE`, `KSA`, `EXYU`).
 * A hyphen counts only with a space beside it, so `Al-Jazeera` keeps its `Al`.
 */
const PREFIX_TAG = /^[\s|[(]*(?:[A-Za-z]{2}|[A-Z]{3,4})\s*(?:[|:\])]|\s-|-\s)[\s|:\])-]*/;
/** A trailing tag in brackets or after a pipe: ` (AR)`, ` [UK]`, ` | US`, ` |US|`. */
const SUFFIX_TAG = /\s*[[(|]\s*(?:[A-Za-z]{2}|[A-Z]{3,4})\s*[\])|]?\s*$/;

/**
 * The EPG matching form of a channel name (architecture.md §1.5 step 4.5): country and category
 * tags and quality tokens (HD, FHD, 4K, HEVC, 1080p…) removed, then normalized, with no spaces
 * at all (`AR: MBC 1 HD` and `MBC1` both give `mbc1`). Applied to playlist names and XMLTV
 * display names alike. Falls back to the plain normalized name with spaces removed when
 * stripping would leave nothing.
 */
export function matchName(input: string): string {
  let raw = input;
  for (let i = 0; i < 3; i++) {
    const m = PREFIX_TAG.exec(raw);
    if (!m || m[0].length === raw.length) break;
    raw = raw.slice(m[0].length);
  }
  const suffix = SUFFIX_TAG.exec(raw);
  if (suffix && suffix.index > 0) raw = raw.slice(0, suffix.index);
  const tokens = normalizeName(raw).split(' ');
  let out = '';
  for (const token of tokens) if (!QUALITY_TOKENS.has(token)) out += token;
  return out || tokens.join('');
}
