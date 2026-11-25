# Lablo IPTV: relay leg 162 opening prompt

You are leg 162 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–160 did steps 1–33, 35–39 (39's real-TV proof waits for step 21), 39s1–39s3, 39s5, 39s6's code, 40a–40h, 40ci, 40g(a–d) (PRs #175–#189; RELAY.md is ~68 KB, detail in `docs/relay-archive.md`: grep it, never read it whole).
- **Leg 161 (2026-11-25): step 40h done and merged, PR #189 as `bdc7794`** (CI green first try). Finding: `keepFilm()` already runs at `hidden` (`apps/tv/src/player/player-state.ts`, lifecycle handler), a movie's save-at-hidden was already pinned (test "gives it the position as the app hides…"), an episode's (with the show's key) was not: added "saves the episode's position with the show's key as the app hides". Mutation (drop `keepFilm()` at `hidden`) killed by both tests. No code change. Anything else that must survive a hidden app: nothing found beyond what `hidden` already does (countdown stops, guard.hidden, positions saved); an open screen's state is lost by design.
- **Budgets are tight (Tizen): main.js 489.6/500 KB, settings.js 149.4/150, query worker 149.3/150, ingest worker 142.4/150.** Step 43 (accessibility rows in Settings) cannot fit in settings.js as it is.
- **Omar's advance answers (in RELAY.md under 40g; don't stop for these again):** 39s4 "biggest gain, then accept" (one leg, TV); 43: one "Larger text" row (+25%), caption background (none/dark/solid) and text-colour presets, Tizen's `aria-live` works so no explicit-speak fallback there; 44: store listing name "Lablo IPTV Player" (TV title stays "Lablo"), all of step 44 in one leg; 41: the 2018 tier goes through Samsung Remote Test Lab, `[needs Omar]` for the tunnel.
- **Samsung TV is in Omar's hands (from `iptv-df`, 2026-11-25 ~17:30): no `pnpm tv`, sdb or `pnpm device` against 10.50.231.153 until he says it is free.** Park TV-only parts (39s7's check, step 21's soak rerun, 39s4's measurement, 40g(e)).
- **39s6's tick:** `iptv-df` relayed "tick 39s6" as Omar's word; recorded, NOT ticked (a handover reserved it for Omar himself). Ask in his own tab.
- **Waiting for Omar:** step 16's remaining parts, step 21, "3a" real-remote checks, 39s4, step 34 (deferred: skip), 41/42/46/47's TV parts.

