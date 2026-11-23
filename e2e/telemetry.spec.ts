import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { diagRequestSchema, readTelemetryEvents, telemetryBatchSchema } from '@lablo/protocol';
import { devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { DIAG_STAND_IN_CODE, doc, startConfigServer } from './config-server';
import { addM3uAndWatch, settled, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';
import { SETTINGS_FIRST, settingsRow, toSettingsRow } from './settings-rows';

/**
 * Telemetry in the app (RELAY step 33b1), against the stand-in API on the test's config server
 * (`?api=`): the start's events (`app_start`, `capability`) are recorded at the start's first
 * screen, and sent from the live screen on. Step 33b2 adds the events of use: onboarding's
 * playlist read (`ingest_done`), its guide read and their match (`epg_match`), and a play's
 * result (`play_result`). The test hook's `sendTelemetry()` sends now instead of
 * 60 s on. The dev app reports `platform: 'browser'`, which the real API refuses, so the batch is
 * read here with the server's own schema, the platform swapped. The playlist's link carries a
 * login, and no post may hold it, the stand-in's host or port, or the link. Step 33b3 adds
 * Settings' "Usage and crash reports" switch, in English and Arabic (screenshots in
 * artifacts/screenshots).
 */
const SHOTS = path.resolve(import.meta.dirname, '../artifacts/screenshots');
const USER = 'tvuser33b';
const PASS = 'tvpass33b1';
const PLAYLIST = '#EXTM3U\n#EXTINF:-1 tvg-id="news" group-title="News",Family News\nhttp://127.0.0.1:9/live/1.ts\n#EXTINF:-1 tvg-id="films" group-title="Films",Film Night\nhttp://127.0.0.1:9/live/2.ts\n';
const LIST_PATH = `/list.m3u?username=${USER}&password=${PASS}`;
/** The guide the step-33b2 playlist names (`url-tvg`), with the same login. */
const GUIDE_PATH = `/guide.xml?username=${USER}&password=${PASS}`;

/** The playlist naming its guide on the stand-in: the guide has the first channel only. */
function guidedPlaylist(origin: string): string {
  return PLAYLIST.replace('#EXTM3U\n', `#EXTM3U url-tvg="${origin}${GUIDE_PATH}"\n`);
}

/** XMLTV's time: `YYYYMMDDhhmmss +0000`. */
function xmltvTime(ms: number): string {
  return `${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;
}

/** A guide for the channel `news`: hourly programmes from 12 hours ago to 36 hours on. */
function guideXml(): string {
  const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv>', '<channel id="news"><display-name>Family News</display-name></channel>'];
  for (let at = hour - 12 * 3_600_000; at < hour + 36 * 3_600_000; at += 3_600_000) {
    lines.push(`<programme start="${xmltvTime(at)}" stop="${xmltvTime(at + 3_600_000)}" channel="news"><title>Bulletin</title></programme>`);
  }
  lines.push('</tv>');
  return lines.join('\n');
}

async function withServer(config: Record<string, unknown>, run: (server: ConfigServer) => Promise<void>, playlist: (origin: string) => string = () => PLAYLIST): Promise<void> {
  const server = await startConfigServer(devSignedAnswer(doc(config)));
  server.file(LIST_PATH, playlist(server.origin), 'audio/x-mpegurl');
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

/** Onboarding with the stand-in's playlist (in `locale`, else the browser's), then the live screen. */
async function onboard(page: Page, server: ConfigServer, locale: string | null = null): Promise<void> {
  const remote = new RemoteDriver(page);
  await addM3uAndWatch(remote, `${server.origin.replace(/^http:\/\//, '')}${LIST_PATH}`, `api=${server.origin}${locale === null ? '' : `&locale=${locale}`}`);
}

function sendNow(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__LABLO_TEST__!.sendTelemetry());
}

interface Batch {
  installId: string;
  platform: string;
  appVersion: string;
  events: { kind: string; [field: string]: unknown }[];
}

/** A post as the server reads it: every event kept, the envelope valid with a TV's platform. */
function serverRead(body: string): Batch {
  const batch = JSON.parse(body) as Batch;
  expect(batch.platform).toBe('browser');
  expect(telemetryBatchSchema.safeParse({ ...batch, platform: 'webos' }).success).toBe(true);
  expect(readTelemetryEvents(batch.events).dropped).toBe(0);
  return batch;
}

/** Every string in a parsed body (keys and values): where a URL or a name would be. */
function stringsOf(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, into);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, v] of Object.entries(value)) {
      into.push(key);
      stringsOf(v, into);
    }
  }
  return into;
}

