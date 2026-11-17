/**
 * The pairing client's timings (RELAY step 31c1), in a module of their own: `@lablo/data/client`
 * re-exports them for the pairing screen, which must not pull the pair service (and its schemas
 * and crypto) into the main bundle.
 */

/** How often the screen asks whether the phone has sent (architecture.md §3.3 A). */
export const PAIR_POLL_MS = 2000;
/** The time limit of each pairing request, for its whole answer. */
export const PAIR_TIMEOUT_MS = 10000;
/** The wait after a 429 without a usable `Retry-After`. */
export const PAIR_RETRY_MS = 60000;
