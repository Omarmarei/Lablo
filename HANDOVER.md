# Zoma IPTV: relay leg 44 opening prompt

You are leg 44 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–42 did steps 1–20b2b, except step 16's Samsung part and its by-hand TV checks, and 19b (PRs #1–#41).
- **Leg 43 split step 20c into 20c1 and 20c2, and did 20c1:** the profile's player memory and the start on the last channel.
  - It merged as PR **#42** (merge commit **`3cf09a1`**, branch kept).
  - CI on `74abef8`: verify 11 m 26 s, media 14 m 13 s, engines 14 m 17 s, green on the first run.
  - Main's CI on `15fb322` (PR #41) was checked: green. Main's CI on `3cf09a1` was still unchecked when leg 43 ended.
- **Steps 16 and 19b stay open** until Omar says the Samsung route is ready or has time at the TV.

## Your step: 20c2 (RELAY.md is the spec)
RELAY.md, step 20c2: aspect/zoom (`setRect`), stream info (`engine.stats()`: size, bitrate, container), the account's `allowed_output_formats` for `streamCandidates`.

**Done when:**
- unit tests;
- e2e of aspect and stream info;
- the PR merged;
- **the full player click-through checklist in the handover**: 20a + 20b1 + 20b2b + 20c1 (below) + 20c2's own rows.

**Split it first if it looks big** (legs 39–43 all split), and record the split in RELAY.md. One cut: 20c2a (`allowed_output_formats` and stream info) and 20c2b (aspect/zoom and the full checklist).

1. **Check for existing work first:**
   - Run `git log --oneline -50`.
   - Grep for `outputFormats`, `allowed_output_formats`, `setRect`, `stats()`, `EngineStats`, `aspect`, `zoom` under `packages/` and `apps/tv/src`.
   - **What exists today:**
     - `streamCandidates(url, mode, outputFormats?)` (`packages/player/src/request.ts`) filters `.ts`/`.m3u8` by the formats, with tests.
     - **The formats are parsed but stored nowhere:** core's Xtream login gives `XtreamAccount`… `outputFormats` (`packages/core/src/xtream.ts`, `stringList(u['allowed_output_formats'])`). The app's `liveRequest` (`apps/tv/src/player/player-state.ts`) calls `streamCandidates(row.item.url, 'live')` with none. Decide where they live: the source's record at onboarding and refresh, or the ingest's `SourceMeta`, or the profile's `player` section. The query worker's `account` call (`packages/data/src/account-check.ts`) re-reads `user_info` too. An M3U `get.php` source has a panel as well.
     - `EngineStats` (`width`, `height`, `bitrate`, `droppedFrames`) and `stats()` on Html5Engine, AvplayEngine and FallbackEngine. The container is in `PlayerStatus.container`.
     - `setRect(r | 'full')` on every engine (Html5Engine moves the `<video>` by CSS; AVPlay's `setDisplayRect` in 1920×1080 space). Nothing in the app calls it yet.
     - Samsung's `PictureSize` key would need a new intent (S10's battery then asks every TV for it).
