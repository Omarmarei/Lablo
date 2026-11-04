# Zoma IPTV: relay leg 29 opening prompt

You are leg 29 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–27 did steps 1–15a (PRs #1–#26). Leg 6 did no project work.
- **Leg 28** split step 15b into 15b (S6) and 15b2 (S9–S11) (commit `5507bf7`) and did **15b: spike S6, scale**.
  - Commits `86ee502` (the work), `d6d42fa` (the RELAY tick) and `0790e11` (a harness fix CI asked for). PR **#27** was merged as merge commit **`7d55357`**, with the branch kept.
  - CI on `0790e11` was green: `verify` 8 m 31 s, `engines` 14 m 3 s (of its 25-minute limit), `media` 8 m 31 s.

## Your step: 15b2 (RELAY.md is the spec)
"The UI spikes (S9–S11)." **Done when:** e2e drives each screen by keys in the desktop browser and finds its records; PR merged.

1. **Check first** that none of it exists: `git log --oneline -10`; `ls apps/tv/src/lab/spikes` (today: `s0-s1.ts`, `s2-s3.ts`, `s6.ts`, `s7.ts`, `index.ts`, plus `s6.test.ts`).
2. **Split it if it is too big** for one leg, as earlier legs did: a `docs(relay)` commit that rewrites only the 15b2 entry. A natural split: S9 (Arabic) with S11 (lifecycle and accessibility), then S10 (input, the one with a key-tester screen).
3. **Read** architecture.md §5 (the S9–S11 pass criteria, the "Built in step 15a" and "Built in step 15b" sections), then `docs/runbooks/lab.md`.
4. **Ideas carried over:**
   - **S9 (Arabic):** fonts loaded and shaped (the app's Zoma Sans faces; `document.fonts`), the bidi probe (the harness's `BIDI_EXPRESSION` in `tools/engines`, and memory `iptv-bidi-old-engines`: Chromium 53/56/68 ignore FSI/PDI), what `Intl` does with `ar` (the calendar `ar-SA` picks, digits), against the app's own formatters (ADR-011).
   - **S10 (input):** a key tester that lists each platform's expected keys (the adapters' key maps and `TV_KEYS` in `tools/engines`), PRE-CH, the Magic Remote pointer (`Platform.onPointer`), Back, and the native keyboard in Arabic and English (`TextField` / `createTextEditor`). A screen where the user presses keys needs its own navigator screen (`nav.push`), `data-screen/zone/index` on its root and `showFocus`, so `RemoteDriver` can drive it.
   - **S11 (lifecycle and accessibility):** a lifecycle log (visibility, relaunch), screensaver control, Voice Guide / TTS reading the focused label. Check the Tizen and webOS docs for the exact APIs before writing them down. Any platform API goes through `Platform` in every adapter (the precedent: `deviceSecret()` in 15a); platform globals are lint errors outside their adapter.
   - **Run order:** S6 runs last on purpose (minutes on a TV). Put S9–S11 before it: `[S0, S1, S2, S3, S7, S9, S10, S11, S6]`.
   - **Keep the screen within 1920x1080:** the checks column holds about ten rows (S1 has 10, S6 7). More rows need paging or a second column.
   - **Each new check goes into four places:** `DESKTOP` in `e2e/lab.spec.ts`, `EXPECTED_STATUSES` in `tools/engines/src/lab.ts` (a unit test keeps the two equal), the end-record counts in the e2e test, and the record counts in `tools/engines/src/lab.test.ts`. A spike shows PASS if any check passes, so pure measurements report `info`.
   - **Expected console errors:** the harness's lab wait gives up 2 s after any console error except S7's refusals (`labErrorGate`, `isExpectedRefusal`). A new spike that errors on purpose must be added there.
