import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { ByteSource } from './bytes';
import { Fnv1a, NetworkError, decodeUtf8, fetchTransport, tapBytes } from './bytes';
import { GzipError, MaybeGunzip, hasNativeGunzip } from './gunzip';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A source that yields `parts` in order, then fails with `error` (if given) or ends. */
function source(parts: Uint8Array[], error?: Error): ByteSource & { cancelled: number } {
  const queue = parts.slice();
  const s = {
    cancelled: 0,
    read: async (): Promise<Uint8Array | null> => {
      const next = queue.shift();
      if (next) return next;
      if (error) throw error;
      return null;
    },
    cancel: () => {
      s.cancelled++;
      queue.length = 0;
    },
  };
  return s;
}

/** Splits `bytes` into pieces of the given sizes (the rest in one last piece). */
function split(bytes: Uint8Array, sizes: number[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  for (const n of sizes) {
    out.push(bytes.subarray(at, Math.min(bytes.length, at + n)));
    at += n;
  }
  if (at < bytes.length) out.push(bytes.subarray(at));
  return out;
}

async function readAll(s: ByteSource): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for (let c = await s.read(); c !== null; c = await s.read()) parts.push(c);
  return Buffer.concat(parts);
}

const fnv = (...parts: Uint8Array[]): string => {
  const h = new Fnv1a();
  for (const p of parts) h.update(p);
  return h.digest();
};

describe('Fnv1a', () => {
  it('matches the published FNV-1a 32-bit test vectors', () => {
    expect(fnv(utf8(''))).toBe('811c9dc5');
    expect(fnv(utf8('a'))).toBe('e40c292c');
    expect(fnv(utf8('foobar'))).toBe('bf9cf968');
  });

  it('gives the same digest and byte count however the bytes are chunked', () => {
    const bytes = utf8('#EXTM3U\n#EXTINF:-1 group-title="أخبار",قناة الجزيرة\nhttp://p.test/1.ts\n'.repeat(20));
    const whole = new Fnv1a();
    whole.update(bytes);
    for (const sizes of [[1], [7, 3, 1000], [2, 2, 2, 2, 2], [bytes.length - 1]]) {
      const h = new Fnv1a();
      for (const p of split(bytes, sizes)) h.update(p);
      expect([h.digest(), h.bytes]).toEqual([whole.digest(), bytes.length]);
    }
    const changed = bytes.slice();
    changed[100] = changed[100]! ^ 1;
    expect(fnv(changed)).not.toBe(whole.digest());
  });
});

describe('decodeUtf8', () => {
  it('keeps characters split across chunks whole and drops a leading BOM', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('قناة ١ – ok')]);
    for (let cut = 1; cut < bytes.length; cut++) {
      const text = decodeUtf8(source(split(bytes, [cut])));
      let out = '';
      for (let t = await text.read(); t !== null; t = await text.read()) out += t;
      expect(out).toBe('قناة ١ – ok');
    }
  });

  it('turns invalid bytes into U+FFFD instead of failing', async () => {
    const text = decodeUtf8(source([new Uint8Array([0x61, 0xff, 0x62])]));
    expect(await text.read()).toBe(`a${String.fromCharCode(0xfffd)}b`);
    expect(await text.read()).toBeNull();
  });

  it('cancels the bytes underneath', () => {
    const s = source([utf8('x')]);
    decodeUtf8(s).cancel();
    expect(s.cancelled).toBe(1);
  });
});

describe('tapBytes', () => {
  it('shows every chunk before passing it on', async () => {
    const seen: string[] = [];
    const s = tapBytes(source([utf8('ab'), utf8('c')]), (c) => seen.push(Buffer.from(c).toString()));
    expect(Buffer.from(await readAll(s)).toString()).toBe('abc');
    expect(seen).toEqual(['ab', 'c']);
  });
});

