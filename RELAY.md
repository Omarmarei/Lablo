# RELAY: Zoma IPTV v1 to store submission

**Objective:** build Zoma IPTV v1 for Samsung Tizen and LG webOS as approved in [docs/PLAN.md](docs/PLAN.md), up to the first store submissions (LG in the US and GCC, Samsung in the US).
**Source:** the planning conversation of 2026-11-01 (leg 0). Plan: [docs/PLAN.md](docs/PLAN.md) (it wins on conflicts). Detailed design: [docs/architecture.md](docs/architecture.md). Research: [docs/research/](docs/research/). Session breakdown follows architecture.md section 6, plus the v1 additions in PLAN.md section 4.

This file replaces the `ROADMAP.md` that PLAN.md mentions: these steps are the per-session checklist.

## Definition of done (global DoD applied to Zoma)
1. **Tests and build:** `pnpm verify` is green (lint incl. boundaries, typecheck, tests, both TV builds, ES2016 syntax gate, bundle budgets; each part counts once it exists).
2. **PR and CI:** a PR to `main` on private repo `Omarmarei/zoma-iptv` with green CI, merged with a merge commit (not squash, so the long-lived `relay/<run>` branch stays mergeable).
   - **Standing approval from Omar (2026-11-01):** the relay merges its own PRs (about one per phase) once CI is green, and lists the 3 riskiest changes in that leg's handover. Production deploys and migrations still need his word. Step 1 copies this rule into CLAUDE.md.
3. **Migrations:** N/A until step 29. After that, Neon production migrations are applied and the schema is checked with a query. Each one is `[needs Omar]`.
4. **Deploy:**
   - **Backend (Vercel):** each production deploy is `[needs Omar]`; verify the live endpoint afterwards.
   - **TV app:** the "deploy" is a store submission (`[needs Omar]`). Before that, check the change installed on a real TV once the test TVs exist.
5. **Handover** last.

UI steps also end with a short "press these keys" checklist that Omar can run in the desktop browser (`pnpm dev`) or on a TV.

## Steps

### Phase 0: Foundations
- [x] 0. Research, plan, architecture docs (leg 0). Commit `4581e54`.
- [x] 1. **Workspace scaffold (architecture.md 0.1).** Done in leg 1, commit `2415c0e`, PR #1. Also added ADR-008 (player/platform-api direction) and `boundaries/entry-point` (no deep imports across packages).
  - pnpm workspace, `tsconfig.base.json`, `.gitattributes` (`* text=auto eol=lf`; the Windows checkout has autocrlf).
  - Skeleton packages: `core`, `protocol`, `crypto`, `data`, `player`, `ui`, `platform-api`, `platform-tizen`, `platform-webos`, `platform-browser`.
  - ESLint flat config with `eslint-plugin-boundaries` (import rules from architecture.md 1.1; `player` must NOT import `platform-api`, while `platform-api` may import `player` types). `no-restricted-globals` for `tizen`/`webapis`/`webOS`/`PalmSystem` outside `platform-*`.
  - Vitest, plus a test proving the boundary lint rejects a forbidden import.
  - `CLAUDE.md`: conventions, Chromium 53 cheat sheet, boundaries, DoD, merge policy, and "never fetch provider URLs server-side / never relay streams".
  - `docs/adr/ADR-001..007`:
    1. packaged apps
    2. Preact + signals + custom focus engine
    3. chrome53 IIFE + syntax gate
    4. native players first
    5. servers never touch provider URLs or streams
    6. E2E pairing and backup crypto
    7. Stalker dropped
  - GitHub Actions CI running `pnpm verify`; README.
  - The private repo `Omarmarei/zoma-iptv` was created in leg 0 and `main` pushed. Push the relay branch, open the first PR, and merge it on green CI.
  - **Done when:** `pnpm verify` is green locally and on CI, and the lint test fails on a seeded forbidden import.
- [x] 2. **TV build pipeline and hello app (0.2).** Done in leg 2, commit `18d2b3a`. Main bundle ≈ 124 KB, hello worker ≈ 37 KB. `.wgt` is documented, not built (no Tizen CLI): docs/runbooks/tv-build.md. The gate failed as expected on a seeded regex lookbehind (`main.js (webos) 1:129246`).
  - `apps/tv` hello screen showing platform info.
  - `platform-browser` adapter (keyboard as remote).
  - `tools/build/build-tv.ts`: Rollup IIFE, Babel `preset-env {chrome:53}`, core-js, workers inlined as Blob URLs.
  - acorn ES2016 syntax gate and bundle budgets.
  - `platforms/tizen/config.xml` and `platforms/webos/appinfo.json`.
  - Packaging: `.ipk` via `@webos-tools/cli`; `.wgt` via the Tizen CLI if installed, otherwise document it.
  - `tools/device` install/launch wrappers; `pnpm dev` desktop loop.
  - **Done when:** `pnpm build:tv` passes the gate for both platforms, the `.ipk` is produced, and the desktop hello app passes a Playwright smoke test.
