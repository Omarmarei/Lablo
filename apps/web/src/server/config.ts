/**
 * `GET /v1/config` (architecture.md §3.2 and §3.3 C, RELAY step 30a): the signed config as
 * committed (`config/config.signed.json`, bundled into the function at build time) and the
 * caller's country from Vercel's geo header. The doc's text goes out exactly as it was signed:
 * the app checks the signature over these characters, then parses them.
 *
 * The country isn't signed: it only picks which kill rules apply, and it comes over HTTPS.
 */
import type { ConfigResponse, SignedConfig } from '@lablo/protocol';
import { country, signedConfigSchema } from '@lablo/protocol';

/** Vercel's header with the caller's ISO 3166 alpha-2 country. */
export const COUNTRY_HEADER = 'x-vercel-ip-country';

/**
 * Each TV may keep the answer 5 minutes; no shared cache keeps it, since the answer carries the
 * caller's country. The doc is in the function, so an answer costs only the call.
 */
export const CONFIG_CACHE = 'private, max-age=300';

/** The caller's country when the header holds one (two capital letters), else null. */
export function requestCountry(headers: Headers): string | null {
  const value = headers.get(COUNTRY_HEADER);
  return value !== null && country.safeParse(value).success ? value : null;
}

/** The committed signed file, checked when the function loads. */
export function loadSignedConfig(raw: unknown): SignedConfig {
  return signedConfigSchema.parse(raw);
}

export function configAnswer(signed: SignedConfig, headers: Headers): Response {
  const body: ConfigResponse = { doc: signed.doc, sig: signed.sig, country: requestCountry(headers) };
  return Response.json(body, {
    headers: {
      'cache-control': CONFIG_CACHE,
      // A public document, read without credentials: the desktop dev app (another origin) may read it.
      'access-control-allow-origin': '*',
    },
  });
}
