import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { checkCss, formatCssViolations } from './css-gate';

const found = (css: string): string[] => checkCss(postcss.parse(css, { from: '/repo/packages/ui/src/x.css' })).map((v) => v.found);

describe('Chromium 53 CSS gate', () => {
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
    ['.a { display: grid; }', 'display: grid'],
    ['.a { display: inline-grid; }', 'display: inline-grid'],
    ['.a { grid-template-columns: 1fr 1fr; }', 'grid-template-columns: 1fr 1fr'],
    ['.a { gap: 8px; }', 'gap: 8px'],
    ['.a { column-gap: 8px; }', 'column-gap: 8px'],
    ['.a { position: sticky; }', 'position: sticky'],
    ['.a { margin-inline-start: 8px; }', 'margin-inline-start: 8px'],
    ['.a { padding-block: 8px; }', 'padding-block: 8px'],
    ['.a { inset: 0; }', 'inset: 0'],
    ['.a { inline-size: 10px; }', 'inline-size: 10px'],
    ['.a { border-start-start-radius: 4px; }', 'border-start-start-radius: 4px'],
    ['.a { float: inline-start; }', 'float: inline-start'],
    ['.a { aspect-ratio: 16 / 9; }', 'aspect-ratio: 16 / 9'],
    ['.a { user-select: none; }', 'user-select: none'],
    ['.a { clip-path: circle(50%); }', 'clip-path: circle(50%)'],
    ['.a { translate: 10px; }', 'translate: 10px'],
    ['.a { width: clamp(1px, 2vw, 3px); }', 'width: clamp(1px, 2vw, 3px)'],
    ['.a { width: min(10px, 5vw); }', 'width: min(10px, 5vw)'],
    ['.a { color: #0008; }', 'color: #0008'],
    ['.a { color: #00000080; }', 'color: #00000080'],
    ['.a { color: rgb(0 0 0 / 50%); }', 'color: rgb(0 0 0 / 50%)'],
    ['.a { color: oklch(70% 0.1 200); }', 'color: oklch(70% 0.1 200)'],
    ['.a { height: 100dvh; }', 'height: 100dvh'],
    ['.a { background: conic-gradient(red, blue); }', 'background: conic-gradient(red, blue)'],
    // A token is checked by its value wherever it is declared.
    [':root { --scrim: #0008; }', '--scrim: #0008'],
    ['.a:focus-visible { color: red; }', '.a:focus-visible'],
    ['.a:focus-within { color: red; }', '.a:focus-within'],
    [':is(.a, .b) { color: red; }', ':is(.a, .b)'],
    ['.a:has(.b) { color: red; }', '.a:has(.b)'],
    ['.a:not(.b, .c) { color: red; }', '.a:not(.b, .c)'],
    ['.a:dir(rtl) { color: red; }', '.a:dir(rtl)'],
    ['.a::placeholder { color: red; }', '.a::placeholder'],
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
      'Chromium 53 CSS gate failed for app.css (webos) (1):\n  ui/src/x.css:2:3  gap: 8px\n    flex gap is Chromium 84+: use margins',
    );
  });
});
