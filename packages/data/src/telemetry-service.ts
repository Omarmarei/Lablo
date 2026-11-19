/**
 * Telemetry on the TV (architecture.md §3.4, RELAY step 33b1). The telemetry worker serves it
 * (`telemetryHandlers`): the app starts one for each send and ends it after. Main records events in
 * memory and hands them over here; this side keeps them in `kv` until the API has them.
 *
 * `send({events, base, platform, appVersion, sampling})`:
 * 1. **The switch:** the stored profile's `telemetry: false` (read raw, as it is stored) deletes the
 *    queue, the install ID and the last `capability`, and answers `off`: nothing is posted. A new
 *    ID is made when it is on again, so rows from before and after can't be linked.
 * 2. **The install ID** (`telemetry.id`): 16 random bytes as unpadded base64url, made at first
 *    need. It is never in the backup, so a wipe gives a new one.
 * 3. **Sampling** per kind (the config's `telemetrySampling`; a kind with no rate is kept), decided
 *    per install: `fnv1a(id + ':' + kind) / 2^32 < rate`, so an install sends a kind always or never.
 * 4. **`capability`** is kept only when it differs from the last one queued (`telemetry.capability`).
 * 5. **The queue** (`telemetry.queue`): the kept events appended, the newest `TELEMETRY_QUEUE_MAX`
 *    kept, in one transaction with the ID.
 * 6. **The post:** the oldest events whose JSON fits in `TELEMETRY_BODY_MAX_BYTES` with the
 *    envelope (at least one), `POST <base>/v1/telemetry`, `TELEMETRY_TIMEOUT_MS` for the answer.
 * 7. **The answer:** 200 takes the posted events off the queue's front (`sent`); 400 and 413 do too,
 *    since the server will never take them (`refused`); anything else keeps them (`failed`).
 *
 * The app runs one send at a time, so the queue changes only here between the append and the
 * removal. A send ended mid-post may send its events twice: the server has no dedupe, and telemetry
 * is best effort. Answers never hold a URL.
 */
import { toBase64Url } from '@lablo/crypto';
import type { TelemetryEvent } from '@lablo/protocol';
import { TELEMETRY_BATCH_MAX, TELEMETRY_BODY_MAX_BYTES } from '@lablo/protocol/telemetry-buckets';
import type { ByteResponse, ByteTransport } from './bytes';
import { onSuccess, transact } from './idb';
import { storedProfileDoc } from './profile';
import { STORE } from './schema';
import type { Clock } from './throttle';
import { REAL_CLOCK } from './throttle';

/** `kv`'s key for the install ID (22 characters). */
export const TELEMETRY_ID_KEY = 'telemetry.id';
/** `kv`'s key for the events not yet sent, oldest first. */
export const TELEMETRY_QUEUE_KEY = 'telemetry.queue';
/** `kv`'s key for the last `capability` queued (`capabilityKey`). */
export const TELEMETRY_CAPABILITY_KEY = 'telemetry.capability';

/** The events kept in the queue; a new one past this drops the oldest. */
export const TELEMETRY_QUEUE_MAX = TELEMETRY_BATCH_MAX;
/** How long a post may take, its answer included. */
export const TELEMETRY_TIMEOUT_MS = 20_000;
/** The install ID's random bytes. */
export const TELEMETRY_ID_BYTES = 16;

/** A 16-byte install ID as unpadded base64url (the protocol's `bytes16`). */
const INSTALL_ID = /^[A-Za-z0-9_-]{21}[AQgw]$/;

export interface TelemetrySendRequest {
  /** The events main recorded since the last send, oldest first. */
  events: TelemetryEvent[];
  /** `http(s)://host[:port]`, no path (the backup's base). */
  base: string;
  /** The build's platform (`tizen`, `webos`; `browser` in the dev app, which the API refuses). */
  platform: string;
  appVersion: string;
  /** The config's `telemetrySampling` (`null`: every kind). */
  sampling: Readonly<Record<string, number>> | null;
}

