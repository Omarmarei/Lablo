# Zoma IPTV: relay leg 52 opening prompt

You are leg 52 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–50 did steps 1–22 and 23a, except step 16's Samsung part, 19b and 21 (PRs #1–#49).
- **Leg 51 did 23b (the grid component)** and added step **23e** (the grid on Chromium 53/56/68) to RELAY.md:
  - It merged as PR **#50** (merge commit **`58d1c47`**, branch kept).
  - CI on `f103ae4`: verify 10 m 48 s, media 13 m 31 s, engines 14 m 13 s. Engines' first run hit the DevTools flake on Chromium 56 and was green on the rerun.
  - Main's CI on `33e5a51` (PR #49) was green. **Check main's run on `58d1c47`.**
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 23c, the guide screen in the app (RELAY.md, Phase 6)
RELAY.md's 23c (read the whole entry there):
- **The way in:** a "Guide" button in the live screen's header, before "Settings". No new remote key: S10 would have to ask every TV for it.
- **The rows:** the live screen's current category. The first focus goes on the channel focused in the list, at now.
- **The data:** kept per channel-day on the screen. Ask for the rows in view ± a page, over the days the view crosses. A guide swap re-asks.
- **Keys:** OK on the programme on air plays its channel. Back returns to the list on the same channel.
- **Done when:**
  - unit tests of the screen's state: the rows, data asked for and dropped when stale, the focus, OK, Back;
  - e2e by keys against the mock, in English and Arabic: open from the header, move across rows and time, the mock's schedule in the cells, OK plays, Back;
  - screenshots looked at, `pnpm verify` green, a mutation run, the PR merged;
  - the "press these keys" checklist in the handover.
- **If 23c is too big for one leg,** split it in RELAY.md, as earlier legs did. For example: 23c1 the screen's state and data with unit tests; 23c2 the header button, the e2e and the checklist.

### What exists (check it before writing anything)
1. **The component (23b)**, in `packages/ui/src/components`:
   - **`GuideGrid` props:** `binding`, `screen`, `zone` (an `epg` zone), `channel(row) => { number?, name }`, `schedule(row) => GuideSchedule | null`, `now`, `formatTime(minute)`, `formatDay?(minute)`, `placeholder`, `testId`.
     - A row with no schedule (`null`: not read yet, or no guide) draws placeholders.
     - The query worker's `GuideRow` (`{ key, epgSrc, start[], end[], title[] }`) is a `GuideSchedule` as it is.
   - **`guideZone(spec, schedule)`** makes the `epg` zone whose `cell` is `guideCellAt` over the same `schedule`. Give the grid that same function, and the focus is always on a drawn cell.
   - **`guideCellAt(schedule, range, minute)`** gives the cell holding a minute: `{ start, end, programme }`, where `programme` is an index into the schedule's arrays, or -1 for a placeholder. OK and the details line use it, as `GuideGalleryApp.tsx` does.
   - **Sizes** come from `guide-layout.ts`:
     - `GUIDE_LAYOUT`: a 56 px header, 80 px rows after 8 px gaps, a 400 px channel column, 11 px a minute;
     - `guideFits(height)` gives the zone's `visibleRows`;
     - `guideWidth(span)`: 120 minutes give 1,728 px, the safe area's width.
   - **The zone's `now`** is only where the cursor starts. The grid's `now` prop draws the now line and the looks of programmes gone by and on air: tick it each minute (the live screen has a clock signal).
