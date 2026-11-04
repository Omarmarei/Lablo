/**
 * Audio Guidance and speech on webOS (RELAY step 15b2, spike S11), through luna calls:
 * - `luna://com.webos.settingsservice/getSystemSettings` with `{category: "option", keys:
 *   ["audioGuidance"]}`: `settings.audioGuidance` is "on" or "off". In LG's public reference
 *   (webOS TV 3.0+), no permission listed.
 *   https://webostv.developer.lge.com/develop/references/settings-service
 * - `luna://com.webos.service.tts/speak` with `{text, clear: true}`: not in LG's TV docs (only
 *   webOS OSE documents it), but LG's own Enact framework calls it on TVs when Audio Guidance is
 *   on (`@enact/webos/speech`). S11 finds out whether a TV takes it.
 */
import type { PlatformCall, ScreenReaderState } from '@zoma/platform-api';
import type { BridgeFactory } from './luna';
import { LunaError, jsonText, lunaRequest, palmServiceBridge } from './luna';

export const AUDIO_GUIDANCE_URI = 'luna://com.webos.settingsservice/getSystemSettings';
export const TTS_URI = 'luna://com.webos.service.tts/speak';

/** Audio Guidance on or off from a `getSystemSettings` answer, or null when it doesn't say. */
export function audioGuidanceFrom(answer: Record<string, unknown>): boolean | null {
  const settings = answer.settings;
  if (settings === null || typeof settings !== 'object') return null;
  const value = (settings as { audioGuidance?: unknown }).audioGuidance;
  return value === 'on' ? true : value === 'off' ? false : null;
}

export function readAudioGuidance(bridge: BridgeFactory = palmServiceBridge, timeoutMs = 3000): Promise<ScreenReaderState> {
  return lunaRequest(AUDIO_GUIDANCE_URI, '{"category":"option","keys":["audioGuidance"]}', { bridge, timeoutMs }).then(
    (answer) => {
      const on = audioGuidanceFrom(answer);
      const settings = answer.settings as { audioGuidance?: unknown } | undefined;
      return { on, detail: `audioGuidance = ${String(settings?.audioGuidance)}` };
    },
    (error: unknown) => ({ on: null, detail: error instanceof Error ? error.message : String(error) }),
  );
}

/** `unsupported` without the luna bridge (a desktop browser); a TV's refusal rejects. */
export function webosSpeak(text: string, bridge: BridgeFactory = palmServiceBridge, timeoutMs = 3000): Promise<PlatformCall> {
  return lunaRequest(TTS_URI, `{"text":${jsonText(text)},"clear":true}`, { bridge, timeoutMs }).then(
    (): PlatformCall => 'done',
    (error: unknown) => {
      if (error instanceof LunaError && error.message.indexOf('no PalmServiceBridge') === 0) return 'unsupported';
      throw error;
    },
  );
}
