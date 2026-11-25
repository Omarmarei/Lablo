# Lablo IPTV: relay leg 165 opening prompt (written at the end of leg 164)

You are leg 165 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** legs 1–163 did steps 1–33, 35–40h, 40ci, 40g(a–d), 39s1–39s3, 39s5, 39s6's code, 43, 44, 45, 48 (PRs #175–#193). RELAY.md is about 80 KB; the detail of older steps is in `docs/relay-archive.md`: grep it, never read it whole.
- **Leg 164 (2026-11-25/26): steps 49 and 50 done, both in PR #194, merged as `dd19cba`.** CI green after reruns of the `media` job.
  - **49:** S4 has a new `held-socket` row (`apps/tv/src/lab/held-socket.ts`) on the mock's new `/__lab/media` item `outage-ts` (`stall:after_ms=30000:outage_ms=30000`, `LAB_OUTAGE`). It samples AVPlay's candidate signals once a second and reports which change at the outage. The lab's AVPlay player has `signals()` and raw `signal` events. Lab check rows are 56 px. Docs: `docs/runbooks/lab.md` (reading the row, "Step 39s7's TV run"), mock-provider.md.
  - **50:** (a) the auto-next e2e race was fixed in `endEpisode`, which now waits for the episode's `src`. (b) The refresh holds now nest (`apps/tv/src/data/refresh-hold.ts`, wired in main). (c) Settings › Check the connection › Test stream stops when the config turns playback off; the bar then says "Playback is turned off".
