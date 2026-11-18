import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { settled } from './onboard';
import type { RemoteDriver } from './remote-driver';

/**
 * What the TV's pairing specs share (RELAY steps 31c2a and 31c3): pairing.spec.ts against the
 * stand-in, pairing-api.spec.ts against `next start`.
 */

/** Where the screenshots go, for a person to look at. */
export const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

export interface StoredProfile {
  readonly sources: Array<Record<string, unknown>>;
  readonly guides: Array<Record<string, unknown>>;
}

/** The profile's sources and guides, read from IndexedDB once the app has opened it. */
export function storedProfile(page: Page): Promise<StoredProfile | null> {
  return page.evaluate(
    () =>
      new Promise<StoredProfile | null>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: { sources?: Array<Record<string, unknown>>; guides?: Array<Record<string, unknown>> } } | undefined;
            resolve(record === undefined ? null : { sources: record.doc.sources ?? [], guides: record.doc.guides ?? [] });
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** A screenshot of the TV canvas, its fonts loaded, to artifacts/screenshots/<name>.png. */
export async function shoot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** The code on show (the pair screen's code view), shown in two groups of four. */
export async function shownCode(page: Page): Promise<string> {
  const pair = page.getByTestId('pair');
  await expect(pair).toHaveAttribute('data-view', 'code');
  const code = (await pair.getAttribute('data-code')) ?? '';
  expect(code).toMatch(/^[0-9A-Z]{8}$/);
  await expect(page.getByTestId('pair-code')).toHaveText(`${code.slice(0, 4)} ${code.slice(4)}`);
  return code;
}

/** From the live list: the header's "Settings" (its end: the left in Arabic), then "Sources". */
export async function openSources(remote: RemoteDriver, language: 'en' | 'ar'): Promise<Locator> {
  const side = language === 'ar' ? 'LEFT' : 'RIGHT';
  await remote.go('UP', 'live/header/0');
  for (let i = 1; i <= 5; i += 1) await remote.go(side, `live/header/${i}`);
  await remote.go('OK', 'settings/items/0');
  await remote.go('DOWN', 'settings/items/1');
  await remote.press('OK');
  const root = remote.page.getByTestId('settings-screen');
  await settled(root, 20_000);
  return root;
}

/** Onboarding's source types, down to "Use your phone", then OK: the pair screen's code. */
export async function usePhone(remote: RemoteDriver): Promise<string> {
  await remote.go('DOWN', 'source/types/1');
  await remote.go('DOWN', 'source/types/2');
  await remote.go('OK', 'pair/actions/0');
  return shownCode(remote.page);
}
