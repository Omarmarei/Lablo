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
}

/** One category of a rail. */
export function Chip({ label, selected = false, count, data = false, state, onHover, onPress, testId }: ChipProps) {
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
      <span class="z-chip__label" dir={data ? 'auto' : undefined} translate={data ? false : undefined}>
        {label}
      </span>
      {count !== undefined && <span class="z-chip__count">{count}</span>}
    </div>
  );
}
