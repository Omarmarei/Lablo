import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { HELP_TOPICS, SUPPORT_EMAIL } from '../apps/tv/src/settings/help-text';
import { stripIsolates } from '../packages/core/src/bidi';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { untranslated } from './parental-steps';
import { RemoteDriver } from './remote-driver';
import { openSettings, settingsRow, toSettingsRow } from './settings-rows';

/**
 * Settings › "Help" (RELAY step 40c), in English, Arabic and the pseudo-locale: the last row, its
 * list of topics, and every topic's page: its words fit the safe area (nothing is clipped), error
 * codes and the address are left to right, the support topic carries the address and, with no
 * report sent, says there is no code yet. OK on a topic opens its page, OK on "Close" and Back
 * return to its row in the list, then to the settings' row.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

for (const { locale, tag } of [
  { locale: 'en-US', tag: 'en' },
  { locale: 'ar-SA', tag: 'ar' },
  { locale: 'en-XA', tag: 'en-XA' },
] as const) {
  const words = tag === 'ar' ? AR : tag === 'en' ? EN : null;
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';

  test(`Settings › "Help": the last row, the topics and every page inside the safe area (${locale})`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);

    await test.step('the row, after "Send a report to support", with its name and line', async () => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'help');
      if (words !== null) {
        expect(stripIsolates((await page.locator('[data-testid=settings-help] .settings__name').textContent()) ?? '')).toBe(words['settings.help']);
        expect(stripIsolates((await page.locator('[data-testid=settings-help] .settings__hint').textContent()) ?? '')).toBe(words['settings.helpHint']);
      }
      await remote.go('UP', settingsRow('report'));
      await remote.go('DOWN', settingsRow('help'));
    });

    await test.step('its list: every topic as a row, the first one focused', async () => {
      await remote.go('OK', 'help/topics/0');
      await expect(page.getByTestId('settings')).toHaveCount(0);
      for (const topic of HELP_TOPICS) await expect(page.getByTestId(`help-topic-${topic}`)).toHaveCount(1);
      if (words !== null) expect(stripIsolates((await page.locator('.settings__title').first().textContent()) ?? '')).toBe(words['settings.help']);
      else expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `help-list-${tag}.png`), animations: 'disabled' });
    });

    for (let i = 0; i < HELP_TOPICS.length; i++) {
      const topic = HELP_TOPICS[i]!;
      await test.step(`the page of "${topic}": its words fit, left-to-right marks stay left to right`, async () => {
        if (i > 0) await remote.go('DOWN', `help/topics/${i}`);
        await remote.go('OK', 'help-topic/actions/0');
        await expect(page.getByTestId('help-page')).toHaveAttribute('data-topic', topic);
        // Nothing is clipped: the body holds all its words; the title and "Close" are in the safe area.
        const fit = await page.evaluate(() => {
          const body = document.querySelector('.help__body')!;
          return { scroll: body.scrollHeight, client: body.clientHeight };
        });
        expect(fit.scroll, `${topic} body`).toBeLessThanOrEqual(fit.client + 1);
        for (const id of ['help-title', 'help-close']) {
          const box = await page.getByTestId(id).boundingBox();
          expect(box, id).not.toBeNull();
          expect(box!.x, id).toBeGreaterThanOrEqual(SAFE.left);
          expect(box!.y, id).toBeGreaterThanOrEqual(SAFE.top);
          expect(box!.x + box!.width, id).toBeLessThanOrEqual(SAFE.right);
          expect(box!.y + box!.height, id).toBeLessThanOrEqual(SAFE.bottom);
        }
        if (words !== null) expect(await page.getByTestId('help-close').textContent()).toBe(words['action.close']);
        // Codes and the address are left to right whatever the page's direction.
        const dirs = await page.evaluate(() => Array.from(document.querySelectorAll('.help__term--code, .help__address')).map((e) => e.getAttribute('dir')));
        for (const dir of dirs) expect(dir).toBe('ltr');
        if (words === null) expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
        await page.screenshot({ path: path.join(SHOTS, `help-${topic}-${tag}.png`), animations: 'disabled' });
        if (topic === 'account') {
          expect(dirs).toHaveLength(4);
          expect(stripIsolates((await page.locator('[data-testid=help-item-0] .help__term').textContent()) ?? '')).toBe('PRV-AUTH');
        }
        if (topic === 'support') {
          expect(stripIsolates((await page.getByTestId('help-mail').textContent()) ?? '')).toContain(SUPPORT_EMAIL);
          // No report was sent: no code yet (the code itself is the unit test's).
          await expect(page.getByTestId('help-code')).toBeVisible();
          await expect(page.getByTestId('help-code-value')).toHaveCount(0);
        }
        await remote.go('OK', `help/topics/${i}`);
      });
    }

    await test.step('Back returns to the settings row', async () => {
      await remote.go('BACK', settingsRow('help'));
    });

    expect(errors).toEqual([]);
  });
}
