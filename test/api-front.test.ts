import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { Agent, createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiFront } from '../e2e/api-front';
import { CONFIG_PATH, HOP_HEADERS, answerHeaders, forwardHeaders, startApiFront } from '../e2e/api-front';

/**
 * The pairing e2e's test front (RELAY step 31c3, e2e/api-front.ts): everything passes on to the
 * real API unchanged, with the test's caller address; `GET /v1/config` answered by the front only
 * while a test serves its own.
 */

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

interface Upstream {
  readonly origin: string;
  readonly seen: Seen[];
  /** Requests whose connection closed before the upstream answered. */
  readonly gone: string[];
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** A stand-in for `next start`: records each request, then lets `answer` reply. */
async function upstream(answer: (request: IncomingMessage, response: ServerResponse, seen: Seen) => void): Promise<Upstream> {
  const seen: Seen[] = [];
  const gone: string[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const entry = { method: request.method ?? '', url: request.url ?? '', headers: request.headers, body: Buffer.concat(chunks).toString('utf8') };
      seen.push(entry);
      response.on('close', () => {
        if (!response.writableFinished) gone.push(entry.url);
      });
      answer(request, response, entry);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const up: Upstream = {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
    gone,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  cleanups.push(up.close);
  return up;
}

async function front(origin: string, address = '10.251.0.1'): Promise<ApiFront> {
  const made = await startApiFront({ upstream: origin, address });
  cleanups.push(made.close);
  return made;
}

interface Answer {
  readonly status: number;
  readonly headers: IncomingMessage['headers'];
  readonly raw: string[];
  readonly body: string;
}

/** One request over a socket of its own. */
function call(origin: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string; agent?: Agent } = {}): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    const url = new URL(path, origin);
    const outgoing = httpRequest(url, { method: init.method ?? 'GET', headers: init.headers ?? {}, agent: init.agent ?? false }, (answer) => {
      const chunks: Buffer[] = [];
      answer.on('data', (chunk: Buffer) => chunks.push(chunk));
      answer.on('end', () => resolve({ status: answer.statusCode ?? 0, headers: answer.headers, raw: answer.rawHeaders, body: Buffer.concat(chunks).toString('utf8') }));
      answer.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(init.body);
  });
}

const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};

