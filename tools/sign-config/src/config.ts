/**
 * The signed config's offline side (architecture.md §3.3 C, RELAY step 30a): the doc's dates,
 * its checks, its Ed25519 signature, the trusted keys and the blocklist's hashes. Pure
 * functions; `cli.ts` reads and writes the files.
 *
 *   config/config.json         the doc without its dates (people edit this one)
 *   config/config.signed.json  {doc, sig}: the dated doc's exact text and its signature
 *   config/keys.json           {production: [...], dev}: the public keys the apps trust
 */
import { isDeepStrictEqual } from 'node:util';
import { blocklistHost } from '@lablo/core';
import { blocklistHash, fromBase64Url, sha256, signDetached, signKeyPairFromSeed, toBase64Url, utf8, verifySignature } from '@lablo/crypto';
import type { ConfigDoc, SignedConfig } from '@lablo/protocol';
import { configDocSchema, signedConfigSchema } from '@lablo/protocol';

export const DAY_MS = 86_400_000;
/** How long a signature holds by default, and at most. */
export const DEFAULT_DAYS = 180;
export const MAX_DAYS = 400;
/** The production keys the apps embed: the current one and the next (rotation). */
export const MAX_PRODUCTION_KEYS = 2;

/** A seed file's one line: this prefix, then the 32-byte seed in base64url. */
export const SEED_PREFIX = 'lablo-config-seed-v1:';
/**
 * The dev key's seed is SHA-256 of this label: public on purpose. Dev and test builds trust its
 * public key; a store build never does (step 30b), and `verify` refuses a dev signature once
 * production keys exist.
 */
export const DEV_SEED_LABEL = 'lablo.config.dev-key.v1';

/** A refusal with every problem found, one per line. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'ConfigError';
  }
}

export function devSeed(): Uint8Array {
  return sha256(utf8(DEV_SEED_LABEL));
}

/** A seed's public key, base64url. */
export function publicKeyOf(seed: Uint8Array): string {
  return toBase64Url(signKeyPairFromSeed(seed).publicKey);
}

export function devPublicKey(): string {
  return publicKeyOf(devSeed());
}

export function formatSeed(seed: Uint8Array): string {
  if (seed.length !== 32) throw new ConfigError([`a seed is 32 bytes, not ${seed.length}`]);
  return `${SEED_PREFIX}${toBase64Url(seed)}\n`;
}

/** The seed in a seed file (its one line; spaces and line ends around it are ignored). */
export function parseSeed(text: string): Uint8Array {
  const line = text.trim();
  if (!line.startsWith(SEED_PREFIX)) throw new ConfigError([`not a seed file: it must start with ${SEED_PREFIX}`]);
  const seed = fromBase64Url(line.slice(SEED_PREFIX.length));
  if (seed === null) throw new ConfigError(['not a seed file: the seed is not base64url']);
  if (seed.length !== 32) throw new ConfigError([`not a seed file: the seed is ${seed.length} bytes, not 32`]);
  return seed;
}

export interface Keys {
  /** The production public keys, base64url; empty until the key ceremony (step 34). */
  readonly production: readonly string[];
  /** The dev key's public key, base64url (always `devPublicKey()`). */
  readonly dev: string;
}

const KEY_TEXT = /^[A-Za-z0-9_-]{43}$/;

function isKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_TEXT.test(value) && fromBase64Url(value) !== null;
}

/** The bytes of a base64url value already checked by a schema or `parseKeys`. */
function bytesOf(text: string): Uint8Array {
  const bytes = fromBase64Url(text);
  if (bytes === null) throw new ConfigError([`not base64url: ${text}`]);
  return bytes;
}

