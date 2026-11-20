# Lablo IPTV: relay leg 125 opening prompt

You are leg 125 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–123 did steps 1–33 and 35a–35c (PRs #1–#152).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.
- **Leg 124 (2026-11-20) built step 35d, Settings › "Channel groups".** It is committed as `630a598` and pushed. There is **no PR yet**, and the context check stopped the leg before the gates.
  - **Refinements:** twelve, each with its why, under 35d in RELAY.md (~2681). The main ones:
    - the screen reads its own rows (the profile, then each source's live categories through `railEntries` with nothing left out);
    - a "Move" mode instead of "Move up" and "Move down": OK picks the row up; UP and DOWN move it a place, CH+ and CH− a page; OK puts it down with one edit; Back puts it back;
    - a moved group stores every group's order, hidden ones included;
    - a list's channels show every key, a missing one by the pool's `normName`;
    - 35c's leftover: a search hit or a recent channel in a hidden group plays over the list on show (`player.over`).
  - **Verified:**
    - unit +54 (`groups-state.test.ts` 35, `groups-screen.test.ts` 12, `live-state.test.ts` +6, `player-state.test.ts` +1). The settings, live, player and i18n folders: 2,675 passed;
    - `e2e/groups.spec.ts` 3/3: en, ar and the en-XA walk. Screenshots `artifacts/screenshots/groups-*` looked at;
    - lint of the changed files, `pnpm typecheck`;
    - `build:tv` before a small trim: main.js **488.3 KB on Tizen** (11.7 KB left), 475.6 KB on webOS. The trim since saved about 0.7 KB (probe: `groups-state.ts` 7.2 KB, `GroupsPage.tsx` 6.2 KB). core-js is unchanged.
- **Next: finish 35d's gates and merge it, then tick 35d and step 35.**

## Read first
1. **`RELAY.md`:**
   - 35d's block (~2681): the leads, "Refined in leg 124" (items 1–12), "Built in leg 124", "Verified in leg 124", "Left for leg 125", and the **size warning for step 36**;
   - the last two progress rows.
2. **The code:**
   - `apps/tv/src/settings/groups-state.ts`, `GroupsPage.tsx`, and their tests;
   - `live-state.ts`: `hiddenParts`, `playOver`, `playKept`'s `kept`;
   - `player-state.ts`: `over`;
   - `main.tsx`: `playOver`, `listsChanged`.
3. **`docs/architecture.md`:**
   - §1.4 item 10, "Built in step 35c" (~850–868): 35d's docs go after it;
   - §1.5, "Built in step 22b2": the settings section.
4. **`CLAUDE.md`:**
   - "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails";
   - CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `630a598` (feat 35d), then `42c7d41`;
   - `origin/main` is `87ebcbe`;
   - there is no `*.mutbak`;
   - `docker ps` shows only `lablo-web-postgres-1`;
   - free memory: leg 124 had 12.3 GB of free commit at the start.
2. **`build:tv`:** record the sizes after the trim (expect about 487.6 KB on Tizen) and grep the log for `Circular dependency: apps/`.
3. **The full unit run** (`pnpm test` or the repo's unit command, in foreground chunks if needed).
4. **`verify:engines --engine chrome53 --engine chrome68`**, in the background with nothing else running. The settings screens and the live screen change. Expect all 26 runs as expected.
5. **Mutation:**
   - write the list first, as `artifacts/mutate35d.py` (copy `mutate35c.py`'s runner with `MUT_TIMEOUT`);
   - cover `groups-state.ts` (`groupRows`, `rowActions`, `shift`'s bounds, `endMove`'s three edits, `cancelMove`, `save`'s `changed` only when saved, the stale-read guard, `readChannels`' batches and its stale guard, the rename's blank and same-name checks, the delete's `DELETE_NO` focus);
   - cover `GroupsPage.tsx` (`rowLine`, `rowName`, the classes) and `live-state.ts` (`hiddenParts`' `first`, `playOver`'s checks, `playKept`'s list exception);
   - cover `player-state.ts` (`tune`);
   - run it in foreground chunks under 9 minutes.
6. **E2e of the specs the change touches:** `groups`, `favourites`, `live`, `search`, `home`, `guides`, `backup-settings`, `settings`-related ones, `tv-bundle`.
7. **Docs:** architecture.md §1.4 item 10 "Built in step 35d", and the settings section (the sixth row, `GROUP_SCREENS`, the move mode).
8. **The PR** (from `relay/iptv-20261101-214120`): merged on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first:
   - `player.over` and the hidden-group play path;
   - the group order stored with hidden groups;
   - `'groups'` as the sixth settings row.
9. **After the merge:** fast-forward the worktree from `origin/main`, tick 35d and **step 35**, add the merge record and a progress row, then hand over.
10. **The next step is 36 (channel management), but its size decision comes first.** main.js has about 12 KB left on Tizen, and step 36 needs a screen of its own. So **before building 36**, measure and **ask Omar** (needs-you, a numbered question): load Settings and the other secondary screens on first open, or a higher main budget. The handover from leg 121 planned this question for step 38; the budget makes it due now.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It has:
  - `87ebcbe` (Merge PR #152);
  - `2fa974f` and `42c7d41` (leg 123's docs);
  - `630a598` (feat 35d);
  - this handover's commit (docs: HANDOVER.md).
- **`main`:** `87ebcbe`. The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: the 35d build from before the trim;
  - in `artifacts/`:
    - `e2e-35d-{a..f}.log` (f is the last, 3 passed), `tsc-35d.log`, `build-tv-35d.log`;
    - `size35d-main.ts` and `size35d-main-tizen.txt` (the per-file probe; it imports `tools/build/src/size-probe-bundle.ts`, which was deleted after use: recreate it from `bundle.ts` with `sourcemap: true` and `globalThis.__probe = { code, map }` when `label === 'probe'`, then delete it again);
    - `mutate35c.py` (the runner to copy).

## Verified vs not
- **Verified (35d, not merged):** unit in the touched folders 2,675; `groups.spec.ts` 3/3; lint (the changed files); typecheck; `build:tv` 488.3 KB Tizen before the trim.
- **Not verified yet:**
  - the full unit run;
  - the whole repo's lint;
  - `verify:engines`;
  - mutation;
  - the other e2e specs;
  - CI;
  - a real TV (step 21);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 124:**
- **UP from the live rail goes to the header button focused last,** not to header/0. E2e helpers walk to the header's end and then step back (`toSettingsButton` in `groups.spec.ts`).
- **A navigator click within 300 ms of an OK key is its twin and is ignored.** Unit tests that click give the navigator a `now` clock and move it first (`click` in `groups-state.test.ts`).
- **OK waits while the groups screens read or save (`pending > 0`).** In unit tests, split the presses: open the channels in one press call, then OK in another.
- **A list's channel row's `textContent` joins the number and the name.** Read `group-channel-N-name` instead.
- **Heredocs with JS quotes failed again:** write every patch script with the Write tool, then run it with `python -X utf8 -I`.
- **35d cost about 17.6 KB of main.js,** about twice the estimate. The two new files are 13.4 KB minified; the rest is the catalogs and wiring. Measure early in a UI step, with the source-map probe.

**From leg 123 (still true):**
- **Memory:** about 80 old leg tabs in Cursor hold a `claude.exe` each. Run heavy checks one at a time (mutation, then `verify:engines` alone, then e2e, then unit).
- **An outer `timeout` around a mutation runner leaves the file mutated:** use `MUT_TIMEOUT` (60 for unit, 200 for e2e). Restore any `.mutbak` with `mv`.
- **A focus callback that lands where the focus already is** survives until a test moves the focus while the edit runs.
- **An en-XA check of a shape passes for any bracketed string:** compare against another element's text for the same key.
- **CI flake:** `guide-offset.spec.ts` en-US. Rerun after the whole run is done.

**From earlier legs (still true):**
- **A list's rows:** `itemsByKey` takes at most 100 keys (`KEY_BATCH`); every reader of the list on show has a keyed branch.
- **Numbers:** `chno`, else `index.place(row) + 1`; in a list, the stored place plus 1.
- **The developer screens are only in `pnpm dev` and `dist/tv-dev`.**
- **Main-safe code:**
  - no `trim`, `.sort(`, regex `.test` or `for…of` in new main files;
  - none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`;
  - check blank names by char code (`blank`, now exported from `favourite-menu.ts`).
- **Profile edits:** `editProfile` answers `false` for an edit that changes nothing, goes past a cap, or names a missing list.
- **Logins on the TV are not encrypted at rest (ADR-013).**
- **Scrub in a worker, never in main.js.** Workers import schema-free subpaths.
- **Any new background worker that writes IndexedDB** counts in `backupIdle()`.
- **Arabic on/off words agree with their noun** ("مخفية" for a group). Preact: write `translate={false}`.
- **Overlap:** build the next step uncommitted while a PR's CI runs; never push to a PR while its CI runs; wait in foreground loops under ~9 minutes (`gh run view <run> -R Omarmarei/Lablo --json jobs --jq …`).
- **git:**
  - `git rev-parse --short` takes one ref per call;
  - absolute worktree paths and `git -C`;
  - never `-c user.email=…`;
  - `git mv` stages at once.
- **CI:** no `jq` (use `gh --jq`). Known flakes, rerun after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, media's 30-minute cap, Chromium 53/56 DevTools start-up.
- **Physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free; UI text comes only from the catalogs.**
- **Smart App Control:** before every pnpm or npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22, this PC Node 24;
  - a bare `sleep` is blocked;
  - `TaskStop` on `verify:engines` leaves its container behind;
  - the TV build can crash once (0xC0000005): rerun it;
  - the Chromium 53 DevTools start-up timeout happens locally too: rerun once.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34; its migration and deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Before step 36 (moved up from 38 by the budget):** ask Omar to choose between loading Settings and the secondary screens on first open, and a higher main budget.
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (with `diag_report_no_install`) and deploy, each with his one-word OK.
- **Later fixes to propose (no step yet):**
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - `guide-offset.spec.ts` en-US;
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c).
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' report rows;
  - a telemetry send and a real TV's report, once step 34 has an API;
  - the favourites star, and "Channel groups"' move mode with the TV's remote.

## Checks for Omar
1. **Optional:** in `pnpm dev`, open Settings › "Channel groups" (the last row).
   - OK on a group, then "Move": UP and DOWN move it, OK puts it there.
   - "Hide" takes a group out of the rail. Searching one of its channels still plays it.
2. **Optional look:** `artifacts/screenshots/groups-en.png`, `groups-ar.png`, `groups-channels-moving-en.png` and `groups-delete-ar.png` (in the worktree).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:**
  - about 80 old relay-leg tabs in Cursor keep a `claude.exe` each (about 40 GB committed). Please close the old leg tabs;
  - `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it too.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-six CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`;
  - 56: `git show 6235456:HANDOVER.md`.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
