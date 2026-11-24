# Lablo IPTV: relay leg 148 opening prompt

You are leg 148 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–146 did steps 1–33, 35–38 (all sub-steps) and 39a–39c.
- **Leg 147 (2026-11-24): step 39d built and merged, PR #174 as `2868c35`.** Step 39 is ticked (39a–39d all merged; the real-TV proof waits for step 21).
  - **"Buffering"**, Settings › "Player"'s eighth row: "Fast start" (default) or "Stable". Kept in `player.options` as `buffer: 'stable'` (nothing kept for Fast start).
  - **`apps/tv/src/player/play-tuning.ts`** (new, main.js): `playTuning(mode, tunables)` and `windowFor(openTimeoutMs)`.
    - Fast start: today's watchdog; AVPlay plays after 5 s of media (its own default is 10 s).
    - Stable: live frozen 12 s, live buffering 25 s, VOD buffering 40 s, open 20 s; AVPlay 10 s before playing and 15 s after a stall.
    - Remote config's tunables (`openTimeoutMs`, `stallTimeoutMs`, `liveBufferSeconds`, `vodBufferSeconds`) set Fast start's numbers; Stable keeps its own, or Fast start's where those are larger. The tunables apply to every TV (the config doc has no per-model match).
    - The give-up window grows with the open timeout (Stable 92 s; Fast start stays 60 s). Without that, a 20 s open timeout never gave up on a stream that never opens.
  - **`packages/player`:** `ControllerOptions.tuning` (replaces the unused `config`) is asked at each `play()` and kept for the session; `LoadOptions.buffer` (`EngineBuffer`); `PlayTuning` and `DEFAULT_TUNING` in `ladder.ts`.
  - **`packages/platform-tizen`:** `AvplayEngine` calls `setBufferingParam` (FOR_PLAY, FOR_RESUME, in seconds, at least 4, whole) between `setDisplayMethod` and `prepareAsync`. The fake AVPlay checks Samsung's rules and keeps what it took (`buffers`).
  - **The Player page scrolls**, seven rows in view. `SETTINGS_VISIBLE` moved to `apps/tv/src/settings/settings-window.ts` (re-exported by `settings-state.ts`).
  - **Docs:** RELAY's `- [x] 39d.` (refined before building: 7 points; while building: 4; gates), row 147; architecture.md §1.4 item 10 "Built in step 39d", §2's watchdog and zapping lines.
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV (S4 `suspend`, S10 by hand, S11 lifecycle and reading by ear, the "Zoma" he saw);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the 39s block (after `- [x] 39d.`): **39s1 is the next step**, then 39s2;
   - the `- [x] 39d.` and `- [x] 39c.` lines as the model for "Refined before building" and "Gates";
   - the last progress row (147).
