# Zoma IPTV: relay leg 57 opening prompt

You are leg 57 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–55 did steps 1–23 and 24a, except step 16's Samsung part, 19b and 21 (PRs #1–#54).
- **Leg 56 did step 24b, the time offset per guide:**
  - It merged as PR **#55** (merge commit **`7e36fe7`**, branch kept). CI on `4b98abc` was green on the first run: verify 13 m 11 s, media 13 m 11 s, engines 16 m 1 s.
  - Main's CI on `980a573` (PR #54) was green. **Check main's run on `7e36fe7`.**
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.
- **Relay cap:** 60 legs. Leg 56 was the 56th, so 4 remain: 24c, 24d, 24e, and one more.

## Your step: 24c, match diagnostics (RELAY.md, Phase 6)
Read RELAY.md's step 24 block first: the "Already built" note, the order and its reasons, the common Done-when items, and 24c's own text.

1. **First check what exists** (leg 55 checked most of it):
   - **Each guide generation's `epg_channels`** (`EpgChannelTable` in `epg-store.ts`, written by `channelTable` in `epg-ingest.ts`) holds three lists:
     - `matches`: key, channel, method, ambiguous, shift;
     - `channels`: the XMLTV channels in use (id, name, icon);
     - `unmatched`: the guide's unmatched live channels (key, name, epgId).
   - **Each guide's summary** (`EpgMeta.summary`, `EpgSummary`): wanted, matched, `byMethod` (override, id, xtream-id, name, match-name), ambiguous, declared, used, programmes, kept, buckets, pastDays, futureDays.
   - **The guides screen** shows "Channels matched: n of m (p%)" (`readText` in `apps/tv/src/settings/SettingsScreen.tsx`).
   - **The query worker:** `loadEpg` combines the match tables (`combineEpgMatches`) into `epgLinks` (ContentKey → link). `epgStatus().matched` is `epgLinks.size`.
2. **RELAY's 24c text, in short:**
   - **Per guide:** the menu gains "Matches", showing the rate, the counts by method, the ties, and the XMLTV channels declared and used, all from the summary.
   - **Across guides:** "Channels without a guide: n" opens a virtualized list of the live channels no guide matches once the guides are combined. They come in source and category order, each with its source. The data is `QueryService.unmatched({ offset, limit })` and its count, and 20,000 channels must list.
3. **A likely shape** (your call):
   - **The menus:** the user's guide gets Move up, Move down, Time offset, Matches, Remove, Cancel; a source's guide gets Time offset, Matches, Cancel.
     - `guide-offset.spec.ts`'s `openChooser` expects "Time offset" at `guide-menu/actions/0` with exactly two buttons on the panel's guide. Update it and `guides.spec.ts`'s action lists.
   - **"Matches":** a dialog drawn from `row.meta.summary`, with no new read.
   - **The unmatched list:**
     - At each reload, the query worker walks the active generations' live items in the order "All channels" lists them and keeps the keys `epgLinks` lacks, as refs.
     - Pages come from that index.
     - See how `readEpgWanted` (`epg-ingest.ts`) walks the live chunks, and how the live screen orders "All channels".
   - **The way in:** a settings row, or a button in the guides screen's header, opening a screen with a `VirtualList` (`data-screen/zone/index` on its root). Add it to `SETTINGS_SCREENS`.
4. **Done when:**
   - RELAY.md's 24c text, plus the common items: unit tests; e2e by keys in en and ar against the mock (its "18+ Test Pattern" has no guide; the panel's guide is "11 of 12"); screenshots looked at.
   - A mutation run with the list written first.
   - `pnpm verify` green; main within budget with 219 core-js modules on both platforms (`python -I -u artifacts/poly-count20c2a.py`).
   - The PR merged, and a "press these keys" checklist in the handover.
5. Don't start 24d in the same leg unless 24c was light.

## Facts and decisions from leg 56 (step 24b)
- **Data:**
  - `epg-sources.ts` (exported from `@zoma/data/client` and the index): `EPG_OFFSET_STEP` (30), `EPG_OFFSET_MAX` (720), `isEpgOffset`, `epgOffsetsOf(doc)`.
  - `profile.ts`: `ProfileV4.epgOffsets?` (minutes by guide id, no entry for 0; optional, so no migration), `ProfileEdit { kind: 'epgOffset', epgSrc, minutes }`, and `readEpgOffsets(db)`. Removing one of the user's guides drops its offset.
