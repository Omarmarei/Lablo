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
 * The guides screen (RELAY steps 22b2a and 22b2b) by keys, in English and Arabic: the live
 * screen's header "Settings", the settings screen's "TV guides", then guides added by their links
 * and read at once by the app's refresh scheduler, moved and removed from a row's menu, and links
 * that fail, each with why. The menu's time offset (step 24b) is in guide-offset.spec.ts, its
 * matches and the header's "Channels without a guide" (step 24c) in guide-matches.spec.ts. The
 * mock runs on the real clock, so its guide covers the browser's
 * "now". Every change is read back from the profile in IndexedDB.
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
/** The 1920x1080 canvas less its 5% title-safe margins (as live.spec.ts). */
const SAFE = { left: 96, top: 54, right: 1824, bottom: 1026 };
/** A row's text starts this close to the row's own edge: its 4 px border and 32 px padding, and some room. */
const EDGE = 48;

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

const LOCALES = [
  { locale: 'en-US', language: 'en', dir: 'ltr' },
  { locale: 'ar-SA', language: 'ar', dir: 'rtl' },
] as const;
type Language = (typeof LOCALES)[number]['language'];
type Action = 'up' | 'down' | 'offset' | 'matches' | 'remove' | 'cancel';

/**
 * What the screens say, written out here rather than read from the catalogs. ar-SA writes
 * Western digits (ADR-011).
 */
const SAYS: Record<
  Language,
  {
    readonly settings: string;
    readonly mine: string;
    readonly until: RegExp;
    readonly matched: string;
    readonly http404: string;
    readonly format: string;
    readonly listed: string;
    readonly actions: Record<Action, string>;
  }
> = {
  en: {
    settings: 'TV guides',
    mine: 'Added by you',
    until: /^Programmes until \w{3}, \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M$/,
    matched: 'Channels matched: 11 of 12 (92%)',
    http404: "Couldn't read it: the server answered with error 404.",
    format: "Couldn't read it: this link didn't give an XMLTV guide.",
    listed: 'This guide is already in the list.',
    actions: { up: 'Move up', down: 'Move down', offset: 'Time offset', matches: 'Matches', remove: 'Remove', cancel: 'Cancel' },
  },
  ar: {
    settings: 'أدلة التلفزيون',
    mine: 'أضفته أنت',
    until: /^البرامج حتى \S.*، \d{1,2}:\d{2} \S+$/,
    matched: 'القنوات المطابقة: 11 من 12 (92%)',
    http404: 'تعذّرت قراءته: ردّ الخادم برمز الخطأ 404.',
    format: 'تعذّرت قراءته: لم يُرجع هذا الرابط دليل XMLTV.',
    listed: 'هذا الدليل موجود في القائمة.',
    actions: { up: 'نقل إلى الأعلى', down: 'نقل إلى الأسفل', offset: 'فرق التوقيت', matches: 'المطابقة', remove: 'إزالة', cancel: 'إلغاء' },
  },
};

interface StoredGuides {
  readonly v: number;
  readonly guides: readonly { readonly id: string; readonly url: string }[];
}

/** The profile document as IndexedDB holds it. */
function storedProfile(page: Page): Promise<StoredGuides | null> {
  return page.evaluate(
    () =>
      new Promise<StoredGuides | null>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: unknown } | undefined;
            resolve(record === undefined ? null : (record.doc as StoredGuides));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The user's guides the profile holds, as `id url` lines. */
async function savedGuides(page: Page): Promise<string[]> {
  const saved = await storedProfile(page);
  // The guide list is the profile's since version 4 (step 22b).
  expect(saved?.v).toBeGreaterThanOrEqual(4);
  return (saved?.guides ?? []).map((g) => `${g.id} ${g.url}`);
}

/** An element's text without the isolates and marks the runtime puts around each argument. */
async function plainText(locator: Locator): Promise<string> {
  return stripIsolates((await locator.textContent()) ?? '');
}

/**
 * The guides the screen lists, in its order (`data-src`; `missing` for a row it counts but
 * doesn't draw). Read in one go: a row can go between two reads.
 */
function listed(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const count = Number(document.querySelector('[data-testid=guides]')?.getAttribute('data-count') ?? 0);
    const out: string[] = [];
    for (let i = 0; i < count; i++) out.push(document.querySelector(`[data-testid="guide-${i}"]`)?.getAttribute('data-src') ?? 'missing');
    return out;
  });
}

