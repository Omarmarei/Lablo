import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { Platform } from '@lablo/platform-api';
import type { Focus, ItemBinding, Language } from '@lablo/ui';
import { Button, ProgressBar, Spinner, connectRemote, resolveLocale, useFocus, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { appI18n, switchedTag } from '../i18n';
import type { BackupStart } from './backup-start';
import { BACKUP_START_ZONE, WELCOME_SCREEN } from './backup-start';
import '../onboarding/onboarding.css';

/**
 * "Looking for your backup" and "Welcome back" (RELAY step 32c2), in onboarding's panel. Looking:
 * the TV's language (nobody has picked one yet), scrypt's progress, "Skip". Welcome: the restored
 * profile's language, its one line about files to send again from the phone, "Continue". The
 * root carries the focus as onboarding's does (`data-screen`, `data-zone`, `data-index`), for the
 * e2e's remote driver.
 */
export function BackupStartView({ start, i18n, item, focus }: { start: BackupStart; i18n: AppI18n; item: ItemBinding; focus: Pick<Focus, 'zone' | 'index'> }) {
  const { t } = i18n;
  const shownIn = i18n.locale.pseudo ? 'pseudo' : i18n.locale.language;
  if (start.screen.value === WELCOME_SCREEN) {
    const files = start.files.value;
    return (
      <main class="onboarding" data-testid="backup-start" data-screen="welcome" data-zone={focus.zone} data-index={focus.index} data-language={shownIn} data-sources={start.sources.value} data-files={files}>
        <div class="onboarding__panel">
          <h1 class="onboarding__title" data-testid="backup-title">
            {t('backup.welcomeTitle')}
          </h1>
          <p class="onboarding__text">{t('backup.welcomeBody')}</p>
          {files > 0 && (
            <p class="onboarding__note" data-testid="backup-files">
              {t('backup.welcomeFiles', { settings: t('settings.title'), sources: t('sources.title'), add: t('sources.addPhone') })}
            </p>
          )}
          <div class="onboarding__actions">
            <Button label={t('backup.continue')} variant="primary" {...item} testId="backup-continue" />
          </div>
        </div>
      </main>
    );
  }
  const progress = start.progress.value;
  return (
    <main
      class="onboarding"
      data-testid="backup-start"
      data-screen="looking"
      data-zone={focus.zone}
      data-index={focus.index}
      data-language={shownIn}
      data-progress={progress === null ? '' : String(progress)}
      data-skipped={String(start.skipped.value)}
    >
      <div class="onboarding__panel">
        <h1 class="onboarding__title" data-testid="backup-title">
          {t('backup.lookingTitle')}
        </h1>
        <p class="onboarding__text">{t('backup.lookingBody')}</p>
        <div class="onboarding__progress">
          <Spinner size="m" label={t('backup.lookingTitle')} />
        </div>
        <ProgressBar value={progress === null ? 0 : progress} label={t('backup.lookingTitle')} class="onboarding__bar" testId="backup-progress" />
        <div class="onboarding__actions">
          <Button label={t('backup.skip')} {...item} testId="backup-skip" />
        </div>
      </div>
    </main>
  );
}

function BackupStartScreen({ start, i18n }: { start: BackupStart; i18n: AppI18n }) {
  // Re-renders on each focus change (the button's state).
  const focus = useFocus(start.binding);
  const zone = useZone(start.binding, start.binding.nav.top, BACKUP_START_ZONE);
  return <BackupStartView start={start} i18n={i18n} item={zone.item(0)} focus={focus} />;
}

/**
 * The look-up's screens: the TV's locale first; "Welcome back" in the restored language (in the
 * TV's region, as the live screen does), setting `<html lang dir>` and the remote's LEFT/RIGHT.
 */
export function BackupStartApp({ platform, start }: { platform: Platform; start: BackupStart }) {
  const i18n = useSignal<AppI18n | null>(null);
  const picked: Language | null = start.screen.value === WELCOME_SCREEN ? start.language.value : null;
  useEffect(() => {
    let closed = false;
    const show = (tag: string, country: string | null): void => {
      if (closed) return;
      const settings = resolveLocale(tag, { country });
      const locale = picked === null || picked === settings.language ? settings : resolveLocale(switchedTag(settings), { country });
      start.nav.setDir(locale.dir);
      document.documentElement.lang = locale.tag;
      document.documentElement.dir = locale.dir;
      i18n.value = appI18n(locale);
    };
    platform.info().then(
      (info) => show(info.locale, info.country),
      () => show('en-US', null),
    );
    return () => {
      closed = true;
    };
  }, [platform, start, picked]);
  useEffect(() => connectRemote({ platform, nav: start.nav, target: window }), [platform, start]);

  if (i18n.value === null) {
    return (
      <main class="onboarding" data-testid="onboarding" data-ready="false">
        <Spinner size="l" />
      </main>
    );
  }
  return <BackupStartScreen start={start} i18n={i18n.value} />;
}
