import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useMemo } from 'preact/hooks';
import type { Platform } from '@lablo/platform-api';
import type { Focus, ItemBinding, Language, LocaleSettings } from '@lablo/ui';
import { Button, ProgressBar, Spinner, connectRemote, resolveLocale, useFocus, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { appI18n, switchedTag } from '../i18n';
import type { BackupStart } from './backup-start';
import { BACKUP_START_ZONE, WELCOME_SCREEN } from './backup-start';
import '../onboarding/onboarding.css';

/**
 * "Looking for your backup" and "Welcome back" (RELAY step 32c2), in onboarding's panel. Looking:
 * the TV's language (nobody has picked one yet), scrypt's progress, "Skip". Welcome: the restored
 * profile's language, its one line about files to send again from the phone, one about sources
 * that need their login again (step 32d4b), "Continue". The
 * root carries the focus as onboarding's does (`data-screen`, `data-zone`, `data-index`), for the
 * e2e's remote driver.
 */
export function BackupStartView({ start, i18n, item, focus }: { start: BackupStart; i18n: AppI18n; item: ItemBinding; focus: Pick<Focus, 'zone' | 'index'> }) {
  const { t } = i18n;
  const shownIn = i18n.locale.pseudo ? 'pseudo' : i18n.locale.language;
  if (start.screen.value === WELCOME_SCREEN) {
    const files = start.files.value;
    const logins = start.logins.value;
    return (
      <main
        class="onboarding"
        data-testid="backup-start"
        data-screen="welcome"
        data-zone={focus.zone}
        data-index={focus.index}
        data-language={shownIn}
        data-sources={start.sources.value}
        data-files={files}
        data-logins={logins}
      >
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
          {logins > 0 && (
            <p class="onboarding__note" data-testid="backup-logins">
              {t('backup.welcomeLogins', { n: logins, settings: t('settings.title'), sources: t('sources.title') })}
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

/** The TV's own locale, as the platform reports it. */
export interface TvLocale {
  readonly tag: string;
  readonly country: string | null;
}

/**
 * The start's locale: the TV's, or "Welcome back"'s restored language (`picked`) in the TV's
 * region, as the live screen does.
 */
export function startLocale(tv: TvLocale, picked: Language | null): LocaleSettings {
  const settings = resolveLocale(tv.tag, { country: tv.country });
  return picked === null || picked === settings.language ? settings : resolveLocale(switchedTag(settings), { country: tv.country });
}

/**
 * The look-up's screens: the TV's locale first; "Welcome back" in the restored language, setting
 * `<html lang dir>` and the remote's LEFT/RIGHT before it is painted. The locale is worked out
 * while drawing (the TV's is read once), so "Welcome back" is never drawn in the TV's language
 * first: a slow engine showed that frame (CI's Chromium 53, step 32d1).
 */
export function BackupStartApp({ platform, start }: { platform: Platform; start: BackupStart }) {
  const tv = useSignal<TvLocale | null>(null);
  useEffect(() => {
    let closed = false;
    const keep = (locale: TvLocale): void => {
      if (!closed) tv.value = locale;
    };
    platform.info().then(
      (info) => keep({ tag: info.locale, country: info.country }),
      () => keep({ tag: 'en-US', country: null }),
    );
    return () => {
      closed = true;
    };
  }, [platform]);
  const known = tv.value;
  const picked: Language | null = start.screen.value === WELCOME_SCREEN ? start.language.value : null;
  const i18n = useMemo(() => (known === null ? null : appI18n(startLocale(known, picked))), [known, picked]);
  useLayoutEffect(() => {
    if (i18n === null) return;
    start.nav.setDir(i18n.locale.dir);
    document.documentElement.lang = i18n.locale.tag;
    document.documentElement.dir = i18n.locale.dir;
  }, [start, i18n]);
  useEffect(() => connectRemote({ platform, nav: start.nav, target: window }), [platform, start]);

  if (i18n === null) {
    return (
      <main class="onboarding" data-testid="onboarding" data-ready="false">
        <Spinner size="l" />
      </main>
    );
  }
  return <BackupStartScreen start={start} i18n={i18n} />;
}
