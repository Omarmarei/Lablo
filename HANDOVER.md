# Lablo IPTV: relay leg 117 opening prompt

You are leg 117 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–115 did steps 1–32 and 33a (PRs #1–#143). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 116 (2026-11-19):**
  - **33b's shape** written in RELAY.md before building, each choice with its why. Step 33b is split into:
    - 33b1: the sender and the start events;
    - 33b2: the four other events;
    - 33b3: the switch's Settings row and the consent sentence.
  - **33b1 built and merged:** PR #144, merge commit `3e00eec`, green CI on the first run (web 9 m, verify 15 m, media 30 m, engines 32 m). Ticked.
    - **`@lablo/protocol/telemetry-buckets`:** kinds, limits and buckets, schema-free. `telemetry.ts` re-exports them.
    - **The worker:** `packages/data/src/telemetry-service.ts` and `telemetry.worker.ts`, started for each send (66.2 KB of 150). It:
      - reads the profile's `telemetry: false` raw; off deletes the queue, the ID and the last capability, and posts nothing;
      - keeps the install ID in `kv` `telemetry.id`;
      - samples per install and kind (`fnv1a(id:kind)/2^32 < rate`, from the config's `telemetrySampling`);
      - queues a `capability` only when it changed (`telemetry.capability`), and keeps at most 200 events (`telemetry.queue`);
      - posts what fits in 64 KB, counted in UTF-8 bytes;
      - drops the posted events on 200, 400 and 413, and keeps them on anything else.
    - **Main:** `apps/tv/src/telemetry/telemetry-state.ts` (`createTelemetry`) holds plain events and decides when to send:
      - from the live screen on (onboarding sends nothing);
      - 60 s after the first event not yet sent, never sooner than 15 min after the last send;
      - once more 15 min after a send that left a queue;
      - once on hide;
      - `disable-app` stops it;
      - `setOn(false)` sends once after any send in progress, so the worker clears the queue and the ID.
    - **The start events:** `apps/tv/src/telemetry/telemetry-events.ts` builds `app_start` and `capability`; `main.tsx`'s `recordStart()` records them at the start screen's first frame.
    - **The profile:** `telemetry?: false`, with no version bump, and the edit `{kind: 'telemetry', on}`.
    - **The test hook:** `sendTelemetry()`; telemetry's worker counts in `backupIdle()`.
    - **e2e:** `e2e/telemetry.spec.ts` (3 tests) against the config server's new `POST /v1/telemetry` stand-in.
  - **33b2's facts** are noted under its RELAY line ("Facts found in leg 116"). Nothing is decided for it yet.
- **Next: 33b2, the four other events.** Write its shape first.

## Read first
1. **`RELAY.md`:**
   - step 33's block and "Decided in leg 115" (line ~2133);
   - 33b's split and "Decided in leg 116" (line ~2209);
   - 33b1's "Built in leg 116" and "Verified" (line ~2255);
   - the `- [ ] 33b2.` block and its "Facts found in leg 116" (line ~2289);
   - `33b3`, `33c` and `33d` (line ~2308);
   - progress row 116 (the last line).
2. **`docs/architecture.md`:** §3.4 Telemetry, "Built in step 33a" and "Built in step 33b1" (line ~2083).
3. **`docs/runbooks/web.md`:** "Telemetry (step 33a)" and "What the TV sends (step 33b1)" (line ~373).
4. **`docs/adr/ADR-013-logins-on-the-tv-unsealed.md`:** how to word logins. Never write "encrypted on the TV".
5. **The code:**
   - `apps/tv/src/telemetry/` (the state and the events, with their tests, the model for 33b2's builders);
   - `packages/data/src/telemetry-service.ts`;
   - `packages/protocol/src/telemetry.ts`: the schemas, `errorCode` and `deviceName`.
   - For 33b2's sources:
     - `packages/player/src/controller.ts` (`subscribe`, `PlayerStatus`, `StreamStats.engine`) and `engine.ts` (`PlaybackErrorKind`);
     - `apps/tv/src/player/app-player.ts` and `player-state.ts` (the mode);
     - `apps/tv/src/data/engine.ts` (`refresh`, `refreshEpg`) and `apps/tv/src/data/refresh-scheduler.ts`;
     - `packages/data/src/ingest.ts` (`IngestResult`) and `epg-ingest.ts` (`EpgOutcome`, `EpgSummary`);
     - `apps/tv/src/settings/unmatched-state.ts` (the unmatched count).
6. **`CLAUDE.md`:**
   - "Package boundaries";
   - "Chromium 53 cheat sheet";
   - "Legal guardrails": telemetry never collects URLs, hostnames, channel or VOD names, credentials or IPs.

   CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `d54fad3`, `3e00eec`, `e0b11a0`;
   - `origin/main` is `3e00eec`; the branch is pushed (`origin/relay/iptv-20261101-214120` = HEAD); no PR is open;
   - there are no `*.mutbak` files: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **33b2's shape, written in RELAY before building,** under the `- [ ] 33b2.` line, each choice with its why. Settle:
   - **`play_result`:**
     - once per play;
     - `ttffMs` from the play's start to the first frame;
     - the mode: live, VOD or catch-up;
     - the failure's `kind`: check that `PlaybackErrorKind` is the protocol's seven;
     - its `code` fitting `errorCode` (`^[A-Za-z0-9_.-]{1,64}$`);
     - `status` when the error has one;
     - the controller or the app as the place to hook in.
   - **`stall`:** a `reconnecting` that ends in `playing` (recovered) or `failed`, with its attempts.
   - **`ingest_done`:** from which results (`DataEngine.refresh` callers, `refreshEpg`'s outcomes).
     - Bytes come from `fetch.bytes`, which is `null` on a 304: count 0, or skip the event.
     - Items: the sum of `counts`, and for a guide, `kept` or `programmes`.
     - Only successful refreshes, or failed ones too (the schema has no failure field).
   - **`epg_match`:** the union across guides (the unmatched count over the live channels), and when it is recorded.
   - **Split it** if it is more than a leg (e.g. player events, then data events).
3. **Build 33b2** under step 26's common items, PR merged on green CI. Then 33b3 (the Settings row "Usage and crash reports", `telemetry.setOn`, the consent sentence en/ar, the en-XA walk, e2e en/ar, screenshots looked at), then 33c (the crash handler, scrubbed in the telemetry worker with the user's own logins), then 33d (the diagnostics report), each shape written first.
4. **After 33, step 34 is `[needs Omar]`.**

**Step 26's common items still apply:**
- unit tests;
- mutation, with the list written first (copy `artifacts/mutate33b1.py`'s runner);
- lint of the whole repo, root `tsc`, the package typechecks;
- `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes;
- `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
- a new e2e spec runs in plain `pnpm e2e` too, or in both configs for real-API specs;
- the PR merged on green CI;
- the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, one commit past `d54fad3` (this handover's), pushed. No PR open.
- **`main`:** `3e00eec` (Merge PR #144). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: 33b1's TV build, current;
  - in `artifacts/`: `mutate33b1.py` with `mutate33b1-a.log` to `-d.log`, `unit-33b1.log`, `lint-33b1.log`, `tsc-33b1.log`, `build-tv-33b1.log`, `engines-33b1.log`, `e2e-33b1.log`, `babel-polys30b2.ts` (the per-file core-js probe: `pnpm exec tsx artifacts/babel-polys30b2.ts <files>`), and the older legs' files.

## Verified vs not
- **Verified in leg 116 (33b1):**
  - unit 7,356 (+49);
  - e2e `telemetry` 3, plus `backup`, `backup-settings`, `onboarding` and `config-gate`: 26 passed;
  - the whole repo's lint, root `tsc`, and four package typechecks;
  - `build:tv`: main.js 478.6 KB Tizen (+3.9 on 474.7) and 465.9 KB webOS; the worker 66.2 KB; no new core-js module in main;
  - `verify:engines` 53/68: all 26 runs;
  - mutation: 179 written first; 178/178 after two gaps were closed and one equivalent removed;
  - CI #144 green on the first run (its `pnpm e2e` included).
- **Not verified:**
  - the whole `pnpm e2e` locally (CI ran it);
  - a real TV (step 21);
  - Vercel, R2 and Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 116:**
- **The dev app posts telemetry as `platform: 'browser'`.** The real API answers 400 and the TV drops the batch, so a real-API TV spec isn't possible. Plain e2e's stand-in reads batches with the server's schema, the platform swapped.
- **Telemetry's worker counts in the hook's `backupIdle()`.** Any new background worker that writes IndexedDB must too: every e2e wipe and the old-engine harness wait on it.
- **Writing the `profile` store from a page:** it has `keyPath: 'id'`, so use `store.put(record)` with no key argument. With a key it aborts silently and the evaluate hangs. Give such helpers `tx.onabort`.
- **A port searched in a JSON body** can match a timestamp's digits. Search the parsed strings only.
- **Event objects in main:** built by plain functions with no `@lablo/protocol` value import (`import type` only, the buckets from `@lablo/protocol/telemetry-buckets`). The object key `at` is fine; never read `.at` in TV code (it pulls a polyfill).
- **Mutation lists find dead guards:** writing 33b1's list took out fifteen. Example: `disposed` checks behind `started`, which `dispose` already ends.
- **The bg CI watcher was reaped again** under memory pressure. Check once in the foreground, then the Monitor tool with a poll loop that prints on change and exits on `completed`.
- **main.js on Tizen: 478.6 of 500 KB** (21.4 KB left). 33b2–33d record events in main: keep each builder small, and probe new files with `artifacts/babel-polys30b2.ts`.

**From earlier legs (still true):**
- **Logins on the TV are not encrypted at rest (ADR-013).** Product, store and UI text says "encrypted end to end whenever they leave the TV; our servers never see them".
- **Scrub in a worker, never in main.js:** the scrubber is 25.8 KB of polyfills on Chromium 53. 33c scrubs in the telemetry worker (66.2 KB + 25.8 fits 150). Workers import `@lablo/protocol/scrub`; the `@lablo/protocol` index pulls zod.
- **Types for a source without its login:** `StoredSource`, `StoredGuide`, `RefreshSource`. Refusal order in `DataEngine.refresh`: `needs-login` before `claim`, the blocklist after.
- **A settings page under a dialog** hands its own screen to `VirtualList`/`useZone`. A new zone row shifts DOWN paths. en-XA "cut" checks measure width only; a new screen goes into the en-XA walk.
- **Patch scripts:** written with the Write tool (`EDITS = [(path, old, new), ...]`, each old asserted once, CRLF kept) are reliable. Short Bash-heredoc python with no backslashes worked this leg. Use Edit for any line with a backslash.
- **Overlap works:** write the next step's notes uncommitted while a PR's CI runs, then `git merge --ff-only origin/main` with the dirty tree after the merge. Never push to a PR while its CI runs (a push cancels it).
- **git:** `git rev-parse --short A B` fails (one ref per call). The Bash cwd can reset to the main checkout mid-leg: keep absolute worktree paths and `git -C`. Never pass `-c user.email=…`. `git mv` stages at once.
- **CI:**
  - a protocol change runs all four jobs (about 32 min);
  - there is no `jq` (use `gh --jq`);
  - known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-min cap, Chromium 53/56 DevTools start-up;
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
  - Chromium 53 has no `Input.insertText`.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Profile versions are on-device migrations.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **33's design calls are the legs' own;** write the why for each in RELAY. Telemetry is opt-out (architecture.md §3.4), and counsel reviews that before launch. Stop as needs-you only for a real reason to change it, such as a store rule requiring opt-in.
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
  - `epg-declared-300mb`'s single-sample budget: a best-of-3 is worth proposing to Omar.
- **Steps 16, 19b and 21 wait for Omar:** Samsung, and 30–45 minutes at the LG TV. That session also covers:
  - an Arabic onboarding for the UTF-8 main.js;
  - typing a backup code;
  - a login given again on the sources screen;
  - a guide's link given again;
  - a telemetry send from a real TV, once step 34 has an API.

## Checks for Omar
1. **Nothing to click:** 33b1 has no UI yet (33b3 adds the Settings row). It is merged, not deployed.
2. **Optional read:** RELAY.md's "Decided in leg 116". One choice there is that nothing is sent before the live screen, so onboarding never sends telemetry before it has told the user about it.

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
