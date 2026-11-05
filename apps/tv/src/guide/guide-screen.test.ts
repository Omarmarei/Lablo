import type { GuideSchedule } from '@zoma/ui';
import { guideZone } from '@zoma/ui';
import { describe, expect, it } from 'vitest';
import type { Guide } from './guide-state';
import { guideDetails } from './GuideScreen';

/** A guide from 1,000 to 2,440 (UTC minutes), 30-minute slots, with one row of programmes. */
function guideOf(rows: (GuideSchedule | null)[]): Pick<Guide, 'schedule' | 'zone'> {
  const schedule = (row: number): GuideSchedule | null => rows[row] ?? null;
  const zone = guideZone({ id: 'grid', rows: rows.length, from: 1_000, to: 2_440, span: 120, slot: 30, now: 1_100 }, schedule);
  return { schedule, zone: () => zone };
}

describe('the guide screen’s details line (RELAY step 23c)', () => {
  // A programme from before the guide's start, a 2-minute gap after the second (its cell takes it), then nothing.
  const row: GuideSchedule = { start: [990, 1_040, 1_100], end: [1_040, 1_098, 1_160], title: ['Early', 'Middle', 'Late'] };
  const guide = guideOf([row, null]) as Guide;

  it('gives the focused programme’s own times, not its cell’s', () => {
    expect(guideDetails(guide, { index: 0, time: 1_000 }, 1_100)).toEqual({ title: 'Early', from: 990, to: 1_040 });
    // Its cell runs on to 1,100 (the gap is too short to stand alone); the programme ends at 1,098.
    expect(guideDetails(guide, { index: 0, time: 1_099 }, 1_100)).toEqual({ title: 'Middle', from: 1_040, to: 1_098 });
  });

  it('gives a placeholder’s cell, with no title, and the cell at now with no time', () => {
    // After the last programme: slots of 30 minutes from the guide's start.
    expect(guideDetails(guide, { index: 0, time: 1_175 }, 1_100)).toEqual({ title: null, from: 1_160, to: 1_180 });
    expect(guideDetails(guide, { index: 1, time: null }, 1_100)).toEqual({ title: null, from: 1_090, to: 1_120 });
    // Outside the guide: nothing.
    expect(guideDetails(guide, { index: 1, time: 5_000 }, 1_100)).toEqual({ title: null, from: 0, to: 0 });
  });
});
