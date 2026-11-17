# Lablo IPTV: relay leg 93 opening prompt

You are leg 93 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–91 did steps 1–31a (PRs #1–#115). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 92 (2026-11-17) built step 31b, the phone page `/p`. It is merged and ticked.**
  - PR #116 (`8fa3096`): the page. Green on the first run:
    - verify 14 m 10 s (e2e 145 passed; unit 5,790 with one skipped);
    - web 2 m 10 s, now with `e2e:web` 7 passed;
    - media 12 m 15 s;
    - engines 19 m 4 s (all 114 runs as expected).
  - PR #117 (`413e7b2`): the rest of the mutation run, one test gap closed, a lint comment corrected, 31b ticked. Green: verify 14 m 4 s, web 1 m 58 s; engines and media skipped by the path filter.
  - Same PR #116: **the throttle proof's flake is fixed.** `e2e/throttle.ts`'s `baseBusyMs` takes the fastest of three unthrottled runs as the reference. CI then measured 4.0x to 4.4x (search 4.2x, after 1.29x and 1.6x).
  - **The mutation run** (`artifacts/mutate31b.py`, 155 written first):
    - Claude Code stopped it for low memory after 66. Omar said to continue once memory was free. The rest ran in foreground batches (`--from`/`--to`, fewer workers).
    - 151/155 caught the first time, 154/155 after the fixes.
    - One test gap closed: a language without `q=` weighs 1.
    - Two equivalents replaced; one equivalent kept (the send's `problems: {}`).
- **What 31b built** (architecture.md §3.2 "Built in step 31b"; runbook `web.md` "The phone page"):
  - **The files:**
    - `apps/web/src/app/layout.tsx`: the first root layout. `<html lang dir>` from `Accept-Language`, `robots: noindex`.
    - `src/app/p/page.tsx`: the language from `?lang`, else `Accept-Language`, else English.
    - `src/phone/`:
      - `PhonePage.tsx` (`'use client'`);
      - `state.ts`: a pure reducer, with views `starting`, `code`, `checking`, `form`, `progress`, `done` and `lost`;
      - `flows.ts`, `progress.ts` (the 2 s poll), `code.ts`, `form.ts`, `api.ts`, `catalog.ts` (en and ar), `lang.ts`, `phone.css`.
  - **The code:** from the QR link's fragment `#c=<code>&k=<tvPk>` (read once, then removed from the address bar; a later fragment change reloads the page), or typed (Crockford readings).
  - **The key:** the QR path seals to the fragment's key and first reads the progress. The typed path gets the key from `GET /v1/pair/:code`.
  - **The forms:** Xtream or M3U link, up to four guide links and a name. Links are read like the TV form's `normalizeLink` (`test/phone-link.test.ts` keeps the two copies in agreement). `pairPayloadSchema` has the last word.
  - **The payload:** sealed in the browser, then posted.
    - An ended code keeps every typed value.
    - "Fix and send again" keeps the values; "Add another source" starts empty.
  - **Only the page's own origin:**
    - `api.ts` is the one `apps/web` file allowed `fetch` (`PHONE_API_RULES` in `eslint.config.js`, proven in `test/lint-web-outbound.test.ts`).
    - `next.config.ts`'s `pageHeaders` gives `/p` a CSP in production builds (`connect-src 'self'` and the rest), plus `Referrer-Policy: no-referrer`.
  - **`pnpm e2e:web`:**
    - `playwright.web.config.ts`: `next start` on port 3101, a fresh `lablo_e2e` database, a Pixel 7 viewport. Specs are in `apps/web/e2e/`.
    - The TV is played over the API by `support.ts`'s `Tv` class.
    - Each test has its own `x-forwarded-for`.
    - Every request is checked against the page's origin.
    - CI's `web` job installs Chromium and runs it.
  - **The page's JS:** 579 KB decoded / 173 KB gzip (Next+React 445 KB; the page's own chunk 121 KB).

## Read first
1. **`RELAY.md`:**
   - steps 31c, 31d, 31e, 32, 34;
   - 31b's "The shape" and "Done in leg 92" (the newest examples of a step's write-up);
   - leg 92's progress-log row.
2. **`docs/architecture.md`:**
   - §3.2: the endpoint table, "Built in step 31a", "Built in step 31b";
   - §3.3 "A. Pairing";
   - §3.3 "Built in step 29b1" (`@lablo/crypto`: `newBoxKeyPair`, `openPairPayload`, the file frames).
