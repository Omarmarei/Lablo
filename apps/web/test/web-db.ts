import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Helpers for `pnpm test:web` (vitest.web.config.ts, RELAY step 29a): the database the tests
 * run against, and the Prisma CLI.
 */

export const WEB = path.resolve(import.meta.dirname, '..');

/** The database each `pnpm test:web` run drops, creates and migrates from scratch. */
export const TEST_DATABASE = 'lablo_test';

/** The same for each `pnpm e2e:web` run (RELAY step 31b; playwright.web.config.ts). */
export const E2E_DATABASE = 'lablo_e2e';

/** DATABASE_URL from the environment (CI), or else from apps/web/.env (local development). */
export function serverUrl(): string {
  const envFile = path.join(WEB, '.env');
  if (process.env.DATABASE_URL === undefined && existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('pnpm test:web needs a database: `pnpm web:db`, then copy apps/web/.env.example to apps/web/.env (docs/runbooks/web.md)');
  }
  return url;
}

/** The same server and user, another database. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export interface CliResult {
  status: number | null;
  output: string;
}

/** Runs the Prisma CLI in apps/web against `databaseUrl`. */
export function prisma(args: string[], databaseUrl: string): CliResult {
  const bin = createRequire(path.join(WEB, 'package.json')).resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: WEB,
    env: { ...process.env, DATABASE_URL: databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1', CHECKPOINT_DISABLE: '1' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/**
 * Words that must never name a column: the server holds no IP address, URL, host, device id or
 * credential (CLAUDE.md "Legal guardrails", architecture.md §3.2–3.4). A camelCase or snake_case
 * name is split into its words first.
 */
export const FORBIDDEN_COLUMN_WORDS = new Set([
  'ip',
  'ips',
  'ipv4',
  'ipv6',
  'addr',
  'address',
  'url',
  'urls',
  'uri',
  'host',
  'hosts',
  'hostname',
  'domain',
  'password',
  'passwd',
  'pass',
  'credential',
  'credentials',
  'username',
  'user',
  'login',
  'email',
  'mac',
  'duid',
  'udid',
  'lgudid',
  'serial',
]);

export function columnWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

export function forbiddenColumn(name: string): boolean {
  // The whole name too: `IPv4` splits as `I Pv4`.
  return FORBIDDEN_COLUMN_WORDS.has(name.toLowerCase()) || columnWords(name).some((word) => FORBIDDEN_COLUMN_WORDS.has(word));
}
