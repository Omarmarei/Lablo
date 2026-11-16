import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseUrl } from '../src/server/db';
import { errorKind, HEALTH_TIMEOUT_MS, health, type HealthProbe } from '../src/server/health';

/** `GET /v1/health`'s logic over fake probes (RELAY step 29a); the real database: database.web.test.ts. */

const up: HealthProbe = { ping: () => Promise.resolve() };
const failing = (error: unknown): HealthProbe => ({ ping: () => Promise.reject(error) });
const hanging: HealthProbe = { ping: () => new Promise<void>(() => undefined) };

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function answer(response: Response): Promise<{ status: number; cache: string | null; body: unknown }> {
  return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
}

describe('health', () => {
  it('answers 200 up when the database answers', async () => {
    expect(await answer(await health(() => up))).toStrictEqual({ status: 200, cache: 'no-store', body: { ok: true, db: 'up' } });
    expect(logged).toStrictEqual([]);
  });

  it('answers 503 down when the query fails, and logs only the error kind', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432 (db.secret-host.example)'), { code: 'ECONNREFUSED' });
    const result = await answer(await health(() => failing(refused)));
    expect(result).toStrictEqual({ status: 503, cache: 'no-store', body: { ok: false, db: 'down' } });
    expect(logged).toStrictEqual(['health: the database is down (ECONNREFUSED)']);
  });

  it('answers 503 down when building the probe throws (no DATABASE_URL)', async () => {
    const result = await answer(
      await health(() => {
        throw new Error('DATABASE_URL is not set');
      }),
    );
    expect(result).toStrictEqual({ status: 503, cache: 'no-store', body: { ok: false, db: 'down' } });
    expect(logged).toStrictEqual(['health: the database is down (Error)']);
  });

  it('answers 503 down once the database has had its time, not before', async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = health(() => hanging).then((response) => {
      settled = true;
      return response;
    });
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(await answer(await pending)).toStrictEqual({ status: 503, cache: 'no-store', body: { ok: false, db: 'down' } });
  });

  it('takes its time limit as a parameter', async () => {
    vi.useFakeTimers();
    const pending = health(() => hanging, 50);
    await vi.advanceTimersByTimeAsync(50);
    expect((await pending).status).toBe(503);
  });

  it('clears its timer once the database answers', async () => {
    vi.useFakeTimers();
    await health(() => up);
    await health(() => failing(new Error('x')));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never puts a reason in the answer', async () => {
    const response = await health(() => failing(new Error('password authentication failed for user "lablo"')));
    expect(await response.text()).toBe('{"ok":false,"db":"down"}');
  });
});

describe('errorKind', () => {
  it.each([
    [Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), 'ECONNREFUSED'],
    [Object.assign(new Error('x'), { code: 'P1001' }), 'P1001'],
    [new TypeError('x'), 'TypeError'],
    // A code or a name that could carry text from the driver is left out.
    [Object.assign(new Error('x'), { code: 'connect to db.host.example failed' }), 'Error'],
    [Object.assign(new Error('x'), { code: 42, name: 'db.host.example' }), 'unknown'],
    ['a string', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
  ])('%#: %s', (error, kind) => {
    expect(errorKind(error)).toBe(kind);
  });
});

describe('databaseUrl', () => {
  it('reads DATABASE_URL', () => {
    expect(databaseUrl({ DATABASE_URL: 'postgresql://lablo@127.0.0.1:54329/lablo' })).toBe('postgresql://lablo@127.0.0.1:54329/lablo');
  });

  it.each([[{}], [{ DATABASE_URL: '' }]])('says where to set it when it is missing: %j', (env) => {
    expect(() => databaseUrl(env)).toThrow('DATABASE_URL is not set: copy apps/web/.env.example to apps/web/.env');
  });
});
