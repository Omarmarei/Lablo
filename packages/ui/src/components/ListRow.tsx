import type { ComponentChildren } from 'preact';
import type { FocusableProps } from './focusable';
import { focusClass } from './focusable';
import { ProgressBar } from './ProgressBar';
import './ListRow.css';

/** A programme on a channel row: the provider's title, a formatted start time, how far it is. */
export interface ProgrammeLine {
  readonly title: string;
  /** Already formatted for the locale (`20:00`). */
  readonly time?: string;
  /** Gone by, 0–1: the now line shows a small bar. */
  readonly progress?: number;
}

export interface ListRowProps extends FocusableProps {
  /** The channel number. */
  readonly number?: number | string;
  /** The channel name: the provider's text, in its own direction. */
  readonly name: string;
  readonly now?: ProgrammeLine;
  readonly next?: ProgrammeLine;
  /** The word before the next programme ("Next"), from the catalogs. Without it, no next column. */
  readonly nextLabel?: string;
  /** Shown instead of now/next when there is no guide (from the catalogs). */
  readonly placeholder?: string;
  /** Badges after the name (HD, LIVE, catch-up). */
  readonly badges?: ComponentChildren;
}

/**
 * A channel row, `--row-height` (LAYOUT.rowHeight) tall: number, name and badges over the
 * programme on now, and the next one in a column at the inline end. Names and titles are the
 * provider's text: `dir="auto"` gives each its own direction (an Arabic name in the English UI,
 * a Latin one in Arabic), `translate="no"` marks it as not ours.
 */
export function ListRow({ number, name, now, next, nextLabel, placeholder, badges, state, onHover, onPress, testId }: ListRowProps) {
  return (
    <div
      class={focusClass('z-row', state)}
      role="option"
      aria-selected={state === 'focused' ? 'true' : 'false'}
      data-testid={testId}
      data-state={state ?? 'idle'}
      onMouseMove={onHover}
      onClick={onPress}
    >
      {number !== undefined && <span class="z-row__number">{number}</span>}
      <div class="z-row__main">
        <div class="z-row__head">
          <span class="z-row__name" dir="auto" translate={false}>
            {name}
          </span>
          {badges !== undefined && <span class="z-row__badges">{badges}</span>}
        </div>
        {now !== undefined ? (
          <div class="z-row__now">
            {now.time !== undefined && <span class="z-row__time">{now.time}</span>}
            {now.progress !== undefined && <ProgressBar value={now.progress} size="s" class="z-row__progress" />}
            <span class="z-row__title" dir="auto" translate={false}>
              {now.title}
            </span>
          </div>
        ) : (
          placeholder !== undefined && <div class="z-row__now">{placeholder}</div>
        )}
      </div>
      {next !== undefined && nextLabel !== undefined && (
        <div class="z-row__next">
          <span class="z-row__next-head">
            {nextLabel}
            {next.time !== undefined && ` · ${next.time}`}
          </span>
          <span class="z-row__title" dir="auto" translate={false}>
            {next.title}
          </span>
        </div>
      )}
    </div>
  );
}
