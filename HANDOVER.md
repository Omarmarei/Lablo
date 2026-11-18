# Lablo IPTV: relay leg 106 opening prompt

You are leg 106 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–104 did steps 1–31, 32a, 32b and 32c1 (PRs #1–#130). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 105 (2026-11-18) built 32c2 and ticked 32c: PR #131, merge commit `e06d803`,** green on the first CI run (web 2 m 5 s; verify 14 m: unit 6,620 + 1 skipped, `pnpm e2e` 154 passed; engines 22 m 28 s: 126 runs as expected, 89 seeded failures caught, backup worker 11/11 on 53, 56, 68; media 24 m 36 s).
  - **Decided in leg 105 (RELAY.md 32c2, "Decided in leg 105"):**
    - the start **waits** for the look-up behind "Looking for your backup" (scrypt's progress bar, "Skip"; Back skips too), with a **30 s** limit (`LOOKUP_LIMIT_MS`);
    - **however the look-up ends, the profile is read again:** one with a source is a restore;
    - **"Welcome back"** shows for 5 s (`WELCOME_MS`) or until OK, in the restored profile's language;
    - **after a restore the last channel doesn't play by itself**, and the refresh schedule's first check comes at once (`start(0)`);
    - **the upload schedule counts its own start as a change** (the worker answers `same` when nothing changed).
  - **What 32c2 built** (architecture.md §3.3 B "Built in step 32c2"):
    - `apps/tv/src/backup/lookup-request.ts` (`lookupRequest`: the one device-ID read with no consent; `lookup-request.test.ts` scans the app so only `main.tsx`'s `startWithoutProfile` calls it, and `deviceSecret` is called only by `readDeviceSecret` in `backup-request.ts`);
    - `backup-start.ts` (`createBackupStart`: its own navigator, screens `looking` and `welcome`) and `BackupStartApp.tsx` (`BackupStartView` is hook-free for VNode tests);
    - `backup-schedule.ts` (`createBackupSchedule`: 60 s after the first unsent change, at least 5 minutes between run starts, at once when hidden with at most `HIDDEN_RUNS` = 2 per hide and none after a failure; `held` ends runs for the session and is a signal for 32d; `stop`/`start` for the gate's `disable-app`);
    - `main.tsx`: `startWith(into, profile, restored)` and `startWithoutProfile(into)`; the module-level `backup` schedule; `BACKUP_BUILD`;
    - `DataEngineOptions.onProfileChanged` (an `editProfile` that changed it, a committed catalog refresh);
    - the test hook's `backupIdle()` and `uploadBackup()`; `e2e/lablo-test.d.ts` and `env.d.ts`;
    - the sources screen: a file source with no catalog says "Not loaded yet: send this file again from your phone." (`sources.fileAgain`);
    - the consent text says "find and encrypt" (en, ar); new catalog keys `backup.*`;
    - `packages/platform-browser`: `?device=<id>` gives a device ID (tests only);
    - `tools/engines/src/backup-stand-in.ts` (`BackupStandIn`, `answerBackup`, `backupPath`): the backup routes over HTTP with the 32a rules and a `holdGets()`; answered by `startPairServer` (`server.backup`) and `e2e/config-server.ts` (`server.backup`);
    - the walk's idle probe `CONFIG_IDLE` also waits for `backupIdle()`; the seeded variant keeps it;
    - `e2e/backup.spec.ts` (4 tests: wipe and restore in en and ar, Skip, no device ID).
  - **Sizes:** main.js's own code **469.1 KB (Tizen) and 456.4 KB (webOS) of 500** (+9.6 KB): about 31 KB left for 32d and 33. Workers unchanged (backup worker 131.2 of 150).

## Read first
1. **`RELAY.md`:** step 32 whole ("Decided in leg 102", "Decided by Omar"); 32c ("Decided in leg 104"); **32c2** (its shape, "Decided in leg 105", "Built", "Verified", "Done"); **32d** and **32e**; the progress log's last rows (103–105).
2. **`docs/architecture.md`:** §3.3 B (search `**B. Backup`), with "Built in step 32b", "Built in step 32c1" and **"Built in step 32c2"**; the first-run list (search "Device-ID consent").
3. **Code for 32d:**
   - `apps/tv/src/backup/` (all of it: the schedule's `held` signal, `backupRequest`, `consentOf`);
   - `apps/tv/src/settings/` (`settings-state.ts`, `SettingsScreen.tsx`, the sources screen as the pattern for a new Settings page);
   - `packages/data/src/backup-service.ts` (`prepare` makes and keeps the backup code; `restore` takes the device ID only: 32d's typed code needs its own path), `packages/crypto/src/backup-code.ts` (`backupCodeText`, `readBackupCode`);
   - `packages/data/src/profile.ts` (a profile version bump for "include login details" off: grep `v: N\b` for every pin);
   - `apps/web/e2e/` and `playwright.web.config.ts` (`e2e:web`'s `tv` project, for the wipe e2e against the real API);
   - `tools/engines/src/onboarding.ts`, `pairing.ts`, `pair-server.ts` (the old-engine walk with a wipe; the harness's TV builds give **no device ID**, so the walk needs a backup code path or a test device ID).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.
5. **Memory:** iptv-ui-test-gotchas (leg 105 note: a new full-screen root needs `data-screen`, `data-zone`, `data-index` for the e2e's driver), iptv-old-engine-walk, iptv-tv-bundle-polyfills, iptv-data-layer-test-gotchas, iptv-parser-test-patterns.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `11da99c` (PR #131's merge recorded) and `0b8f5da`;
   - `origin/main` is `e06d803`;
   - no `*.mutbak`: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (10.7 to 11.1 GB free virtual in leg 105). Run unit, e2e and mutation in the **foreground**; the Bash tool caps a call at 10 minutes, so run `pnpm exec playwright test --project=chromium --shard=N/3` (about 1 minute each) and `--project=throttled --no-deps` (2.6 minutes), and mutation in chunks of about 30.
3. **Step 32d: probably split first** (it is larger than one leg). A split that fits: **32d1** = Settings' backup page (on/off, off deletes the server's copy; "include login details" with its stripped envelope and profile version bump; the backup code shown in groups; `held`'s "restore or replace"), **32d2** = the first-run "Restore with a backup code" screen and its restore path in the worker, the wipe e2e against the real API (`e2e:web` `tv` project), the old-engine walk with a wipe on Chromium 53 and 68, screenshots in en and ar. Write the split and the shape in RELAY.md first, as 32c1 and 32c2 did.
4. **Then 32e** (logins at rest under `localKey`; first read architecture.md's 32e note).
5. **Step 26's common items still apply to every step:** unit tests; mutation with the list written first (`artifacts/mutate32c2.py` is the newest template: `--check`, `--from`, `--to`); the `pnpm verify` parts; `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker or the build changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; the PR merged on green CI; the docs and the merge recorded (RELAY tick, "Done in leg …", progress-log row, architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of `11da99c` (PR #131's merge recorded) and `0b8f5da` (32c2's docs).
- **`main`:** `e06d803` (Merge PR #131). The relay branch is ahead of main only by docs commits; they go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:** `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`; `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`; `dist/` (built in leg 105 from 32c2's source); `artifacts/`: `mutate32c2.py`, `mutate32c2-{a,a2,b,c,d}.log`, `build-tv-32c2.log`, `engines-32c2.log`, `unit-32c2.log`, `lint-32c2.log`, `e2e-32c2-{1,2,3,throttled}.log`, `screenshots/backup-*.png`, and earlier legs' files.
- **The `lablo-web-postgres-1` container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container, `zz-*` script or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 105:**
- **The e2e's `RemoteDriver.expectFocus` reads the drawn focus from `#app > [data-screen]`'s `data-zone` and `data-index`.** A new full-screen root (like `backup-start`) needs all three, or the driver sees `screen/null/null`.
- **Writing the mutation list first found 13 pieces of dead code this time** (guards another guard already covered, a `Math.min` whose first argument is always smaller, a `settled` flag a promise makes redundant, a check `tokenHash` already does). Take them out of the code, don't pin them.
- **The upload schedule now runs in every test that stays 60 s on the live screen,** and at once when the page is hidden. With no `?api=` it fetches the dev base `127.0.0.1:3100` (refused locally and in CI's verify job) and logs a warning; the browser has no device ID, so its first run derives a backup code (scrypt) in a worker. It went unnoticed in all 154 e2e tests and on the old engines, but a new test that deletes the database must wait for `backupIdle()` first.
- **An e2e wipe:** wait for `configIdle() && backupIdle()`, go to `/?screen=gallery` (it starts no data worker), then `indexedDB.deleteDatabase('lablo')` answers `ok`.
- **Bash heredoc Python with apostrophes after `&&` failed to parse** ("unexpected EOF while looking for matching `''"). Write patch scripts to `$CLAUDE_JOB_DIR/tmp` with the Write tool and run them.
- **The Write tool turned a backslash-u escape in a test title into the raw character** (memory already says so): harmless in a title, but never in code.
- **After a usage-limit reset the Bash tool's working directory may be the main checkout:** always use the worktree's absolute path.
- **CI timings this leg:** verify 14 m, engines 22 m 28 s, media 24 m 36 s; the `epg-declared-300mb` flake didn't recur.

**From earlier legs (still true):**
- **The CI front:** a PR that touches `packages/protocol`, the TV or the engines runs every CI job (web, verify, engines, media). Never push to a PR while its CI runs.
- **Known CI flakes,** each rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `epg-declared-300mb` (media); media's 30-minute cap after slow installs; `auto-next.spec.ts` ar-SA `endEpisode`; Chromium 53/56 DevTools start-up. No `jq`: use `gh --jq`.
- **The CI wait that worked:** `timeout 25 tail -f /dev/null`, read `gh pr checks`, then the Monitor tool with a 45 s poll loop printing each job as it ends and `ALL DONE`.
- **A constant from `@lablo/protocol`'s index pulls zod into a worker:** use a schema-free subpath (`@lablo/protocol/backup-limits`).
- **Per-module worker sizes:** temporarily `export` `plugins` in `tools/build/src/bundle.ts`, bundle from a `tools/build/src/zz-*.ts` script, sort `renderedLength`, then revert and delete.
- **Incompressible test data comes from a SHA-256 stream, not an LCG.** A stand-in that answers any origin hides a changed base: record the URLs.
- **crypto's `src/*.test.ts` compile at ES2017:** no BigInt literals there.
- **The old-engine proof of a worker that needs IndexedDB is a shared check entry** (`@lablo/data/check-backup`); the harness keeps its own copy of the names (`BACKUP_CHECKS`, 11).
- **Mutation lessons:** a stand-in CSPRNG must be non-symmetric; storage keys and limits used only through constants need pinned literals; a test helper's default can't take `undefined` to mean "none"; a check that only ever expects the cleared state is vacuous (hold the request that ends it).
- **A database test with a pinned clock must not use Postgres's `now()`.** A route's own dependencies need a test through the route file.
- **`pnpm e2e:web`** is 20 tests; `pnpm e2e` is now 154. Mutants of `apps/web` that only an e2e catches need `pnpm build:web && …`.
- **Chromium 53 drops a `MessagePort` message whose transfer list holds an `ArrayBuffer`:** copy instead.
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`. Grep `v: N\b`.
- **A reaped background run is never restarted unasked.**
- **`bytes[i] ^= 1` fails typecheck:** write `bytes[i] = bytes[i]! ^ 1`. `transact(...)` infers `void`: write `transact<unknown>`.
- **`git mv` stages the rename at once:** run `git diff --cached --name-only` before every commit.
- **TS 5.7+:** type byte helpers `Uint8Array<ArrayBuffer>` for `BodyInit` and `BlobPart`.
- **A TV build takes `?api=` only for loopback hosts;** old-engine walks forward a container port with `forwardToHost`.
- **The real `GET /v1/config` answers `private, max-age=300`:** a test's own config goes in before the TV's first request.
- **Root e2e specs have no `pg` types:** `createRequire(path.join(WEB, 'package.json'))('pg')`.
- **New ways in go through the gates:** any new way to play goes through `PlayerController.play`; any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`. A restore is not a new way to add (leg 104).
- **A component with a hook can't be called as a function in a VNode test:** split it (`BackupStartView` is the newest example).
- **i18n arguments are isolated in English too:** compare with `stripIsolates`.
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`:** check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.**
- **Workers:** a worker started after the first paint needs its npm deps in `optimizeDeps.include`; never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`; a self-starting worker needs its own idle wait before an old-engine walk navigates.
- **Polyfill names to keep out of TV code:** members named `flags` or `at`; `lastIndexOf` on arrays, `concat`, `URL`; regex `.test`, `trim`, `parseInt`. Probe with `artifacts/babel-polys30b2.ts <files>`.
- **TV code rules:** no `Array.prototype.sort` in the main bundle; in new TV files none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine); physical CSS only, no CSS Grid or flex `gap`; ES2017; `packages/ui` components stay hook-free; UI text only from the catalogs.
- **Web backend:** `next build` typechecks e2e files; `next start` locks `.next`; Playwright's `webServer` starts before `globalSetup`; `TaskStop` leaves `next start` running; node-postgres reads `timestamp` as local time.
- **Python on Windows writes CRLF in text mode:** write with `newline=''`.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path). Never delete files in `node_modules`.
- **CI runs Node 22; this PC runs Node 24.** A bare `sleep` is blocked in the foreground: use `timeout N tail -f /dev/null`.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 has needed none so far.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in CI (PR #131):** verify (unit 6,620 + 1 skipped; `pnpm e2e` 154 passed), web, engines (126 runs as expected on 53, 56, 68; backup worker 11/11 on each), media.
- **Verified locally:** lint; typecheck; unit 6,621; `build:tv`; `pnpm e2e` 154 in shards; `verify:engines --engine chrome53 --engine chrome68` 22/22; mutation 135/135; the screenshots `artifacts/screenshots/backup-{looking,welcome,restored-live}-{en,ar}.png` looked at.
- **Not verified:**
  - the look-up and the restore against the real API (32d's wipe e2e on `e2e:web`);
  - a wipe on the old engines (32d);
  - anything on Vercel, R2 or Upstash (step 34);
  - a real TV reading its own DUID or LGUDID through the app.
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32d's design calls are the leg's own:** the split, the Settings layout, whether "backup off" deletes at once or at the next run, the profile version for "include login details" off. Write the why in RELAY.md.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets.
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`, run `pnpm exec vitest run apps/tv/src/backup tools/engines/src/backup-stand-in.test.ts`. Expect 60 passed.
2. `pnpm exec playwright test e2e/backup.spec.ts`. Expect 4 passed; the screenshots land in `artifacts/screenshots/backup-*.png`.
3. In the dev app (`pnpm dev`), open `/?device=my-tv&api=<a server answering /v1/backup>` with a fresh browser profile to see "Looking for your backup"; without `?device=` onboarding starts at once.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`) and read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word: 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`); 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`); 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`); 55 in leg 100's (`git show e85772d:HANDOVER.md`). No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
