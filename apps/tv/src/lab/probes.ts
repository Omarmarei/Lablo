/**
 * The lab's side of the mock's `/__lab/bytes` probe (apps/mock-provider/src/lab-probes.ts),
 * shared by the page and the lab worker: S1's streamed fetch and TextDecoder checks.
 *
 * `labLine` is this app's own copy on purpose: the mock is an independent oracle, so a bug in
 * one copy shows as a mismatch instead of hiding in both.
 */

/** Line `n` of `/__lab/bytes`: `000042 Zoma زوما ✓ 😀\n` (30 bytes in UTF-8). */
export function labLine(n: number): string {
  let digits = String(n);
  while (digits.length < 6) digits = `0${digits}`;
  return `${digits} Zoma \u0632\u0648\u0645\u0627 \u2713 \uD83D\uDE00\n`;
}

/** What a streamed read of `/__lab/bytes` saw. */
export interface StreamReport {
  readonly bytes: number;
  /** Reads that returned data: more than one proves the body streamed in pieces. */
  readonly chunks: number;
  readonly lines: number;
  /** The first line that differs from `labLine`, or null when all match. */
  readonly badLine: number | null;
  /** From the request to the response headers, and to the end of the body. */
  readonly headersMs: number;
  readonly totalMs: number;
}

/** The parts of a fetch `Response` a streamed read uses (old engines may lack `body`). */
interface StreamResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
}

/** Checks decoded text line by line against `labLine` as it arrives. */
export class LineChecker {
  private buffer = '';
  lines = 0;
  badLine: number | null = null;

  push(text: string): void {
    this.buffer += text;
    let start = 0;
    let nl = this.buffer.indexOf('\n', start);
    while (nl !== -1) {
      const line = this.buffer.slice(start, nl + 1);
      if (this.badLine === null && line !== labLine(this.lines)) this.badLine = this.lines;
      this.lines += 1;
      start = nl + 1;
      nl = this.buffer.indexOf('\n', start);
    }
    this.buffer = this.buffer.slice(start);
  }

  /** The end of the body: a partial last line counts as a bad line. */
  end(): void {
    if (this.buffer !== '' && this.badLine === null) this.badLine = this.lines;
    this.buffer = '';
  }
}

/**
 * GETs `url` (a `/__lab/bytes` address) and reads the body through `response.body.getReader()`
 * and a streaming TextDecoder, the way the ingest worker reads a playlist.
 */
export async function readLabStream(
  fetchFn: (url: string) => Promise<StreamResponse>,
  url: string,
  clock: () => number = () => Date.now(),
): Promise<StreamReport> {
  const started = clock();
  const response = await fetchFn(url);
  const headersMs = clock() - started;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = response.body;
  if (body === undefined || body === null || typeof body.getReader !== 'function') throw new Error('no response.body stream');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const checker = new LineChecker();
  let bytes = 0;
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    chunks += 1;
    bytes += value.length;
    checker.push(decoder.decode(value, { stream: true }));
  }
  checker.push(decoder.decode());
  checker.end();
  return { bytes, chunks, lines: checker.lines, badLine: checker.badLine, headersMs, totalMs: clock() - started };
}

/**
 * TextDecoder with `stream: true` across every possible split of ten lab lines (each split
 * point once, so every multi-byte character is cut at each of its bytes). Returns the split
 * points that decoded wrong.
 */
export function textDecoderSplits(): { readonly splits: number; readonly wrong: number[] } {
  let text = '';
  for (let n = 0; n < 10; n += 1) text += labLine(n);
  const bytes = new TextEncoder().encode(text);
  const wrong: number[] = [];
  for (let cut = 1; cut < bytes.length; cut += 1) {
    const decoder = new TextDecoder('utf-8');
    const out = decoder.decode(bytes.subarray(0, cut), { stream: true }) + decoder.decode(bytes.subarray(cut));
    if (out !== text) wrong.push(cut);
  }
  return { splits: bytes.length - 1, wrong };
}
