import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  DAY_MS,
  DEFAULT_DAYS,
  DEV_SEED_LABEL,
  MAX_DAYS,
  MAX_PRODUCTION_KEYS,
  SEED_PREFIX,
  blockHosts,
  devPublicKey,
  devSeed,
  docProblems,
  expiryProblem,
  formatSeed,
  parseKeys,
  parseSeed,
  publicKeyOf,
  signConfig,
  stampDoc,
  strippedPaths,
  trustedKeys,
  unblockHosts,
  verifyConfig,
  type Keys,
} from './config';

/** The signer's pure side (RELAY step 30a), checked against Node's own crypto where it can be. */

const NOW = Date.UTC(2026, 10, 17, 8, 0, 0);
const SALT = 'test-salt-0123456789abcdef';

/** Node's answer for an Ed25519 seed's public key (OpenSSL, not tweetnacl). */
function nodePublicKey(seed: Uint8Array): string {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(seed)]);
  const jwk = createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'jwk' });
  return jwk.x as string;
}

function nodeVerifies(text: string, sig: string, publicKey: string): boolean {
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64url')]);
  return nodeVerify(null, Buffer.from(text, 'utf8'), createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(sig, 'base64url'));
}

const nodeHash = (salt: string, host: string): string => createHash('sha256').update(salt + host, 'utf8').digest('base64url');

const seedOf = (byte: number): Uint8Array => new Uint8Array(32).fill(byte);
const PROD_A = seedOf(1);
const PROD_B = seedOf(2);
const DEV_KEYS: Keys = { production: [], dev: devPublicKey() };
const PROD_KEYS: Keys = { production: [publicKeyOf(PROD_A), publicKeyOf(PROD_B)], dev: devPublicKey() };

function source(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, minVersion: {}, kill: [], blocklist: { salt: SALT, hashes: [] }, flags: {}, tunables: {}, ...over };
}

