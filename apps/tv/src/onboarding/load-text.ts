import { messageIn } from '../gate/gate-state';
import type { Refusal } from '../gate/gate-state';
import type { AppI18n } from '../i18n';
import type { LoadErrorCode, LoadPhase } from './loader';

/**
 * The words of a source's load (RELAY step 13a), shared by onboarding's loading screen and the
 * pairing screen's (step 31c2a).
 */

type Translate = AppI18n['t'];

/** Why a load failed, in words; a file from the phone (step 31d2b1) has its own words where a link's would be wrong. */
export function errorText(t: Translate, code: LoadErrorCode, status: number | null, file = false): string {
  if (code === 'file') return t('error.file');
  if (file && code === 'format') return t('error.fileFormat');
  if (file && code === 'network') return t('error.fileNetwork');
  if (code === 'http') return t('error.http', { status: status ?? 0 });
  if (code === 'auth') return t('error.auth');
  if (code === 'expired') return t('error.expired');
  if (code === 'blocked') return t('error.blocked');
  if (code === 'blocklisted') return t('error.blocklisted');
  if (code === 'network') return t('error.network');
  if (code === 'format') return t('error.format');
  if (code === 'empty') return t('error.empty');
  return t('error.other');
}

/** The config's refusal (step 30c2b): the rule's own words in the UI's language, else the catalog's. */
export function refusalText(i18n: AppI18n, refusal: Refusal): string {
  const message = refusal.message;
  return message === null ? i18n.t('error.refused') : messageIn(message, i18n.locale.language);
}

/** What the load is doing, in words. */
export function phaseText(t: Translate, phase: LoadPhase, items: number): string {
  if (phase === 'checking') return t('loading.checking');
  if (phase === 'saving') return t('loading.saving');
  if (phase === 'guide') return t('loading.guide');
  return t('loading.download', { n: items });
}
