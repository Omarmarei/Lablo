# Runbook: TV builds, packaging and device commands

How `pnpm build:tv`, `pnpm dev` and `pnpm device` work, and the manual Tizen steps. Setting up the TVs themselves (Developer Mode, emulators and simulators, Samsung certificates) is in [tv-setup.md](tv-setup.md).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server for `apps/tv` with the browser adapter (keyboard = remote). Open the printed URL at 1920x1080: it starts on onboarding (step 13a), or on the live screen once a source is stored (step 14a). URL overrides: `?tier=low&locale=ar-SA&country=SA`; developer screens `?screen=hello` (device, workers, data layer) and `?screen=gallery` (components). |
| `pnpm build:tv` | Both TV builds of the app and of the Zoma Lab (`dist/tv-lab`, step 15a, [lab.md](lab.md)), the ES2016 syntax gate, bundle budgets and the webOS `.ipk`s. Options: `--platform tizen` or `--platform webos` (repeatable), `--target app` or `--target lab` (repeatable), `--skip-package`, `--out <dir>` (staging root instead of `dist/tv`; the app only). Lab options: `--lab-server`, `--lab-version`, `--lab-write-mb`, `--lab-no-auto` (lab.md). Test only: `--unsafe-no-polyfills` builds without core-js for the old-engine self-test; it needs `--out`, refuses `dist/tv` and never packages. |
| `pnpm verify:engines` | The built apps in Chromium 53/56/68 snapshots (Docker). See [old-engines.md](old-engines.md). |
| `pnpm fonts` | Remakes the woff2 font subsets in `packages/ui/assets/fonts` (with `fonts.json` and `OFL.txt`) from the Noto sources pinned in `tools/fonts/src/spec.ts`, downloaded once into `.cache/fonts` and checked by SHA-256. Run it after changing a range, a weight or a source, then commit the outputs; the output is deterministic. CI never downloads fonts. |
| `pnpm e2e` | Playwright: the dev app by keyboard, and both built TV bundles booted from `file://`. Needs `pnpm build:tv` first (`pnpm verify` runs it). The specs press keys through `e2e/remote-driver.ts` and read the focus from `window.__ZOMA_TEST__.focusPath()` (step 14b). The project `throttled` runs last, alone: the live screen on 20,000 channels at 4x CPU throttle, each key press ≤ 200 ms and no longer main-thread task, in the full and the forced low tier (report: `artifacts/perf/live-throttled.json`). Run it by itself with `pnpm exec playwright test --project=throttled --no-deps` (no TV build needed). |
| `pnpm device <devices\|install\|launch\|inspect> <webos\|tizen> [device] [--lab]` | Install, launch or remote-inspect the build on a TV; `--lab` does it for the Zoma Lab. |

## What `pnpm build:tv` does

`tools/build/build-tv.ts`, per platform (ADR-003):

1. **Bundle** `apps/tv/src/main.tsx` with Rollup into one classic-script IIFE. Babel `preset-env` targets `chrome 53` with core-js 3 `useBuiltIns: 'usage'`; TypeScript and Preact JSX go through Babel too. `__PLATFORM__` becomes `"tizen"` or `"webos"`, so the other adapters are tree-shaken out.
   - **Polyfills left out** (step 8, `tools/build/src/bundle.ts`):
     - Babel's usage detection can't see types, so any `.map(` used to pull in the ES2025 iterator helpers, any `new Set` the ES2025 Set methods and any `Uint8Array` the ES2026 base64 methods. That was about 30 KB in every bundle.
     - `UNUSED_POLYFILLS` excludes those, plus the ES2022–ES2026 typed-array, ArrayBuffer, error-cause, JSON-source and `Symbol.prototype.description` polyfills.
     - The JSON-source entry matches `esnext.json.parse` too (step 8b): that is the name Babel injects for any `JSON.parse`, and it loads `es.json.parse`, so the step-8 pattern had missed it. It saved 3.5 KB in the ingest worker and in the webOS main bundle.
     - It is safe because every package and `apps/tv` compile against `lib: ES2017`, so TypeScript rejects any call to those APIs. `bundle.test.ts` pins that.
     - To use one of them later, move its entry out of the list and raise that package's `lib`.
   - **Dependencies without polyfills:** fflate's ES build is plain ES5, and its unused worker helper calls `URL.createObjectURL`, which alone pulled in core-js's 25 KB URL polyfill. Files under `node_modules/fflate` therefore get their syntax transpiled (and gated) but no polyfill imports (`POLYFILL_FREE_DEPENDENCIES`).
   - **Effect:** the query worker went from 100.5 to 75.8 KB, the main bundle from about 124 to 113.6 KB, and the ingest worker is 128.8 KB.
   - **Per-file polyfills and package entries:** Babel adds polyfill imports to each file before Rollup tree-shakes, and those imports are side effects, so every module a bundle reaches keeps its polyfills even when none of its exports are used. Importing `@zoma/data`'s index into the main bundle pulled in the typed-array polyfills of every data module (about 17 KB). The app therefore imports the RPC clients from `@zoma/data/client`, which reaches only `client.ts` and `rpc.ts`. Measure with a per-module size probe (Rollup's `chunk.modules[id].renderedLength`) before you raise a budget.