/** OK on the link field, the link typed on the desktop keyboard, OK again (the focus goes to "Add"). */
async function typeLink(remote: RemoteDriver, root: Locator, link: string): Promise<void> {
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', 'guides-link');
  await remote.page.keyboard.type(link);
  await remote.press('OK');
  await expect(root).toHaveAttribute('data-editing', '');
  await remote.expectFocus('guide-add/actions/0');
}

/** The focused row's place on the guides screen. */
async function focusedRow(remote: RemoteDriver): Promise<number> {
  const at = /^guides\/guides\/(\d+)$/.exec((await remote.focusPath()) ?? '');
  expect(at, 'the focus should be on a guide').not.toBeNull();
  return Number(at![1]);
}

/** UP from the focused row to "Add a guide", OK: the add form, its link field focused. */
async function openAddForm(remote: RemoteDriver): Promise<void> {
  const place = await focusedRow(remote);
  for (let i = 0; i <= place; i++) await remote.press('UP');
  await remote.expectFocus('guides/header/0');
  await remote.go('OK', 'guide-add/field/0');
}

/** The add form with `link`, then "Add": the new guide comes in at `place`, focused, and is read. */
async function addGuide(remote: RemoteDriver, root: Locator, link: string, place: number): Promise<void> {
  await openAddForm(remote);
  await typeLink(remote, root, link);
  await remote.go('OK', `guides/guides/${place}`);
  await expect(remote.page.getByTestId(`guide-${place}-link`)).toHaveText(link.replace(/\?.*$/, ''));
  await expect(remote.page.getByTestId(`guide-${place}`)).toHaveAttribute('data-kind', 'mine');
  await settled(root, 20_000);
}

/** OK on the guide at `place`: its menu, with `actions` in order. */
async function openMenu(remote: RemoteDriver, language: Language, place: number, actions: readonly Action[]): Promise<void> {
  const { page } = remote;
  await remote.expectFocus(`guides/guides/${place}`);
  await remote.go('OK', 'guide-menu/actions/0');
  const buttons = page.locator('[data-testid=guide-menu] .z-button');
  await expect(buttons).toHaveCount(actions.length);
  for (const [i, action] of actions.entries()) {
    await expect(buttons.nth(i)).toHaveAttribute('data-testid', `guide-menu-${action}`);
    await expect(buttons.nth(i)).toHaveText(SAYS[language].actions[action]);
  }
}

/** DOWN to `action` in the open menu, then OK. */
async function choose(remote: RemoteDriver, actions: readonly Action[], action: Action): Promise<void> {
  const index = actions.indexOf(action);
  for (let i = 0; i < index; i++) await remote.press('DOWN');
  await remote.expectFocus(`guide-menu/actions/${index}`);
  await remote.press('OK');
}

/**
 * Onboarding with the mock's Xtream login, UP to the header's "Guide", on to "Settings" at its
 * end, OK, then OK on "TV guides": the guides screen, settled, the focus on its first row.
 */
async function openGuides(remote: RemoteDriver, locale: string, language: Language, shots: boolean): Promise<Locator> {
  const { page } = remote;
  const live = await addXtreamAndWatch(remote, { host, username: U, password: P }, `locale=${locale}`);
  await settled(live);
  // UP from the list's first row: the header's "Guide" (step 23c); DOWN goes back to the list.
  // "Settings" is after it, at the header's end: on the left in Arabic.
  await remote.go('UP', 'live/header/0');
  await remote.go(language === 'ar' ? 'LEFT' : 'RIGHT', 'live/header/1');
  await remote.go(language === 'ar' ? 'LEFT' : 'RIGHT', 'live/header/2');
  if (shots) await shot(page, `live-header-${language}`);
  await remote.go('DOWN', 'live/channels/0');
  await remote.go('UP', 'live/header/2');
  await remote.go('OK', 'settings/items/0');
  await expect(page.getByTestId('settings-guides')).toContainText(SAYS[language].settings);
  if (shots) await shot(page, `settings-${language}`);
  await remote.go('OK', 'guides/guides/0');
  const root = page.getByTestId('settings-screen');
  await expect(root).toHaveAttribute('data-language', language);
  await expect(page.getByTestId('guides')).toHaveAttribute('data-status', 'ready');
  await settled(root);
  return root;
}

interface Layout {
  readonly scroll: readonly [number, number];
  readonly outside: string[];
  readonly cut: string[];
}

