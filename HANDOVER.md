# Lablo IPTV: relay leg 72 opening prompt

You are leg 72 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–70 did steps 1–26 (all of 26a–26e, 26q, 26r; PRs #1–#75), except step 16's Samsung part, 19b and 21.
- **Leg 71** split step 27 (Series) into 27a–27d and did **27a, the series screen**:
  - PR #76, merged as `5d9bc03` on green CI on the first run (verify 7 m 46 s, engines 19 m 39 s, media 13 m 22 s);
  - PR #77 (docs), merged as `c53a291`: 27a ticked, leg 71's progress-log row.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`, step 27:**
   - its "Already built" and "Decided in leg 71" lists;
   - the 27a–27d split;
   - **27b**, your step: "A show's details: seasons and episodes";
   - the common items each sub-step's Done-when includes.
2. **`docs/architecture.md`:**
   - §1.2 "Built in step 27a" (the series screen);
   - §1.2 "Built in step 26c" (the movie details, which 27b's show details resemble);
   - §1.4 (`get_series_info` "fetched only when the user opens an item, and cached for 24 h").
3. **The code to build on:**
   - `packages/core/src/xtream.ts`: `decodeSeriesInfo` / `XtreamSeriesInfo` / `XtreamSeason` / `XtreamEpisode` (seasons; episodes sorted by season and number, each with its key `x:<src>:episode:<id>`, its `/series/…/<id>.<ext>` URL, `durationSecs`, `plot`, `image`), and `XtreamClient.seriesInfo`. Nothing calls them yet.
   - `packages/data/src/vod-info.ts`: the pattern for the read. `VodInfoCache` is 24 h and 100 items, a failure isn't kept, a "not found" is; `vodInfoTarget` takes the panel's id from the URL. It is wired through `QueryService.vodInfo` and `DataEngine.vodInfo`.
     - A show's item has `url: ''`, so its id must come from its key (`x:<src>:series:<id>`).
     - Its account comes from the source (an Xtream source, or an M3U `get.php` link; such a playlist has no shows, only episodes).
   - `apps/tv/src/movies/movie-details.ts` and `MovieDetailsScreen.tsx`: the details screen pushed on the live navigator, its read status, spinner and failure note.
   - `apps/tv/src/movies/movies-state.ts`: `selectSeries(item, { episode, show })`. `main.tsx` passes only `episode` today. 27b adds `show: (item) => seriesDetails.open(item)`.
   - The `e2e/series.spec.ts` step "OK on a show: its details come with step 27b; nothing opens yet" must change.
   - `LiveApp.tsx`: how a pushed screen paints instead of the screen under it (`MOVIE_SCREEN`, `SERIES_SCREEN`).
   - The mock:
     - series 301 ("Lablo Test Series", category 20, 4 days old): season 1 has episodes 3001–3003 (mkv, 300 s), season 2 has 3011–3012 (mp4, 240 s);
     - series 302 («مسلسل الاختبار», 2 days old): one season named «الموسم ١», episodes 3021–3022 (mp4, 180 s);
     - `get_series_info` serves `seasons` (with `name`; the mock defaults to "Season N"), `info`, and `episodes` keyed by season with `episode_num`, `title`, `container_extension` and `info.duration_secs` / `movie_image` / `plot`;
     - the images are `/images/series-<id>.png` and `/images/episode-<id>.png` (1x1 PNGs).
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check 27b isn't done** (grep `seriesInfo`, `SeriesInfo` in `packages/data` and `apps/tv`), then build it as RELAY.md says:
   - **The read:** `get_series_info` in the query worker, kept 24 h per show (a `SeriesInfoCache` next to `VodInfoCache`, or one cache generalised), `QueryService.seriesInfo`, `DataEngine.seriesInfo`.
   - **The screen:** OK on a show opens its details over the grid:
     - the cover, the title, the year, the rating, the genre and the plot;
     - a row of seasons ("Season 1", or the panel's name), then the season's episodes as a list (number, title, length; the bar from step 27c);
     - a spinner while the read is out, the catalog's facts and a note when it fails, "No episodes" when the panel lists none.
   - **Decide (record as "Decided", not gates):**
     - the layout: the seasons as a horizontal row of chips above a vertical list, or a rail; physical CSS, no flex `gap`, no CSS Grid;
     - whether OK on an episode does anything before 27c (likely nothing, or play it as 26c's movie);
     - where Back goes: the episodes go to the seasons, the seasons close.
   - **Then** the common items: unit tests, e2e en+ar with screenshots looked at, mutation (list first), `pnpm verify` parts, 219 core-js modules, PR merged, a "press these keys" checklist.
2. **Then 27c** (playing an episode, progress, auto-next) in a later leg. It needs a profile bump (the show's last episode) and an `e2e:media` resume check (PLAN's ±5 s gate).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `c53a291` Merge PR #77;
  - `17b998a` docs: tick 27a;
  - `5d9bc03` Merge PR #76;
  - `7f7d5b8` feat(series): the series screen.
- **main** is `c53a291`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links);
  - `dist/` (built by leg 71);
  - `.cache/rollup-wasm`, `.cache/engines`, `.cache/media` (the real Blender films are in `.cache/media/open-movies`);
  - `artifacts/`: `poly-count20c2a.py`, `mutate27a.py`, `mutate27a-e2e.py` and their logs, `build-27a.log`, `e2e-27a.log`, `e2e-media-27a.log`, `engines-27a.log`, and the screenshots (`series-*`).
- **Docker Desktop** was running. Images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`. No `lablo-chrome*` container is left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## What step 27a added (for reference)
- **`createMovies({ kind: 'series' })`** is the series screen. `Movies.kind` and `Movies.id`, `SERIES_SCREEN = 'series'`, `POSTER_SCREENS`, and reads by kind.
- **`MoviesScreen.tsx`'s `POSTER_WORDS`** ("Series", "All series", "Recently updated", «حُدّثت مؤخرًا») and `POSTER_TEST_IDS`: `series-screen`, `series-rail`, `series-grid`, `series-meta`, `series-chip-<i>`, tiles `show-<i>`. Also `data-kind`.
- **The header:** Guide 0, Movies 1, **Series 2**, Settings 3 (`HEADER_SERIES`, `openSeries`).
- **The data:** `RECENT_KINDS` `['movie', 'series']` (a show's `last_modified`), `INGEST_VERSION` 3.
- **A playlist's episodes:**
  - `Movies.episodes(i)`: an entry of playlists alone counts "7 episodes";
  - `selectSeries`: an item with a URL plays as a movie;
  - `episodeLabel`: a trailing "S01 E01" goes under the name as the tile's subtitle, on every tile.

## Gotchas and lessons
**New in leg 71:**
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text** (the marks the old-engine harness reads). A test-id change fails that root test: update its `marks` list.
- **The poster tile's title is two lines.** Names that differ only at the end look identical; look at grid screenshots for that.
- **One e2e:media spec alone:** `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/<spec> -g "…"`. The project doesn't exist without that env.
- **`playback-media.spec.ts` "an episode from 20 s in" flaked once** in the full local `e2e:media` (no open connection seen while it played) and then passed 3/3 alone. CI media was green. Rerun if it recurs; look closer only if it repeats.
- **ar-SA shows Western digits** in e2e texts ("7 حلقات").
- **A wait loop with `pgrep -f <word>` matches its own command line** and never ends. Wait on the background task's notice or a log marker.
- **The Write tool turned `\u200e…` in a regex literal into raw characters again.** Use `new RegExp(String.fromCharCode(…))`, as the other specs do.
- **A long `cat > x.py <<'EOF'` with mixed quotes failed to parse again;** short ones worked. Write patch scripts with the Write tool, and put a backslash in as `chr(92)` (or a placeholder that the script turns into one).

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **The navigator tells its listeners only when the focus actually moves.** A reload that keeps the same place fires nothing: a screen with held rows schedules its own rest.
- **Inserting a rail entry or a header button shifts every index** in the e2e specs, the throttled specs and the old-engine walk. Grep them first.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch, and strip CR before matching.
- **vitest `toEqual` ignores `undefined` properties.** Use `toStrictEqual` to pin a field's absence.
- **Mutation:** list the mutants before the run. Writing the list finds gaps: in leg 71 it showed the screen's title was never checked.
- **A hidden app's `<video>` is empty** (`Html5Engine.suspend`). The player saves first and reads no position until `visible`.
- **An e2e key can beat an async read, even a cached one.** Wait for `data-status="read"`, or hold the read in the mock (`app.addHook('onRequest')`, as `movie-details.spec.ts` does for `get_vod_info`).
- **A new profile version breaks its pins.** Grep `toBe(5)`, `v: 5` and `v: 6` on the next bump (27c will likely bump).
- **CI media can trip `test/epg-declared-300mb.media.test.ts`'s timing budgets** on a slow runner: `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **The app imports only types from `@lablo/data`** (constants through `@lablo/data/client` only).
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests.**
- **`python -I` ignores `PYTHONIOENCODING`.** Call `sys.stdout.reconfigure(encoding='utf-8')` inside the script.
- **Chromium 68's V8 reads the zone through ICU, which ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free.
- **Hour-of-day effects:** the Playwright e2e runs at the machine's real clock. Assert the guide's cell, not the exact cursor minute.
- **`TaskStop` on a `verify:engines` run leaves its container.** Remove it with `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 15; done` loop, a background command, or the Monitor tool (leg 14's `gh pr checks` command in memory).
- **GitHub billing can refuse every Actions job:** a needs-you stop. Read `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`.
- **The i18n runtime isolates every message argument.** A compound like "7.5/10" must be one argument; e2e strips the marks (`MARKS`).
- **The relay context check fires at about 450k tokens.**
- **There is no `jq` in Git Bash.** Use `gh … --jq`. Right after `gh pr create`, checks may not be listed yet: wait about 20 s.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the media e2e: `pnpm --dir "<wt>" e2e:media` (13 tests, about 2 min);
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`).
- **The poly count:** `python -I -u artifacts/poly-count20c2a.py "<wt>"` right after the first build of new TV code. A member named `at` pulls `Array/String.at` in.
- **TV bundle polyfills:**
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files;
  - build lists with `for` loops (`.map` in JSX is already in);
  - `Promise.all([...] as const)` with indexed reads replaces destructuring;
  - the build can crash once (0xC0000005): run it again.
- **Python's `write_text` on Windows writes CRLF.** Use `write_bytes(s.encode('utf-8'))` or `open(p, 'wb')`.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **CI media "Install ffmpeg" can hang:** `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately (all fine in leg 71).
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays (real frames need `pnpm e2e:media`);
  - its movies are 201–206, dated 1–13 days back.
- **Root tests can't import an apps/tv module that reaches `@lablo/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm e2e`, `e2e:media` or the engines run is going.** Docs and e2e specs are safe during a unit mutation run.
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
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #77), then push the branch.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally (leg 71):**
  - lint, typecheck, unit 4,440;
  - both TV builds: 219 core-js modules; main 381.9 KB (Tizen) / 369.2 KB (webOS); workers unchanged (ingest 129.0 KB, query 110.9 KB);
  - `pnpm e2e` 110/110, including `series.spec.ts`: en and ar, a panel's shows and a playlist's episodes;
  - `e2e:media` 12/13: the one flake above, then 3/3 alone;
  - Chromium 53 and 68: 16/16 (America/Panama, 21:10);
  - mutation 40/40, e2e mutation 24/24.
- **Verified on CI (PR #76):** verify, engines and media green on the first run.
- **Not done:**
  - any TV;
  - the series screen on the old-engine walk (the walk's fixture is a playlist with no series lines, and it never opens "Series");
  - an e2e of a catalog swap under an open series screen (the swap is unit-tested).
- **Migrations and deploys:** N/A (no backend until step 29). `INGEST_VERSION` 3 rebuilds stored catalogs at the first refresh check; no IDB migration. Nothing is deployed.

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies and series grids, the details, playing and resuming can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, and whether the low tier keeps posters in lists.
- **For step 38 (parental):** "Recently added" and "Recently updated" hold every category's items, adult ones included: the lock must filter them too.
- **Later (unchanged, plus leg 71's):**
  - group a playlist's episodes into shows by name, if users ask (leg 71 decided flat);
  - the series screen on the old-engine walk (needs series lines in its fixture);
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
  - the movie details, resume and "Recently added" on the old-engine walk;
  - a walk at a second hour (00:xx) if the engines job has time;
  - a resume place re-matched when a provider renumbers a movie, if users ask.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 27a (Omar)
1. **`pnpm dev` with the mock's Xtream source.** UP to the header: "Guide", "Movies", "Series", "Settings". RIGHT twice to "Series", then OK.
2. **The series screen** opens on "Recently updated · 2 series": «مسلسل الاختبار» first, then "Lablo Test Series". The rail lists "Recently updated", "All series", "Test Series | مسلسلات تجريبية".
3. **OK on a show does nothing yet** (its details are step 27b). LEFT to the rail, DOWN, OK on "All series": "Lablo Test Series" first.
4. **Back** goes to the rail. Back again: the header on "Series". RIGHT once more reaches "Settings".
5. **In Arabic** (`?locale=ar-SA`): «المسلسلات» in the header, «حُدّثت مؤخرًا» first in the rail on the right, the grid filled from the right.
6. **A playlist source** (the mock's `get.php?…&type=m3u_plus` as an M3U link): "Series" shows "All series · 7 episodes". There is no "Recently updated". The seven tiles each show "S01 E01"… under the show's name.
7. **OK on a playlist's episode:** its details (the line's facts). "Play" asks for `/series/…/3001.mkv`, Back returns to the details, then the grid.
8. **A browser that stored a catalog before this change:** about 15 s into the live screen it is downloaded again (`INGEST_VERSION` 3), and "Recently updated" appears.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
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
