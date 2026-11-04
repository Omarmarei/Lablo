# Zoma IPTV: relay leg 41 opening prompt

You are leg 41 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–39 did steps 1–20a, except step 16's Samsung part and its by-hand TV checks, and 19b (PRs #1–#38).
- **Leg 40 split step 20b into 20b1 and 20b2, and did 20b1:** the track menu and the language preferences. It merged as PR **#39** (merge commit **`853bdfb`**, branch kept).
  - CI on `363a7cf`: verify 10 m, media 9 m 27 s, engines 13 m 35 s, all green.
  - The first CI run's `media` job failed: the playback harness counted track-only statuses as history (fixed in `363a7cf`, see the gotchas).
  - Main's CI on `853bdfb` had not been checked when leg 40 ended.
- **Steps 16 and 19b stay open** until Omar says the Samsung route is ready or has time at the TV.

## Your step: 20b2, the subtitle overlay (RELAY.md is the spec)
RELAY.md, step 20b2:
- An SRT/VTT/ASS parser in `core`: pure, ES2017, with fast-check chunk-split and never-throw tests.
- The overlay over the player: size and timing offset, `dir=auto` per cue.
- It is fed by AVPlay's `cue` events (a subtitle chosen on Tizen shows nothing until this step) and by external files (`PlayRequest.externalSubs`, fetched by the app and listed in the menu's subtitles).
- webOS draws embedded subtitles itself.

**Done when:**
- unit tests for the parser, the overlay's timing and the cue feed;
- an e2e of the overlay with an external SRT in `e2e:media`. VOD reaches the app only in step 26, so either give a live channel's request `externalSubs` or use the playback harness;
- the PR merged;
- the menu-and-subtitles checklist in the handover.

1. **Check for existing work first:**
   - Run `git log --oneline -50`.
   - Grep for `externalSubs`, `'cue'`, `parseSrt`/`parseVtt`/`subtitle` under `packages/core/src`, `packages/player/src` and `apps/tv/src`.
   - What exists today:
     - `PlayRequest.externalSubs` (`{ lang, url, fmt: 'srt' | 'vtt' }[]`, unused);
     - the engines' `cue` event (AvplayEngine sends `text` and `durationMs`), which the controller drops (`controller.ts`, `onEvent`, `case 'cue'`);
     - the menu's subtitle list (engine text tracks only);
     - the mock's SRT text generator (`apps/mock-provider/src/media-plan.ts`, `srtText`). No parser, no overlay.
