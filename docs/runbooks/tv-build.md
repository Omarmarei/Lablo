# Runbook: TV builds, packaging and device commands

How `pnpm build:tv`, `pnpm dev` and `pnpm device` work, and the manual Tizen steps. Full TV setup (Developer Mode, emulators, Samsung certificates) comes in `docs/runbooks/tv-setup.md` (RELAY step 15).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server for `apps/tv` with the browser adapter (keyboard = remote). Open the printed URL at 1920x1080. URL overrides: `?tier=low&locale=ar-SA&country=SA`. |
| `pnpm build:tv` | Both TV builds, the ES2016 syntax gate, bundle budgets and the webOS `.ipk`. Options: `--platform tizen` or `--platform webos` (repeatable), `--skip-package`, `--out <dir>` (staging root instead of `dist/tv`). Test only: `--unsafe-no-polyfills` builds without core-js for the old-engine self-test; it needs `--out`, refuses `dist/tv` and never packages. |
| `pnpm verify:engines` | The built apps in Chromium 53/56/68 snapshots (Docker). See [old-engines.md](old-engines.md). |
| `pnpm e2e` | Playwright: the dev app by keyboard, and both built TV bundles booted from `file://`. Needs `pnpm build:tv` first (`pnpm verify` runs it). |
| `pnpm device <devices\|install\|launch\|inspect> <webos\|tizen> [device]` | Install, launch or remote-inspect the build on a TV. |

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
4. **Budgets.** Minified bytes as shipped: main ≤ 500 KB (including inlined workers), each worker ≤ 150 KB. Over budget fails the build before anything is packaged.
5. **Platform isolation.** The Tizen bundle must not contain webOS adapter code (`PalmSystem`, `webOSRelaunch`) and vice versa (`tvinputdevice`, `productinfo`); neither may contain the desktop adapter.
6. **Stage** `dist/tv/<platform>/`: `index.html` (classic scripts; Tizen also loads `$WEBAPIS/webapis/webapis.js`), `main.js`, `app.css`, the platform manifest with `{{version}}` replaced by `apps/tv/package.json` `version`, and the icons from `platforms/<platform>/`.
7. **Package** into `dist/packages/`:
   - **webOS:** `ares-package --no-minify` from `@webos-tools/cli` (a devDependency; no global install). Output: `com.zoma.iptv_<version>_all.ipk`. `--no-minify` keeps the shipped bytes identical to the gated ones.
   - **Tizen:** only when the Tizen CLI is on PATH **and** `TIZEN_SIGNING_PROFILE` names a certificate profile. Otherwise the build prints why it skipped and still succeeds.

When a gate failure appears: find the excerpt in the source, or the dependency it came from. Regex lookbehind and named groups cannot be transpiled; rewrite the regex. A dependency shipping new syntax is already transpiled; if it still fails, it may use something Babel has no transform for.

## Placeholders to settle before the first store submission (RELAY step 45)

| Where | Placeholder | Note |
|---|---|---|
| `platforms/webos/appinfo.json` | `"id": "com.zoma.iptv"` | Permanent once published on LG. Depends on the final name and domain (trademark check pending). |
| `platforms/tizen/config.xml` | widget id `https://zoma-iptv.invalid/tv`, package `ZomaIPTV01`, app id `ZomaIPTV01.Zoma` | Permanent once published on Samsung. |
| `platforms/*/icon*.png` | Flat teal squares | Real icons: Tizen 512x423; webOS 80x80 (`icon`) and 130x130 (`largeIcon`). |

## Tizen `.wgt` (manual until the Tizen CLI is installed)

The Tizen Studio CLI is not installed on the build machine, and GUI tools are never installed unattended. To build a signed `.wgt` by hand:

1. Install Tizen Studio with the **TV Extensions** and the CLI (`tizen-studio/tools/ide/bin` on PATH, plus `tizen-studio/tools` for `sdb`).
2. Create a **Samsung certificate profile** in Certificate Manager (Samsung, not Tizen, for TVs; it needs a Samsung account and the TV's DUID for a distributor certificate). Name it, e.g. `zoma-dev`. Never commit `*.p12` files (`.gitignore` blocks them).
3. Build and package:

   ```bash
   TIZEN_SIGNING_PROFILE=zoma-dev pnpm build:tv --platform tizen
   ```

   This runs `tizen package -t wgt -s zoma-dev -- dist/tv/tizen` and moves the `.wgt` into `dist/packages/`.
   Without the env var, the equivalent by hand is `tizen package -t wgt -s zoma-dev -- dist/tv/tizen`.
4. Install: `sdb connect <tv-ip>`, then `pnpm device install tizen <serial>` (serial from `pnpm device devices tizen`), then `pnpm device launch tizen <serial>`.

## webOS `.ipk` on a TV or the emulator

1. LG TV: install the **Developer Mode** app from the LG Content Store, sign in with the LG developer account, turn on Dev Mode and the key server. Dev Mode lasts about 50 hours; extend it in the app.
2. Register the TV once. The ares-* commands live in `tools/device`, so run them through pnpm:

   ```bash
   pnpm --filter @zoma/tools-device exec ares-setup-device --add tv --info "host=<tv-ip>" --info "port=9922" --info "username=prisoner"
   pnpm --filter @zoma/tools-device exec ares-novacom --device tv --getkey   # enter the passphrase shown on the TV
   ```
3. `pnpm build:tv`, then `pnpm device install webos tv`, `pnpm device launch webos tv`. `pnpm device inspect webos tv` opens remote DevTools.

`pnpm device devices webos` lists the configured devices (`emulator` is preconfigured for the webOS emulator at `127.0.0.1:6622`).

## Desktop check ("press these keys")

Run `pnpm dev`, open the URL at 1920x1080, then:

1. The screen shows **Zoma**, "Hello from browser", a device table (model "Desktop browser", tier `full`) and **Worker: ok in N ms (TextDecoder, indexedDB, fetch)** and **IndexedDB (in the worker): ok**.
2. Press the arrows, Enter, PgUp/PgDn, digits, F1–F4, Space, `i`, `g`: the big text shows `DOWN`, `OK`, `CH_UP`, `DIGIT_5`, `RED`, `PLAY_PAUSE`, `INFO`, `GUIDE`… and the key count goes up.
3. Press `a`: nothing changes.
4. Press Esc: it shows `BACK` and "Back: exit requested".
5. Reload with `?tier=low&locale=ar-SA`: the table shows tier `low` and locale `ar-SA`.
