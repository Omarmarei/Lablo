# Lablo IPTV: relay leg 156 opening prompt

You are leg 156 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–154 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21), 39s1–39s3, 39s5, 39s6's code, 40a and 40ci (PRs #175–#181).
- **Leg 155 (2026-11-25): step 40b ("Test stream") built and merged: PR #182 as `8f67a10`**, green CI at the first run (all 11 checks).
  - **Config:** the signed config doc has an optional `testStream: { url }` (`packages/protocol/src/config.ts`), passed on as `ConfigPolicy.testStream`. Old apps strip the field (no new `v`). `pnpm sign-config sign` refuses a non-https link. The committed config names none until step 34 hosts Lablo's test pattern.
  - **Page** (Settings › "Check the connection"): with a link, and no `disable-playback` or stronger in force, a "Test stream" line and a "Test stream" button between "Check again" and "Close"; five sources at most then (`CONNECTION_SOURCES_WITH_TEST`).
  - **Test screen** (`test-stream`, settings.js): plays the link on the app's one player (main's `watchedPlayer`) under a bar with "Close"; Close, Back and STOP stop it. Main's `testing` flag keeps its plays out of "Last stream" and telemetry.
  - **Verdict:** a failed test → `test`; a played test with the last stream failed by the provider or the internet → `streams`; a played test while no server answered → `provider`.
  - **Gates:** unit +10 (`connection-check.test.ts` 31); e2e `connection-check.spec.ts` 6/6 and the media played path; `build:tv` within budgets; mutation 64/64 (`artifacts/mutate40b.py`).
  - **Found:** this PC's `.cache/media` predates the rename: its live loops burn in "Zoma Test 1 SMPTE". `pnpm mock:media` regenerates them. This may be the "Zoma" Omar saw on the Samsung (if it played from this PC's mock).
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and step 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV;
  - 39s4, and 39s6's TV run (`[needs TV]`);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the `- [ ] 40.` block's "Refined before building": Omar's three answers (the legal draft marked "Draft for counsel", the test stream's link from the remote config, support at `lablo.iptv@gmail.com`);
   - the `- [ ] 40c.` line (the next step) and the `- [ ] 40d.` line;
   - the `- [x] 40b.` block ("Refined before building", "Refined while building", "Gates") and `- [x] 40a.`, as models;
   - the last progress row (155).
2. **For 40c (Help):**
   - how Settings' rows and pages are built: `apps/tv/src/settings/settings-items.ts`, `settings-state.ts` (`SETTINGS_SCREENS`, `SettingsOptions`), `SettingsScreen.tsx`, and 40a/40b's page (`connection-check.ts`, `ConnectionPage.tsx`);
   - "Send a report to support" (step 33d2): `apps/tv/src/settings/diag-report.ts`, `report-row.test.ts`: its support code;
   - the error card's codes and words: `apps/tv/src/player/PlayerScreen.tsx` (`CATEGORY_TEXT`, `ACCOUNT_TEXT`), `packages/player/src/failure.ts`;
   - the catalogs `apps/tv/src/i18n/en.ts`, `ar.ts`, and how settings.js loads (`apps/tv/src/settings/settings.ts`, tv-build.md "Settings load on first open").
