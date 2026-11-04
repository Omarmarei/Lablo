# Zoma IPTV: relay leg 47 opening prompt

You are leg 47 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–45 did steps 1–20c2b, except step 16's Samsung part, 19b and 21 (PRs #1–#44).
- **Leg 46 split step 22 (EPG sources, 6.1) into 22a and 22b, and did 22a, the refresh schedule:**
  - It merged as PR **#45** (merge commit **`31b2658`**, branch kept).
  - CI on `5b7b3c9`: verify 11 m 29 s, media 11 m 10 s, engines 14 m 12 s, all green on the first run.
  - Main's CI on `76e610f` (PR #44) was checked: green. Main's CI on `31b2658` was in progress when leg 46 ended.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 22b, the guides screen (RELAY.md, Phase 6)
The RELAY.md text: a screen that lists the guides (each source's own and the user's: programmes until, match rate, the last failure) and lets the user add, remove and order XMLTV URLs. The profile keeps the user's guides as a list (a profile migration from the per-source `epgUrl`), and a change starts a refresh. Decide where it opens from (a first settings screen, or the live screen's header or rail) and keep it small.

It has no `Done when:` line yet: write one when you plan the step. Split it if it looks big, and record the split in RELAY.md.

1. **Check for existing work first:** `git log --oneline -30`, then grep `UserGuide`, `guidesOf`, `epgUrl` and `settings` under `apps/tv/src` and `packages/data/src`.
2. **What exists (facts from leg 46):**
   - **The user's guide today is one `SourceRecord.epgUrl: string | null` per source** (profile v3, `packages/data/src/profile.ts`). Onboarding's form types it (`apps/tv/src/onboarding/form.ts`, field `epg`, `normalizeLink`).
   - **How it becomes a guide:** `guidesOf(records)` in `apps/tv/src/onboarding/engine-loader.ts` makes `UserGuide { id: <source id>, url }`, and `epgGuides` turns that into epgSrc `u~<id>`, listed first.
     - **Keep the ids stable in a migration.** A guide that is no longer listed is deleted at the next refresh, and a new id downloads the guide again. Migrating source `s1`'s `epgUrl` to guide id `s1` keeps `u~s1`. New ids need a prefix that can't collide with source ids (`s<n>`), and may not contain `:` or `~`.
   - **`UserGuide` also has `offsetMinutes` and `shiftMinutes`.** They are step 24's (per-source time offset); keep them in the stored shape.
   - **Who reads the user's guides:** the refresh scheduler (`apps/tv/src/data/refresh-scheduler.ts`) reads them from the profile at every pass (`guidesOf(records)`), and so does onboarding's loader. Both must read the new list.
   - **A refresh after a change:** the scheduler has no "now" trigger yet. Add one (for example `refreshNow()`: a check at once, or right after the pass that is running).
     - A new guide (generation 0) is `due` at once.
     - A removed one is deleted by that refresh.
     - Then `onGuides` tells the live screen.
     - A failed guide is held back 2 h (`epgRefreshDue`). Decide whether "Refresh now" on the screen overrides that hold (`refreshEpg` without `due` reads every guide).
   - **State per guide:** `DataEngine.epgStatus()` gives `EpgStatus.guides: EpgMeta[]` (`packages/data/src/epg-store.ts`):
     - `epgSrc`, `gen`, `updatedAt`, `checkedAt`, `failedAt`;
     - `until` (UTC minutes: the last programme end);
     - `summary` (`EpgSummary`: the match rate and window);
     - `rank`.
     - **No failure code is stored**, only `failedAt`. If the screen says why a guide failed (unreachable, not XMLTV, 401/404), the EPG refresh must keep the code too: an optional `EpgMeta` field, with no database migration, since the records are schemaless.
     - `EpgStatus.matched` counts the live channels that have a guide.
   - **No settings screen exists.** Step 38 is "complete settings screen".
     - Where the guides screen opens is this step's decision. Options: a last rail entry; a header button; a small settings screen with one row "TV guides" that step 38 grows.
     - Mind S10: a new remote key would need a new intent, and S10's battery would then ask every TV for it.
     - Record the choice in architecture.md.
