# Lablo IPTV: relay leg 73 opening prompt

You are leg 73 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–71 did steps 1–27a (all of 26a–26e, 26q, 26r; PRs #1–#77), except step 16's Samsung part, 19b and 21.
- **Leg 72** did **27b, a show's details: its seasons and episodes**:
  - PR #78, merged as `9a6b9ee` (verify 8 m 9 s, engines 18 m 50 s, media 10 m 14 s). The media job's first run tripped `test/epg-declared-300mb.media.test.ts`'s 60 ms budget at 75 ms, the known slow-runner flake; `gh run rerun --failed` passed.
  - PR #79 (docs), merged as `c4cce7b`: 27b ticked, leg 72's progress-log row.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`, step 27:**
   - "Already built", "Decided in leg 71", the 27a–27d split, the common items each sub-step's Done-when includes;
   - **27b's "Done in leg 72" and "Decided in leg 72"**;
   - **27c**, your step: "Playing an episode: progress and auto-next" (its Done-when includes PLAN's ±5 s resume gate through `e2e:media`).
2. **`docs/architecture.md` §1.2:**
   - "Built in step 27b" (the show's details);
   - "Built in step 26c" (the movie's details and `playMovie`), "Built in step 26d" (resume: `progress`, `createMovieProgress`, the bar);
   - "Built in step 27a" (the series screen, `selectSeries`).
3. **The code to build on:**
   - **`apps/tv/src/shows/show-details.ts`:**
     - `createShowDetails({ nav, engine })`. Its `onSelect` does nothing on an episode yet (`SHOW_EPISODES`). 27c adds a `play` option, called with the show, the episode, and the answer (`XtreamSeriesInfo`).
     - `ShowDetailsShown.seasons` (each `ShowSeason` has its `episodes`, in the panel's order) and `season` (the index on show).
     - `episodeLine` (number, title, length).
     - Back goes episodes → seasons → close. 27c's "Back from the player returns to the details on that episode" needs `screen.focus(SHOW_EPISODES, i)` after the season is set (`showSeason`).
   - **`ShowDetailsScreen.tsx`'s `EpisodeRow`:** add the bar there (the movies' `ProgressBar` from `@lablo/ui`, as `MoviesScreen` draws a tile's bar), and "Resume from 2:34" where it fits.
   - **The episodes:** `XtreamEpisode` (core): `key` (`x:<src>:episode:<id>`), `url` (`/series/<u>/<p>/<id>.<ext>`), `durationSecs`, `title`, `season`, `episodeNum`.
   - **The movie path to reuse:**
     - `apps/tv/src/movies/movie-details.ts`: `movieRequest(item, info)` builds a `PlayRequest`, `mode: 'vod'`.
     - `main.tsx`'s `details.play`: `player?.playMovie({ item, request, lengthMs, fromMs?, closed })`.
     - `player-state.ts`: `playMovie(film: MoviePlay)` (line ~293/1071).
     - `PlayerScreen.tsx`: the movie's info bar and `MovieEndCard` (the end card becomes "Next: S1 E3 · title" with a 10 s countdown).
   - **Progress:**
     - `apps/tv/src/movies/movie-progress.ts`: `SAVE_EVERY_MS`, `WATCHED_TAIL_MS`, `WATCHED_SHARE`, `MIN_RESUME_MS`, `keptPoint`, `createMovieProgress`.
     - `main.tsx`'s `progressed` saves through `progress.save(key, …)`.
     - The profile: `packages/data/src/profile.ts`, `PROFILE_VERSION` = migrations + 1 (now 5), `progress: Record<ContentKey, WatchProgress>`, `MAX_PROGRESS`.
     - 27c must decide where a show's last episode lives (in the progress entry, or a small `series` map). Either way it is a profile bump to v6 with a migration.
   - **The mock:**
     - show 301 has season 1 (3001–3003, mkv, 300 s) and season 2 (3011–3012, mp4, 240 s);
     - show 302 has «الموسم ١» (3021–3022, mp4, 180 s);
     - `/series/<u>/<p>/<id>.<ext>` is served (synthetic media; real frames only under `pnpm e2e:media`).
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check 27c isn't done** (grep `playEpisode`, `nextEpisode`, `autoNext` in `apps/tv/src`), then build it as RELAY.md says:
   - **Playing:** OK on an episode plays it (`mode: 'vod'`, the movie player's seek bar, pause and seeking). The info bar names the show and "S1 E2 · title". Back returns to the details on that episode.
   - **Progress:**
     - the episode's place by its key, under the movies' rules (every 10 s, on stop, leave and hide; watched near the end);
     - "Resume from 2:34" on a part-watched episode;
     - the episodes' bars.
     - The show remembers its last episode. Decide where and record it as "Decided": a profile bump either way. Grep `toBe(5)`, `v: 5`, `v: 6` and `>= 4` in the specs first.
   - **Auto-next:**
     - at an episode's end, a card "Next: S1 E3 · title" with a 10 s countdown, "Play now" and "Back";
     - the next episode is the next in the panel's order, across seasons; there is none after the last.
   - **Done when:**
     - unit tests: the request, the saves, the last episode, the next episode across seasons, the countdown, Back;
     - e2e in en and ar: play, leave, the bar, resume; the end of S1 E3 starts S2 E1. The mock's media never ends by itself: use the player's test hooks or a short real file under `e2e:media`;
     - `e2e:media`: an episode resumes within 5 s of where it was left;
     - plus the common items: mutation (list first), the `pnpm verify` parts, 219 core-js modules, PR merged, and a "press these keys" checklist.
   - 27c is big. If it doesn't fit one leg, split it in RELAY.md (e.g. 27c1 play + progress + profile bump, 27c2 auto-next) and do the first.
2. **Then 27d**, "Continue watching", in a later leg.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `c4cce7b` Merge PR #79;
  - `672aa58` docs: tick 27b;
  - `9a6b9ee` Merge PR #78;
  - `96e5a28` feat(series): a show's details.
- **main** is `c4cce7b`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links);
  - `dist/` (built by leg 72 from `96e5a28`'s code);
  - `.cache/rollup-wasm`, `.cache/engines`, `.cache/media` (the real Blender films are in `.cache/media/open-movies`);
  - `artifacts/`:
    - `mutate27b.py`, `mutate27b-e2e.py` and their logs (`-b` reruns);
    - `build-27b.log`, `unit-27b.log`, `e2e-27b.log`, `engines-27b.log`;
    - the screenshots (`show-details-*`).
- **Docker Desktop** was running. Images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`. No `lablo-chrome*` container is left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## What step 27b added (for reference)
- **The read:**
  - `packages/data/src/series-info.ts`: `SeriesInfoCache`, 24 h, 20 shows.
  - `seriesInfoTarget(src, key, account)` takes the id from `x:<src>:series:<id>` and the account from the source.
  - `QueryService.seriesInfo` and `DataEngine.seriesInfo({ src, key })`.
  - `packages/data/src/panel-answers.ts`: `PanelAnswers<T>`, which `VodInfoCache` now uses too.
  - Core's `XtreamSeriesInfo.releaseDate`.
- **The screen:** `apps/tv/src/shows/` (`show-details.ts`, `ShowDetailsScreen.tsx`, `show.css`), screen id `show`, zones `seasons` (horizontal, 6 in view) and `episodes` (vertical, 5 in view).
  - **Test ids:** `show-details`, `show-poster`, `show-title`, `show-group`, `show-facts`, `show-genre`, `show-plot`, `show-spinner`, `show-failed`, `show-empty`, `show-seasons`, `season-<i>`, `show-episodes`, `episode-<i>` (with `data-key`).
  - **Data attributes:** the root has `data-status`, `data-pending`, `data-key` and `data-season`.
  - **Geometry** (SHOW in show-details.ts): a 300 px top band with a 200 × 300 cover, then 24 px, 64 px chips 264 px wide and 16 px apart, 24 px, then 88 px rows 8 px apart.
- **Words:** `show.reading`, `show.failed`, `show.noEpisodes`, `show.season` ("Season {n}", «الموسم {n}»), `show.episode`. A season shows its panel's name unless it says only "Season N"/"SN" (`seasonName`). No count on a chip.
- **Wiring:**
  - `main.tsx`: `createShowDetails`, `selectSeries(item, { episode, show })` (`show` is now required).
  - `LiveApp.tsx` paints `SHOW_SCREEN`.
  - `lengthText` is exported from `MovieDetailsScreen.tsx`.

## Gotchas and lessons
**New in leg 72:**
- **A spec's `page.route('**/series/**')` held the dev server's modules from an app folder `/src/series/`:** `page.goto` hung for 90 s. The app's folder is `shows/`, and specs match the panel's stream path (`` `**/series/${U}/${P}/**` ``). Never name an app folder like a mock URL segment (`live`, `movie`, `series`, `timeshift`).
- **Every formatted number comes wrapped in marks in e2e text:** "Season ⁨1⁩", "⁨5⁩ min", row numbers. `show-details.spec.ts`'s `readShow` strips `MARKS` from each field.
- **A chip count next to a label ending in a digit reads as one number.** Only the screenshot showed it.
- **`fits(extent, item)` without the gap gives the same 6 seasons / 5 episodes** with these sizes: that mutant is equivalent. The e2e pins the geometry instead.
- **CI media flaked again on `test/epg-declared-300mb.media.test.ts`** (75 ms of 60): rerun the failed job.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text** (the old-engine harness's marks). A test-id change there fails that root test.
- **The poster tile's title is two lines.** Names that differ only at the end look identical.
- **One e2e:media spec alone:** `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/<spec> -g "…"`.
- **`playback-media.spec.ts` "an episode from 20 s in" flaked once** in a full local `e2e:media` (leg 71). Rerun it; look closer only if it repeats.
- **ar-SA shows Western digits** in e2e texts ("7 حلقات", «الموسم 1»).
- **A wait loop with `pgrep -f <word>` matches its own command line.** Wait on the background task's notice or a log marker.
- **The Write tool turns `\u200e…` in a regex literal into raw characters.** Use `new RegExp(String.fromCharCode(…))`.
- **Long `cat > x.py <<'EOF'` scripts with mixed quotes can fail to parse.** Short python patches through `python -I - <args> <<'EOF'` with exact `assert s.count(a) == 1` replacements worked all through leg 72. A backslash goes in as `chr(92)`.
- **The navigator tells its listeners only when the focus actually moves.** A reload that keeps the same place fires nothing.
- **Inserting a rail entry or a header button shifts every index** in the e2e specs, the throttled specs and the old-engine walk. Grep them first.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch.
- **vitest `toEqual` ignores `undefined` properties.** Use `toStrictEqual` to pin a field's absence.
- **Mutation:** list the mutants before the run. Writing the list finds gaps; in leg 72 it removed three redundant lines that would have been equivalent mutants.
- **A hidden app's `<video>` is empty** (`Html5Engine.suspend`). The player saves first and reads no position until `visible`.
- **An e2e key can beat an async read, even a cached one.** Wait for `data-status="read"`, or hold the read in the mock (`app.addHook('onRequest')`, as `movie-details.spec.ts` and `show-details.spec.ts` do).
- **A new profile version breaks its pins.** Grep `toBe(5)`, `v: 5`, `v: 6`, `>= 4` on the bump (27c will bump).
- **The app imports only types from `@lablo/data`** (constants through `@lablo/data/client` only).
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests.**
- **`python -I` ignores `PYTHONIOENCODING`.** Call `sys.stdout.reconfigure(encoding='utf-8')` inside the script.
- **Chromium 68's V8 reads the zone through ICU, which ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free.
- **Hour-of-day effects:** the Playwright e2e runs at the machine's real clock.
- **`TaskStop` on a `verify:engines` run leaves its container.** Remove it with `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop in a background command.
- **Right after `gh pr create`, checks may not be listed yet:** the wait loop must also treat "no checks reported" as pending. After `gh run rerun --failed`, read `gh pr checks` again: the loop can exit on the stale "fail".
- **GitHub billing can refuse every Actions job:** a needs-you stop. Read `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`.
- **The i18n runtime isolates every message argument.** A compound like "7.5/10" must be one argument.
- **The relay context check fires at about 450k tokens.**
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the media e2e: `pnpm --dir "<wt>" e2e:media` (13 tests, about 2 min);
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`);
  - the poly count: `python -I -u artifacts/poly-count20c2a.py "<wt>"` right after the first build of new TV code.
- **TV bundle polyfills:**
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files (object destructuring is fine);
  - a member named `at` pulls `Array/String.at` in;
  - the build can crash once (0xC0000005): run it again.
- **Python's `write_text` on Windows writes CRLF.** Use `open(p, 'w', encoding='utf-8', newline='')`.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **CI media "Install ffmpeg" can hang:** `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately (all fine in leg 72).
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays (real frames need `pnpm e2e:media`);
  - its movies are 201–206, dated 1–13 days back;
  - its shows are 301 and 302 (4 and 2 days).
- **Root tests can't import an apps/tv module that reaches `@lablo/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm e2e`, `e2e:media` or the engines run is going.** Docs are safe. Don't run the unit and e2e mutation scripts at the same time: both mutate files the other reads.
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
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #79), then push the branch.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally (leg 72):**
  - lint, typecheck, unit 4,481;
  - both TV builds: 219 core-js modules; main 389.0 KB (Tizen) / 376.3 KB (webOS); query worker 114.7 KB; ingest 129.1 KB; app.css 87.7 KB;
  - `pnpm e2e` 114/114, including `show-details.spec.ts` (en-US, ar-SA) and `series.spec.ts`;
  - Chromium 53 and 68: 16/16 (America/Regina, 21:12);
  - mutation 78/80 (2 equivalent), e2e mutation 32/32.
- **Verified on CI (PR #78):** verify and engines green; media green on the rerun.
- **Not done:**
  - `e2e:media` locally (27b doesn't touch the player; CI media passed);
  - any TV;
  - the show details on the old-engine walk (its fixture is a playlist with no shows);
  - en-XA on the show details (chips cut long labels with an ellipsis; not checked by a spec).
- **Migrations and deploys:** N/A (no backend until step 29; no IDB or profile change in 27b). Nothing is deployed.

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies and series grids, the details (movie and show), playing and resuming can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, whether the low tier keeps posters in lists, and the memory of 20 kept shows' answers (a panel show can list hundreds of episodes).
- **For step 38 (parental):** "Recently added" and "Recently updated" hold every category's items, adult ones included: the lock must filter them too.
- **Later (unchanged, plus leg 72's):**
  - an episode's image in its row, or the focused episode's plot in a bigger place, if users ask;
  - the show's details and the series screen on the old-engine walk (needs Xtream shows in its fixture);
  - group a playlist's episodes into shows by name, if users ask (leg 71 decided flat);
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

## "Press these keys" checklist for step 27b (Omar)
1. **`pnpm dev` with the mock's Xtream source.** UP to the header, RIGHT twice to "Series", OK. The grid opens on "Recently updated": «مسلسل الاختبار», then "Lablo Test Series".
2. **RIGHT to "Lablo Test Series", OK.** The details show "Series" and the clock at the top, then the cover (blank: the mock's image is 1×1), "Lablo Test Series", the category, "2026 · Rated 8/10", "Test" and the plot.
   - Below: chips "Season 1" (marked) and "Season 2".
   - Three episodes: "1 Pilot - Colour Bars 5 min", "2 Tone and Clock", "3 Lip Sync". The first is focused.
3. **DOWN twice:** the third episode. DOWN again stays there. UP twice, then UP once more: the "Season 1" chip.
4. **RIGHT:** "Season 2" is marked, and the list shows "1 Return of the Bars 4 min", "2 Finale". DOWN to the episodes, DOWN to "Finale". OK does nothing yet (playing is step 27c).
5. **Back:** the focus goes to "Season 2". DOWN goes back to "Finale". Back, Back: the grid on "Lablo Test Series".
6. **OK again:** the details come back at once (kept 24 h), on Season 1.
7. **Back, LEFT, OK on «مسلسل الاختبار»:** one chip, «الموسم ١» (the panel's own name), and two episodes, «الحلقة الأولى» and «الحلقة الثانية», «3 min».
8. **In Arabic** (`?locale=ar-SA`): the cover on the right, «الموسم 1» and «الموسم 2» for show 301, the lengths «5 د» on the left of each row.
9. **A playlist source** (the mock's `get.php` as an M3U link): OK on an episode tile still opens the movie details as before (unchanged).

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
