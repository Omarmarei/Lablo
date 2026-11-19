import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { readTelemetryEvents, telemetryBatchSchema } from '@lablo/protocol';
import { devSignedAnswer } from '../tools/engines/src/config';
import type { ConfigServer } from './config-server';
import { doc, startConfigServer } from './config-server';
import { addM3uAndWatch, trackErrors } from './onboard';
import { RemoteDriver } from './remote-driver';

/**
 * Telemetry in the app (RELAY step 33b1), against the stand-in API on the test's config server
 * (`?api=`): the start's events (`app_start`, `capability`) are recorded at the start's first
 * screen, and sent from the live screen on. Step 33b2 adds the events of use: onboarding's
 * playlist read (`ingest_done`), its guide read and their match (`epg_match`), and a play's
 * result (`play_result`). The test hook's `sendTelemetry()` sends now instead of
 * 60 s on. The dev app reports `platform: 'browser'`, which the real API refuses, so the batch is
 * read here with the server's own schema, the platform swapped. The playlist's link carries a
 * login, and no post may hold it, the stand-in's host or port, or the link.
 */
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

/** Onboarding with the stand-in's playlist, then the live screen. */
async function onboard(page: Page, server: ConfigServer): Promise<void> {
  const remote = new RemoteDriver(page);
  await addM3uAndWatch(remote, `${server.origin.replace(/^http:\/\//, '')}${LIST_PATH}`, `api=${server.origin}`);
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

/** No post holds the playlist's login, its link, or the stand-in's host and port. */
function expectNothingOfTheSource(server: ConfigServer): void {
  const port = new URL(server.origin).port;
  for (const body of server.telemetry.posts) {
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

/** The stored profile's `telemetry` switch set off, as Settings will (step 33b3), from the page. */
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

/** Errors but the stand-in's refusals (Chromium logs each non-2xx answer). */
function realErrors(errors: string[]): string[] {
  return errors.filter((e) => !/the server responded with a status of 500/.test(e));
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
