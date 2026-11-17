import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromBase64Url } from '@lablo/crypto';
import { checkConfigResponse, readCachedConfig } from './config-check';
import { configAnswer, configDocFields, configSigner } from './test-support';

const DEV = configSigner();
const OTHER = configSigner('another key');
const KEYS = [DEV.publicKey];
const NOW = 1_500_000;

describe('checkConfigResponse', () => {
  it('takes a good answer: the exact signed text, its signature, the country, the parsed doc', () => {
    const fields = configDocFields({ kill: [{ id: 'k', match: {}, mode: 'notice' }], flags: { a: true } });
    const text = configAnswer(fields);
    const check = checkConfigResponse(text, KEYS, null, NOW);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const answer = JSON.parse(text) as { doc: string; sig: string };
    expect(check.config.cached).toEqual({ doc: answer.doc, sig: answer.sig, country: 'AE', fetchedAt: NOW });
    expect(check.config.doc).toEqual(fields);
  });

  it('keeps an unknown country as null', () => {
    const check = checkConfigResponse(configAnswer(configDocFields(), DEV, null), KEYS, null, NOW);
    expect(check.ok && check.config.cached.country).toBeNull();
  });

  it('refuses what is not JSON', () => {
    for (const text of ['', 'nope', '{"doc":', '<html>']) expect(checkConfigResponse(text, KEYS, null, NOW)).toEqual({ ok: false, refusal: 'not-json' });
    // A byte order mark first is no JSON either (JSON.parse skips only spaces, tabs and line breaks).
    expect(checkConfigResponse(String.fromCharCode(0xfeff) + configAnswer(configDocFields()), KEYS, null, NOW)).toEqual({ ok: false, refusal: 'not-json' });
    const blanks = (...codes: number[]) => String.fromCharCode(...codes);
    expect(checkConfigResponse(blanks(32, 10) + configAnswer(configDocFields()) + blanks(9, 13), KEYS, null, NOW).ok).toBe(true);
  });

  it("refuses an answer of the wrong shape", () => {
    const good = JSON.parse(configAnswer(configDocFields())) as Record<string, unknown>;
    for (const bad of [null, [], 'text', { ...good, sig: 'short' }, { ...good, country: 'ae' }, { doc: good.doc, sig: good.sig }, { ...good, doc: 7 }]) {
      expect(checkConfigResponse(JSON.stringify(bad), KEYS, null, NOW), JSON.stringify(bad)).toEqual({ ok: false, refusal: 'bad-response' });
    }
  });

  it('refuses a signature from a key it does not trust, or over other text', () => {
    expect(checkConfigResponse(configAnswer(configDocFields(), OTHER), KEYS, null, NOW)).toEqual({ ok: false, refusal: 'bad-signature' });
    expect(checkConfigResponse(configAnswer(configDocFields()), [], null, NOW)).toEqual({ ok: false, refusal: 'bad-signature' });
    const answer = JSON.parse(configAnswer(configDocFields())) as { doc: string; sig: string; country: string };
    const changed = { ...answer, doc: answer.doc.replace('"flags":{}', '"flags":{"x":true}') };
    expect(changed.doc).not.toBe(answer.doc);
    expect(checkConfigResponse(JSON.stringify(changed), KEYS, null, NOW)).toEqual({ ok: false, refusal: 'bad-signature' });
    // The same doc with a space added is other bytes.
    expect(checkConfigResponse(JSON.stringify({ ...answer, doc: answer.doc + ' ' }), KEYS, null, NOW)).toEqual({ ok: false, refusal: 'bad-signature' });
  });

  it('takes a signature from either of two trusted keys (rotation)', () => {
    expect(checkConfigResponse(configAnswer(configDocFields(), OTHER), [DEV.publicKey, OTHER.publicKey], null, NOW).ok).toBe(true);
    expect(checkConfigResponse(configAnswer(configDocFields(), DEV), [OTHER.publicKey, DEV.publicKey], null, NOW).ok).toBe(true);
  });

  it('refuses a signed text that is no doc', () => {
    for (const doc of ['not json', '[]', JSON.stringify(configDocFields({ v: 2 })), JSON.stringify(configDocFields({ expiresAt: 1_000_000 })), JSON.stringify(configDocFields({ kill: [{ id: 'k', match: {}, mode: 'explode' }] }))]) {
      expect(checkConfigResponse(configAnswer(doc), KEYS, null, NOW), doc).toEqual({ ok: false, refusal: 'bad-doc' });
    }
  });

  it('refuses an expired doc, and takes one up to its last millisecond', () => {
    const text = configAnswer(configDocFields({ expiresAt: 2_000_000 }));
    expect(checkConfigResponse(text, KEYS, null, 2_000_001)).toEqual({ ok: false, refusal: 'expired' });
    expect(checkConfigResponse(text, KEYS, null, 2_000_000).ok).toBe(true);
  });

  it('takes a doc issued in the future: a TV clock behind refuses nothing', () => {
    expect(checkConfigResponse(configAnswer(configDocFields({ issuedAt: 1_900_000 })), KEYS, null, 0).ok).toBe(true);
  });

  it('refuses a doc older than the cached one, and takes the same age or newer', () => {
    const text = configAnswer(configDocFields({ issuedAt: 1_000_000 }));
    expect(checkConfigResponse(text, KEYS, 1_000_001, NOW)).toEqual({ ok: false, refusal: 'older' });
    expect(checkConfigResponse(text, KEYS, 1_000_000, NOW).ok).toBe(true);
    expect(checkConfigResponse(text, KEYS, 999_999, NOW).ok).toBe(true);
  });

  it('checks in order: the signature before the doc, the doc before its dates', () => {
    expect(checkConfigResponse(configAnswer('not json', OTHER), KEYS, null, NOW)).toEqual({ ok: false, refusal: 'bad-signature' });
    expect(checkConfigResponse(configAnswer(configDocFields({ v: 2, expiresAt: 1_000_001 })), KEYS, null, NOW)).toEqual({ ok: false, refusal: 'bad-doc' });
    expect(checkConfigResponse(configAnswer(configDocFields({ issuedAt: 1_000_000 })), KEYS, 1_200_000, 3_000_000)).toEqual({ ok: false, refusal: 'expired' });
  });

  it("takes the repo's committed signed config with the key it names", () => {
    const signed = JSON.parse(readFileSync(new URL('../../../config/config.signed.json', import.meta.url), 'utf8')) as { doc: string; sig: string };
    const keys = JSON.parse(readFileSync(new URL('../../../config/keys.json', import.meta.url), 'utf8')) as { production: string[]; dev: string };
    const trusted = (keys.production.length > 0 ? keys.production : [keys.dev]).map((k) => fromBase64Url(k)!);
    const doc = JSON.parse(signed.doc) as { issuedAt: number };
    const check = checkConfigResponse(JSON.stringify({ ...signed, country: 'SA' }), trusted, null, doc.issuedAt);
    expect(check.ok).toBe(true);
  });
});

