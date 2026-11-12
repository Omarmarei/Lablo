# Lablo IPTV: relay leg 77 opening prompt

You are leg 77 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–75 did steps 1–27d (PRs #1–#85), except step 16's Samsung part, 19b and 21 (they wait for Omar).
- **Leg 76** (stopped by the relay's context check, mid-step):
  - **Split step 28** in RELAY.md into **28a (search)** and **28b (Home)**, with "Already built" and "Decided in leg 76" (commit `f4d8bdf`).
  - **Built and tested 28a, the search screen** (commits `c6bd25c` feat, `8c31167` test, `cc22a7d` progress row). **Not yet merged, no PR yet.** What is left of 28a is listed under "Next steps".
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:** step 28's "Already built", "Decided in leg 76" and the 28a / 28b entries (Done-when), and leg 76's progress-log row. Step 26's common items still apply (unit tests; e2e by keys in English and Arabic, screenshots looked at; a mutation run with the mutant list written first; `pnpm verify` parts green; main within budget with 219 core-js modules on both platforms; the PR merged; a "press these keys" checklist in the handover).
2. **The 28a code** (all new or changed in leg 76):
   - `apps/tv/src/search/search-state.ts` (`createSearch`: zones `field` and `results`, `SEARCH` sizes, a search per change, pages of 20 read around the window, `catalogChanged`, `dispose`), `SearchScreen.tsx` (`kindText`, `groupText`, `searchHint`, `countText`, `SearchRow`), `search.css`;
   - `apps/tv/src/live/live-state.ts`: `HEADER_SEARCH = 3`, `HEADER_SETTINGS = 4`, header count 5, `openSearch`, `FoundChannel`, `playFound`, `keepZone`, `focusRow`;
   - `apps/tv/src/data/engine.ts`: `find(req, cancel?)` and `items(refs)`;
   - `apps/tv/src/live/LiveApp.tsx` (the header's "Search" button, the screen branch), `apps/tv/src/main.tsx` (`createSearch`, its `select`: live → `live.playFound`, movie → `details.open`, series → `selectSeries`; `search.catalogChanged` in the refresh scheduler's `onCatalog`);
   - catalogs `search.*` in `apps/tv/src/i18n/en.ts` and `ar.ts`;
   - tests: `apps/tv/src/search/search-state.test.ts` (18), `search-screen.test.ts` (8), `apps/tv/src/live/live-state.test.ts` (78, the header and "a channel the search found"), `test/tv-data-engine.test.ts` (15, `find`/`items`), `e2e/search.spec.ts`, `e2e/search-throttled.spec.ts`, `e2e/big-catalog.ts` (series added).
3. **`docs/architecture.md`:** §1.2's "Built in step …" sections (add "Built in step 28a" there), §1.4 steps 8 and 11 (the search index).
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` (clean), `git -C "<wt>" log --oneline -6` (see "Git state to expect").
2. **Finish 28a:**
   1. **The mutation run, list written first:** `artifacts/mutate28a.py` in the format of `artifacts/mutate27d.py` (CRLF-safe, `--check`, one snippet). Files and their tests: `search-state.ts` → `search-state.test.ts`; `SearchScreen.tsx` → `search-screen.test.ts`; `live-state.ts` → `live-state.test.ts`; `engine.ts` → `test/tv-data-engine.test.ts`. Leg 76 already went through search-state's guards and took out the ones that could never fail (see "Done in leg 76" below); each kept guard has a test. Leave out on purpose: `editor.dispose()`/`textEditor.dispose()`, and `find`'s branch that passes `{ cancel: undefined }` (equivalent). Then a short e2e list (`artifacts/mutate28a-e2e.py`, running `e2e/search.spec.ts`): `main.tsx`'s `select` dispatch (each kind), LiveApp's search branch and header button, a catalog string.
   2. **Re-run `e2e/search.spec.ts`:** `playFound` changed after its last run (leg 76's last edit; the unit tests are green).
   3. **Verify:** lint, typecheck, the whole `pnpm test`, `pnpm build:tv` then `python -I -u artifacts/poly-count20c2a.py "<wt>"` (219 core-js modules on both; note main's size against leg 75's 397.1 KB Tizen / 384.4 KB webOS), the full `pnpm e2e` (chromium + throttled), and `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (the header now has five buttons: check the walk's layout checks still pass). `e2e:media` is optional (no media code changed).
   4. **Docs:** architecture.md §1.2 "Built in step 28a"; RELAY.md 28a: "Done in leg 77" (tests, mutation, sizes, verify), then tick 28a. Also **tick step 24** (its sub-steps 24a–24e are all done; the parent line was never ticked).
   5. **PR, CI, merge:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Then fetch, `git -C "<wt>" merge --ff-only origin/main`, a docs PR recording the merge (as #85), push the branch.
3. **Then stop as needs-you for 28b** (do not build Home without his answer). Ask Omar, as a numbered list he can answer with one character:
   1. **(Recommended) Home is a header entry; the app keeps opening on the live screen** (or the last channel playing over it), as IPTV viewers expect TV first. Home shows "Continue watching" (movies and shows), "Recently added" movies, "Recently updated" series and the channels watched last. Cost: one more header button, so every spec index after it shifts once more.
   2. **Home is the start screen:** the app opens on Home; Back on the live screen goes to Home; on webOS, Back on Home leaves the app (Home is the entry page). Last-channel start would then need its own setting (PLAN lists "option to start on the last channel"). Cost: most e2e specs and the old-engine walk start one screen further.
   3. Something else (he types it).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `cc22a7d` docs: leg 76's progress-log row;
  - `8c31167` test(search): e2e en/ar, 200k throttled run, shifted specs, guards trimmed;
  - `c6bd25c` feat(search): the search screen from the live header;
  - `f4d8bdf` docs: split step 28 into 28a and 28b;
  - `9809ce9` leg 75's handover; `45bc682` Merge PR #85.
- **main** is `45bc682`. The tree is clean. **No PR is open.**
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links), `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `dist/` is **stale** (leg 75's 27d build): run `pnpm build:tv` before the poly count and the engines;
  - `artifacts/`: `e2e-28a-shifted.log`, `e2e-28a-throttled.log`, `lint-28a.log`, `typecheck-28a.log`, `perf/search-throttled.json`; screenshots `search-*` (header, empty, results, Arabic, none; en-US and ar-SA, all looked at).
- **Docker Desktop:** images `lablo-old-engines:ba502212364a` and `lablo-webos-sim:local`; no `lablo-chrome*` container left.
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## Done in leg 76 (for the RELAY.md "Done" entry)
- **The header:** Guide 0, Movies 1, Series 2, **Search 3**, Settings 4. Five specs press once more to reach "Settings" (`guide-catchup-m3u`, `guide-mapping`, `guide-matches`, `guide-offset`, `guides`); `series.spec.ts` counts five buttons. All 18 of their tests passed.
- **The screen** (`search`): the header with "{n} results" (or "The best 200 of 5,432" when cut), the field "Channels, movies and series" (OK opens the TV's keyboard; its hint "Part of a name, in any language"; "Nothing has these words." for none; "Couldn't search your sources." on failure), the rows: the name (provider text, `dir=auto`, `translate=false`) over "Channel/Movie/Series/Episode · group" (a nameless group: "Other channels/movies/series"). Arabic: «البحث», «قناة», «فيلم», «مسلسل», «حلقة».
- **The behaviour:** a search per change of the text over the profile's sources (`find`, at most 200 hits), the one before cancelled; the last rows stay until the new answer; spaces search nothing; pages of 20 items read for the window and one window either side; OK on a row whose item is read calls `select`; Back: results → field → closed (the header's "Search"); a catalog swap searches again keeping the focus's row (an empty answer moves the focus to the field).
- **Playing a channel from the search** (`Live.playFound`): its category's rail entry is shown (the first entry with its source and category index, "All channels" skipped), its row found from the hit's place (the category read on for an older generation's hit), focused and played. **Under another screen, the live screen keeps its active zone** (`keepZone`): Back from the player calls `focusRow`, which used to make the list active, so Back from the search landed on the list. Now it lands on "Search", and DOWN goes to the played channel. On top (the guide's or the list's player), `focusRow` still moves the focus to the row.
- **Guards taken out in leg 76** (writing the mutant list): search-state's open counter (the search counter covers it), `track`'s try/catch, every `running = null`, `asking` resets that the next answer makes, `clear`'s `reset`, the `drawn` bumps in `take`/`clear`, `choose`'s hit check, `close`'s `textEditor.close()` and resets; `playFound`'s status/disposed check (`findRow` returns -1 then). Tests added for every kept one.
- **The throttled run** (`e2e/search-throttled.spec.ts`): 200,000 items (30,000 channels, 150,000 movies, 20,000 series), 40 changes typed (Latin, Arabic, Backspaces) at 4x. The CDP throttle does not slow workers, so the spec times the worker's `search`/`items` calls and checks 300 ms on `drawn + 3 × worker` too. Local: drawn median 29 ms, max 63 ms; estimate median 69 ms, max 163 ms; no long task; page 5.9x slower, worker 0.5–1x. About 50 s with the ingest.

## Gotchas and lessons
**New in leg 76:**
- **The CDP CPU throttle does not slow dedicated workers** (memory `iptv-throttled-e2e`). Time worker RPCs and scale them, as `search-throttled.spec.ts`'s `recordRpc` does.
- **Back from a player over another screen calls `live.focusRow`.** It now keeps the live screen's zone while another screen is on top (`keepZone`).
- **In e2e, wait for the answer before the keyboard's OK:** the field's `done` moves DOWN only into a list that has rows. `searchFor` waits for `data-answered`, `data-count` and `settled` first. `Control+A`, `Backspace` clears the field. `keyboard.insertText` fires only `input`.
- **A show's details: Back from `show/episodes/0` goes to `show/seasons/0` first**, then out.
- **`e2e/big-catalog.ts` is CRLF in this working copy.** Patch scripts read with `.replace(chr(13)+chr(10), chr(10))`.
- **Bash heredocs mangled scripts twice more:** backticks broke a match, and `'\\r\\n'` became raw CR/LF bytes. Write scripts with the Write tool, then `python -I`.
- **The relay's context check came at about 455k tokens** after the build and tests of one sub-step: leave the mutation run and the PR to a fresh leg when a sub-step has this many parts.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on). Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. It loads `@rollup/wasm-node@4.67.3` and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`. Never delete files in `node_modules`. If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **Inserting a header button or a rail entry shifts every index** in the e2e specs, the throttled specs and the old-engine walk. Grep `live/header/`, `movies/rail/`, `series/rail/`, `data-category` and `tools/engines` first.
- **No `Array.prototype.sort` in the TV main bundle** (Babel adds core-js's `es.array.sort`; the 219 gate). Copy `newestFirst` from `movie-progress.ts`. `.concat`, `.slice`, `.splice`, `.find`, `.map`, `.forEach` are already in.
- **`Screen.focus`/`update` notify listeners only when the position changes;** `focus(zone, -1)` clamps to 0.
- **`test/engines-onboarding.test.ts` pins `MoviesScreen.tsx`'s source text.**
- **The profile's tests use "this version + 1" as a newer version.** Bump those (and e2e `v:` pins) on every profile version.
- **Adding a field to a signal's value object breaks `toEqual` pins on it.** vitest `toEqual` ignores `undefined` properties; use `toStrictEqual` to pin a field's absence.
- **To end a VOD stream in a regular e2e:** hold its request, then `page.locator('#stage video').dispatchEvent('ended')`.
- **`RemoteDriver.expectFocus` reads the screen root's `data-*`;** a new screen's root needs `data-screen`, `data-zone`, `data-index`.
- **A spec's `page.route('**/series/**')` holds the dev server's modules from an app folder `/src/series/`.** Never name an app folder like a mock URL segment (`/src/search/` is safe: no mock path has it).
- **Every formatted number comes wrapped in marks in e2e text.** Strip `MARKS`. ar-SA shows Western digits in e2e and unit texts.
- **Hiding the app in e2e:** `setHidden(page, true)`. **One e2e:media test alone:** `LABLO_E2E_MEDIA=1 pnpm --dir "<wt>" exec playwright test --project=playback-media e2e/player-media.spec.ts -g "…"`.
- **A wait loop with `pgrep -f <word>` matches its own command line.** Wait on a log marker.
- **The Write tool turns `\u200e…` in a regex literal into raw characters.** Use `String.fromCharCode`.
- **Some working copies are CRLF while git stores LF.** Run `git ls-files --eol -- <files>` before scripting a patch. Python on Windows: `open(p, 'w', encoding='utf-8', newline='')`.
- **A hidden app's `<video>` is empty** (`Html5Engine.suspend`). **An e2e key can beat an async read:** wait for a settled attribute.
- **The app imports only types from `@lablo/data`** (values through `@lablo/data/client` only: `CancelSource` is there).
- **A grep for a word misses its other spellings** (`\u` escapes, full-width letters). **Text length is load-bearing in tests.**
- **`python -I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **Chromium 68's V8 ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop.
- **Right after `gh pr create`, checks may not be listed yet:** treat "no checks reported" as pending. `gh run rerun --failed` refuses an in-progress run.
- **GitHub billing can refuse every Actions job:** a needs-you stop (`gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`).
- **The CI media flake** (`test/epg-declared-300mb.media.test.ts` budgets): rerun the failed job once the whole run completes. "Install ffmpeg" can hang: `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **The i18n runtime isolates every message argument.** A compound like "7.5/10" must be one argument.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **Commands:** one e2e spec `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`; the media e2e `pnpm --dir "<wt>" e2e:media`; one throttled spec `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`; engines `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 8 min, needs a fresh `pnpm build:tv`); the poly count `python -I -u artifacts/poly-count20c2a.py "<wt>"`.
- **TV bundle polyfills:** no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `.sort(`, `Array.from`, iterator calls, array destructuring or array spread in TV files (object destructuring and spread are fine); a member named `at` pulls `Array/String.at` in; the build can crash once (0xC0000005): run it again.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **Local `pnpm verify` may die at the unit stage** (low memory): run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **The mock:** its panel zone is UTC by default; its synthetic media never plays; movies 201–206 (Big Buck Bunny 201 first in "Recently added", Sintel 202), shows 301 ("Lablo Test Series") and 302 («مسلسل الاختبار»); live 101–112 ("Lablo Test FR - Mire" is 110, row 2 of "Test News"). "lablo test" finds 10 (8 channels, movie 205, show 301).
- **Never edit source while a mutation run, `pnpm e2e`, `e2e:media`, a build or the engines run is going.** Don't run the unit and e2e mutation scripts at the same time.
- **Code rules:** `packages/ui` components stay hook-free; UI text only from the catalogs (ar.ts has no comments); provider text uses `dir=auto` + `translate=false`; physical CSS only, no CSS Grid or flex `gap`; TV code is ES2017; dependencies at least 2 weeks old; never weaken lint; scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` and `Claude-Session` lines.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request` and `workflow_dispatch` only, path-filtered (docs alone run none); commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo" and the About box "Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally (leg 76):** typecheck and lint (whole workspace); unit: `apps/tv/src/search` 26, `live-state.test.ts` 78, `test/tv-data-engine.test.ts` 15; e2e `search.spec.ts` en-US and ar-SA 2/2 (before leg 76's last `playFound` edit); the five shifted specs and `series.spec.ts` 18/18; `search-throttled.spec.ts` 1/1.
- **Not done:** the mutation runs; the whole `pnpm test`; `pnpm build:tv`, the poly count and sizes; the full `pnpm e2e`; `verify:engines`; any CI; any TV.
- **Migrations and deploys:** N/A (no backend until step 29). The profile stays at version 6. Nothing is deployed.

## Open decisions and gates
- **28b's place (Home):** Omar's answer needed (see step 3 of "Next steps"); leg 76's recommendation is option 1.
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the used 2018 set), and about 30–45 minutes at the LG TV (S10, S11, S5's suspend and soak, the player; catch-up, the movies and series grids, "Continue watching", the details, playing, resuming, episodes, auto-next and now the search can join that visit, including whether the TV keyboards type into the search field).
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, whether the low tier keeps posters in lists, the memory of 20 kept shows' answers, and the search's real time on the TV (the 300 ms budget is estimated in e2e).
- **For step 38 (parental):** "Recently added", "Recently updated", "Continue watching" **and the search results** hold every category's items, adult ones included: the lock must filter them too.
- **Later (unchanged, plus leg 76's):** a kind filter in the search, if users ask (a query matching many channels can push movies past 200); posters or logos in the search rows; a show finished to its last episode coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start" for an episode; an episode's image in its row; the show's details, the series screen, "Continue watching" and the search on the old-engine walk; group a playlist's episodes into shows; a CSS seed for the poster grid; fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents; a day jump in the guide; an on-screen keyboard if the TV keyboards fail; webOS's PRE-CH; the accessibility route; pre-buffered zapping; the last frame kept while reconnecting; step 38's settings rows; subtitle parsing off the main thread; a Guide or Info key; drop Chromium 53 (ADR-012); a memory signal for the tier; holding refreshes while a low-tier TV plays; the catalogs as UTF-8; a "loading" look for unread rows; the details, settings and picker on the old-engine walk; a screen for a guide's own zone; `SourceMemory` for catch-up; a walk at a second hour; a resume place re-matched when a provider renumbers a movie; the CI media flake's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 28a (Omar)
1. **Start:** `pnpm dev` with the mock's Xtream source. UP to the header: "Guide · Movies · Series · Search · Settings". RIGHT three times to "Search", OK.
2. **The screen:** "Search" with the field "Channels, movies and series" focused and the line "Part of a name, in any language".
3. **Type:** OK, type `lablo test`, OK (the keyboard's done). "10 results"; the focus on the first row, "Lablo Test 1 SMPTE / Channel · Test News"; DOWN to the end: the 8 channels, then "Lablo Test Pattern 4K HEVC / Movie", then "Lablo Test Series / Series".
4. **Play a channel:** UP to "Lablo Test FR - Mire", OK: the player opens on it. Back: the search, on the same row.
5. **Arabic:** Back (to the field), OK, replace the text with `اختبار`, OK: three rows, the movie «اختبار الصوت المتعدد» first, then the channel and the show. DOWN twice, OK: the show's details. Back, Back: the search on the show.
6. **A movie:** Back, OK, replace the text with `sintel`, OK, OK: Sintel's details. Back.
7. **Nothing:** Back, OK, type `zzzz`, OK: "0 results" and "Nothing has these words."; the focus stays on the field.
8. **Out:** Back: the live header on "Search". DOWN: the list shows "Test News" with "Lablo Test FR - Mire" focused.
9. **In Arabic** (`?locale=ar-SA`): «البحث» in the header between «المسلسلات» and «الإعدادات»; the screen on the right; rows read right to left («قناة · Test News»).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-three CLAUDE.md gaps** are waiting for his word: 1–28 as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders"); 29: the `pnpm dev` row should name the live header's "Guide"; 30: the `pnpm verify:engines` row's self-test description; 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid"; 32: the commands table could add the one-engine and one-throttled-spec commands; 33: its "Repo: private `Omarmarei/Lablo`" line (public since 2026-11-05). A 34th to add: the header is now Guide, Movies, Series, Search, Settings.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
