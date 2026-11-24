/**
 * How a refresh fails, shared by the catalog ingest (ingest.ts) and the EPG refresh
 * (epg-ingest.ts). A module of its own so the EPG worker doesn't bundle the catalog ingest.
 */

import { XtreamError } from '@lablo/core';
import { NetworkError } from './bytes';
import { GenerationError } from './catalog-store';
import { GzipError } from './gunzip';
import type { CancelToken } from './rpc';
import { CancelError } from './rpc';
import { isQuotaError } from './storage-room';

/**
 * - `auth`: the login was refused (an Xtream panel's `auth: 0`, or HTTP 401/403).
 * - `expired`, `blocked`: an Xtream panel accepted the login but says the account is expired, or
 *   banned or disabled (`user_info.status`), and serves it nothing (step 13b).
 * - `http`: another status outside 2xx (`status` holds it). `network`: no answer, or a cut one.
 * - `format`: not a playlist or panel answer. `empty`: nothing usable in it.
 * - `file`: the M3U file sent from the phone didn't open (a frame cut, changed or out of place, or
 *   bytes past its last frame), or no file came with the job (RELAY step 31d2a).
 * - `superseded`: another refresh of the same source took over.
 * - `storage`: Lablo's storage on the TV is full, even after the room the refresh may make
 *   (storage-room.ts, RELAY step 39s1).
 */
export type IngestErrorCode = 'http' | 'auth' | 'expired' | 'blocked' | 'network' | 'format' | 'empty' | 'file' | 'superseded' | 'storage';

/** A refresh that failed; the active generation is unchanged. Never holds a URL. */
export class IngestError extends Error {
  constructor(
    readonly code: IngestErrorCode,
    readonly status: number | null = null,
    message?: string,
  ) {
    super(message ?? `Catalog refresh failed: ${code}${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'IngestError';
  }
}

/** A numeric header such as `Content-Length` (`null`: absent or not a number). */
export function headerNumber(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** The error a failed refresh (catalog or EPG) rejects with. */
export function ingestError(error: unknown, token: CancelToken): Error {
  if (error instanceof CancelError) return error;
  if (token.cancelled) return new CancelError();
  if (error instanceof IngestError) return error;
  if (error instanceof XtreamError) return new IngestError(error.code, error.status);
  if (error instanceof NetworkError) return new IngestError('network', null, error.message);
  if (error instanceof GzipError) return new IngestError('format', null, error.message);
  if (error instanceof GenerationError) return new IngestError('superseded', null, 'Another refresh of this source took over');
  if (isQuotaError(error)) return new IngestError('storage', null, 'The storage is full');
  return error instanceof Error ? error : new Error(String(error));
}