/** Every box inside the safe area, no page scroll, none of our texts cut (as live.spec.ts). */
function layout(page: Page): Promise<Layout> {
  return page.evaluate((safe) => {
    const name = (el: Element): string => `${el.className}: ${(el.textContent ?? '').slice(0, 40)}`;
    const boxes = '.settings__header, .settings__row, .guides__intro, .guides__row, .z-button, .z-dialog__panel, .z-field';
    const outside: string[] = [];
    for (const el of Array.from(document.querySelectorAll(boxes))) {
      const r = el.getBoundingClientRect();
      if (r.left < safe.left || r.top < safe.top || r.right > safe.right + 0.5 || r.bottom > safe.bottom + 0.5) outside.push(name(el));
    }
    const labels = '.settings__title, .guides__intro, .guides__link, .guides__owner, .guides__status, .guides__failure, .z-button__label, .z-dialog__title';
    const cut = Array.from(document.querySelectorAll(labels))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map(name);
    return { scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] as const, outside, cut };
  }, SAFE);
}

interface Span {
  readonly left: number;
  readonly right: number;
}

/** Where `locator`'s text is drawn (a Range over its contents: a flex item's own box is wider). */
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

/**
 * The row's link and status start on the screen's side (the right in Arabic: the link is
 * `dir=ltr`, yet sits on the right), the owner on the other.
 */
async function checkSides(page: Page, place: number, rtl: boolean): Promise<void> {
  const row = await boxSpan(page.getByTestId(`guide-${place}`));
  const link = await textSpan(page.getByTestId(`guide-${place}-link`));
  const owner = await textSpan(page.getByTestId(`guide-${place}`).locator('.guides__owner'));
  const status = await textSpan(page.getByTestId(`guide-${place}-status`).locator('span'));
  if (rtl) {
    expect(row.right - link.right).toBeLessThan(EDGE);
    expect(row.right - status.right).toBeLessThan(EDGE);
    expect(owner.left - row.left).toBeLessThan(EDGE);
    expect(owner.right).toBeLessThan(link.left);
  } else {
    expect(link.left - row.left).toBeLessThan(EDGE);
    expect(status.left - row.left).toBeLessThan(EDGE);
    expect(row.right - owner.right).toBeLessThan(EDGE);
    expect(owner.left).toBeGreaterThan(link.right);
  }
  // The header: the title on the screen's side, "Add a guide" on the other.
  const title = await textSpan(page.locator('[data-testid=guides] .settings__title'));
  const add = await boxSpan(page.getByTestId('guides-add'));
  expect(rtl ? add.right < title.left : add.left > title.right).toBe(true);
}

