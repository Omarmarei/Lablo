import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { harnessConfigDoc } from '../tools/engines/src/config';
import { BackupStandIn, answerBackup, backupPath } from '../tools/engines/src/backup-stand-in';
import { answerPair } from '../tools/engines/src/pair-server';
import { PairStandIn, standInPath } from '../tools/engines/src/pair-stand-in';

/**
 * A stand-in for apps/web's `GET /v1/config` on 127.0.0.1 (RELAY steps 30c1 and 30c2a): it
 * answers with an exact text the test sets (`devSignedAnswer`: signed with the dev key, which the
 * dev app and the test builds trust), and the app reaches it through `?api=<origin>`. It also
 * serves files the test gives it (step 30c3b: a playlist on another host than its streams'), and
 * answers the pairing API's routes from a stand-in in memory (step 31c2a: `pair`), the phone's
 * file at its blob path too (step 31d2b2a), and the backup API's routes (step 32c2: `backup`).
 */

export interface ConfigServer {
  readonly origin: string;
  /** Requests for `/v1/config` so far. */
  requests(): number;
  /** What the next request gets: an answer's exact text. */
  serve(answer: string): void;
  /** Serves `body` at `path` (e.g. `/list.m3u`) from now on. */
  file(path: string, body: string, type: string): void;
  /** The pairing API on this origin (step 31c2a): what the TV and the phone asked, and its controls. */
  readonly pair: PairStandIn;
  /** The backup API on this origin (step 32c2): what the TV sent and asked, a backup put in, a hold on its `GET`s. */
  readonly backup: BackupStandIn;
  close(): Promise<void>;
}

export async function startConfigServer(answer: string): Promise<ConfigServer> {
  let body = answer;
  let requests = 0;
  const files = new Map<string, { readonly body: string; readonly type: string }>();
  const pair = new PairStandIn();
  const backup = new BackupStandIn();
  const server: Server = createServer((request, response) => {
    if (standInPath(request.url ?? '')) {
      answerPair(pair, request, response);
      return;
    }
    if (backupPath(request.url ?? '')) {
      answerBackup(backup, request, response);
      return;
    }
    // The app's config worker fetches cross-origin (the dev app is on localhost:<port>).
    const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (request.method === 'GET' && request.url === '/v1/config') {
      requests += 1;
      response.writeHead(200, { ...headers, 'content-type': 'application/json' });
      response.end(body);
      return;
    }
    const file = request.method === 'GET' ? files.get(request.url ?? '') : undefined;
    if (file !== undefined) {
      response.writeHead(200, { ...headers, 'content-type': file.type });
      response.end(file.body);
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
    file: (at, text, type) => {
      files.set(at, { body: text, type });
    },
    pair,
    backup,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A config doc dated around now, with `fields` in place of the harness doc's (no kill rule, one notice, two blocked hosts). */
export function doc(fields: Record<string, unknown> = {}, now = Date.now()): Record<string, unknown> {
  return { ...harnessConfigDoc(now), ...fields };
}
