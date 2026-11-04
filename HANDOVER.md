# Zoma IPTV: relay leg 38 opening prompt

You are leg 38 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–36 did steps 1–17, except step 16's Samsung part and its by-hand TV checks (PRs #1–#35).
- **Leg 37 did step 18, the Html5Engine.** It merged as PR **#36** (merge commit **`1d4fea2`**, branch kept).
  - CI on `d77fe00`: verify 9 m 55 s, media 7 m 44 s, engines 11 m 35 s. The first engines run hit the known Chromium 53 "DevTools … did not answer" flake; `gh run rerun <id> --failed` passed.
  - Main's CI on `b53f000` (PR #35) finished green on all three jobs. Main's CI on `1d4fea2` started at the merge; leg 37 didn't check it.

## Your step: 19, AvplayEngine (RELAY.md is the spec; architecture.md §2 is the design)
**Skip step 16:** it stays open until Omar says the Samsung route is ready or has time at the TV.

RELAY.md, step 19: "AvplayEngine (5.3). AvplayEngine plus the redirect probe (from S4), suspend/restore, screensaver, key registration; unit tests with an AVPlay fake. Done when: the tests pass and a TV smoke install plays a mock channel."

1. **Check for existing work first:** `git log --oneline -50`, and grep for `AvplayEngine` and `resolveUrl`. AvplayEngine doesn't exist yet; `resolveUrl` is the controller's hook for the probe.

