import { Spinner } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import './mapping-reading.css';

/**
 * "Reading the guides…" while a mapping's refresh runs (`reading` > 0, RELAY step 24e): the guide
 * screen and the settings' list without a guide show it. In main.js with the guide (step 35e):
 * the settings' screens are in settings.js, which imports it from here.
 */
export function MappingReading({ i18n, reading, testId }: { i18n: AppI18n; reading: number; testId: string }) {
  if (reading === 0) return null;
  return (
    <p class="mapping__reading" data-testid={testId}>
      <Spinner size="s" />
      <span>{i18n.t('mapping.reading')}</span>
    </p>
  );
}
