import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { bigCatalog } from './big-catalog';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';
import type { PressBudget, PressTiming } from './remote-keys';
import { budgetFailures, summarize } from './remote-keys';
import { THROTTLE, busyMs, throttle } from './throttle';

/**
 * The search (RELAY step 28a, PLAN Phase 7: "search ≤ 300 ms on a 2018 TV") over 200,000 items at
 * 4x CPU throttle, as the other throttled runs time the live list, the grid guide and the poster
 * grid: 30,000 channels, 150,000 movies and 20,000 series from the mock's panel. Text is typed in
 * the search field a character at a time, Latin, then (the field emptied) Arabic, then taken back
 * a character at a time; each change is timed from its `input` event to the end of the first frame that draws its
 * answer with the rows in view read (the screen's `data-answered` is the text, `data-pending` 0,
 * and the first row holds its item), a task after that frame's paint.
 *
 * The search itself runs in the query worker, which the CDP throttle doesn't slow (measured:
 * `workerBusyMs`, about 1x). So the page also times each change's calls to the worker, `search` and
 * `items`, from their message to their answer (`recordRpc`), and the budget holds for the change
 * as if those had run `THROTTLE` times slower too: its time plus `(THROTTLE - 1)` times theirs.
 */
const CHANNELS = 30_000;
const CATEGORIES = 30;
const MOVIES = 150_000;
const MOVIE_CATEGORIES = 150;
const SERIES = 20_000;
const SERIES_CATEGORIES = 20;
const ITEMS = CHANNELS + MOVIES + SERIES;
/** Each change of the text within 300 ms (PLAN Phase 7), and no main-thread task longer than the live screen's 200 ms meanwhile. */
const BUDGET: PressBudget = { pressMs: 300, longTaskMs: 200 };
const REPORT = path.resolve(import.meta.dirname, '../artifacts/perf');
/** What is typed: Latin words a provider's names hold, then Arabic ones. */
const LATIN = 'lablo test film 4321';
const ARABIC = 'فيلم الاختبار 77';

const catalog = bigCatalog({
  channels: CHANNELS,
  categories: CATEGORIES,
  movies: { count: MOVIES, categories: MOVIE_CATEGORIES },
  series: { count: SERIES, categories: SERIES_CATEGORIES },
});
let app: MockServer;
let host: string;

