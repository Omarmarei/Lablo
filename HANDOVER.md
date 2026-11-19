# Lablo IPTV: relay leg 114 opening prompt

You are leg 114 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–112 did steps 1–31, 32a–32d3 and 32d4a (PRs #1–#139). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 113 (2026-11-19): 32d4b built, NOT merged; no PR yet.** It stopped at the relay context check.
  - **Split:** the guides screen's part is now **32d4c** (its own `- [ ] 32d4c.` line in RELAY, after 32d4b). 32d4 is ticked when 32d4a, 32d4b and 32d4c are.
  - **Refinements written into RELAY before building** (under the 32d4b line, "Refined while planning 32d4b"): the save's refresh is the data engine's own inside main's `quiet` (not `refreshNow`, which reads only guides; the schedule holds a `needs-login` refusal 2 h); the login is written before the refresh; the rows' marks; the form; "Welcome back" keeps its 5 s and its end opens Sources however it comes; the toggle switches at once both ways, no question.
  - **Built (3 commits):**
    - Settings › Backup's second row "Include logins and links" (`backup-state.ts`: `logins` signal, `includesLogins`, `switchRows`, `setLogins` = the `backupLogins` edit inside the schedule's `hold`, then `uploadNow`; `BackupPage.tsx`: `loginsLine`, the row; `BackupPageEngine` gains `profile` and `editProfile`).
    - "Welcome back": `backup-start.ts` counts sources without their login (`logins`, `needsLogin` in `engine-loader.ts`), `BackupStartEnd.toSources`; `BackupStartApp.tsx` draws the line; `main.tsx` passes `toSources` through `startWith` → `showLive` → `settings.openSources()` (new on `Settings`: the settings screen on its Sources row, then the sources screen).
    - Sources: `sources-state.ts` rows have `needs` ('login' | 'link' | null) and `answer` (`SaveAnswer`), a `screen` signal, `form`, the save (edit → reload → `login.refresh` → answer → reload); new `source-login.ts` (the form: `LOGIN_SCREEN = 'source-login'`, `checkLogin` over onboarding's `checkForm`, `loginValues`, `createLoginForm`); `SettingsScreen.tsx` (`statusText`, `warns`, `LoginFormView`/`LoginDialog`, `loginLabel`, `loginHint`, `SourcesPage` now takes `focus` and returns null without its screen); `settings-state.ts` (`refreshSource` option, `LOGIN_SCREEN` in `SETTINGS_SCREENS`); `main.tsx`'s `refreshSource` = `quiet(() => DataEngine.refresh(...))`, then `refreshNow()` and `sourceAdded()` (now a named function shared with the phone's add).
    - Catalogs (en, ar): `backup.welcomeLogins`, `backup.logins`, `backup.loginsIn`, `backup.loginsOut`, `backup.loginsSending`, `backup.loginsFailed`, `sources.needsLogin`, `sources.needsLink`, `sources.updating`, `sources.loginTitle`, `sources.linkTitle`, `sources.formBody`, `sources.linkWas`, `sources.save`.
    - e2e: `e2e/backup-logins.spec.ts` (e2e:web `tv` project, real API, en Xtream with a refused password first, ar M3U) and `e2e/backup-logins-xa.spec.ts` (plain e2e, en-XA walk); both configs list `backup-logins`. `e2e/backup-settings.spec.ts` gained one DOWN past the new row (`backup/switch/1`).

## Read first
1. **`RELAY.md`:** the 32d4 block: "The way back (32d4b)", "Done when (32d4b)", the `- [ ] 32d4b.` line with "Split in leg 113" and "Refined while planning 32d4b", the `- [ ] 32d4c.` line; the progress log's rows 111–113.
2. **`artifacts/mutate32d4b-plan.md`** (gitignored, in the worktree): the mutation list drafted in leg 113, the catchers to add first, and what is left out and why.
3. **`docs/architecture.md` §3.3 B:** "Built in step 32d4a" (32d4b's "Built in step 32d4b" is still to write), "Built in step 32d2b", "Built in step 32c2".
4. **The code above** (`git show e621be7 ce9abe3 --stat`).
5. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -6`: this handover's commit, `fbf10d7`, `ce9abe3`, `e621be7`, `c311756`, `e394923`;
   - the branch pushed (`origin/relay/iptv-20261101-214120` = HEAD); `origin/main` is still `6a3ebaa`;
   - no `*.mutbak` (`find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`);
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **Finish 32d4b:**
   - add the five catchers listed in `artifacts/mutate32d4b-plan.md` (two `backup-page.test` checks, one `backup-start.test` case, one `guides-state.test` `refreshSource` test, the e2e `data-state` check);
   - write `artifacts/mutate32d4b.py` from the plan (copy `mutate32d4a.py`'s runner), `--check` it, run it, close the gaps;
   - look at the en-XA screenshots (`artifacts/screenshots/backup-logins-*-en-XA.png`): not looked at yet;
   - consider: "Welcome back"'s body says "Your channels are loading now" even when every source lacks its login (left as it is; the next line explains);
   - the `pnpm verify` parts: `pnpm lint` (whole repo), root `tsc -p tsconfig.json`, `pnpm typecheck`, `pnpm test`;
   - `pnpm build:tv` (read its log for `Circular dependency: apps/`; main.js was 462.7 KB on Tizen before, 37.3 KB left; record the new size);
   - `verify:engines --engine chrome53 --engine chrome68` (the TV pages changed);
   - `pnpm exec playwright test --list | tail -1` (159 before; +1 for `backup-logins-xa`), plain `pnpm e2e` for the touched specs, `pnpm e2e:web --project=tv` for `backup-logins` and `backup-api`;
   - the PR (title like "32d4b: the toggle and the way back for sources"), merged on green CI (merge commit, keep the branch), with the three riskiest changes named;
   - architecture.md §3.3 B "Built in step 32d4b", runbook if any, tick 32d4b, the merge recorded.
3. **Then 32d4c** (the guides screen's part, as its RELAY line says), then **32e** (logins at rest under `localKey`, profile v10; write its shape first; it must seal `player.last`/`channels` items' `url` and `catchup` too).
4. **Step 26's common items still apply:** unit tests; mutation with the list written first; lint the whole repo, root `tsc`, the package typechecks; `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; a new e2e spec runs in plain `pnpm e2e` too (or both configs for real-API specs); the PR merged on green CI; the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, 5 commits past `6a3ebaa` (the 4 above plus this handover's), all pushed. No PR open.
- **`main`:** `6a3ebaa` (Merge PR #139). The main checkout was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next` (32d4a-era build; apps/web unchanged since), `dist/` (32d4a's build, stale now), and in `artifacts/`: `unit-32d4b.log`, `e2e-32d4b-logins.log`, `e2e-32d4b-plain.log`, `mutate32d4b-plan.md`, the screenshots `backup-logins-*.png`, plus earlier legs' files.

## Verified vs not
- **Verified in leg 113:**
  - unit: the whole suite 7,244 green after one pin fix (`SETTINGS_SCREENS`), then `apps/tv/src/settings` + `src/backup` 351 green after the last change;
  - `apps/tv` typecheck clean; eslint clean on every changed file;
  - `e2e/backup-logins.spec.ts` against the real API: 2/2 (en, ar) on the first run; screenshots looked at (the off row, "Welcome back" in Arabic, the Xtream form, the refused row, the Arabic form with its host hint, the updated row);
  - plain e2e: `backup-logins-xa` 1/1 (after measuring width only), `backup-settings`, `backup`, `backup-code`, `config-blocklist`, `pairing` 17/17.
- **Not verified:** the full lint, root `tsc`, `pnpm typecheck`; `build:tv` and main.js's size; `verify:engines`; the full plain `pnpm e2e`; mutation; CI. A real TV (step 21). Vercel, R2, Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 113:**
- **`refreshNow` reads only the guides,** and the refresh schedule keeps any refused refresh (`needs-login` too) as a failure for 2 h: a source given its login is refreshed by the data engine directly, inside main's `quiet` (the schedule disposed and started again).
- **A settings page under a dialog** must hand its own screen (a `screen` signal) to `VirtualList` and `useZone`, never `binding.nav.top`, which is the dialog's then. The sources page now does; it returns null without its screen.
- **A new zone row shifts paths:** the backup page's switch zone has 2 rows while on, so DOWN from the switch reaches the logins row first; `backup-page.test` and `backup-settings.spec` were updated. Old-engine walks don't navigate the backup page.
- **en-XA "cut" checks measure width only** (`scrollWidth > clientWidth + 1`): accented pseudo-words overflow their line height by a pixel.
- **Bash heredocs failed twice more** writing python patch specs (`unexpected EOF while looking for matching ''`), once with `<<'PYEOF'`. Write spec files with the Write tool and apply them with a small runner (leg 113 used `$CLAUDE_JOB_DIR/tmp/patch.py`, gone with the job: re-create it, or use Edit).
- **The Edit tool can leave CRLF in a working copy** (git warns "CRLF will be replaced by LF"); the committed blob is LF. Harmless.

**From earlier legs (still true):**
- **Logins live in more than the sources and guides:** `player.last.item` and every `channels[].item` keep the catalog item's `url` and `catchup` (32d4a strips them to `''`/`null`). 32e must seal them.
- **Types for a source without its login:** `StoredSource`, `StoredGuide`, `RefreshSource`; `ingestSourceOf` overloads; `sourceUrlOf` gives the kept server or origin. Refusal order in `DataEngine.refresh`: `needs-login` before `claim`, the blocklist after.
- **A profile bump's pins** include `test/tv-data-engine.test.ts` and the "newer" literals; 32e takes v10 (grep `v: 9\b`).
- **Old-engine backup checks:** 20; adding one touches `BACKUP_CHECKS`, `vectors.test.ts` pins and strings, `vectors.ts`'s comment, `check-backup.test.ts`.
- **Never pass `-c user.email=…`;** the worktree config has the no-reply email.
- **CI:** a PR touching the TV, data or engines runs web, verify and engines (~30 min); media only on its paths. Never push to a PR while CI runs. No `jq` (use `gh --jq`). Known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-min cap, Chromium 53/56 DevTools start-up. `gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations` gives a failed job's assertion.
- **Waiting on CI:** a background `until` loop on `gh run view <run> --json status` (60 s steps); retry every `gh` call and `git push` with `timeout 20 tail -f /dev/null` between tries.
- **Overlap:** while CI runs, write the next step's shape uncommitted; `git merge --ff-only origin/main` works with a dirty tree.
- **main.js budget** on Tizen: 500 KB; one screen ≈ 8 KB; read `build:tv` for `Circular dependency: apps/`.
- **TV code rules:** no `.sort(` in main; in new TV files none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring/spread, object spread (JSX spread props fine), fragments; members named `flags`/`at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt` pull polyfills; physical CSS only, no Grid or flex `gap`; ES2017; `packages/ui` hook-free; UI text only from the catalogs; a component with hooks can't be called as a function in a VNode test (split a hook-free `…View`).
- **Typecheck traps:** `bytes[i] ^= 1`; `transact<unknown>`; `transact` settles `undefined` without `done`.
- **`git mv` stages at once:** `git diff --cached --name-only` before each commit.
- **Real-API specs** go in both Playwright configs; root e2e specs have no `pg` types; a TV build takes `?api=` only for loopback.
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`.
- **Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **CI runs Node 22, this PC Node 24.** A bare `sleep` is blocked: `timeout N tail -f /dev/null`. `TaskStop` on `verify:engines` leaves its container (`docker rm -f`). The TV build can crash once (0xC0000005): rerun. Chromium 53 has no `Input.insertText`.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI on `pull_request`, path-filtered; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Profile versions are on-device migrations.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **32d4b–32e's design calls are the legs' own;** write the why for any refinement in RELAY.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets (a best-of-3 is worth proposing to Omar).
- **Steps 16, 19b and 21 wait for Omar:** Samsung (account, certificate, RTL tunnel session, the 2018 set); 30–45 minutes at the LG TV (also an Arabic onboarding for the UTF-8 main.js, typing a backup code, and now a login given again on the sources screen).

## Checks for Omar
1. Nothing to click yet: 32d4b isn't merged. Screenshots of the new screens are in `artifacts/screenshots/backup-logins-*.png` in the worktree.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session"; open the app in Arabic once; try "Use a backup code" with the TV's keyboard.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word (1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `git show 5fffb27:HANDOVER.md`; 48–54: `git show 081c1ee:HANDOVER.md`; 55: `git show e85772d:HANDOVER.md`). No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
