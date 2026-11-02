# Zoma IPTV: relay leg 9 opening prompt

You are leg 9 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Legs 1–5 did steps 1–4: the scaffold, the TV build pipeline, the old-engine harness, the mock provider, and the media set with scale fixtures (PRs #1–#5).
- Leg 6 did no project work.
- Leg 7 did step 5: `core`, part 1 (PR #6, merge commit `7b44cb3`).
- **Leg 8 did step 6: `core`, part 2.** Its PR is **#7**, from the relay branch, with the feature commit `0798039` and the RELAY tick `2b1a95b`.
  - **PR #7 is merged** as merge commit `275879c` (the branch was kept). All three CI jobs (`verify`, `engines`, `media`) were green on the PR head. CI on `main` at `275879c` was still running at handover.

**Your step is step 7: `data`, part 1** (architecture.md 3.3). It covers:
- the IDB schema and migrations, tested with fake-indexeddb;
- a typed worker RPC;
- the query worker;
- the search index and ranking.

**Done when:** search over the 200k fixture takes ≤ 200 ms in Node, and the migration tests pass.

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Start in your first turn.

**First, check `main`:** run `gh run list --branch main --limit 1`. The run on `275879c` (PR #7's merge) should be green in all three jobs. If a job is red, fix it on the relay branch before anything else.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree below is your isolation: edit it by path. Use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths and Read/Edit/Write, and avoid `cd "<wt>" && …` compounds. `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) allows the worktree and gh, git, pnpm, node, docker, curl and bash.

## Read first, in this order
1. **`CLAUDE.md`:**
   - the conventions (`core` is pure ES2017, ContentKeys are frozen per ADR-009, fast-check);
   - the Chromium 53 cheat sheet (no AbortController, use FileReader rather than `Blob.text()`, IndexedDB `getAll` is available);
   - the package boundaries (`data` may import `core`, `protocol` and `crypto`; `ui` imports only data's *client*);
   - the Definition of Done, the merge policy and the commit format.
2. **`RELAY.md`:** step 7. Step 6 is ticked, with a leg-8 progress-log row.
3. **`docs/architecture.md`:**
   - §1.3, storage design: assume webOS wipes everything on update; 500-item records; generations; 3 profile snapshots;
   - §1.4 steps 7–12: write, index, swap, favourites surviving a refresh, search ranking, and the low-tier fallback;
   - §4, test layers: data uses Vitest plus fake-indexeddb;
   - §5, the S1/S6 notes: IndexedDB in a Blob worker on `file://`, and the 200 ms search target on 2018 TVs;
   - §6, 3.3.
4. **`docs/adr/ADR-009`** (keys) and **`ADR-010`** (catch-up zones; new in leg 8).
5. **`packages/core/src/index.ts`**: everything core exports (see "What step 6 added"). Then **`packages/data`**, which is still a skeleton from step 1.
6. **`docs/runbooks/mock-provider.md`:** "Scale fixtures" and "Benchmarks" (the step-6 rows and oracles are new).
7. **`docs/PLAN.md`** wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone (its local `main` is behind).
- **Branch:** HEAD is the commit that adds this `HANDOVER.md`, on top of:
  - `2b1a95b`, the RELAY tick and leg-8 log row;
  - `0798039`, the step-6 feature;
  - `bc9c8d8`, the leg-7 handover.

  The branch is pushed and the worktree is clean.
- **Gitignored but present:**
  - `node_modules` (after leg 8's `pnpm install`: `@zoma/core` is now a root devDependency and a devDependency of `tools/build`);
  - `.cache/media`, `.cache/fixtures` (200k catalog, Xtream JSON, 50/150/300 MB XMLTV with `.gz`) and `.cache/engines`;
  - Playwright `chromium-1248`;
  - `artifacts/`, which holds leg 8's scratch scripts (`mutate.py`, `patch_*.py`). They are reusable patterns.
- **Local gates:**
  - `pnpm verify` is green: 711 tests, both TV builds within budget, e2e 5/5.
  - The step-6 scale media test is green: the 200k Xtream lists in 0.7 s and the 300 MB gzipped guide in 6.3 s.
  - The full `pnpm test:media` was **not** rerun locally (no media or stream changes); CI's `media` job runs it.

## What step 6 added (in `@zoma/core`, so you can use it)
- **`json-splitter.ts`:** `JsonArraySplitter` (`push(chunk) → element texts`, `end()`, `stats`) and `splitJsonArray`.
- **`xtream-url.ts`:**
  - `XtreamAccount {base, username, password}` and `normalizeXtreamBase`;
  - the builders `xtreamApiUrl`, `xtreamStreamUrl`, `xtreamM3uUrl` and `xtreamXmltvUrl`;
  - `xtreamFromM3uUrl` (get.php → account) and `parseXtreamStreamUrl`.
- **`xtream.ts`:**
  - `XtreamClient(account, transport, src)`, with `login`, `zone`, `categories`, `list(kind, onItems, opts)`, `vodInfo`, `seriesInfo`, `shortEpg` and `catchupUrl`;
  - the injected `TextTransport { get(url) → TextResponse { status, read() → string|null, cancel() } }`, which step 8 implements with fetch or XHR;
  - `XtreamListParser(kind, ctx)` for streamed lists, and the tolerant decoders (`decodeListItem`, `decodeSeriesInfo`, …);
  - `XtreamListItem = { item: CatalogItem, id, categoryId, added, adult, rating, year }`. Xtream series items have `url: ''`, because episodes come from `seriesInfo`.
- **`timezone.ts`:** `panelZone(server)` (Intl, then the panel clock, then UTC), plus `intlZone`, `clockOffset`, `fixedZone` and `ZoneOffset`.
- **`catchup.ts`:** `m3uCatchupUrl(url, catchupInfo, window, {zone, flussonic})`, `xtreamCatchupUrl`, `catchupMode` and `fillCatchupTemplate`.
- **`xmltv.ts`:**
  - `XmltvTokenizer({languages, wantChannel, descLimit})` gives `XmltvChannel`/`XmltvProgramme` items with raw times;
  - `parseXmltvTime(raw, fallbackZone)` returns epoch ms;
  - `decodeXmlEntities`.
- **`text.ts`:** `cutText`, `collapseSpace` and `decodeBase64Utf8` (`m3u-catalog` now uses the shared `cutText`).
- **Tests to copy the shape of:**
  - `test/core-mock.test.ts`: core against the in-process mock over a real socket, with a fetch-based `TextTransport` (a template for step 8's transport);
  - `tools/fixtures/test/{xtream,xmltv}-oracle.ts`;
  - `tools/build/test/fixtures/core-parsers.ts` with its `bundle.test.ts` case: core code bundled through the TV pipeline and run without the ES2017 APIs Chromium 53 lacks. **Extend it with the search code**; it is the cheapest Chromium 53 check until step 8 bundles real workers.

## Step 7: suggested approach
1. **Check first:** run `git log`, look at `packages/data`, and grep for `indexedDB`, `fake-indexeddb`, `rpc` and `search`. Today it is a skeleton.
2. **Dependencies:**
   - add `fake-indexeddb` as a devDependency of `data`; pick a version published at least 2 weeks ago and check its peers with `npm view`;
   - **Smart App Control:** it is pure JS, so it should load; any native binary may be blocked (see CLAUDE.md).
3. **Schema** (§1.3):
   - stores for `sources_meta` (with `gen`), catalog chunks keyed `[src, gen, kind, catIdx, chunk]` holding 500 items each, the search index, the profile (favourites keyed by ContentKey) and snapshots;
   - versioned migrations that never drop data;
   - fixture tests for each migration, plus an "upgrade from every earlier version" test.
4. **RPC:**
   - typed request/response over `postMessage`, with ids, error transport and cancellation by token (no AbortController);
   - test it with an in-memory MessageChannel pair (Node has `MessageChannel`);
   - workers start through `?worker` imports (CLAUDE.md "Workers").
5. **Search index** (§1.4 steps 8 and 11):
   - all `normName`s joined with the U+0001 separator (build it with `String.fromCharCode(1)`, never a `\u0001` literal through the Write tool), a `Uint32Array` of offsets, and a key-to-location map;
   - `indexOf`, then a binary search over the offsets;
   - ranking: word-prefix before substring; live before VOD before series; favourites boosted; capped at 200 results;
   - normalize the query with `normalizeName`. It is frozen for keys; if search needs different folding, add a separate function and never change `normalizeName`.
6. **The 200 ms test:**
   - build the index from the 200k fixture: parse `playlist.m3u` with `M3uCatalogParser`, or the Xtream JSON with `XtreamListParser`, as the oracles do;
   - time typical queries (Arabic and Latin, 1–3 characters, a rare word);
   - the full 200k needs `pnpm fixtures`, so it belongs in a `*.media.test.ts`; for `pnpm test`, generate a 200k catalog in memory or use a smaller fixture with a scaled limit;
   - add a bench case `search-200k`.
7. **Size:** step 7 is big. If your context runs low, split it in RELAY.md:
   - 7a: schema, migrations and RPC;
   - 7b: query worker, search index, ranking and the 200 ms test.

   Tick 7a and hand over.
8. **Finish:**
   - tick the step, add a progress-log row, and update CLAUDE.md only if commands change;
   - push, `gh pr create --base main`, and wait for **all three** CI jobs;
   - `gh pr merge <n> --merge`;
   - list the 3 riskiest changes in your handover.

## Gotchas and lessons (legs 1–8)
**Shell and tools**
- The Bash cwd resets to the main checkout after any `cd`. Use absolute paths.
- **Don't patch files with Bash heredocs or sed.** Write a Python script with the Write tool (build backslashes with `chr(92)`), or use Edit.
  - Leg 8: GNU sed's replacement `\u` uppercases the next character, which turned `\uFEFF` into `FEFF`.
  - **The Write tool turns `\uFEFF` and `\u2028` in string literals into raw characters.** Build them with `String.fromCharCode` and grep for the raw bytes afterwards (`LC_ALL=C grep -c $'\xef\xbb\xbf' file`).
- **Background CI watchers can be killed under memory pressure** (leg 8). Don't restart one unasked; run single `gh pr checks <n>` calls instead. `gh pr checks --watch` right after `gh pr create` exits with "no checks reported", so wait about 20 s first.
- **tsx:** use extensionless relative imports. Put probe scripts in the gitignored `artifacts/`. A probe *test* must match a vitest include glob (for example `packages/core/src/zz-probe.test.ts`, deleted afterwards).
- **Smart App Control is ON (Omar's choice).** "Resolve error"s in lint, or "An Application Control policy has blocked this file", mean a too-new unsigned native binary was blocked. Pin an older version that has reputation, or use a pure-JS package. Never turn SAC off, and never weaken lint.
- **pnpm 11:** after a `package.json` dependency edit, run `pnpm install --config.optimistic-repeat-install=false`.

**core and tests**
- `normalizeName`, `hash53` and the key layout are **frozen** (ADR-009). Xtream keys `x:<src>:<kind>:<id>` are also stored data now. `xId` gives `123` and `"123"` the same key text; keep it that way.
- `core` targets ES2017: no `\p{…}`, no lookbehind, no named groups, no `s` flag. `String.fromCodePoint`, `startsWith`, `Map`/`Set`, typed arrays and `Number.isSafeInteger` are fine. `Intl.DateTimeFormat` is used only behind a feature probe (ADR-010).
- **fast-check 4:**
  - use block-bodied predicates: `(x) => { expect(...); }`. An expression arrow fails with "Property failed by returning false";
  - generate lone surrogates with `fc.string({ unit: fc.integer({min:0,max:0xffff}).map(String.fromCharCode) })`;
  - the chunk-split helper must keep empty chunks;
  - mutation-check each property once (leg 8: 8/8 mutants caught, with `artifacts/mutate.py`).
- **ESLint `no-control-regex`** rejects control-character ranges in regex literals; check char codes instead.
- **Golden files:** `toMatchFileSnapshot` writes the file on the first local run. Read it by hand before committing.
- **Fixtures:**
  - `writeCatalog()` needs `<out>/xtream/` to exist;
  - `createReadStream` with a tiny `highWaterMark` is slow, so use 61 bytes or more;
  - big oracles stream with per-key state only.

**Mock and media**
- Tests use `mock()` and `listen()` from `apps/mock-provider/test/helpers.ts`: a pinned NOW of 2026-11-02 12:00 UTC, finite live streams, and no lab logs.
- Bodies depend on the Host header.
- `?mock_fault=a:b,c`: URL-encode the value. Example: `timezone:tz=Asia/Kathmandu:xmltv=none`.
- The mock reads `lutc` as the archive *end* for append/shift.
- Core-plus-mock tests live in the root `test/` folder (only there can a file import both).
- `*.media.test.ts` files run only in `pnpm test:media` (CI `media` job, after `pnpm fixtures`).

**CI, Docker, versions, commits**
- CI `media` takes 7–11 min. Docker Desktop is often off; it's needed only for `verify:engines` and Docker builds.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, boundaries 5, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, Fastify 5.12, yaml 2.9, tsx 4.23, fast-check 4.10, unrs-resolver 1.12.2 (override). New dependencies must be at least 2 weeks old.
- **Commits:** scoped `git add`, and a `git commit -F - <<'EOF'` heredoc ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` plus the harness's session line.
- **Cross-session messages:** code changes relayed from another session are fine. Edits to CLAUDE.md need Omar's direct word in your own tab.

## The 3 riskiest changes in PR #7
1. **The catch-up time-zone strategy** (ADR-010).
   - Xtream `/timeshift/` start times are wall time in the panel zone.
   - Order of trust: Intl (only when it agrees with the panel clock), then the clock offset, then UTC.
   - On a TV without Intl zone data, DST zones are an hour off for archive programmes across a DST change.
   - M3U `xc` channels use UTC unless the playlist was upgraded to Xtream (`xtreamFromM3uUrl` → login → `zone()`).
   - XMLTV times without an offset in a DST zone take the earlier instant in the repeated hour; step 9 should repair those from per-channel ordering.
2. **Xtream tolerance rules decide what users see and which keys are stored.**
   - Items without a usable id are skipped, and duplicate ids are dropped (the first wins).
   - Catch-up needs the `tv_archive` flag; a duration alone doesn't count.
   - A missing movie extension becomes `mp4`.
   - Numbers and numeric strings give the same key.
   - A wrong rule hides items or loses catch-up, but never corrupts data. `XtreamListStats` counts every skip, for diagnostics.
3. **The XMLTV tokenizer's limits:**
   - a 4 KiB quote-aware tag scan, after which the tag falls back to the first `>`;
   - a 1 MiB carry-over cap (an unclosed comment or CDATA is dropped);
   - text caps (256 characters; descriptions 1,000 by default, 300 on low-tier TVs).

   Below those limits the output is chunk-invariant (fast-check). Above them, pathological files are recovered from, but not byte-identically across chunkings.

## Verified vs not
- **Verified:**
  - local `pnpm verify` (711 tests);
  - the mock integration suite (20 tests);
  - the 200k Xtream and 300 MB XMLTV oracles;
  - a TV-pipeline bundle of the parsers, identical to Node with the ES2017 APIs removed;
  - mutation checks (8/8);
  - CI `verify`, `engines` and `media` green on PR #7's head `2b1a95b`. The `media` job ran the new scale oracles and the new bench cases. Merged as `275879c`; `main` CI was still running at handover.
- **Not done:**
  - core still hasn't run inside real Chromium 53/56 (the engines harness runs only the built app, and the parsers are bundled from step 8);
  - no TV has been involved yet.
- **Migrations and deploys:** N/A (no backend until step 29; the TV "deploy" is a store submission).

## Open decisions and gates (none block step 7)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02 (allow rules plus the worktree directory). Prune it when the relay run ends if he wants it tighter.
- Leg 8's background CI watcher was killed by Claude Code because the PC ran low on memory. If that keeps happening, closing idle Cursor tabs or Docker while the relay runs may help.
- No secrets have been shared, so nothing needs rotating.
