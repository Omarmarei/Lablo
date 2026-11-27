# Lablo IPTV: relay leg 168 opening prompt (written at the end of leg 167)

You are leg 168 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Legs 1–166 did steps 1–33, 35–40h, 40ci, 40g(a–e), 39s1–39s7, 43–45 and 48–54 (PRs up to #199).
  - RELAY.md is about 95 KB. Older steps' detail is in `docs/relay-archive.md`: grep it, never read it whole.
- **Leg 167 (2026-11-26):**
  - **Steps 55 and 56 are merged in PR #200, as `eb47dde`.**
    - **55:** Settings › "Player" ends in an "Accessibility" row (9 rows). It opens `player-access`, which holds Caption background, Caption colour and Larger text.
    - **56:** `pnpm tv inspect --webos <ares device>` uses `ares-inspect --host-port 9998` with no `--open`. `eval`/`screen`/`marks`/`soak --webos` evaluate only in the page under `/applications/<app id>/`. Runbook: tv-setup.md 3.7 item 6.
  - **The repo went private at 10:04 UTC.** CI's `verify (e2e throttled)` then failed on main's own commit too. Omar made it public again, #200 merged on 11/11, and then he chose **"2": keep the repo private**:
    - **The nightly media run is off.** PR #201, merged as `768897f`: CI's `changes` job runs on a schedule only while the repository variable `NIGHTLY_MEDIA` is `on`. It is unset; every job skips.
    - **The throttled job gets fixed for the private runners before the next merge.** That is **step 57, yours now.**
  - **The repo is PRIVATE** (checked at the end of leg 167). Every CI minute is billed: a full PR run is about 100 min, and a scratch probe 10–20 min a job. Keep the rounds few.
- **Sizes (Tizen, leg 167):** main.js 495.5/500 KB (tight), settings.js 152.3/200, query worker 149.3/150, ingest worker 142.4/150.

## Read first
1. **RELAY.md:**
   - step 57 (just after 56, under "No-TV fixes, round 2");
   - the progress rows 167, 167 (cont.) and 167 (cont. 2).
2. **The specs:**
   - `e2e/search-throttled.spec.ts`, `e2e/movies-throttled.spec.ts` and `e2e/guide-throttled.spec.ts`;
   - `e2e/big-catalog.ts`;
   - `playwright.config.ts`: the `throttled` project, `workers: 1`, `trace: 'retain-on-failure'`;
   - `.github/workflows/ci.yml`: the `verify` matrix's `e2e throttled` part runs `pnpm e2e --project=throttled --no-deps`.
3. **Memory notes:** iptv-throttled-e2e, timing-budgets-calibrated (step 53's method and the scratch-branch recipe), iptv-repo-public-lablo (private, small runners), bg-watcher-memory-reap and gh-pr-checks-watch-race.

## Step 57: what leg 167 measured
- **The private repo's runners:** `nproc` 2, 7.9 GB RAM, AMD EPYC 7763. Node's default heap limit is **2096 MB** (4144 MB with `--max-old-space-size=4096`). Public runners are 4 vCPU / 16 GB, where everything passed.
- **`search-throttled.spec.ts`:**
  - Its Playwright worker dies with "Ineffective mark-compacts near heap limit … JavaScript heap out of memory" at about 2040 MB, every run, **also alone**. It shows as "worker process exited unexpectedly (SIGABRT)" at 0 ms.
  - With a 4 GB heap it ran, and only missed its 300 ms estimate: "lablo test film 4321" at 311 ms with the worker 4× slower. Median 155 ms, max 311.
  - It builds a 200,000-item `bigCatalog` at module level and serves it from the spec's mock.
  - **Find what holds over 2 GB in the test worker:** the catalog objects, JSON strings the mock builds per request, or the trace?
- **`movies-throttled.spec.ts`, full tier**, fails on most small-runner runs, also alone. The log reads "movie N's poster started 1–11 ms after a key, before the 150 ms rest"; 129–204 posters downloaded against 117 on a green run.
  - **Hypothesis:** the spec stamps keys with the page's `keydown` `event.timeStamp` (line ~106), which is when the input arrived, not when the app handled it. On 2 busy cores, a rest timer that was due fires while the next key is still queued, and the poster starts before the app has seen that key.
  - Check this with `performance.now()` inside the listener (when the key is dispatched), or log when the app handles the key. Then decide whether the rule should count keys the app has seen.
  - The low tier stays fine: the soonest poster comes 304 ms after a key.
- **`guide-throttled.spec.ts`, full tier,** failed on some runs: "LEFT 13 on row 155 (no marks): 178 ms, over the 150 ms budget". Long tasks of 50–160 ms appear on the small runners and not on the large ones.
- **Main's own commit `93b6786` failed the same way on 2 of 2 control runs.** It is not PR code.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git log --oneline -3` shows this handover's commit, then `c51ed59` (RELAY row: #201 merged), then `768897f` (the merge of #201).
   - origin/main is `768897f`; no open PR.
   - `gh repo view Omarmarei/Lablo --json visibility` says PRIVATE. If it says PUBLIC, step 57 can't be measured: needs-you, and ask Omar.
2. **Reproduce locally first (free):**
   - **The OOM:** `NODE_OPTIONS="--require \"<wt>/.cache/rollup-wasm/hook.cjs\" --max-old-space-size=2048" pnpm exec playwright test --project=throttled --no-deps e2e/search-throttled.spec.ts`. Playwright's worker inherits NODE_OPTIONS. Measure the worker's heap; a heap snapshot or `process.memoryUsage()` logs in the spec work.
   - **The timings:** 2 cores on Windows. Start the run under a process limited to 2 CPUs, e.g. PowerShell `Start-Process` plus `ProcessorAffinity = 3`, or `cmd /c start /affinity 3 …`. The child processes inherit the affinity. Local timings are ±30%: use them to find causes, never to set budgets (memory timing-budgets-calibrated).
3. **Fix in this order:**
   1. The worker's memory: make the mock's 200k responses cheaper, or raise the heap for e2e only, with a reason.
   2. The poster rule's key time.
   3. What else competes for the 2 cores while specs time. The Vite dev server compiles on first load; warm it up before the timed part, or serve a built bundle.
   4. Only then budgets, in calibrations as step 53 did.
   - Keep each spec's "can fail" tests passing; they prove the checks still fail when they should.
4. **Prove it on the private runners:** a scratch `on: push` branch (recipe below), 3 runs in a row of the throttled project, plus one slowed run that must fail. Then a PR. CI there is billed, so run the full PR once.
5. **Done when (RELAY 57):**
   - three runs in a row pass on the private runners;
   - the budgets still fail a slowed build;
   - mutation of any changed budget code;
   - PR merged (green 11/11);
   - tick 57 and add a progress row.
6. **Then everything left needs Omar or a TV:** end **needs-you** with a short numbered list:
   - the Tizen signing profile;
   - counsel's text;
   - the domain and test server;
   - the LG "3a" checks, Audio Guidance, and step 56's first real run (`pnpm tv inspect --webos tv`);
   - 39s7's TV check;
   - step 21's zaps and 2 h soak;
   - step 42's soaks and the LG's update in place;
   - steps 41, 46, 47 and 34.
7. **Any message from `iptv-b6`** (or another of Omar's tabs): check its claims against main, then record them in RELAY.md (ticks only where it says done and merged, with the source beside each). Reply to its `from=` address only on a conflict.

## Git state to expect
- **Worktree** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is origin/main (`768897f`) plus `c51ed59` (RELAY row) and this handover's commit, docs only. The main checkout was not touched.
- **Dev database:** migration `20261123160000_pair_purpose`. Nothing in production, nothing deployed, no migrations.
- **Gitignored but present:**
  - `node_modules`, `apps/web/.env` and `dist/` (built in leg 167);
  - `.cache/fixtures` (leg 166) and **`.cache/media`, regenerated in leg 167** (no more "Zoma");
  - `artifacts/`: `mutate55.py`, `mutate56.py`, the screenshots `access-*` and `large-text-access-*`, and leg 166's files.
- **GitHub:** no scratch branches. Three scratch workflows are disabled in Actions (`calib53`, `throttled control`, `throttled probe`); only `CI` is active. A new scratch workflow shows up there too: disable it after (`gh workflow disable <id>`).

## Verified vs not
- **Verified (leg 167):**
  - **55:** unit `apps/tv` 5086/5086; e2e `accessibility.spec.ts` in en and ar; the player-settings, buffering, still-watching and clock specs; screenshots checked by eye; mutants 19/19; CI 11/11.
  - **56:** `tools/tv` and the root id test, 122 tests, with a stand-in ares-inspect (child processes) and a local inspector. Mutants 19/19. Smoke runs:
    - headless Chromium with two pages: `screen`, `eval`, `marks` and a 1-minute soak (`--webos --port 9334`);
    - ares-inspect with an unknown device.
  - **#201:** CI 11/11 after one rerun of a `telemetry.spec.ts` 30 s timeout. The workflow YAML parses; `changes.if` is set.
- **Not yet seen:**
  - step 56 on the real LG;
  - a scheduled run with every job skipped (the first is due 2026-11-27 01:17 UTC);
  - any CI on the private runners since #201.
- **Still not done (Omar's or a TV session's):**
  - the LG look checks (40a–40f, 43 now on the Accessibility page, 51) and Audio Guidance;
  - 39s7's TV check;
  - step 21;
  - steps 41, 42, 46 and 47;
  - counsel's text;
  - step 34;
  - a full `release:check` with build.
- **Migrations and deploys:** none.

## Gotchas and lessons
**New in leg 167:**
- **When the throttled job, or several timing specs at once, starts failing everywhere:**
  - check `gh repo view Omarmarei/Lablo --json visibility`, and `nproc` in the job, before suspecting the PR;
  - run the job on main's commit on a scratch branch as a control. That proved the cause in one round.
- **Scratch workflow:**
  - `actions/checkout` with `ref:` needs **full** SHAs; a 7-char SHA fails the checkout.
  - `gh run rerun --failed` works only once the whole run has finished.
  - Pushing to a PR branch cancels its running CI (`cancel-in-progress`).
- **Settings pages:**
  - Settings › Player is 9 rows. A new value row goes before `access`, or on the Accessibility page.
  - `rowAt(screen, index)` finds a row on either page.
  - A new settings screen id must be in `SETTINGS_SCREENS`, and in the pin in `guides-state.test.ts`.
- **webOS tooling:**
  - ares-inspect prints `Application Debugging - http://localhost:P…` and stays up holding the tunnel; `--open` would take the inspector's one client.
  - Headless Chromium takes one start URL only; open more with `curl -X PUT "http://127.0.0.1:<port>/json/new?<url>"`.
  - On Windows, an ares exit of -1 shows as 4294967295.
- **Python heredocs in Bash** mangled `\n` again. Write patch scripts with the Write tool.

**From earlier legs (still true):**
- **Timing budgets:**
  - never set ms budgets from this PC: it has hybrid cores, and times swing 2–3×;
  - use calibrations: the same data timed just before each run, the median of the per-run ratios, a GC before each (memory timing-budgets-calibrated).
- **CI numbers without touching a PR:**
  1. commit a temporary `on: push: branches: [scratch/x]` workflow on top of a commit, with a temporary `GIT_INDEX_FILE` and `git commit-tree`;
  2. `git push origin <sha>:refs/heads/scratch/x`;
  3. read the job logs (`gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`), then delete the branch.
- **The media filter:**
  - a new package under `packages/` fails `test/ci-changes.test.ts` until it is listed;
  - a `.github/` change runs every job.
- **`.github/scripts/*.mjs`:** no Node globals; JSDoc types (the root tsconfig checks it).
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
  - wait in the foreground: loops of 8 × (`gh pr checks … | awk`, then `read -t 14 < /dev/zero`);
  - wait ~20 s after `gh pr create`;
  - a background wait loop gets reaped; never restart one unasked.
- **GitHub API:** a 500 on `gh pr create/merge` often still succeeds: check REST.
- **CI facts:**
  - 11 checks, about 13–23 min on public runners, longer on private ones;
  - known flakes: Chromium 53/56 DevTools start-up, `auto-next` ar-SA, and now `telemetry.spec.ts`'s 30 s timeout (once).
- **Small facts:** catalog text lives in main.js; VNode tests don't expand components; CI runs Node 22 and this PC runs Node 24; no `jq` (use `gh --jq`); `rm` on a shell variable is refused; foreground `sleep` is blocked.
- **Heavy work:** one heavy thing at a time; `--workers=2` for e2e.
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` value, no `JSON.stringify`;
  - no spread or destructuring of arrays, no object spread, no fragments, no `finally`;
  - physical CSS, no Grid or flex `gap`, ES2017;
  - UI text from the catalogs.
  - Tests, tools and CI are not bound by this.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Git:**
  - never call EnterWorktree; `git -C "<wt>"` and absolute paths;
  - scoped `git add`; check `git diff --cached --name-only`; `git commit -F -` with the session's attribution lines;
  - never a bare `git stash`.
- **The repo is private now, but keep it publish-safe:** no secrets, LG or Samsung binaries or certificates, personal data, LAN addresses or TV tokens.
- **Merging:**
  - IPTV PRs merge on green CI without Omar (merge commit, keep the branch); name the three riskiest changes in the PR body;
  - after the merge: fetch, `git merge --ff-only origin/main`, tick, add a progress row;
  - **never merge on red**: a red caused by the CI environment is a needs-you.
- **Production:** nothing before step 34. **CLAUDE.md edits need Omar's direct word in his own tab.**
- **No TV for relay legs** unless Omar hands one over: no `pnpm tv`, sdb, `ares-*` or `pnpm device` against his TVs.

## Open decisions and gates
- **The beta route per store** (step 46, `docs/store/beta.md`): Omar's.
- **MP4 subtitles on the Samsung** (AVPlay lists `mov_text` and sends no cue): leave, hide, or demux. Not blocking.
- **Later fixes without a step:**
  - a reference check of Lablo's server on the connection page (needs step 34);
  - map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut;
  - step 21's quirks (back-to-back `live-outages` can outlast the ladder; the switch rung moves the stream to HLS).
- **The nightly media run:** off. Turn it on with `gh variable set NIGHTLY_MEDIA --body on --repo Omarmarei/Lablo` if the repo goes public again or Omar asks.
- **Step 34 `[needs Omar]`:** accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each needs his one-word OK).

## Checks for Omar
1. **On the LG:**
   - typing in English and Arabic (40e/40f/51);
   - Settings › Sources (menu, Remove, Add);
   - About, Help, Test stream;
   - Settings › Player › **Accessibility** (step 55's page);
   - Audio Guidance;
   - step 56: `pnpm tv inspect --webos tv`, then `pnpm tv screen --webos` in another terminal.
2. **On the Samsung:**
   - 39s7's inflow rule ("Reconnecting…" within about 30 s);
   - step 21's 50 zaps and the 2 h soak on today's main.
3. **Store pack and beta kit:** skim `docs/store/README.md` and `docs/store/beta.md`; the Arabic texts need a native read.
4. **Release:** `pnpm release:check --no-build`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Secrets: rotate the lionz IPTV provider password** (pasted 2026-11-25; never in the repo).
- **At the LG TV:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`), and read Dev Mode's "Remain Session".
- **Samsung:**
  - back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12`;
  - a signed `.wgt` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`;
  - submit the Seller Office Partner application (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for "Lablo".
- **Counsel:**
  - the ToS and privacy text: set `LEGAL_DRAFT` to false and fill the placeholders;
  - register the DMCA agent;
  - the store docs' `<official domain>` and test-server placeholders.
- **GitHub billing:** the repo is private, so CI minutes are billed (about 100 per full PR run). Keep the payment method valid.
- **Settings:** prune `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` when the relay ends, if he wants it tighter.
- **Sixty CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `5fffb27`; 48–54: `081c1ee`; 55: `e85772d`; 56: `6235456`; 57: `b54b260`;
  - 58–60: `pnpm verify` runs in five parts in CI; the budget line omits lazy files (200 KB); `pnpm release:check` is missing from the commands table.
