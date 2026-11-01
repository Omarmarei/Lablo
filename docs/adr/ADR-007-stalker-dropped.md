# ADR-007: Stalker/MAG portals dropped

- **Status:** Accepted
- **Date:** 2026-11-01
- **Source:** docs/PLAN.md "Decisions from Omar (2026-11-01)", §3 "Data facts", §4 "Not in v1"

## Context
Stalker (Ministra) portals authenticate a client by impersonating a MAG set-top box (MAC address and STB identity). The format is closely tied to piracy resellers. Supporting it would weaken Zoma's position as a neutral player (ADR-005) and its standing with the stores.

## Decision
Omar decided on 2026-11-01 that Stalker/MAG portal support is **dropped permanently**, not deferred. Zoma supports M3U (URL or file) and the Xtream Codes API only.

## Consequences
- No Stalker client, no MAC/STB impersonation, and no stub or feature flag for it.
- Store copy and the UI never mention Stalker or MAC portals.
- Users of Stalker-only providers are not served. This is accepted.
