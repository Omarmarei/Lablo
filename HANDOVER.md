# Lablo IPTV: relay leg 164 opening prompt (written at the end of leg 163, cont.)

You are leg 164 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** legs 1–162 did steps 1–33, 35–40h, 40ci, 40g(a–d), 39s1–39s3, 39s5, 39s6's code, 43, 44 (PRs #175–#191). RELAY.md is ~70 KB, detail in `docs/relay-archive.md`: grep it, never read it whole.
- **Leg 163 (2026-11-25): step 45 release engineering, PR #192 merged as `8c7cd95`, CI green (11 checks).** New `pnpm release:check [--no-build]` (`tools/build/release-check.ts` CLI; pure checks and 8 unit tests in `tools/build/src/release-check.ts` / `.test.ts`): legal gate, version consistency (one source: `apps/tv/package.json` feeds both manifests' `{{version}}` and About's `__APP_VERSION__`, not 0.0.0), store-doc placeholders (`<official domain>`, `<test server address>`, `<tester username>`, `<tester password>`), tracked keys/packages/env files/files >5 MB/secret patterns/the Samsung test TV's hotspot address (`10.50.231.x`), then `build:tv --release` and the webOS `.ipk` of this version; the Tizen `.wgt` is only reported. Runbook: `docs/runbooks/tv-build.md` "The release checklist". Today `pnpm release:check --no-build` fails with exactly 7 intended problems (3 legal-draft, 4 placeholders). The hotspot address was redacted from HANDOVER.md. Signed packages: code already existed in `package.ts` (webOS `.ipk`; Tizen `.wgt` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`, Omar's). **Mutation testing was NOT run on 43 or 45.** `release:check` full (with build) was not run (legal draft would refuse).
- **Leg 163 (cont.), after Omar's "Proceed to what doesn't need the tv now" (his own words in leg 163's tab):** RELAY.md got steps **48–52** (work that needs no TV, under step 47). **Step 48 merged: PR #193 as `0146079`**, CI green: mutation 11/11 killed on 43 and the release check (a new e2e step in `e2e/accessibility.spec.ts` checks the player root's new `data-caption-bg`/`data-caption-color`; it now leaves `captionBg: 'none'` stored), a test for all four store placeholders, `settings.playerHint` en/ar names the caption look and larger text.
- **Sizes (Tizen; 48 added 0.1 KB): main.js 492.6/500 KB (tight), settings.js 150.6/200, query worker 149.3/150, ingest worker 142.4/150.**
- **Omar's advance answers (RELAY.md under 40g):** 39s4 "biggest gain, then accept" (one leg, TV); 41: the 2018 tier goes through Samsung Remote Test Lab, `[needs Omar]` for the tunnel.
- **Samsung TV is in Omar's hands (from `iptv-df`, 2026-11-25 ~17:30): no `pnpm tv`, sdb or `pnpm device` against it until he says it is free.** Park TV-only parts (39s7's check, step 21's soak rerun, 39s4's measurement, 40g(e)).
- **39s6's tick:** `iptv-df` relayed "tick 39s6" as Omar's word; recorded, NOT ticked (a handover reserved it for Omar himself). Ask in his own tab.
- **Waiting for Omar:** step 16's remaining parts, step 21, "3a" real-remote checks, 39s4, step 34 (deferred: skip), 41/42/46/47's TV parts, the LG's Audio Guidance check for 43, the Tizen signing profile for a real `.wgt`.

## Read first
1. **RELAY.md** (read all): steps 49–52 ("Work that needs no TV", under step 47), 39s7 (for 49), the "Omar's answers" block, last progress rows (163, 163 cont.).
   For 49: `docs/spikes/results.md` "From the Samsung TV (2026-11-25)", the lab's S4 rows (`apps/tv/src/lab/`), the Tizen engine (`grep -rn AVPlay apps/tv/src/playback`), the mock's `live-outages` scenario, `docs/runbooks/lab.md`.