3. **`docs/runbooks/web.md`:** "Pairing", "The phone page", "Gotchas".
4. **`packages/protocol/src/pairing.ts`:** every pairing schema; `pairPayloadSchema` is what the TV opens.
5. **The TV side 31c touches:**
   - `apps/tv/src/onboarding/` (the add step, `form.ts`'s `checkForm`/`normalizeLink`);
   - the Settings, Sources screen;
   - `DataEngine.refresh` and `refusalFor`;
   - how the TV already reaches the backend for `/v1/config` (`packages/data/src/config-service.ts`, `tv-defines.config.ts`): the pairing calls need the same base URL.
6. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `413e7b2` (Merge PR #117) = main.
2. **Check memory before any heavy run.** The PC was at its commit limit this leg, and Claude Code stops background jobs when memory runs short.
   - Check with PowerShell `Get-CimInstance Win32_OperatingSystem` (`FreePhysicalMemory`, `FreeVirtualMemory`).
   - Prefer foreground runs with fewer workers.
   - If a background job is stopped for memory: don't restart it unasked; ask Omar.
3. **Step 31c, the TV's pairing screen** (RELAY.md has its text and "Done when"). Write its shape in RELAY.md before building, and split it if it is too large for one leg (it probably is: the screen and poll; then the add path and status; then the e2e). Decisions for the leg:
   - **The QR encoder:** a new TV dependency, at least 2 weeks old.
     - Measure it for polyfills (`artifacts/babel-polys30b2.ts`, `poly-count20c2a.py`) and main.js (500 KB budget; 439.5 / 426.8 KB now).
     - Probe it on Chromium 53 and 68 (`verify:engines`).
     - Or write a small QR encoder in `packages/core`, with golden tests. Weigh both.
   - **The QR link:** `https://<domain>/p#c=<code>&k=<tvPk>`. The domain comes from the same build define or config as the API base.
   - **The flow:**
     - the TV's ephemeral key in memory only (`newBoxKeyPair`);
     - `POST /v1/pair`;
     - the poll every 2 s with the Bearer token;
     - a new code before the old one's `exp`;
     - `openPairPayload`, then `pairPayloadSchema`.
   - **Before keeping a source:** `refusalFor(policy, 'block-new-sources')`, then `DataEngine.refresh` (the blocklist, the provider's answer).
   - **The status back:** `ok`, `auth_failed`, `expired`, `unreachable` or `blocked`, mapped from the add path's errors.
   - **Where the screen is reached:** onboarding's add step and Settings, Sources.
   - **The e2e:** it needs `next start` plus Postgres plus the TV's Vite app plus the mock, with a scripted phone (Node, `@lablo/crypto`). It probably belongs in CI's `web` job (which has Postgres and now Chromium), maybe as a second project in `playwright.web.config.ts`. Note that `verify` has no database.
4. **Then 31d** (the M3U file relay: the phone's file form, `/dev/blob/<key>`, the http-vs-https decision for development URLs) **and 31e** (the end-to-end "no plaintext" test).
5. **Step 26's common items still apply to each step:**
   - unit tests;
   - a mutation run with the list written first (`artifacts/mutate31b.py` is the newest template; it has `--from`/`--to` for foreground batches);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` if a TV-run page, the build or the protocol's samples change;
   - the PR merged on green CI;
   - the docs (RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook);
   - the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of:
  - `413e7b2` Merge PR #117 = main;
  - `703ae6d` (the mutation follow-up, 31b ticked);
  - `e10c4bd`;
  - `8fa3096` Merge PR #116.
  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next` (a build of HEAD's code);
  - `dist/`;
  - `artifacts/`:
    - `mutate31b.py`, `mutate31b-first.log` (66), `mutate31b-rerun.log` (the rest);
    - `measure31b.ts` (the page's JS);
    - `unit-31b.log` (5,783), `lint-31b.log`, `typecheck-31b.log`, `build-web-31b.log`;
    - `screenshots/phone-*.png`;
    - older legs' files.
- **The `lablo-web` Postgres container is up** (`pnpm web:db:down` stops it). The databases `lablo_test` and `lablo_e2e` are recreated by each run.
- **No `next start`, Vite, Playwright or `*.mutbak` is left.**
- **On the TV:** only the old lab, under its old id.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 92:**
- **A stopped background mutation run leaves its mutant in the file**, next to a `.mutbak`.
  - Check: `git show HEAD:<file> | cmp - <file>.mutbak`, then `mv` it back, then look for any `*.mutbak`.
  - Then ask Omar before restarting; don't restart unasked.
- **`next build` type-checks `apps/web/e2e/` too.** `next-env.d.ts` doesn't exist in CI's typecheck, so use a plain global CSS import (`import './phone.css'`), not a CSS module.
- **A running `next start` locks `apps/web/.next`** (`EBUSY` on the next build). Stop it with PowerShell `Stop-Process -Id <pid> -Force` (find the pid with `netstat -ano | grep ":3101 "`).
- **Playwright's `webServer` starts before `globalSetup`.** Its readiness URL must not need the database (`/p`), and the global setup migrates `lablo_e2e`.
- **Next's server keeps a client's `x-forwarded-for`.** Use it to give each e2e test its own rate-limit address.
- **Next adds `role="alert"` (its route announcer).** Scope alerts to `[data-testid=phone]`.
- **`page.goto` from `/p` to `/p#…` doesn't load the page.** Open `about:blank` first (`openQr`).
- **Flat-config lint: a later block replaces only the rules it names.** An exception block needs only the rule it relaxes.
- **Bash heredocs to Python still drop backslashes** (`\n` in a JS string became a newline; `\\.` became `\.`). Write a script file with the Write tool, or use Edit. The Write tool turns `\u2066` and `\u0600` in regex literals into raw characters: use `String.fromCharCode`, or fix the file afterwards from Python with `chr(92)`.
- **Write the mutant you mean.** `type !== 'm3u' && server !== ''` was equivalent because of the required check. Think through what else already refuses the input.

**From earlier legs (still true):**
- **Any new way to play goes through `PlayerController.play`** (its `open` checks the blocklist).
- **Any new way to add a source** must read the config's refusal (`refusalFor`) and go through `DataEngine.refresh` (the blocklist). This holds for 31c's paired sources.
- **A new `FailureCategory` in `@lablo/player` needs an entry in `PlayerScreen.tsx`'s `CATEGORY_TEXT`.**
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src` and `data-plays`.
- **An e2e stream host that differs from the source's host:** serve the mock's playlist from `config-server.ts`'s `file('/list.m3u', …)`.
- **Writing the mutant list first keeps finding real gaps** (six this leg).
- **`DataEngine`'s refreshes must claim the slot before any `await`.**
- **A settings, guide or source row is 120 px:** the name plus one line. The guides screen's "read, last try failed" rows clip their third line (a known UI bug).
- **Settings has two rows:** "TV guides" `settings/items/0`, "Sources" `settings/items/1`.
- **The e2e blocklist:** `doc({ blocklist: { salt: HARNESS_SALT, hashes: [blocklistHash(HARNESS_SALT, '127.0.0.1')] } })`, then `refreshConfig()`.
- **A player screen with no stream shows the page's white on the desktop;** `player__blank` paints black. Look at every screenshot.
- **The mutation run edits source files:** never commit, build or run e2e while it runs.
- **Onboarding's first screen is a horizontal row.** The gate has its own navigator (`[data-testid=gate]`).
- **Run the tests before taking out "dead" code.**
- **apps/tv's `tsc` checks test files.**
- **Workers:**
  - a worker the app starts on its own needs an "idle" signal for the old-engine walk;
  - a worker started after the first paint needs its npm deps in `optimizeDeps.include`;
  - never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`.
- **Polyfill names:**
  - a member named `flags` or `at`, `lastIndexOf` on arrays, `concat`, regex `.test` and `URL` are out of TV code;
  - `artifacts/babel-polys30b2.ts` finds the file that adds a core-js module;
  - `poly-count20c2a.py` overwrites `artifacts/corejs20c1-<platform>.txt` (copy it first).
- **CI runs Node 22; this PC runs Node 24.**
- **node-postgres reads a `timestamp` as local time:** read rows through Prisma in web tests.
- **TaskStop on a background `next start` leaves it running:** stop its pid.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **zod on the TV:** `zod/mini` only. **`apps/tv/src/env.d.ts` must stay a global script.** Root `test/` and `e2e/` files import packages by relative `src` paths.
- **Overlap CI with the next step,** but never push while a PR's CI runs.
- **Known CI flake:** the media flake (`epg-declared-300mb`). Run `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done. The throttle-proof flake is fixed.
- **One CI poller:**
  1. after `gh pr create`, wait ~45 s (`timeout 45 tail -f /dev/null`), then `gh run list --commit <sha> --event pull_request`;
  2. start one Monitor with the `comm -13` loop over `gh run view <run> --json status,conclusion,jobs` (worked twice this leg);
  3. read failures with `gh api repos/Omarmarei/Lablo/actions/jobs/<job id>/logs`.
- **Changing the root `package.json` runs every CI job** (it's a shared file): about 20 minutes, with engines the longest.
- **One `git fetch` may print "incorrect old value provided":** check with `git ls-remote`.
- **The relay's context check fires at about 450k tokens.**
- **The profile is at version 7; the IDB schema is at version 2.**
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - none of these in new TV files: `Uint8Array`, `JSON.stringify`, `new RegExp`, iterators/`for…of`, array destructuring or spread, object spread;
  - the build can crash once (0xC0000005): run it again.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it.
- **A bare `sleep N` is blocked:** use `timeout N tail -f /dev/null`, an `until` loop or a Monitor. There is no `jq`: use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:**
  - one TV e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - `pnpm e2e:web` (after `pnpm build:web`, with `pnpm web:db` up): 7 tests, about 20 s;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min, after `pnpm build:tv`);
  - `pnpm test`: about 4 min, 5,791 tests;
  - `pnpm test:web`: 45 tests.
- **Code rules:**
  - `packages/ui` components stay hook-free; UI text only from the catalogs;
  - physical CSS only in TV code; no CSS Grid or flex `gap` there; TV code is ES2017;
  - dependencies at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation.
- **Scripts:** one-off scripts run as `pnpm --dir "<wt>" exec tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch`, path-filtered;
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data; README.md stays "# Lablo";
  - no production signing seed ever enters the repo, a chat or CI.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 92:**
  - **Locally:**
    - lint, typecheck;
    - unit 5,783, then the touched files 368/368 after the gap tests;
    - `build:web`; `e2e:web` 7/7 (also with `--workers=2`);
    - the screenshots in en and ar looked at;
    - the page's JS measured;
    - mutation 154/155 (one equivalent).
  - **On CI:** PRs #116 and #117 green on their first runs.
- **Not verified:**
  - a real phone against the page (it works over plain http on the LAN: tweetnacl, not WebCrypto);
  - the TV's side (31c);
  - anything on Vercel (step 34: the pairing routes answer 503 there until the adapters exist).
- **Migrations and deploys:** none this leg. Nothing is in production; nothing is deployed.

## Open decisions and gates
- **For 31c:** the QR encoder (a dependency or our own), the screen's split into legs, and where its e2e runs. All are the leg's own calls: record them in RELAY.md.
- **For 31d:** how the memory store's `http` development URLs pass `pairUploadResponseSchema`'s https rule.
- **Later UI fix (no step yet):** the guides screen's "read, last try failed" rows clip their third line.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters (each with a narrow, tested lint exception);
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - Omar creates the Vercel, Neon, R2 and Upstash accounts and the domain;
  - the first production migration and the first deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set;
  - about 30–45 minutes at the LG TV.
- **Later (unchanged):** step 32's backup master in a worker with an idle signal; step 38's parental lock everywhere; step 41's 2018 Samsung measurements; dropping Chromium 53 (ADR-012).

## Checks for Omar (31b is merged; nothing on a TV)
1. In the repo: `pnpm web:db`, `pnpm build:web`, `pnpm e2e:web`. Expect 7 passed.
2. Look at `artifacts/screenshots/phone-*.png` (form, progress, results; en and ar) in the relay worktree, or at the `phone-screenshots` artifact of PR #116's CI run.
3. By hand:
   1. `pnpm --filter @lablo/web exec prisma migrate deploy`, then `pnpm --filter @lablo/web start`;
   2. open `http://localhost:3100/p` in a narrow window and type any 8 characters: "No TV is showing this code";
   3. a real pairing needs a TV, which comes with 31c, or the e2e's scripted TV.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** voicebox-server reached about 9 GB this leg and filled the PC's commit charge (84 of 87 GB). Claude Code then stopped a background job. Close it during relay runs if you can.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Fifty-three CLAUDE.md gaps** wait for his word:
  - 1–28: leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`);
  - 29–47: leg 86's handover (`git -C "<wt>" show 5fffb27:HANDOVER.md`);
  - 48–51: the gate folder; the refusal and black player rules; `DataEngine.refresh` for every catalog read; `PlayerController.play` for every play;
  - 52: the pairing routes answer 503 on Vercel until step 34; the memory fakes are development-only;
  - **53 (new):** `apps/web/src/phone/api.ts` is the backend's one `fetch`, for the phone page's own origin. The "no outbound network" rule could say so, along with `pnpm e2e:web` in the commands table.
- **For step 34 (later):** the accounts and the domain are his to create. He puts the keys in `.env` himself, plus `LABLO_RATE_SECRET` (32+ characters) in Vercel. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
