import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { xtreamKey } from '@lablo/core';
import { backupKeys, deriveBackupMaster, fromBase64Url, openBackup, tokenHash } from '@lablo/crypto';
import { readBackupPlain, readEnvelope } from '@lablo/data';
import type { MockServer } from '../apps/mock-provider/src/server';
import { P, U, listen, mock } from '../apps/mock-provider/test/helpers';
import { E2E_DATABASE, WEB, serverUrl, withDatabase } from '../apps/web/test/web-db';
import { appIdFor } from '../tv-defines.config';
import type { ApiFront } from './api-front';
import { startApiFront } from './api-front';
import { catalog } from './live-rows';
import { leaks } from './no-plaintext';
import { addXtreamAndWatch, startWatching, toSourceTypes, trackErrors, typeInto } from './onboard';
import { SHOTS, shoot } from './pairing-steps';
import { RemoteDriver } from './remote-driver';

/**
 * Step 32's own "Done when" against the real API (RELAY step 32d1): a simulated wipe restores
 * automatically. The TV's dev app (with a test device ID, `?device=`), the web app (`next start`
 * and `lablo_e2e`, through the test front e2e/api-front.ts) and the mock provider:
 * 1. a first start's look-up finds nothing on the real route (`GET` 404), onboarding adds the source;
 * 2. favourites and places are written into the stored profile from the gallery page (no TV screen
 *    adds a favourite yet: step 35), then the live screen opens again;
 * 3. an upload (`PUT` 200 after the first send's `GET` 404); the envelope, opened here with keys
 *    derived from the same device ID, is exactly the stored profile document;
 * 4. "no plaintext": the source's server, login, links and names and the favourites' names are in
 *    the opened envelope and the TV's profile (the controls), and in none of what the web app
 *    received, its rows, or the blob as `GET` answers it;
 * 5. the TV wiped (the `lablo` database deleted from the gallery page) and started again: "Looking
 *    for your backup", "Welcome back" with the document back as the envelope held it, then the
 *    live screen fills, with no key pressed.
 * In English with an Xtream login, favourites and places; in Arabic with an M3U link and its guide.
 */

/** The real API (`next start`), as playwright.web.config.ts starts it. */
const API = `http://127.0.0.1:${Number(process.env.LABLO_WEB_E2E_PORT ?? 3101)}`;
/** The dev app's build is the browser platform; its app id is the webOS build's (`appIdFor`). */
const BUILD = { platform: 'browser', appId: appIdFor('webos') } as const;

interface PgClient {
  connect(): Promise<void>;
  query<R>(text: string, values: unknown[]): Promise<{ rows: R[] }>;
  end(): Promise<void>;
}
const pg = createRequire(path.join(WEB, 'package.json'))('pg') as { Client: new (config: { connectionString: string }) => PgClient };

async function withClient<T>(run: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: withDatabase(serverUrl(), E2E_DATABASE) });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Every row of every table in `lablo_e2e`'s public schema, one `<table> <row as JSON>` line each. */
function everyRow(): Promise<string> {
  return withClient(async (client) => {
    const tables = await client.query<{ name: string }>("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1", []);
    expect(tables.rows.map((t) => t.name)).toContain('Backup');
    const lines: string[] = [];
    for (const { name } of tables.rows) {
      const rows = await client.query<{ row: string }>(`SELECT row_to_json(t)::text AS "row" FROM "${name}" t`, []);
      for (const { row } of rows.rows) lines.push(`${name} ${row}`);
    }
    return lines.join('\n');
  });
}

/** The `Backup` row under `lookupId`, or `null`. */
function backupRow(lookupId: string): Promise<{ writeTokenHash: string; size: number } | null> {
  return withClient(async (client) => {
    const result = await client.query<{ writeTokenHash: string; size: number }>('SELECT "writeTokenHash", "size" FROM "Backup" WHERE "lookupId" = $1', [lookupId]);
    return result.rows[0] ?? null;
  });
}

