/**
 * The TV's pairing client (architecture.md §3.3 A, RELAY step 31c1): it asks the backend for a
 * code, waits for the phone's sealed payload, opens it and reports what the TV made of it. The
 * pair worker serves it (`pairHandlers`, pair.worker.ts) for as long as the pairing screen shows,
 * so the network, the key, `tweetnacl`'s box and the schemas stay out of the main bundle.
 *
 * - `open(base)`: a fresh X25519 key pair (held here, in memory only), `POST <base>/v1/pair
 *   {tvPk}`; the answer gives the code, the poll token and the session id. Answers the code, the
 *   QR code's link `<base>/p#c=<code>&k=<tvPk>` and its modules, and the address to type.
 * - `poll()`: `GET <base>/v1/pair/s/<sid>` with the poll token. `ready` comes once, with the
 *   payload opened by the secret key and parsed by `pairPayloadSchema`; the key is forgotten then,
 *   and when the payload doesn't open or parse (`unreadable`). The session ends with the code
 *   (410), with its row (404), on a wrong token (401) or a payload read before (409).
 * - `status(category)`: `POST <base>/v1/pair/s/<sid>/status`, once, after `ready`. Then every
 *   trace of the session is forgotten.
 *
 * Each request has `PAIR_TIMEOUT_MS` for its whole answer (Chromium 53 can't abort a fetch: a late
 * answer is cancelled when it comes) and a `PAIR_ANSWER_MAX_BYTES` cap. Bodies are written by
 * hand (base64url and the status names need no escaping), so TV code needs no `JSON.stringify`.
 * Results and errors never hold a URL, the code's link or a token: the app may log them.
 */
import type { QrMatrix } from '@lablo/core';
import { encodeQr, qrFits } from '@lablo/core';
import type { BoxKeyPair, SealedPayload } from '@lablo/crypto';
import { newBoxKeyPair, openPairPayload, toBase64Url } from '@lablo/crypto';
import type { PairPayload, PairStatus } from '@lablo/protocol';
import { PAIR_BODY_MAX_BYTES, PAIR_STATUSES, pairCreateResponseSchema, pairPayloadSchema, pairPollResponseSchema } from '@lablo/protocol';
import type { ByteResponse, ByteTransport } from './bytes';
import { decodeUtf8, tapBytes } from './bytes';
import { PAIR_RETRY_MS, PAIR_TIMEOUT_MS } from './pair-constants';
import type { Clock } from './throttle';
import { REAL_CLOCK } from './throttle';

export { PAIR_POLL_MS, PAIR_RETRY_MS, PAIR_TIMEOUT_MS } from './pair-constants';

/** The largest answer read: the poll's `ready` carries a payload of at most `PAIR_BODY_MAX_BYTES`. */
export const PAIR_ANSWER_MAX_BYTES = PAIR_BODY_MAX_BYTES + 1024;

/** Why a request gave nothing: no connection, the time limit, an unexpected status, 429, a broken or oversized answer. */
export type PairFailure = 'network' | 'timeout' | 'status' | 'rate' | 'malformed' | 'too-large';

/** A code on show. */
export interface PairCode {
  /** The 8 Crockford characters to show. */
  readonly code: string;
  /** The code's end on the server's clock (the TV's may differ: the poll's 410 decides). */
  readonly exp: number;
  /** What the QR code holds: `<base>/p#c=<code>&k=<tvPk>`. */
  readonly link: string;
  /** The address to type on a phone: the base without its scheme, then `/p`. */
  readonly typed: string;
  readonly qr: QrMatrix;
}

export type PairOpenResult = { readonly ok: true; readonly code: PairCode } | { readonly ok: false; readonly failure: PairFailure; readonly retryMs: number | null };

export type PairPollResult =
  /** Nothing sent yet. */
  | { readonly state: 'waiting' }
  /** The phone's payload, opened and parsed. Its session is kept for `status`. */
  | { readonly state: 'ready'; readonly payload: PairPayload }
  /** A payload came but didn't open or parse (not from the phone page): the session is over. */
  | { readonly state: 'unreadable' }
  /** The code ended with nothing sent, the session is gone, or there is none: a new code is needed. */
  | { readonly state: 'ended' }
  /** Too many requests: ask again after `retryMs`. */
  | { readonly state: 'wait'; readonly retryMs: number }
  /** This poll failed (the network, the time limit, the server): the next one may not. */
  | { readonly state: 'failed'; readonly failure: PairFailure };

