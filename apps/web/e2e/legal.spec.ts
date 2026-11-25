import { LEGAL_CHROME, LEGAL_CONTACT, LEGAL_DRAFT_MARK, LEGAL_UPDATED, legalDoc } from '@lablo/protocol/legal';
import type { LegalDocId, LegalLang } from '@lablo/protocol/legal';
import { PHONE_CSP } from '../next.config';
import { expect, shot, test } from './support';

/**
 * The legal pages `/terms` and `/privacy` against `next start` (RELAY step 40d's "Done when"): each
 * document in English and Arabic, from `?lang=` and from `Accept-Language`, the draft mark on
 * every page, the TV's own words (one source), the policy headers, and nothing asked of another
 * host (the `requests` fixture checks).
 */

const DOCS: readonly LegalDocId[] = ['terms', 'privacy'];
const LANGS: readonly LegalLang[] = ['en', 'ar'];

for (const id of DOCS) {
  for (const lang of LANGS) {
    test(`/${id}?lang=${lang}: the whole document, the draft mark, the direction, the headers`, async ({ page }) => {
      const answer = await page.goto(`/${id}?lang=${lang}`);
      expect(answer?.status()).toBe(200);
      expect(answer?.headers()['content-security-policy']).toBe(PHONE_CSP);
      expect(answer?.headers()['referrer-policy']).toBe('no-referrer');
      expect(answer?.headers()['x-content-type-options']).toBe('nosniff');

      const root = page.getByTestId('legal');
      await expect(root).toHaveAttribute('lang', lang);
      await expect(root).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      await expect(root).toHaveAttribute('data-doc', id);
      const doc = legalDoc(lang, id);
      await expect(page.getByTestId('legal-title')).toHaveText(doc.title);
      await expect(page).toHaveTitle(`${doc.title} · Lablo`);
      await expect(page.getByTestId('legal-draft')).toHaveText(LEGAL_DRAFT_MARK[lang]);
      await expect(root).toContainText(LEGAL_UPDATED);

      // Every section, in order, with its words.
      const sections = page.getByTestId('legal-section');
      await expect(sections).toHaveCount(doc.sections.length);
      for (let i = 0; i < doc.sections.length; i++) {
        const section = doc.sections[i]!;
        await expect(sections.nth(i).locator('h2')).toHaveText(section.heading);
        await expect(sections.nth(i).locator('p')).toHaveCount(section.paragraphs.length);
        for (const paragraph of section.paragraphs) await expect(sections.nth(i)).toContainText(paragraph);
      }

      // The contact address is a left-to-right mail link.
      const mail = root.locator(`a[href="mailto:${LEGAL_CONTACT}"]`).first();
      await expect(mail).toHaveAttribute('dir', 'ltr');
      await expect(mail).toHaveText(LEGAL_CONTACT);

      // Found and indexed: the page's own robots tag replaces the layout's noindex.
      const robots = await page.locator('meta[name="robots"]').getAttribute('content');
      expect(robots).toContain('index');
      expect(robots).not.toContain('noindex');
      await shot(page, `legal-${id}-${lang}`);
    });
  }

  test(`/${id}: the browser's language (its Accept-Language) picks the language, ?lang= overrides it, English is the default`, async ({ browser, baseURL }) => {
    const open = async (locale: string, query: string) => {
      const context = await browser.newContext({ baseURL: baseURL!, locale });
      const page = await context.newPage();
      await page.goto(`/${id}${query}`);
      const lang = await page.getByTestId('legal').getAttribute('data-lang');
      await context.close();
      return lang;
    };
    expect(await open('ar-SA', '')).toBe('ar');
    expect(await open('ar-SA', '?lang=en')).toBe('en');
    expect(await open('fr-FR', '')).toBe('en');
    expect(await open('en-US', '?lang=ar')).toBe('ar');
    // Anything else in `?lang=` is ignored.
    expect(await open('ar', '?lang=zz')).toBe('ar');
  });

  test(`/${id}: the language switch and the link to the other document keep what they should`, async ({ page }) => {
    await page.goto(`/${id}?lang=en`);
    const other: LegalDocId = id === 'terms' ? 'privacy' : 'terms';
    await expect(page.getByTestId('legal-other')).toHaveText(legalDoc('en', other).title);
    await expect(page.getByTestId('legal-switch')).toHaveText(LEGAL_CHROME.en.switchTo);
    await page.getByTestId('legal-switch').click();
    await expect(page).toHaveURL(new RegExp(`/${id}\\?lang=ar$`));
    await expect(page.getByTestId('legal')).toHaveAttribute('lang', 'ar');
    await expect(page.getByTestId('legal-title')).toHaveText(legalDoc('ar', id).title);
    // The other document opens in the language being read.
    await page.getByTestId('legal-other').click();
    await expect(page).toHaveURL(new RegExp(`/${other}\\?lang=ar$`));
    await expect(page.getByTestId('legal-title')).toHaveText(legalDoc('ar', other).title);
    await page.getByTestId('legal-switch').click();
    await expect(page.getByTestId('legal')).toHaveAttribute('lang', 'en');
  });
}

test('the pages need no script to read: the whole text is in the HTML the server sends', async ({ request }) => {
  for (const id of DOCS) {
    const html = await (await request.get(`/${id}?lang=en`)).text();
    for (const section of legalDoc('en', id).sections) {
      // (The HTML escapes quotes and apostrophes: those headings are read in the DOM test above.)
      if (section.heading.indexOf("'") === -1 && section.heading.indexOf('"') === -1) expect(html).toContain(section.heading);
    }
  }
});
