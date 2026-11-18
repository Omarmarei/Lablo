# Lablo IPTV: relay leg 110 opening prompt

You are leg 110 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–108 did steps 1–31, 32a, 32b, 32c, 32d1, 32d2a and built 32d2b (PRs #1–#134). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 109 (2026-11-18):**
  - **32d2b done:** PR #134 merged as `cacdb6b` on green CI on the first run; 32d2b and 32d2 ticked.
  - **32d3 split** into 32d3a (the bundle as UTF-8), 32d3b (the typed code's restore in the worker), 32d3c (the first-run screen, catalogs, e2e: **its shape is written in RELAY**) and 32d3d (the old-engine walk with the code).
  - **32d3a done:** terser writes the TV bundles as UTF-8 (`ascii_only: false` in `tools/build/src/bundle.ts`; `test/fixtures/non-ascii.ts` + a `bundle.test.ts` case). main.js 489.3 → 453.8 KB on Tizen (**46 KB left**), 441.1 KB on webOS. PR #135 merged as `3a05cda` on green CI on the first run.
  - **32d3b built, PR #136 open, NOT merged, NOT ticked:** `BackupService.restoreCode` + its RPC handler, `BackupCodeRequest`, `codeRestoreMayWrite`/`putProfileFromCode` (profile.ts), `DataEngine.restoreBackupCode`, old-engine checks 16 → 18 (`backup.codeUpload`, `backup.restoreCode`), the harness summary ("the code's 0.9 s"). Commits `513871c` (feature), `23212e2` (docs), pushed; `cfb5e89` (RELAY: 32d3c's shape, progress row 109) and this handover's commit are **local only**.
  - **PR #136's CI (run 44394301650):** web, verify, engines green. **media** failed once on the `epg-declared-300mb` timing flake (74.5 > 60), then twice at the 30-minute job cap after 19-minute ffmpeg installs (verify:media cut off). **A third `gh run rerun --failed` was started at about 22:30 UTC** and was running at the handover.

## Read first
1. **`RELAY.md`:** step 32d3 and its sub-steps 32d3a (Decided/Done), 32d3b (shape, "Built in leg 109", "Verified in leg 109"), **32d3c's shape** (entry row, screen, restoring, answers, wiring, Done when) and 32d3d; 32d4, 32e; the progress log's rows 107–109.
2. **`docs/architecture.md` §3.3 B:** "Built in step 32d2b" (its Merged line), "Built in step 32d3b"; §4 build pipeline (UTF-8 out).
3. **`docs/runbooks/tv-build.md`** "UTF-8 out"; **`docs/runbooks/old-engines.md`** item on the backup worker's 18 checks.
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean apart from gitignored files; `git -C "<wt>" log --oneline -5` shows this handover's commit, then `cfb5e89`, `23212e2`, `513871c`, `b40b877`; `origin/main` is `3a05cda`; PR #136's head is `23212e2`; no `*.mutbak` (`find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`); `docker ps` shows only `lablo-web-postgres-1`.
2. **Finish 32d3b: PR #136.** `gh run view 44394301650 -R Omarmarei/Lablo --json status,jobs --jq ...`: if media is green, merge; if it failed again (flake or the cap, read the step times), `gh run rerun 44394301650 --failed -R Omarmarei/Lablo` once the run is done. **Do not push while its CI runs** (a push cancels it). On green: name the three riskiest changes, merge with a merge commit (`gh pr merge 136 --merge -R Omarmarei/Lablo`, keep the branch), `git -C "<wt>" fetch`, record the merge (RELAY 32d3b "Done in leg 110" with CI's times, tick 32d3b; architecture.md 32d3b's "Merged:" line and drop its "Not yet" when 32d3c lands), add the progress-log row, commit, push the branch.
   - Riskiest: (1) `codeRestoreMayWrite` decides when a first start may write over a stored profile (no profile, or this/older version with no source; unreadable, versionless or newer → `kept`); (2) `restoreCode` clears every catalog and guide in its transaction; (3) the backup worker grew to 135.5 of 150 KB.
3. **Then 32d3c** (the screen, catalogs, e2e) as its RELAY shape says. While #136's CI runs you may build it uncommitted; if #136 needs a fix, park the work as a patch file (no stash). Read `apps/tv/src/onboarding/onboarding-state.ts` (`sourceSpec`: the `types` zone counts `SOURCE_TYPES` + pairing) and `main.tsx` (`quiet`, `refreshSlotFree`, the restart `location.replace(restartUrl(location.href))`, `startRestored`).
4. **Then 32d3d** (the old-engine walk with the code), **32d4** ("include login details" off: profile v9) and **32e** (logins at rest under `localKey`, profile v10). Each writes its shape first.
5. **Step 26's common items still apply** (unit tests; mutation with the list written first; the `pnpm verify` parts; `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker or the build changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; a new or changed e2e spec runs in plain `pnpm e2e` too; the PR merged on green CI; the docs and the merge recorded).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **Pushed:** up to `23212e2` (PR #136's head). **Local only:** `cfb5e89` and this handover's commit (HANDOVER.md). Push them after PR #136's CI has finished (or after the merge).
- **`main`:** `3a05cda` (Merge PR #135). The main checkout was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`, `dist/` (built from `513871c`'s code: current), `artifacts/`: `mutate32d3b.py` (+ `-a/-b.log`), `engines-32d3a.log`, `engines-32d3b.log`, `build-tv-32d3a.log`, `build-tv-32d3b.log`, `typecheck-32d3a.log`, `typecheck-32d3b.log`, `unit-32d3b.log`, and earlier legs' files.

## Gotchas and lessons
**New in leg 109:**
- **The TV bundles are UTF-8 now (32d3a):** an Arabic letter costs 2 bytes in main.js (was 6). Terser still escapes U+2028/2029, U+FEFF and lone surrogates; the syntax gate refuses raw line separators. Non-ASCII only ever sits in string/regex literals, so a wrong charset would garble text, not code. A real TV hasn't read the UTF-8 build yet (step 21's check).
- **GitHub was flaky all evening** (DNS timeouts, `error connecting to api.github.com`): wrap every `gh`/`git push` in a retry loop with `timeout 20 tail -f /dev/null` between tries. `gh api .../actions/jobs/<id>/logs` never worked; **`gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations` gives a failed job's assertion** even while the run is in progress (that is how the EPG flake was read).
- **Media's 30-minute cap:** ffmpeg's apt install took 19–25 minutes on three runs in a row; read the step times (`gh run view <run> --json jobs`) before calling a cancelled media job a failure of the code.
- **`transact` settles `undefined` when `done` is never called:** removing a `done(false)` default is an equivalent mutant (undefined reads as not written); mutate it to `done(true)` instead.
- **Bash heredocs with backticks fail to parse** (a test block appended by heredoc did): write the text with the Write tool, then `cat >>` or `sed -i "<n>r <file>"` it in.
- **`backupCodeText(codeBytes())` in the sync tests:** a wiped TV with the same `random` makes the same code, so a test that a restore keeps the typed code needs another `random` (`setup({ random: otherBytes })`).

**From earlier legs (still true):**
- **CI front:** a PR touching `packages/protocol`, `packages/data`, the TV or the engines runs every job (web, verify, engines, media; about 30 min). Never push to a PR while its CI runs. No `jq`: use `gh --jq`. Known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `auto-next.spec.ts` ar-SA `endEpisode`, `epg-declared-300mb` (media), media's 30-minute cap after slow installs, Chromium 53/56 DevTools start-up.
- **Source ids restart at `s1` after a wipe:** anything that swaps the profile under a live database must drop the catalogs and guides too. Onboarding's loader commits a catalog before the profile gets its source.
- **A guard repeated in a caller and its callee is dead in one of them.** Write each mutant's catcher first.
- **`ZoneSpec` is a union:** tests read `(nav.top.zone('x') as { count: number }).count`.
- **Bash heredoc Python with `\u` fails:** build backslashes from `chr(92)`; prefer the Write tool for patches.
- **A restart test:** Playwright follows `location.replace`; the test hook is installed again by the new start.
- **A screen that switches language in `useEffect` after an async read paints a frame in the old language:** work out the locale while drawing, set `<html lang dir>` in `useLayoutEffect`.
- **An `e2e/` spec that needs the real API goes in both configs** (`playwright.web.config.ts`'s `tv` testMatch and `playwright.config.ts`'s chromium `testIgnore`). List the plain run after adding a spec (`pnpm exec playwright test --list | tail -1`: 157 tests).
- **Setting the next step's work aside while a PR needs a fix:** `git diff -- <files> > artifacts/<x>.patch`, `git apply --check -R`, `git checkout -- <files>`, fix, commit, `git apply` it back. No stash.
- **`python -I` ignores `PYTHONIOENCODING`:** run scripts that print Arabic with `python -I -X utf8 -u`.
- **The boot's placeholder is a not-ready onboarding root** (`data-ready="false"`). **The e2e driver reads the focus from `#app > [data-screen]`.** **The upload schedule runs in every test that stays 60 s on the live screen;** a test that deletes the database waits for `configIdle() && backupIdle()` first.
- **A constant from `@lablo/protocol`'s index pulls zod into a worker:** use `@lablo/protocol/backup-limits`.
- **TV code rules:** no `Array.prototype.sort` in main; in new TV files none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX spread props are fine), fragments; members named `flags`/`at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt` pull polyfills; physical CSS only, no Grid or flex `gap`; ES2017; `packages/ui` hook-free; UI text only from the catalogs.
- **A component with a hook can't be called as a function in a VNode test:** split it (a hook-free `…View` plus a small component with the hooks).
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`; grep `v: N\b` (32d4 takes v9).
- **A reaped background run is never restarted unasked.** Unit, e2e and mutation in the foreground (chunks under 10 min); `verify:engines` in the background.
- **`bytes[i] ^= 1` fails typecheck; `transact(...)` infers `void`: `transact<unknown>`; `git mv` stages at once: `git diff --cached --name-only` before every commit.**
- **A TV build takes `?api=` only for loopback; the real `GET /v1/config` answers `max-age=300`; root e2e specs have no `pg` types.**
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`. A restore is not a new way to add.
- **Smart App Control:** before every pnpm command `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **CI runs Node 22; this PC Node 24.** A bare `sleep` is blocked in the foreground: `timeout N tail -f /dev/null`. `TaskStop` on `verify:engines` leaves its container: `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 needs none.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally in leg 109:** 32d3a (engines 53+68 24/24 on the UTF-8 build, `e2e/tv-bundle.spec.ts` 8, build tests 176) and 32d3b (unit 6,956; typecheck; lint; `build:tv`; engines 53+68 24/24 with the backup worker 18/18; `e2e/crypto-vectors.spec.ts`; mutation 44/44).
- **On CI:** 32d3a merged green. 32d3b: web, verify, engines green; media pending (rerun 3).
- **Not verified anywhere:** a real TV reading the UTF-8 main.js; the code's restore on a real TV; Vercel/R2/Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32d3c–32e's design calls are the legs' own.** Write the why in RELAY.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets (it failed PR #136's first media run).
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV (now also: an Arabic onboarding to check the UTF-8 main.js).

## Checks for Omar (once PR #136 is merged)
1. `pnpm build:tv`: main.js about 454 KB own code on Tizen (was 489); `pnpm exec playwright test e2e/tv-bundle.spec.ts --project=chromium`: 8 passed.
2. `pnpm exec vitest run packages/data/src/backup-service-sync.test.ts -t restoreCode`: 21 passed.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`), read Dev Mode's "Remain Session", and open the app in Arabic once (the bundle is UTF-8 since 32d3a).
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word: 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`); 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`); 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`); 55 in leg 100's (`git show e85772d:HANDOVER.md`). No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
