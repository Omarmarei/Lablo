/**
 * The plumbing every Xtream call shares (RELAY step 9c split it out of xtream.ts): tolerant
 * values, the text transport, the error, and reading a small JSON answer. Pure, like xtream.ts.
 *
 * Panels disagree on types: numbers come as numbers or numeric strings, `null` as `""`, flags as
 * `1`/`"1"`/`true`. These readers accept all of them. Errors carry a code and an HTTP status
 * only, never the URL (it holds the credentials).
 */

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** A string field: strings trimmed, numbers and booleans written out, anything else `''`. */
export function xText(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return '';
}

/** A number field: numbers, or numeric strings (`"7.5"`, `" 12 "`, `"7,5"`); otherwise `null`. */
export function xNumber(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const text = v.trim().replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  return Number(text);
}

/** An integer field (`"12"`, `12`, `"12.0"`); otherwise `null`. */
export function xInt(v: unknown): number | null {
  const n = xNumber(v);
  return n !== null && Math.floor(n) === n && Number.isSafeInteger(n) ? n : null;
}

/** A flag: `true`, `1`, `"1"`, `"true"`, `"yes"`. */
export function xFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (typeof v !== 'string') return false;
  const text = v.trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

/**
 * A panel id as key text: a non-negative integer, or a string without whitespace or colons
 * (what `xtreamKey` accepts). `123` and `"123"` give the same text, so keys survive panels
 * switching types. `null` when unusable.
 */
export function xId(v: unknown): string | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  if (typeof v !== 'string') return null;
  const text = v.trim();
  return /^[^\s:]{1,64}$/.test(text) ? text : null;
}

/** A positive integer field; otherwise `null`. */
export function positiveInt(v: unknown): number | null {
  const n = xInt(v);
  return n !== null && n > 0 ? n : null;
}

/** A response being read: decoded text chunks in order (`null` at the end). */
export interface TextResponse {
  status: number;
  read(): Promise<string | null>;
  /** Stops reading and releases the connection. Safe to call more than once. */
  cancel(): void;
}

/**
 * GET over HTTP, decoded to text (UTF-8, gzip handled). The data layer implements it with
 * fetch + TextDecoder or XHR; tests use the mock provider.
 */
export interface TextTransport {
  get(url: string): Promise<TextResponse>;
}

export type XtreamErrorCode = 'http' | 'auth' | 'format';

/** A failed Xtream call. The message never holds the URL or credentials. */
export class XtreamError extends Error {
  constructor(
    readonly code: XtreamErrorCode,
    readonly status: number | null = null,
  ) {
    super(`Xtream ${code} error${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'XtreamError';
  }
}

/** Largest non-list body read whole (in UTF-16 code units). */
const MAX_BODY = 16 * 1024 * 1024;

/** GETs `url`; a status outside 2xx cancels the body and throws (`auth` for 401 and 403). */
export async function xtreamOpen(transport: TextTransport, url: string): Promise<TextResponse> {
  const res = await transport.get(url);
  if (res.status >= 200 && res.status < 300) return res;
  res.cancel();
  throw new XtreamError(res.status === 401 || res.status === 403 ? 'auth' : 'http', res.status);
}

/** A small JSON answer read whole. Throws `XtreamError('format')` when it isn't JSON. */
export async function xtreamJson(transport: TextTransport, url: string): Promise<unknown> {
  const res = await xtreamOpen(transport, url);
  let text = '';
  await readAll(res, (chunk) => {
    text += chunk;
    if (text.length > MAX_BODY) throw new XtreamError('format');
  });
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch {
    throw new XtreamError('format');
  }
}

/** Reads a response to its end, cancelling it if the consumer throws. */
export async function readAll(res: TextResponse, consume: (chunk: string) => void | Promise<void>): Promise<void> {
  try {
    for (;;) {
      const chunk = await res.read();
      if (chunk === null) return;
      await consume(chunk);
    }
  } catch (error) {
    res.cancel();
    throw error;
  }
}
