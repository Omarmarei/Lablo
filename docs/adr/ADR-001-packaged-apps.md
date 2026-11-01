# ADR-001: Packaged apps on both platforms

- **Status:** Accepted
- **Date:** 2026-11-01
- **Source:** docs/PLAN.md §5, docs/architecture.md "Key decisions"

## Context
Samsung Tizen and LG webOS both accept either a packaged web app (`.wgt` / `.ipk`, files shipped inside the package) or a hosted app (a thin package that loads an HTTPS URL). Most IPTV providers serve their APIs and streams over plain `http://`. A hosted HTTPS app cannot call `http://` panels because of mixed-content blocking, and it is subject to CORS. Packaged apps have no web origin, so cross-origin `http://` calls can work (spike S7 confirms this per platform). Store reviews are slow (Samsung: one week to three months), which argues for hosted apps, but provider connectivity rules them out.

## Decision
Ship packaged apps on both platforms: Tizen `.wgt` and webOS `.ipk`. Everything that might need tuning after release (buffer sizes, watchdog thresholds, EPG windows, kill modes, blocklist) comes from a signed remote config (ADR-006 §C, architecture.md §3.3) instead of a server-hosted UI.

## Consequences
- Every UI or logic fix needs a store update, so remote config must cover behaviour that may need fast changes.
- `author.p12` (Samsung) must be backed up forever: updates signed with another author certificate are rejected.
- If S7 fails on webOS (no cross-origin `http://` from a packaged app), a bundled webOS JS service relays HTTP on the device (+2 sessions). It still runs on the user's TV, never on our servers (ADR-005).
