# Lablo IPTV: relay leg 129 opening prompt

You are leg 129 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–128 did steps 1–33, 35, 35e and 36a1 (PRs #1–#155).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then;
  - step 36d's question ("multiple sources merged", three options in RELAY.md). Nothing before 36d depends on it.
- **Leg 128 (2026-11-21):**
  - **Wrote step 36's shape** (RELAY.md step 36, "Facts found in leg 128" and "Shape"), split it 36a–36d, then split 36a at the worker's view into 36a1 and 36a2.
    - Each changed channel is stored by ContentKey with a ref like a favourite's, so a refresh can re-key it.
    - The **query worker shows the changes** (36a2): names, numbers, hidden channels. The **live screen** keeps numbers stable and does number entry (36b). The **editing screens** are in settings.js: the info bar's sixth button "Edit channel", and Settings › "Channels" with the "Clean channel names" switch (36c).
    - **36d** (what "multiple sources merged" means) is Omar's question; the leg that reaches it asks.
  - **Built and merged 36a1** (PR #155, merge commit `3f97a7c`, green CI at the first run):
    - `channelEdits` and `cleanNames` in the profile, with checks on read (`channelEditsOf`, `cleanNamesOn`; main-safe, from `@lablo/data/client`);
    - the `channel` edit (`hide`, `show`, `rename`, `number`, `reset`; a number another channel has moves to the edited one) and the `cleanNames` edit;
    - a refresh's re-match, once per key (`channel-relink.ts`): an entry on a favourite's key follows the favourite and takes its whole ref. `reconcileFavourites` is generic now, with per-input `outcomes` and `alsoTaken`;
    - core's `cleanName` (`matchName` now starts from it).
  - **The phase gate holds:** in `test/ingest-mock.test.ts`, an M3U refresh where the provider renamed and reordered its channels keeps the favourites, the list and the changed channels.
  - **Mutation** (`artifacts/mutate36a1.py`): 110 mutants written first. Writing them took out three dead checks, fixed a followed entry that kept a stale group, and closed seven gaps. 109 of 109 caught: one equivalent was taken out, and one gap was closed after the run.
- **Next: step 36a2, the query worker's view.** RELAY.md 36a2 has the shape's part ("The worker shows the edits") and leads written in leg 128. **Read the raw-versus-view-slots trap there first.**

## Read first
1. **`RELAY.md`:**
   - step 36's "Facts found in leg 128" and "Shape" (the worker's part and the live screen's);
   - 36a1's "Refined while building";
   - **36a2's "Leads for the leg that starts it"**;
   - the last progress row (128).
2. **`docs/architecture.md` §1.4 item 10, "Built in step 36a1"**, and the 35a/35c blocks above it.
3. **The code 36a2 builds on:**
   - `packages/data/src/channel-edits.ts` (`ChannelEdit`, `channelEditsOf`, `cleanNamesOn`);
   - `packages/data/src/query-service.ts`:
     - `load()` around line 475: how the favourites' keys are read and ordered by `offsetSeq`; the same pattern fits the changes;
     - `editProfile`, `itemsByKey`, `search`, `categories`, `chunk`, `items`, `readCached`;
   - `packages/core/src/search.ts`: `searchSegments`, `SearchSegment.indexOfKey` and `chunkOf`, `favouriteMarks`;
   - `packages/core/src/normalize.ts`: `cleanName`;
   - `packages/data/src/profile.ts`: `readFavouriteKeys`, `favouriteKeysOf` (the pattern for reading the changes);
   - main's readers that 36b changes: `apps/tv/src/live/live-state.ts` (`playFound` around line 820, `rowAt`, `findNumber`) and `channel-index.ts`.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `256671a`, then `3f97a7c` (PR #155's merge);
   - `origin/main` is `3f97a7c`;
   - there is no `*.mutbak`;
   - `docker ps` shows only `lablo-web-postgres-1`;
   - check the free memory (leg 128 started with 30.7 GB of free commit).
2. **Confirm 36a2 isn't done** (git log; grep `cleanNamesOn`, `channelEditsOf` in `query-service.ts`: in leg 128 nothing there used them).
3. **Build 36a2**, deciding first, from the leads, how `categories` hands out the view:
   - a hidden channel's rows leave the served chunks, while main still needs raw counts for places (numbers) and raw slots for search hits;
   - for example, keep the raw `chunks` and add the view's beside them.
   - Write the choice and its why into RELAY.md 36a2 before coding.
4. **Gates, one heavy check at a time:**
   - unit tests;
   - `test/query-worker-bundle.test.ts` (it prints the worker's size);
   - lint and the whole `pnpm typecheck`;
   - `build:tv` (main.js should stay 426.1 KB; the query worker has 12.0 KB left);
   - mutation, with the list written first;
   - `verify:engines --engine chrome53 --engine chrome68`;
   - the PR on green CI; merge it (merge commit, keep the branch); docs (architecture.md "Built in step 36a2").
5. **Then 36b** (the live screen) if the leg still has room, else hand over.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`3f97a7c`, PR #155's merge) plus:
  - `256671a` (RELAY.md: 36a1 ticked, progress row 128, 36a2's leads);
  - this handover's commit (docs: HANDOVER.md).
- **`main`:** `3f97a7c`. The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 128's full `build:tv`;
  - in `artifacts/`:
    - `mutate36a1.py` (run, results in its docstring) and `mutate36a1-a..d.log`;
    - `unit-36a1-leg128.log`, `build-tv-36a1-leg128.log`, `lint-36a1-leg128.log`, `engines-36a1.log`;
    - older legs' files (`amd-probe/` can be deleted).

## Verified vs not
- **Verified and merged (PR #155, CI green: changes, web, media, verify, engines):**
  - unit 7,861 (+64); lint; `pnpm typecheck`;
  - `build:tv`:
    - main.js 426.1 KB (Tizen) and 413.4 KB (webOS), unchanged;
    - settings.js 66.1 KB, unchanged;
    - query worker 134.9 → 138.0 KB, ingest worker 133.0 → 135.7 KB;
  - `verify:engines` on Chromium 53 and 68: all 26 runs as expected;
  - mutation 109 of 109.
- **Not yet:**
  - **nothing in the app reads the changes yet:** 36a2 (worker), 36b (live screen), 36c (screens);
  - e2e not run this leg (no app code changed);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 128:**
- **Raw versus view slots** (36a2's trap, in RELAY.md 36a2's leads):
  - search hits and `items(refs)` use raw chunk addresses;
  - if the worker drops hidden channels from served chunks, `playFound`'s guess (`firstRow + slot`) and its number for a hidden group's channel (`part.first + firstRow + slot + 1`) would mix raw and view counts;
  - `items()` must read raw chunks: names and numbers applied, nothing dropped.
- **The worker's cache holds raw chunks:** copy an item before renaming or renumbering it, never change a cached one.
- **Vitest `toEqual` ignores `undefined` properties:** to test that an optional field is left out, check `Object.keys(x)` or `'f' in x`.
- **`reconcileFavourites(refs, …).outcomes`** is aligned with the input (`null` means dropped). Use it for any other list of refs; positions in `favourites` shift after a drop.
- **The query worker's size in about 5 s:** `pnpm exec vitest run test/query-worker-bundle.test.ts` prints `query.worker.js: N KB of 150.0 KB` (the same number as `build:tv`).
- **The mock catalog's 101 and 112** share a name and a tvg-id in two groups. An M3U reorder swaps their `dup` numbers, so their M3U keys swap silently (ADR-009's limit). Don't use them in M3U reorder tests. For Xtream, 112 is how a "follows its favourite" test is made observable.
- **A heredoc python patch failed again** ("unexpected EOF while looking for matching `''") even though it was quoted `<<'PYEOF'`. Write every patch script longer than a few lines with the Write tool, with `newline=''` on read and write.
- **CI with core/data changes runs `media` too** (about 11 min). The whole run took about 30 min; a Monitor poll loop on `gh run view <id> --json status,conclusion,jobs` worked well.

**From legs 125–127 (still true):**
- **e2e imports and the root tsc:** an e2e spec must not import an app module whose imports reach `@lablo/ui` (TS6142 in the root `pnpm typecheck`). Copy the constant into the spec and pin it in a unit test.
- **A restored start in e2e:**
  - `configIdle()` and `backupIdle()`, then `/?screen=gallery`;
  - edit the `profile` record;
  - open `/?restored=1&locale=…` (see `dropGuideLink` in `e2e/settings-loading.spec.ts`).
- **The e2e specs that open Settings:** backup-code, backup-logins-xa, backup-settings, config-blocklist, guide-catchup-m3u, guide-matches, guide-offset, guides, home, live, pairing, telemetry, groups, guide-mapping, settings-loading (`chromium` project, about 1.5 min at `--workers=3`). `pnpm e2e:web` needs `pnpm build:web` first.
- **TV-build e2e:**
  - Back by CDP key code (`pressBack` in `tv-bundle.spec.ts`);
  - `page.route` doesn't see `file://` loads (copy the dist and rename a file there);
  - in `pnpm dev`, a lazy module's CSS loads with it.
- **Rollup AMD:**
  - `amd.autoId` writes dependencies as `'./main'`;
  - `preserveEntrySignatures: false`;
  - terser minifies a `banner`.
- **e2e paths:**
  - Home is `live/header/3`, Search `live/header/4`, Settings `live/header/5`;
  - from `live/channels/0`, UP lands on `live/header/0`.
- **CI times:** engines 27 min, verify 17 min, media 11 min, web 3 min.

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
  - `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US;
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
  - **new:** the manual EPG mappings (`epgOverrides`, by ContentKey) don't follow a refresh's re-match, so an Xtream renumbering loses them. They could ride step 36's re-match (a ref per mapping).
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
2. **Nothing to look at in the app from leg 128:** 36a1 is data only.

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
