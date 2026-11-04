import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The guides screen (RELAY step 22b2) by keys: the live screen's header "Settings", the settings
 * screen's "TV guides", then a guide added by its link, read at once by the app's refresh
 * scheduler. The mock runs on the real clock, so its guide covers the browser's "now".
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');

let app: MockServer;
/** The mock's `host:port`, typed the way a user would (no `http://`). */
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

interface StoredGuides {
  readonly v: number;
  readonly guides: readonly { readonly id: string; readonly url: string }[];
}

/** The profile document as IndexedDB holds it. */
function storedProfile(page: Page): Promise<StoredGuides | null> {
  return page.evaluate(
    () =>
      new Promise<StoredGuides | null>((resolve, reject) => {
        const open = indexedDB.open('zoma');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: unknown } | undefined;
            resolve(record === undefined ? null : (record.doc as StoredGuides));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** An element's text without the isolates the runtime puts around each argument. */
async function plainText(locator: Locator): Promise<string> {
  return stripIsolates((await locator.textContent()) ?? '');
}

/** OK on the link field, the link typed on the desktop keyboard, OK again (the focus goes to "Add"). */
async function typeLink(remote: RemoteDriver, root: Locator, link: string): Promise<void> {
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', 'guides-link');
  await remote.page.keyboard.type(link);
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', '');
}

test('opens the guides screen from the header, adds a guide by its link and shows it read', async ({ page }) => {
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-US');
  await settled(live);

  // UP from the list's first row: the header's "Settings"; DOWN goes back to the list.
  await remote.go('UP', 'live/header/0');
  await page.screenshot({ path: path.join(SHOTS, 'live-header-en.png'), animations: 'disabled' });
  await remote.go('DOWN', 'live/channels/0');
  await remote.go('UP', 'live/header/0');
  await remote.go('OK', 'settings/items/0');
  await expect(page.getByTestId('settings-guides')).toContainText('TV guides');
  await remote.go('OK', 'guides/guides/0');

  const root = page.getByTestId('settings-screen');
  const screen = page.getByTestId('guides');
  await expect(screen).toHaveAttribute('data-status', 'ready');
  await settled(root);
  // The panel's own guide, read at onboarding: its host and path, never the login.
  const panel = page.getByTestId('guide-0');
  await expect(panel).toHaveAttribute('data-kind', 'source');
  await expect(panel).toHaveAttribute('data-src', 's1:xmltv');
  await expect(panel).toHaveAttribute('data-status', 'read');
  await expect(page.getByTestId('guide-0-link')).toHaveText(`${host}/xmltv.php`);
  await expect(page.getByTestId('guides-list')).not.toContainText(P);
  await page.screenshot({ path: path.join(SHOTS, 'guides-en.png'), animations: 'disabled' });

  // "Add a guide": the mock's other link to the same guide.
  await remote.go('UP', 'guides/add/0');
  await remote.go('OK', 'guide-add/field/0');
  await typeLink(remote, root, `${host}/epg/guide.xml`);
  await remote.expectFocus('guide-add/actions/0');
  await page.screenshot({ path: path.join(SHOTS, 'guides-add-en.png'), animations: 'disabled' });
  await remote.press('OK');

  // The user's guide comes first, with the focus on it, and is read at once.
  await remote.expectFocus('guides/guides/0');
  const added = page.getByTestId('guide-0');
  await expect(added).toHaveAttribute('data-src', 'u~g1');
  await expect(added).toHaveAttribute('data-kind', 'mine');
  await expect(page.getByTestId('guide-0-link')).toHaveText(`${host}/epg/guide.xml`);
  await expect(added).toHaveAttribute('data-status', 'read', { timeout: 20_000 });
  await settled(root, 20_000);
  // Every live channel the mock's guide has (one channel has none).
  const wanted = Number(await added.getAttribute('data-wanted'));
  const matched = Number(await added.getAttribute('data-matched'));
  expect(wanted).toBe(12);
  expect(matched).toBe(11);
  expect(await plainText(page.getByTestId('guide-0-status'))).toMatch(/^Programmes until \w{3}, \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M · Channels matched: 11 of 12 \(92%\)$/);
  await expect(page.getByTestId('guide-1')).toHaveAttribute('data-src', 's1:xmltv');
  await page.screenshot({ path: path.join(SHOTS, 'guides-added-en.png'), animations: 'disabled' });

  // Saved in the profile's guide list.
  const saved = await storedProfile(page);
  expect(saved?.v).toBe(4);
  expect(saved?.guides).toEqual([{ id: 'g1', url: `http://${host}/epg/guide.xml` }]);

  // Back: the settings screen, then the live screen on its header.
  await remote.go('BACK', 'settings/items/0');
  await remote.go('BACK', 'live/header/0');
  await remote.go('DOWN', 'live/channels/0');
  expect(errors).toEqual([]);
});
