import { EDIT_SCREENS } from './channel-edit';
import { ChannelEditOver } from './ChannelEditPage';
import { SettingsScreen } from './SettingsScreen';
import type { Settings, SettingsOptions } from './settings-state';
import { SETTINGS_SCREENS, createSettings } from './settings-state';

/**
 * settings.js (RELAY step 35e): the file main.js loads the first time Settings opens, or the
 * guide's "Guide channel" (`lazy/lazy-file.ts`). Everything under apps/tv/src/settings/ is in it,
 * and main.js holds none of it: the TV build fails on a static import that would pull one back
 * (`APP_LAZY`, tools/build/src/lazy-files.ts). Main imports only this file's types, and the
 * file's `import()`.
 */
export interface LoadedSettings {
  readonly settings: Settings;
  /** Paints the screens in `screens`. */
  readonly Screen: typeof SettingsScreen;
  /** The screens the settings put on the live navigator: the live screen paints `Screen` for them. */
  readonly screens: readonly string[];
  /** Whether `screen` paints over the player (step 36c: "Edit channel" opened by the info bar's pencil). */
  over(screen: string): boolean;
  /** Paints what is over the player, inside the player's screen. */
  readonly Over: typeof ChannelEditOver;
}

/** The settings, made once the file is in (main keeps `options` from the live screen's start). */
export function loadSettings(options: SettingsOptions): LoadedSettings {
  const settings = createSettings(options);
  return {
    settings,
    Screen: SettingsScreen,
    screens: SETTINGS_SCREENS,
    over: (screen) => settings.channel.over.value && EDIT_SCREENS.indexOf(screen) !== -1,
    Over: ChannelEditOver,
  };
}
