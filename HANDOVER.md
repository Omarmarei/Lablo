# Lablo IPTV: relay leg 116 opening prompt

You are leg 116 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–114 did steps 1–31 and 32a–32d (PRs #1–#141). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 115 (2026-11-19) merged two PRs:**
  - **32e, PR #142** (merge `4f043c6`), docs only, merged on green CI on the first run.
    - **The finding:** sealing the profile under `localKey` would not keep a login off the TV's disk. The login is in plain text in every stored stream URL (`catalog_chunks`, up to 200k items a source), in `sources_meta.epgUrls` and in the profile. And `localKey`'s master is cached beside them in `kv`.
    - **Omar's choice (option 1, "A"):** logins on the TV are not encrypted at rest, and the docs say so plainly. Everything that leaves the TV stays sealed.
    - **What changed:** `docs/adr/ADR-013-logins-on-the-tv-unsealed.md`; ADR-006 amended; architecture.md §3.3 B ("Decided in step 32e"); PLAN.md's "Trustworthy", risk item 8 and storage plan; the comments.
    - **Ticked:** 32e and **step 32**.
  - **Step 33 split** into 33a–33d, with its decisions written in RELAY.md (each with its why).
  - **33a, PR #143** (merge `9f109b6`): the scrubber and `POST /v1/telemetry`. Green CI; media passed on a rerun of the known `epg-declared-300mb` flake. Ticked.
    - `@lablo/protocol/scrub` (`scrubText`) is zod-free.
    - The route: a rate limit, 64 KB, the schema, crash stacks scrubbed again, a 90-day sweep, one `TelemetryEvent` row per event.
- **Next: 33b, the TV's telemetry.** Write its shape first.

## Read first
1. **`RELAY.md`:**
   - step 33's block: the split and "Decided in leg 115" (around line 2133);
   - 33a's shape, "Built in leg 115" and "Verified" (around line 2162);
   - the `- [ ] 33b.`, `33c.` and `33d.` lines (around line 2209);
   - progress row 115.
2. **`docs/architecture.md`:**
   - §3.4 Telemetry (around line 2053) and "Built in step 33a";
   - §3.2's API table and "Retention" (`/v1/telemetry`, `/v1/diag`; around line 1540).
3. **`docs/adr/ADR-013-logins-on-the-tv-unsealed.md`:** how to word logins. Never write "encrypted on the TV".
4. **The code:**
   - `packages/protocol/src/telemetry.ts`: the seven events, the buckets, the batch;
   - `packages/protocol/src/scrub.ts`;
   - `packages/protocol/src/config.ts`: `tunables.telemetrySampling`;
   - the model for a worker started for each call, with `kv` and requests: `packages/data/src/backup.worker.ts`, `backup-service.ts`, `backup-api.ts` (`fetchTransport`) and `client.ts`;
   - `apps/tv/src/data/engine.ts` (`startBackupWorker`, `uploadBackup`) and `apps/tv/src/data/workers.ts`;
   - the model for a schedule of 60 s after a change, a minimum gap, and on hide: `apps/tv/src/backup/backup-schedule.ts`;
   - `packages/data/src/profile.ts`: optional fields with no version bump, such as `noticesShown`;
   - where events come from: `packages/player/src/controller.ts` and `apps/tv/src/player/app-player.ts` (`play_result`, `stall`); `DataEngine.refresh` and `refreshEpg` (`ingest_done`, `epg_match`); `main.tsx` (`app_start`); the platform's info (`capability`);
   - Settings: `apps/tv/src/settings`; the consent text: `apps/tv/src/i18n/en.ts` and `ar.ts` (`onboarding` consent keys, around line 91).
5. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails" (telemetry never collects URLs, hostnames, channel or VOD names, credentials or IPs). CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `addc5e6`, `9f109b6`, `edd8d74`;
   - `origin/main` is `9f109b6`; the branch is pushed (`origin/relay/iptv-20261101-214120` = HEAD); no PR is open;
   - no `*.mutbak` files: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **33b's shape, written in RELAY before building,** under the `- [ ] 33b.` line, each choice with its why. Split it (for example 33b1: the worker, queue, install ID, sampling and switch; 33b2: the events wired in) if it is more than a leg. Settle:
   - **main.js records only:** plain event objects in memory, at most 200, and no `@lablo/protocol` import (zod would land in main.js; main.js has 25.3 KB left on Tizen). The server validates.
   - **The sender:** a worker of its own started for each send (as the backup worker), or a share of an existing worker. Measure: the scrubber alone is 25.8 KB, but its polyfills may already be in a worker. Budget 150 KB each.
   - **The install ID** in `kv` (`telemetry.id`, 16 random bytes, base64url). The queue in `kv` (`telemetry.queue`, at most 200, oldest dropped). A 200 clears what was sent.
   - **Sampling** per kind from the config's `telemetrySampling`, decided per install (a hash of the install ID and the kind).
   - **When:** 60 s after the first event not yet sent, at most every 15 min, and on hide. Decide whether `disable-app` stops it, as it stops the backup.
   - **The switch:** the profile's `telemetry: false` (optional, no version), a Settings row, one more sentence on the consent screen (en, ar). Off records nothing and clears the queue.
   - **`capability`:** the model and firmware must fit the protocol's `deviceName` pattern; the Chromium version comes from the user agent.
   - **The API base:** the same one the backup uses.
   - **The stand-in APIs:** the config server's stand-in learns `POST /v1/telemetry` for plain e2e; a real-API spec goes in both Playwright configs.
3. **Then build 33b** under step 26's common items (below), with the PR merged on green CI. 33c (the crash handler: raw text forwarded to the worker, scrubbed there with the user's own logins) and 33d (the diagnostics report and its support code) follow, each shape written first.
4. **After 33, step 34 is `[needs Omar]`.**

