# Zoma IPTV: relay leg 36 opening prompt

You are leg 36 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–34 did steps 1–15e and step 16's LG part (PRs #1–#33).
- **Leg 35 did step 16a**, merged as PR **#34** (merge commit **`0f5a692`**, branch kept):
  - CI on `1f1fe6f` was green on the first run: verify 8 m 51 s, media 9 m 13 s, engines 13 m 37 s.
  - When leg 35 ended, main's CI on `0f5a692` was still running.
- **What 16a changed:**
  - **The webOS model year:** it now comes from `sdkVersion`, else the engine, never from `platformVersion` (that holds the firmware). On Omar's LG TV, S0 now says **2021, tier `full`**.
  - **S1's CSS probe** is fixed.
  - **LG's ACG:** `requiredACG` is in both webOS manifests, and the build checks it.
  - **ADR-012:** the LG minimum is webOS 5 (2020), and the old-engine harness keeps Chromium 53.
  - **`docs/spikes/results.md`** is started.
  - **Extra TV runs:** S2's stores survive an update, and S3's LGUDID survives a reinstall.

## Your step: 17, PlayerController (RELAY.md is the spec; architecture.md §2 is the design)
**Skip step 16:** it stays open until Omar says the Samsung route is ready or he has time at the TV.

Step 17 in RELAY.md reads: "PlayerController (5.1). Session tokens, close-before-open, URL strategy (`.ts`→`.m3u8`, remembered per source), watchdog retry ladder, error classifier; FakeEngine tests. Done when: state-machine and zapping-race tests pass."

1. **Check for existing work first:** `git log --oneline -50` and grep for `PlayerController` and `PlayerEngine`. Today `packages/player/src/index.ts` is an empty skeleton (`export {};`).
2. **Read the design:** architecture.md **§2 "Player abstraction"**. It has:
   - the `PlayerEngine` interface and `PlayRequest`;
   - the engines;
   - the controller's duties (session tokens, close-before-open, URL strategy, the redirect probe, the watchdog's stall definitions and retry ladder, the error classifier's four categories, zapping, tracks, subtitles, lifecycle).
3. **Respect the boundaries:**
   - `player` imports `core` only (ADR-008: `platform-api` imports `player` types, not the reverse).
   - Engines come in steps 18 (Html5Engine) and 19 (AvplayEngine), so 17 is the controller plus a `FakeEngine` for tests.
