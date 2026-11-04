import { describe, expect, it } from 'vitest';
import type { FetchLimits, XhrLike } from './subtitle-loader';
import { MAX_SUBTITLE_BYTES, SUBTITLE_TIMEOUT_MS, createSubtitleLoader, decodeSubtitleBytes, fetchBytes } from './subtitle-loader';

/** The app's subtitle files (RELAY step 20b2b): the fetch with its limits, the charset, the parse. */

function bytes(list: readonly number[]): ArrayBuffer {
  const out = new ArrayBuffer(list.length);
  const view = new DataView(out);
  list.forEach((b, i) => view.setUint8(i, b));
  return out;
}

function utf8(text: string): ArrayBuffer {
  return bytes(Array.from(Buffer.from(text, 'utf8')));
}

/** ا ل س ل ا م ("peace") in Arabic letters. */
const SALAM = String.fromCharCode(0x627, 0x644, 0x633, 0x644, 0x627, 0x645);
/** The same word in Windows-1256. */
const SALAM_1256 = [0xc7, 0xe1, 0xd3, 0xe1, 0xc7, 0xe3];

describe('decodeSubtitleBytes', () => {
  it('reads UTF-8, with or without its mark', () => {
    expect(decodeSubtitleBytes(utf8(`a ${SALAM} é`), 'ar')).toBe(`a ${SALAM} é`);
    expect(decodeSubtitleBytes(bytes([0xef, 0xbb, 0xbf, 0x41]), 'en')).toBe('A');
    expect(decodeSubtitleBytes(bytes([]), 'en')).toBe('');
    expect(decodeSubtitleBytes(bytes([0x41]), 'en')).toBe('A');
  });

  it('reads UTF-16 by its mark, either way round', () => {
    expect(decodeSubtitleBytes(bytes([0xff, 0xfe, 0x41, 0x00, 0x27, 0x06]), 'en')).toBe('A' + String.fromCharCode(0x627));
    expect(decodeSubtitleBytes(bytes([0xfe, 0xff, 0x00, 0x41, 0x06, 0x27]), 'en')).toBe('A' + String.fromCharCode(0x627));
  });

  it("reads a file that isn't UTF-8 in its language's Windows code page: 1256 for Arabic script or no language, 1252 for the rest", () => {
    expect(decodeSubtitleBytes(bytes(SALAM_1256), 'ara')).toBe(SALAM);
    expect(decodeSubtitleBytes(bytes(SALAM_1256), 'fa')).toBe(SALAM);
    expect(decodeSubtitleBytes(bytes(SALAM_1256), 'urd')).toBe(SALAM);
    expect(decodeSubtitleBytes(bytes(SALAM_1256), '')).toBe(SALAM);
    expect(decodeSubtitleBytes(bytes(SALAM_1256), 'und')).toBe(SALAM);
    // "São" in Windows-1252; 0xE3 is م in 1256.
    expect(decodeSubtitleBytes(bytes([0x53, 0xe3, 0x6f]), 'por')).toBe('São');
    expect(decodeSubtitleBytes(bytes([0x53, 0xe3, 0x6f]), 'en')).toBe('São');
  });
});

