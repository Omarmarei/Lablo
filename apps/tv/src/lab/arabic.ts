/**
 * What S9 measures in the page (RELAY step 15b2, docs/architecture.md §5): the app's Lablo Sans
 * faces, Arabic shaping in them, the bidi isolation of text arguments (core's `isolateText`,
 * ADR-011) and what the engine's `Intl` makes of Arabic beside the app's own formatters.
 *
 * The verdicts are pure and unit-tested; the measuring runs in the page (e2e, the old-engine
 * harness, a TV). The bidi probe is the old-engine harness's (tools/engines gallery.ts
 * `BIDI_EXPRESSION`), ported: tools/ can't be imported here, and the lab must run it on a TV.
 */
import { isolateText } from '@lablo/core';
import type { LocaleSettings } from '@lablo/ui';
import { formatDate, formatNumber, formatTime, resolveLocale } from '@lablo/ui';

const ZWNJ = String.fromCharCode(0x200c);

/** The family the app's text uses (packages/ui/src/styles/fonts.css). */
export const FONT_FAMILY = 'Lablo Sans';

/** `Channel`, the word after a count in the app's Arabic plurals. */
export const ARABIC_WORD = 'قناة';
/** `Series`: four letters that join on both sides, and a lam-alef. */
export const SHAPING_WORD = 'مسلسلات';
/** Lam-alef, which Arabic fonts draw as one ligature. */
export const LAM_ALEF = 'لا';

/** `text` with a zero-width non-joiner between its letters: drawn unjoined, in the same font. */
export function apart(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) out += (i === 0 ? '' : ZWNJ) + text.charAt(i);
  return out;
}

// --- Fonts -------------------------------------------------------------------------------

/** One Lablo Sans face as the page's FontFaceSet reports it: `ar400`, `la700`. */
export interface FaceState {
  readonly face: string;
  readonly status: string;
}

/** The four faces fonts.css declares. */
export const EXPECTED_FACES: readonly string[] = ['la400', 'la700', 'ar400', 'ar700'];

/** `ar400` for the Arabic face of weight 400 (an engine may report `normal`/`bold`). */
export function faceName(unicodeRange: string, weight: string): string {
  const script = /^U\+0*600/i.test(unicodeRange) ? 'ar' : 'la';
  return script + (weight === 'normal' ? '400' : weight === 'bold' ? '700' : weight);
}

/** What is wrong with the faces found; empty when all four loaded. */
export function fontFailures(faces: readonly FaceState[]): string[] {
  const failures: string[] = [];
  for (const name of EXPECTED_FACES) {
    const found = faces.filter((f) => f.face === name);
    if (found.length === 0) failures.push(`no ${name} face declared`);
    else if (!found.some((f) => f.status === 'loaded')) failures.push(`${name} is ${found.map((f) => f.status).join('/')}`);
  }
  return failures;
}

interface FontFaceLike {
  readonly family: string;
  readonly unicodeRange: string;
  readonly weight: string;
  readonly status: string;
}

interface FontSetLike {
  load(font: string, text?: string): Promise<unknown>;
  forEach(run: (face: FontFaceLike) => void): void;
  check(font: string, text?: string): boolean;
}

/** The page's FontFaceSet, or null on an engine without the CSS Font Loading API. */
export function fontSet(): FontSetLike | null {
  const fonts = (document as unknown as { fonts?: FontSetLike }).fonts;
  return fonts !== undefined && typeof fonts.load === 'function' && typeof fonts.forEach === 'function' ? fonts : null;
}

