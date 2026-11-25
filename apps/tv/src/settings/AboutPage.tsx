import type { VNode } from 'preact';
import type { FocusBinding, ItemBinding } from '@lablo/ui';
import { Button, pseudoLocalize, useZone } from '@lablo/ui';
import type { LegalDocId, LegalLang } from '@lablo/protocol/legal';
import { LEGAL_CHROME, LEGAL_CONTACT, LEGAL_DRAFT, LEGAL_DRAFT_MARK, legalDoc } from '@lablo/protocol/legal';
import type { AppI18n } from '../i18n';
import type { AboutPage } from './about-page';
import { ABOUT_ROWS } from './about-page';

/**
 * Settings › "About Lablo" as drawn (RELAY step 40d): the list (the row's name and the line under
 * it), the info page (version and disclaimer) and a document's page (a section: its heading, its
 * paragraphs, "Page 2 of 6", then "Previous", "Next" and "Close"). The words are
 * `@lablo/protocol/legal`'s, in the app's language (en-XA through `pseudoLocalize`, as the
 * catalogs are, but the contact address is left as it is). While the text is a draft
 * (`LEGAL_DRAFT`) every page carries the draft mark.
 */

function langOf(i18n: AppI18n): LegalLang {
  return i18n.locale.language === 'ar' ? 'ar' : 'en';
}

function local(i18n: AppI18n, text: string): string {
  return i18n.locale.pseudo ? pseudoLocalize(text) : text;
}

/** A paragraph's pieces: the contact address stands alone (left to right, never translated). */
export function paragraphPieces(i18n: AppI18n, text: string): ReadonlyArray<{ readonly text: string; readonly address: boolean }> {
  const at = text.indexOf(LEGAL_CONTACT);
  if (at < 0) return [{ text: local(i18n, text), address: false }];
  const pieces: Array<{ text: string; address: boolean }> = [];
  if (at > 0) pieces.push({ text: local(i18n, text.slice(0, at)), address: false });
  pieces.push({ text: LEGAL_CONTACT, address: true });
  const after = text.slice(at + LEGAL_CONTACT.length);
  if (after.length > 0) pieces.push({ text: local(i18n, after), address: false });
  return pieces;
}

