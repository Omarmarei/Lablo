# Lablo IPTV: relay leg 131 opening prompt

You are leg 131 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–130 did steps 1–33, 35, 35e, 36a and 36b (PRs #1–#157).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then;
  - step 36d's question ("multiple sources merged", three options in RELAY.md). Nothing before 36d depends on it.
- **Leg 130 (2026-11-21): built and merged 36b, the live screen** (PR #157, merge commit `dc5194f`, CI green at the first run):
  - **Rows versus places** (`apps/tv/src/live/channel-index.ts`): a `ListPart` now carries the category's hidden places (`hidden`, from the worker's `CategoryInfo.hidden`). `ChannelIndex` counts rows by the served chunks (`shownChunks`) and places by the provider's chunks, so hiding a channel moves no other number. `rowOfStored({src, catIdx, chunk, slot})` turns a provider's address into a row (-1 when hidden or not held); `storedOffset` gives a stored channel's place in its category.
  - **The rail** (`railEntries`): counts leave hidden channels out; a group whose every channel is hidden leaves the rail (and Settings' "Channel groups", which reads the same entries). `categoryParts` (every category with channels, by `categoryKey` = `src|catIdx`) replaced 35d's `hiddenParts`.
  - **Number entry** (`findNumber`): outside a favourites list, `engine.numbered` first (the row from the stored address, checked by key from there); a hidden channel the user numbered comes back as the row itself (`ZapList.find` now resolves to `number | LiveRow`), and the player pins it at the bar's row (`pinOver`, shared with 35d's `over`). Then the provider's numbers as before. A failed lookup falls back; an answer after a reload or another entry is dropped.
  - **Hidden channels play over the list:** a hidden search hit, or one of a group out of the rail (`playFound`), and a recent channel whose key is hidden (`playKept`; the hidden keys come from `channelEditsOf(doc)` read with the lists and groups), unless the list it was kept with holds it.
  - **`live.channelsChanged()`** (`reread(true)`): the re-read after an edit. Nothing calls it yet: 36c's screens will.
  - **New e2e `e2e/channel-edits.spec.ts`** (en, ar): the mock's M3U (numbers by place) with one name tagged "UK: ", changes written straight into the profile, then a start.
  - **Mutation** (`artifacts/mutate36b.py`): 55/55 (54 written first; two gaps and a dead guard found while writing; one survivor closed).
  - **Wrote 36c's leads** (RELAY.md 36c, "Leads for the leg that starts it").
- **Next: step 36c, the editing screens** (settings.js, plus the info bar's button in main.js).

## Read first
1. **`RELAY.md`:**
   - step 36's "Shape", "Where the user edits" (the info bar's sixth button and its panel; Settings › "Channels");
   - 36c's "Done when" (in 36's "Split");
   - **36c's "Leads for the leg that starts it"** (written in leg 130);
   - 36b's "Refined while building" and the last progress row (130).