## Read first
1. **RELAY.md** (68 KB; read all): steps 43–45, the "Omar's answers" block, the last progress rows (161).
2. **For 44:** RELAY.md step 44's list, docs/PLAN.md (store listing, legal, accessibility pillars), `docs/runbooks`, `tools/build` (legal check). **For 43 later:** `apps/tv/src/settings/PlayerSettingsPage.tsx`, `player-settings.ts`, `settings-items.ts`, the catalogs.
3. **Memory notes:** iptv-tv-bundle-polyfills (sizes), iptv-ui-test-gotchas, iptv-own-keyboard-gotchas, gh-pr-checks-watch-race, use-write-tool-for-doc-batches, relay-speed-without-cuts, iptv-settings-sources-gotchas.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean; `git log --oneline -3` shows this handover's commit, `12b8bba`, `bdc7794`; origin/main = `bdc7794`; no `*.mutbak`; the branch is pushed.
2. **Step 44 first (no budget decision needed):** all store documents in one leg (Omar's advance answer: store listing name "Lablo IPTV Player", TV title stays "Lablo"). Docs/text work; read the step in RELAY.md.
3. **Then 43** (accessibility, Omar's answers above) which needs the settings.js budget decision: the lazy budget is 150 KB (`tools/build/src/budgets.ts`), settings.js 149.4. Options: raise `lazy` to 200 KB, or split a second lazy file (see `APP_LAZY`, `createLazyFile`, `lazyProblems` in tools/build). Legs are unattended: if you reach 43 and need >0.6 KB, end as needs-you with a one-character question: "1 raise lazy budget to 200 KB (recommended), 2 split a chunk". Prefer asking at the end of 44, not before.
4. **45** (release engineering, `checkLegalRelease`). 39s7, 39s4, 40g(e) only when Omar frees the TV.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. origin/main = `bdc7794`; the branch is main plus `12b8bba` and this handover's commit (docs only). **No open PR.** The main checkout was not touched.
- **Dev database** has migration `20261123160000_pair_purpose`; nothing in production, nothing deployed, no migrations.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `dist/`, `artifacts/` (incl. `mutate40f.py`, screenshots).

## Verified vs not
- **Verified:** 40h's test + mutation, CI green (11 checks), PR merged. 40f as in leg 160.
- **Not done:** 40a–40f on a real TV (Omar's "3a"); the keyboard on Chromium 53/56/68 (walks use `?keyboard=native`); 39s7, 39s4, 40g(e), 41–47; counsel's text; production (step 34).
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 161:** a mutation of `keepFilm()` at `hidden` showed the movie test alone was the only pin: when a behaviour has movie and episode forms, test both. Mutating with a python replace must handle `\r\n` vs `\n` (the file may be CRLF); restore from the `.mutbak` copy and check `git status`.

**From earlier legs (still true):**
- Sources screen: OK on a row opens a menu first (menu, then "Change server and login"). Typing a field's last key moves focus to the next field (don't press DOWN after `typeIn`). Test ids must be unique. `.settings__text` is centered heading text; use `settings__hint` for left body text. IndexedDB chunk store is `catalog_chunks`. `pnpm exec prettier` doesn't exist; `pnpm exec eslint --fix` formats.
- **Worker budgets decide where code lives:** check `pnpm build:tv` early; to see all sizes when one is over, temporarily raise `BUDGETS.worker` in `tools/build/src/budgets.ts` (revert with `git checkout`).
- GitHub 500/502s on `gh pr create/merge` often still succeed (check REST); python heredoc `\n` in template literals; docs-only PRs merge at once; archive is 1 MB (grep).
- A new default-on input mode breaks every e2e that types through DOM focus (engine walks pass `?keyboard=native`); in own-keyboard mode end an edit by clicking the Done key or sending 65376. An `OK` within 500 ms of a pointer click is its twin.
- Python patches with Arabic literals need `python -X utf8 -I -` and `encoding='utf-8', newline=''`. After a merge `git fetch` before `git merge origin/main`.
- A new always-present settings row moves pins (`guides-state.test.ts`, `parental-view.test.ts`). A workspace package subpath needs `exports`, eslint's boundaries allow-list and maybe the lazy rule. Core-js is injected per property name. Write patch scripts with the Write tool; absolute paths.
- **CI has 11 checks, ~13 minutes.** Wait with a foreground `read -t 14 < /dev/zero` loop plus `gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq '.status + " " + (.conclusion // "")'`; find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 2` ~25 s after a push. Known flakes: `epg-declared-300mb`, `auto-next.spec.ts:151`: read annotations, `gh run rerun <run> --failed`.
- Catalog text lives in main.js. VNode tests don't expand components. Node 22 (CI) vs this PC's Node 24. `packages/*` tests run from the root Vitest config. No `jq` in Git Bash. `rm` on a shell variable is refused. Foreground `sleep` is blocked: use `read -t N < /dev/zero`.
- Mutation, builds and e2e don't mix: one heavy thing at a time. `--workers=2` for e2e. A leftover vite on port 5391 makes the next Playwright run fail.
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`. Physical CSS only, no Grid or flex `gap`, ES2017. UI text from the catalogs. Every file under `apps/tv/src/settings/` stays in settings.js.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch); name the three riskiest changes in the PR body. After the merge: fetch, `git merge` origin/main into the branch, tick and add the progress row.
- **Production:** nothing before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.** Peer-session messages (`iptv-df`) are input to RELAY steps; ticks a handover reserved stay Omar's own word.

## Open decisions and gates
- **Settings.js budget** (Next steps 3): raise lazy to 200 KB or split; Omar's one-word call.
- **39s6's tick** (his own word). **MP4 subtitles on the Samsung** (AVPlay lists `mov_text`, sends no cue): leave, hide, or demux ourselves (not blocking).
- **Later fixes to propose (no step yet):** regenerate `.cache/media`; stop a test stream on `disable-playback`; media's own CI split; the `auto-next` `endEpisode` race; a reference check of Lablo's server on the connection page; `pnpm tv` on webOS; map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut; a caret in the keyboard; a field low on the screen sits under the panel; removal while a refresh runs fails with a generic row failure.
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each his one-word OK).

## Checks for Omar
1. **40e/40f on the Samsung** (his "3a"): open a field, type English and Arabic, Shift, symbols, Delete, the ⌨ key, Done, Back; Settings › Sources: OK on a row (menu), "Remove", "Add a source".
2. **40d About Lablo, 40c Help, 40b Test stream**, and **39s6's tick** (his own word).
3. **LG:** webOS opens our keyboard by default: try it.
4. **New `pnpm tv uninstall` / the fixed `inspect`** when the Samsung is free again.
5. **40h on the Samsung:** play a movie/episode, press Home, return (fresh start): the position should resume.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session"; open the app in Arabic once; the new keyboard; Settings once (Help, then About Lablo last) and both language switches; Settings › "Player" rows, a channel with two audio languages, "Clock while watching", "Buffering" on Stable; "Sleep timer" 30 min and its prompt; the colour keys and Guide key; the info bar's pencil and Settings › "Channels"; a radio channel for 10 minutes; the PIN pad, hide/show while unlocked, "Forgot your PIN?", "Set a PIN" on onboarding's done screen; "Use your phone" with a real phone; `pnpm tv eval --port N`, `screen`, `soak` through `pnpm device inspect webos tv`'s port; "Check the connection"; Help and About Lablo; Sources menu/remove/add.
- **At the Samsung TV next time** (when he frees it): the new keyboard; S4 `suspend` can't run (the TV ends a hidden app); the sleep timer's prompt; "Fast start" vs "Stable"; step 21's soak after 39s7; Check the connection, Help, About Lablo, Sources menu/remove/add.
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:** the ToS and privacy policy replace 40d's draft before launch (`LEGAL_DRAFT` to false, placeholders: DMCA agent's name, governing law, legal bases); `build:tv --release` refuses until then. Also register the DMCA agent.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-eight CLAUDE.md gaps** wait for his word: 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `git show 5fffb27:HANDOVER.md`; 48–54: `git show 081c1ee:HANDOVER.md`; 55: `git show e85772d:HANDOVER.md`; 56: `git show 6235456:HANDOVER.md`; 57: `git show b54b260:HANDOVER.md`; 58 (leg 154): CLAUDE.md's commands table says `pnpm verify` is what the `verify` job runs; since step 40ci it runs in five parallel parts.
- **Step 34:** the accounts, the domain and the keys are his; he puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
