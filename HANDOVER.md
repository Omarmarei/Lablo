# Lablo IPTV: relay leg 96 opening prompt

You are leg 96 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–94 did steps 1–31c1 and built 31c2a (PRs #1–#118). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 95 (2026-11-18) finished step 31c2** (both halves), merged on green CI:
  - **31c2a, the TV's pairing screen and its add path** (built by leg 94): mutation batches B and C run, the gaps closed, the nearby e2e and the engines checked. **PR #119, merge commit `c015e7a`.**
  - **31c2b, the pairing screen on the old engines** (built this leg). **PR #120, merge commit `e920e85`.**
  - The merges are recorded: RELAY.md ticks 31c2, 31c2a and 31c2b, with a leg-95 progress-log row; architecture.md §3.2 has "Built in step 31c2a" and "Built in step 31c2b", each with its "Merged" line.
- **What 31c2b built** (`tools/engines/src`):
  - `pair-server.ts`: `startPairServer()` runs 31c2a's `PairStandIn` in a Node server on the host (`0.0.0.0` on Linux, `127.0.0.1` with Docker Desktop). `answerPair()` is shared with `e2e/config-server.ts`.
  - `docker.ts`: `forwardToHost(container, 8091, hostPort)`. A TV build takes `?api=` only for a loopback host (`readApiBase`), so each container's own `127.0.0.1:8091` is forwarded to the host by the image's socat (`docker exec --detach`). The image is unchanged.
  - `pair-phone.ts`: the scripted phone, moved from `e2e/` and shared by the e2e and the harness.
  - `pairing.ts`:
    - `pairing` is now a screen of the `app` variant (`variants.ts`'s `APP_SCREENS`). `runPairing` walks "Use your phone" in en and ar on both bundles.
    - `PAIR_EXPRESSION` (ES5) reads the screen.
    - The checks: the code; the address; the QR code module by module against `encodeQr` of `<api>/p#c=<code>&k=<tvPk>` (`drawnModules`, `qrSidePx`, `qrFailures`); whole pixels, `crispEdges`, no transform, on the end side; the safe area; the phone's `done`/`ok`; the profile.
  - `variants.ts`: `PAIR_SEEDS`, with `seed-pair-qr-mirrored` (`--self-test`, must fail on every engine).
  - CI:
    - the engines job uploads `pairing-*.png`;
    - its timeout went from 25 to 35 minutes (126 runs now; the job took about 21 minutes).
  - docs/runbooks/old-engines.md item 7 and the self-test table describe it.

## Read first
1. **`RELAY.md`:** step 31's later items (31c3, 31d, 31e), then 32 and 33; the progress log's last rows (94, 95).
2. **`docs/architecture.md`** §3.2: "Built in step 31a" (the pairing API), the phone page's section (step 31b), "Built in step 31c2a", "Built in step 31c2b"; §3.3 "A. Pairing".
3. **For 31c3:**
   - `playwright.web.config.ts` (its `webServer` runs `next start` on 127.0.0.1);
   - `apps/web/e2e/` (`global-setup.ts`, `phone.spec.ts`, `support.ts`);
   - docs/runbooks/web.md, "Pairing";
   - `e2e/pairing.spec.ts` and `tools/engines/src/pair-phone.ts` (the scripted phone);
   - `.github/workflows/ci.yml`'s `web` job and its path filter.
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files.
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `45da6fb` (PR #120's merge recorded), then `aa81741`.
   - No `*.mutbak` exists: `find apps packages tools -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). It was 20 GB free this leg (`voicebox-server` was not running).
3. **Step 31c3, the pairing e2e against `next start`** (CI's `web` job). Refine its shape in RELAY.md before building, as legs 93–95 did:
   - **What runs:**
     - `next start` and its Postgres (`lablo_e2e`);
     - the TV's dev app (Vite), with `?api=` set to the `next start` origin. The desktop dev app takes any origin.
     - the mock provider (in-process `buildServer`);
     - the scripted phone (`tools/engines/src/pair-phone.ts`) against the real API over HTTP.
   - **Cases:**
     - an Xtream login added;
     - an M3U link added;
     - a wrong password gives `auth_failed`;
     - a blocklisted host gives `blocked`;
     - the config's refusal mode gives `blocked`;
     - the phone reads each status.
   - **To decide (the leg's call; record it):**
     - Does Playwright get a second `webServer` (the TV's Vite), or does globalSetup start it?
     - How does the real API's `/v1/config` serve a dev-signed config with a blocklist and the refusal mode in the e2e (31a and 30's runbooks; `config/keys.json` trusts the dev key in dev builds only)?
     - The real API's CORS for the TV dev app's origin (31a's TV routes have the TV's CORS).
     - Rate limits (`LABLO_RATE_SECRET` in the e2e env).
     - Whether the web job's path filter must also take `apps/tv/` (it now runs on `apps/web/`, `packages/(protocol|crypto)/`, `config/` and the web configs).
   - **Done when:** the e2e passes locally and in CI's `web` job; plus the common items.
4. **Then 31d** (the M3U file relay; decide how the memory store's `http` development URLs pass `pairUploadResponseSchema`'s https rule) **and 31e** (the "no plaintext" test end to end).
5. **Step 26's common items still apply to each step:**
   - unit tests;
   - mutation with the list written first. `artifacts/mutate31c2b.py` is the newest template; `sed -n '/^def run(cmd):/,$p' artifacts/mutate31c2a.py` gives the runner's tail.
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page or the build changes;
   - the PR merged on green CI;
   - the docs;
   - the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of:
  - `45da6fb` (PR #120's merge recorded);
  - `aa81741`, `365701e` (31c2b);
  - `b2f4745` (PR #119's merge recorded);
  - the 31c2a commits.
- **`main`:** `e920e85` (Merge PR #120). The relay branch is ahead of main only by the docs commits after it (`45da6fb` and this handover); they go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/` (a build of 31c2a's merged source; 31c2b changed no TV code);
  - `artifacts/`:
    - `mutate31c2a.py` and its `-a/-b/-c/-rerun` logs;
    - `mutate31c2b.py` and its log;
    - `engines-31c2a.log`, `engines-31c2b-{53,53-self,68}.log`;
    - `engines/pairing-*.png`;
    - `e2e-near-31c2a.log`, `e2e-pairing-31c2b.log`, `unit-31c2a-l95.log`, `build-tv-31c2a-l95.log`, `typecheck-31c2b.log`.
- **The `lablo-web` Postgres container is up** (`pnpm web:db:down` stops it).
- **No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.**

## Gotchas and lessons
**New in leg 95:**
- **`git mv` stages the rename at once.** A later `git add <docs> && git commit` commits it too: a docs commit carried the phone's move, with a broken e2e import. It was fixed before the push with `git reset --soft HEAD~1` and `git restore --staged`. Run `git diff --cached --name-only` before every commit (memory: git-mv-staged-rename).
- **A TV build takes `?api=` only for loopback hosts.** Any old-engine walk that needs a host server forwards a container port with `forwardToHost` (`docker exec` socat). Never give it `host.docker.internal`.
- **Mutation lessons:**
  - Node ≥ 19's `server.close()` drops idle keep-alive connections itself. `closeAllConnections()` only shows with a request still coming in.
  - A fake DOM's `querySelectorAll` must honour its selector, and its boxes should be fractional.
  - A helper checked only against itself needs one literal (`pairLink`).
  - A cancel before `nav.pop()` is equivalent when the screen's subscriber closes on the pop.
  - A cancelled wait that keeps sleeping is invisible when `done` rejects at once: count the sleeps.
- **The stand-in's phone-route 404s carry no CORS** (the phone page is same-origin). The TV routes and the harness server's own 404s carry `access-control-allow-origin: *`.
- **CI flakes seen this leg** (each passed on `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run was done):
  - `e2e/auto-next.spec.ts` (ar-SA): `endEpisode` dispatched `ended` while the next play was still `opening` (`data-plays` 6). A fix would wait for the held stream request first. No step yet.
  - Chromium 56's DevTools not answering within 60 s (engines; the same start-up flake as leg 93's 53).
- **Pushing to a PR right after `gh pr create` cancels its first run.** That is fine when it is minutes old (the timeout fix this leg); otherwise never push while a PR's CI runs.

**From earlier legs (still true):**
- **New ways in go through the gates:**
  - any new way to play goes through `PlayerController.play` (it checks the blocklist);
  - any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`.
- **The pairing payload's links must carry their scheme** (`^https?://`). A scripted phone sending `host/path` makes the TV treat the payload as unreadable.
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component.
- **main.js is at 455.4 KB of 500 (Tizen).** Steps 32 and 33 have about 44 KB; the TV build has no lazy chunks.
- **i18n arguments are isolated in English too:** compare with `stripIsolates`.
- **A new `FailureCategory` in `@lablo/player`** needs an entry in `PlayerScreen.tsx`'s `CATEGORY_TEXT`.
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.** The engine loader now waits for it (`SLOT_WAIT_MS`).
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
- **Web backend (memory):**
  - `next build` typechecks e2e files;
  - `next start` locks `.next` (EBUSY);
  - Playwright's `webServer` starts before `globalSetup`;
  - `TaskStop` leaves `next start` running: kill the pid on its port.
- **Python on Windows writes CRLF in text mode:** write with `open(p, 'wb')` or `newline=''`. Bash heredocs to Python break on mixed quotes: use the Write tool for long scripts.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI:**
  - CI runs Node 22; this PC runs Node 24.
  - The known media flake is `epg-declared-300mb`.
  - One CI poller: wait ~45 s after `gh pr create`, then `gh run list --commit <sha> --event pull_request`, then one Monitor with the `comm -13` loop over `gh run view <run> --json status,conclusion,jobs`.
  - There is no `jq`: use `gh --jq`. A failed job's log comes from `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs` (`--log-failed` waits for the whole run).
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
- **Verified, in CI:**
  - PR #119: verify (148 e2e) and engines (114 runs, 83 seeded failures caught).
  - PR #120: verify, media, web, and engines (126 runs on 53, 56 and 68, 89 seeded failures caught; the pairing walk passed on every engine).
- **Verified, locally:**
  - unit 6,029; `tools/engines` 320;
  - e2e near the change 28/28;
  - engines 53 and 68, and 53 `--self-test`;
  - mutation 31c2a 115/117 (2 equivalent), 31c2b 39/39;
  - screenshots on 53 looked at.
- **Not verified:**
  - a real phone scanning a real TV's screen;
  - the pairing flow against the real API from the TV (31c3);
  - anything on Vercel (step 34).
- **Migrations and deploys:** none. Nothing is in production; nothing is deployed.

## Open decisions and gates
- **31c3's shape:** the leg's own call (listed above). Record it in RELAY.md.
- **31d:** how the memory store's `http` development URLs pass `pairUploadResponseSchema`'s https rule.
- **Later UI and test fixes (no step yet):**
  - the guides screen's "read, last try failed" rows clip their third line;
  - the Arabic `done.body` (`{name} جاهز.`) is masculine for a feminine name like "قائمة";
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
1. In the main checkout after `git pull`: `pnpm exec vitest run apps/tv/src/pairing tools/engines/src/pairing.test.ts`. Expect 5 files, all passing.
2. `pnpm build:tv`, then `pnpm verify:engines --engine chrome53`. Expect "all 11 runs as expected", with two `pairing PASS` lines. Look at `artifacts/engines/pairing-chrome53-tizen-ar-code.png`: the QR code on the left, the code left to right.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94 (it was not running in leg 95). Please close it during relay runs.
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
