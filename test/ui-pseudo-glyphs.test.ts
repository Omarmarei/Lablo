// The en-XA pseudo-locale (RELAY step 11b) draws only letters the bundled Latin faces have,
// so a pseudo-localized screen never falls back to a system font. In root test/ because it
// joins @lablo/ui with the font inspector in tools/fonts (tools may not import ui).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PSEUDO_ACCENTS, pseudoLocalize } from '../packages/ui/src/i18n/pseudo';
import { inspectFont, toTrueType } from '../tools/fonts/src/inspect';

const FONTS = path.resolve(import.meta.dirname, '../packages/ui/assets/fonts');

describe('the en-XA pseudo-locale and Lablo Sans', () => {
  it.each(['lablo-latin-400.woff2', 'lablo-latin-700.woff2'])('%s has a glyph for every letter en-XA uses', async (file) => {
    const font = inspectFont(await toTrueType(readFileSync(path.join(FONTS, file))));
    const letters = Object.values(PSEUDO_ACCENTS);
    expect(letters.filter((c) => !font.codePoints.has(c.charCodeAt(0)))).toEqual([]);
    const sample = pseudoLocalize('The quick brown fox jumps over the lazy dog: {n} CHANNELS');
    expect(font.glyphs(sample.replace(/ /g, '')).filter((g) => g === 0)).toEqual([]);
  });
});
