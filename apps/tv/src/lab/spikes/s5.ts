/**
 * S5 from docs/architecture.md §5: the webOS `<video>` battery (RELAY step 15c). The battery's
 * rows (`battery.ts`) on a `<video>` element: what webOS plays with, what Tizen falls back to for
 * HLS, and the desktop's dev loop. The TVs judge it (step 16); a desktop browser shows which rows
 * its codecs answer (no MPEG-TS, no AC3, and HEVC only with a hardware decoder).
 *
 * On webOS the audio rows have a second route (step 15c2): luna `com.webos.media/selectTrack` with
 * the element's `mediaId`, through the webOS adapter, where `audioTracks` is missing or fails.
 */
import { webosSelectTrack } from '@zoma/platform-webos';
import type { BatteryDeps } from '../battery';
import { batteryChecks } from '../battery';
import { xhrJson } from '../http';
import type { Spike } from '../types';
import type { VideoEnv } from '../video-player';
import { pageVideoPlayer } from '../video-player';

/** The luna answer in a few words, for the record. */
export function lunaAnswerText(answer: Readonly<Record<string, unknown>>): string {
  const text = JSON.stringify(answer);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** webOS's track service; the other builds drop it (`__PLATFORM__` is a literal there). */
function platformSelectTrack(): VideoEnv['selectTrack'] {
  if (__PLATFORM__ !== 'webos') return null;
  return (mediaId, index) => webosSelectTrack(mediaId, 'audio', index).then(lunaAnswerText);
}

export const DEFAULT_S5_DEPS: BatteryDeps = {
  createPlayer: () => pageVideoPlayer(platformSelectTrack()),
  getJson: (url) => xhrJson(url),
  clock: { now: () => performance.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
};

export function createS5(deps: BatteryDeps = DEFAULT_S5_DEPS): Spike {
  return {
    id: 'S5',
    title: 'Video battery',
    // One line on the screen: the ten checks' titles carry the criteria.
    question: "The webOS <video> battery: S4's matrix, audioTracks or luna, 302s, MKV audio",
    checks: batteryChecks('S5', deps),
  };
}

export const S5 = createS5();
