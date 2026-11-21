# Lablo IPTV: relay leg 130 opening prompt

You are leg 130 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–129 did steps 1–33, 35, 35e and 36a (PRs #1–#156).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then;
  - step 36d's question ("multiple sources merged", three options in RELAY.md). Nothing before 36d depends on it.
- **Leg 129 (2026-11-21): built and merged 36a2, the query worker's view** (PR #156, merge commit `7d86801`):
  - **Decided before coding** (RELAY.md 36a2, "Decided in leg 129"): every address and count the worker hands out stays the provider's (search hits, `items`, `itemsByKey`, `numbered`, a category's `count` and `chunks`). The view shows in two places only:
    - the served live chunks (`chunk()`: hidden channels out, names and numbers applied);
    - a new optional `CategoryInfo.hidden` (the hidden channels' places in the category, ascending).
    - `shownChunks(info)` (`@lablo/data/client`, main-safe) gives each served chunk's length.
  - **`ChannelView`** (`packages/data/src/channel-view.ts`):
    - every live read shows the user's name, else the clean name (switch on), else the provider's, and the user's number as `chno`;
    - a renamed channel is found by both names, once (core's `searchSegments` takes `aliases`, scanned before a segment's own names);
    - `numbered({number, sources})` gives number entry the channel the user numbered `n`: its stored address, the item as shown, and `hidden`.
  - **When it changes:** read from the profile at each reload (`readChannelChanges`), taken from each `channel` or `cleanNames` edit at once, ordered by the edit number. `items` now loads the worker first.
  - **Phase gate extended:** after the refreshes in `test/ingest-mock.test.ts` (M3U renamed and reordered; Xtream renumbered), the worker shows the changes on the re-keyed channels.
  - **Mutation** (`artifacts/mutate36a2.py`): 68 of 68, the list written first (writing it closed five gaps).
  - **Wrote 36b's leads** (RELAY.md 36a2, "Leads for 36b").
- **Next: step 36b, the live screen** (main.js). Nothing in the app reads the view yet.

## Read first
1. **`RELAY.md`:**
   - step 36's "Shape", the live screen's part ("Numbers never move", "Number entry", "After an edit", "A hidden channel");
   - 36b's "Done when" (in 36's "Split");
   - **36a2's "Decided in leg 129" and "Leads for 36b"**;
   - the last progress row (129).
2. **`docs/architecture.md` §1.4 item 10:** "Built in step 36a2", and 35c/35d's blocks above it (`first`, hidden groups, `playOver`).
3. **The code 36b changes:**
   - `apps/tv/src/live/live-state.ts`:
     - `railEntries` (~344), `hiddenParts` (~390), `rowAt` (~503);
     - `findRow` (~731), `findNumber` (~772), `playFound` (~809), `playOver` (~870);
     - `reread` (~1006);
   - `apps/tv/src/live/channel-index.ts` (`ListPart`, `place`, `rowOfPlace`, `locate`, `firstRow`, `chunksFor`);
   - `apps/tv/src/data/engine.ts` (`categories`, `chunk`, `itemsByKey` around line 700–835; add `numbered`).
