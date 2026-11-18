import { tokenHash } from '@lablo/crypto';
import { BACKUP_BODY_MAX_BYTES } from '@lablo/protocol/backup-limits';
import { describe, expect, it } from 'vitest';
import { envelopeBody } from './backup-api';
import { backupStandIn } from './backup-stand-in';
import type { ByteResponse } from './bytes';

const BASE = 'http://api.test';
const ID = 'A'.repeat(42) + 'E';
const OTHER_ID = 'C'.repeat(42) + 'g';
const TOKEN = 'B'.repeat(42) + 'I';
const OTHER_TOKEN = 'D'.repeat(42) + 'M';
const ENVELOPE = { v: 1 as const, kdf: 'scrypt-15-8-1' as const, nonce: 'N'.repeat(32), ct: 'Q2lwaGVydGV4dA' };

async function text(response: ByteResponse): Promise<string> {
  let out = '';
  for (let chunk = await response.read(); chunk !== null; chunk = await response.read()) out += new TextDecoder().decode(chunk);
  return out;
}

function call(api: ReturnType<typeof backupStandIn>, method: 'GET' | 'PUT' | 'DELETE', id: string, token: string | null = null, body?: string) {
  const headers: Record<string, string> = token === null ? {} : { 'x-write-token': token };
  return api.transport.get(`${BASE}/v1/backup/${id}`, body === undefined ? { method, headers } : { method, headers, body }).then(async (r) => ({ status: r.status, text: await text(r) }));
}

