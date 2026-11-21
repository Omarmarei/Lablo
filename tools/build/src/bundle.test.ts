import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { BundleResult, StoreSwap } from './bundle';
import { STORE_SWAPS, SyntaxGateError, UNUSED_POLYFILLS, bundleIife, checkChunks, stringLiteral } from './bundle';
import { DEFINE_NAME } from './amd-loader';
import { scriptPage } from '../test/script-page';
import { tvDefines } from '../../../tv-defines.config';
import { checkSyntax } from './syntax-gate';

const FIXTURES = path.resolve(import.meta.dirname, '../test/fixtures');
const fixture = (name: string): string => path.join(FIXTURES, name);

/**
 * Runs an IIFE bundle in a fresh realm with the ES2017 APIs that Chromium 53 lacks
 * removed, so the result only works if the core-js polyfills made it into the bundle.
 */
function runWithoutModernApis(code: string): unknown {
  const context = vm.createContext({});
  vm.runInContext(
    'delete Object.entries; delete Object.values; delete String.prototype.padStart; delete String.prototype.padEnd;',
    context,
  );
  vm.runInContext(code, context);
  return vm.runInContext('globalThis.fixture', context);
}

describe('bundleIife (Rollup IIFE + Babel chrome 53 + core-js)', () => {
  it('turns modern source into gated Chromium 53 code with working polyfills and an inlined worker', async () => {
    const result = await bundleIife({ input: fixture('modern.ts'), platform: 'webos' });

    // Async functions, object rest/spread, ?. and ?? are gone (the gate already ran inside).
    expect(checkSyntax(result.code, 'main')).toBeNull();

    const exported = runWithoutModernApis(result.code) as { run(): Promise<string> };
    await expect(exported.run()).resolves.toBe('2,none,y=002');

    expect(result.workers).toHaveLength(1);
    const [worker] = result.workers;
    expect(worker?.entry).toBe(fixture('echo.worker.ts'));
    expect(worker?.code).toContain('echo-worker-marker');
    expect(checkSyntax(worker?.code ?? '', 'worker')).toBeNull();
    // The worker travels inside the main bundle and starts from a Blob URL.
    expect(result.code).toContain('echo-worker-marker');
    expect(result.code).toContain('createObjectURL');
    // Its string literal is in main.js exactly once, no placeholder is left, and its bytes are
    // what the main budget leaves out.
    const literal = stringLiteral(worker?.code ?? '');
    expect(result.code.split(literal)).toHaveLength(2);
    expect(result.code).not.toContain('__LABLO_WORKER_');
    expect(result.inlinedBytes).toBe(Buffer.byteLength(literal, 'utf8'));
    expect(result.inlinedBytes).toBeGreaterThan(0);
  }, 60_000);

  it('writes worker strings as ES2016 literals in the quote that needs fewer escapes', () => {
    const sep = String.fromCharCode(0x2028);
    const cases = [
      ['plain', '"plain"'],
      ['say "hi"', `'say "hi"'`],
      ["it's", `"it's"`],
      [`a "b" 'c' "d"`, `'a "b" \\'c\\' "d"'`],
      [`back\\slash "q" \\" end`, `'back\\\\slash "q" \\\\" end'`],
      [`line\nbreak${sep} "x"`, `'line\\nbreak\\u2028 "x"'`],
    ] as const;
    for (const [text, expected] of cases) {
      const literal = stringLiteral(text);
      expect(literal).toBe(expected);
      expect(checkSyntax(`var s = ${literal};`, 'literal')).toBeNull();
      expect(vm.runInNewContext(literal)).toBe(text);
    }
  });

  it('inlines nothing into a bundle without workers', async () => {
    const result = await bundleIife({ input: fixture('per-platform.ts'), platform: 'webos' });
    expect([result.workers.length, result.inlinedBytes]).toEqual([0, 0]);
  }, 60_000);

  it('writes non-ASCII text as UTF-8, escaping only what an ES2016 script or a UTF-8 file cannot hold (step 32d3)', async () => {
    const result = await bundleIife({ input: fixture('non-ascii.ts'), platform: 'webos' });
    const code = result.code;
    const char = (...units: number[]): string => String.fromCharCode(...units);
    const escape = (unit: number): string => `${char(92)}u${unit.toString(16)}`;
    // Arabic as it is: 2 bytes a letter in the file, where a `\uXXXX` escape took 6.
    expect(code).toContain('مرحبًا بعودتك');
    expect(code).toContain(`${char(0x2068)}x${char(0x2069)}`);
    expect(code).toContain(char(0xd83d, 0xde00));
    // Line separators end a line in an ES2016 string or regex literal, a BOM is invisible, and a
    // lone surrogate has no UTF-8 form (the file would hold U+FFFD): all stay escaped.
    for (const unit of [0x2028, 0x2029, 0xfeff, 0xd800, 0xdbff]) {
      expect(code).not.toContain(char(unit));
      expect(code).toContain(escape(unit));
    }
    const asWritten = Buffer.from(code, 'utf8').toString('utf8');
    expect(asWritten).toBe(code);
    expect(checkSyntax(asWritten, 'main')).toBeNull();
    const context = vm.createContext({});
    vm.runInContext(asWritten, context);
    expect(JSON.parse(vm.runInContext('JSON.stringify(globalThis.fixture)', context) as string)).toEqual({
      strings: ['مرحبًا بعودتك', `${char(0x2068)}x${char(0x2069)}`, `a${char(0x2028)}b${char(0x2029)}c`, `${char(0xfeff)}d`, `${char(0xd800)}e`, char(0xd83d, 0xde00)],
      letters: true,
      lineEnds: true,
      highSurrogate: true,
    });
  }, 60_000);

  it("compiles core's parsers and search to gated Chromium 53 code that gives the same results as Node", async () => {
    const result = await bundleIife({ input: fixture('core-parsers.ts'), platform: 'webos', label: 'core-parsers' });
    expect(checkSyntax(result.code, 'main')).toBeNull();
    const bundled = (runWithoutModernApis(result.code) as { run(): string }).run();
    const { run } = await import('../test/fixtures/core-parsers');
    expect(bundled).toBe(run());
    // The run reached every parser (spot checks on the expected output).
    expect(bundled).toContain('x:tv:live:7 News lablo 1 hd lablo1 {"mode":"xc","days":3,"source":null}');
    expect(bundled).toContain(`index-${Date.UTC(2026, 10, 2, 10, 30) / 1000}-2700.m3u8`);
    expect(bundled).toContain(`News & more a <b>b</b> ${Date.UTC(2026, 10, 2, 12)}`);
    expect(bundled).toContain('/timeshift/u/p%40ss/45/2026-11-02:16-15/101.ts');
    expect(bundled).toContain('clock 345');
    expect(bundled).toContain('"username":"special+user","password":"a b"');
    expect(bundled).toContain('news=3:0/0.0/word*,2/2.0/start,3/2.1/substring');
    expect(bundled).toContain('new 24=1:2/2.0/word');
  }, 60_000);

  it('injects no polyfills for the ES2019+ APIs nothing can call, and still the ones that are needed', async () => {
    const result = await bundleIife({ input: fixture('collections.ts'), platform: 'webos' });
    expect((runWithoutModernApis(result.code) as { run(): string }).run()).toBe('n3,n1,n2|3,2|007|7');
    // Method names the excluded core-js modules define (terser keeps property names), and the
    // error text of the JSON.parse source-text polyfill (`esnext.json.parse` → `es.json.parse`).
    const excluded = ['toBase64', 'setFromHex', 'getOrInsert', 'symmetricDifference', 'isDisjointFrom', 'toSorted', 'transferToFixedLength'];
    for (const name of [...excluded, 'after the parsed data at']) {
      expect(result.code).not.toContain(name);
    }
    expect(result.code).toContain('padStart');
  }, 60_000);

  it('excludes only APIs that TV code cannot call: every bundled package compiles against lib ES2017', () => {
    expect(UNUSED_POLYFILLS.length).toBeGreaterThan(0);
    const root = path.resolve(import.meta.dirname, '../../..');
    const configs = [...readdirSync(path.join(root, 'packages')).map((p) => path.join('packages', p)), path.join('apps', 'tv')];
    for (const dir of configs) {
      const config = JSON.parse(readFileSync(path.join(root, dir, 'tsconfig.json'), 'utf8')) as { compilerOptions?: { lib?: string[] } };
      const libs = (config.compilerOptions?.lib ?? ['ES2017']).filter((l) => !l.startsWith('DOM'));
      expect([dir, libs]).toEqual([dir, ['ES2017']]);
    }
  });

  it('leaves the polyfills out only when asked to (the old-engine self-test build)', async () => {
    const result = await bundleIife({ input: fixture('modern.ts'), platform: 'webos', polyfills: false });
    // Still Chromium 53 syntax, but nothing patches the missing APIs.
    expect(checkSyntax(result.code, 'main')).toBeNull();
    expect(result.code).not.toContain('core-js');
    const exported = runWithoutModernApis(result.code) as { run(): Promise<string> };
    await expect(exported.run()).rejects.toThrow(/is not a function/);
  }, 60_000);

  it('fails the build on ES2018 syntax that Babel cannot transpile (regex lookbehind)', async () => {
    const build = bundleIife({ input: fixture('lookbehind.ts'), platform: 'tizen', label: 'main.js (tizen)' });
    await expect(build).rejects.toThrow(SyntaxGateError);
    await expect(build).rejects.toThrow(/ES2016 syntax gate failed for main\.js \(tizen\).*Invalid regular expression/);
  }, 60_000);

  it.each([
    ['tizen', 'TIZEN_ONLY_MARKER', 'WEBOS_ONLY_MARKER'],
    ['webos', 'WEBOS_ONLY_MARKER', 'TIZEN_ONLY_MARKER'],
  ] as const)('the %s build keeps only its own platform code', async (platform, kept, dropped) => {
    const { code } = await bundleIife({ input: fixture('per-platform.ts'), platform });
    expect(code).toContain(kept);
    expect(code).not.toContain(dropped);
  }, 60_000);
  it("replaces the app's build constants: a TV build's by default, or the ones given (step 30b2), and the platform's app id (step 32b)", async () => {
    const own = tvDefines('package');
    const { code } = await bundleIife({ input: fixture('app-defines.ts'), platform: 'webos' });
    expect(code).not.toMatch(/__(API_BASE|APP_VERSION|CONFIG_KEYS|APP_ID)__/);
    expect(runWithoutModernApis(code)).toEqual({ base: own.apiBase, version: own.version, keys: own.configKeys, appId: 'com.lablo.iptv' });
    const given = { apiBase: 'http://api.test', version: '9.8.7', configKeys: ['k1', 'k2'] };
    const other = await bundleIife({ input: fixture('app-defines.ts'), platform: 'tizen', defines: given });
    expect(runWithoutModernApis(other.code)).toEqual({ base: 'http://api.test', version: '9.8.7', keys: ['k1', 'k2'], appId: 'LabloIPTV1.Lablo' });
  }, 60_000);
});

