# Zoma IPTV: relay leg 23 opening prompt

You are leg 23 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work.
  - Legs 1–21 did steps 1–13a (PRs #1–#20). Leg 6 did no project work.
- **Leg 22 did step 13b** (onboarding against the provider, saved in the profile). It is ticked in RELAY.md.
  - It first split the old-engine walk out of 13b as step **13c** (commit `9121cb7`).
  - Work commit `0b4b4af`. PR **#21** was merged as merge commit **`aec5e46`**, with the branch kept.
  - CI on `0b4b4af`: `verify` 5 m 36 s, `engines` 3 m 22 s and `media` 8 m 56 s, all green.
  - Step 13's Done-when (a keys-only Playwright run in en and ar against the mock provider) is met by 13b's e2e. Step 13 itself stays unticked until 13c is done; tick it then.

## Your step: 13c, onboarding on Chromium 53/56/68 (the old-engine harness)
RELAY.md step 13c is the spec. **Done when:** `pnpm verify:engines --self-test` is green with the onboarding runs on all three engines, a seeded failure in the walk is caught, and the PR is merged.

**What the walk must do, per engine, in English and in Arabic, by keys only:**
1. Open the app with no `?screen=`: what a TV opens.
2. Language → disclaimer → consent → the M3U option (↓ on the source screen) → the form.
3. Type an M3U link into the playlist field: OK opens the field, then type, then OK (key 13) ends the edit.
   - Use the fixture server the harness already runs: `FIXTURE_ORIGIN` is `http://127.0.0.1:8090` (`tools/engines/src/fixture.ts`), and `dataChecks` names `playlist.m3u` (and `.m3u.gz`).
   - Type it without `http://` if you can: the form adds it, and that path is worth covering.
4. Check that the input really got DOM focus (`document.activeElement.id === 'onboarding-playlist'`).
5. Add source → loading → done, with `data-n` on `[data-testid=done-live]` equal to the fixture's live count.
6. Relaunch (navigate to the same URL again): onboarding is skipped and the hello screen shows.
7. Add one seeded failure that the walk must catch, in the self-test's style (look at how the gallery's CSS seeds work).

**How to build it:**
- Model it on `tools/engines/src/gallery.ts` (`runGallery`, its settle checks and its Arabic phase) and `scenario.ts` (`pressKey` sends `Input.dispatchKeyEvent` rawKeyDown/keyUp; `waitForProbe`; `watchErrors`).
- Wire it in where the gallery runs are wired (`docker.ts`, the run list, `IMAGE_FILES` for any new file the image copies).
- Never edit the Dockerfile's `RUN apt-get` line.
- **Typing:** `Input.insertText` arrived in CDP around Chromium 63/64, so it may not exist in 53/56. Use `Input.dispatchKeyEvent` with `type: 'char'` and `text` per character as the fallback (or for all three). Probe it in 53 first.
- **Fresh IndexedDB per walk:** the containers keep their profile between runs. Once a walk has stored a source, the next walk (the Arabic one, say) skips onboarding. Delete the `zoma` database before each walk: `indexedDB.deleteDatabase('zoma')` from a blank page of the same `file://` origin, or a fresh user-data-dir. Do it only while no app page is open, or the delete blocks. The hello runs ingest a `debug` source into the same database; the loader ignores that id (`s1` is still next).
- **The start is slower now:** the app asks the query worker for the profile before the first screen (a spinner with `data-ready="false"`, capped at 10 s). Settle on `[data-testid=onboarding][data-ready=true]`, not on the first paint.
- **Arabic:** after picking العربية, `<html dir>` is `rtl` and RIGHT moves towards the start of a row. Look at an Arabic screenshot from one old engine.
- Document it in `docs/runbooks/old-engines.md` and in architecture.md §1.2, then tick 13c and 13 in RELAY.md.

