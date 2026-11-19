# Lablo IPTV: relay leg 111 opening prompt

You are leg 111 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–109 did steps 1–31, 32a, 32b, 32c, 32d1, 32d2 and 32d3a (PRs #1–#135). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 110 (2026-11-19):**
  - **32d3b done:** PR #136 merged as `55f14b1` on green CI on its fourth run (media: the EPG flake, then two 30-minute caps on slow ffmpeg installs, then green with ffmpeg in 10 min). Ticked.
  - **32d3c done:** "Restore with a backup code" at the first start. The source screen's last row "Use a backup code" opens the `restore-code` screen (`apps/tv/src/onboarding/restore-code.ts`, `RestoreCodePage.tsx`): the field drawn in groups of four and checked first (`required`/`length`/`invalid`); the restore after the refresh slot (`refreshSlotFree`), with scrypt's progress, Cancel/Back and a 30 s limit (`CODE_LIMIT_MS`, pinned equal to `LOOKUP_LIMIT_MS`); `restored` restarts with "Welcome back" (`restartUrl`), `kept` reloads, the other answers say why and leave onboarding as it was; a rejection reads the profile again (a source = a restore that committed). New entry point `@lablo/crypto/backup-code`. 14 catalog keys. `e2e/backup-code.spec.ts` (2 tests). PR #137 merged as `f52c862` on green CI on the first run (media skipped by its path filter). Ticked.
  - **32d3d's shape is written in RELAY** (commit `9f59033`): the old-engine walk with the code, on the plain Tizen build. Not started.

## Read first
1. **`RELAY.md`:** 32d3c (shape, "Built in leg 110" with its 8 refinements, "Verified", "Done"), **32d3d's shape and Done when**, then 32d4 and 32e; the progress log's rows 108–110.
2. **`docs/architecture.md` §3.3 B:** "Built in step 32d1" (the wipe walk), "Built in step 32d3b", "Built in step 32d3c"; the first-run list (§ step 13a, item 4).
3. **`tools/engines/src/backup-walk.ts`** (32d1's walk: steps, probes, `evaluateBackupRun`, `runBackupWalk`), **`onboarding.ts`** (`typeText` with `char` events, `resetDatabase`, `STALE_MARK`, `PROFILE_EXPRESSION`, the layout probe), **`pairing.ts`** (the phone steps), **`verify-engines.ts`** (`runBackupScreen` wiring, line ~438), **`docs/runbooks/old-engines.md`**.
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean apart from gitignored files; `git -C "<wt>" log --oneline -4` shows this handover's commit, then `5ab7daf`, `9f59033`, `21e80cc`; `origin/main` is `f52c862`; the branch is pushed (this handover's commit included); no `*.mutbak` (`find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`); `docker ps` shows only `lablo-web-postgres-1`.
2. **Build 32d3d** as its RELAY shape says: `tools/engines/src/code-walk.ts` (`runCodeWalk`, `evaluateCodeRun`, the steps in en and ar, an ES5 expression reading `kv` `backup.code`), wired in `verify-engines.ts` as a screen of the `app` variant on the **Tizen** bundle after the backup walk; the stand-in's expected sequence `GET 404, PUT 200, GET 404 (the mistyped code, another lookup ID), GET 200`; the lookup ID from `backupKeys(deriveBackupMaster(code, 'tizen', appId))`. Unit tests first; then `pnpm build:tv` and `verify:engines --engine chrome53 --engine chrome68` in the background; screenshots looked at; mutation with the list written first; PR, merge on green CI; docs (architecture.md "Built in step 32d3d", runbook old-engines.md); tick 32d3d and 32d3.
3. **Then 32d4** ("include login details" off: profile v9) and **32e** (logins at rest under `localKey`, profile v10). Each writes its shape first.
4. **Step 26's common items still apply** (unit tests; mutation with the list written first; the `pnpm verify` parts; `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; a new or changed e2e spec runs in plain `pnpm e2e` too; the PR merged on green CI; the docs and the merge recorded).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, everything pushed.
- **`main`:** `f52c862` (Merge PR #137). The main checkout was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`, `dist/` (built from 32d3c's code before the row label was shortened: rebuild before the engines), `artifacts/`: `mutate32d3c.py` (+ `-a/-b/-c/-d.log`), `engines-32d3c.log`, `build-tv-32d3c.log`, `typecheck-32d3c.log`, `unit-32d3c.log`, `e2e-32d3c.log`, screenshots `backup-code-*`, `onboarding-en-XA-restore-code.png`, and earlier legs' files.

## Gotchas and lessons
**New in leg 110:**
- **en-XA's stretched text** (`onboarding.spec.ts`'s "marks every string of ours in en-XA" walk, with its layout check) cut a 640 px source row label that fit in en and ar: keep row labels short, put long wording in the screen's title, and add each new onboarding screen to that walk.
- **The app's `t()` isolates arguments in English too:** an e2e `toContainText` on a message with arguments fails; compare `stripIsolates((await el.textContent()) ?? '')` (import from `../packages/core/src/bidi`).
- **Read `build:tv`'s log for `Circular dependency: apps/`** after new imports: `LOOKUP_LIMIT_MS` imported from backup-start into an onboarding module closed a cycle. One onboarding screen cost 8.2 KB of main.js: **main.js is 462.0 of 500 KB on Tizen (38 KB left), 449.3 KB on webOS.**
- **A crypto function in main.js goes through a subpath entry point** (`@lablo/crypto/backup-code`: package.json `exports`, eslint.config.js's entry-point allow list, a case in `test/lint-boundaries.test.ts`).
- **A fake engine that rejects at once on cancel hides "a cancelled call answers late" paths:** give the fake a switch (`rejectOnCancel = false`).
- **The restore-code field is re-drawn on each input event** (upper case, groups of four, caret at the end): a real TV keyboard composing Latin letters hasn't typed into it yet (step 21's check).
- **Waiting on CI:** a background `until` loop on `gh run view <run> --json status` (60 s steps, 60 tries) gave one notification when the run ended; nothing in the foreground.

**From earlier legs (still true):**
- **CI front:** a PR touching `packages/protocol`, `packages/data`, the TV or the engines runs web, verify, engines (about 30 min); media runs only when its paths change (packages/data, the parsers). Never push to a PR while its CI runs. No `jq`: use `gh --jq`. Known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `auto-next.spec.ts` ar-SA `endEpisode`, `epg-declared-300mb` (media), media's 30-minute cap after slow ffmpeg installs (read the step times), Chromium 53/56 DevTools start-up. `gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations` gives a failed job's assertion.
- **GitHub can be flaky:** wrap every `gh`/`git push` in a retry loop with `timeout 20 tail -f /dev/null` between tries.
- **Source ids restart at `s1` after a wipe:** anything that swaps the profile under a live database must drop the catalogs and guides too.
- **A guard repeated in a caller and its callee is dead in one of them.** Write each mutant's catcher first.
- **`ZoneSpec` is a union:** tests read `(nav.top.zone('x') as { count: number }).count`.
- **Bash heredocs with backticks or `\u`/`\n` in Python fail or mangle:** write files with the Write tool; build backslashes from `chr(92)`; run mutation scripts as `python -I -X utf8 -u`.
- **A restart test:** Playwright follows `location.replace`; the test hook is installed again by the new start.
- **A screen that switches language in `useEffect` after an async read paints a frame in the old language:** work out the locale while drawing, set `<html lang dir>` in `useLayoutEffect`.
- **An `e2e/` spec that needs the real API goes in both configs** (`playwright.web.config.ts`'s `tv` testMatch and `playwright.config.ts`'s chromium `testIgnore`). List the plain run after adding a spec (`pnpm exec playwright test --list | tail -1`: **159 tests**).
- **Setting the next step's work aside while a PR needs a fix:** `git diff -- <files> > artifacts/<x>.patch`, `git apply --check -R`, `git checkout -- <files>`, fix, commit, `git apply` it back. No stash.
- **The boot's placeholder is a not-ready onboarding root** (`data-ready="false"`). **The e2e driver reads the focus from `#app > [data-screen]`.** **The upload schedule runs in every test that stays 60 s on the live screen;** a test that deletes the database waits for `configIdle() && backupIdle()` first.
- **A constant from `@lablo/protocol`'s index pulls zod into a worker:** use `@lablo/protocol/backup-limits`.
- **TV code rules:** no `Array.prototype.sort` in main; in new TV files none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX spread props are fine), fragments; members named `flags`/`at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt` pull polyfills; physical CSS only, no Grid or flex `gap`; ES2017; `packages/ui` hook-free; UI text only from the catalogs.
- **A component with a hook can't be called as a function in a VNode test:** split it (a hook-free `…Content`/`…View` plus a small component with the hooks).
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`; grep `v: N\b` (32d4 takes v9).
- **A reaped background run is never restarted unasked.** Unit, e2e and mutation in the foreground (chunks under 10 min); `verify:engines` in the background.
- **`bytes[i] ^= 1` fails typecheck; `transact(...)` infers `void`: `transact<unknown>`; `transact` settles `undefined` when `done` is never called; `git mv` stages at once: `git diff --cached --name-only` before every commit.**
- **A TV build takes `?api=` only for loopback; the real `GET /v1/config` answers `max-age=300`; root e2e specs have no `pg` types.**
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`. A restore is not a new way to add.
- **Smart App Control:** before every pnpm command `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **CI runs Node 22; this PC Node 24.** A bare `sleep` is blocked in the foreground: `timeout N tail -f /dev/null`. `TaskStop` on `verify:engines` leaves its container: `docker rm -f` it. The TV build can crash once (0xC0000005): run it again. Chromium 53 has no `Input.insertText`: type with `char` key events.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 needs none.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 110:** 32d3c: unit 7,066; typecheck; lint; `build:tv`; `verify:engines --engine chrome53 --engine chrome68` 24/24 (before the row label was shortened, a text change only); `e2e/backup-code.spec.ts` 2 and the onboarding/pairing/backup/backup-settings/config-gate specs 30; mutation 122/122; screenshots in en, ar and en-XA looked at. CI green on PR #137 (verify with plain `pnpm e2e` 159, web, engines 53/56/68).
- **Not verified anywhere:** a real TV reading the UTF-8 main.js; the code's restore on a real TV and its keyboard typing into the re-drawn field; Vercel/R2/Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32d3d–32e's design calls are the legs' own.** Write the why in RELAY.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets (a best-of-3 is worth proposing to Omar).
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV (also: an Arabic onboarding to check the UTF-8 main.js, and typing a backup code into "Use a backup code").

## Checks for Omar
1. `pnpm exec playwright test e2e/backup-code.spec.ts --project=chromium`: 2 passed (a code from Settings typed back after a wipe brings the sources back; Arabic right to left with the code left to right).
2. Open `artifacts/screenshots/backup-code-none-ar.png` and `backup-code-sources-en.png` in the worktree: the new row and the code screen.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`), read Dev Mode's "Remain Session", open the app in Arabic once (the bundle is UTF-8 since 32d3a), and try "Use a backup code" with the TV's keyboard.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word: 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`); 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`); 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`); 55 in leg 100's (`git show e85772d:HANDOVER.md`). No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
