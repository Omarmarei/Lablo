# Zoma IPTV: relay leg 13 opening prompt

You are leg 13 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it. Legs 1–5 did steps 1–4 (PRs #1–#5); leg 6 did no project work; legs 7–11 did steps 5–8b (PRs #6–#10).
- **Leg 12 did step 9, the core part of the EPG:** matching cascade, guide reader, tiered window, DST repair, per-channel-day buckets, the match-rate report and enforced benchmark limits.
  - PR **#11**, commit `9adcab5`, merged as merge commit **`fd777e1`** (the branch was kept).
  - CI `verify`, `engines` and `media` were green on `9adcab5`.
  - Leg 12 split step 9 the way leg 10 split step 8. **Storage, refresh, the short-EPG fallback and the app wiring are now step 9b.**

**Your step is step 9b: EPG storage, refresh and the app** (RELAY.md, step 9b).
- **Storage:** database v2, an append-only migration, adding `epg_buckets` keyed `[epgSrc, gen, channel, day]` and `epg_channels` (the match table and the used guide channels). Pin v2 in `schema.test.ts` and upgrade from v1 with a seed.
- **Ingest:** fetch, gunzip and decode the guide the way the catalog ingest does, into core's `EpgGuideReader`.
  - Write the buckets about 10 per transaction. A bucket with `merge: true` is merged with the stored one (`mergeEpgBuckets`).
  - Then swap generations, and prune past days and old generations.
- **Sources:** Xtream `xmltv.php` and the M3U `url-tvg` header, added automatically; user XMLTV URLs in priority order.
- **Refresh:** every 12 h, or sooner when less than 24 h of future data remains. Low-tier TVs never run EPG and catalog ingest at once.
- **Short EPG:** `get_short_epg` for unmatched Xtream channels, after 600 ms of focus, cached 30 min.
- **App:** `DataEngine` gets an EPG refresh and now/next; the catalog panel shows the match rate and a channel's now/next.
- **Done when:**
  - an EPG refresh of the mock through the data layer (fake-indexeddb) stores exactly the mock's schedule;
  - a crash mid-EPG-ingest keeps the old generation;
  - now/next comes back from the store;
  - `pnpm verify` and `pnpm verify:engines --self-test` are green.

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Start in your first turn.

**First, check `main`:** `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `fd777e1` (PR #11's merge) should be green in all three jobs. If one is red, fix it on the relay branch before anything else.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree is your isolation. Edit it by path; use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths, and Read/Edit/Write. `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) allows the worktree and gh, git, pnpm, node, docker, curl and bash.

## Read first, in this order
1. **`CLAUDE.md`:** conventions, the Chromium 53 cheat sheet, package boundaries, Definition of Done, merge policy, commit format.
2. **`RELAY.md`:** step 9 (ticked, with what was built), step 9b, and the leg-12 progress-log row.
3. **`docs/architecture.md` §1.5:**
   - items 1–9 (sources, wanted set, cascade, filter, window, storage, refresh, XMLTV assumptions);
   - **"Built in step 9"** (what exists);
   - **item 10** (benchmark limits and how they were derived).
   - Then §1.3 (storage: `epg_buckets`, `epg_channels`; EPG ≤ 100 MB full tier, ≤ 30 MB low tier), and §1.4's "Built in step 8" and "Wired into the app in step 8b": the ingest and app patterns to mirror.
4. **`docs/adr/ADR-010-catchup-time-zones.md`**, including the step-9 amendment on the repeated DST hour.
5. **Code to build on:**
   - `packages/core/src/epg-match.ts` and `epg-guide.ts` (and their tests);
   - `packages/data/src`:
     - `schema.ts` and `schema.test.ts` (v1 only; add v2);
     - `ingest.ts` (`runIngest`: transport, `MaybeGunzip`, `decodeUtf8`, throttle, generation begin/commit/abandon, prune);
     - `catalog-store.ts`, `idb.ts` (`transact`), `ingest-service.ts`, `ingest.worker.ts`, `client.ts`, `test-support.ts` (`freshFactory`, `fakeTransport`);
   - `apps/tv/src/data/engine.ts` (`DataEngine`) and `DataPanel.tsx`;
   - `packages/core/src/xtream.ts`: `XtreamClient.shortEpg(streamId, limit)`, `decodeShortEpg`, and `zone()` for the panel zone.