2. **Workers.** `import X from './x.worker?worker'` (the same syntax Vite uses in dev) builds the worker as its own Chromium 53 IIFE, gates it, and inlines it as a string started from a Blob URL. No separate worker files ship.
   - **The data workers** (steps 8b and 9b): `apps/tv/src/data/workers.ts` imports `@zoma/data/query.worker?worker`, `@zoma/data/ingest.worker?worker` and `@zoma/data/epg.worker?worker`. `packages/data/package.json` exports the three files (plus `./client`), and `eslint.config.js` allows them as `data` entry points. Vite resolves the same imports in `pnpm dev`.
   - **Sizes (step 8b):** main 323.1 KB (tizen) and 321.5 KB (webos) of 500 KB, including the inlined hello (37.5 KB), query (75.8 KB) and ingest (125.3 KB) workers. An inlined worker costs a little more than its own size, because `JSON.stringify` escapes its quotes and backslashes.
   - **Sizes (step 9b):** main 449.4 KB (tizen) and 447.9 KB (webos) of 500 KB, with the EPG worker (116.0 KB) inlined too; query 80.7 KB (now/next), ingest 125.5 KB. The EPG reader got a worker of its own because the ingest worker measured 159.6 KB with it. The main budget is now 90% used, mostly by the three data workers' shared code (core-js, fflate, the IndexedDB and RPC plumbing), so the UI steps will need it changed: see RELAY.md, "Main bundle budget".
   - **Sizes (step 9c):** main 459.1 KB (tizen) and 457.5 KB (webos) of 500 KB; query 89.8 KB (it now asks panels for the short EPG), EPG 115.1 KB, ingest 124.9 KB. `XtreamClient` alone would have made the query worker 110.5 KB, because a class keeps all its methods (the list parser, the JSON splitter). The short-EPG call therefore has its own core file (`xtream-epg.ts`, with the shared plumbing in `xtream-base.ts`). Two polyfills were avoided as well: `content-key.ts` brings `es.json.stringify` (about 4 KB) for its error messages, and `Fnv1a.digest` used `padStart`.
3. **Syntax gate.** acorn parses every worker and the main bundle at `ecmaVersion: 2016` as a script. Anything newer (async functions, object rest/spread, regex lookbehind or named groups, `?.`, `??`, ES modules) fails the build with the line, column and an excerpt. Babel transpiles most modern syntax; the gate catches what it cannot (e.g. a regex lookbehind) and anything from an untranspiled file. The inline boot-error script in `index.html` is gated too.
4. **Budgets.** Minified bytes as shipped. Over budget fails the build before anything is packaged.
   - **Each worker ≤ 150 KB**, counted with anything inlined into it.
   - **Main's own code ≤ 500 KB:** main.js minus the worker strings inlined into it (Omar's decision of 2026-11-03, RELAY.md "Main bundle budget"). A worker string is only parsed as code when its worker starts, and each worker has its own budget. The build prints both figures, e.g. `main.js (tizen): 102.2 KB own code of 500.0 KB (20%), plus 368.1 KB of inlined workers`.
   - **How the split is measured** (`tools/build/src/bundle.ts`): a worker goes into the bundle as a placeholder string, and after terser the worker's code replaces it (`substituteWorkers`), so the bundle knows exactly how many of its bytes are worker code (`BundleResult.inlinedBytes`). `stringLiteral` writes each worker in the quote that needs fewer escapes, as terser would: single quotes save 5.9 KB over `JSON.stringify`.
   - **Sizes (budget change, step 11):** main 102.2 KB own code (tizen) and 100.8 KB (webos), plus 368.1 KB of inlined workers; the files are 470.3 and 468.9 KB, as before.
