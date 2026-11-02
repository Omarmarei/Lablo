import { createRequire } from 'node:module';
import { babel } from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import type { LoggingFunction, Plugin, RollupLog } from 'rollup';
import { rollup } from 'rollup';
import { checkSyntax, formatViolation } from './syntax-gate';

const require = createRequire(import.meta.url);

/** The installed core-js version; Babel's usage-based polyfills must match it. */
export const CORE_JS_VERSION = (require('core-js/package.json') as { version: string }).version;

/** The oldest TV engine: Chromium 53 (2018 LG webOS 4). Tizen 4 (2018) runs Chromium 56. */
export const TV_TARGETS = { chrome: '53' } as const;

export type BuildPlatform = 'tizen' | 'webos' | 'browser';

export interface BundleOptions {
  /** Absolute path of the entry module. */
  readonly input: string;
  /** Value of the `__PLATFORM__` define. */
  readonly platform: BuildPlatform;
  /** Label used in gate errors, e.g. `main.js (webos)`. */
  readonly label?: string;
  /**
   * Inject core-js polyfills (default true). Only the old-engine harness self-test turns this
   * off (`build-tv --unsafe-no-polyfills`), to prove it catches a missing polyfill.
   */
  readonly polyfills?: boolean;
}

export interface BuiltWorker {
  /** Absolute path of the worker entry. */
  readonly entry: string;
  readonly code: string;
}

export interface BundleResult {
  readonly code: string;
  /** Every worker inlined into `code` (already gated). */
  readonly workers: readonly BuiltWorker[];
}

/** A bundle that would not run on Chromium 53. */
export class SyntaxGateError extends Error {
  override readonly name = 'SyntaxGateError';
}

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.jsx'];

/**
 * Dependencies that get no core-js polyfills (see the Babel `overrides` below). Only for
 * libraries whose used code needs nothing Chromium 53 lacks: fflate's `Gunzip` uses typed
 * arrays only, and the bundled ingest worker runs it with the ES2017 APIs deleted
 * (`test/ingest-worker-bundle.test.ts`).
 */
export const POLYFILL_FREE_DEPENDENCIES = [/[\\/]node_modules[\\/]fflate[\\/]/];

/**
 * core-js polyfills that are never injected. Babel's usage detection can't see types, so any
 * `.map(` pulls in the ES2025 iterator helpers, any `new Set` the ES2025 Set methods and any
 * `Uint8Array` the ES2026 base64 methods: about 30 KB of every bundle for APIs nothing calls.
 * They are all APIs that TV code can't call anyway, because every package and `apps/tv`
 * compile against `lib: ES2017` (pinned by `bundle.test.ts`). Polyfills for ES2017 APIs and
 * for the few newer ones the code may use (`Promise.prototype.finally`, `Array.prototype.flat`,
 * `globalThis`) are still injected.
 */
export const UNUSED_POLYFILLS: readonly RegExp[] = [
  /^es(next)?\.iterator\./, // iterator helpers (ES2025)
  /^es(next)?\.set\.[a-z-]+\.v2$/, // Set methods: union, intersection… (ES2025)
  /^es(next)?\.(weak-)?map\.get-or-insert/, // Map upsert (ES2026)
  /^es(next)?\.uint8-array\./, // Uint8Array base64 and hex (ES2026)
  /^es(next)?\.typed-array\.(at|find-last|find-last-index|to-reversed|to-sorted|with)$/, // ES2022-ES2023
  /^es(next)?\.array-buffer\.(detached|transfer|transfer-to-fixed-length)$/, // ES2024
  /^es\.error\.cause$/, // ES2022
  /^es\.json\.parse$/, // source text access (ES2026); native JSON.parse is used without a reviver anyway
  /^es\.symbol\.description$/, // ES2019, not in lib ES2017
];
const WORKER_SUFFIX = '?worker';
const WORKER_PREFIX = '\0zoma-worker:';

/**
 * U+2028 and U+2029 end a line inside an ES2016 string literal (they became legal there
 * only in ES2019), so inlined worker code escapes them. Built from char codes so the source
 * file itself never contains the raw characters.
 */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

