# Zoma IPTV: relay leg 54 opening prompt

You are leg 54 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–52 did steps 1–22 and 23a–23c, except step 16's Samsung part, 19b and 21 (PRs #1–#51).
- **Leg 53 did 23d (the grid's throttled e2e):**
  - It merged as PR **#52** (merge commit **`dad3a7a`**, branch kept).
  - CI on `4393091` was green: verify 9 m 20 s, media 13 m 43 s, engines 11 m 53 s. The run before it failed only the grid's opening press (155 ms), which led to a fix (below).
  - Main's CI on `b03afbb` (PR #51) was green. **Check main's run on `dad3a7a`** (it started at 02:47 UTC).
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.
- **Step 23 (the parent) stays unticked until 23e is done.** Its own Done-when (≤ 150 ms per key press in the grid) was met by 23d. Tick 23 together with 23e.

## Your step: 23e, the grid on Chromium 53/56/68 (RELAY.md, Phase 6)
RELAY.md's 23e (read the whole entry there):
- **What:** the grid is the first screen placed by absolute positions from CSS variables (`--x`/`--w`, which rtlcss mirrors from `left` to `right`), and nothing has drawn it on the old engines yet.
  - Use the old-engine harness (`tools/engines`), both bundles, English and Arabic.
  - Open the guide screen (23c) by the TVs' keys: UP from the live list's first row to the header's "Guide", then OK.
  - Measure every cell, slot label and the now line against `GUIDE_LAYOUT`, from the timeline's inline start, as `e2e/guide-gallery.spec.ts` and `e2e/guide-grid.ts` (`checkGeometry`) do, but in an ES5 probe.
  - Check the channels sit at the inline start.
  - Check the focus engine equals the screen's `data-screen/zone/index` at every step.
- **Done when:** `pnpm verify:engines --self-test` passes locally and on CI, a CSS seed that drops the cells' `left: var(--x)` is caught on every engine, and the PR is merged.

### What exists (check it before writing anything)
1. **The harness** (`tools/engines/src`):
   - The onboarding walk (`onboarding.ts`) ends on the live screen. Since step 14a it waits for the live screen's `data-pending=0` (including the 600 ms focus wait).
   - `live.ts` checks the live screen there (step 14c: rows, rail, CH±, the TVs' key codes `TV_KEYS`).
   - `scenario.ts`, `variants.ts`, `gallery.ts`, `lab.ts`, `fixture.ts` (the 2,400-channel fixture and its guide).
   - Runbook: `docs/runbooks/old-engines.md` (commands, how a run works, the fixture, **the self-test** section).
   - architecture.md §4 "Built in step 14c" describes the live-screen walk.
2. **The guide screen** (`apps/tv/src/guide`):
   - `guide-state.ts`: screen `guide`, zone `grid`. Rows are asked per channel-day after a 200 ms rest. **New in 23d:** the open's first ask goes out on a 0 ms timer, after the opening frame.
   - `GuideScreen.tsx`: a 110 px header (`GUIDE.headerHeight`), then `GuideGrid` (`packages/ui/src/components/GuideGrid.tsx`, sizes in `guide-layout.ts`).
   - The root has `data-pending` (0 = settled), `data-time` and `data-version`.
   - `GUIDE_DAYS`: a day back to 7 on, 3 on the low tier.
3. **The fixture's guide must cover the hours the walk shows** on the page's clock in both bundles. Check `fixture.ts` and how the walk sets the clock (`fixture.17 23h` is the live walk's now/next; leg 26 lost a programme at midnight UTC).
4. **Old-engine facts** (memory):
   - Chromium 53/56/68 ignore FSI/PDI. `isolateText` puts LRM/RLM outside the isolate.
   - Probe with Range rects, plus a non-isolated control.
   - Chromium 53 typing is char events.
   - Never leave a page mid-IDB.
   - The page is 1919x974 headed; `--kiosk --test-type` gives 1920x1080.
   - A container can miss DevTools once: rerun.
   - CSS custom properties exist from Chromium 49, but check `left: var(--x)` really positions on 53.

## Facts and decisions from leg 53 (step 23d)
- **The throttled run** (`e2e/guide-throttled.spec.ts`, project `throttled`): the guide over the 20,000-channel "All channels" at 4x, 93 presses per tier (full, then forced low, each from a fresh start):
  - on the live screen: UP and OK on "Guide";
  - in the grid: 20 DOWN, 15 CH−, 30 RIGHT on row 155 (past midnight), 5 CH+, 10 UP, 10 LEFT on row 100 while its rows are read, and Back.
  - After the time presses, the drawn rows are checked against the guide written.
- **The guide:** `gridGuide(now)` and `denseProgrammes` (`e2e/big-catalog.ts`):
  - rows 0–199 get programmes back to back from 2 days before now to 8 days after;
  - ten lengths of 15–90 minutes, staggered per channel;
  - the rest keep the four around now;
  - `test/big-guide.test.ts` pins it.
- **Budgets (decided, recorded in architecture.md §4 "Built in step 23d"):**
  - 150 ms per press in the grid and per long task.
  - The two opening presses (and the long tasks until the grid's first frame) have the live screen's 200 ms (S6). They are presses on the live screen, and the first draw is the heaviest and most variable frame (cold code).
- **The fix:** `scheduleAsk(0)` in `open()`.
  - A key pressed before the timer waits for the view to rest instead; Back before it asks nothing.
  - Local mean first draw: 51 → 37 ms; in `pnpm verify`: 105/114 → 41/29 ms; CI: 34/17 ms.
  - Mutation 5/5 (`artifacts/mutate23d.py`).
- **Driver:** `RemoteDriver.timedPress(…, { timeMoves: true })` waits for another drawn `data-time` (an epg zone's LEFT/RIGHT keep the path). The throttle helpers are in `e2e/throttle.ts`, and the `throttled` project runs `workers: 1`.
- **Checks:**
  - 3,623 unit tests (+4); e2e 77 (+2); `pnpm verify` green twice;
  - main unchanged (311.3 KB Tizen, 298.7 KB webOS of 500); 219 core-js modules on both.
- **The 3 riskiest changes that went in (PR #52):**
  1. The guide's first ask moved after the opening frame (the only app code change).
  2. The opening presses' 200 ms budget; the `throttled` project runs one worker.
  3. No migration, permission or data change.

### "Press these keys" (unchanged from 23c, desktop)
1. Run `pnpm mock` and `pnpm dev`. Open `http://localhost:5173/` and onboard with the mock's Xtream login (host `localhost:8080`; the user and password are in `apps/mock-provider/test/helpers.ts`).
2. On the live screen, press UP from the first channel, then OK on "Guide".
   - The grid shows at once with "No information" placeholders.
   - The programmes fill in a moment later: since 23d the first ask goes after the opening frame.
3. RIGHT/LEFT go a programme on or back; UP/DOWN change channel; PageDown/PageUp page.
4. OK on the programme on air plays; Back returns to the guide; Back again to the list.
5. Add `?locale=ar-SA`: the channels are on the right, and time runs leftwards.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: steps 23, 23a–23e, and the progress-log rows for legs 50–53.
3. `docs/architecture.md`:
   - §1.2 "Built in step 23b" and "Built in step 23c";
   - §4 "Built in step 14c" (the live screen on the old engines) and "Built in step 23d".
4. `docs/runbooks/old-engines.md`.
5. The code: `tools/engines/src/{onboarding,live,scenario,fixture}.ts`, `e2e/guide-grid.ts`, `packages/ui/src/components/{GuideGrid.tsx,guide-layout.ts,GuideGrid.css}`, `apps/tv/src/guide/`.
6. Memory:
   - `iptv-old-engine-walk`, `iptv-old-engine-screen`, `iptv-bidi-old-engines`;
   - `iptv-engines-docker-image`, `iptv-css-pipeline-gotchas`;
   - `iptv-parser-test-patterns` (mutation lessons; seeds proven with a disagreeing case);
   - `use-write-tool-for-doc-batches`, `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `dad3a7a`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` shows `cancelled`, read its step times first (a slow apt mirror).
   - If `verify` failed on `guide-throttled.spec.ts`, read its console line (the opening and the grid's slowest presses) before touching code. Leg 53 found that one CI run is not a calibration.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call. A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `9059853` ("docs: record PR #52's merge"). It is pushed, and the tree is clean.
- **main** has `dad3a7a` (PR #52). The branch is ahead by `9059853` and the handover commit, both docs; they go to main with 23e's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate23d.py`;
    - `verify23d.log`, `verify23d-2.log`;
    - `perf/guide-throttled.json`, `perf/live-throttled.json`;
    - the trace analysers `trace-{sum,open,tree}23d.py` (renderer main thread per keydown of a Chrome trace);
    - `scratch-{grid-profile,open-trace}.spec.ts.txt`: to use one, copy it into `e2e/` as `*-throttled.spec.ts`, run it with `--project throttled --no-deps`, and **delete it before any `pnpm verify`**;
    - `poly-count20c2a.py` (219);
    - `mutate23c.py`, the newest large mutation template.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Gotchas and lessons
**New in leg 53** (also in memory `iptv-throttled-e2e`):
- **One CI sample is not a calibration.**
  - CI's first run passed (slowest 94 ms), the second failed at 155 ms (the grid's first draw), and the third passed after the fix.
  - The live list's slowest on CI has ranged 41–121 ms across runs.
  - A desktop at 10x overstated CI by more than 2x this time.
- **A screen's first draw, opened by a key, is its slowest and most variable press:**
  - cold code, worst on the first start after onboarding;
  - an early worker answer can land before the frame.
  - Ask for its data after the opening frame.
- **Epg time presses keep the focus path.** Use `timedPress({ timeMoves: true })`. Data can arrive between the reads around a press and replace placeholder cells: check only the direction when `data-version` changed.
- **Playwright 1.64 has per-project `workers`.** `--project throttled --no-deps <file>` runs one timed file without the chromium dependency.
- **Print the numbers before the checks.**
- **Profiling a press:** `browser.startTracing` with `devtools.timeline`, then `artifacts/trace-sum23d.py`. In the grid, a quarter to a third of a press is script; the rest is style, layout, paint and compositing.
- **Heredocs:** a `split('\n')` in a heredoc'd python patch became a real newline again. Use Edit for any line with a backslash.

**From earlier legs (still true):**
- **Write the mutation list before the run.** It finds masked guards and real bugs (leg 52: a background close popped the player).
- **A screen that can be covered must never pop itself from a background callback.**
- **The e2e can't import `apps/tv/src/guide/guide-state.ts`** (it reaches `.tsx` through `@zoma/ui`'s index). Repeat a layout constant with a comment naming its source.
- **A connection error can end a CI wait early.** Use a loop on saved output that has pass/fail and no pending (this leg's background `gh pr checks` loop worked three times).
- **Read a grid's or list's rows in one `page.evaluate`.**
- **@preact/signals skips redrawing a child whose props didn't change.** Pass new functions or a version prop.
- **Line endings:**
  - in this worktree, `docs/architecture.md`, RELAY.md, HANDOVER.md and the e2e files are LF;
  - `apps/tv/src/main.tsx` was CRLF before; detect the ending, then patch;
  - `pathlib.write_text(..., newline='')`.
- **Patch scripts:** write every multi-line patch script to `$CLAUDE_JOB_DIR/tmp` (the Write tool), then run `python -I <script> "<wt>"`.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files). Docs are safe.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or `for…of` in TV files;
  - count main after any TV-file change (219);
  - the harness's in-page probes are plain ES5 strings (`LIVE_VIEW_FUNCTION` in `tools/engines/src/live.ts`, with `function () {…}` callbacks). Write the grid's reader the same way.
- **Playwright's page clock:** `page.clock.install()` before `goto`. The workers and the mock keep the real clock.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs;
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only;
  - TV code is `lib: ES2017`;
  - the app imports only types from `@zoma/data` (values from narrow entries);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old. Never weaken lint.
- **Commits:** scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,623 unit tests, `pnpm verify` twice (77 e2e), mutation 5/5, 219 core-js modules on both, five isolated throttled runs.
  - PR #52's CI green on all three jobs on `4393091`; merged as `dad3a7a`.
- **Not done:**
  - Main's CI on `dad3a7a` is unchecked.
  - The guide screen has never run on Chromium 53/56/68 (step 23e) or on a TV.
  - The 3 → 4 profile migration and the settings screens have never run on a TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10 (including the audio, subtitle and picture-size key codes), S11 by ear, S5's suspend and soak, and the player itself (step 21).
- **Later, from the spikes:**
  - an on-screen keyboard if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route;
  - pre-buffered zapping (S8);
  - the last frame kept while reconnecting;
  - step 38's settings rows;
  - parsing subtitle files off the main thread;
  - a TV remote's own "Guide" key (needs S10).
- **Later cleanups:**
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier (step 41);
  - holding refreshes while a low-tier TV plays (step 41);
  - the catalogs as a UTF-8 file if they keep growing;
  - a "loading" look for guide rows not read yet. They say "No information" until the first answer, which since 23d always comes after the opening frame.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.
- **Relay cap:** 60 legs. Leg 53 was the 53rd, so 7 legs remain.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Twenty-nine CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide" (the grid guide screen, `apps/tv/src/guide`).
- **Secrets:** none pending.
