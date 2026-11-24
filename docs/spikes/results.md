# Spike results

What the Lablo Lab ([runbooks/lab.md](../runbooks/lab.md)) found on each device, spike by spike. The spikes and their pass criteria are in [architecture.md §5](../architecture.md); the decisions they led to are ADRs ([ADR-012](../adr/ADR-012-lg-minimum-webos5.md) so far).

- **Started:** 2026-11-04 (relay step 16a). Step 16 adds the Samsung TVs and the checks that need a person at the TV.
- **The first Samsung TV:** 2026-11-23 and 24, a session beside the relay. It ran the lab and also the app itself (steps 19b and 21, "The app on the Samsung TV" below).
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
| **Samsung UA32T5300AUXEG** (2020 T5300, 32" HD; Tizen 5.5, firmware T-KTS2UABC-2743.0; armv7) | Chromium 69 | a TV in Developer Mode on the LAN (tv-setup.md 3), driven from the PC (below) | `235813-wpev` (0.1.0, closed part-way during the set-up); `001024-cvj5` (0.1.0, run at launch, then S4 alone); `004301-scyp` (0.1.0, run at launch, then S4 alone with the soak, then S6 alone at scale). All `tizen-UA32T5300AUXEG-2026112*` | the runs at launch: 34/7/18/9; 35/6/18/9 |
| **The other Samsung TVs** | Chromium 56 (2018) to 130 | the Remote Test Lab (2019–2026) and a used 2018 set | not run yet (step 16) | — |

The Simulators' runs predate 16a: their S0 year and S1 CSS rows came from the old code (see "Fixed by these runs").

## Spike by spike

| Spike | LG TV (2021, webOS 6) | Simulator 6.0 | Simulator 24 | Desktop / harness |
|---|---|---|---|---|
| **S0** device | 2021, tier `full` from the engine (Chromium 79 → webOS 6); `deviceInfo` has no `sdkVersion` | year unknown (old code: firmware-like `02.00.94`) | year unknown (`02.11.66`) | harness: 53/56/68 by the UA |
| **S1** runtime | **pass** (9 checks, plus the API list); all built-ins native; Blob worker 83–428 ms; 600 KB streamed in 0.5 s; 10,000-item bulk write 4.2–4.8 s | pass | pass | harness: pass; the bundle filled 8 built-ins on 53, 6 on 56, 4 on 68 |
| **S2** storage | **pass**: 433 MB quota; 200 MB written in 29–36 s; localStorage and IndexedDB **survived an update** (0.1.0 → 0.1.1) and a same-version reinstall; an uninstall wipes both | quota ~960 GB (the host's disk); 200 MB in 1.6 s | the same | harness: as expected |
| **S3** device ID | **pass**: LGUDID available, the **same after an update and after an uninstall and reinstall** (hash `2fnvkl9rejj` in all four runs) | available, new per container | the same | desktop: no ID (expected) |
| **S4** AVPlay | skip (webOS) | skip | skip | Samsung: below |
| **S5** `<video>` | **pass 6, fail 1**: TS 1.1–1.8 s, HLS 1.6–2.5 s, 3 × 302 1.1–4.1 s, 4K HEVC 1.6–1.7 s; 5/5 audio tracks listed, switch 154–205 ms (`audioTracks`); AC3 and E-AC3 play; **in-band subtitles: no text track** (MKV SRT, MP4 mov_text) | fail: Electron's media, not webOS's (no TS, HLS, HEVC picture or `audioTracks`) | the same | desktop: HLS 150–210 ms, 302s, switch 265–370 ms, stalls recovered in ~6.1 s; no TS, AC3, in-band text or (headless) HEVC picture |
| **S6** scale | info (the small catalog): cold start 453–681 ms, presses median 12–15 ms (slowest 45–158 ms), 6 searches ≤ 22 ms, 25 items in 394 ms, a 1,369-programme guide in 0.9 s. **Not at scale yet** | info: cold start ~105 ms | info: ~114 ms | desktop at scale (`pnpm lab:scale`): every criterion passes widely (200k in 1.9 s, the 150 MB guide in 5.2 s) |
| **S7** network | **pass** 6/6: no-CORS XHR and fetch read, 302s followed with `responseURL` | pass 6/6 | pass 6/6 | desktop: no-CORS fails (a browser, expected) |
| **S8** avplaystore | skip (webOS) | skip | skip | Samsung: below |
| **S9** Arabic | **pass** 3/3: the four faces load, joining and lam-alef, the isolates hold; `Intl`: ar-SA Hijri with Arabic-Indic digits, ar-AE Arabic-Indic (the app uses Western, ADR-011) | pass 3/3 | pass 3/3 (ar-AE `Intl` gives Western digits here) | harness: pass on 53/56/68 |
| **S10** input | info: webOS delivers every key. Keys, pointer, keyboard: **not run (needs a person)** | the same | the same | harness: registration only |
| **S11** lifecycle, a11y | screensaver: no API (`unsupported`); Audio Guidance off; **`speak` fails: "Audio Guidance is off (8101)"** (the TTS service exists). Reading by ear: **not run** | `speak` fails: no TTS service | the same | — |

### Samsung UA32T5300AUXEG (2020 HD, Tizen 5.5, Chromium 69)

| Spike | Result |
|---|---|
| **S0** device | 2020, tier `full` (Tizen 5.5, Chromium 69); the TV's language en-GB |
| **S1** runtime | **pass**. The bundle filled `Object.fromEntries`, `globalThis`, `queueMicrotask`; missing and not filled: `DecompressionStream` (page and worker), `structuredClone`, `Intl.RelativeTimeFormat`. Blob worker 337–556 ms; 660 KB streamed in 0.43 s (page), 0.35 s (worker); the 10,000-item bulk write 3.2–3.5 s |
| **S2** storage | **fail: an 88 MB quota** (`storage.estimate`). The 200 MB write stopped at 84 MB with `QuotaExceededError` (17.6–20.4 s). localStorage and IndexedDB kept their markers from launch to launch (no update tested yet) |
| **S3** device ID | **pass**: the DUID answers, the same in every run |
| **S4** AVPlay | **pass 7, fail 2**, then the soak. TS 0.8–1.9 s, HLS 1.4–1.7 s, 3 × 302 0.7–0.8 s (the redirect probe 0.1–0.2 s first); 5/5 audio tracks listed, `setSelectTrack` 264–322 ms; AC3 and E-AC3 play. Subtitles: MKV SRT gives a cue in 3.8 s, **MP4 mov_text no cue**. **4K HEVC: no picture** (`UNKNOWN_ERROR_EVENT_FROM_PLAYER`; an HD model). `suspend` skipped: Home sent from the TV's network remote API never hid the app (needs the real remote). **Soak (60 min): fail**, see below |
| **S5** `<video>` | HLS 1.75 s, 3 × 302 (HLS) 1.55 s; 5/5 audio tracks, `audioTracks` switch 186 ms, AC3 and E-AC3 201–223 ms. **No TS** (no picture in 10 s), **no 4K HEVC** (`MEDIA_ERR_DECODE`), no in-band text tracks. So `<video>` is a working HLS fallback here, and TS needs AVPlay |
| **S6** scale | **At scale** (`scyp`, the 200k catalog and the 150 MB guide): ingest 200,000 items in 69.7 s (pass, ≤ 90 s); **search median 95 ms, slowest 305 ms** (fail: the first query, `lablo`; the other five ≤ 186 ms); keys during a refresh median 62 ms, slowest 129 ms (pass); the guide: 668,536 programmes for 7,079 of 20,000 channels in 202.8 s (pass, ≤ 4 min); **cold start 4.2 s** (fail, ≤ 3 s: boot 1.1 s, data to painted rows 3.2 s). Everything fit in the 88 MB quota. The small catalog: cold start 1.8–2.2 s |
| **S7** network | **pass** 6/6 |
| **S8** avplaystore | `getPlayer()` gave two players; **prebuffer passed once and failed once** (both prepared in 679 and 1,148 ms; then one not within 10 s); switch 212–242 ms (pass, ≤ 700 ms) |
| **S9** Arabic | **pass** 3/3. `Intl`: ar-SA Hijri (Umm al-Qura) with Arabic-Indic digits, ar-AE Gregorian with Arabic-Indic digits, `ar` Western digits |
| **S10** input | `registration` **pass** (27 keys). The key tester, pointer and keyboard test: not run by hand. The app's own fields did open the TV's keyboard with the right layout (URL, text, password; below) |
| **S11** lifecycle, a11y | screensaver held off while the lab is open (pass); Voice Guide off; Tizen has no speech API for web apps (`info`). Lifecycle and reading by ear: not run |

**The S4 soak.** The lab's stalling stream (`stall-ts`, 600 KB per response) never started on AVPlay: no answer within 10 s. AVPlay needs more than 600 KB before it plays, and today's generated live TS runs about 230 KB/s, not the 200 KB per 6 s segment that `LAB_STALL_TS_BYTES`'s comment assumes. Rerun with 4 MB per response (a local change, not committed): 20 stalls in 60 min, all recovered, median 7.3 s, **2 over 10 s** (11.4 s, and 26.5 s after 4 reopens), 23 reopens.

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
- **From the Samsung TV (2026-11-24), for the relay to act on** (nothing here is fixed yet):
  - **Storage: 88 MB on a 2020 budget Samsung.** The full scale run (200k items and the 150 MB guide's 668k programmes) fit, but S2's 200 MB write did not. The app's storage plan must stay under that, and every write path must survive `QuotaExceededError`. The 2018 floor may have less.
  - **4K HEVC is not a 2020+ given.** This 2020 HD model refuses it on AVPlay and `<video>`. Choose 4K by what the TV can decode (the panel and the decoder), not by model year. S4's and S5's `hevc-4k` notes ("only 2020+ TVs need it") need the same fix.
  - **MP4 mov_text subtitles give no cue on AVPlay** (MKV SRT does). With the LG's missing text tracks, step 20's own subtitle parser is needed for MP4 on both platforms.
  - **S8 prebuffering is intermittent** (1 of 2 runs failed). A prebuffered zap must fall back to a plain open without a visible delay.
  - **The lab's stall row is miscalibrated for AVPlay:** `LAB_STALL_TS_BYTES` (600 KB) is below what AVPlay needs to start. Raise it (4 MB worked) or derive it from the media's bitrate, and fix its comment. The mock's `stalling-streams` scenario (64 KiB) has the same problem on AVPlay. **Done in step 39s3:** the row stalls after 18 s of the channel's media (104's loop runs 118 KB/s: 2.1 MB), `stalling-streams` 12 s into each response (architecture.md §2 "Built in step 39s3").
  - **AVPlay hides most held-socket stalls by itself** (the app section below). An injected stall that is meant to reach the app's watchdog must stop the data across AVPlay's own reconnects (an outage of several seconds), not one held response. **Done in step 39s3:** the mock's `stall:outage_ms`, and the `live-outages` scenario for step 21's soak; the 6.9 s stall was AVPlay's buffering, which waits 12 s by design (architecture.md §2 "Built in step 39s3").
  - **Launch to the last channel takes 8–9.5 s, against ≤ 4 s** (the app section below): the bundle's load, the start before the stream opens, and AVPlay's first frame under load all need to shrink.
  - **`pnpm device install tizen` fails on `dist/packages/Lablo Lab.wgt`** ("Failed to install Tizen application", no reason): the space in the file name. The app's `Lablo.wgt` installs. The workaround was to copy it to `LabloLab.wgt`, `sdb push` it to `/home/owner/share/tmp/sdk_tools/tmp/`, then `sdb shell 0 vd_appinstall LabloLab01 <path>`. Fix the lab's package name or quote it in tools/device.
  - **One app at a time:** launching the app closed the lab and the other way round (the lab recorded `hidden`, then a new session). A Home press sent from the TV's network remote API did not hide either app, so S4's `suspend` and S11's lifecycle need the real remote.
  - **The old name "Zoma"** showed on screen while the lab opened, Omar reports. It is not in the code, the built packages or the lab's records; look for it on the next run Omar watches.

## The app on the Samsung TV (RELAY 19b and 21)

The store build of `main` at `8932057` (`Lablo.wgt`, main.js 454.6 KB), against the mock on the PC, on the same TV, 2026-11-24.

- **Driven from the PC, with nobody at the TV:**
  - keys through the TV's remote-control API (`wss://<tv>:8002`; Node's built-in `WebSocket` gets no answer, a TLS socket with an `Origin` header does);
  - text through the same API's `SendInputString` while the TV's keyboard is open;
  - the app's state through the remote inspector (`sdb shell 0 debug`, then `sdb forward`): `Runtime.evaluate` reads `window.__LABLO_TEST__.focusPath()`, `webapis.avplay` and the User Timing marks. `Page.captureScreenshot` never answers on Tizen 5.5, so there are no screenshots.
  - The scripts stayed local (`artifacts/`, gitignored). They could become a `tools/` step.
- **Onboarding: pass.**
  - English, the disclaimer, "Not now" for the device ID, then the Xtream form.
  - Each field opened the TV's keyboard in its own layout (`url`, `input`, `password`) and took the typed text.
  - The source loaded in about 2 s: 12 channels, 6 films, 2 series, the adult group locked. "Later" for the PIN, then the live screen with now/next.
- **19b, the AvplayEngine: pass.** Live TS on channel 1 played: `PLAYING`, with the position moving at real time. The overlay showed "Connecting…", then hid itself.
- **Zapping: pass.**
  - CH+ and CH− 8 s apart, five times: from the key to a moving picture in 1.63–1.85 s.
  - The digit 4: the number was taken about 1.7 s after the key, then it played.
  - **50 rapid zaps** (CH+ and CH− alternating, 1.2 s apart): no hang. The page got all 50 keys, landed on the right channel, and played 3.6 s after the last key; it had to finish the previous half-open channel first.
- **Stalls: AVPlay recovers most of them itself.**
  - The mock held each response to channel 104 after 4 MB. AVPlay sent a new request to the same URL (`Range: bytes=0-`, user agent `samsung-agent/1.1`) about 7 s after the data stopped, every 39 s or so.
  - Once its buffer had built up, nothing showed: over 100 s, 3 reconnects, and the position moved exactly 100 s. Only the first two stalls after tuning showed (7.2 s and 3.8 s, with "Connecting…").
  - Restarting the mock under the playing app showed nothing either.
- **The ladder and HLS:**
  - During a network outage (the TV's link dropped packets for a while), the ladder moved channel 104 to its `.m3u8`. From then on the app used HLS for that source: the 50 zaps (channels 104 and 112), and the next launch.
  - With that `.m3u8` answering 404, the app went back to TS after about 15 s. AVPlay asked for the playlist 28 times first.
  - On AVPlay, HLS starts slower than TS (S4: HLS 1.4–1.7 s; TS 0.8–1.2 s in three runs of four, 1.9 s in the first). Check that keeping HLS after one outage is what the ladder means to do.
- **Launch to the last channel: fail**, against ≤ 4 s.
  - The TV's launcher (`was_execute`): about 0.8 s to launch, the first stream request 6.5 s after the command.
  - With the inspector (`debug`, two launches), measured from the page's navigation start:
    - the page's start: 2.6 s after the command;
    - `DOMContentLoaded`: 2.4 s;
    - `lablo:resume`: 4.8–5.4 s;
    - `lablo:live-ready`: 43–55 ms after that;
    - `lablo:resume-frame`: 9.1–9.6 s.
  - Without the inspector, the launch to the first frame comes to about 8–9.5 s (the first request 6.5 s, then HLS's first frame).
  - The stream opens only 43–55 ms before the live screen is ready, so the start doesn't get ahead of the catalog by much. The first frame then takes 4.3 s, against 1.4–1.7 s for HLS in the lab.
- **The soak (2 h, channel 104: HLS answering 404, TS held after every 4 MB): pass**, but it didn't test the watchdog.
  - At the tune, AVPlay asked for the 404 playlist 27 times in 14.5 s, then the app fell back to TS (the 15 s above).
  - TS: 186 connections in 2 h, one every 38.6–39.9 s (mean 39.1 s), each AVPlay's own reconnect (`Range: bytes=0-`). None came off that rhythm, so the app never reopened the stream.
  - One visible stall: 6.9 s, 12 s after the monitor started (the first reconnect, before AVPlay's buffer had built up). That is just over the ladder's 6 s, yet the app didn't act; why is unchecked (AVPlay may have reported buffering, which waits 12 s). None over 10 s. The other 184 reconnects were invisible: the position moved 7,186 s in 7,206 s.
  - The JS heap stayed at 10 MB in all 25 five-minute samples. At the end: `PLAYING`, focus still on the player.

## Still to run (step 16)

| What | Where | Needs | Plan |
|---|---|---|---|
| S10 keys, Magic Remote pointer, the TV keyboard (en and ar) | LG TV | Omar at the TV, ~10 min | start S10 from its row (lab.md "S10") |
| S11 reading by ear (focus and `aria-live`), lifecycle (Home and back) | LG TV | Omar, Audio Guidance on | start S11 from its row (lab.md "S11") |
| S5 suspend (Home while playing) and the 60-minute soak | LG TV | Omar to start it; the soak runs alone | start S5 from its row |
| S6 at scale (200k items, the 150 MB guide) | LG TV, then the 2018 Samsung (the 2020 Samsung: done, search and cold start failed) | nobody at the TV: the mock with the scale fixtures, then S6 from its row | next TV session |
| S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear | the 2020 Samsung | Omar with the TV's own remote (the network remote's Home didn't hide the app), ~15 min | start each spike from its row |
| Step 21's soak with stalls that reach the app's watchdog | any TV | a stall scenario that outlasts AVPlay's own reconnects ("From the Samsung TV" above) | step 21 |
| S2 across a **store** update | LG and Samsung | the first store release | release checklist (step 45) |
| Everything on Samsung: S0–S11 with S4 and S8 on AVPlay | Remote Test Lab (2019–2026) and the used 2018 set (the 2020 HD Samsung: done, above) | Omar: the tunnel for the RTL TVs, the 2018 set itself (the Samsung account and the certificate exist now) | tv-setup.md 3.2–3.6 |
| A low-end 2020 LG (webOS 5, ~1.5 GB) | none owned | a decision if step 41 finds the tier rule wrong | ADR-012 "Consequences" |
