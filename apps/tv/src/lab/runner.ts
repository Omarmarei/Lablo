/**
 * Runs the lab's checks one at a time. A check that throws or runs past its timeout fails with
 * the reason; it never stops the run, since every other answer from the TV is still worth having.
 */
import type { Check, CheckResult, LabContext, LabStatus, Spike } from './types';

export const DEFAULT_CHECK_TIMEOUT_MS = 30_000;

export interface CheckOutcome {
  readonly spike: string;
  readonly check: string;
  readonly result: CheckResult;
  readonly ms: number;
}

function message(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** One check, timed, its failures turned into results. */
export function runCheck(check: Check, context: LabContext, clock: () => number = () => Date.now()): Promise<{ result: CheckResult; ms: number }> {
  const started = clock();
  const timeoutMs = check.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: CheckResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ result, ms: clock() - started });
    };
    const timer = setTimeout(() => finish({ status: 'fail', note: `no result within ${timeoutMs} ms` }), timeoutMs);
    let running: Promise<CheckResult>;
    try {
      running = check.run(context);
    } catch (error) {
      finish({ status: 'fail', note: `threw ${message(error)}` });
      return;
    }
    running.then(finish, (error: unknown) => finish({ status: 'fail', note: `threw ${message(error)}` }));
  });
}

/** Runs the spikes' checks in order, reporting each outcome as it ends. */
export async function runSpikes(
  spikes: readonly Spike[],
  context: LabContext,
  onOutcome: (outcome: CheckOutcome) => void,
  onStart: (spike: string, check: string) => void = () => undefined,
): Promise<CheckOutcome[]> {
  const outcomes: CheckOutcome[] = [];
  for (const spike of spikes) {
    for (const check of spike.checks) {
      onStart(spike.id, check.id);
      const { result, ms } = await runCheck(check, context);
      const outcome: CheckOutcome = { spike: spike.id, check: check.id, result, ms };
      outcomes.push(outcome);
      onOutcome(outcome);
    }
  }
  return outcomes;
}

/** A spike's overall status: any fail, else any pass, else info, else skip; null before it ran. */
export function spikeStatus(statuses: readonly LabStatus[]): LabStatus | null {
  if (statuses.length === 0) return null;
  if (statuses.indexOf('fail') !== -1) return 'fail';
  if (statuses.indexOf('pass') !== -1) return 'pass';
  if (statuses.indexOf('info') !== -1) return 'info';
  return 'skip';
}

/** Counts per status, for the end record. */
export function countStatuses(outcomes: readonly CheckOutcome[]): Record<LabStatus, number> {
  const counts: Record<LabStatus, number> = { pass: 0, fail: 0, info: 0, skip: 0 };
  for (const outcome of outcomes) counts[outcome.result.status] += 1;
  return counts;
}
