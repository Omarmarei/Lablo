import type { SettingsItem } from '../apps/tv/src/settings/settings-items';
import { SETTINGS_ITEMS } from '../apps/tv/src/settings/settings-items';
import type { RemoteDriver } from './remote-driver';

/**
 * The settings screen's rows by id (RELAY step 38d1). The order is the app's own
 * (`settings-items.ts`, which imports nothing), so a new row or a new order moves no spec.
 * In the e2e app every row shows; seven are in view and the list scrolls.
 */

export type { SettingsItem };

/** The rows in screen order (the app's `SETTINGS_ITEMS`). */
export const SETTINGS_ROWS: readonly SettingsItem[] = SETTINGS_ITEMS;

/** The path the settings open on: their first row. */
export const SETTINGS_FIRST = 'settings/items/0';

/** A row's focus path. */
export function settingsRow(id: SettingsItem): string {
  return `settings/items/${SETTINGS_ITEMS.indexOf(id)}`;
}

/** From row `from` to row `to`, a row at a time: DOWN or UP, as the order has them. No key when they are the same row. */
export async function fromSettingsRow(remote: RemoteDriver, from: SettingsItem, to: SettingsItem): Promise<void> {
  const end = SETTINGS_ITEMS.indexOf(to);
  const step = end > SETTINGS_ITEMS.indexOf(from) ? 1 : -1;
  for (let i = SETTINGS_ITEMS.indexOf(from); i !== end; i += step) await remote.go(step === 1 ? 'DOWN' : 'UP', `settings/items/${i + step}`);
}

/** From the first row (the settings just opened): DOWN to row `id`, a row at a time. No key for the first row. */
export async function toSettingsRow(remote: RemoteDriver, id: SettingsItem): Promise<void> {
  await fromSettingsRow(remote, SETTINGS_ITEMS[0]!, id);
}
