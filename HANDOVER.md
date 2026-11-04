# Zoma IPTV: relay leg 43 opening prompt

You are leg 43 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–41 did steps 1–20b2a, except step 16's Samsung part and its by-hand TV checks, and 19b (PRs #1–#40).
- **Leg 42 did step 20b2b**, the subtitle overlay and its feeds. That completes 20b2 and 20b.
  - It merged as PR **#41** (merge commit **`15fb322`**, branch kept).
  - CI on `307be31`: verify 10 m 6 s, media 12 m 5 s, engines 14 m 25 s, green on the first run.
  - Main's CI on `1df93ca` (PR #40) was checked: green. Main's CI on `15fb322` was still unchecked when leg 42 ended.
- **Steps 16 and 19b stay open** until Omar says the Samsung route is ready or has time at the TV.

## Your step: 20c, "Player UI, the rest" (RELAY.md is the spec)
RELAY.md, step 20c:
- aspect/zoom (`setRect`);
- stream info (`engine.stats()`: size, bitrate, container);
- start-on-last-channel: the profile keeps the last channel, and the first frame comes within 4 s on 2020+ TVs (step 21 measures that on the TV);
- the profile keeping `SourceMemory` and the redirect memory;
- `allowed_output_formats` from the account, for `streamCandidates`.

**Done when:**
- unit tests;
- an e2e where a relaunch starts the last channel before the catalog loads;
- the PR merged;
- the full player click-through checklist in the handover.

**The profile's other unfinished work belongs here too.** Earlier steps left it to 20c:
- `TrackMemory`'s per-channel track choices (20b1);
- the subtitle size and timing (20b2b): `menu.size` and `menu.delay` in `track-menu.ts`, in memory today.

**20c is big: split it first, the way legs 39–41 did, and record the split in RELAY.md.** One way to cut it:
- **20c1, the profile's player memory and start-on-last-channel:**
  - the last channel;
  - `SourceMemory`, the redirect memory, `TrackMemory`;
  - the subtitle size and timing;
  - the relaunch e2e.
- **20c2, the rest:** aspect/zoom, stream info, `allowed_output_formats`, and the full checklist.

1. **Check for existing work first:**
   - Run `git log --oneline -50`.
   - Grep for `lastChannel`, `SourceMemory`, `RedirectMemory`, `TrackMemory`, `allowed_output_formats`, `setRect`, `stats()` under `packages/` and `apps/tv/src`.
   - **What exists today:**
     - `MemorySourceMemory` (player, `request.ts`);
     - `MemoryRedirectMemory` (platform-tizen, `redirect-probe.ts`);
     - `MemoryTrackMemory` (player, `tracks.ts`);
     - `EngineStats` and `engine.stats()`;
     - `engine.setRect`;
     - the profile and its edits (`data.editProfile`, `answerEdit`, `readStartProfile`, `startPoint` in `apps/tv/src/onboarding/start.ts`);
     - `streamCandidates(url, mode, allowed?)`: check whether the account's `allowed_output_formats` is already read anywhere (`packages/core` Xtream login and `packages/data` account check).