test.beforeAll(async () => {
  app = await mock({ catalog, now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
  mkdirSync(REPORT, { recursive: true });
});
test.afterAll(async () => {
  await app.close();
});

interface ChangeResult {
  readonly ms: number | null;
  /** The query worker's part: its `search` and `items` calls since the change, message to answer. */
  readonly worker: number;
  readonly answered: string | null;
}

interface RpcCall {
  readonly m: string;
  readonly start: number;
  end: number | null;
}

interface ChangeWindow {
  __labloChange: Promise<ChangeResult>;
  __labloRpc: RpcCall[];
}

/**
 * Before the app starts: every worker's `search` and `items` calls (the RPC's `call` message, then
 * its `ok` or `err` answer) are timed on the page's clock, in `__labloRpc`.
 */
function recordRpc(): void {
  const w = window as unknown as ChangeWindow & { Worker: typeof Worker };
  const calls: RpcCall[] = [];
  w.__labloRpc = calls;
  const Base = w.Worker;
  const Timed = function (this: unknown, url: string | URL, options?: WorkerOptions): Worker {
    const worker = new Base(url, options);
    const open = new Map<number, RpcCall>();
    const post = worker.postMessage.bind(worker) as (message: unknown, transfer?: Transferable[]) => void;
    worker.postMessage = ((message: { zr?: number; t?: string; id?: number; m?: string }, transfer?: Transferable[]) => {
      if (message !== null && typeof message === 'object' && message.zr === 1 && message.t === 'call' && (message.m === 'search' || message.m === 'items')) {
        const call: RpcCall = { m: message.m, start: performance.now(), end: null };
        open.set(message.id!, call);
        calls.push(call);
      }
      if (transfer === undefined) post(message);
      else post(message, transfer);
    }) as Worker['postMessage'];
    worker.addEventListener('message', (event: MessageEvent<{ zr?: number; t?: string; id?: number }>) => {
      const data = event.data;
      if (data === null || typeof data !== 'object' || data.zr !== 1 || (data.t !== 'ok' && data.t !== 'err')) return;
      const call = open.get(data.id!);
      if (call === undefined) return;
      open.delete(data.id!);
      call.end = performance.now();
    });
    return worker;
  } as unknown as typeof Worker;
  Timed.prototype = Base.prototype;
  w.Worker = Timed;
}

/**
 * In the page, before a key: the next `input` event's time, then the end of the first frame
 * that draws `expected`'s answer with its first row read (or no row, for no match).
 */
function armChange({ expected, timeoutMs }: { expected: string; timeoutMs: number }): void {
  const w = window as unknown as ChangeWindow;
  const root = document.querySelector('[data-testid=search-screen]')!;
  const input = document.getElementById('search-field')!;
  w.__labloChange = new Promise<ChangeResult>((resolve) => {
    let start: number | null = null;
    let done = false;
    const finish = (ms: number | null): void => {
      if (done) return;
      done = true;
      observer.disconnect();
      input.removeEventListener('input', onInput, true);
      let worker = 0;
      for (const call of w.__labloRpc) if (start !== null && call.start >= start && call.end !== null) worker += call.end - call.start;
      resolve({ ms, worker, answered: root.getAttribute('data-answered') });
    };
    const answered = (): boolean => {
      if (root.getAttribute('data-answered') !== expected || root.getAttribute('data-pending') !== '0') return false;
      if (root.getAttribute('data-count') === '0') return true;
      const first = root.querySelector('[data-testid=result-0]');
      return first !== null && (first.getAttribute('data-key') ?? '') !== '';
    };
    const check = (): void => {
      if (start === null || done || !answered()) return;
      const from = start;
      // The frame that draws it, then a task after its paint.
      requestAnimationFrame(() => setTimeout(() => finish(performance.now() - from), 0));
    };
    const onInput = (event: Event): void => {
      start = event.timeStamp;
      check();
    };
    const observer = new MutationObserver(check);
    observer.observe(root, { attributes: true, subtree: true, childList: true });
    input.addEventListener('input', onInput, true);
    setTimeout(() => finish(null), timeoutMs);
  });
}

/**
 * A fixed piece of work in a dedicated worker, in ms (as `busyMs` in the page): whether the
 * throttle slows the query worker too.
 */
function workerBusyMs(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const source =
          'let total = 0; for (let run = 0; run < 5; run++) { const start = performance.now(); let x = 0; for (let i = 0; i < 2000000; i++) x += Math.sqrt(i); self.sink = x; total += performance.now() - start; } postMessage(total);';
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url);
        worker.onmessage = (event: MessageEvent<number>) => {
          worker.terminate();
          URL.revokeObjectURL(url);
          resolve(event.data);
        };
      }),
  );
}

/** One change of the text: its time as drawn, the query worker's part, and the TV's estimate (`estimate`). */
interface Change extends PressTiming {
  readonly worker: number;
}

/** A change's time with the query worker's part `THROTTLE` times slower too. */
function estimate(change: Change): number {
  return change.ms + (THROTTLE - 1) * change.worker;
}

/** Types `keys` one at a time (a character, or `Backspace`), timing each change of the text to its answer drawn. */
async function typeTimed(page: Page, text: { now: string }, keys: readonly string[], out: Change[]): Promise<void> {
  for (const key of keys) {
    const next = key === 'Backspace' ? text.now.slice(0, -1) : text.now + key;
    await page.evaluate(armChange, { expected: next, timeoutMs: 10_000 });
    if (key === 'Backspace') await page.keyboard.press('Backspace');
    else await page.keyboard.insertText(key);
    const result = await page.evaluate(() => (window as unknown as ChangeWindow).__labloChange);
    const label = `"${next}"`;
    if (result.ms === null) throw new Error(`${label}: its answer was never drawn (the screen answered "${result.answered ?? ''}")`);
    out.push({ label, ms: result.ms, worker: result.worker });
    text.now = next;
  }
}

