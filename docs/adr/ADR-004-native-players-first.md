# ADR-004: Native players first (AVPlay / webOS `<video>`)

- **Status:** Accepted
- **Date:** 2026-11-01
- **Source:** docs/PLAN.md §3 "Playback facts", docs/architecture.md §2

## Context
IPTV streams are mostly MPEG-TS and HLS, often 4K/HEVC with AC3/E-AC3 audio, behind redirects and per-account connection limits. Browser streaming libraries (hls.js, mpegts.js) play through MSE, which on Samsung is limited to Full HD and has unreliable AC3 support. The native players avoid CORS entirely when given a direct URL. AVPlay is known to freeze on endless TS streams and on HTTP 302 redirects. LG supports only one video element at a time.

## Decision
- **Tizen:** `AvplayEngine` (in `platform-tizen`) is the primary engine for everything, including 4K, TS, AC3/E-AC3 and track switching. `Html5Engine` is an HLS-only fallback for specific AVPlay error codes.
- **webOS and desktop:** `Html5Engine` with one app-wide `<video>` element.
- **MSE engine** (hls.js / mpegts.js) only if spike S5 shows gaps in native HLS on webOS; never the default.
- A platform-agnostic `PlayerController` in `packages/player` owns session tokens, close-before-open, the URL strategy (`.ts` then `.m3u8`), the Tizen redirect probe, the stall watchdog and retry ladder, the error classifier and zapping.
- Subtitles are drawn by our own overlay (no `<track>` on webOS), fed by our SRT/VTT parser and AVPlay's text callback.

## Consequences
- Engines implement the `PlayerEngine` interface from `packages/player`; platform adapters construct them (ADR-008).
- Behaviour that differs per model (track switching, redirects, stalls) is decided by hardware spikes S4 and S5 and can be tuned through remote config.
- Multiview and true PiP are out of v1 (one video element on LG).
