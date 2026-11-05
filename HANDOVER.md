# Zoma IPTV: relay leg 60 opening prompt

You are leg 60 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–58 did steps 1–23 and 24a–24d, except step 16's Samsung part, 19b and 21 (PRs #1–#57).
- **Leg 59 did step 24e, manual mapping: the screens.** It merged as PR **#59** (merge commit **`baddf70`**, branch kept). CI on `899a42c` was green on the first run: verify 7 m 43 s, engines 17 m 15 s, media skipped (none of its code changed). That finishes step 24; RELAY.md ticks 24e (the parent line "24." stays as earlier legs left it).
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.
- **Relay cap: 60 legs. You are the 60th, the last one.** After your report the run pauses; going on needs Omar's `/relay continue iptv-20261101-214120`. Say so in your handover.

## Your step: 25, catch-up and tuning (RELAY.md, Phase 6)
RELAY.md's text: "Catch-up from the grid (Xtream timeshift + M3U modes) and low-tier tuning. Done when: catch-up plays from the mock provider in e2e." That is several sessions of work.

1. **First split it** in RELAY.md the way leg 55 split step 24 into 24a–24e (read that split note under step 24): sub-steps that each fit one session, each with its own Done-when, and the common items (unit tests, e2e by keys in English and Arabic against the mock with screenshots looked at, a mutation run with its list written first, `pnpm verify` green, main within budget with 219 core-js modules on both platforms (`python -I -u artifacts/poly-count20c2a.py`), the PR merged, a "press these keys" checklist in the handover). Commit the split.
2. **Then do 25a** if the session still has room; else hand over with the split alone.
3. **What exists to read first:**
   - `docs/adr/ADR-010-catchup-time-zones.md` (panel zone, the DST repair, and since 24b: catch-up should use the shown time, the guide's offset included).
   - architecture.md §1.2 "Built in step 24a" (the details dialog: step 25 adds "Watch from the start" for a programme gone by) and "Built in step 24b" (the offsets' note on catch-up).
   - The catalog keeps each channel's catch-up days and mode (`catchup`, `archive_days`; core's `EpgWantedSet` carries them). The guide shows one past day today (`GUIDE_DAYS.past` 1, "step 25 shows the catch-up days"); the EPG window's past days follow the longest catch-up (architecture.md §1.5 item 6).
   - The mock's live channels have catch-up in five modes: 101 `xc` 7 days, 102 `default` 3, 103 `append` 3, 105 `shift` 1, 106 `flussonic` 2 (`apps/mock-provider/fixtures/catalog.yaml`; `hasArchive` in `apps/mock-provider/src/epg.ts`). Find how the mock serves timeshift (`grep -n timeshift apps/mock-provider/src`).
   - The player: `apps/tv/src/player/player-state.ts` and `app-player.ts`; the guide's OK on a programme gone by opens its details (`guide/programme-details.ts`).
4. **First check what exists:** `git log --oneline -10`, and grep for `catchup`, `timeshift` and `archive` in `apps/tv/src` and `packages/core/src`.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.
3. Main has no CI run after merges: nothing to check there.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R Omarmarei/Lablo` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call (leg 59 slipped once; it moved the session's own folder, harmlessly).
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `9a13de5` ("docs: record PR #59's merge, tick step 24e"), on top of `baddf70` (main: the branch was fast-forwarded to it). It is pushed, and the tree is clean.
- **main** has `baddf70`. The branch is ahead by `9a13de5` and the handover commit, both docs; they go to main with step 25's first PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the 300 MB fixtures), `dist/` (built from the current code);
  - `artifacts/`, which includes:
    - `mutate24e.py` (the newest unit template: `--check`, `--from`/`--to`, positions printed per mutant, "taken out", "found by the run" and "left out" notes) and its logs `mutate24e-{a,b}.log`;
    - `mutate24c-e2e.py` (the newest e2e template; 24e wrote none);
    - `poly-count20c2a.py`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license; the repo is public).

## The repo is public (`Omarmarei/Lablo`)
- **Use `-R Omarmarei/Lablo`** with `gh`. The worktree's `origin` is `https://github.com/Omarmarei/Lablo.git`. The product is still "Zoma" in code, app IDs and docs.
- **CI runs on `pull_request` and `workflow_dispatch` only.** A `changes` job picks the jobs: docs alone run none; `engines` runs when the TV bundles or their harness change; `media` when the mock, data layer, player, lab or scale tests change. A skipped job shows as "skipping" in `gh pr checks`.
- **Commits use the no-reply email** `58913863+Omarmarei@users.noreply.github.com` (the repo-local config sets it).
- **It is public:** no secrets, no LG binaries, no personal data in commits.
- **Merge rule (memory):** IPTV PRs merge on green CI (merge commit, keep the branch). Give the 3 riskiest changes first.

## Facts from leg 59 (step 24e)
- **The picker** `guide-map` is a settings screen (`SETTINGS_SCREENS`), painted by `SettingsScreen.tsx` through `MappingPage.tsx`; its state is `apps/tv/src/settings/mapping-state.ts` (`createMapping`, owned by `createSettings` as `settings.mapping`). It opens from "Channels without a guide" (OK on a row: `UnmatchedOptions.map`) and from the details dialog's new middle button "Guide channel" (`DETAILS_MAP` = 1, `DETAILS_CLOSE` = 2; `GuideOptions.map`, wired in `main.tsx`).
- **The profile's mapping is read by the app's own `pinOf`** (mapping-state.ts): importing `@zoma/data`'s `epgOverridesOf` would bring its module's polyfills (`.sort`, `.map`) into main.
- **"Reading the guides…"** (`mapping.reading`) shows on the list without a guide and in the guide's header (`MappingReading`); both roots' `data-pending` include `mapping.pending`, so `settled()` waits for the refresh. After it settles, `unmatched.reload()` and `guides.matchesChanged()`; the live list and the grid hear from the scheduler's `onGuides`.
- **The old-engine harness test** (`test/engines-onboarding.test.ts`) pins the guide's markup: its `data-pending` mark is now `{guide.pending.value + mappingPending}`.
- **Checks:** 4,023 unit tests; e2e `guide-mapping.spec.ts`, `guide.spec.ts`, `guide-matches.spec.ts` green locally; mutation 124/124.
- **Size:** main 339.8 KB (Tizen) and 327.2 KB (webOS) of 500; query worker 107.2 KB, EPG worker 117.2 KB, ingest 126.0 KB; app.css 71.6 KB; 219 core-js modules.

## Gotchas and lessons
**New in leg 59:**
- **The relay context check fired at about 450k tokens,** after the code and the e2e were done; mutation, docs, verify, PR and merge still fitted. Budget the same way: code and e2e first.
- **`Screen.reset` and `focus` notify the nav listeners synchronously:** an explicit ask after a reset doubled a page ask. Call the de-duplicated `fill` instead.
- **A reload test that also bumps the worker's version masks the reload's own `openSeq` and `asking` resets** (a new version drops both). Keep the version equal; give the late answers a newer one.
- **Playwright `--project chromium <file>` reads the file as a project name.** Use `--project=chromium <pattern>`.
- **To screenshot a "Reading…" state, hold the mock's guide download:** an async `onRequest` hook that `await`s a gate promise for `/xmltv.php` (`e2e/guide-mapping.spec.ts`'s `startMock`).
- **`SettingsScreen.tsx` is CRLF** in this worktree, other files LF. A `grep $'\r'` check wrongly said LF: count bytes with python. Patch scripts normalize to LF, patch, and restore CRLF.
- **Long Bash heredocs with quotes broke again.** Write patch scripts with the Write tool, then run them.
- **A bg mutation run of 126 mutants (about 40 min) finished;** the bg `pnpm verify` after it was reaped at its e2e stage. Run the touched specs alone and let CI's verify run the rest.

