# Lablo IPTV: relay leg 139 opening prompt

You are leg 139 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–137 did steps 1–33, 35, 35e, 36, 37 and step 38's shape.
- **Leg 138 (2026-11-22):**
  - **PR #162 (38a + 38b) merged as `69d100a`** on green CI. The first run's `media` job failed for a real reason: `test/search-200k.media.test.ts`'s oracle still counted the big fixture's adult groups, which search now leaves out. Fixed in `bda3eca` (the oracle drops `adultName` groups). 38a and 38b are ticked.
  - **38c refined and split** in RELAY.md (`- [ ] 38c.`, refinements 1–10):
    - **38c1** covers the paths with a PIN.
    - **38c2** covers no PIN and a forgotten PIN.
    - The settings list's scrolling moved from 38d into 38c1.
  - **38c1 is built and committed (`fa789a0`), pushed, with no PR yet.** Still to do: mutation, architecture.md, the PR. What it contains:
    - the worker's `checkPin`;
    - the pad's `ask` and `choose` modes;
    - the windowed settings list with "Parental control";
    - `settings/parental-page.ts` and `ParentalPage.tsx`;
    - the channel menu's "Lock channel" and "Unlock channel";
    - "Channels" while locked.
- **Your step:** finish 38c1, then 38c2.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - `- [ ] 38c.`: its refinements, the 38c1 and 38c2 parts, and 38c1's "Built in leg 138", "Verified" and "Left" notes;
   - step 38's "Shape" (Q1–Q3, Omar's option 1 each);
   - the last progress row (138).
