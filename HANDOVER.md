# Lablo IPTV: relay leg 107 opening prompt

You are leg 107 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–105 did steps 1–31, 32a, 32b and 32c (PRs #1–#131). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 106 (2026-11-18) split 32d and built 32d1, but stopped at the relay context check before verifying it fully and opening its PR.** Commit `6939eb7` on the relay branch (pushed). **No PR is open yet.**
  - **The split (RELAY.md 32d, "Split in leg 106", "Decided in leg 106"):** 32d1 = the proof (step 32's "Done when"); 32d2 = Settings' backup page (on/off, off deletes at once; the code in groups; a held backup's restore or replace); 32d3 = "Restore with a backup code" at the first start; 32d4 = "include login details" off (profile **v9**; 32e now takes **v10**).
  - **What 32d1 built** (RELAY.md 32d1 "The shape", "Built in leg 106"; architecture.md §3.3 B "Built in step 32d1"; runbooks web.md "The wipe restored from the real API", old-engines.md item 7's "Step 32's wipe" and the self-test row):
    - `e2e/backup-api.spec.ts` in `e2e:web`'s `tv` project (`playwright.web.config.ts` testMatch): the TV's dev app with `?device=` and the test front, `next start`. English (Xtream, then two favourites, a movie's place and a show's episode written into the stored profile from the gallery page) and Arabic (M3U link, guide link, Arabic name). Upload `GET 404, PUT 200`; the envelope opened in Node (`deriveBackupMaster(device, 'browser', appIdFor('webos'))`) equals the stored document; the ciphertext is no gzip stream and another device's key doesn't open it; `Backup` row = token hash + blob size; `leaks` over every request, every row, the blob; wipe; "Welcome back" with the document back; the live screen with no key; `GET 200`.
    - `tools/engines/src/backup-walk.ts` (+ `backup-walk.test.ts` 38 tests): `WEBOS_SIM_BRIDGE` (ES5 stand-in `PalmServiceBridge`: the LGUDID call answers `lablo-sim-lgudid-32d1`, everything else refused, URIs recorded in `window.__labloLuna`), `stageWebosSim(<variantDir>)` → `<variant>/webos-sim`, `simLookupId`, `backupSteps` (pairing steps + "Start watching"), `START_EXPRESSION`, `UPLOAD_EXPRESSION`, `restoredLanded`, `restoredFailures` (rail, header count, rows against the fixture), `evaluateBackupWalk(walk, lookupId, categories)`, `evaluateBackupRun(run, engine, categories)`, `backupSummary`.
    - `variants.ts`: screen `backup` in `APP_SCREENS`, `screenPlatforms` (backup on webOS only), `BACKUP_SEEDS` = `seed-backup-luna-refused`. `verify-engines.ts`: `runBackupScreen`, the simulated copies staged for each variant with the `backup` screen, the lookup ID computed once. `test/engines-backup.test.ts` (6): the bridge through the adapter's own `readLgudid`/`readAudioGuidance`, the luna URI, the titles, the start screen's attributes, the test hook's `uploadBackup`.
    - CI: `old-engines-report` uploads `artifacts/engines/backup-*.png`.
  - **Found by the first old-engine run:** on Chromium 53 the start probe took the boot's placeholder (a not-ready `data-testid="onboarding"` root) for onboarding; it now counts only `data-ready="true"`.

## Read first
1. **`RELAY.md`:** step 32 whole; **32d** ("Split in leg 106", "Decided in leg 106"), **32d1** (shape, "Built in leg 106", "Verified so far", **"Left for leg 107"**), 32d2–32d4, 32e; the progress log's rows 104–106.
2. **`docs/architecture.md` §3.3 B** (search `Built in step 32d1`).
3. **Code:** `tools/engines/src/backup-walk.ts`, `e2e/backup-api.spec.ts`, `artifacts/mutate32d1.py` (gitignored: the mutation list).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean apart from gitignored files; `git -C "<wt>" log --oneline -3` shows this handover's commit, then `6939eb7` (32d1 built) and `ca9b0fa`; `origin/main` is `e06d803`; no `*.mutbak` (`find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`); `docker ps` shows only `lablo-web-postgres-1`.
2. **Finish 32d1's verification** (RELAY.md 32d1 "Left for leg 107"):
   - `pnpm lint`, `pnpm exec tsc --noEmit -p tsconfig.json`, `pnpm --dir tools/engines exec tsc --noEmit -p tsconfig.json`, full `pnpm test` (about 40 s; 6,665 before the last harness tests, expect about 6,671);
   - `pnpm verify:engines --engine chrome53 --engine chrome68` once more **with `restoredFailures`** (added after the last engine run): 24 runs as expected, then look at `artifacts/engines/backup-chrome53-{en,ar}-{welcome,restored}.png`. No `build:tv` needed (no TV code changed; `dist/` is current from leg 105);
   - mutation: first add mutants for `restoredFailures` (its rail, count and rows lines; the wait predicate is CDP-only and stays out), run `python -I -u artifacts/mutate32d1.py --check`, then the run in chunks of about 30 (`--from`/`--to`) in the **foreground**; close gaps, take out dead code, update the docstring's findings;
   - `pnpm e2e:web --project=tv backup-api` was green twice (needs `pnpm build:web`; `.next` was built this leg from current apps/web).
3. **The PR:** branch `relay/iptv-20261101-214120` → `main` (it carries the docs commits too). CI runs web, verify, engines (now **132 runs, 92 seeded failures**: the new seed must fail on 53, 56 and 68), media. Merge on green (merge commit, keep the branch) with the three riskiest changes named. Then record: RELAY 32d1 ticked with "Done in leg …", architecture.md "Merged", progress-log row.
4. **Then 32d2** (Settings' backup page): write its shape in RELAY.md first. main.js has about 31 KB left of 500 (469.1 KB Tizen).
5. **Step 26's common items still apply** (unit tests; mutation with the list written first; the `pnpm verify` parts; `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker or the build changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; the PR merged on green CI; the docs and the merge recorded).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of `6939eb7` (32d1 built) and `ca9b0fa` (leg 105's handover).
- **`main`:** `e06d803` (Merge PR #131). No PR open. The main checkout was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next` (built this leg), `dist/` (leg 105's), `artifacts/`: `mutate32d1.py`, `build-web-32d1.log`, `e2e-web-32d1.log`, `engines-32d1.log` (second run, 24/24), `engines-32d1-first.log` (the run that found the placeholder bug), `unit-32d1.log`, `screenshots/backup-api-{welcome,live}-{en,ar}.png`, `engines/backup-chrome{53,68}-*.png`.

## Gotchas and lessons
**New in leg 106:**
- **The boot's placeholder is a not-ready onboarding root** (`<main data-testid="onboarding" data-ready="false">` in main.tsx and BackupStartApp.tsx): a probe that asks "is onboarding showing?" must require `data-ready="true"`. Chromium 68 was fast enough to hide this; 53 wasn't.
- **A gzip stream hides plaintext from a byte search** (Huffman-coded literals): "no plaintext" over a compressed payload proves nothing by itself; check it's sealed (not readable as gzip, another key doesn't open it).
- **Lint bans `window.PalmServiceBridge`/`window.webapis` outside the adapters, tests included:** name a vm realm's global object `page`, not `window`.
- **The e2e's own reads through the test front land in `front.forwarded`:** read straight from the API (with an `x-forwarded-for` of the test's own) when the front's log must hold only the TV's requests.
- **The real API's backup routes and CORS work for the dev app's origin** (preflight, `PUT`, `GET`) on the first try.
- **The relay context check fires at about 450k tokens:** an engine run is about 15 minutes; plan a step's verification so the PR goes up well before.

**From earlier legs (still true):**
- **CI front:** a PR touching `packages/protocol`, the TV or the engines runs every job (web, verify, engines, media). Never push to a PR while its CI runs.
- **Known CI flakes,** rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `epg-declared-300mb` (media); media's 30-minute cap after slow installs; `auto-next.spec.ts` ar-SA `endEpisode`; Chromium 53/56 DevTools start-up. No `jq`: use `gh --jq`.
- **The CI wait that worked:** `timeout 25 tail -f /dev/null`, read `gh pr checks`, then the Monitor tool with a 45 s poll loop printing each job as it ends and `ALL DONE`.
- **The e2e driver reads the drawn focus from `#app > [data-screen]`** (`data-zone`, `data-index`); a new full-screen root needs all three.
- **The upload schedule runs in every test that stays 60 s on the live screen,** and at once when hidden; a test that deletes the database waits for `configIdle() && backupIdle()`, then goes to `/?screen=gallery` and deletes `lablo`.
- **Bash heredoc Python with apostrophes, backslashes or `\u` fails or mangles:** write patch scripts to `$CLAUDE_JOB_DIR/tmp` with the Write tool and run them; `python -I`.
- **A constant from `@lablo/protocol`'s index pulls zod into a worker:** use `@lablo/protocol/backup-limits`.
- **Per-module worker sizes:** temporarily `export` `plugins` in `tools/build/src/bundle.ts`, bundle from a `tools/build/src/zz-*.ts` script, sort `renderedLength`, revert.
- **Incompressible test data comes from a SHA-256 stream.** A stand-in that answers any origin hides a changed base: record the URLs.
- **crypto's `src/*.test.ts` compile at ES2017:** no BigInt literals.
- **Mutation lessons:** writing the list first finds dead code (take it out); a stand-in CSPRNG must be non-symmetric; storage keys and limits used only through constants need pinned literals; a check that only expects the cleared state is vacuous.
- **A database test with a pinned clock must not use Postgres's `now()`.** A route's own deps need a test through the route file.
- **Chromium 53 drops a `MessagePort` message whose transfer list holds an `ArrayBuffer`:** copy instead.
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`; grep `v: N\b` (32d4 takes v9).
- **A reaped background run is never restarted unasked.** Run unit, e2e and mutation in the foreground; `verify:engines` in the background with a wait on its log's `exit` line.
- **`bytes[i] ^= 1` fails typecheck:** `bytes[i] = bytes[i]! ^ 1`. `transact(...)` infers `void`: `transact<unknown>`. **`git mv` stages at once:** `git diff --cached --name-only` before every commit. **TS 5.7+:** `Uint8Array<ArrayBuffer>` for `BodyInit`/`BlobPart`.
- **A TV build takes `?api=` only for loopback;** old-engine walks forward a container port with `forwardToHost`. **The real `GET /v1/config` answers `max-age=300`:** a test's config goes in before the TV's first request. **Root e2e specs have no `pg` types:** `createRequire(path.join(WEB, 'package.json'))('pg')`.
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`. A restore is not a new way to add.
- **A component with a hook can't be called as a function in a VNode test:** split it. **i18n arguments are isolated in English too:** `stripIsolates`. **Plain `pnpm e2e` never reaches `data-state="playing"`.** **`DataEngine`'s refreshes claim the slot before any `await`.**
- **Workers:** a post-paint worker's npm deps go in `optimizeDeps.include`; never open the app's IndexedDB from a test page before onboarding's `data-ready="true"`; a self-starting worker needs its own idle wait before an old-engine walk navigates.
- **TV code rules:** no `Array.prototype.sort` in main; in new TV files none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread; members named `flags`/`at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt` pull polyfills (probe with `artifacts/babel-polys30b2.ts`); physical CSS only, no Grid or flex `gap`; ES2017; `packages/ui` hook-free; UI text only from the catalogs.
- **Web backend:** `next build` typechecks e2e files; `next start` locks `.next`; Playwright's `webServer` starts before `globalSetup`; `TaskStop` leaves `next start` running; node-postgres reads `timestamp` as local time.
- **Python on Windows writes CRLF in text mode:** `newline=''`.
- **Smart App Control:** before every pnpm command `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **CI runs Node 22; this PC Node 24.** A bare `sleep` is blocked in the foreground: `timeout N tail -f /dev/null`. **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 needs none.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally in leg 106:** `e2e:web --project=tv backup-api` 2 passed (twice; screenshots looked at); `verify:engines --engine chrome53 --engine chrome68` 24/24 (the backup walk: 53 "Welcome back" 1.3 s, live 7.5 s; 68 0.3 s, 6.2 s; screenshots looked at) **before `restoredFailures` was added**; the harness's tests 80/80 after it; typecheck (root, tools/engines) and lint of the changed files; full unit 6,665 before the last harness tests.
- **Not verified yet:** the engine run with `restoredFailures`; full lint; full unit after the last changes; mutation; CI (incl. Chromium 56 and the new seed); the merge.
- **Not verified anywhere:** Vercel/R2/Upstash (step 34); a real TV reading its own DUID or LGUDID through the app.
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32d2–32d4's design calls are the legs' own** (the split's decisions are in RELAY.md). Write the why in RELAY.md.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets.
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (nothing merged this leg)
1. After leg 107 merges 32d1: `pnpm build:web && pnpm e2e:web --project=tv backup-api` (2 passed; screenshots in `artifacts/screenshots/backup-api-*.png`).
2. `pnpm verify:engines --engine chrome53`: the line `app webos backup PASS`, and `artifacts/engines/backup-chrome53-ar-welcome.png` shows "مرحبًا بعودتك" right to left.

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
