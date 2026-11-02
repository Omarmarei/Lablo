# Zoma IPTV: relay leg 11 opening prompt

You are leg 11 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Legs 1–5 did steps 1–4 (PRs #1–#5). Leg 6 did no project work.
- Leg 7 did step 5 (PR #6), leg 8 step 6 (PR #7), leg 9 step 7 (PR #8).
- **Leg 10 did step 8: `data`, part 2** (the ingest pipeline). Its PR is **#9**, with commits `88dcce6` (fflate dependency) and `38d9e64` (feature, RELAY tick).
  - **PR #9 is merged** as merge commit `2c8e573` (the branch was kept).
  - All three CI jobs (`verify`, `engines`, `media`) were green on its head `38d9e64`. CI on `main` at `2c8e573` was still running at handover.
  - Leg 10 split the rest of 3.4 into a new **step 8b**, which is yours.

**Your step is step 8b: app wiring, and the data workers on real old engines.**
- `apps/tv` starts the query worker once and an ingest worker per refresh, through `?worker` imports. The TV build inlines both; check the main budget with them included (500 KB).
- Wire the hello screen, or a small debug screen, to:
  - run `prune` at start;
  - ingest a playlist from a `?source=` URL in dev (the mock's `get.php`);
  - forward the ingest worker's `swapped` event to the query worker's `reload`;
  - send `setBusy` from the remote-key handler.
- Extend `tools/engines` so the boot check also runs both data workers in Chromium 53, 56 and 68 under Docker:
  - Blob worker + IndexedDB, with the ingest reading either a `file://` playlist fixture staged with the app or an HTTP server in the container;
  - then a search through the query worker.
  - This is spike S1's check for the data layer.

**Done when:** `pnpm verify:engines --self-test` shows the data workers ingesting and searching in all three engines, and `pnpm verify` is green. It is a UI-touching step, so end with a short "press these keys" checklist for Omar (`pnpm dev`).

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Start in your first turn.

**First, check `main`:** run `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `2c8e573` (PR #9's merge) should be green in all three jobs. If a job is red, fix it on the relay branch before anything else.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree is your isolation: edit it by path, with `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths and Read/Edit/Write. `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) allows the worktree and gh, git, pnpm, node, docker, curl and bash.

## Read first, in this order
1. **`CLAUDE.md`:** the conventions, the Chromium 53 cheat sheet, package boundaries, Definition of Done, merge policy and commit format.
2. **`RELAY.md`:** step 8 (ticked, with what was built) and step 8b; the leg-10 progress-log row.
3. **`docs/architecture.md`:**
   - §1.4 step 10's "Built in step 8" note: the whole ingest design in one place;
   - §1.2 (workers) and §5 (S1, and the old-engine finding on Blob-worker IndexedDB on `file://`).
4. **`docs/runbooks/old-engines.md`** (how the harness stages apps, runs Docker and talks CDP) and **`docs/runbooks/tv-build.md`**, including the new "Polyfills left out" item.
5. **Code:**
   - `packages/data/src/ingest-service.ts`, `ingest.worker.ts`, `query.worker.ts`, `client.ts` (`createDataClient`, `createIngestClient`), `bytes.ts` (`fetchTransport`);
   - `apps/tv/src/App.tsx`, `hello-worker.ts`, `workers/hello.worker.ts`, `env.d.ts` (the `?worker` declaration);
   - `tools/engines/verify-engines.ts` and its page checks.
6. **Templates:** `test/ingest-worker-bundle.test.ts` and `test/query-worker-bundle.test.ts` run each bundled worker in a Node `vm` realm that stands in for Chromium 53 (ES2017 APIs deleted, no DecompressionStream). Copy them for any new worker test.
7. **`docs/PLAN.md`** wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone (its local `main` is behind).
- **Branch:** HEAD is the commit that adds this `HANDOVER.md` and records PR #9's merge in RELAY.md, on top of `38d9e64` (step 8 feature) and `88dcce6` (fflate). It is pushed, and the worktree is clean.
- **Gitignored but present:**
  - `node_modules`, now with `fflate` 0.8.3, a dependency of `data`;
  - `.cache/media`, `.cache/fixtures` (200k catalog, XMLTV) and `.cache/engines` (Chromium snapshots);
  - Playwright `chromium-1248`;
  - `artifacts/`: `mutate8.py` (this leg's mutation runner; multi-line strings via `NL = chr(10)`), `make-size-probe.py` (generates a per-module bundle-size probe; see Gotchas), `verify.log`, `engines.log`.
- **Local gates on `38d9e64`:**
  - `pnpm verify` green: 839 tests; main bundle 113.6 KB, ingest worker 128.8 KB, query worker 75.8 KB; e2e 5/5;
  - `pnpm verify:engines --self-test` green: 24 runs on Chromium 53/56/68, 16 seeded failures caught;
  - `test/ingest-200k.media.test.ts` green locally (about 2.6 s per 200k ingest).
- **Docker Desktop was running** this leg.

## What step 8 added (use it, don't rebuild it)
- **`runIngest(job, { db, transport, token, throttle, now, gunzip, chunkSize, onProgress, onSwap })`** → `IngestResult`.
  - `job`: `{ src, source: { type: 'm3u', url } | { type: 'xtream', account, kinds?, liveExt? }, force? }`.
  - `IngestResult`: `{ status: 'committed' | 'unchanged', gen, previous, counts, fetch, gzipped, m3u, xtream, favourites, favouritesError, throttle }`.
  - Errors are `IngestError` (codes `http`, `auth`, `network`, `format`, `empty`, `superseded`) or `CancelError`.
  - It prunes the source's leftovers first, and only one refresh per source may run at a time.
- **`IngestService` handlers:**
  - `run({ job, lowTier?, duty? })`, with events `progress` and `swapped`;
  - `setBusy({ busy })`;
  - `prune()`: every source, at app start.
- **`ingest.worker.ts`** serves them with `fetchTransport()` and `openDatabase(indexedDB)`. **`createIngestClient(worker)`** is typed with `IngestEvents`.
- **Bytes and gunzip:**
  - `ByteTransport`/`ByteResponse`, `fetchTransport(fetchFn?)`, `NetworkError`, `Fnv1a`, `decodeUtf8`, `tapBytes`;
  - `MaybeGunzip(source, 'auto' | 'native' | 'fflate')`.
- **`Throttle`:** `setBusy`, `checkpoint(token)`, `duty` (`LOW_TIER_DUTY` = 50/50), busy expiry after 15 s.
- **Favourites:**
  - `reconcileFavourites`, `FavouriteMatcher`, `MISSING_KEEP_MS` (30 days);
  - `updateProfile(db, fn)`: a read-modify-write in one transaction;
  - `FavouriteRef` gained the optional `group` and `epgId`.
- **`SourceMeta`** gained the optional `fetch` (`FetchStamp`), `checkedAt` and `server`.
- **`catalog-store`** gained `getSource`, `markChecked` and `abandonGeneration`. `commitGeneration` takes a `patch`.
- **Mock:** `get.php` sends an `ETag` and answers 304 to `If-None-Match`.
- **TV build** (`tools/build/src/bundle.ts`): `UNUSED_POLYFILLS` (preset-env `exclude`) and `POLYFILL_FREE_DEPENDENCIES` (fflate).
  - `bundle.test.ts` pins that every package and `apps/tv` compile against `lib: ES2017`, which is what makes the exclusion safe.
- **Test helpers:**
  - `fakeTransport` in `packages/data/src/test-support.ts`, with `failAfter` and `beforeChunk`;
  - `test/ingest-mock.test.ts` shows the real fetch transport against the in-process mock.

## Step 8b: suggested approach
1. **Check first:** `git log`, and grep `apps/tv` and `tools/engines` for `query.worker`, `ingest.worker` and `createDataClient`. Nothing is wired yet.
2. **Worker imports:** in `apps/tv`, `import QueryWorker from '@zoma/data/…?worker'` may not resolve, because deep imports are a lint error and `exports` points only at `src/index.ts`. Options:
   - a small `apps/tv/src/workers/query.worker.ts` that imports from `@zoma/data` and calls the service (copy `packages/data/src/query.worker.ts`);
   - or add `./query.worker` and `./ingest.worker` entries to `packages/data/package.json` `exports` and allow them in the boundary lint.

   Check how `bundle.ts`'s `inlineWorkers` resolves `?worker`, and how Vite dev resolves it.
3. **Budget:** the main bundle includes the inlined workers. Today that is about 114 + 76 + 129 KB, about 320 KB of 500 KB.
4. **The engines harness** runs the built app from `file://` with `--allow-file-access-from-files`.
   - Stage a small M3U fixture next to the app and ingest it with a `file://` URL. Chromium 53's `fetch` of `file://` may not work: try it, and fall back to XHR in a transport or to an HTTP server in the container.
   - Have the page report the result in the DOM, where the harness's CDP checks read it.
5. **CPU throttle:** remote keys must still move focus fast while an ingest runs (S6 is < 200 ms per key). A harness check with `setBusy` while ingesting is a bonus, not a requirement.
6. **Finish:**
   - tick the step, add a progress-log row, push;
   - `gh pr create --base main`, wait for **all three** CI jobs (Monitor tool, as below), then `gh pr merge <n> --merge`;
   - list the 3 riskiest changes in your handover.

## Gotchas and lessons (legs 1–10)
**Shell and tools**
- The Bash cwd resets after a `cd`; use absolute paths.
- **Never put backslash escapes in a Bash heredoc:**
  - leg 10 again: a python heredoc's `\\n` became a real newline and broke the script;
  - write scripts with the Write tool and build newlines with `chr(10)` and backslashes with `chr(92)`, or use Edit;
  - the Write tool turns `\uFEFF` and `\u2028` in string literals into raw characters; use `String.fromCharCode`.
- **CI waits:** use the **Monitor tool** with a loop over `gh pr checks <n>` that prints each finished job and exits when none is pending (timeout 30 min). Wait about 20 s after `gh pr create`.
  - Background `--watch` processes were killed under memory pressure in legs 8 and 9; the Monitor loop worked in legs 9 and 10.
- **Measuring a bundle:** run `python artifacts/make-size-probe.py`. It writes `tools/build/src/zz-sizes-probe.ts`, a copy of `bundle.ts` that logs every module's `renderedLength`.
  - Run it with `npx tsx tools/build/src/zz-sizes-probe.ts <worker-basename>` from the worktree root, then delete it. It must sit in `tools/build/src` so the Rollup plugins resolve.
- **Mutation runs:** `artifacts/mutate8.py "<snippet>"` reruns one mutant. Each has a 180 s timeout; if a run is killed, restore the file from its `.bak`.
- **Smart App Control is ON** (Omar's choice). "An Application Control policy has blocked this file" means a too-new native binary was blocked: pin an older version or use pure JS. Never turn SAC off or weaken lint.
- **pnpm 11:** after a `package.json` dependency edit, run `pnpm install --config.optimistic-repeat-install=false`. New dependencies must be at least 2 weeks old (`npm view <pkg> time`).

**Repo layout and tests**
- Package tsconfigs include only `src`, so package tests go in `src/`. Root `test/` (outside the boundary lint) holds tests that combine `@zoma/data` with `tools/*` or the mock.
- **fake-indexeddb:** `freshFactory()` gives each test its own database. Simulate a worker crash with `db.close()` inside `fakeTransport`'s `beforeChunk`, then reopen from the same factory.
- **`vm` realm workers:**
  - put `postMessage`/`addEventListener` on the context, and run `var self = globalThis` first (core-js's `self` polyfill);
  - pass `fetch`, `TextDecoder`, `IDBKeyRange` and `indexedDB` in, because a vm context has only ECMAScript built-ins.
- **Search oracles:** query words are ANDed as substrings (`'channel 42'` matches `'Channel 1042'`).
- **Mock tests:** never build URLs from `base` at module level (it's set in `beforeAll`). Change the catalog with `app.mockState.catalog = …`, and reset it in `beforeEach`.
- **`verify:engines` flake:** the first run after Docker starts can time out on chrome53 ("DevTools on port … did not answer within 60000 ms") before any app result. Retry once, with nothing heavy running.
- **Polyfills:**
  - Babel's usage detection can't see types, and injects per file before tree-shaking;
  - before raising a budget, measure, and extend `UNUSED_POLYFILLS` / `POLYFILL_FREE_DEPENDENCIES` with a test;
  - TV code must keep `lib: ES2017`.

**core and data**
- `normalizeName`, `hash53` and the key layout are **frozen** (ADR-009). `core` targets ES2017: no `\p{…}`, lookbehind, named groups or `s` flag.
- **Never `await` inside `transact`;** chain requests from callbacks. Throwing inside `onSuccess` aborts the transaction.
- **Database v1 and profile v1 become stored data once a build ships.** Change them only through append-only migrations, with `schema.test.ts` / `profile.test.ts` updated.

**CI, versions, commits**
- CI `media` takes 7–11 min.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fast-check 4.10, fake-indexeddb 6.2.6, fflate 0.8.3, unrs-resolver 1.12.2 (override).
- **Commits:** scoped `git add`, and a `git commit -F - <<'EOF'` message ending with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line plus the harness's session line.
- **Cross-session messages:** edits to CLAUDE.md need Omar's direct word in your own tab.

## The 3 riskiest changes in PR #9
1. **The polyfill exclusion applies to every TV bundle.**
   - Code that later calls an excluded API (iterator helpers, Set methods, `Uint8Array` base64, `toSorted`, error cause…) breaks on old TVs at runtime.
   - TypeScript `lib: ES2017` rejects those calls, and `bundle.test.ts` pins that lib for every TV package. The engines harness stayed green on 53/56/68.
2. **Favourite matching decides whether a favourite follows its channel or turns "unavailable".**
   - Name first, then narrowed by tvg-id and group; then the tvg-id alone; never between items it can't tell apart; drop after 30 days.
   - `FavouriteRef` gained the optional `group`/`epgId`. That is no migration, because profile v1 hasn't shipped.
3. **The data workers have still not run in real Chromium 53/56 or on a TV.**
   - Only the Node `vm` realm has run them. Step 8b is the first real run, and Blob-worker IndexedDB on the TVs is still spike S1.

## Verified vs not
- **Verified:**
  - local `pnpm verify` (839 tests) and `pnpm verify:engines --self-test`;
  - CI `verify`, `engines` and `media` green on `38d9e64`, merged as `2c8e573`;
  - crash-mid-ingest and renumbered-refresh tests;
  - 19/19 mutants caught;
  - the bundled ingest worker against the mock with ES2017 APIs and DecompressionStream removed;
  - the 200k playlist ingest (about 2.6 s in Node with fake-indexeddb).
- **Not done:**
  - CI on `main` at `2c8e573` had not finished at handover;
  - the app doesn't start the data workers yet (step 8b);
  - no TV involved.
- **Migrations and deploys:** N/A (no backend until step 29; the TV "deploy" is a store submission).

## Open decisions and gates (none block step 8b)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).
- **Relay cap:** leg 10 was the 10th leg of this run's cap. The watcher pauses until Omar runs `/relay continue iptv-20261101-214120`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- Background watchers were killed for low memory in legs 8 and 9. Closing idle Cursor tabs, or Docker when no engines run is due, may help.
- No secrets have been shared, so nothing needs rotating.
