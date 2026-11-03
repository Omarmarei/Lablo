# Zoma IPTV: relay leg 17 opening prompt

You are leg 17 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it. Legs 1–5 did steps 1–4 (PRs #1–#5); leg 6 did no project work; legs 7–14 did steps 5–9c (PRs #6–#13); leg 15 did step 10, the focus engine (PR #14).
- **Leg 16 did step 11a** (Phase 4, PLAN 4.2, first half). Step 11 is now split into **11a (done)** and **11b (yours)**; RELAY.md has the split.
  - First commit `eb34737`: Omar's main-budget decision (option 1) applied.
  - Second commit `73b8bac`: the CSS pipeline, design tokens and the Zoma Sans fonts.
  - PR **#15**, merged as merge commit **`9bf54e1`** (branch kept). CI `verify` (4 m 32 s), `engines` (2 m 36 s) and `media` (8 m 27 s) were green on `73b8bac`.

## Your step: 11b, the rest of the design system (RELAY.md Phase 4, PLAN 4.2)
From RELAY.md step 11b:
- **Dependencies:** `ui` gets `preact` ^10.29.8 and `@preact/signals` ^2.11.4 (the versions `apps/tv` has), then `pnpm install --config.optimistic-repeat-install=false`. Add a `useFocus` binding over the navigator (the app today wraps it in one signal in `apps/tv/src/focus-demo.ts`).
- **Base components** on the tokens: Button, Chip (rail), ListRow (channel row: number, name, now/next), Tile, Dialog, ProgressBar, Spinner, Badge. Each imports its own CSS.
- **VirtualList** driven by the focus engine's `ZonePosition.top`.
  - It renders only the window, in rows of `LAYOUT.rowHeight`, with `visible` from `fits()`.
  - Fixed sizes come from layout constants, never DOM measurement.
  - Flow layout of the window, with no absolute positioning, lets `dir="rtl"` mirror rows by itself.
- **Pointer click:** decide the dedupe with webOS's key-13 OK (architecture.md §1.2, "Not done yet"). The suggestion is that a click selects unless an OK key was handled within a few hundred ms, and the other way round, with an injectable clock for tests. Also note that `handle()` hides the pointer on every key, including the Magic Remote's OK. This is a design call you can make yourself; record it in architecture.md.
- **Pseudo-locale `en-XA`:**
  - accented letters (Latin-1 and Latin Extended-A only: the font covers U+0000–017F), about 40% longer, bracketed, placeholders like `{n}` kept;
  - its purpose is to catch truncation and hard-coded strings before step 12's catalogs;
  - a small pure function (ui or core) that step 12's runtime can plug into.
- **A gallery screen** (`?screen=gallery`) showing every component, driven by the remote and fitting 1920x1080 (html and body are `overflow: hidden`).
- **Done when:**
  - Playwright screenshots of the gallery exist in en, ar and en-XA (decide where they live, e.g. `artifacts/screenshots/` uploaded as a CI artifact, or committed under `docs/`);
  - `pnpm verify` is green, plus `verify:engines --self-test` if the build or boot changes;
  - a PR is merged on green CI;
  - a "press these keys" checklist is in the handover and in runbook tv-build.md's "Desktop check".
- **Size:** it is big. If needed, split it as legs 10, 12, 13 and 16 did, and write the split into RELAY.md.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check `main`: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `9bf54e1` (PR #15's merge) started at handover. If a job is red, fix it on the relay branch before anything else.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree,** even though Claude Code's background-session note asks for it. The relay worktree is your isolation.
- Edit it by path; use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths, and Read/Edit/Write.
- **Don't `cd`** in Bash. Leg 16's one `cd` moved the session's primary directory to the worktree: harmless, but avoid it.
- For a script that needs the worktree as its cwd, use `python -I -c "import os,runpy; os.chdir(r'<wt>'); runpy.run_path('<script>')"` or `pnpm --dir "<wt>" exec …`.

## Read first, in this order
1. **`CLAUDE.md`:** conventions, the Chromium 53 cheat sheet, package boundaries (`ui` may import core, player, data (client only) and platform-api), Definition of Done, merge policy, commit format.
2. **`RELAY.md`:** the 11a entry (what was built), 11b, and the leg-16 progress-log row.
3. **`docs/architecture.md` §1.2:** "Built in step 10: the focus engine" and "Built in step 11a: the design system's foundations".
4. **`docs/adr/ADR-003`:** both 2026-11-03 amendments (the main budget, and the CSS gate instead of postcss-preset-env).
5. **`docs/PLAN.md`:** the UI row and Phase 4. PLAN.md wins on any conflict.
6. **Code:**
   - `packages/ui/src/index.ts`, `styles/tokens.css`, `styles/fonts.css`, `design/tokens.ts`, `focus/*`;
   - `tv-css.config.ts`, `tools/build/src/css.ts` and `css-gate.ts`;
   - `apps/tv/src/App.tsx`, `FocusPanel.tsx`, `focus-demo.ts`, `app.css`, `main.tsx`;
   - `e2e/fonts.ts` and `e2e/hello.spec.ts`.

## What 11a built (use it, don't rebuild it)
- **Main budget:**
  - The budget counts main's own code: 102.4 KB (tizen) and 101.0 KB (webos) of 500 KB. Each inlined worker counts against its own 150 KB.
  - Workers go into main.js as placeholders, and their code replaces them after terser (`substituteWorkers`, `BundleResult.inlinedBytes`). `stringLiteral` picks the cheaper quote, so the files stay about 470 KB.
- **CSS:**
  - **Import order:** modules import their CSS (`import './x.css'`). `@zoma/ui`'s index imports `styles/fonts.css` and `styles/tokens.css` first, and `apps/tv/src/main.tsx` imports `app.css` last.
  - **The TV build** (`collectCss` in `bundle.ts`) lists the files in evaluation order. `buildCss` copies `url()` files to `assets/`; remote URLs, missing files and name clashes fail. It then runs `tv-css.config.ts` (postcss-rtlcss, `combined` mode) and the **Chromium 53 CSS gate** (`checkCss`).
  - **Workers:** a worker that imports CSS fails the build.
  - **Dev:** Vite runs the same plugins (`apps/tv/vite.config.ts` `css.postcss`).
- **RTL:** every direction-dependent rule becomes `[dir="ltr"] …` plus a mirrored `[dir="rtl"] …`.
  - The app sets `lang` and `dir` on `<html>` from the device locale (`App.tsx`), and the TV `index.html` starts with `dir="ltr"`.
  - Write the LTR layout with physical properties only. The gate rejects logical properties, Grid, flex `gap`, sticky, `#rgba`, `clamp()/min()/max()`, `:is()/:focus-visible/:focus-within`, nesting, `@layer` and unprefixed `user-select`/`clip-path`/`mask` (use `-webkit-`).
  - A nested `dir` island still matches the page's rtl rules: keep directional CSS out of it, or use `/*rtl:ignore*/`.
- **Tokens:**
  - **CSS:** `--color-*` (bg, surface, surface-raised, surface-focus `#1c3f3c`, border, text, text-muted, accent, focus, warn, danger, success, live, scrim), `--font-size-*`/`--line-height-*` (display 64, title 44, heading 34, body 28, label 24, caption 22), `--space-1..8` (4 px grid), `--radius-*`, `--focus-ring: 4px`, `--screen-*`, `--safe-x/y` (96/54), `--row-height: 88px`, `--rail-height`, `--tile-*`, `--motion*` (0 under `[data-tier='low']`).
  - **Type classes:** `.t-display/.t-title/.t-heading/.t-body/.t-label/.t-caption/.t-muted/.t-bold/.t-truncate`.
  - **TS:** `SCREEN`, `LAYOUT`, `SPACE`, `FOCUS_RING`, `pxTokens()` and `fits(extent, item, gap)`, exported from `@zoma/ui`.
  - **Tests:** `test/ui-tokens.test.ts` keeps the CSS and TS values equal and checks contrast (text and muted text ≥ 4.5:1 on every surface, the focus ring ≥ 3:1). A new colour must pass it.
- **Fonts:** `font-family: var(--font-family)` gives 'Zoma Sans': Noto Sans (Latin) plus Noto Sans Arabic UI, 400 and 700.
  - The woff2 subsets are in `packages/ui/assets/fonts` (about 25 KB each, `fonts.json`, `OFL.txt`), and ship as `assets/*.woff2` plus `assets/fonts-OFL.txt`.
  - `pnpm fonts` (`tools/fonts`) regenerates them deterministically from sources pinned in `tools/fonts/src/spec.ts`.
  - **Noto Sans has no arrows (←↑→↓):** draw key-hint arrows with CSS or SVG.
- **Checks:**
  - **e2e:** `renderedFonts(page, selector)` (CDP `CSS.getPlatformFontsForNode`, whole subtree, sorted) asserts both web faces on the title "Zoma زوما" (dev in en and ar, both bundles from `file://`). The panels' margins mirror in RTL.
  - **Old engines:** the harness waits for `document.fonts.status`, and needs a loaded Latin and Arabic face and no `error` face (`PageState.fonts`, e.g. `la400:loaded ar700:loaded`).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Your session folder is the main checkout: leave it alone.
- **Branch:** HEAD is the commit adding this `HANDOVER.md` and recording PR #15's merge in RELAY.md, on top of `73b8bac`. It is pushed and the worktree is clean. `main` holds the merge commit `9bf54e1`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/` (from the last build), `.cache/{media,fixtures,engines,fonts}` (`fonts` holds the pinned Noto TTFs and licences), Playwright `chromium-1248`, and the Docker images `zoma-old-engines:*`;
  - `artifacts/`: `mutate11a.py` (31 mutants; run one with `python -I artifacts/mutate11a.py "<snippet of the new text>"`), the older `mutate*.py`, `make-size-probe.py`, and `verify.log`, `engines.log`, `mutate11a.log`.
- **Local gates on `73b8bac`:**
  - `pnpm verify`: 1111 tests in 78 files, both TV builds with the ES2016 and CSS gates, e2e 11/11;
  - `verify:engines --self-test`: all 24 runs as expected, 16 seeded failures caught;
  - 31/31 mutants caught.

## Gotchas and lessons (legs 1–16)
**New in leg 16**
- **Vitest gives `import x from './a.css?raw'` an empty string,** and package tests have no Node types (`types: []`). A test that reads CSS from disk goes in root `test/` with `node:fs`.
- **The two-week rule for new dependencies covers transitive packages, and pnpm doesn't enforce it.** After an add, list the lockfile diff's new `pkg@version` entries and look up each one's `time[version]` at registry.npmjs.org (strip the `(peer…)` suffix first, or you get 404/405).
  - postcss-preset-env was rejected this way: about 25 of its 96 packages were five days old.
  - `harfbuzzjs` is pinned to 1.6.3 in `pnpm-workspace.yaml` overrides; lift it with the next font change.
- **`pnpm add` then `pnpm remove` churned the lockfile** (vitest's peer set lost terser and yaml). Reset `pnpm-lock.yaml` and `package.json` from git and add only what you keep.
- **CDP `CSS.getPlatformFontsForNode` covers the element's whole subtree.**
- **`unicode-range` parts can overlap** (U+061C sits inside U+0600-06FF); `rangeCodePoints` dedupes.
- **Docker Desktop was stopped.** Start it with PowerShell `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, then wait with an until-loop on `docker info` (it was up in about 5 s).
- **A Python patch in a Bash heredoc mangled `\n` inside JS text** again: the patch half-applied, since each patch writes immediately. Use Edit for lines with backslashes, or write the script with the Write tool.
- **The `?raw` and Node-types problem decided where tests live:** `test/ui-tokens.test.ts` (root) and `tools/fonts/src/fonts.test.ts` (tools have Node types).
- **The mutation script edits sources in place:** don't touch those files while it runs. It restores from `.bak`.

**From earlier legs (still true)**
- **Vite pre-bundling:** Vite reloads every open page when it pre-bundles a dependency it found late. A new npm dependency used only by a worker needs an `optimizeDeps.include` entry (`apps/tv/vite.config.ts`). To diagnose: `rm -rf apps/tv/node_modules/.vite`, then `DEBUG=pw:webserver pnpm exec playwright test …`.
- **Node's `EventTarget.removeEventListener(type, fn, true)` ignores the boolean:** use `{ capture: true }`. Type `{ passive: false }` as `AddEventListenerOptions`.
- **Size probe for main:** `artifacts/make-size-probe.py`, with the probe's input changed to `apps/tv/src/main.tsx` and `rows.slice(0, 60)` changed to 1000. Diff the **last** block, which is main. Delete `tools/build/src/zz-sizes-probe.ts` afterwards.
- **Old-engine harness:** `KEY_STEPS` carry the focus the app must show after each key (`home · rail 0`, then `details · buttons 0`). If the hello screen's Focus block or title changes, update `tools/engines/src/scenario.ts`, `e2e/tv-bundle.spec.ts` and `e2e/hello.spec.ts` together. The title must keep Latin and Arabic text, or the fonts check fails.
- **CI monitor:** no process substitution in Monitor scripts. This loop worked: `sleep 25; seen=" "; while true; do s=$(gh pr checks N -R Omarmarei/zoma-iptv --json name,bucket --jq '.[] | "\(.name)=\(.bucket)"' || true); …; done`. Echo each newly finished job, break when none is `=pending`, and `sleep 45`.
- **Pausing a relay from inside a leg:** "pause after this leg" means finishing the leg, then reporting `needs-you`.
- **Bash heredocs mangle backslashes:** write patch scripts with the Write tool and run `python -I` on them, asserting `s.count(old) == 1`. The Write tool turns `\uFEFF`/`\u2028` into raw characters.
- **Bundle size:** Babel injects polyfills per file before tree-shaking, so use narrow entries; a class keeps all its methods; `content-key.ts` drags `es.json.stringify`, and `padStart` drags the pad polyfills.
- **TV code:** `lib: ES2017` (no `Object.fromEntries`, no `matchAll`). `Array.prototype.sort` isn't stable on Chromium 53. Prefer `indexOf` to `includes` in hot UI code.
- **Debounce tests over sockets:** fake only `setTimeout`/`clearTimeout`, and only around the wait.
- **Mock:** the clock is pinned to 2026-11-02 12:00 UTC; `get_short_epg` answers only channels with an EPG id; a new scenario needs `faults.test.ts` and the runbook table.
- **IndexedDB:** merge in memory before writing the same key twice in one transaction. Database v1/v2 and profile v1 change only through append-only migrations.
- **Old-engine Docker image:** never edit the `RUN apt-get` line; add layers after it and list new COPY files in `IMAGE_FILES`.
- **Mutation runs:** never while `pnpm verify` or `verify:engines` builds from the same source. Each mutant has a 180 s timeout.
- **Smart App Control is ON:** pin older native binaries, and never weaken lint.
- **Repo layout:**
  - package tests go in `src`; cross-package and file-reading tests go in root `test/`;
  - `tools/*` may import only core, protocol and crypto; root files such as `tv-css.config.ts` are outside the boundary elements;
  - a new worker entry needs an `exports` entry, an `entry-point` rule, a `lint-boundaries` case and a `?worker` import.
- **CI:** about 4–7 min for `verify`, 2–3 for `engines`, 7–11 for `media`. Wait about 20 s after `gh pr create` before reading checks.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fast-check 4.10, fake-indexeddb 6.2.6, fflate 0.8.3, unrs-resolver 1.12.2, postcss 8.5, postcss-rtlcss 6.0.0, subset-font 2.9.0, harfbuzzjs 1.6.3.
- **Commits:**
  - a scoped `git add` and `git commit -F <file>`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI (standing approval), keeping the branch, and list the 3 riskiest changes.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Gaps still open (don't edit them unasked):
  - the "deep imports" convention doesn't mention `@zoma/data`'s four extra entries;
  - the Commands table lacks `pnpm epg:report` and `pnpm fonts`;
  - the `build:tv` row and the cheat sheet don't mention the CSS pipeline and CSS gate (step 11a).

## The 3 riskiest changes in PR #15
1. **Worker inlining changed:** placeholders are swapped in after terser. Every bundle goes through it; the old engines still boot all the workers.
2. **`dir` on `<html>` now decides the layout:** every rule with a direction-dependent declaration matches only through `[dir="ltr"]`/`[dir="rtl"]`. The TV `index.html` starts with `dir="ltr"`, and the app sets it from the locale.
3. **`overflow: hidden` on html/body** (the TV page never scrolls), plus 99 KB of fonts in the package.

## Verified vs not
- **Verified:**
  - unit tests;
  - e2e: both web faces drawn in dev (en and ar) and from both bundles on `file://`, and RTL mirroring in dev;
  - old engines: the fonts load in Chromium 53/56/68;
  - local `pnpm verify`, `verify:engines --self-test` and 31/31 mutants;
  - CI green on `73b8bac`, merged as `9bf54e1`.
- **Not done:**
  - CI on `main` at `9bf54e1` (started at handover);
  - fonts and RTL on a real TV (spike S9, step 16);
  - the Magic Remote on a real LG TV (`cursorStateChange`, the wheel, the OK/click overlap);
  - the exit dialog on a real Samsung;
  - steps 11b and later.
- **Migrations and deploys:** N/A. There is no backend until step 29, and the TV "deploy" is a store submission.

## Try it (Omar, desktop, step 11a)
`pnpm dev`, then open `http://localhost:5173/` at 1920x1080.
1. The title reads **Zoma زوما**, with the Arabic in teal. DevTools → Elements → select the title → Computed → "Rendered Fonts" lists Noto Sans and Noto Sans Arabic UI as network resources.
2. Open `/?locale=ar-SA`: the whole page mirrors. The Device panel is on the right and the catalog panel on the left, the table headings are right-aligned, and the Arabic name sits left of "Zoma". `<html>` has `dir="rtl" lang="ar-SA"`. In the Focus block, Left moves along the rail towards its end.
3. Everything from step 10 still works: arrows, PgDn, Enter/Esc, the mouse hover and the wheel, and the exit dialog on Esc.

## Open decisions and gates
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs and real icons.
- **Relay cap:** 40 legs; leg 16 was the 16th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Three CLAUDE.md gaps** wait for his word (above).
- No secrets have been shared, so nothing needs rotating.
