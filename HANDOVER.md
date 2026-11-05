# Zoma IPTV: relay leg 53 opening prompt

You are leg 53 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–51 did steps 1–22, 23a and 23b, except step 16's Samsung part, 19b and 21 (PRs #1–#50).
- **Leg 52 did 23c (the guide screen in the app):**
  - It merged as PR **#51** (merge commit **`b03afbb`**, branch kept).
  - CI on `61d9337` was green on the first run: verify 11 m 19 s, media 13 m 1 s, engines 12 m 58 s.
  - Main's CI on `58d1c47` (PR #50) was green. **Check main's run on `b03afbb`** (it started at 01:36 UTC).
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 23d, the grid's throttled e2e (RELAY.md, Phase 6)
RELAY.md's 23d (read the whole entry there):
- **What:** the 20,000-channel catalog with a 7-day guide (3 days on the low tier). Open the grid by keys, then time presses (rows, time, pages) at 4x CPU, in the full tier and the low tier.
- **Budget:** 150 ms per press, calibrated on CI as the live list's was (architecture.md §4, "Why 200 ms and not 150").
- **Done when:** the throttled run passes locally and on CI with the budget recorded, `pnpm verify` green, the PR merged.

### What exists (check it before writing anything)
1. **The live list's throttled run** is the model to copy: `e2e/live-throttled.spec.ts` (Playwright project `throttled`, run after the others, one test at a time).
   - `e2e/big-catalog.ts` builds the 20,000 channels in 200 categories, in-process, with a guide (`writeBigGuide`).
   - `RemoteDriver.timedPress` and `watchLongTasks` are in `e2e/remote-driver.ts`.
   - The run must prove the throttle works: a fixed loop at least 2x slower. Each tier starts afresh.
   - Memory `iptv-throttled-e2e` has the lessons.
2. **The guide screen (23c)** is in `apps/tv/src/guide`:
   - `guide-state.ts`: screen `guide`, zone `grid`. Programmes are asked per channel-day for the rows in view and a page either side, one `DataEngine.guide` call a day, `GUIDE_ASK_MS` = 200 ms after the view rests. `GUIDE_KEEP` = 216 channel-days.
   - `GuideScreen.tsx` draws the header, then `GuideGrid`.
   - The way in is UP from the list's first row to the header's "Guide" (`live/header/0`), then OK, which lands on `guide/grid/<row>`.
   - The root has `data-pending`: 0 means settled, and it counts the rest timer too.
   - `e2e/guide.spec.ts` drives it by keys. `e2e/guide-grid.ts` has `readGrid(page, 'guide-screen', '.guide__header > *')`, `checkGeometry` and `focused`.
3. **The range:** a day back to 7 days on (`GUIDE_DAYS`, the full tier), or 3 days on the low tier. The tier comes from `platform.info()`, and `?tier=low` forces it in the browser (main.tsx keeps `tier`).
   - **Check `writeBigGuide`'s days.** It must cover the hours the presses walk, in both tiers (leg 26 lost a programme at midnight UTC).
4. **Costs to watch:**
   - Each draw walks the 9 rows' cells in view, with one binary search per cell.
   - The merged schedule per row is cached until a day of it changes.
   - An answer bumps `version` and redraws the whole grid.
   - The ask after a rest goes to the query worker, so a press should cost only the draw.
   - If a press is over budget, look at the draw first (profile with a trace), not at the data.

### Facts and decisions from leg 52 (step 23c)
- **The header has two buttons:**
  - "Guide" (`HEADER_GUIDE` 0) and "Settings" (`HEADER_SETTINGS` 1).
  - UP lands on Guide. "Settings" is RIGHT of it (LEFT in Arabic).
  - OK on Guide opens the guide only while the list is `ready`.