- **The query worker:**
  - `shiftOf(link)` is `Math.round(tvgShift * 60) + offset`, in minutes. It passes `shift / 60` to core's `epgNowNext`, `epgSchedule` and `epgProgrammeAt`, so their API is unchanged.
  - **The stale-read guard:** edits bump `offsetSeq` when their write starts, and reloads take the number as it is. `setOffsets` drops answers numbered below `offsetsFrom`. An edit applies the offsets of the document it wrote at once.
- **Ingest:** `shiftMinutes` is gone from core's reader, `EpgGuide` and `UserGuide`.
- **The screen:**
  - **Menus:** the user's guide `[up?, down?, offset, remove, cancel]`; a source's guide `[offset, cancel]`.
  - **The chooser** `guide-offset`, zone `steps`:
    - 49 `OFFSET_STEPS` in `OFFSETS { rowHeight 64, rowGap 8, visible 7 }`.
    - The guide's own step is focused near the middle: the list first scrolls three past it.
    - OK on another step saves it, reads the list again (`Follow` is now by `epgSrc`), and calls `offsetChanged`. In `main.tsx` that runs `live.guidesChanged()` and `guide.guidesChanged()`. No refresh runs.
  - **The row** shows "Time offset: +1:00" between its link and its owner.
  - Four catalog keys: `guides.offset`, `guides.offsetLabel`, `guides.offsetBody`, `guides.offsetNone`.
- **Decided (not gates):**
  - Values show as `+1:30` and `−0:30`, with U+2212 as the minus and the digits `dir="ltr"`; 0 shows as "No offset".
  - The stored window isn't widened by the offset.
  - The panel's short EPG has no offset.
  - Step 25's catch-up should ask for the shown (offset) time. This is noted in ADR-010; confirm it against the mock then.
- **Checks:**
  - 3,754 unit tests (+40) and 81 e2e (+2).
  - Mutation: `artifacts/mutate24b.py` 76/76 (72 on the first run, then four test gaps closed) and `artifacts/mutate24b-e2e.py` 12/12.
  - Main 318.8 KB on Tizen and 306.3 KB on webOS; the query worker 102.5 KB; app.css 66.2 KB; 219 core-js modules.
- **The 3 riskiest changes in PR #55:**
  1. Every EPG read in `QueryService` now applies a per-guide offset.
  2. The guides menu gained an action, and a source's guide now has a menu, so key paths into it changed.
  3. Core's reader lost its unused `shiftMinutes` option.

### "Press these keys" (desktop, step 24b)
1. Run `pnpm mock` and `pnpm dev`. Open `http://localhost:5173/` and onboard with the mock's Xtream login (host `localhost:8080`; the user and password are in `apps/mock-provider/test/helpers.ts`).
2. On the live screen, press UP from the first channel, RIGHT to "Settings" (LEFT in Arabic), OK, then OK on "TV guides".
3. OK on the panel's guide: its menu shows "Time offset" and "Cancel". OK on "Time offset": the chooser opens on "No offset" (✓), with seven steps in view.
4. DOWN twice (+1:00), then OK. The row now says "Time offset: +1:00".
5. Back twice, to the list. Each row's programme is now the one the mock had on an hour earlier.
6. UP lands on "Settings" (the header remembers it). Go LEFT (RIGHT in Arabic) to "Guide", then OK: the cells are an hour later.
7. Back, then open the chooser again: it is on +1:00. UP twice, then OK: the offset is gone and the row says nothing.
8. Add `?locale=ar-SA`: the chooser is mirrored, and its values still read `+1:00` left to right.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: step 24 (24a and 24b done; 24c–24e), and the progress-log rows for legs 53–56.
3. `docs/architecture.md`:
   - §1.2 "Built in step 24b" and "Built in step 22b2a" (the guides screen);
   - §1.5 (the EPG pipeline: the match tables, the summary, `epg_channels`).
4. The code:
   - `packages/data/src`: `query-service.ts` (`loadEpg`, `epgStatus`), `epg-store.ts`, `epg-ingest.ts` (`channelTable`, `summarize`, `readEpgWanted`);
   - `apps/tv/src/settings` (`guides-state.ts`, `SettingsScreen.tsx`, `settings-state.ts`);
   - `apps/tv/src/live` (the "All channels" order).
