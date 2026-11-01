import { describe, expect, it } from 'vitest';
import { ENGINES, chromeMajor, selectEngines, snapshotUrl } from './engines';

describe('engine table', () => {
  it('covers the TV engines: Chromium 53 (webOS 4), 56 (Tizen 4) and 68 (2020 sets)', () => {
    expect(ENGINES.map((engine) => engine.major)).toEqual([53, 56, 68]);
    for (const engine of ENGINES) {
      expect(engine.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(engine.bytes).toBeGreaterThan(50_000_000);
      expect(engine.id).toBe(`chrome${engine.major}`);
    }
    expect(new Set(ENGINES.map((engine) => engine.position)).size).toBe(ENGINES.length);
  });

  it('builds the snapshot bucket URL', () => {
    expect(snapshotUrl({ position: 403380 })).toBe(
      'https://commondatastorage.googleapis.com/chromium-browser-snapshots/Linux_x64/403380/chrome-linux.zip',
    );
  });

  it('selects engines by id, all by default, and rejects unknown ids', () => {
    expect(selectEngines([])).toHaveLength(ENGINES.length);
    expect(selectEngines(['chrome56']).map((engine) => engine.major)).toEqual([56]);
    expect(() => selectEngines(['chrome53', 'chrome99'])).toThrow(/unknown --engine chrome99/);
  });

  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.0 Safari/537.36', 53],
    ['Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36', 68],
    ['Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36', null],
    ['', null],
  ])('reads the Chrome major from %j', (userAgent, major) => {
    expect(chromeMajor(userAgent)).toBe(major);
  });
});
