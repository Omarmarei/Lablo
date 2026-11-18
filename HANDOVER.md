# Lablo IPTV: relay leg 105 opening prompt

You are leg 105 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–103 did steps 1–31, 32a and 32b (PRs #1–#129). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 104 (2026-11-18) split step 32c and built 32c1: PR #130, merge commit `9c9c04e`.** CI was green; media needed one rerun for the known `epg-declared-300mb` timing flake.
  - **The split:** 32c1 is the worker's side (done); 32c2 is the app's side (next).
  - **Four decisions, written in RELAY.md under 32c ("Decided in leg 104"):**
    - "Include login details" off moves to 32d, with its toggle. A source without its login would be a new profile shape.
    - The restore writes nothing until a backup is restored.
    - A backup this TV hasn't seen is never written over. The first send under a lookup ID asks `GET` first; a backup there means `held`.
    - A restore's catalogs come back through the refresh schedule. The config's `block-new-sources` does not refuse them.
  - **What 32c1 built** (architecture.md §3.3 B "Built in step 32c1"):
    - `packages/data/src/backup-plain.ts`: the profile's JSON, gzipped with `mtime` 0. Reading it back refuses a stream whose gzip trailer says more than 8 MB, before inflating.
    - `backup-api.ts` (`BackupApi`): `GET`, `PUT` and `DELETE` on `/v1/backup/:lookupId`. Each answer has 20 s; only a 200 `GET` has its body read, capped at 512 KB plus 1 KB.
    - `BackupService.upload({platform, appId, secret, base})` answers `none`, `same`, `held`, `sent`, `too-large` or `failed`:
      - it claims the lookup ID in `kv` `backup.sent` (hash `''`) before the first `PUT`;
      - it deletes old copies with their own token.
    - `BackupService.restore(...)` (device ID only) answers `restored` (with `language` and `sources`), `kept`, `none`, `unreadable`, `newer` or `failed`:
      - the master is derived in memory;
      - the profile, the master record and the send record are written in one transaction, only where there is still no profile.
    - `backupStandIn()` (`backup-stand-in.ts`): the 32a API in memory, for the tests and the vectors page.
    - `@lablo/protocol/backup-limits`: the limits without zod.
    - `DataEngine.uploadBackup(request)` and `restoreBackup(request, {onProgress, cancel})`: a cancel rejects with `CancelError` and ends the worker.
    - `check-backup` has three more checks: `backup.upload`, `backup.same` and `backup.restore`.
  - **The app calls neither yet:** 32c2 wires them.
  - **Sizes:**
    - the backup worker is 131.4 KB of its 150 KB budget (about 18 KB left for 32d and 32e);
    - main.js's own code is 459.5 KB (Tizen) and 446.8 KB (webOS) of 500.
  - **CI's restore after a wipe** (the look-up's real cost): 1.4 s on Chromium 53, 4.2 s on 56, 0.2 s on 68.

## Read first
1. **`RELAY.md`:**
   - step 32 whole: "Decided in leg 102", "Decided by Omar";
   - 32a and 32b;
   - **32c**: "Decided in leg 104";
   - **32c1**: shape, "Built", "Verified" and "Done";
   - **32c2**, including **"Notes from 32c1 for its shape"**;
   - 32d and 32e;
   - the progress log's last rows (102–104).
2. **`docs/architecture.md`:**
   - §3.3 B (search `**B. Backup`), with "Built in step 32b" and **"Built in step 32c1"**;
   - the first-run list (search "Device-ID consent": item 3 already says the ID is read once at a first start);
   - the storage table (search "M3U files sent from a phone": corrected in 32c1).
