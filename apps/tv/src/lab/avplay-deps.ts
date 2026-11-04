/**
 * The AVPlay batteries on this page (RELAY step 15c2): S4's and S8's dependencies from
 * platform-tizen's AVPlay. Only the Tizen build reaches this module (`spikes/s4.ts` and
 * `spikes/s8.ts` call it behind `__PLATFORM__ === 'tizen'`), so the other builds drop it, and
 * with it every AVPlay call.
 */
import { tizenAvplay, tizenAvplayStore } from '@zoma/platform-tizen';
import type { AvplayStage } from './avplay-player';
import { createAvplayPlayer, mountAvplayStage } from './avplay-player';
import type { BatteryClock } from './battery';
import { probeRedirect, xhrJson } from './http';
import type { S4Deps } from './spikes/s4';
import type { S8Deps } from './spikes/s8';

export const NO_AVPLAY = 'no webapis.avplay here (a Samsung TV has it)';
export const NO_AVPLAYSTORE = 'no webapis.avplaystore here (a 2020+ Samsung TV should have it)';

const PAGE_CLOCK: BatteryClock = { now: () => performance.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

export function tizenS4Deps(): S4Deps {
  return {
    missing: () => (tizenAvplay() === null ? NO_AVPLAY : null),
    createPlayer: () => {
      const api = tizenAvplay();
      if (api === null) throw new Error(NO_AVPLAY);
      return createAvplayPlayer(api, mountAvplayStage(document));
    },
    getJson: (url) => xhrJson(url),
    clock: PAGE_CLOCK,
    probeRedirect: (url) => probeRedirect(url),
  };
}

export function tizenS8Deps(): S8Deps {
  return {
    missing: () => (tizenAvplayStore() === null ? NO_AVPLAYSTORE : null),
    mountStage: () => mountAvplayStage(document),
    createPlayer: (stage: AvplayStage) => {
      const store = tizenAvplayStore();
      if (store === null) throw new Error(NO_AVPLAYSTORE);
      return createAvplayPlayer(store.getPlayer(), stage);
    },
    getJson: (url) => xhrJson(url),
    clock: PAGE_CLOCK,
  };
}
