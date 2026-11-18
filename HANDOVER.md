# Lablo IPTV: relay leg 97 opening prompt

You are leg 97 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–95 did steps 1–31c2 (PRs #1–#120). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 96 (2026-11-18) did step 31c3**, the TV's pairing against the real API, and so ticked step 31c (31c1, 31c2 and 31c3 are all merged). **PR #121, merge commit `4238123`**, green CI:
  - verify: `pnpm e2e` 148 passed, unit 6,071 with one skipped;
  - web: `e2e:web` 12 passed, 5 of them the new TV cases;
  - engines: all 126 runs as expected, 89 seeded failures caught;
  - media: green on a rerun after the known `epg-declared-300mb` flake (70.9 ms against 60).
  - The merge is recorded: RELAY.md ticks 31c3 and 31c, with "Built in leg 96", "Verified in leg 96", "Done in leg 96" and a leg-96 progress-log row; architecture.md §3.2 has "Built in step 31c3" with its "Merged" line.
- **What 31c3 built:**
  - **`e2e/pairing-api.spec.ts`**, 5 tests in `pnpm e2e:web`'s new project `tv`. The TV's Vite dev app runs with `?api=` set to a test front before `next start`; the mock provider runs in-process, and the scripted phone talks over HTTP. The cases:
    1. Xtream by phone; the phone reads `open`, `received` (while the mock's `/player_api.php` is held), then `ok`.
    2. An M3U link with a guide link, from Settings, in Arabic: `ok`.
    3. On one screen, each with a new code: a wrong password (`auth_failed`), the mock's `expired`/`expired-test` account (`expired`), a just-closed port (`unreachable`).
    4. A served blocklist holding 127.0.0.1: `blocked` (Arabic).
    5. A served `block-new-sources`: `blocked`.
    - Each case also checks the `PairSession` row in `lablo_e2e` (status, payload gone, `deliveredAt`), the IndexedDB profile, the API's 204 preflights, and that the page logged no errors.
  - **`e2e/api-front.ts`** (`startApiFront`): a pass-through that drops only `HOP_HEADERS` and sets each test's own `x-forwarded-for`. `GET /v1/config` reaches the real route unless `serve(text)` was called. The `forwarded` log keeps method, path and the API's status.
  - **`e2e/pairing-steps.ts`**: helpers shared with `pairing.spec.ts`: `storedProfile`, `shoot`, `shownCode`, `openSources`, `usePhone`, `SHOTS`. `onboard.ts` now exports `toSourceTypes`.
  - **`playwright.web.config.ts`**:
    - projects `phone` (Pixel 7, `apps/web/e2e`) and `tv` (Desktop Chrome at 1920×1080, `e2e/`, only `pairing-api.spec.ts`);
    - a `webServer` list: `next start` on 3101 and the TV's Vite on 5393 (`LABLO_WEB_E2E_TV_PORT`).
    - The root `playwright.config.ts` ignores the spec.
  - **`test/api-front.test.ts`**: 13 tests. Mutation `artifacts/mutate31c3.py`: 42/42.
  - **CI:** the `web` job's path filter now also takes `apps/(tv|mock-provider)/`, `packages/*/src/`, the spec's e2e helpers, and `tools/engines/src/(pair-phone|pair-server|pair-stand-in|config).ts`. It uploads `pair-api-*.png` with `phone-screenshots`.
  - **Docs:** runbook `web.md` "The TV's pairing against the API (step 31c3)", its commands row and its CI paragraph.

## Read first
1. **`RELAY.md`:**
   - step 31's later items: 31d (the M3U file relay), 31e (the "no plaintext" test end to end);
   - then steps 32 and 33;
   - 31c3's shape and its "Built in leg 96" lines (the pattern to follow);
   - the progress log's last rows (95, 96).
2. **`docs/architecture.md`:**
   - §3.2: "Built in step 31a" (the pairing API: the upload-url and file routes, `fileId`, the blob path `pair/<sid>/<fileId>`), the phone page (31b), "Built in step 31c1/31c2a/31c3";
   - §3.3 "A. Pairing", step 4: the file frames.
3. **For 31d:**
   - `packages/crypto/src/pairing.ts` (`sealFileFrame`, `openFileFrame`, lines ~109–120);
   - `packages/protocol/src/pairing.ts` (`presignedFile` with its `^https://` rule at ~line 55; `pairUploadResponseSchema`; the `m3u-file` source with `pairFileSchema` at ~line 113);
   - `apps/web/src/server/blob-store.ts` (`MemoryBlobStore`: `baseUrl` defaults to `http://127.0.0.1:3100/dev/blob`; `redeem` answers a presigned request);
   - `apps/web/src/server/pair.ts` (the upload-url and file routes);
   - the phone page `apps/web/src/phone/` (`form.ts`, `flows.ts`, `api.ts`: the only file allowed `fetch`, relative `/v1/pair/` paths only, enforced by `test/lint-web-outbound.test.ts`);
   - the TV: `apps/tv/src/pairing/pair-draft.ts` (`m3u-file` returns `null` until 31d), `packages/data/src/pair-service.ts`, and the M3U ingest (`packages/data/src/ingest.ts`, `ingest-service.ts`, `ingest.worker.ts`);
   - runbook `web.md` "Pairing" (`LABLO_DEV_BLOB_URL`).
4. **`CLAUDE.md`:** "Package boundaries" (`apps/web` imports only `protocol` and `crypto`), "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files.
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `ae04cfb` (PR #121's merge recorded), then `f23d322` (31c3).
   - No `*.mutbak` exists: `find apps packages tools e2e -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). It was 19.4 GB free this leg.
3. **Step 31d, the M3U file relay.** It is large; split it first if one leg can't hold it (for example 31d1: protocol, crypto and web routes plus the phone's file form; 31d2: the TV's frame-by-frame ingest and the e2e). Write the shape in RELAY.md before building, as legs 93–96 did.
   - **The decision RELAY.md leaves open:** how a development URL (`http://`) passes the upload schema's `^https://` rule. Two candidates seen in leg 96:
     - **(a)** the schema allows `http://` only for loopback hosts (127.0.0.1, localhost), like the TV's `readApiBase`. Production URLs (R2) are always https. This leaves a phone on the LAN needing `LABLO_DEV_BLOB_URL`.
     - **(b)** the memory store presigns relative `/dev/blob/<key>?…` paths, which the phone and the TV resolve against the API origin. This works on a LAN phone without configuration. The schema would take `^https://` or a `/dev/blob/` path, and `api.ts`'s lint exception already allows only relative paths.
     - Pick one and record why.
   - **The rest, per RELAY.md:**
     - the phone's file form: 1 MiB frames, each `sealFileFrame`d, uploaded through the presigned PUT; `fileKey`, the nonce base and the size go in the boxed payload;
     - a `/dev/blob/<key>` route in development and e2e, never on Vercel;
     - the TV: the presigned GET, then `openFileFrame` frame by frame into the M3U ingest, with no whole-file copy; a frame that fails to open ends the add;
     - an IndexedDB store only if the ingest needs one (then a database version bump with an upgrade test from version 2).
   - **Done when:** unit tests (frames; a cut, swapped or changed frame refused); an e2e where a multi-frame file sent from the phone page is ingested on the TV and the blob is gone after the status; plus the common items. The TV side's e2e can reuse 31c3's `tv` project and `api-front.ts`.
4. **Then 31e,** the "no plaintext" test end to end. It needs the real phone page (a second Playwright page in the phone viewport, opening the TV's QR link `<front>/p#c=…&k=…`), the TV, the web app and the mock, for Xtream, M3U link and M3U file. The front's `forwarded` log and `lablo_e2e`'s rows and blobs are where to search for the secrets.
5. **Step 26's common items still apply to each step:**
   - unit tests;
   - mutation with the list written first. `artifacts/mutate31c3.py` is the newest template; `sed -n '/^def run(cmd):/,$p' artifacts/mutate31c3.py` gives the runner's tail.
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page or the build changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - the PR merged on green CI;
   - the docs;
   - the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of:
  - `ae04cfb` (PR #121's merge recorded, steps 31c3 and 31c ticked);
  - `f23d322` (31c3);
  - `94f2463` (leg 95's handover);
  - `45da6fb` (PR #120's merge recorded).
- **`main`:** `4238123` (Merge PR #121). The relay branch is ahead of main only by `ae04cfb` and this handover; they go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`;
  - `apps/web/.next`: built this leg from the merged source (no apps/web change since);
  - `dist/` (a build of 31c2a's source; no TV code changed since);
  - `artifacts/`:
    - `mutate31c3.py` and its log;
    - `e2e-web-31c3.log`, `e2e-web-tv-31c3.log` (the first run with the refusal case failing), `e2e-web-tv-repeat-31c3.log`, `e2e-pairing-31c3.log`;
    - `lint-31c3.log`, `typecheck-31c3.log`, `unit-31c3.log`, `build-web-31c3.log`;
    - `screenshots/pair-api-*.png`;
    - leg 95's files.
- **The `lablo-web` Postgres container is up** (`pnpm web:db:down` stops it).
- **No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.**

## Gotchas and lessons
**New in leg 96:**
- **The real `GET /v1/config` answers `cache-control: private, max-age=300`.** In a browser e2e, a config refresh within 5 minutes is answered from the browser's cache and never reaches the front. A test that needs its own config serves it before the TV's first request (`front.serve(...)` before `page.goto`). The first refusal case failed this way: it read the committed config and added the source.
- **Root e2e specs have no `pg` types:** load `pg` with `createRequire(path.join(WEB, 'package.json'))` and type it with a local interface (see `pairing-api.spec.ts`).
- **A "closed port" case uses a just-closed server's port.** Port 1 and others are Chromium's unsafe ports, a different failure. The refused connection logs "Failed to load resource: net::ERR_CONNECTION_REFUSED" as a page console error: filter that line.
- **A `cd "<wt>" && …` compound moves the session's working directory,** and a later `gh` call reset it to the main checkout. Keep using absolute paths and `git -C`; never run pnpm or git in the main checkout.
- **Testing a proxy's answer headers:** a client can't see the hop-by-hop ones, because the front's own server writes its own `connection`/`keep-alive`. Test `answerHeaders` as a function, and the call site by the upstream's `connection: close` not coming back.
- **The CI `web` job now runs on most code PRs** (about 6 minutes); `verify` took 10 m, engines 21 m.

**From earlier legs (still true):**
- **`git mv` stages the rename at once.** Run `git diff --cached --name-only` before every commit.
- **A TV build takes `?api=` only for loopback hosts.** Old-engine walks forward a container port with `forwardToHost` (`docker exec` socat). The desktop dev app takes any origin.
- **New ways in go through the gates:**
  - any new way to play goes through `PlayerController.play` (it checks the blocklist);
  - any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`. An M3U file from the phone is a new way in.
- **The pairing payload's links must carry their scheme** (`^https?://`).
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component.
- **main.js is at 455.4 KB of 500 (Tizen).** Steps 32 and 33 have about 44 KB; the TV build has no lazy chunks. The file relay's TV code belongs in the pair or ingest worker, not in main.
- **i18n arguments are isolated in English too:** compare with `stripIsolates`.
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.**
- **The mutation run edits source files:** never commit, build or run e2e while it runs, and check for `*.mutbak` after a stop.
- **Workers:** a worker started after the first paint needs its npm deps in `optimizeDeps.include`. Never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`.
- **Polyfill names to keep out of TV code:**
  - a member named `flags` or `at`;
  - `lastIndexOf` on arrays, `concat`, `URL`;
  - regex `.test`, `trim`.

  `artifacts/babel-polys30b2.ts <files>` lists a file's core-js modules.
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - none of these in new TV files: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine);
  - physical CSS only; no CSS Grid or flex `gap`; ES2017;
  - `packages/ui` components stay hook-free; UI text only from the catalogs.
- **Web backend (memory: iptv-web-backend-gotchas):**
  - `next build` typechecks e2e files;
  - `next start` locks `.next` (EBUSY);
  - Playwright's `webServer` starts before `globalSetup`;
  - `TaskStop` leaves `next start` running: kill the pid on its port;
  - node-postgres reads `timestamp` as local time.
- **Python on Windows writes CRLF in text mode:** write with `open(p, 'wb')`. Use the Write tool for long scripts (Bash heredocs to Python break on mixed quotes).
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI:**
  - CI runs Node 22; this PC runs Node 24.
  - Known flakes, each rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done:
    - `epg-declared-300mb` (media; again in leg 96);
    - `auto-next.spec.ts` ar-SA `endEpisode`;
    - Chromium 53/56 DevTools start-up.
  - One CI poller: wait ~45 s after `gh pr create`, then `gh run list --commit <sha> --event pull_request`, then one Monitor with the `comm -13` loop over `gh run view <run> --json status,conclusion,jobs`.
  - There is no `jq`: use `gh --jq`. A failed job's log comes from `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`.
  - Never push to a PR while its CI runs (it cancels the run).
- **A bare `sleep` is blocked:** use `timeout N tail -f /dev/null` or an `until` loop.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths; scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and is path-filtered;
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified, in CI (PR #121):**
  - verify (148 e2e, unit 6,071 + 1 skipped);
  - web (`e2e:web` 12, the TV's 5 against `next start`);
  - engines (126 runs, 89 seeded failures caught);
  - media (on a rerun).
- **Verified, locally:**
  - lint, typecheck, unit 6,072;
  - `e2e:web` 12/12, plus the `tv` project `--repeat-each 3` 15/15;
  - `pairing.spec.ts` 3/3;
  - mutation 31c3 42/42;
  - screenshots `pair-api-*` looked at.
- **Not verified:**
  - a real phone scanning a real TV's screen;
  - the real phone page driving the TV (31e);
  - the M3U file relay (31d);
  - anything on Vercel (step 34).
- **Migrations and deploys:** none. Nothing is in production; nothing is deployed.

## Open decisions and gates
- **31d:** the http/https upload URL in development, (a) or (b) above. It's the leg's own call; record it in RELAY.md.
- **Later UI and test fixes (no step yet):**
  - the guides screen's "read, last try failed" rows clip their third line;
  - the Arabic `done.body` (`{name} جاهز.`) is masculine for a feminine name like "قائمة" (seen again in `pair-api-done-ar.png`);
  - `auto-next.spec.ts`'s `endEpisode` race.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the 2018 set;
  - 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`, with `pnpm web:db` up: `pnpm build:web`, then `pnpm e2e:web --project tv`. Expect "5 passed".
2. Look at `artifacts/screenshots/pair-api-code-en.png`: the address is the front's `127.0.0.1:<port>/p`, the code is in two groups of four, and the QR code is on the right.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94 (it was not running in legs 95–96). Please close it during relay runs.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-four CLAUDE.md gaps** wait for his word:
  - 1–28: leg 51's handover (`git show d05d5fd:HANDOVER.md`);
  - 29–47: leg 86's (`git show 5fffb27:HANDOVER.md`);
  - 48–54: leg 93's (`git show 081c1ee:HANDOVER.md`).
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