- **Omar's split, via session `iptv-b6` (his tab, 2026-11-26 ~00:35), recorded in RELAY.md under 40g:**
  - "Tick 39s6": ticked, with its source written beside it.
  - `iptv-b6` holds the Samsung today and overnight (step 42's 8 h soak).
  - `iptv-b6` owns the TV steps: 39s7's TV run plus the watchdog code, 39s4, 40g(e), step 21's zaps and soak, and step 42's Samsung part. It works in its own worktree under D:/tmp with its own PRs, and messages results and PR numbers for you to record in RELAY.md (progress rows and ticks).
  - **Relay legs:** skip those steps, keep to 51–52, and run no `pnpm tv`, sdb or `pnpm device` against the Samsung.
- **Sizes (Tizen):** main.js 492.8/500 KB (tight), settings.js 151.0/200, query worker 149.3/150, ingest worker 142.4/150.

## Read first
1. **RELAY.md:** steps 51 and 52 (under "Work that needs no TV"), the 40g block (iptv-b6's split and the 39s6 tick), and the last progress rows (163 cont., 164).
   - For 51: `apps/tv/src/ui/screen-keyboard.ts` or wherever `screen-keyboard` lives (`grep -rn "screen-keyboard" apps/tv/src`), step 40e's archive entry (`grep -n "Step 40e" docs/relay-archive.md`), `e2e/keyboard.spec.ts`.
   - For 52: `docs/store/README.md`, step 33b's telemetry (`grep -n "33b" docs/relay-archive.md`).
2. **Memory notes:** iptv-own-keyboard-gotchas, iptv-ui-test-gotchas, iptv-css-pipeline-gotchas, iptv-tv-bundle-polyfills, iptv-research-doc-method (for 52), gh-pr-checks-watch-race, bg-watcher-memory-reap, relay-peer-session-decisions.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git log --oneline -3` shows this handover's commit, `82e8fd0`, `dd19cba`.
   - origin/main = `dd19cba`; the branch is pushed; no `*.mutbak`; no open PR.
2. **Step 51, keyboard polish (no TV):**
   - (a) A text field low on the screen sits under our keyboard panel: scroll it above the panel.
   - (b) A caret in the field while our keyboard types (main-safe CSS, physical only, no flex `gap`).
   - Refine against the code first. Then unit tests, e2e in en and ar, a screenshot checked by eye, mutation, and a PR merged on green CI.
   - main.js is at 492.8/500: run `pnpm build:tv` early, and keep new code in settings.js or small.
3. **Step 52, the beta kit (docs only):**
   - `docs/store/beta.md`, linked from `docs/store/README.md`.
   - Content: LG Seller Lounge and Samsung Seller Office beta testing from official pages, with quotes and a link-check (memory: iptv-research-doc-method); the invitation in en and ar; the feedback questions; what Lablo collects during a beta (step 33b); a checklist for Omar.
   - A docs-only PR: only `changes` runs, so merge at once.
4. **Any message from `iptv-b6`** (results, PR numbers): record it in RELAY.md (progress row; tick 39s7/39s4/40g/21/42 parts only as its message says they are done and merged). Reply to its `from=` address only on a conflict.
5. **Then everything left is Omar's or `iptv-b6`'s.** End **needs-you** with a short numbered list:
   - the Tizen signing profile for a real `.wgt`;
   - counsel's text (ToS, privacy, DMCA);
   - the domain and the public test server (step 44/47 placeholders);
   - the LG "3a" checks and the LG's Audio Guidance (43);
   - the beta (46) and the store submissions (47).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is origin/main (`dd19cba`) plus `82e8fd0` (RELAY ticks) and this handover's commit, both docs only. **No open PR.** The main checkout was not touched.
- **Dev database:** has migration `20261123160000_pair_purpose`. Nothing in production, nothing deployed, no migrations.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `dist/` (built by this leg), `artifacts/`.

## Verified vs not
- **Verified:**
  - **49:** unit 1050 (lab, mock, platform-tizen, tools/engines); `e2e/lab.spec.ts` 8/8, including a new test that runs the row in the Tizen lab bundle with a scripted `webapis.avplay`; mutation 33/33; lint, typecheck, `build:tv`; S4's twelve rows screenshotted and checked by eye.
  - **50:** unit 769 (settings, data); e2e auto-next 4/4 (en, ar, twice) and connection-check 6/6 (a new en step); mutation 12/12; the "Playback is turned off" screenshot checked by eye.
  - CI 11/11 on PR #194.
- **Not done:** `held-socket` on a real Samsung (iptv-b6's 39s7 run); the TV look of 40a–40f and 43 ("3a"); LG Audio Guidance; 39s7's watchdog, 39s4, 40g(e), 41, 42, 46, 47 (iptv-b6 or Omar); counsel's text; production (step 34); a full `release:check` with build.
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 164:**
- **A new lab row or media item is pinned in five places:**
  - `e2e/lab.spec.ts` (`DESKTOP` and the run's `counts`);
  - `tools/engines/src/lab.ts` (expected statuses) and `lab.test.ts` (check count, `skip N`, records);
  - `spikes/s4.test.ts` and `battery.test.ts` ("N media items");
  - `e2e/lab-media.spec.ts`, which runs only in CI's `media` job and now reads `LAB_MEDIA_IDS.length`.
- **The lab's check rows are 56 px:** S4's twelve rows fit with 18 px to spare; a thirteenth needs a layout change.
- **auto-next race:** an `ended` fired before `engine.load` is lost. The controller closes the last stream and asks the blocklist (a worker round trip) while `data-movie` already names the new item. Wait for `#stage video`'s `src`. To hit such a window on purpose, use a `MutationObserver` in the page.
- **Refresh holds now nest** (`refresh-hold.ts`): every hold (`busy(true)`) needs exactly one `busy(false)`, or the scheduled refreshes stay off for the run.
- **Media job:**
  - `epg-declared-300mb` flaked twice (70 s and 89 s against 60 s); `gh run rerun <run> --failed` once the whole run is done.
  - When `verify:media` fails at that test, lab-media never runs (the chain stops), so only the rerun shows it.
- **CI waits:** a background CI wait loop was reaped under memory pressure. Wait in the foreground instead: loops of 8 × (`gh pr checks … | awk`, then `read -t 14 < /dev/zero`), about 2 min per call. Never restart a reaped watcher unasked.
- **Python patches in a heredoc:** `\(` gives a SyntaxWarning but is kept as written. Write any patch with backslashes through the Write tool.

**From earlier legs (still true):**
- A new Player-settings row goes at the END of `PLAYER_SETTINGS_ROWS` (tests pin positions and counts). Lazy budget 200 KB. Docs-only PRs: only `changes` runs; merge at once.
- Sources screen: OK on a row opens a menu first. Typing a field's last key moves focus to the next field. Test ids must be unique. `pnpm exec eslint --fix` formats (there is no `pnpm exec prettier`).
- **Worker budgets decide where code lives:** check `pnpm build:tv` early.
- GitHub 500/502s on `gh pr create/merge` often still succeed: check REST. The archive is 1 MB: grep it.
- A new default-on input mode breaks e2e that types through DOM focus (`?keyboard=native`). An `OK` within 500 ms of a pointer click is its twin.
- Python patches with Arabic literals need `python -X utf8 -I -` and `encoding='utf-8', newline=''`. After a merge, `git fetch` before `git merge origin/main`.
- A new always-present settings row moves pins. A workspace package subpath needs `exports`, eslint's boundaries allow-list and maybe the lazy rule. Core-js is injected per property name.
- **CI:** 11 checks, about 13 min; engines can queue. Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 1`. Known flakes: `epg-declared-300mb`, `auto-next` (fixed in 50a), Chromium 53/56 DevTools start-up.
- Catalog text lives in main.js. VNode tests don't expand components. CI runs Node 22; this PC runs Node 24. No `jq` in Git Bash (use `gh --jq`). `rm` on a shell variable is refused. Foreground `sleep` is blocked.
- Mutation, builds and e2e don't mix: one heavy thing at a time; `--workers=2` for e2e.
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread, no fragments, no `Promise.prototype.finally`;
  - physical CSS only, no Grid or flex `gap`, ES2017;
  - UI text from the catalogs; every file under `apps/tv/src/settings/` stays in settings.js.
  - Lab and tools code is not bound by this.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"` and absolute paths. Stage with scoped `git add`, check `git diff --cached --name-only`, and commit with `git commit -F -`, ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch); name the three riskiest changes in the PR body. After the merge: fetch, `git merge origin/main` into the branch, tick, add the progress row.
- **Production:** nothing before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.**
- **Peer sessions:** `iptv-b6`'s messages are Omar's decisions relayed; record them in RELAY.md. A tick he typed himself in another of his tabs counts: write its source beside it.

## Open decisions and gates
- **MP4 subtitles on the Samsung** (AVPlay lists `mov_text` and sends no cue): leave, hide, or demux ourselves. Not blocking.
- **Later fixes to propose (no step yet):**
  - regenerate `.cache/media`; media's own CI split;
  - a reference check of Lablo's server on the connection page; `pnpm tv` on webOS;
  - map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut;
  - Player settings is 11 rows: consider a page of its own for the accessibility rows;
  - `epg-declared-300mb`'s 60 s budget flakes on CI runners.
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each his one-word OK).

