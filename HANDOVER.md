# Zoma IPTV: relay leg 5 opening prompt

You are leg 5 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- Leg 0 planned it.
- Legs 1–3 did steps 1, 2 and 2b: the scaffold, the TV build pipeline and the old-engine harness (PRs #1–#3).
- Leg 4 did **step 3, `apps/mock-provider`**. It was merged as PR #4 (merge commit `ad2ad62`), and CI is green on `main`.

**Your step is step 4: the legal media set and scale fixtures.**

## Start immediately
Omar said on 2026-11-02: *"Don't ask, proceed automatically i allow and authorise you."* Don't end your first turn after reading the files: start the step in the same turn.

`D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` (locally ignored) does two things:
- It adds this worktree to `additionalDirectories`.
- It allows gh, git, pnpm, node, docker, curl, bash and similar.

So use `git -C "<wt>"`, `pnpm --dir "<wt>"`, absolute paths and Read/Edit/Write rather than `cd "<wt>" && …` compounds.

## Read first, in this order
1. `CLAUDE.md`:
   - Commands, now including `pnpm mock`.
   - Package boundaries: `tools/*` may import only `core`, `protocol` and `crypto`, and `apps/mock-provider` imports **nothing internal**.
   - Legal guardrails, Definition of Done, merge policy and commit format.
2. `RELAY.md`: step 4's text and its "Done when":
   > `pnpm mock` serves streams that ffprobe validates in a test, and fixtures generate in under 2 minutes.

   Step 3 is ticked, with a progress-log row.
3. `docs/runbooks/mock-provider.md`: the whole mock, covering endpoints, accounts, catch-up modes, faults, the log collector and **Media**.
4. `docs/architecture.md` §4:
   - "Mock provider → Media": `testsrc2`/`smptehdbars` channels with the name and clock burned in, endless TS from looped pre-encoded segments at real-time speed, sliding-window HLS, multi-audio ara/eng/spa plus 5.1 AC3 and E-AC3, HEVC 4K, MKV with ara/eng SRT, MP4 with mov_text, and the Blender open movies with an attribution page.
   - "Scale fixtures".
5. `apps/mock-provider/src/media.ts`:
   - `MediaSource` is the interface your real media plugs into: `liveTs`, `hlsSegment(channelId, seq)` (where seq × 6 is epoch seconds), `archiveTs` and `file`.
   - Today only `PlaceholderMedia` implements it.
6. `docs/PLAN.md` wins on any conflict.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there; your session folder is the main checkout, which you must leave alone.
- **Branch:** HEAD is the commit that adds this `HANDOVER.md`, on top of:
  - `f5e6a75`, the RELAY tick;
  - `8977442`, the step-3 feature commit.
  The branch is pushed and the worktree is clean.
- **`main`:** `origin/main` = `ad2ad62`, the merge of PR #4 (merge commit; the branch was kept). Both CI jobs, `verify` and `engines`, are green on it.
- **Main checkout:** its local `main` is behind. Leave it alone.
- **Ready to use:**
  - `node_modules` is installed in the worktree, including fastify 5.12.7 and yaml 2.9.1.
  - Playwright `chromium-1248` is installed.
  - `.cache/engines/` holds the snapshots.
  - The Docker image `zoma-old-engines:6c2fb8147c5e` is built.
  - `pnpm verify` is green: 391 tests, both TV builds and 5 Playwright tests.

## What exists after step 3 (`apps/mock-provider`, `@zoma/app-mock-provider`)
- **`pnpm mock [--port 8080] [--host 0.0.0.0] [--scenario <name|path>] [--fixtures <dir>] [--lab-log-dir <dir> | --no-lab-logs] [--quiet]`.** The root script is `tsx apps/mock-provider/src/main.ts`.
- **Endpoints:**
  - `player_api.php`, every action (GET plus form POST);
  - `get.php`, m3u_plus and m3u;
  - `xmltv.php`, plus `/epg/guide.xml(.gz)`;
  - `/live`, the short form `/{u}/{p}/{id}`, `/hls/…/{seq}.ts`, `/movie`, `/series` (Range/HEAD);
  - catch-up: `/timeshift` and `timeshift.php`, `/catchup` (M3U `default`), `?utc=&lutc=` (M3U `append`/`shift`) and `/flussonic/…`, all with `X-Mock-Archive-Channel/Start/Duration` headers;
  - `/images/{kind}-{id}.png`;
  - `/__lab/logs` (the collector, writing to `artifacts/lab-logs/*.ndjson`);
  - `/__mock/health|scenarios|scenario|connections`;
  - `/`.
- **Fixtures:**
  - `apps/mock-provider/fixtures/server.yaml` holds the panel settings and 8 test accounts in every state, including one with special characters.
  - `catalog.yaml` holds 12 channels, 6 movies (4 Blender) and 2 series.
  - `scenarios/` holds 8 fault scenarios.
- **Faults:** 14 types, from YAML rules or `?mock_fault=type:arg:key=value,…`.
- **Tests:** 149, in `apps/mock-provider/test/`.
  - `endpoints.test.ts` fails if a registered route has no probe, so **add a probe for every route you add**.
  - `faults.test.ts` is keyed by `Record<FaultType, …>`.

## Step 4: suggested approach
1. **Check first:**
   - ffmpeg is 8.1.1 locally (`ffmpeg -version`, `ffprobe -version`).
   - Is ffmpeg on CI's `ubuntu-latest`? Don't assume. Either add `sudo apt-get install -y ffmpeg` to the `verify` job, or add a separate CI job.
   - The "ffprobe validates" test must run in CI, while `pnpm verify` should stay reasonable locally.
2. **Media generation scripts** (e.g. `tools/media` or `apps/mock-provider/media/`):
   - ffmpeg command builders produce **short** pre-encoded assets in a gitignored cache (`/.cache/` is already ignored at the root, e.g. `.cache/media/`):
     - TS segments per channel with the name and clock burned in (`drawtext`; check the fonts on Windows and Linux, and prefer an `ffmpeg` built-in or a bundled font);
     - a multi-audio file (ara/eng/spa tones, 5.1 AC3 and E-AC3);
     - HEVC 4K;
     - MKV with ara/eng SRT;
     - MP4 with mov_text.
   - Keep the sizes and encode times tiny: seconds, not minutes.
3. **A file-backed `MediaSource` in the mock:**
   - `liveTs` loops pre-encoded segments at real-time speed;
   - `hlsSegment` maps seq to a looped segment;
   - `file()` serves the generated files with ranges.
   - Fall back to `PlaceholderMedia` when the cache is missing, and add a flag such as `--media <dir>`.
   - The catalog lists ids 201–206 and 3001–3022 for VOD and episodes.
4. **Blender open movies:**
   - Write an opt-in fetch script with pinned URLs and SHA-256, for download.blender.org mirrors of Big Buck Bunny, Sintel, Tears of Steel and Elephants Dream. Use small renditions, and never run it in CI.
   - Add an **attribution page** (CC BY), e.g. `GET /attribution`, plus its endpoint probe.
5. **`tools/fixtures`** (deterministic, seeded PRNG, streamed writes, output in `.cache/fixtures/`):
   - A 200k catalog: 20k live, 120k VOD and 60k episodes, as M3U and as Xtream JSON. Names in ar/en/fr/es, with duplicates and malformed lines.
   - XMLTV at 50, 150 and 300 MB, each with a `.gz` (5k channels × 14 days).
   - All of it must generate in **under 2 minutes**. Time it.
   - Boundary: `tools/*` can't import `apps/*`, so the mock must read the fixture **files**. That means new mock flags, e.g. `--catalog <file.json>` and `--xmltv <file>`.
   - The current loader parses YAML, which is too slow for 200k, so add a JSON fast path.
6. **Node benchmark harness:** throughput and memory around a pluggable function, ready for the step-5 parsers. Add a **Dockerfile** for the mock, needed for the public test server later.
7. **Tests:**
   - ffprobe validates the live TS, the HLS segments and every VOD file served by the mock (codec, stream count and languages).
   - The fixture generator is deterministic: same seed, same hash.
   - The 200k counts are right.
   - A timing assertion, or a logged measurement, against the 2-minute limit.
8. **Finish:**
   - Tick step 4 in RELAY.md and add a progress-log row. Also update the runbook's Media section and CLAUDE.md's Commands.
   - Push, run `gh pr create --base main`, wait for **both** CI jobs, then `gh pr merge <n> --merge`. **Never squash, never `--delete-branch`.**
   - Merge on green without asking (standing rule), and list the 3 riskiest changes in the handover.
   - If the step is big, end the leg after it rather than starting step 5.

## Gotchas and lessons (legs 1–4)
- **Bash cwd** resets to the main checkout after every call, and after any `cd` outside the worktree. Use absolute paths, `git -C` and `pnpm --dir`.
- **Mock bodies depend on the Host header**, because absolute URLs come from it. Compare real-socket bodies with bodies fetched over the same socket (leg 4 lost a test run to this).
  - `?mock_fault=` uses `:` and `,` as separators, so `host:port` can't go in a query flag; use a scenario.
  - Tests build the mock in-process: `buildServer({ now, labLogDir: null, media: new PlaceholderMedia({ liveLimitBytes, liveIntervalMs }) })`. Endless live never resolves under `inject()`.
  - Stalls, resets and slow headers need `app.listen({ port: 0 })`. See the `rawGet` helper in `apps/mock-provider/test/helpers.ts`.
- **YAML:** ` #` starts a comment, so quote such values in fixtures.
- **Docker Desktop** is often not running. Start it with `start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"` (about 20 s). Only `pnpm verify:engines` needs it: run it after changes to `tools/build`, polyfills, workers or `apps/tv` boot code. Step 4 likely touches none of them.
- **Old engines:** Chromium 53/56 need Debian 9. Chromium 53 reports errors only via `Console.messageAdded`. The S1 finding (Blob-worker IndexedDB on `file://`) stands; see `docs/runbooks/old-engines.md`.
- **tsx:**
  - Use extensionless relative imports (`./time`, not `./time.ts`).
  - An ESM import of an absolute `D:/…` path fails, so put probe scripts in the gitignored `artifacts/` and use relative imports.
- **Merging:** `Bash(gh pr merge:*)` is allowed. If a merge is still denied, end the leg as needs-you; don't work around it.
- **Write tool:** `\u2028` becomes a raw character. Build such characters with `String.fromCharCode` and grep for raw bytes.
- **Ignores:** `.gitignore` covers `artifacts/` everywhere, plus root-only `/.cache/` and `/build/`. Check `git status -uall` for new folders.
- **pnpm 11 `allowBuilds`:**
  - Allowed: `esbuild` and `@webos-tools/cli`.
  - Denied: `core-js`, `ssh2` and `cpu-features`.
  - Edit the existing block; never add a second `allowBuilds:` key.
- **Version pins:**
  - TS 5.9, ESLint 9, Vitest 3.2, boundaries 5, Babel 7.29, Vite 7.3, Preact 10, Playwright 1.64.1, fake-indexeddb 6.2, Fastify 5.12, yaml 2.9.
  - Check peer ranges with `npm view`, and use versions published at least 2 weeks ago.
- **Devices:**
  - webOS CLI: `pnpm --filter @zoma/tools-device exec ares-<cmd>`.
  - There is no Tizen CLI. Never install Tizen Studio unattended.
- **Commits:** use scoped `git add` and a `git commit -F - <<'EOF'` heredoc, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` plus any session line the harness asks for.
- **Environment:** Windows 11, Node v24.14.1 (CI uses 22), pnpm 11.1.2, gh 2.92 (`Omarmarei`), Docker 29.4.2, ffmpeg 8.1.1.

## The 3 riskiest changes merged in PR #4
1. **`pnpm mock` binds to 0.0.0.0 by default with unauthenticated endpoints.**
   - `POST /__lab/logs` writes to disk (session names are sanitised, 8 MiB per request, no total cap).
   - `PUT /__mock/scenario` switches faults.
   - That's fine on a home LAN. On the public test server (step 44), run with `--no-lab-logs` and consider locking `/__mock`.
2. **The mock encodes our reading of panel behaviour:**
   - Expired, Banned and Disabled accounts get `auth: 1` plus `[]` for every action.
   - Unknown ids return `[]`.
   - Streams answer 401 for bad credentials and 403 for inactive accounts.
   - The type mix of strings and numbers is ours.

   Parsers tested only against the mock could overfit. Keep them tolerant (the `json-quirks` fault helps), and compare with real panel captures if Omar ever provides them. Never commit real provider data.
3. **A new dependency tree:**
   - fastify 5.12.7 with about 45 transitive packages (pino 10, ajv 8, …) and yaml 2.9.1;
   - yaml also became the resolved optional peer of vite, so the lockfile keys for vite and vitest changed.

   The TV bundles are unaffected: `verify` and `engines` are green.

## Verified vs not
- **Verified:**
  - `pnpm verify` is green locally.
  - CI `verify` and `engines` are green on PR #4 and on `main` `ad2ad62`.
  - The CLI was smoke-run (`pnpm mock --host 127.0.0.1 --port 18080 --scenario flaky-live` gave 509, 509, then 200 paced at about 1 Mbit/s).
  - Three deliberate bugs were all caught by the tests.
- **Not done:**
  - The mock hasn't been run on `0.0.0.0`: Windows Firewall will prompt Omar on the first LAN run, and he should allow private networks.
  - It hasn't been reached from a TV. No lab build exists until step 15.
  - `pnpm verify:engines` wasn't run locally (no change to the build); CI `engines` is green.
- **Migrations and deploys:** N/A for this step.

## Open decisions and gates (none block step 4)
- **CI ffmpeg approach:** your call, recorded in the handover.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route (from step 15) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** final app IDs, real icons, and PostCSS in `build:tv` (step 11).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. This also decides the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02 (allow rules plus the worktree directory). Prune it when the relay run ends if he wants it tighter.
- No secrets have been shared, so nothing needs rotating.