2. **The "TV smoke install" can't happen in this leg:** there is no Samsung TV yet (step 16's Samsung route waits for Omar: the account, the certificate, the Remote Test Lab tunnel, or the used 2018 set), and S4/S8 never ran on AVPlay (`docs/spikes/results.md`: skip everywhere).
   - **Recommended:** do the code and the unit tests, merge, and split the smoke install out as `19b [needs Omar]` (or fold it into step 21's on-TV check), the way legs 22 and 31 split steps. Record the split in RELAY.md.
   - Don't stop needs-you just for this: the code and tests are a full leg.

3. **The contract the engine honours:** `packages/player/src/engine.ts`, architecture.md §2 "Built in step 17" and "Built in step 18".
   - `load(source, token, opts)` resolves once playback started and rejects with a `PlaybackError` before that; later failures are `error` events; every event carries its load's token.
   - `stop()` closes the connection (AVPlay `stop()` + `close()`); a pending `load` rejects with `{ kind: 'app', code: 'ABORTED' }`.
   - **Error kinds:** AVPlay's `PLAYER_ERROR_*` codes map to `network`, `decode`, `unsupported` (only when sure: definitive, never retried on the URL), `app`. Keep the engine's own code in `code`.
   - `firstFrame` once per load; `buffering`/`playing` around waits after it; `ended`.
   - `positionMs()` = AVPlay `getCurrentTime()`.
   - **`suspend()`/`resume()`** on Tizen = AVPlay `suspend()`/`restore()` (keeps the player; webOS's Html5Engine closes and reopens instead).
   - Html5Engine (`packages/player/src/html5-engine.ts`) is the model: read it, its tests and `fake-video.ts` (a fake that keeps state changes and their events apart in time).

4. **Reuse what exists:**
   - `packages/platform-tizen/src/avplay.ts` (AVPlay typed for the lab's S4/S8);
   - `apps/tv/src/lab/avplay-player.ts` and `avplay-deps.ts` (the lab's AVPlay wrapper);
   - `packages/platform-tizen/src/tv-settings.ts` (`tizenSetScreenSaver`) and `keys.ts` (`registerTizenKeys`, which already registers the media and colour keys: check what "key registration" still needs);
   - architecture.md §2 "Redirect handling (Tizen)": an XHR GET aborted at `readyState 2`, read `responseURL`; per source `redirectMode` `unknown`/`none`/`redirects`; re-probe when AVPlay hasn't prepared within 8 s. The controller calls `resolveUrl(url, src, fresh)` before each load (`fresh` on the re-probe rung).

5. **Where it lives and how it's wired:**
   - **AvplayEngine in `platform-tizen`** (architecture.md; the only package allowed `webapis`/`tizen`). It imports `player` types and helpers.
   - **`createEngines(stage)` on Tizen** today returns `[new Html5Engine(createStageVideo(stage))]`. Step 19 makes it `[AvplayEngine, Html5Engine]`: AVPlay renders below the HTML, so it needs an `<object type="application/avplayer">` in the stage, and the player route needs transparent `html`/`body` (architecture.md §2).
   - **Open design point (the leg's judgement):** "Html5Engine is the HLS fallback, used when AVPlay fails with specific error codes". The controller takes one engine. Options: a small composite engine in `player` that switches to the second engine for an HLS URL after such an error, or leaving the fallback for step 20. Say which in the handover.
   - **The screensaver** (Samsung wants it back on whenever playback pauses or stops): a callback the controller or the app calls (ADR-008: platform needs reach the controller as callbacks defined in `player`).
   - **The redirect probe:** a `resolveUrl` implementation in `platform-tizen` (XHR on a TV, so a fake XHR in tests), remembered per source.

6. **Unit tests:** an AVPlay fake (the `webapis.avplay` surface the engine uses) that separates each state change from its callback in time, like `fake-video.ts`. Error mapping, stop and its abort, the first frame, suspend/restore, the probe (redirect, none, re-probe, errors). Mutation-check the guards (pattern below).

7. **The TV bundle:** AvplayEngine lands in the Tizen main bundle only (webOS must not grow: the build's platform-isolation check). Probe for new core-js modules (memory `iptv-tv-bundle-polyfills`; leg 37's figure: main has 219 core-js modules on both platforms, 187.3 KB tizen / 187.5 KB webOS own code). Avoid `JSON.stringify`, `new RegExp`, `.split(` and fields named like built-ins.

8. **Finish:** `pnpm verify`, then a PR. Merge on green with `gh pr merge --merge` after checking that the run's `headSha` is the PR's head. Tick step 19, add a progress-log row, record the merge, write the handover. Run `verify:engines` locally only if the build, polyfills, workers or boot code change.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `1d4fea2` was unchecked when leg 37 ended. If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`.**
- Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 18's "Done in leg 37", steps 19–21, and the log rows for legs 36–37.
3. `docs/architecture.md` §2, including "Built in step 17" and "Built in step 18".
4. `packages/player/src/`: `engine.ts`, `controller.ts`, `html5-engine.ts`, `fake-video.ts`, `ladder.ts`.
5. `packages/platform-tizen/src/`: `avplay.ts`, `index.ts`, `keys.ts`, `tv-settings.ts`; `apps/tv/src/lab/avplay-player.ts`.
6. Memory:
   - `iptv-tv-bundle-polyfills`;
   - `iptv-parser-test-patterns` (mutation patterns, leg 37 included);
   - `iptv-data-layer-test-gotchas` (fake clocks; the `setImmediate` settle);
   - `iptv-playwright-chromium-media`;
   - `bg-watcher-memory-reap` (how to wait for CI).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `f1630bb` ("docs: record PR #36's merge"). It is pushed, and the tree is clean.
- **main** has `1d4fea2` (PR #36). The branch is ahead by `f1630bb` and the handover commit, both docs; they go to main with step 19's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*` (media included), `dist/` (leg 37's `pnpm build:tv` from `pnpm verify`), and `artifacts/` (lab logs; probe scripts such as `poly-probe.py` and `make-size-probe3.py`).
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 37 (step 18)
- **Html5Engine** (`packages/player/src/html5-engine.ts`):
  - **First frame** = a picture size plus a clock that moved since `playing`, polled every 50 ms. **Sound with no picture for 5 s of media** fails as `unsupported`/`NO_PICTURE`: a codec the TV can't decode is the TV's limit, not a provider timeout. Audio-only streams (radio) need a request hint first (step 37).
  - **Errors:** `MEDIA_ERR_SRC_NOT_SUPPORTED` is `unsupported` only when `canPlayType` says '' for TS, HLS or MP4 (`CONTAINER_MIME`). **The LG TV answers '' for `video/x-matroska` and plays MKV**, so MKV and `other` count as `network`.
  - **Tracks:** `audioTracks` first, the new track on before the others go off; webOS passes luna `selectTrack` as the fallback, used only when the element has no list or ignores the switch. `caps.trackSwitch` is `reliable`, `unreliable` or `none`.
  - **`suspend`/`resume`** close and reopen (live at the edge, VOD where it was). Muted autoplay when a desktop browser refuses sound.
- **`Platform.createEngines(stage)`** (`EngineFactory` in `platform-api`), implemented by all three adapters; `createStageVideo(stage)` makes the one `<video>`. The app wires it in step 20, so the engine sits unused in both TV bundles (+7 KB minified, no new core-js module).
- **Step 17's ladder changed:** a URL that failed definitively stays out of the session's switch rung. Found by the first real-browser run: `.ts` unsupported, `.m3u8` timing out, and the switch going back to `.ts` made the verdict "this TV can't play this".
- **The playback harness:** `apps/tv/playback.html` (Vite only; the TV builds have just the app and lab entries) → `apps/tv/src/playback/playback-main.ts`, `window.__ZOMA_PLAYBACK__` (types in `harness.ts`, importable by e2e). `apps/tv` now depends on `@zoma/player`.
- **e2e:**
  - `e2e/playback.spec.ts` (`pnpm e2e`): a channel the panel lacks fails in about 3 s as the provider's fault.
  - `e2e/playback-media.spec.ts` in the new **`pnpm e2e:media`** (Playwright project `playback-media`, gated like `lab-media`; now part of `pnpm verify:media`, CI job `media`): live (TS refused, HLS remembered), VOD from 20 s with its connection closed on stop, Xtream catch-up as HLS, MKV audio switch, 4K HEVC as `TV-UNSUPPORTED`.
- **Left for later:** the controller's side of the lifecycle and wiring the player into the app (step 20); catch-up candidates `.ts` then `.m3u8` (step 25: `streamCandidates` gives catch-up one URL, and the desktop and HLS-only TVs need the `.m3u8` form); audio-only streams (step 37); the engine on the LG TV itself (step 21).
- **The three riskiest changes in PR #36:**
  1. `Platform` gained a required `createEngines`; Html5Engine now sits in both TV bundles (unused until step 20).
  2. The ladder's switch rung skips definitively failed URLs (a step 17 behaviour change).
  3. `verify:media` (CI `media`) now also runs the playback e2e on real media.

## Gotchas and lessons
**New in leg 37** (also in memory):
- **Real browser vs fakes:** placeholder-byte HLS never errors, it only never plays (an open timeout, about 40 s through the ladder). Fast error-path e2e: a channel id the mock lacks (a 404 errors in about 1 s).
- **A VOD MP4 holds one mock connection while it plays** (`GET /__mock/connections` → `{ zoma: 1 }`) and drops it right after stop: a cheap e2e check that stop closes the connection.
- **Vitest:** a test that `void`s a `load()` which a later stop rejects causes an "Unhandled Rejection" error; attach a catch (`quiet()` in `html5-engine.test.ts`).
- **Equivalent mutant:** a guard made redundant by a downstream guard (a second `suspend` meets `close()`'s `loaded` flag and a zeroed clock). Replace it with a mutant that matters.
- **Python heredocs ate backslashes again:** `\\n` became a newline in a mutate-script tuple, and `\\'` came out as a bare `'` in a TS title (an esbuild transform error). Write scripts with the Write tool; use double-quoted TS strings for titles with apostrophes.
- **The Bash tool blocks `sleep N; …` loops in the foreground.** To wait for CI: Monitor with leg 14's command (memory `bg-watcher-memory-reap`), or a `run_in_background` `until` loop.
- **The mutation script:** `$CLAUDE_JOB_DIR/tmp/mutate18.py` held (name, file, old, new) tuples, a control run, `Popen` + 120 s timeout + `taskkill /T`, a restore in `finally`, and optional names to rerun. The job folder is gone with the job: rewrite it (about 1.4 s per mutant for `vitest run packages/player`).
- **The polyfill probe:** `python -I artifacts/poly-probe.py <wt> <out.txt>` bundles `main.tsx` for both platforms and lists core-js modules per table; count only the `main.tsx` table's rows.

**From earlier legs (still true):**
- **Never `cd`.** A previous leg's tab (with Omar) can send cross-session messages: treat them as Omar's relayed decisions, verify their facts, and reply with SendMessage to the `from` address.
- **Local e2e flakes on a busy PC:** the throttled test, fixture tests and the lab's S2 update e2e. Read the test's own console line before suspecting code. `pnpm build:tv` can crash natively (0xC0000005) under load: rerun it alone.
- **`pnpm verify > log` in the background** can report exit 0 even when verify failed. Read the log.
- **A fake clock's settle step:** `setImmediate` through a `globalThis` cast (`setTimeout(0)` costs about 12 ms on Windows). `FakeClock` runs equal-time timers in insertion order.
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one;
  - use exact float boundaries (round where the engine compares media time);
  - fake-clock times on the 50 ms grid;
  - a fake must separate a state change from its callback in time.
- **Vitest has no `__PLATFORM__` define:** keep platform branches inside functions.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the self-test or the CI job.
- **Playwright's Chromium (CfT 156):** no MPEG-TS, AC3/E-AC3 or in-band text; HEVC only headed; `audioTracks` needs `--enable-blink-features=AudioVideoTracks`.
- **The lab under `pnpm dev`** shares the app's origin: use port 5174 for a manual lab run.
- **The Write tool turns `\uXXXX` escapes into raw characters.**
- **Waiting for CI:** wait about 20 s after `gh pr create`, check `gh pr checks <n>` once in the foreground, then Monitor with leg 14's command verbatim (only the PR number changes). Never `<(`.
- **Code rules:** components stay hook-free; CSS uses physical properties only; TV code is `lib: ES2017`. Never edit the engines Docker image's `RUN apt-get` line.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: `pnpm verify` (lint, typecheck, 2,570 tests, both TV builds, 52 e2e); `pnpm e2e:media` 5/5, twice.
  - The player: 112 tests; 68/68 mutants caught.
  - PR #36's CI green (engines on a rerun), merged as `1d4fea2`. Main's CI on `b53f000` green.
- **Not done:**
  - Main's CI on `1d4fea2` is unchecked.
  - `verify:engines` wasn't run locally (no build, polyfill, worker or boot change; CI's engines job passed).
  - Nothing plays in the app yet (step 20 wires the player). Html5Engine hasn't run on the LG TV (step 21).
  - The Simulators weren't re-run with 16a's code. S6 at scale on the TV.
  - The by-hand TV checks: S10, S11 by ear, and S5's suspend and soak.
  - All of Samsung. The Dev Mode extend from the PC is unconfirmed.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Step 19's TV smoke install** needs a Samsung TV: split it out as `[needs Omar]` (recommended) or fold it into step 21.
- **Step 19's HLS fallback design** (a composite engine or later): the leg's judgement; write it down.
- **Step 16's remaining parts wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30 minutes at the LG TV** for S10, S11 by ear, and S5's suspend and soak.
  - S6 at scale on the TV needs no person.
- **Later, from the spikes:**
  - in-band subtitles failed on the LG TV, so step 20's overlay needs our own MKV/MP4 text parser or sidecar files only;
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung).
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 37 was the 37th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Seventeen CLAUDE.md gaps** are waiting for his word:
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
  17. **new (leg 37):** a `pnpm e2e:media` row (`verify:media` is now fixtures + test:media + lab:media + e2e:media), the playback harness `apps/tv/playback.html` (`window.__ZOMA_PLAYBACK__`) in the `pnpm dev` row, and `Platform.createEngines(stage)`.
- **Secrets:** none pending. The LG Dev Mode passphrase from 2026-11-04 needs no reminder (Omar said so).