export type TelemetrySendResult =
  /** The profile's switch is off: the queue and the ID are gone, nothing was posted. */
  | { readonly state: 'off' }
  /** Nothing to post. */
  | { readonly state: 'empty' }
  /** The API stored `sent` events; `queued` wait for the next send. */
  | { readonly state: 'sent'; readonly sent: number; readonly queued: number }
  /** The API refused `dropped` events for good (400, 413): they are gone too. */
  | { readonly state: 'refused'; readonly status: number; readonly dropped: number; readonly queued: number }
  /** No connection, the time limit, or another status (`null` without one): every event is kept. */
  | { readonly state: 'failed'; readonly failure: 'network' | 'timeout' | 'status'; readonly status: number | null; readonly queued: number };

export interface TelemetryServiceOptions {
  openDb: () => Promise<IDBDatabase>;
  transport: ByteTransport;
  /** Default `crypto.getRandomValues`. */
  random?: (length: number) => Uint8Array;
  /** The clock for the post's time limit (default the real one). */
  clock?: Clock;
}

/** Whether a stored profile turns telemetry off (`telemetry: false`). */
export function telemetryOff(doc: unknown): boolean {
  return typeof doc === 'object' && doc !== null && (doc as { telemetry?: unknown }).telemetry === false;
}

/** Where `kind` falls for this install, in [0, 1): FNV-1a of `id:kind` over 2^32. */
export function samplePoint(installId: string, kind: string): number {
  const text = installId + ':' + kind;
  let h = 0x811c9dc5;
  // (The ID and the kinds are ASCII: one byte a character.)
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 4294967296;
}

/** Whether this install sends `kind` at `sampling`'s rate (no rate: always; the config's schema makes each a number). */
export function sampled(installId: string, kind: string, sampling: Readonly<Record<string, number>> | null): boolean {
  const rate = sampling === null || !Object.prototype.hasOwnProperty.call(sampling, kind) ? 1 : sampling[kind]!;
  return samplePoint(installId, kind) < rate;
}

/** A `capability` event's fields but its time, as one string: a repeat has the same. */
export function capabilityKey(event: TelemetryEvent, appVersion: string): string {
  if (event.kind !== 'capability') return '';
  return JSON.stringify([appVersion, event.model, event.firmware, event.chromium, event.probes]);
}

/** UTF-8 bytes of `text` (as `JSON.stringify` writes it: no lone surrogate). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // A surrogate is half of a 4-byte character.
    bytes += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c <= 0xdfff) ? 2 : 3;
  }
  return bytes;
}

/**
 * The body for `queue`'s oldest events: as many as fit in `TELEMETRY_BODY_MAX_BYTES` with the
 * envelope, at least one (a single event too large for it is refused by the API, and so dropped).
 */
export function batchBody(installId: string, platform: string, appVersion: string, queue: readonly TelemetryEvent[]): { readonly body: string; readonly count: number } {
  const head = '{"installId":' + JSON.stringify(installId) + ',"platform":' + JSON.stringify(platform) + ',"appVersion":' + JSON.stringify(appVersion) + ',"events":[';
  let body = head;
  let bytes = utf8Length(head) + 2;
  let count = 0;
  for (; count < queue.length && count < TELEMETRY_BATCH_MAX; count++) {
    const event = JSON.stringify(queue[count]);
    const more = utf8Length(event) + (count === 0 ? 0 : 1);
    if (count > 0 && bytes + more > TELEMETRY_BODY_MAX_BYTES) break;
    body += (count === 0 ? '' : ',') + event;
    bytes += more;
  }
  return { body: body + ']}', count };
}

/** What a post gave: its status, or why none. */
type PostAnswer = { readonly status: number } | { readonly failure: 'network' | 'timeout' };

class TelemetryService {
  private readonly clock: Clock;
  private readonly random: (length: number) => Uint8Array;

  constructor(private readonly options: TelemetryServiceOptions) {
    this.clock = options.clock ?? REAL_CLOCK;
    this.random = options.random ?? ((length) => crypto.getRandomValues(new Uint8Array(length)));
  }

  async send(request: TelemetrySendRequest): Promise<TelemetrySendResult> {
    const db = await this.options.openDb();
    try {
      if (telemetryOff(await storedProfileDoc(db))) {
        await transact(db, STORE.kv, 'readwrite', (tx) => {
          const kv = tx.objectStore(STORE.kv);
          kv.delete(TELEMETRY_QUEUE_KEY);
          kv.delete(TELEMETRY_ID_KEY);
          kv.delete(TELEMETRY_CAPABILITY_KEY);
        });
        return { state: 'off' };
      }
      const { id, queue } = await this.enqueue(db, request);
      if (queue.length === 0) return { state: 'empty' };
      const { body, count } = batchBody(id, request.platform, request.appVersion, queue);
      const answer = await this.post(request.base + '/v1/telemetry', body);
      if ('failure' in answer) return { state: 'failed', failure: answer.failure, status: null, queued: queue.length };
      const { status } = answer;
      if (status !== 200 && status !== 400 && status !== 413) return { state: 'failed', failure: 'status', status, queued: queue.length };
      const left = await this.dropFront(db, count);
      return status === 200 ? { state: 'sent', sent: count, queued: left } : { state: 'refused', status, dropped: count, queued: left };
    } finally {
      db.close();
    }
  }

