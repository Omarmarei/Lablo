# Runbook: the old-engine harness (`pnpm verify:engines`)

The TV build targets Chromium 53 (LG webOS 4, 2018) and 56 (Samsung Tizen 4, 2018). Playwright can't attach to engines that old, and test TVs are scarce. So `tools/engines` runs the **built** TV apps (`dist/tv`) in real Chromium snapshots of those versions (ADR-003, RELAY step 2b).

## Commands

| Command | What it does |
|---|---|
| `pnpm build:tv` | Needed first: the harness tests `dist/tv/{tizen,webos}`. |
| `pnpm verify:engines` | Runs both TV apps in Chromium 53, 56 and 68: the hello screen, then the component gallery. Fails on any problem. |
| `pnpm verify:engines --self-test` | Also runs deliberately broken bundles that must fail (below). This is what CI runs. |
| `pnpm verify:engines --engine chrome53` | One engine (repeatable). |
| `pnpm verify:engines --keep` | Leaves the containers running to debug (DevTools port printed). Remove them with `docker rm -f`. |

Needs **Docker**. On Windows, start Docker Desktop first. The first run downloads about 280 MB of snapshots into `.cache/engines/` (gitignored; `ZOMA_ENGINE_CACHE` moves it) and builds the `zoma-old-engines:<hash>` image. Later runs take about a minute.

`pnpm verify` does **not** include it: it needs Docker and the downloads, and `verify` should stay quick and dependency-free. CI runs it as a separate required job (`engines` in `.github/workflows/ci.yml`). Run it locally after any change to the build pipeline, polyfills, workers or boot code.

## Engines

| Id | Snapshot | Stands in for |
|---|---|---|
| `chrome53` | position 403380 → Chromium 53.0.2785.0 | LG webOS 4.x (2018) |
| `chrome56` | position 433042 → Chromium 56.0.2924.0 | Samsung Tizen 4.0 (2018) |
| `chrome68` | position 561732 → Chromium 68.0.3440.0 | LG webOS 5 (2020); Tizen 5.5 runs 69 |

- **Source:** the public `chromium-browser-snapshots` bucket (`Linux_x64/<position>/chrome-linux.zip`).
- **Position:** the closest snapshot just below each milestone's branch point, so it still reports that major version.
- **Pinning:** `tools/engines/src/engines.ts` pins each zip's size and SHA-256. The harness also checks the major version in the user agent; that check caught the first M68 choice, 550422, which is really 67.0.3396.
- **Changing an engine:** pick the position (`https://www.googleapis.com/storage/v1/b/chromium-browser-snapshots/o?prefix=Linux_x64/<first digits>&delimiter=/`), download it, run `chrome --version` in the image, and update the pin.

## How a run works