/** No post holds the playlist's login, its link, or the stand-in's host and port (`bodies`: the telemetry posts, else the reports). */
function expectNothingOfTheSource(server: ConfigServer, bodies: readonly string[] = server.telemetry.posts): void {
  const port = new URL(server.origin).port;
  for (const body of bodies) {
    for (const secret of [USER, PASS, 'list.m3u', '127.0.0.1', 'localhost', 'Family News', 'http']) expect(body).not.toContain(secret);
    // The port only among the strings: a timestamp's digits could hold it by chance.
    for (const text of stringsOf(JSON.parse(body))) expect(text).not.toContain(port);
  }
}

/** The `telemetry.*` records in the app's `kv`. */
function telemetryKv(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const found: Record<string, unknown> = {};
          const tx = db.transaction('kv');
          const store = tx.objectStore('kv');
          for (const key of ['telemetry.id', 'telemetry.queue', 'telemetry.capability']) {
            const req = store.get(key);
            req.onsuccess = () => {
              if (req.result !== undefined) found[key] = req.result;
            };
          }
          tx.oncomplete = () => {
            db.close();
            resolve(found);
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/** The stored profile's switch: on unless its document says `telemetry: false`. */
function storedSwitch(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { doc: Record<string, unknown> }).doc['telemetry'] !== false);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The stored profile's `telemetry` switch set off from the page, as a restored backup brings an "off" back. */
function switchOff(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('profile', 'readwrite');
          const store = tx.objectStore('profile');
          const req = store.get('current');
          req.onsuccess = () => {
            const record = req.result as { doc: Record<string, unknown> };
            record.doc['telemetry'] = false;
            // (The store's key is the record's own `id`.)
            store.put(record);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('aborted'));
        };
      }),
  );
}

/** The element's text fits its box (no ellipsis): our real words must, in English and Arabic. */
function fits(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector<HTMLElement>(`[data-testid=${id}]`)!;
    return el.scrollWidth <= el.clientWidth + 1;
  }, testId);
}

/** Errors but the stand-in's refusals (Chromium logs each non-2xx answer). */
function realErrors(errors: string[]): string[] {
  return errors.filter((e) => !/the server responded with a status of 50[03]/.test(e));
}

test("posts the start's events from the live screen, which the server reads whole, with nothing of the source in them", async ({ page }) => {
  const errors = trackErrors(page);
  await withServer({}, async (server) => {
    await onboard(page, server);
    // Nothing is sent by itself in the first minute.
    expect(server.telemetry.posts).toEqual([]);
    expect(await sendNow(page)).toEqual({ state: 'sent', sent: 3, queued: 0 });
    expect(server.telemetry.posts).toHaveLength(1);
    const batch = serverRead(server.telemetry.posts[0]!);
    expect(batch.installId).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);
    expect(batch.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    // With onboarding's playlist read (step 33b2; it names no guide).
    expect(batch.events.map((e) => e.kind).sort()).toEqual(['app_start', 'capability', 'ingest_done']);
    const start = batch.events.find((e) => e.kind === 'app_start')!;
    // Recorded at onboarding's first frame: no catalog yet.
    expect(start).toMatchObject({ tier: 'full', catalog: '0' });
    expect(start['coldStartMs']).toBeGreaterThan(0);
    const capability = batch.events.find((e) => e.kind === 'capability')!;
    expect(capability).toMatchObject({ model: 'Desktop browser', firmware: 'n_a', probes: { lowTier: false, mse: true } });
    expect(typeof capability['chromium']).toBe('number');
    expectNothingOfTheSource(server);

    // Kept: the ID; gone: the queue.
    const kept = await telemetryKv(page);
    expect(kept['telemetry.id']).toBe(batch.installId);
    expect(kept['telemetry.queue']).toBeUndefined();

    // A restart: the same ID, and the same capability isn't sent again.
    await page.reload();
    await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
    await expect.poll(async () => ((await sendNow(page)) as { state: string } | null)?.state).toBe('sent');
    const again = serverRead(server.telemetry.posts[server.telemetry.posts.length - 1]!);
    expect(again.installId).toBe(batch.installId);
    expect(again.events.map((e) => e.kind)).toEqual(['app_start']);
    // Its catalog now: two channels.
    expect(again.events[0]).toMatchObject({ catalog: '1+' });
    expectNothingOfTheSource(server);
  });
  expect(errors).toEqual([]);
});

