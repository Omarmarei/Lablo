import vm from 'node:vm';

/** A script tag as the AMD loader uses one (amd-loader.ts). */
interface FakeScript {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  parentNode: FakeHead | null;
}

interface FakeHead {
  readonly children: FakeScript[];
  appendChild(script: FakeScript): void;
  removeChild(script: FakeScript): void;
}

export interface ScriptPage {
  /** The page's realm: `window` is its global. */
  readonly context: vm.Context;
  /** The `src` of every script tag the page added, in order. */
  readonly requested: string[];
  /** The script tags in `<head>` now. */
  attached(): number;
  /** Runs `code` as one of the page's classic scripts. */
  run(code: string): void;
  /** The page's `globalThis.fixture`. */
  fixture<T>(): T;
}

/**
 * A page for the AMD loader in a vm realm (RELAY step 35e). A script tag added to `<head>` loads
 * `files.get(src)` a task later and then fires `onload`, or fires `onerror` when `files` has no
 * such file (a test can add it later, for a retry). `prelude` runs first: e.g. deleting the
 * ES2017 APIs Chromium 53 lacks.
 */
export function scriptPage(files: Map<string, string>, prelude = ''): ScriptPage {
  const requested: string[] = [];
  const sandbox: Record<string, unknown> = {};
  const context = vm.createContext(sandbox);
  const head: FakeHead = {
    children: [],
    appendChild(script) {
      head.children.push(script);
      script.parentNode = head;
      requested.push(script.src);
      setTimeout(() => {
        const code = files.get(script.src);
        if (code === undefined) {
          script.onerror?.();
          return;
        }
        vm.runInContext(code, context, { filename: script.src });
        script.onload?.();
      }, 0);
    },
    removeChild(script) {
      head.children.splice(head.children.indexOf(script), 1);
      script.parentNode = null;
    },
  };
  sandbox.window = sandbox;
  // A page has timers (core-js's Promise and its unhandled-rejection report use them).
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  sandbox.document = {
    head,
    createElement(tag: string): FakeScript {
      if (tag !== 'script') throw new Error(`the page makes only scripts, not <${tag}>`);
      return { src: '', onload: null, onerror: null, parentNode: null };
    },
  };
  if (prelude !== '') vm.runInContext(prelude, context);
  return {
    context,
    requested,
    attached: () => head.children.length,
    run: (code) => vm.runInContext(code, context, { filename: 'main.js' }),
    fixture: <T>() => vm.runInContext('globalThis.fixture', context) as T,
  };
}
