/**
 * The signed config the old engines fetch (RELAY step 30c1). The harness signs a config of its own
 * with the dev key (its seed is public on purpose: tools/sign-config's `DEV_SEED_LABEL`) and
 * stages it beside the playlists; `serve-fixture.sh` answers `GET /v1/config` with it, so the
 * hello screen's config run (`?api=` the fixture origin) fetches it in a config worker, checks
 * the Ed25519 signature and the doc's schema, keeps it in IndexedDB and works out the policy; then
 * the query worker answers `blocked` for the `?check=` URLs from the stored copy. That is the
 * config worker's and the blocklist's first run on Chromium 53, 56 and 68.
 *
 * The doc: dated around the staging time, one notice rule (the policy's matching), and two
 * blocked hosts: an ASCII one checked through a parent match with a login and a port, and an
 * Arabic one blocked in its `xn--` form and checked in Unicode (the TV's punycode, NFKC and
 * percent-decoding on the old engine). The third URL must stay allowed.
 *
 * A TV build trusts the dev key only while `config/keys.json` has no production keys
 * (tv-defines.config.ts); after step 34 the same served copy must be refused, and nothing blocked.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { domainToASCII } from 'node:url';
import { blocklistHost } from '@lablo/core';
import { blocklistHash, sha256, signDetached, signKeyPairFromSeed, toBase64Url, utf8 } from '@lablo/crypto';

/** What serve-fixture.sh answers `GET /v1/config` with, in the fixtures folder. */
export const CONFIG_FILE = 'v1-config.json';
/** tools/sign-config's `DEV_SEED_LABEL`: the dev key's seed is its SHA-256. */
export const DEV_SEED_LABEL = 'lablo.config.dev-key.v1';
/** The harness's own salt (any 16–64 base64url characters will do). */
export const HARNESS_SALT = 'lablo-engines-harness-salt-v1';
/** The notice rule the policy must report. */
export const HARNESS_NOTICE = 'harness-notice';
/** How long the staged doc is valid: longer than any harness run. */
const VALID_MS = 7 * 86_400_000;

/** An Arabic host (مثال, "example"), blocked in its `xn--` form and checked as it is. */
export const ARABIC_HOST = String.fromCharCode(0x645, 0x62b, 0x627, 0x644) + '.lablo.test';
/** The two hosts the staged doc blocks (an operator gives the ASCII form: `pnpm sign-config block`). */
export const BLOCKED_HOSTS: readonly string[] = ['blocked.lablo.test', domainToASCII(ARABIC_HOST)];

/** The URLs the hello screen checks, and whether each is blocked. */
export const CONFIG_PROBES: ReadonlyArray<{ readonly url: string; readonly blocked: boolean }> = [
  // A parent match, with a login and a port in the way.
  { url: 'http://user:pass@cdn.blocked.lablo.test:8080/live/1/2/3.ts', blocked: true },
  // Unicode, percent-encoded on the way in (the page decodes `?check=`), punycode on the TV.
  { url: `http://${ARABIC_HOST}/live/4.m3u8`, blocked: true },
  { url: 'http://allowed.lablo.test/live/5.ts', blocked: false },
];

/** What the hello screen's config and blocklist rows must show. */
export interface ConfigCheck {
  /** The `?check=` URLs, in order. */
  readonly checks: readonly string[];
  /** `config-status`'s `data-status` and `data-failure`. */
  readonly status: 'fresh' | 'none';
  readonly failure: string;
  /** `data-notices`. */
  readonly notices: string;
  /** `blocked-status`'s `data-blocked`. */
  readonly blocked: string;
}

/**
 * The expectations: the dev-signed copy taken while the build trusts the dev key, refused (the
 * defaults: nothing blocked) once it trusts only production keys.
 */
export function configCheck(trustsDevKey: boolean): ConfigCheck {
  const checks = CONFIG_PROBES.map((probe) => probe.url);
  if (!trustsDevKey) return { checks, status: 'none', failure: 'bad-signature', notices: '', blocked: CONFIG_PROBES.map(() => 'false').join(',') };
  return { checks, status: 'fresh', failure: '', notices: HARNESS_NOTICE, blocked: CONFIG_PROBES.map((probe) => String(probe.blocked)).join(',') };
}

/** `config/keys.json`'s text: does a TV build trust the dev key (no production keys yet)? */
export function trustsDevKey(keysJson: string): boolean {
  const keys = JSON.parse(keysJson) as { production?: unknown };
  if (!Array.isArray(keys.production)) throw new Error('config/keys.json: production must be a list');
  return keys.production.length === 0;
}

/** The doc the harness serves, dated around `nowMs`. */
export function harnessConfigDoc(nowMs: number): Record<string, unknown> {
  const hashes = BLOCKED_HOSTS.map((host) => {
    const form = blocklistHost(host);
    if (form === null) throw new Error(`not a host the blocklist takes: ${host}`);
    return blocklistHash(HARNESS_SALT, form);
  });
  return {
    v: 1,
    issuedAt: nowMs - 60_000,
    expiresAt: nowMs + VALID_MS,
    minVersion: {},
    kill: [{ id: HARNESS_NOTICE, match: {}, mode: 'notice' }],
    blocklist: { salt: HARNESS_SALT, hashes },
    flags: {},
    tunables: {},
  };
}

/** A `GET /v1/config` answer carrying `doc`, signed with the dev key (as apps/web serves it). */
export function devSignedAnswer(doc: Record<string, unknown>): string {
  const pair = signKeyPairFromSeed(sha256(utf8(DEV_SEED_LABEL)));
  const text = JSON.stringify(doc);
  return JSON.stringify({ doc: text, sig: toBase64Url(signDetached(utf8(text), pair.secretKey)), country: 'AE' });
}

/** Writes the dev-signed answer to `<dir>/v1-config.json`. */
export function stageConfig(dir: string, nowMs: number): void {
  writeFileSync(path.join(dir, CONFIG_FILE), devSignedAnswer(harnessConfigDoc(nowMs)));
}