test.describe('the search at 4x CPU throttle over 200,000 items', () => {
  test(`draws each change of the text's answer within ${BUDGET.pressMs} ms`, async ({ page }) => {
    test.setTimeout(600_000);
    const errors = trackErrors(page);
    await page.addInitScript(recordRpc);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US', 400_000);
    await settled(live, 60_000);
    await remote.go('UP', 'live/header/0');
    await remote.go('RIGHT', 'live/header/1');
    await remote.go('RIGHT', 'live/header/2');
    await remote.go('RIGHT', 'live/header/3');
    await remote.go('OK', 'search/field/0');
    const root = page.getByTestId('search-screen');
    // A first search loads the query worker's segments (the 200,000 names) before the timed run.
    await remote.press('OK');
    await expect(root).toHaveAttribute('data-editing', 'search-field');
    await page.keyboard.insertText('warm');
    await expect(root).toHaveAttribute('data-answered', 'warm');
    await settled(root, 60_000);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await expect(root).toHaveAttribute('data-status', 'idle');

    const base = await busyMs(page);
    const workerBase = await workerBusyMs(page);
    const release = await throttle(page, THROTTLE);
    const presses: Change[] = [];
    let slowdown = 0;
    let workerSlowdown = 0;
    let longTasks: number[] = [];
    try {
      slowdown = (await busyMs(page)) / base;
      workerSlowdown = (await workerBusyMs(page)) / workerBase;
      await remote.watchLongTasks();
      const text = { now: '' };
      await typeTimed(page, text, LATIN.split(''), presses);
      await expect(root).toHaveAttribute('data-total', /^[1-9]/);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await expect(root).toHaveAttribute('data-status', 'idle');
      text.now = '';
      await typeTimed(page, text, ARABIC.split(''), presses);
      await typeTimed(page, text, ['Backspace', 'Backspace', 'Backspace', 'Backspace'], presses);
      longTasks = await remote.longTasks();
    } finally {
      await release();
    }
    const drawn = await root.getAttribute('data-total');

    const summary = summarize(presses);
    const estimates: PressTiming[] = presses.map((p) => ({ label: p.label, ms: estimate(p) }));
    const estimated = summarize(estimates);
    const report = {
      items: ITEMS,
      slowdown: Number(slowdown.toFixed(1)),
      workerSlowdown: Number(workerSlowdown.toFixed(1)),
      ...summary,
      estimated: { median: Math.round(estimated.median), p95: Math.round(estimated.p95), max: Math.round(estimated.max) },
      longTasks: longTasks.map(Math.round),
      // Each change: its text, its time as drawn, the worker's part, the estimate.
      presses: presses.map((p) => [p.label, Math.round(p.ms), Math.round(p.worker), Math.round(estimate(p))]),
    };
    writeFileSync(path.join(REPORT, 'search-throttled.json'), `${JSON.stringify(report, null, 2)}\n`);
    const slowest = [...presses].sort((a, b) => estimate(b) - estimate(a)).slice(0, 5).map((p) => `${p.label} ${Math.round(p.ms)} ms (worker ${Math.round(p.worker)}, estimate ${Math.round(estimate(p))})`);
    console.log(
      `[search, ${ITEMS} items, CPU ${report.slowdown}x slower, worker ${report.workerSlowdown}x] ${summary.count} changes: median ${summary.median.toFixed(0)} ms, p95 ${summary.p95.toFixed(0)} ms, max ${summary.max.toFixed(0)} ms; with the worker ${THROTTLE}x slower: median ${report.estimated.median} ms, max ${report.estimated.max} ms; long tasks ${report.longTasks.join(', ') || 'none'}; slowest: ${slowest.join('; ')}`,
    );

    expect(presses).toHaveLength(LATIN.length + ARABIC.length + 4);
    expect(Number(drawn)).toBeGreaterThan(0);
    // The throttle was on: the same work ran at least twice as slow (about 4x on a quiet machine).
    expect(slowdown).toBeGreaterThan(2);
    // Every change's search reached the worker and came back (so its part is measured).
    expect(presses.filter((p) => !(p.worker > 0)).map((p) => p.label)).toEqual([]);
    expect(budgetFailures(presses, longTasks, BUDGET)).toEqual([]);
    expect(budgetFailures(estimates, [], BUDGET)).toEqual([]);
    expect(errors).toEqual([]);
  });
});
