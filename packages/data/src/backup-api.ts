/**
 * The backup API as the TV calls it (architecture.md §3.2, RELAY step 32c1): `GET`, `PUT` and
 * `DELETE` on `<base>/v1/backup/<lookupId>`, the write token in `X-Write-Token`.
 *
 * - Each request has `BACKUP_TIMEOUT_MS` for its whole answer. Chromium 53 can't abort a fetch: a
 *   late answer is cancelled when it comes.
 * - Only a `GET` that answers 200 has its body read, capped at `BACKUP_ANSWER_MAX_BYTES`; every
 *   other answer is told by its status alone.
 * - The `PUT`'s body is written by hand: the envelope's fields are base64url and constants, so
 *   nothing needs escaping, and TV code needs no `JSON.stringify` for it.
 * - Answers and failures never hold a URL, a lookup ID or a token: the app may log them.
 */
import type { BackupEnvelope } from '@lablo/crypto';
import { BACKUP_BODY_MAX_BYTES, BACKUP_WRITE_HEADER } from '@lablo/protocol/backup-limits';
import type { ByteResponse, ByteTransport } from './bytes';
import type { Clock } from './throttle';

/** How long one request may take, its whole answer read. */
export const BACKUP_TIMEOUT_MS = 20_000;

/** The largest answer read: an envelope of at most `BACKUP_BODY_MAX_BYTES`, and a little room. */
export const BACKUP_ANSWER_MAX_BYTES = BACKUP_BODY_MAX_BYTES + 1024;

/** What a request gave: its status (and a 200 `GET`'s text), or why nothing. */
export type BackupAnswer =
  | { readonly failure: null; readonly status: number; readonly text: string | null }
  /** No connection, the time limit, or an answer past `BACKUP_ANSWER_MAX_BYTES`. */
  | { readonly failure: 'network' | 'timeout' | 'too-large' };

/** The envelope as the API's body: `{"v":1,"kdf":…,"nonce":…,"ct":…}`. */
export function envelopeBody(envelope: BackupEnvelope): string {
  return '{"v":' + envelope.v + ',"kdf":"' + envelope.kdf + '","nonce":"' + envelope.nonce + '","ct":"' + envelope.ct + '"}';
}

/** An answer's text as an envelope's four fields (`openBackup` checks them), or `null`. */
export function readEnvelope(text: string | null): BackupEnvelope | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  // (A number, a string or an array has none of the fields.)
  if (parsed === null) return null;
  const { v, kdf, nonce, ct } = parsed as Record<string, unknown>;
  if (v !== 1 || typeof kdf !== 'string' || typeof nonce !== 'string' || typeof ct !== 'string') return null;
  return { v: 1, kdf: kdf as BackupEnvelope['kdf'], nonce, ct };
}

export class BackupApi {
  constructor(
    private readonly transport: ByteTransport,
    private readonly clock: Clock,
  ) {}

  /** `GET`: the stored envelope's text with 200 when `read`, the status alone otherwise. */
  get(base: string, lookupId: string, read: boolean): Promise<BackupAnswer> {
    return this.send('GET', base, lookupId, null, null, read);
  }

  /** `PUT` of `envelope` with the write token. */
  put(base: string, lookupId: string, token: string, envelope: BackupEnvelope): Promise<BackupAnswer> {
    return this.send('PUT', base, lookupId, token, envelopeBody(envelope), false);
  }

  /** `DELETE` with the write token. */
  remove(base: string, lookupId: string, token: string): Promise<BackupAnswer> {
    return this.send('DELETE', base, lookupId, token, null, false);
  }

  private send(method: 'GET' | 'PUT' | 'DELETE', base: string, lookupId: string, token: string | null, body: string | null, read: boolean): Promise<BackupAnswer> {
    const headers: Record<string, string> = {};
    if (body !== null) headers['content-type'] = 'application/json';
    if (token !== null) headers[BACKUP_WRITE_HEADER] = token;
    const url = base + '/v1/backup/' + lookupId;
    return new Promise<BackupAnswer>((resolve) => {
      let settled = false;
      let response: ByteResponse | null = null;
      void this.clock.sleep(BACKUP_TIMEOUT_MS).then(() => {
        if (settled) return;
        settled = true;
        if (response !== null) response.cancel();
        resolve({ failure: 'timeout' });
      });
      void this.exchange(method, url, headers, body, read, (opened) => {
        response = opened;
        if (settled) opened.cancel();
      }).then((answer) => {
        // After the time limit this changes nothing: the promise has settled.
        settled = true;
        resolve(answer);
      });
    });
  }

  private async exchange(
    method: 'GET' | 'PUT' | 'DELETE',
    url: string,
    headers: Record<string, string>,
    body: string | null,
    read: boolean,
    opened: (response: ByteResponse) => void,
  ): Promise<BackupAnswer> {
    let response: ByteResponse;
    try {
      response = await this.transport.get(url, body === null ? { method, headers } : { method, headers, body });
    } catch {
      return { failure: 'network' };
    }
    opened(response);
    const status = response.status;
    if (!read || status !== 200) {
      response.cancel();
      return { failure: null, status, text: null };
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await response.read();
        if (chunk === null) break;
        length += chunk.length;
        if (length > BACKUP_ANSWER_MAX_BYTES) {
          response.cancel();
          return { failure: 'too-large' };
        }
        chunks.push(chunk);
      }
    } catch {
      return { failure: 'network' };
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (let i = 0; i < chunks.length; i++) {
      bytes.set(chunks[i]!, at);
      at += chunks[i]!.length;
    }
    return { failure: null, status, text: new TextDecoder('utf-8').decode(bytes) };
  }
}