- **Decided (not a gate):**
  - OK on the cell that holds now plays the channel. That includes a channel with no guide (its placeholder).
  - The player opens over the guide. Back from it returns to the guide on the channel that played (`guide.follow` in the player's `closed`).
  - OK on a programme gone by or to come does nothing until steps 24 and 25.
  - Back from the guide goes to the live list on the channel the guide had focused.
- **A catalog swap** (`listChanging`): the guide waits for the new list, then takes the new count and keeps the channel or its row.
  - It waits with `list.locate`, or with `LiveList.ready()` (new: the live list's `loaded`) when the focused row wasn't read.
  - It never pops: the player may be over it.
  - Writing the mutation list found the old `close()` path, which would have popped the player instead of the guide.
- **Redraws:** the screen reads the guide's `version`, and `LiveApp` passes the live list's `version` as `listVersion` (the channel names come from the list's chunks).
- **Catalog keys:** `guide.open` and `guide.title` ("Guide" / «الدليل», «دليل البرامج»).
- **Checks:**
  - 3,619 unit tests (+45);
  - e2e 75 (+3);
  - `pnpm verify` green twice;
  - mutation 95/97, then 95/95 (`artifacts/mutate23c.py`, `.log`; the first run in `mutate23c-first.log`);
  - 219 core-js modules on both platforms;
  - screenshots `guide-{en-US,ar-SA}.png` looked at.
- **Sizes:** main 311.3 KB (Tizen) and 298.7 KB (webOS) of 500; app.css 61.4 KB; workers unchanged.
- **The 3 riskiest changes that went in (PR #51):**
  1. The live header now has two buttons. UP lands on "Guide", and "Settings" moved to index 1 (`guides.spec.ts` was updated).
  2. The catalog-swap path also re-syncs the guide, and guide swaps go to both the list and the guide (main.tsx).
  3. No migration, permission or data change.

### "Press these keys" (step 23c, desktop)
1. Run `pnpm mock` and `pnpm dev`. Open `http://localhost:5173/` and onboard with the mock's Xtream login (host `localhost:8080`; the user and password are in `apps/mock-provider/test/helpers.ts`).
2. On the live screen, press UP from the first channel. "Guide" has the focus, before "Settings". Press OK.
3. The guide shows:
   - 9 channels, two hours from the half hour of now, and a red now line;
   - in the header, the channel and the programme on air with its own times.
4. Move around:
   - RIGHT and LEFT go a programme on or back;
   - UP and DOWN change channel and keep the time;
   - PageDown and PageUp page the channels.
5. OK on the programme on air plays the channel. Back returns to the guide on that channel.
6. OK on a programme later today does nothing.
7. Back goes to the live list, on the channel the guide had focused.
8. Add `?locale=ar-SA`: the channels are on the right, time runs leftwards, and LEFT goes forward.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: steps 23, 23a–23e, and the progress-log rows for legs 49–52.
3. `docs/architecture.md`:
   - §1.2 "Built in step 23b" and "Built in step 23c";
   - §4: the throttled-run notes and "Why 200 ms and not 150".
4. The code: `e2e/live-throttled.spec.ts`, `e2e/big-catalog.ts`, `e2e/remote-driver.ts`, `e2e/guide.spec.ts`, `e2e/guide-grid.ts`, `apps/tv/src/guide/`, `playwright.config.ts` (the `throttled` project).
5. Memory:
   - `iptv-throttled-e2e`;
   - `iptv-ui-test-gotchas`;
   - `iptv-mock-provider-gotchas`;
   - `iptv-parser-test-patterns` (the mutation lessons);
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `b03afbb`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` shows `cancelled`, read its step times first (a slow apt mirror).
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call. A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `f402524` ("docs: record PR #51's merge"). It is pushed, and the tree is clean.
- **main** has `b03afbb` (PR #51). The branch is ahead by `f402524` and the handover commit, both docs; they go to main with 23d's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate23c.py` and `.log`, the newest template (97 mutants; it keeps each file's CRLF or LF);
    - `verify23c.log`, `verify23c-2.log`;
    - `poly-count20c2a.py` (219);
    - `screenshots/guide-*.png`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Gotchas and lessons
**New in leg 52** (also in memory):
- **Write the mutation list before the run.** It found a real bug: a close from a background event (`listChanging`) did `nav.pop()`, which pops whatever is on top (the player). A screen that can be covered must never pop itself from a background callback.
- **LRU masking:** when a trim runs right after the wanted entries are moved to the newest end, a "never drop a wanted one" check is dead. Remove it, and test the drop order instead (go away, come back, jump far).
- **A redraw bump can be masked twice:** the answer of the ask it starts bumps too, and so does the parent's other version prop. Look for both before keeping a bump.
- **Mutants that make rows unreadable** (rows below 0 or past the end) loop read → ask → read forever. They end at the runner's 180 s timeout, which counts as caught but costs 3 min each.
- **The e2e can't import `apps/tv/src/guide/guide-state.ts`:** it imports `@zoma/ui`'s index, which reaches `.tsx`. Repeat a layout constant in the spec with a comment naming its source (`HEADER = 110`).
- **Polling CI:** a `gh pr checks` loop in the background, then a foreground `for i in $(seq 1 57)` loop over the saved output (10 s steps, 590 s timeout), worked. Don't start several watchers.
- **TZ-stable unit times:** build them from `new Date(2026, 10, 5, h, m)`. Programme lengths that divide 1,440 (30/45/60/90) never cross midnight in UTC, so use 50 and 70 to get crossings on CI.

**From earlier legs (still true):**
- **A connection error can end a CI wait early.** Use a loop on saved output that has pass/fail and no pending.
- **Read a grid's or list's rows in one `page.evaluate`.**
- **@preact/signals skips redrawing a child whose props didn't change.** Pass new functions or a version prop.
- **Line endings:**
  - `docs/architecture.md` and `apps/tv/src/main.tsx` are CRLF in the working copy; RELAY.md and most sources are LF. Detect the ending, then patch.
  - `pathlib.write_text(..., newline='')`.
- **Patch scripts:**
  - Write every multi-line patch script to `$CLAUDE_JOB_DIR/tmp` (the Write tool), then run `python -I <script> "<wt>"`.
  - Use Edit for any line with a backslash.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files). Docs and e2e specs are safe during a unit mutation run.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or `for…of` in TV files;
  - count main after any TV-file change (219).
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
  - Locally: lint, typecheck, 3,619 unit tests, `pnpm verify` twice (75 e2e), mutation 95/95, 219 core-js modules on both, both screenshots looked at.
  - PR #51's CI green on all three jobs, first run; merged as `b03afbb`.
- **Not done:**
  - Main's CI on `b03afbb` is unchecked.
  - The guide screen has never run on Chromium 53/56/68 (step 23e) or on a TV, and was never timed under throttle (23d).
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
  - a "loading" look for guide rows not read yet (they say "No information" for a moment).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.
- **Relay cap:** 60 legs. Leg 52 was the 52nd, so 8 legs remain.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Twenty-nine CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide" (the grid guide screen, `apps/tv/src/guide`).
- **Secrets:** none pending.
