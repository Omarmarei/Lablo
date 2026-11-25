import type { VNode } from 'preact';
import { LEGAL_CONTACT, LEGAL_DOCS, LEGAL_DRAFT_MARK, legalDoc } from '@lablo/protocol/legal';
import type { ItemBinding } from '@lablo/ui';
import { createNavigator } from '@lablo/ui';
import { describe, expect, it } from 'vitest';
import { appI18n } from '../i18n';
import { ABOUT_DOC_SCREEN, ABOUT_INFO_SCREEN, ABOUT_ROWS, ABOUT_SCREEN, DOC_BUTTONS, createAboutPage } from './about-page';
import { AboutDocView, AboutInfoView, AboutListView, aboutRowText, paragraphPieces } from './AboutPage';
import { SETTINGS_VISIBLE } from './settings-window';

/**
 * Settings › "About Lablo" (RELAY step 40d): the pages' state (the list, the info page, a
 * document's sections with Previous, Next and Close) and the views (the draft mark on every page,
 * the contact address left to right and never translated, en-XA's pseudo-localization).
 */

type Props = Record<string, unknown> & { children?: unknown };

function walk(node: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out);
    return out;
  }
  if (node === null || typeof node !== 'object' || !('props' in node)) return out;
  const v = node as VNode;
  out.push(v);
  walk((v.props as Props).children, out);
  return out;
}

const propsOf = (v: unknown): Props => ((v as VNode | undefined)?.props ?? {}) as Props;
const byTestId = (root: unknown, id: string): VNode[] => walk(root).filter((v) => propsOf(v)['data-testid'] === id);
const textOf = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textOf((node as VNode).props.children);
};

const en = appI18n('en-US', { isolate: false });
const ar = appI18n('ar-SA', { isolate: false });
const xa = appI18n('en-XA', { isolate: false });
const idle: ItemBinding = { state: 'idle', onHover: () => undefined, onPress: () => undefined } as unknown as ItemBinding;

function setup(version?: string) {
  const nav = createNavigator({
    root: { id: 'live', zones: [{ kind: 'list', id: 'channels', axis: 'vertical', count: 3 }] },
    rootBack: 'exit-dialog',
    exit: () => undefined,
    exitDialog: () => undefined,
  });
  nav.push({ id: 'settings', zones: [{ kind: 'list', id: 'items', axis: 'vertical', count: 13, visible: 7 }] });
  return { nav, page: createAboutPage(version === undefined ? { nav } : { nav, version }) };
}

describe('the about pages (RELAY step 40d)', () => {
  it('opens a list of three rows: Lablo, the terms, the privacy policy', () => {
    const { nav, page } = setup();
    expect(ABOUT_ROWS).toEqual(['info', 'terms', 'privacy']);
    page.open();
    expect(nav.snapshot()).toMatchObject({ screen: ABOUT_SCREEN, zone: 'rows', index: 0 });
    expect(nav.top.zone('rows')).toMatchObject({ count: 3 });
    expect(ABOUT_ROWS.length).toBeLessThanOrEqual(SETTINGS_VISIBLE);
  });

  it('opens the info page with one Close; Back and OK on Close go back one page each', () => {
    const { nav, page } = setup('1.2.3');
    page.open();
    nav.handle('OK');
    expect(nav.snapshot()).toMatchObject({ screen: ABOUT_INFO_SCREEN, zone: 'actions', index: 0 });
    expect(nav.top.zone('actions')).toMatchObject({ count: 1 });
    nav.handle('OK');
    expect(nav.snapshot()).toMatchObject({ screen: ABOUT_SCREEN, index: 0 });
    nav.handle('OK');
    nav.handle('BACK');
    expect(nav.snapshot().screen).toBe(ABOUT_SCREEN);
    nav.handle('BACK');
    expect(nav.snapshot().screen).toBe('settings');
    expect(page.version).toBe('1.2.3');
    expect(setup().page.version).toBeNull();
  });

  it('opens each document on its first section with three buttons', () => {
    for (let i = 1; i <= 2; i++) {
      const { nav, page } = setup();
      page.open();
      nav.top.focus('rows', i);
      nav.handle('OK');
      expect(nav.snapshot()).toMatchObject({ screen: ABOUT_DOC_SCREEN, zone: 'actions', index: 0 });
      expect(nav.top.zone('actions')).toMatchObject({ count: DOC_BUTTONS.length });
      expect(page.doc.value).toBe(i === 1 ? 'terms' : 'privacy');
      expect(page.page.value).toBe(0);
      expect(page.pages(page.doc.value)).toBe(i === 1 ? 6 : 7);
    }
  });

  it('turns the pages with Next and Previous, stops at both ends, and closes with Close', () => {
    const { nav, page } = setup();
    page.open();
    nav.top.focus('rows', 2);
    nav.handle('OK');
    // Previous on the first page does nothing.
    nav.top.focus('actions', 0);
    nav.handle('OK');
    expect(page.page.value).toBe(0);
    nav.top.focus('actions', 1);
    for (let n = 1; n <= 6; n++) {
      nav.handle('OK');
      expect(page.page.value).toBe(n);
    }
    // Next on the last page does nothing.
    nav.handle('OK');
    expect(page.page.value).toBe(6);
    nav.top.focus('actions', 0);
    nav.handle('OK');
    expect(page.page.value).toBe(5);
    nav.top.focus('actions', 2);
    nav.handle('OK');
    expect(nav.snapshot()).toMatchObject({ screen: ABOUT_SCREEN, index: 2 });
    // A document opened again starts on its first section.
    nav.handle('OK');
    expect(page.page.value).toBe(0);
  });

  it('has the same page count in both languages', () => {
    const { page } = setup();
    expect(page.pages('terms')).toBe(LEGAL_DOCS.ar.terms.sections.length);
    expect(page.pages('privacy')).toBe(LEGAL_DOCS.ar.privacy.sections.length);
  });
});

