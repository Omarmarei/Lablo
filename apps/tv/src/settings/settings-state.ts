import type { Navigator } from '@lablo/ui';
import type { SourceDraft } from '../onboarding/form';
import type { LoadResult } from '../onboarding/loader';
import type { Pairing } from '../pairing/pair-state';
import { PAIR_SCREEN } from '../pairing/pair-state';
import type { BackupPage, BackupPageEngine, BackupPageHost } from './backup-state';
import { BACKUP_CONFIRM, BACKUP_SCREEN, createBackupPage } from './backup-state';
import type { Guides, GuidesEngine, GuidesOptions } from './guides-state';
import { createGuides } from './guides-state';
import type { Mapping, MappingEngine } from './mapping-state';
import { MAPPING_SCREEN, createMapping } from './mapping-state';
import { LOGIN_SCREEN } from './source-login';
import type { SourceLoginOptions, SourcesEngine, SourcesList } from './sources-state';
import { SOURCES_SCREEN, createSourcesList } from './sources-state';
import type { UnmatchedEngine, UnmatchedList } from './unmatched-state';
import { createUnmatchedList } from './unmatched-state';

/**
 * The settings screen (RELAY step 22b2): opened by the live screen's header "Settings" button,
 * pushed on the live navigator. Two rows for now: "TV guides" (the guides screen, and from its
 * header "Channels without a guide", step 24c, whose OK on a channel opens the manual mapping's
 * picker, step 24e) and "Sources" (the sources and when they were updated, step 30c3a; its
 * header's "Add from your phone" opens the pairing screen, step 31c2a) and "Backup" (its on/off,
 * the backup code, a held backup's restore or replace, step 32d2b); step 38 adds the track
 * languages, the subtitle style and the picture mode. Back closes it.
 */

export type SettingsItem = 'guides' | 'sources' | 'backup';

/** The settings screen's rows, in screen order (each new one last, so the earlier paths stay). */
export const SETTINGS_ITEMS: readonly SettingsItem[] = ['guides', 'sources', 'backup'];

/** The screens the settings put on the live navigator (the live screen paints them instead of its own). */
export const SETTINGS_SCREENS: readonly string[] = [
  'settings',
  'guides',
  'guide-menu',
  'guide-offset',
  'guide-matches',
  'guide-add',
  'unmatched',
  MAPPING_SCREEN,
  SOURCES_SCREEN,
  PAIR_SCREEN,
  LOGIN_SCREEN,
  BACKUP_SCREEN,
  BACKUP_CONFIRM,
];

export interface SettingsOptions extends Omit<GuidesOptions, 'openUnmatched' | 'engine'> {
  readonly nav: Navigator;
  readonly engine: GuidesEngine & UnmatchedEngine & MappingEngine & SourcesEngine;
  /** Makes the pairing screen on the live navigator (step 31c2a); without it Sources has no "Add" button. */
  readonly pairing?: (nav: Navigator, added: (draft: SourceDraft, result: LoadResult) => void) => Pairing;
  /** A source was added from the phone: the live screens read the catalogs and guides again. */
  readonly sourceAdded?: () => void;
  /** Settings' backup page (step 32d2b); without it there is no "Backup" row. */
  readonly backup?: { readonly engine: BackupPageEngine; readonly host: BackupPageHost };
  /** The sources screen's login form's refresh (step 32d4b, `SourceLoginOptions.refresh`). */
  readonly refreshSource?: SourceLoginOptions['refresh'];
}

export interface Settings {
  readonly guides: Guides;
  /** The sources screen (step 30c3a). */
  readonly sources: SourcesList;
  /** "Channels without a guide" (step 24c). */
  readonly unmatched: UnmatchedList;
  /** The manual mapping's picker (step 24e): from a channel without a guide, or from the programme details. */
  readonly mapping: Mapping;
  /** The pairing screen (step 31c2a), when the app can pair. */
  readonly pairing: Pairing | null;
  /** The backup page (step 32d2b), when the app has one. */
  readonly backup: BackupPage | null;
  /** The settings screen's rows: `SETTINGS_ITEMS`, "Backup" only with its page. */
  readonly items: readonly SettingsItem[];
  /** Opens the settings screen. */
  open(): void;
  /** Opens the settings screen on its "Sources" row, then the sources screen over it ("Welcome back"'s end, step 32d4b). */
  openSources(): void;
  /** Opens the settings screen, then the guides screen over it ("Welcome back"'s end, step 32d4c). */
  openGuides(): void;
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
  const pairing =
    options.pairing === undefined
      ? null
      : options.pairing(nav, () => {
          sources.reload();
          options.sourceAdded?.();
        });
  // The login form (step 32d4b): the settings' keyboard, and the save's refresh when the app gives one.
  const login: SourceLoginOptions = { platform: options.platform, find: options.find, now: options.now, refresh: options.refreshSource };
  const sources = createSourcesList(pairing === null ? { nav, engine: options.engine, login } : { nav, engine: options.engine, addFromPhone: () => pairing.open(), login });
  const backup = options.backup === undefined ? null : createBackupPage({ nav, engine: options.backup.engine, host: options.backup.host });
  const items = backup === null ? SETTINGS_ITEMS.filter((item) => item !== 'backup') : SETTINGS_ITEMS;
  const open = (): void => {
    nav.push({
      id: 'settings',
      zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: items.length }],
      onSelect: (focus) => {
        const item = items[focus.index];
        if (item === 'guides') guides.open();
        else if (item === 'sources') sources.open();
        else if (item === 'backup') backup?.open();
      },
    });
  };
  return {
    guides,
    sources,
    unmatched,
    mapping,
    pairing,
    backup,
    items,
    open,
    openSources(): void {
      open();
      // Back from the sources screen lands on its row.
      nav.top.focus('items', items.indexOf('sources'));
      sources.open();
    },
    openGuides(): void {
      // (The settings open on their first row, "TV guides": Back from the guides screen lands there.)
      open();
      guides.open();
    },
    dispose: () => {
      guides.dispose();
      sources.dispose();
      unmatched.dispose();
      mapping.dispose();
      pairing?.dispose();
      backup?.dispose();
    },
  };
}
