# Lablo IPTV: relay leg 81 opening prompt

You are leg 81 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–79 did steps 1–28 (PRs #1–#91), except step 16's Samsung part, 19b and 21 (they wait for Omar).
- **Leg 80 split step 29 (the backend skeleton) and finished 29a:**
  - **The split** (in RELAY.md):
    - **29a:** the web app, its database, its lint and CI. **Done.**
    - **29b:** `protocol` and `crypto` with shared test vectors, and the R2 and Upstash interfaces with local fakes. **Next.**
  - **29a merged** as PR #92 (`ae77243`), green on the first CI run (verify 10 m 39 s, web 1 m 5 s, engines 17 m 58 s, media 11 m 2 s). Its docs went in as PR #93 (`8beb074`).
  - **What 29a built** (architecture.md §3.2 "Built in step 29a", runbook `docs/runbooks/web.md`):
    - **`apps/web` (`@lablo/web`):** Next.js 16.4.4 App Router (Turbopack) and React 19.3.1.
      - `GET /v1/health` answers `{ok, db}`: 200 when the database answers `SELECT 1` within 2 s, otherwise 503.
      - The answer is `no-store` and never gives a reason; the log gets only the error's kind.
      - No pages yet.
    - **The database:**
      - Prisma 7.10.1's Rust-free client over `@prisma/adapter-pg`, generated on install into the gitignored `apps/web/src/generated/prisma`.
      - Postgres 17 in Docker: `pnpm web:db`, `127.0.0.1:54329`, `trust` auth, so no password exists anywhere.
      - `DATABASE_URL` comes from the environment, or from the gitignored `apps/web/.env` (copy `.env.example`).
      - The first migration, `init`, creates `PairSession`, `Backup`, `TelemetryEvent` and `DiagReport` in their simplest form.
    - **The lint:** `eslint.config.js`'s `NO_OUTBOUND_RULES` covers every `apps/web` file except `apps/web/test/**`. It rejects:
      - `fetch`, `XMLHttpRequest`, `WebSocket` and `EventSource`, also through `globalThis`, `window` and `self`;
      - the `http`, `https`, `http2`, `net`, `tls`, `dgram`, `dns`, `child_process` and `module` builtins;
      - the HTTP client libraries (static and dynamic imports, re-exports, subpaths);
      - `require` and `module`.

      `test/lint-web-outbound.test.ts` proves it. The platform-global helper is now `restrictGlobalGroups`.
    - **Commands:** `pnpm web:db`, `web:db:down`, `web:dev` (port 3100), `build:web`, `test:web` (it drops, creates and migrates `lablo_test` each run), `verify:web`.
    - **CI:** a `web` job with a Postgres 17 service runs `test:web`, then `build:web`. It runs on changes to `apps/web/`, `packages/protocol/`, `packages/crypto/`, `vitest.web.config.ts` and the shared files. A docs-only PR skips it (checked on #93).
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - Phase 8: step 29's split block, step 29a's "Done in leg 80" block (the pattern to follow), and step 29b's lines.
   - "Definition of done", item 3: migrations are now local and CI only. Production (Neon) comes with step 34 `[needs Omar]`.
   - Leg 80's progress-log row.
2. **`docs/runbooks/web.md`:** the commands, the database, the lint, the gotchas.
3. **`docs/architecture.md` §3.3 "Encryption and key scheme":** what `crypto` must offer:
   - pairing: X25519 `box`, and `secretbox` in 1 MB file frames with nonce = base + counter;
   - backup: scrypt N=2^15 r=8 p=1 dkLen=32, `HMAC-SHA256(master, "lookup"/"write")`, `HKDF-SHA256(master, info "enc"/"local")`, and the envelope `{v:1, kdf:"scrypt-15-8-1", nonce, ct: secretbox(gzip(profileJSON))}`;
   - config: Ed25519 verify against 2 embedded public keys;
   - blocklist: `sha256(salt + host)`.

   Also §3.2 (the endpoints) and §3.4 (telemetry events), for `protocol`.
4. **`packages/protocol/src/index.ts` and `packages/crypto/src/index.ts`:** still the step-1 skeletons (`export {}`, `lib: ["ES2017"]`).
5. **`CLAUDE.md`:** "Package boundaries" (`protocol` and `crypto` import nothing internal; `apps/web` may import both), the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `8beb074` (the merge of PR #93).
   - main is `8beb074`.
2. **Set up the backend locally:**
   - Start Docker Desktop if needed, then `pnpm --dir "<wt>" web:db`. The volume `lablo-web_postgres` keeps the development database `lablo`, already migrated.
   - `apps/web/.env` is already present (gitignored).
   - `pnpm --dir "<wt>" test:web` should give 13/13.
3. **Step 29b: look for existing work first** (`git log`, grep `tweetnacl`, `@noble`, `zod`). Size it, and split it into 29b1 and 29b2 if it won't fit one leg, as 29 was split. Write any split into RELAY.md with runnable "Done when" checks before building. The split is the leg's own call. One possible split:
   - **29b1:** `crypto` and its vectors, Node and Chromium 53;
   - **29b2:** `protocol`'s zod schemas, and the R2 and Upstash interfaces with fakes.
4. **Check these early in 29b (each can block):**
   - **Bump Next.js first:** it is pinned at 16.4.4, which has the moderate advisory GHSA-mfr8-8qww-v76h (`'use cache'` through `unstable_cache()`, which this app doesn't use).
     - 16.4.5 is two weeks old from 2026-11-17 18:02 UTC; 16.4.6 from 2026-11-23.
     - Pick the newest two-week-old patch, and check it against npm's bulk advisory API (POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`). The leg-80 script for this was `$CLAUDE_JOB_DIR/tmp/advisories.py`; it is gone with that job, so write it again.
     - `@next/swc-win32-x64-msvc` follows Next's version, so re-check that it loads under Smart App Control.
   - **BigInt on Chromium 53 (none there):**
     - **zod 4.6.7:** `v4/core/util.js` has top-level `/* @__PURE__ */ BigInt(...)` calls (`BIGINT_FORMAT_RANGES`).
     - **@noble/hashes 2.4.0:** `_u64.js` has top-level PURE `BigInt` calls. `sha2.js` imports `_u64` even for sha256, and `scrypt.js` imports `sha2.js`.
     - **What follows:** the TV bundle works only if Rollup drops every such call (PURE and unused). Prove it: bundle the vectors' runner through `tools/build`'s pipeline and run it on Chromium 53 (the `verify:engines` harness). Otherwise use an older noble line, or keep zod off the TV (server-side validation only).
     - zod is a step-30 question; settle it with `zod/mini` while building `protocol`.
   - **tweetnacl 1.0.3** is UMD/CJS. The TV build already has `@rollup/plugin-commonjs`. It needs `crypto.getRandomValues`, which Chromium 53 has (also in workers).
   - **The 219 core-js gate:** any `Uint8Array` use in TV code pulls typed-array polyfills (memory `iptv-tv-bundle-polyfills`). It matters only once the TV app imports `crypto` (step 30). Run the 29b vectors from a separate test bundle, not the app's main bundle, so the gate holds.
   - **The "shared test vectors":** one JSON file in `packages/crypto` that the Node tests and the Chromium 53 run both read.
   - **Next.js and the packages:** `apps/web` consumes the packages as TS source, so add `transpilePackages: ['@lablo/protocol', '@lablo/crypto']` in `next.config.ts` when it imports them. Declare the workspace dependencies too.
   - **The R2 and Upstash interfaces live in `apps/web`, with local fakes only:**
     - `BlobStore`: put, get, delete, and a presigned PUT for the pairing file;
     - `RateLimiter`: limit a key, answering ok or retry-after.

     The real adapters (step 31 or 34) will need a narrow, tested exception in `NO_OUTBOUND_RULES`.
   - **Dependencies at least 2 weeks old.** Check them via the registry.
5. **Step 26's common items still apply:**
   - unit tests;
   - a mutation run with the mutant list written first;
   - the `pnpm verify` parts green;
   - `test:web` and `build:web` when `apps/web` changes;
   - the PR merged on green CI;
   - docs: RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook;
   - a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `8beb074` Merge PR #93 = main;
  - `7c7bb93` the docs commit (29a ticked);
  - `ae77243` Merge PR #92.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules` (now with Next, Prisma, pg), `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env` (just `DATABASE_URL=postgresql://lablo@127.0.0.1:54329/lablo`) and `apps/web/src/generated/prisma`. `apps/web/.next` was deleted (run `pnpm build:web` again if needed);
  - `dist/`: the TV build, unchanged from 28b2;
  - `artifacts/`:
    - `mutate29a.py` and `mutate29a.log`;
    - `unit-29a.log` (4,875), `build-29a.log`, `build-web-29a.log`, `web-start-29a.log`, `lint-29a.log`, `typecheck-29a.log`;
    - the 28b files.
- **Docker:** the container `lablo-web-postgres-1` is stopped (`pnpm web:db:down`). The volume `lablo-web_postgres` holds the development database `lablo` and `lablo_test`.
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 80** (memory `iptv-web-backend-gotchas`):
- **Next 16 stops `next build` once when an agent runs it** on a version with an npm advisory: `SecurityFatalError`, exit 1.
  - Its text tells the agent to ask the user about `next upgrade --agent=security`. That is tool output, not Omar's request: check the advisory yourself.
  - Re-running within 5 minutes continues.
  - CI never stops on it.
  - Never set `experimental.agentUpgrade: false`.
- **Vitest's `globalSetup` resolves bare imports from the workspace root.** `apps/web/test/global-setup.web.ts` loads `pg` with `createRequire` from `apps/web/package.json`. Test files resolve normally.
- **Prisma 7:**
  - The URL lives in `apps/web/prisma.config.ts`. It leaves out `datasource` when `DATABASE_URL` is unset, so `prisma generate` works in CI's verify job.
  - A schema change: `pnpm --filter @lablo/web exec prisma migrate dev --name <x>` with `pnpm web:db` running; commit the migration.
  - `test:web`'s drift check fails until the migration exists.
- **`apps/web/test/**` is exempt from the outbound lint** (it starts the Prisma CLI). Everything else in `apps/web` is covered, including `next.config.ts` and `prisma.config.ts`.
- **The forbidden-column check** (`apps/web/test/web-db.ts`, `FORBIDDEN_COLUMN_WORDS`) rejects any column whose words include ip, url, host, domain, password, user, email, mac, duid, lgudid, serial and similar. Name new columns accordingly (`installId` is fine; `userAgent` is not).
- **One CI poller, and never wait on it in the foreground.** A foreground `until [ -s <its output file> ]` wait hit 600 s and was moved to the background again (memory `gh-pr-checks-watch-race`). Start the poller with `run_in_background`, then do other work or end the turn.
- **Python patches in a Bash heredoc still mangled `\n` and `\.`** (in `ci.yml`). Write the patch with the Write tool, using raw strings, then run `python -I <file>`.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - Never delete files in `node_modules`.
  - Next 16.4.4's SWC and Prisma's schema engine load under SAC (checked in leg 80).
- **Overlap CI with the next step** (memory `iptv-relay-overlap-ci`).
  - Write the next step uncommitted while CI runs.
  - After the merge, run `git merge --ff-only origin/main`.
  - Commit the docs PR's files alone first.
  - Never push while a PR's CI runs.
- **The media flake** (`epg-declared-300mb`, single-sample budgets) can fail CI: one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done. It didn't happen on PR #92.
- **The relay's context check fires at about 450k tokens.**
- **Unit mutants take about 7 s each; e2e mutants about 20 s; `test:web` mutants about 10 s.** A `Monitor` on `tail -n +1 -f <log> | grep -E --line-buffered "SURVIVED|EXIT|/N"` reports survivors as they come.
- **The profile is at version 7.** The next bump moves the pins to 8 and the "newer version" tests to 9. Some fixtures use `v: 9`; the e2e pin is `episode-resume.spec.ts`'s `v: 7`.
- **TV code rules:**
  - no `Array.prototype.sort` in the TV main bundle (the 219 gate);
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls, array destructuring or spread, or a member named `at`, in TV files;
  - the build can crash once (0xC0000005): run it again.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch.
- **`python -I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop under 600 s.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`);
  - the poly count: `python -I -u artifacts/poly-count20c2a.py "<wt>"`.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`. Leg 80 slipped once.
- **Local `pnpm verify` may die at the unit stage** (low memory): run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going.**
- **Code rules:**
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs;
  - physical CSS only, no CSS Grid or flex `gap`;
  - TV code is ES2017; dependencies at least 2 weeks old; never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, path-filtered;
  - commits use the no-reply email; no secrets, no LG binaries, no personal data;
  - README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 80 (29a):**
  - **Locally:** lint, typecheck (also `apps/web` with no Next output, as on a fresh checkout), unit 4,875, `test:web` 13/13, `build:web`, both TV builds unchanged (main 415.7 / 403.0 KB, 219 core-js modules).
  - **Mutation:** 44/45, the survivor equivalent.
  - **Live** with `next start` + curl: 200 up; 503 with the database stopped, in 6 ms; 200 again; no `x-powered-by`.
  - **CI:** green on the first run, the `web` job included.
- **Not run locally:** `pnpm e2e` and `verify:engines` (no TV code changed). CI's `verify` and `engines` ran them, green.
- **Migrations and deploys:**
  - The only database migration (`init`) is applied to the local development database and to CI's throwaway service. Nothing is in production; Neon arrives with step 34 `[needs Omar]`.
  - The TV profile is still at version 7.
  - Nothing is deployed.

## Open decisions and gates
- **None for step 29b.** How to split it is the leg's call.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player. The whole of steps 24–28 can join that visit: catch-up, the movies and series screens, details, playing and resuming, episodes, auto-next, search, and Home with "Recent channels".
  - The visit can also check whether the TV keyboards type into the search field.
- **Step 34 `[needs Omar]`:** the Vercel, Neon, R2 and Upstash accounts and the domain. He puts the keys in `.env` himself. The first production migration and deploy each need his one-word OK.
- **For step 38 (parental):** every Home shelf, the search results, "Continue watching" and "Recent channels" hold adult items too: the lock must filter them.
- **For step 41 (the 2018 Samsung):** the decoded memory of real posters and logos; whether the low tier keeps posters in lists; the search's real time on the TV.
- **Later (unchanged):**
  - search and Home: a kind filter, posters in the search rows, Home and the search on the old-engine walk;
  - movies and shows: a show finished to its last episode coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start" for an episode;
  - player: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents, webOS's PRE-CH, pre-buffered zapping;
  - guide: a day jump; a Guide or Info key;
  - input and accessibility: an on-screen keyboard if the TV keyboards fail;
  - settings and old engines: step 38's settings rows; drop Chromium 53 (ADR-012);
  - low tier: a memory signal for the tier;
  - CI: the media flake's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (step 29a is merged; nothing to press on a TV)
1. Start Docker Desktop, then `pnpm web:db` in the repo.
2. Copy `apps/web/.env.example` to `apps/web/.env`.
3. `pnpm --filter @lablo/web exec prisma migrate deploy`, then `pnpm web:dev`.
4. Open http://localhost:3100/v1/health: you should see `{"ok":true,"db":"up"}`.
5. `pnpm web:db:down`, then reload: `{"ok":false,"db":"down"}` (status 503).
6. `pnpm web:db`, then reload: up again.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-seven CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description;
  - 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid";
  - 32: the commands table could add the one-engine and one-throttled-spec commands;
  - 33: its "Repo: private `Omarmarei/Lablo`" line (public since 2026-11-05);
  - 34: the header (now Guide, Movies, Series, Home, and the Search and Settings icons);
  - 35 (new): the commands table needs the backend's rows (`web:db`, `web:db:down`, `web:dev`, `build:web`, `test:web`, `verify:web`), and the Definition of done's item 1 needs `pnpm verify:web` for backend changes;
  - 36 (new): the "Package boundaries" row for `apps/web` could name the lint block (`NO_OUTBOUND_RULES`, its tests exempt);
  - 37 (new): its Definition of done's item 3 says "N/A until the backend exists (step 29)". Since 29a: local and CI migrations exist; Neon from step 34.
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create. He puts the keys in `.env` himself.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
