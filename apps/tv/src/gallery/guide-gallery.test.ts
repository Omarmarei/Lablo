import type { RootBackPolicy } from '@zoma/platform-api';
import { SCREEN, guideCellsIn, guideHeight, guideWidth } from '@zoma/ui';
import { describe, expect, it, vi } from 'vitest';
import { GUIDE_DAY, GUIDE_DEMO, GUIDE_GALLERY, GUIDE_NOW, GUIDE_RANGE, GUIDE_ROWS_VISIBLE, createGuideGallery } from './guide-gallery';

function setup(rootBack: RootBackPolicy = 'exit-dialog') {
  const exitApp = vi.fn();
  const g = createGuideGallery({ rootBackPolicy: () => rootBack, exitApp });
  return { ...g, exitApp };
}

describe('the grid guide’s gallery page (RELAY step 23b)', () => {
  it('fits its header and 9 rows of two hours in the safe area', () => {
    expect(GUIDE_ROWS_VISIBLE).toBe(9);
    expect(GUIDE_GALLERY.headerHeight + guideHeight(GUIDE_ROWS_VISIBLE)).toBeLessThanOrEqual(SCREEN.height - 2 * SCREEN.safeY);
    expect(guideWidth(GUIDE_RANGE.span)).toBe(SCREEN.width - 2 * SCREEN.safeX);
    // More rows than the view shows, and a range past midnight: both scroll.
    expect(GUIDE_DEMO.length).toBe(40);
    expect(GUIDE_RANGE.to - GUIDE_RANGE.from).toBe(30 * 60);
  });

  it('sets its evening in the TV’s own time: 20:17 on a fixed day', () => {
    const now = new Date(GUIDE_NOW * 60_000);
    expect([now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()]).toEqual([2026, 10, 5, 20, 17]);
    expect(new Date(GUIDE_DAY * 60_000).getHours()).toBe(0);
  });

  it('keeps the schedule contract in every row: sorted, no overlap, each programme a minute or more', () => {
    for (const { schedule } of GUIDE_DEMO) {
      if (schedule === null) continue;
      expect(schedule.end).toHaveLength(schedule.start.length);
      expect(schedule.title).toHaveLength(schedule.start.length);
      for (let i = 0; i < schedule.start.length; i += 1) {
        expect(schedule.end[i]!).toBeGreaterThan(schedule.start[i]!);
        if (i > 0) expect(schedule.start[i]!).toBeGreaterThanOrEqual(schedule.end[i - 1]!);
      }
    }
    expect(GUIDE_DEMO.filter((row) => row.schedule === null).map((row) => row.channel.name)).toEqual(['Zoma Test Pattern', 'Zoma Channel 14', 'Zoma Channel 23', 'Zoma Channel 32']);
  });

  it('starts on the first channel at now, and OK selects the cell with the focus', () => {
    const g = setup();
    expect(g.nav.snapshot()).toMatchObject({ screen: 'gallery-guide', zone: 'guide', index: 0, time: GUIDE_NOW });
    expect(g.screen.position('guide').view).toBe(GUIDE_DAY + 20 * 60);
    expect(g.nav.handle('OK')).toBe('select');
    expect(g.selection.value).toEqual({ row: 0, start: GUIDE_DAY + 20 * 60, count: 1 });
    g.nav.handle('DOWN');
    g.nav.handle('RIGHT');
    g.nav.handle('OK');
    // Row 1: the programme from 20:10, then the next one at 21:25.
    expect(g.selection.value).toEqual({ row: 1, start: GUIDE_DAY + 21 * 60 + 25, count: 2 });
    // The zone's cells are the drawn ones.
    const cells = guideCellsIn(g.schedule(1), g.zone, GUIDE_RANGE.from, GUIDE_RANGE.to);
    for (const cell of cells) expect(g.zone.cell(1, cell.start)).toEqual(cell);
  });

  it('follows the platform on Back at its root', () => {
    const tizen = setup('exit-dialog');
    expect(tizen.nav.back()).toBe('exit-dialog');
    expect(tizen.exitApp).not.toHaveBeenCalled();
    const webos = setup('platform-back');
    expect(webos.nav.back()).toBe('exit');
    expect(webos.exitApp).toHaveBeenCalledTimes(1);
  });
});