describe('the store swaps (RELAY step 35b)', () => {
  const ROOT = path.resolve(import.meta.dirname, '../../..');
  const SWAPS: readonly StoreSwap[] = [{ module: 'tools/build/test/fixtures/swap/feature.ts', stand: 'tools/build/test/fixtures/swap/feature.store.ts' }];
  const run = (code: string): unknown => {
    const context = vm.createContext({});
    vm.runInContext(code, context);
    return vm.runInContext('globalThis.fixture', context);
  };

  it("takes each stand-in in a store build, with none of the real module's CSS, and leaves a namesake alone", async () => {
    const store = await bundleIife({ input: fixture('swap/entry.ts'), platform: 'webos', swaps: SWAPS });
    expect(run(store.code)).toBe('the stand-in + another module of that name');
    expect(store.code).not.toContain('the real feature');
    expect(store.css).toEqual([]);
  }, 60_000);

  it('keeps the real module in the test copy (devScreens), its CSS too', async () => {
    const dev = await bundleIife({ input: fixture('swap/entry.ts'), platform: 'webos', swaps: SWAPS, devScreens: true });
    expect(run(dev.code)).toBe('the real feature + another module of that name');
    expect(dev.code).not.toContain('the stand-in');
    expect(dev.css).toEqual([fixture('swap/feature.css')]);
  }, 60_000);

  it("swaps the app's developer screens, each beside a stand-in that exists", () => {
    expect(STORE_SWAPS).toEqual([{ module: 'apps/tv/src/dev/dev-screens.tsx', stand: 'apps/tv/src/dev/dev-screens.store.ts' }]);
    for (const swap of STORE_SWAPS) {
      expect(existsSync(path.join(ROOT, swap.module))).toBe(true);
      expect(existsSync(path.join(ROOT, swap.stand))).toBe(true);
      expect(path.dirname(swap.stand)).toBe(path.dirname(swap.module));
    }
  });
});

