# Lablo IPTV: relay leg 101 opening prompt

You are leg 101 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–99 did steps 1–31d2b1 (PRs #1–#124). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 100 (2026-11-18)** split step 31d2b2 (the file sent from a phone, end to end) into **31d2b2a** (the stand-in, the scripted phone, `e2e/pairing.spec.ts`, the old-engine walk) and **31d2b2b** (the real API's `tv` project and the phone page's wording). It recorded four decisions under 31d2b2 in RELAY.md and **did 31d2b2a: PR #125, merge commit `9eccf9e`, green CI on the first run**:
  - web: `e2e:web` 15 passed (1 m 39 s);
  - verify: unit 6,272 with one skipped, `pnpm e2e` 150 passed (12 m 53 s);
  - engines: all 126 runs as expected on Chromium 53, 56 and 68 (the Arabic walk's file among them), 89 seeded failures caught, vectors 217/217 (20 m 54 s);
  - media: green (21 m 2 s).
- **The merge is recorded:** RELAY.md ticks 31d2b2a with its "Built", "Verified" and "Done in leg 100" lines and a leg-100 progress-log row. architecture.md §3.2 has "Built in step 31d2b2a" with its "Tests", "Mutation", "Verified locally", "Merged" and "Not yet" lines.
- **The decisions (RELAY.md under 31d2b2):**
  - **The stand-in's blob uses development's URL shape:** `/dev/blob/pair/<sid>/<fileId>?m=PUT|GET&n=<size>&e=<exp>&s=<token>`, honoured only exactly as given and before `e`. The TV resolves the path against its API base, as against `next start`.
  - **The old-engine walk:** English keeps the link; Arabic sends the staged playlist as a file padded to three frames.
  - **A broken file** is one bit flipped in its last frame after sealing: the first frames reach the ingest worker before it fails.
  - **The file's frames are copied over the `MessageChannel`, never transferred** (see the bug below).
  - **Arabic `done.body` is «تمت إضافة {name}.»** ("{name} was added"). The old «{name} جاهز.» was masculine and read wrong after the file's feminine default name «قائمة من هاتفك».
- **A real bug the walk found, fixed in 31d2b2a:** on Chromium 53 a message posted on a `MessagePort` with an `ArrayBuffer` in its transfer list arrives as `null`. A staged two-worker page proved it (56 and 68 deliver the transfer). So `serveFileFrames` (31d2a) never got a frame to the ingest worker on 53, and the load sat in its "checking" phase. `packages/data/src/file-frames.ts` now copies each frame (`read: () => frames.read()`).
- **What 31d2b2a built:**
  - **The stand-in** (`tools/engines/src/pair-stand-in.ts`):
    - `answer(…, body: Uint8Array)` and `standInPath`;
    - `POST /v1/pair/:code/upload-url`, the blob's PUT and GET, `GET /v1/pair/s/:sid/file`, the file deleted with the status;
    - `blobs` (the keys held) and each session's `uploads`, for the tests;
    - `pair-server.ts` and `e2e/config-server.ts` route `standInPath` to it.
  - **The scripted phone** (`pair-phone.ts`): `phoneSendsFile(origin, code, plain, {name?, epg?, broken?})` and `phonePadded(text, frames)`.
  - **`e2e/pairing.spec.ts`** +2 tests: a broken file then a three-frame file, in English in onboarding and in Arabic from Settings (no name sent). Helpers `mockFile(guideQuery)`, `uploadsSealed`, `brokenFile`. Screenshots `artifacts/screenshots/pair-file-{failed,loading,done,sources}-{en,ar}.png` were looked at.
  - **The walk** (`pairing.ts`, `verify-engines.ts`): `PHONE_SENDS`, `FILE_FRAMES`, `PairingOptions.playlist`, `PairWalk.sent` and `blobs`, `heldFiles` (the walk's own session's files only).
  - **Tests:** unit +19 (`pair-stand-in.test.ts` 8, `pair-server.test.ts` +7, `pairing.test.ts` +3, `file-feed.test.ts` +1, with a port that drops a transferred buffer as Chromium 53 does). Mutation `artifacts/mutate31d2b2a.py`: 59 written first (three gaps closed while writing), 59/59.
  - **Sizes:** main.js 458.7 / 446.0 KB (unchanged); pair worker 137.3 KB.

## Read first
1. **`RELAY.md`:**
   - step 31d2b2 (its split and the decisions);
   - 31d2b2a (the shape, "Built/Verified/Done in leg 100", the pattern to follow);
   - **31d2b2b's shape**;
   - then 31e, 32 and 33;
   - the last rows of the progress log (99, 100).
2. **`docs/architecture.md` §3.2:**
   - "Built in step 31c3" (the `tv` project);
   - "Built in step 31d1" (the phone's file form, `/dev/blob`);
   - "Built in step 31d2b1";
   - "Built in step 31d2b2a".
3. **For 31d2b2b:**
   - `e2e/pairing-api.spec.ts` (its `withFront`, `apiCode`, `sessionRow`, `preflightsPassed`) and `e2e/api-front.ts` (`forwarded` records `{method, path with query, status}`);
   - `e2e/pairing.spec.ts`'s new file tests (`mockFile`, `brokenFile`, `uploadsSealed`) and `tools/engines/src/pair-phone.ts`;
   - the phone page: `apps/web/src/phone/state.ts` (the `sendAnswer` and done view), `PhonePage.tsx`, `catalog.ts` (`done.unreachable` at about lines 89 and 181);
   - `apps/web/e2e/phone-file.spec.ts` (its Arabic test reports `unreachable` after a file: its expected text becomes the file's);
   - `apps/web/src/server/pair.ts` (`pairStatus` deletes the blob; the row's `fileId`).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `ab06d5c` (PR #125's merge recorded), `3c7f4da` (31d2b2a), `971e706`;
   - no `*.mutbak`: `find apps packages tools e2e test -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). It was 19.2–19.4 GB free this leg, yet a background lint/typecheck/unit run was still reaped (see the gotchas).
3. **Step 31d2b2b: the file through the real API, and the phone page's wording.** Its shape is already in RELAY.md; write any refinements there before building.
   - **`e2e/pairing-api.spec.ts` (`tv` project, `pnpm e2e:web`):**
     - a three-frame file sent by the scripted phone through the front (`phoneSendsFile(front.origin, code, plain, {name})`: the upload URL, the PUT to the relative `/dev/blob/…` path resolved against the front, the payload) fills the live list;
     - the TV's own blob GET appears in `front.forwarded` (`GET /dev/blob/pair/<sid>/<fileId>?m=GET&…`, status 200); GET that path again after the status: 404;
     - the same file sent again from Settings › Sources › "Add from your phone" under the same name replaces the source: one source, the same id `s1`, the same `added`;
     - the session's row keeps no payload and no `fileId` (add `"fileId"` to `sessionRow`'s select);
     - preflights passed, no page errors.
   - **The phone page's `done.unreachableFile`** ("Your TV couldn't read the file", en and ar) for `unreachable` after a file: `state.ts` keeps what was sent; `PhonePage.tsx`; `catalog.ts`. Covered by `test:web`, `build:web`, `e2e:web` (`phone-file.spec.ts`'s Arabic `unreachable` now reads the file's words).
   - **Plus the common items:** mutation of the phone page's wording and the new e2e helpers (if any are testable in unit tests); the PR merged on green CI with its `web` job; the docs (architecture.md "Built in step 31d2b2b", runbook `web.md` "The M3U file"); then tick 31d2b2b **and 31d2b2, 31d2b, 31d2 and 31d** (each is ticked when its parts are).
4. **Then 31e,** the "no plaintext" test end to end:
   - the real phone page in a second Playwright page at a phone's size, opening `<front>/p#c=…&k=…`, with the TV, the web app and the mock;
   - for Xtream, M3U link and M3U file;
   - where to look for the secrets: the front's `forwarded` log, and `lablo_e2e`'s rows and blobs.
5. **Step 26's common items still apply to every step:**
   - unit tests;
   - mutation with the list written first (`artifacts/mutate31d2b2a.py` is the newest template; `sed -n '/^def run(cmd):/,$p' artifacts/mutate31d2b2a.py` gives the runner, with `--from`/`--to` for chunks);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page, a worker or the build changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - the PR merged on green CI;
   - the docs, and the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of:
  - `ab06d5c` (PR #125's merge recorded, 31d2b2a ticked);
  - `3c7f4da` (31d2b2a);
  - `971e706` (leg 99's handover);
  - `29cd85e` (PR #124's merge recorded).
- **`main`:** `9eccf9e` (Merge PR #125). The relay branch is ahead of main only by `ab06d5c` and this handover; both go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next` (built in leg 97; apps/web unchanged since);
  - `dist/` (built this leg from 31d2b2a's final source);
  - `artifacts/`:
    - `mutate31d2b2a.py` and `.log`;
    - `e2e-pairing-31d2b2a.log`, `engines-31d2b2a.log`, `build-tv-31d2b2a.log`, `lint-31d2b2a.log`;
    - `typecheck-31d2b2a.log` (the reaped run);
    - `diag53.ts` (one walk on one engine, with every stand-in request logged and the pair screen's state);
    - `repro-channel.html` and `repro-run.ts` (an ES5 page with two workers on one channel, run on each engine);
    - `engines/` (the last run's report, screenshots and staged variants);
    - `screenshots/pair-file-*.png`;
    - earlier legs' files.
- **The `lablo-web-postgres-1` container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 100:**
- **Chromium 53 drops a `MessagePort` message whose transfer list holds an `ArrayBuffer`:** it arrives with `data === null`. 56 and 68 deliver it, and a worker's own `postMessage` is not affected. In TV code, never pass a transfer list to a port's `postMessage` (RPC `ctx.transfer` on a port served with `serveRpc`); copy. Node's `MessageChannel` delivers the transfer, so only the old-engine walk catches it (memory: iptv-chromium53-messageport-transfer).
- **To probe an old-engine behaviour,** stage a plain ES5 page in `artifacts/engines/variants/` and drive it with `startEngine` and CDP: `pnpm exec tsx artifacts/repro-run.ts <page> chrome53 chrome56 chrome68`. To watch one pairing walk with every stand-in request logged: `pnpm exec tsx artifacts/diag53.ts chrome53 3` (it needs `artifacts/engines/variants/app` staged from `dist/tv`: copy `dist/tv/tizen` and `dist/tv/webos` there).
- **The walk's stand-in lives through every engine:** count a walk's state per session (`heldFiles`), never server-wide. Chromium 53's failed walks had failed 68's.
- **A header guide another source already read is not read again,** so the load never stops in its guide phase: give the file's guide a query of its own (`mockFile('from=phone&')`) to hold it with the guide gate.
- **The stand-in's `uploads` are megabytes:** drop them from `JSON.stringify(sessions)` with a replacer, and check them as latin1.
- **A reaped background run of lint/typecheck/unit:** `pnpm typecheck`'s `pnpm -r --parallel` starts a dozen `tsc` at once (one died with 0xC0000142). Don't restart the reaped run. Instead, in the foreground:
  - `tsc --noEmit -p` per changed package;
  - the test files that import the changed modules (`pnpm exec vitest run --maxWorkers=3 <dirs>`: 3,780 tests in 19 s);
  - the mutation run in chunks (`--to 19`, `--from 20 --to 40`, `--from 41`), each under the tool's 10 minutes.

  CI's `verify` is the gate for the whole suite.
- **Heredocs:** a `\\n` inside Python code in `python - <<'EOF'` or `cat > x.py <<'EOF'` reached the file as a real newline (twice this leg). For any string with a backslash, use the Edit tool, or Write the whole patch script.
- **Timings this leg:**
  - local: `verify:engines` on 53 and 68 about 10 minutes; one engine for a diagnosis about 1 minute;
  - CI: web 1 m 39 s, verify 12 m 53 s, engines 20 m 54 s, media 21 m 2 s.

**From earlier legs (still true):**
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`. Grep `v: N\b` before committing; the "current + 1" pins move too.
- **A reaped background `pnpm e2e`** shows "worker process exited unexpectedly (code=3221225794)" and "newPage: Target crashed": infrastructure, not test failures.
- **Start CI waits with `run_in_background` from the first call:** `until [ "$(gh run view R -R Omarmarei/Lablo --json status --jq .status)" = completed ]; do timeout 60 tail -f /dev/null; done; gh run view R … --json conclusion,jobs`. Then end the turn and wait for the notice.
- **`bytes[i] ^= 1` passes vitest but fails `pnpm typecheck`:** write `bytes[i] = bytes[i]! ^ 1`.
- **A real MessagePort can go into a worker-bundle test's vm realm** with `structuredClone(message, { transfer })`.
- **`git mv` stages the rename at once:** run `git diff --cached --name-only` before every commit.
- **`pnpm e2e:web --project=phone <filter>`** (`--project` is variadic).
- **A "refuse before any request" check inside an `async` function rejects instead of throwing:** keep it in a synchronous wrapper.
- **vitest's `toEqual` on megabyte `Uint8Array`s takes seconds:** compare with `Buffer.from(a).equals(Buffer.from(b))`.
- **TS 5.7+:** a `Uint8Array<ArrayBufferLike>` isn't a `BodyInit` or `BlobPart`; type helpers as `Uint8Array<ArrayBuffer>`.
- **A refusal sample must break exactly one rule.**
- **A TV build takes `?api=` only for loopback hosts.** Old-engine walks forward a container port with `forwardToHost` (`docker exec` socat).
- **The real `GET /v1/config` answers `private, max-age=300`:** a test's own config goes in before the TV's first request.
- **Root e2e specs have no `pg` types:** use `createRequire(path.join(WEB, 'package.json'))('pg')` and a local interface.
- **New ways in go through the gates:**
  - any new way to play goes through `PlayerController.play` (the blocklist);
  - any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`.

  The phone's file has no server to check; its streams meet the blocklist at play time.
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component.
- **main.js is at 458.7 KB of 500 (Tizen);** steps 31d2b2b, 32 and 33 share about 41 KB, and there are no lazy chunks. Workers: ingest 131.9, pair 137.3, config 133.9, query 129.6 KB of 150.
- **i18n arguments are isolated in English too:** compare with `stripIsolates` (TV) or strip FSI/PDI (phone page).
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.**
- **A manual clock races requests that register their sleeper later:** wait until the request is recorded (`sent.length`) before advancing.
- **Workers:** a worker started after the first paint needs its npm deps in `optimizeDeps.include`. Never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`.
- **Polyfill names to keep out of TV code:**
  - members named `flags` or `at`;
  - `lastIndexOf` on arrays, `concat`, `URL`;
  - regex `.test`, `trim`, `parseInt`. (They are fine in a file whose module already has them: probe with `artifacts/babel-polys30b2.ts <files>`, before and after.)
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine);
  - no transfer list on a `MessagePort` (leg 100);
  - physical CSS only, no CSS Grid or flex `gap`;
  - ES2017;
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs.
- **Web backend (memory: iptv-web-backend-gotchas):**
  - `next build` typechecks e2e files;
  - `next start` locks `.next` (EBUSY);
  - Playwright's `webServer` starts before `globalSetup`;
  - `TaskStop` leaves `next start` running (kill the pid on its port);
  - node-postgres reads `timestamp` as local time.
- **Python on Windows writes CRLF in text mode:** write with `newline=''` or `'\n'`.
- **Windows Smart App Control:** before every pnpm command, run `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI:** Node 22 there, Node 24 here.
  - **Known flakes**, each rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done:
    - `epg-declared-300mb` (media);
    - media's 30-minute cap after slow installs;
    - `auto-next.spec.ts` ar-SA `endEpisode`;
    - Chromium 53/56 DevTools start-up (it failed once locally this leg too, in the repro runner).
  - **After `gh pr create`:** wait ~45 s, then `gh run list -R Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 3 --json databaseId,status,headSha,event`.
  - No `jq`: use `gh --jq`. A failed job's log: `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`. Never push to a PR while its CI runs.
- **A bare `sleep` is blocked:** use `timeout N tail -f /dev/null` or an `until` loop.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request`, path-filtered;
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data;
  - README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in CI (PR #125):**
  - web (`e2e:web` 15);
  - verify (unit 6,272 + 1 skipped, `pnpm e2e` 150);
  - engines (126 runs as expected on 53/56/68, the Arabic walk's file among them);
  - media.
- **Verified locally:**
  - lint, and typecheck per changed package;
  - unit 3,780 in the covering files;
  - `build:tv`;
  - `pnpm e2e` pairing + onboarding specs: 16;
  - the eight screenshots looked at;
  - `verify:engines` on 53 and 68: 22/22;
  - mutation 59/59;
  - the two-worker channel page on 53, 56 and 68.
- **Not run locally:** the whole unit suite and the whole `pnpm e2e` (a background run was reaped; CI ran both).
- **Not verified:**
  - the file through the real API in the `tv` project (31d2b2b);
  - the real phone page driving the TV (31e);
  - a real phone's file picker;
  - a real TV (the old engines are desktop Chromium builds);
  - anything on Vercel or R2 (step 34).
- **Migrations and deploys:** none. Profile version 8 lives in each TV's own IndexedDB; nothing is in production or deployed.

## Open decisions and gates
- **31d2b2b:** none open beyond its shape; the wording "Your TV couldn't read the file" is in RELAY.md already.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in the phone page's `connect-src`, and the bucket's CORS rule (PUT from the page's origin, GET from any);
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):**
  - the guides screen's "read, last try failed" rows clip their third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - `epg-declared-300mb`'s single-sample budgets (a best-of-3 would be a small CI fix to propose).
  - (The Arabic `done.body` was fixed in 31d2b2a.)
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`, run `pnpm exec vitest run tools/engines/src/pair-stand-in.test.ts tools/engines/src/pair-server.test.ts packages/data/src/file-feed.test.ts`. Expect 27 passed: the stand-in's file routes, the scripted phone's file, and a port that drops a transferred buffer as Chromium 53 does.
2. Nothing to click: the pairing screen's file path ran in Chromium (`pnpm e2e`) and on Chromium 53, 56 and 68 in CI's old-engine walk. The CI run's `old-engines-report` artifact has the walk's screenshots (`pairing-<engine>-<platform>-ar-done.png`).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94 (not running since). Please close it during relay runs. Even without it, background runs were reaped in legs 99 and 100.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`) and read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word:
  - 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`);
  - 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`);
  - 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`);
  - **55 (new):** the Chromium 53 cheat sheet should say "no transfer list on a `MessagePort`'s `postMessage`: a transferred `ArrayBuffer` arrives as `null` on 53; copy". It's in this handover (the commit "docs: add leg-100 handover").
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
