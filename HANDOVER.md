# Lablo IPTV: relay leg 146 opening prompt

You are leg 146 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–144 did steps 1–33, 35–38 (all sub-steps).
- **Leg 145 (2026-11-24): step 39 shaped and split; 39a and 39b built and merged.**
  - **39's shape and split** are in RELAY (`1eaaa03`): the facts found, the shape, three questions, and sub-steps 39a–39d.
  - **Omar answered Q1–Q3 "1 1 1"** (recorded in `656e371`):
    - Q1, the colour keys: shortcuts to existing buttons, one meaning everywhere, shown by dots;
    - Q2: "Still watching?" plus a sleep timer, both rows in Settings › "Player", ending in one prompt;
    - Q3: "Fast start / Stable" as one row on both TVs.
  - **39a, "Clock while watching" and the Guide key:** PR #170, merged as `4ac5201`.
    - The profile's new optional `player.options` record, with one generic `PlayerChange` (`option`).
    - Settings › "Player"'s fifth row; the player's corner clock.
    - The Guide key on the live screen, the guide and the player (`guideFromPlayer` in `guide-state.ts`).
  - **39b, the colour keys:** PR #172, merged as `ddaa00b`.
    - Red: the star in the player, and a second favourites panel over the live list (opaque, under the header).
    - Green: the Guide key's twin.
    - Yellow: PRE-CH's twin in the player.
    - Blue: search on the live screen.
    - Button's `colourKey` dot, and the `--color-key-*` tokens.
  - **Omar's own Samsung session** merged its results as PR #171 (`docs/spikes/results.md`). On his "1a" and "2a" (asked in that session), leg 145 added its fixes as **steps 39s1–39s6** after 39d.
    - 39s1: the storage quota.
    - 39s2: HLS stickiness.
    - 39s3: stall injection that reaches the watchdog.
    - 39s4: launch ≤ 4 s [needs TV].
    - 39s5: small fixes.
    - 39s6: a `tools/` step to drive a TV.
    - **19b is ticked on Omar's word** (`061dd04`). 21 stays open.
  - **Docs:**
    - architecture.md §1.4 item 10: "Built in step 39a" and "Built in step 39b";
    - the §2 "Zapping" line now says yellow is PRE-CH's twin;
    - RELAY `2e32536`: 39b ticked, the 39c read-ahead (5 points), row "145 (cont.)";
    - then this handover's commit.
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV (S4 `suspend`, S10 by hand, S11 lifecycle and reading by ear, the "Zoma" he saw);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - step 39: its "Facts found in leg 145", "Shape" (the decided Q1–Q3), "Split";
   - the `- [x] 39a.` and `- [x] 39b.` lines with their refinements and gates;
   - **`- [ ] 39c.` and its "Read ahead in leg 145" (5 points): the next step**;
   - `- [ ] 39d.`, which points at results.md;
   - the 39s block;
   - the last progress row ("145 (cont.)").