let app: MockServer;
let host: string;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  app = await mock({ now: () => Date.now() });
  host = (await listen(app)).replace(/^http:\/\//, '');
});
test.afterAll(async () => {
  await app.close();
});

let fronts = 0;

async function withFront(run: (front: ApiFront) => Promise<void>): Promise<void> {
  fronts += 1;
  const front = await startApiFront({ upstream: API, address: `10.251.${test.info().workerIndex % 250}.${fronts % 250}` });
  try {
    await run(front);
  } finally {
    await front.close();
  }
}

/** The backup requests the real API answered, as `<method> <status>`; the preflights apart. */
function backupCalls(front: ApiFront): { calls: string[]; preflights: number } {
  const backup = front.forwarded.filter((f) => f.path.startsWith('/v1/backup/'));
  return { calls: backup.filter((f) => f.method !== 'OPTIONS').map((f) => `${f.method} ${f.status}`), preflights: backup.filter((f) => f.method === 'OPTIONS').length };
}

/** No config run and no backup worker in the database. */
async function appIdle(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => (window.__LABLO_TEST__?.configIdle() ?? false) && (window.__LABLO_TEST__?.backupIdle() ?? false))).toBe(true);
}

type Doc = Record<string, unknown> & { sources: Array<Record<string, unknown>> };

/** The stored profile document, whole (`null`: none). */
function storedDoc(page: Page): Promise<Doc | null> {
  return page.evaluate(
    () =>
      new Promise<Doc | null>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('profile').objectStore('profile').get('current');
          req.onsuccess = () => {
            db.close();
            const record = req.result as { doc: Doc } | undefined;
            resolve(record === undefined ? null : record.doc);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The stored profile's document replaced by `doc` (its record's other fields kept). */
function writeDoc(page: Page, doc: Doc): Promise<void> {
  return page.evaluate(
    (next) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lablo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('profile', 'readwrite');
          const store = tx.objectStore('profile');
          const req = store.get('current');
          req.onsuccess = () => {
            const record = req.result as Record<string, unknown>;
            store.put({ ...record, doc: next });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    doc,
  );
}

/** The app's start page left for the gallery (no data worker), once it is idle. */
async function toGallery(page: Page): Promise<void> {
  await appIdle(page);
  await page.goto('/?screen=gallery');
  await expect(page.getByTestId('gallery')).toBeVisible();
}

/** The TV's app data wiped: the database deleted from the gallery page, which opens none. */
async function wipe(page: Page): Promise<void> {
  await toGallery(page);
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const request = indexedDB.deleteDatabase('lablo');
        request.onsuccess = () => resolve('ok');
        request.onerror = () => resolve('error');
        request.onblocked = () => resolve('blocked');
      }),
  );
  expect(result).toBe('ok');
}

/**
 * Favourites and places for the Xtream source `s1`, from the mock's catalog: two channels, a movie
 * left part way, a show's episode left part way. What the restore must bring back besides the source.
 */
function placesFor(now: number): Pick<Doc, 'favourites' | 'progress' | 'shows'> {
  const channels = [catalog.live[0]!, catalog.live[3]!];
  const movie = catalog.movies[0]!;
  const show = catalog.series[0]!;
  const episode = show.seasons[0]!.episodes[1]!;
  return {
    favourites: channels.map((ch, i) => ({ key: xtreamKey('s1', 'live', ch.id), src: 's1', kind: 'live', normName: ch.name.toLowerCase(), added: now - i * 60_000, missingSince: null })),
    progress: {
      [xtreamKey('s1', 'movie', movie.id)]: { positionMs: 754_000, lengthMs: movie.durationSecs * 1000, updated: now },
      [xtreamKey('s1', 'episode', episode.id)]: { positionMs: 61_000, lengthMs: episode.durationSecs * 1000, updated: now },
    },
    shows: { [xtreamKey('s1', 'series', show.id)]: { episode: xtreamKey('s1', 'episode', episode.id), watched: false, more: true, updated: now } },
  };
}