- [x] 2b. **Old-engine test harness (the main substitute for missing TVs).** Done in leg 3, commit `e632376`. `pnpm verify:engines [--self-test]` (`tools/engines`, runbook docs/runbooks/old-engines.md).
  - Pinned snapshots 403380 (53.0.2785), 433042 (56.0.2924) and 561732 (68.0.3440; the suggested 550428 is M67).
  - The engines run headed under Xvfb in a **Debian 9** container (on Debian 12, Chromium 53/56 segfault on a HarfBuzz ABI clash) and are driven over raw CDP.
  - Self-test: the ES2018 seed fails on 53/56 and passes on 68; the ES2020 seed and the no-polyfills build fail on all three; the real app passes on all. CI job `engines`, separate from `verify`.
  - **Finding for S1:** IndexedDB in a Blob worker on `file://` is denied on desktop 53–68 without file access. The harness runs with `--allow-file-access-from-files` (as the TV runtimes do); S1 must confirm on the TVs.
  - Script that fetches Chromium snapshot builds matching the TV engines (Chromium 53 = webOS 4, 56 = Tizen 4, 68/69 = 2020 sets), e.g. from `chromium-browser-snapshots`.
  - Run the built TV bundle headless in each, through an old-protocol driver (a matching old Puppeteer or chromedriver). Assert boot with no syntax or runtime errors, a remote-key navigation smoke test, and IDB plus Web Worker sanity.
  - Wire it into CI (Linux snapshots) as part of `pnpm verify:engines`.
  - **Done when:** CI fails on a seeded ES2018 feature and on a seeded missing polyfill, and passes on the hello app in all engines.

### Phase 2: Mock provider and fixtures (hardware-independent, done before the lab work)
- [x] 3. **`apps/mock-provider` (2.1).** Done in leg 4, commit `8977442`. `pnpm mock` (runbook docs/runbooks/mock-provider.md). 149 tests; the endpoint test fails if a registered route has no probe, and the fault table is a `Record<FaultType, …>`.
  - Beyond the list: M3U catch-up in every mode (`xc`/`default`/`append`/`shift`/`flussonic`) served with `X-Mock-Archive-*` oracle headers, `json-quirks`/`timezone`/`truncate`/`reset`/`no-cors` faults, `max_connections` counted from open streams, an account with special characters for percent-encoding, runtime scenario switch (`PUT /__mock/scenario`).
  - Media is placeholder bytes behind a `MediaSource` interface (`src/media.ts`); step 4 plugs in the ffmpeg channels and open movies.
  - Fastify.
  - Xtream `player_api.php` (every action), `get.php` m3u_plus, `xmltv.php`, `/live` `/movie` `/series` `/timeshift`.
  - `user_info` states (Active/Expired/Banned/max_connections), base64 short EPG.
  - YAML fault scenarios: 302 chains, stalls with the socket held open, 401/403/404/509, slow headers, malformed M3U, BOM/CRLF, gzip.
  - LAN log collector endpoint.
  - **Done when:** integration tests cover every endpoint and fault.
- [x] 4. **Legal media set and scale fixtures (2.2).** Done in leg 5 (runbook docs/runbooks/mock-provider.md: Media, Scale fixtures, Benchmarks, Docker).
  - `pnpm mock:media` generates 12 live loops plus a generic one, and 15 VOD/episode files plus 2 generic ones, in about 30 s.
  - Live loops are placed on the epoch timeline by a TS rewriter, so live TS, HLS and catch-up are one seamless stream.
  - `pnpm mock:open-movies` fetches the four films with pinned SHA-256, and `/attribution` credits them.
  - `pnpm fixtures` writes the 200k catalog and 50/150/300 MB XMLTV in about 20 s.
  - `pnpm bench` is the harness for steps 5–9. The mock's Dockerfile is in place.
  - CI job `media` runs `pnpm verify:media`: ffprobe on everything the mock serves, and the 2-minute fixture limit.
  - ffmpeg scripts: endless TS and sliding-window HLS test channels with name and clock burned in; multi-audio (ara/eng/5.1 AC3/E-AC3); HEVC 4K; MKV with ara/eng SRT. Plus a Blender open-movies fetch script with an attribution page.
  - `tools/fixtures`: deterministic 200k catalog (M3U + Xtream JSON, ar/en/fr/es names, malformed lines) and 50/150/300 MB XMLTV (+gz).
  - Node benchmark harness; Dockerfile.
  - Needs ffmpeg on PATH. If it's missing, end as needs-you: "install ffmpeg (`winget install Gyan.FFmpeg`)?".
  - **Done when:** `pnpm mock` serves streams that ffprobe validates in a test, and fixtures generate in under 2 minutes.

### Phase 3: Data engine
- [x] 5. **core, part 1 (3.1).** Domain types, ContentKey, Arabic/Latin normalization (diacritics, alef forms, ة→ه, ى→ي, Arabic-Indic digits), streaming M3U parser.
  - **Done when:** golden and fast-check fuzz tests pass.
  - Done in leg 7 (`packages/core/src`: `model`, `normalize`, `hash`, `content-key`, `m3u`, `m3u-catalog`). [ADR-009](docs/adr/ADR-009-m3u-content-keys.md) amends the M3U key: tvg-id **plus** name, 53-bit hash, key functions frozen.
  - Golden tests and fast-check properties: chunk-split invariance, never-throw on any UTF-16, round trips, Arabic and Latin folding.
  - Checked against the fixture generator's own catalog: all 200,000 entries come back and all 400 malformed lines are counted (`pnpm test:media`). A 9,000-entry run is in `pnpm test`.
  - `pnpm bench m3u-parse`: about 74 MB/s on the 45.6 MB playlist.
