# Zoma IPTV: relay leg 37 opening prompt

You are leg 37 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–35 did steps 1–16a, except step 16's Samsung part and its by-hand TV checks (PRs #1–#34).
- **Leg 36 did step 17, the PlayerController.** It merged as PR **#35** (merge commit **`b53f000`**, branch kept).
  - CI on `9e6153d` was green on the first run: verify 8 m 45 s, media 10 m 42 s, engines 11 m 35 s.
  - Main's CI on `b53f000` started at the merge; leg 36 didn't check it.
  - Main's CI on `0f5a692` (PR #34) finished green on all three jobs.

## Your step: 18, Html5Engine (RELAY.md is the spec; architecture.md §2 is the design)
**Skip step 16:** it stays open until Omar says the Samsung route is ready or has time at the TV.

RELAY.md, step 18: "Html5Engine (5.2). webOS/desktop engine, webOS track-switch strategy (from S5), desktop playback e2e against the mock provider. Done when: e2e plays live, VOD and catch-up on desktop."

1. **Check for existing work first:** `git log --oneline -50`, and grep for `Html5Engine` and `createEngines`. Neither exists yet.

2. **Read the contract the engine must honour.** It is in `packages/player/src/engine.ts` and in architecture.md §2, "Built in step 17".
   - **`load(source, token, opts)`:**
     - takes one `EngineSource` (URL, container, live);
     - resolves once the source is taken and playback has started;
     - rejects with a `PlaybackError` when the source can't be opened.
   - **Events:** `firstFrame` (once per load), `buffering`, `playing`, `ended` and `error`. Each carries its load's token.
   - **`stop()`** closes the connection (`removeAttribute('src')` then `load()` on the element), and a pending `load` settles. Rejecting with `{ kind: 'app', code: 'ABORTED' }` is fine, because the controller drops stale results.
   - **Error mapping:**
     - `MEDIA_ERR_NETWORK` → `network`;
     - `MEDIA_ERR_DECODE` → `decode`;
     - `MEDIA_ERR_SRC_NOT_SUPPORTED` → `unsupported` **only when the engine is sure**, for example when `canPlayType` says `''` for the container. Otherwise map it to `network`: HTML5 reports HTTP 4xx/5xx and panels' error pages the same way, and `unsupported` is never retried on the same URL (`isDefinitive`).
   - **`positionMs()`** is `currentTime × 1000`. One app-wide `<video>` element is handed to the engine.

