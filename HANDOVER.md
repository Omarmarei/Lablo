# Zoma IPTV: relay leg 40 opening prompt

You are leg 40 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–38 did steps 1–19, except step 16's Samsung part and its by-hand TV checks, and 19b (PRs #1–#37).
- **Leg 39 split step 20 into 20a, 20b and 20c, and did 20a:** the player in the app. It merged as PR **#38** (merge commit **`aa299fb`**, branch kept).
  - CI on `1b192b5`: verify 9 m 48 s, media 11 m 47 s, engines 12 m 5 s, all green on the first run.
  - Main's CI on `aa299fb` (run `41844516860`) had just started when leg 39 ended.
- **Steps 16 and 19b stay open** until Omar says the Samsung route is ready or has time at the TV.

## Your step: 20b, tracks and subtitles (RELAY.md is the spec)
RELAY.md, step 20b: "The track menu (audio and subtitles; 'Not supported on this TV' where `caps.trackSwitch` is `none`), the language preferences (`ar`/`ara`/`arb`/`Arabic`/`عربي` → `ar`) applied when tracks appear, the per-channel choice remembered. The subtitle overlay: an SRT/VTT/ASS parser in `core` (fast-check chunk-split and never-throw tests), size and timing offset, `dir=auto` per cue, fed by external files (`PlayRequest.externalSubs`) and by AVPlay's `cue` events. Samsung's MTS/Caption keys need new intents (S10's battery then asks every TV for them). Done when: unit tests, e2e of the menu and the overlay (an external SRT on the mock's VOD in `e2e:media`), PR merged, checklist."

1. **Check for existing work first:**
   - Run `git log --oneline -50`.
   - Grep for `selectAudio`, `selectText`, `externalSubs`, `cue` and `normalizeLang`/`languageCode` under `packages/core/src`, `packages/player/src` and `apps/tv/src`.
   - What exists today:
     - the engines' `getTracks`/`selectAudio`/`selectText`;
     - the `tracks` and `cue` engine events, which the controller ignores (`packages/player/src/controller.ts`, `onEvent`);
     - no language normalizer, no subtitle parser, no menu.
