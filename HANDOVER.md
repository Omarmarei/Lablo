# Zoma IPTV: relay leg 12 opening prompt

You are leg 12 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Legs 1–5 did steps 1–4 (PRs #1–#5). Leg 6 did no project work.
- Legs 7–10 did steps 5–8 (PRs #6–#9).
- **Leg 11 did step 8b:** app wiring, and the data workers on real old engines.
  - PR **#10**, commit `7f05082`, merged as merge commit **`765a7cc`** (the branch was kept).
  - CI `verify`, `engines` and `media` were green on `7f05082`. CI on `main` at `765a7cc` was still running at handover.

**Your step is step 9: EPG (architecture 3.5).**
- The matching cascade, the tiered time window, per-channel-day buckets, refresh and prune, and the short-EPG fallback.
- **Done when:** the Node benchmark on the 300 MB fixture meets the thresholds in architecture.md, and the match-rate report works.

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Start in your first turn.

**First, check `main`:** run `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `765a7cc` (PR #10's merge) should be green in all three jobs. If a job is red, fix it on the relay branch before anything else.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree is your isolation: edit it by path, with `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths and Read/Edit/Write. `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) allows the worktree and gh, git, pnpm, node, docker, curl and bash.

## Read first, in this order
1. **`CLAUDE.md`:** the conventions, the Chromium 53 cheat sheet, package boundaries, Definition of Done, merge policy and commit format.
2. **`RELAY.md`:** step 8b (ticked, with what was built), step 9, and the leg-11 progress-log row.
3. **`docs/architecture.md`:**
   - **§1.5 (EPG pipeline):** sources, the wanted set, the tokenizer, the matching cascade, filter and time handling, the window per tier, storage as one record per channel per day, refresh, and the XMLTV assumptions;
   - §1.3 (storage): `epg_buckets` `[epgSrc, channelKey, dayIndex]` and `epg_channels`, EPG ≤ 100 MB on full-tier TVs and ≤ 30 MB on low-tier ones;
   - §1.4's "Built in step 8" and "Wired into the app in step 8b" notes: the ingest pattern to mirror;
   - §5: S6's numbers (a 150 MB gzipped XMLTV filtered ingest ≤ 4 min on webOS 4).
4. **`docs/adr/ADR-010-catchup-time-zones.md`:** panel zone, XMLTV offsets, and the DST repair from per-channel ordering.
5. **Code to build on:**
   - `packages/core/src/xmltv.ts`: `XmltvTokenizer` (streaming; entities, CDATA, UI-language titles, `wantChannel` skips unwanted programmes before tokenizing), `parseXmltv`, `parseXmltvTime(raw, fallback)`;
   - `packages/core/src/xtream.ts`: `XtreamClient.shortEpg(streamId, limit)` and `decodeShortEpg`, for the short-EPG fallback;
   - core's `normalizeName` and `matchName` (frozen, ADR-009);
   - `packages/data/src`: `ingest.ts` (`runIngest`: fetch → gunzip → parse → chunks → swap), `catalog-store.ts` (generations), `schema.ts` (database v1 has **no EPG stores**), `throttle.ts`, `gunzip.ts`, `bytes.ts`, `ingest-service.ts`;
   - `apps/tv/src/data/engine.ts` (`DataEngine`), if an EPG refresh joins the app now;
   - `tools/bench/src/suites.ts` (`xmltv-gz-programme-scan`, `xmltv-gz-tokenize`, `xmltv-gz-tokenize-10pct`) and `tools/fixtures/src/xmltv.ts` (5k channels × 14 days, ids `epg{k}.zoma.test`).
6. **`docs/PLAN.md`** wins on any conflict.

## Heads-up for step 9
- **Architecture.md gives no numeric Node threshold for the 300 MB EPG.** It has S6's on-TV numbers (150 MB gz filtered ingest ≤ 4 min on webOS 4), the phase-6 grid target (≤ 150 ms per key), the storage budgets and the windows. Step 6's bench reads the 300 MB guide in about 4.1 s, or 2 s at a 10% match rate.
  - Choosing the Node threshold is an engineering call, not Omar's. Derive it from S6 with a stated safety factor (time and peak memory).
  - Write it into §1.5 with the reasoning, and make the bench enforce it.
- **The EPG stores need database v2.** Add an append-only migration and extend `schema.test.ts`, which pins every version and upgrades from each earlier one. Don't edit v1.
- **Step 9 is big.** If it won't fit one session, split it the way leg 10 split step 8, and record the split in RELAY.md:
  - **9:** core matcher, window, time and buckets, the match-rate report, the bench;
  - **9b:** data stores, ingest and swap, refresh and prune, the short-EPG fallback, app wiring.
- **Low-tier TVs never run EPG and catalog ingest at the same time** (§1.5 item 8). `DataEngine`'s one-refresh-at-a-time guard is a starting point.
- The mock's `xmltv.php` covers each channel's archive days back and 3 days ahead, and the mock catalog's live channels carry `epg_id`s (`zoma.test1` and so on), so match-rate tests can use it.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone (its local `main` is behind).
- **Branch:** HEAD is the commit that adds this `HANDOVER.md` and records PR #10's merge in RELAY.md, on top of `7f05082` (step 8b). It is pushed, and the worktree is clean. `main` holds the merge commit `765a7cc`; the branch doesn't, which is normal for this run.
- **Gitignored but present:**
  - `node_modules`;
  - `.cache/media`, `.cache/fixtures` (200k `catalog.json`/`playlist.m3u`/`xtream`, `xmltv-{50,150,300}mb.xml` plus `.gz`) and `.cache/engines`;
  - Playwright `chromium-1248`; Docker image `zoma-old-engines:ba502212364a` (the current tag);
  - `artifacts/`:
    - `mutate8.py` and `mutate8b.py` (the `DataEngine` mutation runner; UTF-8 output capture);
    - `make-size-probe.py` (see Gotchas);
    - `screenshot-8b.ts` (Playwright screenshot of a built bundle after a mock refresh; run it with `npx tsx`);
    - `hello-8b*.png`, `verify.log`, `engines.log`.
- **Local gates on `7f05082`:**
  - `pnpm verify` green: 864 tests in 61 files, e2e 6/6. Main bundle 323.1 KB (tizen) / 321.5 KB (webos) of 500 KB with the hello (37.5), query (75.8) and ingest (125.3) workers inlined;
  - `pnpm verify:engines --self-test` green: 24/24 runs as expected, 16 seeded failures caught. The app's data workers ingest 3,000 items (gzip through fflate) and search exactly (308 / 240 hits) in Chromium 53, 56 and 68.
- **Docker Desktop was running** this leg.

## What step 8b added (use it, don't rebuild it)
- **`DataEngine`** (`apps/tv/src/data/engine.ts`):
  - `start()`: starts the query worker, then prunes in a short-lived ingest worker;
  - `refresh(job, { lowTier, onProgress, cancel })`: one fresh ingest worker per refresh. It waits for the start-up prune, makes the query worker `reload` on `swapped` before it resolves, and runs only one refresh at a time;
  - `search(query)` returns the total and the first names; `summary()` returns sources and items;
  - `noteActivity()`: `setBusy(true)` once per burst of keys, idle 1 s after the last one;
  - `dispose()`.
  - Workers come from factories, so tests serve the real services over `MessageChannel`s (`test/tv-data-engine.test.ts`).
- **`apps/tv/src/data/workers.ts`:** `createAppDataEngine()` with the `?worker` imports.
- **`params.ts`:** `?q=`, `?force=1` and `?source=` (last parameter, takes the rest of the URL), hand-parsed.
- **`DataPanel.tsx`:** the hello screen's "Catalog" panel. Test ids `data-status`, `ingest-status` (`data-items`, `data-gzip`), `search-status` (`data-total`) and `busy-status`. Onboarding (step 13) replaces it.
- **`@zoma/data` package entries:** `./client` (RPC clients only: keeps polyfills out of main), `./query.worker` and `./ingest.worker`. `eslint.config.js` allows them as `data` entry points; `test/lint-boundaries.test.ts` pins that.
- **Build:** `UNUSED_POLYFILLS` matches `esnext.json.parse` too.
- **Old-engine harness** (`tools/engines`):
  - `src/fixture.ts` generates a 3,000-item playlist (plain and gzipped; Latin and Arabic news names) and the expected numbers. `test/engines-fixture.test.ts` checks them against core.
  - `docker/serve-fixture.sh` + socat serve it in each container on `127.0.0.1:8090`.
  - `scenario.ts` checks `data-status`, the refresh (`committed`, items, gzip) and the exact search total. `IMAGE_FILES` lists everything the image tag hashes.
- **e2e:** both specs start the mock in-process (`mock()`/`listen()` from `apps/mock-provider/test/helpers` in `test.beforeAll`) and refresh its `get.php` playlist: in `pnpm dev`, and in both built bundles from `file://`.

## Gotchas and lessons (legs 1–11)
**Shell and tools**
- The Bash cwd resets after a `cd`; use absolute paths.
- **Never put a backslash in a Bash heredoc.** It happened 3 more times in leg 11: `'\\n'` became a real newline in an e2e spec, a regex `\\.` broke, and Dockerfile `\` continuations failed an assert. Use the Edit tool, or Write whole files (Write keeps `\n` literal, but turns `\uFEFF`/`\u2028` into raw characters).
- **CI waits:** the **Monitor tool** with a loop over `gh pr checks <n>` that prints each finished job and exits when none is pending (timeout 30 min). Wait about 20 s after `gh pr create`. It worked again in leg 11.
- **Measuring a bundle:** `python artifacts/make-size-probe.py` writes `tools/build/src/zz-sizes-probe.ts` for `packages/data/src/<name>.worker.ts`. For any other entry, change its last line to `join(process.cwd(), process.argv[2])` and pass a path (e.g. `apps/tv/src/main.tsx`). Run it with `npx tsx tools/build/src/zz-sizes-probe.ts <arg>` from the worktree root, then **delete it** (lint would see it).
- **Mutation runs:** `artifacts/mutate8b.py [name]` (`DataEngine`), `artifacts/mutate8.py "<snippet>"` (ingest). Each run has a 180 s timeout; restore from `.bak` if one is killed.
- **Old-engine Docker image:**
  - never change the `RUN apt-get …` line. archive.debian.org ran at about 40 KB/s, and one added package started an hour-long rebuild;
  - use tools already in the image (socat, sh), or add layers after that line;
  - list new COPY files in `IMAGE_FILES`.
- **TaskStop on a background `verify:engines`** leaves its `docker build` running. Find it with `Get-CimInstance Win32_Process -Filter "Name='docker.exe'"` and stop it.
- **Smart App Control is ON** (Omar's choice). A blocked native binary: pin an older version or use pure JS. Never turn SAC off or weaken lint.
- **pnpm 11:** after a `package.json` dependency edit, run `pnpm install --config.optimistic-repeat-install=false`. New dependencies must be at least 2 weeks old.

**Repo layout and tests**
- Package tsconfigs include only `src`, so package tests go in `src/`. Root `test/` (outside the boundary lint) holds cross-package tests (`@zoma/data` with `tools/*`, the mock or `apps/tv`).
- **The boundary lint resolves `?worker` imports** (it strips the query), so a new worker entry needs an `entry-point` rule.
- **Vite dev** resolves `@zoma/<pkg>/<x>.worker?worker` through package `exports`; no `optimizeDeps` change was needed (fflate included).
- **fake-indexeddb:** `freshFactory()` per test. A worker crash is `db.close()` in `fakeTransport`'s `beforeChunk`. Close `MessageChannel` ports in `afterEach`.
- **`vm` realm workers:** run `var self = globalThis` first; pass `fetch`, `TextDecoder`, `IDBKeyRange` and `indexedDB` in.
- **Search oracles:** query words are ANDed as substrings; normalization makes `اخبار` match `أخبار`.
- **Mock tests:** never build URLs from `base` at module level. Reset `app.mockState.catalog` in `beforeEach`.
- **Old engines:**
  - all `file://` pages in one engine share one IndexedDB, so the harness passes `force=1`;
  - the first run after Docker starts can time out on chrome53 ("DevTools … did not answer"): retry once.
- **Polyfills:**
  - Babel injects per file before tree-shaking, and **a package index import drags every module's polyfills in**: use a narrow entry;
  - exclusion patterns must match `esnext.*` names too;
  - TV code keeps `lib: ES2017`.

**core and data**
- `normalizeName`, `hash53` and the key layout are **frozen** (ADR-009). `core` targets ES2017: no `\p{…}`, lookbehind, named groups or `s` flag.
- **Never `await` inside `transact`;** chain requests from callbacks.
- **Database v1 and profile v1 become stored data once a build ships.** Change them only through append-only migrations, with `schema.test.ts` / `profile.test.ts` updated.

**CI, versions, commits**
- CI `media` takes 7–11 min, `verify` about 6, `engines` about 2–3 (its image builds from scratch every run).
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fast-check 4.10, fake-indexeddb 6.2.6, fflate 0.8.3, unrs-resolver 1.12.2 (override).
- **Commits:** scoped `git add`, and a `git commit -F - <<'EOF'` message ending with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line plus the harness's session line.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Leg 11 left one gap there: the "deep imports are a lint error" convention doesn't mention `@zoma/data`'s three extra entries. `eslint.config.js` and `docs/runbooks/tv-build.md` document them.

## The 3 riskiest changes in PR #10
1. **The hello screen now starts the data workers at every launch:** the query worker plus a prune ingest worker (125 KB of Blob-worker code to parse).
   - It also accepts `?source=` in TV builds. Packaged TV apps get no query string, so that path is inert there until onboarding replaces it.
   - The start-up cost on a 2018 TV is unmeasured (S6).
2. **`@zoma/data` has three new entry points** (`client`, `query.worker`, `ingest.worker`), and the boundary lint allows them.
   - `ui` may still import only through the element rules, but it could now reach the worker entries.
3. **The `esnext.json.parse` exclusion applies to every TV bundle.**
   - `JSON.parse` source-text access (ES2026) is gone; native `JSON.parse` is used.
   - It is safe under `lib: ES2017`, and `bundle.test.ts` pins it. The engines harness stayed green on 53/56/68.

## Verified vs not
- **Verified:**
  - local `pnpm verify` (864 tests, e2e 6/6) and `pnpm verify:engines --self-test` (24/24; the data workers ingest and search in 53/56/68);
  - CI green on `7f05082`, merged as `765a7cc`;
  - 9/9 `DataEngine` mutants caught;
  - the fixture responder probed directly (CORS, 204/404/405, traversal refused);
  - a 1920x1080 screenshot of the built webOS bundle after a mock refresh: the three panels fit.
- **Not done:**
  - CI on `main` at `765a7cc` had not finished at handover;
  - Omar's "press these keys" check in `pnpm dev` (below) is still to do;
  - no TV involved (S1/S6/S7 still need hardware).
- **Migrations and deploys:** N/A (no backend until step 29; the TV "deploy" is a store submission).

## Press these keys (Omar, desktop, step 8b)
1. Start the mock and the dev app in two terminals: `pnpm mock --host 127.0.0.1`, then `pnpm dev`.
2. Open `http://localhost:5173/?q=sports&source=http://127.0.0.1:8080/get.php?username=zoma&password=zoma-test&type=m3u_plus`. The Catalog panel should show:
   - Data workers: `ok: 1 source, 25 items`;
   - Refresh: `ok: committed gen 1, 25 items (live 12, movie 6, series 7)`;
   - Search: `ok: 2 for "sports": Zoma Sports Test HD, Zoma Sports Test FHD`.
3. Press **F5**. Refresh now says `ok: unchanged gen 1` (the mock answered 304).
4. Press **↓** a few times. Remote shows `busy (refresh paused)`, then `idle` about 1 s after the last key.
5. Open `http://localhost:5173/?q=اخبار` (no source). It searches the stored catalog and finds `قناة الاختبار الإخبارية`.
6. Optional, to see a pause on a big refresh:
   - run `pnpm fixtures`, then restart the mock with `--catalog .cache/fixtures/catalog.json`;
   - open the step-2 URL with `force=1&` before `source=`;
   - hold **↓** while Refresh shows `running: … KB`. The count stops while you hold it and resumes about 1 s after you let go.

## Open decisions and gates (none block step 9)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).
- **Relay cap:** this run's cap is 40 legs; leg 11 was the 11th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- Background watchers were killed for low memory in legs 8 and 9. Closing idle Cursor tabs, or Docker when no engines run is due, may help.
- No secrets have been shared, so nothing needs rotating.
