# Zoma IPTV: relay leg 19 opening prompt

You are leg 19 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work.
  - Legs 1–17 did steps 1–11b (PRs #1–#16). Leg 6 did no project work.
- **Leg 18 did step 11c** (the rest of PLAN 4.2): the component gallery on the old engines. Step 11 is now ticked.
  - It was one commit, `55f5fa7`. PR **#17** was merged as merge commit **`e0245ef`**, with the branch kept.
  - CI on `55f5fa7`: `verify` 4 m 54 s, `engines` 2 m 52 s and `media` 7 m 26 s, all green.
  - The `old-engines-report` artifact (run 41681893314) has the six gallery screenshots and 54 runs, none unexpected.

## Your step: 12, i18n (RELAY.md Phase 4; PLAN 4.3; architecture.md §6, "4.3")
RELAY.md: "Runtime plus en/ar catalogs, Arabic plural forms (6), date and digit formatting, lint against hard-coded strings, in-app language switch."
- **Done when:** lint catches a seeded hard-coded string. As always, also `pnpm verify` green, `verify:engines --self-test` green if the build changes, a PR merged on green CI, and a "press these keys" checklist.
- **Where things go** (architecture.md §1 tree):
  - plural rules in `packages/core`, which is pure ES2017 and Node-safe. `Intl.PluralRules` is missing on Chromium 53, so implement CLDR rules: Arabic has zero/one/two/few/many/other, English one/other;
  - the i18n runtime in `packages/ui/src/i18n` (next to `locale.ts`, which has `localeDir`, and `pseudo.ts`, which has `pseudoLocalize` and `PSEUDO_LOCALE`);
  - the catalogs (en, ar) where the runtime can load them.
- **What exists to build on:**
  - **`pseudoLocalize`** keeps placeholders and ICU syntax: text at an odd brace depth is kept, so `{n, plural, one {# channel} other {# channels}}` accents only the branch texts. An ICU-style message format fits it.
  - **`apps/tv/src/gallery/gallery-text.ts`** is a small en/ar table standing in for the catalogs. Move the gallery onto the real runtime. The en-XA e2e check in `e2e/gallery.spec.ts` (`untranslated()`) must keep passing.
  - **Left for step 12 by 11b** (architecture.md §1.2): isolating the provider's text inside our sentences (FSI/PDI, or `dir="auto"` spans), and the digit forms.
- **The lint:** a rule against hard-coded user-visible strings in JSX and the text props.
  - Follow `test/lint-boundaries.test.ts`, which runs the ESLint API on seeded code; that is how the Done-when gets proven.
  - Prefer a local rule in `eslint.config.js` to a new plugin. New dependencies must be ≥ 2 weeks old, transitive ones included.
  - Exempt the provider's data (`translate="no"` / `data` props), test files and the gallery's demo data.
- **The language switch:** there is no settings screen yet. A switch on the gallery or the hello screen is enough. It must flip `lang`/`dir` on `<html>` and `nav.setDir` live, without a reload.
- **Open product point: the digit forms in Arabic.** The plan doesn't say. CLDR's defaults give Arabic-Indic digits (٠١٢) for ar-SA and Western digits for ar-AE.
  - A sensible default is CLDR per region, with Western digits for channel numbers (remote keys and the provider's `tvg-chno`).
  - If you pick it, record it in an ADR as reversible. If you think it needs Omar, ask with a one-character numbered list (a needs-you stop).
- **Watch the bundle:**
  - `Intl.DateTimeFormat` exists on Chromium 53, but check that the ar locale data is really there in the old engines.
  - Babel injects core-js by property name: probe new files (memory `iptv-tv-bundle-polyfills`).
  - Main's own code is 121.2 KB of 500.
- **Consider splitting:** 12 is big. If it won't fit one leg, split it in RELAY.md into 12a (core plurals plus the runtime and catalogs plus formatting) and 12b (the lint, the language switch, the gallery migration and the old-engine check), as legs 16 and 17 did with step 11.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `e0245ef` started at handover. If a job is red, fix it on the relay branch first.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths. Don't `cd` in Bash.
- When a script needs the worktree as its cwd, use `python -I -c "import os,subprocess,sys; os.chdir(r'<wt>'); sys.exit(subprocess.call('<cmd>', shell=True))"`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet (`Intl.PluralRules` missing), the package boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: the 11c entry, step 12, and the leg-18 row of the progress log.
3. `docs/architecture.md`: §1.2 "Built in step 11b" (the pseudo-locale, the gallery and its text table, and what was left for step 12), and §6 "4.3".
4. `packages/ui/src/i18n/*`, `apps/tv/src/gallery/gallery-text.ts`, `test/lint-boundaries.test.ts` and `eslint.config.js`.

## What 11c built (use it, don't rebuild it)
- **`tools/engines/src/gallery.ts`:**
  - `runGallery` and `evaluateGallery`;
  - the ES5 probe `GALLERY_EXPRESSION`, with the selectors of `layout()` in `e2e/gallery.spec.ts`;
  - `galleryUrl`, `VIEWPORT`, `SAFE_AREA`, `GALLERY_ROWS` and `ROW_HEIGHT`.
- **The gallery checks:** boot, 1920x1080 with no scroll, the safe area, no cut labels or squeezed names, 7 rows of 88 px, ArrowDown → `row-1` focused, and both faces loaded. The screenshots go to `artifacts/engines/gallery-<engine>-<platform>.png`.
- **`scenario.ts` now exports shared helpers:** `readProbe`, `waitForProbe`, `pressKey`, `watchErrors`, `blankPage`, `evaluateFonts(fonts)`, `fontsSettled` and `FONT_FACES_FUNCTION`.
- **`variants.ts`:**
  - `Variant.screens` (`'hello' | 'gallery'`);
  - `CSS_SEEDS`: `seed-css-no-list-row` and `seed-css-no-safe-area`, applied with `removeRules`, `removeDeclarations` and `seedCss`. A seed that finds nothing to take out fails the staging;
  - `no-polyfills` runs hello only, because the gallery needs no polyfill.
- **`engines.ts`:** `TV_SCREEN_FLAGS = ['--kiosk', '--test-type']` gives the page the full 1920x1080. It is passed via `chromeFlags`, so the image is unchanged.
- **`test/engines-gallery.test.ts`** pins the probe to the tokens and the e2e spec, and the seeds to the real CSS sources.
- **A new screen for the harness** (onboarding in step 13, the live list in step 14) follows `runGallery`'s pattern. Run `--self-test` to see which seeds fail on it before you set the variants' `screens`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and recording the merge in RELAY.md, on top of `55f5fa7`. It is pushed, and the tree is clean.
- **main** has `e0245ef`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/`, `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, and the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate11c.py` (36 mutants, 3 of them on the engines); run one with `python -I artifacts/mutate11c.py "<snippet>"`;
    - `mutate11b.py`;
    - `engines/` (report.json and the six gallery PNGs);
    - `screenshots/`;
    - the logs `verify.log`, `engines.log` and `mutate11c.log`.
- **Local gates on `55f5fa7`:**
  - `pnpm verify`: 1235 tests in 87 files, both builds through both gates, e2e 20/20;
  - `verify:engines --self-test`: 54 runs as expected, 38 seeded failures caught;
  - 36/36 mutants.

## Gotchas and lessons
**New in leg 18 (also saved to memory):**
- **The headed old engines gave the page only 1919x974:** the tab strip and toolbar, plus the `--no-sandbox` bar (39 px).
  - `--kiosk --test-type` gives 1920x1080.
  - A CDP `Emulation.setDeviceMetricsOverride` fixes the layout size, but not Chromium 53's screenshots.
  - Check a new screenshot's pixel size, not just that it exists.
- **Root `test/` can't import `@zoma/ui`:** the root package has no such dependency.
  - The root `tsc` has no JSX either, so importing an app module that reaches the ui index (e.g. `gallery-state.ts`) fails with TS6142.
  - Import plain `.ts` files by relative path, or pin values against the e2e spec's text.
- **Mutants:** `if (false && a || b)` disables only `a`, because `&&` binds first. Replace the whole `if (…) stmt;` with `if (false) stmt;`.
  - The real gaps were boundary cases: one item, exactly N items, and the width right while the height is wrong.
- **Comparing screenshots:**
  - `ffmpeg -i a.png -i b.png -lavfi ssim -f null -` gives SSIM;
  - a `blend=all_mode=difference` image shows whether boxes moved;
  - the Windows e2e shot differs at about 0.94 from font rasterising alone.

**From earlier legs (still true):**
- **Babel picks polyfills by property name, even on your own objects.** A field named `at` pulled in `Array.prototype.at` and `String.prototype.at`.
  - Check new files with a per-file probe: `transformSync` with bundle.ts's preset, listing the `core-js/modules/*` imports.
- **CDP `CSS.getPlatformFontsForNode` covers inline descendants only.** For a subtree, use `renderedFontsUnder` (`e2e/fonts.ts`).
- **postcss-rtlcss never mirrors inline styles.** Pass numbers as CSS variables, and put the directional property in a CSS rule.
- **Arabic bidi reverses a time range** (`a / b`): put `dir="ltr"` on it.
- **Components stay hook-free.** That keeps the VNode-walk unit tests working (`components/vnode.test-helpers.ts`).
- **The Windows checkout is case-insensitive:** `gallery.ts` next to `Gallery.tsx` failed with TS1261.
- **Playwright e2e:**
  - `force: true` to click an `aria-disabled` element;
  - `screenshot({ animations: 'disabled' })`;
  - park the mouse at `(1900, 1070)` before a wheel test.
- **Python patches:** write them with the Write tool and run them with `python -I`. Bash heredocs break on mixed quotes and backticks, and on `\n`.
- **The mutation scripts edit sources in place.** Don't edit those files while one runs (docs are fine). Engine mutants also overwrite `artifacts/engines`, so rerun the self-test afterwards.
- **Vite:** a worker-only dependency needs an `optimizeDeps.include` entry in `apps/tv/vite.config.ts`.
- **Node `EventTarget`:** pass `{ capture: true }`, not `true`.
- **Old-engine harness:**
  - `KEY_STEPS` focus strings: change `scenario.ts`, `e2e/tv-bundle.spec.ts` and `e2e/hello.spec.ts` together.
  - The hello title must keep both Latin and Arabic text.
  - Docker image: never edit the `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - Docker Desktop: start it with PowerShell `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, then wait on `docker info`.
- **CI monitor:** use the Monitor poll loop on `gh pr checks N` (`sleep 25` first; no process substitution).
- **New dependencies:** the two-week rule includes transitive packages. Check the lockfile diff against the registry.
- **Smart App Control is on:** pin older native binaries, and never weaken lint.
- **Repo layout:**
  - tests that read files from disk, or span packages, go in root `test/`;
  - `tools/*` may import only core, protocol and crypto.
- **TV code:** `lib: ES2017`; `Array.prototype.sort` isn't stable on Chromium 53.
- **Commits:**
  - scoped `git add`, then `git commit -F`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Open gaps (five now):
  - `@zoma/data`'s extra entries;
  - `pnpm epg:report` and `pnpm fonts` in the Commands table;
  - the CSS pipeline and gate in the `build:tv` row;
  - `?screen=gallery` among the `pnpm dev` URL overrides;
  - new: the `verify:engines` row should mention the gallery checks and the CSS seeds.

## The 3 riskiest changes in PR #17
1. **`--kiosk --test-type` now apply to every old-engine run,** the hello screen's too. All hello checks still pass, but `--test-type` is a test switch, not a TV runtime setting.
2. **`runPlatform`'s error collection moved into the shared `watchErrors`.** The logic is the same, and the seeds still catch every boot error.
3. **The CSS seeds rewrite app.css with a regex-based rule editor.** It is fine for our generated CSS, but not a general parser. Staging fails if a seed finds nothing.

## Verified vs not
- **Verified:**
  - the gallery in Chromium 53/56/68 from both bundles: every check passed, and the layout matches current Chromium (the engines agree at SSIM ≥ 0.995; only glyph edges differ from the e2e shot);
  - both CSS seeds caught on every engine;
  - local gates and CI green, merged.
- **Not done:**
  - fonts, RTL and layout on a real TV (step 16);
  - the Magic Remote OK/click order on a real LG TV;
  - CI on main at `e0245ef` (it started at handover).
- **Migrations and deploys:** N/A (no backend until step 29).

## Try it (Omar)
Nothing new to click: 11c is test tooling.
1. Open PR #17's run (`gh run view 41681893314 -R Omarmarei/zoma-iptv --web`), download the `old-engines-report` artifact, and look at the six `gallery-chrome*-*.png`. They show the gallery as 2018–2020 TV engines draw it.
2. Or open `docs/design/gallery-chrome53-webos.webp` (Chromium 53, LG webOS 4).
3. The step-11b desktop checklist (runbook tv-build.md, "The component gallery") still applies: `pnpm dev`, then `http://localhost:5173/?screen=gallery`.

## Open decisions and gates
- **Step 12:** the Arabic digit forms (see above). Decide, or ask Omar if you judge it his call.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 18 was the 18th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Five CLAUDE.md gaps** are waiting for his word (listed above).
- No secrets have been shared, so nothing needs rotating.
