import { randomBytes } from 'node:crypto';
import { backupKeys, openBackup, sealBackup, tokenHash, utf8 } from '@lablo/crypto';
import { BACKUP_WRITE_HEADER, backupEnvelopeSchema } from '@lablo/protocol';
import { expect, sql, test } from './support';

/**
 * The backup API over HTTP (RELAY step 32a) against `next start`: a scripted TV, calling from a
 * `file://` page's origin (`Origin: null`), puts an envelope, gets it back and opens it, is
 * refused with another token, and deletes it. The route's own answers are unit-tested against
 * Postgres (apps/web/test/backup.web.test.ts); this proves the built server serves them.
 */

const PROFILE = '{"v":8,"sources":[{"id":"s1","type":"xtream","server":"http://panel.marker.example:8080","username":"marker-user","password":"marker-pass"}]}';

test('a TV puts its backup, gets it back after a wipe, and deletes it', async ({ request, address }) => {
  const tv = backupKeys(new Uint8Array(randomBytes(32)));
  const path = `/v1/backup/${tv.lookupId}`;
  const from = { 'x-forwarded-for': address, origin: 'null' };
  const write = { ...from, [BACKUP_WRITE_HEADER]: tv.writeToken };

  // The browser's preflight for a PUT with the token's header.
  const preflight = await request.fetch(path, {
    method: 'OPTIONS',
    headers: { ...from, 'access-control-request-method': 'PUT', 'access-control-request-headers': `content-type, ${BACKUP_WRITE_HEADER}` },
  });
  expect([preflight.status(), preflight.headers()['access-control-allow-origin'], preflight.headers()['access-control-allow-methods'], preflight.headers()['access-control-allow-headers']]).toStrictEqual([
    204,
    '*',
    'PUT, GET, DELETE, OPTIONS',
    'content-type, x-write-token',
  ]);

  expect((await request.get(path, { headers: from })).status()).toBe(404);

  const envelope = sealBackup(utf8(PROFILE), tv.encKey);
  const put = await request.put(path, { headers: write, data: envelope });
  expect([put.status(), await put.json(), put.headers()['access-control-allow-origin'], put.headers()['cache-control']]).toStrictEqual([200, { state: 'stored' }, '*', 'no-store']);
  // The row: the token's hash and the size, found by both.
  expect(await sql('SELECT 1 FROM "Backup" WHERE "lookupId" = $1 AND "writeTokenHash" = $2 AND "size" = $3', [tv.lookupId, tokenHash(tv.writeToken), JSON.stringify(envelope).length])).toBe(1);
  expect(await sql(`SELECT 1 FROM "Backup" WHERE row_to_json("Backup")::text LIKE '%marker%' OR row_to_json("Backup")::text LIKE $1`, [`%${tv.writeToken}%`])).toBe(0);

  // After a wipe the TV has only its device secret: the same keys, no token needed to read.
  const got = await request.get(path, { headers: from });
  expect([got.status(), got.headers()['access-control-allow-origin'], got.headers()['cache-control'], got.headers()['content-type']]).toStrictEqual([200, '*', 'no-store', 'application/json']);
  const text = await got.text();
  expect(text).not.toContain('marker');
  const opened = openBackup(backupEnvelopeSchema.parse(JSON.parse(text)), tv.encKey);
  expect(new TextDecoder().decode(opened!)).toBe(PROFILE);

  // Another TV's token changes nothing.
  const other = backupKeys(new Uint8Array(randomBytes(32)));
  const refused = await request.put(path, { headers: { ...from, [BACKUP_WRITE_HEADER]: other.writeToken }, data: sealBackup(utf8('{}'), other.encKey) });
  expect([refused.status(), refused.headers()['access-control-allow-origin']]).toStrictEqual([401, '*']);
  expect((await request.delete(path, { headers: { ...from, [BACKUP_WRITE_HEADER]: other.writeToken } })).status()).toBe(401);
  expect(await (await request.get(path, { headers: from })).text()).toBe(text);

  const deleted = await request.delete(path, { headers: write });
  expect([deleted.status(), await deleted.json()]).toStrictEqual([200, { state: 'deleted' }]);
  expect((await request.get(path, { headers: from })).status()).toBe(404);
  expect(await sql('SELECT 1 FROM "Backup" WHERE "lookupId" = $1', [tv.lookupId])).toBe(0);
});
