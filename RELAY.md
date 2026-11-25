# RELAY: Lablo IPTV v1 to store submission

**Objective:** build Lablo IPTV v1 for Samsung Tizen and LG webOS as approved in [docs/PLAN.md](docs/PLAN.md), up to the first store submissions (LG in the US and GCC, Samsung in the US).
**Source:** the planning conversation of 2026-11-01 (leg 0). Plan: [docs/PLAN.md](docs/PLAN.md) (it wins on conflicts). Detailed design: [docs/architecture.md](docs/architecture.md). Research: [docs/research/](docs/research/). Session breakdown follows architecture.md section 6, plus the v1 additions in PLAN.md section 4.

This file replaces the `ROADMAP.md` that PLAN.md mentions: these steps are the per-session checklist.

## Definition of done (global DoD applied to Lablo)
1. **Tests and build:** `pnpm verify` is green (lint incl. boundaries, typecheck, tests, both TV builds, ES2016 syntax gate, bundle budgets; each part counts once it exists).
2. **PR and CI:** a PR to `main` on private repo `Omarmarei/Lablo` with green CI, merged with a merge commit (not squash, so the long-lived `relay/<run>` branch stays mergeable).
   - **Standing approval from Omar (2026-11-01):** the relay merges its own PRs (about one per phase) once CI is green, and lists the 3 riskiest changes in that leg's handover. Production deploys and migrations still need his word. Step 1 copies this rule into CLAUDE.md.
3. **Migrations:** N/A until step 29. After that, Neon production migrations are applied and the schema is checked with a query. Each one is `[needs Omar]`.
4. **Deploy:**
   - **Backend (Vercel):** each production deploy is `[needs Omar]`; verify the live endpoint afterwards.
   - **TV app:** the "deploy" is a store submission (`[needs Omar]`). Before that, check the change installed on a real TV once the test TVs exist.
5. **Handover** last.

UI steps also end with a short "press these keys" checklist that Omar can run in the desktop browser (`pnpm dev`) or on a TV.

## Steps

*(Slimmed in leg 159, 2026-11-25: the detail of finished steps and the older progress rows moved verbatim to [docs/relay-archive.md](docs/relay-archive.md), keyed by step id.)*

### Phase 0: Foundations
- [x] 0. Research, plan, architecture docs (leg 0). Commit `4581e54`. Commits: `4581e54`. Detail: docs/relay-archive.md, "Step 0".
- [x] 1. **Workspace scaffold (architecture.md 0.1).** PR #1. Commits: `2415c0e`. Detail: docs/relay-archive.md, "Step 1".
- [x] 2. **TV build pipeline and hello app (0.2).** Commits: `18d2b3a`. Detail: docs/relay-archive.md, "Step 2".
- [x] 2b. **Old-engine test harness (the main substitute for missing TVs).** Commits: `e632376`. Detail: docs/relay-archive.md, "Step 2b".

### Phase 2: Mock provider and fixtures (hardware-independent, done before the lab work)
- [x] 3. **`apps/mock-provider` (2.1).** Commits: `8977442`. Detail: docs/relay-archive.md, "Step 3".
- [x] 4. **Legal media set and scale fixtures (2.2).** Detail: docs/relay-archive.md, "Step 4".

### Phase 3: Data engine
- [x] 5. **core, part 1 (3.1).** Detail: docs/relay-archive.md, "Step 5".
- [x] 6. **core, part 2 (3.2).** Detail: docs/relay-archive.md, "Step 6".
- [x] 7. **data, part 1 (3.3).** Detail: docs/relay-archive.md, "Step 7".
- [x] 8. **data, part 2 (3.4).** Detail: docs/relay-archive.md, "Step 8".
- [x] 8b. **App wiring and the data workers on real old engines (rest of 3.4).** Detail: docs/relay-archive.md, "Step 8b".
- [x] 9. **EPG (3.5), core part.** Detail: docs/relay-archive.md, "Step 9".
- [x] 9b. **EPG (rest of 3.5): storage, refresh and the app.** Detail: docs/relay-archive.md, "Step 9b".
- [x] 9c. **Short-EPG fallback (rest of 3.5).** Detail: docs/relay-archive.md, "Step 9c".

**Main bundle budget (decide before step 11).** The TV build inlines every worker into `main.js`, and the 500 KB main budget counts them. With the EPG worker and the short EPG, main was 459.1 KB (step 9c); with the focus engine it is 470.3 KB (step 10), so the rest of the UI (design system, i18n, screens) has only about 30 KB. Options for Omar when that runs out:
1. count inlined workers against their own 150 KB budgets only, and keep the 500 KB for the main thread's own code (recommended: a worker string is not parsed as code until the worker starts);
2. ship the workers as separate files in the package (needs spike S1 to show `file://` workers on the TVs);
3. raise the main budget.

