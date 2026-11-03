import type { Intent } from '../packages/platform-api/src/index';

/**
 * The desktop key that stands for each remote Intent in the dev app: the browser adapter's map
 * (packages/platform-browser `browserKeyToIntent`; test/remote-keys.test.ts keeps them equal).
 * BACK is Escape: Backspace deletes inside a text field being edited.
 */
export const INTENT_KEYS: Readonly<Record<Intent, string>> = {
  UP: 'ArrowUp',
  DOWN: 'ArrowDown',
  LEFT: 'ArrowLeft',
  RIGHT: 'ArrowRight',
  OK: 'Enter',
  BACK: 'Escape',
  CH_UP: 'PageUp',
  CH_DOWN: 'PageDown',
  DIGIT_0: '0',
  DIGIT_1: '1',
  DIGIT_2: '2',
  DIGIT_3: '3',
  DIGIT_4: '4',
  DIGIT_5: '5',
  DIGIT_6: '6',
  DIGIT_7: '7',
  DIGIT_8: '8',
  DIGIT_9: '9',
  PLAY_PAUSE: ' ',
  STOP: 's',
  FF: 'f',
  RW: 'r',
  INFO: 'i',
  GUIDE: 'g',
  RED: 'F1',
  GREEN: 'F2',
  YELLOW: 'F3',
  BLUE: 'F4',
  PREV_CH: 'p',
};

/** One timed key press: what it was, and how long until the frame showing its focus was painted. */
export interface PressTiming {
  readonly label: string;
  readonly ms: number;
}

export interface PressBudget {
  /** Each press: from the key event to the paint of the frame that shows the new focus. */
  readonly pressMs: number;
  /** No main-thread task longer than this while the keys are pressed. */
  readonly longTaskMs: number;
}

export interface PressSummary {
  readonly count: number;
  readonly median: number;
  readonly p95: number;
  readonly max: number;
}

/** Nearest-rank percentile of `values` (0 for none). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1] ?? 0;
}

export function summarize(presses: readonly PressTiming[]): PressSummary {
  const ms = presses.map((p) => p.ms);
  return { count: ms.length, median: percentile(ms, 50), p95: percentile(ms, 95), max: ms.length === 0 ? 0 : Math.max(...ms) };
}

/** Every press over the budget and every long task over its limit; empty means within budget. */
export function budgetFailures(presses: readonly PressTiming[], longTasks: readonly number[], budget: PressBudget): string[] {
  const failures: string[] = [];
  if (presses.length === 0) failures.push('no key press was timed');
  for (const press of presses) {
    if (!(press.ms <= budget.pressMs)) failures.push(`${press.label}: ${Math.round(press.ms)} ms, over the ${budget.pressMs} ms budget`);
  }
  const long = longTasks.filter((ms) => !(ms <= budget.longTaskMs));
  if (long.length > 0) {
    failures.push(`${long.length} long task${long.length === 1 ? '' : 's'} over ${budget.longTaskMs} ms: ${long.map((ms) => Math.round(ms)).join(', ')} ms`);
  }
  return failures;
}
