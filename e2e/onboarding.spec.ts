import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { loadCatalog } from '../apps/mock-provider/src/config';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { ARABIC_FACE, LATIN_FACE, renderedFontsUnder } from './fonts';
import { RemoteDriver } from './remote-driver';

/**
 * Onboarding (RELAY steps 13a and 13b), the start screen of the dev app, by keys only: the
 * language, the disclaimer, the device-ID consent, the source type, the form typed on the
 * keyboard (OK opens a field, Enter ends it), then loading and done. The source loads from the
 * mock provider, in-process on a socket, through the app's data workers; its test logins come
 * from the mock's fixtures. A relaunch with a source stored skips onboarding. The `RemoteDriver`
 * presses the keys and reads the focus from the focus engine (step 14b); keys aimed at a field
 * being edited (Backspace, the caret's arrows) go to the keyboard.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const catalog = loadCatalog();

let app: MockServer;
/** The mock's `host:port`, typed the way a user would (no `http://`). */
let host: string;

test.beforeAll(async () => {
  app = await mock();
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

interface StoredProfile {
  sources: Array<{ id: string; type: string; name: string }>;
  onboarding: Record<string, unknown>;
}

/** The stored profile document (`null`: none). Only once the app has opened its database. */
function storedProfile(page: Page): Promise<StoredProfile | null> {
  return page.evaluate(
    () =>
      new Promise<StoredProfile | null>((resolve, reject) => {
        const open = indexedDB.open('zoma');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: unknown } | undefined;
            resolve(record === undefined ? null : (record.doc as StoredProfile));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** Records each loading phase the screen shows, from before "Add source" is pressed. */
async function recordPhases(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { phases: string[] }).phases = seen;
    new MutationObserver(() => {
      const phase = document.querySelector('[data-testid=load-status]')?.getAttribute('data-phase');
      if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase'] });
  });
}

function phasesSeen(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { phases: string[] }).phases);
}
/** The 1920x1080 canvas less its 5% title-safe margins. */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function open(page: Page, locale: string): Promise<Locator> {
  await page.goto(`/?locale=${locale}`);
  const root = page.getByTestId('onboarding');
  await expect(root).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return root;
}

/** OK on the focused field, type, Enter: the remote's way, with the desktop keyboard. */
async function typeInto(page: Page, root: Locator, field: string, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-editing', `onboarding-${field}`);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(`onboarding-${field}`);
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(root).toHaveAttribute('data-editing', '');
}

interface Layout {
  readonly scroll: readonly [number, number];
  readonly outside: string[];
  readonly cut: string[];
}

/** Every box inside the safe area, no page scroll, no label of ours cut. */
function layout(page: Page): Promise<Layout> {
  return page.evaluate((safe) => {
    const name = (el: Element): string => `${el.className}: ${(el.textContent ?? '').slice(0, 40)}`;
    const boxes = '.z-button, .z-field, .z-progress, .z-spinner, .onboarding__title, .onboarding__text, .onboarding__note, .onboarding__counts';
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll(boxes))) {
      const r = el.getBoundingClientRect();
      if (r.left < safe.left || r.top < safe.top || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(name(el));
    }
    // tools/engines/src/onboarding.ts measures the same boxes and labels in Chromium 53/56/68.
    const labels = '.z-button__label, .onboarding__title, .z-field__label, .z-field__note';
    const cut = Array.from(document.querySelectorAll(labels))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map(name);
    return { scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as const, outside, cut };
  }, SAFE);
}

/** In en-XA every string of ours is bracketed: any other text with letters is hard-coded. */
function untranslated(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid=onboarding]');
    if (root === null) return ['no onboarding'];
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.nodeValue ?? '').trim();
      if (!/\p{L}/u.test(text) || node.parentElement?.closest('[translate="no"]') != null) continue;
      if (!(text.startsWith('[') && text.endsWith(']'))) out.push(text);
    }
    return out;
  });
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `onboarding-${name}.png`), animations: 'disabled' });
}

async function checkScreen(page: Page, name: string): Promise<void> {
  expect(await layout(page), name).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
  await shot(page, name);
}

