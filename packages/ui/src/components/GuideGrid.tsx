import type { VNode } from 'preact';
import type { FocusBinding } from '../focus/binding';
import { useZone } from '../focus/binding';
import { slotLength } from '../focus/epg';
import type { Screen } from '../focus/navigator';
import { zoneCount } from '../focus/zones';
import { focusClass } from './focusable';
import type { GuideSchedule } from './guide-cells';
import { guideCellsIn, guideSlots } from './guide-cells';
import { GUIDE_LAYOUT, guideHeight, guideWidth } from './guide-layout';
import { listWindow } from './VirtualList';
import './GuideGrid.css';

/** A row's channel, at the row's inline start: the provider's number and name. */
export interface GuideChannel {
  readonly number?: number | string;
  readonly name: string;
}

export interface GuideGridProps {
  readonly binding: FocusBinding;
  readonly screen: Screen;
  /** An `epg` zone of the screen, made by `guideZone` over the same `schedule`. */
  readonly zone: string;
  /** Row `row`'s channel. */
  readonly channel: (row: number) => GuideChannel;
  /** Row `row`'s programmes, or `null` while there are none (no guide, or not read yet): placeholders. */
  readonly schedule: (row: number) => GuideSchedule | null;
  /** Now, in UTC minutes: the "now" line while it is in view, and how cells look (gone by, on air). */
  readonly now: number;
  /** A slot boundary as a time of day for the locale (`8:30 PM`, `20:30`). */
  readonly formatTime: (minute: number) => string;
  /** The day of the view's first minute, in the corner above the channels (`Thu, Nov 5`). */
  readonly formatDay?: (minute: number) => string;
  /** A placeholder cell's text ("No information"), from the catalogs. */
  readonly placeholder: string;
  /**
   * Row `row`'s archive (RELAY step 25c): the first minute (UTC) a programme may have started at
   * to be in it (`-Infinity`: no limit), or `null` for none. Its programmes that started then or
   * later and ended by `now` get the catch-up mark. Read once per drawn row.
   */
  readonly archive?: (row: number) => number | null;
  /** The mark's name in a cell's text ("Catch-up"), for the screen reader. */
  readonly archiveName?: string;
  readonly class?: string;
  readonly testId?: string;
}

const px = (n: number): string => `${n}px`;

/**
 * The grid guide (RELAY step 23b): channels down, time across, virtualized on both axes. It
 * draws only the zone's `visibleRows` rows from `ZonePosition.top` and, in each, only the cells
 * that cross the view (`view` to `view + span`), cut at its edges; a cell that goes on past an
 * edge shows a small arrow there. The focused cell is the one of the focused row that holds the
 * zone's time cursor.
 *
 * Positions are CSS variables (`--x`, `--w`) that the stylesheet turns into `left`/`width`:
 * postcss-rtlcss mirrors `left` into `right` under `<html dir="rtl">`, which it can't do for
 * an inline `left`, so in Arabic the channels are on the right and time runs leftwards. The
 * rows are flex rows in normal flow; only the cells, the header's times and the now line are
 * placed absolutely. No CSS Grid, no flex gap (Chromium 53).
 *
 * A programme in its channel's archive (`archive`, step 25c) has the class `is-archive` and a
 * mark: a span after the title holding `archiveName`, so the cell's text names it after the
 * title, drawn before the title (flex `order`) as a small circular arrow that hides its text.
 */
