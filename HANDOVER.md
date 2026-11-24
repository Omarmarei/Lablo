# Lablo IPTV: relay leg 150 opening prompt

You are leg 150 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–148 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21) and 39s1 (the storage quota, PR #175).
- **Leg 149 (2026-11-24): step 39s2 (the ladder's HLS stickiness) refined, built and merged: PR #176 as `694a298`.** CI: changes, verify 23 m, engines 27 m and web 3 m passed; media hit the known `epg-declared-300mb` timing flake (23.9 ms against 20), then passed on the rerun (11 m).
  - **No question for Omar.** The rule has one conventional answer; the cap's numbers are leg 149's choices (below).
  - **The rule** (`packages/player/src/controller.ts` `movesMemory`, called from `onFirstFrame`): a source remembers the container that showed a frame only when:
    - it is the request's own first container (`.ts`, or what `allowed_output_formats` leaves), so a source goes back to `.ts` as soon as a `.ts` plays; or
    - another URL of the session failed definitively (`isDefinitive`: `unsupported`, or HTTP 4xx other than 408 and 429).
    - A network error, a timeout, a stall, a 5xx, a decode error, or a switch rung that played after the `.ts` had played never moves the source.
  - **The fallback's cap** (`WatchdogConfig.fallbackMs`, the controller's `armOpenTimer`; the ladder's new `untriedLeft()` and `otherFailedForGood(current)`):
    - a live URL that hasn't shown a frame in the session, while another URL is untried, gets `fallbackMs` instead of the open timeout;
    - `DEFAULT_WATCHDOG.fallbackMs` is 6000 (Fast start), `STABLE.fallbackMs` 12_000 (`apps/tv/src/player/play-tuning.ts`), and the cap is never more than `openTimeoutMs`;
    - not capped: the last untried URL, a URL that played in the session, catch-up, VOD;
    - the timer fails with `{ kind: 'timeout', code: 'OPEN' }`, as the open timeout does.
  - **Docs:** RELAY's `- [x] 39s2.` (refined before building: 5 points; gates), row 149; architecture.md §2 "Built in step 39s2", plus pointers in §2's sketch and in "Built in step 17".
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV (S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, the "Zoma" he saw);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the 39s block: **39s3 is the next step** (stall injection that reaches the watchdog), then 39s5 and 39s6 (39s4 needs the TV);
   - the `- [x] 39s2.` and `- [x] 39s1.` lines as models for "Refined before building", the choices and "Gates";
   - the last progress row (149).
2. **docs/spikes/results.md:** "From the Samsung TV (2026-11-24)" (the lab's stall row miscalibrated for AVPlay; AVPlay hides held-socket stalls) and "The app on the Samsung TV" (stalls, and the soak: 186 reconnects, one visible 6.9 s stall that didn't trip the 6 s rule).
3. **For 39s3:**
   - `apps/mock-provider/src/lab-media.ts` (`LAB_STALL_TS_BYTES`, 600 KB; 4 MB worked on AVPlay) and the mock's stalling scenario (64 KiB chunks, `media.ts`), as RELAY's 39s3 names them;
   - `packages/player/src/controller.ts`: `tick` (the frozen and buffering rules), `onEvent`'s `buffering` and `playing` cases;
   - `packages/platform-tizen/src/avplay-engine.ts`: `listenerFor`.
   - architecture.md §2 "The watchdog".

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `7a027f5` (39s2 ticked, row 149), then `694a298` (the merge);
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` (needed only for the web-backed tests) and no `lablo-chrome*` container.
2. **Step 39s3: refine against the code first** (write "Refined before building" under 39s3).
   - **Leg 149's read-ahead on the 6.9 s case** (a lead, not proven on the TV): after the first frame, AVPlay's `onbufferingstart` makes the engine emit `buffering` (`listenerFor`). The controller then sits in `buffering`, where only `liveBufferingMs` applies (12 s; Stable 25 s) and the frozen rule (`liveFrozenMs` 6 s) doesn't run. A 6.9 s stall that AVPlay reported as buffering can't trip the 6 s rule: by design unless 39s3 decides otherwise. The soak monitor read AVPlay's state and position only, so whether AVPlay said buffering then is unknown.
   - The fault design (an outage window, or a stall that also holds the next K requests) and `LAB_STALL_TS_BYTES` from the media's bitrate are plain engineering. A question for Omar only if a choice has real trade-offs.
   - **Gates as 39s2:**
     - unit tests (the mock's and the lab's faults; a controller test if the 6.9 s case is a bug);
     - e2e if UI changes;
     - lint, typecheck;
     - `build:tv` and a module diff;
     - engines 68 locally (alone);
     - mutation with the list written first;
     - the PR, CI, the merge on green.
3. **Then** 39s5 (small fixes) and 39s6 (`pnpm tv` tools).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`694a298`) plus `7a027f5` (39s2's tick, row 149) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 39s2's final code;
  - in `artifacts/`:
    - `mutate39s2.py` and `mutate39s2.log`;
    - `build-tv-39s2.log`, `mprobe-39s2-after.log`, `engines-39s2-68.log`;
    - `e2e-39s2-player.log`, `unit-39s2.log`, `lint-39s2.log`, `typecheck-39s2.log`;
    - leg 148's 39s1 logs and the storage screenshots.

## Verified vs not
- **Verified in leg 149 (39s2):**
  - unit 8,902 (329 files) at the full run;
  - lint and typecheck clean;
  - mutation 22 of 22 at the first run;
  - `build:tv`: main.js 471.0 KB on Tizen (+0.4), settings.js 99.7 KB, the query worker 149.3 of 150 KB (both unchanged);
  - module diff: no module added or removed, core-js 173 / 2;
  - e2e `buffering`, `player`, `resume` 14 of 14;
  - engines 68: 13 of 13;
  - CI green after one media flake rerun.
- **Not done:**
  - **the TV's time to `.ts` after the cut:** expect about 6 s plus AVPlay's close and the `.ts` start. Measure at step 21 or with 39s6's tools.
  - **What made the TV's 15 s:** that build had an 8 s prepare timeout and a 10 s open timeout, so either AVPlay's `stop`/`close` blocked during its playlist retries, or a prepare answered on the 404. Unknown.
  - `verify:engines` on Chromium 53 locally (the PR's engines job passed 53, 56 and 68).
  - steps 39s3–39s6; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 149:**
- **The background CI wait was reaped** ("system is running low on memory", while the session was idle). Don't restart it. What worked:
  - check once in the foreground (`gh pr checks <n> --repo Omarmarei/Lablo`);
  - then foreground waits bounded by `timeout 570`: `until s=$(gh api repos/Omarmarei/Lablo/actions/jobs/<id> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done`, repeated until done.
- **After `gh run rerun <run> --failed`** the job has a new id: `gh run view <run> --repo Omarmarei/Lablo --json jobs --jq '.jobs[] | select(.name=="media") | (.databaseId|tostring) + " " + .status'`.
- **A python patch in a Bash heredoc lost an escaped quote:** `\\'` inside a single-quoted TS test title came out as a bare `'` and broke the string. Write test titles with apostrophes in double quotes, or patch through the Write tool, then fix with Edit.
- **`WatchdogConfig` has `fallbackMs` now:** a test that spreads `{ ...DEFAULT_WATCHDOG, openTimeoutMs: 20_000 }` inherits the 6 s cap. Set `fallbackMs` too when a test means a patient open.
- **Two-URL live tests that never frame moved:** the `.ts` fails at 6 s now. Loads at 0 (`.ts`), 6050 (`.m3u8`), 16_050, 26_050 (`.ts`), 37_000; give-up at 47 s.
- **Desktop e2e never meets the cap:** Chromium refuses the `.ts` at once (`unsupported`, definitive), so the `.m3u8` is the last untried URL and keeps the whole open timeout.
- **The module probe** (`tools/build/mprobe-<step>.ts`, temporary, deleted after): my `rel()` cut the root out of the `lablo-worker:D:/...` ids, so the seven worker lines differ in spelling from leg 148's log. Ignore those, or keep ids as they are.
- **Sizes:** main.js 471.0 of 500 KB on Tizen (29 KB left); settings.js 99.7 of 150; the query worker 149.3 of 150 (0.7 KB left: keep its code changes tiny).

**From leg 148 (still true):**
- **Chromium's quota rule:** it checks the quota only for a transaction that writes (usage plus that transaction's puts). A delete-only transaction always commits. A cleanup that deletes and puts in one transaction fails whole on a full store: split them (deletes first).
- **`fillStore`** (`packages/data/src/test-support.ts`) fakes a full store at each put: `(store, value, key) => boolean`. A shared `refused` array spans the engine test's workers (`test/tv-data-engine.test.ts`).
- **To prove an order inside IndexedDB:** start a `dumpStore` in the predicate at the retry; IndexedDB runs it after that transaction.
- **The query worker keeps the guides' match table in memory:** a missed reload shows in `epgStatus().matched`, not `.guides`.
- **e2e full store:** DevTools' `Storage.overrideQuotaForOrigin` does nothing in Playwright's browser contexts. Patch `IDBObjectStore.prototype` in the workers (`e2e/storage-full.spec.ts`).
- **A spec comparing words with the catalog it imports** checks nothing against a catalog change: pin the English sentence as a literal.
- **The module probe's output holds NUL bytes:** `grep -a`, `tr -d '\000'`, sort both lists, then `diff`.
- **A mutant that replaces `room.write(() => f(...))` with `(() => f(...))`** never calls the write: use `((g) => g())(() => f(...))`.
- **Never `cd` in a Bash call** (it moved the session's working directory); use absolute paths and `--dir`.

**From leg 147 (still true):**
- **Plain e2e never plays a channel:** the desktop refuses the `.ts` at once, and the mock's placeholder `.m3u8` never shows a frame, so the player reopens it at each open timeout. To measure the watchdog, watch the `<video>`'s `src` (`e2e/buffering.spec.ts` `reopenAfter`).
- **A longer open timeout needs a longer give-up window** (`windowFor`).
- **The mock's `slow-headers` fault sleeps on the mock's real clock.**
- **Web research:** ask for verbatim quotes and re-read long pages at an offset; spot-check decision-driving claims on the official page.
- **core-js count:** `grep "^M .*core-js" | grep -v commonjs` (173).

**From leg 146 (still true):**
- **A moved clock and a playing stream:** `page.clock.runFor` of more than about 6 s trips the watchdog; use `page.clock.fastForward`.
- **The player always has one timer while open** (the no-key count).
- **The player's `card` zone has two users** (status cards and "Still watching?").
- **Settings › "Player"** has eight rows in a window of seven (`SETTINGS_VISIBLE` in `settings/settings-window.ts`).
- **Arabic plurals:** 120 takes the `many` form, as 30, 60 and 90 do.
- **Mutation is fast here:** a single-file vitest mutant takes about 4 s, an e2e one about 15 s; write the list first.
- **Patch scripts with backslashes or quotes go through the Write tool**, never a Bash heredoc.

**From legs 130–145 (still true):**
- **`rm` on a shell variable is refused:** write a literal path. `sleep N; cmd` is blocked: wait with `read -t N < /dev/zero` under `timeout`.
- **CI:**
  - a run takes about 30 minutes; `verify` and `media` have 30-minute caps, engines 35;
  - known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb` (again in leg 149), `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes;
  - read the annotations (`gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`), then `gh run rerun <run> --failed` once the whole run is done;
  - no `jq` in Git Bash; a push to an open PR cancels its CI.
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes). `tv-bundle.spec.ts` runs in the `chromium` project.
- **Mutation and builds don't mix:** never run mutation beside a build, an e2e run, a probe or an agent reading the tree.
- **Settings rows in e2e go by id** (`e2e/settings-rows.ts`). **Onboard in the language you test.** **In Arabic the rail is on the right.** Use `--workers=2` for e2e on this PC.
- **The player's options already have `clock` and `now`**: grep an options interface before adding a field. **A key a screen takes but ignores** needs a `nav.handle(key) === 'screen'` test.
- **A local unit run of everything** can time out heavy tests at 30 s under load: rerun them alone before calling them failures.
- **Peer sessions** (Omar's Samsung session) may send his decisions: act on what Omar decided; ask him directly before ticks a handover reserved for his word.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`; no fields named like built-ins.
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
- **Leg 149's choices for 39s2** (Omar may overrule; each is a number or a line to change):
  - the fallback's cap: 6 s under Fast start, 12 s under Stable (above the slowest first frame the TV showed on a working URL, HLS 4.3 s at the launch);
  - catch-up keeps the whole open timeout (an archive can be slow to start on the panel);
  - the known cost: a source whose `.ts` fails at every play without a definitive error pays the cap at each zap (hysteresis in the profile was not chosen).
- **Leg 148's choices for 39s1 stand** (a guide's refresh makes room from its own programmes only; the line's words; the storage state lasts for the run).
- **Leg 147's, 146's and 145's choices stand.**
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16's rest and 21 wait for Omar and the TVs** (his "3a").
- **What remains after 39s:** 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering); with Omar or a TV: 34, 16, 21, 39s4, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - new in leg 149: a fresh redirect probe on Tizen for a remembered container other than the request's first (it would see a 404 in about 0.2 s, where AVPlay retries silently); the cut's time measured on the Samsung;
  - from leg 148: the live line in the old-engine walk; seed the storage state at start from stored guide failures (`storage` codes); a remove-a-source action (the line can only point at guides today); measure on the Samsung whether deleting frees usage at once;
  - from leg 147: a per-model tunables block in the config doc (only if step 21 shows a need); whether AVPlay's `prepareAsync` waits for the first buffer; the "Buffering" row in the old-engine walk;
  - from leg 146: the audio and subtitle keys over an end card (`menuRoom`); the prompt in the old-engine walk;
  - older: the restored-source login gap; renaming a source; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `auto-next`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the engines job's 35-minute cap; forwarding workers' unhandled rejections; `epgOverrides` after a re-match; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (0.7 KB left); the start's resume before the worker's load; a VNode test of the pad; the local e2e worker count under load; stored guides keeping their titles' language after a language switch.

## Checks for Omar
1. **The storage line (from leg 148):** `artifacts/screenshots/storage-full-en.png`, `-ar.png`, `-en-XA.png` (in the worktree, gitignored). Nothing to decide unless he wants other words.
2. **39s2 has no screen:** nothing to look at. He may overrule the cap's numbers (6 s and 12 s).

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
  - **new (39s2):** after a network outage, the next zap and the next launch start on `.ts` again; with the `.m3u8` answering 404 and `.m3u8` remembered, how long until `.ts` plays (expect about 6 s plus AVPlay's close).
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
