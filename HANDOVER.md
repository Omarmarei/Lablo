# Zoma IPTV: relay leg 48 opening prompt

You are leg 48 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–46 did steps 1–20c2b and 22a, except step 16's Samsung part, 19b and 21 (PRs #1–#45).
- **Leg 47 split step 22b (the guides screen) into 22b1 and 22b2, and did 22b1, the data side:**
  - It merged as PR **#46** (merge commit **`99d7999`**, branch kept).
  - CI on `d37ec96`: verify 14 m 10 s, media 12 m 53 s, engines 14 m 6 s, all green on the first run.
  - Main's CI on `31b2658` (PR #45) was checked: green. Main's CI on `99d7999` was not checked yet.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 22b2, the guides screen and its way in (RELAY.md, Phase 6)
RELAY.md's 22b2 entry has the whole plan and its `Done when:`. In short:
- **The way in:** a "Settings" button at the end of the live screen's header, reached with UP from the first row of the rail or of the channel list. It opens a small settings screen whose one row, "TV guides", opens the guides screen. Step 38 adds the other settings rows later. No new remote key (a new intent would make S10's key battery ask every TV for it).
- **The guides screen:**
  - the user's guides in their order, then each source's own (from the playlist or panel; not editable);
  - each row: the link (`dir=ltr`, `translate=false`, the host and path, never the login), the programmes' end (`until`), the match rate (`summary.matched` of `summary.wanted`), the last failure, or "Reading…" while a change's refresh runs, or "Not read yet".