/** `config/keys.json`, checked. */
export function parseKeys(raw: unknown): Keys {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ConfigError(['keys.json must be an object']);
  const { production, dev, ...rest } = raw as Record<string, unknown>;
  for (const name of Object.keys(rest)) problems.push(`keys.json: unknown field ${name}`);
  if (!Array.isArray(production)) problems.push('keys.json: production must be a list');
  else {
    if (production.length > MAX_PRODUCTION_KEYS) problems.push(`keys.json: at most ${MAX_PRODUCTION_KEYS} production keys`);
    production.forEach((key, i) => {
      if (!isKey(key)) problems.push(`keys.json: production[${i}] is not a 32-byte base64url key`);
      else if (key === devPublicKey()) problems.push(`keys.json: production[${i}] is the dev key`);
    });
    if (new Set(production).size !== production.length) problems.push('keys.json: a production key is listed twice');
  }
  if (dev !== devPublicKey()) problems.push(`keys.json: dev must be the dev key ${devPublicKey()}`);
  if (problems.length > 0) throw new ConfigError(problems);
  return { production: production as string[], dev: dev as string };
}

/** The keys a signature must come from: the production keys, or the dev key while there are none. */
export function trustedKeys(keys: Keys): readonly string[] {
  return keys.production.length > 0 ? keys.production : [keys.dev];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The doc to sign: `v`, then the dates, then the source's other fields in its order. */
export function stampDoc(source: unknown, now: number, days: number): Record<string, unknown> {
  if (!isObject(source)) throw new ConfigError(['config.json must be an object']);
  const problems: string[] = [];
  if ('issuedAt' in source || 'expiresAt' in source) problems.push('config.json: leave out issuedAt and expiresAt (signing sets them)');
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) problems.push(`days must be a whole number from 1 to ${MAX_DAYS}`);
  if (!Number.isSafeInteger(now) || now < 0) problems.push('the time must be epoch milliseconds');
  if (problems.length > 0) throw new ConfigError(problems);
  const { v, ...rest } = source;
  return { v, issuedAt: now, expiresAt: now + days * DAY_MS, ...rest };
}

/** The paths of fields `input` has and the parsed `output` doesn't: what parsing stripped. */
export function strippedPaths(input: unknown, output: unknown, path = ''): string[] {
  if (Array.isArray(input) && Array.isArray(output)) {
    return input.flatMap((item, i) => strippedPaths(item, output[i], `${path}[${i}]`));
  }
  if (!isObject(input) || !isObject(output)) return [];
  return Object.keys(input).flatMap((key) => {
    const at = path === '' ? key : `${path}.${key}`;
    return key in output ? strippedPaths(input[key], output[key], at) : [at];
  });
}

/** Every problem with a dated doc: the schema's issues, fields it would strip, the blocklist's order. */
export function docProblems(doc: unknown): string[] {
  const parsed = configDocSchema.safeParse(doc);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `${issue.path.map(String).join('.') || '(doc)'}: ${issue.message}`);
  }
  const problems = strippedPaths(doc, parsed.data).map((path) => `${path}: not a field of the config (a typo?)`);
  const hashes = parsed.data.blocklist.hashes;
  for (let i = 1; i < hashes.length; i++) {
    if (!(hashes[i - 1]! < hashes[i]!)) {
      problems.push('blocklist.hashes: must be sorted and unique (pnpm sign-config block keeps them so)');
      break;
    }
  }
  return problems;
}

/** Signs the source: dates it, checks it, and signs the dated doc's exact text. */
export function signConfig(source: unknown, seed: Uint8Array, now: number, days: number): SignedConfig {
  const doc = stampDoc(source, now, days);
  const problems = docProblems(doc);
  if (problems.length > 0) throw new ConfigError(problems);
  const text = JSON.stringify(doc);
  const { secretKey } = signKeyPairFromSeed(seed);
  return { doc: text, sig: toBase64Url(signDetached(utf8(text), secretKey)) };
}

export interface Verified {
  readonly doc: ConfigDoc;
  /** Which key signed it. */
  readonly signedBy: 'production' | 'dev';
}

/**
 * Checks a signed config against the trusted keys and the source it must have come from. The
 * dates aren't checked here (`expiryProblem` does that), so the committed file's check doesn't
 * start failing on a calendar day.
 */
