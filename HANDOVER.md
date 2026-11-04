# Zoma IPTV: relay leg 35 opening prompt

You are leg 35 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–33 did steps 1–15d (PRs #1–#32). Leg 6 did no project work.
- **Leg 34** (with Omar in the tab for most of it):
  - **Step 15e:** the lab in LG's webOS TV Simulator.
    - Smart App Control blocks the Simulator's Windows build, so its Linux AppImage runs in Docker (`tools/engines/webos-sim/`).
    - Simulator 6.0 (Chromium 79) and 24 (Chromium 108) ran every spike, and every record reached the collector.
    - PR **#33**, merged as **`d580643`** (branch kept). CI on `277307f` was green on the first run: verify 8 m, media 12 m, engines 13 m.
    - Steps 15e and 15 are ticked.
  - **Omar's decisions** (commit `bb86d9c`):
    - Samsung: the Remote Test Lab now, plus one used 2018 set;
    - the RTL lab server: a tunnel from this PC during a session;
    - Arabic digits: Western everywhere (ADR-011 updated);
    - **the LG minimum is raised to 2020 (webOS 5+)** (RELAY.md step 16, not written up yet).
  - **Step 16, LG part:** Omar's LG TV is paired from this PC and ran the whole lab (commit `9d4cd4f`).
    - That run found a bug: the webOS model year is read from the firmware number.
    - Leg 34 added **step 16a** to fix it.
    - Omar set the order: 16a, then step 17 onward, while the rest of 16 waits for him.
  - Main's CI was green on PR #32's merge (`f232657`) and on PR #33's (`d580643`, 13 m 43 s).

## Your step: 16a (RELAY.md is the spec)
"The webOS model year, the LG minimum, and the first results." **Skip step 16 itself:** it stays open until Omar says the Samsung route is ready or he has time at the TV. In order:

1. **The bug.**
   - `packages/platform-webos/src/index.ts` `readDeviceInfo()` sets `osVersion` from `PalmSystem.deviceInfo.platformVersion`.
   - On the TV that is the firmware, `03.53.45`. `webosModelYear()` (`src/device.ts`, `WEBOS_MAJORS`) reads major 3, minor ≥ 5 as 2017, so `deviceTier()` (`packages/core/src/device.ts`, full from 2020) gives `low`.
   - LG's webOSTV.js reference (https://webostv.developer.lge.com/develop/references/webostvjs-webos#deviceinfo) says `version` is the TV's software version and `sdkVersion` is "the webOS TV SDK version". `ares-device --system-info` on the TV prints `sdkVersion : 6.5.3`, `firmwareVersion : 03.53.45`.
   - The Simulators reported `02.00.94` (6.0) and `02.11.66` (24): firmware-like too, and `modelYear` came out null.
2. **The fix:**
   - Make `parsePalmDeviceInfo` keep `sdkVersion` (and whatever version keys the raw string really has).
   - Take the year from `sdkVersion`.
   - Fall back to the user agent's Chromium major when it's missing: 68 → webOS 5 → 2020, 79 → 6 → 2021, 87 → 2022, 94 → 2023, 108 → 2024, 120 → 2025.
   - Keep `firmware` as the firmware.
   - Make S0 record the raw `deviceInfo` keys, so the next TV run shows what is there.
   - Unit tests in `packages/platform-webos/src/index.test.ts` (or a new `device.test.ts`): `sdkVersion` present, absent with a Chromium UA, both absent, and the 03.53.45 case that must no longer give 2017.
   - Platform adapter code reaches the app's main bundle, so probe it for core-js polyfills (memory `iptv-tv-bundle-polyfills`). Keep the main bundle's size steady.
3. **The ADR:** the next number is **ADR-012**, "LG minimum webOS 5 (2020)". Omar decided it in leg 34. Samsung keeps 2018 (Tizen 4, Chromium 56). Update:
   - `architecture.md` (support matrix, tiers);
   - tv-setup.md "At a glance" and section 4;
   - `docs/testing-without-tvs.md` where it mentions LG 2018;
   - the build's webOS notes;
   - RELAY.md's later steps (store listing minimum, step 45).
   - **Decide and record:** does the old-engine harness keep Chromium 53? It was LG webOS 4's engine. Samsung 2018's is 56. Dropping 53 changes `verify:engines`, CI time and the ES/bundle targets. If the trade-off isn't clear-cut, keep 53 and note it as a later cleanup.
4. **`docs/spikes/results.md`:** a row per spike per device, from `artifacts/lab-logs/` (gitignored, still in the worktree): the LG TV, Simulator 6.0 and 24. Add the desktop and the Docker 53/56/68 rows if cheap. Mark what is still to run (step 16's list).
5. **Re-run on the TV:**
   - Extend Developer Mode first:

     ```bash
     pnpm --filter @zoma/tools-device exec ares-launch --device tv com.palmdts.devmode --params "extend=true"
     ```

     That command is forum-sourced; note whether it works.
   - Then `pnpm mock` (background), `pnpm build:tv --platform webos --target lab --lab-server http://192.168.1.3:8080`, `pnpm device install webos tv --lab`, `pnpm device launch webos tv --lab`.
   - The TV must be on. If it doesn't answer (`ares-device --system-info --device tv`), leave this check for Omar and say so.
   - S0 must say 2021 and `full`. The run takes about 75 s; wait for the `end` record.
6. **Finish:** verify (`pnpm verify`; `verify:engines` if the harness changed), then a PR, merge on green, tick 16a, a log row, the handover.

Then **step 17** (PlayerController) is next.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`.
   - The run on `d580643` was green when leg 34 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it with `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation. Use `git -C`, `pnpm --dir` and absolute paths. Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 16 (its leg-34 notes), **16a**, 17, and the log rows for legs 33–34.
3. `docs/runbooks/tv-setup.md` 2.2 (the LG TV, now with our TV's facts) and 2.4 (the Simulator in Docker, with results).
4. `docs/adr/ADR-011-*` (as a template) and `docs/architecture.md`'s support matrix.
5. Memory:
   - `iptv-webos-simulator-docker` (new);
   - `iptv-lg-tv-devmode` (new);
   - `iptv-dev-toolchain`;
   - `iptv-tv-bundle-polyfills`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `9d4cd4f`. It is pushed, and the tree is clean.
- **main** has `d580643` (PR #33). The branch is ahead by `bb86d9c`, `9d4cd4f` and the handover commit, all docs; they go to main with 16a's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (media included);
  - `dist/`: the webOS lab was last built for `http://192.168.1.3:8080`, rebuild for your target;
  - `artifacts/lab-logs/`: the sessions `webos-OLED55A1PVA-20261104-113731-h2rj`, `webos-WEBOS6.0_SIMULATOR-*` (two) and `webos-WEBOS24_SIMULATOR-20261104-085511-qtsi`.
- **Outside the repo** (never commit; LG's license forbids redistribution):
  - `D:/tools/webos-sim/`: the Windows zips (SAC-blocked);
  - `D:/tools/webos-sim/linux/`: the 6.0 and 24 AppImages.
- **Docker image:** `zoma-webos-sim:local` (local only, never push).
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.0 is installed.
- **The CLI:** device `tv` = `prisoner@192.168.1.8:9922`, key `%USERPROFILE%\.ssh\tv_webos`.

## Facts from leg 34
- **The LG TV** (`OLED55A1PVA`):
  - the 2021 A1 OLED, webOS 6, Chromium 79, 2 GB, 4 cores, 1920×1080 at DPR 2;
  - locale en-GB, time zone Africa/Cairo.
  - Developer Mode is signed in with an email+password LG account. Google sign-in is refused: the Dev Mode app takes "your email-based ID", and a Google-made account shows a 21-digit user ID.
- **The TV's first lab run** (at launch, 75 s): 70 records; 26 pass, 2 fail, 19 info, 21 skip.
  - **S1:** 10/10; the bulk write of 10,000 items takes 4.8 s; the Blob worker answers in 428 ms.
  - **S2:** a 433 MB quota; 200 MB in 36 s.
  - **S3:** the LGUDID answers. **S7:** 6/6.
  - **S9:** 4/4. `Intl`: ar-SA Hijri with Arabic-Indic digits, ar-AE Arabic-Indic. The app uses Western, per ADR-011.
  - **S5 plays:**
    - TS 1.8 s, HLS 1.7 s, the 3 × 302 chain 1.1 s, 4K HEVC 1.6 s;
    - 5/5 audio tracks listed, the switch 154 ms;
    - AC3 and E-AC3 play.
  - **The two fails:** S5's in-band subtitles (no text track), and S11's `speech` ("Audio Guidance is off (8101)": the TTS service exists).
  - **S6** (the small catalog): cold start 681 ms (boot 323 ms); presses: median 14 ms, slowest 158 ms.
- **The Simulators** (tv-setup.md 2.4): 6.0 and 24 gave 20 pass, 7 fail, 19 info, 22 skip each.
  - S11's TTS service is missing there.
  - S5 comes from Electron's media stack: ignore it.
  - The LGUDID changes with each fresh container.

## Gotchas and lessons
**New in leg 34** (also in memory `iptv-webos-simulator-docker`, `iptv-lg-tv-devmode`, `iptv-dev-toolchain`):
- **Smart App Control blocks unsigned vendor `.exe`s** (the webOS Simulator: Code Integrity events 3033/3077, a silent exit 1 or 126). Check those events after any silent exit.
  - Omar approved the Docker route **for the Simulator only**.
  - Running any other SAC-blocked tool another way is his call: ask first.
- **LG's SDK downloads need no browser:** two POSTs, and `gftsUrl` is an XML **attribute** (tv-setup.md 2.4). Downloading accepts LG's license, which Omar accepted.
- **The AppImage in Docker:**
  - extract it with `--appimage-extract`;
  - run the `webos-tv-*-simulator` binary directly: `AppRun` breaks on an absolute app path;
  - pass `--no-sandbox`;
  - prefix `docker run` with `MSYS_NO_PATHCONV=1` in Git Bash, and use `pwd -W` for `D:/…` paths.
- **Windows `ares-launch -s`** `exec`s the simulator as a child: it dies when the Bash command returns.
- **Pairing a TV without a prompt:** `ares-novacom --device tv --getkey --passphrase <code>`. Find a TV's IP by scanning the /24 for ports 9922 and 9991 (a short Python socket script).
- **`PalmSystem.deviceInfo.platformVersion` is the firmware on webOS 6:** use `sdkVersion`. Check the other webOS facts against a real TV too.
- **GitHub push** answered "Internal Server Error", then "failure", while githubstatus showed all systems operational. The fourth try worked. Retry before suspecting the commit.
- **Ask Omar for decisions with AskUserQuestion when he is in the tab.** He answered four in one go.

**From earlier legs (still true):**
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one;
  - use exact float boundaries;
  - a guard that never fires in the browser needs a pure verdict;
  - fake-clock polling grid: pick test times on the 50 ms grid;
  - a fake must separate a state change from its callback in time;
  - the runner's `CheckOutcome.ms` is wall-clock time.
- **Vitest has no `__PLATFORM__` define:** keep platform branches inside functions.
- **The lab screen is full:** 12 spike rows and 11 checks per spike.
- **Mutation runs:** never commit or build during one; run with `python -I -u`; read the log's exit line.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the self-test or the CI job.
- **Playwright's Chromium (CfT 156):** HLS, H.264, MKV and 302s; no MPEG-TS, AC3/E-AC3 or in-band text; HEVC only headed.
- **The lab under `pnpm dev` shares the dev app's origin:** use port 5174 for a manual lab run.
- **Polyfills:** Babel picks core-js polyfills by property name. Probe each new file that reaches the app's main bundle.
- **Text:**
  - the Write tool turns `\uXXXX` escapes into raw characters;
  - heredocs with quotes break: write scripts to a file first.
- **Waiting for CI:** use the Monitor command from memory `bg-watcher-memory-reap` (leg 14's, verbatim; only the PR number changes; no `<(`).
- **Code rules:** components stay hook-free; CSS uses physical properties only; TV code is `lib: ES2017`.
- **Old-engine harness:** never edit the Docker image's `RUN apt-get` line.
- **Dependencies:** ≥ 2 weeks old, transitive ones included. Never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - `gh pr merge --merge` on green CI, keeping the branch;
  - check that the run's `headSha` is the PR's head first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## The 3 riskiest changes in PR #33 (merged)
1. **`tools/engines/webos-sim/` runs LG's unsigned Linux binary in Docker.** Omar approved it. The image must stay local (the license).
2. **tv-setup.md 2.4 documents a scripted download of LG's SDK.** It depends on LG's page internals (`/api/downloadSDK`, `DownloadFilePath.ajax`), which can change.
3. **The Simulator results:** its S5 answers come from Electron's media stack, not webOS's. The docs say so. Don't let a later step read them as TV results.

## Verified vs not
- **Verified:**
  - the lab in Simulator 6.0 (twice, the second time from the committed files) and in 24;
  - the lab on the real LG TV (one run at launch);
  - PR #33's CI green;
  - main's CI green on `f232657`;
  - the TV's pairing (`ares-device --system-info`).
- **Not done:**
  - the model-year fix (16a);
  - the by-hand TV checks: S10 keys, pointer and keyboard; S11 by ear; S5's suspend and soak; S2 across an update; S3 across a reinstall;
  - all of Samsung;
  - `docs/spikes/results.md`.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Step 16's remaining parts wait for Omar:**
  - **Samsung:** a Samsung account and the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set (he buys it).
  - **The LG TV, by hand:** half an hour at the TV for S10, S11, S5 suspend/soak, S2 update and S3 reinstall (lab.md's "by hand" sections).
- **ADR-012's open point:** whether the harness keeps Chromium 53 (see 16a).
- **Later, once the spikes have run on more TVs:**
  - an on-screen keyboard of our own if the TV keyboards fail;
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on: S11);
  - `supportsAudioGuidance`;
  - the MSE engine (the LG TV's native HLS played);
  - pre-buffered zapping (S8);
  - `requiredACG`;
  - in-band subtitles failed on the LG TV: step 20's subtitle overlay needs our own parser for MKV/MP4 text, or sidecar files.
- **Later gates:** steps 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs. Leg 34 was the 34th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks. Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifteen CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: onboarding or the live screen, `?screen=hello|gallery`, `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk, the focus agreement, the lab runs;
  6. a Conventions line on UI text (`appI18n`, `zoma/no-hard-coded-text`, `isolateText`, `TextField`/`createTextEditor`);
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__`, the `throttled` project;
  8. the `build:tv` row's lab target, `pnpm device … --lab`, and the platform-globals line;
  9. a `pnpm lab:scale` row, and the mock row's `/__lab/source` and `/__lab/guide.xml.gz`;
  10. the `Platform` calls from step 15b2 (`setScreenSaver`, `screenReader`, `speak`);
  11. `Platform.registerKeys()` returns a `KeyRegistration`;
  12. a `pnpm lab:media` row, and the mock row's `/__lab/media`;
  13. platform-tizen's AVPlay typing, platform-webos's `webosSelectTrack`, the new leak markers, `apps/tv/src/lab/fakes.ts`;
  14. the `pnpm device` row and the `.wgt` note should point at `docs/runbooks/tv-setup.md`;
  15. **new:** the webOS Simulator in Docker (`tools/engines/webos-sim/`, tv-setup.md 2.4) and the paired LG TV (`pnpm device … webos tv`).
- **Resolved in leg 34:**
  - the LG TV's model was shared (OLED55A1PVA, 2021);
  - the Arabic digits question is decided (Western).
- **Secrets:** Omar typed the LG Developer Mode key-server passphrase in chat on 2026-11-04 and said not to remind him to rotate it. Don't. It is a temporary pairing code the TV regenerates. It is in the CLI's device config, not in the repo.
