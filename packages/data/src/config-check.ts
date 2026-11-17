/**
 * Checking a signed config on the TV (architecture.md §3.3 C, RELAY step 30b1): what
 * `GET /v1/config` answered, or the copy the TV cached, against the public keys this build
 * embeds.
 *
 * - **An answer** is taken only when it is `configResponseSchema`'s shape, its signature is good
 *   for one of the keys, the signed text is a doc `configDocSchema` accepts, it hasn't expired
 *   (`now > expiresAt` refuses it: an old signed doc replayed), and it isn't older (`issuedAt`)
 *   than the cached copy. A TV clock running behind refuses nothing: an `issuedAt` in the TV's
 *   future is fine.
 * - **The cached copy** is checked again when it is read, against this build's keys (a key
 *   rotated out, or a dev-signed copy once a build trusts only production keys, is dropped), but
 *   never for its age: an expired cached doc stays in force until a newer one replaces it, so a
 *   kill rule can't lapse while the TV is offline.
 */
import { fromBase64Url, utf8, verifySignature } from '@lablo/crypto';
import type { ConfigDoc } from '@lablo/protocol';
import { configDocSchema, configResponseSchema } from '@lablo/protocol';

/** Why an answer wasn't taken. */
export type ConfigRefusal = 'not-json' | 'bad-response' | 'bad-signature' | 'bad-doc' | 'expired' | 'older';

/** The copy the TV keeps (IndexedDB `kv`, key `config`). */
export interface CachedConfig {
  /** The doc's exact signed text. */
  doc: string;
  /** Its Ed25519 signature, base64url. */
  sig: string;
  /** The country the answer carried (unsigned: it only picks rules), `null` when unknown. */
  country: string | null;
  /** When the TV fetched it (the TV's clock, ms). */
  fetchedAt: number;
}

/** A copy that checked out, with its parsed doc. */
export interface VerifiedConfig {
  cached: CachedConfig;
  doc: ConfigDoc;
}

export type ConfigCheck = { ok: true; config: VerifiedConfig } | { ok: false; refusal: ConfigRefusal };

/** The text's JSON value, `undefined` when it isn't JSON (no JSON text gives `undefined`). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The doc of a signed text, or why not: the signature against `keys`, then the doc's JSON and schema. */
function signedDoc(doc: string, sig: string, keys: readonly Uint8Array[]): ConfigDoc | 'bad-signature' | 'bad-doc' {
  const signature = fromBase64Url(sig);
  if (signature === null || !verifySignature(utf8(doc), signature, keys)) return 'bad-signature';
  const parsed = configDocSchema.safeParse(parseJson(doc));
  return parsed.success ? parsed.data : 'bad-doc';
}

/**
 * Checks the text of a `GET /v1/config` answer. `cachedIssuedAt` is the cached copy's `issuedAt`
 * (`null` when there is none); `now` is the TV's clock.
 */
export function checkConfigResponse(text: string, keys: readonly Uint8Array[], cachedIssuedAt: number | null, now: number): ConfigCheck {
  const json = parseJson(text);
  if (json === undefined) return { ok: false, refusal: 'not-json' };
  const response = configResponseSchema.safeParse(json);
  if (!response.success) return { ok: false, refusal: 'bad-response' };
  const doc = signedDoc(response.data.doc, response.data.sig, keys);
  if (typeof doc === 'string') return { ok: false, refusal: doc };
  if (now > doc.expiresAt) return { ok: false, refusal: 'expired' };
  if (cachedIssuedAt !== null && doc.issuedAt < cachedIssuedAt) return { ok: false, refusal: 'older' };
  return {
    ok: true,
    config: { cached: { doc: response.data.doc, sig: response.data.sig, country: response.data.country, fetchedAt: now }, doc },
  };
}

function isCachedConfig(value: unknown): value is CachedConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.doc === 'string' &&
    typeof v.sig === 'string' &&
    (v.country === null || (typeof v.country === 'string' && /^[A-Z]{2}$/.test(v.country))) &&
    typeof v.fetchedAt === 'number' &&
    isFinite(v.fetchedAt)
  );
}

/**
 * The cached copy as read from IndexedDB, checked against this build's keys (but not for its
 * age), or `null` when there is none or it no longer checks out.
 */
export function readCachedConfig(record: unknown, keys: readonly Uint8Array[]): VerifiedConfig | null {
  if (!isCachedConfig(record)) return null;
  const doc = signedDoc(record.doc, record.sig, keys);
  if (typeof doc === 'string') return null;
  return { cached: { doc: record.doc, sig: record.sig, country: record.country, fetchedAt: record.fetchedAt }, doc };
}
