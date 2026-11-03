# Zoma IPTV: relay leg 18 opening prompt

You are leg 18 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work.
  - Legs 1–16 did steps 1–11a (PRs #1–#15). Leg 6 did no project work.
- **Leg 17 did step 11b** (PLAN 4.2): the components, the virtual list, the en-XA pseudo-locale and the component gallery.
  - It was one commit, `a69799f`. PR **#16** was merged as merge commit **`b2cf645`**, with the branch kept.
  - CI on `a69799f`: `verify` 4 m 55 s, `engines` 2 m 7 s and `media` 8 m 46 s, all green.
  - Leg 17 also added step **11c** to RELAY.md. Step 11 gets its tick with 11c.

## Your step: 11c, the gallery on the old engines (RELAY.md Phase 4)
The old-engine harness also opens `index.html?screen=gallery` for both bundles in Chromium 53/56/68.
- **Checks:**
  - it boots with no errors and reaches `[data-testid=gallery][data-ready=true]`;
  - 7 rows (`[data-testid=channels] .z-row`), each 88 px tall;
  - every component box is inside the 96/54 px safe area;
  - ArrowDown makes `row-1` `data-state="focused"`;
  - the fonts have loaded.
- **Screenshots:** save a CDP `Page.captureScreenshot` per engine and platform, for example `artifacts/engines/gallery-<engine>-<platform>.png`. The CI `engines` job uploads them; that job already uploads `artifacts/engines/report.json` as `old-engines-report`.
- **Self-test:** add a seeded gallery failure, for example a variant whose `app.css` lacks `ListRow.css`, so the rows lose their 88 px height. It must be caught on every engine.
- **Done when:**
  - `verify:engines --self-test` passes with the gallery checks;
  - the seed is caught;
  - the Chromium 53 screenshots exist;
  - a PR is merged on green CI.
- **Where:**
  - `tools/engines/src/scenario.ts`: `runPlatform`, `STATE_EXPRESSION` (plain ES5, unit-tested at ecmaVersion 5), `waitFor`, `pressKey`, `evaluateRun`;
  - `tools/engines/verify-engines.ts`: the `runEngine` loop, which runs variants × platforms;
  - `tools/engines/src/variants.ts`: `APP_VARIANT`, `SEEDS` and `minChrome`;
  - `cdp.ts`;
  - the runbook `docs/runbooks/old-engines.md`.
- **Reuse the e2e checks.** `layout()` in `e2e/gallery.spec.ts` already has the selectors and the safe-area check; rewrite it as ES5 for the harness.
- **Then:** if this leg is still light, step 12 (i18n) is next. Otherwise hand over.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `b2cf645` started at handover. If a job is red, fix it on the relay branch first.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths. Don't `cd` in Bash.
- When a script needs the worktree as its cwd, use `python -I -c "import os,subprocess,sys; os.chdir(r'<wt>'); sys.exit(subprocess.call('<cmd>', shell=True))"`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the package boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: the 11b entry, 11c, and the leg-17 row of the progress log.
3. `docs/architecture.md` §1.2, "Built in step 11b".
4. `docs/runbooks/old-engines.md`, then the harness files listed above.

## What 11b built (use it, don't rebuild it)
- **Binding** (`@zoma/ui`):
  - `bindFocus(nav)` → `{ nav, focus: signal, dispose }`; `useFocus`.
  - `useZone(binding, screen, zone)` → `{ spec, position, active, state(i), item(i) }`. `item(i)` is `{ state, onHover, onPress }`; spread it into a component.
  - `Screen.zone(id)`.
  - `connectRemote({ platform, nav, target, onIntent })`: the keys, the wheel and the pointer.
  - `localeDir`.
- **Pointer click:** `Screen.click` focuses and selects.
  - An OK key and a click within `OK_CLICK_WINDOW_MS` (500) count as one press, and the second returns `duplicate`.
  - The clock is injectable (`NavigatorOptions.now`).
  - Only the arrows and CH_UP/CH_DOWN hide the pointer.
- **Components:** Button, Chip, ListRow, Tile, Dialog, ProgressBar (`media` = LTR), Spinner and Badge, all in `packages/ui/src/components`.
  - None of them uses hooks or holds its own text.
  - The provider's text gets `dir="auto"` and `translate="no"` (`data` props on Chip and Badge).
- **VirtualList:** a vertical or horizontal window from `ZonePosition.top`.
  - Fixed `itemSize`; the gap comes from the `--z-vlist-gap` custom property.
  - `listWindow` and `listHeight` are exported.
- **`pseudoLocalize`** and `PSEUDO_LOCALE` (`en-XA`).
- **The gallery:** `apps/tv/src/gallery` (`GalleryApp.tsx`, `gallery-state.ts`, `gallery-data.ts`, `gallery-text.ts`, `gallery.css`), opened by `readScreen` in `data/params.ts`.
  - 1920x1080 at the 96/54 safe area: 7 of 240 rows and 6 of 9 chips.
  - It is in both TV bundles (about 10 KB) and starts no data workers.
- **Screenshots:**
  - e2e writes `artifacts/screenshots/gallery-{en-US,ar-SA,en-XA}{,-dialog}.png`, and CI uploads them as `gallery-screenshots`;
  - the step-11b set is in `docs/design/*.webp`.
- **Sizes:** main's own code is 121.2 KB (tizen) and 119.8 KB (webos) of 500; app.css is 26.6 KB.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `a69799f`. It also records the merge in RELAY.md. It is pushed, and the tree is clean.
- **main** has `b2cf645`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/`, `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, and the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate11b.py` (41 mutants, 2 of them e2e; run one with `python -I artifacts/mutate11b.py "<snippet>"`);
    - `shoot11b.mjs` (a quick screenshot script, run against a dev server);
    - `screenshots/`, `look/`, `sizes-11b-*.txt`;
    - the logs `verify.log`, `engines.log` and `mutate11b.log`.
- **Local gates on `a69799f`:**
  - `pnpm verify`: 1203 tests in 85 files, both builds through both gates, e2e 20/20;
  - `verify:engines --self-test`: 24 runs as expected, 16 seeds caught;
  - 41/41 mutants caught.

## Gotchas and lessons
**New in leg 17 (also saved to memory):**
- **Babel picks polyfills by property name, even on your own objects.** A field named `at` pulled in `Array.prototype.at` and `String.prototype.at`; it is now named `time`.
  - Check new files with a per-file probe: `transformSync` with bundle.ts's preset, listing the `core-js/modules/*` imports.
- **CDP `CSS.getPlatformFontsForNode` covers inline descendants only, not block or flex children.** For a layout subtree, use `renderedFontsUnder` (`e2e/fonts.ts`).
- **postcss-rtlcss never mirrors inline styles.** Pass numbers as CSS variables, and put the directional property in a CSS rule.
- **Arabic bidi reverses a time range** (`a / b`): put `dir="ltr"` on it.
- **Components without hooks can be unit-tested with no DOM.** Call them as functions and walk the VNodes (`components/vnode.test-helpers.ts`). Keep them hook-free.
- **The Windows checkout is case-insensitive:** `gallery.ts` next to `Gallery.tsx` failed with TS1261.
- **Playwright e2e:**
  - It won't click an `aria-disabled` element without `force: true`.
  - Use `screenshot({ animations: 'disabled' })`, or a screenshot can catch a focus transition half-way.
  - A hover moves the focus, so park the mouse at `(1900, 1070)` before a wheel test.
- **Python patches inside a Bash heredoc break** on mixed quotes and backticks, and on `\n`. Write the script with the Write tool and run it with `python -I`.
- **The mutation script edits sources in place.** Don't edit those files while it runs (docs are fine).

**From earlier legs (still true):**
- **Vite:** a worker-only dependency needs an `optimizeDeps.include` entry in `apps/tv/vite.config.ts`, or a cold cache reloads pages mid-test.
- **Node `EventTarget`:** pass `{ capture: true }`, not `true`.
- **Old-engine harness:**
  - `KEY_STEPS` focus strings: change `scenario.ts`, `e2e/tv-bundle.spec.ts` and `e2e/hello.spec.ts` together.
  - The hello title must keep both Latin and Arabic text.
  - Docker image: never edit the `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - Docker Desktop: start it with PowerShell `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, then wait with an until-loop on `docker info`.
- **CI monitor:** use the Monitor loop (`sleep 25; seen=" "; while true; do s=$(gh pr checks N …) …; sleep 45; done`). Process substitution doesn't work in it.
- **New dependencies:** the two-week rule includes transitive packages. Check the lockfile diff against the registry; pnpm doesn't enforce it.
- **Smart App Control is on:** pin older native binaries, and never weaken lint.
- **Repo layout:**
  - tests that read files from disk, or span packages, go in root `test/`;
  - `tools/*` may import only core, protocol and crypto.
- **TV code:** `lib: ES2017`; `Array.prototype.sort` isn't stable on Chromium 53.
- **Commits:**
  - scoped `git add`, then `git commit -F <file>`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Open gaps:
  - `@zoma/data`'s extra entries;
  - `pnpm epg:report` and `pnpm fonts` in the Commands table;
  - the CSS pipeline and gate in the `build:tv` row;
  - new: `?screen=gallery` among the `pnpm dev` URL overrides.

## The 3 riskiest changes in PR #16
1. **Only the keys that move the focus hide the pointer now.** OK and Back leave it shown, so a screen that appears under a visible pointer focuses the hovered item.
2. **The OK/click pairing can drop a real OK** that lands within 500 ms of a click. The webOS event order is still unchecked on a real TV.
3. **Main's own code 102.4 → 121.2 KB and app.css 9.7 → 26.6 KB,** because every component's CSS and the gallery now ship.

## Verified vs not
- **Verified:**
  - unit tests;
  - e2e in dev (en, ar and en-XA) and both bundles on `file://`;
  - the old engines: the existing hello checks;
  - 41/41 mutants;
  - CI green, merged.
- **Not done:**
  - the gallery on Chromium 53/56/68 (step 11c);
  - the Magic Remote OK/click order on a real LG TV;
  - fonts and RTL on a real TV (step 16);
  - CI on main at `b2cf645` (it started at handover).
- **Migrations and deploys:** N/A (no backend until step 29).

## Try it (Omar, desktop)
Run `pnpm dev`, then open `http://localhost:5173/?screen=gallery` at 1920x1080. The full checklist is in runbook tv-build.md, under "The component gallery".
1. Down walks the 240 channels, 7 at a time. Up goes to the chips, and Up again to the buttons. Right from the list goes to the tiles.
2. Enter on a row opens "Play …?"; Esc closes it and returns to the same row. Esc on the gallery itself asks "Exit Zoma?".
3. The mouse: hover focuses, a click selects, and the wheel scrolls the list.
4. `&locale=ar-SA` mirrors everything. The media bar still fills from the left.
5. `&locale=en-XA` shows every label as `[Âççéñţéð one]`. Channel names stay plain, and nothing leaves the screen.

## Open decisions and gates
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 17 was the 17th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Four CLAUDE.md gaps** are waiting for his word (listed above).
- No secrets have been shared, so nothing needs rotating.