**Step 26's common items still apply:**
- unit tests;
- mutation, with the list written first;
- lint of the whole repo, root `tsc`, the package typechecks;
- `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes;
- `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
- a new e2e spec runs in plain `pnpm e2e` too, or in both configs for real-API specs;
- the PR merged on green CI;
- the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, one commit past `addc5e6` (this handover's), pushed. No PR open.
- **`main`:** `9f109b6` (Merge PR #143). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`;
  - `apps/web/.next` (33a's build, current);
  - `dist/` (32d4c's TV build, still current: no TV code changed since);
  - in `artifacts/`: `mutate33a.py` with `mutate33a-a.log` to `-c.log` (the runner's tail is reusable), `unit-33a.log`, `lint-33a.log`, `build-web-33a.log`, `e2e-web-33a.log`, and the older legs' logs and screenshots.

## Verified vs not
- **Verified in leg 115:**
  - **32e:** eslint on the three changed sources; `backup.test.ts` and `profile.test.ts` 70 passed; CI #142 green on the first run (verify, web, engines, media).
  - **33a:**
    - unit 7,307 (+20);
    - `telemetry.web.test.ts` 10;
    - `build:web`;
    - `e2e:web --project=phone telemetry backup` 2 passed;
    - the whole repo's lint, root `tsc`, the `@lablo/protocol` and `@lablo/web` typechecks;
    - mutation 86/86;
    - CI #143 green (media on attempt 2).
- **Not verified:**
  - the whole `pnpm test:web` locally (only the telemetry file; CI's web job ran all of it, green);
  - a real TV (step 21);
  - Vercel, R2 and Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 115:**
- **Logins on the TV are not encrypted at rest (ADR-013).** Product, store and UI text says "encrypted end to end whenever they leave the TV; our servers never see them", never "encrypted on the TV". `localKey` stays in `backupKeys`, derived and unused (the vectors pin it). Logins sit in the profile, in `player.last` and `channels`, in every catalog item's `url` and in `sources_meta.epgUrls`. The backup without logins still strips the profile's copies (32d4a).
- **Scrub in a worker, never in main.js.** The scrubber bundled alone is 25.8 KB on Chromium 53 (core-js's string and regex polyfills). Workers import `@lablo/protocol/scrub`; the `@lablo/protocol` index pulls zod.
- **The scrubber's order matters:** URLs first, then the known strings. A known host replaced inside a URL would have cut the URL's match short and left its path.
- **`fast-check` is now a devDependency of `packages/protocol`.**
- **Web tests:**
  - one file runs with `pnpm exec vitest run -c vitest.web.config.ts apps/web/test/<file>` (`lablo-web-postgres-1` up);
  - one e2e:web spec: `pnpm build:web`, then `pnpm exec playwright test -c playwright.web.config.ts --project=phone <name>`;
  - under a pinned clock, write timestamps from `deps.now()`, never Postgres `now()`.
- **Mutation:** copy `artifacts/mutate33a.py`'s runner. Run in foreground chunks of under 9 minutes (`--from`/`--to`); web-test mutants take about 15 s each.
- **A one-line `sed -i` ate a regex backslash** (`\(`). Use Edit for any line with a backslash.
- **The `epg-declared-300mb` flake** hit a PR with no media path in it (63.7 against 60): rerun green.

**From earlier legs (still true):**
- **Types for a source without its login:** `StoredSource`, `StoredGuide`, `RefreshSource`; the `ingestSourceOf` overloads; `sourceUrlOf` gives the kept server or origin. Refusal order in `DataEngine.refresh`: `needs-login` before `claim`, the blocklist after.
- **`refreshNow` reads only the guides,** and the refresh schedule holds a refused refresh (`needs-login` too) as a failure for 2 h. A source refresh outside the schedule goes through main's `quiet` (as `refreshSource` does).
- **A playlist's `url-tvg` is often the very link the user typed as its guide;** `epgGuides` lists a URL once, the user's guide first.
- **A settings page under a dialog** hands its own screen to `VirtualList`/`useZone`, never `binding.nav.top`.
- **Old-engine backup checks:** 20. Adding one touches `BACKUP_CHECKS`, the `vectors.test.ts` pins and strings, `vectors.ts`'s comment, and `check-backup.test.ts`.
- **en-XA "cut" checks measure width only.** A new screen goes into the en-XA walk.
- **Patch scripts written with the Write tool** (`EDITS = [(path, old, new), ...]`, each old string asserted to occur once, CRLF kept) are reliable; Bash heredocs with backslashes are not.
- **Overlap works:** build the next step uncommitted while a PR's CI runs, then `git merge --ff-only origin/main` with the dirty tree after the merge.
- **`git rev-parse --short A B` fails;** use one `rev-parse` per ref. The Bash cwd can reset to the main checkout mid-leg: keep absolute worktree paths and `git -C`.
- **Never pass `-c user.email=…`;** the worktree config has the no-reply email.
- **CI:**
  - a PR touching the TV, data or engines runs web, verify and engines (about 30 min); a protocol or web change runs all four jobs, media included;
  - never push to a PR while CI runs;
  - there is no `jq`: use `gh --jq`;
  - known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-min cap, Chromium 53/56 DevTools start-up;
  - `gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations` gives a failed job's assertion.
- **Waiting on CI:** a background `until` loop on `gh run view <run> --json status` with 60 s steps. Retry every `gh` call and `git push`, with `timeout 20 tail -f /dev/null` between tries.
- **main.js budget** on Tizen is 500 KB (25.3 KB left); one screen is about 8 KB. Read `build:tv`'s log for `Circular dependency: apps/`.
- **TV code rules:**
  - no `.sort(` in main;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX spread props are fine), fragments;
  - these pull polyfills: members named `flags` or `at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt`;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` is hook-free; UI text comes only from the catalogs;
  - a component with hooks can't be called as a function in a VNode test: split out a hook-free `…View`.
- **Typecheck traps:** `bytes[i] ^= 1`; `transact<unknown>`; `transact` settles `undefined` without `done`.
- **`git mv` stages at once:** check `git diff --cached --name-only` before each commit.
- **Real-API specs** go in both Playwright configs; root e2e specs have no `pg` types; a TV build takes `?api=` only for loopback.
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`.
- **Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22; this PC runs Node 24;
  - a bare `sleep` is blocked: use `timeout N tail -f /dev/null`;
  - `TaskStop` on `verify:engines` leaves its container behind (`docker rm -f`);
  - the TV build can crash once (0xC0000005): rerun it;
  - Chromium 53 has no `Input.insertText`.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Profile versions are on-device migrations.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **33's design calls are the legs' own;** write the why for each in RELAY. Telemetry is opt-out, as architecture.md §3.4 says; counsel reviews that before launch. Stop as needs-you only if building shows a real reason to change it, for example a store rule that requires opt-in.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in the phone page's `connect-src`, and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):**
  - the guides screen's "read, last try failed" rows clip their third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - `epg-declared-300mb`'s single-sample budget: a best-of-3 is worth proposing to Omar (it flaked again in leg 115).
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, an RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV. That session also covers an Arabic onboarding for the UTF-8 main.js, typing a backup code, a login given again on the sources screen, and a guide's link given again on TV guides.

## Checks for Omar
1. **Read once:** `docs/adr/ADR-013-logins-on-the-tv-unsealed.md`, and PLAN.md's reworded "Trustworthy" line and risk item 8. They record your choice "1" from leg 115: logins on the TV are not encrypted at rest; everything that leaves the TV is.
2. **Nothing to click.** 33a is a server route with no TV change, merged and not deployed.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`.

  No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