2. **docs/spikes/results.md** "From the Samsung TV (2026-11-24)" and "The app on the Samsung TV" (S2's 88 MB quota; the ladder's HLS stickiness).
3. **For 39s1 (the storage quota):**
   - `apps/tv/src/lab/storage.ts` (the only `QuotaExceededError` handling today);
   - `packages/data`: the database and its transactions (`db.ts` or similar), the ingest's commit and generations (`ingest*.ts`), the EPG's day writes, `profile.ts` (`updateProfile`), the telemetry queue, the backup's state;
   - architecture.md §1.3 (storage design) and §1.4/§1.5 (the generation swap; the guide's days);
   - the test fakes: fake-indexeddb per-test factories (memory "IPTV data-layer test gotchas").
4. **For 39s2 (HLS stickiness):** `packages/player/src/request.ts` (`orderCandidates`, `SourceMemory`), `ladder.ts`, `controller.ts` (`memory.remember` after a frame); architecture.md §2 "The URL strategy".

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `851282b`, `744a296`, `2868c35`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` (needed only for the web-backed tests) and no `lablo-chrome*` container.
2. **Step 39s1, the storage quota: refine against the code first** (write "Refined before building" under 39s1).
   - Its "Done when" asks for the shape of the user-facing message and what it offers to be decided first, and says to ask Omar if it has trade-offs. Read every IndexedDB write path, list what each does today on `QuotaExceededError`, then decide:
     - if the shape has one conventional answer (keep the last good catalog, a line on the live screen or in Settings with what to do), write it down and build;
     - if there is a real trade-off (e.g. what to drop to make room: older guide days, other sources' generations, the telemetry queue), end the leg as **needs-you** with a numbered question, recommended option first.
   - Gates as 39d: unit and `test/` cases with a fake IndexedDB throwing `QuotaExceededError` at each write path; e2e in en and ar (en-XA too if UI text changes); lint, typecheck; `build:tv` and a module diff; engines 68 locally (alone); mutation with the list written first; the PR, CI, the merge on green.
3. **Then 39s2** (the ladder's HLS stickiness; may need a question for Omar), then 39s3, 39s5, 39s6 (39s4 needs the TV).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`2868c35`) plus `744a296` (39d's tick, row 147), `851282b` (step 39 ticked) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 39d's final production code;
  - in `artifacts/`: `mutate39d.py` with `mutate39d-clean.log` and `-a`…`-c` logs; `build-tv-39d.log`; `mprobe-39d-before.log` and `-after.log`; `engines-39d-68.log`; `e2e-39d-*.log` (the probe's too); `unit-39d.log`; the lint and typecheck logs;
  - screenshots `settings-player-buffer-en.png`, `-ar.png`, `-en-XA.png`.

## Verified vs not
- **Verified in leg 147 (39d):**
  - unit 8,820 (326 files);
  - e2e: `buffering.spec.ts` 3 of 3 (en, ar, en-XA), 25 related (clock-guide-key, parental-settings, player-settings, still-watching, player, language), `tv-bundle` 10;
  - lint and typecheck clean;
  - mutation 81 of 81, no survivor;
  - `build:tv`: main.js 467.7 KB on Tizen (+2.7), settings.js 99.4 KB (+0.5), query worker 149.0 of 150 (unchanged);
  - module diff: `play-tuning.ts` added to main.js, `settings-window.ts` to settings.js; core-js 173 / 2 unchanged;
  - engines 68: 13 of 13;
  - CI green at the first run (verify 22 m, engines 27 m, media 12 m, web 3 m);
  - the screenshots were looked at (en, ar, en-XA: the window scrolled one row, the eighth row in the safe area).
- **Samsung's AVPlay reference was read** (verbatim quotes in architecture.md "Built in step 39d"): `setBufferingParam` is IDLE only, "at least 4 seconds"; the default is "32MB or 10 seconds of playable data".
- **Not done:**
  - a real TV for anything in step 39 (AVPlay's buffers on a real provider; whether `prepareAsync` includes the first buffer: if it does, Stable's 10 s on a provider that sends at real time could meet the engine's 8 s prepare timeout);
  - `verify:engines` on Chromium 53 locally (the PR's engines job passed 53, 56 and 68);
  - the new row is not in the old-engine walk;
  - steps 39s1–39s6; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 147:**
- **Plain e2e never plays a channel:** the desktop refuses the `.ts` at once, and the mock's placeholder `.m3u8` opens without ever showing a frame. The player then reopens it at each open timeout (about 0, 10, 21, 33 s, then the error card at about 43 s). To measure the watchdog in e2e, watch the `<video>`'s `src` with a MutationObserver (`e2e/buffering.spec.ts` `reopenAfter`); `.m3u8` request counts mix reopens with the native player's 6 s playlist refreshes.
- **A longer open timeout needs a longer give-up window** (`windowFor`): four attempts must fit in it, or the player retries for ever.
- **The mock's `slow-headers` fault sleeps on the mock's real clock**, not the page's.
- **Web research:** the web-fetch agent's summary of a long page said passages were "not found" that its verbatim read contained. Ask for verbatim quotes and re-read at an offset.
- **The module probe's core-js count:** count `grep "^M .*core-js" | grep -v commonjs` (173); a filter on `core-js/modules/` finds only 20.
- **The swap for the "before" probe** went through a small script that copies the changed and new files aside, writes `git show origin/main:<f>` over them, removes new files, then restores. Write it with the Write tool.
- **Sizes:** main.js 467.7 of 500 KB on Tizen (32 KB left); settings.js 99.4 of 150; the query worker 149.0 of 150 (1.0 KB left: new player settings go through `player.options`, no new `PlayerChange` case).

**From leg 146 (still true):**
- **A moved clock and a playing stream:** `page.clock.runFor` of more than about 6 s trips the watchdog; use `page.clock.fastForward`. Countdowns read a deadline off the clock.
- **The player always has one timer while open** (the no-key count). Unit tests that pin `clock.pending()` count it.
- **The player's `card` zone has two users** (status cards and the "Still watching?" prompt): a new card calls `guard.covered()`; the prompt's branch is first in the player's `onIntent`.
- **Settings › "Player":** `playerRowText` takes the i18n; `PlayerValues` has `still` and `buffer`; the options need `setStill`, `sleep`, `setSleep`, `setBuffer` (fakes in `guides-state.test.ts` and the two player-settings tests). The settings list's "Player" line is pinned in `parental-view.test.ts` in en and ar.
- **Arabic plurals:** 120 takes the `many` form, as 30, 60 and 90 do.
- **Mutation is fast here:** a single-file vitest mutant takes about 4 s; write the list first and remove unreachable code before the run.
- **Patch scripts with backslashes or quotes go through the Write tool**, never a Bash heredoc.

**From leg 145 (still true):**
- **The player's options already have `clock`** (its wall clock for timers) and `now`: grep an options interface before adding a field.
- **The player can't see the navigator's stack:** it reads `nav.top.id` when it opens (`under`).
- **A key a screen takes but ignores** is a mutation survivor unless a test checks `nav.handle(key) === 'screen'`.
- **The module probe:** a temporary `tools/build/mprobe-<step>.ts` calling `bundleIife({ input: apps/tv/src/main.tsx, platform: 'tizen', split: true })`, printing `bundle.modules` (M) and `bundle.lazy[].modules` (S). Run it on the change, swap in `origin/main`'s sources, run again, restore, `diff -a`, delete the probe.
- **A local unit run of everything** can time out heavy tests at 30 s under load. Rerun them alone before calling them failures.
- **An old-engine harness test pins source lines** (`test/engines-onboarding.test.ts`).
- **Peer sessions** (Omar's Samsung session) may send messages with his decisions. Act on what Omar decided. Ask him directly before ticks a handover reserved for his word.

**From legs 130–144 (still true):**
- **`rm` on a shell variable is refused:** write a literal path. `sleep N; cmd` in one Bash call is blocked: wait with one background `until` loop (leg 147's: `until [ "$(gh pr checks <n> --repo Omarmarei/Lablo --json bucket --jq '[.[] | select(.bucket=="pending")] | length')" = "0" ]; do timeout 60 bash -c 'read -t 55 < /dev/zero'; done`).
- **CI:** a run takes about 30 minutes; `verify` and `media` have 30-minute caps, engines 35. Known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes. Read the annotations, then `gh run rerun <run> --failed` once the whole run is done. No `jq` in Git Bash (use `gh --jq`). A push to an open PR cancels its CI.
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes).
- **Mutation and builds don't mix:** mutation rewrites source files. Never run it beside a build, an e2e run, a probe swap or an agent reading the tree.
- **Settings rows in e2e go by id** (`e2e/settings-rows.ts`). **Onboard in the language you test.** **In Arabic the rail is on the right.** Use `--workers=2` for e2e on this PC.
- **VNode tests don't render sub-components:** give a card a hook-free view to test its words.
- **Never `cd` in a Bash call.** Use absolute paths and `git -C`.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`; no fields named like built-ins (`at`, `includes`…).
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.** Helpers main needs live outside `settings/`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Run heavy checks one at a time; `build:tv` in the background (about 8 minutes).

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens (39s6).
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Omar said on 2026-11-23: carry on with new changes without asking.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Leg 147's choices** (Omar may overrule; each is small to change):
  - Fast start (the default for everyone) sets AVPlay's first buffer to 5 s, half its own 10 s (Samsung's example value);
  - Stable's numbers: live frozen 12 s, live buffering 25 s, VOD buffering 40 s, open 20 s; AVPlay 10 s and 15 s;
  - remote config's tunables set Fast start's numbers; Stable is never less patient;
  - the row's words: "Buffering"; "Fast start": "Playback starts sooner, and a stalled stream reconnects quickly"; "Stable": "For slow providers: waits longer before it reconnects, and may start later".
