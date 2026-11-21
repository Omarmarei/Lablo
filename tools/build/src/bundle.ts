import { createRequire } from 'node:module';
import path from 'node:path';
import { babel } from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import terser from '@rollup/plugin-terser';
import type { LoggingFunction, OutputChunk, OutputOptions, Plugin, RollupLog } from 'rollup';
import { rollup } from 'rollup';
import type { TvDefines } from '../../../tv-defines.config';
import { appIdFor, defineValues, tvDefines } from '../../../tv-defines.config';
import { DEFINE_NAME, amdLoaderScript } from './amd-loader';
import { checkSyntax, formatViolation } from './syntax-gate';

const require = createRequire(import.meta.url);

/** The repo's root (STORE_SWAPS' paths are relative to it). */
const ROOT = path.resolve(import.meta.dirname, '../../..');

/** The installed core-js version; Babel's usage-based polyfills must match it. */
export const CORE_JS_VERSION = (require('core-js/package.json') as { version: string }).version;

/** The oldest TV engine: Chromium 53 (2018 LG webOS 4). Tizen 4 (2018) runs Chromium 56. */
export const TV_TARGETS = { chrome: '53' } as const;

export type BuildPlatform = 'tizen' | 'webos' | 'browser';

export interface BundleOptions {
  /** Absolute path of the entry module. */
  readonly input: string;
  /** Value of the `__PLATFORM__` define; `__APP_ID__` is its manifest's id (`appIdFor`). */
  readonly platform: BuildPlatform;
  /**
   * `__API_BASE__`, `__APP_VERSION__` and `__CONFIG_KEYS__` (tv-defines.config.ts; default a TV
   * build's: the production keys, or the dev key while there are none).
   */
  readonly defines?: TvDefines;
  /** Label used in gate errors, e.g. `main.js (webos)`. */
  readonly label?: string;
  /**
   * Inject core-js polyfills (default true). Only the old-engine harness self-test turns this
   * off (`build-tv --unsafe-no-polyfills`), to prove it catches a missing polyfill.
   */
  readonly polyfills?: boolean;
  /**
   * Keep the developer screens (RELAY step 35b): the TV build's test copy (`build-tv`'s `dev`
   * target). Default false: each of `STORE_SWAPS` is replaced by its stand-in.
   */
  readonly devScreens?: boolean;
  /** The modules a store build swaps (default `STORE_SWAPS`; tests give their own). */
  readonly swaps?: readonly StoreSwap[];
  /**
   * Workers built already in this run, by entry, platform and polyfills (`build-tv` passes one
   * map to every build): a worker the app, its test copy and the lab all inline is built once.
   */
  readonly workerCache?: Map<string, BundleResult>;
  /**
   * Split at each dynamic `import()` (RELAY step 35e): main.js (the loader at its top, then the
   * entry) and one lazy file per `import()`, each through terser, the worker strings and the
   * syntax gate (amd-loader.ts). Default false: one IIFE with every `import()` inlined (the lab,
   * the vectors page, the workers).
   */
  readonly split?: boolean;
  /** A lazy file's label in gate errors (default `<file> of <label>`). */
  readonly lazyLabel?: (fileName: string) => string;
}

/** A file a split build loads later (`BundleOptions.split`), next to main.js. */
export interface LazyChunk {
  /** `settings.js`: the file name, which is its AMD id plus `.js`. */
  readonly fileName: string;
  readonly code: string;
  /** UTF-8 bytes of `code` that are inlined workers (`BundleResult.inlinedBytes`). */
  readonly inlinedBytes: number;
  /** The modules in it (Rollup's ids: absolute paths, and `\0` ones). */
  readonly modules: readonly string[];
}

export interface BuiltWorker {
  /** Absolute path of the worker entry. */
  readonly entry: string;
  readonly code: string;
}

