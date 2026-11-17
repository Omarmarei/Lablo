# Lablo IPTV: relay leg 87 opening prompt

You are leg 87 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–85 did steps 1–30b2 (PRs #1–#103). Three steps wait for Omar: step 16's Samsung part, 19b and 21. Step 29b2b (the Next.js bump) can start from 2026-11-17 18:02 UTC.
- **Leg 86 split step 30c and finished 30c1** (the leg ran 10:12–11:45 UTC on 2026-11-17).
  - **The split** (RELAY.md, under 30c):
    - 30c1: the plumbing (done);
    - 30c2: the kill modes and the "update Lablo" screen;
    - 30c3: the blocklist checks at add, refresh and play.
  - **Merged** as PR #104 (`44baff9`), green on the **second** CI run:
    - verify 11 m 9 s (its `pnpm e2e` all passed);
    - media 10 m 45 s;
    - engines 19 m 28 s: all 114 runs as expected on Chromium 53, 56 and 68, 83 seeded failures caught;
    - `web` skipped by its path filter.
  - Its docs went in as PR #105 (`efdfd70`).
  - **What 30c1 built** (architecture.md §3.3 "Built in step 30c1"; runbooks `config.md` "On the TV" and `old-engines.md` item 4 and Troubleshooting). Nothing is enforced yet.
    - **`?api=<origin>`** (`apps/tv/src/data/params.ts` `readApiBase(search, fallback, devApp)`): the config request's base for one run, read before `source`.
      - Only `http(s)://host[:port]` is taken; one trailing slash is dropped.
      - Any origin in the desktop dev app (`__PLATFORM__ === 'browser'`); only `127.0.0.1`, `localhost` or `[::1]` in a TV build.
      - main.tsx builds one `configRequest` and gives it to the schedule and to the hello screen.
      - Also new: `readParams(head, name)` (every value of a name) and `readChecks(search)` (`?check=<url>`, repeatable).
    - **`ConfigSchedule.refreshNow()`**: a run now, or right after the one in progress.
      - Calls made during a run share one more run, and the schedule counts from its end.
      - It resolves `null` when the worker died, before `start()`, and after `dispose()` (a dispose also settles the calls still waiting).
      - The first-paint run is skipped if a `refreshNow` has already run.
    - **`ConfigSchedule.idle()`**: no run in progress, and none due from `start()`.
    - **The test hook** (`window.__LABLO_TEST__`, `apps/tv/src/test-hook.ts`; typed in `env.d.ts` and `e2e/lablo-test.d.ts`):
      - `config()`: the last answer as plain data (`ConfigView`: status, failure, issuedAt, the kill rule's id and mode, the notices' ids, updateRequired; no texts);
      - `refreshConfig()`: `refreshNow`;
      - `configIdle()`.
      - `installTestHook(window, config)` now takes the schedule.
    - **The hello screen's config rows** (`apps/tv/src/hello-config.ts`, pure: `describeConfig`, `describeBlocked`; `DataPanel.tsx`): one config run, then `blocked` for the `?check=` URLs.
      - `config-status` carries `data-status`, `data-failure`, `data-kill` and `data-notices`.
      - `blocked-status` carries `data-blocked="true,false"`.
      - The hello screen still starts no schedule.
    - **The old-engine harness serves a config** (`tools/engines/src/config.ts`):
      - It writes `v1-config.json`, a dev-signed answer with one notice (`harness-notice`) and two blocked hosts: `blocked.lablo.test`, and `مثال.lablo.test` blocked as `xn--mgbh0fb.lablo.test`.
      - `serve-fixture.sh` maps `GET /v1/config` to that file.
      - The hello URL carries `api=` the fixture origin and three `check=` URLs.
      - `evaluateConfig` (scenario.ts) expects `fresh`, the notice and `true,true,false` while `config/keys.json` has no production keys; after that, `none`/`bad-signature` and nothing blocked.
      - **This was the config worker's first run on the real old engines: green on 53, 56 and 68.**
    - **The walk waits for the config run** (`tools/engines/src/onboarding.ts`: `CONFIG_IDLE`, `untilConfigIdle`, at most 10 s) before a relaunch and before `resetDatabase`. The stuck-focus seed passes `configIdle` through. See "Gotchas" for why.
    - **`e2e/config.spec.ts`** (a `node:http` server on 127.0.0.1, signed with `devSignedAnswer` and `harnessConfigDoc` from `tools/engines/src/config.ts`) covers:
      - a served config reaching the app;
      - a kill rule arriving through `refreshConfig()` with no restart;
      - an older replay refused (`cached`/`older`);
      - the hello rows;
      - a forged copy refused (`bad-signature`).
    - **Tests:** unit 5,285 (+60). Mutation: `artifacts/mutate30c1.py`, 82 written first, 81 caught, then the rerun 1/1, plus 12/12 for the idle signal (`--idle`).
    - **Sizes:** main.js 420.9 / 408.2 KB (+3.2), 222 core-js modules (unchanged), workers unchanged.

## Read first
1. **`RELAY.md`:** Phase 8, 30c's split; **30c1's "Done in leg 86"**; **30c2's and 30c3's lines and "Done when"**; 29b2b's lines; leg 86's progress-log row.
2. **`docs/architecture.md`:** §3.3 C; "Built in step 30b1"; "Built in step 30b2"; **"Built in step 30c1"**.
3. **`docs/runbooks/config.md`:** "On the TV", which now covers `?api=`, the hook and the hello rows.
4. **`CLAUDE.md`:** "Package boundaries", the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.
5. **Code for step 30c2:**
   - `apps/tv/src/main.tsx`: `config` (the schedule: `config.policy` is a signal), `showLive`, `showOnboarding`, `playerController`, `refreshes`;
   - `packages/data/src/config-policy.ts`: `ConfigPolicy`, `policyStops(policy, mode)`, `PolicyRule.message` `{en, ar} | null`;
   - `packages/ui/src/components/Dialog.tsx`, used by `apps/tv/src/guide/ProgrammeDialog.tsx`, SettingsScreen and the exit dialog in LiveApp;
   - the catalogs in `apps/tv/src/i18n/en.ts` and `ar.ts`;
   - onboarding's add (`apps/tv/src/onboarding/onboarding-state.ts`, `engine-loader.ts`, `OnboardingApp.tsx`);
   - the player's entry points (`apps/tv/src/player/player-state.ts`: `show`, `catchup`, `resume`, `playMovie`, around line 1157; `app-player.ts`);
   - the profile edits (`answerEdit` in `onboarding/start.ts`; `memory` in main.tsx), for the notices already shown;
   - `e2e/config.spec.ts`: `startConfigServer` and `doc()` to reuse.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `efdfd70` (Merge PR #105) = main.
2. **Check the clock** with `date -u`.
   - **From 2026-11-17 18:02 UTC, step 29b2b** (small, its own PR) can go first:
     - bump to 16.4.5 (16.4.6 only from 2026-11-23 20:33 UTC), with `@next/swc-win32-x64-msvc` following;
     - publish dates: a tiny `npmdates.py` in the job's tmp folder (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`), reading the `time` field of `https://registry.npmjs.org/<name>`;
     - advisories: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`;
     - then `pnpm --dir "<wt>" web:db`, `test:web` 13/13 and `build:web` (the agent nudge may stop it once: run it again), with the SWC binding loading under Smart App Control;
     - update `web.md`'s gotcha and RELAY.md; open the PR and merge on green CI.
3. **Step 30c2 (the kill modes and the update screen).** First look for existing work: `git log --oneline -10`, then grep `policyStops(` and `config.policy` in `apps/`.
   - **Plan it, and split it further if it is too big for one leg.** A natural cut: 30c2a for `disable-app`, the update screen and `notice`; 30c2b for `block-new-sources` and `disable-playback`. Write the runnable "Done when" checks into RELAY.md before building.
   - **Each mode takes effect when the policy signal changes** (a refresh brings it), with no restart:
     - `notice`: a dialog once per rule id, with the ids already shown kept in the profile (a profile change bumps its version and its pins; memory `iptv-data-layer-test-gotchas`, leg 73);
     - `block-new-sources`: onboarding's add is refused with the doc's message in the UI language, or the app's own catalog text;
     - `disable-playback`: the player refuses with the message, including a channel already playing;
     - `disable-app`: a full-screen message and nothing else. Stop the player and the refreshes; only Back/Exit respond;
     - below `minVersion`, an "update Lablo" screen (`updateRequired`).
   - **e2e:** `startConfigServer`, then `?api=`, then `window.__LABLO_TEST__.refreshConfig()` to bring a rule in mid-run.
   - **Screenshots:** en and ar, looked at.
   - **A "press these keys" list for Omar.**
   - **Texts:** in both catalogs, and the doc's own messages picked by the UI language.
4. **Step 30c3 (the blocklist checks),** after 30c2: through `DataEngine.blocked(urls)` at add (the API host), on refresh (a blocked source isn't refreshed, and says so) and before play (the stream host; on Tizen also the final host after the redirect probe).
5. **Step 26's common items still apply to each:**
   - unit tests;
   - a mutation run with the mutant list written first (`artifacts/mutate30c1.py` is the newest template, with `--rerun` and `--idle` filters; read the earlier step's docstring for code it took out);
   - the `pnpm verify` parts green;
   - `verify:engines` if a TV-run page or the build changes;
   - the PR merged on green CI;
   - docs: RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook;
   - a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `efdfd70` Merge PR #105 = main;
  - `636ce99` docs (30c1 ticked, leg 86's row);
  - `44baff9` Merge PR #104.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/`: TV builds from 30c1's final code, the lab, `dist/tv-vectors`;
  - `artifacts/`:
    - `mutate30c1.py` and its logs (`mutate30c1.log` 81/82, `-b.log` 1/1, `-c.log` 12/12);
    - `unit-30c1.log` (5,285), `build-30c1.log`, `lint-30c1.log`, `typecheck-30c1.log`;
    - `engines-30c1.log` (53+68, 18 as expected) and `engines-30c1-b.log` (53 after the idle fix, 9 as expected);
    - `e2e-config-30c1.log` (3/3), `e2e-hello-30c1.log` (17/17), `poly-count-30c1.log` (222);
    - `artifacts/engines/` (the last local harness report);
    - older legs' files.
- **Docker:** no `lablo-chrome*` container left. The image `lablo-old-engines:` now has a new tag, because `serve-fixture.sh` changed; it is built locally. The `lablo-web` Postgres is down. No `next start` or Vite is left running (ports 3100, 5391, 5399 and 8090 are free).
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 86:**
- **A worker the app starts on its own needs an "idle" signal the old-engine walk can wait for.**
  - What happened: CI's Chromium 53 stalled every later database delete (`could not be deleted … (pending)` on every run after one). Each later run then waited out its timeouts (60 s walks, 140 s for the lab), and the engines job hit its 25-minute limit.
  - The trigger: `seed-walk-forgets-profile` ends right after a relaunch that shows onboarding, while the config worker (started after the first paint since 30b2) was in IndexedDB. It passed locally and on 30b2's CI: it is a race.
  - The fix: `configIdle()` plus `untilConfigIdle`. Any new self-starting worker (telemetry, backup in steps 32–33) needs the same.
  - Memory `iptv-old-engine-walk`.
- **The throttled search spec's throttle proof flaked:** 1.6x measured, more than 2x needed, with every budget met. It passed on the next run. Memory `iptv-throttled-e2e`.
- **Read the previous step's `mutate*.py` docstring before changing the same code.** This leg put back a `clearTimer()` that leg 85 had removed as redundant, and noticed only while writing its own mutant list.
- **A Bash heredoc lost a backslash in a Python `\\n` again.** Write patch scripts with the Write tool, and use `chr(10)` and `chr(92)` in them.
- **Claude Code reaped a background CI waiter (an until-loop) for low memory.** Use exactly one Monitor per CI run and never start a second waiter. Checking once in the foreground is fine.
- **archive.debian.org was fast on CI today** (the image's apt layer took about 10 s). Editing `serve-fixture.sh` locally rebuilt only the last layer, in seconds.
- **`describeConfig`'s branch keys on `issuedAt === null`.** A result has no `issuedAt` exactly when its status is `none`, so checking the status as well was dead code.

**From earlier legs (still true):**
- **A worker the app starts after the first paint needs its npm deps in `apps/tv/vite.config.ts` `optimizeDeps.include`.** Check with `vite --force` and count the main-frame navigations (1 is right).
- **Never open the app's IndexedDB from a test page before the app has.** Wait for `[data-testid="onboarding"][data-ready="true"]`.
- **A worker's failed fetch is not a page console error in Playwright.**
- **Polyfill names:**
  - a member named `flags` pulls `es.regexp.flags`, and `lastIndexOf` pulls an array polyfill;
  - `normalize`, `toLowerCase`, `charCodeAt`, `fromCharCode` and `decodeURIComponent` pull nothing;
  - never use `URL` in TV code;
  - to find which file adds a core-js module, use `artifacts/babel-polys30b2.ts`;
  - `poly-count20c2a.py` overwrites `artifacts/corejs20c1-<platform>.txt`: copy the old list first if you want a diff.
- **CI runs Node 22; this PC runs Node 24.** `url.domainToASCII` is not an oracle without a behaviour gate.
- **A manual clock races fake-indexeddb:** wait until the sleep is registered.
- **`fromBase64Url` returns `null`** for a bad value; it never throws.
- **TaskStop on a background `next start` leaves it running:** `netstat -ano | grep ":3100 "`, then `Stop-Process`.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **zod on the TV:** `zod/mini` only; zod gets five core-js modules through `DEPENDENCY_POLYFILLS`.
- **noble on Chromium 53** needs `es.global-this`. scrypt N=2^15 takes about 1 s on 53, about 3 s on 56.
- **The crypto vectors:** `pnpm exec tsx packages/crypto/test/make-vectors.ts --write`, then rebuild `dist/tv-vectors`.
- **`apps/tv/src/env.d.ts` must stay a global script.** Write the hook's types out there; it can't import.
- **Root `test/` and `e2e/` files need the workspace package in the root `package.json` devDependencies.**
- **The Write tool decodes `\u`-escapes:** build non-ASCII text from char codes.
- **Overlap CI with the next step,** but never push while a PR's CI runs (a push cancels it). `gh pr edit` is not a push.
- **The media flake** (`epg-declared-300mb`): one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:**
  1. after `gh pr create`, find the run with `gh run list --commit <sha> --event pull_request`;
  2. start one Monitor running a `comm -13` loop over `gh run view <run> --json status,conclusion,jobs`.
  - To see why a job failed: `gh api repos/Omarmarei/Lablo/actions/jobs/<job id>/logs`.
- **Python with `-I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit tests take about 6–9 s each. Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going. Vite serves the mutated files too, so never run e2e during a mutation run.
- **The profile is at version 7; the IDB schema is at version 2** (`kv` holds the config).
- **TV code rules:**
  - no `Array.prototype.sort` in the TV main bundle;
  - none of these in TV app files: `Uint8Array`, `JSON.stringify`, `new RegExp`, iterator calls, array destructuring or spread, object spread in new files, or a member named `at` or `flags`;
  - the build can crash once (0xC0000005): run it again.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (`lablo-chrome*`).
- **A bare `sleep N; cmd` in Bash is blocked:** use an `until` loop, `timeout 5 tail -f /dev/null`, or a Monitor. There is no `jq` in Git Bash: use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53` (about 4 min locally; 53 and 68 together about 6 min), after a fresh `pnpm build:tv`. There is no variant filter: `--self-test` runs every seed (CI's job);
  - `pnpm test` takes about 4 min (5,285 tests).
- **Local `pnpm verify` or `pnpm e2e` may die from low memory:** run the parts separately, in the foreground, or leave them to CI.
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
- **Verified in leg 86 (30c1):**
  - **Locally:**
    - lint, typecheck, unit 5,285;
    - `build:tv`: main 420.9 / 408.2 KB; the workers unchanged; 222 core-js modules;
    - `verify:engines --engine chrome53 --engine chrome68`: 18 as expected (the hello rows `config fresh, blocked true,true,false` on both platforms). After the idle fix, `--engine chrome53`: 9 as expected;
    - e2e `config.spec.ts` 3/3; `hello.spec.ts` and `tv-bundle.spec.ts` 17/17.
  - **Mutation:** 81/82, then 1/1, plus 12/12.
  - **CI:** the second run all green (114 engine runs, 83 seeded failures caught; the full `pnpm e2e`).
- **Not run locally:** the full `pnpm e2e` and `--self-test`. CI ran both green.
- **Migrations and deploys:** nothing new. Nothing is in production (Neon arrives with step 34 `[needs Omar]`), nothing is deployed, the profile is still at version 7 and the IDB schema at version 2.

## Open decisions and gates
- **None for 30c2's shape.** Splitting it further is the leg's call; record it in RELAY.md.
- **Step 34 `[needs Omar]`, including the config key ceremony** (runbook `config.md`):
  - Omar runs `pnpm sign-config keygen` twice on his own machine and keeps the seeds in his password manager and on paper;
  - he gives Claude the two public keys and signs the production config himself;
  - plus the Vercel, Neon, R2 and Upstash accounts, the domain (`PRODUCTION_API_BASE`) and the `.env` keys;
  - the first production migration and deploy each need his one-word OK.
  - **Once production keys exist,** the harness expects the dev-signed copy refused (`configCheck(false)`), and the dev app still trusts both keys.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set;
  - about 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player. Steps 24–28 can join that visit, along with whether the TV keyboards type into the search field.
- **For step 32:** derive the backup master once, in a worker, with progress, and cache it. That worker also needs an idle signal for the walk (see the leg-86 gotcha).
- **For step 38 (parental):** every Home shelf, the search results, "Continue watching" and "Recent channels" hold adult items too: the lock must filter them.
- **For step 41 (the 2018 Samsung):** decoded poster memory, posters in lists on the low tier, the search's real time, the scrypt time.
- **Later (unchanged):**
  - search and Home: a kind filter, posters in the search rows, Home and the search on the old-engine walk;
  - movies and shows: a finished show coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start";
  - player: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents, webOS's PRE-CH, pre-buffered zapping;
  - guide: a day jump; a Guide or Info key;
  - input: an on-screen keyboard if the TV keyboards fail;
  - settings and old engines: step 38's settings rows; dropping Chromium 53 (ADR-012);
  - low tier: a memory signal for the tier;
  - CI: the media flake's single-sample budgets, and the throttled search spec's single-sample throttle proof.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (step 30c1 is merged; nothing to press on a TV yet)
1. In the repo, run `pnpm exec vitest run apps/tv/src/data/params.test.ts apps/tv/src/data/config-schedule.test.ts apps/tv/src/test-hook.test.ts apps/tv/src/hello-config.test.ts`. You should see 54 + 27 + 6 + 5 tests pass.
2. `pnpm exec playwright test --project=chromium e2e/config.spec.ts`: 3 passed.
3. Optional, in a browser:
   1. run `pnpm dev`;
   2. open `http://localhost:5173/?screen=hello&api=http://127.0.0.1:3100&check=http://example.com/` with the backend on 3100 (`pnpm --filter @lablo/web start`);
   3. the "Config" row reads `ok: fresh, …` and the "Blocklist" row reads `ok: allowed`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Forty-seven CLAUDE.md gaps** are waiting for his word:
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
  - 39: "Package boundaries": `crypto` has a second entry point, `@lablo/crypto/check-vectors`;
  - 40: "Package boundaries": `protocol` likewise has `@lablo/protocol/check-samples`;
  - 41: the Chromium 53 cheat sheet could say "TV code uses `zod/mini`, never classic `zod`; a new dependency with modern code gets a polyfill allowlist (`DEPENDENCY_POLYFILLS`) or none (`POLYFILL_FREE_DEPENDENCIES`)";
  - 42: the commands table could add `pnpm sign-config` (keygen, pubkey, sign, verify, block, unblock; runbook `config.md`);
  - 43: the legal guardrails could add "no production config-signing seed in the repo, a chat or CI";
  - 44: the Chromium 53 cheat sheet could add "no `URL` in TV code and no `lastIndexOf`";
  - 45: the test notes could say "CI runs Node 22, this PC Node 24: a test that uses Node as an oracle must not depend on Node 24's tables";
  - 46: "Package boundaries": `data` has a fourth worker entry, `@lablo/data/config.worker`; the build constants live in root `tv-defines.config.ts`; a new post-paint worker's npm deps go in Vite's `optimizeDeps.include`;
  - 47 (new): the debug parameters could list `?api=<origin>` (loopback only in a TV build) and `?check=<url>`, and the test hook's `config()`, `refreshConfig()` and `configIdle()`. A worker the app starts on its own needs an idle signal for the old-engine walk.
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create, and he puts the keys in `.env` himself. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
