import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGINE_HOUR, FIXED_ZONES, IMAGE_FILES, engineZone, imageTag, zoneOffset } from './docker';

function context(dockerfile: string, script: string, server = 'echo 1\n'): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'lablo-docker-'));
  writeFileSync(path.join(dir, 'Dockerfile'), dockerfile);
  writeFileSync(path.join(dir, 'run-chrome.sh'), script);
  writeFileSync(path.join(dir, 'serve-fixture.sh'), server);
  return dir;
}

describe('imageTag', () => {
  it('is the same for LF and CRLF checkouts, so Windows and CI share one tag', () => {
    const lf = imageTag(context('FROM debian\nRUN true\n', '#!/bin/sh\nexec chrome\n', 'a = 1\nb = 2\n'));
    const crlf = imageTag(context('FROM debian\r\nRUN true\r\n', '#!/bin/sh\r\nexec chrome\r\n', 'a = 1\r\nb = 2\r\n'));
    expect(lf).toMatch(/^lablo-old-engines:[0-9a-f]{12}$/);
    expect(crlf).toBe(lf);
  });

  it('changes when the Dockerfile, the start script or the fixture server changes', () => {
    const base = imageTag(context('FROM debian\n', 'exec chrome\n'));
    expect(imageTag(context('FROM debian:stretch\n', 'exec chrome\n'))).not.toBe(base);
    expect(imageTag(context('FROM debian\n', 'exec chrome --flag\n'))).not.toBe(base);
    expect(imageTag(context('FROM debian\n', 'exec chrome\n', 'echo 2\n'))).not.toBe(base);
  });

  it('hashes every file the real Dockerfile copies into the image', () => {
    const dir = path.join(import.meta.dirname, '..', 'docker');
    const dockerfile = readFileSync(path.join(dir, 'Dockerfile'), 'utf8');
    const copied = [...dockerfile.matchAll(/^COPY (.+) \S+$/gm)].flatMap((m) => (m[1] ?? '').split(/\s+/));
    expect(copied.length).toBeGreaterThan(0);
    for (const name of copied) expect(IMAGE_FILES).toContain(name);
    for (const name of IMAGE_FILES) expect(existsSync(path.join(dir, name))).toBe(true);
  });
});

describe('engineZone (RELAY step 26q)', () => {
  /** The hour and minute at `ms` in `zone`, by Node's own ICU. */
  const there = (ms: number, zone: string): string => new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms);

  it('puts every moment of the day in the hour asked for, 21 by default', () => {
    expect(ENGINE_HOUR).toBe(21);
    const day = Date.UTC(2026, 10, 11);
    for (let minute = 0; minute < 24 * 60; minute += 15) {
      const ms = day + minute * 60_000;
      const zone = engineZone(ms);
      expect(there(ms, zone).slice(0, 2), `${minute} min after UTC midnight in ${zone}`).toBe('21');
      expect(there(ms, zone).slice(3)).toBe(new Date(ms).toISOString().slice(14, 16));
      for (const hour of [0, 7, 23]) expect(there(ms, engineZone(ms, hour)).slice(0, 2)).toBe(String(hour).padStart(2, '0'));
    }
  });

  it('is one of the fixed zones, −11 to +12 hours, each at its offset all year and named without a digit', () => {
    // 21:15 UTC (PR #66's run): UTC itself.
    expect(engineZone(Date.UTC(2026, 10, 11, 21, 15))).toBe('Etc/UTC');
    expect(engineZone(Date.UTC(2026, 10, 11, 20, 0))).toBe('Africa/Lagos');
    expect(engineZone(Date.UTC(2026, 10, 11, 9, 0))).toBe('Pacific/Tarawa');
    expect(engineZone(Date.UTC(2026, 10, 11, 8, 0))).toBe('Pacific/Pago_Pago');
    // PR #68's first run: 22:00 UTC, where Etc/GMT+1 left Chromium 68 in UTC.
    expect(engineZone(Date.UTC(2026, 10, 11, 22, 0))).toBe('Atlantic/Cape_Verde');
    const offsets = Object.keys(FIXED_ZONES).map(Number).sort((a, b) => a - b);
    expect(offsets).toEqual(Array.from({ length: 24 }, (_v, i) => i - 11));
    // Each zone's offset in Node's own zone data, on the first of every month of two years (no
    // daylight saving time), against getTimezoneOffset's sign: UTC minus local.
    const offsetAt = (ms: number, zone: string): number => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(ms);
      const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
      const m = /GMT(?:([+-])(\d\d):(\d\d))?$/.exec(name);
      if (m === null) throw new Error(`${zone}: ${name}`);
      // (`0 -`: never −0, which `toBe` tells from 0.)
      return m[1] === undefined ? 0 : 0 - (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3]));
    };
    for (const hours of offsets) {
      const zone = FIXED_ZONES[hours]!;
      // ICU ignores a TZ with a digit (Chromium 68).
      expect(zone, zone).not.toMatch(/\d/);
      expect(zoneOffset(zone)).toBe(0 - hours * 60);
      for (let month = 0; month < 24; month += 1) expect(offsetAt(Date.UTC(2026, month, 1), zone), `${zone} in month ${month}`).toBe(0 - hours * 60);
    }
    expect(() => zoneOffset('Asia/Riyadh')).toThrow(/not one of the engines' fixed zones/);
  });

  it('refuses an hour out of the day', () => {
    for (const hour of [-1, 24, 1.5, Number.NaN]) expect(() => engineZone(0, hour)).toThrow(/must be 0 to 23/);
  });
});
