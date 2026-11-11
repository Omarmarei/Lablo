# Lablo (formerly Lablo) IPTV: relay leg 68 opening prompt

You are leg 68 of relay run `iptv-20261101-214120`. The product is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

**The product is being renamed from "Lablo" to "Lablo"** (Omar, 2026-11-11). The code still says Lablo. Step 26r, this leg's step, renames it.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–66 did steps 1–25 and 26a–26c (PRs #1–#67), except step 16's Samsung part, 19b and 21.
- **Leg 67** did step 26q, the old-engine walk's guide step near midnight:
  - PR #68, merged as `72f307c` on green CI;
  - PR #69 (docs), merged as `527f73e`: 26q ticked.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - step **26r** (just above 26d): Omar's decisions, the scope and the Done-when;
   - 26q's "Done in leg 67" just above it, for context.
2. **`docs/architecture.md` §4 "Built in step 26q"**, and the runbook `docs/runbooks/old-engines.md` "The engine's zone".
3. **`CLAUDE.md`:** Omar gave his word in leg 66's tab to rename "Lablo" inside it as part of 26r.

## Next steps, in order
1. **Step 26r: rename "Lablo" to "Lablo" everywhere** (its own PR; this leg is for it alone).
   - **The size on 2026-11-12:** `git grep -io lablo` gives 2,053 occurrences in 398 files.
   - **Omar's decisions (in RELAY.md 26r):**
     - **The app IDs too:** `com.lablo.iptv` → `com.lablo.iptv`, the Samsung `LabloIPTV1.Lablo`, the lab `com.lablo.iptv.lab` and `LabloLab01.LabloLab`.
     - **Every occurrence, history included:** code, docs, CLAUDE.md, RELAY.md with its old log rows, and HANDOVER.md.
     - **Not git history:** commit messages stay as they are (no force push).
   - **The scope:**
     - `@lablo/*` → `@lablo/*` (package names, imports, tsconfig paths, the build's aliases), then `pnpm install`;
     - the IDB database name `lablo`. The engines harness deletes it by name, and so do `idb-delete.ts` and the lab's runs;
     - `__LABLO_TEST__`, `__LABLO_PLAYBACK__`, `__LABLO_LAB__`, `__labloStale` and the `LABLO_*` env vars, CI workflows included (`LABLO_E2E_MEDIA`, `LABLO_ENGINE_CACHE`);
     - the mock's `lablo`/`lablo-test` logins, the "Lablo Test …" channels, the `lablo.*` guide ids and `lablo-mock`;
     - "Lablo Sans" and its `lablo-*.woff2`;
     - the catalogs;
     - the old-engine harness: the fixture's "Lablo Channel n", "Lablo Film n" and `فيلم لابلو n`, the container names `lablo-<engine>-…`, the image tag `lablo-old-engines:<hash>`, and the expected strings;
     - the screenshot names.
   - **Done when:**
     - `git grep -i lablo` finds nothing (or only a deliberate list of exceptions, written in 26r);
     - `pnpm verify` and `e2e:media` are green, with 219 core-js modules on both bundles;
     - CI is green, including the engines job;
     - the PR is merged;
     - the handover tells Omar to remove the old `com.lablo.iptv.lab` from the TV.
   - **Watch for:**
     - **The Arabic name:** `لابلو` (in the fixture's Arabic films, and maybe the catalogs) isn't caught by `git grep -i lablo`. Grep for it too, and pick the Arabic for "Lablo" (`لابلو`?). Note the choice in 26r; it's not a real trade-off, so no gate.
     - **Polyfills:** a new name can pull core-js modules in. Run the poly count right after the first build.
     - **Lockfile churn** from the package renames.
     - **The engines image tag:** the build context (Dockerfile, run-chrome.sh, serve-fixture.sh) has no "Lablo", so the hash stays. The tag's name changes to `lablo-old-engines:<hash>`, and locally `ensureImage` would then rebuild (archive.debian.org crawls). First run `docker tag lablo-old-engines:<hash> lablo-old-engines:<hash>`, where `<hash>` is the current `imageTag`, `ba502212364a` today. CI builds its image each run anyway.
     - **`docker.test.ts`** expects `/^lablo-old-engines:/`.
     - **Screenshot names and artifacts paths** in CI's upload globs.
     - **Fonts:** the font family name lives in CSS, the TV build's font tooling (`tools/fonts`) and tests that read rendered fonts.
     - **A mutation run isn't needed** for a rename. Lean on the full gates: lint, typecheck, unit, build:tv and its poly count, `pnpm e2e`, `e2e:media`, `verify:engines --engine chrome53 --engine chrome68`, then CI.
2. **Then 26d (resume) and 26e ("Recently added")**, each in its own leg.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of these:
  - `527f73e` Merge PR #69;
  - `4d00c1c` docs: tick 26q;
  - `72f307c` Merge PR #68;
  - `bcd0277` fix(engines): zone names without a digit;
  - `c6ccdff` fix(guide): the day past midnight read in time.
- **main** is `527f73e`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `dist/` (the fixed build of 26q);
  - `.cache/media`, `.cache/engines`, `.cache/rollup-wasm` (see the first gotcha);
  - `artifacts/`: `poly-count20c2a.py`, the 26c mutation scripts and logs, the screenshots, and `artifacts/engines/` from the local run of Chromium 53 and 68.
- **Docker Desktop** was not running at the start of leg 67. Start it with `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` (PowerShell), then wait until `docker version` answers.
- **On the TV:** the lab `com.lablo.iptv.lab` 0.1.1 (CLI device `tv`). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `lablo-webos-sim:local`. Never commit them (LG's license; the repo is public).

## What step 26q found and built (architecture.md §4 "Built in step 26q")
- **The cause was the app.** The guide asked only the days its 2-hour view crosses.
  - At 21:15 (PR #66's CI, in UTC) the next day was unread when the walk's three quick keys crossed midnight.
  - A key stepped over the unread day's 30-minute "No information" placeholder: the cursor at 00:30, not 01:00.
  - The old "23:15 in the walk's zone" was wrong: the containers were in UTC.
- **The fix:** `askedDays` (`apps/tv/src/guide/guide-state.ts`) also asks the day a view after or before the view reaches, the view's own days first.
- **The walk's clock:** each engine container starts with a `TZ` where it is 21:xx (`engineZone`, `FIXED_ZONES` in `tools/engines/src/docker.ts`; `--hour` picks another hour).
  - The harness checks the page's `getTimezoneOffset()` before the first screen.
  - Every walk now crosses midnight.
- **Proof:**
  - **Locally:** the old build at 21:48 failed as CI did. The fixed build passed on Chromium 53, and later on 53 and 68 with the digit-free zones.
  - **On CI:** engines 108/108 on 53, 56 and 68, each in `Atlantic/Cape_Verde` at 21:2x–21:3x.
- **e2e `guide-catchup-days.spec.ts`:** it failed at 23:5x local. Its walk back over unread days stops on 30-minute slots, so the cursor can sit half an hour into the target programme. It now accepts that, and checks that Back returns to the same cursor.
- **Tests:** 4,332 unit tests (+6). Main 374.3 KB (Tizen) / 361.6 KB (webOS), 219 core-js modules.

## Gotchas and lessons
**New in leg 67** (also in memory: `iptv-engine-zone-pin`):
- **Chromium 68's V8 reads the zone through ICU, and ICU ignores a `TZ` with a digit.** `Etc/GMT+1` left 68 in UTC while 53 and 56 took it.
  - Keep `FIXED_ZONES` digit-free.
  - Test any harness change on 68 too: `--engine chrome53 --engine chrome68` takes about 8 min locally. Leg 67 lost a 20-minute CI round by testing 53 only.
- **Hour-of-day effects:** the Playwright e2e runs at the machine's real clock. Cursor minutes in the guide can depend on the hour (unread days move by 30-minute slots). Assert the cell, not the exact cursor minute.
- **Reproducing an old bug on the engines:**
  1. Put the old file in place: `git show HEAD:<file> > <file>`.
  2. `pnpm build:tv`.
  3. Restore the fixed file.
  4. `verify:engines` now runs the old build while the source holds the fix.
- **`TaskStop` on a `verify:engines` run leaves its container.** Remove it with `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 5; done` loop, or the Monitor tool.
- **Git Bash's `date` labels local time "EST"** while showing the +02:00 wall time. Trust Docker's or Node's clock.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes in `pnpm install` (26r's install may refresh the lockfile), `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **GitHub billing can refuse every Actions job** ("recent account payments have failed").
  - That's a needs-you stop: read `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`.
  - Re-run with `gh run rerun <run> -R Omarmarei/Lablo`.
- **The i18n runtime isolates every message argument** (marks plus FSI/PDI). A compound like "7.5/10" must be one argument. e2e text checks strip the marks (`MARKS` in `e2e/movie-details.spec.ts`).
- **The relay context check fires at about 450k tokens.** Budget the rename's mechanical work first, then the gates, PR and merge.
- **There is no `jq` in Git Bash.** Use `gh … --jq`. Right after `gh pr create`, checks may not be listed yet: wait about 20 s with a loop.
- **Commands:**
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - engines: `pnpm --dir "<wt>" verify:engines --engine chrome53` (about 4 min, needs a fresh `pnpm build:tv`).
- **The poly count:** `python -I -u artifacts/poly-count20c2a.py` right after the first build of new TV code. A member named `at` pulls `Array/String.at` in.
- **TV bundle polyfills:**
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files;
  - build lists with `for` loops;
  - the build can crash once (0xC0000005): run it again.
- **Bash heredocs feeding python lose backslashes.** Write scripts with the Write tool (in the scratchpad), then `python -I <file> "$WT"`. The Edit and Write tools decode `\u` escapes.
- **Python's `write_text` on Windows writes CRLF.** It is harmless (`.gitattributes` normalizes). `SettingsScreen.tsx`, `main.tsx` and `verify-engines.ts` are CRLF in the working copy.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **CI media "Install ffmpeg" can hang:** `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays (real frames need `LABLO_E2E_MEDIA=1 ... --project=playback-media`, renamed in 26r);
  - its movies are 201–206.
- **Root tests can't import an apps/tv module that reaches `@lablo/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm verify`, `e2e:media` or the engines run is going.** Docs are safe.
- **Code rules:**
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs (ar.ts has no comments);
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only, no CSS Grid or flex `gap`;
  - TV code is ES2017;
  - the app imports only types from `@lablo/data`;
  - dependencies at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` and `Claude-Session` lines.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, its jobs path-filtered (docs alone run none);
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data;
  - keep README.md as "# Lablo" and the About box as "Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #69).
- **CLAUDE.md edits need Omar's direct word in his own tab.** For 26r's rename inside CLAUDE.md he gave it in leg 66's tab. Change only the name there, nothing else.

## Verified vs not
- **Verified:**
  - **Locally:** lint, typecheck, unit (4,332), both TV builds (219 modules), `pnpm e2e` (94 passed + the fixed spec 2/2), and Chromium 53 and 68 (16/16).
  - **On CI (PR #68):** verify and engines (108/108) green. Media was skipped by its path filter: no media code changed.
- **Not done:** any TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies grid, the details and playing can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, and whether the low tier keeps posters in lists.
- **Later (unchanged):**
  - a CSS seed for the poster grid;
  - fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents;
  - a day jump in the guide;
  - an on-screen keyboard if the TV keyboards fail;
  - webOS's PRE-CH;
  - the accessibility route;
  - pre-buffered zapping;
  - the last frame kept while reconnecting;
  - step 38's settings rows;
  - subtitle parsing off the main thread;
  - a Guide or Info key;
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier;
  - holding refreshes while a low-tier TV plays;
  - the catalogs as UTF-8;
  - a "loading" look for unread rows;
  - the details, the settings and the picker on the old-engine walk;
  - a screen for a guide's own zone;
  - `SourceMemory` for catch-up;
  - the movie details on the old-engine walk;
  - **new:** a walk at a second hour (00:xx, the backward crossing) if the engines job has time. Unit tests cover it today.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (26r sets `com.lablo.*`) and real icons.

## "Press these keys" checklist for step 26q (Omar)
1. **In `pnpm dev`** at about 21:00–22:00, open the live screen's "Guide", then quickly press RIGHT four or five times past midnight. Expect:
   - the next day's programmes already drawn when the cursor crosses midnight (no "No information" flash on channels that have a guide);
   - the cursor on each programme's start.
2. **Just after midnight** (00:00–01:59), press LEFT quickly back past midnight: the same, into the day before.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains, now for **"Lablo"** (was "Lablo"). They decide the final app IDs too (26r uses `com.lablo.*`).
- **After step 26r, at the TV:** remove the old lab `com.lablo.iptv.lab`.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-two CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description;
  - 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid";
  - 32: the commands table could add the one-engine and one-throttled-spec commands.
  - (Leg 67 adds no new one. `--hour` is in the runbook.)
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
