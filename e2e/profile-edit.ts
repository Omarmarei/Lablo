import { createHash } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Profile writes for e2e (RELAY step 38b): straight into the stored profile document, from a page
 * with no worker holding it (the component gallery), then the app started again so the query
 * worker reads the profile anew. The mock's "18+ Test (lock check)" is locked by default since
 * step 38: a spec that needs channel 109 opens it (`openAdultGroups`), and the parental specs set
 * a PIN (`pinFields`).
 */

/** No config run and no backup worker in the database. */
export async function appIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__LABLO_TEST__?.configIdle() ?? false) && (window.__LABLO_TEST__?.backupIdle() ?? false))).toBe(true);
}

/** Writes `fields` into the stored profile document (the page must have the app's database). */
export function writeProfile(page: Page, fields: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    (changes) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('profile', 'readwrite');
          const store = tx.objectStore('profile');
          const req = store.get('current');
          req.onsuccess = () => {
            const record = req.result as { doc: Record<string, unknown> };
            for (const name of Object.keys(changes)) record.doc[name] = changes[name];
            store.put(record);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    fields,
  );
}

/**
 * The live screen started after onboarding: the profile gets `fields` (from the gallery, once the
 * app is idle), then `url` starts the app again on it.
 */
export async function restartWith(page: Page, fields: Record<string, unknown>, url: string): Promise<void> {
  await appIdle(page);
  await page.goto('/?screen=gallery');
  await writeProfile(page, fields);
  await page.goto(url);
}

/** "Lock adult groups" off (step 38): the 18+ group and its channel 109 are listed as before. */
export const ADULT_OPEN = { parental: { adult: false } } as const;

/** A PIN as the TV keeps it (step 38a): a salt and b64url(SHA-256(salt + ":" + pin)). */
export function pinFields(pin: string, salt = 'e2e-salt-0123456789'): { salt: string; hash: string } {
  return { salt, hash: createHash('sha256').update(`${salt}:${pin}`, 'utf8').digest('base64url') };
}
