# Lablo IPTV: relay leg 145 opening prompt

You are leg 145 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–143 did steps 1–33, 35, 35e, 36, 37, 38a, 38b, 38c (all four sub-steps), 38d1 and 38d2.
- **Leg 144 (2026-11-24): 38d3 ("Player") built and merged; 38d and 38 ticked.**
  - **Refined first** (7 points in RELAY under 38d3's "Refined before building").
  - **Built** (`dccb116`, then `311216e`):
    - the "Player" row between "Parental control" and "Language", and its page (`settings/player-settings.ts`, `PlayerSettingsPage.tsx`). It has four rows: "Audio language", "Subtitles", "Subtitle size", "Picture". OK goes round a row's values; LEFT/RIGHT step towards the reading end and stop at the ends;
    - the profile's optional `player.audioLang` / `player.subtitleLang` (no version bump) and their `PlayerChange` cases (`null` takes one away);
    - `player-memory.ts` keeps them; `trackPreferences` in `app-player.ts` puts them first in main's `preferences`;
    - `Player.pictureModes()` (makes the controller), `Player.setPicture()` (the info bar's code) and `Player.setSubtitleSize()` (the track menu's `setSize`, now on `TrackMenu`);
    - `data-subtitle-size` on the player root;
    - `openSettings(remote, next)` is now shared in `e2e/settings-rows.ts`.
  - **PR #169, merged as `e0bf890`.** CI green at the first run.
  - **Docs:** `185e755` (architecture.md "Built in step 38d3"), `509cc57` (RELAY: 38d3's "Done in leg 144", the new `- [x] 38d.` line, 38 ticked with its lock check, **39's "Read ahead in leg 144"**, row 144), then this handover's commit.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.
- **Omar's own Samsung session (outside the relay) ran on 2026-11-23.** Memory `iptv-samsung-tv.md` has the details:
  - the TV: UA32T5300AUXEG, 2020, Tizen 5.5;
  - its worktree `D:/tmp/lablo-samsung`, branch `samsung/tv-session-20261123`;
  - its lab server uses **this relay worktree's `.cache/media`**.
  - Rules: don't touch that worktree or branch, and don't delete this worktree's `.cache/media`. Omar saw the old name "Zoma" somewhere in the lab on Tizen (recorded for later, "ignore for now"). Don't tick 16, 19b or 21 from it: Omar decides.

## Read first
1. **RELAY.md:**
   - **step 39** and its "Read ahead in leg 144" (5 points): the next step;
   - step 38's "Shape" and 38d3's "Refined before building" / "Done in leg 144", for how a step's shape, split and refinements were written;
   - the last progress row (144).
2. **docs/PLAN.md** §5.4 (lines ~227, 239, 240): the clock, the sleep timer with "Still watching?", the colour keys, the buffer setting.
3. **docs/architecture.md** §1.4 item 10 "Built in step 38d3", and §2 (the player: the controller, the engines, the stall and reconnect logic).
4. **For 39's reading:**
   - `apps/tv/src/live/LiveApp.tsx` (`live-clock`) and `player/PlayerScreen.tsx` (`player__clock`): where the time already shows;
   - `packages/platform-api/src/` (the intents `RED`, `GREEN`, `YELLOW`, `BLUE`, `GUIDE`) and their uses (`live-state.ts`, `guide-state.ts`);
   - `packages/platform-tizen/src/avplay-engine.ts` (buffering events; no `setBufferingParam` yet), `packages/player/src/html5-engine.ts`, `controller.ts` (the stall limits, `BUFFERING`);
   - `apps/tv/src/player/player-state.ts` (the info bar's actions, the lifecycle), `app-player.ts` (`setScreenSaver`);
   - the settings: `settings/player-settings.ts` (a likely home for the sleep timer or the buffer setting).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -5` shows this handover's commit, then `509cc57`, `e0bf890`, `185e755` and `311216e`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` and no `lablo-chrome*` container.
2. **Step 39: write its shape and split first** (as 35–38 did), checked against the code. The read-ahead proposes:
   - 39a: the clock and the colour keys (main.js screens);
   - 39b: the sleep timer with "Still watching?";
   - 39c: the buffer setting (engines; real proof may need the TVs, step 21).
   - **Decisions with real trade-offs go to Omar** as a needs-you stop, numbered and with a recommendation. Likely ones:
     - what each colour key does on each screen;
     - the sleep timer's choices (fixed minutes, and/or "at the programme's end") and where it is set (info bar button, Settings › "Player", or both);
     - what "Fast start / Stable" changes on webOS's `<video>`, where there is no buffer knob.
   - Where a choice is conventional, pick it and write why, as 38's shape did.
3. **Then build 39a** (or the first sub-step) with the usual gates:
   - unit tests;
   - e2e in en, ar and en-XA;
   - every touched spec green;
   - lint, typecheck;
   - `build:tv` and a module diff;
   - engines 68 locally (alone);
   - mutation with the list written first;
   - the PR, CI, merge on green.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`e0bf890`) plus `509cc57` and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: `build:tv` of leg 144's final code (`311216e`);
  - in `artifacts/`:
    - `mutate38d3.py` and `mutate38d3-a…e.log`;
    - `build-tv-38d3.log`, `build-tv-38d3b.log`;
    - `mprobe-38d3-before.log` / `-after.log`;
    - `engines-38d3-68.log`;
    - `e2e-38d3-*.log`, `lint-38d3.log`, `typecheck-38d3.log`, `unit-38d3.log`;
  - screenshots `artifacts/screenshots/settings-player-en.png`, `settings-player-ar.png`, `settings-player-en-XA.png`.

## Verified vs not
- **Verified in leg 144 (38d3):**
  - unit `pnpm test`: 8,637;
  - e2e:
    - `player-settings.spec.ts` 3 of 3 (en, ar, en-XA);
    - the two new media tests in `player-media.spec.ts` (the languages on the multi-audio MKV);
    - every spec that opens Settings plus `player` and `live`: 77;
    - the web-backed tv project: 13;
    - `tv-bundle`: 10;
    - `parental`: 3 (step 38's lock check);
  - mutation 70 of 70;
  - lint and both type checks;
  - `build:tv`:
    - main.js 457.3 KB on Tizen (+2.2);
    - settings.js 97.7 KB (+3.0);
    - query worker 148.7 of 150 KB (+0.2);
    - core-js unchanged;
    - module diff: only `player-settings.ts` and `PlayerSettingsPage.tsx`, in settings.js;
  - `verify:engines --engine chrome68` 13 of 13;
  - PR #169's CI green at the first run: unit 8,636 (+1 skipped), e2e 215, engines on 53/56/68, media, web;
  - the page's screenshots looked at in English and Arabic.
- **Not done:**
  - `verify:engines` on Chromium 53 locally (the PR's engines job passed it);
  - the Player page is not in the old-engine walk;
  - real in-band subtitles: the e2e adds text tracks itself, because desktop Chromium lists none;
  - a real TV for any of step 38 (step 21's session);
  - step 39; production (step 34).
- **Migrations and deploys:** none in this leg. Nothing is deployed.

## Gotchas and lessons
**New in leg 144:**
- **`rm` on a shell variable is refused** by a Claude Code safety check (`rm "$WT/$f"`): write `rm "${WT:?}/${f:?}"` or a literal path (memory `bash-rm-variable-guard.md`). `sleep N; cmd` in one Bash call is blocked too: wait with one background `until` loop.
- **Subtitle choice in e2e:** a `page.addInitScript` MutationObserver calls `addTextTrack` on `#stage video` before the stream's metadata; Html5Engine lists them and the controller picks by the preferences (memory `iptv-playwright-chromium-media.md`). The MKV's default audio is Arabic: in an English UI, check the subtitle pick first, then that `ara` stays.
- **The query worker has 1.3 KB left** (148.7 of 150 KB): anything added to `packages/data`'s profile edits lands there.
- **Making the player's controller early is safe:** the stage stays hidden unless the player shows. `nextMode` reads the controller's modes before `picture.value` (the controller's creation may turn a kept mode into `fit`).
- **The module probe:** write it, run it on the change and on HEAD~'s versions of the changed files (copy aside, `git show <base>:<f> > <f>`, delete the new files with `${WT:?}`), restore, `diff -a`, delete the probe. Compare only probes counted the same way: leg 144's counts core-js modules without `?commonjs` entries (173 / 2), leg 143's with them (216 / 6).
- **Settings:** ten rows now (`player` at index 5). `guides-state.test.ts` and `parental-view.test.ts` pin the order, the window and `SETTINGS_SCREENS`. A page that changes values in place handles only LEFT/RIGHT in `onIntent` and leaves BACK to the navigator.

**From leg 143 (still true):**
- **CI `verify` has a 30-minute cap** (it took 18–20 min). If a job is "cancelled" with "exceeded the maximum execution time", read the annotations (`gh api repos/Omarmarei/Lablo/check-runs/<id>/annotations`) and the job log (`gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`) first.
- **A change to the workflow file brings in every CI job,** `media` included (and its `epg-declared-300mb` flake).
- **`gh run rerun <run> --failed` can print a network error and still have started the rerun.** Check `gh run view <run> --json jobs` before retrying.
- **Foreground waits over 600 s are moved to the background by the Bash tool.** Bound them with `timeout 570`, or keep exactly one background waiter.
- **VNode tests don't render sub-components:** markup lines go through plain functions returning VNodes.
- **A dialog over the settings list keeps the list painted** via `under` passed to `useZone`.
- **`screen.focus(zone, -1)` is clamped to the first item** by the focus engine.
- **The language switch in place:** `render(<LiveApp language={…} …/>)` into the same root; screens take their words from the `i18n` prop at render.
- **Never `cd` in a Bash call.** Use absolute paths and `git -C`.

**From leg 142 (still true):**
- **Run the engines check alone** (`verify:engines --engine chrome68`, about 4 minutes).
- **A background run reaped for low memory is not restarted.** For the engines, the PR's `engines` job is the check. Remove any container a reaped run leaves (`docker rm -f lablo-chrome53-…`).
- **Waiting for CI:** one background Bash `until` loop on the pending count (`gh pr checks <n> -R Omarmarei/Lablo --json bucket --jq '[.[] | select(.bucket=="pending")] | length'` = 0, with the total > 0), then print the checks.
- **Mutation and agents don't mix:** mutation rewrites source files while it runs. Never run it beside an e2e run, a probe swap or an agent reading the tree.
- **Settings rows in e2e go by id:** `SETTINGS_FIRST`, `settingsRow(id)`, `toSettingsRow(remote, id)`, `fromSettingsRow(remote, from, to)`, `openSettings(remote, next)` from `e2e/settings-rows.ts`. Never write `settings/items/<n>`.

**From legs 130–141 (still true):**
- **The profile keeps onboarding's language** (and Settings › "Language" changes it). Onboard in the language you test; en-XA: onboard with `locale=en-XA`.
- **This PC is loaded by other sessions.** Use `--workers=2` locally for e2e.
- **Bash heredocs carrying Python with quotes or backslashes can fail.** Write such patch scripts with the Write tool (it may turn `\uXXXX` into raw characters, which Python accepts).
- **The mock's panel gives the done screens a PIN prompt.** The shared steps take "Later": `toStartButton` and `closeDone`.
- **Shared types are compared whole in the root tests:** grep the root `test/` too when one changes.
- **With two sources the live rail is windowed:** check for the `open <group>` chip, not the last chip.
- **A change under `packages/protocol` or `packages/data` may bring in the media job.** `epg-declared-300mb` may fail once or twice; rerun with `gh run rerun <run> --failed` only after the whole run is done.
- **Mutation chunks:** foreground, `MUT_TIMEOUT=300`, under ~9 minutes each. A unit mutant takes ~15–20 s, an e2e mutant ~30 s, a media mutant ~40 s. A media command in the script: `set LABLO_E2E_MEDIA=1&& pnpm exec playwright test … --project playback-media`.
- **Send the deciding key and BACK in separate `press` calls.**
- **e2e profile tricks:** `restartWith(page, { sources: [...] })`, `storedSources`, `ADULT_OPEN`, `pinFields`, `appIdle`, and the steps in `e2e/parental-steps.ts` (`untranslated`).
- **Sizes:** main.js 500 KB hard budget on Tizen (457.3 now). settings.js 97.7 of 150 KB. Query worker 148.7 of 150 KB.
- **CI:** a run takes about 30 minutes. Known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, and Chromium 53/56 start-up and stuck deletes. No `jq` in Git Bash (use `gh --jq`).

**From earlier legs (still true):**
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread, no fragments;
  - no `Promise.prototype.finally`;
  - no fields named like built-ins (`at`, `includes`…).
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.** Helpers main needs live outside `settings/`. settings.js may import main's modules (e.g. `player/PlayerScreen`'s `PICTURE_TEXT`, `player/TrackMenuPanel`'s `SIZE_KEYS`).
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Run heavy checks one at a time; `build:tv` in the background (5–10 min).

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. A push to an open PR cancels its CI. Omar said on 2026-11-23: carry on with new changes without asking.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Leg 144's choices** (Omar may overrule; each is small to change):
  - the picture's modes come from the engine (`Player.pictureModes()` makes the controller), so Tizen offers no Zoom;
  - subtitles "Off" and "never set" are one state (no `'off'` stored). "Off" turns no subtitles on; a stream that starts its own keeps them until the track menu turns them off;
  - the row's and the page's words, en and ar ("Player" / "المشغّل"; the lines in the catalogs' `playerSettings.*`).
- **Earlier legs' choices stand** (38b, 38c1–38c4, 38d1, 38d2; see RELAY).
- **For 39:** the decisions listed in next step 2.
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar's word.** His own Samsung session has started on a 2020 Tizen TV (see Status).
- **What remains after 39:**
  - 40 (diagnostics and legal pages);
  - 43 (accessibility);
  - 44 (store documents);
  - 45 (release engineering);
  - with Omar or a TV: 34, 16/19b/21, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - the restored-source login gap;
  - renaming a source; there is no way to remove a source in the app;
  - the info bar overflowing in en-XA;
  - a renamed hidden channel's old name over the list;
  - CH+ after hiding the playing channel;
  - `editChannel.close`'s e2e;
  - the guides screen's third line;
  - `auto-next`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - `guide-offset` en-US;
  - `rpc.test.ts:179`;
  - caching ffmpeg in CI;
  - the engines job's 35-minute cap;
  - forwarding workers' unhandled rejections;
  - `epgOverrides` after a re-match;
  - `config-server.ts`'s `close()`;
  - ingest request timeouts;
  - the query worker's budget (1.3 KB left);
  - the start's resume before the worker's load;
  - a VNode test of the pad;
  - the local e2e worker count under load;
  - stored guides keeping their titles' language after a language switch until their next read;
  - from Omar's Samsung session:
    - the old name "Zoma" still shows in the lab on Tizen;
    - `pnpm device install tizen` fails on the package name with a space (`Lablo Lab.wgt`).

## Checks for Omar
1. **Settings › "Player":** `artifacts/screenshots/settings-player-en.png` and `settings-player-ar.png` (in the worktree, gitignored). Nothing to decide unless he wants other words or other values.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once and look at the new order;
  - switch the language in Settings both ways;
  - try Settings › "Player" (each row, then a channel with two audio languages);
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad with the remote;
  - hide and show the app while unlocked;
  - try "Forgot your PIN?" with the TV's keyboard;
  - try "Set a PIN" on onboarding's done screen;
  - try "Use your phone" on the check, with a real phone.
- **Samsung:** the test TV is set up (memory `iptv-samsung-tv.md`). Back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
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
