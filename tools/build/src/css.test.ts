import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleIife } from './bundle';
import { buildCss } from './css';
import { CssGateError } from './css-gate';

const FIXTURES = path.resolve(import.meta.dirname, '../test/fixtures/css');
const fixture = (name: string): string => path.join(FIXTURES, name);

/** A CSS file in a fresh temporary folder. */
function cssFile(name: string, css: string): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'lablo-css-')), name);
  writeFileSync(file, css);
  return file;
}

describe('TV CSS (tools/build/src/css.ts)', () => {
  it('lists the CSS a bundle imports in the order the modules run, and leaves it out of main.js', async () => {
    const result = await bundleIife({ input: fixture('entry.ts'), platform: 'webos' });
    expect(result.css).toEqual([fixture('lib/base.css'), fixture('lib/widget.css'), fixture('app.css')]);
    expect(result.code).toContain('css-fixture');
    expect(result.code).not.toContain('widget.css: second');
  }, 60_000);

  it('refuses CSS in a worker', async () => {
    await expect(bundleIife({ input: fixture('worker-entry.ts'), platform: 'webos' })).rejects.toThrow(/css\.worker\.ts imports CSS .*workers have no DOM/);
  }, 60_000);

  it('builds one app.css: files in order, url() assets under assets/, RTL rules, gated', async () => {
    const built = await buildCss([fixture('lib/base.css'), fixture('lib/widget.css'), fixture('app.css')]);
    const order = ['base.css: first', 'widget.css: second', 'app.css: last'].map((marker) => built.css.indexOf(marker));
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > (order[i - 1] ?? 0)))).toBe(true);

    expect(built.assets).toEqual([
      { from: fixture('assets/face.woff2'), to: 'assets/face.woff2' },
      { from: fixture('lib/mark.svg'), to: 'assets/mark.svg' },
    ]);
    expect(built.css).toContain('src: url("assets/face.woff2") format(\'woff2\')');
    expect(built.css).toContain('url("assets/mark.svg")');

    // postcss-rtlcss (combined mode): a left-to-right rule and its mirror, keyed on dir.
    expect(built.css).toMatch(/\[dir="ltr"\] \.widget \{\s*margin-left: var\(--gap\);/);
    expect(built.css).toMatch(/\[dir="rtl"\] \.widget \{\s*margin-right: var\(--gap\);/);
    expect(built.css).toMatch(/\[dir="rtl"\] \.app \{\s*text-align: right;/);
    // A direction-free declaration stays in the plain rule.
    expect(built.css).toMatch(/\.app \{\s*color: #fff;/);
  });

  it('fails the build on CSS Chromium 53 lacks, and on assets it cannot ship', async () => {
    await expect(buildCss([cssFile('grid.css', '.a { display: grid; }')])).rejects.toThrow(CssGateError);
    await expect(buildCss([cssFile('grid.css', '.a { display: grid; }')])).rejects.toThrow(/grid\.css:1:6 {2}display: grid/);
    await expect(buildCss([cssFile('remote.css', ".a { background: url('https://cdn.example/x.png'); }")])).rejects.toThrow(/remote URLs are not allowed/);
    await expect(buildCss([cssFile('missing.css', ".a { background: url('nope.png'); }")])).rejects.toThrow(/does not exist/);
    // A data: URI stays inline.
    const inline = await buildCss([cssFile('inline.css', ".a { background: url('data:image/gif;base64,R0lGOD'); }")]);
    expect([inline.assets, inline.css.includes('data:image/gif')]).toEqual([[], true]);
  });

  it('refuses two different assets with the same name', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lablo-css-'));
    for (const sub of ['a', 'b']) {
      mkdirSync(path.join(dir, sub));
      writeFileSync(path.join(dir, sub, 'x.svg'), sub);
    }
    const file = path.join(dir, 'twice.css');
    writeFileSync(file, ".a { background: url('a/x.svg'); }\n.b { background: url('b/x.svg'); }\n");
    await expect(buildCss([file])).rejects.toThrow(/assets\/x\.svg is already/);
  });
});