export interface BundleResult {
  readonly code: string;
  /** Every worker inlined into `code` (already gated), including workers inlined into those. */
  readonly workers: readonly BuiltWorker[];
  /**
   * UTF-8 bytes of `code` that are the string literals of the workers inlined directly into
   * it. They count against each worker's own budget, not this bundle's (budgets.ts).
   */
  readonly inlinedBytes: number;
  /**
   * The `.css` files the bundle imports (absolute paths), in the order the modules that
   * import them run: tools/build/src/css.ts turns them into app.css. Workers may import none.
   */
  readonly css: readonly string[];
  /** The modules in `code` (Rollup's ids: absolute paths, and `\0` ones). */
  readonly modules: readonly string[];
  /** A split build's lazy files ([] otherwise). Their workers are in `workers` too. */
  readonly lazy: readonly LazyChunk[];
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
 * Dependencies that get only the core-js polyfills listed for them. Babel injects a polyfill
 * into a file for every API name it sees there, before tree-shaking, and core-js modules are
 * never dropped: zod 4's core files name `URL`, `atob`, `Promise`, typed arrays and more in
 * code `@lablo/protocol` never runs, so one small `zod/mini` schema came to a 110 KB bundle,
 * most of it polyfills (URL, DOMException…). What zod calls on Chromium 53 for the protocol's
 * schemas, all while the schemas are built: `globalThis` (its core reads it at load),
 * `Object.fromEntries` (every `z.enum`), `Object.entries` and `Object.values` (the enum's
 * values) and `Object.getOwnPropertyDescriptors` (`z.extend`). A new kind of schema may need
 * more: the protocol samples, bundled alone, run in a realm without those APIs
 * (test/crypto-vectors-bundle.test.ts), and with the crypto vectors on Chromium 53, 56 and 68
 * (`pnpm verify:engines`, RELAY step 29b2a).
 */
export const DEPENDENCY_POLYFILLS: ReadonlyArray<{ readonly test: RegExp; readonly polyfills: readonly string[] }> = [
  {
    test: /[\\/]node_modules[\\/]zod[\\/]/,
    polyfills: [
      'es.global-this',
      'es.object.entries',
      'es.object.values',
      'es.object.from-entries',
      'es.object.get-own-property-descriptors',
    ],
  },
];

/**
 * A preset-env `exclude` entry for every core-js polyfill but `polyfills` (by full name). Only
 * polyfill names (`es.`, `esnext.`, `web.`) match: the syntax transforms stay.
 */
export function polyfillsExcept(polyfills: readonly string[]): RegExp {
  const names = polyfills.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`^(?!(?:${names})$)(?:es|esnext|web)\\.`);
}

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
  // JSON.parse source text access (ES2026): Babel injects `esnext.json.parse`, which loads
  // `es.json.parse`. Native JSON.parse is used without a reviver anyway.
  /^es(next)?\.json\.parse$/,
  /^es\.symbol\.description$/, // ES2019, not in lib ES2017
];
const WORKER_SUFFIX = '?worker';
const WORKER_PREFIX = '\0lablo-worker:';
/** Stands in for worker `n`'s code until the bundle is minified (substituteWorkers). */
const workerPlaceholder = (n: number): string => `__LABLO_WORKER_${n}__`;
const WORKER_PLACEHOLDERS = /(["'])__LABLO_WORKER_(\d+)__\1/g;

/**
 * U+2028 and U+2029 end a line inside an ES2016 string literal (they became legal there
 * only in ES2019), so inlined worker code escapes them. Built from char codes so the source
 * file itself never contains the raw characters.
 */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');

function escapeLineSeparators(text: string): string {
  return text.replace(LINE_SEPARATORS, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

const occurrences = (text: string, char: string): number => text.split(char).length - 1;

/**
 * An ES2016 string literal for `text`, in whichever quote needs fewer escapes (as terser
 * would pick): minified code is mostly double-quoted strings, so the four workers inlined in
 * single quotes are 5.9 KB (1.6%) smaller than in their `JSON.stringify` form.
 */
export function stringLiteral(text: string): string {
  const json = escapeLineSeparators(JSON.stringify(text));
  if (occurrences(text, "'") >= occurrences(text, '"')) return json;
  // JSON escapes are a backslash and one character (`\u` keeps its four digits after it),
  // so matching them as pairs never splits one.
  const body = json.slice(1, -1).replace(/\\(.)|'/g, (match: string, escaped: string | undefined) => {
    if (escaped === undefined) return "\\'";
    return escaped === '"' ? '"' : match;
  });
  return `'${body}'`;
}

/**
 * Babel's usage-based polyfills inject `import "core-js/modules/…"` into every file,
 * including workspace packages that do not depend on core-js. Resolve those imports from
 * this tool, which does.
 */
function resolveCoreJs(): Plugin {
  return {
    name: 'lablo-core-js',
    resolveId(source) {
      if (source === 'core-js' || source.startsWith('core-js/')) return require.resolve(source);
      return null;
    },
  };
}

/** A module the store build replaces with a stand-in that exports the same (RELAY step 35b). */
export interface StoreSwap {
  /** The real module, relative to the repo's root. */
  readonly module: string;
  /** Its stand-in, relative to the repo's root. */
  readonly stand: string;
}

/**
 * The developer screens (Omar's decision of 2026-11-20): the store build takes a stand-in that
 * shows none, so their code, their CSS and the hello worker stay out of main.js and app.css.
 */
export const STORE_SWAPS: readonly StoreSwap[] = [{ module: 'apps/tv/src/dev/dev-screens.tsx', stand: 'apps/tv/src/dev/dev-screens.store.ts' }];

/** A file path as one comparable string (Windows paths in either slash and case). */
function samePath(file: string): string {
  return path.resolve(file).split(path.sep).join('/').toLowerCase();
}

/**
 * Resolves each import of a swapped module to its stand-in. Only imports whose last segment names
 * a swapped module are resolved a second time (`this.resolve`), so the rest cost nothing.
 */
export function storeSwaps(swaps: readonly StoreSwap[], root: string = ROOT): Plugin {
  const stands = new Map<string, string>();
  const names = new Set<string>();
  for (const swap of swaps) {
    stands.set(samePath(path.resolve(root, swap.module)), path.resolve(root, swap.stand));
    names.add(path.basename(swap.module).replace(/\.[^.]+$/, ''));
  }
  return {
    name: 'lablo-store-swaps',
    async resolveId(source, importer, options) {
      if (importer === undefined) return null;
      const last = source.slice(source.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
      if (!names.has(last)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved === null) return null;
      return stands.get(samePath(resolved.id)) ?? resolved;
    },
  };
}

/**
 * `import MyWorker from './my.worker?worker'` (the same syntax Vite uses in development):
 * the worker is bundled as its own Chromium 53 IIFE, gated, and inlined as a string that is
 * started from a Blob URL. Blob workers avoid the `file://` worker question on packaged TV
 * apps (spike S1 confirms them on the TVs).
 *
 * The string goes in as a placeholder, and `substituteWorkers` puts the worker's code in
 * after minification (the code is minified already), so the bundle knows exactly how many of
 * its bytes are worker code.
 */
function inlineWorkers(options: BundleOptions, workers: BuiltWorker[], literals: string[]): Plugin {
  return {
    name: 'lablo-inline-workers',
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
      const cacheKey = `${entry}|${options.platform}|${options.polyfills === false ? 'bare' : 'polyfilled'}`;
      const cached = options.workerCache?.get(cacheKey);
      const built =
        cached ??
        (await bundleIife({
          input: entry,
          platform: options.platform,
          label: `worker ${entry}`,
          polyfills: options.polyfills,
          workerCache: options.workerCache,
        }));
      options.workerCache?.set(cacheKey, built);
      if (built.css.length > 0) this.error(`Worker ${entry} imports CSS (${built.css.join(', ')}); workers have no DOM`);
      workers.push({ entry, code: built.code }, ...built.workers);
      literals.push(stringLiteral(built.code));
      return [
        `var source = ${JSON.stringify(workerPlaceholder(literals.length - 1))};`,
        'export default function LabloWorker() {',
        "  var url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));",
        '  return new Worker(url);',
        '}',
      ].join('\n');
    },
  };
}

/**
 * Runs after terser: puts each inlined worker's code (a string literal) where its
 * placeholder is, and adds up the bytes it put in, by file. A worker that tree-shaking dropped
 * has no placeholder left and adds nothing.
 */
function substituteWorkers(literals: readonly string[], inlined: Map<string, number>): Plugin {
  return {
    name: 'lablo-worker-literals',
    renderChunk(code, chunk) {
      let bytes = 0;
      const out = code.replace(WORKER_PLACEHOLDERS, (_match, _quote, n: string) => {
        const literal = literals[Number(n)];
        if (literal === undefined) throw new Error(`unknown worker placeholder ${workerPlaceholder(Number(n))}`);
        bytes += Buffer.byteLength(literal, 'utf8');
        return literal;
      });
      inlined.set(chunk.fileName, bytes);
      return { code: out, map: null };
    },
  };
}

/**
 * `import './x.css'`: the module becomes empty in the bundle, and the file is listed for
 * app.css. The order is the modules' evaluation order (a depth-first walk of the static
 * imports from the entry, in source order), so CSS a module imports comes before the CSS of
 * the modules that import it, as in Vite's dev server.
 */
function collectCss(css: string[]): Plugin {
  return {
    name: 'lablo-css',
    load(id) {
      return id.endsWith('.css') ? { code: '', moduleSideEffects: false } : null;
    },
    buildEnd(error) {
      if (error !== undefined) return;
      const seen = new Set<string>();
      const visit = (id: string): void => {
        if (seen.has(id)) return;
        seen.add(id);
        const info = this.getModuleInfo(id);
        if (info === null) return;
        for (const dependency of [...info.importedIds, ...info.dynamicallyImportedIds]) visit(dependency);
        if (id.endsWith('.css')) css.push(id);
      };
      for (const id of this.getModuleIds()) {
        if (this.getModuleInfo(id)?.isEntry === true) visit(id);
      }
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

interface Collected {
  readonly workers: BuiltWorker[];
  /** Worker `n`'s code as a string literal, for placeholder `n`. */
  readonly literals: string[];
  /** Bytes of inlined worker literals, by output file. */
  readonly inlined: Map<string, number>;
  readonly css: string[];
}

function plugins(options: BundleOptions, collected: Collected): Plugin[] {
  return [
    replace({
      preventAssignment: true,
      values: {
        __PLATFORM__: JSON.stringify(options.platform),
        __APP_ID__: JSON.stringify(appIdFor(options.platform)),
        ...defineValues(options.defines ?? tvDefines('package')),
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }),
    ...(options.devScreens === true ? [] : [storeSwaps(options.swaps ?? STORE_SWAPS)]),
    inlineWorkers(options, collected.workers, collected.literals),
    collectCss(collected.css),
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
        // Dependencies with a short list of the polyfills they need (none when polyfills are off).
        ...DEPENDENCY_POLYFILLS.map(({ test, polyfills }) => ({
          test,
          presets: [
            [
              require.resolve('@babel/preset-env'),
              {
                targets: TV_TARGETS,
                ...(options.polyfills === false ? { useBuiltIns: false } : { useBuiltIns: 'usage', corejs: CORE_JS_VERSION, exclude: [polyfillsExcept(polyfills)] }),
                bugfixes: true,
                modules: false,
              },
            ],
          ],
        })),
      ],
      plugins: [[require.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic', importSource: 'preact' }]],
    }),
    // UTF-8 out (not `ascii_only`): an Arabic letter costs 2 bytes in the file, where its
    // `\uXXXX` escape cost 6 (about 35 KB of main.js in step 32d3). The TV pages declare
    // `<meta charset="utf-8">`, so a file:// script without a charset of its own is read as
    // UTF-8, and Blob workers always are. Terser still escapes what can't stand as it is: U+2028
    // and U+2029 (they end a line in an ES2016 literal; the syntax gate would refuse them),
    // U+FEFF and lone surrogates (no UTF-8 form). bundle.test.ts pins each.
    terser({
      format: { comments: false, ascii_only: false },
      compress: { passes: 2 },
    }),
    // After terser: renderChunk hooks run in plugin order.
    substituteWorkers(collected.literals, collected.inlined),
  ];
}

/** A split build's file names: the entry is main.js, a lazy file is named after its module. */
const SPLIT_OUTPUT: OutputOptions = {
  format: 'amd',
  // `__labloDefine('settings', ['exports', './main'], …)`: ids are the file names (amd-loader.ts).
  amd: { autoId: true, define: DEFINE_NAME },
  entryFileNames: 'main.js',
  chunkFileNames: '[name].js',
  // The names main exports to a lazy file are minified (one or two letters each).
  minifyInternalExports: true,
  // The loader goes before main's define (a banner is in the chunk before terser runs).
  banner: (chunk) => (chunk.isEntry ? amdLoaderScript(chunk.fileName.replace(/\.js$/, '')) : ''),
};

/**
 * The shape the loader handles (amd-loader.ts): one entry, and lazy files that each need only the
 * entry (none shared between lazy files, none loading another). Returns what is wrong, or [].
 */
export function checkChunks(chunks: ReadonlyArray<Pick<OutputChunk, 'fileName' | 'isEntry' | 'isDynamicEntry' | 'imports' | 'dynamicImports'>>): string[] {
  const entries = chunks.filter((chunk) => chunk.isEntry);
  if (entries.length !== 1) return [`a split build has one entry, not ${entries.length}`];
  const entry = entries[0]!;
  const problems: string[] = [];
  if (entry.imports.length > 0) problems.push(`${entry.fileName} imports ${entry.imports.join(', ')}: the loader loads nothing at the start`);
  for (const chunk of chunks) {
    if (chunk === entry) continue;
    if (!chunk.isDynamicEntry) problems.push(`${chunk.fileName} is shared by lazy files: the loader loads one file per import()`);
    const others = chunk.imports.filter((file) => file !== entry.fileName);
    if (others.length > 0) problems.push(`${chunk.fileName} imports ${others.join(', ')}: a lazy file may import only ${entry.fileName}`);
    if (chunk.dynamicImports.length > 0) problems.push(`${chunk.fileName} loads ${chunk.dynamicImports.join(', ')}: only ${entry.fileName} may load a lazy file`);
  }
  return problems;
}

function gate(code: string, label: string): void {
  const violation = checkSyntax(code, label);
  if (violation !== null) throw new SyntaxGateError(formatViolation(violation));
}

/**
 * Bundles `input` into one minified classic-script IIFE for the TV, with every
 * `?worker` import inlined, then runs the ES2016 syntax gate on the result. With `split`, main.js
 * and its lazy files instead (`BundleOptions.split`), each gated.
 * Throws `SyntaxGateError` if the output would not parse on Chromium 53.
 */
export async function bundleIife(options: BundleOptions): Promise<BundleResult> {
  const collected: Collected = { workers: [], literals: [], inlined: new Map(), css: [] };
  const split = options.split === true;
  const bundle = await rollup({
    input: options.input,
    plugins: plugins(options, collected),
    onwarn,
    // A split entry exports nothing: no facade file re-exporting main's code.
    ...(split ? { preserveEntrySignatures: false as const } : {}),
  });
  try {
    const { output } = await bundle.generate(split ? SPLIT_OUTPUT : { format: 'iife', inlineDynamicImports: true });
    const chunks = output.filter((file): file is OutputChunk => file.type === 'chunk');
    const label = options.label ?? options.input;
    if (split) {
      const problems = checkChunks(chunks);
      if (problems.length > 0) throw new Error(`${label}: the split build has a shape its loader can't load:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    }
    const [entry] = chunks.filter((chunk) => chunk.isEntry);
    if (entry === undefined) throw new Error(`${label}: no entry chunk`);
    gate(entry.code, label);
    const lazy = chunks
      .filter((chunk) => chunk !== entry)
      .map((chunk): LazyChunk => {
        gate(chunk.code, options.lazyLabel?.(chunk.fileName) ?? `${chunk.fileName} of ${label}`);
        return { fileName: chunk.fileName, code: chunk.code, inlinedBytes: collected.inlined.get(chunk.fileName) ?? 0, modules: Object.keys(chunk.modules) };
      });
    return {
      code: entry.code,
      workers: collected.workers,
      inlinedBytes: collected.inlined.get(entry.fileName) ?? 0,
      css: collected.css,
      modules: Object.keys(entry.modules),
      lazy,
    };
  } finally {
    await bundle.close();
  }
}
