# Lablo IPTV: relay leg 112 opening prompt

You are leg 112 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–110 did steps 1–31 and 32a–32d3c (PRs #1–#137). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 111 (2026-11-19):**
  - **32d3d is done:** the old-engine walk with the backup code (`tools/engines/src/code-walk.ts`, a new harness screen `code` on the plain Tizen build). PR #138 merged as `d446dc0` on green CI on its first run (engines 135/135 on Chromium 53, 56 and 68). 32d3d and 32d3 are ticked.
  - **32d4's shape is written in RELAY** (commit `af27ca4`), and the step is split into **32d4a** (the backup without logins: profile v9, the worker's stripped envelope, the refresh refused for a source without its login) and **32d4b** (the toggle and the way back: Settings, "Welcome back", the sources and guides screens, e2e). Neither is started.

## Read first
1. **`RELAY.md`:** 32d4's split, its shape and its two "Done when" lines (right under the `- [ ] 32d4.` line), then 32e; the progress log's rows 109–111.
2. **`docs/architecture.md` §3.3 B:** the backup scheme; "Built in step 32c1" (the envelope: the stored document whole, gzipped, sealed), "Built in step 32d2a" (`kv`'s `backup.off`, and why 32d4's choice goes in the profile instead), "Built in step 32d3d".
3. **`packages/data/src/profile.ts`** (the header's version history, `SourceRecord`, `PROFILE_MIGRATIONS`, `PROFILE_VERSION` = 8, `emptyProfile`), **`backup-service.ts`** (`upload`, its `same` hash, `putProfileFromCode`, `RESTORE_CLEARS`), **`check-backup.ts`** (the worker checks the old engines run), **`apps/tv/src/data/engine.ts`** (`refresh` and the blocklist's refusal: where `needs-login` goes), **`apps/tv/src/settings/sources-state.ts`** and **`guides-state.ts`** (for 32d4b).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean apart from gitignored files; `git -C "<wt>" log --oneline -4` shows this handover's commit, then `af27ca4`, `d446dc0`, `040a426`; `origin/main` is `d446dc0`; the branch is pushed (this handover's commit included); no `*.mutbak` (`find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`); `docker ps` shows only `lablo-web-postgres-1`.
2. **Build 32d4a** as its shape says:
   - Profile version 9: a source may lack its login (Xtream keeps `base`, M3U keeps the link's host) and a guide may lack its link (keeps its host); `backupLogins: false` in the profile (no field means on). The migration from 8 changes no data.
   - The profile-version pins: grep `v: 8\b` across `packages`, `apps`, `test` and `e2e` (`profile.test.ts`, `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`, the "newer version" pins).
   - `withoutLogins` in the worker, before gzip and sealing; `same` compares the stripped plaintext.
   - The data engine refuses a refresh of a source or guide without its login (`needs-login`, beside the blocklist's refusal).
   - `check-backup`'s worker checks: an upload without logins and its restore (the old engines run them in the vectors page: update `BACKUP_CHECKS` in `tools/engines/src/vectors.ts`).
   - Then: unit tests, `pnpm build:tv`, `verify:engines --engine chrome53 --engine chrome68` in the background, mutation with the list written first, the PR merged on green CI, the docs (architecture.md "Built in step 32d4a"), tick 32d4a.
3. **Then 32d4b** (its own leg most likely), then **32e** (logins at rest under `localKey`, profile v10; write its shape first).
4. **Step 26's common items still apply:**
   - unit tests;
   - mutation with the list written first;
   - the `pnpm verify` parts: lint the whole repo, the root `tsc -p tsconfig.json`, the package typechecks;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - a new or changed e2e spec runs in plain `pnpm e2e` too;
   - the PR merged on green CI;
   - the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, fast-forwarded to `d446dc0` and everything pushed.
- **`main`:** `d446dc0` (Merge PR #138). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`, `dist/` (built from leg 111's code; no TV code changed since);
  - `artifacts/`: `mutate32d3d.py` (+ `-a/-b/-c.log`), `engines-32d3d.log`, `build-tv-32d3d.log`, `typecheck-32d3d.log`, `unit-32d3d.log`, `lint-32d3d.log`, `engines/code-*.png`, and earlier legs' files.

## Gotchas and lessons
**New in leg 111:**
- **The root typecheck can't take an apps/tv module that reaches `@lablo/ui`:** a root test (`test/*.ts`) importing `onboarding-state.ts` or `restore-code.ts` passes vitest but breaks `tsc -p tsconfig.json` (TS6142, `--jsx` not set). Pin such constants by reading the source as text (`test/engines-backup.test.ts` does).
- **Heredoc Python mangled again:** a backslash-n became real newlines in a TS file and in the memory index, and an escaped quote made an exact-match assert miss. Put any script with a backslash or an escaped quote in a file with the Write tool (in `$CLAUDE_JOB_DIR/tmp`), or use Edit.
- **Mutation gaps this time:**
  - every fake field had the same `dir`, so a constant-return mutant survived: vary the fake values;
  - a "stopped" fixture that still carried the whole happy state hid a dropped `return`: build stopped states as the probe really reads them;
  - a count-only comparison survived: add a same-length wrong sequence.
- **The harness's code walk** (for anything that changes onboarding, the code screen or the restart):
  - The probe is `WALK_EXPRESSION` plus a `codeView()`.
  - The code is read from `kv` `backup.code` (`CODE_READ_EXPRESSION`).
  - After a restore the app is at `?restored=1&api=…` (`restartedUrl`, pinned to the app's `restartUrl`).
  - The Tizen salt's app id comes from the staged config.xml (`tizenAppId`).
  - Clearing the field relies on the caret being at the end when the edit opens again.
  - In Arabic the code sits at the box's right end, as modern Chromium draws it too (the app's layout, not an engine bug).
- **CI's code walk times** from "Restore" (no backup, "Welcome back", live): 1.3 s, 1.3 s, 8.3 s on 53; 3.5 s, 3.4 s, 10.3 s on 56; 0.3 s, 0.3 s, 6.1 s on 68. The engines job runs about 26–27 minutes.

**From earlier legs (still true):**
- **CI front:**
  - A PR touching `packages/protocol`, `packages/data`, the TV or the engines runs web, verify and engines (about 30 min); media runs only when its paths change (packages/data, the parsers: **32d4a will run media**).
  - Never push to a PR while its CI runs. No `jq`: use `gh --jq`.
  - Known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done:
    - `auto-next.spec.ts` ar-SA `endEpisode`;
    - `epg-declared-300mb` (media);
    - media's 30-minute cap after slow ffmpeg installs (read the step times);
    - Chromium 53/56 DevTools start-up.
  - `gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations` gives a failed job's assertion.
- **Waiting on CI:** a background `until` loop on `gh run view <run> --json status` (60 s steps, 60 tries) gives one notification when the run ends; nothing in the foreground. Wrap every `gh`/`git push` in a retry loop with `timeout 20 tail -f /dev/null` between tries.
- **Overlap:** while a PR's CI runs, write the next step's shape (uncommitted); `git merge --ff-only origin/main` after the merge works with a dirty tree; commit the shape with the merge record.
- **en-XA's stretched text:** it cuts long row labels (keep labels short; add new onboarding/settings screens to the en-XA walk). **The app's `t()` isolates arguments in English too:** compare with `stripIsolates`.
- **main.js is 462.1 of 500 KB on Tizen (38 KB left), 449.4 KB on webOS;** one onboarding screen cost about 8 KB. Read `build:tv`'s log for `Circular dependency: apps/` after new imports. A crypto function for main.js goes through a subpath entry point (`@lablo/crypto/backup-code`: package.json `exports`, eslint's entry-point list, a case in `test/lint-boundaries.test.ts`).
- **A fake engine that rejects at once on cancel hides "a cancelled call answers late" paths:** give it a switch.
- **Source ids restart at `s1` after a wipe:** anything that swaps the profile under a live database must drop the catalogs and guides too.
- **A guard repeated in a caller and its callee is dead in one of them.** Write each mutant's catcher first.
- **`ZoneSpec` is a union:** tests read `(nav.top.zone('x') as { count: number }).count`.
- **Mutation scripts:** run them as `python -I -X utf8 -u`; build backslashes from `chr(92)`.
- **A restart test:** Playwright follows `location.replace`; the test hook is installed again by the new start.
- **A screen that switches language in `useEffect` after an async read paints a frame in the old language:** work out the locale while drawing, set `<html lang dir>` in `useLayoutEffect`.
- **An `e2e/` spec that needs the real API goes in both configs** (`playwright.web.config.ts`'s `tv` testMatch and `playwright.config.ts`'s chromium `testIgnore`). After adding a spec, list the plain run (`pnpm exec playwright test --list | tail -1`: **159 tests**).
- **Setting the next step's work aside while a PR needs a fix:**
  1. `git diff -- <files> > artifacts/<x>.patch`;
  2. `git apply --check -R`;
  3. `git checkout -- <files>`;
  4. fix and commit;
  5. `git apply` it back.

  No stash.
- **The boot's placeholder is a not-ready onboarding root** (`data-ready="false"`). **The e2e driver reads the focus from `#app > [data-screen]`.** **The upload schedule runs in every test that stays 60 s on the live screen;** a test that deletes the database waits for `configIdle() && backupIdle()` first.
- **A constant from `@lablo/protocol`'s index pulls zod into a worker:** use `@lablo/protocol/backup-limits`.
- **TV code rules:**
  - no `Array.prototype.sort` in main;
  - none of these in new TV files: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX spread props are fine), fragments;
  - members named `flags`/`at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim` and `parseInt` pull polyfills;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` hook-free; UI text only from the catalogs.
- **A component with a hook can't be called as a function in a VNode test:** split it (a hook-free `…Content`/`…View` plus a small component with the hooks).
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`; grep `v: N\b` (32d4a takes v9, 32e v10).
- **A reaped background run is never restarted unasked.** Unit, e2e and mutation in the foreground (chunks under 10 min); `verify:engines` in the background.
- **Typecheck traps:** `bytes[i] ^= 1` fails typecheck; `transact(...)` infers `void` (use `transact<unknown>`); `transact` settles `undefined` when `done` is never called.
- **`git mv` stages at once:** run `git diff --cached --name-only` before every commit.
- **A TV build takes `?api=` only for loopback; the real `GET /v1/config` answers `max-age=300`; root e2e specs have no `pg` types.**
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`. A restore is not a new way to add. A source without its login (32d4a) must be refused there too.
- **Smart App Control:** before every pnpm command `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **CI runs Node 22; this PC Node 24.** A bare `sleep` is blocked in the foreground: use `timeout N tail -f /dev/null`. `TaskStop` on `verify:engines` leaves its container: `docker rm -f` it. The TV build can crash once (0xC0000005): run it again. Chromium 53 has no `Input.insertText`: type with `char` key events.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Step 32 needs none (profile versions are on-device migrations, not production ones).
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 111:**
  - 32d3d locally: unit 7,119; the root and engines typechecks; lint of the whole repo; `build:tv`; `verify:engines --engine chrome53 --engine chrome68` 26/26 on the first run; screenshots in en and ar looked at; mutation 142/142.
  - CI green on PR #138: verify 16 m 6 s; engines 135/135 on 53, 56 and 68, 92 seeded failures caught; web and media skipped by their path filters.
- **Not verified anywhere:**
  - a real TV reading the UTF-8 main.js;
  - the code's restore on a real TV, and its keyboard typing into the re-drawn field;
  - Vercel, R2 and Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32d4a–32e's design calls are the legs' own.** 32d4's are written in RELAY (what counts as a login: user name and password, and every playlist or guide link whole; the choice in the profile; the refusal in the data engine). Write the why for any refinement.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in the phone page's `connect-src`, and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):**
  - the guides screen's "read, last try failed" rows clip their third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - `epg-declared-300mb`'s single-sample budgets (a best-of-3 is worth proposing to Omar).
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the 2018 set;
  - 30–45 minutes at the LG TV, which also covers an Arabic onboarding (to check the UTF-8 main.js) and typing a backup code into "Use a backup code".

## Checks for Omar
1. Open `artifacts/engines/code-chrome53-ar-none.png` and `code-chrome53-ar-typed.png` in the worktree. They show the Arabic code screen on the 2018 engine: the "no backup" answer under the field, and the code typed left to right.
2. Optional: `pnpm verify:engines --engine chrome53` runs the whole harness. The `code` line should read PASS (about 40 s).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once (the bundle is UTF-8 since 32d3a);
  - try "Use a backup code" with the TV's keyboard.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word. No new gap this leg.
  - 1–28: leg 51's handover (`git show d05d5fd:HANDOVER.md`);
  - 29–47: leg 86's (`git show 5fffb27:HANDOVER.md`);
  - 48–54: leg 93's (`git show 081c1ee:HANDOVER.md`);
  - 55: leg 100's (`git show e85772d:HANDOVER.md`).
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
