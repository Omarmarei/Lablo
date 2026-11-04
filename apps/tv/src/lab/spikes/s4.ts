/**
 * S4 from docs/architecture.md §5: the AVPlay battery (RELAY step 15c2). S5's rows
 * (`battery.ts`) on Samsung's native player (`avplay-player.ts`), plus `redirect-probe`: the live
 * stream at the URL the redirect probe found, where AVPlay may freeze on the 302s themselves (the
 * `redirect` row). The AVPlay player answers the rest in its own way: `setSelectTrack` for the
 * audio switch, `onsubtitlechange` for the cues, `suspend`/`restore` for Home and back.
 *
 * AVPlay exists only on a Samsung TV: without it (the desktop, a webOS TV, the old-engine harness)
 * every row skips. Only the Tizen build reaches AVPlay (`avplay-deps.ts`); the others drop it.
 */
import type { BatteryDeps } from '../battery';
import { batteryChecks } from '../battery';
import { tizenS4Deps } from '../avplay-deps';
import type { Check, Spike } from '../types';
import { guarded } from './guarded';

export interface S4Deps extends BatteryDeps {
  /** Why there is no AVPlay here, or null when there is. */
  missing(): string | null;
}

export const NOT_TIZEN = 'no AVPlay: this is not the Tizen build';

/** The deps on this page: AVPlay's in the Tizen build, none in the others. */
function platformDeps(): S4Deps | null {
  return __PLATFORM__ === 'tizen' ? tizenS4Deps() : null;
}

export function createS4(resolve: () => S4Deps | null = platformDeps): Spike {
  const checks = (deps: () => S4Deps): Check[] =>
    batteryChecks('S4', {
      createPlayer: () => deps().createPlayer(),
      getJson: (url) => deps().getJson(url),
      clock: { now: () => deps().clock.now(), sleep: (ms) => deps().clock.sleep(ms) },
      probeRedirect: (url) => {
        const probe = deps().probeRedirect;
        return probe === undefined ? Promise.reject(new Error('no redirect probe')) : probe(url);
      },
    });
  return {
    id: 'S4',
    title: 'AVPlay battery',
    question: "Samsung's AVPlay: the S5 matrix, the 302 freeze and the redirect probe",
    checks: guarded(checks, resolve, (deps) => deps.missing(), NOT_TIZEN),
  };
}

export const S4 = createS4();
