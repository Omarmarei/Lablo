# Lablo IPTV: relay leg 141 opening prompt

You are leg 141 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–139 did steps 1–33, 35, 35e, 36, 37, 38a, 38b, 38c1 and 38c2.
- **Leg 140 (2026-11-22):**
  - **38c3 built and merged:** the done screens' PIN prompt (Q2). **PR #165 merged as `b52a729`** on green CI.
  - **A latent scrubber bug fixed on the way** (`4fa309b`): CI's random property found that `key=[x]` scrubbed again gave `key=[x]]`. A value already `[x]` is now taken whole.
  - **38c4's shape written and asked of Omar** (RELAY.md, 38c4's "Shape"): how the phone page should behave when the phone sends a login for the PIN check. Three options; option 1 recommended.
  - RELAY.md and architecture.md updated in `6ce1a94`.
- **Your step depends on Omar's answer** (see "Next steps").
- **Waiting for Omar:**
  - 38c4's question, unless RELAY.md already records his answer;
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - `- [ ] 38c.` and its sub-steps: 38c3 ("Refined before building" 1–7, "Built in leg 140", the merge line); **38c4's "Shape (leg 140)"** with options 1–3, and whether Omar's answer is recorded under it;
   - step 38's "Shape" (Q1–Q3) and **38d**'s bullet;
   - the last progress row (140).