describe('fetchTransport', () => {
  const stream = (parts: Uint8Array[], error?: Error): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = parts.shift();
        if (next) controller.enqueue(next);
        else if (error) controller.error(error);
        else controller.close();
      },
    });

  it('streams the body, exposes status and headers, and sends the request headers', async () => {
    const fetchFn = vi.fn(async () => new Response(stream([utf8('ab'), utf8('cd')]), { status: 200, headers: { ETag: '"v1"' } }));
    const res = await fetchTransport(fetchFn).get('http://p.test/get.php?username=u&password=secret', { headers: { 'If-None-Match': '"v0"' } });
    expect(fetchFn).toHaveBeenCalledWith('http://p.test/get.php?username=u&password=secret', { headers: { 'If-None-Match': '"v0"' }, credentials: 'omit' });
    expect(res.status).toBe(200);
    expect(res.header('etag')).toBe('"v1"');
    expect(res.header('last-modified')).toBeNull();
    expect(Buffer.from(await readAll(res)).toString()).toBe('abcd');
    expect(await res.read()).toBeNull();
  });

  it('reports a failed request or a broken body as NetworkError without the URL', async () => {
    const url = 'http://p.test/get.php?username=u&password=secret';
    const refused = fetchTransport(async () => {
      throw new TypeError(`fetch failed: ${url}`);
    });
    const error = await refused.get(url).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).not.toContain('secret');

    const res = await fetchTransport(async () => new Response(stream([utf8('ab')], new Error(`reset ${url}`)))).get(url);
    expect(await res.read()).toEqual(utf8('ab'));
    const broken = await res.read().catch((e: unknown) => e);
    expect(broken).toBeInstanceOf(NetworkError);
    expect((broken as Error).message).not.toContain('secret');
  });

  it('cancels the body reader, after which reads end', async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(utf8('x'));
      },
      cancel() {
        cancelled++;
      },
    });
    const res = await fetchTransport(async () => new Response(body)).get('http://p.test/');
    expect(await res.read()).not.toBeNull();
    res.cancel();
    res.cancel();
    expect(await res.read()).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(cancelled).toBe(1);
  });

  it('answers a body-less response (304) with an immediate end', async () => {
    const res = await fetchTransport(async () => new Response(null, { status: 304 })).get('http://p.test/');
    expect(res.status).toBe(304);
    expect(await res.read()).toBeNull();
  });
});

describe('MaybeGunzip', () => {
  const text = '#EXTM3U\n' + Array.from({ length: 2000 }, (_, i) => `#EXTINF:-1,قناة ${i}\nhttp://p.test/${i}.ts\n`).join('');
  const plain = utf8(text);
  const gz = new Uint8Array(gzipSync(plain));

  it('passes non-gzip bytes through untouched, whatever the first chunk size', async () => {
    for (const first of [1, 2, 3]) {
      const g = new MaybeGunzip(source(split(plain, [first, 100])));
      expect(Buffer.from(await readAll(g)).toString()).toBe(text);
      expect([g.gzipped, g.engine]).toEqual([false, null]);
    }
  });

  it('treats an empty body and a lone 0x1f as plain', async () => {
    const empty = new MaybeGunzip(source([]));
    expect(await empty.read()).toBeNull();
    expect(empty.gzipped).toBe(false);
    const lone = new MaybeGunzip(source([new Uint8Array([0x1f])]));
    expect([...(await readAll(lone))]).toEqual([0x1f]);
    expect(lone.gzipped).toBe(false);
  });

  const engines = ['fflate', 'native'] as const;
  it('has DecompressionStream in this Node, so both engines are tested', () => {
    expect(hasNativeGunzip()).toBe(true);
  });

  for (const mode of engines) {
    describe(`with ${mode}`, () => {
      it('decompresses, with the magic split across the first two chunks', async () => {
        for (const sizes of [[1, 1, 50], [2], [gz.length]]) {
          const g = new MaybeGunzip(source(split(gz, sizes)), mode);
          expect(Buffer.from(await readAll(g)).toString()).toBe(text);
          expect([g.gzipped, g.engine]).toEqual([true, mode]);
        }
      });

      it('fails on a truncated body instead of returning less', async () => {
        const g = new MaybeGunzip(source([gz.subarray(0, gz.length - 40)]), mode);
        await expect(readAll(g)).rejects.toBeInstanceOf(GzipError);
      });

      it('fails on corrupt data', async () => {
        const bad = gz.slice();
        for (let i = 20; i < 60; i++) bad[i] = 0xff;
        const g = new MaybeGunzip(source([bad]), mode);
        await expect(readAll(g)).rejects.toBeInstanceOf(GzipError);
      });

      it('keeps a broken connection a NetworkError', async () => {
        const g = new MaybeGunzip(source([gz.subarray(0, 200)], new NetworkError('Connection lost')), mode);
        await expect(readAll(g)).rejects.toBeInstanceOf(NetworkError);
      });

      it('cancels the source underneath', async () => {
        const s = source(split(gz, [100, 100, 100]));
        const g = new MaybeGunzip(s, mode);
        expect(await g.read()).not.toBeNull();
        g.cancel();
        await new Promise((r) => setTimeout(r, 0));
        expect(s.cancelled).toBeGreaterThanOrEqual(1);
      });
    });
  }

  it('picks fflate in auto mode when the engine has no DecompressionStream', async () => {
    const original = globalThis.DecompressionStream;
    // @ts-expect-error -- simulating Chromium 53, which has no DecompressionStream
    delete globalThis.DecompressionStream;
    try {
      expect(hasNativeGunzip()).toBe(false);
      const g = new MaybeGunzip(source([gz]));
      expect(Buffer.from(await readAll(g)).toString()).toBe(text);
      expect(g.engine).toBe('fflate');
    } finally {
      globalThis.DecompressionStream = original;
    }
    const g = new MaybeGunzip(source([gz]));
    await readAll(g);
    expect(g.engine).toBe('native');
  });
});
