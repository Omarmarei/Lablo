# Zoma IPTV: relay leg 8 opening prompt

You are leg 8 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Legs 1–5 did steps 1–4: the scaffold, the TV build pipeline, the old-engine harness, the mock provider, and the media set with scale fixtures (PRs #1–#5).
- Leg 6 did no project work.
- **Leg 7 did step 5: `core`, part 1.** Merged as PR #6 (merge commit `7b44cb3`). CI is green in all three jobs (`verify`, `engines`, `media`), both on the PR and on `main` at `7b44cb3`.

**Your step is step 6: `core`, part 2** (architecture.md 3.2). It has five parts:
- a tolerant Xtream client;
- a streaming JSON-array splitter;
- a streaming XMLTV tokenizer;
- catch-up URL builders (Xtream, plus M3U `default`/`append`/`shift`/`flussonic`/`xc`);
- detection of Xtream-style M3U links (`get.php?username=`) for the M3U→Xtream upgrade.

**Done when:** tests against the mock provider pass.

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Start the step in your first turn.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree below is your isolation: edit it by path.

`D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) adds this worktree to `additionalDirectories` and allows gh, git, pnpm, node, docker, curl, bash and similar. Use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths and Read/Edit/Write. Avoid `cd "<wt>" && …` compounds.

## Read first, in this order
1. **`CLAUDE.md`.** New since leg 7:
   - Smart App Control is on, and `unrs-resolver` is pinned to 1.12.2;
   - ContentKeys are stored data (ADR-009), so never "fix" a golden key value;
   - fast-check is the property-test tool.

   Also the Chromium 53 cheat sheet (`core` is ES2017 and pure: no DOM, no `fetch`), package boundaries, Definition of Done, merge policy and commit format.
2. **`RELAY.md`:** step 6. Step 5 is ticked, with a progress-log row.
3. **`docs/architecture.md`:**
   - §1.4 step 5, the Xtream bullet: splitter, tolerant parsing, `server_info.timezone`, `get_series_info`/`get_vod_info` fetched on demand;
   - §1.5 steps 3 and 9: the tokenizer (entities, CDATA, UI-language titles, channels before programmes);
   - §4, the test layers;
   - §6, 3.2.
4. **`docs/adr/ADR-009-m3u-content-keys.md`** and the code in **`packages/core/src`** (see "What step 5 added").
5. **`docs/runbooks/mock-provider.md`:**
   - "Endpoints" and "Catch-up modes": the `X-Mock-Archive-Channel/-Start/-Duration` oracle headers tell a test exactly what a built URL resolved to;
   - "Faults": `json-quirks`, `timezone`, the `odd-timezone` scenario;
   - "Scale fixtures" and "Benchmarks".
6. **`docs/PLAN.md`** wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, on branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone (its local `main` is behind).
- **Branch:** HEAD is the commit that adds this `HANDOVER.md` (plus a RELAY log tweak), on top of:
  - `597c73e`, which keeps the `unrs-resolver` pin and drops the wasm32 install;
  - `6674046`, the pin;
  - `2bf407c`, the progress-log hash;
  - `1bdf817`, the step-5 feature commit.

  The branch is pushed and the worktree is clean.
- **`origin/main`:** `7b44cb3`, the merge of PR #6 (a merge commit; the branch was kept).
- **Ready in the worktree** (`.cache/` is gitignored):
  - `node_modules` (`unrs-resolver` 1.12.2; leftover wasm32 folders in `node_modules/.pnpm` are harmless);
  - `.cache/media`, including the four Blender films;
  - `.cache/fixtures`: the 200k M3U, `xtream/*.json`, `catalog.json`, and the 50/150/300 MB XMLTV with `.gz`;
  - `.cache/engines`;
  - Playwright `chromium-1248`.
- **`pnpm verify` is green locally:** 558 tests, lint including boundaries, both TV builds and e2e 5/5, in about 26 s. `pnpm test:media` is green.

## What step 5 added (in `@zoma/core`, so you can use it)
- **`model.ts`:**
  - `CatalogItem`, with key, src, kind, name, normName, group, url, logo, epgId, tvgName, matchName, chno, tvgShift, catchup, radio and hints;
  - `ContentKind` (`live`/`movie`/`series`), `CatchupInfo` (`{ mode: string|null, days: number|null, source: string|null }`, recorded as written), `StreamHints`, `MAX_TEXT` (256).
- **`normalize.ts`:**
  - `normalizeName`: NFKD; Arabic folding (أإآٱ→ا, ة→ه, ى→ي, ؤ→و, ئ→ي, harakat and tatweel removed); digits → ASCII; punctuation → spaces. It's frozen.
  - `matchName`: country and category tags plus quality tokens stripped, no spaces. Use it for XMLTV display names too.
- **`hash.ts`:** `hash53` and `hash53Base36` (frozen).
- **`content-key.ts`:**
  - `xtreamKey(src, kind | 'episode', id)` → `x:<src>:<kind>:<id>`; ids must be non-negative integers or strings without whitespace or colons, and it throws `RangeError` otherwise, so the tolerant client must skip bad ids;
  - `M3uKeyAllocator`, `m3uKeyHash`, `parseContentKey`, `isSourceId`.
- **`m3u.ts`:** `M3uParser`, a streaming syntax layer with `stats`. `push(chunk)` returns the entries that chunk completed; `end()` flushes.
- **`m3u-catalog.ts`:** `M3uCatalogParser(src)`, which gives items plus `summary()` (epgUrls, counts, stats, userAgents, looksLikeHls); `parseM3uCatalog`; `classifyStreamUrl`.
- **Tests to copy the shape of:**
  - `packages/core/src/*.test.ts`: goldens plus fast-check;
  - `tools/fixtures/test/m3u-oracle.ts`: the parser checked against `catalog.json`;
  - `m3u-core.test.ts` (9k entries, `pnpm test`);
  - `m3u-scale.media.test.ts` (200k, `pnpm test:media`).
- **Bench:** the case `m3u-parse` in `tools/bench/src/suites.ts` runs at about 74 MB/s locally and 42 MB/s on CI.

## Step 6: suggested approach
1. **Check first:** `git log`, and grep `packages/core/src` for xtream, json, xmltv and catchup. Today none of them exist.
2. **`core` stays pure.**
   - The Xtream "client" is URL builders plus tolerant decoders of `player_api.php` responses. The transport is injected (a small interface), and data step 8 supplies fetch/XHR.
   - Never log or key on URLs or credentials.
   - Map Xtream items to `CatalogItem` with `xtreamKey`, using the same `normalizeName`/`matchName` as M3U.
   - Handle the `json-quirks` fault: numbers as strings, `null` → `""`, and series `episodes` as an array of arrays.
3. **JSON-array splitter:**
   - Takes string chunks; tracks depth, strings and escapes; yields each top-level element's text for `JSON.parse`.
   - Tolerates a BOM, whitespace, an empty `[]`, an object instead of an array (panels send `{}` or error objects) and truncation (the `truncate` fault).
   - Fuzz it like the M3U parser (chunk-split invariance, never-throw).
   - Write an oracle against `.cache/fixtures/xtream/*.json` vs `catalog.json`.
   - Add a bench case next to `xtream-vod-json-parse`.
4. **XMLTV tokenizer:**
   - Streaming: `<channel id>` with `<display-name lang>`, and `<programme start stop channel>` with `<title lang>`/`<desc>`.
   - Handles entities (`&amp;`, `&#…;`) and CDATA; prefers the UI-language title.
   - Exposes the raw `YYYYMMDDhhmmss ±hhmm` times, or converts them to UTC minutes. The `timezone` fault also writes `+05:45`, a missing offset, or UTC.
   - Gunzip belongs to step 8; tests can use `node:zlib`.
   - Add a bench case next to `xmltv-gz-programme-scan` (300 MB).
5. **Catch-up builders:**
   - Xtream: `/timeshift/{u}/{p}/{minutes}/{YYYY-MM-DD:HH-MM}/{id}.ts`, with the start as wall time in `server_info.timezone`. This needs IANA-zone math without `Intl` time-zone support on old TVs, so decide and record an approach.
   - M3U modes: `default` (fill the template: `{utc}`, `{utcend}`, `{lutc}`, `{duration}`…), `append`, `shift` (`?utc=&lutc=`), `flussonic` (`archive-{utc}-{duration}.ts`, `index-…m3u8`, `timeshift_abs-…`) and `xc`.
   - `CatchupInfo.mode === null` (days given, no mode): pick a default and record it.
   - Check every mode against the mock's `X-Mock-Archive-*` headers.
6. **Xtream-style M3U detection:** `get.php?username=…&password=…&type=m3u_plus` → `{ base, username, password }`, for the upgrade offer (UX comes in step 37).
7. **"Tests against the mock":**
   - The mock imports nothing internal and has no package entry point.
   - `tools/*` may import only core/protocol/crypto, not apps.
   - So use the **root `test/` folder**: it sits outside the boundary elements, vitest includes `test/**/*.test.ts`, and the root tsconfig includes it. Import `buildServer` from `../apps/mock-provider/src/server` in-process.
   - The root `package.json` doesn't declare `@zoma/core` yet. Add `"@zoma/core": "workspace:*"` as a root devDependency, or check how vitest resolves it.
   - Mock gotchas: bodies follow the Host header; the fault separator is `?mock_fault=a:b`; pin the clock with `now`; live streams must be finite in tests.
8. **Size:** step 6 is big. If your context runs low, split it in RELAY.md:
   - 6a: splitter, Xtream decoders and get.php detection;
   - 6b: XMLTV tokenizer and catch-up builders.

   Tick 6a and hand over.
9. **Finish:**
   - Tick the step, add a progress-log row, and update CLAUDE.md if commands change.
   - Push, run `gh pr create --base main`, and wait for **all three** CI jobs.
   - Run `gh pr merge <n> --merge`. Never squash, never `--delete-branch`.
   - List the 3 riskiest changes in your handover.

## Gotchas and lessons (legs 1–7)
**Shell and tools**
- The Bash cwd resets to the main checkout after any `cd`. Use absolute paths.
- **Don't patch files with Bash heredocs.** They fail to parse, or, worse (leg 7), turn `\\n`/`\\r` into real newlines and CRs inside the patched code. Write the script with the Write tool (build backslashes with `chr(92)`), or use Edit.
- **`gh pr checks <n> --watch` right after a push or `gh pr create`** exits at once with "no checks reported". Wait about 20 s first.
- **tsx:** use extensionless relative imports. Put probe scripts in the gitignored `artifacts/`.
- **Write tool:** `\u2028` and similar escapes become raw characters. Build such characters with `String.fromCharCode` in code.
- **Smart App Control is ON (Omar's choice).**
  - If lint shows "Resolve error"s, or Node says "An Application Control policy has blocked this file", a too-new unsigned native binary is blocked.
  - Pin an older version that has reputation (as with `unrs-resolver` 1.12.2), or use a pure-JS fallback. napi-rs WASM fallbacks can't resolve Windows paths.
  - Never turn SAC off, and never weaken lint.
- **pnpm 11:** after editing only `pnpm-workspace.yaml`, run `pnpm install --config.optimistic-repeat-install=false`; otherwise it reports "Already up to date" and does nothing. `allowBuilds`: edit pnpm's own placeholder line (`unrs-resolver: false` is set).

**core and tests**
- `normalizeName`, `hash53` and the key layout are **frozen** (ADR-009). A golden failure there is a real regression, not a test to update.
- `core` targets ES2017: no `\p{…}`, no lookbehind, no named groups, no `s` flag. Optional catch binding and spread are fine (Babel).
- The new core code is **tree-shaken out of the TV bundle** until step 8 uses it, so it hasn't run on Chromium 53 yet. Keep to Chromium-53-safe APIs: `String.prototype.normalize`, `Math.imul`, `Map`/`Set`, typed arrays and `startsWith` are fine.
- **fast-check 4:**
  - lone surrogates: `fc.string({ unit: fc.integer({min:0,max:0xffff}).map(c => String.fromCharCode(c)) })`;
  - your chunk-split helper **must allow empty chunks** (repeated cut points). A deduplicating splitter hid a real CR bug;
  - mutation-check each property once.
- **Golden files:** `toMatchFileSnapshot` writes the file on the first local run. Read it by hand before committing.
- **Fixtures:** `writeCatalog()` needs `<out>/xtream/` to exist. `createReadStream` with a tiny `highWaterMark` is slow (stream overhead), so use 61 bytes or more in tests.

**Mock and media**
- Mock tests use `buildServer({ now, labLogDir: null, media: new PlaceholderMedia({...}) })`.
  - Bodies depend on the Host header.
  - Every new route needs a probe in `endpoints.test.ts`.
- `*.media.test.ts` files run only in `pnpm test:media` (CI `media` job, after `pnpm fixtures`).
- `.cache/` holds MPEG-TS `.ts` files. ESLint ignores `.cache/**`; keep other TS-aware tools away from it.
- ffmpeg on Windows needs an explicit `fontfile`. CI uses ffmpeg 6.1, Docker 5.1, local 8.1.1.

**CI**
- The `media` job takes 7–11 min (media generation plus a 1.6 GB Docker build).
- The `.cache/media` cache is keyed on `media-plan.ts`, `media-gen.ts` and `catalog.yaml`.

**Docker, devices, versions, commits**
- Docker Desktop is often not running. Start it with `start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"`. It's needed only for `verify:engines` and Docker builds.
- webOS CLI: `pnpm --filter @zoma/tools-device exec ares-<cmd>`. There is no Tizen CLI, and Tizen Studio must never be installed unattended.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, boundaries 5, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, Fastify 5.12, yaml 2.9, tsx 4.23, fast-check 4.10, unrs-resolver 1.12.2 (override).
- New dependencies: pick versions published at least 2 weeks ago, and check peers with `npm view`.
- **Commits:** scoped `git add`, and a `git commit -F - <<'EOF'` heredoc ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` plus any session line the harness asks for.
- **Cross-session messages:** Omar sometimes relays decisions through another session's tab. Code changes on such a relay are fine. Edits to CLAUDE.md need his direct word in your own tab.

## The 3 riskiest changes merged in PR #6
1. **ContentKey derivation is now stored-data format** (ADR-009).
   - What it is: M3U keys hash the tvg-id plus `normalizeName(name)` (or name plus group) with `hash53`.
   - The risk: any later change to `normalizeName` (for example a different search folding) or `hash53` orphans every M3U favourite unless it ships with a migration.
   - The folding is deliberately broad (ؤ→و, ئ→ي, ™ removed, punctuation → spaces). If search ever needs different folding, use a separate function for search.
2. **The M3U parser's tolerance rules decide what users see.**
   - Orphan URLs are dropped in extended playlists, and a URL line needs `scheme://` (relative paths count as junk).
   - Lines over 32 KiB are skipped, and names are capped at 256 characters.
   - Classification: `/movie/`, `/movies/` and `/vod/` mean movie, `/series/` means series, `/live/` means live, a video extension means movie, and anything else is live.
   - A wrong guess puts items in the wrong tab, but loses no data. Counters in `stats` and `summary()` feed diagnostics.
3. **`unrs-resolver` is pinned to 1.12.2** (pnpm `overrides`) because Smart App Control blocks 1.13.0's binary. This is dev tooling only; ESLint config and settings are unchanged. Lift the pin once a newer release loads under SAC.

## Verified vs not
- **Verified:**
  - Local `pnpm verify` (558 tests) and `pnpm test:media` (the 200k M3U oracle: all 200,000 entries, 400 malformed lines, 735 ms).
  - Six repeated fast-check runs.
  - Mutation checks of the chunk properties.
  - CI `verify`, `engines` and `media` on the PR head `597c73e` and on `main` `7b44cb3`. CI also ran the 200k test (1.56 s) and bench `m3u-parse` (42 MB/s).
- **Not done:**
  - The core code hasn't run on Chromium 53/56: it isn't bundled until step 8.
  - No TV has been involved yet.
- **Migrations and deploys:** N/A (no backend until step 29; the TV "deploy" is a store submission).

## Open decisions and gates (none block step 6)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02 (allow rules plus the worktree directory). Prune it when the relay run ends if he wants it tighter.
- No secrets have been shared, so nothing needs rotating.