2. **docs/architecture.md** §1.4 item 10: "Built in step 38c2" and "Built in step 38c3" (~989–1008).
3. **For 38c4** (only if Omar chose option 1 or 2):
   - the TV's check: `apps/tv/src/settings/pin-check.ts` (the pick, the form, the no-login dialog), `settings/source-login.ts` (`matchesLogin`, `checkSources`);
   - the pairing: `apps/tv/src/pairing/pair-state.ts` (`createPairing`, `answered`, `pairDraft`), `PairPage.tsx`;
   - the protocol: `packages/protocol/src/pairing.ts` (`PAIR_STATUSES`, `pairCreateRequestSchema`, `pairTvKeyResponseSchema`, `pairProgressResponseSchema`);
   - the web: routes under `apps/web/src/app/v1/pair/` (`route.ts`, `[code]/route.ts`, `s/[sid]/status/route.ts`), the phone page `apps/web/src/phone/` (`catalog.ts` words and status map, `code.ts`'s QR fragment `#c=…&k=…`, `flows.ts`, `PhonePage.tsx`), `apps/web/prisma/schema.prisma` (`PairSession.status` is a text column);
   - the tests: `apps/web/test/phone-*.test.ts`, `pair.web.test.ts`, `apps/web/e2e/phone.spec.ts`, `e2e/pairing*.spec.ts`.
4. **For 38d:** `apps/tv/src/settings/settings-state.ts` (`SETTINGS_ITEMS`, the windowed list), `SettingsScreen.tsx`, the player's stored fields (`memory.subtitleSize`, `memory.picture`, `uiTrackPreferences` in `apps/tv/src/player/app-player.ts`), onboarding's language answer (`answerEdit`).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `6ce1a94` (docs), `b52a729` (PR #165's merge) and `4fa309b` (the scrubber fix).
   - No `*.mutbak`.
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **Read Omar's 38c4 answer** (RELAY.md under 38c4's shape, or his message in the leg-140 tab, which the leg should have written into RELAY.md):
   - **Option 1** (the phone page knows it's a check): write the refinements against the code first, then build: the TV's check mode in the pairing, `purpose` on `POST /v1/pair` kept in the session (a nullable Prisma column: a **dev** migration only; production waits for step 34), given back by `GET /v1/pair/:code` and the QR fragment, the phone page's words for a check in en and ar, and two new statuses. Likely one leg; split if not.
   - **Option 2** (phone page unchanged, two new statuses and their words): the TV's check mode, `PAIR_STATUSES` and the phone page's result words. No migration.
   - **Option 3** (no phone path): tick 38c4 as dropped with Omar's reason, then tick 38c.
   - **No answer recorded:** go on with **38d** (it doesn't depend on 38c4) and leave 38c4 for when he answers.
   - Done when (38c4): unit tests (the check mode: a match on any usable source, a mismatch, a file; the status sent; the web's route and page); e2e (the TV's check by phone in en and ar, `e2e/pairing*.spec.ts` style with the stand-in; the web's `phone.spec.ts` for the page's words); en-XA; `build:tv` and a module diff; engines 53/68; mutation with the list written first; lint, typecheck, full `pnpm test`; architecture.md "Built in step 38c4"; the PR merged on green CI.
3. **38d** (the complete settings screen: the order, "Player", "Language", e2e paths by id), as RELAY says. May split at "Player".

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed: `origin/main` (`b52a729`) plus `6ce1a94` and this handover's commit.
- **No open PR.** The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next` (built 2026-11-21; the web code is unchanged since 11-19);
  - `dist/` (38c3's `build:tv`);
  - in `artifacts/`: `mutate38c3.py`, `mutate38c3-list.md`, `mutate38c3-{a,b,c}.log`, `e2e-38c3-{a,b,c,all,web}.log`, `build-tv-38c3.log`, `mprobe-38c3.log`, `engines-38c3-{68,53}.log`, `lint-38c3.log`, `typecheck-38c3.log`, `unit-38c3.log` (partial: the reaped run), and the older 38c1/38c2 files;
  - screenshots `artifacts/screenshots/parental-first-pin-*` (`-done-{en,ar,en-XA}`, `-pair-{en,ar,en-XA}`, `-pad-en-XA`).

## Verified vs not
- **Verified in leg 140 (38c3):**
  - typecheck; lint;
  - unit: the changed files' tests and the root loader tests against the real workers (48); the full suite on PR #165's CI, **8,512 passed** (locally, Claude Code stopped the full run for low memory);
  - e2e: the whole chromium project 197 passed (the new `parental-first-pin.spec.ts`: 5), the web-backed tv project 13 passed;
  - screenshots looked at;
  - `build:tv`: main.js 453.5 KB Tizen (+1.8), 440.8 webOS; settings.js 92.1 KB; query worker 148.5/150 (unchanged); module diff: core-js 216 main / 6 settings.js, the same modules;
  - mutation 42/42 at the first run;
  - `verify:engines` 68 13/13, 53 13/13;
  - PR #165's CI (engines rerun once for Chromium 53's stuck delete; media rerun twice for `epg-declared-300mb`).
- **Not yet:** 38c4, 38d; production (step 34); the PIN prompt and pad on a real TV (step 21's session).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 140:**
- **The mock's panel now gives the done screens a prompt** (its 18+ group is locked and no PIN is set). The shared steps take "Later":
  - `toStartButton(remote, onboarding)` in `e2e/onboard.ts` (used by `startWatching`);
  - `closeDone(remote, language)` in `e2e/pairing-steps.ts` (Settings' pairing done view).
  A new spec that onboards by hand on the mock must take "Later" (`done/actions/1`, RIGHT in English, LEFT in Arabic) or "Set a PIN" (`pin/pad/0`). The engines' fixture has no adult group, so its walks keep one button.
- **Onboarding has its own PIN pad** (`OnboardingOptions.pad` → `ob.parental`; OnboardingApp draws `PinPadScreen` when `PIN_SCREEN` is on top). The pairing gets the pad's new PIN through `PairingOptions.setPin` (Settings only).
- **`LoadResult` is compared whole in root tests that use the real loader and engine** (`test/onboarding-loader-mock.test.ts`, `test/tv-data-engine.test.ts`). A new field fails their `toEqual`: grep the root `test/` as well as `apps/` when a shared result type changes.
- **With two sources the live rail is windowed:** after an unlock the focus scrolls to the first group that came back, so "Lock again" may not be drawn. Check for the `open <group>` chip instead.
- **A background `pnpm test` was stopped by Claude Code for low memory.** Don't restart it unasked; the PR's verify job runs the full suite (read its count from the job log).
- **A random property failing on CI in code you didn't touch can be a real bug** (`packages/protocol/src/scrub.test.ts`, counterexample `key=`): read the counterexample, reproduce it with a `tsx` probe, fix it, and pin it with a fixed-case test that fails on the old code.
- **A change under `packages/protocol` brings in the media job.** `epg-declared-300mb` failed twice in a row (86 and 62 ms against 60) and passed the third time. Rerun with `gh run rerun <run> --failed` only once the whole run is done; a `cancelled` engines job is rerun by the same command.
- **Mutation chunks:** an e2e mutant takes about 60 s, so a chunk with more than about eight of them passes the 595 s foreground limit. The outer `timeout` then leaves a `.mutbak` (main.tsx here; restored with `mv`). Put the e2e mutants in their own chunks.
- **A python patch heredoc with regex backslashes (`\s`, `\[`) broke again** (SyntaxWarning, no match). Use the Edit tool for such lines.

**From legs 130–139 (still true):**
- **A test that sends the deciding key and BACK in one `press(...)` batch never reaches the async path.** Press BACK in its own `press` after the answer, and assert the state in between.
- **The check's screens from the rail paint on a blank settings page;** dialogs are `position: fixed`; the check's form is drawn by `SettingsScreen` beside `ParentalPageScreen`.
- **e2e profile tricks:** `restartWith(page, { sources: [...] })` adds a source or strips a login (`account: null, base`). Read the stored sources first (`storedSources` in `e2e/parental-login.spec.ts`).
- **The check's form ids:** `pin-check/fields/<n>`, `pin-check/actions/0`; the pick `pin-pick/rows/<n>`; `pin-none/buttons/0`; the rail dialog `no-pin/buttons/0` "Set a PIN", `/1` "Cancel".
- **Chromium 53's stuck database delete** happens locally and on CI: rerun `--engine chrome53` alone in the background (it can pass 595 s).
- **PR CI:** the media job is skipped by its path filter on a TV-only PR ("skipping" is fine).
- **e2e:**
  - UP from the list lands on the header's last focused button (`openSettings` reads the focus path);
  - after an unlock the rail's focus is on the first group that came back: wait for `settled(live)` and `data-status=ready` before RIGHT/LEFT;
  - Settings' check pad and the new-PIN pad are both `pin/pad/0`: wait on `data-purpose`.
- **VNode tests don't render sub-components,** and a component with `useZone` can't be called as a function.
- **Optional engine methods** (`lockState?`) keep older fakes compiling.
- **Channel edits are re-matched on two paths** (`channel-relink.ts`): a new `ChannelEdit` field must be named in `changed(...)` too.
- **Mutation:** write the list first; `--check` until every snippet is found once; `--clean` first; foreground chunks with `MUT_TIMEOUT=300`; restore any `.mutbak` with `mv`.
- **The mock's catalog is mutable at runtime** (`app.mockState.catalog`). Since 37a its `get.php` added through the loader becomes Xtream.
- **e2e with the 18+ group locked:** `ordered` / `allOrdered` (`e2e/live-rows.ts`), `restartWith`, `ADULT_OPEN`, `pinFields` (`e2e/profile-edit.ts`), the shared steps in `e2e/parental-steps.ts` (`chips`, `pad`, `typePin`, `toLastEntry(remote, ar, entries)`, `setHidden`, `untranslated`).
- **The non-media e2e streams never play:** count the mock's requests to prove a held stream.
- **Sizes:** main.js has a 500 KB hard budget on Tizen (453.5 KB now, 91%). Mention sizes only when they decide something or near a budget. **The query worker has 1.5 KB left** (148.5/150).
- **CI:**
  - a run takes about 30 min;
  - known flakes: `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes;
  - rerun only after the whole run is done; a push to the PR cancels its CI;
  - no `jq` in Git Bash (use `gh --jq`);
  - wait with a Monitor poll over `gh pr checks <n> --json name,bucket` (at least 5 checks, none pending), or a background `until` loop on `gh run view <run> --json status`.
- **e2e paths:** Settings is `live/header/5`. Its rows by index: Sources 1, "Channel groups" 5, "Channels" 6, "Parental control" 7 (it scrolls the list). The page's rows with a PIN: change 0, adult 1, groups 2, forgot 3; with none: set 0. 38d moves the paths to ids.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`; no new `for…of`, `Uint8Array` as a value or `JSON.stringify`; no array destructuring or spread, object spread or fragments; no `Promise.prototype.finally`. The module diff says whether core-js moved.
- **Layout and text:** physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free. UI text comes only from the catalogs. Arabic on/off words agree with their noun. Preact: write `translate={false}`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:** CI runs Node 22, this PC Node 24. A bare `sleep` is blocked in the foreground. `TaskStop` on `verify:engines` leaves its container. The TV build can crash once (0xC0000005): rerun it. Heavy checks one at a time (memory).

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data. README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34. Its migration and its deploy each need Omar's one-word OK. A dev-only Prisma migration (38c4 option 1) needs none.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **38c4's question** (RELAY.md, 38c4's "Shape"): 1 the phone page knows it's a check (recommended; a dev migration); 2 the page unchanged plus two statuses; 3 no phone path.
- **Leg 140's choices** (Omar may overrule; each is small to change):
  - onboarding has a pad of its own (Back returns to "Set a PIN" / "Later"), not the live screen started with the pad over it;
  - the prompt shows whenever no PIN is set and something is locked (any source), so a later add after "Later" asks again;
  - the PIN set at the done screen doesn't unlock the session;
  - "Set a PIN" is first and focused.
- **Leg 139's choices stand:** a phone's file and a source restored without its login can't be used for the check; the check's form prefills the Xtream server; wrong logins have no wait; a PIN set from the rail's dialog also unlocks the session; "Set a PIN" and "Forgot your PIN?" grant the visit once the new PIN is kept.
- **Leg 138's choices stand:** the page asks the PIN once a visit and again after a hide; "Lock channel" only with a PIN; a lock in a locked session closes the player.
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers: an Arabic onboarding; typing a backup code; a login and a guide link given again; Settings' report rows; a telemetry send once step 34 has an API; the favourites star and "Channel groups"' move mode; Settings' first open (settings.js); step 36's pencil and forms; step 37's `get.php` link typed on the TV and 10 minutes of radio; step 38's PIN pad with the TV's remote (with and without number keys), the app hidden and shown while unlocked, the login check typed with the TV's keyboard, and the done screen's "Set a PIN".
- **What remains after 38:** 39 (clock, sleep timer, colour keys, buffer setting); 40 (diagnostics and legal pages); 43 (accessibility); 44 (store documents); 45 (release engineering); with Omar or a TV: 34, 16/19b/21, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - the restored-source login gap (a source restored without its login takes any login, which then passes the check);
  - renaming a source; **no way to remove a source in the app**;
  - the info bar overflowing the safe area in en-XA;
  - a hidden channel playing over the list keeps its old name if renamed from the same pencil;
  - CH+ skips one after hiding the channel that plays;
  - main's `editChannel.close` has no e2e path;
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - **a best-of-3 for `epg-declared-300mb`** (failed twice in a row on PR #165);
  - `guide-offset.spec.ts` en-US; `rpc.test.ts:179`'s 5 ms sleep;
  - caching ffmpeg in CI's media job; the engines job's 35-minute cap;
  - forwarding workers' unhandled rejections;
  - `epgOverrides` not following a refresh's re-match;
  - `e2e/config-server.ts`'s `close()`;
  - ingest request timeouts;
  - **the query worker's 150 KB budget** (1.5 KB left);
  - the start's resume before the worker's load;
  - a VNode test of the pad's drawing.

## Checks for Omar
1. The done screens' prompt: `artifacts/screenshots/parental-first-pin-done-en.png` and `-done-ar.png` (onboarding), `parental-first-pin-pair-en.png` (Settings' add from the phone), `parental-first-pin-pad-en-XA.png` (the pad over onboarding). All in the worktree, gitignored. Nothing to decide beyond 38c4's question.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file);
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad (step 38) with the remote, hide/show the app while unlocked, "Forgot your PIN?" with the TV's keyboard, and "Set a PIN" on onboarding's done screen.
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
