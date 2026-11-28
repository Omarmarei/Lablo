// The config worker as the TV runs it (RELAY step 30b2): `packages/data/src/config.worker.ts`
// bundled by the TV pipeline (Rollup IIFE, Babel chrome 68, core-js, the ES2019 gate), checked
// against the worker budget, then started in fresh realms that stand in for Chromium 68 workers:
// no `globalThis` (zod's core reads it at load: core-js must fill it), none of the newer APIs
// Chromium 68 lacks, and no code generation (zod/mini parses without `new Function`, as under a content
// security policy). `fetch` answers a dev-signed config; IndexedDB is fake-indexeddb, shared by
// the runs as a TV's database is.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { toBase64Url } from '@lablo/crypto';
import type { ConfigResult, RpcPort } from '@lablo/data';
import { CONFIG_KEY, STORE, createConfigClient, getValue, openDatabase } from '@lablo/data';
import { describe, expect, it } from 'vitest';
import { configAnswer, configDocFields, configSigner, freshFactory } from '../packages/data/src/test-support';
import { checkBudget, formatBudget } from '../tools/build/src/budgets';
import { bundleIife } from '../tools/build/src/bundle';
import { CHROMIUM_68_MISSING, pipe } from './realm-support';

const SALT = 'QtHj17D-F3HxhSWwfvhERM83_Cu0K5lHS7cQ_PczpBA';
const KEYS = [toBase64Url(configSigner().publicKey)];
const REQUEST = { base: 'http://api.test', platform: 'tizen' as const, version: '0.1.0', keys: KEYS };

/** Starts `code` in a fresh Chromium 68 stand-in realm; `answer` is what its fetch gets. */
function startWorker(code: string, factory: IDBFactory, answer: () => Response): { port: RpcPort; asked: string[] } {
  const [workerPort, uiPort] = pipe();
  const asked: string[] = [];
  const realm = vm.createContext(
    {
      fetch: (url: string): Promise<Response> => {
        asked.push(url);
        return Promise.resolve(answer());
      },
      TextEncoder,
      TextDecoder,
      postMessage: workerPort.postMessage,
      addEventListener: workerPort.addEventListener,
      removeEventListener: workerPort.removeEventListener,
      indexedDB: factory,
      IDBKeyRange,
      setTimeout,
      clearTimeout,
    },
    { codeGeneration: { strings: false, wasm: false } },
  );
  vm.runInContext('var self = this;', realm);
  vm.runInContext(CHROMIUM_68_MISSING, realm);
  expect(vm.runInContext('typeof globalThis + " " + typeof Object.fromEntries', realm)).toBe('undefined undefined');
  expect(() => vm.runInContext('new Function("return 1")', realm)).toThrow(/Code generation from strings disallowed/);
  vm.runInContext(code, realm);
  // core-js filled globalThis again.
  expect(vm.runInContext('typeof globalThis', realm)).toBe('object');
  return { port: uiPort, asked };
}

async function run(port: RpcPort): Promise<{ cached: ConfigResult[]; result: ConfigResult }> {
  const client = createConfigClient(port);
  const cached: ConfigResult[] = [];
  client.on('cached', (r) => cached.push(r));
  const result = await client.call('run', REQUEST);
  client.close();
  return { cached, result };
}

describe('the bundled config worker', () => {
  it('builds to gated Chromium 68 code within the worker budget, and checks, keeps and re-reads a dev-signed config without globalThis or code generation', async () => {
    const input = join(import.meta.dirname, '..', 'packages', 'data', 'src', 'config.worker.ts');
    const { code } = await bundleIife({ input, platform: 'tizen', label: 'config.worker.js' });
    const budget = checkBudget('config.worker.js', 'worker', code);
    console.log(formatBudget(budget));
    expect(budget.ok).toBe(true);
    // zod gets only its listed polyfills: no core-js DOMException or URL (about 70 KB).
    for (const marker of ['DATA_CLONE_ERR', 'searchParams']) expect([marker, code.includes(marker)]).toEqual([marker, false]);

    const now = Date.now();
    const doc = configDocFields({
      issuedAt: now - 60_000,
      expiresAt: now + 86_400_000,
      minVersion: { tizen: '0.2.0' },
      kill: [
        { id: 'tell', match: {}, mode: 'notice', message: { en: 'Hello', ar: 'Marhaba' } },
        { id: 'stop', match: { platform: 'tizen', countries: ['AE'] }, mode: 'block-new-sources' },
        { id: 'elsewhere', match: { platform: 'webos' }, mode: 'disable-app' },
      ],
      blocklist: { salt: SALT, hashes: [createHash('sha256').update(`${SALT}blocked.example`, 'utf8').digest('base64url')] },
      // Step 40b: the test stream's link reaches the policy through the bundled schema.
      testStream: { url: 'https://media.lablo.example/test/pattern.m3u8' },
    });
    const factory = freshFactory();

    // First run: nothing cached; the answer is checked, applied and kept.
    const first = startWorker(code, factory, () => new Response(configAnswer(doc, configSigner(), 'AE'), { status: 200 }));
    const one = await run(first.port);
    expect(first.asked).toEqual(['http://api.test/v1/config']);
    expect(one.cached).toEqual([{ status: 'none', policy: { kill: null, notices: [], updateRequired: false, minVersion: null, flags: {}, tunables: {}, testStream: null }, issuedAt: null, expiresAt: null, failure: null, stored: false }]);
    expect(one.result).toEqual({
      status: 'fresh',
      policy: {
        kill: { id: 'stop', mode: 'block-new-sources', message: null },
        notices: [{ id: 'tell', mode: 'notice', message: { en: 'Hello', ar: 'Marhaba' } }],
        updateRequired: true,
        minVersion: '0.2.0',
        flags: {},
        tunables: {},
        testStream: 'https://media.lablo.example/test/pattern.m3u8',
      },
      issuedAt: now - 60_000,
      expiresAt: now + 86_400_000,
      failure: null,
      stored: true,
    });
    const db = await openDatabase(factory);
    expect(await getValue(db, STORE.kv, CONFIG_KEY)).toMatchObject({ country: 'AE', sig: expect.any(String) as string });
    db.close();

    // Second worker: the cached copy is verified again and sent first; a failed fetch keeps it.
    const second = startWorker(code, factory, () => new Response('down', { status: 503 }));
    const two = await run(second.port);
    expect(two.cached.map((r) => `${r.status} ${r.policy.kill?.id ?? '-'}`)).toEqual(['cached stop']);
    expect(two.result).toMatchObject({ status: 'cached', failure: 'status', policy: { kill: { id: 'stop' } } });

    // Third: a doc signed by another key is refused, and the cached copy stays in force.
    const forged = startWorker(code, factory, () => new Response(configAnswer(configDocFields({ issuedAt: now, expiresAt: now + 1000 }), configSigner('not the dev key')), { status: 200 }));
    expect((await run(forged.port)).result).toMatchObject({ status: 'cached', failure: 'bad-signature', policy: { kill: { id: 'stop' } } });
  }, 120_000);
});
