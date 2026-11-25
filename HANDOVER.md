# Lablo IPTV: relay leg 155 opening prompt

You are leg 155 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–153 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21), 39s1–39s3, 39s5, 39s6's code and 40a (PRs #175–#180).
- **Leg 154 (2026-11-25): step 40ci (the CI speed-up) built and merged: PR #181 as `018b4fc`.**
  - **Before:** a PR's CI took 27–29 min from the first job's start to the last job's end. engines ran Chromium 53, 56 and 68 one after another (25 min); verify ran `pnpm verify` as one chain (17–22 min, e2e 12 of it).
  - **After:** 12 m 46 s on PR #181's green run; the `workflow_dispatch` run took 14 m 00 s. Chromium 56 (about 12.6 min) and media (about 11.8) now set the run's length.
  - **`ci.yml` now has 11 checks:**
    - `changes`, `web` and `media` are unchanged;
    - `engines (chrome53)`, `engines (chrome56)`, `engines (chrome68)`: a matrix, each `--self-test --engine <id>` with its own `build:tv --skip-package`, capped at 25 min. The cache key is `engines-<id>-<hash>`; the artifact is `old-engines-report-<id>`;
    - `verify (lint)` (lint and typecheck, 10 min) and `verify (unit)` (15 min);
    - `verify (e2e 1/2)` and `verify (e2e 2/2)`: each runs `pnpm build:tv`, then `pnpm e2e --project=chromium --shard=N/2` (25 min). Shard 1 uploads `tv-builds`; each shard uploads `gallery-screenshots-N`;
    - `verify (e2e throttled)`: `pnpm e2e --project=throttled --no-deps`, alone on its runner (15 min).
  - **Found on the way:**
    - Playwright never shards a project another depends on: a plain `--shard` ran all of chromium in every shard;
    - a test race in `tools/tv/src/cdp.test.ts` (step 39s6's). It is fixed, and two mutants are caught.
  - **The three memory notes are updated:** gh-pr-checks-watch-race, iptv-ci-media-ffmpeg-apt and bg-watcher-memory-reap. iptv-tools-test-gotchas got the race lesson.
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and step 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV;
  - 39s4, and 39s6's TV run (`[needs TV]`);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the `- [ ] 40.` block's "Refined before building": Omar's three answers (the legal draft, the test stream's link from the remote config, support at `lablo.iptv@gmail.com`);
   - the `- [ ] 40b.` line: the next step;
   - the `- [x] 40a.` block's "Refined while building", as a model, and 40a's page: `apps/tv/src/settings/connection-check.ts`, `ConnectionPage.tsx`;
   - the `- [x] 40ci.` block ("Built in leg 154", "Measured");
   - the last progress row (154).
2. **For 40b:**
   - the signed config doc: `packages/protocol/src/config.ts` and its tests; docs/runbooks/config.md;
   - the config worker (`packages/data/src/config.worker.ts`; about 10.8 KB left of 150);
   - how 40a's page gets its dependencies (`SettingsOptions.connection`, main's wiring in `apps/tv/src/main.tsx`);
   - the player's play path and `last-play.ts` (40a);
   - the e2e config stand-in `e2e/config-server.ts`, and `e2e/connection-check.spec.ts`.