describe('the about views', () => {
  const buttons = (v: unknown): string[] => walk(v).filter((n) => propsOf(n)['testId'] !== undefined).map((n) => String(propsOf(n)['testId']));

  it('draws the list with the name and the line of each row, in both languages', () => {
    const view = AboutListView({ i18n: en, item: () => idle });
    expect(byTestId(view, 'about')).toHaveLength(1);
    expect(textOf(byTestId(view, 'about-row-info')[0])).toBe('About LabloThe version, what Lablo is, the terms and the privacy policy');
    expect(textOf(byTestId(view, 'about-row-terms')[0])).toBe('Terms of useWhat you may and may not do with Lablo');
    expect(textOf(byTestId(view, 'about-row-privacy')[0])).toBe('Privacy policyWhat stays on your TV, what is sent, and for how long');
    expect(aboutRowText(ar, 'terms').name).toBe('شروط الاستخدام');
    expect(aboutRowText(ar, 'privacy').name).toBe('سياسة الخصوصية');
    expect(aboutRowText(xa, 'terms').name).not.toBe('Terms of use');
  });

  it('draws the info page: the draft mark, the version left to right, the disclaimer and Close', () => {
    const view = AboutInfoView({ i18n: en, version: '1.2.3', button: () => idle });
    expect(textOf(byTestId(view, 'about-draft')[0])).toBe('Draft for counsel');
    expect(textOf(byTestId(view, 'about-version')[0])).toBe('Version 1.2.3');
    const address = walk(byTestId(view, 'about-version')[0]).find((n) => propsOf(n)['dir'] === 'ltr');
    expect(propsOf(address)['translate']).toBe(false);
    expect(textOf(view)).toContain('It provides no channels, films or other content');
    expect(buttons(view)).toEqual(['about-close']);
    expect(byTestId(AboutInfoView({ i18n: en, version: null, button: () => idle }), 'about-version')).toHaveLength(0);
    const arView = AboutInfoView({ i18n: ar, version: '1.2.3', button: () => idle });
    expect(textOf(byTestId(arView, 'about-draft')[0])).toBe(LEGAL_DRAFT_MARK.ar);
    expect(textOf(arView)).toContain('لابلو مشغّل');
  });

  it("draws a document's section: the title, the draft mark, the heading, the paragraphs, the page counter and three buttons", () => {
    const view = AboutDocView({ i18n: en, doc: 'privacy', page: 2, pages: 7, button: () => idle });
    expect(textOf(byTestId(view, 'about-doc-title')[0])).toBe('Privacy policy');
    expect(textOf(byTestId(view, 'about-draft')[0])).toBe('Draft for counsel');
    const section = legalDoc('en', 'privacy').sections[2]!;
    expect(textOf(byTestId(view, 'about-heading')[0])).toBe(section.heading);
    expect(textOf(view)).toContain(section.paragraphs[0]!);
    expect(textOf(byTestId(view, 'about-page-of')[0])).toBe('Page 3 of 7');
    expect(buttons(view)).toEqual(['about-previous', 'about-next', 'about-close']);
    // The contact address, on the terms' infringement page, is left to right and never translated.
    const notice = AboutDocView({ i18n: en, doc: 'terms', page: 4, pages: 6, button: () => idle });
    const addresses = walk(notice).filter((n) => String(propsOf(n)['class']) === 'help__address');
    expect(addresses.map((n) => [textOf(n), propsOf(n)['dir'], propsOf(n)['translate']])).toEqual([[LEGAL_CONTACT, 'ltr', false]]);
    const arView = AboutDocView({ i18n: ar, doc: 'terms', page: 0, pages: 6, button: () => idle });
    expect(textOf(byTestId(arView, 'about-heading')[0])).toBe(legalDoc('ar', 'terms').sections[0]!.heading);
    expect(textOf(byTestId(arView, 'about-page-of')[0])).toBe('صفحة 1 من 6');
  });

  it('dims Previous on the first page and Next on the last', () => {
    const disabled = (view: unknown, id: string): unknown => propsOf(walk(view).find((n) => propsOf(n)['testId'] === id))['disabled'];
    const first = AboutDocView({ i18n: en, doc: 'terms', page: 0, pages: 6, button: () => idle });
    expect(disabled(first, 'about-previous')).toBe(true);
    expect(disabled(first, 'about-next')).toBe(false);
    const last = AboutDocView({ i18n: en, doc: 'terms', page: 5, pages: 6, button: () => idle });
    expect(disabled(last, 'about-previous')).toBe(false);
    expect(disabled(last, 'about-next')).toBe(true);
  });

  it('keeps the contact address whole in en-XA while the words around it are pseudo-localized', () => {
    const paragraph = legalDoc('en', 'terms').sections[4]!.paragraphs[0]!;
    const pieces = paragraphPieces(xa, paragraph);
    const address = pieces.filter((p) => p.address);
    expect(address).toEqual([{ text: LEGAL_CONTACT, address: true }]);
    expect(pieces.map((p) => p.text).join('')).not.toBe(paragraph);
    // The words on both sides of the address are pseudo-localized, each on its own.
    const at = paragraph.indexOf(LEGAL_CONTACT);
    expect(pieces).toHaveLength(3);
    expect(pieces[0]!.text).not.toBe(paragraph.slice(0, at));
    expect(pieces[0]!.text.length).toBeGreaterThan(at);
    expect(pieces[2]!.text).not.toBe(paragraph.slice(at + LEGAL_CONTACT.length));
    const plain = paragraphPieces(en, paragraph);
    expect(plain.map((p) => p.text).join('')).toBe(paragraph);
    // A paragraph without the address is one piece.
    expect(paragraphPieces(en, 'No address here.')).toEqual([{ text: 'No address here.', address: false }]);
    // The address at the very start and the very end.
    expect(paragraphPieces(en, LEGAL_CONTACT)).toEqual([{ text: LEGAL_CONTACT, address: true }]);
    expect(paragraphPieces(en, `Write to ${LEGAL_CONTACT}`)).toEqual([
      { text: 'Write to ', address: false },
      { text: LEGAL_CONTACT, address: true },
    ]);
    expect(paragraphPieces(en, `${LEGAL_CONTACT} now`)).toEqual([
      { text: LEGAL_CONTACT, address: true },
      { text: ' now', address: false },
    ]);
  });

  it("quotes the screen's own words: the support button's name, and the onboarding note's row name", () => {
    expect(legalDoc('en', 'privacy').sections[5]!.paragraphs[0]).toContain(`"${en.t('settings.report')}"`);
    expect(legalDoc('ar', 'privacy').sections[5]!.paragraphs[0]).toContain(`«${ar.t('settings.report')}»`);
    expect(en.t('onboarding.privacyNote')).toContain(`"${en.t('settings.about')}"`);
    expect(ar.t('onboarding.privacyNote')).toContain(`«${ar.t('settings.about')}»`);
    expect(en.t('settings.about')).toBe('About Lablo');
  });
});