/** Asks for both weights of both scripts, then reads every Lablo Sans face's status. */
export async function loadFaces(fonts: FontSetLike): Promise<FaceState[]> {
  const loads: Promise<unknown>[] = [];
  for (const weight of [400, 700]) {
    for (const sample of ['Lablo', ARABIC_WORD]) loads.push(fonts.load(`${weight} 32px "${FONT_FAMILY}"`, sample).catch(() => null));
  }
  await Promise.all(loads);
  const faces: FaceState[] = [];
  fonts.forEach((face) => {
    if (face.family.replace(/["']/g, '') !== FONT_FAMILY) return;
    faces.push({ face: faceName(face.unicodeRange, face.weight), status: face.status });
  });
  return faces;
}

// --- Measuring ---------------------------------------------------------------------------

/** A hidden, unwrapped box in Lablo Sans for measuring text; `done()` removes it. */
export function measureBox(host: HTMLElement = document.body): { readonly box: HTMLElement; width(text: string): number; done(): void } {
  const box = document.createElement('div');
  box.setAttribute('style', `position: absolute; left: 0; top: 0; visibility: hidden; white-space: nowrap; font-family: "${FONT_FAMILY}"; font-size: 48px; font-weight: 400;`);
  host.appendChild(box);
  return {
    box,
    width: (text) => {
      const span = document.createElement('span');
      span.textContent = text;
      box.appendChild(span);
      return Math.round(span.getBoundingClientRect().width * 10) / 10;
    },
    done: () => {
      if (box.parentNode !== null) box.parentNode.removeChild(box);
    },
  };
}

// --- Shaping -----------------------------------------------------------------------------

/** Widths at 48 px: joined as written, and the same letters kept apart. */
export interface ShapingAnswer {
  readonly word: number;
  readonly wordApart: number;
  readonly ligature: number;
  readonly ligatureApart: number;
}

/** Joined text must be this much narrower than its letters apart (their tails and bowls go). */
export const JOIN_RATIO = 0.95;
/** Lam-alef as one glyph is about one letter wide; lam and alef apart are two. */
export const LIGATURE_RATIO = 0.9;

export function shapingFailures(answer: ShapingAnswer): string[] {
  const failures: string[] = [];
  if (!(answer.wordApart > 0 && answer.ligatureApart > 0)) return ['nothing was drawn'];
  if (answer.word > answer.wordApart * JOIN_RATIO) failures.push(`the letters did not join (${answer.word} px joined, ${answer.wordApart} px apart)`);
  if (answer.ligature > answer.ligatureApart * LIGATURE_RATIO) failures.push(`no lam-alef ligature (${answer.ligature} px, ${answer.ligatureApart} px apart)`);
  return failures;
}

/**
 * The shaping check's result. `arabicFaceLoaded` is `document.fonts.check` for the word in Lablo
 * Sans (null without the API): when false, a fallback font was measured, which says nothing
 * about ours.
 */
export function shapingVerdict(answer: ShapingAnswer, arabicFaceLoaded: boolean | null): { readonly status: 'pass' | 'fail'; readonly note: string } {
  if (arabicFaceLoaded === false) return { status: 'fail', note: 'the Arabic face is not loaded: this measured a fallback font' };
  const failures = shapingFailures(answer);
  if (failures.length > 0) return { status: 'fail', note: failures.join('; ') };
  // The words isolated, so the English note keeps its order around them (and a person sees them drawn).
  const ltr = (text: string): string => isolateText(text, 'ltr');
  return { status: 'pass', note: `${ltr(SHAPING_WORD)} ${answer.word} px (${answer.wordApart} apart), ${ltr(LAM_ALEF)} ${answer.ligature} px (${answer.ligatureApart} apart)` };
}

export function measureShaping(width: (text: string) => number): ShapingAnswer {
  return { word: width(SHAPING_WORD), wordApart: width(apart(SHAPING_WORD)), ligature: width(LAM_ALEF), ligatureApart: width(apart(LAM_ALEF)) };
}

// --- Bidi --------------------------------------------------------------------------------

/** The lines of the harness's bidi probe (tools/engines gallery.ts `BIDI_LINES`). */
export const BIDI_LINES = {
  plain: 'Lablo 1',
  isolated: isolateText('Lablo 1', 'rtl'),
  trailing: `${isolateText('MBC 1', 'rtl')} · 240 ${ARABIC_WORD}`,
  trailingControl: `MBC 1 · 240 ${ARABIC_WORD}`,
  leading: `${isolateText('1 Lablo', 'rtl')} ${ARABIC_WORD}`,
  leadingControl: `1 Lablo ${ARABIC_WORD}`,
} as const;

/** The left edges of two parts of an RTL line. */
export interface BidiPair {
  readonly first: number;
  readonly second: number;
}

export interface BidiAnswer {
  /** `Lablo 1`, and the same as `isolateText` gives it: equal when the isolation draws nothing. */
  readonly plain: number;
  readonly isolated: number;
  /** `MBC 1 · 240 قناة`: the name and the count, isolated and not (the control). */
  readonly trailing: BidiPair;
  readonly trailingControl: BidiPair;
  /** `1 Lablo قناة`: the digit and the name, isolated and not. */
  readonly leading: BidiPair;
  readonly leadingControl: BidiPair;
}

/** How far the isolation may widen a span (sub-pixel rounding only). */
const ISOLATE_SLACK_PX = 0.5;

/**
 * Everything wrong with the probe's answer; empty when the isolation works on the engine
 * (the harness's `bidiFailures`). Not isolated, a count after a Latin name ending in a digit
 * joins the name's run (rule W7) and a name starting with a digit splits; the controls prove
 * each line can tell the two apart here.
 */
export function bidiFailures(bidi: BidiAnswer): string[] {
  const failures: string[] = [];
  const extra = Math.round((bidi.isolated - bidi.plain) * 10) / 10;
  if (Math.abs(extra) > ISOLATE_SLACK_PX) failures.push(`the isolation is drawn: ${extra} px wider (${bidi.plain} to ${bidi.isolated}), expected no width`);
  const { trailing, trailingControl, leading, leadingControl } = bidi;
  if (trailing.first <= trailing.second) failures.push(`a name ending in a digit: the count joined it (the name at x=${trailing.first}, left of the count at ${trailing.second})`);
  if (trailingControl.first >= trailingControl.second) failures.push(`the control for a name ending in a digit did not join (x=${trailingControl.first} vs ${trailingControl.second}): the line proves nothing`);
  if (leading.first >= leading.second) failures.push(`a name starting with a digit: the digit split off (at x=${leading.first}, right of the name at ${leading.second})`);
  if (leadingControl.first <= leadingControl.second) failures.push(`the control for a name starting with a digit did not split (x=${leadingControl.first} vs ${leadingControl.second}): the line proves nothing`);
  return failures;
}

/** Draws the probe's lines in `box` (RTL lines for the pairs) and reads their geometry. */
export function measureBidi(box: HTMLElement, width: (text: string) => number): BidiAnswer {
  const left = (node: Node, at: number, length: number): number => {
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + length);
    return Math.round(range.getBoundingClientRect().left * 10) / 10;
  };
  const pair = (text: string, first: string, second: string): BidiPair => {
    const line = document.createElement('div');
    line.setAttribute('dir', 'rtl');
    line.textContent = text;
    box.appendChild(line);
    const node = line.firstChild as Node;
    return { first: left(node, text.indexOf(first), first.length), second: left(node, text.indexOf(second), second.length) };
  };
  return {
    plain: width(BIDI_LINES.plain),
    isolated: width(BIDI_LINES.isolated),
    trailing: pair(BIDI_LINES.trailing, 'MBC', '240'),
    trailingControl: pair(BIDI_LINES.trailingControl, 'MBC', '240'),
    leading: pair(BIDI_LINES.leading, '1', 'Lablo'),
    leadingControl: pair(BIDI_LINES.leadingControl, '1', 'Lablo'),
  };
}

// --- Intl --------------------------------------------------------------------------------

/** The GCC's and North America's UI locales, and plain Arabic. */
export const INTL_TAGS: readonly string[] = ['ar-SA', 'ar-AE', 'ar', 'en-US'];
/** A fixed local time to format: Wednesday 4 November 2026, 20:05. */
export const SAMPLE_DATE = (): Date => new Date(2026, 10, 4, 20, 5);
export const SAMPLE_NUMBER = 1234.5;

/** Which digits a text uses: `arab` (٠–٩), `latn` (0–9), both, or none. */
export function digitsIn(text: string): 'arab' | 'latn' | 'mixed' | 'none' {
  let arab = false;
  let latn = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c >= 0x0660 && c <= 0x0669) arab = true;
    else if (c >= 0x30 && c <= 0x39) latn = true;
  }
  return arab && latn ? 'mixed' : arab ? 'arab' : latn ? 'latn' : 'none';
}

