# Zoma IPTV: relay leg 42 opening prompt

You are leg 42 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–40 did steps 1–20b1, except step 16's Samsung part and its by-hand TV checks, and 19b (PRs #1–#39).
- **Leg 41 split step 20b2 into 20b2a and 20b2b, and did 20b2a:** the subtitle parser in `core`. It merged as PR **#40** (merge commit **`1df93ca`**, branch kept).
  - CI on `2b723f1`: verify 10 m 8 s, media 12 m 21 s, engines 14 m 21 s, green on the first run.
  - Main's CI on `853bdfb` (PR #39) was checked: green. Main's CI on `1df93ca` was still unchecked when leg 41 ended.
- **Steps 16 and 19b stay open** until Omar says the Samsung route is ready or has time at the TV.

## Your step: 20b2b, the overlay and its feeds (RELAY.md is the spec)
RELAY.md, step 20b2b:
- **The cue feed in the controller:**
  - AVPlay's `cue` events;
  - external files, timed by the media clock.
- **External files:**
  - fetched by the app, with a size cap;
  - decoded as UTF-8, else Windows-1256/1252;
  - listed in the menu's subtitles (`ext:n` ids, `TrackMemory` picks).
- **The overlay in `PlayerScreen`:**
  - size and timing offset, in memory for now;
  - `dir=auto` and `translate=false` per cue;
  - inside the safe area, under the info bar and the menu.

**Done when:**
- unit tests for the overlay's timing, the cue feed and the menu's external rows;
- an e2e of the overlay with an external SRT in `e2e:media`;
- the PR merged;
- the menu-and-subtitles checklist in the handover.

If it is too big for one leg, split it the same way: the feed and the menu rows first, then the overlay and the e2e. Record the split in RELAY.md.

1. **Check for existing work first:**
   - Run `git log --oneline -50`.
   - Grep for `externalSubs`, `SubtitleTrack`, `cueText`, `'cue'`, `ext:` under `packages/player/src` and `apps/tv/src`.
   - **What exists today:**
     - the parser (`packages/core/src/subtitles.ts`, below);
     - `PlayRequest.externalSubs` (`{ lang, url, fmt: 'srt' | 'vtt' }[]`, unused);
     - the engines' `cue` event (AvplayEngine sends `text` and `durationMs`), which the controller drops (`controller.ts`, `onEvent`, `case 'cue'`);
     - the menu's subtitle list (engine text tracks only);
     - the mock's `srtText` (`apps/mock-provider/src/media-plan.ts`), with no HTTP route of its own yet.
   - **Not done anywhere:** the feed, the fetch, the menu's external rows, the overlay.
