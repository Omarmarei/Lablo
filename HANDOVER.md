# Zoma IPTV: relay leg 39 opening prompt

You are leg 39 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–37 did steps 1–18, except step 16's Samsung part and its by-hand TV checks (PRs #1–#36).
- **Leg 38 did step 19, the AvplayEngine.** It merged as PR **#37** (merge commit **`1834451`**, branch kept).
  - CI on `dd14341`: verify 9 m, media 10 m, engines 11 m, all green on the first run.
  - Main's CI on `1d4fea2` (PR #36) was **red in `media`**: step 18's VOD e2e raced (fixed in PR #37, see below). Main's CI on `1834451` was still running when leg 38 ended (run `41836126783`).
- **Step 19b was split out** `[needs Omar]`: the TV smoke install on a Samsung TV.

## Your step: 20, Player UI (RELAY.md is the spec; architecture.md §2 is the design)
**Skip steps 16 and 19b:** they stay open until Omar says the Samsung route is ready or has time at the TV.

RELAY.md, step 20: "Player UI (5.4). Info bar, debounced zapping, number entry, previous channel, track menu, subtitle overlay (SRT/VTT/ASS, size + timing), aspect/zoom, stream info, reconnect badge, error cards, start-on-last-channel. Done when: e2e passes and the click-through checklist is in the handover."

1. **Check for existing work first:** `git log --oneline -50`, and grep for `PlayerController` and `createEngines` under `apps/tv/src` and `packages/ui/src`. Today only the dev-only harness (`apps/tv/src/playback/playback-main.ts`) uses them; nothing plays in the app.

2. **Split step 20 first.** It is far more than one leg. Split it the way legs 22, 27 and 31 split steps (11a–c, 13a–c, 14a–c, 15a–e), record the split in RELAY.md, and do the first part. A suggested split (your judgement):
   - **20a: the player in the app.**
     - The player route and its stage. On Tizen it needs a transparent `html`/`body` (AVPlay paints under the page; the stage has its `<object>` and a hidden `<video>`).
     - `Platform.createEngines(stage)` and a `PlayerController` with `resolveUrl: platform.resolveUrl`, `screenSaver: (a) => void platform.setScreenSaver(a)`, `online` and `checkAccount`.
     - Live: play a channel from the live screen, the info bar, debounced zapping (350 ms) with CH+/CH−, number entry (1.5 s), previous channel, the reconnect badge and the error cards. The four categories and their codes come from `classifyFailure`.
     - The lifecycle: `onLifecycle` hidden/visible to the engine's `suspend`/`resume`, with the watchdog resting while hidden.
     - e2e on the desktop (`pnpm e2e`, with the 404 trick for fast errors) and on real media (`pnpm e2e:media`).
   - **20b: tracks and subtitles.**
     - The track menu, the language preferences (`ar`/`ara`/`arb`/`Arabic`/`عربي` → `ar`), and the per-channel choice.
     - The subtitle overlay: an SRT/VTT/ASS parser in `core`, size and timing, `dir=auto` per cue. It is fed by external files and by AVPlay's new `cue` engine event.
   - **20c: the rest.** Aspect/zoom, stream info (`engine.stats()`), start-on-last-channel (≤ 4 s to the first frame), persisting `SourceMemory` and the redirect memory in the profile, and the click-through checklist for Omar.

3. **The engine contract** (`packages/player/src/engine.ts`; architecture.md §2 "Built in step 17/18/19"):
   - The controller takes one engine. **Tizen's `createEngines` returns one `FallbackEngine`** (AVPlay, then the `<video>` for HLS AVPlay refuses). It returns `Html5Engine` alone where there is no `webapis.avplay` (the desktop, the old-engine harness). webOS and the browser return one `Html5Engine`.
   - Events: `firstFrame`, `buffering`/`playing`, `ended`, `tracks`, `error`, and the new **`cue`** (`text`, `durationMs`), which only AVPlay sends (`caps.deliversSubtitleText`).
   - `suspend`/`resume`: Tizen keeps the player (`restore`); webOS closes and reopens. The controller's side (resting the watchdog while hidden) is still to do.
   - **`Platform.resolveUrl`** (new, optional) is set on Tizen only, and `ControllerOptions.screenSaver` is new.

4. **UI rules:**
   - Components stay hook-free.
   - Text only from the catalogs (`appI18n`, lint `zoma/no-hard-coded-text`); provider text through `isolateText`.
   - CSS uses physical properties only (rtlcss mirrors them).
   - A new screen needs `data-screen`/`zone`/`index` on its root and `showFocus` (memory `iptv-throttled-e2e`).
   - TV code is `lib: ES2017`. Probe the TV bundle for new core-js modules (memory `iptv-tv-bundle-polyfills`). Avoid `JSON.stringify`, `new RegExp`, `.split(` and fields named like built-ins in TV code.
   - Today main has **219 core-js modules on both platforms**, **199.0 KB own code on Tizen, 187.5 KB on webOS**.

5. **Finish:**
   - `pnpm verify`, then a PR. Merge on green with `gh pr merge --merge` after checking that the run's `headSha` is the PR's head.
   - Tick the step (or its first part), add a progress-log row, record the merge, write the handover with the "press these keys" checklist (CLAUDE.md: UI steps end with one).
   - Run `verify:engines` locally if the build, polyfills, workers or boot code change; a player route in the app's boot path likely counts. `pnpm verify:media` (CI `media`) covers `e2e:media`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `1834451` (id `41836126783`) was unchecked when leg 38 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` is red, read the failing test before blaming a flake: the last red `media` (on `1d4fea2`) was a real test race.
3. `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`.**
- Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: steps 18–21 (19's "Done in leg 38", 19b), and the log rows for legs 36–38.
3. `docs/architecture.md` §2, including "Built in step 17", "Built in step 18" and "Built in step 19"; §1.2 for the UI shell (router, focus, zones).
4. `packages/player/src/`: `engine.ts`, `controller.ts`, `fallback-engine.ts`, `failure.ts`, `request.ts`; `packages/platform-tizen/src/avplay-engine.ts`, `redirect-probe.ts`, `index.ts` (`createTizenEngines`).
5. The live screen (step 14) in `packages/ui` and `apps/tv/src`; `apps/tv/src/playback/` (the harness: how it builds the controller).
6. Memory:
   - `iptv-ui-test-gotchas`;
   - `iptv-throttled-e2e`;
   - `iptv-playwright-chromium-media` (leg 38 included);
   - `iptv-tv-bundle-polyfills`;
   - `iptv-css-pipeline-gotchas`;
   - `iptv-parser-test-patterns` (mutation patterns, leg 38 included);
   - `bg-watcher-memory-reap` (how to wait for CI; a background `pnpm verify` can be reaped too).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `c837695` ("docs: record PR #37's merge"). It is pushed, and the tree is clean.
- **main** has `1834451` (PR #37). The branch is ahead by `c837695` and the handover commit, both docs; they go to main with step 20's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (media included);
  - `dist/` (leg 38's `pnpm build:tv` from the interrupted `pnpm verify`; current code);
  - `artifacts/` (lab logs; probe scripts such as `poly-probe.py`, `make-size-probe3.py`).
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 38 (step 19)
- **AvplayEngine** (`packages/platform-tizen/src/avplay-engine.ts`):
  - **Open:** `open`, `setListener`, `setDisplayRect`, `prepareAsync`, then `play`. `load` resolves at `play`.
  - **The first frame** is the clock moving while `PLAYING`. A VOD start is a `seekTo` after `play`; the jump is no frame.
  - **The 302 freeze:** an 8 s prepare timeout fails as `timeout`/`PREPARE_TIMEOUT`, and the ladder's re-probe rung follows.
  - **Errors:** only `PLAYER_ERROR_NOT_SUPPORTED_*` is `unsupported`; `GENEREIC` is `decode`; wrong calls are `app`; everything else is `network`.
  - **Suspend/resume:** AVPlay's `suspend`/`restore`, falling back to close and reopen. VOD comes back at its position, or at the start a jump was still going to.
  - **Tracks:** by stream index. Subtitle text arrives as `cue` events while a text track is shown.
- **The redirect probe** (`createRedirectProbe` = `Platform.resolveUrl` on Tizen):
  - It is an XHR aborted at `readyState` 2.
  - It remembers `none`/`redirects` per source, in memory (the profile is 20c's job). A `redirects` source is probed before every play.
  - HTTP ≥ 400 rejects as `http`, so the card says `PRV-HTTP-404`.
  - No answer within 5 s gives the URL as it is.
- **`FallbackEngine`** (`player`): the design decision for "Html5Engine is the HLS fallback". The default rule is `hlsRefused` (HLS refused as `unsupported`). The TV tells which codes really call for it (step 21).
- **The screensaver:** `ControllerOptions.screenSaver(allowed)`, called on changes only. It stays away while the stream opens, plays, buffers or reconnects, and comes back when it is paused, ended, failed or stopped.
- **Key registration:** nothing new. Every key the player handles was already registered.
  - Samsung's MTS, Caption and PictureSize keys would need new intents (step 20b/20c may want them).
  - A new intent makes S10's key battery ask every TV for it, webOS included.
- **Fixed:** step 18's VOD e2e "stop closes its connection". A fast CI runner downloaded the whole 12 MB file, and the browser closed the connection itself. The mock now holds the response after 4 MB (`?mock_fault=stall:after_bytes=4000000`).
- **Not done:** `setStreamingProperty` (4K mode on older sets, adaptive HLS) and `setBufferingParam` (step 39's "Fast start / Stable").
- **Unknown until a Samsung TV runs it:** AVPlay's real error names, `suspend` while preparing, and the probe's connection on a one-connection account.
- **The three riskiest changes in PR #37:**
  1. Tizen's `createEngines` now returns `FallbackEngine(AvplayEngine, Html5Engine)`, and the Tizen main bundle grew 11.7 KB. The code is unused until step 20 and untested on a Samsung TV.
  2. `Platform` gained an optional `resolveUrl`, and `EngineEvent` gained `cue`. Every consumer's `switch` must handle `cue` (the controller ignores it).
  3. Step 18's VOD e2e now plays through the mock's stall fault.

## Gotchas and lessons
**New in leg 38** (also in memory):
- **A background `pnpm verify > log` was reaped for low memory** during its e2e stage. The rule is not to restart it unasked: say so, and let the PR's CI `verify` (exactly `pnpm verify`) be the e2e run. Lint, typecheck, tests and builds can run one by one in the foreground if needed.
- **Heredoc patches again:** `\\n` in mutant tuples became real newlines, and a patch with a no-op assert stopped halfway. Write patch scripts with the Write tool (`BS = chr(92)`), and fix single lines with Edit.
- **Mutation:**
  - A mutant inside a try/catch wrapper (`attempt(...)`) can be runtime-equivalent and typecheck-only.
  - Redundant cleanup lines show up as survivors: remove them and define the field's meaning instead.
  - Keep every callback a fake handed out (`prepares[]`, `seeks[]`) to test stale ones. That found a real bug.
- **The mutation script:** `$CLAUDE_JOB_DIR/tmp/mutate19.py` held (name, file, old, new, tests) tuples, `--check`, control runs, `node node_modules/vitest/vitest.mjs run <dir>` via Popen + 180 s timeout + `taskkill /T`, and a restore in `finally`. It ran 133 mutants in about 3 min. The job folder goes with the job: rewrite it.
- **The polyfill probe:** `python -I artifacts/poly-probe.py <wt> <out.txt>` bundles `main.tsx` for both platforms. Compare only the two `main.tsx` tables (leg 38 first compared the wrong two).

**From earlier legs (still true):**
- **Never `cd`.** A previous leg's tab (with Omar) can send cross-session messages: treat them as Omar's relayed decisions, verify their facts, and reply with SendMessage to the `from` address.
- **Local e2e flakes on a busy PC:** the throttled test, fixture tests and the lab's S2 update e2e. Read the test's own console line before suspecting code. `pnpm build:tv` can crash natively (0xC0000005) under load: rerun it alone.
- **`pnpm verify > log` in the background** can report exit 0 even when verify failed. Read the log.
- **Vitest:**
  - A `void`ed load that a later stop rejects is an "Unhandled Rejection": use a `quiet()` helper.
  - Awaiting a `FakeEngine.stop()` without advancing the clock deadlocks the test (it resolves on the clock).
- **A fake clock's settle step:** `setImmediate` through a `globalThis` cast (`setTimeout(0)` costs about 12 ms on Windows).
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one;
  - use exact float boundaries;
  - fake-clock times on the 50 ms grid;
  - a fake must separate a state change from its callback in time.
- **Vitest has no `__PLATFORM__` define:** keep platform branches inside functions.
- **Playwright's Chromium (CfT 156):** no MPEG-TS, AC3/E-AC3 or in-band text; HEVC only headed; `audioTracks` needs `--enable-blink-features=AudioVideoTracks`; placeholder HLS never errors (use a 404 channel for fast error e2e). `pnpm e2e:media` locally needs `ZOMA_E2E_MEDIA=1` for `playwright test --project playback-media -g …`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the self-test or the CI job.
- **The lab under `pnpm dev`** shares the app's origin: use port 5174 for a manual lab run.
- **The Write tool turns `\uXXXX` escapes into raw characters.**
- **Waiting for CI:** wait about 20 s after `gh pr create`, check `gh pr checks <n>` once in the foreground, then Monitor with leg 14's command verbatim (only the PR number changes; it is in memory `bg-watcher-memory-reap`). Never `<(`.
- **Code rules:** components stay hook-free; CSS uses physical properties only; TV code is `lib: ES2017`. Never edit the engines Docker image's `RUN apt-get` line.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 2,639 tests and both TV builds (from `pnpm verify`, whose e2e stage was cut off by the memory reap). The fixed VOD e2e passed 3/3 alone.
  - platform-tizen 124 tests, player 127. Mutation 133/133 caught.
  - The Tizen and webOS main bundles have the same 219 core-js modules.
  - PR #37's CI green on all three jobs (`verify` ran the full e2e). Merged as `1834451`.
- **Not done:**
  - Main's CI on `1834451` is unchecked. The red `media` on `1d4fea2` is superseded by the fix.
  - `verify:engines` wasn't run locally: the CI `engines` job passed, and no build, polyfill, worker or boot code changed.
  - Nothing plays in the app yet (step 20). Html5Engine hasn't run on the LG TV (step 21). AvplayEngine hasn't run on any Samsung TV (19b).
  - The Simulators weren't re-run with 16a's code. S6 at scale on the TV.
  - The by-hand TV checks: S10, S11 by ear, and S5's suspend and soak.
  - All of Samsung. The Dev Mode extend from the PC is unconfirmed.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Step 20's split** (the leg's judgement; suggested above).
- **Steps 16 and 19b wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set. 19b also needs the player in the app (step 20) or a lab spike for the engine.
  - **About 30 minutes at the LG TV** for S10, S11 by ear, and S5's suspend and soak.
  - S6 at scale on the TV needs no person.
- **Later, from the spikes:**
  - in-band subtitles failed on the LG TV, so step 20's overlay needs our own MKV/MP4 text parser or sidecar files only;
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung).
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 38 was the 38th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Eighteen CLAUDE.md gaps** are waiting for his word:
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
  18. **new (leg 38):** platform-tizen's `AvplayEngine` and `createRedirectProbe` (`Platform.resolveUrl`), `FallbackEngine` in `player`, and the `ZOMA_E2E_MEDIA=1` switch for running one `playback-media` test locally.
- **Secrets:** none pending. The LG Dev Mode passphrase from 2026-11-04 needs no reminder (Omar said so).
