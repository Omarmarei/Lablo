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

/**
 * Notices shown that the profile keeps (step 30c2a; a config has at most 100 rules): a new one
 * past this drops the one shown longest ago.
 */
export const MAX_NOTICES = 100;

/**
 * A kill rule's id as `@lablo/protocol`'s `killRule` takes it: 1 to 40 of lowercase ASCII
 * letters, digits and `-` (read with `charCodeAt`: no regex, so the TV bundle takes no polyfill).
 */
export function isRuleId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 40) return false;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return false;
  }
  return true;
}
