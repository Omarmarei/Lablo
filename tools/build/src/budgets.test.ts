import { describe, expect, it } from 'vitest';
import { BUDGETS, checkBudget, formatBudget } from './budgets';

describe('bundle budgets', () => {
  it('sets 500 KB for the main bundle and 150 KB per worker', () => {
    expect(BUDGETS).toEqual({ main: 512_000, worker: 153_600 });
  });

  it('passes a bundle exactly at the limit and fails one byte over', () => {
    expect(checkBudget('main.js', 'main', 'x'.repeat(BUDGETS.main)).ok).toBe(true);
    expect(checkBudget('main.js', 'main', 'x'.repeat(BUDGETS.main + 1)).ok).toBe(false);
    expect(checkBudget('worker', 'worker', 'x'.repeat(BUDGETS.worker + 1)).ok).toBe(false);
  });

  it('counts UTF-8 bytes, not characters', () => {
    expect(checkBudget('main.js', 'main', 'زوما').bytes).toBe(8);
  });

  it('formats a readable line', () => {
    const line = formatBudget(checkBudget('main.js (tizen)', 'main', 'x'.repeat(256_000)));
    expect(line).toBe('ok   main.js (tizen): 250.0 KB of 500.0 KB (50%)');
  });
});
