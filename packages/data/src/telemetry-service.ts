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
 * 5. **A `crash`'s stack is scrubbed** (step 33c, `scrubText`) with the user's own logins, links and
 *    hosts (`knownStrings` of the stored profile), before it is queued: main hands over the raw
 *    text, and no unscrubbed stack is ever written to the database.
 * 6. **The queue** (`telemetry.queue`): the kept events appended, the newest `TELEMETRY_QUEUE_MAX`
 *    kept, in one transaction with the ID.
 * 7. **The post:** the oldest events whose JSON fits in `TELEMETRY_BODY_MAX_BYTES` with the
 *    envelope (at least one), `POST <base>/v1/telemetry`, `TELEMETRY_TIMEOUT_MS` for the answer.
 * 8. **The answer:** 200 takes the posted events off the queue's front (`sent`); 400 and 413 do too,
 *    since the server will never take them (`refused`); anything else keeps them (`failed`).
 *
 * The app runs one send at a time, so the queue changes only here between the append and the
 * removal. A send ended mid-post may send its events twice: the server has no dedupe, and telemetry
 * is best effort. Answers never hold a URL.
 */
import { toBase64Url } from '@lablo/crypto';
import type { DiagGuide, DiagReport, DiagSource, TelemetryEvent } from '@lablo/protocol';
import { scrubText } from '@lablo/protocol/scrub';
import { ageBucket, countBucket, DIAG_EVENTS_MAX, DIAG_GUIDES_MAX, DIAG_SOURCES_MAX, rateBucket, TELEMETRY_BATCH_MAX, TELEMETRY_BODY_MAX_BYTES } from '@lablo/protocol/telemetry-buckets';
import type { ByteResponse, ByteTransport } from './bytes';
import type { SourceMeta } from './catalog-store';
import type { EpgMeta } from './epg-store';
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

