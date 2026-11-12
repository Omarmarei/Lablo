# Lablo IPTV: relay leg 76 opening prompt

You are leg 76 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–74 did steps 1–27c2 (all of 26a–26e, 26q, 26r; PRs #1–#83), except step 16's Samsung part, 19b and 21.
- **Leg 75** did **27d, "Continue watching"**, which closes **step 27** (series):
  - PR #84, merged as `e0c32c7` on green CI on the first run (verify 9 m 5 s, engines 17 m 26 s, media 10 m 52 s).
  - PR #85 (docs), merged as `45bc682`: 27d and 27 ticked, leg 75's progress-log row.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - **Step 28** (your step): "Search and Home. Global search UI (≤ 300 ms with 200k items) and the Home screen." Its Done-when isn't written yet beyond that line.
   - **27d's "Decided in leg 75"** and "Done in leg 75" (what Home reuses).
   - Step 26's common items (each sub-step's Done-when includes them): unit tests; e2e by keys in English and Arabic against the mock, screenshots looked at; a mutation run with the mutant list written first; `pnpm verify` parts green; main within budget with 219 core-js modules on both platforms; the PR merged; a "press these keys" checklist in the handover.
2. **`docs/PLAN.md`:** what search and Home are meant to be (grep `Home`, `search`); the Phase 7 list.
3. **`docs/architecture.md`:**
   - §1.4 steps 8 and 11 (the search index: `SearchSegment`, `searchSegments`, ranking, `SEARCH_LIMIT`), and `QueryService.search` / `items`;
   - §1.2 "Built in step 27d" ("Continue watching": `itemsByKey`, `unfinished`, the rail entry);
   - the live screen's header (Guide 0, Movies 1, Series 2, Settings 3) and how a screen is pushed on the live navigator.
4. **The code to build on:**
   - **`packages/core/src/search.ts`** (`searchSegments`, `SearchHit`, favourites boost) and **`packages/data/src/query-service.ts`** (`search` with RPC cancellation, `items`, `itemsByKey`).
   - **`apps/tv/src/data/engine.ts`:** `search(query, { limit, names })` today resolves the first hits' names (the hello screen's diagnostics).
   - **`apps/tv/src/movies/movies-state.ts`** (a poster screen with held entries: "Continue watching", "Recently added") and **`movie-progress.ts`** (`unfinished()`).
5. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check step 28 isn't partly done:** grep `search` and `home` in `apps/tv/src` (the hello screen's diagnostics search is not the UI), `git log --oneline -20`.
2. **Split step 28 before building** (as 26, 27 and 27c were): write the split and each part's Done-when into RELAY.md. A likely split:
   - **28a, search:** a search screen from the header (or a key), an on-screen or TV keyboard entry, results across live, movies and series (the query worker's `search`, cancelled when the text changes), OK opening a channel, a movie's or show's details; ≤ 300 ms with 200k items (bench it like the earlier throttled specs).
   - **28b, Home:** the first screen: "Continue watching" (27d's list across both kinds), "Recently added" / "Recently updated", the favourites or last channel; how Home relates to the live screen (today the app opens on the live list).
   - Decide where search lives in the header (Guide 0, Movies 1, Series 2, Settings 3 today): adding a button shifts every spec that presses to "Settings" (13 places in 5 specs in leg 71) and the old-engine walk. Record it as "Decided".
3. **Build the first part** under the project's rules; PR, CI, merge (IPTV PRs merge on green CI without Omar: merge commit, keep the branch); then a docs PR recording the merge, as #85.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `45bc682` Merge PR #85;
  - the docs commit recording PR #84 (`docs: record PR #84's merge, tick steps 27d and 27`);
  - `e0c32c7` Merge PR #84;
  - `e22c70c` test(continue), `86bebe4` feat(continue) rail, `331dda7` feat(continue) data.
- **main** is `45bc682`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links);
  - `dist/` (built by leg 75 from the 27d code);
  - `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `artifacts/`: `mutate27d.py` (+ `.log`, `-b.log`), `mutate27d-e2e.py` (+ `.log`), `build-27d.log`, `unit-27d.log`, `e2e-27d.log`, `e2e-media-27d.log`, `engines-27d.log`, `lint-27d.log`, `typecheck-27d.log`, `gates-27d.txt`; screenshots `continue-movies-*`, `continue-series-*`.
- **Docker Desktop** was running. Images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`. No `lablo-chrome*` container is left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## What step 27d added (for reference)
- **`QueryService.itemsByKey({ keys, kind, sources, limit })`** (`DataEngine.itemsByKey`, at most `KEY_ITEMS_MAX` 100): each key found in its source's loaded search segment (`indexOfKey`, `chunkOf`; core's `keySource` is now exported), only the found items' chunks read, each item's own key checked (a hash collision gives nothing). In the order asked; a removed source's key, a gone item or an episode's key finds nothing. **Home can use it** for any list of keys.
- **The profile:** `ShowProgress.more` (optional, still version 6): whether an episode came after the show's last one. The player passes it with each episode's save (`EpisodeMark.more`, from `nextPlace`). An entry without it counts as the show's last.
- **`MovieProgress.unfinished()`:** the keys left part way, newest first by save time, then key (places, plus shows whose last episode isn't watched or is watched with `more`). The order is a hand-written merge (`newestFirst`): **no `.sort(` in TV code**. `share(showKey)` gives the show's last episode's bar.
- **The rails:** "Continue watching" (`continue.title`, «متابعة المشاهدة», one key for both screens) is the movies and series rails' first entry when it has items (at most `CONTINUE_MAX` 20), and the screen opens on it. It is held like "Recently added" and read again when the screen is back on top after a save (`refreshContinued`, keyed on `progress.version`). In it, the focus follows its item. OK opens the details on the resume point (two presses, decided).
- **Specs that follow the rail:** `movie-resume`, `movie-details`, `show-details` and `episode-resume`. After a play, Back from the grid lands on `rail/1`. A relaunch opens on "Continue watching", whose grid has fewer tiles.

## Gotchas and lessons
**New in leg 75:**
- **No `Array.prototype.sort` in the TV main bundle.** None existed, and Babel would add core-js's `es.array.sort` (the 219 gate). Copy `newestFirst` from `movie-progress.ts`. `.concat`, `.slice`, `.splice` and `.find` are already in.
- **`Screen.focus`/`update` notify listeners only when the position changes.** A list refreshed under an unchanged focus gets no nav event, so ask its posters yourself (`scheduleRest`). `focus(zone, -1)` clamps to 0.
- **A unit test with the manual clock can hide a missing rest:** the pop's own rest runs after the answer unless the test holds the read past it.
- **LEFT from a grid's second column moves inside the grid.** Press LEFT twice to reach the rail.
- **Writing the mutant list first took out seven guards that could never fail.** The run found one more redundant `Math.max` and two test gaps (an older answer after a newer one; posters when the focus keeps its place).
- **Bash heredocs failed twice more** (quotes inside the body). Write the script or file with the Write tool, then run `python -I` or `cat >>`.
- **CI passed on the first run this time** (no media flake).

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **Inserting a header button or a rail entry shifts every index** in the e2e specs, the throttled specs and the old-engine walk. Grep `live/header/`, `movies/rail/`, `series/rail/`, `data-category` and `tools/engines` first.
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text.** A test-id change there fails that root test.
- **The profile's tests use "this version + 1" as a newer version.** Bump those (and e2e `v:` pins) on every profile version.
- **Adding a field to a signal's value object breaks `toEqual` pins on it.** Grep the signal's `.value).toEqual`. vitest `toEqual` ignores `undefined` properties; use `toStrictEqual` to pin a field's absence.
- **To end a VOD stream in a regular e2e:** hold its request, then `page.locator('#stage video').dispatchEvent('ended')`.
- **`RemoteDriver.expectFocus` reads the screen root's `data-*`.** Check a button's own `data-state`.
- **Playing an episode changes where its show reopens** (on the last episode, or the next once watched).
- **`screen.focus(zone, i)` on an empty zone still notifies, with index -1.** The navigator tells its listeners only when the focus actually moves.
- **A spec's `page.route('**/series/**')` holds the dev server's modules from an app folder `/src/series/`.** Never name an app folder like a mock URL segment.
- **Every formatted number comes wrapped in marks in e2e text.** Strip `MARKS`. ar-SA shows Western digits in e2e texts.
- **Hiding the app in e2e:** `setHidden(page, true)`.
- **One e2e:media test alone:** `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/player-media.spec.ts -g "…"`.
- **A wait loop with `pgrep -f <word>` matches its own command line.** Wait on a log marker (`until grep -q "^exit" log`).
- **The Write tool turns `\u200e…` in a regex literal into raw characters.** Use `String.fromCharCode`.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch. Python's `write_text` on Windows writes CRLF: use `open(p, 'w', encoding='utf-8', newline='')`.
- **A hidden app's `<video>` is empty** (`Html5Engine.suspend`).
- **An e2e key can beat an async read.** Wait for a settled attribute, or hold the read in the mock.
- **The app imports only types from `@lablo/data`** (constants through `@lablo/data/client` only).
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests.**
- **`python -I` ignores `PYTHONIOENCODING`.** Call `sys.stdout.reconfigure(encoding='utf-8')` inside the script.
- **Chromium 68's V8 ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free. The Playwright e2e runs at the machine's real clock.
- **`TaskStop` on a `verify:engines` run leaves its container.** `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop.
- **Right after `gh pr create`, checks may not be listed yet:** treat "no checks reported" as pending. `gh run rerun --failed` refuses an in-progress run.
- **GitHub billing can refuse every Actions job:** a needs-you stop (`gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`).
- **The CI media flake** (`test/epg-declared-300mb.media.test.ts` budgets) hit four times in five PRs before this one: rerun the failed job once the whole run completes. "Install ffmpeg" can hang: `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **The i18n runtime isolates every message argument.** A compound like "7.5/10" must be one argument.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the media e2e: `pnpm --dir "<wt>" e2e:media` (14 tests, about 2.5 min);
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`);
  - the poly count: `python -I -u artifacts/poly-count20c2a.py "<wt>"` right after the first build of new TV code.
- **TV bundle polyfills:**
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `.sort(`, `Array.from`, iterator calls, array destructuring or array spread in TV files (object destructuring and object spread are fine);
  - a member named `at` pulls `Array/String.at` in;
  - the build can crash once (0xC0000005): run it again.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately (all fine in leg 75).
- **The mock:**
  - its panel zone is UTC by default; its synthetic media never plays (real frames need `pnpm e2e:media`);
  - its movies are 201–206, dated 1–13 days back (Big Buck Bunny 201, 596 s, first in "Recently added");
  - its shows are 301 ("Lablo Test Series": S1 3001–3003 mkv 300 s, S2 3011 "Return of the Bars" and 3012 "Finale", mp4 240 s) and 302 (Arabic, 3021–3022); "Recently updated" lists 302 first.
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
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #85), then push the branch.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally (leg 75):**
  - lint, typecheck, unit 4,549;
  - both TV builds: 219 core-js modules; main 397.1 KB (Tizen) / 384.4 KB (webOS); query worker 116.2 KB; ingest 129.1 KB; app.css 89.3 KB;
  - `pnpm e2e` 120/120, including `continue-watching.spec.ts` (en-US, ar-SA);
  - `e2e:media` 14/14;
  - Chromium 53 and 68: 16/16;
  - mutation 80/83, then 3/3 after the fixes; e2e mutation 7/7.
- **Verified on CI (PR #84):** verify, engines and media green on the first run.
- **Not done:**
  - any TV;
  - "Continue watching" (and the show details, episodes and auto-next) on the old-engine walk (its fixture is a playlist that nothing plays);
  - en-XA on the new rail label;
  - a "Continue watching" of more than a few items in e2e (unit tests cover 19 and the cap).
- **Migrations and deploys:** N/A (no backend until step 29). The profile stays at version 6 (`more` is optional). Nothing is deployed.

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies and series grids, "Continue watching", the details (movie and show), playing, resuming, the episodes and auto-next can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, whether the low tier keeps posters in lists, and the memory of 20 kept shows' answers.
- **For step 38 (parental):** "Recently added", "Recently updated" and "Continue watching" hold every category's items, adult ones included: the lock must filter them too.
- **Later (unchanged, plus leg 75's):**
  - a show finished to its last episode coming back to "Continue watching" when its panel adds one (today "Recently updated" lists it);
  - OK on a "Continue watching" tile playing at once instead of opening the details, if users ask;
  - a setting to turn auto-next off, or a different countdown, if users ask;
  - "Play from the start" for a part-watched episode, if users ask;
  - an episode's image in its row, or the focused episode's plot in a bigger place, if users ask;
  - the show's details, the series screen and "Continue watching" on the old-engine walk (needs Xtream shows and a play in its fixture);
  - group a playlist's episodes into shows by name, if users ask (leg 71 decided flat);
  - a CSS seed for the poster grid;
  - fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents;
  - a day jump in the guide;
  - an on-screen keyboard if the TV keyboards fail (step 28's search needs a text entry: decide there);
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
  - a walk at a second hour (00:xx) if the engines job has time;
  - a resume place re-matched when a provider renumbers a movie, if users ask;
  - the CI media flake's single-sample budgets: best-of-3 or looser, if Omar wants fewer reruns.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 27d (Omar)
1. **Start:** `pnpm dev` with the mock's Xtream source. UP to the header, RIGHT to "Movies", OK: the rail starts with "Recently added" (nothing played yet).
2. **Leave a movie part way:** OK on "Big Buck Bunny", OK on "Play" (it stays on "Connecting…": the mock's media is synthetic), RIGHT four times (0:40), Back, Back.
3. **The rail:** "Continue watching 1" is now first, "Recently added" is still highlighted, and the focus is where it was. Back: the rail focus is on "Recently added", one row lower.
4. **"Continue watching":** UP, OK. The header reads "Continue watching · 1 movie". "Big Buck Bunny" has a thin bar at about 7 % along its bottom.
5. **OK resumes:** OK opens the details with "Resume from 0:40" focused; OK plays from 0:40. Back, Back, Back, Back to the header.
6. **A show:** RIGHT to "Series", OK, RIGHT to "Lablo Test Series", OK, DOWN to "2 Tone and Clock", OK, RIGHT four times, Back, Back, Back. "Continue watching 1" is first in the series rail.
7. **The show's tile:** Back, UP, OK. "Lablo Test Series" has a bar at about 13 %. OK: the details land on S1 E2 "Resume from 0:40"; OK resumes it.
8. **Watched with a next one:** FF (to 4:50), Back: the details land on S1 E3. Back, Back: the show is still in "Continue watching", with no bar; OK lands on S1 E3.
9. **A relaunch:** reload the page. "Movies" and "Series" both open on "Continue watching".
10. **In Arabic** (`?locale=ar-SA`): «متابعة المشاهدة» heads both rails, on the right, and the bars fill from the right.

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
