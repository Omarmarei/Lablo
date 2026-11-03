import type { ItemState } from '../focus/binding';

/**
 * What a focusable component takes: its look from the focus engine and its pointer handlers.
 * Spread a zone's `item(i)` into it (`<Button {...buttons.item(0)} … />`). Focus is an index
 * in the engine, never DOM focus, so these components are plain elements with no tabindex.
 */
export interface FocusableProps {
  readonly state?: ItemState;
  /** The Magic Remote pointer moved over it (`Screen.hover`). */
  readonly onHover?: () => void;
  /** A pointer click on it (`Screen.click`). */
  readonly onPress?: () => void;
  readonly testId?: string;
}

/** `base` plus `is-focused` or `is-memory`, the classes every component styles its focus with. */
export function focusClass(base: string, state: ItemState | undefined): string {
  return state === 'focused' ? `${base} is-focused` : state === 'memory' ? `${base} is-memory` : base;
}

/** A value for `width: n%`: `fraction` clamped to 0–1, NaN as 0. */
export function percent(fraction: number): number {
  return fraction > 0 ? Math.min(100, Math.round(fraction * 1000) / 10) : 0;
}
