# Lablo IPTV: relay leg 119 opening prompt

You are leg 119 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–117 did steps 1–32, 33a, 33b1 and 33b2 (PRs #1–#145). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 118 (2026-11-19):**
  - **33b3** built and merged: PR #146, merge commit `0d61b68`, green CI on the first run. 33b3 and **33b** are ticked (33b1–3 all merged).
    - **Settings' fourth row, "Usage and crash reports"** (`apps/tv/src/settings/telemetry-switch.ts`, `createTelemetrySwitch`; `SettingsOptions.telemetry: {engine, setOn}`; `SettingsScreen.tsx`'s `TelemetryRow`, `SettingsView`, `telemetryText`):
      - a `menuitemcheckbox`, its value "On"/"Off" beside the name (Arabic مفعّلة/متوقفة, feminine, keys of its own), a line under it;
      - OK switches it in place;
      - its value is read from the stored profile at each opening of Settings.
    - **An OK:** the profile's edit, then the profile read back (the truth: `editProfile` answers `false` for a refused edit too), then `telemetry.setOn(stored)`. "Couldn't change it. Try again." in the warning colour when the stored value isn't what was asked, or the edit failed.
    - **`Telemetry.setOn` now returns a promise:** "off" resolves after its clearing send. The row stays busy until then (OK ignored), so a second OK can't store "on" before the worker deletes the old queue and install ID.
    - **`telemetryOn(profile)`** (`telemetry-state.ts`) is shared by main's start and the row.
    - **The consent screen's note** sits under "Allow"/"Not now" (`data-testid="consent-telemetry"`, class `onboarding__note onboarding__note--after`), en and ar.
  - **33c's shape is drafted** under its RELAY line ("Facts found in leg 118" and "Shape, drafted in leg 118"). Check it against the code before building.
- **Next: 33c, the crash handler.**

## Read first
1. **`RELAY.md`:**
   - step 33's block and "Decided in leg 115" (line ~2133): the scrubber's rules and §3.4's promises;
   - 33b's "Decided in leg 116" (line ~2216): the sender, the worker's `send` and its steps;
   - 33b3's "Checked against the code in leg 118" and "Built in leg 118" (line ~2400);
   - the `- [ ] 33c.` block with its facts and draft shape (line ~2423);
   - 33d (line ~2435);
   - progress row 118 (the last line).
2. **`docs/architecture.md`:** §3.4 Telemetry (line ~2053), "Built in step 33a", "33b1", "33b2" and "33b3" (line ~2128).
3. **`docs/runbooks/web.md`:** "What the TV sends (steps 33b1, 33b2 and 33b3)" (line ~373).
4. **`docs/adr/ADR-013-logins-on-the-tv-unsealed.md`:** how to word logins. Never write "encrypted on the TV".
5. **The code for 33c:**
   - `packages/protocol/src/telemetry.ts`: the `crash` event (`where: 'main' | 'worker'`, `stack` ≤ 4,000);
   - `packages/protocol/src/scrub.ts`: `scrubText(text, known)`, its 16,000-character pre-cut, the `blob:` frame rule (`worker:<line>:<col>`);
   - `packages/data/src/telemetry-service.ts`: the worker's `send` (where crash stacks get scrubbed before the queue), `storedProfileDoc`;
   - `packages/data/src/telemetry.worker.ts` and `test/telemetry-worker-bundle.test.ts` (the 150 KB budget, the Chromium 53 stand-in realm);
   - `packages/data/src/client.ts`: each `create*Client`'s `port.onerror` (how a worker's uncaught error reaches main);
   - `apps/tv/src/data/engine.ts`: `WorkerLike.onerror`, `DataEngineOptions`;
   - `apps/tv/src/telemetry/telemetry-state.ts` (`record`) and `telemetry-events.ts` (plain event builders);
   - `apps/tv/src/main.tsx` (where `telemetry` is made, `recordStart`);
   - `e2e/telemetry.spec.ts` (`trackErrors`, `realErrors`, `expectNothingOfTheSource`, the stand-in);
   - `e2e/onboard.ts`'s `trackErrors`: specs that throw on purpose must filter their own errors.
