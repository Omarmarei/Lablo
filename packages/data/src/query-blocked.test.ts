// RELAY step 30b2: the query worker's `blocked(urls)`, from the config worker's cached copy (the
// `kv` store's `config`), read when first asked and again at `reloadConfig`.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_KEY } from './config-constants';
import { getValue, openDatabase, transact } from './idb';
import { QueryService } from './query-service';
import { STORE } from './schema';
import { configAnswer, configDocFields, freshFactory } from './test-support';

const SALT = 'QtHj17D-F3HxhSWwfvhERM83_Cu0K5lHS7cQ_PczpBA';
const hashOf = (host: string): string => createHash('sha256').update(SALT + host, 'utf8').digest('base64url');

const opened: IDBDatabase[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

/** The record the config worker keeps for a doc blocking `hosts` (its `doc` is the signed text). */
function record(hosts: string[]): unknown {
  const answer = JSON.parse(configAnswer(configDocFields({ blocklist: { salt: SALT, hashes: hosts.map(hashOf) } }))) as { doc: string; sig: string; country: string };
  return { doc: answer.doc, sig: answer.sig, country: answer.country, fetchedAt: 1 };
}

async function setup() {
  const factory = freshFactory();
  const db = await openDatabase(factory);
  opened.push(db);
  let opens = 0;
  let failOpen = false;
  const svc = new QueryService({
    openDb: async () => {
      opens++;
      if (failOpen) throw new Error('IndexedDB is gone');
      const other = await openDatabase(factory);
      opened.push(other);
      return other;
    },
  });
  const keep = (value: unknown) =>
    transact(db, STORE.kv, 'readwrite', (tx) => {
      if (value === undefined) tx.objectStore(STORE.kv).delete(CONFIG_KEY);
      else tx.objectStore(STORE.kv).put(value, CONFIG_KEY);
    });
  return {
    svc,
    keep,
    opens: () => opens,
    failOpen: (fail: boolean) => {
      failOpen = fail;
    },
    stored: () => getValue(db, STORE.kv, CONFIG_KEY),
  };
}

const URLS = ['http://bad.example/live/u/p/1.ts', 'https://cdn.bad.example:8443/a.m3u8', 'http://good.example/x', 'not a url'];

describe('QueryService.blocked', () => {
  it('blocks nothing before any config is cached', async () => {
    const { svc } = await setup();
    expect(await svc.blocked(URLS)).toEqual([false, false, false, false]);
    expect(await svc.blocked([])).toEqual([]);
  });

  it("answers from the cached copy's list: a listed host and its subdomains", async () => {
    const { svc, keep } = await setup();
    await keep(record(['bad.example']));
    expect(await svc.blocked(URLS)).toEqual([true, true, false, false]);
  });

  it('keeps the list it read until reloadConfig, which reads the new copy and gives its size', async () => {
    const { svc, keep, opens } = await setup();
    await keep(record(['bad.example']));
    expect(await svc.blocked(URLS)).toEqual([true, true, false, false]);
    await keep(record(['good.example', 'other.example', 'good.example']));
    // Read once: the list in memory still answers.
    expect(await svc.blocked(URLS)).toEqual([true, true, false, false]);
    expect(await svc.reloadConfig()).toBe(2);
    expect(await svc.blocked(URLS)).toEqual([false, false, true, false]);
    // A copy deleted (one this build no longer trusts): nothing blocked after the reload.
    await keep(undefined);
    expect(await svc.reloadConfig()).toBe(0);
    expect(await svc.blocked(URLS)).toEqual([false, false, false, false]);
    expect(opens()).toBe(1);
  });

  it('reads the list again after a failed read', async () => {
    const { svc, keep, failOpen } = await setup();
    await keep(record(['bad.example']));
    failOpen(true);
    await expect(svc.blocked(URLS)).rejects.toThrow('IndexedDB is gone');
    await expect(svc.reloadConfig()).rejects.toThrow('IndexedDB is gone');
    failOpen(false);
    expect(await svc.blocked(URLS)).toEqual([true, true, false, false]);
  });

  it('is served over RPC as `blocked` and `reloadConfig`', async () => {
    const { svc, keep } = await setup();
    const handlers = svc.handlers();
    await keep(record(['bad.example']));
    expect(await handlers.blocked({ urls: URLS.slice(0, 3) })).toEqual([true, true, false]);
    await keep(record([]));
    expect(await handlers.reloadConfig()).toBe(0);
    expect(await handlers.blocked({ urls: URLS.slice(0, 3) })).toEqual([false, false, false]);
  });
});
