import { afterEach, describe, expect, it, vi } from 'vitest';
import { countStatuses, runCheck, runSpikes, spikeStatus } from './runner';
import type { Check, LabContext, Spike } from './types';

const context = {} as LabContext;

afterEach(() => {
  vi.useRealTimers();
});

describe('the lab runner', () => {
  it('times a check and passes its result through', async () => {
    let now = 100;
    const check: Check = {
      id: 'c',
      title: 'c',
      run: () => {
        now = 142;
        return Promise.resolve({ status: 'pass', value: { n: 1 }, note: 'ok' });
      },
    };
    expect(await runCheck(check, context, () => now)).toEqual({ result: { status: 'pass', value: { n: 1 }, note: 'ok' }, ms: 42 });
  });

  it('turns a throw or a rejection into a failure', async () => {
    const throws: Check = {
      id: 't',
      title: 't',
      run: () => {
        throw new TypeError('x is undefined');
      },
    };
    const rejects: Check = { id: 'r', title: 'r', run: () => Promise.reject(new RangeError('too big')) };
    expect((await runCheck(throws, context)).result).toEqual({ status: 'fail', note: 'threw TypeError: x is undefined' });
    expect((await runCheck(rejects, context)).result).toEqual({ status: 'fail', note: 'threw RangeError: too big' });
  });

  it('fails a check that runs past its timeout, and ignores its late result', async () => {
    vi.useFakeTimers();
    let finish: (() => void) | null = null;
    const slow: Check = {
      id: 's',
      title: 's',
      timeoutMs: 500,
      run: () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'pass' });
        }),
    };
    const outcome = runCheck(slow, context);
    await vi.advanceTimersByTimeAsync(500);
    (finish as (() => void) | null)?.();
    expect((await outcome).result).toEqual({ status: 'fail', note: 'no result within 500 ms' });
  });

  it('runs the spikes in order and reports each check as it starts and ends', async () => {
    const seen: string[] = [];
    const check = (id: string, status: 'pass' | 'fail' | 'info' | 'skip'): Check => ({
      id,
      title: id,
      run: () => {
        seen.push(`run ${id}`);
        return Promise.resolve({ status });
      },
    });
    const spikes: Spike[] = [
      { id: 'S0', title: '', question: '', checks: [check('a', 'info')] },
      { id: 'S1', title: '', question: '', checks: [check('b', 'pass'), check('c', 'fail')] },
    ];
    const outcomes = await runSpikes(
      spikes,
      context,
      (o) => seen.push(`end ${o.spike}/${o.check} ${o.result.status}`),
      (spike, id) => seen.push(`start ${spike}/${id}`),
    );
    expect(seen).toEqual(['start S0/a', 'run a', 'end S0/a info', 'start S1/b', 'run b', 'end S1/b pass', 'start S1/c', 'run c', 'end S1/c fail']);
    expect(countStatuses(outcomes)).toEqual({ pass: 1, fail: 1, info: 1, skip: 0 });
  });

  it('sums a spike up: a fail, else a pass, else info, else skip', () => {
    expect(spikeStatus([])).toBeNull();
    expect(spikeStatus(['pass', 'info', 'fail', 'skip'])).toBe('fail');
    expect(spikeStatus(['info', 'pass', 'skip'])).toBe('pass');
    expect(spikeStatus(['skip', 'info'])).toBe('info');
    expect(spikeStatus(['skip'])).toBe('skip');
  });
});
