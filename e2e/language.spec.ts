import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { AR } from '../apps/tv/src/i18n/ar';
import { EN } from '../apps/tv/src/i18n/en';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { untranslated } from './parental-steps';
import { appIdle } from './profile-edit';
import { RemoteDriver } from './remote-driver';
import { SETTINGS_FIRST, settingsRow, toSettingsRow } from './settings-rows';

/**
 * Settings › "Language" (RELAY step 38d2) on the mock's panel: onboarded in English and in Arabic,
 * the app switched to the other language and back, in place (no reload). Checked each way: the
 * dialog's focus on the language on show; the settings' and the live screen's words, `<html lang
 * dir>` and the focus engine's direction (the header's previous button by LEFT or RIGHT); the
 * profile's `onboarding.language`; a restart keeping it. In en-XA: only our strings on the row and
 * the dialog, and a switch to Arabic coming back to en-XA.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const LANGS = ['en', 'ar'] as const;
type Lang = (typeof LANGS)[number];
const WORDS = { en: EN, ar: AR } as const;

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace('http://', '');
});

test.afterAll(async () => {
  await app.close();
});

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

async function text(page: Page, selector: string): Promise<string> {
  return stripIsolates((await page.locator(selector).first().textContent()) ?? '');
}

/** The key that moves to the next button in a row, in the screen's direction. */
function nextKey(lang: Lang): 'LEFT' | 'RIGHT' {
  return lang === 'ar' ? 'LEFT' : 'RIGHT';
}

function backKey(lang: Lang): 'LEFT' | 'RIGHT' {
  return lang === 'ar' ? 'RIGHT' : 'LEFT';
}

/** The page's `<html lang dir>`. */
function htmlLang(page: Page): Promise<{ lang: string; dir: string }> {
  return page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));
}

/** The profile's `onboarding.language` (`null`: none stored). */
function storedLanguage(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      new Promise<string | null>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: { onboarding?: { language?: string | null } } } | undefined;
            resolve(record?.doc.onboarding?.language ?? null);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** From the list's first row: the header's "Settings" (UP lands on the header's last button), opening on its first row. */
async function openSettings(remote: RemoteDriver, lang: Lang): Promise<void> {
  const focus = (): Promise<string> => remote.page.evaluate(() => window.__LABLO_TEST__?.focusPath() ?? '');
  await remote.press('UP');
  await expect.poll(focus).toMatch(/^live\/header\/\d+$/);
  for (let i = Number((await focus()).split('/')[2]) + 1; i <= 5; i += 1) await remote.go(nextKey(lang), `live/header/${i}`);
  await remote.expectFocus('live/header/5');
  await remote.go('OK', SETTINGS_FIRST);
}

/** The app in `lang`: the settings or the live screen's marks, the page's language and direction, the focus engine's. */
async function expectShown(page: Page, testId: 'settings-screen' | 'live', lang: Lang): Promise<void> {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const root = page.getByTestId(testId);
  await expect(root).toHaveAttribute('data-language', lang);
  await expect(root).toHaveAttribute('data-dir', dir);
  const html = await htmlLang(page);
  expect(html.dir).toBe(dir);
  expect(html.lang.slice(0, 2)).toBe(lang);
}

/** On the settings' "Language" row: OK, the dialog on the language on show, the other one, OK: back on the row in it. */
async function switchFrom(remote: RemoteDriver, from: Lang, to: Lang, shot?: string): Promise<void> {
  const page = remote.page;
  await remote.go('OK', `language/languages/${LANGS.indexOf(from)}`);
  const dialog = page.getByTestId('language-dialog');
  await expect(dialog).toBeVisible();
  // The settings' list under it, its row kept as the focus to come back to.
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.getByTestId('settings-language')).toHaveAttribute('data-state', 'memory');
  expect(await text(page, '[data-testid=language-dialog] .z-dialog__title')).toBe(WORDS[from]['settings.language']);
  await expect(page.getByTestId('language-dialog-en')).toHaveText('English');
  await expect(page.getByTestId('language-dialog-ar')).toHaveText('العربية');
  if (shot !== undefined) await shoot(page, shot);
  // The other language: the next button from English, the previous one from Arabic.
  await remote.go(from === 'en' ? nextKey(from) : backKey(from), `language/languages/${LANGS.indexOf(to)}`);
  await remote.go('OK', settingsRow('language'));
  await expect(dialog).toHaveCount(0);
  await expectShown(page, 'settings-screen', to);
}

