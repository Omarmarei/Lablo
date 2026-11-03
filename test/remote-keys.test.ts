import { describe, expect, it } from 'vitest';
import { INTENT_KEYS, budgetFailures, percentile, summarize } from '../e2e/remote-keys';
import { INTENTS } from '../packages/platform-api/src/index';
import { browserKeyToIntent, browserTextKey } from '../packages/platform-browser/src/index';

describe("the e2e RemoteDriver's keys (e2e/remote-keys.ts)", () => {
  it('presses, for every Intent, a key the browser adapter maps back to that Intent', () => {
    expect(Object.keys(INTENT_KEYS).sort()).toEqual([...INTENTS].sort());
    for (const intent of INTENTS) expect(browserKeyToIntent({ key: INTENT_KEYS[intent], keyCode: 0 }), intent).toBe(intent);
  });

  it('goes Back with Escape, which also ends a text edit instead of deleting in it', () => {
    expect(INTENT_KEYS.BACK).toBe('Escape');
    expect(browserTextKey({ key: INTENT_KEYS.BACK, keyCode: 27 })).toBe('close');
  });
});

describe('the key-press budget', () => {
  const budget = { pressMs: 150, longTaskMs: 100 };

  it('passes presses and long tasks within the budget, the limits included', () => {
    expect(budgetFailures([{ label: 'DOWN', ms: 12 }, { label: 'CH_DOWN', ms: 150 }], [51, 100], budget)).toEqual([]);
  });

  it('names every press over the budget', () => {
    const presses = [
      { label: 'DOWN to live/channels/1', ms: 40 },
      { label: 'DOWN to live/channels/2', ms: 150.4 },
      { label: 'OK to live/channels/0', ms: 310.6 },
    ];
    expect(budgetFailures(presses, [], budget)).toEqual([
      'DOWN to live/channels/2: 150 ms, over the 150 ms budget',
      'OK to live/channels/0: 311 ms, over the 150 ms budget',
    ]);
  });

  it('counts the long tasks over their limit, and fails when nothing was timed or a time is missing', () => {
    expect(budgetFailures([{ label: 'DOWN', ms: 10 }], [60, 100.2, 240], budget)).toEqual(['2 long tasks over 100 ms: 100, 240 ms']);
    expect(budgetFailures([{ label: 'DOWN', ms: 10 }], [101], budget)).toEqual(['1 long task over 100 ms: 101 ms']);
    expect(budgetFailures([], [], budget)).toEqual(['no key press was timed']);
    expect(budgetFailures([{ label: 'DOWN', ms: Number.NaN }], [Number.NaN], budget)).toEqual([
      'DOWN: NaN ms, over the 150 ms budget',
      '1 long task over 100 ms: NaN ms',
    ]);
  });

  it('summarizes presses by nearest-rank percentiles', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([30, 10, 20], 50)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100], 95)).toBe(19);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([3, 1, 2], 100)).toBe(3);
    expect(summarize([10, 40, 20, 30].map((ms) => ({ label: 'x', ms })))).toEqual({ count: 4, median: 20, p95: 40, max: 40 });
    expect(summarize([])).toEqual({ count: 0, median: 0, p95: 0, max: 0 });
  });
});
