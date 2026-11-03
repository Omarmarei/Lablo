import './Spinner.css';

export interface SpinnerProps {
  readonly size?: 's' | 'm' | 'l';
  /** What is loading, for screen readers (from the catalogs). */
  readonly label?: string;
  readonly testId?: string;
}

/** A turning ring: a transform animation, which the TVs' compositors run cheaply. */
export function Spinner({ size = 'm', label, testId }: SpinnerProps) {
  return <span class={`z-spinner z-spinner--${size}`} role="status" aria-label={label} data-testid={testId} />;
}
