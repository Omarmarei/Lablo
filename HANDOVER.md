# Lablo IPTV: relay leg 120 opening prompt

You are leg 120 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–118 did steps 1–32, 33a and 33b (PRs #1–#146). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 119 (2026-11-19):**
  - **33c** built and merged: PR #147, merge commit `378bf30`, green CI (verify on its rerun, see below). 33c is ticked.
    - **Main** (`apps/tv/src/telemetry/crash-state.ts`, hook-free): `createCrashReporter` and `listenForCrashes(window, …)` in main.tsx, right after telemetry is made.
      - The window's `error` is recorded only when it carries the thrown value (`event.error` not null or undefined). That skips a muted "Script error." and Chromium 156's copy of a worker's error alike.
      - `unhandledrejection` is always recorded.
      - Texts read as Chrome's console does: `Uncaught <stack>`, `Uncaught (in promise) <stack>`; a worker's reads `<message>\n    at <worker>.worker.js:<line>:<col>`.
      - At most 3 a session (`CRASH_SESSION_MAX`), deduplicated by the first two lines. Main cuts at `CRASH_TEXT_MAX` 20,000, above the scrubber's 16,000 pre-cut, so the scrubber's cut decides.
      - It never throws (`try`) and never records itself (a `busy` flag). Events go through `telemetry.record` (held, dropped while off).
    - **The engine** (`apps/tv/src/data/engine.ts`): `DataEngineOptions.onWorkerError({worker, message, line, col})`, set by `watch(name, worker)` on all seven workers, after the client's own `onerror`.
      - `createAppDataEngine` (`apps/tv/src/data/workers.ts`) now requires it; the lab's S6 passes a no-op.
      - The hello screen's worker isn't watched.
    - **The telemetry worker** (`packages/data/src/telemetry-service.ts`):
      - `knownStrings(doc)`: the stored profile's links, servers, origins and logins (any version; `epgUrl` for v2/3), and each link's user, password, host and query logins, decoded too;
      - `scrubbedCrash(event, known)` runs in `enqueue` after sampling, so the queue never holds a raw stack.
    - **Not recorded, on purpose:** a worker's unhandled rejection (nothing reaches main on any engine), and `rejectionhandled`.
  - **The probe** (`artifacts/probe33c.html`, `probe33c-run.ts` for 53/56/68, `probe33c-modern.ts` for Playwright's 156) found the facts above. They are written in RELAY's 33c block and architecture.md §3.4.
  - **A CI flake fixed after the merge** (`f7e4f30`, on the branch, not yet in main): `apps/web/test/dev-blob.test.ts` overwrote a base64url signature's first character with `_`, a no-op one time in 64. It now writes a different character.
  - **33d's shape is drafted** under its RELAY line ("Facts found in leg 119", "Shape, drafted in leg 119"), with one open choice (below).
- **Next: 33d, the diagnostics report and its support code.** Check the draft against the code first.

## Read first
1. **`RELAY.md`:**
   - step 33's block and "Decided in leg 115" (line ~2141): the scrubber and §3.4's promises;
   - "Decided in leg 116" (line ~2216): the telemetry worker's `send`;
   - 33c's "Found in leg 119", "Checked against the code in leg 119" and "Built in leg 119" (line ~2435);
   - the `- [ ] 33d.` block with its facts and draft (line ~2466);
   - progress row 119 (the last line).
2. **`docs/architecture.md`:**
   - the API table (line ~1550: `POST /v1/diag`) and the retention line under it;
   - §3.4 Telemetry (line ~2053) through "Built in step 33c" (line ~2146).
3. **`docs/runbooks/web.md`:** "Telemetry (step 33a)" (line ~339) and "What the TV sends" (line ~373).
4. **`docs/adr/ADR-013-logins-on-the-tv-unsealed.md`:** how to word logins. Never write "encrypted on the TV".
5. **The code for 33d:**
   - `apps/web/prisma/schema.prisma`: `DiagReport` (already migrated in step 29a);
   - `apps/web/src/server/telemetry.ts` and `src/app/v1/telemetry/route.ts`: the pattern to copy;
   - `apps/web/src/server/pair.ts`: the Crockford code alphabet; `rate-limit.ts`;
   - `apps/web/test/telemetry.web.test.ts` and `apps/web/e2e/telemetry.spec.ts` (`pnpm e2e:web --project=phone`): the test patterns;
   - `packages/protocol/src/telemetry.ts`, `telemetry-buckets.ts`, `scrub.ts`, `index.ts`, and the package's `exports`;
   - `packages/data/src/telemetry-service.ts` (`knownStrings`, `storedProfileDoc`, `send`) and `telemetry.worker.ts`;
   - `test/telemetry-worker-bundle.test.ts` (the 150 KB budget, the Chromium 53 stand-in realm);
   - `apps/tv/src/settings/` (`settings-state.ts`'s `SETTINGS_ITEMS`, `telemetry-switch.ts`, `SettingsScreen.tsx`'s `TelemetryRow`): how 33b3 added a row;
   - `e2e/telemetry.spec.ts` and `e2e/config-server.ts` (the stand-in).
6. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails" (no URLs, hosts, channel or VOD names, credentials or IPs). CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `f7e4f30`, `378bf30`, `8ab84b4`;
   - `origin/main` is `378bf30`; the branch is pushed (`origin/relay/iptv-20261101-214120` = HEAD); no PR is open;
   - no `*.mutbak`: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **33d's shape:** check the draft against the code and write each change with its why. Decide the open choice (below), then build under step 26's common items.
   - Budget: main.js has **12.8 KB** left on Tizen (487.2 of 500); one new screen costs about 8 KB. The draft keeps main's part to a Settings row and one call, and puts the work in the telemetry worker (75.7 of 150 KB). That worker already has `kv`, the profile read, the transport and the scrubber.
   - 33d may be two legs' work (the API, then the TV). Split it as 33b was if so, and write the split in RELAY.
3. **After 33d:** tick 33 (all four merged). Step 34 is `[needs Omar]`: stop there as needs-you.

**Step 26's common items still apply:**
- unit tests;
- mutation with the list written first (copy `artifacts/mutate33c.py`: a mutant may carry its own commands as a 4th element; run with `python -X utf8 -I -u`, in foreground chunks with `--to`/`--from`);
- lint of the whole repo, `pnpm typecheck`;
- `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes;
- `pnpm build:web` then `pnpm e2e:web` when apps/web changes;
- a new e2e spec runs in plain `pnpm e2e` too, or in both configs for real-API specs;
- the PR merged on green CI;
- the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, two commits past `378bf30`: `f7e4f30` (the docs and the dev-blob fix) and this handover's. Pushed. No PR open; the next PR carries both.
- **`main`:** `378bf30` (Merge PR #147). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: 33c's TV build, current;
  - in `artifacts/`:
    - `mutate33c.py` with `mutate33c-a.log` to `-c.log`;
    - `unit-33c.log`, `lint-33c.log`, `tsc-33c.log`, `build-tv-33c.log`, `build-tv-33c-final.log`, `engines-33c.log`, `e2e-33c.log`;
    - `probe33c.html`, `probe33c-ext.js`, `probe33c-run.ts`, `probe33c-modern.ts`, `probe33c-engines.log`;
    - `babel-polys30b2.ts` (the per-file core-js probe: `pnpm exec tsx artifacts/babel-polys30b2.ts <files>`);
    - `repro-run.ts` (leg 100's old-engine page runner, the template for probes);
    - the older legs' files.

## Verified vs not
- **Verified in leg 119 (33c):**
  - unit 7,459 (+25);
  - e2e `telemetry` and `onboarding`: 18 passed, the new crash test among them;
  - lint and `pnpm typecheck`;
  - `build:tv`: main.js 487.2 KB Tizen (+1.7) and 474.4 KB webOS; the telemetry worker 75.7 KB (+9.5); no new core-js module in main; no new circular import;
  - `verify:engines` 53/68: all 26 runs on the first try. That was on the build before two type-level edits (main.js 0.1 KB smaller after them); CI's engines job ran the final build;
  - mutation: 99 written first, 98 on the first run, then 99/99;
  - CI #147: web 2 m, media 17 m, engines 32 m; verify green on its rerun (17 m).
- **Not verified:**
  - the whole `pnpm e2e` locally (CI's verify ran it);
  - the dev-blob fix in CI (`f7e4f30`: it rides with the next PR; local test 10 passed);
  - a real TV (step 21);
  - Vercel, R2 and Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 119:**
- **Python patch scripts must read and write with `newline=""`.** `open(p, "w")` on Windows turned 7 LF files into CRLF (git warns "CRLF will be replaced by LF"; lint and tests still pass). Fixed before the commit.
- **What reaches main from errors** (probe, all four engines):
  - main's errors carry their value and stack from `file://` scripts;
  - `unhandledrejection` fires with the native Promise;
  - a worker's error reaches only its `Worker` (`error: null`), except that Chromium 156 also copies it to the window;
  - a worker's rejection reaches nothing.

  Don't `preventDefault()` a worker's error: Playwright's `pageerror` would stop seeing worker errors.
- **A time field the schema takes at 0** (`epochMs`) let a `() => 0` clock survive mutation. e2e now pins event times between a `Date.now()` before the action and one after the send.
- **A line no test can reach** (main.tsx passing `onWorkerError`): make the option required in the factory's type, and give the mutant `pnpm --dir apps/tv run typecheck` as its command.
- **An unrelated CI test failing once:** look for randomness in its input before rerunning. The dev-blob 1-in-64 case is fixed.
- **Wait for `verify:engines` to finish before a mutation run:** both load the CPU, and the engines run reads `dist/`. Never rebuild `dist/` while it runs.

**From earlier legs (still true):**
- **Logins on the TV are not encrypted at rest (ADR-013).** Product, store and UI text says "encrypted end to end whenever they leave the TV; our servers never see them".
- **Scrub in a worker, never in main.js:** `@lablo/protocol/scrub` costs 25.8 KB alone on Chromium 53 (only +9.5 KB inside the telemetry worker, which shares its polyfills). Workers import subpaths; the `@lablo/protocol` index pulls zod.
- **The dev app posts telemetry as `platform: 'browser'`:** the real API answers 400. Plain e2e's stand-in reads batches with the server's schema, the platform swapped. No real-API TV spec.
- **Telemetry's worker counts in the hook's `backupIdle()`.** Any new background worker that writes IndexedDB must too.
- **Telemetry's `setOn(false)` is awaited by the Settings row:** a test that turns it off must answer the clearing send.
- **Arabic on/off words agree with their noun** (masculine مفعّل/متوقف for the backup, feminine مفعّلة/متوقفة for the reports): a new switch row gets value keys of its own.
- **`editProfile` resolving `false`** means "nothing changed" or "a newer app's profile refused it". Read the profile back when it matters.
- **Chromium refuses port 9 as unsafe** (`net::ERR_UNSAFE_PORT`).
- **Playwright's `expect.any(Number)` is an `AsymmetricMatcher`:** no `as number` in e2e.
- **Writing the `profile` store from a page:** `store.put(record)` with no key (`keyPath: 'id'`); give such helpers `tx.onabort`.
- **A port searched in a JSON body** can match a timestamp's digits: search the parsed strings only.
- **Event objects in main:** plain functions, `import type` only from `@lablo/protocol`; buckets from `@lablo/protocol/telemetry-buckets`. Never read `.at` in TV code (writing an `at:` key is fine).
- **A settings page under a dialog** hands its own screen to `VirtualList`/`useZone`. A new zone row shifts DOWN paths. A new screen goes into the en-XA walk.
- **Overlap works:**
  - write the next step's notes uncommitted while a PR's CI runs, then `git merge --ff-only origin/main` with the dirty tree after the merge;
  - never push to a PR while its CI runs (a push cancels it);
  - wait for CI in foreground loops under ~9 minutes (`timeout 10 tail -f /dev/null` between `gh pr checks` reads), or a Monitor poll loop (it expires at 30 min).
- **git:**
  - `git rev-parse --short A B` fails (one ref per call);
  - keep absolute worktree paths and `git -C` (the Bash cwd can reset to the main checkout);
  - never pass `-c user.email=…`;
  - `git mv` stages at once.
- **CI:**
  - a `packages/data` change runs all four jobs (about 32 min, engines last);
  - there is no `jq` (use `gh --jq`);
  - known flakes, rerun after the whole run (`gh run rerun <run> --failed -R Omarmarei/Lablo`): `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-min cap, Chromium 53/56 DevTools start-up;
  - `gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations` gives a failed job's assertion.
- **TV code rules:**
  - no `.sort(` in main;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX spread props are fine), fragments;
  - these pull polyfills: members named `flags` or `at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt`;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` is hook-free; UI text comes only from the catalogs.
- **Typecheck traps:** `bytes[i] ^= 1`; `transact<unknown>`; `transact` settles `undefined` without `done`.
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh`.
- **Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22; this PC runs Node 24;
  - a bare `sleep` is blocked: use `timeout N tail -f /dev/null`;
  - `TaskStop` on `verify:engines` leaves its container behind (`docker rm -f`);
  - the TV build can crash once (0xC0000005): rerun it;
  - Chromium 53 has no `Input.insertText`;
  - there is no prettier in the repo (lint covers style).

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. 33d needs no migration (`DiagReport` exists since 29a). Profile versions are on-device migrations.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **33d's open choice (the leg decides, with its why):** the report's install ID. The draft proposes that a report always carries a new random ID, never the telemetry one, so it can't be tied to telemetry rows. Because the report is the user's own explicit act, it is sent with the telemetry switch off too, and the row says what it sends. A reason to stop as needs-you would be a privacy or store rule that changes this.
- **33's design calls are the legs' own;** write the why for each in RELAY. Telemetry is opt-out (architecture.md §3.4); counsel reviews that before launch.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in the phone page's `connect-src`, and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Later UI and test fixes (no step yet):**
  - the guides screen's "read, last try failed" rows clip their third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - `epg-declared-300mb`'s single-sample budget: a best-of-3 is worth proposing to Omar;
  - media's 30-min cap is mostly apt and Playwright installs: caching ffmpeg is worth proposing;
  - main.js's budget (12.8 KB left on Tizen): after 33, a size pass (what moves to a worker, or lazy screens) is worth proposing before step 38 adds Settings rows;
  - workers' unhandled rejections aren't reported (33c): forwarding them through each worker is a possible later addition.
- **Steps 16, 19b and 21 wait for Omar:** Samsung, and 30–45 minutes at the LG TV. That session also covers:
  - an Arabic onboarding for the UTF-8 main.js;
  - typing a backup code;
  - a login given again on the sources screen;
  - a guide's link given again;
  - Settings' "Usage and crash reports" row;
  - a telemetry send (a crash included) from a real TV, once step 34 has an API.

## Checks for Omar
1. **Optional click-through in the dev app** (`pnpm dev`): there is no new UI. To see a crash report, open the console on the live screen and run `setTimeout(() => { throw new Error('test http://example.com/x?password=secret') })`, then `await window.__LABLO_TEST__.sendTelemetry()`. The batch (network panel) holds `Uncaught Error: test [url]` with its frames.
2. **Optional read:** RELAY.md's 33c "Found in leg 119" (what each Chromium does with errors) and 33d's draft. 33d's install-ID choice is noted above.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`.

  No new gap this leg.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
