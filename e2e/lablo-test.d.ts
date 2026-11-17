/**
 * The dev app's test hook (apps/tv/src/test-hook.ts `LabloTestHook`), as e2e code reads it inside
 * the page. Written out here: the root tsc can't load the app's modules (they reach .tsx).
 */
interface LabloConfigView {
  readonly status: 'fresh' | 'cached' | 'none';
  readonly failure: string | null;
  readonly issuedAt: number | null;
  readonly kill: { readonly id: string; readonly mode: string } | null;
  readonly notices: readonly string[];
  readonly updateRequired: boolean;
}

interface Window {
  __LABLO_TEST__?: {
    focusPath(): string | null;
    /** The config's last answer (RELAY step 30c1). */
    config(): LabloConfigView | null;
    /** A config run now, resolving with its answer. */
    refreshConfig(): Promise<LabloConfigView | null>;
  };
}
