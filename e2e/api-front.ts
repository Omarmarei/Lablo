import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders, Server, ServerResponse } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A test front for apps/web's `next start` (RELAY step 31c3): the TV's dev app gets its origin as
 * `?api=`, and every request goes on to the real API unchanged (method, path, body and headers),
 * its answer coming back as it is. So the TV meets the real pairing routes, their CORS headers and
 * their preflights; the front adds none of its own. It does two things more:
 * - it gives the API the test's own caller address (`x-forwarded-for`), so the per-address rate
 *   limits never meet across tests;
 * - `GET /v1/config` goes on to the real route (the committed, dev-signed config) until the test
 *   sets an answer of its own (`serve`): the route bundles the committed file at build time, and
 *   the blocklist and refusal cases need another config;
 * - a test can hold some requests back (`hold`) to look at a state they would end (step 31d2b2b:
 *   the session's row while the TV's file download waits);
 * - it keeps what the API received (`received`: each request's headers and body as passed on), for
 *   step 31e's search for anything in the clear.
 * Test code only: the product's servers never relay anything (CLAUDE.md "Legal guardrails").
 */

/**
 * Headers that belong to one connection (RFC 9110 §7.6.1), never passed on, and `host`: each hop
 * names its own.
 */
export const HOP_HEADERS: readonly string[] = ['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host'];

/** The path the TV's config worker asks. */
export const CONFIG_PATH = '/v1/config';

/** One request the front passed on, with the real API's status (0: no answer came). */
export interface Forwarded {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

/** One request as the real API received it: the headers passed on and the whole body. */
export interface Received {
  readonly method: string;
  readonly path: string;
  readonly headers: OutgoingHttpHeaders;
  readonly body: Buffer;
}

/** Requests the front keeps back until `until` settles. */
export interface HoldRule {
  readonly method: string;
  /** The start of the path (`/dev/blob/`). */
  readonly prefix: string;
  readonly until: Promise<void>;
}

export interface ApiFront {
  /** `http://127.0.0.1:<port>`: the TV's `?api=` and the scripted phone's origin. */
  readonly origin: string;
  /** `GET /v1/config` gets this exact text from now on; `null` hands it to the real route again. */
  serve(answer: string | null): void;
  /**
   * From now on, a request matching `rule` waits for its `until` before it goes on (one whose
   * caller gave up meanwhile never goes); `null` holds none from now on.
   */
  hold(rule: HoldRule | null): void;
  /** How many config requests the front answered itself. */
  configAnswers(): number;
  /** Every request passed on to the real API, in the order they were answered. */
  readonly forwarded: readonly Forwarded[];
  /** Every request passed on whose body ended, in that order, with its headers and body. */
  readonly received: readonly Received[];
  close(): Promise<void>;
}

export interface FrontOptions {
  /** The real API's origin (`http://127.0.0.1:3101`). */
  readonly upstream: string;
  /** The caller's address the API sees. */
  readonly address: string;
}

/** The request's headers to pass on: the hop-by-hop ones dropped, the test's address set. */
export function forwardHeaders(headers: IncomingHttpHeaders, address: string): OutgoingHttpHeaders {
  const out: OutgoingHttpHeaders = {};
  for (const name of Object.keys(headers)) {
    if (HOP_HEADERS.indexOf(name) !== -1) continue;
    out[name] = headers[name];
  }
  out['x-forwarded-for'] = address;
  return out;
}

/** An answer's raw headers (name, value, name, value…) without the hop-by-hop ones; repeated names kept. */
export function answerHeaders(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    if (HOP_HEADERS.indexOf(raw[i]!.toLowerCase()) !== -1) continue;
    out.push(raw[i]!, raw[i + 1]!);
  }
  return out;
}

/** The path without its query. */
function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

export async function startApiFront(options: FrontOptions): Promise<ApiFront> {
  const upstream = new URL(options.upstream);
  let answer: string | null = null;
  let held: HoldRule | null = null;
  let answered = 0;
  const forwarded: Forwarded[] = [];
  const received: Received[] = [];

  const pass = (request: IncomingMessage, response: ServerResponse): void => {
    const method = request.method ?? 'GET';
    const path = request.url ?? '/';
    const headers = forwardHeaders(request.headers, options.address);
    const outgoing = httpRequest(
      { hostname: upstream.hostname, port: upstream.port, method, path, headers, agent: false },
      (real) => {
        const status = real.statusCode ?? 502;
        forwarded.push({ method, path, status });
        response.writeHead(status, answerHeaders(real.rawHeaders));
        real.on('error', () => response.destroy());
        real.pipe(response);
      },
    );
    outgoing.on('error', () => {
      forwarded.push({ method, path, status: 0 });
      if (!response.headersSent) response.writeHead(502, { 'cache-control': 'no-store' });
      response.end();
    });
    request.on('error', () => outgoing.destroy());
    // A request the browser gave up on (a worker ended) ends its upstream request too.
    response.on('close', () => outgoing.destroy());
    // The body as it goes on (the pipe and this listener start together, so neither misses a chunk).
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => received.push({ method, path, headers, body: Buffer.concat(chunks) }));
    request.pipe(outgoing);
  };

  const server: Server = createServer((request, response) => {
    if (answer !== null && request.method === 'GET' && pathOf(request.url ?? '') === CONFIG_PATH) {
      answered += 1;
      // As the real route: any origin may read it (the dev app is on another origin).
      response.writeHead(200, { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'application/json' });
      response.end(answer);
      return;
    }
    const rule = held;
    if (rule !== null && request.method === rule.method && (request.url ?? '').startsWith(rule.prefix)) {
      let gone = false;
      response.on('close', () => {
        gone = true;
      });
      const go = (): void => {
        if (!gone) pass(request, response);
      };
      void rule.until.then(go, go);
      return;
    }
    pass(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    serve: (next) => {
      answer = next;
    },
    hold: (rule) => {
      held = rule;
      // A failed `until` lets its requests go; it is no unhandled rejection meanwhile.
      rule?.until.catch(() => undefined);
    },
    configAnswers: () => answered,
    forwarded,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // A poll still on its way would hold the close.
        server.closeAllConnections();
      }),
  };
}
