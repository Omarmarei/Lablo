# Lablo IPTV: relay leg 113 opening prompt

You are leg 113 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–111 did steps 1–31 and 32a–32d3 (PRs #1–#138). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 112 (2026-11-19): 32d4a is done.** The backup without logins, on the data side. PR #139 merged as `6a3ebaa` on green CI on its first run (engines 135/135 on Chromium 53, 56 and 68). 32d4a is ticked in RELAY, and **32d4b now has its own unchecked line** (`- [ ] 32d4b.`, right after `- [x] 32d4a.`).
  - **Profile version 9.** An Xtream source without its login is `{…, account: null, base}`; an M3U one is `{…, url: null, origin}`; a guide is `{id, url: null, origin, offsetMinutes?}`. `backupLogins: false` keeps the choice.
  - **The strip and the upload.** `packages/data/src/logins.ts` holds `withoutLogins`, `backupDoc`, `linkOrigin` and `lacksLogin`. The backup worker sends `backupDoc(doc)`.
  - **The refusal.** `DataEngine.refresh(job: RefreshJob)` refuses a source without its login with `NeedsLoginError` (`code: 'needs-login'`) before anything.
  - **The guides.** `epgGuides` lists no guide without its link and no panel guide without its login.
  - **The start.** It doesn't play a last channel whose `url` is `''`.
  - **Profile edits ready for 32d4b:** `{kind: 'backupLogins', on}` and `GuideChange` `{op: 'link', id, url}`. A source's login goes back through the existing `{kind: 'source', source}` edit.

## Read first
1. **`RELAY.md`:**
   - 32d4's shape: "The way back (32d4b)", "The harness" and "Done when (32d4b)";
   - "Refined while building 32d4a (leg 112)";
   - the new `- [ ] 32d4b.` line, then 32e;
   - the progress log's rows 110–112.
2. **`docs/architecture.md` §3.3 B:**
   - "Built in step 32d4a";
   - "Built in step 32d2b" (Settings' backup page, the schedule's `hold`/`uploadNow`);
   - "Built in step 32c2" ("Welcome back", `BackupStartApp`).
3. **The code 32d4b builds on:**
   - `apps/tv/src/settings/backup-state.ts` and `BackupPage.tsx` (the second row goes there);
   - `apps/tv/src/backup/backup-start.ts` and `BackupStartApp.tsx` ("Welcome back"'s line and where its button goes);
   - `apps/tv/src/settings/sources-state.ts`, `guides-state.ts` and `SettingsScreen.tsx` (rows such a source or guide gets; today they show the kept server, unmarked);
   - `apps/tv/src/onboarding/form.ts` (`checkForm`, `normalizeLink`);
   - `apps/tv/src/data/refresh-scheduler.ts` (`refreshNow`);
   - `packages/data/src/logins.ts`;
   - `e2e/backup-api.spec.ts` (how an envelope is opened in Node).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `27e6fec`, `6a3ebaa`, `de11ddb`;
   - `origin/main` is `6a3ebaa`, and the branch is pushed (this handover's commit included);
   - no `*.mutbak` (`find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`);
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **Build 32d4b** as its shape says (UI only; the data side is done):
   - **Settings › Backup:** a second row, "Include logins and links", while the backup is on, with its line. Off sends at once (`uploadNow` inside the schedule's `hold`, as turning the backup on does) and asks nothing.
   - **"Welcome back":** after a restore with sources or guides missing their login or link, one line says so, and its button opens Settings › Sources instead of the live screen. The start reads the profile again after a restore, so count those sources there.
   - **The sources screen:** each such row is marked "Needs its login". OK opens a form:
     - an Xtream source: user name and password under the server it kept (the server editable);
     - an M3U source: the link, with its origin's host as the hint.

     The onboarding form's checks apply. "Save" writes the `source` edit, then refreshes that source (`refreshNow`). The row shows the refresh's answer; a refused login says so, and OK opens the form again.
   - **The guides screen:** each such guide is marked "Needs its link"; its form writes `GuideChange` `link`. If 32d4b is more than a leg, this part splits off as 32d4c (write the split into RELAY first).
   - **e2e** (`e2e:web`'s `tv` project, in English and Arabic): toggle off, upload, open the envelope in Node and find no login, wipe, "Welcome back" with its line, Sources, give the login again, the channels come back, and the next upload is still without it. Look at the screenshots, and walk the new rows in en-XA.
   - **The rest:** unit tests, `verify:engines --engine chrome53 --engine chrome68`, mutation with the list written first, the PR merged on green CI, architecture.md "Built in step 32d4b", then tick 32d4b and 32d4.
3. **Then 32e:** logins at rest under `localKey`, profile v10. Write its shape first. **It must seal the channels played last's `item.url` and `catchup` too** (see the gotchas).
4. **Step 26's common items still apply:**
   - unit tests;
   - mutation with the list written first;
   - the `pnpm verify` parts: lint the whole repo, the root `tsc -p tsconfig.json`, the package typechecks;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes;
   - `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
   - a new or changed e2e spec runs in plain `pnpm e2e` too;
   - the PR merged on green CI;
   - the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. It was fast-forwarded to `6a3ebaa`, then `27e6fec` (the merge record) and this handover's commit were added on top, all pushed.
- **`main`:** `6a3ebaa` (Merge PR #139). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`, built from 32d4a's code (main.js 462.7 KB on Tizen, the backup worker 136.9 KB);
  - in `artifacts/`: `mutate32d4a.py` (+ `-a/-b/-c/-d.log`), `engines-32d4a.log`, `build-tv-32d4a.log`, `typecheck-32d4a.log`, `unit-32d4a.log`, `lint-32d4a.log`, `e2e-32d4a.log`, plus earlier legs' files.

## Gotchas and lessons
**New in leg 112:**
- **Logins live in more than the sources and guides.** `player.last.item` and every `channels[].item` keep the catalog item:
  - its `url` (Xtream `/live/<user>/<password>/…`) and its `catchup.source` carry the login;
  - 32d4a strips them to `url: ''` and `catchup: null`;
  - `lastChannelOf` refuses an empty URL (the start plays nothing);
  - Home's "Recent channels" still lists the channel and plays it from the catalog by key.

  32e must seal these as well.
- **The types that carry a source without its login:**

  | Type | What it is |
  |---|---|
  | `StoredSource` (`SourceRecord \| SourceWithoutLogin`) | a stored source; read with `storedSources` |
  | `StoredGuide` (`UserGuide \| GuideWithoutLink`) | a stored guide; read with `userGuides` |
  | `RefreshSource` (`IngestSource \| LinkWithoutLogin`) | what `refresh` takes |

  `ingestSourceOf` has overloads: a `SourceRecord` gives a `LinkSource`. `sourceUrlOf` takes the login-less shapes too, giving the server or origin they kept.
- **The order of the refusals in `DataEngine.refresh`:** `needs-login` comes before `claim` (no worker, no await); the blocklist's refusal comes after it (it awaits a worker; leg 89's rule).
- **A profile bump's pins** also include `test/tv-data-engine.test.ts` (two `v: N, sources` pins), and the "newer" literals (`{ v: N+1 }`) in `profile.test.ts` and `query-service.test.ts`. 32e takes v10: grep `v: 9\b` across `packages apps test e2e tools/engines/src`.
- **The old-engine checks:**
  - `check-backup.ts` has 20 checks now: `backup.noLogins` and `backup.restoreNoLogins`, after `backup.on`.
  - `backupLeaks` is the pure leak test, with its own unit test.
  - Adding a check means: `BACKUP_CHECKS` in `tools/engines/src/vectors.ts`, its pin in `vectors.test.ts`, the "N checks, expected Node's M" and "backup worker N/N" strings in `vectors.test.ts`, the doc comment in `vectors.ts`, and the failure list in `check-backup.test.ts`.
- **Never pass `-c user.email=…` to git:** the worktree's config already has the no-reply `58913863+Omarmarei@users.noreply.github.com`.
- **The Chromium 53 DevTools start-up flake** hit the local `verify:engines` once ("DevTools … did not answer within 60000 ms"; nothing ran, no container left). Just run it again.
- **Writing catchers before the mutation list paid off:** 94/94 on the first run.

**From earlier legs (still true):**
- **CI front:**
  - A PR touching `packages/protocol`, `packages/data`, the TV or the engines runs web, verify and engines (about 30 min); media runs only when its paths change (packages/data, the parsers).
  - Never push to a PR while its CI runs. No `jq`: use `gh --jq`.
  - Known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done:
    - `auto-next.spec.ts` ar-SA `endEpisode`;
    - `epg-declared-300mb` (media);
    - media's 30-minute cap after slow ffmpeg installs (read the step times);
    - Chromium 53/56 DevTools start-up.
  - `gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations` gives a failed job's assertion.
- **Waiting on CI:** a background `until` loop on `gh run view <run> --json status` (60 s steps, 60 tries) gives one notification when the run ends; nothing in the foreground. Wrap every `gh` call and `git push` in a retry loop with `timeout 20 tail -f /dev/null` between tries.
- **Overlap:** while a PR's CI runs, write the next step's shape (uncommitted). `git merge --ff-only origin/main` after the merge works with a dirty tree; commit the shape with the merge record.
- **en-XA's stretched text** cuts long row labels: keep labels short, and add new onboarding or settings screens and rows to the en-XA walk. **The app's `t()` isolates arguments in English too:** compare with `stripIsolates`.
- **main.js is 462.7 of 500 KB on Tizen (37.3 KB left), 450.0 KB on webOS.** One onboarding screen cost about 8 KB; 32d4b adds two forms and catalog texts, so watch it. Read `build:tv`'s log for `Circular dependency: apps/` after new imports. A crypto function for main.js goes through a subpath entry point.
- **The root typecheck can't take an apps/tv module that reaches `@lablo/ui`** (TS6142): pin such constants in root tests by reading the source as text.
- **Heredoc Python:** a heredoc script with a backslash or an escaped quote gets mangled. Write such scripts to `$CLAUDE_JOB_DIR/tmp` with the Write tool, or use Edit; run them as `python -I -X utf8`.
- **Mutation gaps seen before:**
  - vary fake values so constant-return mutants die;
  - build "stopped" fixtures as the probe reads them;
  - add a same-length wrong sequence where only a count is compared;
  - a fake that rejects at once on cancel hides late-answer paths: give it a switch;
  - a guard repeated in a caller and its callee is dead in one of them.
- **Source ids restart at `s1` after a wipe:** anything that swaps the profile under a live database must drop the catalogs and guides too.
- **`ZoneSpec` is a union:** tests read `(nav.top.zone('x') as { count: number }).count`.
- **A restart test:** Playwright follows `location.replace`; the test hook is installed again by the new start.
- **A screen that switches language in `useEffect` after an async read paints a frame in the old language:** work out the locale while drawing, and set `<html lang dir>` in `useLayoutEffect`.
- **An `e2e/` spec that needs the real API goes in both configs:** `playwright.web.config.ts`'s `tv` testMatch and `playwright.config.ts`'s chromium `testIgnore`. After adding a spec, list the plain run (`pnpm exec playwright test --list | tail -1`: **159 tests**).
- **Setting the next step's work aside while a PR needs a fix:** `git diff -- <files> > artifacts/<x>.patch`, then `git apply --check -R`, `git checkout -- <files>`, fix and commit, then `git apply` it back. No stash.
- **The boot's placeholder** is a not-ready onboarding root (`data-ready="false"`). **The e2e driver reads the focus** from `#app > [data-screen]`. **The upload schedule runs** in every test that stays 60 s on the live screen; a test that deletes the database waits for `configIdle() && backupIdle()` first.
- **A constant from `@lablo/protocol`'s index pulls zod into a worker:** use `@lablo/protocol/backup-limits`.
- **TV code rules:**
  - no `Array.prototype.sort` in main;
  - none of these in new TV files: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX spread props are fine), fragments;
  - members named `flags`/`at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim` and `parseInt` pull polyfills;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` stays hook-free, and UI text comes only from the catalogs;
  - a component with a hook can't be called as a function in a VNode test: split it (a hook-free `…View` plus a small component with the hooks).
- **Typecheck traps:** `bytes[i] ^= 1` fails typecheck; `transact(...)` infers `void` (use `transact<unknown>`); `transact` settles `undefined` when `done` is never called.
- **`git mv` stages at once:** run `git diff --cached --name-only` before every commit.
- **A TV build takes `?api=` only for loopback.** The real `GET /v1/config` answers `max-age=300`. Root e2e specs have no `pg` types.
- **New ways in go through the gates:** plays through `PlayerController.play`; adds through `refusalFor` and `DataEngine.refresh` (a source without its login is refused there now). A restore is not a new way to add.
- **Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **CI runs Node 22; this PC runs Node 24.** A bare `sleep` is blocked in the foreground: use `timeout N tail -f /dev/null`. `TaskStop` on `verify:engines` leaves its container: `docker rm -f` it. The TV build can crash once (0xC0000005): run it again. Chromium 53 has no `Input.insertText`: type with `char` key events.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths, scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request`, path-filtered; commits use the no-reply email (from the repo config, not an override); no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Migrations:** nothing goes to production before step 34. Profile versions are on-device migrations, not production ones.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 112:**
  - 32d4a locally: unit 7,141 (+22); typecheck; lint of the whole repo; `build:tv`; `verify:engines --engine chrome53 --engine chrome68` 26/26 (after one 53 DevTools flake), the backup worker 20/20 (6.0 s on 53, 1.1 s on 68); `e2e/episode-resume.spec.ts`; mutation 94/94 (written first).
  - CI green on PR #139 on the first run:
    - verify 13 m 22 s, `pnpm e2e` 159 passed;
    - engines 27 m: 135/135, 92 seeded failures caught, the backup worker 20/20 (7.1 s on 53, 21.1 s on 56, 1.1 s on 68);
    - media 26 m; web 2 m.
- **Not verified anywhere:**
  - 32d4b's UI: no app screen turns the logins off yet, and nothing gives a login back;
  - a real TV reading the UTF-8 main.js;
  - the code's restore on a real TV, and typing into its re-drawn field;
  - Vercel, R2 and Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Open decisions and gates
- **32d4b–32e's design calls are the legs' own.** 32d4's shape is written in RELAY. Write the why for any refinement (32d4a's five are under "Refined while building 32d4a").
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
  - `epg-declared-300mb`'s single-sample budgets (a best-of-3 is worth proposing to Omar).
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the 2018 set;
  - 30–45 minutes at the LG TV, which also covers an Arabic onboarding (to check the UTF-8 main.js) and typing a backup code into "Use a backup code".

## Checks for Omar
1. Nothing to click this leg: 32d4a has no screen. The proof is in `artifacts/engines-32d4a.log`, on the `crypto-vectors` lines ("backup worker 20/20"), and in PR #139's CI.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held 26 GB of committed memory in legs 93–94. Please close it during relay runs.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once (the bundle is UTF-8 since 32d3a);
  - try "Use a backup code" with the TV's keyboard.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-five CLAUDE.md gaps** wait for his word. No new gap this leg.
  - 1–28: leg 51's handover (`git show d05d5fd:HANDOVER.md`);
  - 29–47: leg 86's (`git show 5fffb27:HANDOVER.md`);
  - 48–54: leg 93's (`git show 081c1ee:HANDOVER.md`);
  - 55: leg 100's (`git show e85772d:HANDOVER.md`).
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
