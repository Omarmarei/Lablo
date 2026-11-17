/**
 * `pnpm sign-config <command>` (RELAY step 30a, docs/runbooks/config.md):
 *
 *   keygen --out <file>             a new signing seed in a file outside the repo; prints its public key
 *   pubkey --key <file>             prints a seed file's public key
 *   sign (--key <file> | --dev) [--days N]
 *                                   dates config/config.json, checks it and signs it into
 *                                   config/config.signed.json (N days, default 180, at most 400)
 *   verify                          checks config/config.signed.json against config/keys.json,
 *                                   config/config.json and today's date
 *   block <host>...                 adds the hosts' hashes to config/config.json's blocklist
 *   unblock <host>...               takes them out
 *
 * The production seeds never enter the repo or a chat: keygen refuses a path inside the repo.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ConfigError,
  DAY_MS,
  DEFAULT_DAYS,
  blockHosts,
  devSeed,
  expiryProblem,
  formatSeed,
  parseKeys,
  parseSeed,
  publicKeyOf,
  signConfig,
  trustedKeys,
  unblockHosts,
  verifyConfig,
} from './config';

export interface CliEnv {
  /** The repo's root: `config/` is read and written there. */
  readonly root: string;
  readonly now: number;
  /** A fresh 32-byte seed (keygen). */
  readonly newSeed: () => Uint8Array;
  readonly log: (line: string) => void;
}

export const CONFIG_FILES = {
  source: 'config/config.json',
  signed: 'config/config.signed.json',
  keys: 'config/keys.json',
} as const;

export function defaultEnv(root: string): CliEnv {
  return { root, now: Date.now(), newSeed: () => new Uint8Array(randomBytes(32)), log: (line) => console.log(line) };
}

const USAGE = [
  'pnpm sign-config keygen --out <file outside the repo>',
  'pnpm sign-config pubkey --key <seed file>',
  'pnpm sign-config sign (--key <seed file> | --dev) [--days N]',
  'pnpm sign-config verify',
  'pnpm sign-config block <host>...',
  'pnpm sign-config unblock <host>...',
];

interface Args {
  readonly flags: Map<string, string | true>;
  readonly rest: readonly string[];
}

const VALUE_FLAGS = new Set(['--out', '--key', '--days']);
const BARE_FLAGS = new Set(['--dev']);

function parseArgs(args: readonly string[]): Args {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (VALUE_FLAGS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) throw new ConfigError([`${arg} needs a value`]);
      flags.set(arg, value);
      i++;
    } else if (BARE_FLAGS.has(arg)) flags.set(arg, true);
    else if (arg.startsWith('--')) throw new ConfigError([`unknown option ${arg}`]);
    else rest.push(arg);
  }
  return { flags, rest };
}

function value(args: Args, flag: string): string | undefined {
  const found = args.flags.get(flag);
  return typeof found === 'string' ? found : undefined;
}

function readJson(env: CliEnv, file: string): unknown {
  let text: string;
  try {
    text = readFileSync(path.join(env.root, file), 'utf8');
  } catch {
    throw new ConfigError([`can't read ${file}`]);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ConfigError([`${file} is not JSON`]);
  }
}

function writeJson(env: CliEnv, file: string, data: unknown): void {
  writeFileSync(path.join(env.root, file), `${JSON.stringify(data, null, 2)}\n`);
}

