// LAN log collector. Lab builds and the on-TV self-test POST JSON results here; they land as
// NDJSON files (one per session) in a gitignored folder, where Claude sessions read them. This
// is how results get back from a TV that Claude cannot see.
//
//   POST /__lab/logs/:session   JSON object, JSON array, or NDJSON (application/x-ndjson or text/plain)
//   GET  /__lab/logs            sessions with line counts
//   GET  /__lab/logs/:session   the NDJSON (`?since=N` skips the first N lines)
//
// Records get a `_received` timestamp. No IP addresses are stored.

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

export const DEFAULT_LAB_LOG_DIR = join(import.meta.dirname, '..', '..', '..', 'artifacts', 'lab-logs');

const SESSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TEXT = 'text/plain; charset=utf-8';

export class LabLogError extends Error {}

/** Parses a POST body into records; throws LabLogError with the bad line number. */
export function toRecords(body: unknown): unknown[] {
  if (typeof body === 'string') {
    return body.split(/\r?\n/).flatMap((line, i) => {
      if (line.trim() === '') return [];
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        throw new LabLogError(`line ${i + 1} is not JSON`);
      }
    });
  }
  if (Array.isArray(body)) return body;
  if (body === undefined || body === null) return [];
  return [body];
}

export function registerLabLogs(app: FastifyInstance, dir: string): void {
  const queues = new Map<string, Promise<void>>();
  const fileOf = (session: string): string => join(dir, `${session}.ndjson`);

  /** Appends are serialised per session so concurrent POSTs never interleave lines. */
  const append = (session: string, text: string): Promise<void> => {
    const previous = queues.get(session) ?? Promise.resolve();
    const next = previous.then(async () => {
      await mkdir(dir, { recursive: true });
      await appendFile(fileOf(session), text, 'utf8');
    });
    queues.set(session, next.catch(() => undefined));
    return next;
  };

  app.addContentTypeParser('application/x-ndjson', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  app.post<{ Params: { session: string } }>('/__lab/logs/:session', { bodyLimit: 8 * 1024 * 1024 }, async (request, reply) => {
    const { session } = request.params;
    if (!SESSION.test(session)) return reply.code(400).type(TEXT).send('Bad session name (letters, digits, . _ -; max 64)');
    let records: unknown[];
    try {
      records = toRecords(request.body);
    } catch (error) {
      if (error instanceof LabLogError) return reply.code(400).type(TEXT).send(error.message);
      throw error;
    }
    const received = new Date().toISOString();
    const text = records
      .map((r) => JSON.stringify(r !== null && typeof r === 'object' && !Array.isArray(r) ? { _received: received, ...r } : { _received: received, value: r }))
      .map((line) => `${line}\n`)
      .join('');
    if (text !== '') await append(session, text);
    return { ok: true, session, lines: records.length };
  });

  app.get('/__lab/logs', async () => {
    if (!existsSync(dir)) return [];
    const files = (await readdir(dir)).filter((f) => f.endsWith('.ndjson'));
    const sessions = await Promise.all(
      files.map(async (file) => {
        const path = join(dir, file);
        const [info, text] = await Promise.all([stat(path), readFile(path, 'utf8')]);
        return {
          session: file.slice(0, -'.ndjson'.length),
          lines: text.split('\n').filter((l) => l !== '').length,
          bytes: info.size,
          modified: info.mtime.toISOString(),
        };
      }),
    );
    return sessions.sort((a, b) => b.modified.localeCompare(a.modified));
  });

  app.get<{ Params: { session: string }; Querystring: { since?: string } }>('/__lab/logs/:session', async (request, reply) => {
    const { session } = request.params;
    if (!SESSION.test(session)) return reply.code(400).type(TEXT).send('Bad session name');
    const path = fileOf(session);
    if (!existsSync(path)) return reply.code(404).type(TEXT).send('No such session');
    const lines = (await readFile(path, 'utf8')).split('\n').filter((l) => l !== '');
    const since = Math.max(0, Number(request.query.since ?? 0) || 0);
    const rest = lines.slice(since);
    return reply
      .type('application/x-ndjson; charset=utf-8')
      .header('x-lab-lines', String(lines.length))
      .send(rest.map((l) => `${l}\n`).join(''));
  });
}