2. **`docs/architecture.md` §1.4 item 10:** "Built in step 36a1", "36a2" and **"36b"**; 35d's block (Settings › "Channel groups": the closest screen to copy), and the player's §"Built in step 35d: `over`".
3. **The code 36c builds on:**
   - `packages/data/src/channel-changes.ts` (the `channel` edit's ops) and `profile.ts` (`kind: 'channel'`, `kind: 'cleanNames'`);
   - `apps/tv/src/player/player-state.ts` (`CHANNEL_ACTIONS` ~412, `openFavourites`, `pinOver`), `apps/tv/src/player/PlayerScreen.tsx` (the buttons), `apps/tv/src/player/favourite-menu.ts` (`favouriteItem`, the panel pattern);
   - `apps/tv/src/live/LiveApp.tsx` ~134–145 (what paints over the player versus instead of the live screen);
   - `apps/tv/src/main.tsx` ~560–640 (`settingsOptions`, `createLazyFile`, `settings.use`, the player's `favourites` option);
   - `apps/tv/src/settings/settings-state.ts` (`SETTINGS_ITEMS`, `SETTINGS_SCREENS`), `groups-state.ts` and `GroupsPage.tsx` (rows, menus, the rename form, list channels read 100 keys a call).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `5f801a3`, then `b210acb`;
   - `origin/main` is `dc5194f` (PR #157's merge);
   - there is no `*.mutbak`;
   - `docker ps` shows only `lablo-web-postgres-1`;
   - check the free memory (leg 130 started with 28.5 GB of free commit, 7.2 GB physical).
2. **Confirm 36c isn't done** (git log; grep `channelsChanged(`, `'cleanNames'`, `op: 'rename'` in `apps/tv/src`: in leg 130 nothing in the app wrote channel changes).
3. **Build 36c** from its leads. Decide early, and write down with its why in RELAY.md 36c:
   - where the "Edit channel" panel paints (over the video stage like the player's own panels, or as a settings screen in its place);
   - whether the sixth info-bar button fits as a labelled button in en-XA, or becomes an icon button with its label for screen readers (the shape allows either).
   Its code goes under `apps/tv/src/settings/` (settings.js; `APP_LAZY` fails the build otherwise); main.js gets only the button and the open. After each edit: `live.channelsChanged()`.
4. **Gates, one heavy check at a time:**
   - unit tests;
   - e2e in en and ar through the screens (rename, renumber and hide from the info bar, the rail and number entry following; show again and reset from Settings; the switch cleaning a tagged name: reuse `channel-edits.spec.ts`'s tagged mock catalog and helpers);
   - the en-XA walk of every new screen, menu and form;
   - screenshots;
   - lint and the whole `pnpm typecheck`;
   - `build:tv` (main.js 428.8 KB on Tizen; settings.js 66.1 KB);
   - mutation, with the list written first;
   - `verify:engines --engine chrome53 --engine chrome68`;
   - the PR on green CI; merge it (merge commit, keep the branch); docs (architecture.md "Built in step 36c").
5. **Then 36d:** end the leg as needs-you with RELAY.md's three options (unless Omar has answered).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`dc5194f`, PR #157's merge) plus:
  - `5f801a3` (RELAY.md: 36b ticked, progress row 130, 36c's leads);
  - this handover's commit (docs: HANDOVER.md).
- **`main`:** `dc5194f`. The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 130's full `build:tv`;
  - in `artifacts/`: `mutate36b.py` (run, results in its docstring) and `mutate36b-a.log` to `-d.log`; `unit-36b-leg130.log`, `build-tv-36b-leg130.log`, `typecheck-36b-leg130.log`, `engines-36b.log`, `e2e-36b-leg130.log`; screenshots `artifacts/screenshots/channel-edits-*.png`; older legs' files (`amd-probe/` can be deleted).

## Verified vs not
- **Verified and merged (PR #157, CI green at the first run: changes, web, media, verify, engines):**
  - unit 7,894 (+17); lint of the changed files; `pnpm typecheck`;
  - `build:tv`: main.js 426.1 → 428.8 KB (Tizen), 413.4 → 416.1 KB (webOS), 216 core-js modules before and after (module diff of main.tsx); settings.js 66.1 KB and every worker unchanged (query worker 141.6 KB);
  - e2e `channel-edits.spec.ts` (en, ar) and the specs it touches (live, player, guide, search, groups, favourites, home, refresh, resume, tv-bundle: 44 passed);
  - mutation 55/55; `verify:engines` on Chromium 53 and 68: all 26 runs as expected.
- **Not yet:**
  - **nothing in the app writes channel changes:** 36c (the editing screens);
  - 36d (Omar's question);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 130:**
- **`ZapList.find` resolves to `number | LiveRow`:** a `LiveRow` means "no row holds it, play it over the list" (`pinOver` in the player). Any new `ZapList` fake must accept that type.
- **e2e on the live screen:**
  - UP reaches the header only from the list's first row (from row 2 it moves to row 1);
  - Back from the guide lands on `live/channels/<the guide's row>`, not on the header;
  - in Arabic the rail is RIGHT of the list;
  - while the search, guide or a settings screen paints, `[data-testid=live]` is not in the DOM: check its attributes after Back.
- **Channel changes in an e2e without the screens:** after `appIdle`, go to `/?screen=gallery`, read the keys with a cursor over `catalog_chunks` (`value.items`, the kind at `primaryKey[2]`), write `channelEdits`/`cleanNames` into the profile record, then a plain `/?locale=…` start (`e2e/channel-edits.spec.ts`: `storedChannels`, `editProfile`).
- **The mock:** `mock({ now, catalog })` serves any catalog (a tagged name for clean names). Its M3U has no `tvg-chno`, so an M3U source numbers by place (1–12); its Xtream `num`s differ.
- **Main's module diff:** `bundleIife({ input: <apps/tv/src/main.tsx>, platform: 'webos', label: 'probe', split: true, lazyLabel: (f) => f })` from a `.mts` probe outside the repo (import by `file:///D:/Claude%20Code%20PlayGround/...`), filter `modules` for `core-js`; "before" by `git diff > p.patch; git checkout -- <files>; probe; git apply p.patch`.
- **Mutation:**
  - a stale-answer guard survives when the held answer comes before the reload's new list: let the new list in first (`reload()`, `await flush()`), then resolve;
  - the engine's RPC wrappers have no unit tests: the e2e needs a path only that RPC serves, or its mutant survives.
- **Shell:** Git Bash `grep -c $'\r'` reports CRs in LF files; check line endings by bytes in a Write'd script. A long `cat >> file <<'EOF'` append failed again: Write a scratch file, then `cat scratch >> file`.

**From leg 129 (still true):**
- **The query worker serves a view:** `chunk()` leaves hidden channels out; every live read shows the user's names and numbers; search hits, `items(refs)` and `numbered`'s address are the provider's slots; a served chunk's length is `shownChunks(info)[c]`. To read the provider's items in a test, read the store (`storedItems` in `test/ingest-mock.test.ts`).
- **The query worker has 8.4 KB left** (141.6 of 150); `pnpm exec vitest run test/query-worker-bundle.test.ts` prints it in about 5 s.
- **CI flakes:** `telemetry.spec.ts:202` (teardown stall in `server.close()`); `gh run rerun --failed` may answer `HTTP 502` yet start; the run keeps saying `completed failure` while a rerun runs (poll the new job by id).

**From leg 128 (still true):**
- **Vitest `toEqual` ignores `undefined` properties:** to test that a field is left out, check `Object.keys(x)` or `'f' in x`.
- **The mock catalog's 101 and 112** share a name and a tvg-id in two groups (find them by name and group); an M3U reorder swaps their `dup` numbers.
- **Write every patch script longer than a few lines with the Write tool,** with `newline=''` on read and write.
- **CI with core/data changes runs `media` too** (about 11 min); the whole run about 30 min; a Monitor poll loop works well (re-arm after 30 min).

**From legs 125–127 (still true):**
- **e2e imports and the root tsc:** an e2e spec must not import an app module whose imports reach `@lablo/ui` (TS6142 in the root `pnpm typecheck`). Copy the constant into the spec and pin it in a unit test.
- **A restored start in e2e** (when "Welcome back" is the point): `configIdle()` and `backupIdle()`, `/?screen=gallery`, edit the `profile` record, open `/?restored=1&locale=…` (`dropGuideLink` in `e2e/settings-loading.spec.ts`).
- **The e2e specs that open Settings:** backup-code, backup-logins-xa, backup-settings, config-blocklist, guide-catchup-m3u, guide-matches, guide-offset, guides, home, live, pairing, telemetry, groups, guide-mapping, settings-loading (`chromium` project, about 1.5 min at `--workers=3`). `pnpm e2e:web` needs `pnpm build:web` first.
- **TV-build e2e:** Back by CDP key code (`pressBack` in `tv-bundle.spec.ts`); `page.route` doesn't see `file://` loads; in `pnpm dev`, a lazy module's CSS loads with it.
- **e2e paths:** Home is `live/header/3`, Search `live/header/4`, Settings `live/header/5`; from `live/channels/0`, UP lands on `live/header/0`.
- **CI times:** engines 28 min, verify 12–17 min, media 11 min, web 3 min.

**From earlier legs (still true):**
- **Memory:** about 80 old leg tabs hold a `claude.exe` each. Run heavy checks one at a time (mutation, then `verify:engines` alone, then e2e, then unit).
- **Mutation:** write the list first, check it with `--check`, run it in foreground chunks; `MUT_TIMEOUT` (60–120 for unit, 200–240 for e2e and builds), never an outer `timeout`; restore any `.mutbak` with `mv`; after build-tv.ts mutants, run `pnpm build:tv --skip-package`.
- **A navigator click within 300 ms of an OK key is its twin** and is ignored.
- **An en-XA check of a shape passes for any bracketed string:** compare with another element's text for the same key.
- **`itemsByKey`** takes at most 100 keys.
- **The developer screens are only in `pnpm dev` and `dist/tv-dev`** (`STORE_SWAPS`).
- **Main-safe code** (settings.js goes through the same gate): no `trim`, `.sort(`, regex `.test` or `for…of` in new main files; none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`; check blank names by char code.
- **Scrub in a worker, never in main.js.** Workers import schema-free subpaths.
- **Any new background worker that writes IndexedDB** counts in `backupIdle()`.
- **Arabic on/off words agree with their noun.** Preact: write `translate={false}`.
- **Overlap:** never push to a PR while its CI runs (it cancels the run).
- **git:** `git rev-parse --short` takes one ref per call; absolute worktree paths and `git -C`; never `-c user.email=…`; `git mv` stages at once.
- **CI:** no `jq` (use `gh --jq`). Known flakes, rerun after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `telemetry.spec.ts:202`; `rpc.test.ts:179`; media's 30-minute cap; Chromium 53/56 DevTools start-up.
- **Physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free; UI text comes only from the catalogs.**
- **Smart App Control:** before every pnpm or npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:** CI runs Node 22, this PC Node 24; a bare `sleep` is blocked (use `python -c "import time; time.sleep(N)"`); `TaskStop` on `verify:engines` leaves its container behind; the TV build can crash once (0xC0000005): rerun it; the Chromium 53 DevTools start-up timeout happens locally too: rerun once.

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
  - the manual EPG mappings (`epgOverrides`, by ContentKey) don't follow a refresh's re-match, so an Xtream renumbering loses them; they could ride step 36's re-match (a ref per mapping);
  - `e2e/config-server.ts`'s `close()` waits for every open connection (the `telemetry.spec.ts:202` stall): call `server.closeAllConnections()` first;
  - **new:** a channel hidden from the info bar while it plays stays pinned with its old row (old name) until zapped away; 36c may want the player to take the new name at once.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers: an Arabic onboarding; typing a backup code; a login and a guide link given again; Settings' report rows; a telemetry send and a real TV's report, once step 34 has an API; the favourites star, and "Channel groups"' move mode with the TV's remote; Settings' first open on the TV (settings.js); later, step 36's "Edit channel" panel.

## Checks for Omar
1. **Optional:** answer step 36d's question early in any tab (RELAY.md step 36, "36d": 1, 2 or 3).
2. **Optional, to see 36b:** `pnpm exec playwright test e2e/channel-edits.spec.ts --project chromium` in the worktree, or look at `artifacts/screenshots/channel-edits-list-en.png`, `-player-en.png`, `-guide-en.png`, `-hidden-play-en.png` (and the `-ar` ones). Nothing can be changed by hand in the app until 36c.

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