## Checks for Omar
1. **40e/40f on a TV** (his "3a"):
   - Open a field and type English and Arabic: Shift, symbols, Delete, the ⌨ key, Done, Back.
   - Settings › Sources: OK on a row (the menu), "Remove", "Add a source".
2. **40d About Lablo, 40c Help, 40b Test stream** on a TV.
3. **43 on a TV:** Settings › Player, last three rows.
   - Larger text: does every screen still fit?
   - Caption background and colour, on a video with subtitles.
   - On the LG, with Audio Guidance on: is focus read?
4. **LG:** webOS opens our keyboard by default: try it.
5. **Store pack (44):** skim `docs/store/README.md`. The Arabic listing needs a native read (step 46).
6. **Release (45):** run `pnpm release:check --no-build` to see what still blocks a release.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - Remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`) and read Dev Mode's "Remain Session".
  - Open the app in Arabic once; try the new keyboard; open Settings once (Help, then About Lablo last) and both language switches.
  - Settings › "Player" rows (incl. the three new): a channel with two audio languages, "Clock while watching", "Buffering" on Stable, "Sleep timer" 30 min and its prompt.
  - The colour keys and the Guide key; the info bar's pencil and Settings › "Channels"; a radio channel for 10 minutes.
  - The PIN pad: hide/show while unlocked, "Forgot your PIN?", "Set a PIN" on onboarding's done screen.
  - "Use your phone" with a real phone.
  - `pnpm tv eval --port N`, `screen` and `soak` through `pnpm device inspect webos tv`'s port.
  - "Check the connection", Help, About Lablo, Sources menu/remove/add.
- **Samsung:** with `iptv-b6` now (39s7, 39s4, 21, 42). Back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good. A signed `.wgt` via `release:check`/`build:tv` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
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
- **Secrets: rotate the lionz IPTV provider password** (pasted in chat 2026-11-25 in the Samsung session; never in the repo). Remind Omar every handover until he confirms.
