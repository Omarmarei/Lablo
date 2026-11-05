import type { ComponentChild, VNode } from 'preact';
import type { FocusBinding, ItemBinding } from '../focus/binding';
import { useZone } from '../focus/binding';
import type { Screen } from '../focus/navigator';
import { zoneCount } from '../focus/zones';
import type { ListWindow } from './VirtualList';
import { listHeight } from './VirtualList';
import './VirtualGrid.css';

/**
 * The rows a grid draws, `[from, to)`: `visible` rows from row `top`, inside the rows `count`
 * items fill at `columns` a row.
 */
export function gridRows(top: number, count: number, columns: number, visible: number): ListWindow {
  const cols = Math.max(1, Math.floor(columns));
  const rows = Math.ceil(Math.max(0, Math.floor(count)) / cols);
  const from = Math.min(Math.max(0, Math.floor(top)), rows);
  return { from, to: Math.min(rows, from + Math.max(0, Math.floor(visible))) };
}

export interface VirtualGridProps {
  readonly binding: FocusBinding;
  readonly screen: Screen;
  /** A `grid` zone of the screen. Its `count`, `columns` and `visibleRows` say what to draw. */
  readonly zone: string;
  /** Each item's size in px: layout constants, never measured. */
  readonly itemWidth: number;
  readonly itemHeight: number;
  /** Space between the items of a row, and between rows, in px. */
  readonly columnGap?: number;
  readonly rowGap?: number;
  readonly renderItem: (index: number, item: ItemBinding) => ComponentChild;
  readonly class?: string;
  readonly testId?: string;
}

/**
 * A grid of any length that draws only the rows the focus engine scrolls to (RELAY step 26a):
 * the zone's `visibleRows` rows from `ZonePosition.top`, each a row of `columns` fixed-size
 * items filled from the inline start.
 *
 * As `VirtualList`, the rows are in normal flow: each one a flexbox row (Chromium 53 and 56 have
 * no CSS Grid, and no flex `gap`), the gaps CSS margins from custom properties, so postcss-rtlcss
 * mirrors a row in Arabic and nothing is measured. The box keeps the size of a full window.
 */
export function VirtualGrid({ binding, screen, zone, itemWidth, itemHeight, columnGap = 0, rowGap = 0, renderItem, class: extra, testId }: VirtualGridProps) {
  const view = useZone(binding, screen, zone);
  const spec = view.spec;
  if (spec.kind !== 'grid') throw new Error(`VirtualGrid: zone ${zone} is not a grid`);
  const columns = Math.max(1, Math.floor(spec.columns));
  const count = zoneCount(spec);
  const allRows = Math.ceil(count / columns);
  const visible = spec.visibleRows === undefined ? allRows : Math.max(1, Math.floor(spec.visibleRows));
  const { from, to } = gridRows(view.position.top, count, columns, visible);
  const rows: VNode[] = [];
  for (let r = from; r < to; r += 1) {
    const items: VNode[] = [];
    const last = Math.min(count, (r + 1) * columns);
    for (let i = r * columns; i < last; i += 1) {
      items.push(
        <div key={i} class="z-vgrid__item" data-index={i} style={{ width: `${itemWidth}px`, height: `${itemHeight}px` }}>
          {renderItem(i, view.item(i))}
        </div>,
      );
    }
    rows.push(
      <div key={r} class="z-vgrid__row" data-row={r} style={{ height: `${itemHeight}px` }}>
        {items}
      </div>,
    );
  }
  return (
    <div
      class={`z-vgrid${extra === undefined ? '' : ` ${extra}`}`}
      role="grid"
      style={{
        width: `${listHeight(columns, itemWidth, columnGap)}px`,
        height: `${listHeight(visible, itemHeight, rowGap)}px`,
        '--z-vgrid-column-gap': `${columnGap}px`,
        '--z-vgrid-row-gap': `${rowGap}px`,
      }}
      data-testid={testId}
      data-top={from}
      data-count={count}
      data-columns={columns}
    >
      {rows}
    </div>
  );
}
