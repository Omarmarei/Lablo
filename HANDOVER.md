# Zoma IPTV: relay leg 15 opening prompt

You are leg 15 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it. Legs 1–5 did steps 1–4 (PRs #1–#5); leg 6 did no project work; legs 7–13 did steps 5–9b (PRs #6–#12).
- **Leg 14 did step 9c: the short-EPG fallback.**
  - PR **#13**, commit `6089ab7`, merged as merge commit **`bbb197e`** (the branch was kept).
  - CI `verify` (4 m 22 s), `engines` (2 m 49 s) and `media` (9 m 32 s) were green on `6089ab7`.
  - **Phase 3 (data) is done.**

**Your step is step 10: the focus engine** (RELAY.md, Phase 4, step 10, PLAN 4.1). It is the first UI step.
- **What:**
  - Intents, and zones (`list`, `grid`, `epg`, `free`).
  - RTL flips left and right once, for horizontal zones.
  - Per-zone memory of the last focused index.
  - A router with a back stack; at the root, Back follows the platform's `rootBackPolicy`.
  - Magic Remote: hover focuses, the wheel scrolls the active list, and hiding the pointer keeps the focus.
- **Done when:** unit tests pass in LTR and RTL. Also `pnpm verify` green, a PR merged on green CI, and a short "press these keys" checklist for Omar (CLAUDE.md: UI steps end with one).
- **If step 10 turns out small,** don't start step 11 in the same leg. Step 11 (design system: fonts, virtual list, `postcss-rtlcss`) is big, and the main-budget decision comes first (see below).

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Start in your first turn.

**First, check `main`:** `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `bbb197e` (PR #13's merge, run 41520130460) was in progress when this was written, and all three jobs should be green. If one is red, fix it on the relay branch before anything else.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree is your isolation. Edit it by path, and use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths, and Read/Edit/Write. **Don't `cd`** in Bash: in leg 13 a `cd` moved the session's working directory. To run a script that needs the worktree as its cwd, use `python -I -c "import os,runpy; os.chdir(r'<wt>'); runpy.run_path('<script>')"` or `pnpm --dir "<wt>" exec …`. `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) allows the worktree and gh, git, pnpm, node, docker, curl and bash.

## Read first, in this order
1. **`CLAUDE.md`:** conventions, the Chromium 53 cheat sheet, package boundaries (`ui` may import core, player, data (client only) and platform-api), Definition of Done, merge policy and commit format.
2. **`RELAY.md`:**
   - step 9c (ticked, with what was built);
   - Phase 4, step 10;
   - the **"Main bundle budget"** note just before Phase 4;
   - the leg-14 progress-log row.