5. **CSS** (`tools/build/src/css.ts`, ADR-003): the `.css` files the bundle imports, in the modules' evaluation order (`BundleResult.css`), become one `app.css`.
   - Each local `url()` (the fonts) is copied to `assets/<name>` and rewritten; a remote URL, a missing file or two different files with one name fail the build. With assets, the fonts' licence ships as `assets/fonts-OFL.txt`.
   - `postcss-rtlcss` (`combined` mode, `tv-css.config.ts`, shared with the Vite dev loop) adds a mirrored `[dir="rtl"]` rule for every direction-dependent declaration. Write physical properties for the left-to-right layout; the app sets `dir` on `<html>`, and the TV `index.html` starts with `dir="ltr"`.
   - The **Chromium 53 CSS gate** (`css-gate.ts`) then checks the output: Grid, flex `gap`, sticky, logical properties, `inset`, `aspect-ratio`, unprefixed `user-select`/`clip-path`/`mask`/`appearance`, `clamp()`/`min()`/`max()`, `env()`, CSS Color 4 functions, `#rgba` hex, space-separated colours, new viewport units, `:is()`/`:where()`/`:has()`/`:focus-visible`/`:focus-within`/`:dir()`, lists in `:not()`, nesting, `@layer`/`@container`/`@property` and media range syntax fail with `file:line:column`, the declaration and the reason.
   - **Sizes (step 11a):** app.css 9.7 KB from 3 files; four fonts in `assets/`, 99 KB.
6. **Platform isolation.** The Tizen bundle must not contain webOS adapter code (`PalmSystem`, `webOSRelaunch`) and vice versa (`tvinputdevice`, `productinfo`); neither may contain the desktop adapter.
7. **Stage** `dist/tv/<platform>/`: `index.html` (classic scripts; Tizen also loads `$WEBAPIS/webapis/webapis.js`), `main.js`, `app.css`, `assets/` (fonts and their licence), the platform manifest with `{{version}}` replaced by `apps/tv/package.json` `version`, and the icons from `platforms/<platform>/`.
8. **Package** into `dist/packages/`:
   - **webOS:** `ares-package --no-minify` from `@webos-tools/cli` (a devDependency; no global install). Output: `com.zoma.iptv_<version>_all.ipk`. `--no-minify` keeps the shipped bytes identical to the gated ones.
   - **Tizen:** only when the Tizen CLI is on PATH **and** `TIZEN_SIGNING_PROFILE` names a certificate profile. Otherwise the build prints why it skipped and still succeeds.

When a gate failure appears: find the excerpt in the source, or the dependency it came from. Regex lookbehind and named groups cannot be transpiled; rewrite the regex. A dependency shipping new syntax is already transpiled; if it still fails, it may use something Babel has no transform for. A CSS gate failure names the source file and line: rewrite the rule with flexbox, margins, physical properties or `rgba()`, as the reason says.

## The Zoma Lab build (step 15a)

The same pipeline builds `apps/tv/src/lab/lab-main.tsx` per platform, with its own budgets (the same limits) and gates, into `dist/tv-lab/<platform>/` (`tools/build/src/lab.ts`):
- **The manifests** are the app's with another id and name: webOS `com.zoma.iptv.lab`, "Zoma Lab"; Tizen widget `https://zoma-iptv.invalid/lab`, package `ZomaLab001`, app `ZomaLab001.ZomaLab`. So a lab install never replaces the app or its data.
- **index.html** runs the boot-error handler, then the native-feature probe (`apps/tv/src/lab/native-probe.js`, inlined and syntax-gated: which built-ins the engine has before core-js), then `lab-config.js`, then `main.js`.
- **lab-config.js** holds `window.ZOMA_LAB_CONFIG`: the server (`--lab-server`, default this PC's first private IPv4 address on port 8080), the version (`--lab-version`, default the app's), the write test's size and whether to run at launch.
- **Package:** `dist/packages/com.zoma.iptv.lab_<version>_all.ipk`. Tizen as for the app, once the CLI exists.
- **Sizes (2026-11-04):** lab main.js 131.7 KB own code (tizen), plus the lab worker (33.0 KB); app.css 23.6 KB.
- **The app's own bundle** gained 0.3 KB (tizen) and 1.5 KB (webos) from `Platform.deviceSecret()`. The webOS luna helper takes its parameters as JSON text: a `JSON.stringify` there would have pulled `es.json.stringify` (about 4 KB) into main.

