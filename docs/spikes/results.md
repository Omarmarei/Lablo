# Spike results

What the Zoma Lab ([runbooks/lab.md](../runbooks/lab.md)) found on each device, spike by spike. The spikes and their pass criteria are in [architecture.md §5](../architecture.md); the decisions they led to are ADRs ([ADR-012](../adr/ADR-012-lg-minimum-webos5.md) so far).

- **Started:** 2026-11-04 (relay step 16a). Step 16 adds the Samsung TVs and the checks that need a person at the TV.
- **The records** are the lab's NDJSON logs in `artifacts/lab-logs/<session>.ndjson` (gitignored, on the PC that ran the lab server). The session ids are below, so a later reader with the logs can check a number.
- **`info`** means a measurement the criteria don't judge on that run (S6 judges only at scale; S0, S2's first run and S9's `Intl` only record). **`skip`** means the check doesn't apply (AVPlay on webOS) or needs a person (it runs only when the spike is started from its row).

## The devices and runs

| Device | Engine | Where | Sessions (lab version) | pass / fail / info / skip |
|---|---|---|---|---|
| **LG OLED55A1PVA** (2021 A1 OLED; webOS 6, `sdkVersion` 6.5.3, firmware 03.53.45; 2 GB, 4 cores; 1920×1080 at DPR 2) | Chromium 79 | Omar's TV in Developer Mode, on the LAN (tv-setup.md 2.2) | `113731-h2rj` (0.1.0, leg 34); `120022-ir9s` (0.1.0 with 16a's fixes, installed over it); `120259-e4k0` (0.1.1, an update over 0.1.0); `120430-421k` (0.1.1 after an uninstall). All `webos-OLED55A1PVA-20261104-*`, all run at launch | 26/2/19/21; 27/2/18/21; 29/2/16/21; 26/2/19/21 |
| **webOS TV Simulator 6.0** | Chromium 79 | the Linux build in Docker (tv-setup.md 2.4) | `webos-WEBOS6.0_SIMULATOR-20261104-085408-1bm9`, `-085651-bh2l` (0.1.0) | 20/7/19/22 each |
| **webOS TV Simulator 24** | Chromium 108 | the same | `webos-WEBOS24_SIMULATOR-20261104-085511-qtsi` (0.1.0) | 20/7/19/22 |
| **Desktop Chromium 156** (Playwright) | Chromium 156 | `pnpm lab:media` (S5 only, a 1-minute soak) | `browser-Desktop-browser-20261104-073916-6sbc`, `-074123-jxnu` | S5: 5/4/1/0 each |
| **Old-engine harness** | Chromium 53, 56, 68 | `pnpm verify:engines` (Docker; both bundles; no media) | CI job `engines` on every PR | every check as expected (architecture.md §5, steps 15a–15c2) |
| **Samsung TVs** | Chromium 56 (2018) to 130 | the Remote Test Lab (2019–2026) and a used 2018 set | not run yet (step 16) | — |

The Simulators' runs predate 16a: their S0 year and S1 CSS rows came from the old code (see "Fixed by these runs").

## Spike by spike

