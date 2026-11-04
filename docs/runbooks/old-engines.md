# Runbook: the old-engine harness (`pnpm verify:engines`)

The TV build targets Chromium 53 (LG webOS 4, 2018) and 56 (Samsung Tizen 4, 2018). Playwright can't attach to engines that old, and test TVs are scarce. So `tools/engines` runs the **built** TV apps (`dist/tv`) in real Chromium snapshots of those versions (ADR-003, RELAY step 2b).

## Commands

| Command | What it does |
|---|---|
| `pnpm build:tv` | Needed first: the harness tests `dist/tv/{tizen,webos}` and the Zoma Lab in `dist/tv-lab/{tizen,webos}`. |
| `pnpm verify:engines` | Runs both TV apps in Chromium 53, 56 and 68: the hello screen, the component gallery, then onboarding walked by keys in English and Arabic to the live screen, and the live screen by the TV's own keys. Then both Zoma Lab bundles, reporting to a mock provider on the host. Fails on any problem. |
| `pnpm verify:engines --self-test` | Also runs deliberately broken bundles that must fail (below). This is what CI runs. |
| `pnpm verify:engines --engine chrome53` | One engine (repeatable). |
| `pnpm verify:engines --dist-lab <dir>` | Other lab builds than `dist/tv-lab`. |
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
6. Per app, **onboarding** (step 13c; `file:///app/<variant>/<platform>/index.html` with no parameters, what a TV opens; `src/onboarding.ts`). It is walked twice by keys only, in English and then in Arabic, each time from a fresh database. The probe is plain ES5, with the layout selectors of `layout()` in `e2e/onboarding.spec.ts`. `test/engines-onboarding.test.ts` keeps them, the field's id, the database names and the start screen equal to the app's.
   - **Fresh database:** the containers keep their profile between runs, and a stored source skips onboarding. So before each walk, and once after the last, the harness opens `file:///app/blank.html` (staged next to the variants, the same `file://` origin) and deletes the `zoma` database there, while no app page holds it open.
   - **First start:** `[data-testid=onboarding][data-ready=true]`. The app reads the profile from the query worker first, behind a spinner, and the walk times it (`first screen` in the log). The language screen must show the engine's own language (English) focused, and a Latin and an Arabic Zoma Sans face must have loaded.
   - **The keys:** English (or ArrowRight to العربية, then `<html dir="rtl">` and `data-language="ar"`), I understand, the consent row (RIGHT then LEFT; in Arabic LEFT then RIGHT, mirrored), Allow, ArrowDown to the M3U link, OK. Each step must land on the expected `data-screen`, `data-zone` and `data-index` within 3 s.
   - **Typing:** OK on the playlist field must give its input DOM focus (`document.activeElement.id === 'onboarding-playlist'`), which is what opens a TV's keyboard. The fixture playlist's link (`127.0.0.1:8090/playlist.m3u`, `.m3u.gz` on webOS) is typed without `http://`, plus an `x`, as CDP `Input.dispatchKeyEvent` `char` events. `Input.insertText` doesn't exist in Chromium 53 (`'Input.insertText' wasn't found`), so all three engines type this way. Backspace must delete the `x` and keep the form (it is Back elsewhere). OK (key 13) must end the edit, keep the link and move the focus to the next field.
   - **Load:** ArrowDown twice and OK on "Add source". Within 60 s the done screen must show the fixture's counts in `data-n` (2,400 channels, 600 films, 0 series), after the `download` and `guide` phases (recorded by a `MutationObserver`). The profile read back from IndexedDB must hold one source, `s1`, of type `m3u`, named after the host (`127.0.0.1`), with the language picked and the consent.
   - **The live screen and the relaunch** (step 14a): OK on "Start watching" must open the live screen on `live · channels 0`, in the walk's language (`dir="rtl"` in Arabic), listing the fixture's 2,400 channels (its header's `data-n`). A screenshot of it is saved (`onboarding-<engine>-<platform>-<language>-live.png`). The same address is then loaded again, and the live screen must show the same way with no onboarding: the source was kept (`relaunch` in the log). The walk leaves each live screen only once its data requests have all answered (`data-pending="0"`, the focused channel's 600 ms short-EPG wait included), so no worker is still using the database when the next delete starts. Until step 14a the walk ended on the hello screen and waited for its data panel's last row.
   - **Found on CI (2026-11-03):** leaving the relaunched hello screen 0.2 s after it showed, most likely while its data workers were still opening the database, left Chromium 53's next `deleteDatabase` with no answer at all (no success, error or `blocked`) for 10 s. Waiting for the panel fixed it, and the delete after the last walk is checked too, so a stuck one fails the run instead of the next one.
   - **The live screen by keys** (step 14c, `src/live.ts`): from the relaunch, with the platform's own key codes (`TV_KEYS`; `test/engines-onboarding.test.ts` keeps them equal to the adapters'). ArrowDown to `live · channels 1`; CH− (Tizen 428, webOS 34) a window of 9 rows further, to `channels 10` with `data-top` 9; CH+ (427, 33) back; LEFT to `rail 0` (RIGHT in Arabic, where the rail is on the right); ArrowDown five times and OK on "Group 5", to its first channel; Back (10009, 461) to `rail 5`. Then Back on the rail: on Tizen the exit dialog (`exit · buttons 0`, a screenshot), and OK on "Stay" closes it; on webOS the root policy calls `PalmSystem.platformBack()`. The desktop engine has no `PalmSystem`, and the adapter's fallback, `window.close()`, would end the run, so the walk first puts a stand-in on the page (`PLATFORM_BACK_STUB`) that counts the calls: exactly one.
     - **Every step of the walk** (onboarding too) must have the focus engine (`window.__ZOMA_TEST__.focusPath()`) agree with the `data-screen/zone/index` the screen draws, and every step on the live screen waits for `data-pending="0"` (8 s at most).
     - **Rows**, after the relaunch, after CH− and in the category: the window from `data-top`; each row's number, which is its place in "All channels" (Group 5 starts at 618); its name; and now/next from the fixture's guide at the page's clock (`fixture.17 23h`, next `fixture.17 0h`), or the placeholder in the walk's language on a channel without a guide. The fixture's live channels are listed category by category, the groups in the order they first appear (`liveCategories`, cross-checked with the ingest's `CatalogChunker` by `test/engines-fixture.test.ts`).
     - **The rail**, after the relaunch and in the category: on the inline start side of the list, its chips from the top with the fixture's 14 group names and counts (digits only: `2,400`), only the category on show selected, and the header naming it with its count.
     - **First run (2026-11-04):** every check passed on all three engines, both bundles, both languages, on the first run. CH− and OK on a category each took 0.7 s to an idle screen (600 ms of it the focused channel's short-EPG wait). The Arabic category and exit screens on Chromium 53, the live screen on 56 and the category on 68 were looked at: the rail on the right with Group 5 selected, the rows numbered from 618, now/next across midnight on every other row and the placeholder on the rest, "Stay" focused at the inline start of the dialog.
   - **Screens:** the language, disclaimer, consent, source, form and done screens are each measured as in the e2e test: 1920x1080 with no scroll, every box inside the title-safe area, no label cut, and so are the live screen, its next window, the category and the exit dialog (the boxes and labels of `layout()` in `e2e/live.spec.ts`). Saved as `artifacts/engines/onboarding-<engine>-<platform>-<en|ar>-<screen>.png`, real app only: the form (with the link typed), done, live, category and, on Tizen, exit.
   - **First run (2026-11-03):** every check passed on all three engines, in both languages and both bundles. With an empty database the first screen took 0.1–0.2 s, the load about 2 s (0.8 s on 68) and the relaunch 0.2 s.
   - **With the live screen (step 14a, 2026-11-03):** every check passed on the first run on all three engines. The relaunch now takes 0.7–0.8 s to an idle live screen: 600 ms of it is the focused channel's short-EPG wait. The Arabic live screen on Chromium 53 was looked at: the rail on the right with the fixture's groups and counts, the rows mirrored, now/next on the channels with a guide, "لا يوجد دليل لهذه القناة" on the others. The Arabic screens were looked at: the link reads left to right in a right-aligned box, the hint keeps `http://` and `https://` whole, and the done screen's name and counts read right to left.
