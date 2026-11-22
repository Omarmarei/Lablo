# Lablo IPTV: relay leg 140 opening prompt

You are leg 140 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–138 did steps 1–33, 35, 35e, 36, 37, 38a, 38b and built 38c1.
- **Leg 139 (2026-11-22):**
  - **38c1 finished and merged:** mutation 78/78 (two test gaps closed), unit 8,404, architecture.md "Built in step 38c1"; **PR #163 merged as `c77145a`** on green CI.
  - **38c2 split again, built and merged:** 38c2 (the typed login check), 38c3 (Q2's prompt on the done screens), 38c4 (the login sent from the phone). 38c2 = `source-login.ts`' check mode and `matchesLogin`, `settings/pin-check.ts` (the pick, the form, the no-login dialog), the page's "Set a PIN" / "Forgot your PIN?", the rail dialog's "Set a PIN" with the unlock after it. **PR #164 merged as `e19f20b`** on green CI; RELAY.md updated in `99f3ae3`.
- **Your step: 38c3**, then 38c4, then 38d.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:** `- [ ] 38c.`; its 38c2 part ("Split again in leg 139", refinements 1–8, "Built in leg 139"), and the **38c3** and **38c4** bullets under it; step 38's "Shape" (Q1–Q3, Omar's option 1 each); the last progress row (139).
2. **docs/architecture.md** §1.4 item 10: "Built in step 38c1" and "Built in step 38c2" (~976–1000). Add "Built in step 38c3" after them.
3. **For 38c3** (Q2: when a source just added has adult groups and no PIN is set, the done screen offers "Set a PIN" or "Later"):
   - Onboarding's done screen: `apps/tv/src/onboarding/OnboardingApp.tsx` `DoneScreen` (~250–275, one button "Start watching", `testId="action-0"`), and `onboarding-state.ts` `doneSpec` (~235, zones `ONE`, OK → `finished`). The typed add (`startLoad`, ~170) and the phone add (`pairAdded`, ~345) both reach it.
   - Onboarding has **no pad**: `createParental` is made in `showLive` (`main.tsx` ~389, ~620). Its "Set a PIN" has to start the live screen and then open the pad's new PIN (`parental.choose`) over it, so `showLive` needs a flag; `finish` in `showOnboarding` (~770) calls it.
   - Settings' add from the phone: the pairing screen's done view, `apps/tv/src/pairing/PairPage.tsx` (~143), and `pairActions('done')` → `['close']` in `pair-state.ts` (~75). It is main.js code shared with onboarding (onboarding's pairing goes to its own done screen through `added`).
   - "Has adult groups": the worker's `lockState()` (`{ pin, unlocked, kinds }`) read after the load. The engine's refresh resolves after the query worker's `reload` (`apps/tv/src/data/engine.ts` ~460–519), so the read sees the new catalog.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `99f3ae3` (docs), `e19f20b` (PR #164's merge) and `5d0274f` (38c2).
   - No `*.mutbak`.
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **38c3:** write its refinements against the code first (each with its why), then build it:
   - onboarding's done screen and the pairing's done view;
   - the `lockState` read after the add;
   - onboarding's start into the live screen with the new PIN;
   - "Later" keeps today's path.
   - Done when: as RELAY's 38c3 bullet says (unit, e2e en/ar/en-XA, `build:tv` and a module diff, engines 53/68, mutation with the list written first, lint, typecheck, full `pnpm test`, architecture.md, the PR merged on green CI).
