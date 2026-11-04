/**
 * Spikes whose checks need a player only some TVs have (S4 and S8: AVPlay on Samsung, step 15c2).
 */
import type { Check } from '../types';

/**
 * Checks that skip with the reason when there is no player for them (`missing`), and otherwise
 * run as written. `deps` is read on the first run, not at import.
 */
export function guarded<D>(checks: (deps: () => D) => Check[], resolve: () => D | null, missing: (deps: D) => string | null, none: string): Check[] {
  let resolved: { readonly deps: D | null } | null = null;
  const current = (): D | null => (resolved ??= { deps: resolve() }).deps;
  const need = (): D => {
    const deps = current();
    if (deps === null) throw new Error(none);
    return deps;
  };
  return checks(need).map((check) => ({
    ...check,
    run: (context) => {
      const deps = current();
      const why = deps === null ? none : missing(deps);
      return why === null ? check.run(context) : Promise.resolve({ status: 'skip', note: why });
    },
  }));
}
