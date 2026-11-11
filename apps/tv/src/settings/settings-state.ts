import type { Navigator } from '@lablo/ui';
import type { Guides, GuidesEngine, GuidesOptions } from './guides-state';
import { createGuides } from './guides-state';
import type { Mapping, MappingEngine } from './mapping-state';
import { MAPPING_SCREEN, createMapping } from './mapping-state';
import type { UnmatchedEngine, UnmatchedList } from './unmatched-state';
import { createUnmatchedList } from './unmatched-state';

/**
 * The settings screen (RELAY step 22b2): opened by the live screen's header "Settings" button,
 * pushed on the live navigator. One row for now, "TV guides" (the guides screen, and from its
 * header "Channels without a guide", step 24c, whose OK on a channel opens the manual mapping's
 * picker, step 24e); step 38 adds the track languages, the subtitle style and the picture mode.
 * Back closes it.
 */

export type SettingsItem = 'guides';

/** The settings screen's rows, in screen order. */
export const SETTINGS_ITEMS: readonly SettingsItem[] = ['guides'];

/** The screens the settings put on the live navigator (the live screen paints them instead of its own). */
export const SETTINGS_SCREENS: readonly string[] = ['settings', 'guides', 'guide-menu', 'guide-offset', 'guide-matches', 'guide-add', 'unmatched', MAPPING_SCREEN];

export interface SettingsOptions extends Omit<GuidesOptions, 'openUnmatched' | 'engine'> {
  readonly nav: Navigator;
  readonly engine: GuidesEngine & UnmatchedEngine & MappingEngine;
}

export interface Settings {
  readonly guides: Guides;
  /** "Channels without a guide" (step 24c). */
  readonly unmatched: UnmatchedList;
  /** The manual mapping's picker (step 24e): from a channel without a guide, or from the programme details. */
  readonly mapping: Mapping;
  /** Opens the settings screen. */
  open(): void;
  dispose(): void;
}

export function createSettings(options: SettingsOptions): Settings {
  const { nav } = options;
  const mapping = createMapping({
    nav,
    engine: options.engine,
    refreshNow: options.refreshNow,
    // The list and the guides' counts read again; the live screen and the guide hear from the scheduler.
    mapped: () => {
      unmatched.reload();
      guides.matchesChanged();
    },
    platform: options.platform,
    find: options.find,
    now: options.now,
  });
  const unmatched = createUnmatchedList({ nav, engine: options.engine, map: (target) => mapping.open(target) });
  const guides = createGuides({ ...options, openUnmatched: () => unmatched.open() });
  return {
    guides,
    unmatched,
    mapping,
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
      mapping.dispose();
    },
  };
}