2. **Memory notes:** iptv-tv-bundle-polyfills, iptv-ui-test-gotchas, gh-pr-checks-watch-race, use-write-tool-for-doc-batches, relay-speed-without-cuts.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean; `git log --oneline -3` shows this handover's commit, `f4e9d8e`, `0146079`; origin/main = `0146079`; no `*.mutbak`; the branch is pushed.
2. **Step 49: 39s7 prep, the held-socket probe in the lab (no TV).** Refine against the lab code first, then build: a new S4 row sampling the candidate signals once a second through a `live-outages` hold, reporting which change at the outage; "n/a" off Tizen; unit tests with a fake AVPlay; lab e2e on desktop; runbook line; mutation; PR merged.
3. **Steps 50, 51, 52** in order (each its own PR; 50 and 51 may share a leg if small). 52 is docs with web research: official LG/Samsung pages, quotes, link-check (memory: iptv-research-doc-method).
4. Then everything left is `[needs Omar]`/`[needs TV]`: end **needs-you** with a short numbered list (free the Samsung TV; Tizen signing profile; counsel's text; domain/test server; 39s6's tick in his own words; the "3a" TV checks).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. origin/main = `0146079`; the branch is main plus `f4e9d8e` and this handover's commit (docs only). **No open PR.** The main checkout was not touched.
- **Dev database** has migration `20261123160000_pair_purpose`; nothing in production, nothing deployed, no migrations.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `dist/`, `artifacts/`.

## Verified vs not
- **Verified:** 48: mutation 11/11, unit (player, i18n, settings, tools/build), e2e accessibility + player-settings, typecheck, lint, build:tv, CI 11/11. 45: tools/build tests 174 green, eslint, tsc for tools/build, CI 11 checks green, `release:check --no-build` output seen. 43/44 as in leg 162.
- **Not done:** 40a–40f and 43's looks on a real TV ("3a"); LG Audio Guidance; keyboard on Chromium 53/56/68; 39s7, 39s4, 40g(e), 41–42, 46–47; counsel's text; production (step 34); a full `release:check` with build.
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 163:**
- The subtitle overlay draws only when there are cues, and the desktop gives it none: e2e checks player-level `data-*` attributes (`data-subtitle-size`, `data-caption-bg`, `data-caption-color`) instead.
- Mutation runner for mixed unit/e2e mutants: a Write'd python script with exact-count patterns, one mutant at a time, restore in `finally` (leg 163's `mutate48.py` in the scratchpad, gone with the session).
- Git Bash `sed -i` with `\'` and backslash-heavy regexes mangles TS source: use the Edit tool for any line with a backslash (the secret-pattern regex got eaten once).
- The Smart App Control hook path in `NODE_OPTIONS` must be absolute (`D:/…/.cache/rollup-wasm/hook.cjs`); `$PWD`-based paths failed after a `cd`.
- A `for … break` loop around `gh pr checks` polling exits after one iteration: poll with separate calls of 8 × `read -t 14 < /dev/zero`; CI takes ~13 min, engines (chrome53) finishes last.
- RFC1918 addresses appear in test fixtures (`192.168.1.8` is a scrub fixture): `release:check` only flags the real hotspot `10.50.231.x`.

