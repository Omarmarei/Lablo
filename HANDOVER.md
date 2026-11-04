# Zoma IPTV: relay leg 51 opening prompt

You are leg 51 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–49 did steps 1–22, except step 16's Samsung part, 19b and 21 (PRs #1–#48).
- **Leg 50 split step 23 (the grid guide)** into 23a (the data), 23b (the grid component), 23c (the guide screen) and 23d (the throttled e2e), all written out in RELAY.md. Then it did **23a**:
  - It merged as PR **#49** (merge commit **`33e5a51`**, branch kept).
  - CI on `63bfcd8`: verify 9 m 1 s, media 11 m 58 s, engines 12 m 6 s, all green on the first run.
  - Main's CI on `9ff6073` (PR #48) was green. **Check main's run on `33e5a51`.**
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 23b, the grid component (RELAY.md, Phase 6)
RELAY.md's 23b (read the whole entry there):
- virtualized on both axes: only the rows in view (from the `epg` zone's `top`, as `VirtualList` does) and only the cells that cross the view (`view` to `view + span`);
- bound to the `epg` zone: the focused cell from the zone's row and cursor; a helper fills the gaps between programmes with placeholder cells, and both the zone's `cell(row, minute)` and the drawing use it, so the two agree;
- a time header (the slots in view) and a "now" line;
- RTL mirrored by rtlcss with physical CSS (times inside `dir=ltr`);
- a gallery entry; unit tests (the cells drawn, the gaps filled, cut at the view's edges, the focus, the now line), screenshots in English and Arabic.
- **Done when:** the unit tests and the gallery e2e pass, `pnpm verify` green, a mutation run, the PR merged.

If 23b turns out too big for one leg, split it in RELAY.md (23b1 the pure layout helpers and the component with unit tests; 23b2 the gallery entry, e2e and screenshots), as earlier legs split theirs.

### What exists (check it before writing anything)
1. **The focus engine's `epg` zone** (step 10):
   - `packages/ui/src/focus/types.ts`: `EpgZone` has `rows`, `visibleRows`, `from`/`to` (UTC minutes; put `from` on a slot boundary), `span` (minutes in view), `slot` (default 30), `now`, and `cell(row, minute) => EpgCell | null`.
   - `ZonePosition` keeps `index` (the row), `top`, `time` (the cursor) and `view` (the first minute in view).
   - `packages/ui/src/focus/epg.ts`: `epgCell`, `epgClamp`, `epgTimeStep`. Where the screen gives no cell, the slot is the cell.
   - `zones.ts` and `navigator.ts` drive it: UP/DOWN keep the cursor, LEFT/RIGHT step cells, CH± page rows. RTL is the one logical swap in `moveDirection`.
   - Grep `kind: 'epg'` first: no screen or component uses the zone yet. The hello screen's focus demo (`apps/tv/src/focus-demo.ts`) may show how a zone is wired.
2. **`VirtualList`** (`packages/ui/src/components/VirtualList.tsx`) is one-axis only. It shows the patterns to copy:
   - `listWindow(top, count, visible)`;
   - sizes from `LAYOUT` tokens, never measured;
   - `useZone`, `ItemBinding`, `renderItem`.
3. **The data shape from 23a**, for the props:
   - `GuideRow { key, epgSrc, start: number[], end: number[], title: string[] }` (`packages/data/src/query-service.ts`), as plain arrays.
   - core's `EpgSchedule` is the same columns without `key`/`epgSrc` (`packages/core/src/epg-guide.ts`).
   - The component should take rows as props, never call the engine. The gallery feeds it made-up rows; 23c feeds it the engine's.
   - Check what `packages/ui` may import: the boundary lint, `test/lint-boundaries.test.ts`.
4. **The gallery:** `apps/tv/src/gallery` (`GalleryApp.tsx`, `gallery-data.ts`, `gallery-state.ts`, `gallery.css`). The old-engine harness checks the gallery on Chromium 53/56/68 (`pnpm verify:engines`, `test/engines-gallery.test.ts`). A new gallery entry may change the boxes it expects: run the harness if the gallery changes.

### Design notes from leg 50 (suggestions; decide in the leg)
- **One pure helper for both uses:** `gridCells(row, from, to, slot)` returns the programmes plus placeholder cells that fill each gap, cut to the slot grid.
  - The zone's `cell(row, minute)` finds the cell holding `minute` by binary search.
  - The drawing takes the cells that cross `[view, view + span)`.
  - If both use one function, the focus and the drawn cells can't disagree. Test it with fast-check: every minute in `[from, to)` is held by exactly one cell, and programme cells match the input.
- **Positions:** x = (start − view) × px per minute, from layout constants.
  - **rtlcss never mirrors inline styles** (memory `iptv-css-pipeline-gotchas`). Put the numbers in CSS variables (`style="--x:…; --w:…"`) and write `left: var(--x)` in the CSS file. rtlcss turns that into `right: var(--x)` under `<html dir=rtl>`.
  - No CSS Grid, flex `gap` or logical properties: Chromium 53 lacks them. Use physical properties only.
- **Text:**
  - Programme titles are provider text: `dir=auto` + `translate=false`, or `isolateText`.
  - Times (the header's slots, a cell's time range) go inside `dir=ltr`.
  - Any word of ours, such as the placeholder's "No information", comes from the catalogs (en and ar; the `zoma/no-hard-coded-text` lint). Each new key adds per-key catalog tests by itself.
- **The now line:** take `now` as a prop (23c ticks it each minute). Draw it only while now is inside the view.
- **Hook-free:** components in `packages/ui` stay hook-free and are tested as functions by walking the VNode tree (memory `iptv-ui-test-gotchas`; `components.test.ts`, `vnode.test-helpers.ts`).
- **Size:** the grid will be in main.js (23c imports it).
  - Count core-js modules after it with `python -I -u artifacts/poly-count20c2a.py`. It must stay 219 on both platforms; if it grows, find the property names that pulled the polyfills (memory `iptv-tv-bundle-polyfills`).
  - Avoid `.at`, `Array.from`, typed arrays, `new RegExp`, `.split(` and `JSON.stringify` in TV files.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`:
   - steps 23 and 23a–23d;
   - the progress-log rows for legs 47–50.
3. `docs/architecture.md`:
   - §1.2 "Built in step 10" (the focus engine, the `epg` zone bullet) and "Built in step 11b" (components, the virtual list, the gallery);
   - §1.5 "Built in step 23a" (the data, just written);
   - §4's throttled-run notes (for 23d later).
4. The code:
   - `packages/ui/src/focus/` (`types.ts`, `epg.ts`, `zones.ts`, `navigator.ts`, `binding.ts`);
   - `packages/ui/src/components/` (`VirtualList.tsx` and `.css`, `ListRow.tsx`, `components.test.ts`);
   - `packages/ui/src/design/tokens` (`LAYOUT`);
   - `apps/tv/src/gallery/`.
5. Memory:
   - `iptv-ui-test-gotchas`;
   - `iptv-css-pipeline-gotchas`;
   - `iptv-bidi-old-engines`;
   - `iptv-tv-bundle-polyfills`;
   - `iptv-old-engine-screen`;
   - `iptv-parser-test-patterns`;
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `33e5a51`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` shows `cancelled`, read its step times before blaming the code (a slow apt install hit the 30-minute limit once).
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call. The shell starts in the main checkout, which has no `tsx`: a one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `36e3934` ("docs: record PR #49's merge"). It is pushed, and the tree is clean.
- **main** has `33e5a51` (PR #49). The branch is ahead by `36e3934` and the handover commit, both docs; they go to main with 23b's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media and the scale fixtures included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate23a.py` and `.log`: the newest unit-test mutation template (34/34; it also runs mutants against the media config);
    - `mutate22b2b.py`: the e2e mutation template (one Playwright spec per mutant);
    - `poly-count20c2a.py`: counts main's core-js modules (219 on both);
    - `verify23a.log`;
    - `screenshots/` from leg 49 (the guides screens in `en` and `ar`).
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 50 (step 23a)
- **core `epgSchedule(buckets, from, to, shiftHours)`:**
  - returns a channel's programmes that overlap `[from, to)` (UTC minutes), uncut, shifted by the tvg-shift, as plain arrays (`start`, `end`, `title`);
  - the buckets come in day order; an empty range gives nothing;
  - one day's last programme that runs past the next day's first ends where that one starts (and is dropped if that leaves it before the range).
- **`QueryService.guide({ keys, from, to })`:**
  - The rule for which guide feeds a channel is the one now/next uses (`combineEpgMatches`: the stronger method, then the guide listed first). A lower guide does not fill hours the winning one lacks: placeholders show there.
  - It reads the days the range covers in the channel's own time, plus the day before, in one transaction.
  - An ask over `GUIDE_MAX_READS` (2,000 channel-days, counted over every channel) is refused with a `RangeError` before anything is read.
  - Channels no guide matches come back as `epgSrc: null` with empty arrays.
  - `DataEngine.guide(req)` is the app's call.
- **Titles only.** Step 24 (programme details) will ask for one programme's description and episode separately.
- **No `pnpm bench` case:**
  - it would need `@zoma/data` and fake-indexeddb in tools/bench, plus the store's 7 s setup in CI's bench step;
  - the scale test `test/guide-300mb.media.test.ts` prints the same numbers instead.
- **The scale test** (`test:media`):
  - the 300 MB guide's 1,331,136 programmes (5,000 channels, the full tier) are stored in fake-indexeddb: about 7.5 s locally, 10.3 s on CI;
  - 24 live channels (playlist rows 1,000–1,023, one with 150-minute slots that cross midnight) are read over three windows: the view, two days and three catch-up days;
  - every time must equal the fixture generator's schedule, and each window must answer in ≤ 20 ms (1.2–4.1 ms locally, 1.8–2.3 ms on CI);
  - the 20 ms: a page of new rows should fill within about 300 ms on a 2018 TV, taken as about 15 times slower than CI.
- **Checks:** 3,529 unit tests (+11), `pnpm verify` green (68 e2e), mutation 34/34.
- **Sizes now:**
  - main: 294.6 KB (Tizen) / 282.0 KB (webOS) of 500;
  - workers, each of 150 KB: query 100.8 KB, EPG 115.6 KB, ingest 126.0 KB;
  - core-js modules in main: 219 on both platforms.
- **The 3 riskiest changes that went in (PR #49):**
  1. The new read-only `guide` RPC on the query worker (+1.2 KB). Nothing calls it yet.
  2. A new `test:media` test: about 10 s and about 1 GB of fake-indexeddb memory in CI's `media` job.
  3. There was no migration, permission or data change.
- **Nothing on screen changed**, so there is no new "press these keys" checklist. The guides screen's checklist is in the leg-49 handover: `git show 70b3236:HANDOVER.md`. The player's (step 20) is in `git show b3c53af:HANDOVER.md`.

## Gotchas and lessons
**New in leg 50** (also in memory):
- **A scale oracle only catches what the data exercises.** The scale test's first rows (playlist 10,000+) had no guide channel crossing midnight, so a mutant that dropped the day-before read survived.
  - In the 300 MB fixture only 150-minute slots cross midnight (guide channel k with k % 8 == 6). `EPG_BENCH_NOW` is a midnight, and no live channel has a tvg-shift.
  - Print what the chosen rows contain before trusting the oracle.
- **`docs/architecture.md`'s working copy is CRLF; `RELAY.md` is LF.** Git stores both as LF. An LF anchor fails on architecture.md: detect the file's line ending and convert both the anchor and the inserted text.
- **Heredoc'd python that patches another script's escaped text mangles it.** Write such scripts with the Write tool, using `NL = chr(10)`.
- **fake-indexeddb holds the whole 300 MB guide**, so data-layer reads at real scale fit in `test:media`.

**From earlier legs (still true):**
- **Read a list's count and its rows in one `page.evaluate`.** Playwright's auto-wait on a row that vanished between two reads hangs `expect.poll`.
- **RTL side checks** measure text with a Range over the element's contents. A flex item's own box spans the free space.
- **A `cancelled` CI job** can be its `timeout-minutes` (a slow apt mirror). Read the step times, then `gh run rerun <id> --failed`. The next push to main cancels that rerun (`concurrency: ci-${{ github.ref }}`).
- **An e2e mutation pass** (`artifacts/mutate22b2b.py`) proves layout and RTL checks can fail. It takes about 25 s per mutant (each run starts Vite).
- **ar-SA formats Western digits** (ADR-011).
- **e2e text checks need `stripIsolates`** (`packages/core/src/bidi`).
- **A cleanup can make another guard dead.** After removing a call, re-check the guards in the function it called.
- **A held test fake that throws inside its `resolve` must route the throw to `reject`.**
- **`pathlib.write_text` on Windows writes CRLF.** Use `newline='\n'` (or `chr(10)`).
- **Patch scripts:**
  - Write every multi-line patch script to `$CLAUDE_JOB_DIR/tmp` (the Write tool, or a `cat > … <<'EOF'` with no apostrophes or escapes inside), then run `python -I <script> "<wt>"`.
  - A multi-file patch that stops at its first miss may already have written earlier files: check `git status` before rerunning it.
  - Use Edit for any line with a backslash.
- **Waiting for CI:**
  - First read `gh pr checks N -R Omarmarei/zoma-iptv` with an `until … grep -q -E "pending|pass|fail"` loop. Right after `gh pr create` it says "no checks reported".
  - Then wait with a foreground `until ! gh pr checks N … | grep -q -E "pending|in_progress|queued"; do sleep 30; done` and `timeout: 600000`. It moves to the background at 10 min, which is fine.
  - A bare `sleep 25; gh …` is blocked. Never `&&` on gh's exit code (it is non-zero on a failed or pending check).
- **Playwright's page clock** (`e2e/refresh.spec.ts`):
  - `page.clock.install()` goes before `page.goto`.
  - `page.clock.fastForward('02:01:00')` fires each due timer once.
  - The workers and the mock keep the real clock.
- **Counting what the app asks the mock:** `app.addHook('onRequest', …)` before `listen(app)`. Switch scenarios with `app.mockState.scenario = null`.
- **Mutation lessons:**
  - write the mutation list first, and remove masked guards before the run;
  - `>`/`>=` on a cut whose result is filtered by the same bound is equivalent: leave it out;
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
  - Locally: lint, typecheck, 3,529 unit tests, `pnpm verify` (68 e2e), the scale test, mutation 34/34, and 219 core-js modules on both platforms.
  - PR #49's CI green on all three jobs; merged as `33e5a51`.
  - Main's CI on `9ff6073` green.
- **Not done:**
  - Main's CI on `33e5a51` is unchecked.
  - The query worker's `guide` has run only in Node (fake-indexeddb), never in a browser or on a TV. 23c is its first real caller, and its e2e will exercise it.
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
  - the grid's way in is a "Guide" button in the live screen's header, before "Settings", with no new remote key (23c);
  - a channel's row comes only from the guide its now/next uses, with placeholders where that guide has nothing.
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
- **Relay cap:** 60 legs (state.json). Leg 50 was the 50th, so 10 legs remain before the cap.

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