3. **Memory notes:** iptv-tv-bundle-polyfills (sizes; long text must not go in the main catalogs), iptv-ui-test-gotchas (leg 155: re-check before asserting a value read only at a check), iptv-parser-test-patterns (mutation; `MEDIA ` commands), gh-pr-checks-watch-race (CI waits), use-write-tool-for-doc-batches.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `02305c0` (40b ticked, row 155), then `8f67a10` (PR #182's merge);
   - `origin/main` is `8f67a10`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` and no `lablo-chrome*` container.
2. **Step 40c, Help** (Omar's answer: `lablo.iptv@gmail.com`, public on purpose). Refine it first against the code, and write "Refined before building" points into RELAY.md. The step's line: Settings › "Help": short answers in English and Arabic (adding a playlist or a login, what the error card's codes mean, the remote's keys, the support code), and the support address with "Send a report to support"'s code.
   - **Size is the key design point:** every catalog key of both languages lives in main.js (478.7 of 500 KB on Tizen, 21.3 KB left). The help's long text must load with Settings (settings.js 110.0 of 150 KB) or from a lazy file of its own, never the main catalogs. Decide how the text gets there (a settings.js-only text table per language that the lint rule `lablo/no-hard-coded-text` accepts, or a lazy JSON) and record the choice.
   - Where the row goes (likely near "Check the connection" and "Send a report to support"), and the settings pins it moves (see Gotchas).
   - **Done when:** unit tests; e2e in en-US, ar-SA and en-XA (the row, the page, scrolling if long, the address and the code); `build:tv` within budgets (main.js must not grow by the help's text); mutation with the list written first; the PR merged on green CI.
3. **Then 40d** (the legal pages: Settings › "About Lablo" with the version, the disclaimer, the terms and privacy text marked "Draft for counsel"; `/terms` and `/privacy` (en, ar) in apps/web; onboarding's consent pointing at the privacy text; a release check that refuses the draft mark). Same size rule.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`8f67a10`) plus `02305c0` (40b ticked, row 155) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including the pre-rename `.cache/media`), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 40b's code;
  - `artifacts/`: `mutate40b.py` (64/64) and leg 155's screenshots (`test-stream-<tag>.png`, `connection-test-<tag>.png`, `test-stream-playing-en.png`).
- **Leg 155's scratch** (`C:/Users/Omarm/.claude/jobs/9f618c26/tmp`; safe to ignore): the patch scripts `p1.py`–`p13.py`, `build-tv.log`, `pr-body.md`, `mem155.py`.

## Verified vs not
- **Verified in leg 155 (40b):**
  - unit, typecheck and lint clean; the config worker bundle test carries the link into the policy;
  - `build:tv` (Tizen): main.js 478.7 of 500 KB, settings.js 110.0 of 150, config worker 139.3 of 150, ingest 139.9, query 149.3;
  - e2e `connection-check.spec.ts` 6/6 in three languages (a 404 link fails as `PRV-UNREACHABLE` within seconds; a config turning playback off, or dropping the link, hides the button); the media test plays the mock's first channel as the test stream (960x540, the picture moving under the bar);
  - screenshots looked at (en, ar, en-XA): the bar at the bottom over the stage, the page's fourth line and three buttons in reading order;
  - mutation 64/64; PR #182 green at the first run.
- **Not done:**
  - 40b and 40a on a real TV (AVPlay under the bar, the stage under settings.js on Tizen);
  - steps 40c, 40d and 41–47;
  - 39s4, and 39s6's TV run;
  - production (step 34), including the test pattern's file and its link in the production config.
- **Migrations and deploys:** none. Nothing is deployed (this project has no deploy before step 34).

## Gotchas and lessons
**New in leg 155:**
- **A value a page reads only when its check runs** ("Last stream" on the connection page) is stale after something changes it. An e2e must make a check happen and wait for a change only that check makes (reopen the page and wait for a cleared line; a button the new config removes) before asserting.
- **A plain-e2e playback failure needs no media:** a stand-in link answering 404 ends as `PRV-UNREACHABLE` on the desktop's `<video>` within a few seconds.
- **The connection page's "Close" index** is 1 without a test link and 2 with one: e2e paths use `connection-check/actions/<n>` accordingly.
- **Mutation with the media e2e:** in `artifacts/mutate40b.py`, a command starting `MEDIA ` runs with `LABLO_E2E_MEDIA=1`; name the project on every e2e command.
- **Python patch scripts:** write them with the Write tool and run `python -X utf8 -I <file> <worktree>`. A quoted-heredoc script lost a backslash again this leg.
- **Never `cd` in a Bash call** (one slipped this leg; it moved the session's directory, harmlessly, into the worktree).

**From leg 154 (still true):**
- **CI has 11 checks and takes about 13 minutes.** Wait with two foreground rounds of `timeout 575 bash -c 'until s=$(gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done; echo "$s"'`. Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 2` about 25 s after `gh pr create`.
  - `gh run rerun <run> --failed` reruns only the failed matrix jobs; a rerun job has a new id.
  - One job's log: `gh api repos/Omarmarei/Lablo/actions/runs/<run>/jobs --jq '.jobs[] | "\(.name)=\(.id)"'`, then `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`.
- **Playwright never shards a project another depends on:** CI shards `--project=chromium` and runs `--project=throttled --no-deps` alone.
- **A fake event scheduled before an async call races that call's I/O:** start a fake's timers inside the injected factory.
- **Known flakes:** `epg-declared-300mb` (22.0 ms vs 20); `auto-next.spec.ts:151` ar-SA. Read the job log before rerunning.

**From leg 153 (still true):**
- **Catalog text lives in main.js:** every UI string of both languages ships in the main bundle. 40c's help and 40d's legal text must load with Settings or a lazy file of their own.
- **VNode tests don't expand components:** draw lines with plain functions (`lineView`).
- **A new settings row moves pins:** `SETTINGS_ITEMS` and `SETTINGS_SCREENS` in `guides-state.test.ts`; the last window in `parental-view.test.ts`; the `data-pending` sum in `unmatched-screen.test.ts`; fakes without the new `Settings` field. Pass a new page's dependencies through its own options, not the settings' engine. A new settings screen goes in `SETTINGS_SCREENS` (its pin too).
- **A source's name with `dir="auto"` in a flex row needs a physical `text-align: left`.**
- **e2e can change the mock while the app runs** (`app.mockState.scenario`, `fixture.accounts`, `setOffline`); reset in `afterEach`. `trackErrors` counts the browser's 404 resource lines: filter them where streams fail.
- **e2e with a config:** `startConfigServer('')`, `server.serve(devSignedAnswer(doc({ kill: [], ... })))` (the harness doc's default notice rule would otherwise show), `?api=<origin>` in the onboarding query, then poll `window.__LABLO_TEST__?.config()?.status` for `fresh`; `refreshConfig()` after serving a new doc (date it later: `doc(fields, Date.now() + N)`).
- **One media spec:** `LABLO_E2E_MEDIA=1 pnpm exec playwright test e2e/player-media.spec.ts --project=playback-media -g "…"`. A played stream's text carries bidi marks even in en-US: `stripIsolates`.
- **When a mutant shows code changes nothing,** drop the code rather than invent a test.
- **Escapes in memory files:** write them with `chr(92) + 'u…'` and check with `od -c`.

**From legs 130–152 (still true):**
- **Node 22 (CI) differs from this PC's Node 24:** its `WebSocket` re-fires `error` from `close()`.
- **Derive test expectations step by step** (`containerName('ts')` is `MPEG-TS`).
- **The tools don't import each other;** a root `test/` file holds a shared rule together.
- **`packages/*` tests run only from the repo root's Vitest config:** `pnpm --dir "<wt>" exec vitest run packages/...`.
- **The `lablo` test account has 2 connections;** use `forever` (4) for more streams.
- **No `jq` in Git Bash** (use `gh --jq`). A push to an open PR cancels its CI.
- **Plain e2e never plays a channel.** Use `page.clock.fastForward`, never `runFor` over about 6 s.
- **`rm` on a shell variable is refused:** write a literal path. `sleep N` is blocked: wait with `read -t N < /dev/zero` under `timeout`.
- **Mutation and builds don't mix:** never run mutation beside a build, an e2e run, a unit run or an agent reading the tree.
- **Settings rows in e2e go by id** (`e2e/settings-rows.ts`). Onboard in the language you test. In Arabic the rail is on the right. Use `--workers=2` for e2e on this PC.
- **A local unit run of everything** times out heavy tests at 30 s under load: rerun them alone before calling them failures.
- **Peer sessions** (Omar's other sessions) may send his decisions: act on them as RELAY steps after checking their facts.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread in new code, no fragments;
  - no `Promise.prototype.finally`; no fields named like built-ins;
  - these don't apply to the mock and `tools/` (Node code); a script injected into the TV page is ES5.
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs (or, for 40c/40d, whatever settings.js-only text source the step decides). Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.**
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:**
  - CI runs Node 22, this PC Node 24. Run heavy checks one at a time;
  - the full `build:tv` runs in the background (about 8 minutes);
  - for sdb paths in Git Bash: `export MSYS_NO_PATHCONV=1`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose (Omar's answer).
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Omar said on 2026-11-23: carry on with new changes without asking. After the merge: `git -C "<wt>" merge --ff-only origin/main`, then tick the step and add the progress row.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **None pending for step 40:** Omar answered all three questions in leg 153.
- **Leg 155's choices for 40b** (Omar may overrule):
  - the test plays as a file (`vod`): a file ends with "The test stream has ended.", a live stream plays on;
  - a played test stays "played" even if the stream fails later (the question is whether the TV plays video);
  - the button hides while the config turns playback off, but a `disable-playback` arriving during a test doesn't stop it;
  - five sources at most on the page when the test line shows.
- **Leg 154's choices for 40ci** (Omar may overrule): every engine's job runs its own seeds; each e2e shard builds the TV apps; two e2e shards plus the throttled project on its own runner.
- **Omar's decision, when he wants (not blocking): MP4 subtitles on the Samsung.** AVPlay lists an MP4's `mov_text` tracks and sends no cue. Options: leave them; hide AVPlay's MP4 text rows; demux `mov_text` ourselves (architecture.md §2 "Step 39s5").
- **Leg 153's choices for 40a** (Omar may overrule): six sources at most on the page; no reference host; the row before "Send a report to support".
- **Leg 152's choices for 39s6** (Omar may overrule): the client name `LabloLabPC`; the soak's 1.5 s stall rule and the hour's sample cap; TLS accepts the TV's self-signed certificate on :8002 only; LG's own remote keys (SSAP) in a later part.
- **Later fixes to propose (no step yet):**
  - from leg 155: regenerate `.cache/media` (`pnpm mock:media`) so the mock's pictures say Lablo; stop a test stream when a `disable-playback` arrives during it, if Omar wants;
  - from leg 154: media's own split if media becomes the only long job; a fix for the `auto-next` `endEpisode` race (wait for `playing` before dispatching `ended`);
  - from leg 153: a reference check of Lablo's server on the connection page (with step 34); the page's codec and bitrate of the last stream;
  - from leg 152: `pnpm tv` on webOS (SSAP keys; `ares-inspect`'s port); a `pnpm tv` mode that types into the TV keyboard only after `ms.remote.imeStart`;
  - from leg 151: map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows AVPlay's error for a real network cut;
  - from leg 150: a mock endpoint listing the outages; whether a position that moves while `buffering` should count as playing;
  - from leg 149: a fresh redirect probe on Tizen for a remembered container other than the request's first; the cut's time measured on the Samsung;
  - from leg 148: the live line in the old-engine walk; seed the storage state at start from stored guide failures; a remove-a-source action; whether deleting frees usage at once on the Samsung;
  - from leg 147: a per-model tunables block in the config doc (only if step 21 shows a need); whether AVPlay's `prepareAsync` waits for the first buffer; the "Buffering" row in the old-engine walk;
  - from leg 146: the audio and subtitle keys over an end card (`menuRoom`); the prompt in the old-engine walk;
  - older:
    - player and channels: the restored-source login gap; renaming a source; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `epgOverrides` after a re-match; the start's resume before the worker's load; a VNode test of the pad; stored guides keeping their titles' language after a language switch;
    - flakes and CI: a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the local e2e worker count under load;
    - infrastructure: forwarding workers' unhandled rejections; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (0.7 KB left).
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain;
  - the test stream's file on Lablo's storage (a test pattern with a tone, https) and its `testStream` link in the production config (`pnpm sign-config sign` refuses http);
  - the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **What remains:**
  - without Omar or a TV: 40c, 40d, 43 (accessibility), 44 (store documents), 45 (release engineering);
  - with Omar or a TV: 34, 16, 21, 39s4, 39s6's TV run, 41, 42, 46, 47.

## Checks for Omar
1. **40b, Settings › "Check the connection" › "Test stream":** nothing to do until step 34 names a link. The screenshots are in the worktree (gitignored): `artifacts/screenshots/test-stream-playing-en.png` (the bar over a playing stream), `test-stream-en.png`, `-ar.png`, `-en-XA.png` (a failed test), `connection-test-<tag>.png` (the page after it).
2. **"Zoma" on the Samsung:** this PC's cached mock media still burns in "Zoma Test 1 SMPTE" (generated before the rename). If the Samsung played from this PC's mock, that is what you saw. `pnpm mock:media` regenerates the files.
3. **40a's screenshots:** `artifacts/screenshots/connection-check-en.png`, `-ar.png` and `-en-XA.png`.
4. **39s6 has no screen.** Try `pnpm tv` at the Samsung next time (tv-setup.md §3.7): `pnpm tv setup <tv-ip>`, `pnpm tv keys` (accept "Allow" once), `pnpm tv inspect`, `pnpm tv screen`, `pnpm tv soak watch`.

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
  - Settings › "Check the connection", with the TV's network on and off.
- **At the Samsung TV next time** (his "3a"):
  - S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, with the TV's own remote;
  - look for the "Zoma" he saw (see check 2 above);
  - the sleep timer's prompt as on the LG;
  - a channel's start under "Fast start" and under "Stable" (AVPlay's buffers);
  - the lab's S2 again (the lab now carries `unlimitedstorage`): does `storage.estimate()` still say 88 MB?
  - after a network outage, the next zap and the next launch start on `.ts` again; with the `.m3u8` answering 404 and `.m3u8` remembered, how long until `.ts` plays (expect about 6 s plus AVPlay's close);
  - step 21's soak with `pnpm mock --scenario live-outages` on channel 104: the app should show "Reconnecting…" once per outage and play again within a few seconds of the mock's `back` line (`pnpm tv soak watch` records it);
  - install the lab with `pnpm device install tizen <serial> --lab` (`LabloLab.wgt`, no `sdb push` workaround);
  - 39s6's run: `pnpm tv setup`, `keys`, `launch`, `inspect`, `screen`, `marks` (39s4's start), `soak watch`;
  - Settings › "Check the connection".
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:** the ToS and privacy policy replace 40d's draft before launch (his legal track, weeks 2–4).
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-eight CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`;
  - 56: `git show 6235456:HANDOVER.md`;
  - 57: `git show b54b260:HANDOVER.md` ("e2e specs address a settings row by its id through `e2e/settings-rows.ts`, never by its number");
  - 58 (leg 154): CLAUDE.md's commands table says of `pnpm verify`: "CI job `verify` runs exactly this (after `playwright install --with-deps chromium`)". Since step 40ci the `verify` job runs it in five parallel parts: lint and typecheck; unit; e2e of the chromium project in two shards, each after `build:tv`; the throttled project alone.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
