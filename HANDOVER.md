# Zoma IPTV: relay leg 66 opening prompt

You are leg 66 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

**Omar paused the relay after leg 65** ("Pause after this leg"). Leg 65 reported needs-you, so no leg starts by itself. He resumes it by answering in leg 65's tab, or with `/relay stop iptv-20261101-214120` then `/relay continue iptv-20261101-214120` (a fresh leg from this file).

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–64 did steps 1–25 and 26a (PRs #1–#64), except step 16's Samsung part, 19b and 21.
- **Leg 65:** built step 26b (the poster grid at 4x CPU throttle and on Chromium 53/56/68), merged as PR #65, merge commit `41ba4c3`; ticked 26b (`ac26347`).
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open.
- **Relay cap:** 100 legs (`relay.py status`).

## Read first
1. `RELAY.md`, step 26 and its sub-steps (around line 1010): "Already built", the split, each sub-step's Done-when, "Done in leg 64" (26a) and "Done in leg 65" (26b).
2. `docs/architecture.md`:
   - §1.2 "Built in step 26a" and its "Since step 26b" line (the poster hold);
   - §4 "Built in step 26b";
   - §1.4 (VOD info kept 24 h);
   - the player's sections: §2, and "Built in step 25d" (the catch-up seek bar, pause and seeking).
3. For 26c, what exists:
   - `packages/core`: `decodeVodInfo`, `XtreamClient.vodInfo` (`get_vod_info`: plot, genre, cast, director, release date, duration, rating, cover, backdrops, trailer, container). Nothing in the data layer or the app calls it yet.
   - `packages/player`: `PlayRequest.mode: 'vod'`, `startMs`, the watchdog's 20 s VOD rule, a reopen at the last position, `positionMs()`, `seek(ms)`.
   - `apps/tv/src/player`: live and catch-up (`mode: 'live' | 'catchup'`), the seek bar from 25d.
   - `apps/tv/src/movies/movies-state.ts`: `createMovies({ ..., select })`, the hook for the details (not wired in `main.tsx` yet).
   - `e2e/playback-media.spec.ts` plays a VOD from 20 s through the controller; the mock's `get_vod_info` and its six films (201–206).

## Next: step 26c (RELAY.md), "The movie details and playing a movie"
1. **Check first** that nothing of it exists: `git log --oneline -15`, grep `vodInfo`, `details` and `'vod'` in `apps/tv/src`.
2. Build it to its Done-when:
   - the details (from `get_vod_info`, kept 24 h; an M3U movie's line; a spinner; the catalog's facts when the read fails; "Play" and "Back");
   - playing (`mode: 'vod'`, the movie's URL with its `container_extension`, the info bar, 25d's seek bar, LEFT/RIGHT and FF/RW seek, PLAY/PAUSE and OK pause, Back to the details, "The movie has ended");
   - **decide** what CH± and number entry do in a movie (nothing, or leave for live). It is a UX choice with no trade-off big enough to stop for: pick, record it in RELAY.md and the architecture, and say so in the handover.
3. **The common items** (RELAY.md step 26's list):
   - unit tests;
   - e2e en and ar with the screenshots looked at;
   - `e2e:media` (a Blender film's frames move after a seek);
   - a mutation run with the list written first (templates: `artifacts/mutate26b.py`, `mutate26b-e2e.py`);
   - `pnpm verify` green;
   - 219 core-js modules on both (`python -I -u artifacts/poly-count20c2a.py` right after the first `pnpm build:tv` with new TV code);
   - the PR merged;
   - a "press these keys" checklist.
4. Then 26d (resume) and 26e ("Recently added"), each in its own leg.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of these (pushed; the tree is clean):
  - `ac26347` docs: record PR #65's merge, tick step 26b;
  - `41ba4c3` Merge pull request #65;
  - `c14b180` docs: step 26b;
  - `892a40d` test (the mutation run's test gaps);
  - `7fe33af` test(engines) (the movies walk);
  - `d165721` test(e2e) (the throttled run);
  - `f62287d` feat(movies) (the poster hold).
- **main** is `41ba4c3`. The branch equals main plus the docs commits.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (`.cache/media` for `e2e:media`, `.cache/engines` for the old engines), `dist/`;
  - `artifacts/`:
    - `mutate26b.py` (59 mutants) with `mutate26b.log` and `mutate26b-b.log`; `mutate26b-e2e.py` and its log;
    - `poly-count20c2a.py`;
    - `perf/movies-throttled.json`;
    - `screenshots/movies-{en-US,ar-SA}.png`;
    - `engines/` (the last local engine runs: Chromium 56 and 68, with the `-movies` and `-movies-category` screenshots).
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit them (LG's license; the repo is public).

## What step 26b built (architecture.md §4 "Built in step 26b")
- **The throttled run** (`e2e/movies-throttled.spec.ts`, the `throttled` project): "Movies" on 20,000 movies in 100 categories (`bigCatalog`'s new `movies` option), at 4x CPU, full and forced low tier. Its 74 presses: 20 rows, 15 CH− pages, the rail, a category, Back, Back. They have 150 ms each; the three opening presses on the live screen have 200 ms. Short stops every fifth key.
  - **In the page** (`recordPosters`): at most 18 `img` at any DOM change; each poster's first download at least the tier's rest after the last key (Resource Timing's `startTime` against the keydown's `timeStamp`); at most 18 between two keys; the view's 18 posters at each rest.
  - **The posters:** 500 x 750 PNGs answered after 80 ms (`page.route`).
  - **CI (PR #65):** full median 20 ms, max 46; low median 14, max 28; opening up to 86 ms; no long task.
- **Found and fixed:** a poster download that ended let the next queued one start right after a key. `PosterLoader.hold()` on every focus move: no download starts before the next rest.
- **The old engines** (`tools/engines/src/movies.ts`; runbook old-engines.md item 6):
  - The walk goes on from the guide to the movies screen in 12 steps (`moviesSteps`): CH+ and up, the header's "Movies", OK, ArrowDown, CH−, along a row, to the rail, the Arabic category, Back, Back.
  - Each step in the screen checks the grid's geometry from the inline start, the tiles' titles and posters (decoded at the file's 184 x 276), the rail, the header and the focus.
  - Green on 53, 56 and 68, both bundles, both languages, on the first run.
  - **The fixture's movies:** `Films` (300) and `أفلام عربية` (300, Arabic names), each with `tvg-logo="…/poster-<k>.png?m=<n>"` (three real PNGs from `tools/engines/src/poster.ts`). The 13th of every 50 has no logo; the 8th's poster file is missing.
- **Tests:** 4,251 unit tests (+25). Mutation 59 written first: 49 caught, then 10/10 after the gaps were closed; e2e 4/4.
- **Size:** main 365.3 KB (Tizen) / 352.7 KB (webOS), app.css 78.9 KB, 219 core-js modules on both.
- **Not done:** a CSS seed for the poster grid. It would add six long self-test runs, and the engines job is at 17 m 44 s of its 25.

## Gotchas and lessons
**New in leg 65** (also in memory):
- **There is no `jq` in this Git Bash.** A Monitor or `until` loop with `| jq` fails silently: it never emits and never ends (leg 61's silent watch too). Use `gh … --json … --jq '…'`, or read `gh pr checks N -R Omarmarei/Lablo` in the foreground.
- **To run one throttled spec:** `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`. Without `--no-deps` it runs the whole chromium project first.
- **A walk of timed presses never rests between keys.** To test what keys do while images load, stop until the first `img` is drawn (`page.waitForFunction(…, { polling: 'raf' })`; `expect.poll` is too slow) and give the routed images latency. The full tier masked the bug (6 at once is exactly a row); check both tiers.
- **One old engine at a time:** `pnpm --dir "<wt>" verify:engines --engine chrome53` (about 4 min), or `--engine chrome56 --engine chrome68`. Needs a fresh `pnpm build:tv`.
- **`serve-fixture.sh`** strips the query and serves no subfolders, and sends `.png` as `application/octet-stream`. The old engines decode it anyway.
- **Python's `write_text` on Windows writes CRLF.** It is harmless here: `.gitattributes` normalizes to LF in the index. `git ls-files --eol` is the truth; `git cat-file -p | grep $'\r'` misleads with `core.autocrlf=true`.
- **Bash heredocs feeding python lose backslashes and fail on quotes** (again in this leg). Write the script with the Write tool, then `python -I <file> "$WT"`.

**From earlier legs (still true):**
- **The relay context check fires at about 450k tokens.** Budget code and e2e first, then mutation, docs, verify, PR, merge.
- **A member named `at` pulls `Array/String.at` into the TV bundle.** That happened five times, last in leg 64 as an object key in a local option. Run the poly count right after the first build of new TV code.
- **`Screen.focus(zone, i)` clamps and scrolls minimally.** A reset before it notifies the listeners at once.
- **e2e image checks:**
  - count requests with `page.on('request')` (a `page.route` abort never reaches the mock's hooks);
  - filter `Failed to load resource` out of `trackErrors`;
  - the mock's posters are 1×1 PNGs.
- **Never `cd`.** Keep to absolute paths.
- **Don't push to an open PR's branch while its CI runs.** The push cancels the run.
- **CI media "Install ffmpeg" can hang** on the Azure apt mirror until the 30-min cancel. Read the job's steps, then `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and the touched e2e specs separately; `pnpm test` (4,251) runs fine alone.
- **Non-media e2e that presses keys in the player:** hold the stream with `page.route(..., r => r.fetch().catch(() => undefined))`, or the error card takes the keys.
- **`ZoneSpec` is a union:** read `count` with `toMatchObject({ count })`.
- **The mock:**
  - Its panel zone is UTC by default (`odd-timezone` is Kathmandu).
  - Its synthetic media never plays; real frames need `ZOMA_E2E_MEDIA=1 ... --project=playback-media`.
  - Movies 201–206, posters at `/images/movie-<id>.png`, `get_vod_info` for each.
- **Tests:**
  - Root tests can't import an apps/tv module that reaches `@zoma/ui` (TS6142 shows only in `pnpm verify`); read the source as text instead (as `test/engines-onboarding.test.ts` does).
  - vitest's `testTimeout` is 30 s.
  - Playwright: `--project=chromium <pattern>`.
- **`SettingsScreen.tsx` and `main.tsx` are CRLF in the working copy.** Patch scripts preserve the line ending.
- **The Edit and Write tools decode `\u` escapes.**
- **Never edit source while `pnpm verify`, `e2e:media`, the engines or a mutation run is going.** Docs are safe. If a run is stopped, look for `*.mutbak`.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files;
  - count main after any TV-file change (219);
  - the build can crash once (0xC0000005): run it again.
- **Code rules:**
  - `packages/ui` components stay hook-free (`useZone` is the binding's);
  - UI text only from the catalogs (ar.ts has no comments);
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only, and no CSS Grid or flex `gap` (Chromium 53/56);
  - TV code is ES2017;
  - the app imports only types from `@zoma/data`;
  - dependencies at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` and `Claude-Session` lines.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R Omarmarei/Lablo` and absolute paths. **Never `cd`.**
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`, or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`** (the product is still "Zoma"):
  - CI runs on `pull_request` and `workflow_dispatch` only, its jobs path-filtered over the whole PR's diff;
  - commits use the no-reply email (the repo-local config);
  - no secrets, no LG binaries, no personal data.
- **Merging:** IPTV PRs merge on green CI without Omar (memory: merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - **Locally:**
    - lint, the full typecheck, the full unit suite (4,251), both TV builds (219 modules);
    - the throttled spec in both tiers, `movies.spec.ts` (en, ar), `tv-bundle.spec.ts`;
    - `pnpm verify:engines` on Chromium 53, 56 and 68 (24 runs as expected);
    - mutation 59/59 after the gaps, e2e 4/4;
    - the old engines' movies screenshots (53 en and ar, 56 ar) looked at.
  - **On CI (`c14b180`):** verify 9 m 28 s, engines 17 m 44 s (108 runs as expected), media skipped by the path filter.
- **Not done:**
  - the full local `pnpm verify` and `pnpm e2e` (CI ran them);
  - any TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up and its seeking can join that visit, and the movies grid now, and the details and playing once 26c is in.
- **For step 41 (the 2018 Samsung):**
  - the decoded memory of a grid of real panel posters;
  - whether the low tier keeps posters in lists.
- **Optional, from leg 65:** a CSS seed for the poster grid (`VirtualGrid.css`'s flex rows taken out) in the self-test. It would add six long engine runs (the job is at 17 m 44 s of its 25).
- **Later, from leg 63:** fine seeking inside HLS archives; "start over"; separate PLAY and PAUSE intents.
- **Later, from leg 62:** a day jump in the guide.
- **Later (unchanged):**
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
  - `SourceMemory` for catch-up.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.

## "Press these keys" checklist for step 26b (Omar)
1. **The throttled numbers:** `pnpm exec playwright test --project=throttled --no-deps movies-throttled`. Read the `[movies, full tier …]` and `[movies, low tier …]` lines: every press well under 150 ms, and "the soonest … ms after a key" above 150 (full) and 300 (low).
2. **The old engines:** in PR #65's CI run, download the `old-engines-report` artifact and open `onboarding-chrome53-tizen-en-movies.png` and `onboarding-chrome53-webos-ar-movies-category.png`. Expect:
   - three rows of six coloured posters, 24 px apart;
   - tile 8 (`Zoma Film 2408`, a missing poster) and tile 13 (no logo) showing only their titles;
   - in Arabic, the rail on the right and the grid filling from the right.
3. **In `pnpm dev` with a big playlist** (`?scale=`, or a real one), open "Movies" and hold DOWN:
   - no poster loads while the key is held, only titles;
   - about a sixth of a second after you let go (a third on `?tier=low`), the focused row's posters come first, then the rest of the view;
   - press DOWN again while they load: the ones still waiting wait for the next stop.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-two CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description (108 runs, 80 that must fail);
  - 31: the cheat sheet's CSS row could add "and no CSS Grid in a poster grid: `VirtualGrid`'s flexbox rows";
  - 32 (new in leg 65): the commands table could add `pnpm verify:engines --engine chrome53` (one engine) and `playwright test --project=throttled --no-deps <spec>` (one timed run).
- **Secrets:** none pending.
