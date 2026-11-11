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
  /** The focus engine's path for the e2e `RemoteDriver` and the old-engine harness (`LabloTestHook` in src/test-hook.ts, RELAY step 14b). */
  __LABLO_TEST__?: { focusPath(): string | null };
}

interface Window {
  /** The Lablo Lab's session and records, for the e2e tests and the old-engine harness (src/lab/lab-main.tsx, RELAY step 15a). */
  __LABLO_LAB__?: {
    readonly session: string;
    readonly server: string;
    /** Every record of the session (`LabRecord` in src/lab/types.ts). */
    readonly records: ReadonlyArray<{ readonly type: string; readonly spike?: string; readonly check?: string; readonly status?: string }>;
    /** `ready`, `running` or `done` (`LabPhase`). */
    phase(): string;
    runs(): number;
    /** The reporter's counts (`ReporterState` in src/lab/reporter.ts). */
    sent(): { readonly sent: number; readonly pending: number; readonly failures: number; readonly lastError: string | null };
  };
}
