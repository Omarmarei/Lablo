import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from './engines';
import { cachedZipPath, ensureEngineZip } from './fetch';

const payload = Buffer.from('pretend this is chrome-linux.zip');
const engine: Engine = {
  id: 'chrome53',
  major: 53,
  position: 403380,
  sha256: createHash('sha256').update(payload).digest('hex'),
  bytes: payload.length,
  tvs: 'test',
};

const tempCache = (): string => mkdtempSync(path.join(tmpdir(), 'lablo-cache-'));
const quiet = (): void => undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ensureEngineZip', () => {
  it('reuses a cached zip that matches the pin, without downloading', async () => {
    const cache = tempCache();
    writeFileSync(cachedZipPath(cache, engine), payload);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(ensureEngineZip(engine, cache, quiet)).resolves.toBe(cachedZipPath(cache, engine));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('downloads a missing zip and verifies it', async () => {
    const cache = tempCache();
    const fetchSpy = vi.fn(async () => new Response(payload));
    vi.stubGlobal('fetch', fetchSpy);
    const file = await ensureEngineZip(engine, cache, quiet);
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/Linux_x64/403380/chrome-linux.zip'));
    expect(existsSync(file)).toBe(true);
  });

  it('replaces a corrupt cached zip', async () => {
    const cache = tempCache();
    writeFileSync(cachedZipPath(cache, engine), 'truncated');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)));
    await expect(ensureEngineZip(engine, cache, quiet)).resolves.toBe(cachedZipPath(cache, engine));
  });

  it('rejects and deletes a download that does not match the pinned SHA-256', async () => {
    const cache = tempCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('tampered or a different build!!'))));
    await expect(ensureEngineZip(engine, cache, quiet)).rejects.toThrow(/expected .* bytes with/);
    expect(readdirSync(cache)).toEqual([]);
  });

  it('reports an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 404 })));
    await expect(ensureEngineZip(engine, tempCache(), quiet)).rejects.toThrow(/HTTP 404/);
  });
});
