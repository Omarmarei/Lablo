import { backupKeys, openBackup, sealBackup, tokenHash, utf8 } from '@lablo/crypto';
import { BACKUP_BODY_MAX_BYTES } from '@lablo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUP_PATH, BackupStandIn, backupPath } from './backup-stand-in';
import type { PairServer } from './pair-server';
import { startPairServer } from './pair-server';

// RELAY step 32c2: the backup API in memory over HTTP, with the 32a server's rules, for the e2e's
// config server and the old-engine walk's pair server.

const KEYS = backupKeys(new Uint8Array(32).fill(7));
const OTHER = backupKeys(new Uint8Array(32).fill(8));
const NONCE = new Uint8Array(24).fill(3);

function envelopeText(plain = 'profile'): string {
  return JSON.stringify(sealBackup(utf8(plain), KEYS.encKey, NONCE));
}
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('BackupStandIn', () => {
  it('knows its paths', () => {
    expect(BACKUP_PATH).toBe('/v1/backup/');
    expect(backupPath(`/v1/backup/${KEYS.lookupId}`)).toBe(true);
    expect(backupPath('/v1/backup/x?y=1')).toBe(true);
    expect(backupPath('/v1/backups')).toBe(false);
    expect(backupPath('/v1/pair')).toBe(false);
    expect(backupPath('/x/v1/backup/')).toBe(false);
  });

  it('stores the first PUT under its token, answers GET with the envelope, and keeps only the hash', async () => {
    const api = new BackupStandIn();
    const url = BACKUP_PATH + KEYS.lookupId;
    expect((await api.answer('GET', url, undefined, new Uint8Array())).status).toBe(404);
    const put = await api.answer('PUT', url, KEYS.writeToken, bytes(envelopeText()));
    expect(put.status).toBe(200);
    expect(put.body).toBe('{"state":"stored"}');
    expect(put.headers['access-control-allow-origin']).toBe('*');
    expect(put.headers['cache-control']).toBe('no-store');
    expect(api.hashes.get(KEYS.lookupId)).toBe(tokenHash(KEYS.writeToken));
    const got = await api.answer('GET', url, undefined, new Uint8Array());
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('application/json');
    const opened = openBackup(JSON.parse(String(got.body)), KEYS.encKey);
    expect(new TextDecoder().decode(opened!)).toBe('profile');
    expect(api.requests).toEqual([
      { method: 'GET', lookupId: KEYS.lookupId, token: false, status: 404 },
      { method: 'PUT', lookupId: KEYS.lookupId, token: true, status: 200 },
      { method: 'GET', lookupId: KEYS.lookupId, token: false, status: 200 },
    ]);
  });

  it('keeps only the envelope’s four fields', async () => {
    const api = new BackupStandIn();
    const sealed = JSON.parse(envelopeText()) as Record<string, unknown>;
    await api.answer('PUT', BACKUP_PATH + KEYS.lookupId, KEYS.writeToken, bytes(JSON.stringify({ ...sealed, extra: 'x' })));
    expect(Object.keys(JSON.parse(api.blobs.get(KEYS.lookupId)!) as object)).toEqual(['v', 'kdf', 'nonce', 'ct']);
  });

  it('refuses another token, none or a malformed one, changing nothing', async () => {
    const api = new BackupStandIn();
    const url = BACKUP_PATH + KEYS.lookupId;
    expect((await api.answer('PUT', url, undefined, bytes(envelopeText()))).status).toBe(401);
    expect((await api.answer('PUT', url, 'short', bytes(envelopeText()))).status).toBe(401);
    expect(api.blobs.size).toBe(0);
    await api.answer('PUT', url, KEYS.writeToken, bytes(envelopeText('first')));
    expect((await api.answer('PUT', url, OTHER.writeToken, bytes(envelopeText('second')))).status).toBe(401);
    expect((await api.answer('DELETE', url, OTHER.writeToken, new Uint8Array())).status).toBe(401);
    expect((await api.answer('DELETE', url, undefined, new Uint8Array())).status).toBe(401);
    expect(new TextDecoder().decode(openBackup(JSON.parse(api.blobs.get(KEYS.lookupId)!), KEYS.encKey)!)).toBe('first');
    // The owner replaces it.
    expect((await api.answer('PUT', url, KEYS.writeToken, bytes(envelopeText('second')))).status).toBe(200);
    expect(new TextDecoder().decode(openBackup(JSON.parse(api.blobs.get(KEYS.lookupId)!), KEYS.encKey)!)).toBe('second');
  });

  it('refuses a body that is no envelope (400) or over 512 KB (413), and a malformed lookup ID (404)', async () => {
    const api = new BackupStandIn();
    const url = BACKUP_PATH + KEYS.lookupId;
    expect((await api.answer('PUT', url, KEYS.writeToken, bytes('{"v":1}'))).status).toBe(400);
    expect((await api.answer('PUT', url, KEYS.writeToken, bytes('not json'))).status).toBe(400);
    expect((await api.answer('PUT', url, KEYS.writeToken, new Uint8Array(BACKUP_BODY_MAX_BYTES + 1).fill(32))).status).toBe(413);
    expect((await api.answer('GET', `${BACKUP_PATH}short`, undefined, new Uint8Array())).status).toBe(404);
    expect((await api.answer('PUT', `${BACKUP_PATH}short`, KEYS.writeToken, bytes(envelopeText()))).status).toBe(404);
    expect((await api.answer('POST', url, KEYS.writeToken, bytes(envelopeText()))).status).toBe(405);
    expect(api.blobs.size).toBe(0);
    expect(api.hashes.size).toBe(0);
  });

  it('deletes with the token, frees the ID, and answers 404 for nothing', async () => {
    const api = new BackupStandIn();
    const url = BACKUP_PATH + KEYS.lookupId;
    expect((await api.answer('DELETE', url, KEYS.writeToken, new Uint8Array())).status).toBe(404);
    await api.answer('PUT', url, KEYS.writeToken, bytes(envelopeText()));
    const deleted = await api.answer('DELETE', url, KEYS.writeToken, new Uint8Array());
    expect(deleted.status).toBe(200);
    expect(deleted.body).toBe('{"state":"deleted"}');
    expect(api.blobs.size).toBe(0);
    expect(api.hashes.size).toBe(0);
    // Free to claim with another token.
    expect((await api.answer('PUT', url, OTHER.writeToken, bytes(envelopeText()))).status).toBe(200);
  });

  it('answers the preflight for its methods and the write header, unrecorded', async () => {
    const api = new BackupStandIn();
    const answer = await api.answer('OPTIONS', BACKUP_PATH + KEYS.lookupId, undefined, new Uint8Array());
    expect(answer.status).toBe(204);
    expect(answer.headers).toMatchObject({
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type, x-write-token',
    });
    expect(api.requests).toEqual([]);
  });

  it('holds GETs until let go, and only GETs', async () => {
    const api = new BackupStandIn();
    const url = BACKUP_PATH + KEYS.lookupId;
    const release = api.holdGets();
    let answered = false;
    const get = api.answer('GET', url, undefined, new Uint8Array()).then((a) => {
      answered = true;
      return a;
    });
    // A PUT goes through meanwhile.
    expect((await api.answer('PUT', url, KEYS.writeToken, bytes(envelopeText()))).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(answered).toBe(false);
    expect(api.held()).toBe(1);
    release();
    expect((await get).status).toBe(200);
    expect(api.held()).toBe(0);
    expect((await api.answer('GET', url, undefined, new Uint8Array())).status).toBe(200);
  });
});

let server: PairServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

describe('the pair server answers the backup routes (the old-engine walk)', () => {
  it('stores, reads and deletes over HTTP with the TV’s CORS, beside the pairing routes', async () => {
    server = await startPairServer('127.0.0.1');
    const url = `${server.origin}/v1/backup/${KEYS.lookupId}`;
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { origin: 'null', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type, x-write-token' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toBe('content-type, x-write-token');
    const put = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-write-token': KEYS.writeToken }, body: envelopeText() });
    expect(put.status).toBe(200);
    const got = await fetch(url);
    expect(got.status).toBe(200);
    expect(got.headers.get('access-control-allow-origin')).toBe('*');
    expect(new TextDecoder().decode(openBackup((await got.json()) as never, KEYS.encKey)!)).toBe('profile');
    expect((await fetch(url, { method: 'DELETE', headers: { 'x-write-token': KEYS.writeToken } })).status).toBe(200);
    expect((await fetch(url)).status).toBe(404);
    expect(server.backup.requests.map((r) => `${r.method} ${r.status}`)).toEqual(['PUT 200', 'GET 200', 'DELETE 200', 'GET 404']);
    // The pairing still answers, and anything else is a 404.
    expect((await fetch(`${server.origin}/v1/pair/NOCODE00`)).status).toBe(404);
    expect((await fetch(`${server.origin}/v1/config`)).status).toBe(404);
  });
});
