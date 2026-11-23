import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Language, Navigator, Screen } from '@lablo/ui';
import { LANGUAGES } from '../onboarding/onboarding-state';

/**
 * Settings › "Language" (RELAY step 38d2): OK on the row opens a dialog over the settings, a button
 * per language under its own name, the focus on the language on show. OK on another language
 * closes it and switches the app (main writes the profile's `onboarding.language`, then paints the
 * live screen again in it: the settings' screens follow in place, nothing reloads). OK on the
 * language on show, or Back, only closes it. Why a dialog and not a switch in place: one stray OK
 * would turn the whole screen to a language the viewer may not read.
 *
 * Main-safe as the settings are: no `trim`, `.sort(` or regex.
 */

export const LANGUAGE_SCREEN = 'language';

/** The app's language, as main gives it (step 38d2). */
export interface LanguageOptions {
  /** The language on show (the page's: en-XA is `en`). */
  current(): Language;
  /** Switches the app to `language`: the profile, then the screens. */
  set(language: Language): void;
}

export interface LanguageChoice {
  /** The languages, in the dialog's order (onboarding's). */
  readonly languages: readonly Language[];
  /** The settings' screen under the dialog while it is open (its list paints under it). */
  readonly under: ReadonlySignal<Screen | null>;
  /** Opens the dialog over the settings' screen (on top). */
  open(): void;
}

export function createLanguageChoice(nav: Navigator, options: LanguageOptions): LanguageChoice {
  const under = signal<Screen | null>(null);

  const close = (): void => {
    under.value = null;
    nav.pop();
  };

  return {
    languages: LANGUAGES,
    under,
    open(): void {
      const shown = options.current();
      under.value = nav.top;
      const dialog = nav.push({
        id: LANGUAGE_SCREEN,
        zones: [{ kind: 'list', id: 'languages', axis: 'horizontal', count: LANGUAGES.length }],
        onIntent: (intent) => {
          if (intent !== 'BACK') return false;
          close();
          return true;
        },
        onSelect: (focus) => {
          const picked = LANGUAGES[focus.index];
          close();
          // (Closed first: the settings' list is on top again when the app switches.)
          if (picked !== undefined && picked !== shown) options.set(picked);
        },
      });
      // (An unlisted language, -1, lands on the first: the focus engine clamps it.)
      dialog.focus('languages', LANGUAGES.indexOf(shown));
    },
  };
}
