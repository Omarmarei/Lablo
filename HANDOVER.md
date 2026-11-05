# Zoma IPTV: relay leg 55 opening prompt

You are leg 55 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–53 did steps 1–22 and 23a–23d, except step 16's Samsung part, 19b and 21 (PRs #1–#52).
- **Leg 54 did 23e (the grid on Chromium 53/56/68) and ticked step 23:**
  - It merged as PR **#53** (merge commit **`36dbaa1`**, branch kept). CI on `bfe76b6` was green on the first run: verify 12 m 31 s, media 11 m 4 s, engines 15 m 43 s (all 108 engine runs as expected).
  - Main's CI on `dad3a7a` (PR #52) was green. **Check main's run on `36dbaa1`** (it started at 04:00 UTC).
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 24, programme details (RELAY.md, Phase 6, "6.3")
RELAY.md's 24: "Details, manual EPG-to-channel mapping, match diagnostics, per-source time offset." **It has no Done-when yet, and it is too big for one leg.**

1. **First check what exists:**
   - `git log --oneline -60`;
   - grep `epg_channels`, `unmatched`, `diagnostic`, `offset`, `mapping` in `packages/data` and `apps/tv`.
   - The data layer already keeps the match table and the unmatched live channels per guide generation ("for step 24's diagnostics": architecture.md §1.5, around "`epg_channels`, one record per guide generation").
   - Times without an offset are read in the panel zone for Xtream and in UTC for the others "until step 24 adds per-guide offsets" (§1.5).
2. **Then split 24 in RELAY.md** into session-sized sub-steps (24a, 24b…), each with a runnable Done-when, as leg 51 did with 23. Commit that split on its own (`docs(relay): split step 24`).
   - The sources: PLAN.md lines ~204 ("a time offset per source"), ~219 (per-source time offset, manual channel-to-EPG mapping), ~230 ("programme details") and ~261.
   - architecture.md §1.5 (EPG pipeline: matching methods, `tvg-shift`, ADR-010 time zones) and §1.2 (the guide screen, step 23c).
   - A likely order: (a) the programme details screen from the grid (OK on a programme gone by or to come does nothing today; on air it plays); (b) per-source time offset in the source settings and the EPG read; (c) match diagnostics (rate per source, unmatched channels); (d) manual mapping. Your call, written down in RELAY.md with reasons.
3. **Then do 24a** if the leg has room. The UI rules below apply. Each sub-step needs unit tests, e2e by keys in en and ar, screenshots looked at, a mutation run, `pnpm verify` green and the PR merged.
4. **Decisions:** earlier legs made UX calls themselves and recorded them as "Decided (not a gate)" in RELAY.md and architecture.md. Only a real trade-off Omar must own is a needs-you stop.

## Facts and decisions from leg 54 (step 23e)
- **The walk** (`tools/engines/src/onboarding.ts`, `guideSteps`): the onboarding walk goes on from the rail where the live steps end (Group 5):
  - RIGHT (LEFT in Arabic) to the list's first channel, UP to the header's "Guide", OK;
  - ArrowDown, a programme on, CH−, three programmes on (the view moves past now), Back to `live · channels 10`.
- **The checks** (`tools/engines/src/guide.ts`):
  - An ES5 probe (`GRID_VIEW_FUNCTION`) reads the grid.
  - `gridFailures` measures it against `GUIDE_LAYOUT` from the timeline's inline start; `scheduleFailures` checks the cells against the fixture's hourly guide; `cursorFailures` checks the focused cell.
  - `guideFailures` in onboarding.ts checks where now is.
  - A step with `along` expects the cursor where its keys lead, worked out from the cursor read before them (`withCursor`, `timeAfter`), so it lands only once every press is drawn.
  - `guide-drawn.ts` is a **test helper**: a grid drawn as `GuideGrid` draws it, which the tests break one thing at a time.
- **The seed:** `seed-css-no-guide-x` drops the cells' `left: var(--x)` and its mirror `right: var(--x)`. It fails every guide step on every engine.
  - Self-test: 108 runs, 80 must fail.
  - Every check passed on the first run: custom properties set inline by Preact position fine on Chromium 53.
- **Harness race fixed:** `resetDatabase` used to navigate `blank.html` → `blank.html`, and the old document answered first (`could not be deleted before the walk (none)`). It now marks the page with `STALE_MARK` and waits for an unmarked `PAGE_STATE`.
- **Checks:**
  - 3,672 unit tests (+49); mutation 64/64 (`artifacts/mutate23e.py`);
  - no app code changed: main 311.3 KB Tizen, 298.7 KB webOS; 219 core-js modules.
- **Docs:** architecture.md §4 "Built in step 23e"; runbook old-engines.md item 6 ("The grid guide"), its self-test row and troubleshooting.

