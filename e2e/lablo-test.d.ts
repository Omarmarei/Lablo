/**
 * The dev app's test hook (apps/tv/src/test-hook.ts `LabloTestHook`), as e2e code reads it inside
 * the page. Written out here: the root tsc can't load the app's modules (they reach .tsx).
 */
interface Window {
  __LABLO_TEST__?: { focusPath(): string | null };
}
