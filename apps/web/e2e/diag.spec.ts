import { expect, sql, test } from './support';

/**
 * The diagnostics report's API over HTTP (RELAY step 33d1) against `next start`: a scripted TV,
 * calling from a `file://` page's origin (`Origin: null`), sends its preflight and a report whose
 * crash stack holds a panel's URL and login, with a source's name and link the schema doesn't
 * know. The built server answers a support code and keeps the report under it, the stack scrubbed
 * and the unknown fields gone. The route's own answers are unit-tested against Postgres
 * (apps/web/test/diag.web.test.ts); this proves the built server serves them.
 */

test('a TV sends a report, and the server keeps it scrubbed under the support code it answers', async ({ request, address }) => {
  const from = { 'x-forwarded-for': address, origin: 'null' };

  const preflight = await request.fetch('/v1/diag', {
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
  const report = {
    v: 1,
    at,
    zoneMin: 180,
    locale: 'ar',
    tier: 'low',
    model: 'UN55TU8000',
    firmware: 'T-KTM2AKUC-1500.5',
    chromium: 56,
    probes: { year: 2020, lowTier: true, mse: true, hevc: false },
    telemetry: false,
    config: 'none',
    sources: [{ type: 'xtream', items: '1k+', checked: '7d+', needs: null, name: 'marker-name', url: 'http://panel.marker.example:8080/get.php' }],
    guides: [],
    events: [{ kind: 'crash', at, where: 'worker', stack: 'Error: refused by http://panel.marker.example:8080/player_api.php?username=marker-user&password=marker-pass' }],
  };
  const posted = await request.post('/v1/diag', { headers: from, data: { platform: 'tizen', appVersion: '1.0.0', report } });
  const answer = (await posted.json()) as { code: string };
  expect([posted.status(), posted.headers()['access-control-allow-origin'], posted.headers()['cache-control']]).toStrictEqual([201, '*', 'no-store']);
  expect(Object.keys(answer)).toStrictEqual(['code']);
  expect(answer.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);

  expect(await sql(`SELECT 1 FROM "DiagReport" WHERE "code" = $1 AND "platform" = 'tizen' AND "appVersion" = '1.0.0'`, [answer.code])).toBe(1);
  expect(await sql(`SELECT 1 FROM "DiagReport" WHERE "code" = $1 AND "report"->'events'->0->>'stack' = 'Error: refused by [url]'`, [answer.code])).toBe(1);
  expect(await sql(`SELECT 1 FROM "DiagReport" WHERE "code" = $1 AND "report"->'sources'->0 = '{"type":"xtream","items":"1k+","checked":"7d+","needs":null}'::jsonb`, [answer.code])).toBe(1);
  expect(await sql(`SELECT 1 FROM "DiagReport" WHERE row_to_json("DiagReport")::text LIKE '%marker%' OR row_to_json("DiagReport")::text LIKE $1`, [`%${address}%`])).toBe(0);
});
