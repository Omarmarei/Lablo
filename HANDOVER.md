# Zoma IPTV: relay leg 62 opening prompt

You are leg 62 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–60 did steps 1–24 and 25a, except step 16's Samsung part, 19b and 21 (PRs #1–#60). Leg 60 split step 25 (catch-up) into 25a–25d.
- **Leg 61 did 25b**, catch-up from an M3U source and the panel behind a `get.php` link. It merged as PR **#61** (merge commit **`c144172`**). CI on `a8d7835` was green on the first run: verify 7 m 51 s, media 9 m 26 s, engines 16 m 0 s. Leg 61 stopped once at the usage limit and resumed in the same conversation.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open.
- **Relay cap:** 100 legs (`relay.py status`).

## Your step: 25c, the catch-up days in the guide, the archive marks and the low-tier tuning (RELAY.md, Phase 6)
Read 25c's text and Done-when in RELAY.md, plus step 25's common items (unit tests; e2e by keys in English and Arabic with the screenshots looked at; a mutation run with the list written first; `pnpm verify`; main within budget with 219 core-js modules; the PR merged; a "press these keys" checklist). In short:
- **The range:** the guide reaches back as far as the longest catch-up among the channels, within the EPG window's past days (up to 7 in the full tier, 2 in the low one), instead of the one day of `GUIDE_DAYS.past`.
- **The marks:** programmes a channel's archive holds get a small catch-up mark on the cell, named in the cell's text for the screen reader. The details say how long the programme can still be watched.
- **Low-tier tuning without the device:** `e2e/guide-throttled.spec.ts` with the catch-up days in range (7 back in the full tier, 2 in the low one) stays within 150 ms per press. Measure the marks' cost in the low tier, and note what the 2018 TV must confirm in step 41.
- **Done when** also includes the throttled run green in both tiers on CI, and the old-engine harness's guide walk still green, with the marks drawn on Chromium 53/56/68.

**Where to look:**
- `GUIDE_DAYS` in `apps/tv/src/guide/guide-state.ts`.
- `EPG_WINDOWS` in `packages/core/src/epg-guide.ts` (line 65): the stored window already keeps the longest catch-up's days.
- `canWatchFromStart` in `apps/tv/src/player/catchup.ts`: the archive test the marks should share.
- `GuideGrid` in `packages/ui/src/components/` (hook-free; `guide-layout.ts`).
- The old-engine walk: `tools/engines/src/guide.ts`, `guide-drawn.ts`.
- The throttle: `e2e/guide-throttled.spec.ts`, `e2e/throttle.ts`.

**First check what exists:** `git log --oneline -10`, and grep `GUIDE_DAYS`, `archive` and `catchup` in `apps/tv/src/guide` and `packages/ui/src/components/GuideGrid*`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.
3. Main has no CI run after merges: nothing to check there.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R Omarmarei/Lablo` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `3acada6` ("docs: record PR #61's merge, tick step 25b"), on top of `c144172` (main; the branch was fast-forwarded to it). It is pushed, and the tree is clean.
- **main** has `c144172`. The branch is ahead by two docs commits, which go to main with 25c's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the 300 MB fixtures and the generated media), `dist/` (built from the current code);
  - `artifacts/`, which includes:
    - `mutate25b.py` (the newest unit template, 27 mutants), `mutate25b-e2e.py` (the newest e2e template, run against `e2e/guide-catchup-m3u.spec.ts`), and `mutate25a.py`/`mutate25a-e2e.py` (app-side templates: the guide, the details, the player), with their logs;
    - `poly-count20c2a.py`;
    - `verify25b.log`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license; the repo is public).

## The repo is public (`Omarmarei/Lablo`)
- **Use `-R Omarmarei/Lablo`** with `gh`. The worktree's `origin` is `https://github.com/Omarmarei/Lablo.git`. The product is still "Zoma" in code, app IDs and docs.
- **CI runs on `pull_request` and `workflow_dispatch` only.** A `changes` job picks the jobs: docs alone run none; `engines` runs when the TV bundles or their harness change; `media` when the mock, data layer, player, lab or scale tests change.
- **Commits use the no-reply email** `58913863+Omarmarei@users.noreply.github.com` (the repo-local config sets it).
- **It is public:** no secrets, no LG binaries, no personal data in commits.
- **Merge rule (memory):** IPTV PRs merge on green CI (merge commit, keep the branch). Give the 3 riskiest changes first.
- **Waiting for CI:** leg 61's Monitor loop over `gh pr checks --json … || echo "[]"` piped to `jq` stayed silent for 30 minutes while CI went green. Use the saved-output form from memory (`gh-pr-checks-watch-race`). When a watch is silent, read `gh pr checks <n> -R Omarmarei/Lablo` in the foreground.