test.describe('onboarding by keys (pnpm dev, the start screen)', () => {
  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true });
  });

  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    test(`walks the whole flow in ${language}, typing the login on the keyboard (${locale})`, async ({ page }) => {
      const errors = trackErrors(page);
      const remote = new RemoteDriver(page);
      const root = await open(page, locale);
      const ar = language === 'ar';
      // The TV's language is focused first; both languages offer themselves in their own words.
      await remote.expectFocus(`language/languages/${ar ? 1 : 0}`);
      await expect(page.getByTestId('choose-en')).toHaveText('Choose your language');
      await expect(page.getByTestId('choose-ar')).toHaveText('اختر لغتك');
      await expect(page.getByTestId('language-en')).toHaveText('English');
      await expect(page.getByTestId('language-ar')).toHaveText('العربية');
      await checkScreen(page, `${locale}-language`);

      await remote.press('OK');
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(root).toHaveAttribute('data-language', language);
      await remote.expectFocus('disclaimer/actions/0');
      await expect(page.getByTestId('onboarding-title')).toHaveText(ar ? 'زوما مشغّل وسائط' : 'Zoma is a player');
      await expect(root).toContainText(ar ? 'لا يقدّم زوما أي قنوات' : 'Zoma provides no channels');
      await checkScreen(page, `${locale}-disclaimer`);

      await remote.press('OK');
      await remote.expectFocus('consent/actions/0');
      await expect(root).toContainText(ar ? 'النسخ الاحتياطي مفعّل افتراضيًا' : 'The backup is on by default');
      // The buttons' row mirrors in Arabic: "Not now" is to the left of "Allow" there.
      await remote.press(ar ? 'LEFT' : 'RIGHT');
      await remote.expectFocus('consent/actions/1');
      await remote.press(ar ? 'RIGHT' : 'LEFT');
      await checkScreen(page, `${locale}-consent`);
      await remote.press('OK');

      await remote.expectFocus('source/types/0');
      await expect(page.getByTestId('type-hint')).toHaveText(ar ? 'عنوان خادم واسم مستخدم وكلمة مرور' : 'A server address, a username and a password');
      await remote.press('DOWN');
      await expect(page.getByTestId('type-hint')).toHaveText(ar ? 'رابط إلى ملف قائمة تشغيل' : 'A link to a playlist file');
      await remote.press('UP', 'OK');

      // The Xtream form: OK opens a field (DOM focus: the TV's keyboard), Enter ends it and moves on.
      await remote.expectFocus('form/fields/0');
      await expect(page.locator('.z-field')).toHaveCount(5);
      // The mock provider's address and its test login (apps/mock-provider/fixtures).
      await typeInto(page, root, 'server', host);
      await remote.expectFocus('form/fields/1');
      await typeInto(page, root, 'username', U);
      await typeInto(page, root, 'password', P);
      await remote.expectFocus('form/fields/3');
      await expect(page.locator('#onboarding-password')).toHaveAttribute('type', 'password');
      // A guide link with a space: refused on the TV, before anything is fetched.
      await typeInto(page, root, 'epg', `${host}/xml tv.php`);
      await remote.press('DOWN', 'OK');
      await remote.expectFocus('form/fields/3');
      await expect(page.getByTestId('field-epg')).toHaveClass(/is-invalid/);
      await expect(page.getByTestId('field-epg').locator('.z-field__note')).toHaveText(ar ? 'لا يمكن أن يحتوي الرابط على مسافات' : "A link can't contain spaces");
      await checkScreen(page, `${locale}-form-error`);

      // Backspace deletes inside the field (it is Back elsewhere): the form stays.
      await remote.press('OK');
      for (let i = 0; i < 'xml tv.php'.length; i++) await page.keyboard.press('Backspace');
      await page.keyboard.type(`xmltv.php?username=${U}&password=${P}`);
      await remote.press('OK');
      await remote.expectFocus('form/fields/4');
      await expect(page.locator('#onboarding-epg')).toHaveValue(`${host}/xmltv.php?username=${U}&password=${P}`);
      await expect(page.getByTestId('field-epg')).not.toHaveClass(/is-invalid/);
      // A name in Arabic reads right to left in its own field.
      await typeInto(page, root, 'name', 'البيت');
      await expect(page.locator('#onboarding-name')).toHaveAttribute('dir', 'auto');
      await expect(page.locator('#onboarding-server')).toHaveAttribute('dir', 'ltr');
      await remote.expectFocus('form/actions/0');
      await recordPhases(page);
      await remote.press('OK');

      // The login is checked, the catalog downloaded and saved, the guide read: then the mock's
      // own counts. The source's name is isolated.
      await expect(root).toHaveAttribute('data-screen', /loading|done/);
      await expect(root).toHaveAttribute('data-screen', 'done', { timeout: 20_000 });
      expect(await phasesSeen(page)).toEqual(expect.arrayContaining(['download', 'guide']));
      await remote.expectFocus('done/actions/0');
      const title = stripIsolates((await page.locator('.onboarding__text').first().textContent()) ?? '');
      expect(title).toBe(ar ? 'البيت جاهز.' : 'البيت is ready.');
      const counts = { live: catalog.live.length, movies: catalog.movies.length, series: catalog.series.length };
      for (const [kind, n] of Object.entries(counts)) await expect(page.getByTestId(`done-${kind}`)).toHaveAttribute('data-n', String(n));
      if (ar) {
        for (const kind of Object.keys(counts)) await expect(page.getByTestId(`done-${kind}`)).toHaveText(/^[^A-Za-z]*\p{Script=Arabic}+[^A-Za-z]*$/u);
      } else {
        await expect(page.getByTestId('done-live')).toHaveText(`${counts.live} channels`);
        await expect(page.getByTestId('done-movies')).toHaveText(`${counts.movies} films`);
        await expect(page.getByTestId('done-series')).toHaveText(`${counts.series} series`);
      }
      await checkScreen(page, `${locale}-done`);
      // Saved: the answers and the source (its login stays in IndexedDB; not printed here).
      const saved = await storedProfile(page);
      expect(saved?.onboarding).toEqual({ language, disclaimerAt: expect.any(Number), consent: true });
      expect(saved?.sources.map((s) => [s.id, s.type, s.name])).toEqual([['s1', 'xtream', 'البيت']]);
      // Every glyph from the bundled faces.
      const faces = (await renderedFontsUnder(page, '[data-testid=onboarding]')).map((f) => [f.familyName, f.isCustomFont]);
      expect(faces).toContainEqual([LATIN_FACE, true]);
      expect(faces).toContainEqual([ARABIC_FACE, true]);
      expect(faces.every(([, custom]) => custom)).toBe(true);

      // Done is the new root: Back offers to exit instead of going back into onboarding.
      await remote.press('BACK');
      await remote.expectFocus('exit/actions/0');
      await remote.press('OK');
      await remote.expectFocus('done/actions/0');
      // Start watching: the live screen (step 14a; e2e/live.spec.ts walks it), in the language picked.
      await remote.press('OK');
      await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
      await expect(page.getByTestId('live')).toHaveAttribute('data-language', language);
      await expect(page.locator('[data-testid=rail] .z-chip').first().locator('.z-chip__count')).toHaveText(String(counts.live));
      // A relaunch: the source is stored, so onboarding is skipped.
      await page.reload();
      await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
      await expect(page.getByTestId('onboarding')).toHaveCount(0);
      await expect(page.getByTestId('live')).toHaveAttribute('data-pending', '0', { timeout: 10_000 });
      expect(errors).toEqual([]);
    });

    test(`a wrong password shows the auth error; Edit details keeps the form, and the fixed login loads (${locale})`, async ({ page }) => {
      const errors = trackErrors(page);
      const remote = new RemoteDriver(page);
      const root = await open(page, locale);
      const ar = language === 'ar';
      await remote.press('OK', 'OK', 'OK', 'OK');
      await typeInto(page, root, 'server', host);
      await typeInto(page, root, 'username', U);
      await typeInto(page, root, 'password', 'wrong');
      await remote.press('DOWN', 'DOWN');
      await remote.expectFocus('form/actions/0');
      await remote.press('OK');
      await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'auth', { timeout: 20_000 });
      await expect(page.getByTestId('load-error')).toHaveText(ar ? 'لم يقبل مزوّد الخدمة اسم المستخدم وكلمة المرور هذين.' : "The provider didn't accept this username and password.");
      await remote.expectFocus('loading/actions/0');
      await checkScreen(page, `${locale}-failed`);
      // Edit details: back on the form, everything typed still there.
      await remote.press('OK');
      await remote.expectFocus('form/actions/0');
      await expect(page.locator('#onboarding-server')).toHaveValue(host);
      await expect(page.locator('#onboarding-password')).toHaveValue('wrong');
      await remote.press('UP');
      await remote.expectFocus('form/fields/4');
      await remote.press('UP', 'UP', 'OK');
      await remote.expectFocus('form/fields/2');
      await expect(root).toHaveAttribute('data-editing', 'onboarding-password');
      for (let i = 0; i < 'wrong'.length; i++) await page.keyboard.press('Backspace');
      await page.keyboard.type(P);
      await remote.press('OK', 'DOWN', 'DOWN', 'OK');
      await expect(root).toHaveAttribute('data-screen', 'done', { timeout: 20_000 });
      await expect(page.getByTestId('done-live')).toHaveAttribute('data-n', String(catalog.live.length));
      // The failed try saved nothing; the second is source s1.
      expect((await storedProfile(page))?.sources.map((s) => s.id)).toEqual(['s1']);
      expect(errors).toEqual([]);
    });
  }

  test("an expired or a banned account says so: the panel lets them in but serves them nothing", async ({ page }) => {
    const remote = new RemoteDriver(page);
    const root = await open(page, 'en-US');
    await remote.press('OK', 'OK', 'OK', 'OK');
    await typeInto(page, root, 'server', host);
    // The mock's test accounts in those states (apps/mock-provider/fixtures/server.yaml).
    await typeInto(page, root, 'username', 'banned');
    await typeInto(page, root, 'password', 'banned-test');
    await remote.press('DOWN', 'DOWN', 'OK');
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'blocked', { timeout: 20_000 });
    await expect(page.getByTestId('load-error')).toHaveText('Your provider has blocked or turned off this account. Contact your provider.');
    // Edit details, then the expired account.
    await remote.press('OK', 'UP', 'UP', 'UP', 'UP');
    await remote.expectFocus('form/fields/1');
    await remote.press('OK');
    for (let i = 0; i < 'banned'.length; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type('expired');
    await remote.press('OK', 'OK');
    for (let i = 0; i < 'banned-test'.length; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type('expired-test');
    await remote.press('OK', 'DOWN', 'DOWN', 'OK');
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'expired', { timeout: 20_000 });
    await expect(page.getByTestId('load-error')).toHaveText('This account has expired. Contact your provider.');
    // "Try again" asks the panel again: still expired.
    await remote.press('RIGHT', 'OK');
    await expect(page.getByTestId('load-error')).toHaveAttribute('data-code', 'expired', { timeout: 20_000 });
  });

  test('the language picked comes back after a relaunch before a source is added', async ({ page }) => {
    const remote = new RemoteDriver(page);
    const root = await open(page, 'en-US');
    // Arabic, then "I understand"; the app is closed on the consent screen.
    await remote.press('RIGHT', 'OK', 'OK');
    await remote.expectFocus('consent/actions/0');
    await expect.poll(async () => (await storedProfile(page))?.onboarding).toEqual({ language: 'ar', disclaimerAt: expect.any(Number), consent: null });
    await page.reload();
    await expect(root).toHaveAttribute('data-ready', 'true');
    // Onboarding again (no source yet), in Arabic, with العربية focused.
    await remote.expectFocus('language/languages/1');
    await expect(root).toHaveAttribute('data-language', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-US');
    // Both titles still offer themselves: Arabic is the app's language now, English the TV's.
    await expect(page.getByTestId('choose-ar')).toHaveText('اختر لغتك');
    await remote.press('OK');
    await expect(page.getByTestId('onboarding-title')).toHaveText('زوما مشغّل وسائط');
  });

  test('picking the other language switches the app live, and Back keeps the choice', async ({ page }) => {
    const remote = new RemoteDriver(page);
    const root = await open(page, 'en-US');
    await remote.press('RIGHT', 'OK');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar-US');
    await expect(root).toHaveAttribute('data-language', 'ar');
    await expect(page.getByTestId('onboarding-title')).toHaveText('زوما مشغّل وسائط');
    await remote.press('BACK');
    await remote.expectFocus('language/languages/1');
    // Back on the language screen keeps Arabic until another language is picked.
    await expect(root).toHaveAttribute('data-language', 'ar');
    // In Arabic RIGHT goes back to the start of the row: English.
    await remote.press('RIGHT', 'OK');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(page.getByTestId('onboarding-title')).toHaveText('Zoma is a player');
  });

  test('Back goes one screen back, through every screen to the exit dialog', async ({ page }) => {
    const remote = new RemoteDriver(page);
    await open(page, 'en-US');
    await remote.press('OK', 'OK', 'OK', 'DOWN', 'OK');
    await remote.expectFocus('form/fields/0');
    await expect(page.locator('.z-field')).toHaveCount(3);
    for (const path of ['source/types/1', 'consent/actions/0', 'disclaimer/actions/0', 'language/languages/0', 'exit/actions/0']) {
      await remote.go('BACK', path);
    }
    await expect(page.getByTestId('exit-dialog')).toBeVisible();
  });

  test('a field holds the keys while it is edited: Escape ends the edit and keeps the text', async ({ page }) => {
    const remote = new RemoteDriver(page);
    const root = await open(page, 'en-US');
    await remote.press('OK', 'OK', 'OK', 'DOWN', 'OK');
    await remote.press('OK');
    await page.keyboard.type('p.example/a');
    // Arrows left and right move the caret, not the focus; Backspace deletes.
    for (const key of ['ArrowLeft', 'ArrowLeft', 'Backspace', 'ArrowRight']) await page.keyboard.press(key);
    await expect(page.locator('#onboarding-playlist')).toHaveValue('p.exampl/a');
    await remote.expectFocus('form/fields/0');
    await expect(root).toHaveAttribute('data-editing', 'onboarding-playlist');
    await remote.press('BACK');
    await remote.expectFocus('form/fields/0');
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
    await expect(page.locator('#onboarding-playlist')).toHaveValue('p.exampl/a');
    // ArrowDown ends an edit too, and moves on.
    await remote.press('OK', 'DOWN');
    await remote.expectFocus('form/fields/1');
  });

  test('a pointer click opens a field, and its twin OK key is the same press', async ({ page }) => {
    const remote = new RemoteDriver(page);
    const root = await open(page, 'en-US');
    await remote.press('OK', 'OK', 'OK', 'OK');
    // A click within 500 ms of the last OK key would be that key's twin (step 11b).
    await page.waitForTimeout(600);
    await page.getByTestId('field-username').click();
    await remote.expectFocus('form/fields/1');
    await expect(root).toHaveAttribute('data-editing', 'onboarding-username');
    // webOS sends key 13 with the Magic Remote's click: it must not end the edit just opened.
    await remote.press('OK');
    await remote.expectFocus('form/fields/1');
    await expect(root).toHaveAttribute('data-editing', 'onboarding-username');
    await page.keyboard.type('u');
    await remote.press('OK');
    await remote.expectFocus('form/fields/2');
  });

  test('marks every string of ours in en-XA, on every screen, which catches hard-coded text', async ({ page }) => {
    const remote = new RemoteDriver(page);
    const root = await open(page, 'en-XA');
    const check = async (name: string): Promise<void> => {
      expect(await untranslated(page), name).toEqual([]);
      expect(await layout(page), name).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
    };
    await check('language');
    await shot(page, 'en-XA-language');
    await remote.press('OK');
    await check('disclaimer');
    await remote.press('OK');
    await check('consent');
    await shot(page, 'en-XA-consent');
    await remote.press('OK');
    await check('source');
    await remote.press('OK');
    await remote.press('DOWN', 'DOWN', 'DOWN', 'DOWN', 'DOWN', 'OK');
    await expect(page.getByTestId('field-server')).toHaveClass(/is-invalid/);
    await check('form');
    await shot(page, 'en-XA-form-error');
    // The same check in English finds our strings, so it can fail.
    await open(page, 'en-US');
    await remote.press('OK');
    expect(await untranslated(page)).toEqual(expect.arrayContaining(['Zoma is a player', 'I understand']));
    await expect(root).toHaveAttribute('data-language', 'en');
  });
});