3. **Reuse what the lab learned:**
   - `apps/tv/src/lab/video-player.ts` and `battery.ts` (S5's `<video>` wrapper: first-frame detection, `audioTracks`, errors, the 6 s watchdog);
   - `packages/platform-webos/src/luna.ts`, `webosSelectTrack`: a fallback only, because `selectTrack` isn't in LG's ACG table (ADR-012). A new luna call goes into `LUNA_ACG` and the manifest;
   - the S5 row of `docs/spikes/results.md`: on the TV, `audioTracks` switches in 154–205 ms with no restart, and in-band subtitles show no text track.

4. **Where it lives and how it's wired:**
   - **The engine:** architecture.md puts `Html5Engine` in `packages/player`; its tsconfig has the DOM lib.
   - **The factory:** ADR-008 says the platform adapters construct the engines. Declare `createEngines()` (or an `EngineFactory`) in `platform-api` with an `import type` from `player`, and implement it in `platform-browser` and `platform-webos`. On Tizen, Html5Engine is the HLS fallback until step 19.
   - **Test doubles:** `FakeEngine` and `FakeClock` live in `packages/player/src/fake-engine.ts` and aren't exported. If tests outside `player` need them, add a narrow entry such as `@zoma/player/testing`, with its boundary-lint entry-point rule, as `@zoma/data/client` did.

5. **The desktop e2e (the "done when"):**
   - **Media:** Playwright's Chromium (CfT 156) plays HLS, H.264, MKV and 302s, but not MPEG-TS or AC3. So on desktop, a live channel's `.ts` URL should come back `unsupported` (`canPlayType('video/mp2t') === ''`), and the controller should move to `.m3u8` and remember it. Assert that flow.
   - **The mock** serves real media only after `pnpm mock:media` (ffmpeg, `.cache/media`); otherwise it serves placeholder bytes.
   - **Which CI job:** the `verify` job doesn't generate media; the `media` job does, and it runs `pnpm lab:media`, the Playwright project `lab-media`. So the playback e2e probably belongs in a media-job project too. Check `playwright.config.ts` and `.github/workflows/`, and keep `pnpm verify` independent of ffmpeg.
   - **Catch-up:** the mock has catch-up endpoints (`docs/runbooks/mock-provider.md`); core has `xtreamCatchupUrl` and `m3uCatchupUrl`.
   - **The page:** there is no player UI until step 20, so the e2e needs a page that wires `PlayerController` and `Html5Engine` to the mock. A dev-only `?screen=…` harness exposing its status through `window.__ZOMA_TEST__` is one way. Keep it out of the TV bundle, or justify its size.

6. **Unit tests:** a fake `<video>` that separates each state change from its event in time; the error mapping; stop and its abort; first frame; tracks.
   - Mutation-check the guards with the `$CLAUDE_JOB_DIR/tmp/mutate*.py` pattern below.

7. **The TV bundle:**
   - Bundled beside `main.tsx`, the player alone adds about 10.3 KB minified, with no new core-js module (leg 36's probe).
   - Probe Html5Engine's files for polyfills (memory `iptv-tv-bundle-polyfills`).
   - TV code is `lib: ES2017`. Avoid `JSON.stringify`, `new RegExp` and `.split(`.

8. **Finish:**
   - `pnpm verify`, then a PR. Merge on green with `gh pr merge --merge`, after checking that the run's `headSha` is the PR's head.
   - Tick step 18, add a progress-log row, and write the handover.
   - Run `verify:engines` locally only if the build, polyfills, workers or boot code change.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `b53f000` was unchecked when leg 36 ended. If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`:** leg 36's one `cd` moved the session's working directory into the worktree.
- Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 17's "Done in leg 36", steps 18–21, and the log rows for legs 35–36.
3. `docs/architecture.md` §2, including "Built in step 17".
4. `packages/player/src/`: `engine.ts`, `controller.ts`, `request.ts`, `fake-engine.ts`.
5. `docs/spikes/results.md` (S5) and `docs/adr/ADR-008-*`.
6. Memory:
   - `iptv-playwright-chromium-media` (what desktop Chromium plays);
   - `iptv-tv-bundle-polyfills`;
   - `iptv-parser-test-patterns` (mutation patterns, leg 36 included);
   - `iptv-data-layer-test-gotchas` (fake clocks; leg 36's `setImmediate` settle);
   - `iptv-webos-acg`;
   - `iptv-mock-provider-gotchas`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `65c5b27` ("docs: record PR #35's merge"). It is pushed, and the tree is clean.
- **main** has `b53f000` (PR #35). The branch is ahead by `65c5b27` and the handover commit, both docs; they go to main with step 18's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*` (media included), `dist/` (a fresh `pnpm build:tv` from leg 36: lab 0.1.0, server `http://192.168.1.3:8080`), and `artifacts/` (lab logs, probe scripts such as `poly-probe.py` and `make-size-probe3.py`).
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 36
- **The engine contract changed from architecture.md's sketch:**
  - `load(EngineSource, token, { startMs })`: the controller owns the list of URLs;
  - `PlayRequest.src`: the source id, for the per-source memory, without `parseContentKey`'s `JSON.stringify` polyfill;
  - `Container` adds `'other'`;
  - failures are a `PlaybackError` with a kind (`network`, `http`, `timeout`, `stall`, `unsupported`, `decode`, `app`) and the engine's own `code`.
- **The numbers** (`DEFAULT_WATCHDOG`, tunable per model):
  - live: a stall after 6 s frozen while playing, or 12 s buffering;
  - VOD and catch-up: 20 s buffering;
  - an open timeout when no first frame arrives within 10 s of an attempt (it covers the stop and the probe too);
  - a tick every 500 ms;
  - backoff of 1, 2 and 4 s;
  - giving up after 4 attempts within 60 s.
- **The ladder:**
  - Before a URL has shown a frame, the next untried URL goes first.
  - Otherwise: reopen, re-probe (only with `resolveUrl`), switch (only with 2 URLs), then the backoff.
  - A frame resets the rung, but attempts keep counting in the window.
  - Definitive errors (`unsupported`, HTTP 4xx except 408 and 429) only try untried URLs.
  - Live reopens at the live edge; VOD at the last position the watchdog saw.
- **The classifier's order:**
  1. offline → `NET-OFFLINE`;
  2. `app` → `APP-ERROR`;
  3. account problems from the re-check: `PRV-AUTH`, `PRV-EXPIRED`, `PRV-BLOCKED`, `PRV-MAX-CONNECTIONS`;
  4. `unsupported` → `TV-UNSUPPORTED`;
  5. everything else → `PRV-*`.

  The account is re-checked after `provider` and `device` verdicts (`wantsAccountCheck`).
- **The controller's options are callbacks:** `clock`, `memory` (`MemorySourceMemory`; keeping it in the profile is step 20's job), `config`, `online`, `checkAccount` and `resolveUrl` (step 19 implements the Tizen redirect probe through it).
- **Not done in 17:** debounced zapping, tracks and language preferences, subtitles, the lifecycle, the screensaver, start-on-last-channel and seeking. They belong to steps 18–20 and phase 7.
- **The three riskiest changes in PR #35:**
  1. The engine contract differs from the sketch; steps 18 and 19 implement it as written.
  2. The classifier's order: an account problem beats "this TV can't play this".
  3. Otherwise only new code in `packages/player`, plus docs. No app, build, migration, deploy or data change.

## Gotchas and lessons
**New in leg 36** (also in memory):
- **Mutation survivors were test gaps:**
  - a stale path that only opens while work is pending: give the fake a `loadMs` and zap during it;
  - "rests" behaviour needs `expect(clock.pending).toBe(0)`;
  - a URL-spelling test needs characters that re-encode differently (`u@x` becomes `u%40x`, but `u%2Fx` round-trips unchanged);
  - replace an equivalent mutant with one that matters.
- **A fake clock's settle step:** `setTimeout(0)` costs about 12 ms on Windows. Use `setImmediate` through a `globalThis` cast; the player package has only DOM types.
- **`FakeClock` runs equal-time timers in insertion order**, so a script event scheduled at load time fires before a watchdog tick due at the same instant.
- **`pnpm build:tv` crashed once** with a native 0xC0000005 before any output, inside `pnpm verify` on a loaded PC. Rerun the build alone, then `pnpm e2e` alone.
- **The mutation script:** `$CLAUDE_JOB_DIR/tmp/mutate17.py` held (name, file, old, new) tuples, plus a control run, `Popen` with a 120 s timeout and `taskkill /T`, a restore in `finally`, and optional mutant names as arguments to rerun some.
  - The job's tmp folder is gone with the job, so rewrite it: about 1.4 s per mutant for `vitest run packages/player`.
- **The bundle probe:** `$CLAUDE_JOB_DIR/tmp/player-probe.py` wrote a temporary `apps/tv/src/zz-player-probe.ts` (importing `./main` plus the player by relative path, since `apps/tv` doesn't depend on `@zoma/player` yet) and a patched copy of `bundle.ts` in `tools/build/src`. It printed core-js modules and minified totals, then deleted both files.

**From earlier legs (still true):**
- **Never `cd`.** A previous leg's tab (with Omar) can send cross-session messages: treat them as Omar's relayed decisions, verify their facts, and reply with SendMessage to the `from` address.
- **Local e2e flakes on a busy PC:** the throttled test, fixture tests and the lab's S2 update e2e. Read the test's own console line before suspecting code.
- **`pnpm verify > log` in the background** can report exit 0 even when verify failed. Read the log.
- **Polyfill probes:** check each new TV file. Avoid `JSON.stringify`, `new RegExp`, `.split(`, and field names that match built-ins (`at`, `includes`…).
- **Python patches in Bash heredocs lose backslashes:** write patch scripts with the Write tool.
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one;
  - use exact float boundaries;
  - fake-clock times on the 50 ms grid;
  - a fake must separate a state change from its callback in time.
- **Vitest has no `__PLATFORM__` define:** keep platform branches inside functions.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the self-test or the CI job.
- **Playwright's Chromium (CfT 156):** no MPEG-TS, AC3/E-AC3 or in-band text; HEVC only headed; `audioTracks` needs `--enable-blink-features=AudioVideoTracks`.
- **The lab under `pnpm dev`** shares the app's origin: use port 5174 for a manual lab run.
- **The Write tool turns `\uXXXX` escapes into raw characters.**
- **Waiting for CI:** wait about 20 s after `gh pr create`, check `gh pr checks <n>` once in the foreground, then use memory `bg-watcher-memory-reap`'s leg-14 Monitor command verbatim (only the PR number changes). Never `<(`.
- **Code rules:** components stay hook-free; CSS uses physical properties only; TV code is `lib: ES2017`. Never edit the engines Docker image's `RUN apt-get` line.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: `pnpm verify`. Lint, typecheck and 2,517 tests passed in the run; `build:tv` passed on its rerun and e2e passed 51/51 in a separate run.
  - The player: 62 tests and 77/77 mutants.
  - PR #35's CI was green, and it is merged.
  - Main's CI on `0f5a692` was green.
- **Not done:**
  - Main's CI on `b53f000` is unchecked.
  - Nothing plays yet: there is no engine, and the player isn't wired into the app.
  - The Simulators weren't re-run with 16a's code.
  - S6 at scale on the TV.
  - The by-hand TV checks: S10, S11 by ear, and S5's suspend and soak.
  - All of Samsung.
  - The Dev Mode extend from the PC is unconfirmed.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Step 16's remaining parts wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30 minutes at the LG TV** for S10, S11 by ear, and S5's suspend and soak.
  - S6 at scale on the TV needs no person.
- **For the leg's own judgement in step 18:** where the playback e2e page lives (a dev-only harness or the lab), and which CI job runs it.
- **Later, from the spikes:**
  - in-band subtitles failed on the LG TV, so step 20's overlay needs our own MKV/MP4 text parser or sidecar files only;
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung).
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 36 was the 36th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
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
  16. the Chromium 53 cheat sheet's heading (since ADR-012 no supported TV runs 53, but the build still targets it), and the `build:tv` row should mention the webOS ACG check (`requiredACG`, `tools/build/src/acg.ts`).
- **Secrets:** none pending. The LG Dev Mode passphrase from 2026-11-04 needs no reminder (Omar said so).
