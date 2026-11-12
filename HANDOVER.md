# Lablo IPTV: relay leg 71 opening prompt

You are leg 71 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–69 did steps 1–25, 26a–26d, 26q and 26r (PRs #1–#73), except step 16's Samsung part, 19b and 21.
- **Leg 70** did step 26e, "Recently added", and closed step 26 (Movies):
  - PR #74, merged as `ea99f23` on green CI on the first run (verify 7 m 4 s, engines 17 m 32 s, media 9 m 20 s);
  - PR #75 (docs), merged as `f338155`: 26e and 26 ticked, leg 70's progress-log row.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - step **27** (Series: "Seasons and episodes, progress, 'Continue watching', auto-next"; Done when: resume accurate to ±5 s). It has no sub-steps yet.
   - step 26's split (26a–26e) and its common items. Step 27 follows the same pattern: unit tests, e2e in en and ar with the screenshots looked at, a mutation run with the list written first, `pnpm verify`, 219 core-js modules, the PR merged, a "press these keys" checklist.
2. **`docs/architecture.md`:**
   - §1.2 "Built in step 26a" to "Built in step 26e": the movies screen, the details, the player's movie mode, resume and "Recently added". Series will build on all of them.
   - §1.3: the profile document (version 5, `progress` by ContentKey, the latest 500).
   - §1.4: the ingest (`INGEST_VERSION` 2, `RECENT_KINDS`).
3. **The code to build on:**
   - `packages/core/src/xtream.ts`:
     - `decodeListItem` for series (`url: ''`, the cover, `last_modified` as `added`);
     - `decodeSeriesInfo` / `XtreamSeriesInfo` and `XtreamClient.seriesInfo` (`get_series_info`: seasons, episodes). Nothing in the data layer or the app calls them yet.
   - `packages/core/src/m3u-catalog.ts`: a playlist's `/series/` lines are kind `series`, one item per episode (no show grouping).
   - `packages/data/src/vod-info.ts`: the pattern for `get_series_info` (read in the query worker, kept 24 h).
   - `packages/data/src/recent.ts`: `RECENT_KINDS` is `['movie']`; adding `'series'` stores a list for series too (`last_modified`).
   - `apps/tv/src/movies/`: `movies-state.ts` (the rail and grid, "Recently added"), `movie-details.ts`, `movie-progress.ts` (resume), and the player's `playMovie`.
   - The mock: series 301 (Lablo Test Series: two seasons, 5 episodes, mkv and mp4) and 302 (Arabic), in `apps/mock-provider/fixtures/catalog.yaml`; `get_series_info` is served.
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check step 27, then split it** in RELAY.md, as leg 64 split step 26.
   - Grep first: nothing series-specific exists in the app or the data layer beyond the catalog itself.
   - A likely split:
     - **27a:** the series screen (header button or a rail of its own, reusing the poster grid);
     - **27b:** a show's details with seasons and episodes (`get_series_info` in the query worker, kept 24 h);
     - **27c:** playing an episode, its progress (profile `progress` by the episode's key) and auto-next;
     - **27d:** "Continue watching" (movies and episodes left part way, newest first).
   - Decide (not gates, record them as "Decided"):
     - how a playlist's `/series/` episodes are grouped into shows (by name parsing like "Show S01 E01", or listed flat);
     - whether series join "Recently added" (`RECENT_KINDS`, `last_modified`; that would need another `INGEST_VERSION` bump);
     - where the header's buttons go (Guide 0, Movies 1, Settings 2 today: a new button moves "Settings" and every spec and old-engine step that reaches it).
2. **Then do 27a** in the same leg if the split was light, else hand over.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `f338155` Merge PR #75;
  - `ca85216` docs: tick 26e and 26;
  - `ea99f23` Merge PR #74;
  - `0d69017` feat(movies): "Recently added".
- **main** is `f338155`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links);
  - `dist/` (built by leg 70);
  - `.cache/rollup-wasm` (see the gotchas), `.cache/engines`, `.cache/media` (the real Blender films are in `.cache/media/open-movies`);
  - `artifacts/`: `poly-count20c2a.py`; `mutate26e.py`, `mutate26e-e2e.py` and their logs; the screenshots; `e2e-26e.log`, `e2e-media-26e.log`, `engines-26e.log`.
- **Docker Desktop** was running. Images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`. No `lablo-chrome*` container is left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## What step 26e added (for reference)
- **`packages/data/src/recent.ts`:** `RecentList` (the newest 100, sorted, equal dates in arrival order, items copied with owned strings), `mergeRecent`, `RECENT_MAX` (100), `RECENT_KINDS` (`['movie']`).
- **The store:** the movie categories record is `{ cats, recent }` (`putCatalogKind`'s new last argument, `readRecent`).
- **`ingest-version.ts`:** `INGEST_VERSION` 2, also exported through `@lablo/data/client`. The refresh schedule's `catalogRefreshDue` makes an older version's catalog due at its first check.
- **The query:** `QueryService.recent({ sources, kind, limit })`, `DataEngine.recent`.
- **The screen:**
  - `MovieEntry` = `RecentEntry | RailEntry`; "Recently added" is rail entry 0 when a movie has a date, and the screen opens on it;
  - its movies are held in memory (`held`), with no chunk reads;
  - a swap finds the entry again by `'recent' | 'all' | { src, name }`.
- **The mock's films** now have `added_days_ago`: Big Buck Bunny 1, Sintel 2, the multi-audio film 3, Elephants Dream 5, Tears of Steel 8, the 4K pattern 13. The first two tiles are still Big Buck Bunny and Sintel.

## Gotchas and lessons
**New in leg 70:**
- **The navigator tells its listeners only when the focus actually moves.** A reload that keeps the same place and count fires nothing. A screen whose rows need no chunk read must schedule its own rest after a reload (`movies-state.ts`'s `if (held !== null) scheduleRest()`).
- **Inserting a rail entry shifts every index.** `e2e/movies*.spec.ts`, the throttled spec's `movieAt`, and the old-engine walk name rail rows. The walk's fixture is a playlist, so its movies screen has no "Recently added".
- **The throttled movies spec** opens on "Recently added" (the 100 newest of 20,000: every 30th movie, `RECENT_EVERY`), then goes LEFT, DOWN and OK to "All movies" (`ALL = 1`); category 30 is rail entry 31.
- **Some working copies are CRLF while git stores LF** (`e2e/movies-throttled.spec.ts` showed `w/crlf`). Run `git ls-files --eol -- <files>` before scripting a patch, and strip CR (`chr(13)`) before matching.
- **A long `cat > tmp/x.py <<'EOF'` still fails to parse.** Write patch scripts with the Write tool.
- **vitest `toEqual` ignores `undefined` properties.** Use `toStrictEqual` to pin a field's absence.
- **Mutation:** list the mutants before the run. Listing them found four redundant pieces (taken out); the run found one equivalent mutant and three test gaps.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **A hidden app's `<video>` is empty** (`Html5Engine.suspend`). The player saves first and reads no position until `visible`. Anything else that reads the position must do the same.
- **An e2e key can beat an async read, even a cached one.** Wait for `data-status="read"`, or hold the read in the mock.
- **A new profile version breaks its pins.** Grep `toBe(5)`, `v: 5` and `v: 6` on the next bump.
- **CI media can trip `test/epg-declared-300mb.media.test.ts`'s timing budgets** on a slow runner: `gh run rerun <run> --failed -R Omarmarei/Lablo`. If it trips again, the budgets need a look (a separate change).
- **The app imports only types from `@lablo/data`** (constants through `@lablo/data/client` only). App-side readers of stored data repeat their checks.
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests** (byte counts, glyph counts, chunk edges).
- **`python -I` ignores `PYTHONIOENCODING`.** Call `sys.stdout.reconfigure(encoding='utf-8')` inside the script.
- **Chromium 68's V8 reads the zone through ICU, which ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free, and test any harness change on 68 too.
- **Hour-of-day effects:** the Playwright e2e runs at the machine's real clock. Assert the guide's cell, not the exact cursor minute.
- **`TaskStop` on a `verify:engines` run leaves its container.** Remove it with `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 15; done` loop, or a background command and wait for its notice.
- **GitHub billing can refuse every Actions job** ("recent account payments have failed"): a needs-you stop. Read `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`; re-run with `gh run rerun <run> -R Omarmarei/Lablo`.
- **The i18n runtime isolates every message argument** (marks plus FSI/PDI). A compound like "7.5/10" must be one argument; e2e strips the marks (`MARKS`).
- **The relay context check fires at about 450k tokens.**
- **There is no `jq` in Git Bash.** Use `gh … --jq`. Right after `gh pr create`, checks may not be listed yet: wait about 20 s.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the media e2e: `pnpm --dir "<wt>" e2e:media` (13 tests, about 2 min);
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`).
- **The poly count:** `python -I -u artifacts/poly-count20c2a.py` right after the first build of new TV code. A member named `at` pulls `Array/String.at` in.
- **TV bundle polyfills:**
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files;
  - build lists with `for` loops (`.map` in JSX is already in);
  - `Promise.all([...] as const)` with indexed reads replaces destructuring;
  - the build can crash once (0xC0000005): run it again.
