# Zoma IPTV: relay leg 22 opening prompt

You are leg 22 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:**
  - Leg 0 planned the work.
  - Legs 1–20 did steps 1–12 (PRs #1–#19). Leg 6 did no project work.
- **Leg 21 split step 13 (onboarding, PLAN 4.4) into 13a and 13b, and did 13a.** It is ticked in RELAY.md.
  - Commit `2a04908`. PR **#20** was merged as merge commit **`48746a4`**, with the branch kept.
  - CI on `2a04908`: `verify` 5 m 29 s, `engines` 3 m 31 s and `media` 9 m 12 s, all green.

## Your step: 13b, onboarding against the mock provider (rest of PLAN 4.4)
RELAY.md step 13b is the spec. Step 13's Done-when is yours: **a keys-only Playwright run passes in en and ar against the mock provider.**
- **Saved state:**
  - Profile v2 is a migration in `packages/data/src/profile.ts` (`PROFILE_MIGRATIONS` is append-only; `profile.test.ts` pins the shapes). It holds:
    - the sources, with their logins in IndexedDB only (step 32 encrypts them with `localKey`; say so in a comment);
    - the onboarding answers: language, disclaimer accepted, device-ID consent.
  - The app reads and writes it through the query worker (new RPC methods in `query-service.ts`). The ingest worker already updates the favourites in the same document, so use `updateProfile`-style read-modify-write transactions, never a blind save.
  - At start, `main.tsx` asks for the profile before it picks a screen. With a source stored, it skips onboarding (for now "Start watching" and a stored source both open the hello screen, until the live screen comes at step 14).
  - The language choice must survive a relaunch.
- **Loader:** replace `createFakeLoader` in `main.tsx` with an engine-backed `SourceLoader` (`apps/tv/src/onboarding/loader.ts` holds the interface; keep the fake for unit tests).
  - Xtream: check `user_info` first: auth, expired, banned or disabled. Look at core's `XtreamClient`/`xtream-base.ts` and the mock's test accounts "in every `user_info` state". `expired` already has its message (`error.expired`).
  - Then `DataEngine.refresh({ src, source }, { onProgress, cancel })`. `IngestProgress` (download/commit, bytes, total, items) maps to `LoadProgress`: `commit` is `saving`. Then `refreshEpg` for the playlist's or panel's guide, plus the user's guide link as a `UserGuide`. That is a new phase `guide`, with new en/ar strings.
  - Map `IngestErrorCode` to `LoadErrorCode`: `superseded` becomes `other`, and `http` keeps its status.
  - `cancel` needs a `CancelSource`, but it is exported only from the `@zoma/data` index. Importing that index into main drags every data module's polyfills along (memory `iptv-tv-bundle-polyfills`), so export it from `@zoma/data/client` instead (`client.ts` already imports `rpc.ts`).
  - Pick a stable source id scheme (`src` scopes ContentKeys; ADR-009).
- **Old engines:** a new harness run walks onboarding by keys in Chromium 53/56/68.
  - Use an M3U link to the fixture server on `127.0.0.1:8090`, which the harness already runs.
  - Type with CDP `Input.insertText` or key events after OK, and check that the field got DOM focus and the done screen's count.
  - Look at `tools/engines/src/{scenario,gallery}.ts`, `docker.ts` (`IMAGE_FILES`) and `fixture.ts`.
- **e2e against the mock:** see how `e2e/tv-bundle.spec.ts` starts it in-process: `mock()`/`listen()` and the test logins `P`/`U` from `apps/mock-provider/test/helpers`. Credentials stay in the mock's fixtures, never in app code. The run covers:
  - the whole flow in en and ar, by keys only, reaching done with the mock's real counts;
  - a wrong password showing the auth error, then "Edit details";
  - a reload skipping onboarding.
- **The step is big again. Split it if it doesn't fit,** e.g. 13b (profile, loader, e2e) and 13c (the old-engine onboarding run). Write the split into RELAY.md first, as leg 21 did.
- Finish with a "press these keys" checklist, and look at the Arabic screenshots.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. The run on `48746a4` started at handover. If a job is red, fix it on the relay branch first.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation.
- Use `git -C`, `pnpm --dir` and absolute paths. Don't `cd` in Bash.
- When a script needs the worktree as its cwd, use `python -I -c "import os,subprocess,sys; os.chdir(r'<wt>'); sys.exit(subprocess.call('<cmd>', shell=True))"`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the package boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: steps 13a (done) and 13b, and the leg-21 row of the progress log.
3. docs/architecture.md §1.2 "Built in step 13a", §1.3 (storage and the profile), §1.4 (the ingest worker, `DataEngine`), §3.3 B (the backup that the consent screen discloses).
4. These files:
   - `apps/tv/src/onboarding/*`, `apps/tv/src/main.tsx` and `apps/tv/src/data/engine.ts`;
   - in `packages/data/src`: `profile.ts`, `query-service.ts`, `client.ts`, `ingest.ts` and `ingest-errors.ts`;
   - `packages/core/src/xtream*.ts`;
   - `apps/mock-provider` (the accounts and the `user_info` states).

## What 13a built (use it, don't rebuild it)
- **Text input:** `TextField` (ui) wraps a native `<input>`.
  - `createTextEditor` + `bindEditor` give it DOM focus on OK or a click.
  - The edit ends on `Platform.textKey`:
    - the desktop: Enter, Escape, ↑ and ↓;
    - Tizen: 13, the IME's Done (65376) and Cancel (65385), and Back (10009);
    - webOS: 13 and Back (461).
  - It also ends on a blur, or on webOS `keyboardStateChange` (`Platform.onSoftKeyboard`). `done` and ↓ move the focus down and ↑ up; the text is always kept.
  - The click's twin key 13 is ignored within 500 ms of the open, unless something was typed.
  - `connectRemote` skips keys aimed at an editable element (`isEditable`), so Backspace deletes in a field.
  - The TVs' real keyboards are spike S10 (step 16).
- **Start screen:** onboarding by default (`readScreen`). `?screen=hello` and `?screen=gallery` are developer screens.
  - The hello screen keeps its lint exemption, narrowed and re-justified: its diagnostics are read by the e2e tests and the harness. The harness `appUrl` and the hello/tv-bundle e2e add `?screen=hello`.
- **Flow** (`onboarding-state.ts`), on the router's back stack:
  1. `language`: both languages' own words, the TV's language focused (`preselect`). Picking one switches the app live in `OnboardingApp`.
  2. `disclaimer`.
  3. `consent`: Allow / Not now, with the backup disclosure.
  4. `source`: Xtream or M3U, with the focused option's hint underneath.
  5. `form`: `FORM_FIELDS`; `checkForm` via `normalizeLink` and core's `normalizeXtreamBase`; the first refused field takes the focus.
  6. `loading`: Cancel. On failure, `TWO` buttons: Edit details / Try again.
  7. `done`, which becomes the new root through `nav.reset`; `root` is a signal.
  - State signals: `language`, `consent`, `type`, `values`, `problems`, `draft`, `load` (`idle`/`running`/`failed`/`done`), `finished`.
  - Loads are guarded: a cancelled load's late answer is dropped, and cancelling sets `idle`.
- **Catalog keys:** `app.name`, `onboarding.*`, `field.*`, `loading.*`, `error.*` (one per `LoadErrorCode`) and `done.*`.
  - Xtream, M3U, XMLTV and `http://` are arguments (`NAMES` in `OnboardingApp.tsx`), so the Arabic has no Latin.
  - `loading.download` has Arabic `zero` = "لا توجد عناصر بعد".
- **Tests:**
  - unit: the adapters' text keys; `isEditable`; `text-editor.test.ts`; `TextField` at VNode level; `form.test.ts` (fast-check, so `apps/tv` gained a `fast-check` devDependency); `onboarding-state.test.ts`, with the fake loader and a hand-driven loader.
  - e2e `onboarding.spec.ts` (7 tests: the whole flow by keys in en-US and ar-SA, the switch, Back, the caret keys, the click twin, en-XA) and `tv-bundle.spec.ts`: both bundles start on onboarding and type into a field.
  - The screenshots go to `artifacts/screenshots/onboarding-*.png`; `docs/design/onboarding-{en-US,ar-SA}-form.webp` are committed.
- **Size:** main's own code 161.9 KB (tizen) / 160.7 KB (webos) of 500, with no new polyfill.
  - Terser's `ascii_only` makes each Arabic character 6 bytes: about 12 KB of that is the new Arabic strings.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md and recording PR #20's merge in RELAY.md, on top of `2a04908`. It is pushed, and the tree is clean.
- **main** has `48746a4`; the branch doesn't, which is normal.
- **Gitignored but present:**
  - `node_modules`, `dist/`, `.cache/{media,fixtures,engines,fonts}`, Playwright `chromium-1248`, the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate13a.py` (58 mutants, 4 of them e2e; run one with `python -I -u artifacts/mutate13a.py "<snippet>"`);
    - `mutate12b.py`, `make-size-probe3.py`;
    - the logs `verify13a.log`, `engines13a.log` and `mutate13a.log`;
    - `screenshots/`.
- **Local gates on `2a04908`:**
  - `pnpm verify`: 1859 tests in 98 files, both builds through both gates, e2e 34/34;
  - `verify:engines --self-test`: 54 runs as expected, 38 seeded failures caught;
  - 58/58 mutants.

## Gotchas and lessons
**New in leg 21 (also saved to memory):**
- **Keys aimed at an `<input>` never reach the focus engine.**
  - In e2e, type the remote's way: Enter opens the field, then `page.keyboard.type`, then Enter.
  - Any future screen with an input must use `TextField`/`createTextEditor`.
  - A click within 500 ms of an OK key is dropped as that key's twin: wait 600 ms first.
- **`nav.back()` skips the screen's `onIntent`.** Tests of a screen's Back handling must send `nav.handle('BACK')`.
- **A fake that stops when cancelled can't test stale-answer guards.** Use a hand-driven loader whose `cancel()` only counts.
- **Chromium fires no blur when the focused input is removed.** The editor's `onEditFocus` handles that case.
- **Terser `ascii_only`:** each Arabic character costs 6 bytes in main.js. If the catalogs grow a lot, ship them as a UTF-8 file.
  - For a quick size check without a stash, swap a copy of `main.tsx` without the new screen, run `build:tv`, then restore it.
- **Mutation scripts:** run them with `python -I -u`. Without `-u` their log stays empty until the end, so a Monitor sees nothing.
- **Bash heredocs (even quoted) still lose `\\`.** Write Python patch scripts with the Write tool (`chr(92)` for a backslash), then run them with `python -I`.
- **The en-XA check flags deliberately foreign text:** mark it `translate={false}`. The layout's "cut" check compares widths only (accented capitals overflow vertically).

**From earlier legs (still true):**
- **Polyfills:**
  - `new RegExp(...)` in TV code pulls in core-js's RegExp (+7 KB), and `.split(` pulls in `es.string.split` (+2 KB).
  - Babel picks polyfills by property name, even on your own objects (`at`, `values`, `includes`…).
  - A package index import drags in every module's polyfills: import from `@zoma/data/client`.
- **The Write tool turns `\uXXXX` escapes into raw characters.** In TV code, use `String.fromCharCode`, and scan for U+200E/200F/202A–202E/2066–2069 afterwards.
- **Text arguments carry six invisible characters** (LRM/RLM outside FSI/PDI). Compare with `stripIsolates`, or `isolated()` in e2e.
  - Chromium 53/56/68 ignore FSI/PDI: check any new bidi-sensitive text with the harness's probe pattern.
- **Look at the Arabic screenshot after any text change.** A Latin span followed by digits needs `dir` on the span.
- **Root `test/` can't import `@zoma/ui`** (and has no JSX in tsc): use relative non-tsx imports. e2e can import `../packages/core/src/*`, `../tools/engines/src/*` and `../apps/mock-provider/test/helpers`.
- **Components stay hook-free** (VNode-walk unit tests).
- **CSS:** physical properties only; postcss-rtlcss mirrors by the page's direction, even inside `dir="ltr"` islands.
- **Old-engine harness:**
  - Docker image: never edit the `RUN apt-get` line; list new COPY files in `IMAGE_FILES`.
  - A container can miss DevTools once: rerun with `--engine`.
  - Engine runs overwrite `artifacts/engines`.
- **Profile and IndexedDB:**
  - Never `await` inside a transaction (on Chromium 53 it commits early).
  - The same key twice in one IDB transaction loses an update.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. **Smart App Control is on:** never weaken lint.
- **TV code:** `lib: ES2017`.
- **Commits:**
  - scoped `git add`, then `git commit -F`;
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge relay PRs with `gh pr merge --merge` on green CI, keep the branch, and list the 3 riskiest changes;
  - after `gh pr create`, wait about 25 s before reading the checks.
- **CLAUDE.md edits need Omar's direct word in your own tab.** Open gaps (six; the fourth grew this leg):
  - `@zoma/data`'s extra entries;
  - `pnpm epg:report` and `pnpm fonts` in the Commands table;
  - the CSS pipeline and gate in the `build:tv` row;
  - the `pnpm dev` row: it starts on onboarding, with `?screen=hello` and `?screen=gallery` as developer screens;
  - the `verify:engines` row should mention the gallery checks, the CSS seeds and the Arabic phase;
  - a Conventions line: UI text comes only from the catalogs through `appI18n` (ADR-011), `zoma/no-hard-coded-text` enforces it, and text arguments are isolated by core's `isolateText`. Add that a screen with an input uses `TextField`/`createTextEditor`.

## The 3 riskiest changes in PR #20
1. **The default screen changed.** A TV now opens onboarding, not the hello screen. The harness's data runs depend on `?screen=hello`, and `test/engines-fixture.test.ts` pins it.
2. **`Platform` gained two required methods** (`textKey`, `onSoftKeyboard`). The TV key codes come from the vendors' docs and are unchecked on hardware (spike S10).
3. **Keys aimed at an `<input>` no longer reach the focus engine.** That is right for typing, but a future input outside the text editor would trap the remote.

## Verified vs not
- **Verified:**
  - the flow by keys in en and ar on the fake loader (dev);
  - both TV bundles start on onboarding and type into a field from `file://`;
  - every screen inside the safe area in en, ar and en-XA, with the Arabic screenshots looked at;
  - `verify:engines --self-test` (the hello runs on `?screen=hello`; the gallery unchanged);
  - CI green, merged.
- **Not done:**
  - the real loader, the profile and the relaunch skip (13b);
  - onboarding on Chromium 53/56/68 (13b);
  - any TV keyboard on hardware (step 16, S10);
  - CI on main at `48746a4` (it started at handover).
- **Migrations and deploys:** N/A (no backend until step 29).

## Press these keys (Omar, desktop browser)
1. Run `pnpm dev`, then open `http://localhost:5173/?locale=en-US`. The onboarding language screen shows "Choose your language" and "اختر لغتك", with **English** focused.
2. Press **→** and then **Enter**. The app switches to Arabic and mirrors. Press **Esc**: you are back on the language screen. Press **→ Enter** (in Arabic, RIGHT goes back towards English): English again.
3. Press **Enter** three times (I understand, Allow, Xtream login). The form shows five fields.
4. Press **Enter** on "Server address": a caret appears. Type `provider.example:8080` and press **Enter**: the focus moves to Username. Fill in Username and Password the same way.
5. On "Guide link", type `a b` (with the space) and press **Enter**. Then press **↓**, then **Enter** on "Add source": "A link can't contain spaces" appears, and the focus jumps back to the guide field.
6. Press **Enter**, delete the text with **Backspace** (the form doesn't go back), press **Enter**, then **↓ ↓ Enter**. "Adding provider.example" shows, then "You're all set" with 1,240 channels, 380 films and 45 series. This is a fake loader until step 13b.
7. Press **Esc**: the exit dialog opens (not the form). Press **Enter** to stay, then **Enter** on "Start watching": the hello screen (until step 14).
8. Open `?locale=ar-SA`: العربية is focused and the whole flow is in Arabic. `?screen=hello` still opens the old diagnostics screen.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended; it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47.
- **Before the first store submission:** the final app IDs and real icons.
- **Relay cap:** 40 legs; leg 21 was the 21st.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Six CLAUDE.md gaps** are waiting for his word (listed above).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