4. **The worker side it reads:**
   - `packages/data/src/channel-view.ts`;
   - `packages/data/src/channel-edits.ts` (`shownChunks`);
   - `packages/data/src/query-service.ts` (`numbered`, `NumberedChannel`).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `4849232`, then `f412d68`;
   - `origin/main` is `7d86801` (PR #156's merge);
   - there is no `*.mutbak`;
   - `docker ps` shows only `lablo-web-postgres-1`;
   - check the free memory (leg 129 started with 29 GB of free commit, 7.7 GB physical).
2. **Confirm 36b isn't done** (git log; grep `shownChunks`, `numbered`, `rowOfStored` in `apps/tv/src`: in leg 129 nothing there used them).
3. **Build 36b** from the leads:
   - `railEntries`: places count every channel (`at += info.count`), rows count the shown ones (`shownChunks`); the entry's count is `count − hidden.length`;
   - `ChannelIndex` steps over hidden places (`place`, `rowOfPlace`), plus a new `rowOfStored` for provider addresses;
   - `playFound` uses `rowOfStored`; a hidden channel of a shown group plays over the list;
   - `findNumber` asks `numbered` first;
   - `reread(true)` after an edit.
   - **Main-safe code only** (rules below). About 2–3 KB of main.js.
4. **Gates, one heavy check at a time:**
   - unit tests;
   - e2e in en and ar with edits written to the profile (36b's "Done when"; see "A restored start" below for writing the profile);
   - screenshots;
   - lint and the whole `pnpm typecheck`;
   - `build:tv` (main.js 426.1 KB now; settings.js 66.1 KB unchanged);
   - mutation, with the list written first;
   - `verify:engines --engine chrome53 --engine chrome68`;
   - the PR on green CI; merge it (merge commit, keep the branch); docs (architecture.md "Built in step 36b").
5. **Then 36c** (the editing screens, settings.js) if the leg still has room, else hand over.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`7d86801`, PR #156's merge) plus:
  - `4849232` (RELAY.md: 36a2 and 36a ticked, progress row 129);
  - this handover's commit (docs: HANDOVER.md).
- **`main`:** `7d86801`. The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 129's full `build:tv`;
  - in `artifacts/`:
    - `mutate36a2.py` (run, results in its docstring) and `mutate36a2-a.log`, `mutate36a2-b.log`;
    - `unit-36a2-leg129.log`, `build-tv-36a2-leg129.log`, `typecheck-36a2-leg129.log`, `engines-36a2.log`, `e2e-telemetry-leg129.log`;
    - older legs' files (`amd-probe/` can be deleted).

## Verified vs not
- **Verified and merged (PR #156, CI green: changes, web, media and engines at the first run; verify at the rerun):**
  - unit 7,877 (+16); lint of the changed files; `pnpm typecheck`;
  - `build:tv`:
    - main.js 426.1 KB (Tizen) and 413.4 KB (webOS), unchanged;
    - settings.js 66.1 KB, unchanged;
    - query worker 138.0 → 141.6 KB (8.4 KB left), no new core-js module;
  - the 200k search test as before (about 420 ms, old scan or new);
  - `verify:engines` on Chromium 53 and 68: all 26 runs as expected;
  - mutation 68 of 68.
- **Not yet:**
  - **nothing in the app reads the view:** 36b (live screen), 36c (screens);
  - e2e not run for 36a2 beyond CI's full run (no app code changed);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 129:**
- **The query worker serves a view now.** With `channelEdits` or `cleanNames` in the profile:
  - `chunk()` leaves hidden channels out; every live read shows the user's names and numbers;
  - a served chunk's length is `shownChunks(info)[c]`, not `info.chunks[c]`;
  - search hits, `items(refs)` addresses and `numbered`'s address are the provider's (raw) slots;
  - to read the provider's items in a test, read the store (`readCategories` + `readChunks`; `storedItems` in `test/ingest-mock.test.ts`).
- **36b's trap:** `ChannelIndex` must count rows by `shownChunks` but places by the provider's `chunks` and `hidden`. A hidden group's part (`hiddenParts`, `playOver`) keeps the provider's `chunks` for its numbers.
- **The query worker has 8.4 KB left** (141.6 of 150). `pnpm exec vitest run test/query-worker-bundle.test.ts` prints it in about 5 s.
- **A worker's module diff** (are new bytes polyfills or own code?):
  - a tsx `.mts` probe outside the repo calls `bundleIife({ input, platform: 'webos' })` and prints `code.length` and the sorted `modules`;
  - import the bundler by a `file:///D:/Claude%20Code%20PlayGround/...` URL;
  - for "before": `git diff -- packages > p.patch; git checkout -- packages; <probe>; git apply p.patch`.
- **New CI flake: `e2e/telemetry.spec.ts:202`** timed out at 30 s, but its trace showed every assertion done in 2.5 s. The rest was `withServer`'s `await server.close()` waiting on an open connection. It passed 27/27 locally and green on the rerun. Read a trace with `gh run download <run> -n playwright-report`, then pair `test.trace`'s before/after events.
- **Watching a rerun:**
  - `gh run rerun --failed` answered `HTTP 502` yet started the rerun;
  - the run's status keeps saying `completed failure` while the rerun runs, so poll the new job by id (`gh api repos/Omarmarei/Lablo/actions/jobs/<id>`).

**From leg 128 (still true):**
- **Vitest `toEqual` ignores `undefined` properties:** to test that an optional field is left out, check `Object.keys(x)` or `'f' in x`.
- **`reconcileFavourites(refs, …).outcomes`** is aligned with the input (`null` means dropped).
- **The mock catalog's 101 and 112** share a name and a tvg-id in two groups; an M3U reorder swaps their `dup` numbers. Don't use them in M3U reorder tests.
- **Write every patch script longer than a few lines with the Write tool,** with `newline=''` on read and write (heredoc python patches fail).
- **CI with core/data changes runs `media` too** (about 11 min); the whole run takes about 30 min; a Monitor poll loop works well.

**From legs 125–127 (still true):**
- **e2e imports and the root tsc:** an e2e spec must not import an app module whose imports reach `@lablo/ui` (TS6142 in the root `pnpm typecheck`). Copy the constant into the spec and pin it in a unit test.
- **A restored start in e2e** (how 36b's e2e writes channel edits to the profile):
  - `configIdle()` and `backupIdle()`, then `/?screen=gallery`;
  - edit the `profile` record;
  - open `/?restored=1&locale=…` (see `dropGuideLink` in `e2e/settings-loading.spec.ts`).
- **The e2e specs that open Settings:** backup-code, backup-logins-xa, backup-settings, config-blocklist, guide-catchup-m3u, guide-matches, guide-offset, guides, home, live, pairing, telemetry, groups, guide-mapping, settings-loading (`chromium` project, about 1.5 min at `--workers=3`). `pnpm e2e:web` needs `pnpm build:web` first.
- **TV-build e2e:** Back by CDP key code (`pressBack` in `tv-bundle.spec.ts`); `page.route` doesn't see `file://` loads; in `pnpm dev`, a lazy module's CSS loads with it.
- **e2e paths:** Home is `live/header/3`, Search `live/header/4`, Settings `live/header/5`; from `live/channels/0`, UP lands on `live/header/0`.
- **CI times:** engines 28 min, verify 12–17 min, media 11 min, web 3 min.

**From earlier legs (still true):**
- **Memory:** about 80 old leg tabs hold a `claude.exe` each. Run heavy checks one at a time (mutation, then `verify:engines` alone, then e2e, then unit).
- **Mutation:**
  - write the list first, check it with `--check`, run it in foreground chunks;
  - use `MUT_TIMEOUT` (60–120 for unit, 200–240 for e2e and builds), never an outer `timeout`;
  - restore any `.mutbak` with `mv`;
  - after build-tv.ts mutants, run `pnpm build:tv --skip-package`.
- **A navigator click within 300 ms of an OK key is its twin** and is ignored.
- **An en-XA check of a shape passes for any bracketed string:** compare with another element's text for the same key.
- **`itemsByKey`** takes at most 100 keys.
- **The developer screens are only in `pnpm dev` and `dist/tv-dev`** (`STORE_SWAPS`).
- **Main-safe code** (settings.js goes through the same gate):
  - no `trim`, `.sort(`, regex `.test` or `for…of` in new main files;
  - none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`;
  - check blank names by char code.
- **Scrub in a worker, never in main.js.** Workers import schema-free subpaths.
- **Any new background worker that writes IndexedDB** counts in `backupIdle()`.
- **Arabic on/off words agree with their noun.** Preact: write `translate={false}`.
- **Overlap:** never push to a PR while its CI runs (it cancels the run).
- **git:**
  - `git rev-parse --short` takes one ref per call;
  - absolute worktree paths and `git -C`;
  - never `-c user.email=…`;
  - `git mv` stages at once.
- **CI:** no `jq` (use `gh --jq`). Known flakes, rerun after the whole run:
  - `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, **`telemetry.spec.ts:202`**;
  - `rpc.test.ts:179`;
  - media's 30-minute cap;
  - Chromium 53/56 DevTools start-up.
- **Physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free; UI text comes only from the catalogs.**
- **Smart App Control:** before every pnpm or npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22, this PC Node 24;
  - a bare `sleep` is blocked (use `python -c "import time; time.sleep(N)"`);
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
- **Step 36d `[needs Omar]`: "multiple sources merged".** The leg that reaches it ends as needs-you with RELAY.md's three options:
  1. label same-named groups with their source (recommended);
  2. merge same-named groups into one rail entry;
  3. show one row for the same channel in two sources, with a fallback (better after launch).
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
  - the manual EPG mappings (`epgOverrides`, by ContentKey) don't follow a refresh's re-match, so an Xtream renumbering loses them. They could ride step 36's re-match (a ref per mapping);
  - **new:** `e2e/config-server.ts`'s `close()` waits for every open connection (the `telemetry.spec.ts:202` stall): call `server.closeAllConnections()` first.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' report rows;
  - a telemetry send and a real TV's report, once step 34 has an API;
  - the favourites star, and "Channel groups"' move mode with the TV's remote;
  - Settings' first open on the TV (settings.js);
  - later, step 36's "Edit channel" panel.

## Checks for Omar
1. **Optional:** answer step 36d's question early in any tab (RELAY.md step 36, "36d": 1, 2 or 3).
2. **Nothing to look at in the app from leg 129:** 36a2 is the query worker only; the live screen reads it from 36b.

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