export function GuideGrid({ binding, screen, zone, channel, schedule, now, formatTime, formatDay, placeholder, archive, archiveName, class: extra, testId }: GuideGridProps) {
  const view = useZone(binding, screen, zone);
  const spec = view.spec;
  if (spec.kind !== 'epg') throw new Error(`GuideGrid: zone ${zone} is not an epg zone`);
  const L = GUIDE_LAYOUT;
  const rows = zoneCount(spec);
  const visible = spec.visibleRows === undefined ? rows : Math.max(1, Math.floor(spec.visibleRows));
  const shown = listWindow(view.position.top, rows, visible);
  const span = Math.max(slotLength(spec), spec.span);
  const first = view.position.view;
  const last = first + span;
  const cursor = view.position;

  const drawn: VNode[] = [];
  for (let row = shown.from; row < shown.to; row += 1) {
    const programmes = schedule(row);
    const current = row === cursor.index;
    const head = channel(row);
    const rowItem = view.item(row);
    const cells: VNode[] = [];
    const inView = guideCellsIn(programmes, spec, first, last);
    // (A row without programmes has nothing to mark.)
    const archiveFrom = archive === undefined || programmes === null ? null : archive(row);
    for (let c = 0; c < inView.length; c += 1) {
      const cell = inView[c]!;
      const left = Math.max(cell.start, first);
      const right = Math.min(cell.end, last);
      // `state(row)` is idle off the focused row.
      const state = cell.start <= cursor.time && cursor.time < cell.end ? view.state(row) : 'idle';
      // The pointer focuses the cell where it is drawn, so the view stays where it is.
      const item = view.item(row, left);
      const p = cell.programme;
      const isProgramme = p >= 0 && programmes !== null;
      const begins = isProgramme ? (programmes.start[p] ?? cell.start) : cell.start;
      const ends = isProgramme ? (programmes.end[p] ?? cell.end) : cell.end;
      // In the archive: a programme gone by (its own end) that started within the channel's days.
      const marked = isProgramme && archiveFrom !== null && ends <= now && begins >= archiveFrom;
      let cls = focusClass('z-guide__cell', state);
      if (!isProgramme) cls += ' is-gap';
      cls += cell.end <= now ? ' is-past' : cell.start <= now ? ' is-now' : '';
      if (begins < left) cls += ' is-cut-start';
      if (ends > right) cls += ' is-cut-end';
      if (marked) cls += ' is-archive';
      cells.push(
        <div
          key={cell.start}
          class={cls}
          role="gridcell"
          aria-selected={state === 'focused' ? 'true' : 'false'}
          data-start={cell.start}
          data-end={cell.end}
          data-programme={p}
          data-state={state}
          style={{ '--x': px((left - first) * L.minuteWidth), '--w': px((right - left) * L.minuteWidth - L.cellGap) }}
          onMouseMove={item.onHover}
          onClick={item.onPress}
        >
          {isProgramme ? (
            <span class="z-guide__title" dir="auto" translate={false}>
              {programmes.title[p] ?? ''}
            </span>
          ) : (
            <span class="z-guide__title">{placeholder}</span>
          )}
          {marked && <span class="z-guide__mark">{archiveName ?? ''}</span>}
        </div>,
      );
    }
    drawn.push(
      <div key={row} class={current ? 'z-guide__row is-current' : 'z-guide__row'} role="row" data-row={row} style={{ height: px(L.rowHeight) }}>
        <div class="z-guide__channel" role="rowheader" onMouseMove={rowItem.onHover} onClick={rowItem.onPress}>
          {head.number !== undefined && <span class="z-guide__number">{head.number}</span>}
          <span class="z-guide__name" dir="auto" translate={false}>
            {head.name}
          </span>
        </div>
        <div class="z-guide__line" style={{ width: px(span * L.minuteWidth) }}>
          {cells}
        </div>
      </div>,
    );
  }

  const slots = guideSlots(spec, first, last).map((minute) => (
    <span key={minute} class="z-guide__slot" data-minute={minute} style={{ '--x': px((minute - first) * L.minuteWidth) }}>
      {formatTime(minute)}
    </span>
  ));
  // A guide shorter than the view ends before `last`.
  const nowShown = now >= first && now < last && now < spec.to;

  return (
    <div
      class={extra === undefined ? 'z-guide' : `z-guide ${extra}`}
      role="grid"
      data-testid={testId}
      data-top={shown.from}
      data-count={rows}
      data-view={first}
      data-span={span}
      data-from={spec.from}
      data-to={spec.to}
      style={{
        width: px(guideWidth(span)),
        height: px(guideHeight(visible)),
        '--z-guide-channel': px(L.channelWidth),
        '--z-guide-gap': px(L.channelGap),
        '--z-guide-row-gap': px(L.rowGap),
      }}
    >
      <div class="z-guide__head" style={{ height: px(L.headerHeight) }}>
        <div class="z-guide__day">{formatDay === undefined ? null : formatDay(first)}</div>
        <div class="z-guide__times" style={{ width: px(span * L.minuteWidth) }}>
          {slots}
        </div>
      </div>
      {drawn}
      {nowShown && (
        <div class="z-guide__now" data-minute={now} style={{ '--x': px(L.channelWidth + L.channelGap + (now - first) * L.minuteWidth) }} />
      )}
    </div>
  );
}
