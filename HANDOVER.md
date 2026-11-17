# Lablo IPTV: relay leg 88 opening prompt

You are leg 88 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–86 did steps 1–30c1 (PRs #1–#105). Three steps wait for Omar: step 16's Samsung part, 19b and 21. Step 29b2b (the Next.js bump) can start from 2026-11-17 18:02 UTC.
- **Leg 87 split step 30c2 and finished 30c2a** (the leg ran 11:46–12:40 UTC on 2026-11-17).
  - **The split** (RELAY.md, under 30c2):
    - 30c2a: the config gate over the whole app: `disable-app`, the "update Lablo" screen, the notices (done);
    - 30c2b: `block-new-sources` and `disable-playback`, inside onboarding and the player (next).
  - **Merged** as PR #106 (`ef641d1`), green on the **first** CI run:
    - verify 13 m 54 s (its `pnpm e2e` 136 passed);
    - media 10 m 45 s;
    - engines 18 m 27 s: all 114 runs as expected on Chromium 53, 56 and 68, 83 seeded failures caught;
    - `web` skipped by its path filter.
  - Its docs went in as PR #107 (`40c1aae`).
  - **What 30c2a built** (architecture.md §3.3 "Built in step 30c2a"; runbook `config.md` "What the TV shows"):
    - **`apps/tv/src/gate/gate-state.ts`:**
      - `gateView(policy, shown, version)` (pure): `disable-app` first (`{kind: 'disabled', id, message}`), then `updateRequired` (`{kind: 'update', version, minVersion}`), then the first notice with a message not in `shown`, in the doc's order (`{kind: 'notice', id, message}`); a notice without a message never shows;
      - `stopsApp(view)`, `messageIn(message, language)` (the doc's `{en, ar}` in the UI language: Arabic for `ar`, English for anything else), `noticesShownOf(profile)`;
      - `createGate({policy, version, platform, target, shown, stopped, release?})`: its own navigator (one button, zone `buttons`; screen id = the view's kind, root `none`); while a view shows, a **capture** keydown listener on the window calls `stopImmediatePropagation` (the app's `connectRemote` bubbling listener hears nothing), the wheel too, pointer moves and `Platform.onPointer` drive its own navigator; opening it blurs the focused element. OK or Back closes a notice (`shown(id)`) or calls `exitApp` (`exitRequested` signal). `stopped(true/false)` on the transitions into and out of `disabled`/`update`.
    - **`GateApp.tsx`:** `GateScreen` (hook-free; `data-testid="gate"` with `data-kind`, `data-id`, `data-exit`, `data-language`; `gate-message`, `gate-versions`, `gate-close`, `gate-notice`, `gate-ok`) and `GateApp` (the locale from `<html lang>`, else `Platform.info`, in the TV's region). `gate.css`: z-index 20.
    - **`main.tsx`:** `gate` made after `config`; in the start path, a second root `div` appended to `body`, `render(<GateApp>)`, `gate.start(noticesShownOf(profile))`, then `config.start()`. `gated` (set by `showLive`): `stop` = `player?.close()` + refreshes disposed; `resume` = `startRefreshes(...)` again. Not on the hello and gallery screens.
    - **`packages/data`:** `config-constants.ts` `MAX_NOTICES` (100) and `isRuleId` (the protocol's `killRule` id rule, `charCodeAt` only), exported from `client.ts` and `index.ts`; `profile.ts`: `noticesShown?: string[]` on version 7 (optional: no version bump, no migration) and the edit `{kind: 'notice', id}` (a valid id, once, the latest 100).
    - **Catalogs:** `gate.disabledTitle`, `gate.disabledMessage`, `gate.updateTitle`, `gate.updateMessage`, `gate.versions` (`{current}`, `{needed}`), `gate.close`, `gate.noticeTitle`, `gate.ok` in en.ts and ar.ts.
    - **e2e:** `e2e/config-server.ts` (moved out of `config.spec.ts`: `startConfigServer`, `doc()`); `e2e/config-gate.spec.ts` (5: a notice once over onboarding, kept, nothing after a reload; the notice and `disable-app` in Arabic; `disable-app` arriving through `refreshConfig()` while a channel plays, then lifted; the update screen in the built webOS bundle from `file://`, en and ar).
    - **Tests:** unit 5,344 (+59). Mutation: `artifacts/mutate30c2a.py`, 95 written first, 93 caught, one test gap closed (rerun 1/1, `--rerun`), one equivalent kept.
    - **Sizes:** main.js 427.3 / 414.6 KB (+6.4), 222 core-js modules (unchanged), the query worker 129.4 KB (+0.4).

## Read first
1. **`RELAY.md`:** Phase 8, 30c2's split; **30c2a's "Done in leg 87"**; **30c2b's line and "Done when"**; 30c3's; 29b2b's; leg 87's progress-log row.
2. **`docs/architecture.md`:** §3.3 C; "Built in step 30c1"; **"Built in step 30c2a"**.
3. **`docs/runbooks/config.md`:** "On the TV" and **"What the TV shows"** (30c2b adds its two modes there).
4. **`CLAUDE.md`:** "Package boundaries", the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.
5. **Code for step 30c2b:**
   - `apps/tv/src/main.tsx`: `config.policy` (a signal), `gate`/`gated`, `showLive` (the `player` made there, `resume` at the start), `showOnboarding`;
   - `apps/tv/src/gate/gate-state.ts`: `messageIn` to reuse for the doc's message;
   - `packages/data/src/config-policy.ts`: `policyStops(policy, mode)` (this mode or stronger: `disable-app` also stops playback and adds), `PolicyRule.message`;
   - **adding a source:** the only path is onboarding: `apps/tv/src/onboarding/onboarding-state.ts` (`submit`, around line 189), `engine-loader.ts` (line ~163 writes the `source` edit), `OnboardingApp.tsx` (how a failed load shows its message). (The lab's S6 spike adds one too: a developer tool, leave it.)
   - **playing:** `apps/tv/src/player/player-state.ts`: `playRow` (around line 570, `c.play(...)`), `playFilm` (`c.play(shown.request, opts)`), the entry points `show`, `catchup`, `resume`, `playMovie`; `onStatus` and the card (`cardZone`, the `card` zone); `PlayerScreen.tsx` `ErrorCard` (`CATEGORY_TEXT[failure.category]`, `data-failure`); `app-player.ts`;
   - `e2e/config-gate.spec.ts` and `e2e/config-server.ts` to reuse; `e2e/player.spec.ts` (opening the player without media: `data-plays`, `data-playing`).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `40c1aae` (Merge PR #107) = main.
2. **Check the clock** with `date -u`.
   - **From 2026-11-17 18:02 UTC, step 29b2b** (small, its own PR) can go first:
     - bump to 16.4.5 (16.4.6 only from 2026-11-23 20:33 UTC), with `@next/swc-win32-x64-msvc` following;
     - publish dates: a tiny `npmdates.py` in the job's tmp folder (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`), reading the `time` field of `https://registry.npmjs.org/<name>`;
     - advisories: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`;
     - then `pnpm --dir "<wt>" web:db`, `test:web` 13/13 and `build:web` (the agent nudge may stop it once: run it again), with the SWC binding loading under Smart App Control;
     - update `web.md`'s gotcha and RELAY.md; open the PR and merge on green CI.
3. **Step 30c2b (`block-new-sources` and `disable-playback`).** First look for existing work: `git log --oneline -10`, then grep `policyStops(` in `apps/`.
   - **Write the runnable "Done when" checks into RELAY.md before building** (30c2b's line has the outline).
   - **`block-new-sources`** (and stronger): onboarding's "Add" refused before anything loads, with the doc's message in the UI language (`messageIn`) or a new catalog text; the form stays, nothing is written to the profile. Decide whether a rule arriving while a load runs cancels it (suggested: refuse at submit only; a load already running finishes).
   - **`disable-playback`** (and stronger): every play refused (`playRow`, `playFilm`, so `show`, `catchup`, `resume`, `playMovie` and auto-next all go through it) with a card carrying the message; a stream playing when the rule arrives stops (the controller's `stop`) and shows that card. A suggested shape: a `refusal` option on `createPlayer` (a function returning the rule's message or `null`, read at each play) plus a `refuse()` call main.tsx makes when the policy signal changes while the player is open; the card's text from the catalogs plus the doc's message, its buttons "Channels"/"Back" (no "Try again"). The start's last channel (`player.resume` before `config.start()`) plays for a moment before the cached policy arrives: say so in the docs, as 30c2a does for `disable-app`.
   - **e2e:** `startConfigServer`, `?api=`, `refreshConfig()` while a channel plays (the card appears, the stream stops: `#stage video` paused or gone); onboarding's Add refused (mock provider host typed as in `addXtreamAndWatch`).
   - **Screenshots:** en and ar, looked at. **A "press these keys" list for Omar.**
4. **Step 30c3 (the blocklist checks),** after 30c2b: through `DataEngine.blocked(urls)` at add (the API host), on refresh (a blocked source isn't refreshed, and says so) and before play (the stream host; on Tizen also the final host after the redirect probe).
5. **Step 26's common items still apply to each:**
   - unit tests;
   - a mutation run with the mutant list written first (`artifacts/mutate30c2a.py` is the newest template, with `--rerun`; read its docstring before changing the gate);
   - the `pnpm verify` parts green;
   - `verify:engines` if a TV-run page or the build changes;
   - the PR merged on green CI;
   - docs: RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook;
   - a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `40c1aae` Merge PR #107 = main;
  - `93ec6bf` docs (30c2a ticked, leg 87's row);
  - `ef641d1` Merge PR #106;
  - `d4df3cd` the 30c2a feature commit.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/`: TV builds from 30c2a's code **before** its last two take-outs (`start`'s `ids.slice()`, `dispose`'s `disconnect = null`: no behaviour change; CI built and ran the final code), the lab, `dist/tv-vectors`;
  - `artifacts/`:
    - `mutate30c2a.py` and its logs (`mutate30c2a.log` 93/95, `-b.log` 1/1);
    - `unit-30c2a.log` (5,344), `build-30c2a.log`, `lint-30c2a.log`, `typecheck-30c2a.log`, `poly-count-30c2a.log` (222);
    - `engines-30c2a.log` (53+68, 18 as expected);
    - `screenshots/gate-{notice,disabled,update}-{en,ar}.png`;
    - older legs' files.
- **Docker:** no `lablo-chrome*` container left; the `lablo-web` Postgres is down. No `next start` or Vite is left running (ports 3100, 5391, 5399 and 8090 are free).
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 87:**
- **Onboarding's first screen is a horizontal row** (`language/languages`): RIGHT moves (LEFT in Arabic), DOWN does nothing. A "keys come back" check pressed DOWN and looked like a gate bug. Memory `iptv-ui-test-gotchas`.
- **The gate has its own navigator:** `RemoteDriver.expectFocus` keeps reading the app's navigator while the gate shows (that is how the e2e proves no key reached the app). Read the gate from the DOM.
- **The desktop dev app has no `minVersion`** (it is the `browser` platform): the update screen is tested in the built webOS bundle from `file://` with `?api=` on 127.0.0.1 and `browser.newContext({ locale })` (webOS takes `navigator.language`). Run `pnpm build:tv` first.
- **Run the tests before taking out "dead" code:** `slice(Math.max(0, n - MAX + 1))` was not equal to `slice(n - MAX + 1)` (a negative start inside the list drops items). Memory `iptv-parser-test-patterns`.
- **A state machine's dispose test must go back through its idle state:** a gate still following the policy after `dispose` only reconnects from "nothing shows".
- **The Write tool decoded `\u2066` in a test regex again.** Use `stripIsolates` from `@lablo/core`. Memory `write-tool-raw-unicode-escapes`.
- **apps/tv's `tsc` checks test files:** a fake platform's `keyToIntent` must take `KeyLike` (cast inside). The per-file vitest run doesn't type-check: run `pnpm --dir "<wt>/apps/tv" exec tsc --noEmit -p tsconfig.json` before committing.

**From earlier legs (still true):**
- **A worker the app starts on its own needs an "idle" signal the old-engine walk can wait for** (`configIdle()`, leg 86). Any new self-starting worker (telemetry, backup in steps 32–33) needs the same. Memory `iptv-old-engine-walk`.
- **A worker the app starts after the first paint needs its npm deps in `apps/tv/vite.config.ts` `optimizeDeps.include`.** Check with `vite --force` and count the main-frame navigations (1 is right).
- **Never open the app's IndexedDB from a test page before the app has.** Wait for `[data-testid="onboarding"][data-ready="true"]`.
- **A worker's failed fetch is not a page console error in Playwright.**
- **Polyfill names:**
  - a member named `flags` pulls `es.regexp.flags`, and `lastIndexOf` pulls an array polyfill; avoid `concat` and regex `.test` in new TV code (leg 87 used `slice`+`push` and `charCodeAt`);
  - `normalize`, `toLowerCase`, `charCodeAt`, `fromCharCode` and `decodeURIComponent` pull nothing;
  - never use `URL` in TV code;
  - to find which file adds a core-js module, use `artifacts/babel-polys30b2.ts`;
  - `poly-count20c2a.py` overwrites `artifacts/corejs20c1-<platform>.txt`: copy the old list first if you want a diff.
- **CI runs Node 22; this PC runs Node 24.** `url.domainToASCII` is not an oracle without a behaviour gate.
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
  2. start one Monitor running a `comm -13` loop over `gh run view <run> --json status,conclusion,jobs` (leg 87's worked end to end).
  - To see why a job failed: `gh api repos/Omarmarei/Lablo/actions/jobs/<job id>/logs`.
- **Python with `-I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`. Write patch scripts to a file (a heredoc can lose a backslash).
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit tests take about 6–9 s each. Never edit source or commit while a mutation run is going (a commit could capture a mutated file). Vite serves the mutated files too, so never run e2e during a mutation run.
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
  - `pnpm test` takes about 4 min (5,344 tests).
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
- **Verified in leg 87 (30c2a):**
  - **Locally:** lint, typecheck, unit 5,344; `build:tv` (main 427.3 / 414.6 KB, 222 core-js modules); `verify:engines --engine chrome53 --engine chrome68` 18 as expected; e2e `config-gate.spec.ts` 5/5 and `config.spec.ts` 3/3; the six screenshots looked at (Arabic mirrored, the doc's Arabic text).
  - **Mutation:** 93/95, then 1/1; one equivalent kept.
  - **CI:** the first run all green (114 engine runs, 83 seeded failures caught; the full `pnpm e2e` 136 passed).
- **Not verified:** the gate on the old engines (the walks get no config, so it never shows there; its code runs at each start on 53, 56 and 68 without error); the gate on a real TV.
- **Migrations and deploys:** nothing new. Nothing is in production (Neon arrives with step 34 `[needs Omar]`), nothing is deployed.

## Open decisions and gates
- **None for 30c2b's shape** beyond the two choices named in step 3 (a rule arriving mid-load; the refusal card's buttons): the leg's call, recorded in RELAY.md.
- **Step 34 `[needs Omar]`, including the config key ceremony** (runbook `config.md`):
  - Omar runs `pnpm sign-config keygen` twice on his own machine and keeps the seeds in his password manager and on paper;
  - he gives Claude the two public keys and signs the production config himself;
  - plus the Vercel, Neon, R2 and Upstash accounts, the domain (`PRODUCTION_API_BASE`) and the `.env` keys;
  - the first production migration and deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set;
  - about 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player. Steps 24–28 can join that visit, along with whether the TV keyboards type into the search field, and now the gate's screens on the real set.
- **For step 32:** derive the backup master once, in a worker, with progress, and cache it. That worker also needs an idle signal for the walk.
- **For step 38 (parental):** every Home shelf, the search results, "Continue watching" and "Recent channels" hold adult items too: the lock must filter them.
- **For step 41 (the 2018 Samsung):** decoded poster memory, posters in lists on the low tier, the search's real time, the scrypt time.
- **Later (unchanged):** search and Home kind filter and posters; movies and shows extras; player extras (fine HLS seeking, "start over", PLAY/PAUSE intents, PRE-CH on webOS, pre-buffered zapping); a guide day jump and Guide/Info key; an on-screen keyboard if the TV keyboards fail; step 38's settings rows; dropping Chromium 53 (ADR-012); a memory signal for the tier; CI's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (step 30c2a is merged; on the PC, nothing to press on a TV yet)
1. In the repo, run `pnpm exec vitest run apps/tv/src/gate packages/data/src/config-constants.test.ts`: 22 + 2 tests pass.
2. `pnpm build:tv`, then `pnpm exec playwright test --project=chromium e2e/config-gate.spec.ts`: 5 passed. The screenshots are in `artifacts/screenshots/gate-*.png`.
3. Try it by hand with the real signer and backend:
   1. add to `config/config.json`'s `"kill"`: `{"id": "try-notice", "match": {}, "mode": "notice", "message": {"en": "Hello from the config", "ar": "<any Arabic text>"}}`, then `pnpm sign-config sign --dev`;
   2. `pnpm web:dev` (the backend on port 3100) and `pnpm dev`; open `http://localhost:5173/`;
   3. "A message from Lablo" shows over the language screen. Press RIGHT: nothing moves. Press Enter: it closes, and RIGHT works again. Reload: it doesn't come back;
   4. change that rule to `"id": "try-off", "mode": "disable-app"`, sign again, reload: "Lablo is unavailable" covers the screen; arrows do nothing; Backspace (Back) logs `exitApp(): ignored in the desktop browser` in the console;
   5. take the rule out, sign again, and run `window.__LABLO_TEST__.refreshConfig()` in the console: the app comes back where it was;
   6. undo with `git checkout config/`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Forty-eight CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29–47: as listed in leg 86's handover (`git -C "<wt>" show 5fffb27:HANDOVER.md`, "Carry-forward reminders");
  - 48 (new): the app's structure could name `apps/tv/src/gate/` (the config gate over every screen: its own root, navigator and capture key listener) and say a new full-screen state over the app goes through it.
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create, and he puts the keys in `.env` himself. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