describe('the worker cache (RELAY step 35b)', () => {
  it('builds each worker once per platform and polyfills, and inlines the cached build', async () => {
    const cache = new Map<string, BundleResult>();
    const first = await bundleIife({ input: fixture('modern.ts'), platform: 'webos', workerCache: cache });
    const key = `${fixture('echo.worker.ts')}|webos|polyfilled`;
    expect([...cache.keys()]).toEqual([key]);
    expect(cache.get(key)!.code).toBe(first.workers[0]!.code);
    // The next build of the same platform takes the cached worker: a marker in its place shows up.
    cache.set(key, { ...cache.get(key)!, code: 'self.fromCache = 1;' });
    const second = await bundleIife({ input: fixture('modern.ts'), platform: 'webos', workerCache: cache });
    expect(second.workers.map((w) => w.code)).toEqual(['self.fromCache = 1;']);
    expect(second.code).toContain(stringLiteral('self.fromCache = 1;'));
    expect(second.inlinedBytes).toBe(Buffer.byteLength(stringLiteral('self.fromCache = 1;'), 'utf8'));
    // Another platform, or a build without polyfills, builds its own.
    const tizen = await bundleIife({ input: fixture('modern.ts'), platform: 'tizen', workerCache: cache });
    expect(tizen.workers[0]!.code).toContain('echo-worker-marker');
    const bare = await bundleIife({ input: fixture('modern.ts'), platform: 'webos', polyfills: false, workerCache: cache });
    expect(bare.workers[0]!.code).toContain('echo-worker-marker');
    expect([...cache.keys()].sort()).toEqual([key, `${fixture('echo.worker.ts')}|tizen|polyfilled`, `${fixture('echo.worker.ts')}|webos|bare`].sort());
  }, 120_000);
});

