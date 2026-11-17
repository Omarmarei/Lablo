# Lablo IPTV: relay leg 86 opening prompt

You are leg 86 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–84 did steps 1–30b1 (PRs #1–#101). Three steps wait for Omar: step 16's Samsung part, 19b and 21. Step 29b2b (the Next.js bump) can start from 2026-11-17 18:02 UTC.
- **Leg 85 finished step 30b2** (the leg ran 09:05–10:25 UTC on 2026-11-17):
  - **Merged** as PR #102 (`adc2029`), green on the **first** CI run:
    - verify 11 m 10 s, including `pnpm e2e` (128 passed);
    - media 11 m 47 s;
    - engines 19 m 50 s (Chromium 53, 56 and 68);
    - `web` skipped by its path filter.
  - Its docs went in as PR #103 (`6c6e665`).
  - **What 30b2 built** (architecture.md §3.3 "Built in step 30b2"; runbook `docs/runbooks/config.md` "On the TV"). No UI yet: step 30c enforces the policy.
    - **The config worker** (`@lablo/data/config.worker`, `packages/data/src/config.worker.ts`, 133.7 KB of the 150 KB worker budget):
      - It serves `configHandlers({openDb, transport, clock?})` from `config-service.ts`. Its one method `run(req: ConfigRunRequest, ctx)` takes `{base, platform, version, keys: string[]}` (base64url keys).
      - It reads the cached copy and pushes its policy (event `cached`), then fetches `<base>/v1/config` and answers a `ConfigResult`.
      - A run without a key, or with a key that isn't 32 bytes, is refused before anything is read.
      - **A cached copy this build doesn't trust is now deleted** (`ConfigService.readCache`): a key rotated out, a dev-signed copy once production keys exist, a broken record. The query worker reads the blocklist from that same record without checking the signature again.
      - `ConfigService.refresh(request, onCached?)`.
    - **`packages/data/src/config-constants.ts`:**
      - `CONFIG_KEY`, `CONFIG_TIMEOUT_MS`, `CONFIG_REFRESH_MS` (6 h), `CONFIG_RETRY_MS` (30 min, new) and `CONFIG_MAX_BYTES` live here, so main and the query worker take none of the schemas.
      - `config-service.ts` re-exports them.
      - `@lablo/data/client` exports `noPolicy`, `policyStops`, `KILL_STRENGTH`, `CONFIG_REFRESH_MS`, `CONFIG_RETRY_MS`, the config types, `createConfigClient` and `ConfigClient`.
    - **The query worker:**
      - `blocked({urls})` returns `boolean[]`, and `reloadConfig()` returns the hash count.
      - They are built on `cachedBlocklist(record)` in `blocklist.ts`: `JSON.parse` of the record's `doc` text plus hand checks (a `field()` helper); anything broken gives an empty list.
      - The list is read when first asked and again at `reloadConfig`; a failed read is retried on the next call.
      - The query worker grew from 116.6 to 129.0 KB.
    - **The engine** (`apps/tv/src/data/engine.ts`):
      - `startConfigWorker` (in `workers.ts` too).
      - `refreshConfig(request, onCached?)`: a fresh worker per run, beside the refresh slot. It never starts the query worker; a running one gets `reloadConfig` afterwards, and a failure there is ignored.
      - `blocked(urls)`.
    - **The schedule** (`apps/tv/src/data/config-schedule.ts`, `createConfigSchedule({engine, request, afterPaint?, lifecycle?, now?, timers?})`):
      - `policy` (a signal, the defaults first), `last`, `start()`, `dispose()`.
      - The first run happens after the next paint (an animation frame, then a task). After that: 6 h after a `fresh` result, 30 min after anything else or a dead worker.
      - Hidden, a due run waits for `visible`/`relaunch`; a TV that slept past the due time runs as it wakes; one run at a time.
      - In `main.tsx`: `const config = createConfigSchedule({...})`, and `config.start()` right after `showLive`/`showOnboarding` in the default branch. The hello and gallery screens start none.
    - **The build constants** (root `tv-defines.config.ts`: `tvDefines(kind, root?)`, `defineValues`, `readConfigKeys`, `trustedConfigKeys`, `DEV_API_BASE`, `PRODUCTION_API_BASE = null`):
      - `__CONFIG_KEYS__`: a `package` (TV) build gets the production keys, or the dev key while there are none, never both; the `dev` app (Vite) gets both.
      - `__API_BASE__`: `http://127.0.0.1:3100` until step 34.
      - `__APP_VERSION__`.
      - `tools/build/src/bundle.ts` (`BundleOptions.defines`, default `tvDefines('package')`) and `apps/tv/vite.config.ts` use them; `env.d.ts` declares them.
      - Tizen's `<access origin="*">` already covers the API host, and webOS needs nothing.
    - **Vite `optimizeDeps.include`** now lists `zod/mini`, `tweetnacl` and the five `@noble/hashes` modules (see "Gotchas").
    - **The eslint entry-point rule** allows `src/config.worker.ts`, and `test/lint-boundaries.test.ts` covers it.
    - **Tests:**
      - unit 5,221 plus the gap fixes;
      - `test/config-worker-bundle.test.ts`: three Chromium 53 stand-in realms without BigInt, globalThis, the ES2017+ APIs or code generation;
      - the bundled query worker's `blocked`;
      - `test/realm-support.ts` (`pipe`, `CHROMIUM_53_MISSING`), shared by the bundle tests.
    - **Sizes:** main.js 417.7 / 405.0 KB (+2.0) and 222 core-js modules (+3: `es.regexp.flags`, pulled by the name `flags`).

## Read first
1. **`RELAY.md`:** Phase 8: **30b2's "Done in leg 85" block**, **30c's lines, including the new "What 30b2 left for it"**, 29b2b's lines; leg 85's progress-log row.
2. **`docs/architecture.md`:** §3.3 C, "Built in step 30a", "Built in step 30b1", **"Built in step 30b2"**.
3. **`docs/runbooks/config.md`** ("On the TV", updated), `docs/runbooks/web.md`.
4. **`CLAUDE.md`:** "Package boundaries", the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.
5. **For step 30c, read this code:**
   - `apps/tv/src/main.tsx` (the `config` schedule, `showLive`, `showOnboarding`, `showHello`);
   - `apps/tv/src/data/config-schedule.ts`, `engine.ts` (`blocked`), `params.ts` (`readDebugParams`, `readParam`: the pattern for `?api=`);
   - `apps/tv/src/test-hook.ts` (`installTestHook`: the place to expose the policy for e2e);
   - the onboarding source-add flow (`apps/tv/src/onboarding/`), the refresh scheduler (`refresh-scheduler.ts`), the player's play path (`apps/tv/src/player/`, `app-player.ts`, and on Tizen the redirect probe), `apps/tv/src/DataPanel.tsx` (the hello screen's rows);
   - `tools/engines/src/scenario.ts` (`STATE_EXPRESSION`, `PageState`, `isSettled`, `evaluateData`: where a config row would be checked);
   - `packages/ui` catalogs (en and ar texts);
   - `artifacts/live-config30b2.ts` (a stand-in backend on port 3100, signed with `configAnswer` from `packages/data/src/test-support.ts`: reuse it for the e2e server).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `6c6e665` (Merge PR #103) = main.
2. **Check the clock:** `date -u`.
   - **From 2026-11-17 18:02 UTC, step 29b2b** (small, its own PR) can go first:
     - the newest two-week-old 16.4 patch (16.4.5; 16.4.6 only from 2026-11-23 20:33 UTC), with `@next/swc-win32-x64-msvc` following;
     - dates: a tiny `npmdates.py` in the job's tmp folder (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`, the registry's `https://registry.npmjs.org/<name>` `time` field);
     - advisories: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`;
     - then `pnpm --dir "<wt>" web:db`, `test:web` 13/13, `build:web` (the agent nudge may stop it once: re-run), the SWC binding under Smart App Control; update `web.md`'s gotcha and RELAY.md; PR on green CI.
3. **Step 30c (enforcement): look for existing work first.** Run `git log --oneline -10` and grep `policyStops(`, `config.policy`, `blocked(`, `?api=`.
   - **Plan it, and split it if it is too big for one leg** (it probably is). Suggested split, with runnable "Done when" checks written into RELAY.md before building:
     - **30c1, the plumbing:**
       - the `?api=` debug parameter: honoured only in the dev app, or for a `127.0.0.1`/`localhost` base;
       - a `refreshNow()` on the schedule;
       - the policy in the test hook;
       - the hello screen's config row (the run's status and `blocked` for two URLs) checked by `verify:engines` on 53/68 against a config the harness serves (fresh, verified, one host blocked);
       - an e2e that a served dev-signed config reaches the app.
     - **30c2, the kill modes:**
       - `notice`: a dialog once per rule id, remembered;
       - `block-new-sources`: adding a source refused with the doc's message;
       - `disable-playback`: the player refuses;
       - `disable-app`: a full-screen message and nothing else;
       - the "update Lablo" screen below `minVersion`;
       - the texts in the en and ar catalogs, and the doc's own messages in the user's language.
     - **30c3, the blocklist checks:** at add (the API host), on refresh, before play (the stream host; on Tizen also the final host after the redirect probe).
   - **Done when** (RELAY 30c): unit tests per mode and per check; e2e with a dev-signed config served by the test (each mode; a blocked host at add, refresh and play; a kill rule arriving with a refresh takes effect without a restart); the hello config row on 53+68; en and ar screenshots looked at; a "press these keys" list for Omar; plus the common items.
4. **Step 26's common items still apply:** unit tests; a mutation run with the mutant list written first (`artifacts/mutate30b2.py` is the newest template, with a `--rerun` list); the `pnpm verify` parts green; `test:web` and `build:web` when `apps/web` changes; `verify:engines` if a TV-run page or the build changes; the PR merged on green CI; docs (RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook); a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `6c6e665` Merge PR #103 = main;
  - `b7e529c` the docs commit (30b2 ticked, leg 85's row);
  - `adc2029` Merge PR #102.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next` (from 30b1's code);
  - `dist/`: TV builds from 30b2's final code, the lab, `dist/tv-vectors`;
  - `artifacts/`:
    - `mutate30b2.py` and its logs (`mutate30b2.log` 78/83, `-b.log` 4/4);
    - `unit-30b2.log` (5,221), `build-30b2.log`, `lint-30b2.log`, `typecheck-30b2.log`, `e2e-30b2.log` (cut off by the memory kill);
    - `poly-count-30b2.log`, `babel-polys30b2.ts`, `size-config30b2.ts`, `live-config30b2.ts` and its log, `console-probe30b2.mjs`;
    - older legs' files.
- **Docker:** nothing started in leg 85 (the `lablo-web` Postgres is down; no `lablo-chrome*` container). No `next start`, no Vite left running (ports 3100, 5391 and 5399 are free).
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 85:**
- **A worker the app starts after the first paint needs its npm deps in `apps/tv/vite.config.ts` `optimizeDeps.include`.** Without them, a cold Vite cache (as in CI) reloaded the app mid-run when the config worker started.
  - Check a new worker with `vite --force` (a cold cache without deleting anything in node_modules).
  - Count main-frame `framenavigated` events: 1 is right.
  - Memory `iptv-ui-test-gotchas`.
- **Never open the app's IndexedDB from a test page before the app has.** `indexedDB.open('lablo')` creates an empty version-1 database, and the app's open then skips migration 0→1 (no `kv` store). Wait for `[data-testid="onboarding"][data-ready="true"]`: the boot spinner has the same test id with `data-ready="false"`.
- **A worker's failed fetch is not a page console error in Playwright** (a page's own failed fetch is). The app's config fetch to a missing backend on 3100 leaves the e2e error trackers quiet, and the engines harness ignores network errors.
- **A member named `flags` pulls `es.regexp.flags`**, and a re-export keeps that polyfill even when the code is tree-shaken.
  - To find which file adds a core-js module, run Babel on each touched file: `artifacts/babel-polys30b2.ts`.
  - `poly-count20c2a.py` overwrites `artifacts/corejs20c1-<platform>.txt`: copy the old list first if you want a diff.
- **The bundled query worker needs `TextEncoder`** (the blocklist hash's UTF-8). Chromium 53 has it in workers, and realm tests must provide it.
- **The lab's main.js inlines the config worker too** (it uses `createAppDataEngine`). The lab's own code is unchanged; the file is larger.
- **`pnpm e2e` in the background was reaped by Claude Code for low memory** (93 passed). The note says not to restart it unasked, so CI's `verify` (which runs `pnpm e2e`) and `engines` jobs were the gate. Record that honestly. Memory `bg-watcher-memory-reap`.
- **The mutation script prints a mutant's new text**, so two mutants with the same new text look alike. Go by the printed position (#60 looked like the `unsubscribe = null` mutant, but was dispose's `clearTimer()`).
- **A Bash-heredoc Python patch turned `'\n'` into a real newline again** (in `live-config30b2.ts`). Write patch scripts with the Write tool, and use `String.fromCharCode(10)` in TS.

**From earlier legs (still true):**
- **CI runs Node 22; this PC runs Node 24.** `url.domainToASCII` uses Ada's tables, so Node is not an oracle for IDNA (or Intl) without a behaviour gate.
- **A manual clock races fake-indexeddb:** wait until the sleep is registered before advancing.
- **Polyfill names:**
  - `lastIndexOf` pulls an array polyfill even on a string;
  - `normalize`, `toLowerCase`, `charCodeAt`, `fromCharCode` and `decodeURIComponent` pull nothing;
  - never use `URL` in TV code.
- **`fromBase64Url` returns `null`** for a bad value, including a non-string; it never throws.
- **TaskStop on a background `pnpm --filter @lablo/web start` leaves `next start` running:** `netstat -ano | grep ":3100 "`, then `Stop-Process` the pid.
- **Windows Smart App Control blocks rollup's native module.** Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Babel's by-name polyfills vs zod:** `DEPENDENCY_POLYFILLS` gives zod five core-js modules. **`zod/mini` never generates code**; never import classic `zod` in TV code.
- **noble on Chromium 53** needs core-js's `es.global-this`. scrypt N=2^15 takes about 1 s on 53, about 3 s on 56, and 0.1 s on 68.
- **The crypto vectors:** regenerate with `pnpm exec tsx packages/crypto/test/make-vectors.ts --write`, then rebuild `dist/tv-vectors` (`pnpm exec tsx tools/build/build-tv.ts --target vectors`).
- **`apps/tv/src/env.d.ts` must stay a global script.**
- **Root `test/` and `e2e/` files need the workspace package in the root `package.json` devDependencies.**
- **The Write tool decodes `\u`-escapes:** build non-ASCII text from char codes.
- **Vitest's `globalSetup` resolves bare imports from the root.**
- **Prisma 7:** the URL is in `apps/web/prisma.config.ts`.
- **Overlap CI with the next step,** but never push while a PR's CI runs (a push cancels it).
- **The media flake** (`epg-declared-300mb`): one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:**
  1. after `gh pr create`, find the run with `gh run list --commit <sha> --event pull_request`;
  2. start one Monitor running a `comm -13` loop over `gh run view <run> --json status,conclusion,jobs`. It prints each finished job and ends with the run (it worked in leg 85).
- **Python with `-I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit tests take about 6–9 s each, bundle tests about 15 s. Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going.
- **The profile is at version 7; the IDB schema is at version 2** (`kv` holds the config).
- **TV code rules:**
  - no `Array.prototype.sort` in the TV main bundle;
  - none of these in TV app files: `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls, array destructuring or spread, or a member named `at` or `flags`;
  - the build can crash once (0xC0000005): run it again.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (`lablo-chrome*`).
- **A bare `sleep N; cmd` in Bash is blocked:** use an `until` loop, `timeout 5 tail -f /dev/null`, or a Monitor. **There is no `jq` in Git Bash:** use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min, after a fresh `pnpm build:tv`);
  - `pnpm test` takes about 3–5 min (5,221 tests).
- **Local `pnpm verify` or `pnpm e2e` may die from low memory:** run the parts separately, in the foreground, or leave them to CI.
- **Code rules:** `packages/ui` components stay hook-free; UI text comes only from the catalogs; physical CSS only, no CSS Grid or flex `gap`; TV code is ES2017; dependencies at least 2 weeks old; never weaken lint (adding a legitimate worker entry point isn't weakening); scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, path-filtered (`web` includes `packages/(protocol|crypto)/` and `config/`);
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data; README.md stays "# Lablo";
  - **no production signing seed ever enters the repo, a chat or CI.**
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 85 (30b2):**
  - **Locally:**
    - lint, typecheck, unit 5,221, then the 525 tests in the touched files after the gap fixes;
    - `build:tv`: main 417.7 / 405.0 KB; the config worker 133.7, the query worker 129.0, ingest 129.3 and EPG 117.2 KB; 222 core-js modules;
    - a live check: a stand-in backend on port 3100, the dev app on a cold Vite cache, and the built webOS bundle from file://. Each loaded once, verified the dev-signed config, and kept it in IndexedDB about 3.5 s after the screen was ready, with no console error.
  - **Mutation:** 83 written first, 78 caught; 1 equivalent taken out of the code; 4 test gaps closed (rerun 4/4).
  - **CI:** all green on the first run, including `pnpm e2e` (128) and the engines on Chromium 53, 56 and 68.
- **Not run locally:** the full `pnpm e2e` (stopped by the memory reaper after 93 passes) and `verify:engines` (not started on a short-memory PC). CI ran both green.
- **Not yet proven on the real old engines:** the config worker itself. No harness page starts it yet; 30c's hello row will add that. Until then, the realm test and the vectors page (Ed25519 and zod on 53/56/68) stand for it.
- **Migrations and deploys:** nothing new. Nothing in production (Neon arrives with step 34 `[needs Omar]`). Nothing deployed. Profile still at version 7, IDB schema still at version 2.

## Open decisions and gates
- **None for 30c's shape.** Splitting it is the leg's call; record it in RELAY.md.
- **Step 34 `[needs Omar]`, including the config key ceremony** (runbook `config.md`):
  - Omar runs `pnpm sign-config keygen` twice on his own machine and keeps the seeds in his password manager and on paper;
  - he gives Claude the two public keys and signs the production config himself;
  - plus the Vercel, Neon, R2 and Upstash accounts and the domain (which sets `PRODUCTION_API_BASE` in `tv-defines.config.ts`), and the `.env` keys (including a rate-key secret of at least 32 characters);
  - the first production migration and deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player. Steps 24–28 can join that visit, along with whether the TV keyboards type into the search field. The vectors page could run on the TV to time scrypt and zod.
- **For step 32:** derive the backup master once, in a worker, with progress, and cache it (scrypt takes about 3 s on Chromium 56).
- **For step 38 (parental):** every Home shelf, the search results, "Continue watching" and "Recent channels" hold adult items too: the lock must filter them.
- **For step 41 (the 2018 Samsung):** decoded poster memory, posters in lists on the low tier, the search's real time, the scrypt time.
- **Later (unchanged):**
  - search and Home: a kind filter, posters in the search rows, Home and the search on the old-engine walk;
  - movies and shows: a show finished to its last episode coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start" for an episode;
  - player: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents, webOS's PRE-CH, pre-buffered zapping;
  - guide: a day jump; a Guide or Info key;
  - input and accessibility: an on-screen keyboard if the TV keyboards fail;
  - settings and old engines: step 38's settings rows; dropping Chromium 53 (ADR-012);
  - low tier: a memory signal for the tier;
  - CI: the media flake's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (step 30b2 is merged; nothing to press on a TV yet)
1. In the repo: `pnpm exec vitest run apps/tv/src/data/config-schedule.test.ts packages/data/src/query-blocked.test.ts test/config-worker-bundle.test.ts`. You should see 16 + 5 + 1 tests pass.
2. Optional, live: `pnpm exec tsx artifacts/live-config30b2.ts` (port 3100 must be free). Both lines should show `copy {"country":"AE",…}`, `page loads 1` and `errors []`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Forty-six CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description;
  - 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid";
  - 32: the commands table could add the one-engine and one-throttled-spec commands;
  - 33: its "Repo: private `Omarmarei/Lablo`" line (public since 2026-11-05);
  - 34: the header (now Guide, Movies, Series, Home, and the Search and Settings icons);
  - 35: the commands table needs the backend's rows (`web:db`, `web:db:down`, `web:dev`, `build:web`, `test:web`, `verify:web`), and the Definition of done's item 1 needs `pnpm verify:web` for backend changes;
  - 36: the "Package boundaries" row for `apps/web` could name the lint block (`NO_OUTBOUND_RULES`, its tests exempt);
  - 37: its Definition of done's item 3 says "N/A until the backend exists (step 29)". Since 29a: local and CI migrations exist; Neon from step 34;
  - 38: the `pnpm build:tv` row: it also builds the vectors page (`dist/tv-vectors`), and `verify:engines` runs it;
  - 39: "Package boundaries": `crypto` has a second entry point, `@lablo/crypto/check-vectors` (tests and the vectors page only);
  - 40: "Package boundaries": `protocol` likewise has `@lablo/protocol/check-samples`;
  - 41: the Chromium 53 cheat sheet could say "TV code uses `zod/mini`, never classic `zod`; a new dependency with modern code gets a polyfill allowlist (`DEPENDENCY_POLYFILLS`) or none (`POLYFILL_FREE_DEPENDENCIES`)";
  - 42: the commands table could add `pnpm sign-config` (keygen, pubkey, sign, verify, block, unblock; runbook `config.md`);
  - 43: the legal guardrails could add "no production config-signing seed in the repo, a chat or CI (`keygen` refuses the repo; Omar signs)";
  - 44: the Chromium 53 cheat sheet could add "no `URL` in TV code (core-js's URL polyfill is about 25 KB) and no `lastIndexOf` (it pulls an array polyfill)";
  - 45: the test notes could say "CI runs Node 22, this PC Node 24: a test that uses Node as an oracle (IDNA, Intl) must not depend on Node 24's tables";
  - 46 (new): "Package boundaries": `data` has a fourth worker entry, `@lablo/data/config.worker`; the build constants live in root `tv-defines.config.ts` (`__API_BASE__`, `__APP_VERSION__`, `__CONFIG_KEYS__`); a new post-paint worker's npm deps go in Vite's `optimizeDeps.include`.
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create, and he puts the keys in `.env` himself. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
