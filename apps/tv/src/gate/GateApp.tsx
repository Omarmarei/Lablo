import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Platform } from '@lablo/platform-api';
import { Button, Dialog, resolveLocale, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { appI18n } from '../i18n';
import type { Gate } from './gate-state';
import { GATE_ZONE, messageIn } from './gate-state';
import './gate.css';

/**
 * The gate's view (RELAY step 30c2a) in `i18n`'s language: `disable-app` and the update as a
 * full-screen message with "Close Lablo", a notice as a dialog with "OK". The doc's own message
 * shows in the UI's language; without one, `disable-app` says the catalog's text.
 */
export function GateScreen({ gate, i18n }: { gate: Gate; i18n: AppI18n }) {
  const view = gate.view.value;
  if (view === null) return null;
  const { t } = i18n;
  const language = i18n.locale.language;
  const zone = useZone(gate.binding, gate.binding.nav.top, GATE_ZONE);
  const id = view.kind === 'update' ? '' : view.id;
  const exit = String(gate.exitRequested.value);
  const shownIn = i18n.locale.pseudo ? 'pseudo' : language;
  if (view.kind === 'notice') {
    return (
      <div class="gate-notice" data-testid="gate" data-kind={view.kind} data-id={id} data-exit={exit} data-language={shownIn}>
        <Dialog title={t('gate.noticeTitle')} message={messageIn(view.message, language)} testId="gate-notice">
          <Button label={t('gate.ok')} variant="primary" {...zone.item(0)} testId="gate-ok" />
        </Dialog>
      </div>
    );
  }
  const update = view.kind === 'update';
  const message = update ? t('gate.updateMessage') : view.message === null ? t('gate.disabledMessage') : messageIn(view.message, language);
  return (
    <div
      class="gate"
      role="alertdialog"
      aria-modal="true"
      aria-label={update ? t('gate.updateTitle') : t('gate.disabledTitle')}
      data-testid="gate"
      data-kind={view.kind}
      data-id={id}
      data-exit={exit}
      data-language={shownIn}
    >
      <div class="gate__panel">
        <h1 class="gate__title">{update ? t('gate.updateTitle') : t('gate.disabledTitle')}</h1>
        <p class="gate__message" data-testid="gate-message">
          {message}
        </p>
        {update && (
          <p class="gate__versions" data-testid="gate-versions">
            {t('gate.versions', { current: view.version, needed: view.minVersion })}
          </p>
        )}
        <div class="gate__actions">
          <Button label={t('gate.close')} variant="primary" {...zone.item(0)} testId="gate-close" />
        </div>
      </div>
    </div>
  );
}

/**
 * The gate in its own root over the app: in the UI's language (`<html lang>`, which onboarding
 * and the live screen set from the language picked), else the TV's, in the TV's region.
 */
export function GateApp({ platform, gate }: { platform: Pick<Platform, 'info'>; gate: Gate }) {
  const device = useSignal<{ readonly tag: string; readonly country: string | null } | null>(null);
  useEffect(() => {
    let closed = false;
    platform.info().then(
      (info) => {
        if (!closed) device.value = { tag: info.locale, country: info.country };
      },
      () => {
        if (!closed) device.value = { tag: 'en-US', country: null };
      },
    );
    return () => {
      closed = true;
    };
  }, [platform]);
  // Read first: the gate paints again whenever its view changes.
  const view = gate.view.value;
  const shown = device.value;
  if (view === null || shown === null) return null;
  const page = document.documentElement.lang;
  return <GateScreen gate={gate} i18n={appI18n(resolveLocale(page === '' ? shown.tag : page, { country: shown.country }))} />;
}