describe('the split build (RELAY step 35e)', () => {
  const WITHOUT_ES2017 = 'delete Object.entries; delete Object.values; delete String.prototype.padStart; delete String.prototype.padEnd;';

  it('writes main.js with the loader at its top and one lazy file, each gated, each with its own polyfills and workers', async () => {
    const result = await bundleIife({ input: fixture('split/entry.ts'), platform: 'webos', split: true, label: 'main.js (webos)' });
    expect(result.lazy.map((file) => file.fileName)).toEqual(['lazy-part.js']);
    const [part] = result.lazy;
    expect(checkSyntax(result.code, 'main')).toBeNull();
    expect(checkSyntax(part!.code, 'lazy')).toBeNull();
    // The loader, then main's own define; the lazy file defines itself on main.
    expect(result.code.indexOf(DEFINE_NAME)).toBeLessThan(result.code.indexOf(`${DEFINE_NAME}("main"`));
    expect(part!.code.startsWith(`${DEFINE_NAME}("lazy-part",["exports","./main"]`)).toBe(true);
    // What only the lazy part needs is in its file: its code, its worker, its polyfill.
    expect(result.code).not.toContain('lazy-part-marker');
    expect(part!.code).toContain('lazy-part-marker');
    expect(result.code).not.toContain('echo-worker-marker');
    expect(part!.inlinedBytes).toBe(Buffer.byteLength(stringLiteral(result.workers[0]!.code), 'utf8'));
    expect(result.inlinedBytes).toBe(0);
    expect(result.code).not.toContain('padStart');
    expect(part!.code).toContain('padStart');
    expect(result.modules.map((id) => path.basename(id))).toEqual(expect.arrayContaining(['entry.ts', 'shared.ts']));
    expect(result.modules.some((id) => id.endsWith('lazy-part.ts'))).toBe(false);
    expect(part!.modules.map((id) => path.basename(id))).toContain('lazy-part.ts');
    expect(part!.modules.some((id) => id.endsWith('shared.ts'))).toBe(false);

    // On a page without the ES2017 APIs: the lazy part loads once, by one tag, and shares main's modules.
    const page = scriptPage(new Map([['lazy-part.js', part!.code]]), WITHOUT_ES2017);
    page.run(result.code);
    const fixtureApi = page.fixture<{ open(from: string): Promise<string>; count(): number }>();
    expect(fixtureApi.count()).toBe(1);
    expect(page.requested).toEqual([]);
    await expect(fixtureApi.open('entry')).resolves.toBe('[entry] 002 1b lazy-part-marker');
    await expect(fixtureApi.open('again')).resolves.toBe('[again] 003 1b lazy-part-marker');
    expect(page.requested).toEqual(['lazy-part.js']);
    expect(fixtureApi.count()).toBe(3);
  }, 60_000);

  it('loads the lazy file again after a failed load', async () => {
    const result = await bundleIife({ input: fixture('split/entry.ts'), platform: 'tizen', split: true });
    const files = new Map<string, string>();
    const page = scriptPage(files);
    page.run(result.code);
    const fixtureApi = page.fixture<{ open(from: string): Promise<string> }>();
    await expect(fixtureApi.open('x')).rejects.toThrow('lazy-part.js did not load');
    files.set('lazy-part.js', result.lazy[0]!.code);
    await expect(fixtureApi.open('y')).resolves.toBe('[y] 002 1b lazy-part-marker');
    expect(page.requested).toEqual(['lazy-part.js', 'lazy-part.js']);
  }, 60_000);

  it('gates each lazy file, labelled as asked', async () => {
    const labelled = bundleIife({ input: fixture('split/bad-lazy.ts'), platform: 'webos', split: true, label: 'main.js (webos)', lazyLabel: (file) => `${file} (webos)` });
    await expect(labelled).rejects.toThrow(SyntaxGateError);
    await expect(labelled).rejects.toThrow(/ES2016 syntax gate failed for lookbehind\.js \(webos\).*Invalid regular expression/);
    const plain = bundleIife({ input: fixture('split/bad-lazy.ts'), platform: 'webos', split: true, label: 'main.js (webos)' });
    await expect(plain).rejects.toThrow(/gate failed for lookbehind\.js of main\.js \(webos\)/);
  }, 60_000);

  it('refuses a shape its loader cannot load: a file shared by two lazy files', async () => {
    const build = bundleIife({ input: fixture('split/two-lazy.ts'), platform: 'webos', split: true, label: 'main.js (webos)' });
    await expect(build).rejects.toThrow(
      [
        "main.js (webos): the split build has a shape its loader can't load:",
        '  lazy-one.js imports lazy-shared.js: a lazy file may import only main.js',
        '  lazy-two.js imports lazy-shared.js: a lazy file may import only main.js',
        '  lazy-shared.js is shared by lazy files: the loader loads one file per import()',
      ].join('\n'),
    );
  }, 60_000);

  it('checks the chunk graph: one entry, lazy files that need only it', () => {
    const chunk = (fileName: string, more: Partial<{ isEntry: boolean; isDynamicEntry: boolean; imports: string[]; dynamicImports: string[] }> = {}) => ({
      fileName,
      isEntry: false,
      isDynamicEntry: true,
      imports: [] as string[],
      dynamicImports: [] as string[],
      ...more,
    });
    const main = chunk('main.js', { isEntry: true, isDynamicEntry: false, dynamicImports: ['settings.js'] });
    expect(checkChunks([main, chunk('settings.js', { imports: ['main.js'] })])).toEqual([]);
    expect(checkChunks([main])).toEqual([]);
    expect(checkChunks([chunk('settings.js')])).toEqual(['a split build has one entry, not 0']);
    expect(checkChunks([main, { ...main, fileName: 'other.js' }])).toEqual(['a split build has one entry, not 2']);
    expect(checkChunks([{ ...main, imports: ['vendor.js'] }, chunk('vendor.js', { isDynamicEntry: false })])).toEqual([
      'main.js imports vendor.js: the loader loads nothing at the start',
      'vendor.js is shared by lazy files: the loader loads one file per import()',
    ]);
    expect(checkChunks([main, chunk('settings.js', { imports: ['main.js', 'shared.js'] })])).toEqual(['settings.js imports shared.js: a lazy file may import only main.js']);
    expect(checkChunks([main, chunk('settings.js', { dynamicImports: ['help.js'] })])).toEqual(['settings.js loads help.js: only main.js may load a lazy file']);
  });

  it('keeps an unsplit build one IIFE with its import() inlined', async () => {
    const result = await bundleIife({ input: fixture('split/entry.ts'), platform: 'webos' });
    expect(result.lazy).toEqual([]);
    expect(result.code).toContain('lazy-part-marker');
    expect(result.code).not.toContain(DEFINE_NAME);
    const context = vm.createContext({});
    vm.runInContext(result.code, context);
    const fixtureApi = vm.runInContext('globalThis.fixture', context) as { open(from: string): Promise<string> };
    await expect(fixtureApi.open('one')).resolves.toBe('[one] 002 1b lazy-part-marker');
  }, 60_000);
});