2. **Decide and record** in architecture.md §2, under a new "Built in step 20c2…" heading:
   - what aspect/zoom offers (fit, fill or zoom, 16:9 and 4:3?), where it lives (the info bar, the track menu or its own menu), and whether the profile keeps it (per channel or global: profile v3's `player` section takes a new field through `PlayerChange`; that means a migration, or an optional field the reader tolerates);
   - what stream info shows and where (the info bar, or a row in a menu);
   - where `allowed_output_formats` is stored.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`:
   - step 20 and its splits (20a, 20b1, 20b2a, 20b2b, 20c1; 20c2 open);
   - the progress-log rows for legs 39–43.
3. `docs/architecture.md` §2: "Built in step 20a", "20b1", "20b2b" and **"20c1"**.
4. The code:
   - `apps/tv/src/main.tsx` (the start: `createPlayerMemory`, `createPlatform({ redirects })`, `showLive(…, resume)`);
   - `apps/tv/src/player/` (`player-state.ts`, `player-memory.ts`, `app-player.ts`, `track-menu.ts`, `PlayerScreen.tsx`);
   - `apps/tv/src/live/live-state.ts` (`startCategory`, `list.locate`, `shownCategory`);
   - `packages/data/src/profile.ts` (v3, `PlayerMemoryDoc`, `PlayerChange`);
   - `packages/player/src/request.ts`, `engine.ts`, `html5-engine.ts`; `packages/platform-tizen/src/avplay-engine.ts`.
5. The e2e: `e2e/resume.spec.ts`, `e2e/player.spec.ts`, `e2e/player-media.spec.ts`, `e2e/onboard.ts`.
6. Memory:
   - `iptv-tv-bundle-polyfills`;
   - `iptv-ui-test-gotchas`;
   - `iptv-parser-test-patterns`;
   - `iptv-playwright-chromium-media`;
   - `use-write-tool-for-doc-batches`;
   - `bg-watcher-memory-reap`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `3cf09a1` was unchecked when leg 43 ended.
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`.** Leg 43 slipped once (a `cd /d` at the head of a Bash call); the shell reset itself, so it was harmless.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `3486272` ("docs: record PR #42's merge"). It is pushed, and the tree is clean.
- **main** has `3cf09a1` (PR #42). The branch is ahead by `3486272` and the handover commit, both docs; they go to main with 20c2's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate20c1.py` and `.log` (the newest mutation template: one test list per file);
    - `poly-count20c1.py`: counts main's core-js modules from Rollup's module table (219 on both platforms now);
    - `verify20c1.log`, `e2emedia20c1.log`, `corejs20c1-tizen.txt`, `corejs20c1-webos.txt`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 43 (step 20c1, architecture.md §2 "Built in step 20c1")
- **Profile v3** (migration 2 → 3) adds `player` (`PlayerMemoryDoc`):
  - `last`: the `LastChannel`: the whole catalog item, its number, the rail entry it played from (`{ src, name }` of a category, or `null` for "All channels"), its row there, and `started` (epoch ms).
  - `containers` and `redirects`: per source.
  - `tracks`: per ContentKey, the `StoredTrackChoice` (audio, text, optional `delayMs`, `used`); 300 kept, the oldest change dropped.
  - `subtitleSize`.
  - Edits: `{ kind: 'player', change: PlayerChange }`, one field at a time; the same answer writes nothing.
  - **Secrets:** `last.item.url` holds credentials; step 32 encrypts it with the logins.
- **`createPlayerMemory`** (`apps/tv/src/player/player-memory.ts`) reads the start's profile once (`load`), and hands out:
  - `sources` and `tracks` to the controller (`appPlayer`'s `memory`, `trackMemory`);
  - `redirects` to the platform. `RedirectMemory` and `RedirectMode` moved to `platform-api`; `createPlatform(options)` → `createTizenPlatform({ redirects })`;
  - `last()`, `tuned(...)`, `subtitleSize()` and `setSubtitleSize()` to the app.
  - Reads never wait; a failed write is logged. Entries the app can't use are skipped.
- **The start:** `startPoint(profile).resume` is the last channel when its source is still stored. `showLive(root, language, resume)` creates the live screen with `startCategory`, then `player.resume(row, index)` plays the kept item at once. When the list is in, `list.locate(key, guess)` (chunks from the guess outwards) moves the player to the found row; the kept row shows until that row's chunk is in.
  - Until the list is in, CH± do nothing.
  - A zap, a play or a close before the answer wins.
  - Not found: the kept item keeps playing, and zapping goes from its old row.
- **What is kept when:** the last channel when its stream opens (after the debounce), not at its first frame. The resumed channel isn't written again, but its found row is.
- **The subtitle timing is now per content** (a change to 20b2b):
  - `setSubtitleDelay` remembers it in the content's `TrackChoice.delayMs`;
  - a play sets the content's own timing (else 0), and `controller.subtitleDelay` reads it;
  - the menu shows it (`menu.showDelay`) without sending it back.
  - The size is one global preference.
- **User Timing marks** (`apps/tv/src/marks.ts`): `zoma:resume`, `zoma:resume-frame`, `zoma:live-ready`. Step 21 can read launch-to-frame from them on the TV.
- **e2e:**
  - `resume.spec.ts` (new);
  - `live.spec.ts`'s relaunch now lands in the player (it had played the kids' channel);
  - `player-media.spec.ts` relaunches and hears Arabic again.
- **Checks:**
  - 3,148 unit tests;
  - `pnpm verify` (58 e2e) and `pnpm e2e:media` (8) green;
  - mutation 86/86 (85/86 first run);
  - main 264.0 KB (Tizen) / 252.4 KB (webOS) of its own code, 219 core-js modules;
  - `verify:engines` left to CI (green).

## The player checklist for Omar (20b1 + 20b2b + 20c1; 20c2 adds its rows and makes it the full click-through)
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

**Not reachable in the app yet:**
- **Subtitle files:** no live channel has one, so the menu's file rows, its "Subtitle style" rows and the kept subtitle size first appear with VOD (step 26), or on a Samsung TV for embedded subtitles (19b and 21).
- **The audio choice after a relaunch:** desktop Chromium needs its Blink flag to list audio tracks. `pnpm e2e:media` covers it.

### The subtitles themselves: the playback harness
Open http://localhost:5173/playback.html, then the DevTools console (F12), and paste:

```js
const m = 'http://localhost:8080', a = 'zoma/zoma-test';
__ZOMA_PLAYBACK__.play({ url: `${m}/movie/${a}/206.mkv`, mode: 'vod', externalSubs: [
  { lang: 'eng', url: `${m}/subtitles/${a}/206.eng.srt`, fmt: 'srt' },
  { lang: 'ara', url: `${m}/subtitles/${a}/206.ara.srt?charset=windows-1256`, fmt: 'srt' } ] });
```

11. **`__ZOMA_PLAYBACK__.selectText('ext:0')`:** "English subtitle 00:05" and the rest appear bottom-centre, a new one every 5 s, each naming the time burned into the picture.
12. **`__ZOMA_PLAYBACK__.setSubtitleDelay(-5000)`:** each cue names 5 s ahead of the picture. `setSubtitleDelay(0)` puts it back.
13. **`__ZOMA_PLAYBACK__.selectText('ext:1')`:** the old Windows-1256 Arabic file reads correctly from right to left.
14. **`__ZOMA_PLAYBACK__.setSubtitleSize('l')`:** larger. `'s'` is smaller.
15. **`__ZOMA_PLAYBACK__.selectText(null)`:** the subtitles go.

## Gotchas and lessons
**New in leg 43** (also in memory):
- **A field named `at` pulled `es.array.at` and `es.string.at-alternative` into main a fourth time**, as a string-literal member (`last['at']`): 219 → 225 core-js modules. It is now `started`.
  - To check a change: diff each changed file's Babel-injected polyfills (a temporary script running `transformSync` with the build's preset-env options) against `git show <base>:<file>`.
  - Then count main with `artifacts/poly-count20c1.py` (219 is the number to keep).
- **Write the mutation list before running it.** Leg 43 found nine guards that could never change an outcome while writing the snippets, and removed them first.
- **A "the same value again remembers nothing" test** must count the writes; comparing the stored value passes either way.
- **A relaunch after any play now lands in the player.** In e2e, expect `player/actions/0`; Back shows the live screen on the category it played from.
- **`page.on('request')` with `/live/` also catches Vite's `/src/live/*.tsx`:** filter on the mock's host.
- **Long Bash heredocs with a Python patch failed twice more.** Write every multi-line script to `$CLAUDE_JOB_DIR/tmp` with the Write tool, then `python -I script.py <worktree>`.
- **The relay context check fired at about 452k tokens**, during the handover. Split 20c2 early.

**From earlier legs (still true):**
- **`pnpm e2e:media` is two specs,** `playback-media.spec.ts` and `player-media.spec.ts`. Run all of it when what `PlayerController` publishes changes.
- **Desktop Chromium's native HLS lists muxed TS audio as one unnamed track.** Route the live URL (`page.route(... 302 → MKV 206)`) for app-level track e2e.
- **A `Uint8Array` in a TV file pulls 35 core-js modules;** a `DataView` none.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files; the mutation run swaps them). Docs are safe.
- **Local e2e flakes on a busy PC:** the throttled test, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it.
- **Vitest:**
  - `quiet()` for a voided load;
  - awaiting a `FakeEngine.stop()` without advancing the clock deadlocks (use `void`);
  - no `__PLATFORM__` define;
  - fake-clock settles go through `setImmediate`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun.
