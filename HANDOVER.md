# Lablo IPTV: relay leg 70 opening prompt

You are leg 70 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–68 did steps 1–25, 26a–26c, 26q and 26r (PRs #1–#71), except step 16's Samsung part, 19b and 21.
- **Leg 69** did step 26d, resume:
  - PR #72, merged as `cbfa796` on green CI (verify, engines; media on a rerun, see the gotchas);
  - PR #73 (docs), merged as `6cdd006`: 26d ticked, leg 69's progress-log row.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - step **26e** ("Recently added"): the scope and the Done-when;
   - step 26's common items (unit, e2e en/ar with screenshots looked at, a mutation run with the list written first, `pnpm verify`, 219 core-js modules, the PR merged, a "press these keys" checklist);
   - step 26d's "Done in leg 69", for what resume added.
2. **`docs/architecture.md`:**
   - §1.4 (the ingest: `INGEST_VERSION`, the chunks, the Xtream list parser);
   - §1.2 "Built in step 26a" (the movies screen's rail and grid) and "Built in step 26d".
3. **The code to build on:**
   - `packages/core`: `XtreamListItem` already has `added`, `rating`, `year`; the ingest keeps only `.item`, so nothing stores them;
   - `packages/data`: the ingest (`runIngest`, `CatalogChunker`, `INGEST_VERSION`), the query worker (`QueryService`), `DataEngine`;
   - `apps/tv/src/movies/movies-state.ts`: the rail (`railEntries`, "All movies" first) and the grid's chunk reads through `ChannelIndex`.
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Step 26e: "Recently added"** (its own PR).
   - **The data:** store the movies' `added` (Xtream `added`, epoch seconds as a string or number). Bump `INGEST_VERSION` so cached catalogs are read again.
   - **The query:** the query worker answers the newest movies across the sources from a capped list kept at ingest. Nothing scans 120k items.
   - **M3U movies have no date.** The step says "decide: the first refresh that saw it, or left out". The trade-off: a first-seen date gives every movie of a source's first refresh the same date (no order), so only later additions would sort. Make the call (not a gate), and record it as "Decided".
   - **The screen:** "Recently added" first in the movies rail, newest first.
   - **Done when:**
     - unit tests: the stored field (the version bump re-reads the catalogs), the newest across sources, the cap, M3U;
     - e2e in English and Arabic: the mock's movies in their `added` order;
     - the common items: `pnpm verify`, the poly count, engines on 53 and 68 if the movies screen changes (the old-engine walk does open the movies grid), CI green, PR merged.
   - **Watch for:**
     - **The rail's entries and indexes:** "Recently added" before "All movies" moves every rail index by one. `movies-state.test.ts`, `e2e/movies*.spec.ts` and the old-engine walk's movies steps (`tools/engines/src/movies.ts`, `onboarding.ts`) name rail rows.
     - **The ingest worker's budget** is 150 KB (127.9 KB now), the query worker's 150 KB (110.0 KB).
     - **TV bundle polyfills** (below): no `Array.from`, iterators or array destructuring in TV files.
2. **Then tick step 26 itself** (26a–26e all done) and go on to **step 27 (series)** in its own leg.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `6cdd006` Merge PR #73;
  - `b85c772` docs: tick 26d;
  - `cbfa796` Merge PR #72;
  - `26974ef` feat(movies): resume.
- **main** is `6cdd006`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links);
  - `dist/` (built by leg 69; `dist/packages` also holds three ipk files under the old name, harmless);
  - `.cache/rollup-wasm` (see the gotchas), `.cache/engines`, `.cache/media` (the real Blender films are in `.cache/media/open-movies`);
  - `artifacts/`: `poly-count20c2a.py`, `mutate26d.py` and `mutate26d-e2e.py` with their logs, screenshots, `artifacts/engines/`.
- **Docker Desktop** was running. Images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local` (the old-name tags can be untagged). No `lablo-chrome*` container is left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## What step 26d added (for reference)
- **Profile version 5:** `progress` by ContentKey (`{ positionMs, lengthMs, updated }`, the latest 500), edited one movie at a time with `editProfile({ kind: 'progress', key, progress })`.
- **`apps/tv/src/movies/movie-progress.ts`:** `createMovieProgress` (`load`, `point`, `share`, `save`, `version`), `isWatched`, `keptPoint`, `SAVE_EVERY_MS` (10 s), `WATCHED_TAIL_MS` (2 min), `WATCHED_SHARE` (0.95), `MIN_RESUME_MS` (10 s).
- **The player:** `MoviePlay.fromMs`, `PlayingMovie.fromMs` (`data-from` on the player), the options `progressed` and `lifecycle`.
- **The details:** `actions` (`'resume' | 'play' | 'back'`), `point`, `refresh()`; test ids `movie-resume`, `movie-play`, `movie-back`; `data-resume`.
- **The grid:** `Movies.progress(i)`, drawn as `Tile.progress` (the bar fills from the inline start).

## Gotchas and lessons
**New in leg 69:**
- **A hidden app's `<video>` is empty.** `Html5Engine.suspend` (webOS, desktop) closes the stream, so `positionMs()` reads 0 while the controller's state still says "playing". The player now saves first and then reads no position until `visible` (its `hidden` flag). Anything else that reads the position must do the same.
- **The lifecycle listeners' order matters.** The player subscribes when it is made (`createPlayer`); the controller subscribes on the first play (`appPlayer`), later, so the player's save runs first. DOM listeners fire in the order they were added.
- **An e2e key can beat an async read, even a cached one.** OK on a details button right after the details open runs before `vodInfo` answers (it goes through the query worker). The first e2e run passed by luck; a later one lost the length. Wait for `data-status="read"`, or hold the read in the mock to test the early path on purpose.
- **A new profile version breaks its pins.** The e2e `guides.spec.ts` and `onboarding.spec.ts` checked `v` to be 4 (now "4 or later"); the data tests use `PROFILE_VERSION`, and a "newer version" test uses 6. For the next bump, grep `toBe(5)`, `v: 5` and `v: 6`.
- **CI media can trip `test/epg-declared-300mb.media.test.ts`'s timing budgets** on a slow runner: store 74.1 ms against 60 and the first search 28.6 ms against 20 (8.4 and 2.2 ms on a desktop). Nothing in 26d touched it. `gh run rerun <run> --failed -R Omarmarei/Lablo` passed. If it trips again, the budgets need a look (a separate change).
- **Playwright's `expect.any(Number) as number` fails tsc** (AsymmetricMatcher). Write `expect.any(Number)` without the cast.
- **One mutant again:** `python -I -u artifacts/mutate26d.py --from=N --to=N+1`. Don't pipe its output through `head` (it cuts the line you want).
- **The app imports only types from `@lablo/data`,** so app-side readers of stored data repeat their checks (`movie-progress.ts`'s `readPoint` beside the data layer's `isWatchProgress`).

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests** (byte counts, glyph counts, chunk edges).
- **`pnpm install` after renaming workspace packages** keeps the lockfile's old order; `pnpm install --frozen-lockfile --offline` checks it.
- **`python -I` ignores `PYTHONIOENCODING`.** Call `sys.stdout.reconfigure(encoding='utf-8')` inside the script.
- **Chromium 68's V8 reads the zone through ICU, which ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free, and test any harness change on 68 too.
- **Hour-of-day effects:** the Playwright e2e runs at the machine's real clock. Assert the guide's cell, not the exact cursor minute.
- **Reproducing an old bug on the engines:** `git show HEAD:<file> > <file>`, `pnpm build:tv`, restore the file, run `verify:engines`.
- **`TaskStop` on a `verify:engines` run leaves its container.** Remove it with `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 15; done` loop (a foreground call times out at 10 min and moves to the background; that's fine).
- **GitHub billing can refuse every Actions job** ("recent account payments have failed"): a needs-you stop. Read `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`; re-run with `gh run rerun <run> -R Omarmarei/Lablo`.
- **The i18n runtime isolates every message argument** (marks plus FSI/PDI). A compound like "7.5/10" must be one argument; e2e strips the marks (`MARKS`).
- **The relay context check fires at about 450k tokens.**
- **There is no `jq` in Git Bash.** Use `gh … --jq`. Right after `gh pr create`, checks may not be listed yet: wait about 20 s.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the media e2e: `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/player-media.spec.ts -g <name>`;
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`).
- **The poly count:** `python -I -u artifacts/poly-count20c2a.py` right after the first build of new TV code. A member named `at` pulls `Array/String.at` in.
- **TV bundle polyfills:**
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files;
  - build lists with `for` loops (`.map` in JSX is already in);
  - the build can crash once (0xC0000005): run it again.
