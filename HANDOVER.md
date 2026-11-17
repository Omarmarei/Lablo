# Lablo IPTV: relay leg 90 opening prompt

You are leg 90 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–88 did steps 1–30c2b (PRs #1–#109). Three steps wait for Omar: step 16's Samsung part, 19b and 21. Step 29b2b (the Next.js bump) can start from 2026-11-17 18:02 UTC.
- **Leg 89 split step 30c3 and did 30c3a** (it ran 15:10–16:05 UTC on 2026-11-17).
  - **The split** (RELAY.md, written before building): 30c3a covers adding a source, refreshing it and the screen that says so (done); 30c3b covers playing, including Tizen's redirect probe (open).
  - **Merged** as PR #110 (`9cec856`), green on the **first** CI run:
    - verify 13 m 38 s (its `pnpm e2e` 142 passed; unit 5,462 with one skipped);
    - media 10 m 45 s;
    - engines 20 m 42 s: all 114 runs as expected on Chromium 53, 56 and 68, 83 seeded failures caught;
    - `web` skipped by its path filter.
  - Its docs went in as PR #111 (`41e3416`).
  - **What 30c3a built** (architecture.md §3.3 "Built in step 30c3a"; runbook `config.md` "What the TV shows", the blocklist bullet):
    - **One place checks: `DataEngine`** (`apps/tv/src/data/engine.ts`):
      - `refresh(job)` takes the refresh slot first, then asks `blocked([sourceUrlOf(job.source)])`. `sourceUrlOf` gives an Xtream account's `base` or an M3U link's `url`.
      - A blocked source rejects with `BlockedSourceError` (`code: 'blocklisted'`) before any ingest worker starts.
      - `refreshEpg` asks `blocked` for every listed guide's URL. A blocked guide is left out of `only` (with `due` or without) but stays listed, so it is neither read nor deleted.
      - `blockedOrNone`: when `blocked` itself fails, nothing counts as blocked (a console warning).
    - **At add:** `LoadErrorCode` gains `blocklisted` (`loader.ts`; the old `blocked` still means an account the provider banned). `engine-loader.ts` `loadError` passes it on, and `OnboardingApp.tsx` shows `error.blocklisted`: "This server can't be used with Lablo.". The failed-load screen keeps "Edit details" and "Try again".
    - **On refresh:** `refresh-scheduler.ts` keeps a `blocklisted` refusal as a failure (tried again after 2 h) without the console warning.
    - **Settings → Sources** (new screen):
      - `settings/sources-state.ts`, `SourcesPage` and `SourceItem` in `SettingsScreen.tsx`. It is Settings' **second** row (`settings/items/1`), so the guides' key paths stay.
      - Each source shows its name (`dir="auto"`), its kind and server ("Xtream login · host:port"; `shownHost` gives the host and port only), and **one** line under them:
        - "Updated {day}, {time}" (`checkedAt`, else `updatedAt`), or "Not updated yet";
        - for a blocked source, in the warning colour: "Not updated since {day}, {time}: this server can't be used with Lablo." (or "Not updated: …").
      - It reads `profile`, `sourceStatus` and `blocked` at each opening. There are no actions yet: OK does nothing, Back returns.
    - **Settings → TV guides:** a guide on a blocked server shows "Not read: this server can't be used with Lablo." in place of its status and failure lines (`guide-<i>-blocked`).
    - **Catalogs:** `error.blocklisted`, `guides.blocked`, `settings.sources`, `settings.sourcesHint`, and the `sources.*` keys, in en.ts and ar.ts.
    - **e2e** `e2e/config-blocklist.spec.ts` (3):
      1. The mock's `127.0.0.1` blocked from the start: Add is refused and nothing is kept; after the lift, "Try again" adds the source.
      2. A source blocked after it was added: Sources and TV guides say so; the lift takes both lines away.
      3. The same in Arabic.
    - **Tests:** unit 5,462 (+84).
      - Mutation: `artifacts/mutate30c3a.py`, 51 written first. Writing them closed two test gaps. 50 were caught; the survivor was a test gap, now closed (the rerun `mutate30c3a-b.log` caught it, 1/1).
    - **Sizes:** main.js 437.7 / 425.0 KB (+7.5 KB), 222 core-js modules (unchanged), the workers unchanged.

## Read first
1. **`RELAY.md`:**
   - Phase 8: 30c3's split note, **30c3a's "The shape" and "Done in leg 89"**;
   - **30c3b's line and its "Decisions for its leg"**, and 29b2b's line and "Done when";
   - 30c2b's "The shape" (the player's refusal card, which 30c3b reuses);
   - leg 89's progress-log row.
