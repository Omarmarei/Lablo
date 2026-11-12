# Lablo IPTV: relay leg 75 opening prompt

You are leg 75 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–73 did steps 1–27c1 (all of 26a–26e, 26q, 26r; PRs #1–#81), except step 16's Samsung part, 19b and 21.
- **Leg 74** did **27c2, auto-next**, which also closes step 27c:
  - PR #82, merged as `8c9840a` (verify 10 m 3 s, engines 18 m 28 s, media 12 m 2 s). The media job's first run tripped `test/epg-declared-300mb.media.test.ts` (its 60 ms store budget at 82.9 ms), the known slow-runner flake; `gh run rerun --failed` passed.
  - PR #83 (docs), merged as `003ec79`: 27c2 and 27c ticked, leg 74's progress-log row.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`, step 27:**
   - "Already built", "Decided in leg 71", the 27a–27d split, the common items each sub-step's Done-when includes;
   - **27c1's and 27c2's "Done in" and "Decided"** (the profile's `shows`, `MoviePlay.next`);
   - **27d**, your step: "Continue watching".
2. **`docs/architecture.md` §1.2:**
   - "Built in step 26d" (resume: the profile's `progress`, `movie-progress.ts`), "Built in step 26e" ("Recently added": a rail entry held in memory, `RecentList`);
   - "Built in step 27a" (the series screen: `createMovies({ kind })`), "Built in step 27c1" (the profile's `shows`, version 6), "Built in step 27c2".
3. **The code to build on:**
   - **`packages/data/src/profile.ts`:** version 6. `progress` is keyed by ContentKey: `{ positionMs, lengthMs, updated }`, latest 500. `shows` is keyed by the show's key: `{ episode, watched, updated }`, latest 200. `updated` follows each write of the episode's place.
   - **`apps/tv/src/movies/movie-progress.ts`:** `point`, `share`, `lastEpisode`, `version` (a signal bumped on every change), `save`.
   - **`apps/tv/src/movies/movies-state.ts`:** the rail's entries ("Recently added"/"Recently updated", "All …", the categories), `kind`, catalog swaps, `selectSeries`.
   - **`apps/tv/src/shows/episode-play.ts`:** `resumePlace`, `nextPlace`. **`show-details.ts`:** opening on the last episode, or the next once it was watched.
   - **The open problem RELAY names:** the profile keeps no item for a key, and the query worker has no lookup by key. Decide between a small copy of the item kept with the place (a profile bump to version 7, which also bumps the "newer version" pins to 8) and a query that reads the items by key. Record it as "Decided".
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check 27d isn't done** (grep `continueWatching`, `Continue watching`, `continue` in `apps/tv/src/movies` and the catalogs).
2. **Consider splitting it** (27d1 the data and the decision, 27d2 the rail entries and e2e) if it won't fit one leg, as leg 73 split 27c. Record the split in RELAY.md.
3. **Build it as RELAY.md says:**
   - **The list:** movies and shows left part way, newest first. A movie by its place. A show by its last episode: part watched, resume it; watched, its next one when there is one. At most 20.
   - **Where:** first in the movies rail and in the series rail (before "Recently added"/"Recently updated") when it has items. Step 28's Home shows it too.
   - **A removed source's items drop out.**
   - **Ideas, not decided:**
     - A show's tile could open its details, which already land on the episode to resume or the next one, instead of playing at once.
     - A watched show's "next one" needs its seasons, which come from `get_series_info` (the query worker's `SeriesInfoCache`, 24 h).
   - **Done when:**
     - unit tests: the order, the cap, a watched show with and without a next episode, a removed source;
     - e2e in English and Arabic: leave a movie and an episode part way, both in "Continue watching", OK resumes;
     - plus the common items: mutation (list first), the `pnpm verify` parts, 219 core-js modules, PR merged, and a "press these keys" checklist.
4. **Then step 28,** search and Home.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `003ec79` Merge PR #83;
  - `e459810` docs: record PR #82's merge, tick step 27c2;
  - `8c9840a` Merge PR #82;
  - `84141fa` feat(series): auto-next.
- **main** is `003ec79`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links);
  - `dist/` (built by leg 74 from `84141fa`'s code);
  - `.cache/rollup-wasm`, `.cache/engines`, `.cache/media` (the episodes' burnt-in labels still say "Zoma Test Series"; CI regenerates its own);
  - `artifacts/`:
    - `mutate27c2.py`, `mutate27c2-e2e.py` and their logs (`-b` reruns);
    - `build-27c2.log`, `unit-27c2.log`, `e2e-27c2.log`, `e2e-media-27c2.log`, `engines-27c2.log`, `lint-27c2.log`, `typecheck-27c2.log`;
    - the screenshots (`auto-next-*`, `auto-next-played-*`, `auto-next-last-*`, `player-episode-ended-en`, `player-episode-next-en`).
- **Docker Desktop** was running. Images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`. No `lablo-chrome*` container is left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## What step 27c2 added (for reference)
- **`episodePlay`** takes `{ show, seasons, place, kept: (key) => ResumePoint | null, fromMs?, closed }`. Its play's `next()` builds the next episode's play (the next in the panel's order across seasons, from its kept place, read when asked; `null` after the last), each with its own `next`. The show details' `play(show, seasons, place, fromMs?)` hands over the seasons and the place.
- **The player:**
  - `MoviePlay.next`, `UpNext { play, seconds }`, `Player.upNext`, `NEXT_COUNTDOWN_S` (10), `NEXT_TICK_MS` (1000), `startFilm`.
  - At an episode's end: the watched save, then `next()`. With one: "Play now" (card 0) and "Back" (card 1). Without one: "Back" alone.
  - The countdown's end or "Play now" plays it in the same player. The new play's `opening` clears the card in `onStatus`, as "Try again" does.
  - "Back", the Back key or STOP close onto the details, which land on the next episode. The app hiding stops the countdown for good; the card stays.
- **The card:** 27c1's lines, then "Next: S2 E1 · title" (`player.nextEpisode`, «التالي: {mark}»), "Starts in 10 s" (`player.nextIn`, «تبدأ خلال {seconds} ث») and "Play now" (`player.playNow`, «تشغيل الآن»). The screen's root has `data-next` and `data-countdown`.
- **`.player__card-text` now aligns to the UI's start side** (`text-align: left`, mirrored by rtlcss): all cards share it. In Arabic, the English show name had been on the left.
- **e2e:**
  - `e2e/auto-next.spec.ts` (en-US, ar-SA) ends the held stream with an `ended` event on `#stage video`.
  - `player-media.spec.ts`'s episode test now lets the countdown play S1 E2 after S1 E1's real end.

## Gotchas and lessons
**New in leg 74:**
- **To end a VOD stream in a regular e2e:** hold its request (`page.route` + `route.fetch().catch(() => undefined)`), wait until it was asked, then `page.locator('#stage video').dispatchEvent('ended')`. Html5Engine passes it on, and the controller sets `ended` even while opening. Do it within the 10 s open timeout.
- **`RemoteDriver.expectFocus` reads the screen root's `data-*`, not the buttons.** A Button bound to the wrong `buttons.item(i)` still passes it. Check the button's own `data-state` (`focused` / `idle`).
- **The controller's `play()` publishes `opening` synchronously,** so `onStatus` clears any card on a new play. A caller doesn't need its own reset.
- **Hiding the app in e2e:** `setHidden(page, true)` (defineProperty `document.hidden` plus `visibilitychange`), as in `movie-resume.spec.ts` and `auto-next.spec.ts`.
- **Writing the mutant list first removed a branch that could never run** (`onStatus`'s `else stopNext()`) and a redundant CSS line. The run found one more redundancy, and the e2e list found a test gap (the focus drawing).
- **The CI media flake hit again** (the 60 ms store at 82.9 ms). It has now happened four times in five PRs: rerun the failed job once the whole run completes.
- **Bash heredocs with mixed quotes failed again** (a long python patch). The Write tool for the script, then `python -I <script> <files>`, always works.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **Playing an episode changes where its show reopens** (on the last episode, or the next once watched).
- **`screen.focus(zone, i)` on an empty zone still notifies its listeners, with index -1.**
- **The profile's tests use "this version + 1" as a newer version.** Bump those (and e2e `v:` pins) on every profile version.
- **Adding a field to a signal's value object breaks `toEqual` pins on it.** Grep the signal's `.value).toEqual`.
- **Player tests:** the position saved at the end is the one read at the last `POSITION_MS` tick while `playing`: advance the clock before `set('ended')`. A 10 s save needs `SAVE_EVERY_MS` to pass first.
- **A spec's `page.route('**/series/**')` holds the dev server's modules from an app folder `/src/series/`.** Match the panel's stream path (`` `**/series/${U}/${P}/**` ``). Never name an app folder like a mock URL segment.
- **Every formatted number comes wrapped in marks in e2e text.** Strip `MARKS` (see `auto-next.spec.ts`'s `plain`).
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text.** A test-id change there fails that root test.
- **Inserting a rail entry shifts every index** in the e2e specs, the throttled specs and the old-engine walk. "Continue watching" goes first in the rail when it has items: grep `movies/rail/`, `series/rail/`, `data-category` and `tools/engines` first.
- **The navigator tells its listeners only when the focus actually moves.** A swap that keeps the place fires nothing.
- **One e2e:media test alone:** `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/player-media.spec.ts -g "…"`.
- **ar-SA shows Western digits** in e2e texts.
- **A wait loop with `pgrep -f <word>` matches its own command line.** Wait on the background task's notice or a log marker.
- **The Write tool turns `\u200e…` in a regex literal into raw characters.** Use `new RegExp(String.fromCharCode(…))`.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch.
- **vitest `toEqual` ignores `undefined` properties.** Use `toStrictEqual` to pin a field's absence.
- **A hidden app's `<video>` is empty** (`Html5Engine.suspend`).
- **An e2e key can beat an async read.** Wait for `data-status="read"`, or hold the read in the mock (`app.addHook('onRequest')`).
- **The app imports only types from `@lablo/data`** (constants through `@lablo/data/client` only).
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests.**
- **`python -I` ignores `PYTHONIOENCODING`.** Call `sys.stdout.reconfigure(encoding='utf-8')` inside the script.
- **Chromium 68's V8 reads the zone through ICU, which ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free.
- **Hour-of-day effects:** the Playwright e2e runs at the machine's real clock.
- **`TaskStop` on a `verify:engines` run leaves its container.** Remove it with `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop.
- **Right after `gh pr create`, checks may not be listed yet:** treat "no checks reported" as pending. `gh run rerun --failed` refuses an in-progress run: wait until the whole run is completed, then until the rerun job shows `pending`.
- **GitHub billing can refuse every Actions job:** a needs-you stop. Read `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`.
- **The i18n runtime isolates every message argument.** A compound like "7.5/10" must be one argument.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the media e2e: `pnpm --dir "<wt>" e2e:media` (14 tests, about 2.5 min);
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
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately (all fine in leg 74).
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays (real frames need `pnpm e2e:media`);
  - its movies are 201–206, dated 1–13 days back;
  - its shows are 301 ("Lablo Test Series": S1 3001–3003 mkv 300 s, S2 3011 "Return of the Bars" and 3012 "Finale", mp4 240 s) and 302 (Arabic, 3021–3022);
  - "Recently updated" lists 302 first.
- **Root tests can't import an apps/tv module that reaches `@lablo/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm e2e`, `e2e:media`, a build or the engines run is going.** Docs and e2e specs not in the run are safe. Don't run the unit and e2e mutation scripts at the same time.
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
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #83), then push the branch.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally (leg 74):**
  - lint, typecheck, unit 4,527;
  - both TV builds: 219 core-js modules; main 394.6 KB (Tizen) / 381.9 KB (webOS); query worker 115.4 KB; ingest 129.1 KB; app.css 89.3 KB;
  - `pnpm e2e` 118/118, including `auto-next.spec.ts` (en-US, ar-SA);
  - `e2e:media` 14/14, including S1 E2 playing after S1 E1's real end;
  - Chromium 53 and 68: 16/16 (Pacific/Pitcairn, 21:44);
  - mutation 51/51 (after a redundant reset was taken out), e2e mutation 22/22 (after closing a focus-drawing gap).
- **Verified on CI (PR #82):** verify and engines green; media green on the rerun.
- **Not done:**
  - any TV;
  - the show details, episodes and auto-next on the old-engine walk (its fixture is a playlist with no shows);
  - en-XA on the show details and the auto-next card;
  - the Arabic card at a real end (the media test is in English; the regular e2e covers the Arabic card).
- **Migrations and deploys:** N/A (no backend until step 29). The profile's version 6 migration runs on each TV's own IndexedDB at load, with the old copy kept as a snapshot. Nothing is deployed.

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies and series grids, the details (movie and show), playing, resuming, the episodes and auto-next can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, whether the low tier keeps posters in lists, and the memory of 20 kept shows' answers (a panel show can list hundreds of episodes).
- **For step 38 (parental):** "Recently added", "Recently updated" and 27d's "Continue watching" hold every category's items, adult ones included: the lock must filter them too.
- **Later (unchanged, plus leg 74's):**
  - a setting to turn auto-next off, or a different countdown, if users ask;
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
  - a resume place re-matched when a provider renumbers a movie, if users ask;
  - the CI media flake's single-sample budgets (`test/epg-declared-300mb.media.test.ts`): best-of-3 or looser, if Omar wants fewer reruns.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 27c2 (Omar)
1. **Start:** `pnpm dev` with the mock's Xtream source. UP to the header, RIGHT twice to "Series", OK, RIGHT to "Lablo Test Series", OK.
2. **Play S1 E3:** DOWN twice to "3 Lip Sync", OK. The player opens and stays on "Connecting…" (the mock's media is synthetic).
3. **End it:** in the browser console, run `document.querySelector('#stage video').dispatchEvent(new Event('ended'))`. The card reads:
   - "The episode has ended", "Lablo Test Series", "S1 E3 · Lip Sync";
   - in bold, "Next: S2 E1 · Return of the Bars";
   - "Starts in 10 s", counting down;
   - "Play now" (teal, focused) and "Back".
4. **Wait 10 s:** S2 E1 plays in the same player. The info bar reads "S2 E1 · Return of the Bars" and the seek bar "4:00".
5. **"Play now":** end it again (the console line). The card offers "Next: S2 E2 · Finale". Press OK: S2 E2 plays at once.
6. **The last episode:** end it again. "The episode has ended" with "Back" alone (S2 E2 is the show's last). OK: the details, on "2 Finale" in Season 2.
7. **"Back":** UP to "1 Return of the Bars", OK, end it. RIGHT to "Back", OK: the details land on "2 Finale". Do it once more with the Back key.
8. **Hiding:** during a countdown, switch to another browser tab and back. The countdown is gone, the card stays, and OK still plays.
9. **In Arabic** (`?locale=ar-SA`): «التالي: م2 ح1 · Return of the Bars», «تبدأ خلال 10 ث» and «تشغيل الآن», all on the right, the show's English name too.
10. **Real media:** `pnpm e2e:media` plays S1 E1 to its end, then S1 E2 after the countdown. The screenshots are `artifacts/screenshots/player-episode-ended-en.png` and `player-episode-next-en.png`.

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
