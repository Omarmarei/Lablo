# Lablo IPTV: relay leg 108 opening prompt

You are leg 108 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–106 did steps 1–31, 32a, 32b, 32c and built 32d1 (PRs #1–#131). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 107 (2026-11-18) finished 32d1 and did 32d2a; both merged.**
  - **32d1 (step 32's own "Done when": a simulated webOS wipe restores automatically) — PR #132, merge commit `7c54639`.** The first CI run found two bugs: (1) CI's Chromium 53 painted the Arabic "Welcome back" in English for a frame: `BackupStartApp` switched language in an effect after an async `platform.info()`. It now reads the TV's locale once, works out the locale while drawing (`startLocale(tv, picked)`, exported and unit-tested) and sets `<html lang dir>` and the nav's direction in a `useLayoutEffect`. (2) `e2e/backup-api.spec.ts` was also picked up by the plain `pnpm e2e` (no API there: `GET 0`); it is now in `playwright.config.ts`'s chromium `testIgnore` with `pairing-api` and `no-plaintext`. Mutation `artifacts/mutate32d1.py` 95/95. CI: 132 engine runs, 92 seeded failures; the backup walk passes on 53, 56 and 68.
  - **32d2 split in leg 107** into **32d2a** (the worker; done) and **32d2b** (the page; next). The decisions and why are in RELAY.md 32d2 "Decided in leg 107".
  - **32d2a — PR #133, merge commit `c8f8c53`, green on the first run.** `packages/data/src/backup-service.ts`: `status(request)` → `{on, source, code, sentAt, deleting}` (the code only while on and the code is the secret; made and kept then; derives nothing); `setEnabled({…request, on})` (off: `kv` `backup.off = true` first, then every copy this TV wrote plus the one under the request's own lookup ID deleted with their tokens; what fails stays in `backup.sent` as `{lookupId: '', token: '', hash: '', old: left, sentAt: null}`; each later `upload` retries it and answers `{state: 'off'}` with no GET/PUT and no key derived; on: the flag removed, and a copy of its own lookup ID still pending delete is written over without the GET); `restoreHeld(request)` (the shared `fetch`, then `putProfileOver` in one transaction with the send record; the replaced profile becomes a `restore` snapshot; a newer app's profile is never written over: `kept`); `replaceHeld(request)` (an upload without the GET); `SentRecord.sentAt` (kept over a claim and an unchanged upload; old records read as `null`). `profile.ts`'s `putProfileOver`. `check-backup.ts`: 16 checks now (`backup.held`, `backup.restoreHeld`, `backup.replaceHeld`, `backup.off`, `backup.on`; `otherProfile()`). `DataEngine`: `backupStatus`, `setBackup`, `restoreHeldBackup`, `replaceHeldBackup`. The upload schedule settles `off` as it does `none` (no code change, comment only). Nothing in the app calls the new calls yet. Mutation `artifacts/mutate32d2a.py` 67/67.

## Read first
1. **`RELAY.md`:** step 32 whole; **32d2** ("Split in leg 107", "Decided in leg 107"), **32d2a** (shape, built, done), **32d2b's shape** (the next step), 32d3, 32d4, 32e; the progress log's rows 105–107.
2. **`docs/architecture.md` §3.3 B:** "Built in step 32c2" (the look-up, "Welcome back", the upload schedule), "Built in step 32d1", "Built in step 32d2a" (including its "Not yet" line on two backup workers at once).
3. **Code for 32d2b:** `apps/tv/src/settings/settings-state.ts` (`SETTINGS_ITEMS`, `SETTINGS_SCREENS`, `createSettings`), `SettingsScreen.tsx` (`SettingsPage`, `SourcesPage` as the pattern for a page with a header button and rows), `sources-state.ts`; `apps/tv/src/backup/backup-schedule.ts` (`held`, `last`, `uploadNow`, `stop`/`start`), `backup-request.ts` (`backupRequest`, `consentOf`), `main.tsx` (where the schedule and Settings are made; `startWith(restored)` for the restart after "Restore it"); `apps/tv/src/data/engine.ts`'s four new calls; the catalogs (`apps/tv/src/i18n`, en and ar).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean apart from gitignored files; `git -C "<wt>" log --oneline -3` shows this handover's commit, then `c820225` (PR #133's record) and `17dd990` (32d2a); `origin/main` is `c8f8c53`; no `*.mutbak` (`find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`); `docker ps` shows only `lablo-web-postgres-1`; no PR open.
2. **32d2b, Settings' backup page** (RELAY.md 32d2b's shape, written before building in leg 107; refine it first if building shows more, and write the why):
   - a third Settings row "Backup" (`SETTINGS_ITEMS` gets `'backup'` after `'sources'` so the guides' and sources' paths stay; `SETTINGS_SCREENS` gets the page's screen ids);
   - the page: the on/off row (OK on "On" asks first: "Turn off backup? The copy on the server is deleted now."), the code in groups (`dir="ltr"`) when the source is the code, the last send (or the session's last failure from the schedule's `last`), and a held box with "Restore it" (asks first; the current profile is kept as a snapshot) and "Replace it";
   - **keep two backup workers apart** (architecture.md 32d2a "Not yet"): stop the schedule and wait for its run (`idle()`) before a switch, a restore or a replace; start it again after;
   - the schedule: "Replace it" ends `held` and runs at once; turning on runs at once (`held` is a read-only signal today: add the way to clear it);
   - "Restore it" → the app starts again as after a first-start restore ("Welcome back" in the restored language, then the live screen with `start(0)`);
   - the catalogs in en and ar (UI text only from the catalogs; i18n arguments are isolated: `stripIsolates` in tests);
   - **Done when** (RELAY 32d2b): unit tests for the page's state and drawing; `e2e/backup-settings.spec.ts` in plain `pnpm e2e` with the config server's stand-in (English with "Not now": the code shown equals `kv`'s `backup.code`, the last send after `uploadBackup()`, off → the stand-in's `DELETE` and its blob gone, `uploadBackup()` answers `off` with no request, on → `PUT` again; Arabic: a held backup (made, wiped, the look-up failed once, onboarding again, `uploadBackup()` → `held`), "Replace it" → `PUT` then `same`; a second test "Restore it" → "Welcome back", the old profile back, the replaced one in a snapshot); screenshots in en and ar looked at; lint, typecheck, `build:tv` (main.js had 30.5 KB left: 469.5 KB of 500 on Tizen), `verify:engines --engine chrome53 --engine chrome68`, mutation with the list written first, the PR merged on green CI, the docs (architecture.md §3.3 B "Built in step 32d2b"; the privacy text if the page's words change it).
   - If 32d2b is too big for one leg, split it (e.g. the page's state and drawing first, then the e2e) and write the split and why in RELAY.md.
3. **Then 32d3** ("Restore with a backup code" at the first start), **32d4** ("include login details" off: profile v9, in the profile, not `kv`), **32e** (logins at rest under `localKey`, profile v10). Each writes its shape first.
4. **Step 26's common items still apply** (unit tests; mutation with the list written first; the `pnpm verify` parts; `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker or the build changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; **a new or changed e2e spec runs in plain `pnpm e2e` too, not only by name**; the PR merged on green CI; the docs and the merge recorded).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of `c820225` (PR #133's merge record) and `17dd990` (32d2a).
- **`main`:** `c8f8c53` (Merge PR #133). No PR open. The main checkout was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next` (built in leg 106 from apps/web, unchanged since), `dist/` (built from 32d2a: `build:tv` is current), `artifacts/`: `mutate32d1.py`, `mutate32d2a.py` (+ their `-a/-b/-c.log`), `32d2a-wip.patch` (applied and committed; can go), `engines-32d1-final.log`, `engines-32d1-fix.log`, `engines-32d2a.log`, `unit-32d1-final.log`, `unit-32d2a.log`, `lint-32d1.log`, `lint-32d2a.log`, `build-tv-32d1-fix.log`, `build-tv-32d2a.log`, `e2e-backup-32d1-fix.log`, `engines/backup-chrome{53,68}-*.png`.

## Gotchas and lessons
**New in leg 107:**
- **A screen that switches language in `useEffect` after an async read paints a frame in the old language.** CI's Chromium 53 caught "Welcome back" in English; 56, 68 and the local 53 passed. Work out the locale while drawing (read the TV's locale once, `useMemo`) and set `<html lang dir>` and the nav's direction in `useLayoutEffect` (before paint).
- **An `e2e/` spec that needs the real API goes in both configs:** `playwright.web.config.ts`'s `tv` testMatch **and** `playwright.config.ts`'s chromium `testIgnore`. Leg 106 ran it only by name in `e2e:web`; CI's plain `pnpm e2e` picked it up (`GET 0`). List the plain run (`pnpm exec playwright test --list | tail -1`: 154 tests) after adding a spec.
- **Setting the next step's uncommitted work aside while a PR needs a fix:** `git diff -- <files> > artifacts/<x>.patch`, `git apply --check -R`, `git checkout -- <files>`, fix, build and verify clean, commit, then `git apply` it back. No stash.
- **`python -I` ignores `PYTHONIOENCODING`:** a mutation script that prints Arabic crashes under cp1252 after the mutant ran (the `finally` restores the file). Run it with `python -I -X utf8 -u`.
- **A new local named like a parameter** (`const doc` inside `putProfileOver(…, doc, …)`) silently wrote the old document: the tests caught it. Name such locals `old`/`previous`.
- **Mutation found 5 test gaps in each of 32d1 and 32d2a** (fields checked only together, a fixed app id that equalled the test's, a call made after the state it needs had ended): write each mutant's "what would catch it" before running.
- **GitHub's API and `git push` can fail for a minute ("error connecting to api.github.com", "Could not resolve host")**: retry in a loop with `timeout 30 tail -f /dev/null` between tries.
- **A wait loop over 10 minutes is moved to the background:** keep each foreground wait under about 9 minutes (`seq 1 11` × 45 s).
- **`auto-next.spec.ts` ar-SA `endEpisode`** failed in both of PR #132's runs (rerun green): still the known flake, but it is getting more frequent.

**From earlier legs (still true):**
- **CI front:** a PR touching `packages/protocol`, `packages/data`, the TV or the engines runs every job (web, verify, engines, media; about 25 min). Never push to a PR while its CI runs (a push cancels it); once a run has already failed, pushing the fix is fine.
- **Known CI flakes,** rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `auto-next.spec.ts` ar-SA `endEpisode`; `epg-declared-300mb` (media); media's 30-minute cap after slow installs; Chromium 53/56 DevTools start-up. No `jq`: use `gh --jq`. Job logs while a run is still going: `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`.
- **The boot's placeholder is a not-ready onboarding root** (`data-ready="false"`): a probe must require `data-ready="true"`.
- **A gzip stream hides plaintext from a byte search:** check sealing too.
- **Lint bans `window.PalmServiceBridge`/`window.webapis` outside the adapters, tests included:** name a vm realm's global `page`.
- **The e2e driver reads the drawn focus from `#app > [data-screen]`** (`data-zone`, `data-index`); a new full-screen root needs all three.
- **The upload schedule runs in every test that stays 60 s on the live screen;** a test that deletes the database waits for `configIdle() && backupIdle()`, then goes to `/?screen=gallery` and deletes `lablo`.
- **Bash heredoc Python with backslashes or `\u` fails or mangles:** write patch scripts to `$CLAUDE_JOB_DIR/tmp` with the Write tool; `python -I`.
- **A constant from `@lablo/protocol`'s index pulls zod into a worker:** use `@lablo/protocol/backup-limits`.
- **TV code rules:** no `Array.prototype.sort` in main; in new TV files none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread; members named `flags`/`at` (leg 107 named the send time `sentAt` for this), `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt` pull polyfills; physical CSS only, no Grid or flex `gap`; ES2017; `packages/ui` hook-free; UI text only from the catalogs.
- **A component with a hook can't be called as a function in a VNode test:** split it (export the pure parts, as `startLocale`). No DOM library in the repo.
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`; grep `v: N\b` (32d4 takes v9).
- **A reaped background run is never restarted unasked.** Unit, e2e and mutation in the foreground; `verify:engines` in the background with a wait on its log's `exit` line (`until grep -q "^exit " <log>; do timeout 20 tail -f /dev/null; done`).
- **`bytes[i] ^= 1` fails typecheck:** `bytes[i] = bytes[i]! ^ 1`. `transact(...)` infers `void`: `transact<unknown>`. **`git mv` stages at once:** `git diff --cached --name-only` before every commit.
- **A TV build takes `?api=` only for loopback;** old-engine walks forward a container port with `forwardToHost`. **The real `GET /v1/config` answers `max-age=300`.** **Root e2e specs have no `pg` types.**
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`. A restore is not a new way to add.
- **Workers:** a post-paint worker's npm deps go in `optimizeDeps.include`; never open the app's IndexedDB from a test page before onboarding's `data-ready="true"`.
- **Web backend:** `next build` typechecks e2e files; `next start` locks `.next`; `TaskStop` leaves `next start` running; node-postgres reads `timestamp` as local time.
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
- **Verified and merged in leg 107:** 32d1 (PR #132: CI's engines all 132 runs as expected on 53, 56, 68; the backup walk "Welcome back"/live 1.5/9.1 s on 53, 3.6/11.3 s on 56, 0.5/6.5 s on 68; `pnpm e2e` 154; `e2e:web` with `backup-api.spec.ts`); 32d2a (PR #133 on the first run: backup worker 16/16 on 53 5.2 s, 56 16.1 s, 68 0.8 s; unit 6,719; mutation 67/67).
- **Not verified anywhere:** Vercel/R2/Upstash (step 34); a real TV reading its own DUID or LGUDID through the app; anything that turns the backup off from the UI (32d2b).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32d2b–32d4's design calls are the legs' own** (the decisions so far are in RELAY.md 32d, 32d2). Write the why in RELAY.md.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race (now failing in most runs: worth a step of its own); `epg-declared-300mb`'s single-sample budgets.
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. `pnpm build:web && pnpm e2e:web --project=tv backup-api`: 2 passed (screenshots `artifacts/screenshots/backup-api-*.png`).
2. `pnpm verify:engines --engine chrome53`: the lines `app webos backup PASS` and `backup worker 16/16`; `artifacts/engines/backup-chrome53-ar-welcome.png` shows "مرحبًا بعودتك" right to left.

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
