import { percent } from './focusable';
import './ProgressBar.css';

export interface ProgressBarProps {
  /** Done so far, 0–1 (clamped; NaN is 0). */
  readonly value: number;
  /**
   * A media timeline (the player's seek bar): it runs left to right in every language, as
   * video timelines do. Anything else (a programme gone by, a refresh) fills from the inline
   * start, so it mirrors in Arabic.
   */
  readonly media?: boolean;
  readonly size?: 's' | 'm';
  /** Says what it measures, for screen readers (from the catalogs). */
  readonly label?: string;
  readonly class?: string;
  readonly testId?: string;
}

/**
 * The fill is a block in normal flow, so it starts at the inline start by itself: on the
 * left in English, on the right in Arabic, with no direction-dependent CSS. A `media` bar is
 * a `dir="ltr"` island.
 */
export function ProgressBar({ value, media = false, size = 'm', label, class: extra, testId }: ProgressBarProps) {
  const pct = percent(value);
  return (
    <div
      class={`z-progress z-progress--${size}${extra === undefined ? '' : ` ${extra}`}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      dir={media ? 'ltr' : undefined}
      data-testid={testId}
    >
      <div class="z-progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
