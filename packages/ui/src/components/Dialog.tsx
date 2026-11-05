import type { ComponentChildren } from 'preact';
import './Dialog.css';

export interface DialogProps {
  /** From the catalogs, or the provider's data when `data` is set. */
  readonly title: string;
  /** The title is the provider's data (a programme's): `dir="auto"`, never translated. */
  readonly data?: boolean;
  readonly message?: string;
  /** Content between the message and the actions (the programme details' lines). */
  readonly body?: ComponentChildren;
  /** A 1,200 px panel instead of 1,000 px, for text over several lines. */
  readonly wide?: boolean;
  /** The actions: Buttons bound to the dialog screen's zone. */
  readonly children: ComponentChildren;
  readonly testId?: string;
}

/**
 * A modal over the screen: a scrim over the whole canvas (it also takes the pointer, so the
 * items under it get no hover or click) and a centred panel. The dialog is a screen pushed on
 * the focus engine's stack, so Back closes it and the screen below keeps its focus.
 */
export function Dialog({ title, data = false, message, body, wide = false, children, testId }: DialogProps) {
  return (
    <div class="z-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div class={wide ? 'z-dialog__panel z-dialog__panel--wide' : 'z-dialog__panel'}>
        <h2 class="z-dialog__title" dir={data ? 'auto' : undefined} translate={data ? false : undefined}>
          {title}
        </h2>
        {message !== undefined && <p class="z-dialog__message">{message}</p>}
        {body}
        <div class="z-dialog__actions">{children}</div>
      </div>
    </div>
  );
}
