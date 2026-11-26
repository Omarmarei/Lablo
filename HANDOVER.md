# Lablo IPTV: relay leg 166 opening prompt (written at the end of leg 165)

You are leg 166 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** legs 1–164 did steps 1–33, 35–40h, 40ci, 40g(a–d), 39s1–39s3, 39s5, 39s6, 43–45, 48–50 (PRs up to #194). RELAY.md is about 85 KB; older steps' detail is in `docs/relay-archive.md`: grep it, never read it whole.
- **Leg 165 (2026-11-26): steps 51 and 52 done and merged.**
  - **51, keyboard polish (PR #195, `5c10f35`):** the keyboard lifts the body's child that holds the field (`translateY`) until the field and its note sit 24 px above the panel; `TextEditor.typing` / `FieldEditing.typing` (cleared by the hand-over to the TV keyboard, which now notifies); `TextField` draws the text and a blinking caret while our keyboard types, the input at zero width; a long text keeps its end in sight in the field and on the panel's line. main.js 493.9/500 KB on Tizen.
  - **52, the beta kit (PR #197, `5dc344a`):** `docs/store/beta.md`. Samsung's store Beta Test reaches only 2021+ TVs in the app's service countries (a Public Seller: the US only); LG's Alpha Test needs a commercial contract; so Developer Mode installs for GCC testers and older TVs. The route per store is Omar's at step 46.
- **Omar's answer in leg 165's tab (2026-11-26): "1"**, adding four no-TV fixes as steps 53–56 and going on. They are in RELAY.md under "No-TV fixes, round 2".
- **Session `iptv-b6`** (Omar's tab) still owns the TV steps (39s7, 39s4, 40g(e), step 21's zaps and soak, 42's Samsung part). Its PR #196 ("Samsung TV fixes: held-socket inflow rule, open timer after the probe, start attempts, 5-digit entry (39s7, 40g(e))") is open. Nothing about it is in RELAY.md yet: record it only when iptv-b6 messages results and PR numbers.
- **Sizes (Tizen):** main.js 493.9/500 KB (tight: 6 KB left), settings.js 151.0/200, query worker 149.3/150, ingest worker 142.4/150.

## Read first
1. **RELAY.md:** steps 53–56 (just after 52), the 40g block (iptv-b6's split), the last progress rows (164, 165, 165 cont.).
   - For 53: `test/epg-declared-300mb.media.test.ts` (`LIMIT_MS = { store: 60, first: 20, search: 5 }`, in **ms**; the store is one timed run, the searches are best of 3), `vitest.media.config.ts`, and memory iptv-ci-media-ffmpeg-apt (the flake history) and iptv-throttled-e2e (the calibration loop idea).
   - For 54: `.github/workflows/ci.yml`, the `changes` job's `media=` regex (line ~51: `^packages/[^/]+/src/` makes any package change run media).
2. **Memory notes:** iptv-ci-media-ffmpeg-apt, iptv-bench-measurement, iptv-throttled-e2e, gh-pr-checks-watch-race, bg-watcher-memory-reap, relay-peer-session-decisions; for 55: iptv-player-settings-rows, iptv-ui-test-gotchas; for 56: iptv-tools-test-gotchas.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git log --oneline -4` shows this handover's commit, `d70387f` (steps 53–56), `6d1b928` (tick 52), `5dc344a`.
   - origin/main = `5dc344a`; the branch is pushed; no `*.mutbak`; no open relay PR (#196 is iptv-b6's: leave it).
2. **Step 53, the `epg-declared-300mb` flake:** refine first (what the budgets guard, the runner spread), then make all three budgets stable without making them blind. Done when: 10 local runs in a row under CPU load, a 3× slower seed still fails, the media job passes on the PR without a rerun, PR merged.
3. **Step 54, the media job only for media code**, plus a nightly media run on main. It can share 53's PR (both touch CI) if 53 is small; then the PR's own `changes` output shows the filter working.
4. **Step 55** (accessibility rows on their own page) and **step 56** (`pnpm tv` on webOS, code only) in later legs.
5. **Any message from `iptv-b6`:** record it in RELAY.md (progress row; tick 39s7/39s4/40g/21/42 parts only as its message says they are done and merged). Reply to its `from=` address only on a conflict.
6. **When 53–56 are done**, everything left is Omar's or `iptv-b6`'s: end **needs-you** with a short numbered list (the Tizen signing profile; counsel's text; the domain and the test server; the LG "3a" checks and Audio Guidance; the beta route per store (46); store submissions (47); step 34).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is origin/main (`5dc344a`) plus `6d1b928` (tick 52), `d70387f` (steps 53–56) and this handover's commit, all docs only. The main checkout was not touched.
- **Dev database:** has migration `20261123160000_pair_purpose`. Nothing in production, nothing deployed, no migrations.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `dist/` (built by leg 165), `artifacts/` (incl. `artifacts/mutate51.py`, the screenshots `keyboard-lift-*.png`, `keyboard-caret-*.png`).

## Verified vs not
- **Verified (leg 165):**
  - **51:** unit 5383 (ui + tv app); e2e `keyboard.spec.ts` en-US/ar-SA/en-XA (lift and reset, the caret's place, a long link's end, the clip by hit test, the hand-over) and the 32 tests of the other field specs; mutation 38/38; lint, typecheck, `build:tv`; screenshots checked by eye. CI 11/11 after one `media` rerun.
  - **52:** all 43 quotes matched word for word on LG's and Samsung's pages by curl; 16 links answer 200; the two forum claims (LG Dev Mode 1,000 hours; one account per TV) are real forum posts, marked unconfirmed.
- **Not done:** the TV look of 40a–40f, 43 and 51 (Omar's "3a"); LG Audio Guidance; 39s7's watchdog, 39s4, 40g(e), 41, 42, 46, 47 (iptv-b6 or Omar); counsel's text; production (step 34); a full `release:check` with build.
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 165:**
- **The keyboard while it types:** the input goes to `width: 0; opacity: 0`, never `display: none` (the hand-over focuses it before the next render, and a `display: none` input can't take focus). Any e2e that clicks a field's input during our keyboard's edit would hit a zero-width input.
- **The lift** is a `transform` on the app's root (`#app`) while the keyboard is up: anything `position: fixed` inside moves with it. A future field low over a playing AVPlay picture would move away from the video plane's hole.
- **A long line shows its end** when its box runs opposite to the text (`dir`) and `text-align` places short text: a wide line spills at the box's end edge (CSS Text 3; old Blink too). Overflow clips at the padding edge, so the panel's line uses side borders in its own colour.
- **e2e:** test a CSS clip with `document.elementFromPoint(x, y)?.closest(sel)` past the box edge; read a zero-width element's size with `getBoundingClientRect()` in `evaluate`, not Playwright's `boundingBox()`.
- **The media job** runs for any `packages/*/src` change (step 54 narrows it). `epg-declared-300mb` flaked again on #195; `gh run rerun <run> --failed` once the whole run is done.
- **Research docs:** a curl check of every quote (HTML tags dropped, quotes and spaces normalised) caught nothing wrong this time, but it took one script and 30 seconds: keep doing it. Seller Lounge and Samsung's developer pages are static HTML (curl reads them). The LG forum has JSON at `<thread>.json`.
- **A network drop mid-leg** made curl return empty pages: a "MISSING" on every quote with 0-character pages is the network, not the quotes.

**From earlier legs (still true):**
- **A new lab row or media item is pinned in five places:** `e2e/lab.spec.ts`; `tools/engines/src/lab.ts` and `lab.test.ts`; `spikes/s4.test.ts` and `battery.test.ts`; `e2e/lab-media.spec.ts` (CI's `media` job only).
- A new Player-settings row goes at the END of `PLAYER_SETTINGS_ROWS` (tests pin positions and counts). Lazy budget 200 KB. Docs-only PRs: only `changes` runs; merge at once.
- **Refresh holds nest** (`refresh-hold.ts`): every `busy(true)` needs exactly one `busy(false)`.
- **CI waits:** a background wait loop gets reaped under memory pressure. Wait in the foreground: loops of 8 × (`gh pr checks … | awk`, then `read -t 14 < /dev/zero`), about 2 min per call. Never restart a reaped watcher unasked.
- **Python patches:** write them with the Write tool when they hold backslashes (a heredoc turned `\\(` into `\(`). Arabic needs `python -X utf8 -I` and `encoding='utf-8', newline=''`.
- GitHub 500/502s on `gh pr create/merge` often still succeed: check REST. After a merge, `git fetch` before merging origin/main.
- **Worker budgets decide where code lives:** check `pnpm build:tv` early.
- A new default-on input mode breaks e2e that types through DOM focus (`?keyboard=native`). An `OK` within 500 ms of a pointer click is its twin.
- **CI:** 11 checks, about 13 min; engines can queue. Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 1`. Known flakes: `epg-declared-300mb` (step 53), Chromium 53/56 DevTools start-up.
- Catalog text lives in main.js. VNode tests don't expand components. CI runs Node 22; this PC runs Node 24. No `jq` in Git Bash (use `gh --jq`). `rm` on a shell variable is refused. Foreground `sleep` is blocked.
- Mutation, builds and e2e don't mix: one heavy thing at a time; `--workers=2` for e2e.
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread, no fragments, no `Promise.prototype.finally`;
  - physical CSS only, no Grid or flex `gap`, ES2017;
  - UI text from the catalogs; every file under `apps/tv/src/settings/` stays in settings.js.
  - Lab, tools and test code is not bound by this.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"` and absolute paths. Stage with scoped `git add`, check `git diff --cached --name-only`, and commit with `git commit -F -`, ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch); name the three riskiest changes in the PR body. After the merge: fetch, `git merge --ff-only origin/main` into the branch, tick, add the progress row.
- **Production:** nothing before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.**
- **Peer sessions:** `iptv-b6`'s messages are Omar's decisions relayed; record them in RELAY.md. A tick he typed himself in another of his tabs counts: write its source beside it.
- **No TV for relay legs:** no `pnpm tv`, sdb or `pnpm device` against the Samsung (iptv-b6 holds it).

## Open decisions and gates
- **The beta route per store** (step 46, `docs/store/beta.md`): Samsung's store Beta Test for US testers with 2021+ TVs, Developer Mode for the rest; LG Developer Mode unless LG grants Alpha Test. Omar's.
- **MP4 subtitles on the Samsung** (AVPlay lists `mov_text` and sends no cue): leave, hide, or demux ourselves. Not blocking.
- **Later fixes still without a step:** regenerate `.cache/media`; a reference check of Lablo's server on the connection page; map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut.
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each his one-word OK). The beta needs it first: until `PRODUCTION_API_BASE` is set, every build asks `http://127.0.0.1:3100`.

## Checks for Omar
1. **40e/40f and 51 on a TV** (his "3a"):
   - Open a field and type English and Arabic: Shift, symbols, Delete, the ⌨ key, Done, Back.
   - Step 51: a low field (onboarding's password) moves above the keyboard; the caret blinks after the text; a long link shows its end.
   - Settings › Sources: OK on a row (the menu), "Remove", "Add a source".
2. **40d About Lablo, 40c Help, 40b Test stream** on a TV.
3. **43 on a TV:** Settings › Player, last three rows (larger text fits every screen; caption background and colour on a video with subtitles; on the LG, Audio Guidance reads focus).
4. **LG:** webOS opens our keyboard by default: try it.
5. **Store pack (44) and the beta kit (52):** skim `docs/store/README.md` and `docs/store/beta.md`. The Arabic listing and invitation need a native read (step 46).
6. **Release (45):** `pnpm release:check --no-build` shows what still blocks a release.

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
- **Samsung:** with `iptv-b6` now (39s7, 39s4, 21, 42). Back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good. A signed `.wgt` via `release:check`/`build:tv` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`.
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