3. **Code for 32c2:**
   - **the start:**
     - `apps/tv/src/main.tsx` (the `else` branch at the bottom: `readStartProfile` → `startPoint` → `showLive` or `showOnboarding`; the gate and `config.start()` come after);
     - `apps/tv/src/onboarding/start.ts`;
     - `onboarding-state.ts`, `OnboardingApp.tsx`;
     - the consent texts in `apps/tv/src/i18n/en.ts` and `ar.ts` (`onboarding.consentTitle`, `consentBody`, `consentNo`);
   - **the requests:**
     - `apps/tv/src/backup/backup-request.ts` (`backupRequest`: the ID only after "Allow");
     - the look-up needs a separately named request (`lookupRequest`?) that reads the ID with no consent, called only by the start with no profile;
   - **the engine and the schedules:**
     - `apps/tv/src/data/engine.ts` (`uploadBackup`, `restoreBackup`);
     - `apps/tv/src/data/refresh-scheduler.ts` (`FIRST_CHECK_MS` 15 s; it already refreshes stored sources with no catalog);
     - `apps/tv/src/data/config-schedule.ts` (a schedule with lifecycle, to copy for the upload schedule);
   - **the platforms:**
     - `packages/platform-browser/src/index.ts` (`deviceSecret` gives `null`: e2e needs a test device ID, e.g. a dev-only `?device=` read in the browser platform);
     - `packages/platform-webos` and `platform-tizen` (`deviceSecret`);
   - **the stand-ins:**
     - `e2e/api-front.ts` and the e2e config server (`e2e/config-server.ts`);
     - `tools/engines/src/pair-stand-in.ts` and `pair-server.ts` (the old engines' API stand-in, which must learn the backup routes; tools/engines doesn't depend on `@lablo/data`, so port the 32a rules or keep it minimal);
   - **the API base:** `readApiBase` in `apps/tv/src/data/params.ts` (`configRequest.base` in main.tsx).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.
