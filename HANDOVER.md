# Lablo IPTV: relay leg 128 opening prompt

You are leg 128 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–127 did steps 1–33, 35 and 35e (PRs #1–#154).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.
- **Leg 127 (2026-11-21) finished step 35e** (Settings loaded on first open). PR #154 was merged as `4035b0f` on green CI at the first run, and 35e is ticked.
  - **Mutation** (`artifacts/mutate35e.py`, 85 mutants written first): 69 were caught at first. Six gaps were closed with tests and ten survivors are equivalent, each with its reason in the script: 75 of 75 caught.
  - **The new tests:**
    - `lazy-file.test.ts` (+4);
    - `e2e/settings-loading.spec.ts` (+2): the guide's "Guide channel" as the first load, and a restored start that opens TV guides (`toGuides`, which had no e2e before).
  - **Two gates leg 126 had missed:**
    - the root `pnpm typecheck`: the e2e imported `lazy-file.ts`, and a VNode props cast;
    - `test/engines-onboarding.test.ts`'s pin of the walk's `shown` line.
  - **Docs:** architecture.md §4's build pipeline item 7, and §1.5's settings rows (the loading screen).
- **Next: step 36 (channel management).** RELAY.md step 36 has leads written in leg 127. Start by writing its shape, as step 35 did in leg 121, then split it.

## Read first
1. **`RELAY.md`:**
   - step 36 and its "Leads for the leg that starts it";
   - step 35's decisions (the profile fields by name and key, the channel numbers, the rail, `relinkLists`; around line 2560–2600, "Channel numbers");
   - step 35e's "Done in leg 127";
   - the last progress row (127).
2. **`docs/PLAN.md` §4, line ~225** (hide, rename or renumber single channels; "clean names" strips prefixes like `AR |` or `UK:`), and line 335 (favourites survive renumbering through a 30-day re-match by normalized name).
3. **`docs/architecture.md`:**
   - §1.4 item 10, "Built in step 35c/35d": favourites, groups, numbers;
   - §1.5's settings rows (the settings screens, 35e's loading screen);
   - §4 build item 7 (settings.js).