6. **`docs/PLAN.md`** wins on any conflict.

## Heads-up for step 9b
- **The ingest worker is at 125.3 of its 150 KB budget.** The EPG reader inside it may not fit.
  - Measure first: `python artifacts/make-size-probe.py` (see Gotchas).
  - If it doesn't fit, add an `epg.worker.ts` entry, the way step 8b added `query.worker`/`ingest.worker`:
    - package `exports`;
    - an `entry-point` rule in `eslint.config.js`;
    - `test/lint-boundaries.test.ts`;
    - a `?worker` import in `apps/tv/src/data/workers.ts`.
  - PR #11 left every bundle unchanged (main 323.1 KB, query 75.8, ingest 125.3).
- **Database v2:**
  - append a migration; never edit v1;
  - add the v2 shape to `SHAPES` and a v2 seed to `SEEDS` in `schema.test.ts`;
  - consider an `epg_meta` store keyed by `epgSrc` (active/building generation, fetch stamp, last report), like `sources_meta` for catalogs.
- **Wanted set:** build `EpgWantedSet.fromItems` from the active generation's stored live items of every source; stored items are full `CatalogItem`s.
- **Fallback zone:** the panel zone (`XtreamClient.zone().offset`) for an Xtream guide; UTC for `url-tvg` and user URLs, until step 24 adds per-source offsets.
- **Writes:**
  - never `await` inside `transact`;
  - a `merge: true` bucket needs get + `mergeEpgBuckets` + put chained in callbacks of the same transaction;
  - a guide grouped by channel gives no fragments, but a time-sorted one does;
  - check that fake-indexeddb round-trips `Int32Array`/`Uint8Array` columns.
- **`nowMs`** is `Date.now()` at ingest. Prune days older than the window's past days.
- **One refresh at a time:** `DataEngine`'s guard already serializes refreshes. Keep EPG behind it (the low-tier rule).
- **Short EPG:** put the cache and fetch in the data layer, and the 600 ms focus debounce in `DataEngine` (fake timers in tests). Step 22 builds the UI on it.
- **If 9b won't fit one session, split it again** and record the split in RELAY.md:
  - **9b:** v2, ingest, swap, prune, refresh;
  - **9c:** short EPG and app wiring.