  /** The ID (made now if there is none) and the queue with `request`'s kept events, written in one transaction. */
  private enqueue(db: IDBDatabase, request: TelemetrySendRequest): Promise<{ id: string; queue: TelemetryEvent[] }> {
    return transact<{ id: string; queue: TelemetryEvent[] }>(db, STORE.kv, 'readwrite', (tx, done) => {
      const kv = tx.objectStore(STORE.kv);
      onSuccess(kv.get(TELEMETRY_ID_KEY), (storedId) => {
        let id = typeof storedId === 'string' && INSTALL_ID.test(storedId) ? storedId : null;
        if (id === null) {
          id = toBase64Url(this.random(TELEMETRY_ID_BYTES));
          kv.put(id, TELEMETRY_ID_KEY);
        }
        const installId = id;
        onSuccess(kv.get(TELEMETRY_QUEUE_KEY), (storedQueue) => {
          onSuccess(kv.get(TELEMETRY_CAPABILITY_KEY), (storedCapability) => {
            const queue: TelemetryEvent[] = Array.isArray(storedQueue) ? (storedQueue as TelemetryEvent[]) : [];
            /** The last capability queued: the stored one's key, then each one queued now. */
            let capability: unknown = storedCapability;
            const before = queue.length;
            for (let i = 0; i < request.events.length; i++) {
              const event = request.events[i]!;
              if (!sampled(installId, event.kind, request.sampling)) continue;
              if (event.kind === 'capability') {
                const key = capabilityKey(event, request.appVersion);
                if (key === capability) continue;
                capability = key;
                kv.put(key, TELEMETRY_CAPABILITY_KEY);
              }
              queue.push(event);
            }
            const kept = queue.length > TELEMETRY_QUEUE_MAX ? queue.slice(queue.length - TELEMETRY_QUEUE_MAX) : queue;
            if (queue.length !== before) kv.put(kept, TELEMETRY_QUEUE_KEY);
            done({ id: installId, queue: kept });
          });
        });
      });
    });
  }

  /** Takes `count` events off the queue's front; resolves with how many are left. */
  private dropFront(db: IDBDatabase, count: number): Promise<number> {
    return transact<number>(db, STORE.kv, 'readwrite', (tx, done) => {
      const kv = tx.objectStore(STORE.kv);
      onSuccess(kv.get(TELEMETRY_QUEUE_KEY), (stored) => {
        // The list `enqueue` wrote: only this send changes it meanwhile (one at a time).
        const left = (stored as TelemetryEvent[]).slice(count);
        if (left.length === 0) kv.delete(TELEMETRY_QUEUE_KEY);
        else kv.put(left, TELEMETRY_QUEUE_KEY);
        done(left.length);
      });
    });
  }

  /**
   * `POST`s `body` as JSON: the answer's status alone (its body is never read), or why none. An
   * answer after the time limit is let go when it comes (Chromium 53 can't abort a fetch).
   */
  private post(url: string, body: string): Promise<PostAnswer> {
    return new Promise<PostAnswer>((resolve) => {
      void this.clock.sleep(TELEMETRY_TIMEOUT_MS).then(() => resolve({ failure: 'timeout' }));
      // (A promise settles once: whichever comes second changes nothing.)
      this.options.transport.get(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then(
        (response: ByteResponse) => {
          response.cancel();
          resolve({ status: response.status });
        },
        () => resolve({ failure: 'network' }),
      );
    });
  }
}

/** The telemetry worker's RPC methods: `send`. */
export function telemetryHandlers(options: TelemetryServiceOptions) {
  const service = new TelemetryService(options);
  return {
    send: (request: TelemetrySendRequest): Promise<TelemetrySendResult> => service.send(request),
  };
}
