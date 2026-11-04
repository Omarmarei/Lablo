/**
 * The lab's records on their way to the LAN log collector (`POST /__lab/logs/<session>` on the
 * mock provider, docs/runbooks/mock-provider.md). Claude can't see the TV, so this is how its
 * results come back.
 *
 * - Records are sent in order, as NDJSON, up to 50 per request, one request at a time.
 * - The body is `text/plain`: a CORS-simple request (no preflight) from any page.
 * - A failed request is retried after 1, 2, 4… seconds (at most 30); nothing is dropped, so a
 *   collector started late still gets the whole run.
 */
import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LabRecord } from './types';

export type Post = (url: string, body: string) => Promise<void>;

export interface ReporterState {
  /** Records the collector took. */
  readonly sent: number;
  /** Records still waiting to go. */
  readonly pending: number;
  /** Failed requests in a row (0 once one succeeds). */
  readonly failures: number;
  readonly lastError: string | null;
}

export type NewRecord = Omit<LabRecord, 'session' | 'seq' | 'at'>;

export interface Reporter {
  readonly session: string;
  /** Where the records go: `<server>/__lab/logs/<session>`. */
  readonly url: string;
  readonly state: ReadonlySignal<ReporterState>;
  /** Every record of this session, sent or not. */
  readonly records: readonly LabRecord[];
  add(record: NewRecord): LabRecord;
}

export interface ReporterOptions {
  readonly server: string;
  readonly session: string;
  readonly post: Post;
  readonly now?: () => Date;
  readonly schedule?: (run: () => void, ms: number) => unknown;
  readonly maxBatch?: number;
}

export const RETRY_MAX_MS = 30_000;

/** The wait before retry number `failures` (1 → 1 s, 2 → 2 s, … at most 30 s). */
export function retryDelay(failures: number): number {
  return Math.min(RETRY_MAX_MS, 1000 * Math.pow(2, Math.max(0, failures - 1)));
}

export function createReporter(options: ReporterOptions): Reporter {
  const { server, session, post } = options;
  const now = options.now ?? (() => new Date());
  const schedule = options.schedule ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const maxBatch = options.maxBatch ?? 50;
  const url = `${server}/__lab/logs/${session}`;
  const records: LabRecord[] = [];
  const queue: LabRecord[] = [];
  const state = signal<ReporterState>({ sent: 0, pending: 0, failures: 0, lastError: null });
  let busy = false;

  const update = (patch: Partial<ReporterState>): void => {
    state.value = { ...state.value, ...patch, pending: queue.length };
  };

  const kick = (): void => {
    if (busy || queue.length === 0) return;
    busy = true;
    const batch = queue.slice(0, maxBatch);
    const body = batch.map((r) => `${JSON.stringify(r)}\n`).join('');
    post(url, body).then(
      () => {
        queue.splice(0, batch.length);
        busy = false;
        update({ sent: state.value.sent + batch.length, failures: 0, lastError: null });
        kick();
      },
      (error: unknown) => {
        const failures = state.value.failures + 1;
        update({ failures, lastError: error instanceof Error ? error.message : String(error) });
        schedule(() => {
          busy = false;
          kick();
        }, retryDelay(failures));
      },
    );
  };

  return {
    session,
    url,
    state,
    records,
    add(record: NewRecord): LabRecord {
      const full: LabRecord = { ...record, session, seq: records.length + 1, at: now().toISOString() };
      records.push(full);
      queue.push(full);
      update({});
      kick();
      return full;
    },
  };
}

/**
 * POST through XMLHttpRequest (on every engine, with a timeout). Resolves on a 2xx answer;
 * rejects otherwise, with the status (0: no answer, or a CORS refusal in a desktop browser).
 */
export function xhrPost(url: string, body: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader('Content-Type', 'text/plain');
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`collector answered ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error(`no answer from ${url} (status ${xhr.status})`));
    xhr.ontimeout = () => reject(new Error(`no answer from ${url} within ${timeoutMs} ms`));
    xhr.send(body);
  });
}
