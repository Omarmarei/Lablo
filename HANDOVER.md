# Zoma IPTV: relay leg 33 opening prompt

You are leg 33 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–31 did steps 1–15c (PRs #1–#30). Leg 6 did no project work.
- **Leg 32** did **step 15c2: S4 and S8 on AVPlay, and S5's luna track route.**
  - Commits: `86ec399` (the work), `0d2ca60` (tests for three mutation survivors), `68bd772` (the RELAY tick). PR **#31** was merged as merge commit **`1b5a75d`**, with the branch kept.
  - CI on `68bd772` was green on the first run: `verify` 8 m 27 s, `engines` 13 m 21 s (of its 25-minute limit), `media` 12 m 7 s.

## Your step: 15d (RELAY.md is the spec)
"The docs (research)": `docs/runbooks/tv-setup.md` and `docs/testing-without-tvs.md`, as listed under step 15, with sources, prices and dates. **Done when:** both docs are complete; PR merged.

1. **Check first** that neither exists: `ls docs/runbooks docs`; `git log --oneline -8`. The lab runbook (`docs/runbooks/lab.md`) already links `docs/runbooks/tv-setup.md` "(step 15d)".
2. **`docs/runbooks/tv-setup.md`** (how to get the lab onto each device):
   - Tizen Studio, the Samsung certificate (author + distributor), and the TV Emulator;
   - the webOS CLI (already a devDependency: `@webos-tools/cli`, `ares-*`), webOS Emulator 4.x and the webOS TV Simulator 22–24;
   - LG Developer Mode: the app, the session timer, how to extend it;
   - how each connects to our tools: `pnpm build:tv --lab`, `pnpm device install|launch <webos|tizen> … --lab`, `pnpm mock` as the lab server (docs/runbooks/lab.md "Quick start").
3. **`docs/testing-without-tvs.md`** (research and compare Samsung real-device options, with cost and coverage):
   - a cheap used Samsung (2018–2020 covers the low tier; 2021+ also enables Samsung Seller Office Beta Test);
   - remote smart-TV device labs (Suitest, TV Labs; check whether Samsung's Remote Test Lab offers TVs);
   - Samsung Beta Test on friends' and family's 2021+ TVs;
   - a recommendation.
4. **Research rules:** use WebSearch/WebFetch. Give every price and claim a source URL and the date you read it (2026-11-0x). Prefer official pages (developer.samsung.com, webostv.developer.lge.com). Say what you couldn't confirm.
5. **Then:** a PR, merged on green CI (docs only: CI still runs all three jobs). No "press these keys" checklist is needed for a docs step.
6. **After 15d:** step 15e (the lab in an emulator) likely needs Omar. Try first whatever needs no install or sign-up. Step 16 is `[needs Omar]`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If the run on `1b5a75d` is red, fix it on the relay branch first. If only `engines` is red with "DevTools … did not answer", rerun it with `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation. Use `git -C`, `pnpm --dir` and absolute paths. Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 15 (the doc list), steps 15d–15e, step 16 (needs Omar), and the progress-log rows for legs 30–32.
3. `docs/runbooks/lab.md` (Quick start, S4, S8, "Where else the lab runs"), `docs/runbooks/tv-build.md`, `docs/runbooks/old-engines.md`.
4. `tools/device` (`pnpm device` wrappers) and `docs/PLAN.md` on the test TVs.
5. Memory: `iptv-dev-toolchain` (no Tizen CLI here; `ares-*` via the devDependency; Smart App Control), `use-write-tool-for-doc-batches`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md on top of `68bd772`. It also records PR #31's merge in RELAY.md. It is pushed, and the tree is clean.
- **main** has `1b5a75d`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (the app and the lab built from the merged sources), `.cache/*` (media included), the `zoma-old-engines:*` images;
  - in `artifacts/`: `mutate15c2.py` (107 mutants) and its log, `verify15c2.log`, `engines15c2.log`, `media15c2.log`, `s4-checks.png`, `s8-checks.png`.

## What step 15c2 built (for reference)
- **platform-tizen `avplay.ts`:** `webapis.avplay` and `webapis.avplaystore` typed (`AvplayManager`, `AvplayListener`, `AvplayStreamInfo`); `tizenAvplay()`, `tizenAvplayStore()`; `avplayTracks()` reads `extra_info` JSON; `avplayErrorText()`; `avplayUnsupported()` (the `PLAYER_ERROR_NOT_SUPPORTED_*` names). Step 19's AvplayEngine should build on it. The app's bundles are byte-for-byte unchanged.
- **The AVPlay `LabPlayer`** (`apps/tv/src/lab/avplay-player.ts`):
  - open, `setListener`, `setDisplayRect`, `prepareAsync`, then `play`; a token per open drops older callbacks;
  - a frame is the clock moving while `PLAYING` (two differing readings 50 ms apart, or two `oncurrentplaytime` calls);
  - a VOD start position: `seekTo` after `play`; the jump is no frame;
  - tracks: `getTotalTrackInfo`, `getCurrentStreamInfo`, `setSelectTrack` (by stream index); cues from `onsubtitlechange`;
  - `suspend`/`restore` (live: no resume time; VOD: the position, never 0); `stop` + `close`;
  - `prepare`/`start`/`readiness` for S8;
  - `mountAvplayStage`: `<object type="application/avplayer">` in the bottom-right box; `<html class="lab--avplay">` makes the page transparent.
- **Reached only in the Tizen build:** `avplay-deps.ts`, called by `spikes/s4.ts` and `spikes/s8.ts` behind `__PLATFORM__ === 'tizen'` inside a function (`guarded.ts` resolves the deps lazily, once). `pnpm build:tv` fails if `application/avplayer` or `getTotalTrackInfo` shows up in a webOS bundle, or `com.webos.media` in a Tizen one.
- **S4** = S5's ten rows on AVPlay + `redirect-probe` (`probeRedirect` in `http.ts`: an XHR aborted at `readyState` 2, `responseURL`), noted against `redirect` ("without the probe it froze").
- **S8:** `store` (two players from `avplaystore`), `prebuffer` (both prepare the live TS at once), `switch` (three switches; ≤ 700 ms on 2020+, `info` before 2020).
- **S5's luna route:** `webosSelectTrack(mediaId, 'audio', index)` in platform-webos (`luna://com.webos.media/selectTrack`); `LabPlayer.audioService()`; the `<video>` player offers it once the element has a `mediaId`. The battery tries it on the file opened again when the engine's own switch fails or is missing; `ac3` uses it without a track list. The record's `route` is `audioTracks`, `luna`, `setSelectTrack` or null.
- **Both batteries play 2 s before the audio switch** (`BATTERY.settleMs`), so a restart shows as the clock going back (AVPlay sends no restart event).
- **Screen:** run order `[S0, S1, S2, S3, S7, S9, S10, S11, S4, S5, S8, S6]`; check rows 60 px. The list ends at 1002 px and S4's eleven checks at 996 px of 1026; `e2e/lab.spec.ts` measures both. Lab main 243.4 → 260.7 KB (Tizen), 251.8 KB (webOS).
- **Off a TV** every S4/S8 row skips: "no webapis.avplay here (a Samsung TV has it)" in the Tizen bundle, "no AVPlay: this is not the Tizen build" elsewhere (S8: "avplaystore" wording).
- **Test doubles:** `apps/tv/src/lab/fakes.ts` (`FakeClock` with interval timers, `FakeAvplay`, `fakeAvplayStage`, `LAB_MEDIA_FIXTURE`), imported only by tests.

## Gotchas and lessons
**New in leg 32** (also in memory: `iptv-zoma-lab-gotchas`, `iptv-parser-test-patterns`, `use-write-tool-for-doc-batches`):
- **Vitest has no `__PLATFORM__` define.** A module that reads it at import throws in any test that imports it. Keep platform branches inside functions that run later (`platformDeps()` in s4/s8, `platformSelectTrack()` in s5).
- **The lab screen is full:** 12 spike rows and 11 checks per spike. A 13th spike or a 12th check needs a layout change (paging or shorter rows), and the e2e height check will fail first.
- **A fake that changes state and calls back in the same instant hides the window between them.** The AVPlay fake's seek once jumped and called back in one tick, and a mutant that counted the jump as a frame survived. The fake now jumps at +100 ms and calls back at +200 ms.
- **The runner's `CheckOutcome.ms` is wall-clock time**, not the fake clock. To assert that a check ended early, take `clock.t` in `runSpikes`'s `onStart` and again in `onOutcome`.
- **Heredocs with quotes broke again** (an apostrophe inside a single-quoted TS string; Python dropped a backslash). Writing a test block to a scratch file with the Write tool, then `cat >>`, worked every time.
- **A foreground Bash wait over 600 s is moved to the background** by the tool. The Monitor (leg 14's command from memory `bg-watcher-memory-reap`, copied verbatim) worked first time again.

**From earlier legs (still true):**
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one;
  - use exact float boundaries;
  - a guard that never fires in the browser needs a pure verdict;
  - fake-clock polling grid: pick test times on the 50 ms grid;
  - a reset at the start of a run only shows in a run that fails after a good one.
- **Mutation runs:**
  - never commit or build while one is going: it edits sources in place;
  - run mutation scripts with `python -I -u`;
  - read the log's own exit line, not a `; echo exit $?` after it.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the whole self-test or the CI job.
- **Playwright's Chromium (CfT 156):** HLS, H.264, MKV and 302s; no MPEG-TS, AC3/E-AC3 or in-band text; HEVC only headed; `audioTracks` needs the Blink flag `AudioVideoTracks`.
- **The lab under `pnpm dev` shares the dev app's origin:** use `pnpm --filter @zoma/app-tv exec vite --port 5174` for a manual lab run next to dev data.
- **`e2e/lab.spec.ts` and `lab-media.spec.ts` declare their own `interface Record`:** use index signatures there. The harness test parses `DESKTOP` and `BUNDLE` from `e2e/lab.spec.ts`.
- **Polyfills:** Babel picks core-js polyfills by property name. Probe each new file that reaches the app's main bundle. Lab-only code is free of the app's budget.
- **Text:** the Write tool turns `\uXXXX` escapes into raw characters; text arguments carry isolate marks (compare with `stripIsolates`).
- **Code rules:** components stay hook-free; CSS uses physical properties only (no grid or flex `gap` on Chromium 53); TV code is `lib: ES2017`.
- **Old-engine harness:** never edit the Docker image's `RUN apt-get` line; it starts the mock with `--no-media`.
- **Dependencies:** new ones must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge with `gh pr merge --merge` on green CI and keep the branch;
  - check that the run's `headSha` is the PR's head first.
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #31
1. **`pnpm build:tv` has three new leak markers** (`application/avplayer`, `getTotalTrackInfo` for webOS; `com.webos.media` for Tizen). If an app screen ever mentions one of those strings, the build fails until the `__PLATFORM__` branch is fixed.
2. **The battery's audio row changed for both TVs:** it plays 2 s before switching, and on webOS falls back to luna `selectTrack` on the file opened again. A luna answer is accepted on "returnValue true and playback moved on"; whether the language really changed is for the ear (step 16).
3. **The AVPlay page treatment:** while S4/S8 play, `<html>` gets `lab--avplay` and the page background is transparent. Only seen in desktop screenshots, never on a Samsung; if a TV shows black instead of the picture, the `<object>` or the hole is wrong.

## Verified vs not
- **Verified:**
  - `pnpm verify`: 2,401 tests in 141 files, e2e 51/51;
  - `pnpm verify:engines --self-test`: 102 runs as expected on the first try; S4 and S8 skip on 53/56/68 (70 records per lab run);
  - `pnpm verify:media`: `lab:media` 2/2, now asserting `route: 'audioTracks'` and no `mediaId` on the desktop;
  - 107/107 mutants caught;
  - screenshots looked at (`artifacts/s4-checks.png`): the twelve spike rows and S4's eleven checks fit;
  - CI on PR #31 green on the first run.
- **Not done:**
  - S4 and S8 on a real Samsung: whether AVPlay's clock moves for live TS, which `restore` arguments a TV takes, whether `avplaystore` players share the video plane, and whether the transparent hole shows the picture;
  - S5's luna route on a real webOS TV;
  - the docs (15d), emulators (15e), any TV (16).
- **Migrations and deploys:** N/A (no backend until step 29).
- **"Press these keys" checklist for 15c2 (desktop):**
  1. Run `pnpm mock` and `pnpm dev`. Open `http://localhost:5173/lab.html?server=http://127.0.0.1:8080&auto=0` at 1920x1080.
  2. Press OK on "Run all". When it ends, press ArrowDown 9 times to S4: its eleven checks show SKIP with "no AVPlay: this is not the Tizen build", and the last row is fully visible.
  3. Press ArrowDown twice to S8: three SKIP rows with "no avplaystore: this is not the Tizen build".
  4. On a Samsung TV (step 16): runbook lab.md "S4 by hand"; on an LG: "S5 by hand" (listen for the language change during `audio-tracks`).

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended: it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Later, once the spikes have run on a TV:** an on-screen keyboard of our own if the TV keyboards fail; a mapping for webOS's PRE-CH key; the app's accessibility route; `supportsAudioGuidance` in the app's appinfo.json; the MSE engine if webOS's native HLS has gaps (S5); pre-buffered zapping only if S8 passes. These are product decisions for when the answers exist; nothing is blocking now.
- **Step 15e** (the lab in an emulator) likely needs Omar: VirtualBox, Tizen Studio, a Samsung account. Try the webOS TV Simulator first.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47; before the first store submission, the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs; leg 32 was the 32nd.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Thirteen CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: onboarding or the live screen, `?screen=hello|gallery`, `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk, the focus agreement, the lab runs (102 runs, 74 seeds);
  6. a Conventions line on UI text (`appI18n`, `zoma/no-hard-coded-text`, `isolateText`, `TextField`/`createTextEditor`);
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__`, the `throttled` project;
  8. the `build:tv` row's lab target, `pnpm device … --lab`, and the platform-globals line (`PalmServiceBridge` is webOS-adapter only);
  9. a `pnpm lab:scale` row, and the mock row's `/__lab/source` and `/__lab/guide.xml.gz`;
  10. the `Platform` calls from step 15b2 (`setScreenSaver`, `screenReader`, `speak`) and where each adapter gets them;
  11. `Platform.registerKeys()` returns a `KeyRegistration` (Tizen `registerTizenKeys` in `keys.ts`);
  12. a `pnpm lab:media` row (S5 on the generated media, in `verify:media`), the `verify:media` row now ending with it, and the mock row's `/__lab/media`;
  13. **new:** platform-tizen's AVPlay typing (`avplay.ts`) and platform-webos's `webosSelectTrack`, the `build:tv` row's new leak markers, and the lab's test doubles in `apps/tv/src/lab/fakes.ts`.
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
