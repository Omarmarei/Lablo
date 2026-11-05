# Zoma IPTV: relay leg 65 opening prompt

You are leg 65 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–63 did steps 1–25 (PRs #1–#63), except step 16's Samsung part, 19b and 21.
- **Leg 64:**
  - checked what exists for movies and split step 26 into 26a–26e in RELAY.md (`ceec388`);
  - built step 26a (the movies screen and its poster grid with tiered image caps);
  - merged it as PR #64, merge commit `ac34a69`;
  - ticked 26a (`4619c5e`).
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open.
- **Relay cap:** 100 legs (`relay.py status`).

## Read first
1. `RELAY.md`, step 26 and its sub-steps (around line 1010). It has "Already built" (what leg 64 found), the split's reasons, each sub-step's Done-when, and 26a's "Done in leg 64".
2. `docs/architecture.md` §1.2, "Built in step 26a".
3. For 26b, the earlier throttled and old-engine work:
   - architecture.md §4, "Built in step 14b", "23d", "23e", "25c";
   - `e2e/guide-throttled.spec.ts`, `e2e/live-throttled.spec.ts`, `e2e/big-catalog.ts`;
   - `tools/engines/src/guide.ts`, `live.ts`, `onboarding.ts` (the walk);
   - `docs/runbooks/old-engines.md`.

## Next: step 26b (RELAY.md), "The poster grid at scale and on the old engines"
1. **Check first** that nothing of it exists: `git log --oneline -15`, grep `movies` in `e2e/*throttled*` and `tools/engines/src`.
2. **The throttled run:** add a movies run, a new spec or a test in the `throttled` project (`playwright.config.ts`: `throttled.spec.ts$`, one worker, after `chromium`).
   - The catalog: 20,000 movies in 100 categories. Add a `movies` option to `e2e/big-catalog.ts`'s `bigCatalog` (the mock's `Movie` type: `id`, `num`, `name`, `categoryId`, `ext`, `year`, `durationSecs`, `rating`, `genre`, `plot`, `addedDaysAgo`, `media: 'vod'`).
   - The presses, at 4x CPU in both tiers (`?tier=low`), each from a fresh start with the source stored:
     - UP, RIGHT, OK on "Movies";
     - DOWN through rows and pages of CH−;
     - LEFT to the rail, down it, OK on a category;
     - Back.
   - Each press within 150 ms (calibrate on CI as 23d did).
   - At each rest, the image requests stay within the view's 18, and the drawn `img` count is at most 18.
3. **The old-engine walk** (`tools/engines`): both bundles, English and Arabic, on Chromium 53, 56 and 68.
   - "Movies" by the TVs' keys.
   - Measure the grid's tiles against the layout from the inline start: 184 × 276, 24 px gaps, 6 a row, 3 rows, the rail 440 px plus 32 px. This is the first screen without CSS Grid in a row layout of images.
   - Check that the posters are drawn.
   - Check that the focus engine equals the screen's `data-screen/zone/index` at every step.
   - The fixture (`tools/engines/src/fixture.ts`) probably needs movies with posters. It serves files from a staged origin, so a poster needs to be a real small image file, not the mock's route.
