# Zoma IPTV: relay leg 46 opening prompt

You are leg 46 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–44 did steps 1–20c2a, except step 16's Samsung part and its by-hand TV checks, and 19b (PRs #1–#43).
- **Leg 45 did step 20c2b, the picture's mode (aspect/zoom), and with it closed step 20 (the player UI):**
  - It merged as PR **#44** (merge commit **`76e610f`**, branch kept).
  - CI on `50a7140`: verify 8 m 41 s, media 20 m 59 s, engines 14 m 13 s, green on the first run.
  - Main's CI on `4982437` (PR #43) was checked: green. Main's CI on `76e610f` was queued when leg 45 ended.
  - The full player click-through checklist for Omar is below.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Step 21 (the player on a TV) is the next step in order, but it is `[needs Omar]`: leave it open, as legs did with 16 and 19b.

## Your step: 22, EPG sources (RELAY.md, Phase 6; architecture.md §6 "6.1")
RELAY.md step 22: "EPG source management, refresh scheduling, now/next in the list, short-EPG fallback." It has no `Done when:` line yet: write one when you plan the step, and split it if it looks big (record the split in RELAY.md).

1. **Check for existing work first.** Much of 6.1 already exists:
   - **Built:**
     - storage, the refresh (`runEpgRefresh` in the EPG worker), `epgGuides` and `epgRefreshDue` (step 9b);
     - the short-EPG fallback (`QueryService.shortEpg`, `DataEngine.focusChannel`; step 9c);
     - now/next in the live list, with the focused channel's short EPG (step 14a).
   - **Where `refreshEpg` is called today:** only the onboarding loader (`apps/tv/src/onboarding/engine-loader.ts`), the hello screen's `DataPanel.tsx` and the lab's S6. Nothing seems to schedule a refresh while the app runs or at a later start. Confirm that with a grep of `refreshEpg`, `epgRefreshDue`, `due:` and `refreshCatalog` under `apps/tv/src`.
   - **The user's own guide:** onboarding has a "guide" phase for a typed XMLTV link (step 13b). Find where that link is kept (`UserGuide`, the profile's sources or onboarding answers) and whether anything can list, add, remove or reorder guides after onboarding.
   - Also run `git log --oneline -50`.
