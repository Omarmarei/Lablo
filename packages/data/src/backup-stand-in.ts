/**
 * The backup API in memory (RELAY step 32c1), with the rules of apps/web's `backup.ts` (step 32a)
 * that the TV meets:
 * - `GET /v1/backup/<lookupId>` needs no token: the stored envelope, or 404;
 * - the first `PUT` claims the lookup ID for its write token (the stand-in keeps
 *   `tokenHash(token)`, never the token); a later `PUT` or a `DELETE` with another token, none, or
 *   a malformed one is 401, and changes nothing;
 * - a body over `BACKUP_BODY_MAX_BYTES` is 413, one that isn't an envelope 400;
 * - a malformed lookup ID, or a `DELETE` of nothing, is 404.
 *
 * For the unit tests and the old engines' vectors page (`@lablo/data/check-backup`, where no server
 * runs); never in the app.
 */
import { tokenHash } from '@lablo/crypto';
import { BACKUP_BODY_MAX_BYTES, BACKUP_WRITE_HEADER } from '@lablo/protocol/backup-limits';
import { readEnvelope } from './backup-api';
import type { ByteRequest, ByteResponse, ByteTransport } from './bytes';

/** A request the stand-in answered. */
export interface StandInRequest {
  readonly method: string;
  readonly lookupId: string;
  /** The `X-Write-Token` sent (`null`: none). */
  readonly token: string | null;
  readonly status: number;
}

export interface BackupStandIn {
  /** A `ByteTransport` that answers the backup routes (any origin). */
  readonly transport: ByteTransport;
  /** The stored envelopes' JSON, by lookup ID. */
  readonly blobs: Map<string, string>;
  /** The claimed lookup IDs' token hashes. */
  readonly hashes: Map<string, string>;
  /** Every request, in order. */
  readonly requests: StandInRequest[];
}

const PATH = '/v1/backup/';
/** 32 bytes of base64url (the API's `lookupIdSchema`). */
const LOOKUP_ID = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

function answer(status: number, text: string): ByteResponse {
  let done = false;
  return {
    status,
    header: () => null,
    read() {
      if (done) return Promise.resolve(null);
      done = true;
      return Promise.resolve(new TextEncoder().encode(text));
    },
    cancel() {
      done = true;
    },
  };
}

export function backupStandIn(): BackupStandIn {
  const blobs = new Map<string, string>();
  const hashes = new Map<string, string>();
  const requests: StandInRequest[] = [];

  const handle = (method: string, lookupId: string, token: string | null, body: string | undefined): [number, string] => {
    if (LOOKUP_ID.exec(lookupId) === null) return [404, '{"error":"not_found"}'];
    if (method === 'GET') {
      const stored = blobs.get(lookupId);
      return stored === undefined ? [404, '{"error":"not_found"}'] : [200, stored];
    }
    const hash = token === null ? null : tokenHash(token);
    if (method === 'DELETE') {
      const kept = hashes.get(lookupId);
      if (kept === undefined) return [404, '{"error":"not_found"}'];
      if (hash !== kept) return [401, '{"error":"unauthorized"}'];
      blobs.delete(lookupId);
      hashes.delete(lookupId);
      return [200, '{"state":"deleted"}'];
    }
    if (method !== 'PUT') return [405, '{"error":"method"}'];
    if (hash === null) return [401, '{"error":"unauthorized"}'];
    const kept = hashes.get(lookupId);
    if (kept !== undefined && kept !== hash) return [401, '{"error":"unauthorized"}'];
    const text = body ?? '';
    if (new TextEncoder().encode(text).length > BACKUP_BODY_MAX_BYTES) return [413, '{"error":"too_large"}'];
    const envelope = readEnvelope(text);
    if (envelope === null) return [400, '{"error":"invalid"}'];
    hashes.set(lookupId, hash);
    blobs.set(lookupId, '{"v":1,"kdf":"' + envelope.kdf + '","nonce":"' + envelope.nonce + '","ct":"' + envelope.ct + '"}');
    return [200, '{"state":"stored"}'];
  };

  const transport: ByteTransport = {
    get(url: string, request: ByteRequest = {}): Promise<ByteResponse> {
      const at = url.indexOf(PATH);
      const method = request.method ?? 'GET';
      const headers = request.headers ?? {};
      const token = headers[BACKUP_WRITE_HEADER] ?? null;
      const lookupId = at === -1 ? '' : url.slice(at + PATH.length);
      const [status, text] = handle(method, lookupId, token, request.body);
      requests.push({ method, lookupId, token, status });
      return Promise.resolve(answer(status, text));
    },
  };
  return { transport, blobs, hashes, requests };
}
