import type { Scenario } from '../apps/mock-provider/src/faults';
import { parseScenario } from '../apps/mock-provider/src/faults';

/**
 * The mock's rule that keeps its `get.php` link a playlist (RELAY step 37a). Onboarding reads an
 * Xtream link given as a playlist through the panel's API first; under this rule the API still
 * logs the account in (the panel's zone and formats, ADR-010) but fails its first list, so the
 * link is read as the playlist it was given as. For specs that test a playlist's own behaviour
 * (its keys, catch-up modes, episodes listed flat, a restored link) on the mock's `get.php`.
 */
export const PLAYLIST_ONLY_RULE = { match: { path: '/player_api.php', action: 'get_live_categories' }, faults: [{ type: 'status', status: 500 }] };

/** A scenario of that rule alone (a mock's `scenario`, or `mockState.scenario` for one test). */
export function playlistOnly(): Scenario {
  return parseScenario({ description: "The panel's API serves no lists", rules: [PLAYLIST_ONLY_RULE] }, 'playlist-only');
}
