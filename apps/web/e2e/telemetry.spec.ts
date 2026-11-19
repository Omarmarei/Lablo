import { randomBytes } from 'node:crypto';
import { toBase64Url } from '@lablo/crypto';
import { expect, sql, test } from './support';

/**
 * The telemetry API over HTTP (RELAY step 33a) against `next start`: a scripted TV, calling from a
 * `file://` page's origin (`Origin: null`), sends its preflight and a batch with a crash whose
 * stack holds a panel's URL and login. The built server keeps one row per event it can read, the
 * crash's stack scrubbed. The route's own answers are unit-tested against Postgres
 * (apps/web/test/telemetry.web.test.ts); this proves the built server serves them.
 */

test('a TV sends a batch of events, and the server keeps them with the crash scrubbed', async ({ request, address }) => {
  const from = { 'x-forwarded-for': address, origin: 'null' };
  const installId = toBase64Url(new Uint8Array(randomBytes(16)));

  const preflight = await request.fetch('/v1/telemetry', {
    method: 'OPTIONS',
    headers: { ...from, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });
  expect([preflight.status(), preflight.headers()['access-control-allow-origin'], preflight.headers()['access-control-allow-methods'], preflight.headers()['access-control-allow-headers']]).toStrictEqual([
    204,
    '*',
    'POST, OPTIONS',
    'content-type',
  ]);

  const at = Date.now() - 1000;
  const events = [
    { kind: 'app_start', at, tier: 'low', coldStartMs: 3400, catalog: '1k+' },
    { kind: 'crash', at, where: 'worker', stack: 'Error: refused by http://panel.marker.example:8080/player_api.php?username=marker-user&password=marker-pass' },
    { kind: 'zap', at, ms: 1 },
  ];
  const posted = await request.post('/v1/telemetry', { headers: from, data: { installId, platform: 'tizen', appVersion: '1.0.0', events } });
  expect([posted.status(), await posted.json(), posted.headers()['access-control-allow-origin'], posted.headers()['cache-control']]).toStrictEqual([
    200,
    { state: 'stored', stored: 2, dropped: 1 },
    '*',
    'no-store',
  ]);
  expect(await sql('SELECT 1 FROM "TelemetryEvent" WHERE "installId" = $1', [installId])).toBe(2);
  expect(await sql(`SELECT 1 FROM "TelemetryEvent" WHERE "installId" = $1 AND "kind" = 'crash' AND "data"->>'stack' = 'Error: refused by [url]'`, [installId])).toBe(1);
  expect(await sql(`SELECT 1 FROM "TelemetryEvent" WHERE row_to_json("TelemetryEvent")::text LIKE '%marker%' OR row_to_json("TelemetryEvent")::text LIKE $1`, [`%${address}%`])).toBe(0);
});
