# Lablo IPTV: relay leg 154 opening prompt

You are leg 154 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–152 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21) and 39s1–39s3, 39s5, and 39s6's code (PRs #175–#179).
- **Leg 153 (2026-11-25): step 40 refined and split, Omar's answers recorded, step 40ci added, 40a built and merged: PR #180 as `ddaacf7`.**
  - **Step 40's split** (RELAY.md, under `- [ ] 40.`): 40a, the diagnostics page (done); **40ci, the CI speed-up (next)**; 40b, "Test stream"; 40c, Help; 40d, the legal pages.
  - **Omar's answers (2026-11-25, in the tab):**
    - **the legal text:** a factual draft now, marked "Draft for counsel" in the app and on the web. It covers what Lablo really collects and keeps: telemetry 90 days, support reports 30, backups 180, pairing 1 h. A release check refuses a store build while a draft mark remains;
    - **the test stream:** its link comes from the signed remote config, and the button shows only when the config names one. Step 34 hosts a Lablo test pattern; dev and e2e use the mock's stream;
    - **support:** `lablo.iptv@gmail.com`, built into Help. It is public on purpose: the repo is public.
  - **40ci came from Omar's session `iptv-df`:** a CI speed-up step, placed after 40a and before 40b. Its facts were checked against `ci.yml` and `engines.ts`, and the step is written out in RELAY.md.
  - **40a built:** Settings › "Check the connection", a row before "Send a report to support". Its page shows:
    - the internet (`navigator.onLine`; "Connected" once any server answers);
    - each source's server, up to 6: a panel's `player_api.php` with the account, a playlist's first kilobyte, 10 s each, never a blocked server, never the URL;
    - the run's last stream: played, or the error card's title and code;
    - a verdict in plain words (`connectionVerdict`).
  - **40a's code:**
    - `packages/data/src/source-probe.ts`, the ingest worker's `probe` and `DataEngine.checkSources`;
    - `apps/tv/src/player/last-play.ts` and main's `watchedPlayer`;
    - `apps/tv/src/settings/connection-check.ts` and `ConnectionPage.tsx`;
    - 33 catalog keys in English and Arabic.
  - **CI:** green at the first run (changes, web 3 m, media 12 m, verify 17 m, engines 27 m). Merged with a merge commit; the branch is kept.
  - **The leg stopped once without a handover** right after the refinement's commit (the watcher logged "stopped without a handover"). Omar's "retry" resumed it in the tab. Cause unknown; nothing was lost.
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV;
  - 39s4 and 39s6's TV run (`[needs TV]`);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the `- [ ] 40.` block: "Refined before building" (3 points, Omar's answers);
   - the `- [ ] 40ci.` block, the next step (its 3 points and "Done when");
   - the `- [x] 40a.` block's "Refined while building" (7 points), as a model;
   - the last progress row (153).
