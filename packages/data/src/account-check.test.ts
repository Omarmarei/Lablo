import { afterEach, describe, expect, it } from 'vitest';
import type { XtreamAccount } from '@zoma/core';
import { LOGIN_REFUSED, checkAccount, sourceAccount } from './account-check';
import { createDataClient } from './client';
import { openDatabase } from './idb';
import type { SourceRecord } from './profile';
import { QueryService } from './query-service';
import type { RpcPort } from './rpc';
import { serveRpc } from './rpc';
import { textTransport } from './short-epg';
import { fakeTransport, freshFactory } from './test-support';

const ACCOUNT: XtreamAccount = { base: 'http://panel.test:8080', username: 'u1', password: 'p 1' };
const LOGIN = 'http://panel.test:8080/player_api.php?username=u1&password=p%201';

function userInfo(fields: Record<string, unknown>): string {
  return JSON.stringify({ user_info: fields, server_info: { url: 'panel.test', port: '8080' } });
}

const opened: MessagePort[] = [];
afterEach(() => {
  for (const port of opened.splice(0)) port.close();
});

describe('checkAccount (the player error card, RELAY step 20a)', () => {
  it("asks the panel's player_api.php and keeps what the card shows", async () => {
    const panel = fakeTransport(() => ({
      body: userInfo({ auth: 1, status: 'Expired', exp_date: '1700000000', active_cons: '1', max_connections: '2', is_trial: '0', message: 'Renew' }),
    }));
    expect(await checkAccount(ACCOUNT, textTransport(panel))).toEqual({ auth: true, status: 'Expired', expDate: 1_700_000_000, activeCons: 1, maxConnections: 2 });
    expect(panel.requests.map((r) => r.url)).toEqual([LOGIN]);
  });

  it('says the login was refused for 401 and 403, and for auth 0', async () => {
    for (const status of [401, 403]) {
      const panel = fakeTransport(() => ({ status, body: 'no' }));
      expect(await checkAccount(ACCOUNT, textTransport(panel))).toEqual(LOGIN_REFUSED);
    }
    const zero = fakeTransport(() => ({ body: userInfo({ auth: 0 }) }));
    expect(await checkAccount(ACCOUNT, textTransport(zero))).toMatchObject({ auth: false });
  });

  it('gives null for an answer without user_info, and rejects other failures without the URL', async () => {
    expect(await checkAccount(ACCOUNT, textTransport(fakeTransport(() => ({ body: '{"server_info":{}}' }))))).toBeNull();
    const down = checkAccount(ACCOUNT, textTransport(fakeTransport(() => ({ status: 503, body: 'busy' }))));
    await expect(down).rejects.toMatchObject({ name: 'XtreamError', code: 'http', status: 503 });
    await expect(down).rejects.not.toThrow(/panel\.test|u1/);
    await expect(checkAccount(ACCOUNT, textTransport(fakeTransport(() => ({ body: '<html>' }))))).rejects.toMatchObject({ code: 'format' });
  });

  it("finds the panel of an Xtream source and of an M3U source's get.php link; a plain playlist has none", () => {
    const xtream: SourceRecord = { id: 's1', type: 'xtream', name: 'P', account: ACCOUNT, added: 1 };
    const getPhp: SourceRecord = { id: 's2', type: 'm3u', name: 'G', url: 'http://panel.test:8080/get.php?username=u1&password=p%201&type=m3u_plus', added: 1 };
    const plain: SourceRecord = { id: 's3', type: 'm3u', name: 'L', url: 'http://lists.test/tv.m3u', added: 1 };
    expect(sourceAccount(xtream)).toBe(ACCOUNT);
    expect(sourceAccount(getPhp)).toMatchObject({ base: 'http://panel.test:8080', username: 'u1', password: 'p 1' });
    expect(sourceAccount(plain)).toBeNull();
  });
});

describe("QueryService.account: the source's account over RPC", () => {
  it('checks the stored source by id, and has nothing to say for others', async () => {
    const factory = freshFactory();
    const db = await openDatabase(factory);
    const panel = fakeTransport(() => ({ body: userInfo({ auth: 1, status: 'Active', active_cons: 2, max_connections: 2 }) }));
    const svc = new QueryService({ openDb: () => openDatabase(factory), transport: panel });
    const { port1, port2 } = new MessageChannel();
    opened.push(port1, port2);
    serveRpc(port1, svc.handlers());
    const client = createDataClient(port2 as unknown as RpcPort);
    // No profile yet.
    expect(await client.call('account', { src: 's1' })).toBeNull();
    await client.call('editProfile', { kind: 'source', source: { id: 's1', type: 'xtream', name: 'P', account: ACCOUNT, added: 1 } });
    await client.call('editProfile', { kind: 'source', source: { id: 's2', type: 'm3u', name: 'L', url: 'http://lists.test/tv.m3u', added: 2 } });
    expect(await client.call('account', { src: 's1' })).toEqual({ auth: true, status: 'Active', expDate: null, activeCons: 2, maxConnections: 2 });
    expect(await client.call('account', { src: 's2' })).toBeNull();
    expect(await client.call('account', { src: 's9' })).toBeNull();
    expect(panel.requests.map((r) => r.url)).toEqual([LOGIN]);
    // A worker without a network never asks.
    const offline = new QueryService({ openDb: () => openDatabase(factory) });
    expect(await offline.account('s1')).toBeNull();
    expect(panel.requests).toHaveLength(1);
    db.close();
  });
});
