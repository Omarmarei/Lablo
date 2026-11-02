import { describe, expect, it } from 'vitest';
import { UTC_ZONE, clockOffset, fixedZone, intlZone, panelZone, wallParts } from './timezone';

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const NOW_SEC = NOW / 1000;

describe('intlZone', () => {
  it('gives offsets, with DST, for IANA zones', () => {
    expect(intlZone('Asia/Kathmandu')!(NOW)).toBe(345);
    expect(intlZone('Asia/Riyadh')!(NOW)).toBe(180);
    expect(intlZone('UTC')!(NOW)).toBe(0);
    const ny = intlZone('America/New_York')!;
    expect(ny(Date.UTC(2026, 0, 15))).toBe(-300);
    expect(ny(Date.UTC(2026, 6, 15))).toBe(-240);
    // Around the 2026-11-01 06:00 UTC change back to EST.
    expect(ny(Date.UTC(2026, 10, 1, 5, 59))).toBe(-240);
    expect(ny(Date.UTC(2026, 10, 1, 6, 0))).toBe(-300);
    // Midnight wall time (some engines print hour 24).
    expect(intlZone('Asia/Dubai')!(Date.UTC(2026, 10, 1, 20, 0))).toBe(240);
  });

  it('is null for names the engine does not know', () => {
    expect(intlZone('Mars/Olympus_Mons')).toBeNull();
    expect(intlZone('')).toBeNull();
  });
});

describe('clockOffset', () => {
  it('derives the panel offset from time_now and timestamp_now', () => {
    expect(clockOffset('2026-11-02 17:45:00', NOW_SEC)).toBe(345);
    expect(clockOffset('2026-11-02 07:00:00', NOW_SEC)).toBe(-300);
    expect(clockOffset('2026-11-02T12:00', NOW_SEC)).toBe(0);
    // A panel clock a few minutes off still rounds to the zone.
    expect(clockOffset('2026-11-02 15:04:10', NOW_SEC)).toBe(180);
    expect(clockOffset('2026-11-02 14:53:00', NOW_SEC)).toBe(180);
  });

  it('is null when it cannot tell', () => {
    expect(clockOffset(null, NOW_SEC)).toBeNull();
    expect(clockOffset('2026-11-02 12:00:00', null)).toBeNull();
    expect(clockOffset('yesterday', NOW_SEC)).toBeNull();
    expect(clockOffset('2026-11-04 12:00:00', NOW_SEC)).toBeNull();
  });
});

describe('panelZone', () => {
  const server = (timezone: string | null, timeNow: string | null) => ({ timezone, timeNow, timestampNow: timeNow === null ? null : NOW_SEC });

  it('uses Intl when it agrees with the panel clock', () => {
    const zone = panelZone(server('America/New_York', '2026-11-02 07:00:00'));
    expect(zone.source).toBe('intl');
    expect(zone.offset(Date.UTC(2026, 9, 25))).toBe(-240);
  });

  it('falls back to the panel clock when Intl is missing, unknown or disagrees', () => {
    expect(panelZone(server('Mars/Olympus_Mons', '2026-11-02 17:45:00'))).toMatchObject({ source: 'clock', name: 'Mars/Olympus_Mons' });
    const wrongName = panelZone(server('Europe/London', '2026-11-02 15:00:00'));
    expect(wrongName.source).toBe('clock');
    expect(wrongName.offset(NOW)).toBe(180);
    expect(panelZone(server(null, '2026-11-02 17:45:00')).offset(0)).toBe(345);
  });

  it('uses Intl alone without a clock, and UTC with nothing', () => {
    expect(panelZone(server('Asia/Kathmandu', null)).source).toBe('intl');
    expect(panelZone(null)).toMatchObject({ source: 'utc', name: null });
    expect(panelZone(server(null, null)).offset(NOW)).toBe(0);
  });
});

describe('wallParts', () => {
  it('shifts an instant into a zone', () => {
    expect(wallParts(NOW, fixedZone(345))).toEqual({ year: 2026, month: 11, day: 2, hour: 17, minute: 45, second: 0 });
    expect(wallParts(Date.UTC(2026, 0, 1, 1, 0, 5), fixedZone(-120))).toEqual({ year: 2025, month: 12, day: 31, hour: 23, minute: 0, second: 5 });
    expect(wallParts(NOW, UTC_ZONE).hour).toBe(12);
  });
});
