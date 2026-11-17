// @lablo/crypto and @lablo/protocol as the TV runs them (RELAY steps 29b1 and 29b2a): the vectors worker
// (apps/tv/src/vectors/vectors.worker.ts) bundled by the TV pipeline (Rollup IIFE, Babel
// chrome 53, core-js, the ES2016 gate), then run in a fresh realm that stands in for a
// Chromium 53 worker: no `BigInt` (@noble/hashes has top-level BigInt calls that tree-shaking
// must drop), no `globalThis` (noble's scheduler reads it: core-js must fill it), none of the
// ES2017 APIs Chromium 53 lacks (zod 4's util.js has top-level BigInt calls too, and its core
// reads `globalThis` at load). Every shared vector and protocol sample must give the answers it
// gives in Node.
// The real engines run the same page in `pnpm verify:engines` (tools/engines/src/vectors.ts).
import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import type { CryptoVectors, VectorResult } from '@lablo/crypto/check-vectors';
import { checkVectors } from '@lablo/crypto/check-vectors';
import type { SampleResult } from '@lablo/protocol/check-samples';
import { checkSamples } from '@lablo/protocol/check-samples';
import { describe, expect, it } from 'vitest';
import { bundleIife } from '../tools/build/src/bundle';

const ROOT = join(import.meta.dirname, '..');
const VECTORS = readFileSync(join(ROOT, 'packages/crypto/test/vectors.json'), 'utf8');

interface WorkerReply {
  readonly results: readonly VectorResult[] | null;
  readonly ms: number;
  readonly error: string | null;
}

/** What Chromium 53 lacks that core-js or the code could lean on. */
const CHROMIUM_53_MISSING = [
  'delete globalThis.BigInt;',
  'delete globalThis.BigInt64Array;',
  'delete globalThis.BigUint64Array;',
  'delete Object.entries; delete Object.values; delete Object.getOwnPropertyDescriptors; delete Object.fromEntries;',
  'delete String.prototype.padStart; delete String.prototype.padEnd;',
  // ES2019 and later (Chromium 66 and newer); `trimLeft` stays, Chromium 53 has it.
  'delete String.prototype.trimStart; delete String.prototype.trimEnd;',
  'delete Object.hasOwn; delete Array.prototype.at; delete String.prototype.at; delete Array.prototype.findLast; delete Array.prototype.findLastIndex;',
  'delete String.prototype.replaceAll; delete String.prototype.matchAll; delete Promise.allSettled; delete Promise.any;',
  'delete Array.prototype.flat; delete Array.prototype.flatMap;',
  'delete Promise.prototype.finally;',
  'delete globalThis.queueMicrotask;',
  // Last: from here on the realm's own global is reachable only as `self`.
  'delete globalThis.globalThis;',
].join('\n');

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
    const expected = [...(await checkVectors(JSON.parse(VECTORS) as CryptoVectors)), ...checkSamples()];
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
});
