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
 * screen, and sent from the live screen on. The test hook's `sendTelemetry()` sends now instead of
 * 60 s on. The dev app reports `platform: 'browser'`, which the real API refuses, so the batch is
 * read here with the server's own schema, the platform swapped. The playlist's link carries a
 * login, and no post may hold it, the stand-in's host or port, or the link.
 */
const USER = 'tvuser33b';
const PASS = 'tvpass33b1';
const PLAYLIST = '#EXTM3U\n#EXTINF:-1 tvg-id="news" group-title="News",Family News\nhttp://127.0.0.1:9/live/1.ts\n#EXTINF:-1 tvg-id="films" group-title="Films",Film Night\nhttp://127.0.0.1:9/live/2.ts\n';
const LIST_PATH = `/list.m3u?username=${USER}&password=${PASS}`;

async function withServer(config: Record<string, unknown>, run: (server: ConfigServer) => Promise<void>): Promise<void> {
  const server = await startConfigServer(devSignedAnswer(doc(config)));
  server.file(LIST_PATH, PLAYLIST, 'audio/x-mpegurl');
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
    expect(await sendNow(page)).toEqual({ state: 'sent', sent: 2, queued: 0 });
    expect(server.telemetry.posts).toHaveLength(1);
    const batch = serverRead(server.telemetry.posts[0]!);
    expect(batch.installId).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/);
    expect(batch.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(batch.events.map((e) => e.kind).sort()).toEqual(['app_start', 'capability']);
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
    expect(await sendNow(page)).toEqual({ state: 'failed', failure: 'status', status: 500, queued: 2 });
    expect((await telemetryKv(page))['telemetry.queue']).toHaveLength(2);
    expect(await sendNow(page)).toEqual({ state: 'sent', sent: 2, queued: 0 });
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
    expect(await sendNow(page)).toEqual({ state: 'sent', sent: 1, queued: 0 });
    expect(serverRead(server.telemetry.posts[0]!).events.map((e) => e.kind)).toEqual(['app_start']);
    expect((await telemetryKv(page))['telemetry.capability']).toBeUndefined();
  });
  expect(errors).toEqual([]);
});
