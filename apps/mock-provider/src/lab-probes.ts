// Probes for the Zoma Lab build (RELAY step 15a, docs/architecture.md §5). The lab asks these
// to answer the runtime spikes on a TV, with no test account in the lab's code:
//
//   GET /__lab/bytes?lines=N&chunk=B&delay=MS   N numbered UTF-8 lines (Latin, Arabic, a 3-byte
//                                               and a 4-byte character), written B bytes at a time
//                                               (a prime by default, so chunks end mid-character),
//                                               MS ms apart: S1's streamed fetch and TextDecoder.
//   GET /__lab/echo?cors=0                      a small JSON answer; cors=0 sends it without CORS
//                                               headers (S7: packaged TV apps need none).
//   GET /__lab/redirect?to=/__lab/…&cors=0      302 to another /__lab/ path (S7: redirects and
//                                               responseURL). Only /__lab/ targets: never an open
//                                               redirect.
//
// `labLine` is written here on its own on purpose: the mock is an independent oracle, so the
// lab's copy (apps/tv/src/lab/probes.ts) can't share a bug with it.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

const TEXT = 'text/plain; charset=utf-8';
/** Requests answered without CORS headers (server.ts's onSend hook skips them). */
export const NO_CORS_REQUESTS = new WeakSet<FastifyRequest>();

export const LAB_BYTES_MAX_LINES = 1_000_000;
/** A prime, so chunk edges fall inside the multi-byte characters. */
export const LAB_BYTES_DEFAULT_CHUNK = 1009;

/** Line `n` of `/__lab/bytes`: `000042 Zoma زوما ✓ 😀\n` (21 characters, 22 UTF-16 units, 30 bytes in UTF-8). */
export function labLine(n: number): string {
  return `${String(n).padStart(6, '0')} Zoma زوما ✓ 😀\n`;
}

function intParam(value: string | undefined, fallback: number, min: number, max: number): number | null {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** The body of `/__lab/bytes?lines=N` cut into `chunk`-byte pieces. */
export function labBytesChunks(lines: number, chunk: number): Buffer[] {
  const parts: string[] = [];
  for (let n = 0; n < lines; n += 1) parts.push(labLine(n));
  const body = Buffer.from(parts.join(''), 'utf8');
  const chunks: Buffer[] = [];
  for (let at = 0; at < body.length; at += chunk) chunks.push(body.subarray(at, at + chunk));
  return chunks;
}

function streamChunks(chunks: Buffer[], delayMs: number): Readable {
  let i = 0;
  return new Readable({
    read() {
      const next = chunks[i];
      i += 1;
      if (next === undefined) {
        this.push(null);
        return;
      }
      if (delayMs === 0 || i === 1) this.push(next);
      else setTimeout(() => this.push(next), delayMs).unref();
    },
  });
}

export function registerLabProbes(app: FastifyInstance): void {
  app.get<{ Querystring: { lines?: string; chunk?: string; delay?: string } }>('/__lab/bytes', async (request, reply) => {
    const lines = intParam(request.query.lines, 1000, 0, LAB_BYTES_MAX_LINES);
    const chunk = intParam(request.query.chunk, LAB_BYTES_DEFAULT_CHUNK, 1, 1 << 20);
    const delay = intParam(request.query.delay, 0, 0, 1000);
    if (lines === null || chunk === null || delay === null) {
      return reply.code(400).type(TEXT).send(`lines 0–${LAB_BYTES_MAX_LINES}, chunk 1–1048576 bytes, delay 0–1000 ms`);
    }
    const chunks = labBytesChunks(lines, chunk);
    const bytes = chunks.reduce((sum, c) => sum + c.length, 0);
    return reply.type(TEXT).header('content-length', String(bytes)).header('cache-control', 'no-store').send(streamChunks(chunks, delay));
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/__lab/echo', async (request, reply) => {
    if (request.query.cors === '0') NO_CORS_REQUESTS.add(request);
    return reply.header('cache-control', 'no-store').send({ ok: true, path: '/__lab/echo', cors: request.query.cors !== '0' });
  });

  app.get<{ Querystring: { to?: string; cors?: string } }>('/__lab/redirect', async (request, reply) => {
    const to = request.query.to ?? '/__lab/echo';
    if (!/^\/__lab\/[A-Za-z0-9/?=&._-]*$/.test(to) || to.includes('..') || to.startsWith('/__lab/redirect')) {
      return reply.code(400).type(TEXT).send('to must be another /__lab/ path');
    }
    if (request.query.cors === '0') NO_CORS_REQUESTS.add(request);
    return reply.code(302).header('location', to).header('cache-control', 'no-store').type(TEXT).send(`Redirecting to ${to}`);
  });
}
