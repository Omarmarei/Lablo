# Lablo IPTV: relay leg 126 opening prompt

You are leg 126 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–125 did steps 1–33 and 35 (PRs #1–#153).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.
- **Leg 125 (2026-11-20/21) finished step 35d and with it step 35.** PR #153 was merged as `4adad53` on green CI, after one rerun of `verify` (the `rpc.test.ts:179` flake below).
  - **Mutation (`artifacts/mutate35d.py`):** 145 written first, 148 with three added: 145 caught after eleven gaps were closed with tests, and three equivalent (reasons in the script).
  - **A bug the mutation run found, fixed in the PR:** a hidden group's channel played over a favourites list is kept with that list, because `tuned` stores the list on show. Home's "Recent channels" then looked for it in that list and played nothing. `live-state.ts`'s `listHolds` now plays it over the list unless the list holds it.
  - **A simplification:** a removed channel's focus follows `null`, so a failed remove keeps the focus on the channel.
- **Omar's decision of 2026-11-21 (option 1):** the settings screens leave main.js for a second file, loaded the first time Settings opens. It is written as **step 35e**, before step 36, with its leads in RELAY.md.
- **Next: build step 35e.**

## Read first
1. **`RELAY.md`:**
   - step **35e** (just before 36): the facts found in leg 125, the leads and "Done when";
   - step 36's size block: the measurements and the three options (Omar chose 1);
   - the last two progress rows.
2. **The build:**
   - `tools/build/src/bundle.ts`: `bundleIife`, its plugins, `inlineDynamicImports: true`, terser, the worker strings put in at `renderChunk`, and the syntax gate on `output[0]`;
   - `tools/build/build-tv.ts`: the targets (app, the `dev` test copy, lab, vectors), `STORE_SWAPS`, the writes, the size report;
   - `tools/build/src/budgets.ts` and its test;
   - `tools/build/src/platform-files.ts`: `renderIndexHtml`;
   - `tools/build/src/vectors.ts`: the one page that already loads two scripts;
   - the packaging steps for the `.ipk` and `.wgt`.
3. **The app:**
   - `apps/tv/src/main.tsx` around `createSettings` (~537), `openSettings` (~580), `toSources` (~626) and the guide's `map` (~483);
   - `apps/tv/src/live/LiveApp.tsx`: `SettingsScreen` and `SETTINGS_SCREENS`;
   - `apps/tv/src/guide/GuideScreen.tsx`: `MappingReading`;
   - `apps/tv/src/onboarding/restore-code.ts`: `codeGroups`.
4. **Docs:**
   - `docs/adr/ADR-003-chrome53-iife-syntax-gate.md` (the budgets and their 2026-11-03 amendment);
   - `docs/runbooks/tv-build.md`;
   - `docs/runbooks/old-engines.md`;
   - `docs/architecture.md`, the build section (~2255: the budgets, the store build and its test copy).
5. **`CLAUDE.md`:**
   - "Package boundaries" and the "Chromium 53 cheat sheet";
   - CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `7604709`, `74dc905` and `4adad53`;
   - `origin/main` is `4adad53`;
   - there is no `*.mutbak`;
   - `docker ps` shows only `lablo-web-postgres-1`;
   - check the free memory (leg 125 started with 11.5 GB of free commit).
2. **Confirm 35e's leads against the code**, and write any refinements with their why under 35e. Decide early whether it splits:
   - **35e1, the mechanism:** Rollup code splitting to `amd` (or `system`), a small ES5 loader (`define` and `require` by `<script>` tag) at the top of main.js. Prove it with a small lazy test module in the test copy, on Chromium 53, 56 and 68.
   - **35e2:** Settings behind it.
3. **The mechanism:**
   - a dynamic `import()` in the source becomes a chunk;
   - each chunk goes through terser, the worker strings and the ES2016 gate;
   - a budget line for the lazy chunk (about 150 KB);
   - the test copy (`dist/tv-dev`) splits the same way, because the harness and `e2e/tv-bundle.spec.ts` open it;
   - the lab and the vectors page can stay single-file;
   - check that the `.ipk` (and the `.wgt` staging) holds the second file.
4. **Settings behind it:**
   - main keeps a small loader for Settings: say nothing for a short wait, a spinner after about 300 ms, a failed load said with OK to try again, and Back during the load cancelling;
   - `SETTINGS_SCREENS` moves into a small main-side module;
   - decide where the mapping screen goes (the guide opens it) and `codeGroups` (onboarding uses it);
   - `toSources` and the guide's `map` load the file first.
5. **Measure** with the per-file probe (below): main.js should lose about 55–60 KB on Tizen (it is 487.6 KB now).
6. **Gates:**
   - unit (`pnpm test`), lint, typecheck, `build:tv`;
   - `verify:engines --engine chrome53 --engine chrome56 --engine chrome68`, opening Settings from the test copy;
   - e2e of every spec that opens Settings: groups, guides, backup-settings, telemetry, backup-logins-xa, guide-mapping, guide-matches, pairing, tv-bundle and more (grep for `settings/items`);
   - mutation of the loader and the build change (list written first);
   - docs: ADR-003's amendment or a new ADR, `tv-build.md`, architecture.md.
7. **The PR** (from `relay/iptv-20261101-214120`): merged on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
8. **After the merge:** fast-forward the worktree, tick 35e, add a progress row, hand over. Step 36 (channel management) comes next, its screen in the lazy file.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It has:
  - `4adad53` (Merge PR #153), which is `origin/main`;
  - `74dc905` (RELAY.md: the merge record, 35d and 35 ticked, step 36's question);
  - `7604709` (Omar's option 1, step 35e);
  - this handover's commit (docs: HANDOVER.md).
- **`main`:** `4adad53`. The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: the 35d build;
  - in `artifacts/`:
    - `mutate35d.py` (the runner to copy) and `mutate35d.log`;
    - `size36-main-tizen.txt` (the per-file probe after 35d);
    - `size35d-main.ts` (the probe);
    - `engines-35d.log`, `unit-35d-b.log`, `e2e-35d-*.log`, `build-tv-35d-c.log`.

## Verified vs not
- **Verified and merged (35d, PR #153):**
  - unit 7,753;
  - lint of the whole repo, typecheck;
  - `build:tv`: main.js 487.6 KB on Tizen, 474.9 KB on webOS;
  - `verify:engines` 53/68: all 26 runs as expected;
  - e2e 48 + tv-bundle 10;
  - mutation 145 of 148;
  - CI green.
- **Not verified:**
  - a real TV (step 21);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 125:**
- **The per-file size probe:**
  - recreate `tools/build/src/size-probe-bundle.ts` from `bundle.ts` with a Python patch written by the Write tool: `generate(...)` gets `sourcemap: true`, and after `const code = chunk.code;` add `if (options.label === 'probe') (globalThis as { __probe?: unknown }).__probe = { code, map: chunk.map };`;
  - run `pnpm exec tsx artifacts/size35d-main.ts tizen` from the worktree;
  - delete the probe file again;
  - "main.tsx" in its output includes the 884.5 KB of inlined workers.
- **`tuned` stores the list on show as the last channel's rail entry,** even for a channel played over the list. Anything reading the last channel must not assume its entry holds it (`listHolds`).
- **Mutation:**
  - a "focus follows the row" mutant (`follow = null` after a move) is equivalent while edits succeed; kill it with a failed edit (`failEdit`), where the read puts the row back;
  - writing the e2e step for a surviving wiring mutant (`main.tsx`) found a real bug;
  - the `GroupsPage` frames are reached in VNode tests by expanding a component once (`expand(v) = v.type(v.props)`).
- **e2e:**
  - the `live` element isn't painted while Home or the player is on top: check `data-category` after Back reaches the header;
  - Home is `live/header/3`, Search `live/header/4`, Settings `live/header/5`;
  - UP from the rail returns to the header button focused last.
- **CI:**
  - `packages/data/src/rpc.test.ts:179` failed once: a fixed `sleep(5)` before `server.close()`, `cancelledAt` `null`. It is a new flake; rerun after the whole run is done. A later fix: wait for the call to arrive;
  - CI times on PR #153: engines 27 min, verify 17 min, media 11 min, web 3 min.
- **The `groups-state` and `groups-screen` unit runs take about 2 s each:** a unit mutant runs in about 2.3 s, and a groups e2e in about 11 s.

**From leg 124 (still true):**
- **A navigator click within 300 ms of an OK key is its twin and is ignored.** Unit tests that click give the navigator a `now` clock and move it first.
- **OK waits while the groups screens read or save (`pending > 0`).** In unit tests, split the presses: open the channels in one press call, then OK in another. `press()` handles its keys synchronously.
- **A list's channel row's `textContent` joins the number and the name.** Read `group-channel-N-name` instead.
- **Heredocs with JS quotes fail:** write every patch script with the Write tool, then run it with `python -X utf8 -I`.
- **One screen costs about 15–18 KB of main.js** (35d: 17.6 KB, twice the estimate). Measure early with the probe.

**From earlier legs (still true):**
- **Memory:** about 80 old leg tabs in Cursor hold a `claude.exe` each. Run heavy checks one at a time (mutation, then `verify:engines` alone, then e2e, then unit).
- **Mutation runners:** use `MUT_TIMEOUT` (60 for unit, 200 for e2e) and never an outer `timeout`. Restore any `.mutbak` with `mv`.
- **An en-XA check of a shape passes for any bracketed string:** compare against another element's text for the same key.
- **A list's rows:** `itemsByKey` takes at most 100 keys (`KEY_BATCH`).
- **The developer screens are only in `pnpm dev` and `dist/tv-dev`** (`STORE_SWAPS`). The harness and the tv-bundle e2e open the test copy.
- **Main-safe code:**
  - no `trim`, `.sort(`, regex `.test` or `for…of` in new main files;
  - none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`;
  - check blank names by char code (`blank` in `favourite-menu.ts`).
- **Scrub in a worker, never in main.js.** Workers import schema-free subpaths.
- **Any new background worker that writes IndexedDB** counts in `backupIdle()`.
- **Arabic on/off words agree with their noun.** Preact: write `translate={false}`.
- **Overlap:** while a PR's CI runs, build the next step uncommitted; never push to a PR while its CI runs (it cancels the run); watch CI with a Monitor poll loop (`gh run view <run> -R Omarmarei/Lablo --json status,conclusion,jobs --jq …`).
- **git:**
  - `git rev-parse --short` takes one ref per call;
  - absolute worktree paths and `git -C`;
  - never `-c user.email=…`;
  - `git mv` stages at once.
- **CI:** no `jq` (use `gh --jq`). Known flakes, rerun after the whole run:
  - `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US;
  - `rpc.test.ts:179`;
  - media's 30-minute cap;
  - Chromium 53/56 DevTools start-up.
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
- **Step 35e's own choices** are the building leg's, each with its why in RELAY.md:
  - `amd` or `system`;
  - where the mapping screen and `codeGroups` go;
  - the lazy chunk's budget.
  - Ask Omar only if one has a real product trade-off (e.g. a visible wait on the first open).
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
  - `rpc.test.ts:179`'s fixed 5 ms sleep;
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c).
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' report rows;
  - a telemetry send and a real TV's report, once step 34 has an API;
  - the favourites star, and "Channel groups"' move mode with the TV's remote;
  - after 35e: Settings' first open on the TV.

## Checks for Omar
1. **Optional:** in `pnpm dev`, Settings › "Channel groups" (the last row): Move, Hide, and a hidden group's channel played from Search and then from Home's "Recent channels".
2. **Optional look:** `artifacts/screenshots/groups-*` in the worktree.

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