2. **Decide and record** (in architecture.md §2 "Built in step 20b2b"). These are leg 41's suggestions, not decisions:
   - **The fetch:**
     - `ControllerOptions.loadSubtitles(url, fmt) => Promise<readonly SubtitleCue[]>` (ADR-008: the platform's work arrives as callbacks). The app implements it with `fetch` and `arrayBuffer`.
     - Cap the size: 4 MB is a suggestion. Check the length header and the bytes.
     - Decode as UTF-16 when there is a BOM, else `TextDecoder('utf-8', { fatal: true })`, else `windows-1256` for Arabic (or an unknown language), else `windows-1252`. Chromium 38+ has these labels, so the old engines have them.
     - Then call `parseSubtitles(text, { format: fmt })`.
     - Load each file once per play session.
   - **The menu rows:** the external files join `status.tracks.text` after the engine's tracks:
     - ids `ext:0`, `ext:1`…;
     - `lang: normalizeLang(sub.lang)`, `streamLang: sub.lang`, `label: ''`.
   - **Choosing a file:** `selectText('ext:n')` turns any embedded track off (`engine.selectText(null)`), loads the file and starts the feed. `TrackMemory` remembers the pick like any other (`findPick` matches id, language and label). The text list works even where `switching` is `none`: only the audio list says "Not supported".
   - **The feed:** a separate subscription (e.g. `subscribeCues(listener)`), not `status`, so the status doesn't churn. Read it in two ways:
     - **External files:** every ~250 ms, `engine.positionMs() + offset`, then `SubtitleTrack.cuesAt`. Publish only when the texts change.
     - **AVPlay `cue`:** `cueText(e.text)` for `durationMs` (a clock timer clears it). Only when an embedded track is selected and `caps.deliversSubtitleText`. The offset can't make an AVPlay cue earlier: apply the offset to files only, and say so.
     - Drop everything on a zap, a stop, a retry and `hide()`, keyed by the load token or the session.
   - **The overlay:**
     - a hook-free component (`packages/ui` rule, if it goes there) or an app component in `apps/tv/src/player/`;
     - bottom-centre in the safe area, lifted above the info bar while the bar shows;
     - each cue a block with `dir=auto` and `translate=false`, lines by `white-space: pre-line`;
     - a text shadow or a scrim;
     - physical CSS only (postcss-rtlcss mirrors it);
     - sizes S/M/L.
   - **Size and offset:** keep them small. One idea: a third zone in the track menu with "Size" and "Timing" rows changed by LEFT/RIGHT, shown only while a subtitle is on. Keep it in memory until the profile (20c or settings).
   - **The e2e:**
     - VOD reaches the app only in step 26, and `window.__ZOMA_TEST__` is read-only by design.
     - **Options:**
       - a mock route serving `srtText` (the mock sends `access-control-allow-origin: *` on every response unless a fault plan says `noCors`), plus the playback harness (`apps/tv/playback.html`, `window.__ZOMA_PLAYBACK__.play`, which already takes a `PlayRequest`-like input), mounting the overlay there;
       - or a dev-only way to give a live channel's request `externalSubs`.
     - **Media clock:** the MKV routed in for channel 104 (`e2e/player-media.spec.ts`) starts at media time 0, so `srtText`'s "English subtitle 00:00" shows at once. A live HLS stream's `currentTime` is not 0.
   - **Small extra:** `packages/core/package.json`'s description (and `index.ts`'s header) still lists only the "M3U/Xtream/XMLTV parsers": add subtitles.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: step 20 and its splits (20a, 20b1, 20b2, 20b2a, 20b2b, 20c), and the progress-log rows for legs 39–41.