test('keeps the events through a refusal and sends them again; the switch off clears the queue and the ID, and sends nothing', async ({ page }) => {
  const errors = trackErrors(page);
  await withServer({}, async (server) => {
    await onboard(page, server);
    server.telemetry.statuses.push(500);
    expect(await sendNow(page)).toEqual({ state: 'failed', failure: 'status', status: 500, queued: 3 });
    expect((await telemetryKv(page))['telemetry.queue']).toHaveLength(3);
    expect(await sendNow(page)).toEqual({ state: 'sent', sent: 3, queued: 0 });
    expect(server.telemetry.posts).toHaveLength(2);
    expect(server.telemetry.posts[1]).toBe(server.telemetry.posts[0]);

    // Queued again, then off: the next send clears it all and posts nothing.
    await page.reload();
    await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
    server.telemetry.statuses.push(500);
    await expect.poll(async () => ((await sendNow(page)) as { state: string } | null)?.state).toBe('failed');
    expect(Object.keys(await telemetryKv(page)).sort()).toEqual(['telemetry.capability', 'telemetry.id', 'telemetry.queue']);
    await switchOff(page);
    expect(await sendNow(page)).toEqual({ state: 'off' });
    expect(await telemetryKv(page)).toEqual({});
    expect(server.telemetry.posts).toHaveLength(3);

    // A start with the switch off records nothing and makes no ID.
    await page.reload();
    await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
    expect(await sendNow(page)).toEqual({ state: 'off' });
    expect(await telemetryKv(page)).toEqual({});
    expect(server.telemetry.posts).toHaveLength(3);
  });
  expect(realErrors(errors)).toEqual([]);
});

test("samples by the config's rates: a kind at 0 is never sent", async ({ page }) => {
  const errors = trackErrors(page);
  await withServer({ tunables: { telemetrySampling: { capability: 0, app_start: 1 } } }, async (server) => {
    await onboard(page, server);
    // The config's answer is in before the send (its worker ran at the start).
    await expect.poll(() => page.evaluate(() => window.__LABLO_TEST__?.config()?.status ?? null)).toBe('fresh');
    // A kind with no rate (onboarding's `ingest_done`) is sent.
    expect(await sendNow(page)).toEqual({ state: 'sent', sent: 2, queued: 0 });
    expect(serverRead(server.telemetry.posts[0]!).events.map((e) => e.kind).sort()).toEqual(['app_start', 'ingest_done']);
    expect((await telemetryKv(page))['telemetry.capability']).toBeUndefined();
  });
  expect(errors).toEqual([]);
});

test('posts the events of use: the playlist and its guide read, their match, and a play its stream refused, with nothing of the source in them', async ({ page }) => {
  const errors = trackErrors(page);
  await withServer(
    {},
    async (server) => {
      server.file(GUIDE_PATH, guideXml(), 'application/xml');
      await onboard(page, server);
      expect(await sendNow(page)).toMatchObject({ state: 'sent', sent: 5, queued: 0 });
      const batch = serverRead(server.telemetry.posts[0]!);
      expect(batch.events.map((e) => e.kind).sort()).toEqual(['app_start', 'capability', 'epg_match', 'ingest_done', 'ingest_done']);
      // The playlist's two channels (about 200 bytes), then its guide's 48 programmes (about 5 KB).
      expect(batch.events.filter((e) => e.kind === 'ingest_done').map((e) => [e['source'], e['bytes'], e['items']])).toEqual([
        ['m3u', '100+', '1+'],
        ['epg', '1k+', '10+'],
      ]);
      // One channel of two has a guide.
      expect(batch.events.find((e) => e.kind === 'epg_match')).toMatchObject({ rate: '50-74' });

      // OK on the first channel: the browser refuses its stream's port (9, an unsafe port) and the
      // player gives up.
      const remote = new RemoteDriver(page);
      await remote.expectFocus('live/channels/0');
      await remote.press('OK');
      const player = page.getByTestId('player');
      await expect(player).toHaveAttribute('data-state', 'failed', { timeout: 20_000 });
      expect(await sendNow(page)).toEqual({ state: 'sent', sent: 1, queued: 0 });
      const played = serverRead(server.telemetry.posts[1]!);
      expect(played.events).toEqual([
        { kind: 'play_result', at: expect.any(Number), engine: 'html5', container: 'ts', mode: 'live', ttffMs: null, error: { kind: 'unsupported', code: 'MEDIA_ERR_SRC_NOT_SUPPORTED' } },
      ]);
      expectNothingOfTheSource(server);
    },
    guidedPlaylist,
  );
  // (The browser logs its refusal of port 9.)
  expect(errors.filter((e) => e.indexOf('net::ERR_UNSAFE_PORT') === -1)).toEqual([]);
});

