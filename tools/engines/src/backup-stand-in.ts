/**
 * A stand-in for apps/web's backup API (RELAY step 32a's routes) over HTTP, in memory (step 32c2):
 * the e2e's config server and the old-engine walk's pair server answer `/v1/backup/:lookupId`
 * through it, on the origin the TV takes from `?api=`, so the app's look-up and upload meet the
 * same rules as against `next start`:
 * - `GET` needs no token: the stored envelope as JSON, or 404;
 * - the first `PUT` claims the lookup ID for its `X-Write-Token` (the stand-in keeps
 *   `tokenHash(token)`, never the token); a later `PUT` or a `DELETE` with another token, none, or
 *   a malformed one is 401 and changes nothing;
 * - a body over `BACKUP_BODY_MAX_BYTES` is 413, one that isn't an envelope 400;
 * - a malformed lookup ID, or a `DELETE` of nothing, is 404;
 * - the TV's CORS: any origin, an `OPTIONS` preflight for `content-type` and `x-write-token`.
 *
 * The test reads what happened (`requests`, `blobs`), puts a backup in (`blobs`), and can hold
 * the next `GET`s until it lets them go (`holdGets`), to see "Looking for your backup" while it
 * waits. (`@lablo/data`'s `backupStandIn` is the same API at the transport, for the unit tests and
 * the vectors page; this package doesn't depend on `@lablo/data`.)
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tokenHash } from '@lablo/crypto';
import { BACKUP_BODY_MAX_BYTES, BACKUP_WRITE_HEADER, backupEnvelopeSchema, lookupIdSchema, writeTokenSchema } from '@lablo/protocol';
import type { StandInAnswer } from './pair-stand-in';

/** Where the backup routes start. */
export const BACKUP_PATH = '/v1/backup/';

/** A request the stand-in answered (no token: only whether one came). */
export interface BackupStandInRequest {
  readonly method: string;
  readonly lookupId: string;
  readonly token: boolean;
  readonly status: number;
}

const TV_CORS: Readonly<Record<string, string>> = { 'access-control-allow-origin': '*' };
const PREFLIGHT: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
  'access-control-allow-headers': `content-type, ${BACKUP_WRITE_HEADER}`,
  'access-control-max-age': '600',
};

function json(status: number, text: string): StandInAnswer {
  return { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...TV_CORS }, body: text };
}

/** Whether `url` (a request's path and query) is one of the backup routes. */
export function backupPath(url: string): boolean {
  return url.split('?')[0]!.startsWith(BACKUP_PATH);
}

export class BackupStandIn {
  /** The stored envelopes' JSON, by lookup ID. */
  readonly blobs = new Map<string, string>();
  /** The claimed lookup IDs' token hashes. */
  readonly hashes = new Map<string, string>();
  /** Every request but the preflights, in order. */
  readonly requests: BackupStandInRequest[] = [];
  private gate: Promise<void> | null = null;
  private waiting = 0;

  /** Holds every `GET` from now until the returned function is called. */
  holdGets(): () => void {
    let release: () => void = () => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.gate = null;
      release();
    };
  }

  /** `GET`s waiting at the hold now. */
  held(): number {
    return this.waiting;
  }

  /** The answer to one request on a backup path (`token`: the `X-Write-Token` header). */
  async answer(method: string, url: string, token: string | undefined, body: Uint8Array): Promise<StandInAnswer> {
    if (method === 'OPTIONS') return { status: 204, headers: PREFLIGHT, body: '' };
    const lookupId = url.split('?')[0]!.slice(BACKUP_PATH.length);
    if (method === 'GET' && this.gate !== null) {
      this.waiting += 1;
      await this.gate;
      this.waiting -= 1;
    }
    const [status, text] = this.handle(method, lookupId, token, body);
    this.requests.push({ method, lookupId, token: token !== undefined, status });
    return json(status, text);
  }

  private handle(method: string, lookupId: string, token: string | undefined, body: Uint8Array): [number, string] {
    if (!lookupIdSchema.safeParse(lookupId).success) return [404, '{"error":"not_found"}'];
    if (method === 'GET') {
      const stored = this.blobs.get(lookupId);
      return stored === undefined ? [404, '{"error":"not_found"}'] : [200, stored];
    }
    if (method !== 'PUT' && method !== 'DELETE') return [405, '{"error":"method"}'];
    const hash = token !== undefined && writeTokenSchema.safeParse(token).success ? tokenHash(token) : null;
    const kept = this.hashes.get(lookupId);
    if (method === 'DELETE') {
      if (kept === undefined) return [404, '{"error":"not_found"}'];
      if (hash !== kept) return [401, '{"error":"unauthorized"}'];
      this.blobs.delete(lookupId);
      this.hashes.delete(lookupId);
      return [200, '{"state":"deleted"}'];
    }
    if (hash === null || (kept !== undefined && kept !== hash)) return [401, '{"error":"unauthorized"}'];
    if (body.length > BACKUP_BODY_MAX_BYTES) return [413, '{"error":"too_large"}'];
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return [400, '{"error":"invalid"}'];
    }
    const envelope = backupEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) return [400, '{"error":"invalid"}'];
    const { v, kdf, nonce, ct } = envelope.data;
    this.hashes.set(lookupId, hash);
    this.blobs.set(lookupId, JSON.stringify({ v, kdf, nonce, ct }));
    return [200, '{"state":"stored"}'];
  }
}

/** Answers one backup request from `standIn` once its body is in. */
export function answerBackup(standIn: BackupStandIn, request: IncomingMessage, response: ServerResponse): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const header = request.headers[BACKUP_WRITE_HEADER];
    const token = typeof header === 'string' ? header : undefined;
    void standIn.answer(request.method ?? 'GET', request.url ?? '', token, new Uint8Array(Buffer.concat(chunks))).then((answer) => {
      response.writeHead(answer.status, answer.headers);
      response.end(answer.body);
    });
  });
}
