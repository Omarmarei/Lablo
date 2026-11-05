# Zoma IPTV: relay leg 63 opening prompt

You are leg 63 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–61 did steps 1–24, 25a and 25b, except step 16's Samsung part, 19b and 21 (PRs #1–#61).
- **Leg 62 built step 25c** (the guide's catch-up days, the archive marks, the low-tier tuning) and opened **PR #62**. It is **not merged yet**: CI's `media` job failed twice on infrastructure (below). Leg 62 stopped at the relay's context check.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open.
- **Relay cap:** 100 legs (`relay.py status`).

## First: get PR #62 merged
CI on `df5b314` (run `42042761629`):
- `changes`, `verify` (8 m 21 s: lint, typecheck, unit tests, builds, the full e2e including the throttled run in both tiers) and `engines` (16 m 45 s: Chromium 53/56/68) **passed**.
- `media` **failed twice at its "Install ffmpeg" step**. `apt-get install ffmpeg` crawled on `azure.archive.ubuntu.com` (about 10–100 KB/s) until the job's 30-minute limit cancelled it. The media tests never ran.
- Leg 62 queued a **third re-run** of the failed job just before handing over.

Do this, in order:
1. Read the state: `gh run view 42042761629 -R Omarmarei/Lablo --json jobs --jq '.jobs[] | "\(.name) \(.status) \(.conclusion)"'`.
   - Still running: wait with a background `until` loop on that command (see memory `gh-pr-checks-watch-race`). Don't poll in the foreground.
   - **Green:** merge (step 2).
   - **Failed again at "Install ffmpeg":** end the leg as **needs-you**. Options, recommended first:
     1. Merge on verify + engines green. The media job's code never ran, and this PR doesn't touch the player or the media path.
     2. A small CI PR first that makes the step robust (a cached static ffmpeg, or apt retries with a timeout), then re-run.
     3. Wait and re-run later.
   - **Failed in a media test:** investigate like any failure.
2. **Merge** under the memory rule: merge commit, keep the branch. First tell Omar the three riskiest changes:
   - The guide now keys a row's days by their **local midnight** (`row:midnight`), not by their place in the range. Its range is read asynchronously from the stored guides' summaries (`DataEngine.guidePastDays`), and an open guide's zone changes when that read lands. This touches every guide open.
   - `GuideGrid`'s cells gain a `.z-guide__mark` span holding "Catch-up", so a cell's `textContent` is now title + "Catch-up". The e2e reader (`e2e/guide-grid.ts`) and the old-engine probe now read `.z-guide__title`.
   - The old-engine fixture's playlist gains `catchup="shift" catchup-days="7"` on every 16th entry, and the walk has a new step (`guide-earlier`). It passed CI's engines job.
   - No migrations or deploys (no backend until step 29).
3. After the merge:
   - Fetch, then fast-forward the branch to main: `git -C "<wt>" fetch` and `git -C "<wt>" merge --ff-only origin/main`.
   - Add a "Merged:" line to RELAY.md's 25c block: the merge commit, the CI run's times, the media re-runs.
   - Tick `- [x] 25c.`, commit "docs: record PR #62's merge, tick step 25c (RELAY 25c)", push.
4. Then **step 25d** (RELAY.md, Phase 6): the catch-up player's position, pause, seeking and the programme's end. Read its text and Done-when, plus step 25's common items.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of these (PR #62's commits, on top of `9e5ad94` → `c144172` main):
  - `df5b314` docs: step 25c in architecture.md and RELAY.md;
  - `eaf9ca4` fix(guide): no ask after a range change, and a test for its merge;
  - an engines commit (the walk's marks);
  - `5351cf0` throttled;
  - `fecd177` e2e;
  - `21bacd4` feat.
- It is all pushed, and the tree is clean.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `dist/` (built from `eaf9ca4`'s code);
  - `artifacts/`:
    - `mutate25c.py` (the newest unit template: 59 mutants across app, ui and the harness) with `mutate25c.log` and `mutate25c-b.log`;
    - `mutate25c-e2e.py` (runs `e2e/guide-catchup-days.spec.ts`) with its log;
    - `engines25c.log` and `artifacts/engines/*guide-earlier*.png`;
    - `verify25c.log` (cut short, see below);
    - `poly-count20c2a.py`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit them (LG's license; the repo is public).

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R Omarmarei/Lablo` and absolute paths. **Never `cd`.**
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`** (the product is still "Zoma"):
  - CI runs on `pull_request` and `workflow_dispatch` only, with path-filtered jobs: docs alone run none; `engines` runs on TV bundles and their harness; `media` on the mock, data layer, player, lab or scale tests.
  - Commits use the no-reply email (the repo-local config sets it).
  - No secrets, no LG binaries, no personal data in commits.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## What step 25c built (architecture.md §1.2 and §4, "Built in step 25c")
- **The range:** `guideRange(tier, pastDays)`, `GUIDE_REACH` (full 7, low 2) and `DataEngine.guidePastDays` (the stored guides' longest `summary.pastDays`).
  - The guide reads it when it is made (`readPastDays`) and on `guidesChanged`.
  - `setPastDays` changes an open guide's zone, keeping the focus. Days are kept by midnight, so nothing is re-asked.
  - `GuideOptions.days` became `tier: () => DeviceTier`.
- **The marks:**
  - `player/catchup.ts` has `archiveDays(row)` (Infinity when no days are stated; null without a usable URL), `archiveFrom`, `inArchive` and `archiveDaysLeft`. `canWatchFromStart` uses them.
  - `Guide.archive(row)` uses a per-row cache (`archives`, cleared in `forget`).
  - `GuideGrid` takes `archive` and `archiveName` and adds `is-archive` plus `<span class="z-guide__mark">` after the title. It's drawn first by `order: -1`, and its text is pushed off by `text-indent: 2000px` (the cell cuts it).
  - The grid now has `data-from` and `data-to`.
- **The details:** `DetailsTarget.daysLeft` drives a "programme-left" span in the dialog's time line ("Expires in N days" / "Expires today", the existing `badge.expires`).
- **Tests:**
  - 4,095 unit tests.
  - e2e `guide-catchup-days.spec.ts` (en-US, ar-SA).
  - The throttled spec walks back over marked rows (row 20) and unmarked ones (row 155), and checks each tier's range.
  - `e2e/big-catalog.ts` has an `archive` option, and `gridGuide` reaches 8 days back.
  - The harness: `markFailures`, `MARK_SIZE`, `hasCatchup`, `FIXTURE_CATCHUP_DAYS`, the `guide-earlier` step and the `GridCheck` `'earlier'`.
- **Decided (not gates):**
  - The range follows the stored guides, not the catalog.
  - Days left are calendar days.
  - No day jump yet (about 140 LEFTs to six days back): FF/RW or a day picker is a later decision, and the Magic Remote has no FF/RW.

## Gotchas and lessons
**New in leg 62** (also in memory):
- **Days the guide hasn't read move by 30-minute slots.** Pressing LEFT many times quickly walks placeholders, not programmes. In e2e, press in rounds: press the remaining hours, settle, re-read (`backTo` in `guide-catchup-days.spec.ts`).
- **The mock's guide reaches back only each channel's own archive days** (`max(archiveDays, 1)`). Far back, the other rows are placeholders.
- **The first walk in a throttled run pays for coming first.** Measure a cost against a control run (the same walks without the feature), not walk against walk within one run.
- **Local `pnpm verify` can die under memory pressure:**
  - the Playwright workers fail to start (exit `3221225794`, 0xC0000142);
  - Claude Code reaps the background command;
  - don't restart it unasked: CI's verify runs the full e2e.
- **CI's media job:** "Install ffmpeg" can hang on the Azure Ubuntu mirror until its 30-minute limit. Re-run with `gh run rerun <run> --failed`.
- **Bash heredocs feeding python mangle non-ASCII** (an en dash became `�`) and `\\'` quoting. Use Write-tool scripts, or Edit for exact text.

**From earlier legs (still true):**
- **The relay context check fires at about 450k tokens.** Budget code and e2e first, then mutation, docs, verify, PR, merge.
- **The mock:**
  - Its panel zone is UTC by default. `odd-timezone` is Kathmandu (+05:45, XMLTV without offsets).
  - Its synthetic media never plays. For real frames: `ZOMA_E2E_MEDIA=1 pnpm exec playwright test --project=playback-media player-media -g "<title>"`.
- **Root tests can't import an apps/tv module that reaches `@zoma/ui`** (TS6142 shows only in `pnpm verify`).
- **vitest's `testTimeout` is 30 s:** pass long limits and assert the elapsed time.
- **Playwright `--project chromium <file>` reads the file as a project name.** Use `--project=chromium <pattern>`, and `--project=throttled <spec> --no-deps` for a throttled spec alone.
- **`SettingsScreen.tsx` and `main.tsx` are CRLF** in this worktree; patch scripts normalize to LF, patch, and restore CRLF (single-line Edit is fine).
- **The Edit and Write tools decode `\u` escapes.**
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Docs are safe. If a mutation run is stopped, look for `*.mutbak`.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or iterator calls in TV files;
  - count main after any TV-file change (219 modules: `python -I -u artifacts/poly-count20c2a.py`);
  - the build can crash once (0xC0000005): run it again.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs;
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only;
  - TV code is ES2017;
  - the app imports only types from `@zoma/data`;
  - dependencies must be at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line.

## Verified vs not
- **Verified:**
  - **Locally:**
    - lint, typecheck, 4,095 unit tests, both TV builds, 219 core-js modules on both;
    - the new e2e (2/2) and the throttled spec (both tiers within 150 ms);
    - the old-engine harness: every walk green on Chromium 53, 56 and 68, the new step and marks included, screenshots looked at;
    - mutation: 57/60, then 19/19 on the re-run (one equivalent), and e2e 4/5 (the survivor is caught by the unit tests);
    - screenshots `guide-catchup-days-{en-US,ar-SA}` and `-details` looked at.
  - **On CI:** verify and engines.
- **Not done:**
  - local `pnpm verify`'s e2e stage (cut short by low memory; CI's verify passed);
  - CI's media job (infrastructure);
  - the merge;
  - catch-up on a TV;
  - the guide's marks on a TV;
  - 25d (seeking, the programme's end) and "start over" for the programme on air.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player itself (step 21). Catch-up and the guide's marks can join that visit.
- **Later, from leg 62:** a day jump in the guide (FF/RW, a day picker, or holding LEFT faster). Step 41 lists what the 2018 TV must confirm for 25c.
- **Later (unchanged):**
  - an on-screen keyboard if the TV keyboards fail;
  - webOS's PRE-CH key;
  - the accessibility route;
  - pre-buffered zapping;
  - the last frame kept while reconnecting;
  - step 38's settings rows;
  - parsing subtitle files off the main thread;
  - a remote's own Guide or Info key;
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier;
  - holding refreshes while a low-tier TV plays;
  - the catalogs as UTF-8;
  - a "loading" look for unread rows;
  - the details, the settings and the picker on the old-engine walk;
  - a screen for a guide's own zone;
  - catch-up's "start over";
  - `SourceMemory` for catch-up.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.

## "Press these keys" checklist for step 25c (Omar, in `pnpm dev` with `pnpm mock`)
1. Onboard with the mock's Xtream login, then "Start watching".
2. UP to the header, then OK on "Guide". The grid opens at now.
3. Press LEFT once on "Zoma Test 1 SMPTE" (row 1). The programme gone by shows a small circular arrow before its title; the one on air has none. Rows of channels without catch-up never show it.
4. Press OK. The details have "From the start" first, and the time line ends with "Expires in 7 days". Press Back.
5. Hold LEFT (or press it about 140 times) to six days back on row 1. Every programme there is marked. Press OK: "Expires in 1 day" (or "Expires today" just after midnight). Press OK on "From the start": the player shows the programme with the "Catch-up" badge. Press Back.
6. Keep pressing LEFT: the cursor stops at midnight seven days back (the day in the grid's corner).
7. With `?tier=low` the guide reaches back only two days.
8. Arabic: the marks sit at each cell's right, mirrored, and the details read "ينتهي خلال يوم واحد".

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description (108 runs, 80 that must fail).
- **Secrets:** none pending.
