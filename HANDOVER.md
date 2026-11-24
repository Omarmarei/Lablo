# Lablo IPTV: relay leg 149 opening prompt

You are leg 149 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–147 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21).
- **Leg 148 (2026-11-24): step 39s1 (the storage quota) refined, asked, built and merged: PR #175 as `ac2781e`**, green at CI's first run.
  - **Omar answered "1 1":** the guides' programmes go first to make room; a line on the live screen plus the reason in Settings.
  - **`packages/data/src/storage-room.ts`** (new): `isQuotaError`, `dropGuides` (three `clear()`s), `Room` (a write that fails for space makes room once and is tried again).
    - A catalog refresh (`ingest.ts`): every write goes through a `Room` that deletes all stored guides; a second failure is `IngestError('storage')`; the active generation still serves. The ingest worker emits `room`, and the engine reloads the query worker.
    - A guide's refresh (`epg-ingest.ts`): its room is only its own active generation. When it then fails, the guide is deleted whole and its failure kept on a new record. An unchanged guide (a 304) never makes room from its own programmes.
    - Abandon and prune (catalog and guides): deletes first, then the `building` mark, best effort (`unmark`, `unmarkEpg`).
    - `loadProfile`: on a failed upgrade write, gives the upgraded document from memory.
    - The ingest worker has a `dropGuides` handler (a profile save's room).
  - **The app:** `apps/tv/src/data/storage-state.ts` (new, main.js): `createStorageState`, `isStorageError`.
    - `DataEngine` (`storage` option): `editProfile` retries after `dropGuides` in an ingest worker, then reloads the query worker. Refreshes and guide outcomes report which writes failed for space and which went through.
    - The live screen's line under the header (`live.storageFull`, `LIVE.storageLine` = 36 px of the body's spare room).
    - Settings › "Sources": `SourceRow.storage` (`sources.storage`, `sources.storageSince`).
    - Guides: `guides.failure.storage`. The loader: `LoadErrorCode` `storage` (`error.storage`; `QuotaExceededError` maps to it; no playlist try after it).
  - **Tizen:** `platforms/tizen/config.xml` requests `http://tizen.org/privilege/unlimitedstorage`, and the build refuses a manifest without it. The lab's manifest inherits it.
  - **Docs:** RELAY's `- [x] 39s1.` (refined before building: 6 points; Omar's answer; refined while building: 7; gates), row 148; architecture.md §1.3 "Built in step 39s1".
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV (S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, the "Zoma" he saw);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the 39s block: **39s2 is the next step** (the ladder's HLS stickiness), then 39s3, 39s5, 39s6 (39s4 needs the TV);
   - the `- [x] 39s1.` line as the model for "Refined before building", Omar's answer, "Refined while building" and "Gates";
   - the last progress row (148).
2. **docs/spikes/results.md**, "From the Samsung TV (2026-11-24)" and "The app on the Samsung TV": the ladder's HLS stickiness on channel 104, and the fallback to TS taking 15 s and 27–28 playlist requests.
3. **For 39s2:**
   - `packages/player/src/request.ts` (`orderCandidates`, `SourceMemory`), `ladder.ts`, `controller.ts` (`memory.remember` after a frame);
   - `apps/tv/src/player/player-memory.ts` (the profile's `player.containers`);
   - architecture.md §2 "The URL strategy".

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `66b21d8` (39s1 ticked), then `ac2781e` (the merge);
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` (needed only for the web-backed tests) and no `lablo-chrome*` container.
2. **Step 39s2, the ladder's HLS stickiness: refine against the code first** (write "Refined before building" under 39s2).
   - Its "Done when" asks to decide whether one outage may change a source's remembered container, and to cap the fallback's time. It is a question for Omar if the choice has trade-offs.
   - If it has one conventional answer (e.g. only a definite failure moves the source, an outage doesn't, and the fallback is capped at a time), write it down and build.
   - If there is a real trade-off, end the leg as **needs-you** with a numbered question, recommended option first.
   - Gates as 39s1: unit tests (the controller's and the ladder's: an outage that doesn't move the source, a definite failure that does, the cap with a fake clock); e2e if UI changes; lint, typecheck; `build:tv` and a module diff; engines 68 locally (alone); mutation with the list written first; the PR, CI, the merge on green.
3. **Then** 39s3 (stall injection that reaches the watchdog), 39s5 (small fixes), 39s6 (`pnpm tv` tools).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`ac2781e`) plus `66b21d8` (39s1's tick, row 148) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 39s1's final code;
  - in `artifacts/`: `mutate39s1.py` with `mutate39s1-clean.log`, `-a`, `-b`, `-b2`, `-c` logs; `build-tv-39s1.log`; `mprobe-39s1-after.log`; `engines-39s1-68.log`; `e2e-39s1-*.log`; `unit-39s1.log`; the lint and typecheck logs;
  - screenshots `storage-full-en.png`, `-ar.png`, `-en-XA.png`, and `storage-full-sources-*.png`.

## Verified vs not
- **Verified in leg 148 (39s1):**
  - unit 8,886 (329 files) at the full run, plus the cases added for mutation;
  - e2e: `storage-full.spec.ts` 3 of 3 (en, ar, en-XA), 32 related (live, onboarding, guides, refresh, m3u-upgrade, language, favourites, storage-full), `tv-bundle` 10;
  - lint and typecheck clean;
  - mutation 85 of 86: 8 survivors closed by tests, 1 equivalent with today's words (`white-space: nowrap`: all three languages fit one line);
  - `build:tv`: main.js 470.6 KB on Tizen (+2.9), settings.js 99.7 KB (+0.3), the query worker 149.3 of 150 KB (+0.3);
  - module diff: `data/storage-state.ts` added to main.js, nothing else; core-js 173 / 2 unchanged;
  - engines 68: 13 of 13;
  - CI green at the first run (verify 22 m, engines 27 m, media 12 m, web 3 m);
  - the screenshots were looked at.
- **Samsung's docs were checked:** the W3C/HTML5 API reference lists `unlimitedstorage` (public level) on the Indexed Database row. Whether Samsung's Chromium honours it is unknown: the 2015 Chromium-EFL code answers the IndexedDB quota callback with "Not Supported by chromium".
- **Not done:**
  - a real TV for 39s1: whether the privilege raises `storage.estimate()` (the lab's S2 at the next Samsung session), and whether deleting the guides frees usage at once on Tizen's LevelDB (if not, the retry fails and the next try 2 h later finds the room);
  - `verify:engines` on Chromium 53 locally (the PR's engines job passed 53, 56 and 68);
  - the live line is not in the old-engine walk;
  - steps 39s2–39s6; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 148:**
- **Chromium's quota rule:** it checks the quota only for a transaction that writes (usage plus that transaction's puts). A delete-only transaction always commits. A cleanup that deletes and puts in one transaction fails whole on a full store: split them (deletes first).
- **`fillStore`** (`packages/data/src/test-support.ts`) fakes a full store at each put: `(store, value, key) => boolean`; `full.refused.length === 0` refuses only the first write. A shared `refused` array spans the engine test's workers (`test/tv-data-engine.test.ts`: `fullness`, `refused`, `drops`, `storageEvents`).
- **To prove an order inside IndexedDB** (room made before a retried write): start a `dumpStore` in the predicate at the retry; IndexedDB runs it after that transaction.
- **The query worker keeps the guides' match table in memory:** a missed reload shows in `epgStatus().matched`, not `.guides` (read from the store).
- **e2e full store:** DevTools' `Storage.overrideQuotaForOrigin` does nothing in Playwright's browser contexts. Instead, patch `IDBObjectStore.prototype` in the workers and hold the mock's `player_api.php` answers 1.5 s with a Fastify `onRequest` hook (`e2e/storage-full.spec.ts`).
- **A spec comparing words with the catalog it imports** checks nothing against a catalog change: pin the English sentence as a literal.
- **The module probe:** when main is unchanged since the last leg's "after" log, diff against it (no source swap). The output holds NUL bytes: `grep -a`, `tr -d '\000'`, sort both lists, then `diff`; `?commonjs` ids differ only in path spelling. An unsorted diff dumped 400 lines.
- **A mutant that replaces `room.write(() => f(...))` with `(() => f(...))`** never calls the write: replace it with `((g) => g())(() => f(...))` to call it without the room.
- **`cd` in a Bash call moved the session's working directory** (twice this leg). Never `cd`; use absolute paths and `--dir`.
- **Sizes:** main.js 470.6 of 500 KB on Tizen (29 KB left); settings.js 99.7 of 150; the query worker 149.3 of 150 (0.7 KB left: keep its code changes tiny, put new work in short-lived workers or main).

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
- **`rm` on a shell variable is refused:** write a literal path. `sleep N; cmd` is blocked. Wait with one background `until` loop (`until [ "$(gh pr checks <n> --repo Omarmarei/Lablo --json bucket --jq '[.[] | select(.bucket=="pending")] | length')" = "0" ]; do timeout 60 bash -c 'read -t 55 < /dev/zero'; done`, after about 30 s).
- **CI:** a run takes about 30 minutes; `verify` and `media` have 30-minute caps, engines 35. Known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes. Read the annotations, then `gh run rerun <run> --failed` once the whole run is done. No `jq` in Git Bash. A push to an open PR cancels its CI.
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes). `tv-bundle.spec.ts` runs in the `chromium` project (there is no `tv-bundle` project).
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
- **Leg 148's choices while building 39s1** (Omar may overrule; each is small to change):
  - a guide's refresh makes room from its own programmes only (deleting the other guides would let two guides take turns deleting each other);
  - the line's words: "Lablo's storage is full, so updates can't be saved. Remove a TV guide you don't use in Settings to make room." (Arabic in the catalog);
  - the storage state lasts for the run (a restart starts clean; the next try finds it again).
- **Leg 147's choices stand** (Fast start's 5 s AVPlay buffer; Stable's numbers; tunables set Fast start's numbers; the "Buffering" row's words).
- **Leg 146's and 145's choices stand.**
- **39s2 may need Omar's answer** (whether one outage may move a source's remembered container; the fallback's cap).
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16's rest and 21 wait for Omar and the TVs** (his "3a").
- **What remains after 39s:** 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering); with Omar or a TV: 34, 16, 21, 39s4, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - new in leg 148: the live line in the old-engine walk; seed the storage state at start from stored guide failures (`storage` codes); a remove-a-source action (the line can only point at guides today); measure on the Samsung whether deleting frees usage at once;
  - from leg 147: a per-model tunables block in the config doc (only if step 21 shows a need); whether AVPlay's `prepareAsync` waits for the first buffer; the "Buffering" row in the old-engine walk;
  - from leg 146: the audio and subtitle keys over an end card (`menuRoom`); the prompt in the old-engine walk;
  - older: the restored-source login gap; renaming a source; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `auto-next`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the engines job's 35-minute cap; forwarding workers' unhandled rejections; `epgOverrides` after a re-match; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (0.7 KB left); the start's resume before the worker's load; a VNode test of the pad; the local e2e worker count under load; stored guides keeping their titles' language after a language switch.

## Checks for Omar
1. **The storage line:** `artifacts/screenshots/storage-full-en.png`, `-ar.png`, `-en-XA.png` (in the worktree, gitignored). Nothing to decide unless he wants other words.

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
  - **new: the lab's S2 again** (the lab now carries `unlimitedstorage`): does `storage.estimate()` still say 88 MB?
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
