// @lablo/crypto and @lablo/protocol as the TV runs them (RELAY steps 29b1 and 29b2a): the vectors worker
// (apps/tv/src/vectors/vectors.worker.ts) bundled by the TV pipeline (Rollup IIFE, Babel
// chrome 53, core-js, the ES2016 gate), then run in a fresh realm that stands in for a
// Chromium 53 worker: no `BigInt` (@noble/hashes has top-level BigInt calls that tree-shaking
// must drop), no `globalThis` (noble's scheduler reads it: core-js must fill it), none of the
// ES2017 APIs Chromium 53 lacks (zod 4's util.js has top-level BigInt calls too, and its core
// reads `globalThis` at load). Every shared vector and protocol sample must give the answers it
// gives in Node.
// The real engines run the same page in `pnpm verify:engines` (tools/engines/src/vectors.ts).
import { createHash, randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import type { CryptoVectors, VectorResult } from '@lablo/crypto/check-vectors';
import { checkVectors } from '@lablo/crypto/check-vectors';
import type { SampleResult } from '@lablo/protocol/check-samples';
import { checkQr } from '@lablo/core/check-qr';
import { checkSamples } from '@lablo/protocol/check-samples';
import { describe, expect, it } from 'vitest';
import { bundleIife } from '../tools/build/src/bundle';
import { CHROMIUM_53_MISSING } from './realm-support';

const ROOT = join(import.meta.dirname, '..');
const VECTORS = readFileSync(join(ROOT, 'packages/crypto/test/vectors.json'), 'utf8');

interface WorkerReply {
  readonly results: readonly VectorResult[] | null;
  readonly ms: number;
  readonly error: string | null;
}


describe('the crypto vectors worker bundle', () => {
  it('builds to gated Chromium 53 code and gives every vector and sample its Node answer without BigInt or globalThis', async () => {
    const input = join(ROOT, 'apps/tv/src/vectors/vectors.worker.ts');
    const { code } = await bundleIife({ input, platform: 'webos', label: 'vectors.worker.js' });
    // No top-level BigInt left: a call at load would throw on Chromium 53 before any check.
    expect(code).not.toMatch(/BigInt\s*\(\s*\d/);
    // zod gets only its listed polyfills (tools/build/src/bundle.ts DEPENDENCY_POLYFILLS), not the
    // ones its files name in code the protocol never runs: core-js's DOMException (which
    // `atob` pulls in) and URL would add about 70 KB.
    for (const marker of ['DATA_CLONE_ERR', 'searchParams']) expect([marker, code.includes(marker)]).toEqual([marker, false]);

    const replies: WorkerReply[] = [];
    const realm = vm.createContext({
      postMessage: (message: WorkerReply) => replies.push(JSON.parse(JSON.stringify(message)) as WorkerReply),
      TextEncoder,
      // Chromium 53 has crypto.getRandomValues in pages and workers.
      crypto: { getRandomValues: (array: Uint8Array): Uint8Array => randomFillSync(array) },
      setTimeout,
      clearTimeout,
      __vectors: VECTORS,
    });
    vm.runInContext('var self = this;', realm);
    vm.runInContext(CHROMIUM_53_MISSING, realm);
    expect(vm.runInContext('typeof BigInt + " " + typeof globalThis + " " + typeof Object.values', realm)).toBe('undefined undefined undefined');
    vm.runInContext(code, realm);
    // core-js filled globalThis again (noble's scheduler and zod's core need it); BigInt stays missing.
    expect(vm.runInContext('typeof globalThis + " " + typeof BigInt', realm)).toBe('object undefined');
    vm.runInContext('self.onmessage({ data: JSON.parse(__vectors) })', realm);
    const deadline = Date.now() + 60_000;
    while (replies.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));

    expect(replies).toHaveLength(1);
    const reply = replies[0]!;
    expect(reply.error).toBeNull();
    const expected = [...(await checkVectors(JSON.parse(VECTORS) as CryptoVectors)), ...checkSamples(), ...checkQr()];
    expect(expected.filter((r) => r.name.startsWith('qr:')).length).toBe(6);
    expect(expected.filter((r) => r.name.startsWith('protocol:')).length).toBeGreaterThan(50);
    expect(reply.results!.filter((r) => !r.ok)).toEqual([]);
    expect(reply.results!.map((r) => r.name)).toEqual(expected.map((r) => r.name));
    console.log(`vectors worker: ${reply.results!.length} checks in ${reply.ms} ms, ${(code.length / 1024).toFixed(1)} KB`);
  });

  it("runs the protocol samples on zod's polyfill allowlist alone, without BigInt or globalThis", async () => {
    // Only @lablo/protocol and zod: no crypto or app code whose own polyfills (globalThis,
    // Object.entries…) would fill in for one missing from zod's list.
    const input = join(ROOT, 'test/protocol-bundle-entry.ts');
    const { code } = await bundleIife({ input, platform: 'webos', label: 'protocol samples' });
    expect(code).not.toMatch(/BigInt\s*\(\s*\d/);
    // No code generation either, as under a content security policy without 'unsafe-eval':
    // zod/mini's objects parse without `new Function`.
    const realm = vm.createContext({ setTimeout, clearTimeout }, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext('var self = this;', realm);
    vm.runInContext(CHROMIUM_53_MISSING, realm);
    expect(() => vm.runInContext('new Function("return 1")', realm)).toThrow(/Code generation from strings disallowed/);
    expect(vm.runInContext('typeof globalThis + " " + typeof Object.fromEntries + " " + typeof String.prototype.trimStart', realm)).toBe('undefined undefined undefined');
    vm.runInContext(code, realm);
    const results = JSON.parse(vm.runInContext('JSON.stringify(self.__results)', realm) as string) as SampleResult[];
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.map((r) => r.name)).toEqual(checkSamples().map((r) => r.name));
    expect(vm.runInContext('typeof globalThis + " " + typeof BigInt', realm)).toBe('object undefined');
    console.log(`protocol samples: ${results.length} checks, ${(code.length / 1024).toFixed(1)} KB`);
  });

  // RELAY step 30b1: @lablo/crypto is marked `"sideEffects": false`, so a bundle keeps only the
  // modules whose exports it uses. tweetnacl itself isn't marked, so wherever `random.ts` is kept,
  // tweetnacl's module body still runs and hands it the platform's getRandomValues.
  it('keeps tweetnacl and its PRNG in a bundle that uses randomBytes alone', async () => {
    const { code } = await bundleIife({ input: join(ROOT, 'test/crypto-random-entry.ts'), platform: 'webos', label: 'randomBytes alone' });
    expect(code).toContain('no PRNG');
    let calls = 0;
    const realm = vm.createContext({
      crypto: {
        getRandomValues: (array: Uint8Array): Uint8Array => {
          calls++;
          return randomFillSync(array);
        },
      },
    });
    vm.runInContext('var self = this;', realm);
    vm.runInContext(CHROMIUM_53_MISSING, realm);
    vm.runInContext(code, realm);
    const a = vm.runInContext('Array.prototype.slice.call(self.__random(32)).join()', realm) as string;
    const b = vm.runInContext('Array.prototype.slice.call(self.__random(32)).join()', realm) as string;
    expect(a.split(',')).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(calls).toBeGreaterThanOrEqual(2);

    // Without a platform CSPRNG it refuses rather than make weaker bytes.
    const bare = vm.createContext({});
    vm.runInContext('var self = this;', bare);
    vm.runInContext(code, bare);
    expect(() => vm.runInContext('self.__random(32)', bare)).toThrow(/no PRNG/);
  });

  it('keeps none of tweetnacl in a bundle that uses blocklistHash alone', async () => {
    const { code } = await bundleIife({ input: join(ROOT, 'test/crypto-blocklist-entry.ts'), platform: 'webos', label: 'blocklistHash alone' });
    for (const marker of ['no PRNG', 'bad key size', 'unexpected type, use Uint8Array']) expect([marker, code.includes(marker)]).toEqual([marker, false]);
    expect(code).not.toMatch(/BigInt\s*\(\s*\d/);
    const realm = vm.createContext({ TextEncoder, setTimeout, clearTimeout }, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext('var self = this;', realm);
    vm.runInContext(CHROMIUM_53_MISSING, realm);
    vm.runInContext(code, realm);
    const salt = 'QtHj17D-F3HxhSWwfvhERM83_Cu0K5lHS7cQ_PczpBA';
    expect(vm.runInContext(`self.__hash(${JSON.stringify(salt)}, "blocked.example")`, realm)).toBe(createHash('sha256').update(salt + 'blocked.example', 'utf8').digest('base64url'));
    console.log(`blocklistHash alone: ${(code.length / 1024).toFixed(1)} KB`);
  });
});
