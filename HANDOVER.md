# Lablo IPTV: relay leg 138 opening prompt

You are leg 138 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–136 did steps 1–33, 35, 35e, 36, 37, step 38's shape and 38a (PRs #1–#161).
- **Leg 137 (2026-11-22) built 38b and opened the joined PR #162 for 38a + 38b. Its CI was running when the leg ended; it is NOT merged.**
  - 38b's "Refined before building" (11 items) is in RELAY.md under `- [ ] 38b.`; architecture.md §1.4 item 10 has "Built in step 38b" (after "Built in step 38a").
  - Built: the rails' locks (live, movies, series; `railEntries`' `locks`, `readLocks`, `lockFocus`), the "Locked groups" / "Lock again" last entry, the PIN pad (`apps/tv/src/parental/`: `parental.ts`, `PinPad.tsx`, `icons.tsx`, `parental.css`), the re-reads after an unlock or relock (`live.lockChanged`, `movies.lockChanged`, search and Home `catalogChanged`), the relock on hide with the pad over everything and the player held on return (`heldLifecycle`; Back restarts the app with `location.reload()`, locked), the start's last channel and Home's "Recent channels" through the worker (`itemsByKey`), Settings › "Channel groups" without locked groups while locked.
  - **Q2's done-screen prompt moved to 38c** (refinement 9: it shares the pad's set mode and the login check with "Forgot your PIN?"). With no PIN, "Locked groups" shows a dialog ("Locked groups need a PIN. You can set one in Settings.", one OK); 38c turns it into its "Set a PIN" path.
  - **Behaviour change to know:** the start's last channel now plays once the query worker gives it (about when the list's categories are read), no longer before them. `resume.spec.ts`' order check went. A light lock check in the query worker could win it back, but the worker has 1.7 KB left (148.3/150).
- **Your step:** get PR #162 merged on green CI, tick 38a and 38b, then start **38c** (Settings › "Parental control").
- **Waiting for Omar:** step 16's Samsung part, 19b and 21 (the TVs); step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:** step 38's "Shape" (Omar's Q1–Q3, option 1 each) and "Split" (38c, 38d); `- [ ] 38a.` (its notes and "Leads for 38b" lead 3 about `checkPin`); `- [ ] 38b.` (its refinements, especially 3, 5, 9, 10); the last progress row (137).
2. **docs/architecture.md** §1.4 item 10: "Built in step 38a" and "Built in step 38b" (~954–975); "Built in step 36c" (the settings screens, the channel menu) for 38c's pages.
3. **The code for 38c:** `apps/tv/src/parental/parental.ts` (the pad has only an "enter" mode: 38c adds "set" = typed twice; `toggle`'s no-PIN branch `openNoPin`); `apps/tv/src/settings/settings-state.ts` (`SETTINGS_ITEMS`, `SETTINGS_SCREENS`), `settings/channel-edit.ts` (the channel menu: "Lock"/"Unlock"), `settings/source-login.ts` and `onboarding/form.ts` (a login typed again, for Q3's check); `packages/data/src/parental.ts` (the `parental` edit's ops: `pin`, `adult`, `group`), `query-service.ts` (`unlock`, `setPin`, `lockState`); `apps/tv/src/onboarding/OnboardingApp.tsx` and the pairing done view (Q2's prompt).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean; `git -C "<wt>" log --oneline -3` shows this handover's commit, then `78e0256` (38b docs), `be40c56`.
   - `gh pr view 162 --repo Omarmarei/Lablo --json state,mergeable` and `gh pr checks 162 --repo Omarmarei/Lablo` (names: changes, web, media, verify, engines). No `*.mutbak`; `docker ps` shows only `lablo-web-postgres-1`.
2. **CI of PR #162:**
   - All green: merge it (merge commit, keep the branch; IPTV PRs merge on green CI without Omar). Name the three riskiest changes in the leg's notes (they are in the PR body: `INGEST_VERSION` 4 rebuilds every stored catalog once; the 18+ group out of sight by default and the start's resume after the worker's check; the relock on hide with the held player and Back's reload).
   - A known flake (list below): `gh run rerun <run> --failed` once the whole run is done.
   - A real failure: read the job log (`gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`) or the playwright report (`gh run download <run> -n playwright-report -D <dir>`), fix on the branch, push (a push cancels the running CI).
   - After the merge: `git -C "<wt>" fetch origin`, `git -C "<wt>" merge --ff-only origin/main` (the merge commit), then tick `- [x] 38a.` and `- [x] 38b.` in RELAY.md with "merged in PR #162 as `<sha>`", a progress row, commit (docs) and push.
