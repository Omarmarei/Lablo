import type { Focus, FocusBinding } from '@lablo/ui';
import { Button, Dialog, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { Parental } from './parental';
import { NO_PIN_BUTTONS, PAD_CANCEL, PAD_CELLS, PAD_COLUMNS, PAD_DELETE, PIN_LENGTH, PIN_PAD, cellDigit } from './parental';
import './parental.css';

/**
 * The PIN pad (RELAY step 38b) over an opaque page, so nothing under it shows (the player's
 * picture included): the title, how to type, four boxes (a dot for each digit typed, never the
 * digit), the problem, and the 3 × 4 grid drawn left to right in every language.
 */
export function PinPadScreen({ parental, i18n, binding, focus }: { parental: Parental; i18n: AppI18n; binding: FocusBinding; focus: Focus }) {
  const view = parental.pad.value;
  const { t } = i18n;
  const zone = useZone(binding, binding.nav.top, PIN_PAD);
  if (view === null) return null;
  const boxes = [];
  for (let i = 0; i < PIN_LENGTH; i += 1) {
    boxes.push(
      <span key={i} class={i < view.typed ? 'pin__box is-filled' : 'pin__box'}>
        {i < view.typed ? '•' : ''}
      </span>,
    );
  }
  const rows = [];
  for (let r = 0; r < PAD_CELLS / PAD_COLUMNS; r += 1) {
    const cells = [];
    for (let c = 0; c < PAD_COLUMNS; c += 1) {
      const i = r * PAD_COLUMNS + c;
      const digit = cellDigit(i);
      const label = digit !== -1 ? i18n.number(digit) : t(i === PAD_DELETE ? 'parental.delete' : 'action.cancel');
      cells.push(
        <span key={i} class="pin__cell">
          <Button label={label} {...zone.item(i)} testId={`pin-${i}`} />
        </span>,
      );
    }
    rows.push(
      <div key={r} class="pin__row">
        {cells}
      </div>,
    );
  }
  const problem = view.problem === null ? '' : t(view.problem === 'wrong' ? 'parental.wrong' : view.problem === 'wait' ? 'parental.wait' : 'parental.failed');
  const body = (
    <div class="pin__body">
      <p class="pin__boxes" role="img" aria-label={t('parental.boxes', { n: view.typed })} data-testid="pin-boxes" data-typed={view.typed}>
        {boxes}
      </p>
      <p class="pin__problem" role="alert" data-testid="pin-problem" data-problem={view.problem ?? ''}>
        {problem}
      </p>
      <div class="pin__grid" dir="ltr" data-testid="pin-grid">
        {rows}
      </div>
    </div>
  );
  return (
    <main
      class="pin"
      data-testid="pin"
      data-purpose={view.purpose}
      data-busy={String(view.busy)}
      data-pending={parental.pending.value}
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-dir={focus.dir}
    >
      <Dialog title={t(view.purpose === 'return' ? 'parental.returnTitle' : 'parental.padTitle')} message={t('parental.padHint')} body={body} testId="pin-dialog">
        {null}
      </Dialog>
    </main>
  );
}

/** "Locked groups need a PIN" (RELAY step 38b; step 38c gives it a way to set one), over an opaque page as the pad is. */
export function NoPinScreen({ i18n, binding, focus }: { i18n: AppI18n; binding: FocusBinding; focus: Focus }) {
  const { t } = i18n;
  const zone = useZone(binding, binding.nav.top, NO_PIN_BUTTONS);
  return (
    <main class="pin" data-testid="no-pin" data-screen={focus.screen} data-zone={focus.zone} data-index={focus.index} data-dir={focus.dir}>
      <Dialog title={t('parental.noPinTitle')} message={t('parental.noPinMessage')} testId="no-pin-dialog">
        <Button label={t('parental.ok')} variant="primary" {...zone.item(0)} testId="no-pin-ok" />
      </Dialog>
    </main>
  );
}
