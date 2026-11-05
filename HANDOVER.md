# Zoma IPTV: relay leg 59 opening prompt

You are leg 59 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–57 did steps 1–23 and 24a–24c, except step 16's Samsung part, 19b and 21 (PRs #1–#56).
- **Leg 58 did step 24d, manual mapping: the data:**
  - It merged as PR **#57** (merge commit **`f39b7b4`**, branch kept). CI on `8119dee` was green: verify 5 m 41 s, media 8 m 31 s, engines 15 m 27 s.
  - The leg stopped once as needs-you: GitHub Actions wouldn't start jobs (the private repo's minutes and budget ran out). **Omar renamed the repo `Omarmarei/Lablo` and made it public**; the run then passed.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV. Leave them open, as earlier legs did.
- **Relay cap:** 60 legs. Leg 58 was the 58th, so 2 remain: 24e, and one more.

## The repo is public now (`Omarmarei/Lablo`)
- **Use `-R Omarmarei/Lablo`** with `gh`. The old name `zoma-iptv` redirects; the worktree's `origin` is already `https://github.com/Omarmarei/Lablo.git`.
- **The product is still "Zoma"** in code, app IDs and docs.
- **CI runs on `pull_request` and `workflow_dispatch` only.** There is no run on main after a merge, so don't look for one.
- **A `changes` job picks the jobs:**
  - docs alone run none;
  - `engines` runs when the TV bundles or their harness change;
  - `media` runs when the mock, data layer, player, lab or scale tests change.
  - A skipped job shows as "skipping" in `gh pr checks`.
- **Commits use the no-reply email** `58913863+Omarmarei@users.noreply.github.com`. The repo-local config already sets it; leg 58's first two commits still carry the Gmail, and history is deliberately not rewritten.
- **It is public:** no secrets, no LG binaries, no personal data in commits.

## Your step: 24e, manual mapping: the screens (RELAY.md, Phase 6)
Read RELAY.md's step 24 block first: the "Already built" note, the common Done-when items, 24d's "Done in leg 58" block, and 24e's own text.

1. **24e's text, in short:**
   - **Where it opens:**
     - from a channel in the "without a guide" list (24c's `unmatched` screen: OK on a row does nothing today);
     - from the details dialog's channel (24a), for a channel matched wrongly.
   - **The picker:** over the guides' channels, with a search field (the text editor), "No guide" first, and the current match marked.
   - **Choosing** saves the mapping and starts the guides' refresh ("Reading…" until it settles). The list and the grid show the new match after it.
   - **Done when:**
     - unit tests of the picker's state;
     - e2e in English and Arabic: the mock's unmatched channel mapped to a guide channel shows that channel's schedule in the grid after the refresh; "No guide" takes a matched channel's programmes away; Back changes nothing;
     - plus the common items: a mutation run with the list written first, `pnpm verify` green, main within budget with 219 core-js modules on both platforms (`python -I -u artifacts/poly-count20c2a.py`), screenshots looked at, the PR merged, and a "press these keys" checklist in the handover.
2. **What 24d gives you** (architecture.md §1.2 "Built in step 24d"):
   - **The search:** `DataEngine.guideChannels({ epgSrc?, query, offset, limit })` returns `{ version, count, offset, rows: { epgSrc, id, name }[] }`.
     - It covers every active guide in priority order, or one guide (`epgSrc`).
     - A channel is listed when each word of the query, normalized as the matcher does, is in one of its names or its id. An empty query lists every channel.
     - Pages hold at most `GUIDE_CHANNELS_MAX_ROWS` (500); a limit of 0 gives the count alone.
     - `version` bumps at each query-worker reload (drop the held pages, as `unmatched-state.ts` does).
   - **Saving:** `engine.editProfile({ kind: 'epgOverride', key, pin })`:
     - `pin` is `{ epgSrc, channel }` (the XMLTV id as declared), `{ epgSrc: '', channel: null }` for "No guide", or `null` to take the mapping away (the guides match the channel again);
     - it resolves `false` when nothing changed.
   - **The refresh:** then the scheduler's `refreshNow()`.
     - Every guide is due at once: `epgStatus.mapping` differs from each guide's `EpgMeta.mapping`, so `epgRefreshDue` says `mapping`. The EPG worker reads the mappings from the profile itself.
     - `refreshNow` settles when its pass has ended, which is your "Reading…" end. `onGuides` tells the live screen afterwards.
   - **The current match:**
     - `nowNext`/`shortEpg` give `{ epgSrc, channel, method }`, and `method === 'override'` marks a mapping.
     - "No guide" isn't visible there (`epgSrc` is `null`, as for an unmatched channel), so read the profile's `epgOverrides`.
     - **`epgOverridesOf` is exported from the package index only, not from `@zoma/data/client`.** The app imports only types from `@zoma/data`. Add it to `client.ts` and count main's core-js modules after, or read `profile.doc.epgOverrides[key]` directly (it's typed on `ProfileV4`).
   - **"No guide"** also stops the panel's short EPG for that channel (the query worker, no request).
