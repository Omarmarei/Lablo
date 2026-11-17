/**
 * The signed config's constants (architecture.md §3.3 C, RELAY steps 30b1 and 30b2), in a module
 * of their own: the query worker (the blocklist) and the app (the schedule) need them without
 * config-service.ts, whose schemas and signature check would come along.
 */

/** The cached copy's key in the `kv` store. */
export const CONFIG_KEY = 'config';
/** The whole answer must arrive within this (§3.3 C: "3 s timeout"). */
export const CONFIG_TIMEOUT_MS = 3000;
/** How often the app refreshes the config while it runs (§3.3 C: "every 6 h"). */
export const CONFIG_REFRESH_MS = 6 * 60 * 60 * 1000;
/**
 * The next try after a refresh that brought no new doc (offline at boot, a timeout, a refusal):
 * the cached copy stays in force meanwhile.
 */
export const CONFIG_RETRY_MS = 30 * 60 * 1000;
/** A larger answer is refused unread (a doc is at most 1 MiB of text; JSON escaping adds a little). */
export const CONFIG_MAX_BYTES = 4 * 1024 * 1024;
