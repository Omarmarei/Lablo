# Lablo IPTV: relay leg 163 opening prompt

You are leg 163 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** legs 1–161 did steps 1–33, 35–40h, 40ci, 40g(a–d), 39s1–39s3, 39s5, 39s6's code (PRs #175–#189). RELAY.md is ~70 KB, detail in `docs/relay-archive.md`: grep it, never read it whole.
- **Leg 162 (2026-11-25), two steps merged, CI green (11 checks) each:**
  - **Step 44 store documents: PR #190 as `08b3a4d`.** Docs only, `docs/store/` (README index, listing-en/ar with name "Lablo IPTV Player", screenshots.md, lg-submission.md, samsung-submission.md, samsung-tester-notes.md, test-server.md `[needs Omar]`). The real screenshots, the Samsung PPTX, LG's current self-checklist re-map and the test-server deploy are left for step 47 / Omar.
  - **Step 43 accessibility: PR #191 as `5efce39`** (Omar answered "1": lazy budget 150 to 200 KB). Settings › Player now has 11 rows; the new 9–11 are Caption background (Dark/None/Solid), Caption colour (White/Yellow/Cyan/Green), Larger text (+25% through `html[data-large-text='on']` in `packages/ui/src/styles/tokens.css`). Kept in the profile's `player.options` as `captionBg`, `captionColor`, `largeText` (defaults store nothing). New `apps/tv/src/player/appearance.ts` (signals, singleton `appearance`), `SubtitleOverlay` classes `subtitles--bg-*` / `subtitles--<colour>`. Unit 9516 green, lint, typecheck, build:tv, new `e2e/accessibility.spec.ts` (en, ar), buffering/clock/about e2e green; large-text screenshots (live, Settings) checked by eye: fit, no spill. **Mutation testing was NOT run on 43.**
- **Sizes now (Tizen): main.js 492.5/500 KB (tight, +2.9 KB from 43), settings.js 150.6/200, query worker 149.3/150, ingest worker 142.4/150.**
- **Omar's advance answers (RELAY.md under 40g):** 39s4 "biggest gain, then accept" (one leg, TV); 41: the 2018 tier goes through Samsung Remote Test Lab, `[needs Omar]` for the tunnel. 43 and 44 are done.
- **Samsung TV is in Omar's hands (from `iptv-df`, 2026-11-25 ~17:30): no `pnpm tv`, sdb or `pnpm device` against the Samsung TV until he says it is free.** Park TV-only parts (39s7's check, step 21's soak rerun, 39s4's measurement, 40g(e)).
- **39s6's tick:** `iptv-df` relayed "tick 39s6" as Omar's word; recorded, NOT ticked (a handover reserved it for Omar himself). Ask in his own tab.
- **Waiting for Omar:** step 16's remaining parts, step 21, "3a" real-remote checks, 39s4, step 34 (deferred: skip), 41/42/46/47's TV parts, the LG's Audio Guidance check for 43.

