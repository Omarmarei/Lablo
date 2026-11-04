# Zoma IPTV: relay leg 34 opening prompt

You are leg 34 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–32 did steps 1–15c2 (PRs #1–#31). Leg 6 did no project work.
- **Leg 33** did **step 15d: the docs (research).**
  - Commit `2576e0d`. PR **#32** was merged as merge commit **`f232657`**, with the branch kept.
  - CI on `2576e0d` was green on the first run: `verify` 8 m 50 s, `media` 11 m 53 s, `engines` 13 m 54 s (of its 25-minute limit).
  - Main's CI on PR #31's merge (`1b5a75d`) was green too.

## Your step: 15e (RELAY.md is the spec)
"The lab in an emulator": the webOS TV Simulator or Emulator, or the Tizen TV Emulator, following `docs/runbooks/tv-setup.md`. **Done when:** the lab runs in at least one emulator or simulator, and its records reach the collector. Once 15e is done, tick step 15 too: the desktop lab, an emulator and both docs are its Done-when.

RELAY.md's 15e entry already says what leg 33 found. The order to try:
1. **The webOS TV Simulator** (tv-setup.md 2.4). It needs no install and no account: a zip from LG (`webOS_TV_24_Simulator_1.4.1_win.zip`, or 22–26, or 6.0), from https://webostv.developer.lge.com/develop/tools/simulator-installation.
   - The page puts the download behind a terms dialog, and LG doesn't publish direct URLs.
     - If you can find the file's URL on the page (for example under `/developer/resource/20260325/`), download it with curl into a new, empty folder outside the repo, e.g. `D:/tools/webos-sim/`, and unzip it there.
     - If the download needs a click in a browser, stop: needs-you. Ask Omar to download and unzip it, and to tell you the folder.
   - Then:

     ```bash
     pnpm build:tv --platform webos --target lab --lab-server http://127.0.0.1:8080
     pnpm --filter @zoma/tools-device exec ares-launch -s 24 -sp "<folder holding the .exe>" "D:/Claude Code PlayGround/IPTV-relay-20261101-214120/dist/tv-lab/webos"
     ```

     Start `pnpm mock` first, in the background. Use absolute paths: `pnpm --filter … exec` runs in `tools/device`.
   - **Smart App Control** may block the simulator's `.exe`. If it does, report it as needs-you. Never turn SAC off and never try to get around it.
   - **Success** is a session in `artifacts/lab-logs/` with S0's model/OS row and S1's records.
     - Expect S3 and S5's luna route to skip or fail ("Some of luna API and webOSSystem API are not supported").
     - Note what the simulator reports as its Chromium version.
     - Write the results into lab.md "Where else the lab runs" and tv-setup.md 2.4.
   - The webOS Simulator 6.0 is Chromium 79, the oldest one.
2. **The webOS Emulator 4.0** (Chromium 53) needs VirtualBox 6.1 installed. That is an install: needs Omar. Whether it runs beside this PC's Hyper-V is unconfirmed.
3. **The Tizen emulator:** no. It needs HAXM with Hyper-V off, which stops Docker (`verify:engines`). It also offers only TV 10.0.
4. **If nothing runs without Omar,** end the leg as needs-you with a numbered list:
   1. download the Simulator zip;
   2. install VirtualBox 6.1;
   3. skip 15e and go to step 16.

After 15e: step 16 is `[needs Omar]`. He supplies the LG TV's model and year and puts it in Developer Mode, picks the Samsung route (`docs/testing-without-tvs.md`), and creates the accounts and the certificate.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`.
   - If the run on `f232657` is red, fix it on the relay branch first.
   - If only `engines` is red with "DevTools … did not answer", rerun it with `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation. Use `git -C`, `pnpm --dir` and absolute paths. Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: steps 15d (its "Found" notes), 15e and 16, and the progress-log rows for legs 31–33.
3. `docs/runbooks/tv-setup.md`, the new runbook: "At a glance", 1 (the lab server per device), 2.3 (Emulator) and 2.4 (Simulator).
4. `docs/runbooks/lab.md` ("Quick start", "Where else the lab runs", "Troubleshooting") and `docs/testing-without-tvs.md` (for step 16).
5. Memory:
   - `iptv-dev-toolchain` (Smart App Control, this PC's Hyper-V);
   - `iptv-research-doc-method`;
   - `use-write-tool-for-doc-batches`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md on top of `2576e0d`. It also records PR #32's merge in RELAY.md. It is pushed, and the tree is clean.
- **main** has `f232657`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (built by leg 32 from the then-merged sources; rebuild before using it), `.cache/*` (media included), the `zoma-old-engines:*` images;
  - in `artifacts/`: `verify15d.log` and the older legs' logs and screenshots.

## What step 15d produced (for reference)
- **`docs/runbooks/tv-setup.md`**, sections:
  - "At a glance";
  - 1, the lab server per device;
  - 2, LG: the webOS CLI, an LG TV in Developer Mode (the session, extending it), Emulator, Simulator, webOS Studio;
  - 3, Samsung: SDK 10 or Studio 6.1, the certificate, Developer Mode, the Tizen emulator, the Web Simulator, the Remote Test Lab;
  - 4, engines by year, and what covers each;
  - 5, troubleshooting;
  - the sources table.
- **`docs/testing-without-tvs.md`:** the recommendation, a coverage table per spike, options 1–5, a comparison table, the questions for Omar at step 16, and "Could not confirm".
- **Fix:** `pnpm device install|launch tizen` passes the sdb serial with `-s`. It used `-t`, which takes the target *name*.
- **Pointers:** `tv-build.md`, `lab.md` and `tools/device` now point at tv-setup.md.

## Key facts from the research (sources in the docs; all read 2026-11-04)
- **Samsung's Remote Test Lab has TVs:**
  - 142 sets, Tizen 5.0–10.0 (2019–2026), in Suwon, Korea. Free: 20 credits a day, 1 credit = 15 min.
  - No 2018 set, no low-end set.
  - The TVs reach the internet only, so the lab needs a public server (a tunnel, or the mock's Docker image on a VPS). The lab accepts `https://host`.
  - Live list as JSON: `https://developer.samsung.com/remotetestlab/rtl/api/v1/products?os=117` (also `/faqs`, `/notices`).
- **Tizen tooling:**
  - Tizen Studio 6.1 is the last; Tizen SDK 10.0 plus the VS Code "Tizen Extension" replace it.
  - The Samsung Certificate Extension must be **≥ 2.0.74**. Our research note (docs/research/03) said 2.0.73; that note stays as a dated snapshot.
  - The Tizen TV Emulator offers only TV 10.0 (Chromium 130) and needs Intel HAXM with Hyper-V off.
- **Samsung TVs and certificates:**
  - Apps installed in Samsung Developer Mode are uninstalled when the TV is switched off: S2's update test and S3's reinstall test must not power-cycle the TV.
  - A 2018 (Tizen 4.0) TV may need a Partner-level Samsung certificate (Suitest's changelog, third party).
- **webOS tooling:**
  - The webOS Simulator: 6.0 (Chromium 79), 22, 23, 24, 25, 26. No 4.x or 5.x.
  - The webOS Emulator: 1.2–6.0 with VirtualBox 6.1; Emulator 4.0 (Chromium 53) has **no HLS**.
  - The CLI's `emulator` device is `developer@127.0.0.1:6622` with a built-in key.
- **LG Developer Mode:**
  - Up to 1,000 h by LG's forum; LG's page gives no figure.
  - Extend it from the PC: `pnpm --filter @zoma/tools-device exec ares-launch --device tv com.palmdts.devmode --params "extend=true"`.
  - When the session ends, the dev apps are uninstalled.
  - One TV per LG account.
- **Seller Office Beta Test:**
  - 2021+ TVs only. The app must be registered and approved first.
  - Public Sellers are US-only, so the GCC needs Partner status.
- **This PC:** Intel Core Ultra 7 255H, 32 GB, Hyper-V on (Docker Desktop, WSL 2).

## Gotchas and lessons
**New in leg 33** (also in memory: `iptv-research-doc-method`, `iptv-dev-toolchain`):
- **Research with three parallel agents by topic** worked: each returned facts with a URL, a quote and an "unconfirmed" list, in about 15 minutes. Spot-checking the decision-driving claims caught a wrong version (2.0.73 → 2.0.74) and a bug in our own tool.
- **Link-check every URL** in a research doc. A short Python + curl script (in `$CLAUDE_JOB_DIR/tmp`) found two dead links among 94.
  - npm and some shops answer 403 to curl (bot walls), but the pages exist.
  - Samsung's forum threads now answer 404.
  - For npm dates, use `https://registry.npmjs.org/<pkg>`.
- **JavaScript-rendered vendor pages** often have a JSON API behind them (RTL's device list). Read that instead of the page.

**From earlier legs (still true):**
- **Testing:**
  - two guards that each suffice hide each other's mutants: keep one;
  - use exact float boundaries;
  - a guard that never fires in the browser needs a pure verdict;
  - fake-clock polling grid: pick test times on the 50 ms grid;
  - a fake must separate a state change from its callback in time;
  - the runner's `CheckOutcome.ms` is wall-clock time, not the fake clock.
- **Vitest has no `__PLATFORM__` define:** keep platform branches inside functions.
- **The lab screen is full:** 12 spike rows and 11 checks per spike. A 13th spike or a 12th check needs a layout change.
- **Mutation runs:**
  - never commit or build while one is going: it edits sources in place;
  - run mutation scripts with `python -I -u`;
  - read the log's own exit line.
- **The DevTools flake** ("did not answer") on the old-engine harness: rerun the whole self-test or the CI job.
- **Playwright's Chromium (CfT 156):** HLS, H.264, MKV and 302s; no MPEG-TS, AC3/E-AC3 or in-band text; HEVC only headed.
- **The lab under `pnpm dev` shares the dev app's origin:** use `pnpm --filter @zoma/app-tv exec vite --port 5174` for a manual lab run.
- **Polyfills:** Babel picks core-js polyfills by property name. Probe each new file that reaches the app's main bundle. Lab-only code is free of the app's budget.
- **Text:**
  - the Write tool turns `\uXXXX` escapes into raw characters;
  - heredocs with quotes break: write scripts or test blocks to a file with the Write tool, then run them or `cat >>` them.
- **Waiting for CI:** a foreground Bash wait over 600 s is moved to the background. Use the Monitor command from memory `bg-watcher-memory-reap` (leg 14's, verbatim; only the PR number changes; no `<(`).
- **Code rules:** components stay hook-free; CSS uses physical properties only; TV code is `lib: ES2017`.
- **Old-engine harness:** never edit the Docker image's `RUN apt-get` line.
- **Dependencies:** new ones must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge with `gh pr merge --merge` on green CI and keep the branch;
  - check that the run's `headSha` is the PR's head first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## The 3 riskiest changes in PR #32
1. **`pnpm device install|launch tizen` now passes `-s <serial>`** instead of `-t`. It is checked only against Samsung's CLI page, because no Tizen CLI is installed here. If the real CLI on Windows disagrees, the switch is in `tools/device/src/commands.ts`.
2. **The docs recommend a Samsung route:** the Remote Test Lab plus a used 2018 set. The Remote Test Lab needs a public lab server, and a tunnel exposes the mock to the internet while it runs. Omar decides at step 16.
3. **Some runbook advice rests on forum or third-party sources:**
   - extending LG Dev Mode with `ares-launch com.palmdts.devmode -p extend=true`;
   - the 1,000 h session;
   - a Partner-level certificate for 2018 Samsung sets.

   Each is marked in the docs. Verify them on the first real TV.

## Verified vs not
- **Verified:**
  - `pnpm lint`, `pnpm typecheck` and `pnpm test` (2,403 tests in 141 files);
  - CI on PR #32: all three jobs green on the first run;
  - all 94 doc links fetched (two dead ones replaced or marked);
  - the RTL device list read live from its JSON API;
  - the key Samsung and LG claims re-read on the official pages: the CLI's `-s`/`-t`, the Simulator versions, Emulator 4.0's missing HLS, the 2.0.74 notice, the engine tables, the Beta Test rules, Suitest's prices, the model-code years.
- **Not done:**
  - any emulator or simulator run (15e);
  - any TV (16);
  - the step-16 decisions.
- **Migrations and deploys:** N/A (no backend until step 29). This was a docs step: no "press these keys" checklist.

## Open decisions and gates
- **Step 16 (in `docs/testing-without-tvs.md`, "Questions for Omar"):**
  1. **The Samsung route:**
     - (a) the Remote Test Lab plus one used 2018 set (recommended);
     - (b) the Remote Test Lab only;
     - (c) buy a 2018 and a current set.
  2. **The public lab server:** (a) a tunnel during sessions, or (b) the mock's Docker image on a VPS.
  3. **His accounts:** a Samsung account, the Samsung certificate, and an LG developer account (one per TV).
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended: it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Later, once the spikes have run on a TV:**
  - an on-screen keyboard of our own if the TV keyboards fail;
  - a mapping for webOS's PRE-CH key;
  - the app's accessibility route;
  - `supportsAudioGuidance` in the app's appinfo.json;
  - the MSE engine if webOS's native HLS has gaps (S5);
  - pre-buffered zapping only if S8 passes;
  - `requiredACG` in appinfo.json (webOS CLI 3.2.6 warns without it; a store item, step 45).
- **Later gates:** steps 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs; leg 33 was the 33rd.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks. Samsung in the GCC and Canada depends on it, and so does a GCC Beta Test (testing-without-tvs.md, option 3).
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fourteen CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: onboarding or the live screen, `?screen=hello|gallery`, `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk, the focus agreement, the lab runs (102 runs, 74 seeds);
  6. a Conventions line on UI text (`appI18n`, `zoma/no-hard-coded-text`, `isolateText`, `TextField`/`createTextEditor`);
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__`, the `throttled` project;
  8. the `build:tv` row's lab target, `pnpm device … --lab`, and the platform-globals line (`PalmServiceBridge` is webOS-adapter only);
  9. a `pnpm lab:scale` row, and the mock row's `/__lab/source` and `/__lab/guide.xml.gz`;
  10. the `Platform` calls from step 15b2 (`setScreenSaver`, `screenReader`, `speak`) and where each adapter gets them;
  11. `Platform.registerKeys()` returns a `KeyRegistration` (Tizen `registerTizenKeys` in `keys.ts`);
  12. a `pnpm lab:media` row (S5 on the generated media, in `verify:media`), the `verify:media` row now ending with it, and the mock row's `/__lab/media`;
  13. platform-tizen's AVPlay typing (`avplay.ts`) and platform-webos's `webosSelectTrack`, the `build:tv` row's new leak markers, and the lab's test doubles in `apps/tv/src/lab/fakes.ts`;
  14. **new:** the `pnpm device` row and the `build:tv` row's `.wgt` note should point at `docs/runbooks/tv-setup.md`: the Tizen SDK 10 or Studio 6.1, the Certificate Extension ≥ 2.0.74, `tizen install|run -s <serial>`.
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
