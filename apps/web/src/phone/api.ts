/**
 * The phone page's requests (RELAY steps 31b and 31d1), all to the page's own origin: relative
 * `/v1/pair/` paths, no redirects followed, no referrer, nothing cached; and the encrypted file's
 * upload, to the presigned URL the server gave (a `/dev/blob/` path on this origin in development
 * and tests; R2's https URL in production, whose host step 34 adds to the page's `connect-src`).
 * This is the one `apps/web` file allowed `fetch` (eslint.config.js, "the phone page's requests");
 * the page's `Content-Security-Policy` (`connect-src 'self'`) holds the browser to the same origin.
 *
 * Every answer is read with the protocol's schema; anything unexpected counts as no answer.
 */
import type { SealedPayload } from '@lablo/crypto';
import type { PairProgressResponse, PairTvKeyResponse, PairUploadResponse } from '@lablo/protocol';
import { pairCode, pairProgressResponseSchema, pairTvKeyResponseSchema, pairUploadResponseSchema, presignedUrlSchema } from '@lablo/protocol';

/** What went wrong: the code is unknown or ended (404), already used (409), too many tries (429), or no usable answer. */
export type ApiFailure =
  | { readonly ok: false; readonly error: 'gone' | 'conflict' | 'network' }
  | { readonly ok: false; readonly error: 'limited'; readonly retryAfterS: number };

export type ApiResult<T> = { readonly ok: true; readonly value: T } | ApiFailure;

export interface PhoneApi {
  /** `GET /v1/pair/:code`: the TV's public key, for a typed code. */
  tvKey(code: string): Promise<ApiResult<PairTvKeyResponse>>;
  /** `POST /v1/pair/:code/payload`: the sealed payload, once. */
  send(code: string, sealed: SealedPayload): Promise<ApiResult<PairProgressResponse>>;
  /** `GET /v1/pair/:code/status`: how far the payload got. */
  progress(code: string): Promise<ApiResult<PairProgressResponse>>;
  /** `POST /v1/pair/:code/upload-url`: a presigned PUT of the encrypted file's exact `size`, before the payload. */
  uploadUrl(code: string, size: number): Promise<ApiResult<PairUploadResponse>>;
  /** The encrypted file, PUT to `uploadUrl`'s URL. Any answer but a 2xx is `network`: sending again asks for a new URL. */
  upload(url: string, body: Blob): Promise<ApiResult<null>>;
}

/** `fetch`, narrowed to what the page uses: a relative path on its own origin, or the upload's presigned URL. */
export type Fetcher = (path: string, init: RequestInit) => Promise<Response>;

/** When a 429 carries no usable `Retry-After`: the limiter's window. */
export const DEFAULT_RETRY_AFTER_S = 600;

interface Schema<T> {
  safeParse(value: unknown): { readonly success: true; readonly data: T } | { readonly success: false };
}

/** `Retry-After` in whole seconds (at least 1). */
export function retryAfterSeconds(header: string | null): number {
  const seconds = Number(header);
  return header === null || header.trim() === '' || !Number.isFinite(seconds) || seconds < 0 ? DEFAULT_RETRY_AFTER_S : Math.max(1, Math.ceil(seconds));
}

/** The path for a code: only a well-formed code reaches a URL. */
function codePath(code: string, rest = ''): string {
  if (!pairCode.safeParse(code).success) throw new RangeError('a pairing code is 8 Crockford characters');
  return `/v1/pair/${code}${rest}`;
}

/** What every request of the page sets: nothing cached, no cookies, no redirect followed, no referrer. */
const PRIVATE: RequestInit = { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' };

export function createApi(fetcher: Fetcher = (path, init) => fetch(path, init)): PhoneApi {
  async function call<T>(path: string, schema: Schema<T>, body?: SealedPayload | { readonly size: number }): Promise<ApiResult<T>> {
    const init: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      ...PRIVATE,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    };
    let response: Response;
    try {
      response = await fetcher(path, init);
    } catch {
      return { ok: false, error: 'network' };
    }
    if (response.status === 404) return { ok: false, error: 'gone' };
    if (response.status === 409) return { ok: false, error: 'conflict' };
    if (response.status === 429) return { ok: false, error: 'limited', retryAfterS: retryAfterSeconds(response.headers.get('retry-after')) };
    if (!response.ok) return { ok: false, error: 'network' };
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: 'network' };
    }
    const parsed = schema.safeParse(json);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'network' };
  }

  async function put(url: string, body: Blob): Promise<ApiResult<null>> {
    try {
      const response = await fetcher(url, { method: 'PUT', ...PRIVATE, body });
      return response.ok ? { ok: true, value: null } : { ok: false, error: 'network' };
    } catch {
      return { ok: false, error: 'network' };
    }
  }

  return {
    tvKey: (code) => call(codePath(code), pairTvKeyResponseSchema),
    send: (code, sealed) => call(codePath(code, '/payload'), pairProgressResponseSchema, sealed),
    progress: (code) => call(codePath(code, '/status'), pairProgressResponseSchema),
    uploadUrl: (code, size) => call(codePath(code, '/upload-url'), pairUploadResponseSchema, { size }),
    upload: (url, body) => {
      // Only a URL the upload answer's schema takes: never anything else the page could be handed.
      if (!presignedUrlSchema.safeParse(url).success) throw new RangeError('not a presigned upload URL');
      return put(url, body);
    },
  };
}
