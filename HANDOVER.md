# Lablo IPTV: relay leg 124 opening prompt

You are leg 124 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–123 did steps 1–33 and 35a–35c (PRs #1–#152).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.
- **Leg 123 (2026-11-20) finished step 35c and merged it:** PR #152, merge commit `87ebcbe`.
  - **35c: the favourites lists in the live screen.**
    - The rail: "All channels", then the lists, then the groups in the user's order, with hidden groups left out.
    - A list's rows are read by key, and the numbers stay stable.
    - The info bar's star (its fifth and last button) and its panel, with "New list".
    - `LastChannel.list`.
  - **Leg 123's own work:**
    - finished the mutation run: 103 of 109 caught. Five gaps were closed with tests (commit `0fad4bd`), and six survivors are equivalent;
    - ran `verify:engines` 53/68: all 26 as expected;
    - ran the e2e specs the change touches: 39 passed;
    - unit 7,610, lint, typecheck;
    - wrote the docs (`44bca91`);
    - CI was green after one rerun of `verify`. `guide-offset.spec.ts` en-US failed once: a new flake, unrelated to 35c;
    - wrote leads for 35d under its RELAY line, from checking it against the code.
- **Next: step 35d, Settings › "Channel groups".**

## Read first
1. **`RELAY.md`:**
   - step 35's block (~2542): the shape, and "Managing";
   - **35d's line and its leads** (~2681): "Checked against the code in leg 123";
   - the 35c refinements (~2643) for how the rail, the lists and the numbers work now;
   - the last two progress rows.
2. **`docs/architecture.md`:**
   - §1.4 item 10, "Built in step 35a" and "Built in step 35c" (~850–868);
   - §2, "Built in step 35c" (the star and the panel, ~1533);
   - §1.5, "Built in step 22b2" (the guides screen, which 35d follows).
3. **The code 35d builds on:**
   - `apps/tv/src/settings/guides-state.ts`: the pattern for rows, a menu per row, a form, and edits run one after another;
   - `settings-state.ts`: `SETTINGS_ITEMS` and `SETTINGS_SCREENS`;
   - `SettingsScreen.tsx`;
   - `apps/tv/src/live/live-state.ts`: `railEntries`, `RailShape`, `readSources`, `takeSources`, `listsChanged`, `playFound`, `playKept`;
   - `apps/tv/src/player/favourite-menu.ts`: the panel's edits and refusals;
   - `packages/data/src/favourite-edits.ts`: the ops.
4. **`CLAUDE.md`:**
   - "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails";
   - CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows leg 123's handover commit, `2fa974f` (RELAY: the merge record and 35d's leads), then `87ebcbe` (Merge PR #152);
   - `origin/main` is `87ebcbe`;
   - no `*.mutbak`: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`;
   - free memory: `Get-CimInstance Win32_OperatingSystem` `FreeVirtualMemory`. Leg 123 began with 3.6 GB of free commit. Run heavy checks one at a time.
2. **Check 35d's shape against the code, then write its refinements under 35d in RELAY**, each with its why, as leg 122 did for 35c. Start from leg 123's leads:
   - no data change: the `favourite` and `group` ops exist;
   - the live screen already follows every edit through `listsChanged()`;
   - the rows: the lists, then every group from `railEntries(sources, { lists: [], hidden: [], order })`, with the hidden ones marked by `groupId`;
   - a moved group stores the whole order, hidden groups included;
   - a list's channels are read with `itemsByKey`, 100 a call. **Decide** whether a missing channel shows (only `normName` is stored) or is left out;
   - `'groups'` goes last in `SETTINGS_ITEMS`;
   - 35c's leftover: a search hit or a recent channel in a hidden group plays nothing today. Play it pinned over the list on show, as the start does (`player.resume(row, guess)` in `main.tsx`).
3. **Build 35d** (`apps/tv`):
   - rows: the lists, then the groups in rail order, the hidden ones marked;
   - OK opens a row's menu:
     - Move up, Move down;
     - Hide or Show (a group);
     - Rename, and Delete asking first (a list);
     - Channels (a list: Move up, Move down, Remove);
     - Cancel;
   - the rename form reuses onboarding's text editor, as the panel's "New list" does;
   - the catalog keys go in en and ar.
4. **Its gates** (step 26's common items):
   - unit tests;
   - e2e in en and ar: the rename, the delete's question, a hidden group's way back, and a list's channels moved;
   - the en-XA walk, screenshots looked at;
   - lint of the whole repo, `pnpm typecheck`;
   - `build:tv` sizes. main.js has 30.0 KB left on Tizen, and 35d needs about 8–10 KB. Probe the new files' core-js;
   - `verify:engines --engine chrome53 --engine chrome68`, in the background with nothing else running;
   - mutation with the list written first, in foreground chunks under 9 minutes, `MUT_TIMEOUT` set;
   - the PR, merged on green CI (merge commit, keep the branch);
   - the docs: architecture.md §1.4 item 10, "Built in step 35d", and the settings section.
5. **Then step 35 is done:** tick 35 itself once 35d merges. The next is step 36 (channel management).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. It has, in order:
  - `87ebcbe` (Merge PR #152, fast-forwarded from `origin/main`);
  - `2fa974f` (docs: the merge record, 35c ticked, 35d's leads, leg 123's row);
  - leg 123's handover commit (docs: HANDOVER.md).

  All pushed. **No PR is open.** These docs commits go into 35d's PR.
- **`main`:** `87ebcbe`. The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: the clean 35c build from after the mutation run;
  - in `artifacts/`:
    - `mutate35c.py`: the docstring lists the six equivalents; the per-run limit is the `MUT_TIMEOUT` variable;
    - `mutate35c-{a..h}.log`;
    - `engines-35c-b.log` (all 26 runs);
    - `e2e-35c-{c,d,offset}.log`, `unit-35c-b.log`, `tsc-35c-b.log`, `lint-35c-b.log`, `build-tv-35c-b.log`;
    - the screenshots from leg 122;
    - the older legs' files (`babel-polys30b2.ts` is the per-file core-js probe; `make_probe35.py` and `size35-main.ts` measure main.js per file).

## Verified vs not
- **Verified (35c, merged):**
  - unit 7,610;
  - e2e: favourites 3/3 (en, ar, en-XA, the renumbering refresh), and player, live, resume, home, search, refresh, guide and tv-bundle;
  - lint, typecheck;
  - `build:tv`: main.js **470.0 KB on Tizen** (30.0 KB left), 457.3 KB on webOS;
  - `verify:engines` 53/68: all 26;
  - mutation: 103 of 109 caught, 6 equivalent;
  - CI on PR #152: web, media and engines passed on the first run; verify passed on the rerun (`pnpm e2e` 174).
- **Not verified:**
  - a real TV (step 21);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 123:**
- **Memory:** about 80 `claude.exe` processes from the Cursor extension (the relay legs' old tabs, about 480 MB each, about 40 GB committed) left 3.6 GB of free commit. Don't kill them: they are Omar's tabs. Run heavy checks one at a time: mutation, then `verify:engines` in the background with nothing else running, then e2e, then unit. Nothing was reaped that way.
- **An outer `timeout` around a mutation runner leaves the file mutated** when it kills python mid-mutant. Mutant 70 hung the panel's tests, and `favourite-menu.ts` was left mutated with its `.mutbak`; restore it with `mv`.
  - Give the runner a per-run limit under the chunk: `mutate35c.py` reads `MUT_TIMEOUT`, 60 for unit and 200 for e2e.
  - A hang counts as caught.
- **A focus callback that lands where the focus already is** survives until a test moves the focus while the edit runs: `nav.handle('OK'); nav.handle('UP')`, then flush.
- **An en-XA check of a shape** (`/^\[.+\]1$/`) passes for any bracketed string of ours. Compare against the text another element shows for the same key.
- **New CI flake:** `guide-offset.spec.ts` en-US. After +1:00, rows 0, 6 and 7 kept the old now for 5 s. Rerun after the whole run is done. If it recurs, look at the query worker applying the offset against the live screen's re-ask (`guideEpoch`).

**From leg 122 (still true):**
- **A list's rows:**
  - `itemsByKey` takes at most 100 keys a call (`KEY_BATCH`) and drops keys it can't find;
  - every reader of the list on show (`rowAt`, `rowCount`, `loadRow`, `findRow`) has a keyed branch, and a new reader needs one too.
- **Numbers:**
  - `chno`, else `index.place(row) + 1`. Never `entry.allStart + row`;
  - in a list, the number is the stored place plus 1.
- **A stale-answer guard can survive** when its stale path gives the same result. Kill it with a reload after the read is in.
- **Heredocs with escaped quotes or backslashes fail or mangle.** Write the block with the Write tool, then apply it with python (`newline=""`).
- **The favourites panel reuses the track menu's classes** (`.tracks*`), plus `favourites__name` and `favourites__actions`.

**From earlier legs (still true):**
- **Before step 38 grows Settings,** measure main.js and ask Omar: load Settings on first open, or a higher budget.
- **The developer screens are only in `pnpm dev` and `dist/tv-dev`.** A dev-only module goes in `STORE_SWAPS`.
- **Main-safe code:**
  - in main, no `trim`, `.sort(`, regex `.test` or `for…of` in new files;
  - check blank names by char code, and let the worker trim.
- **Profile edits:** `editProfile` answers `false` for an edit that changes nothing, goes past a cap, or names a missing list.
- **Logins on the TV are not encrypted at rest (ADR-013).** Say "encrypted end to end whenever they leave the TV; our servers never see them".
- **Scrub in a worker, never in main.js.** Workers import schema-free subpaths.
- **Any new background worker that writes IndexedDB** must count in the hook's `backupIdle()`.
- **Arabic on/off words agree with their noun.** Preact: write `translate={false}`.
- **Overlap works:**
  - build the next step uncommitted while a PR's CI runs, then `git merge --ff-only origin/main`;
  - never push to a PR while its CI runs;
  - wait in foreground loops under ~9 minutes (`gh run view <run> -R Omarmarei/Lablo --json jobs --jq …`).
- **git:**
  - `git rev-parse --short` takes one ref per call;
  - keep absolute worktree paths and `git -C`;
  - never `-c user.email=…`;
  - `git mv` stages at once.
- **CI:**
  - there is no `jq` (use `gh --jq`);
  - known flakes, rerun after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, media's 30-minute cap, Chromium 53/56 DevTools start-up.
- **TV code rules:**
  - no `.sort(` in main;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` is hook-free; UI text comes only from the catalogs.
- **Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22, this PC Node 24;
  - a bare `sleep` is blocked: use `timeout N tail -f /dev/null`;
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
- **35d's shape choices are the relay's** (with their why in RELAY), including whether a list's missing channel shows in its Channels screen. Only a choice with real trade-offs for users goes to Omar.
- **Before step 38:** ask Omar to choose between loading Settings on first open and a higher main budget.
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src`, and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (with `diag_report_no_install`) and deploy, each with his one-word OK.
- **Later fixes to propose (no step yet):**
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - `guide-offset.spec.ts` en-US (new in leg 123);
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c).
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' report rows;
  - a telemetry send and a report from a real TV, once step 34 has an API;
  - the favourites star with the TV's remote and keyboard.

## Checks for Omar
1. **Optional:** in `pnpm dev`, play a channel, press RIGHT four times to the star "Favourites", then OK.
   - With no list yet, OK on "Favourites" makes the list.
   - "New list" asks for a name.
   - The rail then shows the list after "All channels", its channels numbered 1, 2, 3.
2. **Optional look:** `artifacts/screenshots/favourites-panel-en.png`, `player-star-en.png` and `live-list-ar.png` (in the worktree).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:**
  - about 80 old relay-leg tabs in Cursor keep a `claude.exe` each (about 40 GB committed in all). Please close the old leg tabs during relay runs;
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
  - 56: `git show 6235456:HANDOVER.md`. These are the command-table rows for `build:tv`, `e2e` and `verify:engines`, about the test copy `dist/tv-dev`.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
