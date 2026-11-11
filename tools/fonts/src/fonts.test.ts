import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { InspectedFont } from './inspect';
import { inspectFont, toTrueType } from './inspect';
import type { FontManifest } from './spec';
import { FACES, FAMILY, SOURCES, rangeCodePoints } from './spec';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const FONTS = path.join(ROOT, 'packages/ui/assets/fonts');
const manifest = JSON.parse(readFileSync(path.join(FONTS, 'fonts.json'), 'utf8')) as FontManifest;

/** Text each face must show: brand, digits (with the Arabic-Indic number signs of ADR-011), the accents the en-XA pseudo-locale uses, … */
const LATIN_TEXT = 'Lablo IPTV 0123456789 ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöøùúûüýÿ ĀāĂăĄąĆćČčĎďĘęĚěĞğİıŁłŃńŇňŐőŒœŘřŚśŞşŠšŢţŤťŰűŸŹźŻżŽž șțẞ €£¥₹₺ № ™ –—‘’“”…•';
const ARABIC_TEXT = 'لابلو ٠١٢٣٤٥٦٧٨٩ ۰۱۲۳ ٪٫٬ قناةً ،؛؟ ءآأؤإئابةتثجحخدذرزسشصضطظعغفقكلمنهوىي پچژگک ﷼ ـ';

const faces = new Map<string, Promise<InspectedFont>>();
function face(file: string): Promise<InspectedFont> {
  let found = faces.get(file);
  if (found === undefined) {
    found = toTrueType(readFileSync(path.join(FONTS, file))).then(inspectFont);
    faces.set(file, found);
  }
  return found;
}

const letters = (text: string): string[] => [...text].filter((c) => c !== ' ');

describe('font subsets (pnpm fonts)', () => {
  it('has a manifest that matches the spec', () => {
    expect(manifest.family).toBe(FAMILY);
    expect(manifest.faces.map((f) => [f.file, f.weight, f.unicodeRange, f.source, f.sourceSha256])).toEqual(
      FACES.map((f) => [f.file, f.weight, f.unicodeRange, SOURCES[f.source].file, SOURCES[f.source].sha256]),
    );
  });

  it.each(FACES.map((f) => f.file))('%s is the woff2 file the manifest describes', (file) => {
    const data = readFileSync(path.join(FONTS, file));
    const entry = manifest.faces.find((f) => f.file === file);
    expect(data.subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect([data.length, createHash('sha256').update(data).digest('hex')]).toEqual([entry?.bytes, entry?.sha256]);
    // Small enough to load at once from the package (about 25 KB each).
    expect(data.length).toBeLessThan(40 * 1024);
  });

  it.each(FACES.map((f) => f.file))('%s maps only its range, every code point the source has there', async (file) => {
    const spec = FACES.find((f) => f.file === file);
    const entry = manifest.faces.find((f) => f.file === file);
    const range = new Set(rangeCodePoints(spec?.unicodeRange ?? ''));
    const mapped = [...(await face(file)).codePoints];
    expect(mapped.filter((cp) => !range.has(cp))).toEqual([]);
    expect(mapped).toHaveLength(entry?.codePoints ?? -1);
  });

  it.each(FACES.map((f) => f.file))('%s has a glyph for every character of its sample text', async (file) => {
    const font = await face(file);
    const text = file.includes('arabic') ? ARABIC_TEXT : LATIN_TEXT;
    const missing = letters(text).filter((c) => !font.codePoints.has(c.codePointAt(0) ?? 0));
    expect(missing).toEqual([]);
    expect(font.glyphs(text.replace(/ /g, '')).filter((g) => g === 0)).toEqual([]);
  });

  it.each(['lablo-arabic-400.woff2', 'lablo-arabic-700.woff2'])('%s keeps the Arabic joining forms and the lam-alef ligature', async (file) => {
    const font = await face(file);
    const [isolated] = font.glyphs('ب');
    // Initial, medial and final beh are three glyphs, none of them the isolated one.
    const joined = font.glyphs('ببب');
    expect(new Set(joined).size).toBe(3);
    expect(joined).not.toContain(isolated);
    // Lam followed by alef becomes one glyph (the ligature), not two.
    expect(font.glyphs('لا')).toHaveLength(1);
  });

  it('declares each face in packages/ui/src/styles/fonts.css with its weight and range', () => {
    const css = readFileSync(path.join(ROOT, 'packages/ui/src/styles/fonts.css'), 'utf8');
    const blocks = css.split('@font-face').slice(1);
    const declared = blocks.map((block) => ({
      family: /font-family:\s*'([^']+)'/.exec(block)?.[1],
      weight: Number(/font-weight:\s*(\d+)/.exec(block)?.[1]),
      file: /url\('\.\.\/\.\.\/assets\/fonts\/([^']+)'\)\s*format\('woff2'\)/.exec(block)?.[1],
      range: /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim(),
    }));
    expect(declared).toEqual(manifest.faces.map((f) => ({ family: FAMILY, weight: f.weight, file: f.file, range: f.unicodeRange })));
  });

  it('reads unicode-range values the way CSS does', () => {
    expect(rangeCodePoints('U+00e9, U+41-43')).toEqual([0x41, 0x42, 0x43, 0xe9]);
    // Overlapping parts count once (the subset's code point count depends on it).
    expect(rangeCodePoints('U+41-43, U+42')).toEqual([0x41, 0x42, 0x43]);
    expect(() => rangeCodePoints('U+43-41')).toThrow();
    expect(() => rangeCodePoints('U+4?')).toThrow();
  });
});
