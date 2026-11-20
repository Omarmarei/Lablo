# Lablo IPTV: relay leg 122 opening prompt

You are leg 122 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–120 did steps 1–33 (PRs #1–#149).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.
- **Leg 121 (2026-11-19 and 20) did step 35's shape, 35a and 35b:**
  - **Step 35's shape and split** are in RELAY.md (line ~2542): favourites lists, hidden and reordered groups, channel numbers. Split into:
    - 35a, the data side;
    - 35b, the size pass;
    - 35c, the live screen;
    - 35d, Settings › "Channel groups".
  - **35a, PR #150, merge commit `8f47789`:** the data side (`packages/data`).
    - `favourite-lists.ts` holds main-safe readers, exported from `@lablo/data/client`: the types `FavouriteList` and `GroupRef`, the caps, `favouriteListsOf`, `hiddenGroupsOf`, `groupOrderOf`, `groupId`.
    - `favourite-edits.ts` is the workers' only: `applyFavouriteChange`, `applyGroupChange`, `relinkLists`, `isFavouriteItem`.
    - Two new `ProfileEdit` kinds:
      - `favourite`: `add`, `remove`, `move`, `newList`, `rename`, `removeList`, `moveList`;
      - `group`: `hide`, `show`, `order`.
    - The fields are optional (`favouriteLists`, `hiddenGroups`, `groupOrder`), so the profile version did not change.
    - A refresh's re-match rewrites the lists in the same write.
    - The query worker's search boost comes from the stored favourites; `setFavourites` is gone.
  - **35b, PR #151, merge commit `a0739ef`:** Omar's decision of 2026-11-20 (option 1): the developer screens are out of the store build.
    - `apps/tv/src/dev/dev-screens.tsx` holds the hello screen, the component gallery and the grid guide's gallery page, with their stylesheet `dev-screens.css` (the old `apps/tv/src/app.css`).
    - `dev-screens.store.ts` is a stand-in that shows none. The build swaps it in through `STORE_SWAPS` in `tools/build/src/bundle.ts`.
    - `pnpm build:tv` also writes a **test copy** with the developer screens to `dist/tv-dev`. It is never packaged and has no main budget.
    - Each worker is built once per run (`workerCache`).
    - The old-engine harness runs hello and the gallery on the test copy (the `dev` variant).
    - **main.js is now 459.9 KB on Tizen (40.1 KB left)** and 447.2 KB on webOS.
  - **The docs commit `d5eec8a`** (on the branch, not yet in main): 35b ticked and leg 121's second progress row. This handover's commit sits on top of it.
- **Omar's standing instruction (35b):** before step 38 grows Settings, a leg measures main.js again and asks him to choose: load Settings on first open, or a higher budget.

## Read first
1. **`RELAY.md`:**
   - step 35's block (line ~2542): the facts found, the shape (each choice with its why), the split;
   - 35a's and 35b's "Built", "Refined" and "Verified" notes;
   - the 35c and 35d lines (~2643);
   - the two progress rows of leg 121 (the last lines).
2. **`docs/architecture.md`:**
   - §1.4 item 10 "Built in step 35a" (line ~848);
   - §4 item 6, the store build and its test copy (line ~2216);
   - the profile document line in §1.3 (~790).
3. **The runbooks:**
   - `docs/runbooks/tv-build.md`, "The store build and its test copy (step 35b)";
   - `docs/runbooks/old-engines.md`: the `dev` variant and the self-test table.
4. **The code 35c builds on:**
   - `packages/data/src/favourite-lists.ts` and `favourite-edits.ts`;
   - `apps/tv/src/live/live-state.ts`: `railEntries`, `RailEntry`, `RailRef`, `findEntry`; the number entry `findRow` at line ~590 uses `allStart`;
   - `apps/tv/src/live/channel-index.ts`;
   - `apps/tv/src/player/player-state.ts`: `ZapList` (`count`, `row`, `load`, `find`, `locate`) and `CHANNEL_ACTIONS` (line ~392: the info bar's buttons);
   - `packages/data/src/query-service.ts`: `itemsByKey`, at most `KEY_ITEMS_MAX` = 100 keys a call, missing keys dropped;
   - `apps/tv/src/settings/guides-state.ts`: the row-menu pattern 35d copies.
5. **`CLAUDE.md`:**
   - "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails";
   - CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit (`docs: add leg-121 handover; …`), then `d5eec8a`, `a0739ef`, `1ed7a67`;
   - `origin/main` is `a0739ef`; the branch is pushed; no PR is open;
   - no `*.mutbak`: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **35c: the lists in the live screen** (`apps/tv`). First check 35c's part of the shape against the code, and write the refinements in RELAY with their why (as 33d did), then build. The points to settle:
   - **A list's rows come from keys, not chunks.** `itemsByKey` gives 100 at most a call and drops keys it can't find. The live list (and the player's `ZapList`) needs a second kind of list beside `ChannelIndex`.
   - **The rail:**
     - "All channels", the favourites lists (an empty one too), then the groups: the `groupOrder` ones first in that order, then the rest in the provider's order;
     - hidden groups out of the rail and out of "All channels".
   - **Numbers stay as they are without the user's changes:** `tvg-chno` or `num`, else the place in the provider's whole list. Hidden groups count, and the provider's order applies, so each part needs its own `allStart` once parts are hidden or moved. In a list, a channel's number is its place (1, 2, 3…), and number entry and CH± use those numbers.
   - **Where the start-on-last-channel memory points:** `LastChannel.category` is `{src, name} | null`, and a list needs a way to be named there (for example an optional `list` id). That is a profile shape change: write it in RELAY with its why.
   - **The info bar's "Favourites" button** (a star, filled when the channel is in a list; add it to `CHANNEL_ACTIONS`) and its panel:
     - each list as a checked or unchecked row: OK adds the channel or takes it out;
     - "New list": onboarding's text editor (`createTextEditor`), and the channel goes into the new list.
     - Main builds the `FavouriteItem` from the row's `CatalogItem`: `key`, `src`, `kind`, `normName`, `group`, `epgId`, and `added: Date.now()`.
     - Main picks a new list's id: unique among the lists, at most 32 characters, for example `l` plus `Date.now().toString(36)`.
     - After each edit, main reads the profile again and rebuilds the rail.
   - **Budget:** about 8–10 KB of main.js (40.1 KB left). Probe each new TV file for core-js modules (`pnpm exec tsx artifacts/babel-polys30b2.ts <files>`).
   - **e2e:**
     - add a channel to a new list, see its rail entry, zap in it by number;
     - a channel in a list survives the mock's renumbering refresh. In-process e2e can set `app.mockState.catalog` (see `e2e/refresh.spec.ts`); `renumbered()` is in `test/ingest-mock.test.ts`.
     - in en and ar, plus the en-XA walk for the new text, and screenshots looked at.
   - **Then step 26's common items** (below).
3. **35d** (Settings › "Channel groups") after 35c, likely the next leg. It follows the guides screen's pattern:
   - rows: the lists, then the groups in rail order, hidden ones marked;
   - OK opens a row's menu: Move up, Move down, Hide or Show, Rename, Delete (asking first), Channels (Move up, Move down, Remove), Cancel.

**Step 26's common items still apply to any build:**
- unit tests;
- mutation with the list written first (copy `artifacts/mutate35b.py`, which has build and e2e commands; run it with `python -X utf8 -I -u`, in foreground chunks with `--to`/`--from`);
- lint of the whole repo, `pnpm typecheck`;
- `build:tv` sizes;
- `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes (in the background, about 30 minutes; with `--self-test` about 45);
- `pnpm build:web` then `pnpm e2e:web` when apps/web changes;
- the PR merged on green CI;
- the docs.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, at `a0739ef`, plus `d5eec8a` (docs) and this handover's commit. Pushed. The next PR carries them.
- **`main`:** `a0739ef` (Merge PR #151). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: 35b's clean build, including `dist/tv-dev`;
  - in `artifacts/`:
    - `mutate35a.py` and `mutate35b.py` with their `-a`/`-b`/`-c` logs;
    - the size probe: `size35-main.ts`, `make_probe35.py`, `make_main_probe35.py`, and `size35-main-tizen.txt` (main.js per source file, before 35b);
    - logs: `unit-35a.log`, `unit-35b.log`, `lint-35*.log`, `tsc-35*.log`, `build-tv-35a.log`, `build-tv-35b*.log`, `e2e-35b*.log`, `engines-35a.log`, `engines-35b.log`;
    - the older legs' files (`babel-polys30b2.ts` is the per-file core-js probe).

## Verified vs not
- **Verified in leg 121:**
  - **35a:**
    - unit 7,544;
    - the ingest-mock renumbering keeps two lists in order;
    - the bundled query worker makes a list in the Chromium 53 stand-in realm;
    - lint and typecheck; main.js unchanged;
    - `verify:engines` 53/68: all 26 runs;
    - mutation 113/113 after one gap;
    - CI #150 green on the first run.
  - **35b:**
    - unit 7,550;
    - e2e 38 (`tv-bundle` with the store build's new test, `hello`, `gallery`, `guide-gallery`, `config-gate`);
    - lint and typecheck;
    - `verify:engines --self-test` 53/68: all 90 runs, 60 seeded failures caught;
    - mutation 29/29;
    - CI #151 green on the first run (web 3 m, verify 17 m, engines 26 m; media skipped by its path filter).
- **Not verified:**
  - the whole `pnpm e2e` locally (CI's verify ran it);
  - a real TV (step 21);
  - Vercel, R2, Upstash, and any production database (step 34).
- **Migrations and deploys:** none this leg. Nothing is in production or deployed. The dev and test databases still carry 33d1's `diag_report_no_install`.

## Gotchas and lessons
**New in leg 121:**
- **The developer screens are not in `dist/tv` any more.**
  - `?screen=hello`, `gallery` and `gallery-guide` work only in `pnpm dev` and the test copy `dist/tv-dev`. The store build ignores `?screen=` and starts as a TV does.
  - A future dev-only module must be added to `STORE_SWAPS`, beside a stand-in of the same type.
  - The harness refuses a store build with the developer screens, and a copy without them (`assertDevScreens`: app.css's `.hello {` rule).
- **There is no app-wide `apps/tv/src/app.css` any more.** It held only the hello screen's rules and is now `dev/dev-screens.css`. A screen's CSS goes in its own file, imported by the screen.
- **Main-safe modules in `@lablo/data/client`:**
  - `favourite-lists.ts` uses no `trim`, `.sort(`, regex `.test` or `for…of`. The edits (with `trim`) run in the query worker only.
  - A field named `keys` pulls `es.array.iterator` and `web.dom-collections.iterator`; main already has both.
- **Profile edits:**
  - `editProfile` answers `false` for an edit that changes nothing, goes past a cap, or names a list that isn't there.
  - The query worker orders its favourites against edits with the edit number (`setFavouriteKeys`, `favouritesFrom`), as the guides' offsets.
- **The worker cache's key** is `entry|platform|polyfills`. A worker's defines aren't passed to worker builds (they take the TV defaults), so they aren't in the key.
- **Measuring main.js per file:** `python -X utf8 -I artifacts/make_probe35.py "<wt>"` copies `bundle.ts` into `tools/build/.size35/` (the Rollup plugins resolve only under tools/build). Then `pnpm exec tsx tools/build/.size35/size35-main.ts tizen` prints the minified bytes per source file from the source map. `PROBE_MAIN=<entry>` measures another entry. Delete `tools/build/.size35` afterwards.
- **A self-test variant that must fail** needs a check that it fails for its own reason. That is how the `no-polyfills` gap was found.
- **The unit suite under load:** `tools/fixtures/test/xtream-xmltv-core.test.ts`'s 61-byte read can time out at 30 s; alone it takes 0.9 s. Rerun it alone.
- **A needs-you stop mid-step:** leg 121 built what didn't depend on the answer (35a) first, then asked. Omar's answer came in the same conversation, and the leg went on.
- **Patch scripts:** write each with the Write tool into the session's scratchpad, read and write with `newline=""`, and assert each edit is found exactly once. A patch whose first edit changes the text of a later one fails that later one; order the edits, or replace all at once.

**From earlier legs (still true):**
- **Logins on the TV are not encrypted at rest (ADR-013).** Say "encrypted end to end whenever they leave the TV; our servers never see them".
- **Scrub in a worker, never in main.js** (`@lablo/protocol/scrub` is 25.8 KB on Chromium 53). Workers import schema-free subpaths (`telemetry-buckets`, `backup-limits`); the `@lablo/protocol` index pulls zod.
- **The dev app posts as `platform: 'browser'`:** the real API answers 400, so plain e2e uses the config server's stand-ins (telemetry, diag) and reads bodies with the server's schemas.
- **Any new background worker that writes IndexedDB** must count in the hook's `backupIdle()`.
- **Arabic on/off words agree with their noun.** A new switch row gets value keys of its own.
- **Preact sets `translate` as a property:** write `translate={false}`.
- **Chromium refuses port 9.** Playwright's `expect.any(Number)` is not a number type.
- **Event objects in main:** plain functions, `import type` only from `@lablo/protocol`. Never read `.at` in TV code.
- **A new Settings row** shifts DOWN paths and joins the en-XA walk. Settings has five rows (guides, sources, backup, telemetry, report).
- **Overlap works:**
  - build the next step uncommitted while a PR's CI runs, then `git merge --ff-only origin/main` with the dirty tree after the merge;
  - never push to a PR while its CI runs;
  - wait in foreground loops under ~9 minutes (`gh run view <run> -R Omarmarei/Lablo --json jobs --jq …`; `gh pr checks` shows `pending 0` for a running job).
- **git:**
  - `git rev-parse --short` takes one ref per call;
  - keep absolute worktree paths and `git -C`;
  - never `-c user.email=…`;
  - `git mv` stages at once. A later `git add` of the old path fails: leave it out.
- **CI:**
  - a `packages/*` change runs all four jobs (about 32 minutes, engines last); a change only in `apps/tv` or `tools` skips media;
  - there is no `jq` (use `gh --jq`);
  - known flakes, rerun after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-minute cap, Chromium 53/56 DevTools start-up.
- **TV code rules:**
  - no `.sort(` in main;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread, fragments;
  - these pull polyfills: `flags`, `at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt`;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` is hook-free; UI text comes only from the catalogs.
- **Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22, this PC Node 24;
  - a bare `sleep` is blocked: use `timeout N tail -f /dev/null`;
  - `TaskStop` on `verify:engines` leaves its container behind;
  - the TV build can crash once (0xC0000005): rerun it.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34; its migration and deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Decided by Omar on 2026-11-20:** 35b option 1 (done). Before step 38 grows Settings, ask him: load Settings on first open, or a higher budget.
- **35c's shape choices are the relay's to make** (with their why in RELAY). Only a choice with real trade-offs for users goes to Omar.
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
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c).
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' "Usage and crash reports" and "Send a report to support" rows;
  - a telemetry send and a report from a real TV, once step 34 has an API.

## Checks for Omar
1. **Optional:** after `pnpm build:tv`, open `dist/tv/tizen/index.html?screen=hello` in Chrome. It shows onboarding (no developer screen); `dist/tv-dev/tizen/index.html?screen=hello` still shows the hello screen. Nothing changed for a user.
2. **Optional read:** RELAY.md step 35's shape. These are the choices 35c and 35d build on:
   - the lists after "All channels";
   - a list numbered by its order;
   - hidden groups out of "All channels" too;
   - adding from the player's info bar;
   - managing in Settings.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
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
  - **56 (new, leg 121):** CLAUDE.md's command table, rows `pnpm build:tv`, `pnpm e2e` and `pnpm verify:engines`.
    - `build:tv` also writes the store build's test copy `dist/tv-dev` (the developer screens; never packaged, no main budget).
    - `pnpm e2e` opens both `dist/tv` and `dist/tv-dev`.
    - `verify:engines` runs hello and the gallery on `dist/tv-dev` (`--dist-dev`).
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
