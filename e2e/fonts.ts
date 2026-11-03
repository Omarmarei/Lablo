import type { Page } from '@playwright/test';

export interface RenderedFont {
  readonly familyName: string;
  readonly isCustomFont: boolean;
  readonly glyphCount: number;
}

/**
 * The fonts Chromium actually drew an element's text with (DevTools' "Rendered fonts"), after
 * the page's fonts have loaded. A web font shows with its own family name (Noto Sans, Noto
 * Sans Arabic UI) and `isCustomFont: true`; a system fallback would show as a local font.
 * Covers the element's whole subtree, sorted by family name.
 */
export async function renderedFonts(page: Page, selector: string): Promise<RenderedFont[]> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (nodeId === 0) throw new Error(`no element matches ${selector}`);
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts
      .map((f) => ({ familyName: f.familyName, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount }))
      .sort((a, b) => (a.familyName < b.familyName ? -1 : a.familyName > b.familyName ? 1 : 0));
  } finally {
    await cdp.detach();
  }
}

/** The bundled Zoma Sans faces: Latin text in Noto Sans, Arabic text in Noto Sans Arabic UI. */
export const LATIN_FACE = 'Noto Sans';
export const ARABIC_FACE = 'Noto Sans Arabic UI';

/** The hello screen's title, "Zoma زوما": four glyphs from each face. */
export const TITLE_FONTS: readonly RenderedFont[] = [
  { familyName: LATIN_FACE, isCustomFont: true, glyphCount: 4 },
  { familyName: ARABIC_FACE, isCustomFont: true, glyphCount: 4 },
];

/**
 * The fonts drawn anywhere under `selector`: `CSS.getPlatformFontsForNode` for each element,
 * merged by family. Needed for a layout subtree: the CDP call covers an element's own text and
 * its inline descendants, but not the text inside block or flex children.
 */
export async function renderedFontsUnder(page: Page, selector: string): Promise<RenderedFont[]> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `${selector}, ${selector} *` });
    if (nodeIds.length === 0) throw new Error(`no element matches ${selector}`);
    const merged = new Map<string, RenderedFont>();
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      for (const f of fonts) {
        const key = `${f.familyName}|${String(f.isCustomFont)}`;
        const seen = merged.get(key);
        merged.set(key, { familyName: f.familyName, isCustomFont: f.isCustomFont, glyphCount: (seen?.glyphCount ?? 0) + f.glyphCount });
      }
    }
    return [...merged.values()].sort((a, b) => (a.familyName < b.familyName ? -1 : a.familyName > b.familyName ? 1 : 0));
  } finally {
    await cdp.detach();
  }
}
