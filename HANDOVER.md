# Zoma IPTV: relay leg 49 opening prompt

You are leg 49 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–47 did steps 1–20c2b, 22a and 22b1, except step 16's Samsung part, 19b and 21 (PRs #1–#46).
- **Leg 48 split step 22b2 (the guides screen) into 22b2a and 22b2b, and did 22b2a, the screens:**
  - It merged as PR **#47** (merge commit **`c800431`**, branch kept).
  - CI on `7bb789b`: verify 8 m 57 s, media 11 m 8 s, engines 13 m 29 s, all green on the first run.
  - Main's CI on `99d7999` (PR #46) was checked: green. Main's CI on `c800431` was still running when leg 48 ended.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 22b2b, the guides screen's full e2e and checklist (RELAY.md, Phase 6)
RELAY.md's 22b2b entry has its `Done when:`. In short:
- **e2e by keys against the mock, in English and Arabic** (extend `e2e/guides.spec.ts`; leg 48's test is English only):
  - move a guide (add two first, e.g. `<host>/epg/guide.xml` and `<host>/epg/guide.xml.gz`, then Move up/down from the row menu);
  - remove one;
  - a link that fails shows why: `<host>/epg/missing.xml` gives a 404 (Fastify's unknown route), so the row's `data-status="failed"`, `data-code="http"` and the failure line "Couldn't read it: the server answered with error 404.". A playlist link (`<host>/get.php?...&type=m3u_plus`) should give `format`;
  - the profile read back (`storedProfile` in the spec);
  - the screen inside the safe area (like `live.spec.ts`'s `layout()`).
- **Screenshots looked at** in both languages: in Arabic, the links (`dir=ltr`) should sit on the right, the header's "Add a guide" on the left, and the row menu's buttons should read right to left.
- **Then:** `pnpm verify` green, the PR merged, and the "press these keys" checklist in the handover (a draft is below).
- If something in the screens needs fixing, fix it here (unit tests and the mutation template `artifacts/mutate22b2a.py` cover them).

1. **Check for existing work first:** `git log --oneline -15`, and look at `e2e/guides.spec.ts`.
2. **What 22b2a built** (architecture.md §1.5 "Built in step 22b2a" has it all):
   - **The way in:** the live screen's header ends with "Settings" (zone `header`, testId `live-settings`). UP from the first row of the rail, the list or "Try again" gets there. DOWN and Back go back to the zone and row it came from (`lastBody`). OK calls `LiveOptions.openSettings`.
   - **The settings screen** (`apps/tv/src/settings/settings-state.ts`): screen `settings`, zone `items`, with one row, "TV guides" (testId `settings-guides`).
   - **The guides screen** (`guides-state.ts`): screen `guides`, zones `add` (the header's "Add a guide", testId `guides-add`) and `guides` (rows `guide-<i>`: `data-kind` mine/source, `data-src`, `data-status` read/failed/reading/unread, `data-until`, `data-matched`, `data-wanted`, `data-code`; children `guide-<i>-link`, `-status`, `-failure`).
   - **The menu** (`guide-menu`, zone `actions`): buttons `guide-menu-up|down|remove|cancel`; Move up/down appear only where the guide can go.
   - **The add form** (`guide-add`): zone `field` (the input's DOM id is `guides-link`; the root's `data-editing` names it while typing), then zone `actions` (`guide-add-confirm`, `guide-add-cancel`). Done moves to "Add".
   - **The root** `settings-screen` has `data-pending` (reads, edits and refreshes in flight; wait for 0 with `settled(root)`), `data-editing` and the focus attributes.
   - **Each change:** `editProfile` → read → `refreshNow` (`reading` > 0, so a guide with nothing stored shows "Reading…") → read.
   - **Ids:** `g<n>` (`nextGuideId`).
3. **Sizes:** main 294.5 KB (Tizen) / 281.9 KB (webOS) of 500; query worker 99.6 KB, EPG worker 115.6 KB, ingest worker 126.0 KB, each of 150. If you change a TV file, count core-js modules with `artifacts/poly-count20c2a.py` (`python -I -u`); it should stay at 219 on both.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: steps 22b2, 22b2a and 22b2b; the progress-log rows for legs 46–48.
3. `docs/architecture.md` §1.5: "Built in step 22b2a" (the newest) and "Built in step 22b1".
4. The code: `apps/tv/src/settings/` (`guides-state.ts`, `settings-state.ts`, `SettingsScreen.tsx`, `settings.css`), `apps/tv/src/live/live-state.ts` (the header zone), `LiveApp.tsx`, `main.tsx` (`createSettings`).
5. Tests: `e2e/guides.spec.ts`, `e2e/live.spec.ts` (`layout()`, `shot`), `e2e/onboard.ts` (`addXtreamAndWatch`, `settled`, `trackErrors`), `e2e/remote-driver.ts`, `apps/tv/src/settings/guides-state.test.ts`.
6. Memory:
   - `iptv-ui-test-gotchas`;
   - `iptv-mock-provider-gotchas`;
   - `iptv-css-pipeline-gotchas`;
   - `iptv-parser-test-patterns`;
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv` (the run on `c800431`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `5ffb59f` ("docs: record PR #47's merge"). It is pushed, and the tree is clean.
- **main** has `c800431` (PR #47). The branch is ahead by `5ffb59f` and the handover commit, both docs; they go to main with step 22b2b's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate22b2a.py` and `.log` (the newest mutation template: 93/94, then 93/93);
    - `poly-count20c2a.py`: counts main's core-js modules (219 on both);
    - `verify22b2a.log`;
    - `screenshots/live-header-en.png`, `guides-en.png`, `guides-add-en.png`, `guides-added-en.png`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 48 (step 22b2a)
- **Remove has no confirmation.** A guide is one link away from coming back, and a re-added guide gets a new id and is read at once. Change it only if Omar asks.
- **A link already on the screen is refused**, a source's own guide (a panel's `xmltv.php`, which holds its login) included. That is why leg 48's e2e adds `/epg/guide.xml`: the mock's `xmltv.php` link equals the panel's own guide.
- **The mock's guide matches 11 of the 12 live channels**, so a read guide says "Channels matched: 11 of 12 (92%)".
- **The settings screens paint instead of the live screen** (`SETTINGS_SCREENS` in LiveApp), as the player does. The guides screen's `Screen` is held in a signal (`guides.screen`), because `nav.top` is the dialog while the menu or the form shows.
- **Main grew 17.5 KB:** about 6.6 KB is the 32 new strings in each catalog (terser's `ascii_only` writes each Arabic letter in 6 bytes), about 11 KB is the screens. There are no new polyfills.
- **Checks:** 3,518 unit tests (+188: 60 of the screens' own, 128 from the catalog test's per-key checks); `pnpm verify` green (65 e2e); mutation 93/93.

## How Omar can see step 22b2a (the draft of 22b2b's checklist)
Run `pnpm mock`, then `pnpm dev`, then open the dev URL.
1. **Onboard:** Xtream, server `localhost:8080`, user `zoma`, password `zoma-test`, then "Start watching".
2. **Open the guides screen:** on the live screen, press **UP** to reach "Settings" (top right), then **Enter**. Press **Enter** on "TV guides". The panel's own guide shows: `localhost:8080/xmltv.php`, "From localhost", its end and "Channels matched: 11 of 12 (92%)".
3. **Add a guide:**
   - **UP** to "Add a guide", then **Enter**. **Enter** again to type `localhost:8080/epg/guide.xml`, then **Enter** (the focus moves to "Add"), then **Enter**.
   - The new guide comes first, focused, "Added by you". It says "Reading…", then its end and match rate.
4. **Move and remove:**
   - With one guide of your own, its menu offers only Remove and Cancel (the panel's guide has no menu).
   - Add a second guide (`localhost:8080/epg/guide.xml.gz`). **Enter** on it, then "Move up": it goes first, with the focus.
   - **Enter** on a guide, then "Remove".
5. **A link that fails:** add `localhost:8080/epg/missing.xml`. It reads "Couldn't read it: the server answered with error 404.".
6. **Back out:** Escape twice returns to the live screen's header; **DOWN** goes back to the list.

The step-20 player checklist is in the leg-45 handover: `git show b3c53af:HANDOVER.md`.

## Gotchas and lessons
**New in leg 48** (also in memory):
- **ar-SA formats Western digits** (ADR-011): Arabic text reads `1 من 3 (33%)`. A test that expects Arabic-Indic digits fails.
- **e2e text checks need `stripIsolates`** (`packages/core/src/bidi`) on `textContent`: every argument (dates, times, percents) comes wrapped in marks and isolates. `e2e/guides.spec.ts` has `plainText()`.
- **A cleanup can make another guard dead.** Dropping `place()` from `open()` left a "not while loading" check that no caller could reach; it was the mutation run's one survivor. After removing a call, re-check the guards in the function it called.
- **A held test fake that throws inside its `resolve` must route the throw to `reject`.**
- **`pathlib.write_text` on Windows writes CRLF.** Git warns, and the repo still gets LF.
- **A `python -c` memory append lost a `\n` escape.** Use Edit for any line with a backslash.

**From earlier legs (still true):**
- **Patch scripts:** write every multi-line patch script to `$CLAUDE_JOB_DIR/tmp` (Write tool, or a `cat > … <<'EOF'` with no apostrophes inside), then run `python -I <script> "<wt>"`. A multi-file patch that stops at its first miss may already have written earlier files: check `git status` before rerunning it.
- **Waiting for CI:** first read `gh pr checks N -R Omarmarei/zoma-iptv` with an `until … grep -q -E "pending|pass|fail"` loop (right after `gh pr create` it says "no checks reported"). Then wait with a foreground `until ! gh pr checks N … | grep -q -E "pending|in_progress|queued"; do sleep 30; done` and `timeout: 600000`. It moves to the background at 10 min, which is fine. A bare `sleep 25; gh …` is blocked. Never `&&` on gh's exit code (it is non-zero on a failed check).
- **Playwright's page clock** (`e2e/refresh.spec.ts`): `page.clock.install()` before `page.goto`; `page.clock.fastForward('02:01:00')` fires each due timer once. The workers and the mock keep the real clock.
- **Counting what the app asks the mock:** `app.addHook('onRequest', …)` before `listen(app)`. Switch scenarios with `app.mockState.scenario = null`.
- **Mutation lessons:**
  - write the mutation list first, and remove masked guards before the run;
  - the navigator clamps `focus(-1)`: test a gone item whose row still exists;
  - `splice` rounds and clamps its index by itself;
  - a signal set to a new array redraws the screen anyway, so a `bump()` beside it is masked.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files; the mutation run swaps them). Docs are safe.
- **Local e2e flakes on a busy PC:** the throttled test, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it.
- **TV bundle polyfills:**
  - a field or member named `at` pulls `Array.at` polyfills;
  - a `Uint8Array` in a TV file pulls 35 core-js modules;
  - avoid `JSON.stringify`, `new RegExp` and `.split(`;
  - avoid object rest and array destructuring in worker code;
  - count main after any TV-file change (219).
- **Test literals:** every hand-built mock `Account` needs `outputFormats`; every hand-built `PlayerEngine` needs `caps.fits` and `setFit`; an `EpgRefreshResult` needs `reranked: []`; failed outcomes need `status: null`.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs; Arabic catalog text needs an Arabic letter and has no Latin words of its own;
  - provider text, URLs and technical names use `dir=auto`/`dir=ltr` + `translate=false`, or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`;
  - the app imports only types from `@zoma/data` (values from narrow entries like `@zoma/data/client`; tests may import values);
  - a new screen root needs `data-screen/zone/index`;
  - a new profile shape needs a migration in `PROFILE_MIGRATIONS`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,518 unit tests, `pnpm verify` (65 e2e), mutation 93/93, the polyfill count (219 on both platforms).
  - PR #47's CI green on all three jobs; merged as `c800431`.
  - Main's CI on `99d7999` green.
  - Screenshots looked at in English: the header, the guides screen, the add form, the added guide.
- **Not done:**
  - Main's CI on `c800431` is unchecked.
  - The guides screen hasn't been seen in Arabic, or with a failed, moved or removed guide, in a browser: that is 22b2b.
  - The 3 → 4 profile migration and the screens have never run on a TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:**
    - S10, including the codes of the audio, subtitle and picture-size keys;
    - S11 by ear;
    - S5's suspend and soak;
    - the player itself (step 21): 50 rapid zaps, a soak with stalls, and launch-to-frame from the marks.
- **Later, from the spikes:**
  - an on-screen keyboard of our own if the TV keyboards fail (S10; the guides screen's link field depends on it too);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung);
  - the last frame kept while reconnecting;
  - step 38's settings rows (track languages, subtitle style, picture mode) on the new settings screen;
  - parsing subtitle files off the main thread.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41); whether a low-tier TV holds refreshes while it plays (step 41); the catalogs as a UTF-8 file if they keep growing (each Arabic letter costs 6 bytes in main.js).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 48 was the 48th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks; Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-seven CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: onboarding or the live screen, `?screen=hello|gallery`, `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk, the focus agreement, the lab runs;
  6. a Conventions line on UI text (`appI18n`, `zoma/no-hard-coded-text`, `isolateText`, `TextField`/`createTextEditor`);
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__`, the `throttled` project;
  8. the `build:tv` row's lab target, `pnpm device … --lab`, and the platform-globals line;
  9. a `pnpm lab:scale` row, and the mock row's `/__lab/source` and `/__lab/guide.xml.gz`;
  10. the `Platform` calls from step 15b2 (`setScreenSaver`, `screenReader`, `speak`);
  11. `Platform.registerKeys()` returns a `KeyRegistration`;
  12. a `pnpm lab:media` row, and the mock row's `/__lab/media`;
  13. platform-tizen's AVPlay typing, platform-webos's `webosSelectTrack`, the new leak markers, `apps/tv/src/lab/fakes.ts`;
  14. the `pnpm device` row and the `.wgt` note should point at `docs/runbooks/tv-setup.md`;
  15. the webOS Simulator in Docker (`tools/engines/webos-sim/`, tv-setup.md 2.4) and the paired LG TV (`pnpm device … webos tv`);
  16. the Chromium 53 cheat sheet's heading (since ADR-012 no supported TV runs 53, but the build still targets it), and the `build:tv` row should mention the webOS ACG check (`requiredACG`, `tools/build/src/acg.ts`);
  17. a `pnpm e2e:media` row (`verify:media` is now fixtures + test:media + lab:media + e2e:media), the playback harness `apps/tv/playback.html` (`window.__ZOMA_PLAYBACK__`) in the `pnpm dev` row, and `Platform.createEngines(stage)`;
  18. platform-tizen's `AvplayEngine` and `createRedirectProbe` (`Platform.resolveUrl`), `FallbackEngine` in `player`, and the `ZOMA_E2E_MEDIA=1` switch for running one `playback-media` test locally;
  19. the player in the app (`apps/tv/src/player`: the stage, `appPlayer`, the keys) in the `pnpm dev` row, the query worker's `account` call, and `e2e/player-media.spec.ts` in the `e2e:media` row;
  20. the desktop keys `a` (audio) and `c` (subtitles) in the `pnpm dev` row's key list, and the `AUDIO`/`SUBTITLES` intents (Tizen MTS/Caption) next to the remote-keys note;
  21. the mock row's `/subtitles/<u>/<p>/<id>.<eng|ara>.<srt|vtt>[?charset=windows-1256]`, and the playback harness's subtitle calls (`externalSubs`, `selectText`, `setSubtitleDelay`, `setSubtitleSize`) in the `pnpm dev` row;
  22. the `pnpm dev` row should say a relaunch plays the last channel (profile v3's `player` section), the `zoma:*` User Timing marks, and `createPlatform({ redirects })`;
  23. the mock row's `output_formats` per account and the HLS-only `hls` account; the `pnpm dev` row's "Stream info" button;
  24. the `pnpm dev` row's "Picture" button (Fit, Zoom, Stretch, 4:3; kept in the profile), and the engines' `setFit`/`caps.fits` beside `setRect`;
  25. the `pnpm dev` row should say the app refreshes stale catalogs (12 h) and due guides by itself, from 15 s after the live screen opens (`refresh-scheduler.ts`), and the `pnpm e2e` row should name `page.clock` in `refresh.spec.ts`;
  26. the Conventions line on profile migrations should name version 4 (the guide list);
  27. **new:** the `pnpm dev` row should name the header's "Settings" → "TV guides" (`apps/tv/src/settings`), and the mock row its `/epg/guide.xml` link for adding a guide.
- **Secrets:** none pending.