- [x] 6. **core, part 2 (3.2).** Tolerant Xtream client, streaming JSON-array splitter, streaming XMLTV tokenizer, catch-up URL builders (Xtream + M3U `default/append/shift/flussonic/xc`), detection of Xtream-style M3U links (`get.php?username=`) for the M3U→Xtream upgrade.
  - **Done when:** tests against the mock provider pass.
  - Done in leg 8 (`packages/core/src`: `json-splitter`, `xtream-url`, `xtream`, `timezone`, `catchup`, `xmltv`, `text`). [ADR-010](docs/adr/ADR-010-catchup-time-zones.md) records how the panel zone is found (Intl, then the panel clock, then UTC) and how M3U catch-up modes are inferred.
  - `test/core-mock.test.ts` runs everything against the in-process mock:
    - the Xtream client, with identical keys and items under `json-quirks`;
    - the `truncate`, `bom`, `gzip`, `invalid-utf8` and `status` faults;
    - every catch-up mode, resolved through `X-Mock-Archive-*` in four panel zones (one with DST);
    - get.php upgrade, including the special-character account;
    - XMLTV in every offset style.
  - Fixture oracles: the 200k Xtream lists come back exactly as `catalog.json` has them, and the gzipped 300 MB guide reads as 5,000 contiguous schedules (`pnpm test:media`).
  - Bench: `xtream-vod-json-split` about 95 MB/s; `xmltv-gz-tokenize` about 4.1 s for the 300 MB guide (2 s at a 10% match rate).
  - fast-check properties (chunk-split invariance, never-throw, round trips) were mutation-checked: all 8 mutants caught.
- [x] 7. **data, part 1 (3.3).** IDB schema and migrations (fake-indexeddb), typed worker RPC, query worker, search index and ranking.
  - **Done when:** search over the 200k fixture takes ≤ 200 ms in Node and migration tests pass.
  - Done in leg 9. The search index and ranking are in `packages/core/src/search.ts` (architecture.md puts search in core, which also lets the bench and the Chromium 53 bundle check reach it). The rest is in `packages/data/src`:
    - `schema` and `idb`: database version 1, append-only migrations, and callback-driven transactions;
    - `profile`: a versioned document with 3 rolling snapshots;
    - `chunker` and `catalog-store`: 500-item chunks, plus generations (begin, commit, delete, prune);
    - `rpc`: typed calls, cancel tokens, events and transfer;
    - `query-service`, `query.worker` and `client`.
  - **200k fixture** (`test/search-200k.media.test.ts`): parse → chunker → index → fake-indexeddb → query service. The slowest of 13 queries takes 10.8 ms, and every result is checked against the parsed names.
  - **Migration tests** pin the shape of every database version and upgrade from each earlier version with seeded data. A failing migration leaves the old version intact.
  - **Query worker:** bundled for Chromium 53, it is 100.5 KB (budget 150 KB). It runs with the ES2017 APIs removed and serves search over IndexedDB (`test/query-worker-bundle.test.ts`).
  - **Mutation check:** 16/16 mutants caught.
