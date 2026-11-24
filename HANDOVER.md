# Lablo IPTV: relay leg 147 opening prompt

You are leg 147 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–145 did steps 1–33, 35–38 (all sub-steps), 39a and 39b.
- **Leg 146 (2026-11-24): step 39c built and merged, PR #173 as `8880cf5`.** "Still watching?" and the sleep timer (Omar's Q2, option 1).
  - **`apps/tv/src/player/watch-guard.ts`** (new, owned by the player):
    - the no-key count: 2, 4 or 6 hours (4 by default, or never) after the last key the remote sent, while the player is open;
    - the sleep timer: 30 to 120 minutes on the wall clock, for the app's run only;
    - the prompt both end in: 60 seconds, read off the clock at each step; at zero the player closes as Back does.
  - **The prompt** is a card on the player's `card` zone (`StillCard` in `PlayerScreen.tsx`): "Keep watching" (focused) and the cards' way out.
    - Keys: OK presses the focused button; LEFT and RIGHT move between the two; STOP closes the player; any other key, Back included, keeps watching.
    - A card wins: the prompt waits under the error, end or refusal card and shows once it goes (so auto-next still gets asked).
    - The app hiding takes it away and stops the counts.
  - **Settings › "Player"** has rows six and seven: "Still watching?" (kept in `player.options` as `stillWatching`: `off`, `2`, `6`; nothing kept for 4) and "Sleep timer" (the player's own signal; its line says when playback stops).
  - **Every remote key** now also calls `player.activity()` (`LiveApp.tsx`, beside `live.activity()`).
  - **Docs:** RELAY's `- [x] 39c.` line (its 8-point refinement, gates, 4 points refined while building), row 146; architecture.md §1.4 item 10 "Built in step 39c".
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV (S4 `suspend`, S10 by hand, S11 lifecycle and reading by ear, the "Zoma" he saw);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - step 39: its "Facts found in leg 145", "Shape" (the decided Q1–Q3), "Split";
   - the `- [x] 39c.` line with its refinements and gates (the model for 39d);
   - **`- [ ] 39d.` with its "Before its row" note: the next step**;
   - the 39s block;
   - the last progress row (146).
2. **docs/PLAN.md** §5.4 (~239): the buffer setting.
3. **docs/architecture.md** §1.4 item 10 "Built in step 39a" to "Built in step 39c"; §2 (the player: the controller, the watchdog, the ladder).
4. **docs/spikes/results.md** "The app on the Samsung TV" and "From the Samsung TV (2026-11-24)", before 39d and 39s.
5. **For 39d:**
   - `packages/protocol/src/config.ts` ~48: the `tunables` nothing reads (`liveBufferSeconds`, `vodBufferSeconds`, `openTimeoutMs`, `stallTimeoutMs`);
   - `packages/player/src/ladder.ts` ~46 (`DEFAULT_WATCHDOG`) and `controller.ts` ~1016 (where the limits are read);
   - `apps/tv/src/player/app-player.ts` (it passes no `config`);
   - `packages/platform-tizen/src/avplay-engine.ts` `open()` (`setBufferingParam` goes between `setListener` and `prepareAsync`);
   - `apps/tv/src/settings/player-settings.ts` and `PlayerSettingsPage.tsx` (39c's rows as the model), `settings-state.ts` (`SETTINGS_VISIBLE`, the windowed list);
   - `apps/tv/src/player/player-memory.ts` (`stillHours` / `setStillHours`: the `player.options` pattern).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `d768c43` and `8880cf5`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` (needed only for the web-backed tests) and no `lablo-chrome*` container. Docker itself is needed for `verify:engines`.
2. **Step 39d, "Fast start / Stable": refine against the code first** (write "Refined before building" under 39d, as 39c did). Then build it with the usual gates:
   - unit tests (the controller's `config` from the setting and the tunables; AVPlay's `setBufferingParam` on the fake AVPlay);
   - e2e in en, ar and en-XA (the row, the profile, a restart);
   - every touched spec green; lint, typecheck;
   - `build:tv` and a module diff; engines 68 locally (alone);
   - mutation with the list written first;
   - the PR, CI, and the merge on green.
   - To settle at refinement (pick the conventional one, write why; ask Omar only for a real trade-off):
     - "Stable"'s watchdog values (the shape's first guess: live buffering 12 → 25 s, live frozen 6 → 12 s, VOD buffering 20 → 40 s);
     - AVPlay's buffer values: read Samsung's `setBufferingParam` documentation first, don't write them from memory;
     - how remote config's tunables override the setting;
     - the row's words.
   - **The Player page needs a windowed list for its eighth row** (seven fill the screen: the last ends at 1020 of 1026 px). Follow the main settings list (`visible`), and scroll in the e2e before its safe-area check.
   - Real proof on a TV waits for step 21.
3. **Then the 39s steps**, starting with 39s1 (the storage quota) and 39s2 (HLS stickiness; may need a question for Omar).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`8880cf5`) plus `d768c43` (RELAY's tick) and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 39c's final code;
  - in `artifacts/`: `mutate39c.py` with its `-a`…`-c` logs; `build-tv-39c.log` and `build-tv-39c-final.log`; `mprobe-39c-before.log` and `-after.log`; `engines-39c-68.log`; `e2e-39c-*.log`; `unit-39c.log`; the lint and typecheck logs;
  - screenshots `player-still-*.png`, `settings-player-still-*.png`, `settings-player-sleep-*.png` (en, ar, en-XA).

## Verified vs not
- **Verified in leg 146 (39c):**
  - unit 8,775 at the full run, plus the cases added after it;
  - e2e: `still-watching.spec.ts` 3 of 3 (en, ar, en-XA), 51 related, `tv-bundle` 10;
  - lint and typecheck clean;
  - mutation 153 of 153 (two survivors closed by tests);
  - `build:tv`: main.js 465.0 KB on Tizen (+5.4), settings.js 98.9 KB, query worker 149.0 of 150 KB;
  - module diff: only `watch-guard.ts` added to main.js; core-js 173 / 2 unchanged;
  - engines 68: 13 of 13;
  - CI green at the first run (verify 21 m, engines 31 m, media 14 m, web 3 m);
  - the screenshots were looked at: the prompt in en, ar and en-XA; the seven-row page in en and ar.
- **Not done:**
  - a real TV for anything in step 39 (the prompt's keys on a real remote, a real 4-hour wait, the sleep timer overnight);
  - `verify:engines` on Chromium 53 locally (the PR's engines job passed 53, 56 and 68);
  - the new prompt and rows are not in the old-engine walk;
  - steps 39d and 39s; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 146:**
- **A moved clock and a playing stream:** `page.clock.runFor` of more than about 6 s runs the app's clock ahead of the real stream, and the controller's watchdog reads a frozen picture (FROZEN, reconnects, then the error card). Use `page.clock.fastForward`, which fires each due timer once. So a countdown must read a deadline off the clock, never chain timers (39c's first cut did, and the e2e could not jump it).
- **The player always has one timer while open** (the no-key count). Unit tests that pin `clock.pending()` count it.
- **The player's `card` zone has two users:** the status cards and the prompt. A new card must call `guard.covered()` before it takes the zone, and the prompt asks `room` (`!carded`). `showInfo()` does nothing while the prompt shows.
- **The prompt's branch is first in the player's `onIntent`:** a new key added below it is "Keep watching" while the prompt shows.
- **Settings › "Player" since 39c:** `playerRowText` takes the i18n (not `t`); `PlayerValues` has `still`; the options need `setStill`, `sleep` and `setSleep` (fakes in `guides-state.test.ts` and the two player-settings tests). The settings list's "Player" line is pinned in `parental-view.test.ts` in en and ar.
- **Arabic plurals:** 120 takes the `many` form (it ends in twenty), as 30, 60 and 90 do.
- **Mutation was fast here:** a single-file vitest mutant takes about 4 s (153 mutants in about 15 minutes, in three foreground chunks). Writing the list showed three unreachable checks: remove such code before the run.
- **A Bash heredoc carrying Python with `\\'` failed to match again.** Patch scripts with a backslash go through the Write tool.
- **Sizes:** main.js 465.0 of 500 KB on Tizen (35 KB left); settings.js 98.9 of 150; the query worker 149.0 of 150 (1.0 KB left: 39d must use `player.options`, no new `PlayerChange` case).

**From leg 145 (still true):**
- **The player's options already have `clock`** (its wall clock for timers) and `now`: grep an options interface before adding a field.
- **The player can't see the navigator's stack:** it reads `nav.top.id` when it opens (`under`).
- **A key a screen takes but ignores** is a mutation survivor unless a test checks `nav.handle(key) === 'screen'`.
- **The module probe:** a temporary `tools/build/mprobe-<step>.ts` calling `bundleIife({ input: apps/tv/src/main.tsx, platform: 'tizen', split: true, … })`, printing `bundle.modules` (M) and `bundle.lazy[].modules` (S), plus core-js counts without `?commonjs`. Write it with the Write tool. Run it on the change; swap the changed sources for `git show origin/main:<f>`, run again, restore, `diff -a`, delete the probe.
- **A local unit run of everything** can time out heavy tests at 30 s under load. Rerun them alone before calling them failures.
- **An old-engine harness test pins source lines** (`test/engines-onboarding.test.ts`).
- **Peer sessions** (Omar's Samsung session) may send messages with his decisions. Act on what Omar decided. Ask him directly before ticks a handover reserved for his word.

**From legs 130–144 (still true):**
- **`rm` on a shell variable is refused:** write a literal path. `sleep N; cmd` in one Bash call is blocked: wait with one background `until` loop.
- **CI:** a run takes about 30 minutes; `verify` and `media` have 30-minute caps, engines 35. Known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes. Read the annotations, then `gh run rerun <run> --failed` once the whole run is done. No `jq` in Git Bash (use `gh --jq`). A push to an open PR cancels its CI.
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes).
- **Mutation and builds don't mix:** mutation rewrites source files. Never run it beside a build, an e2e run, a probe swap or an agent reading the tree.
- **Settings rows in e2e go by id** (`e2e/settings-rows.ts`). **Onboard in the language you test.** **In Arabic the rail is on the right.** Use `--workers=2` for e2e on this PC.
- **VNode tests don't render sub-components:** give a card a hook-free view (`StillCardView`) to test its words.
- **Never `cd` in a Bash call.** Use absolute paths and `git -C`.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread, no fragments; no `Promise.prototype.finally`; no fields named like built-ins (`at`, `includes`…).
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
- **Leg 146's choices** (Omar may overrule; each is small to change):
  - "Still watching?" is on for everyone at 4 hours by default;
  - every key on any screen counts, and a pause doesn't stop the count (a paused film left for the set hours gets the prompt, then closes with its place kept);
  - on the prompt, Back keeps watching (STOP and the second button close the player);
  - the sleep timer lives for the app's run only, is set only in Settings › "Player" (his Q2 chose rows over an info-bar button), and ends silently when nothing plays;
  - the prompt's words: "Still watching?", "No button has been pressed for a while.", "The sleep timer has ended.", "Playback stops in 60 s", "Keep watching".
- **Leg 145's choices stand** (the clock Off by default; the Guide key closes the stream first; the colour keys' places).
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16's rest and 21 wait for Omar and the TVs** (his "3a").
- **What remains after 39d and 39s:** 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering); with Omar or a TV: 34, 16, 21, 39s4, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - new in leg 146: to check (read in the code, not tried): whether the audio and subtitle keys open the track menu over a catch-up's or a movie's end card (`menuRoom` checks `failed` and the refusal, not `ended`); the prompt and the new rows in the old-engine walk;
  - the restored-source login gap; renaming a source, and removing one; the info bar overflowing in en-XA; a renamed hidden channel's old name over the list; CH+ after hiding the playing channel; `editChannel.close`'s e2e; the guides screen's third line; `auto-next`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset` en-US; `rpc.test.ts:179`; caching ffmpeg in CI; the engines job's 35-minute cap; forwarding workers' unhandled rejections; `epgOverrides` after a re-match; `config-server.ts`'s `close()`; ingest request timeouts; the query worker's budget (1.0 KB left); the start's resume before the worker's load; a VNode test of the pad; the local e2e worker count under load; stored guides keeping their titles' language after a language switch until their next read.

## Checks for Omar
1. **The prompt and the two rows:** `artifacts/screenshots/player-still-en.png`, `player-still-ar.png`, `settings-player-sleep-en.png`, `settings-player-sleep-ar.png` (in the worktree, gitignored). Nothing to decide unless he wants other words, another default than 4 hours, or Back to close the player.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once and look at the new order;
  - switch the language in Settings both ways;
  - try Settings › "Player" (each row, then a channel with two audio languages, then "Clock while watching");
  - set "Sleep timer" to 30 minutes, play a channel and wait for the prompt; try its two buttons and Back;
  - try the colour keys (red on a channel row and in the player, green, yellow, blue) and the Guide key on the remote;
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad with the remote;
  - hide and show the app while unlocked;
  - try "Forgot your PIN?" with the TV's keyboard;
  - try "Set a PIN" on onboarding's done screen;
  - try "Use your phone" on the check, with a real phone.
- **At the Samsung TV next time** (his "3a"): S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, with the TV's own remote; look for the "Zoma" he saw; the sleep timer's prompt as on the LG.
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
