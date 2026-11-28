import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { checkCss, formatCssViolations } from './css-gate';

const found = (css: string): string[] => checkCss(postcss.parse(css, { from: '/repo/packages/ui/src/x.css' })).map((v) => v.found);

describe('Chromium 68 CSS gate', () => {
  it('passes the CSS the cheat sheet allows', () => {
    const allowed = `
      :root { --gap: 8px; --scrim: rgba(5, 8, 12, 0.78); }
      .a { display: flex; flex-wrap: wrap; margin-left: var(--gap); padding: 0 4px; }
      .b { width: calc(100% - 96px); height: 50vh; min-width: 10vmin; color: #fff; background: #0b0f14; }
      .c { transform: translateX(10px); transition: opacity 120ms; -webkit-user-select: none; }
      .d:not(.e) { position: absolute; text-overflow: ellipsis; }
      [dir="rtl"] .f { margin-right: 8px; text-align: right; }
      .g::-webkit-input-placeholder { color: rgb(1, 2, 3); }
      @media (min-width: 1280px) { .h { font-size: 28px; } }
      @font-face { font-family: 'X'; src: url('x.woff2') format('woff2'); unicode-range: U+0600-06FF; }
    `;
    expect(found(allowed)).toEqual([]);
  });

  it.each([
    // Newer than Chromium 53, in Chromium 68 (RELAY step 61a; caniuse's first full version).
    ['.a { display: grid; grid-template-columns: 1fr 1fr; grid-column: 1 / 3; grid-gap: 8px; }', 'grid (57)'],
    ['.a { display: inline-grid; place-items: center; }', 'grid (57)'],
    ['.a { display: flow-root; }', 'flow-root (58)'],
    ['.a { position: sticky; }', 'sticky (56)'],
    ['.a:focus-within { color: red; }', ':focus-within (60)'],
    ['.a::placeholder { color: red; }', '::placeholder (57)'],
    ['.a:any-link { color: red; }', ':any-link (65)'],
    ['.a { color: #0008; background: #00000080; }', '#rgba hex (62)'],
    ['.a { color: rgb(0 0 0 / 50%); }', 'space-separated colours (65)'],
    ['.a { user-select: none; clip-path: circle(50%); }', 'unprefixed user-select (54) and clip-path (55)'],
  ])('passes %s, which Chromium 68 has: %s', (css) => {
    expect(found(css)).toEqual([]);
  });

  it.each([
    ['.a { gap: 8px; }', 'gap: 8px'],
    ['.a { row-gap: 8px; }', 'row-gap: 8px'],
    ['.a { display: contents; }', 'display: contents'],
    ['.a { mask-image: url(x.png); }', 'mask-image: url(x.png)'],
    ['.a { appearance: none; }', 'appearance: none'],
    ['.a { backdrop-filter: blur(4px); }', 'backdrop-filter: blur(4px)'],
    ['.a { top: env(safe-area-inset-top); }', 'top: env(safe-area-inset-top)'],
    ['.a { background: image-set(url(a.png) 1x); }', 'background: image-set(url(a.png) 1x)'],
    ['.a { column-gap: 8px; }', 'column-gap: 8px'],
    ['.a { margin-inline-start: 8px; }', 'margin-inline-start: 8px'],
    ['.a { padding-block: 8px; }', 'padding-block: 8px'],
    ['.a { inset: 0; }', 'inset: 0'],
    ['.a { inline-size: 10px; }', 'inline-size: 10px'],
    ['.a { border-start-start-radius: 4px; }', 'border-start-start-radius: 4px'],
    ['.a { float: inline-start; }', 'float: inline-start'],
    ['.a { aspect-ratio: 16 / 9; }', 'aspect-ratio: 16 / 9'],
    ['.a { translate: 10px; }', 'translate: 10px'],
    ['.a { width: clamp(1px, 2vw, 3px); }', 'width: clamp(1px, 2vw, 3px)'],
    ['.a { width: min(10px, 5vw); }', 'width: min(10px, 5vw)'],
    // A token is checked by its value wherever it is declared.
    [':root { --edge: max(1px, 2vw); }', '--edge: max(1px, 2vw)'],
    ['.a { color: oklch(70% 0.1 200); }', 'color: oklch(70% 0.1 200)'],
    ['.a { height: 100dvh; }', 'height: 100dvh'],
    ['.a { background: conic-gradient(red, blue); }', 'background: conic-gradient(red, blue)'],
    ['.a:focus-visible { color: red; }', '.a:focus-visible'],
    [':is(.a, .b) { color: red; }', ':is(.a, .b)'],
    ['.a:has(.b) { color: red; }', '.a:has(.b)'],
    ['.a:not(.b, .c) { color: red; }', '.a:not(.b, .c)'],
    ['.a:dir(rtl) { color: red; }', '.a:dir(rtl)'],
    ['.a { & .b { color: red; } }', '& .b'],
    ['@layer base { .a { color: red; } }', '@layer base'],
    ['@container (min-width: 10px) { .a { color: red; } }', '@container (min-width: 10px)'],
    ['@media (width >= 600px) { .a { color: red; } }', '@media (width >= 600px)'],
  ])('fails %s', (css, expected) => {
    expect(found(css)).toContain(expected);
  });

  it('says where and why', () => {
    const violations = checkCss(postcss.parse('.a {\n  gap: 8px;\n}\n', { from: '/repo/packages/ui/src/x.css' }));
    expect(violations).toEqual([{ where: 'ui/src/x.css:2:3', found: 'gap: 8px', reason: 'flex gap is Chromium 84+: use margins' }]);
    expect(formatCssViolations('app.css (webos)', violations)).toBe(
      'Chromium 68 CSS gate failed for app.css (webos) (1):\n  ui/src/x.css:2:3  gap: 8px\n    flex gap is Chromium 84+: use margins',
    );
  });
});