2. **Decide and record** in architecture.md §2, under a new "Built in step 20c…" heading:
   - where each memory lives in the profile (ADR-008: the platform's work arrives as callbacks);
   - how the start reads the last channel before the catalog has loaded (architecture.md §2, "Start on last channel": the profile, then the source's credentials, then the URL);
   - what the info bar or a menu shows for stream info and aspect.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`:
   - step 20 and its splits (20a, 20b1, 20b2a, 20b2b; 20c open);
   - the progress-log rows for legs 39–42.
3. `docs/architecture.md`:
   - §2: "Start on last channel", "Built in step 20a", "20b1" and **"20b2b"**;
   - §1.3 (storage: webOS wipes everything on update).
4. The code:
   - `apps/tv/src/main.tsx` (the start: `readStartProfile`, `startPoint`, `showLive`);
   - `apps/tv/src/onboarding/start.ts`;
   - `apps/tv/src/player/` (`player-state.ts`, `app-player.ts`, `track-menu.ts`, `PlayerScreen.tsx`);
   - `packages/player/src/request.ts`, `tracks.ts`, `controller.ts`;
   - `packages/platform-tizen/src/redirect-probe.ts`;
   - the profile in `packages/data` (grep `editProfile`).
5. The e2e:
   - `e2e/player.spec.ts` and `e2e/player-media.spec.ts`;
   - `e2e/onboard.ts` (`addXtreamAndWatch`).
6. Memory:
   - `iptv-tv-bundle-polyfills`;
   - `iptv-data-layer-test-gotchas`;
   - `iptv-ui-test-gotchas`;
   - `iptv-parser-test-patterns`;
   - `iptv-playwright-chromium-media`;
   - `use-write-tool-for-doc-batches`;
   - `bg-watcher-memory-reap`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `15fb322` was unchecked when leg 42 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`.** Leg 42 slipped once (a `cd /d` at the head of a Bash call); the shell reset itself, so it was harmless.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `bdfef7a` ("docs: record PR #41's merge"). It is pushed, and the tree is clean.
- **main** has `15fb322` (PR #41). The branch is ahead by `bdfef7a` and the handover commit, both docs; they go to main with 20c's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media included), `dist/` (leg 42's `pnpm verify` built it);
  - `artifacts/`, which includes:
    - `mutate20b2b.py` and `.log` (the newest mutation template: one test list per file, `python -I -u artifacts/mutate20b2b.py [--check | "<snippet>"]`);
    - `poly-probe-bytes.py`: it bundles `main.tsx` against a probe entry and diffs the core-js modules (edit its `entry`);
    - `verify20b2b.log`, `e2emedia20b2b.log`, `check20b2b.log`;
    - `screenshots/subtitles-file-en.png` and `-ar.png`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 42 (step 20b2b, architecture.md §2 "Built in step 20b2b")
- **Subtitle files are tracks.** A request's `externalSubs` (`ExternalSub`, exported from `@zoma/player`) follow the stream's own subtitles in `status.tracks.text` as `ext:0`, `ext:1`…
  - `fileIndex(id)` and `fileTracks()` are in `tracks.ts`.
  - They are listed only where `ControllerOptions.loadSubtitles` exists, and chosen like any track (the menu, `TrackMemory`, the preferences).
  - A file is loaded once per session, and the stream's own subtitles go off while it shows.
- **The feed:** `controller.subtitles` and `subscribeSubtitles(view)`, kept apart from the status. A view is `{ feed: 'file' | 'engine' | null, cues: string[] }`.
  - **A file:** `cuesAt(positionMs − delay)` every 250 ms while playing, paused or buffering.
  - **AVPlay's `cue` events:** shown for their duration (5 s without one), at most 4 at once.
  - **`setSubtitleDelay(ms)`** moves files only.
  - **Races:** a newer choice overtakes a slower one (`s.textSeq`), and a zap drops a late answer.
- **The loader** (`apps/tv/src/player/subtitle-loader.ts`): an XHR for an `ArrayBuffer`, with a 4 MB cap and a 20 s timeout.
  - **Charset:** UTF-16 by its BOM, else strict UTF-8, else Windows-1256 (Arabic, Persian, Urdu or an unknown language), else Windows-1252.
  - **The BOM** is read with a `DataView`, not a `Uint8Array`.
- **The overlay** (`SubtitleOverlay.tsx`, hook-free) sits in `.player__bottom`, a new bottom stack holding the subtitles and then the info bar.
  - The bar is no longer absolutely positioned itself.
  - Each cue has `dir=auto` and `translate=false`. Sizes S/M/L are 40/52/64 px.
- **The menu** (`track-menu.ts`, `TrackMenuPanel.tsx`):
  - file rows (with "File" after the name);
  - `refused: 'file'` ("This subtitle file couldn't be loaded.");
  - only the newest switch's refusal shows;
  - a third zone, `style`: "Size", plus "Timing" for a file (`styleRows(feed)`). LEFT/RIGHT change a row towards the reading end, and OK cycles the size or resets the timing.
  - `menu.size` and `menu.delay` are signals, **in memory only (20c)**.
- **The e2e** runs through the playback harness: VOD reaches the app only in step 26, and `__ZOMA_TEST__` is read-only.
  - The harness gained `externalSubs`, `selectText`, `setSubtitleDelay`, `setSubtitleSize`, `textTracks` and `subtitles`. It draws the app's overlay with `player.css`.
  - The mock serves `GET /subtitles/<u>/<p>/<id>.<eng|ara>.<srt|vtt>[?charset=windows-1256]` (`apps/mock-provider/src/subtitle-files.ts`).
- **TV bundle:** main grew to 259.0 KB of its own code on Tizen and 247.6 KB on webOS (+16.2 and +16.3 KB), with the same 219 core-js modules.

## The player checklist for Omar (20b1 + 20b2b; 20c extends it to the full click-through)
**Setup:** two terminals, `pnpm mock` in one and `pnpm dev` in the other. Run `pnpm mock:media` once first, for real pictures.

### The menu in the app
Open http://localhost:5173 and onboard with server `localhost:8080`, user `zoma`, password `zoma-test`. Then press "Start watching".

**Keys:** Enter = OK, Escape = Back, the arrows, `a` = the audio key, `c` = the subtitle key, `s` = STOP, PageUp/PageDown = CH±.

1. **ArrowDown, Enter:** the player opens. **ArrowRight, Enter** on "Audio and subtitles": the panel opens on the right, the info bar hides, and the focus is on the subtitles' "Off".
2. **Escape:** the panel closes. The bar comes back with "Audio and subtitles" focused, still at the bottom of the screen.
3. **`c`:** the panel opens on the subtitles. **`a`** closes it when there is no audio list.
4. **`a`, then `s`:** the menu and the player both close, and you are back on the channel list.
5. **Arabic** (`?locale=ar-SA` on a fresh profile): the panel is on the left.

**Not reachable in the app yet:** no live channel has a subtitle file, and desktop Chromium lists no embedded subtitles. So the menu's file rows and its "Subtitle style" rows (Size, and Timing) first appear:
- with VOD, in step 26;
- or on a Samsung TV, where an embedded subtitle shows "Size" only (19b and 21).

Their keys are covered by unit tests.

### The subtitles themselves: the playback harness
Open http://localhost:5173/playback.html, then the DevTools console (F12), and paste:

```js
const m = 'http://localhost:8080', a = 'zoma/zoma-test';
__ZOMA_PLAYBACK__.play({ url: `${m}/movie/${a}/206.mkv`, mode: 'vod', externalSubs: [
  { lang: 'eng', url: `${m}/subtitles/${a}/206.eng.srt`, fmt: 'srt' },
  { lang: 'ara', url: `${m}/subtitles/${a}/206.ara.srt?charset=windows-1256`, fmt: 'srt' } ] });
```

6. **`__ZOMA_PLAYBACK__.selectText('ext:0')`:** "English subtitle 00:05" and the rest appear bottom-centre. Each one names the time burned into the picture (top left), a new one every 5 s, with a 1 s gap.
7. **`__ZOMA_PLAYBACK__.setSubtitleDelay(-5000)`:** each cue names 5 s ahead of the picture. `setSubtitleDelay(0)` puts it back.
8. **`__ZOMA_PLAYBACK__.selectText('ext:1')`:** the Arabic file, an old Windows-1256 one, reads correctly from right to left.
9. **`__ZOMA_PLAYBACK__.setSubtitleSize('l')`:** larger. `'s'` is smaller.
10. **`__ZOMA_PLAYBACK__.selectText(null)`:** the subtitles go.

## Gotchas and lessons
**New in leg 42** (also in memory):
- **A `Uint8Array` anywhere in a TV file pulls 35 core-js modules (+13.9 KB) into main.** A `DataView` pulls none. Avoid naming the `ArrayBuffer` global too (no `instanceof ArrayBuffer`). XHR's progress events count bytes without typed arrays.
- **Mutation, the first run 90/100.** The lessons:
  - **An internal guard behind a public one is masked.** `selectText`'s own `this.s !== s` hid `switchText`'s session checks. Test the internal effect another way: here, the next stream's engine cues were wrongly dropped.
  - **A pending-timer check must be measured before the first event.** Re-arming a timer keeps `clock.pending` the same.
  - **Let a load settle** (`await clock.advance(100)`) before the zap you test. Otherwise the zap pre-empts the path under test.
  - **Boundaries:** a cue with no duration, and two cues ending 1 ms apart.
- **The mock imports nothing internal** (eslint-boundaries: it is the parsers' independent oracle). Parse its output in the root `test/` (`test/subtitles-mock.test.ts`).
- **A long Bash heredoc with a Python patch failed to parse again.** Write the script with the Write tool and run it from `$CLAUDE_JOB_DIR/tmp`.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Vite serves live files, and the mutation run swaps them. Docs are safe.
- **The relay context check fired at about 452k tokens**, during the mutation run. Splitting 20c early keeps a leg under it.

**From earlier legs (still true):**
- **`pnpm e2e:media` is two specs,** `playback-media.spec.ts` (the harness) and `player-media.spec.ts`. Run the whole of it whenever what `PlayerController` publishes changes.
- **Desktop Chromium's native HLS lists muxed TS audio as one unnamed track.** Route the live URL with `page.route(... 302 → MKV 206)` for app-level track e2e.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`. `\n` in strings survives.
- **The navigator enters a neighbour zone at that zone's remembered row, and skips empty zones.**
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
- **The mock can switch faults mid-test:** `app.mockState.scenario = parseScenario(...)`. Filter expected "Failed to load resource" lines.
- **Local e2e flakes on a busy PC:** the throttled test, fixture tests, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it alone. A bundle probe crashed once in three runs: rerun it.
- **Background runs:** `pnpm verify > log` in the background works; read the log. CI's `verify` job is exactly `pnpm verify`.
- **Vitest:**
  - use `quiet()` for a voided load;
  - awaiting a `FakeEngine.stop()` without advancing the clock deadlocks;
  - there is no `__PLATFORM__` define;
  - fake-clock settles go through `setImmediate`.
- **Playwright's Chromium (CfT 156):** no MPEG-TS, AC3/E-AC3 or in-band text; `audioTracks` needs `--enable-blink-features=AudioVideoTracks`. A local single `e2e:media` test needs `ZOMA_E2E_MEDIA=1` and `--project=playback-media`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun.
- **Waiting for CI:**
  - wait about 30 s after `gh pr create`;
  - then use a Monitor `until` loop on `gh pr checks <n>` that exits when nothing is pending (it worked for PR #41);
  - never use `<(`.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs, and Arabic catalog text has no Latin words of its own;
  - provider text uses `dir=auto` + `translate=false` or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(`, typed arrays, and fields named like built-ins (`at`!);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally:
    - lint and typecheck;
    - 3,115 unit tests;
    - `pnpm verify` (57 e2e) and `pnpm e2e:media` (8);
    - mutation 99/99;
    - the polyfill probe: 219 core-js modules on both platforms.
  - PR #41's CI green on all three jobs; merged as `15fb322`.
  - Main's CI on `1df93ca` green.
- **Not done:**
  - Main's CI on `15fb322` is unchecked.
  - The menu's file rows and style rows were never seen in a browser (unit tests only).
  - AVPlay's cues were never seen on a Samsung TV.
  - The app has no source of subtitle files until VOD (step 26).
  - The player hasn't run on any TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **20c's split and its design** are the leg's judgement; record them.
- **Steps 16 and 19b wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30 minutes at the LG TV** for S10 (the audio and subtitle keys' codes included), S11 by ear, S5's suspend and soak, and the player itself (step 21).
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
- **Relay cap:** 60 legs (state.json). Leg 42 was the 42nd.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-one CLAUDE.md gaps** are waiting for his word:
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
  21. **new:** the mock row's `/subtitles/<u>/<p>/<id>.<eng|ara>.<srt|vtt>[?charset=windows-1256]`, and the playback harness's subtitle calls (`externalSubs`, `selectText`, `setSubtitleDelay`, `setSubtitleSize`) in the `pnpm dev` row.
- **Secrets:** none pending.
