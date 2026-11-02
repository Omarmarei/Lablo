import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SyntaxGateError, bundleIife } from './bundle';
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
  }, 60_000);

  it("compiles core's parsers and search to gated Chromium 53 code that gives the same results as Node", async () => {
    const result = await bundleIife({ input: fixture('core-parsers.ts'), platform: 'webos', label: 'core-parsers' });
    expect(checkSyntax(result.code, 'main')).toBeNull();
    const bundled = (runWithoutModernApis(result.code) as { run(): string }).run();
    const { run } = await import('../test/fixtures/core-parsers');
    expect(bundled).toBe(run());
    // The run reached every parser (spot checks on the expected output).
    expect(bundled).toContain('x:tv:live:7 News zoma 1 hd zoma1 {"mode":"xc","days":3,"source":null}');
    expect(bundled).toContain(`index-${Date.UTC(2026, 10, 2, 10, 30) / 1000}-2700.m3u8`);
    expect(bundled).toContain(`News & more a <b>b</b> ${Date.UTC(2026, 10, 2, 12)}`);
    expect(bundled).toContain('/timeshift/u/p%40ss/45/2026-11-02:16-15/101.ts');
    expect(bundled).toContain('clock 345');
    expect(bundled).toContain('"username":"special+user","password":"a b"');
    expect(bundled).toContain('news=3:0/0.0/word*,2/2.0/start,3/2.1/substring');
    expect(bundled).toContain('new 24=1:2/2.0/word');
  }, 60_000);

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
});