2. **What probably remains (decide and record it, in architecture.md §1.5 under a new "Built in step 22" heading):**
   - **Refresh scheduling in the running app:** at the start when due, every 12 h while it runs (or when under 24 h of programmes remain), after a catalog refresh, and never at the same time as a catalog ingest on a low-tier TV (§1.5). The live screen's now/next should update after a refresh.
   - **EPG source management:** a screen that lists the guides (each source's own, the user's), their state (programmes until, match rate, last failure), and lets the user add, remove and order XMLTV URLs. No settings screen exists yet: decide where it lives (a first settings screen, or a screen from the live screen's rail or header) and keep it small.
   - **The catalog's own refresh schedule** may be missing too; it is not 6.1's job, but note what you find.
3. **Sizes:** the query worker is about 99 KB and the EPG worker 115 KB of 150 KB; main is 272.9 KB (Tizen) / 260.3 KB (webOS) of 500. Count core-js modules after any TV-file change (219 on both).

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`:
   - steps 9, 9b, 9c, 14a and 22 onwards;
   - the progress-log rows for legs 13, 14, 24 and 41–45.
3. `docs/architecture.md`:
   - §1.5 (the EPG pipeline: "Built in step 9", "9b", "9c");
   - §1.2's "Built in step 14a" (the live screen);
   - §2 "Built in step 20c2b" (the newest, for the shape of a "Built in" note).
4. The code:
   - `packages/data/src`: `epg-sources.ts`, `epg-service.ts`, `epg-ingest.ts`, `short-epg.ts`, `query-service.ts`, `profile.ts`;
   - `apps/tv/src/data/engine.ts`, `apps/tv/src/main.tsx`, `apps/tv/src/live/live-state.ts`, `apps/tv/src/onboarding/engine-loader.ts`.
5. Tests: `test/epg-ingest-mock.test.ts`, `test/short-epg-mock.test.ts`, `test/tv-data-engine.test.ts`, `e2e/live.spec.ts`.
6. Memory:
   - `iptv-data-layer-test-gotchas`;
   - `iptv-mock-provider-gotchas`;
   - `iptv-tv-bundle-polyfills`;
   - `iptv-ui-test-gotchas`;
   - `iptv-parser-test-patterns`;
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `76e610f` was queued when leg 45 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call (leg 45 slipped once with `cd /d 2>/dev/null;`; it failed harmlessly).
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `413978a` ("docs: record PR #44's merge"). It is pushed, and the tree is clean.
- **main** has `76e610f` (PR #44). The branch is ahead by `413978a` and the handover commit, both docs; they go to main with step 22's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate20c2b.py` and `.log` (the newest mutation template: one test list per file);
    - `poly-count20c2a.py`: counts main's core-js modules from Rollup's module table (219 on both platforms);
    - `verify20c2b.log`, `e2emedia20c2b.log`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 45 (step 20c2b, architecture.md §2 "Built in step 20c2b")
- **The modes:** Fit (the default), Zoom, Stretch and 4:3. Each is a rect on the 1920×1080 screen and a fit in it (`packages/player/src/picture.ts`):
  - Fit: `contain`;
  - Zoom: `cover` (a crop), on the `<video>` only;
  - Stretch: `fill`;
  - 4:3: `fill` in a 1440×1080 window in the middle (`FOUR_THREE`, `setRect` 240, 0, 1440, 1080).
- **The engines:** `PictureFit`, `EngineCaps.fits` and `setFit`. The engines keep the rect and the fit for every later load.
  - The `<video>`: CSS `object-fit`.
  - **AVPlay:** `setDisplayMethod` (`PLAYER_DISPLAY_MODE_LETTER_BOX` for contain, `FULL_SCREEN` for fill), called at every open after `setDisplayRect` and on a change. Samsung's reference says:
    - `setVideoRoi` (a crop) is for signage (LFD) only and throws `NotSupportedError` in a TV app;
    - `setDisplayRect` refuses negative values;
    - so AVPlay can't zoom.
    - `AUTO_ASPECT_RATIO` ("from the DAR/PAR") is untried: step 21 decides whether it beats the letterbox for anamorphic SD.
  - `FallbackEngine.caps.fits` is what both engines have, so Tizen offers Fit, Stretch and 4:3.
- **The controller:** `pictureModes` and `setPicture(mode)`, which answers the mode shown (Fit for one the engine lacks).
- **The control:** the info bar's fourth button, "Picture: Fit" (`PICTURE_ACTION` 3, `ACTIONS` 4). OK goes round the modes; the stream isn't touched. No remote key: a `PictureSize` intent would make S10's battery ask every TV for it.
- **The 4:3 side bars:** the player screen draws them, black (`.player__pillar`). A `<video>` smaller than the stage leaves the stage transparent around it, and the page's own colour shows there (white on the desktop). `setRect` stays "the picture's box only", for a later preview window.
- **Kept:** one mode for every channel, in profile v3's **optional** `player.picture` (no migration; a document without it reads as never set). It is given to the controller when the controller is made.
- **Checks:**
  - 3,252 unit tests;
  - `pnpm verify` (63 e2e) and `pnpm e2e:media` (10) green;
  - mutation 42/42 on the first run (two masked guards removed before it);
  - main +2.5/+2.0 KB, 219 core-js modules.

## The full player click-through checklist for Omar (step 20: 20a + 20b1 + 20b2b + 20c1 + 20c2a + 20c2b)
**Setup:** two terminals, `pnpm mock` in one and `pnpm dev` in the other. Run `pnpm mock:media` once first, for real pictures.

Open http://localhost:5173 and onboard with server `localhost:8080`, user `zoma`, password `zoma-test`. Then press "Start watching". For Arabic, use `?locale=ar-SA` on a fresh profile (a private window), or pick العربية in onboarding.

**Keys:** Enter = OK, Escape = Back, the arrows, PageUp/PageDown = CH+/CH−, the digits, `p` = PRE-CH, `i` = INFO, `a` = the audio key, `c` = the subtitle key, `s` = STOP. F5 = a relaunch.

### A. Playing and zapping (20a)
1. **ArrowDown, Enter:** the player opens. The info bar shows "2 Zoma Test 2 Clock", now/next and the clock. With the generated media the picture plays (HLS); without it, "Connecting…".
2. **PageUp three times quickly:** the bar shows each channel at once, and only the last one, "زوما تجريبي ٣" (3), opens.
3. **`5`:** after 1.5 s, "Zoma Kids Test" opens.
4. **`p`:** back to channel 3. **`p`** again: back to 5.
5. **`9`, `9`, Enter:** "No channel 99" for 2 s.
6. **Wait 5 s while it plays:** the bar hides. **`i`** shows it. **Enter** on a hidden bar only shows it; the next Enter presses the focused button.
7. **Escape:** back to the list, on the channel that played.
8. **Arabic:** the bar is mirrored (the number on the right).

### B. A broken channel (20a)
9. **Restart the mock** with `pnpm mock --scenario provider-errors`, then open channel 4 (row 6, stream 104, which answers 509). After a few seconds the error card shows "Your provider isn't sending this channel", the subscription's end, "Connections in use: 0 of 2" and the code.
10. **Enter** = Try again. **ArrowRight, Enter** = Channels.
11. **On a card, PageUp:** the card goes at once and the next channel opens.
12. **Arabic:** the card's buttons start from the right (ArrowLeft goes to "القنوات").
13. **Restart the mock** with plain `pnpm mock` before going on.

### C. The audio and subtitles menu (20b1)
14. **ArrowDown, Enter:** the player opens. **ArrowRight, Enter** on "Audio and subtitles": the panel opens on the right, the info bar hides, and the focus is on the subtitles' "Off". (Desktop Chromium lists no audio tracks, so the audio list says "Not supported on this TV".)
15. **Escape:** the panel closes. The bar comes back with "Audio and subtitles" focused, still at the bottom of the screen.
16. **`c`:** the panel opens on the subtitles. **`a`** closes it when there is no audio list.
17. **`a`, then `s`:** the menu and the player both close, and you are back on the channel list.
18. **Arabic:** the panel is on the left.

### D. The start on the last channel (20c1)
19. **ArrowLeft** to the rail, **ArrowDown** to "Test News", **Enter**. Then **ArrowDown, ArrowDown, Enter**: the third channel plays. **PageUp**: the fourth.
20. **F5:** the player opens at once on that fourth channel, with its name in the bar.
21. **PageDown:** the third channel. **Escape:** the live screen shows "Test News" with the third row focused.
22. **F5 again:** the third channel plays at once.
23. **Arabic:** the same.

### E. The stream info (20c2a)
24. **On "All channels", Enter** on the first channel. Then **ArrowRight, ArrowRight, Enter** on "Stream info": a panel at the top-left. It says "Waiting for the picture…" and Format, then (with the generated media) Resolution 960×540, Frame rate about 25 fps, a Bitrate, Format HLS, Player HTML5 and Dropped frames.
25. **Press 6:** the HD sports channel. The panel stays and shows 1280×720 at about 50 fps.
26. **Enter on "Stream info" again:** the panel goes (press an arrow first if the bar has hidden). **Escape, then Enter on a channel:** the player opens without the panel.
27. **Arabic:** the panel is at the top-right, with Arabic units (إطار/ث, كيلوبت/ث).

### F. The picture (20c2b, new)
28. **On "All channels", Enter** on the first channel (the SMPTE colour bars). **ArrowRight three times** to the fourth button, "Picture: Fit": the bars fill the screen edge to edge.
29. **Enter:** "Picture: Zoom". **Enter:** "Picture: Stretch". Both look like Fit here: every mock channel is 16:9, so there is nothing to crop or stretch. To see them work, check DevTools: Elements, `#stage video`, its style's `object-fit` is `cover`, then `fill`.
30. **Enter:** "Picture: 4:3". The bars squeeze into the middle, with black bars at both sides, and the stream plays on. **Enter:** back to "Picture: Fit".
31. **Set 4:3 again, then PageUp:** the next channel is in 4:3 too. **F5:** the player opens on that channel in 4:3, and the button says "Picture: 4:3". Set it back to Fit.
32. **Arabic:** the button is the row's leftmost: "الصورة: ملاءمة", then تكبير, تمديد and "نسبة 4:3".

### G. The account's output formats (20c2a)
33. **On a fresh profile** (a private window), onboard with user `hls`, password `hls-test`, and play two channels. In DevTools' Network tab, filter on `/live/`: only `.m3u8` requests, never `.ts`.

### H. The subtitles themselves: the playback harness (20b2b)
Open http://localhost:5173/playback.html, then the DevTools console (F12), and paste:

```js
const m = 'http://localhost:8080', a = 'zoma/zoma-test';
__ZOMA_PLAYBACK__.play({ url: `${m}/movie/${a}/206.mkv`, mode: 'vod', externalSubs: [
  { lang: 'eng', url: `${m}/subtitles/${a}/206.eng.srt`, fmt: 'srt' },
  { lang: 'ara', url: `${m}/subtitles/${a}/206.ara.srt?charset=windows-1256`, fmt: 'srt' } ] });
```

34. **`__ZOMA_PLAYBACK__.selectText('ext:0')`:** "English subtitle 00:05" and the rest appear bottom-centre, a new one every 5 s, each naming the time burned into the picture.
35. **`__ZOMA_PLAYBACK__.setSubtitleDelay(-5000)`:** each cue names 5 s ahead of the picture. `setSubtitleDelay(0)` puts it back.
36. **`__ZOMA_PLAYBACK__.selectText('ext:1')`:** the old Windows-1256 Arabic file reads correctly from right to left.
37. **`__ZOMA_PLAYBACK__.setSubtitleSize('l')`:** larger. `'s'` is smaller.
38. **`__ZOMA_PLAYBACK__.selectText(null)`:** the subtitles go.

**Not reachable in the app yet:**
- **Subtitle files:** no live channel has one, so the menu's file rows, its "Subtitle style" rows and the kept subtitle size first appear with VOD (step 26), or on a Samsung TV for embedded subtitles (19b and 21).
- **The audio choice after a relaunch:** desktop Chromium needs its Blink flag to list audio tracks. `pnpm e2e:media` covers it.
- **Codecs and audio channels in the stream info:** only AVPlay names them (a Samsung TV).
- **Zoom and Stretch on a picture that isn't 16:9:** no mock channel has one (DevTools shows the fit, row 29).
- **The picture modes on a TV:** Tizen offers Fit, Stretch and 4:3 (AVPlay can't crop); none has run on a TV yet (step 21).

## Gotchas and lessons
**New in leg 45** (the pixel one is also in memory):
- **Reading pixels in e2e:** the repo has no PNG decoder. Decode the screenshot in the page instead: base64 into `new Image()`, `await img.decode()`, draw it on a canvas, then `getImageData` (`colours()` in `e2e/player-media.spec.ts`).
- **A `<video>` smaller than the stage leaves the page's colour showing around it.** The page is transparent while the player shows (AVPlay paints under it).
- **An optional profile field needs no migration:** `picture?: string` in `PlayerMemoryDoc`, read with a fallback in `player-memory.ts`. The profile's version and its tests stay as they are.
- **Mutation:** write the list first, and remove guards another one masks before the run. `nextPicture`'s not-found branch landed on `fit` anyway, and a `typeof` check sat before `attempt()`, which swallows the error. Result: 42/42 on the first run.
- **A foreground `sleep N; cmd` is blocked** by the harness. Wait with Monitor, or with a `run_in_background` until-loop.
- **CI's `media` job took 21 min** this time (12–14 min before). The PR's checks need about 21 minutes in all.
- **The relay context check** didn't fire before the handover this time. 20c2b was the smaller half of 20c2.

**From earlier legs (still true):**
- **Waiting for a PR's checks:**
  - Read `gh pr checks N -R Omarmarei/zoma-iptv` once in the foreground first: right after `gh pr create` it says "no checks reported".
  - Then wait with `while gh pr checks N -R Omarmarei/zoma-iptv 2>&1 | grep -q -E "pending|in_progress|queued"; do sleep 60; done`.
  - Never `&&` on gh's exit code: it is non-zero on a failed check, so such a loop never ends.
- **`pnpm e2e:media` is two specs,** `playback-media.spec.ts` and `player-media.spec.ts`. Run all of it when what `PlayerController` publishes changes. One test alone: `ZOMA_E2E_MEDIA=1 pnpm exec playwright test e2e/player-media.spec.ts --project=playback-media -g "<name>"`.
- **TV bundle polyfills:**
  - A field or member named `at` pulls `Array.at` polyfills (`time`, `started`, `cuesAt`).
  - A `Uint8Array` in a TV file pulls 35 core-js modules; a `DataView` pulls none.
  - Count main with `artifacts/poly-count20c2a.py` after any TV-file change (219 is the number to keep).
- **Every hand-built mock `Account` literal in tests needs `outputFormats`.** Every hand-built `PlayerEngine` needs `caps.fits` and `setFit` (`app-player.test.ts`'s `StubEngine`).
- **Desktop Chromium's native HLS lists muxed TS audio as one unnamed track.** Route the live URL (`page.route(... 302 → MKV 206)`) for app-level track e2e.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files; the mutation run swaps them). Docs are safe.
- **Long Bash heredocs with Python patches:** Write multi-line scripts to `$CLAUDE_JOB_DIR/tmp` first, then `python -I script.py`.
- **Local e2e flakes on a busy PC:** the throttled test, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it.
- **Vitest:**
  - `quiet()` for a voided load (a stop rejects it: an "Unhandled Rejection" otherwise);
  - awaiting a `FakeEngine.stop()` without advancing the clock deadlocks (use `void`);
  - no `__PLATFORM__` define;
  - fake-clock settles go through `setImmediate`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs; Arabic catalog text needs an Arabic letter and has no Latin words of its own ("4:3" is "نسبة 4:3");
  - provider text and technical names use `dir=auto`/`dir=ltr` + `translate=false` or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(`, typed arrays, and members named like built-ins (`at`!);
  - the app imports only types from `@zoma/data` (its index drags every module's polyfills; use narrow entries like `@zoma/data/client`);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,252 unit tests, `pnpm verify` (63 e2e), `pnpm e2e:media` (10), mutation 42/42, the polyfill count (219 on both platforms).
  - The picture e2e in en and ar; the 4:3 screenshots, on the placeholder and on the real SMPTE picture, were looked at.
  - PR #44's CI green on all three jobs; merged as `76e610f`.
  - Main's CI on `4982437` green.
- **Not done:**
  - Main's CI on `76e610f` is unchecked.
  - The player (picture modes included) has never run on a TV: step 21. AVPlay's `setDisplayMethod`, and its plane outside a 4:3 rect, are untried.
  - The start on the last channel was never timed on a TV (step 21).
  - The kept subtitle size and the menu's file and style rows were never seen in the app (no subtitle files before VOD).
- **Migrations and deploys:** N/A (no backend until step 29). `player.picture` is an optional profile field (no migration).

## Open decisions and gates
- **Step 22's scope, its split and where EPG source management lives** are the leg's judgement; record them.
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:**
    - S10, including the codes of the audio, subtitle and picture-size keys;
    - S11 by ear;
    - S5's suspend and soak;
    - the player itself (step 21): 50 rapid zaps, a soak with stalls, and launch-to-frame from the marks.
- **Later, from the spikes:**
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung);
  - the last frame kept while reconnecting (AVPlay has `setVideoStillMode`);
  - a settings screen for the track languages, the subtitle style (a background setting too) and the picture mode;
  - parsing subtitle files off the main thread.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 45 was the 45th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks; Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-four CLAUDE.md gaps** are waiting for his word:
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
  24. **new:** the `pnpm dev` row's "Picture" button (Fit, Zoom, Stretch, 4:3; kept in the profile), and the engines' `setFit`/`caps.fits` beside `setRect`.
- **Secrets:** none pending.
