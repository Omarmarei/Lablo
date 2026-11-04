# Zoma IPTV: relay leg 26 opening prompt

You are leg 26 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–24 did steps 1–14a (PRs #1–#23). Leg 6 did no project work.
- **Leg 25 split step 14b** into 14b and 14c (commit `df5450a`), then **did 14b**: `RemoteDriver`, and the throttled and low-tier runs.
  - Commits `b0dbaef` and `a94083f`. PR **#24** was merged as merge commit **`ede985e`**, with the branch kept.
  - CI on `a94083f`: `verify` 6 m 31 s, `engines` 6 m 4 s and `media` 5 m 37 s, all green.
  - CI on the first commit `b0dbaef` was red:
    - the throttled run's first budget was too tight for the runner (see the gotchas);
    - Chromium 53's container missed DevTools once (a known flake).
  - Main's CI on `870c8e6` (PR #23) was green. **Main's run on `ede985e` started at handover:** check it first.

## Your step: 14c (RELAY.md is the spec)
"The live screen on the old engines." **Done when:**
- `verify:engines --self-test` is green with the live-screen checks and a seed caught;
- the Arabic screenshots have been looked at;
- the PR is merged.

1. **Check first** that none of it exists: `git log --oneline -15`, and grep `tools/engines/src` for `live` checks beyond the walk's `live`/`liveIdle`/`liveCount`.
2. **What exists today:**
   - The onboarding walk (`tools/engines/src/onboarding.ts`, `walkSteps`) ends on the live screen twice, after "Start watching" and after the relaunch. Each time it checks `live · channels 0` in the walk's language, the fixture's 2,400 channels (`liveCount`), and idle (`data-pending="0"`), then takes a screenshot.
   - Nothing presses a key there, and nothing measures it.
3. **What to add**, as walk steps after `relaunch` or as a fourth screen (`live`) per app:
   - **Keys, from the TV adapters (not the browser's):**
     - arrows 37–40 and OK 13;
     - CH−: webOS 34, Tizen 428. CH+: webOS 33, Tizen 427;
     - Back: webOS 461, Tizen 10009.
     - See `packages/platform-webos/src/index.ts` and `packages/platform-tizen/src/keys.ts`. The harness's `pressKey` sends `{ key, keyCode }`.
   - **The sequence:** ArrowDown, CH− (a window of 9 rows; check `data-top` on `[data-testid=channels]`), LEFT to the rail (RIGHT in Arabic), down to a category, OK (`data-category`, the header's `data-n`), Back to the rail, and Back again (the exit dialog on Tizen; on webOS the root policy leaves the app, so don't press it there, or check `exitApp`).
   - **The focus:**
     - `window.__ZOMA_TEST__.focusPath()` now ships in the TV bundles (`apps/tv/src/test-hook.ts`). The ES5 `WALK_EXPRESSION` can read it, e.g. `var hook = window.__ZOMA_TEST__; hook ? hook.focusPath() : null`, and compare it with the root's `data-screen`/`data-zone`/`data-index`.
     - Engine and DOM agreeing on Chromium 53 is a new, useful check.
   - **Now/next from the fixture's guide:** `hasGuide(index)` in `tools/engines/src/fixture.ts` (every 8th live channel has hourly programmes). Rows with a guide show `.z-row__now .z-row__title`; the others show the placeholder. The fixture's channel order is the "All channels" order. Check `test/engines-fixture.test.ts` for the counts.
   - **Layout:** the boxes and labels of `layout()` in `e2e/live.spec.ts`:
     - boxes: `.z-chip, .z-row, .live__title, .live__meta, .live__clock, .z-button`;
     - labels: `.live__title, .live__clock, .z-chip__label:not([translate="no"]), .z-row__next-head`;
     - keep them equal with a root test, as `test/engines-onboarding.test.ts` does for onboarding (`LAYOUT_BOXES`/`LAYOUT_LABELS`).
   - **Arabic:** the walk already runs in `ar`. The rail is on the right, and LEFT/RIGHT swap.
   - **A seed that must fail on every engine:** a CSS seed without `live.css` (see `seed-css-no-list-row` in `tools/engines/src/variants.ts`), or a JS seed. Choose the seed's `screens` after a `--self-test` run (lesson from step 11c).
   - Screenshots per engine, platform and language, plus any new test files. Remember `IMAGE_FILES` if the Docker image needs a new file.
   - Before leaving the live screen, always wait for `data-pending="0"` (step 13c's lesson).
4. **Definition of Done** (CLAUDE.md):
   - `pnpm verify`;
   - `pnpm verify:engines --self-test`. It has 72 runs and 50 seeds today; it will grow;
   - a mutation check (copy `artifacts/mutate14b.py`'s runner);
   - a PR merged on green CI;
   - look at the Arabic screenshots.
   - A "press these keys" checklist is optional for a harness-only step.
5. If step 14c is done and the leg is light, step 15 is next (the Zoma Lab build and the docs about testing without TVs). Read its entry in RELAY.md first.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If a job on `ede985e` is red, fix it on the relay branch first. If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.
4. Start Docker Desktop if `docker info` fails.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths; don't `cd` in Bash. The leg's shell starts in the main checkout; check with `pwd`.
- Never use bare `git stash`: the stash stack is shared with the main checkout.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`:
   - step 14c (the spec) and step 14b (what was built);
   - the progress-log rows for legs 23–25.
3. architecture.md:
   - §1.2 "Built in step 14a" (the live screen);
   - §4 "Built in step 14b" (the hook, the driver, the throttled run);
   - the old-engine sections of steps 13c/14a (search for "walk").
4. Runbook `docs/runbooks/old-engines.md` (item 6: the walk ends on the live screen).
5. The code:
   - `tools/engines/src/onboarding.ts` (`walkSteps`, `WALK_EXPRESSION`, `evaluateWalk`, `walkOnce`);
   - `tools/engines/src/gallery.ts` (how a screen's layout and keys are checked);
   - `tools/engines/src/variants.ts` (the seeds);
   - `tools/engines/src/fixture.ts`;
   - `apps/tv/src/live/LiveApp.tsx` (the `data-*` attributes);
   - `e2e/live.spec.ts`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and the leg-25 progress row, on top of `a94083f`. It is pushed, and the tree is clean.
- **main** has `ede985e`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (built from `b0dbaef`; `a94083f` changed only e2e and docs), `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate14b.py`: 18 mutants, unit and e2e. Run one with `python -I -u artifacts/mutate14b.py "<snippet>"`. Its `run()` takes `('vitest', [...])` or `('e2e', [...playwright args])`. `mutate14a.py` is there too;
    - `make-size-probe3.py`: module sizes of any entry. Delete the `tools/build/src/zz-sizes-probe.ts` it writes after use;
    - logs: `verify14b.log`, `engines14b.log` (the clean run), `engines14b-run1.log` (the run stopped by the flake), `mutate14b.log`, `e2e14b-final.log`, `size14b-after.txt`;
    - `perf/live-throttled.json`: the last throttled run's presses.
- **Local gates on `b0dbaef`/`a94083f`:**
  - `pnpm verify` green: 2,020 tests in 107 files, both TV builds through both gates, e2e 43/43. Then e2e 44/44 with the second seed, and the throttled project green after the calibration.
  - main's own code is 178.3 KB (tizen) of 500, with the same core-js modules as before (219).
  - `verify:engines --self-test`: all 72 runs as expected, 50 seeds caught, in one run.
  - 18/18 mutants caught.

## Gotchas and lessons
**New in leg 25** (also saved to memory as `iptv-throttled-e2e`, plus notes in `iptv-ui-test-gotchas` and `iptv-old-engine-screen`):
- **The CDP CPU throttle ends when its session detaches.** `newCDPSession` → `setCPUThrottlingRate` → `detach()` measured unthrottled timings. Keep the session open (`throttle()` in `e2e/live-throttled.spec.ts` returns a release function).
- **Prove a throttle with a summed loop.** Fastest-of-three measured only 2.3x on CI: one short run can fall between the throttle's suspensions. Now five runs are summed, with a ≥ 2x floor.
- **Calibrate perf budgets on CI.** The 2-vCPU runner at 4x is about twice as slow as Omar's PC at 4x; `ZOMA_E2E_THROTTLE=10` locally is a rough stand-in. The first budget (150 ms per press, 100 ms long task) left CI at 121 ms.
  - Now: S6's 200 ms per press, and no main-thread task longer than that.
  - CI's green run: full tier median 32 ms, max 94 ms; low tier median 11 ms, max 28 ms.
  - **Step 23's grid budget (150 ms in its Done-when) needs the same calibration.**
- **Start each measured run from the same state.** The full tier ran straight after a 20,000-channel onboarding and was 3x slower than the low tier, which started from a reload. Both now start with `page.goto`.
- **`?tier=low` did nothing on screen until 14b:** nothing set `data-tier`. `main.tsx` now writes `<html data-tier>` from `platform.info()`. Motion costs about 3x the median press on CI.
- **The `RemoteDriver` contract:**
  - `expectFocus('live/channels/3')` needs the engine's path, and the screen root `#app > [data-screen]` drawing the same `screen/zone/index`. **A new screen must put `data-screen`, `data-zone` and `data-index` on its root, and main.tsx must call `showFocus(<its navigator>)`.**
  - Keys typed into an edited field still go through `page.keyboard`.
  - `INTENT_KEYS.BACK` is Escape.
- **The throttled project** (`playwright.config.ts`) has `dependencies: ['chromium']`. If a chromium test fails, it is skipped. Run it alone with `pnpm exec playwright test --project=throttled --no-deps`.
- **Lint:** `import('…').T` type annotations are an error (`consistent-type-imports`), in a `.d.ts` too. Write the shape inline (`apps/tv/src/env.d.ts`, `e2e/zoma-test.d.ts`).
- **A weak type** (all fields optional) rejects `window`: augment `interface Window` instead.
- **The DevTools flake hit twice:** locally on Chromium 56 (the runner then stops, so 68 never ran: rerun the whole self-test), and on CI on Chromium 53 (the next push was green).
- **Bash heredocs broke again on quotes in a Python patch.** Write patch scripts with the Write tool, then run them with `python -I`.

**From earlier legs (still true):**
- **Polyfills:** Babel picks core-js polyfills by property name. A field named `at` pulled `Array.prototype.at`. `new RegExp(...)` adds about 7 KB, `.split(` about 2 KB. Probe each new TV file. Import from `@zoma/data/client`, never the package index.
- **Terser `ascii_only`:** each Arabic character costs 6 bytes in main.js.
- **The Write tool turns `\uXXXX` escapes into raw characters.** In TV code use `String.fromCharCode`, and scan for bidi controls afterwards. Print Arabic in Python only after `sys.stdout.reconfigure(encoding='utf-8')`.
- **Keys aimed at an `<input>` never reach the focus engine.** A click within 500 ms of an OK key is that key's twin. `nav.back()` skips `onIntent`: tests of Back use `nav.handle('BACK')`.
- **Text arguments carry invisible isolate marks:** compare with `stripIsolates`. Chromium 53/56/68 ignore FSI/PDI.
- **Root `test/`** can't import `@zoma/ui` or `.tsx`: read a `.tsx` as text if a test needs to pin it.
- **Components stay hook-free.** CSS uses physical properties only.
- **Old-engine harness:**
  - Never edit the Docker image's `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - Engine runs overwrite `artifacts/engines`.
  - CDP typing on Chromium 53 means `char` events.
  - Reset IndexedDB from `file:///app/blank.html`.
  - Mark the old window before a same-URL relaunch.
  - Leave the live screen only at `data-pending="0"`.
- **The e2e mock:**
  - `mock()` pins its clock to 2026-11-02 12:00 UTC; guide checks need `mock({ now: () => Date.now() })`.
  - Logins are `U`/`P`. The mock has 12 live channels, 6 films and 2 series; check `data-n`.
  - A big catalog: `e2e/big-catalog.ts` (`bigCatalog`, `writeBigGuide`, served with `xmltvFile`).
- **IndexedDB:** never `await` inside a transaction. The same key twice in one transaction loses an update.
- **Mutation scripts:** run them with `python -I -u`. They edit sources in place, so run no tests or builds alongside, and no timing mutants while Docker runs.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint. TV code is `lib: ES2017`.
- **Commits:**
  - scoped `git add`, then `git commit -F -`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes;
  - after `gh pr create`, wait about 30 s, then poll `gh pr checks <n> --json name,bucket` every 30 s (a background `python -I -u` poller).
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #24
1. **The TV bundles now carry `window.__ZOMA_TEST__`, and `main.tsx` sets `<html data-tier>`.** The hook is read-only (a focus path). The tier is new behaviour on real TVs: a set the adapters report as `low` now gets no motion. Which sets those are depends on the Tizen and webOS adapters' tier detection, which spikes S1/S6 check on hardware.
2. **The throttled run's budget is calibrated on CI's runner** (200 ms, CI's worst press 94 ms: about 2x headroom). A slower or busier runner could flake it. It sits in its own Playwright project, after every other test.
3. **`live.spec.ts` and `onboarding.spec.ts` now wait for focus paths.** They poll for up to 5 s instead of reading the DOM right after a key, and they require the engine's focus and the drawn focus to agree. A check that "the focus is there immediately" is gone; the throttled run's per-press timing covers latency instead.

## Verified vs not
- **Verified:**
  - the hook (unit tests; e2e on the live screen and onboarding);
  - the driver's keys against the browser adapter;
  - the throttled runs in both tiers, locally and on CI;
  - the low tier's motion off;
  - the seeds and the mutants;
  - the old engines unchanged (72/72, 50 seeds);
  - CI green, merged.
- **Not done:**
  - step 14c (the live screen's own checks on Chromium 53/56/68);
  - Magic Remote pointer and wheel on the live screen;
  - any TV hardware (step 16).
- **Migrations and deploys:** N/A (no backend until step 29).

## Press these keys (Omar, optional): the hook and the low tier in the desktop browser
1. In two terminals in the main checkout (after pulling main): `pnpm mock`, then `pnpm dev`. Open the printed URL (port 5173) at 1920x1080. If you have no source stored, add the mock's Xtream login first, as in the last checklist: server `localhost:8080`, user `zoma`, password `zoma-test`.
2. On the live screen, open DevTools → Console:
   - `__ZOMA_TEST__.focusPath()` gives `"live/channels/0"`;
   - press ArrowDown twice and run it again: `"live/channels/2"`;
   - ArrowLeft: `"live/rail/0"`.
3. `document.documentElement.dataset.tier` gives `"full"`. Open the same URL with `?tier=low`: it gives `"low"`, and the focus ring jumps without its short fade.
4. DevTools → Performance → CPU: 4x slowdown, then hold ArrowDown and press PageDown a few times: the focus keeps up.
5. The measured version: `pnpm exec playwright test --project=throttled --no-deps` prints each tier's median and slowest presses (about 15 s; no TV build needed).

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended; it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 25 was the 25th.

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
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk ending on the live screen and its two walk seeds (72 runs, 50 seeds);
  6. a Conventions line: UI text comes only from the catalogs through `appI18n` (ADR-011), `zoma/no-hard-coded-text` enforces it, text arguments are isolated by core's `isolateText`, and a screen with an input uses `TextField`/`createTextEditor`;
  7. new: the `pnpm e2e` row: the `RemoteDriver` and `window.__ZOMA_TEST__` (in every build), and the `throttled` project that runs last (`--project=throttled --no-deps` alone, budget 200 ms per press).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
