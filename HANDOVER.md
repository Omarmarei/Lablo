# Lablo IPTV: relay leg 153 opening prompt

You are leg 153 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–151 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21) and 39s1–39s3 and 39s5 (PRs #175–#178).
- **Leg 152 (2026-11-24/25): step 39s6 (`pnpm tv`, the tools to drive a TV from the PC) refined, built and merged: PR #179 as `9e775a0`.**
  - **The step stays open (`- [ ] 39s6.`)** for its run on the Samsung, as 39s4 is. The code, tests and docs are done.
  - **CI:**
    - first run: `verify` failed on a real Node 22-only bug (below); `engines` hit its 35-minute cap during Chromium 56;
    - second run, after the fix: all green (verify 17 m, media 10 m, web 3 m, engines 29 m);
    - merged with a merge commit; the branch is kept.
  - **No question for Omar.**
  - **Built** (`tools/tv`, workspace package `@lablo/tools-tv`, root script `"tv": "tsx tools/tv/tv.ts"`):
    - `src/ws.ts`, a raw WebSocket client over TLS for the TV's remote API (`wss://<tv>:8002`; the TV never answers Node's built-in `WebSocket` there):
      - masked client frames (7-, 16- and 64-bit lengths), server frames across chunk splits, continuations, ping/pong and close;
      - `onText` and `onClose` are options of `openRawWebSocket`, because the TV's first message can share the 101's packet;
    - `src/remote.ts`: `SendRemoteKey`, `SendInputString` (base64), `SendInputEnd`; a script of words (`KEY_X`, a pause in ms, `TEXT:<s>`, `END`); the TV's events (connect with its token, unauthorized, the keyboard's start and end);
    - `src/cdp.ts`: `sdb debug`'s port, the inspector's page target, `Runtime.evaluate` over Node's built-in `WebSocket`. The socket can be injected (the fourth argument);
    - `src/soak.ts`:
      - a small ES5 sampler for the page (AVPlay's state and position every 100 ms, or the page's `<video>`; the heap every 5 minutes; an hour's cap);
      - the drain, and the pure `StallDetector` (position frozen ≥ 1.5 s while `PLAYING`);
      - `replaySoak` for `soak report`;
    - `src/commands.ts`: the sdb argument lists (`connect`, `was_execute`, `debug`, `forward`); `tizenAppId`, a copy of tools/device's rule held together by the root test `test/tv-app-ids.test.ts`; the REST app state;
    - `src/config.ts`: `.tv.local.json` at the root (host, serial, client name `LabloLabPC`, token, cdpPort). **It is gitignored** (`.gitignore` line 14, plus a test); the token is never printed;
    - `src/args.ts`, `src/probes.ts` (`screen`, `marks`), `src/format.ts` (compact JSON), `src/main.ts` (the I/O); `tv.ts` only calls `main()`;
    - the docs: tv-setup.md §3.7 "Driving the TV from the PC (`pnpm tv`)", and results.md's pointer.
  - **The Node 22 bug (found by CI):** Node 22's `WebSocket` fires `error` again from inside `close()` on a socket that never opened. The inspector client's error handler closed the socket, so it recursed until the stack overflowed; Node 24 on this PC doesn't do this.
    - Fix: settle first, close after, never close from the error handler, and clear the timer on every settled path.
    - A fake socket test reproduces Node 22's behaviour on any Node.
  - **Docs in RELAY:** 39s6's "Refined before building" (8 points), "Refined while building" (6), "Gates", the merge note on its line, row 152.
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV;
  - 39s4 and 39s6's TV run (`[needs TV]`);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - step 40's line (`- [ ] 40. **Diagnostics and legal pages.**`), the next step;
   - the `- [ ] 39s6.` block and `- [x] 39s5.` as models for "Refined before building", the choices and "Gates";
   - the last progress row (152).
2. **For step 40** (read-ahead from leg 152, not yet refined):
   - docs/PLAN.md:
     - ~line 211: "Is it the app or my provider?" diagnostic (HTTP status, server reachability, stream codec and bitrate);
     - ~line 246: legal surfaces (the in-app disclaimer, ToS, privacy policy, the device ID consent);
     - ~line 419: the connection speed test is v1.1, not v1;
     - ~lines 446–454: counsel writes the ToS and privacy policy; the legal pages go live with the test server;
   - docs/architecture.md:
     - ~line 1454: the error classifier, four user-facing categories with diagnostic codes;
     - ~line 2482: step 33d1, the diagnostics report's schema and API;
     - ~line 2500: step 33d2, "Send a report to support";
   - what exists already:
     - `apps/tv/src/settings/diag-report.ts`; the onboarding disclaimer (`apps/tv/src/onboarding/`); `settings/telemetry-switch.ts`;
     - `apps/web/src/app/` has `p`, `v1` and `dev`, and no legal pages yet.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `70f3b6f` (39s6's merge note, row 152), then `9e775a0` (the merge);
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` (needed only for the web-backed tests) and no `lablo-chrome*` container.
2. **Step 40: refine it first** (write "Refined before building" under it), then split it into session-sized sub-steps (40a, 40b...) in RELAY.md. It likely holds Omar's decisions:
   - **The legal text:** counsel writes the ToS and the privacy policy (PLAN's week 2–4). Either build the in-app pages and the web routes with placeholder text marked as such, or wait for counsel's text. Ask Omar.
   - **The test stream:** "the test server" goes live with step 34's infrastructure, which Omar deferred. A test stream needs a host: a Lablo-hosted URL (step 34), or a public test stream. Ask Omar.
   - **The diagnostics screen** ("app or provider?") can likely be built now: the controller's errors, the classifier's categories and codes, the source's last fetch status, reachability, codec and bitrate from the engine.
   - Ask the decisions as a numbered list Omar can answer with one character (end the leg as needs-you), the recommended option first. Build the parts that need no decision first if the session allows.
3. **Then the next unticked step** without `[needs Omar]` or `[needs TV]` (43, accessibility; 44, store documents; 45, release engineering), or the next sub-step of 40.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`9e775a0`) plus `70f3b6f` (39s6's merge note, row 152) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules` (now with `tools/tv`), `.cache/*` (including `.cache/media`), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 39s2's code, `dist/tv-lab/` from leg 151, `dist/packages/com.lablo.iptv.lab_0.1.0_all.ipk`, no `.wgt`;
  - in `artifacts/`:
    - leg 152's `mutate39s6.py` with its logs (`mutate39s6-clean.log`, `-a`, `-b`, `-c` and `-d.log`), `unit-39s6.log`, `lint-39s6.log`, `typecheck-39s6.log`;
    - `tv-soak-2026-11-24T17-31-24-827Z.ndjson`, the local smoke soak;
    - the earlier legs' logs.
  - **No `.tv.local.json`** (the smoke run's copy was deleted).
- **Leg 152's scratch** (outside the repo; safe to ignore): `C:/Users/Omarm/.claude/jobs/5f067657/tmp/` (patch scripts, `smoke/` with the self-signed `key.pem` and `cert.pem`, `faketv.ts`, a Chromium profile).

## Verified vs not
- **Verified in leg 152 (39s6):**
  - unit: tools/tv 92 tests in 9 files; with tools/device and the two root tests, 107 of 107 in 12 files. CI's verify ran the full suite on Node 22;
  - lint and typecheck clean (the root and the package);
  - mutation 78 of 78 (`artifacts/mutate39s6.py`, the list written first; one first-run survivor closed; 75–78 added for the Node 22 fix before they ran);
  - local runs with no TV:
    - headless Chromium 156's DevTools: `screen`, `marks`, `eval` (a value; an exception exits 1);
    - a 1-minute `soak watch` with a 3 s pause injected found one 3.2 s stall, and `soak report` of its file found the same;
    - a fake TV over TLS on :8002: `setup`, `keys` with keys, text and `END` (the token saved, never printed), token reuse, and the refusal (exit 1);
  - CI green at the second run.
- **Not done:**
  - `pnpm tv` on the Samsung (39s6 stays open); webOS through `ares-inspect` (`--port`) untried;
  - installing `LabloLab.wgt` on the Samsung through `pnpm device` (39s5's open check);
  - steps 39s4, 40–47; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 152:**
- **Node 22 differs from this PC's Node 24:** its `WebSocket` re-fires `error` from `close()` on a socket that never opened. Never close from an error handler. Make sockets injectable and test that behaviour with a fake (memory: iptv-tools-test-gotchas).
- **A raw socket client takes its handlers at open:** a first frame can share the 101's packet.
- **Smoke-testing tools without a TV:**
  - headless Chromium (`ms-playwright/chromium-1248`, `--headless=new --remote-debugging-port=N --user-data-dir=<scratch>`) is a real DevTools endpoint. Stop it afterwards by its user-data-dir (`Get-CimInstance Win32_Process`);
  - a self-signed certificate from `openssl` (with `MSYS_NO_PATHCONV=1`) gives a TLS fake TV;
  - tsx imports a worktree module by a `file:///D:/Claude%20Code%20PlayGround/...` URL.
- **`engines` runs on any lockfile change.** Its 35-minute cap hit again (Chromium 53 alone took 28 minutes); the next run took 29 minutes.
- **Never `cd` in a Bash call.** Leg 152 did it twice by habit and the session's directory moved. Use absolute paths and `git -C`.
- **Python patches:** an inline `python -c` with regex backslashes failed again; the Edit tool or a Write-tool script works.
- **Hand-computed test expectations** (the stall arithmetic, the padding widths) were off five times. Generate the expected strings with a script, or derive the sample sequences step by step before writing the numbers.

**From leg 151 (still true):**
- **The tools don't import each other.** When two tools need one rule, keep a copy in each and let a root `test/` file check that they agree. Root tests may import any `tools/*/src` module.
- **`vi.mock` of a Node module:** write `import type * as ChildProcess from 'node:child_process'` and `importOriginal<typeof ChildProcess>()`.
- **A NBSP escape in Write-tool content lands as the raw character:** fix with a `python -X utf8 -I -c` replace of `chr(0xa0)`, then grep for the escape.
- **The Samsung lab's raw records** (`D:/tmp/lablo-samsung/artifacts/lab-logs/*.ndjson`) hold more than results.md: grep them before guessing.
- **`epg-declared-300mb` flakes:** rerun once the whole run is done.

**From leg 150 (still true):**
- **The `lablo` test account has 2 connections, and a held response counts until its socket closes.** Use `forever`/`forever-test` (4) for tests with more streams.
- **`packages/*` tests run only from the repo root's Vitest config:** `pnpm --dir "<wt>" exec vitest run packages/...`.
- **`e2e/lab-media.spec.ts` runs only under `pnpm lab:media`.**
- **Engines' Chromium 53 start-up flake:** read the log with `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`, then rerun once the whole run is done.

**From leg 149 (still true):**
- **CI waits:**
  - check once in the foreground about 25 s after `gh pr create`;
  - then foreground waits bounded by `timeout 570`: `until s=$(gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done`;
  - repeat until done (a job id works the same way under `actions/jobs/<id>`).
- **After `gh run rerun <run> --failed`** the job has a new id: `gh run view <run> --repo Omarmarei/Lablo --json jobs --jq '.jobs[] | select(.name=="media") | (.databaseId|tostring) + " " + .status'`.
- **Write patch scripts with the Write tool** (an EDITS list plus the apply loop, `newline=''` on read and write).
- **Sizes:** main.js 471.0 of 500 KB on Tizen; settings.js 99.7 of 150; the query worker 149.3 of 150 (0.7 KB left: keep its code changes tiny).

**From legs 130–148 (still true):**
- **Chromium's quota rule:** it checks the quota only for a transaction that writes; split deletes from puts.
- **A spec comparing words with the catalog it imports** checks nothing: pin the English sentence as a literal.
- **Plain e2e never plays a channel.** Use `page.clock.fastForward`, never `runFor` over about 6 s.
- **`rm` on a shell variable is refused:** write a literal path. `sleep N; cmd` is blocked: wait with `read -t N < /dev/zero` under `timeout`.
- **CI:**
  - a run takes about 30 minutes; `verify` and `media` have 30-minute caps, engines 35;
  - known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes, engines' cap;
  - read the annotations (`gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations`) or the job log before rerunning: leg 152's first failure was a real bug;
  - no `jq` in Git Bash (use `gh --jq`); a push to an open PR cancels its CI.
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes).
- **Mutation and builds don't mix:** never run mutation beside a build, an e2e run, a probe, a unit run or an agent reading the tree.
- **Settings rows in e2e go by id** (`e2e/settings-rows.ts`). **Onboard in the language you test.** **In Arabic the rail is on the right.** Use `--workers=2` for e2e on this PC.
- **A local unit run of everything** times out heavy tests at 30 s under load: rerun them alone before calling them failures.
- **Peer sessions** (Omar's Samsung session) may send his decisions: act on what Omar decided, but ask him directly before ticks a handover reserved for his word.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread in new code, no fragments;
  - no `Promise.prototype.finally`; no fields named like built-ins;
  - these don't apply to the mock and `tools/` (Node code); a script injected into the TV page is ES5.
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.**
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:**
  - CI runs Node 22, this PC Node 24. Run heavy checks one at a time;
  - the full `build:tv` runs in the background (about 8 minutes); `--target lab` alone fits in the foreground;
  - for sdb paths in Git Bash: `export MSYS_NO_PATHCONV=1`. The Tizen tools are in `/c/tizen-studio/tools/ide/bin` and `/c/tizen-studio/tools`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens (`.tv.local.json` stays gitignored).
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Omar said on 2026-11-23: carry on with new changes without asking.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Step 40's likely questions** (see "Next steps"): placeholder legal text or wait for counsel; the test stream's host before step 34.
- **Omar's decision, when he wants (not blocking): MP4 subtitles on the Samsung.** AVPlay lists an MP4's `mov_text` tracks and sends no cue. The options:
  - leave them;
  - hide AVPlay's MP4 text rows;
  - demux `mov_text` ourselves.
  - architecture.md §2 "Step 39s5".
- **Leg 152's choices for 39s6** (Omar may overrule):
  - the client name `LabloLabPC` (the Samsung session's, so its token works);
  - the soak's 1.5 s stall rule and the hour's sample cap;
  - the TLS socket accepts the TV's self-signed certificate on :8002 only;
  - LG's own remote keys (SSAP) are a later part.
- **Later fixes to propose (no step yet):**
  - from leg 152: `pnpm tv` on webOS (SSAP keys; `ares-inspect`'s port tried); a `pnpm tv` mode that types into the TV keyboard only after `ms.remote.imeStart`;
  - from leg 151: map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows AVPlay's error for a real network cut;
  - from leg 150: a mock endpoint listing the outages; whether a position that moves while `buffering` should count as playing;
  - from leg 149: a fresh redirect probe on Tizen for a remembered container other than the request's first; the cut's time measured on the Samsung;
  - from leg 148: the live line in the old-engine walk; seed the storage state at start from stored guide failures; a remove-a-source action; measure on the Samsung whether deleting frees usage at once;
  - from leg 147: a per-model tunables block in the config doc (only if step 21 shows a need); whether AVPlay's `prepareAsync` waits for the first buffer; the "Buffering" row in the old-engine walk;
  - from leg 146: the audio and subtitle keys over an end card (`menuRoom`); the prompt in the old-engine walk;
  - older:
    - player and channels: the restored-source login gap; renaming a source; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `auto-next`'s `endEpisode` race; `epgOverrides` after a re-match; the start's resume before the worker's load; a VNode test of the pad; stored guides keeping their titles' language after a language switch;
    - flakes and CI: a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the engines job's 35-minute cap (hit again in leg 152); the local e2e worker count under load;
    - infrastructure: forwarding workers' unhandled rejections; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (0.7 KB left).
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain;
  - the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **What remains:**
  - without Omar or a TV: 40 (diagnostics and legal pages, likely with questions), 43 (accessibility), 44 (store documents), 45 (release engineering);
  - with Omar or a TV: 34, 16, 21, 39s4, 39s6's TV run, 41, 42, 46, 47.

## Checks for Omar
1. **39s6 has no screen.** Try `pnpm tv` at the Samsung next time (tv-setup.md §3.7):
   - `pnpm tv setup <tv-ip>`;
   - `pnpm tv keys` (accept "Allow" on the TV once);
   - `pnpm tv inspect`, then `pnpm tv screen`;
   - `pnpm tv soak watch`.
2. **The storage line (from leg 148):** `artifacts/screenshots/storage-full-en.png`, `-ar.png`, `-en-XA.png` (in the worktree, gitignored). Nothing to decide unless he wants other words.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once and look at the new order;
  - switch the language in Settings both ways;
  - try Settings › "Player": each row, a channel with two audio languages, "Clock while watching", and "Buffering" on Stable before playing a channel;
  - set "Sleep timer" to 30 minutes, play a channel and wait for the prompt; try its two buttons and Back;
  - try the colour keys (red on a channel row and in the player, green, yellow, blue) and the Guide key on the remote;
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad with the remote;
  - hide and show the app while unlocked;
  - try "Forgot your PIN?" with the TV's keyboard;
  - try "Set a PIN" on onboarding's done screen;
  - try "Use your phone" on the check, with a real phone;
  - **new (39s6):** `pnpm tv eval --port N`, `screen` and `soak` through `pnpm device inspect webos tv`'s port.
- **At the Samsung TV next time** (his "3a"):
  - S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, with the TV's own remote;
  - look for the "Zoma" he saw;
  - the sleep timer's prompt as on the LG;
  - a channel's start under "Fast start" and under "Stable" (AVPlay's buffers);
  - the lab's S2 again (the lab now carries `unlimitedstorage`): does `storage.estimate()` still say 88 MB?
  - after a network outage, the next zap and the next launch start on `.ts` again; with the `.m3u8` answering 404 and `.m3u8` remembered, how long until `.ts` plays (expect about 6 s plus AVPlay's close);
  - step 21's soak with `pnpm mock --scenario live-outages` on channel 104: the app should show "Reconnecting…" once per outage and play again within a few seconds of the mock's `back` line (`pnpm tv soak watch` now records it);
  - install the lab with `pnpm device install tizen <serial> --lab` (`LabloLab.wgt`, no `sdb push` workaround);
  - **39s6's run:** `pnpm tv setup`, `keys`, `launch`, `inspect`, `screen`, `marks` (39s4's start), `soak watch`.
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
