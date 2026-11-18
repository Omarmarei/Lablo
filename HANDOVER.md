# Lablo IPTV: relay leg 103 opening prompt

You are leg 103 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–101 did steps 1–31 (PRs #1–#127). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 102 (2026-11-18) split step 32 (Backup) and built its first part:**
  - **The split, in RELAY.md under step 32:** 32a (the API), 32b (the TV's device secret, master key and derived keys), 32c (the envelope's content, the upload schedule, the restore at startup), 32d (Settings, the backup code's screens, the wipe e2e and the old-engine walk: step 32's own "Done when"), 32e (logins at rest under `localKey`).
  - **The decisions, each with its why, in RELAY.md ("Decided in leg 102"):**
    - the envelope passes through the API and lives in the blob store at `backup/<lookupId>`;
    - a get needs no token and no database;
    - the first put claims a lookup ID for its write token;
    - no migration (step 29a's `Backup` table has every column);
    - retention is the API's own sweep at 180 days;
    - a phone-sent file is not in the backup: a restored file source comes back by name and asks to be sent again;
    - the envelope's plaintext is the whole profile document, gzipped; with "include login details" off, sources go without their login or link;
    - the backup code is 128 random bits shown as 26 Crockford characters, typed back on a first-run "Restore with a backup code" screen;
    - logins at rest under `localKey` come last (32e).
  - **32a: PR #128, merge commit `88ca620`**, green on the first CI run.
    - `apps/web/src/server/backup.ts`: `putBackup`, `getBackup`, `deleteBackup`, `sweepBackups`, `backupRoute`, `BACKUP_LIMITS` (30 reads and 30 writes per address in 10 minutes).
    - `apps/web/src/app/v1/backup/[lookupId]/route.ts`: `PUT`, `GET`, `DELETE`, `OPTIONS`.
    - `preflight(methods, headers?)` in `http.ts` takes a route's own allowed headers.
    - `@lablo/protocol` exports `BACKUP_WRITE_HEADER` (`x-write-token`).
    - Tests: `apps/web/test/backup.web.test.ts` (27, against Postgres) and `apps/web/e2e/backup.spec.ts` (one, over HTTP against `next start`, in the `phone` project).
    - Mutation `artifacts/mutate32a.py`: 76/76 (74 on the first run; two test gaps closed).
  - **Recorded:** RELAY.md ticks 32a with "Built/Verified/Done in leg 102" lines and a leg-102 progress-log row; architecture.md §3.2 has "Built in step 32a" with its "Merged" line; runbook `web.md` has "The backup (step 32a)".

## Read first
1. **`RELAY.md`:** step 32 whole (the split, "Decided in leg 102", the open question for Omar, 32a as the pattern, **32b**, then 32c–32e), and the progress log's last rows (100–102).
2. **`docs/architecture.md`:**
   - **§3.3 B "Backup"** (search for `**B. Backup`): deviceSecret, master, lookupId, writeToken, encKey/localKey, the envelope;
   - §3.2 "Built in step 32a" and "Built in step 29b1" (the crypto: `backupSalt`, `deriveBackupMaster`, `backupKeys`, `tokenHash`, `sealBackup`/`openBackup`, and scrypt's times on the old engines);
   - the first-run list (search "Device-ID consent");
   - S3 (device IDs).
3. **Code for 32b:**
   - `packages/platform-api/src/index.ts`: `Platform.deviceSecret()` already exists (step 15a) on Tizen (`webapis.productinfo.getDuid`), webOS (`readLgudid` through luna, already in `LUNA_ACG` as `deviceinfo.query`) and the browser (`null`);
   - `packages/crypto/src/backup.ts`;
   - `packages/data/src/profile.ts`: `consent: boolean | null` ("Step 32 reads it");
   - `packages/data/src/schema.ts`: the `kv` store (small cached documents);
   - `packages/data/src/pair.worker.ts` and `config.worker.ts` as worker patterns; `apps/tv/src/data/engine.ts`.
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.
5. **Memory:** iptv-crypto-gotchas (scrypt 2^15 takes about 1 s on Chromium 53 and 3 s on 56; crypto's `sideEffects: false`), iptv-webos-acg, iptv-tv-bundle-polyfills, iptv-data-layer-test-gotchas, iptv-web-backend-gotchas.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `0b781d4` (PR #128's merge recorded), `88ca620` (the merge) and `003b01d` (32a);
   - no `*.mutbak`: `find apps packages tools e2e test -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). Run unit, e2e and mutation in the **foreground**: only background shells get reaped while idle. Nothing was reaped in leg 102.
3. **Step 32b (the TV's backup keys).** Write its shape in RELAY.md before building, as 32a has. What it must settle:
   - **Which secret:** `Platform.deviceSecret()` only when the profile's `consent` is `true`; else the backup code (128 random bits from `@lablo/crypto`'s `randomBytes`, kept in IndexedDB `kv`, made at first need, read back unchanged). The source that was used should be kept beside the cached master, so a later change of consent derives again.
   - **Where scrypt runs:** a worker, by measured size. main.js is at 458.7 KB of 500 (Tizen) with about 41 KB left for steps 32 and 33. Workers: ingest 131.9, pair 137.3, config 133.9, query 129.6 KB of 150. The config worker already holds noble (the config's signature check); measure scrypt there first, and a worker of its own second. Record the sizes.
   - **The cache:** the master in IndexedDB `kv`, so scrypt runs once (1 s on Chromium 53, 3 s on 56); `backupKeys(master)` each start.
   - **The salt's inputs:** `platform` and `appId` (`com.lablo.*` ids; the Tizen id is `LabloIPTV1`): find where the build gives the app id to the TV code.
   - **Tests:** unit; the worker bundle in the Chromium 53 realm (`test/*-worker-bundle.test.ts` are the patterns); `build:tv` sizes; `verify:engines --engine chrome53 --engine chrome68`; mutation with the list written first.
4. **Then 32c** needs Omar's answer to the question below. If he hasn't answered when 32b is merged, end that leg as needs-you with the question as a numbered list.
5. **Step 26's common items still apply to every step:**
   - unit tests;
   - mutation with the list written first (`artifacts/mutate32a.py` is the newest template; it has `--check`, `--from` and `--to`);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page, a worker or the build changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - the PR merged on green CI;
   - the docs, and the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of `0b781d4` (PR #128's merge recorded; 32a ticked; the question for Omar), `88ca620` (Merge PR #128) and `003b01d` (32a).
- **`main`:** `88ca620`. The relay branch is ahead of main only by `0b781d4` and this handover; both go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`;
  - `apps/web/.next`, built from 32a's final source;
  - `dist/`, built in leg 102 from 32a's source (`build:tv`);
  - `artifacts/`: `mutate32a.py` and `.log`, `lint-32a.log`, `unit-32a.log`, `test-web-32a.log`, `build-web-32a.log`, `e2e-web-32a.log`, `build-tv-32a.log`, and earlier legs' files.
- **The `lablo-web-postgres-1` container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 102:**
- **A database test with a pinned clock must not use Postgres's `now()`:** the test's clock was 180 days ahead, so a row "updated now" was still old. Pass a date as a parameter.
- **A quote escaped with a backslash inside heredoc Python lost its backslash** and broke the patched file. For any patch with a backslash, use the Edit tool.
- **Backup tests alone:** `pnpm exec vitest run -c vitest.web.config.ts apps/web/test/backup.web.test.ts` takes about 3 s (the global setup still migrates `lablo_test`), so 76 mutants ran in about 5 minutes in the foreground.
- **A test that builds its expected value with the same helper as the code is vacuous for that helper** (`backupBlobKey` survived a changed prefix): pin one literal.
- **A route's own dependencies need a test through the route:** the handlers' tests inject a clock and a rate secret, so a mutant in `backupDeps` survived until the route test checked the row's date against the real clock and the limiter's key against `services().rateSecret`.
- **`apps/web/e2e/*.spec.ts` can be API-only:** Playwright's `request` fixture with the `address` fixture for `x-forwarded-for`, and `sql()` (it returns the row count).
- **A PR that touches `packages/protocol` runs every CI job:** web 2.5 minutes, verify 12, engines 20, media 26.
- **The CI wait:** the Monitor tool with a poll loop over `gh pr checks <n> --json name,bucket --jq …` reported each job and ended by itself; read the whole table once more before merging (`media` finished last).

**From earlier legs (still true):**
- **A check that only ever expects the cleared state is vacuous:** hold the request that ends the state (`front.hold(...)`) and assert the set value too.
- **The test front (`e2e/api-front.ts`)** has `forwarded`, `received`, `hold` and `serve`.
- **`pnpm e2e:web`** is 20 tests, about 25 s locally and 60 s on CI. Its `tv` project takes `pairing-api` and `no-plaintext`; `pnpm e2e` (150) ignores them. `--project=phone <filter>` (the flag is variadic).
- **Mutants of `apps/web` source that only an e2e catches** need `pnpm build:web && …`, and a clean `pnpm build:web` after the run.
- **Chromium 53 drops a `MessagePort` message whose transfer list holds an `ArrayBuffer`:** in TV code, never pass a transfer list to a port's `postMessage`; copy. Probe old-engine behaviour with a staged ES5 page (`artifacts/repro-run.ts`).
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`. Grep `v: N\b`; the "current + 1" pins move too.
- **A reaped background run is never restarted unasked.** In the foreground: `tsc --noEmit -p` per changed package; `pnpm exec vitest run --maxWorkers=3` (the whole suite, about 65 s); mutation in chunks under the tool's 10 minutes.
- **Heredocs:** never put a backslash-u escape in heredoc Python (a SyntaxError) or in Write content (it gets decoded: use `String.fromCharCode`).
- **`bytes[i] ^= 1` passes vitest but fails typecheck:** write `bytes[i] = bytes[i]! ^ 1`.
- **`git mv` stages the rename at once:** run `git diff --cached --name-only` before every commit.
- **vitest's `toEqual` on megabyte `Uint8Array`s is slow:** compare with `Buffer.from(a).equals(Buffer.from(b))`, or `===` on strings.
- **TS 5.7+:** type byte helpers `Uint8Array<ArrayBuffer>` for `BodyInit`/`BlobPart`.
- **A refusal sample must break exactly one rule.**
- **A TV build takes `?api=` only for loopback hosts;** old-engine walks forward a container port with `forwardToHost`.
- **The real `GET /v1/config` answers `private, max-age=300`:** a test's own config goes in before the TV's first request.
- **Root e2e specs have no `pg` types:** use `createRequire(path.join(WEB, 'package.json'))('pg')`.
- **New ways in go through the gates:** any new way to play goes through `PlayerController.play`; any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`. A restore's re-ingest is a new way to add sources.
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component.
- **i18n arguments are isolated in English too:** compare with `stripIsolates` (TV) or strip FSI/PDI (phone page).
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.**
- **A manual clock races requests that register their sleeper later:** wait until the request is recorded before advancing.
- **Workers:** a worker started after the first paint needs its npm deps in `optimizeDeps.include`. Never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`. A self-starting worker needs its own idle wait before an old-engine walk navigates.
- **Polyfill names to keep out of TV code:** members named `flags` or `at`; `lastIndexOf` on arrays, `concat`, `URL`; regex `.test`, `trim`, `parseInt` (fine in a file whose module already has them: probe with `artifacts/babel-polys30b2.ts <files>`, before and after).
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine);
  - physical CSS only, no CSS Grid or flex `gap`;
  - ES2017;
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs.
- **Web backend:** `next build` typechecks e2e files; `next start` locks `.next` (EBUSY); Playwright's `webServer` starts before `globalSetup`; `TaskStop` leaves `next start` running (kill the pid on its port); node-postgres reads `timestamp` as local time (read rows through Prisma in tests).
- **Python on Windows writes CRLF in text mode:** write with `newline=''`.
- **Windows Smart App Control:** before every pnpm command, run `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI:** Node 22 there, Node 24 here.
  - **Known flakes**, each rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `epg-declared-300mb` (media); media's 30-minute cap after slow installs; `auto-next.spec.ts` ar-SA `endEpisode`; Chromium 53/56 DevTools start-up.
  - No `jq`: use `gh --jq`. A whole run's log (`gh run view R --log`) is readable only once the run completes. Never push to a PR while its CI runs.
- **A bare `sleep` is blocked in the foreground:** use `timeout N tail -f /dev/null` or an `until` loop.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 has needed none so far.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in CI (PR #128):** web (`test:web` 72, `e2e:web` 20); verify (`pnpm e2e` 150); engines (all 126 runs as expected on Chromium 53, 56 and 68; 89 seeded failures caught); media.
- **Verified locally:** lint; typecheck of the root, `apps/web` and `packages/protocol`; unit 6,287; `test:web` 72; `build:web`; `e2e:web` 20; `build:tv` (sizes unchanged); mutation 76/76.
- **Not run locally:** `verify:engines` (no TV code changed; CI ran it).
- **Not verified:** anything on Vercel, R2 or Upstash (step 34: the R2 adapter must give `put`, `get` and `delete` for `backup/<lookupId>`, not only presigned URLs); a real TV.
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **For Omar, before 32c (written in RELAY.md under step 32):** after a wipe the profile is gone, and the consent answer with it. The design wants a restore with no user action; the consent screen says the device ID is read only after "Allow".
  1. **Look for a backup first (recommended):** at a start with no profile the TV reads its ID, derives the keys and asks the API once. A backup found means this TV's owner allowed it before; it restores at once. None found: nothing is kept and onboarding asks as now. The consent and privacy text would say "to find and encrypt your backup".
  2. **Ask first:** language, disclaimer and "Allow" again after every wipe, then the restore.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets.
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`: `pnpm web:db`, then `pnpm test:web`. Expect 72 passed, 27 of them in `backup.web.test.ts`.
2. `pnpm build:web`, then `pnpm e2e:web --project=phone backup`. Expect 1 passed: a scripted TV puts its encrypted backup, gets it back and opens it, is refused with another TV's token, and deletes it.

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
