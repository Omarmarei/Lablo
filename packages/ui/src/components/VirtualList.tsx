import type { ComponentChild, VNode } from 'preact';
import { LAYOUT, shownRowSize, shownRows } from '../design/tokens';
import type { FocusBinding, ItemBinding } from '../focus/binding';
import { useZone } from '../focus/binding';
import type { Screen } from '../focus/navigator';
import { zoneCount } from '../focus/zones';
import './VirtualList.css';

/** The items a list renders: `[from, to)`. */
export interface ListWindow {
  readonly from: number;
  readonly to: number;
}

/**
 * `visible` items from `top`, inside `[0, count)`. With `focused`, the window first moves as
 * little as it must to hold that item: a `top` kept from a window of more rows (larger text
 * switched on, step 58a) still shows the focus.
 */
export function listWindow(top: number, count: number, visible: number, focused?: number): ListWindow {
  const n = Math.max(0, Math.floor(count));
  let start = Math.floor(top);
  if (focused !== undefined && focused < start) start = focused;
  else if (focused !== undefined && focused >= start + visible) start = focused - visible + 1;
  const from = Math.min(Math.max(0, start), n);
  return { from, to: Math.min(n, from + Math.max(0, Math.floor(visible))) };
}

/** The length in px of a window of `visible` items: what `fits()` turns back into `visible`. */
export function listHeight(visible: number, itemSize: number, gap = 0): number {
  return visible > 0 ? visible * itemSize + (visible - 1) * gap : 0;
}

export interface VirtualListProps {
  readonly binding: FocusBinding;
  readonly screen: Screen;
  /** A `list` zone of the screen. Its `count` and `visible` window (from `fits()`) say what to draw. */
  readonly zone: string;
  /**
   * Each item's length along the list in px: a layout constant, never measured. Default
   * LAYOUT.rowHeight (the `--row-height` token) for a vertical list; a horizontal one needs it.
   */
  readonly itemSize?: number;
  /** Space between items, in px. */
  readonly gap?: number;
  readonly renderItem: (index: number, item: ItemBinding) => ComponentChild;
  readonly class?: string;
  readonly testId?: string;
}

/**
 * A list of any length that draws only the window the focus engine scrolls to: the zone's
 * `visible` items from `ZonePosition.top`, each of a fixed size. A vertical list is a column
 * of rows (a channel list); a horizontal one is a row of items (a category rail).
 *
 * The items are in normal flow: no absolute positions, no transforms, no DOM measuring. Moving
 * the window is a keyed re-render of a few items, and `dir="rtl"` mirrors a horizontal list by
 * itself (the gap is a CSS margin that postcss-rtlcss mirrors, never an inline one). The box
 * keeps the size of a full window, so nothing next to it moves when the list is short.
 */
export function VirtualList({ binding, screen, zone, itemSize, gap = 0, renderItem, class: extra, testId }: VirtualListProps) {
  const view = useZone(binding, screen, zone);
  const spec = view.spec;
  if (spec.kind !== 'list') throw new Error(`VirtualList: zone ${zone} is not a list`);
  const horizontal = spec.axis === 'horizontal';
  if (horizontal && itemSize === undefined) throw new Error(`VirtualList: the horizontal list ${zone} needs an itemSize`);
  const laid = itemSize ?? LAYOUT.rowHeight;
  const count = zoneCount(spec);
  const room = spec.visible === undefined ? count : Math.max(1, Math.floor(spec.visible));
  // Larger text (step 58a): a vertical window of fewer, taller rows in the same box. The focus
  // engine scrolls by the same rows; a window kept from before the switch is moved to the focus.
  const visible = horizontal || spec.visible === undefined ? room : shownRows(room);
  const size = visible === room ? laid : shownRowSize(room, laid, gap);
  const { from, to } = listWindow(view.position.top, count, visible, visible === room ? undefined : view.position.index);
  const length = `${listHeight(room, laid, gap)}px`;
  const items: VNode[] = [];
  for (let i = from; i < to; i += 1) {
    items.push(
      <div key={i} class="z-vlist__item" data-index={i} style={horizontal ? { width: `${size}px` } : { height: `${size}px` }}>
        {renderItem(i, view.item(i))}
      </div>,
    );
  }
  return (
    <div
      class={`z-vlist z-vlist--${spec.axis}${extra === undefined ? '' : ` ${extra}`}`}
      role="listbox"
      aria-orientation={spec.axis}
      style={horizontal ? { width: length, '--z-vlist-gap': `${gap}px` } : { height: length, '--z-vlist-gap': `${gap}px` }}
      data-testid={testId}
      data-top={from}
      data-count={count}
    >
      {items}
    </div>
  );
}
