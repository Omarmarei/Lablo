/**
 * Bundle budgets (ADR-003): minified bytes as shipped, before any gzip. 1 KB = 1024 bytes.
 * The main budget includes the workers inlined into it.
 */
export const BUDGETS = {
  main: 500 * 1024,
  worker: 150 * 1024,
} as const;

export type BudgetKind = keyof typeof BUDGETS;

export interface BudgetResult {
  readonly label: string;
  readonly kind: BudgetKind;
  readonly bytes: number;
  readonly limit: number;
  readonly ok: boolean;
}

export function checkBudget(label: string, kind: BudgetKind, code: string): BudgetResult {
  const bytes = Buffer.byteLength(code, 'utf8');
  const limit = BUDGETS[kind];
  return { label, kind, bytes, limit, ok: bytes <= limit };
}

export function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatBudget(r: BudgetResult): string {
  const pct = Math.round((r.bytes / r.limit) * 100);
  return `${r.ok ? 'ok  ' : 'OVER'} ${r.label}: ${kb(r.bytes)} of ${kb(r.limit)} (${pct}%)`;
}