**From earlier legs (still true):**
- A new Player-settings row goes at the END of `PLAYER_SETTINGS_ROWS` (tests pin positions and counts). Lazy budget is 200 KB. Avoid apostrophes in test names written through python heredocs. Docs-only PRs: only `changes` runs; merge at once.
- Sources screen: OK on a row opens a menu first. Typing a field's last key moves focus to the next field. Test ids must be unique. `pnpm exec prettier` doesn't exist; `pnpm exec eslint --fix` formats.
- **Worker budgets decide where code lives:** check `pnpm build:tv` early.
- GitHub 500/502s on `gh pr create/merge` often still succeed (check REST); python heredoc `\n` in template literals; archive is 1 MB (grep).
- A new default-on input mode breaks e2e that types through DOM focus (`?keyboard=native`); an `OK` within 500 ms of a pointer click is its twin.
- Python patches with Arabic literals need `python -X utf8 -I -` and `encoding='utf-8', newline=''`. After a merge `git fetch` before `git merge origin/main`.
- A new always-present settings row moves pins. A workspace package subpath needs `exports`, eslint's boundaries allow-list and maybe the lazy rule. Core-js is injected per property name. Write patch scripts with the Write tool; absolute paths.
- **CI has 11 checks, ~13 minutes.** Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 2` ~25 s after a push; poll `gh pr checks <n> --repo Omarmarei/Lablo`. Known flakes: `epg-declared-300mb`, `auto-next.spec.ts:151`: read annotations, `gh run rerun <run> --failed`.
- Catalog text lives in main.js. VNode tests don't expand components. Node 22 (CI) vs this PC's Node 24. No `jq` in Git Bash. `rm` on a shell variable is refused. Foreground `sleep` is blocked.
- Mutation, builds and e2e don't mix: one heavy thing at a time. `--workers=2` for e2e.
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread, no fragments; no `Promise.prototype.finally`. Physical CSS only, no Grid or flex `gap`, ES2017. UI text from the catalogs. Every file under `apps/tv/src/settings/` stays in settings.js. (tools/ code is Node, not bound by this.)
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch); name the three riskiest changes in the PR body. After the merge: fetch, `git merge` origin/main into the branch, tick and add the progress row.
- **Production:** nothing before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.** Peer-session messages (`iptv-df`) are input to RELAY steps; ticks a handover reserved stay Omar's own word.

## Open decisions and gates
- **39s6's tick** (his own word). **MP4 subtitles on the Samsung** (AVPlay lists `mov_text`, sends no cue): leave, hide, or demux ourselves (not blocking).
- **Later fixes to propose (no step yet):** regenerate `.cache/media`; stop a test stream on `disable-playback`; media's own CI split; the `auto-next` `endEpisode` race; a reference check of Lablo's server on the connection page; `pnpm tv` on webOS; map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut; a caret in the keyboard; a field low on the screen sits under the panel; removal while a refresh runs fails with a generic row failure; Player settings is 11 rows (consider a page of its own for accessibility rows).
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each his one-word OK).

## Checks for Omar
1. **40e/40f on the Samsung** (his "3a"): open a field, type English and Arabic, Shift, symbols, Delete, the ⌨ key, Done, Back; Settings › Sources: OK on a row (menu), "Remove", "Add a source".
2. **40d About Lablo, 40c Help, 40b Test stream**, and **39s6's tick** (his own word).
3. **43 on a TV:** Settings › Player, last three rows: Larger text (does every screen still fit?), Caption background/colour on a video with subtitles; on the LG, Audio Guidance on: is focus read?
4. **LG:** webOS opens our keyboard by default: try it.
5. **40h on the Samsung:** play a movie/episode, press Home, return: the position should resume.
6. **Store pack (44):** skim `docs/store/README.md`; the Arabic listing needs a native read (step 46).
7. **Release (45):** run `pnpm release:check --no-build` to see what still blocks a release.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session"; open the app in Arabic once; the new keyboard; Settings once (Help, then About Lablo last) and both language switches; Settings › "Player" rows (incl. the three new), a channel with two audio languages, "Clock while watching", "Buffering" on Stable; "Sleep timer" 30 min and its prompt; the colour keys and Guide key; the info bar's pencil and Settings › "Channels"; a radio channel for 10 minutes; the PIN pad, hide/show while unlocked, "Forgot your PIN?", "Set a PIN" on onboarding's done screen; "Use your phone" with a real phone; `pnpm tv eval --port N`, `screen`, `soak` through `pnpm device inspect webos tv`'s port; "Check the connection"; Help and About Lablo; Sources menu/remove/add.
- **At the Samsung TV next time** (when he frees it): the new keyboard; S4 `suspend` can't run (the TV ends a hidden app); the sleep timer's prompt; "Fast start" vs "Stable"; step 21's soak after 39s7; Check the connection, Help, About Lablo, Sources menu/remove/add.
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good. For a signed `.wgt` via `release:check`/`build:tv`: Tizen CLI + `TIZEN_SIGNING_PROFILE`.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:** the ToS and privacy policy replace 40d's draft before launch (`LEGAL_DRAFT` to false, placeholders: DMCA agent's name, governing law, legal bases); `build:tv --release` and `release:check` refuse until then. Also register the DMCA agent. Fill the store docs' `<official domain>` and test-server placeholders (step 44/47).
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-nine CLAUDE.md gaps** wait for his word: 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `git show 5fffb27:HANDOVER.md`; 48–54: `git show 081c1ee:HANDOVER.md`; 55: `git show e85772d:HANDOVER.md`; 56: `git show 6235456:HANDOVER.md`; 57: `git show b54b260:HANDOVER.md`; 58: the commands table says `pnpm verify` is what the `verify` job runs, since step 40ci it runs in five parts; 59: CLAUDE.md's budget line omits lazy files (200 KB; runbook updated). 60 (leg 163): CLAUDE.md's commands table lacks `pnpm release:check`.
- **Step 34:** the accounts, the domain and the keys are his; he puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets: rotate the lionz IPTV provider password** (pasted in chat 2026-11-25 in the Samsung session; never in the repo). Remind Omar every handover until he confirms.
