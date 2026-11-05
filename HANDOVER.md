# Zoma IPTV: relay leg 64 opening prompt

You are leg 64 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–63 did steps 1–25 (PRs #1–#63), except step 16's Samsung part, 19b and 21.
- **Leg 63:**
  - merged PR #62 (step 25c) as `7a045d7`;
  - built step 25d (the catch-up player's seek bar, pause, seeking and the programme's end);
  - merged it as PR #63, merge commit `e36c10e`;
  - ticked 25d and step 25 (catch-up is done).
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open.
- **Relay cap:** 100 legs (`relay.py status`).

## Next: step 26 (RELAY.md, Phase 7: "Movies, series, search")
Step 26 reads: "Movies. Poster grids with tiered image caps, details, resume, 'Recently added'." It has no Done-when of its own and is far bigger than one session.
1. **Check what exists** (global CLAUDE.md, "Before Implementing Anything"):
   - `git log --oneline -50`, and grep for `movie`, `vod`, `poster`, `resume`, `recently`;
   - the catalog's VOD items (`packages/core`'s model, the Xtream `vod_streams` ingest in `packages/data`);
   - the query worker's VOD queries;
   - the player's VOD mode (`PlayRequest.mode: 'vod'`, the controller's `resumeMs` and its 20 s VOD buffering rule; 25d's `positionMs`/`seek`);
   - PLAN.md and docs/architecture.md on movies, poster caps and resume;
   - the header's sections in `apps/tv/src/live`.
