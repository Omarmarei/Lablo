/** Messages between the lab page and the lab worker (S1 runs its worker checks there). */
import type { StreamReport } from './probes';

export type LabWorkerRequest =
  | { readonly id: number; readonly op: 'features' }
  | { readonly id: number; readonly op: 'fetch-stream'; readonly url: string }
  | { readonly id: number; readonly op: 'idb-bulk'; readonly items: number; readonly chunk: number };

export type LabWorkerReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** The runtime APIs found inside the worker. */
export type WorkerFeatures = Record<string, boolean>;

export type { StreamReport };

/** What the bulk write in the worker measured. */
export interface BulkReport {
  readonly items: number;
  readonly chunk: number;
  /** All chunks written, one readwrite transaction per chunk, as the ingest does. */
  readonly writeMs: number;
  /** The slowest single chunk. */
  readonly slowestChunkMs: number;
  /** `count()` after the writes. */
  readonly count: number;
  /** `getAll` over the first chunk's keys, or null when the engine has no getAll. */
  readonly getAll: number | null;
  readonly deleted: boolean;
}
