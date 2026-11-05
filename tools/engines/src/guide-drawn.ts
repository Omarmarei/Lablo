/**
 * Test support (guide.test.ts, onboarding.test.ts): the grid as `GuideGrid` draws it on the guide
 * screen for the harness's fixture, box by box, in either direction. Everything sits where
 * GUIDE_LAYOUT says, so the checks pass on it, and a test breaks one thing to see them fail.
 */
import { SAFE_AREA } from './gallery';
import type { GridBox, GridCell, GridRow, GridView } from './guide';
import { GUIDE_HEADER, GUIDE_LAYOUT, GUIDE_ROWS, GUIDE_SLOT, GUIDE_SPAN, GUIDE_TEXT, MARK_SIZE, MIN_CELL, fixtureCells, guideWidth } from './guide';
import type { ListedEntry, LiveLanguage } from './live';

export interface Drawing {
  readonly language: LiveLanguage;
  readonly entry: ListedEntry;
  /** The first row drawn, and the focused row. */
  readonly top: number;
  readonly index: number;
  /** The time cursor, the view's first minute and now (UTC minutes). */
  readonly time: number;
  readonly view: number;
  readonly now: number;
}

/** `width` px at `from` px from `outer`'s inline start: the left in English, the right in Arabic. */
function placed(rtl: boolean, outer: Pick<GridBox, 'left' | 'right'>, from: number, width: number): Pick<GridBox, 'left' | 'right'> {
  return rtl ? { left: outer.right - from - width, right: outer.right - from } : { left: outer.left + from, right: outer.left + from + width };
}

/** The cells of a row without a guide: "No information" cut at the slot boundaries. */
function placeholders(view: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let start = view - (((view % GUIDE_SLOT) + GUIDE_SLOT) % GUIDE_SLOT); start < view + GUIDE_SPAN; start += GUIDE_SLOT) out.push([start, start + GUIDE_SLOT]);
  return out;
}

export function drawnGrid(d: Drawing): GridView {
  const L = GUIDE_LAYOUT;
  const rtl = d.language === 'ar';
  const top = SAFE_AREA.top + GUIDE_HEADER;
  const box: GridBox = { left: SAFE_AREA.left, right: SAFE_AREA.left + guideWidth(GUIDE_SPAN), top, bottom: top + L.headerHeight + GUIDE_ROWS * (L.rowHeight + L.rowGap) };
  const rows: GridRow[] = [];
  for (let row = d.top; row < Math.min(d.top + GUIDE_ROWS, d.entry.channels.length); row += 1) {
    const channel = d.entry.channels[row]!;
    const rowTop = box.top + L.headerHeight + L.rowGap + (row - d.top) * (L.rowHeight + L.rowGap);
    const vertical = { top: rowTop, bottom: rowTop + L.rowHeight };
    const line: GridBox = { ...placed(rtl, box, L.channelWidth + L.channelGap, GUIDE_SPAN * L.minuteWidth), ...vertical };
    const schedule: Array<[number, number, string | null]> = channel.guide ? fixtureCells(channel, d.view, GUIDE_SPAN) : placeholders(d.view).map(([s, e]) => [s, e, null]);
    const cells = schedule.map(([start, end, title], p): GridCell => {
      const from = Math.max(start, d.view);
      const to = Math.min(end, d.view + GUIDE_SPAN);
      const width = Math.max((to - from) * L.minuteWidth - L.cellGap, MIN_CELL);
      const box = placed(rtl, line, (from - d.view) * L.minuteWidth, width);
      // The archive mark (step 25c): a programme gone by within its channel's catch-up days, 15 px in from the cell's inline start.
      const archived = title !== null && channel.catchup > 0 && end <= d.now && start >= d.now - channel.catchup * 1440;
      const markTop = vertical.top + (L.rowHeight - MARK_SIZE) / 2;
      return {
        start,
        end,
        programme: title === null ? -1 : p,
        state: row === d.index && start <= d.time && d.time < end ? 'focused' : 'idle',
        title: title ?? GUIDE_TEXT[d.language].noInfo,
        mark: archived ? { ...placed(rtl, box, 15, MARK_SIZE), top: markTop, bottom: markTop + MARK_SIZE, text: GUIDE_TEXT[d.language].catchUp } : null,
        ...box,
        ...vertical,
      };
    });
    rows.push({
      row,
      ...vertical,
      channel: { ...placed(rtl, box, 0, L.channelWidth), ...vertical },
      line,
      number: String(d.entry.allStart + row + 1),
      name: channel.name,
      cells,
    });
  }
  const first = rows[0]?.line ?? box;
  const slots = [0, 30, 60, 90].map((m) => ({ minute: d.view + m, text: `${m}`, ...placed(rtl, first, m * L.minuteWidth, 70) }));
  const inView = d.now >= d.view && d.now < d.view + GUIDE_SPAN;
  const centre = rtl ? first.right - (d.now - d.view) * L.minuteWidth : first.left + (d.now - d.view) * L.minuteWidth;
  return { view: d.view, top: d.top, count: d.entry.channels.length, span: GUIDE_SPAN, box, rows, slots, now: inView ? { minute: d.now, centre } : null };
}