/** A source's or a guide's fields that hold a link, a server or an origin (any profile version; `epgUrl` is version 2 and 3's). */
const LINK_FIELDS = ['url', 'base', 'origin', 'epgUrl'];
/** An Xtream account's fields. */
const ACCOUNT_FIELDS = ['base', 'username', 'password'];
/** `scheme://[user[:password]@]host…`: the user, the password and the host (a bracketed IPv6 one too). */
const URL_PARTS = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:([^:@/?#]*)(?::([^@/?#]*))?@)?(\[[^\]/?#]*\]|[^:/?#]*)/;
/** A login's value in a link's query (the scrubber's pair keys). */
const LOGIN_QUERY = /[?&](?:user|username|uname|login|pass|passwd|password|pwd|token|auth|apikey|api_key|key|secret|session|sessionid|sid|sig|signature)=([^&#]*)/gi;

/** `value` and, when it reads differently decoded (`p%40ss`), its decoded form. */
function addDecoded(value: string | undefined, known: string[]): void {
  if (value === undefined || value === '') return;
  known.push(value);
  try {
    const decoded = decodeURIComponent(value);
    if (decoded !== value) known.push(decoded);
  } catch {
    // (A lone `%`: the value as it is is enough.)
  }
}

/** `text` and, when it is a link, its user, password, host (and its lower case) and the logins in its query. */
function addLink(text: unknown, known: string[]): void {
  if (typeof text !== 'string' || text === '') return;
  known.push(text);
  const parts = URL_PARTS.exec(text);
  if (parts === null) return;
  addDecoded(parts[1], known);
  addDecoded(parts[2], known);
  const host = parts[3]!;
  if (host !== '') known.push(host);
  if (host.toLowerCase() !== host) known.push(host.toLowerCase());
  text.replace(LOGIN_QUERY, (all: string, value: string) => {
    addDecoded(value, known);
    return all;
  });
}

/**
 * The user's own logins, links and hosts in a stored profile (any version, read raw): what the
 * scrubber looks for in a crash's stack (step 33c). Each source's link, server and origin, its
 * account's server, username and password, and each guide's link and origin; for each link, its
 * user, password, host and the logins in its query. Only these: a known string is replaced
 * wherever it occurs, inside words too, and the scrubber's own rules catch every other URL, address
 * and host. The scrubber skips the short ones.
 */
export function knownStrings(doc: unknown): string[] {
  const known: string[] = [];
  if (typeof doc !== 'object' || doc === null) return known;
  const lists = [(doc as { sources?: unknown }).sources, (doc as { guides?: unknown }).guides];
  for (let l = 0; l < lists.length; l++) {
    const list = lists[l];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const entry: unknown = list[i];
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      for (let f = 0; f < LINK_FIELDS.length; f++) addLink(record[LINK_FIELDS[f]!], known);
      const account = record['account'];
      if (typeof account !== 'object' || account === null) continue;
      for (let f = 0; f < ACCOUNT_FIELDS.length; f++) addLink((account as Record<string, unknown>)[ACCOUNT_FIELDS[f]!], known);
    }
  }
  return known;
}

type CrashEvent = Extract<TelemetryEvent, { kind: 'crash' }>;

/** What main knows of a diagnostics report (step 33d2): the parts the worker can't read. */
export interface DiagParts {
  /** The TV's clock. */
  at: number;
  /** The TV's offset from UTC in minutes, east positive. */
  zoneMin: number;
  locale: 'en' | 'ar';
  tier: 'low' | 'full';
  /** The device as telemetry's `capability` names it. */
  model: string;
  firmware: string;
  chromium: number | null;
  probes: Record<string, boolean | number>;
  /** Where the config's policy came from. */
  config: 'fresh' | 'cached' | 'none';
}

export interface DiagSendRequest {
  /** `http(s)://host[:port]`, no path (the backup's base). */
  base: string;
  platform: string;
  appVersion: string;
  parts: DiagParts;
  /** The session's last plays, stalls and crashes (main's `recent()`), oldest first; the crashes unscrubbed. */
  events: TelemetryEvent[];
}

export type DiagSendResult =
  /** The API kept it: the code to give support. */
  | { readonly state: 'sent'; readonly code: string }
  /** No connection, the time limit, another status than 201, or an answer without a code. */
  | { readonly state: 'failed'; readonly failure: 'network' | 'timeout' | 'status' | 'answer'; readonly status: number | null };

/** The support code (the protocol's `diagCode`). */
const DIAG_CODE = /^[0-9A-HJKMNP-TV-Z]{6}$/;
/** The most of the answer read: `{"code":"K7M2Q9"}` is 17 bytes. */
export const DIAG_ANSWER_MAX_BYTES = 1024;
/** A failure's code as the schema takes it (`errorCode`); anything else reads `failed`. */
const FAILURE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * A stored source in a report: its type, its catalog's items and how long since it was last checked
 * (`checkedAt`, else `updatedAt`; `null`: never), and a missing login or link (step 32d4's sources
 * restored without them). Never its name, link or server. `null` for a record that isn't a source.
 */
export function diagSource(record: unknown, meta: SourceMeta | null, now: number): DiagSource | null {
  if (typeof record !== 'object' || record === null) return null;
  const source = record as { type?: unknown; account?: unknown; url?: unknown };
  const type = source.type;
  if (type !== 'xtream' && type !== 'm3u' && type !== 'm3u-file') return null;
  let items = 0;
  let checked: number | null = null;
  if (meta !== null) {
    const counts = meta.counts as Record<string, number | undefined>;
    for (const kind in counts) items += counts[kind] ?? 0;
    const at = typeof meta.checkedAt === 'number' ? meta.checkedAt : meta.updatedAt;
    checked = typeof at === 'number' ? at : null;
  }
  const needs = type === 'xtream' && source.account === null ? 'login' : type === 'm3u' && source.url === null ? 'link' : null;
  return { type, items: countBucket(items), checked: checked === null ? null : ageBucket(now - checked), needs };
}

/** A guide in a report: its programmes, its match share, how long since it was last checked, and its last failure's code and status. */
export function diagGuide(meta: EpgMeta, now: number): DiagGuide {
  const summary = meta.summary ?? null;
  const failure = meta.failure ?? null;
  let status: number | null = null;
  if (failure !== null && typeof failure.status === 'number' && failure.status >= 100 && failure.status <= 599) status = failure.status;
  return {
    programmes: countBucket(summary === null ? 0 : summary.programmes),
    matched: summary === null ? '0' : rateBucket(summary.matched, summary.wanted),
    checked: typeof meta.checkedAt === 'number' ? ageBucket(now - meta.checkedAt) : null,
    failure: failure === null ? null : { code: typeof failure.code === 'string' && FAILURE_CODE.exec(failure.code) !== null ? failure.code : 'failed', status },
  };
}

/**
 * The report (the protocol's `diagReportSchema`): main's parts; the stored profile's sources in its
 * order, each with its catalog's record (at most `DIAG_SOURCES_MAX`); the guides in rank order (at
 * most `DIAG_GUIDES_MAX`); the switch; and main's last events (at most `DIAG_EVENTS_MAX`, the
 * newest), each crash scrubbed with the profile's known strings.
 */
export function diagReport(doc: unknown, metas: readonly SourceMeta[], guides: readonly EpgMeta[], request: DiagSendRequest, now: number): DiagReport {
  const list = typeof doc === 'object' && doc !== null ? (doc as { sources?: unknown }).sources : undefined;
  const records: unknown[] = Array.isArray(list) ? list : [];
  const sources: DiagSource[] = [];
  for (let i = 0; i < records.length && sources.length < DIAG_SOURCES_MAX; i++) {
    const record = records[i];
    const id = typeof record === 'object' && record !== null ? (record as { id?: unknown }).id : undefined;
    let meta: SourceMeta | null = null;
    for (let m = 0; m < metas.length; m++) if (metas[m]!.src === id) meta = metas[m]!;
    const source = diagSource(record, meta, now);
    if (source !== null) sources.push(source);
  }
  const ranked = guides.slice().sort((a, b) => a.rank - b.rank);
  const shown: DiagGuide[] = [];
  for (let i = 0; i < ranked.length && i < DIAG_GUIDES_MAX; i++) shown.push(diagGuide(ranked[i]!, now));
  const known = knownStrings(doc);
  const events: TelemetryEvent[] = [];
  for (let i = Math.max(0, request.events.length - DIAG_EVENTS_MAX); i < request.events.length; i++) {
    const event = request.events[i]!;
    events.push(event.kind === 'crash' ? scrubbedCrash(event, known) : event);
  }
  const parts = request.parts;
  return {
    v: 1,
    at: parts.at,
    zoneMin: parts.zoneMin,
    locale: parts.locale,
    tier: parts.tier,
    model: parts.model,
    firmware: parts.firmware,
    chromium: parts.chromium,
    probes: parts.probes,
    telemetry: !telemetryOff(doc),
    config: parts.config,
    sources,
    guides: shown,
    events,
  };
}

/** A crash as it is queued: its stack scrubbed with `known` (a stack that isn't text: `''`), and only the schema's fields. */
export function scrubbedCrash(event: CrashEvent, known: readonly string[]): CrashEvent {
  return { kind: 'crash', at: event.at, where: event.where, stack: typeof event.stack === 'string' ? scrubText(event.stack, known) : '' };
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
      const doc = await storedProfileDoc(db);
      if (telemetryOff(doc)) {
        await transact(db, STORE.kv, 'readwrite', (tx) => {
          const kv = tx.objectStore(STORE.kv);
          kv.delete(TELEMETRY_QUEUE_KEY);
          kv.delete(TELEMETRY_ID_KEY);
          kv.delete(TELEMETRY_CAPABILITY_KEY);
        });
        return { state: 'off' };
      }
      const { id, queue } = await this.enqueue(db, request, knownStrings(doc));
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

  /**
   * The ID (made now if there is none) and the queue with `request`'s kept events, written in one
   * transaction; each crash's stack scrubbed with `known` first.
   */
  private enqueue(db: IDBDatabase, request: TelemetrySendRequest, known: readonly string[]): Promise<{ id: string; queue: TelemetryEvent[] }> {
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
              queue.push(event.kind === 'crash' ? scrubbedCrash(event, known) : event);
            }
            const kept = queue.length > TELEMETRY_QUEUE_MAX ? queue.slice(queue.length - TELEMETRY_QUEUE_MAX) : queue;
            if (queue.length !== before) kv.put(kept, TELEMETRY_QUEUE_KEY);
            done({ id: installId, queue: kept });
          });
        });
      });
    });
  }

  /**
   * The diagnostics report (step 33d2): `request`'s parts with what the database holds (the
   * profile's sources and switch, their catalogs' records, the guides' records), each crash
   * scrubbed, posted to `POST <base>/v1/diag`; the support code it answers.
   */
  async report(request: DiagSendRequest): Promise<DiagSendResult> {
    const db = await this.options.openDb();
    let body: string;
    try {
      const doc = await storedProfileDoc(db);
      const stored = await transact<{ sources: SourceMeta[]; guides: EpgMeta[] }>(db, [STORE.sources, STORE.epgMeta], 'readonly', (tx, done) => {
        onSuccess(tx.objectStore(STORE.sources).getAll(), (sources) => {
          onSuccess(tx.objectStore(STORE.epgMeta).getAll(), (guides) => done({ sources: sources as SourceMeta[], guides: guides as EpgMeta[] }));
        });
      });
      const report = diagReport(doc, stored.sources, stored.guides, request, this.clock.now());
      body = JSON.stringify({ platform: request.platform, appVersion: request.appVersion, report });
    } finally {
      db.close();
    }
    return this.postReport(request.base + '/v1/diag', body);
  }

  /** `POST`s the report: the code of a 201, or why none. An answer after the time limit is let go when it comes. */
  private postReport(url: string, body: string): Promise<DiagSendResult> {
    return new Promise<DiagSendResult>((resolve) => {
      let settled = false;
      let opened: ByteResponse | null = null;
      void this.clock.sleep(TELEMETRY_TIMEOUT_MS).then(() => {
        if (settled) return;
        settled = true;
        if (opened !== null) opened.cancel();
        resolve({ state: 'failed', failure: 'timeout', status: null });
      });
      void this.exchangeReport(url, body, (response) => {
        opened = response;
        if (settled) response.cancel();
      }).then((result) => {
        // (After the time limit this changes nothing: the promise has settled.)
        settled = true;
        resolve(result);
      });
    });
  }

  private async exchangeReport(url: string, body: string, opened: (response: ByteResponse) => void): Promise<DiagSendResult> {
    let response: ByteResponse;
    try {
      response = await this.options.transport.get(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    } catch {
      return { state: 'failed', failure: 'network', status: null };
    }
    opened(response);
    if (response.status !== 201) {
      response.cancel();
      return { state: 'failed', failure: 'status', status: response.status };
    }
    // The answer is ASCII JSON, `{"code":"K7M2Q9"}`: a byte a character, at most `DIAG_ANSWER_MAX_BYTES`.
    let text = '';
    try {
      for (;;) {
        const chunk = await response.read();
        if (chunk === null) break;
        if (text.length + chunk.length > DIAG_ANSWER_MAX_BYTES) {
          response.cancel();
          return { state: 'failed', failure: 'answer', status: 201 };
        }
        for (let i = 0; i < chunk.length; i++) text += String.fromCharCode(chunk[i]!);
      }
    } catch {
      return { state: 'failed', failure: 'network', status: null };
    }
    let code: unknown = null;
    try {
      code = (JSON.parse(text) as { code?: unknown }).code;
    } catch {
      // (Not JSON, or `null`: no code.)
    }
    return typeof code === 'string' && DIAG_CODE.exec(code) !== null ? { state: 'sent', code } : { state: 'failed', failure: 'answer', status: 201 };
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

/** The telemetry worker's RPC methods: `send`, and `report` (step 33d2). */
export function telemetryHandlers(options: TelemetryServiceOptions) {
  const service = new TelemetryService(options);
  return {
    send: (request: TelemetrySendRequest): Promise<TelemetrySendResult> => service.send(request),
    report: (request: DiagSendRequest): Promise<DiagSendResult> => service.report(request),
  };
}
