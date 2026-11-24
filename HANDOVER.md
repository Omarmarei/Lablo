# Lablo IPTV: relay leg 151 opening prompt

You are leg 151 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–149 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21), 39s1 (the storage quota, PR #175) and 39s2 (the ladder's HLS stickiness, PR #176).
- **Leg 150 (2026-11-24): step 39s3 (stall injection that reaches the watchdog) refined, built and merged: PR #177 as `7e947fe`.**
  - CI: changes, verify 22 m, media 12 m and web 3 m passed. Engines hit the known Chromium 53 DevTools start-up flake ("DevTools on port 32768 did not answer within 60000 ms") at the first run, then passed on the rerun.
  - **No question for Omar.** The 6.9 s case is the design working. The fault's numbers are leg 150's choices (below).
  - **The 6.9 s stall:**
    - In the stall test, the TV's stalls after tuning showed "Connecting…". After a session's first frame, that overlay belongs only to `buffering` (a retry shows "Reconnecting…"). So AVPlay had sent `onbufferingstart`.
    - In `buffering` only `liveBufferingMs` runs (12 s; Stable 25 s), and the frozen rule doesn't. That limit is meant to outlast AVPlay's own reconnect, about 7 s after the data stops.
    - The reconnect recovered the picture in 6.9 s, sooner than a reopen at 6 s plus a zap would have.
    - A controller test pins both sides: a picture frozen with no event is reopened at 6 s; the same picture while the engine buffers is left to it.
  - **Built:**
    - **`stall:outage_ms=N`:** after the stall, the stream is down for N ms. The stream is the account and the stream id, else the path (`outageKey`, `server.ts`).
      - Requests that carry the fault are held with headers and 0 bytes. When the outage ends, they are closed (`Outages`, `faults.ts`).
      - A scenario switch ends every outage, and the request log prints each one.
      - A held response still counts against the account's connections.
    - **The scenario `live-outages`** (step 21's soak): live TS streams 60 s past its 6 s burst, then the channel is down 25 s.
    - **`MediaSource.liveBytesPerSecond`:** the lab's `stall-ts` row stalls after 18 s of its channel's media (2,125,152 bytes for 104; 2,368,800 with placeholder bytes).
    - **`stalling-streams`** stalls 12 s into each response (18 s of media on every channel).
    - **Docs:** architecture.md §2 "Built in step 39s3", the mock runbook's Faults section and tables, lab.md's soak row, results.md pointers.
  - **Docs in RELAY:** `- [x] 39s3.` (refined before building: 6 points; gates), row 150.
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV (S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, the "Zoma" he saw);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the 39s block: **39s5 is the next step** (small fixes), then 39s6 (`pnpm tv` tools). 39s4 needs the TV;
   - the `- [x] 39s3.` and `- [x] 39s2.` lines as models for "Refined before building", the choices and "Gates";
   - the last progress row (150).
2. **docs/spikes/results.md**, "From the Samsung TV (2026-11-24)": the sources for 39s5's four items.
3. **For 39s5:**
   - **item 1:** `tools/device/device.ts` (`isLabWgt`, `appTarget`, `labTarget`), `tools/device/src/commands.ts` (+ `commands.test.ts`), and `tools/build/src/package.ts` (`packageTizen`, which keeps the CLI's own `.wgt` name);
   - **item 2:** `apps/tv/src/lab/battery.ts` lines ~11, ~482, ~493 ("2020+ TVs"), lab.md line ~156;
   - **items 3 and 4:** architecture.md §2 (the subtitles and the S8 prebuffer notes).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `fda7829` (39s3 ticked, row 150), then `7e947fe` (the merge);
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` (needed only for the web-backed tests) and no `lablo-chrome*` container.
2. **Step 39s5: refine against the code first** (write "Refined before building" under 39s5). Leg 150's read-ahead:
   - **Item 1, the trap:** the Tizen CLI names the `.wgt` after the widget's `<name>` ("Lablo Lab"), and `packageTizen` keeps that name.
     - `device.ts`'s `isLabWgt` is `/lab/i`, which also matches the app's `Lablo.wgt`. Today the lab is found only because `"Lablo Lab.wgt"` sorts before `"Lablo.wgt"` (a space comes before `.`).
     - If the lab's package is renamed to `LabloLab.wgt` alone, NTFS lists `Lablo.wgt` first, and `--lab` would install the app.
     - Fix both together:
       - a name without spaces in `packageTizen` (a pure function with a test in `tools/build`);
       - an exact lab test, e.g. `/lab\.wgt$/i` after removing spaces, moved into `tools/device/src/commands.ts` with `commands.test.ts` cases;
       - check `appTarget`'s `!isLabWgt` too.
     - `run()` already quotes paths with spaces, yet `tizen install` failed on one: the cause is on Tizen's side, so a name without a space is the fix.
   - **Item 2:** the app has no year gate (grep to confirm). Fix the lab's `hevc-4k` title and note ("2020+ TVs") and lab.md's row, so they say the TV's decoder and panel decide. That changes `battery.ts` (the lab bundle): update any `battery.test.ts` text pins.
   - **Items 3 and 4:** docs only (architecture.md §2, and step 20's subtitle notes).
   - **Gates as 39s3:**
     - unit tests (item 1's path);
     - lint, typecheck;
     - mutation with the list written first;
     - `build:tv` only if TV source changes (item 2 changes the lab bundle: build it and check the lab still builds; no budget there);
     - the PR, CI, the merge on green.
3. **Then** 39s6 (`pnpm tv` tools; the reference scripts are in `D:/tmp/lablo-samsung/artifacts/`, outside the repo; no LAN address or token may enter the repo).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`7e947fe`) plus `fda7829` (39s3's tick, row 150) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 39s2's code (39s3 changed no TV source);
  - in `artifacts/`:
    - `mutate39s3.py`, `mutate39s3.log`, `mutate39s3-clean.log`;
    - `unit-39s3.log`, `unit-39s3-rerun.log`, `lint-39s3.log`, `typecheck-39s3.log`, `e2e-39s3-lab-media.log`, `mock-39s3-outage.log`;
    - leg 149's 39s2 logs, leg 148's 39s1 logs and the storage screenshots.

## Verified vs not
- **Verified in leg 150 (39s3):**
  - unit 8,911 (329 files) at the full run. Nine heavy tests timed out at 30 s under load (the crypto and pair worker bundles, the fixtures' 61-byte chunk oracles) and passed alone, 16 of 16;
  - lint and typecheck clean;
  - mutation 36 of 36 at the first run;
  - `pnpm lab:media` 2 of 2;
  - the real mock with generated media: the outage held a reconnect with 0 bytes and closed it at its end, and the request after it played;
  - CI green after one engines flake rerun.
- **Not done:**
  - **The proof on the TV:** a soak with `live-outages` where the app's watchdog acts. That is step 21, with Omar.
  - `build:tv` and engines locally: no TV source changed in 39s3, and the PR's CI ran both.
  - Steps 39s4–39s6; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 150:**
- **The `lablo` test account has 2 connections, and a held response counts until its socket closes.** A socket test with more streams open at once gets 403 "Max connections reached". Use `forever`/`forever-test` (4).
- **`packages/*` tests run only from the repo root's Vitest config:** `pnpm --dir "<wt>" exec vitest run packages/player/src/controller.test.ts`. With `--dir <wt>/packages/player` it says "No test files found". `apps/mock-provider` and `apps/tv` also run from their own folder.
- **`e2e/lab-media.spec.ts` runs only under `pnpm lab:media`** (about 2 min). `playwright test e2e/lab-media.spec.ts` finds no tests.
- **Live TS:** it bursts its current 6 s segment, then paces at real time. So `after_ms` equals media seconds minus 6 on every channel, while a byte count depends on the channel (37–338 KB/s; 104 is 118 KB/s).
- **Engines' Chromium 53 start-up flake** happened again at the self-test (2.5 min in). Read the log with `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs` (it works before the run ends), then rerun once the whole run is done.
- **I `cd`'d once in a Bash call** (into `D:/tmp`), and the session's working directory moved. Never `cd`; use absolute paths.

**From leg 149 (still true):**
- **The background CI wait was reaped** ("system is running low on memory", while the session was idle). Don't restart it. What worked:
  - check once in the foreground (`gh pr checks <n> --repo Omarmarei/Lablo`);
  - then foreground waits bounded by `timeout 570`: `until s=$(gh api repos/Omarmarei/Lablo/actions/jobs/<id> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done`, repeated until done.
- **After `gh run rerun <run> --failed`** the job has a new id: `gh run view <run> --repo Omarmarei/Lablo --json jobs --jq '.jobs[] | select(.name=="engines") | (.databaseId|tostring) + " " + .status'`.
- **Python patches in a Bash heredoc lose escaped quotes.** Write patch scripts with the Write tool (an EDITS list plus the apply loop, `newline=''` on read and write).
- **`WatchdogConfig` has `fallbackMs`:** a test that spreads `{ ...DEFAULT_WATCHDOG, openTimeoutMs: 20_000 }` inherits the 6 s cap. Set `fallbackMs` too when a test means a patient open.
- **Desktop e2e never meets the cap:** Chromium refuses the `.ts` at once (`unsupported`, definitive).
- **The module probe** (`tools/build/mprobe-<step>.ts`, temporary, deleted after): its output holds NUL bytes (`grep -a`, sort both lists, then `diff`).
- **Sizes:** main.js 471.0 of 500 KB on Tizen (29 KB left); settings.js 99.7 of 150; the query worker 149.3 of 150 (0.7 KB left: keep its code changes tiny).

**From leg 148 (still true):**
- **Chromium's quota rule:** it checks the quota only for a transaction that writes. A delete-only transaction always commits; split deletes from puts.
- **`fillStore`** (`packages/data/src/test-support.ts`) fakes a full store at each put.
- **e2e full store:** patch `IDBObjectStore.prototype` in the workers (`e2e/storage-full.spec.ts`); DevTools' quota override does nothing.
- **A spec comparing words with the catalog it imports** checks nothing against a catalog change: pin the English sentence as a literal.

**From legs 130–147 (still true):**
- **Plain e2e never plays a channel** (the desktop refuses the `.ts`; the placeholder `.m3u8` never shows a frame). To measure the watchdog, watch the `<video>`'s `src`.
- **A moved clock and a playing stream:** `page.clock.runFor` of more than about 6 s trips the watchdog; use `page.clock.fastForward`.
- **`rm` on a shell variable is refused:** write a literal path. `sleep N; cmd` is blocked: wait with `read -t N < /dev/zero` under `timeout`.
- **CI:**
  - a run takes about 30 minutes; `verify` and `media` have 30-minute caps, engines 35;
  - known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes;
  - read the annotations or the job log, then `gh run rerun <run> --failed` once the whole run is done;
  - no `jq` in Git Bash; a push to an open PR cancels its CI.
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes).
- **Mutation and builds don't mix:** never run mutation beside a build, an e2e run, a probe, a unit run or an agent reading the tree. Don't edit test files while a unit run is going.
- **Settings rows in e2e go by id** (`e2e/settings-rows.ts`). **Onboard in the language you test.** **In Arabic the rail is on the right.** Use `--workers=2` for e2e on this PC.
- **A local unit run of everything** times out heavy tests at 30 s under load: rerun them alone before calling them failures.
- **Peer sessions** (Omar's Samsung session) may send his decisions: act on what Omar decided; ask him directly before ticks a handover reserved for his word.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`; no fields named like built-ins. (The mock and `tools/` are Node code: these rules don't apply there.)
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.** Helpers main needs live outside `settings/`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Heavy checks one at a time; `build:tv` in the background (about 8 minutes).

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens (39s6).
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Omar said on 2026-11-23: carry on with new changes without asking.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Leg 150's choices for 39s3** (Omar may overrule; each is a number or a line to change):
  - `live-outages`: 60 s of stream past the burst, then 25 s down (under Fast start the watchdog reopens at 12 s of buffering, inside the outage; about two attempts per 85 s cycle, so the ladder's four in 60 s never end a soak). A Stable soak needs a longer outage, in a copy of the file;
  - step 21's "each stall recovered in ≤ 10 s" counts from the outage's end (the mock's `back` log line) to the moving picture, plus a check that the app reopened. Step 21 decides its rule;
  - the lab's soak stays a plain held socket per response (spike S4's measure; AVPlay hides most of its stalls).
- **Leg 149's choices for 39s2 stand** (the fallback's cap 6 s and 12 s; catch-up keeps the whole open timeout; no hysteresis).
- **Leg 148's, 147's, 146's and 145's choices stand.**
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16's rest and 21 wait for Omar and the TVs** (his "3a").
- **What remains after 39s:** 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering); with Omar or a TV: 34, 16, 21, 39s4, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - new in leg 150:
    - a mock endpoint listing the outages (for a soak report that doesn't parse the log);
    - whether a position that moves while `buffering` should count as playing (an engine that never sends `playing` would be reopened at 12 s on a moving picture; no evidence on the TV);
  - from leg 149: a fresh redirect probe on Tizen for a remembered container other than the request's first; the cut's time measured on the Samsung;
  - from leg 148: the live line in the old-engine walk; seed the storage state at start from stored guide failures; a remove-a-source action; measure on the Samsung whether deleting frees usage at once;
  - from leg 147: a per-model tunables block in the config doc (only if step 21 shows a need); whether AVPlay's `prepareAsync` waits for the first buffer; the "Buffering" row in the old-engine walk;
  - from leg 146: the audio and subtitle keys over an end card (`menuRoom`); the prompt in the old-engine walk;
  - older: the restored-source login gap; renaming a source; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `auto-next`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the engines job's 35-minute cap; forwarding workers' unhandled rejections; `epgOverrides` after a re-match; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (0.7 KB left); the start's resume before the worker's load; a VNode test of the pad; the local e2e worker count under load; stored guides keeping their titles' language after a language switch.

## Checks for Omar
1. **39s3 has no screen:** nothing to look at. He may overrule `live-outages`' numbers (60 s, then 25 s down) or the soak's recovery rule.
2. **The storage line (from leg 148):** `artifacts/screenshots/storage-full-en.png`, `-ar.png`, `-en-XA.png` (in the worktree, gitignored). Nothing to decide unless he wants other words.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once and look at the new order;
  - switch the language in Settings both ways;
  - try Settings › "Player" (each row, then a channel with two audio languages, then "Clock while watching"; "Buffering" on Stable, then play a channel);
  - set "Sleep timer" to 30 minutes, play a channel and wait for the prompt; try its two buttons and Back;
  - try the colour keys (red on a channel row and in the player, green, yellow, blue) and the Guide key on the remote;
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad with the remote;
  - hide and show the app while unlocked;
  - try "Forgot your PIN?" with the TV's keyboard;
  - try "Set a PIN" on onboarding's done screen;
  - try "Use your phone" on the check, with a real phone.
- **At the Samsung TV next time** (his "3a"):
  - S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, with the TV's own remote;
  - look for the "Zoma" he saw;
  - the sleep timer's prompt as on the LG;
  - a channel's start under "Fast start" and under "Stable" (AVPlay's buffers);
  - the lab's S2 again (the lab now carries `unlimitedstorage`): does `storage.estimate()` still say 88 MB?
  - after a network outage, the next zap and the next launch start on `.ts` again; with the `.m3u8` answering 404 and `.m3u8` remembered, how long until `.ts` plays (expect about 6 s plus AVPlay's close);
  - **new (39s3):** step 21's soak with `pnpm mock --scenario live-outages` on channel 104: the app should show "Reconnecting…" once per outage and play again within a few seconds of the mock's `back` line.
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-seven CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`;
  - 56: `git show 6235456:HANDOVER.md`;
  - 57: `git show b54b260:HANDOVER.md` ("e2e specs address a settings row by its id through `e2e/settings-rows.ts`, never by its number").
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