function problemsOf(work: () => unknown): readonly string[] {
  try {
    work();
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error('no ConfigError');
}

describe('the keys', () => {
  it('derives the dev key from its public label', () => {
    expect(DEV_SEED_LABEL).toBe('lablo.config.dev-key.v1');
    expect(Buffer.from(devSeed()).toString('hex')).toBe(createHash('sha256').update('lablo.config.dev-key.v1').digest('hex'));
    expect(devPublicKey()).toBe(nodePublicKey(devSeed()));
    expect(publicKeyOf(PROD_A)).toBe(nodePublicKey(PROD_A));
  });

  it('writes and reads seed files', () => {
    const text = formatSeed(PROD_A);
    expect(text).toBe(`${SEED_PREFIX}${Buffer.from(PROD_A).toString('base64url')}\n`);
    expect(SEED_PREFIX).toBe('lablo-config-seed-v1:');
    expect(parseSeed(text)).toStrictEqual(PROD_A);
    expect(parseSeed(`  ${text.trim()}\r\n\r\n`)).toStrictEqual(PROD_A);
    expect(problemsOf(() => formatSeed(new Uint8Array(31)))).toStrictEqual(['a seed is 32 bytes, not 31']);
  });

  it('refuses what is not a seed file', () => {
    const b64 = (bytes: number): string => Buffer.alloc(bytes, 7).toString('base64url');
    expect(problemsOf(() => parseSeed(b64(32)))).toStrictEqual([`not a seed file: it must start with ${SEED_PREFIX}`]);
    expect(problemsOf(() => parseSeed(`${SEED_PREFIX}${b64(32)}=`))).toStrictEqual(['not a seed file: the seed is not base64url']);
    expect(problemsOf(() => parseSeed(`${SEED_PREFIX}${b64(31)}`))).toStrictEqual(['not a seed file: the seed is 31 bytes, not 32']);
    expect(problemsOf(() => parseSeed(`${SEED_PREFIX}${b64(33)}`))).toStrictEqual(['not a seed file: the seed is 33 bytes, not 32']);
  });

  it('reads keys.json', () => {
    expect(parseKeys({ production: [], dev: devPublicKey() })).toStrictEqual(DEV_KEYS);
    expect(parseKeys({ production: [...PROD_KEYS.production], dev: devPublicKey() })).toStrictEqual(PROD_KEYS);
    expect(MAX_PRODUCTION_KEYS).toBe(2);
  });

  it('refuses a wrong keys.json, naming every problem', () => {
    const a = publicKeyOf(PROD_A);
    expect(problemsOf(() => parseKeys([]))).toStrictEqual(['keys.json must be an object']);
    expect(problemsOf(() => parseKeys(null))).toStrictEqual(['keys.json must be an object']);
    expect(problemsOf(() => parseKeys({ production: [], dev: devPublicKey(), next: [] }))).toStrictEqual(['keys.json: unknown field next']);
    expect(problemsOf(() => parseKeys({ production: a, dev: devPublicKey() }))).toStrictEqual(['keys.json: production must be a list']);
    expect(problemsOf(() => parseKeys({ production: [a, publicKeyOf(PROD_B), publicKeyOf(seedOf(3))], dev: devPublicKey() }))).toStrictEqual([
      'keys.json: at most 2 production keys',
    ]);
    expect(problemsOf(() => parseKeys({ production: [a, a], dev: devPublicKey() }))).toStrictEqual(['keys.json: a production key is listed twice']);
    expect(problemsOf(() => parseKeys({ production: [devPublicKey()], dev: devPublicKey() }))).toStrictEqual(['keys.json: production[0] is the dev key']);
    expect(problemsOf(() => parseKeys({ production: [], dev: a }))).toStrictEqual([`keys.json: dev must be the dev key ${devPublicKey()}`]);
    expect(problemsOf(() => parseKeys({ production: [] }))).toStrictEqual([`keys.json: dev must be the dev key ${devPublicKey()}`]);
    // Not keys: too short, not base64url, a non-zero unused bit (43 characters hold 258 bits), a number.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const unusedBit = `${a.slice(0, 42)}${alphabet[alphabet.indexOf(a[42]!) | 1]!}`;
    expect(Buffer.from(unusedBit, 'base64url').toString('base64url')).not.toBe(unusedBit);
    const long = Buffer.alloc(33, 5).toString('base64url');
    expect(long).toHaveLength(44);
    for (const bad of [a.slice(1), long, `${a.slice(0, 42)}+`, unusedBit, 7]) {
      expect(problemsOf(() => parseKeys({ production: [bad], dev: devPublicKey() }))).toStrictEqual(['keys.json: production[0] is not a 32-byte base64url key']);
    }
    expect(problemsOf(() => parseKeys({ production: ['x', 'y', 'z'], dev: 'w' }))).toStrictEqual([
      'keys.json: at most 2 production keys',
      'keys.json: production[0] is not a 32-byte base64url key',
      'keys.json: production[1] is not a 32-byte base64url key',
      'keys.json: production[2] is not a 32-byte base64url key',
      `keys.json: dev must be the dev key ${devPublicKey()}`,
    ]);
  });

  it('trusts the production keys, or the dev key while there are none', () => {
    expect(trustedKeys(DEV_KEYS)).toStrictEqual([devPublicKey()]);
    expect(trustedKeys(PROD_KEYS)).toStrictEqual(PROD_KEYS.production);
  });
});

describe('dating the doc', () => {
  it('puts v, then the dates, then the rest in order', () => {
    const doc = stampDoc(source(), NOW, 30);
    expect(Object.keys(doc)).toStrictEqual(['v', 'issuedAt', 'expiresAt', 'minVersion', 'kill', 'blocklist', 'flags', 'tunables']);
    expect(doc).toMatchObject({ v: 1, issuedAt: NOW, expiresAt: NOW + 30 * DAY_MS });
    expect(DAY_MS).toBe(86_400_000);
    expect(stampDoc(source(), NOW, 1).expiresAt).toBe(NOW + DAY_MS);
    expect(stampDoc(source(), NOW, MAX_DAYS).expiresAt).toBe(NOW + 400 * DAY_MS);
    expect([DEFAULT_DAYS, MAX_DAYS]).toStrictEqual([180, 400]);
  });

  it('refuses dates in the source, a wrong number of days, a wrong time, a source that is not an object', () => {
    expect(problemsOf(() => stampDoc(source({ issuedAt: NOW }), NOW, 30))).toStrictEqual(['config.json: leave out issuedAt and expiresAt (signing sets them)']);
    expect(problemsOf(() => stampDoc(source({ expiresAt: NOW }), NOW, 30))).toStrictEqual(['config.json: leave out issuedAt and expiresAt (signing sets them)']);
    for (const days of [0, -1, MAX_DAYS + 1, 1.5, Number.NaN]) {
      expect(problemsOf(() => stampDoc(source(), NOW, days))).toStrictEqual(['days must be a whole number from 1 to 400']);
    }
    for (const now of [-1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(problemsOf(() => stampDoc(source(), now, 30))).toStrictEqual(['the time must be epoch milliseconds']);
    }
    expect(stampDoc(source(), 0, 30).issuedAt).toBe(0);
    for (const bad of [null, [], 'config', 1]) expect(problemsOf(() => stampDoc(bad, NOW, 30))).toStrictEqual(['config.json must be an object']);
  });
});

describe('checking the doc', () => {
  it('finds the fields parsing would strip', () => {
    expect(strippedPaths({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 2 } })).toStrictEqual(['b.d']);
    expect(strippedPaths({ list: [{ x: 1 }, { x: 1, y: 2 }] }, { list: [{ x: 1 }, { x: 1 }] })).toStrictEqual(['list[1].y']);
    expect(strippedPaths({ a: 1, z: 2 }, { a: 1 })).toStrictEqual(['z']);
    expect(strippedPaths({ a: { b: 1 } }, { a: { b: 1 } })).toStrictEqual([]);
    expect(strippedPaths('x', 'x')).toStrictEqual([]);
  });

  it('passes a good doc', () => {
    const doc = stampDoc(
      source({
        minVersion: { webos: '1.2.0' },
        kill: [{ id: 'gcc-notice', match: { countries: ['AE', 'SA'] }, mode: 'notice', message: { en: 'Hello', ar: 'مرحبا' } }],
        blocklist: { salt: SALT, hashes: [nodeHash(SALT, 'a.example'), nodeHash(SALT, 'b.example')].sort() },
        flags: { newGuide: true },
        tunables: { liveBufferSeconds: 4 },
      }),
      NOW,
      30,
    );
    expect(docProblems(doc)).toStrictEqual([]);
  });

  it("names the schema's issues by path", () => {
    expect(docProblems(stampDoc(source({ kill: [{ id: 'Bad Id', match: {}, mode: 'notice' }] }), NOW, 30))).toStrictEqual([
      expect.stringMatching(/^kill\.0\.id: /),
    ]);
    expect(docProblems(stampDoc(source({ v: 2 }), NOW, 30))).toStrictEqual([expect.stringMatching(/^v: /)]);
    expect(docProblems('nope')).toStrictEqual([expect.stringMatching(/^\(doc\): /)]);
  });

  it('refuses fields the schema would strip (typos)', () => {
    expect(docProblems(stampDoc(source({ blocklists: [] }), NOW, 30))).toStrictEqual(['blocklists: not a field of the config (a typo?)']);
    expect(docProblems(stampDoc(source({ kill: [{ id: 'k', match: { platfrom: 'webos' }, mode: 'notice' }] }), NOW, 30))).toStrictEqual([
      'kill[0].match.platfrom: not a field of the config (a typo?)',
    ]);
  });

  it('wants the blocklist sorted and unique', () => {
    const [a, b] = [nodeHash(SALT, 'a.example'), nodeHash(SALT, 'b.example')].sort();
    const message = 'blocklist.hashes: must be sorted and unique (pnpm sign-config block keeps them so)';
    expect(docProblems(stampDoc(source({ blocklist: { salt: SALT, hashes: [b, a] } }), NOW, 30))).toStrictEqual([message]);
    expect(docProblems(stampDoc(source({ blocklist: { salt: SALT, hashes: [a, a] } }), NOW, 30))).toStrictEqual([message]);
    expect(docProblems(stampDoc(source({ blocklist: { salt: SALT, hashes: [a, b, a] } }), NOW, 30))).toStrictEqual([message]);
    expect(docProblems(stampDoc(source({ blocklist: { salt: SALT, hashes: [a] } }), NOW, 30))).toStrictEqual([]);
  });
});

describe('signing and verifying', () => {
  it("signs the dated doc's exact text, as OpenSSL verifies it", () => {
    const signed = signConfig(source(), PROD_A, NOW, 30);
    expect(signed.doc).toBe(JSON.stringify(stampDoc(source(), NOW, 30)));
    expect(nodeVerifies(signed.doc, signed.sig, publicKeyOf(PROD_A))).toBe(true);
    expect(nodeVerifies(signed.doc, signed.sig, publicKeyOf(PROD_B))).toBe(false);
  });

  it('refuses to sign a bad doc', () => {
    expect(problemsOf(() => signConfig(source({ extra: 1 }), PROD_A, NOW, 30))).toStrictEqual(['extra: not a field of the config (a typo?)']);
    expect(problemsOf(() => signConfig(source({ issuedAt: 1 }), PROD_A, NOW, 30))).toHaveLength(1);
  });

  it('verifies a dev signature while there are no production keys', () => {
    const verified = verifyConfig(signConfig(source(), devSeed(), NOW, 30), source(), DEV_KEYS);
    expect(verified.signedBy).toBe('dev');
    expect(verified.doc).toMatchObject({ v: 1, issuedAt: NOW, expiresAt: NOW + 30 * DAY_MS });
  });

  it('verifies a signature from either production key', () => {
    expect(verifyConfig(signConfig(source(), PROD_A, NOW, 30), source(), PROD_KEYS).signedBy).toBe('production');
    expect(verifyConfig(signConfig(source(), PROD_B, NOW, 30), source(), PROD_KEYS).signedBy).toBe('production');
  });

  it('refuses a dev signature once production keys exist', () => {
    expect(problemsOf(() => verifyConfig(signConfig(source(), devSeed(), NOW, 30), source(), PROD_KEYS))).toStrictEqual([
      'config.signed.json: signed with the dev key, but production keys exist: sign it with a production key',
    ]);
  });

  it('refuses a signature from another key', () => {
    expect(problemsOf(() => verifyConfig(signConfig(source(), seedOf(9), NOW, 30), source(), PROD_KEYS))).toStrictEqual([
      'config.signed.json: the signature is not from a trusted key (the production keys)',
    ]);
    expect(problemsOf(() => verifyConfig(signConfig(source(), PROD_A, NOW, 30), source(), DEV_KEYS))).toStrictEqual([
      'config.signed.json: the signature is not from a trusted key (the dev key)',
    ]);
  });

  it('refuses a changed doc or signature', () => {
    const signed = signConfig(source(), PROD_A, NOW, 30);
    const changedDoc = { ...signed, doc: signed.doc.replace(`"issuedAt":${NOW}`, `"issuedAt":${NOW + 1}`) };
    expect(changedDoc.doc).not.toBe(signed.doc);
    expect(problemsOf(() => verifyConfig(changedDoc, source(), PROD_KEYS))).toStrictEqual([
      'config.signed.json: the signature is not from a trusted key (the production keys)',
    ]);
    const sig = Buffer.from(signed.sig, 'base64url');
    sig[10] = sig[10]! ^ 1;
    expect(problemsOf(() => verifyConfig({ ...signed, sig: sig.toString('base64url') }, source(), PROD_KEYS))).toHaveLength(1);
  });

  it('refuses a signed file of the wrong shape', () => {
    const signed = signConfig(source(), PROD_A, NOW, 30);
    expect(problemsOf(() => verifyConfig({ doc: signed.doc }, source(), PROD_KEYS))).toStrictEqual([expect.stringMatching(/^config\.signed\.json sig: /)]);
    expect(problemsOf(() => verifyConfig(null, source(), PROD_KEYS))).toStrictEqual([expect.stringMatching(/^config\.signed\.json \(file\): /)]);
  });

  it('refuses a validly signed text that is not a good doc', () => {
    // Any text signed with a production key, as a careless tool might sign it.
    const signText = (text: string): { doc: string; sig: string } => {
      const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(PROD_A)]);
      const key = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
      return { doc: text, sig: nodeSign(null, Buffer.from(text, 'utf8'), key).toString('base64url') };
    };
    expect(problemsOf(() => verifyConfig(signText('{"v":1,'), source(), PROD_KEYS))).toStrictEqual(['config.signed.json: the doc is not JSON']);
    expect(problemsOf(() => verifyConfig(signText('{"v":1}'), source(), PROD_KEYS)).length).toBeGreaterThan(0);
    const unsorted = JSON.stringify(stampDoc(source({ blocklist: { salt: SALT, hashes: [nodeHash(SALT, 'b'), nodeHash(SALT, 'a')].sort().reverse() } }), NOW, 30));
    expect(problemsOf(() => verifyConfig(signText(unsorted), source(), PROD_KEYS))).toStrictEqual([
      'blocklist.hashes: must be sorted and unique (pnpm sign-config block keeps them so)',
    ]);
  });

  it('refuses a signed doc that is not config.json (edited and not signed again)', () => {
    const signed = signConfig(source(), PROD_A, NOW, 30);
    expect(problemsOf(() => verifyConfig(signed, source({ flags: { x: true } }), PROD_KEYS))).toStrictEqual([
      'config.signed.json: its doc is not config.json: run pnpm sign-config sign',
    ]);
    // Key order doesn't matter, values do.
    const reordered = { tunables: {}, flags: {}, blocklist: { hashes: [], salt: SALT }, kill: [], minVersion: {}, v: 1 };
    expect(verifyConfig(signed, reordered, PROD_KEYS).signedBy).toBe('production');
  });

  it('says when a doc has expired', () => {
    const { doc } = verifyConfig(signConfig(source(), PROD_A, NOW, 30), source(), PROD_KEYS);
    expect(expiryProblem(doc, NOW)).toBeNull();
    expect(expiryProblem(doc, doc.expiresAt - 1)).toBeNull();
    expect(expiryProblem(doc, doc.expiresAt)).toBe(`the config expired on ${new Date(doc.expiresAt).toISOString()}: sign it again`);
    expect(expiryProblem(doc, doc.expiresAt + DAY_MS)).not.toBeNull();
  });
});

