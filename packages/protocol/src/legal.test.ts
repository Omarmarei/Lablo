import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LegalDocId, LegalLang } from './legal';
import { LEGAL_CHROME, LEGAL_CONTACT, LEGAL_DOCS, LEGAL_DRAFT, LEGAL_DRAFT_MARK, LEGAL_UPDATED, RETENTION_DAYS, legalDoc } from './legal';

/**
 * The terms and the privacy policy (RELAY step 40d): both languages say the same things, in
 * sections that fit a TV page, and the privacy text quotes the retention the servers keep.
 */

const LANGS: readonly LegalLang[] = ['en', 'ar'];
const DOCS: readonly LegalDocId[] = ['terms', 'privacy'];

/** Whether the text holds a letter of the Arabic block (U+0600 to U+06FF). */
function hasArabic(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x600 && c <= 0x6ff) return true;
  }
  return false;
}

function allText(lang: LegalLang, id: LegalDocId): string {
  const doc = legalDoc(lang, id);
  return [doc.title].concat(...doc.sections.map((s) => [s.heading].concat(s.paragraphs))).join('\n');
}

describe('the legal text (RELAY step 40d)', () => {
  it('is a draft for counsel until counsel\'s text sets LEGAL_DRAFT to false, with a mark in each language', () => {
    expect(LEGAL_DRAFT).toBe(true);
    expect(LEGAL_DRAFT_MARK.en).toBe('Draft for counsel');
    expect(hasArabic(LEGAL_DRAFT_MARK.ar)).toBe(true);
    expect(LEGAL_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LEGAL_CONTACT).toBe('lablo.iptv@gmail.com');
  });

  it('has the same sections in both languages, each with a heading and one to three paragraphs that fit a page', () => {
    for (const id of DOCS) {
      expect(LEGAL_DOCS.ar[id].sections.length).toBe(LEGAL_DOCS.en[id].sections.length);
      for (const lang of LANGS) {
        for (const section of legalDoc(lang, id).sections) {
          expect(section.heading.length).toBeGreaterThan(2);
          expect(section.paragraphs.length).toBeGreaterThanOrEqual(1);
          expect(section.paragraphs.length).toBeLessThanOrEqual(3);
          // A TV page holds about eight lines: the longest section stays under this many characters.
          expect(section.paragraphs.join('').length).toBeLessThan(620);
          for (const paragraph of section.paragraphs) expect(paragraph.length).toBeGreaterThan(20);
        }
      }
    }
    expect(LEGAL_DOCS.en.terms.sections.length).toBe(6);
    expect(LEGAL_DOCS.en.privacy.sections.length).toBe(7);
  });

  it('writes the Arabic in Arabic and the English without it', () => {
    for (const id of DOCS) {
      expect(hasArabic(allText('en', id))).toBe(false);
      expect(hasArabic(allText('ar', id))).toBe(true);
      expect(hasArabic(legalDoc('ar', id).title)).toBe(true);
    }
    expect(hasArabic(LEGAL_CHROME.en.about + LEGAL_CHROME.en.next + LEGAL_CHROME.en.disclaimer.join(''))).toBe(false);
    expect(hasArabic(LEGAL_CHROME.ar.about + LEGAL_CHROME.ar.next + LEGAL_CHROME.ar.disclaimer.join(''))).toBe(true);
  });

  it('gives the contact address in both documents of both languages, and leaves no placeholder', () => {
    for (const lang of LANGS) {
      for (const id of DOCS) {
        const text = allText(lang, id);
        expect(text).toContain(LEGAL_CONTACT);
        expect(text).not.toMatch(/TODO|TBD|XXX|undefined|\[object|\{n\}|\{total\}/);
      }
    }
  });

  it('says in the privacy policy how long the servers keep each thing, the numbers the servers use', () => {
    expect(RETENTION_DAYS).toEqual({ backup: 180, telemetry: 90, report: 30 });
    for (const lang of LANGS) {
      const text = allText(lang, 'privacy');
      expect(text).toContain('180');
      expect(text).toContain('90');
      expect(text).toContain('30');
    }
  });

  it('says what the privacy policy must: the sources stay on the TV, the backup is encrypted, the reports are anonymous', () => {
    const en = allText('en', 'privacy');
    expect(en).toContain('stay on your TV');
    expect(en).toContain('encrypted');
    expect(en).toContain('anonymous');
    expect(en).toContain('never see your streams');
    expect(en).toContain('Three optional things leave your TV');
    expect(en).toContain('is used to limit abuse and is not stored');
    expect(en).toContain('We have no account for you, no advertising and no tracking');
    const terms = allText('en', 'terms');
    expect(terms).toContain('provides no channels');
    expect(terms).toContain('Do not use Lablo to watch, copy or share content you have no right to use');
    expect(terms).toContain('court order');
  });

  it('has the page counter in both languages', () => {
    expect(LEGAL_CHROME.en.pageOf(2, 6)).toBe('Page 2 of 6');
    expect(LEGAL_CHROME.ar.pageOf(2, 6)).toContain('2');
    expect(hasArabic(LEGAL_CHROME.ar.pageOf(2, 6))).toBe(true);
  });

  it('imports nothing (the TV settings, the web app and an e2e spec read it; zod stays out of settings.js)', () => {
    const source = readFileSync(new URL('./legal.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/require\(/);
  });
});
