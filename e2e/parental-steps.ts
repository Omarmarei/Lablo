import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { stripIsolates } from '../packages/core/src/bidi';
import type { RemoteDriver } from './remote-driver';

/**
 * Steps the parental control specs share (RELAY steps 38b, 38c1): the rail's chips, the PIN pad,
 * the rail's last entry, and a check that a part of the screen shows only the catalog's strings.
 */

/** The rail's chips as `label` (`open label` with an open lock, `locked label` with a closed one). */
export async function chips(page: Page): Promise<string[]> {
  return page
    .evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid=rail] .z-chip')).map((chip) => {
        const label = chip.querySelector('.z-chip__label')?.textContent ?? '';
        const icon = chip.querySelector('.z-chip__icon path')?.getAttribute('d') ?? '';
        return icon === '' ? label : `${icon.indexOf('7.6') === -1 ? 'locked' : 'open'} ${label}`;
      }),
    )
    .then((all) => all.map((c) => stripIsolates(c)));
}

/** The page hidden or shown, as a TV hides the app (the browser platform reads `document.hidden`). */
export function setHidden(page: Page, hidden: boolean): Promise<void> {
  return page.evaluate((value) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

/** The texts under `selector` that aren't the pseudo-locale's bracketed strings (data, `translate=no`, aside). */
export function untranslated(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (root === null) return [`no ${sel}`];
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = (node.nodeValue ?? '').trim();
      if (!/\p{L}/u.test(value) || node.parentElement?.closest('[translate="no"]') != null) continue;
      if (!(value.startsWith('[') && value.endsWith(']'))) out.push(value);
    }
    return out;
  }, selector);
}

/** From the list: the rail (on the entry on show), then down to its last entry, "Locked groups" or "Lock again". */
export async function toLastEntry(remote: RemoteDriver, ar: boolean, entries: number): Promise<void> {
  const focus = (): Promise<string> => remote.page.evaluate(() => window.__LABLO_TEST__?.focusPath() ?? '');
  await remote.press(ar ? 'RIGHT' : 'LEFT');
  await expect.poll(focus).toMatch(/^live\/rail\/\d+$/);
  const at = Number((await focus()).split('/')[2]);
  for (let i = at + 1; i < entries; i += 1) await remote.go('DOWN', `live/rail/${i}`);
  await remote.expectFocus(`live/rail/${entries - 1}`);
}

/** The pad's purpose, how many digits it shows typed, and its problem. */
export async function pad(page: Page): Promise<{ purpose: string | null; typed: string | null; problem: string | null }> {
  return {
    purpose: await page.getByTestId('pin').getAttribute('data-purpose'),
    typed: await page.getByTestId('pin-boxes').getAttribute('data-typed'),
    problem: await page.getByTestId('pin-problem').getAttribute('data-problem'),
  };
}

/** A PIN by the number keys. */
export async function typePin(remote: RemoteDriver, pin: string): Promise<void> {
  for (const d of pin) await remote.press(`DIGIT_${d}` as 'DIGIT_0');
}
