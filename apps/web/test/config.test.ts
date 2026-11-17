import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fromBase64Url, utf8, verifySignature } from '@lablo/crypto';
import { configDocSchema, configResponseSchema } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import { GET, dynamic } from '../src/app/v1/config/route';
import { COUNTRY_HEADER, CONFIG_CACHE, configAnswer, loadSignedConfig, requestCountry } from '../src/server/config';

/** `GET /v1/config` (RELAY step 30a): the committed signed config and the caller's country. */

const ROOT = path.resolve(import.meta.dirname, '../../..');
const committed = JSON.parse(readFileSync(path.join(ROOT, 'config/config.signed.json'), 'utf8')) as { doc: string; sig: string };
const keys = JSON.parse(readFileSync(path.join(ROOT, 'config/keys.json'), 'utf8')) as { production: string[]; dev: string };

const bytes = (text: string): Uint8Array => {
  const value = fromBase64Url(text);
  if (value === null) throw new Error(`not base64url: ${text}`);
  return value;
};

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3100/v1/config', { headers });
}

describe('requestCountry', () => {
  it('takes two capital letters from the geo header', () => {
    expect(COUNTRY_HEADER).toBe('x-vercel-ip-country');
    expect(requestCountry(new Headers({ [COUNTRY_HEADER]: 'AE' }))).toBe('AE');
    expect(requestCountry(new Headers({ [COUNTRY_HEADER]: 'US' }))).toBe('US');
  });

  it('is null without the header or with anything else in it', () => {
    expect(requestCountry(new Headers())).toBeNull();
    for (const value of ['', 'ae', 'Ae', 'ARE', 'A', 'T1', 'A E', 'AE,US']) {
      expect(requestCountry(new Headers({ [COUNTRY_HEADER]: value })), value).toBeNull();
    }
    expect(requestCountry(new Headers({ 'x-country': 'AE' }))).toBeNull();
  });
});

describe('configAnswer', () => {
  const signed = loadSignedConfig(committed);

  it('serves the signed doc exactly, its signature and the country', async () => {
    const response = configAnswer(signed, new Headers({ [COUNTRY_HEADER]: 'SA' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toStrictEqual({ doc: committed.doc, sig: committed.sig, country: 'SA' });
  });

  it('gives null for an unknown country', async () => {
    expect(await configAnswer(signed, new Headers()).json()).toStrictEqual({ doc: committed.doc, sig: committed.sig, country: null });
  });

  it('may be kept by the caller for 5 minutes, never by a shared cache, and read from any origin', () => {
    const response = configAnswer(signed, new Headers());
    expect(CONFIG_CACHE).toBe('private, max-age=300');
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a broken signed file when the function loads', () => {
    expect(() => loadSignedConfig({ doc: committed.doc })).toThrow();
    expect(() => loadSignedConfig({ doc: committed.doc, sig: 'short' })).toThrow();
    expect(() => loadSignedConfig(null)).toThrow();
    expect(loadSignedConfig({ ...committed, extra: 1 })).toStrictEqual(committed);
  });
});

describe('GET /v1/config', () => {
  it('is built per request', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('answers what the app reads: the schema, a signature from a trusted key, a doc it parses', async () => {
    const response = GET(request({ [COUNTRY_HEADER]: 'CA' }));
    const body = configResponseSchema.parse(await response.json());
    expect(body.country).toBe('CA');
    const trusted = (keys.production.length > 0 ? keys.production : [keys.dev]).map(bytes);
    expect(verifySignature(utf8(body.doc), bytes(body.sig), trusted)).toBe(true);
    expect(configDocSchema.safeParse(JSON.parse(body.doc)).success).toBe(true);
  });

  it('answers the committed file', async () => {
    const body = (await GET(request()).json()) as { doc: string; sig: string; country: null };
    expect(body).toStrictEqual({ ...committed, country: null });
  });
});
