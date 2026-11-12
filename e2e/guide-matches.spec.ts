import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { stripIsolates } from '../packages/core/src/bidi';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Match diagnostics (RELAY step 24c) by keys, in English and Arabic: the guides screen's menu on
 * the panel's own guide, "Matches" (the mock's guide matches 11 of its 12 live channels: 10 by
 * the panel's channel ID, "Lablo Sports Test FHD" by its name without tags, none tied, 9 XMLTV
 * channels declared and used), then the header's "Channels without a guide: 1", whose list has
 * the one channel the guide lacks, "18+ Test Pattern", with its source and category. The mock
 * runs on the real clock (as guides.spec.ts).
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins (as live.spec.ts). */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };
/** A row's text starts this close to its own edge: its 4 px border and 32 px padding, and some room. */
const EDGE = 48;
/** The mock's channel without a guide (catalog.yaml, id 109) and its category. */
const UNMATCHED = { key: 'x:s1:live:109', name: '18+ Test Pattern', category: '18+ Test (lock check)' };

const SAYS = {
  en: {
    unmatched: 'Channels without a guide: 1',
    actions: ['Time offset', 'Matches', 'Cancel'],
    title: 'Matches',
    link: 'Link: ',
    matched: 'Channels matched: 11 of 12 (92%)',
    lines: [
      ['id', 'By channel ID', 0],
      ['xtream-id', "By the panel's channel ID", 10],
      ['name', 'By name', 0],
      ['match-name', 'By name without tags such as HD, FHD', 1],
      ['override', 'Set by you', 0],
      ['ties', 'Ties (another guide channel fit as well)', 0],
      ['declared', 'Channels in the guide', 9],
      ['used', 'Guide channels in use', 9],
    ],
    close: 'Close',
    listTitle: 'Channels without a guide',
    count: '1 channel',
    intro: 'No guide in your list has programmes for these live channels.',
    from: 'From ',
  },
  ar: {
    unmatched: 'قنوات بلا دليل: 1',
    actions: ['فرق التوقيت', 'المطابقة', 'إلغاء'],
    title: 'المطابقة',
    link: 'الرابط: ',
    matched: 'القنوات المطابقة: 11 من 12 (92%)',
    lines: [
      ['id', 'حسب معرّف القناة', 0],
      ['xtream-id', 'حسب معرّف القناة في اللوحة', 10],
      ['name', 'حسب الاسم', 0],
      ['match-name', 'حسب الاسم دون علامات مثل HD, FHD', 1],
      ['override', 'حدّدتها أنت', 0],
      ['ties', 'حالات التعادل (قناة أخرى في الدليل مناسبة أيضًا)', 0],
      ['declared', 'القنوات في الدليل', 9],
      ['used', 'قنوات الدليل المستخدمة', 9],
    ],
    close: 'إغلاق',
    listTitle: 'قنوات بلا دليل',
    count: 'قناة واحدة',
    intro: 'لا يحتوي أي دليل في قائمتك على برامج لهذه القنوات المباشرة.',
    from: 'من ',
  },
} as const;
type Language = keyof typeof SAYS;

let app: MockServer;
/** The mock's `host:port`, typed the way a user would (no `http://`). */
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

async function plainText(locator: Locator): Promise<string> {
  return stripIsolates((await locator.textContent()) ?? '');
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

/** The first source's name as the profile keeps it (the panel's host, from onboarding). */
function sourceName(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { doc: { sources: { name: string }[] } }).doc.sources[0]!.name);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** Onboarding, then the header's "Settings", "TV guides": the guides screen settled, the panel's guide focused. */
async function openGuides(remote: RemoteDriver, locale: string, language: Language): Promise<Locator> {
  const { page } = remote;
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
  await settled(live);
  await remote.go('UP', 'live/header/0');
  await remote.go(language === 'ar' ? 'LEFT' : 'RIGHT', 'live/header/1');
  await remote.go(language === 'ar' ? 'LEFT' : 'RIGHT', 'live/header/2');
  await remote.go(language === 'ar' ? 'LEFT' : 'RIGHT', 'live/header/3');
  await remote.go('OK', 'settings/items/0');
  await remote.go('OK', 'guides/guides/0');
  const root = page.getByTestId('settings-screen');
  await expect(page.getByTestId('guides')).toHaveAttribute('data-status', 'ready');
  await settled(root);
  await expect(page.getByTestId('guide-0')).toHaveAttribute('data-src', 's1:xmltv');
  await expect(page.getByTestId('guide-0')).toHaveAttribute('data-status', 'read');
  return root;
}

interface Layout {
  readonly outside: string[];
  readonly cut: string[];
}

/** Every box of `boxes` inside the safe area, and none of `labels` cut. */
function layout(page: Page, boxes: string, labels: string): Promise<Layout> {
  return page.evaluate(
    ({ safe, boxes, labels }) => {
      const name = (el: Element): string => `${el.className}: ${(el.textContent ?? '').slice(0, 40)}`;
      const outside: string[] = [];
      for (const el of Array.from(document.querySelectorAll(boxes))) {
        const r = el.getBoundingClientRect();
        if (r.left < safe.left || r.top < safe.top || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(name(el));
      }
      const cut = Array.from(document.querySelectorAll(labels))
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map(name);
      return { outside, cut };
    },
    { safe: SAFE, boxes, labels },
  );
}

interface Span {
  readonly left: number;
  readonly right: number;
}

/** Where an element's text is drawn (a Range over its contents). */
function textSpan(locator: Locator): Promise<Span> {
  return locator.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right };
  });
}

