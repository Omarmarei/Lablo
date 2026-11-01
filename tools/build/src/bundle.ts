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
      const built = await bundleIife({ input: entry, platform: options.platform, label: `worker ${entry}` });
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
            useBuiltIns: 'usage',
            corejs: CORE_JS_VERSION,
            bugfixes: true,
            modules: false,
          },
        ],
        [require.resolve('@babel/preset-typescript'), { onlyRemoveTypeImports: true }],
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
