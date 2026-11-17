import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_FILES, insideRepo, runSignConfig, type CliEnv } from './cli';
import { DAY_MS, devPublicKey, formatSeed, publicKeyOf, verifyConfig, parseKeys } from './config';

/** `pnpm sign-config`'s commands on a throwaway repo (RELAY step 30a). */

const NOW = Date.UTC(2026, 10, 17, 8, 0, 0);
const SALT = 'cli-test-salt-0123456789';

let base: string;
let root: string;
let outside: string;
let lines: string[];
let seeds: number;

function env(now = NOW): CliEnv {
  return {
    root,
    now,
    newSeed: () => new Uint8Array(32).fill(++seeds),
    log: (line) => lines.push(line),
  };
}

const run = (args: string[], now = NOW): number => runSignConfig(args, env(now));
const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const writeJson = (file: string, data: unknown): void => writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
const source = { v: 1, minVersion: {}, kill: [], blocklist: { salt: SALT, hashes: [] }, flags: {}, tunables: {} };

function seedFile(byte: number): string {
  const file = path.join(outside, `seed-${byte}.txt`);
  writeFileSync(file, formatSeed(new Uint8Array(32).fill(byte)));
  return file;
}

beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), 'sign-config-'));
  root = path.join(base, 'repo');
  outside = path.join(base, 'outside');
  mkdirSync(path.join(root, 'config'), { recursive: true });
  mkdirSync(outside);
  writeJson(CONFIG_FILES.source, source);
  writeJson(CONFIG_FILES.keys, { production: [], dev: devPublicKey() });
  lines = [];
  seeds = 0;
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('keygen and pubkey', () => {
  it('writes a new seed outside the repo and prints its public key', () => {
    const out = path.join(outside, 'lablo-config-1.seed');
    expect(run(['keygen', '--out', out])).toBe(0);
    const seed = new Uint8Array(32).fill(1);
    expect(readFileSync(out, 'utf8')).toBe(formatSeed(seed));
    expect(lines).toContain(`Public key: ${publicKeyOf(seed)}`);
    lines = [];
    expect(run(['pubkey', '--key', out])).toBe(0);
    expect(lines).toStrictEqual([publicKeyOf(seed)]);
  });

  it('refuses a path inside the repo, and an existing file', () => {
    for (const out of [path.join(root, 'seed.txt'), path.join(root, 'config', 'seed.txt'), root]) {
      lines = [];
      expect(run(['keygen', '--out', out])).toBe(1);
      expect(lines).toStrictEqual([`error: refusing ${out}: a signing seed never goes inside the repo (it is public)`]);
    }
    expect(existsSync(path.join(root, 'seed.txt'))).toBe(false);
    const out = path.join(outside, 'taken.seed');
    writeFileSync(out, 'keep me');
    lines = [];
    expect(run(['keygen', '--out', out])).toBe(1);
    expect(readFileSync(out, 'utf8')).toBe('keep me');
    expect(lines).toStrictEqual([`error: can't write ${out}: does it exist already?`]);
  });

  it('knows what is inside the repo', () => {
    expect(insideRepo(root, root)).toBe(true);
    expect(insideRepo(root, path.join(root, 'a', 'b'))).toBe(true);
    expect(insideRepo(root, path.join(root, '..', 'repo', 'x'))).toBe(true);
    expect(insideRepo(root, path.join(base, 'repo-other', 'x'))).toBe(false);
    expect(insideRepo(root, path.join(root, '..'))).toBe(false);
    expect(insideRepo(root, outside)).toBe(false);
    // Another drive (Windows) or another root.
    expect(insideRepo('D:/repo', 'C:/keys/seed.txt')).toBe(false);
  });

  it('needs its options', () => {
    expect(run(['keygen'])).toBe(1);
    expect(lines).toStrictEqual(['error: keygen needs --out <file outside the repo>']);
    lines = [];
    expect(run(['pubkey'])).toBe(1);
    expect(lines).toStrictEqual(['error: pubkey needs --key <seed file>']);
    lines = [];
    expect(run(['pubkey', '--key', path.join(outside, 'missing')])).toBe(1);
    expect(lines).toStrictEqual([`error: can't read the seed file ${path.join(outside, 'missing')}`]);
  });
});

