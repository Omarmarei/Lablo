# Lablo IPTV: relay leg 121 opening prompt

You are leg 121 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–119 did steps 1–32 and 33a–33c (PRs #1–#147). Three steps still wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 120 (2026-11-19) finished step 33** (telemetry), ticked with 33d:
  - **33d1, PR #148, merge commit `3832945`:** the diagnostics report's schema (`packages/protocol/src/diag.ts`) and `POST /v1/diag` (`apps/web/src/server/diag.ts`).
    - The rate limit is 5 reports an hour per caller; the body is at most 32 KB; crash stacks are scrubbed again on the server; rows are swept after 30 days.
    - The code is 6 Crockford characters, made again on a clash (up to 5 tries, then 503). The answer is 201 `{code}`.
    - **No install ID at all:** the migration `diag_report_no_install` drops `DiagReport.installId`. It is applied only to dev and test databases; nothing is in production.
  - **33d2, PR #149, merge commit `dcb81aa`:** Settings' fifth row, "Send a report to support".
    - The telemetry worker's `report` (`packages/data/src/telemetry-service.ts`) and `DataEngine.sendDiagReport`.
    - Main's `recent()` (`telemetry-state.ts`) and `diagParts` (`telemetry-events.ts`).
    - The row: `diag-report.ts`, `ReportItem` in `SettingsScreen.tsx`.
    - The `/v1/diag` stand-in in `e2e/config-server.ts`.
    - The report goes with the usage reports off too: the user asks for it, and it carries no ID.
  - **The docs commit `fc6236f`** (on the branch, not yet in main): 33d2, 33d and 33 ticked, leg 120's progress row, the merge records.
- **Leg 120 asked Omar about step 34** (`[needs Omar]`, production infrastructure). **He answered on 2026-11-19: skip step 34 for now and go on to step 35.** RELAY.md's step 34 line records it. Step 34 waits until he says the accounts and keys are ready; skip it until then.

## Read first
1. **`RELAY.md`:**
   - step 33's block, including "Checked against the code in leg 120" and 33d1/33d2's "Built" and "Verified" notes (line ~2466 on);
   - step 34 `[needs Omar]` (line ~2540);
   - step 35 onwards (Phase 9: Personalization);
   - progress row 120, the last line.
2. **`docs/architecture.md`:**
   - §3.4 "Built in step 33d1" and "Built in step 33d2" (line ~2168 on);
   - the API table and the retention line (line ~1550).
3. **`docs/runbooks/web.md`:** "Diagnostics reports (step 33d1)".
4. **`docs/runbooks/config.md`:** the key ceremony, for step 34.
5. **`CLAUDE.md`:**
   - "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails";
   - CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `fc6236f`, `dcb81aa`, `0f732bb`;
   - `origin/main` is `dcb81aa`; the branch is pushed; no PR is open;
   - no `*.mutbak`: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **Step 35: favourites and groups** (named favourites lists, hide or reorder groups, channel numbers), as Omar chose.
   - First check what exists (`packages/data/src/favourites.ts`, the profile's `favourites`, the live screen's groups), then write its shape in RELAY before building (step 26's common items). Split it into sub-steps if it is more than one leg's work, as 32 and 33 were.
   - **Watch main.js:** 9.2 KB left on Tizen, and one screen costs about 8 KB. If step 35 can't fit, propose a size pass (lazy screens, or work moved to a worker) and stop as needs-you for Omar's word: a size pass is his call.
   - **Step 34 stays deferred.** When Omar says the accounts are ready, these are his alone: the Vercel, Neon, R2 and Upstash accounts and the domain, with the keys in `.env` that he writes himself; `LABLO_RATE_SECRET` in Vercel; the config key ceremony. Then a leg writes the R2 and Upstash adapters (behind the outbound-lint exception), R2's host in the phone page's `connect-src` and the bucket's CORS rule. The first production migration and deploy each need his one-word OK. Never ask him to paste a key into the chat.

**Step 26's common items still apply to any build:**
- unit tests;
- mutation with the list written first (copy `artifacts/mutate33d2.py`; run it with `python -X utf8 -I -u`, in foreground chunks with `--to`/`--from`);
- lint of the whole repo, `pnpm typecheck`;
- `build:tv` sizes;
- `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes (run it in the background, about 30 minutes);
- `pnpm build:web` then `pnpm e2e:web` when apps/web changes;
- the PR merged on green CI;
- the docs.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, at `dcb81aa`, plus `fc6236f` (docs) and this handover's commit. Pushed. The next PR carries both.
- **`main`:** `dcb81aa` (Merge PR #149). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next` (33d1's `build:web`);
  - `dist/`: 33d2's TV build, current except a dropped `Math.floor` in the telemetry worker;
  - in `artifacts/`:
    - `mutate33d1.py` with `mutate33d1-a.log` to `-c.log`;
    - `mutate33d2.py` with `mutate33d2-a.log` to `-c.log`;
    - `unit-33d1.log`, `unit-33d2.log`, `test-web-33d1.log`, `e2e-web-33d1.log`, `e2e-33d2.log`, `e2e-33d2-xa.log`, `build-web-33d1.log`, `build-tv-33d2*.log`, `engines-33d2.log`, `lint-*.log`, `tsc-*.log`;
    - screenshots `report-settings-{en,ar}.png`, `report-settings-sent-{en,ar}.png`, `report-row-en-XA.png`;
    - the older legs' files (`babel-polys30b2.ts` is the per-file core-js probe: `pnpm exec tsx artifacts/babel-polys30b2.ts <files>`).

## Verified vs not
- **Verified in leg 120:**
  - **33d1:**
    - unit 7,466 and `test:web` 93;
    - `build:web` (`/v1/diag` listed) and `e2e:web --project=phone diag telemetry backup`;
    - lint and typecheck;
    - mutation 95 written first, 95/95 after one gap;
    - CI #148 green on the first run (web 3 m, media 11 m, verify 17 m, engines 27 m).
  - **33d2:**
    - unit 7,510, including the report in the Chromium 53 stand-in realm;
    - e2e `telemetry` (the report in en and ar) and `backup-logins-xa` (en-XA);
    - screenshots checked: five rows fit, and the code is large and left to right in Arabic;
    - lint and typecheck;
    - `build:tv`: main.js 490.8 KB Tizen (+3.6) and 478.1 KB webOS; the telemetry worker 79.3 KB (+3.6); no new core-js module in main;
    - `verify:engines` 53/68: all 26 runs;
    - mutation 88 written first, 87/87 after one equivalent and two gaps;
    - CI #149 green on the first run (web 4 m, verify 12 m, media 16 m, engines 32 m).
- **Not verified:**
  - the whole `pnpm e2e` locally (CI's verify ran it);
  - a real TV (step 21);
  - Vercel, R2, Upstash, and any production database (step 34).
- **Migrations and deploys:** `diag_report_no_install` ran on the dev and test databases only. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 120:**
- **Preact sets `translate` as a property:** `translate="no"` reads as true. Write `translate={false}`; the en-XA walk skips only untranslated data.
- **`gh pr checks` shows `pending 0` for a running job:** the time appears only when it ends. Use `gh run view <run> -R Omarmarei/Lablo --json jobs --jq '.jobs[] | [.name, .status, .startedAt] | @tsv'`.
- **A route with a low rate limit** (`diag`: 5 an hour) hits 429 inside its own test past five posts: give each post its own `x-forwarded-for`. A bounded sweep test needs rows of two different times due, or an order-by-time mutant survives. A Prisma unique clash logs as `P2002`.
- **Mutation gaps found:**
  - an edge case built from the constant it tests moves with it: pin the constant;
  - a guard tested on a state another guard already stops proves nothing (`press` after `dispose` while still sending);
  - a fixture with two equal fields (`kept === programmes`) can't tell which one the code reads.
- **Bash heredocs with Python patches broke on quoting again:** write every patch script with the Write tool into `$CLAUDE_JOB_DIR/tmp`, and read and write with `newline=""`.
- **`saveProfile` content kinds** are `live`, `movie`, `series` (not `vod`).

**From earlier legs (still true):**
- **Logins on the TV are not encrypted at rest (ADR-013).** Say "encrypted end to end whenever they leave the TV; our servers never see them".
- **Scrub in a worker, never in main.js** (`@lablo/protocol/scrub` is 25.8 KB on Chromium 53). Workers import schema-free subpaths (`telemetry-buckets`, `backup-limits`); the `@lablo/protocol` index pulls zod.
- **The dev app posts as `platform: 'browser'`:** the real API answers 400, so plain e2e uses the config server's stand-ins (telemetry, diag) and reads bodies with the server's schemas.
- **Any new background worker that writes IndexedDB** must count in the hook's `backupIdle()`. Telemetry's `setOn(false)` is awaited by its row.
- **Arabic on/off words agree with their noun.** A new switch row gets value keys of its own.
- **`editProfile` resolving `false`** means "nothing changed" or "a newer app's profile refused it".
- **Chromium refuses port 9.** Playwright's `expect.any(Number)` is not a number type.
- **Event objects in main:** plain functions, `import type` only from `@lablo/protocol`. Never read `.at` in TV code.
- **A new Settings row** shifts DOWN paths and joins the en-XA walk. Settings now has five rows (guides, sources, backup, telemetry, report).
- **Overlap works:**
  - build the next step uncommitted while a PR's CI runs, then `git merge --ff-only origin/main` with the dirty tree after the merge;
  - never push to a PR while its CI runs;
  - wait in foreground loops under ~9 minutes.
- **git:**
  - `git rev-parse --short` takes one ref per call;
  - keep absolute worktree paths and `git -C` (the Bash cwd resets to the main checkout);
  - never `-c user.email=…`;
  - `git mv` stages at once.
- **CI:**
  - a `packages/*` change runs all four jobs (about 32 minutes, engines last);
  - there is no `jq` (use `gh --jq`);
  - known flakes, rerun after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-minute cap, Chromium 53/56 DevTools start-up.
- **TV code rules:**
  - no `.sort(` in main;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread, fragments;
  - these pull polyfills: `flags`, `at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt`;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` is hook-free; UI text comes only from the catalogs.
- **Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:**
  - CI runs Node 22, this PC Node 24;
  - a bare `sleep` is blocked: use `timeout N tail -f /dev/null`;
  - `TaskStop` on `verify:engines` leaves its container behind;
  - the TV build can crash once (0xC0000005): rerun it.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34; its migration and deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Decided by Omar on 2026-11-19:** skip step 34 for now and continue with step 35.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src`, and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (it now includes `diag_report_no_install`) and deploy, each with his one-word OK.
- **Later fixes to propose (no step yet):**
  - main.js's size pass (9.2 KB left on Tizen) before Settings or personalization screens grow;
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c).
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' "Usage and crash reports" and "Send a report to support" rows;
  - a telemetry send and a report from a real TV, once step 34 has an API.

## Checks for Omar
1. **Optional click-through in the dev app** (`pnpm dev`): Settings, the fifth row "Send a report to support". Against the real API the dev app's `browser` platform is refused, so the row says "Couldn't send it". The e2e stand-in shows a code; see the screenshots `artifacts/screenshots/report-settings-sent-{en,ar}.png` in the worktree.
2. **Optional read:** RELAY.md's 33d "Checked against the code in leg 120": the report carries no ID and goes with the usage reports off.

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