function escapeLineSeparators(text: string): string {
  return text.replace(LINE_SEPARATORS, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

/**
 * Babel's usage-based polyfills inject `import "core-js/modules/…"` into every file,
 * including workspace packages that do not depend on core-js. Resolve those imports from
 * this tool, which does.
 */
function resolveCoreJs(): Plugin {
  return {
    name: 'zoma-core-js',
    resolveId(source) {
      if (source === 'core-js' || source.startsWith('core-js/')) return require.resolve(source);
      return null;
    },
  };
}

/**
 * `import MyWorker from './my.worker?worker'` (the same syntax Vite uses in development):
 * the worker is bundled as its own Chromium 53 IIFE, gated, and inlined as a string that is
 * started from a Blob URL. Blob workers avoid the `file://` worker question on packaged TV
 * apps (spike S1 confirms them on the TVs).
 */
function inlineWorkers(options: BundleOptions, workers: BuiltWorker[]): Plugin {
  return {
    name: 'zoma-inline-workers',
    async resolveId(source, importer) {
      if (!source.endsWith(WORKER_SUFFIX)) return null;
      const target = source.slice(0, -WORKER_SUFFIX.length);
      const resolved = await this.resolve(target, importer, { skipSelf: true });
      if (resolved === null) this.error(`Cannot resolve worker "${target}" imported from ${importer ?? '?'}`);
      return WORKER_PREFIX + resolved.id;
    },
    async load(id) {
      if (!id.startsWith(WORKER_PREFIX)) return null;
      const entry = id.slice(WORKER_PREFIX.length);
      const built = await bundleIife({
        input: entry,
        platform: options.platform,
        label: `worker ${entry}`,
        polyfills: options.polyfills,
      });
      workers.push({ entry, code: built.code }, ...built.workers);
      const literal = escapeLineSeparators(JSON.stringify(built.code));
      return [
        `var source = ${literal};`,
        'export default function ZomaWorker() {',
        "  var url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));",
        '  return new Worker(url);',
        '}',
      ].join('\n');
    },
  };
}

function onwarn(warning: RollupLog, warn: LoggingFunction): void {
  // An unresolved import would silently become a global lookup that fails on the TV.
  if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message);
  // core-js internals are circular by design.
  if (warning.code === 'CIRCULAR_DEPENDENCY' && warning.ids?.some((id) => id.includes('core-js'))) return;
  warn(warning);
}

function plugins(options: BundleOptions, workers: BuiltWorker[]): Plugin[] {
  return [
    replace({
      preventAssignment: true,
      values: {
        __PLATFORM__: JSON.stringify(options.platform),
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }),
    inlineWorkers(options, workers),
    resolveCoreJs(),
    nodeResolve({ extensions: EXTENSIONS, browser: true }),
    // Must run before Babel so core-js (CommonJS) is converted after Babel injects its imports.
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      babelrc: false,
      configFile: false,
      browserslistConfigFile: false,
      extensions: EXTENSIONS,
      // Transpile dependencies too (they may ship newer syntax); never core-js itself.
      exclude: [/[\\/]core-js[\\/]/],
      sourceType: 'unambiguous',
      presets: [
        [
          require.resolve('@babel/preset-env'),
          {
            targets: TV_TARGETS,
            ...(options.polyfills === false ? { useBuiltIns: false } : { useBuiltIns: 'usage', corejs: CORE_JS_VERSION, exclude: [...UNUSED_POLYFILLS] }),
            bugfixes: true,
            modules: false,
          },
        ],
        [require.resolve('@babel/preset-typescript'), { onlyRemoveTypeImports: true }],
      ],
      // Libraries already written for old engines: their syntax is still transpiled (and gated),
      // but no polyfills are injected. Babel adds polyfill imports per file, before tree-shaking,
      // so fflate's unused worker helper (`URL.createObjectURL`) alone would pull core-js's URL
      // polyfill (about 25 KB minified) into the ingest worker.
      overrides: [
        {
          test: POLYFILL_FREE_DEPENDENCIES,
          presets: [[require.resolve('@babel/preset-env'), { targets: TV_TARGETS, useBuiltIns: false, bugfixes: true, modules: false }]],
        },
      ],
      plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic', importSource: 'preact' }]],
    }),
    terser({
      format: { comments: false, ascii_only: true },
      compress: { passes: 2 },
    }),
  ];
}

/**
 * Bundles `input` into one minified classic-script IIFE for the TV, with every
 * `?worker` import inlined, then runs the ES2016 syntax gate on the result.
 * Throws `SyntaxGateError` if the output would not parse on Chromium 53.
 */
export async function bundleIife(options: BundleOptions): Promise<BundleResult> {
  const workers: BuiltWorker[] = [];
  const bundle = await rollup({ input: options.input, plugins: plugins(options, workers), onwarn });
  try {
    const { output } = await bundle.generate({ format: 'iife', inlineDynamicImports: true });
    const [chunk] = output;
    const code = chunk.code;
    const violation = checkSyntax(code, options.label ?? options.input);
    if (violation !== null) throw new SyntaxGateError(formatViolation(violation));
    return { code, workers };
  } finally {
    await bundle.close();
  }
}
