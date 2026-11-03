/**
 * Bidi isolation for the text we put into our sentences: a provider's channel name inside an
 * Arabic message, an Arabic name inside an English one (RELAY steps 12a and 12b, ADR-011).
 *
 * Unicode's answer is FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE, and current engines honour
 * it. The TVs' engines don't: Chromium 53, 56 and 68 draw FSI/PDI at zero width but ignore them
 * for bidi (measured by the old-engine harness, step 12b), so a count after a Latin name ending
 * in a digit joined the name's run (rule W7), and a name starting with a digit split. They do
 * honour LRM and RLM, so the isolate also carries marks, outside it:
 *
 *   outer + inner + FSI + text + PDI + inner + outer
 *
 * `outer` is the sentence's direction (RLM in Arabic): what comes after the text sees a strong
 * character of the sentence, not the text's last one. `inner` is the text's own first-strong
 * direction (what FSI picks): its leading and trailing digits and punctuation stay with it.
 * Inside the isolate, the inner mark didn't help Chromium 53 with a leading digit; outside it,
 * both cases work there and in current engines (the harness measures both).
 * Everything here is zero width. Built from char codes, and no RegExp (TV code: no polyfills).
 */
export type TextDirection = 'ltr' | 'rtl';

const LRM = 0x200e;
const RLM = 0x200f;
const FSI = 0x2068;
const PDI = 0x2069;

/** Inside U+0590–08FF (Hebrew to Arabic Extended), the code points that are not strong R/AL: marks, digits, separators. */
const RTL_BLOCK_WEAK: readonly (readonly [number, number])[] = [
  [0x0591, 0x05c7], // Hebrew points and accents (approximately: a name never starts with its few R punctuation marks)
  [0x0600, 0x060a], // Arabic number signs (AN), ؉ ؊ (ET)
  [0x060c, 0x060c], // ، Arabic comma (CS)
  [0x060e, 0x061a], // poetic signs (ON), honorifics and small high marks (NSM)
  [0x064b, 0x066c], // harakat (NSM), Arabic-Indic digits and separators (AN), ٪ (ET)
  [0x0670, 0x0670], // superscript alef (NSM)
  [0x06d6, 0x06e4], // Quranic marks (NSM; ۝ AN, ۞ ON); ۥ ۦ are letters
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x06f0, 0x06f9], // Extended Arabic-Indic digits (EN)
  [0x0711, 0x0711], // Syriac superscript alaph (NSM)
  [0x0730, 0x074a], // Syriac points (NSM)
  [0x07a6, 0x07b0], // Thaana vowels (NSM)
  [0x07eb, 0x07f3], // NKo tones (NSM)
  [0x0816, 0x0819], // Samaritan marks, around its three modifier letters
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0859, 0x085b], // Mandaic marks (NSM)
  [0x0890, 0x089f], // Arabic pound and piastre marks, Quranic marks
  [0x08ca, 0x08ff], // Arabic Extended-A marks (NSM; approximately)
];

function inRanges(c: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    if (range !== undefined && c >= range[0] && c <= range[1]) return true;
  }
  return false;
}

/** Strong right-to-left (R or AL): the RTL letters of the BMP and, by their high surrogates, of the RTL planes. */
function isStrongRtl(c: number): boolean {
  if (c === RLM) return true;
  if (c >= 0x0590 && c <= 0x08ff) return !inRanges(c, RTL_BLOCK_WEAK);
  if (c >= 0xfb1d && c <= 0xfdff) return c !== 0xfb1e && c !== 0xfd3e && c !== 0xfd3f; // Hebrew and Arabic presentation forms
  if (c >= 0xfe70 && c <= 0xfefe) return true; // Arabic presentation forms B
  // U+10800–10FFF (Cypriot to Old Uyghur) and U+1E800–1EFFF (Mende Kikakui to Arabic math).
  return c === 0xd802 || c === 0xd803 || c === 0xd83a || c === 0xd83b;
}

/**
 * Strong left-to-right, approximately: Latin letters, then every block with letters outside the
 * RTL ones, the combining marks, the punctuation and symbol blocks and the emoji planes.
 */
function isStrongLtr(c: number): boolean {
  if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return true;
  if (c < 0xc0) return c === 0xaa || c === 0xb5 || c === 0xba;
  if (c === 0xd7 || c === 0xf7) return false;
  if (c === LRM) return true;
  if (c >= 0x0300 && c <= 0x036f) return false; // combining diacritics (NSM)
  if (c >= 0x0590 && c <= 0x08ff) return false;
  if (c >= 0x2000 && c <= 0x2bff) return false; // punctuation, sub/superscripts, currency, letterlike, arrows, math, shapes
  if (c >= 0x3000 && c <= 0x303f) return false; // CJK punctuation
  if (c >= 0xd83c && c <= 0xd83e) return false; // emoji and pictographs (their high surrogates)
  if (c >= 0xdc00 && c <= 0xdfff) return false; // a low surrogate: its high one decided
  if (c >= 0xfb1d && c <= 0xfeff) return false; // presentation forms, variation selectors, CJK compatibility punctuation, BOM
  if (c >= 0xff01 && c <= 0xff20) return false; // fullwidth digits and punctuation
  if (c >= 0xfff0) return false; // specials
  return !isStrongRtl(c);
}

/** The direction of the first strong character (UAX #9 rules P2–P3, as FSI decides); null when there is none. */
export function firstStrongDirection(text: string): TextDirection | null {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (isStrongRtl(c)) return 'rtl';
    if (isStrongLtr(c)) return 'ltr';
  }
  return null;
}

const mark = (dir: TextDirection): string => String.fromCharCode(dir === 'rtl' ? RLM : LRM);

/** `text` isolated inside a sentence that runs `around` (see the top of this file). */
export function isolateText(text: string, around: TextDirection): string {
  const inner = mark(firstStrongDirection(text) ?? 'ltr');
  const outer = mark(around);
  return `${outer}${inner}${String.fromCharCode(FSI)}${text}${String.fromCharCode(PDI)}${inner}${outer}`;
}

/** Removes every isolate and mark again, the text's own included: for tests and for comparing text. */
export function stripIsolates(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c !== FSI && c !== PDI && c !== LRM && c !== RLM) out += text.charAt(i);
  }
  return out;
}
