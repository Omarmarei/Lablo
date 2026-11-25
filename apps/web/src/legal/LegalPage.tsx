/**
 * `/terms` and `/privacy` (RELAY step 40d): the same words as the TV's Settings › "About Lablo"
 * (`@lablo/protocol/legal`, one source), as a plain page: no script, no cookie, nothing loaded
 * from another host. The language is the page's own (`lang` and `dir` on its root, since the
 * layout follows the browser's header alone); a link switches it. While the text is a draft
 * every page carries the mark.
 */
import type { ReactNode } from 'react';
import type { LegalDocId, LegalLang } from '@lablo/protocol/legal';
import { LEGAL_CHROME, LEGAL_CONTACT, LEGAL_DRAFT, LEGAL_DRAFT_MARK, LEGAL_UPDATED, legalDoc } from '@lablo/protocol/legal';
import { dirOf } from '../phone/lang';
import './legal.css';

/** The path of a document. */
export function legalPath(id: LegalDocId): string {
  return id === 'terms' ? '/terms' : '/privacy';
}

/** A paragraph with the contact address as a link: the address is left to right in both languages. */
function paragraph(text: string, n: number): ReactNode {
  const at = text.indexOf(LEGAL_CONTACT);
  if (at < 0) {
    return (
      <p key={n} className="legal__p">
        {text}
      </p>
    );
  }
  return (
    <p key={n} className="legal__p">
      {text.slice(0, at)}
      <a href={`mailto:${LEGAL_CONTACT}`} dir="ltr">
        {LEGAL_CONTACT}
      </a>
      {text.slice(at + LEGAL_CONTACT.length)}
    </p>
  );
}

export function LegalPage({ lang, id }: { readonly lang: LegalLang; readonly id: LegalDocId }): ReactNode {
  const chrome = LEGAL_CHROME[lang];
  const doc = legalDoc(lang, id);
  const other: LegalDocId = id === 'terms' ? 'privacy' : 'terms';
  const otherLang: LegalLang = lang === 'en' ? 'ar' : 'en';
  return (
    <main className="legal" lang={lang} dir={dirOf(lang)} data-testid="legal" data-doc={id} data-lang={lang}>
      <div className="legal__column">
        {LEGAL_DRAFT ? (
          <p className="legal__draft" data-testid="legal-draft">
            {LEGAL_DRAFT_MARK[lang]}
          </p>
        ) : null}
        <h1 className="legal__title" data-testid="legal-title">
          {doc.title}
        </h1>
        <p className="legal__meta">
          {chrome.updated}: <span dir="ltr">{LEGAL_UPDATED}</span>
        </p>
        <ul className="legal__nav">
          <li>
            <a href={`${legalPath(other)}?lang=${lang}`} data-testid="legal-other">
              {legalDoc(lang, other).title}
            </a>
          </li>
          <li>
            <a href={`${legalPath(id)}?lang=${otherLang}`} hrefLang={otherLang} lang={otherLang} data-testid="legal-switch" aria-label={chrome.switchLabel}>
              {chrome.switchTo}
            </a>
          </li>
        </ul>
        {doc.sections.map((section, n) => (
          <section key={n} className="legal__section" data-testid="legal-section">
            <h2 className="legal__heading">{section.heading}</h2>
            {section.paragraphs.map(paragraph)}
          </section>
        ))}
        <p className="legal__meta">
          {chrome.contact}:{' '}
          <a href={`mailto:${LEGAL_CONTACT}`} dir="ltr">
            {LEGAL_CONTACT}
          </a>
        </p>
      </div>
    </main>
  );
}
