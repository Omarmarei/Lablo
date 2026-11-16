# Lablo IPTV: relay leg 80 opening prompt

You are leg 80 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–78 did steps 1–28a and built 28b1 (PRs #1–#87), except step 16's Samsung part, 19b and 21 (they wait for Omar).
- **Leg 79 finished step 28 (Search and Home):**
  - **28b1** (the header's icons and Home): verified, then merged as PR #88 (`6b757ed`). Its docs went in as PR #89.
  - **28b2** ("Recent channels" on Home): built, verified and merged as PR #90 (`5a1832e`). Its docs went in as PR #91 (`b9572e9`).
    - **Profile version 7:** `channels`, the channels played last (each a `LastChannel`), newest first, once per key, at most 20 (`MAX_CHANNELS`). Each new last channel goes first in the same write as `player.last`. The migration 6 → 7 starts the list with `player.last`.
    - **The player memory:** `recent()`; at the start, `recentChannelsOf`.
    - **`Live.playKept(ref, key, guess)`:** the rail entry by name ("All channels" when it is gone), the row it had first. It shares `playIn` with `playFound`.
    - **Home's "Recent channels"** comes after "Continue watching", as landscape channel tiles: 264 × 148, 6 in view, the logo whole above the name. OK plays the channel from its group, with the player over Home. Back returns to Home with that channel first and focused.
  - Steps 28b2, 28b and 28 are ticked in RELAY.md.
- **Next: step 29, the backend skeleton.** Phase 8 starts here, with local development only until step 34.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - "Definition of done": item 3, migrations. They are N/A until step 29. Production (Neon) migrations come only with step 34 `[needs Omar]`, so step 29 is local only.
   - Phase 8, steps 29–34.
   - Leg 79's progress-log row.
   - Step 28a or 28b2's "Done in leg …" block: the pattern to follow.
2. **`docs/PLAN.md`** (it wins on conflicts). The backend row (around line 304: Next.js + Prisma + Neon Postgres + Cloudflare R2 + Upstash on Vercel; never fetches a user-supplied URL, never relays streams, enforced by lint). The repo layout (line ~311: `apps/web/` with `/p` phone pairing page, `/v1/*` API, legal pages, landing). The boundaries (line ~329: `apps/web` may not make outbound fetches…). Lines ~358 and ~393.
3. **`docs/architecture.md` §3 "Backend (minimal)"** (line ~1514): 3.1 what v1 needs, 3.2 the stack and endpoints, 3.3 the encryption and key scheme, 3.4 telemetry.
4. **`packages/protocol/src/index.ts` and `packages/crypto/src/index.ts`:** 7-line skeletons from step 1 (`export {}`). Their doc comments say what goes in: zod schemas; tweetnacl and @noble/hashes wrappers.
5. **`eslint.config.*`:** it already has an `app-web` boundary type (`apps/web`).
6. **`CLAUDE.md`:** "Package boundaries" and the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on `b9572e9` (the merge of PR #91).
   - main is `b9572e9`.
2. **Step 29: look for existing work first.** `git log`, and grep for `apps/web`, `prisma`, `next` in the package files, `docker-compose`.
3. **Size the step.** Step 29 is large: Next.js + Prisma + local Postgres in Docker; the R2 and Upstash abstractions; the `protocol` and `crypto` packages with shared test vectors.
   - Split it first if it won't fit one leg, as legs 76–77 split 28. One possible split:
     - **29a:** `apps/web` (App Router, a health route, Prisma against a local Postgres in Docker, the no-outbound-fetch lint, a CI job and path filter);
     - **29b:** `protocol` and `crypto` with shared test vectors, plus the R2 and Upstash interfaces with local fakes.
   - Write the split into RELAY.md with runnable "Done when" checks before building. The split is the leg's own call, not a gate.
4. **Check these early (each can block):**
   - **Smart App Control blocks native modules** (rollup's `.node` already needs the wasm hook).
     - Next.js's SWC is a native binary (`@next/swc-win32-x64-msvc`; there is a wasm fallback).
     - Prisma's query engine is native too (newer Prisma has a Rust-free client: check the chosen version's docs).
     - Probe each load early. If something is blocked with no wasm route, that is a needs-you stop: turning SAC off is Omar's call (memory `smart-app-control-rollup`).
   - **pnpm 11 `allowBuilds`:** Prisma's and Next's install scripts need entries (memory `pnpm11-allowbuilds`).
   - **Dependencies at least 2 weeks old:** check the dates via the npm registry.
   - **The repo is public:** no secrets. Local Postgres credentials go in a gitignored `.env` (plus a committed `.env.example`), or as non-secret dev defaults in docker-compose. Nothing touches production before step 34.
   - **CI:**
     - The `changes` job's path filters need `apps/web` and the new packages.
     - CI runs only on `pull_request` and `workflow_dispatch`.
     - Docker is available on the runners and locally: Docker Desktop holds `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`.
5. **Step 26's common items still apply** to each step:
   - unit tests;
   - a mutation run with the mutant list written first;
   - the `pnpm verify` parts green;
   - the PR merged on green CI;
   - docs: RELAY.md "Done in leg …", and an architecture.md "Built in step …" section;
   - a docs PR recording the merge.

   The TV bundle's gates (219 core-js modules, size budgets) matter only if TV code changes.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `b9572e9` Merge PR #91 = main;
  - `693626c` the docs commit;
  - `5a1832e` Merge PR #90.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `dist/`: the 28b2 build;
  - `artifacts/`:
    - `mutate28b2.py`, `mutate28b2-e2e.py` and their logs;
    - `unit-28b2.log` (4,733), `e2e-28b2-full.log` (127/127), `engines-28b2.log` (16/16), `build-28b2.log`;
    - the 28b1 files;
    - screenshots `home-channels-*`.
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 79:**
- **Overlap CI with the next step** (memory `iptv-relay-overlap-ci`).
  - While a PR's CI runs (about 20 min), write the next step uncommitted.
  - After the merge, run `git merge --ff-only origin/main`: it works with a dirty tree.
  - Commit the docs PR's files alone (scoped `git add`), then the new work.
  - Don't push while that PR's CI runs.
- **One CI poller only.** A foreground wait loop that hits the Bash tool's 600 s timeout is moved to the background and keeps running. Twice this leg it doubled a poller already running in the background. Start one poller with `run_in_background` and wait for its notice.
- **The media flake recurred on PR #88** (`epg-declared-300mb`, 76 ms vs 60). One `gh run rerun <run> --failed -R Omarmarei/Lablo`, after the whole run completed, passed. PR #90 passed on its first run.
- **`tokens.css` already sets `box-sizing: border-box` on every element.** Never add it per component.
- **The mock answers every logo and poster with a 1×1 PNG.** To see a logo's layout in e2e, route `**/images/channel-*.png` to an SVG (`contentType: 'image/svg+xml'`).
- **Never route `**/live/**`, `**/series/**` or `**/home/**`** in e2e: those patterns hold the dev server's modules from app folders.
- **The profile is at version 7.**
  - The next bump moves the pins to 8, and the "can't save a newer version" tests (`v: 8`) to 9.
  - Some "newer" fixtures use `v: 9` (`profile.test.ts`, `query-service.test.ts`): they stop being newer at version 9.
  - The e2e pin is `episode-resume.spec.ts`'s `v: 7`.
- **Home:**
  - `SHELF_ORDER` is `continue, channels, movies, series`; `tilesInView(shelf)` (6 for channels, else 8).
  - Test ids are `home-channels-<i>`.
  - In `main.tsx`, `createHome` gets `channels: memory` and `play: (c) => live.playKept(c.category, c.item.key, c.index)`.
- **Writing the mutant list first paid off again.** It showed two CSS rules no test checked (the channel row's height, the logo's box-sizing) before the run.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3` and reaches vitest workers, Playwright's dev server, and Python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
- **Long Bash heredocs with a Python patch can fail** ("unexpected EOF"). Write the patch with the Write tool, then run `python -I <file>`; short heredocs worked this leg.
- **Unit mutants take about 7 s each; e2e mutants about 20 s.** A `Monitor` on `tail -n +1 -f <log> | grep -E --line-buffered "SURVIVED|EXIT|/N"` reports survivors as they come. Any word like "Error" in a mutant's text matches too.
- **The relay's context check fires at about 450k tokens.**
- **The header is checked in en-XA only by `live.spec.ts`'s pseudo-locale test.** Six buttons fit (two are 56 px icons); a seventh needs another change.
- **A failure in the `chromium` project makes `throttled` "not run".**
- **`RemoteDriver.expectFocus` doesn't see which button is drawn focused:** check the button's own `data-state="focused"`.
- **The CDP CPU throttle does not slow dedicated workers:** time worker RPCs and scale them.
- **`useZone` is no real hook:** Home's screen is unit-tested by calling `HomeScreen(...)` as a function, and a `VirtualList`'s `renderItem` by hand.
- **A held fake-engine read exists only after the profile's `await` resolved:** `await flush()` before resolving it.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch; write with `newline=''`.
- **Inserting a header button or a rail entry shifts every index** in the e2e specs, the throttled specs and the old-engine walk. Grep `live/header/`, `movies/rail/`, `series/rail/`, `data-category` and `tools/engines` first.
- **No `Array.prototype.sort` in the TV main bundle** (the 219 gate). `Array.isArray` is fine.
- **`Screen.focus`/`update` notify only when the position changes;** `focus()` into an empty zone notifies with index -1.
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text.**
- **vitest `toEqual` ignores `undefined` properties;** use `toStrictEqual` to pin a field's absence.
- **A screen's root needs `data-screen`, `data-zone`, `data-index`** for `RemoteDriver.expectFocus`.
- **Every formatted number comes wrapped in marks in e2e text:** strip `MARKS`.
- **The app imports only types from `@lablo/data`** (values only through `@lablo/data/client`); tests may import values.
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters).
- **`python -I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop.
- **Right after `gh pr create`, checks may not be listed yet:** treat "no checks reported" as pending. `gh run rerun --failed` refuses an in-progress run.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop (`gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`).
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`);
  - the poly count: `python -I -u artifacts/poly-count20c2a.py "<wt>"`.
- **TV bundle polyfills:** none of these in TV files:
  - `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `.sort(`, `Array.from`;
  - iterator calls, array destructuring, array spread;
  - a member named `at`.

  The build can crash once (0xC0000005): run it again.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Local `pnpm verify` may die at the unit stage** (low memory): run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **The mock:**
  - its panel zone is UTC by default; its synthetic media never plays;
  - movies 201–206: Big Buck Bunny 201 is first in "Recently added";
  - shows: "Recently updated" lists 302 first, then 301;
  - live: "Kids" has one channel, Lablo Kids Test; "All channels" row 1 is Lablo Test 2 Clock.
- **Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going.**
- **Code rules:**
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs (`ar.ts` has no comments);
  - physical CSS only, no CSS Grid or flex `gap`;
  - TV code is ES2017; dependencies at least 2 weeks old; never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, path-filtered;
  - commits use the no-reply email; no secrets, no LG binaries, no personal data;
  - README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 79:**
  - **28b1, locally:** both TV builds (main 413.9 / 401.2 KB, 219 core-js modules), `pnpm e2e` 125/125, Chromium 53/68 16/16, lint, typecheck. CI was green (media on a rerun).
  - **28b2, locally:**
    - unit 4,733;
    - both TV builds (main 415.7 / 403.0 KB, query worker 116.6 KB, 219 core-js modules);
    - `pnpm e2e` 127/127, Chromium 53/68 16/16, lint, typecheck;
    - mutation 64/68 with the four gaps closed (4/4); e2e mutation 9/10, with the survivor's line taken out;
    - screenshots `home-channels-*` looked at.

    CI was green on the first run.
- **Not done:** any TV run. `e2e:media` was not run (no media code changed).
- **Migrations and deploys:** no backend yet. The only migration is the client-side profile's (6 → 7), which runs in each TV's IndexedDB on load. Nothing is deployed.

## Open decisions and gates
- **None for step 29.** How to split it is the leg's call.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player.
    - Catch-up, the movies and series grids, "Continue watching", the details, playing, resuming, episodes, auto-next, the search and Home (with "Recent channels") can join that visit.
    - The visit can also check whether the TV keyboards type into the search field.
- **For step 41 (the 2018 Samsung):** the decoded memory of real posters and channel logos (grids, Home's shelves); whether the low tier keeps posters in lists; the search's real time on the TV.
- **For step 38 (parental):** "Recently added", "Recently updated", "Continue watching", the search results and Home's shelves, **"Recent channels" included**, hold adult items too: the lock must filter them.
- **Later (unchanged):**
  - search and Home: a kind filter in the search; posters in the search rows; Home and the search on the old-engine walk;
  - movies and shows: a show finished to its last episode coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start" for an episode;
  - player: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents; webOS's PRE-CH; pre-buffered zapping;
  - guide: a day jump; a Guide or Info key;
  - input and accessibility: an on-screen keyboard if the TV keyboards fail;
  - settings and old engines: step 38's settings rows; drop Chromium 53 (ADR-012);
  - low tier: a memory signal for the tier;
  - CI: the media flake's single-sample budgets (five failures in seven PRs).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for Home (Omar; steps 28b1 and 28b2 are merged)
1. **Start:** `pnpm dev` with the mock's Xtream source. UP to the header: "Guide · Movies · Series · Home", then a magnifier and a gear.
2. **Home with nothing played:** on "Home", OK. You see "Recently added movies" (Big Buck Bunny first, focused) and "Recently updated series".
3. **Play two channels:**
   - Back to the list. LEFT to the rail, DOWN to "Kids", OK, then OK on Lablo Kids Test (it plays). Back, Back.
   - UP to "All channels", OK, DOWN, OK on Lablo Test 2 Clock. Back.
4. **Recent channels:** UP to the header, RIGHT to "Home", OK.
   - "Recent channels" is on top: Lablo Test 2 Clock (focused), then Lablo Kids Test, as wide tiles with the name at the bottom.
   - "Recently added movies" is below.
5. **Play from Home:** RIGHT, OK: Lablo Kids Test plays. Back: Home, with Lablo Kids Test now first and focused.
6. **Out:** Back: the header, on "Home". DOWN: the list on "Kids", on Lablo Kids Test.
7. **Relaunch** (reload): the last channel plays. Back, then UP to "Home" and OK: the same two channels, in the same order.
8. **A movie:** on Home, DOWN to Big Buck Bunny, OK, "Play", RIGHT four times, Back, Back. "Continue watching" now leads, above "Recent channels".
9. **In Arabic** (`?locale=ar-SA`): «القنوات الأخيرة», with the tiles starting on the right.
10. **Pseudo-locale** (`?locale=en-XA`): all six header buttons inside the screen's safe edge.

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
  - 34: the header (now Guide, Movies, Series, Home, and the Search and Settings icons).
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create. He puts the keys in `.env` himself.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
