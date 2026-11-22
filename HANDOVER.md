# Lablo IPTV: relay leg 133 opening prompt

You are leg 133 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–132 did steps 1–33, 35, 35e and 36a–36c (PRs #1–#158).
- **Leg 132 (2026-11-21/22) finished step 36c** (the editing screens: "Edit channel" from the info bar's pencil, Settings › "Channels"). Mutation 149/149, `verify:engines` 53/68, unit 8,047, docs. **PR #158 merged as `71f3f9f`** on green CI (second run; the first caught an older race in `favourites.spec.ts`, fixed in the test).
- **Omar answered step 36d on 2026-11-22: option 1, "label, don't merge"** (RELAY.md 36d, "Decided by Omar"). **Your step: build 36d.**
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **`RELAY.md` step 36:** the shape ("Where the user edits", the split), **36d's "Decided by Omar" line** (what option 1 means and its Done when), and the last progress row (132).
2. **`docs/architecture.md` §1.4 item 10:** "Built in step 35c" (the rail: "All channels", the lists, the groups in the user's order), "Built in step 35d" (Settings › "Channel groups" reads the same rail entries), "Built in step 36b", "Built in step 36c" (the block to follow for "Built in step 36d").
3. **The code to change:**
   - `apps/tv/src/live/live-state.ts`: `RailEntry` (~line 97: `kind`, `name`, `count`, `parts`, `allStart`, `list`) and `railEntries` (where each source's categories become entries; a `ListPart` carries its `src`);
   - `apps/tv/src/live/LiveApp.tsx` ~line 244: the rail's `Chip` (`label`, `testId` `chip-${i}`);
   - `apps/tv/src/settings/groups-state.ts` and `GroupsPage.tsx`: "Channel groups" shows the same entries (settings.js);
   - the source's name: `storedSources(profile)` (`apps/tv/src/onboarding/engine-loader.ts`) and what Settings › "Sources" shows for a source's name (`settings/sources-state.ts`).
4. **e2e with two sources:** `e2e/pairing.spec.ts` ("a new code adds a second source"); memory `iptv-mock-provider-gotchas.md` (leg 90: the M3U read on 127.0.0.1, served as `localhost:<port>/list.m3u` for a second stream host; leg 130: `mock({ catalog })` serves any catalog).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `65deb69` (36d decided), `32bde6c` (36c ticked), `71f3f9f` (PR #158's merge);
   - `origin/main` is `71f3f9f`;
   - no `*.mutbak` anywhere (`find` outside node_modules);
   - `docker ps` shows only `lablo-web-postgres-1`;
   - free memory (leg 132 ended with 34.4 GB of free commit).
2. **Confirm 36d isn't partly done** (`git log`, grep for a source label on the rail).
3. **Decide the details before coding, each with its why, in RELAY.md 36d** ("Decided in leg 133"):
   - when two names are "the same" (exact as shown, or after case and blank folding; a cleaned name, step 36a1's `cleanName`, when "Clean channel names" is on);
   - the label's form (a catalog string such as `{group} · {source}`; the source's name is data: isolated, `translate="no"`; Arabic order);
   - whether "Channel groups" in Settings shows the same label (the shape says yes);
   - a source with no name of its own (what Settings › "Sources" shows).
4. **Build it:** the label on main's rail (main.js, expected well under 1 KB; measure), the same in "Channel groups" (settings.js); unit tests; e2e in en and ar with two sources sharing a group name; the en-XA walk of the rail; screenshots looked at.
5. **Gates:** mutation (list written first: `artifacts/mutate36d-list.md`, then `artifacts/mutate36d.py` copied from `artifacts/mutate36c.py`); `build:tv` sizes (main.js now 432.6 KB Tizen / 419.9 KB webOS, settings.js 78.5 KB; module diff for core-js); `verify:engines --engine chrome53 --engine chrome68` alone; full `pnpm test`; `pnpm typecheck`; lint of the changed files; architecture.md "Built in step 36d"; RELAY.md: tick 36d and step 36 (its Done when: 36a–36d done and the phase's gate holds), progress row.
6. **The PR** from `relay/iptv-20261101-214120` to `main`; merge it on green CI (merge commit, keep the branch). Name the three riskiest changes first.
7. **Then step 37** (M3U→Xtream upgrade UX and radio channels): write its shape and split in RELAY.md first if it has none.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`71f3f9f`) plus:
  - `32bde6c` (docs: PR #158's merge recorded, 36c ticked, progress row 132);
  - `65deb69` (docs: 36d decided by Omar, option 1);
  - this handover's commit (docs: HANDOVER.md).
- **No PR is open.** `main` is `71f3f9f`; the main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 132's full `build:tv` (36c with the mutation fixes);
  - in `artifacts/`: `mutate36c.py` (149/149, the runner to copy) and `mutate36c-a.log`…`-e.log`; `engines-36c.log`; `build-tv-36c-leg132.log`, `unit-36c-leg132.log`, `typecheck-36c-leg132.log`, `e2e-36c-leg132.log`, `e2e-favourites-*-leg132.log`.

## Verified vs not
- **Verified (36c, on CI too):** PR #158 green: verify 11 m 50 s, engines 28 m 42 s, media 9 m 29 s, web 2 m 46 s.
- **Not yet:** 36d (all of it); production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 132:**
- **An e2e that refreshes the catalog must wait for the live screen's swap before playing.** Seeing the catalog request and `data-pending` 0 isn't enough: the re-read starts only at the scheduler's `onCatalog`, after the ingest, and a rows poll on names passes on the old list when the names don't change. Wait for the guides' `/xmltv.php` request after it (the scheduler calls `onCatalog` before `refreshEpg`), then `settled`. Found in `favourites.spec.ts` (en-US, CI only): OK played the old stream id, four 404s.
- **A CI e2e failure's URLs:** download the run's `playwright-report` artifact (`gh run download <run> -n playwright-report -D <dir>`), unzip the failure's `trace.zip`, read `*.network` (JSON lines; `snapshot.response.status`, `snapshot.request.url`).
- **`gh run view --log-failed` gives nothing while another job of the run still runs:** read the job's log with `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`.
- **Mutation found dead state twice in 36c:** a flag that duplicated `pending` (OK already waits on it, and there's no task between the settle and the next read) and a reset that `close` already does. When a guard's mutant survives, check whether another guard always decides first; if so, take the code out rather than writing a test that can't fail it.
- **Omar asked why legs talk about 0.5–2 KB of main.js.** main.js has a hard 500 KB budget on Tizen (ADR-003; the build fails above it), a planning number for S6's "cached cold start to usable ≤ 3 s" on the oldest TV, measured at step 41 (ADR-014). It is at 432.6 KB (87%). Mention sizes when they decide something or come near the budget; at a few KB they don't, so don't put them in front of him as a reason.
- **Omar closed the old leg tabs and voicebox-server (2026-11-22):** don't remind him again. Heavy checks still one at a time.

**From leg 131 (still true):**
- The player's pin is a signal (`pin`), read by `rowAt`; it is cleared when the player closes.
- The info bar overflows the safe area in en-XA since step 20c2b ("Picture" ends at x = 1,883); en ends at 1,688, Arabic starts at 382. Check a new bar button's fit in en and ar; scope en-XA `untranslated()` to `.player__actions`.
- A number form: `type="tel"`. A TextField that starts filled: `page.keyboard.press('Control+A')` before typing.
- e2e for the pencil's panel: `[data-testid=channel-edit-over]` (`data-editing`), the panel `[data-testid=channel-edit]` (`data-pending`, `data-problem`, `data-over`); from Settings the same test id is the Dialog.
- The relay context check fires at ~450k tokens: a step with screens takes a whole leg for build + e2e; its mutation, engines, PR and docs may need the next.
- Shell: long `python - <<'EOF'` heredocs with quotes fail: Write the patch script to the job's tmp folder, then run it (an EDITS list with `assert s.count(a) == 1`, `newline=''` on read and write).

**From legs 125–130 (still true):**
- `ZapList.find` resolves to `number | LiveRow` (a `LiveRow`: play it over the list; `pinOver`).
- e2e on the live screen: UP reaches the header only from the list's first row; Back from the guide lands on `live/channels/<row>`; in Arabic the rail is right of the list; `[data-testid=live]` is absent while search, guide or settings paint.
- Channel changes in an e2e without the screens: `storedChannels`, `editProfile` in `e2e/channel-edits.spec.ts`.
- The mock: `mock({ now, catalog })` serves any catalog; its M3U has no `tvg-chno` (numbers by place 1–12).
- Main's module diff: a `.mts` probe outside the repo importing `file:///D:/Claude%20Code%20PlayGround/IPTV-relay-20261101-214120/tools/build/src/bundle.ts`, `bundleIife({ input: <main.tsx>, platform: 'webos', label: 'probe', split: true, lazyLabel: (f) => f })`, run with `pnpm exec tsx`; `r.modules` and `r.lazy[i].modules` filtered for `core-js`. "Before": `git diff > p.patch; git checkout -- .; probe; git apply p.patch`.
- Mutation: a stale-answer guard survives when the held answer comes before the reload's list (let the new list in first); RPC wrappers need an e2e path only they serve.
- The query worker serves a view (hidden out, user names); 8.4 KB left (141.6 of 150).
- Vitest `toEqual` ignores `undefined` properties (check `Object.keys`).
- An e2e spec must not import an app module that reaches `@lablo/ui` (root tsc TS6142).
- Settings' e2e paths: Home `live/header/3`, Search `4`, Settings `5`; "Channel groups" is `settings/items/5`, "Channels" `settings/items/6`.
- CI: about 30 min in all (engines 28, verify 12–17, media 10 when core/data change, web 3); known flakes `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 DevTools start-up; rerun after the whole run (`gh run rerun --failed`); a push cancels the PR's CI; no `jq` (use `gh --jq`); watch CI with a Monitor loop over `gh pr checks <n> --json name,bucket` (prints each finished check, exits when none is pending).

**From earlier legs (still true):**
- **Mutation:** list first, `--check` until every snippet is found once, foreground chunks, `MUT_TIMEOUT` per run (never an outer `timeout`), restore any `.mutbak` with `mv`.
- **A navigator click within 300 ms of an OK key is its twin.** An en-XA shape check passes for any bracketed string.
- **Main-safe code** (settings.js too): no `trim`, `.sort(`, regex `.test`, `for…of`, `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`; blanks by char code.
- **Physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free; UI text only from the catalogs.** Arabic on/off words agree with their noun. Preact: `translate={false}`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:** CI Node 22, this PC Node 24; a bare `sleep` is blocked; `TaskStop` on `verify:engines` leaves its container; the TV build can crash once (0xC0000005): rerun; Chromium 53 DevTools start-up timeout locally too: rerun once.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34; its migration and deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (with `diag_report_no_install`) and deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers: an Arabic onboarding; typing a backup code; a login and a guide link given again; Settings' report rows; a telemetry send and a real TV's report once step 34 has an API; the favourites star and "Channel groups"' move mode with the TV's remote; Settings' first open on the TV (settings.js); step 36's pencil, its forms with the TV's number keyboard, and Settings › "Channels".
- **What remains after 36d:** 37 (M3U→Xtream upgrade and radio), 38 (parental PIN, adult groups, the complete settings screen: seven rows use 888 of 892 px, so 38 reorders it), 39 (clock, sleep timer, colour keys, buffer setting), 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering); with Omar or a TV: 34, 16/19b/21, 41 (performance), 42 (resilience), 46 (beta), 47 (store submissions).
- **Later fixes to propose (no step yet):**
  - the info bar overflows the safe area in en-XA (since step 20c2b): a third, longer language would need icon buttons or two rows;
  - a hidden channel playing over the list keeps its old name on the bar if renamed from the same pencil (the pin isn't re-read; zapping away and back shows it);
  - after hiding the channel that plays, CH+ skips one channel (the pin stays at the hidden row's index, and the list's rows moved up);
  - main's `editChannel.close` has no e2e path (a card over the open menu); the player's call is unit-tested;
  - the guides screen's clipped third line; `auto-next.spec.ts`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset.spec.ts` en-US; `rpc.test.ts:179`'s 5 ms sleep; caching ffmpeg in CI's media job; forwarding workers' unhandled rejections (33c); the manual EPG mappings (`epgOverrides`) don't follow a refresh's re-match; `e2e/config-server.ts`'s `close()` should call `server.closeAllConnections()` first (the `telemetry.spec.ts:202` stall).

## Checks for Omar
1. **Optional, to see 36c:** `pnpm exec playwright test e2e/channel-edit-screens.spec.ts --project chromium` in the worktree, or the screenshots `artifacts/screenshots/channel-edit-panel-en.png`, `channel-edit-rename-en.png`, `channel-edit-number-wrong-ar.png`, `channels-en.png`, `channels-menu-ar.png`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session"; open the app in Arabic once; try "Use a backup code" with the TV's keyboard; open Settings once (step 35e's file); try the info bar's pencil and Settings › "Channels".
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-six CLAUDE.md gaps** wait for his word: 1–28 `git show d05d5fd:HANDOVER.md`; 29–47 `git show 5fffb27:HANDOVER.md`; 48–54 `git show 081c1ee:HANDOVER.md`; 55 `git show e85772d:HANDOVER.md`; 56 `git show 6235456:HANDOVER.md`.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
- (The old leg tabs and voicebox-server: done by Omar on 2026-11-22; no longer a reminder.)
