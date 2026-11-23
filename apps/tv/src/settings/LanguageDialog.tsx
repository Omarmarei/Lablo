import type { VNode } from 'preact';
import type { FocusBinding, ItemBinding, Language } from '@lablo/ui';
import { Button, Dialog, useZone } from '@lablo/ui';
import type { AppI18n } from '../i18n';
import { LANGUAGE_NAMES } from '../i18n';
import { LANGUAGES } from '../onboarding/onboarding-state';

/**
 * Settings › "Language" as drawn (RELAY step 38d2): the row's line and the dialog's buttons are
 * each language's own name, never translated (as onboarding's first screen), so a viewer who can't
 * read the screen's language still finds them. Each name carries its `lang` and the direction of
 * its script.
 */

/** The languages' own names, in onboarding's order, joined as the row's line says them. */
export function languageLine(): string {
  return LANGUAGES.map((language) => LANGUAGE_NAMES[language]).join(' · ');
}

/** The row's line: each language's own name in a span of its language and direction (a plain function: VNode tests see the spans). */
export function languageNames(): VNode[] {
  return LANGUAGES.map((language, i) => (
    <span key={language}>
      {i > 0 && ' · '}
      <span lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} translate={false} data-testid={`settings-language-${language}`}>
        {LANGUAGE_NAMES[language]}
      </span>
    </span>
  ));
}

/** The dialog as drawn, hook-free: its title and line in the screen's language, then a button per language under its own name. */
export function LanguageDialogView({ i18n, languages, item }: { i18n: AppI18n; languages: readonly Language[]; item: (index: number) => ItemBinding }) {
  const { t } = i18n;
  return (
    <Dialog title={t('settings.language')} message={t('settings.languageBody')} testId="language-dialog">
      {languages.map((language, i) => (
        <Button key={language} label={LANGUAGE_NAMES[language]} lang={language} {...item(i)} testId={`language-dialog-${language}`} />
      ))}
    </Dialog>
  );
}

export function LanguageDialog({ i18n, binding, languages }: { i18n: AppI18n; binding: FocusBinding; languages: readonly Language[] }) {
  const zone = useZone(binding, binding.nav.top, 'languages');
  return <LanguageDialogView i18n={i18n} languages={languages} item={(i) => zone.item(i)} />;
}
