import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { DiagSendResult } from '@lablo/data';

/**
 * Settings' "Send a report to support" row (RELAY step 33d2, architecture.md §3.4): OK sends the
 * diagnostics report, and the row then shows the support code the API answered, which the user
 * gives to support. No page and no question: the row's line says what the report holds (never a
 * link or a login), and nothing goes without the user's OK. It is sent with telemetry's switch off
 * too: it is the user's own act.
 *
 * - **OK** sends (main builds the request: `send`); OK again does nothing while it sends.
 * - **The answer** stays until Settings is opened again (`opened` clears a code or a failure,
 *   never a send in progress, whose answer then shows when it comes).
 * - **Its request** counts in `pending` (the settings screen's `data-pending`).
 */

export type ReportState =
  | { readonly state: 'idle' }
  | { readonly state: 'sending' }
  | { readonly state: 'sent'; readonly code: string }
  | { readonly state: 'failed' };

export interface ReportOptions {
  /** Builds the report's request and sends it (main: its parts, telemetry's `recent()`, `DataEngine.sendDiagReport`). */
  readonly send: () => Promise<DiagSendResult>;
}

export interface ReportRow {
  readonly state: ReadonlySignal<ReportState>;
  /** The send in flight (0: the row is done with the workers). */
  readonly pending: ReadonlySignal<number>;
  /** Each opening of Settings: a shown code or failure is cleared, never a send in progress. */
  opened(): void;
  /** OK on the row: sends, unless a send is running. */
  press(): void;
  dispose(): void;
}

const IDLE: ReportState = { state: 'idle' };
const SENDING: ReportState = { state: 'sending' };
const FAILED: ReportState = { state: 'failed' };

export function createReportRow(options: ReportOptions): ReportRow {
  const state = signal<ReportState>(IDLE);
  const pending = signal(0);
  let disposed = false;

  const press = (): void => {
    if (disposed || state.peek().state === 'sending') return;
    state.value = SENDING;
    pending.value += 1;
    let sending: Promise<DiagSendResult>;
    try {
      sending = options.send();
    } catch (error) {
      sending = Promise.reject(error);
    }
    sending.then(
      (result) => {
        pending.value -= 1;
        if (result.state !== 'sent') console.warn('The report was not sent', result.failure === 'status' ? result.status : result.failure);
        if (!disposed) state.value = result.state === 'sent' ? { state: 'sent', code: result.code } : FAILED;
      },
      (error: unknown) => {
        pending.value -= 1;
        console.warn('The report was not sent', error);
        if (!disposed) state.value = FAILED;
      },
    );
  };

  return {
    state,
    pending,
    opened(): void {
      if (state.peek().state !== 'sending') state.value = IDLE;
    },
    press,
    dispose(): void {
      disposed = true;
    },
  };
}
