// `pnpm bench [case...] [--fixtures .cache/fixtures] [--iterations 3] [--json <file>]`
// Throughput and peak memory of each case over the scale fixtures (run `pnpm fixtures` first).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { BenchResult } from './src/harness';
import { formatTable, measure, overLimits } from './src/harness';
import { availableCases } from './src/suites';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    fixtures: { type: 'string', default: join(import.meta.dirname, '..', '..', '.cache', 'fixtures') },
    iterations: { type: 'string', default: '3' },
    json: { type: 'string' },
  },
});

const { cases, missing } = availableCases(resolve(values.fixtures), positionals.length > 0 ? positionals : undefined);
for (const m of missing) console.log(`skipped: ${m}`);
if (!(globalThis as { gc?: unknown }).gc) console.log('note: run with --expose-gc for clean per-run heaps (pnpm bench does)');
const results: BenchResult[] = [];
for (const c of cases) {
  results.push(await measure(c, { iterations: Number(values.iterations) }));
  console.log(`done: ${c.name}`);
}
console.log(formatTable(results));
const over = results.flatMap(overLimits);
for (const line of over) console.error(`over the limit: ${line}`);
if (results.some((r) => r.limit)) console.log(over.length === 0 ? 'limits: every case within its limits' : `limits: ${over.length} exceeded`);
if (values.json) {
  mkdirSync(dirname(resolve(values.json)), { recursive: true });
  writeFileSync(values.json, `${JSON.stringify(results, null, 2)}\n`);
}
if (over.length > 0) process.exitCode = 1;