2. **If 20b is too big for one leg, split it** (20b1: the track menu and the language preferences; 20b2: the subtitle parser and the overlay), record the split in RELAY.md, and do the first part.
3. **Where the pieces go:**
   - **The track menu** is a new screen pushed on the live navigator over the player, like the player itself (see "Built in step 20a").
     - Reach it from a new info-bar action next to "Previous channel" (the `actions` zone's count goes from 1 to 2).
     - Samsung's MTS and Caption keys only with new intents. A new intent makes S10's key battery ask every TV for it, webOS included; decide and record it.
   - **The controller** should expose tracks and the selection.
     - Events: `tracks` after `firstFrame`; `selectAudio`/`selectText` through the engine.
     - The preferences (`['ar','en']`) apply when tracks appear, and the per-channel choice wins.
     - The per-channel memory: the profile is 20c's job, so keep it in memory now behind an interface, like `SourceMemory`.
   - **The overlay:** the SRT/VTT/ASS parser goes in `core` (pure, ES2017, no DOM).
     - External subtitle files are fetched by the app; the URL comes from the provider. Run it through the query worker or a plain `fetch`, and keep the main bundle's polyfills in mind.
     - AVPlay's `cue` (`text`, `durationMs`) feeds the same overlay.
     - The webOS embedded subtitles are left to the TV (architecture.md §2 "Subtitles").
4. **The controller's own tests** use `FakeEngine` (`packages/player/src/fake-engine.ts`, not exported). The app's player tests use hand fakes (`apps/tv/src/player/player-state.test.ts`).

## Read first
1. `CLAUDE.md`: the conventions, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 20 and its split (20a–c), and the progress-log rows for legs 37–39.
3. `docs/architecture.md` §2: "Tracks", "Subtitles", and "Built in step 18/19/20a".
4. `apps/tv/src/player/`: `player-state.ts`, `PlayerScreen.tsx`, `app-player.ts`, `stage.ts`, `player.css`. Also `apps/tv/src/live/live-state.ts` (`list`, `focusRow`) and `LiveApp.tsx`.
5. `packages/player/src/`: `controller.ts` (`hide`/`show` are new), `engine.ts`, `html5-engine.ts` (tracks), `ladder.ts` (the 20a fix); and `packages/platform-tizen/src/avplay-engine.ts` (tracks, `cue`).
6. `e2e/player.spec.ts`, `e2e/player-media.spec.ts`, and `e2e/playback-media.spec.ts`, which switches the MKV's three audio tracks through the harness.
7. Memory:
   - `iptv-ui-test-gotchas` (leg 39 included);
   - `iptv-playwright-chromium-media`: no in-band text tracks on the desktop; `audioTracks` needs the Blink flag;
   - `iptv-tv-bundle-polyfills`;
   - `iptv-css-pipeline-gotchas`;
   - `iptv-parser-test-patterns` (for the subtitle parser);
   - `bg-watcher-memory-reap`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `aa299fb` (id `41844516860`) was unchecked when leg 39 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` is red, read the failing test before blaming a flake. `e2e/player-media.spec.ts` is new: it breaks the HLS segments mid-play and waits up to 60 s for `reconnecting`.
3. `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`** (leg 39 did once by mistake; harmless, but don't).
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `716992e` ("docs: record PR #38's merge"). It is pushed, and the tree is clean.
- **main** has `aa299fb` (PR #38). The branch is ahead by `716992e` and the handover commit, both docs; they go to main with 20b's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (media included);
  - `dist/` (leg 39's `pnpm build:tv`, current code);
  - `artifacts/`: screenshots `player-*.png`, `poly-probe.py`, `make-size-probe3.py`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself (with the player) was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 39 (step 20a, architecture.md §2 "Built in step 20a")
- **The route:** OK on a live channel pushes a `player` screen on the live navigator.
  - Zones: `actions` (the info bar's "Previous channel") and `card` (the error card's "Try again" and "Channels").
  - `LiveApp` draws `PlayerScreen` instead of the live screen while it is on top.
  - Back or STOP closes it: playback stops, and `live.focusRow(row played)`. Back during number entry only cancels the entry.
- **The stage:** `#stage` is made on the first play (`createStage`) as the body's first child.
  - `#app` is now `position: relative; z-index: 1`.
  - `html[data-player='on']` makes `html` and `body` transparent and shows the stage.
- **`appPlayer`** (one controller for the app, made on the first play):
  - `createEngines(stage)[0]` and `resolveUrl` where the platform has it;
  - `screenSaver` → `setScreenSaver` (a refusal is logged);
  - `online: navigator.onLine`;
  - `checkAccount` → the query worker's new `account` RPC (`packages/data/src/account-check.ts`: HTTP 401/403 = a refused login, a plain playlist = `null`);
  - `onLifecycle` → `hide`/`show`.
- **Keys:**
  - CH±/UP/DOWN zap through the category on show, wrapping, with a 350 ms debounce.
  - Digits: 1.5 s, at most 4. The lookup is `Live.list.find`: the guessed row by place, then chunks outwards. Two rows can share a number (provider numbers against places); the guessed chunk wins.
  - PRE-CH and the bar's button go to the channel watched before.
  - INFO toggles the bar.
- **The info bar** hides 5 s after the last key once the stream has a picture, and stays while opening or failed.
- **The controller's `hide()`/`show()`:**
  - A stream with a picture is suspended in the engine; `show` arms the open timeout and says `reconnecting`.
  - A stream still opening, or waiting out a backoff, is closed and reopened on show.
  - Engine events are dropped while hidden.
- **The ladder fix** (found by the media e2e): a definitive failure on a URL now hands the ladder to a living URL with backoff, instead of giving up. Before it, a switch from a broken `.m3u8` to the refused `.ts` ended with "this TV can't play this".
- **Known gaps:**
  - The picture goes **black while reconnecting** (Html5Engine closes before each reopen; keeping the last frame is later work).
  - Radio channels fail as `TV-UNSUPPORTED`/`NO_PICTURE` (step 37).
  - `allowed_output_formats` isn't used yet (20c).
  - No colour-key shortcut for the previous channel (step 39).
- **Size:** main's own code is 225.8 KB on Tizen and 214.4 KB on webOS (+26.8/+26.9 KB), with the same 219 core-js modules on both (`python -I artifacts/poly-probe.py <wt> <out>`; count the `core-js` lines of the two `main.tsx` tables).
- **The three riskiest changes in PR #38:**
  1. `main.tsx` now brings the player code into every start, and main is about 27 KB bigger. `verify:engines` wasn't run locally; CI's `engines` job passed.
  2. The ladder's definitive-failure rule changed (`packages/player/src/ladder.ts`).
  3. `#app` got `position: relative; z-index: 1` for the stage.

## The "press these keys" checklist for Omar (step 20a, `pnpm dev`)
Set up two terminals: `pnpm mock` in one and `pnpm dev` in the other. Open http://localhost:5173, onboard with server `localhost:8080`, user `zoma`, password `zoma-test`, then "Start watching". For real pictures, run `pnpm mock:media` once first.

**Keys:** Enter = OK, Escape = Back, PageUp/PageDown = CH+/CH−, digits, `p` = PRE-CH, `i` = INFO, `s` = STOP.

1. **ArrowDown, Enter:** the player opens. The info bar shows "2 Zoma Test 2 Clock", now/next and the clock; the picture plays (HLS) with media, or "Connecting…" without.
2. **PageUp three times quickly:** the bar shows each channel at once. Only "زوما تجريبي ٣" (3) opens.
3. **`5`:** after 1.5 s, "Zoma Kids Test" opens.
4. **`p`:** back to channel 3. **`p`** again: back to 5.
5. **`9`, `9`, Enter:** "No channel 99" for 2 s.
6. **Wait 5 s while it plays:** the bar hides. **`i`** shows it; **Enter** on a hidden bar shows it, and then presses "Previous channel".
7. **A broken channel:** restart the mock with `pnpm mock --scenario provider-errors`, then go to channel 4 (row 6, stream 104, which answers 509). After a few seconds the error card shows "Your provider isn't sending this channel", the subscription end, "Connections in use: 0 of 2" and the code. Enter = Try again; ArrowRight + Enter = Channels.
8. **On a card, PageUp:** the card goes at once and the next channel opens.
9. **Escape:** back to the list, on the channel that played.
10. **Arabic:** the same in Arabic (`?locale=ar-SA` on a fresh profile, or pick العربية in onboarding). The bar is mirrored (number on the right), and the card's buttons start from the right (ArrowLeft goes to "القنوات").

## Gotchas and lessons
**New in leg 39** (also in memory):
- **@preact/signals skips redrawing a child component whose props didn't change** (it patches `shouldComponentUpdate`). A child that reads plain data behind a version signal (`live.row()`, `live.guide()` behind `live.version`) never updates. Pass the data as props, or read the version signal in the child. The info bar kept "no guide" forever until its row and guide became props.
- **The mock can switch faults mid-test in-process:** `app.mockState.scenario = parseScenario({...}, name)`, then `= null`. HLS segments are `/hls/:u/:p/:id/:seg` (6 s each).
- **Expected browser console errors:** e2e that make a channel fail must filter the browser's "Failed to load resource … status of 404/503" lines out of `trackErrors`.
- **Heredoc patches again:** `\\n` inside a heredoc'd Python script became a raw newline (a SyntaxError). Use `NL = chr(10)` in patch scripts, or write them with the Write tool.
- **The relay context check** fired at about 452k tokens, mid-step. 20a's PR and merge still fitted. Expect the same for 20b: split early.

**From earlier legs (still true):**
- **Never `cd`.** A previous leg's tab (with Omar) can send cross-session messages: treat them as Omar's relayed decisions, verify their facts, and reply with SendMessage to the `from` address.
- **Local e2e flakes on a busy PC:** the throttled test, fixture tests and the lab's S2 update e2e. Read the test's own console line before suspecting code. `pnpm build:tv` can crash natively (0xC0000005) under load: rerun it alone.
- **Background runs:** `pnpm verify > log` in the background can be reaped, or report exit 0 even when verify failed. Read the log. The PR's CI `verify` job is exactly `pnpm verify`.
- **Vitest:**
  - A `void`ed load that a later stop rejects is an "Unhandled Rejection": use a `quiet()` helper.
  - Awaiting a `FakeEngine.stop()` without advancing the clock deadlocks the test.
  - There is no `__PLATFORM__` define: keep platform branches inside functions.
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one;
  - use exact float boundaries and fake-clock times on the 50 ms grid;
  - a fake must separate a state change from its callback in time;
  - check that a new test fails on the old code (leg 39 checked the ladder fix this way).
- **Playwright's Chromium (CfT 156):** no MPEG-TS, AC3/E-AC3 or in-band text; HEVC only headed; `audioTracks` needs `--enable-blink-features=AudioVideoTracks`; placeholder HLS never errors (use a 404 channel). A local `e2e:media` run needs `ZOMA_E2E_MEDIA=1` and the file first: `playwright test e2e/<file> --project playback-media` (a path after `--project` is read as a project name).
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the self-test or the CI job.
- **The lab under `pnpm dev`** shares the app's origin: use port 5174 for a manual lab run.
- **The Write tool turns `\uXXXX` escapes into raw characters.**
- **Waiting for CI:** check `gh pr checks <n>` once in the foreground, then Monitor with leg 14's command verbatim (it is in memory `bg-watcher-memory-reap`; worked again for PR #38). Never `<(`.
- **Code rules:**
  - Components in `packages/ui` stay hook-free.
  - Text only from the catalogs (`zoma/no-hard-coded-text`); provider text goes through `isolateText` (the `t()` arguments are isolated) or `dir=auto` + `translate=false`.
  - CSS uses physical properties only.
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(` and fields named like built-ins.
  - A new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 2,770 unit tests, both TV builds, and e2e for `player.spec.ts` (3) plus live/onboarding/tv-bundle (25) and `player-media.spec.ts` (1).
  - The ladder fix's tests fail on the old ladder.
  - PR #38's CI green on all three jobs (verify ran the full e2e; engines ran Chromium 53/56/68). Merged as `aa299fb`.
  - Screenshots looked at: `artifacts/screenshots/player-bar-en.png`, `player-card-ar.png` (mirrored correctly), `player-live-en.png` (real bars with the bar over them), `player-reconnecting-en.png` (black with the badge).
- **Not done:**
  - Main's CI on `aa299fb` is unchecked.
  - `verify:engines` wasn't run locally (CI's `engines` passed).
  - No mutation run for 20a's new code (the player state, the live list, `hide`/`show`). Leg 39 stopped at the context check; consider one for 20a's files when 20b touches them.
  - The player hasn't run on the LG TV (step 21) or any Samsung (19b).
  - The Simulators weren't re-run. S6 at scale on the TV.
  - The by-hand TV checks: S10, S11 by ear, and S5's suspend and soak.
  - All of Samsung.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **20b's split** and the new intents (MTS, Caption) are the leg's judgement; record them.
- **Steps 16 and 19b wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30 minutes at the LG TV** for S10, S11 by ear, and S5's suspend and soak. Now also the player itself (step 21).
- **Later, from the spikes:**
  - in-band subtitles failed on the LG TV, so 20b's overlay is fed by sidecar files and AVPlay's cues;
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung);
  - the last frame kept while reconnecting.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 39 was the 39th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Nineteen CLAUDE.md gaps** are waiting for his word:
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
  16. the Chromium 53 cheat sheet's heading (since ADR-012 no supported TV runs 53, but the build still targets it), and the `build:tv` row should mention the webOS ACG check (`requiredACG`, `tools/build/src/acg.ts`);
  17. a `pnpm e2e:media` row (`verify:media` is now fixtures + test:media + lab:media + e2e:media), the playback harness `apps/tv/playback.html` (`window.__ZOMA_PLAYBACK__`) in the `pnpm dev` row, and `Platform.createEngines(stage)`;
  18. platform-tizen's `AvplayEngine` and `createRedirectProbe` (`Platform.resolveUrl`), `FallbackEngine` in `player`, and the `ZOMA_E2E_MEDIA=1` switch for running one `playback-media` test locally;
  19. **new (leg 39):** the player in the app (`apps/tv/src/player`: the stage, `appPlayer`, the keys) in the `pnpm dev` row, the query worker's `account` call, and `e2e/player-media.spec.ts` in the `e2e:media` row.
- **Secrets:** none pending. The LG Dev Mode passphrase from 2026-11-04 needs no reminder (Omar said so).