- **Changes:**
  - OK on one of the user's guides opens: Move up, Move down, Remove, Cancel.
  - "Add a guide": a link field (`TextField` + `createTextEditor`, onboarding's `normalizeLink`); a link already listed is refused.
  - A new guide's id is `g<n>`: one past the highest `g` id in the profile's list and in the stored guides (`u~g<n>` in `epgStatus().guides`), so an id whose records weren't deleted yet is never reused.
  - Each change: `editProfile({ kind: 'guide', change })`, then the scheduler's `refreshNow()`, then `epgStatus()` again when it settles.
- **Split it if it looks big** (for example the screens and unit tests first, the e2e and checklist second), and record the split in RELAY.md.

1. **Check for existing work first:** `git log --oneline -15`, then grep `settings`, `guides-screen`, `GuideChange` and `refreshNow` under `apps/tv/src`.
2. **What 22b1 built** (architecture.md §1.5 "Built in step 22b1" has it all):
   - **Profile version 4** (`packages/data/src/profile.ts`): `guides: UserGuide[]` in the user's order. `SourceRecord` has no `epgUrl` any more (`SourceRecordV3` is the old shape). Migrated guides and onboarding's typed one have their source's id (`s<n>`).
   - **Edits:** `ProfileEdit` `{ kind: 'guide', change: GuideChange }` with `{ op: 'add', guide }` (at the end; an id or link already listed changes nothing and returns `false`), `{ op: 'remove', id }`, `{ op: 'move', id, to }` (a place, clamped).
   - **Reading them:** `userGuides(profile)` in `apps/tv/src/onboarding/engine-loader.ts` (the scheduler and the loader use it).
   - **Why a guide failed:** `EpgMeta.failure?: { code, status } | null` (`EpgFailure` in `packages/data/src/epg-store.ts`). Codes are the ingest's: `http` (with `status`), `auth` (401/403), `network`, `format` (cut short or not XMLTV), `empty` (no live channels to match), `failed` (anything else). Cleared with `failedAt` by a refresh that finishes. Records written before 22b1 have none.
   - **The status to show:** `DataEngine.epgStatus()` → `EpgStatus { guides: EpgMeta[] (sorted by rank), matched, sources }`. Per guide: `epgSrc`, `gen` (0: never read), `until` (UTC minutes), `summary` (`wanted`, `matched`…), `failedAt`, `failure`, `rank`.
   - **Which guide is whose:** `u~<id>` is a user guide; `<src>:xmltv` a panel's own; `<src>:tvg<n>` a playlist's `url-tvg`. The source's name is in the profile's `sources`. A source guide's URL isn't in `EpgMeta`: `epgGuides(catalogs, status.sources, user)` from `@zoma/data/client` gives each guide's URL (an Xtream `xmltv.php` URL holds the login: show the host only, never the query).
   - **`RefreshScheduler.refreshNow(): Promise<void>`** (`apps/tv/src/data/refresh-scheduler.ts`): the guides alone, at once, or right after the pass running; settles when its pass ends. `main.tsx` keeps the scheduler in `refreshes` (made in `startRefreshes` for the live screen). The screen needs it passed in.
   - **No "refresh now" button** (decided): a failed guide waits its 2 h; removing it and adding it again gives a new id, read at once.
3. **Where to start in the code:**
   - The live screen: `apps/tv/src/live/live-state.ts` (zones `rail`, `channels`, `retry`; `railZone`/`channelsZone` take `neighbours`; a header zone with `neighbours: { down: 'channels' }` and the rail/list with `up: 'header'`), `LiveApp.tsx` (the header markup; `focus.screen` decides what paints, as the player's `player`/`tracks` screens do), `live.css` (`LIVE.headerHeight` 56).
   - Screens pushed on the live navigator: the player (`player-state.ts`, `nav.push({ id, zones, onIntent, onSelect })`) and the exit dialog. Back pops.
   - Text input: onboarding (`onboarding-state.ts` `createTextEditor` + `bindEditor`, `OnboardingApp.tsx` `TextField`), `form.ts` `normalizeLink`.
   - Formats: `AppI18n` has `time`, `date`, `weekday`, `percent`, `number` (`packages/ui/src/i18n/runtime.ts`); strings in `apps/tv/src/i18n/en.ts` and `ar.ts` (`catalogs.test.ts` checks them).
4. **Sizes:** main 277.0 KB (Tizen) / 264.4 KB (webOS) of 500; query worker 99.6 KB, EPG worker 115.6 KB, ingest worker 126.0 KB, each of 150. Count core-js modules after any TV-file change with `artifacts/poly-count20c2a.py` (`python -I -u`): 219 on both, keep it.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: steps 22b, 22b1 and 22b2; the progress-log rows for legs 21, 24 and 45–47.
3. `docs/architecture.md`:
   - §1.5 "Built in step 22b1" (the newest; also the shape of a "Built in" note) and "Built in step 22a";
   - §1.2 "Built in step 13a" (text input on a TV) and "Built in step 14a" (the live screen);
   - §2 "Built in step 20a" and "Built in step 20b1" (screens pushed over the live screen: the player and its track menu).
4. The code listed in "Where to start" above.
5. Tests: `apps/tv/src/live/live-state.test.ts`, `apps/tv/src/onboarding/onboarding-state.test.ts`, `apps/tv/src/player/player-state.test.ts` (a pushed screen's tests), `e2e/live.spec.ts`, `e2e/onboarding.spec.ts` (typing by keys, `storedProfile`), `e2e/refresh.spec.ts` (the in-process mock, counting requests), `e2e/remote-driver.ts`.
6. Memory:
   - `iptv-ui-test-gotchas`;
   - `iptv-mock-provider-gotchas`;
   - `iptv-tv-bundle-polyfills`;
   - `iptv-parser-test-patterns`;
   - `iptv-css-pipeline-gotchas`;
   - `use-write-tool-for-doc-batches`;
   - `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv` (the run on `99d7999`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `492cb56` ("docs: record PR #46's merge"). It is pushed, and the tree is clean.
- **main** has `99d7999` (PR #46). The branch is ahead by `492cb56` and the handover commit, both docs; they go to main with step 22b2's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the generated media included), `dist/` (built from the final code);
  - `artifacts/`, which includes:
    - `mutate22b1.py` and `.log` (the newest mutation template: 60/60 on the first run);
    - `poly-count20c2a.py`: counts main's core-js modules from Rollup's module table (219 on both);
    - `verify22b1.log`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1. The CLI device `tv` is `prisoner@192.168.1.8:9922`. The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator zips and AppImages in `D:/tools/webos-sim/`, and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Facts and decisions from leg 47 (step 22b1)
- **The migration copies a source's fields one by one** instead of an object rest, and the guide edit uses `splice(at, 1)[0]` instead of array destructuring: those would bring Babel's helpers into the workers. Keep that style in TV and worker code.
- **A rank is a guide's place in the list the refresh gets** (`epgGuides` order: user guides first). The EPG refresh's first step sets each stored guide's rank to its place with no download (`setEpgRank`) and reports it in `EpgRefreshResult.reranked` (a new required field: every hand-built result literal in tests needs `reranked: []`). The data engine starts the worker when `listed.indexOf(epgSrc) !== rank` for any stored guide (one check covers "gone" and "moved") and reloads the query worker after a rank change. A refresh with `only: []` returns before reading the live items.
- **Outcome errors carry `status`** (`{ code, status, message }`): hand-built failed outcomes in tests need `status: null`.
- **Onboarding** writes two edits: the source, then its typed guide (unless the list has the link). A guide that fails to read stays in the list.
- **A shared address is read once:** an Xtream source's `xmltv.php` that equals a typed guide's link is read only as the user's `u~<id>` (`test/onboarding-loader-mock.test.ts`).
- **Checks:** 3,330 unit tests (+18); `pnpm verify` green (64 e2e; `onboarding.spec.ts` reads back profile v4 with `guides`); mutation 60/60; main +0.4/+0.4 KB, 219 core-js modules.

## How Omar can see step 22b1
Nothing new to click: it is the data under step 22b2's screen.
- **Quickest:** `pnpm exec vitest run packages/data/src/profile.test.ts test/tv-data-engine.test.ts` (the migration, the edits, a moved guide's rank with no download).
- **By hand:** onboard with the mock (`pnpm mock`, `pnpm dev`, server `localhost:8080`, user `zoma`, password `zoma-test`) and type a guide link (`localhost:8080/xmltv.php?username=zoma&password=zoma-test`). In DevTools → Application → IndexedDB → `zoma` → `profile` → `current`, the document is `v: 4` with that link in `guides` under `s1`, and the source has no `epgUrl`.
- **The step-20 player checklist** is in the leg-45 handover: `git show b3c53af:HANDOVER.md`.

## Gotchas and lessons
**New in leg 47** (also in memory):
- **`splice` rounds and clamps its index itself**, so a `Math.floor`/`Math.max` before a splice only matters where the code compares the index (a "no change" check): test a fraction or a negative that lands on its own place.
- **A Bash heredoc with an apostrophe inside a Python patch failed to parse again.** Write every patch script with the Write tool to `$CLAUDE_JOB_DIR/tmp`, then `python -I <script> "<wt>"`.
- **Waiting for CI:** a foreground `until ! gh pr checks N … | grep -q -E "pending|in_progress|queued"; do sleep 30; done` with `timeout: 600000` works (moved to the background at 10 min, which is fine); a bare `sleep 25; gh …` is blocked.

**From earlier legs (still true):**
- **Playwright's page clock in e2e** (`e2e/refresh.spec.ts`): `page.clock.install()` before `page.goto`; `page.clock.fastForward('02:01:00')` fires each due timer once; workers and the mock keep the real clock.
- **Counting what the app asks the mock:** `app.addHook('onRequest', …)` on the in-process mock before `listen(app)`. Switch scenarios with `app.mockState.scenario = null` (or start with `mock({ scenario: 'no-xmltv' })`).
- **Mutation lessons:** the navigator clamps `focus(-1)` (test a gone item whose row still exists); re-ask a middle LRU entry, not the oldest; a signal set to a new array redraws the screen anyway (a `bump()` beside it is masked); write the mutation list first and remove masked guards before the run.
- **Python patch scripts:** a multi-file patch that exits on its first miss may have written earlier files: check `git status` before rerunning.
- **Waiting for a PR's checks:** read `gh pr checks N -R Omarmarei/zoma-iptv` once in the foreground first (right after `gh pr create` it says "no checks reported"); never `&&` on gh's exit code (non-zero on a failed check).
- **`pnpm e2e:media` is two specs,** `playback-media.spec.ts` and `player-media.spec.ts`. Run all of it when what `PlayerController` publishes changes.
- **TV bundle polyfills:** a field or member named `at` pulls `Array.at` polyfills (`time`, `started`, `cuesAt`); a `Uint8Array` in a TV file pulls 35 core-js modules, a `DataView` none; count main after any TV-file change (219).
- **Every hand-built mock `Account` literal in tests needs `outputFormats`.** Every hand-built `PlayerEngine` needs `caps.fits` and `setFit`.
- **The Write tool turns `\u200f`/`\u00a0`/`\u2068` escapes into raw characters.** Use `String.fromCharCode`.
- **@preact/signals skips redrawing a child whose props didn't change.** Pass plain data as props.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files; the mutation run swaps them). Docs are safe.
- **Local e2e flakes on a busy PC:** the throttled test, the lab's S2. `pnpm build:tv` can crash natively (0xC0000005): rerun it.
- **Vitest:** `quiet()` for a voided load; awaiting a `FakeEngine.stop()` without advancing the clock deadlocks (use `void`); no `__PLATFORM__` define; fake-clock settles go through `setImmediate`.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs; Arabic catalog text needs an Arabic letter and has no Latin words of its own;
  - provider text, URLs and technical names use `dir=auto`/`dir=ltr` + `translate=false`, or `isolateText`;
  - CSS uses physical properties only;
  - TV code is `lib: ES2017`; avoid `JSON.stringify`, `new RegExp`, `.split(`, typed arrays, and members named like built-ins (`at`!); leg 47 also avoided object rest and array destructuring in worker code (Babel inlines a helper for each; the effect was not measured);
  - the app imports only types from `@zoma/data` (values from narrow entries like `@zoma/data/client`);
  - a new screen root needs `data-screen/zone/index` and `showFocus`;
  - a new profile shape needs a migration in `PROFILE_MIGRATIONS` (pure, never drops data; pin the version in `profile.test.ts`). An optional field needs none.
- **Dependencies** must be at least 2 weeks old, transitive ones included. Never weaken lint.
- **Commits:** scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,330 unit tests, `pnpm verify` (64 e2e), mutation 60/60, the polyfill count (219 on both platforms).
  - PR #46's CI green on all three jobs; merged as `99d7999`.
  - Main's CI on `31b2658` green.
- **Not done:**
  - Main's CI on `99d7999` is unchecked.
  - The guide list has no screen yet (22b2): nothing in the app adds, removes or moves a guide, and `refreshNow` has no caller.
  - The 3 → 4 migration has never run on a TV (unit tests and fake-indexeddb only).
- **Migrations and deploys:** N/A (no backend until step 29). Profile version 4 is an app-side IndexedDB document migration, not a production migration.

## Open decisions and gates
- **Step 22b2's split, if any,** is the leg's judgement; record it.
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
  - a settings screen for the track languages, the subtitle style and the picture mode (step 38, on 22b2's settings screen);
  - parsing subtitle files off the main thread.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41); whether a low-tier TV holds refreshes while it plays (step 41).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 60 legs (state.json). Leg 47 was the 47th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks; Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session" (was the PC extend real?).
- **Twenty-six CLAUDE.md gaps** are waiting for his word:
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
  26. **new:** the Conventions line on profile migrations should name version 4 (the guide list).
- **Secrets:** none pending.