## Facts from leg 61 (step 25b)
- **The login:** `runIngest` logs in once per refresh to the panel behind an M3U `get.php` link (`xtreamFromM3uUrl`), before the playlist (`panelLogin` in `packages/data/src/ingest.ts`).
  - It covers 304 and unchanged refreshes too.
  - It has its own transport: not hashed, no progress, never `current`.
  - It has a time limit: `PANEL_LOGIN_MS` = 10 s, or `IngestOptions.panelLoginMs`.
  - The source keeps `server` and the account's `outputFormats`, as Xtream does.
- **A failed login never fails the refresh.** The last login's facts stay (UTC without one): the patch then leaves `server` out. A plain playlist still writes `server: null`.
- **The playlist's own guide:** `epgGuides` gives a named guide that is a panel's `xmltv.php` with a login `zone: { panel: <src> }`. Every other guide a playlist names stays UTC.
- **No app code changed:** 25a's `catchupCandidates`/`catchupRequest` already made every mode's URL.
- **The mock's modes:**
  - `get.php` without `output` serves TS: 106's URL is `/flussonic/u/p/106/mpegts` → `timeshift_abs-{start}.ts`.
  - `append`/`shift` play on to now, and so does flussonic TS.
  - The M3U "All channels" order equals `ordered` (e2e/live-rows.ts): 101 row 0, 102 row 1, 103 row 4, 105 row 7, 106 row 8.
- **Tests and size:**
  - 4,050 → 4,066 unit tests.
  - e2e `guide-catchup-m3u.spec.ts` (3 tests); `e2e/onboard.ts` now has `addM3uAndWatch`, sharing `toSourceTypes`/`startWatching` with `addXtreamAndWatch`.
  - Full local `pnpm verify` green: 93 e2e.
  - main 346.9 KB (Tizen) and 334.3 KB (webOS) of 500; ingest worker 127.9 KB of 150; query 107.2, EPG 117.2; app.css 72.5 KB; 219 core-js modules on both.

## Gotchas and lessons
**New in leg 61** (also in memory):
- **Root tests can't import an apps/tv module that reaches `@zoma/ui`,** even through type imports (`player/catchup.ts` → `live/live-state`). The root typecheck then fails with TS6142 on `packages/ui/src/index.ts`, and only `pnpm verify` shows it: the test runs fine. `apps/tv/src/data/engine.ts` is safe. `@zoma/player` isn't a root dependency: import `../packages/player/src/request` by path.
- **vitest's `testTimeout` is 30 s,** so a test of a cancel or a time limit can pass by waiting out the default. Pass a long limit and assert the elapsed time.
- **A panel in any zone without a fixture:** `mock({ now: () => Date.now(), scenario: parseScenario({ rules: [{ match: { path: '**' }, faults: [{ type: 'timezone', tz: 'Asia/Riyadh', xmltv: 'none' }] }] }, 'riyadh') })`. Use `parseScenario` from `apps/mock-provider/src/faults.ts`, or set `app.mockState.scenario` mid-test. A failing panel API: add a rule on `/player_api.php` with `{ type: 'status', status: 503 }`.
- **The synthetic media fails at once, and an M3U catch-up has one URL,** so under load the player's error card takes the focus before a `go('OK', 'player/actions/0')` check. Accept `player/card/0` too: only the full verify showed it.
- **Python patch scripts in Bash heredocs lose `\\` in regex text.** Write the file whole with the Write tool instead.

