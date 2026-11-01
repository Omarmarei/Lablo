# Zoma IPTV: relay leg 4 opening prompt

You are leg 4 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Leg 1 did step 1, the workspace scaffold (PR #1).
- Leg 2 did step 2, the TV build pipeline and hello app (PR #2).
- Leg 3 did step 2b, the old-engine harness (PR #3). It merged to `main` with green CI.

**Your step is step 3: `apps/mock-provider`** (a Fastify Xtream/M3U/XMLTV mock with fault injection and a LAN log collector).

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Don't end your first turn after reading the files: start the step in the same turn.

`D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) now does two things:
- It adds this worktree to `additionalDirectories`.
- It allows `gh`, `git`, `pnpm`, `node`, `docker`, `curl`, `bash` and similar.

So use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths and Read/Edit/Write rather than `cd "<wt>" && …` compounds, which still trigger prompts.

## Read first, in this order
1. `CLAUDE.md`:
   - Commands, now including `pnpm verify:engines`.
   - Conventions and package boundaries: `apps/mock-provider` imports **nothing internal**, because it is an independent oracle for the parsers.
   - **Legal guardrails:** test credentials live only in the mock provider's fixtures, and only our own legal demo content is used.
   - Definition of Done, merge policy and commit format.
2. `RELAY.md`: step 3's text and its "Done when". Steps 1, 2 and 2b are ticked, with progress-log rows.
3. `docs/architecture.md` §4, "Mock provider": the endpoints, the `user_info` states, the fault list, the LAN log collector and the public test-server notes. `docs/PLAN.md` has 4 mock-provider mentions, and `docs/research/03-platform-build-launch.md` has 1.
4. `docs/runbooks/old-engines.md` and `docs/runbooks/tv-build.md`, for context on what CI runs.
5. `docs/PLAN.md` wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: never edit it, commit in it or switch its branch.
- **Branch:** HEAD is the commit that adds this `HANDOVER.md`, on top of:
  - `0a5ca06`, the RELAY tick;
  - `e632376`, the step-2b feature commit.
  The branch is pushed and the worktree is clean.
- **`main`:** `origin/main` = `27fa243`, the merge of PR #3 (merge commit; the branch was kept). CI on `main` is green for both jobs, `verify` and `engines`.
- The main checkout's local `main` has not been pulled. Leave it alone.
- **Ready to use:**
  - `node_modules` is installed in the worktree.
  - Playwright `chromium-1248` is installed.
  - `.cache/engines/` holds the three pinned snapshots (gitignored).
  - The Docker image `zoma-old-engines:6c2fb8147c5e` is built locally.
  - `pnpm verify` is green: lint, typecheck, 242 unit tests, both TV builds and 5 Playwright tests.
  - `pnpm verify:engines --self-test` is green: 24 of 24 runs as expected.

## What exists after step 2b
- **`pnpm verify:engines [--self-test] [--engine chrome53] [--keep]`** (`tools/engines`, runbook `docs/runbooks/old-engines.md`):
  - Runs `dist/tv/{tizen,webos}` in Chromium **53.0.2785** (snapshot 403380), **56.0.2924** (433042) and **68.0.3440** (561732), each pinned by SHA-256.
  - The engines run headed under Xvfb in a Debian 9 "stretch" container (archive.debian.org) and are driven over raw CDP (`src/cdp.ts`, Node's built-in WebSocket).
  - Checks per app:
    - boot with no error (`#boot-error`, `Runtime.exceptionThrown`, or `Console.messageAdded` on 53);
    - the engine's major version, from the user agent;
    - `worker-status` is `ok…`, and `idb-status` is `ok` (IndexedDB write/read inside the Blob worker);
    - CDP keys 38/13 arrive as the UP/OK intents.
  - `--self-test` adds three variants that must fail:
    - `seed-es2018-object-spread`: fails on 53/56, passes on 68;
    - `seed-es2020-optional-chaining`: fails on all three;
    - `no-polyfills` (`build-tv --unsafe-no-polyfills --out <dir>`, test only): fails on all three.
- **CI** (`.github/workflows/ci.yml`) has two jobs, and both must be green:
  - `verify` (`ubuntu-latest`, `pnpm verify`);
  - `engines` (`ubuntu-24.04`): it builds the image, uses the snapshot cache (`actions/cache@v6`, keyed on `tools/engines/src/engines.ts`), then runs `pnpm build:tv --skip-package` and `pnpm verify:engines --self-test`. It takes about 1.5 min.
  - `verify:engines` is deliberately **not** part of `pnpm verify` (it needs Docker plus about 280 MB of downloads).
- **Hello app:**
  - The worker does an IndexedDB round trip (`apps/tv/src/workers/idb-check.ts`, tested with `fake-indexeddb` 6.2.7, a devDependency of `apps/tv`).
  - The screen shows `data-testid=idb-status`.
- **build-tv** also takes `--out <dir>`, and `bundleIife({ polyfills })` exists.

## Step 3: suggested approach
1. **Package:** `apps/mock-provider`, named `@zoma/app-mock-provider`.
   - It needs a `typecheck` script and a tsconfig extending `tsconfig.base.json`, with Node types and `lib` ES2023.
   - ESLint already treats `apps/mock-provider/**` as Node code. The boundary element `app-mock-provider` allows no internal imports.
   - Fastify: check the current major's Node 22 support and peer ranges with `npm view fastify version engines` before adding it. Use a YAML parser for the fault scenarios (`yaml`).
   - Any dependency with build scripts needs an entry in `pnpm-workspace.yaml` `allowBuilds`.
2. **Xtream API** (`/player_api.php?username=&password=&action=`):
   - No action: `user_info` + `server_info`, with `auth: 0` for bad credentials.
   - Categories and streams: `get_live_categories`, `get_live_streams` (with `category_id`), `get_vod_categories`, `get_vod_streams`, `get_vod_info&vod_id=`, `get_series_categories`, `get_series`, `get_series_info&series_id=`.
   - EPG: `get_short_epg&stream_id=&limit=` (base64 title and description) and `get_simple_data_table&stream_id=`.
   - `user_info` states: Active, Expired, Banned and Disabled, plus `max_connections` / `active_cons`, chosen by credentials in the fixtures.
3. **Other endpoints:**
   - `get.php?username=&password=&type=m3u_plus&output=ts|m3u8` (with `tvg-id`, `tvg-logo`, `group-title`, `catchup` attributes).
   - `xmltv.php`.
   - Streams: `/live/{u}/{p}/{id}.{ts,m3u8}`, `/movie/{u}/{p}/{id}.{ext}`, `/series/{u}/{p}/{id}.{ext}`, `/timeshift/{u}/{p}/{duration}/{start}/{id}.ts` and `streaming/timeshift.php`.
   - Real media arrives in step 4 (ffmpeg). For now, put the stream endpoints behind a pluggable media source: placeholder bytes or a small generated payload, with the right content types, redirects and range support where cheap.
4. **Faults** (YAML scenarios plus a query-flag override):
   - 302 chains;
   - a stall after N bytes with the socket held open;
   - 401/403/404/509;
   - slow headers;
   - malformed M3U, BOM/CRLF and invalid UTF-8;
   - gzip XMLTV;
   - odd timezones.
5. **LAN log collector:** `POST` JSON lines from TVs (lab and self-test results) into a gitignored folder (e.g. `artifacts/lab-logs/`), plus a `GET` to read them back, so Claude can read TV results.
6. **Scripts:** `pnpm mock` at the root (step 4's "Done when" uses it). Bind to `0.0.0.0` with a configurable port, so TVs on the LAN can reach it.
7. **Tests:** Vitest integration tests that cover **every endpoint and every fault**.
   - Use `app.inject()` for most of them.
   - Use a real listening server on port 0 for the stall and slow-header faults.
   - Keep test timeouts tight.
8. **Finish:**
   - Tick step 3 in RELAY.md and add a progress-log row.
   - Push, run `gh pr create --base main`, wait for **both** CI jobs, then `gh pr merge <n> --merge`. **Never squash, never `--delete-branch`.**
   - Merge on green without asking (Omar's standing rule). Put the 3 riskiest changes in the handover.
9. If the session is still light, continue to step 4 (the legal media set and scale fixtures; ffmpeg 8.1.1 is installed). Otherwise end the leg.

## Gotchas and lessons (legs 1–3)
- **Bash tool cwd** resets to the main checkout after every call. Don't `cd` into the worktree in compound commands; use `git -C`, `pnpm --dir` and absolute paths.
- **Docker Desktop** is often not running: `docker version` then fails with "dockerDesktopLinuxEngine". Start it with `start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"`, and it is ready in about 20 s. Only `pnpm verify:engines` needs it. Run that after any change to `tools/build`, polyfills, workers or `apps/tv` boot code; step 3 likely touches none of them.
- **Old engines** (all recorded in the runbook):
  - Chromium 53/56 segfault on Debian 12, because their bundled HarfBuzz clashes with the system Pango. Hence Debian 9.
  - The handover's suggested M68 position, 550428, is really M67. Positions just below the branch point keep the major.
  - Chromium 53 reports uncaught errors only through `Console.messageAdded`.
- **S1 finding:** desktop Chromium 53–68 deny IndexedDB inside a Blob worker on `file://` without `--allow-file-access-from-files`, while main-thread IndexedDB works. The harness models the TV runtime with that switch. Spike S1 must confirm this on real TVs (architecture.md §5 lists the fallbacks).
- **tsx and Windows paths:** an ESM import of an absolute `D:/…` path fails (ERR_UNSUPPORTED_ESM_URL_SCHEME). Put throwaway probe scripts in the gitignored `artifacts/` and use relative imports.
- **Merging:** `Bash(gh pr merge:*)` is allowed in the main checkout's `.claude/settings.local.json`. If a merge is still denied, don't work around it. End the leg as needs-you.
- **Write tool and invisible characters:** writing `\u2028` through Write produced the raw character. Build such characters with `String.fromCharCode(0x2028)` and grep for raw bytes afterwards.
- **`.gitignore` and ESLint ignores** are root-only for `build/` and `.cache/`. Check `git status -uall` for new folders.
- **pnpm 11 `allowBuilds`:**
  - Allowed: `esbuild` and `@webos-tools/cli`.
  - Denied: `core-js`, `ssh2` and `cpu-features`.
  - Edit the existing block; never add a second `allowBuilds:` key.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, boundaries 5, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fake-indexeddb 6.2. Check peer ranges with `npm view` before adding anything.
- **The webOS CLI:** `pnpm --filter @zoma/tools-device exec ares-<cmd>`. There is no Tizen CLI or sdb, and Tizen Studio must never be installed unattended.
- **Commits:** use scoped `git add` and a `git commit -F - <<'EOF'` heredoc. End the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, plus any session line the harness asks for.
- **Environment:** Windows 11, Node v24.14.1 (CI uses 22), pnpm 11.1.2, gh 2.92 (`Omarmarei`), Docker 29.4.2, ffmpeg 8.1.1.

## The 3 riskiest changes merged in PR #3
1. **The harness assumes the TV runtime grants file access** (`--allow-file-access-from-files`). If a real TV denies IndexedDB in Blob workers, the harness won't catch it. Spike S1 is the check, and the data engine (steps 7–8) depends on the answer.
2. **CI now depends on two external archives:** Google's `chromium-browser-snapshots` bucket (the zips are cached by `actions/cache`) and archive.debian.org (Debian 9 apt, fetched on every image build). If either goes away, the `engines` job fails. Mitigation if that happens: publish the image to GHCR.
3. **The hello worker now writes to IndexedDB** (a `zoma-hello` database, one record) on every start, including on TVs. It's tiny and harmless, but it is real storage. Separately, `build-tv` gained `--out` and the guarded `--unsafe-no-polyfills`.

## Open decisions and gates (none block step 3)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung testing route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission** (step 45): final app IDs, real icons, and PostCSS (`postcss-preset-env` + `postcss-rtlcss`), which step 11 adds to `build:tv`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- With his authorisation (2026-11-02), leg 3 widened `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json`: allow rules for gh/git/pnpm/node/docker/curl/bash, plus the worktree as an additional directory. Prune it when the relay run ends if he wants it tighter.
- No secrets have been shared, so nothing needs rotating.
