import type { ComponentChildren } from 'preact';
import type { FocusableProps } from './focusable';
import { focusClass } from './focusable';
import './Button.css';

export interface ButtonProps extends FocusableProps {
  /** From the catalogs: components never hold text of their own. */
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'danger';
  /** Shown dimmed and not clickable. It can still take the focus (the screen's onSelect ignores it). */
  readonly disabled?: boolean;
  /** An inline SVG before the label (Zoma Sans has no arrows or symbols). */
  readonly icon?: ComponentChildren;
}

export function Button({ label, variant = 'secondary', disabled = false, icon, state, onHover, onPress, testId }: ButtonProps) {
  const base = `z-button z-button--${variant}${disabled ? ' is-disabled' : ''}`;
  return (
    <div
      class={focusClass(base, state)}
      role="button"
      aria-disabled={disabled ? 'true' : undefined}
      data-testid={testId}
      data-state={state ?? 'idle'}
      onMouseMove={onHover}
      onClick={disabled ? undefined : onPress}
    >
      {icon !== undefined && <span class="z-button__icon">{icon}</span>}
      <span class="z-button__label">{label}</span>
    </div>
  );
}
