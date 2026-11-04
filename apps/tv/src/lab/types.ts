/**
 * The Zoma Lab's vocabulary (RELAY step 15a, docs/architecture.md §5): spikes made of checks,
 * each check ending as one record that goes to the LAN log collector.
 */
import type { DeviceInfo, Platform } from '@zoma/platform-api';
import type { LabWorkerClient } from './worker-client';

/**
 * - `pass`/`fail`: the check has a pass criterion and met it or not;
 * - `info`: a measurement or a fact with no criterion of its own (judged in step 16);
 * - `skip`: the check doesn't apply here (no device ID in a desktop browser).
 */
export type LabStatus = 'pass' | 'fail' | 'info' | 'skip';

export interface CheckResult {
  readonly status: LabStatus;
  /** JSON-safe details: numbers, text, small objects. */
  readonly value?: unknown;
  readonly note?: string;
}

/** What the lab left on this TV in an earlier run (S2 and S3 compare against it). */
export interface LabMarker {
  readonly version: string;
  readonly session: string;
  /** ISO time it was written. */
  readonly at: string;
  /** How many runs wrote a marker here, this one included. */
  readonly runs: number;
  /** S3: hash of the device ID, or null when there was none. */
  readonly deviceIdHash: string | null;
}

export interface LabContext {
  readonly platform: Platform;
  readonly info: DeviceInfo;
  /** The lab server (the mock provider): `http://192.168.1.20:8080`, no trailing slash. */
  readonly server: string;
  readonly session: string;
  /** The lab build's version (the manifest's), `dev` under Vite. */
  readonly version: string;
  /** S2's write test target in MB. */
  readonly writeMb: number;
  /** The markers found at start, before this run wrote its own. */
  readonly previous: { readonly localStorage: LabMarker | null; readonly indexedDB: LabMarker | null };
  /** S3: hash of this TV's device ID, or null. */
  readonly deviceIdHash: string | null;
  /** ms from the page's start to the lab's script running: this launch's boot (S0, S6's cold start). */
  readonly bootMs: number;
  readonly worker: LabWorkerClient;
}

export interface Check {
  /** Unique within its spike: `blob-worker`. */
  readonly id: string;
  readonly title: string;
  /** Default 30 s. */
  readonly timeoutMs?: number;
  run(context: LabContext): Promise<CheckResult>;
}

export interface Spike {
  /** `S1`. */
  readonly id: string;
  readonly title: string;
  /** The question from docs/architecture.md §5. */
  readonly question: string;
  readonly checks: readonly Check[];
}

/** One line in the collector's NDJSON (`artifacts/lab-logs/<session>.ndjson`). */
export interface LabRecord {
  readonly type: 'start' | 'check' | 'end';
  readonly session: string;
  /** 1 for the first record of the session, then counting. */
  readonly seq: number;
  /** ISO time on the TV's clock. */
  readonly at: string;
  readonly spike?: string;
  readonly check?: string;
  readonly status?: LabStatus;
  readonly value?: unknown;
  readonly note?: string;
  /** How long the check took. */
  readonly ms?: number;
}