3. **38c: write its "Refined before building" first** in RELAY.md, checked against the code: the page behind the PIN (Settings › "Parental control" asks every time, even unlocked: a worker `checkPin` of ~0.2 KB, or `unlock` then `relock` when the session was locked; the query worker has 1.7 KB); "Change the PIN"/"Set a PIN" (the pad's set mode: typed twice); "Lock adult groups" (`parental` edit `adult`); "Locked groups" (every group of each kind with its lock, the adult ones marked: `categories` marks them); the channel menu's "Lock"/"Unlock" (locking needs no PIN, unlocking asks it); "Forgot your PIN?" and "Set a PIN" with no PIN (Q2, Q3: one source's login typed again or sent from the phone, compared in main with the profile's plain logins); the done screens' prompt (Q2: onboarding and Settings' add from the phone, when the new source has adult groups: `lockState().kinds` after the ingest); the no-PIN dialog becoming the "Set a PIN" path. Then build it (settings.js for the pages; main.js only for the pad's set mode, the dialog and the done screens).
4. **38c's gates:** unit tests of each page and edit; e2e in en and ar (a group locked by hand, an adult group's lock off, a channel locked from the pencil, the forgotten-PIN path, the first PIN at add) and en-XA; `build:tv` sizes and module diff; `verify:engines --engine chrome53` and `--engine chrome68`, each alone; mutation with the list written first (copy `artifacts/mutate38b.py`, run `--clean` first); full `pnpm test`, `pnpm typecheck`, `pnpm lint`; architecture.md "Built in step 38c"; the PR, merged on green CI.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`7c46ff3`) plus 38a's commits (`79e6efd`, `2817766`, `8b1f3d1`, `aab9a9f`, `64952c2`) and 38b's (`3bb536b` code, `5216ca8`, `ed68f98`, `4666655` e2e, `eb7b44b`, `be40c56` tests, `78e0256` docs), then this handover's commit (docs: HANDOVER.md).
- **PR #162** (`relay/iptv-20261101-214120` → `main`) open, CI running at the leg's end. `main` is `7c46ff3`; the main checkout was not touched.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`; `dist/` (leg 137's full `build:tv`, 38b); in `artifacts/`: `mutate38b.py` (54 mutants, `--clean`), `mutate38b-list.md`, `mutate38b-a.log`, `-b.log`, `-c.log`; `build-tv-38b.log`; `mprobe-38b-after.log`; `unit-38b.log`; `typecheck-38b.log`; `lint-38b.log`; `engines-38b-53.log`, `-68.log`; `e2e-38b-*.log`; screenshots `artifacts/screenshots/parental-*`. 38a's artifacts from leg 136 too.

## Verified vs not
- **Verified locally in leg 137 (38b on top of 38a):**
  - unit 8,246 (+86) in the full run, then +4 (movies, groups, live) in their files; `pnpm typecheck`; lint (the whole tree, then the changed folders after the last fixes);
  - e2e: `--project=throttled` (which runs the whole chromium project first) 195 passed; `tv-bundle.spec.ts` 10 on the new build; `parental.spec.ts` 3 (en, ar, en-XA); screenshots looked at (`parental-pad-ar`, `parental-unlocked-ar`);
  - `build:tv`: main.js 445.3 KB on Tizen (+9.6), 432.5 webOS; settings.js 78.6 KB; query worker 148.3 KB, ingest 136.5 KB; module diff: core-js 216 in main, 6 in settings.js (unchanged);
  - mutation 53/54 (the survivor: main's wiring of the player state's lifecycle through the hold, observable only with a playing movie);
  - `verify:engines` chrome68 13/13, chrome53 13/13 (first run).