6. **`CLAUDE.md`:**
   - "Package boundaries";
   - "Chromium 53 cheat sheet";
   - "Legal guardrails": telemetry never collects URLs, hostnames, channel or VOD names, credentials or IPs.

   CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `284f112`, `0d61b68`, `30bd9f9`;
   - `origin/main` is `0d61b68`; the branch is pushed (`origin/relay/iptv-20261101-214120` = HEAD); no PR is open;
   - there are no `*.mutbak` files: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **33c's shape:** check the draft against the code and write any change with its why, then build it under step 26's common items. The draft:
   - main records the raw text; the telemetry worker scrubs each `crash` stack with `scrubText(stack, known)` before it appends to the queue (`known`: the stored profile's links, servers, usernames, passwords, guide links and their hosts), so no unscrubbed stack is ever stored;
   - main's `error` (skip "Script error." with no detail) and `unhandledrejection`; check on Chromium 53 that core-js's `Promise` still raises `unhandledrejection` (a staged probe page, as leg 100's);
   - workers' errors through a new `DataEngineOptions.onWorkerError(message, filename, line, col)` from each worker's `onerror`, recorded with `where: 'worker'`;
   - at most 3 crashes a session, deduplicated by first line and first frame; a crash inside the handler never recorded;
   - no UI (33b3's switch and note cover crash reports);
   - the worker grows by the scrubber (about 25.8 KB, so about 92 of 150 KB): measure it.
3. **Then 33d** (the diagnostics report), its shape written first. Budget: main.js has **14.5 KB** left on Tizen (485.5 of 500), and one new screen costs about 8 KB. Keep "Send a report" small, or put its work in a worker.
4. **After 33, step 34 is `[needs Omar]`.**

**Step 26's common items still apply:**
- unit tests;
- mutation, with the list written first (copy `artifacts/mutate33b3.py`: a mutant may carry its own test commands as a 4th element; run it with `python -X utf8 -I -u`, in foreground chunks with `--to`/`--from`);
- lint of the whole repo, `pnpm typecheck` (root and every package);
- `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes;
- `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
- a new e2e spec runs in plain `pnpm e2e` too, or in both configs for real-API specs;
- the PR merged on green CI;
- the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, one commit past `284f112` (this handover's), pushed. No PR open.
- **`main`:** `0d61b68` (Merge PR #146). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: 33b3's TV build, current;
  - in `artifacts/`:
    - `mutate33b3.py` with `mutate33b3-a.log` to `-d.log`;
    - `unit-33b3.log`, `lint-33b3.log`, `tsc-33b3.log`, `build-tv-33b3.log`, `engines-33b3.log`, `e2e-33b3.log`, `e2e-33b3-settings.log`;
    - `screenshots/`: `onboarding-{en-US,ar-SA,en-XA}-consent.png`, `telemetry-settings-{on,off}-{en,ar}.png`, `telemetry-row{,-off}-en-XA.png`;
    - `babel-polys30b2.ts` (the per-file core-js probe: `pnpm exec tsx artifacts/babel-polys30b2.ts <files>`);
    - the older legs' files.

## Verified vs not
- **Verified in leg 118 (33b3):**
  - unit 7,434 (+45);
  - e2e `telemetry` (+2: Settings off clears the queue, the ID and the capability key and sends nothing; on again sends under a new ID; en and ar), `onboarding` (the note under the buttons, en and ar; the en-XA walk) and `backup-logins-xa` (the row on and off in en-XA): 18 passed; the nine other specs that walk Settings: 22 passed;
  - screenshots looked at: everything fits, nothing cut, Arabic mirrored;
  - lint and `pnpm typecheck`;
  - `build:tv`: main.js 485.5 KB Tizen (+3.9) and 472.8 KB webOS, no new core-js module;
  - `verify:engines` 53/68: all 26 runs (on the second try; the first hit the Chromium 53 DevTools start-up timeout);
  - mutation: 80 written first, 80/80 on the first run;
  - CI #146 green on the first run: web 12 m, verify 12 m, engines 32 m, media skipped.
- **Not verified:**
  - the whole `pnpm e2e` locally (CI's verify ran it);
  - a real TV (step 21);
  - Vercel, R2 and Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 118:**
- **A mutation runner printing an Arabic mutant crashes under cp1252** (`UnicodeEncodeError`) mid-run. Its `finally` restored the file, but the run stopped. Always run the runners with `python -X utf8 -I -u`.
- **Heredoc python with `'''` blocks failed to parse again** ("unexpected EOF while looking for matching `''"). Short `EDITS=[...]` heredocs with only `\n` escapes worked. Write any patch script with a multi-line string using the Write tool.
- **Arabic on/off words agree with the noun:** the backup's مفعّل/متوقف are masculine; the reports need مفعّلة/متوقفة. A new switch row gets value keys of its own.
- **`editProfile` resolving `false`** means "nothing changed" or "a newer app's profile refused it". Read the profile back when the answer matters.
- **The CI media job is skipped** when no media path changes: a TV-UI-only PR runs web, verify and engines (about 32 min, engines last).
- **Telemetry's `setOn(false)` is awaited by the Settings row:** a test that turns it off must answer the clearing send (or the row stays busy).

**From earlier legs (still true):**
- **Logins on the TV are not encrypted at rest (ADR-013).** Product, store and UI text says "encrypted end to end whenever they leave the TV; our servers never see them".
- **Scrub in a worker, never in main.js:** the scrubber is 25.8 KB of polyfills on Chromium 53. Workers import `@lablo/protocol/scrub`; the `@lablo/protocol` index pulls zod.
- **The dev app posts telemetry as `platform: 'browser'`:** the real API answers 400. Plain e2e's stand-in reads batches with the server's schema, the platform swapped. No real-API TV spec.
- **Telemetry's worker counts in the hook's `backupIdle()`.** Any new background worker that writes IndexedDB must too.
- **Telemetry events come from onboarding:** its playlist read is an `ingest_done`; a spec counting a first batch must include it.
- **Chromium refuses port 9 as unsafe** (`net::ERR_UNSAFE_PORT`, `MEDIA_ERR_SRC_NOT_SUPPORTED` at once): `e2e/telemetry.spec.ts` filters that console line.
- **Playwright's `expect.any(Number)` is an `AsymmetricMatcher`:** no `as number` in e2e (root `tsc` TS2352).
- **The player's `FakeEngine` closes a connection in 50 ms (`stopMs`).**
- **Writing the `profile` store from a page:** `store.put(record)` with no key (`keyPath: 'id'`); give such helpers `tx.onabort`.
- **A port searched in a JSON body** can match a timestamp's digits: search the parsed strings only.
- **Event objects in main:** plain functions, `import type` only from `@lablo/protocol`; the buckets from `@lablo/protocol/telemetry-buckets`. Never read `.at` in TV code.
- **A settings page under a dialog** hands its own screen to `VirtualList`/`useZone`. A new zone row shifts DOWN paths. en-XA "cut" checks measure width only; a new screen goes into the en-XA walk.
- **Overlap works:**
  - write the next step's notes uncommitted while a PR's CI runs, then `git merge --ff-only origin/main` with the dirty tree after the merge;
  - never push to a PR while its CI runs (a push cancels it);
  - a bg CI watcher can be reaped: check once in the foreground, then the Monitor tool with a poll loop that prints on change and exits when nothing is pending (re-arm it at its 30-min expiry).
- **git:**
  - `git rev-parse --short A B` fails (one ref per call);
  - keep absolute worktree paths and `git -C` (the Bash cwd can reset to the main checkout);
  - never pass `-c user.email=…`;
  - `git mv` stages at once.
- **CI:**
  - a protocol change runs all four jobs (about 32 min);
  - there is no `jq` (use `gh --jq`);
  - known flakes, rerun after the whole run (`gh run rerun <run> --failed -R Omarmarei/Lablo`): `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-min cap (read the step times first: apt and Playwright installs), Chromium 53/56 DevTools start-up;
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
- **Migrations:** nothing goes to production before step 34. Profile versions are on-device migrations.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **33's design calls are the legs' own;** write the why for each in RELAY. Telemetry is opt-out (architecture.md §3.4), and counsel reviews that before launch, including the consent note's place under the buttons. Stop as needs-you only for a real reason to change it, such as a store rule requiring opt-in.
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
  - media's 30-min cap is now mostly apt and Playwright installs: caching ffmpeg (e.g. a static build in the media cache) is worth proposing;
  - main.js's budget (14.5 KB left on Tizen): after 33, a size pass (what moves to a worker, or lazy screens) is worth proposing before step 38 adds Settings rows.
- **Steps 16, 19b and 21 wait for Omar:** Samsung, and 30–45 minutes at the LG TV. That session also covers:
  - an Arabic onboarding for the UTF-8 main.js;
  - typing a backup code;
  - a login given again on the sources screen;
  - a guide's link given again;
  - Settings' "Usage and crash reports" row (OK switches it);
  - a telemetry send from a real TV, once step 34 has an API.

## Checks for Omar
1. **Optional click-through in the dev app** (`pnpm dev`): onboarding's "Use this TV's ID for your backup?" screen now has a note under its buttons about anonymous usage and crash reports. On the live screen, Settings (the header's last button) has a fourth row, "Usage and crash reports": OK switches it between On and Off. Screenshots are in `artifacts/screenshots/` (`onboarding-*-consent.png`, `telemetry-settings-*.png`).
2. **Optional read:** RELAY.md's "Checked against the code in leg 118" for 33b3. Two of its choices:
   - the note sits under "Allow"/"Not now", so "Not now" can't read as declining the reports (counsel's opt-out review covers this placement);
   - turning reports off waits for the queue and the install ID to be deleted before the row takes another OK.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs. Claude Code reaped a background CI wait for low memory again in leg 116.
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