/** True when `file` is the repo's root or inside it. */
export function insideRepo(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function keygen(env: CliEnv, args: Args): void {
  const out = value(args, '--out');
  if (out === undefined) throw new ConfigError(['keygen needs --out <file outside the repo>']);
  if (insideRepo(env.root, out)) {
    throw new ConfigError([`refusing ${out}: a signing seed never goes inside the repo (it is public)`]);
  }
  const seed = env.newSeed();
  try {
    // 'wx': never overwrite a seed that exists.
    writeFileSync(path.resolve(out), formatSeed(seed), { flag: 'wx', mode: 0o600 });
  } catch {
    throw new ConfigError([`can't write ${out}: does it exist already?`]);
  }
  env.log(`Wrote a new signing seed to ${path.resolve(out)}.`);
  env.log(`Public key: ${publicKeyOf(seed)}`);
  env.log('Keep the seed in the password manager and on paper; delete this file once it is stored.');
}

function readSeed(file: string): Uint8Array {
  let text: string;
  try {
    text = readFileSync(path.resolve(file), 'utf8');
  } catch {
    throw new ConfigError([`can't read the seed file ${file}`]);
  }
  return parseSeed(text);
}

function sign(env: CliEnv, args: Args): void {
  const keyFile = value(args, '--key');
  const dev = args.flags.get('--dev') === true;
  if ((keyFile === undefined) === !dev) throw new ConfigError(['sign needs --key <seed file> or --dev (one of them)']);
  const daysText = value(args, '--days');
  const days = daysText === undefined ? DEFAULT_DAYS : Number(daysText);
  const keys = parseKeys(readJson(env, CONFIG_FILES.keys));
  const seed = keyFile === undefined ? devSeed() : readSeed(keyFile);
  const publicKey = publicKeyOf(seed);
  if (!trustedKeys(keys).includes(publicKey)) {
    throw new ConfigError([
      dev
        ? 'production keys exist in config/keys.json: the live config must be signed with one of them'
        : `this seed's public key ${publicKey} is not in config/keys.json's production keys`,
    ]);
  }
  const signed = signConfig(readJson(env, CONFIG_FILES.source), seed, env.now, days);
  writeJson(env, CONFIG_FILES.signed, signed);
  env.log(`Signed ${CONFIG_FILES.signed} with the ${dev ? 'dev' : 'production'} key ${publicKey}.`);
  env.log(`It holds until ${new Date(env.now + days * DAY_MS).toISOString()} (${days} days).`);
}

function verify(env: CliEnv): void {
  const keys = parseKeys(readJson(env, CONFIG_FILES.keys));
  const verified = verifyConfig(readJson(env, CONFIG_FILES.signed), readJson(env, CONFIG_FILES.source), keys);
  const expired = expiryProblem(verified.doc, env.now);
  if (expired !== null) throw new ConfigError([expired]);
  const days = Math.floor((verified.doc.expiresAt - env.now) / DAY_MS);
  env.log(`${CONFIG_FILES.signed} is good: signed with the ${verified.signedBy} key, it matches ${CONFIG_FILES.source}.`);
  env.log(`Issued ${new Date(verified.doc.issuedAt).toISOString()}, expires ${new Date(verified.doc.expiresAt).toISOString()} (${days} days left).`);
  env.log(`${verified.doc.kill.length} kill rules, ${verified.doc.blocklist.hashes.length} blocked hosts.`);
}

function changeBlocklist(env: CliEnv, args: Args, block: boolean): void {
  if (args.rest.length === 0) throw new ConfigError([`${block ? 'block' : 'unblock'} needs at least one host`]);
  const change = (block ? blockHosts : unblockHosts)(readJson(env, CONFIG_FILES.source), args.rest);
  writeJson(env, CONFIG_FILES.source, change.source);
  for (const host of change.changed) env.log(`${block ? 'Blocked' : 'Unblocked'} ${host}.`);
  for (const host of change.unchanged) env.log(`${host} was ${block ? 'already blocked' : 'not blocked'}.`);
  if (change.changed.length > 0) env.log('Now sign the config again (pnpm sign-config sign) and commit both files.');
}

/** Runs one command; 0 on success, 1 with the problems logged, 2 for a usage mistake. */
export function runSignConfig(argv: readonly string[], env: CliEnv): number {
  const [command, ...rest] = argv;
  try {
    const args = parseArgs(rest);
    const noArgs = (): void => {
      if (args.rest.length > 0) throw new ConfigError([`${command} takes no hosts`]);
    };
    switch (command) {
      case 'keygen':
        noArgs();
        keygen(env, args);
        return 0;
      case 'pubkey': {
        noArgs();
        const keyFile = value(args, '--key');
        if (keyFile === undefined) throw new ConfigError(['pubkey needs --key <seed file>']);
        env.log(publicKeyOf(readSeed(keyFile)));
        return 0;
      }
      case 'sign':
        noArgs();
        sign(env, args);
        return 0;
      case 'verify':
        noArgs();
        verify(env);
        return 0;
      case 'block':
      case 'unblock':
        changeBlocklist(env, args, command === 'block');
        return 0;
      default:
        env.log(`Usage:\n  ${USAGE.join('\n  ')}`);
        return 2;
    }
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const problem of error.problems) env.log(`error: ${problem}`);
    return 1;
  }
}
