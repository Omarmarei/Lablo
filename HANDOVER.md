# Zoma IPTV: relay leg 14 opening prompt

You are leg 14 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it. Legs 1–5 did steps 1–4 (PRs #1–#5); leg 6 did no project work; legs 7–12 did steps 5–9 (PRs #6–#11).
- **Leg 13 did step 9b: EPG storage, refresh and the app.**
  - PR **#12**, commit `252b0b0`, merged as merge commit **`f448c5c`** (the branch was kept).
  - CI `verify` (4 m 26 s), `engines` (3 m 8 s) and `media` (9 m 31 s) were green on `252b0b0`.
  - Leg 13 split the step again: **the short-EPG fallback is now step 9c.**

**Your step is step 9c: the short-EPG fallback** (RELAY.md, step 9c).
- **Data:** for live channels of an Xtream source that no guide matches, call `get_short_epg` (core `XtreamClient.shortEpg(streamId, limit)`, `decodeShortEpg`) through the data layer, and cache each channel's answer for 30 min.
  - It needs the account and a transport. So it runs either as a `shortEpg` handler on the query worker or in a short-lived worker.
  - Measure the query worker's budget before choosing: it is 80.7 of 150 KB.
- **App:** `DataEngine` asks after a channel has been focused for 600 ms (a debounce; use fake timers in tests) and merges the answer into its now/next. The hello screen's panel shows it for an unmatched channel of an Xtream `?source=`.
- **Done when:**
  - an unmatched mock channel gets now/next from `get_short_epg` after 600 ms of focus, and not before;
  - a second focus within 30 min makes no request;
  - `pnpm verify` is green.
- If 9c turns out small, take step 10 (focus engine) next in the same leg only if the session is still light.

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Start in your first turn.

**First, check `main`:** `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `f448c5c` (PR #12's merge, run 41513580143) was in progress when this was written, and all three jobs should be green. If one is red, fix it on the relay branch before anything else.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree is your isolation. Edit it by path, and use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths, and Read/Edit/Write. **Don't `cd`** in Bash either: in leg 13 a `cd` moved the session's working directory, and the harness reset it to the main checkout later. `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) allows the worktree and gh, git, pnpm, node, docker, curl and bash.

## Read first, in this order
1. **`CLAUDE.md`:** conventions, the Chromium 53 cheat sheet, package boundaries, Definition of Done, merge policy and commit format.
2. **`RELAY.md`:**
   - step 9b (ticked, with what was built);
   - step 9c;
   - the **"Main bundle budget"** note just before Phase 4;
   - the leg-13 progress-log row.
3. **`docs/architecture.md` §1.5:**
   - item 1 (the short-EPG rule);
   - "Built in step 9b";
   - §1.3 (database v2).
4. **Code to build on:**
   - `packages/core/src/xtream.ts`:
     - `XtreamClient.shortEpg` and `decodeShortEpg` (entries carry `startMs`/`endMs` from `start_timestamp`, so no zone is needed);
     - `xtreamFromM3uUrl` (core `xtream-url.ts`) turns a mock `get.php` URL into an Xtream account, which is useful for the debug panel;
     - `parseContentKey` (Xtream keys are `x:<src>:live:<streamId>`);
     - `parseXtreamStreamUrl`.
   - `packages/data/src`:
     - `query-service.ts` (`nowNext`, `epgStatus`; the `EpgNowNext` shape, `epgSrc: null` for an unmatched channel);
     - `bytes.ts` (`fetchTransport`);
     - `ingest.ts` (the `TextTransport` adapter over a `ByteTransport` in the Xtream branch);
     - `client.ts`;
     - `epg-sources.ts`.
   - `apps/tv/src/data/engine.ts`: `refreshEpg`, `nowNext`, the refresh slot (`claim`/`release`), `busyTo`, and `withWorker`.
   - `apps/tv/src/DataPanel.tsx` (`runEpg`, the `nownext-status` row) and `apps/tv/src/data/params.ts` (`?source=` must stay last).
   - The mock: `apps/mock-provider/src/xtream.ts` `get_short_epg` (and `upcoming` in `epg.ts`). It answers for any live stream id, so `18+ Test Pattern`, the one live channel without an EPG id (unmatched by every guide), is the natural test channel. Confirm that first.
