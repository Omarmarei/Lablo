import { describe, expect, it } from 'vitest';
import type { BudgetedBundle } from './budgets';
import { BUDGETS, bundleBudgets, checkBudget, formatBudget } from './budgets';

/** A main bundle with `own` bytes of its own code and one inlined worker of `worker` bytes. */
function bundleOf(own: number, worker: number): BudgetedBundle {
  const literal = JSON.stringify('w'.repeat(worker - 2 > 0 ? worker - 2 : 0));
  return {
    code: 'm'.repeat(own) + literal,
    workers: [{ entry: '/src/x.worker.ts', code: 'w'.repeat(worker) }],
    inlinedBytes: literal.length,
  };
}

const check = (bundle: BudgetedBundle) => bundleBudgets('main.js (tizen)', bundle, (w) => `worker ${w.entry}`);

describe('bundle budgets', () => {
  it('sets 500 KB for the main bundle, 150 KB per lazy file and 150 KB per worker', () => {
    expect(BUDGETS).toEqual({ main: 512_000, lazy: 153_600, worker: 153_600 });
  });

  it('passes a bundle exactly at the limit and fails one byte over', () => {
    expect(checkBudget('main.js', 'main', 'x'.repeat(BUDGETS.main)).ok).toBe(true);
    expect(checkBudget('main.js', 'main', 'x'.repeat(BUDGETS.main + 1)).ok).toBe(false);
    expect(checkBudget('worker', 'worker', 'x'.repeat(BUDGETS.worker + 1)).ok).toBe(false);
  });

  it('counts UTF-8 bytes, not characters', () => {
    expect(checkBudget('main.js', 'main', 'لابلو').bytes).toBe(10);
  });

  it('leaves the inlined workers out of the main figure, and only them', () => {
    const big = checkBudget('main.js', 'main', 'x'.repeat(BUDGETS.main + 1000), 1000);
    expect([big.ok, big.bytes, big.inlined]).toEqual([true, BUDGETS.main, 1000]);
    // One byte more of the main thread's own code fails, however much is inlined.
    expect(checkBudget('main.js', 'main', 'x'.repeat(BUDGETS.main + 1001), 1000).ok).toBe(false);
    expect(() => checkBudget('main.js', 'main', 'x'.repeat(10), 11)).toThrow(RangeError);
    expect(() => checkBudget('main.js', 'main', 'x'.repeat(10), -1)).toThrow(RangeError);
  });

  it("checks a build's main code and each worker against their own budgets", () => {
    // 600 KB in main.js, but 140 KB of it is a worker: main's own 460 KB fits.
    const fits = check(bundleOf(460 * 1024, 140 * 1024));
    expect(fits.map((b) => [b.label, b.ok])).toEqual([
      ['main.js (tizen)', true],
      ['worker /src/x.worker.ts', true],
    ]);
    expect(fits[0]?.bytes).toBe(460 * 1024);

    // A seeded oversized main fails even with small workers.
    expect(check(bundleOf(BUDGETS.main + 1, 1024)).map((b) => b.ok)).toEqual([false, true]);
    // An oversized worker fails its own budget while main's own code fits.
    expect(check(bundleOf(100 * 1024, BUDGETS.worker + 1)).map((b) => b.ok)).toEqual([true, false]);
  });

  it("checks each lazy file's own code against the lazy budget, between main and the workers (RELAY step 35e)", () => {
    const literal = JSON.stringify('w'.repeat(1000));
    const lazy = (own: number) => ({ fileName: 'settings.js', code: 'l'.repeat(own) + literal, inlinedBytes: literal.length, modules: [] });
    const fits = check({ ...bundleOf(100, 50), lazy: [lazy(BUDGETS.lazy)] });
    expect(fits.map((b) => [b.label, b.kind, b.ok, b.bytes])).toEqual([
      ['main.js (tizen)', 'main', true, 100],
      ['settings.js of main.js (tizen)', 'lazy', true, BUDGETS.lazy],
      ['worker /src/x.worker.ts', 'worker', true, 50],
    ]);
    expect(fits[1]?.inlined).toBe(literal.length);
    const over = bundleBudgets('main.js (webos)', { ...bundleOf(100, 50), lazy: [lazy(BUDGETS.lazy + 1)] }, (w) => w.entry, (file) => `${file} (webos)`);
    expect(over.map((b) => [b.label, b.ok])).toEqual([
      ['main.js (webos)', true],
      ['settings.js (webos)', false],
      ['/src/x.worker.ts', true],
    ]);
  });

  it('formats a readable line, with the inlined workers when there are any', () => {
    const line = formatBudget(checkBudget('main.js (tizen)', 'main', 'x'.repeat(256_000)));
    expect(line).toBe('ok   main.js (tizen): 250.0 KB of 500.0 KB (50%)');
    const withWorkers = formatBudget(checkBudget('main.js (tizen)', 'main', 'x'.repeat(256_000 + 102_400), 102_400));
    expect(withWorkers).toBe('ok   main.js (tizen): 250.0 KB own code of 500.0 KB (50%), plus 100.0 KB of inlined workers');
    const over = formatBudget(checkBudget('main.js (tizen)', 'main', 'x'.repeat(BUDGETS.main + 2048), 1024));
    expect(over).toBe('OVER main.js (tizen): 501.0 KB own code of 500.0 KB (100%), plus 1.0 KB of inlined workers');
  });
});
