/**
 * The stand-in pairing API over HTTP (RELAY step 31c2b): `PairStandIn` behind a Node server, for
 * the old-engine walk on the host, and `answerPair` for the e2e's config server, which answers the
 * same routes on its own origin.
 *
 * The engines reach the host through `host.docker.internal`, but a TV build takes `?api=` only
 * for a host on the device itself (`readApiBase`: 127.0.0.1, localhost, [::1]): so the walk
 * forwards the container's own 127.0.0.1:`PAIR_PORT` to this server (`forwardToHost`, socat, as
 * the image already has it), and the TV's pair worker fetches it as it would the real API.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { PairStandIn } from './pair-stand-in';

/** The TV's CORS on an answer the stand-in doesn't give (its own answers carry it). */
const NOT_FOUND_HEADERS: Readonly<Record<string, string>> = { 'access-control-allow-origin': '*' };

/** Answers one `/v1/pair…` request from `standIn` once its body is in; 404 for a path it doesn't know. */
export function answerPair(standIn: PairStandIn, request: IncomingMessage, response: ServerResponse): void {
  const chunks: Buffer[] = [];
  request.on('data', (chunk: Buffer) => chunks.push(chunk));
  request.on('end', () => {
    const answer = standIn.answer(request.method ?? 'GET', request.url ?? '', request.headers.authorization, Buffer.concat(chunks).toString('utf8'));
    if (answer === null) {
      response.writeHead(404, NOT_FOUND_HEADERS);
      response.end();
      return;
    }
    response.writeHead(answer.status, answer.headers);
    response.end(answer.body);
  });
}

export interface PairServer {
  readonly port: number;
  /** `http://127.0.0.1:<port>`: where this process (the scripted phone) reaches it. */
  readonly origin: string;
  readonly standIn: PairStandIn;
  stop(): Promise<void>;
}

/**
 * The stand-in on a free port. Docker Desktop forwards host.docker.internal to the host's
 * loopback; on Linux (CI) it is the bridge's gateway, so the server listens on every interface
 * there (as the lab's mock provider does). Anything but `/v1/pair…` is a 404, the config's
 * `/v1/config` too: the walk's config run fails as on a TV with no answer, and nothing waits for it.
 */
export function startPairServer(host: string = process.platform === 'linux' ? '0.0.0.0' : '127.0.0.1'): Promise<PairServer> {
  const standIn = new PairStandIn();
  const server = createServer((request, response) => {
    if ((request.url ?? '').startsWith('/v1/pair')) {
      answerPair(standIn, request, response);
      return;
    }
    response.writeHead(404, NOT_FOUND_HEADERS);
    response.end();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        standIn,
        stop: () =>
          new Promise<void>((done) => {
            // The engine's socat keeps its connections open: close them, or close() waits for them.
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
