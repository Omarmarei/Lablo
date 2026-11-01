# ADR-005: Servers never touch provider URLs or streams

- **Status:** Accepted
- **Date:** 2026-11-01
- **Source:** docs/PLAN.md §3 "Legal" and §5 "Backend"; docs/architecture.md §3

## Context
Both stores have removed IPTV players before, and rights holders have acted against players and their domains (Filmspeler in the EU, LaLiga against Smarters, ISP blocks of SIPTV and SmartOne). US case law (*Cox v. Sony*, 2026) ties contributory liability to inducement or a service tailored to infringement. A neutral player that never handles content, never knows which provider a user has, and can comply with orders stays on the right side of that line. Incumbents also lose user trust by keeping playlist credentials on their servers.

## Decision
- Our backend **never fetches a user-supplied or provider URL** and **never relays, proxies, caches or transcodes streams, playlists, EPGs or images.** All provider traffic goes directly from the TV to the provider.
- The backend handles only: the signed remote config and kill-switch, an end-to-end encrypted pairing relay (ciphertext only), encrypted backups (ciphertext only), and scrubbed telemetry and diagnostics.
- The domain blocklist is matched **on the TV** against `sha256(salt + host)`, so the server never learns provider hosts.
- No bundled, default or suggested playlists; no provider affiliations or reseller panels; no proxy or bandwidth-monetization SDKs.
- **Enforcement:** `apps/web` may import only `protocol` and `crypto`. A lint rule added with the backend (RELAY step 29) forbids outbound `fetch` to arbitrary URLs from `apps/web`.

## Consequences
- No server-side EPG compaction, image proxy or TMDB enrichment of user sources, even though they would help weak TVs. All of that runs on the TV.
- Pairing and backup must be end-to-end encrypted (ADR-006).
- Kill modes and the blocklist let us comply with lawful orders without seeing user data.
