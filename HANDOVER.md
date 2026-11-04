# Zoma IPTV: relay leg 50 opening prompt

You are leg 50 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–48 did steps 1–20c2b, 22a, 22b1 and 22b2a, except step 16's Samsung part, 19b and 21 (PRs #1–#47).
- **Leg 49 did step 22b2b**, the guides screen's full e2e in English and Arabic. That closes 22b2, 22b and step 22 (EPG sources), all ticked.
  - It merged as PR **#48** (merge commit **`9ff6073`**, branch kept).
  - CI on `bd87fbd`: verify 9 m 1 s, media 18 m 22 s, engines 12 m 8 s, all green on the first run.
  - **Main's CI on `c800431` (PR #47):** verify and engines were green. `media` was cancelled at its 30-minute limit because apt took 15 minutes to install ffmpeg; every test step had passed. Leg 49 reran it, but main's new run on `9ff6073` shares the concurrency group (`ci-main`) and supersedes it. **Check main's run on `9ff6073`.**
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 23, the grid guide (RELAY.md, Phase 6)
RELAY.md says: "Grid guide (6.2). Virtualized on both axes, time cursor, RTL. **Done when:** each key press in the grid is handled in ≤ 150 ms in the throttled e2e."

It is too big for one leg, so **split it first** in RELAY.md (as legs 44–48 split theirs), then do the first part.
1. **Check for existing work first:**
   - `git log --oneline -15`.
   - The focus engine's `epg` zone already exists (step 10, `packages/ui/src/focus/epg.ts`; architecture.md §1.2 "Built in step 10", the `epg` zone bullet). It has rows, a time cursor in UTC minutes, `cell(row, minute)` from the screen, `slot`, `span` and `view`, and RTL through the one logical swap. The screen must fill the gaps between programmes with placeholder cells.
   - `VirtualList` in `packages/ui/src/components` is one-axis only.
   - Grep for `EpgGrid`, `GuideGrid` and `epg-grid`: there is no grid component yet.
   - The data side has the store's per-channel-day buckets (`readEpgBuckets`, `readEpgChannels` in `packages/data/src/epg-store.ts`; architecture.md §1.5 item 7: one record per channel per day, with column arrays). The query worker answers now/next (`query-service.ts`), but nothing answers "these channels over these hours" yet.
2. **Read for the split:**
   - PLAN.md: section 6.2, line ~229 ("up to 7 days"), and the Phase 6 rows (~391, ~1418): a 7-day grid (3 days on the low tier) on a 5k-channel fixture, at ≤ 150 ms per key on a 2018 TV.
   - architecture.md ~line 1264: the live list's throttled budget is 200 ms because a CI runner at 4x is about twice as slow as a desktop. "Step 23's grid budget (150 ms) should be calibrated against CI the same way." See memory `iptv-throttled-e2e`.
3. **A split that fits one leg each (a suggestion; adjust after reading):**
   - **23a, the data side:** programmes for a window (a range of rows × hours) from the query worker, merged across guides by rank (the same rule now/next uses), read from the day buckets. Unit tests, and a bench at scale (`pnpm fixtures`, `pnpm bench`).
   - **23b, the grid component** in `packages/ui`:
     - virtualized on both axes, bound to the `epg` zone;
     - a time header and a "now" line;
     - placeholder cells for the gaps;
     - mirrored in RTL (physical CSS plus rtlcss; times inside `dir=ltr`);
     - a gallery entry and unit tests.
   - **23c, the guide screen in the app:**
     - **The way in:** decide it the way leg 47 decided Settings. A "Guide" button in the live screen's header, beside "Settings", fits; avoid a new remote key, because S10's key battery would ask every TV for it.
     - OK on a programme plays its channel.
     - e2e in English and Arabic against the mock.
   - **23d, the throttled e2e:** ≤ 150 ms per key in the grid, calibrated on CI, in the full and the low tier.
4. **Sizes now:** main 294.5 KB (Tizen) / 281.9 KB (webOS) of 500. Workers of 150 each: query 99.6 KB, EPG 115.6 KB, ingest 126.0 KB.
   - After any TV-file change, count core-js modules with `artifacts/poly-count20c2a.py` (`python -I -u`). It should stay at 219 on both platforms.
   - Probe each new TV file for polyfills (memory `iptv-tv-bundle-polyfills`). Typed arrays in a TV file cost 35 core-js modules (+13.9 KB). The grid's data should cross from the worker as plain arrays, or stay in the worker.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: step 23, Phase 6, and the progress-log rows for legs 46–49.