3. **Sizes:** main 276.6 KB (Tizen) / 264.0 KB (webOS) of 500; query worker 98.8 KB, EPG worker 115.2 KB and ingest worker 125.6 KB, each of 150. Count core-js modules after any TV-file change with `artifacts/poly-count20c2a.py`: 219 on both, keep it.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`:
   - steps 13b, 22, 22a and 22b;
   - the progress-log rows for legs 22, 24 and 44–46.
3. `docs/architecture.md`:
   - §1.5 "Built in step 9b" and "Built in step 22a" (the newest; also the shape of a "Built in" note);
   - §1.2 "Built in step 13a" (text input on a TV) and "Built in step 14a" (the live screen);
   - §1.3 (the profile).
4. The code:
   - `packages/data/src`: `profile.ts` (`PROFILE_MIGRATIONS`, `ProfileEdit`), `epg-sources.ts`, `epg-store.ts`, `query-service.ts` (`epgStatus`, `editProfile`);
   - `apps/tv/src`:
     - `data/refresh-scheduler.ts`, `data/engine.ts`, `main.tsx`;
     - `live/live-state.ts`, `live/LiveApp.tsx`;
     - `onboarding/engine-loader.ts`, `onboarding/form.ts`, `onboarding/onboarding-state.ts`;
     - `packages/ui` `TextField` and `createTextEditor`.
5. Tests: `packages/data/src/profile.test.ts`, `apps/tv/src/data/refresh-scheduler.test.ts`, `apps/tv/src/live/live-state.test.ts`, `e2e/refresh.spec.ts`, `e2e/onboarding.spec.ts`.
6. Memory:
   - `iptv-ui-test-gotchas`;
   - `iptv-mock-provider-gotchas`;
   - `iptv-tv-bundle-polyfills`;
   - `iptv-parser-test-patterns`;
   - `iptv-css-pipeline-gotchas`;
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `31b2658` was in progress when leg 46 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `e625d82` ("docs: record PR #45's merge"). It is pushed, and the tree is clean.
- **main** has `31b2658` (PR #45). The branch is ahead by `e625d82` and the handover commit, both docs; they go to main with step 22b's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate22a.py` and `.log` (the newest mutation template; the log is the first run's 82/85);
    - `poly-count20c2a.py`: counts main's core-js modules from Rollup's module table (219 on both);
    - `verify22a.log` and `verify22a-2.log`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 46 (step 22a, architecture.md §1.5 "Built in step 22a")
- **What was missing:** nothing refreshed anything after onboarding. The catalog's "at launch if stale" (§1.4 item 1) had no caller. Step 22a put it in the same scheduler, since "guides after a catalog refresh" ties the two together.
- **The scheduler** (`createRefreshScheduler`) is started by `main.tsx`'s `showLive` (`startRefreshes`). It doesn't run on the hello or gallery screens.
  - **When:** the first check 15 s after the live screen opens, then every 15 min from the end of a pass. Nothing while the app is hidden; a check 15 s after it is visible again.
  - **Catalogs:** a source is due 12 h after `checkedAt` (else `updatedAt`), or when none is stored. They are refreshed one at a time; a failure is held 2 h, in memory.
  - **Guides:** `refreshEpg` with `due`, or every guide after a catalog committed (`readAll` carries over when the slot was busy).
  - **A busy slot** retries in 1 min.
  - **Callbacks:** `onCatalog` (the formats are read again, then `live.catalogChanged()`) and `onGuides` (`live.guidesChanged()`).
- **The live screen:**
  - **`guidesChanged`:** a guide epoch makes every answer stale; the rows keep their old answer until the new one comes. The player's last 4 channels asked through `list.askGuide` are re-asked with the rows, and at the minute tick once their programme has ended.
  - **`catalogChanged`:** a quiet reload.
    - The rail entry stays (by source and name).
    - The chunks are cleared; now/next is kept.
    - The focus follows the channel it is on when the new list arrives, unless it moves while the row is found.
    - It calls `listChanging` first, while the old rows can still be read.
- **The player's `listChanging`:**
  - It pins the row playing (the start's `pinned` mechanism) and moves it with `locate`; PRE-CH's channel moves too.
  - It pins nothing when nothing played yet. Pinning a zap's target would make its later play skip `tuned`, the profile's last channel; leg 46 found this and fixed it.
- **Not in e2e:** a catalog that changes. The mock serves one catalog, so the quiet reload is covered by unit tests only.
- **Checks:**
  - 3,312 unit tests (+60);
  - `pnpm verify` green twice (64 e2e, +1 `refresh.spec.ts`);
  - mutation 82/85, then 84/84;
  - main +3.7/+3.7 KB, 219 core-js modules.

## How Omar can see step 22a
There is nothing new to click: it all happens in the background.
- **Quickest:** `pnpm exec playwright test e2e/refresh.spec.ts` (about 5 s). The page's clock jumps 2 h and 12 h, and the mock counts the app's requests.
- **By hand, over a day:**
  1. Onboard with the mock (`pnpm mock`, `pnpm dev`, server `localhost:8080`, user `zoma`, password `zoma-test`).
  2. Open the app again the next day (more than 12 h later).
  3. In DevTools' Network tab, about 15 s after the channel list shows, there is one `player_api.php?…action=get_live_streams` and one `xmltv.php`, and the list stays where it was.
- **The step-20 player checklist** is in the leg-45 handover: `git show b3c53af:HANDOVER.md`.

## Gotchas and lessons
**New in leg 46** (also in memory):
- **Playwright's page clock in e2e** (`e2e/refresh.spec.ts`, the repo's first use):
  - Call `page.clock.install()` before `page.goto`. Time then flows as usual.
  - `page.clock.fastForward('02:01:00')` fires each timer that fell due **once**, like a TV waking up.
  - The data workers and the mock keep the real clock, so the page runs hours ahead of every stored time.
- **Counting what the app asks the mock** (worker fetches included): call `app.addHook('onRequest', …)` on the in-process mock before `listen(app)`.
- **Switching the mock's scenario in a test:** `app.mockState.scenario = null` (or start it with `mock({ scenario: 'no-xmltv' })`).
- **Mutation lessons:**
  - The navigator clamps `focus(-1)` to a valid row. A test whose focus had already been clamped hid a `found === -1` check; test a gone channel whose row still exists.
  - Re-asking the oldest entry of a small LRU list hides its de-duplication; re-ask a middle one.
  - A signal set to a new array (the rail) redraws the screen anyway, so a `bump()` next to it is masked.
  - Guards that other guards mask were removed before the run (listed in architecture.md).
- **Python patch scripts:**
  - Write them with the Write tool to `$CLAUDE_JOB_DIR/tmp`, then run `python -I`.
  - A heredoc again ate `\'` in a TS test name; use double quotes for names with an apostrophe.
  - A multi-file patch script that exits on its first miss may have written the earlier files already: check `git status` before running it again.
- **Waiting:** a foreground `until …; do sleep …` in Bash with a `timeout` works for local files; for gh, use the background loop below.

**From earlier legs (still true):**
- **Waiting for a PR's checks:**
  - Read `gh pr checks N -R Omarmarei/zoma-iptv` once in the foreground first: right after `gh pr create` it says "no checks reported".
  - Then wait in the background with `while gh pr checks N -R Omarmarei/zoma-iptv 2>&1 | grep -q -E "pending|in_progress|queued"; do sleep 60; done`.
  - Never `&&` on gh's exit code: it is non-zero on a failed check, so such a loop never ends.
- **`pnpm e2e:media` is two specs,** `playback-media.spec.ts` and `player-media.spec.ts`. Run all of it when what `PlayerController` publishes changes.
- **TV bundle polyfills:**
  - A field or member named `at` pulls `Array.at` polyfills (`time`, `started`, `cuesAt`).
  - A `Uint8Array` in a TV file pulls 35 core-js modules; a `DataView` pulls none.
  - Count main after any TV-file change (219 is the number to keep).
- **Every hand-built mock `Account` literal in tests needs `outputFormats`.** Every hand-built `PlayerEngine` needs `caps.fits` and `setFit`.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files; the mutation run swaps them). Docs are safe.
- **Local e2e flakes on a busy PC:** the throttled test, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it.
- **Vitest:**
  - `quiet()` for a voided load;
  - awaiting a `FakeEngine.stop()` without advancing the clock deadlocks (use `void`);
  - no `__PLATFORM__` define;
  - fake-clock settles go through `setImmediate`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs; Arabic catalog text needs an Arabic letter and has no Latin words of its own;
  - provider text, URLs and technical names use `dir=auto`/`dir=ltr` + `translate=false`, or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(`, typed arrays, and members named like built-ins (`at`!);
  - the app imports only types from `@zoma/data` (use narrow entries like `@zoma/data/client`);
  - a new screen root needs `data-screen/zone/index` and `showFocus`;
  - a new profile shape needs a migration in `PROFILE_MIGRATIONS` (pure, never drops data; pin the version in `profile.test.ts`). An optional field needs none.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,312 unit tests, `pnpm verify` (64 e2e) twice, mutation 84/84, the polyfill count (219 on both platforms).
  - The refresh e2e fails with the scheduler off.
  - PR #45's CI green on all three jobs; merged as `31b2658`.
  - Main's CI on `76e610f` green.
- **Not done:**
  - Main's CI on `31b2658` is unchecked.
  - The schedule has never run on a TV: suspend and resume timing, and a refresh during playback on a low-tier TV (step 41).
  - A catalog change through the mock in e2e.
- **Migrations and deploys:** N/A (no backend until step 29). Step 22b will likely add **profile version 4**: an app-side IndexedDB document migration, not a production migration.

## Open decisions and gates
- **Step 22b's scope, its split, and where the guides screen opens from** are the leg's judgement; record them.
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:**
    - S10, including the codes of the audio, subtitle and picture-size keys;
    - S11 by ear;
    - S5's suspend and soak;
    - the player itself (step 21): 50 rapid zaps, a soak with stalls, and launch-to-frame from the marks.
- **Later, from the spikes:**
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung);
  - the last frame kept while reconnecting (AVPlay has `setVideoStillMode`);
  - a settings screen for the track languages, the subtitle style and the picture mode;
  - parsing subtitle files off the main thread.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41); whether a low-tier TV holds refreshes while it plays (step 41).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 46 was the 46th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks; Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-five CLAUDE.md gaps** are waiting for his word:
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
  19. the player in the app (`apps/tv/src/player`: the stage, `appPlayer`, the keys) in the `pnpm dev` row, the query worker's `account` call, and `e2e/player-media.spec.ts` in the `e2e:media` row;
  20. the desktop keys `a` (audio) and `c` (subtitles) in the `pnpm dev` row's key list, and the `AUDIO`/`SUBTITLES` intents (Tizen MTS/Caption) next to the remote-keys note;
  21. the mock row's `/subtitles/<u>/<p>/<id>.<eng|ara>.<srt|vtt>[?charset=windows-1256]`, and the playback harness's subtitle calls (`externalSubs`, `selectText`, `setSubtitleDelay`, `setSubtitleSize`) in the `pnpm dev` row;
  22. the `pnpm dev` row should say a relaunch plays the last channel (profile v3's `player` section), the `zoma:*` User Timing marks, and `createPlatform({ redirects })`;
  23. the mock row's `output_formats` per account and the HLS-only `hls` account; the `pnpm dev` row's "Stream info" button;
  24. the `pnpm dev` row's "Picture" button (Fit, Zoom, Stretch, 4:3; kept in the profile), and the engines' `setFit`/`caps.fits` beside `setRect`;
  25. **new:** the `pnpm dev` row should say the app refreshes stale catalogs (12 h) and due guides by itself, from 15 s after the live screen opens (`refresh-scheduler.ts`), and the `pnpm e2e` row should name `page.clock` in `refresh.spec.ts`.
- **Secrets:** none pending.
