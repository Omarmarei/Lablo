/**
 * The app's fonts (RELAY step 11, PLAN 4.2): one family, "Zoma Sans", made of a Latin face
 * (Noto Sans) and an Arabic face (Noto Sans Arabic UI) in two weights, each subset to the
 * characters the app can show and stored as woff2 in packages/ui/assets/fonts.
 *
 * - Static instances, not the variable fonts: variable fonts are Chromium 62+.
 * - Noto Sans Arabic UI rather than Noto Sans Arabic: its vertical metrics are made to sit on
 *   one line with Latin UI text, so mixed Arabic and Latin channel names centre alike in fixed
 *   row heights.
 * - Unhinted: TV text is 22 px and up, where hinting changes little and costs bytes.
 * - Both are SIL OFL 1.1 without a Reserved Font Name, so the subsets keep their names.
 *   The licences ship in the TV package (tools/build: assets/fonts-OFL.txt).
 *
 * `pnpm fonts` downloads the sources at the pinned commit, checks their SHA-256 and writes the
 * subsets, `fonts.json` and the licence (tools/fonts/fonts.ts).
 */
const NOTO_COMMIT = 'e408cf09bf2042e9fe0d7d22789c29510e876359';
const NOTO = `https://raw.githubusercontent.com/notofonts/notofonts.github.io/${NOTO_COMMIT}/fonts`;

export interface FontSource {
  readonly file: string;
  readonly url: string;
  readonly sha256: string;
}

export const SOURCES = {
  latin400: {
    file: 'NotoSans-Regular.ttf',
    url: `${NOTO}/NotoSans/unhinted/ttf/NotoSans-Regular.ttf`,
    sha256: 'f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8',
  },
  latin700: {
    file: 'NotoSans-Bold.ttf',
    url: `${NOTO}/NotoSans/unhinted/ttf/NotoSans-Bold.ttf`,
    sha256: '87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9',
  },
  arabic400: {
    file: 'NotoSansArabicUI-Regular.ttf',
    url: `${NOTO}/NotoSansArabicUI/unhinted/ttf/NotoSansArabicUI-Regular.ttf`,
    sha256: 'f4fe1866a64cba1e8b8d08a67cd29070f919edf778ca5de983c1f2a690fc953b',
  },
  arabic700: {
    file: 'NotoSansArabicUI-Bold.ttf',
    url: `${NOTO}/NotoSansArabicUI/unhinted/ttf/NotoSansArabicUI-Bold.ttf`,
    sha256: 'efb903b545a00a557c9d2dd739725157c04bf44215ba31b8ca3a805f099fdc33',
  },
} as const satisfies Record<string, FontSource>;

/** The two families' licences, at the commits of their own repositories. */
export const LICENCES: readonly FontSource[] = [
  {
    file: 'OFL-NotoSans.txt',
    url: 'https://raw.githubusercontent.com/notofonts/latin-greek-cyrillic/0ef94805d19e98ed658543a7c48c0a4f19cc0ac0/OFL.txt',
    sha256: 'cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a',
  },
  {
    file: 'OFL-NotoSansArabicUI.txt',
    url: 'https://raw.githubusercontent.com/notofonts/arabic/f1ba474be91d6a5d2cfcc4374bb03cc5f1011088/OFL.txt',
    sha256: 'a7a5a25eb188bf1cd96982030d53e23c33485c69b1044a562254226857ee13af',
  },
];

/**
 * Latin: ASCII, Latin-1 and Latin Extended-A (European channel names, and the accented
 * letters of the en-XA pseudo-locale), Romanian comma letters, ẞ, general punctuation,
 * currency signs, №, ™, minus, division slash, BOM, replacement char. (Noto Sans has no
 * arrows: key hints draw theirs.)
 */
export const LATIN_RANGE = 'U+0000-017F, U+0218-021B, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+1E9E, U+2000-206F, U+20A0-20C0, U+2116, U+2122, U+2212, U+2215, U+FEFF, U+FFFD';

/**
 * Arabic: the Arabic block (letters, Arabic-Indic and Persian digits, ، ؛ ؟, tatweel,
 * harakat), Presentation Forms-B (legacy playlists carry them), the ﷲ, ﷺ and ﷼ (rial)
 * ligatures, and the joiners and direction marks (ZWNJ, ZWJ, LRM, RLM; ALM is in the block).
 */
export const ARABIC_RANGE = 'U+0600-06FF, U+200C-200F, U+FDF2, U+FDFA, U+FDFC, U+FE70-FEFF';

export const FAMILY = 'Zoma Sans';

export interface FaceSpec {
  /** Output file in packages/ui/assets/fonts. */
  readonly file: string;
  readonly source: keyof typeof SOURCES;
  readonly weight: 400 | 700;
  readonly unicodeRange: string;
}

export const FACES: readonly FaceSpec[] = [
  { file: 'zoma-latin-400.woff2', source: 'latin400', weight: 400, unicodeRange: LATIN_RANGE },
  { file: 'zoma-latin-700.woff2', source: 'latin700', weight: 700, unicodeRange: LATIN_RANGE },
  { file: 'zoma-arabic-400.woff2', source: 'arabic400', weight: 400, unicodeRange: ARABIC_RANGE },
  { file: 'zoma-arabic-700.woff2', source: 'arabic700', weight: 700, unicodeRange: ARABIC_RANGE },
];

/** Every code point a CSS `unicode-range` value names, once each, in ascending order. */
export function rangeCodePoints(range: string): number[] {
  const out = new Set<number>();
  for (const part of range.split(',')) {
    const match = /^\s*U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?\s*$/i.exec(part);
    if (match === null) throw new Error(`bad unicode-range part "${part}"`);
    const from = parseInt(match[1] ?? '', 16);
    const to = match[2] === undefined ? from : parseInt(match[2], 16);
    if (to < from) throw new Error(`bad unicode-range part "${part}"`);
    for (let cp = from; cp <= to; cp += 1) out.add(cp);
  }
  return [...out].sort((a, b) => a - b);
}

/** What `pnpm fonts` wrote: the test checks the committed files against it. */
export interface FontManifest {
  readonly family: string;
  readonly faces: ReadonlyArray<{
    readonly file: string;
    readonly weight: number;
    readonly unicodeRange: string;
    readonly source: string;
    readonly sourceSha256: string;
    readonly sha256: string;
    readonly bytes: number;
    /** Code points of the range that the source font has (and so the subset keeps). */
    readonly codePoints: number;
  }>;
}