/** One locale: the engine's `Intl` answers and the app's own (ADR-011). */
export interface IntlLocale {
  readonly tag: string;
  /** In `supportedLocalesOf`: the engine has data for it rather than falling back. */
  readonly supported: boolean;
  readonly intl: { readonly locale: string; readonly calendar: string; readonly numberingSystem: string; readonly date: string; readonly time: string; readonly number: string; readonly digits: string } | { readonly error: string };
  readonly app: { readonly date: string; readonly time: string; readonly number: string; readonly digits: string };
  /** The app wrote the date, the time and the number exactly as `Intl` did. */
  readonly sameAsIntl: boolean;
}

export interface IntlAnswer {
  readonly hasIntl: boolean;
  readonly pluralRules: boolean;
  readonly timeZone: string | null;
  readonly locales: readonly IntlLocale[];
}

interface IntlLike {
  readonly DateTimeFormat: typeof Intl.DateTimeFormat;
  readonly NumberFormat: typeof Intl.NumberFormat;
}

function appLocale(tag: string, date: Date): IntlLocale['app'] {
  const settings: LocaleSettings = resolveLocale(tag);
  const number = formatNumber(SAMPLE_NUMBER, settings);
  return { date: formatDate(date, settings, 'full'), time: formatTime(date, settings), number, digits: digitsIn(number) };
}