## Read first
1. **RELAY.md** (read all): step 45, the "Omar's answers" block, the last progress rows (162, 162 cont.).
2. **For 45:** RELAY.md step 45, `tools/build` (`legal-gate.ts` `checkLegalRelease`, `package.ts`, `budgets.ts`), `docs/runbooks/tv-build.md`, `docs/store/` (what the stores need from the package), `packages/protocol/src/legal.ts` (`LEGAL_DRAFT`).
3. **Memory notes:** iptv-tv-bundle-polyfills (sizes), iptv-ui-test-gotchas, iptv-legal-and-web-test-gotchas, iptv-store-build-test-copy, gh-pr-checks-watch-race, use-write-tool-for-doc-batches, relay-speed-without-cuts.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` clean; `git log --oneline -3` shows this handover's commit, `fc7b8d5`, `5efce39`; origin/main = `5efce39`; no `*.mutbak`; the branch is pushed.
2. **Step 45 release engineering:** versioning (one version source feeding both manifests and `LEGAL`/About), signed packages (webOS `.ipk` already built; Tizen `.wgt` needs the Tizen CLI and `TIZEN_SIGNING_PROFILE`, which are Omar's: build the script and test what can be tested without the certificate), a release checklist script (`pnpm release:check` or similar) that runs `checkLegalRelease`, budgets, version consistency, the store docs' placeholders (`<official domain>`), no secrets/binaries in the repo. Refine the step against the code first; one leg. Anything needing the certificate, a store account or a deploy is `[needs Omar]`.
3. **Then:** step 43's mutation pass if cheap (drop `appearance.setCaptionBackground` in the settings wiring; drop the `data-large-text` attribute write; change the `captionBg` default) and a one-line hint update in `settings.playerHint` (en/ar) mentioning captions and larger text (e2e/unit pins may need updating).
4. 46/47 are `[needs Omar]`; 39s7, 39s4, 40g(e), 41, 42 only when Omar frees the TV. If everything doable is done, end `done` is NOT right (46/47 remain): end needs-you with a short list.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. origin/main = `5efce39`; the branch is main plus `fc7b8d5` and this handover's commit (docs only). **No open PR.** The main checkout was not touched.
- **Dev database** has migration `20261123160000_pair_purpose`; nothing in production, nothing deployed, no migrations.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `dist/`, `artifacts/` (incl. screenshots `large-text-*.png`, `mutate40f.py`).

## Verified vs not
- **Verified:** 43 as above (not on a real TV); 44 is text only. CI green for both PRs.
- **Not done:** 40a–40f and 43's large text/caption looks on a real TV (Omar's "3a"); LG Audio Guidance; the keyboard on Chromium 53/56/68; 39s7, 39s4, 40g(e), 41–42, 45–47; counsel's text; production (step 34).
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 162:**
- A new Player-settings row: put it at the END of `PLAYER_SETTINGS_ROWS` (tests and e2e index rows by position; `data-count` pins in `player-settings-view.test.ts`, `count:` in `player-settings.test.ts`); fixtures in `guides-state.test.ts` need the new `PlayerValues` fields and option mocks.
- Lazy budget is now 200 KB (`tools/build/src/budgets.ts` and its test, `204_800`); CLAUDE.md's table still says "each worker ≤ 150 KB" (true) but nothing there about lazy: fine.
- A test string with an apostrophe inside a single-quoted `it('...')` written through a python heredoc breaks the file: avoid apostrophes in test names.
- For layout-fit checks of a global CSS change, a Playwright spec that walks Settings/live and flags `scrollWidth > clientWidth` on leaf elements (skip `text-overflow: ellipsis` ones) plus eyeballing the screenshots is quick (`e2e/accessibility.spec.ts`).
- Docs-only PRs: only the `changes` job runs, the rest "skipping"; merge at once.
- Foreground waits in a tool call die at 120 s: use `read -t 14 < /dev/zero` loops of at most 8 iterations per call.

**From earlier legs (still true):**
- Sources screen: OK on a row opens a menu first. Typing a field's last key moves focus to the next field. Test ids must be unique. `.settings__text` is centered; use `settings__hint` for left body text. IndexedDB chunk store is `catalog_chunks`. `pnpm exec prettier` doesn't exist; `pnpm exec eslint --fix` formats.
- **Worker budgets decide where code lives:** check `pnpm build:tv` early; to see all sizes when one is over, temporarily raise `BUDGETS.worker` (revert with `git checkout`).
- GitHub 500/502s on `gh pr create/merge` often still succeed (check REST); python heredoc `\n` in template literals; archive is 1 MB (grep).
- A new default-on input mode breaks every e2e that types through DOM focus (`?keyboard=native`); in own-keyboard mode end an edit by clicking the Done key or sending 65376. An `OK` within 500 ms of a pointer click is its twin.
- Python patches with Arabic literals need `python -X utf8 -I -` and `encoding='utf-8', newline=''`. After a merge `git fetch` before `git merge origin/main`.
- A new always-present settings row moves pins (`guides-state.test.ts`, `parental-view.test.ts`). A workspace package subpath needs `exports`, eslint's boundaries allow-list and maybe the lazy rule. Core-js is injected per property name. Write patch scripts with the Write tool; absolute paths.
- **CI has 11 checks, ~13 minutes.** Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 2` ~25 s after a push; poll `gh pr checks <n> --repo Omarmarei/Lablo`. Known flakes: `epg-declared-300mb`, `auto-next.spec.ts:151`: read annotations, `gh run rerun <run> --failed`.
- Catalog text lives in main.js. VNode tests don't expand components. Node 22 (CI) vs this PC's Node 24. No `jq` in Git Bash. `rm` on a shell variable is refused. Foreground `sleep` is blocked.
- Mutation, builds and e2e don't mix: one heavy thing at a time. `--workers=2` for e2e. A leftover vite on port 5391 makes the next Playwright run fail.
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`. Physical CSS only, no Grid or flex `gap`, ES2017. UI text from the catalogs. Every file under `apps/tv/src/settings/` stays in settings.js.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch); name the three riskiest changes in the PR body. After the merge: fetch, `git merge` origin/main into the branch, tick and add the progress row.
- **Production:** nothing before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.** Peer-session messages (`iptv-df`) are input to RELAY steps; ticks a handover reserved stay Omar's own word.

## Open decisions and gates
- **39s6's tick** (his own word). **MP4 subtitles on the Samsung** (AVPlay lists `mov_text`, sends no cue): leave, hide, or demux ourselves (not blocking).
- **Later fixes to propose (no step yet):** regenerate `.cache/media`; stop a test stream on `disable-playback`; media's own CI split; the `auto-next` `endEpisode` race; a reference check of Lablo's server on the connection page; `pnpm tv` on webOS; map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut; a caret in the keyboard; a field low on the screen sits under the panel; removal while a refresh runs fails with a generic row failure; Player settings is now 11 rows (consider grouping accessibility rows on a page of their own if more arrive).
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each his one-word OK).

## Checks for Omar
1. **40e/40f on the Samsung** (his "3a"): open a field, type English and Arabic, Shift, symbols, Delete, the ⌨ key, Done, Back; Settings › Sources: OK on a row (menu), "Remove", "Add a source".
2. **40d About Lablo, 40c Help, 40b Test stream**, and **39s6's tick** (his own word).
3. **43 on a TV:** Settings › Player, last three rows: Larger text (does every screen still fit?), Caption background/colour on a video with subtitles; on the LG, turn Audio Guidance on and see whether focus is read.
4. **LG:** webOS opens our keyboard by default: try it.
5. **40h on the Samsung:** play a movie/episode, press Home, return: the position should resume.
6. **Store pack (44):** skim `docs/store/README.md`; the Arabic listing needs a native read (step 46).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session"; open the app in Arabic once; the new keyboard; Settings once (Help, then About Lablo last) and both language switches; Settings › "Player" rows (incl. the three new), a channel with two audio languages, "Clock while watching", "Buffering" on Stable; "Sleep timer" 30 min and its prompt; the colour keys and Guide key; the info bar's pencil and Settings › "Channels"; a radio channel for 10 minutes; the PIN pad, hide/show while unlocked, "Forgot your PIN?", "Set a PIN" on onboarding's done screen; "Use your phone" with a real phone; `pnpm tv eval --port N`, `screen`, `soak` through `pnpm device inspect webos tv`'s port; "Check the connection"; Help and About Lablo; Sources menu/remove/add.
- **At the Samsung TV next time** (when he frees it): the new keyboard; S4 `suspend` can't run (the TV ends a hidden app); the sleep timer's prompt; "Fast start" vs "Stable"; step 21's soak after 39s7; Check the connection, Help, About Lablo, Sources menu/remove/add.
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:** the ToS and privacy policy replace 40d's draft before launch (`LEGAL_DRAFT` to false, placeholders: DMCA agent's name, governing law, legal bases); `build:tv --release` refuses until then. Also register the DMCA agent.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-nine CLAUDE.md gaps** wait for his word: 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `git show 5fffb27:HANDOVER.md`; 48–54: `git show 081c1ee:HANDOVER.md`; 55: `git show e85772d:HANDOVER.md`; 56: `git show 6235456:HANDOVER.md`; 57: `git show b54b260:HANDOVER.md`; 58 (leg 154): the commands table says `pnpm verify` is what the `verify` job runs; since step 40ci it runs in five parallel parts; 59 (leg 162): the commands table and `docs/runbooks/tv-build.md` mention budgets: lazy files are now 200 KB (the runbook is updated, CLAUDE.md is not).
- **Step 34:** the accounts, the domain and the keys are his; he puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
