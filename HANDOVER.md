# Zoma IPTV: relay leg 61 opening prompt

You are leg 61 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–59 did steps 1–24, except step 16's Samsung part, 19b and 21 (PRs #1–#59).
- **Leg 60 split step 25 (catch-up) into 25a–25d and did 25a.** RELAY.md has the split, with an "Already built" list and each sub-step's Done-when. 25a, Xtream catch-up from the programme details, merged as PR **#60** (merge commit **`ba47493`**). CI on `917d0b7` was green on the first run: verify 6 m 22 s, media 10 m 24 s, engines 16 m 21 s.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open.
- **Relay cap:** the run's cap is now 100 legs (`relay.py status`). The old "60 is the last" note is out of date.

## Your step: 25b, the M3U modes and the zone of an Xtream-shaped playlist (RELAY.md, Phase 6)
Read 25b's text and Done-when in RELAY.md, plus step 25's common items. In short:
- An M3U source's channels play catch-up from the details in each of the mock's modes: 101 `xc`, 102 `default`, 103 `append`, 105 `shift`, 106 `flussonic`.
- For a `get.php` M3U link (`xtreamFromM3uUrl`), the ingest logs in once (`player_api.php`) and keeps the panel's `server` facts, so an `xc` channel's start is written in the panel's zone. A failed login keeps UTC and doesn't fail the ingest.
- With +1:00 on a guide, "From the start" asks for the shown start. Confirm it against the mock.

**What 25a built that you reuse** (architecture.md §1.2 "Built in step 25a"; ADR-010 "Applied in step 25a"):
- `@zoma/player`'s `catchupCandidates(url, info, window, { zone, outputFormats })` already makes every M3U mode's URL through core's `m3uCatchupUrl`. M3U sources get UTC today: `DataEngine.sourceFacts` takes the zone from `SourceMeta.server`, and an M3U source has `server: null`.
- **Where that comes from:** `packages/data/src/ingest.ts`, around line 380 (`const server = xtream ? xtream.server : null`).
- **The app:** `apps/tv/src/player/catchup.ts` (`canWatchFromStart`, `catchupRequest`), the details' `detailsActions` ("From the start" first), and `Player.catchup`.

**The mock** (`apps/mock-provider/src/playlist.ts` `catchupAttrs`, `streams.ts`):
- **102 `default`:** `catchup-source="{base}/catchup/u/p/102.ts?start={utc}&end={utcend}"`.
- **103 `append`:** `catchup-source="?utc={utc}&lutc={lutc}"`, appended to the live URL.
- **105 `shift`:** `?utc=&lutc=` on `/live/`. The mock serves from `utc` to `lutc`, so its duration is now − start, not the programme's length.
- **106 `flussonic`:** its URL is `/flussonic/u/p/106/index.m3u8` (or `mpegts` with `output=ts`). Catch-up is `index-{start}-{dur}.m3u8` or `timeshift_abs-{start}.ts`.
- **101/112 `xc`:** days only, with an Xtream-shaped URL.
- **Every archive answer** carries `X-Mock-Archive-{Channel,Start,Duration}`; a start outside the window gets 404.
- **The e2e pattern:** `e2e/guide-catchup.spec.ts`'s `startMock` records the answers with an `onResponse` hook.
- **A non-UTC panel:** `mock({ scenario: 'odd-timezone' })` is Kathmandu, +05:45.
- **M3U onboarding by keys:** find the onboarding's M3U type and its field in `e2e/onboarding.spec.ts` and `e2e/onboard.ts`. `addXtreamAndWatch` covers Xtream only, so an `addM3uAndWatch` helper may be needed.

**First check what exists:** `git log --oneline -10`, and grep `xtreamFromM3uUrl`, `server` and `login` in `packages/data/src/ingest.ts`.

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
- **HEAD:** the commit adding this HANDOVER.md, on top of `40d6bc5` ("docs: record PR #60's merge, tick step 25a"), on top of `ba47493` (main; the branch was fast-forwarded to it). It is pushed, and the tree is clean.
- **main** has `ba47493`. The branch is ahead by two docs commits, which go to main with 25b's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the 300 MB fixtures and the generated media), `dist/` (built from the current code);
  - `artifacts/`, which includes:
    - `mutate25a.py` (the newest unit template, 75 mutants) and `mutate25a-e2e.py` (the newest e2e template, run against `e2e/guide-catchup.spec.ts`), with their logs;
    - `poly-count20c2a.py`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license; the repo is public).

## The repo is public (`Omarmarei/Lablo`)
- **Use `-R Omarmarei/Lablo`** with `gh`. The worktree's `origin` is `https://github.com/Omarmarei/Lablo.git`. The product is still "Zoma" in code, app IDs and docs.
- **CI runs on `pull_request` and `workflow_dispatch` only.** A `changes` job picks the jobs: docs alone run none; `engines` runs when the TV bundles or their harness change; `media` when the mock, data layer, player, lab or scale tests change.
- **Commits use the no-reply email** `58913863+Omarmarei@users.noreply.github.com` (the repo-local config sets it).
- **It is public:** no secrets, no LG binaries, no personal data in commits.
- **Merge rule (memory):** IPTV PRs merge on green CI (merge commit, keep the branch). Give the 3 riskiest changes first.
- **Waiting for CI:** a Monitor loop over `gh pr checks <n> -R Omarmarei/Lablo --json name,bucket`, starting after 25 s, worked well.