async function boxSpan(locator: Locator): Promise<Span> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { left: box!.x, right: box!.x + box!.width };
}

/** The matches dialog's lines as drawn, read in one go. */
function readLines(page: Page): Promise<{ id: string; n: string; label: string; value: string; line: Span; labelAt: Span; valueAt: Span }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid=guide-matches] .matches__line')).map((el) => {
      const span = (node: Element): { left: number; right: number } => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        return { left: r.left, right: r.right };
      };
      const box = el.getBoundingClientRect();
      const label = el.querySelector('.matches__label')!;
      const value = el.querySelector('.matches__value')!;
      return {
        id: (el.getAttribute('data-testid') ?? '').replace('guide-matches-', ''),
        n: el.getAttribute('data-n') ?? '',
        label: label.textContent ?? '',
        value: value.textContent ?? '',
        line: { left: box.left, right: box.right },
        labelAt: span(label),
        valueAt: span(value),
      };
    }),
  );
}

test.describe('match diagnostics by keys (pnpm dev, after onboarding)', () => {
  for (const [locale, language, dir] of [
    ['en-US', 'en', 'ltr'],
    ['ar-SA', 'ar', 'rtl'],
  ] as const) {
    const rtl = dir === 'rtl';
    const says = SAYS[language];

    test(`shows the panel's guide's matches, then the channel no guide has (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      const remote = new RemoteDriver(page);
      const root = await openGuides(remote, locale, language);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);

      // The header: "Add a guide", then the count of the channels without a guide, at its end.
      await expect(page.getByTestId('guides')).toHaveAttribute('data-unmatched', '1');
      expect(await plainText(page.getByTestId('guides-unmatched'))).toBe(says.unmatched);
      const title = await textSpan(page.locator('[data-testid=guides] .settings__title'));
      const add = await boxSpan(page.getByTestId('guides-add'));
      const count = await boxSpan(page.getByTestId('guides-unmatched'));
      if (rtl) expect(count.right < add.left && add.right < title.left).toBe(true);
      else expect(title.right < add.left && add.right < count.left).toBe(true);
      expect(await layout(page, '.settings__header, .z-button', '.settings__title, .z-button__label')).toEqual({ outside: [], cut: [] });

      // The panel's guide's menu: Time offset, Matches, Cancel.
      await remote.go('OK', 'guide-menu/actions/0');
      const buttons = page.locator('[data-testid=guide-menu] .z-button');
      await expect(buttons).toHaveCount(3);
      expect(await buttons.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))).toEqual(['guide-menu-offset', 'guide-menu-matches', 'guide-menu-cancel']);
      await expect(buttons).toHaveText([...says.actions]);
      await remote.go('DOWN', 'guide-menu/actions/1');
      await remote.go('OK', 'guide-matches/actions/0');
      await expect(page.getByTestId('guide-menu')).toHaveCount(0);

      // Its matches, from the summary the refresh stored.
      const dialog = page.getByTestId('guide-matches');
      await expect(dialog.locator('.z-dialog__title')).toHaveText(says.title);
      expect(await plainText(dialog.locator('.z-dialog__message'))).toBe(`${says.link}${host}/xmltv.php`);
      await expect(dialog).not.toContainText(P);
      expect(await plainText(page.getByTestId('guide-matches-rate'))).toBe(says.matched);
      const lines = await readLines(page);
      expect(lines.map((l) => [l.id, stripIsolates(l.label), Number(l.n)])).toEqual(says.lines.map((l) => [...l]));
      expect(lines.map((l) => l.value)).toEqual(says.lines.map((l) => String(l[2])));
      // Each label on the screen's side, its number at the line's other end.
      for (const l of lines) {
        if (rtl) {
          expect(l.line.right - l.labelAt.right, l.id).toBeLessThan(1);
          expect(l.valueAt.left - l.line.left, l.id).toBeLessThan(1);
        } else {
          expect(l.labelAt.left - l.line.left, l.id).toBeLessThan(1);
          expect(l.line.right - l.valueAt.right, l.id).toBeLessThan(1);
        }
      }
      expect(await layout(page, '.z-dialog__panel, .matches__line, .z-button', '.z-dialog__title, .z-dialog__message, .matches__rate, .matches__label, .matches__value, .z-button__label')).toEqual({
        outside: [],
        cut: [],
      });
      await expect(page.getByTestId('guide-matches-close')).toHaveText(says.close);
      await shot(page, `guide-matches-${language}`);
      // OK on Close, and Back, close it on the same row.
      await remote.go('OK', 'guides/guides/0');
      await expect(dialog).toHaveCount(0);
      await remote.go('OK', 'guide-menu/actions/0');
      await remote.go('DOWN', 'guide-menu/actions/1');
      await remote.go('OK', 'guide-matches/actions/0');
      await remote.go('BACK', 'guides/guides/0');
      await expect(dialog).toHaveCount(0);

      // The header's second button: the list of the channels no guide has.
      await remote.go('UP', 'guides/header/0');
      await remote.go(rtl ? 'LEFT' : 'RIGHT', 'guides/header/1');
      await expect(page.getByTestId('guides-unmatched')).toHaveAttribute('data-state', 'focused');
      await expect(page.getByTestId('guides-add')).toHaveAttribute('data-state', 'idle');
      await remote.go('OK', 'unmatched/channels/0');
      const list = page.getByTestId('unmatched');
      await expect(list).toHaveAttribute('data-status', 'ready');
      await settled(root);
      await expect(list).toHaveAttribute('data-count', '1');
      await expect(list.locator('.settings__title')).toHaveText(says.listTitle);
      expect(await plainText(page.getByTestId('unmatched-count'))).toBe(says.count);
      await expect(list.locator('.guides__intro')).toHaveText(says.intro);
      await expect(list.locator('.unmatched__row')).toHaveCount(1);
      const row = page.getByTestId('unmatched-0');
      await expect(row).toHaveAttribute('data-key', UNMATCHED.key);
      await expect(row).toHaveAttribute('data-src', 's1');
      await expect(row).toHaveAttribute('data-state', 'focused');
      await expect(row.locator('.unmatched__name')).toHaveText(UNMATCHED.name);
      await expect(row.locator('.unmatched__name')).toHaveAttribute('dir', 'auto');
      const name = await sourceName(page);
      expect(await plainText(row.locator('.unmatched__where'))).toBe(`${says.from}${name} · ${UNMATCHED.category}`);
      await expect(row.locator('.unmatched__category')).toHaveAttribute('translate', 'no');
      // The row is 88 px (UNMATCHED.rowHeight); the name and the line under it on the screen's side.
      expect((await row.boundingBox())!.height).toBe(88);
      const rowAt = await boxSpan(row);
      for (const part of ['.unmatched__name', '.unmatched__where']) {
        const at = await textSpan(row.locator(part));
        expect(rtl ? rowAt.right - at.right : at.left - rowAt.left, part).toBeLessThan(EDGE);
      }
      const head = await textSpan(list.locator('.settings__title'));
      const counted = await textSpan(page.getByTestId('unmatched-count'));
      expect(rtl ? counted.right < head.left : counted.left > head.right).toBe(true);
      expect(
        await layout(page, '.settings__header, .guides__intro, .unmatched__row', '.settings__title, .unmatched__count, .guides__intro, .unmatched__name, .unmatched__where'),
      ).toEqual({ outside: [], cut: [] });
      await shot(page, `unmatched-${language}`);
      // The keys stay on the one row; OK opens the manual mapping (step 24e, guide-mapping.spec.ts), Back comes back.
      await remote.press('DOWN');
      await remote.expectFocus('unmatched/channels/0');
      await remote.go('OK', 'guide-map/search/0');
      await remote.go('BACK', 'unmatched/channels/0');

      // Back: the header's button, the settings, the live screen.
      await remote.go('BACK', 'guides/header/1');
      await expect(list).toHaveCount(0);
      await remote.go('BACK', 'settings/items/0');
      await remote.go('BACK', 'live/header/3');
      expect(errors).toEqual([]);
    });
  }

  test('shows only our strings, bracketed, in the pseudo-locale (en-XA)', async ({ page }) => {
    test.setTimeout(90_000);
    const remote = new RemoteDriver(page);
    const root = await openGuides(remote, 'en-XA', 'en');
    await expect(root).toHaveAttribute('data-language', 'pseudo');
    await expect(page.getByTestId('guides')).toHaveAttribute('data-unmatched', '1');
    expect(await unbracketed(page)).toEqual([]);
    await remote.go('OK', 'guide-menu/actions/0');
    await remote.go('DOWN', 'guide-menu/actions/1');
    await remote.go('OK', 'guide-matches/actions/0');
    expect(await unbracketed(page)).toEqual([]);
    await remote.go('BACK', 'guides/guides/0');
    await remote.go('UP', 'guides/header/0');
    await remote.go('RIGHT', 'guides/header/1');
    await remote.go('OK', 'unmatched/channels/0');
    await expect(page.getByTestId('unmatched')).toHaveAttribute('data-status', 'ready');
    await settled(root);
    expect(await unbracketed(page)).toEqual([]);
    // The manual mapping's picker (step 24e): the guide's channels, ids and links are data.
    await remote.go('OK', 'guide-map/search/0');
    await expect(page.getByTestId('mapping')).toHaveAttribute('data-status', 'ready');
    await settled(root);
    await expect(page.locator('[data-testid=mapping-1] .mapping__name')).toHaveCount(1);
    expect(await unbracketed(page)).toEqual([]);
  });
});

/** The settings screens' texts that are neither bracketed (ours, en-XA) nor data, nor the numbers. */
function unbracketed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid=settings-screen]')!;
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
