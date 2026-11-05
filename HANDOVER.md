# Zoma IPTV: relay leg 58 opening prompt

You are leg 58 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–56 did steps 1–23, 24a and 24b, except step 16's Samsung part, 19b and 21 (PRs #1–#55).
- **Leg 57 did step 24c, match diagnostics:**
  - It merged as PR **#56** (merge commit **`4673a87`**, branch kept). CI on `cc01e70` was green on the first run: verify 12 m 44 s, media 12 m 42 s, engines 17 m 31 s.
  - Main's CI on `7e36fe7` (PR #55) was green. **Check main's run on `4673a87`.**
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.
- **Relay cap:** 60 legs. Leg 57 was the 57th, so 3 remain: 24d, 24e, and one more.

## Your step: 24d, manual mapping: the data (RELAY.md, Phase 6)
Read RELAY.md's step 24 block first: the "Already built" note, the order and its reasons, the common Done-when items, and 24d's own text.

1. **First check what exists:**
   - **Core's matcher already takes overrides:** `EpgOverride` and the `override` method (`packages/core/src/epg-match.ts`: `EpgWantedSet(channels, overrides)`, pins to one guide's channel or to none, ranked first).
   - **The refresh job has an `overrides` field** (`EpgRefreshJob.overrides` in `epg-ingest.ts`), and `readEpgWanted` puts their hash in the basis. **Nothing stores or sends any yet.** `DataEngine.refreshEpg` (`apps/tv/src/data/engine.ts`) is where the scheduler and the guides screen's `refreshNow` start a refresh.
   - **Each generation's `epg_channels`** (`EpgChannelTable` in `epg-store.ts`, written by `channelTable` in `epg-ingest.ts`) keeps `matches`, `channels` (only the XMLTV channels **in use**: `reader.matcher.usedChannels()`) and `unmatched`. 24d must keep **every declared** channel (id and display name).
   - **The profile** (`packages/data/src/profile.ts`, v4): the optional-field pattern of step 24b's `epgOffsets` (no migration), its `ProfileEdit` kinds, `applyProfileEdit`, and `readEpgOffsets`.
