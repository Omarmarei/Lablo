import type { Navigator } from '@zoma/ui';
import type { Guides, GuidesOptions } from './guides-state';
import { createGuides } from './guides-state';
import type { UnmatchedList } from './unmatched-state';
import { createUnmatchedList } from './unmatched-state';

/**
 * The settings screen (RELAY step 22b2): opened by the live screen's header "Settings" button,
 * pushed on the live navigator. One row for now, "TV guides" (the guides screen, and from its
 * header "Channels without a guide", step 24c); step 38 adds the track languages, the subtitle
 * style and the picture mode. Back closes it.
 */

export type SettingsItem = 'guides';

/** The settings screen's rows, in screen order. */
export const SETTINGS_ITEMS: readonly SettingsItem[] = ['guides'];

/** The screens the settings put on the live navigator (the live screen paints them instead of its own). */
export const SETTINGS_SCREENS: readonly string[] = ['settings', 'guides', 'guide-menu', 'guide-offset', 'guide-matches', 'guide-add', 'unmatched'];

export interface SettingsOptions extends Omit<GuidesOptions, 'openUnmatched'> {
  readonly nav: Navigator;
}

export interface Settings {
  readonly guides: Guides;
  /** "Channels without a guide" (step 24c). */
  readonly unmatched: UnmatchedList;
  /** Opens the settings screen. */
  open(): void;
  dispose(): void;
}

export function createSettings(options: SettingsOptions): Settings {
  const { nav } = options;
  const unmatched = createUnmatchedList({ nav, engine: options.engine });
  const guides = createGuides({ ...options, openUnmatched: () => unmatched.open() });
  return {
    guides,
    unmatched,
    open(): void {
      nav.push({
        id: 'settings',
        zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: SETTINGS_ITEMS.length }],
        onSelect: (focus) => {
          if (SETTINGS_ITEMS[focus.index] === 'guides') guides.open();
        },
      });
    },
    dispose: () => {
      guides.dispose();
      unmatched.dispose();
    },
  };
}
