# Zoma IPTV: relay leg 45 opening prompt

You are leg 45 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–43 did steps 1–20c1, except step 16's Samsung part and its by-hand TV checks, and 19b (PRs #1–#42).
- **Leg 44 split step 20c2 into 20c2a and 20c2b, and did 20c2a:** the account's `allowed_output_formats` and the stream info.
  - It merged as PR **#43** (merge commit **`4982437`**, branch kept).
  - CI on `cf2afea`: verify 10 m 23 s, media 12 m 16 s, engines 14 m 2 s, green on the first run.
  - Main's CI on `3cf09a1` (PR #42) was checked: green. Main's CI on `4982437` was still running when leg 44 ended.
- **Steps 16 and 19b stay open** until Omar says the Samsung route is ready or has time at the TV.

## Your step: 20c2b (RELAY.md is the spec)
RELAY.md, step 20c2b: aspect/zoom (`setRect`, and the `<video>`'s and AVPlay's fit), where it lives and whether the profile keeps it, and **the full player click-through checklist** in your handover (20a + 20b1 + 20b2b + 20c1 + 20c2a, below, plus 20c2b's own rows).

**Done when:** unit tests, e2e of aspect/zoom, the PR merged, the full checklist in the handover. Split it if it looks big, and record the split in RELAY.md.

1. **Check for existing work first:** `git log --oneline -50`; grep `setRect`, `objectFit`, `object-fit`, `aspect`, `zoom`, `PictureSize`, `setDisplayMethod` under `packages/` and `apps/tv/src`. **What exists today:**
   - `setRect(r | 'full')` on every engine, called by nothing in the app.
     - Html5Engine moves the `<video>` by CSS (`left/top/width/height`); no `object-fit` is set, so the picture is letterboxed (contain).
     - AvplayEngine keeps the rect and calls `setDisplayRect` (1920×1080 space) at open and on change. A refused rect leaves the picture where it was.
     - FallbackEngine passes it to both.
   - `setDisplayMethod` is **not** in `packages/platform-tizen/src/avplay.ts`'s typing. Check Samsung's AVPlay reference page (linked in that file) for its display modes before relying on any. Whether AVPlay takes a rect outside 1920×1080 (a crop by rect) is unknown until a TV run.
   - The stream info's `controller.stats()` gives the picture's natural `width`/`height` (needed to compute a 4:3 or a zoom rect).
   - The info bar has three buttons (`ACTIONS = 3`: "Previous channel", "Audio and subtitles", `STATS_ACTION` = "Stream info").
   - Samsung's `PictureSize` key would need a new intent (S10's battery then asks every TV for it).
   - The profile is v3 (`player` section, `PlayerChange` edits). A new field needs a migration, or an optional field the reader tolerates.
