# Lablo IPTV: relay leg 152 opening prompt

You are leg 152 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–150 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21), 39s1 (storage quota, PR #175), 39s2 (the ladder's HLS stickiness, PR #176) and 39s3 (stall injection, PR #177).
- **Leg 151 (2026-11-24): step 39s5 (small fixes from the Samsung session) refined, built and merged: PR #178 as `b0a3033`.**
  - CI: changes, verify 21 m, engines 27 m and web 3 m passed. Media hit the known `epg-declared-300mb` timing flake (28.4 ms against 20) at the first run, then passed on the rerun (13 m).
  - **No question for Omar.** Item 1 had one fix, and items 2–4 were notes. The two gaps found on the way are recorded as later fixes (below).
  - **Built:**
    - **The lab's Tizen package is `LabloLab.wgt`.** The Tizen CLI names a `.wgt` after the widget's `<name>`, so the lab used to be `Lablo Lab.wgt`, and the TV refused it.
      - `packageTizen` (`tools/build/src/package.ts`) moves the CLI's file to `tizenPackageFile`'s name, the `<name>` without spaces. It also removes an older build's file under the CLI's name.
      - `pnpm device` asks for the exact file, read from each `config.xml` (`tizenManifest` and `tizenPackageName` in `tools/device/src/commands.ts`). It used to pick from a listing: `/lab/i` also matched `Lablo.wgt`, and the lab was found only because a space sorts before `.`.
      - `test/tizen-package-names.test.ts` holds the two tools' copies of the rule together.
    - **The lab's `hevc-4k` row** goes by a 4K panel and decoder, not "2020+". The app never had a year gate.
    - **architecture.md §2 "Step 39s5":**
      - 4K goes by the TV, never by its year, and not by `canPlayType` alone: the HD Samsung answered `probably` for HEVC level 5.0, then failed the file.
      - AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` for a 4K file reads as `network`.
      - AVPlay lists an MP4's `mov_text` tracks but sends no cue.
      - S8's prebuffering was intermittent: a future prebuffered zap opens plainly when the prepared player isn't ready.
      - Also updated: §5's S4 row, §7's v1.2 row, lab.md, tv-setup.md, tv-build.md, results.md.
  - **Docs in RELAY:** `- [x] 39s5.` (refined before building, refined while building, gates), row 151.
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV (S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, the "Zoma" he saw);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the 39s block. **39s6 is the next step** (`pnpm tv` tools). 39s4 needs the TV;
   - the `- [x] 39s5.` and `- [x] 39s3.` lines as models for "Refined before building", the choices and "Gates";
   - the last progress row (151).
2. **docs/spikes/results.md**, "The app on the Samsung TV": how the TV was driven from the PC (the source of 39s6).
3. **For 39s6:**
   - `tools/device/` as the model of a small tool package: a thin CLI entry, logic in `src/` with tests, and a root `package.json` script (`"device": "tsx tools/device/device.ts"`). `pnpm-workspace.yaml` already takes `tools/*`;
   - the reference scripts, **outside the repo**, in `D:/tmp/lablo-samsung/artifacts/`: `tvraw.mjs` (95 lines), `cdp.mjs` (43), `soak-monitor.js` (33), `soak-report.js` (15), `stalls.js` (27), `soak-loop.sh` (23). **They hold the TV's LAN address and read `tv-token.txt`: never copy an address or a token into the repo** (it is public);
   - `docs/testing-without-tvs.md` and `docs/runbooks/tv-setup.md` §3 (where the README section goes).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `31adb2b` (39s5 ticked, row 151), then `b0a3033` (the merge);
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` (needed only for the web-backed tests) and no `lablo-chrome*` container.
2. **Step 39s6: refine against the scripts first** (write "Refined before building" under 39s6). Leg 151's read-ahead:
   - **Where:** a new workspace package `tools/tv` (`@lablo/tools-tv`), with a root script `"tv": "tsx tools/tv/tv.ts"`. Keep the CLI entry thin: `device.ts` runs `main()` on import, so nothing in an entry file can be unit-tested. Don't import from tools/device or tools/build (the tools never import each other; a root `test/` file may hold a shared rule together).
   - **`src/ws.ts`, a raw WebSocket client over TLS.** The TV never answers Node's built-in `WebSocket` on `wss://<tv>:8002`; `tvraw.mjs`'s hand-written upgrade does. It needs:
     - the upgrade request: Host, `Upgrade: websocket`, `Connection: Upgrade`, `Sec-WebSocket-Key`, version 13, and an `Origin` header;
     - masked client text frames, with 7-bit, 16-bit (126) and 64-bit (127) lengths;
     - server frames parsed across chunk splits;
     - close, and a ping answered with a pong;
     - `rejectUnauthorized: false` (the TV's own certificate).
   - **`src/remote.ts`, Samsung's remote messages:**
     - the path `/api/v2/channels/samsung.remote.control?name=<base64 name>&token=<token>`;
     - `ms.remote.control` with `SendRemoteKey` (`Cmd: 'Click'`, `DataOfCmd: KEY_X`);
     - `SendInputString` (base64 text, `DataOfCmd: 'base64'`), then `SendInputEnd`, while the keyboard is up (the `ms.remote.imeStart` frame);
     - the token saved from `ms.channel.connect`'s `data.token`;
     - a script of keys, pauses and text, like tvraw's arguments (`KEY_DOWN 800 KEY_ENTER TEXT:abc END`).
   - **`src/cdp.ts`, the inspector:**
     - `sdb -s <serial> shell 0 debug <appid>` prints a port, new at each launch: parse it;
     - `sdb -s <serial> forward tcp:P tcp:P`, then the `/json` list and `Runtime.evaluate` (`awaitPromise`, `returnByValue`);
     - Node's built-in `WebSocket` works for CDP (cdp.mjs uses it);
     - `Page.captureScreenshot` never answers on Tizen 5.5: read `document.body.innerText` and `__LABLO_TEST__.focusPath()` instead.
   - **Launch and state:**
     - `sdb shell 0 was_execute <appid>` launches in about 0.8 s (`tizen run` takes about 10 s);
     - `http://<tv>:8001/api/v2/applications/<id>` gives the running state.
   - **The soak monitor:**
     - an ES5 page script (Chromium 69) samples AVPlay's state and position every 100 ms. A stall is the position frozen for at least 1.5 s, and the script records the heap every 5 minutes;
     - put the stall detection in a pure TS function over the samples (tested), and keep the injected sampler small;
     - a report command, plus a loop with an sdb reconnect, as `soak-loop.sh` does.
   - **Config:** the TV's address, its sdb serial and the token go in a gitignored file (for example `.tv.local.json` at the root; add it to `.gitignore`). Never print the token.
   - **Done when:**
     - unit tests of the framing and messages, with no TV;
     - a README section;
     - one run on the Samsung by Omar or a leg he hands the TV to. That last part waits for the TV: build and merge the rest, and leave 39s6 open, as 39s4 is.
   - **Gates as 39s5:**
     - unit tests and lint, typecheck;
     - mutation with the list written first;
     - no TV source changes, so no `build:tv`;
     - the PR, CI, the merge on green.
3. **Then step 40** (the diagnostics and legal pages), or the next unticked step without `[needs Omar]` or `[needs TV]`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`b0a3033`) plus `31adb2b` (39s5's tick, row 151) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`, `apps/web/.next`;
  - `dist/`:
    - `build:tv` of 39s2's code;
    - `dist/tv-lab/` rebuilt by leg 151 (`--target lab`; its `lab-config.js` holds this PC's address);
    - `dist/packages/com.lablo.iptv.lab_0.1.0_all.ipk` rebuilt;
    - no `.wgt` (no signing profile here);
  - in `artifacts/`:
    - leg 151's logs: `mutate39s5.py`, `mutate39s5.log`, `unit-39s5.log`, `lint-39s5.log`, `typecheck-39s5.log`, `build-lab-39s5.log`;
    - leg 150's 39s3 logs, leg 149's 39s2 logs, and leg 148's 39s1 logs with the storage screenshots.

## Verified vs not
- **Verified in leg 151 (39s5):**
  - unit tests in the touched areas: 939 of 939 (65 files: `apps/tv/src/lab`, `tools/`, `test/lab-probes.test.ts`, the new root test). After `tizenManifest` moved into `commands.ts`, tools/device and the root test passed again (13). CI's verify job ran the full suite;
  - lint and typecheck clean;
  - mutation 16 of 16 at the first run;
  - `build:tv --target lab`: lab main.js 423.3 KB on Tizen, 403.0 KB on webOS;
  - with no package built, `pnpm device install tizen <serial> [--lab]` asks for `dist/packages/LabloLab.wgt` and `dist/packages/Lablo.wgt`;
  - CI green after one media flake rerun.
- **Not done:**
  - installing `LabloLab.wgt` on the Samsung through `pnpm device` (the next session with the TV);
  - steps 39s4 and 39s6; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 151:**
- **The tools don't import each other.** When two tools need one rule, keep a copy in each and let a root `test/` file check that they agree (`test/tizen-package-names.test.ts`). Root tests may import any `tools/*/src` module.
- **`vi.mock` of a Node module:** ESLint refuses `importOriginal<typeof import('node:child_process')>()`. Write `import type * as ChildProcess from 'node:child_process'` and `importOriginal<typeof ChildProcess>()`. A stand-in `spawnSync` that writes the CLI's output file tests `packageTizen` without the Tizen CLI.
- **A NBSP escape in Write-tool content landed as the raw character** (twice). Fix: a `python -X utf8 -I -c` replace of `chr(0xa0)` with `chr(92) + 'u00a0'` (`newline=''` on read and write), then grep for the escape.
- **The Samsung lab's raw records** (`D:/tmp/lablo-samsung/artifacts/lab-logs/*.ndjson`) hold more than results.md: track counts, `prepareMs`, `canPlayType`, AVPlay's error text. Grep them before guessing.
- **`epg-declared-300mb` flaked again** (28.4 ms against 20): rerun once the whole run is done.
- **Never `cd`** in a Bash call: one `cd /d` moved the session's directory, and the shell reset to the main checkout. Use absolute paths.

**From leg 150 (still true):**
- **The `lablo` test account has 2 connections, and a held response counts until its socket closes.** A socket test with more streams open at once gets 403 "Max connections reached". Use `forever`/`forever-test` (4).
- **`packages/*` tests run only from the repo root's Vitest config:** `pnpm --dir "<wt>" exec vitest run packages/player/src/controller.test.ts`. `apps/mock-provider` and `apps/tv` also run from their own folder.
- **`e2e/lab-media.spec.ts` runs only under `pnpm lab:media`** (about 2 min).
- **Live TS** bursts its current 6 s segment, then paces at real time. A byte count depends on the channel (37–338 KB/s; 104 is 118 KB/s).
- **Engines' Chromium 53 start-up flake:** read the log with `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`, then rerun once the whole run is done.

**From leg 149 (still true):**
- **The background CI wait was reaped** under memory pressure. Don't restart it. What works:
  - check once in the foreground (`gh pr checks <n> --repo Omarmarei/Lablo`, about 25 s after `gh pr create`);
  - then foreground waits bounded by `timeout 570`: `until s=$(gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done`, repeated until done (a job id works the same way under `actions/jobs/<id>`).
- **After `gh run rerun <run> --failed`** the job has a new id: `gh run view <run> --repo Omarmarei/Lablo --json jobs --jq '.jobs[] | select(.name=="media") | (.databaseId|tostring) + " " + .status'`.
- **Python patches in a Bash heredoc lose escaped quotes.** Write patch scripts with the Write tool (an EDITS list plus the apply loop, `newline=''` on read and write).
- **`WatchdogConfig` has `fallbackMs`:** a test that spreads `{ ...DEFAULT_WATCHDOG, openTimeoutMs: 20_000 }` inherits the 6 s cap.
- **Sizes:** main.js 471.0 of 500 KB on Tizen; settings.js 99.7 of 150; the query worker 149.3 of 150 (0.7 KB left: keep its code changes tiny).

**From legs 130–148 (still true):**
- **Chromium's quota rule:** it checks the quota only for a transaction that writes; split deletes from puts. `fillStore` fakes a full store; e2e patches `IDBObjectStore.prototype` in the workers.
- **A spec comparing words with the catalog it imports** checks nothing: pin the English sentence as a literal.
- **Plain e2e never plays a channel** (the desktop refuses the `.ts`). To measure the watchdog, watch the `<video>`'s `src`. `page.clock.runFor` over about 6 s trips the watchdog; use `page.clock.fastForward`.
- **`rm` on a shell variable is refused:** write a literal path. `sleep N; cmd` is blocked: wait with `read -t N < /dev/zero` under `timeout`.
- **CI:**
  - a run takes about 30 minutes; `verify` and `media` have 30-minute caps, engines 35;
  - known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes;
  - read the annotations (`gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations`) or the job log, then `gh run rerun <run> --failed` once the whole run is done;
  - no `jq` in Git Bash (use `gh --jq`); a push to an open PR cancels its CI.
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes).
- **Mutation and builds don't mix:** never run mutation beside a build, an e2e run, a probe, a unit run or an agent reading the tree.
- **Settings rows in e2e go by id** (`e2e/settings-rows.ts`). **Onboard in the language you test.** **In Arabic the rail is on the right.** Use `--workers=2` for e2e on this PC.
- **A local unit run of everything** times out heavy tests at 30 s under load: rerun them alone before calling them failures.
- **Peer sessions** (Omar's Samsung session) may send his decisions: act on what Omar decided, but ask him directly before ticks a handover reserved for his word.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`; no fields named like built-ins. (The mock and `tools/` are Node code: these rules don't apply there; a script injected into the TV page is ES5.)
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.**
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Heavy checks one at a time; the full `build:tv` in the background (about 8 minutes; `--target lab` alone fits in the foreground). For sdb paths in Git Bash: `export MSYS_NO_PATHCONV=1`; the Tizen tools are in `/c/tizen-studio/tools/ide/bin` and `/c/tizen-studio/tools`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens (39s6).
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Omar said on 2026-11-23: carry on with new changes without asking.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Omar's decision, when he wants (not blocking): MP4 subtitles on the Samsung.** AVPlay lists an MP4's `mov_text` tracks and sends no cue, so the track menu shows rows that show nothing. Options: leave them (they may work on newer TVs), hide AVPlay's MP4 text rows, or demux `mov_text` ourselves (a feature). Sidecar files work today. architecture.md §2 "Step 39s5".
- **Leg 151's later fix (no step yet):** map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` (a 4K file on an HD set, 0.4–1.7 s) away from `network` once step 21 shows AVPlay's error for a real network cut. Today the app retries such a file, then shows a network failure.
- **Leg 150's choices for 39s3** (Omar may overrule):
  - `live-outages`: 60 s of stream past the burst, then 25 s down (a Stable soak needs a longer outage, in a copy of the file);
  - step 21's "each stall recovered in ≤ 10 s" counts from the outage's end (the mock's `back` line) to the moving picture, plus a check that the app reopened;
  - the lab's soak stays a plain held socket per response.
- **Leg 149's choices for 39s2 stand** (the fallback's cap 6 s and 12 s; catch-up keeps the whole open timeout; no hysteresis). **Legs 145–148's choices stand.**
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16's rest and 21 wait for Omar and the TVs** (his "3a").
- **What remains after 39s:** 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering); with Omar or a TV: 34, 16, 21, 39s4, 39s6's TV run, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - from leg 150: a mock endpoint listing the outages; whether a position that moves while `buffering` should count as playing;
  - from leg 149: a fresh redirect probe on Tizen for a remembered container other than the request's first; the cut's time measured on the Samsung;
  - from leg 148: the live line in the old-engine walk; seed the storage state at start from stored guide failures; a remove-a-source action; measure on the Samsung whether deleting frees usage at once;
  - from leg 147: a per-model tunables block in the config doc (only if step 21 shows a need); whether AVPlay's `prepareAsync` waits for the first buffer; the "Buffering" row in the old-engine walk;
  - from leg 146: the audio and subtitle keys over an end card (`menuRoom`); the prompt in the old-engine walk;
  - older: the restored-source login gap; renaming a source; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `auto-next`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the engines job's 35-minute cap; forwarding workers' unhandled rejections; `epgOverrides` after a re-match; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (0.7 KB left); the start's resume before the worker's load; a VNode test of the pad; the local e2e worker count under load; stored guides keeping their titles' language after a language switch.

## Checks for Omar
1. **39s5 has no screen.** The lab's `hevc-4k` row now reads "4K HEVC VOD plays (4K TVs)". He may choose what happens to MP4 subtitle rows on the Samsung (above).
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
  - step 21's soak with `pnpm mock --scenario live-outages` on channel 104: the app should show "Reconnecting…" once per outage and play again within a few seconds of the mock's `back` line;
  - **new (39s5):** install the lab with `pnpm device install tizen <serial> --lab` (now `LabloLab.wgt`, no `sdb push` workaround);
  - **new (39s6, once built):** one run of the `pnpm tv` tools on the TV.
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