5. **Definition of Done** (CLAUDE.md):
   - `pnpm verify`;
   - `pnpm verify:engines --self-test` (102 runs and 74 seeds today);
   - a mutation check (copy `artifacts/mutate15b.py`: vitest, e2e and engine runners);
   - a PR merged on green CI;
   - a "press these keys" checklist.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If the run on `7d55357` is red, fix it on the relay branch first. If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`. Start Docker Desktop if `docker info` fails.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation. Use `git -C`, `pnpm --dir` and absolute paths. Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 15b2, steps 15c–15e, step 16 (needs Omar), and the progress-log rows for legs 26–28.
3. `docs/runbooks/lab.md` (the lab, its records, the spikes, S6), architecture.md §5.
4. The code in `apps/tv/src/lab/`:
   - `types.ts` (Check, Spike, LabContext with the new `bootMs`, LabRecord), `runner.ts`, `reporter.ts`, `lab-state.ts`, `LabApp.tsx`;
   - `spikes/*` (S6 shows how a spike uses the app's own code and a stage over the lab: `live-stage.tsx`, `stage-probe.ts`);
   - `idb-delete.ts` (every lab database delete goes through it).
   Also `tools/engines/src/lab.ts` (the harness run) and `e2e/lab.spec.ts`.
5. Memory `iptv-zoma-lab-gotchas` (new in leg 28).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `0790e11`. It is pushed, and the tree is clean.
- **main** has `7d55357`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (the app and the lab, built from the real sources), `.cache/fixtures` (the scale fixtures), `.cache/*`, the `zoma-old-engines:*` images;
  - in `artifacts/`: `mutate15b.py` (52 mutants), `mutate15b.log`, `verify15b.log`, `engines15b.log` (the self-test), `engines15b-53.log`, `lab-scale.log`, `lab-scale.json`, `lab-scale-stage.png` (the live screen inside the lab on 20,000 channels), `lab15b/` (a screenshot script and the lab screen with S6), `engines/lab-logs/`.

## What step 15b built (for reference)
- **Mock** (`apps/mock-provider/src/lab-source.ts`):
  - `GET /__lab/source?around=<TV clock ms>`: the first active test account's M3U URL, its entry count, and the guide's URL, sizes and shift;
  - `GET /__lab/guide.xml.gz?days=D`: the `--xmltv` guide (or the generated one) moved by whole days.
  - The scale guide is dated around 2026-11-01 and an ingest keeps only the days around now, hence the move. About 4 s to prepare the 150 MB guide; the last one is kept in memory.
- **S6** (`apps/tv/src/lab/spikes/s6.ts`): the app's own `DataEngine` (`createAppDataEngine`, its three real workers inlined in the lab bundle) and live screen (`LiveApp`, mounted over the lab by `live-stage.tsx`).
  - Checks: `source`, `ingest`, `search` (six queries), `keys` (35 presses during a forced refresh, timed to the painted focus, then the refresh is cancelled), `guide`, `cold-start` (`bootMs` plus a fresh engine to painted rows), `cleanup` (deletes `zoma`).
  - Judged only at scale (200,000 entries and a static guide of at least 140 MB, `scale.ts`); against a smaller source, `info`.
  - Skips everything and deletes nothing where a source other than `lab-s6` is stored (the dev app's origin under `pnpm dev`). No URL goes into the records.
- **`pnpm lab:scale`** (`e2e/lab-scale.spec.ts`): S6 by keys on the fixtures in the desktop browser; every criterion must pass. Its Playwright project exists only for that script (or `ZOMA_LAB_SCALE=1`). Desktop numbers: ingest 1.9 s, searches ≤ 6 ms, presses ≤ 18 ms, the guide 5.2 s, cold start ~0.2 s.
- **Harness:** S6 runs on 53/56/68 (all `info`, about 8 s per lab run). `runLab` deletes the app database first and ignores S7's refusals while it waits.
- **Sizes:** lab main 195.6 KB of its own code (was 131.9); the app's main unchanged at 178.6 KB.

## Gotchas and lessons
**New in leg 28** (also saved to memory: `iptv-zoma-lab-gotchas`, `iptv-parser-test-patterns`):
- **The lab under `pnpm dev` shares the dev app's origin** and database. For a manual lab run next to dev data, start a second Vite on another port: `pnpm --filter @zoma/app-tv exec vite --port 5174`.
- **CI's Chromium 68 left an app source on the harness's `file://` origin** (local runs never did), so the harness deletes `zoma` before each lab run. A mutant removing that reset survived locally: a local survivor doesn't prove code unneeded when the trigger depends on the environment.
- **IndexedDB `deleteDatabase` right after `close()`** can fire `blocked` and then succeed. Use `idb-delete.ts`, never `onblocked` as failure (S1 once reported `deleted: false` under load).
- **A small refresh in the webOS bundle (low tier)** is paused by key presses, so it may still be running when the presses end: the e2e accepts `finished` or `cancelled`.
- **A time-gate test must advance the clock** between the ignored event and the real one, or a mutant that starts the grace early survives.
- **Python patch scripts through `python - <<'EOF'`** with an `assert old in s` helper worked all leg (quoted EOF). In non-raw Python strings write `\\.` for a regex `\.`.

**From earlier legs (still true):**
- **Perf budgets:** calibrate on CI (the 2-vCPU runner at 4x is about 2x slower than Omar's PC); keep the CDP throttle session open.
- **The `RemoteDriver` contract:** a screen root carries `data-screen`, `data-zone` and `data-index`, and its navigator goes to `showFocus`. `INTENT_KEYS.BACK` is Escape.
- **Polyfills:** Babel picks core-js polyfills by property name; probe each new file that reaches the app's main bundle (`artifacts/make-size-probe3.py`). The lab is its own bundle with its own budget.
- **The Write tool turns `\uXXXX` escapes into raw characters.** Fix them with Python `chr()` code.
- **Text arguments carry isolate marks:** compare with `stripIsolates`. Chromium 53/56/68 ignore FSI/PDI.
- **Root `test/`** can't import `@zoma/ui` or `.tsx` files.
- **Components stay hook-free;** CSS uses physical properties only; TV code is `lib: ES2017`.
- **Old-engine harness:** never edit the Docker image's `RUN apt-get` line; engine runs overwrite `artifacts/engines`; on the DevTools flake, rerun the whole self-test or the CI job.
- **The e2e mock** pins its clock to 2026-11-02 12:00 UTC (`mock({ now: Date.now })` for the real clock). Logins `U`/`P` in tests are `zoma`/`zoma-test`.
- **IndexedDB:** never `await` inside a transaction.
- **Mutation scripts** edit sources in place: run no tests, builds or Docker alongside. Run them with `python -I -u`.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge with `gh pr merge --merge` on green CI and keep the branch;
  - after `gh pr create`, wait about 30 s before reading the checks, and check that the run's `headSha` is the PR's head before merging.
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #27
1. **The lab bundle now carries the app's data engine, its three workers and the live screen**, and S6 writes and then deletes the `zoma` database in the lab's storage. On a TV that storage is the lab's own. In a desktop browser a guard stops S6 where another source is stored; if the guard were wrong, S6 would delete the dev app's data.
2. **The mock's `/__lab/source` hands out a test account's M3U URL (with its credentials) and stays on with `--no-lab-logs`.** `/__lab/guide.xml.gz` builds a 150 MB guide on request (about 4 s of CPU, 10 MB kept). Review both before the public test server (step 44): they reveal the testers' account and cost CPU per new shift.
3. **Harness:** it deletes the app database before each lab run, and its lab wait ignores S7's refusals. The engines job is at 14 of its 25 minutes.

## Verified vs not
- **Verified:**
  - S6 in desktop Chromium: dev and both bundles from `file://` (small catalog, every record checked); `pnpm lab:scale` on the 200k catalog and the 150 MB guide, every criterion passing; the live screen inside the lab looked at (screenshot);
  - S6 in Chromium 53/56/68 (local self-test: 102 runs as expected, 74 seeds; CI green);
  - `pnpm verify` (2,211 tests in 126 files, e2e 49/49); 52/52 mutants (removing the pre-lab reset survives locally; CI's first run is its proof).
- **Not done:** any real TV or emulator (15e, 16); S9–S11 (15b2); S4, S5, S8 (15c); the docs (15d). A real app relaunch with a cached catalog should be timed on the TV in step 16 too (S6's cold start is boot plus a fresh engine, not a relaunch).
- **Migrations and deploys:** N/A (no backend until step 29).
- **"Press these keys" checklist for S6 (desktop):**
  1. Run `pnpm fixtures` once (about 20 s), then `pnpm mock --catalog .cache/fixtures/catalog.json --xmltv .cache/fixtures/xmltv-150mb.xml.gz` in one terminal and `pnpm dev` in another.
  2. Open `http://localhost:5173/lab.html?server=http://127.0.0.1:8080` at 1920x1080. If S6 later says SKIP ("this origin holds the app's own data"), use the port-5174 server above instead.
  3. Press ArrowDown 6 times, to S6 (the last row), then Enter: S6 runs alone.
  4. After a few seconds the app's live screen appears over the lab, with 20,000 channels, and its focus moves by itself (S6's 35 presses). Then the lab returns.
  5. In about 20 s: S6 PASS, 7/7. Checks source, ingest, search, keys, guide and cold start PASS, with their times; cleanup INFO "deleted "zoma"".
  6. Or hands-free: `pnpm lab:scale` prints the same seven lines.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended: it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 15e** (the lab in an emulator) likely needs Omar: VirtualBox, Tizen Studio, a Samsung account. Try first whatever needs none (the webOS TV Simulator).
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate. For S6 on the TV, run the mock with the scale fixtures (runbook lab.md "S6: scale").
- **Later gates:** steps 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs; leg 28 was the 28th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Nine CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: it starts on onboarding, or on the live screen once a source is stored, with `?screen=hello` and `?screen=gallery` as developer screens, plus `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk to the live screen, the focus agreement, the lab runs (102 runs, 74 seeds);
  6. a Conventions line on UI text through `appI18n` (ADR-011), `zoma/no-hard-coded-text`, `isolateText` and `TextField`/`createTextEditor`;
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__` and the `throttled` project;
  8. the `build:tv` row's lab target and options, `pnpm device … --lab`, and the platform-globals line (`PalmServiceBridge` is webOS-adapter only);
  9. **new:** a `pnpm lab:scale` row (S6 on the fixtures; needs `pnpm fixtures`), and the mock row's `/__lab/source` and `/__lab/guide.xml.gz`.
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