3. `docs/architecture.md`:
   - §1.2 "Built in step 10" (the focus engine's `epg` zone);
   - §1.5 item 7 (EPG storage);
   - §1.5 "Built in step 22b2b", "22b2a" and "22a"; §1.2 "Built in step 14a" (the live screen, now/next in the list);
   - the throttled-e2e notes near line 1264.
4. The code:
   - `packages/ui/src/focus/epg.ts` and `zones.ts`;
   - `packages/ui/src/components/VirtualList.tsx`;
   - `packages/data/src/epg-store.ts`, `query-service.ts` and `client.ts`;
   - `apps/tv/src/live/` (`live-state.ts`, `LiveApp.tsx`: the header zone and `SETTINGS_SCREENS`);
   - `apps/tv/src/settings/` (the newest screen, for the patterns).
5. Tests: `e2e/live-throttled.spec.ts`, `e2e/live.spec.ts` (`layout()`), `e2e/guides.spec.ts` (the newest e2e: `listed()`, `textSpan`, the RTL side checks), `e2e/remote-driver.ts`, `e2e/onboard.ts`.
6. Memory:
   - `iptv-ui-test-gotchas`;
   - `iptv-throttled-e2e`;
   - `iptv-tv-bundle-polyfills`;
   - `iptv-data-layer-test-gotchas`;
   - `iptv-parser-test-patterns`;
   - `iptv-bench-measurement`;
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `9ff6073`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` shows `cancelled`, read its step times before blaming the code. Leg 49's cancel was a slow apt install hitting the 30-minute limit.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `00e9a25` ("docs: record PR #48's merge"). It is pushed, and the tree is clean.
- **main** has `9ff6073` (PR #48). The branch is ahead by `00e9a25` and the handover commit, both docs; they go to main with step 23's first PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate22b2b.py` and `.log`: the newest template, an e2e mutation pass that runs one Playwright spec per mutant (11/11);
    - `mutate22b2a.py` and `.log`: the newest unit-test mutation template (93/93);
    - `poly-count20c2a.py`: counts main's core-js modules (219 on both);
    - `verify22b2b.log`;
    - `screenshots/`: `live-header-`, `settings-`, `guides-`, `guides-add-`, `guides-added-`, `guides-menu-`, `guides-removed-`, `guides-failed-` and `guides-listed-`, each in `en` and `ar`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 49 (step 22b2b)
- **`e2e/guides.spec.ts` has two tests, each run in `en-US` and `ar-SA`:**
  1. Add, move and remove:
     - add `/epg/guide.xml`, then `/epg/guide.xml.gz`;
     - Move up, then Move down;
     - Cancel and Back change nothing;
     - Remove, and the focus stays on the removed guide's place;
     - the profile is read back after each change.
  2. Failures and refusals:
     - `/epg/missing.xml` fails with code `http` and the 404 text;
     - a `get.php` playlist link fails with code `format`, and its row shows no login;
     - the panel's own `xmltv.php` link is refused as "already in the list".
  - **Both tests** check the safe area. In Arabic they also check the sides with Range text spans:
    - links and status lines on the right;
    - "Add a guide" opposite the title;
    - the form's "Add" first, with mirrored arrows (LEFT goes to "Cancel");
    - the menu's labels on the right.
- **Fixed:** the row menu's buttons stopped at `.z-button`'s 640 px `max-width`. `.guides__menu .z-button { max-width: none }` makes them span the dialog.
- **Not an app bug:** a `listed()` helper that read `data-count` apart from the rows hung `expect.poll` after a remove. It now reads them in one `page.evaluate` (memory has it).
- **Checks:** 3,518 unit tests (unchanged), `pnpm verify` green (68 e2e, +3), e2e mutation 11/11. Main is unchanged: the CSS is kept out of main.js, and no TV script changed.
- **The 3 riskiest changes that went in (PR #48):**
  1. The CSS override above; it is scoped to the guides menu.
  2. The e2e depends on the mock's `/epg/guide.xml.gz` and its 404 handler for unknown paths.
  3. There was no migration, permission or data change.

## How Omar can see the guides screen (step 22b2's "press these keys" checklist)
Run `pnpm mock`, then `pnpm dev`, and open the dev URL. For Arabic, use a private window with `?locale=ar-SA`: a fresh profile starts at onboarding.
1. **Onboard:** Xtream, server `localhost:8080`, user `zoma`, password `zoma-test`, then "Start watching".
2. **Open the guides screen:**
   - On the live screen, press **UP** to reach "Settings" (top right; top left in Arabic), then **Enter**. Press **Enter** on "TV guides".
   - The panel's own guide shows `localhost:8080/xmltv.php`, "From localhost", its end and "Channels matched: 11 of 12 (92%)". **Enter** on it does nothing (a panel's guide has no menu).
3. **Add a guide:**
   - **UP** to "Add a guide", then **Enter**.
   - **Enter** again, type `localhost:8080/epg/guide.xml`, then **Enter** (the focus moves to "Add"), then **Enter**.
   - The new guide comes first, focused, "Added by you". It says "Reading…", then shows its end and match rate.
4. **Move:**
   - Add `localhost:8080/epg/guide.xml.gz` the same way. It comes second, focused.
   - **Enter** on it: Move up, Remove, Cancel (no Move down: the panel's guide is below it). The buttons span the dialog.
   - Choose "Move up": it goes first, with the focus.
   - **Enter** on it again: Move down, Remove, Cancel. "Move down" puts it back.
5. **Cancel and remove:**
   - **Enter**, then "Cancel" (or **Escape**): nothing changes.
   - **Enter** on the second guide, then "Remove": it goes, and the focus lands on the panel's guide.
6. **Links that fail:**
   - Add `localhost:8080/epg/missing.xml`. It reads "Couldn't read it: the server answered with error 404.".
   - Add `localhost:8080/get.php?username=zoma&password=zoma-test&type=m3u_plus`. The row shows only `localhost:8080/get.php` and reads "Couldn't read it: this link didn't give an XMLTV guide.".
7. **A refused link:** add `localhost:8080/xmltv.php?username=zoma&password=zoma-test`. The field says "This guide is already in the list.", and **Escape** closes the form.
8. **In Arabic:**
   - the links read left to right but sit on the right;
   - "إضافة دليل" sits on the left;
   - in the add form, "إضافة" is on the right, and **LEFT** goes to "إلغاء".
9. **Back out:** Escape twice returns to the live screen's header; **DOWN** goes back to the list.

The step-20 player checklist is in the leg-45 handover: `git show b3c53af:HANDOVER.md`.

## Gotchas and lessons
**New in leg 49** (also in memory):
- **Read a list's count and its rows in one `page.evaluate`.** Playwright's auto-wait on a row that vanished between two reads hangs the whole `expect.poll`. It looked like an app bug until a probe dumped the DOM.
- **RTL side checks** measure text with a Range over the element's contents. A flex item's own box spans the free space, so it can't show where the text sits.
- **A `cancelled` CI job** can be its `timeout-minutes` (a slow apt mirror). Read the step times, then `gh run rerun <id> --failed`. The next push to main cancels that rerun (`concurrency: ci-${{ github.ref }}`).
- **An e2e mutation pass** (`artifacts/mutate22b2b.py`) proves layout and RTL checks can fail. It takes about 25 s per mutant (each run starts Vite).

**From earlier legs (still true):**
- **ar-SA formats Western digits** (ADR-011).
- **e2e text checks need `stripIsolates`** (`packages/core/src/bidi`).
- **A cleanup can make another guard dead.** After removing a call, re-check the guards in the function it called.
- **A held test fake that throws inside its `resolve` must route the throw to `reject`.**
- **`pathlib.write_text` on Windows writes CRLF.** Use `newline='\n'`.
- **Patch scripts:**
  - Write every multi-line patch script to `$CLAUDE_JOB_DIR/tmp` (Write tool, or a `cat > … <<'EOF'` with no apostrophes inside), then run `python -I <script> "<wt>"`.
  - A multi-file patch that stops at its first miss may already have written earlier files: check `git status` before rerunning it.
  - Use Edit for any line with a backslash.
- **Waiting for CI:**
  - First read `gh pr checks N -R Omarmarei/zoma-iptv` with an `until … grep -q -E "pending|pass|fail"` loop. Right after `gh pr create` it says "no checks reported".
  - Then wait with a foreground `until ! gh pr checks N … | grep -q -E "pending|in_progress|queued"; do sleep 30; done` and `timeout: 600000`. It moves to the background at 10 min, which is fine.
  - A bare `sleep 25; gh …` is blocked. Never `&&` on gh's exit code (it is non-zero on a failed check).
- **Playwright's page clock** (`e2e/refresh.spec.ts`):
  - `page.clock.install()` goes before `page.goto`.
  - `page.clock.fastForward('02:01:00')` fires each due timer once.
  - The workers and the mock keep the real clock.
- **Counting what the app asks the mock:** `app.addHook('onRequest', …)` before `listen(app)`. Switch scenarios with `app.mockState.scenario = null`.
- **Mutation lessons:**
  - write the mutation list first, and remove masked guards before the run;
  - the navigator clamps `focus(-1)`: test a gone item whose row still exists;
  - `splice` rounds and clamps its index by itself;
  - a signal set to a new array redraws the screen anyway, so a `bump()` beside it is masked.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Vite serves live files, and the mutation run swaps them. Docs are safe.
- **Local e2e flakes on a busy PC:** the throttled test, and the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it.
- **TV bundle polyfills:**
  - a field or member named `at` pulls `Array.at` polyfills;
  - a `Uint8Array` in a TV file pulls 35 core-js modules;
  - avoid `JSON.stringify`, `new RegExp` and `.split(`;
  - avoid object rest and array destructuring in worker code;
  - count main after any TV-file change (219).
- **Test literals:**
  - every hand-built mock `Account` needs `outputFormats`;
  - every hand-built `PlayerEngine` needs `caps.fits` and `setFit`;
  - an `EpgRefreshResult` needs `reranked: []`;
  - failed outcomes need `status: null`.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs; Arabic catalog text needs an Arabic letter and has no Latin words of its own;
  - provider text, URLs and technical names use `dir=auto`/`dir=ltr` + `translate=false`, or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`;
  - the app imports only types from `@zoma/data` (values from narrow entries like `@zoma/data/client`; tests may import values);
  - a new screen root needs `data-screen/zone/index`;
  - a new profile shape needs a migration in `PROFILE_MIGRATIONS`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,518 unit tests, `pnpm verify` (68 e2e), e2e mutation 11/11, and screenshots of every guides state in both languages.
  - PR #48's CI green on all three jobs; merged as `9ff6073`.
  - Main's CI on `c800431`: verify and engines green; `media` timed out (slow apt), and every test step in it passed.
- **Not done:**
  - Main's CI on `9ff6073` is unchecked.
  - The 3 → 4 profile migration and the settings screens have never run on a TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:**
    - S10, including the codes of the audio, subtitle and picture-size keys;
    - S11 by ear;
    - S5's suspend and soak;
    - the player itself (step 21): 50 rapid zaps, a soak with stalls, and launch-to-frame from the marks.
- **Step 23's way into the grid:** decide it in the leg (a header "Guide" button is the default; no new remote key) and record it in RELAY.md. It is not a gate.
- **Later, from the spikes:**
  - an on-screen keyboard of our own if the TV keyboards fail (S10; the guides screen's link field depends on it too);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung);
  - the last frame kept while reconnecting;
  - step 38's settings rows (track languages, subtitle style, picture mode) on the settings screen;
  - parsing subtitle files off the main thread.
- **Later cleanups:**
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier (step 41);
  - whether a low-tier TV holds refreshes while it plays (step 41);
  - the catalogs as a UTF-8 file if they keep growing (each Arabic letter costs 6 bytes in main.js).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 49 was the 49th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-seven CLAUDE.md gaps** are waiting for his word:
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
  25. the `pnpm dev` row should say the app refreshes stale catalogs (12 h) and due guides by itself, from 15 s after the live screen opens (`refresh-scheduler.ts`), and the `pnpm e2e` row should name `page.clock` in `refresh.spec.ts`;
  26. the Conventions line on profile migrations should name version 4 (the guide list);
  27. the `pnpm dev` row should name the header's "Settings" → "TV guides" (`apps/tv/src/settings`), and the mock row its `/epg/guide.xml` link for adding a guide.
- **Secrets:** none pending.