- **Not yet:** PR #162's CI and merge; 38c, 38d; production (step 34); the lock on a real TV (step 21's session).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 137:**
- **The leg's first try stopped on a network failure** (the API unreachable); Omar typed "retry" in the tab and it carried on. The watcher had logged "stopped without a handover".
- **e2e with the 18+ group locked:** `e2e/live-rows.ts`' `ordered` leaves the adult channels out (the adult group is last, so no index moves); `allOrdered` keeps them; `e2e/profile-edit.ts` has `restartWith(page, fields, url)` (appIdle, gallery, profile write, start again), `ADULT_OPEN`, `pinFields(pin)`. Rail counts are the catalog's minus 1, and the rail ends with a "Locked groups" chip.
- **`--project=throttled` runs all of chromium first** (195 tests, ~6.5 min locally): a cheap full e2e.
- **The non-media e2e streams never play** (the player stays `opening`): prove a held or reopened stream by counting the mock's requests (`app.addHook('onRequest', …)`, URLs with `/<id>.`).
- **e2e navigation:** after a page restart the header's focus is its first button; LEFT from the list lands on the rail entry on show (read `__LABLO_TEST__.focusPath()` and step from there); from search results, Back goes to the field first.
- **Python patch scripts from bash heredocs broke twice** (`\\'` became `'`; nested quotes didn't parse): Write the script and any TS it appends to the scratchpad, then run it.
- **The per-file size probe** (`C:/Users/Omarm/.claude/jobs/af741535/tmp/sizes.mts`) needs `loader: f.endsWith('x') ? 'tsx' : 'ts', jsx: 'automatic', jsxImportSource: 'preact'` for .tsx files.
- **Mutation lists find dead code again:** three checks in the pad and the movies screen's `showCategory` guard could never decide; they came out.
- **The query worker has 1.7 KB left** (148.3/150). 38c's PIN check for Settings needs about 0.2 KB, or `unlock` then `relock`.

**From legs 130–136 (still true):**
- **CI's engines job can end "cancelled"** (Chromium 53's stuck IndexedDB delete past its 35-minute cap): read the job's log, then `gh run rerun <run> --failed` once the run is complete; the rerun is a new job id (`gh run view <run> --json jobs`).
- **Channel edits are re-matched on two paths** (`channel-relink.ts`): a field added to `ChannelEdit` must be named in `changed(...)` too; test both paths.
- **A test that a read is fresh must load the worker first** (the first call's lazy load reads the profile anyway).
- **Mutation:** list first; `--check` until every snippet is found once; `--clean` runs each command on clean code first; foreground chunks with `MUT_TIMEOUT`; restore any `.mutbak` with `mv`.
- **The mock's catalog is mutable at runtime** (`app.mockState.catalog`, put back in `afterEach`); since 37a its `get.php` added through the loader becomes Xtream (keep a playlist with `e2e/playlist-only.ts`).
- **A second source in e2e needs no pairing:** a profile write from `/?screen=gallery` after `appIdle`; the schedule's first check (15 s) ingests it.
- **Sizes:** main.js 500 KB hard budget on Tizen (445.3 now, 89%). Mention sizes only when they decide something or near a budget; never put 0.5–2 KB in front of Omar as a reason.
- **CI:** about 30 min; known flakes `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes; rerun after the whole run; a push cancels the PR's CI; no `jq` (use `gh --jq`); watch with a Monitor loop over `gh pr checks <n> --json name,bucket --jq …`.
- **e2e on the live screen:** UP reaches the header only from the list's first row; in Arabic the rail is right of the list; `[data-testid=live]` is absent while search, guide or settings paint. Settings' paths: Home `live/header/3`, Search `4`, Settings `5`; Settings items: Sources `settings/items/1`, "Channel groups" `5`, "Channels" `6` (38d reorders them).

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`; new `for…of`, `Uint8Array` as a value, `JSON.stringify`; array destructuring or spread, object spread, fragments; `Promise.prototype.finally`. Count blanks by char code. The module diff says whether core-js moved.
- **Layout and text:** physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free. UI text only from the catalogs. Arabic on/off words agree with their noun. Preact: `translate={false}`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:** CI Node 22, this PC Node 24; a bare `sleep` is blocked; `TaskStop` on `verify:engines` leaves its container; the TV build can crash once (0xC0000005): rerun.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34; its migration and deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Step 38's three questions are decided** (Omar, 2026-11-22, option 1 each). Smaller choices in 38c/38d: make them from the shape with a why; send only real trade-offs to Omar.
- **Leg 137's choices** (Omar may overrule; each is small to change): the pad asks after an unlocked session whatever plays (not only a locked channel); Back on that pad restarts the app; the start's resume waits for the worker's check; Q2's prompt is 38c's; Settings' groups page leaves locked groups out while locked.
- **Step 37's choices (legs 134–135)** stand unless Omar says otherwise (only a source being added upgrades M3U→Xtream, silently; radio stays in its groups).
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers: an Arabic onboarding; typing a backup code; a login and a guide link given again; Settings' report rows; a telemetry send once step 34 has an API; the favourites star and "Channel groups"' move mode; Settings' first open (settings.js); step 36's pencil and forms; step 37's `get.php` link typed on the TV and 10 minutes of radio; step 38's PIN pad with the TV's remote, with and without number keys, and the app hidden and shown while unlocked.
- **What remains after 38:** 39 (clock, sleep timer, colour keys, buffer setting), 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering). With Omar or a TV: 34, 16/19b/21, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):** renaming a source; the info bar overflowing the safe area in en-XA; a hidden channel playing over the list keeping its old name if renamed from the same pencil; CH+ skipping one after hiding the channel that plays; main's `editChannel.close` has no e2e path; the guides screen's clipped third line; `auto-next.spec.ts`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset.spec.ts` en-US; `rpc.test.ts:179`'s 5 ms sleep; caching ffmpeg in CI's media job; the engines job's 35-minute cap; forwarding workers' unhandled rejections; `epgOverrides` not following a refresh's re-match; `e2e/config-server.ts`'s `close()`; ingest request timeouts; **no way to remove a source in the app**; **the query worker's 150 KB budget** (1.7 KB left); **the start's resume could start before the worker's load again** with a light lock check (needs worker bytes); a VNode test of the pad's drawing (only e2e draws it now).

## Checks for Omar
1. The PIN pad and the rails' lock entries: `artifacts/screenshots/parental-pad-ar.png`, `parental-unlocked-ar.png`, `parental-return-en.png` (in the worktree, gitignored). Nothing to decide.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file);
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad (step 38) with the remote, and hide/show the app while unlocked.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-six CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`;
  - 56: `git show 6235456:HANDOVER.md`.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
