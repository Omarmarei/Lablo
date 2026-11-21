# Lablo IPTV: relay leg 127 opening prompt

You are leg 127 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–125 did steps 1–33 and 35 (PRs #1–#153).
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.
- **Leg 126 (2026-11-21) built step 35e** (Settings loaded on first open, Omar's option 1) in one go, both halves, and ran most of its gates. It stopped at the context check. **No PR yet.**
  - **The build:** the app and its test copy are split as AMD. An ES5 loader of our own sits at the top of main.js (`tools/build/src/amd-loader.ts`, Rollup's `banner`, one global `__labloDefine`) and loads `settings.js` by a `<script>` tag. `checkChunks` refuses any other shape (lazy files need only main.js). Each file goes through terser, the worker strings and the ES2016 gate. settings.js has a 150 KB budget. `APP_LAZY` (`lazy-files.ts`) fails the build if main.js holds any module of `apps/tv/src/settings/`.
  - **The app:** `apps/tv/src/lazy/` (`lazy-file.ts`, `LoadingScreen.tsx`, `lazy.css`):
    - the screen under it stays painted for the first 300 ms (`under`);
    - then a spinner;
    - a failure, or 15 s, says "Couldn't open this screen." with "Try again";
    - Back cancels.
  - **The rest of the app side:**
    - `settings/settings.ts` is the file's entry (`loadSettings`);
    - `main.tsx` keeps `settingsOptions` and calls `settings.use(...)` for open, `openSources`, `openGuides` and the guide's `map`;
    - `MappingReading` moved to `guide/`, `codeGroups` to `backup/code-groups.ts`.
  - **Sizes:** main.js went from 487.6 to **426.1 KB on Tizen** and from 474.9 to **413.4 KB on webOS**; settings.js is 66.1 KB.
  - **Decisions with their why:** in RELAY.md under 35e, "Decided in leg 126".
- **Next: finish 35e** (mutation, the rest of the gates, architecture.md, PR, merge), then step 36.

## Read first
1. **`RELAY.md` step 35e:** "Decided in leg 126", "Built in leg 126", "Verified in leg 126" and "Left for leg 127". Also the last progress row (126).
2. **`docs/adr/ADR-014-settings-loaded-on-first-open.md`**, and `docs/runbooks/tv-build.md` § "Settings load on first open".
3. **`artifacts/mutate35e.py`:** its docstring (what was left out and why) and its 85 mutants.
4. **The code:**
   - `tools/build/src/bundle.ts` (`split`, `SPLIT_OUTPUT`, `checkChunks`, `bundleIife`);
   - `tools/build/build-tv.ts` (`split`, `lazyProblems`, `stage`);
   - `apps/tv/src/lazy/lazy-file.ts`;
   - `apps/tv/src/live/LiveApp.tsx` (`LiveScreen`'s first lines).
5. **`docs/architecture.md`:** the build section (~2255) and §1.5's settings rows; both still need their 35e lines.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -5` shows this handover's commit, then `98dd70a`, `a54ed1c`, `ec43e82`, `f504519`;
   - the branch is pushed; `origin/main` is still `4adad53`;
   - there is no `*.mutbak`;
   - `docker ps` shows only `lablo-web-postgres-1`;
   - check the free memory (leg 126 started with 33.7 GB of free commit).
2. **Mutation:**
   - `python -X utf8 -I -u artifacts/mutate35e.py --check` must say 85/85;
   - then run it in foreground chunks with `MUT_TIMEOUT=60` for the unit ones (0–37, 47–81) and `MUT_TIMEOUT=200` for the e2e ones (38–46, 82–84);
   - 82–84 rebuild the webOS app: run `pnpm build:tv --skip-package` after them;
   - close the gaps with tests; mark the equivalents in the docstring with their reasons.
   - **Likely survivors:**
     - 22–23 (the constants: no test pins 300 ms or 15 s);
     - 15 (`wanted = null`);
     - 40 (LiveApp's `under`: no e2e opens the guide's "Guide channel" as the first load). If it survives, add an e2e step to `e2e/settings-loading.spec.ts`: hold the route, open the guide's details, "Guide channel", and check that `guide-screen` stays painted until the spinner (the same MutationObserver).
3. **The rest of the gates, one at a time:**
   - `pnpm test` (all), `pnpm lint` (the whole repo), `pnpm typecheck`;
   - the e2e specs that open Settings on the dev server: backup-code, backup-logins-xa, backup-settings, config-blocklist, guide-catchup-m3u, guide-matches, guide-offset, guides, home, live, pairing (`e2e/pairing-steps.ts`), telemetry, plus groups, guide-mapping, settings-loading and tv-bundle again;
   - **guard check by hand:** add a static `import { SETTINGS_ITEMS } from './settings/settings-state'` to `main.tsx`; `build:tv --target app --platform webos --skip-package` must fail naming it; then revert.
4. **Docs:** architecture.md's build section (settings.js beside main.js, its budget, ADR-014, the loader) and §1.5 (the loading screen before the settings).
5. **The PR** from `relay/iptv-20261101-214120`, merged on green CI without Omar (merge commit, keep the branch). **The three riskiest changes:**
   - the AMD split and its loader, now in every TV start path (main.js is no longer an IIFE);
   - Settings and the guide's mapping now open asynchronously through `lazy-file.ts`;
   - `build-tv.ts` fails a build that pulls a settings module into main.js.
6. **After the merge:** fast-forward the worktree, tick 35e, add a progress row, hand over. **Step 36 (channel management) comes next:** its screen goes under `apps/tv/src/settings/`, so into settings.js.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. On top of `origin/main` (`4adad53`) it has:
  - `7604709`, `74dc905`, `f504519` (leg 125's docs);
  - `ec43e82` (feat: the split and the app side);
  - `a54ed1c` (the old-engine walk's Settings steps, ADR-014, the runbooks);
  - `98dd70a` (RELAY.md 35e's state);
  - this handover's commit (docs: HANDOVER.md).
- **`main`:** `4adad53`. The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 126's full build;
  - in `artifacts/`:
    - `mutate35e.py` (not run);
    - `engines-35e.log` (39/39);
    - `build-tv-35e*.log`, `e2e-35e-*.log`;
    - `screenshots/lazy-loading-*.png`;
    - `engines/onboarding-*-settings.png`;
    - `amd-probe/` (leg 126's Rollup probe; can be deleted).

## Verified vs not
- **Verified in leg 126, not merged:**
  - `build:tv`: the sizes above; the `.ipk` holds settings.js (67,691 bytes); no `Circular dependency: apps/`;
  - unit: `tools/build` 42, `apps/tv/src/lazy` 14, settings, guide, onboarding and i18n 2,623, `tools/engines` 442;
  - typecheck; lint of the changed files;
  - e2e: guide-mapping and groups (5), settings-loading (1), tv-bundle (10);
  - `verify:engines --engine chrome53 --engine chrome56 --engine chrome68`: all 39 runs as expected, with the new Settings steps; the Arabic one on 53 was looked at.
- **Not yet:**
  - mutation;
  - the full `pnpm test` and `pnpm lint`;
  - the other e2e specs that open Settings;
  - architecture.md;
  - CI;
  - a real TV (step 21);
  - production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 126:**
- **TV-build e2e and Back:**
  - the TV builds read the platform's own key code, so a desktop Escape does nothing;
  - send Back by CDP: `Input.dispatchKeyEvent` with `windowsVirtualKeyCode` from `TV_KEYS[platform].back` (`tools/engines/src/live.ts`), as `pressBack` does in `tv-bundle.spec.ts`.
- **`page.route` does not see `file://` loads:**
  - to fail a lazy load in the built bundle, copy `dist/tv/<platform>` to `test.info().outputPath(...)` and rename settings.js there;
  - in `pnpm dev`, a route on `/src/settings/settings.ts` can hold the `import()`;
  - don't test a failed dev `import()`: Chrome caches failed module fetches.
- **`pnpm dev` loads a lazy module's CSS with it.** A main-side component must not use `settings.css` classes. The loading screen has `lazy.css`; `MappingReading` has `guide/mapping-reading.css`.
- **Rollup AMD:**
  - with `amd.autoId`, ids are file names, but dependencies are written `'./main'`, so the loader strips `./`;
  - an entry with exports gets a facade file, so `preserveEntrySignatures: false`;
  - a `banner` is in the chunk before `renderChunk`, so terser minifies it.
- **A vm "page" with core-js needs `setTimeout`/`clearTimeout`** in the sandbox (its Promise uses them): see `tools/build/test/script-page.ts`.
- **Heredoc Python patches mangled backslashes again:** write every patch script with the Write tool.
- **The size report needs no probe for the split:** `build:tv` prints main.js and settings.js separately.

**From leg 125 (still true):**
- **The per-file size probe:**
  - recreate `tools/build/src/size-probe-bundle.ts` from `bundle.ts`: `generate` gets `sourcemap: true`, and the label `probe` stores `globalThis.__probe`;
  - run `pnpm exec tsx artifacts/size35d-main.ts tizen`;
  - delete the probe file again;
  - it now needs the split's `output` filtered to the entry.
- **`tuned` stores the list on show** as the last channel's rail entry (`listHolds`).
- **Mutation:**
  - a "focus follows the row" mutant needs a failed edit to die;
  - the `GroupsPage` frames are reached by expanding a component once.
- **e2e:**
  - Home is `live/header/3`, Search `live/header/4`, Settings `live/header/5`;
  - from `live/channels/0`, UP lands on `live/header/0`.
- **CI:**
  - `rpc.test.ts:179` flake (a fixed 5 ms sleep): rerun after the whole run;
  - CI times: engines 27 min, verify 17 min, media 11 min, web 3 min.

**From earlier legs (still true):**
- **Memory:** about 80 old leg tabs hold a `claude.exe` each. Run heavy checks one at a time (mutation, then `verify:engines` alone, then e2e, then unit).
- **Mutation runners:** use `MUT_TIMEOUT` and never an outer `timeout`. Restore any `.mutbak` with `mv`.
- **A navigator click within 300 ms of an OK key is its twin and is ignored.** OK waits while the groups screens read or save.
- **An en-XA check of a shape passes for any bracketed string:** compare with another element's text for the same key.
- **`itemsByKey`** takes at most 100 keys.
- **The developer screens are only in `pnpm dev` and `dist/tv-dev`** (`STORE_SWAPS`).
- **Main-safe code:**
  - no `trim`, `.sort(`, regex `.test` or `for…of` in new main files;
  - none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, array destructuring or spread, object spread, fragments, `Promise.prototype.finally`;
  - check blank names by char code.
- **Scrub in a worker, never in main.js.** Workers import schema-free subpaths.
- **Any new background worker that writes IndexedDB** counts in `backupIdle()`.
- **Arabic on/off words agree with their noun.** Preact: write `translate={false}`.
- **Overlap:** never push to a PR while its CI runs (it cancels the run). Watch CI with a Monitor poll loop (`gh run view <run> -R Omarmarei/Lablo --json status,conclusion,jobs --jq …`).
- **git:**
  - `git rev-parse --short` takes one ref per call;
  - absolute worktree paths and `git -C`;
  - never `-c user.email=…`;
  - `git mv` stages at once.
- **CI:** no `jq` (use `gh --jq`). Known flakes, rerun after the whole run:
  - `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US;
  - `rpc.test.ts:179`;
  - media's 30-minute cap;
  - Chromium 53/56 DevTools start-up.
- **Physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free; UI text comes only from the catalogs.**
- **Smart App Control:** before every pnpm or npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22, this PC Node 24;
  - a bare `sleep` is blocked;
  - `TaskStop` on `verify:engines` leaves its container behind;
  - the TV build can crash once (0xC0000005): rerun it;
  - the Chromium 53 DevTools start-up timeout happens locally too: rerun once.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34; its migration and deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **None for 35e:** its choices are recorded in RELAY.md. The first open's wait on a real TV is unmeasured until step 21's session.
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (with `diag_report_no_install`) and deploy, each with his one-word OK.
- **Later fixes to propose (no step yet):**
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - `guide-offset.spec.ts` en-US;
  - `rpc.test.ts:179`'s fixed 5 ms sleep;
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c).
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' report rows;
  - a telemetry send and a real TV's report, once step 34 has an API;
  - the favourites star, and "Channel groups"' move mode with the TV's remote;
  - **Settings' first open on the TV** (the settings.js load: a quick open, no spinner expected).

## Checks for Omar
1. **Optional:** in `pnpm dev`, open Settings from the live header. It should open at once; the file is local.
2. **Optional look:** in the worktree, `artifacts/screenshots/lazy-loading-failed-tizen.png` (the failure screen) and `artifacts/engines/onboarding-chrome53-webos-ar-settings.png` (Settings on Chromium 53).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:**
  - about 80 old relay-leg tabs in Cursor keep a `claude.exe` each (about 40 GB committed). Please close the old leg tabs;
  - `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it too.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file).
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-six CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`;
  - 56: `git show 6235456:HANDOVER.md`.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
