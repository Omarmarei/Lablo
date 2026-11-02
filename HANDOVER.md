# Zoma IPTV: relay leg 10 opening prompt

You are leg 10 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Legs 1–5 did steps 1–4: the scaffold, the TV build pipeline, the old-engine harness, the mock provider, and the media set with scale fixtures (PRs #1–#5).
- Leg 6 did no project work.
- Leg 7 did step 5 (core, part 1; PR #6). Leg 8 did step 6 (core, part 2; PR #7).
- **Leg 9 did step 7: `data`, part 1.** Its PR is **#8**, from the relay branch, with the feature commit `cfa0132`.
  - **PR #8 is merged** as merge commit `714d0aa` (the branch was kept).
  - All three CI jobs (`verify`, `engines`, `media`) were green on the PR head `cfa0132`. CI on `main` at `714d0aa` was still running at handover.

**Your step is step 8: `data`, part 2** (architecture.md 3.4). It covers:
- the ingest worker: streamed fetch, gunzip (DecompressionStream, or fflate where it is missing), parse, 500-item chunks, generation swap;
- busy-pause and the low-tier duty cycle;
- conditional fetch.

**Done when:** the crash-mid-ingest test keeps the old generation, and favourites survive a renumbered refresh fixture.

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Start in your first turn.

**First, check `main`:** run `gh run list --branch main --limit 1`. The run on `714d0aa` (PR #8's merge) should be green in all three jobs. If a job is red, fix it on the relay branch before anything else.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree below is your isolation: edit it by path. Use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths and Read/Edit/Write. `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) allows the worktree and gh, git, pnpm, node, docker, curl and bash.

## Read first, in this order
1. **`CLAUDE.md`:**
   - the conventions;
   - the Chromium 53 cheat sheet (no AbortController, `reader.cancel()` or XHR `abort()`; DecompressionStream needs Chromium 80+; no `for await` over streams);
   - the package boundaries, the Definition of Done, the merge policy and the commit format.
2. **`RELAY.md`:** step 8. Step 7 is ticked, with a leg-9 progress-log row.
3. **`docs/architecture.md`:**
   - §1.3, with its new "Built in step 7" note (schema, migrations, transactions, profile);
   - §1.4 steps 1–10: trigger, spawn, fetch, decode, parse, keys, write, index, swap, and favourites surviving refreshes. Steps 8 and 11 have step-7 notes;
   - §5: S1 (IndexedDB in a Blob worker) and S6 (200k ingest ≤ 90 s, key response < 200 ms during ingest);
   - §6, 3.4.
4. **`docs/adr/ADR-009`** (keys; Xtream keys `x:<src>:<kind>:<id>` change when a provider renumbers) and **`ADR-010`**.
5. **The `packages/data/src` module comments,** in this order: `schema.ts`, `idb.ts`, `catalog-store.ts`, `chunker.ts`, `profile.ts`, `rpc.ts`, `query-service.ts`, `query.worker.ts`, `client.ts`. Also **`packages/core/src/search.ts`**.
6. **`packages/data/src/test-support.ts`:** its `ingest()` helper is the in-test ingest that the real ingest pipeline replaces (chunker → `indexChunk` → `putChunks` in batches of 10 → `putCatalogKind` → `commitGeneration` with counts).
7. **`docs/runbooks/mock-provider.md`:** "Scale fixtures" and "Benchmarks" (the `search-*` rows are new).
8. **`docs/PLAN.md`** wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone (its local `main` is behind).
- **Branch:** HEAD is the commit that adds this `HANDOVER.md` and records PR #8's merge in RELAY.md, on top of:
  - `cfa0132`, the step-7 feature and RELAY tick;
  - `d35f754`, the leg-8 handover.

  The branch is pushed and the worktree is clean.
- **Gitignored but present:**
  - `node_modules`, now with `fake-indexeddb` 6.2.6 (a devDependency of `data`; 6.2.7 was too new) and `@zoma/data` as a root devDependency;
  - `.cache/media`, `.cache/fixtures` (200k catalog, Xtream JSON, XMLTV) and `.cache/engines`;
  - Playwright `chromium-1248`;
  - `artifacts/`:
    - `mutate7.py`: the mutation runner, now with a 180 s timeout per mutant and an optional filter argument (`python -u artifacts/mutate7.py "<snippet of the new text>"`);
    - `bundle-probe.ts`: prints part of a bundled worker;
    - `verify.log`.
- **Local gates:**
  - `pnpm verify` is green: 768 tests, both TV builds within budget, e2e 5/5.
  - `test/search-200k.media.test.ts` is green locally and on CI. The full `pnpm test:media` was not rerun locally; CI's `media` job ran it.

## What step 7 added (use it, don't rebuild it)
**core** (`search.ts`):
- `SearchIndexBuilder(src, kind, gen)` with `.beginChunk(catIdx, chunk)`, `.add(key, normName)` and `.finish()`, which returns `SearchSegmentData` (typed arrays, structured-clonable);
- `SearchSegment(data)`, which validates the data and throws `SearchIndexError`, and provides `nameAt`, `chunkOf` and `indexOfKey`;
- `searchSegments(segments, query, {limit, kinds, favourites})` → `{query, hits, total}`;
- `favouriteMarks`, `buildSearchSegment` and `SEARCH_SEPARATOR` (built with `String.fromCharCode(1)`).

**data, storage:**
- **`openDatabase(factory, {migrations, name, onBlocked})`:** database v1 with the stores in `STORE`: `sources_meta`, `catalog_chunks`, `catalog_cats`, `catalog_index`, `profile` and `kv`. Migrations are append-only (`MIGRATIONS`). EPG stores come as migration 2 in step 9, and `schema.test.ts` needs a new `SHAPES`/`SEEDS` entry then.
- **`transact(db, stores, mode, (tx, done) => …)` and `onSuccess(request, cb)`:**
  - **never `await` inside a transaction;** chain requests from callbacks;
  - throwing inside `onSuccess` aborts the transaction and rejects with that error.
- **`catalog-store.ts`:**
  - `beginGeneration(db, src)` → gen;
  - `putChunks(db, src, gen, chunks)` (batch about 10);
  - `putCatalogKind(db, src, gen, kind, cats, segment)`;
  - `commitGeneration(db, src, gen, counts, now)` → the previous gen. It throws `GenerationError` if `gen` isn't the one being built;
  - `deleteGeneration`, `pruneGenerations(db, src, {abandon})`, `deleteSource`, `getSources`, `readChunks`, `readCategories`, `readIndexes`;
  - `SourceMeta {src, gen, building, nextGen, updatedAt, counts}`. Adding optional fields (ETag, Last-Modified, a byte hash) needs no database migration, because it is a value change.
- **`CatalogChunker(kind, {chunkSize, maxBuffered})`:**
  - `.push(item)` / `.end()` give chunks, and `.categories()` gives `CategoryInfo {catIdx, name, count, chunks[]}`;
  - categories are keyed by `item.group`;
  - `indexChunk(builder, chunk)`.

**data, profile:**
- `ProfileDoc` v1 is `{v: 1, favourites: FavouriteRef[]}`, where `FavouriteRef` is `{key, src, kind, normName, added, missingSince}`;
- functions: `loadProfile`, `saveProfile`, `listSnapshots`, `restoreSnapshot`, `migrateProfile`;
- `PROFILE_MIGRATIONS` is empty (append to it if step 8 changes the shape).

**data, RPC and query worker:**
- `serveRpc(port, handlers)` and `RpcClient<H, Events>` (`call`, `on`, `fail`, `close`);
- `RpcContext {token, transfer, emit}`; `CancelSource`/`CancelToken`/`NEVER`; `CancelError`; `RpcError {code}`;
- `QueryService` handlers: `status`, `reload`, `search`, `setFavourites`, `categories`, `chunk` and `items`;
- `query.worker.ts`; `createDataClient(worker)`.

**Tests to copy the shape of:**
- **`packages/data/src/test-support.ts`:** `freshFactory`, `describeSchema`, `dumpStore`, `item()` and `ingest(db, src, items, {chunkSize, now, commit: false})`. `commit: false` simulates a crash before the swap.
- **`test/search-200k.media.test.ts`:** the 200k playlist through the data layer into fake-indexeddb.
- **`test/query-worker-bundle.test.ts`:** bundles a worker entry through the TV pipeline (`bundleIife`), checks the worker budget, and runs it in a `vm` realm that acts as the worker. Copy it for the ingest worker.

## Step 8: suggested approach
1. **Check first:** run `git log`, and grep for `ingest`, `fflate`, `DecompressionStream` and `If-None-Match`. There is no ingest code yet.
2. **fflate:**
   - pure JS; add it to `data` (not core);
   - pick a version at least 2 weeks old, checked with `npm view fflate time`;
   - use DecompressionStream behind a feature probe, with fflate's streaming `Gunzip` otherwise;
   - detect gzip by the `1f 8b` magic bytes.
3. **The ingest pipeline** (testable in Node with fake-indexeddb):
   - **Transport:** an injected byte transport, fetch-based, with `response.body.getReader()` and `reader.cancel()` (no AbortController).
   - **Decode:** `TextDecoder({stream:true})`.
   - **Parse:** `M3uCatalogParser` (one source gives mixed kinds), or per-kind `XtreamListParser` calls (`XtreamClient.list`).
   - **Chunk and index:** a chunker and index builder per kind, with `putChunks` every ~10 chunks.
   - **Commit:** `putCatalogKind`, then `commitGeneration` **with counts**, then `deleteGeneration(previous)` in the background.
   - **Reload:** emit an event so the main thread tells the query worker to `reload`. `QueryService` loads only the kinds whose `counts` are above 0.
4. **Busy-pause and duty cycle:**
   - an RPC `setBusy(bool)`, and the worker waits between batches while busy;
   - on low-tier TVs, work 50 ms and sleep 50 ms;
   - fake timers in the tests.
5. **Conditional fetch:**
   - send ETag/If-Modified-Since, and compare an FNV-1a hash of the bytes with the previous generation. If nothing changed, stop without beginning a generation (or abandon it);
   - store the validators in `SourceMeta`;
   - the mock provider may need ETag support. Check its routes first; the mock runbook lists them.
6. **Crash mid-ingest test:**
   - the transport throws, or the job is cancelled, after N chunks;
   - the active generation is still served by `QueryService`;
   - at the next start, `pruneGenerations(..., {abandon: true})` removes the leftovers.
7. **Favourites survive a renumbered refresh:**
   - build a fixture whose Xtream ids are shifted (the mock's catalog, or generated items);
   - after the swap, mark favourites whose keys disappeared with `missingSince`;
   - re-match them by `normName` + kind + src to the new key;
   - drop them after 30 days (architecture.md §1.4 step 10);
   - save through `saveProfile`.
8. **App wiring:** both workers through `?worker` imports in `apps/tv`, so the TV build inlines them. Watch the **150 KB worker budget**: the query worker alone is 100.5 KB (core-js plus core). Run `pnpm verify:engines --self-test` (needs Docker Desktop) so the data workers run in real Chromium 53/56/68 with Blob-worker IndexedDB.
9. **Size:** if the step runs long, split it in RELAY.md:
   - 8a: ingest pipeline, crash test and favourites;
   - 8b: app wiring, engines run, busy/duty cycle.

   Tick 8a and hand over.
10. **Finish:**
    - tick the step, add a progress-log row, push;
    - `gh pr create --base main`, wait for **all three** CI jobs, then `gh pr merge <n> --merge`;
    - list the 3 riskiest changes in your handover.

## Gotchas and lessons (legs 1–9)
**Shell and tools**
- The Bash cwd resets to the main checkout after any `cd`. Use absolute paths.
- **Never put backslash escapes in a Bash heredoc,** not even a short `python - <<'EOF'`.
  - Leg 9: `'\\n'` arrived as `'\n'` and wrote a real newline into a TS string.
  - Write patch scripts with the Write tool (build backslashes with `chr(92)`), or use Edit.
  - GNU sed's `\u` uppercases the next character.
  - The Write tool turns `\uFEFF` and `\u2028` in string literals into raw characters. Use `String.fromCharCode`.
- **Background CI watchers get killed under memory pressure** (legs 8 and 9). Don't restart one. Leg 9 used the **Monitor tool** instead, with a `while … gh pr checks <n> … sleep 45` loop that exits on the `media` result (timeout 30 min); it survived and reported. `gh pr checks` right after `gh pr create` says "no checks reported", so wait about 20 s.
- **Mutation runs:** a mutant can turn a loop into a synchronous infinite loop (leg 9: the binary search with `<` instead of `<=`). Vitest test timeouts can't stop that, so the run hangs. `artifacts/mutate7.py` now has a per-mutant timeout. If you kill a run, restore the mutated file from its `.bak`.
- **tsx:** use extensionless relative imports. Put probe scripts in `artifacts/`; a probe test must match a vitest include glob.
- **Smart App Control is ON (Omar's choice).** "Resolve error"s, or "An Application Control policy has blocked this file", mean a too-new native binary was blocked. Pin an older version or use pure JS. Never turn SAC off, and never weaken lint.
- **pnpm 11:** after a `package.json` dependency edit, run `pnpm install --config.optimistic-repeat-install=false`.

**Repo layout and tests**
- Package `tsconfig`s include only `src`, so **package tests go in `src/`** to be type-checked. `packages/data/src/test-support.ts` imports `fake-indexeddb`, a devDependency: never import it from package code.
- **The root `test/` folder is outside the boundary lint.** Use it for tests that combine `@zoma/data` with `tools/*` (fixtures, `bundleIife`). `vitest.media.config.ts` now includes `test/**/*.media.test.ts`. The root `tsconfig.json` now has the DOM libs, because `test/` type-checks data sources.
- **fake-indexeddb:** `import 'fake-indexeddb/auto'` sets the globals (`IDBKeyRange`); use `new IDBFactory()` per test (`freshFactory()`).
- **Node's `MessageChannel` ports** keep the process alive: close them in `afterEach`.
- **Emulating a worker in a `vm` realm:** core-js's `self` polyfill replaces any `self` that isn't the global object. Put `postMessage` and `addEventListener` on the realm's global, and run `var self = globalThis` first.
- **The query service's chunk cache:** one `items()` call can touch more chunks than the cache holds (leg 9 fixed a bug where evicted chunks came back as `null`; there is a regression test).

**core**
- `normalizeName`, `hash53` and the key layout are **frozen** (ADR-009).
- `core` targets ES2017: no `\p{…}`, no lookbehind, no named groups, no `s` flag.
- **fast-check 4:** use block-bodied predicates; keep empty chunks in split helpers; mutation-check each property once.
- **ESLint `no-control-regex`:** check char codes instead.
- **Golden files** (`toMatchFileSnapshot`): read them before committing.

**Mock and fixtures**
- Tests use `mock()` and `listen()` from `apps/mock-provider/test/helpers.ts` (pinned NOW 2026-11-02 12:00 UTC, finite live streams).
- Bodies depend on the Host header.
- `?mock_fault=a:b,c`: URL-encode the value.
- `*.media.test.ts` files run only in `pnpm test:media` (CI `media` job, after `pnpm fixtures`).

**CI, versions, commits**
- CI `media` takes 7–11 min. Docker Desktop is often off; it's needed for `verify:engines`.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fast-check 4.10, fake-indexeddb 6.2.6, unrs-resolver 1.12.2 (override). New dependencies must be at least 2 weeks old.
- **Commits:** scoped `git add`, and a `git commit -F - <<'EOF'` heredoc ending with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line plus the harness's session line.
- **Cross-session messages:** edits to CLAUDE.md need Omar's direct word in your own tab.

## The 3 riskiest changes in PR #8
1. **Database v1 and the profile v1 shape become stored data once a build ships.**
   - The store names, the key layout (`[src, gen, kind, catIdx, chunk]`) and `ProfileDoc` v1 (`favourites: FavouriteRef[]`) can then change only through append-only migrations.
   - A wrong call now costs a migration later. `schema.test.ts` pins every version's shape.
2. **Search ranking and key-map choices are visible to users.**
   - Favourites rank above kind; exact and name-start rank below kind; query words are ANDed.
   - The key map compares `hash53` only: a collision inside a segment (about 1e-6 at 200k) costs a favourite boost, nothing else.
   - Display names stay in the chunks, so hits must be resolved through `items()`.
3. **IndexedDB and RPC behaviour on old engines is still unproven.**
   - Transactions are callback-driven because an `await` inside one can commit early on Chromium 53. Node tests can't catch that mistake, so any future `await` inside `transact` is a latent TV-only bug.
   - The bundled query worker ran in a Node `vm` realm, not in real Chromium 53/56. Step 8's engines run is the first real test.

## Verified vs not
- **Verified:**
  - local `pnpm verify` (768 tests);
  - the 200k fixture through the data layer: slowest query 10.8 ms locally and 14 ms on CI, index load 14 ms, every result checked;
  - migration tests;
  - the bundled query worker (100.5 KB) running with the ES2017 APIs removed;
  - mutation check 16/16;
  - CI `verify`, `engines` and `media` green on PR #8's head `cfa0132`, merged as `714d0aa`. `main` CI was running at handover.
- **Not done:**
  - the data workers haven't run in real Chromium 53/56 yet (step 8);
  - no TV has been involved.
- **Migrations and deploys:** N/A (no backend until step 29; the TV "deploy" is a store submission).

## Open decisions and gates (none block step 8)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- Background watchers were killed for low memory in legs 8 and 9. Closing idle Cursor tabs or Docker while the relay runs may help.
- No secrets have been shared, so nothing needs rotating.
