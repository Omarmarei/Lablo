import type { BuiltWorker } from './bundle';

/**
 * Bundle budgets (ADR-003): minified bytes as shipped, before any gzip. 1 KB = 1024 bytes.
 *
 * Each worker counts against its own budget. The main budget covers the main thread's own
 * code: main.js minus the worker strings inlined into it, which are only parsed as code when
 * their worker starts (Omar's decision of 2026-11-03, RELAY.md "Main bundle budget").
 */
export const BUDGETS = {
  main: 500 * 1024,
  worker: 150 * 1024,
} as const;

export type BudgetKind = keyof typeof BUDGETS;

export interface BudgetResult {
  readonly label: string;
  readonly kind: BudgetKind;
  /** The bytes that count: the file's size minus `inlined`. */
  readonly bytes: number;
  readonly limit: number;
  readonly ok: boolean;
  /** Bytes in the file that are inlined workers, each checked against its own budget. */
  readonly inlined: number;
}

/** `inlined`: bytes of `code` that are inlined worker strings and don't count here. */
export function checkBudget(label: string, kind: BudgetKind, code: string, inlined = 0): BudgetResult {
  const size = Buffer.byteLength(code, 'utf8');
  if (!Number.isInteger(inlined) || inlined < 0 || inlined > size) {
    throw new RangeError(`${label}: ${inlined} inlined bytes in a file of ${size}`);
  }
  const bytes = size - inlined;
  const limit = BUDGETS[kind];
  return { label, kind, bytes, limit, ok: bytes <= limit, inlined };
}

/** The bundle as `bundleIife` returns it. */
export interface BudgetedBundle {
  readonly code: string;
  readonly workers: readonly BuiltWorker[];
  readonly inlinedBytes: number;
}

/**
 * The budgets of one TV build: the main bundle's own code against the main budget, and each
 * worker (with anything inlined into it) against the worker budget.
 */
export function bundleBudgets(label: string, bundle: BudgetedBundle, workerLabel: (worker: BuiltWorker) => string): BudgetResult[] {
  return [
    checkBudget(label, 'main', bundle.code, bundle.inlinedBytes),
    ...bundle.workers.map((worker) => checkBudget(workerLabel(worker), 'worker', worker.code)),
  ];
}

export function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatBudget(r: BudgetResult): string {
  const pct = Math.round((r.bytes / r.limit) * 100);
  const own = r.inlined > 0 ? ' own code' : '';
  const workers = r.inlined > 0 ? `, plus ${kb(r.inlined)} of inlined workers` : '';
  return `${r.ok ? 'ok  ' : 'OVER'} ${r.label}: ${kb(r.bytes)}${own} of ${kb(r.limit)} (${pct}%)${workers}`;
}