3. **`docs/architecture.md`:**
   - §1.2, "Custom focus engine": about 600 lines of pure TS, unit-tested without a DOM;
   - §1.1, the Platform interface (`rootBackPolicy`: `exit-dialog` on Tizen, `platform-back` on webOS 23–25);
   - §1.5, "Built in step 9c" (so you know what `DataEngine.focusChannel` expects from a list's focus).
4. **`docs/PLAN.md`:** the UI row (Preact 10 + `@preact/signals`, a custom index-based focus engine, "the engine swaps left/right once for RTL"), and Phase 4 / 4.1. PLAN.md wins on any conflict.
5. **Code to build on:**
   - `packages/platform-api/src/index.ts`: `INTENTS`, `DIGIT_INTENTS`, `Intent`, `RootBackPolicy`, and `keyToIntent(event)` on the Platform.
   - `packages/ui/src/index.ts`: still an empty skeleton (`export {}`). Its `package.json` has core, player, data and platform-api, but **not** `preact` or `@preact/signals`. Those are deps of `apps/tv` (`@preact/signals` ^2.11.4, `preact` ^10.29.8).
     - Either add them to `ui` as the same versions (the boundary lint allows external libraries), or keep the engine framework-free with a tiny listener API, and let `apps/tv` wrap it in signals. Decide by size and testability, and write the choice down in architecture.md.
   - `apps/tv/src/App.tsx` and `main.tsx` (the hello screen and its key handling: `last-intent`, `noteActivity`); `apps/tv/src/platform.ts`.
   - `apps/tv/src/data/engine.ts`: `focusChannel(channel | null)`. A future live list calls it on each focus change. Not needed for step 10, but keep it in mind for the API.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone (its local `main` is behind).
- **Branch:** HEAD is the commit that adds this `HANDOVER.md` and records PR #13's merge in RELAY.md, on top of `6089ab7` (step 9c). It is pushed, and the worktree is clean. `main` holds the merge commit `bbb197e`; the branch doesn't, which is normal for this run.
- **Gitignored but present:**
  - `node_modules` and `dist/` (built by the last `pnpm verify`);
  - `.cache/media`, `.cache/fixtures`, `.cache/engines`;
  - Playwright `chromium-1248`; the Docker image `zoma-old-engines:ba502212364a`;
  - `artifacts/`:
    - `mutate9c.py` (step 9c's 26 mutants; run it with `python -I artifacts/mutate9c.py [snippet]`), plus `mutate9b.py`, `mutate9.py`, `mutate8.py` and `mutate8b.py`;
    - `make-size-probe.py`;
    - `verify.log`, `engines.log`, `mutate9c.log`.
- **Local gates on `6089ab7`:**
  - `pnpm verify` green: lint, typecheck, 946 tests in 70 files, both TV builds, e2e 7/7;
  - `pnpm verify:engines --self-test`: all 24 runs as expected on Chromium 53/56/68, with the 16 seeded failures caught.

## What step 9c added (use it, don't rebuild it)
- **Query worker:** `shortEpg({ key, url, source, at? })` returns a `ShortEpgNowNext`, which is an `EpgNowNext` plus `from` (`guide`, `panel` or `none`) and `cached`.
  - A matched channel gets its guide's now/next, with no request.
  - An unmatched channel of an Xtream panel (an Xtream source, or a `get.php` M3U) gets its panel's `get_short_epg` (`limit=4`).
  - The worker now has `fetchTransport`.
  - The cache (`ShortEpgCache`) keeps each channel 30 min and holds 200 channels. Empty answers are kept, failures are not, and one request is shared between overlapping asks.
  - The account comes from the source, the stream id from the stream URL, and the cache key is the ContentKey.
- **Core:**
  - `xtreamEpgProgrammes` turns the entries into the guide's `EpgProgramme` rows.
  - `xtreamShortEpg(account, transport, streamId, limit)`.
  - The new files `xtream-epg.ts` (short EPG) and `xtream-base.ts` (tolerant values, `TextTransport`, `XtreamError`, `xtreamOpen`/`xtreamJson`/`readAll`) are re-exported by `xtream.ts`; the core index exports straight from them.
- **App:** `DataEngine.focusChannel(channel | null)` resolves with the answer, or with `null` when the focus moved on first.
  - It waits `FOCUS_MS` = 600 before asking.
  - A new focus, `null` or `dispose` settles the waiting call with `null`.
  - A late answer is dropped.
- **Panel:** the hello screen's "Panel EPG" row (`shortepg-status`, `data-from`) focuses the first live channel no guide matches.
- **Mock:** the scenario `no-xmltv` (`xmltv.php` 404, `get_short_epg` still answers).

## Heads-up for step 10
- **The main budget is tight:** main is 459.1 KB of 500 (92%), because it inlines all four workers (hello 37.5, query 89.8, EPG 115.1, ingest 124.9 KB).
  - The focus engine is main-thread code. Measure main after the change (`pnpm build:tv` prints it).
  - If step 10 would push main over 500, stop and ask Omar, as a needs-you stop, with RELAY.md's three budget options. Recommended: count inlined workers only against their own 150 KB budgets. Don't raise a budget on your own.
  - Even if step 10 fits, put the budget question to Omar at the end of the leg, because step 11 (fonts, components) won't fit in about 40 KB.
- **Pure TS, no DOM:** the engine is index-based (focus is a data index, not DOM focus), so Vitest runs it in Node.
  - Test every zone kind in LTR and RTL: in RTL, LEFT and RIGHT swap for horizontal zones only, never UP and DOWN, and only once.
  - Test per-zone memory, the router's back stack, and both `rootBackPolicy` values.
  - Test hover-to-focus: a pointer move focuses, hiding the pointer keeps the focus.
  - Write a mutation script like `artifacts/mutate9c.py`.
- **`lib: ES2017`** in every package and `apps/tv` (pinned by `tools/build/src/bundle.test.ts`). `Array.prototype.sort` isn't stable on Chromium 53.
- **A new runtime dep** (`preact` or `@preact/signals` in `ui`) must be at least 2 weeks old. Use the versions `apps/tv` already has, then run `pnpm install --config.optimistic-repeat-install=false`.
- **`verify:engines --self-test`** is needed if you change the build, polyfills, workers or boot code (wiring the engine into `main.tsx` counts as boot code).

## Gotchas and lessons (legs 1–14)
**New in leg 14**
- **Bundle size:**
  - A class keeps all its methods: `new XtreamClient(...)` for one call took the query worker from 82.6 to 110.5 KB, so one-call users need small files of their own.
  - `content-key.ts` (`parseContentKey`) drags `es.json.stringify` (about 4 KB min) through its error messages, and `padStart` drags the pad polyfills.
  - The fastest diagnosis is a full before/after module diff: set the probe's `rows.slice(0, 60)` to 1000, probe HEAD (`git -C <wt> stash push -- <paths>`, probe, `stash pop`) and the change, then diff `renderedLength` per module.
  - The probe's output contains a binary byte, so use `grep -a`.
- **Debounce tests over message channels and sockets:**
  - fake only `setTimeout`/`clearTimeout` (`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`), and only around the wait;
  - let real work run with a `setImmediate` loop;
  - call `vi.useRealTimers()` before awaiting any network answer, and in `afterEach` too;
  - assert "a request was made" only after the answer settles (the worker side issues it asynchronously).
- **Mock:** `get_short_epg` answers only for channels with an EPG id, so with the full guide the one unmatched channel (18+ Test Pattern) gets an empty answer. For a non-empty one, use `mock({ scenario: 'no-xmltv' })`. A new scenario needs `faults.test.ts` (the shipped list and the `available` count) and the runbook table.
- **Bash heredocs:**
  - inside a Python patch, `'\\n'` became a real newline and `\\(` became `\(`, even in a quoted heredoc. Write patch scripts with the Write tool into `$CLAUDE_JOB_DIR/tmp` and run `python -I` on them, asserting `s.count(old) == 1`.
  - For text with backslashes, use the Edit tool.
- **Watching CI:** this Monitor (`timeout_ms` 1800000) worked first time, after one foreground `gh pr checks 13`: a `while true` loop over `gh pr checks <n> -R Omarmarei/zoma-iptv --json name,bucket --jq …`, echoing the finished jobs and breaking when none are pending, with `sleep 45`. No process substitution.
- **Mutation runs:** the two survivors were missing cases: an end time with seconds, and a refreshed entry's place in the cache's eviction order. Rerun a single mutant with `python -I artifacts/mutate9c.py "<snippet of the new text>"`.

**From leg 13**
- **IndexedDB:** a read-modify-write of the same key twice in one transaction loses the first update. Merge in memory first.
- **A crash test must crash after something is written.**
- **No clock-dependent e2e:** the mock's schedule is pinned to 2026-11-02 12:00 UTC, the browser's clock isn't. e2e asserts match rates, `data-from` and text patterns, never exact now/next.
- **A mutant that adds a second listener leaves the first one working:** mutate the original handler's body.

**Shell and tools**
- Use absolute paths, and never `cd`. The Write tool keeps `\n` literal but turns `\uFEFF`/`\u2028` into raw characters.
- **Bundle sizes:**
  - `artifacts/make-size-probe.py` writes `tools/build/src/zz-sizes-probe.ts` for `packages/data/src/<name>.worker.ts`; for main, edit its input to `apps/tv/src/main.tsx`.
  - Run it with `pnpm --dir "<wt>" exec tsx tools/build/src/zz-sizes-probe.ts <name>`.
  - Delete the probe afterwards (lint would see it).
- **Mutation runs:** each mutant has a 180 s timeout. Restore from `.bak` if a run is killed. Never run mutations while `pnpm verify` or `verify:engines` builds from the same source.
- **The old-engine Docker image:**
  - never change the `RUN apt-get …` line (a rebuild takes an hour);
  - add layers after it;
  - list new COPY files in `IMAGE_FILES`.
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
- **fake-indexeddb:** `freshFactory()` per test; close `MessageChannel` ports in `afterEach`.
- **Mock tests:**
  - never build URLs from `base` at module level;
  - reset `app.mockState.catalog` in `beforeEach`;
  - the clock is `NOW` = 2026-11-02 12:00 UTC.
- **Polyfills:**
  - Babel injects them per file before tree-shaking, so use narrow entries (`@zoma/data/client`) and keep shared helpers in small modules;
  - TV code keeps `lib: ES2017`.

**core and data**
- `normalizeName`, `hash53` and the key layout are frozen (ADR-009). `core` targets ES2017.
- Never `await` inside `transact`. Database v1 and v2 and profile v1 become stored data once a build ships; change them only through append-only migrations.
- Keep long-lived parser strings as owned copies (`ownString`).

**CI, versions, commits**
- CI takes about 4–5 min for `verify`, 3 for `engines` and 9–11 for `media`. Wait about 20 s after `gh pr create` before reading checks.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fast-check 4.10, fake-indexeddb 6.2.6, fflate 0.8.3, unrs-resolver 1.12.2.
- **Commits:** a scoped `git add` and `git commit -F <file>`. End with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line and the harness's session line.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Three gaps are open:
  - the "deep imports" convention doesn't mention `@zoma/data`'s four extra entries (client, query, ingest and epg workers);
  - the Commands table lacks `pnpm epg:report`;
  - the `build:tv` row doesn't say that the main budget includes the inlined workers.

## The 3 riskiest changes in PR #13
1. **The query worker now makes network requests** (`fetchTransport`) and receives the Xtream account over RPC. Credentials go only to the source's own panel, never into a cache key or an error message.
2. **Core's `xtream.ts` was split into three files** (moves plus re-exports), and `XtreamClient`'s `open`, `json` and `shortEpg` now delegate to the shared helpers. The ingest worker runs on this code; all its tests passed unchanged.
3. **Main is at 459.1 of 500 KB (92%).** The budget decision is now urgent.

## Verified vs not
- **Verified:**
  - local `pnpm verify` (946 tests, e2e 7/7: the panel row in dev and in both built bundles, and the `no-xmltv` fallback in dev);
  - `verify:engines --self-test` (24/24 as expected);
  - 26/26 mutants caught;
  - the "done when" through the real `DataEngine` and the mock over a socket: an unmatched channel gets the mock's own now/next after 600 ms of focus, not at 599 ms, and a second focus within 30 min makes no request;
  - the bundled Chromium 53 query worker asks with `fetch`;
  - CI green on `6089ab7`, merged as `bbb197e`.
- **Not done:**
  - CI on `main` at `bbb197e` (run 41520130460) was in progress at handover;
  - the short EPG on a real panel or TV;
  - the old-engine harness doesn't exercise the short EPG (its fixtures are static files, with no `player_api.php`);
  - the focus engine and every UI step.
- **Migrations and deploys:** N/A (no backend until step 29; the TV "deploy" is a store submission).

## Try it (Omar, desktop, step 9c)
1. Run `pnpm mock --host 127.0.0.1 --scenario no-xmltv`, and `pnpm dev` in another terminal.
2. Open `http://localhost:5173/?source=http://127.0.0.1:8080/get.php?username=zoma&password=zoma-test&type=m3u_plus`.
3. **Guide** shows `failed: debug:tvg0 http` (the panel's guide is off). **Panel EPG** shows `focused: Zoma Test 1 SMPTE…`, then about 0.6 s later `ok: Zoma Test 1 SMPTE: <title> hh:mm–hh:mm, next … (panel)`.
4. Restart the mock without `--scenario` and reload. **Guide** shows 11 of 12, and **Panel EPG** shows `none: 18+ Test Pattern: the panel has no programmes for it now` (that channel has no EPG id, so the panel has nothing either).

## Open decisions and gates
- **Main bundle budget** (RELAY.md note; main is now at 92%). Decide it before step 11, or sooner if step 10 overflows. The options are:
  1. count inlined workers only against their own budgets (recommended);
  2. ship separate worker files (needs spike S1);
  3. raise the main budget.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).
- **Relay cap:** 40 legs; leg 14 was the 14th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Three CLAUDE.md gaps** wait for his word: `@zoma/data`'s four entries, `pnpm epg:report`, and the main budget including the inlined workers.
- **The main-budget decision** (above) is due before step 11.
- No secrets have been shared, so nothing needs rotating.