test("records the page's uncaught errors and unhandled rejections as crashes, once each, and posts them scrubbed of the source", async ({ page }) => {
  const errors = trackErrors(page);
  await withServer({}, async (server) => {
    await onboard(page, server);
    expect(await sendNow(page)).toMatchObject({ state: 'sent', sent: 3 });

    // Step 33c: a throw from a timer (twice from the same place: recorded once) and a rejection
    // nothing handles, each holding the playlist's link and its login.
    const link = `${server.origin}${LIST_PATH}`;
    const before = Date.now();
    await page.evaluate(
      ({ link, user, pass }) => {
        const boom = (): never => {
          throw new Error(`e2e-crash: could not read ${link} for ${user}`);
        };
        setTimeout(boom, 0);
        setTimeout(boom, 0);
        void Promise.reject(new Error(`e2e-crash: refused ${user}:${pass} at ${link}`));
      },
      { link, user: USER, pass: PASS },
    );
    await expect.poll(() => errors.filter((e) => e.indexOf('e2e-crash') !== -1).length).toBe(3);
    expect(await sendNow(page)).toEqual({ state: 'sent', sent: 2, queued: 0 });
    const batch = serverRead(server.telemetry.posts[1]!);
    expect(batch.events.map((e) => [e.kind, e['where']])).toEqual([
      ['crash', 'main'],
      ['crash', 'main'],
    ]);
    // Each at its time (the page's clock is the test's).
    for (const e of batch.events) {
      expect(e['at']).toBeGreaterThanOrEqual(before);
      expect(e['at']).toBeLessThanOrEqual(Date.now());
    }
    const stacks = batch.events.map((e) => e['stack'] as string).sort();
    expect(stacks[0]!.split('\n')[0]).toBe('Uncaught (in promise) Error: e2e-crash: refused [login]:[login] at [url]');
    expect(stacks[1]!.split('\n')[0]).toBe('Uncaught Error: e2e-crash: could not read [url] for [login]');
    // Each with its frames.
    for (const stack of stacks) expect(stack.split('\n').length).toBeGreaterThan(1);
    expectNothingOfTheSource(server);
  });
  // (The page's own throws, on purpose.)
  expect(errors.filter((e) => e.indexOf('e2e-crash') === -1)).toEqual([]);
});

/** The Settings row's words in each language (step 33b3). */
const SAYS = {
  en: { on: 'On', off: 'Off', onHint: 'Anonymous: never your links, logins or channel names', offHint: 'Nothing is sent while they are off' },
  ar: { on: 'مفعّلة', off: 'متوقفة', onHint: 'مجهولة الهوية: لا تتضمن أبدًا روابطك أو بيانات دخولك أو أسماء قنواتك', offHint: 'لا يُرسل شيء ما دامت متوقفة' },
} as const;

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