4. **The code step 36 builds on:**
   - `packages/data/src/profile.ts` and `favourite-edits.ts` (the profile and its edits);
   - `packages/data/src/favourites.ts` (the re-match);
   - `apps/tv/src/live/live-state.ts` (`hiddenParts`, numbers, `ChannelIndex`);
   - `apps/tv/src/settings/groups-state.ts` and `GroupsPage.tsx` (the closest screen, 35d);
   - `apps/tv/src/settings/settings.ts` (settings.js's entry: `loadSettings`).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `e3db1d9`, `4035b0f` (the merge), `5088b1d`;
   - `origin/main` is `4035b0f`;
   - there is no `*.mutbak`;
   - `docker ps` shows only `lablo-web-postgres-1`;
   - check the free memory (leg 127 started with 31.0 GB of free commit).
2. **Confirm that step 36 isn't already done** (git log, grep `rename`, `renumber`, `cleanName`, `hiddenChannels`). In leg 127 nothing of it existed.
3. **Write step 36's shape in RELAY.md before building**, each choice with its why:
   - the profile fields, by ContentKey like favourites, and the `editProfile` kinds;
   - how a refresh's re-match carries them (`relinkLists`);
   - how a renumbered channel meets 35c's numbers and number entry;
   - what "clean names" strips, and where (shown only, or searched too);
   - what "multiple sources merged" means for the rail and "All channels";
   - the screen (under `apps/tv/src/settings/`, so in settings.js) and the live screen's side (in main.js);
   - the split into 36a, 36b, … each fitting one leg, with "Done when" checks.
   - A choice with real trade-offs for the product is Omar's: end the leg as needs-you with a numbered list (recommended option first).
4. **Build 36a** if the leg still has room; otherwise hand over with the shape written.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`4035b0f`, PR #154's merge) plus:
  - `e3db1d9` (RELAY.md: 35e ticked, step 36's leads);
  - this handover's commit (docs: HANDOVER.md).
- **`main`:** `4035b0f`. The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next` (rebuilt in leg 127);
  - `dist/`: leg 127's full `build:tv`;
  - in `artifacts/`:
    - `mutate35e.py` (run, with its results in the docstring);
    - `unit-35e-leg127.log`, `e2e-35e-leg127-*.log`, `build-tv-35e-leg127.log`;
    - leg 126's logs and screenshots;
    - `amd-probe/` (can be deleted).

## Verified vs not
- **Verified and merged (PR #154, CI green: changes, web, verify, engines; media skipped by its path filter):**
  - `build:tv`: main.js 426.1 KB on Tizen and 413.4 KB on webOS (was 487.6 and 474.9); settings.js 66.1 of 150 KB, in the `.ipk`;
  - unit 7,797; lint; typecheck;
  - e2e: the 15 Settings specs plus settings-loading (53), tv-bundle 10, `e2e:web` 26;
  - `verify:engines` on Chromium 53, 56 and 68: 39 of 39 (leg 126);
  - mutation 75 of 75;
  - the `APP_LAZY` guard checked by hand.
- **Not yet:**
  - Settings' first open on a real TV (step 21's session);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 127:**
- **e2e imports and the root tsc:**
  - an e2e spec must not import an app module whose imports reach `@lablo/ui`, type-only imports included (`lazy-file.ts` does). It pulls the package's `.tsx` into the root tsconfig (no `jsx`), and `pnpm typecheck` fails with TS6142;
  - copy the constant into the spec instead, and pin it in the unit test;
  - run the whole `pnpm typecheck` (root, then every package), not one package.
- **A restored start in e2e:**
  - wait for `configIdle()` and `backupIdle()`, then go to `/?screen=gallery`;
  - edit the `profile` record (`store.put(record)`);
  - open `/?restored=1&locale=…`: "Welcome back" (`backup-start` `data-logins`, `data-guides`), and OK opens Sources or TV guides.
  - See `dropGuideLink` in `e2e/settings-loading.spec.ts`.
- **The guide's "Guide channel" in e2e:**
  - from `guide/grid/0`, RIGHT to the next programme; wait until `readGrid(page, 'guide-screen', '.guide__header > *').time` moves;
  - OK, then RIGHT to `programme/actions/1` (`programme-map`);
  - the mapping picker's test id is `mapping`.
- **Mutation equivalents in guard-heavy code:** timer callbacks that check the attempt number are equivalent when every change of try clears the timers first. Mark them with that reason rather than chasing them.
- **The e2e specs that open Settings:** backup-code, backup-logins-xa, backup-settings, config-blocklist, guide-catchup-m3u, guide-matches, guide-offset, guides, home, live, pairing, telemetry, groups, guide-mapping, settings-loading.
  - The `chromium` project runs them in about 1.5 min at `--workers=3`.
  - `pnpm e2e:web` (backup-logins, backup-api, pairing-api, no-plaintext) needs `pnpm build:web` first, and takes about 35 s.

**From legs 125–126 (still true):**
- **TV-build e2e and Back:** the TV builds read the platform's own key code, so send Back by CDP (`Input.dispatchKeyEvent`, `windowsVirtualKeyCode` from `TV_KEYS[platform].back`; `pressBack` in `tv-bundle.spec.ts`).
- **`page.route` doesn't see `file://` loads:** copy `dist/tv/<platform>` to `test.info().outputPath(...)` and rename settings.js there. In `pnpm dev`, a route on `/src/settings/settings.ts` holds the `import()`. Don't test a failed dev `import()`: Chrome caches failed module fetches.
- **`pnpm dev` loads a lazy module's CSS with it:** a main-side component must not use `settings.css` classes.
- **Rollup AMD:**
  - with `amd.autoId`, dependencies are written `'./main'`;
  - `preserveEntrySignatures: false`;
  - a `banner` is minified by terser.
- **A vm "page" with core-js needs `setTimeout`/`clearTimeout`** (`tools/build/test/script-page.ts`).
- **The size report:** `build:tv` prints main.js and settings.js separately. The per-file source-map probe is described in the leg-125 handover (`git show f504519:HANDOVER.md`).
- **`tuned` stores the list on show** as the last channel's rail entry (`listHolds`).
- **e2e paths:**
  - Home is `live/header/3`, Search `live/header/4`, Settings `live/header/5`;
  - from `live/channels/0`, UP lands on `live/header/0`.
- **CI:**
  - times: engines 27 min, verify 17 min, media 11 min, web 3 min;
  - the `rpc.test.ts:179` flake (a fixed 5 ms sleep): rerun after the whole run.

**From earlier legs (still true):**
- **Memory:** about 80 old leg tabs hold a `claude.exe` each. Run heavy checks one at a time (mutation, then `verify:engines` alone, then e2e, then unit).
- **Mutation:**
  - write the list first, check it with `--check`, run it in foreground chunks;
  - use `MUT_TIMEOUT` (60 for unit, 200–240 for e2e and builds), never an outer `timeout`;
  - restore any `.mutbak` with `mv`;
  - after build-tv.ts mutants, run `pnpm build:tv --skip-package`.
- **Patch scripts:** write Python patch scripts with the Write tool (heredocs mangle backslashes), with `newline=''` on read and write.
- **A navigator click within 300 ms of an OK key is its twin** and is ignored.
- **An en-XA check of a shape passes for any bracketed string:** compare with another element's text for the same key.
- **`itemsByKey`** takes at most 100 keys.
- **The developer screens are only in `pnpm dev` and `dist/tv-dev`** (`STORE_SWAPS`).
- **Main-safe code:**
  - no `trim`, `.sort(`, regex `.test` or `for…of` in new main files;
  - none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`;
  - check blank names by char code.
  - settings.js goes through the same gate: the same rules hold there.
- **Scrub in a worker, never in main.js.** Workers import schema-free subpaths.
- **Any new background worker that writes IndexedDB** counts in `backupIdle()`.
- **Arabic on/off words agree with their noun.** Preact: write `translate={false}`.
- **Overlap:** never push to a PR while its CI runs (it cancels the run). Watch CI with a Monitor poll loop (`gh run view <run> -R Omarmarei/Lablo --json status,conclusion,jobs --jq …`).
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
  - a bare `sleep` is blocked (use `python -c "import time; time.sleep(N)"` inside a loop);
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
- **Step 36's shape:** written by leg 128. A product trade-off in it (for example what "merged sources" shows) goes to Omar as a numbered question.
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
  - forwarding workers' unhandled rejections (33c);
  - a loading screen that another screen covers when settings.js arrives: today nothing pushes over it (every push is on a key, and keys go to it), so it is left as is. Tested in `lazy-file.test.ts`: nothing opens over the cover.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' report rows;
  - a telemetry send and a real TV's report, once step 34 has an API;
  - the favourites star, and "Channel groups"' move mode with the TV's remote;
  - **Settings' first open on the TV** (the settings.js load: a quick open, no spinner expected).

## Checks for Omar
1. **Optional:** in `pnpm dev`, open Settings from the live header. It should open at once, with no spinner.
2. **Optional look:** in the worktree, `artifacts/screenshots/lazy-loading-spinner.png` (the spinner while the file is held) and `artifacts/screenshots/lazy-loading-failed-tizen.png` (the failure screen).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:**
  - about 80 old relay-leg tabs in Cursor keep a `claude.exe` each (about 40 GB committed). Please close the old leg tabs;
  - `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it too.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file).
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
