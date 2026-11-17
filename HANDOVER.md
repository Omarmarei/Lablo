# Lablo IPTV: relay leg 92 opening prompt

You are leg 92 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–90 did steps 1–30 (PRs #1–#113). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 91 (2026-11-17, 16:58–18:45 UTC) did three things:**
  1. **Split step 31 (pairing)** in RELAY.md into:
     - 31a, the API;
     - 31b, the phone page `/p`;
     - 31c, the TV's pairing screen;
     - 31d, the M3U file relay;
     - 31e, the end-to-end "no plaintext" test (step 31's own "Done when").
     Each has a runnable "Done when".
  2. **Built 31a, the pairing API.** Merged as PR #114 (`e7b1c60`), green on the first CI run:
     - verify 13 m 20 s (e2e 145 passed; unit 5,526 with one skipped);
     - web 56 s;
     - media 10 m 47 s;
     - engines 21 m 32 s (all 114 runs as expected; the vectors page 203/203 on Chromium 53, 56 and 68).
  3. **Did 29b2b: Next.js 16.4.5.** Merged as PR #115 (`eb96f27`). Its verify job passed on a rerun; the first run's only failure was the known throttle-proof flake. **29b2b, 29b2, 29b and 29 are ticked.**
- **What 31a built** (architecture.md §3.2 "Built in step 31a"; runbook `web.md` "Pairing"):
  - **Eight routes** in `apps/web/src/app/v1/pair/`, thin wrappers over `apps/web/src/server/pair.ts`:

    | Route | Who | Answers |
    |---|---|---|
    | `POST /v1/pair` `{tvPk}` | TV | 201 `{sid, code, pollToken, exp}` |
    | `GET /v1/pair/:code` | phone (typed code) | `{tvPk, exp}` |
    | `POST /v1/pair/:code/upload-url` `{size}` | phone | presigned PUT `{url, key, exp}`, before the payload |
    | `POST /v1/pair/:code/payload` `{phonePk, nonce, ct}` | phone | `{state: "sent"}`, once |
    | `GET /v1/pair/:code/status` | phone | `open` (+`exp`), `sent`, `received`, `done` (+`status`) |
    | `GET /v1/pair/s/:sid` (Bearer poll token) | TV | `waiting` (+`exp`), then `ready` (+`payload`) once, then 409; 410 when the code ended with nothing sent |
    | `POST /v1/pair/s/:sid/status` `{status}` (Bearer) | TV | `{state: "done", status}` once, after the read |
    | `GET /v1/pair/s/:sid/file` (Bearer) | TV | presigned GET `{url, key, exp}` after the read |

  - **What the server stores:**
    - the code (8 Crockford characters from 40 random bits) and the poll token, as b64url(SHA-256) only;
    - the payload, until the TV reads it: one `UPDATE … FROM (SELECT … FOR UPDATE) RETURNING old."payload"` both reads and clears it;
    - the new columns `deliveredAt` and `fileId` (migration `pair_progress`, local and test databases only).
  - **Time:** codes work 10 minutes. Rows and their blobs go an hour after they were made: each `POST /v1/pair` sweeps them. The TV's status deletes the session's blob at once.
  - **Rate limits** per address through `rateKey`, per 10 minutes: 20 new codes; 30 code guesses (key, upload and payload together); 400 progress reads; 400 TV calls. A refusal is 429 with `Retry-After`.
  - **Bodies:** capped before parsing: 64 KB for the payload, 1 KB for the rest.
  - **CORS:** the TV's 4 routes answer `*` and have `OPTIONS` preflights. The phone's routes are same-origin.
  - **Services** (`server/services.ts`):
    - one `MemoryBlobStore` and one `MemoryRateLimiter` per process;
    - `LABLO_RATE_SECRET` (or a random secret per process) and `LABLO_DEV_BLOB_URL` (default `http://127.0.0.1:3100/dev/blob`);
    - they **refuse on Vercel** (`VERCEL` set): every pairing route answers 503 there until step 34.
  - **Protocol:** `pairProgressResponseSchema` and `pairFileUrlResponseSchema`, with 11 samples (the vectors page runs them on the old engines).
  - **Tests:**
    - `apps/web/test/pair.web.test.ts` (32, test:web), including **"the server only ever holds ciphertext"**: two whole pairings through the routes, with every row and blob searched after every step;
    - `apps/web/test/pair-unit.test.ts` (23).
  - **Mutation:** `artifacts/mutate31a.py`, 106 written first (nine test gaps closed). 104 were caught; then 105/105. The routes' constant clock was a gap, now closed; `Headers` already trims, so the `trim()` went.
  - **Live:** `next start` with a scripted TV and phone over HTTP (`artifacts/live31a.ts`).

## Read first
1. **`RELAY.md`:** steps 31a–31e (31a's "The shape" and "Done in leg 91" are the newest examples of a step's write-up), 32 and 34, and leg 91's progress-log row.
2. **`docs/architecture.md`:**
   - §3.2: the endpoint table and "Built in step 31a" (also 29a, 29b2a);
   - §3.3 "A. Pairing" (the protocol: QR `https://<domain>/p#c=<code>&k=<tvPk>`, the three forms, `box`, the file frames);
   - §3.3 "Built in step 29b1" (`@lablo/crypto`: `sealPairPayload`, `openPairPayload`, `sealFileFrame`/`openFileFrame`, `fileCipherLength`).
3. **`docs/runbooks/web.md`:** "Pairing", the blob store and rate limiter, the gotchas.
4. **`packages/protocol/src/pairing.ts`** (every pairing schema; `pairPayloadSchema` is what the phone seals).
5. **`CLAUDE.md`:** "Package boundaries" (`apps/web` may import only `protocol` and `crypto`), "Legal guardrails", the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean;
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `eb96f27` (Merge PR #115) = main.
2. **Step 31b, the phone page `/p`** (RELAY.md has its "Done when"). Write its shape in RELAY.md before building. First look for existing work (`git log --oneline -15`; grep `app/p` and `'use client'` in `apps/web/src`). Decisions for the leg:
   - **The page's structure in Next's App Router:** a client component, since the crypto runs in the browser. `apps/web` has no pages yet, only route handlers: it needs a root `layout.tsx` and `<html lang dir>`.
   - **Where its English and Arabic text lives:** the TV's catalogs are in `apps/tv`/`packages/ui`, which `apps/web` may not import. The page needs its own small catalog.
   - **How the language is picked** (`Accept-Language` vs a toggle vs `?lang`).
   - **The code's normalisation:** Crockford; lower case; I and L read as 1, O as 0; spaces and dashes dropped. Maybe as a protocol helper with samples.
   - **How Playwright runs against `next start`:** a new Playwright project or config. The current `playwright.config.ts` serves the TV's Vite app; look at how `e2e/` starts servers.
   - **The bundle:** tweetnacl and `zod/mini` in the phone's browser. Modern browsers, so no TV polyfill rules, but keep the page small.
   - **The fragment never reaches the server:** read `location.hash` in the client and clear it from the address bar after reading.
   - **The progress poll:** every 2 s until `done`; stop on 404.
   - **The file form waits for 31d.**
   - **The RTL layout:** physical CSS, mirrored with `dir` (the web app has no rtlcss pipeline).
3. **Optional and small: harden the throttle proof** in `e2e/search-throttled.spec.ts` (it flaked twice: 1.6x in leg 86, 1.29x in leg 91). Take several base samples before throttling and use the smallest, not one five-run sum. Its own small PR, or inside 31b's. See memory `iptv-throttled-e2e`.
4. **Then 31c, 31d, 31e.**
   - 31c's QR encoder is a new TV dependency: at least two weeks old, measured for polyfills and for main.js (500 KB budget; 439.5 / 426.8 KB now). Probe it on Chromium 53 and 68.
   - 31d decides how the memory store's `http` development URLs pass `pairUploadResponseSchema`'s https rule, and adds the `/dev/blob/<key>` route (never on Vercel).
5. **Step 26's common items still apply to each step:**
   - unit tests;
   - a mutation run with the list written first (`artifacts/mutate31a.py` is the newest template; its `TESTS` map runs several commands per file, unit then test:web);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` if a TV-run page, the build or the protocol's samples change;
   - the PR merged on green CI;
   - the docs: RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook;
   - the merge recorded (in the next PR or the handover commit).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md and ticking 29b2b, 29b2, 29b and 29 with PR #115's merge record. It sits on top of:
  - `eb96f27` Merge PR #115 = main;
  - `68131ff` (Next 16.4.5, 31a ticked, leg 91's row);
  - `e7b1c60` Merge PR #114;
  - `ef0dd31` (the 31a feature);
  - `5149bf5` (the split).
  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules` (now with next 16.4.5), `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/` (TV builds of 31a's code, the vectors page);
  - `artifacts/`:
    - `mutate31a.py`, `mutate31a-first.log` (104/106), `mutate31a-rerun.log` (1/1);
    - `live31a.ts`;
    - `unit-31a.log` (5,526), `test-web-31a.log` (45), `build-web-31a.log`, `build-31a.log`, `lint-31a.log`, `typecheck-31a.log`, `engines-31a.log` (18 as expected);
    - `test-web-29b2b.log` and `build-web-29b2b.log`;
    - older legs' files.
- **The dev database `lablo` has the `pair_progress` migration** (applied by `migrate dev`), so CI and local agree.
- **Docker:** the `lablo-web` Postgres is down (`pnpm web:db` starts it); no `lablo-chrome*` container is left.
- **No `next start` or Vite is left running.**
- **On the TV:** only the old lab, under its old id.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 91:**
- **node-postgres reads a `timestamp` column as local time** (this PC is UTC+2; CI is UTC). Read rows through Prisma in web tests. Prisma's own `$queryRaw` Date params and comparisons are right. Memory `iptv-web-backend-gotchas`.
- **`UPDATE … RETURNING` gives the new values.** For read-and-clear or an old id, use `UPDATE t AS p … FROM (SELECT … FOR UPDATE) AS old WHERE p."id" = old."id" RETURNING old."col"` (`pair.ts` has three).
- **`Headers` trims a value's ends.** `new Request(url, {body: string})` sends no `content-length`, so set the header by hand to test a declared-length path.
- **With injected deps, a constant clock passes a whole flow.** Check one absolute time against `Date.now()` in route-level tests (the 31a mutant that lived).
- **Mutation over `test:web`:** about 10 s per mutant (each run migrates `lablo_test` again); keep `pnpm web:db` up.
- **Next 16.4.5 has no advisory,** so `build:web` no longer stops on the agent nudge. 16.4.6 is eligible from 2026-11-23 20:33 UTC; check the bulk advisory API first (`web.md`).
- **The memory store's URLs are `http`** while `pairUploadResponseSchema` takes only https. The routes test sets `LABLO_DEV_BLOB_URL=https://blobs.test/dev/blob`; 31d decides the real answer.
- **`apps/web` has no pages yet,** only route handlers (no `layout.tsx`, no `app/page.tsx`).
- **The throttled search spec's proof** failed again (1.29x against 2x, every budget met); rerun `--failed`. Hardening is due (step 3 above).

**From earlier legs (still true):**
- **Any new way to play goes through `PlayerController.play`** (its `open` checks the blocklist). **Any new way to add a source** must read the config's refusal (`refusalFor`) and go through `DataEngine.refresh` (the blocklist). This holds for 31c's paired sources.
- **A new `FailureCategory` in `@lablo/player` needs an entry in `PlayerScreen.tsx`'s `CATEGORY_TEXT`.**
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src` and `data-plays`.
- **An e2e stream host that differs from the source's host:** serve the mock's playlist from `config-server.ts`'s `file('/list.m3u', …)` (memory `iptv-mock-provider-gotchas`).
- **Writing the mutant list first keeps finding real gaps** (nine this leg).
- **`DataEngine`'s refreshes must claim the slot before any `await`.**
- **A settings, guide or source row is 120 px:** the name or link plus one line. The guides screen's "read, last try failed" rows clip their third line (a known UI bug).
- **Settings has two rows:** "TV guides" `settings/items/0`, "Sources" `settings/items/1`.
- **The e2e blocklist:** `doc({ blocklist: { salt: HARNESS_SALT, hashes: [blocklistHash(HARNESS_SALT, '127.0.0.1')] } })`, then `refreshConfig()`.
- **A player screen with no stream shows the page's white on the desktop;** `player__blank` paints black. Look at every screenshot.
- **Test traps:**
  - with no tracks, AUDIO then SUBTITLES closes the menu: check after each key;
  - `data-plays` is a lifetime count;
  - compare bidi-isolated names through `stripIsolates`;
  - `track()` decrements before the caller's `.then`;
  - a `VirtualList`'s `renderItem` gives the row's VNode.
- **The mock provider keeps no request log.**
- **The mutation run edits source files:** never commit, build or run e2e while it runs.
- **Onboarding's first screen is a horizontal row.** The gate has its own navigator (`[data-testid=gate]`).
- **The desktop dev app has no `minVersion`.**
- **Run the tests before taking out "dead" code.**
- **A state machine's dispose test must go back through its idle state.**
- **The Write tool decodes `\u2066`:** use `stripIsolates` in tests.
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
- **A manual clock races fake-indexeddb.**
- **TaskStop on a background `next start` leaves it running:** `netstat -ano | grep ":3100 "`, then `Stop-Process -Id <pid> -Force` (PowerShell).
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **zod on the TV:** `zod/mini` only. **`apps/tv/src/env.d.ts` must stay a global script.** Root `test/` and `e2e/` files import packages by relative `src` paths.
- **Overlap CI with the next step,** but never push while a PR's CI runs.
- **Known CI flakes:** the media flake (`epg-declared-300mb`) and the throttled search proof. Run `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:**
  1. after `gh pr create`, wait ~45 s (`timeout 45 tail -f /dev/null`), then `gh run list --commit <sha> --event pull_request`;
  2. start one Monitor with a `comm -13` loop over `gh run view <run> --json status,conclusion,jobs`;
  3. read failures with `gh api repos/Omarmarei/Lablo/actions/jobs/<job id>/logs`.
- **Python patch scripts:** write them with the Write tool, run `python -I <file> "<wt>"`. Heredocs lose backslashes (`\\/` became `\/` this leg). With `-I`, call `sys.stdout.reconfigure(encoding='utf-8')`.
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
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min, after `pnpm build:tv`);
  - `pnpm test` (about 4 min, 5,526 tests);
  - `pnpm test:web` (needs `pnpm web:db`; 45 tests, about 10 s).
- **Code rules:**
  - `packages/ui` components stay hook-free; UI text only from the catalogs;
  - physical CSS only; no CSS Grid or flex `gap` in TV code; TV code is ES2017;
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
- **Verified in leg 91:**
  - **31a locally:**
    - lint, typecheck, unit 5,526, `test:web` 45/45;
    - `build:web`; `build:tv` (main.js 439.5 / 426.8 KB unchanged; the vectors page 164.2 KB + worker 162.9 KB);
    - e2e `crypto-vectors.spec.ts`;
    - `verify:engines` 53+68: 18 as expected, vectors 203/203;
    - the live HTTP run;
    - mutation 105/105.
  - **31a on CI:** all green on the first run.
  - **29b2b:** the bulk advisory API `{}`; `test:web` 45, `build:web` without the nudge; the native SWC binding loads under Smart App Control; CI green after one verify rerun (the flake).
- **Not verified:**
  - a real phone or TV against the API (31b/31c);
  - the routes on Vercel (step 34: they answer 503 there until the adapters exist);
  - two Next instances behind one store (the memory fakes are one process only).
- **Migrations and deploys:**
  - `pair_progress` is applied to the local `lablo` and the CI/test databases only;
  - nothing is in production (Neon arrives with step 34 `[needs Omar]`), and nothing is deployed.

## Open decisions and gates
- **None for 31b beyond the leg's own calls** (above; record them in RELAY.md).
- **Later UI fix (no step yet):** the guides screen's "read, last try failed" rows clip their third line (since 22b2).
- **For 31c:** a paired source must go through `refusalFor` (`block-new-sources`) and `DataEngine.refresh` (the blocklist) before it is kept, and report `blocked`, `auth_failed`, `expired` or `unreachable` back.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters (each with a narrow, tested exception in the outbound lint);
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony (runbook `config.md`): Omar runs `pnpm sign-config keygen` twice and keeps the seeds offline;
  - Omar creates the Vercel, Neon, R2 and Upstash accounts and the domain;
  - the first production migration and the first deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set;
  - about 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, the player.
  - Steps 24–28 can join that visit, with the TV keyboards in the search field, the gate's screens, the refusal cards and the Sources screen.
- **For step 32:** derive the backup master once, in a worker with progress, and cache it; that worker needs an idle signal.
- **For step 38 (parental):** the lock must filter adult items from every Home shelf, the search, "Continue watching" and "Recent channels". Step 38 can also give the Sources screen its actions.
- **For step 41 (the 2018 Samsung):** decoded poster memory, posters in lists on the low tier, the search's real time, the scrypt time.
- **Later (unchanged):**
  - search and Home filters and posters;
  - movies and shows extras;
  - player extras;
  - the guide's day jump;
  - an on-screen keyboard if needed;
  - dropping Chromium 53 (ADR-012);
  - a memory signal for the tier;
  - CI's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (31a and 29b2b are merged; nothing on a TV)
1. In the repo, run `pnpm web:db`, then `pnpm test:web`: 45 passed. `apps/web/test/pair.web.test.ts`'s last test is the "only ciphertext" check.
2. Try the API by hand:
   1. `pnpm --filter @lablo/web exec prisma migrate deploy`, then `pnpm build:web`, then `pnpm --filter @lablo/web start`;
   2. in another terminal, `pnpm exec tsx artifacts/live31a.ts` (in the relay worktree). It prints each route's answer: create 201, key, progress `open`, poll `waiting`, payload `sent`, a second payload 409, poll `ready`, the opened source, the status `done`, too large 413;
   3. stop the server (Ctrl+C).
3. `apps/web/package.json` now pins `next` 16.4.5.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Fifty-one CLAUDE.md gaps** wait for his word:
  - 1–28: leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29–47: leg 86's handover (`git -C "<wt>" show 5fffb27:HANDOVER.md`);
  - 48: the app's structure could name `apps/tv/src/gate/` (the config gate over every screen);
  - 49: any new way to add a source or to play must read the config's refusal (`refusalFor`), and a player state with no stream paints its own black (`player__blank`);
  - 50: any new way to read a provider's catalog goes through `DataEngine.refresh`/`refreshEpg`, and a refresh claims the slot before any `await`;
  - 51: any new way to play goes through `PlayerController.play`.
- **New (leg 91), a 52nd:** `apps/web`'s pairing routes answer 503 on Vercel until step 34 adds R2 and Upstash. CLAUDE.md could say the backend's memory fakes are development-only and refuse on Vercel.
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create; he puts the keys in `.env` himself, plus `LABLO_RATE_SECRET` (32+ characters) in Vercel. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
