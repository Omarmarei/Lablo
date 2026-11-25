/**
 * The settings screen's rows by id, in screen order (RELAY step 38d1): what the viewer sets up
 * first comes first (the sources, their guides, the groups and channels), then who may watch
 * what, then how the player plays (step 38d3), then the app's language (step 38d2), then the
 * app's own matters (the backup, the reports, "Check the connection" before the report to support,
 * step 40a).
 *
 * This file imports nothing, so the e2e helper (`e2e/settings-rows.ts`) reads the order from here
 * and addresses a row by its id: a new row, or a new order, moves no test.
 */

export type SettingsItem = 'sources' | 'guides' | 'groups' | 'channels' | 'parental' | 'player' | 'language' | 'backup' | 'telemetry' | 'connection' | 'report';

export const SETTINGS_ITEMS: readonly SettingsItem[] = ['sources', 'guides', 'groups', 'channels', 'parental', 'player', 'language', 'backup', 'telemetry', 'connection', 'report'];
