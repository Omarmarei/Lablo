# Lablo IPTV: relay leg 98 opening prompt

You are leg 98 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–96 did steps 1–31c (PRs #1–#121). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 97 (2026-11-18) split step 31d** (the M3U file relay) into **31d1** (the file's way up and down: protocol, web route, phone page) and **31d2** (the TV's side), decided the open question, and **did 31d1: PR #122, merge commit `bd75914`**, green CI on the first run:
  - web: `test:web` 45, `e2e:web` 15 passed;
  - verify: unit 6,147 with one skipped, `pnpm e2e` 148 passed;
  - engines: all 126 runs as expected, 89 seeded failures caught, the vectors page 217/217 on Chromium 53, 56 and 68;
  - media: green.
  - The merge is recorded: RELAY.md ticks 31d1 with "Built in leg 97", "Verified in leg 97", "Done in leg 97" and a leg-97 progress-log row; architecture.md §3.2 has "Built in step 31d1" with its "Merged" line.
- **The decision (RELAY.md under 31d, architecture.md "Built in step 31d1"):** development's presigned URLs are **paths on the API's own origin**, `/dev/blob/<key>?m=…&n=…&e=…&s=…`.
  - The phone page and the TV resolve them against the address they reach the API at.
  - So a LAN phone needs nothing set, the page's `connect-src 'self'` holds, and 31e's test front sees the file's bytes.
  - `presignedUrlSchema` (exported from `@lablo/protocol`) takes `https://` (R2) or exactly that path shape: no other host, no dots, nothing escaped.
  - `LABLO_DEV_BLOB_URL` is gone.
- **What 31d1 built:**
  - **`apps/web/src/app/dev/blob/[...key]/route.ts`** over `src/server/dev-blob.ts` (`devBlob`):
    - `PUT` and `GET` through `MemoryBlobStore.redeem` with the request's path and query;
    - the PUT body read with a cap of the URL's own size (`readBytes`, new in `http.ts`; `readJsonBody` now uses it);
    - the GET answers `application/octet-stream` with `access-control-allow-origin: *` (on refusals too); the PUT has no CORS headers;
    - every answer `no-store`; 404 on Vercel and whenever the services' store isn't the memory one.
  - **`MemoryBlobStore`'s default base is `DEV_BLOB_PATH` (`/dev/blob`).** `services.ts` makes it without options.
  - **The phone page's third type, "M3U playlist file"** (`src/phone/form.ts`, `state.ts`, `flows.ts`, `api.ts`, `catalog.ts`, `PhonePage.tsx`, `phone.css`):
    - the file is read one 1 MiB frame at a time (`File.slice`, `pickedFile`), each frame `sealFileFrame`d under a fresh key and nonce base (`encryptFile`), the frames joined into one `Blob`;
    - then `uploadUrl(code, fileCipherLength(size))`, the `PUT` (`api.upload`, only to a URL `presignedUrlSchema` takes), then the payload `{v: 1, source: {type: 'm3u-file', file: {key, fileKey, base, size}}, name?, epg?}` (`withFile`), sealed to the TV's key;
    - refused on the field: no file (`noFile`), an empty one (`empty`), one over `FILE_MAX_BYTES` = 41,942,400 (`large`);
    - a file that can't be read, or changed size, is forgotten (`fileUnreadable`: "This file couldn't be read. Choose it again.");
    - an unnamed file names its source after itself (`nameFromFile`: no `.m3u`/`.m3u8`, cut to 80);
    - the input is visually hidden, its label is the button; the chosen name and size show under it (`fileSize`: KB under a MiB, else MB to a tenth); en and ar.
  - **Tests:** `apps/web/test/dev-blob.test.ts` (10, new); `phone-flows` +19, `phone-state` +5, `phone-code-form` +17, `phone-catalog` +25; 8 protocol samples. e2e `apps/web/e2e/phone-file.spec.ts` (3, in the `phone` project), with `Tv.fileUrl()` and `Tv.download(url)` added to `apps/web/e2e/support.ts`.
  - **Mutation:** `artifacts/mutate31d1.py` 97/97 (91 first; four gaps closed, two equivalents simplified).
  - **Docs:** runbook `web.md` "The M3U file (step 31d1)", the lint paragraph, the blob store's paragraph; `eslint.config.js`'s comment on `PHONE_API_RULES`.

## Read first
1. **`RELAY.md`:** step 31d (the split and the decision), 31d1's shape and "Built in leg 97" lines (the pattern to follow), **31d2's line** (what it must do, and the ingest worker's budget note), then 31e, 32, 33; the progress log's last rows (96, 97).
2. **`docs/architecture.md`:** §3.2 "Built in step 31a" (the routes, `GET /v1/pair/s/:sid/file`), "Built in step 31c1" (`PairService`, the pair worker), "Built in step 31c2a" (the screen and its add path), "Built in step 31d1"; §3.3 "A. Pairing", step 4.
3. **For 31d2:**
   - `packages/crypto/src/pairing.ts`: `openFileFrame`, `fileCipherLength`, `fileFrameCount`, `FILE_FRAME_BYTES` (+16-byte tag per frame);
   - `packages/protocol/src/pairing.ts`: `pairFileSchema`, `pairFileUrlResponseSchema`, `presignedUrlSchema`;
   - `packages/data/src/pair-service.ts` (no file call yet: add one for `GET /v1/pair/s/:sid/file`, Bearer poll token, after the read; 409 before, 404 without a file) and `pair.worker.ts`;
   - `apps/tv/src/pairing/pair-draft.ts` (`m3u-file` returns `null` today) and `pair-state.ts` (`unreadable` path, ~line 308);
   - the ingest: `packages/data/src/ingest.ts` (`runIngest`, the `m3u` branch reads `transport.get(url)` into `M3uCatalogParser`), `ingest-service.ts`, `ingest.worker.ts`, `bytes.ts` (`ByteTransport`, `ByteResponse`);
   - the source model: `packages/data/src/profile.ts` (`SourceRecord`: only `xtream` and `m3u` with a `url`), `apps/tv/src/onboarding/engine-loader.ts` (`ingestSourceOf`, `catalogOf`, the record made at ~line 154), `apps/tv/src/data/engine.ts` (`sourceUrlOf` for the blocklist check), `apps/tv/src/data/refresh-scheduler.ts`, `apps/tv/src/settings/sources-state.ts`, `apps/tv/src/live/live-state.ts:296`, `movies/movies-state.ts:444`, `packages/data/src/short-epg.ts`, `epg-sources.ts`.
4. **`CLAUDE.md`:** "Package boundaries" (`apps/web` imports only `protocol` and `crypto`), "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files.
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `672fcac` (PR #122's merge recorded), then `feb0c3f` (31d1).
   - No `*.mutbak`: `find apps packages tools e2e -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). It was 20–21 GB free this leg.
3. **Step 31d2, the TV's side of the file.** Large: split it first if one leg can't hold it (for example 31d2a: the decrypting stream and the new source kind in `packages/data` with unit tests and worker sizes; 31d2b: the screen's add path, Settings and the e2e). Write the shape in RELAY.md before building, as legs 93–97 did. **Decisions the leg must make and record:**
   - **Where the frames open.** `build:tv` this leg: the ingest worker is **129.4 KB of 150**, the pair worker 133.6 KB (already holds tweetnacl), main.js 455.4 of 500. tweetnacl is about 40 KB (leg 83's measure: the whole of it is kept). Candidates: open in the pair worker and hand plain chunks to the ingest worker (a cross-worker stream through main or a `MessageChannel`), or measure what tweetnacl's `secretbox` alone costs in the ingest worker. Measure before choosing.
   - **The stored source.** A file source has no link to refresh from (the blob is deleted at the status). A new `SourceRecord` kind (e.g. `{id, type: 'm3u-file', name, added}`), never refreshed by the schedule, shown "from a file" in Settings › Sources, updated by sending it again from the phone; everything that branches on `'m3u'` (list in "Read first") must handle it; `sourceUrlOf` has no URL for the blocklist (decide: nothing to check, or the file's stream hosts are checked at play time already by `PlayerController.play`). Decide whether the profile's version must change (an older app must not misread the new kind) and, if so, an upgrade test.
   - **The status for a file that doesn't open** (a cut, swapped or changed frame, or a length other than `fileCipherLength(size)`): one of the five (`unreachable`?) or a sixth in the protocol.
   - **The relative URL:** the file URL is `/dev/blob/…` in development; the TV resolves it against its API base (`readApiBase` / the worker's base), an `https://` one is used as is.
   - **Done when** (RELAY.md 31d's line): unit tests (frames opened in place; a cut, swapped or changed frame refused; the length checked); an e2e in 31c3's `tv` project (`e2e/pairing-api.spec.ts`, `api-front.ts`) where a multi-frame file sent by phone fills the live list and the blob is gone after the status; plus the common items. A scripted phone for the file can reuse `apps/web/e2e/phone-file.spec.ts`'s `playlist()` and `@lablo/crypto`'s `sealFile`.
4. **Then 31e,** the "no plaintext" test end to end (the real phone page in a second Playwright page at a phone's size opening `<front>/p#c=…&k=…`, the TV, the web app and the mock, for Xtream, M3U link and M3U file; the front's `forwarded` log and `lablo_e2e`'s rows and blobs are where to look for the secrets). Since 31d1, the file's PUT and GET pass through the front too (relative URLs).
5. **Step 26's common items still apply to each step:** unit tests; mutation with the list written first (`artifacts/mutate31d1.py` is the newest template; `sed -n '/^def run(cmd):/,$p' artifacts/mutate31d1.py` gives the runner); the `pnpm verify` parts; `verify:engines --engine chrome53 --engine chrome68` when a TV-run page or the build changes; `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes; the PR merged on green CI; the docs; the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of `672fcac` (PR #122's merge recorded, 31d1 ticked), `feb0c3f` (31d1), `c7f0c62` (leg 96's handover).
- **`main`:** `bd75914` (Merge PR #122). The relay branch is ahead of main only by `672fcac` and this handover; they go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:** `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`; `apps/web/.env`, `apps/web/src/generated/prisma`; `apps/web/.next` (built this leg from 31d1's source); `dist/` (built this leg; no TV code changed); `artifacts/`: `mutate31d1.py` and `mutate31d1.log`, `mutate31d1-rerun.log`, `engines-31d1.log`, `e2e-web-31d1.log`, `e2e-web-file-31d1.log`, `e2e-vectors-31d1.log`, `build-web-31d1.log`, `build-tv-31d1.log`, `lint-31d1.log`, `typecheck-31d1.log`, `unit-31d1.log`, `test-web-31d1.log`, `speed31d1.ts` (tweetnacl throughput), `screenshots/phone-file-*.png`, and earlier legs' files.
- **The `lablo-web` Postgres container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 97:**
- **`pnpm e2e:web --project phone <file>` fails** ("Project(s) '<file>' not found"): `--project` is variadic. Write `--project=phone <filter>`.
- **A "refuse before any request" check inside an `async` function rejects instead of throwing:** keep it in a synchronous wrapper that returns the async call (as `codePath` and `api.upload` do).
- **vitest's `toEqual` on megabyte `Uint8Array`s takes seconds:** compare with `Buffer.from(a).equals(Buffer.from(b))`. tweetnacl's `secretbox` runs at ~160 MiB/s in Node here (`artifacts/speed31d1.ts`); a 2018 TV may be ~10x slower.
- **TS 5.7+:** a `Uint8Array<ArrayBufferLike>` isn't a `BodyInit` or `BlobPart`; type helpers `Uint8Array<ArrayBuffer>`.
- **A refusal sample must break exactly one rule** (a `//evil.example` sample also failed on its dots, so the `//` mutant lived).
- **Bash heredocs with quotes inside Python patches failed again:** write patch scripts with the Write tool, then run them.

**From earlier legs (still true):**
- **`git mv` stages the rename at once.** Run `git diff --cached --name-only` before every commit.
- **A TV build takes `?api=` only for loopback hosts.** Old-engine walks forward a container port with `forwardToHost` (`docker exec` socat). The desktop dev app takes any origin.
- **The real `GET /v1/config` answers `private, max-age=300`:** a test's own config goes in before the TV's first request (`front.serve(...)` before `page.goto`).
- **Root e2e specs have no `pg` types:** `createRequire(path.join(WEB, 'package.json'))('pg')` and a local interface.
- **New ways in go through the gates:** any new way to play through `PlayerController.play` (the blocklist); any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`. **The M3U file from the phone is a new way in.**
- **The pairing payload's links carry their scheme** (`^https?://`).
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component.
- **main.js is at 455.4 KB of 500 (Tizen);** steps 32 and 33 have about 44 KB; no lazy chunks. The ingest worker is at 129.4 KB of 150.
- **i18n arguments are isolated in English too:** compare with `stripIsolates` (TV) or strip FSI/PDI (phone page).
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.**
- **The mutation run edits source files:** never commit, build or run e2e while it runs; check for `*.mutbak` after a stop.
- **Workers:** a worker started after the first paint needs its npm deps in `optimizeDeps.include`. Never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`.
- **Polyfill names to keep out of TV code:** a member named `flags` or `at`; `lastIndexOf` on arrays, `concat`, `URL`; regex `.test`, `trim`. `artifacts/babel-polys30b2.ts <files>` lists a file's core-js modules.
- **TV code rules:** no `Array.prototype.sort` in the main bundle; none of `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine) in new TV files; physical CSS only; no CSS Grid or flex `gap`; ES2017; `packages/ui` components stay hook-free; UI text only from the catalogs.
- **Web backend (memory: iptv-web-backend-gotchas):** `next build` typechecks e2e files; `next start` locks `.next` (EBUSY); Playwright's `webServer` starts before `globalSetup`; `TaskStop` leaves `next start` running (kill the pid on its port); node-postgres reads `timestamp` as local time.
- **Python on Windows writes CRLF in text mode:** write with `newline='\n'` or `'wb'`.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI:** Node 22 there, Node 24 here. Known flakes, each rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done: `epg-declared-300mb` (media), `auto-next.spec.ts` ar-SA `endEpisode`, Chromium 53/56 DevTools start-up. One CI poller: wait ~45 s after `gh pr create`, `gh run list -R Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 3 --json databaseId,status,headSha,event` (`--commit` with a short sha found nothing this leg), then one Monitor with the `comm -13` loop over `gh run view <run> --json status,conclusion,jobs`. No `jq`: use `gh --jq`. A failed job's log: `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`. Never push to a PR while its CI runs. Timings this leg: web 2 m, verify 10 m, engines 24 m, media 29 m.
- **A bare `sleep` is blocked:** `timeout N tail -f /dev/null` or an `until` loop.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths; scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line. Never bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI on `pull_request`, path-filtered; commits with the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in CI (PR #122):** web (`test:web` 45, `e2e:web` 15), verify (unit 6,147 + 1 skipped, `pnpm e2e` 148), engines (126 runs, 89 seeded failures, vectors 217/217 on 53/56/68), media.
- **Verified locally:** lint, typecheck, unit 6,148, `test:web` 45, `build:web`, `e2e:web` 15/15, `build:tv` (sizes unchanged but the pair worker +0.1 KB), `crypto-vectors.spec.ts`, `verify:engines` 53+68 22/22, mutation 97/97, screenshots `phone-file-form-{en,ar}` and `phone-file-problems-en` looked at.
- **Not verified:** the TV opening the file (31d2); the real phone page driving the TV (31e); a real phone with a real file picker (iOS's picker with no `accept` filter, Android's); anything on Vercel or R2 (step 34).
- **Migrations and deploys:** none. Nothing is in production; nothing is deployed.

## Open decisions and gates
- **31d2:** where the frames open (the worker budgets), the stored source kind and the profile's version, the status for a file that doesn't open. The leg's own calls; record them in RELAY.md.
- **For step 34 `[needs Omar]`:** the R2 and Upstash adapters; **R2's host in the phone page's `connect-src` and the bucket's CORS rule (PUT from the page's origin, GET from any)**; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):** the guides screen's "read, last try failed" rows clip their third line; the Arabic `done.body` (`{name} جاهز.`) is masculine for a feminine name like "قائمة"; `auto-next.spec.ts`'s `endEpisode` race.
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set); 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`, with `pnpm web:db` up: `pnpm build:web`, then `pnpm e2e:web --project=phone phone-file`. Expect "3 passed".
2. Look at `artifacts/screenshots/phone-file-form-en.png` and `phone-file-form-ar.png`: the third type "M3U playlist file", the "Choose another file" button, the chosen file's name and size under it.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94 (not running in legs 95–97). Please close it during relay runs.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-four CLAUDE.md gaps** wait for his word: 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`), 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`), 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`).
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
