/**
 * The screensaver and Voice Guide through Samsung's TV Product API (RELAY step 15b2, spike S11),
 * from `$WEBAPIS/webapis/webapis.js` (index.html loads it; it exists only on a TV):
 * - `webapis.appcommon.setScreenSaver(state, onsuccess, onerror)`, Tizen 2.3+, no privilege.
 *   Samsung's guide: certification wants the screensaver back on whenever playback pauses or
 *   stops, and the call does nothing while the TV's "Auto Protection Time" is off.
 * - `webapis.tvinfo.getMenuValue(TvInfoMenuKey.VOICE_GUIDE_KEY)`, Tizen 2.3+, no privilege. The
 *   reference says it answers `TvInfoMenuValue.ON` (1) or `OFF` (0), the guide's example says
 *   "true": both are read, and the lab records the raw answer.
 * https://developer.samsung.com/smarttv/develop/guides/fundamentals/setting-screensaver.html
 * https://developer.samsung.com/smarttv/develop/guides/fundamentals/text-to-speech.html
 */
import type { PlatformCall, ScreenReaderState } from '@lablo/platform-api';

export interface TizenError {
  readonly name?: string;
  readonly code?: number;
  readonly message?: string;
}

/** The slices of `webapis.appcommon` and `webapis.tvinfo` this adapter uses. */
export interface TvSettingsApi {
  readonly appcommon?: {
    setScreenSaver?(state: number, onsuccess?: (data?: unknown) => void, onerror?: (error: TizenError) => void): void;
    readonly AppCommonScreenSaverState?: { readonly SCREEN_SAVER_OFF?: number; readonly SCREEN_SAVER_ON?: number };
  };
  readonly tvinfo?: {
    getMenuValue?(key: number): unknown;
    readonly TvInfoMenuKey?: { readonly VOICE_GUIDE_KEY?: number };
  };
}

/** Samsung's constants, for a webapis.js that lacks the enum objects. */
export const SCREEN_SAVER_OFF = 0;
export const SCREEN_SAVER_ON = 1;
export const VOICE_GUIDE_KEY = 15;

/** How long the screensaver call may take to call back. */
export const TIZEN_CALL_TIMEOUT_MS = 3000;

function describe(error: TizenError | unknown): string {
  if (error === null || typeof error !== 'object') return String(error);
  const { name, code, message } = error as TizenError;
  return [name, code === undefined ? undefined : `code ${code}`, message].filter((part) => part !== undefined && part !== '').join(', ') || 'no details';
}

export function tizenSetScreenSaver(api: TvSettingsApi | undefined, allowed: boolean, timeoutMs = TIZEN_CALL_TIMEOUT_MS): Promise<PlatformCall> {
  const appcommon = api?.appcommon;
  if (appcommon?.setScreenSaver === undefined) return Promise.resolve('unsupported');
  const states = appcommon.AppCommonScreenSaverState;
  const state = allowed ? (states?.SCREEN_SAVER_ON ?? SCREEN_SAVER_ON) : (states?.SCREEN_SAVER_OFF ?? SCREEN_SAVER_OFF);
  return new Promise((resolve, reject) => {
    // A promise settles once: a late callback after the timeout (or a second one) changes nothing.
    const timer = setTimeout(() => settle(() => reject(new Error(`setScreenSaver did not call back within ${timeoutMs} ms`))), timeoutMs);
    function settle(run: () => void): void {
      clearTimeout(timer);
      run();
    }
    try {
      appcommon.setScreenSaver?.(
        state,
        () => settle(() => resolve('done')),
        (error) => settle(() => reject(new Error(`setScreenSaver failed: ${describe(error)}`))),
      );
    } catch (error) {
      settle(() => reject(new Error(`setScreenSaver threw: ${describe(error)}`)));
    }
  });
}

/** Voice Guide on or off from `getMenuValue`'s answer, which the docs give as 1/0 or "true". */
export function voiceGuideOn(raw: unknown): boolean | null {
  if (raw === 1 || raw === true || raw === '1' || raw === 'true' || raw === 'ON') return true;
  if (raw === 0 || raw === false || raw === '0' || raw === 'false' || raw === 'OFF') return false;
  return null;
}

export function tizenScreenReader(api: TvSettingsApi | undefined): ScreenReaderState {
  const tvinfo = api?.tvinfo;
  if (tvinfo?.getMenuValue === undefined) return { on: null, detail: 'no webapis.tvinfo' };
  const key = tvinfo.TvInfoMenuKey?.VOICE_GUIDE_KEY ?? VOICE_GUIDE_KEY;
  let raw: unknown;
  try {
    raw = tvinfo.getMenuValue(key);
  } catch (error) {
    return { on: null, detail: `getMenuValue(VOICE_GUIDE_KEY) threw: ${describe(error)}` };
  }
  return { on: voiceGuideOn(raw), detail: `getMenuValue(VOICE_GUIDE_KEY) = ${String(raw)} (${typeof raw})` };
}