export function verifyConfig(signedRaw: unknown, source: unknown, keys: Keys): Verified {
  const signed = signedConfigSchema.safeParse(signedRaw);
  if (!signed.success) {
    throw new ConfigError(signed.error.issues.map((issue) => `config.signed.json ${issue.path.map(String).join('.') || '(file)'}: ${issue.message}`));
  }
  const { doc: text, sig } = signed.data;
  const trusted = trustedKeys(keys);
  const message = utf8(text);
  const signature = bytesOf(sig);
  if (!verifySignature(message, signature, trusted.map(bytesOf))) {
    // Only reachable with production keys: the dev key is trusted while there are none.
    const dev = verifySignature(message, signature, [bytesOf(keys.dev)]);
    throw new ConfigError([
      dev
        ? 'config.signed.json: signed with the dev key, but production keys exist: sign it with a production key'
        : `config.signed.json: the signature is not from a trusted key (${keys.production.length > 0 ? 'the production keys' : 'the dev key'})`,
    ]);
  }
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ConfigError(['config.signed.json: the doc is not JSON']);
  }
  const problems = docProblems(doc);
  if (problems.length > 0) throw new ConfigError(problems);
  const undated: Record<string, unknown> = { ...(doc as Record<string, unknown>) };
  delete undated.issuedAt;
  delete undated.expiresAt;
  if (!isDeepStrictEqual(undated, source)) {
    throw new ConfigError(['config.signed.json: its doc is not config.json: run pnpm sign-config sign']);
  }
  return { doc: configDocSchema.parse(doc), signedBy: keys.production.length > 0 ? 'production' : 'dev' };
}

/** Why a verified doc can't be served at `now`, or null while it holds. */
export function expiryProblem(doc: ConfigDoc, now: number): string | null {
  return now >= doc.expiresAt ? `the config expired on ${new Date(doc.expiresAt).toISOString()}: sign it again` : null;
}

function blocklistOf(source: unknown): { salt: string; hashes: string[] } {
  const blocklist = isObject(source) ? source.blocklist : undefined;
  if (!isObject(blocklist) || typeof blocklist.salt !== 'string' || !Array.isArray(blocklist.hashes)) {
    throw new ConfigError(['config.json: blocklist must be {salt, hashes}']);
  }
  return { salt: blocklist.salt, hashes: blocklist.hashes as string[] };
}

function blocklistHashes(salt: string, hosts: readonly string[]): Map<string, string> {
  const problems: string[] = [];
  const hashes = new Map<string, string>();
  for (const input of hosts) {
    const host = blocklistHost(input);
    if (host === null) problems.push(`not a host: ${JSON.stringify(input)} (give the bare host, xn-- for a non-ASCII name)`);
    else hashes.set(host, blocklistHash(salt, host));
  }
  if (problems.length > 0) throw new ConfigError(problems);
  return hashes;
}

function withHashes(source: unknown, hashes: Iterable<string>): Record<string, unknown> {
  const doc = source as Record<string, unknown>;
  const sorted = [...new Set(hashes)].sort();
  return { ...doc, blocklist: { ...(doc.blocklist as Record<string, unknown>), hashes: sorted } };
}

export interface BlocklistChange {
  readonly source: Record<string, unknown>;
  /** The normalised hosts the change applied to, and those it didn't (already there, or absent). */
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
}

/** Adds the hosts' hashes to the source's blocklist (sorted, unique). */
export function blockHosts(source: unknown, hosts: readonly string[]): BlocklistChange {
  const { salt, hashes } = blocklistOf(source);
  const have = new Set(hashes);
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [host, hash] of blocklistHashes(salt, hosts)) {
    (have.has(hash) ? unchanged : changed).push(host);
    have.add(hash);
  }
  return { source: withHashes(source, have), changed, unchanged };
}

/** Takes the hosts' hashes out of the source's blocklist. */
export function unblockHosts(source: unknown, hosts: readonly string[]): BlocklistChange {
  const { salt, hashes } = blocklistOf(source);
  const have = new Set(hashes);
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [host, hash] of blocklistHashes(salt, hosts)) {
    (have.delete(hash) ? changed : unchanged).push(host);
  }
  return { source: withHashes(source, have), changed, unchanged };
}
