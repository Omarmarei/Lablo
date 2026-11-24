import type { ComponentChildren } from 'preact';
import type { FocusableProps } from './focusable';
import { focusClass } from './focusable';
import './Button.css';

export interface ButtonProps extends FocusableProps {
  /**
   * From the catalogs: components never hold text of their own. An icon-only button (`iconOnly`)
   * doesn't show it: it is the button's name for screen readers (`aria-label`).
   */
  readonly label: string;
  readonly variant?: 'primary' | 'secondary' | 'danger';
  /** Shown dimmed and not clickable. It can still take the focus (the screen's onSelect ignores it). */
  readonly disabled?: boolean;
  /** An inline SVG before the label (Lablo Sans has no arrows or symbols). */
  readonly icon?: ComponentChildren;
  /**
   * The icon alone (RELAY step 28b1: the live header's "Search" and "Settings"): a square button,
   * as wide as it is tall, the label only in `aria-label` (in the screen's language: `lang` is for a
   * shown label). Needs `icon`.
   */
  readonly iconOnly?: boolean;
  /**
   * The label's language when it isn't the screen's: a language's own name on a language switch
   * ("English" on the Arabic screen). The label gets `lang` and is never translated.
   */
  readonly lang?: string;
  /**
   * The remote's colour key that presses this button too (RELAY step 39b): a small dot of its
   * colour in the button's top-end corner, which takes no room (decorative: `aria-hidden`).
   */
  readonly colourKey?: ColourKey;
}

/** A colour key on the remote (RELAY step 39b). */
export type ColourKey = 'red' | 'green' | 'yellow' | 'blue';

export function Button({ label, variant = 'secondary', disabled = false, icon, iconOnly = false, lang, colourKey, state, onHover, onPress, testId }: ButtonProps) {
  const bare = iconOnly && icon !== undefined;
  const base = `z-button z-button--${variant}${bare ? ' z-button--icon' : ''}${disabled ? ' is-disabled' : ''}`;
  return (
    <div
      class={focusClass(base, state)}
      role="button"
      aria-label={bare ? label : undefined}
      aria-disabled={disabled ? 'true' : undefined}
      data-testid={testId}
      data-state={state ?? 'idle'}
      onMouseMove={onHover}
      onClick={disabled ? undefined : onPress}
    >
      {icon !== undefined && <span class="z-button__icon">{icon}</span>}
      {!bare && (
        <span class="z-button__label" lang={lang} translate={lang === undefined ? undefined : false}>
          {label}
        </span>
      )}
      {colourKey !== undefined && <span class={`z-button__key z-button__key--${colourKey}`} aria-hidden="true" data-key={colourKey} />}
    </div>
  );
}