1. `tools/engines/docker/Dockerfile` builds the image. It is **Debian 9 "stretch"**, from archive.debian.org, on purpose. On a modern Debian, Chromium 53/56 segfault at startup: they export their bundled HarfBuzz symbols, and the system Pango calls into them with a newer ABI (gdb shows `hb_face_reference_table` ← `pango_shape_item` ← `libgtk2ui::NativeThemeGtk2`). Stretch's HarfBuzz 1.4 and Pango 1.40 match.
2. Per engine, one container:
   - The snapshot zip and the staged apps are mounted read-only.
   - `run-chrome.sh` starts Xvfb (1920x1080) and the browser *headed*: 53/56 have no usable headless mode.
   - The browser runs full screen, as the app does on a TV (`TV_SCREEN_FLAGS` in `src/engines.ts`, passed in by the harness, so the image doesn't change). `--kiosk` drops the tab strip and toolbar, and `--test-type` the "unsupported command-line flag: --no-sandbox" bar. Without them the page got 1919x974 of the 1920x1080 screen on Chromium 53. A CDP viewport override gave the page 1080 px, but the old engines' screenshots stayed cut at the window.
   - `socat` forwards DevTools to a random loopback port on the host.
   - A second `socat` serves the catalog fixtures (`/app/fixtures`) on `127.0.0.1:8090` inside the container, one `serve-fixture.sh` per request: plain files, CORS headers (the page is `file://`, so the Blob worker's origin is `null`), no validators and no `Content-Encoding`. It needs no extra package, so the image's cached apt layer stays valid. The image tag hashes every file in `IMAGE_FILES` (`src/docker.ts`).
3. The host drives each app over raw CDP (`tools/engines/src/cdp.ts`, Node's built-in WebSocket). Puppeteer 1.x starts at Chromium 66 and Playwright needs a modern protocol, so neither works here.
4. Per app (`file:///app/<variant>/<platform>/index.html?screen=hello&force=1&q=<query>&source=<fixture URL>`; the hello screen is a developer screen since step 13a, when onboarding became the start screen), `src/scenario.ts` checks:
   - **Boot:** `#boot-error` stays empty, there is no uncaught exception (`Runtime.exceptionThrown`, or `Console.messageAdded` on Chromium 53, which reports errors only that way), and `[data-testid=hello][data-ready=true]` appears.
   - **Engine:** the user agent reports the expected major version.
   - **Worker:** `worker-status` starts with `ok in`. The Blob worker answered, so core-js reached it too.
   - **IndexedDB:** `idb-status` is `ok`. The worker opened a database, wrote a record and read it back.
   - **Data workers** (step 8b; the hello screen's catalog panel, `apps/tv/src/DataPanel.tsx`):
     - `data-status` is `ok`: the query worker answered and a short-lived ingest worker ran the start-up `prune`.
     - `ingest-status` is `ok: committed`: a fresh ingest worker fetched the fixture over HTTP (streamed `response.body`), parsed it, wrote 500-item chunks to IndexedDB and swapped the generation in. `data-items` must be the fixture's 3,000 items, and `data-gzip` must be `true` for the `.gz` playlist, which only fflate can unpack before Chromium 80.
     - `search-status` is `ok` with `data-total` exactly the expected hits: the query worker reloaded on `swapped` (it had loaded the old catalog at start) and searched it.
     - `epg-status` is `ok` with `data-matched` and `data-wanted` exactly the fixture's (step 9b): a fresh EPG worker fetched the guide the playlist header names (`url-tvg`), gunzipped the `.gz` one, wrote its per-channel-day buckets (`Int32Array` and `Uint8Array` columns) to IndexedDB and swapped it in, and the query worker reloaded its match table.
     - `nownext-status` is `ok`: the query worker read a channel's buckets back from IndexedDB and found the programme on air.
     - `force=1` makes every run commit a new generation (catalog and guide), although all runs in one engine share the `file://` IndexedDB.
   - **Fonts (step 11a):** boot also waits for `document.fonts.status` to leave `loading`. Then a Latin and an Arabic Zoma Sans face must be `loaded` (the title is "Zoma زوما") and none may be `error`, so the package's woff2 subsets decode and load from `file://` in each engine. The probe lists the faces as `la400:loaded ar700:loaded …`.
   - **Remote keys:** CDP `Input.dispatchKeyEvent` ArrowUp (38) and Enter (13) show `UP` and `OK`, and `key-count` is 2. The focus engine (step 10) must act on each one: `focus-status` reads `home · rail 0` after ArrowUp, then `details · buttons 0` after Enter.
5. Per app, the **component gallery** (step 11c; `file:///app/<variant>/<platform>/index.html?screen=gallery`, `src/gallery.ts`). It starts no data workers. The probe is plain ES5, with the selectors of `layout()` in `e2e/gallery.spec.ts`; `test/engines-gallery.test.ts` keeps both, and the numbers, equal to the app's.
   - **Boot:** no error, `[data-testid=gallery][data-ready=true]`, and a Latin and an Arabic Zoma Sans face each `loaded` or `error` (the demo channels have Arabic names). Then a loaded face is required for each script, and none may be `error`.
   - **Screen:** the page is 1920x1080 (`innerWidth`, `innerHeight`), and nothing scrolls.
   - **Layout:** every component box is inside the title-safe area (96/54 px), badges hidden by their container count as outside, no label of ours is cut, and no channel name is squeezed by its badges.
   - **Virtual list:** `[data-testid=channels] .z-row` is 7 rows, each 88 px tall. Every component's CSS reached app.css, and the engine applied it.
   - **Focus:** ArrowDown (40) makes `row-1` `data-state="focused"`.
   - **Screenshot:** CDP `Page.captureScreenshot` after ArrowDown and a 400 ms pause (the focus ring's 120 ms transition), as `artifacts/engines/gallery-<engine>-<platform>.png`, real app only. A failed capture fails the run. Each run deletes the old ones first.
   - **First run (2026-11-03):** every check passed on all three engines.
     - The engines' screenshots agree with each other (SSIM 0.995 for 53 against 68, 0.9998 for 53 against 56).
     - Against the e2e screenshot from current Chromium on Windows, a difference image shows only glyph edges (another font rasteriser), with no box moved.
     - `docs/design/gallery-chrome53-webos.webp` keeps the Chromium 53 one.
   - **In Arabic (step 12b).** The TV bundles take the engine's own locale (English), so the remote switches the language: from row 1, ArrowUp ×3 (row 0, the rail, the actions), ArrowRight ×4 (past Record to the language button) and Enter (`SWITCH_KEYS`). The probe then waits for `<html dir="rtl">`, `data-language="ar"` and settled fonts, and checks:
     - the focus stayed on the language button (`data-zone="language"`, `data-state="focused"`);
     - the same layout checks as above, in Arabic (`in Arabic: …` failures);
     - the mirror: the channel list's left edge is right of the first tile's;
     - the header has the plural `240 قناةً` (Arabic's `many` form);
     - **the bidi probe** (`BIDI_EXPRESSION`, once): text arguments as the i18n runtime isolates them (core's `isolateText`), measured with `Range` rects in an RTL line in the gallery's font. The isolated `Zoma 1` is as wide as the plain one (no tofu). A name ending in a digit stays on the right of the count after it (`MBC 1 · 240 قناة`). A name starting with a digit (`1 Zoma`) stays one left-to-right unit. Each line has a control without isolation that must show the problem, or the probe proves nothing.
     - A second screenshot, `gallery-<engine>-<platform>-ar.png`; `docs/design/gallery-chrome53-webos-ar.webp` keeps the Chromium 53 one.
   - **Found in step 12b:** Chromium 53, 56 and 68 draw FSI/PDI at zero width but ignore them for bidi (both lines came out as their controls). LRM/RLM marks outside the isolate fix both lines there, so `isolateText` adds them ([ADR-011](../adr/ADR-011-i18n-runtime-and-digits.md)). With the fix, every Arabic check passed on all three engines, and the screens match current Chromium's.
6. Results print as a table (variant, platform, screen; with each run's items and hits, or rows, screenshots and the isolation's width) and go to `artifacts/engines/report.json`, with the bidi probe's numbers per gallery run. CI uploads it with the twelve gallery screenshots (English and Arabic) as `old-engines-report`.

## The catalog fixture (`src/fixture.ts`)

The harness writes it to `artifacts/engines/variants/fixtures/` on every run. It never ships, and it points at no real provider.

| | tizen runs | webos runs |
|---|---|---|
| Playlist | `playlist.m3u` (plain) | `playlist.m3u.gz` (same bytes, gzipped) |
| Items | 3,000: 2,400 live, then 600 movies (`/movie/` URLs) | the same |
| Search | `news`: 308 hits (`Zoma News n`) | `اخبار`: 240 hits. The names say `أخبار`, so the bare-alef query only matches through normalization |
| Guide (step 9b) | `guide.xml`, named by the playlist's `url-tvg` | `guide.xml.gz` (same bytes, gzipped) |
| Guide matches | 300 of 2,400 live channels (every 8th, by tvg-id), plus one XMLTV channel that feeds nothing | the same |

The guide has hourly programmes from a day before the harness starts to 3 days after, written in UTC. The engine reads it at its own clock, the harness machine's, so now/next always finds a programme on air.

Each engine runs both apps, so each engine ingests both files, runs both searches and reads both guides. `test/engines-fixture.test.ts` checks the expected numbers against core's real M3U parser, `normalizeName` and `EpgGuideReader`.

## The self-test (proof that the harness catches problems)

`--self-test` stages extra variants next to the real apps in `artifacts/engines/variants/`. Each runs on its screens and must fail on every engine below its minimum and pass on the rest:

| Variant | What it is | Screens | Must fail on | Result (2026-11-03) |
|---|---|---|---|---|
| `app` | the real `dist/tv` builds | hello, gallery | none | passes on 53, 56, 68 |
| `seed-es2018-object-spread` | `var __zomaSeed = { ...{ seeded: true } };` prepended to `main.js` | hello, gallery | < 60 | 53, 56: `Uncaught SyntaxError: Unexpected token ...`; 68 passes |
| `seed-es2020-optional-chaining` | `window.__zomaMissing?.value` prepended | hello, gallery | < 80 | 53, 56, 68: `Unexpected token .` |
| `seed-css-no-list-row` | app.css without ListRow.css's rules (every `.z-row` selector, both directions) | gallery | every engine | 53, 56, 68: `channel rows 197 px; 196 px; 235 px; 114 px tall, expected 88 px` |
| `seed-css-no-safe-area` | the `padding` of the `.gallery` rule taken out of app.css | gallery | every engine | 53, 56, 68: `outside the safe area: gallery__title: Components; …` |
| `no-polyfills` | the app built with `build-tv --unsafe-no-polyfills` (no core-js) | hello | < 71 | 53, 56: `padStart is not a function`; 68: `queueMicrotask is not defined` |

That is 54 runs, 38 of them failures that must be caught. The gallery needs no polyfill at all: without core-js it passes on all three engines (2026-11-03; rechecked with the Arabic phase in step 12b), so `no-polyfills` runs the hello screen only. The CSS seeds fail the staging if they find nothing to take out (a renamed class or file), so they can't silently test nothing.

The seeds are prepended to the *built* bundle, because the ES2016 build gate would reject them at build time. That is the point: the harness catches what reaches the engine even if the gate were bypassed. `--unsafe-no-polyfills` is a test-only flag of `pnpm build:tv`: it requires `--out <dir>`, refuses `dist/tv` and never packages.

## The TV runtime switch (and the S1 finding)

The engines run with `--allow-file-access-from-files` (`TV_RUNTIME_FLAGS` in `src/engines.ts`). The TV runtimes (webOS WAM, Tizen WRT) load packaged apps from `file://` with file access granted. Desktop Chromium doesn't, and without the switch it **denies IndexedDB inside a Blob worker** on 53, 56 and 68 alike. Main-thread IndexedDB works either way.

Probe of 2026-11-02, IndexedDB on a `file://` page:

| | Main thread | Blob worker | Blob worker + switch |
|---|---|---|---|
| Chromium 53 / 56 / 68 | ok | denied | ok |

The data engine keeps the catalog in IndexedDB inside workers, so **spike S1 must confirm IndexedDB in a Blob worker on the real TVs** (architecture.md §5). The fallbacks are a main-thread IndexedDB proxy, or a packaged worker file instead of a Blob.

**The data workers with the switch (step 8b, 2026-11-02):** in Chromium 53, 56 and 68, the query worker and the ingest worker both run as Blob workers from `file://`. They stream a playlist over HTTP, gunzip it with fflate, write it to IndexedDB in 500-item chunks, swap generations, reload and search. That is S1's data path as far as an emulator can take it. Only a real webOS 4 and Tizen 4 set can confirm the switch's assumption.

**The EPG worker (step 9b):** the same runs also read the fixture guide in a third Blob worker, store its typed-array buckets in IndexedDB and read now/next back through the query worker.

## Troubleshooting

- **`the Docker daemon is not reachable`:** start Docker Desktop.
- **`DevTools … did not answer`:** the engine crashed at startup, and the harness prints the container log. Check the image (libraries) first. `docker run --rm --entrypoint /bin/sh <image> -c "unzip -q /engine.zip -d /opt/e && ldd /opt/e/chrome-linux/chrome | grep 'not found'"` with the zip mounted at `/engine.zip`.
- **A data check fails:** `refresh of playlist.m3u.gz: failed: …` quotes the app's own error (`IngestError` codes such as `network`, `http`, `format`). The container log lists every fixture request (`fixtures: GET /playlist.m3u.gz`); no request at all means the worker never fetched. `search … found 0` with a committed refresh means the query worker did not reload after the swap. `guide guide.xml.gz: failed: debug:tvg0 format` names the guide and the refresh's error code; `matched 0 of 2400` with an `ok` guide means the reader saw no channel ids (a gzip or decoding problem), and `now/next: none` with matches means the buckets didn't come back from IndexedDB or the engine's clock is outside the fixture's four days.
- **An Arabic gallery check fails:** open the `-ar.png` screenshot. `language switch (…): the page is dir="ltr"` means the keys didn't reach the language button: the gallery's zones changed (update `SWITCH_KEYS`, the e2e switch tests and `gallery-state.test.ts` together). `a name ending in a digit: the count joined it` or `the digit split off` means the engine ignores the isolation `isolateText` writes; compare the probe's numbers in `report.json` with its controls. `the control … proves nothing` means the probe's line can't tell isolated text from plain text on that engine: change the line, not the check.
- **A gallery check fails:** open `artifacts/engines/gallery-<engine>-<platform>.png` (CI: the `old-engines-report` artifact). `the viewport is 1919x974` means the engine isn't full screen (`TV_SCREEN_FLAGS`). `channel rows … px tall` means a component's CSS is missing from app.css, or the engine ignored a property it needs. `outside the safe area` and `labels cut` name the boxes (the first five). A face `unloaded` after the timeout means no Arabic text was drawn.
- **A real app run fails:** read the failure lines. `Boot error: …` is what the TV would show on screen. Reproduce with `--engine <id> --keep`, then attach Chrome DevTools from a current Chrome at `http://127.0.0.1:<port>` (old frontends may not match; the `/json` list still works).
- **Download mismatch:** the pinned SHA-256 no longer matches. The harness deletes the file and stops; it never runs an unverified engine.