5. **`docs/PLAN.md`** wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone (its local `main` is behind).
- **Branch:** HEAD is the commit that adds this `HANDOVER.md` and records PR #12's merge in RELAY.md, on top of `252b0b0` (step 9b). It is pushed, and the worktree is clean. `main` holds the merge commit `f448c5c`; the branch doesn't, which is normal for this run.
- **Gitignored but present:**
  - `node_modules`;
  - `.cache/media`, `.cache/fixtures`, `.cache/engines`;
  - Playwright `chromium-1248`; the Docker image `zoma-old-engines:ba502212364a`;
  - `artifacts/`:
    - `mutate9b.py` (step 9b's 34 mutants; `python -I artifacts/mutate9b.py [snippet]`), plus `mutate9.py`, `mutate8.py` and `mutate8b.py`;
    - `make-size-probe.py`, `epg-mem-probe.ts`;
    - `verify.log`, `engines.log`, `mutate9b.log`;
    - `engines/report.json`, which now holds `guide` and `nowNext` per run.
- **Local gates on `252b0b0`:**
  - `pnpm verify` green: lint, typecheck, 933 tests in 68 files, both TV builds, e2e 6/6;
  - `pnpm verify:engines --self-test`: all 24 runs as expected on Chromium 53/56/68, 16 seeded failures caught. The app prints `guide 300/2400, now/next` in every engine.

## What step 9b added (use it, don't rebuild it)
- **Database v2** (migration 2; `schema.test.ts` pins it and upgrades a seeded v1):
  - `epg_meta` (keyPath `epgSrc`): `gen`, `building`, `nextGen`, `fetch`, `basis`, `until` (UTC minutes), `summary`, `rank` and `failedAt`;
  - `epg_buckets`: key `[epgSrc, gen, channel, day]`; the value is core's bucket without channel/day/merge, with typed columns;
  - `epg_channels`: key `[epgSrc, gen]`; `{ matches: StoredEpgMatch[] (key, channel, method, ambiguous, shift), channels, unmatched }`.
- **`epg-store.ts`:**
  - begin/commit/abandon/delete/prune of generations;
  - `putEpgBuckets`: merges `merge: true` fragments into the stored record, and merges fragments within one batch in memory first;
  - `putEpgChannels`, `pruneEpgDays` and `epgFirstDay`;
  - `markEpgChecked` and `markEpgFailed`;
  - `readEpgBuckets` and `readEpgChannels`.
- **`epg-sources.ts`** (also exported from `@zoma/data/client`):
  - `epgGuides(catalogs, sourceMetas, userGuides)`: user guides first, then `<src>:xmltv` (Xtream `xmltv.php`, zone `{ panel: src }`) and `<src>:tvg<n>` (from `SourceMeta.epgUrls`, UTC). User guides get the id `u~<id>`; a URL listed twice is read once.
  - `epgRefreshDue`: `new`, `stale` at 12 h, or `running-out` under 24 h ahead. Never within 2 h of the last check or of a failure.
- **`epg-ingest.ts`:**
  - `readEpgWanted`: every source's active live items, plus a basis string;
  - `runEpgIngest` (one guide);
  - `runEpgRefresh(job, options)`: deletes unlisted guides, prunes the listed ones, reads `only` or all, and gives each guide its own outcome (`{ epgSrc, result | error: { code, message } }`).
- **Also new:**
  - `ingest-errors.ts`: `IngestError`, `ingestError` and `headerNumber`, still re-exported from `ingest.ts`;
  - `epg-service.ts` and `epg.worker.ts`: the `run` and `setBusy` handlers, events `progress` and `swapped`; `createEpgClient` in `client.ts`;
  - `SourceMeta.epgUrls`, set by the catalog ingest.
- **The query worker:**
  - `nowNext({ keys, at? })`: reads days d-1..d+1 with the tvg-shift; the guides are combined by `rank` then id, through `combineEpgMatches`;
  - `epgStatus()`: guides and sources read fresh from IndexedDB, plus `matched`.
- **The app** (`DataEngine`):
  - `refreshEpg(catalogs, { tier, user?, languages?, overrides?, due?, force?, onProgress?, cancel? })`;
  - `nowNext(keys, at?)` and `epgStatus()`;
  - `startEpgWorker` in the options; `now?` for tests;
  - one refresh slot for catalog and EPG ("A guide refresh is already running");
  - `SearchSummary` now has `keys` and `live`.
- **The panel:**
  - `epg-status` with `data-matched` and `data-wanted`;
  - `nownext-status`: the first search hit, or the first live channel, that has programmes.
- **Old engines:**
  - The fixture playlists name `guide.xml` (tizen) and `guide.xml.gz` (webos). The guide is generated at harness start: every 8th live channel, hourly, from a day back to 3 days ahead.
  - `scenario.ts` waits for the `epg` and `nowNext` rows (`none` counts as final), and checks 300 of 2400 matched plus a now/next.
- **Core fix:** with a tvg-shift, `epgNowNext` compared an unshifted start with an already-shifted candidate, so the bucket order decided "next". It is fixed, with a test over shifts and bucket orders.

## Heads-up for step 9c
- **The main budget is tight:** main is 449.4 KB of 500 (90%), because it inlines all four workers. 9c adds main-thread code (the debounce in `DataEngine`). Measure the main bundle after the change.
  - If 9c would push it over, stop and ask Omar with RELAY.md's three budget options (recommended: count inlined workers only against their own budgets). Don't raise a budget on your own.
- **Short EPG on the query worker** means `fetchTransport` and `XtreamClient` in that worker. Core's index is already in every worker, so mostly `bytes.ts` is added. Measure with `python artifacts/make-size-probe.py` (see Gotchas).
- **Credentials:** the account must reach the worker (an RPC argument, or set once). Never put it in an error message, a log line or a cache key: key the cache by `src` and stream id.
- **Time:** `XtreamEpgEntry.startMs`/`endMs` are epoch ms from `start_timestamp`; a missing timestamp gives `null`, so skip that entry. Convert to `EpgProgramme` (UTC minutes, the same shape as now/next), so the UI shows one type.
- **Only unmatched channels:** `nowNext` already returns `epgSrc: null` for a live channel no guide matches. Ask for the short EPG only then, and only for Xtream keys (`x:` keys). For an M3U source of an Xtream panel (`get.php`), `xtreamFromM3uUrl` plus `parseXtreamStreamUrl` on the item's URL give the account and the stream id.
- **The debounce:** `DataEngine.focus(key)` (or similar) starts a 600 ms timer, and a new focus cancels it. Test it with `vi.useFakeTimers()`. Mind the MessageChannel-based worker doubles in `test/tv-data-engine.test.ts`: fake timers can stall `MessageChannel` delivery, so advance timers, then await real promises, or fake only `setTimeout`.
- **The cache:** 30 min per channel in whichever context fetches (Map + timestamp, and an injected `now` for tests). A failed request isn't cached for 30 min (retry on the next focus), and two focuses within 600 ms make one request.

## Gotchas and lessons (legs 1–13)
**New in leg 13**
- **IndexedDB:** a read-modify-write of the same key twice in one transaction loses the first update. Requests answer in issue order: both `get`s come back before the first callback's `put` runs. Merge in memory first, as `putEpgBuckets` does.
- **A crash test must crash after something is written:** with 10 buckets per batch, an early crash point writes nothing. Assert that leftovers exist before the clean-up.
- **No clock-dependent e2e:** the mock's schedule is pinned to 2026-11-02 12:00 UTC, the browser's clock isn't. e2e asserts the match rate (11 of 12), never now/next text. The engines guide is generated at harness start.
- **Mutation scripts:** a mutant that adds a second listener leaves the first one working, so mutate the original handler's body instead.
- **Watching CI:**
  - A Monitor script built on `comm <(…) <(…)` (process substitution) delivered no events in Git Bash, though `gh pr checks 12 --json name,bucket` works.
  - The background `until … gh pr checks` waiter was reaped for low memory.
  - What worked: a plain foreground `gh pr checks <n> -R Omarmarei/zoma-iptv` now and then. For a Monitor, test the script in the foreground first and avoid process substitution.
- **Worker sizes (tizen):** EPG 116.0 KB, ingest 125.5 KB, query 80.7 KB, hello 37.5 KB; main 449.4 KB of 500.
- **Bash heredocs:** they broke again on a Python patch with quotes. Write patch scripts with the Write tool into `$CLAUDE_JOB_DIR/tmp` and run `python -I` on them. Assert `s.count(old) == 1` in every patch.

**Shell and tools**
- Use absolute paths, and never `cd`. Never put a backslash in a Bash heredoc. The Write tool keeps `\n` literal but turns `\uFEFF`/`\u2028` into raw characters.
- **Bundle sizes:** `python artifacts/make-size-probe.py` writes `tools/build/src/zz-sizes-probe.ts` for `packages/data/src/<name>.worker.ts`.
  - Run `npx tsx tools/build/src/zz-sizes-probe.ts <ingest|query|epg>` from the worktree root. It prints a module table and "minified total".
  - Delete the probe afterwards (lint would see it).
- **Mutation runs:** each mutant has a 180 s timeout. Restore from `.bak` if a run is killed. Never run mutations while `pnpm verify` or `verify:engines` builds from the same source.
- **The old-engine Docker image:**
  - never change the `RUN apt-get …` line (a rebuild takes an hour);
  - add layers after it;
  - list new COPY files in `IMAGE_FILES`.
  - `serve-fixture.sh` serves any plain file in the fixtures folder, so new fixtures need no image change.
- **TaskStop on a background `verify:engines`** leaves its `docker build` running: find it with `Get-CimInstance Win32_Process -Filter "Name='docker.exe'"`.
- **Smart App Control is ON** (Omar's choice). Pin an older version or use pure JS; never weaken lint.
- **pnpm 11:** after a dependency edit, run `pnpm install --config.optimistic-repeat-install=false`. New dependencies must be at least 2 weeks old.

**Repo layout and tests**
- Package tsconfigs include only `src`, so package tests go there. Root `test/` holds cross-package tests (data with tools, the mock, `apps/tv`).
- `tools/*` may import only core, protocol and crypto.
- **New worker entries** need:
  - a package `exports` entry;
  - an `entry-point` rule in `eslint.config.js`;
  - a case in `test/lint-boundaries.test.ts`;
  - a `?worker` import in `apps/tv/src/data/workers.ts`.
- **fake-indexeddb:** use `freshFactory()` per test. A worker crash is `db.close()` in `fakeTransport`'s `beforeChunk`. Close `MessageChannel` ports in `afterEach`.
- **Mock tests:**
  - never build URLs from `base` at module level;
  - reset `app.mockState.catalog` in `beforeEach`;
  - the clock is `NOW` = 2026-11-02 12:00 UTC;
  - a whole-session fault: wrap the transport and append `&mock_fault=…` to every URL (`test/epg-ingest-mock.test.ts`).
- **Polyfills:**
  - Babel injects them per file before tree-shaking, so use narrow entries (`@zoma/data/client`) and keep shared helpers in small modules (`ingest-errors.ts` kept the catalog ingest out of the EPG worker);
  - TV code keeps `lib: ES2017`.

**core and data**
- `normalizeName`, `hash53` and the key layout are frozen (ADR-009). `core` targets ES2017. `Array.prototype.sort` isn't stable on Chromium 53.
- Never `await` inside `transact`. Database v1 and v2 and profile v1 become stored data once a build ships; change them only through append-only migrations.
- Keep long-lived parser strings as owned copies (`ownString`): V8 substrings pin their parent chunk.

**CI, versions, commits**
- CI takes about 4–5 min for `verify`, 3 for `engines` and 9–11 for `media`. Wait about 20 s after `gh pr create` before reading checks.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fast-check 4.10, fake-indexeddb 6.2.6, fflate 0.8.3, unrs-resolver 1.12.2.
- **Commits:** a scoped `git add` and `git commit -F <file>`. End with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line and the harness's session line.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Three gaps are open:
  - the "deep imports" convention doesn't mention `@zoma/data`'s four extra entries (client, query, ingest and epg workers);
  - the Commands table lacks `pnpm epg:report`;
  - the `build:tv` row doesn't say that the main budget includes the inlined workers.

## The 3 riskiest changes in PR #12
1. **Database v2** (`epg_meta`, `epg_buckets`, `epg_channels`) is stored data once a build ships. It is append-only, and an upgrade from a seeded v1 is tested.
2. **A third data worker is inlined into main** (449.4 KB of 500, 90%). The EPG worker passes on Chromium 53/56/68 in the harness, but there is little room left for the UI steps.
3. **Shared code changed:**
   - core `epgNowNext` (the shift fix);
   - `SourceMeta.epgUrls` stores guide URLs that may carry credentials, as the chunks already store stream URLs;
   - the ingest error helpers moved to `ingest-errors.ts` (re-exported).

## Verified vs not
- **Verified:**
  - local `pnpm verify` (933 tests, e2e 6/6: the guide row shows 11 of 12 in dev and in both built bundles);
  - `verify:engines --self-test` (24/24 as expected);
  - 34/34 mutants caught;
  - the mock's schedule stored exactly (M3U `url-tvg`; a gzipped user guide in the low tier; an Xtream guide without offsets in Kathmandu time);
  - a crash mid-ingest keeps the old generation;
  - now/next from the store for every live mock channel;
  - CI green on `252b0b0`, merged as `f448c5c`.
- **Not done:**
  - CI on `main` at `f448c5c` (run 41513580143) was in progress at handover;
  - the short EPG (step 9c);
  - no timer that runs `refreshEpg({ due: true })` while the app runs (step 22 owns the scheduling);
  - zip guides (step 22) and per-guide offsets and overrides from the profile (step 24);
  - no TV involved.
- **Migrations and deploys:** N/A (no backend until step 29; the TV "deploy" is a store submission).

## Try it (Omar, desktop, step 9b)
1. Run the mock: `pnpm mock --host 127.0.0.1`.
2. In another terminal, run `pnpm dev`.
3. Open `http://localhost:5173/?q=sports&source=http://127.0.0.1:8080/get.php?username=zoma&password=zoma-test&type=m3u_plus`.
   - **Refresh** turns `ok: committed gen 1, …`, then **Guide** turns `ok: 11 of 12 live channels have a guide (91.7%), 1 guide`.
   - **On air** shows a sports channel's programme, but only while your clock is inside the mock's window (7 days before to 3 days after 2026-11-02, by the mock's schedule). Otherwise it says `none: …`.
4. Reload without `source`: the guide row still shows the stored 11 of 12.
5. Reload with the source: the refresh is `unchanged`, and no guide is re-read (not due).

## Open decisions and gates
- **Main bundle budget** (RELAY.md note, decide before step 11; it may be needed sooner if 9c overflows). The options are inlined workers counted only against their own budgets (recommended), separate worker files (needs S1), or raising the main budget.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).
- **Relay cap:** 40 legs; leg 13 was the 13th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Three CLAUDE.md gaps** wait for his word: `@zoma/data`'s four entries, `pnpm epg:report`, and the main budget including the inlined workers.
- No secrets have been shared, so nothing needs rotating.
