# Lablo IPTV: relay leg 118 opening prompt

You are leg 118 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–116 did steps 1–32, 33a and 33b1 (PRs #1–#144). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 117 (2026-11-19):**
  - **33b2's shape** written in RELAY.md before building ("Decided in leg 117"), then built and merged: PR #145, merge commit `036f405`. Ticked.
    - **`play_result` and `stall`** come from the player controller's new option `ControllerOptions.report(PlayerReport)` (`packages/player/src/controller.ts`):
      - each play (a session, `play()` to the next `play`/`stop`) reports once: at its first frame (`ttffMs` from `play()`; a play hidden while opening restarts that clock on show) or at its give-up before one (`ttffMs: null`, the last `PlaybackError`);
      - a stall is any failure after a frame; it reports at its end: the next first frame (`recovered: true`) or the give-up (`recovered: false`), with `attempts` (the session's `attempt`). No flag: at a first frame, "had played and `attempt > 0`" is a recovered stall;
      - zaps, stops and blocklist refusals report nothing; a resume after a hide is no stall; a reporter that throws only logs.
    - **`ingest_done` and `epg_match`** come from the data engine's new option `DataEngineOptions.onRefreshed(RefreshDone)` (`apps/tv/src/data/engine.ts`), called after each catalog refresh that resolves and each EPG refresh that ran its worker.
    - **Main's builders:** `apps/tv/src/telemetry/usage-events.ts`:
      - `playEvent`: codes kept only as 1–64 of `[A-Za-z0-9_-]`, else `OTHER` (no `.`: a dotted code could be a host); an `http` status only 100–599 (`error.status ?? 0`);
      - `stallEvent` (attempts capped at 100);
      - `catalogIngestEvent` (none for a 304; `m3u-file` counts as `m3u`) and `epgIngestEvents` (`summary.programmes` as items; none for a failed guide or a 304);
      - `epgChanged`, `epgMatchEvent`, `epgMatch`;
      - `recordRefresh`: async, never throws.

      `eventMs` (round, cap at an hour) is shared from `telemetry-events.ts`.
    - **Refined while building:** `epg_match` is `rateBucket(EpgStatus.matched, Σ sources' counts.live)`, not the "Channels without a guide" walk. The walk reads every live chunk in the query worker right as the live screen opens.
    - **Wiring in `main.tsx`:** `onRefreshed: (done) => void recordRefresh(done, dataEngine(), …)` and `appPlayer({… report: (r) => telemetry.record(playerEvent(Date.now(), r))})`.
  - **33b3's shape is drafted** under its RELAY line ("Shape, drafted in leg 117 while PR #145's CI ran"). Check it against the code before building.
- **Next: 33b3, the switch's Settings row and the consent sentence.**

## Read first
1. **`RELAY.md`:**
   - step 33's block and "Decided in leg 115" (line ~2133);
   - 33b's "Decided in leg 116" (line ~2216);
   - 33b2's "Decided in leg 117", "Built in leg 117" and "Verified" (line ~2308);
   - the `- [ ] 33b3.` block with its draft shape (line ~2390);
   - 33c and 33d;
   - progress row 117 (the last line).
2. **`docs/architecture.md`:** §3.4 Telemetry, "Built in step 33b1" and "Built in step 33b2" (line ~2083).
3. **`docs/runbooks/web.md`:** "What the TV sends (steps 33b1 and 33b2)" (line ~373).
4. **`docs/adr/ADR-013-logins-on-the-tv-unsealed.md`:** how to word logins. Never write "encrypted on the TV".
5. **The code for 33b3:**
   - `apps/tv/src/settings/settings-state.ts` (`SETTINGS_ITEMS`, `createSettings`, `open`'s `onSelect`);
   - `SettingsScreen.tsx` (`SettingsPage`, `itemText`);
   - `BackupPage.tsx` and `backup-state.ts`: the switch rows to copy (`role="switch"`, `backup.on`/`backup.off`, a failed switch's notice);
   - `apps/tv/src/onboarding/OnboardingApp.tsx`'s `ConsentScreen`;
   - `apps/tv/src/i18n/en.ts` and `ar.ts` (`onboarding.*`, `settings.*`);
   - `apps/tv/src/telemetry/telemetry-state.ts` (`setOn`, `load`);
   - `packages/data/src/profile.ts` (the edit `{kind: 'telemetry', on}`);
   - `main.tsx` (where Settings gets its options, and `telemetry`);
   - `e2e/telemetry.spec.ts` (its `switchOff`, `telemetryKv`, `sendNow`, the stand-in);
   - the en-XA walk spec (grep `en-XA` in `e2e/`).
6. **`CLAUDE.md`:**
   - "Package boundaries";
   - "Chromium 53 cheat sheet";
   - "Legal guardrails": telemetry never collects URLs, hostnames, channel or VOD names, credentials or IPs.

   CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `35dfc88`, `036f405`, `75022c7`;
   - `origin/main` is `036f405`; the branch is pushed (`origin/relay/iptv-20261101-214120` = HEAD); no PR is open;
   - there are no `*.mutbak` files: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **33b3's shape:** check the draft against the code and write any change with its why, then build it under step 26's common items. The draft:
   - a fourth Settings row, "Usage and crash reports", switched in place by OK;
   - the profile's edit first, then `telemetry.setOn`;
   - a hint that changes with the value, and a failed edit's notice;
   - a note of its own on the consent screen, en and ar text proposed;
   - e2e in en and ar, the en-XA walk, screenshots looked at.
3. **Then 33c** (the crash handler, scrubbed in the telemetry worker with the user's own logins), **then 33d** (the diagnostics report), each shape written first.
4. **After 33, step 34 is `[needs Omar]`.**

**Step 26's common items still apply:**
- unit tests;
- mutation, with the list written first (copy `artifacts/mutate33b2.py`'s runner; run it in foreground chunks, `--to`/`--from`);
- lint of the whole repo, `pnpm typecheck` (root and every package);
- `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes;
- `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
- a new e2e spec runs in plain `pnpm e2e` too, or in both configs for real-API specs;
- the PR merged on green CI;
- the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, one commit past `35dfc88` (this handover's), pushed. No PR open.
- **`main`:** `036f405` (Merge PR #145). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: 33b2's TV build, current;
  - in `artifacts/`:
    - `mutate33b2.py` with `mutate33b2-a.log` to `-c.log`;
    - `unit-33b2.log`, `lint-33b2.log`, `tsc-33b2.log`, `build-tv-33b2.log`, `engines-33b2.log`, `e2e-33b2.log`;
    - `babel-polys30b2.ts` (the per-file core-js probe: `pnpm exec tsx artifacts/babel-polys30b2.ts <files>`);
    - the older legs' files.

## Verified vs not
- **Verified in leg 117 (33b2):**
  - unit 7,389 (+33);
  - `e2e/telemetry.spec.ts` 4 (one new: a playlist with a guide on the stand-in posts `ingest_done` m3u and epg and `epg_match` `50-74`; a refused play posts `play_result` `unsupported`/`MEDIA_ERR_SRC_NOT_SUPPORTED`);
  - lint and `pnpm typecheck`;
  - `build:tv`: main.js 481.6 KB Tizen (+3.0) and 468.9 KB webOS, no new core-js module;
  - `verify:engines` 53/68: all 26 runs;
  - mutation: 97 written first, 97/97 on the first run;
  - CI #145 green: web, verify and engines on the first run, media on the third.
- **Not verified:**
  - the whole `pnpm e2e` locally (CI's verify ran it);
  - a real TV (step 21);
  - Vercel, R2 and Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 117:**
- **Chromium refuses port 9 as unsafe:** a stream at `http://127.0.0.1:9/…` fails at once (`unsupported`, `MEDIA_ERR_SRC_NOT_SUPPORTED`) and logs `net::ERR_UNSAFE_PORT` to the console. `e2e/telemetry.spec.ts` filters that one line, with its reason.
- **Playwright's `expect.any(Number)` is an `AsymmetricMatcher`:** in e2e, no `as number` cast (root `tsc` TS2352). Vitest's returns `any`, so the cast is fine there.
- **The player's `FakeEngine` closes a connection in 50 ms (`stopMs`):** a zap's or a retry's next load comes 50 ms later. Count that in a time-to-first-frame test.
- **Telemetry events now come from onboarding:** its playlist read is an `ingest_done`. A spec counting a first batch must include it.
- **CI media hit its 30-minute cap twice in a row:** ffmpeg's apt install took 20 min and Playwright's 8, so `verify:media` got 2–3 min. It was green on the third attempt.
  - Read the step times (`gh run view <run> --json jobs --jq …`) before blaming the code.
  - Rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **Heredoc python broke twice again:**
  - a `\\n` became a real newline in the file;
  - a `<<'PYEOF'` script failed to parse ("unexpected EOF").

  Write patch scripts with the Write tool; use Edit for any line with a backslash.
- **Mutation lists find guards only TypeScript needs:** `status !== undefined` became `?? 0`. They also find gaps: a bad first or last character; an early `return` whose fall-through only logs.
- **The main.js budget on Tizen:** 481.6 of 500 KB (18.4 KB left). 33b3 adds a row and two strings; 33c's scrubbing goes in the telemetry worker (66.2 KB + 25.8 KB fits 150).

**From earlier legs (still true):**
- **Logins on the TV are not encrypted at rest (ADR-013).** Product, store and UI text says "encrypted end to end whenever they leave the TV; our servers never see them".
- **Scrub in a worker, never in main.js:** the scrubber is 25.8 KB of polyfills on Chromium 53. Workers import `@lablo/protocol/scrub`; the `@lablo/protocol` index pulls zod.
- **The dev app posts telemetry as `platform: 'browser'`:** the real API answers 400. Plain e2e's stand-in reads batches with the server's schema, the platform swapped. No real-API TV spec.
- **Telemetry's worker counts in the hook's `backupIdle()`.** Any new background worker that writes IndexedDB must too.
- **Writing the `profile` store from a page:** `store.put(record)` with no key (`keyPath: 'id'`); give such helpers `tx.onabort`.
- **A port searched in a JSON body** can match a timestamp's digits: search the parsed strings only.
- **Event objects in main:** plain functions, `import type` only from `@lablo/protocol`; the buckets from `@lablo/protocol/telemetry-buckets`. Never read `.at` in TV code.
- **A settings page under a dialog** hands its own screen to `VirtualList`/`useZone`. A new zone row shifts DOWN paths. en-XA "cut" checks measure width only; a new screen goes into the en-XA walk.
- **Overlap works:**
  - write the next step's notes uncommitted while a PR's CI runs, then `git merge --ff-only origin/main` with the dirty tree after the merge;
  - never push to a PR while its CI runs (a push cancels it);
  - a bg CI watcher can be reaped: check once in the foreground, then the Monitor tool with a poll loop that prints on change and exits on `completed` (re-arm it at its 30-min expiry).
- **git:**
  - `git rev-parse --short A B` fails (one ref per call);
  - keep absolute worktree paths and `git -C` (the Bash cwd can reset to the main checkout);
  - never pass `-c user.email=…`;
  - `git mv` stages at once.
- **CI:**
  - a protocol change runs all four jobs (about 32 min);
  - there is no `jq` (use `gh --jq`);
  - known flakes, rerun after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-min cap, Chromium 53/56 DevTools start-up;
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
  - `epg-declared-300mb`'s single-sample budget: a best-of-3 is worth proposing to Omar;
  - media's 30-min cap is now mostly apt and Playwright installs: caching ffmpeg (e.g. a static build in the media cache) is worth proposing.
- **Steps 16, 19b and 21 wait for Omar:** Samsung, and 30–45 minutes at the LG TV. That session also covers:
  - an Arabic onboarding for the UTF-8 main.js;
  - typing a backup code;
  - a login given again on the sources screen;
  - a guide's link given again;
  - a telemetry send from a real TV, once step 34 has an API.

## Checks for Omar
1. **Nothing to click:** 33b2 has no UI. Its events are merged, not deployed.
2. **Optional read:** RELAY.md's "Decided in leg 117" for 33b2. Two of its choices:
   - a play abandoned before its first frame reports nothing, so a zap away from a slow channel isn't counted;
   - an error code that isn't a plain token is sent as `OTHER`, so no host can pass.

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
