# Lablo IPTV: relay leg 169 opening prompt (written at the end of leg 168)

You are leg 169 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Legs 1–167 did steps 1–33, 35–40h, 40ci, 40g(a–e), 39s1–39s7, 43–45 and 48–56 (PRs up to #201).
  - RELAY.md is about 100 KB. Older steps' detail is in `docs/relay-archive.md`: grep it, never read it whole.
- **Leg 168 (2026-11-27):**
  - **Step 57 is merged in PR #202, as `2cb74f2`.** It fits the throttled e2e for 2-vCPU runners:
    - the search spec serves `writeBigGuide`'s file;
    - the poster rule stamps keys at dispatch;
    - the throttled project's trace has no snapshots or screencast.
  - **Repo rule (Omar, 2026-11-27):**
    - **The repo stays PRIVATE.** Claude makes it public only while its own CI runs, and private again right after (memory iptv-repo-public-lablo).
    - It is private now.
    - The nightly media run stays off (`NIGHTLY_MEDIA` unset).
  - **The first LG session** (Omar handed the TV over and asked Claude to drive it):
    - the old lab is removed;
    - the store build is installed;
    - step 56's tooling ran on the real TV.
    - **Claude drove the app by CDP keys and took screenshots** through `ares-inspect`; nobody pressed the remote. Most checks passed.
    - The bugs found are **RELAY step 58, yours now.**
- **Sizes (unchanged, no app code changed):** main.js 495.5/500 KB on Tizen (481.8 on webOS), settings.js 152.3/200, query worker 149.3/150, ingest worker 142.4/150.

## Read first
1. **RELAY.md:**
   - **step 58** (right after 57, in "No-TV fixes, round 2");
   - the progress rows 168, 168 (cont.) and 168 (cont. 2).
2. **Memory notes:**
   - **iptv-lg-tv-devmode** (the leg-168 section: how to drive and screenshot the LG);
   - iptv-repo-public-lablo (the visibility rule);
   - iptv-css-pipeline-gotchas, iptv-ui-test-gotchas and iptv-player-settings-rows;
   - iptv-own-keyboard-gotchas and iptv-tools-test-gotchas;
   - iptv-tv-bundle-polyfills (budgets);
   - bg-watcher-memory-reap and gh-pr-checks-watch-race.
3. **The code for step 58:**
   - **(a) Rows that overflow:**
     - `apps/tv/src/settings/settings.css` (`.settings__row { height: 120px }`) and `SettingsScreen.tsx` (virtual lists with `itemSize`);
     - `apps/tv/src/search/search-state.ts` (`SEARCH.rowHeight` 88, `fits`, `SEARCH_VISIBLE`) and `SearchScreen.tsx`;
     - `packages/ui/src/styles/tokens.css` (`html[data-large-text='on']`: fonts about +25%);
     - `apps/tv/src/player/appearance.ts` (the `largeText` signal);
     - `e2e/accessibility.spec.ts` (the large-text screenshots; it only checks the safe area).
   - **(b) The backspace glyph:** `packages/ui/src/focus/screen-keyboard.ts` (the action keys' glyphs, line ~99) and `packages/ui/src/styles/fonts.css` (Lablo Sans).
   - **(c) The dot:** the live header's "Guide" chip and the CSS that draws its dot.
   - **(d) The webOS commands:**
     - `tools/tv/src/cdp.ts` (`evaluateOnPort`), `tools/tv/src/main.ts` and `tools/tv/src/webos.ts`;
     - `artifacts/lg-drive.ts` (gitignored) is the working prototype of `keys`/`shot --webos`;
     - `artifacts/probe56-exit.ts` shows the hang.
4. **The screenshots:** `artifacts/lg-01.png` … `lg-20.png`.
   - The bugs: `lg-01` (the empty-box backspace), `lg-06` (the Player row), `lg-16`/`lg-18` (Settings with Larger text, en/ar), `lg-19` (search with Larger text, ar) and `lg-05` (the Guide chip's dot).
   - `lg-20` (search, normal text) fits.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git log --oneline -4` shows this handover's commit, then `5709912` (step 58), `d814f15` (tick 57) and `2cb74f2` (the merge of #202).
   - origin/main is `2cb74f2`; no open PR.
   - `gh repo view Omarmarei/Lablo --json visibility` says PRIVATE.
2. **Build step 58.** Do (a) first: it is the main bug.
   1. Write the in-page overflow detector: a text box outside its row's box.
   2. Run it in desktop Chromium over every screen, in en and ar, at both text sizes. The font is bundled, so the desktop shows the TV's overflow; leg 168 saw it on the TV only.
   3. Fit what it finds, then keep it as an e2e check.
   - Then do (b), (c) and (d), with their tests and mutation.
   - Mind the budgets: settings.js and the query worker are near theirs.
3. **Check on the LG (no Omar needed; he left the TV on, in Lablo):**
   1. `pnpm build:tv --platform webos --target app`.
   2. `pnpm device install webos tv` updates in place and keeps the data.
   3. `pnpm tv inspect --webos tv` in the background; `pnpm mock` in the background too.
      - The source is the mock at `http://192.168.1.7:8080`. Check this PC's Wi-Fi address first; the stored catalog draws without it.
   4. Drive and screenshot with the new `pnpm tv keys|shot --webos` (or `artifacts/lg-drive.ts`): Settings and search, normal and Larger text, en and ar; the keyboard; the header.
   5. Put the TV back to English with Larger text off.
   6. End the mock and ares-inspect by their node pids: they outlive TaskStop.
4. **CI:**
   1. Scan the commits after `2cb74f2` for secrets or personal data.
   2. `gh repo edit Omarmarei/Lablo --visibility public --accept-visibility-change-consequences`.
   3. Then push, open the PR, wait, and merge on green (merge commit, branch kept).
   4. **Then `--visibility private` at once** and say so.
5. **Done when (RELAY 58):**
   - the overflow check is green in en/ar at both sizes;
   - unit tests for (b) and (d);
   - mutation of the detector and the exit;
   - LG screenshots show (a)–(c) fixed;
   - the PR is merged.
   - Then tick 58 and add a progress row.
6. **Then everything left needs Omar or a TV:** end **needs-you** with a short numbered list:
   - the Samsung checks (39s7's "Reconnecting…", step 21's 50 zaps and 2 h soak);
   - Audio Guidance on another LG;
   - the Tizen signing profile, counsel's text, the domain and test server, step 34;
   - steps 41, 42, 46 and 47.

## Git state to expect
- **Worktree** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
  - It is origin/main (`2cb74f2`) plus `d814f15` (tick 57), `5709912` (step 58) and this handover's commit, all docs.
  - The main checkout was not touched.
- **Dev database:** migration `20261123160000_pair_purpose`. Nothing in production, nothing deployed, no migrations.
- **Gitignored but present:**
  - `node_modules`, `apps/web/.env`, and `dist/` (the webOS app built in leg 168);
  - `.cache/fixtures` and `.cache/media`;
  - `artifacts/`:
    - `lg-drive.ts` and `lg-01..20.png`;
    - `probe57-xmltv.ts`, `probe57-throttle.ts` and `probe56-exit.ts`;
    - `mutate57.py`, `tick57.py` and `step58.py`;
    - `tv-soak-2026-11-27*.ndjson`.
- **GitHub:**
  - no scratch branches;
  - four scratch workflows disabled (`calib53`, `throttled control`, `throttled probe`, `throttled 168`); only `CI` is active.

## Verified vs not
- **Verified (leg 168):**
  - **57:**
    - local: the four throttled specs 9/9 under a 2 GB heap;
    - key-stamp mutants 2/2;
    - a scratch probe on the public runners: fixed 3/3, the full-trace contrast, and 8x still green (the budgets keep about 2× headroom; the specs' can-fail tests are the slowed proof);
    - PR #202's CI green.
  - **On the LG:**
    - typing with remote keys on the app's keyboard (English, the 123 layer, the Arabic layout; the form lifts);
    - adding a source named تجربة;
    - the live screen; Settings; the Sources row menu (Change, Remove, Cancel);
    - Check the connection; Help; About (draft mark);
    - Player › Accessibility with Back to its row; Larger text;
    - the Arabic interface right to left; Arabic search;
    - step 56's `inspect`, `screen`, `eval` and `soak` (minus their exit).
- **Not verified:**
  - 57's fixes on the 2-vCPU private runners (no green run there);
  - the LG's Audio Guidance: this TV has none;
  - the test stream (it needs step 34's config);
  - the Samsung checks; step 21; steps 41, 42, 46 and 47;
  - counsel's text; step 34; a full `release:check` with build.
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 168:**
- **GitHub billing blocked the private repo's CI.** The annotation reads: "recent account payments have failed or your spending limit needs to be increased". 0 minutes were used, and making the repo public unblocked it.
- **`gh variable set NIGHTLY_MEDIA` was refused** by the auto-mode classifier as unasked. `gh repo edit --visibility` was allowed on Omar's word.
- **Playwright traces:** `trace: 'retain-on-failure'` snapshots the DOM around every `evaluate`, which falls inside a timed press. Timed projects use `trace: { mode, snapshots: false, screenshots: false }`.
- **Big catalogs:** a big-catalog spec without `xmltvFile` makes the mock build days of guide per channel; 30,000 channels gave 923M chars, over V8's longest string. Use `writeBigGuide`.
- **Key times:** for a "N ms after the last key" rule, stamp keys with `performance.now()` in a capturing window listener, not `event.timeStamp`.
- **Local probes:** 2-core affinity on this PC (`cmd /c start /affinity 3`) doesn't reproduce a 2-vCPU runner.
- **Driving the LG:**
  - **The method:** CDP `Input.dispatchKeyEvent` + `Page.captureScreenshot` over ares-inspect's port. `Input.insertText` doesn't type into the app's keyboard: steer `.z-kbd__key.is-focused` with arrows, then OK.
  - **Keyboard layouts:** `-` is on the `123` layer (`abc` goes back). Name and password fields have `ع` for Arabic; URL fields have `/` and `:` instead. Done is `Done` (`تم` in Arabic).
  - **Value rows** don't wrap past their last value: use LEFT to go back.
  - **In the RTL interface** the header mirrors: LEFT goes to higher indices.
  - **Settings has 13 rows:** Check the connection is 9, Help 11, About 12.
  - **Run each step separately:** a chained sequence went wrong once. Back on search returns to the field, and an OK reopened the keyboard; read the focus path after each step.
  - **ares tools:** `ares-*` aren't on the root PATH: use `tools/tv/node_modules/.bin/ares-*.CMD` or `pnpm device`.
  - **The screensaver** shows (CDP keys aren't remote activity); it doesn't touch the page or the screenshots.
- **Processes:** `ares-inspect` and `pnpm mock` outlive TaskStop.

**From earlier legs (still true):**
- **Timing budgets:**
  - never set ms budgets from this PC;
  - use calibrations (memory timing-budgets-calibrated);
  - scratch `on: push` branch probes: full SHAs for `actions/checkout`, and disable the workflow after.
- **The media filter:**
  - a new package under `packages/` fails `test/ci-changes.test.ts` until it is listed;
  - a `.github/` change runs every job.
- **A new settings screen id** must be in `SETTINGS_SCREENS` and in `guides-state.test.ts`'s pin. Settings › Player is 9 rows; `rowAt(screen, index)`.
- **A new lab row or media item is pinned in five places:**
  - `e2e/lab.spec.ts`;
  - `tools/engines/src/lab.ts` and `lab.test.ts`;
  - `spikes/s4.test.ts` and `battery.test.ts`;
  - `e2e/lab-media.spec.ts`.
- **Refresh holds nest:** every `busy(true)` needs exactly one `busy(false)`.
- **The keyboard (step 51):**
  - the input goes to `width: 0; opacity: 0`, never `display: none`;
  - the lift is a `transform` on `#app`;
  - in e2e, test a clip with `elementFromPoint`.
- **CI waits:**
  - foreground loops: 8 × (`gh pr checks … | awk`, then `read -t 14 < /dev/zero`), or `timeout 570` until-loops;
  - wait ~20 s after `gh pr create`;
  - a background waiter gets reaped.
- **GitHub API:** a 500 on `gh pr create/merge` often still succeeds: check REST.
- **CI facts:**
  - about 13–23 min on public runners;
  - known flakes: Chromium 53/56 start-up, `auto-next` ar-SA, `telemetry.spec.ts`'s 30 s timeout.
- **Small facts:** catalog text lives in main.js; VNode tests don't expand components; CI runs Node 22 and this PC runs Node 24; no `jq` (use `gh --jq`); `rm` on a shell variable is refused; foreground `sleep` is blocked.
- **Heavy work:** one heavy thing at a time; `--workers=2` for e2e; check free memory first (the PC has had 1.5 GB of RAM free).
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` value, no `JSON.stringify`;
  - no spread or destructuring of arrays, no object spread, no fragments, no `finally`;
  - physical CSS, no Grid or flex `gap`, ES2017;
  - UI text from the catalogs.
  - Tests, tools and CI are not bound by this.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Python patches:** write them with the Write tool, never heredocs; open files with `newline=""`.

## Working rules (unchanged)
- **Git:**
  - never call EnterWorktree; `git -C "<wt>"` and absolute paths;
  - scoped `git add`; check `git diff --cached --name-only`; `git commit -F -` with the session's attribution lines;
  - never a bare `git stash`.
- **Keep the repo publish-safe** (it goes public during CI): no secrets, LG or Samsung binaries or certificates, new personal data, or TV tokens.
- **Merging:**
  - IPTV PRs merge on green CI without Omar (merge commit, keep the branch); name the three riskiest changes in the PR body;
  - after the merge: fetch, `git merge --ff-only origin/main`, tick, add a progress row, and make the repo private;
  - **never merge on red**: a red caused by the CI environment is a needs-you.
- **Production:** nothing before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.**
- **TVs:**
  - **The LG is handed over for step 58's checks** (Omar left it on, in Lablo).
  - No `pnpm tv`, sdb or `ares-*` against the Samsung unless Omar hands it over.

## Open decisions and gates
- **The beta route per store** (step 46, `docs/store/beta.md`): Omar's.
- **MP4 subtitles on the Samsung:** leave, hide, or demux. Not blocking.
- **Later fixes without a step:**
  - a reference check of Lablo's server on the connection page (needs step 34);
  - AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` mapping;
  - step 21's quirks.
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each needs his one-word OK).

## Checks for Omar
1. **On the Samsung:**
   - 39s7's inflow rule ("Reconnecting…" within about 30 s);
   - step 21's 50 zaps and the 2 h soak on today's main.
2. **Audio Guidance:** on an LG that offers it (his OLED55A1PVA doesn't).
3. **Store pack and beta kit:** skim `docs/store/README.md` and `docs/store/beta.md`; the Arabic texts need a native read.
4. **Release:** `pnpm release:check --no-build`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Secrets: rotate the lionz IPTV provider password** (pasted 2026-11-25; never in the repo).
- **At the LG TV:** read Dev Mode's "Remain Session" (the session expires; extend it in the Developer Mode app). The old lab is removed (done in leg 168).
- **Samsung:**
  - back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12`;
  - a signed `.wgt` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`;
  - submit the Seller Office Partner application (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for "Lablo".
- **Counsel:**
  - the ToS and privacy text: set `LEGAL_DRAFT` to false and fill the placeholders;
  - register the DMCA agent;
  - the store docs' `<official domain>` and test-server placeholders.
- **GitHub billing:** CI on the private repo was refused on 2026-11-27. With the repo public only during CI it isn't needed, but keep the payment method valid.
- **Settings:** prune `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` when the relay ends, if he wants it tighter.
- **Sixty CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `5fffb27`; 48–54: `081c1ee`; 55: `e85772d`; 56: `6235456`; 57: `b54b260`;
  - 58–60: `pnpm verify` runs in five parts in CI; the budget line omits lazy files (200 KB); `pnpm release:check` is missing from the commands table.
  - Candidate 61: the repo's visibility rule (private, public only during Claude's CI).