/** A read guide's status line: the programmes' end, then the match rate. */
async function checkRead(page: Page, language: Language, place: number): Promise<void> {
  const row = page.getByTestId(`guide-${place}`);
  await expect(row).toHaveAttribute('data-status', 'read', { timeout: 20_000 });
  expect([await row.getAttribute('data-matched'), await row.getAttribute('data-wanted'), await row.getAttribute('data-code')]).toEqual(['11', '12', '']);
  const [until, matched, ...rest] = (await plainText(page.getByTestId(`guide-${place}-status`))).split(' · ');
  expect(rest).toEqual([]);
  expect(until).toMatch(SAYS[language].until);
  expect(matched).toBe(SAYS[language].matched);
  await expect(page.getByTestId(`guide-${place}-failure`)).toHaveCount(0);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

test.describe('the guides screen by keys (pnpm dev, after onboarding)', () => {
  for (const { locale, language, dir } of LOCALES) {
    const rtl = dir === 'rtl';

    test(`adds two guides, moves one and removes one in ${language} (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      const remote = new RemoteDriver(page);
      const root = await openGuides(remote, locale, language, true);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);

      // The panel's own guide, read at onboarding: its host and path, never the login.
      const panel = page.getByTestId('guide-0');
      await expect(panel).toHaveAttribute('data-kind', 'source');
      await expect(panel).toHaveAttribute('data-src', 's1:xmltv');
      await expect(page.getByTestId('guide-0-link')).toHaveText(`${host}/xmltv.php`);
      await expect(page.getByTestId('guide-0-link')).toHaveAttribute('dir', 'ltr');
      await checkRead(page, language, 0);
      await expect(page.getByTestId('guides-list')).not.toContainText(P);
      // OK on a source's guide: its menu has the time offset (step 24b; guide-offset.spec.ts sets
      // one) and, as it was read, its matches (step 24c). Back closes it.
      await openMenu(remote, language, 0, ['offset', 'matches', 'cancel']);
      await remote.go('BACK', 'guides/guides/0');
      await expect(page.getByTestId('guide-menu')).toHaveCount(0);
      expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
      await shot(page, `guides-${language}`);

      // "Add a guide": the mock's other link to the same guide. Its buttons read in the screen's
      // direction ("Add" first: on the right in Arabic), and the remote's arrows follow it.
      await openAddForm(remote);
      await typeLink(remote, root, `${host}/epg/guide.xml`);
      const confirm = await boxSpan(page.getByTestId('guide-add-confirm'));
      const cancel = await boxSpan(page.getByTestId('guide-add-cancel'));
      expect(rtl ? confirm.left > cancel.right : confirm.right < cancel.left).toBe(true);
      await remote.go(rtl ? 'LEFT' : 'RIGHT', 'guide-add/actions/1');
      await remote.go(rtl ? 'RIGHT' : 'LEFT', 'guide-add/actions/0');
      expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
      await shot(page, `guides-add-${language}`);
      // The user's guide comes first, with the focus on it, and is read at once.
      await remote.go('OK', 'guides/guides/0');
      await expect(page.getByTestId('guide-0')).toHaveAttribute('data-src', 'u~g1');
      await expect(page.getByTestId('guide-0')).toContainText(SAYS[language].mine);
      await settled(root, 20_000);
      await checkRead(page, language, 0);
      expect(await listed(page)).toEqual(['u~g1', 's1:xmltv']);
      expect(await savedGuides(page)).toEqual([`g1 http://${host}/epg/guide.xml`]);
      await checkSides(page, 0, rtl);
      await shot(page, `guides-added-${language}`);

      // A second guide (the gzipped one) goes after the user's first, focused, read at once.
      await addGuide(remote, root, `${host}/epg/guide.xml.gz`, 1);
      await checkRead(page, language, 1);
      expect(await listed(page)).toEqual(['u~g1', 'u~g2', 's1:xmltv']);
      expect(await savedGuides(page)).toEqual([`g1 http://${host}/epg/guide.xml`, `g2 http://${host}/epg/guide.xml.gz`]);

      // The second one's menu: Move up (it can't go down past the panel's), Time offset, Matches, Remove, Cancel.
      await openMenu(remote, language, 1, ['up', 'offset', 'matches', 'remove', 'cancel']);
      await expect(page.getByTestId('guide-menu')).toContainText(`${host}/epg/guide.xml.gz`);
      // Its buttons are as wide as the dialog, each label on the screen's side (the right in Arabic).
      const menuBox = await boxSpan(page.locator('[data-testid=guide-menu] .guides__menu'));
      for (const action of ['up', 'offset', 'matches', 'remove', 'cancel'] as const) {
        const button = await boxSpan(page.getByTestId(`guide-menu-${action}`));
        expect([button.left, button.right]).toEqual([menuBox.left, menuBox.right]);
        const label = await textSpan(page.getByTestId(`guide-menu-${action}`).locator('.z-button__label'));
        expect(rtl ? button.right - label.right : label.left - button.left).toBeLessThan(EDGE);
      }
      expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
      await shot(page, `guides-menu-${language}`);
      // Move up: it goes first, with the focus, still read (a move downloads nothing).
      await choose(remote, ['up', 'offset', 'matches', 'remove', 'cancel'], 'up');
      await remote.expectFocus('guides/guides/0');
      await expect.poll(() => listed(page)).toEqual(['u~g2', 'u~g1', 's1:xmltv']);
      await settled(root, 20_000);
      expect(await savedGuides(page)).toEqual([`g2 http://${host}/epg/guide.xml.gz`, `g1 http://${host}/epg/guide.xml`]);
      await checkRead(page, language, 0);
      await checkRead(page, language, 1);

      // The first one's menu: Move down, Time offset, Matches, Remove, Cancel. Move down puts it back, the focus with it.
      await openMenu(remote, language, 0, ['down', 'offset', 'matches', 'remove', 'cancel']);
      await choose(remote, ['down', 'offset', 'matches', 'remove', 'cancel'], 'down');
      await remote.expectFocus('guides/guides/1');
      await expect.poll(() => listed(page)).toEqual(['u~g1', 'u~g2', 's1:xmltv']);
      await settled(root, 20_000);
      expect(await savedGuides(page)).toEqual([`g1 http://${host}/epg/guide.xml`, `g2 http://${host}/epg/guide.xml.gz`]);

      // Cancel, and Back, close the menu and change nothing.
      await openMenu(remote, language, 1, ['up', 'offset', 'matches', 'remove', 'cancel']);
      await choose(remote, ['up', 'offset', 'matches', 'remove', 'cancel'], 'cancel');
      await remote.expectFocus('guides/guides/1');
      await openMenu(remote, language, 1, ['up', 'offset', 'matches', 'remove', 'cancel']);
      await remote.go('BACK', 'guides/guides/1');
      await expect(page.getByTestId('guide-menu')).toHaveCount(0);
      await settled(root);
      expect(await listed(page)).toEqual(['u~g1', 'u~g2', 's1:xmltv']);

      // Remove (no confirmation: the link is all it takes to add it again): the row goes, the
      // focus stays on its place (now the panel's guide), and the profile lists one guide.
      await openMenu(remote, language, 1, ['up', 'offset', 'matches', 'remove', 'cancel']);
      await choose(remote, ['up', 'offset', 'matches', 'remove', 'cancel'], 'remove');
      await expect.poll(() => listed(page)).toEqual(['u~g1', 's1:xmltv']);
      await remote.expectFocus('guides/guides/1');
      await settled(root, 20_000);
      expect(await savedGuides(page)).toEqual([`g1 http://${host}/epg/guide.xml`]);
      await checkRead(page, language, 0);
      await checkRead(page, language, 1);
      expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
      await shot(page, `guides-removed-${language}`);

      // Back: the settings screen, then the live screen on its header, then its list.
      await remote.go('BACK', 'settings/items/0');
      await remote.go('BACK', 'live/header/2');
      await remote.go('DOWN', 'live/channels/0');
      expect(errors).toEqual([]);
    });

    test(`shows why a link failed, and refuses one already listed, in ${language} (${locale})`, async ({ page }) => {
      test.setTimeout(90_000);
      const errors = trackErrors(page);
      const remote = new RemoteDriver(page);
      const root = await openGuides(remote, locale, language, false);

      // A link the server doesn't know: error 404, said on the row.
      await addGuide(remote, root, `${host}/epg/missing.xml`, 0);
      const missing = page.getByTestId('guide-0');
      await expect(missing).toHaveAttribute('data-status', 'failed');
      await expect(missing).toHaveAttribute('data-code', 'http');
      expect(await plainText(page.getByTestId('guide-0-failure'))).toBe(SAYS[language].http404);
      await expect(page.getByTestId('guide-0-status')).toHaveText('');

      // A playlist where a guide should be: not an XMLTV guide. Its row shows no login.
      await addGuide(remote, root, `${host}/get.php?username=${U}&password=${P}&type=m3u_plus`, 1);
      const playlist = page.getByTestId('guide-1');
      await expect(playlist).toHaveAttribute('data-status', 'failed');
      await expect(playlist).toHaveAttribute('data-code', 'format');
      expect(await plainText(page.getByTestId('guide-1-failure'))).toBe(SAYS[language].format);
      await expect(page.getByTestId('guides-list')).not.toContainText(P);
      expect(await listed(page)).toEqual(['u~g1', 'u~g2', 's1:xmltv']);
      expect(await savedGuides(page)).toEqual([`g1 http://${host}/epg/missing.xml`, `g2 http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus`]);
      // The failure lines start on the screen's side too.
      const row = await boxSpan(playlist);
      const failure = await textSpan(page.getByTestId('guide-1-failure'));
      expect(rtl ? row.right - failure.right : failure.left - row.left).toBeLessThan(EDGE);
      expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
      await shot(page, `guides-failed-${language}`);

      // The panel's own guide is on the screen already: its link is refused on the field, and
      // Back closes the form with nothing added.
      await openAddForm(remote);
      await typeLink(remote, root, `${host}/xmltv.php?username=${U}&password=${P}`);
      await remote.go('OK', 'guide-add/field/0');
      await expect(page.getByTestId('guide-add-link')).toContainText(SAYS[language].listed);
      expect(await layout(page)).toEqual({ scroll: [1920, 1080], outside: [], cut: [] });
      await shot(page, `guides-listed-${language}`);
      await remote.go('BACK', 'guides/header/0');
      await expect(page.getByTestId('guide-add')).toHaveCount(0);
      await settled(root);
      expect(await listed(page)).toEqual(['u~g1', 'u~g2', 's1:xmltv']);
      expect((await savedGuides(page)).length).toBe(2);
      expect(errors).toEqual([]);
    });
  }
});
