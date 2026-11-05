import { describe, expect, it } from 'vitest';
import { fits } from '../design/tokens';
import { bindFocus } from '../focus/binding';
import { epgCell } from '../focus/epg';
import type { TextDirection } from '../focus/types';
import { createNavigator } from '../focus/navigator';
import { GuideGrid } from './GuideGrid';
import type { GuideSchedule } from './guide-cells';
import { guideZone } from './guide-cells';
import { GUIDE_LAYOUT, guideFits, guideHeight, guideWidth } from './guide-layout';
import type { El } from './vnode.test-helpers';
import { all, byClass, expand, one, text } from './vnode.test-helpers';

const H = 60;
const t = (hours: number, minutes = 0): number => hours * H + minutes;
const VISIBLE = fits(796, GUIDE_LAYOUT.rowHeight, GUIDE_LAYOUT.rowGap);
const ROWS = 30;
const NOW = t(20, 17);

function schedule(rows: ReadonlyArray<readonly [number, number, string]>): GuideSchedule {
  return { start: rows.map((r) => r[0]), end: rows.map((r) => r[1]), title: rows.map((r) => r[2]) };
}

/** Row 0 has a programme from before the view, row 1 none (no guide), the rest hourly shows. */
const SCHEDULES: Array<GuideSchedule | null> = [
  schedule([
    [t(18, 30), t(20, 15), 'Started before the view'],
    [t(20, 15), t(20, 45), 'Evening News'],
    [t(21, 30), t(23), 'نشرة متأخرة'],
  ]),
  null,
];
for (let row = 2; row < ROWS; row += 1) {
  const rows: Array<[number, number, string]> = [];
  for (let hour = 18; hour < 24; hour += 1) rows.push([t(hour), t(hour + 1), `Show ${row}.${hour}`]);
  SCHEDULES.push(schedule(rows));
}

