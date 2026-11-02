// The EPG benchmark (tools/bench) can't import tools/fixtures (tools may only use core,
// protocol and crypto), so it repeats the scale guide's anchor; this checks they agree, and
// that the limits architecture.md §1.5 step 10 derives belong to real cases.

import { describe, expect, it } from 'vitest';
import { EPG_BENCH_NOW, EPG_LIMITS, SUITES } from '../tools/bench/src/suites';
import { XMLTV_ANCHOR_MS, XMLTV_DAYS } from '../tools/fixtures/src/xmltv';

describe('EPG benchmark constants', () => {
  it('centres the window on the scale guide, which spans 7 days either side', () => {
    expect(EPG_BENCH_NOW).toBe(XMLTV_ANCHOR_MS);
    expect(XMLTV_DAYS).toBe(14);
  });

  it('limits real cases over the 300 MB guide', () => {
    for (const [name, limit] of Object.entries(EPG_LIMITS)) {
      expect(SUITES[name]?.input, name).toBe('xmltv-300mb.xml.gz');
      expect(limit.medianMs).toBeGreaterThan(0);
    }
  });
});