export type PairStatusResult = { readonly ok: true } | { readonly ok: false; readonly failure: PairFailure };

export interface PairServiceOptions {
  readonly transport: ByteTransport;
  /** The clock for the time limit (default the real one). */
  readonly clock?: Clock;
  /** A new key pair for each code (default `newBoxKeyPair`; the tests pass known ones). */
  readonly keyPair?: () => BoxKeyPair;
}

/** One code's session: its id and poll token, and the secret key until the payload is read. */
interface Session {
  readonly base: string;
  readonly sid: string;
  readonly token: string;
  secretKey: Uint8Array | null;
  /** The payload was read: `status` may go, once. */
  read: boolean;
}

type Answer = { readonly failure: null; readonly status: number; readonly retryAfter: string | null; readonly text: string } | { readonly failure: PairFailure };

const ORIGIN = /^(https?):\/\/[^/?#\s]+$/i;
/** A `Retry-After` in whole seconds (regex `exec`, not `test`: `test` brings a core-js module). */
const SECONDS = /^\d{1,6}$/;

/**
 * Milliseconds from a `Retry-After` in whole seconds (an HTTP date or nonsense: `PAIR_RETRY_MS`).
 * No `trim()`: `fetch`'s `Headers` trims a value's ends already, and `trim` brings a core-js module.
 */
export function retryAfterMs(value: string | null): number {
  if (value === null || SECONDS.exec(value) === null) return PAIR_RETRY_MS;
  return Math.max(1, Number(value)) * 1000;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The opened payload's UTF-8 as JSON, through `pairPayloadSchema`; `null` when it isn't one. */
export function readPayload(bytes: Uint8Array): PairPayload | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const parsed = pairPayloadSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
}

export class PairService {
  private readonly clock: Clock;
  private readonly keyPair: () => BoxKeyPair;
  private session: Session | null = null;

  constructor(private readonly options: PairServiceOptions) {
    this.clock = options.clock ?? REAL_CLOCK;
    this.keyPair = options.keyPair ?? newBoxKeyPair;
  }

  /** A new code, replacing the session before it (whose key is forgotten). */
  async open(base: string): Promise<PairOpenResult> {
    this.close();
    const origin = ORIGIN.exec(base);
    if (origin === null) throw new Error('The pairing base must be an http(s) origin');
    const keys = this.keyPair();
    const tvPk = toBase64Url(keys.publicKey);
    // Before asking for a code: the code is 8 ASCII characters like these, so the link is as long.
    if (!qrFits(base + '/p#c=00000000&k=' + tvPk)) throw new Error('The pairing link is too long for a QR code');
    const answer = await this.request('POST', base + '/v1/pair', '{"tvPk":"' + tvPk + '"}', null);
    if (answer.failure !== null) return { ok: false, failure: answer.failure, retryMs: null };
    if (answer.status === 429) return { ok: false, failure: 'rate', retryMs: retryAfterMs(answer.retryAfter) };
    if (answer.status !== 201) return { ok: false, failure: 'status', retryMs: null };
    const created = pairCreateResponseSchema.safeParse(parseJson(answer.text));
    if (!created.success) return { ok: false, failure: 'malformed', retryMs: null };
    const { sid, code, pollToken, exp } = created.data;
    const link = base + '/p#c=' + code + '&k=' + tvPk;
    const qr = encodeQr(link) as QrMatrix;
    this.session = { base, sid, token: pollToken, secretKey: keys.secretKey, read: false };
    return { ok: true, code: { code, exp, link, typed: base.slice(origin[1]!.length + 3) + '/p', qr } };
  }

  /** Asks whether the phone has sent; `ended` when there is no session waiting. */
  async poll(): Promise<PairPollResult> {
    const session = this.session;
    if (session === null || session.read) return { state: 'ended' };
    const answer = await this.request('GET', session.base + '/v1/pair/s/' + session.sid, null, session.token);
    // A session closed or replaced while the request ran: this answer is not its.
    if (this.session !== session) return { state: 'ended' };
    if (answer.failure !== null) return { state: 'failed', failure: answer.failure };
    if (answer.status === 429) return { state: 'wait', retryMs: retryAfterMs(answer.retryAfter) };
    if (answer.status === 401 || answer.status === 404 || answer.status === 409 || answer.status === 410) {
      this.close();
      return { state: 'ended' };
    }
    if (answer.status !== 200) return { state: 'failed', failure: 'status' };
    const polled = pairPollResponseSchema.safeParse(parseJson(answer.text));
    if (!polled.success) return { state: 'failed', failure: 'malformed' };
    if (polled.data.state === 'waiting') return { state: 'waiting' };
    // The server deleted the payload with this read: whatever happens next, the key is done.
    const opened = openPairPayload(polled.data.payload as SealedPayload, session.secretKey!);
    session.secretKey = null;
    session.read = true;
    const payload = opened === null ? null : readPayload(opened);
    if (payload === null) {
      this.close();
      return { state: 'unreadable' };
    }
    return { state: 'ready', payload };
  }

  /** The TV's category for the payload it read, once; then the session is forgotten either way. */
  async status(status: PairStatus): Promise<PairStatusResult> {
    const session = this.session;
    if (session === null || !session.read) throw new Error('No pairing payload was read');
    if (PAIR_STATUSES.indexOf(status) === -1) throw new Error('Unknown pairing status');
    const answer = await this.request('POST', session.base + '/v1/pair/s/' + session.sid + '/status', '{"status":"' + status + '"}', session.token);
    if (answer.failure !== null) return { ok: false, failure: answer.failure };
    if (answer.status === 429) return { ok: false, failure: 'rate' };
    // Sent, or refused for good (409: sent before; 404: the row is gone): nothing to send again.
    if (answer.status === 200 || answer.status === 409 || answer.status === 404 || answer.status === 401) {
      if (this.session === session) this.close();
      return answer.status === 200 ? { ok: true } : { ok: false, failure: 'status' };
    }
    return { ok: false, failure: 'status' };
  }

  /** The secret key is held: a code is open and nothing was read from it yet (the tests look). */
  hasKey(): boolean {
    return this.session !== null && this.session.secretKey !== null;
  }

  /** Forgets the session: its key, id and token. */
  close(): void {
    const session = this.session;
    if (session === null) return;
    session.secretKey = null;
    this.session = null;
  }

  /** The answer's status and text within `PAIR_TIMEOUT_MS`. */
  private request(method: 'GET' | 'POST', url: string, body: string | null, token: string | null): Promise<Answer> {
    const headers: Record<string, string> = {};
    if (body !== null) headers['content-type'] = 'application/json';
    if (token !== null) headers['authorization'] = 'Bearer ' + token;
    return new Promise<Answer>((resolve) => {
      let settled = false;
      let response: ByteResponse | null = null;
      void this.clock.sleep(PAIR_TIMEOUT_MS).then(() => {
        if (settled) return;
        settled = true;
        if (response !== null) response.cancel();
        resolve({ failure: 'timeout' });
      });
      void this.read(method, url, headers, body, (r) => {
        response = r;
        if (settled) r.cancel();
      }).then((answer) => {
        // After the time limit this changes nothing: the promise has settled.
        settled = true;
        resolve(answer);
      });
    });
  }

  private async read(method: 'GET' | 'POST', url: string, headers: Record<string, string>, body: string | null, opened: (response: ByteResponse) => void): Promise<Answer> {
    let response: ByteResponse;
    try {
      response = await this.options.transport.get(url, body === null ? { method, headers } : { method, headers, body });
    } catch {
      return { failure: 'network' };
    }
    opened(response);
    let bytes = 0;
    let tooLarge = false;
    const text = decodeUtf8(
      tapBytes(response, (chunk) => {
        bytes += chunk.length;
        if (bytes > PAIR_ANSWER_MAX_BYTES) {
          tooLarge = true;
          throw new Error('The pairing answer is too large');
        }
      }),
    );
    let out = '';
    try {
      for (;;) {
        const piece = await text.read();
        if (piece === null) return { failure: null, status: response.status, retryAfter: response.header('retry-after'), text: out };
        out += piece;
      }
    } catch {
      text.cancel();
      return { failure: tooLarge ? 'too-large' : 'network' };
    }
  }
}

/** The pair worker's RPC methods (pair.worker.ts): one `PairService` for the worker's life. */
export function pairHandlers(options: PairServiceOptions) {
  const service = new PairService(options);
  return {
    open: (req: { base: string }): Promise<PairOpenResult> => service.open(req.base),
    poll: (): Promise<PairPollResult> => service.poll(),
    status: (req: { status: PairStatus }): Promise<PairStatusResult> => service.status(req.status),
    close: (): void => service.close(),
  };
}
