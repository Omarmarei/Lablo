# Zoma IPTV: relay leg 6 opening prompt

You are leg 6 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Legs 1–4 did steps 1, 2, 2b and 3: the scaffold, the TV build pipeline, the old-engine harness and `apps/mock-provider` (PRs #1–#4).
- Leg 5 did **step 4, the legal media set and scale fixtures**. It was merged as PR #5 (merge commit `ee34f71`), and CI is green on `main` in all three jobs: `verify`, `engines` and `media`.

**Your step is step 5: `core`, part 1** (architecture.md 3.1): domain types, ContentKey, Arabic/Latin normalization and the streaming M3U parser.

**Done when:** golden and fast-check fuzz tests pass.

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Don't end your first turn after reading the files: start the step in the same turn.

`D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) adds this worktree to `additionalDirectories` and allows gh, git, pnpm, node, docker, curl, bash and similar. Use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths and Read/Edit/Write. Avoid `cd "<wt>" && …` compounds.

## Read first, in this order
1. **`CLAUDE.md`:**
   - Commands, which now include `mock:media`, `mock:open-movies`, `fixtures`, `bench`, `test:media` and `verify:media`.
   - Conventions.
   - The Chromium 53 cheat sheet. `core` is pure: `lib: ["ES2017"]`, no DOM, no `fetch`.
   - Package boundaries, legal guardrails, Definition of Done (now including `verify:media`), merge policy and commit format.
2. **`RELAY.md`:** step 5. Step 4 is ticked, with a progress-log row.
3. **`docs/architecture.md`:**
   - §1.4 "Catalog pipeline": ContentKey formats, normalization rules, `matchName`, and the M3U attributes and classification;
   - §4, the test layers;
   - §6, 3.1.
4. **`docs/runbooks/mock-provider.md`:** the "Scale fixtures" and "Benchmarks" sections (your parser's inputs and harness).
5. **`docs/PLAN.md`** wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, on branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout: leave it alone. Its local `main` is behind.
- **Branch:** HEAD is the commit that adds this `HANDOVER.md`, on top of:
  - `2bdae35`, the RELAY tick;
  - `6a2b9f9`, the step-4 feature commit.

  The branch is pushed and the worktree is clean.
- **`origin/main`:** `ee34f71`, the merge of PR #5 (a merge commit; the branch was kept).
- **Ready in the worktree** (`.cache/` is gitignored):
  - `node_modules`.
  - `.cache/media`: generated media plus the **four real Blender films** in `open-movies/` (1.2 GB, fetched this leg).
  - `.cache/fixtures`: the 200k catalog and 50/150/300 MB XMLTV (630 MB).
  - `.cache/engines`.
  - Playwright `chromium-1248`.
- **`pnpm verify` is green:** 436 tests, both TV builds, 5 Playwright tests. `pnpm test:media` gives 34 tests.

## What step 4 added (so you can use it)
- **Fixtures** (`pnpm fixtures`, deterministic, about 20 s), in `.cache/fixtures/`:
  - `playlist.m3u`: 200,000 entries plus 400 malformed lines. Names in ar/en/fr/es with Arabic-Indic digits, alef/taa-marbuta/alef-maqsura variants, diacritics, tatweel, quality and country tags, duplicates, catch-up attributes, `url-tvg`, and a 4,000-character name.
  - `xtream/*.json`.
  - `catalog.json`.
  - `xmltv-{50,150,300}mb.xml[.gz]`.
  - `manifest.json`, holding the SHA-256 of each file.

  The generator is `tools/fixtures/src/catalog.ts`; `MALFORMED` lists the broken lines your parser must survive.
- **Bench** (`pnpm bench`, `tools/bench`): add your M3U parser as a case in `tools/bench/src/suites.ts`.
  - `tools/bench` may import `@zoma/core`; declare it as a `workspace:*` dependency.
  - The baseline `m3u-extinf-scan` runs at about 840 MB/s locally (430 on CI).
- **Mock:** `buildServer({ catalog })`, plus `--catalog .cache/fixtures/catalog.json`. The mock imports nothing internal and stays an independent oracle.
  - Step 6's "tests against the mock" will need the mock to run as a process, or tests in the root `test/` folder (which belongs to no boundary element). Check the boundary lint before you pick.

## Step 5: suggested approach
1. **Check first:** `git log`, and grep `packages/core/src`. Today it holds only `device.ts` and `index.ts`.
2. **fast-check is not installed.** Add it as a devDependency of `packages/core`. Pick a version published at least 2 weeks ago, and check its peer ranges with `npm view`.
3. **`core` must stay ES2017 and pure:**
   - `TextDecoder` is fine at the callers.
   - A streaming parser takes string chunks: feed it chunks and it emits items.
   - Classify each item as live, movie or series from `/movie/`, `/series/` or the extension; when unclear, it is live.
   - Also read `#EXTGRP` and `#EXTVLCOPT` (record UA hints) and `url-tvg`/`x-tvg-url`.
4. **ContentKey:** `x:<src>:<kind>:<id>`, or `m:<src>:<hash(tvg-id || normName+group)>:<dup#>`. Never derive it from the URL.
5. **Normalization:**
   - diacritics and tatweel removed;
   - أإآ→ا, ة→ه, ى→ي;
   - Arabic-Indic digits → ASCII;
   - Latin accents removed;
   - `matchName` strips quality and country tags.
6. **Tests:** golden tests, plus fast-check fuzzing (random chunk splits must give the same items; arbitrary junk must never throw). Run the parser over the 200k fixture as a test or a bench case, and expect exactly 200,000 well-formed entries plus the tolerated malformed ones.
7. **Finish:**
   - Tick step 5 in RELAY.md with a progress-log row, and update CLAUDE.md if commands change.
   - Push, run `gh pr create --base main`, and wait for **all three** CI jobs.
   - Run `gh pr merge <n> --merge`. **Never squash, never `--delete-branch`.** Merging on green is the standing rule: no need to ask. List the 3 riskiest changes in the handover.

## Gotchas and lessons (legs 1–5)
**Shell and tools**
- The Bash cwd resets to the main checkout after any `cd`. Use absolute paths.
- **Long or multi-heredoc Bash commands with backticks or quotes fail to parse** ("unexpected EOF"), and that includes a Python heredoc patch. Write the script or file with the Write tool, then run it.
- **`gh pr checks <n> --watch` right after `gh pr create`** exits at once with "no checks reported". Wait about 20 s, or re-run it.
- **tsx:** use extensionless relative imports. ESM imports of absolute `D:/…` paths fail, so put probe scripts in the gitignored `artifacts/`.
- **Write tool:** `\u2028` becomes a raw character. Build such characters with `String.fromCharCode`.

**Mock and media**
- **Mock tests:** `buildServer({ now, labLogDir: null, media: new PlaceholderMedia({...}) })`.
  - Bodies depend on the Host header.
  - Every new route needs a probe in `endpoints.test.ts`.
  - `*.media.test.ts` files are excluded from `pnpm test` and run with `pnpm test:media`.
- **`.cache/` holds MPEG-TS `.ts` files.** ESLint now ignores `.cache/**`. Keep it that way, and keep other TS-aware tools away from it.
- **ffmpeg facts** (also in code comments):
  - The default drawtext font segfaults on Windows, so pass an explicit `fontfile`.
  - MP4 track titles trigger "UDTA parsing failed" on ffmpeg 8, so we write language tags only.
  - Audio-only HLS cuts drift with AAC, so the radio channel uses MP3.
  - Looped AAC must stop 100 ms short of the lap.
  - CI uses Ubuntu's ffmpeg 6.1; the Docker image uses Debian's 5.1.

**CI**
- The `media` job takes about 11 min on a cold cache: media generation takes 265 s on 4 vCPUs, and the Docker build regenerates the media (another 260 s).
- The `.cache/media` cache is keyed on `media-plan.ts`, `media-gen.ts` and `catalog.yaml`. Caches saved on a PR ref aren't visible to `main`, so the first run on `main` is cold too.
- If CI time matters, consider building the Docker image only when `apps/mock-provider/**` changes.

**Docker and devices**
- Docker Desktop is often not running. Start it with `start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"`. It's needed only for `verify:engines` and Docker builds.
- **Old engines:** Chromium 53/56 need Debian 9. See `docs/runbooks/old-engines.md`.
- **Devices:**
  - webOS CLI: `pnpm --filter @zoma/tools-device exec ares-<cmd>`.
  - There is no Tizen CLI. Never install Tizen Studio unattended.

**pnpm, versions and commits**
- **pnpm 11 `allowBuilds`:** `esbuild` and `@webos-tools/cli` are allowed; `core-js`, `ssh2` and `cpu-features` are denied. Edit the existing block; never add a second key.
- **Version pins:** TS 5.9, ESLint 9, Vitest 3.2, boundaries 5, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, Fastify 5.12, yaml 2.9, tsx 4.23 (now also a dependency of the mock).
- **Commits:** scoped `git add`, and a `git commit -F - <<'EOF'` heredoc ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` plus any session line the harness asks for.
- **Environment:** Windows 11, Node 24.14.1 (CI uses 22), pnpm 11.1.2, gh (`Omarmarei`), Docker 29.4.2, ffmpeg 8.1.1.

## The 3 riskiest changes merged in PR #5
1. **The TS rewriter defines the live timeline.**
   - What it does: `apps/mock-provider/src/ts-rewrite.ts` rewrites PTS, DTS, PCR and continuity counters so that 60 s loops play as endless, epoch-aligned live.
   - How it's tested: ffmpeg decodes across lap boundaries with zero warnings, and mutation tests showed broken counters and offsets are caught.
   - Remaining risk: real TV demuxers (AVPlay, webOS) can be stricter than ffmpeg, for example about the 100 ms audio gap once a minute or PCR/PTS spacing. If step 16/21 shows glitches at minute boundaries, look here first.
2. **CI got heavier.** The new `media` job (about 11 min cold) installs ffmpeg from apt and builds a 1.6 GB Docker image every run. A change to Ubuntu's ffmpeg package could break the ffprobe tests: they require zero decode warnings.
3. **The mock's media behaviour changed.**
   - `pnpm mock` now serves generated files when `.cache/media/manifest.json` exists.
   - VOD requests with an extension other than the catalog's now answer **404**; they used to get placeholder bytes.
   - `catalog.yaml` gained `media:` profiles, and Elephants Dream's duration changed from 654 to 658 s, its real length.
   - The open-movie fetch downloads about 1.2 GB from download.blender.org (opt-in only).

## Verified vs not
- **Verified:**
  - `pnpm verify` (local) and `pnpm test:media` (local, with the real films).
  - CI `verify`, `engines` and `media` on PR #5 and on `main` `ee34f71`.
  - On CI, the fixtures took 20.7 s, under the 2-minute limit.
  - The Docker image was built and probed both locally and in CI.
  - `pnpm mock:open-movies` ran end to end: the SHA-256 checks passed, the zips were extracted and the `.mov` files remuxed.
- **Not done:**
  - No TV has played the media yet (no lab build until step 15).
  - The mock hasn't been run on `0.0.0.0`: Windows Firewall will prompt Omar on the first LAN run.
  - `pnpm verify:engines` wasn't run locally because the build didn't change; CI `engines` is green.
- **Migrations and deploys:** N/A for this step.

## Open decisions and gates (none block step 5)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02 (allow rules plus the worktree directory). Prune it when the relay run ends if he wants it tighter.
- No secrets have been shared, so nothing needs rotating.