3. **Memory notes:** iptv-ci-media-ffmpeg-apt (the new check names, caps, artifacts and flakes), gh-pr-checks-watch-race (the waits), iptv-zod-protocol-gotchas (zod/mini in the config schema, main.js cost per schema).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `0a590df` (40ci's notes, row 154), then `018b4fc` (PR #181's merge);
   - `origin/main` is `018b4fc`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` and no `lablo-chrome*` container.
2. **Step 40b, "Test stream"** (Omar's answer: the link comes from the signed remote config). Refine it first against the code, and write "Refined before building" points into RELAY.md. Then build:
   - a new optional field in the signed config doc, e.g. a test stream's URL (`packages/protocol/src/config.ts`). Check what an old TV does with an unknown field, and what the config worker's size gate allows;
   - a "Test stream" button on 40a's page, only when the config names a link;
   - the play goes through the app's own player (the same engine as channels);
   - a played result reads "This TV and Lablo play video: the problem is with the provider's streams"; a failure reads the player's code. The verdict (`connectionVerdict`) reads it;
   - the e2e config stand-in names the mock's stream; dev uses it too. Step 34 hosts the real test pattern (with a tone).
   - **Done when:** unit tests (the config field, the button's presence, the verdict's new rows); e2e in en-US, ar-SA and en-XA (button shown with the config's link, hidden without it, played and failed). `build:tv` within budgets. Mutation, with the list written first. The PR merged on green CI.
3. **Then 40c** (Help, with `lablo.iptv@gmail.com`) **and 40d** (the legal draft: `/terms` and `/privacy` in apps/web, and a release check that refuses the draft mark). **Their long text must not go in the main catalogs** (see Gotchas).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`018b4fc`) plus `0a590df` (row 154) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 40a's code (40ci changed no TV code);
  - `artifacts/`: leg 153's mutation logs and screenshots.
- **Leg 154's scratch** (`C:/Users/Omarm/.claude/jobs/aa027b40/tmp`; safe to ignore): CI job logs, `check-ci.mjs` (parses `ci.yml` and prints jobs, matrices and step conditions; it needs the worktree's `yaml@2.9.1`), `race.py`, `mut-cdp.py`, the PR body.

## Verified vs not
- **Verified in leg 154 (40ci):**
  - `ci.yml` parses, and the matrices and step conditions expand as intended;
  - `playwright test --list --project=chromium --shard=1/2` lists 115 tests, `2/2` lists 109, and no test is in both; the throttled project alone (`--no-deps`) lists 9 and passed locally (9 of 9, 2.7 min);
  - the cdp race: reproduced with fetch delayed 20 ms (the old tests fail, the new pass), two mutants caught, typecheck and lint clean;
  - PR #181's second run was green (12 m 46 s); its first run failed on the cdp race and the `epg-declared-300mb` flake;
  - the `workflow_dispatch` run `45595162742` was green after one rerun of `verify (e2e 1/2)` (the known `auto-next.spec.ts:151` ar-SA flake).
- **Not done:**
  - 40a on a real TV;
  - steps 40b–40d and 41–47;
  - 39s4, and 39s6's TV run;
  - production (step 34).
- **Migrations and deploys:** none. Nothing is deployed (this project has no deploy before step 34).

## Gotchas and lessons
**New in leg 154:**
- **CI now has 11 checks and takes about 13 minutes.** Wait with two foreground rounds of `timeout 575 bash -c 'until s=$(gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done; echo "$s"'`.
  - `gh run rerun <run> --failed` reruns only the failed matrix jobs: a flaky engine or e2e shard reruns alone.
  - A rerun job has a new id: wait on `gh api repos/Omarmarei/Lablo/actions/jobs/<id>`.
  - One job's log: `gh api repos/Omarmarei/Lablo/actions/runs/<run>/jobs --jq '.jobs[] | "\(.name)=\(.id)"'`, then `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`.
- **The new artifact names:**
  - `old-engines-report-<engine>`, `gallery-screenshots-1` and `-2`;
  - `playwright-report-1`, `-2` or `-throttled`, on failure only;
  - `tv-builds`, from shard 1.
- **Playwright never shards a project another depends on.** `throttled` depends on `chromium`, so CI shards `--project=chromium` and runs `--project=throttled --no-deps` on its own. A new project with `dependencies` needs the same care. Check a split with `playwright test --list --project=<p> --shard=N/2`.
- **A fake event scheduled before an async call races that call's I/O.** Start a fake's timers inside the injected factory, when the code under test asks for the object.
- **A local `verify:engines` run** is only for reproducing one engine's failure (`--engine <id>`). CI's per-engine jobs are the check of all three.
- **Flakes seen this leg:**
  - `epg-declared-300mb` (22.0 ms vs 20);
  - `auto-next.spec.ts:151` ar-SA (`endEpisode` sends `ended` while the next play is `opening`).
  - Both passed on rerun. Read the job log before rerunning.

**From leg 153 (still true):**
- **Catalog text lives in main.js:** every UI string of both languages ships in the main bundle. 40c's help and 40d's legal text must load with Settings (settings.js 106.6 of 150 KB) or a lazy file of their own.
- **Sizes after 40a (Tizen):** main.js 477.2 of 500 KB, settings.js 106.6, the ingest worker 139.9 of 150, the query worker 149.3 of 150 (0.7 KB left; keep its code changes tiny), the config worker 139.2 of 150.
- **VNode tests don't expand components:** a line drawn by a sub-component is invisible to `walk()`. Draw it with a plain function (`lineView`).
- **A new settings row moves pins:**
  - `SETTINGS_ITEMS` and `SETTINGS_SCREENS` in `guides-state.test.ts`;
  - the last window in `parental-view.test.ts`;
  - the `data-pending` sum in `unmatched-screen.test.ts`;
  - fakes without the new `Settings` field.
  - Pass a new page's dependencies through its own options, not the settings' engine.
- **A source's name with `dir="auto"` in a flex row needs a physical `text-align: left`.**
- **e2e can change the mock while the app runs:**
  - `app.mockState.scenario = parseScenario({ rules: [...] }, 'name')`;
  - an account's status through `app.mockState.fixture.accounts`;
  - `page.context().setOffline(true)`;
  - reset all of them in `afterEach`.
  - `trackErrors` counts the browser's 404 resource lines: filter them in a spec that faults streams.
- **One media spec:** `LABLO_E2E_MEDIA=1 pnpm exec playwright test e2e/player-media.spec.ts --project=playback-media -g "…"` (the file before `--project=`). A played stream's text carries bidi marks even in en-US: `stripIsolates`.
- **When a mutant shows code changes nothing,** drop the code rather than invent a test.
- **Escapes in memory files:** write them with `chr(92) + 'u…'` and check with `od -c`.
- **Never `cd` in a Bash call.**

**From legs 130–152 (still true):**
- **Node 22 differs from this PC's Node 24:** its `WebSocket` re-fires `error` from `close()` on a socket that never opened. Never close from an error handler.
- **Python patches:** use a Write-tool script with an EDITS list and `newline=''` (inline `python -c` with backslashes fails).
- **Derive test expectations step by step** (`containerName('ts')` is `MPEG-TS`).
- **The tools don't import each other;** a root `test/` file holds a shared rule together.
- **`packages/*` tests run only from the repo root's Vitest config:** `pnpm --dir "<wt>" exec vitest run packages/...`.
- **The `lablo` test account has 2 connections;** use `forever` (4) for more streams.
- **Check CI once about 25 s after `gh pr create`.** No `jq` in Git Bash (use `gh --jq`). A push to an open PR cancels its CI.
- **Chromium's quota** is checked only for a writing transaction.
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
- **None pending for step 40:** Omar answered all three questions in leg 153.
- **Leg 154's choices for 40ci** (Omar may overrule):
  - every engine's job runs its own seeds. A separate seeds job per engine would take the engines to about 8 min, but media (about 12) would then set the run's length;
  - each e2e shard builds the TV apps, rather than one build job passing `dist/` as an artifact;
  - two e2e shards, plus the throttled project on its own runner.
- **Omar's decision, when he wants (not blocking): MP4 subtitles on the Samsung.** AVPlay lists an MP4's `mov_text` tracks and sends no cue. Options: leave them; hide AVPlay's MP4 text rows; demux `mov_text` ourselves (architecture.md §2 "Step 39s5").
- **Leg 153's choices for 40a** (Omar may overrule):
  - six sources at most on the page;
  - no reference host (a check against Lablo's `/v1/health` can come with step 34);
  - the row sits before "Send a report to support".
- **Leg 152's choices for 39s6** (Omar may overrule):
  - the client name `LabloLabPC`;
  - the soak's 1.5 s stall rule and the hour's sample cap;
  - TLS accepts the TV's self-signed certificate on :8002 only;
  - LG's own remote keys (SSAP) come in a later part.
- **Later fixes to propose (no step yet):**
  - from leg 154: media's own split (its Docker probe, 2 min, and the benchmark, 1 min, could run beside `verify:media`) if media becomes the only long job; a fix for the `auto-next` `endEpisode` race (wait for `playing` before dispatching `ended`);
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
  - the test stream's file on Lablo's storage and its link in the production config (40b's answer);
  - the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **What remains:**
  - without Omar or a TV: 40b, 40c, 40d, 43 (accessibility), 44 (store documents), 45 (release engineering);
  - with Omar or a TV: 34, 16, 21, 39s4, 39s6's TV run, 41, 42, 46, 47.

## Checks for Omar
1. **40ci:** nothing to do. CI now reports 11 checks and takes about 13 minutes instead of 28. A flaky engine or e2e shard reruns alone.
2. **40a, Settings › "Check the connection":** the screenshots are in the worktree (gitignored): `artifacts/screenshots/connection-check-en.png`, `-ar.png` and `-en-XA.png`.
3. **39s6 has no screen.** Try `pnpm tv` at the Samsung next time (tv-setup.md §3.7): `pnpm tv setup <tv-ip>`, `pnpm tv keys` (accept "Allow" once), `pnpm tv inspect`, `pnpm tv screen`, `pnpm tv soak watch`.

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
  - look for the "Zoma" he saw;
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
  - **58 (new, leg 154):** CLAUDE.md's commands table says of `pnpm verify`: "CI job `verify` runs exactly this (after `playwright install --with-deps chromium`)". Since step 40ci the `verify` job runs it in five parallel parts:
    - lint and typecheck;
    - unit;
    - e2e of the chromium project in two shards, each after `build:tv`;
    - the throttled project alone.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