**If 13c is small**, start step 14 (the live browse screen) only if this leg is still light. Step 14 replaces the hello screen behind "Start watching" and a stored source (`showHello` in `apps/tv/src/main.tsx`).

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `aec5e46` started at handover. If a job is red, fix it on the relay branch first.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.
4. Start Docker Desktop if `docker info` fails.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths. Don't `cd` in Bash.
- When a script needs the worktree as its cwd, use `python -I -c "import os,subprocess,sys; os.chdir(r'<wt>'); sys.exit(subprocess.call('<cmd>', shell=True))"`.
- Never use bare `git stash`: the stash stack is shared with the main checkout and other sessions.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the package boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: steps 13b (done) and 13c, and the leg-22 row of the progress log.
3. `docs/runbooks/old-engines.md`, then architecture.md §1.2 "Built in step 13a" and "Built in step 13b".
4. These files:
   - `tools/engines/src/{gallery,scenario,fixture,docker}.ts` and their tests;
   - `apps/tv/src/main.tsx`, `apps/tv/src/onboarding/{engine-loader,start,onboarding-state,OnboardingApp}.ts(x)`;
   - `e2e/onboarding.spec.ts`: the same walk in current Chromium. Its `typeInto`, `storedProfile` and `recordPhases` helpers are worth copying.

## What 13b built (use it, don't rebuild it)
- **Loader** (`apps/tv/src/onboarding/engine-loader.ts`, `createEngineLoader`). The fake loader stays for unit tests.
  1. `checking`: the source gets its id. Ids are `s1`, `s2`… (`nextSourceId`), one past the highest in the profile or in the catalog stores, and never reused.
  2. `download` and `saving`: `DataEngine.refresh` (`commit` maps to `saving`).
  3. `guide`: `refreshEpg` with `due: true`, over every stored source's guides plus the typed guide link (a `UserGuide`). A guide failure doesn't fail the source.
  4. `editProfile` adds the source, then the counts show.
  - Cancel reaches the worker (`CancelSource`, now exported from `@zoma/data/client`). A new load waits until the cancelled one has freed the refresh slot.
- **Account check in the ingest** (`packages/data/src/ingest.ts`, right after the Xtream login): `user_info.status` Expired gives `expired`, and Banned or Disabled gives `blocked` (core `xtreamAccountProblem`, new `IngestErrorCode`s, `error.blocked` in en/ar). Only the status decides.
- **RPC:** errors carry a numeric `status` (`RpcError.status`). `loadError` maps the ingest's codes; `superseded` and unknown codes are `other`.
- **Profile v2** (migration 1 → 2 in `profile.ts`):
  - `sources` (`SourceRecord`: id, type, name, the account or link, `epgUrl`, `added`);
  - `onboarding` (`language`, `disclaimerAt`, `consent`).
  - The query worker serves `profile` and `editProfile` (read-modify-write). `updateProfile` gained `create`.
  - Each answer is saved as it is given (`OnboardingOptions.answer`, via `answerEdit` in `start.ts`).
- **Start** (`main.tsx` + `start.ts`):
  - `readStartProfile` (10 s cap, null on failure), then `startPoint`.
  - A stored source opens `showHello`. Otherwise onboarding opens, with the saved language preselected and active.
  - One shared `DataEngine` (`dataEngine()`). `?screen=hello` and `?screen=gallery` don't read the profile.
