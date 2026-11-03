/**
 * The pseudo-locale `en-XA` (RELAY step 11b, PLAN 4.2): English made longer and accented, in
 * brackets, as Android's en-XA does. It shows before any translation exists:
 * - text that doesn't come from the catalogs (it stays plain);
 * - labels that cut or wrap when a translation is longer (it is about 40% longer);
 * - strings glued together from pieces (each piece has its own brackets).
 *
 * Step 12's i18n runtime runs every catalog message through `pseudoLocalize` when the locale
 * is `en-XA`. Placeholders survive: `{name}` and ICU arguments (`{n, plural, one {…} other
 * {…}}`) keep their syntax, and only the message text inside them is accented. The accented
 * letters are all in Latin-1 and Latin Extended-A, which Zoma Sans covers (U+0000–017F).
 */
export const PSEUDO_LOCALE = 'en-XA';

/** The accented letter for each ASCII letter that has one in U+0000–017F. */
export const PSEUDO_ACCENTS: Readonly<Record<string, string>> = {
  a: 'å', c: 'ç', d: 'ð', e: 'é', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', n: 'ñ', o: 'ö',
  p: 'þ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', w: 'ŵ', y: 'ý', z: 'ž',
  A: 'Å', C: 'Ç', D: 'Ð', E: 'É', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', N: 'Ñ', O: 'Ö',
  P: 'Þ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', W: 'Ŵ', Y: 'Ý', Z: 'Ž',
};

/** How much longer the text gets: German and Arabic run 30–40% longer than English. */
export const PSEUDO_EXPANSION = 0.4;

const PADDING = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * `Settings` → `[Šéţţîñĝš one]`. Text at an even brace depth is message text and gets
 * accented; text at an odd depth is a placeholder or ICU syntax and stays as it is. Words
 * (`one two three…`, so the text can still wrap) pad it by `PSEUDO_EXPANSION` of its length.
 * Never throws: an unmatched brace just ends or opens a placeholder.
 */
export function pseudoLocalize(message: string): string {
  let out = '[';
  let depth = 0;
  let textLength = 0;
  for (let i = 0; i < message.length; i += 1) {
    const c = message.charAt(i);
    if (c === '{') {
      depth += 1;
      out += c;
    } else if (c === '}') {
      if (depth > 0) depth -= 1;
      out += c;
    } else if (depth % 2 === 0) {
      textLength += 1;
      out += PSEUDO_ACCENTS[c] ?? c;
    } else {
      out += c;
    }
  }
  const wanted = Math.ceil(textLength * PSEUDO_EXPANSION);
  let padded = 0;
  for (let w = 0; padded < wanted; w += 1) {
    const word = ` ${PADDING[w % PADDING.length] ?? ''}`;
    out += word;
    padded += word.length;
  }
  return `${out}]`;
}
