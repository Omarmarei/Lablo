/**
 * S5 from docs/architecture.md §5: the webOS `<video>` battery (RELAY step 15c). The battery's
 * rows (`battery.ts`) on a `<video>` element: what webOS plays with, what Tizen falls back to for
 * HLS, and the desktop's dev loop. The TVs judge it (step 16); a desktop browser shows which rows
 * its codecs answer (no MPEG-TS, no AC3, and HEVC only with a hardware decoder).
 */
import type { BatteryDeps } from '../battery';
import { batteryChecks } from '../battery';
import { xhrJson } from '../http';
import type { Spike } from '../types';
import { pageVideoPlayer } from '../video-player';

export const DEFAULT_S5_DEPS: BatteryDeps = {
  createPlayer: () => pageVideoPlayer(),
  getJson: (url) => xhrJson(url),
  clock: { now: () => performance.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
};

export function createS5(deps: BatteryDeps = DEFAULT_S5_DEPS): Spike {
  return {
    id: 'S5',
    title: 'Video battery',
    // One line on the screen: the ten checks' titles carry the criteria.
    question: "The webOS <video> battery: S4's matrix, audioTracks, 302s, MKV audio",
    checks: batteryChecks('S5', deps),
  };
}

export const S5 = createS5();