- **Done screen:** `[data-testid=done-live|movies|series]` carry `data-n`.
- **Size:** main's own code 166.3 KB (tizen) of 500, with no new polyfill. The query worker is 96.2 KB of 150 (`profile.ts` brought `es.json.stringify`).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and the leg-22 progress row, on top of `0b4b4af`. It is pushed, and the tree is clean.
- **main** has `aec5e46`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/`, `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate13b.py` (44 mutants, 3 of them e2e; one equivalent dropped). Run one with `python -I -u artifacts/mutate13b.py "<snippet>"`;
    - `mutate13a.py`, `make-size-probe3.py`;
    - the logs `verify13b.log`, `engines13b.log` and `mutate13b.log`;
    - `screenshots/`.
- **Local gates on `0b4b4af`:**
  - `pnpm verify`: 1895 tests in 101 files, both builds through both gates, e2e 38/38;
  - `verify:engines --self-test`: 54 runs as expected, 38 seeded failures caught;
  - 44/44 mutants.

## Gotchas and lessons
**New in leg 22 (also saved to memory):**
- **Reading the app's IndexedDB from a test page:** `indexedDB.open('zoma')` without a version creates an empty version-1 database if the app hasn't opened it yet. The app's later migrations would then skip the store creation. Only read it after the app has booted (the boot reads the profile, so the database exists once `data-ready` is true).
- **Cancel tests need a fake whose cancelled call settles later.** A fake that rejects the moment it is cancelled let four loader mutants survive: the slot hand-over, progress arriving after a cancel, a guide finishing at the cancel, and the early cancel check. Hold the cancelled call open, start the next load, assert it waits, then settle.
- **A before/after polyfill diff without a stash:** back up the changed source files, `git checkout HEAD -- <files>`, run `make-size-probe3.py`, then copy them back. Compare the core-js module sets per table. Worker tables can come out in a different order between runs, so match them by name.
- **The mock in e2e:** start it in `test.beforeAll` (one per Playwright worker; `fullyParallel` is fine). Type `host:port` without `http://`. Its test logins come from `apps/mock-provider/test/helpers` (`U`/`P`) and `fixtures/server.yaml` (`expired`, `banned`, `disabled`, `trial`, `forever`, each with password `<name>-test`). CORS works from the dev server and from `file://`.
- **Mock counts:** 12 live channels, 6 films, 2 series, 11 of 12 channels with a guide. Arabic shows 2 series as "مسلسلان" (the dual form, no digit), so check `data-n` rather than digits in the text.
- **Monitor commands:** process substitution (`<(...)`) fails. Write a small Python poller (as for `gh pr checks`) and run it with `python -I -u`.

**From earlier legs (still true):**
- **Polyfills:**
  - `new RegExp(...)` in TV code pulls in core-js's RegExp (+7 KB), and `.split(` pulls in `es.string.split` (+2 KB).
  - Babel picks polyfills by property name, even on your own objects (`at`, `values`, `includes`…).
  - A package index import drags in every module's polyfills: import from `@zoma/data/client`.
- **Terser `ascii_only`:** each Arabic character costs 6 bytes in main.js.
- **The Write tool turns `\uXXXX` escapes into raw characters.** In TV code, use `String.fromCharCode`, and scan for U+200E/200F/202A–202E/2066–2069 afterwards.
- **Bash heredocs (even quoted) still lose `\\`.** Write Python patch scripts with the Write tool, then run them with `python -I`. Print Arabic only after `sys.stdout.reconfigure(encoding='utf-8')`.
- **Keys aimed at an `<input>` never reach the focus engine.** In e2e: Enter opens the field, `page.keyboard.type`, then Enter. A click within 500 ms of an OK key is dropped as that key's twin.
- **`nav.back()` skips the screen's `onIntent`.** Tests of Back must send `nav.handle('BACK')`.
- **Text arguments carry six invisible characters** (LRM/RLM outside FSI/PDI). Compare with `stripIsolates`, or `isolated()` in e2e.
  - Chromium 53/56/68 ignore FSI/PDI: check any new bidi-sensitive text with the harness's probe pattern.
