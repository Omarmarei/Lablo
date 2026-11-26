# Lablo IPTV: relay leg 167 opening prompt (written at the end of leg 166)

You are leg 167 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** legs 1–165 did steps 1–33, 35–40h, 40ci, 40g(a–d), 39s1–39s3, 39s5, 39s6, 43–45, 48–52 (PRs up to #197). RELAY.md is about 90 KB; older steps' detail is in `docs/relay-archive.md`: grep it, never read it whole.
- **Leg 166 (2026-11-26): steps 53 and 54 done and merged in PR #199 (`93b6786`), CI 11/11 at the first run (media included, no rerun).**
  - **53, the `epg-declared-300mb` flake:** the test's budgets are now in **calibrations**, not ms. Each figure is the median of 9 runs; each run is divided by a calibration timed just before it, with a forced GC before both. The calibration: the same channels through a test-local character loop, put into a fresh fake IndexedDB. Budgets: store 2.5, first 0.9, each search 0.33. Measured: store 1.06–1.64 (CI and the desktop, idle and loaded); 3.3–4.3 with `LABLO_SLOWDOWN=3`, which fails all three. Method and pitfalls: memory `timing-budgets-calibrated`.
  - **54, the media job only for media code:** `.github/scripts/changes.mjs` (the `changes` job's filter as a tested script) and `test/ci-changes.test.ts` (recorded PRs; every package under `packages/` must be in one of its two lists). Media now runs for core, crypto, data, player, platform-api, platform-browser, protocol, the mock, fixtures/bench, the media tests and `apps/tv/src/(player|lab|data)`. It no longer runs for packages/ui, the rest of apps/tv/src, platform-tizen or platform-webos. A nightly `schedule` (01:17 UTC) runs media alone on main. Runbook: mock-provider.md "Validation".
  - **`iptv-b6`'s results recorded** (Omar's Samsung tab; the TV is back with Omar; it said reply only on a conflict, and there was none):
    - 39s7 ticked: PR #196 as `91ce58f`, the no-data rule on the inflow. Its check on the TV is still open.
    - 39s4 ticked: PR #198 as `e48dfee`, the start's order. First frame at 6.7 s; Omar accepted the gap to 4 s.
    - 40g(e) is done.
    - Step 21: the soak was cut at 2 min; still to do.
    - Step 42: update in place passed on the Samsung.
    - S10 by hand is done; Omar's "3a" look checks passed on the Samsung.
- **Sizes (Tizen, last measured in leg 165, before #196/#198 touched main.tsx and the player):** main.js 493.9/500 KB (tight), settings.js 151.0/200, query worker 149.3/150, ingest worker 142.4/150. Run `pnpm build:tv` early to get today's figures.

## Read first
1. **RELAY.md:** steps 55 and 56 (after 54 under "No-TV fixes, round 2"), and the last progress rows (165, 166, 166 cont.).
   - For 55: `apps/tv/src/settings/player-settings.ts` (11 rows; rows 9–11 are step 43's Caption background, Caption colour, Larger text), `e2e/accessibility.spec.ts`, and the tests that pin row counts and positions.
   - For 56: `tools/tv/src` (sdb, the inspector, `eval`, `screen`, `soak`), `tools/device` (`pnpm device inspect webos tv`), and docs/runbooks/tv-setup.md §3.7.
2. **Memory notes:** iptv-player-settings-rows, iptv-ui-test-gotchas, iptv-store-build-test-copy (all of settings/ is in settings.js), and iptv-css-pipeline-gotchas for 55. For 56: iptv-tools-test-gotchas, iptv-lg-tv-devmode, iptv-webos-acg. Always: gh-pr-checks-watch-race, bg-watcher-memory-reap, relay-peer-session-decisions.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git log --oneline -3` shows this handover's commit, then `db6de93` (tick 53/54), then `93b6786` (merge of #199).
   - origin/main = `93b6786`; the branch is pushed; no open PR.
2. **The first nightly media run** (2026-11-27, 01:17 UTC): `gh run list --repo Omarmarei/Lablo --event schedule --limit 3`.
   - Green: note it in the next progress row.
   - Failed: read its annotations (`gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations`) before anything else.
   - Didn't run: check Actions › CI. A schedule only runs from the default branch's workflow.
3. **Step 55, Player settings' accessibility rows on a page of their own.** Refine against the code first (which tests pin counts and positions; the row that opens the page goes at the END of Player settings). Done when (RELAY): unit and e2e in en and ar, the pins updated, a screenshot checked by eye, mutation, PR merged.
4. **Step 56, `pnpm tv` on webOS (code only; the run on the LG waits for Omar).** Done when (RELAY): unit tests with a fake `ares-inspect` and a fake inspector socket, tv-setup.md updated, mutation, PR merged. The LG run joins Omar's "At the LG TV" list.
5. **Any message from `iptv-b6`** (or another of Omar's tabs): check its claims against main, then record them in RELAY.md (a progress row; ticks only where the message says done and merged; write the source beside each tick). Reply to its `from=` address only on a conflict.
6. **When 55 and 56 are done**, everything left is Omar's or a TV session's: end **needs-you** with a short numbered list:
   - the Tizen signing profile;
   - counsel's text;
   - the domain and the test server;
   - the LG "3a" checks and Audio Guidance;
   - the TV check of 39s7's inflow rule;
   - step 21's 2 h soak on the merged build;
   - step 42's 8 h soaks and the LG's update in place;
   - step 41;
   - the beta route per store (46);
   - store submissions (47);
   - step 34.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is origin/main (`93b6786`) plus `db6de93` (tick 53/54) and this handover's commit, docs only. The main checkout was not touched.
- **Dev database:** has migration `20261123160000_pair_purpose`. Nothing in production, nothing deployed, no migrations.
- **Gitignored but present:**
  - `node_modules`, `apps/web/.env`, `dist/` (built in leg 165; rebuild before trusting it);
  - `.cache/*`: **`.cache/fixtures` regenerated in leg 166** (the old files still said "zoma"); `.cache/media` is still from before the rename (burned-in "Zoma Test 1 SMPTE");
  - `artifacts/`: `probe53.ts`, `probe53b.ts`, `mutate54.py`, and leg 165's files.
- **GitHub:** the scratch branch `scratch/calib53` is deleted. Its workflow ("calib53 (scratch, step 53)") still shows in Actions' workflow list, but it has no file on any branch and can't run. `gh workflow disable` would hide it.

## Verified vs not
- **Verified (leg 166):**
  - **53, locally:** 10 runs in a row under 14 busy cores passed (store 1.09–1.40, first 0.36–0.67, slowest search ≤ 0.20). `LABLO_SLOWDOWN=3` fails all three: store 3.32–3.57, first 1.28–1.29, "by number" 0.34–0.36.
  - **53, on CI:** three scratch probes on 3 runners each, alone, beside the other media tests, and slowed 3×. PR #199's media job passed at the first run (store 1.06, first 0.51, slowest search 0.056).
  - **53, gates:** lint, typecheck.
  - **54:** `test/ci-changes.test.ts` 8/8; hand mutants 8/8 killed; lint, typecheck (root tsconfig checks the `.mjs`); CI 11/11.
  - **`iptv-b6`'s claims:** checked against main (merge commits, results.md 2026-11-26, architecture.md §2 "The start's order").
- **Not yet seen:** the nightly schedule's first run; a real UI-only PR showing media "skipping" (the next one will).
- **Still not done (Omar's or a TV session's):**
  - the TV look of 40a–40f, 43 and 51 on the LG (Omar's "3a" passed on the Samsung);
  - LG Audio Guidance;
  - 39s7's TV check;
  - step 21's zaps and 2 h soak;
  - steps 41, 42 (8 h soaks, network drops, the LG's update in place), 46 and 47;
  - counsel's text;
  - production (step 34);
  - a full `release:check` with build.
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 166:**
- **Timing budgets:** never set ms budgets from this PC's numbers. It has hybrid P/E cores; absolute times swing 2–3× between processes, and CI's runners were about 4× faster on this work. Use calibrations:
  - the same input data in the test's own code, timed just before each run;
  - the median of the per-run ratios;
  - a GC before each (`setFlagsFromString('--expose-gc')` plus `runInNewContext('gc')`);
  - a fastest-of-many calibration against a fastest-of-few run is biased under load.
  - Full method: memory `timing-budgets-calibrated`.
- **CI numbers fast, without touching the PR:**
  - commit a temporary `on: push: branches: [scratch/x]` workflow on top of HEAD with a temporary `GIT_INDEX_FILE` and `git commit-tree`;
  - `git push origin <sha>:refs/heads/scratch/x`;
  - read the job logs; delete the branch. About 6–8 min a round.
- **`epg-declared-300mb` should no longer flake.** If it fails, read the printed line (calibrations and ms) instead of rerunning.
- **The media filter:** a new package under `packages/` fails `test/ci-changes.test.ts` until it is listed as media or nightly. A `.github/` change runs every job.
- **`.github/scripts/*.mjs`:** lint allows no Node globals (import `process` from `node:process`); the root tsconfig type-checks it (`checkJs`), so give it JSDoc types and use no `@ts-expect-error` when importing it.
- **Patches with backslashes:** a Python heredoc again turned `\n` inside a YAML `printf` into real newlines. Edit such lines with the Edit tool (memory use-write-tool-for-doc-batches).
- **Hand mutants from Python on Windows:** capture output with `encoding='utf-8'` or `-X utf8`.
- **A `cd` into another folder in Bash** resets the shell to the main checkout: use absolute worktree paths.

**From earlier legs (still true):**
- **A new lab row or media item is pinned in five places:**
  - `e2e/lab.spec.ts`;
  - `tools/engines/src/lab.ts` and `lab.test.ts`;
  - `spikes/s4.test.ts` and `battery.test.ts`;
  - `e2e/lab-media.spec.ts` (CI's `media` job only).
- **Player settings rows:** a new row goes at the END of `PLAYER_SETTINGS_ROWS` (tests pin positions and counts). The lazy budget is 200 KB. Docs-only PRs run only `changes`: merge at once.
- **Refresh holds nest** (`refresh-hold.ts`): every `busy(true)` needs exactly one `busy(false)`.
- **The keyboard (step 51):**
  - the input goes to `width: 0; opacity: 0` while our keyboard types, never `display: none`;
  - the lift is a `transform` on `#app`, so anything `position: fixed` inside moves with it;
  - in e2e, test a clip with `elementFromPoint`, and read a zero-width element with `getBoundingClientRect()`.
- **CI waits:** a background wait loop gets reaped under memory pressure.
  - Wait in the foreground: loops of 8 × (`gh pr checks … | awk`, then `read -t 14 < /dev/zero`), about 2 min a call.
  - Wait ~20 s after `gh pr create`.
  - Never restart a reaped watcher unasked.
- **Python patches:** write them with the Write tool when they hold backslashes. Arabic needs `python -X utf8 -I` and `encoding='utf-8', newline=''`.
- **GitHub API:** 500/502s on `gh pr create/merge` often still succeed: check REST. After a merge, `git fetch` before merging origin/main.
- **Worker budgets decide where code lives:** check `pnpm build:tv` early.
- **Input modes:** a new default-on input mode breaks e2e that types through DOM focus (`?keyboard=native`). An `OK` within 500 ms of a pointer click is its twin.
- **CI facts:**
  - 11 checks, about 13–23 min (media's installs vary); engines can queue.
  - Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 1`.
  - Known flake: Chromium 53/56 DevTools start-up.
- **Small facts:** catalog text lives in main.js; VNode tests don't expand components; CI runs Node 22 and this PC runs Node 24; no `jq` in Git Bash (use `gh --jq`); `rm` on a shell variable is refused; foreground `sleep` is blocked.
- **Heavy work:** mutation, builds and e2e don't mix. One heavy thing at a time; `--workers=2` for e2e.
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread, no fragments, no `Promise.prototype.finally`;
  - physical CSS only, no Grid or flex `gap`, ES2017;
  - UI text from the catalogs; every file under `apps/tv/src/settings/` stays in settings.js.
  - Lab, tools, CI and test code is not bound by this.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Git:**
  - Never call EnterWorktree. Use `git -C "<wt>"` and absolute paths.
  - Stage with scoped `git add`, check `git diff --cached --name-only`, and commit with `git commit -F -`, ending with the attribution lines the session gives.
  - Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch); name the three riskiest changes in the PR body. After the merge: fetch, `git merge --ff-only origin/main` into the branch, tick, add the progress row.
- **Production:** nothing before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.**
- **Peer sessions:** a message from one of Omar's tabs relays his decisions; record them in RELAY.md. A tick he typed himself counts: write its source beside it.
- **No TV for relay legs** unless Omar hands one over: no `pnpm tv`, sdb, `ares-*` or `pnpm device` against his TVs.

## Open decisions and gates
- **The beta route per store** (step 46, `docs/store/beta.md`): Samsung's store Beta Test for US testers with 2021+ TVs, Developer Mode for the rest; LG Developer Mode unless LG grants Alpha Test. Omar's.
- **MP4 subtitles on the Samsung** (AVPlay lists `mov_text` and sends no cue): leave, hide, or demux ourselves. Not blocking.
- **Later fixes still without a step:**
  - regenerate `.cache/media`;
  - a reference check of Lablo's server on the connection page;
  - map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut;
  - step 21's quirks: back-to-back `live-outages` can outlast the ladder, and the switch rung moves the stream to HLS, where the scenario never stalls.
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each needs his one-word OK). The beta needs it first: until `PRODUCTION_API_BASE` is set, every build asks `http://127.0.0.1:3100`.

## Checks for Omar
1. **On the LG** (his "3a"; the Samsung's passed):
   - 40e/40f and 51: type English and Arabic; a low field moves above the keyboard; the caret blinks; a long link shows its end.
   - Settings › Sources: the row menu, "Remove", "Add a source".
   - 40d About Lablo, 40c Help, 40b Test stream.
   - 43: Settings › Player, the last three rows; Audio Guidance reads focus.
2. **On the Samsung:**
   - 39s7's inflow rule: a held socket shows "Reconnecting…" within about 30 s.
   - Step 21: 50 zaps and the 2 h soak on today's main.
3. **Store pack (44) and the beta kit (52):** skim `docs/store/README.md` and `docs/store/beta.md`. The Arabic listing and invitation need a native read (step 46).
4. **Release (45):** `pnpm release:check --no-build` shows what still blocks a release.
5. **The nightly media run:** GitHub mails a failed one to whoever last changed the schedule (the relay's commits are under Omar's account).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Secrets: rotate the lionz IPTV provider password** (pasted in chat 2026-11-25 in the Samsung session; never in the repo).
- **At the LG TV next time:**
  - Remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`) and read Dev Mode's "Remain Session".
  - Open the app in Arabic once; try the keyboard (with step 51's lift and caret); open Settings once (Help, then About Lablo last) and both language switches.
  - Settings › "Player" rows (incl. the three new): a channel with two audio languages, "Clock while watching", "Buffering" on Stable, "Sleep timer" 30 min and its prompt.
  - The colour keys and the Guide key; the info bar's pencil and Settings › "Channels"; a radio channel for 10 minutes.
  - The PIN pad: hide/show while unlocked, "Forgot your PIN?", "Set a PIN" on onboarding's done screen.
  - "Use your phone" with a real phone.
  - `pnpm tv eval --port N`, `screen` and `soak` through `pnpm device inspect webos tv`'s port (step 56 builds this).
  - "Check the connection", Help, About Lablo, Sources menu/remove/add.
- **Samsung:**
  - The TV is back with Omar (session `iptv-b6` finished its run).
  - Back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
  - A signed `.wgt` via `release:check`/`build:tv` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf). Without it, a store beta and launch on Samsung reach the US only (`docs/store/beta.md`).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:**
  - The ToS and privacy policy replace 40d's draft before launch: `LEGAL_DRAFT` to false, and fill the placeholders (DMCA agent's name, governing law, legal bases). `build:tv --release` and `release:check` refuse until then.
  - Register the DMCA agent.
  - Fill the store docs' `<official domain>` and test-server placeholders (step 44/47).
- **Settings:** `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Sixty CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `git show 5fffb27:HANDOVER.md`; 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`; 56: `git show 6235456:HANDOVER.md`; 57: `git show b54b260:HANDOVER.md`;
  - 58: the commands table says `pnpm verify` is what the `verify` job runs; since step 40ci it runs in five parts;
  - 59: CLAUDE.md's budget line omits lazy files (200 KB; runbook updated);
  - 60: the commands table lacks `pnpm release:check`.
- **Step 34:** the accounts, the domain and the keys are his; he puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
