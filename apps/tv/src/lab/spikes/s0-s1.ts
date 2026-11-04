/**
 * S0 (the device) and S1 (the runtime baseline) from docs/architecture.md §5.
 *
 * S1 asks whether the IIFE, the polyfills, Preact, a Blob worker, `response.body` streaming,
 * TextDecoder and an IndexedDB bulk write work on Tizen 4 and webOS 4. Each part is one check;
 * the worker parts run inside the lab worker, where the data engine really runs.
 */
import { idbRoundTrip } from '../../workers/idb-check';
import { readLabStream, textDecoderSplits } from '../probes';
import type { Check, CheckResult, LabContext, Spike } from '../types';

/** Lines the streamed-fetch checks ask for: about 600 KB. */
export const STREAM_LINES = 20_000;
/** S1's bulk write: the ingest's chunk size, 20 chunks. */
export const BULK_ITEMS = 10_000;
export const BULK_CHUNK = 500;

type Globals = Record<string, unknown>;

function globals(): Globals {
  return window as unknown as Globals;
}

function has(path: string): boolean {
  let value: unknown = globals();
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return false;
    value = (value as Globals)[part];
  }
  return value !== undefined && value !== null;
}

const device: Check = {
  id: 'device',
  title: 'Model, firmware and engine',
  run: (context: LabContext) => {
    const { info } = context;
    let timeZone: string | null = null;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      timeZone = null;
    }
    const nav = navigator as Navigator & { deviceMemory?: number };
    return Promise.resolve<CheckResult>({
      status: 'info',
      value: {
        ...info,
        labVersion: context.version,
        userAgent: navigator.userAgent,
        screen: { width: screen.width, height: screen.height, devicePixelRatio: window.devicePixelRatio, inner: [window.innerWidth, window.innerHeight] },
        cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
        memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
        languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 5) : [navigator.language],
        timeZone,
        utcOffsetMinutes: -new Date().getTimezoneOffset(),
      },
      note: `${info.platform} ${info.model}, OS ${info.osVersion}, Chromium ${info.chromiumVersion ?? '?'}, tier ${info.tier}`,
    });
  },
};

export const S0: Spike = {
  id: 'S0',
  title: 'Device',
  question: 'The model, firmware and Chromium version of this TV.',
  checks: [device],
};

/** What the bundle made work, against what the engine had before it (native-probe.js). */
function polyfillChecks(): Array<[string, () => boolean | Promise<boolean>]> {
  return [
    ['String.prototype.padStart', () => '7'.padStart(3, '0') === '007'],
    ['Object.entries', () => Object.entries({ a: 1 })[0]?.[1] === 1],
    ['Object.values', () => Object.values({ a: 1, b: 2 }).length === 2],
    ['Object.fromEntries', () => Object.fromEntries([['a', 1]]).a === 1],
    ['Promise.prototype.finally', () => Promise.resolve(1).finally(() => undefined).then((v) => v === 1)],
    ['Array.prototype.flat', () => [[1], [2, [3]]].flat().length === 3],
    ['Array.prototype.includes', () => [1, 2].includes(2)],
    ['globalThis', () => typeof globalThis === 'object' && globalThis.Math === Math],
    ['queueMicrotask', () => new Promise<boolean>((resolve) => queueMicrotask(() => resolve(true)))],
  ];
}

const boot: Check = {
  id: 'boot',
  title: 'The bundle started',
  run: () => {
    const timing = (performance as Performance & { timing?: PerformanceTiming }).timing;
    const startMs = timing === undefined ? null : Date.now() - timing.navigationStart;
    return Promise.resolve<CheckResult>({ status: 'pass', value: { msSinceNavigation: startMs }, note: 'main.js (a classic-script IIFE) ran' });
  },
};

const polyfills: Check = {
  id: 'polyfills',
  title: 'Polyfilled built-ins work',
  run: async () => {
    const native = (globals().__ZOMA_LAB_NATIVE__ ?? null) as Record<string, boolean> | null;
    const working: string[] = [];
    const broken: string[] = [];
    for (const [name, check] of polyfillChecks()) {
      let ok = false;
      try {
        ok = await check();
      } catch {
        ok = false;
      }
      (ok ? working : broken).push(name);
    }
    const polyfilled = native === null ? null : Object.keys(native).filter((name) => native[name] === false);
    return {
      status: broken.length === 0 ? 'pass' : 'fail',
      value: { working, broken, polyfilled },
      note: polyfilled === null ? 'no native-probe record' : polyfilled.length === 0 ? 'all native' : `filled by the bundle: ${polyfilled.join(', ')}`,
    };
  },
};

/** Looked up by name so that Babel's usage scan adds no polyfill for them: this lists what the engine has. */
const API_NAMES = [
  'fetch',
  'ReadableStream',
  'TextDecoder',
  'TextEncoder',
  'IntersectionObserver',
  'ResizeObserver',
  'AbortController',
  'DecompressionStream',
  'structuredClone',
  'Intl.PluralRules',
  'Intl.RelativeTimeFormat',
  'EventSource',
  'WebSocket',
  'MediaSource',
  'navigator.storage',
  'navigator.webkitTemporaryStorage',
  'document.fonts',
  'performance.now',
];

