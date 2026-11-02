// Benchmark harness for parser-shaped work (RELAY step 4, for steps 5-9): runs a case a few
// times and reports throughput (MB/s over its input, items/s) and peak memory sampled while it
// runs. Start Node with --expose-gc (as `pnpm bench` does) so each run starts from a clean heap.

export interface BenchCase {
  name: string;
  /** Input bytes per run, for MB/s (0 when not meaningful). */
  bytes: number;
  /** One run; returns how many items it produced (lines, objects, programmes...). */
  run(): Promise<number> | number;
  /** A limit the case must stay within (`pnpm bench` fails otherwise). */
  limit?: BenchLimit;
}

export interface BenchLimit {
  /** Median wall time per run (ms). */
  medianMs: number;
}

export interface BenchResult {
  name: string;
  iterations: number;
  bytes: number;
  items: number;
  /** Wall time per run (ms). */
  ms: { min: number; median: number; max: number };
  mbPerSec: number;
  itemsPerSec: number;
  /** Highest heapUsed above the pre-run baseline, over all runs (MB). */
  heapPeakMb: number;
  /** Highest RSS seen (MB). */
  rssPeakMb: number;
  limit?: BenchLimit;
}

/** What went over the case's limit (empty: within it). */
export function overLimits(r: BenchResult): string[] {
  const l = r.limit;
  return l !== undefined && r.ms.median > l.medianMs ? [`${r.name}: median ${r.ms.median.toFixed(0)} ms over the ${l.medianMs} ms limit`] : [];
}

export interface MeasureOptions {
  iterations?: number;
  warmup?: number;
  /** Memory sampling interval (ms). Synchronous runs are only sampled before and after. */
  sampleMs?: number;
}

const gc = (globalThis as { gc?: () => void }).gc;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function measure(c: BenchCase, options: MeasureOptions = {}): Promise<BenchResult> {
  const iterations = options.iterations ?? 3;
  const warmup = options.warmup ?? 1;
  const sampleMs = options.sampleMs ?? 5;
  for (let i = 0; i < warmup; i++) await c.run();
  const times: number[] = [];
  let items = 0;
  let heapPeak = 0;
  let rssPeak = 0;
  for (let i = 0; i < iterations; i++) {
    gc?.();
    const baseline = process.memoryUsage().heapUsed;
    const sample = (): void => {
      const m = process.memoryUsage();
      heapPeak = Math.max(heapPeak, m.heapUsed - baseline);
      rssPeak = Math.max(rssPeak, m.rss);
    };
    const timer = setInterval(sample, sampleMs);
    const t0 = performance.now();
    try {
      items = await c.run();
    } finally {
      times.push(performance.now() - t0);
      sample();
      clearInterval(timer);
    }
  }
  const med = median(times);
  return {
    name: c.name,
    iterations,
    bytes: c.bytes,
    items,
    ms: { min: Math.min(...times), median: med, max: Math.max(...times) },
    mbPerSec: c.bytes > 0 ? c.bytes / 1e6 / (med / 1000) : 0,
    itemsPerSec: items / (med / 1000),
    heapPeakMb: heapPeak / 1e6,
    rssPeakMb: rssPeak / 1e6,
    ...(c.limit ? { limit: c.limit } : {}),
  };
}

export function formatTable(results: BenchResult[]): string {
  const rows = [
    ['case', 'input MB', 'items', 'median ms', 'MB/s', 'items/s', 'heap peak MB', 'rss MB'],
    ...results.map((r) => [
      r.name,
      (r.bytes / 1e6).toFixed(1),
      String(r.items),
      r.ms.median.toFixed(0),
      r.mbPerSec.toFixed(1),
      Math.round(r.itemsPerSec).toString(),
      r.heapPeakMb.toFixed(1),
      r.rssPeakMb.toFixed(0),
    ]),
  ];
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows.map((row) => row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!))).join('  ')).join('\n');
}
