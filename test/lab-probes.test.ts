// The Lablo Lab's stream reader (apps/tv/src/lab/probes.ts) against the mock's /__lab/bytes probe
// (apps/mock-provider/src/lab-probes.ts) over a real socket: the two independent copies of the
// line format agree, and the reader catches a body that doesn't match (RELAY step 15a).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { labLine as mockLine } from '../apps/mock-provider/src/lab-probes';
import type { MockServer } from '../apps/mock-provider/src/server';
import { listen, mock } from '../apps/mock-provider/test/helpers';
import { LineChecker, labLine, readLabStream, textDecoderSplits } from '../apps/tv/src/lab/probes';

let app: MockServer;
let base: string;

beforeAll(async () => {
  app = await mock();
  base = await listen(app);
});
afterAll(async () => {
  await app.close();
});

describe('the lab stream probe', () => {
  it('writes the same lines as the mock', () => {
    for (const n of [0, 1, 9, 10, 42, 99_999, 123_456, 999_999]) expect(labLine(n)).toBe(mockLine(n));
  });

  it('reads /__lab/bytes as a stream, cut mid-character, line for line', async () => {
    const report = await readLabStream((url) => fetch(url), `${base}/__lab/bytes?lines=5000&chunk=7&delay=0`);
    expect(report).toMatchObject({ bytes: 5000 * 33, lines: 5000, badLine: null });
    expect(report.chunks).toBeGreaterThan(1);
  });

  it('names the first wrong line, and a body cut short', () => {
    const checker = new LineChecker();
    checker.push(labLine(0) + labLine(1).replace('Lablo', 'Labla') + labLine(2) + labLine(4));
    checker.end();
    expect({ lines: checker.lines, bad: checker.badLine }).toEqual({ lines: 4, bad: 1 });
    const cut = new LineChecker();
    cut.push(labLine(0) + labLine(1).slice(0, 10));
    cut.end();
    expect({ lines: cut.lines, bad: cut.badLine }).toEqual({ lines: 1, bad: 1 });
    // One line pushed in pieces is still one good line.
    const pieces = new LineChecker();
    for (const ch of Array.from(labLine(0) + labLine(1))) pieces.push(ch);
    pieces.end();
    expect({ lines: pieces.lines, bad: pieces.badLine }).toEqual({ lines: 2, bad: null });
  });

  it('fails on an HTTP error or a response without a body stream', async () => {
    await expect(readLabStream((url) => fetch(url), `${base}/__lab/bytes?lines=-1`)).rejects.toThrow('HTTP 400');
    await expect(readLabStream(() => Promise.resolve({ ok: true, status: 200, body: null }), 'x')).rejects.toThrow('no response.body stream');
  });

  it('decodes every split of multi-byte text with a streaming TextDecoder', () => {
    expect(textDecoderSplits()).toEqual({ splits: 329, wrong: [] });
  });
});
