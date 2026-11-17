# Lablo IPTV: relay leg 91 opening prompt

You are leg 91 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–89 did steps 1–30c3a (PRs #1–#111). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 90 did step 30c3b, which finishes step 30** (it ran 16:08–17:00 UTC on 2026-11-17).
  - **Merged** as PR #112 (`761abbc`), green on the **first** CI run:
    - verify 13 m 59 s (its `pnpm e2e` 145 passed; unit 5,503 with one skipped);
    - media 12 m 20 s;
    - engines 18 m 57 s: all 114 runs as expected on Chromium 53, 56 and 68, 83 seeded failures caught;
    - `web` skipped by its path filter.
  - Its docs went in as PR #113 (`40b35d9`): 30c3b ticked, and its parents 30c3, 30c, 30b and **30** ticked too.
  - **What 30c3b built** (architecture.md §2 "The config's blocklist" and §3.3 "Built in step 30c3b"; runbook `config.md` "What the TV shows", the new "before playing" bullet):
    - **One place checks: the player controller** (`packages/player/src/controller.ts`):
      - `ControllerOptions.blocked(urls)` is asked in `open` for the URL about to open, **while the old connection closes**. Every play and every retry rung goes through `open`.
      - On Tizen, the redirect probe's answer is asked about too when it differs from the URL.
      - A blocked URL: no `engine.load`, no retry, no connectivity or account check. The session gives up at once with `blockedFailure()` (`failure.ts`: `{category: 'blocked', code: 'CFG-BLOCKLIST', detail: 'BLOCKLIST'}`).
      - A rejected check blocks nothing. The app passes `DataEngine.blockedOrNone` (made public; it warns).
      - `checkBlocklist()` asks again about the stream on show (the session keeps `url`, the URL the engine was given) and stops a blocked one the same way. It asks nothing between loads or after a VOD's end.
    - **The app** (`apps/tv/src/player`):
      - `app-player.ts` passes `blocked` through; `main.tsx` gives it `dataEngine().blockedOrNone`.
      - `player-state.ts` turns a `blocked` failure into 30c2b's refusal card (`refuse`) with `BLOCKLIST_REFUSAL` (`id: 'BLOCKLIST'`: no rule id has capitals, so `data-rule="BLOCKLIST"` tells it apart).
      - Its new `blocklist` option (`config.last` in main.tsx) calls `controller.checkBlocklist()` at each config answer while the player is open. **Decided:** a server blocked while its stream plays stops it, within one config refresh.
      - `PlayerScreen.tsx` `RefusedCard`: "Can't play this" / "Its server can't be used with Lablo." (`player.blocked.*`, en and ar), one button. `CATEGORY_TEXT` has the same texts for the new category.
      - Unlike `disable-playback`, the check is asynchronous: a blocked play counts in `plays` and becomes the last channel (`tuned`). Written in the docs.
    - **Not covered (in the runbook):** webOS/desktop redirects (`<video>` follows them itself), an HLS stream's segments on other hosts, a movie's subtitle files.
    - **e2e** `e2e/config-blocklist-play.spec.ts` (3):
      1. An M3U link on `localhost` whose streams are on a blocked `127.0.0.1`: the source adds, OK on a channel shows the card; lifted, it plays.
      2. An Xtream channel playing when a refresh blocks `127.0.0.1`: the stream stops and the card shows; a zap is refused too.
      3. The card in Arabic.
      - `e2e/config-server.ts` gained `file(path, body, type)` (served files).
    - **Tests:** unit 5,503 (+41): `controller-blocklist.test.ts` (23, new), `app-player.test.ts` (+1), `player-state.test.ts` (+7), `tv-data-engine.test.ts` (+1), the catalogs' per-key tests.
      - Mutation: `artifacts/mutate30c3b.py`, 49 written first. Writing them closed four test gaps. 48 were caught; the survivor is equivalent and kept (`checkBlocklist`'s `s === null`: the load token is 0 whenever there is no session).
    - **Sizes:** main.js 439.5 / 426.8 KB (+1.8 KB), 222 core-js modules (unchanged), the workers unchanged.

## Read first
1. **`RELAY.md`:**
   - Phase 8: **29b2b's line and its "Done when"**;
   - **step 31's line** ("Pairing", Done when: the automated "no plaintext" test passes), 32 and 34;
   - 30c3b's "The shape" and "Done in leg 90" (the newest example of a step's write-up);
   - leg 90's progress-log row.
2. **`docs/architecture.md`:**
   - §3.1 **"A. Pairing"** (the protocol: the TV's ephemeral key, the code, the QR fragment, the phone's `box`, the file frames, the status);
   - §3.2 the endpoint table (`/v1/pair…`), retention, "Built in step 29a" (the `PairSession` table) and "Built in step 29b2a" (`@lablo/protocol`'s pairing schemas, `BlobStore`, `RateLimiter`);
   - §3.3 "Built in step 29b1" (`@lablo/crypto`: `newBoxKeyPair`, `sealPairPayload`/`openPairPayload`, `sealFile`/`openFile`, `sealFileFrame`/`openFileFrame`, `tokenHash`).
3. **`docs/runbooks/web.md`** (the web app, `test:web`, the Next agent nudge) and **`docs/runbooks/config.md`** "What the TV shows".
4. **`CLAUDE.md`:** "Package boundaries", the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `40b35d9` (Merge PR #113) = main.
2. **Check the clock** with `date -u`.
   - **From 2026-11-17 18:02 UTC, step 29b2b** (small, its own PR) can go in. Do it first if the clock allows, or overlap it with step 31's CI (never push while a PR's CI runs):
     - bump Next to **16.4.5** (published 2026-11-03 18:01:54 UTC; 16.4.6 only from 2026-11-23 20:33 UTC), with `@next/swc-win32-x64-msvc` at the same version;
     - dates and advisories: leg 90's script is in its job's tmp folder (gone with the job). Rewrite it in yours: Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`. `dates`: GET `https://registry.npmjs.org/<name>` and read `time`. `advisories`: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["16.4.5"]}`. Use a generic user-agent;
     - then `pnpm --dir "<wt>" web:db`, `test:web` 13/13 and `build:web` (the agent nudge may stop it once: run it again), with the SWC binding loading under Smart App Control;
     - update `web.md`'s gotcha and RELAY.md; open the PR and merge on green CI (its `web` job).
3. **Step 31 (pairing).** It is far too large for one leg: **split it first** in RELAY.md (written before building, with runnable "Done when" checks), then build the first part.
   - First look for existing work: `git log --oneline -15`, and grep `pair` in `apps/web/src`, `apps/tv/src`, `packages/protocol/src`.
   - **A split leg 90 suggests** (the leg decides):
     - **31a, the pairing API** in `apps/web`: the six `/v1/pair…` routes with `MemoryRateLimiter` and `MemoryBlobStore`, the code and token hashes (`tokenHash`), expiry and retention, deleting the payload once read. `test:web` tests, including a "the server only ever holds ciphertext" check on every row and blob. A `PairSession` change needs a migration: local and test databases only (production arrives with step 34), so no approval is needed. Say so in the handover.
     - **31b, the phone page** `/p` (en and ar, RTL): the three forms, the `box` and the file frames in the browser, the presigned upload, the status. Playwright against `next start`.
     - **31c, the TV's pairing screen:** the QR code and the code in large text, the 2 s poll, `openPairPayload`, then **`addRefusal` (`block-new-sources`) and `DataEngine.refresh` (the blocklist)** before anything is kept, then the status back. The QR encoder is a new dependency: at least two weeks old, measured for polyfills (`artifacts/babel-polys30b2.ts`, `poly-count20c2a.py`) and main.js (500 KB budget; 439.5 KB now). Probe it on Chromium 53 and 68.
     - **31d, the M3U file relay:** the presigned GET, `openFileFrame` frame by frame into the ingest, an IndexedDB `blobs` store if needed (a database version bump: test the upgrade from version 2).
     - **31e, the automated "no plaintext" test** end to end: phone page, web app, TV, mock provider. Step 31's own "Done when".
4. **Step 26's common items still apply to each step:**
   - unit tests;
   - a mutation run with the mutant list written first (`artifacts/mutate30c3b.py` is the newest template: `drop()`, block constants, `TESTS` per file, `--rerun`; read its docstring);
   - the `pnpm verify` parts green;
   - `verify:engines --engine chrome53 --engine chrome68` if a TV-run page or the build changes;
   - the PR merged on green CI;
   - docs: RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook;
   - a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `40b35d9` Merge PR #113 = main;
  - `70a1376` docs (30c3b and step 30 ticked, leg 90's row);
  - `761abbc` Merge PR #112;
  - `ce96d46` the 30c3b feature commit.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/`: TV builds from 30c3b's final code, the lab, `dist/tv-vectors`;
  - `artifacts/`:
    - `mutate30c3b.py` and `mutate30c3b.log` (48/49);
    - `unit-30c3b.log` (5,503), `build-30c3b.log`, `lint-30c3b.log`, `typecheck-30c3b.log`, `poly-count-30c3b.log` (222), `engines-30c3b.log` (53+68, 18 as expected), `e2e-30c3b.log` (35 passed);
    - `screenshots/config-blocked-play-{en,ar}.png`;
    - older legs' files.
- **Docker:** no `lablo-chrome*` container left; the `lablo-web` Postgres is down. No `next start` or Vite is left running.
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 90:**
- **The blocklist check before playing lives in `PlayerController.open`.** Any new way to play must go through `PlayerController.play`; a stream given to an engine any other way skips the check.
- **A new `FailureCategory` in `@lablo/player` needs an entry in `PlayerScreen.tsx`'s `CATEGORY_TEXT`** (a Record over the categories: `tsc` catches it).
- **In the plain `pnpm e2e` run, the player never reaches `data-state="playing"`** on the mock's live streams (only the media run decodes). Check that the stage holds a stream (`#stage video` with a `src`: `stageStopped(page) === false`) and `data-plays`. Memory `iptv-ui-test-gotchas`.
- **An e2e stream host that differs from the source's host:** fetch the mock's playlist from Node on `127.0.0.1` (`get.php?…&type=m3u_plus&output=m3u8`), serve it with `config-server.ts`'s `file('/list.m3u', …)`, and type the link as `localhost:<port>/list.m3u`. Memory `iptv-mock-provider-gotchas`.
- **Writing the mutant list first keeps finding real gaps** (four this time: the URL asked when a request's second URL plays, a refusal's timers and token, the tracks, a re-check after dispose). Keep doing it before the run.

**From earlier legs (still true):**
- **`DataEngine`'s refreshes must claim the slot before any `await`.** New checks go inside the `try`, after `claim`.
- **A settings, guide or source row is 120 px: it holds the name or link plus one line.** The guides screen's "read, last try failed" rows have clipped their third line since step 22b2 (a known UI bug, in architecture.md).
- **Settings has two rows:** "TV guides" `settings/items/0`, "Sources" `settings/items/1`.
- **The e2e blocklist:** the mock runs on `127.0.0.1`. Use `doc({ blocklist: { salt: HARNESS_SALT, hashes: [blocklistHash(HARNESS_SALT, '127.0.0.1')] } })` from `tools/engines/src/config` and `packages/crypto/src/blocklist`, then `refreshConfig()` (the query worker reads the new list before it resolves). The config fetch itself is never checked.
- **A player screen with no stream shows the page's white on the desktop.** `player__blank` paints its own black. Look at every screenshot.
- **The controller's `play()` and `stop()` publish `opening`/`idle` synchronously.** `onStatus` already clears a card on a new play.
- **Test traps:**
  - With no tracks, AUDIO then SUBTITLES closes the menu the first key opened: check after each key.
  - `data-plays` is the player's lifetime count; it isn't reset on close.
  - An onboarding title's name is bidi-isolated: compare it through `stripIsolates`.
  - `track()` in the settings screens decrements before the caller's `.then` runs.
  - A `VirtualList`'s `renderItem` returns the row component's VNode: read the row through `.props`.
- **The mock provider keeps no request log.** To prove nothing was fetched, check state or use a fake transport in a unit test.
- **The mutation run edits source files:** never commit, build or run e2e while it runs. Close gaps after the run, then `--rerun`.
- **Onboarding's first screen is a horizontal row** (RIGHT moves, LEFT in Arabic; DOWN does nothing).
- **The gate has its own navigator:** read it from the DOM (`[data-testid=gate]`).
- **The desktop dev app has no `minVersion`:** test the update screen in the built webOS bundle from `file://` (run `pnpm build:tv` first).
- **Run the tests before taking out "dead" code.** Memory `iptv-parser-test-patterns`.
- **A state machine's dispose test must go back through its idle state.**
- **The Write tool decodes `\u2066`:** use `stripIsolates` from `@lablo/core` in tests.
- **apps/tv's `tsc` checks test files:** run `pnpm --dir "<wt>/apps/tv" exec tsc --noEmit -p tsconfig.json` before committing.
- **A worker the app starts on its own needs an "idle" signal the old-engine walk can wait for** (`configIdle()`, leg 86).
- **A worker the app starts after the first paint needs its npm deps in `apps/tv/vite.config.ts` `optimizeDeps.include`.**
- **Never open the app's IndexedDB from a test page before the app has.** Wait for `[data-testid="onboarding"][data-ready="true"]`.
- **A worker's failed fetch is not a page console error in Playwright.**
- **Polyfill names:**
  - a member named `flags` pulls `es.regexp.flags`, and `lastIndexOf` on an array pulls a polyfill;
  - avoid `concat` and regex `.test` in new TV code;
  - never use `URL` in TV code;
  - to find which file adds a core-js module, use `artifacts/babel-polys30b2.ts`;
  - `poly-count20c2a.py` overwrites `artifacts/corejs20c1-<platform>.txt`: copy the old list first to diff.
- **CI runs Node 22; this PC runs Node 24.**
- **A manual clock races fake-indexeddb:** wait until the sleep is registered.
- **TaskStop on a background `next start` leaves it running:** `netstat -ano | grep ":3100 "`, then `Stop-Process`.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **zod on the TV:** `zod/mini` only.
- **`apps/tv/src/env.d.ts` must stay a global script.**
- **Root `test/` and `e2e/` files import packages by relative `src` paths** (or need the package in the root `package.json` devDependencies).
- **Overlap CI with the next step,** but never push while a PR's CI runs (a push cancels it).
- **The media flake** (`epg-declared-300mb`) and the throttled search spec's throttle proof: one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:**
  1. after `gh pr create`, wait ~45 s (`timeout 45 tail -f /dev/null`), then `gh run list --commit <sha> --event pull_request`;
  2. start one Monitor running a `comm -13` loop over `gh run view <run> --json status,conclusion,jobs` (worked in legs 87–90).
  - To see why a job failed, or to read counts: `gh api repos/Omarmarei/Lablo/actions/jobs/<job id>/logs`.
  - A docs-only PR runs only `changes`; merge once it passes.
- **Python patch scripts:** write them with the Write tool and run `python -I <file> "<wt>"`; short heredocs worked this leg, long ones with quotes fail. Python with `-I` ignores `PYTHONIOENCODING`: call `sys.stdout.reconfigure(encoding='utf-8')`.
- **One `git fetch` may print "incorrect old value provided"** (another session fetching at the same time). Check with `git ls-remote origin refs/heads/main`.
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit tests take about 5–8 s each; 49 mutants took about 5 min.
- **The profile is at version 7; the IDB schema is at version 2** (`kv` holds the config).
- **TV code rules:**
  - no `Array.prototype.sort` in the TV main bundle;
  - none of these in **new** TV app files: `Uint8Array`, `JSON.stringify`, `new RegExp`, `for…of` or other iterator calls, array destructuring or spread, object spread;
  - no member named `at` or `flags`;
  - the build can crash once (0xC0000005): run it again.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (`lablo-chrome*`).
- **A bare `sleep N; cmd` in Bash is blocked:** use an `until` loop, `timeout N tail -f /dev/null`, or a Monitor. There is no `jq` in Git Bash: use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min), after a fresh `pnpm build:tv`;
  - `pnpm test` takes about 4 min (5,503 tests).
- **Local `pnpm verify` or `pnpm e2e` may die from low memory:** run the parts separately, or leave them to CI. Ten related specs (35 tests, `--workers=3`) ran fine together.
- **Code rules:**
  - `packages/ui` components stay hook-free; UI text comes only from the catalogs;
  - physical CSS only, no CSS Grid or flex `gap`; TV code is ES2017;
  - dependencies at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation.
- **Scripts:** a one-off script runs as `pnpm --dir "<wt>" exec tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, path-filtered;
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data; README.md stays "# Lablo";
  - **no production signing seed ever enters the repo, a chat or CI.**
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 90 (30c3b):**
  - **Locally:**
    - lint, typecheck, unit 5,503;
    - `build:tv` (main 439.5 / 426.8 KB, 222 core-js modules, the workers unchanged);
    - `verify:engines --engine chrome53 --engine chrome68`: 18 as expected. The onboarding walks play with no block, so the check runs on both engines at every open; the walks' CH− stayed at 0.7 s;
    - e2e `config-blocklist-play.spec.ts` 3/3, plus config-blocklist, config-modes, config-gate, config, player, resume, live, movie-resume and auto-next: 35/35;
    - the screenshots looked at (black behind the card; Arabic mirrored).
  - **Mutation:** 48/49 (the survivor equivalent).
  - **CI:** the first run all green (114 engine runs, 83 seeded failures caught; e2e 145 passed).
- **Not verified:**
  - a blocked stream on the old engines (the walks get no block);
  - Tizen's redirect check on a real Samsung (unit tests only; no Samsung yet);
  - on a real TV.
- **Migrations and deploys:** nothing new. Nothing is in production (Neon arrives with step 34 `[needs Omar]`), and nothing is deployed.

## Open decisions and gates
- **None for step 31's first part beyond the leg's own calls** (the split, and whatever its shape decides, recorded in RELAY.md).
- **Later UI fix (no step yet):** the guides screen's "read, last try failed" rows clip their third line (since 22b2). Options: one line that holds both, or taller rows on that screen.
- **For step 31 (pairing):** a phone sending sources to the TV is a new way to add a source. It must read `addRefusal` (`block-new-sources`) and go through `DataEngine.refresh` (the blocklist).
- **Step 34 `[needs Omar]`, including the config key ceremony** (runbook `config.md`):
  - Omar runs `pnpm sign-config keygen` twice on his own machine and keeps the seeds in his password manager and on paper;
  - he gives Claude the two public keys and signs the production config himself;
  - he creates the Vercel, Neon, R2 and Upstash accounts and the domain, and puts the keys in `.env` himself;
  - the first production migration and the first deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set;
  - about 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player.
  - Steps 24–28 can join that visit, along with whether the TV keyboards type into the search field, the gate's screens, the refusal cards (now with the blocklist's) and the Sources screen on the real set.
- **For step 32:** derive the backup master once, in a worker, with progress, and cache it; that worker needs an idle signal for the walk.
- **For step 38 (parental):** every Home shelf, the search results, "Continue watching" and "Recent channels" hold adult items too: the lock must filter them. Step 38 can also give the Sources screen its actions (remove, edit a login).
- **For step 41 (the 2018 Samsung):** decoded poster memory, posters in lists on the low tier, the search's real time, the scrypt time.
- **Later (unchanged):**
  - search and Home: a kind filter and posters;
  - movies and shows extras;
  - player extras: fine HLS seeking, "start over", PLAY/PAUSE intents, PRE-CH on webOS, pre-buffered zapping;
  - the guide: a day jump and a Guide/Info key;
  - an on-screen keyboard if the TV keyboards fail;
  - dropping Chromium 53 (ADR-012);
  - a memory signal for the tier;
  - CI's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (step 30c3b is merged; on the PC, nothing to press on a TV yet)
1. In the repo, run `pnpm exec vitest run packages/player/src/controller-blocklist.test.ts apps/tv/src/player`: all pass.
2. `pnpm exec playwright test --project=chromium e2e/config-blocklist-play.spec.ts`: 3 passed. The screenshots are `artifacts/screenshots/config-blocked-play-{en,ar}.png`.
3. Try it by hand with the real signer and backend:
   1. `pnpm mock` (the mock provider on port 8080), `pnpm web:dev` (the backend on port 3100) and `pnpm dev`;
   2. open `http://localhost:5173/` in a private window. Go through onboarding (Enter on each screen), fill the Xtream login (server `127.0.0.1:8080`, `lablo` / `lablo-test`), "Add source", "Start watching";
   3. press Enter on a channel: it plays (the stream may only say "Connecting…" with the mock);
   4. `pnpm sign-config block 127.0.0.1`, then `pnpm sign-config sign --dev`, then run `window.__LABLO_TEST__.refreshConfig()` in the console: the stream stops and the card says "Can't play this" / "Its server can't be used with Lablo." over black;
   5. press CH+ (Page Up): the next channel is refused too. Enter on "Channels" goes back to the list;
   6. `pnpm sign-config unblock 127.0.0.1`, sign again, `refreshConfig()`, Enter on a channel: it plays;
   7. undo with `git checkout config/`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Fifty-one CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29–47: as listed in leg 86's handover (`git -C "<wt>" show 5fffb27:HANDOVER.md`, "Carry-forward reminders");
  - 48: the app's structure could name `apps/tv/src/gate/` (the config gate over every screen: its own root, navigator and capture key listener) and say a new full-screen state over the app goes through it;
  - 49: any new way to add a source or to play must read the config's refusal (`refusalFor`: onboarding's and the player's `refusal` option), and any player state with no stream must paint its own black (`player__blank`);
  - 50: any new way to read a provider's catalog goes through `DataEngine.refresh`/`refreshEpg` (they check the blocklist), and a refresh must claim the slot before any `await`;
  - 51 (new): any new way to play goes through `PlayerController.play` (its `open` checks the blocklist, and the Tizen redirect's answer); a stream given to an engine any other way skips the check.
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create, and he puts the keys in `.env` himself. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
