import './Badge.css';

export type BadgeTone = 'neutral' | 'accent' | 'live' | 'warn' | 'outline';

export interface BadgeProps {
  /** From the catalogs (LIVE, NEW), or a technical mark (HD, 4K, 5.1: then `data`). */
  readonly label: string;
  readonly tone?: BadgeTone;
  /** A mark that is the same in every language: never translated. */
  readonly data?: boolean;
  readonly testId?: string;
}

/** A short mark on a row or tile. Never focusable. */
export function Badge({ label, tone = 'neutral', data = false, testId }: BadgeProps) {
  return (
    <span class={`z-badge z-badge--${tone}`} translate={data ? false : undefined} data-testid={testId}>
      {label}
    </span>
  );
}
