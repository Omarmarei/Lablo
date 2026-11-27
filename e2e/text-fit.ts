import type { Page } from '@playwright/test';

/**
 * The text-fit check (RELAY step 58a): a line of text drawn outside the box it belongs to.
 *
 * Found on the LG (leg 168): rows are fixed-height boxes (Settings 120 px, search results 88 px,
 * both virtual lists with a fixed pitch), and a hint that wraps, or Larger text, drew its second
 * line across the row's edge or had it cut by the row. `spilled()` (accessibility.spec.ts) only
 * saw text wider than its element. The fonts are bundled, so desktop Chromium lays text out as the
 * TV does and this check sees what the TV shows.
 *
 * For each text node shown, its line boxes (a Range's client rects), and for each button its box
 * (an icon button has no text to see), are taken up the ancestors:
 * - an element that cuts text on purpose clips them (`text-overflow: ellipsis`, or `nowrap`/`pre`
 *   with `overflow` hidden: across; `-webkit-line-clamp`: down), and its glyphs must still fit it
 *   down (a cut line, not a cut glyph). The app's own words are never cut: only the provider's
 *   (`translate="no"`: names, programmes) and typed text may be;
 * - the first other element that draws a box (a background, a border, a background image) or
 *   clips is the text's box: every line must lie inside it (the border box; the padding box when
 *   it clips). That is the finding.
 * A line is its line box (the line height around the glyphs' middle): a font's glyph box is
 * taller than a tight line (Noto Sans: 1.36 em; a title's line is 1.19 em), and the glyphs drawn
 * stay inside the line. Lines more than `TOLERANCE` px out count (sub-pixel layout).
 */
export interface Misfit {
  /** The start of the text. */
  readonly text: string;
  /** The box it belongs to: its test id, else its class. */
  readonly box: string;
  /** How far out, in px (rounded up). */
  readonly by: number;
  /** `spills`: drawn over the box's edge; `clipped`: cut off by it; `cut`: the app's own words cut short (an ellipsis). */
  readonly how: 'spills' | 'clipped' | 'cut';
}

export const TOLERANCE = 1;

