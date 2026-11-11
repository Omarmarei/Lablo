# Lablo (formerly Zoma) IPTV: relay leg 67 opening prompt

You are leg 67 of relay run `iptv-20261101-214120`. The product is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

**The product is being renamed from "Zoma" to "Lablo"** (Omar, 2026-11-11). The code still says Zoma; step 26r renames it.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–65 did steps 1–25, 26a and 26b (PRs #1–#65), except step 16's Samsung part, 19b and 21.
- **Leg 66** did step 26c (a movie's details and playing it):
  - PR #66, merged as `91a9f53` on Omar's word with the engines job red (see step 26q);
  - PR #67 (docs), merged as `4dbadec`: README.md is now only "# Lablo", 26c is ticked, and steps 26q and 26r were added.
  - On Omar's word: the GitHub About box says only "Lablo" (no website, no topics).
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - step 26 and its sub-steps (around line 1010): 26c's "Done in leg 66";
   - the new **26q** and **26r**, just above 26d.
2. **`docs/architecture.md`:**
   - §1.2 "Built in step 26c";
   - the player's "Since step 26c" line, under "Built in step 25d";
   - §4 for the old-engine walk ("Built in step 26b", and the guide's own sections).
3. **`docs/runbooks/old-engines.md`** for the walk.

## Next steps, in order
1. **Step 26q: the old-engine walk's guide step near midnight** (its own PR).
   - **What failed on PR #66's CI** (run 43080457307, engines job 130791656881, 2026-11-11 about 21:14 UTC):
     - On Chromium 53, 56 and 68, both bundles and both languages, the step "ArrowRight three programmes on" (ArrowLeft in Arabic) expected "the cursor at 01:00".
     - It saw "the cursor at 00:30", with the view from 23:00: about 23:15 in the walk's zone.
     - The guide code didn't change in that PR, and the walk passed on PR #65 at another hour.
     - The walk stops at its first failure, so its movies steps didn't run.
   - **Find out** whether it is the fixture (`tools/engines/src/fixture.ts`: no programmes past midnight?), the step's expectation (`tools/engines/src/onboarding.ts` and its guide steps), or a real app bug at the day boundary (then fix the app, with a unit test).
   - **Prefer pinning the walk's clock**, so its run doesn't depend on the hour.
   - **Reproduce it locally** with a faked or pinned time: `pnpm --dir "<wt>" verify:engines --engine chrome53` (about 4 min; it needs a fresh `pnpm build:tv`).
   - **The report artifact** (`old-engines-report` of run 43080457307) has the failing screenshots: `gh run download 43080457307 -R Omarmarei/Lablo -n old-engines-report -D <scratch>`.
   - **Done when:**
     - the cause is in architecture.md §4;
     - the walk is green just before midnight in its zone, locally and in the engines job on CI;
     - the PR is merged.
2. **Step 26r: rename "Zoma" to "Lablo" everywhere** (its own PR, probably its own leg: about 2,000 occurrences in 399 files). Omar's decisions are in RELAY.md 26r:
   - **the app IDs too** (`com.zoma.iptv` → `com.lablo.iptv`, Samsung `ZomaIPTV01.Zoma`, the lab `com.zoma.iptv.lab` / `ZomaLab001.ZomaLab`);
   - **every occurrence, history included:** code, docs, CLAUDE.md (his word, given in leg 66's tab), RELAY.md with its old log rows, and HANDOVER.md. Git commit messages stay as they are (no force push).
   - **The scope list and the Done-when are in 26r:**
     - `@zoma/*` → `@lablo/*`, then `pnpm install`;
     - the IDB database name;
     - `__ZOMA_TEST__`, `__ZOMA_PLAYBACK__`, `__ZOMA_LAB__` and the `ZOMA_*` env vars (CI workflows too);
     - the mock's `zoma`/`zoma-test` logins, "Zoma Test …" channels and `zoma.*` guide ids;
     - "Zoma Sans" and its `zoma-*.woff2`;
     - the catalogs;
     - the old-engine harness;
     - the screenshot names.
   - **Done when:** `git grep -i zoma` finds nothing.
   - **Watch for:**
     - polyfills: new names can pull core-js modules in. Run the poly count after the first build;
     - lockfile churn;
     - the old-engine harness's expected strings;
     - the env var CI's media job sets (`ZOMA_E2E_MEDIA`).
3. **Then 26d (resume) and 26e ("Recently added")**, each in its own leg.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of these:
  - `4dbadec` Merge PR #67;
  - `8fbdaf5` docs: 26c ticked, 26q and 26r added, README to "# Lablo";
  - `91a9f53` Merge PR #66;
  - `0b3ffa4` docs: step 26c;
  - `f461729` fix(player): the mutation run's findings;
  - `977aa20` feat(movies).
- **main** is `4dbadec`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `dist/`;
  - `.cache/media` (real Blender films in `open-movies/` too), `.cache/engines`, **`.cache/rollup-wasm`** (see the first gotcha);
  - `artifacts/`:
    - `mutate26c.py` (86) + `.log`, `mutate26c-b.py` (6) + `.log`, `mutate26c-e2e.py` (10) + `.log`;
    - `poly-count20c2a.py`;
    - `screenshots/movie-details-{en-US,ar-SA}.png`, `movie-player-{en-US,ar-SA}.png`, `player-movie-en.png`, `player-movie-ended-en.png`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit them (LG's license; the repo is public).

## What step 26c built (architecture.md §1.2 "Built in step 26c")
- **The details** (`apps/tv/src/movies/movie-details.ts`, `MovieDetailsScreen.tsx`, `movie.css`):
  - pushed on the live navigator over the movies screen by OK on a poster;
  - the poster (368 × 552) at the inline start, then the title, the category, the year · length · rating line, the genre, the plot, the director and the cast;
  - "Play" (focused) and "Back".
- **The details' data:**
  - the panel's `get_vod_info` comes through the query worker (`packages/data/src/vod-info.ts`: `VodInfoCache`, 24 h, 100 movies, in memory; `QueryService.vodInfo`, `DataEngine.vodInfo`);
  - a spinner while it is out; a failed read shows the catalog's facts and a note; a plain playlist's movie shows its line's facts.
- **The player's movie mode** (`player-state.ts`: `playMovie`, `movie`, `actions`, `MOVIE_ACTIONS`; `PlayerScreen.tsx`: the movie's info bar, `MovieEndCard`):
  - `mode: 'vod'`; the URL is rebuilt with the panel's `container_extension` when it differs;
  - the seek bar runs over the media time and the length: `PlayerEngine.durationMs`, new on every engine, else the panel's;
  - LEFT/RIGHT move 10 s (`MOVIE_STEP_MS`, a minute when held), FF/RW 5 min;
  - a seek happens inside the stream, else as a new play from there; each seek drops the one before's fallback;
  - forward stops 10 s before the end;
  - Back returns to the details;
  - "The movie has ended" with "Back"; "Try again" plays on from the last position.
- **Decided (not a gate):** CH±, the digits and PRE-CH do nothing in a movie. Also: the 10 s steps, and the details kept in memory, not IndexedDB.
- **Tests:**
  - 4,326 unit tests;
  - e2e `movie-details.spec.ts` (en, ar);
  - `player-media.spec.ts` +1 (`e2e:media`: a real film seeks 30 s inside the MP4 with the frames moving, then FF to the end card);
  - mutation 86: 82 caught, the four survivors fixed (one a real bug), re-run 6/6; e2e mutants 10/10.
- **Size:** main 374.2 KB (Tizen) / 361.4 KB (webOS), app.css 82.1 KB, 219 core-js modules on both.

## Gotchas and lessons
**New in leg 66** (also in memory):
- **Windows Smart App Control blocks rollup's native module since 2026-11-11.**
  - **The symptom:** every vitest, vite, build or e2e run fails with `ERR_DLOPEN_FAILED … Application Control policy has blocked this file`.
  - **Omar keeps Smart App Control on.** Use the workaround and don't ask again: before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - **What the hook does:** it loads `@rollup/wasm-node@4.67.3` instead of the blocked file. It reaches vitest workers, Playwright's dev server, and python mutation scripts that pass `env=os.environ`.
  - **Never delete files in `node_modules`** (the classifier refuses it, and pnpm hardlinks them into the store).
  - **A new worktree** needs `.cache/rollup-wasm` copied: `native.js`, `wasm-node/`, a `package.json` `{"type":"commonjs"}` and `hook.cjs`. If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract with `tar --force-local`.
- **GitHub refused every Actions job once:** "recent account payments have failed or your spending limit needs to be increased". Omar fixed his billing.
  - If it happens again, it's a needs-you stop: `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations` shows the message.
  - Re-run with `gh run rerun <run> -R Omarmarei/Lablo`.
  - Public repos on the standard runners use no paid minutes.
- **The i18n runtime isolates every message argument** (marks plus FSI/PDI). A compound like "7.5/10" must be one argument, or Arabic shows "10/7.5". e2e text checks strip the marks: `MARKS` in `e2e/movie-details.spec.ts`, built with `String.fromCharCode`.
- **`PlayerScreen`'s `current`** (the bar's row equals the playing row) hides the spinner and the cards. A movie is always current: keep that if the screen changes.
- **The mock's `get_vod_info` can be held or failed server-side** with `app.addHook('onRequest', …)` (see `e2e/movie-details.spec.ts`). This works for requests made from the query worker, where `page.route` isn't needed.
- **`e2e:media` has the real Blender films locally** (`.cache/media/open-movies`). CI has same-length stand-ins (Big Buck Bunny 596 s, H.264/AAC).
- **A mutation run still needs a list written first,** and closing the gaps the list shows before the run paid off again (six gaps).

**From earlier legs (still true):**
- **The relay context check fires at about 450k tokens.** Budget code and e2e first, then mutation, docs, verify, PR, merge.
- **There is no `jq` in Git Bash.** Use `gh … --jq`, or read `gh pr checks N -R Omarmarei/Lablo` in the foreground. Right after `gh pr create`, checks may not be listed yet: wait about 20 s.
- **Commands:**
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - one old engine: `pnpm --dir "<wt>" verify:engines --engine chrome53`.
- **A member named `at` pulls `Array/String.at` into the TV bundle** (five times so far). Run the poly count right after the first build of new TV code: `python -I -u artifacts/poly-count20c2a.py`.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files;
  - building lists with a `for` loop instead of `.map` is the safe habit;
  - the build can crash once (0xC0000005): run it again.
- **Bash heredocs feeding python lose backslashes and fail on quotes.** Write the script with the Write tool (in the scratchpad), then `python -I <file> "$WT"`. The Edit and Write tools decode `\u` escapes.
- **Python's `write_text` on Windows writes CRLF.** It is harmless: `.gitattributes` normalizes. `SettingsScreen.tsx` and `main.tsx` are CRLF in the working copy, and patch scripts preserve the line ending.
- **Never `cd`** (a `cd /tmp` in leg 66 moved the session's working directory). Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run. Commit docs locally (or after the merge). A `merge --ff-only origin/main` after a merge still works with uncommitted changes.
- **CI media "Install ffmpeg" can hang** on the Azure apt mirror. Use `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **Non-media e2e that presses keys in the player:** hold the stream with `page.route(..., r => r.fetch().catch(() => undefined))`.
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays, so real frames need `ZOMA_E2E_MEDIA=1 ... --project=playback-media`;
  - its movies are 201–206.
- **Root tests can't import an apps/tv module that reaches `@zoma/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm verify`, `e2e:media` or the engines run is going.** Docs are safe. Look for `*.mutbak` after a stopped run.
- **Code rules:**
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs (ar.ts has no comments);
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only, and no CSS Grid or flex `gap`;
  - TV code is ES2017;
  - the app imports only types from `@zoma/data`;
  - dependencies at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` and `Claude-Session` lines.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`, or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, its jobs path-filtered;
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data;
  - **Omar wants the repo page not to say what the product is:** keep README.md as "# Lablo" and the About box as "Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md.
- **CLAUDE.md edits need Omar's direct word in his own tab.** For step 26r's rename of "Zoma" inside CLAUDE.md, he gave it in leg 66's tab.

## Verified vs not
- **Verified:**
  - **Locally:** lint, typecheck, unit (4,326), both TV builds (219 modules), the full `pnpm e2e` (104 passed), the full `e2e:media` (12 passed), mutation, and the screenshots looked at.
  - **On CI (PR #66's re-run):** verify and media green.
- **Not verified:** CI's engines job, red at the guide's midnight step (26q). The movies steps after it didn't run on that CI run; they passed on #65.
- **Not done:** any TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies grid, and now the details and playing can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, and whether the low tier keeps posters in lists.
- **Later (unchanged):**
  - from leg 65: a CSS seed for the poster grid;
  - from leg 63: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents;
  - from leg 62: a day jump in the guide;
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
  - **new:** the movie details on the old-engine walk.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (26r sets them to `com.lablo.*`) and real icons.

## "Press these keys" checklist for step 26c (Omar)
1. **In `pnpm dev`** (or `?scale=`), open "Movies" in the header and press OK on Big Buck Bunny. Expect:
   - the details open with "Play" focused;
   - a spinner for a moment, then "2008 · 10 min · Rated 7.5/10", "Animation" and the plot;
   - in Arabic, the poster on the right and the rating still reading "7.5/10".
2. **OK on "Play":** the film plays. The bar shows its name, `0:00` and `9:56`, and three buttons (no "Previous channel").
3. **RIGHT three times:** the bar jumps to 0:30, and the picture continues from there a moment later. Then:
   - FF: +5 minutes;
   - LEFT: −10 s;
   - OK or PLAY/PAUSE: pauses;
   - CH+ and a digit: nothing happens.
4. **FF until it stops** (10 s before the end). The film ends on "The movie has ended" with "Back"; OK returns to the details, and Back to the grid.
5. **Sintel** (with a panel that fails `get_vod_info`): the details say "Couldn't read more about this movie." and still play.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains, now for **"Lablo"** (was "Zoma"). They decide the final app IDs too (26r uses `com.lablo.*`).
- **After step 26r, at the TV:** remove the old lab `com.zoma.iptv.lab`.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-two CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description;
  - 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid";
  - 32: the commands table could add the one-engine and one-throttled-spec commands.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