4. **The common items** (RELAY.md step 26's list):
   - unit tests;
   - e2e en and ar with the screenshots looked at;
   - a mutation run with the list written first (templates: `artifacts/mutate26a.py`, `mutate26a-e2e.py`);
   - `pnpm verify` green;
   - 219 core-js modules on both (`python -I -u artifacts/poly-count20c2a.py` after `pnpm build:tv`);
   - the PR merged;
   - a "press these keys" checklist.
5. Then 26c (the details and playing a movie), 26d (resume) and 26e ("Recently added"), each in its own leg.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of these (pushed; the tree is clean):
  - `4619c5e` docs: record PR #64's merge, tick step 26a;
  - `ac34a69` Merge pull request #64;
  - `7d58413` docs: step 26a;
  - `e1c903a` fix (the mutation run's findings);
  - `27d251d` fix (the mutation list's findings before the run);
  - `dea688e` e2e;
  - `8e92ab9` feat;
  - `ceec388` docs: the step 26 split.
- **main** is `ac34a69`. The branch equals main plus the docs commits.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (`.cache/media` for `e2e:media`), `dist/`;
  - `artifacts/`:
    - `mutate26a.py` (the newest unit template: 89 mutants) with `mutate26a.log`, `mutate26a-b.py` and `mutate26a-b.log`;
    - `mutate26a-e2e.py` and its log (the newest e2e template);
    - `poly-count20c2a.py`;
    - `screenshots/movies-{en-US,ar-SA}.png`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit them (LG's license; the repo is public).

## What step 26a built (architecture.md §1.2 "Built in step 26a")
- **The header:** "Guide" (0), "Movies" (1), "Settings" (2) (`HEADER_MOVIES` in `live-state.ts`). OK on "Movies" opens the screen in every state of the live list. The five specs that reach "Settings" press twice now.
- **`apps/tv/src/movies/movies-state.ts`:** `createMovies({ nav, engine, tier, timers, select })`.
  - The screen `movies` (pushed on the live navigator; `LiveApp` paints `MoviesScreen` instead of the live screen) has the zones `rail`, `grid` (a `grid` zone, 6 columns, `MOVIES_ROWS` = 3) and `retry`.
  - The rail comes from live-state's `railEntries`, with kind `movie`.
  - Chunks are read for the rows in view and one either side, through `ChannelIndex`, with `CHUNK_CACHE` 8 kept least-recently-used. The chunks a view needs are never dropped.
  - `catalogChanged` keeps the category by name, the focus's place and the view (main.tsx calls it from the refresh schedule's `onCatalog`).
  - Back in the grid goes to the rail; Back on the rail, or on an empty or failed screen, closes it.
  - `select(item)` is the hook for 26c's details. It is not wired in `main.tsx` yet.
  - `pending` counts the reads, a rest not over yet and the posters in flight.
- **`posters.ts`:** `PosterLoader(parallel)` with `rest(urls)`, `src(url)`, `loaded`, `failed`, `inFlight` and `clear`. `POSTER_TIERS` is full `{ restMs: 150, parallel: 6 }` and low `{ 300, 2 }`; `POSTER_MEMORY` is 1000.
  - Posters are asked only once the view rests, the focused row first.
  - A download that left the view is let go.
  - A failed poster shows the title.
- **`@zoma/ui`:**
  - `VirtualGrid` (with `gridRows`): flexbox rows of the rows in view, the gaps as custom-property margins so Arabic mirrors.
  - `Tile`'s `poster` (`z-tile--poster`, a two-line clamped title) and `onImageLoad`/`onImageError`.
  - The tokens `--poster-width` 184 and `--poster-height` 276 (`LAYOUT.posterWidth`/`posterHeight`).
- **New catalog keys** (en, ar): `movies.open`, `movies.title`, `movies.all`, `movies.count`, `movies.noGroup`, `movies.loading`, `movies.empty`, `movies.failed`. "Try again" reuses `live.retry`.
- **Decided (not gates):**
  - The tiers differ in the rest and the downloads at once, not in the posters drawn.
  - "No posters in lists" (S6's fallback) waits for the 2018 Samsung (step 41).
  - The poster is the item's `logo`.
  - The title sits over the poster, in two lines.
- **Not done:** the decoded size of big panel posters. A count cap doesn't bound bytes; step 41 measures it, and a canvas downscale is the next cap.
- **Tests:**
  - 4,226 unit tests (+84);
  - e2e `movies.spec.ts` (en-US, ar-SA; the mock's six films plus forty of ours; Sintel's poster aborted);
  - mutation 79/89, then 10/10, and e2e 6/6.
- **Size:** main 365.2 KB (Tizen) / 352.6 KB (webOS), app.css 78.9 KB, 219 core-js modules on both.
- **CI on `7d58413`:** verify 15 m 25 s (about twice its usual 7 min, for no known reason), media 9 m 31 s, engines 17 m 04 s.

## Gotchas and lessons
**New in leg 64** (also in memory):
- **A member named `at` pulled `Array/String.at` in a fifth time,** as an object key in a local option (`load({ ref, at })`): 225 core-js modules. Run the poly count right after the first build of new TV code, not at the end.
- **`Screen.focus(zone, i)` clamps and scrolls minimally,** so a `reset` before it, or a clamp around it, is redundant. A reset also notifies the listeners at once: a swap that reset to the top read the top's chunks before focusing the kept place.
- **e2e image checks:**
  - count requests with `page.on('request')`: a `page.route` abort never reaches the mock's hooks;
  - filter `Failed to load resource` out of `trackErrors`;
  - the mock's posters are 1×1 PNGs (invisible in screenshots; the tiles' titles show).
- **Long Bash heredocs feeding python failed to parse again** (quotes in test text). Write the script with the Write tool, then run `python -I <file> "$WT"`.
- **Never `cd`:** one `cd "$WT"` in a compound moved this session's primary working directory to the worktree. It is harmless, but keep to absolute paths.
- **Don't push to an open PR's branch while its CI runs.** The push cancels the run (concurrency), and the path filter looks at the whole PR.

**From earlier legs (still true):**
- **The relay context check fires at about 450k tokens.** Budget code and e2e first, then mutation, docs, verify, PR, merge.
- **CI media "Install ffmpeg" can hang** on the Azure apt mirror until the 30-min cancel. Read the job's steps, then `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (workers 0xC0000142, then the shell is reaped for low memory). Run lint, typecheck, `pnpm test`, `build:tv` and the touched e2e specs separately. In leg 64 the full `pnpm test` (4,226) ran fine on its own.
- **Non-media e2e that presses keys in the player:** hold the stream with `page.route(..., r => r.fetch().catch(() => undefined))`, or the error card takes the keys.
- **`ZoneSpec` is a union:** read `count` with `toMatchObject({ count })`.
- **The mock:**
  - Its panel zone is UTC by default (`odd-timezone` is Kathmandu).
  - Its synthetic media never plays; real frames need `ZOMA_E2E_MEDIA=1 ... --project=playback-media`.
  - Movies 201–206, posters at `/images/movie-<id>.png`.
- **Tests:**
  - Root tests can't import an apps/tv module that reaches `@zoma/ui` (TS6142 shows only in `pnpm verify`).
  - vitest's `testTimeout` is 30 s.
  - Playwright: `--project=chromium <pattern>`.
- **`SettingsScreen.tsx` and `main.tsx` are CRLF in the index.** Patch scripts preserve the line ending.
- **The Edit and Write tools decode `\u` escapes.**
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Docs are safe. If a mutation run is stopped, look for `*.mutbak`.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls (`.keys().next()`) or array destructuring in TV files;
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
    - lint, the full typecheck, the full unit suite (4,226), both TV builds (219 modules);
    - the touched e2e specs: 49 (movies en and ar, the five that reach "Settings", live, guide, player, resume, gallery);
    - mutation 79/89, then 10/10, and e2e 6/6;
    - screenshots `movies-{en-US,ar-SA}` looked at.
  - **On CI:** all four jobs green on `7d58413`.
- **Not done:**
  - the full local `pnpm verify` and `pnpm e2e` (CI ran them);
  - the movies screen on Chromium 53/56/68 (26b);
  - any TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up and its seeking can join that visit, and the movies grid when 26b/26c are in.
- **For step 41 (the 2018 Samsung):**
  - the decoded memory of a grid of real panel posters;
  - whether the low tier keeps posters in lists.
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

## "Press these keys" checklist for step 26a (Omar, in `pnpm dev` with `pnpm mock`)
1. Onboard with the mock's Xtream login, then "Start watching".
2. UP to the header: "Guide", "Movies", "Settings". RIGHT to "Movies", then OK.
3. The movies screen: "Movies · All movies · 6 movies" in the header. The rail on the left: "All movies 6", "Open Movies | أفلام مفتوحة 4", "Test Patterns 2". Six poster tiles in one row (Big Buck Bunny, Sintel, Tears of Steel, Elephants Dream, the 4K pattern, the multi-audio file), titles in up to two lines, the first one ringed.
4. RIGHT along the row; LEFT back. LEFT from the first tile goes to the rail. DOWN twice, then OK on "Test Patterns": its two tiles, the first focused.
5. Back goes to the rail on "Test Patterns". Back again closes the screen, and the header keeps "Movies" focused. DOWN goes to the channel list.
6. Arabic (`?locale=ar-SA`): the rail on the right, the grid filling from the right, "الأفلام" in the header, and LEFT/RIGHT mirrored (RIGHT from the first tile goes to the rail).
7. With many movies (the `?scale=` catalogs, or a real playlist), hold DOWN: the rows scroll with titles only, and the posters come about a sixth of a second after the key is let go.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-one CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description (108 runs, 80 that must fail).
  - 31 (new in leg 64): the cheat sheet's CSS row could add "and no CSS Grid in a poster grid: `VirtualGrid`'s flexbox rows".
- **Secrets:** none pending.