- **Leg 146's choices stand** ("Still watching?" on at 4 hours by default; every key counts; Back keeps watching on the prompt; the sleep timer for the run only).
- **Leg 145's choices stand** (the clock Off by default; the Guide key closes the stream first; the colour keys' places).
- **39s1 and 39s2 may each need Omar's answer** (the quota's message and what to drop; whether one outage may move a source's remembered container).
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16's rest and 21 wait for Omar and the TVs** (his "3a").
- **What remains after 39s:** 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering); with Omar or a TV: 34, 16, 21, 39s4, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - new in leg 147: a per-model tunables block in the config doc (only if step 21 shows a need); whether AVPlay's `prepareAsync` waits for the first buffer (then the engine's 8 s prepare timeout should follow the buffer); the "Buffering" row in the old-engine walk;
  - from leg 146: whether the audio and subtitle keys open the track menu over a catch-up's or a movie's end card (`menuRoom` checks `failed` and the refusal, not `ended`); the prompt and its rows in the old-engine walk;
  - older: the restored-source login gap; renaming a source, and removing one; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `auto-next`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the engines job's 35-minute cap; forwarding workers' unhandled rejections; `epgOverrides` after a re-match; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (1.0 KB left); the start's resume before the worker's load; a VNode test of the pad; the local e2e worker count under load; stored guides keeping their titles' language after a language switch until their next read.

## Checks for Omar
1. **The "Buffering" row:** `artifacts/screenshots/settings-player-buffer-en.png` and `settings-player-buffer-ar.png` (in the worktree, gitignored). Nothing to decide unless he wants other words, or Stable as the default.

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
- **At the Samsung TV next time** (his "3a"): S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, with the TV's own remote; look for the "Zoma" he saw; the sleep timer's prompt as on the LG; a channel's start under "Fast start" and under "Stable" (AVPlay's buffers).
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