- **Bash heredocs feeding python lose backslashes or fail to parse.** Write scripts with the Write tool (in the scratchpad), then `python -I <file> "$WT"`. The Edit and Write tools decode `\u` escapes: build a backslash with `chr(92)` in python.
- **Python's `write_text` on Windows writes CRLF.** Use `write_bytes(s.encode('utf-8'))`.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`. (Leg 69 slipped once and moved the shell to `D:/tmp`; it had to `cd` back to the main checkout.)
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **CI media "Install ffmpeg" can hang:** `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays (real frames need `LABLO_E2E_MEDIA=1 ... --project=playback-media`, or `pnpm e2e:media`);
  - its movies are 201–206 (Big Buck Bunny 596 s, Sintel 888 s, Tears of Steel 734 s, Elephants Dream 658 s, the 4K pattern 60 s, the multi-audio file 120 s), each with an `added` some days ago.
- **Root tests can't import an apps/tv module that reaches `@lablo/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm e2e`, `e2e:media` or the engines run is going.** Docs are safe.
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
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #73), then push the branch.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally (leg 69):**
  - lint, typecheck, unit 4,359;
  - both TV builds: 219 core-js modules; main 377.5 KB (Tizen) / 364.8 KB (webOS);
  - `pnpm e2e` 106/106, `e2e:media` 13/13 (Big Buck Bunny left at about 5:01 resumed at 5:02);
  - Chromium 53 and 68: 16/16;
  - mutation 81 (73, then the 8 gaps closed, 8/8), e2e mutation 11/11.
- **Verified on CI (PR #72):** verify, engines and media green (media on its second try).
- **Not done:** any TV.
- **Migrations and deploys:** N/A (no backend until step 29). The profile's version 5 is a client-side, on-load migration with its own snapshot; nothing is deployed.

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies grid, the details, playing and resuming can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, and whether the low tier keeps posters in lists.
- **Later (unchanged, plus one):**
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
  - the movie details (and now resume) on the old-engine walk;
  - a walk at a second hour (00:xx, the backward crossing) if the engines job has time;
  - **new:** a resume place re-matched when a provider renumbers a movie (as favourites are), if users ask.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 26d (Omar)
1. **`pnpm dev`, then Movies → Big Buck Bunny → "Play".** Press FF once, then Back: the details now show "Resume from 5:00" (focused), "Play from the start" and "Back".
2. **Back to the grid:** Big Buck Bunny's poster has a bar about half way along its bottom.
3. **OK, then "Resume from 5:00":** the player opens at 5:00.
4. **Reload the page,** open Movies again: the bar and "Resume from 5:00" are still there.
5. **"Play from the start", then Back at once:** only "Play" and "Back" remain, and the bar is gone.
6. **In Arabic** (`?locale=ar-SA`): the buttons run right to left, «استئناف من 5:00» first, and the poster's bar fills from the right.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-three CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description;
  - 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid";
  - 32: the commands table could add the one-engine and one-throttled-spec commands;
  - 33: its "Repo: private `Omarmarei/Lablo`" line; the repo is public since 2026-11-05.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