3. **Where to look:**
   - The list screen: `apps/tv/src/settings/unmatched-state.ts` and its page in `SettingsScreen.tsx` (CRLF).
   - The text editor and a form: the guides screen's "Add a guide" form in `guides-state.ts` (step 22b2).
   - The details dialog: `apps/tv/src/guide/programme-details.ts`, `ProgrammeDialog.tsx` (find them with Glob).
   - The scheduler: `apps/tv/src/data/refresh-scheduler.ts` (`refreshNow`).
   - The mock: the panel's guide declares 9 channels, all used. "18+ Test Pattern" (`x:s1:live:109`, category "18+ Test (lock check)") is the one live channel without a guide.
   - The e2e to copy from: `e2e/guide-matches.spec.ts`, `guide-offset.spec.ts`, `guides.spec.ts`.
4. **First check what exists:** `git log --oneline -10` and a grep for `guideChannels`/`epgOverride` in `apps/tv/src` (24d added only the engine method).

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.
3. Main has no CI run after merges (above): nothing to check there.

**Never call EnterWorktree**, even though Claude Code's background note asks for it: the relay worktree is your isolation.
- Use `git -C`, `pnpm --dir`, `gh -R Omarmarei/Lablo` and absolute paths.
- **Never `cd`**, not even at the head of a Bash call.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>`.
- Never use bare `git stash`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `8985a34` ("docs: record PR #57's merge, tick step 24d"), on top of `f39b7b4` (main: the branch was fast-forwarded to it, PR #58's CI change included). It is pushed, and the tree is clean.
- **main** has `f39b7b4`. The branch is ahead by `8985a34` and the handover commit, both docs; they go to main with 24e's PR.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (the 300 MB fixtures), `dist/` (built from the current code);
  - `artifacts/`, which includes:
    - `mutate24d.py` (the newest unit template: `--check`, `--from`/`--to` ranges, positions printed per mutant, "taken out" and "left out" notes) and its logs `mutate24d-{a,b,c}.log`;
    - `mutate24c-e2e.py` (the newest e2e template);
    - `poly-count20c2a.py`.
- **On the TV:** the lab `com.zoma.iptv.lab` 0.1.1 (CLI device `tv`, `prisoner@192.168.1.8:9922`). The app itself was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/` and the image `zoma-webos-sim:local`. Never commit or push them (LG's license; the repo is public).

## Facts from leg 58 (step 24d)
- **Storage:** `[epgSrc, gen, 'declared']` in `epg_channels`, beside the match table: `{ ids, names, search }`. No migration. `EPG_INGEST_VERSION` is 2, so every user's guides are downloaded and read again once.
- **A mapping stays when a newer guide drops its channel.** The channel then has no guide and shows in 24c's list. A removed user's guide takes the mappings into it away.
- **`normalizeName` drops dots** (`BBCOne.uk` → `bbconeuk`); it doesn't make them spaces.
- **Xtream sources' id matches are `xtream-id`**, not `id` (keys `x:…`), in now/next's `method` and the summary's `byMethod`.
- **Checks:**
  - 3,887 unit tests;
  - `pnpm e2e` 84/84 locally, in 1.6 min;
  - the 300 MB scale numbers: store 8.4 ms, first search 2.2 ms, each later search ≤ 0.5 ms;
  - mutation 76/76.
- **Size:** main 327.6 KB (Tizen) and 315.0 KB (webOS); the query worker 107.2 KB; the EPG worker 117.3 KB; app.css 69.0 KB; 219 core-js modules.

## Gotchas and lessons
**New in leg 58:**
- **A mutation run in the foreground in ranges of 25** (`--from=0 --to=25` …) took about 8 minutes per range, with no low-memory stop.
- **The lazy first load hid an edit path again** (the short EPG's "no guide" set): `await q.reload()` before the edit in such tests.
- **A `typeof x === 'object' &&` guard before reading a field of an `unknown` is masked.** Primitives have no such field; only `null` and `undefined` throw. Write `x === null || x === undefined ? … : …`.
- **`tsc -b` at the root leaves an untracked `tsconfig.tsbuildinfo`.** Use `pnpm typecheck`, and delete the file if it appears.
- **A run GitHub refused for billing can be rerun later**; it keeps its run id.

**From earlier legs (still true):**
- **The Edit tool (and Write) decode `\u` escapes.** Build the escape as `chr(92) + 'u2212'` in a Write-tool script.
- **Git Bash's quoted heredoc turns `\\` into `\`.** Write multi-line scripts with the Write tool, then run them.
- **Line endings:** `SettingsScreen.tsx` and `settings.css` are checked out CRLF; most other files are LF. The patch scripts detect the ending and restore it.
- **Pushing a screen tells the focus listeners before `nav.push` returns**, so a listener that reads the screen signal must handle `null`.
- **An e2e can't see a `data-pending` sum:** the mock answers before any wait looks. Unit-test the root by calling `SettingsScreen(...)` as a function with a fake `settings`.
- **Components that read focus through `useZone` can be called as functions in unit tests** (`unmatched-screen.test.ts`).
- **A Button's `data-state`:** `idle` for the zone's other items while the focus is in the zone; `memory` once the focus has left the zone.
- **A list page that was dropped (LRU) and is wanted again** must be asked again.
- **The navigator clamps and floors any focus index.**
- **Never edit source while `pnpm verify`, `e2e:media` or a mutation run is going.** Docs are safe.
- **If Claude Code stops a background run for low memory**, check `git status` for `*.mutbak`, diff the backup against HEAD, `mv` it back, and go on in the foreground in ranges.
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
- **Commits:** scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line.
- **CLAUDE.md edits need Omar's direct word in his own tab.**
- **The relay context check fired at about 451k tokens in leg 57.** Budget 24e's e2e, two mutation runs and the PR's CI wait (about 16 minutes) inside it.

## Verified vs not
- **Verified:**
  - Locally: lint, typecheck, 3,887 unit tests, both TV builds and the core-js count; `pnpm e2e` 84/84; the 300 MB EPG media tests; mutation 76/76.
  - PR #57's CI green on all three jobs; merged as `f39b7b4`.
- **Not done:**
  - The rest of `test:media`, `e2e:media` and `verify:engines` locally (CI's media and engines jobs ran them).
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
  - a screen for a user's guide's own zone (`UserGuide.offsetMinutes`);
  - whether a channel mapped to "No guide" should stay in 24c's "without a guide" list (it does now; 24e may mark it).
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
- **The relay cap:** 60 legs, with 2 left after leg 58. Step 24e fits; step 25 and beyond need `/relay continue iptv-20261101-214120`.
- **Secrets:** none pending.