- **Waiting for CI:**
  - read `gh pr checks <n>` once after `gh pr create`;
  - then a Monitor `until` loop on `gh pr checks <n>` that exits when nothing is pending (it worked for PRs #41 and #42);
  - never use `<(`.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs (Arabic catalog text has no Latin words of its own);
  - provider text uses `dir=auto` + `translate=false` or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(`, typed arrays, and members named like built-ins (`at`!);
  - the app imports only types from `@zoma/data` (its index drags every module's polyfills);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,148 unit tests, `pnpm verify` (58 e2e), `pnpm e2e:media` (8), mutation 86/86, the polyfill count (219 on both platforms).
  - PR #42's CI green on all three jobs; merged as `3cf09a1`.
  - Main's CI on `15fb322` green.
- **Not done:**
  - Main's CI on `3cf09a1` is unchecked.
  - The start on the last channel was never run on a TV (step 21 measures the 4 s target).
  - The kept subtitle size and the menu's file and style rows were never seen in the app (no subtitle files before VOD).
  - AVPlay's cues were never seen on a Samsung TV, and the player hasn't run on any TV.
- **Migrations and deploys:** N/A (no backend until step 29). Profile v3 is an on-device IndexedDB migration: it ships with the app and needs no production action.

## Open decisions and gates
- **20c2's split and its design** are the leg's judgement; record them.
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
- **Relay cap:** 60 legs (state.json). Leg 43 was the 43rd.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks; Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-two CLAUDE.md gaps** are waiting for his word:
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
  22. **new:** the `pnpm dev` row should say a relaunch plays the last channel (profile v3's `player` section), the `zoma:*` User Timing marks, and `createPlatform({ redirects })`.
- **Secrets:** none pending.