### "Press these keys" (unchanged, desktop)
1. Run `pnpm mock` and `pnpm dev`. Open `http://localhost:5173/` and onboard with the mock's Xtream login (host `localhost:8080`; the user and password are in `apps/mock-provider/test/helpers.ts`).
2. On the live screen, press UP from the first channel, then OK on "Guide".
3. In the grid: RIGHT/LEFT go a programme on or back, UP/DOWN change channel, PageDown/PageUp page.
4. OK on the programme on air plays; Back returns to the guide; Back again goes to the list.
5. Add `?locale=ar-SA`: the channels are on the right, and time runs leftwards.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: steps 23–25, and the progress-log rows for legs 51–54.
3. `docs/architecture.md`: §1.2 "Built in step 23b" and "Built in step 23c" (the grid, the guide screen); §1.5 (the EPG pipeline: matching, `epg_channels`, offsets, ADR-010).
4. `docs/PLAN.md` around lines 200–265.
5. The code: `apps/tv/src/guide/` (`guide-state.ts`, `GuideScreen.tsx`), `packages/data` (the EPG worker, `epg_channels`), the settings screens (`apps/tv/src/settings`, step 22).
6. Memory:
   - `iptv-parser-test-patterns` (mutation lessons);
   - `iptv-ui-test-gotchas`, `iptv-css-pipeline-gotchas`, `iptv-tv-bundle-polyfills`, `iptv-mock-provider-gotchas`;
   - `use-write-tool-for-doc-batches`, `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `36dbaa1`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` shows `cancelled`, read its step times first (a slow apt mirror).
   - If `verify` failed on `guide-throttled.spec.ts`, read its console line before touching code.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call. A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `f28b466` ("docs: record PR #53's merge, tick steps 23e and 23"). It is pushed, and the tree is clean.
- **main** has `36dbaa1` (PR #53). The branch is ahead by `f28b466` and the handover commit, both docs; they go to main with step 24's first PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `dist/` (built from the current code);
  - `artifacts/`, which includes:
    - `mutate23e.py` and its log (the newest mutation template: mutants over several files, Popen + taskkill on timeout);
    - `mutate23c.py` (the newest large app-code template);
    - `engines23e-selftest{,2}.log`;
    - `engines/` (report.json and the screenshots, guide ones included);
    - `perf/`, and the trace analysers `trace-*23d.py`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Gotchas and lessons
**New in leg 54:**
- **Heredocs ate backslashes again:**
  - in a python patch, `'\\n'` inside TS test strings became real newlines;
  - a `failures.join('\n')` became a real newline in a script.
  - Fixed with Edit. **Write every patch script with the Write tool, or use Edit**, for any line with a backslash.
- **Writing the mutant list first found a dozen checks no test made fail, and two unreachable pieces of code.** Still the best use of mutation time.
- **A test file can't import another test file** (its tests would register twice). Shared test drawings go in a plain module (`guide-drawn.ts`).
- **The old-engine harness:**
  - Every same-URL navigation needs `STALE_MARK` first; the reset now has it.
  - Don't run the unit suite alongside a self-test: the load surfaced the race. It was a real bug, but runs under load are noisier.
  - A full local `--self-test` takes about 25 min, and CI's engines job about 16 min.
- **CSS custom properties set inline** (Preact's `style={{ '--x': … }}` → `style.setProperty`) position on Chromium 53, 56 and 68 with rtlcss's mirrored `left`/`right: var(--x)`.

**From earlier legs (still true):**
- **Write the mutation list before the run.** It finds masked guards and real bugs (leg 52: a background close popped the player).
- **A screen that can be covered must never pop itself from a background callback.**
- **A screen's first draw, opened by a key, is its slowest press.** Ask for its data after the opening frame (leg 53).
- **The e2e can't import `apps/tv/src/guide/guide-state.ts`** (it reaches `.tsx` through `@zoma/ui`'s index). Repeat a constant with a comment naming its source; root tests check them by reading the source.
- **A connection error can end a CI wait early.** Loop on saved output that has pass/fail and no pending (the leg-54 Monitor loop worked).
- **Read a grid's or list's rows in one `page.evaluate`.**
- **@preact/signals skips redrawing a child whose props didn't change.** Pass new functions or a version prop.
- **Line endings:**
  - in this worktree, `docs/architecture.md`, `docs/runbooks/old-engines.md`, RELAY.md, HANDOVER.md and the e2e files are LF;
  - `apps/tv/src/main.tsx` was CRLF before; detect the ending, then patch.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files). Docs are safe.
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
  - a new screen root needs `data-screen/zone/index` (and the old-engine walk reads them).
- **Dependencies** must be at least 2 weeks old. Never weaken lint.
- **Commits:** scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,672 unit tests, mutation 64/64, `pnpm verify:engines --self-test` (all 108 runs as expected on 53, 56 and 68).
  - PR #53's CI green on all three jobs; merged as `36dbaa1`.
- **Not done:**
  - Main's CI on `36dbaa1` is unchecked.
  - `pnpm verify`'s build and e2e halves were not run locally in leg 54 (tools and tests only); CI's `verify` passed.
  - The guide screen has never run on a TV.
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
  - a "loading" look for guide rows not read yet.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.
- **Relay cap:** 60 legs. Leg 54 was the 54th, so 6 legs remain.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide" (the grid guide screen, `apps/tv/src/guide`);
  - 30: the `pnpm verify:engines` row says `--self-test` proves the syntax seeds and a no-polyfill build. It now also walks onboarding, the live screen and the grid guide by keys, and runs the CSS, walk and lab seeds: 108 runs, 80 that must fail.
- **Secrets:** none pending.