5. Memory:
   - `iptv-parser-test-patterns` (mutation lessons, leg 56's included);
   - `iptv-ui-test-gotchas`, `iptv-tv-bundle-polyfills`, `iptv-mock-provider-gotchas`;
   - `use-write-tool-for-doc-batches`, `write-tool-raw-unicode-escapes`, `gh-pr-checks-watch-race`, `bg-watcher-memory-reap`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `7e36fe7`).
   - If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
   - If `media` shows `cancelled`, read its step times first (a slow apt mirror).
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `45d9b7f` ("docs: record PR #55's merge, tick step 24b"). It is pushed, and the tree is clean.
- **main** has `7e36fe7` (PR #55). The branch is ahead by `45d9b7f` and the handover commit, both docs; they go to main with 24c's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `dist/` (built from the current code);
  - `artifacts/`, which includes:
    - `mutate24b.py` (the newest unit template, with "taken out" and "left out" notes) and `mutate24b-e2e.py` (markup and CSS mutants against one spec), with their logs;
    - `poly-count20c2a.py`;
    - `verify24b.log` (the reaped run);
    - `screenshots/guides-offset*-{en,ar}.png` and `guide-offset-{en,ar}.png`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Gotchas and lessons
**New in leg 56:**
- **The Edit tool decodes `\u` escapes too:** `'\u2212'` landed as a raw `−`. In a Write-tool script, build the escape as `chr(92) + 'u2212'`.
- **Line endings:** Edit rewrites a CRLF file as LF. This is harmless, because git's autocrlf normalizes it. In this worktree, `guides-state.ts`, `SettingsScreen.tsx`, `settings.css`, the settings tests and `main.tsx` were checked out CRLF; `docs/architecture.md`, RELAY.md, HANDOVER.md and most e2e files are LF. Detect the ending, then patch (the scripts in `$CLAUDE_JOB_DIR/tmp` normalized to LF and restored).
- **A lazy first load hides edit-path mutants.** `QueryService` loads on its first read, and that load re-reads the profile after a test's edits. Read once before the edits.
- **Reading days d−1..d+1 around a shifted time hides day-choice mutants** for short programmes. Use programmes of many hours: 23-hour slots step each start an hour earlier through the day.
- **The live header remembers its last item:** after Back from the settings, UP lands on "Settings" (`live/header/1`).
- **The navigator clamps and floors any focus index, past the end too.** A `Math.min` or `Math.floor` before `focus` is masked.
- **A background `pnpm verify` was reaped again** for low memory in its e2e stage. The "x" rows at 0 ms are killed browsers, not failures. Don't restart it on your own: run the touched specs alone and let CI's verify run the rest.

**From earlier legs (still true):**
- **A screen that can be covered must never pop itself from a background callback.**
- **A screen's first draw, opened by a key, is its slowest press.** Ask for its data after the opening frame.
- **The e2e can't import `apps/tv/src/guide/guide-state.ts`** (it reaches `.tsx` through `@zoma/ui`'s index). Repeat a constant with a comment naming its source.
- **A connection error can end a CI wait early.** Loop on a saved `gh pr checks` output that has pass/fail and no pending (leg 56's loop: up to 60 × 45 s).
- **Read a list's rows in one `page.evaluate`.**
- **@preact/signals skips redrawing a child whose props didn't change.** Pass new functions or a version prop.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going** (Vite serves live files). Docs are safe.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or new `for…of` in TV files;
  - count main after any TV-file change (219).
- **Code rules:**
  - components in `packages/ui` stay hook-free;
  - UI text comes only from the catalogs;
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only;
  - TV code is `lib: ES2017`;
  - the app imports only types from `@zoma/data` (values from narrow entries such as `@zoma/data/client`);
  - a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old. Never weaken lint.
- **Commits:** scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line and the harness's `Claude-Session` line. Write multi-line scripts with the Write tool, never long heredocs.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,754 unit tests and both TV builds (inside the reaped `pnpm verify`); `guide-offset.spec.ts` and `guides.spec.ts` in en and ar; both mutation runs; the screenshots looked at.
  - PR #55's CI green on all three jobs (verify ran the full e2e); merged as `7e36fe7`.
- **Not done:**
  - A full local e2e (reaped).
  - Main's CI on `7e36fe7` is unchecked.
  - `pnpm verify:engines --self-test` wasn't run locally (no harness change; CI's engines job passed).
  - The settings and the offset have never run on a TV or on Chromium 53/56/68 (the old-engine walk doesn't open the settings).
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
  - a TV remote's own "Guide" or "Info" key (needs S10).
- **Later cleanups:**
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier (step 41);
  - holding refreshes while a low-tier TV plays (step 41);
  - the catalogs as a UTF-8 file if they keep growing;
  - a "loading" look for guide rows not read yet;
  - the details dialog and the settings on the old-engine walk;
  - a screen for a user's guide's own zone (`UserGuide.offsetMinutes`, which nothing sets yet).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.

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