3. **38c4** (the phone's login for the check): its shape first. Read `pair-state.ts`, `packages/protocol`, the web's pairing page (`apps/web`) and its status words. It needs a protocol field and a web page change. If the shape has a real trade-off (e.g. whether the phone page should say "checked" or reuse "Added"), stop for Omar with a numbered question.
4. **38d** (the complete settings screen: the order, "Player", "Language", e2e paths by id) after 38c.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed, equal to `origin/main` (`e19f20b`) plus `99f3ae3` and this handover's commit.
- **No open PR.** The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/` (38c2's `build:tv`);
  - in `artifacts/`: `mutate38c1.py`, `mutate38c1-list.md`, `mutate38c1-{a,b,c,d}.log`, `mutate38c2.py`, `mutate38c2-list.md`, `mutate38c2-{a,b,c}.log`, `unit-38c1b.log`, `unit-38c2.log`, `build-tv-38c1b.log`, `build-tv-38c2.log`, `mprobe-38c2.log`, `e2e-38c2-{a,b,c}.log`, `engines-38c2-68.log`, `-53.log` (the stuck run), `-53b.log` (13/13);
  - screenshots `artifacts/screenshots/parental-login-*` (new: `-mismatch-{en,ar}`, `-unlocked-*`, `-page-*`, `-pick-en-XA`, `-form-en-XA`, `-set-en-XA`, `-none-en-XA`).

## Verified vs not
- **Verified in leg 139:**
  - 38c1: mutation 78/78; unit 8,404; PR #163's whole CI.
  - 38c2: unit 8,484; typecheck; lint; e2e `parental-login.spec.ts` (en, ar, en-XA) plus `parental`, `parental-settings`, `backup-logins` (10 passed); screenshots looked at; `build:tv` (main.js 451.7 KB Tizen, 439.0 webOS; settings.js 92.2 KB; query worker 148.5/150 unchanged); module diff: core-js 216 main / 6 settings.js, unchanged; mutation 76/77 (one equivalent: the check's read in `data-pending`); `verify:engines` 68 13/13, 53 13/13 on the second run; PR #164's CI (media skipped by its path filter).
- **Not yet:** 38c3, 38c4, 38d; production (step 34); the PIN pad and the login check on a real TV (step 21's session).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 139:**
- **A test that sends the deciding key and BACK in one `press(...)` batch never reaches the async path:** BACK closes the pad before the worker's answer, and the answer is then dropped. This hid two paths (the wait before a new PIN; the unlock after it): four mutants survived because of it. Press BACK in its own `press` after the answer, and assert the state in between (`problem: 'wait'`, `busy: true`).
- **The check's screens from the rail paint on a blank settings page:** `loaded.Screen` draws them with nothing under (the page's rows show only when the check came from the page). Dialogs (`.z-dialog`) are `position: fixed`, so the check's form is drawn by `SettingsScreen` as a sibling of `ParentalPageScreen`. This avoids an import cycle (`ParentalPage.tsx` ↔ `SettingsScreen.tsx`).
- **e2e profile tricks:**
  - `restartWith(page, { sources: [...] })` adds a second source (an `m3u` record with the mock's `get.php` link: a pick of two);
  - or strips a login (`account: null, base`: the no-login dialog). Read the stored sources first (`storedSources` in `e2e/parental-login.spec.ts`).
- **The check's form ids:** `pin-check/fields/<n>` (Xtream: 0 server prefilled, 1 user name, 2 password), `pin-check/actions/0` "Check"; the pick `pin-pick/rows/<n>`; the dialog `pin-none/buttons/0`; the rail dialog `no-pin/buttons/0` "Set a PIN", `/1` "Cancel".
- **Chromium 53's stuck database delete hit locally again** (ten walks at their 60 s limit, "could not be deleted … (pending)"). Rerunning `--engine chrome53` alone gave 13/13. A foreground run can pass its 595 s limit: run 53 in the background.
- **PR CI:** the media job is skipped by its path filter on a TV-only PR ("skipping" is fine).
- **Bash heredocs broke again** (a python patch with apostrophes). Write patch scripts with the Write tool and run them; also mind `'` inside a Python `'...'` literal.

**From legs 130–138 (still true):**
- **PR #162's media job:** a lock-by-default change needs every oracle over the big fixture checked. The media job runs `test:media`, then `lab:media`, then `e2e:media`; a failure in the first hides the others, so run them locally.
- **e2e:**
  - UP from the list lands on the header's last focused button (`openSettings` reads the focus path);
  - after an unlock the rail's focus is on the first group that came back: wait for `settled(live)` and `data-status=ready` before RIGHT/LEFT;
  - Settings' check pad and the new-PIN pad are both `pin/pad/0`: wait on `data-purpose`.
- **VNode tests don't render sub-components,** and a component with `useZone` can't be called as a function: test plain functions that return VNodes.
- **Optional engine methods** (`lockState?`) keep older fakes compiling; `readLocks` treats absent or failed as no PIN, locked.
- **"Channels" while locked:** test edits of channels missing from the catalog get `missingSince: 5`.
- **Module probes:** `mprobe.mts` (main.js, split) is in `C:/Users/Omarm/.claude/jobs/00d9267b/tmp/` and `C:/Users/Omarm/.claude/jobs/917772fb/tmp/`; run `pnpm exec tsx <file>`.
- **The query worker has 1.5 KB left** (148.5/150).
- **CI's engines job can end "cancelled"** (53's stuck delete past the 35-minute cap): read the log, then `gh run rerun <run> --failed` once the run is complete.
- **Channel edits are re-matched on two paths** (`channel-relink.ts`): a new `ChannelEdit` field must be named in `changed(...)` too.
- **A test that a read is fresh must load the worker first.**
- **Mutation:** write the list first; `--check` until every snippet is found once; `--clean` first; foreground chunks with `MUT_TIMEOUT=300` (about 25 mutants each); restore any `.mutbak` with `mv`.
- **The mock's catalog is mutable at runtime** (`app.mockState.catalog`). Since 37a its `get.php` added through the loader becomes Xtream.
- **e2e with the 18+ group locked:** `ordered` / `allOrdered` (`e2e/live-rows.ts`), `restartWith`, `ADULT_OPEN`, `pinFields` (`e2e/profile-edit.ts`), and the shared steps in `e2e/parental-steps.ts` (`chips`, `pad`, `typePin`, `toLastEntry(remote, ar, entries)`, `setHidden`, `untranslated`).
- **The non-media e2e streams never play:** count the mock's requests to prove a held stream.
- **Sizes:** main.js has a 500 KB hard budget on Tizen (451.7 KB now, 90%). Mention sizes only when they decide something or near a budget.
- **CI:**
  - a run takes about 30 min;
  - known flakes: `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes;
  - rerun only after the whole run is done; a push to the PR cancels its CI;
  - no `jq` in Git Bash (use `gh --jq`);
  - wait in the background with an `until` loop over `gh pr checks <n> --json name,bucket` (count at least 5 checks, none pending).
- **e2e paths:** Settings is `live/header/5`. Its rows by index: Sources 1, "Channel groups" 5, "Channels" 6, "Parental control" 7 (it scrolls the list). The page's rows with a PIN: change 0, adult 1, groups 2, forgot 3; with none: set 0. 38d moves the paths to ids.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`; no new `for…of`, `Uint8Array` as a value or `JSON.stringify`; no array destructuring or spread, object spread or fragments; no `Promise.prototype.finally`. The module diff says whether core-js moved.
- **Layout and text:** physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free. UI text comes only from the catalogs. Arabic on/off words agree with their noun. Preact: write `translate={false}`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:** CI runs Node 22, this PC Node 24. A bare `sleep` is blocked. `TaskStop` on `verify:engines` leaves its container. The TV build can crash once (0xC0000005): rerun it.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data. README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34. Its migration and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Step 38's three questions are decided** (Omar, 2026-11-22, option 1 each). In 38c3, 38c4 and 38d, make the smaller choices with a why; send only real trade-offs to Omar.
- **Leg 139's choices** (Omar may overrule; each is small to change):
  - a phone's file and a source restored without its login can't be used for the check;
  - the check's form prefills the Xtream server;
  - wrong logins have no wait;
  - a PIN set from the rail's dialog also unlocks the session;
  - "Set a PIN" and "Forgot your PIN?" grant the visit once the new PIN is kept;
  - 38c split into 38c2, 38c3 and 38c4.
