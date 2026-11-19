import type { DeviceInfo } from '@lablo/platform-api';
import { readTelemetryEvents } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import type { ProbeHost } from './telemetry-events';
import { COLD_START_MAX_MS, DEVICE_NAME_MAX, HEVC_TYPE, appStartEvent, capabilityEvent, deviceName, deviceProbes } from './telemetry-events';

// RELAY step 33b1: the start's events, in the shape the server's schema reads.

const AT = Date.UTC(2026, 10, 19, 9, 0, 0);

const INFO: DeviceInfo = {
  platform: 'tizen',
  model: 'UE43NU7100',
  modelYear: 2018,
  osVersion: '4.0',
  firmware: 'T-KTMDEUC-1250.4',
  chromiumVersion: 56,
  tier: 'low',
  locale: 'ar-SA',
  country: 'SA',
};

/** Every event the server keeps, and none dropped. */
function serverReads(event: unknown): boolean {
  const read = readTelemetryEvents([event]);
  return read.dropped === 0 && JSON.stringify(read.events[0]) === JSON.stringify(event);
}

describe('appStartEvent', () => {
  it('gives the tier, the cold start rounded and the catalog as its bucket', () => {
    const event = appStartEvent(AT, 'full', 1234.6, 4321);
    expect(event).toEqual({ kind: 'app_start', at: AT, tier: 'full', coldStartMs: 1235, catalog: '1k+' });
    expect(serverReads(event)).toBe(true);
    expect(appStartEvent(AT, 'low', 0.4, 0)).toEqual({ kind: 'app_start', at: AT, tier: 'low', coldStartMs: 0, catalog: '0' });
  });

  it('keeps the cold start in the schema: at most an hour, never below 0', () => {
    expect(COLD_START_MAX_MS).toBe(3_600_000);
    for (const [ms, kept] of [
      [1, 1],
      [0.5, 1],
      [3_600_000, 3_600_000],
      [3_600_000.4, 3_600_000],
      [3_600_001, 3_600_000],
      [9e9, 3_600_000],
      [-5, 0],
      [-0.4, 0],
      [Number.NaN, 0],
    ] as const) {
      const event = appStartEvent(AT, 'full', ms, 1);
      expect([ms, (event as { coldStartMs: number }).coldStartMs]).toEqual([ms, kept]);
      expect(serverReads(event)).toBe(true);
    }
  });
});

describe('deviceName', () => {
  it("keeps the protocol's characters and puts `_` for the others, at most 64, `unknown` when empty", () => {
    expect(DEVICE_NAME_MAX).toBe(64);
    expect(deviceName('UE43NU7100')).toBe('UE43NU7100');
    expect(deviceName('T-KTMDEUC-1250.4 (EU)+x_y')).toBe('T-KTMDEUC-1250.4 (EU)+x_y');
    expect(deviceName('webOS:6/03.34.95')).toBe('webOS_6_03.34.95');
    expect(deviceName('a@b,c;déب')).toBe('a_b_c_d__');
    expect(deviceName('')).toBe('unknown');
    expect(deviceName('x'.repeat(100))).toBe('x'.repeat(64));
    // Every character outside the set, and the edges of the ranges.
    const all = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i)).join('');
    const allowed = /[A-Za-z0-9 ._()+-]/;
    for (let i = 0; i < 128; i++) {
      const c = String.fromCharCode(i);
      expect([i, deviceName('a' + c)]).toEqual([i, allowed.test(c) ? 'a' + c : 'a_']);
    }
    expect(deviceName(all)).toHaveLength(64);
  });
});

describe('deviceProbes', () => {
  const host = (mse: unknown, canPlay: (type: string) => string): ProbeHost => ({ MediaSource: mse, document: { createElement: () => ({ canPlayType: canPlay }) } });

  it('reads MediaSource and an HEVC MP4 from the video element', () => {
    const asked: string[] = [];
    const probes = deviceProbes(
      host(
        function MediaSource() {
          return undefined;
        },
        (type) => {
          asked.push(type);
          return 'maybe';
        },
      ),
    );
    expect(probes).toEqual({ mse: true, hevc: true });
    expect(asked).toEqual([HEVC_TYPE]);
    expect(HEVC_TYPE).toBe('video/mp4; codecs="hvc1.1.6.L93.B0"');
    expect(deviceProbes(host(undefined, () => ''))).toEqual({ mse: false, hevc: false });
    expect(deviceProbes(host({}, () => 'probably'))).toEqual({ mse: false, hevc: true });
  });

  it('counts a probe that throws as no', () => {
    expect(
      deviceProbes(
        host(undefined, () => {
          throw new Error('no video');
        }),
      ),
    ).toEqual({ mse: false, hevc: false });
  });
});

describe('capabilityEvent', () => {
  it('gives the model, the firmware, the Chromium major and the probes, which the server reads whole', () => {
    const event = capabilityEvent(AT, INFO, { mse: true, hevc: false });
    expect(event).toEqual({
      kind: 'capability',
      at: AT,
      model: 'UE43NU7100',
      firmware: 'T-KTMDEUC-1250.4',
      chromium: 56,
      probes: { lowTier: true, mse: true, hevc: false, year: 2018 },
    });
    expect(serverReads(event)).toBe(true);
  });

  it('leaves out an unknown year, makes names fit, and keeps only a Chromium major the schema takes', () => {
    const event = capabilityEvent(AT, { ...INFO, model: 'OLED55A1/PVA', firmware: '', modelYear: null, tier: 'full', chromiumVersion: null }, { mse: false, hevc: true });
    expect(event).toEqual({ kind: 'capability', at: AT, model: 'OLED55A1_PVA', firmware: 'unknown', chromium: null, probes: { lowTier: false, mse: false, hevc: true } });
    expect(serverReads(event)).toBe(true);
    for (const [chromium, kept] of [
      [1, 1],
      [999, 999],
      [0, null],
      [1000, null],
      [68.5, null],
      [-3, null],
    ] as const) {
      const odd = capabilityEvent(AT, { ...INFO, chromiumVersion: chromium }, { mse: true, hevc: true });
      expect([chromium, (odd as { chromium: number | null }).chromium]).toEqual([chromium, kept]);
      expect(serverReads(odd)).toBe(true);
    }
  });

  it('never carries the locale, the country, the OS version or the platform facts', () => {
    const event = capabilityEvent(AT, { ...INFO, details: { secret: 'x' } }, { mse: true, hevc: true });
    const text = JSON.stringify(event);
    for (const left of ['ar-SA', '"SA"', '4.0', 'secret', 'tizen']) expect(text).not.toContain(left);
  });
});