## Placeholders to settle before the first store submission (RELAY step 45)

| Where | Placeholder | Note |
|---|---|---|
| `platforms/webos/appinfo.json` | `"id": "com.zoma.iptv"` | Permanent once published on LG. Depends on the final name and domain (trademark check pending). |
| `platforms/tizen/config.xml` | widget id `https://zoma-iptv.invalid/tv`, package `ZomaIPTV01`, app id `ZomaIPTV01.Zoma` | Permanent once published on Samsung. |
| `platforms/*/icon*.png` | Flat teal squares | Real icons: Tizen 512x423; webOS 80x80 (`icon`) and 130x130 (`largeIcon`). |

## Tizen `.wgt` (manual until the Tizen CLI is installed)

The Tizen Studio CLI is not installed on the build machine, and GUI tools are never installed unattended. To build a signed `.wgt` by hand:

1. Install the Tizen CLI: the Tizen SDK 10 CLI installer, or Tizen Studio 6.1 with the **TV Extensions** ([tv-setup.md](tv-setup.md) 3.1; `<sdk>/tools/ide/bin` on PATH, plus `<sdk>/tools` for `sdb`).
2. Create a **Samsung certificate profile** in Certificate Manager, with the Samsung Certificate Extension 2.0.74 or newer ([tv-setup.md](tv-setup.md) 3.2; Samsung, not Tizen, for TVs; it needs a Samsung account and the TV's DUID for a distributor certificate). Name it, e.g. `zoma-dev`. Never commit `*.p12` files (`.gitignore` blocks them).
3. Build and package:

   ```bash
   TIZEN_SIGNING_PROFILE=zoma-dev pnpm build:tv --platform tizen
   ```

   This runs `tizen package -t wgt -s zoma-dev -- dist/tv/tizen` and moves the `.wgt` into `dist/packages/`.
   Without the env var, the equivalent by hand is `tizen package -t wgt -s zoma-dev -- dist/tv/tizen`.
4. Install: `sdb connect <tv-ip>`, then `pnpm device install tizen <serial>` (serial from `pnpm device devices tizen`), then `pnpm device launch tizen <serial>`.

## webOS `.ipk` on a TV or the emulator

1. LG TV: install the **Developer Mode** app from LG Apps (formerly the LG Content Store), sign in with the LG developer account, turn on Dev Mode and the key server. The session lasts up to 1,000 hours by LG's forum (no official figure); extend it in the app or from this PC ([tv-setup.md](tv-setup.md) 2.2).
2. Register the TV once. The ares-* commands live in `tools/device`, so run them through pnpm:

   ```bash
   pnpm --filter @zoma/tools-device exec ares-setup-device --add tv --info "host=<tv-ip>" --info "port=9922" --info "username=prisoner"
   pnpm --filter @zoma/tools-device exec ares-novacom --device tv --getkey   # enter the passphrase shown on the TV
   ```
3. `pnpm build:tv`, then `pnpm device install webos tv`, `pnpm device launch webos tv`. `pnpm device inspect webos tv` opens remote DevTools.

`pnpm device devices webos` lists the configured devices (`emulator` is preconfigured for the webOS emulator at `127.0.0.1:6622`).

## Desktop check ("press these keys")

Run `pnpm dev`, open the URL at 1920x1080, then:

1. The screen shows **Zoma زوما** (Latin in Noto Sans, the Arabic in teal in Noto Sans Arabic UI: DevTools → Elements → Computed → "Rendered Fonts" names both as network resources), "Hello from browser", a device table (model "Desktop browser", tier `full`) and **Worker: ok in N ms (TextDecoder, indexedDB, fetch)** and **IndexedDB (in the worker): ok**.
2. Press the arrows, Enter, PgUp/PgDn, digits, F1–F4, Space, `i`, `g`: the big text shows `DOWN`, `OK`, `CH_UP`, `DIGIT_5`, `RED`, `PLAY_PAUSE`, `INFO`, `GUIDE`… and the key count goes up.
3. Press `a`: nothing changes.
4. The **Focus** block under the remote (the focus engine, step 10) starts on `home · list 0`:
   - Down moves down the list, which shows 4 rows at a time and scrolls. Up from the first row goes to the rail of tiles, Right from the list to the grid, and Left from the grid's first column back to the list's remembered row (thin outline).
   - PgDn and PgUp move a page of the list.
   - Enter opens a "details" box (`details · buttons 0`); Esc closes it, and the focus is back where it was.
5. With the mouse: moving over a tile focuses it (`data-pointer` true); an arrow key carries on from there. The wheel scrolls the focused list.
6. Esc on the main screen shows "Exit Zoma?" (Tizen and the browser ask first; webOS goes straight to the launcher). Enter on Stay closes it; Right then Enter on Exit shows "Back: exit requested".
7. Reload with `?tier=low&locale=ar-SA`: the table shows tier `low` and locale `ar-SA`, and the Focus block runs right to left: Left moves along the rail towards its end, Right back. Up and Down don't change.
8. In `ar-SA` the whole page is mirrored (step 11a, postcss-rtlcss): the Device panel is on the right and the catalog panel on the left, the table headings are right-aligned, and the Arabic name sits left of "Zoma". `<html>` has `dir="rtl"` and `lang="ar-SA"`.

### The component gallery (step 11b)

Open `http://localhost:5173/?screen=gallery` at 1920x1080 (a built bundle takes the same `?screen=gallery` on its `index.html`). It shows every base component, and nothing on it scrolls or leaves the 96/54 px safe area.

1. It starts on channel row **101 Zoma News** (thick teal ring). The Play button, the "All channels" chip and the first tile show a thin ring: each zone's remembered item.
2. **Down** walks the channel list. After row 107 the list scrolls: it always shows 7 of 240 rows. **PgDn**/**PgUp** move 7 rows at a time.
3. **Up** from the first row goes to the category rail. **Right** walks the chips, and the rail scrolls after the sixth. **Enter** selects a chip: it stays filled, and the header says "Selected: …".
4. **Up** again reaches the buttons. Play is filled and Remove is red. **Record** is dimmed: it takes the focus, but Enter does nothing.
5. From the list, **Right** goes to the tiles (3 × 2), and **Left** from the first column goes back to the list's remembered row.
6. **Enter** on a row (or on Play) opens "Play …?". **Esc** or Cancel closes it, and the focus is back on the same row. **Esc** on the gallery itself shows "Exit Zoma?".
7. **Mouse:** moving over an item focuses it, and a click selects it. The wheel scrolls the focused list. An arrow key carries on from the item the pointer was on. On a webOS TV, one press of the Magic Remote's OK selects once, though webOS sends both a click and key 13.
8. Add `&locale=ar-SA`: the whole screen mirrors. The list is on the right, the rail and the buttons start on the right, and the channel number is at each row's right. **Left** moves towards the end of a row of items. Latin channel names stay left to right inside Arabic rows. The media timeline (1:13:12 / 2:00:00) still fills from the left; the loading bar fills from the right.
   - Since step 12a the words come from the catalogs (`apps/tv/src/i18n`): the header reads `ar-SA · 240 قناةً` with the locale tag at the right, the expiry badge `ينتهي خلال 3 أيام`, and the digits are Western (ADR-011). In English: `240 channels`, `Expires in 3 days`.
   - **Enter** on row 103 opens `تشغيل Zoma Sports 1؟`, the Latin name in its own left-to-right order inside the Arabic sentence (the runtime isolates it between FSI and PDI).
9. Add `&locale=en-XA` (the pseudo-locale): every label of ours is accented, about 40% longer and in brackets, e.g. `[Þļåý one]`. Channel names, titles and HD/4K marks stay plain, because they are the provider's text. Nothing is cut except the chips (fixed width, with an ellipsis), and nothing leaves the safe area.