5. **Memory:**
   - iptv-ui-test-gotchas (post-paint workers, onboarding's navigator, `data-ready`);
   - iptv-old-engine-walk (a self-starting worker needs its own idle wait before a walk navigates; **32c2's look-up and upload are exactly that**);
   - iptv-tv-bundle-polyfills (TV code rules);
   - iptv-data-layer-test-gotchas;
   - iptv-parser-test-patterns (leg 104 notes);
   - iptv-zod-protocol-gotchas (leg 104 note).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `a8092d4` (PR #130's merge recorded) and `9bbdf28` (32c1);
   - `origin/main` is `9c9c04e`;
   - no `*.mutbak`: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`: 10.7 to 14.4 GB was free in leg 104). Run unit, e2e and mutation in the **foreground**; nothing was reaped in leg 104.
3. **Step 32c2: write its shape in RELAY.md first** (as 32a, 32b and 32c1 did), then build. It must settle:
   - **The look-up at a start with no profile** (Omar's decision):
     - a separately named request that reads the device ID with no consent, with a test that only the start with no profile calls it (a source scan, as `acg.test.ts` scans);
     - leg 104 recommends **waiting** behind a "Looking for your backup" screen with scrypt's progress over switching mid-onboarding: onboarding's first answer creates a profile, and a restore never writes over one;
     - a time limit (CI measured 4.2 s on Chromium 56; a 2018 TV may need 10+ s), enforced by `restoreBackup`'s `cancel`;
     - after a cancel, **read the profile again** (a restore may have committed just before), then show onboarding or "Welcome back";
     - no device ID (the browser platform, a refused read): no look-up, onboarding at once.
   - **"Welcome back":**
     - in the restored language (`restored.language`), en and ar;
     - then the live screen, with the refresh schedule's first check at once (it waits 15 s now);
     - decide whether the restored last channel should auto-play (`startPoint` would play it: its URL is in the profile).
   - **A restored file source** asks to be sent again from the phone (the sources screen shows "Not updated yet" today).
   - **The upload schedule** (`createBackupSchedule`?):
     - 60 s after a profile change (`editProfile` resolving `true`, a catalog swap that re-matched favourites), at most every 5 minutes, and at once when the app is hidden with a change pending;
     - the request through `backupRequest` (the ID only after "Allow");
     - `held` and `failed` logged, no retry storm;
     - it starts only with the live screen (the worker answers `none` without a source anyway).
   - **The consent text** (en and ar) says the ID is used "to find and encrypt your backup".
   - **The stand-in APIs learn the backup routes:** the e2e side, and `tools/engines`' stand-in for the old-engine walks. The look-up worker and the upload schedule are self-starting workers: every old-engine walk starting with no profile needs an idle wait if its platform gives a device ID. The harness's webOS/Tizen builds probably give none (check `deviceSecret` there).
   - **e2e:** a wipe (delete the `lablo` IndexedDB) then a reload → "Looking…" → "Welcome back" → the live list fills (en and ar screenshots, looked at); no backup → onboarding; a change → the upload's `PUT` seen by the test front.
4. **Then 32d** (Settings: backup on or off, "include login details" with its stripped envelope and the restore's "give the login again"; the backup code's screens; `held`'s "restore or replace"; the wipe e2e against the real API; the old-engine walk with a wipe) and **32e** (logins at rest; first read architecture.md's 32e note).
5. **Step 26's common items still apply to every step:**
   - unit tests;
   - mutation with the list written first (`artifacts/mutate32c1.py` is the newest template: `--check`, `--from`, `--to`; run in foreground chunks of about 25);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker or the build changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - the PR merged on green CI;
   - the docs, and the merge recorded (RELAY tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of `a8092d4` (PR #130's merge recorded) and `9bbdf28` (32c1).
- **`main`:** `9c9c04e` (Merge PR #130). The relay branch is ahead of main only by docs commits (`a8092d4` and this handover); they go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/` (built in leg 104 from 32c1's source);
  - `artifacts/`: `mutate32c1.py`, `mutate32c1-{a,b,c,d,e}.log`, `build-tv-32c1.log`, `engines-32c1.log`, `unit-32c1.log`, `lint-32c1.log`, `typecheck-32c1.log`, `e2e-32c1-vectors.log`, and earlier legs' files.
- **The `lablo-web-postgres-1` container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container, `zz-*` script or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 104:**
- **A constant from `@lablo/protocol`'s index pulls zod into a worker.** Use a schema-free subpath, as `@lablo/protocol/backup-limits` is: an `exports` entry plus the boundary lint's `entry-point` allow, and a test that pins it has no import.
- **Per-module worker sizes:**
  - temporarily `export` `plugins` in `tools/build/src/bundle.ts`;
  - bundle with Rollup from a `tools/build/src/zz-*.ts` script (`pnpm exec tsx`);
  - sort `output[0].modules[id].renderedLength`;
  - revert the export and delete the script.
- **Incompressible test data comes from a SHA-256 stream, not an LCG** (deflate shrank LCG noise 30x). With it, a binary search on a length hits an exact gzip size.
- **A stand-in that answers any origin hides a changed base:** record the URLs (the engine test's `backupHold.urls`).
- **`sealBackup` draws its nonce from the CSPRNG:** a realm test that counts `getRandomValues` sees one draw per upload.
- **Writing the mutation list first also finds dead guards:** take them out of the code. A `typeof x === 'object'` before reading `.v` mattered only for `null`; a `typeof base !== 'string'` before `regex.exec` changed nothing.
- **`gh pr checks` exits 1 when a check failed:** a background `until … gh pr checks` waiter ends then, with no harm done.
- **The CI wait that worked:** `timeout 25 tail -f /dev/null`, read `gh pr checks`, then the Monitor tool with a 45 s poll loop printing each job as it ends and `ALL DONE`. Media's flake was rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` after the whole run ended.

**From earlier legs (still true):**
- **The CI front:** a PR that touches `packages/protocol`, the TV or the engines runs every CI job (web, verify, engines, media). Never push to a PR while its CI runs.
- **Known CI flakes,** each rerun with `--failed` once the whole run is done:
  - `epg-declared-300mb` (media; again in leg 104: 70 ms against 60);
  - media's 30-minute cap after slow installs;
  - `auto-next.spec.ts` ar-SA `endEpisode`;
  - Chromium 53/56 DevTools start-up.
  - No `jq`: use `gh --jq`.
- **crypto's `src/*.test.ts` compile at ES2017:** no BigInt literals there.
- **The old-engine proof of a worker that needs IndexedDB is a shared check entry** in a database of its own, deleted first and last (`@lablo/data/check-backup`). The harness keeps its own copy of the names (`BACKUP_CHECKS`, now 11).
- **Mutation lessons:**
  - a stand-in CSPRNG must be non-symmetric;
  - storage keys and limits used only through constants need pinned literals;
  - a test helper's default can't take `undefined` to mean "none".
- **A database test with a pinned clock must not use Postgres's `now()`.** A route's own dependencies need a test through the route file.
- **A check that only ever expects the cleared state is vacuous:** hold the request that ends it (`front.hold(...)`). The test front (`e2e/api-front.ts`) has `forwarded`, `received`, `hold` and `serve`.
- **`pnpm e2e:web`** is 20 tests; `pnpm e2e` is 150. Mutants of `apps/web` that only an e2e catches need `pnpm build:web && …`.
- **Chromium 53 drops a `MessagePort` message whose transfer list holds an `ArrayBuffer`:** copy instead.
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`. Grep `v: N\b`.
- **A reaped background run is never restarted unasked.** Use foreground `tsc --noEmit -p` per package, `pnpm exec vitest run --maxWorkers=3` (about 70 s), and mutation in chunks.
- **Heredocs and escapes:**
  - never put a backslash-u in heredoc Python or Write content;
  - Python string literals with `\s` warn (they still pass through); prefer the Edit tool for anything with a backslash;
  - single quotes inside a single-quoted TS test title break the file: use double quotes.
- **`bytes[i] ^= 1` fails typecheck:** write `bytes[i] = bytes[i]! ^ 1`. `transact(...)` infers `void`: write `transact<unknown>` when `done` gets a value.
- **`git mv` stages the rename at once:** run `git diff --cached --name-only` before every commit.
- **TS 5.7+:** type byte helpers `Uint8Array<ArrayBuffer>` for `BodyInit` and `BlobPart`.
- **A TV build takes `?api=` only for loopback hosts;** old-engine walks forward a container port with `forwardToHost`.
- **The real `GET /v1/config` answers `private, max-age=300`:** a test's own config goes in before the TV's first request.
- **Root e2e specs have no `pg` types:** use `createRequire(path.join(WEB, 'package.json'))('pg')`.
- **New ways in go through the gates:** any new way to play goes through `PlayerController.play`; any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`. A restore is not a new way to add (decided in leg 104).
- **A component with a hook can't be called as a function in a VNode test:** split it.
- **i18n arguments are isolated in English too:** compare with `stripIsolates`.
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`:** check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.** A manual clock races requests that register their sleeper later: wait until the request is recorded before advancing.
- **Workers:**
  - a worker started after the first paint needs its npm deps in `optimizeDeps.include` (fflate, tweetnacl and noble are there);
  - never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`;
  - a self-starting worker needs its own idle wait before an old-engine walk navigates.
- **Polyfill names to keep out of TV code:**
  - members named `flags` or `at`;
  - `lastIndexOf` on arrays, `concat`, `URL`;
  - regex `.test`, `trim`, `parseInt`.
  - Probe with `artifacts/babel-polys30b2.ts <files>`.
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine);
  - physical CSS only, no CSS Grid or flex `gap`;
  - ES2017;
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs.
- **Web backend:**
  - `next build` typechecks e2e files;
  - `next start` locks `.next`;
  - Playwright's `webServer` starts before `globalSetup`;
  - `TaskStop` leaves `next start` running;
  - node-postgres reads `timestamp` as local time.
- **Python on Windows writes CRLF in text mode:** write with `newline=''`.
- **Windows Smart App Control:** before every pnpm command, run `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path). Never delete files in `node_modules`.
- **CI runs Node 22; this PC runs Node 24.** A bare `sleep` is blocked in the foreground: use `timeout N tail -f /dev/null`.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 has needed none so far.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in CI (PR #130):**
  - verify: unit 6,533 with one skipped; `pnpm e2e` 150 passed;
  - web passed;
  - engines: all 126 runs as expected on Chromium 53, 56 and 68, 89 seeded failures caught, the backup worker 11/11 on each;
  - media passed on a rerun.
- **Verified locally:**
  - lint; typecheck of the root and every package;
  - unit 6,534 (+154);
  - `build:tv`; `e2e/crypto-vectors.spec.ts`;
  - `verify:engines --engine chrome53 --engine chrome68`: 22/22;
  - mutation 121/121 (122 written first, 2 gaps closed, 1 equivalent).
- **Not verified:**
  - the app calling the upload or the restore (32c2);
  - anything on Vercel, R2 or Upstash (step 34: the R2 adapter must give `put`, `get` and `delete` for `backup/<lookupId>`);
  - a real TV reading its own DUID or LGUDID through the app.
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32c2's design calls are the leg's own:** wait or switch (wait recommended), the time limit, the restored last channel auto-playing or not. Write the why in RELAY.md.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in the phone page's `connect-src`, and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets (it flaked again in leg 104).
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`, run `pnpm exec vitest run packages/data/src/backup-plain.test.ts packages/data/src/backup-api.test.ts packages/data/src/backup-stand-in.test.ts packages/data/src/backup-service-sync.test.ts`. Expect 148 passed.
2. `pnpm build:tv`, then `pnpm exec playwright test e2e/crypto-vectors.spec.ts`. Expect 1 passed. The page `dist/tv-vectors/index.html`, opened in Chrome, shows `backup worker: 11/11 passed`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`) and read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word:
  - 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`);
  - 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`);
  - 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`);
  - 55 in leg 100's (`git show e85772d:HANDOVER.md`).
  - No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
