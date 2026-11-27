# Lablo IPTV: relay leg 170 opening prompt (written at the end of leg 169)

You are leg 170 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** 1–168 did steps 1–33, 35–40h, 40ci, 40g(a–e), 39s1–39s7, 43–45 and 48–57 (PRs up to #202, main at `2cb74f2`). RELAY.md is about 100 KB; older steps' detail is in `docs/relay-archive.md` (grep it, never read it whole).
- **Leg 169 (2026-11-27): step 58's code is built, tested and pushed, NOT merged and NOT ticked.** The context check ended the leg before the LG check and CI. Five commits on the relay branch:
  - `7dafdc0` **(a) text fit.** `e2e/text-fit.ts` is an in-page check: a text line (or a `.z-button`) outside the box it belongs to, the app's own words cut short (provider text, `translate="no"`, may be cut), a colour key's dot over its button's words. `e2e/text-fit.spec.ts` walks every screen in en/ar at both text sizes; `e2e/text-fit-detector.spec.ts` pins the check on a page made for it. The fix: with Larger text a vertical list shows about a quarter fewer, taller rows in the same box (`LARGE_TEXT_ROWS` 1.25, `setRowScale`, `shownRows`, `shownRowSize` in `packages/ui/src/design/tokens.ts`; read by `zones.ts` `visibleRows` and `VirtualList`; `createAppearance().setLargeText` sets it). Settings pages draw through `settingsWindow()` (settings-window.ts) and `--settings-row`. Hints: one line + ellipsis, two with Larger text. Shorter en texts: `settings.playerHint`, `backup.intro`. Also fitted: the groups line, Check the connection's lines, Home's shelf titles, the guide's details line, the player's buttons (Larger text).
  - `d1a7466` **(b)** Shift, Delete and the TV-keyboard key draw SVG icons (`KEY_ICONS` in the import-free `keyboard-layouts.ts`, `keyFace()` in screen-keyboard.ts). `test/keyboard-glyphs.test.ts` checks every character any key shows against the bundled fonts' cmaps.
  - `a461d02` **(c)** the colour key's dot in the corner (`top: 4px; right: 6px`, Button.css).
  - `f6b405a` **(d)** `tools/tv/tv.ts` ends the process when the command is done (`src/exit.ts` `endProcess`). New `pnpm tv keys --webos <key|ms>...` and `pnpm tv shot --webos <file.png>` (`runOnPort` in cdp.ts, `webosKeySteps`/`SCREENSHOT` in webos.ts). `cli.test.ts` runs `pnpm tv` as a process against an inspector that never answers a close. Runbook tv-setup.md 3.7 item 6.
  - `015c4fd` the detector skips a name pushed out of sight (the guide's catch-up mark), plus more fixture cases.
  - `17a2f84` RELAY row 169; then this handover's commit.
- **Sizes: not measured this leg.** main.js was 495.5/500 KB (Tizen) before; leg 169 added code to main (the row scale in tokens/zones/VirtualList, the keyboard icons). **Measure with `pnpm build:tv` first.**

## Read first
1. RELAY.md: step 58 (in "No-TV fixes, round 2") and progress row 169.
2. Memory: **iptv-text-fit-check** (new), iptv-lg-tv-devmode (the leg-168/169 sections), iptv-repo-public-lablo, iptv-tools-test-gotchas (the leg-169 note), iptv-tv-bundle-polyfills (budgets), gh-pr-checks-watch-race, bg-watcher-memory-reap.
3. `git -C "<wt>" log --oneline -8` and `git show --stat 7dafdc0` for what (a) touched.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` is clean; `git log --oneline -8` shows this handover's commit, `17a2f84`, `015c4fd`, `f6b405a`, `a461d02`, `d1a7466`, `7dafdc0`, `af3bfa5`. origin/main is `2cb74f2`; no open PR; `gh repo view Omarmarei/Lablo --json visibility` says PRIVATE.
2. **Local gates before CI** (one heavy thing at a time):
   1. `pnpm lint` and `pnpm typecheck` (root tsc covers e2e/ and test/).
   2. `pnpm build:tv` (both platforms): the budgets (main 500, settings.js 200 lazy, workers 150). If main.js went over, look at what step 58 added to main first.
   3. `pnpm test` (whole Vitest run). Leg 169 ran ui, apps/tv, tools/tv and test/keyboard-glyphs only.
   4. The e2e specs most likely touched by the row scale, CSS and keyboard: `accessibility`, `player-settings`, `settings-loading`, `groups`, `channel-edit-screens`, `parental-settings`, `search`, `live`, `guide`, `home`, `connection-check`, `keyboard`, `sources-manage`, `backup-settings`, `colour-keys`, `text-fit*` (`--workers=2`). Leg 169 ran only `text-fit*` and `keyboard`.
3. **Check on the LG** (no Omar needed; he left the TV on, in Lablo):
   1. Check this PC's Wi-Fi address (it was 192.168.1.7) and that the TV answers (`tools/tv/node_modules/.bin/ares-device.CMD --system-info --device tv`).
   2. `pnpm build:tv --platform webos --target app`, then `pnpm device install webos tv` (updates in place, keeps the data).
   3. `pnpm tv inspect --webos tv` in the background; `pnpm mock` in the background (the source points at `http://192.168.1.7:8080`).
   4. Drive it with the new commands: `pnpm tv keys --webos DOWN OK ...` (prints the focus path and the text) and `pnpm tv shot --webos artifacts/lg-58-XX.png`. One short sequence at a time.
   5. Check, en and ar, normal and Larger text: Settings (top and bottom), Player and Accessibility, search with results, the keyboard (the three icon keys), the live header's Guide dot. Each `pnpm tv` command must end by itself (that is fix (d)).
   6. Put the TV back to English with Larger text off; end the mock and ares-inspect by their node pids (they outlive TaskStop).
4. **CI:** scan the commits after `2cb74f2` for secrets or personal data; `gh repo edit Omarmarei/Lablo --visibility public --accept-visibility-change-consequences`; push, open the PR (three riskiest changes in the body: the row scale in zones/VirtualList changes every vertical list with Larger text; `.z-vlist--vertical > .z-vlist__item > * { height: 100% }`; `pnpm tv` now calls `process.exit`), wait, merge on green (merge commit, branch kept), **then `--visibility private` at once** and say so.
5. **Then:** fetch, `git merge --ff-only origin/main`, tick 58 in RELAY.md, add a progress row, commit, push.
6. **Then everything left needs Omar or a TV:** end **needs-you** with a short numbered list: the Samsung checks (39s7's "Reconnecting…", step 21's 50 zaps and 2 h soak); Audio Guidance on another LG; the Tizen signing profile, counsel's text, the domain and test server, step 34; steps 41, 42, 46 and 47.

## Git state to expect
- Worktree `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed: origin/main (`2cb74f2`) + `d814f15`, `5709912`, `af3bfa5` (leg 168 docs) + the leg-169 commits above + this handover. The main checkout was not touched.
- Dev database: migration `20261123160000_pair_purpose`. Nothing in production, nothing deployed, no migrations.
- Gitignored but present: `node_modules`, `apps/web/.env`, `dist/` (the webOS app of leg 168, stale now), `.cache/fixtures`, `.cache/media`, `artifacts/` (lg-drive.ts, lg-01..20.png, probe56/57 scripts, **mutate58.py**, `screenshots/text-fit/` from the walk).
- GitHub: no scratch branches; scratch workflows disabled; only `CI` active.

## Verified vs not
- **Verified (leg 169, this PC):** ui unit 316+ (incl. new row-scale, zones, listWindow tests), apps/tv unit 5089, tools/tv 133 (3 runs), test/keyboard-glyphs 2; e2e `text-fit.spec` 4/4 (en/ar × normal/large), `text-fit-detector` 2/2, `keyboard.spec` 3/3; root tsc; eslint on touched files. Mutation (`python -X utf8 artifacts/mutate58.py unit|detector|app1|app2`): unit 17/17, detector 12/12, app 10/11 (survivor `hint-two-lines-normal` is equivalent: no hint wraps at the normal size today).
- **Not verified:** the full `pnpm verify` (lint, full test run, build, all e2e); bundle sizes; the LG screenshots of (a)-(c); `pnpm tv` ending on the real LG; CI; the Samsung (the row scale and icons are generic, untried there).
- Migrations and deploys: none.

## Gotchas and lessons
**New in leg 169:**
- **The text-fit walk is order-sensitive:** OK on a guide cell plays the channel, and after anything plays, the next start opens the player. The walk does the player last and never presses OK in the guide.
- **Time-of-day findings:** the guide's catch-up mark pushes its name 2000 px out for the screen reader; the detector now ignores text cut off by a clipping ancestor above a non-clipping box. When a mutant "kills" the walk, read which box it reported (`mutate58.py` prints it): four were first killed by that unrelated finding.
- **Node 24 on Windows:** `process.exit` with two half-closed built-in WebSockets in one run failed an assertion (`!(handle->flags & UV_HANDLE_CLOSING)`, exit 0xC0000409). One socket per command (`keys` reads the screen over its own socket). soak with many sequential sockets exited fine.
- **e2e can't import a module that imports CSS** (Playwright's loader): shared constants for e2e go in import-free modules (`KEY_ICONS` lives in keyboard-layouts.ts).
- **The Write tool decodes `\uXXXX` escapes again** (text-fit.ts's regex): grep for raw marks after writing; use code points (`0x21e7`) in tests.
- **Bash heredoc python patches with `\\n` or `'\''` failed twice:** write patch scripts with the Write tool, or use Edit.
- **Test names with an apostrophe** inside single-quoted strings break the file (settings-window.test.ts): reword.
- **A vertical list now scales with Larger text automatically** (VirtualList and zones). A fixed-height row drawn outside VirtualList (like the settings pages) needs `settingsWindow`-style code, or text-fit fails.

**From earlier legs (still true):**
- Timing budgets: never set ms budgets from this PC; calibrations (memory timing-budgets-calibrated).
- A new package under `packages/` fails `test/ci-changes.test.ts` until listed; a `.github/` change runs every job.
- A new settings screen id must be in `SETTINGS_SCREENS` and `guides-state.test.ts`'s pin. Settings › Player is 9 rows.
- Refresh holds nest: every `busy(true)` needs one `busy(false)`.
- Keyboard: input `width: 0; opacity: 0`, never `display: none`; lift is a transform; test clips with `elementFromPoint`.
- CI waits: foreground loops (`gh pr checks … | awk` then `read -t 14 < /dev/zero`), wait ~20 s after `gh pr create`; a background waiter gets reaped. A 500 on `gh pr create/merge` often still succeeds: check REST. CI takes 13-23 min public; known flakes: Chromium 53/56 start-up, `auto-next` ar-SA, telemetry 30 s.
- GitHub billing blocks the private repo's CI: public only during CI.
- Driving the LG: CDP keys (37-40, 13, 461) and screenshots over ares-inspect's port; `Input.insertText` doesn't type into the app's keyboard; in RTL the header mirrors; the screensaver comes but doesn't touch screenshots; `ares-*` via `tools/tv/node_modules/.bin/ares-*.CMD`; ares-inspect and `pnpm mock` outlive TaskStop.
- Small facts: catalog text lives in main.js; VNode tests don't expand components; CI Node 22, this PC Node 24; no `jq`; `rm` on a shell variable is refused; foreground `sleep` blocked.
- Heavy work one at a time; `--workers=2` for e2e; check free memory first.
- Main-safe code (settings.js too): no `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`, new `for…of`, `Uint8Array` value, `JSON.stringify`, array spread/destructuring, object spread, fragments, `finally`; physical CSS, no Grid or flex `gap`, ES2017; UI text from catalogs. Tests, tools and CI are not bound.
- Smart App Control: before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- Python patches: Write tool, `newline=""`, `python -X utf8`.

## Working rules (unchanged)
- Never call EnterWorktree; `git -C "<wt>"` and absolute paths; scoped `git add`; check `git diff --cached --name-only`; `git commit -F -` with the session's attribution lines; never a bare `git stash`.
- Keep the repo publish-safe (it goes public during CI): no secrets, LG or Samsung binaries or certificates, new personal data, or TV tokens.
- IPTV PRs merge on green CI without Omar (merge commit, keep the branch); never merge on red; a red caused by the CI environment is a needs-you. After the merge: fetch, ff-only, tick, progress row, repo private.
- Production: nothing before step 34. CLAUDE.md edits need Omar's direct word in his own tab.
- TVs: the LG is handed over for step 58's checks (Omar left it on, in Lablo). No `pnpm tv`, sdb or `ares-*` against the Samsung unless Omar hands it over.

## Open decisions and gates
- The beta route per store (step 46, `docs/store/beta.md`): Omar's.
- MP4 subtitles on the Samsung: leave, hide, or demux. Not blocking.
- Later fixes without a step: a reference check of Lablo's server on the connection page (needs step 34); AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` mapping; step 21's quirks.
- Step 34 `[needs Omar]`: accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each needs his one-word OK).

## Checks for Omar
1. On the Samsung: 39s7's inflow rule ("Reconnecting…" within about 30 s); step 21's 50 zaps and the 2 h soak on today's main.
2. Audio Guidance on an LG that offers it (his OLED55A1PVA doesn't).
3. Store pack and beta kit: skim `docs/store/README.md` and `docs/store/beta.md`; the Arabic texts need a native read.
4. Release: `pnpm release:check --no-build`.
5. Larger text (new in 58): lists show fewer, taller rows; the English Player hint now reads "Languages, caption look, picture, clock, sleep timer, buffering and larger text", and Backup's intro "An encrypted copy of your sources, favourites and settings, to bring back after a reset." Say if you want other wording.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Secrets: rotate the lionz IPTV provider password** (pasted 2026-11-25; never in the repo).
- At the LG TV: read Dev Mode's "Remain Session" (extend it in the Developer Mode app).
- Samsung: back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12`; a signed `.wgt` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`; submit the Seller Office Partner application (Samsung Gulf).
- Trademark clearance (US, CA, AE, SA) and domains for "Lablo".
- Counsel: the ToS and privacy text (`LEGAL_DRAFT` false, placeholders), the DMCA agent, the store docs' `<official domain>` and test-server placeholders.
- GitHub billing: CI on the private repo was refused on 2026-11-27; keep the payment method valid.
- Settings: prune `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` when the relay ends, if he wants it tighter.
- Sixty CLAUDE.md gaps wait for his word: 1–28 `git show d05d5fd:HANDOVER.md`; 29–47 `5fffb27`; 48–54 `081c1ee`; 55 `e85772d`; 56 `6235456`; 57 `b54b260`; 58–60: `pnpm verify` runs in five parts in CI, the budget line omits lazy files (200 KB), `pnpm release:check` is missing from the commands table. Candidate 61: the repo's visibility rule (private, public only during Claude's CI). Candidate 62: the text-fit check (`e2e/text-fit.spec.ts`) as the gate for any new screen or row.