- [x] 8. **data, part 2 (3.4).** Ingest worker: streamed fetch, DecompressionStream/fflate gunzip, parse, 500-item chunks, generation swap. Busy-pause and low-tier duty cycle; conditional fetch.
  - **Done when:** the crash-mid-ingest test keeps the old generation, and favourites survive a renumbered refresh fixture.
  - Done in leg 10 (`packages/data/src`: `bytes`, `gunzip`, `throttle`, `favourites`, `ingest`, `ingest-service`, `ingest.worker`; architecture.md §1.4 has a "Built in step 8" note). The app wiring and the real-engine run moved to step 8b.
    - **Crash mid-ingest** (`ingest.test.ts`): the database closes under a refresh, as when the worker dies. The old generation still serves exactly the same results, and the next refresh prunes the leftovers and swaps in.
      - Network failures, cancels, HTTP errors, bad gzip and empty playlists also leave the active generation untouched.
    - **Renumbered refresh** (`test/ingest-mock.test.ts`): every Xtream id in the mock moves by 1000, and the favourites follow to the new keys. That includes channel 101, whose same-name, same-tvg-id twin sits in another group.
      - A dropped favourite is kept for 30 days and then removed.
      - Re-matching never guesses between items it can't tell apart.
    - **Conditional fetch:** ETag/If-Modified-Since with 304 (the mock's get.php now sends ETags), plus an FNV-1a byte hash with `INGEST_VERSION` for servers without validators.
    - **Throttle:** busy-pause (expires after 15 s) and the 50/50 low-tier duty cycle.
    - **Worker bundle:** the ingest worker bundles to 128.8 KB and runs in a Chromium 53-like realm against the mock, with gzip through fflate.
      - To fit the 150 KB budget, the TV build no longer injects polyfills for ES2019+ APIs that `lib: ES2017` code can't call, and fflate gets none.
      - That also cut the query worker from 100.5 to 75.8 KB and the main bundle from about 124 to 113.6 KB.
    - **200k playlist** through the real pipeline in Node: about 2.6 s, plain or gzipped (`test/ingest-200k.media.test.ts`).
- [x] 8b. **App wiring and the data workers on real old engines (rest of 3.4).**
  - `apps/tv` starts the query worker once and an ingest worker per refresh, through `?worker` imports. The TV build inlines both; check the main budget with them included.
  - Wire the hello screen (or a debug screen) to:
    - run `prune` at start;
    - ingest the mock's playlist from a URL given with `?source=` in dev;
    - forward `swapped` to the query worker's `reload`, and send `setBusy` from the remote-key handler.
  - Extend `tools/engines` so the boot check also runs both data workers in Chromium 53/56/68 (Blob worker + IndexedDB + fetch from the in-container mock, or a `file://` fixture). That is the S1 check for the data layer.
  - **Done when:** `pnpm verify:engines --self-test` shows the data workers ingesting and searching in all three engines, and `pnpm verify` is green.
  - Done in leg 11 (architecture.md §1.4 "Wired into the app in step 8b", §5 S1 note; runbooks old-engines.md and tv-build.md).
    - **App:** `apps/tv/src/data/engine.ts` (`DataEngine`: query worker once, prune in a short-lived ingest worker, one ingest worker per refresh, `swapped` → `reload`, keys → `setBusy` once per burst and idle after 1 s), `workers.ts` (the `?worker` imports), `params.ts` (`?q=`, `?force=1`, `?source=` last) and the hello screen's catalog panel (`DataPanel.tsx`).
    - **Package entries:** `@zoma/data/query.worker`, `@zoma/data/ingest.worker` and `@zoma/data/client` (package `exports`, allowed in the boundary lint and pinned by `test/lint-boundaries.test.ts`). The client entry keeps the data modules' polyfills out of main (−17 KB).
    - **Budgets:** main 323.1 KB (tizen) / 321.5 KB (webos) of 500 KB with the hello, query (75.8 KB) and ingest (125.3 KB, was 128.8) workers inlined. `UNUSED_POLYFILLS` now also matches `esnext.json.parse`, which step 8's pattern missed.
    - **Old engines:** a socat + POSIX-sh responder serves a generated 3,000-item playlist (plain and gzipped) in each container. All 24 self-test runs are as expected: the app passes on 53, 56 and 68 with 3,000 items committed (gzip through fflate) and exact search counts (`news` 308, `اخبار` 240 through hamza normalization); 16 seeded failures are caught.
    - PR #10 merged as `765a7cc` (CI `verify`, `engines` and `media` green on `7f05082`).
    - **Tests:** `test/tv-data-engine.test.ts` (the real services over message channels; 9/9 mutants caught), `test/engines-fixture.test.ts` (the fixture's numbers checked against core's parser and normalization), scenario tests for the new checks, and e2e that refreshes the mock's playlist in `pnpm dev` and in both built bundles from `file://`.
- [x] 9. **EPG (3.5), core part.** Matching cascade, tiered window, time handling, per-channel-day buckets, the match-rate report and the benchmark. Leg 12 split the step the way leg 10 split step 8: storage, refresh, prune, the short-EPG fallback and the app wiring moved to 9b.
  - **Done when:** the Node benchmark on the 300 MB fixture meets the thresholds in architecture.md, and the match-rate report works.
  - Done in leg 12 (architecture.md §1.5 "Built in step 9" and step 10; ADR-010 amended; runbook mock-provider.md "Benchmarks").
    - **core** (`epg-match.ts`, `epg-guide.ts`):
      - `EpgWantedSet` and `EpgMatcher`: override, id (case-insensitive; `xtream-id` for Xtream sources), name, then match name (incl. the XMLTV id's stem), with ties flagged and overrides that pin or block. `combineEpgMatches` merges several guides.
      - `EpgGuideReader`: the tokenizer's channel filter, interleaved guides (orphans, capped), the tier window (`EPG_WINDOWS`), UTC minutes, the DST repair, missing stops, 24 h cap and overlap cuts, and the per-channel-day column buckets (`EpgBucketBuilder`, `mergeEpgBuckets`, `epgNowNext` with tvg-shift applied per playlist channel).
      - Also in core: the tokenizer's `onItem` hook, `xmltvTimeHasZone`, and a fast path in `parseXmltvTime`, checked against the general path by a property test.
    - **Thresholds** (architecture.md §1.5 step 10, derived from S6), enforced by `pnpm bench`, which now exits 1 over a limit:
      - `epg-ingest-low-10pct` ≤ 8 s median on CI (measured 2.5–3 s locally);
      - `epg-ingest-full` ≤ 20 s (measured about 7.5 s);
      - the worst case runs in a 96 MB heap.
    - **Report:** `pnpm epg:report` (files or URLs, gzip sniffed, several guides). The 300 MB fixture gives 14,013 of 20,000 live channels by id (70.1%) and 4,947 of 5,000 guide channels used, and `test/epg-300mb.media.test.ts` checks every number against `catalog.json` in a 96 MB heap. The mock gives 11 of 12 (`test/epg-mock.test.ts`).
    - **Found on the way:**
      - V8 substrings pinned one decoded chunk per channel: the guide ran out of a 160 MB heap. Each guide channel now gets one owned id string (`ownString`).
      - `parseXmltvTime` gives the later instant of a repeated DST hour east of UTC, not the earlier one as ADR-010 said; the reader settles to the earlier one.
      - A lone boundary in the repeated hour can't be decided from ordering. Documented in ADR-010, and pinned by the New York mock test.
    - **Tests:** 28/28 mutants caught (`artifacts/mutate9.py`).
    - PR #11 merged as `fd777e1` (CI `verify`, `engines` and `media` green on `9adcab5`; on the CI runner `epg-ingest-low-10pct` took 2.3 s and `epg-ingest-full` 5.9 s).
- [x] 9b. **EPG (rest of 3.5): storage, refresh and the app.** Leg 13 split the short-EPG fallback out as step 9c.
  - **Storage:** database v2 as an append-only migration, with `epg_buckets` keyed `[epgSrc, gen, channel, day]` and `epg_channels` (the match table and the used guide channels). Extend `schema.test.ts` (pin v2, upgrade from v1 with a seed).
  - **Ingest:** fetch, gunzip and decode as the catalog ingest does (`runIngest`'s transport, `MaybeGunzip`, throttle) into `EpgGuideReader`. Write the buckets about 10 per transaction, merging `merge: true` fragments with the stored record. Then the generation swap, and prune of past days and old generations.
  - **Sources:** the Xtream `xmltv.php` and the M3U `url-tvg` header, automatically; user XMLTV URLs in priority order. The wanted set comes from the stored catalog's live items, with the panel zone (Xtream) or the source's offset as the fallback zone.
  - **Refresh:** every 12 h, or sooner when less than 24 h of future data remains. Low-tier TVs never run EPG and catalog ingest at once (§1.5 step 8).
  - **App:** `DataEngine` gains an EPG refresh and now/next for the query side. The hello screen's catalog panel shows the match rate and a channel's now/next.
  - **Done when:**
    - an EPG refresh of the mock through the data layer (fake-indexeddb) stores exactly the mock's schedule;
    - a crash mid-EPG-ingest keeps the old generation;
    - now/next comes back from the store;
    - `pnpm verify` and `pnpm verify:engines --self-test` are green.
  - Done in leg 13 (architecture.md §1.3 and §1.5 "Built in step 9b"; runbooks old-engines.md and tv-build.md).
    - **Storage:** database v2 (`epg_meta`, `epg_buckets`, `epg_channels`), pinned with a seeded upgrade from v1. Typed-array columns round-trip in fake-indexeddb and in Chromium 53/56/68.
    - **Refresh** (`runEpgRefresh` in a new EPG worker, `@zoma/data/epg.worker`):
      - guides from `epgGuides`: the user's first, then Xtream `xmltv.php` and the M3U header's URLs (now stored as `SourceMeta.epgUrls`);
      - the wanted set from every source's active live items;
      - conditional fetch with a basis, so a new catalog re-reads the same bytes;
      - fragments merged into the stored record, also within one batch;
      - swap, previous generation deleted, past days pruned;
      - each guide fails on its own (`failedAt` waits 2 h);
      - `epgRefreshDue`: 12 h, or under 24 h of programmes left, never within 2 h.
    - **App:** `DataEngine.refreshEpg` (one refresh slot shared with the catalog, busy pause, `due`), `nowNext` and `epgStatus` through the query worker. The hello screen's panel shows `epg-status` (match rate) and `nownext-status`.
    - **Found on the way:** with a tvg-shift, core's `epgNowNext` compared an unshifted start with an already-shifted candidate. Fixed and tested.
    - **Workers:** the ingest worker would have been 159.6 KB with the reader, so EPG has its own worker (116.0 KB). Query 80.7 KB, ingest 125.5 KB, main 449.4 KB of 500 (see "Main bundle budget" below).
    - **Tests:** `epg-store`, `epg-ingest` (incl. the crash), `test/epg-ingest-mock.test.ts` (the mock's schedule exactly: M3U `url-tvg`, a gzipped user guide in the low tier, an Xtream guide without offsets in Kathmandu time; now/next for every live channel), DataEngine, e2e (dev and both bundles: 11 of 12 matched), and the old-engine harness: a generated guide read in Chromium 53/56/68 with exact matches and a now/next. 34/34 mutants caught (`artifacts/mutate9b.py`).
    - PR #12 merged as `f448c5c` (CI `verify`, `engines` and `media` green on `252b0b0`; locally `verify:engines --self-test` ran all 24 runs as expected).
- [ ] 9c. **Short-EPG fallback (rest of 3.5).**
  - **Data:** for live channels of an Xtream source that no guide matches, `get_short_epg` (core `XtreamClient.shortEpg`, `decodeShortEpg`) through the data layer, cached 30 min per channel. It needs the account, so it runs where the transport is: a `shortEpg` handler on the query worker (measure its budget first) or a short-lived worker.
  - **App:** `DataEngine` asks after a channel has been focused for 600 ms (a debounce; fake timers in tests) and merges the answer into its now/next. The hello screen's panel shows it for an unmatched channel of an Xtream `?source=`.
  - **Done when:** an unmatched mock channel gets now/next from `get_short_epg` after 600 ms of focus and not before, a second focus within 30 min makes no request, and `pnpm verify` is green.

**Main bundle budget (decide before step 11).** The TV build inlines every worker into `main.js`, and the 500 KB main budget counts them. With the EPG worker, main is 449.4 KB, so the UI steps (focus engine, design system, i18n, screens) have only about 50 KB. Options for Omar when that runs out:
1. count inlined workers against their own 150 KB budgets only, and keep the 500 KB for the main thread's own code (recommended: a worker string is not parsed as code until the worker starts);
2. ship the workers as separate files in the package (needs spike S1 to show `file://` workers on the TVs);
3. raise the main budget.

### Phase 4: UI shell
- [ ] 10. **Focus engine (4.1).** Intents, zones (`list`/`grid`/`epg`/`free`), RTL horizontal flip, per-zone memory, router/back stack, `rootBackPolicy`, Magic Remote hover-to-focus.
  - **Done when:** unit tests pass in LTR and RTL.
- [ ] 11. **Design system (4.2).** Tokens, Arabic and Latin woff2 font subsets, base components, virtual list, `postcss-rtlcss`, pseudo-locales.
  - **Done when:** Playwright screenshots exist in en/ar/pseudo.
- [ ] 12. **i18n (4.3).** Runtime plus en/ar catalogs, Arabic plural forms (6), date and digit formatting, lint against hard-coded strings, in-app language switch.
  - **Done when:** lint catches a seeded hard-coded string.
- [ ] 13. **Onboarding (4.4).** Language, disclaimer, device-ID consent, add a source on the TV (Xtream / M3U / EPG URLs), validation, load progress.
  - **Done when:** a keys-only Playwright run passes in en and ar against the mock provider.
- [ ] 14. **Live browse screen (4.5).** Category rail, virtual channel list, now/next, `RemoteDriver` e2e, CPU-throttled smoke test. Ends with a click-through checklist for Omar.
  - **Done when:** the e2e tests are green and the checklist is in the handover.

### Hardware lab
Omar has **one LG TV and no Samsung TV** (2026-11-01). Testing relies on several layers:
1. The old-engine harness (step 2b).
2. The Tizen TV Emulator/Simulator and the webOS Emulator/Simulator, for APIs, lifecycle and keys only (no real media).
3. Omar's LG TV, for real webOS media.
4. A Samsung real-device option that Omar chooses at step 16.

- [ ] 15. **Zoma Lab build and test strategy without TVs (1.2 + 1.3).**
  - Spike screens S1–S3, S6, S7, S9–S11 and the player batteries S4, S5, S8, all posting JSON to the LAN log collector, runnable in emulators and simulators too.
  - `docs/runbooks/tv-setup.md`: Tizen Studio + Samsung certificate + TV Emulator; webOS CLI + Emulator 4.x + Simulator 22–24; LG Developer Mode and how to extend it.
  - `docs/testing-without-tvs.md`: research and compare Samsung real-device options with cost and coverage for each.
    - a cheap used Samsung (2018–2020 covers the low tier; 2021+ also enables Samsung Seller Office Beta Test)
    - remote smart-TV device labs (e.g. Suitest, TV Labs; check whether Samsung offers TV devices in its Remote Test Lab)
    - Samsung Beta Test on friends' and family's 2021+ TVs
    - a recommendation
  - **Done when:** the lab runs in the desktop browser and in at least one emulator, and both docs are complete.
- [ ] 16. **[needs Omar] Run the spikes on the available hardware.**
  - **Omar:**
    - tell the relay the LG TV's model and year (which webOS version)
    - put it in Developer Mode on the LAN
    - pick the Samsung option from step 15
    - create the Samsung certificate (runbook)
  - **Claude:** runs the lab on the LG TV, the emulators and the chosen Samsung route. Then it writes `docs/spikes/results.md` and ADRs, and **re-orders or edits the remaining steps here** to match the results.
  - **Gaps:** if the LG TV is 2020 or newer, no 2018 low-end LG exists to test S6, so decide between buying one or raising the LG minimum year.
  - **Done when:** results.md has a row per spike per device. Spikes that couldn't be run are listed with the plan to cover them.

### Phase 5: Player and live TV
- [ ] 17. **PlayerController (5.1).** Session tokens, close-before-open, URL strategy (`.ts`→`.m3u8`, remembered per source), watchdog retry ladder, error classifier; FakeEngine tests.
  - **Done when:** state-machine and zapping-race tests pass.
- [ ] 18. **Html5Engine (5.2).** webOS/desktop engine, webOS track-switch strategy (from S5), desktop playback e2e against the mock provider.
  - **Done when:** e2e plays live, VOD and catch-up on desktop.
- [ ] 19. **AvplayEngine (5.3).** AvplayEngine plus the redirect probe (from S4), suspend/restore, screensaver, key registration; unit tests with an AVPlay fake.
  - **Done when:** the tests pass and a TV smoke install plays a mock channel.
- [ ] 20. **Player UI (5.4).** Info bar, debounced zapping, number entry, previous channel, track menu, subtitle overlay (SRT/VTT/ASS, size + timing), aspect/zoom, stream info, reconnect badge, error cards, start-on-last-channel.
  - **Done when:** e2e passes and the click-through checklist is in the handover.
- [ ] 21. **[needs Omar] On-TV player check.** 50 rapid zaps, 2 h soak with injected stalls (each recovered in ≤ 10 s), launch to last channel in ≤ 4 s on 2020+ TVs. Run by the lab self-test, or by Omar from the checklist. Covers Omar's LG and the Samsung route chosen at step 16.

### Phase 6: EPG and catch-up
- [ ] 22. **EPG sources (6.1).** EPG source management, refresh scheduling, now/next in the list, short-EPG fallback.
- [ ] 23. **Grid guide (6.2).** Virtualized on both axes, time cursor, RTL.
  - **Done when:** each key press in the grid is handled in ≤ 150 ms in the throttled e2e.
- [ ] 24. **Programme details (6.3).** Details, manual EPG-to-channel mapping, match diagnostics, per-source time offset.
- [ ] 25. **Catch-up and tuning (6.4).** Catch-up from the grid (Xtream timeshift + M3U modes) and low-tier tuning.
  - **Done when:** catch-up plays from the mock provider in e2e.

### Phase 7: Movies, series, search
- [ ] 26. **Movies.** Poster grids with tiered image caps, details, resume, "Recently added".
- [ ] 27. **Series.** Seasons and episodes, progress, "Continue watching", auto-next.
  - **Done when:** resume is accurate to ±5 s.
- [ ] 28. **Search and Home.** Global search UI (≤ 300 ms with 200k items) and the Home screen.

### Phase 8: Backend (local development until step 34)
- [ ] 29. **Backend skeleton.** `apps/web`: Next.js + Prisma + local Postgres in Docker; R2/Upstash abstractions; `protocol` and `crypto` packages with shared test vectors.
- [ ] 30. **Signed config.** Signed config, `tools/sign-config`, client enforcement of kill modes and the hashed blocklist.
- [ ] 31. **Pairing.** Pairing API, phone page (en/ar), TV QR screen, encrypted file relay.
  - **Done when:** the automated "no plaintext" test passes.
- [ ] 32. **Backup.** Encrypted backup and automatic restore (scrypt master key, envelope), backup-code fallback.
  - **Done when:** a simulated webOS wipe restores automatically.
- [ ] 33. **Telemetry.** Telemetry, URL/credential scrubber, crash handler, diagnostics support code.
- [ ] 34. **[needs Omar] Production infrastructure.**
  - **Omar:** creates the Vercel/Neon/R2/Upstash accounts and the domain, and puts the keys in `.env` himself.
  - **Claude:** the first production migration and deploy, each with Omar's one-word OK; then verifies the live endpoints.

### Phase 9: Personalization
- [ ] 35. **Favourites and groups.** Named favourites lists (custom groups), hide/reorder groups, channel numbers.
- [ ] 36. **Channel management.** Hide/rename/renumber channels, "clean names", multiple sources merged.
  - **Done when:** favourites survive the renamed/reordered fixture.
- [ ] 37. **M3U→Xtream and radio.** The M3U→Xtream upgrade UX and radio (audio-only) channels.
- [ ] 38. **Parental and settings.** Parental PIN, adult groups auto-locked (XXX, 18+, للكبار), complete settings screen.
- [ ] 39. **Comfort features.** Clock, sleep timer with "Still watching?", colour-key shortcuts, "Fast start / Stable" buffer setting.
- [ ] 40. **Diagnostics and legal pages.** Diagnostics screen ("app or provider?"), test stream, help, in-app legal pages.

### Phase 10: Hardening and release
- [ ] 41. **[needs TV] Performance.** 2018-tier performance and memory pass against the S6 thresholds.
- [ ] 42. **[needs TV] Resilience.** 8 h soaks, network-drop tests, update-in-place data survival on both platforms.
- [ ] 43. **Accessibility.** Voice Guide/TTS, captions, large text, Magic Remote polish.
- [ ] 44. **Store documents.**
  - en/ar store copy, test-pattern screenshots, LG UX scenario + self-checklist, Samsung UI Description PPTX + tester notes.
  - **[needs Omar]** public test-server deploy.
- [ ] 45. **Release engineering.** Versioning, signed packages, release checklist script.
- [ ] 46. **[needs Omar] Beta.** Native Arabic review and a closed beta (10–30 users in GCC + North America).
- [ ] 47. **[needs Omar] Store submissions.** LG (US, AE, SA, KW, QA, BH, OM) and Samsung US. Samsung GCC/Canada follow once the Partner contract is signed.

## Omar's parallel track (not relay steps; see PLAN.md section 7)
- **Week 0–1:**
  - Decide the publishing company.
  - Test devices: you have one LG TV. Note its model and year for step 16. The Samsung route (used TV / remote lab / beta testers) is decided at step 16, using step 15's comparison.
  - Open Samsung Seller Office and submit the Partner application (Samsung Gulf). Open LG Seller Lounge.
  - "Zoma" trademark clearance in the US, CA, AE and SA. Domains.
- **Week 2–4:** counsel for ToS, privacy (PDPL, PIPEDA, Quebec Law 25) and DMCA policy; register the DMCA agent.
- **Before step 16:** install Tizen Studio and create the Samsung certificate (runbook from step 15).

## Progress log
| Session | Date | Step | Result | Commit |
|---|---|---|---|---|
| 0 (planning) | 2026-11-01 | 0 | Research (competitors, user voice, platform/legal), approved plan, architecture saved to docs/ | 4581e54 |
| 0 (planning) | 2026-11-01 | setup | RELAY.md written; private repo Omarmarei/zoma-iptv created, main pushed; Omar: auto-merge on green CI, only an LG TV (2b + 15/16 adapted) | 2e82349 |
| 1 | 2026-11-01 | 1 | Workspace scaffold: 10 packages, boundary lint + 29-case ESLint API test, CLAUDE.md, ADR-001..008, CI green on PR #1 | 2415c0e |
| 2 | 2026-11-01 | 2 | build:tv (Rollup IIFE, Babel chrome 53, core-js, Blob workers, ES2016 gate, budgets, isolation check), .ipk via ares-package, platform adapters, Preact hello app, pnpm dev/device, Playwright smoke; verify + CI extended | 18d2b3a |
| 3 | 2026-11-02 | 2b | Old-engine harness: Chromium 53/56/68 snapshots in Debian 9 Docker over raw CDP; boot, Blob worker + IDB, keys; self-test catches ES2018/ES2020 seeds and no-polyfills; CI job `engines`; S1 finding (Blob-worker IDB on file://) | e632376 |
| 4 | 2026-11-02 | 3 | Mock provider: Xtream player_api (all actions, user_info states), m3u_plus, XMLTV(.gz), live TS/HLS, VOD ranges, catch-up in all Xtream/M3U modes, 14 fault types (YAML scenarios + `?mock_fault=`), LAN log collector, `pnpm mock`; 149 tests | 8977442 |
| 5 | 2026-11-02 | 4 | Legal media set: ffmpeg test channels (60 s loops on the epoch timeline via a TS rewriter; bilingual, 720p50, 1080p, MP3 radio), VOD (4K HEVC, multi-audio ara/eng/spa + AC3/E-AC3 5.1, SRT/mov_text ara+eng), Blender open movies (pinned SHA-256) + /attribution; scale fixtures (200k M3U/Xtream/catalog JSON, 50/150/300 MB XMLTV + gz, ~20 s); bench harness; mock Dockerfile; mock `--catalog/--xmltv/--media`; CI job `media` (ffprobe-validated) | 6a2b9f9 |
| 6 | 2026-11-02 | — | No project work. Stalled at start on a hidden EnterWorktree permission prompt, as leg 3 did. Diagnosed with Omar, and the relay skill fixed: the run settings deny EnterWorktree, and the watcher now cancels a stuck prompt and nudges the leg once. Step 5 moves to leg 7 | — |
| 7 | 2026-11-02 | 5 | core part 1: domain types, ContentKey (ADR-009: tvg-id+name, 53-bit hash, frozen), NFKD-based Arabic/Latin normalization + matchName, streaming M3U parser (chunk-split safe, counted skips) + catalog mapping; golden + fast-check tests; 200k fixture oracle (all entries, 400 malformed lines); bench `m3u-parse` ~74 MB/s. Also (Omar's option 1): unrs-resolver pinned to 1.12.2 because Smart App Control blocks 1.13.0's binary, and the WASM fallback was dropped (it can't resolve Windows paths). PR #6 merged as 7b44cb3 | 1bdf817, 597c73e |
| 8 | 2026-11-02 | 6 | core part 2: streaming JSON-array splitter; tolerant Xtream client (injected transport, json-quirks-proof keys, episodes in any shape); streaming XMLTV tokenizer (entities, CDATA, UI-language titles, wantChannel skipping); catch-up URLs for Xtream and every M3U mode, panel zone via Intl, then panel clock, then UTC (ADR-010); get.php detection. Checked against the in-process mock (every catch-up mode via X-Mock-Archive-* in 4 zones, faults, XMLTV offset styles), the 200k Xtream lists and 300 MB guide oracles, and a Chromium 53 pipeline bundle; 711 tests. Bench: Xtream lists ~95 MB/s, 300 MB guide ~4.1 s. PR #7 merged as 275879c | 0798039, 2b1a95b |
| 9 | 2026-11-02 | 7 | data part 1: core search (U+0001-joined name index, offsets, hash53 key map, chunk table; ANDed words; ranked word-prefix > favourite > kind > exact/start/word; cap 200; fast-check oracle; ≤ 17 ms per query on 200k generated items); data: database v1 with append-only migrations (every version pinned, upgrade from each, failing migration aborts cleanly), callback-driven transactions, versioned profile with 3 rolling snapshots, 500-item chunker and generation begin/commit/delete/prune, typed RPC (cancel tokens, events, transfer), query service and worker with a chunk cache, DataClient. 200k fixture through fake-indexeddb ≤ 11 ms per query; bundled query worker 100.5 KB, run in a Chromium 53-like realm; bench `search-index-build` ~100 ms, `search-200k` ~3 ms per query; 16/16 mutants caught; 768 tests. PR #8 merged as 714d0aa | cfa0132 |
| 10 | 2026-11-02 | 8 | data part 2: ingest pipeline (fetch transport with reader.cancel, FNV-1a, gzip magic → DecompressionStream or fflate, streamed UTF-8, M3U and Xtream parsers, 500-item chunks, batched writes, generation swap, prune, abandon on failure), conditional fetch (ETag/If-Modified-Since 304 + byte hash + INGEST_VERSION; mock get.php ETags), busy-pause and 50/50 low-tier duty cycle, favourites reconcile (name → tvg-id → group, never ambiguous, 30-day drop, transactional updateProfile), ingest worker and client. Crash-mid-ingest and renumbered-refresh tests pass; ingest worker 128.8 KB after trimming unused ES2019+ polyfills (query worker 75.8 KB); 200k playlist ingest ≈ 2.6 s in Node. Split out step 8b (app wiring and old engines). PR #9 merged as 2c8e573 | 88dcce6, 38d9e64 |
| 11 | 2026-11-02 | 8b | App wiring of the data workers: DataEngine (query worker once, start-up prune in a short-lived ingest worker, one ingest worker per refresh, swapped -> reload, remote keys -> setBusy per burst), ?worker imports via new @zoma/data exports (query.worker, ingest.worker, client; boundary lint allows them), hello-screen catalog panel (?q=, ?force=1, ?source= last). Main 323 KB of 500 with all workers inlined (client entry -17 KB; esnext.json.parse now excluded, ingest worker 125.3 KB). Old engines: socat+sh fixture server in the container; 24/24 self-test runs as expected, the app ingests 3,000 items (gzip via fflate) and searches exactly (308 / 240) in Chromium 53, 56 and 68; 9/9 DataEngine mutants caught; e2e refreshes the mock in dev and both built bundles. PR #10 merged as 765a7cc | 7f05082 |
| 12 | 2026-11-02 | 9 | EPG core: wanted set and matching cascade (override, id, xtream-id, name, match name incl. id stem; ties flagged; pins), guide reader (document-order items, channel filter before tokenizing, capped orphans, tier window, UTC minutes, DST repair settled to the earlier instant, missing stops, 24 h and overlap cuts), per-channel-day column buckets with merge fragments, now/next with per-channel tvg-shift, match-rate report + `pnpm epg:report`. Bench limits from S6 enforced (`pnpm bench` exits 1): low-tier 10% case ≤ 8 s (2.5–3 s locally), worst case ≤ 20 s (7.5 s), worst case in a 96 MB heap with every report number exact against catalog.json. Fixed a V8-substring retention (OOM at 160 MB). 28/28 mutants. Split out step 9b (storage, refresh, short EPG, app). CI: low 2.3 s, full 5.9 s, 96 MB-heap run 9.6 s. PR #11 merged as fd777e1 | 9adcab5 |
| 13 | 2026-11-02 | 9b | EPG storage, refresh and app: database v2 (epg_meta, epg_buckets, epg_channels; typed columns), runEpgRefresh in a new EPG worker (116 KB; the ingest worker would have been 159.6 KB): guides (user, Xtream xmltv.php, M3U url-tvg via SourceMeta.epgUrls), wanted set from stored live items, conditional fetch with a catalog basis, fragments merged (also within a batch), swap/prune/past days, per-guide failures with a 2 h hold, refresh due at 12 h or < 24 h ahead. Query worker now/next (d-1..d+1, tvg-shift, guides combined by rank) and epgStatus. DataEngine.refreshEpg shares the refresh slot (busy pause, `due`); panel shows match rate and now/next. Fixed core epgNowNext with a shift. Mock schedule stored exactly (url-tvg, gz user guide low tier, Xtream panel zone); crash keeps the old generation; e2e 11 of 12; old engines read a generated guide. 34/34 mutants. Main 449.4 KB of 500 (budget note). Split out 9c (short EPG). PR #12 merged as f448c5c | 252b0b0 |
