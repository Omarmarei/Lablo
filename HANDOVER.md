# Lablo IPTV: relay leg 144 opening prompt

You are leg 144 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–142 did steps 1–33, 35, 35e, 36, 37, 38a, 38b, 38c (all four sub-steps) and 38d1.
- **Leg 143 (2026-11-23): 38d2 ("Language") built and merged.**
  - **Refined first** (7 points in RELAY). No state module keeps translated text, so a new `i18n` in LiveApp is the whole switch.
  - **Built** (`d6daa04`):
    - the "Language" row after "Parental control", its line giving the languages' own names;
    - its dialog: the focus starts on the language on show; OK on the other language switches after the dialog closes; OK on the same one, or Back, only closes;
    - main.tsx writes `onboarding.language`, then paints LiveApp again in the new language: in place, no reload;
    - LiveApp's remote keys moved to an effect of their own.
  - **PR #168, merged as `48341b4`.** The first CI run's `verify` job hit its 20-minute cap in its last e2e spec (every test before it green). `154b558` raised the cap to 30 minutes; the next `verify` took 20m21s. `media` needed one rerun (`epg-declared-300mb` took 62.9 s against its 60 s limit).
  - **Docs:** `8a1ba11` (RELAY's 38d2 "Done in leg 143", **38d3's "Read ahead in leg 143"** (5 points), row 143, architecture.md), then this handover's commit.
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
   - step 38's "Shape" ("The complete settings screen", "Player");
   - 38d's "Split in leg 142";
   - 38d2's "Refined before building" and "Done in leg 143";
   - **38d3's shape and its "Read ahead in leg 143"** (the next step);
   - the last progress row (143).
