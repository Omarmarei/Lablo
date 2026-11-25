import type { LifecycleEvent } from '@lablo/platform-api';
import type { Navigator } from '@lablo/ui';
import type { SourceDraft } from '../onboarding/form';
import type { LoadResult } from '../onboarding/loader';
import type { Pairing } from '../pairing/pair-state';
import { PAIR_SCREEN } from '../pairing/pair-state';
import type { BackupPage, BackupPageEngine, BackupPageHost } from './backup-state';
import { BACKUP_CONFIRM, BACKUP_SCREEN, createBackupPage } from './backup-state';
import type { ChannelEditor } from './channel-edit';
import { EDIT_SCREENS, createChannelEditor } from './channel-edit';
import type { EditedChannels } from './edited-channels';
import { CHANNELS_SCREEN, createEditedChannels } from './edited-channels';
import type { Groups, GroupsEngine } from './groups-state';
import { GROUP_SCREENS, createGroups } from './groups-state';
import type { LanguageChoice, LanguageOptions } from './language-choice';
import { LANGUAGE_SCREEN, createLanguageChoice } from './language-choice';
import type { Guides, GuidesEngine, GuidesOptions } from './guides-state';
import { createGuides } from './guides-state';
import type { Mapping, MappingEngine } from './mapping-state';
import { MAPPING_SCREEN, createMapping } from './mapping-state';
import type { ParentalAsk, ParentalPage, ParentalPageEngine } from './parental-page';
import { PARENTAL_SCREENS, createParentalPage } from './parental-page';
import type { PlayerSettings, PlayerSettingsOptions } from './player-settings';
import { PLAYER_SETTINGS_SCREEN, createPlayerSettings } from './player-settings';
import type { SettingsItem } from './settings-items';
import { SETTINGS_ITEMS } from './settings-items';
import { LOGIN_SCREEN } from './source-login';
import type { SourceLoginOptions, SourcesEngine, SourcesList, SourcesOptions } from './sources-state';
import { SOURCE_MENU, SOURCE_REMOVE, SOURCES_SCREEN, createSourcesList } from './sources-state';
import { ADD_SCREEN } from './source-add';
import type { ReportOptions, ReportRow } from './diag-report';
import { createReportRow } from './diag-report';
import type { ConnectionCheck, ConnectionOptions } from './connection-check';
import { CONNECTION_SCREEN, TEST_SCREEN, createConnectionCheck } from './connection-check';
import type { AboutPage } from './about-page';
import { ABOUT_DOC_SCREEN, ABOUT_INFO_SCREEN, ABOUT_SCREEN, createAboutPage } from './about-page';
import type { HelpPage } from './help-page';
import { HELP_SCREEN, HELP_TOPIC_SCREEN, createHelpPage } from './help-page';
import type { TelemetrySwitch, TelemetrySwitchOptions } from './telemetry-switch';
import { createTelemetrySwitch } from './telemetry-switch';
import type { UnmatchedEngine, UnmatchedList } from './unmatched-state';
import { createUnmatchedList } from './unmatched-state';
import { SETTINGS_VISIBLE } from './settings-window';

/**
 * The settings screen (RELAY step 22b2): opened by the live screen's header "Settings" button,
 * pushed on the live navigator. Two rows for now: "TV guides" (the guides screen, and from its
 * header "Channels without a guide", step 24c, whose OK on a channel opens the manual mapping's
 * picker, step 24e) and "Sources" (the sources and when they were updated, step 30c3a; its
 * header's "Add from your phone" opens the pairing screen, step 31c2a) and "Backup" (its on/off,
 * the backup code, a held backup's restore or replace, step 32d2b) and "Usage and crash reports"
 * (on or off, switched in place by OK, step 33b3: `telemetry-switch.ts`) and "Send a report to
 * support" (OK sends the diagnostics report, then the row shows its support code, step 33d2:
 * `diag-report.ts`) and "Channel groups" (the favourites lists and the live groups: move, hide, rename,
 * delete, a list's channels, step 35d: `groups-state.ts`) and "Channels" ("Clean channel names" and the
 * channels the user changed, step 36c: `edited-channels.ts`, its menu `channel-edit.ts`, which the
 * info bar's pencil opens over the player too) and "Parental control" (the PIN, "Lock adult
 * groups" and "Locked groups", step 38c1: `parental-page.ts`) and "Language" (a dialog of the
 * languages, step 38d2: `language-choice.ts`). The rows scroll, seven in view (step 38c1), in the
 * order of `settings-items.ts` (step 38d1: Sources first; the rows above are told in the order the
 * steps built them) and "Player" (the player's track languages, subtitle size and picture, step
 * 38d3: `player-settings.ts`) and "Check the connection" (the internet, each source's server and
 * the last stream, step 40a: `connection-check.ts`) and "Help" (short answers and the support
 * address, step 40c: `help-page.ts`, its words `help-text.ts`).
 * Back closes it.
 */

