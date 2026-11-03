import { createRequire } from 'node:module';
import { Blob, Buffer as HbBuffer, Face, Font, shape } from 'harfbuzzjs';

const require = createRequire(import.meta.url);

interface Fontverter {
  convert(font: Buffer, to: 'woff2' | 'truetype', from?: 'woff2' | 'truetype'): Promise<Buffer>;
}
type SubsetFont = (font: Buffer, text: string, options?: { targetFormat?: 'woff2' | 'truetype' }) => Promise<Buffer>;

/** fontverter and subset-font are CommonJS without types. */
const fontverter = require('fontverter') as Fontverter;
const subsetFont = require('subset-font') as SubsetFont;

/** HarfBuzz's subsetter (with layout closure, so Arabic joining forms stay) to woff2. */
export function subsetToWoff2(source: Buffer, codePoints: readonly number[]): Promise<Buffer> {
  return subsetFont(source, String.fromCodePoint(...codePoints), { targetFormat: 'woff2' });
}

export async function toTrueType(woff2: Buffer): Promise<Buffer> {
  return fontverter.convert(woff2, 'truetype', 'woff2');
}

export interface InspectedFont {
  /** The code points the font's cmap maps. */
  readonly codePoints: ReadonlySet<number>;
  /** HarfBuzz's glyph ids for `text` (0 is .notdef). */
  glyphs(text: string): number[];
}

/** Reads a TrueType font (not woff2: convert first) with HarfBuzz. */
export function inspectFont(trueType: Buffer): InspectedFont {
  const face = new Face(new Blob(new Uint8Array(trueType)), 0);
  const font = new Font(face);
  return {
    codePoints: new Set(face.collectUnicodes()),
    glyphs(text) {
      const buffer = new HbBuffer();
      buffer.addText(text);
      buffer.guessSegmentProperties();
      shape(font, buffer);
      return buffer.getGlyphInfos().map((info) => info.codepoint);
    },
  };
}
