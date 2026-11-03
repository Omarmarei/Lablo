import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { RemoteDriver } from './remote-driver';

/**
 * OK on the focused field (its input takes DOM focus: a TV's keyboard opens), the text typed on
 * the desktop keyboard, OK again. Keys aimed at the input never reach the focus engine.
 */
export async function typeInto(remote: RemoteDriver, root: Locator, field: string, text: string): Promise<void> {
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', `onboarding-${field}`);
  await remote.page.keyboard.type(text);
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', '');
}

export interface XtreamLogin {
  /** The panel's `host:port`, typed the way a user would (no `http://`). */
  readonly host: string;
  readonly username: string;
  readonly password: string;
}

/**
 * Onboarding by keys in the TV's language with an Xtream login, then "Start watching": the live
 * screen, its channels shown. `query` goes on the start URL (`locale=…`, `tier=low`).
 */
export async function addXtreamAndWatch(remote: RemoteDriver, login: XtreamLogin, query: string, loadTimeout = 20_000): Promise<Locator> {
  const { page } = remote;
  await page.goto(`/?${query}`);
  const onboarding = page.getByTestId('onboarding');
  await expect(onboarding).toHaveAttribute('data-ready', 'true');
  // The TV's language, the disclaimer, "Allow", an Xtream login.
  await remote.expectFocus(/locale=ar/.test(query) ? 'language/languages/1' : 'language/languages/0');
  await remote.go('OK', 'disclaimer/actions/0');
  await remote.go('OK', 'consent/actions/0');
  await remote.go('OK', 'source/types/0');
  await remote.go('OK', 'form/fields/0');
  await typeInto(remote, onboarding, 'server', login.host);
  await typeInto(remote, onboarding, 'username', login.username);
  await typeInto(remote, onboarding, 'password', login.password);
  await remote.go('DOWN', 'form/fields/4');
  await remote.go('DOWN', 'form/actions/0');
  await remote.press('OK');
  await expect(onboarding).toHaveAttribute('data-screen', 'done', { timeout: loadTimeout });
  await remote.expectFocus('done/actions/0');
  await remote.press('OK');
  const live = page.getByTestId('live');
  await expect(live).toHaveAttribute('data-status', 'ready');
  await remote.expectFocus('live/channels/0');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return live;
}

/** Waits until the live screen's data requests have all answered (the focus's 600 ms wait included). */
export async function settled(root: Locator, timeout = 10_000): Promise<void> {
  await expect(root).toHaveAttribute('data-pending', '0', { timeout });
}

export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}