7. Per engine, **the Zoma Lab** (step 15a; `src/lab.ts`, docs/runbooks/lab.md): `file:///app/lab/<platform>/index.html?server=http://host.docker.internal:<port>&mb=16&auto=1`, both bundles. The lab runs its spikes at launch, as on a TV.
   - **The collector:** before the first engine, the harness starts the mock provider in its own process on a free port (`tools/` may not import `apps/`). It runs on `127.0.0.1` with Docker Desktop, which forwards `host.docker.internal` to the host's loopback, and on `0.0.0.0` on Linux (CI), where `host.docker.internal` is the bridge's gateway. The records land in `artifacts/engines/lab-logs/`. Each container gets `--add-host host.docker.internal:host-gateway`.
   - **Before each lab run** the harness deletes the app's database from the blank page (`resetDatabase`). The app's screens run on the same `file://` origin first and can leave a source behind (CI's Chromium 68 did once, 2026-11-04, though local runs never had), and S6 (step 15b) skips where it finds the app's data (`S6/source: skip … this origin holds the app's own data`). On a TV the lab has its own storage.
   - **The run** ends when the lab's first run is over and every record is sent (`window.__ZOMA_LAB__`; two minutes at most). S7's refused requests don't end the wait early (`labErrorGate`): S6 runs after S7, for seconds here and minutes on a TV.
   - **Checks:**
     - every check answers as `EXPECTED_STATUSES` says: S1 all pass; S2's write test (16 MB) passes; S3 fails its device ID (a TV bundle without TV APIs); S7's three no-CORS checks fail, because a desktop engine enforces CORS; S6's seven checks report `info` (the host mock's small catalog: S6 measures the app's data engine and live screen but judges nothing). `tools/engines/src/lab.test.ts` keeps the list equal to the e2e test's (`e2e/lab.spec.ts`).
     - the polyfills the bundle filled (the page's native probe runs before main.js) must be exactly the built-ins the engine lacks (`NATIVE_SINCE`): eight on 53, six on 56, four on 68;
     - the collector has every record of the session, in order;
     - no uncaught error, except the console errors S7's refused requests cause (`isExpectedRefusal`).
   - **First run (2026-11-04):** every check as expected on the first try, on all three engines and both bundles. The bundle filled 8 built-ins on 53, 6 on 56 and 4 on 68, exactly the ones each lacks. A whole lab run took about 0.9 s per bundle: 10,000 items in 0.16–0.3 s, IndexedDB writes at 60–170 MB/s (a desktop's disk, not a TV's).
8. Results print as a table (variant, platform, screen; with each run's items and hits, rows, screenshots and the isolation's width, or the walks' times) and go to `artifacts/engines/report.json`, with the bidi probe's numbers per gallery run and the times, phases and screenshots of each onboarding walk. CI uploads it with the twelve gallery screenshots (English and Arabic) and the 54 onboarding ones as `old-engines-report`.

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
| `app` | the real `dist/tv` builds | hello, gallery, onboarding | none | passes on 53, 56, 68 |
| `seed-es2018-object-spread` | `var __zomaSeed = { ...{ seeded: true } };` prepended to `main.js` | hello, gallery | < 60 | 53, 56: `Uncaught SyntaxError: Unexpected token ...`; 68 passes |
| `seed-es2020-optional-chaining` | `window.__zomaMissing?.value` prepended | hello, gallery | < 80 | 53, 56, 68: `Unexpected token .` |
| `seed-css-no-list-row` | app.css without ListRow.css's rules (every `.z-row` selector, both directions) | gallery | every engine | 53, 56, 68: `channel rows 197 px; 196 px; 235 px; 114 px tall, expected 88 px` |
| `seed-css-no-safe-area` | the `padding` of the `.gallery` rule taken out of app.css | gallery | every engine | 53, 56, 68: `outside the safe area: gallery__title: Components; …` |
| `no-polyfills` | the app built with `build-tv --unsafe-no-polyfills` (no core-js) | hello | < 71 | 53, 56: `padStart is not a function`; 68: `queueMicrotask is not defined` |
| `seed-walk-no-input-focus` | `HTMLElement.prototype.focus = function () {};` prepended to `main.js`: no input takes DOM focus, so a TV's keyboard would never open | onboarding | every engine | 53, 56, 68: `OK on the playlist field: expected … DOM focus on onboarding-playlist; saw … no DOM focus, link ""` (both languages) |
| `seed-walk-forgets-profile` | `indexedDB.deleteDatabase('zoma');` prepended to `main.js`: the database is deleted at every start, as on a TV that keeps nothing between launches | onboarding | every engine | 53, 56, 68: `the relaunch: expected the live screen, its data requests answered, no onboarding, live · channels 0, …; saw language · languages 0` (both languages) |
| `seed-css-no-live` (step 14c, 2026-11-04) | app.css without live.css's rules (every `.live` selector, both directions) | onboarding | every engine | 53, 56, 68: `on the live screen: the page scrolls: it is 1920x1957`, `outside the safe area: live__title: Live TV; …`, `the relaunch: the rail is over the list, expected on the left (the inline start)` (every live screen, both languages) |
| `seed-live-no-back-key` (step 14c, 2026-11-04) | a capturing keydown listener prepended to `main.js` that keeps 10009 and 461 from the app, as on a TV that keeps Back for itself | onboarding | every engine | 53, 56, 68: `Back (key 461) to the rail: expected …, live · rail 5, category 5, …; saw the live screen, live · channels 0, …` (both languages) |
| `seed-focus-engine-stuck` (step 14c, 2026-11-04) | `window.__ZOMA_TEST__` wrapped before the app installs it, so its `focusPath()` keeps answering the first focus it saw while the screen draws each move | onboarding | every engine | 53, 56, 68: `OK on English: expected disclaimer · actions 0, …; saw the screen draws disclaimer/actions/0, but the focus engine is at language/languages/0` |
| `lab-seed-no-worker` (step 15a, 2026-11-04) | the lab bundles with `window.Worker = undefined;` before main.js | lab | every engine | 53, 56, 68: `S1/blob-worker: fail, expected pass (threw TypeError: Worker is not a constructor)`, the same for `fetch-stream-worker` and `idb-bulk-worker` (both bundles) |

That is 102 runs, 74 of them failures that must be caught (2026-11-04, in one run; 90 and 68 before the lab). The syntax seeds run on the two developer screens only: a parse error fails whatever screen opens. The walk seeds are plain ES5, so only the walk can catch them: one stops it at the field, one at the relaunch, the Back-key seed on the live screen, and the stuck focus engine at the first key (the real app's engine and screen always agree, so only a seed can show that the check bites). live.css's seed runs where the walk reaches the live screen, since only it shows that CSS. The gallery needs no polyfill at all: without core-js it passes on all three engines (2026-11-03; rechecked with the Arabic phase in step 12b), so `no-polyfills` runs the hello screen only. The CSS seeds fail the staging if they find nothing to take out (a renamed class or file), so they can't silently test nothing.

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
- **An onboarding check fails:** the failure names the step, what it expected and what the page showed (`form · fields 0, editing onboarding-playlist, no DOM focus, link ""`). The walk stops there, so the step is the first thing that went wrong. Open the `onboarding-*-form.png`, `-done.png`, `-live.png`, `-category.png` and `-exit.png` screenshots of the run (only steps that landed save one). `the app's database could not be deleted before the walk (blocked)` means a page still held it open: check that the walk navigated to `blank.html` first. `(pending)` means the delete got no answer at all: the previous page was left while its workers were still in the database (see "Found on CI" above). `the load failed: <code>` quotes the loader's error code (`network`, `format`…); the container log lists the fixture requests. `the relaunch: … saw language · languages 0` means the source was not kept: the profile write or IndexedDB in the Blob worker. `saw the live screen, its data requests still running` means a request of the live screen never answered (`data-pending` stayed above 0); `the live screen lists N channels` means the categories it read don't add up to the fixture's. `the stored profile has the sources …` names what was stored instead of `s1`. On the live screen: `saw the screen draws X, but the focus engine is at Y` means the DOM and the focus engine disagree (a screen that renders a focus it doesn't have, or `main.tsx` not handing the hook the screen's navigator); `the rows never filled in` names the rows that showed neither a programme nor the placeholder; `N of 9 rows wrong` names each row's number, name or programme against the fixture (a now title of another hour means the engine's clock and the guide's UTC hours disagree); a Back step that saw `live · channels 0` means the TV's Back code never reached the app; `platformBack() called` missing on webOS means Back at the root didn't hand over to the system.
- **An Arabic gallery check fails:** open the `-ar.png` screenshot. `language switch (…): the page is dir="ltr"` means the keys didn't reach the language button: the gallery's zones changed (update `SWITCH_KEYS`, the e2e switch tests and `gallery-state.test.ts` together). `a name ending in a digit: the count joined it` or `the digit split off` means the engine ignores the isolation `isolateText` writes; compare the probe's numbers in `report.json` with its controls. `the control … proves nothing` means the probe's line can't tell isolated text from plain text on that engine: change the line, not the check.
- **A gallery check fails:** open `artifacts/engines/gallery-<engine>-<platform>.png` (CI: the `old-engines-report` artifact). `the viewport is 1919x974` means the engine isn't full screen (`TV_SCREEN_FLAGS`). `channel rows … px tall` means a component's CSS is missing from app.css, or the engine ignored a property it needs. `outside the safe area` and `labels cut` name the boxes (the first five). A face `unloaded` after the timeout means no Arabic text was drawn.
- **A real app run fails:** read the failure lines. `Boot error: …` is what the TV would show on screen. Reproduce with `--engine <id> --keep`, then attach Chrome DevTools from a current Chrome at `http://127.0.0.1:<port>` (old frontends may not match; the `/json` list still works).
- **Download mismatch:** the pinned SHA-256 no longer matches. The harness deletes the file and stops; it never runs an unverified engine.
