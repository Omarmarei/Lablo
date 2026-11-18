/**
 * What the `/v1` routes share (RELAY step 31a): JSON answers that no cache keeps, bodies read
 * with a byte cap before they are parsed, the bearer token, the caller's address for the rate
 * limiter, and the CORS answers of the routes the TV calls.
 */
/** The error codes an answer's `{error}` can hold; the HTTP status says the rest. */
export type ApiError =
  | 'bad_request'
  | 'too_large'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'expired'
  | 'rate_limited'
  | 'unavailable';

/** A JSON answer with `cache-control: no-store` (and any extra headers). */
export function json(body: unknown, status = 200, headers?: Readonly<Record<string, string>>): Response {
  const all = new Headers(headers);
  all.set('cache-control', 'no-store');
  return Response.json(body, { status, headers: all });
}

export function apiError(status: number, error: ApiError, headers?: Readonly<Record<string, string>>): Response {
  return json({ error }, status, headers);
}

export type BodyResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly response: Response };

/**
 * The body's bytes, or null past `maxBytes` (by its `content-length`, or while it is read: a body
 * without one stops at the cap). No body is no bytes.
 */
export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) return null;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** The body as UTF-8 JSON, refused with 413 past `maxBytes` (`readBytes`) and 400 when it isn't JSON. */
export async function readJsonBody(request: Request, maxBytes: number, headers?: Readonly<Record<string, string>>): Promise<BodyResult<unknown>> {
  const bytes = await readBytes(request, maxBytes);
  if (bytes === null) return { ok: false, response: apiError(413, 'too_large', headers) };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { ok: false, response: apiError(400, 'bad_request', headers) };
  }
}

/** What `readBody` needs of a schema: zod's `safeParse` (the protocol's schemas). */
export interface BodySchema<T> {
  safeParse(value: unknown): { readonly success: true; readonly data: T } | { readonly success: false };
}

/** The body parsed by `schema`: 413 or 400 as `readJsonBody`, and 400 when the schema refuses it. */
export async function readBody<T>(
  request: Request,
  maxBytes: number,
  schema: BodySchema<T>,
  headers?: Readonly<Record<string, string>>,
): Promise<BodyResult<T>> {
  const body = await readJsonBody(request, maxBytes, headers);
  if (!body.ok) return body;
  const parsed = schema.safeParse(body.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, response: apiError(400, 'bad_request', headers) };
}

/** The token of an `Authorization: Bearer <token>` header, or null (`Headers` trims the value). */
export function bearerToken(headers: Headers): string | null {
  const value = headers.get('authorization');
  if (value === null) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{1,128})$/i.exec(value);
  return match === null ? null : match[1]!;
}

/**
 * The caller's address, for the rate limiter only (it keys on an HMAC of it, never the address):
 * Vercel's `x-forwarded-for` (its edge sets it; Next's own server sets it from the socket), its
 * first entry; else `x-real-ip`; else `unknown`, which all such callers share.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded === null ? '' : forwarded.split(',')[0]!.trim();
  if (first !== '') return first;
  const real = headers.get('x-real-ip')?.trim() ?? '';
  return real === '' ? 'unknown' : real;
}

/**
 * The routes the TV calls answer any origin: a packaged TV app's page is `file://` (`Origin:
 * null`) or the platform's own scheme, and its requests carry no cookies. The phone's routes are
 * same-origin (its page is ours) and send no CORS headers, so another site's page can't read them.
 */
export const TV_CORS: Readonly<Record<string, string>> = { 'access-control-allow-origin': '*' };

/** How long a browser may keep a preflight's answer. */
export const PREFLIGHT_MAX_AGE_S = 600;

/**
 * The answer to a TV route's `OPTIONS` preflight: its methods, and the request headers it takes
 * (`authorization` and `content-type` unless the route names its own).
 */
export function preflight(methods: string, headers = 'authorization, content-type'): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...TV_CORS,
      'access-control-allow-methods': `${methods}, OPTIONS`,
      'access-control-allow-headers': headers,
      'access-control-max-age': String(PREFLIGHT_MAX_AGE_S),
      'cache-control': 'no-store',
    },
  });
}
