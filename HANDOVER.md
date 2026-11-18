# Lablo IPTV: relay leg 102 opening prompt

You are leg 102 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–100 did steps 1–31d2b2a (PRs #1–#125). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 101 (2026-11-18) finished step 31 (pairing):** two PRs, both green on the first CI run.
  - **31d2b2b: PR #126, merge commit `be0eb3a`.** With it, 31d2b2, 31d2b, 31d2 and 31d (the M3U file relay) are ticked.
    - `e2e/pairing-api.spec.ts` (`tv` project, real API): a three-frame file sent by the scripted phone through the test front fills the live list (12 channels). The front's log has the phone's PUT and the TV's GET of one blob, and the blob answers 404 after the status.
    - While the front holds the TV's download, the session's row keeps no payload and the blob's id as `fileId`; after the status it keeps neither. Every `tv` test now reads the row's `fileId`.
    - A changed file (3 channels) sent again from Settings under the same name replaces `s1`, keeping the same `added`.
    - New test-front feature: `ApiFront.hold({method, prefix, until})`. A held request whose caller gave up is never sent on and opens no connection.
    - The phone page: the `progress`/`done` views carry `sentType` (what this page sent for that code; `null` on the QR path when the code was already sent to). `statusKey(status, sentType)` in `catalog.ts` gives `done.unreachableFile` ("Your TV couldn’t read the file. Check that it’s the playlist file your provider sent, then try again.", en and ar) for `unreachable` after a file.
    - Mutation `artifacts/mutate31d2b2b.py`: 24/24.
  - **31e: PR #127, merge commit `eab3874`** (step 31's own "Done when").
    - `e2e/no-plaintext.spec.ts` (`tv` project) uses the **real phone page**, in a Pixel 7 browser context of its own, opened at `<front>/p` and typing the TV's code. It runs once for each source type:
      - an Xtream login (onboarding, English);
      - an M3U link with a guide link (Settings, Arabic);
      - an M3U file of three frames (onboarding).
    - **The haystack** (searched after the send and again at the end):
      - everything the web app received: each request's line, headers and whole body (`ApiFront.received`); the uploads' bodies are the blobs;
      - every row of every table in `lablo_e2e`, read while the TV's reads are held and again at the end.
    - **`leaks` (`e2e/no-plaintext.ts`)** finds each secret as text, JSON-escaped, percent-encoded, or inside decoded base64/base64url. Nothing was found.
    - **Controls:** the TV's own profile and the plain file do contain the secrets.
    - Mutation `artifacts/mutate31e.py`: 21/21. Two phone-page leak mutants were caught by the search itself: the plain payload beside the sealed one, and the file uploaded unsealed at its sealed length.
- **Both merges are recorded:**
  - RELAY.md ticks 31d2b2b, 31d2b2, 31d2b, 31d2, 31d, 31e and 31, with "Built/Verified/Done in leg 101" lines and a leg-101 progress-log row;
  - architecture.md §3.2 has "Built in step 31d2b2b" and "Built in step 31e", each with a "Merged" line;
  - runbook `web.md` has "The M3U file" updated and a new "no plaintext" section.

## Read first
1. **`RELAY.md`:**
   - step 31's sub-steps, for the pattern: a shape written before building, then "Built", "Verified" and "Done in leg …" lines;
   - **step 32 (Backup)**, then 33, 34 and 35;
   - the progress log's last rows (99–101).
2. **`docs/architecture.md`:**
   - **§3.3 B "Backup"** (about line 1760): deviceSecret, master, lookupId, writeToken, encKey/localKey, the envelope, restore, upload schedule, threat model, settings;
   - §3.2's endpoint table: `PUT/GET/DELETE /v1/backup/:lookupId`, envelope ≤ 512 KB, `X-Write-Token`;
   - the `Backup` table (line ~1557);
   - the storage table's row for phone files (line ~777);
   - the crypto primitives already built in step 29b1 (line ~1799: `backupSalt`, `deriveBackupMaster`, `backupKeys`, `tokenHash`, `sealBackup`/`openBackup`);
   - S3 (device IDs, line ~2134).
3. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.
4. **Memory:**
   - iptv-crypto-gotchas: scrypt 2^15 takes about 1 s on Chromium 53 and 3 s on 56;
   - iptv-webos-acg: a new luna call needs its ACG group in `LUNA_ACG`;
   - iptv-web-backend-gotchas;
   - iptv-data-layer-test-gotchas: a profile bump pins several tests.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `e1e6b85` (PR #127's merge recorded), `ccf519d` (31e) and `01f1d5a`;
   - no `*.mutbak`: `find apps packages tools e2e test -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`); it was 15.7–19.3 GB free this leg. Run unit, e2e and mutation in the **foreground**: only background shells get reaped while idle.
3. **Step 32 (Backup): split it first.** It is far too large for one leg. Write the split, its shape and its decisions in RELAY.md before building, as leg 91 did for 31. A split to start from:
   - **32a, the API** (`apps/web`):
     - `PUT/GET/DELETE /v1/backup/:lookupId` with `X-Write-Token`; the server keeps `tokenHash(writeToken)` on the first write;
     - an envelope of at most 512 KB, rate limits, CORS for the TV;
     - the `Backup` table's migration, on the local and test databases only;
     - unit tests, a protocol schema with samples, `test:web`.
   - **32b, the TV's master key:**
     - the device secret: Tizen DUID, webOS LGUDID through luna (its ACG group), and the fallback "Backup code";
     - `deriveBackupMaster` in a worker (seconds on old engines), cached in IndexedDB;
     - the lookup ID, write token, encryption key and local key.
   - **32c, upload and restore:**
     - upload 60 s after a change, at most every 5 minutes, and when the app is hidden;
     - at startup with no profile: derive, GET, open, "Welcome back", re-ingest in the background.
   - **32d, Settings and the proof:**
     - Settings toggles (backup on, "include login details") and the backup code's screen;
     - the e2e "a simulated webOS wipe restores automatically" (step 32's "Done when");
     - the old-engine walk.
4. **Decisions step 32 will meet.** Decide them and write each with its why, as earlier legs did. Stop for Omar only if one has real trade-offs he should own.
   - **Phone files can't be restored from the TV.** The storage table says phone-sent M3U files live in IDB `blobs` (gzipped) and join the backup if ≤ 5 MB. But 31d2b1 stores a file source with **no bytes** (`{id, type: 'm3u-file', name, added}`), and the envelope cap is 512 KB.
     - Likely answer: a restored file source asks to be sent again from the phone.
     - Alternative: keep the file's bytes, which needs a profile/IDB change.
   - **"Credentials on the TV encrypted with `localKey`"** would change how the profile stores a source: a profile version 9 and its pins.
   - **The fallback "Backup code"** when there is no device ID: when it shows, and how a user types it after a wipe.
   - **What exactly goes in the envelope:** the profile (sources, guides, favourites, places, settings) versus derived data that can be re-ingested.
5. **Step 26's common items still apply to every step:**
   - unit tests;
   - mutation with the list written first (`artifacts/mutate31e.py` is the newest template; `sed -n '/^def run(cmd):/,$p' artifacts/mutate31e.py` gives the runner, with `--from`/`--to` for chunks);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page, a worker or the build changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - the PR merged on green CI;
   - the docs, and the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of:
  - `e1e6b85` (PR #127's merge recorded; 31e and 31 ticked);
  - `ccf519d` (31e);
  - `01f1d5a` (PR #126's merge recorded; 31e's shape written);
  - `3c9345e` (31d2b2b);
  - `e85772d` (leg 100's handover).
- **`main`:** `eab3874` (Merge PR #127). The relay branch is ahead of main only by `e1e6b85` and this handover; both go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`;
  - `apps/web/.next`, built clean from 31e's final source after the mutation runs;
  - `dist/`, from leg 100 (no TV code changed since);
  - `artifacts/`:
    - `mutate31d2b2b.py` and `.log`, `mutate31e.py` and `.log`;
    - `e2e-web-31d2b2b.log`, `e2e-web-31e.log`;
    - `unit-31d2b2b.log`, `unit-31e.log`;
    - `lint-31d2b2b.log`, `lint-31e.log`;
    - `build-web-*.log`;
    - `peek-m3u-101.ts`;
    - screenshots `pair-api-file-done-en`, `phone-file-unreachable-ar`, `no-plaintext-phone-done-{en,ar}`;
    - earlier legs' files.
- **The `lablo-web-postgres-1` container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 101:**
- **A check that only ever expects the cleared state is vacuous.** Every `tv` test expected `fileId: null`, so a mutant selecting `NULL AS "fileId"` lived. Hold the request that ends the state (`front.hold({method: 'GET', prefix: '/dev/blob/', until})`) and assert the set value too. Keep a hold short: the TV gives each request 10 s.
- **The test front (`e2e/api-front.ts`) now has:**
  - `forwarded` (method, path, status; unchanged);
  - `received` (each passed-on request's headers as passed on and its whole body);
  - `hold` (above);
  - `serve` (a config).
- **The "no plaintext" spec** is in `pnpm e2e:web`'s `tv` project (its `testMatch` takes `pairing-api` and `no-plaintext`). `pnpm e2e`'s chromium project ignores it; `pnpm e2e --list` is still 150. `e2e:web` is 19 tests, about 25 s locally and 55 s on CI. Run only it with `pnpm e2e:web --project=tv no-plaintext`.
- **Base64 test samples:** in the base64 of ASCII text, `+`/`/` (`-`/`_`) only come as a group's 4th character, so either run pattern still decodes it in step. Start the bytes with 0xFB (encoded `+`, or `-` in base64url) when a test needs one alphabet's pattern.
- **JSON `\uXXXX` samples:** Arabic 0x644 and 0x627 have no hex letters, so the upper- and lower-case escapes are the same text. Use yeh (0x64a).
- **Mutants of `apps/web` source that only an e2e catches:**
  - their command needs `pnpm build:web && …`;
  - the run leaves the last mutant's build in `.next`, so run `pnpm build:web` after;
  - check by hand that each fails on the intended assertion: run the spec against the mutant build and read the error.
- **Heredoc Python with a backslash followed by `u`** in any string is a SyntaxError, even in a docstring. Use the Edit tool, or Write the script with raw strings.
- **A PR touching `playwright.config.ts` or `playwright.web.config.ts` also runs CI's `media` job** (about 23 minutes).
- **A background CI wait was reaped again while idle.** One foreground check, then the Monitor tool (a poll loop printing each finished job, exiting on `completed`) carried the 25-minute wait to the end.
- **Timings:**
  - local: `e2e:web` 22–26 s, whole unit suite 65 s in the foreground (`--maxWorkers=3`), `build:web` about 1.5 minutes;
  - CI: web about 2 m 15 s, verify 13–15 minutes, media 23.5 minutes.

**From earlier legs (still true):**
- **Chromium 53 drops a `MessagePort` message whose transfer list holds an `ArrayBuffer`:** it arrives as `null`. In TV code, never pass a transfer list to a port's `postMessage`; copy. Probe old-engine behaviour with a staged ES5 page (`artifacts/repro-run.ts`).
- **A profile bump pins more than `profile.test.ts`:** `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `e2e/episode-resume.spec.ts`. Grep `v: N\b` before committing; the "current + 1" pins move too.
- **A header guide another source already read is not read again;** give a file's guide a query of its own to hold it with the guide gate.
- **A reaped background run of lint/typecheck/unit:** `pnpm typecheck`'s `pnpm -r --parallel` starts a dozen `tsc` at once.
  - Instead, in the foreground: `tsc --noEmit -p` per changed package; `pnpm exec vitest run --maxWorkers=3` (the whole suite fits in about 65 s); mutation in chunks under the tool's 10 minutes.
  - Never restart a reaped run unasked.
- **Heredocs:** a `\n` inside Python in a heredoc can reach the file as a real newline. Write patch scripts with the Write tool, but never put `\uXXXX` in Write content (it gets decoded): use `String.fromCharCode`.
- **`bytes[i] ^= 1` passes vitest but fails `pnpm typecheck`:** write `bytes[i] = bytes[i]! ^ 1`.
- **`git mv` stages the rename at once:** run `git diff --cached --name-only` before every commit.
- **`pnpm e2e:web --project=phone <filter>`** (`--project` is variadic).
- **A "refuse before any request" check inside an `async` function rejects instead of throwing:** keep it in a synchronous wrapper.
- **vitest's `toEqual` on megabyte `Uint8Array`s is slow:** compare with `Buffer.from(a).equals(Buffer.from(b))`.
- **TS 5.7+:** type byte helpers `Uint8Array<ArrayBuffer>` for `BodyInit`/`BlobPart`.
- **A refusal sample must break exactly one rule.**
- **A TV build takes `?api=` only for loopback hosts;** old-engine walks forward a container port with `forwardToHost`.
- **The real `GET /v1/config` answers `private, max-age=300`:** a test's own config goes in before the TV's first request.
- **Root e2e specs have no `pg` types:** use `createRequire(path.join(WEB, 'package.json'))('pg')` and a local interface.
- **New ways in go through the gates:** any new way to play goes through `PlayerController.play`; any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`.
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component.
- **main.js is at 458.7 KB of 500 (Tizen);** steps 32 and 33 share about 41 KB, and there are no lazy chunks. Workers: ingest 131.9, pair 137.3, config 133.9, query 129.6 KB of 150. **Backup's scrypt and HKDF will want a worker:** measure before choosing which.
- **i18n arguments are isolated in English too:** compare with `stripIsolates` (TV) or strip FSI/PDI (phone page).
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes claim the slot before any `await`.**
- **A manual clock races requests that register their sleeper later:** wait until the request is recorded before advancing.
- **Workers:** a worker started after the first paint needs its npm deps in `optimizeDeps.include`. Never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`.
- **Polyfill names to keep out of TV code:**
  - members named `flags` or `at`;
  - `lastIndexOf` on arrays, `concat`, `URL`;
  - regex `.test`, `trim`, `parseInt`. (They are fine in a file whose module already has them: probe with `artifacts/babel-polys30b2.ts <files>`, before and after.)
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine);
  - no transfer list on a `MessagePort`;
  - physical CSS only, no CSS Grid or flex `gap`;
  - ES2017;
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs.
- **Web backend:**
  - `next build` typechecks e2e files;
  - `next start` locks `.next` (EBUSY);
  - Playwright's `webServer` starts before `globalSetup`;
  - `TaskStop` leaves `next start` running (kill the pid on its port);
  - node-postgres reads `timestamp` as local time.
- **Python on Windows writes CRLF in text mode:** write with `newline=''`.
- **Windows Smart App Control:** before every pnpm command, run `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI:** Node 22 there, Node 24 here.
  - **Known flakes**, each rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done:
    - `epg-declared-300mb` (media);
    - media's 30-minute cap after slow installs;
    - `auto-next.spec.ts` ar-SA `endEpisode`;
    - Chromium 53/56 DevTools start-up.
  - **After `gh pr create`:** wait about 45 s, then `gh run list -R Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 3 --json databaseId,status,headSha`.
  - No `jq`: use `gh --jq`. A whole run's log (`gh run view R --log`) is readable only once the run completes. Never push to a PR while its CI runs.
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
- **Migrations:** step 32's `Backup` migration runs on the local and test databases only; nothing goes to production before step 34.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in CI:**
  - PR #126: web (`e2e:web` 16); verify (unit 6,277 + 1 skipped, `pnpm e2e` 150);
  - PR #127: web (`test:web` 45, `e2e:web` 19); verify (unit 6,286 + 1 skipped, `pnpm e2e` 150); media green.
- **Verified locally:**
  - lint; typecheck of the root and `apps/web`;
  - unit: the whole suite, 6,287 (+14 this leg);
  - `test:web` 45; `build:web`; `e2e:web` 19;
  - mutation 24/24 (31d2b2b) and 21/21 (31e);
  - the leak mutants checked by hand to fail on the search;
  - screenshots looked at: `pair-api-file-done-en`, `phone-file-unreachable-ar`, `no-plaintext-phone-done-{en,ar}`.
- **Not run this leg:** `build:tv` and `verify:engines` (no TV code changed; engines were skipped by CI's path filter).
- **Not verified:**
  - a real phone's file picker;
  - a real TV (the old engines are desktop Chromium builds);
  - anything on Vercel or R2 (step 34).
- **Migrations and deploys:** none. Profile version 8 lives in each TV's own IndexedDB; nothing is in production or deployed.

## Open decisions and gates
- **Step 32:** the four decision points above. Decide and record them; ask Omar only where a trade-off is truly his.
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
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`, run `pnpm build:web`, `pnpm web:db`, then `pnpm e2e:web --project=tv no-plaintext`. Expect 3 passed: the end-to-end proof that the web app never sees a source in the clear (Xtream, M3U link, M3U file). On a failure the message names the request or "the rows", and lists the secrets found.
2. `pnpm exec vitest run test/no-plaintext.test.ts test/api-front.test.ts apps/web/test/phone-state.test.ts apps/web/test/phone-catalog.test.ts`: expect 180 passed.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs. Background runs were still reaped in legs 99, 100 and 101 without it.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`) and read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word:
  - 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`);
  - 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`);
  - 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`);
  - 55 in leg 100's (`git show e85772d:HANDOVER.md`): no transfer list on a `MessagePort`'s `postMessage` in TV code. No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
