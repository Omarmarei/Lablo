# Zoma IPTV: relay leg 16 opening prompt

You are leg 16 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it. Legs 1–5 did steps 1–4 (PRs #1–#5); leg 6 did no project work; legs 7–14 did steps 5–9c (PRs #6–#13). Phase 3 (data) is done.
- **Leg 15 did step 10: the focus engine** (Phase 4, PLAN 4.1, the first UI step).
  - PR **#14**, commit `7b4100d`, merged as merge commit **`4438efe`** (the branch was kept).
  - CI `verify` (6 m 45 s), `engines` (2 m 23 s) and `media` (6 m 49 s) were green on `7b4100d`.
- **The relay was paused after leg 15 at Omar's request** ("Pause after this leg finishes"). Leg 15 reported `needs-you` with the main-budget question below, so no leg started by itself. If you are running, Omar resumed the relay.

## Your step: step 11, the design system (RELAY.md Phase 4, PLAN 4.2), but only once the main budget is decided
- **Gate first.** Read RELAY.md's "Main bundle budget" note and the progress log.
  - If a decision is recorded there (or in Omar's message that started you), follow it.
  - If not, **stop as needs-you before writing step-11 code**, with the three options below as a numbered list.
  - Main is **470.3 KB of 500** (tizen; webos 468.9). Step 11 (components, a virtual list, tokens; fonts and CSS may count too, so check how `tools/build` ships CSS) will not fit in about 30 KB.
- **The budget options:**
  1. **(recommended)** count inlined workers only against their own 150 KB budgets, and keep the 500 KB for the main thread's own code (a worker string isn't parsed as code until the worker starts);
  2. ship the workers as separate files (needs spike S1: `file://` workers on the TVs);
  3. raise the main budget.
- **Never raise or redefine a budget without Omar's word.** Option 1 means changing `tools/build` (the budget check) plus its tests, and the CLAUDE.md `build:tv` row; CLAUDE.md edits need his direct word.
- **Step 11, what:** design tokens; Arabic and Latin woff2 font subsets; base components; a virtual list driven by the focus engine's `ZonePosition.top`; `postcss-rtlcss` (the TV build has no PostCSS yet, so add it to `build:tv`); pseudo-locales.
- **Done when:** Playwright screenshots exist in en, ar and pseudo. Plus `pnpm verify`, `verify:engines --self-test` if the build changes (it will: PostCSS), a PR merged on green CI, and a "press these keys" checklist.
- **Size of step 11:** it is big. Split it the way legs 10, 12 and 13 split theirs if needed, and write the split into RELAY.md.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check `main`: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `4438efe` (PR #14's merge) was in progress at handover. If a job is red, fix it on the relay branch before anything else.
3. `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree is your isolation. Edit it by path; use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths, and Read/Edit/Write. **Don't `cd`** in Bash. For a script that needs the worktree as its cwd, use `python -I -c "import os,runpy; os.chdir(r'<wt>'); runpy.run_path('<script>')"` or `pnpm --dir "<wt>" exec …`.

## Read first, in this order
1. **`CLAUDE.md`:** conventions, the Chromium 53 cheat sheet (no CSS Grid, flex `gap`, sticky, logical properties), package boundaries (`ui` may import core, player, data (client only) and platform-api), Definition of Done, merge policy, commit format.
2. **`RELAY.md`:** step 10 (ticked, with what was built), the "Main bundle budget" note, Phase 4 step 11, and the leg-15 progress-log row.
3. **`docs/architecture.md` §1.2:** the UI framework and "Built in step 10: the focus engine". It covers the API, the logical directions, the zones, the router, the Magic Remote, and the click-dedupe question left for step 11.
4. **`docs/PLAN.md`:** the UI row and Phase 4 / 4.2. PLAN.md wins on any conflict.
5. **Code:**
   - `packages/ui/src/focus/*`: `createNavigator`, `ZoneSpec`, `Screen.position/update/hover`, `watchPointerMoves`.
   - `apps/tv/src/focus-demo.ts`, `FocusPanel.tsx` and `App.tsx`: how the app wraps the engine in a signal, and the pointer, wheel and `onPointer` wiring.
   - `apps/tv/src/app.css`: the hello screen's CSS, which is not yet RTL-aware beyond `dir` on the focus block.
   - `tools/build/src/bundle.ts`: CSS handling and the budgets.

## What step 10 built (use it, don't rebuild it)
- **Engine:** `createNavigator({ root, rootBack, exit, exitDialog, dir })` returns a `Navigator`:
  - `handle(intent)`, `back`, `push`, `replace`, `reset`, `pop`;
  - `setDir`, `pointer(visible)`, `wheel(steps)`;
  - `snapshot()` gives `{ screen, zone, index, time, depth, pointer, dir }`; `subscribe` notifies once per change.
- **Screen handles:**
  - `position(zone)` gives `{ index, top, time, view }`;
  - `update(zone)` (a new count) keeps each position where it still fits;
  - `focus(zone, index, time?)`, `reset(zone)`;
  - `hover(zone, index, time?)` works only on the top screen and while the pointer is shown.
- **Zones:**
  - `list`: `axis`, `count`, `visible`, `wrap`, `neighbours`;
  - `grid`: `columns`, `count`, `visibleRows`;
  - `epg`: `rows`, `visibleRows`, `from`, `to`, `span`, `slot`, `now`, and `cell(row, minute)`, whose gaps the screen fills with placeholder cells;
  - `free`: logical rects.
- **Directions are logical:** `moveDirection` is the one RTL swap, and neighbours use `start`/`end`. The layout is written once, and `dir="rtl"` mirrors flex rows.
- **Keys:**
  - CH_UP and CH_DOWN page vertical lists, grids and the guide's rows;
  - OK goes to `onSelect`, and every Intent goes to `onIntent` first;
  - a key hides the pointer.
- **Back on the root:**
  - `exit-dialog` (Tizen, browser) calls `exitDialog`, and the app pushes its `exit` screen;
  - `platform-back` (webOS) calls `exit`, which is `platform.exitApp()`.
- **Platform:** a new `onPointer(listener)`. webOS reports `cursorStateChange` through `watchCursorState`; Tizen and the browser have none.
- **App:** every key goes to `focus.nav.handle`.
  - `watchPointerMoves(window, …)` shows the pointer on real moves.
  - A non-passive `wheel` listener calls `nav.wheel(±1)` and `preventDefault`.
  - `localeDir(locale)` sets the direction once device info arrives.
- **Not done:** selecting with a pointer click. webOS also sends key 13 for the Magic Remote's OK, so a click handler would select twice. Decide the dedupe with the components.
- **The ui package** still has no `preact` or `@preact/signals` dependency. Add them with the first components, at the same versions as `apps/tv` (`preact` ^10.29.8, `@preact/signals` ^2.11.4), then run `pnpm install --config.optimistic-repeat-install=false`. Add a `useFocus` binding.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Your session folder is the main checkout: leave it alone.
- **Branch:** HEAD is the commit that adds this `HANDOVER.md` and records PR #14's merge in RELAY.md, on top of `7b4100d`. It is pushed, and the worktree is clean. `main` holds the merge commit `4438efe`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/` (from the last build), `.cache/{media,fixtures,engines}`, Playwright `chromium-1248`, and the Docker image `zoma-old-engines:ba502212364a`;
  - `artifacts/`: `mutate10.py` (44 mutants; run one with `python -I artifacts/mutate10.py "<snippet of the new text>"`), the older `mutate*.py`, `make-size-probe.py`, and `verify.log`, `engines.log`, `mutate10.log`.
- **Local gates on `7b4100d`:**
  - `pnpm verify`: 1041 tests in 74 files, both TV builds, e2e 9/9;
  - `verify:engines --self-test`: 24/24 runs as expected, with 16 seeded failures caught;
  - 44/44 mutants caught.

## Gotchas and lessons (legs 1–15)
**New in leg 15**
- **Vite reloads every open page when it pre-bundles a dependency it found late.**
  - The start-up scan doesn't follow `?worker` imports, so `fflate` (ingest worker only) was found mid-run. With a cold cache (as in CI) that reset the app inside key-driven e2e tests, and they failed intermittently.
  - Fixed with `optimizeDeps.include: ['@zoma/data > fflate']` in `apps/tv/vite.config.ts`. A new npm dependency used only by a worker needs the same entry.
  - To diagnose: `rm -rf apps/tv/node_modules/.vite`, then `DEBUG=pw:webserver pnpm exec playwright test …`, and grep for "new dependencies optimized" and "reloading".
- **Node's `EventTarget.removeEventListener(type, fn, true)` ignores the boolean.** Use `{ capture: true }` for both add and remove (Chromium 53 is fine with the object).
- **`AddEventListenerOptions`:** type `{ passive: false }` as `AddEventListenerOptions`, or TS rejects it (a weak-type error).
- **Size probe for main:** run `artifacts/make-size-probe.py`, then change the probe's input to `apps/tv/src/main.tsx` and `rows.slice(0, 60)` to 1000. Diff the **last** block, which is main (the workers print first).
  - Probe HEAD with `git -C <wt> stash push -- <app files>`, run the probe, then `stash pop`.
  - The "core-js" sum the probe prints counts every non-`src/` path (including `focus/…`), so check the module diff, not that number.
  - Delete `tools/build/src/zz-sizes-probe.ts` afterwards.
- **Engine size:** the focus engine costs about 8 KB minified in main, plus about 3 KB for the demo, with no new polyfills.
- **Mutation lesson:** batching survived until a test asserted that a key pressed while the pointer is shown gives exactly one notification (the nested `pointer(false)` batch).
- **Old-engine harness:** `KEY_STEPS` now carry the focus the app must show after each key (`home · rail 0`, then `details · buttons 0`). If the hello screen's Focus block changes, update `tools/engines/src/scenario.ts`, `e2e/tv-bundle.spec.ts` and `e2e/hello.spec.ts` together.
- **Monitor scripts:** no process substitution (`<(...)`). It broke the first CI monitor, which then repeated lines. This loop worked:
  - `seen=" "; while true; do s=$(gh pr checks N -R Omarmarei/zoma-iptv --json name,bucket --jq '.[] | "\(.name)=\(.bucket)"'); for l in $s; …; done`
  - echo each newly finished job, then break when none is `=pending`; `sleep 45`.
- **Pausing a relay from inside a leg:** `RELAY stop` makes the watcher kill the running leg, and a `handover` report launches the next leg. So "pause after this leg" means finishing the leg (handover written to `next.md`), then reporting `needs-you`.

**From earlier legs (still true)**
- **Bash heredocs mangle backslashes:** `'\\n'` becomes a real newline, even in a quoted heredoc. Write patch scripts with the Write tool into `$CLAUDE_JOB_DIR/tmp` and run `python -I` on them, asserting `s.count(old) == 1`. Use Edit for text with backslashes. The Write tool turns `\uFEFF`/`\u2028` into raw characters.
- **Bundle size:**
  - Babel injects polyfills per file before tree-shaking, so use narrow entries;
  - a class keeps all its methods;
  - `content-key.ts` drags `es.json.stringify`, and `padStart` drags the pad polyfills.
- **TV code:** `lib: ES2017`; `Array.prototype.sort` isn't stable on Chromium 53; prefer `indexOf` to `includes` in hot UI code.
- **Debounce tests over sockets:** fake only `setTimeout`/`clearTimeout`, and only around the wait; switch to real timers before awaiting the network.
- **Mock:**
  - the clock is pinned to 2026-11-02 12:00 UTC, so e2e asserts patterns, never exact now/next;
  - `get_short_epg` answers only channels that have an EPG id;
  - a new scenario needs `faults.test.ts` and the runbook table.
- **IndexedDB:** merge in memory before writing the same key twice in one transaction. Crash tests crash after a write. Database v1/v2 and profile v1 change only through append-only migrations.
- **Old-engine Docker image:** never edit the `RUN apt-get` line (an hour-long rebuild); add layers after it and list new COPY files in `IMAGE_FILES`. TaskStop on a background `verify:engines` leaves its `docker build` running.
- **Mutation runs:** never while `pnpm verify` or `verify:engines` builds from the same source. Each mutant has a 180 s timeout; restore from `.bak` if a run is killed. A synchronous infinite-loop mutant hangs Vitest, so don't use one.
- **Smart App Control is ON.** Pin older native binaries; never weaken lint. **pnpm 11:** new dependencies must be at least 2 weeks old.
- **Repo layout:**
  - package tests go in `src`; cross-package tests go in root `test/`;
  - `tools/*` may import only core, protocol and crypto;
  - a new worker entry needs an `exports` entry, an `entry-point` rule, a `lint-boundaries` case and a `?worker` import.
- **CI:** about 5–7 min for `verify`, 2–3 for `engines`, 7–11 for `media`. Wait about 20 s after `gh pr create` before reading checks.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fast-check 4.10, fake-indexeddb 6.2.6, fflate 0.8.3, unrs-resolver 1.12.2.
- **Commits:**
  - a scoped `git add` and `git commit -F <file>`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI (standing approval), keeping the branch, and list the 3 riskiest changes.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Three gaps are open:
  - the "deep imports" convention doesn't mention `@zoma/data`'s four extra entries;
  - the Commands table lacks `pnpm epg:report`;
  - the `build:tv` row doesn't say the main budget includes the inlined workers.

## The 3 riskiest changes in PR #14
1. **Every remote key now goes through the focus engine.** Back on the root no longer exits at once: Tizen and the browser show an exit dialog, and webOS calls `platformBack`.
2. **The `Platform` interface gained `onPointer`.** All three adapters implement it; webOS listens to `cursorStateChange`.
3. **Main is at 470.3 of 500 KB (94%).** The Vite dev config changed too (`fflate` pre-bundled).

## Verified vs not
- **Verified:**
  - unit tests in LTR and RTL, and the "done when";
  - local `pnpm verify`, `verify:engines --self-test` (the focus moves in Chromium 53/56/68) and 44/44 mutants;
  - dev e2e on a cold Vite cache, 3 times;
  - CI green on `7b4100d`, merged as `4438efe`.
- **Not done:**
  - CI on `main` at `4438efe` (in progress at handover);
  - the Magic Remote on a real LG TV (`cursorStateChange`, the wheel, the OK/click overlap);
  - the exit dialog on a real Samsung;
  - steps 11 and later.
- **Migrations and deploys:** N/A. There is no backend until step 29, and the TV "deploy" is a store submission.

## Try it (Omar, desktop, step 10)
`pnpm dev`, then open `http://localhost:5173/` at 1920x1080. The **Focus** block sits under the Remote panel and starts on `home · list 0`.
1. Press Down 5 times: the list scrolls (4 rows show). Right goes to the grid; Left twice comes back to the same row (thin outline = remembered).
2. PgDn moves a page. Enter opens "Opened list N"; Esc closes it, and the focus is where it was.
3. Move the mouse over a tile: it takes the focus. An arrow key then carries on from it. The wheel scrolls the focused list.
4. Esc on the main screen shows "Exit Zoma?". Enter on Stay closes it; Right then Enter on Exit shows "Back: exit requested".
5. Open `/?locale=ar-SA`: the Focus block runs right to left. Left moves along the rail towards its end and Right comes back; Up and Down are unchanged.

## Open decisions and gates
- **Main bundle budget:** blocks step 11 (options above; option 1 recommended).
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).
- **Relay cap:** 40 legs; leg 15 was the 15th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Three CLAUDE.md gaps** wait for his word (above).
- **The main-budget decision** is due now, before step 11.
- No secrets have been shared, so nothing needs rotating.
