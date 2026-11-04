import { describe, expect, it } from 'vitest';
import type { Post } from './reporter';
import { RETRY_MAX_MS, createReporter, retryDelay } from './reporter';

/** A collector the test answers by hand, request by request. */
function manualPost() {
  const calls: Array<{ url: string; body: string; ok: () => void; fail: (message: string) => void }> = [];
  const post: Post = (url, body) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ url, body, ok: resolve, fail: (message) => reject(new Error(message)) });
    });
  return { post, calls };
}

/** A schedule the test fires by hand, recording each delay. */
function manualSchedule() {
  const waits: Array<{ ms: number; run: () => void }> = [];
  return { schedule: (run: () => void, ms: number) => waits.push({ ms, run }), waits };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const lines = (body: string): Array<Record<string, unknown>> => body.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
const at = new Date('2026-11-04T02:30:00.000Z');

describe('the lab reporter', () => {
  it('numbers the records, stamps them and posts them as NDJSON to the session', async () => {
    const { post, calls } = manualPost();
    const reporter = createReporter({ server: 'http://192.168.1.3:8080', session: 'webos-x-1', post, now: () => at });
    const first = reporter.add({ type: 'start', value: { version: '0.1.0' } });
    expect(first).toEqual({ type: 'start', value: { version: '0.1.0' }, session: 'webos-x-1', seq: 1, at: '2026-11-04T02:30:00.000Z' });
    expect(reporter.url).toBe('http://192.168.1.3:8080/__lab/logs/webos-x-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(reporter.url);
    expect(lines(calls[0]?.body ?? '')).toEqual([first]);
    expect(calls[0]?.body.endsWith('\n')).toBe(true);
    expect(reporter.state.value).toMatchObject({ sent: 0, pending: 1 });
    calls[0]?.ok();
    await tick();
    expect(reporter.state.value).toEqual({ sent: 1, pending: 0, failures: 0, lastError: null });
  });

  it('sends one request at a time, in order, in batches of at most 50', async () => {
    const { post, calls } = manualPost();
    const reporter = createReporter({ server: 'http://h:1', session: 's', post });
    for (let i = 0; i < 120; i += 1) reporter.add({ type: 'check', spike: 'S1', check: `c${i}`, status: 'pass' });
    // The first record went alone (nothing else was waiting); the rest wait for it.
    expect(calls).toHaveLength(1);
    calls[0]?.ok();
    await tick();
    expect(lines(calls[1]?.body ?? '').map((r) => r.seq)).toEqual(Array.from({ length: 50 }, (_, i) => i + 2));
    calls[1]?.ok();
    await tick();
    calls[2]?.ok();
    await tick();
    expect(lines(calls[3]?.body ?? '').map((r) => r.seq)).toEqual(Array.from({ length: 19 }, (_, i) => i + 102));
    calls[3]?.ok();
    await tick();
    expect(calls).toHaveLength(4);
    expect(reporter.state.value).toEqual({ sent: 120, pending: 0, failures: 0, lastError: null });
    expect(reporter.records.map((r) => r.seq)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
  });

  it('retries a failed request after 1, 2, 4 s… and drops nothing', async () => {
    const { post, calls } = manualPost();
    const { schedule, waits } = manualSchedule();
    const reporter = createReporter({ server: 'http://h:1', session: 's', post, schedule });
    reporter.add({ type: 'start' });
    calls[0]?.fail('no answer');
    await tick();
    expect(reporter.state.value).toEqual({ sent: 0, pending: 1, failures: 1, lastError: 'no answer' });
    // Records added while waiting go with the retry.
    reporter.add({ type: 'check', spike: 'S0', check: 'device', status: 'info' });
    expect(calls).toHaveLength(1);
    waits[0]?.run();
    expect(lines(calls[1]?.body ?? '').map((r) => r.seq)).toEqual([1, 2]);
    calls[1]?.fail('still down');
    await tick();
    waits[1]?.run();
    calls[2]?.ok();
    await tick();
    expect(waits.map((w) => w.ms)).toEqual([1000, 2000]);
    expect(reporter.state.value).toEqual({ sent: 2, pending: 0, failures: 0, lastError: null });
  });

  it('waits at most 30 s between retries', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, RETRY_MAX_MS]);
  });
});
