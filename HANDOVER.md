# Lablo IPTV: relay leg 78 opening prompt

You are leg 78 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–76 did steps 1–27d and built 28a (PRs #1–#85), except step 16's Samsung part, 19b and 21 (they wait for Omar).
- **Leg 77:**
  - **Finished and merged step 28a (search):**
    - PR #86, merge commit `9b07d25`, green CI on the first run (verify 9 m 52 s, engines 19 m 42 s, media 10 m 22 s).
    - Docs PR #87, `de402d5`, ticked 28a and added leg 77's progress row.
    - Step 24's parent line is ticked too.
  - **Mutation runs:**
    - `artifacts/mutate28a.py`: 112 mutants written first, 103 caught. Five test gaps closed, two checks that could never fail taken out (`fill`'s `pages.has`, the catalog swap's "nothing typed"), two equivalent mutants kept (`playFound`'s first-entry stop, its `+ found.slot`). Re-run 12/12.
    - `mutate28a-e2e.py`: 12/13. The survivor was a gap (the "Search" button drawn focused), now closed; re-run 1/1.
  - **Found a header bug:** with five buttons, "Settings" ended 4 px past the safe area in the pseudo-locale en-XA. The header's parts now sit 24 px apart (were 48) and its buttons have 24 px sides (32 elsewhere). en-XA keeps about 20 px: **a sixth button does not fit without another change.**
  - **Asked Omar about Home's place; he chose option 1 (2026-11-16):**
    - Home is a header button, and the app keeps opening on the live screen.
    - "Search" and "Settings" become icon buttons to make room.
    - Leg 77 wrote **28b's decisions and split it into 28b1 and 28b2** in RELAY.md (commit `59ae89a`, pushed, not yet in main: it goes into 28b1's PR).
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - step 28b (Omar's decision and "Decided in leg 77");
   - the 28b1 and 28b2 entries (their Done-when);
   - leg 77's progress-log row;
   - 27d's "Done in leg 75" (how "Continue watching" is read: `itemsByKey`, the places' `version`, `refreshContinued`).

   Step 26's common items still apply: unit tests; e2e by keys in English and Arabic with the screenshots looked at; a mutation run with the mutant list written first; `pnpm verify` parts green; main within budget with 219 core-js modules on both platforms; the PR merged; a "press these keys" checklist in the handover.
2. **The code Home builds on:**
   - `apps/tv/src/movies/movies-state.ts`: `createMovies`, `POSTER_SCREENS`, `selectSeries`, `CONTINUE_MAX`, `readContinued`, `heldEntry`, `applyContinued`, `refreshContinued`, the `recent` read.
   - `MoviesScreen.tsx` (the tiles, `POSTER_WORDS`, `POSTER_TEST_IDS`), `posters.ts` (`PosterLoader`, the tier caps), `movie-progress.ts` (`unfinished()`, `version`, the show's bar).
   - `apps/tv/src/live/live-state.ts`: `HEADER_*`, `HEADER_ZONE` count 5, `onSelect`'s header branch, `keepZone`.
   - `LiveApp.tsx`: the header's buttons and the screen branches, ordered by `focus.screen`.
   - `main.tsx`: how `movies`, `series`, `search` are created and wired: `select`, `progress`, `startRefreshes`' `onCatalog`.
   - `packages/ui/src/components/Button.tsx` (`icon` already renders an inline SVG before the label) and `Button.css`.
   - An existing inline SVG icon: `apps/tv/src/settings/SettingsScreen.tsx` around line 53, and `GalleryApp.tsx`'s `PLAY_ICON` / `GLOBE_ICON`.
3. **`docs/architecture.md`:** §1.2's "Built in step 28a" (the header's spacing note), "Built in step 27d" and "Built in step 26e" (the shelves' data). Add "Built in step 28b1" there.
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` (clean), `git -C "<wt>" log --oneline -4` (HEAD is this handover's commit, on `59ae89a`, on `de402d5` = main).
2. **Build 28b1** (RELAY.md has the Done-when):
   1. **The icon-only Button** in `packages/ui` (hook-free):
      - the inline SVG alone, no visible label, `aria-label` = the label, 56 px square in the header;
      - unit tests in `packages/ui/src/components/components.test.ts`;
      - icons ours, drawn in `currentColor`: a magnifier and a gear.
   2. **The header:**
      - Guide 0, Movies 1, Series 2, **Home 3** (catalog `home.open`: "Home", «الرئيسية»), Search 4 (icon), Settings 5 (icon); `HEADER_ZONE` count 6.
      - **Indices that shift:** `e2e/guide-catchup-m3u.spec.ts`, `guide-mapping`, `guide-matches`, `guide-offset`, `guides` (one more RIGHT to "Settings"); `search.spec.ts` (Search is `live/header/4`; its `toHaveText(says.open)` on `live-search` must become an `aria-label` check; five buttons become six); `search-throttled.spec.ts`; `series.spec.ts` (counts buttons); `apps/tv/src/live/live-state.test.ts` (the header tests press RIGHT to reach Search and Settings).
      - `tools/engines` reaches only Guide and Movies: unchanged, but run the walk (its layout checks measure every `.z-button`).
      - **Run `pnpm --dir "<wt>" exec playwright test --project=chromium e2e/live.spec.ts -g pseudo` early:** it is the only test of the header in en-XA.
   3. **Home** (`apps/tv/src/home/`; never name an app folder after a mock URL segment such as `live`, `movie` or `series`):
      - `home-state.ts` and `HomeScreen.tsx` plus CSS (physical properties only; no CSS Grid, no flex `gap`).
      - Shelves: "Continue watching" (movies and shows, `unfinished()`'s order, one `itemsByKey` per kind merged by that order, at most 20, tile bars as on the poster screens), "Recently added" (movies), "Recently updated" (series).
      - OK on a tile: a movie's details, or a show's (`selectSeries`); Back returns to the tile; Back on Home lands on the header's "Home".
      - Read again when back on top after a save (the places' `version`) and on a catalog swap (`main.tsx`'s `onCatalog`).
      - Unit tests, e2e `e2e/home.spec.ts` in en-US and ar-SA, screenshots looked at.
   4. **Mutation:** `artifacts/mutate28b1.py`, written first, in `mutate28a.py`'s format (CRLF-safe, `--check`, one snippet, a docstring that records the results), plus a short `mutate28b1-e2e.py`.
   5. **Verify:**
      - lint, typecheck, the whole `pnpm test`;
      - `pnpm build:tv` then `python -I -u artifacts/poly-count20c2a.py "<wt>"`: 219 core-js modules; compare main with 405.3 KB Tizen / 392.5 KB webOS;
      - the full `pnpm e2e` (chromium + throttled; a chromium failure makes the throttled project "not run");
      - `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68`.
   6. **Docs, PR, merge:**
      - Docs: architecture.md "Built in step 28b1", and RELAY.md 28b1's "Done in leg …" with the step ticked after the merge.
      - PR: name the three riskiest changes first; merge on green CI (merge commit, keep the branch).
      - After the merge: fetch, `git -C "<wt>" merge --ff-only origin/main`, a docs PR recording the merge (as #87), push.
3. **Then 28b2** (the channels watched last, a profile version bump) if the leg is still light; otherwise hand over.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `59ae89a` docs: Omar's answer on Home; split 28b into 28b1 and 28b2;
  - `de402d5` Merge PR #87 (main);
  - `8cea47d` docs: record PR #86;
  - `9b07d25` Merge PR #86.
- **main** is `de402d5`. The tree is clean. **No PR is open.**
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links), `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `dist/` is fresh (leg 77's build with the header CSS);
  - `artifacts/`: `mutate28a*.py` and their logs, `e2e-28a-full-b.log` (123/123), `engines-28a.log` (16/16), `unit-28a.log` (4,630), `build-28a-b.log`;
  - screenshots `search-*`, `live-en-XA.png` (the five-button header in en-XA), `artifacts/engines/onboarding-chrome53-*-live.png`.
- **Docker Desktop:** images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`; no `lablo-chrome*` container left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## Gotchas and lessons
**New in leg 77:**
- **The header is checked in en-XA only by `live.spec.ts`'s pseudo-locale test.** Five buttons fit with about 20 px left; the sixth needs the icon buttons. To see what overflows, copy the spec aside, add a `console.log` of `getBoundingClientRect()` for `.live__header > *, .live__end .z-button`, run `-g pseudo`, then restore the copy.
- **A failure in the `chromium` project makes `throttled` "not run"** (`9 did not run`): the full run's count is only right when chromium is green.
- **`RemoteDriver.expectFocus` doesn't see which button is drawn focused:** check the button's own `data-state="focused"` (the e2e mutant that bound "Search" to Settings' index survived until then).
- **A mutation monitor started with `tail -n 0` misses lines written before it:** grep the whole log for `SURVIVED` at the end.
- **The relay's background watcher:** waiting on CI with an `until gh pr checks …; do sleep 60; done` background loop worked (about 20 minutes).

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3` and reaches vitest workers, Playwright's dev server, and Python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`. If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **The CDP CPU throttle does not slow dedicated workers:** time worker RPCs and scale them (`search-throttled.spec.ts`'s `recordRpc`).
- **Back from a player over another screen calls `live.focusRow`.** It keeps the live screen's zone while another screen is on top (`keepZone`).
- **In e2e, wait for an answer before the keyboard's OK** (`searchFor` waits for `data-answered`, `data-count` and `settled`). `Control+A`, `Backspace` clears a field; `keyboard.insertText` fires only `input`.
- **A show's details: Back from `show/episodes/0` goes to `show/seasons/0` first**, then out.
- **Some working copies are CRLF while git stores LF** (`e2e/big-catalog.ts` is CRLF here). Run `git ls-files --eol -- <files>` before scripting a patch; Python on Windows: `open(p, 'w', encoding='utf-8', newline='')`.
- **Bash heredocs mangle scripts with backticks or `\\`:** write scripts with the Write tool, then run them with `python -I`.
- **Inserting a header button or a rail entry shifts every index** in the e2e specs, the throttled specs and the old-engine walk. Grep `live/header/`, `movies/rail/`, `series/rail/`, `data-category` and `tools/engines` first.
- **No `Array.prototype.sort` in the TV main bundle** (Babel adds core-js's `es.array.sort`; the 219 gate). Copy `newestFirst` from `movie-progress.ts`. `.concat`, `.slice`, `.splice`, `.find`, `.map`, `.forEach` are already in.
- **`Screen.focus`/`update` notify listeners only when the position changes;** `focus(zone, -1)` clamps to 0; `focus()` into an empty zone notifies with index -1.
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text.**
- **The profile's tests use "this version + 1" as a newer version.** Bump those (and e2e `v:` pins) on every profile version (28b2).
- **Adding a field to a signal's value object breaks `toEqual` pins on it.** vitest `toEqual` ignores `undefined` properties; use `toStrictEqual` to pin a field's absence.
- **To end a VOD stream in a regular e2e:** hold its request, then `page.locator('#stage video').dispatchEvent('ended')`.
- **`RemoteDriver.expectFocus` reads the screen root's `data-*`;** a new screen's root needs `data-screen`, `data-zone`, `data-index`.
- **A spec's `page.route('**/series/**')` holds the dev server's modules from an app folder `/src/series/`.** `/src/home/` is safe (no mock path has it).
- **Every formatted number comes wrapped in marks in e2e text:** strip `MARKS`. ar-SA shows Western digits in e2e and unit texts.
- **Hiding the app in e2e:** `setHidden(page, true)`. **One e2e:media test alone:** `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/player-media.spec.ts -g "…"`.
- **A wait loop with `pgrep -f <word>` matches its own command line.** Wait on a log marker.
- **The Write tool turns `\u200e…` in a regex literal into raw characters.** Use `String.fromCharCode`.
- **A hidden app's `<video>` is empty** (`Html5Engine.suspend`). **An e2e key can beat an async read:** wait for a settled attribute.
- **The app imports only types from `@lablo/data`** (values only through `@lablo/data/client`: `CancelSource` is there).
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests.**
- **`python -I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **Chromium 68's V8 ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop.
- **Right after `gh pr create`, checks may not be listed yet:** treat "no checks reported" as pending. `gh run rerun --failed` refuses an in-progress run.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop (`gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`).
- **The CI media flake** (`test/epg-declared-300mb.media.test.ts` budgets): rerun the failed job once the whole run completes. "Install ffmpeg" can hang: `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **The i18n runtime isolates every message argument.** A compound like "7.5/10" must be one argument.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the media e2e: `pnpm --dir "<wt>" e2e:media`;
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`);
  - the poly count: `python -I -u artifacts/poly-count20c2a.py "<wt>"`.
- **TV bundle polyfills:** no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `.sort(`, `Array.from`, iterator calls, array destructuring or array spread in TV files (object destructuring and spread are fine). A member named `at` pulls `Array/String.at` in. The build can crash once (0xC0000005): run it again.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **Local `pnpm verify` may die at the unit stage** (low memory): run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **The mock:**
  - its panel zone is UTC by default; its synthetic media never plays;
  - movies 201–206: Big Buck Bunny 201 is first in "Recently added", Sintel is 202;
  - shows 301 ("Lablo Test Series") and 302 («مسلسل الاختبار»);
  - live 101–112: "Lablo Test FR - Mire" is 110, row 2 of "Test News";
  - "lablo test" finds 10 (8 channels, movie 205, show 301).
- **Never edit source while a mutation run, `pnpm e2e`, `e2e:media`, a build or the engines run is going.** Don't run the unit and e2e mutation scripts at the same time.
- **Code rules:**
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs (`ar.ts` has no comments); provider text uses `dir=auto` + `translate=false`;
  - physical CSS only, no CSS Grid or flex `gap`;
  - TV code is ES2017; dependencies at least 2 weeks old; never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, path-filtered (docs alone run none);
  - commits use the no-reply email; no secrets, no LG binaries, no personal data;
  - README.md stays "# Lablo" and the About box "Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified (leg 77):**
  - locally: lint, typecheck, unit 4,630, both TV builds (main 405.3 KB Tizen / 392.5 KB webOS, 219 core-js modules), `pnpm e2e` 123/123, `verify:engines` Chromium 53 and 68 16/16;
  - CI green on PR #86 (verify, engines, media); 28a merged.
- **Not done:** any of 28b1 or 28b2; `e2e:media` locally for 28a (no media code changed; CI's media job passed); any TV run.
- **Migrations and deploys:** N/A (no backend until step 29). The profile stays at version 6 (28b2 bumps it to 7). Nothing is deployed.

## Open decisions and gates
- **28b's place:** decided by Omar (option 1). Leg 77's own calls (not gates):
  - Home sits after "Series" (index 3);
  - icon-only buttons for Search and Settings with `aria-label`;
  - 28b2's way to find a recent channel's place is decided while building it.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, the player. Catch-up, the movies and series grids, "Continue watching", the details, playing, resuming, episodes, auto-next, the search and Home can join that visit, including whether the TV keyboards type into the search field.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters; whether the low tier keeps posters in lists (and Home's shelves); the memory of 20 kept shows' answers; the search's real time on the TV.
- **For step 38 (parental):** "Recently added", "Recently updated", "Continue watching", the search results **and Home's shelves** hold every category's items, adult ones included: the lock must filter them too.
- **Later (unchanged):**
  - search and Home: a kind filter in the search, if users ask; posters or logos in the search rows; Home and the search on the old-engine walk;
  - movies and shows: a show finished to its last episode coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start" for an episode; an episode's image in its row; the show's details, the series screen and "Continue watching" on the old-engine walk; grouping a playlist's episodes into shows; a CSS seed for the poster grid; a resume place re-matched when a provider renumbers a movie;
  - player: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents; webOS's PRE-CH; pre-buffered zapping; the last frame kept while reconnecting; subtitle parsing off the main thread; `SourceMemory` for catch-up;
  - guide: a day jump; a Guide or Info key; a screen for a guide's own zone;
  - input and accessibility: an on-screen keyboard if the TV keyboards fail; the accessibility route;
  - settings and old engines: step 38's settings rows; the details, settings and picker on the old-engine walk; a walk at a second hour; drop Chromium 53 (ADR-012);
  - low tier and data: a memory signal for the tier; holding refreshes while a low-tier TV plays; the catalogs as UTF-8; a "loading" look for unread rows;
  - CI: the media flake's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 28a (Omar, valid on main now)
1. **Start:** `pnpm dev` with the mock's Xtream source. UP to the header: "Guide · Movies · Series · Search · Settings". RIGHT three times to "Search", OK. (After 28b1 "Search" is a magnifier icon, four RIGHTs away.)
2. **The screen:** "Search", with the field "Channels, movies and series" focused and the line "Part of a name, in any language" under it.
3. **Type:** OK, type `lablo test`, OK (the keyboard's done).
   - You see "10 results", with the focus on the first row, "Lablo Test 1 SMPTE / Channel · Test News".
   - DOWN to the end: the 8 channels, then "Lablo Test Pattern 4K HEVC / Movie", then "Lablo Test Series / Series".
4. **Play a channel:** UP to "Lablo Test FR - Mire", OK: the player opens on it. Back: the search, on the same row.
5. **Arabic text:** Back (to the field), OK, replace the text with `اختبار`, OK.
   - Three rows: the movie «اختبار الصوت المتعدد» first, then the channel and the show.
   - DOWN twice, OK: the show's details. Back, Back: the search, on the show.
6. **A movie:** Back, OK, replace the text with `sintel`, OK, OK: Sintel's details. Back.
7. **Nothing:** Back, OK, type `zzzz`, OK: "0 results" and "Nothing has these words."; the focus stays on the field.
8. **Out:** Back: the live header, on "Search". DOWN: the list shows "Test News" with "Lablo Test FR - Mire" focused.
9. **In Arabic** (`?locale=ar-SA`): «البحث» in the header between «المسلسلات» and «الإعدادات»; the screen on the right; rows read right to left («قناة · Test News»).
10. **Pseudo-locale** (`?locale=en-XA`): all five header buttons inside the screen's safe edge, with the line after "Live TV" cut short.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-four CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description;
  - 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid";
  - 32: the commands table could add the one-engine and one-throttled-spec commands;
  - 33: its "Repo: private `Omarmarei/Lablo`" line (public since 2026-11-05);
  - 34: the header (now Guide, Movies, Series, Search, Settings; after 28b1, Guide, Movies, Series, Home and the two icons).
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