2. **Split step 26 into session-sized sub-steps in RELAY.md**, as leg 60 split 25 into 25a–25d. Each sub-step gets:
   - a `Done when:` check that can be run;
   - step 25's common items: unit tests, e2e by keys in en and ar against the mock with the screenshots looked at, a mutation run with the list written first, `pnpm verify` green, main within budget with 219 core-js modules on both, the PR merged, and a "press these keys" checklist in the handover.

   A possible order:
   - 26a: the movie categories and a poster grid (tiered image caps, the old engines);
   - 26b: the movie details and playing a movie;
   - 26c: resume (accurate position, the profile's memory);
   - 26d: "Recently added".

   Decide the split from what exists. Commit it to RELAY.md first.
3. Build 26a, under the same rules as every step.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of these (pushed; the tree is clean):
  - `3ad6732` docs: record PR #63's merge, tick steps 25d and 25;
  - `e36c10e` Merge pull request #63;
  - `c503184` docs: step 25d;
  - `1837b7b` test;
  - `7d2fdfb` fix (the mutation findings);
  - `1dd0600` e2e;
  - `95dbdfe` feat;
  - `4d355a8` docs: record PR #62's merge;
  - `7a045d7` Merge pull request #62.
- **main** is `e36c10e`. The branch equals main plus the docs commits.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (`.cache/media` has the generated media for `e2e:media`), `dist/`;
  - `artifacts/`:
    - `mutate25d.py` (the newest unit template: 72 mutants over controller, catchup and player-state) with `mutate25d.log` and `mutate25d-b.log`;
    - `mutate25c-e2e.py` (the newest e2e template);
    - `verify25d.log` (cut short, see below);
    - `poly-count20c2a.py`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit them (LG's license; the repo is public).

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R Omarmarei/Lablo` and absolute paths. **Never `cd`.**
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`** (the product is still "Zoma"):
  - CI runs on `pull_request` and `workflow_dispatch` only. Its jobs are path-filtered over the whole PR's diff: docs alone run none; `engines` runs on TV bundles and their harness; `media` on the mock, data layer, player, lab or scale tests.
  - Commits use the no-reply email (the repo-local config sets it).
  - No secrets, no LG binaries, no personal data in commits.
- **Merging:** IPTV PRs merge on green CI without Omar (memory: merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## What step 25d built (architecture.md §1.2, "Built in step 25d"; ADR-010, "Applied in step 25d")
- **The controller:** `positionMs()` gives the media time while a picture shows (else 0). `seek(ms)` seeks inside a VOD or catch-up stream on show: a reopen starts there, and a pause stays a pause. `FakeEngine.seek` now moves the position (`seekOk` refuses).
- **The seek bar:**
  - The player's screen has a zone `seek` above `actions`. It holds one item in a catch-up and none live (`seekBar(on)`).
  - It shows "Paused", elapsed / length around a `ProgressBar media` (a `dir="ltr"` island), and "Aired at {time}" (`player.aired`).
  - `Player.position` is `{ time, seeking, live }`, read every 1 s (`POSITION_MS`). Only `SeekBar` reads it. Note the field is `time`, not `at` (Babel polyfills).
  - In a catch-up, UP and DOWN move between the bar and the buttons, and CH± zap. When the bar hides, the focus goes back to it.
  - OK on the bar (through `onSelect`) and PLAY_PAUSE pause.
- **Seeking:**
  - LEFT/RIGHT move 1 min and FF/RW 5 (`seekStep`; from a held key's ninth press, 5 and 10). A run is presses under `HOLD_MS` 300 ms apart, same direction and kind.
  - One seek happens `SEEK_DELAY_MS` (600 ms) after the last key.
  - An HLS archive showing a picture, for a target after the stream's start, seeks inside it (`controller.seek`). If the engine refuses, it falls back to a URL.
  - Anything else plays again by URL from `Math.round(target / 1 min)`: `catchupRequest(row, programme, facts, now, fromMs)`.
  - The target is clamped to [start, end − 1 min]. A raw target at or past now goes live.
- **The end:**
  - Play-on: 5 s past the end (`PLAY_ON_MS`), it asks `programmeAt` (main.tsx: `DataEngine.nowNext([key], at)`) once per end, and takes only a programme starting at or after the shown one's end.
  - The controller's `ended` with an archive shows `EndCard`: "The programme has ended" (`player.ended`), "Watch live" (`player.watchLive`, plays live) and "Back to the guide" (`player.toGuide`, closes).
  - A card drops a waiting seek.
- **New catalog keys** (en, ar): `player.paused`, `player.position`, `player.aired`, `player.live`, `player.ended`, `player.watchLive`, `player.toGuide`.
- **Decided (not gates):**
  - whole-minute steps;
  - a URL seek rounds instead of seeking inside a TS download;
  - PLAY_PAUSE toggles (webOS maps PLAY and PAUSE to one intent);
  - the media timeline runs left to right in Arabic too (RIGHT is forward), while the guide's timeline mirrors.
- **Tests:**
  - unit +20 (controller 5, catchup 2, player 13); 4,139 in the last full local run, before 3 more;
  - e2e `guide-catchup-seek.spec.ts` (en-US, ar-SA);
  - `player-media.spec.ts`'s catch-up test seeks inside HLS and pauses (`e2e:media`);
  - the 25a–25c specs open on `player/seek/0`.
- **Mutation:** 76 written, 66 caught. Six test gaps were closed and four redundant pieces taken out; the re-run caught 10/10.
- **Size:** main 354.8 KB (Tizen) / 342.2 KB (webOS); app.css 75.4 KB; 219 core-js modules on both.

## Gotchas and lessons
**New in leg 63** (also in memory):
- **Don't push to an open PR's branch while its CI runs.** The push cancels the run in progress (concurrency): leg 62's handover push cancelled its media re-run. The path filter looks at the whole PR, so a docs-only commit still runs every job. Push docs or a handover only after CI finishes, or after the merge.
- **CI media "Install ffmpeg" hung again** (29 min, cancelled at the 30-min limit). One `gh run rerun <run> --failed -R Omarmarei/Lablo` passed. Read the job's steps to see where it hung.
- **Non-media e2e that presses keys in the player:** the synthetic media fails fast and the error card takes the keys. Hold the stream instead: `page.route('**/timeshift/**', async (r) => { await r.fetch().catch(() => undefined); })`. The mock still records the request; the page waits.
- **Local `pnpm verify` died again**: workers exit 0xC0000142 at the unit stage, then the shell is reaped for low memory. Don't restart it. Run lint, typecheck, unit (or the touched packages) and `build:tv` separately in the foreground, run the touched e2e specs, and let CI's verify run the rest.
- **The player's OK:** OK on a focused zone item reaches the screen's `onSelect` when `onIntent` returns false. Don't duplicate OK handling in `onIntent` (the mutation run found it equivalent).
- **`ZoneSpec` is a union:** read a zone's `count` in tests with `toMatchObject({ count })`. `.count` fails typecheck, and only `pnpm verify`'s typecheck shows it (vitest doesn't typecheck).

**From earlier legs (still true):**
- **The relay context check fires at about 450k tokens.** Budget code and e2e first, then mutation, docs, verify, PR, merge.
- **The guide:** days the guide hasn't read move by 30-minute slots, so press in rounds (`backTo`). The mock's guide reaches back only each channel's own archive days.
- **The mock:**
  - Its panel zone is UTC by default. `odd-timezone` is Kathmandu (+05:45).
  - Its synthetic media never plays. Real frames: `ZOMA_E2E_MEDIA=1 pnpm exec playwright test --project=playback-media player-media -g "<title>"` (PowerShell: `$env:ZOMA_E2E_MEDIA = '1'`).
- **Tests:**
  - Root tests can't import an apps/tv module that reaches `@zoma/ui` (TS6142 shows only in `pnpm verify`).
  - vitest's `testTimeout` is 30 s. A fake-clock promise (`await r.player.stop()` on `FakeClock`) hangs until the clock advances.
  - Playwright `--project chromium <file>` reads the file as a project name: use `--project=chromium <pattern>`.
- **`SettingsScreen.tsx` and `main.tsx` are CRLF in the index** (Git warns that LF will replace CRLF). Patch scripts preserve the line ending.
- **The Edit and Write tools decode `\u` escapes.** Bash heredocs feeding python mangle non-ASCII: use Write-tool scripts.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Docs are safe. If a mutation run is stopped, look for `*.mutbak`.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files;
  - count main after any TV-file change (219 modules: `python -I -u artifacts/poly-count20c2a.py`, after `pnpm build:tv`);
  - the build can crash once (0xC0000005): run it again.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs;
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only (an LTR island needs margins that are the same on both sides);
  - TV code is ES2017;
  - the app imports only types from `@zoma/data`;
  - dependencies must be at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` and `Claude-Session` lines.

## Verified vs not
- **Verified:**
  - **Locally:**
    - lint, typecheck, the full unit suite (4,139) and both TV builds (219 modules), before the mutation fixes;
    - the player tests (350) after them;
    - e2e: every catch-up spec (11), player/live/guide (18), the seek spec (en, ar), and the media catch-up test with an in-stream seek and pause;
    - mutation 66/76 then 10/10;
    - screenshots `guide-catchup-seek-{en-US,ar-SA}` and `player-catchup-paused-en` looked at.
  - **On CI (`c503184`):** verify 6 m 57 s, engines 14 m 51 s, media 10 m 32 s (second try).
- **Not done:**
  - the full local `pnpm verify` after the mutation fixes (reaped; CI's passed);
  - the end card and play-on in an e2e (unit only);
  - catch-up and seeking on a TV. RELAY.md step 41 now lists what each TV must confirm: an archive's media time starting at 0, AVPlay `seekTo` and webOS seeking in HLS, a URL seek's reconnect time, the PLAY/PAUSE keys, a real end card.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player itself (step 21). Catch-up, its seeking and the guide's marks can join that visit.
- **Later, from leg 63:** fine seeking (seconds) inside HLS archives; "start over" for the programme on air; separate PLAY and PAUSE intents.
- **Later, from leg 62:** a day jump in the guide (FF/RW, a day picker, or holding LEFT faster).
- **Later (unchanged):**
  - an on-screen keyboard if the TV keyboards fail;
  - webOS's PRE-CH key;
  - the accessibility route;
  - pre-buffered zapping;
  - the last frame kept while reconnecting;
  - step 38's settings rows;
  - parsing subtitle files off the main thread;
  - a remote's own Guide or Info key;
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier;
  - holding refreshes while a low-tier TV plays;
  - the catalogs as UTF-8;
  - a "loading" look for unread rows;
  - the details, the settings and the picker on the old-engine walk;
  - a screen for a guide's own zone;
  - `SourceMemory` for catch-up.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.

## "Press these keys" checklist for step 25d (Omar, in `pnpm dev` with `pnpm mock`)
1. Onboard with the mock's Xtream login, then "Start watching".
2. UP to the header, then OK on "Guide". On "Zoma Test 1 SMPTE", press LEFT once, OK, then OK on "From the start".
3. The player opens with the seek bar focused (a ring around it): "0:00", the bar, the programme's length (e.g. "1:00:00"), and "Aired at 4:00 PM".
4. Press RIGHT three times quickly. The bar jumps to "3:00" at once (in the accent colour), and the stream reopens from 3:00 about half a second later.
5. Press FF: "8:00". Hold LEFT: it runs back to "0:00" and stops there.
6. DOWN moves the focus to "Previous channel"; UP brings it back to the bar. CH+ zaps to the next channel live, and the bar is gone.
7. With real media (`pnpm mock:media` media playing, as in `e2e:media`):
   - OK pauses ("Paused" on the bar) and OK plays on;
   - RIGHT seeks inside the HLS archive without "Connecting…".
8. Arabic (`?locale=ar-SA`): the timeline still runs left to right, RIGHT goes forward, and "وقت البث" sits at the bar's left end.
9. The end: FF to the programme's last minute and let it play out. "The programme has ended" shows. OK on "Watch live" plays the channel live; "Back to the guide" returns to the guide's cell.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description (108 runs, 80 that must fail).
- **Secrets:** none pending.