2. **`docs/architecture.md` §3.3:** "Built in step 30c2b" and **"Built in step 30c3a"**.
3. **`docs/runbooks/config.md`:** "What the TV shows" (the blocklist bullet: 30c3b changes its "Not covered" line) and "On the TV" (the blocklist's host form).
4. **`CLAUDE.md`:** "Package boundaries", the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.
5. **Code for step 30c3b:**
   - **The player:** `apps/tv/src/player/player-state.ts`:
     - `playRow` and `playFilm` already read `refusalNow()` synchronously before `controller.play`. The blocklist check is an **async** worker call (`DataEngine.blocked`), so it can't go in the same place unchanged.
     - The refusal machinery: `refused`, `refuse(rule, stop)`, `carded`, `onStatus`.
   - **The card:** `PlayerScreen.tsx` `RefusedCard`, `player__blank` (any "no stream" state paints its own black). The card's text comes from a `Refusal` (`{id, message}`); a blocked host needs its own catalog text.
   - **Stream URLs:** `apps/tv/src/player/app-player.ts` and `packages/player/src/controller.ts`. On Tizen, `resolveUrl` (the redirect probe) gives the final host.
   - **Reuse:** `sourceUrlOf` and `blocked` from `engine.ts`; `main.tsx` builds the player's options (pass a `blocked` function from `dataEngine()`).
   - **e2e:** `e2e/config-blocklist.spec.ts` and `e2e/config-modes.spec.ts` to copy from; `e2e/config-server.ts` `doc()`.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `41e3416` (Merge PR #111) = main.
2. **Check the clock** with `date -u`.
   - **From 2026-11-17 18:02 UTC, step 29b2b** (small, its own PR) goes first:
     - bump Next to 16.4.5 (16.4.6 only from 2026-11-23 20:33 UTC), with `@next/swc-win32-x64-msvc` at the same version;
     - publish dates: a tiny `npmdates.py` in the job's tmp folder (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`) reading the `time` field of `https://registry.npmjs.org/<name>`;
     - advisories: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`;
     - then `pnpm --dir "<wt>" web:db`, `test:web` 13/13 and `build:web` (the agent nudge may stop it once: run it again), with the SWC binding loading under Smart App Control;
     - update `web.md`'s gotcha and RELAY.md; open the PR and merge on green CI.
3. **Step 30c3b (the blocklist before playing).** First look for existing work: `git log --oneline -10`, then grep `blocked(` in `apps/tv/src/player`.
   - **Write its shape and runnable "Done when" checks into RELAY.md before building.** Its decisions (in RELAY.md):
     - **Where the async check goes.**
       - The check needs the stream URL, which `playRow`/`playFilm` build. A play must not start before the answer, yet a zap must stay fast.
       - One way: ask `blocked` in parallel with what a play already waits for (the row's chunk, the controller's open), and stop the play if the answer is "blocked" before the first frame.
       - Another: keep a per-host answer cache in the player, since every channel of a source usually shares one host.
       - `seq` already drops stale answers.
     - **The card's text:** a refusal with no rule `id` (or a fixed one such as `blocklist`) and a catalog text, e.g. "This channel's server can't be used with Lablo.". `data-rule` on the card should show which kind of refusal it is.
     - **Tizen:** the redirect probe's final URL must be checked before AVPlay opens it, in `app-player.ts` or `controller.ts`. On webOS, `<video>` follows redirects itself: say it isn't covered.
     - **A stream playing when a refresh blocks its host:** stop it as `disable-playback` does? This needs the player to re-ask on a config refresh (the hook is `config.policy` changing). Decide, and record it.
   - **e2e:** the stream host must differ from the source's API host.
     - The mock's URLs follow the Host header. One way: add the source as `http://localhost:<port>` (API host `localhost`); a playlist the test serves would then list streams on `127.0.0.1`.
     - Or block `127.0.0.1` for a source added by `localhost`, and serve an M3U with `127.0.0.1` stream URLs from a tiny test server.
     - Check what `listen(app)` and the mock's `get.php` give first.
   - **Screenshots** in en and ar, looked at; **a "press these keys" list for Omar.**
4. **Step 26's common items still apply to each step:**
   - unit tests;
   - a mutation run with the mutant list written first (`artifacts/mutate30c3a.py` is the newest template: `drop()`, block constants, `TESTS` per file, `--rerun`; read its docstring);
   - the `pnpm verify` parts green;
   - `verify:engines --engine chrome53 --engine chrome68` if a TV-run page or the build changes;
   - the PR merged on green CI;
   - docs: RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook;
   - a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `41e3416` Merge PR #111 = main;
  - `8564f95` docs (30c3a ticked, leg 89's row);
  - `9cec856` Merge PR #110;
  - `2c22cd2` the 30c3a feature commit;
  - `de3891c` the 30c3 split.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/`: TV builds from 30c3a's final code, the lab, `dist/tv-vectors`;
  - `artifacts/`:
    - `mutate30c3a.py` and its logs (`mutate30c3a.log` 50/51, `-b.log` 1/1);
    - `unit-30c3a.log` (5,461), `build-30c3a.log`, `lint-30c3a.log`, `typecheck-30c3a.log`, `poly-count-30c3a.log` (222);
    - `engines-30c3a.log` (53+68, 18 as expected);
    - `screenshots/config-blocked-add-{en,ar}.png`, `sources-blocked-{en,ar}.png`, `guides-blocked-en.png`, `settings-{en,ar}.png` (two rows now);
    - older legs' files.
- **Docker:** no `lablo-chrome*` container left; the `lablo-web` Postgres is down. No `next start` or Vite is left running.
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 89:**
- **`DataEngine`'s refreshes must claim the slot before any `await`.** `claim()` throws at once when the slot is taken, and "one refresh at a time" relies on that. An `await` before the claim let a second refresh slip in, which the existing test caught. New checks go inside the `try`, after `claim`.
- **A settings, guide or source row is 120 px: it holds the name or link plus one line.** Three lines (44 + 38 + 38 px plus gaps) are clipped. A warning replaces the line under the name.
  - The guides screen's rows for a guide that was read and whose last try failed have clipped since step 22b2 (status plus failure line). Left for later: a known UI bug, in architecture.md.
- **Settings has two rows:** "TV guides" `settings/items/0`, "Sources" `settings/items/1`. The rows have an 8 px gap now.
- **The e2e blocklist:** the mock runs on `127.0.0.1`. Use `doc({ blocklist: { salt: HARNESS_SALT, hashes: [blocklistHash(HARNESS_SALT, '127.0.0.1')] } })`, imported from `tools/engines/src/config` and `packages/crypto/src/blocklist`. Then call `refreshConfig()` (the query worker reads the new list before it resolves). The config server is on `127.0.0.1` too, but the config fetch is never checked.
- **`track()` in the settings screens decrements before the caller's `.then` runs.** A request started inside another's `.then` shows `pending` 1, not 2.
- **A `VirtualList`'s `renderItem` returns the row component's VNode.** Read the row through `.props` cast via `unknown` (`{row, index}`), not the DOM's `data-*`.
- **Python patch scripts in a Bash heredoc failed again** (~140 lines with quotes). Write them with the Write tool and run `python -I <file> "<wt>"`. Memory `use-write-tool-for-doc-batches`.
- **One `git fetch` printed "incorrect old value provided"** (another session fetching at the same time). The refs were right: check with `git ls-remote origin refs/heads/main`.

**From earlier legs (still true):**
- **A player screen with no stream before any play shows the page's white on the desktop.** `player__blank` paints its own black: 30c3b's card needs it too. Look at every screenshot.
- **The controller's `play()` and `stop()` publish `opening`/`idle` synchronously.** `onStatus` already clears a card on a new play, so don't do it again in a caller.
- **Test traps:**
  - With no tracks, AUDIO then SUBTITLES closes the menu the first key opened: check after each key.
  - `data-plays` is the player's lifetime count; it isn't reset on close.
  - An onboarding title's name is bidi-isolated: compare it through `stripIsolates`.
- **The mock provider keeps no request log.** To prove nothing was fetched, check state (the profile's sources from IndexedDB) or a fake transport in a unit test.
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
  2. start one Monitor running a `comm -13` loop over `gh run view <run> --json status,conclusion,jobs` (worked in legs 87–89).
  - To see why a job failed, or to read counts: `gh api repos/Omarmarei/Lablo/actions/jobs/<job id>/logs`.
- **Python with `-I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit tests take about 5–8 s each; 51 mutants took about 6 min.
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
  - `pnpm test` takes about 4 min (5,462 tests).
- **Local `pnpm verify` or `pnpm e2e` may die from low memory:** run the parts separately, or leave them to CI. Nine related specs (34 tests, `--workers=3`) ran fine together.
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
- **Verified in leg 89 (30c3a):**
  - **Locally:**
    - lint, typecheck, unit 5,461 (then one more test);
    - `build:tv` (main 437.7 / 425.0 KB, 222 core-js modules);
    - `verify:engines --engine chrome53 --engine chrome68`: 18 as expected. The onboarding walks add a source with no block, so the new check runs on both engines and lets it through;
    - e2e `config-blocklist.spec.ts` 3/3, plus guides, guide-offset, guide-matches, onboarding, config-modes, config, config-gate and live: 34/34;
    - the screenshots looked at (Arabic mirrored; rows fit after the one-line fix).
  - **Mutation:** 50/51, then 1/1.
  - **CI:** the first run all green (114 engine runs, 83 seeded failures caught; e2e 142 passed).
- **Not verified:**
  - a blocked host on the old engines (the walks get no block for their source);
  - on a real TV;
  - the host an M3U link redirects to (not covered by design, written in the runbook).
- **Migrations and deploys:** nothing new. Nothing is in production (Neon arrives with step 34 `[needs Omar]`), and nothing is deployed.

## Open decisions and gates
- **None for 30c3b beyond the leg's own calls** listed in step 3 (to record in RELAY.md).
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
  - Steps 24–28 can join that visit, along with whether the TV keyboards type into the search field, the gate's screens, the refusal card and now the Sources screen on the real set.
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

## Checks for Omar (step 30c3a is merged; on the PC, nothing to press on a TV yet)
1. In the repo, run `pnpm exec vitest run apps/tv/src/settings test/tv-data-engine.test.ts apps/tv/src/data/refresh-scheduler.test.ts apps/tv/src/onboarding/engine-loader.test.ts`: all pass.
2. `pnpm exec playwright test --project=chromium e2e/config-blocklist.spec.ts`: 3 passed. The screenshots are in `artifacts/screenshots/config-blocked-add-*.png`, `sources-blocked-*.png` and `guides-blocked-en.png`.
3. Try it by hand with the real signer and backend:
   1. `pnpm mock` (the mock provider on port 8080), `pnpm web:dev` (the backend on port 3100) and `pnpm dev`;
   2. `pnpm sign-config block 127.0.0.1`, then `pnpm sign-config sign --dev`;
   3. open `http://localhost:5173/` in a private window. Go through onboarding (Enter on each screen) and fill the Xtream login: server `127.0.0.1:8080`, the mock's test login (`lablo` / `lablo-test`). Press Enter on "Add source": "Couldn't add 127.0.0.1" and "This server can't be used with Lablo." show at once;
   4. `pnpm sign-config unblock 127.0.0.1`, sign again, run `window.__LABLO_TEST__.refreshConfig()` in the console, press RIGHT then Enter ("Try again"): the source loads. Press "Start watching";
   5. block it again (steps 2 and 4's `refreshConfig()`), then press UP and RIGHT ×5 to the gear, Enter, DOWN to "Sources", Enter: the row says "Not updated since …: this server can't be used with Lablo.". Back, UP to "TV guides", Enter: the panel's guide says "Not read: …";
   6. undo with `git checkout config/`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Fifty CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29–47: as listed in leg 86's handover (`git -C "<wt>" show 5fffb27:HANDOVER.md`, "Carry-forward reminders");
  - 48: the app's structure could name `apps/tv/src/gate/` (the config gate over every screen: its own root, navigator and capture key listener) and say a new full-screen state over the app goes through it;
  - 49: any new way to add a source or to play must read the config's refusal (`refusalFor`: onboarding's and the player's `refusal` option), and any player state with no stream must paint its own black (`player__blank`);
  - 50 (new): any new way to read a provider's catalog goes through `DataEngine.refresh`/`refreshEpg` (they check the blocklist), and a refresh must claim the slot before any `await`.
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create, and he puts the keys in `.env` himself. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
