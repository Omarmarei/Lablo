# Lablo IPTV: relay leg 109 opening prompt

You are leg 109 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–107 did steps 1–31, 32a, 32b, 32c, 32d1 and 32d2a (PRs #1–#133). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 108 (2026-11-18) built 32d2b, Settings' backup page; PR #134 is open with its CI running. It is NOT merged and 32d2b is NOT ticked.** The leg stopped at the relay context check right after opening the PR.
  - **Refined before building (RELAY 32d2b "Refined in leg 108", with the why):** "Restore it" also clears every catalog and guide (`RESTORE_CLEARS` in `restoreHeld`'s transaction: `sources_meta`, the catalog and EPG stores; `kv`'s config and backup records stay). Why: source ids restart at `s1` after a wipe (`nextSourceId`), so the held backup's `s1` can be another server than the replaced profile's, and its fresh catalog would show under the restored source for hours. The app starts again by a reload (`location.replace` with `restored=1` first in the query, `restartUrl`/`readRestored` in `data/params.ts`): "Welcome back" at once (`createBackupStart({restored})`, no look-up), then the live screen with `start(0)`. The restore waits for quiet (`quiet` in main.tsx: refreshes disposed, the data engine's slot free). The schedule keeps one backup worker at a time: `hold(job)` (off, on, restore), `replaceNow()` ("Replace it" as its own run); `held` now follows the answers (any answer but `failed`/a dead worker clears it).
  - **Built:** `apps/tv/src/settings/backup-state.ts` (`createBackupPage`), `BackupPage.tsx` (`BackupView`, `BackupConfirmView`, `switchLine`, `noticeText`, `questionText`), Settings' third row "Backup" (`SETTINGS_ITEMS` `['guides','sources','backup']`, `Settings.items`, `SETTINGS_SCREENS` + `backup`, `backup-confirm`), the page's CSS, 44 catalog keys each in en and ar, `e2e/backup-settings.spec.ts` (3 tests, in plain `pnpm e2e`). "Replace it" asks first too (it loses data for good). Commits `dab5b23` (feature), `fc352a6` (mutation fixes), `6daa776` (docs: architecture.md §3.3 B "Built in step 32d2b", RELAY), then this handover's commit (local only, see below).
  - **Verified locally:** unit 6,933; full lint; typecheck; `build:tv` (main.js 489.3 KB Tizen, 476.6 KB webOS of 500; backup worker 134.4 KB); `verify:engines --engine chrome53 --engine chrome68` all 24 runs as expected, backup worker 16/16 incl. the new catalogs-cleared check; `e2e/backup-settings.spec.ts` 3 passed; plain `pnpm e2e` 157 passed (5.5 min); screenshots `artifacts/screenshots/backup-settings-*.png` in en and ar looked at; mutation `artifacts/mutate32d2b.py` 121 written first, 3 dead checks removed, 9 gaps closed, 120/120.

## Read first
1. **`RELAY.md`:** step 32d2 and 32d2b ("The shape", "Refined in leg 108", "Built in leg 108", "Verified in leg 108"), 32d3 (with its new "Budget first (leg 108)" note), 32d4, 32e; the progress log's rows 106–108.
2. **`docs/architecture.md` §3.3 B:** "Built in step 32c2", "Built in step 32d2a", "Built in step 32d2b".
3. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean apart from gitignored files; `git -C "<wt>" log --oneline -4` shows this handover's commit (local, NOT pushed), then `6daa776`, `fc352a6`, `dab5b23`; `origin/main` is `c8f8c53`; PR #134's head is `6daa776`; no `*.mutbak` (`find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`); `docker ps` shows only `lablo-web-postgres-1`.
2. **Finish 32d2b: PR #134.** Read its checks (`gh pr checks 134 -R Omarmarei/Lablo`; run 44378782540). **Do not push while its CI runs** (a push cancels it); the handover commit stays local until then. Known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `auto-next.spec.ts` ar-SA `endEpisode`, `epg-declared-300mb` (media), media's 30-minute cap after slow installs, Chromium 53/56 DevTools start-up. A real failure: fix, verify locally, push (fine once a run has failed). On green: name the three riskiest changes (below), merge with a merge commit (`gh pr merge 134 --merge -R Omarmarei/Lablo`, keep the branch), then `git -C "<wt>" fetch`, record the merge in RELAY.md (tick 32d2b and 32d2; a "Done in leg 109" line with CI's times and the engines' backup numbers) and in architecture.md 32d2b's "Merged:" line, add the progress-log row, commit, push the branch.
   - Riskiest changes: (1) `restoreHeld` clears `sources_meta`, the catalog and EPG stores in its transaction (only when the profile is written); (2) the restart is a `location.replace` with `restored=1` first in the query; (3) the schedule's `held` now clears on any answer but `failed`/a dead worker.
3. **Then 32d3** ("Restore with a backup code" at the first start). **Budget first:** main.js has 10.7 KB left on Tizen (489.3 of 500). The catalogs' Arabic is written as `\u06XX` escapes (8,989 in main.js, 6 bytes a letter); writing the bundle as UTF-8 (esbuild's `charset: 'utf8'`, tools/build) would free about 45 KB, if every engine (53, 56, 68, a real TV) reads the packaged script as UTF-8. Check that (old-engine walks with Arabic screens; the build's gates) before the screen, or find the room elsewhere; write the decision and why in RELAY. Then 32d3's shape before building.
4. **Then 32d4** ("include login details" off: profile v9) and **32e** (logins at rest under `localKey`, profile v10). Each writes its shape first.
5. **Step 26's common items still apply** (unit tests; mutation with the list written first; the `pnpm verify` parts; `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker or the build changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; a new or changed e2e spec runs in plain `pnpm e2e` too; the PR merged on green CI; the docs and the merge recorded).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **Pushed:** up to `6daa776` (PR #134's head). **Local only:** this handover's commit (HANDOVER.md, RELAY.md's row 108). Push it after PR #134's CI has finished (or after the merge).
- **`main`:** `c8f8c53` (Merge PR #133). The main checkout was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`, `dist/` (built from `fc352a6`'s code: current), `artifacts/`: `mutate32d2b.py` (+ `-a/-b/-c/-d/-e/-sc/-st.log`), `engines-32d2b.log`, `unit-32d2b.log`, `lint-32d2b.log`, `typecheck-32d2b.log`, `build-tv-32d2b.log`, `e2e-32d2b-settings.log`, `e2e-32d2b-full.log`, `screenshots/backup-settings-*.png`, and leg 107's files.

## Gotchas and lessons
**New in leg 108:**
- **Source ids restart at `s1` after a wipe:** anything that swaps the profile under a live database (a restore over a profile) must drop the catalogs and guides too, or a fresh catalog of another server shows under the same id. The e2e proves it with two different playlists.
- **The TV bundle writes Arabic as `\u06XX` escapes (6 bytes a letter):** new Arabic catalog text costs about 6 KB per 1,000 letters in main.js (and in the lab bundle). Count it when planning a screen.
- **A guard repeated in a caller and its callee is dead in one of them** (mutation found three: `runHidden` and a hold's release re-checked holds that `run`/`arm` refuse anyway; the page's action re-checked `busy` that its OK checks). Put a guard in one place.
- **Mutation gaps this leg:** an older read's failure (only its answer was tested), a failed re-read after a success, a reopening's reset (the first read was still held, so the reset was invisible), an effect not stopped on dispose, `data-*` checked only in the "on" case, a `source=` query without `&` (the split never ran). Write each mutant's catcher first.
- **`ZoneSpec` is a union:** tests read `(nav.top.zone('x') as { count: number }).count`; vitest passes without the cast but `pnpm typecheck` fails.
- **Bash heredoc Python with `\u` failed again** (SyntaxError): write the patch with the Write tool and build the backslash from `chr(92)`.
- **A restart test:** Playwright follows `location.replace`; the test hook is installed again by the new start.

**From earlier legs (still true):**
- **CI front:** a PR touching `packages/protocol`, `packages/data`, the TV or the engines runs every job (web, verify, engines, media; about 25 min). Never push to a PR while its CI runs. Job logs while a run is going: `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`. No `jq`: use `gh --jq`. GitHub's API and `git push` can fail for a minute: retry with `timeout 30 tail -f /dev/null` between tries.
- **A screen that switches language in `useEffect` after an async read paints a frame in the old language:** work out the locale while drawing, set `<html lang dir>` in `useLayoutEffect`.
- **An `e2e/` spec that needs the real API goes in both configs** (`playwright.web.config.ts`'s `tv` testMatch and `playwright.config.ts`'s chromium `testIgnore`). List the plain run after adding a spec (`pnpm exec playwright test --list | tail -1`: 157 tests now).
- **Setting the next step's work aside while a PR needs a fix:** `git diff -- <files> > artifacts/<x>.patch`, `git apply --check -R`, `git checkout -- <files>`, fix, commit, `git apply` it back. No stash.
- **`python -I` ignores `PYTHONIOENCODING`:** run scripts that print Arabic with `python -I -X utf8 -u`.
- **The boot's placeholder is a not-ready onboarding root** (`data-ready="false"`). **The e2e driver reads the focus from `#app > [data-screen]`.** **The upload schedule runs in every test that stays 60 s on the live screen;** a test that deletes the database waits for `configIdle() && backupIdle()` first.
- **A constant from `@lablo/protocol`'s index pulls zod into a worker:** use `@lablo/protocol/backup-limits`.
- **TV code rules:** no `Array.prototype.sort` in main; in new TV files none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX spread props are fine), fragments (none in the TV code: pass children instead); members named `flags`/`at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt` pull polyfills; physical CSS only, no Grid or flex `gap`; ES2017; `packages/ui` hook-free; UI text only from the catalogs.
- **A component with a hook can't be called as a function in a VNode test:** split it (a hook-free `…View` plus a small component with the hooks).
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`; grep `v: N\b` (32d4 takes v9).
- **A reaped background run is never restarted unasked.** Unit, e2e and mutation in the foreground (chunks under 10 min); `verify:engines` in the background.
- **`bytes[i] ^= 1` fails typecheck; `transact(...)` infers `void`: `transact<unknown>`; `git mv` stages at once: `git diff --cached --name-only` before every commit.**
- **A TV build takes `?api=` only for loopback; the real `GET /v1/config` answers `max-age=300`; root e2e specs have no `pg` types.**
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`. A restore is not a new way to add.
- **Smart App Control:** before every pnpm command `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **CI runs Node 22; this PC Node 24.** A bare `sleep` is blocked in the foreground: `timeout N tail -f /dev/null`. `TaskStop` on `verify:engines` leaves its container: `docker rm -f` it. The TV build can crash once (0xC0000005): run it again. A full unit run can time out one CPU-heavy fixture test (`xtream-xmltv-core` 61-byte chunks): rerun it alone.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 needs none.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally in leg 108 (not yet on CI):** 32d2b, as listed under Status.
- **Not verified anywhere:** PR #134's CI; Vercel/R2/Upstash (step 34); a real TV reading its own DUID or LGUDID through the app; the backup page and the reload restart on a real TV.
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32d3–32d4's design calls are the legs' own**, including how to find main.js room (UTF-8 output or elsewhere). Write the why in RELAY.md.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race (failing in most runs: worth a step of its own); `epg-declared-300mb`'s single-sample budgets.
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (once PR #134 is merged)
1. `pnpm exec playwright test e2e/backup-settings.spec.ts --project=chromium`: 3 passed; look at `artifacts/screenshots/backup-settings-held-ar.png` (the held box right to left) and `backup-settings-code-en.png` (the code in groups of four).
2. In `pnpm dev`: onboarding with "Not now", then Settings › Backup: the code shows; OK on the switch asks before turning off.

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
