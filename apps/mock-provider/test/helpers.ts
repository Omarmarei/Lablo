import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { PlaceholderMedia } from '../src/media';
import { buildServer } from '../src/server';
import type { MockServer, MockServerOptions } from '../src/server';

/** Pinned clock: Monday 2026-11-02 12:00:00 UTC. */
export const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
export const NOW_SEC = NOW / 1000;
export const DAY_SEC = 86_400;

export const U = 'zoma';
export const P = 'zoma-test';

/** A mock with the pinned clock, finite live streams and no lab-log folder. */
export function mock(options: MockServerOptions = {}): Promise<MockServer> {
  return buildServer({
    labLogDir: null,
    now: () => NOW,
    media: new PlaceholderMedia({ liveLimitBytes: 4096, liveIntervalMs: 5 }),
    ...options,
  });
}

export function api(action?: string, extra = '', username = U, password = P): string {
  const base = `/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  return `${base}${action ? `&action=${action}` : ''}${extra}`;
}

export async function listen(app: MockServer): Promise<string> {
  return app.listen({ port: 0, host: '127.0.0.1' });
}

export interface RawResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /** ms from request start to the response headers. */
  headersAt: number;
  /** How the response ended: 'end', 'aborted' (server dropped it) or 'timeout' (we gave up). */
  ended: 'end' | 'aborted' | 'timeout';
}

/**
 * GET over a real socket, collecting whatever arrives within `waitMs` (for stalls, resets and
 * slow headers, which app.inject() cannot show). Rejects only when no response arrives at all.
 */
export function rawGet(url: string, waitMs = 1500): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = httpRequest(url, { agent: false }, (res) => {
      const headersAt = Date.now() - started;
      const chunks: Buffer[] = [];
      let done = false;
      const finish = (ended: RawResult['ended']): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        req.destroy();
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), headersAt, ended });
      };
      const timer = setTimeout(() => finish('timeout'), waitMs);
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => finish('end'));
      res.on('aborted', () => finish('aborted'));
      res.on('error', () => finish('aborted'));
      res.on('close', () => setImmediate(() => finish(res.complete ? 'end' : 'aborted')));
    });
    req.on('error', reject);
    req.end();
  });
}