const apis: Check = {
  id: 'apis',
  title: 'Which web APIs the engine has',
  run: () => {
    const present: string[] = [];
    const missing: string[] = [];
    for (const name of API_NAMES) (has(name) ? present : missing).push(name);
    const css = typeof CSS === 'object' && typeof CSS.supports === 'function';
    const cssFeatures: Record<string, boolean> = {
      grid: css && CSS.supports('display', 'grid'),
      'flex gap': css && CSS.supports('gap', '1px') && CSS.supports('display', 'flex'),
      sticky: css && CSS.supports('position', 'sticky'),
      'logical properties': css && CSS.supports('margin-inline-start', '1px'),
      'custom properties': css && CSS.supports('--x', '1'),
    };
    return Promise.resolve<CheckResult>({ status: 'info', value: { present, missing, css: cssFeatures }, note: missing.length === 0 ? 'all present' : `missing: ${missing.join(', ')}` });
  },
};

const preact: Check = {
  id: 'preact',
  title: 'Preact renders',
  run: () => {
    const root = document.querySelector('[data-testid="lab"]');
    return Promise.resolve<CheckResult>(
      root === null ? { status: 'fail', note: 'the lab screen is not in the page' } : { status: 'pass', value: { nodes: root.getElementsByTagName('*').length } },
    );
  },
};

const blobWorker: Check = {
  id: 'blob-worker',
  title: 'A Blob worker starts and answers',
  run: async (context) => {
    const { startMs, features } = await context.worker.start();
    const missing = Object.keys(features).filter((name) => !features[name]);
    return { status: 'pass', value: { startMs, features }, note: `answered in ${startMs} ms${missing.length === 0 ? '' : `; missing in the worker: ${missing.join(', ')}`}` };
  },
};

const textDecoder: Check = {
  id: 'text-decoder',
  title: 'TextDecoder streams multi-byte text',
  run: () => {
    const { splits, wrong } = textDecoderSplits();
    return Promise.resolve<CheckResult>({
      status: wrong.length === 0 ? 'pass' : 'fail',
      value: { splits, wrong: wrong.slice(0, 20) },
      note: wrong.length === 0 ? `${splits} split points decoded right` : `${wrong.length} of ${splits} split points decoded wrong`,
    });
  },
};

function streamResult(report: Awaited<ReturnType<typeof readLabStream>>): CheckResult {
  const ok = report.badLine === null && report.lines === STREAM_LINES;
  return {
    status: ok ? 'pass' : 'fail',
    value: report,
    note: ok
      ? `${report.bytes} bytes in ${report.chunks} reads, ${report.totalMs} ms`
      : report.badLine !== null
        ? `line ${report.badLine} came out wrong`
        : `${report.lines} of ${STREAM_LINES} lines`,
  };
}

const streamUrl = (context: LabContext): string => `${context.server}/__lab/bytes?lines=${STREAM_LINES}`;

const fetchStream: Check = {
  id: 'fetch-stream',
  title: 'fetch streams response.body (page)',
  run: async (context) => streamResult(await readLabStream((url) => fetch(url), streamUrl(context))),
};

const fetchStreamWorker: Check = {
  id: 'fetch-stream-worker',
  title: 'fetch streams response.body (worker)',
  run: async (context) => streamResult(await context.worker.fetchStream(streamUrl(context))),
};

const idbPage: Check = {
  id: 'idb',
  title: 'IndexedDB write and read (page)',
  run: async () => {
    const outcome = await idbRoundTrip(window.indexedDB ?? undefined, Date.now(), 'zoma-lab-page');
    return outcome === 'ok' ? { status: 'pass' } : { status: 'fail', note: outcome };
  },
};

const idbBulkWorker: Check = {
  id: 'idb-bulk-worker',
  title: 'IndexedDB bulk write (worker)',
  timeoutMs: 90_000,
  run: async (context) => {
    const report = await context.worker.idbBulk(BULK_ITEMS, BULK_CHUNK, 85_000);
    const ok = report.count === BULK_ITEMS && (report.getAll === null || report.getAll === BULK_CHUNK);
    return {
      status: ok ? 'pass' : 'fail',
      value: report,
      note: `${report.count} of ${BULK_ITEMS} items in ${report.writeMs} ms (slowest ${BULK_CHUNK}-item chunk ${report.slowestChunkMs} ms)${report.getAll === null ? '; no getAll' : ''}`,
    };
  },
};

export const S1: Spike = {
  id: 'S1',
  title: 'Runtime',
  question: 'Do the IIFE, polyfills, Preact, a Blob worker, response.body streaming, TextDecoder and an IndexedDB bulk write work?',
  checks: [boot, polyfills, apis, preact, blobWorker, textDecoder, fetchStream, fetchStreamWorker, idbPage, idbBulkWorker],
};
