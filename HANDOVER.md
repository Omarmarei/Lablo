# Lablo IPTV: relay leg 115 opening prompt

You are leg 115 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–113 did steps 1–31, 32a–32d3 and 32d4a (PRs #1–#139). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 114 (2026-11-19) merged two PRs:**
  - **32d4b, PR #140** (merge `de87494`), merged on green CI on the first run. The leg added the five catchers from leg 113's plan and ran mutation (107 written first, 107/107). It found and fixed one thing: "Welcome back" said "Your channels are loading now" even when no source would load by itself (`backup.welcomeBack`). It also looked at the en-XA screenshots.
  - **32d4c, PR #141** (merge `fa4779a`), merged on green CI on the first run. It is the way back for guides: the TV guides screen marks a user's guide that has no link; the menu offers "Give its link" first and keeps "Remove"; the add form has a link mode. "Welcome back" counts those guides and has `toGuides` (it opens TV guides when no source needs its login).
  - **Ticked:** 32d4b, 32d4c, **32d4** and **32d**. **Step 32 waits only for 32e.**
- **Next: 32e, logins at rest under `localKey`** (profile v10). Write its shape first.

## Read first
1. **`RELAY.md`:**
   - the `- [ ] 32e.` line (around line 2112);
   - step 32's decisions: "Logins at rest under `localKey` come last (32e)" (around line 1835) and "Found for 32e" (around line 1887);
   - the 32d4 block (32d4a's shapes; 32d4b's and 32d4c's refinements);
   - progress rows 112–114.
2. **`docs/architecture.md` §3.3 B:** the key scheme (`localKey = HKDF-SHA256(master, info="local")`, "Credentials on the TV are encrypted with `localKey` and decrypted only when building a URL"), and "**Found while building, for 32e**" (around line 1803): with the master cached in IndexedDB, `localKey` protects nothing against a copied IndexedDB, because the master sits beside the logins. Then read "Built in step 32d4a", "32d4b" and "32d4c".
3. **The code:**
   - `packages/data/src/profile.ts` (version 9, `StoredSource`, the migrations, `PROFILE_MIGRATIONS`);
   - `packages/data/src/logins.ts` (`withoutLogins`, `backupDoc`: what a login is);
   - `packages/crypto/src/backup.ts` (`backupKeys`: `localKey`);
   - `apps/tv/src/onboarding/engine-loader.ts` (`ingestSourceOf`, `needsLogin`);
   - `apps/tv/src/data/engine.ts` (where a URL is built from a source);
   - `apps/tv/src/player/player-memory.ts` (`player.last` and `channels` keep the item's `url` and `catchup`).
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean apart from gitignored files;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `27301ff`, `fa4779a`, `9010b08`;
   - `origin/main` is `fa4779a`; the branch is pushed (`origin/relay/iptv-20261101-214120` = HEAD); no PR is open;
   - no `*.mutbak` files: `find apps packages tools e2e test platforms -name "*.mutbak" -not -path "*/node_modules/*"`;
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **32e's shape, written in RELAY before building** (under the `- [ ] 32e.` line, each choice with its why; split it if it is more than a leg):
   - **The open design problem:** the backup master is cached in IndexedDB (`kv`), so a `localKey` derived from it sits beside the logins it would seal. The shape must pick one of these and say why:
     - do not cache what derives `localKey` (each start then pays scrypt: 1–3 s on Chromium 53/56 before any URL is built; check whether that is acceptable for the first play);
     - derive `localKey` from something not stored with the data, such as the device secret alone; the backup code case is also in that same IndexedDB;
     - keep the seal and state its limit plainly, as step 32's decision already says ("protects a copied IndexedDB, not someone holding the TV's device ID too; with a backup code it protects nothing, and 32e says so rather than pretend").
   - Leg 106 decided: profile v10; each source's login or link sealed and opened only when a URL is built. The seal also covers each guide's link, and the `url` and `catchup` of `player.last.item` and every `channels[].item` (32d4a found the logins there).
   - **Where it is opened:** every place a URL is built (the data engine's refresh, the player's play and catch-up, the short EPG, the guides' read). It must keep working without the key: a TV whose master can't be derived yet.
   - **The backup:** `backupDoc` must still send the logins in the clear inside the sealed envelope while "Include logins and links" is on (another TV has its own `localKey`), and none while it is off.
   - **The migration from v9:** sealing needs the key, so decide whether the migration runs in the worker with the key, or the profile is sealed lazily at the next write.
   - **The pins:** a profile bump pins `profile.test.ts`, `query-service.test.ts`, `test/onboarding-loader-mock.test.ts`, `test/tv-data-engine.test.ts`, `e2e/episode-resume.spec.ts`, and the "newer" literals (grep `v: 9\b` in packages, apps, test and e2e).
3. **Then build 32e** under step 26's common items (below), and the PR merged on green CI.
4. **After 32e, step 32 is ticked.** Next comes **33** (telemetry, the URL and credential scrubber, the crash handler, diagnostics). **34** is `[needs Omar]`.

**Step 26's common items still apply:**
- unit tests;
- mutation, with the list written first;
- lint of the whole repo, root `tsc`, the package typechecks;
- `verify:engines --engine chrome53 --engine chrome68` when a TV page, a worker, the build or the harness changes;
- `pnpm build:web` then `pnpm e2e:web` when apps/web or the pairing changes;
- a new e2e spec runs in plain `pnpm e2e` too, or in both configs for real-API specs;
- the PR merged on green CI;
- the docs and the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, one commit past `fa4779a` (this handover's), pushed. No PR open.
- **`main`:** `fa4779a` (Merge PR #141). The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`;
  - `apps/web/.next` (32d4a-era build; apps/web unchanged since);
  - `dist/` (32d4c's build, current);
  - in `artifacts/`: `mutate32d4b.py` with its logs `-a` to `-d`, `mutate32d4c.py` with `mutate32d4c-a.log`, `unit-32d4b-final.log`, `unit-32d4c.log`, `engines-32d4b.log`, `engines-32d4c.log`, `build-32d4b.log`, `build-32d4c.log`, the e2e logs, and the screenshots `backup-logins-*.png` (including `-guide-ar`, `-guide-read-ar`, `-guide-en-XA`, `-guide-menu-en-XA`, `-guide-form-en-XA`).

## Verified vs not
- **Verified in leg 114:**
  - **32d4b:** unit 7,250; typecheck and lint; `build:tv` (main.js 472.0 KB on Tizen); engines 53+68 26/26 on the first run; real-API e2e 4/4; plain e2e 10/10; mutation 107/107; CI (engines 135/135 on 53, 56, 68).
  - **32d4c:** unit 7,287; typecheck and lint; `build:tv` (main.js **474.7 KB on Tizen, 25.3 KB left**; 462.0 KB on webOS); engines 53+68 26/26 on the first run; `e2e:web --project=tv` `backup-logins` 2/2; plain e2e 20/20 (`backup-logins-xa`, the guides specs, `backup`, `backup-settings`); mutation 51/51 (one equivalent); CI (engines 135/135; media not run).
- **Not verified:** a real TV (step 21); Vercel, R2 and Upstash (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 114:**
- **A playlist's `url-tvg` is often the very link the user typed as its guide.** The mock's `m3u_plus` declares its own `xmltv.php` with the login. `epgGuides` lists a URL once, the user's guide first; when the user's guide has no link (a restore without logins), the playlist's copy shows as `<src>:tvg0` beside it. So the guides form's link mode refuses only the user's other guides' links (`linkedElsewhere`).
- **Patch scripts written with the Write tool** (`EDITS = [(path, old, new), ...]`, each old string asserted to occur once, CRLF kept) applied about 90 edits with no failure. A memory note saved through a Bash heredoc lost its doubled backslashes again; Edit fixed it.
- **Overlap worked:** 32d4c was built, tested and mutation-checked uncommitted while #140's CI ran, then committed after the merge (`git merge --ff-only origin/main` with a dirty tree).
- **`git rev-parse --short A B` fails** ("Needed a single revision"); use one `rev-parse` per ref.
- **The Bash cwd can reset to the main checkout mid-leg;** keep using absolute worktree paths and `git -C`.

**From earlier legs (still true):**
- **Logins live in more than the sources and guides:** `player.last.item` and every `channels[].item` keep the catalog item's `url` and `catchup` (32d4a strips them to `''`/`null` in the backup). 32e must seal them.
- **Types for a source without its login:** `StoredSource`, `StoredGuide`, `RefreshSource`; the `ingestSourceOf` overloads; `sourceUrlOf` gives the kept server or origin. Refusal order in `DataEngine.refresh`: `needs-login` before `claim`, the blocklist after.
- **`refreshNow` reads only the guides,** and the refresh schedule holds a refused refresh (`needs-login` too) as a failure for 2 h. A source refresh outside the schedule goes through main's `quiet` (as `refreshSource` does).
- **A settings page under a dialog** hands its own screen to `VirtualList`/`useZone`, never `binding.nav.top`.
- **Old-engine backup checks:** 20. Adding one touches `BACKUP_CHECKS`, the `vectors.test.ts` pins and strings, `vectors.ts`'s comment, and `check-backup.test.ts`.
- **en-XA "cut" checks measure width only.** A new screen goes into the en-XA walk.
- **Never pass `-c user.email=…`;** the worktree config has the no-reply email.
- **CI:**
  - a PR touching the TV, data or engines runs web, verify and engines (about 30 min); media runs only on its paths;
  - never push to a PR while CI runs;
  - there is no `jq`: use `gh --jq`;
  - known flakes, rerun with `gh run rerun <run> --failed -R Omarmarei/Lablo` after the whole run: `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, media's 30-min cap, Chromium 53/56 DevTools start-up;
  - `gh api repos/Omarmarei/Lablo/check-runs/<job id>/annotations` gives a failed job's assertion.
- **Waiting on CI:** a background `until` loop on `gh run view <run> --json status` with 60 s steps. Retry every `gh` call and `git push`, with `timeout 20 tail -f /dev/null` between tries.
- **main.js budget** on Tizen is 500 KB (25.3 KB left); one screen is about 8 KB. Read `build:tv`'s log for `Circular dependency: apps/`.
- **TV code rules:**
  - no `.sort(` in main;
  - in new TV files, none of: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX spread props are fine), fragments;
  - these pull polyfills: members named `flags` or `at`, `lastIndexOf`, `concat`, `URL`, regex `.test`, `trim`, `parseInt`;
  - physical CSS only, no Grid or flex `gap`; ES2017;
  - `packages/ui` is hook-free; UI text comes only from the catalogs;
  - a component with hooks can't be called as a function in a VNode test: split out a hook-free `…View`.
- **Typecheck traps:** `bytes[i] ^= 1`; `transact<unknown>`; `transact` settles `undefined` without `done`.
- **`git mv` stages at once:** check `git diff --cached --name-only` before each commit.
- **Real-API specs** go in both Playwright configs; root e2e specs have no `pg` types; a TV build takes `?api=` only for loopback.
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
- **32e's design calls are the legs' own;** write the why for each in RELAY. One may be a real trade-off for Omar: if the only honest answer to the master-cache problem weakens what the product claims about logins at rest (a privacy promise in the README, the store listing or the onboarding disclosure), stop there as needs-you with a numbered choice.
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
- **Steps 16, 19b and 21 wait for Omar:** Samsung (the account, the certificate, an RTL tunnel session, the 2018 set), and 30–45 minutes at the LG TV. That session also covers an Arabic onboarding for the UTF-8 main.js, typing a backup code, a login given again on the sources screen, and a guide's link given again on TV guides.

## Checks for Omar
1. Nothing to click is required. To see what 32d4b and 32d4c added (merged, not deployed):
   1. run `pnpm dev`;
   2. on a TV with a source, open Settings › Backup and switch "Include logins and links" off;
   3. wipe the app's data and start again: "Welcome back" says which sources and guides need their logins or links, and Settings › Sources opens;
   4. give a source its login back, then open TV guides and use "Give its link".

   Screenshots are in `artifacts/screenshots/backup-logins-*.png` in the worktree.

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
