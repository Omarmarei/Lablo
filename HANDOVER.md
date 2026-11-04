# Zoma IPTV: relay leg 28 opening prompt

You are leg 28 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–26 did steps 1–14c (PRs #1–#25). Leg 6 did no project work.
- **Leg 27** split step 15 into 15a–15e (commit `b09edc1`) and did **15a: the Zoma Lab build and the runtime spikes S0–S3, S7**.
  - Commits `1b10f68` (the work) and `b289e7d` (the RELAY tick). PR **#26** was merged as merge commit **`abf3f82`**, with the branch kept.
  - CI on `b289e7d` was green: `verify` 7 m 33 s, `engines` 13 m 15 s (up from 10–12; the lab adds 12 runs), `media` 8 m 46 s.

## Your step: 15b (RELAY.md is the spec)
"The UI spikes (S6, S9–S11)." **Done when:** e2e drives each screen by keys in the desktop browser and finds its records; S6 runs in the desktop browser on the scale fixtures with its numbers recorded; PR merged.

1. **Check first** that none of it exists: `git log --oneline -10`; `ls apps/tv/src/lab/spikes` (today: `s0-s1.ts`, `s2-s3.ts`, `s7.ts`, `index.ts`).
2. **The step is big: split it if needed**, as earlier legs did (a `docs(relay)` commit that rewrites only the 15b entry). A natural split: S6 (scale) on its own, then S9–S11 (Arabic, input, lifecycle and accessibility).
3. **Read** architecture.md §5 (the pass criteria of S6 and S9–S11) and its new "Built in step 15a" section, then `docs/runbooks/lab.md`.
4. **Ideas carried over from 15a:**
   - **S6** needs the 200k catalog and the 150 MB gzipped guide from the mock (`pnpm fixtures`, `pnpm mock --catalog .cache/fixtures/catalog.json --xmltv …`). The lab holds no test account. Consider a mock endpoint (e.g. `/__lab/source`) that hands the lab a test source URL from the mock's own fixtures. Measure: ingest time through the real `DataEngine`, key to focus during the ingest, the guide's ingest, search ≤ 200 ms, and a cached cold start (a reload measured to the idle live screen).
   - **S9:** fonts loaded and shaped, the bidi probe (see the harness's `BIDI_EXPRESSION`), what `Intl` does with `ar` (the Hijri calendar on Chromium 53).
   - **S10:** a key tester that lists each platform's expected keys (the adapters' maps), PRE-CH, the pointer, and the native keyboard in Arabic and English. **S11:** a lifecycle log, screensaver control, Voice Guide/TTS.
   - **Keep the screen within 1920x1080.** S1's ten checks already use most of the checks column; a spike with more rows needs paging or a second column.
   - **Add each new check to all three lists:** `DESKTOP` in `e2e/lab.spec.ts`, `EXPECTED_STATUSES` in `tools/engines/src/lab.ts` (a unit test keeps the two equal) and the end-record counts in the e2e test.
5. **Definition of Done** (CLAUDE.md):
   - `pnpm verify`;
   - `pnpm verify:engines --self-test` (102 runs and 74 seeds today);
   - a mutation check (copy `artifacts/mutate15a.py`: it has vitest, e2e, e2e-bundle and engine runners);
   - a PR merged on green CI;
   - a "press these keys" checklist.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If the run on `abf3f82` is red, fix it on the relay branch first. If only `engines` is red with "DevTools … did not answer", rerun it: `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`. Start Docker Desktop if `docker info` fails.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation. Use `git -C`, `pnpm --dir` and absolute paths. Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: steps 15b–15e, step 16 (needs Omar), and the progress-log rows for legs 25–27.
3. `docs/runbooks/lab.md` (the lab: build, records, the spikes, S2's update procedure), and architecture.md §5.
4. The code in `apps/tv/src/lab/`:
   - `types.ts` (Check, Spike, LabContext, LabRecord);
   - `runner.ts`, `reporter.ts`, `lab-state.ts` and `LabApp.tsx` (the screen);
   - `spikes/*`;
   - `lab.worker.ts` with `worker-client.ts`, and `config.ts`.
   Also `tools/engines/src/lab.ts` (the harness run) and `e2e/lab.spec.ts`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, on top of `b289e7d`. It is pushed, and the tree is clean.
- **main** has `abf3f82`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (the app and the lab, rebuilt from the real sources after the mutants), `.cache/*`, the `zoma-old-engines:*` images;
  - in `artifacts/`: `mutate15a.py` (58 mutants), `verify15a.log`, `engines15a.log` (the final self-test), `engines15a-53.log`, `mutate15a.log`, `lab15a/` (a screenshot script and the lab screenshots), `engines/lab-logs/` (the harness's collected sessions).

## What step 15a built (for reference)
- **Build:** `pnpm build:tv` builds both targets (`--target app|lab`). The lab goes to `dist/tv-lab/{tizen,webos}`:
  - ids `com.zoma.iptv.lab` and `ZomaLab001.ZomaLab`;
  - `index.html` runs `native-probe.js` before the bundle;
  - `lab-config.js` sets `window.ZOMA_LAB_CONFIG`: the server (default this PC's first private IPv4 on port 8080), the version, the write test's size and auto-run;
  - the options are `--lab-server`, `--lab-version`, `--lab-write-mb` and `--lab-no-auto`;
  - the package is `dist/packages/com.zoma.iptv.lab_<v>_all.ipk`, installed with `pnpm device install|launch webos tv --lab`.
- **Dev:** `apps/tv/lab.html?server=http://127.0.0.1:8080&mb=8&auto=1`.
- **Platform:** `Platform.deviceSecret()` (new). Tizen `webapis.productinfo.getDuid()`; webOS `readLgudid()` through `lunaRequest` over `PalmServiceBridge` (`packages/platform-webos/src/luna.ts`; lint lets only the webOS adapter touch it); `null` in the browser.
- **Mock:** `/__lab/bytes`, `/__lab/echo?cors=0` and `/__lab/redirect` (`apps/mock-provider/src/lab-probes.ts`). They store nothing and stay on with `--no-lab-logs`.
- **Harness:** stages `dist/tv-lab`, starts the mock as a child process and runs both lab bundles per engine after the screens. Seed: `lab-seed-no-worker`.

## Gotchas and lessons
**New in leg 27** (also saved to memory: `iptv-engines-docker-image`, `iptv-tv-bundle-polyfills`, `iptv-old-engine-walk`):
- **A container reaching a host server:** `--add-host host.docker.internal:host-gateway`. On Docker Desktop the host server can stay on 127.0.0.1; on Linux CI it must listen on 0.0.0.0. `tools/` may not import `apps/`: start the mock as a child process and parse its port.
- **`JSON.stringify` in an adapter pulled `es.json.stringify` into main (+5 KB).** `lunaRequest` takes JSON text instead. Probe each new file that reaches main with `artifacts/make-size-probe3.py`.
- **core-js makes polyfills look native** (`Function.prototype.toString` gives `[native code]`), so record native built-ins in an inline script before the bundle.
- **Chromium 53 reports CORS refusals as console errors**, which `watchErrors` counts as uncaught: filter exactly the expected ones (`isExpectedRefusal`). `Response.redirected` is Chromium 57+.
- **A desktop browser answers some checks differently**, on purpose: S7's no-CORS checks fail, and S3 is "skip" (or "fail" in a TV bundle). The e2e test and the harness both require that.
- **A synchronous throw from an IndexedDB `put`** (an inactive transaction) rejected the whole write; catch it and report it.
- **Bash heredocs with Python patches failed again** ("unexpected EOF"). Write the patch script with the Write tool, then run it with `python -I`.
- **The relay context check fired at about 453k tokens this leg.** 15a was big: split 15b before starting.

**From earlier legs (still true):**
- **Perf budgets:** calibrate on CI (the 2-vCPU runner at 4x is about 2x slower than Omar's PC). Keep the CDP throttle session open. S6's desktop numbers are a smoke check, not the TV's.
- **The `RemoteDriver` contract:** a screen root carries `data-screen`, `data-zone` and `data-index`, and its navigator goes to `showFocus` (the lab does both). `INTENT_KEYS.BACK` is Escape.
- **Polyfills:** Babel picks core-js polyfills by property name. `new RegExp` costs about 7 KB and `.split(` about 2 KB in main. The lab is a separate bundle with its own budget.
- **The Write tool turns `\uXXXX` escapes into raw characters.** Fix them with `C:/Users/Omarm/.claude/jobs/2ceb45cf/tmp/fix_escapes.py`-style chr() code (it is gone with that job: rewrite it).
- **Text arguments carry isolate marks:** compare with `stripIsolates`. Chromium 53/56/68 ignore FSI/PDI.
- **Root `test/`** can't import `@zoma/ui` or `.tsx` files; `apps/tv/src/lab/probes.ts` is fine (no imports).
- **Components stay hook-free;** CSS uses physical properties only; TV code is `lib: ES2017`.
- **Old-engine harness:**
  - never edit the Docker image's `RUN apt-get` line;
  - engine runs overwrite `artifacts/engines`;
  - the DevTools flake: rerun the whole self-test, or the CI job.
- **The e2e mock** pins its clock to 2026-11-02 12:00 UTC. Logins are `U`/`P`.
- **IndexedDB:** never `await` inside a transaction.
- **Mutation scripts** edit sources in place, so run no tests, builds or Docker alongside. Run them with `python -I -u`.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge with `gh pr merge --merge` on green CI and keep the branch;
  - after `gh pr create`, wait about 30 s before reading the checks.
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #26
1. **`Platform` gained a required `deviceSecret()`,** and the webOS adapter now makes luna calls through `PalmServiceBridge`. Only the lab calls it today, but the backup (step 32) will key on it. The real DUID and LGUDID formats are unverified until step 16.
2. **`pnpm build:tv` now builds the lab too** (about 7 s more), and the old-engine containers get `--add-host host.docker.internal:host-gateway` with a mock child process on the host (`0.0.0.0` on Linux). The engines job went to 13 min of its 25.
3. **The mock gained `/__lab/` probes that stay on with `--no-lab-logs`.** `/__lab/redirect` only redirects to other `/__lab/` paths (no `..`), but review it before the public test server (step 44).

## Verified vs not
- **Verified:**
  - the lab in desktop Chromium (dev and both bundles from `file://`) and in Chromium 53/56/68: every check as expected, the polyfills exactly what each engine lacks (8, 6, 4), the records in the collector;
  - the seeds and the 58 mutants;
  - CI green, merged.
- **Not done:** any real TV or emulator (15e, 16); DB8 for S2 on webOS; S7's no-CORS checks on a packaged app; S6, S9–S11 (15b); S4, S5, S8 (15c); the docs (15d).
- **Migrations and deploys:** N/A (no backend until step 29).
- **"Press these keys" checklist for the lab (desktop):**
  1. Run `pnpm mock` in one terminal and `pnpm dev` in another.
  2. Open `http://localhost:5173/lab.html?server=http://127.0.0.1:8080` at 1920x1080.
  3. Press Enter on "Run all". Within seconds: S0 INFO, S1 PASS, S2 PASS, S3 SKIP, S7 FAIL (the browser blocks the no-CORS requests, as expected), and "25 records sent".
  4. ArrowDown twice: S1's ten checks on the right, all PASS.
  5. ArrowDown to S7: three FAIL ("no readable answer"), three PASS.
  6. Enter on S2: it runs alone.
  7. Escape: "Leave the lab?"; Enter on Stay.
  8. `artifacts/lab-logs/<session>.ndjson` holds the run.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended: it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 15e** (the lab in an emulator) likely needs Omar: VirtualBox, Tizen Studio, a Samsung account. Try first whatever needs none (the webOS TV Simulator).
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs; leg 27 was the 27th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Eight CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: it starts on onboarding, or on the live screen once a source is stored, with `?screen=hello` and `?screen=gallery` as developer screens, plus `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk to the live screen, the focus agreement, the lab runs (102 runs, 74 seeds);
  6. a Conventions line on UI text through `appI18n` (ADR-011), `zoma/no-hard-coded-text`, `isolateText` and `TextField`/`createTextEditor`;
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__` and the `throttled` project;
  8. **new:** the `build:tv` row's lab target and options, `pnpm device … --lab`, and the platform-globals line (`PalmServiceBridge` is webOS-adapter only).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
