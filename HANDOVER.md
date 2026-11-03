# Zoma IPTV: relay leg 24 opening prompt

You are leg 24 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–22 did steps 1–13b (PRs #1–#21). Leg 6 did no project work.
- **Leg 23 did step 13c** (onboarding on Chromium 53/56/68 in the old-engine harness). Steps **13c and 13** are ticked in RELAY.md.
  - Commits `b2cd2eb` (the walk) and `7165ac9` (a fix CI found). PR **#22** was merged as merge commit **`bb73826`**, with the branch kept.
  - CI on `7165ac9`: `verify` 3 m 47 s, `engines` 5 m 51 s and `media` 5 m 49 s, all green. The first CI run on `b2cd2eb` failed `engines` (see the gotchas).
  - Nothing in the app changed. Only `tools/engines`, its tests, one variable in `e2e/onboarding.spec.ts`, `ci.yml` (screenshot upload) and the docs did.

## Your step: 14, the live browse screen (PLAN 4.5)
RELAY.md step 14 is the spec: "Category rail, virtual channel list, now/next, `RemoteDriver` e2e, CPU-throttled smoke test. Ends with a click-through checklist for Omar." **Done when:** the e2e tests are green and the checklist is in the handover.

1. **Check first** that none of it exists: `git log --oneline -15`, and grep for `live`, `RemoteDriver`, `focusPath` and `__ZOMA_TEST__` in `apps/tv/src`, `packages/ui/src` and `e2e`.
2. **Read the design** before coding:
   - architecture.md §1.2 (the focus engine, zones, `VirtualList`, and "Built in step 11b" for the components and the gallery);
   - §4, lines ~816–826: the e2e strategy. `RemoteDriver` presses Intents and checks `window.__ZOMA_TEST__.focusPath()` (focus ids from the engine, not the DOM), at 1920x1080. The CPU-throttled smoke is 4x. There is also a forced low-tier mode;
   - PLAN.md "4.5" (and line 472).
3. **This step is probably too big for one leg.** If it is, split it in RELAY.md first (as legs 21 and 22 split 13), commit the split, then do the first part. One possible split:
   - 14a: the screen itself (category rail, virtual channel list, now/next from the query worker), opened by "Start watching" and by a start with a stored source;
   - 14b: `RemoteDriver`, `__ZOMA_TEST__.focusPath()`, the CPU-throttled and low-tier smoke runs, and the old-engine harness on the new screen.
4. **Where it plugs in:**
   - `apps/tv/src/main.tsx`: `showHello` is what "Start watching" (`finish` in `showOnboarding`) and a stored source (`startPoint` → `home`) open today. The live screen replaces both. Keep `?screen=hello` as the developer screen: the harness's hello runs and `e2e/hello.spec.ts` use it.
   - **The data:**
     - The shared `DataEngine` (`dataEngine()` in main.tsx) is the source.
     - The hello screen's `apps/tv/src/DataPanel.tsx` shows the calls: `engine.query.call('categories', { src, kind: 'live' })`, `engine.query.call('chunk', { src, kind, catIdx, chunk })`, `engine.nowNext(keys)`, `engine.search`, `engine.focusChannel`.
     - Sources come from the profile (`storedSources` in `apps/tv/src/onboarding/engine-loader.ts`; ids `s1`, `s2`…).
   - **The UI:** `packages/ui` already has `VirtualList`, `ListRow` (88 px rows, `CHANNELS_VISIBLE` = 7 at 1080p), `Chip`, `Tile`, `Badge`, `Spinner`, the focus engine (`createNavigator`, `useZone`, `useFocus`, `connectRemote`) and the i18n runtime (`appI18n`, catalogs in `apps/tv/src/i18n/{en,ar}.ts`). The gallery (`apps/tv/src/gallery`) is a working channel list with a rail.
5. **The old-engine walk ends on the hello screen.** `tools/engines/src/onboarding.ts` steps `start-watching` and `relaunch` expect `hello: true, helloIdle: true` (the hello screen's last data row, `shortepg-status`). The `seed-walk-forgets-profile` seed is caught at the relaunch. When the live screen replaces the hello screen there:
   - give the walk the live screen's ready signal and an "its workers are idle" signal;
   - update `walkSteps`, `WALK_EXPRESSION`, the unit tests, `test/engines-onboarding.test.ts` and the runbook (`docs/runbooks/old-engines.md`, item 6);
   - run `pnpm verify:engines --self-test`.
   - The e2e `onboarding.spec.ts` and `tv-bundle.spec.ts` also expect the hello screen after "Start watching" and on a relaunch.
6. Follow the Definition of Done in CLAUDE.md: `pnpm verify`, `verify:engines --self-test` (boot code changes), a PR merged on green CI, and a "press these keys" checklist. UI work isn't verified until the flow has been exercised in the running app (`pnpm dev` plus `pnpm mock`, or Playwright screenshots looked at, the Arabic ones too).

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `bb73826` started at handover. If a job is red, fix it on the relay branch first.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.
4. Start Docker Desktop if `docker info` fails (needed only for `verify:engines`).

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths. Don't `cd` in Bash.
- When a script needs the worktree as its cwd, use `python -I -c "import os,subprocess,sys; os.chdir(r'<wt>'); sys.exit(subprocess.call('<cmd>', shell=True))"`.
- Never use bare `git stash`: the stash stack is shared with the main checkout and other sessions.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the package boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 14, and the leg-23 row of the progress log.
3. architecture.md §1.2 (focus engine, "Built in step 11b", "Built in step 13a/13b/13c"), §1.4–1.5 (catalog and EPG pipelines, what the query worker serves) and §4 (test strategy).
4. `apps/tv/src/main.tsx`, `apps/tv/src/gallery/*`, `apps/tv/src/DataPanel.tsx`, `packages/ui/src/components/{VirtualList,ListRow}.tsx`, and `e2e/gallery.spec.ts` plus `e2e/onboarding.spec.ts` for the e2e helpers (`keys`, `focus`, `layout`, `checkScreen`, the mock in `beforeAll`).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and the leg-23 progress row, on top of `7165ac9`. It is pushed, and the tree is clean.
- **main** has `bb73826`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/` (built from `b2cd2eb`'s app code, which is unchanged since 13b), `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, the `zoma-old-engines:*` images;
  - in `artifacts/`: `mutate13c.py` (40 mutants, all caught; run one with `python -I -u artifacts/mutate13c.py "<snippet>"`), `mutate13b.py`, `mutate13a.py`, `make-size-probe3.py`, `probe13c.ts` (a one-engine CDP probe: `pnpm exec tsx artifacts/probe13c.ts chrome53 webos ar`), the logs `verify13c.log`, `engines13c.log` and `mutate13c.log`, `engines/onboarding-*.png`, and `screenshots/`.
- **Local gates on `7165ac9`:** `pnpm verify` green (1946 tests in 103 files, both builds through both gates, main's own code 166.3 KB tizen of 500, e2e 38/38); `verify:engines --self-test`: all 72 runs as expected in one run, 50 seeded failures caught; 40/40 mutants.

## Gotchas and lessons
**New in leg 23 (also saved to memory as `iptv-old-engine-walk`):**
- **CDP typing on old engines:** `Input.insertText` doesn't exist in Chromium 53. `Input.dispatchKeyEvent` `type: 'char'` with `text` per character types into the focused input on 53/56/68 (keypress and input events, no keydown). A `rawKeyDown` Backspace deletes in an input.
- **Fresh IndexedDB in the harness:** delete `zoma` from the staged `file:///app/blank.html` (same `file://` origin; the Blob workers' database is the page's), only while no app page is open.
- **Never leave a page while its data workers are in IndexedDB.** On CI's slower Chromium 53, leaving the relaunched hello screen 0.2 s after it showed left the next `deleteDatabase` with no answer at all (`pending`: no success, error or `blocked`) for 10 s. It never happened locally. The walk now waits for the hello screen's last data row, gives the delete 20 s, and checks the delete after the last walk. Any new harness screen that starts data workers needs an "idle" signal.
- **A same-URL relaunch:** mark the old window (`window.__zomaStale`) before `Page.navigate`. On 68 the guard was never needed (a mutant without it survived), but it is cheap.
- **Measured** (step 13b's profile wait, empty database): first screen 0.1–0.2 s locally (0.2–0.3 s on CI); load about 2 s on 53/56 and 0.8 s on 68 locally (3.5–4.3 s and 1.4–2.1 s on CI); relaunch 0.2–0.4 s.
- **The `engines` CI job** is now about 6 minutes (it was ~3.5) with the 18 new runs. `media` is the longest job.
- **A Bash heredoc with backticks in a Python patch broke again.** Write patch scripts with the Write tool, then run them with `python -I`.

**From earlier legs (still true):**
- **Polyfills:**
  - `new RegExp(...)` in TV code pulls in core-js's RegExp (+7 KB), and `.split(` pulls in `es.string.split` (+2 KB).
  - Babel picks polyfills by property name, even on your own objects (`at`, `values`, `includes`…).
  - A package index import drags in every module's polyfills: import from `@zoma/data/client`.
- **Terser `ascii_only`:** each Arabic character costs 6 bytes in main.js.
- **The Write tool turns `\uXXXX` escapes into raw characters.** In TV code, use `String.fromCharCode`, and scan for U+200E/200F/202A–202E/2066–2069 afterwards.
- **Bash heredocs (even quoted) still lose `\\`.** Write Python patch scripts with the Write tool, then run them with `python -I`. Print Arabic only after `sys.stdout.reconfigure(encoding='utf-8')`.
- **Keys aimed at an `<input>` never reach the focus engine.** In e2e: Enter opens the field, `page.keyboard.type`, then Enter. A click within 500 ms of an OK key is dropped as that key's twin.
- **`nav.back()` skips the screen's `onIntent`.** Tests of Back must send `nav.handle('BACK')`.
- **Text arguments carry six invisible characters** (LRM/RLM outside FSI/PDI). Compare with `stripIsolates`, or `isolated()` in e2e. Chromium 53/56/68 ignore FSI/PDI: check any new bidi-sensitive text with the harness's probe pattern.
- **Look at the Arabic screenshot after any text change.** A Latin span followed by digits needs `dir` on the span.
- **Root `test/` can't import `@zoma/ui`** (and has no JSX in tsc): use relative non-tsx imports. e2e can import `../packages/core/src/*`, `../tools/engines/src/*` and `../apps/mock-provider/{src,test}/*`.
- **Components stay hook-free** (VNode-walk unit tests).
- **CSS:** physical properties only; postcss-rtlcss mirrors by the page's direction.
- **Old-engine harness:**
  - Docker image: never edit the `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - A container can miss DevTools once (it happened to 56 again this leg): rerun with `--engine`.
  - Engine runs overwrite `artifacts/engines`.
  - The headed Chromium 53–68 page is 1919x974 unless the run uses `--kiosk --test-type`.
- **Profile and IndexedDB:**
  - Never `await` inside a transaction (on Chromium 53 it commits early).
  - The same key twice in one IDB transaction loses an update.
  - A page-side `indexedDB.open('zoma')` before the app boots creates an empty v1 database.
- **The mock in e2e:**
  - Start it in `test.beforeAll`; type `host:port` without `http://`.
  - Logins come from `apps/mock-provider/test/helpers` (`U`/`P`) and `fixtures/server.yaml`.
  - Counts: 12 live, 6 films, 2 series, 11 of 12 channels with a guide. Check `data-n`, not the Arabic digits.
- **Mutation scripts:** run them with `python -I -u`. They edit sources in place, so don't run other tests or builds while one runs.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. **Smart App Control is on:** never weaken lint.
- **TV code:** `lib: ES2017`.
- **Commits:**
  - scoped `git add`, then `git commit -F`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes;
  - after `gh pr create`, wait about 30 s before reading the checks (`wait_checks.py`-style poller with `python -I -u`; process substitution fails in Monitor).
  - If the auto-mode classifier gives no verdict on the merge, retry once.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Six gaps are open:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: it starts on onboarding, or on the hello screen once a source is stored, with `?screen=hello` and `?screen=gallery` as developer screens;
  5. the `verify:engines` row should mention the gallery checks, the CSS seeds, the Arabic phase, and now the onboarding walk and its two walk seeds (72 runs, 50 seeds);
  6. a Conventions line: UI text comes only from the catalogs through `appI18n` (ADR-011), `zoma/no-hard-coded-text` enforces it, text arguments are isolated by core's `isolateText`, and a screen with an input uses `TextField`/`createTextEditor`.

## The 3 riskiest changes in PR #22
1. **The walk's end depends on the hello screen.** "Start watching" and the relaunch expect the hello screen and wait for its last data row (`shortepg-status`) before leaving. Step 14 must move both to the live screen with an equivalent idle signal, or the walk (and the forgets-profile seed's catch) breaks.
2. **The `engines` job got longer and more timing-sensitive:** 18 new runs, about 6 minutes in total. One CI stall (the `pending` delete) was already found and fixed. A slower runner could still expose another, which fails the run with a named step.
3. **Seed screens and the fixture check changed shape.** The syntax seeds now run on `SYNTAX_SEED_SCREENS` (hello, gallery), since `APP_SCREENS` gained `onboarding`. `DataCheck` gained `live` and `movies` (cross-checked against core's parser).

## Verified vs not
- **Verified:**
  - onboarding by keys in en and ar on Chromium 53, 56 and 68, in both bundles, from `file://`: typing, DOM focus, Backspace, the load through the data workers, the counts, the stored profile, "Start watching" and the relaunch skip;
  - six screens measured on each engine;
  - the Arabic form and done screenshots looked at on 53 and 68 (they match);
  - both walk seeds caught on every engine;
  - CI green, merged.
- **Not done:**
  - step 14;
  - any TV keyboard on hardware (step 16, S10);
  - IndexedDB behaviour on the real TVs when the app is closed mid-load (worth adding to spike S1, given the CI stall);
  - CI on main at `bb73826` (it started at handover).
- **Migrations and deploys:** N/A (no backend until step 29).

## Run this (Omar, optional; needs Docker Desktop)
Step 13c is harness-only, so there is nothing new to press in the app; leg 22's checklist still covers onboarding in the desktop browser.
1. `pnpm build:tv`, then `pnpm verify:engines --engine chrome53`. You should see six `PASS` lines, two of them `onboarding` with `en: first screen 0.2 s, load 2.0 s, relaunch 0.2 s; ar: …`.
2. Open `artifacts/engines/onboarding-chrome53-webos-ar-form.png` and `-ar-done.png`: the typed link in a right-aligned box, then "كل شيء جاهز" with 2,400 channels and 600 films.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended; it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 23 was the 23rd.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Six CLAUDE.md gaps** are waiting for his word (listed above).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
