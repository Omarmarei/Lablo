# Zoma IPTV: relay leg 21 opening prompt

You are leg 21 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work.
  - Legs 1–19 did steps 1–12a (PRs #1–#18). Leg 6 did no project work.
- **Leg 20 did step 12b, which also completes step 12 (i18n, PLAN 4.3).** Both are ticked in RELAY.md.
  - Commits `a99a4fe` (the lint and the language switch) and `65cb2d3` (Arabic on the old engines and the bidi fix).
  - PR **#19** was merged as merge commit **`4f90587`**, with the branch kept.
  - CI on `65cb2d3`: `verify` 5 m 19 s, `engines` 3 m 55 s and `media` 8 m 25 s, all green.

## Your step: 13, onboarding (PLAN 4.4)
RELAY.md step 13 is the spec: language, disclaimer, device-ID consent, add a source on the TV (Xtream / M3U / EPG URLs), validation and load progress.
- **Done when:** a keys-only Playwright run passes in en and ar against the mock provider. Also a "press these keys" checklist, and, as with every UI step, look at the Arabic screenshot.
- **Read for scope:**
  - docs/PLAN.md: line 48 (why onboarding is the incumbents' weak point), line 187 (LG device ID needs user consent; no emulator), line 246 (legal surfaces: the in-app "Zoma provides no content" disclaimer and the device-ID consent screen);
  - docs/architecture.md: §6, 4.4 (line 868), and line 681 (the backup is disclosed during onboarding; the backend arrives at step 29, so plan only the disclosure text and the setting's place now);
  - CLAUDE.md's legal guardrails (no bundled or suggested playlists, no credentials in code).
- **This step is big. Split it before you start,** as legs 16–19 did with steps 11 and 12. A possible split:
  - 13a: the flow, its screens and the text input, on fake data;
  - 13b: validation and load progress against the mock provider through the data engine, plus the keys-only e2e in en and ar.
  - Write the split into RELAY.md first.
- **Design points to settle (record them in architecture.md or an ADR):**
  1. **Text input on a TV.** The focus engine uses a class plus `data-state`, never DOM focus. An `<input>` needs real DOM focus to open the TV's on-screen keyboard: the Tizen IME, or the webOS virtual keyboard. The desktop uses the physical keyboard.
     - There is no text-field component in `packages/ui/src/components` yet.
     - Decide how OK on a field gives it DOM focus, and how BACK/DONE returns control to the engine. On webOS the keyboard's own keys arrive as key events too.
     - Check `platform-tizen`/`platform-webos` for IME key codes, and record what the emulator-free harness can and can't check.
  2. **The hello screen.** It is the default screen today, and the TV-bundle e2e and the old-engine harness's hello runs depend on it (`KEY_STEPS`, the data-engine diagnostics). The lint exempts its three files until this step.
     - Options:
       - keep it as a dev screen behind `?screen=hello` and move its 29 strings into the catalogs;
       - or keep the exemption with a narrower comment (dev-only screen).
     - Onboarding becomes the default start screen, so the harness's hello runs need `?screen=hello` (change `scenario.ts`, `e2e/tv-bundle.spec.ts` and `e2e/hello.spec.ts` together).
     - My recommendation: a dev screen plus catalog strings, so the exemption goes away.
  3. **Where onboarding state lives.** Nothing important goes in localStorage (architecture.md §1.3). Sources go through the data layer's stores (`@zoma/data/client`).
  4. **The language screen** can reuse `LANGUAGE_NAMES`, `switchedTag` and `Button`'s `lang` (step 12b), and GalleryApp's live-switch pattern: subscribe to a signal, then swap the `I18n`, `<html lang/dir>` and `nav.setDir`.
- **Every new string** goes into `apps/tv/src/i18n/en.ts` and `ar.ts` (the lint enforces it). Arabic plurals need all six forms (`catalogs.test.ts`). Provider text goes under `translate={false}`/`data`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `4f90587` started at handover. If a job is red, fix it on the relay branch first.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths. Don't `cd` in Bash.
- When a script needs the worktree as its cwd, use `python -I -c "import os,subprocess,sys; os.chdir(r'<wt>'); sys.exit(subprocess.call('<cmd>', shell=True))"`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the package boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 13, the 12b entry, and the leg-20 row of the progress log.
3. docs/architecture.md §1.2, "Built in step 12b", and ADR-011's "Isolation on the TVs' engines".
4. `apps/tv/src/main.tsx`, `apps/tv/src/data/params.ts` (`readScreen`), `apps/tv/src/gallery/{GalleryApp.tsx,gallery-state.ts}`, `packages/ui/src/components/*`, `packages/ui/src/focus/*`, `apps/tv/src/i18n/*`, and `packages/data/src/client.ts`.

## What 12b built (use it, don't rebuild it)
- **Lint `zoma/no-hard-coded-text`** (eslint.config.js, a local plugin `zoma`). It runs on `apps/**/*.tsx` and `packages/**/*.tsx`, except tests.
  - Flagged: JSX text with letters, and string or template literals with letters in `TEXT_PROPS` (`label`, `title`, `subtitle`, `message`, `placeholder`, `nextLabel`, `alt`, `aria-*` text) or in child expressions, through `?:`, `&&`, `||`, `??` and `+`.
  - Exempt: `translate="no"`/`{false}` and bare `data` subtrees.
  - The hello screen's three files are exempt in a separate config block, which says step 13 removes it.
  - Proof: `test/lint-text.test.ts`, which seeds TSX with declared stand-ins, not imports.
- **Language switch** (gallery):
  - zone `language` after `actions` (`end`/`start` neighbours);
  - `gallery.languageSwitches` (a signal counting presses);
  - `GalleryApp`'s effect subscribes to it, and an odd count shows `switchedTag(device)`;
  - `LANGUAGE_NAMES`, `otherLanguage` and `switchedTag` in `apps/tv/src/i18n/index.ts`;
  - `Button`'s `lang` prop, which sets `lang` and `translate="no"` on the label;
  - a globe icon.
- **core `bidi.ts`:** `isolateText(text, around)` = `outer + inner + FSI + text + PDI + inner + outer`; `firstStrongDirection`; `stripIsolates`, which strips FSI, PDI, LRM and RLM. The ui runtime calls `isolateText(value, settings.dir)` for every text argument. ui no longer exports `isolate`/`stripIsolates`: import them from `@zoma/core`.
- **The old-engine harness** (`tools/engines/src/gallery.ts`):
  - after ArrowDown, `SWITCH_KEYS` (ArrowUp ×3, ArrowRight ×4, Enter) switches to Arabic;
  - `arabicFailures` checks the focus, the layout, the mirror, `ARABIC_COUNT` and the fonts;
  - `BIDI_EXPRESSION` and `bidiFailures`: the lines are built with the real `isolateText`, and the controls must show the bug;
  - `-ar.png` screenshots, and `bidi` numbers in report.json.
  - `tools/engines` now depends on `@zoma/core`.
- **e2e:**
  - `e2e/gallery.spec.ts`: the switch by keys (no reload, focus kept, mirrored LEFT/RIGHT), the region kept (ar-SA → en-SA, en-XA → ar), and the bidi probe in current Chromium;
  - `e2e/tv-bundle.spec.ts`: the switch by keys in both bundles.
  - `.z-button` count is 5 (4 actions + the switch).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and recording PR #19's merge in RELAY.md, on top of `65cb2d3`. It is pushed, and the tree is clean.
- **main** has `4f90587`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/`, `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate12b.py` (47 mutants; run one with `python -I artifacts/mutate12b.py "<snippet>"`);
    - `mutate12a.py`;
    - `bidi-modern.ts` (the bidi probe in current Chromium against `dist/tv/webos`);
    - `make-size-probe3.py`;
    - `engines/` (the last run was the no-polyfills recheck);
    - the logs `verify12b.log`, `engines12b-*.log` and `mutate12b.log`.
- **Local gates on `65cb2d3`:**
  - `pnpm verify`: 1498 tests in 95 files, both builds through both gates, e2e 25/25;
  - `verify:engines --self-test`: 54 runs as expected, 38 seeded failures caught;
  - 47/47 mutants.
- **Sizes:** main's own code 132.0 KB (tizen) / 130.6 KB (webos) of 500, with no new polyfill.

## Gotchas and lessons
**New in leg 20 (also saved to memory):**
- **Chromium 53/56/68 ignore FSI/PDI for bidi** (zero width, no tofu). The marks must sit outside the isolate; inside, 53 still split a leading digit. `<bdi>` and `dir="auto"` also work there.
  - Any new bidi-sensitive text: check it with the harness's probe pattern (Range rects plus a control without isolation), and look at the `-ar.png` screenshots.
- **Text comparisons:** every text argument carries six invisible characters. Use `stripIsolates` (core) or `isolated()` in e2e.
- **A pointer click right after an OK key is dropped as the same Magic Remote press.** Unit tests need a fresh gallery for the click case.
- **ESLint `lintText` seeds:** importing `@zoma/ui` trips the boundaries rule in other packages, so declare stand-ins and export every declared name.
- **Bash heredocs with backticks fail even with a quoted delimiter.** Write Python patch scripts with the Write tool, then run them with `python -I`.
  - A doubled backslash (`'\\u0600'` in the Python source) survives Write as an escape; check it with `cat -A`.
- **Before changing an approach, run experiments on the real engines:** temporarily add fields to the probe, run `--engine chrome53`, then read `artifacts/engines/report.json`. Restore the file from a copy afterwards; don't use stash.
- **The gallery still needs no polyfill** (rechecked with the Arabic phase): `no-polyfills` stays on hello only.
- **Pre-existing, for step 14:** in Arabic, row 103's catch-up badge is cut mid-word ("إعاد"). The row's badges overflow hidden, and `.z-row__badges` is excluded from the cut check. The live screen's channel row should hide whole badges instead.

**From earlier legs (still true):**
- **Polyfills:**
  - `new RegExp(...)` in TV code pulls in core-js's RegExp (+7 KB), and `.split(` pulls in `es.string.split` (+2 KB). Use regex literals or char loops.
  - Babel picks polyfills by property name, even on your own objects (`at`, `values`, `includes`, `padStart`…).
  - Probe new files per file (memory `iptv-tv-bundle-polyfills`).
- **The Write tool turns `\uXXXX` escapes into raw characters.** In TV code, use `String.fromCharCode`, and scan for U+200B–206F afterwards.
- **Look at the Arabic screenshot after any text change.** A Latin span followed by digits needs `dir` on the span.
- **Mutation scripts that print Arabic** need `sys.stdout.reconfigure(encoding='utf-8')`.
- **`verify:engines`:** a container can miss DevTools once; rerun with `--engine`.
- **Root `test/` can't import `@zoma/ui`** (and has no JSX in tsc): use relative non-tsx imports. e2e can import `../packages/core/src/*` and `../tools/engines/src/*`.
- **Components stay hook-free** (VNode-walk unit tests). Focus is a class plus `data-state`, never DOM focus (see design point 1 above).
- **CSS:** physical properties only; postcss-rtlcss never mirrors inline styles (use a CSS variable); time ranges need `dir="ltr"`; Noto Sans has no arrows.
- **Playwright:**
  - `force: true` to click an `aria-disabled` element;
  - `screenshot({ animations: 'disabled' })`;
  - park the mouse at `(1900, 1070)` before a wheel test.
- **Old-engine harness:**
  - `KEY_STEPS` focus strings: change `scenario.ts`, `e2e/tv-bundle.spec.ts` and `e2e/hello.spec.ts` together.
  - Docker image: never edit the `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - Engine runs overwrite `artifacts/engines`.
- **The mutation scripts edit sources in place.** Don't edit those files while one runs.
- **Vite:** a worker-only dependency needs an `optimizeDeps.include` entry in `apps/tv/vite.config.ts`.
- **Node `EventTarget`:** pass `{ capture: true }`.
- **CI monitor:** the Monitor poll loop on `gh pr checks N` (`sleep 25` first).
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. **Smart App Control is on:** pin older native binaries, and never weaken lint.
- **TV code:** `lib: ES2017`; `Array.prototype.sort` isn't stable on Chromium 53.
- **Commits:**
  - scoped `git add`, then `git commit -F`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Open gaps (six):
  - `@zoma/data`'s extra entries;
  - `pnpm epg:report` and `pnpm fonts` in the Commands table;
  - the CSS pipeline and gate in the `build:tv` row;
  - `?screen=gallery` among the `pnpm dev` URL overrides;
  - the `verify:engines` row should mention the gallery checks, the CSS seeds and the Arabic phase;
  - a Conventions line: UI text comes only from the `apps/tv/src/i18n` catalogs through `appI18n` (ADR-011), `zoma/no-hard-coded-text` enforces it, and text arguments are isolated by core's `isolateText`.

## The 3 riskiest changes in PR #19
1. **Every text argument now carries six invisible characters** (LRM/RLM outside FSI/PDI). Code or tests that compare UI text must strip them. `firstStrongDirection` approximates the bidi classes; a test sweeps every BMP letter.
2. **The lint covers every `.tsx` in `apps/` and `packages/`.** The hello-screen exemption is temporary (step 13).
3. **First live direction flip:** `<html dir>` and `nav.setDir` change at run time, so later screens must not cache anything by direction. `tools/engines` gained a workspace dependency on `@zoma/core` (lockfile).

## Verified vs not
- **Verified:**
  - the lint on seeded code (26 cases) and on the real tree;
  - the switch by keys in e2e (dev and both bundles);
  - the Arabic gallery on Chromium 53/56/68 (layout, mirror, plural, fonts, focus);
  - the bidi probe on 53/56/68 and on current Chromium;
  - local gates and CI green, merged.
- **Not done:**
  - anything on a real TV (step 16);
  - CI on main at `4f90587` (it started at handover).
- **Migrations and deploys:** N/A (no backend until step 29).

## Press these keys (Omar, desktop browser)
1. Run `pnpm dev`, then open `http://localhost:5173/?screen=gallery&locale=en-US`.
2. Press **↑ ↑** (rail, then the actions), then **→ → → →**. The globe button **العربية** at the right end of the button row is focused.
3. Press **Enter**. The screen flips to Arabic and mirrors, with no reload:
   - the title reads `المكوّنات`;
   - the header reads `ar-US · 240 قناةً` (tag on the right);
   - the switch now reads **English**, at the left end, still focused.
4. Press **→**: the focus moves to `تسجيل` (in Arabic, RIGHT goes back towards the buttons). Press **←**, then **Enter**: back to English, still on the switch.
5. Open `?screen=gallery&locale=ar-SA` and press the switch (a mouse click works too): `en-SA` (the region is kept).
6. Open `?screen=gallery&locale=en-XA`: the switch shows `العربية` without brackets (language names aren't translated).
7. **Lint check:** add `<p>Hello</p>` inside `GalleryScreen` in `apps/tv/src/gallery/GalleryApp.tsx` and run `pnpm lint`: `zoma/no-hard-coded-text` reports "Hello". Then undo the change.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended; it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 13:** the hello screen's future (design point 2), and the TV text-input approach (design point 1). These are engineering calls: decide, record, and move on.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 20 was the 20th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Six CLAUDE.md gaps** are waiting for his word (listed above).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