2. **For 40ci:** `.github/workflows/ci.yml` (jobs `changes`, `verify`, `engines`, `web`, `media`); `package.json`'s `verify`, `verify:engines`, `verify:media`; `tools/engines/src/engines.ts` (`ENGINES`, ids `chrome53`, `chrome56`, `chrome68`; `--engine`); `tools/engines/verify-engines.ts` (`--self-test`); `playwright.config.ts` (projects `chromium` and `throttled`; `playback-media` only with `LABLO_E2E_MEDIA=1`; which specs need `dist/` from `build:tv`).
3. **Memory notes that cite CI jobs and times** (40ci updates them): gh-pr-checks-watch-race, iptv-ci-media-ffmpeg-apt, bg-watcher-memory-reap.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `b349842` (40a's merge note, row 153), then `a67047e` (40a);
   - `origin/main` is `ddaacf7`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` and no `lablo-chrome*` container.
2. **Step 40ci (CI speed-up).** Measure first: the wall time of the last few PR runs from the first job's start to the last job's end (`gh run view <id> --json jobs`). PR #180's run was `45584448093`; engines was its slowest job, at 27 m. Then:
   - **engines:** a matrix with one shard per engine (`--engine <id>`), `fail-fast: false`. Decide where `--self-test`'s seeded variants run. Artifact names unique per shard. Keep the cache key;
   - **verify:** parallel jobs (lint and typecheck; unit; `build:tv`; e2e `--shard=1/2` and `2/2`). Check whether e2e needs `build:tv`'s `dist/`, keep `pnpm verify` as it is, and keep the `changes` job's filters and outputs;
   - read `gh api repos/Omarmarei/Lablo/branches/main/protection` for required check names before renaming jobs;
   - **Done when:** a `workflow_dispatch` run and the step's PR are green, the wall time before and after is in the notes (target ≤ 15 min), and the three memory notes are updated.
3. **Then 40b** ("Test stream"):
   - a new optional field in the signed config doc (`packages/protocol/src/config.ts`; the config worker has 10.8 KB left);
   - the button on 40a's page only when the config names a link;
   - the play through the app's player;
   - the verdict reads its result;
   - the e2e config stand-in (`e2e/config-server.ts`) names the mock's stream.
4. **Then 40c** (Help, with `lablo.iptv@gmail.com`) **and 40d** (the legal draft, `/terms` and `/privacy` in apps/web, a release check refusing the draft mark). **Their long text must not go in the main catalogs** (see Gotchas).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`ddaacf7`) plus `b349842` (row 153) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 40a's code;
  - in `artifacts/`:
    - `mutate40a.py` with `mutate40a-clean.log`, `-a`, `-b`, `-c`, `-d`, `-e.log`;
    - `unit-40a.log`, `build-tv-40a.log`;
    - screenshots `connection-check-{en,ar,en-XA}.png`.
- **Leg 153's scratch** (outside the repo; safe to ignore): `C:/Users/Omarm/AppData/Local/Temp/claude/8189c30f416cb769/6c058089-8eaa-40e1-a8a8-c6bcba5da195/scratchpad/` (patch scripts, the PR body).

## Verified vs not
- **Verified in leg 153 (40a):**
  - unit: `source-probe.test.ts` 18, `connection-check.test.ts` 21, `last-play.test.ts` 2, `tv-data-engine.test.ts` +1, and the settings pins updated;
  - the full unit run: 9171 of 9184 at first. The 13 failures were the settings pins (fixed) and heavy bundle and lint tests timing out at 30 s under load (all pass alone);
  - lint and typecheck clean;
  - `build:tv` within budgets;
  - e2e: `connection-check.spec.ts` 3 of 3 (en-US, ar-SA, en-XA), the media stream-info test with its new "Played (HLS)" check, and 21 settings specs;
  - screenshots looked at;
  - mutation 80 of 80;
  - CI green at the first run.
- **Not done:** 40a on a real TV; steps 40ci, 40b–40d, 41–47; 39s4 and 39s6's TV runs; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 153:**
- **Catalog text lives in main.js:** every UI string of both languages ships in the main bundle. 40a's 33 short keys cost about 6 KB (main.js 477.2 of 500 KB on Tizen, 22.8 KB left). 40c's help and 40d's legal text must load with Settings (settings.js 106.6 of 150) or a lazy file of their own.
- **Sizes after 40a (Tizen):** main.js 477.2 KB, settings.js 106.6, the ingest worker 139.9 of 150 (10.1 KB left), the query worker 149.3 of 150 (0.7 KB left; keep its code changes tiny).
- **VNode tests don't expand components:** a line drawn by a sub-component is invisible to `walk()`. Draw it with a plain function (`lineView`).
- **A new settings row moves pins:**
  - `SETTINGS_ITEMS` and `SETTINGS_SCREENS` in `guides-state.test.ts`;
  - the last window in `parental-view.test.ts`;
  - the `data-pending` sum in `unmatched-screen.test.ts`;
  - fakes without the new `Settings` field (`channel-edit-screen.test.ts`).
  - Pass a new page's dependencies through its own options, not the settings' engine, so the many engine fakes need nothing.
- **A source's name with `dir="auto"` in a flex row needs a physical `text-align: left`** (rtlcss mirrors it). Otherwise an LTR name sits beside its value in Arabic.
- **e2e can change the mock while the app runs:**
  - `app.mockState.scenario = parseScenario({ rules: [...] }, 'name')`;
  - an account's status through `app.mockState.fixture.accounts`;
  - `page.context().setOffline(true)` for `navigator.onLine`;
  - reset all of them in `afterEach`.
  - `trackErrors` counts the browser's 404 resource lines: filter them in a spec that faults streams.
- **One media spec:** `LABLO_E2E_MEDIA=1 pnpm exec playwright test e2e/player-media.spec.ts --project=playback-media -g "…"`. The file must come before `--project=`. A played stream's text carries bidi marks even in en-US: `stripIsolates`.
- **A dead `slice` survived mutation:** when a mutant shows code changes nothing, drop the code rather than invent a test.
- **Writing `\u200e` through a Python heredoc** still landed raw bidi characters in a memory file. Write escapes with `chr(92) + 'u…'` and check with `od -c`.
- **Never `cd` in a Bash call.** Leg 153 did it once by habit.

**From leg 152 (still true):**
- **Node 22 differs from this PC's Node 24:** its `WebSocket` re-fires `error` from `close()` on a socket that never opened. Never close from an error handler.
- **Python patches:** inline `python -c` with regex backslashes fails. Use a Write-tool or quoted-heredoc script with an EDITS list and `newline=''`.
- **Hand-computed test expectations** were off before: derive them step by step. Leg 153's slip: `containerName('ts')` is `MPEG-TS`.

**From legs 130–151 (still true):**
- **The tools don't import each other;** a root `test/` file holds a shared rule together.
- **`packages/*` tests run only from the repo root's Vitest config:** `pnpm --dir "<wt>" exec vitest run packages/...`.
- **The `lablo` test account has 2 connections,** and a held response counts until its socket closes. Use `forever` (4) for more streams.
- **CI waits:**
  - check once about 25 s after `gh pr create`;
  - then foreground waits bounded by `timeout 575`: `until s=$(gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done`;
  - repeat until done.
- **After `gh run rerun <run> --failed`** the job has a new id.
- **CI:**
  - a run takes about 30 minutes; `verify` and `media` have 30-minute caps, engines 35;
  - known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes, engines' cap;
  - read the annotations or the job log before rerunning;
  - no `jq` in Git Bash (use `gh --jq`); a push to an open PR cancels its CI.
- **Chromium's quota rule:** the quota is checked only for a writing transaction.
- **Plain e2e never plays a channel.** Use `page.clock.fastForward`, never `runFor` over about 6 s.
- **`rm` on a shell variable is refused:** write a literal path. `sleep N` is blocked: wait with `read -t N < /dev/zero` under `timeout`.
- **Mutation and builds don't mix:** never run mutation beside a build, an e2e run, a unit run or an agent reading the tree.
- **Settings rows in e2e go by id** (`e2e/settings-rows.ts`). **Onboard in the language you test.** **In Arabic the rail is on the right.** Use `--workers=2` for e2e on this PC.
- **A local unit run of everything** times out heavy tests at 30 s under load: rerun them alone before calling them failures.
- **Peer sessions** (Omar's other sessions) may send his decisions: act on them as RELAY steps after checking their facts; ask Omar himself for ticks a handover reserved for his word.

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
  - the full `build:tv` runs in the background (about 8 minutes);
  - for sdb paths in Git Bash: `export MSYS_NO_PATHCONV=1`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose (Omar's answer).
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Omar said on 2026-11-23: carry on with new changes without asking.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **None pending for step 40:** Omar answered all three (above).
- **Omar's decision, when he wants (not blocking): MP4 subtitles on the Samsung.** AVPlay lists an MP4's `mov_text` tracks and sends no cue. Options: leave them; hide AVPlay's MP4 text rows; demux `mov_text` ourselves (architecture.md §2 "Step 39s5").
- **Leg 153's choices for 40a** (Omar may overrule):
  - six sources at most on the page;
  - no reference host (a check against Lablo's `/v1/health` can come with step 34);
  - the row sits before "Send a report to support".
- **Leg 152's choices for 39s6** (Omar may overrule):
  - the client name `LabloLabPC`;
  - the soak's 1.5 s stall rule and the hour's sample cap;
  - TLS accepts the TV's self-signed certificate on :8002 only;
  - LG's own remote keys (SSAP) are a later part.
- **Later fixes to propose (no step yet):**
  - from leg 153: a reference check of Lablo's server on the connection page (with step 34); the page's codec and bitrate of the last stream (the stream info has them while playing);
  - from leg 152: `pnpm tv` on webOS (SSAP keys; `ares-inspect`'s port); a `pnpm tv` mode that types into the TV keyboard only after `ms.remote.imeStart`;
  - from leg 151: map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows AVPlay's error for a real network cut;
  - from leg 150: a mock endpoint listing the outages; whether a position that moves while `buffering` should count as playing;
  - from leg 149: a fresh redirect probe on Tizen for a remembered container other than the request's first; the cut's time measured on the Samsung;
  - from leg 148: the live line in the old-engine walk; seed the storage state at start from stored guide failures; a remove-a-source action; whether deleting frees usage at once on the Samsung;
  - from leg 147: a per-model tunables block in the config doc (only if step 21 shows a need); whether AVPlay's `prepareAsync` waits for the first buffer; the "Buffering" row in the old-engine walk;
  - from leg 146: the audio and subtitle keys over an end card (`menuRoom`); the prompt in the old-engine walk;
  - older:
    - player and channels: the restored-source login gap; renaming a source; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `auto-next`'s `endEpisode` race; `epgOverrides` after a re-match; the start's resume before the worker's load; a VNode test of the pad; stored guides keeping their titles' language after a language switch;
    - flakes and CI: a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the local e2e worker count under load (40ci addresses the engines cap and the run time);
    - infrastructure: forwarding workers' unhandled rejections; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (0.7 KB left).
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain;
  - the test stream's file on Lablo's storage and its link in the production config (40b's answer);
  - the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **What remains:**
  - without Omar or a TV: 40ci, 40b, 40c, 40d, 43 (accessibility), 44 (store documents), 45 (release engineering);
  - with Omar or a TV: 34, 16, 21, 39s4, 39s6's TV run, 41, 42, 46, 47.

## Checks for Omar
1. **40a, Settings › "Check the connection":** screenshots in the worktree (gitignored), `artifacts/screenshots/connection-check-en.png`, `-ar.png` and `-en-XA.png`. Nothing to decide unless he wants other words; native Arabic review is step 46.
2. **39s6 has no screen.** Try `pnpm tv` at the Samsung next time (tv-setup.md §3.7): `pnpm tv setup <tv-ip>`, `pnpm tv keys` (accept "Allow" once), `pnpm tv inspect`, `pnpm tv screen`, `pnpm tv soak watch`.

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
  - `pnpm tv eval --port N`, `screen` and `soak` through `pnpm device inspect webos tv`'s port;
  - **new (40a):** Settings › "Check the connection", with the TV's network on and off.
- **At the Samsung TV next time** (his "3a"):
  - S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, with the TV's own remote;
  - look for the "Zoma" he saw;
  - the sleep timer's prompt as on the LG;
  - a channel's start under "Fast start" and under "Stable" (AVPlay's buffers);
  - the lab's S2 again (the lab now carries `unlimitedstorage`): does `storage.estimate()` still say 88 MB?
  - after a network outage, the next zap and the next launch start on `.ts` again; with the `.m3u8` answering 404 and `.m3u8` remembered, how long until `.ts` plays (expect about 6 s plus AVPlay's close);
  - step 21's soak with `pnpm mock --scenario live-outages` on channel 104: the app should show "Reconnecting…" once per outage and play again within a few seconds of the mock's `back` line (`pnpm tv soak watch` records it);
  - install the lab with `pnpm device install tizen <serial> --lab` (`LabloLab.wgt`, no `sdb push` workaround);
  - 39s6's run: `pnpm tv setup`, `keys`, `launch`, `inspect`, `screen`, `marks` (39s4's start), `soak watch`;
  - **new (40a):** Settings › "Check the connection".
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:** the ToS and privacy policy replace 40d's draft before launch (his legal track, weeks 2–4).
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