/** The settings screen's rows, in screen order (step 38d1: `settings-items.ts`, which the e2e helper reads too). */
export type { SettingsItem } from './settings-items';
export { SETTINGS_ITEMS } from './settings-items';

/** A settings row's height and the rows in view (step 39d: shared with the "Player" page). */
export { SETTINGS_ROW, SETTINGS_VISIBLE } from './settings-window';

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
  SOURCE_MENU,
  SOURCE_REMOVE,
  ADD_SCREEN,
  BACKUP_SCREEN,
  BACKUP_CONFIRM,
].concat(GROUP_SCREENS, [CHANNELS_SCREEN], EDIT_SCREENS, PARENTAL_SCREENS, [PLAYER_SETTINGS_SCREEN, LANGUAGE_SCREEN, CONNECTION_SCREEN, TEST_SCREEN, HELP_SCREEN, HELP_TOPIC_SCREEN, ABOUT_SCREEN, ABOUT_INFO_SCREEN, ABOUT_DOC_SCREEN]);

export interface SettingsOptions extends Omit<GuidesOptions, 'openUnmatched' | 'engine'> {
  readonly nav: Navigator;
  readonly engine: GuidesEngine & UnmatchedEngine & MappingEngine & SourcesEngine & GroupsEngine & ParentalPageEngine;
  /** Makes the pairing screen on the live navigator (step 31c2a); without it Sources has no "Add" button. */
  readonly pairing?: (nav: Navigator, added: (draft: SourceDraft, result: LoadResult) => void) => Pairing;
  /** A source was added (from the phone, or on the TV: step 40f) or removed: the live screens read the catalogs and guides again. */
  readonly sourceAdded?: () => void;
  /** "Add a source" on the TV (step 40f, `SourcesOptions.add`); without it Sources has no such button. */
  readonly addSource?: SourcesOptions['add'];
  /** Runs a source's removal with the refreshes held (step 40f, main's `quiet`). */
  readonly quiet?: SourcesOptions['quiet'];
  /** Settings' backup page (step 32d2b); without it there is no "Backup" row. */
  readonly backup?: { readonly engine: BackupPageEngine; readonly host: BackupPageHost };
  /** The sources screen's login form's refresh (step 32d4b, `SourceLoginOptions.refresh`). */
  readonly refreshSource?: SourceLoginOptions['refresh'];
  /** Whether a source's last refresh failed because the storage is full (step 39s1, `SourcesOptions.storageFull`). */
  readonly storageFull?: (src: string) => boolean;
  /** The usage reports' switch (step 33b3); without it there is no "Usage and crash reports" row. */
  readonly telemetry?: TelemetrySwitchOptions;
  /** The app's version, shown on "About Lablo" (step 40d, main's `__APP_VERSION__`); without it the page shows none. */
  readonly version?: string;
  /** The diagnostics report's send (step 33d2); without it there is no "Send a report to support" row. */
  readonly report?: ReportOptions;
  /** "Check the connection"'s online flag, last stream and servers' check (step 40a); without them there is no such row. */
  readonly connection?: ConnectionOptions;
  /** "Channel groups" changed the lists or the groups (step 35d): the live screen reads them again. */
  readonly listsChanged?: () => void;
  /** "Edit channel" or "Channels" changed the channels (step 36c): the live screen reads them again. */
  readonly channelsChanged?: () => unknown;
  /** The PIN pad (step 38c1, main.js's parental control); without it there is no "Parental control" row. */
  readonly pad?: ParentalAsk;
  /** "Parental control" changed the locks (step 38c1): the live, movies, series, search and Home screens read again. */
  readonly locksChanged?: () => void;
  /** The platform's lifecycle: "Parental control" asks the PIN again after the app was hidden. */
  readonly lifecycle?: (listener: (event: LifecycleEvent) => void) => () => void;
  /** The app's language (step 38d2, main's switch); without it there is no "Language" row. */
  readonly language?: LanguageOptions;
  /** The player's languages, subtitle size and picture (step 38d3, main's); without them there is no "Player" row. */
  readonly player?: PlayerSettingsOptions;
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
  /** The usage reports' switch (step 33b3), when the app has one. */
  readonly telemetry: TelemetrySwitch | null;
  /** The diagnostics report's row (step 33d2), when the app has one. */
  readonly report: ReportRow | null;
  /** "Check the connection" (step 40a), when the app gives its online flag and last stream. */
  readonly connection: ConnectionCheck | null;
  /** "Help" (step 40c): always there. */
  readonly help: HelpPage;
  /** "About Lablo" (step 40d): always there. */
  readonly about: AboutPage;
  /** "Channel groups" (step 35d). */
  readonly groups: Groups;
  /** "Edit channel" (step 36c): from "Channels", or over the player (the info bar's pencil). */
  readonly channel: ChannelEditor;
  /** "Channels" (step 36c). */
  readonly channels: EditedChannels;
  /** "Parental control" (step 38c1), when the app gives the PIN pad. */
  readonly parental: ParentalPage | null;
  /** "Language" (step 38d2), when the app gives its switch. */
  readonly language: LanguageChoice | null;
  /** "Player" (step 38d3), when the app gives the player's values. */
  readonly player: PlayerSettings | null;
  /** The settings screen's rows: `SETTINGS_ITEMS`, "Backup" only with its page, "Usage and crash reports" only with its switch, "Send a report to support" only with its send, "Check the connection" only with its options, "Parental control" only with the pad, "Player" only with the player's values, "Language" only with the switch. */
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
  const storageFull = options.storageFull;
  const sources = createSourcesList(
    pairing === null
      ? { nav, engine: options.engine, login, storageFull, add: options.addSource, changed: options.sourceAdded, quiet: options.quiet }
      : { nav, engine: options.engine, addFromPhone: () => pairing.open(), login, storageFull, add: options.addSource, changed: options.sourceAdded, quiet: options.quiet },
  );
  const backup = options.backup === undefined ? null : createBackupPage({ nav, engine: options.backup.engine, host: options.backup.host });
  const telemetry = options.telemetry === undefined ? null : createTelemetrySwitch(options.telemetry);
  const report = options.report === undefined ? null : createReportRow(options.report);
  const connection = options.connection === undefined ? null : createConnectionCheck(nav, options.engine, options.connection);
  // The support topic shows the code the report row gave, read where the page is drawn (the row can't send while Help is open).
  const help = createHelpPage({
    nav,
    supportCode: () => {
      const sent = report === null ? null : report.state.peek();
      return sent !== null && sent.state === 'sent' ? sent.code : null;
    },
  });
  const about = createAboutPage({ nav, version: options.version });
  const groups = createGroups({ nav, engine: options.engine, changed: options.listsChanged, platform: options.platform, find: options.find, now: options.now });
  const channel = createChannelEditor({ nav, engine: options.engine, changed: options.channelsChanged, platform: options.platform, find: options.find, now: options.now, pad: options.pad });
  const channels = createEditedChannels({ nav, engine: options.engine, editor: channel, changed: options.channelsChanged });
  const pad = options.pad;
  // The PIN's check by phone (step 38c4): the same pairing screen, in its check mode.
  const phone = pairing === null ? undefined : (matches: (source: SourceDraft) => boolean, matched: () => void) => pairing.check(matches, matched);
  const parental =
    pad === undefined
      ? null
      : createParentalPage({ nav, engine: options.engine, pad, changed: options.locksChanged, lifecycle: options.lifecycle, platform: options.platform, find: options.find, now: options.now, phone });
  const language = options.language === undefined ? null : createLanguageChoice(nav, options.language);
  const player = options.player === undefined ? null : createPlayerSettings(nav, options.player);
  const items = SETTINGS_ITEMS.filter(
    (item) =>
      (item !== 'backup' || backup !== null) &&
      (item !== 'telemetry' || telemetry !== null) &&
      (item !== 'report' || report !== null) &&
      (item !== 'connection' || connection !== null) &&
      (item !== 'parental' || parental !== null) &&
      (item !== 'player' || player !== null) &&
      (item !== 'language' || language !== null),
  );
  const open = (): void => {
    nav.push({
      id: 'settings',
      zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: items.length, visible: SETTINGS_VISIBLE }],
      onSelect: (focus) => {
        const item = items[focus.index];
        if (item === 'guides') guides.open();
        else if (item === 'sources') sources.open();
        else if (item === 'backup') backup?.open();
        else if (item === 'telemetry') telemetry?.press();
        else if (item === 'report') report?.press();
        else if (item === 'connection') connection?.open();
        else if (item === 'help') help.open();
        else if (item === 'about') about.open();
        else if (item === 'groups') groups.open();
        else if (item === 'channels') channels.open();
        else if (item === 'parental') parental?.open();
        else if (item === 'player') player?.open();
        else if (item === 'language') language?.open();
      },
    });
    // The usage reports' row shows the stored switch, read again at each opening.
    telemetry?.read();
    // The report's row starts again: a code shown at the last opening is gone.
    report?.opened();
  };
  return {
    guides,
    sources,
    unmatched,
    mapping,
    pairing,
    backup,
    telemetry,
    report,
    connection,
    help,
    about,
    groups,
    channel,
    channels,
    parental,
    language,
    player,
    items,
    open,
    openSources(): void {
      open();
      // Back from the sources screen lands on its row.
      nav.top.focus('items', items.indexOf('sources'));
      sources.open();
    },
    openGuides(): void {
      open();
      // Back from the guides screen lands on its row.
      nav.top.focus('items', items.indexOf('guides'));
      guides.open();
    },
    dispose: () => {
      guides.dispose();
      sources.dispose();
      unmatched.dispose();
      mapping.dispose();
      pairing?.dispose();
      backup?.dispose();
      telemetry?.dispose();
      report?.dispose();
      connection?.dispose();
      groups.dispose();
      channel.dispose();
      channels.dispose();
      parental?.dispose();
    },
  };
}