describe('sign and verify', () => {
  it('signs with the dev key while there are no production keys, and verifies', () => {
    expect(run(['sign', '--dev', '--days', '30'])).toBe(0);
    expect(lines[0]).toBe(`Signed ${CONFIG_FILES.signed} with the dev key ${devPublicKey()}.`);
    const signed = readJson(CONFIG_FILES.signed) as { doc: string; sig: string };
    expect(JSON.parse(signed.doc)).toMatchObject({ issuedAt: NOW, expiresAt: NOW + 30 * DAY_MS });
    expect(readFileSync(path.join(root, CONFIG_FILES.signed), 'utf8')).toBe(`${JSON.stringify(signed, null, 2)}\n`);
    lines = [];
    expect(run(['verify'], NOW + 1)).toBe(0);
    expect(lines[0]).toBe(`${CONFIG_FILES.signed} is good: signed with the dev key, it matches ${CONFIG_FILES.source}.`);
    expect(lines[1]).toContain('(29 days left)');
    expect(lines[2]).toBe('0 kill rules, 0 blocked hosts.');
  });

  it('signs for 180 days by default', () => {
    expect(run(['sign', '--dev'])).toBe(0);
    const signed = readJson(CONFIG_FILES.signed) as { doc: string };
    expect(JSON.parse(signed.doc)).toMatchObject({ expiresAt: NOW + 180 * DAY_MS });
  });

  it('signs with a production key once keys.json has it, and then refuses the dev key', () => {
    const keyA = seedFile(1);
    expect(run(['sign', '--key', keyA])).toBe(1);
    expect(lines).toStrictEqual([`error: this seed's public key ${publicKeyOf(new Uint8Array(32).fill(1))} is not in config/keys.json's production keys`]);
    writeJson(CONFIG_FILES.keys, { production: [publicKeyOf(new Uint8Array(32).fill(1)), publicKeyOf(new Uint8Array(32).fill(2))], dev: devPublicKey() });
    lines = [];
    expect(run(['sign', '--dev'])).toBe(1);
    expect(lines).toStrictEqual(['error: production keys exist in config/keys.json: the live config must be signed with one of them']);
    lines = [];
    expect(run(['sign', '--key', seedFile(2)])).toBe(0);
    lines = [];
    expect(run(['verify'])).toBe(0);
    expect(lines[0]).toContain('signed with the production key');
    const verified = verifyConfig(readJson(CONFIG_FILES.signed), readJson(CONFIG_FILES.source), parseKeys(readJson(CONFIG_FILES.keys)));
    expect(verified.signedBy).toBe('production');
  });

  it('refuses a dev-signed file once production keys exist', () => {
    expect(run(['sign', '--dev'])).toBe(0);
    writeJson(CONFIG_FILES.keys, { production: [publicKeyOf(new Uint8Array(32).fill(1))], dev: devPublicKey() });
    lines = [];
    expect(run(['verify'])).toBe(1);
    expect(lines).toStrictEqual(['error: config.signed.json: signed with the dev key, but production keys exist: sign it with a production key']);
  });

  it('needs exactly one key', () => {
    expect(run(['sign'])).toBe(1);
    expect(run(['sign', '--dev', '--key', seedFile(1)])).toBe(1);
    expect(lines).toStrictEqual(['error: sign needs --key <seed file> or --dev (one of them)', 'error: sign needs --key <seed file> or --dev (one of them)']);
    expect(existsSync(path.join(root, CONFIG_FILES.signed))).toBe(false);
  });

  it('refuses a bad doc or a bad number of days, and writes nothing', () => {
    writeJson(CONFIG_FILES.source, { ...source, flag: {} });
    expect(run(['sign', '--dev'])).toBe(1);
    expect(lines).toStrictEqual(['error: flag: not a field of the config (a typo?)']);
    writeJson(CONFIG_FILES.source, source);
    lines = [];
    expect(run(['sign', '--dev', '--days', 'ten'])).toBe(1);
    expect(lines).toStrictEqual(['error: days must be a whole number from 1 to 400']);
    expect(existsSync(path.join(root, CONFIG_FILES.signed))).toBe(false);
  });

  it('catches config.json edited and not signed again', () => {
    expect(run(['sign', '--dev'])).toBe(0);
    writeJson(CONFIG_FILES.source, { ...source, flags: { newGuide: true } });
    lines = [];
    expect(run(['verify'])).toBe(1);
    expect(lines).toStrictEqual(['error: config.signed.json: its doc is not config.json: run pnpm sign-config sign']);
  });

  it('fails verify once the signature has expired', () => {
    expect(run(['sign', '--dev', '--days', '2'])).toBe(0);
    lines = [];
    expect(run(['verify'], NOW + 2 * DAY_MS - 1)).toBe(0);
    lines = [];
    expect(run(['verify'], NOW + 2 * DAY_MS)).toBe(1);
    expect(lines).toStrictEqual([`error: the config expired on ${new Date(NOW + 2 * DAY_MS).toISOString()}: sign it again`]);
  });

  it('reports a missing or broken file', () => {
    expect(run(['verify'])).toBe(1);
    expect(lines).toStrictEqual([`error: can't read ${CONFIG_FILES.signed}`]);
    writeFileSync(path.join(root, CONFIG_FILES.keys), '{"production": [');
    lines = [];
    expect(run(['sign', '--dev'])).toBe(1);
    expect(lines).toStrictEqual([`error: ${CONFIG_FILES.keys} is not JSON`]);
  });
});