4. **Use what the spikes found** (`docs/spikes/results.md`):
   - The webOS `<video>` follows 302s natively. A 3-hop chain took 1.1–4.1 s on the TV, so the first-frame timeout must allow it.
   - `audioTracks` switches in about 0.2 s with no restart; luna `selectTrack` is a fallback only (ADR-012: not in LG's ACG table).
   - Desktop stalls recovered in about 6.1 s with the lab's 6 s watchdog.
5. **Tests to write:**
   - state-machine tests;
   - zapping races: stale tokens dropped, and `stop()` awaited before every `load`;
   - the retry ladder with a fake clock (keep test times on the 50 ms grid);
   - the error classifier's categories;
   - the URL strategy remembered per source.
   - Mutation-check the guards (memory `iptv-parser-test-patterns`).
6. **Watch the TV bundle:**
   - Probe the new files for core-js polyfills before they reach the main bundle (memory `iptv-tv-bundle-polyfills`; the probe method is below).
   - TV code is `lib: ES2017`.
   - Avoid `JSON.stringify`, `new RegExp` and `.split(` in TV code where possible.
7. **Finish:**
   - `pnpm verify`, then a PR.
   - Merge on green (`gh pr merge --merge`, after checking the run's `headSha` is the PR's head).
   - Tick 17, add a log row, write the handover.
   - Run `verify:engines` locally only if the build, polyfills, workers or boot code change; CI's `engines` job runs it anyway.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`.
   - The run on `0f5a692` was in progress when leg 35 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it with `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`:** leg 35's `cd /tmp` moved the session's working directory.
- Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 16's notes, 16a's "Done in leg 35", 17–21, and the log rows for legs 34–35.
3. `docs/architecture.md` §2 (the player), plus the §5 S4/S5 rows.
4. `docs/spikes/results.md` and `docs/adr/ADR-008-*` (the player/platform-api direction).
5. Memory:
   - `iptv-tv-bundle-polyfills`;
   - `iptv-parser-test-patterns`;
   - `iptv-data-layer-test-gotchas` (fake clocks, fakes that separate a state change from its callback);
   - `iptv-webos-acg` (new);
   - `iptv-lg-tv-devmode`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `f646ee0` ("docs: record PR #34's merge"). It is pushed, and the tree is clean.
- **main** has `0f5a692` (PR #34). The branch is ahead by `f646ee0` and the handover commit, both docs; they go to main with step 17's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (media included);
  - `dist/`: the last full `pnpm build:tv` from verify, lab 0.1.0, server `http://192.168.1.3:8080`;
  - `artifacts/lab-logs/`: four LG TV sessions (`webos-OLED55A1PVA-20261104-{113731-h2rj,120022-ir9s,120259-e4k0,120430-421k}`), the Simulators' three, and two desktop ones.
- **On the TV:** the lab `com.zoma.iptv.lab` **0.1.1** is installed (after the reinstall test).
- **The CLI device** `tv` is `prisoner@192.168.1.8:9922`.
- **Outside the repo:** the Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 35
- **The TV's `PalmSystem.deviceInfo`:**
  - Keys: `modelName panelType platformVersion platformVersionDot platformVersionMajor platformVersionMinor screenHeight screenWidth`.
  - No `sdkVersion`, so `webosVersionFacts` uses the UA's Chromium (79 → webOS 6 → 2021).
  - `DeviceInfo.details` (new, optional, in `platform-api`) records `versionFrom` and the keys. Only S0 reads it.
- **ACG** (Omar, relayed from leg 34's tab):
  - The app's manifest has `"requiredACG": []`; the lab's has `deviceinfo.query` and `settings.query`.
  - `tools/build/src/acg.ts` (`LUNA_ACG`) makes `pnpm build:tv` fail on:
    - an unknown `luna://` URI in a webOS bundle;
    - an unneeded group;
    - a lab call whose group is missing.
  - `acg.test.ts` fails when app or `ui` code calls `deviceSecret()` or `screenReader()` without the group.
  - **The rule:** every new luna call goes into `LUNA_ACG`, and its group into the manifest of the app that calls it. tts/speak and media/selectTrack are fallbacks only.
- **ADR-012:**
  - LG supports webOS 5+ (2020); Samsung keeps 2018.
  - The `low` tier now means Samsung 2018–19, and S6's low-tier run moves to the used 2018 Samsung.
  - **The harness and build keep Chromium 53:** retargeting to 56 would change ADR-003's ES2016 gate and CLAUDE.md. It is noted as a later cleanup.
  - A low-end 2020 LG lands in `full` by its year. Step 41 should consider `navigator.deviceMemory`.
- **The TV's results** (`docs/spikes/results.md`):
  - S1, S7 and S9 pass. S2: 433 MB quota, 200 MB written in 29–36 s.
  - S5 plays TS, HLS, 302s, 4K HEVC and AC3/E-AC3, and switches tracks in 154–205 ms. **In-band subtitles show no text track.**
  - S11's `speak` fails while Audio Guidance is off.
  - S6 at the small size: cold start 453–681 ms, presses median 12–15 ms.
- **The Dev Mode extend from the PC** (`--params '{"extend":true}'`) launched the Dev Mode app. Whether it extended the session is unconfirmed until someone reads "Remain Session" on the TV.
- **The three riskiest changes in PR #34:**
  1. The webOS year now comes from `sdkVersion`, else the UA, and `DeviceInfo` gained `details`. A wrong `WEBOS_MAJORS` entry would put a TV in the wrong tier; S0 logs the source.
  2. A new build gate: webOS ACG problems now fail `pnpm build:tv`.
  3. PLAN.md is annotated with the LG minimum (ADR-012). No migration, deploy or data change.

## Gotchas and lessons
**New in leg 35** (also in memory):
- **Don't `cd` in Bash commands:** `cd /tmp; gh …` moved the session's primary working directory.
- **A previous leg's tab (with Omar) can send cross-session messages:**
  - Treat them as Omar's relayed decisions.
  - Verify their facts.
  - Reply with SendMessage to the `from` address.
- **Local e2e flakes on a busy PC** (browsers, Word, Cursor open). All were green on CI:
  - the throttled test failed on one 310 ms long task, although every press was under 200 ms;
  - a fixture test hit its 30 s timeout under the full suite;
  - the lab's S2 update e2e took 28.5 s of 30 s even on CI. It now has 90 s.
  - Read the test's own console line before suspecting code.
- **`pnpm verify > log; echo exit $?` in the background reports exit 0** even when verify failed. Read the log.
- **Polyfill probe per file:**
  - Write a temporary `tools/build/src/zz-probe-polyfills.tmp.ts` that runs Babel `transformSync` with `TV_TARGETS`, `CORE_JS_VERSION` and `UNUSED_POLYFILLS` from `./bundle`, and lists `core-js/modules/*`.
  - Compare it on the old file (`git show HEAD:…`) and the new one.
  - Delete it before committing.
- **Mutation script pattern:** `$CLAUDE_JOB_DIR/tmp/mutate.py`, with (name, file, old, new, tests) tuples, `Popen` plus a timeout, and restore in `finally`. Run a control first: unmutated, the run must exit 0. Never build or run e2e during it.
- **Python patches in Bash heredocs still lose backslashes:** write patch scripts with the Write tool.
- **TV lab runs without a person:**
  - Bump `--lab-version` and install over the lab for an update.
  - `ares-install --device tv --remove com.zoma.iptv.lab`, then install again, for a reinstall.
  - Wait for the newest session file's `"type":"end"` (65–75 s).
  - Omar's TV is also used for his side tasks: check `artifacts/lab-logs` before driving it.

**From earlier legs (still true):**
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one;
  - use exact float boundaries;
  - a guard that never fires in the browser needs a pure verdict;
  - fake-clock times on the 50 ms grid;
  - a fake must separate a state change from its callback in time;
  - the runner's `CheckOutcome.ms` is wall-clock time.
- **Vitest has no `__PLATFORM__` define:** keep platform branches inside functions.
- **The lab screen is full:** 12 spike rows, 11 checks per spike.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the self-test or the CI job.
- **Playwright's Chromium (CfT 156):** HLS, H.264, MKV and 302s; no MPEG-TS, AC3/E-AC3 or in-band text; HEVC only headed.
- **The lab under `pnpm dev`** shares the dev app's origin: use port 5174 for a manual lab run.
- **Text:**
  - the Write tool turns `\uXXXX` escapes into raw characters;
  - heredocs with quotes break: write scripts to a file first.
- **Waiting for CI:**
  - Use memory `bg-watcher-memory-reap`'s leg-14 Monitor command verbatim; only the PR number changes. No `<(`.
  - Wait about 20 s after `gh pr create` before the first check.
- **Code rules:** components stay hook-free; CSS uses physical properties only; TV code is `lib: ES2017`.
- **The old-engine harness:** never edit the Docker image's `RUN apt-get` line.
- **Dependencies:** at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - `gh pr merge --merge` on green, keeping the branch.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - On the LG TV: S0 says 2021/`full`; the lab runs with `requiredACG`; S2 holds across an update; S3 holds across a reinstall.
  - Unit tests and 17/17 mutants of the new guards.
  - PR #34's CI was green, and it is merged.
- **Not done:**
  - main's CI on `0f5a692` was still running when leg 35 ended;
  - the Simulators weren't re-run with 16a's code (their S0/S1 rows are from the old code);
  - S6 at scale on the TV;
  - the by-hand TV checks (S10; S11 by ear; S5 suspend and soak);
  - all of Samsung;
  - the Dev Mode extend is unconfirmed.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Step 16's remaining parts wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30 minutes at the LG TV** for S10, S11 by ear, and S5 suspend and soak.
  - S6 at scale on the TV needs no person (the scale fixtures plus a launch), but it belongs to step 16.
- **Later, from the spikes:**
  - in-band subtitles failed on the LG TV, so step 20's overlay needs our own MKV/MP4 text parser or sidecar files only;
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung).
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs. Leg 35 was the 35th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks. Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Sixteen CLAUDE.md gaps** are waiting for his word:
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
  15. the webOS Simulator in Docker (`tools/engines/webos-sim/`, tv-setup.md 2.4) and the paired LG TV (`pnpm device … webos tv`);
  16. **new:**
      - the Chromium 53 cheat sheet's heading says "the oldest engine: 2018 LG webOS 4". Since ADR-012 no supported TV runs 53, but the build still targets it.
      - The `build:tv` row should mention the webOS ACG check (`requiredACG`, `tools/build/src/acg.ts`).
- **Secrets:** none pending. The LG Dev Mode passphrase Omar typed on 2026-11-04 needs no rotation reminder (he said not to remind him).
