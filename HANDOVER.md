# Zoma IPTV: relay leg 3 opening prompt

You are leg 3 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Leg 1 did step 1, the workspace scaffold (PR #1).
- Leg 2 did step 2, the TV build pipeline and hello app (PR #2). It merged to `main` with green CI.

**Your step is step 2b: the old-engine test harness** (Chromium 53/56/68 snapshots running the built TV bundles).

## Read first, in this order
1. `CLAUDE.md`: commands (now including `pnpm dev`, `build:tv`, `e2e` and `device`), conventions (worker imports, the `__PLATFORM__` branches), the Chromium 53 cheat sheet, package boundaries, Definition of Done, merge policy, legal guardrails and commit format.
2. `RELAY.md`: step 2b's full text and its "Done when". Steps 1 and 2 are ticked, with progress-log rows.
3. `docs/runbooks/tv-build.md`: how `pnpm build:tv` works (bundle, gate, budgets, isolation check, packaging) and what lands in `dist/`.
4. `docs/adr/ADR-003` (the chrome53 IIFE and syntax gate; it names the step-2b harness) and `docs/architecture.md` §4 (test layers, on-device testing).
5. `docs/PLAN.md` wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: never edit it, commit in it or switch its branch.
- **Branch:** HEAD is the commit that adds this `HANDOVER.md`, on top of `fda1c53` (RELAY tick) and `18d2b3a` (the step-2 feature commit). The branch is pushed and the worktree is clean.
- **`main`:** `origin/main` = `d38c73b`, the merge of PR #2 (merge commit; the branch was kept). CI on `main` is green.
- The main checkout's local `main` has not been pulled. Leave it alone.
- **Ready to use:**
  - `node_modules` is installed in the worktree.
  - Playwright's `chromium-1248`, which @playwright/test 1.64.1 needs, is in `%LOCALAPPDATA%/ms-playwright`.
  - `pnpm verify` is green: lint, typecheck, 196 unit tests, both TV builds and 5 Playwright tests.

## What exists after step 2
- **`pnpm build:tv`** (`tools/build/build-tv.ts` plus `tools/build/src/*`):
  - Bundling: Rollup IIFE, Babel 7 `preset-env {chrome: 53}` with core-js 3.51 `usage`, and TS and Preact JSX through Babel.
  - Workers: `?worker` imports are built as separate IIFEs and inlined as Blob URLs.
  - Gate: acorn `ecmaVersion: 2016` on every bundle.
  - Budgets: main ≤ 500 KB, worker ≤ 150 KB. Today main is ≈ 124/126 KB and the hello worker ≈ 37 KB.
  - Platform isolation: the Tizen bundle must not contain `PalmSystem`, the webOS bundle must not contain `tvinputdevice`/`productinfo`, and neither may contain `Desktop browser`.
  - Output: `dist/tv/{tizen,webos}/` holds `index.html` (classic scripts plus an inline ES5 `window.onerror` that writes into `#boot-error`), `main.js`, `app.css`, the manifest and icons. `dist/packages/com.zoma.iptv_0.1.0_all.ipk` comes from `ares-package --no-minify`.
  - Options: `--platform tizen|webos` and `--skip-package`.
- **Hello app hooks for the harness** (`apps/tv/src/App.tsx`):
  - `[data-testid=hello][data-ready=true]` once device info has loaded.
  - `platform-id`, `info-<field>`, `worker-status` (text `ok in N ms (…)` or `failed: …`), `last-intent`, `key-count` and `exit-requested`.
  - Keys go through `platform.keyToIntent(event.keyCode)`. On both TV builds, arrows are 37–40 and Enter is 13, so synthetic key events work.
- **Tests:**
  - `tools/build/src/bundle.test.ts` builds fixtures (`tools/build/test/fixtures/`). It runs one in a Node `vm` realm with `Object.entries`/`padStart` deleted, which proves the polyfills ship. It also proves a regex lookbehind fails the gate and that `__PLATFORM__` tree-shakes the other platform.
  - `e2e/tv-bundle.spec.ts` boots both built bundles from `file://` in modern Chromium.
- **CI** (`.github/workflows/ci.yml`, `ubuntu-latest`, Node 22): `pnpm install --frozen-lockfile`, `pnpm exec playwright install --with-deps chromium`, then `pnpm verify`. It uploads `dist/` as the `tv-builds` artifact and, on failure, the Playwright report.

## Step 2b: suggested approach
The goal: run the **built** TV bundles in real old engines, because Playwright can't attach to Chromium 53/56 and test TVs are scarce. Target engines: Chromium 53 (webOS 4), 56 (Tizen 4) and 68/69 (2020 sets).
1. **Fetching engines** (`tools/engines/` or `tools/old-engines/`, a new `tools/*` workspace package with a `typecheck` script and tsconfig):
   - Download Linux x64 builds from the `chromium-browser-snapshots` bucket (`https://commondatastorage.googleapis.com/chromium-browser-snapshots/Linux_x64/<position>/chrome-linux.zip`).
   - Pick each version's branch-base position. **Verify these before use:** roughly 403382 for M53, 433059 for M56 and 550428 for M68. Find the nearest position that has a build.
   - Cache the downloads outside git (e.g. `.cache/engines/`, gitignored), and checksum them.
2. **Driver:** use an old-protocol driver.
   - Option A: `chrome-remote-interface` against `--remote-debugging-port`, which speaks raw CDP and works with M53.
   - Option B: a matching old Puppeteer (1.x targets around M66+, so it won't reach M53).
   - Option C: no driver at all. Load the page with `--headless --disable-gpu --dump-dom` / `--repl` plus an injected harness that posts results. Note that headless mode in M53/M56 on Linux exists but is limited.
   - Prefer the simplest thing that can read `data-testid` state and dispatch key events. A small injected script that runs the checks and prints JSON (read through CDP `Runtime.evaluate`) is enough.
3. **Assertions per engine** (from RELAY):
   - The bundle boots with no syntax or runtime errors: `#boot-error` is empty, `data-ready=true`, and no `Runtime.exceptionThrown`.
   - Remote-key navigation: dispatch keydown 38/13 and check `last-intent`.
   - IndexedDB plus Web Worker sanity: `worker-status` starts with `ok`. Add a tiny IDB write/read check, either in the harness page or as a new hello-app check.
4. **Linux libraries:** old Chromium snapshots need old shared libraries (e.g. `libgconf-2-4`, older `libnss3`) that may be missing on Ubuntu 24.04/26. Two options:
   - Run the harness in a **Docker image** (e.g. `debian:buster`/`stretch` from the archive). Docker 29.4.2 is available locally and on GitHub runners. This is likely the most reproducible route on both Windows and CI.
   - Pin the CI job to `ubuntu-24.04`. `ubuntu-latest` has been moving to Ubuntu 26 since 2026-10-19.
5. **Wiring:**
   - Add `pnpm verify:engines` (it needs `pnpm build:tv` first) and a separate CI job, so the main `verify` job stays fast.
   - Decide whether `verify:engines` joins `pnpm verify`, and record that decision in CLAUDE.md.
6. **Done when:**
   - CI fails on a **seeded ES2018 feature** and on a **seeded missing polyfill**, and passes on the hello app in every engine.
   - The syntax gate already catches seeded syntax at build time. To prove the harness catches it on its own, add a test-only escape hatch to `build-tv`, e.g. `--unsafe-skip-gate` and `--unsafe-no-polyfills`, used only by the harness's self-test. Then show that the harness fails on such a bundle (e.g. one using `Object.entries` without core-js on M53).
   - Record the seeded failures in the PR description.
7. **Finish:**
   - Tick 2b in RELAY.md and add a progress-log row.
   - Push, run `gh pr create --base main`, wait for green CI, then `gh pr merge <n> --merge`. **Never squash, never `--delete-branch`.**
   - Omar's standing rule (2026-11-01): *"For this project always merge without review from me."* Merge on green CI without asking. Put the 3 riskiest changes in the handover.
8. If the session is still light, continue to step 3 (`apps/mock-provider`). Otherwise end the leg.

## Gotchas and lessons (legs 1–2)
- **Bash tool cwd** resets to the main checkout after every call. Always `cd "D:/Claude Code PlayGround/IPTV-relay-20261101-214120" && …` or use `git -C`. Write and Edit on worktree paths work directly.
- **Merging:**
  - In leg 2, the auto-mode classifier blocked `gh pr merge` ("Merge Without Review") until Omar confirmed in chat.
  - With his OK, `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` now allows `Bash(gh pr merge:*)`. The file is locally ignored through `.git/info/exclude`.
  - If a merge is still denied, don't work around it. Stop the leg as needs-you.
- **Write tool and invisible characters:** writing `\u2028` in source through Write produced the raw character and broke parsing. Build such characters with `String.fromCharCode(0x2028)` and grep for raw bytes afterwards.
- **`.gitignore` and ESLint `build/`** used to match `tools/build` and silently hid it. Both are now root-only (`/build/`, `'build/**'`). Check `git status -uall` for new folders whose names look like build outputs.
- **pnpm 11 `allowBuilds`:**
  - `pnpm-workspace.yaml` allows `esbuild` and `@webos-tools/cli` (a chmod postinstall).
  - It denies `core-js` (a banner), `ssh2` and `cpu-features` (optional native builds).
  - New deps with build scripts need an entry: edit the existing block, never add a second `allowBuilds:` key.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, boundaries 5, Babel **7.29** (Babel 8 is out, but `@rollup/plugin-babel` 7 needs ^7), Vite **7.3** (Vitest 3.2 accepts ≤ 7), Preact **10** (11 is out; ADR-002 says 10), Playwright 1.64.1. Check peer ranges with `npm view` before adding anything.
- **Babel:** `browserslistConfigFile: false` is a **top-level** Babel option, not a `preset-env` option.
- **The webOS CLI** `@webos-tools/cli` 3.2.6 works on Node 22/24. Run it as `pnpm --filter @zoma/tools-device exec ares-<cmd>`. `ares-package` keeps the hidden `--no-minify` flag.
- **No Tizen CLI or sdb:** no `.wgt` is built. Never install Tizen Studio unattended.
- **Commits** end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <the session URL the harness gives you>
  ```
  Use scoped `git add` and a `git commit -F - <<'EOF'` heredoc.
- **Environment:** Windows 11, Node v24.14.1 (CI uses 22), pnpm 11.1.2, gh 2.92 (`Omarmarei`), Docker 29.4.2, ffmpeg 8.1.1.

## The 3 riskiest changes merged in PR #2
1. **`.gitignore`/ESLint `build/` ignores are now root-only.** `tools/build` is tracked and linted. Any future folder called `build/` below the root is now visible to git.
2. **The app IDs are placeholders and become permanent at the first store publish** (step 45): webOS `com.zoma.iptv`, Tizen package `ZomaIPTV01` and app id `ZomaIPTV01.Zoma`, widget id `https://zoma-iptv.invalid/tv`.
3. **The version tables** (Tizen/webOS version → model year and Chromium) are best-known public values that spike S0 confirms. Unknown versions fall back to a Chromium-based tier, and to `low` when nothing is known.

## Open decisions and gates (none block step 2b)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung testing route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission** (step 45): final app IDs, real icons, and PostCSS (`postcss-preset-env` + `postcss-rtlcss`), which step 11 adds to `build:tv`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- No secrets have been shared, so nothing needs rotating.