/** Every line of text under `root` (a selector; the whole page by default) that is out of its box. */
export function misfits(page: Page, root = 'body'): Promise<Misfit[]> {
  return page.evaluate(
    ({ rootSelector, tolerance }) => {
      interface Box {
        l: number;
        t: number;
        r: number;
        b: number;
      }
      const found: Array<{ text: string; box: string; by: number; how: 'spills' | 'clipped' | 'cut' }> = [];
      const start = document.querySelector(rootSelector);
      if (start === null) return found;
      const name = (el: Element): string => {
        const id = el.getAttribute('data-testid');
        if (id !== null) return id;
        const cls = el.getAttribute('class');
        return cls !== null && cls !== '' ? cls : el.tagName.toLowerCase();
      };
      const px = (value: string): number => parseFloat(value) || 0;
      const painted = (style: CSSStyleDeclaration): boolean => {
        const background = style.backgroundColor;
        if (background !== '' && background !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(background)) return true;
        if (style.backgroundImage !== 'none') return true;
        return px(style.borderTopWidth) + px(style.borderRightWidth) + px(style.borderBottomWidth) + px(style.borderLeftWidth) > 0;
      };
      /** The element's padding box (inside its borders). */
      const inner = (el: Element, style: CSSStyleDeclaration): Box => {
        const r = el.getBoundingClientRect();
        return {
          l: r.left + px(style.borderLeftWidth),
          t: r.top + px(style.borderTopWidth),
          r: r.right - px(style.borderRightWidth),
          b: r.bottom - px(style.borderBottomWidth),
        };
      };
      const outer = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      };
      const out = (line: Box, box: Box, across: boolean, down: boolean): number =>
        Math.max(
          across ? box.l - line.l : 0,
          across ? line.r - box.r : 0,
          down ? box.t - line.t : 0,
          down ? line.b - box.b : 0,
        );
      const shown = (el: Element): boolean => {
        const check = (el as Element & { checkVisibility?: (options: object) => boolean }).checkVisibility;
        if (check !== undefined && !check.call(el, { opacityProperty: true, visibilityProperty: true })) return false;
        return el.getClientRects().length > 0;
      };
      /**
       * Takes `lines` (a text's line boxes, or a button's box) up from `from`: cut where an element
       * cuts on purpose, then held against the first element that draws a box or clips.
       */
      const check = (lines: Box[], from: Element, text: string, own: boolean): void => {
        for (let el: Element | null = from; el !== null && el !== document.body && lines.length > 0; el = el.parentElement) {
          const style = getComputedStyle(el);
          const clipsAcross = style.overflowX !== 'visible';
          const clipsDown = style.overflowY !== 'visible';
          const clamp = (style as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp;
          const cutsAcross = clipsAcross && (style.textOverflow === 'ellipsis' || style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre');
          const cutsDown = clipsDown && clamp !== undefined && clamp !== 'none' && clamp !== '';
          if (cutsAcross || cutsDown) {
            const box = inner(el, style);
            const past = Math.max(0, ...lines.map((line) => out(line, box, cutsAcross, cutsDown)));
            if (past > tolerance && own) {
              found.push({ text: text.slice(0, 60), box: name(el), by: Math.ceil(past), how: 'cut' });
              return;
            }
            if (cutsAcross && !cutsDown) {
              // A cut line, not a cut glyph: its height must fit.
              const worst = Math.max(0, ...lines.map((line) => out(line, box, false, true)));
              if (worst > tolerance) {
                found.push({ text: text.slice(0, 60), box: name(el), by: Math.ceil(worst), how: 'clipped' });
                return;
              }
            }
            lines = lines
              .map((line) => ({
                l: cutsAcross ? Math.max(line.l, box.l) : line.l,
                r: cutsAcross ? Math.min(line.r, box.r) : line.r,
                t: cutsDown ? Math.max(line.t, box.t) : line.t,
                b: cutsDown ? Math.min(line.b, box.b) : line.b,
              }))
              .filter((line) => line.r > line.l && line.b > line.t);
            if (!painted(style)) continue;
          }
          const clips = clipsAcross || clipsDown;
          if (!clips && !painted(style)) continue;
          const box = clips ? inner(el, style) : outer(el);
          const worst = Math.max(0, ...lines.map((line) => out(line, box, true, true)));
          if (worst > tolerance) found.push({ text: text.slice(0, 60), box: name(el), by: Math.ceil(worst), how: clips ? 'clipped' : 'spills' });
          return;
        }
      };
      const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        // Bidi isolates and marks draw nothing.
        const text = (node.textContent ?? '').replace(/[\u200e\u200f\u2066-\u2069\s]+/g, ' ').trim();
        const parent = node.parentElement;
        if (text === '' || parent === null || !shown(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const lines: Box[] = [];
        const rects = range.getClientRects();
        // A rect is the glyph box (the font's ascent and descent); the line box is the line height
        // around its middle, which is what the layout gives the line (glyphs drawn in a tight line
        // stay inside it).
        const lineHeight = px(getComputedStyle(parent).lineHeight);
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i]!;
          if (r.width <= 0 || r.height <= 0) continue;
          const half = lineHeight > 0 && lineHeight < r.height ? lineHeight / 2 : r.height / 2;
          const middle = (r.top + r.bottom) / 2;
          lines.push({ l: r.left, t: middle - half, r: r.right, b: middle + half });
        }
        // The app's own words are never cut; the provider's (translate="no") and typed text may be.
        check(lines, parent, text, parent.closest('[translate="no"]') === null);
      }
      // A button (an icon one too: no text to see) whole inside its box.
      const buttons = start.querySelectorAll('.z-button');
      for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i]!;
        if (!shown(button) || button.parentElement === null) continue;
        const r = button.getBoundingClientRect();
        check([{ l: r.left, t: r.top, r: r.right, b: r.bottom }], button.parentElement, `button ${(button.getAttribute('aria-label') ?? button.textContent ?? '').trim()}`, false);
      }
      return found;
    },
    { rootSelector: root, tolerance: TOLERANCE },
  );
}
