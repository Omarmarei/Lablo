import type { ComponentChildren } from 'preact';
import type { FocusableProps } from './focusable';
import { focusClass } from './focusable';
import './Chip.css';

export interface ChipProps extends FocusableProps {
  /** A category name: from the catalogs, or the provider's own (then `data`). */
  readonly label: string;
  /** The category on show, which stays marked while the focus is elsewhere. */
  readonly selected?: boolean;
  /** A count after the label (channels in the category). */
  readonly count?: number | string;
  /** The label is the provider's text, not ours: its own direction, never translated. */
  readonly data?: boolean;
  /**
   * A source's name in a tag after the label (RELAY step 36d: two sources have a category of the
   * label's name): the user's text, its own direction, never translated.
   */
  readonly source?: string;
  /** An icon before the label (RELAY step 38b: a lock), drawn in the text's colour. */
  readonly icon?: ComponentChildren;
}

/** One category of a rail. */
export function Chip({ label, selected = false, count, data = false, source, icon, state, onHover, onPress, testId }: ChipProps) {
  return (
    <div
      class={focusClass(`z-chip${selected ? ' is-selected' : ''}`, state)}
      role="tab"
      aria-selected={selected ? 'true' : 'false'}
      data-testid={testId}
      data-state={state ?? 'idle'}
      onMouseMove={onHover}
      onClick={onPress}
    >
      {icon !== undefined && (
        <span class="z-chip__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span class="z-chip__label" dir={data ? 'auto' : undefined} translate={data ? false : undefined}>
        {label}
      </span>
      {source !== undefined && (
        <span class="z-chip__source" dir="auto" translate={false}>
          {source}
        </span>
      )}
      {count !== undefined && <span class="z-chip__count">{count}</span>}
    </div>
  );
}
