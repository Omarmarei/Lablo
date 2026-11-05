# Zoma IPTV: relay leg 56 opening prompt

You are leg 56 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–54 did steps 1–23, except step 16's Samsung part, 19b and 21 (PRs #1–#53).
- **Leg 55 split step 24 and did 24a (the programme details):**
  - The split is commit `a14edbb` (`docs(relay): split step 24`): 24a details, 24b the time offset per guide, 24c match diagnostics, 24d and 24e manual mapping (data, then screens). Each has a runnable Done-when in RELAY.md, plus the common items listed under step 24.
  - 24a merged as PR **#54** (merge commit **`980a573`**, branch kept). CI on `3e3606d` was green on the first run: verify 8 m 50 s, media 13 m 10 s, engines 18 m 35 s.
  - Main's CI on `36dbaa1` (PR #53) was green. **Check main's run on `980a573`.**
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.

## Your step: 24b, the time offset per guide (RELAY.md, Phase 6)
Read RELAY.md's step 24 block first: the "Already built" note, the order and its reasons, the common Done-when items, and 24b's own text.

1. **First check what exists** (leg 55 checked it, so this is quick):
   - `epg-sources.ts`: `EpgGuide.shiftMinutes` and `UserGuide.offsetMinutes`/`shiftMinutes` exist. `offsetMinutes` is the zone for times written without an offset (ingest); `shiftMinutes` is a correction the reader adds at ingest (`EpgGuideReader`, passed in `epg-ingest.ts` around line 330). No screen sets either, and a source's own guides (`<src>:xmltv`, `<src>:tvg<n>`) have neither.
   - `query-service.ts` `loadEpg`: each link's `shift` is the live channel's tvg-shift **in hours**. `nowNext`, `guide` and `programme` all use it (`Math.round(link.shift * 60)` for days; core's `epgNowNext`, `epgSchedule`, `epgProgrammeAt` take hours).
2. **Decided in RELAY.md (not a gate):**
   - one setting per guide, −12 h to +12 h in 30-minute steps, for the user's guides and the sources' own;
   - applied when the query worker reads (as tvg-shift is), not at ingest, so a change shows at once with no download;
   - the ingest-time `shiftMinutes` goes, so nothing is shifted twice.
3. **A likely shape** (your call):
   - The offsets in the profile by guide id (`epgSrc`), optional, so no migration. A `ProfileEdit` for it, applied in the query worker's read-modify-write.
   - The query worker reads them at each reload, and the edit reloads it. A link's shift then becomes tvg-shift + the guide's offset. In hours, n × 0.5 is exact in binary, so the existing `Math.round(shift * 60)` stays exact.
   - Make sure the guide's own records aren't re-downloaded: the basis (`readEpgWanted`) must not change. Count the mock's requests in e2e (`app.addHook('onRequest')`, memory `iptv-mock-provider-gotchas`).
   - The guides screen (`apps/tv/src/settings/guides-state.ts`, `SettingsScreen.tsx`):
     - the menu gains "Time offset"; a source's own guide gets a menu with that alone (today `openMenu` returns for `kind !== 'mine'`);
     - a chooser of the steps, the current one focused;
     - the row shows the offset when it isn't 0.
   - After a change, the live screen and an open guide ask their programmes again: the same path as a guide swap (`guidesChanged`), or a new hook from the settings.
4. **Done when:** RELAY.md's 24b text, plus the common items:
   - unit tests;
   - e2e by keys in en and ar;
   - screenshots looked at;
   - a mutation run with the list written first;
   - `pnpm verify` green;
   - main within budget with 219 core-js modules on both platforms;
   - the PR merged;
   - a "press these keys" checklist.
5. If the leg has room after 24b, 24c (match diagnostics) is next. Don't start it in a heavy session.

## Facts and decisions from leg 55 (step 24a)
- **The read:**
  - core `epgProgrammeAt(bucket, start, shiftHours)` is a lower-bound binary search over one bucket's starts;
  - `QueryService.programme({ key, start })` reads the row's own guide channel (the combined match), the bucket of the start's day in guide time, or `null`;
  - `DataEngine.programme` in the app.
- **The dialog** (`apps/tv/src/guide/programme-details.ts`, `ProgrammeDialog.tsx`; screen `programme`, horizontal zone `actions`):
  - OK on a programme gone by or to come opens it. OK on the cell that holds now still plays; a placeholder elsewhere does nothing.
  - At once, from the grid: the title, the channel, the day, the programme's own times and its length. From the read: the sub-title, the category and episode tags, and the description, cut at eight lines by `-webkit-line-clamp`.
  - "Watch the channel" closes the dialog first, then plays the guide's focused row, only while that row still holds the programme's channel (a catalog swap may have moved it). "Close" and Back return to the same cell.
- **`Dialog`** (packages/ui) gained `data` (title `dir="auto"`, not translated), `body` and `wide` (1,200 px). The title now has `text-align: left` (mirrored by rtlcss) for every dialog.
- **`GuideScreen`'s header** now always reads the guide screen's own position, so it keeps the grid's programme under the dialog. `LiveApp` paints `GuideScreen` for `guide` and `programme`.
- **Decided (not a gate):** no details view of the programme on air (OK keeps the one-press play; a remote Info key needs S10).
- **Checks:**
  - 3,714 unit tests (+42), 79 e2e (+2);
  - mutation `artifacts/mutate24a.py` 61/62 (the survivor equivalent: `hi = length - 1`), and `artifacts/mutate24a-e2e.py` 10/10;
  - main 315.5 KB Tizen and 302.9 KB webOS (was 311.3/298.7), query worker 101.3 KB, app.css 64.6 KB, 219 core-js modules.
- **The 3 riskiest changes in PR #54:**
  1. `Dialog`'s title `text-align: left` affects every dialog (exit, guide menu, add form). It is the same look in both directions, but a dialog title is now also mirrored explicitly.
  2. `GuideScreen`'s header no longer depends on the grid being on top: it reads `screen.position(GUIDE_GRID)` under the dialog.
  3. The guide's OK now branches: on air plays, any other programme cell opens the dialog. "Watch the channel" checks the focused row's key after a catalog swap.

### "Press these keys" (desktop, step 24a)
1. Run `pnpm mock` and `pnpm dev`. Open `http://localhost:5173/` and onboard with the mock's Xtream login (host `localhost:8080`; the user and password are in `apps/mock-provider/test/helpers.ts`).
2. On the live screen, press UP from the first channel, then OK on "Guide".
3. RIGHT to the next programme, then OK. The details open: the title, the channel, the day and times, "60 minutes" (or the slot's length), the category tag and the mock's description.
4. RIGHT to "Close" and OK, or press Back: you are back on the same cell.
5. LEFT twice (a programme gone by), then OK; OK again on "Watch the channel" plays the channel; Back returns to the guide.
6. Add `?locale=ar-SA`: the dialog is mirrored, and "شاهد القناة" sits on the right.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: step 24 (the split, 24a done, 24b–24e), and the progress-log rows for legs 52–55.
3. `docs/architecture.md`:
   - §1.2 "Built in step 24a" (the details) and "Built in step 22b2a" (the guides screen and its menu);
   - §1.5 (the EPG pipeline: zones, `shiftMinutes`, the basis, "Nothing new", ADR-010).
4. `docs/adr/ADR-010-catchup-time-zones.md` ("the per-source time offset (step 24) also lets users fix a panel whose zone is simply wrong").
5. The code:
   - `packages/data/src`: `epg-sources.ts`, `epg-ingest.ts`, `query-service.ts`, `profile.ts`;
   - `apps/tv/src/settings` (`guides-state.ts`, `SettingsScreen.tsx`);
   - `apps/tv/src/data/refresh-scheduler.ts`;
   - `apps/tv/src/main.tsx` (CRLF).
6. Memory:
   - `iptv-parser-test-patterns` (mutation lessons, leg 55's included);
   - `iptv-ui-test-gotchas`, `iptv-css-pipeline-gotchas`, `iptv-tv-bundle-polyfills`, `iptv-mock-provider-gotchas`;
   - `use-write-tool-for-doc-batches`, `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `980a573`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` shows `cancelled`, read its step times first (a slow apt mirror).
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call. Leg 55 ran one `cd /tmp` and it moved the session's primary working directory to `D:\tmp`.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `a925fd9` ("docs: record PR #54's merge, tick step 24a"). It is pushed, and the tree is clean.
- **main** has `980a573` (PR #54). The branch is ahead by `a925fd9` and the handover commit, both docs; they go to main with 24b's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `dist/` (built from the current code);
  - `artifacts/`, which includes:
    - `mutate24a.py` (the newest multi-file unit template, with a "left out on purpose" note) and `mutate24a-e2e.py` (CSS and markup mutants against one spec's `--grep`), with their logs;
    - `poly-count20c2a.py`, which counts main's core-js modules: `python -I -u artifacts/poly-count20c2a.py`;
    - `verify24a.log`;
    - `screenshots/guide-details*-{en-US,ar-SA}.png`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Gotchas and lessons
**New in leg 55:**
- **Under a pushed dialog, the grid draws its kept cell as `memory`, not `focused`**: e2e `focused()` finds none there.
- **To lay out long provider text in e2e, clone the dialog node** into `#app`, set the copy's text, measure it, then remove it. Never write into the DOM Preact owns.
- **`-webkit-line-clamp`** (with `display: -webkit-box; -webkit-box-orient: vertical`) cuts text at N lines with an ellipsis on Chromium 53+. CfT 156 reports the clamp's `display` as `flow-root`, so check `-webkit-line-clamp` and the height instead. A `max-height` beside the clamp masks its mutants.
- **App components that call `useZone` can be unit-tested as functions**: `useFocus` only reads a signal (`bindFocus(nav)`).
- **Writing the mutant list first again took out masked code** (four pieces) and found five test gaps. Float shifts: test a value where `trunc` and `round` differ (2.05 h = 122.99999999999999 min) and write the expected minutes out.
- **Heredoc patches:** every patch with a backslash went through a Write-tool script. Keep doing that.

**From earlier legs (still true):**
- **A screen that can be covered must never pop itself from a background callback.**
- **A screen's first draw, opened by a key, is its slowest press.** Ask for its data after the opening frame.
- **The e2e can't import `apps/tv/src/guide/guide-state.ts`** (it reaches `.tsx` through `@zoma/ui`'s index). Repeat a constant with a comment naming its source.
- **A connection error can end a CI wait early.** Loop on a saved `gh pr checks` output that has pass/fail and no pending (leg 55's loop: up to 60 × 45 s, `grep -qE "pass|fail"` and no `pending|no checks`).
- **Read a grid's or list's rows in one `page.evaluate`.**
- **@preact/signals skips redrawing a child whose props didn't change.** Pass new functions or a version prop.
- **Line endings:** `docs/architecture.md`, RELAY.md, HANDOVER.md, the e2e files and `apps/tv/src` files are LF in this worktree, except `apps/tv/src/main.tsx` (CRLF). Detect the ending, then patch.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files). Docs are safe.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or `for…of` in TV files;
  - count main after any TV-file change (219).
- **Playwright's page clock:** `page.clock.install()` before `goto`. The workers and the mock keep the real clock.
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs;
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only;
  - TV code is `lib: ES2017`;
  - the app imports only types from `@zoma/data` (values from narrow entries);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old. Never weaken lint.
- **Commits:** scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line and the harness's `Claude-Session` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: `pnpm verify` green (3,714 unit, 79 e2e, both TV builds), both mutation runs, the details e2e in en, ar and en-XA, screenshots looked at.
  - PR #54's CI green on all three jobs; merged as `980a573`.
- **Not done:**
  - Main's CI on `980a573` is unchecked.
  - `pnpm verify:engines --self-test` wasn't run locally (no harness, build or worker change; CI's engines job passed).
  - The details dialog has never run on a TV or on Chromium 53/56/68 (the old-engine walk doesn't open it).
  - The guide screen, the 3 → 4 profile migration and the settings screens have never run on a TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10 (including the audio, subtitle and picture-size key codes, and an Info/Guide key), S11 by ear, S5's suspend and soak, and the player itself (step 21).
- **Later, from the spikes:**
  - an on-screen keyboard if the TV keyboards fail (S10);
  - webOS's PRE-CH key;
  - the accessibility route;
  - pre-buffered zapping (S8);
  - the last frame kept while reconnecting;
  - step 38's settings rows;
  - parsing subtitle files off the main thread;
  - a TV remote's own "Guide" or "Info" key (needs S10; also the details of the programme on air).
- **Later cleanups:**
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier (step 41);
  - holding refreshes while a low-tier TV plays (step 41);
  - the catalogs as a UTF-8 file if they keep growing;
  - a "loading" look for guide rows not read yet;
  - the details dialog on the old-engine walk.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.
- **Relay cap:** 60 legs. Leg 55 was the 55th, so 5 remain: 24b, 24c, 24d, 24e and one more.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide" (the grid guide screen, `apps/tv/src/guide`);
  - 30: the `pnpm verify:engines` row says `--self-test` proves the syntax seeds and a no-polyfill build. It now also walks onboarding, the live screen and the grid guide by keys, and runs the CSS, walk and lab seeds: 108 runs, 80 that must fail.
- **Secrets:** none pending.