**From earlier legs (still true):**
- **The relay context check fires at about 450k tokens.** Budget code and e2e first, then mutation, docs, verify, PR, merge.
- **The mock's panel zone is UTC by default.** `odd-timezone` is Kathmandu (+05:45, XMLTV without offsets).
- **The mock's synthetic media never plays.** Real frames: `ZOMA_E2E_MEDIA=1 pnpm exec playwright test --project=playback-media player-media -g "<title>"`.
- **In the guide e2e, one press back from now lands on the programme gone by.** A 30-minute channel's two LEFTs go two programmes back.
- **`Screen.reset` and `focus` notify the nav listeners synchronously.** Pushing a screen tells the focus listeners before `nav.push` returns.
- **Playwright `--project chromium <file>` reads the file as a project name.** Use `--project=chromium <pattern>`.
- **`SettingsScreen.tsx` and `main.tsx` are CRLF** in this worktree, the rest LF. Patch scripts normalize to LF, patch, and restore CRLF.
- **A `typeof x === 'object' &&` guard before reading a field of an `unknown` is masked:** only `null` and `undefined` throw.
- **The lazy first load can hide an edit path:** `await q.reload()` before the edit in such tests.
- **`tsc -b` at the root leaves an untracked `tsconfig.tsbuildinfo`.** Use `pnpm typecheck`.
- **The Edit tool (and Write) decode `\u` escapes.** Build the escape as `chr(92) + 'u2212'` in a Write-tool script.
- **Components that read focus through `useZone` can be called as functions in unit tests.** A Button's `data-state` is `idle` for the zone's other items while the focus is in the zone, and `memory` once the focus has left it.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Docs are safe.
- **If Claude Code stops a background mutation run for low memory,** check `git status` for `*.mutbak`, diff it against HEAD, `mv` it back, and go on in the foreground in ranges of 25.
- **TV bundle polyfills:** no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or iterator calls in TV files. Count main after any TV-file change (219). 25c's marks touch `GuideGrid`, a TV file.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs (Arabic text has no Latin words: names go in as arguments);
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only;
  - TV code is `lib: ES2017`;
  - the app imports only types from `@zoma/data` (values from narrow entries);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old. Never weaken lint.
- **Commits:** scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 4,066 unit tests, both TV builds, 219 core-js modules on both, the full `pnpm e2e` (93/93), mutation 26/27 (one equivalent) and 3/3. The screenshots `guide-catchup-m3u-{en-US,ar-SA}-{details,player}` were looked at.
  - PR #61's CI was green on all four jobs; it merged as `c144172`.
- **Not done:**
  - catch-up on a TV;
  - the details dialog's four buttons on Chromium 53/56/68 (the old-engine harness never opens the details);
  - the guide's catch-up days and marks (25c), seeking and the programme's end (25d), and "start over" for the programme on air.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10 (including the audio, subtitle and picture-size key codes, and an Info/Guide key), S11 by ear, S5's suspend and soak, and the player itself (step 21). Catch-up on the TV can join that visit.
- **Later, from the spikes:** an on-screen keyboard if the TV keyboards fail (S10); webOS's PRE-CH key; the accessibility route; pre-buffered zapping (S8); the last frame kept while reconnecting; step 38's settings rows; parsing subtitle files off the main thread; a remote's own "Guide" or "Info" key.
- **Later cleanups:**
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier (step 41);
  - holding refreshes while a low-tier TV plays;
  - the catalogs as a UTF-8 file;
  - a "loading" look for rows not read yet;
  - the details dialog, the settings and the picker on the old-engine walk;
  - a screen for a user's guide's own zone;
  - catch-up's "start over" for the programme on air;
  - whether catch-up should share `SourceMemory` with live.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.

## "Press these keys" checklist for step 25b (Omar, in `pnpm dev` with `pnpm mock`)
1. Onboard with "M3U link" (second source type), and type the mock's playlist link: `<mock host:port>/get.php?username=zoma&password=zoma-test&type=m3u_plus`. Add, then "Start watching".
2. Up to the header, OK on "Guide". On "Zoma Test 1 SMPTE" (row 1), press Left to a programme gone by, then OK: "From the start" is first and focused.
3. Press OK: the player shows the programme's day, times and title with the "Catch-up" badge. In `pnpm dev` the mock's media has no picture ("Connecting…", then the error card); on a TV, or with `pnpm mock:media`, it plays. Press Back: the guide is on the same cell.
4. Repeat on "Zoma Test 2 Clock" (row 2, `default`), "زوما تجريبي ٣" (row 5, `append`), "Zoma Kids Test" (row 8, `shift`) and "Zoma Sports Test HD" (row 9, `flussonic`). Each one plays from the programme's start.
5. Settings → Guides → the playlist's guide → "Time offset" → +1:00 → back to Guide. Programmes show an hour later, and "From the start" plays the shown time.
6. Arabic: everything mirrors. "من البداية" is on the right, first and focused.
7. With `pnpm mock --scenario odd-timezone` (Kathmandu, XMLTV without offsets), the playlist's guide shows the same times as the Xtream login does.

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
