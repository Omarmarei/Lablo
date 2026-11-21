# Lablo IPTV: relay leg 132 opening prompt

You are leg 132 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–130 did steps 1–33, 35, 35e, 36a and 36b (PRs #1–#157).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then;
  - step 36d's question ("multiple sources merged", three options in RELAY.md). Nothing before 36d depends on it.
- **Leg 131 (2026-11-21): built step 36c, the editing screens; its last gates are left** (the relay's context check stopped the leg):
  - **"Edit channel"** (`apps/tv/src/settings/channel-edit.ts`, views in `ChannelEditPage.tsx`, all in settings.js): the info bar's sixth button, a pencil (an icon button, its label for screen readers), opens a menu over the video at the inline end, drawn as the favourites panel: Rename, Channel number, Hide or Show channel, "Undo my changes" (when anything is changed), Cancel. Rename and Channel number are dialogs. Each action goes through `editProfile` (kind `channel`); once the worker takes it, the menu closes and the live screen reads again (`live.channelsChanged()`); refused, it stays and says "Couldn't change the channel.".
  - **Settings › "Channels"** (`edited-channels.ts`, the seventh settings row): row 0 "Clean channel names" (Off/On, OK switches in place), then each changed channel (read by key, 100 a call), OK opening the same menu as a dialog over the page.
  - **Main's side:** `PlayerOptions.editChannel` (`ChannelEditHost`: open, close) wired in `main.tsx` through `settings.use`; `LoadedSettings.over(screen)` and `Over` (settings.ts) let `LiveApp` paint the menu inside `PlayerScreen`'s new `over` slot (the info bar hides under it).
  - **The player's pin** is now a signal (`pin`): the bar draws again when the list's row takes over after a re-read (the e2e found a rename showing the old name). It is also cleared when the player closes: a **35d bug** (a channel played over the list at row N played again instead of row N's own channel next time).
  - `TextFieldKind` gains `tel` (packages/ui).
  - Decisions, refinements and what's verified are in RELAY.md 36c ("Decided in leg 131", "Refined while building", "Verified in leg 131", "Left for leg 132").
- **Next: finish 36c** (mutation, engines, PR, docs), then end as needs-you on 36d.

## Read first
1. **`RELAY.md` step 36c:** "Decided in leg 131", "Refined while building", "Verified in leg 131", **"Left for leg 132"**; the last progress row (131).
2. **`artifacts/mutate36c-list.md`** (gitignored, in the worktree): the mutation list written in leg 131 before any run, by file, with the test command for each file and the equivalent mutants left out.
3. **`artifacts/mutate36b.py`:** the runner to copy (its `MUTATIONS` tuples, `TESTS`, `--check`, `--from/--to`, `MUT_TIMEOUT`).
4. **`docs/architecture.md` §1.4 item 10:** "Built in step 36b" (the block to follow for "Built in step 36c"); §2 "Built in step 35c"/"35d" for the player notes; line ~1157 (the settings rows: now seven).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -5` shows this handover's commit, then `c2f8cdc`, `7dbd6cf`, `3319695`, `54db638`;
   - `origin/main` is `dc5194f` (PR #157's merge);
   - no `*.mutbak` anywhere (`find` outside node_modules);
   - `docker ps` shows only `lablo-web-postgres-1`;
   - free memory (leg 131 started with 27.4 GB of free commit, 6.2 GB physical).
2. **Mutation:** build `artifacts/mutate36c.py` from `artifacts/mutate36c-list.md` (the snippets must match the code exactly: read each file first; `python -X utf8 -I -u artifacts/mutate36c.py --check` until every snippet is found once). Run in foreground chunks (`MUT_TIMEOUT=120` for unit, `240` for the e2e ones; logs `artifacts/mutate36c-a.log`…). Close each survivor with a test, or take it out as equivalent with its reason in the script's docstring.
3. **`verify:engines --engine chrome53 --engine chrome68`** alone (the old-engine walk opens the player and Settings: the sixth button and the seventh row may move a probe). Log `artifacts/engines-36c.log`.
4. **Full `pnpm test` once more** (leg 131's full run, 8,044, was before the gap tests; settings and player alone are 636 now), lint of the changed files, `pnpm typecheck`.
5. **Docs:** architecture.md §1.4 item 10 "Built in step 36c" (the menu over the stage and from Settings, the actions and forms, the digits rule, `tel`, `pin` as a signal and cleared on close, sizes: main.js 428.8 → 432.6 KB Tizen and 416.1 → 419.9 KB webOS, settings.js 66.1 → 78.6 KB, core-js unchanged at 216 and 6; tests; mutation; engines); §2's player notes (the pencil, `pin`); the settings row count (seven). RELAY.md: tick 36c with the PR, update "Verified".
6. **The PR** from `relay/iptv-20261101-214120` to `main` on green CI; merge it (merge commit, keep the branch). Name the three riskiest changes first: the player's `pin` signal and its clearing on close (every play path reads it); the menu painted inside `PlayerScreen` via `LoadedSettings.over` (main ↔ settings.js); the seventh settings row (888 of 892 px).
7. **Then 36d:** end the leg as needs-you with RELAY.md's three options (unless Omar has answered).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`dc5194f`) plus:
  - `5f801a3` and `54db638` (leg 130's docs);
  - `3319695` (feat: 36c's screens);
  - `7dbd6cf` (test: the gaps closed while writing the mutation list; two redundant lines out of `push`);
  - `c2f8cdc` (RELAY.md 36c, progress row 131);
  - this handover's commit (docs: HANDOVER.md).
- **No PR is open for 36c yet.** `main` is `dc5194f`; the main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 131's full `build:tv` (with 36c, before the gap-test commit, which changed no app code but `push`'s two lines);
  - in `artifacts/`: `mutate36c-list.md`; `unit-36c-leg131.log`, `typecheck-36c-leg131.log`, `build-tv-36c-leg131.log`, `e2e-36c-a-leg131.log`, `-b-`, `-c-`; screenshots `channel-edit-*.png` and `channels-*.png` (en, ar, en-XA).

## Verified vs not
- **Verified in leg 131 (not yet on CI):**
  - unit: full `pnpm test` 8,044 before the gap tests; settings + player 636 after them;
  - `pnpm typecheck`; eslint of every changed file;
  - `build:tv`: main.js 432.6 KB Tizen / 419.9 KB webOS, settings.js 78.6 KB, every worker unchanged; core-js modules unchanged (module diff: 216 in main, 6 in settings.js);
  - e2e: `channel-edit-screens.spec.ts` (en, ar: rename, renumber with the remote's digits and a wrong number, number entry finding 42, hide with the list and the rail's count following and 42 still found over the list; "Channels": the row's marks, the switch on, Show, Undo, the list back with Clock's name cleaned; en-XA walk of the panel, both forms, the menu dialog and the page), then every e2e spec: 54 + 40 + 185 passed;
  - screenshots looked at (panel, forms, page, menu in en and ar).
- **Not yet:** mutation; `verify:engines`; CI; the PR and merge; architecture.md; 36d; production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 131:**
- **A screen that draws the player's pinned row needs a signal:** after a re-read (`listChanging` → `locate` → `load`), the pin gave way to the list's row with no signal changing, so the bar kept the old name. `pin` is a signal now; `player.row()` reads it.
- **Clear the pin when the player closes:** otherwise `show(N)` at the pinned row plays the pinned channel (35d's `over`, 36b's hidden number entry).
- **The info bar overflows in en-XA since step 20c2b** ("Picture" ends at x = 1,883, the star 1,907–2,245, the pencil 2,269–2,305; the safe edge is 1,824). en ends at 1,688 and Arabic starts at 382. A later fix (below); the e2e checks the pencil's fit in en and ar only.
- **en-XA `untranslated()` over the info bar** catches the clock's "PM": scope it to `.player__actions`.
- **The number form:** `type="tel"`, not `number` (a `number` input reads '' for a bad entry, ignores `maxLength`, and its arrow keys change it). A digit after an error or after four digits starts a new number (the remote has no delete key).
- **e2e for the panel:** the wrapper `[data-testid=channel-edit-over]` carries `data-editing`; the panel `[data-testid=channel-edit]` carries `data-pending`, `data-problem`, `data-over`; from Settings the same test id is the Dialog (no `data-over`). Rename's field starts with the shown name: `page.keyboard.press('Control+A')` before typing.
- **The relay context check fires at ~450k tokens:** 36c's build + tests + e2e took a whole leg; leave mutation, engines, PR and docs as a separate leg when a step has screens.
- **Shell:** a long `python - <<'EOF'` heredoc with quotes failed again ("unexpected EOF while looking for matching"): Write the patch script to the job's tmp folder, then run it.

**From leg 130 (still true):**
- **`ZapList.find` resolves to `number | LiveRow`** (a `LiveRow`: play it over the list; `pinOver`).
- **e2e on the live screen:** UP reaches the header only from the list's first row; Back from the guide lands on `live/channels/<row>`; in Arabic the rail is right of the list; `[data-testid=live]` is absent while search, guide or settings paint.
- **Channel changes in an e2e without the screens:** `storedChannels`, `editProfile` in `e2e/channel-edits.spec.ts`.
- **The mock:** `mock({ now, catalog })` serves any catalog; its M3U has no `tvg-chno` (numbers by place 1–12).
- **Main's module diff:** a `.mts` probe outside the repo importing `file:///D:/Claude%20Code%20PlayGround/IPTV-relay-20261101-214120/tools/build/src/bundle.ts`, `bundleIife({ input: <main.tsx>, platform: 'webos', label: 'probe', split: true, lazyLabel: (f) => f })`, run with `pnpm exec tsx`; `r.modules` and `r.lazy[i].modules` filtered for `core-js`. "Before": `git diff > p.patch; git checkout -- .; probe; git apply p.patch`.
- **Mutation:** a stale-answer guard survives when the held answer comes before the reload's list (let the new list in first); RPC wrappers need an e2e path only they serve.

**From legs 125–129 (still true):**
- The query worker serves a view (hidden out, user names); 8.4 KB left (141.6 of 150).
- Vitest `toEqual` ignores `undefined` properties (check `Object.keys`).
- An e2e spec must not import an app module that reaches `@lablo/ui` (root tsc TS6142).
- Settings' e2e paths: Home `live/header/3`, Search `4`, Settings `5`; "Channel groups" is `settings/items/5`, "Channels" `settings/items/6`.
- CI: about 30 min in all (engines 28, verify 12–17, media 11 when core/data change, web 3); known flakes `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 DevTools start-up; rerun after the whole run (`gh run rerun --failed`); a push cancels the PR's CI; no `jq` (use `gh --jq`).

**From earlier legs (still true):**
- **Memory:** about 80 old leg tabs hold a `claude.exe` each: run heavy checks one at a time (mutation, then `verify:engines` alone, then e2e, then unit).
- **Mutation:** list first, `--check`, foreground chunks, `MUT_TIMEOUT` (never an outer `timeout`), restore any `.mutbak` with `mv`.
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
- **Step 36d `[needs Omar]`: "multiple sources merged".** The leg that reaches it ends as needs-you with RELAY.md's three options:
  1. label same-named groups with their source (recommended);
  2. merge same-named groups into one rail entry;
  3. show one row for the same channel in two sources, with a fallback (better after launch).
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (with `diag_report_no_install`) and deploy, each with his one-word OK.
- **Later fixes to propose (no step yet):**
  - **new:** the info bar overflows the safe area in en-XA (since step 20c2b): a third, longer language would need icon buttons or two rows;
  - **new:** a hidden channel playing over the list keeps its old name on the bar if renamed from the same pencil (the pin isn't re-read; zapping away and back shows it);
  - **new:** after hiding the channel that plays, CH+ skips one channel (the pin stays at the hidden row's index, and the list's rows moved up);
  - **new:** main's `editChannel.close` has no e2e path (a card over the open menu); the player's call is unit-tested;
  - **new:** an eighth settings row (step 38) won't fit (seven use 888 of 892 px): step 38 orders the complete screen;
  - the guides screen's clipped third line; `auto-next.spec.ts`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset.spec.ts` en-US; `rpc.test.ts:179`'s 5 ms sleep; caching ffmpeg in CI's media job; forwarding workers' unhandled rejections (33c); the manual EPG mappings (`epgOverrides`) don't follow a refresh's re-match; `e2e/config-server.ts`'s `close()` should call `server.closeAllConnections()` first (the `telemetry.spec.ts:202` stall).
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers: an Arabic onboarding; typing a backup code; a login and a guide link given again; Settings' report rows; a telemetry send and a real TV's report once step 34 has an API; the favourites star and "Channel groups"' move mode with the TV's remote; Settings' first open on the TV (settings.js); **step 36's pencil, its forms with the TV's number keyboard, and Settings › "Channels"**.

## Checks for Omar
1. **Optional:** answer step 36d's question early in any tab (RELAY.md step 36, "36d": 1, 2 or 3).
2. **Optional, to see 36c:** `pnpm exec playwright test e2e/channel-edit-screens.spec.ts --project chromium` in the worktree, or the screenshots `artifacts/screenshots/channel-edit-panel-en.png`, `channel-edit-rename-en.png`, `channel-edit-number-wrong-ar.png`, `channels-en.png`, `channels-menu-ar.png`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** about 80 old relay-leg tabs in Cursor keep a `claude.exe` each (about 40 GB committed): please close the old leg tabs; `voicebox-server` held 26 GB in legs 93–94: please close it too.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session"; open the app in Arabic once; try "Use a backup code" with the TV's keyboard; open Settings once (step 35e's file); try the info bar's pencil.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-six CLAUDE.md gaps** wait for his word: 1–28 `git show d05d5fd:HANDOVER.md`; 29–47 `git show 5fffb27:HANDOVER.md`; 48–54 `git show 081c1ee:HANDOVER.md`; 55 `git show e85772d:HANDOVER.md`; 56 `git show 6235456:HANDOVER.md`.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