3. `docs/architecture.md` §2: "Subtitles", "Built in step 20b1" and **"Built in step 20b2a"**.
4. The code:
   - `packages/core/src/subtitles.ts` (the parser API below);
   - `packages/player/src/tracks.ts`, and `controller.ts` (`onTracks`, `selectText`, `autoSwitch`, `readTracks`, `case 'cue'`, `hide`/`show`);
   - `packages/player/src/fake-engine.ts` (it has `text`, `switchOk`, `tracksMs`; you'll need it to emit `cue`);
   - `packages/platform-tizen/src/avplay-engine.ts` (the `cue` emit, `selectText`, `setSilentSubtitle`);
   - `apps/tv/src/player/`: `track-menu.ts`, `TrackMenuPanel.tsx`, `PlayerScreen.tsx`, `player-state.ts`, `player.css`, `app-player.ts`.
5. The e2e:
   - `e2e/player.spec.ts` (the menu tests at the end);
   - `e2e/player-media.spec.ts` (the MKV routed in for channel 104);
   - `e2e/playback-media.spec.ts` and `apps/tv/src/playback/playback-main.ts` (the harness).
6. Memory:
   - `iptv-tv-bundle-polyfills` (probe every new TV file; leg 41 hit `at` again);
   - `iptv-parser-test-patterns`;
   - `iptv-playwright-chromium-media`;
   - `iptv-ui-test-gotchas`;
   - `iptv-css-pipeline-gotchas`;
   - `use-write-tool-for-doc-batches`;
   - `bg-watcher-memory-reap`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `1df93ca` was unchecked when leg 41 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`.** Leg 41 slipped once (a `cd "<wt>"` in a Bash call); it moved the session's folder into the worktree, which happened to be harmless.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `3ce3ef2` ("docs: record PR #40's merge"). It is pushed, and the tree is clean.
- **main** has `1df93ca` (PR #40). The branch is ahead by `3ce3ef2` and the handover commit, both docs; they go to main with 20b2b's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (media included);
  - `dist/` (from leg 40; leg 41 didn't build);
  - `artifacts/`, which includes:
    - `mutate20b2a.py` and `.log` (the template for the next mutation run: `python -I -u artifacts/mutate20b2a.py [--check | "<snippet>"]`);
    - `poly-probe-subs.py`: it bundles `main.tsx` and a probe entry for both platforms and diffs the core-js modules. Edit its `entry` for 20b2b's files, or just compare `pnpm build:tv` sizes once the app imports them;
    - `test20b2a.log`, `tc20b2a.log`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 41 (step 20b2a, architecture.md §2 "Built in step 20b2a")
- **The parser API** (`@zoma/core`):
  - `SubtitleParser({ format?: 'srt' | 'vtt', maxLineLength?, maxCues? })`, with `push(chunk)` and `end()` returning cues, `.format` (`'srt' | 'vtt' | 'ass' | null`) and `.stats`;
  - `parseSubtitles(text, options)` → `{ format, cues (file order), stats }`;
  - `SubtitleTrack(cues)`: `.cues` stably sorted, and **`.cuesAt(ms)`**: the cues with start ≤ ms < end, in start order, without repeated text;
  - `cueText(raw)` for AVPlay's text;
  - `parseSubtitleClock(text)`;
  - the constants `MAX_CUE_TEXT` (2,000), `DEFAULT_SUBTITLE_LINE_LENGTH` (16 KiB), `DEFAULT_MAX_CUES` (20,000);
  - a cue is `{ startMs, endMs, text }`, with its lines joined by `\n`, trimmed and never empty.
- **Format:** the first line that isn't blank decides. `WEBVTT` is WebVTT, `[` is ASS, anything else is the caller's `format`. Only WebVTT decodes entities, and SRT keeps `&amp;` and backslashes. ASS turns `\N`/`\n`/`\h` into a break, a space and a no-break space. A drawing (`{\p1}`…`{\p0}`) is dropped in every format, and RLM/LRM marks stay.
- **Never-throw:** junk is counted in `stats` (`badTimings`, `junk`, `emptyCues`, `overlongLines`, `droppedCues`). `push()` after `end()` throws, like `M3uParser`.
- **TV bundle:** the app doesn't import the parser yet. A probe adds 8.0 KB before terser and no core-js module. Measure main's real growth in 20b2b with `pnpm build:tv`.

## The "press these keys" checklist for Omar (still step 20b1's; 20b2b extends it with subtitles)
Set up two terminals: `pnpm mock` in one and `pnpm dev` in the other. Run `pnpm mock:media` once first for real pictures. Open http://localhost:5173 and onboard with server `localhost:8080`, user `zoma`, password `zoma-test`, then "Start watching".

**Keys:** Enter = OK, Escape = Back, arrows, `a` = audio key, `c` = subtitle key, `s` = STOP, PageUp/PageDown = CH±. Without Chromium's `--enable-blink-features=AudioVideoTracks` flag, every channel's audio list says "Not supported on this TV".

1. **ArrowDown, Enter:** the player opens. **ArrowRight, Enter** on "Audio and subtitles": the panel opens on the right, the info bar hides, and focus is on the subtitles' "Off".
2. **Escape:** the panel closes, and the bar comes back with "Audio and subtitles" focused.
3. **`c`:** the panel opens on the subtitles. **`a`** closes it when there is no audio list.
4. **`a`, then `s`:** the menu and the player both close; you are back on the channel list.
5. **Arabic** (`?locale=ar-SA` on a fresh profile): the panel is on the left.

20b2b's handover must add the subtitle steps: choose a file, see the cue, size, offset, Arabic `dir=auto`.

## Gotchas and lessons
**New in leg 41** (also in memory):
- **A method or field named `at` pulls `es.array.at` and `es.string.at-alternative` into main.** It happened again: `SubtitleTrack.at`, now `cuesAt`. The probe entry itself must not call `.at` either: leg 41's first re-probe still showed them because the probe did.
- **The probe's bundle crashed natively (empty table, exit with no stderr) once out of three runs:** just rerun it.
- **A Python heredoc lost `\\n` again**, in a `str.replace` on a TS test file. Use the Edit tool for any snippet with backslashes.
- **Mutation:** 100/105 on the first run. The survivors were all test gaps:
  - a digit guard (`c < 0`) masked by later checks, except for inputs like `1-`;
  - upper-case tags;
  - an overlong line's tail still carried while it is skipped;
  - the `>`/`>=` limit on a line held across chunks: random splits rarely land exactly before a line end, so test char-by-char too;
  - an ASS `Format:` without `End`.
- **Don't edit the file under mutation while the run is going** (it swaps mutants in and out). Edit the tests only after the run ends.
- **Main's CI on `853bdfb` was green**, and PR #40 passed on the first run.

**From earlier legs (still true):**
- **`pnpm e2e:media` is two specs,** `playback-media.spec.ts` (the harness) and `player-media.spec.ts`. Run the whole of it whenever what `PlayerController` publishes changes: a new subscription or status field counts. The harness records a status only when its session, state, container, attempt or failure changed.
- **Desktop Chromium's native HLS lists muxed TS audio as one unnamed track.** Route the live URL with `page.route(... 302 → MKV 206)` for app-level track e2e.
- **Guards that mask each other survive mutation:** remove the duplicate, and test the kept guard by asserting **no extra status publish**.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode` in tests, or fix them with a Python `chr()` replace.
- **The navigator enters a neighbour zone at that zone's remembered row.**
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data (rows, guides, `status.tracks`, cue texts) as props.
- **The mock can switch faults mid-test:** `app.mockState.scenario = parseScenario(...)`. Filter expected "Failed to load resource" lines out of `trackErrors`.
- **Local e2e flakes on a busy PC:** the throttled test, fixture tests, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it alone.
- **Background runs:** `pnpm verify > log` in the background can be reaped; read the log. CI's `verify` job is exactly `pnpm verify`.
- **Vitest:**
  - use `quiet()` for a voided load;
  - awaiting a `FakeEngine.stop()` without advancing the clock deadlocks;
  - there is no `__PLATFORM__` define;
  - fake-clock settles go through `setImmediate`.
- **Playwright's Chromium (CfT 156):**
  - no MPEG-TS, AC3/E-AC3 or in-band text;
  - `audioTracks` needs `--enable-blink-features=AudioVideoTracks`;
  - a local `e2e:media` run needs `ZOMA_E2E_MEDIA=1` and the file first, or simply `pnpm e2e:media`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the self-test or the CI job.
- **Waiting for CI:** run `gh pr checks <n>` once, then Monitor with leg 14's command verbatim (memory `bg-watcher-memory-reap`; it worked for PR #40). Never use `<(`.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs, and Arabic catalog text has no Latin words of its own;
  - provider text (cue text included) uses `dir=auto` + `translate=false` or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(` and fields named like built-ins (`at`!);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, `pnpm test` (3,007 tests).
  - Mutation 105/105 on `subtitles.ts`.
  - The polyfill probe on both platforms.
  - PR #40's CI green on all three jobs; merged as `1df93ca`.
  - Main's CI on `853bdfb` green.
- **Not done:**
  - Main's CI on `1df93ca` is unchecked.
  - `build:tv`/`e2e` weren't run locally in leg 41 (CI's `verify` ran them: the app doesn't import the parser).
  - Subtitles aren't drawn anywhere yet (20b2b).
  - The menu hasn't run on any TV, so the S10 run for the MTS/Caption codes hasn't happened.
  - The player hasn't run on the LG TV (step 21) or any Samsung (19b).
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **20b2b's design** is the leg's judgement (the suggestions above); record it.
- **Steps 16 and 19b wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30 minutes at the LG TV** for S10 (now also the audio and subtitle keys' codes), S11 by ear, S5's suspend and soak, and the player itself (step 21).
- **Later, from the spikes:**
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung);
  - the last frame kept while reconnecting;
  - a settings screen for the track languages and the subtitle style.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 41 was the 41st.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty CLAUDE.md gaps** are waiting for his word:
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
  20. the desktop keys `a` (audio) and `c` (subtitles) in the `pnpm dev` row's key list, and the `AUDIO`/`SUBTITLES` intents (Tizen MTS/Caption) next to the remote-keys note.
- **Secrets:** none pending. The LG Dev Mode passphrase from 2026-11-04 needs no reminder (Omar said so).