const SAYS = {
  en: { looking: 'Looking for your backup', welcome: 'Welcome back', locale: 'en-US' },
  ar: { looking: 'جارٍ البحث عن نسختك الاحتياطية', welcome: 'مرحبًا بعودتك', locale: 'ar-SA' },
} as const;

const m3uLink = (): string => `http://${host}/get.php?username=${U}&password=${P}&type=m3u_plus`;
const guideLink = (): string => `http://${host}/xmltv.php?username=${U}&password=${P}`;
const ARABIC_NAME = 'قائمة غرفة الجلوس';

/** Onboarding in Arabic with the mock's M3U link, its guide link and a name, then "Start watching". */
async function addM3uWithGuide(remote: RemoteDriver, query: string): Promise<void> {
  const onboarding = await toSourceTypes(remote, query);
  await remote.go('DOWN', 'source/types/1');
  await remote.go('OK', 'form/fields/0');
  // Typed the way a user would: no `http://` (the form adds it).
  await typeInto(remote, onboarding, 'playlist', m3uLink().replace(/^http:\/\//, ''));
  await remote.expectFocus('form/fields/1');
  await typeInto(remote, onboarding, 'epg', guideLink().replace(/^http:\/\//, ''));
  await remote.expectFocus('form/fields/2');
  await typeInto(remote, onboarding, 'name', ARABIC_NAME);
  await remote.expectFocus('form/actions/0');
  await startWatching(remote, onboarding, 30_000);
}

for (const language of ['en', 'ar'] as const) {
  test(`a wipe restores automatically from the real API, and the envelope holds nothing in the clear (${language})`, async ({ page }) => {
    test.setTimeout(150_000);
    const errors = trackErrors(page);
    const remote = new RemoteDriver(page);
    const device = `e2e-api-32d1-${language}`;
    await withFront(async (front) => {
      const query = `device=${device}&api=${encodeURIComponent(front.origin)}&locale=${SAYS[language].locale}`;
      const keys = backupKeys(await deriveBackupMaster(device, BUILD.platform, BUILD.appId));
      // A first start: the real route has no backup for this TV, so onboarding.
      if (language === 'en') await addXtreamAndWatch(remote, { host, username: U, password: P }, query);
      else await addM3uWithGuide(remote, query);
      expect(backupCalls(front).calls).toEqual(['GET 404']);
      expect(front.forwarded.find((f) => f.path.startsWith('/v1/backup/'))?.path).toBe(`/v1/backup/${keys.lookupId}`);

      // Favourites and places (English), written while no data worker runs, then the live screen again.
      await toGallery(page);
      const before = (await storedDoc(page))!;
      const doc: Doc = language === 'en' ? { ...before, ...placesFor(Date.now()) } : before;
      if (language === 'en') await writeDoc(page, doc);
      await page.goto(`/?${query}`);
      await expect(page.getByTestId('live')).toHaveAttribute('data-status', 'ready', { timeout: 20_000 });
      await appIdle(page);

      // The upload, against the real routes: the first send asks GET, then PUT with the write token.
      expect(await page.evaluate(() => window.__LABLO_TEST__!.uploadBackup())).toBe('sent');
      const sent = backupCalls(front);
      expect(sent.calls).toEqual(['GET 404', 'GET 404', 'PUT 200']);
      expect(sent.preflights).toBeGreaterThan(0);
      const puts = front.received.filter((r) => r.method === 'PUT' && r.path === `/v1/backup/${keys.lookupId}`);
      expect(puts).toHaveLength(1);
      expect(puts[0]!.headers['x-write-token']).toBe(keys.writeToken);

      // The envelope, opened with keys derived here from the same device ID: the stored document, exactly.
      const envelope = readEnvelope(puts[0]!.body.toString('utf8'));
      expect(envelope).not.toBeNull();
      const plain = openBackup(envelope!, keys.encKey);
      expect(plain).not.toBeNull();
      const opened = readBackupPlain(plain!) as Doc | null;
      const stored = await storedDoc(page);
      expect(opened).toEqual(stored);
      // Sealed, not only compressed (a gzip stream hides its text from a byte search too): the
      // ciphertext reads as no gzip, and another device's key doesn't open it.
      expect(readBackupPlain(fromBase64Url(envelope!.ct)!)).toBeNull();
      const other = backupKeys(await deriveBackupMaster(`${device}-other`, BUILD.platform, BUILD.appId));
      expect(openBackup(envelope!, other.encKey)).toBeNull();
      expect(stored).toEqual(doc);
      if (language === 'en') {
        expect(Object.keys(opened!.progress as object)).toHaveLength(2);
        expect(opened!.favourites).toHaveLength(2);
      } else {
        expect(opened!.guides).toEqual([{ id: 's1', url: guideLink() }]);
      }

      // What the web app keeps: the row (the token's hash, never the token) and the blob, the PUT's envelope.
      // Read straight from the API (the front logs only the TV's requests), as a caller of its own.
      const blob = await fetch(`${API}/v1/backup/${keys.lookupId}`, { headers: { 'x-forwarded-for': `10.250.${test.info().workerIndex % 250}.${fronts % 250}` } });
      expect(blob.status).toBe(200);
      const blobBytes = Buffer.from(await blob.arrayBuffer());
      expect(readEnvelope(blobBytes.toString('utf8'))).toEqual(envelope);
      expect(await backupRow(keys.lookupId)).toEqual({ writeTokenHash: tokenHash(keys.writeToken), size: blobBytes.length });

      // "No plaintext": the source and the favourites' names, in the clear only on the TV and inside the opened envelope.
      const names = language === 'en' ? ((doc.favourites as Array<{ normName: string }>).map((f) => f.normName)) : [ARABIC_NAME];
      const needles = language === 'en' ? [host, U, P, `http://${host}`, ...names] : [host, U, P, m3uLink(), guideLink(), '/get.php?username=', '/xmltv.php?username=', ...names];
      expect(leaks(JSON.stringify(opened), needles)).toEqual(needles);
      for (const request of front.received) {
        expect(leaks(`${request.method} ${request.path}\n${JSON.stringify(request.headers)}`, needles), `${request.method} ${request.path}`).toEqual([]);
        expect(leaks(request.body, needles), `${request.method} ${request.path}: its body`).toEqual([]);
      }
      expect(leaks(blobBytes, needles), 'the blob').toEqual([]);
      expect(leaks(await everyRow(), needles), 'the rows').toEqual([]);

      // The wipe, then a start with no key pressed.
      await wipe(page);
      await page.goto(`/?${query}`);
      const start = page.getByTestId('backup-start');
      await expect(start).toHaveAttribute('data-screen', 'welcome', { timeout: 30_000 });
      await expect(start).toHaveAttribute('data-language', language);
      await expect(page.getByTestId('backup-title')).toHaveText(SAYS[language].welcome);
      // Back as the envelope held it, before the live screen reads anything again.
      expect(await storedDoc(page)).toEqual(opened);
      await shoot(page, `backup-api-welcome-${language}`);
      const live = page.getByTestId('live');
      await expect(live).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
      await expect(live).toContainText(catalog.live[0]!.name);
      await remote.expectFocus('live/channels/0');
      await expect(page.locator('#stage video')).toHaveCount(0);
      await shoot(page, `backup-api-live-${language}`);
      expect(backupCalls(front).calls).toEqual(['GET 404', 'GET 404', 'PUT 200', 'GET 200']);
      const restored = (await storedDoc(page))!;
      expect(restored.sources).toEqual(opened!.sources);
      expect(restored.favourites).toEqual(opened!.favourites);
      expect(restored.progress).toEqual(opened!.progress);
      expect(restored.shows).toEqual(opened!.shows);
      await appIdle(page);
    });
    expect(errors).toEqual([]);
  });
}
