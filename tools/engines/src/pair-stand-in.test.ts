import { newBoxKeyPair, toBase64Url } from '@lablo/crypto';
import { describe, expect, it } from 'vitest';
import type { StandInAnswer } from './pair-stand-in';
import { BLOB_PATH, PairStandIn, STAND_IN_CODE_MS, STAND_IN_URL_MS, blobKey, standInPath } from './pair-stand-in';

/**
 * The stand-in's file (RELAY step 31d2b2a), called directly with a pinned clock: the upload URL,
 * the blob and the TV's file URL, and each refusal the real routes give. The whole file pairing
 * over HTTP is in pair-server.test.ts.
 */

const NOW = 1_800_000_000_000;
const SEALED = { phonePk: toBase64Url(new Uint8Array(32).fill(1)), nonce: toBase64Url(new Uint8Array(24).fill(2)), ct: toBase64Url(new Uint8Array(40).fill(3)) };

interface Called {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly json: unknown;
}

function setup() {
  let now = NOW;
  const standIn = new PairStandIn(() => now);
  const call = (method: string, url: string, body: string | Uint8Array = '', token?: string): Called => {
    const answer: StandInAnswer | null = standIn.answer(method, url, token === undefined ? undefined : `Bearer ${token}`, typeof body === 'string' ? new TextEncoder().encode(body) : body);
    if (answer === null) throw new Error(`no answer for ${method} ${url}`);
    const bytes = typeof answer.body === 'string' ? new TextEncoder().encode(answer.body) : answer.body;
    const text = new TextDecoder().decode(bytes);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: answer.status, headers: answer.headers, text, bytes, json };
  };
  /** A TV's session: its code, id and poll token. */
  const tv = (purpose?: string) => {
    const tvPk = toBase64Url(newBoxKeyPair().publicKey);
    const made = call('POST', '/v1/pair', JSON.stringify(purpose === undefined ? { tvPk } : { tvPk, purpose })).json as { sid: string; code: string; pollToken: string };
    return { ...made, session: standIn.latest()! };
  };
  const uploadUrl = (code: string, size: number) => call('POST', `/v1/pair/${code}/upload-url`, JSON.stringify({ size }));
  return {
    standIn,
    call,
    tv,
    uploadUrl,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('the stand-in’s purpose (step 38c4)', () => {
  it('keeps a check, gives it to the phone, and takes only the statuses that fit', () => {
    const s = setup();
    const add = s.tv();
    const check = s.tv('check');
    expect([add.session.purpose, check.session.purpose]).toEqual(['add', 'check']);
    expect(s.call('GET', `/v1/pair/${check.code}`).json).toEqual({ tvPk: check.session.tvPk, exp: NOW + STAND_IN_CODE_MS, purpose: 'check' });
    expect(s.call('GET', `/v1/pair/${add.code}`).json).toMatchObject({ purpose: 'add' });
    for (const one of [add, check]) {
      s.call('POST', `/v1/pair/${one.code}/payload`, JSON.stringify(SEALED));
      s.call('GET', `/v1/pair/s/${one.sid}`, '', one.pollToken);
    }
    expect(s.call('POST', `/v1/pair/s/${add.sid}/status`, '{"status":"match"}', add.pollToken).status).toBe(400);
    expect(s.call('POST', `/v1/pair/s/${check.sid}/status`, '{"status":"ok"}', check.pollToken).status).toBe(400);
    expect([add.session.status, check.session.status]).toEqual([null, null]);
    expect(s.call('POST', `/v1/pair/s/${check.sid}/status`, '{"status":"no_match"}', check.pollToken).json).toEqual({ state: 'done', status: 'no_match' });
    expect(s.call('POST', '/v1/pair', JSON.stringify({ tvPk: add.session.tvPk, purpose: 'reset' })).status).toBe(400);
  });
});

describe('the stand-in’s file (step 31d2b2a)', () => {
  it('names its paths: the pairing API’s and the blob’s, nothing else', () => {
    expect(['/v1/pair', '/v1/pair/ABCD2345', '/v1/pair/s/x/file?a=1', '/dev/blob/pair/a/b?m=GET'].map(standInPath)).toEqual([true, true, true, true]);
    expect(['/v1/config', '/v1/pairs', '/dev/blobs/x', '/dev/blob', '/p', '/'].map(standInPath)).toEqual([false, false, false, false, false, false]);
    expect(setup().standIn.answer('GET', '/v1/config', undefined, new Uint8Array(0))).toBeNull();
  });

  it('gives the phone a PUT for exactly the size asked, then keeps the bytes; the TV gets a GET of them once it has read the payload', () => {
    const s = setup();
    const { code, sid, pollToken, session } = s.tv();
    const asked = s.uploadUrl(code, 48);
    expect(asked.status).toBe(200);
    // The phone's own route: no CORS for it.
    expect(asked.headers['access-control-allow-origin']).toBeUndefined();
    const put = asked.json as { url: string; key: string; exp: number };
    expect(put.key).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(put.key).toBe(session.fileId);
    expect(put.exp).toBe(NOW + STAND_IN_URL_MS);
    expect(put.url).toMatch(new RegExp(`^/dev/blob/pair/${sid}/${put.key}\\?m=PUT&n=48&e=${NOW + STAND_IN_URL_MS}&s=[A-Za-z0-9_-]{22}$`));

    const bytes = new Uint8Array(48).map((_, i) => i);
    const stored = s.call('PUT', put.url, bytes);
    expect(stored.status).toBe(200);
    expect(stored.headers['access-control-allow-origin']).toBeUndefined();
    expect(stored.headers['cache-control']).toBe('no-store');
    expect([...s.standIn.blobs.keys()]).toEqual([blobKey(sid, put.key)]);
    expect(session.uploads).toEqual([bytes]);
    // The stand-in keeps its own copy.
    bytes[0] = 99;
    expect(s.standIn.blobs.get(blobKey(sid, put.key))![0]).toBe(0);

    // Before the payload's read the TV gets no URL.
    expect(s.call('GET', `/v1/pair/s/${sid}/file`, '', pollToken)).toMatchObject({ status: 409, json: { error: 'conflict' } });
    expect(s.call('POST', `/v1/pair/${code}/payload`, JSON.stringify(SEALED)).status).toBe(200);
    expect(s.call('GET', `/v1/pair/s/${sid}`, '', pollToken).json).toMatchObject({ state: 'ready' });
    const located = s.call('GET', `/v1/pair/s/${sid}/file`, '', pollToken);
    expect(located.status).toBe(200);
    expect(located.headers['access-control-allow-origin']).toBe('*');
    const get = located.json as { url: string; key: string; exp: number };
    expect(get.key).toBe(put.key);
    expect(get.exp).toBe(NOW + STAND_IN_URL_MS);
    expect(get.url).toMatch(new RegExp(`^/dev/blob/pair/${sid}/${put.key}\\?m=GET&n=&e=${NOW + STAND_IN_URL_MS}&s=[A-Za-z0-9_-]{22}$`));

    const read = s.call('GET', get.url);
    expect(read.status).toBe(200);
    expect(read.headers).toMatchObject({ 'access-control-allow-origin': '*', 'content-type': 'application/octet-stream', 'content-length': '48', 'cache-control': 'no-store' });
    expect([...read.bytes]).toEqual([...new Uint8Array(48).map((_, i) => i)]);
    // A URL works more than once until it ends.
    expect(s.call('GET', get.url).status).toBe(200);

    // The status deletes the file: the URL answers 404, the TV gets no other.
    expect(s.call('POST', `/v1/pair/s/${sid}/status`, '{"status":"ok"}', pollToken).status).toBe(200);
    expect(s.standIn.blobs.size).toBe(0);
    expect(session.fileId).toBeNull();
    const gone = s.call('GET', get.url);
    expect(gone.status).toBe(404);
    expect(gone.headers['access-control-allow-origin']).toBe('*');
    expect(gone.text).toBe('');
    expect(s.call('GET', `/v1/pair/s/${sid}/file`, '', pollToken)).toMatchObject({ status: 404, json: { error: 'not_found' } });
    // What was uploaded stays for the test.
    expect(session.uploads).toHaveLength(1);
  });

  it('deletes the file with any status, a failure too', () => {
    const s = setup();
    const { code, sid, pollToken } = s.tv();
    const put = s.uploadUrl(code, 16).json as { url: string };
    s.call('PUT', put.url, new Uint8Array(16));
    s.call('POST', `/v1/pair/${code}/payload`, JSON.stringify(SEALED));
    s.call('GET', `/v1/pair/s/${sid}`, '', pollToken);
    expect(s.call('POST', `/v1/pair/s/${sid}/status`, '{"status":"unreachable"}', pollToken).status).toBe(200);
    expect(s.standIn.blobs.size).toBe(0);
  });

  it('refuses the upload URL as the real route does: an unknown or ended code, a payload already sent, a bad size', () => {
    const s = setup();
    const { code, session } = s.tv();
    for (const unknown of ['ABCD2345', 'abcd', 'ABCDEFGHI']) expect(s.uploadUrl(unknown, 48), unknown).toMatchObject({ status: 404, json: { error: 'not_found' } });
    for (const body of ['{"size":15}', '{"size":41943041}', '{"size":100.5}', '{}', 'not json']) {
      expect(s.call('POST', `/v1/pair/${code}/upload-url`, body), body).toMatchObject({ status: 400, json: { error: 'bad_request' } });
    }
    expect(session.fileId).toBeNull();
    expect(s.uploadUrl(code, 16).status).toBe(200);

    // A payload sent: 409, and the file stays.
    expect(s.call('POST', `/v1/pair/${code}/payload`, JSON.stringify(SEALED)).status).toBe(200);
    const fileId = session.fileId;
    expect(s.uploadUrl(code, 16)).toMatchObject({ status: 409, json: { error: 'conflict' } });
    expect(session.fileId).toBe(fileId);

    // An ended code with nothing sent: 404.
    const late = s.tv();
    s.advance(STAND_IN_CODE_MS);
    expect(s.uploadUrl(late.code, 16)).toMatchObject({ status: 404, json: { error: 'not_found' } });
    expect(late.session.fileId).toBeNull();
  });

  it('refuses a second payload, and keeps refusing a sent code once it ends: 409, not 404 (the real routes look at the row first)', () => {
    const s = setup();
    const { code } = s.tv();
    expect(s.call('POST', `/v1/pair/${code}/payload`, JSON.stringify(SEALED)).status).toBe(200);
    expect(s.call('POST', `/v1/pair/${code}/payload`, JSON.stringify(SEALED))).toMatchObject({ status: 409, json: { error: 'conflict' } });
    s.advance(STAND_IN_CODE_MS);
    expect(s.call('POST', `/v1/pair/${code}/payload`, JSON.stringify(SEALED))).toMatchObject({ status: 409 });
    expect(s.uploadUrl(code, 16)).toMatchObject({ status: 409, json: { error: 'conflict' } });
    // An ended code with nothing sent: 404 for the payload as for the file.
    const late = s.tv();
    s.advance(STAND_IN_CODE_MS);
    expect(s.call('POST', `/v1/pair/${late.code}/payload`, JSON.stringify(SEALED))).toMatchObject({ status: 404, json: { error: 'not_found' } });
    expect(late.session.posted).toEqual([]);
  });

  it('asked again, deletes the earlier file and gives another key', () => {
    const s = setup();
    const { code, sid, session } = s.tv();
    const first = s.uploadUrl(code, 16).json as { url: string; key: string };
    s.call('PUT', first.url, new Uint8Array(16));
    const second = s.uploadUrl(code, 20).json as { url: string; key: string };
    expect(second.key).not.toBe(first.key);
    expect(session.fileId).toBe(second.key);
    expect(s.standIn.blobs.size).toBe(0);
    expect(s.call('PUT', second.url, new Uint8Array(20)).status).toBe(200);
    expect([...s.standIn.blobs.keys()]).toEqual([blobKey(sid, second.key)]);
  });

  it('honours a blob URL only as given, for its method, before it ends, and a PUT only of exactly its size', () => {
    const s = setup();
    const { code, sid, pollToken } = s.tv();
    const put = (s.uploadUrl(code, 16).json as { url: string }).url;
    expect(s.call('PUT', put, new Uint8Array(15)).status).toBe(400);
    expect(s.call('PUT', put, new Uint8Array(17)).status).toBe(400);
    expect(s.call('PUT', put, new Uint8Array(0)).status).toBe(400);
    // Not the URL it gave: another token, another size, another key, no query.
    expect(s.call('PUT', put.replace(/s=[^&]+$/, 's=AAAAAAAAAAAAAAAAAAAAAA'), new Uint8Array(16)).status).toBe(403);
    expect(s.call('PUT', put.replace('n=16', 'n=17'), new Uint8Array(17)).status).toBe(403);
    expect(s.call('PUT', put.split('?')[0]!, new Uint8Array(16)).status).toBe(403);
    expect(s.call('PUT', `${BLOB_PATH}pair/${sid}/AAAAAAAAAAAAAAAAAAAAAA?m=PUT&n=16`, new Uint8Array(16)).status).toBe(403);
    expect(s.standIn.blobs.size).toBe(0);
    // A PUT's URL read: 403 with the TV's CORS (the browser reads the status).
    const wrong = s.call('GET', put);
    expect(wrong.status).toBe(403);
    expect(wrong.headers['access-control-allow-origin']).toBe('*');
    // Other methods: 404.
    for (const method of ['POST', 'DELETE', 'OPTIONS']) expect(s.call(method, put, new Uint8Array(16)).status, method).toBe(404);
    expect(s.call('PUT', put, new Uint8Array(16)).status).toBe(200);

    // A GET's URL can't write.
    s.call('POST', `/v1/pair/${code}/payload`, JSON.stringify(SEALED));
    s.call('GET', `/v1/pair/s/${sid}`, '', pollToken);
    const get = (s.call('GET', `/v1/pair/s/${sid}/file`, '', pollToken).json as { url: string }).url;
    expect(s.call('PUT', get, new Uint8Array(16)).status).toBe(403);

    // Ended URLs: 403, for the GET as for the PUT.
    s.advance(STAND_IN_URL_MS - 1);
    expect(s.call('GET', get).status).toBe(200);
    s.advance(1);
    expect(s.call('GET', get).status).toBe(403);
    expect(s.call('PUT', put, new Uint8Array(16)).status).toBe(403);
  });

  it('gives the file’s URL only with the session’s poll token, and only for a file it has', () => {
    const s = setup();
    const { code, sid, pollToken } = s.tv();
    expect(s.call('GET', `/v1/pair/s/${sid}/file`)).toMatchObject({ status: 401, json: { error: 'unauthorized' } });
    expect(s.call('GET', `/v1/pair/s/${sid}/file`, '', 'x'.repeat(43))).toMatchObject({ status: 401 });
    expect(s.call('GET', `/v1/pair/s/AAAAAAAAAAAAAAAAAAAAAA/file`, '', pollToken)).toMatchObject({ status: 404 });
    expect(s.call('POST', `/v1/pair/s/${sid}/file`, '', pollToken)).toMatchObject({ status: 404 });
    // A payload with no file.
    s.call('POST', `/v1/pair/${code}/payload`, JSON.stringify(SEALED));
    s.call('GET', `/v1/pair/s/${sid}`, '', pollToken);
    const none = s.call('GET', `/v1/pair/s/${sid}/file`, '', pollToken);
    expect(none).toMatchObject({ status: 404, json: { error: 'not_found' } });
    expect(none.headers['access-control-allow-origin']).toBe('*');
  });
});