for (const [locale, language] of [
  ['en-US', 'en'],
  ['ar-SA', 'ar'],
] as const) {
  test(`switches the reports off in Settings, which clears the queue and the ID, and on again, which makes a new ID (${locale})`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    const says = SAYS[language];
    await withServer({}, async (server) => {
      await onboard(page, server, locale);
      // A refused send leaves the queue, the ID and the capability's key on the TV.
      server.telemetry.statuses.push(500);
      expect(await sendNow(page)).toMatchObject({ state: 'failed', queued: 3 });
      const before = await telemetryKv(page);
      expect(Object.keys(before).sort()).toEqual(['telemetry.capability', 'telemetry.id', 'telemetry.queue']);

      // Settings: the header's last button (its end: the left in Arabic), then the "Usage and crash reports" row.
      const remote = new RemoteDriver(page);
      const side = language === 'ar' ? 'LEFT' : 'RIGHT';
      await remote.go('UP', 'live/header/0');
      for (let i = 1; i <= 5; i += 1) await remote.go(side, `live/header/${i}`);
      await remote.go('OK', SETTINGS_FIRST);
      const root = page.getByTestId('settings-screen');
      await expect(root).toHaveAttribute('data-language', language);
      await toSettingsRow(remote, 'telemetry');
      const row = page.getByTestId('settings-telemetry');
      const value = page.getByTestId('settings-telemetry-value');
      const hint = page.getByTestId('settings-telemetry-hint');
      await expect(row).toHaveAttribute('data-value', 'true');
      await expect(row).toHaveAttribute('aria-checked', 'true');
      await expect(row).toHaveAttribute('role', 'menuitemcheckbox');
      await expect(value).toHaveText(says.on);
      await expect(hint).toHaveText(says.onHint);
      expect(await fits(page, 'settings-telemetry-hint')).toBe(true);
      await settled(root);
      await shoot(page, `telemetry-settings-on-${language}`);

      // OK: off in place. The clearing send deletes the queue and the ID, and posts nothing.
      await remote.go('OK', settingsRow('telemetry'));
      await expect(row).toHaveAttribute('data-value', 'false');
      await settled(root, 20_000);
      await expect(row).toHaveAttribute('data-busy', 'false');
      await expect(row).toHaveAttribute('data-failed', 'false');
      await expect(row).toHaveAttribute('aria-checked', 'false');
      await expect(value).toHaveText(says.off);
      await expect(hint).toHaveText(says.offHint);
      expect(await fits(page, 'settings-telemetry-hint')).toBe(true);
      expect(await telemetryKv(page)).toEqual({});
      expect(await storedSwitch(page)).toBe(false);
      expect(await sendNow(page)).toEqual({ state: 'off' });
      expect(server.telemetry.posts).toHaveLength(1);
      await shoot(page, `telemetry-settings-off-${language}`);

      // Read from the profile again at the next opening (the row is looked at once the focus is on it: the list scrolls).
      await remote.go('BACK', 'live/header/5');
      await remote.go('OK', SETTINGS_FIRST);
      await toSettingsRow(remote, 'telemetry');
      await expect(row).toHaveAttribute('data-value', 'false');

      // On again: nothing to send until an event; the next start's events go under a new ID.
      await remote.go('OK', settingsRow('telemetry'));
      await expect(row).toHaveAttribute('data-value', 'true');
      await settled(root);
      expect(await storedSwitch(page)).toBe(true);
      expect(await sendNow(page)).toEqual({ state: 'empty' });
      await page.reload();
      await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready');
      await expect.poll(async () => ((await sendNow(page)) as { state: string } | null)?.state).toBe('sent');
      const batch = serverRead(server.telemetry.posts[server.telemetry.posts.length - 1]!);
      expect(batch.installId).not.toBe(before['telemetry.id']);
      expect((await telemetryKv(page))['telemetry.id']).toBe(batch.installId);
      // The capability's key went with the ID: it is sent again.
      expect(batch.events.map((e) => e.kind).sort()).toEqual(['app_start', 'capability']);
      expectNothingOfTheSource(server);
    });
    expect(realErrors(errors)).toEqual([]);
  });
}

/** The report row's words in each language (step 33d2). */
const REPORT_SAYS = {
  en: { name: 'Send a report to support', hint: "Your TV's model, the app's state and recent errors, never your links or logins", sent: 'Your support code: give it to support with your question', failed: "Couldn't send it. Check your internet connection and try again." },
  ar: { name: 'إرسال تقرير إلى الدعم', hint: 'طراز التلفزيون وحالة التطبيق والأعطال الأخيرة، دون روابطك أو بيانات دخولك أبدًا', sent: 'رمز الدعم الخاص بك: أعطه لفريق الدعم مع سؤالك', failed: 'تعذّر إرساله. تحقّق من اتصالك بالإنترنت وحاول مرة أخرى.' },
} as const;