2. **Decide and record** in architecture.md §2, under a new "Built in step 20c2b" heading: which modes (fit/contain, fill/stretch, zoom/crop, 4:3?), how each maps to the `<video>` (CSS `object-fit`, which Chromium 53 has) and to AVPlay, where the control lives (a fourth info bar button that cycles, or a row in a menu), and whether the profile keeps it (global, or per channel).

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`:
   - step 20 and its splits (20a … 20c1, 20c2a; 20c2b open);
   - the progress-log rows for legs 39–44.
3. `docs/architecture.md` §2: "Built in step 20a", "20b1", "20b2b", "20c1" and **"20c2a"**.
4. The code:
   - `apps/tv/src/player/` (`player-state.ts`, `PlayerScreen.tsx`, `stream-info.ts`, `StreamInfoPanel.tsx`, `player.css`, `track-menu.ts`, `player-memory.ts`);
   - `packages/player/src/engine.ts`, `html5-engine.ts`, `controller.ts` (`stats()`);
   - `packages/platform-tizen/src/avplay-engine.ts` and `avplay.ts`;
   - `packages/data/src/profile.ts`.
5. The e2e: `e2e/player.spec.ts` (the stream info by keys, en and ar), `e2e/player-media.spec.ts`.
6. Memory:
   - `iptv-tv-bundle-polyfills`;
   - `iptv-ui-test-gotchas`;
   - `iptv-parser-test-patterns`;
   - `iptv-playwright-chromium-media`;
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `4982437` was in progress when leg 44 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`.** Leg 44 slipped once (`cd "$W" 2>/dev/null;` at the head of a Bash call): the harness then made the worktree the session's primary directory. Harmless, but don't.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `7f11d3d` ("docs: record PR #43's merge"). It is pushed, and the tree is clean.
- **main** has `4982437` (PR #43). The branch is ahead by `7f11d3d` and the handover commit, both docs; they go to main with 20c2b's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate20c2a.py` and `.log` (the newest mutation template: one test list per file);
    - `poly-count20c2a.py`: counts main's core-js modules from Rollup's module table (219 on both platforms now);
    - `verify20c2a.log`, `e2emedia20c2a.log`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 44 (step 20c2a, architecture.md §2 "Built in step 20c2a")
- **The formats:**
  - They live in `SourceMeta.outputFormats`, beside the panel's `server` facts. They are the account's facts, so they stay out of the profile (the user's backed-up document).
  - Every Xtream login writes them, an unchanged refresh included. Playlists have none.
  - `DataEngine.outputFormats()` reads them when the live screen opens (`main.tsx`'s `showLive`). `createPlayer({ outputFormats })` gives them to `liveRequest(row, formats)` on every play.
  - The start's last channel plays before they are read: both forms are tried there, the remembered one first.
- **The mock:** `output_formats` per account (default `m3u8, ts`); a live stream in another format gets 403. The new `hls` / `hls-test` account allows HLS only.
- **EngineStats** gains:
  - `decodedFrames` and `decodedBytes` (the `<video>`: `getVideoPlaybackQuality`, else Chromium's `webkit*` counters);
  - `videoCodec`, `audioCodec` and `audioChannels` (AVPlay's `fourCC` and channels).
  - `NO_STATS` is exported from `@zoma/player`.
- **`PlayerController.stats()`:** the engine's figures plus `container`, `engine` and `load` (the token). It is `null` unless playing, paused or buffering.
- **The stream info panel** (`stream-info.ts`, `StreamInfoPanel.tsx`):
  - **Control:** the info bar's third button toggles it. It stays through zaps and goes when the player closes; the error card replaces it.
  - **Reading:** it reads every second (`STATS_MS`) and measures fps and bitrate over the last 6 readings of one load. A declared bitrate wins.
  - **Where:** the top-start corner, under the "Reconnecting…" badge (`.player__top`).
  - **Rows:** Resolution, Frame rate, Bitrate, Video, Audio, Format (from the status), Player, Dropped frames. Rows with no figure are left out.
  - **Catalogs:** `player.streamInfo`, `player.info.*`.
- **A flaky property test fixed:** `normalize.test.ts`'s word filter missed `x264` (a test-generator fix only; `matchName` is unchanged).
- **Checks:**
  - 3,218 unit tests;
  - `pnpm verify` (61 e2e) and `pnpm e2e:media` (9) green;
  - mutation 53/53 (51/53 first run);
  - main 270.4 KB (Tizen) / 258.3 KB (webOS) of its own code, 219 core-js modules;
  - `verify:engines` left to CI (green).

## The player checklist for Omar (20b1 + 20b2b + 20c1 + 20c2a; 20c2b adds its rows and makes it the full click-through)
**Setup:** two terminals, `pnpm mock` in one and `pnpm dev` in the other. Run `pnpm mock:media` once first, for real pictures.

### The menu in the app
Open http://localhost:5173 and onboard with server `localhost:8080`, user `zoma`, password `zoma-test`. Then press "Start watching".

**Keys:** Enter = OK, Escape = Back, the arrows, `a` = the audio key, `c` = the subtitle key, `s` = STOP, PageUp/PageDown = CH±.

1. **ArrowDown, Enter:** the player opens. **ArrowRight, Enter** on "Audio and subtitles": the panel opens on the right, the info bar hides, and the focus is on the subtitles' "Off".
2. **Escape:** the panel closes. The bar comes back with "Audio and subtitles" focused, still at the bottom of the screen.
3. **`c`:** the panel opens on the subtitles. **`a`** closes it when there is no audio list.
4. **`a`, then `s`:** the menu and the player both close, and you are back on the channel list.
5. **Arabic** (`?locale=ar-SA` on a fresh profile): the panel is on the left.

### The start on the last channel (20c1)
6. **ArrowLeft** to the rail, **ArrowDown** to "Test News", **Enter**. Then **ArrowDown, ArrowDown, Enter**: the third channel plays. **PageUp**: the fourth.
7. **Reload the page (F5):** the player opens at once on that fourth channel, with its name in the bar.
8. **PageDown:** the third channel. **Escape:** the live screen shows "Test News" with the third row focused.
9. **Reload again:** the third channel plays at once.
10. **Arabic** (`?locale=ar-SA` on a fresh profile): the same.

### The stream info (20c2a)
11. **On "All channels", Enter** on the first channel. Then **ArrowRight, ArrowRight, Enter** on "Stream info": a panel at the top-left. It says "Waiting for the picture…" and Format, then (with the generated media) Resolution 960×540, Frame rate about 25 fps, a Bitrate, Format HLS, Player HTML5 and Dropped frames.
12. **Press 6:** the HD sports channel. The panel stays and shows 1280×720 at about 50 fps.
13. **Enter on "Stream info" again:** the panel goes (press an arrow first if the bar has hidden). **Escape, then Enter on a channel:** the player opens without the panel.
14. **Arabic** (`?locale=ar-SA` on a fresh profile): the panel is at the top-right, with Arabic units (إطار/ث, كيلوبت/ث).

### The account's output formats (20c2a)
15. **On a fresh profile** (a private window), onboard with user `hls`, password `hls-test`, and play two channels. In DevTools' Network tab, filter on `/live/`: only `.m3u8` requests, never `.ts`.

**Not reachable in the app yet:**
- **Subtitle files:** no live channel has one, so the menu's file rows, its "Subtitle style" rows and the kept subtitle size first appear with VOD (step 26), or on a Samsung TV for embedded subtitles (19b and 21).
- **The audio choice after a relaunch:** desktop Chromium needs its Blink flag to list audio tracks. `pnpm e2e:media` covers it.
- **Codecs and audio channels in the stream info:** only AVPlay names them (a Samsung TV).

### The subtitles themselves: the playback harness
Open http://localhost:5173/playback.html, then the DevTools console (F12), and paste:

```js
const m = 'http://localhost:8080', a = 'zoma/zoma-test';
__ZOMA_PLAYBACK__.play({ url: `${m}/movie/${a}/206.mkv`, mode: 'vod', externalSubs: [
  { lang: 'eng', url: `${m}/subtitles/${a}/206.eng.srt`, fmt: 'srt' },
  { lang: 'ara', url: `${m}/subtitles/${a}/206.ara.srt?charset=windows-1256`, fmt: 'srt' } ] });
```

16. **`__ZOMA_PLAYBACK__.selectText('ext:0')`:** "English subtitle 00:05" and the rest appear bottom-centre, a new one every 5 s, each naming the time burned into the picture.
17. **`__ZOMA_PLAYBACK__.setSubtitleDelay(-5000)`:** each cue names 5 s ahead of the picture. `setSubtitleDelay(0)` puts it back.
18. **`__ZOMA_PLAYBACK__.selectText('ext:1')`:** the old Windows-1256 Arabic file reads correctly from right to left.
19. **`__ZOMA_PLAYBACK__.setSubtitleSize('l')`:** larger. `'s'` is smaller.
20. **`__ZOMA_PLAYBACK__.selectText(null)`:** the subtitles go.

## Gotchas and lessons
**New in leg 44** (also in memory):
- **A Monitor loop on `gh pr checks` must not `&&` on gh's exit code:** gh exits non-zero on a failed check, so an `until out=$(gh …) && ! grep pending` loop never ends. Use this:
  - `while gh pr checks N -R Omarmarei/zoma-iptv 2>&1 | grep -q -E "pending|in_progress|queued"; do sleep 60; done; gh pr checks N -R Omarmarei/zoma-iptv 2>&1 | awk '{print $1, $2, $3}'`
  - Read `gh pr checks N` once in the foreground first.
- **Mutation:** a second reset condition can mask the one under test. Here the byte counter falling hid the load check; give the new load counters past the old ones. Write the mutation list before running it (artifacts/mutate20c2a.py).
- **A fast-check filter that copies the code's token set by hand must list every token the pattern can spell** (`x264` failed `pnpm verify` 41 legs after it was written).
- **A field named `at` would pull `Array.at` polyfills again:** the reading's field is `time`. Count main with `artifacts/poly-count20c2a.py` after any TV-file change (219 is the number to keep).
- **Every hand-built mock `Account` literal in tests needs `outputFormats`.**
- **Playwright's Chromium has every `<video>` decode counter.** A file probe needs `page.goto('file:///…html')`; `setContent` with a `file:` src never loads.
- **The relay context check fired at about 450k tokens,** during the handover again. Split 20c2b early if it grows.

**From earlier legs (still true):**
- **`pnpm e2e:media` is two specs,** `playback-media.spec.ts` and `player-media.spec.ts`. Run all of it when what `PlayerController` publishes changes. One test alone: `ZOMA_E2E_MEDIA=1 pnpm exec playwright test e2e/player-media.spec.ts --project=playback-media -g "<name>"`.
- **Desktop Chromium's native HLS lists muxed TS audio as one unnamed track.** Route the live URL (`page.route(... 302 → MKV 206)`) for app-level track e2e.
- **A `Uint8Array` in a TV file pulls 35 core-js modules;** a `DataView` none.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files; the mutation run swaps them). Docs are safe.
- **Long Bash heredocs with Python patches:** Write multi-line scripts to `$CLAUDE_JOB_DIR/tmp` first, then `python -I script.py`.
- **Local e2e flakes on a busy PC:** the throttled test, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it.
- **Vitest:**
  - `quiet()` for a voided load;
  - awaiting a `FakeEngine.stop()` without advancing the clock deadlocks (use `void`);
  - no `__PLATFORM__` define;
  - fake-clock settles go through `setImmediate`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs (Arabic catalog text has no Latin words of its own);
  - provider text and technical names use `dir=auto`/`dir=ltr` + `translate=false` or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(`, typed arrays, and members named like built-ins (`at`!);
  - the app imports only types from `@zoma/data` (its index drags every module's polyfills);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,218 unit tests, `pnpm verify` (61 e2e), `pnpm e2e:media` (9), mutation 53/53, the polyfill count (219 on both platforms).
  - The HLS-only e2e fails with the app's wiring removed.
  - The panel's screenshots in en, ar and on real media were looked at.
  - PR #43's CI green on all three jobs; merged as `4982437`.
  - Main's CI on `3cf09a1` green.
- **Not done:**
  - Main's CI on `4982437` is unchecked.
  - The stream info and the player were never run on a TV (codecs and channels need AVPlay).
  - The start on the last channel was never timed on a TV (step 21).
  - The kept subtitle size and the menu's file and style rows were never seen in the app (no subtitle files before VOD).
- **Migrations and deploys:** N/A (no backend until step 29). `SourceMeta.outputFormats` is an optional IndexedDB field (no migration).

## Open decisions and gates
- **20c2b's design (and any split)** is the leg's judgement; record it.
- **Steps 16 and 19b wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30 minutes at the LG TV** for S10 (the audio, subtitle and picture-size keys' codes included), S11 by ear, S5's suspend and soak, and the player itself (step 21: the marks give launch-to-frame).
- **Later, from the spikes:**
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung);
  - the last frame kept while reconnecting;
  - a settings screen for the track languages and the subtitle style (and a subtitle background setting);
  - parsing subtitle files off the main thread.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 44 was the 44th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks; Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-three CLAUDE.md gaps** are waiting for his word:
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
  23. **new:** the mock row's `output_formats` per account and the HLS-only `hls` account; the `pnpm dev` row's "Stream info" button.
- **Secrets:** none pending.
