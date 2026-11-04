# Zoma IPTV: relay leg 32 opening prompt

You are leg 32 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–30 did steps 1–15b3 (PRs #1–#29). Leg 6 did no project work.
- **Leg 31** split step 15c into 15c (S5) and 15c2 (S4, S8 and S5's luna route), then did **step 15c: S5, the `<video>` battery**.
  - Commits: `84861ae` (the split), `0960aa4` (the work), `16dc213` (the RELAY tick). PR **#30** was merged as merge commit **`a05621a`**, with the branch kept.
  - CI on `16dc213` was green on the first run: `verify` 8 m 12 s, `engines` 13 m 11 s (of its 25-minute limit), `media` 7 m 30 s (it now runs `pnpm lab:media` too).

## Your step: 15c2 (RELAY.md is the spec)
"The AVPlay batteries (S4, S8) and S5's luna route." **Done when:** the AVPlay battery runs against an AVPlay fake in unit tests; S4 and S8 post their rows in the desktop browser and the harness (skips without AVPlay); PR merged.

1. **Check first** that none of it exists:
   - `git log --oneline -8`;
   - `ls apps/tv/src/lab apps/tv/src/lab/spikes` (today the battery is `battery.ts`, `player.ts`, `video-player.ts`, `media.ts`, `spikes/s5.ts`; no `s4.ts`, `s8.ts`, AVPlay player);
   - `grep -rn avplay packages/platform-tizen/src` (nothing yet; AvplayEngine is step 19).
2. **Design (decide, then build):**
   - **The lab's player interface lives in the app** (`apps/tv/src/lab/player.ts`, `LabPlayer`), and `platform-tizen` may not import apps. Suggested split: `platform-tizen` exports a thin typed wrapper over `webapis.avplay` (`open`, `setListener`, `prepareAsync`, `play`, `stop`, `close`, `getCurrentTime`, `getTotalTrackInfo`, `setSelectTrack`, `suspend`, `restore`, `setDisplayRect`, `getState`). Only that package may touch `webapis` (lint). Step 19's AvplayEngine can reuse it.
   - The lab adapts that wrapper to `LabPlayer` (`avplay-player.ts`), reached behind `__PLATFORM__ === 'tizen'`, so the webOS and browser lab bundles tree-shake it out (`pnpm build:tv` checks platform isolation).
   - An AVPlay fake for the unit tests: listener callbacks (`onbufferingstart`, `onbufferingcomplete`, `oncurrentplaytime`, `onerror`, `onsubtitlechange`, `onstreamcompleted`) on the fake clock that `battery.test.ts` already has.
   - AVPlay renders below the HTML: the lab page needs a transparent hole (architecture.md §2 "AVPlay layering").
3. **S4** = `batteryChecks('S4', avplayDeps)` plus its own rows:
   - **the 302 freeze with and without the redirect probe:** an XHR aborted at `readyState 2` gives `responseURL` (architecture.md §2 "Redirect handling");
   - **`setSelectTrack`** for the audio switch;
   - **the subtitle text callback** (`onsubtitlechange`) feeding `cue` events;
   - **`suspend`/`restore`** (`LabPlayer.suspend/resume`).
   
   Its `canPlay` is null (AVPlay has no `canPlayType`). Without `webapis.avplay` (the desktop, the harness), every row skips.
4. **S8:** `webapis.avplaystore` pre-buffering. Two instances prepared at once; the switch to the prepared one ≤ 700 ms on 2020+ TVs. Skip without the API.
5. **S5's luna route:** `luna://com.webos.media/selectTrack` with `video.mediaId` (`{mediaId, type: 'audio', index}`), through the webOS adapter's luna helper. The `<video>` player needs `mediaId`; the battery's `audio-tracks` row then records which route worked (`audioTracks` or luna).
6. **The spike list:** S4 and S8 make 12 rows, which fit at 60 px (`[S0, S1, S2, S3, S7, S9, S10, S11, S4, S5, S8, S6]`). Inserting S4 before S5 shifts S5 to row index 9. Update `e2e/lab-media.spec.ts`: 8 DOWNs and then `lab/spikes/8` become 9 and `lab/spikes/9`.
7. **Each new check goes into four places:**
   - `DESKTOP` in `e2e/lab.spec.ts` (plus `BUNDLE` if a TV bundle answers differently: the Tizen bundle without `webapis` skips too);
   - `EXPECTED_STATUSES` (plus `PLATFORM_STATUSES`) in `tools/engines/src/lab.ts`;
   - the end-record counts in the e2e ("Run all": today `pass 16, fail 3, info 15, skip 20`);
   - `tools/engines/src/lab.test.ts` (today 54 checks, 56 records; `labSummary` `[fail 4, info 19, pass 16, skip 15 …]`). The harness test's table parser now accepts digits in check ids.
8. **Definition of Done** (CLAUDE.md):
   - `pnpm verify`;
   - `pnpm verify:engines --self-test` (102 runs, 74 seeds);
   - `pnpm verify:media`, which now ends with `pnpm lab:media`;
   - a mutation check (copy `artifacts/mutate15c.py` and run `--check` first; its `e2e-media` kind sets `ZOMA_LAB_MEDIA=1`);
   - a PR merged on green CI;
   - a "press these keys" checklist.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If the run on `a05621a` is red, fix it on the relay branch first. If only `engines` is red with "DevTools … did not answer", rerun it with `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`. Start Docker Desktop if `docker info` fails.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation. Use `git -C`, `pnpm --dir` and absolute paths. Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the package boundaries (`webapis` only in platform-tizen), the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 15c2, steps 15d–15e, step 16 (needs Omar), and the progress-log rows for legs 29–31.
3. Docs:
   - `docs/runbooks/lab.md` "S5";
   - architecture.md §2 (the PlayerEngine sketch, AVPlay layering, redirect handling, the watchdog) and §5 (the S4 and S8 rows, "Built in step 15c");
   - mock-provider.md "The player batteries' media".
4. The code:
   - `apps/tv/src/lab/battery.ts` (the checks; `BatteryDeps`, `openAndWait`, `switchAudio`, `soak`), `player.ts`, `video-player.ts` and `spikes/s5.ts`;
   - `battery.test.ts` (`FakeClock`, `FakePlayer`, the `battery()` helper);
   - `packages/platform-tizen/src` (`keys.ts`, `tv-settings.ts`: how the adapter wraps `webapis`).
5. Memory: `iptv-zoma-lab-gotchas`, `iptv-playwright-chromium-media` (new), `iptv-parser-test-patterns`, `bg-watcher-memory-reap`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md on top of `16dc213`. It also records PR #30's merge in RELAY.md. It is pushed, and the tree is clean.
- **main** has `a05621a`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (the app and the lab built from the merged sources), `.cache/*` (media included), the `zoma-old-engines:*` images;
  - in `artifacts/`: `mutate15c.py` (87 mutants) and its log, `verify15c.log`, `engines15c.log`.

## What step 15c built (for reference)
- **Mock:** `GET /__lab/media` (`apps/mock-provider/src/lab-media.ts`): `media` (`files`/`placeholder`) and ten items with their codecs and tracks from the manifest:
  - live 104 as TS and HLS, both also through 3 × 302;
  - TS with a stall after 600 KB;
  - VOD 3011 with a stall after 1 MB;
  - 4K HEVC 205;
  - multi-audio MKV 206 (AAC ara/eng/spa, AC3, E-AC3);
  - SRT in MKV 3001, mov_text in MP4 3011.
  
  The URLs carry the account; no record holds one.
- **`LabPlayer`** (`player.ts`): `describe`, `canPlay`, `open(url, {live, startMs})`, `snapshot`, `on` (`frame`, `waiting`, `error`, `ended`, `restart`, `cue`), `audioTracks`/`selectAudio`, `textTracks`/`showText`, `suspend`/`resume`, `caption`, `stop`, `dispose`.
- **The `<video>` player** (`video-player.ts`):
  - a box at the bottom right with a caption;
  - the first frame is a picture size plus the clock moved after the first `playing` (polled every 50 ms);
  - a muted retry on `NotAllowedError`;
  - suspend stops it; resume reopens live at the edge, VOD at its position.
- **The battery** (`battery.ts`), ten checks: `formats`, `ts`, `hls`, `redirect`, `hevc-4k`, `audio-tracks`, `ac3`, `subtitles`, and two that need a person: `suspend` and `soak`.
  - The soak's watchdog reopens after 6 s without progress, again every 6 s until a frame comes.
  - `?soak=` sets the minutes (60 by default, at most 180); on a TV the soak is always 60 minutes.
  - Against placeholder bytes, everything but `formats` skips.
- **`pnpm lab:media`** (Playwright project `lab-media`, in `pnpm verify:media`, CI job `media`), with `--enable-blink-features=AudioVideoTracks`: S5 alone by keys (a Home trip, a 1-minute soak) and a run at launch.
- **Shorter rows:** spike rows are 52 + 8 px, and a check with its note takes 64 px. Run order: `[S0, S1, S2, S3, S7, S9, S10, S11, S5, S6]`. Lab main 222.3 → 243.4 KB of its own code; the app unchanged.

## Gotchas and lessons
**New in leg 31** (also in memory: `iptv-playwright-chromium-media`, `iptv-parser-test-patterns`, `iptv-old-engine-screen`, `use-write-tool-for-doc-batches`):
- **Playwright's Chromium is Chrome for Testing 156**, on Windows and on CI Linux.
  - It plays H.264/AAC, native HLS, MKV and 302s.
  - It has no MPEG-TS (an error after about 3 s), no AC3/E-AC3 (they are dropped from the track list) and no in-band text tracks.
  - HEVC shows a picture only when headed (the GPU decodes it); headless gives sound alone.
  - `audioTracks` needs the Blink flag `AudioVideoTracks`.
- **Fake-clock polling grid:** an event fires on the poll after its time, so pick test times on the 50 ms grid (1250, not 1230).
- **A reset at the start of a run that every later step overwrites survives mutation.** Test the run that fails halfway after a good one; the stale state only shows there.
- **Python patch strings lose backslashes and `\'`** (a `'S4\'s'` became a broken TS string). Use raw strings (`r"..."`) for anything with a backslash, and double quotes in TS when the text has an apostrophe.
- **A background `cmd > log; echo exit $?` reports exit 0** even when `cmd` failed: the first verify "passed" with a typecheck error. Always read the log's own exit line.
- **The DevTools flake hit twice in a row locally** (chrome56, then chrome53 on the next full run). The third full self-test passed.
- **The Bash tool blocks `sleep N; cmd`.** Wait with Monitor, or `run_in_background`.
- **CI wait: copy leg 14's Monitor command from memory `bg-watcher-memory-reap` verbatim.** It worked first time again (PR #30).

**From earlier legs (still true):**
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one (cut three pairs this leg);
  - use exact float boundaries;
  - a guard that never fires in the browser needs a pure verdict;
  - after a screen closes, fire its event again and assert on the live signal.
- **`e2e/lab.spec.ts` declares its own `interface Record`** (so does `lab-media.spec.ts`): use index signatures there.
- **Bundle statuses differ per platform:** the e2e `BUNDLE` table, the harness `PLATFORM_STATUSES`. The harness test parses both e2e tables.
- **Mutation runs:**
  - never commit or build while one is going: it edits sources in place;
  - run mutation scripts with `python -I -u`.
- **The lab under `pnpm dev` shares the dev app's origin:** for a manual lab run next to dev data, use `pnpm --filter @zoma/app-tv exec vite --port 5174`.
- **IndexedDB:**
  - deletes go through `idb-delete.ts` (`blocked` is not a failure);
  - never `await` inside a transaction.
- **Perf budgets:** calibrate on CI (the 2-vCPU runner at 4x is about 2x slower than Omar's PC).
- **The `RemoteDriver` contract:**
  - a screen root has `data-screen/zone/index`, and its navigator goes to `showFocus`;
  - `INTENT_KEYS`: BACK is Escape, RED is F1, GREEN is F2.
- **Polyfills:** Babel picks core-js polyfills by property name. Probe each new file that reaches the app's main bundle (`artifacts/poly-probe.py`). Lab-only code is free of the app's budget.
- **Text:**
  - the Write tool turns `\uXXXX` escapes into raw characters;
  - text arguments carry isolate marks: compare with `stripIsolates`.
- **Root `test/`** can't import `@zoma/ui` or `.tsx` files. e2e may import `apps/tv/src/lab/battery.ts` and `media.ts`: no DOM or `.tsx` there.
- **Code rules:**
  - components stay hook-free;
  - CSS uses physical properties only (no grid or flex `gap` on Chromium 53);
  - TV code is `lib: ES2017`.
- **Old-engine harness:**
  - never edit the Docker image's `RUN apt-get` line;
  - it starts the mock with `--no-media`;
  - on the DevTools flake, rerun the whole self-test or the CI job.
- **e2e mocks:** the e2e mock pins its clock to 2026-11-02 12:00 UTC. Live media needs `mock({ now: Date.now, media: new FileMedia({ dir }) })`.
- **Dependencies:** new ones must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge with `gh pr merge --merge` on green CI and keep the branch;
  - check that the run's `headSha` is the PR's head first.
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #30
1. **CI job `media` now installs Chromium and runs `pnpm lab:media`** (about 2 min) as part of `pnpm verify:media`. A Chromium update that drops native HLS or MKV, or changes what headless HEVC does, would fail it. The e2e asserts `canPlayType` first, so the cause shows.
2. **The lab screen got shorter spike rows (52 + 8 px) and tighter check rows (64 px).** That affects every spike's screen. A screenshot was looked at with S5's ten checks finished (the last row ends at about 975 px).
3. **`/__lab/media` exposes the test account's media URLs**, like `/__lab/source` does. They go only to the lab, and the e2e asserts no URL reaches a record.

## Verified vs not
- **Verified:**
  - S5 in desktop Chromium 156, headless, on the generated media: Windows locally, and Linux on CI (`media` job). Every row's status and value is checked by `lab-media.spec.ts`.
  - The screenshots were looked at (the list, a row playing, the finished checks).
  - `pnpm verify`: 2,341+ tests, e2e 51/51.
  - `pnpm verify:engines --self-test`: 102 runs as expected, 74 seeds, S5 `formats` plus nine skips on 53/56/68.
  - `pnpm lab:media`: 2/2.
  - 87/87 mutants caught.
- **Not done:**
  - S5 on a TV (step 16): webOS's TS, AC3 and `audioTracks`, the native subtitle renderer, Home and back;
  - S5 headed in desktop Chrome (HEVC with the GPU was seen only in a probe);
  - S4, S8, S5's luna route (15c2); the docs (15d); emulators (15e).
- **Migrations and deploys:** N/A (no backend until step 29).
- **"Press these keys" checklist for S5 (desktop):**
  1. Run `pnpm mock:media` once, then `pnpm mock` and `pnpm dev`. Open `http://localhost:5173/lab.html?server=http://127.0.0.1:8080&auto=0&soak=1` at 1920x1080.
  2. Press ArrowDown 9 times (to S5), then Enter. The box at the bottom right plays each row with a caption.
  3. When the caption says "press Home…", switch to another tab for a few seconds, then come back.
  4. The soak runs for 1 minute.
  5. S5 shows FAIL overall:
     - `hls`, `redirect`, `suspend` and `soak` pass;
     - `ts`, `ac3` and `subtitles` fail as unsupported;
     - `audio-tracks` fails ("no audioTracks API") unless Chrome was started with `--enable-blink-features=AudioVideoTracks`;
     - `hevc-4k` may pass in a headed Chrome with a GPU.
  6. On a TV (step 16): runbook lab.md "S5 by hand".

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended: it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
  
  Data from S9: the old engines' `Intl` gives Arabic-Indic digits to every Arabic tag, ar-AE included.
- **Later, once the spikes have run on a TV:**
  - an on-screen keyboard of our own, if the TV keyboards fail;
  - a mapping for webOS's PRE-CH key;
  - the app's accessibility route;
  - `supportsAudioGuidance` in the app's appinfo.json;
  - the MSE engine, if webOS's native HLS has gaps (S5).
  
  These are product decisions for when the answers exist; nothing is blocking now.
- **Step 15e** (the lab in an emulator) likely needs Omar: VirtualBox, Tizen Studio, a Samsung account. Try the webOS TV Simulator first.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:**
  - steps 21, 34, 44, 46 and 47;
  - before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs; leg 31 was the 31st.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Twelve CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: onboarding or the live screen, `?screen=hello|gallery`, `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk, the focus agreement, the lab runs (102 runs, 74 seeds);
  6. a Conventions line on UI text (`appI18n`, `zoma/no-hard-coded-text`, `isolateText`, `TextField`/`createTextEditor`);
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__`, the `throttled` project;
  8. the `build:tv` row's lab target, `pnpm device … --lab`, and the platform-globals line (`PalmServiceBridge` is webOS-adapter only);
  9. a `pnpm lab:scale` row, and the mock row's `/__lab/source` and `/__lab/guide.xml.gz`;
  10. the `Platform` calls from step 15b2 (`setScreenSaver`, `screenReader`, `speak`) and where each adapter gets them;
  11. `Platform.registerKeys()` returns a `KeyRegistration` (Tizen `registerTizenKeys` in `keys.ts`);
  12. **new:** a `pnpm lab:media` row (S5 on the generated media, in `verify:media`), the `verify:media` row now ending with it, and the mock row's `/__lab/media`.
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
