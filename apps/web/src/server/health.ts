/**
 * `GET /v1/health`: is the backend up, and does its database answer (RELAY step 29a)?
 * The answer never says why the database is down (no message, no host): only up or down.
 */

/** Whatever answers a trivial query: the database, or a fake in the tests. */
export interface HealthProbe {
  ping(): Promise<void>;
}

export interface HealthBody {
  ok: boolean;
  db: 'up' | 'down';
}

/** How long the database has to answer before the check says it is down. */
export const HEALTH_TIMEOUT_MS = 2000;

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** The health answer: 200 with the database up, 503 down. Never cached. */
export async function health(probe: () => HealthProbe, timeoutMs = HEALTH_TIMEOUT_MS): Promise<Response> {
  let up: boolean;
  try {
    // Inside the try: building the probe throws when DATABASE_URL is missing.
    await within(probe().ping(), timeoutMs);
    up = true;
  } catch (error) {
    // Only the error's kind reaches the log: a driver's message can name the host.
    console.error(`health: the database is down (${errorKind(error)})`);
    up = false;
  }
  const body: HealthBody = { ok: up, db: up ? 'up' : 'down' };
  return Response.json(body, { status: up ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}

/** A Node error's code (ECONNREFUSED), or its class name. */
export function errorKind(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name)) return name;
  }
  return 'unknown';
}