**From earlier legs (still true):**
- **A `typeof x === 'object' &&` guard before reading a field of an `unknown` is masked:** only `null` and `undefined` throw. Write `x === null || x === undefined ? … : …`.
- **The lazy first load can hide an edit path:** `await q.reload()` before the edit in such tests.
- **`tsc -b` at the root leaves an untracked `tsconfig.tsbuildinfo`.** Use `pnpm typecheck`.
- **The Edit tool (and Write) decode `\u` escapes.** Build the escape as `chr(92) + 'u2212'` in a Write-tool script.
- **Pushing a screen tells the focus listeners before `nav.push` returns**, so a listener that reads the screen signal must handle `null`.
- **An e2e can't see a `data-pending` sum:** unit-test the root by calling `SettingsScreen(...)` as a function with a fake `settings`.
- **Components that read focus through `useZone` can be called as functions in unit tests.**
- **A Button's `data-state`:** `idle` for the zone's other items while the focus is in the zone; `memory` once the focus has left it.
- **A list page that was dropped (LRU) and is wanted again** must be asked again. The navigator clamps and floors any focus index.
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Docs are safe.
- **If Claude Code stops a background mutation run for low memory**, check `git status` for `*.mutbak`, diff it against HEAD, `mv` it back, and go on in the foreground in ranges of 25.
- **TV bundle polyfills:** no member named `at`, no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from` or iterator calls in TV files; count main after any TV-file change (219).
- **Code rules:** components in `packages/ui` stay hook-free; UI text comes only from the catalogs (Arabic text has no Latin words: names go in as arguments); provider text uses `dir=auto` + `translate=false`; physical CSS only; TV code is `lib: ES2017`; the app imports only types from `@zoma/data` (values from narrow entries); a new screen root needs `data-screen/zone/index`.
- **Dependencies** must be at least 2 weeks old. Never weaken lint.
- **Commits:** scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 4,023 unit tests, both TV builds and the core-js count; the three e2e specs touched; mutation 124/124; screenshots looked at.
  - PR #59's CI green on verify (the full e2e) and engines; merged as `baddf70`.
- **Not done:**
  - The local full `pnpm e2e` (reaped; CI ran it).
  - An e2e mutation list for 24e (the context check came first).
  - The settings screens and the picker have never run on a TV or on Chromium 53/56/68.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate (tv-setup.md 3.2), the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10 (including the audio, subtitle and picture-size key codes, and an Info/Guide key), S11 by ear, S5's suspend and soak, and the player itself (step 21).
- **Later, from the spikes:** an on-screen keyboard if the TV keyboards fail (S10); webOS's PRE-CH key; the accessibility route; pre-buffered zapping (S8); the last frame kept while reconnecting; step 38's settings rows; parsing subtitle files off the main thread; a remote's own "Guide" or "Info" key.
- **Later cleanups:** drop Chromium 53 (ADR-012); a memory signal for the tier (step 41); holding refreshes while a low-tier TV plays; the catalogs as a UTF-8 file; a "loading" look for rows not read yet (the guide's, the unmatched list's, the picker's); the details dialog, the settings and the picker on the old-engine walk; a screen for a user's guide's own zone (`UserGuide.offsetMinutes`).
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs and real icons.

## "Press these keys" checklist for step 24e (Omar, in `pnpm dev` or on a TV)
1. Onboard the mock panel. Header "Settings", "TV guides", Up, then the header's second button "Channels without a guide: 1", OK.
2. OK on "18+ Test Pattern": the picker. "Channel: 18+ Test Pattern · no guide has it yet", "9 channels", "No guide" first, nothing checked.
3. OK on the search field, type `kids`, then OK: the focus is on "No guide"; Down to "Zoma Kids Test", OK. "Reading the guides…" shows by the title, then "Every live channel has a guide."
4. Back three times to the list, go to "18+ Test Pattern": its now line is Zoma Kids Test's. Open "Guide" and go down to its row: the same schedule as "Zoma Kids Test".
5. In the guide, on "Zoma Test 1 SMPTE", Right to the next programme, OK, Right to "Guide channel", OK: "now Zoma Test 1 SMPTE, found by the guides", that row checked. Down to "No guide", OK: "Reading the guides…" in the guide's header, then its row says "No information" (row 12, the same channel in another group, keeps its programmes).
6. Back in the picker while typing closes only the keyboard; Back again closes the picker with nothing saved.
7. Arabic: the same with Arabic words (`الاختبار` finds "قناة الاختبار الإخبارية"); everything mirrors, the check on the right.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description (108 runs, 80 that must fail).
- **The relay cap:** 60 legs; leg 60 is the last. Step 25 and beyond need `/relay continue iptv-20261101-214120`.
- **Secrets:** none pending.