describe('forwardHeaders', () => {
  it('drops each hop-by-hop header and host, keeps the rest, and sets the address over a client’s', () => {
    const given: Record<string, string> = {};
    for (const name of HOP_HEADERS) given[name] = 'x';
    const out = forwardHeaders({ ...given, origin: 'http://localhost:5393', authorization: 'Bearer t', 'x-forwarded-for': '1.2.3.4', 'content-type': 'application/json' }, '10.251.0.7');
    expect(out).toEqual({ origin: 'http://localhost:5393', authorization: 'Bearer t', 'x-forwarded-for': '10.251.0.7', 'content-type': 'application/json' });
  });

  it('keeps a header given more than once', () => {
    expect(forwardHeaders({ 'x-many': ['a', 'b'] }, '10.0.0.1')).toEqual({ 'x-many': ['a', 'b'], 'x-forwarded-for': '10.0.0.1' });
  });

  it('names every connection header of RFC 9110, and host', () => {
    expect([...HOP_HEADERS].sort()).toEqual(['connection', 'host', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
  });
});

describe('answerHeaders', () => {
  it('drops the hop-by-hop ones whatever their case, keeps the rest in order, repeated names too', () => {
    const raw = ['Connection', 'close', 'X-A', '1', 'Transfer-Encoding', 'chunked', 'Set-Cookie', 'a=1', 'KEEP-ALIVE', 'timeout=5', 'Set-Cookie', 'b=2', 'Access-Control-Allow-Origin', '*'];
    expect(answerHeaders(raw)).toEqual(['X-A', '1', 'Set-Cookie', 'a=1', 'Set-Cookie', 'b=2', 'Access-Control-Allow-Origin', '*']);
  });

  it('keeps the last pair', () => {
    expect(answerHeaders(['Content-Type', 'application/json'])).toEqual(['Content-Type', 'application/json']);
    expect(answerHeaders([])).toEqual([]);
  });
});

describe('startApiFront', () => {
  it('listens on 127.0.0.1 and passes a request on unchanged: method, path and query, body, headers', async () => {
    const up = await upstream((_request, response) => json(response, 201, { made: true }, { 'access-control-allow-origin': '*', 'x-upstream': 'yes' }));
    const made = await front(up.origin, '10.251.3.4');
    expect(made.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const body = JSON.stringify({ tvPk: 'k'.repeat(43) });
    const answer = await call(made.origin, '/v1/pair?x=1&y=2', { method: 'POST', body, headers: { 'content-type': 'application/json', origin: 'http://localhost:5393', 'x-forwarded-for': '9.9.9.9' } });
    expect(answer.status).toBe(201);
    expect(JSON.parse(answer.body)).toEqual({ made: true });
    expect(answer.headers['access-control-allow-origin']).toBe('*');
    expect(answer.headers['x-upstream']).toBe('yes');
    expect(up.seen).toHaveLength(1);
    const [seen] = up.seen;
    expect(seen).toMatchObject({ method: 'POST', url: '/v1/pair?x=1&y=2', body });
    expect(seen!.headers).toMatchObject({ 'content-type': 'application/json', origin: 'http://localhost:5393', 'x-forwarded-for': '10.251.3.4' });
    // The upstream's own host, not the front's.
    expect(seen!.headers.host).toBe(new URL(up.origin).host);
    expect(made.forwarded).toEqual([{ method: 'POST', path: '/v1/pair?x=1&y=2', status: 201 }]);
  });

  it('passes a preflight and its answer through, and every status as it is', async () => {
    const up = await upstream((request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' });
        response.end();
        return;
      }
      json(response, 410, { error: 'expired' }, { 'access-control-allow-origin': '*' });
    });
    const made = await front(up.origin);
    const preflight = await call(made.origin, '/v1/pair/s/abc', { method: 'OPTIONS', headers: { origin: 'http://localhost:5393', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-headers']).toBe('authorization, content-type');
    expect(up.seen[0]!.headers['access-control-request-headers']).toBe('authorization');
    const gone = await call(made.origin, '/v1/pair/s/abc', { headers: { authorization: 'Bearer t' } });
    expect(gone.status).toBe(410);
    expect(JSON.parse(gone.body)).toEqual({ error: 'expired' });
    expect(made.forwarded).toEqual([
      { method: 'OPTIONS', path: '/v1/pair/s/abc', status: 204 },
      { method: 'GET', path: '/v1/pair/s/abc', status: 410 },
    ]);
  });

  it('keeps its own connection header, not the upstream’s', async () => {
    const up = await upstream((_request, response) => json(response, 200, {}, { connection: 'close' }));
    const made = await front(up.origin);
    const agent = new Agent({ keepAlive: true });
    try {
      const answer = await call(made.origin, '/v1/health', { agent });
      expect(answer.headers.connection).toBe('keep-alive');
    } finally {
      agent.destroy();
    }
  });

  it('hands GET /v1/config to the real route until a test serves its own, then answers it exactly', async () => {
    const up = await upstream((_request, response) => json(response, 200, { real: true }, { 'cache-control': 'private, max-age=300', 'access-control-allow-origin': '*' }));
    const made = await front(up.origin);
    expect(CONFIG_PATH).toBe('/v1/config');
    const real = await call(made.origin, '/v1/config');
    expect(JSON.parse(real.body)).toEqual({ real: true });
    expect(real.headers['cache-control']).toBe('private, max-age=300');
    expect(made.configAnswers()).toBe(0);

    const text = '{"doc":"{\\"v\\":1}","sig":"s","country":"AE"}';
    made.serve(text);
    const served = await call(made.origin, '/v1/config');
    expect(served.status).toBe(200);
    expect(served.body).toBe(text);
    expect(served.headers).toMatchObject({ 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'application/json' });
    // A query doesn't change the path.
    expect((await call(made.origin, '/v1/config?t=1')).body).toBe(text);
    expect(made.configAnswers()).toBe(2);
    // Only that path, only GET.
    await call(made.origin, '/v1/configs');
    await call(made.origin, '/v1/config', { method: 'POST', body: '{}' });
    expect(up.seen.map((s) => `${s.method} ${s.url}`)).toEqual(['GET /v1/config', 'GET /v1/configs', 'POST /v1/config']);
    expect(made.configAnswers()).toBe(2);

    made.serve(null);
    expect(JSON.parse((await call(made.origin, '/v1/config')).body)).toEqual({ real: true });
    expect(made.configAnswers()).toBe(2);
    expect(made.forwarded.map((f) => `${f.method} ${f.path} ${f.status}`)).toEqual(['GET /v1/config 200', 'GET /v1/configs 200', 'POST /v1/config 200', 'GET /v1/config 200']);
  });

  it('answers 502 when the real API is down, and logs it with status 0', async () => {
    const up = await upstream(() => undefined);
    const origin = up.origin;
    await up.close();
    const made = await front(origin);
    const answer = await call(made.origin, '/v1/pair', { method: 'POST', body: '{}' });
    expect(answer.status).toBe(502);
    expect(answer.headers['cache-control']).toBe('no-store');
    expect(made.forwarded).toEqual([{ method: 'POST', path: '/v1/pair', status: 0 }]);
  });

  it('ends its answer when the real API dies halfway through one', async () => {
    const up = await upstream((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
      response.write('{"half":');
      setTimeout(() => response.socket?.destroy(), 50);
    });
    const made = await front(up.origin);
    // Without the end, the client would wait for the rest forever.
    const outcome = await Promise.race([
      call(made.origin, '/v1/pair/s/abc').then(
        (answer) => `ended ${answer.body.length}`,
        () => 'error',
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), 3000)),
    ]);
    expect(outcome).not.toBe('still waiting');
  });

  it('ends the request to the real API when the browser gives up on it', async () => {
    const up = await upstream(() => undefined);
    const made = await front(up.origin);
    const outgoing = httpRequest(new URL('/v1/pair/s/abc', made.origin), { agent: false });
    outgoing.on('error', () => undefined);
    outgoing.end();
    await expect.poll(() => up.seen.length).toBe(1);
    outgoing.destroy();
    await expect.poll(() => up.gone, { timeout: 3000 }).toEqual(['/v1/pair/s/abc']);
  });

  it('closes while a request is still on its way', async () => {
    const up = await upstream(() => undefined);
    const made = await front(up.origin);
    const pending = call(made.origin, '/v1/pair/s/abc').catch(() => 'dropped');
    await expect.poll(() => up.seen.length).toBe(1);
    const closed = await Promise.race([made.close().then(() => 'closed'), new Promise<string>((resolve) => setTimeout(() => resolve('held'), 3000))]);
    expect(closed).toBe('closed');
    expect(await pending).toBe('dropped');
  });
});