describe('block and unblock', () => {
  it('changes config.json, which then needs signing again', () => {
    expect(run(['sign', '--dev'])).toBe(0);
    lines = [];
    expect(run(['block', 'Bad.Example', 'other.example'])).toBe(0);
    expect(lines).toStrictEqual(['Blocked bad.example.', 'Blocked other.example.', 'Now sign the config again (pnpm sign-config sign) and commit both files.']);
    expect(readFileSync(path.join(root, CONFIG_FILES.source), 'utf8')).toBe(`${JSON.stringify(readJson(CONFIG_FILES.source), null, 2)}\n`);
    expect((readJson(CONFIG_FILES.source) as { blocklist: { hashes: string[] } }).blocklist.hashes).toHaveLength(2);
    expect(run(['verify'])).toBe(1);
    expect(run(['sign', '--dev'])).toBe(0);
    lines = [];
    expect(run(['verify'])).toBe(0);
    expect(lines[2]).toBe('0 kill rules, 2 blocked hosts.');
    lines = [];
    expect(run(['block', 'bad.example'])).toBe(0);
    expect(lines).toStrictEqual(['bad.example was already blocked.']);
    lines = [];
    expect(run(['unblock', 'bad.example', 'never.example'])).toBe(0);
    expect(lines).toStrictEqual(['Unblocked bad.example.', 'never.example was not blocked.', 'Now sign the config again (pnpm sign-config sign) and commit both files.']);
    expect((readJson(CONFIG_FILES.source) as { blocklist: { hashes: string[] } }).blocklist.hashes).toHaveLength(1);
  });

  it('needs hosts, and refuses a bad one without changing anything', () => {
    expect(run(['block'])).toBe(1);
    expect(run(['unblock'])).toBe(1);
    expect(lines).toStrictEqual(['error: block needs at least one host', 'error: unblock needs at least one host']);
    const before = readFileSync(path.join(root, CONFIG_FILES.source), 'utf8');
    lines = [];
    expect(run(['block', 'ok.example', 'https://bad.example/'])).toBe(1);
    expect(lines).toHaveLength(1);
    expect(readFileSync(path.join(root, CONFIG_FILES.source), 'utf8')).toBe(before);
  });
});

describe('usage', () => {
  it('prints the usage for no or an unknown command', () => {
    expect(run([])).toBe(2);
    expect(lines[0]).toMatch(/^Usage:\n {2}pnpm sign-config keygen/);
    expect(run(['publish'])).toBe(2);
  });

  it('refuses unknown options, missing values and stray hosts', () => {
    expect(run(['sign', '--dev', '--force'])).toBe(1);
    expect(run(['sign', '--days'])).toBe(1);
    expect(run(['sign', '--key', '--dev'])).toBe(1);
    expect(run(['verify', 'example.com'])).toBe(1);
    expect(run(['keygen', 'x', '--out', path.join(outside, 'k')])).toBe(1);
    expect(lines).toStrictEqual([
      'error: unknown option --force',
      'error: --days needs a value',
      'error: --key needs a value',
      'error: verify takes no hosts',
      'error: keygen takes no hosts',
    ]);
    expect(existsSync(path.join(outside, 'k'))).toBe(false);
  });
});