describe('the blocklist', () => {
  it("adds the normalised hosts' hashes, sorted and unique", () => {
    const change = blockHosts(source(), ['TV.Example.com.', 'b.example', 'tv.example.com']);
    expect(change.changed).toStrictEqual(['tv.example.com', 'b.example']);
    expect(change.unchanged).toStrictEqual([]);
    expect(change.source.blocklist).toStrictEqual({ salt: SALT, hashes: [nodeHash(SALT, 'tv.example.com'), nodeHash(SALT, 'b.example')].sort() });
    // The rest of the source is kept as it was.
    expect({ ...change.source, blocklist: null }).toStrictEqual({ ...source(), blocklist: null });
  });

  it('reports hosts already blocked and keeps one hash each', () => {
    const once = blockHosts(source(), ['a.example']);
    const twice = blockHosts(once.source, ['A.example', 'c.example']);
    expect(twice.changed).toStrictEqual(['c.example']);
    expect(twice.unchanged).toStrictEqual(['a.example']);
    expect((twice.source.blocklist as { hashes: string[] }).hashes).toStrictEqual([nodeHash(SALT, 'a.example'), nodeHash(SALT, 'c.example')].sort());
  });

  it('keeps an existing list sorted when adding to it', () => {
    let current: unknown = source();
    for (const host of ['z.example', 'm.example', 'a.example', 'q.example']) current = blockHosts(current, [host]).source;
    const hashes = ((current as Record<string, unknown>).blocklist as { hashes: string[] }).hashes;
    expect(hashes).toStrictEqual([...hashes].sort());
    expect(hashes).toHaveLength(4);
    expect(docProblems(stampDoc(current, NOW, 30))).toStrictEqual([]);
  });

  it('takes hosts out', () => {
    const blocked = blockHosts(source(), ['a.example', 'b.example']).source;
    const change = unblockHosts(blocked, ['A.EXAMPLE', 'c.example']);
    expect(change.changed).toStrictEqual(['a.example']);
    expect(change.unchanged).toStrictEqual(['c.example']);
    expect(change.source.blocklist).toStrictEqual({ salt: SALT, hashes: [nodeHash(SALT, 'b.example')] });
  });

  it('refuses what is not a host, naming each, and changes nothing', () => {
    expect(problemsOf(() => blockHosts(source(), ['ok.example', 'http://x.example/', 'مثال.example']))).toStrictEqual([
      'not a host: "http://x.example/" (give the bare host, xn-- for a non-ASCII name)',
      'not a host: "مثال.example" (give the bare host, xn-- for a non-ASCII name)',
    ]);
    expect(problemsOf(() => unblockHosts(source(), ['x.example:80']))).toHaveLength(1);
  });

  it('refuses a source without a blocklist', () => {
    for (const bad of [source({ blocklist: undefined }), source({ blocklist: { salt: SALT } }), source({ blocklist: { hashes: [] } }), null]) {
      expect(problemsOf(() => blockHosts(bad, ['a.example']))).toStrictEqual(['config.json: blocklist must be {salt, hashes}']);
    }
  });
});
