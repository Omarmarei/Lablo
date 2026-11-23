import type { PairCode } from '@lablo/data/client';
import type { PairStatus } from '@lablo/protocol';
import type { FocusBinding, ZoneView } from '@lablo/ui';
import { Button, ProgressBar, Spinner, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { errorText, phaseText, refusalText } from '../onboarding/load-text';
import type { PairAction, PairView, Pairing } from './pair-state';
import { asksPin, pairActions } from './pair-state';
import { QR_QUIET, qrModulePx, qrPath } from './pair-qr';
import './pair.css';

/**
 * The pairing screen (RELAY step 31c2a), on onboarding's navigator or the live one (Settings ›
 * Sources). Every text comes from the catalogs; the code, the address and the source's name are
 * data (`dir="ltr"`, `translate=false`, or isolated arguments). For the PIN's login check (step
 * 38c4, `check`) its own title, and the mismatch's line.
 */

type Translate = AppI18n['t'];

/** A technical name inside a sentence: never translated (an argument, so it is isolated in Arabic). */
const QR_NAME = 'QR';

/** The code as people read it: two groups of four. */
export function groupedCode(code: string): string {
  return code.slice(0, 4) + ' ' + code.slice(4);
}

function actionLabel(t: Translate, action: PairAction): string {
  if (action === 'retry-code' || action === 'retry-load') return t('loading.retry');
  if (action === 'new-code') return t('pair.newCode');
  if (action === 'close') return t('pair.done');
  // The done view's prompt (step 38c3).
  if (action === 'set-pin') return t('parental.set');
  if (action === 'later') return t('done.later');
  return t('action.cancel');
}

/** The QR code: dark modules on a light square, whole pixels per module (`crispEdges`), never mirrored. */
export function QrCode({ code }: { code: PairCode }) {
  const size = code.qr.size + 2 * QR_QUIET;
  const px = size * qrModulePx(code.qr.size);
  return (
    <svg
      class="pair__qr"
      viewBox={`0 0 ${size} ${size}`}
      width={px}
      height={px}
      shape-rendering="crispEdges"
      role="img"
      aria-label={code.typed}
      data-testid="pair-qr"
      data-size={code.qr.size}
      data-version={code.qr.version}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={qrPath(code.qr.rows)} fill="#000" />
    </svg>
  );
}

export function CodeView({ i18n, view }: { i18n: AppI18n; view: Extract<PairView, { kind: 'code' }> }) {
  const { t } = i18n;
  return (
    <div class="pair__body">
      <div class="pair__steps">
        <p class="pair__text">{t('pair.scan', { qr: QR_NAME })}</p>
        <p class="pair__text">{t('pair.open')}</p>
        <p class="pair__address" dir="ltr" translate={false} data-testid="pair-address">
          {view.code.typed}
        </p>
        <p class="pair__text">{t('pair.enter')}</p>
        <p class="pair__code" dir="ltr" translate={false} data-testid="pair-code">
          {groupedCode(view.code.code)}
        </p>
        <p class={view.trouble ? 'pair__state pair__state--trouble' : 'pair__state'} role="status" data-testid="pair-state">
          {view.trouble ? t('pair.trouble') : t('pair.waiting')}
        </p>
        {view.note === 'unreadable' && (
          <p class="pair__note" data-testid="pair-note">
            {t('pair.unreadable')}
          </p>
        )}
      </div>
      <div class="pair__side">
        <QrCode code={view.code} />
        <p class="pair__private">{t('pair.private')}</p>
      </div>
    </div>
  );
}

/** What the view says, under the title (the code view has its own body); `pin`: the done view's prompt (step 38c3). */
export function Message({ i18n, view, name, file = false, pin = false }: { i18n: AppI18n; view: PairView; name: string; file?: boolean; pin?: boolean }) {
  const { t } = i18n;
  if (view.kind === 'opening') {
    return (
      <div class="pair__progress">
        <Spinner size="m" label={t('pair.opening')} />
        <p class="pair__status">{t('pair.opening')}</p>
        {view.note === 'unreadable' && (
          <p class="pair__note" data-testid="pair-note">
            {t('pair.unreadable')}
          </p>
        )}
      </div>
    );
  }
  if (view.kind === 'unavailable') {
    return (
      <p class="pair__text pair__error" role="alert" data-testid="pair-error" data-failure={view.failure}>
        {view.failure === 'rate' ? t('pair.rate') : t('pair.unavailable')}
      </p>
    );
  }
  if (view.kind === 'ended') {
    return (
      <p class="pair__text" data-testid="pair-ended">
        {t('pair.ended')}
      </p>
    );
  }
  if (view.kind === 'mismatch') {
    return (
      <p class="pair__text pair__error" role="alert" data-testid="pair-mismatch">
        {t('pair.mismatch')}
      </p>
    );
  }
  if (view.kind === 'loading') {
    const progress = view.progress;
    const phase = progress === null ? 'checking' : progress.phase;
    const status = phaseText(t, phase, progress === null ? 0 : progress.items);
    const fraction = progress !== null && progress.total !== null && progress.total > 0 ? progress.bytes / progress.total : 0;
    return (
      <div>
        <div class="pair__progress">
          <Spinner size="m" label={status} />
          <p class="pair__status" data-testid="pair-load" data-phase={phase}>
            {status}
          </p>
        </div>
        <ProgressBar value={fraction} label={status} class="pair__bar" />
      </div>
    );
  }
  if (view.kind === 'failed' || view.kind === 'refused') {
    return (
      <p class="pair__text pair__error" role="alert" data-testid="pair-error" data-code={view.kind === 'refused' ? 'refused' : view.code}>
        {view.kind === 'refused' ? refusalText(i18n, view.refusal) : errorText(t, view.code, view.httpStatus, file)}
      </p>
    );
  }
  if (view.kind === 'done') {
    return (
      <div>
        <p class="pair__text">{t('done.body', { name })}</p>
        <ul class="pair__counts">
          <li data-testid="pair-live" data-n={view.result.live}>
            {t('done.live', { n: view.result.live })}
          </li>
          <li data-testid="pair-movies" data-n={view.result.movies}>
            {t('done.movies', { n: view.result.movies })}
          </li>
          <li data-testid="pair-series" data-n={view.result.series}>
            {t('done.series', { n: view.result.series })}
          </li>
        </ul>
        {pin && (
          <p class="pair__text" data-testid="pair-pin">
            {t('done.pinNote')}
          </p>
        )}
      </div>
    );
  }
  return null;
}

export function titleOf(t: Translate, view: PairView, name: string, check = false): string {
  // The PIN's check (step 38c4) has one title: it never loads a source.
  if (check) return t('pair.checkTitle');
  if (view.kind === 'loading') return t('loading.title', { name });
  if (view.kind === 'failed' || view.kind === 'refused') return t('loading.failed', { name });
  if (view.kind === 'done') return t('done.title');
  return t('pair.title');
}

export interface PairContentProps {
  readonly i18n: AppI18n;
  readonly view: PairView;
  /** The source's name (the titles of the load's views). */
  readonly name: string;
  /** The status sent to the phone, if any (`data-sent`). */
  readonly sent: PairStatus | null;
  readonly zone: ZoneView;
  /** The source is the phone's file (step 31d2b1): its failures have no "Try again" and their own words. */
  readonly file?: boolean;
  /** The done view offers "Set a PIN" (step 38c3). */
  readonly pin?: boolean;
  /** The PIN's login check (step 38c4). */
  readonly check?: boolean;
}

/** The page as drawn for a view: hook-free (the tests call it as a function). */
export function PairContent({ i18n, view, name, sent, zone, file = false, pin = false, check = false }: PairContentProps) {
  const { t } = i18n;
  const actions = pairActions(view.kind, file, pin);
  // The last button leads, but for the prompt's "Set a PIN" (step 38c3).
  const lead = actions[0] === 'set-pin' ? 0 : actions.length - 1;
  return (
    <div
      class="pair"
      data-testid="pair"
      data-view={view.kind}
      data-code={view.kind === 'code' ? view.code.code : ''}
      data-trouble={String(view.kind === 'code' && view.trouble)}
      data-sent={sent ?? ''}
      data-purpose={check ? 'check' : 'add'}
    >
      <h1 class="pair__title" data-testid="pair-title">
        {titleOf(t, view, name, check)}
      </h1>
      {view.kind === 'code' ? <CodeView i18n={i18n} view={view} /> : <Message i18n={i18n} view={view} name={name} file={file} pin={pin} />}
      <div class="pair__actions">
        {actions.map((action, i) => (
          <Button key={action} label={actionLabel(t, action)} variant={i === lead && action !== 'cancel' ? 'primary' : undefined} {...zone.item(i)} testId={`pair-action-${i}`} />
        ))}
      </div>
    </div>
  );
}

export function PairPage({ pairing, binding, i18n }: { pairing: Pairing; binding: FocusBinding; i18n: AppI18n }) {
  const zone = useZone(binding, binding.nav.top, 'actions');
  const draft = pairing.draft.value;
  const view = pairing.view.value;
  return (
    <PairContent
      i18n={i18n}
      view={view}
      name={draft === null ? '' : draft.name}
      sent={pairing.sent.value}
      zone={zone}
      file={draft !== null && draft.type === 'm3u-file'}
      pin={asksPin(view, pairing.canSetPin)}
      check={pairing.purpose.value === 'check'}
    />
  );
}