| Spike | LG TV (2021, webOS 6) | Simulator 6.0 | Simulator 24 | Desktop / harness |
|---|---|---|---|---|
| **S0** device | 2021, tier `full` from the engine (Chromium 79 → webOS 6); `deviceInfo` has no `sdkVersion` | year unknown (old code: firmware-like `02.00.94`) | year unknown (`02.11.66`) | harness: 53/56/68 by the UA |
| **S1** runtime | **pass** (9 checks, plus the API list); all built-ins native; Blob worker 83–428 ms; 600 KB streamed in 0.5 s; 10,000-item bulk write 4.2–4.8 s | pass | pass | harness: pass; the bundle filled 8 built-ins on 53, 6 on 56, 4 on 68 |
| **S2** storage | **pass**: 433 MB quota; 200 MB written in 29–36 s; localStorage and IndexedDB **survived an update** (0.1.0 → 0.1.1) and a same-version reinstall; an uninstall wipes both | quota ~960 GB (the host's disk); 200 MB in 1.6 s | the same | harness: as expected |
| **S3** device ID | **pass**: LGUDID available, the **same after an update and after an uninstall and reinstall** (hash `2fnvkl9rejj` in all four runs) | available, new per container | the same | desktop: no ID (expected) |
| **S4** AVPlay | skip (webOS) | skip | skip | — (Samsung) |
| **S5** `<video>` | **pass 6, fail 1**: TS 1.1–1.8 s, HLS 1.6–2.5 s, 3 × 302 1.1–4.1 s, 4K HEVC 1.6–1.7 s; 5/5 audio tracks listed, switch 154–205 ms (`audioTracks`); AC3 and E-AC3 play; **in-band subtitles: no text track** (MKV SRT, MP4 mov_text) | fail: Electron's media, not webOS's (no TS, HLS, HEVC picture or `audioTracks`) | the same | desktop: HLS 150–210 ms, 302s, switch 265–370 ms, stalls recovered in ~6.1 s; no TS, AC3, in-band text or (headless) HEVC picture |
| **S6** scale | info (the small catalog): cold start 453–681 ms, presses median 12–15 ms (slowest 45–158 ms), 6 searches ≤ 22 ms, 25 items in 394 ms, a 1,369-programme guide in 0.9 s. **Not at scale yet** | info: cold start ~105 ms | info: ~114 ms | desktop at scale (`pnpm lab:scale`): every criterion passes widely (200k in 1.9 s, the 150 MB guide in 5.2 s) |
| **S7** network | **pass** 6/6: no-CORS XHR and fetch read, 302s followed with `responseURL` | pass 6/6 | pass 6/6 | desktop: no-CORS fails (a browser, expected) |
| **S8** avplaystore | skip (webOS) | skip | skip | — (Samsung) |
| **S9** Arabic | **pass** 3/3: the four faces load, joining and lam-alef, the isolates hold; `Intl`: ar-SA Hijri with Arabic-Indic digits, ar-AE Arabic-Indic (the app uses Western, ADR-011) | pass 3/3 | pass 3/3 (ar-AE `Intl` gives Western digits here) | harness: pass on 53/56/68 |
| **S10** input | info: webOS delivers every key. Keys, pointer, keyboard: **not run (needs a person)** | the same | the same | harness: registration only |
| **S11** lifecycle, a11y | screensaver: no API (`unsupported`); Audio Guidance off; **`speak` fails: "Audio Guidance is off (8101)"** (the TTS service exists). Reading by ear: **not run** | `speak` fails: no TTS service | the same | — |

## What the runs decided or changed

- **The LG minimum is webOS 5 (2020)** ([ADR-012](../adr/ADR-012-lg-minimum-webos5.md), Omar, leg 34). Every supported LG TV is in the `full` tier; S6's low-tier run moves to the used 2018 Samsung.
- **Fixed by these runs (step 16a):**
  - **The webOS model year** came from `platformVersion`, which is the firmware (`03.53.45` read as 2017, tier `low`). It now comes from `sdkVersion`, else from the engine. The TV's `PalmSystem.deviceInfo` keys are `modelName panelType platformVersion platformVersionDot platformVersionMajor platformVersionMinor screenHeight screenWidth`: no `sdkVersion`, so the engine decides (S0 records `details.versionFrom`).
  - **S1's CSS row** asked for `typeof CSS === 'object'` and reported Grid, flex `gap`, sticky, logical properties and custom properties all missing on Chromium 79. It now checks `CSS.supports` alone: all five present on the TV. Our CSS rules (no Grid, no `gap`, physical properties) stay, for Samsung 2018's Chromium 56.
  - **`requiredACG`** is in both manifests (the app `[]`, the lab `deviceinfo.query`, `settings.query`); the lab installed and ran with it on webOS 6 exactly as before.
- **S2 answers the plan's worry for dev installs:** localStorage and IndexedDB both survived an update on webOS 6. The plan still keeps nothing important in localStorage, and a store update may differ: check again after the first real store update (architecture.md §5, S2).
- **S5 on webOS 6:** the native `<video>` plays everything we generate, including MPEG-TS, 4K HEVC and AC3/E-AC3, and `audioTracks` switches in about 0.2 s with no restart. So the luna `selectTrack` route stays a fallback, and the MSE engine is not needed for this TV. The three-302 chain took 3.7–4.1 s in two of the four runs (1.1–1.5 s in the others): step 18's first-frame timeout must allow for it.
- **In-band subtitles show no text track on the LG TV** (and nowhere else either). Step 20's subtitle overlay needs our own parser for text in MKV and MP4, or sidecar files only.
- **TTS needs Audio Guidance on.** The `speak` route is not in LG's ACG table either (ADR-012), so it stays a fallback; S11's reading-by-ear checks decide whether labelled focus is enough.

## Still to run (step 16)

| What | Where | Needs | Plan |
|---|---|---|---|
| S10 keys, Magic Remote pointer, the TV keyboard (en and ar) | LG TV | Omar at the TV, ~10 min | start S10 from its row (lab.md "S10") |
| S11 reading by ear (focus and `aria-live`), lifecycle (Home and back) | LG TV | Omar, Audio Guidance on | start S11 from its row (lab.md "S11") |
| S5 suspend (Home while playing) and the 60-minute soak | LG TV | Omar to start it; the soak runs alone | start S5 from its row |
| S6 at scale (200k items, the 150 MB guide) | LG TV, then the 2018 Samsung | nobody at the TV: `pnpm lab:scale` and a launch | next TV session |
| S2 across a **store** update | LG and Samsung | the first store release | release checklist (step 45) |
| Everything on Samsung: S0–S11 with S4 and S8 on AVPlay | Remote Test Lab (2019–2026) and the used 2018 set | Omar: the Samsung account, the certificate, the tunnel for the RTL TVs, the set itself | tv-setup.md 3.2–3.6 |
| A low-end 2020 LG (webOS 5, ~1.5 GB) | none owned | a decision if step 41 finds the tier rule wrong | ADR-012 "Consequences" |
