import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Proves the architectural lint rules in eslint.config.js actually fire.
 * Each case lints source text as if it lived at `file` (nothing is written to disk),
 * so `pnpm lint` on the real tree stays clean while these assertions run.
 */
const ROOT = path.resolve(import.meta.dirname, '..');

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

async function lint(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
  if (!result) throw new Error(`no lint result for ${file}`);
  return result.messages.map((m) => `${m.ruleId ?? 'fatal'}: ${m.message}`);
}

const BOUNDARY = 'boundaries/element-types';

describe('package boundaries (boundaries/element-types)', () => {
  it('rejects the seeded forbidden import: core -> @lablo/ui', async () => {
    const messages = await lint('packages/core/src/forbidden-import.fixture.ts', "import '@lablo/ui';\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(BOUNDARY);
    expect(messages[0]).toContain("File is of type 'core'. Dependency is of type 'ui'");
  });

  it.each([
    ['packages/protocol/src/f.ts', '@lablo/core'],
    ['packages/crypto/src/f.ts', '@lablo/protocol'],
    ['packages/data/src/f.ts', '@lablo/ui'],
    ['packages/data/src/f.ts', '@lablo/player'],
    ['packages/player/src/f.ts', '@lablo/platform-api'],
    ['packages/player/src/f.ts', '@lablo/data'],
    ['packages/ui/src/f.ts', '@lablo/platform-tizen'],
    ['packages/platform-webos/src/f.ts', '@lablo/ui'],
    ['packages/platform-tizen/src/f.ts', '@lablo/data'],
    ['packages/platform-browser/src/f.ts', '@lablo/platform-webos'],
    ['packages/platform-api/src/f.ts', '@lablo/ui'],
  ])('rejects %s importing %s', async (file, dep) => {
    const messages = await lint(file, `import '${dep}';\n`);
    expect(messages.some((m) => m.startsWith(BOUNDARY))).toBe(true);
  });

  it.each([
    ['packages/data/src/f.ts', '@lablo/core'],
    ['packages/data/src/f.ts', '@lablo/crypto'],
    ['packages/player/src/f.ts', '@lablo/core'],
    ['packages/ui/src/f.ts', '@lablo/data'],
    ['packages/ui/src/f.ts', '@lablo/platform-api'],
    ['packages/platform-tizen/src/f.ts', '@lablo/platform-api'],
    ['packages/platform-browser/src/f.ts', '@lablo/player'],
  ])('allows %s importing %s', async (file, dep) => {
    expect(await lint(file, `import '${dep}';\n`)).toEqual([]);
  });

  it('allows platform-api to import player types only (ADR-008)', async () => {
    const file = 'packages/platform-api/src/f.ts';
    expect(await lint(file, "import type {} from '@lablo/player';\n")).toEqual([]);
    const valueImport = await lint(file, "import * as player from '@lablo/player';\nexport { player };\n");
    expect(valueImport.some((m) => m.startsWith(BOUNDARY))).toBe(true);
  });

  it('rejects deep imports that bypass a package entry point', async () => {
    const messages = await lint('packages/ui/src/f.ts', "import '../../core/package.json';\n");
    expect(messages.some((m) => m.startsWith('boundaries/entry-point'))).toBe(true);
  });

  it('allows the data workers as entry points, and nothing else in data', async () => {
    const file = 'apps/tv/src/f.ts';
    for (const worker of ['query', 'ingest', 'epg']) {
      expect(await lint(file, `import W from '@lablo/data/${worker}.worker?worker';\nexport { W };\n`)).toEqual([]);
    }
    const deep = await lint(file, "import { serveRpc } from '../../../packages/data/src/rpc';\nexport { serveRpc };\n");
    expect(deep.some((m) => m.startsWith('boundaries/entry-point'))).toBe(true);
    const deepWorker = await lint(file, "import W from '../../../packages/data/src/rpc?worker';\nexport { W };\n");
    expect(deepWorker.some((m) => m.startsWith('boundaries/entry-point'))).toBe(true);
  });
});

describe('platform globals (no-restricted-globals / no-restricted-properties)', () => {
  it.each([
    ['packages/core/src/f.ts', 'export const a = typeof tizen;\n', 'no-restricted-globals'],
    ['packages/ui/src/f.ts', 'export const a = typeof webapis;\n', 'no-restricted-globals'],
    ['packages/player/src/f.ts', 'export const a = window.webOS;\n', 'no-restricted-properties'],
    ['packages/platform-browser/src/f.ts', 'export const a = typeof PalmSystem;\n', 'no-restricted-globals'],
    ['packages/platform-tizen/src/f.ts', 'export const a = typeof webOS;\n', 'no-restricted-globals'],
    ['packages/platform-webos/src/f.ts', 'export const a = globalThis.tizen;\n', 'no-restricted-properties'],
    ['apps/tv/src/f.ts', 'export const a = typeof PalmServiceBridge;\n', 'no-restricted-globals'],
    ['apps/tv/src/f.ts', 'export const a = window.PalmServiceBridge;\n', 'no-restricted-properties'],
  ])('rejects %s: %s', async (file, code, rule) => {
    const messages = await lint(file, code);
    expect(messages.some((m) => m.startsWith(rule))).toBe(true);
  });

  it.each([
    ['packages/platform-tizen/src/f.ts', 'export const a = typeof tizen + typeof webapis;\n'],
    ['packages/platform-webos/src/f.ts', 'export const a = typeof webOS + typeof PalmSystem + typeof PalmServiceBridge;\n'],
  ])('allows %s to use its own platform globals', async (file, code) => {
    expect(await lint(file, code)).toEqual([]);
  });
});
