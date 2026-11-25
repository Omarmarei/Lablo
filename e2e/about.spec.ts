import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { LEGAL_CHROME, LEGAL_DRAFT_MARK, legalDoc } from '../packages/protocol/src/legal';
import { stripIsolates } from '../packages/core/src/bidi';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { untranslated } from './parental-steps';
import { RemoteDriver } from './remote-driver';
import { openSettings, settingsRow, toSettingsRow } from './settings-rows';

/**
 * Settings › "About Lablo" (RELAY step 40d), in English, Arabic and the pseudo-locale: the last
 * row, its list (Lablo, the terms, the privacy policy), the info page, and every section of both
 * documents: the draft mark is on every page, nothing is clipped (the body holds its words, the
 * title, the counter and the buttons are inside the safe area), the contact address is left to
 * right, "Next" and "Previous" turn the pages and stop at the ends, "Close" and Back return.
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
  const lang = tag === 'ar' ? 'ar' : 'en';
  // The key towards the reading end, and back.
  const next = tag === 'ar' ? 'LEFT' : 'RIGHT';
  const back = tag === 'ar' ? 'RIGHT' : 'LEFT';

  test(`Settings › "About Lablo": the last row, the info page and every section of both documents inside the safe area (${locale})`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);

    const inside = async (id: string): Promise<void> => {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.x, id).toBeGreaterThanOrEqual(SAFE.left);
      expect(box!.y, id).toBeGreaterThanOrEqual(SAFE.top);
      expect(box!.x + box!.width, id).toBeLessThanOrEqual(SAFE.right);
      expect(box!.y + box!.height, id).toBeLessThanOrEqual(SAFE.bottom);
    };
    const fits = async (label: string): Promise<void> => {
      const fit = await page.evaluate(() => {
        const body = document.querySelector('.help__body')!;
        return { scroll: body.scrollHeight, client: body.clientHeight };
      });
      expect(fit.scroll, `${label} body`).toBeLessThanOrEqual(fit.client + 1);
      const dirs = await page.evaluate(() => Array.from(document.querySelectorAll('.help__address')).map((e) => e.getAttribute('dir')));
      for (const dir of dirs) expect(dir).toBe('ltr');
    };

    await test.step('the row is the last one, with its name and line', async () => {
      await openSettings(remote, next);
      await toSettingsRow(remote, 'about');
      if (words !== null) {
        expect(stripIsolates((await page.locator('[data-testid=settings-about] .settings__name').textContent()) ?? '')).toBe(words['settings.about']);
        expect(stripIsolates((await page.locator('[data-testid=settings-about] .settings__hint').textContent()) ?? '')).toBe(words['settings.aboutHint']);
      }
      await remote.go('UP', settingsRow('help'));
      await remote.go('DOWN', settingsRow('about'));
    });

    await test.step('its list: three rows', async () => {
      await remote.go('OK', 'about/rows/0');
      for (const row of ['info', 'terms', 'privacy']) await expect(page.getByTestId(`about-row-${row}`)).toHaveCount(1);
      if (words !== null) expect(stripIsolates((await page.locator('.settings__title').first().textContent()) ?? '')).toBe(words['settings.about']);
      else expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
      await page.screenshot({ path: path.join(SHOTS, `about-list-${tag}.png`), animations: 'disabled' });
    });

    await test.step('the info page: the draft mark, the version, the disclaimer, Close', async () => {
      await remote.go('OK', 'about-info/actions/0');
      if (tag !== 'en-XA') await expect(page.getByTestId('about-draft')).toHaveText(LEGAL_DRAFT_MARK[lang]);
      else await expect(page.getByTestId('about-draft')).toBeVisible();
      await expect(page.getByTestId('about-version')).toBeVisible();
      expect(stripIsolates((await page.getByTestId('about-version').textContent()) ?? '')).toMatch(/\d+\.\d+\.\d+/);
      if (tag !== 'en-XA') expect(stripIsolates((await page.getByTestId('about-info').textContent()) ?? '')).toContain(LEGAL_CHROME[lang].disclaimer[0]!);
      await fits('info');
      await inside('about-close');
      await page.screenshot({ path: path.join(SHOTS, `about-info-${tag}.png`), animations: 'disabled' });
      await remote.go('OK', 'about/rows/0');
    });

    for (const [i, doc] of (['terms', 'privacy'] as const).entries()) {
      const sections = legalDoc(lang, doc).sections;
      await test.step(`${doc}: every section fits and carries the draft mark; Next and Previous stop at the ends`, async () => {
        await remote.go('DOWN', `about/rows/${i + 1}`);
        await remote.go('OK', 'about-doc/actions/0');
        await expect(page.getByTestId('about-doc')).toHaveAttribute('data-doc', doc);
        // Previous on the first page does nothing.
        await expect(page.getByTestId('about-previous')).toBeDisabled();
        await remote.press('OK');
        await expect(page.getByTestId('about-doc')).toHaveAttribute('data-page', '0');
        await remote.go(next, 'about-doc/actions/1');
        for (let n = 0; n < sections.length; n++) {
          await expect(page.getByTestId('about-doc')).toHaveAttribute('data-page', String(n));
          await expect(page.getByTestId('about-draft')).toBeVisible();
          if (tag !== 'en-XA') {
            await expect(page.getByTestId('about-heading')).toHaveText(sections[n]!.heading);
            await expect(page.getByTestId('about-page-of')).toHaveText(LEGAL_CHROME[lang].pageOf(n + 1, sections.length));
          } else expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
          await fits(`${doc} ${n}`);
          // The focus ring is on Next (the ring follows each button's own binding).
          if (n < sections.length - 1) await expect(page.getByTestId('about-next')).toHaveAttribute('data-state', 'focused');
          if (words !== null) expect(await page.getByTestId('about-close').textContent()).toBe(words['action.close']);
          for (const id of ['about-doc-title', 'about-page-of', 'about-previous', 'about-next', 'about-close']) await inside(id);
          if (n === 0 || n === sections.length - 1) await page.screenshot({ path: path.join(SHOTS, `about-${doc}-${n}-${tag}.png`), animations: 'disabled' });
          if (n < sections.length - 1) await remote.press('OK');
        }
        // Next on the last page does nothing and is dimmed.
        await expect(page.getByTestId('about-next')).toBeDisabled();
        await remote.press('OK');
        await expect(page.getByTestId('about-doc')).toHaveAttribute('data-page', String(sections.length - 1));
        // Back along the pages to the first.
        await remote.go(back, 'about-doc/actions/0');
        await remote.press('OK');
        await expect(page.getByTestId('about-doc')).toHaveAttribute('data-page', String(sections.length - 2));
        await remote.go(next, 'about-doc/actions/1');
        await remote.go(next, 'about-doc/actions/2');
        await remote.go('OK', `about/rows/${i + 1}`);
      });
    }

    await test.step('Back returns to the settings row', async () => {
      await remote.go('BACK', settingsRow('about'));
    });

    expect(errors).toEqual([]);
  });
}
