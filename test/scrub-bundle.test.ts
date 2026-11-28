// The telemetry scrubber as the TV runs it (RELAY step 33a): `@lablo/protocol/scrub` bundled by
// the TV pipeline (Rollup IIFE, Babel chrome 68, core-js, the ES2019 gate) and run in a realm that
// stands in for a Chromium 68 worker, where it must give every answer it gives in Node, and take
// no zod with it.
import { join } from 'node:path';
import vm from 'node:vm';
import { scrubText } from '@lablo/protocol/scrub';
import { describe, expect, it } from 'vitest';
import { bundleIife } from '../tools/build/src/bundle';
import { CHROMIUM_68_MISSING } from './realm-support';

const ROOT = join(import.meta.dirname, '..');

const CASES: readonly (readonly [string, readonly string[]])[] = [
  ["TypeError: x\n    at e.render (file:///media/developer/apps/usr/palm/applications/com.lablo.iptv/main.js:1:23456)\n    at r (blob:null/6e1b2f3a-9c4d-4e5f-8a7b-0c1d2e3f4a5b:1:12)", []],
  ['GET http://panel.example.com:8080/player_api.php?username=marker-user&password=marker-pass failed', []],
  ['login marker-pass-longer then marker-pass at panel.example.org', ['marker-pass', 'marker-pass-longer', 'panel.example']],
  ['{"username":"marker-user","password":"x"} /live/u/p/1.ts me@example.com 192.168.1.8:8080 fe80::1 line.tvhost.xyz', []],
  ['at 10:30:00 version 1.2.3 in main.js and app.css; 101.ts plays', []],
  ['a'.repeat(20000), []],
];

describe('the scrubber bundle', () => {
  it('builds to gated Chromium 68 code without zod and gives every answer it gives in Node', async () => {
    const { code } = await bundleIife({ input: join(ROOT, 'test/scrub-bundle-entry.ts'), platform: 'webos', label: 'scrub alone' });
    // No zod: its messages and its registry would be in the bundle.
    for (const marker of ['Invalid input', '$ZodType', 'zod']) expect([marker, code.includes(marker)]).toEqual([marker, false]);
    const realm = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    vm.runInContext('var self = this;', realm);
    vm.runInContext(CHROMIUM_68_MISSING, realm);
    vm.runInContext(code, realm);
    for (const [text, known] of CASES) {
      const got = vm.runInContext(`self.__scrub(${JSON.stringify(text)}, ${JSON.stringify(known)})`, realm) as string;
      expect(got).toBe(scrubText(text, known));
    }
    console.log(`scrub alone: ${(code.length / 1024).toFixed(1)} KB`);
  });
});