2. **docs/architecture.md** §1.4 item 10: "Built in step 38a" and "Built in step 38b" (~954–975). Add "Built in step 38c1" after them.
3. **For 38c2:**
   - `apps/tv/src/settings/source-login.ts` (`createLoginForm`, `loginValues`, `checkLogin`). **Its values are prefilled with the stored login, so the PIN check must open it empty** (an Xtream server only).
   - `apps/tv/src/pairing/pair-state.ts`. Its `added` runs the loader and adds the source. The phone page's "ok" text says "Added", so a phone login check needs a protocol and web change, and may become 38c3.
   - `apps/tv/src/onboarding/OnboardingApp.tsx` and the pairing done view (Q2's prompt).
   - `parental.ts`' `openNoPin`.
   - `parental-page.ts`' `parentalRows(false)`, which returns `[]` now.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `fa789a0` (38c1), `5e897ed` (docs) and `69d100a` (the merge).
   - No `*.mutbak`.
   - `docker ps` shows only `lablo-web-postgres-1`.
2. **38c1 mutation:**
   - Run `artifacts/mutate38c1.py`, which lists 78 mutants written first (`--check` gives 78/78).
   - Run `--clean` first.
   - Then run the foreground batches: `MUT_TIMEOUT=300 python -X utf8 -I -u artifacts/mutate38c1.py --from 1 --to 25`, and so on. Log to `artifacts/mutate38c1-a.log`, `-b`, `-c`.
   - Mutants 2, 23, 24, 54, 58 and 75–78 run `parental-settings.spec.ts` (~25 s each with the dev server's start).
   - Mutants that may survive (no test yet): 36 ("Locked groups" opened again keeps its last rows until read), 37 (the groups page's pending guard), 77 (main's `live.channelsChanged()` in `locksChanged`). The page tests added in leg 138 should catch 36 and 37. Close any gap with a test, or keep the mutant as equivalent with its reason.
   - Also write `artifacts/mutate38c1-list.md` (the numbers and intents, from the script's comments).
3. **The rest of 38c1's gates:**
   - the full `pnpm test` once more (the dead-code removals came after the 8,400 run);
   - architecture.md "Built in step 38c1";
   - tick nothing until the merge;
   - the PR from `relay/iptv-20261101-214120` to `main`, merged on green CI (merge commit, keep the branch). Name the three riskiest changes: the settings list now scrolls (every Settings e2e path still by index, the eighth row last); `checkPin` in the query worker (1.5 KB left); a lock in a locked session closes the player.
   - After the merge: `git fetch`, `git merge --ff-only origin/main`, tick 38c1 in RELAY.md, add a progress row, commit and push.
4. **38c2:** write its refinements against the code first, then build it:
   - the login check, typed: a pick of the source with two or more; the login form opened empty;
   - "Set a PIN" and "Forgot your PIN?" rows;
   - the no-PIN dialog's "Set a PIN";
   - Q2's done-screen prompt;
   - the phone path, possibly split as 38c3.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **Commits:** `origin/main` (`69d100a`, PR #162's merge), plus `5e897ed` (docs), `fa789a0` (38c1), then this handover's commit (docs: HANDOVER.md).
- **No open PR.** The main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/` (leg 138's `build:tv`, 38c1 before the dead-code removals);
  - in `artifacts/`: `mutate38c1.py`, `38c1-wip.patch` (a safety copy of 38c1 before its commit, which can be deleted), `build-tv-38c1.log`, `mprobe-38c1-after.log`, `wprobe-38c1.log`, `unit-38c1.log`, `typecheck-38c1.log`, `lint-38c1.log`, `e2e-38c1-*.log`, `engines-38c1-53.log`, `-68.log`, `e2e-media-38b.log`, `lab-media-38b.log`, screenshots `artifacts/screenshots/parental-*` (new: `parental-page-*`, `parental-locked-groups-*`, `parental-settings-list-*`, `parental-pin-mismatch-*`, `parental-channel-lock-*`).

## Verified vs not
- **Verified in leg 138 (38c1):**
  - unit: 8,400 in the full run, then the touched folders again (532) after the dead-code removals;
  - `pnpm typecheck` and `pnpm lint`;
  - e2e: the whole chromium project (189 passed); `parental-settings.spec.ts` (en, ar, en-XA) after its last additions; screenshots looked at;
  - `build:tv`: main.js 449.1 KB on Tizen (+3.8), 436.4 KB on webOS; settings.js 87.7 KB (+9.1); query worker 148.5/150 KB;
  - module diff: core-js 216 in main and 6 in settings.js, unchanged;
  - `verify:engines` 13/13 on chrome53 and 13/13 on chrome68;
  - PR #162: its whole CI.
- **Not yet:**
  - 38c1's mutation, its last full unit run, architecture.md and its PR;
  - 38c2 and 38d;
  - production (step 34);
  - the lock on a real TV (step 21's session).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 138:**
- **PR #162's media job:** the 200k search's oracle counted adult groups, and a lock-by-default change needs every oracle over the big fixture checked. The media job runs `test:media`, then `lab:media`, then `e2e:media`. A failure in the first hides the others, so run the other two locally: `pnpm e2e:media` 18 passed (3.3 min), `pnpm lab:media` 2 passed.
- **e2e:**
  - UP from the list lands on the header's *last focused* button, not `header/0`. `openSettings` in `parental-settings.spec.ts` reads the focus path and steps from there.
  - After an unlock, the rail's focus sits on the first group that came back (`rail/1`). Wait for `settled(live)` and `data-status=ready` before RIGHT/LEFT to the list, or the key goes nowhere.
  - Settings' check pad and the new-PIN pad are both `pin/pad/0`. Wait on `data-purpose`, not the focus.
- **VNode tests don't render sub-components:** a message drawn by a component isn't found by `byTestId`. Call a plain function that returns the VNode (`message(...)` in `ParentalPage.tsx`).
- **Optional engine methods** (`lockState?` in `ChannelEditEngine`, as in `GroupsEngine`) keep older test fakes compiling. `readLocks` treats "absent" or a failure as no PIN and a locked session.
- **"Channels" while locked** leaves out rows with no item and `missingSince === null`. Test edits of channels missing from the catalog now get `missingSince: 5` (`edit()` in `channel-edit.test.ts`).
- **Bash heredocs broke twice again** (an apostrophe inside a heredoc'd test name; a 140-line test append). Write the patch script and the TS chunk to the scratchpad, then run it.
- **Module probes:** `mprobe.mts` (main.js, split) and `wprobe.mts` (a worker) are in `C:/Users/Omarm/.claude/jobs/917772fb/tmp/` (copies from older legs). Run them with `pnpm exec tsx <file>`.
- **The query worker has 1.5 KB left** (148.5/150).

**From legs 130–137 (still true):**
- **CI's engines job can end "cancelled"** (Chromium 53's stuck IndexedDB delete past the 35-minute cap): read the job log, then `gh run rerun <run> --failed` once the run is complete.
- **Channel edits are re-matched on two paths** (`channel-relink.ts`): a field added to `ChannelEdit` must be named in `changed(...)` too.
- **A test that a read is fresh must load the worker first.**
- **Mutation:** write the list first; `--check` until every snippet is found once; `--clean` runs each command on clean code first; run foreground chunks with `MUT_TIMEOUT`; restore any `.mutbak` with `mv`.
- **The mock's catalog is mutable at runtime** (`app.mockState.catalog`, put back in `afterEach`). Since 37a its `get.php` added through the loader becomes Xtream.
- **e2e with the 18+ group locked:** use `ordered` / `allOrdered` (`e2e/live-rows.ts`), and `restartWith`, `ADULT_OPEN`, `pinFields` (`e2e/profile-edit.ts`). The shared parental steps are now in `e2e/parental-steps.ts` (`chips`, `pad`, `typePin`, `toLastEntry`, `setHidden`, `untranslated`).
- **The non-media e2e streams never play:** count the mock's requests to prove a held stream.
- **Sizes:** main.js has a 500 KB hard budget on Tizen (449.1 KB now, 90%). Mention sizes only when they decide something or near a budget.
- **CI:**
  - a run takes about 30 min;
  - known flakes: `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes;
  - rerun only after the whole run is done; a push to the PR cancels its CI;
  - no `jq` in Git Bash (use `gh --jq`);
  - wait in the background with an `until` loop over `gh pr checks <n> --json name,bucket`.
- **e2e paths:** Settings is `live/header/5`. Its rows by index: Sources 1, "Channel groups" 5, "Channels" 6, "Parental control" 7 (it scrolls the list: `data-top` 1). 38d reorders them and moves the paths to ids.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`; no new `for…of`, `Uint8Array` as a value or `JSON.stringify`; no array destructuring or spread, object spread or fragments; no `Promise.prototype.finally`. Count blanks by char code. The module diff says whether core-js moved.
- **Layout and text:** physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free. UI text comes only from the catalogs. Arabic on/off words agree with their noun ("Lock adult groups" is إقفال, masculine: مفعّل/متوقف). Preact: write `translate={false}`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:** CI runs Node 22, this PC Node 24. A bare `sleep` is blocked. `TaskStop` on `verify:engines` leaves its container. The TV build can crash once (0xC0000005): rerun it.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data. README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34. Its migration and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Step 38's three questions are decided** (Omar, 2026-11-22, option 1 each). In 38c and 38d, make the smaller choices from the shape with a why. Send only real trade-offs to Omar.
- **Leg 138's choices** (Omar may overrule; each is small to change):
  - The page asks the PIN once per visit at the first row that needs it, and again after the app was hidden.
  - "Lock channel" is offered only once a PIN is set.
  - A channel locked in a locked session closes the player.
  - With no PIN, the page has no row until 38c2.
  - The settings list's scrolling was moved into 38c1.
- **Possibly for Omar in 38c2:** Q3's "sent from the phone" needs the phone page to say "checked" rather than "Added" (a protocol field and a web page change). If it is large, split it as 38c3 rather than drop it.
- **Leg 137's and step 37's choices stand** unless Omar says otherwise.
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
  - step 38's PIN pad with the TV's remote, with and without number keys, and the app hidden and shown while unlocked.
- **What remains after 38:**
  - 39 (clock, sleep timer, colour keys, buffer setting);
  - 40 (diagnostics and legal pages);
  - 43 (accessibility);
  - 44 (store documents);
  - 45 (release engineering);
  - with Omar or a TV: 34, 16/19b/21, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
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
  - the start's resume could again start before the worker's load, with a light lock check (needs worker bytes);
  - a VNode test of the pad's drawing.

## Checks for Omar
1. Settings › "Parental control" and its pages: `artifacts/screenshots/parental-page-ar.png`, `parental-locked-groups-en.png`, `parental-settings-list-en.png` (the list scrolled), `parental-channel-lock-ar.png` (the pencil's menu with "Lock channel"). All in the worktree, gitignored. Nothing to decide.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file);
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad (step 38) with the remote, and hide/show the app while unlocked.
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
