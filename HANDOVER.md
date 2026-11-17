# Lablo IPTV: relay leg 89 opening prompt

You are leg 89 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–87 did steps 1–30c2a (PRs #1–#107). Three steps wait for Omar: step 16's Samsung part, 19b and 21. Step 29b2b (the Next.js bump) can start from 2026-11-17 18:02 UTC.
- **Leg 88 did step 30c2b** (it ran 12:41–15:10 UTC on 2026-11-17, with a usage-limit pause in the middle). That finishes 30c2 (ticked). 30c (the parent) stays open until 30c3.
  - **Merged** as PR #108 (`502ffaf`), green on the **first** CI run:
    - verify 13 m 40 s (its `pnpm e2e` 139 passed);
    - media 12 m 26 s;
    - engines 19 m 16 s: all 114 runs as expected on Chromium 53, 56 and 68, 83 seeded failures caught;
    - `web` skipped by its path filter.
  - Its docs went in as PR #109 (`61b5547`).
  - **What 30c2b built** (architecture.md §3.3 "Built in step 30c2b"; runbook `config.md` "What the TV shows"):
    - **`refusalFor(policy, mode)`** (`apps/tv/src/gate/gate-state.ts`, pure): `{id, message}` of the kill rule when it stops `block-new-sources` or `disable-playback` (or is stronger), else `null`. `main.tsx` makes two `computed` signals from `config.policy` (`addRefusal`, `playRefusal`) and passes them as the `refusal` option of `createOnboarding` and `createPlayer`.
    - **Onboarding:**
      - `begin(source)` in `onboarding-state.ts` runs for "Add source" (after the form's own checks) and for "Try again". It reads `refusal.peek()`. If a rule is there, `load` becomes `{status: 'refused', refusal}`, the screen gets two buttons (Edit details, Try again) and nothing loads.
      - `OnboardingApp.tsx` `failureText`: the title is "Couldn't add {name}"; the text is the doc's message (`messageIn`) or `error.refused`. `load-error` carries `data-code="refused"` and `data-rule`.
      - A load already running when the rule arrives finishes.
    - **The player** (`player-state.ts`):
      - **Refused plays:** `refusalNow()` is read before `controller.play` in `playRow`'s `start` and in `playFilm`. If refused, `refuse(rule, false)` runs: nothing plays, `plays` and the last channel stay, and the controller isn't even made.
      - **A rule arriving while open:** the player follows the signal. `refuse(rule, true)` keeps a movie's place, bumps `seq`, drops the waiting zap, the position timer, the next-episode countdown and the track menu, puts the card up (`carded`, `cardZone(1)`, focused), shows the info bar, and calls `controller.stop()` **last**.
      - **The card while refused:** `onStatus` keeps it as long as `refused` holds, `armInfo` keeps the bar up, `openMenu` refuses, and OK on the card closes the player.
      - **A lift:** nothing changes on screen. The next play that goes through sets `refused = null`, and the controller's synchronous `opening` takes the card away (`onStatus`).
      - **The screen** (`PlayerScreen.tsx`): `RefusedCard` (`player-refused`, `data-rule`, `player-refused-text`, its button `player-close`: "Channels" or "Back"), `data-refused` on the root, and `player__blank`, a black full-screen layer (`player.css`).
    - **Catalogs:** `error.refused`, `player.refused.title` and `player.refused.text`, in en.ts and ar.ts.
    - **e2e:**
      - `e2e/config-modes.spec.ts` (3): `block-new-sources` from the start, then lifted, then "Try again" adds the source; `disable-playback` arriving through `refreshConfig()` mid-play (controller `idle`, `<video>` without `src`, a zap and a list channel refused, then the lift); both in Arabic.
      - `e2e/onboard.ts` gains `fillXtream` and exports `startWatching`.
    - **Tests:** unit 5,378 (+34). Mutation: `artifacts/mutate30c2b.py`, 46 written first, 43 caught, two test gaps closed (rerun 2/2 with `--rerun`), one equivalent taken out.
    - **Sizes:** main.js 430.2 / 417.5 KB (+2.9), 222 core-js modules (unchanged), workers unchanged.

## Read first
1. **`RELAY.md`:**
   - Phase 8: 30c2b's "The shape", "Done-when checks" and **"Done in leg 88"**;
   - **30c3's line and "Done when"**, and 29b2b's;
   - 30c's "What 30b2 left for it";
   - leg 88's progress-log row.
2. **`docs/architecture.md`:** §3.3 C; "Built in step 30c1", "Built in step 30c2a", **"Built in step 30c2b"**.
3. **`docs/runbooks/config.md`:** "On the TV", **"What the TV shows"** (30c3 adds the blocklist checks there), and the `blocklist` notes (hashes of a host and each parent domain).
4. **`CLAUDE.md`:** "Package boundaries", the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.
5. **Code for step 30c3:**
   - **The check itself:**
     - `DataEngine.blocked(urls)` (`apps/tv/src/data/engine.ts`; the query worker answers it from the cached record, `cachedBlocklist`);
     - `packages/data/src/config-policy.ts` and the blocklist code next to it (the host and parent-domain hashing);
     - the hello screen's `blocked-status` row (`hello-config.ts`) shows how it is called.
   - **At add:** `apps/tv/src/onboarding/engine-loader.ts` `run()` (the API host: the Xtream server, the M3U link's host) or `onboarding-state.ts` `begin()` (now synchronous: a blocked check is an async worker call). `loader.ts` `LoadErrorCode` already has `blocked`, but it means an account the provider banned (`error.blocked`), so a blocked host needs its own code and text.
   - **On refresh:** `apps/tv/src/data/refresh-scheduler.ts`. "Says so" needs a place to show it: the settings' sources list? Find out where a source's refresh state shows today.
   - **Before play:**
     - `player-state.ts` `playRow`/`playFilm` (`refusalNow` is synchronous; the stream host's check is async);
     - `app-player.ts` and `packages/player/src/controller.ts` (`resolveUrl`: Tizen's redirect probe gives the final host).
     - The refusal card machinery (`refused`, `refuse()`) may carry a blocked-host refusal with its own text. Any "no stream" player state needs `player__blank` (see the gotchas).
   - **e2e:** `e2e/config-server.ts` `doc()` (the harness doc already blocks `blocked.lablo.test` and `مثال.lablo.test`); `e2e/config-modes.spec.ts` to copy from.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `61b5547` (Merge PR #109) = main.
2. **Check the clock** with `date -u`.
   - **From 2026-11-17 18:02 UTC, step 29b2b** (small, its own PR) can go first:
     - bump to 16.4.5 (16.4.6 only from 2026-11-23 20:33 UTC), with `@next/swc-win32-x64-msvc` following;
     - publish dates: a tiny `npmdates.py` in the job's tmp folder (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`), reading the `time` field of `https://registry.npmjs.org/<name>`;
     - advisories: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`;
     - then `pnpm --dir "<wt>" web:db`, `test:web` 13/13 and `build:web` (the agent nudge may stop it once: run it again), with the SWC binding loading under Smart App Control;
     - update `web.md`'s gotcha and RELAY.md; open the PR and merge on green CI.
3. **Step 30c3 (the blocklist checks).** First look for existing work: `git log --oneline -10`, then grep `blocked(` in `apps/tv/src` (outside `hello`).
   - **This step is large:** consider splitting it the way 30c and 30c2 were (for example 30c3a at add and on refresh, 30c3b before play with Tizen's redirect probe). Write the split and the runnable "Done when" checks into RELAY.md **before building**.
   - **Decisions to make and record** (the leg's call, in RELAY.md):
     - where the blocked check sits at add (the loader, so it runs in the loading screen's "checking" phase, is the natural place);
     - the new error code and texts (en and ar) for a blocked host;
     - what "a blocked source isn't refreshed, and says so" shows, and where;
     - how a blocked stream is refused at play (an async check before `controller.play`, with a card like 30c2b's, and the hosts checked on Tizen after the redirect probe);
     - whether a host blocked while a stream plays stops it (as `disable-playback` does).
   - **e2e:** a served config whose blocklist has the mock provider's host (the mock runs on 127.0.0.1: check how `blocklistHost` and the hashes treat an IP and a port), refused at add, at refresh and at play.
   - **Screenshots:** en and ar, looked at. **A "press these keys" list for Omar.**
4. **Step 26's common items still apply to each:**
   - unit tests;
   - a mutation run with the mutant list written first (`artifacts/mutate30c2b.py` is the newest template: `drop()`, block constants, `--rerun`; read its docstring);
   - the `pnpm verify` parts green;
   - `verify:engines --engine chrome53 --engine chrome68` if a TV-run page or the build changes;
   - the PR merged on green CI;
   - docs: RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook;
   - a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `61b5547` Merge PR #109 = main;
  - `3a15b72` docs (30c2b ticked, leg 88's row);
  - `502ffaf` Merge PR #108;
  - `7f7eb8d` the 30c2b feature commit.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/`: TV builds from 30c2b's code **before** its last take-out (a refused play's `archive.value = null`: no behaviour change; CI built and ran the final code), the lab, `dist/tv-vectors`;
  - `artifacts/`:
    - `mutate30c2b.py` and its logs (`mutate30c2b.log` 43/46, `-b.log` 2/2);
    - `unit-30c2b.log` (5,378), `build-30c2b.log`, `lint-30c2b.log`, `typecheck-30c2b.log`, `poly-count-30c2b.log` (222);
    - `engines-30c2b.log` (53+68, 18 as expected);
    - `screenshots/config-refused-{add,play}-{en,ar}.png`;
    - older legs' files.
- **Docker:** no `lablo-chrome*` container left; the `lablo-web` Postgres is down. No `next start` or Vite is left running.
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 88:**
- **A player screen with no stream before any play shows the page's white on the desktop.**
  - Why: `html[data-player='on']` makes the page transparent, and `#stage` is only made with the first controller.
  - The refused screen paints its own black (`player__blank`). 30c3's blocked stream at play needs the same.
  - It showed only in the Arabic screenshot (the English test had played first): look at every screenshot.
  - Memory `iptv-ui-test-gotchas`.
- **The controller's `play()` and `stop()` publish `opening`/`idle` synchronously.** `onStatus` therefore already clears a card on a new play, and cancels a waiting seek when the stream stops (the card shows). Code that does the same again in a caller is redundant: the mutation run found two such bits, now taken out.
- **Test traps:**
  - With no tracks, AUDIO then SUBTITLES closes the menu the first key opened: check after each key.
  - `data-plays` is the player's lifetime count; it isn't reset on close.
  - An onboarding title's name is bidi-isolated: compare it through `stripIsolates`.
- **The mock provider keeps no request log.** To prove nothing was fetched, check state (the profile's sources from IndexedDB), or the loader in a unit test.
- **Bash heredocs failed twice again:** a ~170-line `cat > patch.py <<'EOF'`, and a `\'` in a heredoc'd TS test name. Write test blocks and patch scripts with the Write tool. Memory `use-write-tool-for-doc-batches`.
- **The mutation run edits source files:** never commit, build or run e2e while it runs. Edits to test files during a run change later mutants' results, so close gaps after the run, then `--rerun`.

**From earlier legs (still true):**
- **Onboarding's first screen is a horizontal row** (RIGHT moves, LEFT in Arabic; DOWN does nothing).
- **The gate has its own navigator:** read it from the DOM (`[data-testid=gate]`).
- **The desktop dev app has no `minVersion`:** test the update screen in the built webOS bundle from `file://` (run `pnpm build:tv` first).
- **Run the tests before taking out "dead" code** (a negative slice start inside the list drops items). Memory `iptv-parser-test-patterns`.
- **A state machine's dispose test must go back through its idle state.**
- **The Write tool decodes `\u2066`:** use `stripIsolates` from `@lablo/core` in tests. Memory `write-tool-raw-unicode-escapes`.
- **apps/tv's `tsc` checks test files:** run `pnpm --dir "<wt>/apps/tv" exec tsc --noEmit -p tsconfig.json` before committing.
- **A worker the app starts on its own needs an "idle" signal the old-engine walk can wait for** (`configIdle()`, leg 86). Memory `iptv-old-engine-walk`.
- **A worker the app starts after the first paint needs its npm deps in `apps/tv/vite.config.ts` `optimizeDeps.include`.** Check with `vite --force` and count the main-frame navigations (1 is right).
- **Never open the app's IndexedDB from a test page before the app has.** Wait for `[data-testid="onboarding"][data-ready="true"]`.
- **A worker's failed fetch is not a page console error in Playwright.**
- **Polyfill names:**
  - a member named `flags` pulls `es.regexp.flags`, and `lastIndexOf` pulls an array polyfill;
  - avoid `concat` and regex `.test` in new TV code;
  - `normalize`, `toLowerCase`, `charCodeAt`, `fromCharCode` and `decodeURIComponent` pull nothing;
  - never use `URL` in TV code;
  - to find which file adds a core-js module, use `artifacts/babel-polys30b2.ts`;
  - `poly-count20c2a.py` overwrites `artifacts/corejs20c1-<platform>.txt`: copy the old list first if you want a diff.
- **CI runs Node 22; this PC runs Node 24.**
- **A manual clock races fake-indexeddb:** wait until the sleep is registered.
- **TaskStop on a background `next start` leaves it running:** `netstat -ano | grep ":3100 "`, then `Stop-Process`.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **zod on the TV:** `zod/mini` only; zod gets five core-js modules through `DEPENDENCY_POLYFILLS`.
- **`apps/tv/src/env.d.ts` must stay a global script.**
- **Root `test/` and `e2e/` files need the workspace package in the root `package.json` devDependencies.**
- **Overlap CI with the next step,** but never push while a PR's CI runs (a push cancels it). `gh pr edit` is not a push.
- **The media flake** (`epg-declared-300mb`) and the throttled search spec's throttle proof: one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:**
  1. after `gh pr create`, wait ~45 s (`timeout 45 tail -f /dev/null`), then `gh run list --commit <sha> --event pull_request`;
  2. start one Monitor running a `comm -13` loop over `gh run view <run> --json status,conclusion,jobs` (worked end to end in legs 87 and 88).
  - To see why a job failed: `gh api repos/Omarmarei/Lablo/actions/jobs/<job id>/logs`.
- **Python with `-I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit tests take about 6–9 s each.
- **The profile is at version 7** (optional fields since: `noticesShown`); **the IDB schema is at version 2** (`kv` holds the config).
- **TV code rules:**
  - no `Array.prototype.sort` in the TV main bundle;
  - none of these in TV app files: `Uint8Array`, `JSON.stringify`, `new RegExp`, iterator calls, array destructuring or spread, object spread in new files (JSX spread of a binding's `item()` is fine), or a member named `at` or `flags`;
  - the build can crash once (0xC0000005): run it again.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (`lablo-chrome*`).
- **A bare `sleep N; cmd` in Bash is blocked:** use an `until` loop, `timeout N tail -f /dev/null`, or a Monitor. There is no `jq` in Git Bash: use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>` (`--grep`/`--grep-invert` to pick tests);
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min), after a fresh `pnpm build:tv`;
  - `pnpm test` takes about 4 min (5,378 tests).
- **Local `pnpm verify` or `pnpm e2e` may die from low memory:** run the parts separately, in the foreground, or leave them to CI. In leg 88, nine related specs (40 tests, `--workers=3`) ran fine together.
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
- **Verified in leg 88 (30c2b):**
  - **Locally:**
    - lint, typecheck, unit 5,378;
    - `build:tv` (main 430.2 / 417.5 KB, 222 core-js modules);
    - `verify:engines --engine chrome53 --engine chrome68`: 18 as expected;
    - e2e: `config-modes.spec.ts` 3/3, plus onboarding, player, config-gate, config, auto-next, movie-resume, resume and live (40/40);
    - the four screenshots looked at (Arabic mirrored, the doc's Arabic text, black under the card).
  - **Mutation:** 43/46, then 2/2; one equivalent taken out.
  - **CI:** the first run all green (114 engine runs, 83 seeded failures caught; the full `pnpm e2e` 139 passed).
- **Not verified:**
  - the two modes on the old engines with a rule active: the walks get no kill rule, so the new checks run there and let everything through;
  - the two modes on a real TV;
  - AVPlay (Tizen) stopping under the card.
- **Migrations and deploys:** nothing new. Nothing is in production (Neon arrives with step 34 `[needs Omar]`), and nothing is deployed.

## Open decisions and gates
- **None for 30c3 beyond the leg's own calls** listed in step 3 (recorded in RELAY.md).
- **For step 31 (pairing):** if a phone can send sources to the TV, that path is a new way to add a source. It must read `addRefusal` (`block-new-sources`) and, after 30c3, the blocklist.
- **Step 34 `[needs Omar]`, including the config key ceremony** (runbook `config.md`):
  - Omar runs `pnpm sign-config keygen` twice on his own machine and keeps the seeds in his password manager and on paper;
  - he gives Claude the two public keys and signs the production config himself;
  - he creates the Vercel, Neon, R2 and Upstash accounts and the domain (`PRODUCTION_API_BASE`), and puts the keys in `.env` himself;
  - the first production migration and the first deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set;
  - about 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player.
  - Steps 24–28 can join that visit, along with whether the TV keyboards type into the search field, and now the gate's screens and the refusal card on the real set.
- **For step 32:** derive the backup master once, in a worker, with progress, and cache it. That worker also needs an idle signal for the walk.
- **For step 38 (parental):** every Home shelf, the search results, "Continue watching" and "Recent channels" hold adult items too: the lock must filter them.
- **For step 41 (the 2018 Samsung):** decoded poster memory, posters in lists on the low tier, the search's real time, the scrypt time.
- **Later (unchanged):**
  - search and Home: a kind filter and posters;
  - movies and shows extras;
  - player extras: fine HLS seeking, "start over", PLAY/PAUSE intents, PRE-CH on webOS, pre-buffered zapping;
  - the guide: a day jump and a Guide/Info key;
  - an on-screen keyboard if the TV keyboards fail;
  - step 38's settings rows;
  - dropping Chromium 53 (ADR-012);
  - a memory signal for the tier;
  - CI's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (step 30c2b is merged; on the PC, nothing to press on a TV yet)
1. In the repo, run `pnpm exec vitest run apps/tv/src/player/player-state.test.ts apps/tv/src/onboarding/onboarding-state.test.ts apps/tv/src/gate`: all pass (119 + 29 + 24).
2. `pnpm exec playwright test --project=chromium e2e/config-modes.spec.ts`: 3 passed. The screenshots are in `artifacts/screenshots/config-refused-*.png`.
3. Try it by hand with the real signer and backend:
   1. add to `config/config.json`'s `"kill"`: `{"id": "try-add", "match": {}, "mode": "block-new-sources", "message": {"en": "Adding sources is paused", "ar": "<any Arabic text>"}}`, then `pnpm sign-config sign --dev`;
   2. `pnpm web:dev` (the backend on port 3100) and `pnpm dev`; open `http://localhost:5173/` in a private window (no profile yet);
   3. go through onboarding (Enter on each screen) and fill an M3U link; press Enter on "Add source": "Couldn't add …" with "Adding sources is paused" shows at once, with "Edit details" and "Try again";
   4. take the rule out, sign again, run `window.__LABLO_TEST__.refreshConfig()` in the console, press RIGHT then Enter ("Try again"): the source loads;
   5. "Start watching", then put back a rule with `"mode": "disable-playback"`, sign, and press Enter on a channel. Then run `refreshConfig()` in the console: "Playback is turned off" shows over a black screen with "Channels"; Enter goes back to the list; Enter on another channel shows the card again;
   6. undo with `git checkout config/`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Forty-nine CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29–47: as listed in leg 86's handover (`git -C "<wt>" show 5fffb27:HANDOVER.md`, "Carry-forward reminders");
  - 48: the app's structure could name `apps/tv/src/gate/` (the config gate over every screen: its own root, navigator and capture key listener) and say a new full-screen state over the app goes through it;
  - 49 (new): any new way to add a source or to play must read the config's refusal (`refusalFor`: onboarding's and the player's `refusal` option), and any player state with no stream must paint its own black (`player__blank`).
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create, and he puts the keys in `.env` himself. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