- **The mock:** `xmltv.php` and `/epg/guide.xml(.gz)` cover each channel's archive days back (up to 7) and 3 days ahead. `test/epg-mock.test.ts` shows how to read them, get the panel zone and build an oracle from `apps/mock-provider/src/epg.ts`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone (its local `main` is behind).
- **Branch:** HEAD is the commit that adds this `HANDOVER.md` and records PR #11's merge in RELAY.md and §1.5, on top of `9adcab5` (step 9). It is pushed, and the worktree is clean. `main` holds the merge commit `fd777e1`; the branch doesn't, which is normal for this run.
- **Gitignored but present:**
  - `node_modules`;
  - `.cache/media`, `.cache/fixtures` (200k `catalog.json`/`playlist.m3u`/`xtream`, `xmltv-{50,150,300}mb.xml` + `.gz`), `.cache/engines`;
  - Playwright `chromium-1248`; Docker image `zoma-old-engines:ba502212364a`;
  - `artifacts/`:
    - `mutate9.py` (step 9's 28 mutants; `python -I artifacts/mutate9.py [snippet]`), `mutate8.py`, `mutate8b.py`;
    - `make-size-probe.py`, `screenshot-8b.ts`;
    - `epg-mem-probe.ts` (EPG read time and heap per flush size; run with `node --expose-gc [--max-old-space-size=N] --import tsx artifacts/epg-mem-probe.ts all|tenth 20000,5000`);
    - `verify.log`.
- **Local gates on `9adcab5`:**
  - `pnpm verify` green: 905 tests in 65 files, e2e 6/6, both TV builds pass the ES2016 gate, bundles unchanged;
  - `test/epg-300mb.media.test.ts` green locally;
  - `verify:engines` not run locally (no build, polyfill, worker or boot change), but CI `engines` was green.

## What step 9 added (use it, don't rebuild it)
- **`@zoma/core` matching:**
  - `EpgWantedSet` (`fromItems`, overrides `{ key, epgSrc, channel | null }`) and `EpgMatcher`, one per guide: `addChannel`, `declareById`, `channelIndex`/`channelId`/`usedAt`, `matches()`, `unmatched()`, `usedChannels()`, `stats()`, `maxCatchupDays()`, `maxShiftHours()`;
  - `combineEpgMatches`, `epgWantedChannel`, `xmltvIdStem`, `EPG_MATCH_METHODS`, `epgMethodRank`.
- **`@zoma/core` reading:**
  - `EpgGuideReader({ epgSrc, wanted, tier, nowMs, languages, fallback, shiftMinutes, windows, flushAt = 20000, orphanCap = 20000 })`: `push(text)` and `end()` return the buckets to write; also `report()`, `stats`, `xmltvStats`, `window`, `matcher`;
  - `EpgBucket` (`channel`, `day` = UTC day of the start, `Int32Array` start/end in epoch minutes, `title`/`sub`/`desc`/`category`/`episode` string arrays, `Uint8Array` flags, `merge`);
  - `EpgBucketBuilder`, `buildEpgBucket`, `mergeEpgBuckets` (on equal starts the stored one wins), `epgProgrammes`, `epgNowNext(buckets, nowMs, shiftHours)` (read days d-1 and d);
  - `epgWindow`, `EPG_WINDOWS`, the flags `EPG_FLAG_STOP_GUESSED`/`TIME_REPAIRED`/`CUT`, `formatEpgReport`.
- **`@zoma/core` XMLTV:** `XmltvTokenizer` option `onItem` (items in document order; `push`/`end` then return `[]`), `xmltvTimeHasZone`, and a fast path in `parseXmltvTime` (`parseXmltvTimeGeneral` is the general path, exported from the module for tests).
- **Tools:**
  - `pnpm epg:report --playlist <m3u> --xmltv <guide> [--xmltv …] [--tier low] [--now ISO] [--json f]` (files or URLs, gzip sniffed);
  - `pnpm bench` cases `epg-ingest-low-10pct` (limit 8 s) and `epg-ingest-full` (limit 20 s). `pnpm bench` exits 1 over a limit.
  - `tools/bench/src/suites.ts`: `readEpgStream`, `epgWanted`, `EPG_LIMITS`, `EPG_BENCH_NOW`.
  - `tools/fixtures/src/xmltv.ts` exports `slotOf` and `channelProgrammes`.
- **Tests:**
  - `packages/core/src/epg-{match,guide}.test.ts`;
  - `test/epg-mock.test.ts`, `test/epg-fixture.test.ts`;
  - `test/epg-300mb.media.test.ts`: the CLI in a child Node with a 96 MB heap, every number exact against `catalog.json`.

## Gotchas and lessons (legs 1–12)
**New in leg 12**
- **V8 substrings keep their parent alive.**
  - Ids and attribute values from the tokenizer are slices of a 30–60 KB decoded chunk. Keeping one per channel (a Map key) pinned a chunk per channel, and the 300 MB guide ran out of a 160 MB heap.
  - Store long-lived strings from parsers as owned copies (`ownString` in `epg-match.ts`), or index state by number.
  - The data layer must not keep raw tokenizer strings either.
- **A bench "heap peak" mostly measures lazy GC:** 200–460 MB uncapped for a read that fits in 96 MB. Bound memory with a capped child process (`node --max-old-space-size=N`) instead. The 200k playlist parse alone needs more than 64 MB.
- **Local timings swing ±30%:** this PC is shared with browsers and other sessions. On the CI runner `epg-ingest-low-10pct` took 2.3 s, `epg-ingest-full` 5.9 s and `xmltv-gz-tokenize` 4.0 s, faster than locally.
- **When `wantChannel` depends on channels, use the tokenizer's `onItem`.** Otherwise a programme in the same chunk as its channel is asked about before the channel is seen.
- **`parseXmltvTime` and the repeated DST hour:** it gives the earlier instant west of UTC and the later one east of it. `EpgGuideReader` settles to the earlier one, then repairs from per-channel ordering. A lone boundary in the repeated hour stays an hour early (ADR-010).
- **Smaller ones:**
  - `new XtreamClient(account, transport, src)` takes 3 arguments.
  - Programme ids must match a channel id exactly. A case-different programme id is declared as its own channel by `declareById`.
- **Backslashes in Bash heredocs broke again:** a Python patch that wrote `'\n'` produced a SyntaxError. Write patch scripts with the Write tool into `$CLAUDE_JOB_DIR/tmp` and run them, or use Edit.

**Shell and tools**
- The Bash cwd resets after a `cd`; use absolute paths.
- **Never put a backslash in a Bash heredoc.** Use the Edit tool, or Write whole files (Write keeps `\n` literal, but turns `\uFEFF`/`\u2028` into raw characters).
- **CI waits:** the Monitor tool with a loop over `gh pr checks <n>` that prints each finished job and exits when none is pending (timeout 30 min). Wait about 20 s after `gh pr create`.
- **Bundle sizes:** `python artifacts/make-size-probe.py` writes `tools/build/src/zz-sizes-probe.ts` for `packages/data/src/<name>.worker.ts`.
  - For another entry, change its last line to `join(process.cwd(), process.argv[2])` and pass a path.
  - Run it with `npx tsx tools/build/src/zz-sizes-probe.ts <arg>` from the worktree root, then **delete it** (lint would see it).
- **Mutation runs** have a 180 s timeout each. Restore from `.bak` if one is killed.
- **Old-engine Docker image:**
  - never change the `RUN apt-get …` line (archive.debian.org runs at about 40 KB/s; a rebuild takes an hour);
  - add layers after it;
  - list new COPY files in `IMAGE_FILES`.
- **TaskStop on a background `verify:engines`** leaves its `docker build` running. Find it with `Get-CimInstance Win32_Process -Filter "Name='docker.exe'"` and stop it.
- **Smart App Control is ON** (Omar's choice). For a blocked native binary, pin an older version or use pure JS. Never turn SAC off or weaken lint.
- **pnpm 11:** after a dependency edit, run `pnpm install --config.optimistic-repeat-install=false`. New dependencies must be at least 2 weeks old.

**Repo layout and tests**
- Package tsconfigs include only `src`, so package tests go in `src/`. Root `test/` holds cross-package tests: data with tools, the mock, `apps/tv`, and tools with tools.
- `tools/*` may import only core, protocol and crypto. Constants shared with `tools/fixtures` are repeated, and checked equal by a root test (`test/epg-fixture.test.ts`).
- The boundary lint resolves `?worker` imports, so a new worker entry needs an `entry-point` rule.
- **fake-indexeddb:** `freshFactory()` per test. A worker crash is `db.close()` in `fakeTransport`'s `beforeChunk`. Close `MessageChannel` ports in `afterEach`.
- **`vm` realm workers:** run `var self = globalThis` first, and pass `fetch`, `TextDecoder`, `IDBKeyRange` and `indexedDB` in.
- **Mock tests:**
  - never build URLs from `base` at module level;
  - reset `app.mockState.catalog` in `beforeEach`;
  - the clock is pinned at 2026-11-02 12:00 UTC (`NOW` in `apps/mock-provider/test/helpers`).
- **Old engines:**
  - `file://` pages in one engine share one IndexedDB, so the harness passes `force=1`;
  - the first chrome53 run after Docker starts can time out: retry once.
- **Polyfills:**
  - Babel injects them per file before tree-shaking, and a package index import drags every module's polyfills in, so use narrow entries;
  - exclusion patterns must match the `esnext.*` names;
  - TV code keeps `lib: ES2017`.

**core and data**
- `normalizeName`, `hash53` and the key layout are **frozen** (ADR-009).
- `core` targets ES2017: no `\p{…}`, lookbehind, named groups or `s` flag. `Array.prototype.sort` isn't stable on Chromium 53: use an index tie-break or insertion sort (as `buildEpgBucket` does).
- **Never `await` inside `transact`;** chain requests from callbacks.
- **Database v1 and profile v1 become stored data once a build ships.** Change them only through append-only migrations, with `schema.test.ts`/`profile.test.ts` updated.

**CI, versions, commits**
- CI `media` takes about 6–11 min (it now includes the EPG bench cases and the 96 MB-heap run), `verify` about 4–6, `engines` about 2–3.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fast-check 4.10, fake-indexeddb 6.2.6, fflate 0.8.3, unrs-resolver 1.12.2 (override).
- **Commits:** scoped `git add`, and `git commit -F <file>` or a `-F - <<'EOF'` message. End it with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line and the harness's session line.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Two gaps are open there:
  - the "deep imports are a lint error" convention doesn't mention `@zoma/data`'s three extra entries;
  - the Commands table lacks `pnpm epg:report` (it is documented in runbook mock-provider.md "Benchmarks").

## The 3 riskiest changes in PR #11
1. **`pnpm bench` now exits 1 when a case goes over its limit,** so CI's `media` job fails if the EPG read regresses. On the runner the margin is about 3.4x (2.3 s against 8 s, 5.9 s against 20 s). The limits come from S6 with estimated slowdown factors (15x for a 2018 TV, 6x for a 2020 TV); S6 on real hardware must replace them.
2. **Shared core XMLTV code changed:** the tokenizer's `onItem` hook, and a fast path in `parseXmltvTime` used by every caller since step 6. A property test (3,000 runs) checks the fast path against the general one, and the step-6 tests still pass.
3. **ADR-010 was amended:** a lone boundary in the repeated DST hour of an offset-less guide reads an hour early. This is accepted behaviour, pinned by a test, and affects only guides without offsets in DST zones.

## Verified vs not
- **Verified:**
  - local `pnpm verify` (905 tests, e2e 6/6);
  - the 300 MB report exact in a 96 MB heap (local and CI);
  - the benchmarks within their limits (local and CI);
  - 28/28 mutants caught;
  - `pnpm epg:report` against a running mock over HTTP (two guides, gzipped and plain: 11 of 12 matched);
  - CI green on `9adcab5`, merged as `fd777e1`.
- **Not done:**
  - CI on `main` at `fd777e1` (run 41503306184), still running when this was written;
  - nothing is stored yet (step 9b);
  - no TV involved: S6's real slowdown factors are unmeasured.
- **Migrations and deploys:** N/A (no backend until step 29; the TV "deploy" is a store submission).

## Try it (Omar, desktop, step 9)
Step 9 has no screen yet; the report is the visible part.
1. Run the mock: `pnpm mock --host 127.0.0.1`.
2. In a second terminal, run `pnpm epg:report --playlist "http://127.0.0.1:8080/get.php?username=zoma&password=zoma-test&type=m3u_plus" --xmltv "http://127.0.0.1:8080/xmltv.php?username=zoma&password=zoma-test" --tier low`.
   - It should say `11 of 12 live channels matched (91.7%)`: 10 by id and 1 by match name.
   - It lists `18+ Test Pattern` as unmatched.
   - The window is `2 past and 3 future days`.
3. Optional, at scale, with the fixtures (`pnpm fixtures`): `pnpm epg:report --playlist .cache/fixtures/playlist.m3u --xmltv .cache/fixtures/xmltv-300mb.xml.gz --now 2026-11-01T00:00:00Z`. It reports 14,013 of 20,000 (70.1%) in about 6–8 s.

## Open decisions and gates (none block step 9b)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).
- **Relay cap:** 40 legs; leg 12 was the 12th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Two CLAUDE.md gaps** wait for his word: `@zoma/data`'s three entries, and the `pnpm epg:report` command.
- No secrets have been shared, so nothing needs rotating.
