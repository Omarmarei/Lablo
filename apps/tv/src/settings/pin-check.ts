import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { LoadedProfile } from '@lablo/data';
import type { Platform } from '@lablo/platform-api';
import type { Navigator, Screen, TextEditorOptions, ZoneSpec } from '@lablo/ui';
import { storedSources } from '../onboarding/engine-loader';
import { GROUPS_VISIBLE } from './groups-state';
import type { CheckSource, LoginForm } from './source-login';
import { checkSources, createLoginForm } from './source-login';

/**
 * The PIN's login check (RELAY step 38c2, architecture.md §1.4 item 10 "Built in step 38c2"):
 * before a first PIN ("Set a PIN") or one in place of a forgotten PIN ("Forgot your PIN?"), one
 * source's login typed again and compared with the stored one (step 38's Q2 and Q3). Settings ›
 * "Parental control" and the rails' no-PIN dialog run it.
 *
 *   pick   (`PICK_SCREEN`, with two sources or more that keep their login: each one's name and
 *          server; OK opens its form)
 *   form   (`CHECK_SCREEN`: `source-login.ts`' form in its check mode)
 *   none   (`NONE_SCREEN`, when no source keeps a login: a phone's file has none, and a source a
 *          backup brought back without its login needs it again first; a dialog with one OK)
 *
 * With one such source its form opens at once. The right login closes the form and the pick, then
 * `matched` goes on. Back on the form goes back to the pick (or out, with one source), Back on the
 * pick goes out; nothing goes on.
 */

export const PICK_SCREEN = 'pin-pick';
export const CHECK_SCREEN = 'pin-check';
export const NONE_SCREEN = 'pin-none';
export const PIN_CHECK_SCREENS: readonly string[] = [PICK_SCREEN, CHECK_SCREEN, NONE_SCREEN];
export const NONE_BUTTONS = 'buttons';

export interface PinCheckEngine {
  profile(): Promise<LoadedProfile | null>;
}

export interface PinCheckOptions {
  readonly nav: Navigator;
  readonly engine: PinCheckEngine;
  /** The TV's keyboard for the form. */
  readonly platform: Pick<Platform, 'textKey' | 'onSoftKeyboard'>;
  /** Finds a field's input (tests). */
  readonly find?: TextEditorOptions['find'];
  /** The clock (the click pairing in the editor). */
  readonly now?: () => number;
}

export interface PinCheck {
  readonly form: LoginForm;
  /** The pick's sources while it is on the stack. */
  readonly sources: ReadonlySignal<readonly CheckSource[]>;
  /** The pick while it is on the stack. */
  readonly pickScreen: ReadonlySignal<Screen | null>;
  /** The sources' read in flight (e2e: 0 means settled). */
  readonly pending: ReadonlySignal<number>;
  /** Reads the sources, then the pick, the form or the dialog: `matched` after the right login. */
  run(matched: () => void): void;
  dispose(): void;
}

const NONE_ZONE: ZoneSpec = { kind: 'list', id: NONE_BUTTONS, axis: 'horizontal', count: 1 };

export function createPinCheck(options: PinCheckOptions): PinCheck {
  const { nav, engine } = options;
  const form = createLoginForm({ nav, platform: options.platform, find: options.find, now: options.now, id: CHECK_SCREEN });
  const sources = signal<readonly CheckSource[]>([]);
  const pickScreen = signal<Screen | null>(null);
  const pending = signal(0);
  let disposed = false;

  /** The pick is on top when this runs: Back on it, or the form gone after the right login. */
  const closePick = (): void => {
    pickScreen.value = null;
    nav.pop();
  };

  const openPick = (usable: readonly CheckSource[], matched: () => void): void => {
    sources.value = usable;
    pickScreen.value = nav.push({
      id: PICK_SCREEN,
      zones: [{ kind: 'list', id: 'rows', axis: 'vertical', count: usable.length, visible: GROUPS_VISIBLE }],
      onSelect: (focus) => {
        const source = usable[focus.index];
        if (source === undefined) return;
        form.check(source, () => {
          closePick();
          matched();
        });
      },
      onIntent: (intent) => {
        if (intent !== 'BACK') return false;
        closePick();
        return true;
      },
    });
  };

  const openNone = (): void => {
    nav.push({
      id: NONE_SCREEN,
      zones: [NONE_ZONE],
      onSelect: () => {
        nav.pop();
      },
    });
  };

  return {
    form,
    sources,
    pickScreen,
    pending,
    run(matched: () => void): void {
      if (disposed || pending.value > 0) return;
      // (What was on top when asked: the user may have gone Back while the sources were read.)
      const from = nav.top;
      pending.value += 1;
      engine.profile().then(
        (profile) => {
          pending.value -= 1;
          if (disposed || nav.top !== from) return;
          const usable = checkSources(storedSources(profile));
          if (usable.length === 0) openNone();
          else if (usable.length === 1) form.check(usable[0]!, matched);
          else openPick(usable, matched);
        },
        (error: unknown) => {
          pending.value -= 1;
          console.warn('The sources could not be read for the PIN', error);
        },
      );
    },
    dispose(): void {
      disposed = true;
      form.dispose();
    },
  };
}
