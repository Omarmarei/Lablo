# Architecture decision records

One file per decision, numbered in order. Format: Status, Date, Context, Decision, Consequences. A superseded ADR stays in place with its status changed and a link to the one that replaces it.

| ADR | Decision | Status |
|---|---|---|
| [001](ADR-001-packaged-apps.md) | Packaged apps on both platforms | Accepted |
| [002](ADR-002-preact-signals-focus-engine.md) | Preact + signals + custom index-based focus engine | Accepted |
| [003](ADR-003-chrome53-iife-syntax-gate.md) | Chromium 53 IIFE build + acorn ES2016 syntax gate | Accepted |
| [004](ADR-004-native-players-first.md) | Native players first (AVPlay / webOS `<video>`) | Accepted |
| [005](ADR-005-servers-never-touch-provider-urls.md) | Servers never touch provider URLs or streams | Accepted |
| [006](ADR-006-e2e-pairing-backup-crypto.md) | End-to-end pairing and backup crypto | Accepted |
| [007](ADR-007-stalker-dropped.md) | Stalker/MAG portals dropped | Accepted |
| [008](ADR-008-player-platform-api-direction.md) | `platform-api` depends on `player`, not the reverse | Accepted |
| [009](ADR-009-m3u-content-keys.md) | M3U ContentKeys hash tvg-id plus name; key functions are frozen | Accepted |
| [010](ADR-010-catchup-time-zones.md) | Catch-up time zones (Intl, then the panel clock, then UTC) and M3U catch-up mode inference | Accepted |
| [011](ADR-011-i18n-runtime-and-digits.md) | i18n: CLDR plurals in core, an ICU message subset, our own formats instead of `Intl`, Western digits in Arabic by default (reversible), provider text isolated | Accepted |
| [012](ADR-012-lg-minimum-webos5.md) | LG minimum webOS 5 (2020); the webOS year from `sdkVersion` or the engine; `requiredACG` in every webOS manifest, checked by the build; the harness keeps Chromium 53 | Accepted |
