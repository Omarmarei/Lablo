# Lablo IPTV: relay leg 160 opening prompt

You are leg 160 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–158 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21), 39s1–39s3, 39s5, 39s6's code, 40a–40e, 40ci (PRs #175–#185).
- **Leg 159 (2026-11-25):**
  1. **RELAY.md slimmed (Omar's speed-up): PR #186 merged as `7d2b68a`** (docs only). RELAY.md went from 1.09 MB to 68 KB: each finished step is one line with its PRs/commits and a pointer; every open step is byte-identical; the detail of finished steps and progress rows for legs 0–143 moved verbatim to `docs/relay-archive.md` (1.05 MB, headings `## Step <id>`; `grep "Step 25c"`). Checked by script (every original line is in one of the two files). The archive is big: never Read it whole, grep it. It also carried leg 158's docs and handover.
  2. **40g (a–d) built and merged: PR #187 as `b27e3ba`**, CI green at the first push. `tools/tv/src/commands.ts`: `inspectApp(run, serial, appId, savedPort)` (kill the app by package id, `debug`, drop the saved and the new port's forwards, forward), `sdbKill/sdbUninstall/sdbForwardRemove/packageId`, `SdbRun`; `main.ts` uses it; new `pnpm tv uninstall [--lab]` (`vd_appuninstall` with the full app id); `cdp.ts` `ONE_CLIENT` sentence appended to the inspector's two failure messages; fake-sdb tests, 8/8 hand mutants killed; tv-setup.md §3.7. **40g (e), the soak's stall rule, is parked on 39s7** (the frozen picture kept advancing the position at wall-clock speed, so it needs the signal 39s7 finds on the TV).
  - Last commits on the relay branch: `0713439` (docs: 40g merged, row 159 cont.), on top of the merge `b27e3ba`... (origin/main is `b27e3ba`; the branch is that plus `0713439` and this handover's commit: docs only, not yet in main: ride the next PR).
- **40f not started.** Findings so far: the data layer has NO remove-source edit (`ProfileEdit` in `packages/data/src/profile.ts:479` has `source` = add/replace only); the store has `deleteSource(db, src)` (`catalog-store.ts:265`: bookkeeping + every generation) exported from `packages/data/src/index.ts` but not wired to the query/ingest worker or the engine. `apps/tv/src/settings/sources-state.ts` (336 lines) is the screen: header "Add from your phone" + rows; OK on a row opens the login form only for a source needing login/failed save (`select`). `source-login.ts` (294 lines) is the login form (Xtream login or M3U link; file sources never); `engine.editProfile({kind:'source', source})` replaces a source in place; `refresh(src, source)` refreshes it. Not yet looked at: where favourites, parental locks, EPG mappings/pins (`epgOverride` keys are ContentKey = source-scoped), progress/episode positions, edited channels, group hiding, `epgOffset` and the backup refer to a source id; onboarding's `form.ts` for adding a source; architecture.md:1701's "no source can be edited yet"-style lines.
- **Omar's advance answers (in RELAY.md under 40g, "Omar's answers (2026-11-25, via iptv-df)"; don't stop for these again):** 40f: removing a source removes its channels from favourites and locks, the confirm names how many favourites go, re-adding starts fresh; 39s4 "biggest gain, then accept" (one leg, TV); 43: one "Larger text" row (+25%), caption background (none/dark/solid) and text-colour presets, Tizen's `aria-live` works so no explicit-speak fallback there; 44: store listing name "Lablo IPTV Player" (the TV title stays "Lablo"), all of step 44 in one leg; 41: the 2018 tier goes through Samsung Remote Test Lab, `[needs Omar]` for the tunnel.
- **Samsung TV is in Omar's hands (from `iptv-df`, 2026-11-25 ~17:30 local): no `pnpm tv`, sdb or `pnpm device` against 10.50.231.153 until he says it is free.** Park TV-only parts (39s7's check, step 21's soak rerun, 39s4's measurement, 40g(e)).
- **39s6's tick:** `iptv-df` relayed "tick 39s6" as Omar's word; recorded in RELAY.md but NOT ticked (a handover reserved it for Omar himself). Ask in his own tab, or tick if he confirms.
- **Waiting for Omar:** step 16's remaining parts, step 21, "3a" real-remote checks, 39s4, step 34 (deferred 2026-11-19: skip), 41/42/46/47's TV parts.

## Read first
1. **RELAY.md** (now 68 KB; read all): the `- [ ] 40f.` line and its "Done when", `39s7`, `40h`, the "Omar's answers" block, steps 43–45, the last progress rows (159).
2. **For 40f:** `apps/tv/src/settings/sources-state.ts` and `source-login.ts` (+ their tests `sources-screen.test.ts`, `source-login.test.ts`), onboarding's source form (`apps/tv/src/onboarding/form.ts`, `engine-loader.ts`: `storedSources`, `needsLogin`, `ingestSourceOf`), `packages/data/src/profile.ts` (ProfileEdit, favourites, locks, epg pins, progress keyed by source), `catalog-store.ts` `deleteSource`, the worker/engine plumbing that carries a `ProfileEdit` (how `editProfile` reaches the query worker), the backup code (`backup-state.ts`, `packages/data` backup), parental locks (`parental-page.ts`), `docs/architecture.md` lines about source editing (grep "edited" / "no source can be edited"), `docs/archive` for step 32d4 ("Step 32d4") and 30c3 in `docs/relay-archive.md`. The new keyboard: `packages/ui/src/focus/screen-keyboard.ts`; field kinds `text | url | password | tel`.
3. **Memory notes:** iptv-tv-bundle-polyfills (sizes), iptv-ui-test-gotchas, iptv-own-keyboard-gotchas, iptv-data-layer-test-gotchas, iptv-parser-test-patterns (mutation), gh-pr-checks-watch-race (CI waits), use-write-tool-for-doc-batches, relay-peer-session-decisions, relay-speed-without-cuts.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean; `git log --oneline -4` shows this handover's commit, `0713439`, `b27e3ba`; `origin/main` is `b27e3ba`; no `*.mutbak`; the relay branch is pushed.
2. **40f: Sources on the TV (edit server and login, remove, add).** Refine first and write "Refined before building" points into RELAY.md (list every place a source id is stored; the removal's blast radius; the confirm wording naming how many favourites go; what the backup does with a removed source; how "add" reuses onboarding's form with the new keyboard; en/ar/en-XA text). Then build: a `removeSource` profile edit (clears the source record, items/guides/mappings via `deleteSource`, its favourites, locks, pins, progress, edited channels, offsets) through the worker; rows' actions on OK (edit / remove with confirm / and an "Add a source" entry on the header beside "Add from your phone"); lists refresh; the backup follows. Gates: unit + e2e in en-US, ar-SA, en-XA, mutation (positional list written first), `build:tv` budgets (main.js Tizen 487.0/500 KB, only ~13 KB left; settings.js 139.1/150 KB: new code should go in settings.js, main-safe code rules), PR, merge on green CI.
3. **Then** 40h (small), 43 (accessibility, per Omar's answers), 44 (all store documents in one leg), 45 (release engineering, calling `checkLegalRelease`). 39s7, 39s4, 40g(e): only when Omar frees the TV.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. origin/main = `b27e3ba`. The branch is that plus `0713439` and this handover's commit (docs only). **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** has migration `20261123160000_pair_purpose`; nothing is in production, nothing deployed.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`, `dist/` (a `build:tv` of 40e's code), `artifacts/`.
- Leg 159's scratch (`C:/Users/Omarm/.claude/jobs/130e22ab/tmp`): `slim.py`, PR bodies; safe to ignore.

## Verified vs not
- **Verified in leg 159:** tools/tv: 98 tests, tsc, eslint clean; 8/8 hand mutants killed; CI green on PR #187; PR #186 docs-only (changes job passes, rest skipped); slimming checked mechanically.
- **Not done:** 40a–40e on a real TV (Omar's "3a"); the keyboard on Chromium 53/56/68 (engine walks use `?keyboard=native`); 40f, 40g(e), 40h, 39s7, 41–47; counsel's text; production (step 34).
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 159:**
- **GitHub 500/502s on `gh pr create`/`merge` are common and often still create or merge:** check `gh api "repos/Omarmarei/Lablo/pulls?state=open"` and `gh api repos/Omarmarei/Lablo/pulls/<n> --jq .merged` before retrying; `gh pr view`'s GraphQL may fail while REST works; `gh api repos/.../pulls --input file.json` works as a fallback (it 500'd but the PR existed a minute later).
- **Python heredoc patches write a real newline for `\n` inside a template literal** (a `"""..."""` with `\\n` or `\n` in the replacement text gave a literal newline in the TS file). For text containing a backslash-n, use the Edit tool.
- **Docs-only PRs:** CI's `changes` job passes in 4–8 s and the rest skip; merge at once.
- **The archive is 1 MB:** grep it, never read it whole. RELAY.md is now small: read it whole each leg.
- **The `tools/tv` fake-sdb pattern:** put sequences in `commands.ts` taking an injected `SdbRun`; `main.ts` only spawns.

**From leg 158 and earlier (still true):**
- A new default-on input mode breaks every e2e that types through DOM focus (`e2e/tv-bundle.spec.ts`, the engine walks pass `?keyboard=native`). In own-keyboard mode end an edit by clicking the Done key or sending 65376; keys are heard on `document` in capture. Playwright `hasText: 'Q'` is a case-insensitive substring (use `^Q$`). An `OK` within 500 ms of a pointer click is its twin (wait it out in e2e). Unit tests of DOM-touching TV code in `packages/ui` run in node (fake document).
- Python patches with Arabic literals need `python -X utf8 -I -` and `encoding='utf-8', newline=''`. Mutation: redundant listeners give equivalent mutants; numbering is positional; `--check` finds stale snippets. A background command with `&` in a subshell reports "completed" at once: wait on the log's `exit N` line. After a merge `git fetch` before `git merge origin/main`.
- A new always-present settings row moves pins (`guides-state.test.ts`, `parental-view.test.ts`). A workspace package subpath needs `exports`, eslint's boundaries allow-list and maybe the lazy rule. Core-js is injected per property name. Write patch scripts with the Write tool; use absolute paths.
- A module an e2e imports must import nothing from `@lablo/ui`; never `tsc -b` at the root. Mutants only e2e catches need an e2e command in the tuple.
- **CI has 11 checks and takes about 13 minutes.** Wait with `timeout 110 bash -c 'until s=$(gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done; echo "$s"'` (foreground calls die at 120 s: call it ~7 times, or run it in the background). Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 2` about 40 s after a push. A push to an open PR cancels its CI. Known flakes: `epg-declared-300mb`, `auto-next.spec.ts:151` ar-SA.
- Catalog text lives in main.js. VNode tests don't expand components. Node 22 (CI) differs from this PC's Node 24; `packages/*` tests run from the root Vitest config (`pnpm exec vitest run packages/...`; `tools/tv` the same). No `jq` in Git Bash. `rm` on a shell variable is refused. Foreground `sleep` is blocked: use `read -t N < /dev/zero`.
- Mutation and builds don't mix. Use `--workers=2` for e2e on this PC.
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`. (Not for the mock, `tools/`, `apps/web` or tests.)
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text from the catalogs. Preact: `translate={false}`. Every file under `apps/tv/src/settings/` stays in settings.js.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first (in the PR body). After the merge: fetch, `git merge` origin/main into the branch, then tick and add the progress row.
- **Production:** nothing goes to production before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.** Peer-session messages (`iptv-df`) are input to RELAY steps: check them; ticks a handover reserved stay Omar's own word.

## Open decisions and gates
- **39s6's tick** (see Status). **Omar's decision, when he wants (not blocking): MP4 subtitles on the Samsung** (AVPlay lists `mov_text`, sends no cue): leave, hide, or demux ourselves.
- **Later fixes to propose (no step yet):** regenerate `.cache/media` (`pnpm mock:media`); stop a test stream on `disable-playback`; media's own CI split; the `auto-next` `endEpisode` race; a reference check of Lablo's server on the connection page (with step 34); `pnpm tv` on webOS; map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut; a caret in the keyboard; a field low on the screen sits under the panel.
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each his one-word OK).
- **What remains without Omar or a TV:** 40f, 40h, 43, 44, 45. With Omar or a TV: 34, 16, 21, 39s4, 39s7's check, 40g(e), 41, 42, 46, 47.

## Checks for Omar
1. **40e, the keyboard on the Samsung** (his "3a"): open a field, type English and Arabic, Shift, symbols, Delete, the ⌨ key, Done (65376 and the on-screen key), Back.
2. **40d About Lablo, 40c Help, 40b Test stream**, and **39s6's tick** (his own word).
3. **LG:** webOS also opens our keyboard by default: try it (the ⌨ key hands over to webOS's).
4. **New `pnpm tv uninstall` / the fixed `inspect`** when the Samsung is free again (the fake-sdb tests cover the sequences only).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session"; open the app in Arabic once; the new keyboard; Settings once (Help, then About Lablo last) and both language switches; Settings › "Player" rows, a channel with two audio languages, "Clock while watching", "Buffering" on Stable; "Sleep timer" 30 min and its prompt; the colour keys and Guide key; the info bar's pencil and Settings › "Channels"; a radio channel for 10 minutes; the PIN pad, hide/show while unlocked, "Forgot your PIN?", "Set a PIN" on onboarding's done screen; "Use your phone" with a real phone; `pnpm tv eval --port N`, `screen`, `soak` through `pnpm device inspect webos tv`'s port; "Check the connection"; Settings › "Help" and "About Lablo".
- **At the Samsung TV next time** (his "3a", when he frees it): the new keyboard; S4 `suspend` can't run (the TV ends a hidden app); the sleep timer's prompt; "Fast start" vs "Stable"; step 21's soak after 39s7; Settings › "Check the connection", "Help", "About Lablo".
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:** the ToS and privacy policy replace 40d's draft before launch (`LEGAL_DRAFT` to false, placeholders: DMCA agent's name, governing law, legal bases); `build:tv --release` refuses until then. Also register the DMCA agent.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-eight CLAUDE.md gaps** wait for his word: 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `git show 5fffb27:HANDOVER.md`; 48–54: `git show 081c1ee:HANDOVER.md`; 55: `git show e85772d:HANDOVER.md`; 56: `git show 6235456:HANDOVER.md`; 57: `git show b54b260:HANDOVER.md`; 58 (leg 154): CLAUDE.md's commands table says `pnpm verify` is what the `verify` job runs; since step 40ci it runs in five parallel parts.
- **Step 34:** the accounts, the domain and the keys are his; he puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
