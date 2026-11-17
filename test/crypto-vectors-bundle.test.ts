// @lablo/crypto as the TV runs it (RELAY step 29b1): the vectors worker
// (apps/tv/src/vectors/vectors.worker.ts) bundled by the TV pipeline (Rollup IIFE, Babel
// chrome 53, core-js, the ES2016 gate), then run in a fresh realm that stands in for a
// Chromium 53 worker: no `BigInt` (@noble/hashes has top-level BigInt calls that tree-shaking
// must drop), no `globalThis` (noble's scheduler reads it: core-js must fill it), none of the
// ES2017 APIs Chromium 53 lacks. Every shared vector must give the answers it gives in Node.
// The real engines run the same page in `pnpm verify:engines` (tools/engines/src/vectors.ts).
import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import type { CryptoVectors, VectorResult } from '@lablo/crypto/check-vectors';
import { checkVectors } from '@lablo/crypto/check-vectors';
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
  'delete Array.prototype.flat; delete Array.prototype.flatMap;',
  'delete Promise.prototype.finally;',
  'delete globalThis.queueMicrotask;',
  // Last: from here on the realm's own global is reachable only as `self`.
  'delete globalThis.globalThis;',
].join('\n');

describe('the crypto vectors worker bundle', () => {
  it('builds to gated Chromium 53 code and gives every vector its Node answer without BigInt or globalThis', async () => {
    const input = join(ROOT, 'apps/tv/src/vectors/vectors.worker.ts');
    const { code } = await bundleIife({ input, platform: 'webos', label: 'vectors.worker.js' });
    // No top-level BigInt left: a call at load would throw on Chromium 53 before any check.
    expect(code).not.toMatch(/BigInt\s*\(\s*\d/);

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
    // core-js filled globalThis again (noble's scheduler needs it); BigInt stays missing.
    expect(vm.runInContext('typeof globalThis + " " + typeof BigInt', realm)).toBe('object undefined');
    vm.runInContext('self.onmessage({ data: JSON.parse(__vectors) })', realm);
    const deadline = Date.now() + 60_000;
    while (replies.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));

    expect(replies).toHaveLength(1);
    const reply = replies[0]!;
    expect(reply.error).toBeNull();
    const expected = await checkVectors(JSON.parse(VECTORS) as CryptoVectors);
    expect(reply.results!.filter((r) => !r.ok)).toEqual([]);
    expect(reply.results!.map((r) => r.name)).toEqual(expected.map((r) => r.name));
    console.log(`vectors worker: ${reply.results!.length} checks in ${reply.ms} ms, ${(code.length / 1024).toFixed(1)} KB`);
  });
});
