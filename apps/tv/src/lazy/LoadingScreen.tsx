import type { Focus, FocusBinding } from '@lablo/ui';
import { Button, Spinner, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import type { LoadPhase } from './lazy-file';
import { LOADING_RETRY } from './lazy-file';
import './lazy.css';

interface Props {
  /** `spinner` or `failed`: the quiet phase paints the screen under it instead (LiveApp). */
  readonly phase: LoadPhase;
  readonly i18n: AppI18n;
  readonly binding: FocusBinding;
  readonly focus: Focus;
}

/**
 * The loading screen of a lazy file (RELAY step 35e, `lazy-file.ts`) once its quiet phase is over:
 * a spinner, or the failure with "Try again", in the middle of the screen.
 */
export function LoadingScreen({ phase, i18n, binding, focus }: Props) {
  const { t } = i18n;
  const retry = useZone(binding, binding.nav.top, LOADING_RETRY);
  return (
    <main
      class="lazy-loading"
      data-testid="lazy-loading"
      data-phase={phase}
      data-language={i18n.locale.pseudo ? 'pseudo' : i18n.locale.language}
      data-screen={focus.screen}
      data-zone={focus.zone}
      data-index={focus.index}
      data-pointer={String(focus.pointer)}
      data-dir={focus.dir}
    >
      {phase === 'failed' ? (
        <div class="lazy-loading__failed" data-testid="lazy-loading-failed">
          <p class="lazy-loading__text">{t('lazy.failed')}</p>
          <div class="lazy-loading__actions">
            <Button label={t('loading.retry')} variant="primary" {...retry.item(0)} testId="lazy-loading-retry" />
          </div>
        </div>
      ) : (
        <Spinner size="l" testId="lazy-loading-spinner" />
      )}
    </main>
  );
}
