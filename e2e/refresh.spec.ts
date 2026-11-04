import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { nowTitles, ordered, rows } from './live-rows';
import { addXtreamAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * The refresh schedule (RELAY step 22a): while the app runs, it reads its guides and catalogs
 * again by itself. The page's clock is Playwright's: it flows in real time, and `fastForward`
 * jumps it, firing each timer that fell due once, as a TV waking after hours does. The mock and
 * the data workers keep the real clock, so the page is hours ahead of every stored time.
 */
const PLACEHOLDER = 'No guide for this channel';

interface Mock {
  readonly app: MockServer;
  /** The panel's `host:port`, typed the way a user would. */
  readonly host: string;
  /** Every request path the mock received, in order. */
  readonly requests: string[];
}

async function startMock(scenario: string | null): Promise<Mock> {
  const app = await mock({ now: () => Date.now(), scenario });
  const requests: string[] = [];
  app.addHook('onRequest', async (request) => {
    requests.push(request.url);
  });
  const host = (await listen(app)).replace(/^http:\/\//, '');
  return { app, host, requests };
}

/** Requests for the panel's guide, or for one of its lists. */
const count = (m: Mock, what: string): number => m.requests.filter((url) => url.indexOf(what) !== -1).length;

/** The page's clock (hours ahead of the real one once fast-forwarded). */
const pageNow = (page: Page): Promise<number> => page.evaluate(() => Date.now());

/** Every row on show has the mock guide's programme at the page's time, or the placeholder when it has none. */
async function expectGuideRows(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const before = await pageNow(page);
      const drawn = await rows(page);
      const after = await pageNow(page);
      return drawn.every((row) => {
        const titles = nowTitles(ordered[row.index]!, before - 60_000, after);
        return titles.length === 0 ? row.nowTitle === null && row.now === PLACEHOLDER : titles.indexOf(row.nowTitle ?? '') !== -1;
      });
    })
    .toBe(true);
}

test('reads a guide that failed at onboarding 2 h later, then the catalog and the guides again after 12 h', async ({ page }) => {
  const errors = trackErrors(page);
  const m = await startMock('no-xmltv');
  try {
    await page.clock.install();
    const remote = new RemoteDriver(page);
    const live = await addXtreamAndWatch(remote, { host: m.host, username: U, password: P }, 'locale=en-US');
    await settled(live);
    // The panel's guide is off: one refused request, and no row below the focus has a programme
    // (the focused row may show its panel's short EPG).
    expect(count(m, '/xmltv.php')).toBe(1);
    expect(count(m, 'action=get_live_streams')).toBe(1);
    const before = await rows(page);
    expect(before.length).toBeGreaterThan(5);
    for (const row of before.slice(1)) expect([row.name, row.nowTitle, row.now]).toEqual([ordered[row.index]!.name, null, PLACEHOLDER]);

    await test.step('2 h later the guide is read again, and the rows show it', async () => {
      // The panel turns its guide on; the app holds a failed guide back for 2 h (the unit tests
      // pin the limits). The first check (15 s after the screen opened) is still to come: it
      // fires once at the jump.
      m.app.mockState.scenario = null;
      await page.clock.fastForward('02:01:00');
      await expect.poll(() => count(m, '/xmltv.php')).toBe(2);
      await expectGuideRows(page);
      // The catalog was fresh: not read again.
      expect(count(m, 'action=get_live_streams')).toBe(1);
      await remote.expectFocus('live/channels/0');
    });

    await test.step('12 h after the start the catalog and the guides are read again; the screen stays where it was', async () => {
      await remote.go('DOWN', 'live/channels/1');
      await remote.go('DOWN', 'live/channels/2');
      await page.clock.fastForward('10:15:00');
      await expect.poll(() => count(m, 'action=get_live_streams')).toBe(2);
      await expect.poll(() => count(m, '/xmltv.php')).toBe(3);
      await settled(live);
      await expect(live).toHaveAttribute('data-status', 'ready');
      await remote.expectFocus('live/channels/2');
      await expectGuideRows(page);
    });
    expect(errors).toEqual([]);
  } finally {
    await m.app.close();
  }
});
