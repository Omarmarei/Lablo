# Lablo IPTV: relay leg 99 opening prompt

You are leg 99 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–97 did steps 1–31d1 (PRs #1–#122). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 98 (2026-11-18) split step 31d2** (the TV's side of the M3U file) into **31d2a** (the file's bytes on the TV: `packages/data` and the data engine) and **31d2b** (the TV's add path and the stored file source), recorded three decisions, and **did 31d2a: PR #123, merge commit `0003795`**, green CI:
  - web: `test:web` 45, `e2e:web` 15 passed; verify: unit 6,188 with one skipped, `pnpm e2e` 148 passed; engines green;
  - media green on its **second rerun**: the first run hit the job's 30-minute cap in its last step after slow installs (`verify:media` itself passed), the first rerun failed the known `epg-declared-300mb` timing flake (66.6 ms vs 60).
  - The merge is recorded: RELAY.md ticks 31d2a with "Built in leg 98", "Verified in leg 98", "Done in leg 98" and a leg-98 progress-log row; architecture.md §3.2 has "Built in step 31d2a" with its "Verified locally", "Merged" and "Not yet" lines.
- **The decisions (RELAY.md under 31d2):**
  - **The frames open in the pair worker.** Measured: `openFileFrame` in the ingest worker made it 162.2 KB of its 150 KB budget (tweetnacl is kept whole, +32.8 KB; ADR-003's budget). The pair worker holds tweetnacl and lives as long as the pairing screen. Plain frames reach the ingest worker over a `MessageChannel` the app makes, one frame at a time, buffers transferred.
  - **A file that doesn't open is `unreachable`:** the protocol keeps its five statuses. The TV says why on its own screen (a new load error `file`), and the phone page words `unreachable` after a file as "Your TV couldn't read the file" (both in 31d2b).
  - **The relative URL** (`/dev/blob/…`) is resolved in the pair worker against the session's own base; `https://` is used as it is.
- **What 31d2a built:**
  - `packages/data/src/file-frames.ts`: `openFileFrames(source, {fileKey, base, size})` (each frame's exact ciphertext gathered across chunks and opened in place; a cut, changed, swapped, dropped frame or a byte past the end fails with `FileError`, code `file`; network failures pass through; a failure sticks and lets the download go); `serveFileFrames(port, frames, ended)` serves `read`/`cancel` on a port.
  - `PairService.file(port)` and `pairHandlers.file({port})`: only after a payload with a file was read (the session keeps `file`); `GET /v1/pair/s/:sid/file` with the poll token; 404 `gone`, 429 `rate`, other `status`, bad JSON or URL `malformed`, another key `file`; the blob's GET with no token, headers in 10 s, 403/404 or another `content-length` than `fileCipherLength(size)` are `file`. A `fileSeq` drops calls that a status, close, new code or second call overtook (`gone`). Results `PairFileResult` (`{ok: true, size}` or `{ok: false, failure: PairFileFailure}`).
  - `packages/data/src/file-feed.ts`: `feedResponse({port, size})`, the ingest worker's side (status 200, `content-length` = plain size; remote `file` → `IngestError('file')`, other → `NetworkError`; `cancel` tells the pair side). `FileFeed` type exported from `@lablo/data/client`.
  - Ingest: `IngestSource` gains `{type: 'm3u-file'}`; `LinkSource` = every other kind. `IngestRunRequest.file?: FileFeed`; `runIngest`'s file branch reads `options.file` through a shared `playlist(res)` helper (no validators, no panel; same bytes → `unchanged`); no feed → `IngestError('file', null, 'No file came with the job')`; `IngestErrorCode` gains `file`; the `finally` cancels a feed left part way.
  - `apps/tv/src/data/engine.ts`: `PairSession.file(): Promise<PairFileFeedResult>` (makes the `MessageChannel`, transfers `port1` to the pair worker, answers `{ok: true, feed: {port: port2, size}}`); `RefreshOptions.file` (transferred with `run`, single use); a file's refresh asks no blocklist; `sourceUrlOf(LinkSource)`. `ingestSourceOf` now returns `LinkSource`.
  - Sizes (`build:tv`): ingest worker 131.9 KB, pair worker 137.4 KB (of 150), main.js 455.7 / 443.0 KB (of 500).
  - Tests: unit 6,189 (+41): `file-frames.test.ts` 12, `file-feed.test.ts` 6, `pair-service.test.ts` +13, `ingest.test.ts` +6, `test/tv-data-engine.test.ts` +2, `test/pair-worker-bundle.test.ts` +1, `test/ingest-worker-bundle.test.ts` +1. Mutation `artifacts/mutate31d2a.py` 82/82.

## Read first
1. **`RELAY.md`:** step 31d2 (the split and the three decisions), 31d2a's shape and "Built/Verified/Done in leg 98" (the pattern to follow), **31d2b's line**, then 31e, 32, 33; the progress log's last rows (97, 98).
2. **`docs/architecture.md`:** §3.2 "Built in step 31c2a" (the pairing screen's add path), "Built in step 31d1", "Built in step 31d2a"; §3.3 "A. Pairing", step 4.
3. **For 31d2b:**
   - `packages/data/src/profile.ts` (`SourceRecord` line ~64, `PROFILE_MIGRATIONS` ~261, the `source` edit at ~621 replaces a record with the same id in place) and `profile.test.ts` (version pins at lines 61–101, plus the "current + 1" newer-version pins: memory iptv-data-layer-test-gotchas, leg 73);
   - `apps/tv/src/onboarding/engine-loader.ts` (`run`: the record at ~line 150, `ingestSourceOf`, `catalogOf`, `PASSED_ON`, `loadError`), `onboarding/loader.ts` (`LoadErrorCode`), `onboarding/form.ts` (`SourceDraft`);
   - `apps/tv/src/pairing/pair-draft.ts` (`m3u-file` returns `null` today; `statusFor`) and `pair-state.ts` (`pairActions`, `answered`, `begin`/`startLoad`, `select`'s `retry-load`);
   - `apps/tv/src/data/refresh-scheduler.ts` (~line 150: `ingestSourceOf(record)` for every stored source), `settings/sources-state.ts` (`SourceRow.type`, `shownHost(sourceUrlOf(ingestSourceOf(record)))` at ~99 and the blocklist URLs at ~150), `live/live-state.ts:296` (the short-EPG source), `movies/movies-state.ts:444` (`r.type === 'm3u'` playlists);
   - the phone page: `apps/web/src/phone/catalog.ts` (`done.unreachable` at lines 89 and 181), the done view in `PhonePage.tsx` and `state.ts`;
   - e2e: `e2e/pairing-api.spec.ts` and `e2e/api-front.ts` (31c3's `tv` project in `pnpm e2e:web`), `apps/web/e2e/phone-file.spec.ts` (`playlist()`, the upload), `apps/web/e2e/support.ts` (`Tv.fileUrl`, `Tv.download`); the old-engine pairing walk in `tools/engines` (runbook `old-engines.md`; leg 95's `forwardToHost`).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files.
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `ce3fa84` (PR #123's merge recorded), `72f2f0d` (31d2a's checks recorded), `b518063` (31d2a).
   - No `*.mutbak`: `find apps packages tools e2e test -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). It was 19 GB free this leg.
3. **Step 31d2b, the TV's add path and the stored file source.** Large: **split it first** (suggested: 31d2b1 = the source model, the loader, the schedule, Settings, the pairing screen's file path and the `file` error, with unit tests and mutation; 31d2b2 = the phone page's wording, the `tv`-project e2e with a real multi-frame file, the old-engine pairing walk with a file). Write the shape in RELAY.md before building, as legs 93–98 did. Design notes from leg 98 (decide and record; they are suggestions, not decisions):
   - **The feed reaches the loader through the draft:** `SourceDraft` gains `{type: 'm3u-file', name, epgUrls, feed: () => Promise<PairFileFeedResult>}` (pair-state builds `feed` from its session's `file`); the engine loader calls it after `slotFree` and right before `engine.refresh({src, source: {type: 'm3u-file'}}, {file})`; `gone`/`file` map to `LoadError('file')`, the rest to `network`. A feed serves one refresh.
   - **The stored source:** `SourceRecord` + `{id, type: 'm3u-file', name, added}`; profile version 8 (migration 7→8 changes nothing but `v`; an older app would read a file source as a link with no URL, and a newer document is one it never saves over; step 32's restore can refuse it), with the pins bumped and an upgrade test.
   - **Sent again:** a file whose name matches a stored file source's replaces that source's catalog under its id (favourites and places carry over; the `source` edit replaces in place); another name adds a source.
   - **Everything that reads a stored source:** `ingestSourceOf` → `LinkSource | null` (null for a file) and the schedule skips it; `catalogOf` gives `{src, type: 'm3u'}` (its header's guides come from the meta); the live screen's short EPG has none for a file; movies' playlists are every non-Xtream source; Settings › Sources shows "From a file" with no server and never blocked.
   - **The pairing screen:** `pairDraft` makes the file draft (a payload without a name gets a catalog default); a failed file offers only "Show a new code" (the blob goes with the status, so "Try again" can't fetch it); `LoadErrorCode` `file` with "The file from your phone couldn't be read. Send it again." in en and ar; `statusFor('file')` = `unreachable`. The pairing screen already cancels its load before the pair worker ends (`close`: `cancelLoad` then `endSession`); keep that order.
   - **The phone page:** `done.unreachableFile` (en, ar) shown for `unreachable` after a file (apps/web: `test:web`, `build:web`, `e2e:web`).
   - **Done when** (RELAY.md 31d2b): unit tests for each of the above; e2e in the `tv` project: a multi-frame file sent by a scripted phone fills the live list and the blob answers 404 after the status; the old-engine pairing walk with a file on Chromium 53 and 68 (the `MessageChannel` between two workers on a real old engine: the one thing 31d2a couldn't prove there); plus the common items.
4. **Then 31e,** the "no plaintext" test end to end (the real phone page in a second Playwright page at a phone's size opening `<front>/p#c=…&k=…`, the TV, the web app and the mock, for Xtream, M3U link and M3U file; the front's `forwarded` log and `lablo_e2e`'s rows and blobs are where to look for the secrets).
5. **Step 26's common items still apply to each step:** unit tests; mutation with the list written first (`artifacts/mutate31d2a.py` is the newest template; `sed -n '/^def run(cmd):/,$p' artifacts/mutate31d2a.py` gives the runner); the `pnpm verify` parts; `verify:engines --engine chrome53 --engine chrome68` when a TV-run page, a worker or the build changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; the PR merged on green CI; the docs; the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of `ce3fa84` (PR #123's merge recorded, 31d2a ticked), `72f2f0d`, `b518063` (31d2a), `ff628bb` (leg 97's handover).
- **`main`:** `0003795` (Merge PR #123). The relay branch is ahead of main only by `ce3fa84` and this handover; they go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:** `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`; `apps/web/.env`, `apps/web/src/generated/prisma`; `apps/web/.next` (built in leg 97; apps/web unchanged since); `dist/` (built this leg from 31d2a's source); `artifacts/`: `mutate31d2a.py`, `mutate31d2a.log`, `mutate31d2a-rerun.log`, `build-tv-measure98.log` (the 162.2 KB measurement), `build-tv-31d2a.log`, `engines-31d2a.log`, `e2e-31d2a.log`, `e2e-web-31d2a.log`, `unit-31d2a.log`, `lint-31d2a.log`, `typecheck-31d2a.log`, and earlier legs' files.
- **The `lablo-web` Postgres container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 98:**
- **`bytes[i] ^= 1` passes vitest but fails `pnpm typecheck`** (noUncheckedIndexedAccess covers tests in the root and package tsconfigs): write `bytes[i] = bytes[i]! ^ 1`, and run typecheck again after writing tests.
- **A real MessagePort can go into a worker-bundle test's vm realm:** the pipe must clone with `structuredClone(message, { transfer })`; the bundled worker then uses Node's MessagePort.
- **An ingest that ends `unchanged` still used a generation number:** the next commit is gen + 2.
- **The mutation run takes about 3 mutants a minute** when each runs 1–3 vitest files (83 took about 28 minutes). Run it in the background and write docs meanwhile; never build, test or commit while it runs.
- **CI media can be cancelled by its 30-minute cap in its last step** after slow ffmpeg and Playwright installs, with `verify:media` passed: read the steps' times. Rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done; the `epg-declared-300mb` flake may follow (rerun again).
- **One CI poller:** a foreground `until` loop on `gh run view <run> --json status` in 590 s chunks worked; a Monitor plus a second loop is one poller too many.
- **Heredocs with quotes inside Python patches failed again** (an `EOF`-quoted heredoc holding `'` in Python strings): write patch scripts with the Write tool, then run them.

**From earlier legs (still true):**
- **`git mv` stages the rename at once.** Run `git diff --cached --name-only` before every commit.
- **`pnpm e2e:web --project=phone <filter>`** (`--project` is variadic).
- **A "refuse before any request" check inside an `async` function rejects instead of throwing:** keep it in a synchronous wrapper.
- **vitest's `toEqual` on megabyte `Uint8Array`s takes seconds:** compare with `Buffer.from(a).equals(Buffer.from(b))`.
- **TS 5.7+:** a `Uint8Array<ArrayBufferLike>` isn't a `BodyInit` or `BlobPart`; type helpers `Uint8Array<ArrayBuffer>`.
- **A refusal sample must break exactly one rule.**
- **A TV build takes `?api=` only for loopback hosts.** Old-engine walks forward a container port with `forwardToHost` (`docker exec` socat).
- **The real `GET /v1/config` answers `private, max-age=300`:** a test's own config goes in before the TV's first request.
- **Root e2e specs have no `pg` types:** `createRequire(path.join(WEB, 'package.json'))('pg')` and a local interface.
- **New ways in go through the gates:** any new way to play through `PlayerController.play` (the blocklist); any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`. The file from the phone is one: its catalog has no server to check, its streams meet the blocklist at play time.
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component.
- **main.js is at 455.7 KB of 500 (Tizen);** steps 31d2b, 32 and 33 share about 44 KB; no lazy chunks. Workers: ingest 131.9, pair 137.4, config 133.9, query 129.5 of 150.
- **i18n arguments are isolated in English too:** compare with `stripIsolates` (TV) or strip FSI/PDI (phone page).
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.**
- **A manual clock races requests that register their sleeper later:** wait until the request is recorded (`sent.length`) before advancing.
- **Workers:** a worker started after the first paint needs its npm deps in `optimizeDeps.include`. Never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`.
- **Polyfill names to keep out of TV code:** a member named `flags` or `at`; `lastIndexOf` on arrays, `concat`, `URL`; regex `.test`, `trim`, `parseInt`. `artifacts/babel-polys30b2.ts <files>` lists a file's core-js modules.
- **TV code rules:** no `Array.prototype.sort` in the main bundle; none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine) in new TV files; physical CSS only; no CSS Grid or flex `gap`; ES2017; `packages/ui` components stay hook-free; UI text only from the catalogs.
- **Web backend (memory: iptv-web-backend-gotchas):** `next build` typechecks e2e files; `next start` locks `.next` (EBUSY); Playwright's `webServer` starts before `globalSetup`; `TaskStop` leaves `next start` running (kill the pid on its port); node-postgres reads `timestamp` as local time.
- **Python on Windows writes CRLF in text mode:** write with `newline=''` or `'\n'`.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI:** Node 22 there, Node 24 here. Known flakes, each rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `epg-declared-300mb` (media), media's 30-minute cap after slow installs, `auto-next.spec.ts` ar-SA `endEpisode`, Chromium 53/56 DevTools start-up. Wait ~45 s after `gh pr create`, then `gh run list -R Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 3 --json databaseId,status,headSha,event`. No `jq`: use `gh --jq`. A failed job's log: `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`. Never push to a PR while its CI runs. Timings this leg: web 2 m, verify 11 m, engines 24 m, media 30 m (capped), then 3 and about 8 m on reruns.
- **A bare `sleep` is blocked:** `timeout N tail -f /dev/null` or an `until` loop.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths; scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line. Never bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI on `pull_request`, path-filtered; commits with the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in CI (PR #123):** web (`test:web` 45, `e2e:web` 15), verify (unit 6,188 + 1 skipped, `pnpm e2e` 148), engines, media (after two reruns).
- **Verified locally:** lint, typecheck, unit 6,189, `build:tv` sizes, `pnpm e2e` 148, `pnpm e2e:web` 15/15, `verify:engines --engine chrome53 --engine chrome68` 22/22 (onboarding and pairing walks, vectors 217/217), the bundled pair and ingest workers with a file in the Chromium 53 test realm, mutation 82/82.
- **Not verified:** the `MessageChannel` between two real workers on a real old engine (31d2b's walk); the pairing screen adding a file (31d2b); the real phone page driving the TV (31e); a real phone's file picker; anything on Vercel or R2 (step 34).
- **Migrations and deploys:** none. Nothing is in production; nothing is deployed.

## Open decisions and gates
- **31d2b:** the shape (and its split), the profile's version 8, "sent again under the same name replaces", the draft carrying the feed. The leg's own calls; record them in RELAY.md.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in the phone page's `connect-src` and the bucket's CORS rule (PUT from the page's origin, GET from any); `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; the Arabic `done.body` (`{name} جاهز.`) is masculine for a feminine name like "قائمة"; `auto-next.spec.ts`'s `endEpisode` race; `epg-declared-300mb`'s single-sample budgets (six reruns in about ten PRs: a best-of-3 would be a small CI fix to propose).
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set); 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`: `pnpm exec vitest run packages/data/src/file-frames.test.ts packages/data/src/file-feed.test.ts`. Expect 18 passed (the phone's file opened frame by frame, every broken shape refused).
2. Nothing to click yet: the pairing screen adds a file from step 31d2b.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94 (not running in legs 95–98). Please close it during relay runs.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-four CLAUDE.md gaps** wait for his word: 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`), 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`), 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`).
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