class FakeXhr implements XhrLike {
  readyState = 0;
  status = 0;
  response: unknown = null;
  responseType: XMLHttpRequestResponseType = '';
  timeout = 0;
  onreadystatechange: (() => void) | null = null;
  onprogress: ((event: { readonly loaded: number }) => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  readonly calls: string[] = [];
  private headers: Record<string, string> = {};

  open(method: string, url: string, async: boolean): void {
    this.calls.push(`open ${method} ${url} ${String(async)}`);
  }
  send(): void {
    this.calls.push(`send ${this.responseType} ${this.timeout}`);
  }
  abort(): void {
    this.calls.push('abort');
  }
  getResponseHeader(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null;
  }

  /** The headers arrive. */
  head(status: number, headers: Record<string, string> = {}): void {
    this.status = status;
    this.headers = headers;
    this.readyState = 2;
    this.onreadystatechange?.();
    this.readyState = 3;
    this.onreadystatechange?.();
  }
  progress(loaded: number): void {
    this.onprogress?.({ loaded });
  }
  load(body: ArrayBuffer | null): void {
    this.response = body;
    this.readyState = 4;
    this.onreadystatechange?.();
    this.onload?.();
  }
}

const LIMITS: FetchLimits = { maxBytes: 10, timeoutMs: 1234 };

function start(): { xhr: FakeXhr; result: Promise<ArrayBuffer> } {
  const xhr = new FakeXhr();
  return { xhr, result: fetchBytes('http://p.example/subs/1.srt?token=secret', LIMITS, () => xhr) };
}

describe('fetchBytes', () => {
  it('GETs the bytes with the timeout', async () => {
    const { xhr, result } = start();
    xhr.head(200, { 'content-length': '10' });
    xhr.progress(10);
    const body = bytes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    xhr.load(body);
    await expect(result).resolves.toBe(body);
    expect(xhr.calls).toEqual(['open GET http://p.example/subs/1.srt?token=secret true', 'send arraybuffer 1234']);
  });

  it('refuses a file over the limit by its length header, as it arrives, or once loaded, and stops the download', async () => {
    const byHeader = start();
    byHeader.xhr.head(200, { 'content-length': '11' });
    await expect(byHeader.result).rejects.toThrow('too big');
    expect(byHeader.xhr.calls).toContain('abort');
    // Later progress and a load change nothing.
    byHeader.xhr.progress(20);
    byHeader.xhr.load(bytes([1]));
    expect(byHeader.xhr.calls.filter((c) => c === 'abort')).toHaveLength(1);

    const byProgress = start();
    byProgress.xhr.head(200);
    byProgress.xhr.progress(10);
    byProgress.xhr.progress(11);
    await expect(byProgress.result).rejects.toThrow('too big');
    expect(byProgress.xhr.calls).toContain('abort');

    const byBody = start();
    byBody.xhr.head(200);
    byBody.xhr.load(bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    await expect(byBody.result).rejects.toThrow('too big');
  });

  it('refuses an HTTP error, a missing body, a network error and the timeout, without the URL', async () => {
    for (const status of [404, 199, 300, 0]) {
      const r = start();
      r.xhr.head(status);
      r.xhr.load(bytes([1]));
      await expect(r.result).rejects.toThrow(`HTTP ${status}`);
    }
    const empty = start();
    empty.xhr.head(200);
    empty.xhr.load(null);
    await expect(empty.result).rejects.toThrow('HTTP 200');
    const ok = start();
    ok.xhr.head(299);
    ok.xhr.load(bytes([1]));
    await expect(ok.result).resolves.toBeDefined();

    const offline = start();
    offline.xhr.onerror?.();
    await expect(offline.result).rejects.toThrow('network error');
    const slow = start();
    slow.xhr.ontimeout?.();
    const error = await slow.result.then(
      () => new Error('loaded'),
      (e: unknown) => e as Error,
    );
    expect(error.message).toBe('The subtitle file was not loaded: timeout');
    expect(error.message).not.toContain('secret');
  });
});

describe('createSubtitleLoader', () => {
  it('fetches with the app limits, decodes by the language and parses in the file format', async () => {
    const asked: string[] = [];
    const files: Record<string, ArrayBuffer> = {
      'http://p/en.vtt': utf8('1\n00:00:01.000 --> 00:00:02.000\nHello &amp; bye\n'),
      'http://p/ar.srt': bytes([...Array.from(Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n', 'ascii')), ...SALAM_1256, 0x0a]),
    };
    const load = createSubtitleLoader((url, limits) => {
      asked.push(`${url} ${limits.maxBytes} ${limits.timeoutMs}`);
      const file = files[url];
      return file === undefined ? Promise.reject(new Error('404')) : Promise.resolve(file);
    });
    // In the file's format: only WebVTT decodes entities (this one has no header to say so).
    expect(await load({ lang: 'en', url: 'http://p/en.vtt', fmt: 'vtt' })).toEqual([{ startMs: 1000, endMs: 2000, text: 'Hello & bye' }]);
    expect(await load({ lang: 'ara', url: 'http://p/ar.srt', fmt: 'srt' })).toEqual([{ startMs: 1000, endMs: 2000, text: SALAM }]);
    await expect(load({ lang: 'en', url: 'http://p/none.srt', fmt: 'srt' })).rejects.toThrow('404');
    expect(asked).toEqual([`http://p/en.vtt ${MAX_SUBTITLE_BYTES} ${SUBTITLE_TIMEOUT_MS}`, `http://p/ar.srt ${MAX_SUBTITLE_BYTES} ${SUBTITLE_TIMEOUT_MS}`, `http://p/none.srt ${MAX_SUBTITLE_BYTES} ${SUBTITLE_TIMEOUT_MS}`]);
    expect(MAX_SUBTITLE_BYTES).toBe(4 * 1024 * 1024);
  });
});
