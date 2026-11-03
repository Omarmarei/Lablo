# Zoma IPTV: relay leg 25 opening prompt

You are leg 25 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–23 did steps 1–13c (PRs #1–#22). Leg 6 did no project work.
- **Leg 24 split step 14** into 14a and 14b (commit `84da545`), then **did 14a, the live screen**.
  - Commit `42f1a5a`. PR **#23** was merged as merge commit **`870c8e6`**, with the branch kept.
  - CI on `42f1a5a`: `verify` 7 m 58 s, `engines` 6 m 0 s and `media` 9 m 2 s, all green on the first run.
  - Main's CI on `bb73826` (PR #22) was green before leg 24 started. **Main's run on `870c8e6` started at handover:** check it first.

## Your step: 14b (RELAY.md is the spec)
"`RemoteDriver`, the throttled and low-tier runs, the live screen on the old engines." **Done when:** the throttled and low-tier runs are green in `pnpm verify`; `verify:engines --self-test` is green with the live-screen checks and a seeded failure caught; PR merged; a checklist.
1. **Check first** that none of it exists: `git log --oneline -15`, and grep for `RemoteDriver`, `focusPath`, `__ZOMA_TEST__`, `setCPUThrottlingRate` in `apps/tv/src`, `packages/ui/src`, `e2e` and `tools/engines`.
2. **Read the design:**
   - architecture.md §4, lines ~816–827. `RemoteDriver` presses Intents and checks `window.__ZOMA_TEST__.focusPath()` (focus ids from the engine, not the DOM) at 1920x1080. The smoke run is at 4x CPU throttle. There is also a forced low-tier mode.
   - architecture.md §1.2: "Built in step 14a", which describes the live screen.
   - Step 23's Done-when says "each key press in the grid is handled in ≤ 150 ms in the throttled e2e". A per-press budget of that kind is the model to follow.
3. **Pieces to build (a suggested order):**
   - **`__ZOMA_TEST__`.** Every screen builds its own `Navigator` (`createGallery`, `createOnboarding`, `createLive`), and `main.tsx` knows which one is on show. A small hook module could set `window.__ZOMA_TEST__ = { focusPath }` from the current navigator's `snapshot()` (`screen/zone/index`). Decide whether the TV bundles carry it. The old-engine harness could use it instead of reading `data-*` attributes, but it then ships to users: keep it tiny, or put it behind a define.
   - **`e2e/remote-driver.ts`:**
     - Intent → the browser adapter's key: read `packages/platform-browser`'s key map (arrows; Enter is OK; Escape/Backspace is Back; PageUp/PageDown are CH±; digits; F1–F4 colours).
     - `press(intent)`, `expectFocus('live/channels/3')` (waits on `focusPath()`), and a timing helper.
     - Move `live.spec.ts` onto it, and `onboarding.spec.ts` where it fits. Keep the typing helpers: keys aimed at an `<input>` never reach the focus engine.
   - **The 4x CPU-throttled smoke run:** `const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })`.
     - It needs a large catalog for the live screen. `pnpm verify` (the CI `verify` job) has no `.cache/fixtures` (`pnpm fixtures` runs only in the `media` job), so build a large catalog in-process.
     - Either generate a big `catalog` for `mock({ catalog })` (check what `buildServer`/`loadCatalog` accept), or serve an M3U of N channels from a tiny test server, as the harness's `tools/engines/src/fixture.ts` does. The harness fixture is 3,000 entries; something like 20,000 live channels in 200 categories exercises the chunks (500 per chunk) and the rail's scrolling.
     - Measure per press: keydown to the focus change being painted (`requestAnimationFrame` after the `data-index` change, or a `PerformanceObserver` for long tasks). Assert a budget, and no long task over N ms while scrolling. Run it in `?tier=low` too: check what the low tier changes (`--motion` none on the low tier; anything else in `platform-browser`'s `info().tier`).
   - **The old-engine harness on the live screen:**
     - Today the walk only lands on it, at `live · channels 0`, idle, with 2,400 channels and a screenshot.
     - Add the live screen's own checks after the walk's "Start watching", or as its own screen in `tools/engines/src`:
       - by keys: ArrowDown, PageDown, LEFT to the rail (RIGHT in Arabic), OK on a category, Back;
       - the layout: the boxes and labels of `layout()` in `e2e/live.spec.ts`, kept equal by a root test like `test/engines-onboarding.test.ts`;
       - now/next from the fixture's guide: `hasGuide` in `fixture.ts` gives every 8th channel programmes;
       - Arabic.
     - Add a seed that must fail: for example a CSS seed without `live.css` (see the existing CSS seeds), or a JS seed.
     - Remember `IMAGE_FILES` if the Docker image needs a new file, and that engine runs take about 6 minutes on CI.
4. **Probably big again:** if it doesn't fit one leg, split it in RELAY.md first (for example 14b: the driver, `__ZOMA_TEST__` and the throttled/low-tier runs; 14c: the old-engine live checks), commit the split, then do the first part.
5. **Definition of Done** (CLAUDE.md): `pnpm verify`; `verify:engines --self-test` after boot, build or harness changes; a PR merged on green CI; a "press these keys" checklist. Look at the screenshots, the Arabic ones too.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If a job on `870c8e6` is red, fix it on the relay branch first.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.
4. Start Docker Desktop if `docker info` fails (needed only for `verify:engines`).

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths; don't `cd` in Bash. The leg's shell may already start in the worktree; check with `pwd`.
- Never use bare `git stash`: the stash stack is shared with the main checkout.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the package boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: steps 14a (done; what was built) and 14b, and the leg-24 row of the progress log.
3. architecture.md §1.2 "Built in step 14a", §4 (the test strategy), and runbook `docs/runbooks/old-engines.md` item 6 (the walk now ends on the live screen).
4. The code: `apps/tv/src/live/{live-state,LiveApp,channel-index}.ts(x)` and `apps/tv/src/main.tsx` (`showLive`). Then `e2e/live.spec.ts`, whose helpers are `addSourceAndWatch`, `rows`, `layout`, `settled`, `checkRows` and `untranslated`. Then `tools/engines/src/onboarding.ts` (`walkSteps`, `WALK_EXPRESSION`, `live`/`liveIdle`/`liveCount`) and `tools/engines/src/gallery.ts` (how a screen's layout and keys are checked on the old engines).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and the leg-24 progress row, on top of `42f1a5a`. It is pushed, and the tree is clean.
- **main** has `870c8e6`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (built from `42f1a5a`), `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate14a.py`: 46 mutants, all caught. Run one with `python -I -u artifacts/mutate14a.py "<snippet>"`. Its runner kills a spinning mutant's whole process tree; copy that runner into a new script.
    - `make-size-probe3.py`: module sizes of any entry, e.g. `python -I artifacts/make-size-probe3.py "<wt>"`, then `pnpm exec tsx tools/build/src/zz-sizes-probe.ts apps/tv/src/main.tsx`; delete the probe after.
    - logs: `verify14a.log`, `engines14a.log`, `mutate14a.log`, `size14a-after.txt`;
    - `screenshots/live-*.png`, `engines/onboarding-*-live.png`.
- **Local gates on `42f1a5a`:**
  - `pnpm verify` green: 2,011 tests in 105 files, both TV builds through both gates, e2e 41/41. main's own code is 178.0 KB (tizen) of 500, with 219 core-js modules.
  - `verify:engines --self-test`: all 72 runs as expected, 50 seeds caught, in one run.
  - 46/46 mutants caught.

## Gotchas and lessons
**New in leg 24** (also saved to memory):
- **A field named `at` pulled core-js's `Array.prototype.at` and `String.prototype.at` into main again** (`GuideEntry.at`, now `asked`). After any new TV code, check per file with a Babel `transformSync` probe. Leg 24 wrote a throwaway `tools/build/src/zz-polyfill-probe.ts` importing `CORE_JS_VERSION`, `TV_TARGETS` and `UNUSED_POLYFILLS` from `bundle.ts`, then deleted it. Also count main's core-js modules with the size probe (219 is the number to keep).
- **The e2e `mock()` helper pins its clock to 2026-11-02 12:00 UTC.** Any e2e that checks guide content needs `mock({ now: () => Date.now() })`. Compare titles with the mock's `upcoming(channel, t, 1)` at the check's start and end.
- **Whose programmes a row shows:** 112 shows 101's (the first channel declaring the XMLTV id); "Zoma Sports Test FHD" shows HD's (match-name); "18+ Test Pattern" has none.
- **A mutant that loops forever hung `subprocess.run(timeout=…)` on Windows.** Its timeout kills only the shell, the pipes then wait for vitest, and the mutated file stays in place. Use `Popen` with DEVNULL plus `taskkill /PID <pid> /T /F` on timeout. If a run hangs, kill the vitest node tree, and the script's `finally` restores the file.
- **The live screen's idle signal is `data-pending`.** It counts every data request in flight, including the focused channel's 600 ms `focusChannel` wait, so an idle relaunch takes 0.7–0.8 s on the old engines. A new harness check that leaves the live screen must wait for `data-pending="0"`: step 13c's lesson was that leaving while workers are in IndexedDB stalled the next delete on CI's Chromium 53.
- **`Screen.update` notifies listeners.** When switching a list's category, `reset` first, then `update`, then `focus`, so no step reads chunks for the old window.
- **en-XA check:** the formatter's times (`11:45 PM`, also after "Next ·") are not catalog text, so `live.spec.ts`'s `untranslated()` skips `/^(· )?\d{1,2}:\d{2} [AP]M$/`.
- **A provider name with `dir="auto"` in a flex label aligns to its own start.** In the rail, `text-align: left`, mirrored by rtlcss, puts it on the screen's side, as in ListRow.
- **The rail is a vertical chip column at the inline start** (a decision recorded in architecture.md). The gallery's horizontal rail stays in the gallery.
- **Unit-test timing:** `live-state.test.ts` has `manualTimers(start, late)`, a hand-run queue whose timers can fire late, and a `FakeEngine` that can hold any call kind (`hold`/`held`).

**From earlier legs (still true):**
- **Polyfills:** `new RegExp(...)` in TV code adds about 7 KB of core-js and `.split(` about 2 KB. Babel picks polyfills by property name. Import from `@zoma/data/client`, never the package index.
- **Terser `ascii_only`:** each Arabic character costs 6 bytes in main.js.
- **The Write tool turns `\uXXXX` escapes into raw characters.** In TV code use `String.fromCharCode`, and scan for bidi controls afterwards. Bash heredocs lose `\\` and break on backticks: write Python patch scripts with the Write tool, then run them with `python -I`. Print Arabic only after `sys.stdout.reconfigure(encoding='utf-8')`.
- **Keys aimed at an `<input>` never reach the focus engine.** A click within 500 ms of an OK key is that key's twin. `nav.back()` skips `onIntent`: tests of Back send `nav.handle('BACK')`.
- **Text arguments carry invisible isolate marks:** compare with `stripIsolates`. Chromium 53/56/68 ignore FSI/PDI.
- **Root `test/`** can't import `@zoma/ui` or `.tsx`: read a `.tsx` as text if a test needs to pin it (as `test/engines-onboarding.test.ts` does with `LiveApp.tsx`).
- **Components stay hook-free.** CSS uses physical properties only.
- **Old-engine harness:**
  - Never edit the Docker image's `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - A container can miss DevTools once: rerun with `--engine`.
  - Engine runs overwrite `artifacts/engines`.
  - CDP typing on Chromium 53 means `char` events.
  - Reset IndexedDB from `file:///app/blank.html`.
  - Mark the old window before a same-URL relaunch.
- **IndexedDB:** never `await` inside a transaction. The same key twice in one transaction loses an update. A page-side `indexedDB.open('zoma')` before the app boots creates an empty v1 database.
- **The mock in e2e:** start it in `test.beforeAll`, and type `host:port` without `http://`. Logins are `U`/`P` from `apps/mock-provider/test/helpers`. It has 12 live channels, 6 films and 2 series; check `data-n`, not Arabic digits.
- **Mutation scripts:** run them with `python -I -u`. They edit sources in place, so run no tests or builds alongside.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint. TV code is `lib: ES2017`.
- **Commits:**
  - scoped `git add`, then `git commit -F -`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes;
  - after `gh pr create`, wait about 30 s before reading the checks (leg 24's poller: `gh pr checks <n> --json name,bucket` every 30 s, run with `python -I -u` in the background).
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #23
1. **The app's start changed.** With a stored source it opens the live screen, which reads the profile and every source's categories at start; a read failure shows "Try again". Steps 17–20 hang playback off this screen's OK (`live.selected`).
2. **The old-engine walk now ends on the live screen's `data-pending="0"`**, not the hello screen's last data row. That includes the 600 ms focus wait. CI's Chromium 53 was green on the first run, but this is the spot where a stalled IndexedDB delete appeared in 13c.
3. **`live.spec.ts` runs the mock on the real clock.** It accepts the programme on air at either end of the check, because a slot boundary can pass mid-check. A provider-side slot change exactly then is covered; a slow CI page that takes over a minute between the reads is not.

## Verified vs not
- **Verified:**
  - the live screen by keys in en, ar and en-XA against the mock in current Chromium: categories and counts, the panel's numbers, now/next against the mock's schedule, paging, a category, Back, the exit dialog, the mirror, the layout, the fonts, a relaunch in the picked language;
  - both bundles from `file://` open it and page it;
  - Chromium 53/56/68 land on it idle with 2,400 channels in both languages; the Arabic screenshot on 53 was looked at;
  - CI green, merged.
- **Not done:**
  - step 14b (the driver, the throttled and low-tier runs, the live screen's own old-engine checks);
  - a large catalog on the live screen (only 12 channels in e2e, 2,400 on the old engines);
  - Magic Remote pointer and wheel on the live screen (the components support them, but there is no e2e on this screen yet);
  - any TV hardware (step 16).
- **Migrations and deploys:** N/A (no backend until step 29).

## Press these keys (Omar, optional): the live screen in the desktop browser
1. In two terminals in the main checkout (after pulling main): `pnpm mock`, then `pnpm dev`. Open the printed URL (port 5173) at 1920x1080 in a private window, so you start without a stored source.
2. Onboarding: Enter (English), Enter, Enter (Allow), Enter (Xtream login). Fill the fields, each with Enter to open it, type, then Enter: server `localhost:8080`, username `zoma`, password `zoma-test` (the mock's test login). Then ArrowDown ×2, Enter. On the done screen, Enter ("Start watching").
3. You should see **Live TV**:
   - on the left, "All channels 12", then Test News 4, اختبار - أخبار 3, Kids Test | أطفال 1, Sports Test 2, Radio Test 1, 18+ Test (lock check) 1;
   - on the right, 9 rows numbered 1, 2, 10, 11, 3, 4, 12, 5, 6, each with the programme on now (its start time and a bar) and the next one;
   - the clock top right.
4. Press PageDown twice. The focus lands on the last row: number 9, "18+ Test Pattern", which says "No guide for this channel". PageUp twice goes back to the top. ArrowLeft goes to the rail. ArrowDown ×3 and Enter shows "Kids Test | أطفال · 1 channel". Escape goes back to the rail, Escape again opens "Exit Zoma?", and Enter (Stay) closes it.
5. Reload the page: the live screen comes back without onboarding.
6. Arabic: open another private window and pick العربية on the first screen. The live screen is then mirrored, with the rail on the right and "كل القنوات".

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended; it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 24 was the 24th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Six CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: it starts on onboarding, or on the live screen once a source is stored, with `?screen=hello` and `?screen=gallery` as developer screens;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk ending on the live screen and its two walk seeds (72 runs, 50 seeds);
  6. a Conventions line: UI text comes only from the catalogs through `appI18n` (ADR-011), `zoma/no-hard-coded-text` enforces it, text arguments are isolated by core's `isolateText`, and a screen with an input uses `TextField`/`createTextEditor`.
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