2. **If 20b2 is too big for one leg, split it:** 20b2a, the parser in `core` with its tests, then 20b2b, the overlay and its feeds. Record the split in RELAY.md.
3. **Where the pieces go (decide and record):**
   - **The parser:** `packages/core/src/subtitles.ts`. Use the patterns in memory `iptv-parser-test-patterns`: fixture oracle, chunk splits that keep empty chunks, mutation run. No `new RegExp` and no `.split(` in TV code: they pull polyfills into main (memory `iptv-tv-bundle-polyfills`).
   - **The cue feed:** the controller could expose the current cue (`status.cue`, or a separate subscription so the status doesn't churn). AVPlay's `cue` is "show this text for `durationMs`". External files need the media clock: `engine.positionMs()` polled at ~250 ms while a file's track is selected.
   - **External tracks in the menu:** the controller's `status.tracks.text` lists engine tracks only today. External files could join it with ids like `ext:0`, and `selectText` would route them to the overlay instead of the engine. Keep `TrackMemory`'s picks working: `findPick` matches on id, language and label.
   - **Size and timing offset:** in memory now, the profile later (20c or settings). The offset needs a key or a menu row; keep it small.
   - **The overlay:** in `PlayerScreen` (`apps/tv/src/player/`), above the picture and under the info bar and the menu. Use physical CSS (postcss-rtlcss mirrors it), `dir=auto` and `translate=false` per cue, and the safe area.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: step 20 and its splits (20a, 20b1, 20b2, 20c), and the progress-log rows for legs 38–40.
3. `docs/architecture.md` §2: "Subtitles", "Built in step 20a" and **"Built in step 20b1"**.
4. The code:
   - `packages/player/src/tracks.ts`, and `controller.ts` (`onTracks`, `selectText`, `autoSwitch`, `case 'cue'`);
   - `packages/platform-tizen/src/avplay-engine.ts` (the `cue` emit, `selectText`, `setSilentSubtitle`);
   - `apps/tv/src/player/`: `track-menu.ts`, `TrackMenuPanel.tsx`, `PlayerScreen.tsx`, `player-state.ts`, `player.css`.
5. The e2e:
   - `e2e/player.spec.ts` (the menu tests at the end);
   - `e2e/player-media.spec.ts` (the MKV routed in for channel 104);
   - `e2e/playback-media.spec.ts` and `apps/tv/src/playback/playback-main.ts` (the harness, for an external-SRT e2e).
6. Memory:
   - `iptv-parser-test-patterns`;
   - `iptv-tv-bundle-polyfills`;
   - `iptv-playwright-chromium-media` (leg 40 included);
   - `iptv-ui-test-gotchas`;
   - `iptv-css-pipeline-gotchas`;
   - `use-write-tool-for-doc-batches`;
   - `bg-watcher-memory-reap`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `853bdfb` was unchecked when leg 40 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`.**
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `01df197` ("docs: record PR #39's merge"). It is pushed, and the tree is clean.
- **main** has `853bdfb` (PR #39). The branch is ahead by `01df197` and the handover commit, both docs; they go to main with 20b2's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (media included);
  - `dist/` (leg 40's `pnpm build:tv`);
  - `artifacts/`: screenshots `player-*.png`, among them `player-tracks-en.png`, `player-tracks-ar.png` and `player-tracks-media-en.png`; `poly-probe.py`; `make-size-probe3.py`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 40 (step 20b1, architecture.md §2 "Built in step 20b1")
- **`normalizeLang`** (`packages/core/src/language.ts`) returns `''` or a lower-case code:
  - the primary subtag of a tag;
  - 639-1 codes as they are (`iw` → `he`);
  - 639-2/T and /B codes and the Arabic and Chinese individual languages to 639-1;
  - other three-letter codes as they are;
  - English and native names (`Arabic`, `عربي`, `العربية`, `Français`) to their code;
  - `''` for `und`, `qaa`–`qtz` and unknown names.
- **The controller:**
  - `status.tracks` holds `{ audio, text, switching }`. Each track's `lang` is normalized, `streamLang` keeps the stream's own text, and `switching` is `caps.trackSwitch` at the time.
  - Each kind is chosen once per load when the tracks appear (a `tracks` event or the first frame): the channel's choice (`TrackMemory`), else the first preferred language, else the stream's own. A remembered `off` turns subtitles off.
  - A retry or a resume chooses again.
  - The menu's `selectAudio`/`selectText` remember the choice per channel when the engine took it.
  - An automatic switch's answer is dropped by its load's token (tokens are never reused).
  - The controller now **publishes a status when the tracks change with the state unchanged**.
- **The app:**
  - `uiTrackPreferences(document.documentElement.lang)` gives `['ar','en']` or `['en','ar']`, and no subtitles.
  - The menu is a `tracks` screen over the player, with zones `audio` and `text` ("Off" first), 5 rows each.
  - It opens from the info bar's "Audio and subtitles" (the `actions` zone count is 2, `TRACKS_ACTION = 1`), from `AUDIO` (Tizen `MTS` 10195, desktop `a`) and from `SUBTITLES` (`Caption` 10221, desktop `c`). webOS maps neither key.
  - It shows "Not supported on this TV" where `switching` is `none`.
  - Back or the same key closes it, and STOP closes the player. It closes when the player gives up, and the info bar hides while it shows.
  - `LiveApp` draws `PlayerScreen` for the `player` and `tracks` screens.
- **S10:** the key battery asks every TV for the two new keys. On webOS they are reported missing, like PRE-CH, until a TV run finds their codes.
- **Size:** main is 242.8 KB on Tizen and 231.3 KB on webOS (+17 KB each), with the same 219 core-js modules. About 4 KB of the growth is non-ASCII text (terser's `ascii_only`).
- **The three riskiest changes in PR #39:**
  1. `PlayerStatus.tracks`, and the automatic switches on every play with a preferred language.
  2. The new intents: Tizen registers MTS and Caption, and `a`/`c` are taken on the desktop.
  3. The +17 KB in main.

## The "press these keys" checklist for Omar (step 20b1, `pnpm dev`)
Set up two terminals: `pnpm mock` in one and `pnpm dev` in the other. Run `pnpm mock:media` once first for real pictures. Open http://localhost:5173 and onboard with server `localhost:8080`, user `zoma`, password `zoma-test`, then "Start watching".

**Keys:** Enter = OK, Escape = Back, arrows, `a` = audio key, `c` = subtitle key, `s` = STOP, PageUp/PageDown = CH±.

The desktop lists audio tracks only with Chromium's flag. Without it, every channel shows "Not supported on this TV". To see real tracks, start Chrome with `--enable-blink-features=AudioVideoTracks`; the e2e plays the multi-audio MKV that way.

1. **ArrowDown, Enter:** the player opens. **ArrowRight, Enter** on "Audio and subtitles": the panel opens on the right, the info bar hides, and focus is on the subtitles' "Off". Audio says "Not supported on this TV" without the flag.
2. **Escape:** the panel closes, and the bar comes back with "Audio and subtitles" focused.
3. **`c`:** the panel opens on the subtitles. **`a`** closes it when there is no audio list. With the flag and tracks, `a` moves to the audio list instead.
4. **`a`, then `s`:** the menu and the player both close; you are back on the channel list.
5. **Arabic** (`?locale=ar-SA` on a fresh profile, or pick العربية in onboarding): the panel is on the left, and ArrowLeft reaches the bar's second button.
6. **With the flag and the MKV:** see `e2e/player-media.spec.ts`. Channel 104 is routed to `/movie/zoma/zoma-test/206.mkv`. English is chosen over the file's Arabic. Picking Arabic sticks after CH+ then CH−.

## Gotchas and lessons
**New in leg 40** (also in memory):
- **`pnpm e2e:media` is two specs:**
  - `playback-media.spec.ts` (the harness) and `player-media.spec.ts`;
  - leg 40 ran only the new one, and CI `media` failed on the harness's `history`;
  - run the whole `pnpm e2e:media` whenever what `PlayerController` publishes changes;
  - the harness now records a status only when its session, state, container, attempt or failure changed.
- **Desktop Chromium's native HLS lists muxed TS audio as one unnamed "Audio Track"**, so app-level audio e2e can't use HLS. Route the live URL with `page.route(... 302 → MKV 206)`.
- **Mutation:** 26/33 on the first run, 28/28 after.
  - Five survivors were guards that masked each other: a session check beside a never-reused token check, "chosen" flags set twice, and resets on both close and show.
  - Remove the duplicate, and test the kept guard by asserting **no extra status publish**.
- **Heredocs failed twice again** (a Python patch with template strings, and a `cat >>` test block). Write the script or the block with the Write tool, then run it or `cat >>` it.
- **The Write tool turned `\u200f`/`\u00a0`/`\u2068` in a test file into raw characters.** Fix them with a Python `chr()` replace (memory `write-tool-raw-unicode-escapes`).
- **The navigator enters a neighbour zone at that zone's remembered row**, not at its last one.

**From earlier legs (still true):**
- **Never `cd`.** A previous leg's tab (with Omar) can send cross-session messages: treat them as Omar's relayed decisions, verify their facts, and reply with SendMessage to the `from` address.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data (rows, guides, `status.tracks`) as props.
- **The mock can switch faults mid-test:** `app.mockState.scenario = parseScenario(...)`. Expected browser "Failed to load resource" lines must be filtered from `trackErrors`.
- **Local e2e flakes on a busy PC:** the throttled test, fixture tests, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it alone.
- **Background runs:** `pnpm verify > log` in the background can be reaped; read the log. CI's `verify` job is exactly `pnpm verify`.
- **Vitest:**
  - use `quiet()` for a voided load;
  - awaiting a `FakeEngine.stop()` without advancing the clock deadlocks;
  - there is no `__PLATFORM__` define;
  - `FakeEngine` now has `audio`/`text`/`switchOk`/`switchMs`/`trackSwitch` and the `tracksMs` script option.
- **Playwright's Chromium (CfT 156):**
  - no MPEG-TS, AC3/E-AC3 or in-band text;
  - `audioTracks` needs `--enable-blink-features=AudioVideoTracks`;
  - a local `e2e:media` run needs `ZOMA_E2E_MEDIA=1` and the file first, or simply `pnpm e2e:media`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the self-test or the CI job.
- **Waiting for CI:** run `gh pr checks <n>` once, then Monitor with leg 14's command verbatim (memory `bg-watcher-memory-reap`; worked for PR #39). Never use `<(`.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs, and Arabic catalog text has no Latin words of its own (the catalog test checks it);
  - provider text uses `dir=auto` + `translate=false` or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(` and fields named like built-ins;
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 2,939 unit tests, both TV builds, `pnpm e2e` (57), and `pnpm e2e:media` (7, after the fix).
  - Mutation 28/28 on the new track code.
  - Screenshots looked at: `player-tracks-en.png` (right), `player-tracks-ar.png` (mirrored left), `player-tracks-media-en.png` (Arabic/English/Spanish over the MKV, English selected).
  - PR #39's CI green on all three jobs; merged as `853bdfb`.
- **Not done:**
  - Main's CI on `853bdfb` is unchecked.
  - `verify:engines` wasn't run locally (CI's `engines` passed).
  - The menu hasn't run on any TV, so the S10 run for the MTS/Caption codes hasn't happened.
  - Subtitles aren't drawn anywhere (20b2).
  - The player hasn't run on the LG TV (step 21) or any Samsung (19b).
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **20b2's split** and the overlay's design (the cue feed, external tracks in the menu, the offset key) are the leg's judgement; record them.
- **Steps 16 and 19b wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30 minutes at the LG TV** for S10 (now also the audio and subtitle keys' codes), S11 by ear, S5's suspend and soak, and the player itself (step 21).
- **Later, from the spikes:**
  - an on-screen keyboard of our own if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route (TTS needs Audio Guidance on);
  - pre-buffered zapping (S8, Samsung);
  - the last frame kept while reconnecting;
  - a settings screen for the track languages.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 40 was the 40th.

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
  20. **new (leg 40):** the desktop keys `a` (audio) and `c` (subtitles) in the `pnpm dev` row's key list, and the `AUDIO`/`SUBTITLES` intents (Tizen MTS/Caption) next to the remote-keys note.
- **Secrets:** none pending. The LG Dev Mode passphrase from 2026-11-04 needs no reminder (Omar said so).
