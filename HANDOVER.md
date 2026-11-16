# Lablo IPTV: relay leg 79 opening prompt

You are leg 79 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–77 did steps 1–28a (PRs #1–#87), except step 16's Samsung part, 19b and 21 (they wait for Omar). Omar chose Home's place on 2026-11-16 (option 1: a header button, the app still opens on the live screen); leg 77 split 28b into 28b1 and 28b2.
- **Leg 78 built and tested step 28b1. It is NOT merged and has no PR yet.** The relay's context check ended the leg before the verification.
  - **The icon-only Button** (`packages/ui` `Button` `iconOnly`): the icon alone in a square button, the label only as `aria-label`; without an icon the label stays.
  - **The header:** Guide 0, Movies 1, Series 2, **Home 3**, then the icons **Search 4** (a magnifier) and **Settings 5** (a gear), both drawn in `LiveApp.tsx` as inline SVG in `currentColor`. Each is 56 px square in the header (`live.css` `.live__end .z-button--icon`). It fits in en-XA (screenshot looked at).
  - **Home** (`apps/tv/src/home/`: `home-state.ts`, `HomeScreen.tsx`, `home.css`):
    - Shelves "Continue watching" (movies and shows merged in `unfinished()`'s order by `mergeByKeys`, one `itemsByKey` per kind), "Recently added movies", "Recently updated series" (`recent`), at most 20 each.
    - Two shelves in view (`top` moves as little as it can); empty shelves hidden; one line when there is nothing; "Try again" after a failure.
    - OK on a tile: a movie's details, or a show's (`selectSeries`, in `main.tsx`'s `select`). Back from them returns to the tile; Back on Home closes it onto the header's "Home".
    - Read again after a save (the places' `version`) and on a catalog swap (`onCatalog`), the focus kept on its item.
  - **Catalogs** `home.open/title/movies/series/loading/empty/failed`, in en and ar.
  - **Tests:**
    - unit: the whole `pnpm test` 4,708 (home-state 37, home-screen 6, live-state 78 → 79, components +3);
    - e2e: `e2e/home.spec.ts` en-US and ar-SA 2/2; the 8 shifted specs 23/23; `live.spec.ts`'s en-XA test now also checks the icons' `aria-label`s.
  - **Mutation:**
    - `artifacts/mutate28b1.py`: 158 written first, 155 caught. The 3 survivors were test gaps, now closed; re-run 6/6.
    - `artifacts/mutate28b1-e2e.py`: 23/23.
    - Both docstrings record the results.
  - lint and typecheck green.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - step 28b (Omar's decision, "Decided in leg 77");
   - the 28b1 and 28b2 entries (their Done-when);
   - legs 77 and 78's progress-log rows;
   - 28a's "Done in legs 76–77", the pattern for 28b1's "Done in leg …".

   Step 26's common items: unit tests; e2e by keys in English and Arabic with the screenshots looked at; a mutation run with the mutant list written first; `pnpm verify` parts green; main within budget with 219 core-js modules on both platforms; the PR merged; a "press these keys" checklist in the handover.
2. **`artifacts/arch-28b1-draft.md`** (gitignored, in the worktree): leg 78's draft of architecture.md §1.2 "Built in step 28b1". Fill its `MUTATION_TEXT`, `SIZE_TEXT`, `VERIFY_TEXT` and the "Merged" line, then insert it after "Built in step 28a" (ends at the "**Merged:** PR #86" line, before "**State:**").
3. **The code:** `git -C "<wt>" log --oneline de402d5..HEAD`, and `git diff de402d5..HEAD -- apps packages e2e`.
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean;
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on `b1e30bb` (leg 78's progress row), on `2082f90`;
   - main is `de402d5`.
2. **Verify 28b1:**
   1. `pnpm --dir "<wt>" build:tv`, then `python -I -u artifacts/poly-count20c2a.py "<wt>"`. It must show 219 core-js modules on both platforms. Note main's size: leg 77 had 405.3 KB Tizen / 392.5 KB webOS. `home-state.ts` uses only `.slice`, `.concat`, `.indexOf`, `.map`, `Promise.all`, for-of and `Math`; if the count moves, look there.
   2. The full `pnpm --dir "<wt>" e2e` (chromium + throttled). A chromium failure makes the throttled project "not run". 23 specs were checked already; the others don't touch the header past "Series".
   3. `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (needs the fresh build). The walk measures every `.z-button` in the header: the icon buttons must stay inside the safe area on Chromium 53/68.
   4. `e2e:media` isn't needed: no media code changed.
3. **Docs** (one commit):
   - architecture.md "Built in step 28b1" from the draft;
   - RELAY.md 28b1 "**Done in legs 78–79**" (as 28a's "Done in legs 76–77"; tick it after the merge).
4. **PR:**
   - title `feat: Home, and the header's icons (RELAY 28b1)`;
   - name the three riskiest changes first:
     - the header's indices shifted (Search 3 → 4, Settings 4 → 5; seven e2e specs walk it);
     - `Button` gained `iconOnly` in `packages/ui`;
     - a new screen on the live navigator, refreshed from `onCatalog`;
   - merge on green CI (merge commit, keep the branch).
5. **After the merge:**
   - fetch, then `git -C "<wt>" merge --ff-only origin/main`;
   - a docs PR recording the merge (as #87: tick 28b1, the progress row), merge it, push.
6. **Then 28b2** (the channels watched last, a profile version bump to 7) if the leg is still light; otherwise hand over.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `b1e30bb` docs: leg 78's progress-log row;
  - `2082f90` test(home): close the mutation run's three gaps;
  - `f689fb8` test(home): a test for each guard;
  - `94c0181` refactor(home): guards that could never fail taken out;
  - `dbeb44d` test(home): e2e;
  - `fc22318` feat(home): Home from the live header;
  - `31eef00` feat(ui): the icon-only Button;
  - `91d3581` (leg 77's handover);
  - `59ae89a`;
  - `de402d5` = main.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `dist/` is leg 77's build: stale, so rebuild;
  - `artifacts/`:
    - `mutate28b1*.py` and their logs (`mutate28b1.log`, `-b.log`, `-e2e.log`);
    - `unit-28b1.log` (4,708);
    - `e2e-28b1-shifted.log` (23/23);
    - `arch-28b1-draft.md`;
  - screenshots `artifacts/screenshots/home-*` and `live-en-XA.png`.
- **Docker Desktop:** images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`.
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 78:**
- **`LiveScreen` destructures `live.home` (the live screen itself),** so Home's prop inside it is named `shelves` (`LiveApp`'s own prop stays `home`).
- **Home's screen id is `home` and its zones `continue`, `movies`, `series`, `retry`** (`RemoteDriver` paths `home/movies/0`). Test ids:
  - `home-screen`, `home-shelf-<id>`, `home-<id>` (the list), `home-<id>-<i>` (tiles);
  - `live-home`;
  - the icons keep `live-search` and `live-settings` (check `aria-label`, not text).
- **A held fake-engine read exists only after the profile's `await` resolved:** `await flush()` before resolving `held.recent` or `held.keys`.
- **`useZone` is no real hook (signal reads):** Home's screen is unit-tested by calling `HomeScreen(...)` as a function and calling a `VirtualList`'s `renderItem` prop by hand (`home-screen.test.ts`).
- **Writing the mutant list first pays off:**
  - it took out guards that could never fail;
  - it showed tests a default fixture can't exercise. The posters' hold needs more posters than six downloads; a failed poster needs an empty queue to change the count.
- **Unit mutants take about 7 s each** (158 took about 18 minutes); **e2e mutants about 20 s.** A `Monitor` on `tail -n +1 -f <log> | grep -E --line-buffered "SURVIVED|EXIT|/N"` reports survivors as they come.
- **Long Bash heredocs with a Python patch failed again** ("unexpected EOF"). Write the patch with the Write tool, then `python -I <file>`.
- **The relay's context check fired at about 450k tokens,** after building 28b1 with its tests and both mutation runs. Plan a step's verification, PR and merge as the next leg's work when a step has a big mutation run.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3` and reaches vitest workers, Playwright's dev server, and Python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
- **The header is checked in en-XA only by `live.spec.ts`'s pseudo-locale test.** Six buttons fit (two are 56 px icons); a seventh needs another change.
- **A failure in the `chromium` project makes `throttled` "not run".**
- **`RemoteDriver.expectFocus` doesn't see which button is drawn focused:** check the button's own `data-state="focused"`.
- **The CDP CPU throttle does not slow dedicated workers:** time worker RPCs and scale them (`search-throttled.spec.ts`'s `recordRpc`).
- **Back from a player over another screen calls `live.focusRow`.** It keeps the live screen's zone while another screen is on top (`keepZone`).
- **In e2e, wait for an answer before the keyboard's OK** (`searchFor` waits for `data-answered`, `data-count` and `settled`).
- **A show's details: Back from `show/episodes/0` goes to `show/seasons/0` first**, then out.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch; write with `newline=''`.
- **Inserting a header button or a rail entry shifts every index** in the e2e specs, the throttled specs and the old-engine walk. Grep `live/header/`, `movies/rail/`, `series/rail/`, `data-category` and `tools/engines` first.
- **No `Array.prototype.sort` in the TV main bundle** (Babel adds core-js's `es.array.sort`; the 219 gate). Copy `newestFirst` from `movie-progress.ts`.
- **`Screen.focus`/`update` notify only when the position changes;** `focus()` into an empty zone notifies with index -1.
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text.**
- **The profile's tests use "this version + 1" as a newer version.** Bump those (and e2e `v:` pins) on every profile version (28b2: 6 → 7).
- **vitest `toEqual` ignores `undefined` properties;** use `toStrictEqual` to pin a field's absence.
- **To end a VOD stream in a regular e2e:** hold its request, then `page.locator('#stage video').dispatchEvent('ended')`.
- **A screen's root needs `data-screen`, `data-zone`, `data-index`** for `RemoteDriver.expectFocus`.
- **A spec's `page.route('**/series/**')` holds the dev server's modules from an app folder `/src/series/`** (`/src/home/` is safe).
- **Every formatted number comes wrapped in marks in e2e text:** strip `MARKS`. ar-SA shows Western digits in e2e and unit texts.
- **Hiding the app in e2e:** `setHidden(page, true)`. **One e2e:media test alone:** `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/player-media.spec.ts -g "…"`.
- **A wait loop with `pgrep -f <word>` matches its own command line.** Wait on a log marker.
- **The Write tool turns `\u200e…` in a regex literal into raw characters.** Use `String.fromCharCode`.
- **A hidden app's `<video>` is empty.** **An e2e key can beat an async read:** wait for a settled attribute.
- **The app imports only types from `@lablo/data`** (values only through `@lablo/data/client`).
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters).
- **`python -I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **Chromium 68's V8 ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop.
- **Right after `gh pr create`, checks may not be listed yet:** treat "no checks reported" as pending. `gh run rerun --failed` refuses an in-progress run.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop (`gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`).
- **The CI media flake** (`test/epg-declared-300mb.media.test.ts` budgets): rerun the failed job once the whole run completes. If "Install ffmpeg" hangs: `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **The i18n runtime isolates every message argument.**
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`);
  - the poly count: `python -I -u artifacts/poly-count20c2a.py "<wt>"`.
- **TV bundle polyfills:** none of these in TV files:
  - `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `.sort(`, `Array.from`;
  - iterator calls, array destructuring, array spread (object destructuring and spread are fine);
  - a member named `at`, which pulls `Array/String.at` in.

  The build can crash once (0xC0000005): run it again.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **Local `pnpm verify` may die at the unit stage** (low memory): run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **The mock:**
  - its panel zone is UTC by default; its synthetic media never plays;
  - movies 201–206: Big Buck Bunny 201 is first in "Recently added";
  - shows: "Recently updated" lists 302 («مسلسل الاختبار») first, then 301 ("Lablo Test Series");
  - the mock serves no posters, so tiles show their titles.
- **Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going.** Don't run the unit and e2e mutation scripts at the same time.
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
  - CI runs on `pull_request` and `workflow_dispatch` only, path-filtered;
  - commits use the no-reply email; no secrets, no LG binaries, no personal data;
  - README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified (leg 78), locally:**
  - lint, typecheck, unit 4,708;
  - e2e `home.spec.ts` 2/2 and the 8 shifted specs 23/23 (chromium);
  - mutation 155/158 plus the gaps closed (6/6), and 23/23 e2e;
  - screenshots `home-new-*`, `home-continue-*`, `home-series-*`, `home-header-*`, `live-en-XA` looked at.
- **Not done:** `build:tv` and the poly count, the full `pnpm e2e`, `verify:engines`, architecture.md, PR, CI, merge; any of 28b2; any TV run.
- **Migrations and deploys:** N/A (no backend until step 29). The profile stays at version 6. Nothing is deployed.

## Open decisions and gates
- **None for 28b1.** Leg 78's own calls (not gates):
  - the shelves' titles name their kind on Home ("Recently added movies", «أفلام أضيفت حديثًا»);
  - two shelves in view, moving as little as they can;
  - Back closes Home from any shelf;
  - a catalog swap on an empty Home reads from the loading screen.
- **28b2:** how a recent-channel tile finds the channel's place is decided while building it.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, the player. Catch-up, the movies and series grids, "Continue watching", the details, playing, resuming, episodes, auto-next, the search and Home can join that visit (including whether the TV keyboards type into the search field).
- **For step 41 (the 2018 Samsung):** the decoded memory of real posters (in a grid and on Home's shelves); whether the low tier keeps posters in lists; the search's real time on the TV.
- **For step 38 (parental):** "Recently added", "Recently updated", "Continue watching", the search results **and Home's shelves** hold adult items too: the lock must filter them.
- **Later (unchanged from leg 77's list):**
  - search and Home: a kind filter in the search; posters in the search rows; Home and the search on the old-engine walk;
  - movies and shows: a show finished to its last episode coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start" for an episode;
  - player: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents; webOS's PRE-CH; pre-buffered zapping;
  - guide: a day jump; a Guide or Info key;
  - input and accessibility: an on-screen keyboard if the TV keyboards fail;
  - settings and old engines: step 38's settings rows; drop Chromium 53 (ADR-012);
  - low tier: a memory signal for the tier;
  - CI: the media flake's budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 28b1 (Omar; valid once 28b1 is merged)
1. **Start:** `pnpm dev` with the mock's Xtream source. UP to the header: "Guide · Movies · Series · Home", then a magnifier and a gear. RIGHT to each: the icons draw their focus ring like the text buttons.
2. **Home with nothing played:** on "Home", OK.
   - You see "Home" and the clock, then "Recently added movies" (Big Buck Bunny first, 6 tiles) and "Recently updated series" («مسلسل الاختبار», "Lablo Test Series").
   - The focus is on Big Buck Bunny.
3. **Play from Home:** OK (the details), OK on "Play", RIGHT four times (0:40), Back, Back.
   - You are on Home, still on Big Buck Bunny in "Recently added movies".
   - "Continue watching" is now above it, with Big Buck Bunny and a short bar.
4. **Resume:** UP to the tile in "Continue watching", OK: the details on "Resume from 0:40". Back: the same tile.
5. **Shows:** DOWN, DOWN: the shelves move up one, to "Recently updated series". RIGHT, OK: "Lablo Test Series"'s details. Back, Back: the same tile.
6. **Out:** Back: the header, on "Home". DOWN: the channel list.
7. **In Arabic** (`?locale=ar-SA`):
   - «الرئيسية» after «المسلسلات», the gear at the far left;
   - the shelves start on the right («أفلام أضيفت حديثًا», «مسلسلات حُدّثت مؤخرًا»).
8. **Pseudo-locale** (`?locale=en-XA`): all six header buttons inside the screen's safe edge.

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
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