function intlLocale(intl: IntlLike, tag: string, date: Date): IntlLocale['intl'] {
  try {
    const dates = new intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const options = dates.resolvedOptions();
    const number = new intl.NumberFormat(tag).format(SAMPLE_NUMBER);
    return {
      locale: options.locale,
      calendar: options.calendar,
      numberingSystem: options.numberingSystem,
      date: dates.format(date),
      time: new intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit' }).format(date),
      number,
      digits: digitsIn(number),
    };
  } catch (error) {
    return { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

/** What `intl` (the engine's, or undefined) makes of each tag, beside the app's formatters. */
export function readIntl(intl: IntlLike | undefined, date: Date = SAMPLE_DATE()): IntlAnswer {
  if (intl === undefined) {
    return { hasIntl: false, pluralRules: false, timeZone: null, locales: INTL_TAGS.map((tag) => ({ tag, supported: false, intl: { error: 'no Intl' }, app: appLocale(tag, date), sameAsIntl: false })) };
  }
  let supported: string[] = [];
  try {
    supported = intl.DateTimeFormat.supportedLocalesOf(INTL_TAGS.slice());
  } catch {
    supported = [];
  }
  let timeZone: string | null = null;
  try {
    timeZone = new intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    timeZone = null;
  }
  return {
    hasIntl: true,
    pluralRules: typeof (intl as { PluralRules?: unknown }).PluralRules === 'function',
    timeZone,
    locales: INTL_TAGS.map((tag) => {
      const engine = intlLocale(intl, tag, date);
      const app = appLocale(tag, date);
      const sameAsIntl = !('error' in engine) && engine.date === app.date && engine.time === app.time && engine.number === app.number;
      return { tag, supported: supported.indexOf(tag) >= 0, intl: engine, app, sameAsIntl };
    }),
  };
}

/** `ar-SA islamic-umalqura·arab, en-US gregory·latn; the app: Gregorian, latn digits (ADR-011)`. */
export function intlNote(answer: IntlAnswer): string {
  if (!answer.hasIntl) return 'no Intl; the app formats without it (ADR-011)';
  const parts = answer.locales.map((l) => ('error' in l.intl ? `${l.tag} error` : `${l.tag} ${l.intl.calendar}·${l.intl.numberingSystem}`));
  const appDigits = answer.locales
    .filter((l) => l.tag.indexOf('ar') === 0)
    .map((l) => l.app.digits)
    .filter((d, i, all) => all.indexOf(d) === i)
    .join('/');
  return `Intl: ${parts.join(', ')}; the app: Gregorian, ${appDigits} digits in Arabic (ADR-011)`;
}
