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

/**
 * Props whose strings people read: the components' text props (packages/ui/src/components)
 * and the HTML attributes a screen reader or a tooltip shows.
 */
const TEXT_PROPS = new Set([
  'label',
  'title',
  'subtitle',
  'message',
  'placeholder',
  'nextLabel',
  'alt',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
]);
const LETTER = /\p{L}/u;

/**
 * `zoma/no-hard-coded-text` (RELAY step 12b, ADR-011): every string of ours comes from the
 * catalogs in apps/tv/src/i18n through `t()`. It reports JSX text with letters, and string or
 * template literals with letters in a text prop or a child expression, including both sides of
 * `?:`, `&&`/`||` and `+`. A call's arguments are never text (`t('action.play')` is a key).
 * Exempt: an element with `translate="no"`/`translate={false}` and everything inside it (the
 * provider's names and our technical marks), and an element with a bare `data` prop (`<Badge
 * label="HD" data />`) and its children.
 * @type {import('eslint').Rule.RuleModule}
 */
const noHardCodedText = {
  meta: {
    type: 'problem',
    docs: { description: 'UI text comes from the i18n catalogs, never from string literals in JSX.' },
    messages: {
      text: 'Hard-coded UI text "{{text}}": add it to apps/tv/src/i18n (en.ts and ar.ts) and use t(). The provider\'s text and technical marks go under translate={false} or a `data` prop.',
    },
    schema: [],
  },
  create(context) {
    /** @param {any} attribute */
    const exempting = (attribute) => {
      if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier') return false;
      const value = attribute.value;
      const literal = value?.type === 'JSXExpressionContainer' ? value.expression : value;
      if (attribute.name.name === 'data') return value === null || (literal?.type === 'Literal' && literal.value === true);
      if (attribute.name.name === 'translate') return literal?.type === 'Literal' && (literal.value === 'no' || literal.value === false);
      return false;
    };
    /** @param {any} node */
    const exempt = (node) => {
      for (let n = node; n; n = n.parent) {
        if (n.type === 'JSXElement' && n.openingElement.attributes.some(exempting)) return true;
      }
      return false;
    };
    /** @param {any} node @param {string} text */
    const report = (node, text) => {
      if (LETTER.test(text) && !exempt(node)) {
        const short = text.trim().replace(/\s+/g, ' ');
        context.report({ node, messageId: 'text', data: { text: short.length > 40 ? `${short.slice(0, 40)}…` : short } });
      }
    };
    /** The strings an expression can show: literals, through `?:`, `&&`, `||`, `??` and `+`. @param {any} node */
    const check = (node) => {
      if (node === null || node === undefined) return;
      if (node.type === 'Literal' && typeof node.value === 'string') report(node, node.value);
      else if (node.type === 'TemplateLiteral') {
        report(node, node.quasis.map((/** @type {any} */ q) => q.value.cooked ?? q.value.raw).join(' '));
        node.expressions.forEach(check);
      } else if (node.type === 'ConditionalExpression') {
        check(node.consequent);
        check(node.alternate);
      } else if (node.type === 'LogicalExpression' || (node.type === 'BinaryExpression' && node.operator === '+')) {
        check(node.left);
        check(node.right);
      } else if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression') check(node.expression);
    };
    return {
      /** @param {any} node */
      JSXText(node) {
        report(node, node.value);
      },
      /** @param {any} node */
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !TEXT_PROPS.has(node.name.name) || node.value === null) return;
        check(node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value);
      },
      /** A child `{'text'}` or `{ok ? 'Yes' : 'No'}`. @param {any} node */
      JSXExpressionContainer(node) {
        if (node.parent?.type === 'JSXElement' || node.parent?.type === 'JSXFragment') check(node.expression);
      },
    };
  },
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'build/**',
      '**/out/**',
      '**/coverage/**',
      '**/artifacts/**',
      // Generated media and fixtures (MPEG-TS segments end in .ts too).
      '.cache/**',
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
      // Other packages are consumed through their entry point (src/index.ts) only. data has
      // four more (package.json `exports`): its three workers, which the app starts with
      // `import QueryWorker from '@zoma/data/query.worker?worker'`, and `@zoma/data/client`,
      // which keeps the other data modules (and their polyfills) out of the main bundle.
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            { target: ['*'], allow: 'src/index.ts' },
            { target: ['data'], allow: ['src/client.ts', 'src/query.worker.ts', 'src/ingest.worker.ts', 'src/epg.worker.ts'] },
          ],
        },
      ],
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
    // UI text only from the catalogs (RELAY step 12b, ADR-011). Tests, e2e and test/ may hold any text.
    files: ['apps/**/*.tsx', 'packages/**/*.tsx'],
    ignores: ['**/*.test.tsx', '**/test/**'],
    plugins: { zoma: { rules: { 'no-hard-coded-text': noHardCodedText } } },
    rules: { 'zoma/no-hard-coded-text': 'error' },
  },
  {
    // The hello screen is a developer screen since step 13a: onboarding is the start screen, and
    // the hello screen opens only with ?screen=hello (readScreen), which no user can type on a TV.
    // Its text is English diagnostics (worker, IndexedDB, data-engine and focus status) that the
    // e2e tests and the old-engine harness read, in its Arabic-locale runs too, so it stays out of
    // the catalogs. Exactly these three files: user screens (onboarding, later the live screen)
    // never import them.
    files: ['apps/tv/src/App.tsx', 'apps/tv/src/DataPanel.tsx', 'apps/tv/src/FocusPanel.tsx'],
    rules: { 'zoma/no-hard-coded-text': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