for (const [locale, language] of [
  ['en-US', 'en'],
  ['ar-SA', 'ar'],
] as const) {
  test(`sends a report to support from Settings with the reports off, shows its code, and posts nothing of the source (${locale})`, async ({ page }) => {
    test.setTimeout(90_000);
    const errors = trackErrors(page);
    const says = REPORT_SAYS[language];
    await withServer({}, async (server) => {
      await onboard(page, server, locale);
      // The reports switched off where the worker reads it: the report still goes (the user asks for it).
      await switchOff(page);
      // A crash holding the playlist's link and login, for the report's events.
      const link = `${server.origin}${LIST_PATH}`;
      await page.evaluate(
        ({ link, user }) => {
          setTimeout(() => {
            throw new Error(`e2e-report: could not read ${link} for ${user}`);
          }, 0);
        },
        { link, user: USER },
      );
      await expect.poll(() => errors.filter((e) => e.indexOf('e2e-report') !== -1).length).toBe(1);

      // Settings: the header's last button, then the "Send a report to support" row.
      const remote = new RemoteDriver(page);
      const side = language === 'ar' ? 'LEFT' : 'RIGHT';
      await remote.go('UP', 'live/header/0');
      for (let i = 1; i <= 5; i += 1) await remote.go(side, `live/header/${i}`);
      await remote.go('OK', SETTINGS_FIRST);
      const root = page.getByTestId('settings-screen');
      await expect(root).toHaveAttribute('data-language', language);
      await toSettingsRow(remote, 'report');
      const row = page.getByTestId('settings-report');
      const hint = page.getByTestId('settings-report-hint');
      const code = page.getByTestId('settings-report-code');
      await expect(row).toHaveAttribute('data-report', 'idle');
      await expect(row).toHaveAttribute('role', 'menuitem');
      await expect(row.locator('.settings__name')).toHaveText(says.name);
      await expect(hint).toHaveText(says.hint);
      expect(await fits(page, 'settings-report-hint')).toBe(true);
      await settled(root);
      await shoot(page, `report-settings-${language}`);

      // The first send fails (503): the row says so; OK again sends, and the code shows.
      server.diag.statuses.push(503);
      const before = Date.now();
      await remote.go('OK', settingsRow('report'));
      await expect(row).toHaveAttribute('data-report', 'failed');
      await expect(hint).toHaveText(says.failed);
      await expect(hint).toHaveClass(/settings__warn/);
      await expect(code).toHaveCount(0);
      await settled(root);
      await remote.go('OK', settingsRow('report'));
      await expect(row).toHaveAttribute('data-report', 'sent');
      await expect(code).toHaveText(DIAG_STAND_IN_CODE);
      await expect(code).toHaveAttribute('dir', 'ltr');
      await expect(hint).toHaveText(says.sent);
      expect(await fits(page, 'settings-report-hint')).toBe(true);
      await settled(root);
      await shoot(page, `report-settings-sent-${language}`);

      // What the server read: the dev app's platform swapped for a TV's, as telemetry's stand-in does.
      expect(server.diag.posts).toHaveLength(2);
      const body = JSON.parse(server.diag.posts[1]!) as { platform: string; report: Record<string, unknown> };
      expect(body.platform).toBe('browser');
      const read = diagRequestSchema.parse({ ...body, platform: 'webos' });
      // Nothing stripped: the TV sends only what the schema keeps.
      expect(read).toEqual({ ...body, platform: 'webos' });
      const zoneMin = await page.evaluate(() => 0 - new Date().getTimezoneOffset());
      expect(read.report).toMatchObject({
        v: 1,
        zoneMin,
        locale: language,
        telemetry: false,
        config: 'fresh',
        sources: [{ type: 'm3u', items: '1+', checked: '<1h', needs: null }],
        guides: [],
      });
      expect(read.report.at).toBeGreaterThanOrEqual(before);
      expect(read.report.at).toBeLessThanOrEqual(Date.now());
      expect(read.report.events.map((e) => e.kind)).toEqual(['crash']);
      const crash = read.report.events[0] as { stack: string };
      expect(crash.stack.split('\n')[0]).toBe('Uncaught Error: e2e-report: could not read [url] for [login]');
      expectNothingOfTheSource(server, server.diag.posts);
      // The reports are off: no telemetry post meanwhile.
      expect(server.telemetry.posts).toEqual([]);

      // The next opening clears the code (the row is looked at once the focus is on it: the list scrolls).
      await remote.go('BACK', 'live/header/5');
      await remote.go('OK', SETTINGS_FIRST);
      await toSettingsRow(remote, 'report');
      await expect(row).toHaveAttribute('data-report', 'idle');
      await expect(code).toHaveCount(0);
    });
    expect(realErrors(errors).filter((e) => e.indexOf('e2e-report') === -1)).toEqual([]);
  });
}
