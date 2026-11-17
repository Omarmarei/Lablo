import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Proves eslint.config.js's "no outbound network" block for apps/web (RELAY step 29a, ADR-005:
 * our servers never fetch a user-supplied URL and never relay a stream). Each case lints source
 * text as if it lived at `file`; nothing is written to disk.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = 'apps/web/src/server/f.ts';

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

async function lint(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  if (!result) throw new Error(`no lint result for ${file}`);
  return result.messages.map((m) => `${m.ruleId ?? 'fatal'}: ${m.message}`);
}

/** The one message a seeded line must raise: its rule, and the ADR-005 text. */
async function rejected(file: string, code: string): Promise<string> {
  const messages = await lint(file, code);
  expect(messages).toHaveLength(1);
  const [message] = messages as [string];
  expect(message).toContain('ADR-005');
  return message.slice(0, message.indexOf(':'));
}

describe('apps/web makes no outbound requests', () => {
  it.each([
    ["export const a = () => fetch('https://provider.example/get.php');\n", 'no-restricted-globals'],
    ['export const a = new XMLHttpRequest();\n', 'no-restricted-globals'],
    ["export const a = new WebSocket('wss://x.example');\n", 'no-restricted-globals'],
    ["export const a = new EventSource('https://x.example');\n", 'no-restricted-globals'],
    ["export const a = () => globalThis.fetch('https://x.example');\n", 'no-restricted-properties'],
    ['export const a = window.XMLHttpRequest;\n', 'no-restricted-properties'],
    ['export const a = self.WebSocket;\n', 'no-restricted-properties'],
  ])('rejects the global: %s', async (code, rule) => {
    expect(await rejected(WEB, code)).toBe(rule);
  });

  it.each([
    'node:http',
    'http',
    'node:https',
    'https',
    'node:http2',
    'node:net',
    'net',
    'node:tls',
    'node:dgram',
    'node:dns',
    'dns',
    'node:child_process',
    'child_process',
    'node:module',
    'undici',
    'node-fetch',
    'cross-fetch',
    'isomorphic-fetch',
    'axios',
    'axios/lib/adapters/http.js',
    'got',
    'ky',
    'superagent',
    'request',
    'needle',
    'phin',
    'ws',
  ])('rejects importing %s', async (name) => {
    expect(await rejected(WEB, `import * as m from '${name}';\nexport { m };\n`)).toBe('no-restricted-imports');
  });

  it.each(['node:https', 'https', 'undici', 'axios/lib/adapters/http.js'])('rejects re-exporting from %s', async (name) => {
    expect(await rejected(WEB, `export * from '${name}';\n`)).toBe('no-restricted-imports');
  });

  it.each(['node:https', 'http', 'undici', 'got/dist/source/index.js'])('rejects a dynamic import of %s', async (name) => {
    expect(await rejected(WEB, `export const m = () => import('${name}');\n`)).toBe('no-restricted-syntax');
  });

  it.each([
    ["export const m = require('node:path');\n", 'no-restricted-globals'],
    ["const r = require;\nexport const m = r('node:https');\n", 'no-restricted-globals'],
    ["export const m = module.require('node:https');\n", 'no-restricted-globals'],
    ["export const m = globalThis.require('node:https');\n", 'no-restricted-properties'],
  ])('rejects require() in any form: %s', async (code, rule) => {
    const messages = await lint(WEB, code);
    // typescript-eslint's no-require-imports joins in on a direct call.
    expect(messages.filter((m) => !m.startsWith('@typescript-eslint/no-require-imports'))).toEqual([
      expect.stringMatching(new RegExp(`^${rule}: .*No require\\(\\) in apps/web`)),
    ]);
  });

  it.each(['apps/web/next.config.ts', 'apps/web/prisma.config.ts', 'apps/web/src/app/v1/health/route.ts', 'apps/web/src/app/p/page.tsx'])(
    'covers every file of the app: %s',
    async (file) => {
      expect(await rejected(file, "export const a = () => fetch('https://x.example');\n")).toBe('no-restricted-globals');
    },
  );

  it('leaves the app’s tests free to start the Prisma CLI and call the app', async () => {
    const code =
      "import { spawnSync } from 'node:child_process';\nexport const a = spawnSync;\nexport const b = () => fetch('http://127.0.0.1:3100/v1/health');\n";
    expect(await lint('apps/web/test/f.web.test.ts', code)).toEqual([]);
  });

  it('leaves the app’s e2e specs free like its tests', async () => {
    const code = "import { spawnSync } from 'node:child_process';\nexport const a = spawnSync;\nexport const b = () => fetch('http://127.0.0.1:3101/p');\n";
    expect(await lint('apps/web/e2e/f.spec.ts', code)).toEqual([]);
  });

  it('keeps the platform globals out of apps/web too', async () => {
    const messages = await lint(WEB, 'export const a = typeof tizen + typeof webOS;\n');
    expect(messages).toHaveLength(2);
    expect(messages.every((m) => m.startsWith('no-restricted-globals') && m.includes('platform adapter'))).toBe(true);
  });

  it.each([
    "import path from 'node:path';\nexport const a = path.join('a', 'b');\n",
    "import { createHash } from 'node:crypto';\nexport const a = createHash('sha256');\n",
    "import { readFile } from 'node:fs/promises';\nexport const a = readFile;\n",
    "import { PrismaPg } from '@prisma/adapter-pg';\nexport const a = PrismaPg;\n",
    // Names that only start like a banned module.
    "import * as m from 'got-scraping-types';\nexport { m };\n",
    "import * as m from 'requestidlecallback';\nexport { m };\n",
    "import * as m from 'httpstatus';\nexport { m };\n",
    // ... or ends like one.
    "import * as m from 'reviews';\nexport { m };\n",
    "import * as m from '@acme/got';\nexport { m };\n",
    "export const a = Response.json({ ok: true });\nexport const b = new Request('http://localhost/v1/health');\n",
  ])('allows what the backend needs: %s', async (code) => {
    expect((await lint(WEB, code)).filter((m) => !m.startsWith('import/no-unresolved'))).toEqual([]);
  });

  it.each([
    ['packages/data/src/f.ts', "export const a = () => fetch('http://provider.example/get.php');\n"],
    ['apps/tv/src/f.ts', 'export const a = new XMLHttpRequest();\n'],
    ['apps/mock-provider/src/f.ts', "import http from 'node:http';\nexport const a = http;\n"],
    ['tools/engines/src/f.ts', "import { spawn } from 'node:child_process';\nexport const a = spawn;\n"],
    ['e2e/f.ts', "export const a = () => fetch('http://127.0.0.1:8080/');\n"],
  ])('leaves the TV, the mock, the tools and the tests as they are: %s', async (file, code) => {
    expect(await lint(file, code)).toEqual([]);
  });
});

