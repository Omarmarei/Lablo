# ADR-009: M3U ContentKeys hash tvg-id plus name, and the key functions are frozen

- **Status:** Accepted
- **Date:** 2026-11-02
- **Amends:** docs/architecture.md §1.4 step 6 (the M3U ContentKey formula)

## Context
architecture.md §1.4 gives the M3U key as `m:<src>:<hash(tvg-id || normName+group)>:<dup#>`: the tvg-id alone when there is one, otherwise the normalized name plus group. Favourites, progress and channel-number overrides reference these keys, so their stability decides whether complaint #7 (lost favourites) comes back.

Hashing the tvg-id alone breaks on a very common playlist shape: one tvg-id shared by several variants of a channel (`MBC 1 HD`, `MBC 1 SD`, `MBC 1 4K` all with `tvg-id="mbc1.ae"`). They would all share one hash and differ only by `<dup#>`, which follows playlist order. When the provider reorders them, favourites move silently to another variant. A key that disappears is better than one that silently points at something else, because a missing key goes through the 30-day re-match by name (§1.4 step 10).

A 32-bit hash is also too small: 200k items give about 5 expected collisions, and a collision turns two unrelated channels into `<dup#>` siblings.

## Decision
- **M3U key:** `m:<src>:<hash>:<dup>`, where `<hash>` is `hash53` in base 36 of:
  - `i` + tvg-id (trimmed, lower case) + `normalizeName(name)`, when the entry has a tvg-id;
  - `n` + `normalizeName(name)` + `normalizeName(group)`, when it has none.

  The parts are joined with U+0001. `<dup>` counts earlier entries of the same source with the same hash, in playlist order.
- **What the key leaves out:** the URL (credentials, renumbering), the content kind (a later classifier fix must not rekey a catalog), and for tvg-id entries the group (providers rename groups more often than channels).
- **`hash53`:** a 53-bit hash (two 32-bit lanes with the MurmurHash3 finalizer). 200k items give about 2e-6 expected collisions.
- **Xtream key:** unchanged, `x:<src>:<kind>:<id>`; episodes use kind `episode`.
- **Frozen:** `normalizeName`, `hash53` and the key layout are part of stored data. Golden tests pin real key and hash values (`packages/core/src/content-key.test.ts`, `normalize.test.ts`). Changing any of them needs a profile migration that rewrites stored keys.

## Consequences
- HD/SD/4K variants with a shared tvg-id get distinct, order-independent keys. Exact duplicates (the same channel in two groups) still differ only by `<dup>`, which is harmless, since they are the same channel.
- Renaming a channel that has a tvg-id changes its key. The favourite then shows as "unavailable" and is re-matched (§1.4 step 10). That re-match should try the tvg-id plus `matchName` before the name alone (data step 8 / personalization step 36).
- Normalization improvements after launch can't silently change keys: they either keep the old function for keys or come with a migration.