- **Bash heredocs feeding python lose backslashes or fail to parse.** Write scripts with the Write tool (in the scratchpad), then `python -I <file> "$WT"`. The Edit and Write tools decode `\u` escapes: build a backslash with `chr(92)` in python.
- **Python's `write_text` on Windows writes CRLF.** Use `write_bytes(s.encode('utf-8'))`.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **CI media "Install ffmpeg" can hang:** `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately (all fine in leg 70).
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays (real frames need `pnpm e2e:media`);
  - its movies are 201–206 (Big Buck Bunny 596 s, Sintel 888 s, Tears of Steel 734 s, Elephants Dream 658 s, the 4K pattern 60 s, the multi-audio file 120 s), dated as above.
- **Root tests can't import an apps/tv module that reaches `@lablo/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm e2e`, `e2e:media` or the engines run is going.** Docs are safe.
- **Code rules:**
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs (ar.ts has no comments);
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only, no CSS Grid or flex `gap`;
  - TV code is ES2017;
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
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #75), then push the branch.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally (leg 70):**
  - lint, typecheck, unit 4,391;
  - both TV builds: 219 core-js modules; main 378.4 KB (Tizen) / 365.7 KB (webOS); ingest worker 129.0 KB, query worker 110.9 KB;
  - `pnpm e2e` 106/106 (the throttled movies run: opening 57–64 ms, every press within 150 ms), `e2e:media` 13/13;
  - Chromium 53 and 68: 16/16 (America/Puerto_Rico, 21:17);
  - mutation 57 (53 caught, 1 equivalent, 3 gaps closed and re-run 3/3), e2e mutation 7/7.