function setup(dir: TextDirection = 'ltr', now = NOW) {
  const scheduleOf = (row: number): GuideSchedule | null => SCHEDULES[row] ?? null;
  const zone = guideZone(
    { id: 'guide', rows: ROWS, visibleRows: VISIBLE, from: t(18), to: t(24), span: 120, slot: 30, now, neighbours: { up: 'top' } },
    scheduleOf,
  );
  const selected: string[] = [];
  const nav = createNavigator({
    root: {
      id: 'guide',
      zones: [{ kind: 'list', id: 'top', axis: 'horizontal', count: 1, neighbours: { down: 'guide' } }, zone],
      initial: 'guide',
      onSelect: (focus) => selected.push(`${focus.zone} ${focus.index} ${focus.time ?? ''}`),
    },
    dir,
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  const binding = bindFocus(nav);
  const render = (at = now): El =>
    expand(
      GuideGrid({
        binding,
        screen: nav.top,
        zone: 'guide',
        channel: (row) => ({ number: 100 + row, name: row === 1 ? 'قناة بلا دليل' : `Channel ${row}` }),
        schedule: scheduleOf,
        now: at,
        formatTime: (minute) => `${Math.floor(minute / H)}:${String(minute % H).padStart(2, '0')}`,
        formatDay: (minute) => `day of ${minute}`,
        placeholder: 'No information',
        testId: 'grid',
      }),
    );
  return { nav, render, selected };
}

/** A row's cells as `[start, end, state]`. */
function cells(el: El, row: number): Array<[unknown, unknown, unknown]> {
  const line = all(el).find((e) => e.props['data-row'] === row);
  if (line === undefined) throw new Error(`row ${row} is not drawn`);
  return byClass(line, 'z-guide__cell').map((c) => [c.props['data-start'], c.props['data-end'], c.props['data-state']]);
}

function focused(el: El): El {
  const found = byClass(el, 'z-guide__cell').filter((c) => c.props['data-state'] === 'focused');
  if (found.length !== 1) throw new Error(`${found.length} focused cells`);
  return found[0]!;
}

describe('GuideGrid (RELAY step 23b)', () => {
  it('draws the rows in view and, in each, the cells that cross the view', () => {
    expect(VISIBLE).toBe(9);
    const { render } = setup();
    const el = render();
    expect(el.props).toMatchObject({ class: 'z-guide', role: 'grid', 'data-testid': 'grid', 'data-top': 0, 'data-count': ROWS, 'data-view': t(20), 'data-span': 120 });
    expect(el.props.style).toEqual({
      width: `${guideWidth(120)}px`,
      height: `${guideHeight(VISIBLE)}px`,
      '--z-guide-channel': '400px',
      '--z-guide-gap': '8px',
      '--z-guide-row-gap': '8px',
    });
    expect(guideWidth(120)).toBe(1728);
    expect(guideHeight(VISIBLE)).toBe(56 + 9 * 88);
    expect(guideHeight(0)).toBe(56);
    // guideFits is guideHeight backwards.
    expect(guideFits(guideHeight(VISIBLE))).toBe(VISIBLE);
    expect(guideFits(guideHeight(VISIBLE) - 1)).toBe(VISIBLE - 1);
    expect(guideFits(0)).toBe(1);
    expect(byClass(el, 'z-guide__row').map((r) => r.key)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(byClass(el, 'z-guide__row').map((r) => r.props.style)).toEqual(Array.from({ length: 9 }, () => ({ height: '80px' })));
    // The view is 20:00 to 22:00: the cell from 18:30 and the one to 23:00 are drawn, cut.
    expect(cells(el, 0)).toEqual([
      [t(20, 15) - 105, t(20, 15), 'idle'],
      [t(20, 15), t(20, 45), 'focused'],
      [t(20, 45), t(21), 'idle'],
      [t(21), t(21, 30), 'idle'],
      [t(21, 30), t(23), 'idle'],
    ]);
    expect(cells(el, 1).map((c) => [c[0], c[1]])).toEqual([
      [t(20), t(20, 30)],
      [t(20, 30), t(21)],
      [t(21), t(21, 30)],
      [t(21, 30), t(22)],
    ]);
    expect(cells(el, 2).map((c) => [c[0], c[1]])).toEqual([
      [t(20), t(21)],
      [t(21), t(22)],
    ]);
  });

  it('places each cell from the view’s start in CSS variables, cut at the view’s edges', () => {
    const { render } = setup();
    const row0 = byClass(render(), 'z-guide__row')[0]!;
    const drawn = byClass(row0, 'z-guide__cell');
    const W = GUIDE_LAYOUT.minuteWidth;
    expect(drawn.map((c) => c.props.style)).toEqual([
      { '--x': '0px', '--w': `${15 * W - 4}px` },
      { '--x': `${15 * W}px`, '--w': `${30 * W - 4}px` },
      { '--x': `${45 * W}px`, '--w': `${15 * W - 4}px` },
      { '--x': `${60 * W}px`, '--w': `${30 * W - 4}px` },
      { '--x': `${90 * W}px`, '--w': `${30 * W - 4}px` },
    ]);
    expect(drawn.map((c) => c.props.class)).toEqual([
      'z-guide__cell is-past is-cut-start',
      'z-guide__cell is-focused is-now',
      'z-guide__cell is-gap',
      'z-guide__cell is-gap',
      'z-guide__cell is-cut-end',
    ]);
    expect(one(row0, 'z-guide__line').props.style).toEqual({ width: `${120 * W}px` });
  });

  it('shows the provider’s titles in their own direction and the placeholder from the catalogs', () => {
    const { render } = setup();
    const el = render();
    const titles = byClass(byClass(el, 'z-guide__row')[0]!, 'z-guide__title');
    expect(titles.map(text)).toEqual(['Started before the view', 'Evening News', 'No information', 'No information', 'نشرة متأخرة']);
    expect(titles.map((e) => [e.props.dir, e.props.translate])).toEqual([
      ['auto', false],
      ['auto', false],
      [undefined, undefined],
      [undefined, undefined],
      ['auto', false],
    ]);
    expect(byClass(el, 'z-guide__cell').filter((c) => c.props['data-programme'] === -1)).toHaveLength(2 + 4);
    const channel = one(byClass(el, 'z-guide__row')[1]!, 'z-guide__channel');
    expect(text(channel)).toBe('101قناة بلا دليل');
    expect(one(channel, 'z-guide__name').props).toMatchObject({ dir: 'auto', translate: false });
    expect(channel.props.role).toBe('rowheader');
  });

  it('labels the slots in view and the day of the view', () => {
    const { nav, render } = setup();
    let el = render();
    const slots = byClass(el, 'z-guide__slot');
    expect(slots.map(text)).toEqual(['20:00', '20:30', '21:00', '21:30']);
    expect(slots.map((s) => [s.props['data-minute'], s.props.style])).toEqual(
      [0, 30, 60, 90].map((m) => [t(20) + m, { '--x': `${m * GUIDE_LAYOUT.minuteWidth}px` }]),
    );
    expect(text(one(el, 'z-guide__day'))).toBe(`day of ${t(20)}`);
    // Past the view's end: the view moves a slot on, and the labels with it.
    nav.handle('RIGHT');
    nav.handle('RIGHT');
    nav.handle('RIGHT');
    expect(nav.snapshot().time).toBe(t(21, 30));
    nav.handle('RIGHT');
    expect(nav.snapshot().time).toBe(t(23));
    el = render();
    expect(el.props['data-view']).toBe(t(22));
    expect(byClass(el, 'z-guide__slot').map(text)).toEqual(['22:00', '22:30', '23:00', '23:30']);
  });

  it('focuses the cell that holds the zone’s cursor, and keeps the cursor across rows', () => {
    const { nav, render } = setup();
    expect(focused(render()).props).toMatchObject({ 'data-start': t(20, 15), 'aria-selected': 'true', role: 'gridcell' });
    nav.handle('DOWN');
    let el = render();
    expect(nav.snapshot()).toMatchObject({ index: 1, time: NOW });
    expect(focused(el).props['data-start']).toBe(t(20));
    expect(all(el).filter((e) => e.props['aria-selected'] === 'true')).toHaveLength(1);
    expect(byClass(el, 'z-guide__row').map((r) => r.props.class)).toEqual(['z-guide__row', 'z-guide__row is-current', ...Array.from({ length: 7 }, () => 'z-guide__row')]);
    nav.handle('DOWN');
    nav.handle('RIGHT');
    el = render();
    expect(nav.snapshot()).toMatchObject({ index: 2, time: t(21) });
    expect(focused(el).props).toMatchObject({ 'data-start': t(21), 'data-end': t(22) });
    // Every drawn row: the zone's cell at each minute in view is a drawn cell.
    for (const row of byClass(el, 'z-guide__row')) {
      const index = row.props['data-row'] as number;
      const spans = byClass(row, 'z-guide__cell').map((c) => [c.props['data-start'], c.props['data-end']]);
      for (let minute = t(20); minute < t(22); minute += 1) {
        const cell = epgCell(nav.top.zone('guide') as Parameters<typeof epgCell>[0], index, minute);
        expect(spans).toContainEqual([cell.start, cell.end]);
      }
    }
  });

  it('moves the rows in view with the zone’s top, keyed by row', () => {
    const { nav, render } = setup();
    nav.handle('CH_DOWN');
    let el = render();
    expect(el.props['data-top']).toBe(9);
    expect(byClass(el, 'z-guide__row').map((r) => r.props['data-row'])).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(focused(el).props['data-start']).toBe(t(20));
    for (let i = 0; i < 5; i += 1) nav.handle('CH_DOWN');
    el = render();
    expect(byClass(el, 'z-guide__row').map((r) => r.key)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29]);
    expect(byClass(el, 'z-guide__row')).toHaveLength(9);
  });

  it('shows the focused cell as memory while another zone has the focus', () => {
    const { nav, render } = setup();
    nav.handle('UP');
    expect(nav.snapshot().zone).toBe('top');
    const el = render();
    expect(byClass(el, 'z-guide__cell').filter((c) => c.props['data-state'] !== 'idle').map((c) => [c.props['data-state'], c.props.class])).toEqual([
      ['memory', 'z-guide__cell is-memory is-now'],
    ]);
    expect(all(el).filter((e) => e.props['aria-selected'] === 'true')).toHaveLength(0);
  });

  it('draws the now line while now is in view', () => {
    const { nav, render } = setup();
    const line = one(render(), 'z-guide__now');
    expect(line.props).toMatchObject({ 'data-minute': NOW, style: { '--x': `${400 + 8 + 17 * GUIDE_LAYOUT.minuteWidth}px` } });
    expect(byClass(render(t(19)), 'z-guide__now')).toHaveLength(0);
    expect(byClass(render(t(22)), 'z-guide__now')).toHaveLength(0);
    expect(byClass(render(t(21, 59)), 'z-guide__now')).toHaveLength(1);
    expect(byClass(render(t(20)), 'z-guide__now')).toHaveLength(1);
    // Gone by and on air follow the clock.
    const at = (minute: number): unknown[] => byClass(byClass(render(minute), 'z-guide__row')[2]!, 'z-guide__cell').map((c) => c.props.class);
    expect(at(t(21))).toEqual(['z-guide__cell is-past', 'z-guide__cell is-now']);
    expect(at(t(20, 59))).toEqual(['z-guide__cell is-now', 'z-guide__cell']);
    for (let i = 0; i < 4; i += 1) nav.handle('RIGHT');
    expect(byClass(render(), 'z-guide__now')).toHaveLength(0);
  });

  it('draws no now line past the guide’s end, in a guide shorter than the view', () => {
    const scheduleOf = (): null => null;
    const zone = guideZone({ id: 'guide', rows: 1, from: t(20), to: t(21), span: 120, now: t(20) }, scheduleOf);
    const nav = createNavigator({ root: { id: 'g', zones: [zone] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined });
    const draw = (now: number): El =>
      expand(GuideGrid({ binding: bindFocus(nav), screen: nav.top, zone: 'guide', channel: () => ({ name: 'One' }), schedule: scheduleOf, now, formatTime: String, placeholder: '-' }));
    expect(byClass(draw(t(20, 30)), 'z-guide__now')).toHaveLength(1);
    expect(byClass(draw(t(21, 10)), 'z-guide__now')).toHaveLength(0);
    // No number: just the name; no day label; the cells stop at the guide's end.
    const el = draw(t(20));
    expect(byClass(el, 'z-guide__number')).toHaveLength(0);
    expect(one(el, 'z-guide__day').children).toEqual([]);
    expect(byClass(el, 'z-guide__cell').map((c) => c.props['data-end'])).toEqual([t(20, 30), t(21)]);
    expect(byClass(el, 'z-guide__slot').map((s) => s.props['data-minute'])).toEqual([t(20), t(20, 30)]);
    expect(el.props['data-testid']).toBeUndefined();
    expect(el.props.style).toMatchObject({ height: `${guideHeight(1)}px` });
  });

  it('marks a programme that goes on past the guide’s own start and end', () => {
    const row = schedule([
      [t(19), t(20, 30), 'Began before the guide'],
      [t(20, 30), t(20, 58), 'Two minutes short'],
      [t(21), t(21, 30), 'Between'],
      [t(21, 30), t(23), 'Ends after the guide'],
    ]);
    const zone = guideZone({ id: 'guide', rows: 1, from: t(20), to: t(22), span: 120, now: t(20) }, () => row);
    const nav = createNavigator({ root: { id: 'g', zones: [zone] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined });
    const el = expand(
      GuideGrid({ binding: bindFocus(nav), screen: nav.top, zone: 'guide', channel: () => ({ name: 'One' }), schedule: () => row, now: t(20), formatTime: String, placeholder: '-' }),
    );
    expect(byClass(el, 'z-guide__cell').map((c) => [c.props['data-start'], c.props['data-end'], c.props.class])).toEqual([
      [t(20), t(20, 30), 'z-guide__cell is-focused is-now is-cut-start'],
      // The two minutes after it are its own: no arrow at a cell's end that the programme doesn't reach.
      [t(20, 30), t(21), 'z-guide__cell'],
      [t(21), t(21, 30), 'z-guide__cell'],
      [t(21, 30), t(22), 'z-guide__cell is-cut-end'],
    ]);
  });

  it('shows at least a slot, as the zone scrolls by one, when the span is shorter', () => {
    const scheduleOf = (): null => null;
    const zone = guideZone({ id: 'guide', rows: 1, from: t(20), to: t(22), span: 10, slot: 30, now: t(20) }, scheduleOf);
    const nav = createNavigator({ root: { id: 'g', zones: [zone] }, rootBack: 'exit-dialog', exit: () => undefined, exitDialog: () => undefined });
    const el = expand(
      GuideGrid({ binding: bindFocus(nav), screen: nav.top, zone: 'guide', channel: () => ({ name: 'One' }), schedule: scheduleOf, now: t(20), formatTime: String, placeholder: '-' }),
    );
    expect(el.props['data-span']).toBe(30);
    expect(el.props.style).toMatchObject({ width: `${guideWidth(30)}px` });
    expect(byClass(el, 'z-guide__cell').map((c) => [c.props['data-start'], c.props['data-end']])).toEqual([[t(20), t(20, 30)]]);
  });

  it('hands the pointer each cell where it is drawn, so the view stays', () => {
    const { nav, render, selected } = setup();
    nav.pointer(true);
    let el = render();
    const first = byClass(el, 'z-guide__cell')[0]!;
    (first.props.onMouseMove as () => void)();
    // The cell from 18:30 is focused at the view's start, not at 18:30.
    expect(nav.snapshot()).toMatchObject({ index: 0, time: t(20) });
    expect(nav.top.position('guide').view).toBe(t(20));
    el = render();
    const later = all(el).find((e) => e.props['data-row'] === 3)!;
    (byClass(later, 'z-guide__cell')[1]!.props.onClick as () => void)();
    expect(selected).toEqual([`guide 3 ${t(21)}`]);
    // The channel column focuses its row and keeps the cursor.
    (one(byClass(render(), 'z-guide__row')[5]!, 'z-guide__channel').props.onMouseMove as () => void)();
    expect(nav.snapshot()).toMatchObject({ index: 5, time: t(21) });
  });

  it('runs time the other way in Arabic only through LEFT and RIGHT: the cells are the same', () => {
    const ltr = setup('ltr');
    const rtl = setup('rtl');
    ltr.nav.handle('RIGHT');
    rtl.nav.handle('LEFT');
    expect(rtl.nav.snapshot().time).toBe(ltr.nav.snapshot().time);
    const strip = (el: El): unknown[] => byClass(el, 'z-guide__cell').map((c) => [c.props['data-start'], c.props.class, c.props.style]);
    expect(strip(rtl.render())).toEqual(strip(ltr.render()));
  });

  it('refuses a zone that is not an epg zone', () => {
    const { nav } = setup();
    expect(() =>
      GuideGrid({ binding: bindFocus(nav), screen: nav.top, zone: 'top', channel: () => ({ name: '' }), schedule: () => null, now: 0, formatTime: String, placeholder: '' }),
    ).toThrow(/not an epg zone/);
  });
});
