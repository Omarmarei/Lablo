/**
 * The catalog ingest's version (architecture.md §1.4), in a module of its own so that the app's
 * refresh schedule can read it through `@lablo/data/client` without the ingest's code.
 *
 * Bump it when parsing or what a generation stores changes: a refresh then rebuilds even
 * unchanged bytes (the fetch stamp's `v` differs), and the schedule refreshes a catalog an older
 * version built at its first check.
 *
 * - 1: the first (step 8).
 * - 2: movies keep their newest with their categories (step 26e, "Recently added").
 */
export const INGEST_VERSION = 2;
