import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { toRecords } from '../src/lab-logs';
import type { MockServer } from '../src/server';
import { mock } from './helpers';

let app: MockServer;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zoma-lab-logs-'));
  app = await mock({ labLogDir: dir });
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const post = (session: string, payload: string | object, contentType = 'application/json') =>
  app.inject({
    method: 'POST',
    url: `/__lab/logs/${session}`,
    headers: { 'content-type': contentType },
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

const lines = (text: string) => text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>);

describe('LAN log collector', () => {
  it('stores a JSON object as one NDJSON line with a receipt time', async () => {
    const res = await post('s1-lg-oled', { spike: 'S1', device: 'LG OLED55', ok: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, session: 's1-lg-oled', lines: 1 });
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const stored = lines(await readFile(join(dir, 's1-lg-oled.ndjson'), 'utf8'));
    expect(stored).toEqual([{ _received: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), spike: 'S1', device: 'LG OLED55', ok: true }]);
  });

  it('accepts JSON arrays, NDJSON and text/plain (a CORS-simple request)', async () => {
    expect((await post('batch', [{ n: 1 }, { n: 2 }, { n: 3 }])).json()).toMatchObject({ lines: 3 });
    expect((await post('batch', '{"n":4}\n\n{"n":5}\r\n', 'application/x-ndjson')).json()).toMatchObject({ lines: 2 });
    expect((await post('batch', '{"n":6}\n', 'text/plain')).json()).toMatchObject({ lines: 1 });
    expect((await post('batch', [42])).json()).toMatchObject({ lines: 1 });
    const res = await app.inject({ url: '/__lab/logs/batch' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
    expect(res.headers['x-lab-lines']).toBe('7');
    expect(lines(res.body).map((r) => r['n'] ?? r['value'])).toEqual([1, 2, 3, 4, 5, 6, 42]);
  });

  it('reads back from a line offset and lists sessions', async () => {
    await post('a', [{ i: 0 }, { i: 1 }, { i: 2 }]);
    await post('b', { i: 0 });
    const tail = await app.inject({ url: '/__lab/logs/a?since=2' });
    expect(lines(tail.body)).toEqual([expect.objectContaining({ i: 2 })]);
    expect(tail.headers['x-lab-lines']).toBe('3');
    const list = (await app.inject({ url: '/__lab/logs' })).json<{ session: string; lines: number; bytes: number }[]>();
    expect(list.map((s) => [s.session, s.lines]).sort()).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
    expect(list.every((s) => s.bytes > 0)).toBe(true);
  });

  it('keeps concurrent posts to one session on separate, whole lines', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => post('busy', { i, pad: 'x'.repeat(2000) })));
    const stored = lines(await readFile(join(dir, 'busy.ndjson'), 'utf8'));
    expect(stored.map((r) => r['i']).sort((x, y) => Number(x) - Number(y))).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('rejects bad session names and bad lines, and 404s unknown sessions', async () => {
    expect((await post('..%2Fescape', { x: 1 })).statusCode).toBe(400);
    expect((await post('.hidden', { x: 1 })).statusCode).toBe(400);
    expect((await post('a'.repeat(65), { x: 1 })).statusCode).toBe(400);
    const badLine = await post('s', '{"ok":1}\nnot json\n', 'text/plain');
    expect(badLine.statusCode).toBe(400);
    expect(badLine.body).toBe('line 2 is not JSON');
    expect((await app.inject({ url: '/__lab/logs/never' })).statusCode).toBe(404);
    expect((await app.inject({ url: '/__lab/logs/..%2Fescape' })).statusCode).toBe(400);
  });

  it('answers an empty list before anything was logged', async () => {
    await rm(dir, { recursive: true, force: true });
    expect((await app.inject({ url: '/__lab/logs' })).json()).toEqual([]);
  });

  it('parses bodies into records', () => {
    expect(toRecords('{"a":1}\n\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }]);
    expect(toRecords({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toRecords([1, 2])).toEqual([1, 2]);
    expect(toRecords(undefined)).toEqual([]);
    expect(() => toRecords('{')).toThrow('line 1 is not JSON');
  });
});

describe('LAN log collector disabled', () => {
  it('is absent when labLogDir is null (e.g. on a public test server)', async () => {
    const off = await mock({ labLogDir: null });
    expect((await off.inject({ method: 'POST', url: '/__lab/logs/x', payload: { a: 1 } })).statusCode).toBe(404);
    await off.close();
  });
});
