import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { GET } from '../src/app/v1/health/route';
import { createDb } from '../src/server/db';
import type { PrismaClient } from '../src/generated/prisma/client';
import { forbiddenColumn, prisma, WEB } from './web-db';

/**
 * The backend against a real Postgres (RELAY step 29a): the migrations, the tables, the health
 * route. The global setup has just migrated a fresh `lablo_test` database (global-setup.web.ts).
 */

const url = inject('databaseUrl');
let client: PrismaClient;
let raw: pg.Client;

beforeAll(async () => {
  client = createDb(url);
  raw = new pg.Client({ connectionString: url });
  await raw.connect();
});

afterAll(async () => {
  await client.$disconnect();
  await raw.end();
});

describe('the migrations', () => {
  it('ran on the test database, never on the one for development', () => {
    expect(new URL(url).pathname).toBe('/lablo_test');
  });

  it('build exactly what schema.prisma says (no drift)', () => {
    const diff = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], url);
    expect(diff.output).toContain('No difference detected');
    expect(diff.status).toBe(0);
  });

  it('would show a schema change that no migration makes', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'lablo-schema-'));
    try {
      const changed = readFileSync(path.join(WEB, 'prisma/schema.prisma'), 'utf8').replace(
        '  size           Int\n',
        '  size           Int\n  sealedAt       DateTime?\n',
      );
      expect(changed).toContain('sealedAt');
      writeFileSync(path.join(dir, 'schema.prisma'), changed);
      const diff = prisma(['migrate', 'diff', '--from-config-datasource', '--to-schema', path.join(dir, 'schema.prisma'), '--exit-code'], url);
      expect(diff.status).toBe(2);
      expect(diff.output).toContain('sealedAt');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('are all applied, none pending', () => {
    const status = prisma(['migrate', 'status'], url);
    expect(status.output).toContain('Database schema is up to date!');
    expect(status.status).toBe(0);
  });
});

describe('the tables', () => {
  it('are the four of architecture.md §3.2, plus Prisma’s own', async () => {
    const { rows } = await raw.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
    );
    expect(rows.map((row) => row.table_name)).toStrictEqual(['Backup', 'DiagReport', 'PairSession', 'TelemetryEvent', '_prisma_migrations']);
  });

  it('have no column for an IP address, a URL, a host, a device id or a credential', async () => {
    const { rows } = await raw.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'",
    );
    // The query reads every table's columns (28 in step 29a, 30 since step 31a).
    expect(rows.length).toBeGreaterThanOrEqual(30);
    expect(rows).toContainEqual({ table_name: 'TelemetryEvent', column_name: 'installId' });
    expect(rows).toContainEqual({ table_name: 'PairSession', column_name: 'deliveredAt' });
    expect(rows).toContainEqual({ table_name: 'PairSession', column_name: 'fileId' });
    expect(rows.filter((row) => forbiddenColumn(row.column_name))).toStrictEqual([]);
  });
});

describe('the Prisma client', () => {
  const later = new Date('2026-11-16T22:00:00.000Z');

  it('keeps a pairing session, and one code hash once', async () => {
    const session = { id: 'sid-1', codeHash: 'a'.repeat(64), tvPk: 'tv-public-key', pollTokenHash: 'b'.repeat(64), expiresAt: later };
    await client.pairSession.create({ data: session });
    const read = await client.pairSession.findUniqueOrThrow({ where: { codeHash: session.codeHash } });
    expect(read).toMatchObject({ ...session, payload: null, status: null });
    expect(read.createdAt).toBeInstanceOf(Date);
    await expect(client.pairSession.create({ data: { ...session, id: 'sid-2' } })).rejects.toMatchObject({ code: 'P2002' });
    await client.pairSession.update({ where: { id: 'sid-1' }, data: { payload: { phonePk: 'p', nonce: 'n', ct: 'c' }, status: 'ok' } });
    expect((await client.pairSession.findUniqueOrThrow({ where: { id: 'sid-1' } })).payload).toStrictEqual({ phonePk: 'p', nonce: 'n', ct: 'c' });
  });

  it('keeps a backup’s metadata, and moves updatedAt on each write', async () => {
    const first = await client.backup.create({ data: { lookupId: 'lookup-1', writeTokenHash: 'c'.repeat(64), size: 1234 } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await client.backup.update({ where: { lookupId: 'lookup-1' }, data: { size: 2345 } });
    expect(second.size).toBe(2345);
    expect(second.createdAt).toStrictEqual(first.createdAt);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it('numbers telemetry events, with their data as JSON', async () => {
    const event = { installId: 'install-1', kind: 'app_start', platform: 'webos', appVersion: '0.0.0', at: later };
    const a = await client.telemetryEvent.create({ data: { ...event, data: { tier: 'high', coldStartMs: 2100 } } });
    const b = await client.telemetryEvent.create({ data: { ...event, data: {} } });
    expect(typeof a.id).toBe('bigint');
    expect(b.id).toBe(a.id + 1n);
    expect(a.data).toStrictEqual({ tier: 'high', coldStartMs: 2100 });
    expect(a.receivedAt).toBeInstanceOf(Date);
  });

  it('keeps a diagnostics report under one support code', async () => {
    const report = { code: 'K7Q2XD', installId: 'install-1', platform: 'tizen', appVersion: '0.0.0', report: { engine: 'avplay' } };
    await client.diagReport.create({ data: report });
    await expect(client.diagReport.create({ data: { ...report, installId: 'install-2' } })).rejects.toMatchObject({ code: 'P2002' });
    expect(await client.diagReport.findUniqueOrThrow({ where: { code: 'K7Q2XD' } })).toMatchObject(report);
  });
});

describe('GET /v1/health', () => {
  const saved = process.env.DATABASE_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    vi.restoreAllMocks();
  });

  async function get(): Promise<{ status: number; cache: string | null; body: unknown }> {
    const response = await GET();
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  }

  it('answers 200 with the database up', async () => {
    process.env.DATABASE_URL = url;
    expect(await get()).toStrictEqual({ status: 200, cache: 'no-store', body: { ok: true, db: 'up' } });
  });

  it('answers 503 within its time when nothing listens at DATABASE_URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const closed = new URL(url);
    closed.port = '1';
    process.env.DATABASE_URL = closed.toString();
    const started = Date.now();
    expect(await get()).toStrictEqual({ status: 503, cache: 'no-store', body: { ok: false, db: 'down' } });
    expect(Date.now() - started).toBeLessThan(5000);
    // Back up once the URL is right again: the client follows DATABASE_URL.
    process.env.DATABASE_URL = url;
    expect((await get()).status).toBe(200);
  });

  it('answers 503 without a DATABASE_URL', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.DATABASE_URL;
    expect(await get()).toStrictEqual({ status: 503, cache: 'no-store', body: { ok: false, db: 'down' } });
    expect(errors).toHaveBeenCalledWith('health: the database is down (Error)');
  });
});