describe('the phone page’s requests (RELAY step 31b)', () => {
  const API = 'apps/web/src/phone/api.ts';

  it('lets the page’s API module call fetch, its one exception', async () => {
    expect(await lint(API, "export const a = () => fetch('/v1/pair/ABCDEFGH');\n")).toEqual([]);
    expect(await lint(API, "export const a = () => globalThis.fetch('/v1/pair/ABCDEFGH');\n")).toEqual([]);
  });

  it.each([
    ['export const a = new XMLHttpRequest();\n', 'no-restricted-globals'],
    ["export const a = new WebSocket('wss://x.example');\n", 'no-restricted-globals'],
    ["export const a = new EventSource('/v1/x');\n", 'no-restricted-globals'],
    ['export const a = window.XMLHttpRequest;\n', 'no-restricted-properties'],
    ["import http from 'node:http';\nexport const a = http;\n", 'no-restricted-imports'],
    ["export const a = import('node:https');\n", 'no-restricted-syntax'],
    ["const r = require;\nexport const a = r('node:https');\n", 'no-restricted-globals'],
  ])('still refuses the rest there: %s', async (code, rule) => {
    expect(await rejected(API, code)).toBe(rule);
  });

  it('still keeps the platform globals out of it', async () => {
    const messages = await lint(API, 'export const a = typeof tizen;\n');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^no-restricted-globals: .*platform adapter/);
  });

  it.each(['apps/web/src/phone/flows.ts', 'apps/web/src/phone/PhonePage.tsx', 'apps/web/src/phone/api/index.ts', 'apps/web/src/phone/api.tsx', 'apps/web/src/server/api.ts', 'apps/web/src/app/p/api.ts'])(
    'refuses fetch in every other file: %s',
    async (file) => {
      expect(await rejected(file, "export const a = () => fetch('/v1/pair/ABCDEFGH');\n")).toBe('no-restricted-globals');
    },
  );
});
