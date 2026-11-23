/**
 * The settings screen's rows by id, in screen order (RELAY step 38d1): what the viewer sets up
 * first comes first (the sources, their guides, the groups and channels), then who may watch
 * what, then the app's own matters (the backup, the reports).
 *
 * This file imports nothing, so the e2e helper (`e2e/settings-rows.ts`) reads the order from here
 * and addresses a row by its id: a new row, or a new order, moves no test.
 */

export type SettingsItem = 'sources' | 'guides' | 'groups' | 'channels' | 'parental' | 'backup' | 'telemetry' | 'report';

export const SETTINGS_ITEMS: readonly SettingsItem[] = ['sources', 'guides', 'groups', 'channels', 'parental', 'backup', 'telemetry', 'report'];