for (const { locale, lang } of [
  { locale: 'en-US', lang: 'en' },
  { locale: 'ar-SA', lang: 'ar' },
] as const) {
  const other: Lang = lang === 'ar' ? 'en' : 'ar';

  test(`switches the app to ${other === 'ar' ? 'Arabic' : 'English'} and back in Settings › "Language", in place, and keeps it after a restart (${locale})`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
    await settled(live);
    await expectShown(page, 'live', lang);
    expect(await storedLanguage(page)).toBe(lang);
    const reloads: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) reloads.push(frame.url());
    });

    await test.step('the row: its name in the screen’s language, its line the languages’ own names', async () => {
      await openSettings(remote, lang);
      await toSettingsRow(remote, 'language');
      expect(await text(page, '[data-testid=settings-language] .settings__name')).toBe(WORDS[lang]['settings.language']);
      expect(await text(page, '[data-testid=settings-language] .settings__hint')).toBe('English · العربية');
      await expect(page.getByTestId('settings-language-ar')).toHaveAttribute('lang', 'ar');
      await expect(page.getByTestId('settings-language-en')).toHaveAttribute('lang', 'en');
    });

    await test.step(`Back on the language on show only closes; OK on the other switches the settings in place`, async () => {
      await remote.go('OK', `language/languages/${LANGS.indexOf(lang)}`);
      await remote.go('BACK', settingsRow('language'));
      await expect(page.getByTestId('language-dialog')).toHaveCount(0);
      await remote.go('OK', `language/languages/${LANGS.indexOf(lang)}`);
      await remote.go('OK', settingsRow('language'));
      await expectShown(page, 'settings-screen', lang);
      await switchFrom(remote, lang, other, `settings-language-${lang}`);
      expect(await text(page, '[data-testid=settings] .settings__title')).toBe(WORDS[other]['settings.title']);
      expect(await text(page, '[data-testid=settings-language] .settings__name')).toBe(WORDS[other]['settings.language']);
      expect(await text(page, '[data-testid=settings-parental] .settings__name')).toBe(WORDS[other]['settings.parental']);
      // The profile keeps it.
      await expect.poll(() => storedLanguage(page)).toBe(other);
    });

    await test.step('Back: the live screen in it, the header’s keys in its direction', async () => {
      await remote.go('BACK', 'live/header/5');
      await expectShown(page, 'live', other);
      expect(await text(page, '[data-testid=live] .live__title')).toBe(WORDS[other]['live.title']);
      await expect(page.getByTestId('live-settings')).toHaveAttribute('aria-label', WORDS[other]['settings.open']);
      // The previous header button: LEFT in English, RIGHT in Arabic; the other key goes back.
      await remote.go(backKey(other), 'live/header/4');
      await remote.go(nextKey(other), 'live/header/5');
      await remote.go('DOWN', 'live/channels/0');
      await shoot(page, `live-switched-${other}`);
    });

    await test.step('a restart keeps the new language', async () => {
      expect(reloads).toEqual([]);
      await appIdle(page);
      await page.goto(`/?locale=${locale}`);
      await expect(live).toHaveAttribute('data-status', 'ready');
      await remote.expectFocus('live/channels/0');
      await settled(live);
      await expectShown(page, 'live', other);
      expect(await text(page, '[data-testid=live] .live__title')).toBe(WORDS[other]['live.title']);
    });

    await test.step('and back to the first language', async () => {
      await openSettings(remote, other);
      await toSettingsRow(remote, 'language');
      await switchFrom(remote, other, lang);
      await expect.poll(() => storedLanguage(page)).toBe(lang);
      await remote.go('BACK', 'live/header/5');
      await expectShown(page, 'live', lang);
      expect(await text(page, '[data-testid=live] .live__title')).toBe(WORDS[lang]['live.title']);
      await remote.go(backKey(lang), 'live/header/4');
    });

    expect(errors).toEqual([]);
  });
}

test('shows only our strings, bracketed, on the row and the dialog, and comes back to the pseudo-locale (en-XA)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = trackErrors(page);
  const remote = new RemoteDriver(page);
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, 'locale=en-XA');
  await settled(live);
  await expect(live).toHaveAttribute('data-language', 'pseudo');
  await openSettings(remote, 'en');
  await toSettingsRow(remote, 'language');
  const screen = page.getByTestId('settings-screen');
  await expect(screen).toHaveAttribute('data-language', 'pseudo');
  // (The languages' names are never translated: translate=no.)
  expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
  await remote.go('OK', 'language/languages/0');
  await expect(page.getByTestId('language-dialog')).toBeVisible();
  expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
  await shoot(page, 'settings-language-en-XA');
  await remote.go('RIGHT', 'language/languages/1');
  await remote.go('OK', settingsRow('language'));
  await expectShown(page, 'settings-screen', 'ar');
  // Back from Arabic: English is the pseudo-locale again (the TV's language here).
  await remote.go('OK', 'language/languages/1');
  await remote.go('RIGHT', 'language/languages/0');
  await remote.go('OK', settingsRow('language'));
  await expect(screen).toHaveAttribute('data-language', 'pseudo');
  await expect(screen).toHaveAttribute('data-dir', 'ltr');
  expect((await htmlLang(page)).lang).toBe('en-XA');
  expect(await untranslated(page, '[data-testid=settings-screen]')).toEqual([]);
  expect(errors).toEqual([]);
});
