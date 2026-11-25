import type { ReadonlySignal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Navigator } from '@lablo/ui';
import type { LegalDocId } from '@lablo/protocol/legal';
import { LEGAL_DOCS } from '@lablo/protocol/legal';

/**
 * Settings › "About Lablo" (RELAY step 40d): a list of three rows (what Lablo is and its version,
 * the terms of use, the privacy policy). The first opens a short page with "Close"; the other two
 * open the document one section to a page, with "Previous", "Next" and "Close" (the section's
 * heading is the page's title, "Page 2 of 6" under it). Back closes a page, then the list.
 *
 * The words are `@lablo/protocol/legal` (one source with the web pages): it loads with settings.js,
 * never in main.js. Both languages have the same sections (a unit test pins it), so the page count
 * is read from English.
 *
 * Main-safe code as the settings are: no `trim`, `.sort(`, regex or object spread.
 */

export const ABOUT_SCREEN = 'about';
export const ABOUT_INFO_SCREEN = 'about-info';
export const ABOUT_DOC_SCREEN = 'about-doc';

export type AboutRow = 'info' | LegalDocId;

/** The list's rows in order. */
export const ABOUT_ROWS: readonly AboutRow[] = ['info', 'terms', 'privacy'];

/** The document pages' buttons, in order. */
export const DOC_BUTTONS = ['previous', 'next', 'close'] as const;

export interface AboutOptions {
  readonly nav: Navigator;
  /** The app's version (main's `__APP_VERSION__`); without it the info page shows none. */
  readonly version?: string;
}

export interface AboutPage {
  readonly version: string | null;
  /** The document on the open document page. */
  readonly doc: ReadonlySignal<LegalDocId>;
  /** The section on the open document page, from 0. */
  readonly page: ReadonlySignal<number>;
  /** The pages of a document. */
  pages(doc: LegalDocId): number;
  /** Opens the list. */
  open(): void;
}

export function createAboutPage(options: AboutOptions): AboutPage {
  const { nav } = options;
  const doc = signal<LegalDocId>('terms');
  const page = signal(0);
  const pages = (id: LegalDocId): number => LEGAL_DOCS.en[id].sections.length;
  const openDoc = (id: LegalDocId): void => {
    doc.value = id;
    page.value = 0;
    nav.push({
      id: ABOUT_DOC_SCREEN,
      zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: DOC_BUTTONS.length }],
      onSelect: (focus) => {
        // The two arrows stop at the ends (their buttons are drawn dimmed there).
        if (focus.index === 0) {
          if (page.peek() > 0) page.value = page.peek() - 1;
        } else if (focus.index === 1) {
          if (page.peek() < pages(doc.peek()) - 1) page.value = page.peek() + 1;
        } else nav.pop();
      },
    });
  };
  const openInfo = (): void => {
    nav.push({ id: ABOUT_INFO_SCREEN, zones: [{ kind: 'list', id: 'actions', axis: 'horizontal', count: 1 }], onSelect: () => nav.pop() });
  };
  return {
    version: options.version === undefined ? null : options.version,
    doc,
    page,
    pages,
    open(): void {
      nav.push({
        id: ABOUT_SCREEN,
        zones: [{ kind: 'list', id: 'rows', axis: 'vertical', count: ABOUT_ROWS.length }],
        onSelect: (focus) => {
          const row = ABOUT_ROWS[focus.index];
          if (row === 'info') openInfo();
          else if (row !== undefined) openDoc(row);
        },
      });
    },
  };
}