**Decided by Omar on 2026-11-03 (in leg 15's tab): option 1.**
- Each inlined worker counts only against its own 150 KB budget.
- The 500 KB main budget covers the main thread's own code: about 103 KB today, that is main.js minus the four worker strings.
- He also authorised the matching edit to the CLAUDE.md `build:tv` row.
- Applied in leg 16 (`tools/build`, the first commit of the step-11 PR): workers go into main.js as placeholders and their code replaces them after terser, so the build knows the inlined bytes exactly.
  - The build prints `main.js (tizen): 102.2 KB own code of 500.0 KB (20%), plus 368.1 KB of inlined workers` (webos 100.8 KB); the files stay 470.3 and 468.9 KB.
  - The workers' own 150 KB checks are unchanged. ADR-003, CLAUDE.md's `build:tv` row and runbook tv-build.md say so.

### Phase 4: UI shell
- [x] 10. **Focus engine (4.1).** Detail: docs/relay-archive.md, "Step 10".
- [x] 11. **Design system (4.2).** Detail: docs/relay-archive.md, "Step 11".
- [x] 11a. **Design system foundations: the main budget, the CSS pipeline, tokens and fonts.** Detail: docs/relay-archive.md, "Step 11a".
- [x] 11b. **Design system: components, virtual list, pseudo-locale, screenshots (rest of 4.2).** Detail: docs/relay-archive.md, "Step 11b".
- [x] 11c. **The gallery on the old engines (rest of 4.2).** Detail: docs/relay-archive.md, "Step 11c".
- [x] 12. **i18n (4.3).** Detail: docs/relay-archive.md, "Step 12".
- [x] 12a. **i18n runtime, catalogs and formats.** Detail: docs/relay-archive.md, "Step 12a".
- [x] 12b. **i18n: the lint, the language switch, the old engines (rest of 4.3).** Detail: docs/relay-archive.md, "Step 12b".
- [x] 13. **Onboarding (4.4).** Detail: docs/relay-archive.md, "Step 13".
- [x] 13a. **Onboarding: the flow, the screens and TV text input, on a fake loader.** Detail: docs/relay-archive.md, "Step 13a".
- [x] 13b. **Onboarding: validation and load progress against the mock provider (rest of 4.4).** Detail: docs/relay-archive.md, "Step 13b".
- [x] 13c. **Onboarding on Chromium 53/56/68 (the old-engine harness).** Detail: docs/relay-archive.md, "Step 13c".
- [x] 14. **Live browse screen (4.5).** Detail: docs/relay-archive.md, "Step 14".
- [x] 14a. **The live screen: category rail, virtual channel list, now/next.** Detail: docs/relay-archive.md, "Step 14a".
- [x] 14b. **`RemoteDriver`, the throttled and low-tier runs.** Detail: docs/relay-archive.md, "Step 14b".
- [x] 14c. **The live screen on the old engines.** Detail: docs/relay-archive.md, "Step 14c".

### Hardware lab
Omar has **one LG TV and no Samsung TV** (2026-11-01). Testing relies on several layers:
1. The old-engine harness (step 2b).
2. The Tizen TV Emulator/Simulator and the webOS Emulator/Simulator, for APIs, lifecycle and keys only (no real media).
3. Omar's LG TV, for real webOS media.
4. A Samsung real-device option that Omar chooses at step 16.

- [x] 15. **Lablo Lab build and test strategy without TVs (1.2 + 1.3).** Detail: docs/relay-archive.md, "Step 15".
- [x] 15a. **The Lablo Lab build and the runtime spikes (S0–S3, S7).** Detail: docs/relay-archive.md, "Step 15a".
- [x] 15b. **The scale spike (S6).** Detail: docs/relay-archive.md, "Step 15b".
- [x] 15b2. **The Arabic and lifecycle spikes (S9, S11).** Detail: docs/relay-archive.md, "Step 15b2".
- [x] 15b3. **The input spike (S10).** Detail: docs/relay-archive.md, "Step 15b3".
- [x] 15c. **The `<video>` battery (S5).** Detail: docs/relay-archive.md, "Step 15c".
- [x] 15c2. **The AVPlay batteries (S4, S8) and S5's luna route.** Detail: docs/relay-archive.md, "Step 15c2".
- [x] 15d. **The docs (research).** Detail: docs/relay-archive.md, "Step 15d".
- [x] 15e. **The lab in an emulator.** Detail: docs/relay-archive.md, "Step 15e".
- [ ] 16. **[needs Omar] Run the spikes on the available hardware.**
  - **Omar:**
    - tell the relay the LG TV's model and year (which webOS version)
    - put it in Developer Mode on the LAN
    - pick the Samsung option (`docs/testing-without-tvs.md`; recommended: the free Remote Test Lab TVs for 2019–2026 plus one used 2018 set, and a tunnel or a VPS as the lab server the remote TVs can reach)
    - create the Samsung certificate (runbook)
  - **Claude:** runs the lab on the LG TV, the emulators and the chosen Samsung route. Then it writes `docs/spikes/results.md` and ADRs, and **re-orders or edits the remaining steps here** to match the results.
  - **Decided by Omar (2026-11-04, leg 34):**
    - Samsung: the Remote Test Lab now, plus one used 2018 set (he buys it);
    - the lab server for the RTL TVs: a tunnel from this PC during a session;
    - the LG TV: he follows tv-setup.md 2.2 (step-by-step list given in leg 34), pairs it with `ares-novacom --getkey` in his own terminal, and sends the model and IP.
  - **Gaps:** if the LG TV is 2020 or newer, no 2018 low-end LG exists to test S6, so decide between buying one or raising the LG minimum year.
    - **Decided by Omar (2026-11-04, leg 34): raise the LG minimum to 2020 (webOS 5+, Chromium 68+).** Samsung keeps 2018 (Tizen 4, Chromium 56). Step 16a writes the ADR.
  - **Leg 34: the LG TV is paired and ran the lab.**
    - **The TV:** `OLED55A1PVA` (2021 A1 OLED), webOS 6 (`sdkVersion` 6.5.3), firmware 03.53.45, Chromium 79, 2 GB, 4 cores. Device `tv`, at 192.168.1.8; the key is in `%USERPROFILE%\.ssh\tv_webos`.
    - **Signing in:** Developer Mode needed a second LG account with an email and a password (Google sign-in is refused; tv-setup.md 2.2).
    - **First run** (session `webos-OLED55A1PVA-20261104-113731-h2rj`, run at launch, 75 s): 70 records; 26 pass, 2 fail, 19 info, 21 skip.
      - S1 10/10: the 10,000-item bulk write takes 4.8 s.
      - S2: a 433 MB quota; 200 MB written in 36 s.
      - S3: the LGUDID answers.
      - S7: 6/6.
      - S9: 4/4. `Intl` gives Arabic-Indic digits for ar-SA (Hijri) and ar-AE.
      - **S5 on the TV:**
        - TS 1.8 s, HLS 1.7 s, the 302 chain 1.1 s, 4K HEVC 1.6 s;
        - 5 of 5 audio tracks listed, the switch 154 ms;
        - AC3 and E-AC3 play;
        - **in-band subtitles: no text track** (fail).
      - **S11 `speech` fails:** "Audio Guidance is off (8101)" (the TTS service exists).
      - S6 (the small catalog): cold start 681 ms.
    - **Found: the webOS model year is wrong.** `PalmSystem.deviceInfo.platformVersion` is the firmware (`03.53.45`), so `webosModelYear` read 2017 and the tier `low`. LG's webOSTV.js reference: `version` is the TV's software version, and `sdkVersion` is "the webOS TV SDK version". Fixed in 16a.
    - **Not run yet:** S10 by hand (keys, pointer, keyboard), S11 by ear, S5's suspend and soak (Omar at the TV), S6 at scale (no person needed: the scale fixtures and a launch), and all of Samsung (the RTL with the Samsung account, certificate and tunnel; the used 2018 set).
    - **Done in leg 35 without a person at the TV:** S2 across an update (lab 0.1.0 → 0.1.1 installed over it: localStorage and IndexedDB both kept their markers) and S3 across an uninstall and reinstall (the same LGUDID hash). See `docs/spikes/results.md`.
  - **Order (Omar, leg 34):** 16a next, then step 17 onward while the rest of 16 waits for Omar. Legs skip step 16 until Omar says the Samsung route is ready or he has time at the TV.
  - **Done when:** results.md has a row per spike per device. Spikes that couldn't be run are listed with the plan to cover them.
- [x] 16a. **The webOS model year, the LG minimum, and the first results.** Detail: docs/relay-archive.md, "Step 16a".

### Phase 5: Player and live TV
- [x] 17. **PlayerController (5.1).** Detail: docs/relay-archive.md, "Step 17".
- [x] 18. **Html5Engine (5.2).** Detail: docs/relay-archive.md, "Step 18".
- [x] 19. **AvplayEngine (5.3).** Detail: docs/relay-archive.md, "Step 19".
- [x] 19b. **[needs Omar] AvplayEngine on a Samsung TV (split out of 19 in leg 38).** PR #171. Commits: `8932057`. Detail: docs/relay-archive.md, "Step 19b".
- [x] 20. **Player UI (5.4).** Detail: docs/relay-archive.md, "Step 20".
- [x] 20a. **The player in the app: live playback, zapping and the error cards.** PR #38. Commits: `aa299fb`. Detail: docs/relay-archive.md, "Step 20a".
- [x] 20b. **Tracks and subtitles.** Detail: docs/relay-archive.md, "Step 20b".
- [x] 20b1. **The track menu and the language preferences.** PR #39. Commits: `853bdfb`, `363a7cf`. Detail: docs/relay-archive.md, "Step 20b1".
- [x] 20b2. **The subtitle overlay.** Detail: docs/relay-archive.md, "Step 20b2".
- [x] 20b2a. **The subtitle parser.** Detail: docs/relay-archive.md, "Step 20b2a".
- [x] 20b2b. **The overlay and its feeds.** Detail: docs/relay-archive.md, "Step 20b2b".
- [x] 20c. **Player UI, the rest.** Detail: docs/relay-archive.md, "Step 20c".
- [x] 20c1. **The profile's player memory and start-on-last-channel.** Detail: docs/relay-archive.md, "Step 20c1".
- [x] 20c2. **Aspect/zoom, stream info, `allowed_output_formats`, the full checklist.** Detail: docs/relay-archive.md, "Step 20c2".
- [x] 20c2a. **`allowed_output_formats` and stream info.** Detail: docs/relay-archive.md, "Step 20c2a".
- [x] 20c2b. **Aspect/zoom and the full checklist.** Detail: docs/relay-archive.md, "Step 20c2b".
- [ ] 21. **[needs Omar] On-TV player check.** 50 rapid zaps, 2 h soak with injected stalls (each recovered in ≤ 10 s), launch to last channel in ≤ 4 s on 2020+ TVs. Run by the lab self-test, or by Omar from the checklist. Covers Omar's LG and the Samsung route chosen at step 16.

### Phase 6: EPG and catch-up
- [x] 22. **EPG sources (6.1).** Detail: docs/relay-archive.md, "Step 22".
- [x] 22a. **The refresh schedule in the running app.** Detail: docs/relay-archive.md, "Step 22a".
- [x] 22b. **The guides screen.** Detail: docs/relay-archive.md, "Step 22b".
- [x] 22b1. **The guide list in the profile, and what the screen needs from the refresh.** Detail: docs/relay-archive.md, "Step 22b1".
- [x] 22b2. **The guides screen and its way in.** Detail: docs/relay-archive.md, "Step 22b2".
- [x] 22b2a. **The settings and guides screens.** Detail: docs/relay-archive.md, "Step 22b2a".
- [x] 22b2b. **The guides screen's full e2e and checklist.** Detail: docs/relay-archive.md, "Step 22b2b".
- [x] 23. **Grid guide (6.2).** Detail: docs/relay-archive.md, "Step 23".
- [x] 23a. **The grid's data: channels × hours from the query worker.** Detail: docs/relay-archive.md, "Step 23a".
- [x] 23b. **The grid component** Detail: docs/relay-archive.md, "Step 23b".
- [x] 23c. **The guide screen in the app.** Detail: docs/relay-archive.md, "Step 23c".
- [x] 23d. **The grid's throttled e2e.** Detail: docs/relay-archive.md, "Step 23d".
- [x] 23e. **The grid on Chromium 53/56/68.** Detail: docs/relay-archive.md, "Step 23e".
- [x] 24. **Programme details (6.3).** Detail: docs/relay-archive.md, "Step 24".
- [x] 24a. **The programme details.** Detail: docs/relay-archive.md, "Step 24a".
- [x] 24b. **The time offset per guide.** Detail: docs/relay-archive.md, "Step 24b".
- [x] 24c. **Match diagnostics.** Detail: docs/relay-archive.md, "Step 24c".
- [x] 24d. **Manual mapping, the data.** Detail: docs/relay-archive.md, "Step 24d".
- [x] 24e. **Manual mapping, the screens.** Detail: docs/relay-archive.md, "Step 24e".
- [x] 25. **Catch-up and tuning (6.4).** PRs #60–#63. Detail: docs/relay-archive.md, "Step 25".
- [x] 25a. **Catch-up from the programme details (Xtream).** Detail: docs/relay-archive.md, "Step 25a".
- [x] 25b. **The M3U modes, and the zone of an Xtream-shaped playlist.** Detail: docs/relay-archive.md, "Step 25b".
- [x] 25c. **The catch-up days in the guide, the archive marks, and the low-tier tuning.** Detail: docs/relay-archive.md, "Step 25c".
- [x] 25d. **The catch-up player: position, pause, seeking and the end.** Detail: docs/relay-archive.md, "Step 25d".

### Phase 7: Movies, series, search
- [x] 26. **Movies.** Detail: docs/relay-archive.md, "Step 26".
- [x] 26a. **The movies screen: categories and a poster grid, with tiered image caps.** Detail: docs/relay-archive.md, "Step 26a".
- [x] 26b. **The poster grid at scale and on the old engines.** Detail: docs/relay-archive.md, "Step 26b".
- [x] 26c. **The movie details and playing a movie.** Detail: docs/relay-archive.md, "Step 26c".
- [x] 26q. **Fix the old-engine walk's guide step near midnight** PR #66. Detail: docs/relay-archive.md, "Step 26q".
- [x] 26r. **Rename the product "Zoma" to "Lablo" everywhere** Detail: docs/relay-archive.md, "Step 26r".
- [x] 26d. **Resume.** Detail: docs/relay-archive.md, "Step 26d".
- [x] 26e. **"Recently added".** Detail: docs/relay-archive.md, "Step 26e".
- [x] 27. **Series.** PRs #76-#84. Detail: docs/relay-archive.md, "Step 27".
- [x] 27a. **The series screen.** Detail: docs/relay-archive.md, "Step 27a".
- [x] 27b. **A show's details: seasons and episodes.** Detail: docs/relay-archive.md, "Step 27b".
- [x] 27c. **Playing an episode: progress and auto-next.** Detail: docs/relay-archive.md, "Step 27c".
- [x] 27c1. **Playing an episode, its place, and the show's last episode.** Detail: docs/relay-archive.md, "Step 27c1".
- [x] 27c2. **Auto-next.** Detail: docs/relay-archive.md, "Step 27c2".
- [x] 27d. **"Continue watching".** Detail: docs/relay-archive.md, "Step 27d".
- [x] 28. **Search and Home.** Detail: docs/relay-archive.md, "Step 28".
- [x] 28a. **Search.** Detail: docs/relay-archive.md, "Step 28a".
- [x] 28b. **Home.** Detail: docs/relay-archive.md, "Step 28b".
- [x] 28b1. **The header's icons, and Home with "Continue watching", "Recently added" and "Recently updated".** Detail: docs/relay-archive.md, "Step 28b1".
- [x] 28b2. **The channels watched last on Home.** Detail: docs/relay-archive.md, "Step 28b2".

### Phase 8: Backend (local development until step 34)
- [x] 29. **Backend skeleton.** Detail: docs/relay-archive.md, "Step 29".
- [x] 29a. **The web app, its database, its lint and CI.** Detail: docs/relay-archive.md, "Step 29a".
- [x] 29b. **`protocol` and `crypto` with shared test vectors; the R2 and Upstash interfaces.** Detail: docs/relay-archive.md, "Step 29b".
- [x] 29b1. **`crypto` and its shared test vectors.** Detail: docs/relay-archive.md, "Step 29b1".
- [x] 29b2. **`protocol`, the R2 and Upstash interfaces, the Next.js bump.** Detail: docs/relay-archive.md, "Step 29b2".
- [x] 29b2a. **`protocol` on zod, proved on the old engines; the blob store and rate limiter fakes.** Detail: docs/relay-archive.md, "Step 29b2a".
- [x] 29b2b. **The Next.js bump.** Detail: docs/relay-archive.md, "Step 29b2b".
- [x] 30. **Signed config.** PRs #98-#112. Detail: docs/relay-archive.md, "Step 30".
- [x] 30a. **The signer, the config files and `GET /v1/config`.** Detail: docs/relay-archive.md, "Step 30a".
- [x] 30b. **The TV's config client (no UI yet).** PRs #100, #102. Detail: docs/relay-archive.md, "Step 30b".
- [x] 30b1. **The config client's pure parts and its service (`packages/data`, not yet used by the app).** Detail: docs/relay-archive.md, "Step 30b1".
- [x] 30b2. **The config client in the app (no UI yet).** Detail: docs/relay-archive.md, "Step 30b2".
- [x] 30c. **Enforcement in the app.** PRs #104-#112. Detail: docs/relay-archive.md, "Step 30c".
- [x] 30c1. **The config plumbing: `?api=`, `refreshNow`, the test hook, the hello screen's config row on the old engines.** Detail: docs/relay-archive.md, "Step 30c1".
- [x] 30c2. **The kill modes and the update screen.** Detail: docs/relay-archive.md, "Step 30c2".
- [x] 30c2a. **The config gate: `disable-app`, the "update Lablo" screen and the notices.** Detail: docs/relay-archive.md, "Step 30c2a".
- [x] 30c2b. **`block-new-sources` and `disable-playback`.** Detail: docs/relay-archive.md, "Step 30c2b".
- [x] 30c3. **The blocklist checks.** PRs #110, #112. Detail: docs/relay-archive.md, "Step 30c3".
- [x] 30c3a. **The blocklist at add and on refresh, and where it shows.** Detail: docs/relay-archive.md, "Step 30c3a".
- [x] 30c3b. **The blocklist before playing.** Detail: docs/relay-archive.md, "Step 30c3b".
- [x] 31. **Pairing.** Detail: docs/relay-archive.md, "Step 31".
- [x] 31a. **The pairing API** Detail: docs/relay-archive.md, "Step 31a".
- [x] 31b. **The phone page `/p`** Detail: docs/relay-archive.md, "Step 31b".
- [x] 31c. **The TV's pairing screen** Detail: docs/relay-archive.md, "Step 31c".
- [x] 31c1. **The QR encoder and the pairing client** Detail: docs/relay-archive.md, "Step 31c1".
- [x] 31c2. **The TV's pairing screen, its add path and its statuses** Detail: docs/relay-archive.md, "Step 31c2".
- [x] 31c2a. **The pairing screen and its add path** Detail: docs/relay-archive.md, "Step 31c2a".
- [x] 31c2b. **The pairing screen on the old engines** Detail: docs/relay-archive.md, "Step 31c2b".
- [x] 31c3. **The pairing e2e** Detail: docs/relay-archive.md, "Step 31c3".
- [x] 31d. **The M3U file relay.** Detail: docs/relay-archive.md, "Step 31d".
- [x] 31d1. **The file's way up and down** Detail: docs/relay-archive.md, "Step 31d1".
- [x] 31d2. **The TV's side of the file** Detail: docs/relay-archive.md, "Step 31d2".
- [x] 31d2a. **The file's bytes on the TV** Detail: docs/relay-archive.md, "Step 31d2a".
- [x] 31d2b. **The TV's add path and the stored file source** Detail: docs/relay-archive.md, "Step 31d2b".
- [x] 31d2b1. **The TV's stored file source and its add path** Detail: docs/relay-archive.md, "Step 31d2b1".
- [x] 31d2b2. **The file sent from a phone, end to end** Detail: docs/relay-archive.md, "Step 31d2b2".
- [x] 31d2b2a. **The file by phone against the stand-in, and on the old engines** Detail: docs/relay-archive.md, "Step 31d2b2a".
- [x] 31d2b2b. **The file by phone against the real API, and the phone page's wording** Detail: docs/relay-archive.md, "Step 31d2b2b".
- [x] 31e. **The "no plaintext" test, end to end** Detail: docs/relay-archive.md, "Step 31e".
- [x] 32. **Backup.** Detail: docs/relay-archive.md, "Step 32".
- [x] 32a. **The backup API** Detail: docs/relay-archive.md, "Step 32a".
- [x] 32b. **The TV's backup keys** Detail: docs/relay-archive.md, "Step 32b".
- [x] 32c. **Upload and restore** PR #130) and 32c2 (PR #131. Detail: docs/relay-archive.md, "Step 32c".
- [x] 32c1. **The envelope and the backup worker's upload and restore** Detail: docs/relay-archive.md, "Step 32c1".
- [x] 32c2. **The app: the look-up, "Welcome back" and the upload schedule** Detail: docs/relay-archive.md, "Step 32c2".
- [x] 32d. **Settings, the backup code and the proof** Detail: docs/relay-archive.md, "Step 32d".
- [x] 32d1. **The proof: a simulated webOS wipe restores automatically** Detail: docs/relay-archive.md, "Step 32d1".
- [x] 32d2. **Settings' backup page** Detail: docs/relay-archive.md, "Step 32d2".
- [x] 32d2a. **The backup's status, off, and a held backup, in the worker** Detail: docs/relay-archive.md, "Step 32d2a".
- [x] 32d2b. **Settings' backup page** Detail: docs/relay-archive.md, "Step 32d2b".
- [x] 32d3. **"Restore with a backup code" at the first start** Detail: docs/relay-archive.md, "Step 32d3".
- [x] 32d3a. **The TV bundle as UTF-8** Detail: docs/relay-archive.md, "Step 32d3a".
- [x] 32d3b. **The typed code's restore** Detail: docs/relay-archive.md, "Step 32d3b".
- [x] 32d3c. **"Restore with a backup code" at the first start** Detail: docs/relay-archive.md, "Step 32d3c".
- [x] 32d3d. **The old-engine walk with the code** Detail: docs/relay-archive.md, "Step 32d3d".
- [x] 32d4. **"Include login details" off** Detail: docs/relay-archive.md, "Step 32d4".
- [x] 32d4a. **The backup without logins, on the data side** Detail: docs/relay-archive.md, "Step 32d4a".
- [x] 32d4b. **The toggle and the way back for sources** Detail: docs/relay-archive.md, "Step 32d4b".
- [x] 32d4c. **The way back for guides** Detail: docs/relay-archive.md, "Step 32d4c".
- [x] 32e. **Logins at rest under `localKey`** Detail: docs/relay-archive.md, "Step 32e".
- [x] 33. **Telemetry.** PRs #143 to #149. Detail: docs/relay-archive.md, "Step 33".
- [x] 33a. **The scrubber and the telemetry API** Detail: docs/relay-archive.md, "Step 33a".
- [x] 33b. **The TV's telemetry** PRs #144, #145. Detail: docs/relay-archive.md, "Step 33b".
- [x] 33b1. **The sender and the start events** PR #144. Detail: docs/relay-archive.md, "Step 33b1".
- [x] 33b2. **The four other events** PR #145. Detail: docs/relay-archive.md, "Step 33b2".
- [x] 33b3. **The switch's Settings row and the consent sentence** PR #146. Detail: docs/relay-archive.md, "Step 33b3".
- [x] 33c. **The crash handler** PR #147. Detail: docs/relay-archive.md, "Step 33c".
- [x] 33d. **The diagnostics report and its support code** Detail: docs/relay-archive.md, "Step 33d".
- [x] 33d1. **The report's schema and `POST /v1/diag`** PR #148. Detail: docs/relay-archive.md, "Step 33d1".
- [x] 33d2. **The TV's "Send a report"** Detail: docs/relay-archive.md, "Step 33d2".
- [ ] 34. **[needs Omar] Production infrastructure.** **Deferred by Omar on 2026-11-19 (after leg 120): the relay goes on with step 35; step 34 waits until he says the accounts and keys are ready.** Legs skip it until then.
  - **Omar:** creates the Vercel/Neon/R2/Upstash accounts and the domain, and puts the keys in `.env` himself.
  - **Omar, the config key ceremony** (`docs/runbooks/config.md`, from step 30a): `pnpm sign-config keygen` twice (the current key and the next one, for rotation) on his own machine, each seed into his password manager and on paper, never into the repo or the chat; he gives Claude the two public keys for `config/keys.json` and signs the production config himself (`pnpm sign-config sign --key <file>`).
  - **Claude:** the first production migration and deploy, each with Omar's one-word OK; then verifies the live endpoints.

### Phase 9: Personalization
- [x] 35. **Favourites and groups.** PR #150), 35b (PR #151, PR #152) and 35d (PR #153. Detail: docs/relay-archive.md, "Step 35".
- [x] 35a. **The data side** PR #150. Detail: docs/relay-archive.md, "Step 35a".
- [x] 35b. **[needs Omar] The size pass.** PR #151. Detail: docs/relay-archive.md, "Step 35b".
- [x] 35c. **The lists in the live screen** PR #152. Commits: `87ebcbe`. Detail: docs/relay-archive.md, "Step 35c".
- [x] 35d. **Settings › "Channel groups"** PR #153. Commits: `4adad53`. Detail: docs/relay-archive.md, "Step 35d".
- [x] 35e. **Settings loaded on first open** PR #154. Commits: `4035b0f`. Detail: docs/relay-archive.md, "Step 35e".
- [x] 36. **Channel management.** PRs #155–#159. Detail: docs/relay-archive.md, "Step 36".
- [x] 36a. **The data side** PR #155, 36a2 in PR #156. Detail: docs/relay-archive.md, "Step 36a".
- [x] 36a1. **The profile's changed channels, their edits and re-match; core's `cleanName`.** PR #155. Commits: `3f97a7c`. Detail: docs/relay-archive.md, "Step 36a1".
- [x] 36a2. **The query worker's view** PR #156. Commits: `7d86801`. Detail: docs/relay-archive.md, "Step 36a2".
- [x] 36b. **The live screen** PR #157. Commits: `dc5194f`. Detail: docs/relay-archive.md, "Step 36b".
- [x] 36c. **The editing screens** PR #158. Commits: `71f3f9f`, `7ee5864`. Detail: docs/relay-archive.md, "Step 36c".
- [x] 36d. **Multiple sources merged:** PR #159. Commits: `1ab5ef6`. Detail: docs/relay-archive.md, "Step 36d".
- [x] 37. **M3U→Xtream and radio.** PR #160, PR #161. Commits: `2d58ea7`, `7c46ff3`. Detail: docs/relay-archive.md, "Step 37".
- [x] 37a. **The upgrade at add:** PR #160. Commits: `2d58ea7`. Detail: docs/relay-archive.md, "Step 37a".
- [x] 37b. **Radio:** PR #161. Commits: `7c46ff3`. Detail: docs/relay-archive.md, "Step 37b".
- [x] 38. **Parental and settings.** PRs #162–#169. Detail: docs/relay-archive.md, "Step 38".
- [x] 38a. **The gate:** PR #162. Commits: `69d100a`, `8b1f3d1`. Detail: docs/relay-archive.md, "Step 38a".
- [x] 38b. **Unlocking:** PR #162. Commits: `69d100a`, `bda3eca`. Detail: docs/relay-archive.md, "Step 38b".
- [x] 38c. **Settings › "Parental control"** PR #163, 38c2 PR #164, PR #165, 38c4 PR #166. Detail: docs/relay-archive.md, "Step 38c".
- [x] 38d. **The complete settings screen** PR #167, 38d2 PR #168, PR #169. Detail: docs/relay-archive.md, "Step 38d".
- [x] 39. **Comfort features** PR #170, 39b PR #172, PR #173, 39d PR #174. Detail: docs/relay-archive.md, "Step 39".
- [x] 39a. **"Clock while watching" and the Guide key:** PR #170. Commits: `4ac5201`. Detail: docs/relay-archive.md, "Step 39a".
- [x] 39b. **The colour keys** PR #172. Commits: `ddaa00b`. Detail: docs/relay-archive.md, "Step 39b".
- [x] 39c. **"Still watching?" and the sleep timer** PR #173. Commits: `8880cf5`. Detail: docs/relay-archive.md, "Step 39c".
- [x] 39d. **"Fast start / Stable"** PR #174, PR #171. Commits: `2868c35`. Detail: docs/relay-archive.md, "Step 39d".
- [ ] 39s. **Fixes from the first Samsung TV session** (Omar's "1a" of 2026-11-24, asked in his Samsung session: add the fixes as relay steps after step 39). The source: docs/spikes/results.md "From the Samsung TV (2026-11-24)" and "The app on the Samsung TV" (PR #171). The TV: UA32T5300AUXEG, 2020 HD, Tizen 5.5, Chromium 69. Steps 19b and 21 keep their own lines; their ticks wait for Omar's word.
  - [x] 39s1. **The storage quota** PR #175. Commits: `ac2781e`. Detail: docs/relay-archive.md, "Step 39s1".
  - [x] 39s2. **The ladder's HLS stickiness.** PR #176. Commits: `694a298`. Detail: docs/relay-archive.md, "Step 39s2".
  - [x] 39s3. **Stall injection that reaches the watchdog** PR #177. Commits: `7e947fe`. Detail: docs/relay-archive.md, "Step 39s3".
  - [ ] 39s4. **[needs TV] Launch to the last channel in ≤ 4 s on the Samsung.**
    - It takes 8–9.5 s now. From the page's start: `DOMContentLoaded` 2.4 s, `lablo:resume` 4.8–5.4 s, `lablo:live-ready` 43–55 ms later, `lablo:resume-frame` 9.1–9.6 s. The page itself starts 2.6 s after `was_execute`.
    - Leads:
      - the last channel's stream opens only about 50 ms before the live screen is ready: start it earlier;
      - its first frame took 4.3 s, partly because the source had stuck on HLS (39s2);
      - what main.js does before `resume`.
    - **Done when:**
      - the start's order is changed and measured on the desktop (marks in e2e);
      - the Samsung measurement repeats it (step 21's session, or 39s6's tools) at ≤ 4 s, or Omar accepts a written gap.
  - [x] 39s5. **Small fixes.** PR #178. Commits: `b0a3033`. Detail: docs/relay-archive.md, "Step 39s5".
  - [ ] 39s6. **A `tools/` step to drive a TV unattended** (Omar's "2a"; Samsung first, then webOS through `ares-inspect`). **Built and merged in leg 152: PR #179 as `9e775a0`** (`pnpm tv`, `tools/tv`, docs/runbooks/tv-setup.md §3.7) on green CI at the second run (changes, verify 17 m, media 10 m, web 3 m, engines 29 m; the first run's `verify` found the Node 22 bug in "Refined while building" point 6, and its `engines` hit the 35-minute cap). **Open for the run on the Samsung** (Omar, or a leg he hands the TV to), as 39s4 is:
    - remote keys and text over the TV's remote API: `wss://<tv>:8002` over a raw TLS socket with an `Origin` header (Node's built-in WebSocket gets no answer); `SendRemoteKey`; `SendInputString` (base64), then `SendInputEnd`, while the TV's keyboard is up;
    - the app's state through the inspector: `sdb shell 0 debug <appid>` prints a port, then `sdb forward`, then CDP `Runtime.evaluate`. `Page.captureScreenshot` never answers on Tizen 5.5;
    - the launch timing through `sdb shell 0 was_execute <appid>` (about 0.8 s; `tizen run` takes about 10 s);
    - the running state from `http://<tv>:8001/api/v2/applications/<id>`;
    - a soak monitor: AVPlay's state and position every 100 ms, the stalls, the heap.
    - The reference scripts are local, outside the repo (`D:/tmp/lablo-samsung/artifacts/`: `tvraw.mjs`, `cdp.mjs`, `soak-monitor.js`, `soak-report.js`, `soak-loop.sh`, `stalls.js`). They hold a LAN address and read a token file. **The repo is public:** no addresses or tokens. The TV's address and the token go in a gitignored file.
    - **Done when:**
      - `pnpm tv …` commands with unit tests of their message framing (no TV);
      - a README section in `docs/testing-without-tvs.md` or tv-setup.md;
      - one run on the Samsung by Omar or a leg he hands the TV to.
    - **Refined before building** (leg 152, against the six reference scripts and the Samsung session's notes; the raw session transcript wasn't found, so the parsers follow the documented shapes; no question for Omar: one conventional shape, and the TV run stays open as 39s4 does):
      1. **Where:** a workspace package `tools/tv` (`@lablo/tools-tv`), root script `"tv": "tsx tools/tv/tv.ts"`. The entry only calls `main()` from `src/main.ts`; the logic is pure functions and small I/O wrappers in `src/`, each tested. No import from another tool: the Tizen app id rule is a copy, held to tools/device's by a root test (`test/tv-app-ids.test.ts`), as 39s5 did for the `.wgt` names.
      2. **The config:** `.tv.local.json` at the root, gitignored: the TV's `host`, its sdb `serial` (default `<host>:26101`), the remote's client `name` (default `LabloLabPC`, the session's, so its token still works), the `token` the TV gives, the forwarded `cdpPort`. `pnpm tv setup <host>` writes it; the token is never printed. Nothing in the repo holds an address or a token.
      3. **`src/ws.ts`, a raw WebSocket client:** tvraw's hand-written upgrade (Host, `Upgrade`, `Connection`, a random `Sec-WebSocket-Key`, version 13, `Origin`), the TLS socket with `rejectUnauthorized: false`, masked client frames with 7-, 16- and 64-bit lengths, server frames parsed across chunk splits (masked ones too, and continuations joined), a ping answered with a pong, and a close answered. Only the 101 status is checked: tvraw never checked `Sec-WebSocket-Accept`, and the TV's answer to it is unrecorded. Tested against a local server written with the same codec, and the codec against Node's own `WebSocket` (both directions).
      4. **`src/remote.ts`, Samsung's remote:** the path with the base64 name and the saved token; `SendRemoteKey` (`Click`), `SendInputString` (base64), `SendInputEnd`; a script of tokens as tvraw's (`KEY_DOWN 800 KEY_ENTER TEXT:abc END`), an unknown token refused before connecting; the events `ms.channel.connect` (a new token saved), `ms.channel.unauthorized` (a clear refusal: allow the PC on the TV), `ms.remote.imeStart`/`imeEnd` (logged, so a `TEXT:` sent with no keyboard up shows). tvraw's pauses stay (500 ms after a key, 800 ms after text).
      5. **`src/cdp.ts`, the inspector:** `sdb shell 0 debug <appid>` prints `port: N` (new at each launch; the command relaunches the app), then `sdb forward tcp:N tcp:N`, the `/json` list's page target and `Runtime.evaluate` (`awaitPromise`, `returnByValue`) over Node's built-in `WebSocket` (Node 22 has it). No screenshot command (`Page.captureScreenshot` never answers on Tizen 5.5): `pnpm tv screen` reads `__LABLO_TEST__.focusPath()` and the page's text, `pnpm tv marks` the `lablo:` User Timing marks and `DOMContentLoaded` (39s4's measurement). `--port` takes any forwarded port, so `eval`, `screen`, `marks` and the soak work on webOS through `ares-inspect`'s port; LG's own remote keys (SSAP) are a later part.
      6. **Launch and state:** `pnpm tv launch [--lab]` runs `sdb shell 0 was_execute <appid>` and prints its time; `pnpm tv state [--lab]` reads `http://<tv>:8001/api/v2/applications/<id>` (`running`, `visible`, else the raw answer). The ids come from `platforms/tizen/config.xml` and the staged lab's `config.xml`, as `pnpm device` reads them.
      7. **The soak:** the injected sampler only records `[time, state, position]` every 100 ms into a buffer (AVPlay's `getState`/`getCurrentTime`, or the page's `<video>` where there is no AVPlay) and the heap every 5 minutes, capped at an hour of samples. `pnpm tv soak watch` drains it every interval, appends each drain to an ndjson file in `artifacts/`, re-injects the sampler after a reload, and reconnects sdb and the forward once when a drain fails (soak-loop.sh's fix). The stall rule is a pure `StallDetector` (the position frozen ≥ 1.5 s while `PLAYING`, from the last move to the next; soak-monitor.js's rule), so `pnpm tv soak report <file>` reruns it over a recorded soak.
      8. **Done when, for this leg:** unit tests of the framing, the messages, the parsers, the detector and the sampler (in a `vm` context), with no TV; a section in tv-setup.md (§3.7); lint, typecheck; mutation with the list written first; the PR, CI and the merge on green. No TV source changes, so no `build:tv`. The run on the Samsung waits for the TV: 39s6 stays open, as 39s4 does.
    - **Refined while building** (leg 152):
      1. **The handlers come with the open:** a server may send its first message in the packet that carries its 101 (the TV sends `ms.channel.connect` at once), and a handler set after `await openRawWebSocket(...)` missed it: the first test run lost three tests' first frames. `onText` and `onClose` are options of `openRawWebSocket`; `onClose` fires only after an upgrade (a refusal is the promise's rejection).
      2. **The frame parser lost two redundant checks:** a partial mask key is caught by the payload's length check, and a message's first frame always finds the parts empty.
      3. **`parseDebugPort` takes any digits and the range decides** (mutant 35 survived while `\d{2,5}` refused `port: 0` itself).
      4. **Readable output:** `formatJson` keeps an array of one-line items on one line; `marks` prints aligned lines; the stall list gives minutes from the soak's start (`recent`), not epoch milliseconds.
      5. **Run locally with no TV:**
         - headless Chromium 156 with DevTools on a port, a page with a playing MP4 from `.cache/media`, `__LABLO_TEST__` and two `lablo:` marks: `screen`, `marks`, `eval` (a value, and an exception: exit 1), `soak start`, a 1-minute `soak watch` with a 3 s pause injected (one stall of 3.2 s, the 100 ms samples on each side), then `soak report` of its file (the same stall);
         - a fake TV over TLS on port 8002 (a throwaway self-signed certificate, outside the repo): `setup 127.0.0.1`, `keys KEY_UP 300 KEY_ENTER TEXT:... END` (the token saved and never printed, both keyboard events logged), a second `keys` that sent the token back, and the refusal (exit 1, nothing sent).
      6. **Node 22's `WebSocket` fires `error` again from inside `close()`** on a socket that never opened. The inspector client's error handler closed the socket, so on CI (Node 22; this PC runs 24) it called itself until the stack ran out (PR #179's first run, `verify`'s "Maximum call stack size exceeded" in "rejects when the debugger URL fails"). Each path now settles first and closes after, and the error path never closes. The socket is injectable (`evaluateOnPort`'s fourth argument), so a test reproduces Node 22's behaviour on any Node, and two more tests check that no timer outlives a settled call (an armed 60 s timer would hold `pnpm tv eval` open).
    - **Gates (leg 152):**
      - unit: tools/tv 92 tests in 9 files (the codec, the client against a local server and against Node's own `WebSocket`, the remote's messages and script, the inspector against a local server and a Node-22-like fake socket, the stall rule, the sampler and the probes in a `vm` page, the config, the arguments, the formatter), the new root test `test/tv-app-ids.test.ts` (2); with tools/device and 39s5's root test, 107 in 12 files;
      - lint, typecheck (the root and the package);
      - mutation 78 of 78 (`artifacts/mutate39s6.py`, the list written first; 35 survived at the first run and was closed, point 3; 75–78 were added for point 6 before they ran);
      - CI's first run: `verify` failed on point 6; `engines` hit its 35-minute cap during Chromium 56 (Chromium 53 alone took 28 minutes; no TV source changed, the lockfile made it run); `media` and `web` passed;
      - no TV source changed, so no `build:tv`; the PR's CI runs every job (the root `package.json` and the lockfile changed);
      - not done: the run on the Samsung (Omar, or a leg he hands the TV to); webOS through `ares-inspect` (`--port`) untried.
  - **Waiting for Omar at the TV** (his "3a"): S4's `suspend`, S10 by hand, S11's lifecycle and reading by ear on the Samsung, which need the TV's own remote (the network remote's Home doesn't hide the app); and the "Zoma" he saw on screen. docs/spikes/results.md's "Still to run" table lists them.
- [ ] 40. **Diagnostics and legal pages.** Diagnostics screen ("app or provider?"), test stream, help, in-app legal pages.
  - **Refined before building** (leg 153, against PLAN.md §4 pillar 4 and "Legal surfaces", §7's legal track, architecture.md §2 "Error classifier" and "Built in step 33d2", and the code):
    1. **What exists:** the player's error card (four categories, the code, the account's expiry and connections after a provider failure, step 20a); the info bar's "Stream info" (codec, resolution, frame rate, bitrate while watching); Settings' "Send a report to support" (a support code, step 33d2); the guides' match diagnostics (step 24c); onboarding's disclaimer ("Lablo is a player…") and the device-ID consent (steps 13, 32). No page answers "is it the app or my provider?" outside a failed play, and there is no help, no "Test stream", no terms or privacy text in the app or on the web (`apps/web/src/app` has `p`, `v1`, `dev`).
    2. **The split:** 40a, the diagnostics page (no decision needed); 40b, "Test stream" (where the stream lives: Omar's); 40c, help (the support address: Omar's); 40d, the legal pages (counsel's text: Omar's). The connection speed test is v1.1 (PLAN §6), not here.
    3. **Omar's answers (2026-11-25, leg 153):**
       - **The legal text:** a factual draft now: what Lablo really collects and keeps, in plain words, marked "Draft for counsel" in the app and on the web; a release check refuses a store build while a draft mark remains. Counsel's text replaces it.
       - **The test stream:** its link comes from the signed remote config; the button shows only when the config names one. Step 34 hosts a Lablo test pattern on our storage; dev and e2e use the mock's stream.
       - **Support:** the address `lablo.iptv@gmail.com`, built into the app's Help (public on purpose: the repo is public).
  - [x] 40a. **Settings › "Check the connection"** PR #180. Commits: `ddaacf7`. Detail: docs/relay-archive.md, "Step 40a".
  - [x] 40ci. **Done in leg 154: PR #181 merged as `018b4fc`.** PR #181. Commits: `018b4fc`. Detail: docs/relay-archive.md, "Step 40ci".
  - [x] 40b. **Done in leg 155: PR #182 merged as `8f67a10`** PR #182. Commits: `8f67a10`. Detail: docs/relay-archive.md, "Step 40b".
  - [x] 40c. **Done in leg 156: PR #183 merged as `3f57785`** PR #183. Commits: `3f57785`. Detail: docs/relay-archive.md, "Step 40c".
  - [x] 40d. **Done in leg 157: PR #184 merged as `4c1d7d2`** PR #184. Commits: `4c1d7d2`. Detail: docs/relay-archive.md, "Step 40d".

  - [x] 40e. **The app's own on-screen keyboard, Arabic and English** Detail: docs/relay-archive.md, "Step 40e".
  - [x] 40f. **Sources on the TV: edit, remove and add** (**Done in leg 160: PR #188 merged as `50fd1a0`**, CI green after one rerun of the `auto-next` flake; the refinements and gates are below) (Omar's decision from `iptv-df`, 2026-11-25: "Edit + remove + add", over "edit only" and "leave as is"). On Settings › Sources: change a source's server and login, remove a source, and add another source on the TV itself (today the header has only "Add from your phone"; `sources-state.ts` says "no actions yet"). Why: the reinstalled app's source pointed at the PC's old address after the hotspot's subnet changed, and the only fix was a full uninstall and onboarding. Refine first against `sources-state.ts`, `source-login.ts` (the login form exists for refreshes), onboarding's source form (`form.ts`), the data engine's source calls, the parental locks, the backup (a removed source in the backup) and architecture.md's "no source can be edited yet" line. Uses 40e's keyboard for typing. A removal needs a confirm and clears the source's items, guides and mappings; say what a removal does to favourites and locks.
    - Done when: unit and e2e in the three locales (edit the server and login, remove with confirm and Back, add on the TV, the lists refresh, the backup follows); mutation; PR merged on green CI.
    - **Refined before building (leg 160):** (1) A source's id is stored in: `sources`, `guides` (the one onboarding typed has the source's id), `favourites` (`src`) and `favouriteLists[].keys`, `hiddenGroups`/`groupOrder` (`src`), `channelEdits` (`src`), `parental.groups` (`src`), `player.last`, `channels`, `containers`/`redirects` (by id), `tracks`, `progress`, `shows` (keys), `epgOffsets` (`<src>:xmltv`, `<src>:tvg<n>`, `u~<src>`), `epgOverrides` (the channel's key, and pins into the source's guides); the catalog and its generations (`deleteSource`); the source's own EPG records (`<src>:xmltv`, deleted by the next EPG refresh, which lists none of them). The backup is the profile document whole, so it follows by itself. (2) One pure transform, `removeSourceFromProfile` (`packages/data/src/source-removal.ts`, TV subset: no regex or split), applied in the INGEST worker next to `deleteSource` (not the query worker: it was 149.3 of 150 KB), then the query worker reloads. The catalog goes first: a crash between the two leaves the source listed with an empty catalog, and removing it again works. (3) The confirm names the pool's favourites of the source (`sourceFavouriteCount`, each item once, whatever lists hold it); user lists stay, only emptied of its keys. (4) Ids: `nextSourceId` takes one past the highest id used, so the id of the last source removed can be handed out again; that is safe because everything naming it goes, the typed guide included. (5) Edit = the login form already there (`source-login.ts`), now opened from the row's menu for any source with a login or link (a phone's file has none). (6) Add on the TV: its own dialog state (`source-add.ts`: kind, onboarding's `FORM_FIELDS` and `checkForm`, the same `createEngineLoader` the phone's add uses, the config's `block-new-sources` refusal, refreshes held while it runs, "Set a PIN" when locked groups came in) and page (`SourceDialogs.tsx`, onboarding's label-beside-box layout: five fields do not fit under a header otherwise); the header has "Add from your phone", then "Add a source". (7) OK on a row now opens its menu (was: the login form at once for a source needing its login): "Change server and login", "Remove", "Cancel"; a row being removed has no menu. (8) en/ar/en-XA texts: `sources.add`, `addTitle`, `menuTitle`, `menuLine`, `editLogin`, `editLink`, `remove`, `removing`, `removeTitle`, `removeBody` (the favourites' plural, six Arabic forms); the rest are onboarding's and the pairing's.
  - [x] 40g. **`pnpm tv` fixes from the Samsung TV (39s6)**, found by `iptv-df` today: (a) `pnpm tv inspect` fails with "error: cannot install forward listener" while a stale `sdb forward` holds the port: remove the serial's forwards (`sdb forward --remove`) before forwarding; (b) `sdb shell 0 debug LabloIPTV1.Lablo` hangs with no output while the app already runs (the tool then says "No inspector port in sdb's answer:"): run `sdb shell 0 kill LabloIPTV1` first (it prints "Pkgid: LabloIPTV1 is Terminated"); (c) `sdb shell 0 vd_appuninstall` needs the full app id `LabloIPTV1.Lablo` (the package id alone answers "was get app info failed"). Done when: unit tests with the fake sdb for each case, mutation, PR merged. No TV needed.
  - [ ] 39s7. **[needs TV for the check] A frozen AVPlay picture on a held socket goes unseen** (from Omar's Samsung session `iptv-df`, 2026-11-25; facts in docs/spikes/results.md "From the Samsung TV (2026-11-25)"). User-facing: a frozen picture with no "Reconnecting…" until the provider drops the socket, which may be never. During `live-outages` AVPlay kept `getState()` PLAYING and `getCurrentTime()` advancing at wall-clock speed through every 25 s outage, so neither AVPlay nor the watchdog reconnected.
    - What to do: probe candidate signals on the TV in the lab (a new S4 row): `getStreamingProperty('CURRENT_BANDWIDTH')`, plus `GET_LIVE_DURATION`, `IS_LIVE` and `AVAILABLE_BITRATE` for TS; the `onbufferingstart` and `onbufferingprogress` callbacks; `getCurrentStreamInfo()`. Then give the player's watchdog the signal that works (a held socket must reach the reconnect ladder), and make `pnpm tv soak`'s stall rule use it (its position-only rule counted 1 stall where there were about 20).
    - Step 21's soak waits for 39s7. Omar is using the Samsung himself (2026-11-25 ~17:30 local): no `pnpm tv`, sdb or `pnpm device` against it until he says it is free; park TV-only parts.
    - Done when: the signal is chosen from TV readings, a unit test with a fake AVPlay shows a held socket reaching the ladder, mutation, PR merged; the TV check of it waits for Omar.
  - [x] 40h. **A hidden app is ended by the TV: save what must survive at `hidden`** (from `iptv-df`, 2026-11-25; small). On the Samsung, Home followed by another app ends the app (a fresh start on return). Check that VOD and series positions (and anything else that must survive: an open screen's state is lost by design) are saved at `hidden`, not only at the next periodic save; if not, fix it. Done when: a unit test shows the save on `hidden` (fake lifecycle), mutation, PR merged.
  - 40g additions from the same session: (d) the inspector allows one client at a time (say so in `pnpm tv`'s error); (e) `pnpm tv soak`'s stall rule uses the wall clock against position and the signal 39s7 finds. Do 40g in 40f's leg (Omar's speed-up).
    - **Done in leg 159 (a-d): PR #187 merged as `b27e3ba`** on green CI (changes, verify, web, media, engines).
    - **Built in leg 159 (code, no TV used):** (a) `inspectApp` drops the saved and the new port's forwards before forwarding; (b) it ends the app (`kill <package id>`) before `debug`; (c) new `pnpm tv uninstall [--lab]` with the full app id; (d) the inspector's two failure messages say it allows one client at a time; tests with a fake sdb (`commands.test.ts`), 8 of 8 hand mutants killed, tv-setup.md §3.7 updated. **(e) the soak's stall rule is parked on 39s7:** the picture froze while the position kept advancing at wall-clock speed, so a wall-clock-versus-position rule alone cannot see it; it needs the signal 39s7 finds on the TV.
  - 39s6's real-TV run: `iptv-df` relays "tick 39s6" as Omar's word (2026-11-25); recorded here, and the tick left for Omar's own word in his tab (a handover reserved it). 40g carries the fixes.
  - **Omar's answers (2026-11-25, via iptv-df; his rule: "faster without losing quality or features"). Don't stop for these again:**
    - **Speed-ups.** (1) Right after 40e merges and before 40f: slim RELAY.md in ONE docs-only commit (CI's changes job runs nothing for it): move every ticked step's detail (refinements, gates, notes) and the older progress rows, verbatim, to `docs/relay-archive.md` under the step ids as headings (`grep "step 25c"` must still find them); RELAY.md keeps objective, DoD, each finished step as one line (PRs, commits, pointer to its archive heading), every open step in full, Omar's parallel track and the last ~15 log rows; target under ~100 KB; check no open step loses text. (2) Combine: 40g's `pnpm tv` fixes in 40f's leg; all of step 44's documents in one leg.
    - **40e (built in leg 158 to this):** our keyboard opens by default in every text field, with a key that hands over to the TV's own keyboard; QWERTY plus the standard Arabic layout, not alphabetical.
    - **40f:** removing a source removes its channels from favourites lists and from locks; the confirm dialog names how many favourites go; re-adding the source later starts fresh.
    - **39s4:** "biggest gain, then accept": reorder the start (open the last channel's stream first), measure on the Samsung, accept the number reached if it is a clear gain; one leg. Baseline (store build, debug launch via `pnpm tv inspect`, marks from navigation start, 3 cold launches, ms): `DOMContentLoaded` 3433/2860/2833; `lablo:resume` 7435/5274/5272; `lablo:resume-frame` 11676/8098/8120; `lablo:live-ready` 40-60 ms after resume.
    - **43:** large text = ONE "Larger text" on/off row in Settings (about +25% text, layouts fitted, en and ar), not three sizes. Captions: add a background box (none / dark / solid) and text-colour presets to today's size and timing. Evidence (Samsung S11, Voice Guide on, session tizen-UA32T5300AUXEG-20261125-162733-ap43): `focus-reading` (DOM focus + `aria-label`) and `live-reading` (`aria-live`) were both read aloud, so on Tizen architecture.md §5's S11 fallback (an explicit speak) is not needed; the LG's Audio Guidance is still unrun.
    - **44:** the store listing name is "Lablo IPTV Player" (LG and Samsung); the app's title on the TV stays "Lablo".
    - **41:** the 2018 low tier goes through Samsung Remote Test Lab, not a bought set; that part becomes `[needs Omar]`: the tunnel so RTL TVs reach the lab server (tv-setup.md 3.2-3.6).
    - **New finding to check (step 40h, small):** on this Samsung a backgrounded app is ended by the TV (Home, another app, return = a fresh start twice: a `hidden` event, then a new session, no `visible`/`relaunch`; lab sessions ...161816, ...162733, ...163117). Anything held only in memory is lost on Home: a VOD or episode position since the last save, an open screen. Check that VOD and series positions (and anything else that must survive) are saved at `hidden`; if not, fix it. S4's suspend/restore row cannot run on this TV for the same reason.
### Phase 10: Hardening and release
- [ ] 41. **[needs TV] Performance.** 2018-tier performance and memory pass against the S6 thresholds.
  - Since ADR-012 the low tier is Samsung 2018–2019 only (the used 2018 set). Consider a memory signal for the tier (`navigator.deviceMemory`, Chromium 63+) for low-end 2020 LG sets, which the year rule puts in `full`.
  - From step 25c (architecture.md §4, "Built in step 25c"): the guide's two days back with archive marks, each press within 150 ms over channels with catch-up; the marks drawn; holding LEFT across a day; two past days of a large guide with catch-up channels within the tier's memory.
  - From step 25d (architecture.md §1.2, "Built in step 25d"), on each TV: a catch-up's position (an HLS archive's and a TS timeshift's media time must start at 0 at the URL's start, or "Aired at" is off); RIGHT inside an HLS archive (AVPlay `seekTo`, webOS's `<video>`); a seek by URL's reconnect time; the remote's PLAY and PAUSE keys (webOS maps both to one toggle); a programme's end card from a real archive.
- [ ] 42. **[needs TV] Resilience.** 8 h soaks, network-drop tests, update-in-place data survival on both platforms.
- [ ] 43. **Accessibility.** Voice Guide/TTS, captions, large text, Magic Remote polish.
- [ ] 44. **Store documents.**
  - en/ar store copy, test-pattern screenshots, LG UX scenario + self-checklist, Samsung UI Description PPTX + tester notes.
  - The LG listing's minimum is webOS 5.0 (2020, ADR-012). `requiredACG` is already in the manifests and build-checked (step 16a).
  - **[needs Omar]** public test-server deploy.
- [ ] 45. **Release engineering.** Versioning, signed packages, release checklist script.
- [ ] 46. **[needs Omar] Beta.** Native Arabic review and a closed beta (10–30 users in GCC + North America).
- [ ] 47. **[needs Omar] Store submissions.** LG (US, AE, SA, KW, QA, BH, OM) and Samsung US. Samsung GCC/Canada follow once the Partner contract is signed.
  - LG: webOS 5.0 and newer (ADR-012); Samsung: Tizen 4.0 (2018) and newer.

## Omar's parallel track (not relay steps; see PLAN.md section 7)
- **Week 0–1:**
  - Decide the publishing company.
  - Test devices: you have one LG TV. Note its model and year for step 16. The Samsung route (used TV / remote lab / beta testers) is decided at step 16, using step 15's comparison.
  - Open Samsung Seller Office and submit the Partner application (Samsung Gulf). Open LG Seller Lounge.
  - "Lablo" trademark clearance in the US, CA, AE and SA. Domains.
- **Week 2–4:** counsel for ToS, privacy (PDPL, PIPEDA, Quebec Law 25) and DMCA policy; register the DMCA agent.
- **Before step 16:** install Tizen Studio and create the Samsung certificate (runbook from step 15).

## Progress log
| Session | Date | Step | Result | Commit |
|---|---|---|---|---|
| 145 | 2026-11-24 | 39's shape and split; 39a built and merged; Q1-Q3 asked | 39's shape written against the code first (facts: the clock already on every browsing screen; the Guide key mapped but unused; the colour keys and PRE-CH per platform; the buffer tunables unread; the query worker's 1.3 KB), split into 39a-39d, three questions for Omar (the colour keys, the sleep timer with "Still watching?", "Fast start / Stable"). 39a built: the profile's `player.options` (one generic edit), Settings › "Player"'s "Clock while watching" (the corner clock with the bar hidden), the Guide key on the live screen, the guide and the player (`guideFromPlayer`). Unit 8,662; e2e 3 new + 25 + 10; mutation 50/50 (one survivor closed); `build:tv` +1.4 / +0.3 KB, query worker 149.0/150, no module change; engines 68 13/13. PR #170 green at the first run, merged as `4ac5201`. Next: Omar's answers to Q1-Q3, then 39b-39d. | `1eaaa03`, `c911e41`, `a1f152b`, `b521bbf`, `4ac5201` (PR #170) |
| 145 (cont.) | 2026-11-24 | Omar answered "1 1 1"; 39b built and merged; Samsung fixes as 39s1-39s6; 19b ticked | Omar's answers recorded (Q1-Q3 option 1). Main brought in PR #171 (the Samsung session's results). 39b refined (3 points) and built: the colour keys as shortcuts (red favourites: the star in the player, a second favourites panel over the live list; green the Guide key; yellow PRE-CH in the player; blue search on the live screen), dots via Button's `colourKey`, four key tokens. Unit 8,660; e2e 3 new + 32 + 10; mutation 30/30 + 1 equivalent (dead `stop` removed); `build:tv` +0.9 KB, no module change; engines 68 13/13. PR #172 merged as `ddaa00b` (media: one cap, one `epg-declared-300mb` flake, then green). On Omar's "1a" (his Samsung session): the TV findings became steps 39s1-39s6; 19b ticked on his word. 39c read ahead (5 points). Next: 39c. | `656e371`, `19bbabb`, `2c4fdd9`, `249970e`, `061dd04`, `ddaa00b` (PR #172) |
| 146 | 2026-11-24 | 39c built and merged | 39c refined against the code first (8 points: the guard as its own module, every key on any screen as activity, a pause not stopping the count, the sleep timer for the run only, the prompt's keys, a card winning over the prompt, the lifecycle, the rows and the words), then built: `player/watch-guard.ts` (the no-key count, the sleep timer, the 60-second prompt), the prompt on the player's card zone, Settings › "Player"'s rows six and seven, `stillWatching` in `player.options`. Gates as on the 39c line; mutation 153 of 153. PR #173 merged on green CI at the first run. | `b443e38`, `d2b6d8b`, merge `8880cf5` |
| 147 | 2026-11-24 | 39d built and merged | 39d refined against the code and Samsung's AVPlay reference first (7 points: setBufferingParam's facts, the numbers for Fast start and Stable, remote config's tunables as Fast start's, the tuning read at each play, the option in `player.options`, the row's words, the page's window); built: "Buffering", Settings › "Player"'s eighth row (`player/play-tuning.ts`, the controller's `tuning`, `LoadOptions.buffer`, AVPlay's `setBufferingParam` in IDLE, the page scrolling, `settings-window.ts`); refined while building: the give-up window grows with the open timeout (a 20 s timeout never gave up). Gates: unit 8,820, e2e `buffering.spec.ts` 3 of 3 + 25 related + `tv-bundle` 10, lint, typecheck, `build:tv` main.js 467.7 KB Tizen (+2.7), module diff (2 modules, core-js 173 / 2), engines 68 13 of 13, mutation 81 of 81; PR #174 green at the first run, merged | 254af1e, 9ef6a5d, 2868c35 |
| 148 | 2026-11-24 | 39s1 refined; Q1-Q2 asked; Omar's "1 1"; 39s1 built and merged | 39s1 refined against the code (6 points: every write path keeps its old data when the store is full but nobody is told; a profile upgrade under a full store started onboarding; a refresh needs twice its data's space; `unlimitedstorage` planned but never requested). Omar answered "1 1" (the guides go first; a line on the live screen and the reason in Settings). Built: `storage-room.ts` (the room from the guides, a guide's own room), abandon and prune split (deletes first), `loadProfile` from memory, the engine's retried profile save and `storage-state.ts`, the live line, the sources' rows, the words, the Tizen privilege. Refined while building (7 points). Gates as on the 39s1 line: unit 8,886, e2e 3 + 32 + 10, mutation 85/86 (8 survivors closed, 1 equivalent), `build:tv` +2.9 KB (query worker 149.3/150), engines 68 13/13. PR #175 green at the first run, merged as `ac2781e`. Next: 39s2. | `1c368e2`, `9748ac9`, `5e8f3d0`, `e3fe25f`, `ac2781e` (PR #175) |
| 149 | 2026-11-24 | 39s2 refined, built and merged | 39s2 refined against the code (5 points: any frame moved the source, so an outage's switch rung kept `.m3u8` for good; the rule; the 15 s unexplained by the build's timeouts; the cap; what stays). No question for Omar (one conventional rule; the cap's numbers are leg 149's choices). Built: `movesMemory` (the request's first container, or one after a definitive failure), `fallbackMs` (Fast start 6 s, Stable 12 s) through `armOpenTimer` with the ladder's `untriedLeft` and `otherFailedForGood`. Gates: unit 8,902, mutation 22/22, `build:tv` +0.4 KB, module diff unchanged (core-js 173/2), e2e 14, engines 68 13/13. PR #176 green after one media flake rerun, merged as `694a298`. Next: 39s3. | `ff2f4ae`, `c7740eb`, `694a298` (PR #176) |
| 150 | 2026-11-24 | 39s3 refined, built and merged | 39s3 refined against the code and the generated media (6 points: channel 104 runs 118 KB/s and live TS bursts one 6 s segment, so 600 KB never let AVPlay start; `stall`'s new `outage_ms`; `live-outages` for step 21's soak; the 6.9 s stall was AVPlay's buffering, which the controller waits 12 s on by design ("Connecting…" on the TV is `buffering`'s overlay); step 21's 10 s rule counts from the outage's end; what stays). No question for Omar. Built: `Outages` and `outageKey` (account and stream id; held requests closed at the outage's end; a scenario switch ends them; log lines), `MediaSource.liveBytesPerSecond`, the lab's `stall-ts` at 18 s of media (2,125,152 bytes for 104), `stalling-streams` by time (12 s), `live-outages` (60 s, then down 25 s), a controller test of the 6.9 s case, architecture.md §2 "Built in step 39s3", the mock runbook. Gates: unit 8,911 (9 load timeouts passed alone), mutation 36/36, `lab:media` 2/2, the real mock checked by curl; no TV source changed (`build:tv` and engines on CI). PR #177 green after one engines flake rerun (Chromium 53 DevTools start-up), merged as `7e947fe`. Next: 39s5 (39s4 needs the TV). | `c7b81f6`, `b46a06b`, `7e947fe` (PR #177) |
| 151 | 2026-11-24 | 39s5 refined, built and merged | 39s5 refined against the code and the Samsung lab's records (4 points: the lab found by a listing only because a space sorts before `.`, `/lab/i` matching `Lablo.wgt` too; the app had no 4K year gate, and AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` for a 4K file reads as `network`; AVPlay listed the MP4's `mov_text` tracks and sent no cue; S8's prebuffer 1 of 2). No question for Omar (two gaps recorded as later fixes). Built: `tizenPackageFile` (tools/build: the `.wgt` named after `<name>` without spaces, an older build's removed), `tizenPackageName` and `tizenManifest` (tools/device: the exact file from each manifest), a root test holding the two rules together, the lab's `hevc-4k` words, architecture.md §2 "Step 39s5" with §5's S4 row and §7's v1.2 row, the runbooks, results.md. Gates: unit 939 in the touched areas (the full suite in CI), mutation 16/16, `build:tv --target lab`, `pnpm device` asking for both exact names. PR #178 green after one media flake rerun, merged as `b0a3033`. Next: 39s6 (39s4 needs the TV). | `8781d2f`, `b0a3033` (PR #178) |
| 152 | 2026-11-24/25 | 39s6 refined, built and merged (open for the TV run) | 39s6 refined against the six reference scripts (8 points: `tools/tv` with a thin entry; `.tv.local.json` gitignored for the address and token; the raw TLS WebSocket; Samsung's remote messages and script; the inspector, with `screen` and `marks` instead of screenshots and `--port` for webOS; `was_execute` and the REST state; the soak's small sampler with a pure `StallDetector`; the gates). No question for Omar. Built: `ws.ts`, `remote.ts`, `cdp.ts`, `commands.ts`, `config.ts`, `args.ts`, `probes.ts`, `soak.ts`, `format.ts`, `main.ts`, the root test `tv-app-ids`, tv-setup.md §3.7. Refined while building (6 points, among them handlers passed at open and Node 22's error-from-`close()` recursion, found by CI). Gates: unit 92 in tools/tv (107 with tools/device and the root tests), lint, typecheck, mutation 78/78 (one first-run survivor closed); run locally against headless Chromium's DevTools and a fake TV over TLS. PR #179: the first run failed `verify` (the Node 22 bug) and hit `engines`' cap; green at the second run, merged as `9e775a0`. Next: step 40 (39s4 and 39s6's TV run need the TV). | `5aa0f83`, `e760188`, `9e775a0` (PR #179) |
| 153 | 2026-11-25 | 40 refined and split (40a–40d); Omar's answers; 40ci added; 40a built and merged | Step 40 refined against PLAN §4 and §7 and the code, split into 40a (the diagnostics page), 40b (test stream), 40c (help), 40d (legal pages). The leg stopped once without a handover after the refinement's commit; Omar's "retry" resumed it, and he answered the three questions in the tab: a factual legal draft marked "Draft for counsel" with a release check; the test stream's link from the remote config; support at `lablo.iptv@gmail.com`. His session `iptv-df` sent his decision for a CI speed-up step: added as 40ci, after 40a and before 40b, its facts checked against `ci.yml` and `engines.ts`. 40a built: `source-probe.ts` (a panel's `player_api.php` with the account, a playlist's first kilobyte, 10 s each, no URL), the ingest worker's `probe`, `DataEngine.checkSources` (the blocklist first), `last-play.ts` and main's `watchedPlayer`, `connection-check.ts` (the state and the verdict), `ConnectionPage.tsx`, 33 catalog keys in en and ar. Gates: unit 18 + 21 + 2 + 1 new, the settings' pins updated, the full run green once the load timeouts ran alone; lint, typecheck; `build:tv` (main.js 477.2 KB Tizen, settings.js 106.6, ingest 139.9, query 149.3); e2e 3 of 3 plus the media check and 21 settings specs; mutation 80 of 80. PR #180 merged on green CI at the first run. Next: 40ci. | `ddaacf7` |
| 154 | 2026-11-25 | 40ci CI speed-up built and merged | Measured first: PR runs took 27–29 min, set by engines (Chromium 53, 56 and 68 one after another, 25 min) and verify (`pnpm verify` as one chain, 17–22). `ci.yml`: engines is a matrix of one job per engine (`--self-test --engine <id>`, a cache key per engine, `old-engines-report-<id>`); verify is a matrix of five parts (lint and typecheck; unit; e2e `--project=chromium --shard=1/2` and `2/2`, each with `build:tv`; the throttled project alone with `--no-deps`). Found on the way: Playwright never shards a project another depends on, so a plain `--shard` ran all of chromium in each shard. PR #181's first run failed on a race in `tools/tv/src/cdp.test.ts` (fake sockets' timers started before the client's fetch; fixed, two mutants caught) and the `epg-declared-300mb` flake. PR #181's second run green in 12 m 46 s (was 27–29); the `workflow_dispatch` run 14 m 00 s, green after one rerun of the `auto-next` ar-SA flake. Memory notes updated (gh-pr-checks-watch-race, iptv-ci-media-ffmpeg-apt, bg-watcher-memory-reap). Merged on green CI. Next: 40b. | `018b4fc` |
| 155 | 2026-11-25 | 40b "Test stream" built and merged | Refined first (8 points in RELAY). The signed config's optional `testStream: { url }` (old apps strip it; `sign-config` takes only https) reaches `ConfigPolicy.testStream`. Settings › "Check the connection" gets a "Test stream" button and line when the config names a link and playback isn't off (five sources then); the test screen plays the link on the app's one player under a bar, Close/Back/STOP stop it; main's `testing` keeps its plays out of "Last stream" and telemetry. Verdict: failed test → `test`; played test + last stream failed by the provider or the internet → `streams`; played test + no server answered → `provider`. Unit +10 (31), e2e 6/6 plain (a 404 link: `PRV-UNREACHABLE`) and the media played path; `build:tv` main.js 478.7/500, settings.js 110.0/150, config worker 139.3/150; mutation 64/64 (3 main.tsx survivors closed by re-reading "Last stream" in the e2e). PR #182 green at the first run. Found: this PC's `.cache/media` predates the rename (burned-in "Zoma Test 1 SMPTE") | 8f67a10 |
| 156 | 2026-11-25 | 40c Help built and merged | Refined first (6 points in RELAY). Settings › "Help", the last row: seven topics, each a page with "Close"; their words in `help-text.ts` (settings.js only; main.js +0.3 KB), the screen's own names quoted from the catalogs; every code `classifyFailure` can give is explained (a unit test pins it); the support page shows the address and the report row's code. Gates: unit 9248, typecheck, lint, `build:tv` (main 479.0, settings 121.5), e2e 3/3 + the report test, mutation 31/31. PR #183 green at the first run. | `3f57785` |
| 157 | 2026-11-25 | 40d legal pages built and merged | Refined first (7 points in RELAY). `packages/protocol/src/legal.ts` (one source, en and ar, a draft for counsel); Settings › "About Lablo" (last row: info page, terms, privacy, one section to a page); onboarding's consent points at it; `/terms` and `/privacy` in apps/web; `build:tv --release` refuses the draft (legal-gate.ts; the lazy rule keeps the text out of main.js). main.js 479.6 / 500, settings.js 139.1 / 150. Unit 9287+, e2e about 3/3, web e2e legal 9/9, mutation 66/66. | PR #184 `4c1d7d2` |
| 158 | 2026-11-25 | 40e the app's own keyboard built and merged | PR #185 as `5777bde`, CI green at the 2nd push (the first run: tv-bundle's walk typed through DOM focus; the 2nd: the password step raced the OK click window). Refined first (7 points in RELAY). `Platform.ownKeyboard` (Tizen, webOS; desktop `?keyboard=own`; `?keyboard=native` for walks and the lab), `screen-keyboard.ts` plain DOM on the body, layouts QWERTY and Arabic, hand-over key to the TV's keyboard. Unit 9363, e2e `keyboard.spec.ts` 3/3, mutation 67/67; main.js 487.0/500 KB Tizen. Omar's advance answers, the Samsung results, 39s7 and 40h recorded. | 5777bde |
| 159 | 2026-11-25 | RELAY slimmed (Omar's speed-up) | RELAY.md 1.09 MB to 68 KB: each finished step is one line with its PRs, commits and a pointer; the detail and legs 0-143 of the log moved verbatim to docs/relay-archive.md (1.05 MB, `## Step <id>` headings). Checked by script: every original line is in one of the two files, and the open steps are byte-identical and in order. Docs only. | (this commit) |
| 159 (cont.) | 2026-11-25 | 40g `pnpm tv` fixes (a-d) built and merged | PR #187 as `b27e3ba`, CI green at the first push. `inspectApp` (kill, debug, drop stale forwards, forward), `pnpm tv uninstall [--lab]`, the one-client hint; fake-sdb tests, 8 of 8 hand mutants killed; tv-setup.md 3.7. (e) parked on 39s7. 40f not started (the data layer has no remove-source edit yet: only the store's `deleteSource`). | b27e3ba |
| 160 | 2026-11-25 | 40f built and merged | PR #188 as `50fd1a0`. `removeSourceFromProfile` (ingest worker, with `deleteSource`; the query worker was 149.3 of 150 KB), `DataEngine.removeSource`, the row's menu, the confirm naming the favourites, "Add a source" on the TV (`source-add.ts`, `SourceDialogs.tsx`). Unit +101, `e2e/sources-manage.spec.ts` 6, 45/45 affected e2e, mutation 65/65 (4 test gaps closed). Budgets: main 489.6/500, settings.js 149.4/150, query worker 149.3/150, ingest worker 142.4/150. 40h looked at: `keepFilm()` already runs at `hidden` (player-state.ts:1466); its unit test is still to check. | 50fd1a0 |
| 161 | 2026-11-25 | 40h hidden app saves positions | `keepFilm()` already ran at `hidden` (player-state.ts); a movie's save was pinned, an episode's (with the show's key) was not: test added. Mutation (drop `keepFilm()` at `hidden`) killed by 2 tests. Unit 175/175 in the file; no code change. | bdc7794 (PR #189) |