describe('backupStandIn (the backup API in memory)', () => {
  it('stores the first PUT under its token, answers it to a GET with no token, and keeps only the hash', async () => {
    const api = backupStandIn();
    expect(await call(api, 'GET', ID)).toEqual({ status: 404, text: '{"error":"not_found"}' });
    expect(await call(api, 'PUT', ID, TOKEN, envelopeBody(ENVELOPE))).toEqual({ status: 200, text: '{"state":"stored"}' });
    expect(await call(api, 'GET', ID)).toEqual({ status: 200, text: envelopeBody(ENVELOPE) });
    expect(api.hashes.get(ID)).toBe(tokenHash(TOKEN));
    expect([...api.hashes.values()]).not.toContain(TOKEN);
    expect(api.requests).toEqual([
      { method: 'GET', lookupId: ID, token: null, status: 404 },
      { method: 'PUT', lookupId: ID, token: TOKEN, status: 200 },
      { method: 'GET', lookupId: ID, token: null, status: 200 },
    ]);
  });

  it("keeps only the envelope's four fields", async () => {
    const api = backupStandIn();
    await call(api, 'PUT', ID, TOKEN, JSON.stringify({ ...ENVELOPE, extra: 'x' }));
    expect(api.blobs.get(ID)).toBe(envelopeBody(ENVELOPE));
  });

  it("refuses another token, none, or a malformed one, and leaves the stored envelope as it was", async () => {
    const api = backupStandIn();
    await call(api, 'PUT', ID, TOKEN, envelopeBody(ENVELOPE));
    const other = envelopeBody({ ...ENVELOPE, ct: 'T3RoZXI' });
    expect((await call(api, 'PUT', ID, OTHER_TOKEN, other)).status).toBe(401);
    expect((await call(api, 'PUT', ID, null, other)).status).toBe(401);
    expect((await call(api, 'PUT', ID, 'short', other)).status).toBe(401);
    expect((await call(api, 'DELETE', ID, OTHER_TOKEN)).status).toBe(401);
    expect((await call(api, 'DELETE', ID)).status).toBe(401);
    expect(api.blobs.get(ID)).toBe(envelopeBody(ENVELOPE));
    // The token itself replaces it.
    expect((await call(api, 'PUT', ID, TOKEN, other)).status).toBe(200);
    expect(api.blobs.get(ID)).toBe(other);
  });

  it('refuses a first PUT with no token or a malformed one, claiming nothing', async () => {
    const api = backupStandIn();
    expect((await call(api, 'PUT', ID, null, envelopeBody(ENVELOPE))).status).toBe(401);
    expect((await call(api, 'PUT', ID, 'short', envelopeBody(ENVELOPE))).status).toBe(401);
    expect(api.hashes.size).toBe(0);
    expect(api.blobs.size).toBe(0);
  });

  it(`takes a body of exactly ${BACKUP_BODY_MAX_BYTES} bytes, and refuses one byte more with 413`, async () => {
    const api = backupStandIn();
    const bare = envelopeBody({ ...ENVELOPE, ct: '' }).length;
    const fits = envelopeBody({ ...ENVELOPE, ct: 'A'.repeat(BACKUP_BODY_MAX_BYTES - bare) });
    expect(fits.length).toBe(BACKUP_BODY_MAX_BYTES);
    expect((await call(api, 'PUT', ID, TOKEN, fits)).status).toBe(200);
    const over = envelopeBody({ ...ENVELOPE, ct: 'A'.repeat(BACKUP_BODY_MAX_BYTES - bare + 1) });
    expect((await call(api, 'PUT', OTHER_ID, TOKEN, over)).status).toBe(413);
    expect(api.blobs.has(OTHER_ID)).toBe(false);
    expect(api.hashes.has(OTHER_ID)).toBe(false);
    // Counted in bytes, not characters.
    const arabic = envelopeBody({ ...ENVELOPE, ct: 'ب'.repeat((BACKUP_BODY_MAX_BYTES - bare) / 2) + 'A' });
    expect((await call(api, 'PUT', OTHER_ID, TOKEN, arabic)).status).toBe(413);
  });

  it.each([
    ['nothing', undefined],
    ['text that is not JSON', 'nonsense'],
    ['another version', JSON.stringify({ ...ENVELOPE, v: 2 })],
    ['no ciphertext', JSON.stringify({ v: 1, kdf: ENVELOPE.kdf, nonce: ENVELOPE.nonce })],
  ])('refuses a body that is %s with 400, claiming nothing', async (_, body) => {
    const api = backupStandIn();
    expect((await call(api, 'PUT', ID, TOKEN, body)).status).toBe(400);
    expect(api.hashes.size).toBe(0);
    expect(api.blobs.size).toBe(0);
  });

  it('deletes with the token, after which the lookup ID is free to claim again', async () => {
    const api = backupStandIn();
    expect((await call(api, 'DELETE', ID, TOKEN)).status).toBe(404);
    await call(api, 'PUT', ID, TOKEN, envelopeBody(ENVELOPE));
    expect(await call(api, 'DELETE', ID, TOKEN)).toEqual({ status: 200, text: '{"state":"deleted"}' });
    expect(api.blobs.size).toBe(0);
    expect(api.hashes.size).toBe(0);
    expect((await call(api, 'GET', ID)).status).toBe(404);
    expect((await call(api, 'PUT', ID, OTHER_TOKEN, envelopeBody(ENVELOPE))).status).toBe(200);
    expect(api.hashes.get(ID)).toBe(tokenHash(OTHER_TOKEN));
  });

  it.each([
    ['too short', 'A'.repeat(42)],
    ['too long', 'A'.repeat(44)],
    ['with unused bits set', 'A'.repeat(42) + 'B'],
    ['not base64url', 'A'.repeat(42) + '+'],
    ['missing', ''],
  ])('answers 404 to a lookup ID %s, whatever the method', async (_, id) => {
    const api = backupStandIn();
    for (const method of ['GET', 'PUT', 'DELETE'] as const) expect((await call(api, method, id, TOKEN, envelopeBody(ENVELOPE))).status).toBe(404);
    expect(api.hashes.size).toBe(0);
  });

  it('answers a path without the backup route as no lookup ID, and another method with 405', async () => {
    const api = backupStandIn();
    expect((await api.transport.get(`${BASE}/v1/config`)).status).toBe(404);
    expect((await api.transport.get(`${BASE}/v1/backup/${ID}`, { method: 'POST', body: envelopeBody(ENVELOPE) })).status).toBe(405);
  });

  it('answers each request once: a body read twice is empty the second time, and a cancel ends it', async () => {
    const api = backupStandIn();
    const response = await api.transport.get(`${BASE}/v1/backup/${ID}`);
    expect(await text(response)).toBe('{"error":"not_found"}');
    expect(await response.read()).toBeNull();
    const cancelled = await api.transport.get(`${BASE}/v1/backup/${ID}`);
    cancelled.cancel();
    expect(await cancelled.read()).toBeNull();
    expect(response.header('content-type')).toBeNull();
  });
});
