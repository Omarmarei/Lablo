import type { ComponentChildren } from 'preact';
import './Dialog.css';

export interface DialogProps {
  /** From the catalogs. */
  readonly title: string;
  readonly message?: string;
  /** The actions: Buttons bound to the dialog screen's zone. */
  readonly children: ComponentChildren;
  readonly testId?: string;
}

/**
 * A modal over the screen: a scrim over the whole canvas (it also takes the pointer, so the
 * items under it get no hover or click) and a centred panel. The dialog is a screen pushed on
 * the focus engine's stack, so Back closes it and the screen below keeps its focus.
 */
export function Dialog({ title, message, children, testId }: DialogProps) {
  return (
    <div class="z-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div class="z-dialog__panel">
        <h2 class="z-dialog__title">{title}</h2>
        {message !== undefined && <p class="z-dialog__message">{message}</p>}
        <div class="z-dialog__actions">{children}</div>
      </div>
    </div>
  );
}
