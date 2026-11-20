# Lablo IPTV: relay leg 123 opening prompt

You are leg 123 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–121 did steps 1–33, 35a and 35b (PRs #1–#151).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.
- **Leg 122 (2026-11-20) built step 35c and ran part of its gates.** It stopped at the relay's context check, before the PR.
  - **35c: the favourites lists in the live screen.** One commit, `3bf606e`, on the branch and pushed. **No PR yet.**
  - **The refinements** (seven, each with its why) are in RELAY.md under the 35c line (~2643):
    1. a list's rows are read by key;
    2. a list numbers its channels by their place in the stored list, so a missing channel leaves a gap;
    3. "All channels" follows the rail's order, and each part carries `first`;
    4. `LastChannel.list`, an optional field;
    5. the star is the info bar's last button;
    6. the panel, whose first row makes "Favourites" in one press;
    7. a search hit or a recent channel in a hidden group is left for 35d.
  - **What it built** (RELAY's "Built in leg 122" lists every file):
    - `channel-index.ts`: `ListPart.first`, `place`, `rowOfPlace`.
    - `live-state.ts`:
      - `RailShape` and `railEntries(sources, shape?)`;
      - `RailRef` with `{list}`, and `findEntry` for it;
      - the list on show read by key (`readKeys`, `KEY_BATCH` = 100);
      - `rowCount`, `setList`;
      - `lists`, a signal;
      - `listsChanged()` (`reread(false)`, which keeps the chunks).
    - `player-memory.ts`: `railRefOf` and `LastChannel.list`. The field's type is in `packages/data/src/profile.ts`.
    - `favourite-menu.ts` and `FavouritePanel.tsx`.
    - `player-state.ts`: `'favourite'` is last in `CHANNEL_ACTIONS` (`ACTIONS` 5, `FAVOURITE_ACTION` 4), with the `favourites` host option.
    - `PlayerScreen.tsx`:
      - the star;
      - the panel and its form;
      - the attributes `data-favourite`, `data-favourites` and `data-editing`.
    - `packages/ui`: `TextField` takes `maxLength`.
    - Seven catalog keys (`player.favourites`, `favourites.*`).
    - `main.tsx`: the wiring.
    - `e2e/favourites.spec.ts`.

## Read first
1. **`RELAY.md`:**
   - step 35's block (~2542): the shape;
   - the 35c refinements, "Built in leg 122", "Verified in leg 122 so far" and "Left for leg 123" (~2643);
   - the 35d line;
   - the progress row of leg 122 (the last line).
2. **The code above.** Start with `apps/tv/src/live/live-state.ts` (`readKeys`, `findRow`, `reread`) and `apps/tv/src/player/favourite-menu.ts`.
3. **`docs/architecture.md`:**
   - §1.4 item 10 "Built in step 35a" (~848): 35c's docs go after it;
   - the live screen's and the player's sections.
4. **`CLAUDE.md`:**
   - "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails";
   - CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -6` shows leg 122's `docs:` handover commits on top, then `3bf606e` (35c), then `6235456`;
   - `origin/main` is still `a0739ef`;
   - no `*.mutbak`: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **Run `verify:engines --engine chrome53 --engine chrome68` again, the whole command.** Run it in the background, about 30 minutes, after a fresh `pnpm build:tv`.
   - Leg 122 ran it twice:
     - the first died on the known Chromium 53 DevTools start-up timeout, before any run;
     - Claude Code stopped the second for low memory, about two thirds through.
   - By then **18 runs had passed and none had failed** (Chromium 53 and part of 68; see `artifacts/engines-35c.log`).
   - Leg 122 removed its leftover container.
   - Close other memory users first. If it is stopped again, don't restart it in a loop: report it.
3. **Finish 35c's mutation run:** `python -X utf8 -I -u artifacts/mutate35c.py --from 45 --to 92`, then `--from 93`.
   - Run in foreground chunks under 9 minutes each.
   - The list has 109 mutants, written first. 0–45 are done: five gaps were closed with tests, and one equivalent mutant was dropped (the reason is in the docstring).
   - The last eight are e2e mutants (`favourites.spec.ts`, about 20 s each with Vite).
   - After the last one, `pnpm build:tv` again for a clean `dist`.
4. **Run the e2e specs the change touches**, in foreground chunks: `pnpm exec playwright test e2e/player.spec.ts e2e/live.spec.ts e2e/resume.spec.ts e2e/home.spec.ts e2e/search.spec.ts e2e/refresh.spec.ts e2e/guide.spec.ts e2e/tv-bundle.spec.ts e2e/favourites.spec.ts --project=chromium`. Things to watch:
   - the info bar now has five buttons;
   - the rail has list entries after "All channels";
   - `RailRef`, `startCategory` and `playKept` take `{list}`.
5. **Write the docs:**
   - architecture.md §1.4 item 10, "Built in step 35c" (the seven refinements, the files, main.js 470.0 KB);
   - the live screen's section (the rail order, numbers by `first`, lists by key);
   - the player's section (the star, the panel).
6. **Ship it:**
   - open the PR (with `3bf606e`, this handover and the docs);
   - wait for CI. A `packages/*` change runs all four jobs, about 32 minutes, engines last;
   - merge on green with a merge commit, keeping the branch. Name the three riskiest changes first:
     1. `live-state.ts`'s list on show by key and `reread(false)`;
     2. the info bar's fifth button and the panel's screens over the player;
     3. `LastChannel.list` in the profile;
   - tick 35c, add the progress row and the merge record.
7. **Then 35d** (Settings › "Channel groups"), likely the next leg. It follows the guides screen's pattern (`apps/tv/src/settings/guides-state.ts`):
   - rows: the lists, then the groups in rail order, hidden ones marked;
   - OK opens a row's menu: Move up, Move down, Hide or Show, Rename, Delete (asking first), Channels (Move up, Move down, Remove), Cancel;
   - also 35c's leftover: a search hit or a recent channel in a hidden group plays nothing today. In 35d, play it pinned over the list on show, as the start does (`player.resume`).

**Step 26's common items still apply to any build:**
- unit tests;
- mutation with the list written first;
- lint of the whole repo, `pnpm typecheck`;
- `build:tv` sizes;
- `verify:engines` 53/68;
- `pnpm build:web` then `pnpm e2e:web` when apps/web changes;
- the PR merged on green CI;
- the docs.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. It has, in order:
  - `a0739ef`;
  - `d5eec8a` and `6235456` (leg 121's docs);
  - `3bf606e` (35c);
  - leg 122's handover commits (docs).

  All pushed. No PR is open.
- **`main`:** `a0739ef` (Merge PR #151). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: 35c's build from before the engines run;
  - in `artifacts/`:
    - `mutate35c.py` and `mutate35c-a.log` (mutants 0–45);
    - `engines-35c.log` (the stopped second run);
    - `unit-35c.log`, `lint-35c.log`, `tsc-35c.log`, `build-tv-35c.log`;
    - `e2e-35c-a.log`, `e2e-35c-b.log`;
    - the screenshots `favourites-panel-{en,ar}`, `favourites-new-{en,ar,en-XA}`, `player-star-{en,ar}`, `live-list-{en,ar,en-XA}`;
    - the older legs' files (`babel-polys30b2.ts` is the per-file core-js probe; `make_probe35.py` and `size35-main.ts` measure main.js per file).

## Verified vs not
- **Verified in leg 122:**
  - unit 7,606 (+56). `xtream-xmltv-core`'s 61-byte read timed out under load and passes alone;
  - `e2e/favourites.spec.ts` 3/3:
    - en and ar: make a named list from the star, a second channel joins it, the rail entry, numbers 1 and 2, `DIGIT_2`, CH+ wrapping;
    - en only: a refresh where every mock id moved by 1000 keeps the list, and its channel plays from the new stream id;
    - en-XA: the panel, the form, the info bar and the rail;
  - the whole repo's lint, `pnpm typecheck`;
  - `build:tv`: main.js 459.9 → **470.0 KB on Tizen (30.0 KB left)**, 457.3 KB on webOS. The core-js probe of the new files lists only modules main already has;
  - mutation 0–45;
  - the screenshots, looked at.
- **Not verified:**
  - mutation 46–108;
  - `verify:engines` 53/68: stopped part way (18 passed, none failed); run it again in full;
  - the other e2e specs (step 4);
  - CI;
  - a real TV (step 21);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 122:**
- **A list's rows:**
  - `itemsByKey` takes at most 100 keys a call (`KEY_BATCH` mirrors `KEY_ITEMS_MAX`; the query module isn't main's to import) and drops keys it can't find.
  - The live screen keeps the found items in `KeyedRows`, with each one's place in the stored list.
  - Every reader of the list on show (`rowAt`, `rowCount`, `loadRow`, `findRow`) has a keyed branch. A new reader needs one too.
- **Numbers:**
  - a row's number is `chno`, else `index.place(row) + 1`. Never `entry.allStart + row`: hidden and moved groups break that;
  - in a list, the number is its stored place plus 1 (`chno` ignored).
- **Mutation lesson:** a stale-answer guard can survive when its stale path gives the same result (a dropped read leaves no items). Kill it with a reload after the read is in.
- **Heredocs:** a quoted heredoc (`cat >> f <<'EOF'`) holding TS with an escaped apostrophe failed to parse. Write the block to a scratch file and append it with python.
- **The Chromium 53 DevTools start-up timeout happens locally too.** Rerun `verify:engines` once.
- **The favourites panel reuses the track menu's CSS classes** (`.tracks`, `.tracks__row`, `.tracks__check`) and adds `favourites__name` and `favourites__actions` in `player.css`.

**From earlier legs (still true):**
- **Before step 38 grows Settings,** measure main.js and ask Omar: load Settings on first open, or a higher budget. main.js now has 30.0 KB left, and 35d needs about 8–10 KB.
- **The developer screens are only in `pnpm dev` and `dist/tv-dev`** (35b). A dev-only module goes in `STORE_SWAPS`.
- **Main-safe `@lablo/data/client`:**
  - in main, no `trim`, `.sort(`, regex `.test` or `for…of` in new files;
  - `favourite-menu.ts` checks blank names by char code, and the worker trims.
- **Profile edits:**
  - `editProfile` answers `false` for an edit that changes nothing, goes past a cap, or names a missing list;
  - the panel shows "This list is full" for a refused add, "Couldn't make the list" for a refused new list, and nothing for a refused take-out.
- **Logins on the TV are not encrypted at rest (ADR-013).** Say "encrypted end to end whenever they leave the TV; our servers never see them".
- **Scrub in a worker, never in main.js.** Workers import schema-free subpaths.
- **Any new background worker that writes IndexedDB** must count in the hook's `backupIdle()`.
- **Arabic on/off words agree with their noun.** Preact: write `translate={false}`.
- **Overlap works:**
  - build the next step uncommitted while a PR's CI runs, then `git merge --ff-only origin/main`;
  - never push to a PR while its CI runs;
  - wait in foreground loops under ~9 minutes (`gh run view <run> -R Omarmarei/Lablo --json jobs --jq …`).
- **git:**
  - `git rev-parse --short` takes one ref per call;
  - keep absolute worktree paths and `git -C`;
  - never `-c user.email=…`;
  - `git mv` stages at once.
- **CI:**
  - there is no `jq` (use `gh --jq`);
  - known flakes, rerun after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-minute cap, Chromium 53/56 DevTools start-up.
- **TV code rules:**
  - no `.sort(` in main;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` is hook-free; UI text comes only from the catalogs.
- **Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22, this PC Node 24;
  - a bare `sleep` is blocked: use `timeout N tail -f /dev/null`;
  - `TaskStop` on `verify:engines` leaves its container behind;
  - the TV build can crash once (0xC0000005): rerun it.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34; its migration and deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **35c's and 35d's shape choices are the relay's** (with their why in RELAY). Only a choice with real trade-offs for users goes to Omar.
- **Before step 38:** ask Omar to choose between loading Settings on first open and a higher main budget.
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src`, and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (with `diag_report_no_install`) and deploy, each with his one-word OK.
- **Later fixes to propose (no step yet):**
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c).
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' report rows;
  - a telemetry send and a report from a real TV, once step 34 has an API;
  - now also the favourites star with the TV's remote and keyboard.

## Checks for Omar
1. **Optional:** in `pnpm dev`, play a channel, press RIGHT four times to the star "Favourites", then OK.
   - With no list yet, OK on "Favourites" makes the list.
   - "New list" asks for a name.
   - The rail then shows the list after "All channels", its channels numbered 1, 2, 3.
2. **Optional look:** `artifacts/screenshots/favourites-panel-en.png`, `player-star-en.png` and `live-list-ar.png` (in the worktree).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-six CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`;
  - 56: `git show 6235456:HANDOVER.md`. These are the command-table rows for `build:tv`, `e2e` and `verify:engines`, about the test copy `dist/tv-dev`.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
