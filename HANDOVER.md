# Zoma IPTV: relay leg 31 opening prompt

You are leg 31 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–29 did steps 1–15b2 (PRs #1–#28). Leg 6 did no project work.
- **Leg 30** did **step 15b3: spike S10 (input)**.
  - Commits `d8ee293` (the work) and `c40004f` (the RELAY tick). PR **#29** was merged as merge commit **`54d5677`**, with the branch kept.
  - CI on `c40004f` was green on the first run: `verify` 6 m 9 s, `engines` 14 m 14 s (of its 25-minute limit), `media` 9 m 12 s.

## Your step: 15c (RELAY.md is the spec)
"The player batteries (S4, S5, S8)." **Done when:** the `<video>` battery runs in the desktop browser against the mock's media and posts every row (codecs the browser lacks recorded as such); the AVPlay battery runs against an AVPlay fake in unit tests; PR merged.

1. **Check first** that none of it exists:
   - `git log --oneline -10`;
   - `ls apps/tv/src/lab/spikes` (today: `s0-s1.ts`, `s2-s3.ts`, `s6.ts`, `s7.ts`, `s9.ts`, `s10.ts`, `s11.ts`, `index.ts`, plus `s6.test.ts`, `s10.test.ts`, `s11.test.ts`);
   - `packages/player/src/index.ts` is still an empty skeleton (`export {}`); PlayerController is step 17.
2. **It is probably too big for one leg.** Legs 27–29 split 15a/15b/15b2 the same way: first split 15c in RELAY.md (its own commit), then do the first part. A natural split:
   - 15c: the `<video>` battery (S5, webOS and the desktop) on the mock's media;
   - 15c2: the AVPlay wrapper through the Tizen adapter, its fake, S4 and S8.
3. **Read:**
   - architecture.md §5: the S4, S5 and S8 rows (the pass criteria, the fallbacks);
   - `docs/runbooks/mock-provider.md`: the media routes (`/live/….ts|.m3u8`, `/hls/…`, `/movie/…` with Range, catch-up), `pnpm mock:media` (ffmpeg into `.cache/media`: live loops, multi-audio ara/eng/spa + AC3/E-AC3 5.1, 4K HEVC, SRT in MKV, mov_text in MP4) and the 302 behaviour;
   - S6's `/__lab/source`: how the lab gets a test account's URLs without holding credentials.
4. **The spike list is full.** Rows are 80 px (72 + 8); nine rows (S10 added) reach 1010 of the 1026 px title-safe height. S4, S5 and S8 need shorter rows or a paged list. Look at a screenshot.
5. **Each new check goes into four places:**
   - `DESKTOP` in `e2e/lab.spec.ts` (plus its `BUNDLE` table if a TV bundle answers differently);
   - `EXPECTED_STATUSES` (plus `PLATFORM_STATUSES`) in `tools/engines/src/lab.ts`; a unit test keeps them in step;
   - the end-record counts in the e2e ("Run all": today `pass 16, fail 3, info 14, skip 11`);
   - the record counts in `tools/engines/src/lab.test.ts` (today 44 checks, 46 records).
   
   A long check in "Run all" also slows the harness's lab run (8 s today per engine and bundle) and e2e.
6. **Media in the old-engine harness:** the harness starts the mock with `--no-media` (placeholder bytes). Decide whether the battery skips there or the harness gets real media.
7. **Definition of Done** (CLAUDE.md):
   - `pnpm verify`;
   - `pnpm verify:engines --self-test` (102 runs and 74 seeds today);
   - `pnpm verify:media` if the mock's media or streams change;
   - a mutation check (copy `artifacts/mutate15b3.py`; run `--check` first, which confirms every snippet is found once);
   - a PR merged on green CI;
   - a "press these keys" checklist.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If the run on `54d5677` is red, fix it on the relay branch first. If only `engines` is red with "DevTools … did not answer", rerun it with `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`. Start Docker Desktop if `docker info` fails.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation. Use `git -C`, `pnpm --dir` and absolute paths. Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 15c, steps 15d–15e, step 16 (needs Omar), and the progress-log rows for legs 28–30.
3. `docs/runbooks/lab.md` and architecture.md §5 (its "Built in step 15b3" block).
4. The code in `apps/tv/src/lab/`:
   - `types.ts`: `LabContext` with `interactive`, `ask`, `testKeys`, `typeText` and `keys`; `LabBaseContext` / `LabRunExtras`;
   - `lab-state.ts`: `createLab` needs `target` (the window) and a platform with `keyToIntent`, `onPointer`, `textKey` and `onSoftKeyboard`;
   - `LabApp.tsx`, `runner.ts`, `reporter.ts`;
   - `spikes/s6.ts` (the app's own engine mounted over the lab; `/__lab/source`) and `spikes/s10.ts`.
   
   Also `tools/engines/src/lab.ts` and `e2e/lab.spec.ts`.
5. Memory `iptv-zoma-lab-gotchas` (updated in leg 30), `iptv-ui-test-gotchas`, `bg-watcher-memory-reap`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md on top of `c40004f`. It also records PR #29's merge in RELAY.md and softens two unverified comments (Tizen key objects, `WebAPIException`). It is pushed, and the tree is clean.
- **main** has `54d5677`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (the app and the lab built from the real sources), `.cache/*` (media included), the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate15b3.py` (75 mutants) and its log;
    - `verify15b3.log`, `engines15b3.log`, `build15b3.log`;
    - `s10-*.png` (screenshots of S10's screens);
    - `poly15b3.txt` (core-js modules per bundle, from `poly-probe.py`).

## What step 15b3 built (for reference)
- **`Platform.registerKeys()` returns a `KeyRegistration`** (`skipped`, `supported`, `registered`, `unsupported`, `refused`):
  - Tizen: `registerTizenKeys` in `packages/platform-tizen/src/keys.ts`. It records the TV's key list, copied into plain objects; one `registerKey` per key, each in its own try/catch; a refusal keeps the exception's name and message.
  - webOS and the browser return `skipped`.
  - The app ignores the result. App main +0.5 KB (Tizen 180.6) and +0.1 KB (webOS 179.7).
- **S10** (`spikes/s10.ts`), four checks:
  - `registration` (unattended): Tizen `pass` unless refused or the API is missing; webOS `info`; browser `skip`;
  - `keys` (the key tester): `pass` when a key came for every one of the 29 Intents, `fail` naming the missing ones; it records each distinct key's code, `key`, Intent and count;
  - `pointer`: counted while the tester is open; `pass` on moves and clicks;
  - `keyboard`: the app's `TextField` + `createTextEditor`. GREEN with Arabic and Latin letters typed is a `pass`.
  
  The last three run only when S10 is started from its row.
- **Screens:**
  - `keys/keys/0`: capture-phase window listeners; `onIntent` swallows every Intent; Back twice in a row or 5 minutes ends it;
  - `type/field/0`: OK opens the field; Enter or the keyboard's Done ends an edit as `done`, Escape as `close`; GREEN, RED or Back answers.
- **Old engines:** both bundles as expected on 53/56/68 (Tizen's `registration` fails without TV APIs; webOS's is `info`). The two screens were driven only in desktop Chromium.
- **Lab main:** 210.4 → 222.3 KB of its own code.

## Gotchas and lessons
**New in leg 30** (also saved to memory: `bg-watcher-memory-reap`, `iptv-zoma-lab-gotchas`, `iptv-parser-test-patterns`, `use-write-tool-for-doc-batches`):
- **CI wait: copy leg 14's Monitor command from memory `bg-watcher-memory-reap` verbatim** (only the PR number changes). Leg 30 wrote `comm -13 <(…)` again, the monitor stayed silent for 30 minutes after CI had passed, and 16 minutes were lost. Never put `<(` in a Monitor command.
- **`e2e/lab.spec.ts` declares its own `interface Record`**, which shadows TypeScript's `Record<K, V>` (TS2315). Use an index signature there.
- **A "listener not removed" mutant hides behind a result captured at resolve time** when the closure rebuilds its array on each event. After the screen closes, fire the event again and assert on the live signal.
- **Python patch scripts whose `sub()` writes after each pair** can stop half-applied. Rerun only the rest, or check all pairs first.
- **Long Bash heredocs failed once more.** Write patch scripts and big snippets with the Write tool into the job's tmp folder, then run them.

**From earlier legs (still true):**
- **Two guards that each suffice hide each other's mutants:** keep one. Use exact float boundaries in tests. A guard that never fires in the browser needs a pure verdict function to be tested.
- **Bundle statuses differ per platform:** the e2e `BUNDLE` table, the harness `PLATFORM_STATUSES`. The harness test parses both e2e tables.
- **Never commit or build while a mutation run is going:** it edits sources in place. Docs and RELAY.md edits are safe meanwhile.
- **The lab under `pnpm dev` shares the dev app's origin:** for a manual lab run next to dev data, `pnpm --filter @zoma/app-tv exec vite --port 5174`.
- **IndexedDB:**
  - deletes go through `idb-delete.ts`, since `blocked` is not a failure;
  - never `await` inside a transaction.
- **Perf budgets:** calibrate on CI (the 2-vCPU runner at 4x is about 2x slower than Omar's PC).
- **The `RemoteDriver` contract:** a screen root has `data-screen/zone/index`, and its navigator goes to `showFocus`. `INTENT_KEYS`: BACK is Escape, RED is F1, GREEN is F2.
- **Polyfills:** Babel picks core-js polyfills by property name. Probe each new file that reaches the app's main bundle (`artifacts/poly-probe.py`).
- **The Write tool turns `\uXXXX` escapes into raw characters.** Use `String.fromCharCode` or hex code ranges in sources, and Python `chr()` in patches.
- **Text arguments carry isolate marks:** compare with `stripIsolates`. Chromium 53/56/68 ignore FSI/PDI.
- **Root `test/`** can't import `@zoma/ui` or `.tsx` files.
- **Code rules:** components stay hook-free (the lab's screens use hooks, as before); CSS uses physical properties only (no grid or flex `gap` on Chromium 53); TV code is `lib: ES2017`.
- **Old-engine harness:**
  - never edit the Docker image's `RUN apt-get` line;
  - engine runs overwrite `artifacts/engines`;
  - on the DevTools flake, rerun the whole self-test or the CI job.
- **The e2e mock** pins its clock to 2026-11-02 12:00 UTC (`mock({ now: Date.now })` for the real clock).
- **Mutation scripts** edit sources in place. Run them with `python -I -u`.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge with `gh pr merge --merge` on green CI and keep the branch;
  - after `gh pr create`, check that the run's `headSha` is the PR's head before merging.
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #29
1. **`Platform.registerKeys()` changed its return type in every adapter, and the app's main calls it at boot.** Tizen's registration now goes through `registerTizenKeys`: still one call per key, each in its own try/catch. `getSupportedKeys()` is now called twice (registration and the key map).
2. **While open, the lab's key tester adds capture-phase `keydown`/`click`/`wheel` listeners on the window, and the keyboard test moves DOM focus into an input.** Both are lab-only and are removed when the screen closes.
3. **The e2e and harness tables gained S10's rows:** Tizen's registration fails without TV APIs, webOS's is `info`.

## Verified vs not
- **Verified:**
  - S10 in desktop Chromium by keys: all 28 non-Back Intents and `q`, the pointer (moves, a click, the wheel), Back twice, the field typed `زوما Zoma` with Enter (`done`), a second edit closed with Escape (`close`), GREEN. Every record checked; the screenshots were looked at.
  - S10's unattended rows in "Run all" and in both bundles from `file://`.
  - Chromium 53/56/68: the local self-test (102 runs as expected, 74 seeds), and CI green.
  - `pnpm verify`: 2,284 tests in 132 files, e2e 51/51.
  - 75/75 mutants caught.
- **Not done:**
  - the key tester and the keyboard test on an old engine or a real TV (step 16): Tizen's IME codes (65376/65385), webOS's PRE-CH code, the Magic Remote's events, the Arabic keyboard;
  - S4, S5, S8 (15c); the docs (15d); emulators (15e).
- **Migrations and deploys:** N/A (no backend until step 29).
- **"Press these keys" checklist for S10 (desktop):**
  1. Run `pnpm mock` in one terminal and `pnpm dev` in another. Open `http://localhost:5173/lab.html?server=http://127.0.0.1:8080&auto=0` at 1920x1080.
  2. Press ArrowDown 7 times (to S10), then Enter. The key tester opens with 29 dark boxes.
  3. Press ArrowUp, 1, F1 and p. The Up, 1, Red and PRE-CH boxes light up with 38, 49, 112 and 80. Press q: "Keys with no action: 81 q".
  4. Move the mouse and click. The pointer line counts the moves and the click.
  5. Press Escape once: Back lights up, and "Back 1 of 2". Press Escape again: the keyboard test opens.
  6. Press Enter, type `زوما Zoma`, press Enter. The line reads "Edit 1 ended with done; its keys: 13 Enter".
  7. Press F2 (GREEN). S10 shows FAIL: `keys` names the Intents you didn't press, `keyboard` passes.
  8. On a TV (step 16): runbook lab.md "S10 by hand".

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended: it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
  
  Data from S9: the old engines' `Intl` gives Arabic-Indic digits to every Arabic tag, ar-AE included.
- **Later, once S10 and S11 have run on a TV:**
  - an on-screen keyboard of our own, if the TV keyboards fail (+2 sessions);
  - a mapping for webOS's PRE-CH key, once its code is known;
  - the app's accessibility route (DOM focus, `aria-live` or `Platform.speak`);
  - `supportsAudioGuidance` in the app's appinfo.json.
  
  These are product decisions for when the answers exist; nothing is blocking now.
- **Step 15e** (the lab in an emulator) likely needs Omar: VirtualBox, Tizen Studio, a Samsung account. Try first whatever needs none (the webOS TV Simulator). The webOS emulator and simulator don't support accessibility (LG's docs).
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:**
  - steps 21, 34, 44, 46 and 47;
  - before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs; leg 30 was the 30th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Eleven CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: it starts on onboarding, or on the live screen once a source is stored, with `?screen=hello` and `?screen=gallery` as developer screens, plus `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk to the live screen, the focus agreement, the lab runs (102 runs, 74 seeds);
  6. a Conventions line on UI text through `appI18n` (ADR-011), `zoma/no-hard-coded-text`, `isolateText` and `TextField`/`createTextEditor`;
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__` and the `throttled` project;
  8. the `build:tv` row's lab target and options, `pnpm device … --lab`, and the platform-globals line (`PalmServiceBridge` is webOS-adapter only);
  9. a `pnpm lab:scale` row (S6 on the fixtures; needs `pnpm fixtures`), and the mock row's `/__lab/source` and `/__lab/guide.xml.gz`;
  10. the `Platform` interface's calls from step 15b2 (`setScreenSaver`, `screenReader`, `speak`) and where each adapter gets them (Tizen `tv-settings.ts`, webOS `speech.ts`);
  11. **new:** `Platform.registerKeys()` now returns a `KeyRegistration` (Tizen `registerTizenKeys` in `keys.ts`).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
