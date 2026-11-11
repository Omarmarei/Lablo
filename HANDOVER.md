# Lablo IPTV: relay leg 69 opening prompt

You are leg 69 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:**
  - Leg 0 planned the work. Leg 6 did no project work.
  - Legs 1–67 did steps 1–25, 26a–26c and 26q (PRs #1–#69), except step 16's Samsung part, 19b and 21.
- **Leg 68** did step 26r, the rename to Lablo:
  - PR #70, merged as `68060da` on green CI (verify, media, engines 108/108);
  - PR #71 (docs), merged as `c96c936`: 26r ticked.
- **Steps 16, 19b and 21 stay open** until Omar says the Samsung route is ready or has time at the TV.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:**
   - step **26d** (resume): the scope and the Done-when;
   - step 26r's "Done in leg 68", for the new names.
2. **`docs/architecture.md` §1.3** (the profile; resume positions, "latest 500").
3. **The code to build on:**
   - 26c's movie details and the player's movie mode (`apps/tv/src/player/`; architecture.md "Built in step 26c");
   - `Tile.progress` and `ListRow.progress`, already in `packages/ui/src/components`.
4. **`CLAUDE.md`:** the project rules. Edits to it need Omar's direct word in his own tab.

## Next steps, in order
1. **Step 26d: resume** (its own PR).
   - **The progress:** the profile keeps each movie's position (latest 500):
     - every 10 s while it plays, and when it stops, is left or the app hides;
     - a movie within its last 2 minutes (or past 95 %) is watched and keeps no position.
   - **The screens:** the details offer "Resume from 12:34" first, then "Play from the start". A tile shows its progress bar.
   - **Done when:**
     - unit tests: the saves (interval, stop, hide), the watched rule, the cap of 500, the details' buttons, the tiles' bars, a profile migration;
     - e2e in English and Arabic: play, leave at a known position, see the bar on the tile; "Resume" asks for the stream from within 5 s of that position; a relaunch keeps it;
     - `e2e:media`: resume lands within 5 s of the position left;
     - the common items: `pnpm verify`, the poly count (219 core-js modules unless a polyfill is truly needed), engines on 53 and 68 if TV screens change, CI green, PR merged.
   - **Watch for:**
     - **The Dialog** fits about 1,100 px of buttons. The details' row already wrapped once (26c used "From the start"). Check an Arabic screenshot.
     - **The i18n runtime isolates arguments.** "Resume from 12:34" takes the time as one argument; e2e strips the marks (`MARKS`).
     - **A profile migration:** the stored profile has a version. Write the old shape in the test.
     - **Tizen and webOS hide events:** the platform adapters' visibility and lifecycle.
2. **Then 26e ("Recently added")**, in its own leg.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `c96c936` Merge PR #71;
  - `f23b35e` docs: tick 26r;
  - `68060da` Merge PR #70;
  - `df1232d` chore: the rename.
- **main** is `c96c936`. The tree is clean. No PR is open.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched by the relay.
- **Gitignored but present:**
  - `node_modules` (with the `@lablo/*` links);
  - `dist/` (the renamed build; `dist/packages` still holds three ipk files under the old name, harmless);
  - `.cache/rollup-wasm` (see the first old gotcha), `.cache/engines`;
  - `.cache/media`, generated before the rename (its burned-in label may still show the old name; CI generates its own; `pnpm mock:media` remakes it);
  - `artifacts/`: `poly-count20c2a.py`, screenshots, `artifacts/engines/` from leg 68's local run.
- **Docker Desktop** was running in leg 68.
  - **Images:** `lablo-old-engines:ba502212364a` (today's `imageTag`) and `lablo-webos-sim:local` are new tags on the existing images.
  - The images under the old name are still there; untag them if you like (`docker images`).
- **On the TV:** only the old lab, under its old id (see the reminders). The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it (LG's license; the repo is public).

## The new names (step 26r)
- **Packages and storage:**
  - packages `@lablo/*`;
  - the IndexedDB `lablo` (the engines harness, `idb-delete.ts` and the lab delete it by name);
  - the font "Lablo Sans" (`lablo-*.woff2`).
- **Test hooks and environment variables:**
  - `window.__LABLO_TEST__`, `__LABLO_PLAYBACK__`, `__LABLO_LAB__`, `__lablo*`;
  - `LABLO_E2E_MEDIA`, `LABLO_ENGINE_CACHE`, `LABLO_E2E_PORT`, `LABLO_LAB_SCALE`, `LABLO_LAB_MEDIA`, `LABLO_MEDIA_FONT`, `LABLO_E2E_THROTTLE`.
- **The mock:** the logins `lablo`/`lablo-test`, the channels "Lablo Test …", and the `lablo-mock` container in CI.
- **The engines:**
  - containers `lablo-<engine>-…` (remove a leftover with `docker rm -f`);
  - the image `lablo-old-engines:<hash>`;
  - the fixture's "Lablo Channel n", "Lablo Film n" and `فيلم لابلو n`.
- **App ids:**
  - webOS `com.lablo.iptv` and `com.lablo.iptv.lab`;
  - Tizen `LabloIPTV1.Lablo` and `LabloLab01.LabloLab`. A Tizen package id is exactly 10 letters and digits (`lab.test.ts`).
- **Arabic:** لابلو. The lab's `/__lab/bytes` line is now 33 bytes.

## Gotchas and lessons
**New in leg 68** (also in memory: `iptv-repo-public-lablo`):
- **A grep for a word misses its other spellings.** The lab's copy of the probe line held the Arabic as `\u` escapes, and the normalize table had full-width letters. Look for those forms in any rename.
- **Text length is load-bearing in tests:** byte counts of probe lines, glyph counts (lam-alef is one glyph), and chunk edges that must split a character.
- **`pnpm install` after renaming workspace packages** says "Lockfile is up to date" and keeps the old order. Leg 68 sorted the importers by script; `pnpm install --frozen-lockfile --offline` checks the result.
- **`python -I` ignores `PYTHONIOENCODING`.** Printing Arabic or arrows fails on cp1252: call `sys.stdout.reconfigure(encoding='utf-8')` inside the script.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module** (since 2026-11-11; Omar keeps it on).
  - Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - It loads `@rollup/wasm-node@4.67.3`, and reaches vitest workers, Playwright's dev server and python scripts that pass `env=os.environ`.
  - Never delete files in `node_modules`.
  - If rollup's version changes, `npm pack @rollup/wasm-node@<ver>` and extract it into `.cache/rollup-wasm/wasm-node` with `tar --force-local`.
- **Chromium 68's V8 reads the zone through ICU, which ignores a `TZ` with a digit.** Keep `FIXED_ZONES` digit-free, and test any harness change on 68 too (`--engine chrome53 --engine chrome68`, about 8 min).
- **Hour-of-day effects:** the Playwright e2e runs at the machine's real clock. Assert the guide's cell, not the exact cursor minute.
- **Reproducing an old bug on the engines:**
  1. `git show HEAD:<file> > <file>`.
  2. `pnpm build:tv`.
  3. Restore the file.
  4. Run `verify:engines`.
- **`TaskStop` on a `verify:engines` run leaves its container.** Remove it with `docker rm -f` (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 5; done` loop, or the Monitor tool (worked again for PR #70's checks).
- **GitHub billing can refuse every Actions job** ("recent account payments have failed").
  - That's a needs-you stop: read `gh api repos/Omarmarei/Lablo/check-runs/<job>/annotations`.
  - Re-run with `gh run rerun <run> -R Omarmarei/Lablo`.
- **The i18n runtime isolates every message argument** (marks plus FSI/PDI). A compound like "7.5/10" must be one argument.
- **The relay context check fires at about 450k tokens.**
- **There is no `jq` in Git Bash.** Use `gh … --jq`. Right after `gh pr create`, checks may not be listed yet: wait about 20 s with a loop.
- **Commands:**
  - one throttled spec: `pnpm --dir "<wt>" exec playwright test --project=throttled --no-deps <spec>`;
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - engines: `pnpm --dir "<wt>" verify:engines --engine chrome53` (about 4 min, needs a fresh `pnpm build:tv`).
- **The poly count:** `python -I -u artifacts/poly-count20c2a.py` right after the first build of new TV code. A member named `at` pulls `Array/String.at` in.
- **TV bundle polyfills:**
  - no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls or array destructuring in TV files;
  - build lists with `for` loops;
  - the build can crash once (0xC0000005): run it again.
- **Bash heredocs feeding python lose backslashes.** Write scripts with the Write tool (in the scratchpad), then `python -I <file> "$WT"`. The Edit and Write tools decode `\u` escapes: build a backslash with `chr(92)` in python.
- **Python's `write_text` on Windows writes CRLF.** It is harmless (`.gitattributes` normalizes).
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Don't push to an open PR's branch while its CI runs:** the push cancels the run.
- **CI media "Install ffmpeg" can hang:** `gh run rerun <run> --failed -R Omarmarei/Lablo`.
- **Local `pnpm verify` may die at the unit stage** (low memory). Run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **The mock:**
  - its panel zone is UTC by default;
  - its synthetic media never plays (real frames need `LABLO_E2E_MEDIA=1 ... --project=playback-media`, or `pnpm e2e:media`);
  - its movies are 201–206.
- **Root tests can't import an apps/tv module that reaches `@lablo/ui`.** Read the source as text instead.
- **Never edit source while a mutation run, `pnpm verify`, `e2e:media` or the engines run is going.** Docs are safe.
- **Code rules:**
  - `packages/ui` components stay hook-free;
  - UI text only from the catalogs (ar.ts has no comments);
  - provider text uses `dir=auto` + `translate=false`;
  - physical CSS only, no CSS Grid or flex `gap`;
  - TV code is ES2017;
  - the app imports only types from `@lablo/data`;
  - dependencies at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` and `Claude-Session` lines.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec node --import tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, its jobs path-filtered (docs alone run none);
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data;
  - keep README.md as "# Lablo" and the About box as "Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. Afterwards: fetch, `git -C "<wt>" merge --ff-only origin/main`, record the merge in RELAY.md (a docs PR, as #71).
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified locally:**
  - lint, typecheck, unit (4,332);
  - both TV builds: 219 modules; main 374.4 KB (Tizen) / 361.7 KB (webOS);
  - `pnpm e2e` 104/104, `e2e:media` 12/12;
  - Chromium 53 and 68: 16/16.
- **Verified on CI (PR #70):** verify, media and engines all green; engines ran 108/108 on 53, 56 and 68.
- **Not done:** any TV.
- **Migrations and deploys:** N/A (no backend until step 29).

## Open decisions and gates
- **Steps 16, 19b and 21 wait for Omar:**
  - **Samsung:** the account, the certificate, the RTL tunnel session, and the used 2018 set.
  - **About 30–45 minutes at the LG TV:** S10, S11, S5's suspend and soak, and the player (step 21). Catch-up, the movies grid, the details and playing can join that visit.
- **For step 41 (the 2018 Samsung):** the decoded memory of a grid of real panel posters, and whether the low tier keeps posters in lists.
- **Later (unchanged):**
  - a CSS seed for the poster grid;
  - fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents;
  - a day jump in the guide;
  - an on-screen keyboard if the TV keyboards fail;
  - webOS's PRE-CH;
  - the accessibility route;
  - pre-buffered zapping;
  - the last frame kept while reconnecting;
  - step 38's settings rows;
  - subtitle parsing off the main thread;
  - a Guide or Info key;
  - drop Chromium 53 (ADR-012);
  - a memory signal for the tier;
  - holding refreshes while a low-tier TV plays;
  - the catalogs as UTF-8;
  - a "loading" look for unread rows;
  - the details, the settings and the picker on the old-engine walk;
  - a screen for a guide's own zone;
  - `SourceMemory` for catch-up;
  - the movie details on the old-engine walk;
  - a walk at a second hour (00:xx, the backward crossing) if the engines job has time.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (now `com.lablo.*` and `LabloIPTV1`, pending trademark clearance) and real icons.

## "Press these keys" checklist for step 26r (Omar)
1. **`pnpm dev`, onboarding:** the first screen says "Lablo is a player" («لابلو مشغّل وسائط» in Arabic), and the backup consent starts «يستطيع لابلو استخدام…».
2. **The exit dialog (Back on the live screen):** "Exit Lablo?" / «الخروج من لابلو؟».

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-three CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description;
  - 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid";
  - 32: the commands table could add the one-engine and one-throttled-spec commands;
  - **33 (new):** its "Repo: private `Omarmarei/Lablo`" line; the repo is public since 2026-11-05.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
