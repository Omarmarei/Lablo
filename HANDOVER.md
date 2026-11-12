# Lablo IPTV: relay leg 74 opening prompt

You are leg 74 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–72 did steps 1–27b (all of 26a–26e, 26q, 26r; PRs #1–#79), except step 16's Samsung part, 19b and 21.
- **Leg 73** split step 27c into **27c1** and **27c2**, and did **27c1, playing an episode, its place, and the show's last episode**:
  - PR #80, merged as `ce38653` (verify 9 m 18 s, engines 19 m 42 s, media 9 m 26 s). The media job's first run tripped `test/epg-declared-300mb.media.test.ts` (its 20 ms search budget at 20.2 ms), the known slow-runner flake; `gh run rerun --failed` passed.
  - PR #81 (docs), merged as `ff32931`: the split, 27c1 ticked, leg 73's progress-log row.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`, step 27:**
   - "Already built", "Decided in leg 71", the 27a–27d split, the common items each sub-step's Done-when includes;
   - **27c** (the original scope) and **27c1's "Done in leg 73" and "Decided in leg 73"**;
   - **27c2**, your step: "Auto-next".
2. **`docs/architecture.md` §1.2:**
   - "Built in step 27c1" (the episode's play, its place, the show's last episode);
   - "Built in step 26c" (the player's movie mode, its end card), "Built in step 26d" (the saves);
   - "Built in step 27b" (the show's details).
3. **The code to build on:**
   - **`apps/tv/src/shows/episode-play.ts`:** `episodePlay({ show, episode, index, kept, fromMs?, closed })` builds a `MoviePlay` (with `episode: EpisodeMark`); `episodePlace`, **`nextPlace(seasons, place)`** (next in its season, else the next season's first; `null` after the last), `resumePlace`.
   - **`apps/tv/src/shows/show-details.ts`:** `ShowDetailsShown.seasons` (the panel's order), the `play(show, episode, index, fromMs?)` option, `refresh()` (lands on the show's last episode, or the next once it was watched).
   - **`apps/tv/src/main.tsx`:** the show details' `play` builds `episodePlay(…)` with `kept = progress.point(episode.key)` and `closed = () => show.refresh()`. An auto-next play needs the same `closed`.
   - **`apps/tv/src/player/player-state.ts`:**
     - `MoviePlay.episode` / `PlayingMovie.episode` (`EpisodeMark`: show, season, number, title);
     - `onStatus`: the card's zone (`top.update(cardZone(!card ? 0 : s.state === 'ended' && movie.value !== null ? 1 : 2))`), `keepFilm()` on `ended` (saves it watched);
     - `onSelect`'s card branches for a film (`focus.zone === 'card' && film !== null …`);
     - `playFilm(from?)`, `close()`, the lifecycle listener (`hidden` / `visible`), `timers` (tests use a fake clock).
   - **`apps/tv/src/player/PlayerScreen.tsx`:** `MovieEndCard` (an episode's: "The episode has ended", the show, `EpisodeLine`); `EpisodeLine` (the mark from `show.mark`, the title in its own direction).
   - **A suggested shape** (not decided): `MoviePlay.next?: () => MoviePlay | null`, built in `main.tsx` from the details' seasons with `nextPlace` and the next episode's kept place; the player asks it at the end and shows the card when it gives one. Decide and record it as "Decided".
   - **The mock:** show 301 has season 1 (3001–3003, mkv, 300 s) and season 2 (3011–3012, mp4, 240 s); show 302 has «الموسم ١» (3021–3022, mp4, 180 s). `/series/<u>/<p>/<id>.<ext>` is served (synthetic media; real frames only under `pnpm e2e:media`).
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check 27c2 isn't done** (grep `nextEpisode`, `autoNext`, `upNext`, `countdown` in `apps/tv/src`), then build it as RELAY.md says:
   - **The card:** at an episode's end, "Next: S1 E3 · title" with a 10 s countdown, "Play now" (focused) and "Back".
   - The countdown's end or "Play now" plays the next episode, from its kept place when it has one.
   - "Back" (the button or the key) closes onto the details, which land on the next episode (the ended one is watched).
   - After the show's last episode: 27c1's "The episode has ended".
   - The app hiding stops the countdown (the card stays, without it).
   - New words: en and ar catalogs (no comments in ar.ts).
   - **Done when:**
     - unit tests: the next across seasons, the countdown and its end, "Play now", Back, the last episode, hidden;
     - e2e in English and Arabic: the end of S1 E3 starts S2 E1. The mock's media never ends in the regular e2e. Use `e2e:media`'s real files (S1 E3: FF stops at 4:50, 10 s to its end, then the 10 s countdown), or try dispatching an `ended` event on `#stage video` from the spec and check what `Html5Engine` does with it.
     - plus the common items: mutation (list first), the `pnpm verify` parts, 219 core-js modules, PR merged, and a "press these keys" checklist.
2. **Then 27d**, "Continue watching", in a later leg. It reads the profile's `shows` (last episode, `watched`, `updated`, which follows each write of the episode's place) and `progress`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `ff32931` Merge PR #81;
  - `2e1a839` docs: split step 27c, tick 27c1;
  - `ce38653` Merge PR #80;
  - `e344395` feat(series): play an episode, keep its place and the show's last episode.
- **main** is `ff32931`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links);
  - `dist/` (built by leg 73 from `e344395`'s code);
  - `.cache/rollup-wasm`, `.cache/engines`, `.cache/media` (the real Blender films are in `.cache/media/open-movies`; the episodes' files are there too, their burnt-in labels still say "Zoma Test Series" from before the rename: CI regenerates its own);
  - `artifacts/`:
    - `mutate27c1.py`, `mutate27c1-e2e.py` and their logs (`-b` rerun);
    - `build-27c1.log`, `unit-27c1.log`, `e2e-27c1.log`, `e2e-media-27c1.log`, `engines-27c1.log`;
    - the screenshots (`episode-player-*`, `episode-resume-*`, `player-episode-resumed-en`, `player-episode-ended-en`).
- **Docker Desktop** was running. Images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`. No `lablo-chrome*` container is left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## What step 27c1 added (for reference)
- **The profile, version 6:**
  - `shows`: by the show's key, `{ episode, watched, updated }`, the latest 200 (`MAX_SHOWS`);
  - migration 5 → 6 adds it empty;
  - `isShowProgress`;
  - the `episode` edit `{ kind: 'episode', show, last, progress }` writes the episode's place and the show's entry in one write;
  - the cap loop is shared (`dropOldest`).
- **The app:**
  - `MovieProgress.lastEpisode(show)` and `save(key, pos, len, ended, show?)`;
  - `ShowDetails.point` / `share` (they read the places' version) and `refresh`;
  - the details open on the show's last episode (`resumePlace`), with the seasons' row on its season.
- **The player:** `EpisodeMark`; `progressed(item, pos, len, ended, show?)`; the info bar's show name and "S1 E2 · title" (`player-episode`); the end card's `player-ended-episode`.
- **Words:** `show.mark` ("S{season} E{episode}", «م{season} ح{episode}»), `player.episodeEnded` ("The episode has ended", «انتهت الحلقة»). The row reuses `movie.resume` ("Resume from {time}").
- **Test ids and data:**
  - an episode row has `data-resume` (ms or `''`), `episode-resume-<i>` and a `.show__episode-progress` bar;
  - the player has `data-movie` = the episode's key.
- **e2e:** `e2e/episode-resume.spec.ts` (en-US, ar-SA). `player-media.spec.ts` +1: "resumes an episode within 5 s…", which also plays S1 E1 to its end and Back lands on S1 E2.

## Gotchas and lessons
**New in leg 73:**
- **Playing an episode changes where its show reopens** (on the last episode, or the next once watched). A spec that reopens a show after playing one must expect that (`show-details.spec.ts` now does).
- **The navigator's `focus(zone, i)` on an empty zone still notifies its listeners, with index -1.** The show details' season follower then set the season to -1. Only a check of `season.value` caught the mutant.
- **The profile's tests use "this version + 1" as a newer version** (`{ v: 7 }`, "Can't save a version 7"). Bump those on every profile version too.
- **Adding a field to a signal's value object breaks `toEqual` pins on it** (`episode: null` isn't "missing"). Grep `movie.value).toEqual`.
- **Player tests:** the position saved at the end is the one read at the last `POSITION_MS` tick while `playing`: advance the clock before `set('ended')`. A 10 s save needs `SAVE_EVERY_MS` to pass first. The engine's length needs a picture (`set('playing')`).
- **Writing the mutant list first paid off again:** it removed four guards that could never fail (use `!` where the state guarantees a value) and found three test gaps before the run.
- **The CI media flake on `test/epg-declared-300mb.media.test.ts` also hits its 20 ms search budget** (not only the 60 ms store). Rerun the failed job.
- **The relay context check fired at about 450k tokens,** right after the feature commit. 27c1 was finished to its merge first.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **A spec's `page.route('**/series/**')` holds the dev server's modules from an app folder `/src/series/`.** Match the panel's stream path (`` `**/series/${U}/${P}/**` ``). Never name an app folder like a mock URL segment.
- **Every formatted number comes wrapped in marks in e2e text.** Strip `MARKS` (see `episode-resume.spec.ts`'s `plain`).
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text.** A test-id change there fails that root test.
- **One e2e:media test alone:** `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/player-media.spec.ts -g "…"`.
- **ar-SA shows Western digits** in e2e texts.
- **A wait loop with `pgrep -f <word>` matches its own command line.** Wait on the background task's notice or a log marker.
- **The Write tool turns `\u200e…` in a regex literal into raw characters.** Use `new RegExp(String.fromCharCode(…))`.
- **Bash heredocs with mixed quotes fail to parse** (again in leg 73). Write the python patch script with the Write tool, then `python -I <script> <files>`; short `python -I - <args> <<'EOF'` patches with exact `assert s.count(a) == 1` replacements and no `'` inside work. A backslash goes in as `chr(92)`.
- **The navigator tells its listeners only when the focus actually moves.**
- **Inserting a rail entry or a header button shifts every index** in the e2e specs, the throttled specs and the old-engine walk.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch.
- **vitest `toEqual` ignores `undefined` properties.** Use `toStrictEqual` to pin a field's absence.
- **A hidden app's `<video>` is empty** (`Html5Engine.suspend`). The player saves first and reads no position until `visible`.
- **An e2e key can beat an async read.** Wait for `data-status="read"`, or hold the read in the mock (`app.addHook('onRequest')`).
- **The app imports only types from `@lablo/data`** (constants through `@lablo/data/client` only).
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests.**
- **`python -I` ignores `PYTHONIOENCODING`.** Call `sys.stdout.reconfigure(encoding='utf-8')` inside the script.
- **Chromium 68's V8 reads the zone through ICU, which ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free.
- **Hour-of-day effects:** the Playwright e2e runs at the machine's real clock.
- **`TaskStop` on a `verify:engines` run leaves its container.** Remove it with `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop in a background command.
- **Right after `gh pr create`, checks may not be listed yet:** the wait loop must also treat "no checks reported" as pending. After `gh run rerun --failed`, wait until the rerun job shows `pending` before waiting for it to finish.
- **GitHub billing can refuse every Actions job:** a needs-you stop. Read `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`.
- **The i18n runtime isolates every message argument.** A compound like "7.5/10" must be one argument.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the media e2e: `pnpm --dir "<wt>" e2e:media` (14 tests, about 2 min);
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`);
  - the poly count: `python -I -u artifacts/poly-count20c2a.py "<wt>"` right after the first build of new TV code.
- **TV bundle polyfills:**
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls, array destructuring or array spread in TV files (object destructuring and object spread are fine);
  - a member named `at` pulls `Array/String.at` in;
  - the build can crash once (0xC0000005): run it again.
- **Python's `write_text` on Windows writes CRLF.** Use `open(p, 'w', encoding='utf-8', newline='')`.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **CI media "Install ffmpeg" can hang:** `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately (all fine in leg 73).
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays (real frames need `pnpm e2e:media`);
  - its movies are 201–206, dated 1–13 days back;
  - its shows are 301 and 302 (4 and 2 days).
- **Root tests can't import an apps/tv module that reaches `@lablo/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm e2e`, `e2e:media` or the engines run is going.** Docs are safe. Don't run the unit and e2e mutation scripts at the same time.
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
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #81), then push the branch.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally (leg 73):**
  - lint, typecheck, unit 4,508;
  - both TV builds: 219 core-js modules; main 392.8 KB (Tizen) / 380.1 KB (webOS); query worker 115.4 KB; ingest 129.1 KB; app.css 88.6 KB;
  - `pnpm e2e` 116/116, including `episode-resume.spec.ts` and `show-details.spec.ts` (en-US, ar-SA);
  - `e2e:media` 14/14, including the episode's resume within 5 s and its end;
  - Chromium 53 and 68: 16/16 (America/Phoenix, 21:28);
  - mutation 99/100 (1 equivalent), e2e mutation 26/26.
- **Verified on CI (PR #80):** verify and engines green; media green on the rerun.
- **Not done:**
  - any TV;
  - the show details and episodes on the old-engine walk (its fixture is a playlist with no shows);
  - en-XA on the show details (chips cut long labels with an ellipsis; not checked by a spec);
  - the Arabic "The episode has ended" (the media test is in English; the words are in both catalogs).
- **Migrations and deploys:** N/A (no backend until step 29). The profile's version 6 migration runs on each TV's own IndexedDB at load, with the old copy kept as a snapshot. Nothing is deployed.

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies and series grids, the details (movie and show), playing, resuming and the episodes can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, whether the low tier keeps posters in lists, and the memory of 20 kept shows' answers (a panel show can list hundreds of episodes).
- **For step 38 (parental):** "Recently added" and "Recently updated" hold every category's items, adult ones included: the lock must filter them too. So will 27d's "Continue watching".
- **Later (unchanged, plus leg 73's):**
  - "Play from the start" for a part-watched episode, if users ask (OK resumes; LEFT and RW go back);
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

## "Press these keys" checklist for step 27c1 (Omar)
1. **`pnpm dev` with the mock's Xtream source.** UP to the header, RIGHT twice to "Series", OK, RIGHT to "Lablo Test Series", OK. The details open on Season 1's first episode.
2. **DOWN, OK on "2 Tone and Clock".** The player opens. The info bar shows "Lablo Test Series", then "S1 E2 · Tone and Clock", and the seek bar with "5:00".
3. **RIGHT four times:** the seek bar reads 0:40 (the mock's synthetic media stays on "Connecting…").
4. **Back:** the details, focus on "2 Tone and Clock". Under its title: "Resume from 0:40" in teal. A thin bar along the row's bottom, about an eighth full, from the left.
5. **OK:** the player again, from 0:40. Back.
6. **Back, Back** to the grid, then **OK** on the show: the details open on "Tone and Clock" again.
7. **DOWN to "3 Lip Sync", OK, then FF:** the bar jumps to 4:50. **Back:** the details move to Season 2, focus on "1 Return of the Bars" (Lip Sync counts as watched). UP: the "Season 2" chip.
8. **Reload the page** and open the show again: it opens on Season 2's first episode; Season 1's "Tone and Clock" still has its bar.
9. **In Arabic** (`?locale=ar-SA`): the info bar's line reads «م1 ح2 · Tone and Clock»; the row says «استئناف من 0:40» and its bar fills from the right.
10. **The end needs real media:** `pnpm e2e:media` plays S1 E1 to "The episode has ended" ("Lablo Test Series", "S1 E1 · Pilot - Colour Bars"), and its Back lands on "2 Tone and Clock". The screenshot is `artifacts/screenshots/player-episode-ended-en.png`.

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