2. **docs/architecture.md** §1.4 item 10: "Built in step 38d2" (after "Built in step 38d1").
3. **For 38d3:**
   - `apps/tv/src/player/player-memory.ts` (`subtitleSize`/`setSubtitleSize`, `picture`/`setPicture`, `load`);
   - `packages/data/src/profile.ts` (`PlayerMemoryDoc` ~168, `PlayerChange` ~438, `applyPlayerChange` ~666);
   - `apps/tv/src/player/track-menu.ts` (`size`, `setSize`, the style rows' LEFT/RIGHT);
   - `apps/tv/src/player/player-state.ts`: `picture` ~484, `ctrl()` ~636, `nextMode` ~650, `createTrackMenu` ~1045;
   - `apps/tv/src/player/app-player.ts` (`uiTrackPreferences`);
   - `apps/tv/src/main.tsx`: `appPlayer`'s `preferences` ~342, `createPlayer` ~672, `settingsOptions` ~561;
   - `packages/player/src/picture.ts` (`pictureModes`, `nextPicture`), `controller.ts` (`pictureModes` ~628, `preferences` ~968).
4. **The model to copy:**
   - `apps/tv/src/settings/language-choice.ts` and `LanguageDialog.tsx` (38d2: an optional settings row fed by main);
   - `parental-page.ts` / `ParentalPage.tsx` (a page of rows, each with its value beside its name).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -5` shows this handover's commit, then `8a1ba11`, `48341b4`, `154b558` and `d6daa04`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` and no `lablo-chrome*` container.
2. **38d3: "Player"**, as RELAY's shape plus the read-ahead.
   - **Confirm the read-ahead against the code first, then write the refinements in RELAY** (as 38d2's "Refined before building"). Decide the picture modes' source: the read-ahead proposes `Player.pictureModes()`, which makes the controller.
   - **Build:**
     - the "Player" row before "Language" (`settings-items.ts`), and its page (a `player-settings` screen in settings.js) with four rows: "Audio language", "Subtitles", "Subtitle size", "Picture";
     - the profile's optional `audioLang` and `subtitleLang` (no version bump) and their `PlayerChange` cases;
     - `player-memory.ts`;
     - main's `preferences` (stored languages first);
     - `Player.setSubtitleSize` / `setPicture` / `pictureModes`;
     - `SettingsOptions.player`.
   - **The gates:**
     - unit tests: the page, the memory, the profile edits (root `test/` too if a shared type changes), the preferences;
     - e2e in en, ar and en-XA: each row applied in the player, using the mock's stream with two audio tracks and subtitles (see memory `iptv-playwright-chromium-media.md` for what CfT plays);
     - every settings spec still green;
     - lint, typecheck;
     - `build:tv` and a module diff;
     - engines (68 locally, alone);
     - mutation with the list written first;
     - the PR, CI, merge on green.
3. **Then tick 38d and 38.** 38's own "Done when" is the lock check: with the mock's source, nothing of "18+ Test (lock check)" is on any screen until the PIN.
4. **After 38:** step 39 (clock, sleep timer, colour keys, buffer setting). Write its shape and split first, as 35–38 did.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`48341b4`) plus `8a1ba11` and this handover's commit.
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (including `.cache/media`, used by Omar's Samsung session), `apps/web/.env`;
  - `apps/web/.next`, and `dist/` (`build:tv` of 38d2, from just before its dead-guard removal; rebuild before a bundle check);
  - in `artifacts/`: `mutate38d2.py`, `build-tv-38d2.log`, `mprobe-38d2-before.log` / `-after.log`, `engines-38d2-68.log`, `e2e-38d2-a.log`, `e2e-38d2-web-tv.log`, `lint-38d2.log`, `typecheck-38d2.log`;
  - screenshots `artifacts/screenshots/settings-language-en.png`, `settings-language-ar.png`, `settings-language-en-XA.png`, `live-switched-ar.png`, `live-switched-en.png`.

## Verified vs not
- **Verified in leg 143 (38d2):**
  - the TV unit tests (4,551);
  - e2e: `language.spec.ts` 3 of 3; every spec that opens Settings plus `live` and `tv-bundle`, 72 of 72 (the built bundles switch to Arabic); the web-backed tv project, 13 of 13;
  - mutation 33 of 33;
  - lint and both type checks;
  - `build:tv`: main.js 455.1 KB on Tizen, settings.js 94.7 KB; core-js unchanged (216 / 6); the module diff adds only `LanguageDialog.tsx` and `language-choice.ts`, both in settings.js;
  - `verify:engines --engine chrome68` 13 of 13;
  - PR #168's CI green (engines on 53, 56 and 68);
  - the screenshots looked at (the dialog in English and Arabic, the live screen after the switch).
- **Not done:**
  - `verify:engines` on Chromium 53 locally (the PR's engines job passed it);
  - the language switch is not part of the old-engine walk; the tv-bundle e2e runs it on the built bundles in modern Chromium;
  - 38d3; production (step 34); a real TV for any of step 38 (step 21's session).
- **Migrations and deploys:** none in this leg. Nothing is deployed.

## Gotchas and lessons
**New in leg 143:**
- **CI `verify` now has a 30-minute cap** (`.github/workflows/ci.yml`; it takes 15–20+ minutes). If a job is "cancelled" with "exceeded the maximum execution time", read the annotations (`gh api repos/Omarmarei/Lablo/check-runs/<id>/annotations`) and the job log (`gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`) before suspecting the change.
- **A change to the workflow file brings in every CI job,** `media` included (and its `epg-declared-300mb` flake).
- **`gh run rerun <run> --failed` can print a network error and still have started the rerun.** Check the job's state (`gh run view <run> --json jobs`) before retrying.
- **Foreground waits over 600 s are moved to the background by the Bash tool,** which doubles the watchers. Bound them with `timeout 570 bash -c 'until …; do sleep 20; done'`, or keep exactly one background waiter. Stop any extra with TaskStop.
- **VNode tests don't render sub-components.** A row's markup line goes through a plain function returning VNodes (`languageNames()`), so the tests see its spans.
- **A dialog over the settings list keeps the list painted:** keep the settings' `Screen` in the dialog's state (`under`) and pass it to `useZone`. e2e asserts the row under it has `data-state="memory"`.
- **`screen.focus(zone, -1)` is clamped to the first item** by the focus engine. Don't add a `Math.max` guard: it is an equivalent mutant.
- **The language switch in place:** `render(<LiveApp language={…} …/>)` into the same root. Main's `paint()` in `showLive` does it. Screens must keep taking their words from the `i18n` prop at render, never caching them.
- **Never `cd` in a Bash call.** It moved the session's directory twice in this leg; use absolute paths and `git -C`.

**From leg 142 (still true):**
- **Run the engines check alone.** `verify:engines --engine chrome68` beside other checks failed webOS walks; alone it passes in about 4 minutes.
- **A background run reaped for low memory is not restarted.** For the engines, the PR's `engines` job is the check. Remove any container a reaped run leaves (`docker rm -f lablo-chrome53-…`).
- **Waiting for CI:** one background Bash `until` loop on the pending count (`gh pr checks <n> --json bucket --jq '[.[] | select(.bucket=="pending")] | length'` = 0, after a 30 s sleep), then print the checks.
- **Mutation and agents don't mix:** mutation rewrites source files while it runs. Never run it beside an e2e run or an agent reading the tree.
- **A test whose navigator ends at its root can't see one screen too many closed.** Push the page the flow really opens from.
- **Settings rows in e2e go by id:** `SETTINGS_FIRST`, `settingsRow(id)`, `toSettingsRow(remote, id)`, `fromSettingsRow(remote, from, to)` from `e2e/settings-rows.ts`. Never write `settings/items/<n>`. The list now has nine rows (seven show): move to a row before asserting on it.
- **Settings unit tests** (`guides-state.test.ts`, `parental-view.test.ts`) pin the order and each optional row's place. "Player" changes those pins again.
- **CI's e2e count is now 212** (203 chromium + 9 throttled).

**From legs 130–141 (still true):**
- **The profile keeps onboarding's language.** Since 38d2, Settings › "Language" changes it too. A restart with `?locale=ar-SA` after an en-US onboarding still shows English. Onboard in the language you test; en-XA is the exception (onboard in en-US, restart in en-XA, or onboard with `locale=en-XA`).
- **This PC is loaded by other sessions.** Use `--workers=2` locally for e2e.
- **Bash heredocs carrying Python with quotes or backslashes can fail.** Python patch scripts in a quoted heredoc (`<<'EOF'`) worked this leg; with backslashes, write the script with the Write tool.
- **The mock's panel gives the done screens a PIN prompt.** The shared steps take "Later": `toStartButton` and `closeDone`.
- **`LoadResult` and shared types are compared whole in the root tests:** grep the root `test/` too when a shared type changes (38d3 changes `PlayerMemoryDoc` and `PlayerChange`).
- **With two sources the live rail is windowed:** check for the `open <group>` chip, not the last chip.
- **A change under `packages/protocol` or `packages/data` may bring in the media job** (38d3 touches `packages/data`). `epg-declared-300mb` may fail once or twice; rerun with `gh run rerun <run> --failed` only after the whole run is done.
- **Mutation chunks:** run them in the foreground with `MUT_TIMEOUT=300`. A unit mutant takes about 20 s; an e2e mutant on `language.spec.ts` about 30 s (the dev server restarts each time).
- **Send the deciding key and BACK in separate `press` calls.**
- **e2e profile tricks:** `restartWith(page, { sources: [...] })`, `storedSources`, `ADULT_OPEN`, `pinFields`, `appIdle`, and the steps in `e2e/parental-steps.ts` (`untranslated`).
- **Sizes:** main.js has a 500 KB hard budget on Tizen (455.1 KB now). The query worker has 1.5 KB left (148.5 of 150). settings.js is at 94.7 of 150 KB.
- **CI:** a run takes about 30 minutes. Known flakes: `auto-next.spec.ts:151`, `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, and Chromium 53/56 start-up and stuck deletes. There is no `jq` in Git Bash (use `gh --jq`).
- **Module diff** (as in leg 143):
  1. Write a temporary `tools/build/src/zz-module-probe.ts` that calls `bundleIife({ input: apps/tv/src/main.tsx, platform: 'tizen', polyfills: true, split: true })` and prints `result.modules` and each `result.lazy[i].modules`.
  2. Run it with `pnpm exec tsx` on the change and on HEAD's versions of the changed files (copy them aside, `git show HEAD:<f> > <f>`, then copy them back).
  3. Diff the two lists with `diff -a`, then delete the probe.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread, no fragments;
  - no `Promise.prototype.finally`;
  - no fields named like built-ins (`at`, `includes`…).
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.** Helpers main needs live outside `settings/`. settings.js may import main's modules (e.g. `onboarding-state`'s `LANGUAGES`, `i18n`'s `LANGUAGE_NAMES`).
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Run heavy checks one at a time.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. A push to an open PR cancels its CI. Omar repeated on 2026-11-23: carry on with new changes without asking.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Leg 143's choices** (Omar may overrule; each is small to change):
  - 38d2 is a dialog, not a switch in place;
  - the row's line lists both languages by their own names;
  - the dialog's line: "Menus and buttons change at once. Channel and programme names stay as your provider sends them.";
  - CI's `verify` cap is now 30 minutes.
- **For 38d3:** where the picture modes come from. The proposal is `Player.pictureModes()`, which makes the controller. The other option, listing all four modes, would show modes the TV can't play.
- **Earlier legs' choices stand** (38b, 38c1–38c4, 38d1; see RELAY).
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar's word.** His own Samsung session has started on a 2020 Tizen TV (see Status). That session also covers step 38's pad, "Set a PIN" on the done screen, "Use your phone" with a real phone, the new settings order and the language switch.
- **What remains after 38:**
  - 39 (clock, sleep timer, colour keys, buffer setting);
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
  - the query worker's budget;
  - the start's resume before the worker's load;
  - a VNode test of the pad;
  - the local e2e worker count under load;
  - stored guides keeping their titles' language after a language switch until their next read (38d2's known limit);
  - **new from Omar's Samsung session:**
    - the old name "Zoma" still shows in the lab on Tizen;
    - `pnpm device install tizen` fails on the package name with a space (`Lablo Lab.wgt`).

## Checks for Omar
1. **The language switch:** `artifacts/screenshots/settings-language-en.png`, `settings-language-ar.png` and `live-switched-ar.png` (in the worktree, gitignored). Nothing to decide unless he wants other words on the dialog.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once and look at the new order;
  - switch the language in Settings both ways;
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