- **Look at the Arabic screenshot after any text change.** A Latin span followed by digits needs `dir` on the span.
- **Root `test/` can't import `@zoma/ui`** (and has no JSX in tsc): use relative non-tsx imports. e2e can import `../packages/core/src/*`, `../tools/engines/src/*` and `../apps/mock-provider/{src,test}/*`.
- **Components stay hook-free** (VNode-walk unit tests).
- **CSS:** physical properties only; postcss-rtlcss mirrors by the page's direction.
- **Old-engine harness:**
  - Docker image: never edit the `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - A container can miss DevTools once: rerun with `--engine`.
  - Engine runs overwrite `artifacts/engines`.
  - The headed Chromium 53–68 page is 1919x974 unless the run uses `--kiosk --test-type`.
- **Profile and IndexedDB:** never `await` inside a transaction (on Chromium 53 it commits early). The same key twice in one IDB transaction loses an update.
- **Mutation scripts:** run them with `python -I -u`. They edit sources in place, so don't run other tests or builds while one runs.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. **Smart App Control is on:** never weaken lint.
- **TV code:** `lib: ES2017`.
- **Commits:**
  - scoped `git add`, then `git commit -F`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes;
  - after `gh pr create`, wait about 30 s before reading the checks.
  - If the auto-mode classifier gives no verdict on the merge, retry once.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Six gaps are open:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: it starts on onboarding, or on the hello screen once a source is stored, with `?screen=hello` and `?screen=gallery` as developer screens;
  5. the `verify:engines` row should mention the gallery checks, the CSS seeds and the Arabic phase;
  6. a Conventions line: UI text comes only from the catalogs through `appI18n` (ADR-011), `zoma/no-hard-coded-text` enforces it, text arguments are isolated by core's `isolateText`, and a screen with an input uses `TextField`/`createTextEditor`.

## The 3 riskiest changes in PR #21
1. **The start screen now waits for the profile** from the query worker, behind a spinner, capped at 10 s. A slow first IndexedDB open on an old TV delays the first screen. 13c measures it in Chromium 53/56/68.
2. **Profile v2 is a migration.** Any stored v1 profile is upgraded, with a snapshot, on its first read. v1 never shipped, but the path is live.
3. **Expired, banned and disabled Xtream accounts now fail a refresh** (`expired`/`blocked`) instead of reaching the lists. Later background refreshes will do the same, and keep the old catalog.

## Verified vs not
- **Verified:**
  - the whole flow by keys in en and ar against the mock in the dev app;
  - the mock's counts, the phases, the saved profile, a relaunch that skips onboarding, and the language after a relaunch mid-onboarding;
  - the wrong-password, banned and expired messages, "Edit details" and "Try again";
  - both TV bundles adding the mock's playlist from `file://` and skipping onboarding on a relaunch;
  - the loader on the real services against the mock (every failure code);
  - the Arabic done and failed screenshots looked at;
  - CI green, merged.
- **Not done:**
  - onboarding in Chromium 53/56/68 (13c);
  - the first-start profile wait measured on old engines (13c);
  - any TV keyboard on hardware (step 16, S10);
  - CI on main at `aec5e46` (it started at handover).
- **Migrations and deploys:** N/A (no backend until step 29). The profile migration is client-side IndexedDB, with no production data.

## Press these keys (Omar, desktop browser)
1. In one terminal run `pnpm mock` (the mock provider on port 8080); in another run `pnpm dev`. Open `http://localhost:5173/?locale=en-US` in a private window.
2. Press **Enter** four times (English, I understand, Allow, Xtream login). The form shows five fields.
3. On "Server address", press **Enter**, type `127.0.0.1:8080`, then press **Enter**.
4. Fill Username with `zoma` and Password with `zoma-test` the same way. These are the mock's test login.
5. Press **↓ ↓ Enter**. "Adding 127.0.0.1" shows briefly, then "You're all set" with **12 channels, 6 films, 2 series**.
6. Press **Enter** on "Start watching": the hello screen. Press **F5**: the hello screen again. Onboarding is skipped because the source is saved.
7. In a new private window, repeat with password `wrong`: "The provider didn't accept this username and password." Press **Enter** (Edit details): the form keeps everything.
8. Try username `banned` with password `banned-test`: "Your provider has blocked or turned off this account…". Try `expired` with `expired-test`: "This account has expired…".
9. In a new private window, open `?locale=en-US` and press **→ Enter Enter** (Arabic, then I understand). Press **F5**: the language screen comes back in Arabic, with العربية focused.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended; it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 22 was the 22nd.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Six CLAUDE.md gaps** are waiting for his word (listed above).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
