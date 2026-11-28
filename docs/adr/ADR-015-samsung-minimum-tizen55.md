# ADR-015: Samsung minimum Tizen 5.5 (2020), and what the `low` tier means now

- **Status:** Accepted. Omar dropped 2018–2019 Samsung sets on 2026-11-28 (phase 2's decision 5, docs/PLAN-2.md §2).
- **Date:** 2026-11-28 (relay step 60, leg 173)
- **Amends:** [ADR-012](ADR-012-lg-minimum-webos5.md)'s "Samsung keeps 2018 (Tizen 4, Chromium 56)" and its "the `low` tier now means Samsung 2018–2019"; docs/PLAN.md §"TV models to support"; docs/architecture.md §1.5 step 6 (the window table), §4 (device matrix) and §5 (S6). Implemented in `platforms/tizen/config.xml`, `tools/build/src/platform-files.ts` (`checkConfigXml`) and `packages/core/src/device.ts` (`deviceTier`).

## Context
- **The plan's Samsung minimum was 2018** (Tizen 4.0, Chromium 56). ADR-012 raised LG to 2020 and moved spike S6's low-tier run to a used 2018 Samsung that Omar was to buy. The Remote Test Lab (2019–2026) was the route for the other Samsung years (`docs/testing-without-tvs.md`).
- **Neither happened.** The one Samsung we have is a 2020 budget set: UA32T5300AUXEG, 32" HD, Tizen 5.5, Chromium 69, armv7, 4 cores (`docs/spikes/results.md`). Phase 2 adds 14 features and retargets the build to Chromium 68 (step 61). Holding a 2018 floor would keep the Chromium 53/56 rules for two years of sets we have never run on.
- **Omar's decision (2026-11-28):** Samsung needs 2020 (Tizen 5.5) and newer. 2018–2019 Samsung sets are dropped.
- **What reads the tier**, and what the 2020 Samsung did with the `full` tier's limits (results.md, run `scyp`, the 200k catalog and the 150 MB guide):

  | Reader | `full` vs `low` | The 2020 Samsung in `full` |
  |---|---|---|
  | The guide's window (`EPG_WINDOWS`; the guide's `GUIDE_DAYS`/`GUIDE_REACH`; the ingest's basis) | 7 + 7 days, 1,000-character descriptions vs 2 + 3 days, 300 | 668,536 programmes for 7,079 channels in 202.8 s (≤ 4 min), all inside its 88 MB quota |
  | The duty cycle (`LOW_TIER_DUTY`, 50 ms of work then 50 ms of sleep, in both refreshes) | off vs on | 200,000 items ingested in 69.7 s (≤ 90 s); keys during the refresh at median 62 ms, slowest 129 ms (≤ 200 ms). The duty cycle would about double the ingest: a fail |
  | Posters (`POSTER_TIERS`) | rest 150 ms, 6 at once vs 300 ms, 2 | no number; Omar's checks by eye (2026-11-26) found nothing |
  | Motion (`[data-tier='low']` in tokens.css) | on vs off | no number; nothing seen |
  | Telemetry and diagnostics (`app_start.tier`, `probes.lowTier`) | records only | — |
  | The lab (the battery's TS first-frame limit; S6's `lowTier`) | 2.5 s vs 4 s | the lab only |

  The two S6 fails on that TV, the first search (305 ms) and the cold start at scale (4.2 s), are not tier-gated: no `low` limit touches them.
- **The memory signal ADR-012 proposed** (`navigator.deviceMemory`, Chromium 63+): S0 recorded it on both TVs. The LG reports **2**; the 2020 Samsung reports **1** (sessions `wpev`, `cvj5`, `scyp`).
- **Tizen user agents name no `Chrome/`.** The TV's own is `Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) 69.0.3497.106/5.5 TV Safari/537.36`. The adapter takes the engine from its version table (`TIZEN_RELEASES`, up to Tizen 9.0). On a Tizen the table doesn't know (10.0, the 2026 sets), both the year and the engine are unknown, and `deviceTier` answered `low`.

## Decision
**Samsung: Tizen 5.5 (2020) and newer.**
- `platforms/tizen/config.xml` declares `required_version="5.5"`. `checkConfigXml` refuses any other value or a missing one, so `pnpm build:tv` and `pnpm release:check` both fail on it (`TIZEN_REQUIRED_VERSION`).
- The Samsung listing and the beta kit say 2020 or newer, in English and Arabic (`docs/store/samsung-submission.md`, `docs/store/beta.md`).
- No 2018 Samsung is bought and no Remote Test Lab route is set up. Step 16 closes with results.md's "Still to run" marked row by row.

**The `low` tier stays, and no supported TV is in it.**
- **No memory signal.** The weakest TV we support reports `deviceMemory` 1 and passed every tier-gated check in `full`. A rule that puts 1 GB in `low` would take that same TV off the guide's 7 days and catch-up's 7, and double its ingest, which would then fail S6's 90 s. A signal that fits no measured TV is a guess.
- **Year and engine unknown → `full`.** Both platforms start at 2020, so a set the version tables don't know is newer than them. This fixes the 2026 Samsung's `low`.
- **A known year before 2020, or an engine before Chromium 68, stays `low`.** Only a set below the minimum reaches it: a developer install on a 2018–2019 TV, or the harness's Chromium 53 and 56 until step 61b drops them.
- **The seam is kept:** the type, the limits, `?tier=low` in the browser, and the telemetry field. Step 41 measures the phase 2 build on the 2020 Samsung and the LG. A lighter tier comes back only if a measured TV fails a tier-gated check, and then on that measurement.

## Consequences
- Owners of 2018–2019 Samsung sets (Tizen 4.0 and 5.0) can't install Lablo from Samsung's store. Their TVs' engines (Chromium 56 and 63) no longer bind the build: step 61 retargets it to Chromium 68 (LG 2020; the 2020 Samsung runs 69).
- **The weakest supported Samsung is a 32" HD 2020 set with an 88 MB storage quota.** The storage plan and every write path stay sized for it (results.md: the 200 MB write stopped at 84 MB; `unlimitedstorage` doesn't lift it).
- **Telemetry's `tier` will read `full` from every store install.** A `low` there means a developer install or a test. The field stays in the protocol, so the server's schema doesn't change.
- **Not owned:** a low-end 2020 LG (webOS 5, about 1.5 GB) and any 2021+ Samsung. The Beta Test (2021+ Samsung) and the closed beta's testers (step 46) cover newer sets.
- **Docs left as history:** progress rows, `docs/relay-archive.md`, and code comments that estimate "a 2018 TV" for timings (scrypt, the bench's factor). The build's Chromium 53 target, the harness's 53 and 56, CLAUDE.md's cheat sheet and `docs/runbooks/old-engines.md` change in step 61.
