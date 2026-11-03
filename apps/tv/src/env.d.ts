/** Replaced at build time: Vite (desktop) defines `browser`, tools/build `tizen` or `webos`. */
declare const __PLATFORM__: 'tizen' | 'webos' | 'browser';

/**
 * Worker imports: `import HelloWorker from './workers/hello.worker?worker'`.
 * Vite serves the worker as a module worker in development; the TV build compiles it to a
 * Chromium 53 IIFE and inlines it as a Blob URL (tools/build/src/bundle.ts).
 */
declare module '*?worker' {
  const WorkerFactory: new () => Worker;
  export default WorkerFactory;
}

interface Window {
  /** The focus engine's path for the e2e `RemoteDriver` and the old-engine harness (`ZomaTestHook` in src/test-hook.ts, RELAY step 14b). */
  __ZOMA_TEST__?: { focusPath(): string | null };
}