- **Known limit to propose as a later fix:** a source restored without its login can be given any login in Settings › Sources, which then passes the check. Closing it needs a "proven by the provider" mark per login.
- **Leg 138's choices stand:** the page asks the PIN once a visit and again after a hide; "Lock channel" only with a PIN; a lock in a locked session closes the player; the settings list's scrolling is in 38c1.
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding;
  - typing a backup code;
  - a login and a guide link given again;
  - Settings' report rows;
  - a telemetry send once step 34 has an API;
  - the favourites star and "Channel groups"' move mode;
  - Settings' first open (settings.js);
  - step 36's pencil and forms;
  - step 37's `get.php` link typed on the TV and 10 minutes of radio;
  - step 38's PIN pad with the TV's remote, with and without number keys, the app hidden and shown while unlocked, and the login check typed with the TV's keyboard.
- **What remains after 38:**
  - 39 (clock, sleep timer, colour keys, buffer setting);
  - 40 (diagnostics and legal pages);
  - 43 (accessibility);
  - 44 (store documents);
  - 45 (release engineering);
  - with Omar or a TV: 34, 16/19b/21, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - the restored-source login gap above;
  - renaming a source;
  - **no way to remove a source in the app**;
  - the info bar overflowing the safe area in en-XA;
  - a hidden channel playing over the list keeps its old name if renamed from the same pencil;
  - CH+ skips one after hiding the channel that plays;
  - main's `editChannel.close` has no e2e path;
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race;
  - a best-of-3 for `epg-declared-300mb`;
  - `guide-offset.spec.ts` en-US;
  - `rpc.test.ts:179`'s 5 ms sleep;
  - caching ffmpeg in CI's media job;
  - the engines job's 35-minute cap;
  - forwarding workers' unhandled rejections;
  - `epgOverrides` not following a refresh's re-match;
  - `e2e/config-server.ts`'s `close()`;
  - ingest request timeouts;
  - **the query worker's 150 KB budget** (1.5 KB left);
  - the start's resume before the worker's load;
  - a VNode test of the pad's drawing.

## Checks for Omar
1. Settings › "Parental control" without a PIN and "Forgot your PIN?": `artifacts/screenshots/parental-login-page-en.png` (the four rows), `parental-login-mismatch-ar.png` (the check's form after a wrong password), `parental-login-pick-en-XA.png` (two sources), `parental-login-none-en-XA.png` (no source keeps a login). All in the worktree, gitignored. Nothing to decide.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file);
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad (step 38) with the remote, hide/show the app while unlocked, and "Forgot your PIN?" with the TV's keyboard.
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
