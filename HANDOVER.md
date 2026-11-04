# Zoma IPTV: relay leg 27 opening prompt

You are leg 27 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–25 did steps 1–14b (PRs #1–#24). Leg 6 did no project work.
- **Leg 26 did step 14c**, which also closes step 14: the live screen by the TVs' own keys on Chromium 53/56/68.
  - Commits `f1beddd` (the work), `be4d735` (RELAY tick), and `4e24f66` (a fix to leg 25's throttled e2e; see the gotchas). PR **#25** was merged as merge commit **`2f66902`**, with the branch kept.
  - CI on `4e24f66` was green: `verify` 6 m 10 s, `engines` 10 m 18 s (up from 6 m), `media` 7 m 3 s.
  - CI on `f1beddd`/`be4d735` was red in `verify` only: the throttled e2e started at 23:59:50 UTC and lost a row's "next" programme at midnight.
  - **Main's CI run on `2f66902` had started at handover:** check it first.

## Your step: 15 (RELAY.md is the spec)
"Zoma Lab build and test strategy without TVs (1.2 + 1.3)." **Done when:** the lab runs in the desktop browser and in at least one emulator, and both docs are complete.

1. **Check first** that none of it exists: `git log --oneline -15`; grep for `lab`, `spike`, `S1`… in `apps/`, `docs/`, `tools/`. Today only the mock provider's LAN log collector exists (`apps/mock-provider/src/lab-logs.ts`: `POST /__lab/logs/<session>` → `artifacts/lab-logs/`; see `docs/runbooks/mock-provider.md`).
2. **The step is big: split it first**, as legs 24 and 25 did (a `docs(relay)` commit that rewrites only the step-15 entry). A suggested split:
   - **15a:** the Zoma Lab build. Spike screens S1–S3, S6, S7, S9–S11 and the player batteries S4, S5, S8, each posting JSON to the collector. It runs in the desktop browser, with e2e and old-engine checks where they apply.
   - **15b:** `docs/runbooks/tv-setup.md` and `docs/testing-without-tvs.md`. This is research: use WebSearch, and cite prices and dates.
   - **15c:** the lab in an emulator. Tizen Studio's TV emulator or the webOS Emulator needs installs that likely need Omar (VirtualBox, Tizen Studio, a Samsung account; no Tizen CLI on this PC; `ares-*` comes from the `@webos-tools/cli` devDependency). Tag it `[needs Omar]` if so.
3. Read architecture.md §5 (the spikes table: each spike's question and pass criteria) and §4 ("On-device testing": the self-test runner), and PLAN.md phase 1.
4. **Definition of Done** (CLAUDE.md): `pnpm verify`; `pnpm verify:engines --self-test` if the build or boot changes (90 runs and 68 seeds today); a mutation check (copy `artifacts/mutate14c.py`'s runner); a PR merged on green CI; a "press these keys" checklist for UI.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If a job on `2f66902` is red, fix it on the relay branch first. If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.
4. Start Docker Desktop if `docker info` fails.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths; don't `cd` in Bash. The leg's shell starts in the main checkout.
- Never use bare `git stash`: the stash stack is shared with the main checkout.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 15 (the spec), step 16 (what follows and needs Omar), and the progress-log rows for legs 24–26.
3. architecture.md §5 and §4, PLAN.md phase 1.
4. `docs/runbooks/mock-provider.md` (the collector), `docs/runbooks/tv-build.md` (packaging, `pnpm device`).
5. The code: `apps/tv/src/main.tsx` (how screens start, `?screen=`), `apps/tv/src/data/params.ts` (`readScreen`), `apps/tv/src/hello` (the developer screen with the worker, IDB and data checks), `apps/mock-provider/src/lab-logs.ts`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and the leg-26 progress row, on top of `4e24f66`. It is pushed, and the tree is clean.
- **main** has `2f66902`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (built from `4e24f66`'s sources; the TV app is unchanged since leg 25), `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate14c.py`: 44 mutants. Its `run()` takes `('vitest', [...])` or `('engines', [verify:engines args])`. `SELF53` is `--self-test --engine chrome53`. Run one with `python -I -u artifacts/mutate14c.py "<snippet>"`, or only the unit mutants with `--unit`. `mutate14b.py` holds the e2e runner;
    - logs: `verify14c.log`, `engines14c.log` (the final self-test), `engines14c-53.log`, `mutate14c.log`, `mutate14c-extra.log`;
    - `shots14c/`: the final self-test's screenshots and report.json (the run overwrites `artifacts/engines`).
- **Local gates:**
  - `pnpm verify` was green on `be4d735`: 2,074 tests in 108 files, both TV builds through both gates, main's own code 178.3 KB (tizen) of 500 (unchanged), e2e 44/44.
  - After `4e24f66`: lint and tsc are clean, `test/big-guide.test.ts` passes (and fails on the old 3-programme guide), and the throttled project is green.
  - `verify:engines --self-test`: 90 runs as expected, 68 seeds caught, in one run.
  - Mutants: 44/44 caught.

## What step 14c built (for reference)
- `tools/engines/src/live.ts` (the live probe `LIVE_VIEW_FUNCTION`, `TV_KEYS`, `LIVE_TEXT`, the row and rail checks, `PLATFORM_BACK_STUB`), and `liveSteps` in `onboarding.ts`, run after the relaunch. `liveCategories` is in `fixture.ts`.
- **The walk's live steps:** ArrowDown; CH− (428/34) to `channels 10`, `data-top` 9; CH+; to the rail; ArrowDown ×5 and OK on Group 5 (rows from 618); Back (10009/461); Back again (Tizen: the exit dialog, then "Stay"; webOS: `PalmSystem.platformBack()` through a counting stand-in).
- **At every walk step** the focus engine must equal the screen's `data-screen/zone/index`.
- **Seeds:** `seed-css-no-live`, `seed-live-no-back-key`, `seed-focus-engine-stuck`.
- **Docs:** architecture.md §4 "Built in step 14c", runbook old-engines.md item 6 and the self-test table.

## Gotchas and lessons
**New in leg 26** (also saved to memory: `iptv-old-engine-walk`, `iptv-parser-test-patterns`, `iptv-throttled-e2e`):
- **A guide written around "now" must outlive the run.** `writeBigGuide` wrote the programme before, the one on and the next one. A CI run started at 23:59:50 UTC lost its "next" at midnight. Now it writes four (two after), pinned by `test/big-guide.test.ts`. Any test fixture timed off the wall clock needs the same margin.
- **An engine-run mutant "caught" can be a flake.** The mutation runner discards output. Confirm an engine catch by reading `artifacts/engines/report.json` for which runs were unexpected. A first "caught" was not real: rerun, the mutant passed.
- **A check that compares the engine with the DOM is vacuous on a correct app.** Prove it with a seed that makes them disagree (`seed-focus-engine-stuck` wraps `window.__ZOMA_TEST__` through a setter before main.js installs it).
- **webOS Back at the root calls `PalmSystem.platformBack()`, else `window.close()`.** In the harness, stub `PalmSystem` first; the adapter reads it lazily.
- **`test/engines-gallery.test.ts` runs the gallery CSS seeds against the gallery's CSS.** A CSS seed for another screen must be filtered out there and tested against its own CSS (as `seed-css-no-live` is in `test/engines-onboarding.test.ts`).
- **The engines job now takes about 10–12 minutes** of its 25-minute timeout. The Back-key seed spends 8 s per language waiting (`LIVE_TIMEOUT_MS`).
- **Bash heredocs with Python patches:** quoted `<<'PYEOF'` worked several times and failed once ("unexpected EOF"). The Write tool plus `python -I` is the safe path.

**From earlier legs (still true):**
- **Perf budgets:** calibrate on CI (the 2-vCPU runner at 4x is about 2x slower than Omar's PC). Keep the CDP throttle session open. Prove a throttle with a summed loop. Step 23's grid budget (150 ms) needs the same calibration.
- **The `RemoteDriver` contract:** a new screen puts `data-screen`, `data-zone` and `data-index` on its root, and main.tsx calls `showFocus(<its navigator>)`. The old-engine walk now requires that agreement too. `INTENT_KEYS.BACK` is Escape. Run the throttled project alone with `pnpm exec playwright test --project=throttled --no-deps`.
- **Polyfills:** Babel picks core-js polyfills by property name (a field named `at` pulled `Array.prototype.at`). `new RegExp` costs about 7 KB, `.split(` about 2 KB. Probe each new TV file. Import from `@zoma/data/client`.
- **Terser `ascii_only`:** each Arabic character costs 6 bytes in main.js.
- **The Write tool turns `\uXXXX` escapes into raw characters** (a `\\u` in a Python string survived). In TV code use `String.fromCharCode`. Print Arabic in Python only after `sys.stdout.reconfigure(encoding='utf-8')`.
- **Keys aimed at an `<input>` never reach the focus engine.** A click within 500 ms of an OK key is that key's twin. `nav.back()` skips `onIntent`.
- **Text arguments carry isolate marks:** compare with `stripIsolates`. Chromium 53/56/68 ignore FSI/PDI.
- **Root `test/`** can't import `@zoma/ui` or `.tsx`: read them as text. It can import `packages/*/src` files that only import `@zoma/core`, `apps/tv/src/i18n/*.ts`, `e2e/*.ts` and `apps/mock-provider`.
- **Components stay hook-free.** CSS uses physical properties only. TV code is `lib: ES2017`.
- **Old-engine harness:**
  - Never edit the Docker image's `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - Engine runs overwrite `artifacts/engines` (copy the screenshots out first).
  - CDP typing on Chromium 53 means `char` events.
  - Reset IndexedDB from `file:///app/blank.html`.
  - Leave the live screen only at `data-pending="0"`.
  - The DevTools flake: rerun the whole self-test, or the CI job.
- **The e2e mock:** `mock()` pins its clock to 2026-11-02 12:00 UTC (guide checks need `mock({ now: () => Date.now() })`). Logins are `U`/`P`; 12 live channels, 6 films, 2 series.
- **IndexedDB:** never `await` inside a transaction; the same key twice in one transaction loses an update.
- **Mutation scripts:** run them with `python -I -u`. They edit sources in place: run no tests, builds or Docker alongside.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint.
- **Commits:**
  - scoped `git add`, then `git commit -F -`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes;
  - after `gh pr create`, poll the checks in the background (`C:/Users/Omarm/.claude/jobs/<job>/tmp/poll_pr.py`-style: wait 30 s, then `gh pr checks <n> --json name,bucket` every 30 s).
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #25
1. **The walk now requires the focus engine and the screen to agree at every step**, onboarding included. A screen whose `data-*` attributes don't match its navigator fails the `engines` job; a late frame only polls longer.
2. **The `engines` job's run time went from about 6 to about 10–12 minutes** (live steps in every onboarding run, plus 18 seed runs) against its 25-minute timeout.
3. **The throttled e2e's guide changed** (four programmes per channel instead of three). That was a real clock-edge bug that could fail any CI run starting just before an even UTC hour. The file is a third larger; the run stayed green.

## Verified vs not
- **Verified:**
  - the live screen by keys on Chromium 53/56/68, both bundles, en and ar (rows, now/next, rail, layout, exits, focus agreement);
  - the seeds and the mutants;
  - the Arabic screenshots: category and exit on 53, live on 56, category on 68;
  - CI green, merged.
- **Not done:** Magic Remote pointer and wheel on the live screen; any TV hardware (step 16); step 15.
- **Migrations and deploys:** N/A (no backend until step 29).
- **No "press these keys" checklist this leg:** 14c changed only the harness and tests, and no app code.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). The harness now fails Arabic-Indic digits in the rail's counts. Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended; it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 15's emulator part** likely needs Omar (installs, accounts).
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 26 was the 26th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Seven CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: it starts on onboarding, or on the live screen once a source is stored, with `?screen=hello` and `?screen=gallery` as developer screens;
  5. the `verify:engines` row (updated): the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk on to the live screen by the TVs' keys with the focus-agreement check, and its seeds (90 runs, 68 seeds);
  6. a Conventions line: UI text comes only from the catalogs through `appI18n` (ADR-011), `zoma/no-hard-coded-text` enforces it, text arguments are isolated by core's `isolateText`, and a screen with an input uses `TextField`/`createTextEditor`;
  7. the `pnpm e2e` row: the `RemoteDriver` and `window.__ZOMA_TEST__` (in every build), and the `throttled` project that runs last (`--project=throttled --no-deps` alone, budget 200 ms per press).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