2. **RELAY's 24d text, in short:**
   - **The guides' channels:** each generation keeps every XMLTV channel its guide declares (id and display name), so a channel can be mapped to one nothing matched.
   - **Overrides** in the profile (optional, no migration): a live channel (by ContentKey) pinned to a guide's XMLTV channel, or to no guide. The app's refresh calls (the scheduler, the guides screen's `refreshNow`) send them. They are in the basis already, so a change reads the guides again.
   - **A query** to search a guide's declared channels by name (normalized, as the matcher does), paged.
   - **Done when:** unit tests (the declared channels stored and searched; the overrides edited, sent and honoured after a refresh: the channel's now/next and grid row come from the pinned channel, and "no guide" leaves it empty; an override to a channel a newer guide no longer declares). At scale: the 300 MB guide's 5,000 declared channels stored and searched within a set time. Plus the common items, **e2e excepted** (24e has it).
3. **Likely shape** (your call):
   - **Storage:** a new store or a field in `epg_channels`.
     - A DB version bump needs a migration test (`schema.test.ts`).
     - A new field in the stored table may not need one. But old generations lack it, so bump `EPG_INGEST_VERSION` to make unchanged guides read again.
   - **The search:** in the query worker, over the active generations' declared channels, by `normalizeName` / match name, paged like `QueryService.unmatched` (step 24c).
   - **At scale:** see `test/guide-300mb.media.test.ts` and `test/epg-300mb.media.test.ts` (`test:media`).
4. **Done when (common):**
   - Unit tests.
   - A mutation run with the list written first.
   - `pnpm verify` green.
   - Main within budget with 219 core-js modules on both platforms (`python -I -u artifacts/poly-count20c2a.py`).
   - The PR merged, and the handover.
   - No e2e, no screen: 24e does those.
5. **Don't start 24e in the same leg** unless 24d was light.

## Facts and decisions from leg 57 (step 24c)
- **The data:**
  - `QueryService.unmatched({ sources, offset, limit })`, `UNMATCHED_MAX_ROWS` (500) and `DataEngine.unmatched`.
  - It lists the live channels of the sources asked (the app passes the profile's, so "All channels" order) that the combined `epgLinks` lack. It counts from the catalogs, not from the guides' own unmatched lists.
  - **The walk:** `catalog-store.ts` `scanChunks`, one cursor with one chunk held at a time, runs once per source per reload, into flat chunk addresses (category, chunk, slot). A failed walk is tried again at the next ask.
  - **Each row:** key, name, `src`, and `category` (the item's `group`, which is its category's name).
  - **`version`** bumps at each reload, and the screen drops its pages when it changes.
- **The screens** (`apps/tv/src/settings`):
  - **The menu:** "Matches" (`guide-matches`, from `EpgMeta.summary`, no read) for a guide that was read (`summaryOf`):
    - the user's guides: up?, down?, offset, matches, remove, cancel;
    - a source's own guide: offset, matches, cancel.
  - **The guides screen's header zone is now `header`** (it was `add`): `HEADER_ADD` 0, `HEADER_UNMATCHED` 1 ("Channels without a guide: n", counted at each read with a 0-row page).
  - **The list screen** is `unmatched-state.ts` (screen `unmatched`, zone `channels`):
    - eight 88 px rows;
    - pages of 50 around the window, six kept;
    - a newer version drops every page and every ask in flight; an older answer is dropped.
  - **OK on a row does nothing:** 24e adds the picker there.
  - `SETTINGS_SCREENS` gained `guide-matches` and `unmatched`. The settings root's `data-pending` sums the guides' and the list's.
  - **Catalogs:** 15 new keys, `guides.matches`, `guides.by*`, `guides.ties`, `guides.declared`, `guides.used`, `guides.unmatched`, `unmatched.*`, plus `action.close`.
- **The mock:** the panel's guide matches 10 by `xtream-id` (an Xtream source's id match) and 1 by `match-name`, with 9 declared and 9 used. "18+ Test Pattern" (`x:s1:live:109`, category "18+ Test (lock check)") is the one channel without a guide.
- **Checks:**
  - 3,854 unit tests (+100).
  - e2e `guide-matches.spec.ts` (3 tests).
  - Mutation `artifacts/mutate24c.py` 110/110 and `artifacts/mutate24c-e2e.py` 21/21. Both scripts take `--from=N --to=M` (a range by position).
  - Main 327.5 KB on Tizen, 314.9 KB on webOS; the query worker 103.8 KB; app.css 69.0 KB; 219 core-js modules.
- **The 3 riskiest changes in PR #56:**
  1. The header zone was renamed and the menu gained an item, so key paths changed.
  2. A per-reload chunk walk runs when the list or its count is first asked for.
  3. A new full screen is painted inside the settings, and `data-pending` sums two sources.

### "Press these keys" (desktop, step 24c)
1. Run `pnpm mock` and `pnpm dev`. Open `http://localhost:5173/` and onboard with the mock's Xtream login (host `localhost:8080`; the user and password are in `apps/mock-provider/test/helpers.ts`).
2. On the live screen, press UP from the first channel, RIGHT to "Settings" (LEFT in Arabic), OK, then OK on "TV guides". The header reads "Add a guide" and "Channels without a guide: 1".
3. OK on the panel's guide: its menu is Time offset, Matches, Cancel. DOWN, then OK on "Matches":
   - "Channels matched: 11 of 12 (92%)";
   - by the panel's channel ID 10, by name without tags 1, the others 0;
   - channels in the guide 9, in use 9.
4. OK on "Close" returns to the row; Back does too.
5. UP to "Add a guide", RIGHT (LEFT in Arabic) to "Channels without a guide: 1", then OK. The list shows "18+ Test Pattern", "From <host> · 18+ Test (lock check)", and "1 channel" in the header.
6. Back returns to the header's button.
7. Add `?locale=ar-SA`: everything is mirrored, and the numbers sit at each line's left end.

## Read first
1. `CLAUDE.md`: conventions, Definition of Done, merge policy, commit format.
2. `RELAY.md`: step 24 (24a–24c done; 24d, 24e), and the progress-log rows for legs 55–57.
3. `docs/architecture.md`:
   - §1.2 "Built in step 24c" and "Built in step 24b";
   - §1.3 (storage);
   - §1.5 (the EPG pipeline, matching cascade, overrides).
4. The code:
   - `packages/core/src/epg-match.ts` (overrides, `EpgWantedSet`, `EpgMatcher`, `usedChannels`);
   - `packages/data/src`: `epg-ingest.ts` (`readEpgWanted`, `channelTable`, `EPG_INGEST_VERSION`), `epg-store.ts`, `schema.ts`, `profile.ts`, `query-service.ts`;
   - `apps/tv/src/data/engine.ts` (`refreshEpg`) and the refresh scheduler.
5. Memory:
   - `iptv-parser-test-patterns` (mutation lessons, leg 57's included);
   - `iptv-data-layer-test-gotchas`, `iptv-v8-substring-retention` (declared channels' ids must be owned strings);
   - `bg-watcher-memory-reap`, `use-write-tool-for-doc-batches`, `write-tool-raw-unicode-escapes`, `gh-pr-checks-watch-race`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main with `gh run list --branch main --limit 2 -R Omarmarei/zoma-iptv` (the run on `4673a87`).
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
- **HEAD:** the commit adding this HANDOVER.md, on top of `78c15f8` ("docs: record PR #56's merge, tick step 24c"). It is pushed, and the tree is clean.
- **main** has `4673a87` (PR #56). The branch is ahead by `78c15f8` and the handover commit, both docs; they go to main with 24d's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `dist/` (built from the current code);
  - `artifacts/`, which includes:
    - `mutate24c.py` (the newest unit template, with `--from`/`--to` ranges and "taken out" and "left out" notes) and `mutate24c-e2e.py`, with their logs `mutate24c*.log`;
    - `poly-count20c2a.py`;
    - `screenshots/guide-matches-{en,ar}.png` and `unmatched-{en,ar}.png`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license).

## Gotchas and lessons
**New in leg 57:**
- **Claude Code stopped the background mutation run for low memory**, while the session was idle waiting on it.
  - It left a file mutated next to its `.mutbak`. Check `git status` for `*.mutbak`, diff the backup against HEAD, then `mv` it back.
  - Don't relaunch the run in the background. Check free memory, then run the rest in the foreground in ranges (`--from=N --to=M`, about 25 unit mutants or 12 e2e mutants per call, each under the 10-minute limit).
- **Pushing a screen tells the focus listeners before `nav.push` returns**, so a listener that reads the screen signal must handle `null`.
- **An e2e can't see a `data-pending` sum:** the mock answers before any wait looks. Unit-test the root by calling `SettingsScreen(...)` as a function with a fake `settings`.
- **Components that read focus through `useZone` can be called as functions in unit tests** (`unmatched-screen.test.ts`), with an in-order text walk.
- **A Button's `data-state`:** `idle` for the zone's other items while the focus is in the zone; `memory` only once the focus has left the zone.
- **A list page that was dropped (LRU) and is wanted again** must be asked again: test that "in flight" bookkeeping is cleared on success.
- **The relay context check fired at about 451k tokens,** after the e2e mutation run. Budget a step's mutation runs and the PR's CI wait (about 18 minutes) inside it.

**From earlier legs (still true):**
- **The Edit tool (and Write) decode `\u` escapes.** Build the escape as `chr(92) + 'u2212'` in a Write-tool script.
- **Git Bash's quoted heredoc turns `\\` into `\`.** Write multi-line scripts with the Write tool, then run them.
- **Line endings:** `SettingsScreen.tsx` and `settings.css` are checked out CRLF; most other files are LF. The patch scripts detect the ending and restore it.
- **A lazy first load hides edit-path mutants:** read once before the edits.
- **The navigator clamps and floors any focus index.**
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Docs are safe.
- **TV bundle polyfills:**
  - no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or iterator calls (`map.keys().next()`) in TV files;
  - count main after any TV-file change (219).
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
  - Locally: lint, typecheck, 3,854 unit tests, both TV builds and the core-js count; `guide-matches`, `guides` and `guide-offset` specs in en, ar and en-XA; both mutation runs; screenshots looked at.
  - PR #56's CI green on all three jobs; merged as `4673a87`.
- **Not done:**
  - A full local `pnpm verify` (CI's verify ran it).
  - Main's CI on `4673a87` is unchecked.
  - The settings screens have never run on a TV or on Chromium 53/56/68.
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
  - a remote's own "Guide" or "Info" key.
- **Later cleanups:**
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier (step 41);
  - holding refreshes while a low-tier TV plays;
  - the catalogs as a UTF-8 file;
  - a "loading" look for rows not read yet (the guide's and the unmatched list's);
  - the details dialog and the settings on the old-engine walk;
  - a screen for a user's guide's own zone (`UserGuide.offsetMinutes`).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description (108 runs, 80 that must fail).
- **The relay cap:** 60 legs, with 3 left after leg 57. Steps 24d and 24e fit; step 25 and beyond need `/relay continue iptv-20261101-214120`.
- **Secrets:** none pending.
