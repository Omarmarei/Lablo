# Zoma IPTV: relay leg 20 opening prompt

You are leg 20 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work.
  - Legs 1–18 did steps 1–11c (PRs #1–#17). Leg 6 did no project work.
- **Leg 19 split step 12 (i18n, PLAN 4.3) into 12a and 12b, and did 12a:** the runtime, the catalogs and the formats, with the gallery moved onto them.
  - It was one commit, `bcb422c`. PR **#18** was merged as merge commit **`ee9059e`**, with the branch kept.
  - CI on `bcb422c`: `verify` 5 m 9 s, `engines` 2 m 23 s and `media` 6 m 54 s, all green.

## Your step: 12b, the rest of i18n (RELAY.md, under step 12)
Read RELAY.md's 12b entry first; it is the spec. In short:
- **The lint** (step 12's Done-when: "lint catches a seeded hard-coded string"). It is a local ESLint rule in `eslint.config.js`, with no new plugin, e.g. `zoma/no-hard-coded-text`. It flags:
  - JSX text with letters;
  - string literals (and template literals with letters) in text props: `label`, `title`, `message`, `placeholder`, `aria-label`, `alt`, `subtitle`, `nextLabel`, … Read the props of `packages/ui/src/components/*.tsx` for the full list.
  - The rule runs in Node, so `\p{L}` is fine there.
  - **Exempt:**
    - subtrees under `translate="no"` / `translate={false}` (Preact renders `translate="no"`);
    - elements with a `data` prop (`<Badge label="HD" data />`);
    - `*.test.ts(x)`, `e2e/`, `test/`, and the gallery's demo data (`gallery-data.ts` is plain TS, so the JSX rule never sees it).
  - **Prove it** with the ESLint API on seeded code, as `test/lint-boundaries.test.ts` does (`eslint.lintText(code, { filePath })`). Seed a bad file (JSX text, `label="Play"`) and good ones (`label={t('action.play')}`, `translate={false}`, `data`). Then check that `pnpm lint` on the real tree is clean.
  - **The hello screen** (`apps/tv/src/App.tsx`, `DataPanel.tsx`, `FocusPanel.tsx`) is full of English developer diagnostics ("Worker:", "Device", …), and steps 13–14 replace it.
    - **My recommendation:** exempt those three files in `eslint.config.js`, with a comment saying step 13 removes the exemption. Add that to RELAY step 13.
    - Moving about 60 debug strings into the catalogs is the alternative; it's your call.
    - Check `packages/ui/src/components` for default labels (e.g. Spinner's) that the rule flags.
- **The language switch** (there is no settings screen yet, so it goes on the gallery).
  - It must flip the catalog, `lang`/`dir` on `<html>` and `nav.setDir` live, without a reload, and the focus stays put.
  - `GalleryApp`'s `apply(tag, country)` already does all of that from the device locale (it puts a new `AppI18n` in a signal), so call it again with the other language.
  - **The trigger.** I suggest a header button in a new zone above `actions` (UP from the buttons), labelled with the other language's own name ("العربية" / "English"; add catalog keys), so the Magic Remote can click it.
    - Adding a 5th button to `actions` instead would break the e2e count (`.z-button` = 4) and change the layout.
    - A colour key (e.g. YELLOW) is possible, but the browser adapter maps few colour keys; check `platform-browser`'s key map.
  - **e2e** in dev and both bundles: switch, then check `html[dir]`, `data-language`, mirrored positions and the focused item.
  - **Unit test:** `gallery-state.test.ts` covers the zone.
- **The old engines** (`tools/engines/src/gallery.ts`, runbook old-engines.md).
  - Today the harness opens only the default-locale gallery: the TV bundles take `navigator.language` (platform-tizen/webos `info()`), and `?locale=` works only in the browser adapter.
  - Drive the switch by keys in the probe (your 12b switch tests itself on Chromium 53/56/68). Or set the container's `LANGUAGE`/`--lang`; check what works for headed Linux Chromium.
  - **Check in Arabic:**
    - the mirrored layout (safe area, 7 rows, nothing cut);
    - the plural text (`240 قناةً`);
    - **FSI/PDI on Chromium 53**: a span with the isolates is as wide as without them (no tofu). Also check whether 53's legacy bidi honours them, e.g. `Range` rects of a name ending in a digit inside Arabic.
  - Record the result in architecture.md §1.2 ("Built in step 12a" ends with "Left for step 12b").
  - Run `--self-test` to see which seeds fail on the Arabic gallery before you set the variants' `screens`.
- **Done when:**
  - the lint catches a seeded hard-coded string;
  - the switch works by keys in e2e;
  - `verify:engines --self-test` is green with the Arabic gallery;
  - `pnpm verify` is green;
  - the PR is merged on green CI;
  - there is a "press these keys" checklist.
  - Then **tick step 12 and 12b** in RELAY.md.
- If 12b runs long, split off the old-engine part as 12c, as legs 16–18 did with step 11.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `ee9059e` started at handover. If a job is red, fix it on the relay branch first.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths. Don't `cd` in Bash.
- When a script needs the worktree as its cwd, use `python -I -c "import os,subprocess,sys; os.chdir(r'<wt>'); sys.exit(subprocess.call('<cmd>', shell=True))"`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the package boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: steps 12, 12a (done) and 12b, and the leg-19 row of the progress log.
3. `docs/adr/ADR-011-i18n-runtime-and-digits.md` and architecture.md §1.2, "Built in step 12a".
4. `packages/ui/src/i18n/{runtime,format,message}.ts`, `apps/tv/src/i18n/*`, `apps/tv/src/gallery/GalleryApp.tsx`, `eslint.config.js`, `test/lint-boundaries.test.ts` and `tools/engines/src/gallery.ts`.

## What 12a built (use it, don't rebuild it)
- **core `plural.ts`:** `pluralCategory(language, n)`, `PLURAL_CATEGORIES`, `pluralLanguage(tag)`. These are CLDR's English and Arabic rules. Arabic: 0 zero, 1 one, 2 two, n%100 in 3–10 few, n%100 in 11–99 many, else other. So **240 is `many`** ("240 قناةً"); use 200 for `other`.
- **ui `i18n/message.ts`:** `parseMessage` and `formatMessage`.
  - The subset: `{name}`, `{n, number}`, `{n, plural, =N {…} zero/one/two/few/many/other {…}}` with `#`, and `{x, select, … other {…}}`.
  - No apostrophe quoting, so text can't contain braces.
  - `#` counts only directly in a plural branch, as in ICU.
  - A broken message shows as written; a missing argument shows as `{name}`.
  - `messageArguments` and `pluralBranches` serve the catalog tests.
- **ui `i18n/format.ts`:**
  - `resolveLocale(tag, { country, digits, hourCycle })` → `LocaleSettings` (`tag`, `language` en|ar, `region`, `dir` from the language, `pseudo`, `digits`, `hourCycle`, `dateOrder`);
  - `formatNumber`, `formatPercent`, `formatTime`, `formatWeekday`, `formatMonth`, `formatDate` (`day`|`full`), `formatDuration`, `shapeDigits`, `tagRegion`, `DEFAULT_DIGITS = 'latn'`.
  - **No `Intl`.** `test/i18n-cldr.test.ts` checks the output against Node's ICU.
- **ui `i18n/runtime.ts`:** `createI18n(catalogs, locale, { digits, isolate })` → `I18n` with `t`, `number`, `percent`, `time`, `weekday`, `date` and `duration`. Also `isolate` and `stripIsolates`.
  - **Every text argument is wrapped in FSI U+2068 … PDI U+2069.**
  - en-XA runs the English catalog through `pseudoLocalize`.
- **apps/tv `i18n/`:**
  - `en.ts`: `EN` and `MessageKey`. Keys are `area.what`: `gallery.*`, `action.*`, `category.*`, `guide.*`, `badge.*`, `play.title`, `exit.*`.
  - `ar.ts`: `AR: Record<MessageKey, string>`, so tsc rejects a missing key.
  - `index.ts`: `CATALOGS`, `appI18n(locale)` and `AppI18n`.
  - `catalogs.test.ts`: the same keys and arguments in both; everything parses (en-XA too); all six Arabic plural forms; no Latin words in Arabic; nothing unfilled; no bidi controls in the catalogs.
- **The gallery:**
  - `GalleryApp` holds `i18n` in a signal, and `GalleryScreen` takes `{ gallery, i18n }`.
  - `ACTIONS` and `DEMO_CATEGORIES` are `MessageKey`s.
  - The header's locale tag has `dir="ltr"`. In Arabic the count had joined its Latin run (bidi W7); e2e now checks the order.
  - The media timeline is 4392 s of 7200 s (61%, e2e checks the fill).
- **e2e:** `isolated(text)` in `e2e/gallery.spec.ts` builds FSI+text+PDI, because Playwright's `toHaveText` doesn't strip them. It also checks the plural and format text in en, ar and en-XA.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and recording PR #18's merge in RELAY.md, on top of `bcb422c`. It is pushed, and the tree is clean.
- **main** has `ee9059e`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/`, `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, and the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate12a.py` (42 mutants; run one with `python -I artifacts/mutate12a.py "<snippet>"`);
    - `make-size-probe3.py <wt>`, which writes `tools/build/src/zz-sizes-probe.ts` for any entry path (default main.tsx; delete it after);
    - `sizes-before.txt`, `sizes-after3.txt`;
    - `engines/` (the chrome53 run was last; the chrome56/68 screenshots were deleted by the per-engine reruns);
    - the logs `verify.log`, `engines*.log` and `mutate12a.log`.
- **Local gates on `bcb422c`:**
  - `pnpm verify`: 93 test files, both builds through both gates, e2e 20/20;
  - `verify:engines --self-test`: 54 runs as expected, 38 seeded failures caught;
  - 42/42 mutants.
- **Sizes:** main's own code 130.0 KB (tizen) / 128.6 KB (webos) of 500, with no new polyfill.

## Gotchas and lessons
**New in leg 19 (also saved to memory):**
- **`new RegExp(...)` in TV code pulls in core-js's RegExp constructor (+7 KB), and `.split(` pulls in `es.string.split` (+2 KB).** Use regex literals with `exec`, or a char loop.
  - Check new files with the per-file polyfill probe (memory `iptv-tv-bundle-polyfills`).
  - For a before/after module diff, copy the changed files aside, `git checkout HEAD -- <files>`, probe, then copy them back. Don't stash: the stash is shared across worktrees.
- **The Write tool turns `\uXXXX` escapes in regex literals into raw characters** (bidi controls, Arabic ranges).
  - Fix them with a Python script that replaces the `chr()` sequences with the escaped text, then scan for U+200B–206F.
  - In TV code, build such characters with `String.fromCharCode`.
- **Look at the Arabic screenshot after any text change.** Green tests missed the header's W7 bidi join. A Latin span followed by digits needs `dir` on the span.
- **Node ICU oracle quirks** (`test/i18n-cldr.test.ts`):
  - strip U+200E, U+200F and U+061C, and turn U+00A0 and U+202F into spaces;
  - use `-u-nu-latn` / `-u-nu-arab` to force the digits;
  - ar-SA with Western digits uses `٪` in ICU, but we use `%` (compared with ar-AE);
  - en-CA writes `a.m.`/`p.m.` (implemented);
  - CI runs Node 22, locally it's 24; both passed.
- **Mutation scripts that print Arabic** need `sys.stdout.reconfigure(encoding='utf-8')`. Without it the cp1252 console crashes mid-run, and the remaining mutants are skipped.
- **`verify:engines`:** once, Chromium 56's container never opened DevTools in 60 s and the whole run aborted. `--engine chrome56` passed on the rerun. Rerun per engine for clean summaries.
- **Bash heredocs that hold Python with backticks and `${…}` fail to parse.** Write the script with the Write tool and run it with `python -I`.

**From earlier legs (still true):**
- **Babel picks polyfills by property name, even on your own objects** (`at`, `values`, `includes`, `padStart`…).
- **Root `test/` can't import `@zoma/ui`,** and the root `tsc` has no JSX. Import plain `.ts` files by relative path (as `test/i18n-cldr.test.ts` does).
- **Components stay hook-free** (VNode-walk unit tests). Focus is a class plus `data-state`, never DOM focus.
- **CSS:** physical properties only; postcss-rtlcss never mirrors inline styles (use a CSS variable); time ranges need `dir="ltr"`; Noto Sans has no arrows.
- **Playwright e2e:**
  - `force: true` to click an `aria-disabled` element;
  - `screenshot({ animations: 'disabled' })`;
  - park the mouse at `(1900, 1070)` before a wheel test.
- **Old-engine harness:**
  - `KEY_STEPS` focus strings: change `scenario.ts`, `e2e/tv-bundle.spec.ts` and `e2e/hello.spec.ts` together.
  - Docker image: never edit the `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - Engine mutants overwrite `artifacts/engines`.
- **The mutation scripts edit sources in place.** Don't edit those files while one runs.
- **Vite:** a worker-only dependency needs an `optimizeDeps.include` entry in `apps/tv/vite.config.ts`.
- **Node `EventTarget`:** pass `{ capture: true }`, not `true`.
- **CI monitor:** use the Monitor poll loop on `gh pr checks N` (`sleep 25` first; no process substitution).
- **New dependencies** must be ≥ 2 weeks old, transitive ones included.
- **Smart App Control is on:** pin older native binaries, and never weaken lint.
- **TV code:** `lib: ES2017`; `Array.prototype.sort` isn't stable on Chromium 53.
- **Commits:**
  - scoped `git add`, then `git commit -F`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Open gaps (six now):
  - `@zoma/data`'s extra entries;
  - `pnpm epg:report` and `pnpm fonts` in the Commands table;
  - the CSS pipeline and gate in the `build:tv` row;
  - `?screen=gallery` among the `pnpm dev` URL overrides;
  - the `verify:engines` row should mention the gallery checks and the CSS seeds;
  - new: a Conventions line saying UI text comes only from `apps/tv/src/i18n` catalogs through `appI18n` (ADR-011), and that the 12b lint enforces it.

## The 3 riskiest changes in PR #18
1. **Arabic shows Western digits by default** (ADR-011). This is a product choice the plan left open; it's reversible in one line.
2. **Our own formatters replace `Intl`.** They match ICU for en-US/CA/GB and ar-AE/SA; other English regions follow simplified tables (e.g. en-AU writes AM, not am).
3. **Every text argument now carries FSI/PDI.** Text comparisons must expect them. Chromium 53's handling of them is to be checked in 12b; they draw as nothing there today (the gallery passed).

## Verified vs not
- **Verified:**
  - the plural rules and formats against Node's ICU;
  - the gallery in en, ar and en-XA in e2e;
  - the gallery from both bundles on Chromium 53/56/68 (default locale, English): the new text renders and the layout checks pass;
  - local gates and CI green, merged.
- **Not done:**
  - the Arabic gallery on the old engines and FSI/PDI there (12b);
  - the lint and the language switch (12b);
  - anything on a real TV (step 16);
  - CI on main at `ee9059e` (it started at handover).
- **Migrations and deploys:** N/A (no backend until step 29).

## Try it (Omar)
1. `pnpm dev`, then `http://localhost:5173/?screen=gallery&locale=ar-SA`. The header reads `ar-SA · 240 قناةً` (tag on the right), the yellow badge `ينتهي خلال 3 أيام`, and the timeline `1:13:12 / 2:00:00`.
2. Use `&locale=en-US` for `240 channels` and `Expires in 3 days`, and `&locale=en-XA` for the bracketed, accented versions.
3. In Arabic, **Enter** on row 103 opens `تشغيل Zoma Sports 1؟`.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended; it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 12b:** the hello screen's lint exemption versus catalog strings (recommendation above).
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 19 was the 19th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Six CLAUDE.md gaps** are waiting for his word (listed above).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