2. **docs/PLAN.md** §5.4 (~227, ~239): the sleep timer with "Still watching?", the buffer setting.
3. **docs/architecture.md** §1.4 item 10 "Built in step 39a" and "Built in step 39b"; §2 (the player: the controller, `KEEPS_SCREENSAVER_AWAY`, the watchdog, the lifecycle).
4. **docs/spikes/results.md** "The app on the Samsung TV" and "From the Samsung TV (2026-11-24)", before 39d and 39s.
5. **For 39c:**
   - `apps/tv/src/player/player-state.ts`: `upNext` and its countdown card (`MovieEndCard` in `PlayerScreen.tsx`) as the model; `close()`; the lifecycle `hidden` (~1378);
   - `apps/tv/src/live/LiveApp.tsx` ~346 (`connectRemote` → `live.activity()`);
   - `apps/tv/src/parental/parental.ts` (`heldLifecycle`);
   - `apps/tv/src/settings/player-settings.ts` and `PlayerSettingsPage.tsx` (the rows; 39a's clock row as the model);
   - `apps/tv/src/player/player-memory.ts` (`clock()` / `setClock`: the `player.options` pattern).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `2e32536` and `ddaa00b`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` (Omar may have stopped it: it's needed only for the web-backed tests) and no `lablo-chrome*` container. Docker itself is needed for `verify:engines`.
2. **Step 39c: refine against the code first** (write "Refined before building" under 39c, as 38d3 and 39b did). Then build it with the usual gates:
   - unit tests;
   - e2e in en, ar and en-XA (a manual clock via `page.clock.install()` should drive the hours and the 60 s countdown);
   - every touched spec green;
   - lint, typecheck;
   - `build:tv` and a module diff;
   - engines 68 locally (alone);
   - mutation with the list written first;
   - the PR, CI, and the merge on green.
   - Choices left to make at refinement (pick the conventional one, write why):
     - whether "Still watching?" counts keys on every screen or only in the player;
     - whether a movie's pause stops the count;
     - the sleep timer's values kept for the run only;
     - the prompt's words.
     - If any has real trade-offs, ask Omar (needs-you).
   - **The Player page's rows:** 39c makes seven, which still fit unwindowed. 39d's eighth needs a windowed `list` zone (`visible`), as the main settings list has.
3. **Then 39d** (read results.md first: AVPlay reconnects held sockets itself about 7 s after the data stops, and needs more than 600 KB before it plays). **Then the 39s steps**, starting with 39s1 (the quota) and 39s2 (HLS stickiness; may need a question for Omar).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`ddaa00b`) plus `2e32536` and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of 39b's final code;
  - in `artifacts/`:
    - `mutate39a.py` and `mutate39b.py` with their `-a`…`-d` logs;
    - `build-tv-39a*.log`, `build-tv-39b*.log`;
    - `mprobe-39a-*.log`, `mprobe-39b-*.log`;
    - `engines-39a-68.log`, `engines-39b-68.log`;
    - `e2e-39a-*.log`, `e2e-39b-*.log`, `unit-39a.log`, `unit-39b.log`, the lint and typecheck logs;
  - screenshots `player-clock-*.png`, `settings-player-clock-*.png`, `colour-red-list-*.png`, `colour-player-bar-*.png`.

## Verified vs not
- **Verified in leg 145:**
  - **39a:**
    - unit 8,662;
    - e2e: `clock-guide-key.spec.ts` 3 of 3, plus 25 related and `tv-bundle` 10;
    - mutation 50 of 50;
    - `build:tv`: main.js 458.7 KB on Tizen, query worker 149.0 of 150 KB;
    - module diff: nothing added or removed;
    - engines 68: 13 of 13;
    - CI green at the first run.
  - **39b:**
    - unit 8,660 (seven heavy tests timed out under load and passed alone);
    - e2e: `colour-keys.spec.ts` 3 of 3, plus 32 related and `tv-bundle` 10;
    - mutation 30 of 30 plus one equivalent;
    - main.js 459.6 KB on Tizen;
    - module diff: nothing added or removed;
    - engines 68: 13 of 13;
    - CI: `media` hit its cap once, failed once on the `epg-declared-300mb` flake, then passed.
  - The screenshots were looked at: the corner clock in en and ar; the list's favourites panel in ar, under the header; the info bar's dots in en.
- **Not done:**
  - `verify:engines` on Chromium 53 locally (the PRs' engines jobs passed 53, 56 and 68);
  - the new screens and keys are not in the old-engine walk;
  - a real TV for anything in step 39 (the colour keys on a real remote, the clock on an OLED);
  - steps 39c, 39d and 39s; production (step 34).
- **Migrations and deploys:** none. Nothing is deployed.

## Gotchas and lessons
**New in leg 145:**
- **The player's options already have `clock`** (its wall clock for timers): a new player setting needs another name (`watchClock`). Grep an options interface before adding a field.
- **The player can't see the navigator's stack:** it reads `nav.top.id` when it opens (`under`) to know what it sits over.
- **Closing the guide always lands on the live list's row**, even when it opened from the header (`focusRow`'s `keepZone` keeps another zone only while another screen is on top). UP reaches the header only from row 0 and lands on its last button.
- **A key a screen takes but ignores** is a mutation survivor unless a test checks `nav.handle(key) === 'screen'`.
- **The favourites menu closes itself on STOP** before calling `stop` (meant to close the player); `closed`/`stop` are no-ops for the list's panel. Both menus share screen ids: LiveApp paints the player only while the list's panel is shut.
- **Button now has `position: relative`** (for the dot). The dot is absolutely placed in the top-end corner; rtlcss mirrors it.
- **The module probe:** a temporary `tools/build/mprobe-<step>.ts` calling `bundleIife({ input: apps/tv/src/main.tsx, platform: 'tizen', split: true, … })`, which prints `bundle.modules` (M) and `bundle.lazy[].modules` (S), plus core-js counts without `?commonjs`.
  - Write it with the Write tool: a heredoc ate a backslash.
  - Run it on the change. Then copy the changed source files aside, run it on `git show <base>:<f>` versions, restore the copies, `diff -a` the two outputs, and delete the probe.
- **A local unit run of everything** times out seven heavy tests (bundle builds, lint rules, fixture parsers) at 30 s under load. Rerun them alone with `--maxWorkers=2` before calling them failures.
- **An old-engine harness test pins source lines** (`test/engines-onboarding.test.ts`: the header's Guide button). Changing such a line breaks it.
- **The auto-mode classifier can fail to give a verdict on a Bash call.** Then the whole call doesn't run, so a heredoc-written script never reached disk. Retry once, or write the script with the Write tool.
- **Peer sessions** (Omar's Samsung session) may send cross-session messages with his decisions. Act on what Omar decided. Ask him directly before ticks or other changes a handover reserved for his word.

**From leg 144 (still true):**
- **`rm` on a shell variable is refused** by a safety check (`rm "$WT/$f"`): write `rm "${WT:?}/${f:?}"` or a literal path. `sleep N; cmd` in one Bash call is blocked too: wait with one background `until` loop.
- **The query worker has 1.0 KB left** (149.0 of 150 KB). 39c and 39d must use `player.options` (no new `PlayerChange` case).
- **Making the player's controller early is safe:** the stage stays hidden unless the player shows.

**From leg 143 (still true):**
- **CI `verify` has a 30-minute cap; `media` too.** When a job is "cancelled" for "exceeded the maximum execution time":
  - read the annotations (`gh api repos/Omarmarei/Lablo/check-runs/<id>/annotations`) and the step times (`gh run view <run> --json jobs`);
  - the media job's ffmpeg install alone can take 16 minutes;
  - rerun with `gh run rerun <run> --failed` once the whole run is done, and watch the run's status until `completed`.
- **A change to the workflow file brings in every CI job.**
- **Foreground waits over 600 s are moved to the background.** Bound them with `timeout 570`, or keep exactly one background waiter.
- **VNode tests don't render sub-components.** A dialog over the settings list keeps the list painted via `under`.
- **Never `cd` in a Bash call.** Use absolute paths and `git -C`.

**From legs 130–142 (still true):**
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes).
- **Mutation and agents don't mix:** mutation rewrites source files. Never run it beside an e2e run, a build, a probe swap or an agent reading the tree.
- **Settings rows in e2e go by id:** use `e2e/settings-rows.ts` (`openSettings(remote, next)`, `toSettingsRow`, `settingsRow`).
- **The profile keeps onboarding's language.** Onboard in the language you test.
- **This PC is loaded:** use `--workers=2` for e2e.
- **Bash heredocs carrying Python with quotes or backslashes can fail.** Write patch scripts with the Write tool.
- **In Arabic the rail is on the right:** RIGHT goes to it.
- **Mutation chunks:** foreground, `MUT_TIMEOUT=300`, under ~9 minutes each. A unit mutant takes ~15–20 s, an e2e mutant ~30–45 s.
- **CI:** a run takes about 30 minutes. Known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, and Chromium 53/56 start-up and stuck deletes. No `jq` in Git Bash (use `gh --jq`).

**From earlier legs (still true):**
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread, no fragments;
  - no `Promise.prototype.finally`;
  - no fields named like built-ins (`at`, `includes`…).
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.** Helpers main needs live outside `settings/`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Run heavy checks one at a time; `build:tv` in the background (5–10 min).

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens (39s6).
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. A push to an open PR cancels its CI. Omar said on 2026-11-23: carry on with new changes without asking.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Leg 145's choices** (Omar may overrule; each is small to change):
  - "Clock while watching" is Off by default (OLED retention), and shows only with the bar hidden;
  - the Guide key in the player closes the stream before opening the guide (no picture-in-picture);
  - the Guide and colour keys do nothing on Home, movies, series, search and Settings;
  - red on the live list acts only on a channel row; blue only on the live screen.
- **Earlier legs' choices stand** (38b–38d3; see RELAY).
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16's rest and 21 wait for Omar and the TVs** (his "3a").
- **What remains after 39 and 39s:**
  - 40 (diagnostics and legal pages);
  - 43 (accessibility);
  - 44 (store documents);
  - 45 (release engineering);
  - with Omar or a TV: 34, 16, 21, 39s4, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - the restored-source login gap;
  - renaming a source, and removing one (no way in the app today);
  - the info bar overflowing in en-XA;
  - a renamed hidden channel's old name over the list;
  - CH+ after hiding the playing channel;
  - `editChannel.close`'s e2e;
  - the guides screen's third line;
  - `auto-next`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - `guide-offset` en-US;
  - `rpc.test.ts:179`;
  - caching ffmpeg in CI (it took 16 minutes in leg 145);
  - the engines job's 35-minute cap;
  - forwarding workers' unhandled rejections;
  - `epgOverrides` after a re-match;
  - `config-server.ts`'s `close()`;
  - ingest request timeouts;
  - the query worker's budget (1.0 KB left);
  - the start's resume before the worker's load;
  - a VNode test of the pad;
  - the local e2e worker count under load;
  - stored guides keeping their titles' language after a language switch until their next read.

## Checks for Omar
1. **The corner clock and the colour keys:** `artifacts/screenshots/player-clock-en.png`, `player-clock-ar.png`, `colour-red-list-ar.png`, `colour-player-bar-en.png` (in the worktree, gitignored). Nothing to decide unless he wants other words, colours or places.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once and look at the new order;
  - switch the language in Settings both ways;
  - try Settings › "Player" (each row, then a channel with two audio languages, then "Clock while watching");
  - try the colour keys (red on a channel row and in the player, green, yellow, blue) and the Guide key on the remote;
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad with the remote;
  - hide and show the app while unlocked;
  - try "Forgot your PIN?" with the TV's keyboard;
  - try "Set a PIN" on onboarding's done screen;
  - try "Use your phone" on the check, with a real phone.
- **At the Samsung TV next time** (his "3a"): S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, with the TV's own remote; look for the "Zoma" he saw.
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
