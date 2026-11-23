# Lablo IPTV: relay leg 142 opening prompt

You are leg 142 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–140 did steps 1–33, 35, 35e, 36, 37, 38a, 38b, 38c1, 38c2 and 38c3 (38c3 merged in PR #165 as `b52a729`).
- **Omar answered 38c4 on 2026-11-23: option 1** (the phone page knows it's a check). Recorded in RELAY.md under 38c4's shape.
- **Leg 141 (2026-11-23): 38c4 refined and built, not yet merged.** It stopped at the context limit with the gates below left.
  - `6299412`: protocol (`PAIR_PURPOSES`, statuses `match` / `no_match`, `pairStatusFits`), the web routes, the **dev-only** Prisma migration `pair_purpose`, the phone page's check form and words (en, ar), the e2e stand-in and the scripted phone.
  - `0f2b69f`: the TV. The pair worker's `open(base, purpose)`, `Pairing.check(matches, matched)` with the mismatch view, and "Use your phone" on the check's form and the pick's header (`loginOnTv`). New `e2e/parental-phone.spec.ts`.
  - `b341361`: docs (architecture.md "Built in step 38c4", RELAY 38c4's "Built in leg 141", progress row 141). Then this handover's commit.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:** `- [ ] 38c.` and 38c4: "Refined before building (leg 141)" 1–7 and "Built in leg 141" (verified, and **"Left for leg 142"**); then **38d**'s bullet and step 38's "Shape"; the last progress row (141).
2. **docs/architecture.md** §1.4 item 10, "Built in step 38c4" (~1008–1015).
3. **The mutation runner:** `artifacts/mutate38c4.py` (68 mutants, written first) and `artifacts/mutate38c4-list.md`. Gitignored, in the worktree.
4. **For 38d:** `apps/tv/src/settings/settings-state.ts` (`SETTINGS_ITEMS`, the windowed list), `SettingsScreen.tsx`, the player's stored fields (`memory.subtitleSize`, `memory.picture`, `uiTrackPreferences` in `apps/tv/src/player/app-player.ts`), and onboarding's language answer (`answerEdit`).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git -C "<wt>" log --oneline -5` shows this handover's commit, `b341361`, `0f2b69f`, `6299412` and `c106127`.
   - No `*.mutbak`.
   - `docker ps` shows `lablo-web-postgres-1`.
2. **Finish 38c4's gates** (RELAY 38c4 "Left for leg 142"):
   - **Module diff:** core-js should stay at 216 in main and 6 in settings.js. `artifacts/build-tv-38c4.log` already has the sizes: main.js 454.6 KB on Tizen, settings.js 93.4 KB.
   - **`verify:engines`:** `--engine chrome68`, then `--engine chrome53`, each alone. Run 53 in the background (its stuck database delete can pass 595 s).
   - **Mutation:**
     - First `python -X utf8 -I -u artifacts/mutate38c4.py --clean --fast` (unit commands only), then a plain `--clean` for the e2e commands.
     - Then foreground chunks with `MUT_TIMEOUT=300`, for example `--from 1 --to 22` and `--from 26 --to 31`.
     - The TV e2e mutants each get a small chunk of their own: 32, 48, 63, 64, 67, 68.
     - Mutants 23–25 each run `pnpm build:web` and then the phone e2e. Run each alone (several minutes each), then `pnpm build:web` once after.
     - Restore any `.mutbak` with `mv`.
   - **Open the PR** to `main`; CI runs the full `pnpm test`. Merge on green CI (merge commit, keep the branch) after naming the three riskiest changes:
     - the `PairSession.purpose` migration (dev only; production waits for step 34);
     - the status route's new 400 for a status that doesn't fit the session;
     - `PAIR_STATUSES` widened, so the phone's and the TV's status lists grew.
   - Then tick 38c4 and 38c (all four sub-steps done), add a progress row, and commit.
3. **38d** (the complete settings screen: the order, "Player", "Language", e2e paths by id), as RELAY says. It may split at "Player".

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed: `origin/main` (`b52a729`) plus `6ce1a94`, `eb59c9a`, `c106127`, `6299412`, `0f2b69f`, `b341361` and this handover's commit.
- **No open PR.** The main checkout was not touched.
- **The dev database** (`lablo-web-postgres-1`, the `.env` database) has migration `20261123160000_pair_purpose` applied. The test databases are migrated fresh by their global setups.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`;
  - `apps/web/.next` (built in leg 141 with 38c4's web code);
  - `dist/` (38c4's `build:tv`);
  - in `artifacts/`: `mutate38c4.py`, `mutate38c4-list.md`, `build-tv-38c4.log`, `build-web-38c4.log`, `lint-38c4.log`, `typecheck-38c4.log`, `e2e-38c4-{a..f}.log`, `e2e-38c4-phone.log`, `e2e-38c4-web-tv.log`;
  - screenshots `artifacts/screenshots/phone-check-{form-en,form-ar,match-en,no-match-ar}.png` and `parental-phone-{code-en,mismatch-en,pick-ar,code-ar,pick-en-XA,mismatch-en-XA}.png`.

## Verified vs not
- **Verified in leg 141:**
  - lint; typecheck;
  - unit tests of the changed files: protocol 21, `pair.web.test.ts` 35, the phone page's 4 files 297, stand-in + pair-server 21, `pair-service` 46, the TV's i18n/settings/pairing/data/onboarding folders 3,244, `tools/engines/src/pairing.test.ts` 26;
  - e2e:
    - `phone.spec.ts` + `phone-file.spec.ts`: 12;
    - `parental-phone.spec.ts`: 3 (en, ar, en-XA);
    - parental-login, pairing, parental-first-pin, parental-settings and parental all passed (pairing and first-PIN with 2 workers, see the gotchas);
    - the web-backed tv project: 13;
  - `build:tv`: main.js 454.6 KB on Tizen (+1.1), 441.9 KB on webOS, settings.js 93.4 KB, query worker 148.5 KB (unchanged), pair worker 143.2 KB;
  - the migration is on the dev database (`prisma migrate diff` shows no drift);
  - screenshots looked at.
- **Not yet:**
  - 38c4's module diff, engines, mutation, the full unit suite (the PR's CI) and the merge;
  - 38d;
  - production (step 34);
  - the PIN prompt and the phone check on a real TV (step 21's session).
- **Migrations and deploys:** `pair_purpose` is on the local dev database only (no lasting effect anywhere). Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 141:**
- **The profile keeps onboarding's language.** A `restartWith(page, …, '/?locale=ar-SA')` after an en-US onboarding still shows English. Onboard in the language you test. en-XA is the exception: onboard in en-US, then restart in en-XA, which works.
- **This PC is loaded by other sessions** (about 30 Claude processes, 8 GB free). At the default worker count, 8 pairing and first-PIN tests hit their 30 s limit, with onboarding never becoming ready. Each passes alone in about 14 s. Use `--workers=2` locally for those specs; CI decides.
- **`build:tv` took over 10 minutes locally** (the lab and dev bundles after main). `timeout 590` didn't stop it; the tool moved it to the background. Start it with `run_in_background` and wait for the notice.
- **Bash heredocs carrying python with `\"` failed again** ("unexpected EOF while looking for matching `''`"). Write every patch script with the Write tool.
- **A `cd` in any Bash call moves the session's working directory** (a `cd /d` reset it to the main checkout). Never `cd`.
- **The stand-in's `StandInSession` now has `purpose`.** A test literal of one needs it (`tools/engines/src/pairing.test.ts`).
- **The pairing's check mode pops itself on a match, then calls `matched`.** `pin-check`'s wrapper closes the form (`LoginForm.close()`, only when it shows) and the pick, then goes on. Its status retries stop when the screen closes (as an add's do).
- **A check's QR link is longer** (`&p=check`, 8 more characters): the QR code can be version 6 on a 5-digit local port. An add's link and the e2e's version-5 assertion are unchanged.
- **The phone page's check form** comes from `Target.purpose`, which is the fragment's on the QR path and the key answer's on the typed path. `checkFor` drops the guide links and the name.
- **New e2e ids:**
  - `source-login/actions/1` is "Use your phone" on the check's form (Cancel moves to `/2` there);
  - `pin-pick/header/0` is the pick's "Use your phone";
  - `pair` has `data-purpose`, and `pair-mismatch` is the mismatch line;
  - helpers: `phonePurpose(origin, code)` in `tools/engines/src/pair-phone.ts`; the web e2e `tv('check')` fixture (its `qrPath` adds `&p=check`).

**From legs 130–140 (still true):**
- **The mock's panel gives the done screens a PIN prompt** (its 18+ group is locked and no PIN is set). The shared steps take "Later": `toStartButton` and `closeDone`. Onboarding has its own pad.
- **`LoadResult` is compared whole in the root tests** (`test/onboarding-loader-mock.test.ts`, `test/tv-data-engine.test.ts`): grep the root `test/` too when a shared type changes.
- **With two sources the live rail is windowed:** check for the `open <group>` chip, not the last chip.
- **Don't restart a reaped background `pnpm test` unasked;** the PR's verify job runs the full suite (read its count from the job log).
- **A random property failing on CI in untouched code can be a real bug:** reproduce it, fix it, and pin it with a fixed case.
- **A change under `packages/protocol` brings in the media job.** `epg-declared-300mb` may fail once or twice. Rerun with `gh run rerun <run> --failed` only after the whole run is done.
- **Mutation chunks:** an e2e mutant takes about 60 s. Keep them out of the big chunks.
- **Send the deciding key and BACK in separate `press` calls.**
- **The check's screens from the rail paint on a blank settings page.**
- **e2e profile tricks:** `restartWith(page, { sources: [...] })`, `storedSources`, `ordered` / `allOrdered`, `ADULT_OPEN`, `pinFields`, and the steps in `e2e/parental-steps.ts`.
- **Chromium 53's stuck database delete:** rerun `--engine chrome53` alone, in the background.
- **Sizes:** main.js has a 500 KB hard budget on Tizen (454.6 KB now). The query worker has 1.5 KB left. The pair worker is at 143.2 of 150 KB.
- **CI:**
  - a run takes about 30 min;
  - known flakes: `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes;
  - there is no `jq` in Git Bash (use `gh --jq`);
  - wait with a Monitor poll on `gh pr checks <n> --json name,bucket`.
- **e2e paths:** Settings is `live/header/5`. Its rows: Sources 1, "Channel groups" 5, "Channels" 6, "Parental control" 7. 38d moves the paths to ids.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread, no fragments;
  - no `Promise.prototype.finally`.
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Run heavy checks one at a time.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34. Its migrations (now including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Leg 141's choices** (Omar may overrule; each is small to change):
  - a check's code view keeps the add's steps under its own title (the phone page explains the check);
  - a phone match's status retries stop when the pairing screen closes;
  - the pick's intro still speaks of typing a login.
- **Earlier legs' choices stand** (38b, 38c1, 38c2, 38c3; see RELAY).
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (now including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers step 38's pad, the done screen's "Set a PIN", and now "Use your phone" on the check with a real phone.
- **What remains after 38:** 39 (clock, sleep timer, colour keys, buffer setting); 40 (diagnostics and legal pages); 43 (accessibility); 44 (store documents); 45 (release engineering). With Omar or a TV: 34, 16/19b/21, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - the restored-source login gap;
  - renaming a source; there is no way to remove a source in the app;
  - the info bar overflowing in en-XA;
  - a renamed hidden channel's old name over the list;
  - CH+ after hiding the playing channel;
  - `editChannel.close`'s e2e;
  - the guides screen's third line;
  - `auto-next`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - `guide-offset` en-US;
  - `rpc.test.ts:179`;
  - caching ffmpeg in CI;
  - the engines job's 35-minute cap;
  - forwarding workers' unhandled rejections;
  - `epgOverrides` after a re-match;
  - `config-server.ts`'s `close()`;
  - ingest request timeouts;
  - the query worker's budget;
  - the start's resume before the worker's load;
  - a VNode test of the pad;
  - **new:** the local e2e worker count under load.

## Checks for Omar
1. The phone page's check: `artifacts/screenshots/phone-check-form-en.png` and `phone-check-no-match-ar.png`. The TV's: `parental-phone-code-en.png`, `parental-phone-mismatch-en.png` and `parental-phone-pick-ar.png`. All are in the worktree, gitignored. Nothing to decide.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file);
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad with the remote, hide/show the app while unlocked, "Forgot your PIN?" with the TV's keyboard, "Set a PIN" on onboarding's done screen, and "Use your phone" on the check with a real phone.
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
