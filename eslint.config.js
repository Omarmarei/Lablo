// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ROOT = import.meta.dirname;

/**
 * Architectural elements. One element per workspace package or app.
 * The import rules below implement the "Package boundaries" table in CLAUDE.md.
 * Deliberate change from docs/architecture.md section 1.1: `player` may NOT import
 * `platform-api` (it would create a cycle); `platform-api` imports `player` types
 * instead. See docs/adr/ADR-008-player-platform-api-direction.md.
 */
const PACKAGES = [
  'core',
  'protocol',
  'crypto',
  'data',
  'player',
  'ui',
  'platform-api',
  'platform-tizen',
  'platform-webos',
  'platform-browser',
];
const PLATFORM_ADAPTERS = ['platform-tizen', 'platform-webos', 'platform-browser'];

const ELEMENTS = [
  ...PACKAGES.map((name) => ({ type: name, pattern: `packages/${name}`, mode: /** @type {const} */ ('folder') })),
  { type: 'app-tv', pattern: 'apps/tv', mode: /** @type {const} */ ('folder') },
  { type: 'app-web', pattern: 'apps/web', mode: /** @type {const} */ ('folder') },
  { type: 'app-mock-provider', pattern: 'apps/mock-provider', mode: /** @type {const} */ ('folder') },
  { type: 'tools', pattern: 'tools/*', mode: /** @type {const} */ ('folder') },
];

const ELEMENT_RULES = [
  // core, protocol, crypto: nothing internal (no rule = default disallow).
  { from: ['data'], allow: ['core', 'protocol', 'crypto'] },
  { from: ['player'], allow: ['core'] },
  { from: ['platform-api'], allow: ['core'] },
  { from: ['platform-api'], allow: ['player'], importKind: 'type' },
  { from: ['ui'], allow: ['core', 'player', 'data', 'platform-api'] },
  { from: PLATFORM_ADAPTERS, allow: ['platform-api', 'player', 'core'] },
  { from: ['app-tv'], allow: PACKAGES },
  { from: ['app-web'], allow: ['protocol', 'crypto'] },
  { from: ['tools'], allow: ['core', 'protocol', 'crypto'] },
];

/**
 * Platform globals may only be touched inside their own adapter package.
 * @param {string[]} names
 * @returns {import('eslint').Linter.RulesRecord}
 */
const restrictGlobals = (names) => {
  const message = 'Platform globals are only allowed in their platform adapter package (platform-tizen / platform-webos).';
  return {
    'no-restricted-globals': [/** @type {const} */ ('error'), ...names.map((name) => ({ name, message }))],
    'no-restricted-properties': [
      /** @type {const} */ ('error'),
      ...['window', 'self', 'globalThis'].flatMap((object) =>
        names.map((property) => ({ object, property, message })),
      ),
    ],
  };
};
const TIZEN_GLOBALS = ['tizen', 'webapis'];
const WEBOS_GLOBALS = ['webOS', 'PalmSystem'];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'build/**',
      '**/out/**',
      '**/coverage/**',
      '**/artifacts/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    // Node-side files: root configs, tests, e2e, tools, mock provider, app build configs.
    files: ['*.{js,ts}', 'test/**/*.{js,ts}', 'e2e/**/*.{js,ts}', 'apps/*/vite.config.ts', 'tools/**/*.{js,ts}', 'apps/mock-provider/**/*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': ROOT,
      'boundaries/elements': ELEMENTS,
      'boundaries/include': ['packages/**/*', 'apps/**/*', 'tools/**/*'],
      'import/resolver': {
        typescript: {
          // The root tsconfig maps @zoma/* to every package so that a forbidden import
          // still resolves (and is reported) even when it is not a declared dependency.
          project: `${ROOT}/tsconfig.json`,
          alwaysTryTypes: true,
        },
      },
    },
    rules: {
      'boundaries/element-types': ['error', { default: 'disallow', rules: ELEMENT_RULES }],
      // Other packages are consumed through their entry point (src/index.ts) only.
      'boundaries/entry-point': ['error', { default: 'disallow', rules: [{ target: ['*'], allow: 'src/index.ts' }] }],
      ...restrictGlobals([...TIZEN_GLOBALS, ...WEBOS_GLOBALS]),
    },
  },
  {
    files: ['packages/platform-tizen/**'],
    rules: restrictGlobals(WEBOS_GLOBALS),
  },
  {
    files: ['packages/platform-webos/**'],
    rules: restrictGlobals(TIZEN_GLOBALS),
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
