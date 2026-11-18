# Lablo IPTV: relay leg 100 opening prompt

You are leg 100 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–98 did steps 1–31d2a (PRs #1–#123). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 99 (2026-11-18)** split step 31d2b (the TV's add path and the stored file source) into **31d2b1** (the TV app, in unit tests) and **31d2b2** (the end-to-end proof). It recorded seven decisions under 31d2b in RELAY.md and **did 31d2b1: PR #124, merge commit `dc3fd5c`, green CI on the first run**:
  - web: `test:web` 45, `e2e:web` 15;
  - verify: unit 6,253 with one skipped, `pnpm e2e` 148 passed;
  - engines: all 126 runs as expected on Chromium 53, 56 and 68, 89 seeded failures caught, vectors 217/217;
  - media: green.
- **The merge is recorded:** RELAY.md ticks 31d2b1 with its "Built", "Verified" and "Done in leg 99" lines and a leg-99 progress-log row. architecture.md §3.2 has "Built in step 31d2b1" with its "Mutation", "Verified locally", "Merged" and "Not yet" lines.
- **The decisions (RELAY.md under 31d2b):**
  - **The draft carries the feed:** `SourceDraft` gains `{type: 'm3u-file', name, epgUrls, file}`. `file()` fetches the frames in the pair worker and resolves a `FileFeed`, or rejects with a `LoadError`.
  - **The feed is asked for between two slot waits:** slot free, `file()`, slot free again, then the refresh at once.
  - **Profile version 8:** the 7 → 8 migration changes only `v`.
  - **Sent again under the same name replaces:** the file loads under the stored file source's id and keeps its `added`. Its new guide links get `g<n>` ids past every listed and stored guide id.
  - **A failed or refused file offers only "Show a new code":** the status already deleted the blob.
  - **A file sent with no name** gets `pair.fileName` ("Playlist from your phone").
  - **Settings › Sources** shows "M3U file" with no server, never blocked, and the line "Sent from your phone {day}, {time}".
- **What 31d2b1 built:**
  - **Profile:** `packages/data/src/profile.ts`: `SourceRecord` `m3u-file`, `SourceRecordV7` for versions 4–7, `ProfileV8`, the 7 → 8 migration. `account-check.ts`: `sourceAccount` is `null` for a file.
  - **The loader** (`apps/tv/src/onboarding/engine-loader.ts`):
    - the file path, `sameFile`, `freshGuides`;
    - `nextGuideId` (moved here from `settings/guides-state.ts`, which imports it) and `storedGuideIds`;
    - `ingestSourceOf` → `LinkSource | null`;
    - `LoaderEngine.epgStatus` (required);
    - `PASSED_ON` includes `file`.
  - **The draft and its errors:**
    - `form.ts`: the file draft, plus `FormDraft` (what `checkForm` gives);
    - `loader.ts`: `LoadErrorCode` `file`;
    - `load-text.ts`: `errorText(t, code, status, file = false)`, giving `error.file`, `error.fileFormat` and `error.fileNetwork`.
  - **The pairing screen:**
    - `pair-draft.ts`: `pairDraft(payload, parts: FileParts)` and `fileError`;
    - `pair-state.ts`:
      - `pairActions(kind, file = false)`;
      - `isFile()`;
      - `PairingOptions.fileName?: () => string`;
      - `answered(result, from)` fetches the file on the payload's own session.
    - `PairPage.tsx`: `PairContent`/`Message` take `file?`;
    - `main.tsx`: `fileName: () => appI18n(document.documentElement.lang || 'en').t('pair.fileName')`.
  - **Readers of a stored source:**
    - `refresh-scheduler.ts` skips file sources;
    - `live-state.ts` sets no short-EPG source for a file;
    - `movies-state.ts`: playlists are every source but Xtream;
    - `settings/sources-state.ts`: `SourceRow.type` is `SourceRecord['type']`, `linkOf` gives `''` for a file, and a file row is never blocked;
    - `SettingsScreen.tsx`: `sourceKindText` and `statusText` handle files, and the row draws no " · server" when `host` is empty.
  - **Strings** (en, ar): `error.file`, `error.fileFormat`, `error.fileNetwork`, `pair.fileName`, `sources.file`, `sources.fileSent`.
  - **Sizes:** main.js 458.7 / 446.0 KB (Tizen / webOS, +3.0 / +3.0); workers unchanged (ingest 131.9, pair 137.4 of 150); no new core-js module.
  - **Tests:** unit 6,254 (+65). `test/tv-data-engine.test.ts` has the real loader and data engine adding a two-frame file from a scripted phone and replacing it under the same name. Mutation `artifacts/mutate31d2b1.py`: 56 written first (one gap closed while writing), 56/56.

## Read first
1. **`RELAY.md`:** step 31d2b (its split and the seven decisions); 31d2b1 (shape, "Built/Verified/Done in leg 99", the pattern to follow); **31d2b2's line**; then 31e, 32, 33; the last rows of the progress log (98, 99).
2. **`docs/architecture.md`:** §3.2:
   - "Built in step 31c2b" (the old-engine pairing walk);
   - "Built in step 31c3" (the `tv` project);
   - "Built in step 31d1" (the phone's file form, `/dev/blob`);
   - "Built in step 31d2a" (the file's bytes on the TV);
   - "Built in step 31d2b1".
3. **For 31d2b2:**
   - `tools/engines/src/pair-stand-in.ts`, `pair-server.ts` and `pair-phone.ts` (the stand-in and the scripted phone; `e2e/config-server.ts` answers through `answerPair`);
   - `e2e/pairing.spec.ts` and `e2e/pairing-steps.ts` (stand-in e2e in `pnpm e2e`);
   - `e2e/pairing-api.spec.ts` and `e2e/api-front.ts` (31c3's `tv` project in `pnpm e2e:web`, the real API);
   - `apps/web/e2e/phone-file.spec.ts` and `apps/web/e2e/support.ts` (how the scripted TV reads a file; `playlist()`, the upload);
   - `apps/web/src/phone/flows.ts` (`sealFileFrame`, the upload URL, the PUT);
   - the old-engine walk: `tools/engines` (`runPairing`, `PAIR_EXPRESSION`, `evaluatePairing`, `forwardToHost`; runbook `docs/runbooks/old-engines.md` item 7);
   - the phone page: `apps/web/src/phone/catalog.ts` (`done.unreachable` at lines ~89 and ~181) and the done view in `PhonePage.tsx` and `state.ts`.
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -5` shows this handover's commit, then `29cd85e` (PR #124's merge recorded), `8051239`, `0d3ee88`, `c11bb77` (31d2b1);
   - no `*.mutbak`: `find apps packages tools e2e test -name "*.mutbak" -not -path "*/node_modules/*"`.
2. **Memory before heavy runs:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). It was 19.5–20.7 GB free this leg, yet a background `pnpm e2e` was still reaped while the session was idle.
3. **Step 31d2b2, the file sent from a phone, end to end.** Write its shape in RELAY.md before building, as legs 93–99 did, and split it if it's too large. Suggested split: 31d2b2a = the stand-in, the scripted phone, `pairing.spec.ts` and the old-engine walk; 31d2b2b = the `tv` project and the phone page's wording. The scope, from RELAY.md:
   - **The stand-in learns the file:**
     - its upload URL (`POST /v1/pair/:code/upload-url`);
     - the blob (a PUT, then a GET with CORS `*`);
     - `GET /v1/pair/s/:sid/file`;
     - the blob deleted with the status.
   - **The scripted phone** (`pair-phone.ts`) seals (`sealFileFrame`, 1 MiB frames) and uploads a file, then posts the payload `{v: 1, source: {type: 'm3u-file', file: {key, fileKey, base, size}}, name?, epg?}`.
   - **`e2e/pairing.spec.ts` (stand-in):**
     - a multi-frame file by phone in onboarding: the live list fills; Sources shows "M3U file" with no server;
     - a broken file: the TV says "The file from your phone couldn't be read. Send it again.", the phone reads `unreachable`, and the screen offers only "Show a new code";
     - screenshots of the file's loading, failed and done views and the Sources row, en and ar, looked at.
   - **`e2e/pairing-api.spec.ts` (`tv` project, the real API):**
     - a multi-frame file sent by the scripted phone fills the live list;
     - the blob answers 404 after the status;
     - the same file sent again replaces the source (one source, the same id).
   - **The old-engine pairing walk with a file on Chromium 53 and 68:** two workers on one `MessageChannel` on a real old engine, the one thing no test has proven yet.
   - **The phone page's `done.unreachableFile`** ("Your TV couldn't read the file", en and ar) for `unreachable` after a file (`test:web`, `build:web`, `e2e:web`).
   - **Plus the common items:** mutation of the stand-in's file route and the phone page's wording; the PR merged on green CI with its `web` and `engines` jobs; the docs (architecture.md "Built in step 31d2b2").
4. **Then 31e,** the "no plaintext" test end to end:
   - the real phone page in a second Playwright page at a phone's size, opening `<front>/p#c=…&k=…`, with the TV, the web app and the mock;
   - for Xtream, M3U link and M3U file;
   - where to look for the secrets: the front's `forwarded` log, and `lablo_e2e`'s rows and blobs.
5. **Step 26's common items still apply to every step:**
   - unit tests;
   - mutation with the list written first (`artifacts/mutate31d2b1.py` is the newest template; `sed -n '/^def run(cmd):/,$p' artifacts/mutate31d2b1.py` gives the runner);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page, a worker or the build changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - the PR merged on green CI;
   - the docs, and the merge recorded (RELAY.md tick, "Done in leg …", progress-log row; architecture.md "Merged").

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of:
  - `29cd85e` (PR #124's merge recorded, 31d2b1 ticked);
  - `8051239` (31d2b1's checks recorded);
  - `0d3ee88` (the cancel gap test, docs);
  - `c11bb77` (31d2b1);
  - `04002c3` (leg 98's handover).
- **`main`:** `dc3fd5c` (Merge PR #124). The relay branch is ahead of main only by `29cd85e` and this handover; both go in with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next` (built in leg 97; apps/web unchanged since);
  - `dist/` (built this leg from 31d2b1's final source);
  - `artifacts/`: `mutate31d2b1.py`, `mutate31d2b1.log`, `unit-31d2b1.log`, `unit-31d2b1-first.log`, `lint-31d2b1.log`, `typecheck-31d2b1.log`, `build-tv-31d2b1.log`, `e2e-31d2b1.log` (the reaped run), and earlier legs' files.
- **The `lablo-web-postgres-1` container is up** (`pnpm web:db:down` stops it). No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.

## Gotchas and lessons
**New in leg 99:**
- **A profile bump pins more than `profile.test.ts`.** Also bump:
  - `packages/data/src/query-service.test.ts` (three `doc: { v: N` pins);
  - `test/onboarding-loader-mock.test.ts`;
  - **`e2e/episode-resume.spec.ts`** (vitest never runs it).

  Grep `v: N\b` in packages, apps, test, e2e and tools/engines/src before committing. The "current + 1" newer-version pins move to N+1 (leg 73).
- **A reaped background `pnpm e2e` shows two infrastructure errors, not test failures:** "worker process exited unexpectedly (code=3221225794)" (0xC0000142) and "newPage: Target crashed". Count both in the log. Don't restart it unasked; CI's `verify` (148) and `engines` jobs are the gate. Say "not run locally, CI was the gate" in the docs and the PR.
- **Start CI waits with `run_in_background` from the first call**, e.g. `until [ "$(gh run view R -R Omarmarei/Lablo --json status --jq .status)" = completed ]; do timeout 60 tail -f /dev/null; done; gh run view R … --json jobs`. Then end the turn and wait for the notice. A foreground loop "ending at 580 s" still hit the tool's 600 s limit.
- **A source re-added under an existing id must not reuse place-named guide ids** (`<id>`, `<id>-2`…): a guide the user removed may still have stored records under that id. `freshGuides` names them `g<n>` past the listed ids and `storedGuideIds(epgStatus().guides)`.
- **`pairActions` takes the draft's kind:** a file's failed or refused view has one button, so the zone's count changes with `isFile()`. Any new view that depends on the draft must update the zone through `show()`.
- **`shownHost('')` is `''`:** an empty link shows no server, so no extra guard is needed.
- **Heredocs:** `python - <<'EOF'` with plain Python worked, but a `cat > file <<'EOF'` holding TS template literals and nested triple quotes failed to parse. Write patch scripts with the Write tool (memory: use-write-tool-for-doc-batches).

**From earlier legs (still true):**
- **`bytes[i] ^= 1` passes vitest but fails `pnpm typecheck`:** write `bytes[i] = bytes[i]! ^ 1`, and run typecheck after writing tests.
- **A real MessagePort can go into a worker-bundle test's vm realm** with `structuredClone(message, { transfer })`.
- **The mutation run takes about 3 mutants a minute;** run it in the background and write docs meanwhile. Never build, test or commit while it runs. Leg 99's 56 took about 25 minutes.
- **`git mv` stages the rename at once.** Run `git diff --cached --name-only` before every commit.
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
- **A component with a hook can't be called as a function in a VNode test:** split it into a hook wrapper and a content component (`PairPage` → `PairContent`).
- **main.js is at 458.7 KB of 500 (Tizen);** steps 31d2b2, 32 and 33 share about 41 KB, and there are no lazy chunks. Workers: ingest 131.9, pair 137.4, config 133.9, query 129.6 KB of 150.
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
    - Chromium 53/56 DevTools start-up.
  - **After `gh pr create`:** wait ~45 s, then `gh run list -R Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 3 --json databaseId,status,headSha,event`.
  - No `jq`: use `gh --jq`. A failed job's log: `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`. Never push to a PR while its CI runs.
  - **Timings this leg:** web 2 m, verify 12 m, engines 22 m, media 29 m.
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
- **Verified in CI (PR #124):**
  - web (`test:web` 45, `e2e:web` 15);
  - verify (unit 6,253 + 1 skipped, `pnpm e2e` 148);
  - engines (126 runs as expected on 53/56/68);
  - media.
- **Verified locally:** lint, typecheck, unit 6,254, `build:tv` sizes, mutation 56/56. The real loader and data engine adding a file and replacing it ran in Node (`test/tv-data-engine.test.ts`).
- **Not run locally this leg:** `pnpm e2e` (reaped under memory pressure; CI ran it) and `verify:engines` (left to CI).
- **Not verified:**
  - the pairing screen adding a file in a browser (31d2b2's e2e);
  - the `MessageChannel` between two real workers on a real old engine (31d2b2's walk);
  - the real phone page driving the TV (31e);
  - a real phone's file picker;
  - anything on Vercel or R2 (step 34).
- **Migrations and deploys:** none. Profile version 8 lives in each TV's own IndexedDB; nothing is in production or deployed.

## Open decisions and gates
- **31d2b2:** its shape and split, and how the stand-in models the blob (memory store and URL shape like `/dev/blob/…`, or simpler). These are the leg's own calls; record them in RELAY.md.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in the phone page's `connect-src`, and the bucket's CORS rule (PUT from the page's origin, GET from any);
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):**
  - the guides screen's "read, last try failed" rows clip their third line;
  - the Arabic `done.body` (`{name} جاهز.`) is masculine, which reads wrong for a feminine name like "قائمة من هاتفك" (now the default file name too);
  - `auto-next.spec.ts`'s `endEpisode` race;
  - `epg-declared-300mb`'s single-sample budgets (a best-of-3 would be a small CI fix to propose).
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, the RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV.

## Checks for Omar (merged this leg)
1. In the main checkout after `git pull`, run `pnpm exec vitest run apps/tv/src/onboarding/engine-loader.test.ts apps/tv/src/pairing`. Expect 136 passed: the file loaded after the refresh slot is free, replaced under the same name, one button on a failed file.
2. Nothing to click yet: the pairing screen's file path is first exercised in a browser by step 31d2b2's e2e.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94 (not running since). Please close it during relay runs. Even without it, a background `pnpm e2e` was reaped in leg 99.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`) and read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-four CLAUDE.md gaps** wait for his word: 1–28 in leg 51's handover (`git show d05d5fd:HANDOVER.md`), 29–47 in leg 86's (`git show 5fffb27:HANDOVER.md`), 48–54 in leg 93's (`git show 081c1ee:HANDOVER.md`).
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