- **Verified on CI (PR #74):** verify, engines and media green on the first run.
- **Not done:** any TV.
- **Migrations and deploys:** N/A (no backend until step 29). The movie categories record's new field needs no IDB migration: `INGEST_VERSION` 2 rebuilds the older records at the first check. Nothing is deployed.

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies grid ("Recently added" included), the details, playing and resuming can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, and whether the low tier keeps posters in lists.
- **For step 38 (parental):** "Recently added" holds movies of every category, adult ones included: the lock must filter it too.
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
  - the movie details, resume and "Recently added" on the old-engine walk (its fixture is a playlist);
  - a walk at a second hour (00:xx, the backward crossing) if the engines job has time;
  - a resume place re-matched when a provider renumbers a movie, if users ask.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 26e (Omar)
1. **`pnpm dev` with the mock's Xtream source, then Movies.** The screen opens on "Recently added" (first in the rail, focused grid): Big Buck Bunny, Sintel, اختبار الصوت المتعدد, Elephants Dream, Tears of Steel, Lablo Test Pattern 4K HEVC. The header reads "Recently added · 6 movies".
2. **LEFT, DOWN, OK on "All movies":** the panel's order (Big Buck Bunny, Sintel, Tears of Steel, Elephants Dream, the 4K pattern, the multi-audio film).
3. **LEFT, UP, OK:** back on "Recently added".
4. **In Arabic** (`?locale=ar-SA`): «أضيف حديثًا» first in the rail on the right, the grid filled from the right.
5. **A browser that stored a catalog before this change:** within about 15 s of the live screen it is downloaded again (`INGEST_VERSION` 2), and "Recently added" appears in the open movies screen.
6. **A playlist (M3U) source alone:** no "Recently added"; Movies opens on "All movies".

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