describe('readCachedConfig', () => {
  const cachedOf = (text: string) => {
    const check = checkConfigResponse(text, KEYS, null, NOW);
    if (!check.ok) throw new Error(check.refusal);
    return check.config.cached;
  };

  it('reads back a cached copy that still checks out, expired or not', () => {
    const cached = cachedOf(configAnswer(configDocFields({ expiresAt: 1_600_000 })));
    const read = readCachedConfig(structuredClone(cached), KEYS);
    expect(read?.cached).toEqual(cached);
    expect(read?.doc.expiresAt).toBe(1_600_000);
  });

  it('keeps only the fields it knows', () => {
    const cached = cachedOf(configAnswer(configDocFields()));
    expect(readCachedConfig({ ...cached, extra: 1 }, KEYS)?.cached).toEqual(cached);
  });

  it("drops a copy signed by a key this build doesn't trust (rotated out, or dev after production)", () => {
    const cached = cachedOf(configAnswer(configDocFields()));
    expect(readCachedConfig(cached, [OTHER.publicKey])).toBeNull();
    expect(readCachedConfig(cached, [])).toBeNull();
  });

  it('drops a copy whose text or signature changed', () => {
    const cached = cachedOf(configAnswer(configDocFields()));
    expect(readCachedConfig({ ...cached, doc: cached.doc + ' ' }, KEYS)).toBeNull();
    expect(readCachedConfig({ ...cached, sig: 'x' + cached.sig.slice(1) }, KEYS)).toBeNull();
    expect(readCachedConfig({ ...cached, sig: 'not base64url!' }, KEYS)).toBeNull();
  });

  it('drops a signed text the schema refuses now', () => {
    const doc = JSON.stringify(configDocFields({ v: 2 }));
    expect(readCachedConfig({ doc, sig: DEV.sign(doc), country: null, fetchedAt: 1 }, KEYS)).toBeNull();
    expect(readCachedConfig({ doc: 'nope', sig: DEV.sign('nope'), country: null, fetchedAt: 1 }, KEYS)).toBeNull();
  });

  it('drops what is not a cached copy', () => {
    const cached = cachedOf(configAnswer(configDocFields()));
    const bad: unknown[] = [
      undefined,
      null,
      'text',
      7,
      { ...cached, doc: 1 },
      { ...cached, sig: null },
      { ...cached, country: 'ae' },
      { ...cached, country: 'ARE' },
      { ...cached, country: undefined },
      { ...cached, country: 1 },
      { ...cached, fetchedAt: '1' },
      { ...cached, fetchedAt: NaN },
      { ...cached, fetchedAt: Infinity },
    ];
    for (const record of bad) expect(readCachedConfig(record, KEYS), JSON.stringify(record)).toBeNull();
    expect(readCachedConfig({ ...cached, country: null }, KEYS)?.cached.country).toBeNull();
    expect(readCachedConfig({ ...cached, country: 'SA' }, KEYS)?.cached.country).toBe('SA');
  });
});
