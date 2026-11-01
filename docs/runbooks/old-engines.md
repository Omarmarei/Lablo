# Runbook: the old-engine harness (`pnpm verify:engines`)

The TV build targets Chromium 53 (LG webOS 4, 2018) and 56 (Samsung Tizen 4, 2018). Playwright can't attach to engines that old, and test TVs are scarce. So `tools/engines` runs the **built** TV apps (`dist/tv`) in real Chromium snapshots of those versions (ADR-003, RELAY step 2b).

## Commands

| Command | What it does |
|---|---|
| `pnpm build:tv` | Needed first: the harness tests `dist/tv/{tizen,webos}`. |
| `pnpm verify:engines` | Runs both TV apps in Chromium 53, 56 and 68. Fails on any problem. |
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
   - `socat` forwards DevTools to a random loopback port on the host.
3. The host drives each app over raw CDP (`tools/engines/src/cdp.ts`, Node's built-in WebSocket). Puppeteer 1.x starts at Chromium 66 and Playwright needs a modern protocol, so neither works here.
4. Per app (`file:///app/<variant>/<platform>/index.html`), `src/scenario.ts` checks:
   - **Boot:** `#boot-error` stays empty, there is no uncaught exception (`Runtime.exceptionThrown`, or `Console.messageAdded` on Chromium 53, which reports errors only that way), and `[data-testid=hello][data-ready=true]` appears.
   - **Engine:** the user agent reports the expected major version.
   - **Worker:** `worker-status` starts with `ok in`. The Blob worker answered, so core-js reached it too.
   - **IndexedDB:** `idb-status` is `ok`. The worker opened a database, wrote a record and read it back.
   - **Remote keys:** CDP `Input.dispatchKeyEvent` ArrowUp (38) and Enter (13) show `UP` and `OK`, and `key-count` is 2.
5. Results print as a table and go to `artifacts/engines/report.json`. CI uploads it as `old-engines-report`.

## The self-test (proof that the harness catches problems)

`--self-test` stages extra variants next to the real apps in `artifacts/engines/variants/`. Each must fail on every engine below its minimum and pass on the rest:

| Variant | What it is | Must fail on | Result (2026-11-02) |
|---|---|---|---|
| `app` | the real `dist/tv` builds | none | passes on 53, 56, 68 |
| `seed-es2018-object-spread` | `var __zomaSeed = { ...{ seeded: true } };` prepended to `main.js` | < 60 | 53, 56: `Uncaught SyntaxError: Unexpected token ...`; 68 passes |
| `seed-es2020-optional-chaining` | `window.__zomaMissing?.value` prepended | < 80 | 53, 56, 68: `Unexpected token .` |
| `no-polyfills` | the app built with `build-tv --unsafe-no-polyfills` (no core-js) | < 71 | 53, 56: `padStart is not a function`; 68: `queueMicrotask is not defined` |

The seeds are prepended to the *built* bundle, because the ES2016 build gate would reject them at build time. That is the point: the harness catches what reaches the engine even if the gate were bypassed. `--unsafe-no-polyfills` is a test-only flag of `pnpm build:tv`: it requires `--out <dir>`, refuses `dist/tv` and never packages.

## The TV runtime switch (and the S1 finding)

The engines run with `--allow-file-access-from-files` (`TV_RUNTIME_FLAGS` in `src/engines.ts`). The TV runtimes (webOS WAM, Tizen WRT) load packaged apps from `file://` with file access granted. Desktop Chromium doesn't, and without the switch it **denies IndexedDB inside a Blob worker** on 53, 56 and 68 alike. Main-thread IndexedDB works either way.

Probe of 2026-11-02, IndexedDB on a `file://` page:

| | Main thread | Blob worker | Blob worker + switch |
|---|---|---|---|
| Chromium 53 / 56 / 68 | ok | denied | ok |

The data engine keeps the catalog in IndexedDB inside workers, so **spike S1 must confirm IndexedDB in a Blob worker on the real TVs** (architecture.md §5). The fallbacks are a main-thread IndexedDB proxy, or a packaged worker file instead of a Blob.

## Troubleshooting

- **`the Docker daemon is not reachable`:** start Docker Desktop.
- **`DevTools … did not answer`:** the engine crashed at startup, and the harness prints the container log. Check the image (libraries) first. `docker run --rm --entrypoint /bin/sh <image> -c "unzip -q /engine.zip -d /opt/e && ldd /opt/e/chrome-linux/chrome | grep 'not found'"` with the zip mounted at `/engine.zip`.
- **A real app run fails:** read the failure lines. `Boot error: …` is what the TV would show on screen. Reproduce with `--engine <id> --keep`, then attach Chrome DevTools from a current Chrome at `http://127.0.0.1:<port>` (old frontends may not match; the `/json` list still works).
- **Download mismatch:** the pinned SHA-256 no longer matches. The harness deletes the file and stops; it never runs an unverified engine.