2. **The model to copy:** the gallery page `?screen=gallery-guide`:
   - `apps/tv/src/gallery/guide-gallery.ts` and `GuideGalleryApp.tsx`;
   - its header shows the focused programme with its own times, and what OK selected;
   - `e2e/guide-gallery.spec.ts` has `readGrid` (everything in one `page.evaluate`) and `checkGeometry` (every box measured from the timeline's inline start). Reuse both for the screen's e2e.
3. **The data (23a):** `DataEngine.guide({ keys, from, to })` in `apps/tv/src/data/engine.ts`.
   - An ask over 2,000 channel-days is refused with a `RangeError`. A page of rows over two or three days is a few hundred.
   - It reads the day before `from` by itself.
   - architecture.md §1.5 "Built in step 23a" has the rules: which guide feeds a row, the tvg-shift, the cut across days.
4. **The live screen** (`apps/tv/src/live`: `live-state.ts`, `LiveApp.tsx`, `live.css`):
   - its `header` zone holds "Settings" (step 22b2a): UP from the first row of the rail, the list or "Try again"; DOWN and Back return;
   - screens pushed on the live navigator paint from `LiveApp` (`SETTINGS_SCREENS`), as the player does;
   - how OK on a row plays a channel: the live list's select into `appPlayer` / `createPlayer`;
   - how the list re-asks now/next after a guide swap: `guidesChanged`.
5. **The range for the screen (suggestion):** from local midnight of the first day kept (`EPG_WINDOWS` in core: past and future days per tier), to the end of the last day.
   - `from` must sit on a slot boundary in the TV's own time: use local midnight, as `GUIDE_DAY` does (`new Date(y, m, d).getTime() / 60_000`).
   - Slots count from `from`.

### Design notes from leg 51 (suggestions; decide in the leg)
- **Redraws:** `@preact/signals` skips a child whose props didn't change (memory `iptv-ui-test-gotchas`, leg 39). The grid reads only the focus signal.
  - When a page of rows arrives, the screen must make the grid redraw: read a version signal in the screen component, and pass fresh `schedule`/`channel` functions or a version prop.
  - The zone's `cell` reads `schedule(row)` live, so new data needs no `screen.update`. A new row count (another category) does.
- **Data per channel-day:** key it by the channel's key and day. Drop rows far out of view, as the live list's chunk cache does (8 chunks kept).
  - The focused row's cell can change when its data arrives: the cursor stays and the cell under it changes. That is fine.
- **OK on air plays; OK elsewhere** (a future or past programme): do nothing for now. Programme details are step 24, catch-up step 25. Write down the choice.
- **The header:** the focused programme (title with `dir="auto" translate=false`, its own time range in the page's direction) and the channel, as the gallery page shows it.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`:
   - steps 23, 23a–23e;
   - the progress-log rows for legs 48–51.
3. `docs/architecture.md`:
   - §1.2: "Built in step 14a" (the live screen) and "Built in step 23b" (the grid, just written);
   - §1.5: "Built in step 22b2a" (the header and pushed screens) and "Built in step 23a" (the data);
   - §4's throttled-run notes (for 23d).
4. The code:
   - `packages/ui/src/components/` (`GuideGrid.tsx`, `guide-cells.ts`, `guide-layout.ts`, and their tests);
   - `apps/tv/src/gallery/guide-gallery.ts` and `GuideGalleryApp.tsx`;
   - `apps/tv/src/live/` and `apps/tv/src/settings/` (the header button and pushed screens);
   - `apps/tv/src/data/engine.ts` (`guide`);
   - `e2e/guide-gallery.spec.ts`, `e2e/live.spec.ts`, `e2e/guides.spec.ts` (opening a screen from the header).
5. Memory:
   - `iptv-ui-test-gotchas`;
   - `iptv-css-pipeline-gotchas`;
   - `iptv-mock-provider-gotchas` (now/next e2e needs `mock({ now: Date.now })`);
   - `iptv-tv-bundle-polyfills`;
   - `iptv-parser-test-patterns`;
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `58d1c47`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` shows `cancelled`, read its step times before blaming the code. The ffmpeg apt install took 11.5 min on `33e5a51` and 15 min once before.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call. The shell starts in the main checkout, which has no `tsx`: a one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `c12d0e7` ("docs: record PR #50's merge"). It is pushed, and the tree is clean.
- **main** has `58d1c47` (PR #50). The branch is ahead by `c12d0e7` and the handover commit, both docs; they go to main with 23c's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media and the scale fixtures included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate23b.py` and `.log`: the newest unit mutation template (69/69; it keeps each file's CRLF or LF);
    - `mutate23b-e2e.py` and `.log`: CSS mutants against one e2e spec (12/12);
    - `poly-count20c2a.py`: counts main's core-js modules (219 on both);
    - `verify23b.log`, `verify23b-2.log`;
    - `screenshots/guide-gallery-{en-US,ar-SA}.png` (both looked at).
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 51 (step 23b)
- **One function for focus and drawing:** `guideCellAt` is the zone's `cell` (through `guideZone`), and `guideCellsIn` walks it to draw. The engine's LEFT/RIGHT therefore visit exactly the drawn cells (a unit test walks a row both ways).
- **A row's cells cover the guide's `[from, to)` once:**
  - a programme is cut to the range and at the next start (of two with one start, the last wins);
  - a gap is filled with placeholders cut at the slot boundaries, counted from `from`, so a row with no data has the zone's own slots;
  - nothing under `GUIDE_MIN_GAP` (5 min) stands alone: a short gap after a programme is that programme's cell, and a slot boundary within 5 min of a gap's end is skipped;
  - only a short gap at the guide's very start stays a lone placeholder;
  - one binary search per cell, no cache.
- **Decided (not a gate):** slot labels and a programme's time range follow the page's direction, as the player's info bar does. In Arabic the start is on the right, read first, with «م» after its time. Only the media timeline is forced left to right. The 23b plan had said `dir=ltr`; this replaced it.
- **RTL:** positions are CSS variables (`--x`, `--w`) written as `left: var(--x)` in `GuideGrid.css`, which rtlcss turns into `right`. The cut arrows are border triangles and mirror too. No code of ours handles the direction.
- **The gallery page** `?screen=gallery-guide`:
  - 40 made-up rows on a fixed evening: 20:17 on 2026-11-05 in the browser's own time zone;
  - 9 rows in view, two hours across;
  - Back follows the platform, with no exit dialog.
  - It is its own route, so the component gallery and its old-engine checks are unchanged.
- **New catalog keys:** `guide.noInfo` ("No information" / «لا توجد معلومات») and `gallery.guideTitle`.
- **Cosmetic, known:** a cell narrower than its padding shows its title clipped without an ellipsis (a 3-minute end of a cut cell). Leave it unless it bothers Omar.
- **Checks:**
  - 3,574 unit tests (+45), with three fast-check properties against a minute-by-minute oracle;
  - e2e 72 (+4: `guide-gallery.spec.ts`);
  - `pnpm verify` green twice;
  - mutation 67/70 on the first run, then 69/69 (a masked guard removed, a test gap closed);
  - CSS against the e2e 12/12.
- **Sizes now:**
  - main 304.3 KB (Tizen) and 291.7 KB (webOS) of 500, +9.7 KB with the gallery page;
  - app.css 52.3 → 58.8 KB;
  - workers unchanged: query 100.8, EPG 115.6, ingest 126.0 KB;
  - core-js modules in main: 219 on both.
- **The 3 riskiest changes that went in (PR #50):**
  1. The gallery page and its demo rows ship in main.js (+9.7 KB), as the component gallery already does.
  2. `epg.ts` exports `slotLength`/`slotStart` (logic unchanged), and the cells depend on them.
  3. There was no migration, permission or data change.

### "Press these keys" (step 23b, desktop)
1. `pnpm dev`, then open `http://localhost:5173/?screen=gallery-guide`.
2. RIGHT and LEFT go programme by programme. The line under the title shows the programme and its own times; "Evening Bulletin" reads 8:00–8:28 PM in a cell to 8:30.
3. UP and DOWN change channel and keep the time. PageDown and PageUp page 9 channels.
4. Past 10 PM the view moves on by half-hours, the header's times with it, and the red now line leaves.
5. Enter shows "Selected: …".
6. A mouse hover on the Football match (it began before the view) focuses it without scrolling.
7. Add `&locale=ar-SA`: the channels are on the right, time runs leftwards, and LEFT goes forward. Add `&locale=en-XA`: every string of ours is bracketed.

## Gotchas and lessons
**New in leg 51** (also in memory):
- **A connection error can end a CI wait early.** `gh pr checks` printed nothing, so `until ! … | grep -q pending` ended at once. Use:
  `until gh pr checks N -R Omarmarei/zoma-iptv > out.txt 2>&1; grep -q -E "pass|fail" out.txt && ! grep -q -E "pending|in_progress|queued" out.txt; do sleep 30; done; cat out.txt`
  with `timeout: 600000`. It moves to the background at 10 min, which is fine.
- **A check beside the binding's `view.state(row)` is masked:** `state` is already idle off the focused row.
- **Cut marks:** test a programme cut by the guide's own `from`/`to`, not only by the view.
- **Layout constants an e2e imports** go in a plain `.ts`, never a `.tsx` (root tsc has no JSX).
- **Screenshot-stable demo times:** build them from local midnight; compare minutes relative to `data-view` in e2e.
- **The en-XA check** must skip the locale's own formats: times, ranges and the day (`Thu, Nov 5`).
- **Geometry e2e:** without row tops and column widths, CSS mutants of `margin-top` and `width` survived.

**From earlier legs (still true):**
- **Read a list's count and its rows in one `page.evaluate`.** Playwright's auto-wait on a row that vanished between two reads hangs `expect.poll`.
- **RTL side checks** measure text with a Range over the element's contents. A flex item's own box spans the free space.
- **A `cancelled` CI job** can be its `timeout-minutes` (a slow apt mirror). Read the step times, then `gh run rerun <id> --failed`. The next push to main cancels that rerun (`concurrency: ci-${{ github.ref }}`).
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the failed job.
- **ar-SA formats Western digits** (ADR-011).
- **e2e text checks need `stripIsolates`** (`packages/core/src/bidi`).
- **A cleanup can make another guard dead.** After removing a call, re-check the guards in the function it called.
- **A held test fake that throws inside its `resolve` must route the throw to `reject`.**
- **Line endings:**
  - `pathlib.write_text` on Windows writes CRLF. Use `newline=''` and write LF yourself (`chr(10)`).
  - Working-copy CRLF files: `docs/architecture.md` and `apps/tv/src/main.tsx`. `RELAY.md` and most sources are LF. Detect the line ending before patching.
- **Patch scripts:**
  - Write every multi-line patch script to `$CLAUDE_JOB_DIR/tmp` (the Write tool), then run `python -I <script> "<wt>"`.
  - A multi-file patch that stops at its first miss may already have written earlier files: check `git status` before rerunning it.
  - Use Edit for any line with a backslash.
- **Playwright's page clock** (`e2e/refresh.spec.ts`):
  - `page.clock.install()` goes before `page.goto`;
  - `page.clock.fastForward('02:01:00')` fires each due timer once;
  - the workers and the mock keep the real clock.
- **Counting what the app asks the mock:** `app.addHook('onRequest', …)` before `listen(app)`. Switch scenarios with `app.mockState.scenario = null`.
- **Mutation lessons:**
  - write the mutation list first, and remove masked guards before the run;
  - the navigator clamps `focus(-1)`;
  - `splice` rounds and clamps its index by itself;
  - a signal set to a new array redraws anyway, so a `bump()` beside it is masked.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Vite serves live files, and the mutation run swaps them. Docs are safe.
- **Local flakes on a busy PC:** the throttled test, and the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it.
- **TV bundle polyfills:**
  - a field or member named `at` pulls `Array.at` polyfills;
  - a `Uint8Array` in a TV file pulls 35 core-js modules;
  - avoid `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` and `for…of` in TV files;
  - count main after any TV-file change (219).
- **Test literals:**
  - every hand-built mock `Account` needs `outputFormats`;
  - every hand-built `PlayerEngine` needs `caps.fits` and `setFit`;
  - an `EpgRefreshResult` needs `reranked: []`;
  - failed outcomes need `status: null`.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
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
  - Locally: lint, typecheck, 3,574 unit tests, `pnpm verify` twice (72 e2e), mutation 69/69 and 12/12, 219 core-js modules on both platforms, and both screenshots looked at.
  - PR #50's CI green on all three jobs (engines on a rerun); merged as `58d1c47`.
  - Main's CI on `33e5a51` green.
- **Not done:**
  - Main's CI on `58d1c47` is unchecked.
  - The grid has never run on Chromium 53/56/68 (step 23e) or on a TV.
  - The query worker's `guide` has run only in Node. 23c's e2e is its first run in a browser.
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
- **Decided in leg 50 (not gates):**
  - the grid's way in is a "Guide" button in the live screen's header, before "Settings";
  - a channel's row comes only from the guide its now/next uses, with placeholders where that guide has nothing.
- **Decided in leg 51 (not a gate):** programme times follow the page's direction (see above).
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
- **Relay cap:** 60 legs (state.json). Leg 51 was the 51st, so 9 legs remain before the cap.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-eight CLAUDE.md gaps** are waiting for his word:
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
  27. the `pnpm dev` row should name the header's "Settings" → "TV guides" (`apps/tv/src/settings`), and the mock row its `/epg/guide.xml` link for adding a guide;
  28. the `pnpm dev` row should name `?screen=gallery-guide` (the grid guide's gallery page).
- **Secrets:** none pending.