function paragraphView(i18n: AppI18n, text: string, n: number): VNode {
  const pieces = paragraphPieces(i18n, text);
  return (
    <p key={n} class="help__p">
      {pieces.map((piece, i) =>
        piece.address ? (
          <span key={i} class="help__address" dir="ltr" translate={false}>
            {piece.text}
          </span>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </p>
  );
}

function draftView(i18n: AppI18n): VNode | null {
  return LEGAL_DRAFT ? (
    <p class="about__draft" data-testid="about-draft">
      {local(i18n, LEGAL_DRAFT_MARK[langOf(i18n)])}
    </p>
  ) : null;
}

function rowClass(item: ItemBinding): string {
  return item.state === 'focused' ? 'settings__row is-focused' : item.state === 'memory' ? 'settings__row is-memory' : 'settings__row';
}

/** The list's rows' words. */
export function aboutRowText(i18n: AppI18n, row: (typeof ABOUT_ROWS)[number]): { name: string; hint: string } {
  const chrome = LEGAL_CHROME[langOf(i18n)];
  if (row === 'info') return { name: local(i18n, chrome.about), hint: local(i18n, chrome.aboutLine) };
  return row === 'terms' ? { name: local(i18n, chrome.terms), hint: local(i18n, chrome.termsHint) } : { name: local(i18n, chrome.privacy), hint: local(i18n, chrome.privacyHint) };
}

/** The list as drawn, hook-free. */
export function AboutListView({ i18n, item }: { i18n: AppI18n; item: (index: number) => ItemBinding }) {
  const { t } = i18n;
  return (
    <div class="settings__page" data-testid="about">
      <header class="settings__header">
        <h1 class="settings__title">{t('settings.about')}</h1>
      </header>
      <div class="settings__items" role="menu" data-count={ABOUT_ROWS.length}>
        {ABOUT_ROWS.map((row, n) => {
          const binding = item(n);
          const text = aboutRowText(i18n, row);
          return (
            <div key={row} class={rowClass(binding)} role="menuitem" data-testid={`about-row-${row}`} data-state={binding.state} onMouseMove={binding.onHover} onClick={binding.onPress}>
              <div class="settings__top">
                <span class="settings__name">{text.name}</span>
              </div>
              <span class="settings__hint">{text.hint}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The info page as drawn, hook-free. */
export function AboutInfoView({ i18n, version, button }: { i18n: AppI18n; version: string | null; button: (index: number) => ItemBinding }) {
  const { t } = i18n;
  const chrome = LEGAL_CHROME[langOf(i18n)];
  return (
    <div class="settings__page help" data-testid="about-info">
      <header class="settings__header">
        <h1 class="settings__title">{local(i18n, chrome.about)}</h1>
      </header>
      <div class="help__body">
        {draftView(i18n)}
        {version === null ? null : (
          <p class="help__p help__mail" data-testid="about-version">
            <span>{local(i18n, chrome.version)} </span>
            <span class="help__address" dir="ltr" translate={false}>
              {version}
            </span>
          </p>
        )}
        {chrome.disclaimer.map((text, n) => paragraphView(i18n, text, n))}
      </div>
      <div class="help__buttons">
        <Button label={t('action.close')} variant="primary" {...button(0)} testId="about-close" />
      </div>
    </div>
  );
}

/** A document's page as drawn, hook-free. */
export function AboutDocView({ i18n, doc, page, pages, button }: { i18n: AppI18n; doc: LegalDocId; page: number; pages: number; button: (index: number) => ItemBinding }) {
  const lang = langOf(i18n);
  const chrome = LEGAL_CHROME[lang];
  const text = legalDoc(lang, doc);
  const section = text.sections[page];
  return (
    <div class="settings__page help" data-testid="about-doc" data-doc={doc} data-page={page}>
      <header class="settings__header">
        <h1 class="settings__title" data-testid="about-doc-title">
          {local(i18n, text.title)}
        </h1>
      </header>
      <div class="help__body">
        {draftView(i18n)}
        <p class="about__heading" data-testid="about-heading">
          {section === undefined ? '' : local(i18n, section.heading)}
        </p>
        {section === undefined ? null : section.paragraphs.map((paragraph, n) => paragraphView(i18n, paragraph, n))}
        <p class="about__page" data-testid="about-page-of">
          {local(i18n, chrome.pageOf(page + 1, pages))}
        </p>
      </div>
      <div class="help__buttons about__buttons">
        <Button label={local(i18n, chrome.previous)} disabled={page === 0} {...button(0)} testId="about-previous" />
        <Button label={local(i18n, chrome.next)} disabled={page === pages - 1} {...button(1)} testId="about-next" />
        <Button label={local(i18n, chrome.close)} variant="primary" {...button(2)} testId="about-close" />
      </div>
    </div>
  );
}

export function AboutListPage({ i18n, binding }: { i18n: AppI18n; binding: FocusBinding }) {
  const zone = useZone(binding, binding.nav.top, 'rows');
  return <AboutListView i18n={i18n} item={(i) => zone.item(i)} />;
}

export function AboutInfoPage({ i18n, binding, page }: { i18n: AppI18n; binding: FocusBinding; page: AboutPage }) {
  const buttons = useZone(binding, binding.nav.top, 'actions');
  return <AboutInfoView i18n={i18n} version={page.version} button={(i) => buttons.item(i)} />;
}

export function AboutDocPage({ i18n, binding, page }: { i18n: AppI18n; binding: FocusBinding; page: AboutPage }) {
  const buttons = useZone(binding, binding.nav.top, 'actions');
  const doc = page.doc.value;
  return <AboutDocView i18n={i18n} doc={doc} page={page.page.value} pages={page.pages(doc)} button={(i) => buttons.item(i)} />;
}