## Facts from leg 60 (step 25a)
- **The details' buttons:** a programme gone by within a catch-up channel's archive gets four: "From the start" (`programme-archive`, first and focused), "Watch the channel", "Guide channel", "Close" (`detailsActions(archive)`). Other programmes keep three. The guide sets `DetailsTarget.archive` when it opens the dialog.
- **The label is "From the start" (Arabic "من البداية").** "Watch from the start" made the four buttons 60 px wider than the wide panel's 1,100 px inside. The wide dialog's button row now wraps with negative margins (`Dialog.css`; Chromium 53–68 have no flex `gap`).
- **`DataEngine.sourceFacts()` replaced `outputFormats()`:** `Map<src, { outputFormats, zone }>`. `main.tsx` keeps it as `sourceFacts` and reads it again after a catalog refresh. The `SourceFacts` type lives in `engine.ts`; a type import from engine into a module that reaches `@zoma/ui` breaks the root typecheck (TS6142).
- **The player:** `Player.catchup(index, programme)` and the `archive` signal. The info bar's `player-archive` line shows the day, times and title, and the root carries `data-archive`. `openScreen()` is shared by show, catchup and resume. A catch-up play doesn't call `tuned`.
- **Noted, not changed:** `SourceMemory` remembers the container per source for catch-up as for live. On the desktop, an HLS catch-up puts HLS first for that source's live channels.
- **Checks:** 4,023 → 4,050 unit tests; e2e `guide-catchup.spec.ts` (4 tests), `guide.spec.ts`, `player-media.spec.ts` (`e2e:media`). The full local `pnpm e2e` passed 90/90 in the background (not reaped this time). Mutation 75/75 and 12/12.
- **Size:** main 346.3 KB (Tizen) and 333.7 KB (webOS) of 500; app.css 72.5 KB; workers unchanged (query 107.2, EPG 117.2, ingest 126.0 KB); 219 core-js modules on both.

## Gotchas and lessons
**New in leg 60** (also in memory):
- **The mock's panel zone is UTC by default,** so an e2e can't see a catch-up URL written in the wrong zone. Use `mock({ scenario: 'odd-timezone' })`.
- **The mock's synthetic media never plays;** the e2e checks the mock's answers and the player's attributes. Real frames are `ZOMA_E2E_MEDIA=1 pnpm exec playwright test --project=playback-media player-media -g "<title>"`.
- **In the guide e2e, one press back from now lands on the programme gone by.** A 30-minute channel's two LEFTs go two programmes back.
- **The player keeps the previous channel across a close.**
- **Bash heredocs with `\/` lose the backslash** inside a Python string (a SyntaxWarning, harmless when the text matches). Prefer Write-tool scripts.

**From earlier legs (still true):**
- **The relay context check fires at about 450k tokens.** Budget code and e2e first, then mutation, docs, verify, PR, merge. Leg 60 reached about 420k with all of 25a done.
- **`Screen.reset` and `focus` notify the nav listeners synchronously.**
- **Playwright `--project chromium <file>` reads the file as a project name.** Use `--project=chromium <pattern>`.
- **`SettingsScreen.tsx` and `main.tsx` are CRLF** in this worktree, the rest LF. Patch scripts normalize to LF, patch, and restore CRLF.
- **A `typeof x === 'object' &&` guard before reading a field of an `unknown` is masked:** only `null` and `undefined` throw.
- **The lazy first load can hide an edit path:** `await q.reload()` before the edit in such tests.
- **`tsc -b` at the root leaves an untracked `tsconfig.tsbuildinfo`.** Use `pnpm typecheck`.
- **The Edit tool (and Write) decode `\u` escapes.** Build the escape as `chr(92) + 'u2212'` in a Write-tool script.
- **Pushing a screen tells the focus listeners before `nav.push` returns.**
- **Components that read focus through `useZone` can be called as functions in unit tests.** A Button's `data-state` is `idle` for the zone's other items while the focus is in the zone, and `memory` once the focus has left it.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Docs are safe.
- **If Claude Code stops a background mutation run for low memory,** check `git status` for `*.mutbak`, diff it against HEAD, `mv` it back, and go on in the foreground in ranges of 25.
- **TV bundle polyfills:** no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or iterator calls in TV files. Count main after any TV-file change (219).
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
  - Locally: lint, typecheck, 4,050 unit tests, both TV builds, the core-js count, the full `pnpm e2e` (90/90), the new `e2e:media` test, and mutation 75/75 and 12/12. The screenshots were looked at.
  - PR #60's CI was green on all four jobs; it merged as `ba47493`.
- **Not done:**
  - catch-up on a TV;
  - the details dialog's four buttons on Chromium 53/56/68: the old-engine harness never opens the details;
  - the M3U modes in the app (25b), the guide's catch-up days and marks (25c), seeking (25d), and "start over" for the programme on air.
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

## "Press these keys" checklist for step 25a (Omar, in `pnpm dev` or on a TV)
1. Onboard the mock panel (Xtream). On the list: Up to the header, OK on "Guide".
2. On "Zoma Test 1 SMPTE" (row 1, seven days of catch-up), press Left once: the programme before the one on air. Press OK. The details show four buttons, with "From the start" first and focused.
3. Press OK. The player opens over the guide. The info bar's second line reads "<day> · <start> – <end>  <title>", with no "Next" line and the "Catch-up" badge. In `pnpm dev` the mock's media has no picture ("Connecting…", then the error card); on a TV, or with `pnpm mock:media`, it plays.
4. Press Back: the guide comes back on the same cell. Press OK, Right to "Watch the channel", then OK: the channel plays live, and the bar shows now/next.
5. Play "From the start" again, then press CH+: the next channel plays live, and the archive line goes.
6. Go down twice to "Zoma Test FR - Mire" (no catch-up), keep the same past time, and press OK: only three buttons.
7. On row 1, a programme to come: only three buttons.
8. Arabic: everything mirrors. "من البداية" is on the right, first and focused; the info bar reads right to left.

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
