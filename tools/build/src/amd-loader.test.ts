import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { scriptPage } from '../test/script-page';
import { DEFINE_NAME, amdLoaderScript } from './amd-loader';

type Require = (ids: string[], ok: (exports: Record<string, unknown>) => void, fail: (error: Error) => void) => void;

/** main.js as Rollup writes it: the loader, then the entry, which keeps `require` for the test. */
const MAIN = `${amdLoaderScript('main')}
${DEFINE_NAME}('main', ['require', 'exports'], function (require, exports) {
  'use strict';
  exports.shared = function (text) { return '[' + text + ']'; };
  exports.starts = (exports.starts || 0) + 1;
  window.mainRequire = require;
  window.mainExports = exports;
});
`;

/** A lazy file that uses main's export, counting its factory's runs. */
const SETTINGS = `${DEFINE_NAME}('settings', ['exports', './main'], function (exports, main) {
  'use strict';
  window.settingsRuns = (window.settingsRuns || 0) + 1;
  exports.hello = main.shared('settings');
});
`;

/** Requires `id` through main's `require`, as Rollup's `import()` does. */
function load(page: ReturnType<typeof scriptPage>, id: string): Promise<Record<string, unknown>> {
  const require = page.context.mainRequire as Require;
  return new Promise((resolve, reject) => require([id], resolve, reject));
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe('the AMD loader (RELAY step 35e)', () => {
  it('is plain ES5, and puts one name on the page', () => {
    expect(() => parse(amdLoaderScript('main'), { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
    const page = scriptPage(new Map());
    const before = Object.keys(page.context);
    page.run(amdLoaderScript('main'));
    expect(Object.keys(page.context).filter((key) => !before.includes(key))).toEqual([DEFINE_NAME]);
    expect(page.context.define).toBeUndefined();
    expect(page.context.require).toBeUndefined();
  });

  it('runs the entry as soon as it is defined, once, and loads nothing then', () => {
    const page = scriptPage(new Map());
    page.run(MAIN);
    expect((page.context.mainExports as { starts: number }).starts).toBe(1);
    expect(page.requested).toEqual([]);
  });

  it("runs a module other than the entry only when it is required", () => {
    const page = scriptPage(new Map());
    page.run(`${amdLoaderScript('app')}${DEFINE_NAME}('other', ['exports'], function (exports) { window.otherRan = true; });`);
    expect(page.context.otherRan).toBeUndefined();
    page.run(`${DEFINE_NAME}('app', ['require', 'exports'], function (require) { window.mainRequire = require; });`);
    expect(page.context.otherRan).toBeUndefined();
  });

  it('loads a lazy file by one script tag next to the page, with main as its dependency, and takes the tag away', async () => {
    const page = scriptPage(new Map([['settings.js', SETTINGS]]));
    page.run(MAIN);
    const first = load(page, './settings');
    // A second request while it loads waits for the same tag.
    const second = load(page, 'settings');
    expect(page.requested).toEqual(['settings.js']);
    expect(page.attached()).toBe(1);
    const [a, b] = await Promise.all([first, second]);
    expect(a.hello).toBe('[settings]');
    expect(b).toBe(a);
    expect(page.context.settingsRuns).toBe(1);
    expect(page.attached()).toBe(0);
    // Later requests are answered at once (the callback runs before require returns), from the same module.
    let later: unknown = null;
    (page.context.mainRequire as Require)(['./settings'], (exports) => (later = exports), () => undefined);
    expect(later).toBe(a);
    expect(page.requested).toEqual(['settings.js']);
    expect(page.context.settingsRuns).toBe(1);
    // main ran once: the lazy file took its exports, not a second copy.
    expect((page.context.mainExports as { starts: number }).starts).toBe(1);
  });

  it('rejects every waiting request when the file fails to load, then loads it again on the next', async () => {
    const files = new Map<string, string>();
    const page = scriptPage(files);
    page.run(MAIN);
    const first = load(page, './settings');
    const second = load(page, './settings');
    await expect(first).rejects.toThrow(/^settings\.js did not load$/);
    await expect(second).rejects.toThrow(/^settings\.js did not load$/);
    expect(page.attached()).toBe(0);
    files.set('settings.js', SETTINGS);
    await expect(load(page, './settings')).resolves.toMatchObject({ hello: '[settings]' });
    expect(page.requested).toEqual(['settings.js', 'settings.js']);
    expect(page.attached()).toBe(0);
  });

  it('rejects a file that loads but defines another id', async () => {
    const page = scriptPage(new Map([['settings.js', `${DEFINE_NAME}('other', ['exports'], function () {});`]]));
    page.run(MAIN);
    await expect(load(page, './settings')).rejects.toThrow(/^settings\.js did not load$/);
  });

  it("rejects with a factory's error, and runs the factory again on the next request", async () => {
    const throwing = `${DEFINE_NAME}('settings', ['exports', './main'], function (exports, main) {
      window.tries = (window.tries || 0) + 1;
      if (window.tries === 1) throw new Error('first run fails');
      exports.hello = main.shared('again');
    });`;
    const page = scriptPage(new Map([['settings.js', throwing]]));
    page.run(MAIN);
    await expect(load(page, './settings')).rejects.toThrow('first run fails');
    // The file is defined: no second tag, its factory again.
    await expect(load(page, './settings')).resolves.toMatchObject({ hello: '[again]' });
    expect(page.requested).toEqual(['settings.js']);
    expect(page.context.tries).toBe(2);
  });

  it('throws an entry that fails at once (the boot error shows it)', () => {
    const page = scriptPage(new Map());
    expect(() => page.run(`${amdLoaderScript('main')}${DEFINE_NAME}('main', ['exports'], function () { throw new Error('boot failed'); });`)).toThrow('boot failed');
  });

  it('waits for nothing it was not asked for', async () => {
    const page = scriptPage(new Map([['settings.js', SETTINGS]]));
    page.run(MAIN);
    await settle();
    expect(page.requested).toEqual([]);
    expect(page.context.settingsRuns).toBeUndefined();
  });
});
