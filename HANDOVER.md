# Lablo IPTV: relay leg 104 opening prompt

You are leg 104 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–102 did steps 1–31 and 32a (PRs #1–#128). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 103 (2026-11-18) built step 32b, the TV's backup keys: PR #129, merge commit `57bee9c`**, green on the first CI run.
  - **`@lablo/crypto` `backup-code.ts`:** `backupCodeText(16 bytes)` gives 26 Crockford characters (the 128-bit number in base 32, big-endian; the first character 0 to 7); `readBackupCode(typed)` drops spaces and dashes, upper-cases, reads I and L as 1 and O as 0, and gives the 26 characters or `null`.
  - **`@lablo/data` `backup-service.ts` and `backup.worker.ts`:**
    - `BackupService.prepare({platform, appId, secret})` answers `{source: 'device' | 'code', derived}` and pushes scrypt's `progress` in whole percents.
    - With `secret: null` it keeps the **backup code** in `kv` `backup.code`: the kept one, or a new one, made in the same `readwrite` transaction that found none, before anything is derived. If the code can't be kept, the call fails.
    - The **master** is cached in `kv` `backup.master` as `{source, check, master}`, where `check` = b64url(SHA-256(UTF-8(salt + "|" + secret))). scrypt runs only when no record's check matches. A master that can't be written still answers the call.
    - No key leaves the worker; `backupHandlers` serves `prepare`.
  - **The worker's size:** a worker of its own, because the config worker with the service added measured 148.7 KB of its 150. Alone it is 105.5 KB. main.js's own code is 459.2 KB (Tizen) and 446.5 KB (webOS) of 500.
  - **`@lablo/data/check-backup`:** eight checks of the service against a real IndexedDB in its own database, `lablo-backup-check`, deleted first and last. Node runs them with fake-indexeddb; the vectors page runs them in a second Blob worker. The harness keeps its own copy of the names, `BACKUP_CHECKS` in `tools/engines/src/vectors.ts`, pinned to the package's by `test/backup-worker-bundle.test.ts`.
  - **The app:**
    - `DataEngine.prepareBackup(request, onProgress)` starts a backup worker per call (`startBackupWorker` in `workers.ts`).
    - `apps/tv/src/backup/backup-request.ts` `backupRequest(platform, consent, build)` calls `deviceSecret()` only when `consent === true`. A missing, blank or refused ID becomes `null`.
    - **The app calls neither yet:** 32c wires them.
  - **`__APP_ID__`** (`appIdFor` in `tv-defines.config.ts`, from the manifests): `LabloIPTV1.Lablo` on Tizen, `com.lablo.iptv` on webOS and the desktop. It is defined in `bundle.ts` and `vite.config.ts`.
  - **webOS:** the app's `requiredACG` is `["deviceinfo.query"]`.
- **Omar decided (in leg 103's tab, 2026-11-18): look for a backup first.** At a start with no profile, before onboarding asks anything, the TV reads its device ID once, derives the keys and asks the API once. A backup found restores at once ("Welcome back"). None found: nothing derived is kept, and onboarding runs as now. It is written in RELAY.md under step 32 ("Decided by Omar") and in architecture.md's first-run list (item 3).

## Read first
1. **`RELAY.md`:**
   - step 32 whole: "Decided in leg 102", **"Decided by Omar"**, 32a and 32b (each with its shape, "Built", "Verified" and "Done"), **32c**, 32d, 32e;
   - the progress log's last rows (101–103).
2. **`docs/architecture.md`:**
   - **§3.3 B** (search `**B. Backup`), including **"Built in step 32b"** and its notes "For 32c" and "Found while building, for 32e";
   - §3.2 "Built in step 32a" (the API: `PUT`, `GET` and `DELETE` on `/v1/backup/:lookupId`, `X-Write-Token`, 512 KB);
   - the storage table row "IDB `blobs` … included in the backup if ≤ 5 MB", which 32c corrects;
   - the first-run list (search "Device-ID consent").
3. **Code for 32c:**
   - the profile:
     - `packages/data/src/profile.ts`: the document, its version 8, `consent`, `SourceRecord`, the migrations, "a newer document is one it never saves over";
     - `packages/data/src/query-service.ts`: `profile`, `editProfile`;
   - the start: `apps/tv/src/main.tsx`, `apps/tv/src/onboarding/start.ts` (`readStartProfile`, `startPoint`), `onboarding-state.ts`, `OnboardingApp.tsx`; the consent texts are in `apps/tv/src/i18n/en.ts` and `ar.ts` (`onboarding.consentTitle`, `consentBody`, `consentNo`);
   - the gates for new ways in:
     - any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`;
     - a restore's re-ingest is a new way to add sources;
     - `apps/tv/src/onboarding/engine-loader.ts`;
   - the API stand-ins:
     - `e2e/api-front.ts` (the test front);
     - `tools/engines/src/pair-stand-in.ts` and `pair-server.ts` (the old engines' stand-in API, which must learn the backup routes);
     - `apps/web/src/server/backup.ts`;
   - the worker side: `packages/data/src/backup-service.ts` (32c's `upload` and `restore` handlers belong there); the gzip comes from `fflate`, already used by the ingest worker (`packages/data/src/gunzip.ts`); `@lablo/crypto` `sealBackup`/`openBackup`; `@lablo/protocol`'s `backupEnvelopeSchema`, `BACKUP_WRITE_HEADER`, `BACKUP_BODY_MAX_BYTES`.
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.
5. **Memory:** iptv-crypto-gotchas (leg 103 notes), iptv-tv-bundle-polyfills, iptv-data-layer-test-gotchas (profile bumps pin several files), iptv-old-engine-walk (a self-starting worker needs its own idle wait before a walk navigates), iptv-ui-test-gotchas (post-paint workers' deps in `optimizeDeps.include`), iptv-web-backend-gotchas.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -5` shows this handover's commit, then `29a20de` (Omar's decision), `eba3068` (PR #129's merge recorded), `57bee9c` (the merge) and `3b6f122` (32b);
   - no `*.mutbak`: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`; 14.5 GB was free in leg 103). Run unit, e2e and mutation in the **foreground**: only background shells get reaped while idle. Nothing was reaped in leg 103.
3. **Step 32c, upload and restore.** It is large: split it first if the shape shows more than one leg of work (for example 32c1: the envelope and the worker's `upload`/`restore`, with unit and realm tests; 32c2: the app's start look-up, "Welcome back", the re-ingest and the upload schedule, with e2e and the old-engine stand-in). Write the shape in RELAY.md before building, as 32a and 32b did. It must settle:
   - **the envelope's plaintext:** the profile document gzipped. With "include login details" off, sources go without login or link. A phone-sent file source goes by name, and after a restore asks to be sent again. The 512 KB check comes before sealing.
   - **the upload:** 60 s after a change, at most every 5 minutes, and when the app is hidden. It is gated on the backup being on (until 32d's Settings it is on by default). The write token goes in `X-Write-Token`. When the source changes (a consent given later), delete the copy under the old lookup ID with the old token (architecture.md's "For 32c").
   - **the start look-up** (Omar's decision):
     - a separately named path from 32b's `backupRequest` (that one stays "only after Allow"), tested to run only at a start with no profile;
     - whether the start waits behind a "Looking for your backup" screen with progress, or shows onboarding and switches when a backup is found;
     - a time limit;
     - with no backup found, the `kv` master record is deleted ("nothing derived is kept");
     - scrypt takes 1.2 s on Chromium 53, 3.4 s on 56 and 0.2 s on 68 on CI (with IndexedDB), perhaps 10+ s on a 2018 TV.
   - **the restore:**
     - `GET`, open, gunzip, then check the profile's version: a newer one is refused;
     - save it; the catalogs re-ingest in the background through `DataEngine.refresh` and `refusalFor`;
     - the "Welcome back" text in en and ar.
   - **the consent screen's text** says "to find and encrypt your backup" (en and ar).
   - **The stand-in APIs learn the backup routes:** `e2e/api-front.ts` or the dev API for e2e, and `tools/engines`' stand-in for the old engines.
   - **The polish to correct:** architecture.md's storage table row.
4. **32d** (Settings, the backup code's screens, the wipe e2e and the old-engine walk: step 32's "Done when") and **32e** (logins at rest; first read architecture.md's 32e note: with the master cached in IndexedDB, `localKey` can't protect a copied IndexedDB, so 32e must change what is cached or say so plainly).
5. **Step 26's common items still apply to every step:**
   - unit tests;
   - mutation with the list written first (`artifacts/mutate32b.py` is the newest template, with `--check`, `--from` and `--to`);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page, a worker or the build changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - the PR merged on green CI;
   - the docs, and the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of `29a20de` (Omar's decision recorded), `eba3068` (PR #129's merge recorded) and `57bee9c` (Merge PR #129, on `3b6f122`).
- **`main`:** `57bee9c`. The relay branch is ahead of main only by docs commits (`eba3068`, `29a20de` and this handover); they go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next` (from 32a's source);
  - `dist/`, built in leg 103 from 32b's source;
  - `artifacts/`: `mutate32b.py`, `mutate32b-a.log`, `mutate32b-b.log`, `measure32b.log`, `build-tv-32b.log`, `engines-32b.log`, `unit-32b.log`, `lint-32b.log`, `typecheck-32b.log`, `e2e-32b-sample.log`, and earlier legs' files.
- **The `lablo-web-postgres-1` container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 103:**
- **crypto's `src/*.test.ts` compile at ES2017:** a BigInt literal there fails `pnpm typecheck` (TS2737) while vitest passes. Write the oracle without BigInt (a bit string cut into 5-bit groups did), or put it in `packages/crypto/test/`.
- **Measure before choosing a worker:** a temporary `packages/data/src/zz-*.worker.ts` plus `tools/build/src/zz-measure*.ts` calling `bundleIife` and `checkBudget` (run with `pnpm exec tsx`, then delete both).
- **The old-engine proof of a worker that needs IndexedDB is a shared check entry** (`@lablo/data/check-backup`) in a database of its own, deleted first and last, run by the vectors page in its own Blob worker. A new data entry point needs its `exports` line and the boundary lint's allow rule (`eslint.config.js`, `boundaries/entry-point`).
- **The ACG scan works:** `acg.test.ts` failed as soon as app code called `.deviceSecret(`; the manifest and the pins in `platform-files.test.ts` and `lab.test.ts` move with it.
- **Mutation lessons:**
  - a stand-in CSPRNG of equal bytes hid a byte reversal: use a non-symmetric pattern;
  - storage keys used only through their constants need pinned literals;
  - a test helper's default parameter can't take `undefined` to mean "none", because the default kicks in: use `null`.
- **Heredoc Python again:** `\'` meant to escape a quote in TS reached the file bare and broke it. Use the Edit tool for anything with a backslash.
- **The CI wait that worked:** `timeout 25 tail -f /dev/null`, read `gh pr checks`, then the Monitor tool with a 45 s poll loop that prints each job as it ends and `ALL DONE` (CI took 23.5 min: engines).

**From earlier legs (still true):**
- **The CI front:** a PR that touches `packages/protocol`, the TV or the engines runs every CI job (web, verify, engines, media). Never push to a PR while its CI runs.
- **Known CI flakes,** each rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `epg-declared-300mb` (media); media's 30-minute cap after slow installs; `auto-next.spec.ts` ar-SA `endEpisode`; Chromium 53/56 DevTools start-up. No `jq`: use `gh --jq`.
- **A database test with a pinned clock must not use Postgres's `now()`.** A route's own dependencies need a test through the route file.
- **A check that only ever expects the cleared state is vacuous:** hold the request that ends the state (`front.hold(...)`) and assert the set value too. The test front (`e2e/api-front.ts`) has `forwarded`, `received`, `hold` and `serve`.
- **`pnpm e2e:web`** is 20 tests; `pnpm e2e` is 150 (it ignores the `tv` project's `pairing-api` and `no-plaintext`). `--project=phone <filter>` (the flag is variadic). Mutants of `apps/web` that only an e2e catches need `pnpm build:web && …`, and a clean `pnpm build:web` after.
- **Chromium 53 drops a `MessagePort` message whose transfer list holds an `ArrayBuffer`:** copy instead of transferring.
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts` and `e2e/episode-resume.spec.ts`. Grep `v: N\b`; the "current + 1" pins move too. A restore that refuses a newer profile needs these.
- **A reaped background run is never restarted unasked.** In the foreground: `tsc --noEmit -p` per changed package; `pnpm exec vitest run --maxWorkers=3` (the whole suite, about 70 s); mutation in chunks under the tool's 10 minutes.
- **Heredocs and escapes:** never put a backslash-u escape in heredoc Python (a SyntaxError) or in Write content (it gets decoded: use `String.fromCharCode`).
- **`bytes[i] ^= 1` passes vitest but fails typecheck:** write `bytes[i] = bytes[i]! ^ 1`.
- **`git mv` stages the rename at once:** run `git diff --cached --name-only` before every commit.
- **vitest's `toEqual` on megabyte `Uint8Array`s is slow:** compare with `Buffer.from(a).equals(Buffer.from(b))`.
- **TS 5.7+:** type byte helpers `Uint8Array<ArrayBuffer>` for `BodyInit` and `BlobPart`.
- **A refusal sample must break exactly one rule.**
- **A TV build takes `?api=` only for loopback hosts;** old-engine walks forward a container port with `forwardToHost`.
- **The real `GET /v1/config` answers `private, max-age=300`:** a test's own config goes in before the TV's first request.
- **Root e2e specs have no `pg` types:** use `createRequire(path.join(WEB, 'package.json'))('pg')`.
- **New ways in go through the gates:** any new way to play goes through `PlayerController.play`; any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`.
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component.
- **i18n arguments are isolated in English too:** compare with `stripIsolates`.
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.**
- **A manual clock races requests that register their sleeper later:** wait until the request is recorded before advancing.
- **Workers:**
  - a worker started after the first paint needs its npm deps in `optimizeDeps.include` (the backup worker's tweetnacl and noble are there already; add fflate's for 32c if the backup worker imports it);
  - never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`;
  - a self-starting worker needs its own idle wait before an old-engine walk navigates. **32c's start look-up and upload schedule are exactly that.**
- **Polyfill names to keep out of TV code:** members named `flags` or `at`; `lastIndexOf` on arrays, `concat`, `URL`; regex `.test`, `trim`, `parseInt`. These are fine in a file whose module already has them; probe with `artifacts/babel-polys30b2.ts <files>`, before and after.
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine);
  - physical CSS only, no CSS Grid or flex `gap`;
  - ES2017;
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs.
- **Web backend:**
  - `next build` typechecks e2e files;
  - `next start` locks `.next` (EBUSY);
  - Playwright's `webServer` starts before `globalSetup`;
  - `TaskStop` leaves `next start` running: kill the pid on its port;
  - node-postgres reads `timestamp` as local time: read rows through Prisma in tests.
- **Python on Windows writes CRLF in text mode:** write with `newline=''`.
- **Windows Smart App Control:** before every pnpm command, run `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI runs Node 22; this PC runs Node 24.**
- **A bare `sleep` is blocked in the foreground:** use `timeout N tail -f /dev/null` or an `until` loop.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 has needed none so far.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in CI (PR #129):**
  - verify: `pnpm e2e` 150 passed;
  - web: `e2e:web` 20 passed;
  - engines: all 126 runs as expected on Chromium 53, 56 and 68, 89 seeded failures caught; the backup worker 8/8 on each, its scrypt with IndexedDB 1.2 s on 53, 3.4 s on 56 and 0.2 s on 68;
  - media: passed.
- **Verified locally:**
  - lint; typecheck of the root and every package;
  - unit 6,380 (+93);
  - `build:tv`; an e2e sample of 37 passed;
  - `verify:engines --engine chrome53 --engine chrome68`: 22/22;
  - mutation `artifacts/mutate32b.py`: 94 written first, 89 caught, three test gaps closed, two equivalent: 92/92.
- **Not verified:**
  - anything on Vercel, R2 or Upstash (step 34: the R2 adapter must give `put`, `get` and `delete` for `backup/<lookupId>`);
  - a real TV: neither the DUID nor the LGUDID has yet been read by the app itself; the lab's S3 spike read the LGUDID on the LG TV in leg 34.
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **Decided this leg:** look for a backup first (see Status). The start's wait-or-switch and the look-up's time limit are 32c's own design calls: write the why in RELAY.md.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in the phone page's `connect-src`, and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets.
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`, run `pnpm exec vitest run packages/crypto/src/backup-code.test.ts packages/data/src/backup-service.test.ts packages/data/src/check-backup.test.ts`. Expect 72 passed.
2. `pnpm build:tv`, then `pnpm exec playwright test e2e/crypto-vectors.spec.ts`. Expect 1 passed. The page `dist/tv-vectors/index.html`, opened in Chrome, shows a third line, `backup worker: 8/8 passed`.

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
  - 55 in leg 100's (`git show e85772d:HANDOVER.md`). No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
