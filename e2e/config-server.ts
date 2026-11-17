import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { harnessConfigDoc } from '../tools/engines/src/config';

/**
 * A stand-in for apps/web's `GET /v1/config` on 127.0.0.1 (RELAY steps 30c1 and 30c2a): it
 * answers with an exact text the test sets (`devSignedAnswer`: signed with the dev key, which the
 * dev app and the test builds trust), and the app reaches it through `?api=<origin>`.
 */

export interface ConfigServer {
  readonly origin: string;
  /** Requests for `/v1/config` so far. */
  requests(): number;
  /** What the next request gets: an answer's exact text. */
  serve(answer: string): void;
  close(): Promise<void>;
}

export async function startConfigServer(answer: string): Promise<ConfigServer> {
  let body = answer;
  let requests = 0;
  const server: Server = createServer((request, response) => {
    // The app's config worker fetches cross-origin (the dev app is on localhost:<port>).
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (request.method === 'GET' && request.url === '/v1/config') {
      requests += 1;
      response.writeHead(200, { ...headers, 'content-type': 'application/json' });
      response.end(body);
      return;
    }
    response.writeHead(404, headers);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests: () => requests,
    serve: (next) => {
      body = next;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A config doc dated around now, with `fields` in place of the harness doc's (no kill rule, one notice, two blocked hosts). */
export function doc(fields: Record<string, unknown> = {}, now = Date.now()): Record<string, unknown> {
  return { ...harnessConfigDoc(now), ...fields };
}
