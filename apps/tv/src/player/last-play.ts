import type { Container, PlaybackFailure, PlayerReport, PlayerStatus } from '@lablo/player';

/**
 * The app run's last stream, for Settings › "Check the connection" (RELAY step 40a): main gives
 * it the player's reports and statuses, and the page reads `value()` at each check.
 *
 * - **Played:** a `play` report with its first frame: the URL's container and the time to it.
 * - **Failed:** a `failed` status: the error card's failure (its category, code and detail).
 *
 * The newer of the two wins: a stream that played and failed later shows its failure; the next
 * one that plays shows as played. Nothing is kept across app runs. Main-safe (it is in main.js).
 */
export type LastPlay =
  | { readonly state: 'played'; readonly container: Container; readonly ttffMs: number }
  | { readonly state: 'failed'; readonly failure: PlaybackFailure };

export interface LastPlayTracker {
  report(report: PlayerReport): void;
  status(status: PlayerStatus): void;
  value(): LastPlay | null;
}

export function createLastPlay(): LastPlayTracker {
  let last: LastPlay | null = null;
  return {
    report(report): void {
      if (report.type === 'play' && report.ttffMs !== null) last = { state: 'played', container: report.container, ttffMs: report.ttffMs };
    },
    status(status): void {
      if (status.state === 'failed' && status.failure !== null) last = { state: 'failed', failure: status.failure };
    },
    value: () => last,
  };
}
