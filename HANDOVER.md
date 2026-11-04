# Zoma IPTV: relay leg 30 opening prompt

You are leg 30 of relay run `iptv-20261101-214120`, building **Zoma IPTV**. It is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Earlier legs:** leg 0 planned the work. Legs 1–28 did steps 1–15b (PRs #1–#27). Leg 6 did no project work.
- **Leg 29** split step 15b2 into 15b2 (S9, S11) and 15b3 (S10) (commit `31f320f`) and did **15b2: spikes S9 (Arabic) and S11 (lifecycle, accessibility)**.
  - Commits `3a67e8d` (the work) and `b2403f6` (the RELAY tick). PR **#28** was merged as merge commit **`cb0dfa2`**, with the branch kept.
  - CI on `b2403f6` was green on the first run: `verify` 9 m 6 s, `engines` 12 m 59 s (of its 25-minute limit), `media` 7 m 16 s.

## Your step: 15b3 (RELAY.md is the spec)
"The input spike (S10)." **Done when:** e2e drives the key tester by keys in the desktop browser and finds its records; PR merged.

1. **Check first** that none of it exists: `git log --oneline -10`; `ls apps/tv/src/lab/spikes` (today: `s0-s1.ts`, `s2-s3.ts`, `s6.ts`, `s7.ts`, `s9.ts`, `s11.ts`, `index.ts`, plus `s6.test.ts`, `s11.test.ts`).
2. **Read:**
   - architecture.md §5: the S10 row ("registering number, CH, colour and media keys; PRE-CH; Magic Remote pointer; Back behaviour; native IME in Arabic"; if the IME is unusable: build our own on-screen keyboard, +2 sessions), and "Built in step 15b2";
   - `docs/runbooks/lab.md`, "S11" and "S11 by ear": the question pattern to reuse.
3. **Reuse 15b2's interactive pattern:**
   - `LabContext.interactive` is true only when a spike is started from its row;
   - `context.ask()` in `lab-state.ts` pushes a navigator screen (`ask/items/N`), and `LabApp.tsx` renders it with `data-screen/zone/index` on the lab root;
   - "Run all", the launch run, e2e's full run and the harness must skip anything that waits for a person.
   
   A key tester probably needs its own screen kind, which sees **every** key (`onIntent` returns true for all, plus the raw `keydown` for codes that map to no Intent). End it on a timeout, and/or on Back pressed twice in a row, since Back is itself a key under test.
4. **Ideas carried over:**
   - **Expected keys per platform:**
     - Tizen: `TIZEN_KEYS` in `packages/platform-tizen/src/keys.ts`, with `getSupportedKeys()` / `registerKey`;
     - webOS: `WEBOS_KEYS` in `packages/platform-webos/src/index.ts`; it has no PREV_CH entry, so record what LG's remote sends;
     - the harness's `TV_KEYS` (`tools/engines/src/live.ts`);
     - the browser: `browserKeyToIntent`.
     
     Record each key's raw `keyCode`/`key`, so unknown keys teach us their codes.
   - **The Magic Remote pointer:** `Platform.onPointer` (webOS `cursorStateChange`) and mouse moves and clicks.
   - **The native keyboard in Arabic and English:**
     - `TextField` / `createTextEditor` (`packages/ui`), and `Platform.textKey`;
     - Tizen IME Done 65376 and Cancel 65385, not yet checked on a TV;
     - webOS `keyboardStateChange` (`Platform.onSoftKeyboard`).
     
     Record the typed text and the keys seen. A person must type, so this belongs to the interactive part.
   - **Each new check goes into four places:**
     - `DESKTOP` in `e2e/lab.spec.ts` (plus its `BUNDLE` table if a TV bundle answers differently);
     - `EXPECTED_STATUSES` (plus `PLATFORM_STATUSES`) in `tools/engines/src/lab.ts`; a unit test keeps them in step;
     - the end-record counts in the e2e;
     - the record counts in `tools/engines/src/lab.test.ts`.
   - **Run order:** `[S0, S1, S2, S3, S7, S9, S10, S11, S6]`.
   - **The spike list's height:** rows are 80 px (72 + 8). With S10 there are 9 rows, which fits (1010 of the 1026 px title-safe bottom). 15c's S4, S5 and S8 won't: shrink the rows (or page the list) either now or in 15c, and look at a screenshot.
   - **Expected console errors:** the harness's lab wait gives up 2 s after any console error except S7's refusals (`labErrorGate`). A spike that errors on purpose must be added there.
5. **Definition of Done** (CLAUDE.md):
   - `pnpm verify`;
   - `pnpm verify:engines --self-test` (102 runs and 74 seeds today);
   - a mutation check (copy `artifacts/mutate15b2.py`: vitest, e2e and engine runners; add a `--grep` e2e target for the new test);
   - a PR merged on green CI;
   - a "press these keys" checklist.

## Start
1. Read `C:/Users/Omarm/.claude/relay/iptv-20261101-214120/state.json` for the worktree path.
2. Check main: `gh run list --branch main --limit 1 -R Omarmarei/zoma-iptv`. If the run on `cb0dfa2` is red, fix it on the relay branch first. If only `engines` is red with "DevTools … did not answer", rerun it with `gh run rerun <id> --failed`.
3. Run `git -C "<wt>" status` and `git -C "<wt>" log --oneline -5`. Start Docker Desktop if `docker info` fails.

**Never call EnterWorktree**, even though Claude Code's background note asks for it. The relay worktree is your isolation. Use `git -C`, `pnpm --dir` and absolute paths. Never use bare `git stash`.

## Read first
1. `CLAUDE.md`: the conventions, the Chromium 53 cheat sheet, the boundaries, the Definition of Done, the merge policy and the commit format.
2. `RELAY.md`: step 15b3, steps 15c–15e, step 16 (needs Omar), and the progress-log rows for legs 27–29.
3. `docs/runbooks/lab.md` and architecture.md §5.
4. The code in `apps/tv/src/lab/`:
   - `types.ts` (Check, Spike, LabContext with `interactive`/`ask`/`lifecycle`, LabQuestion, LabRecord with `event`);
   - `lab-state.ts` (`ask`, `ASK_SCREEN`), `LabApp.tsx` (the `Question` screen and its DOM-focus effect), `runner.ts`, `reporter.ts`;
   - `spikes/s11.ts` (the by-ear checks), `spikes/s9.ts` with `arabic.ts`, `lifecycle.ts`.
   
   Also `tools/engines/src/lab.ts` (`expectedStatuses`) and `e2e/lab.spec.ts` (`DESKTOP`, `BUNDLE`, the "asks by ear" test).
5. Memory `iptv-zoma-lab-gotchas` (updated in leg 29) and `iptv-ui-test-gotchas`.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`.
- **HEAD:** the commit adding this HANDOVER.md, which also records PR #28's merge in RELAY.md, on top of `b2403f6`. It is pushed, and the tree is clean.
- **main** has `cb0dfa2`; the branch doesn't, which is normal.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `dist/` (the app and the lab built from the real sources), `.cache/*`, the `zoma-old-engines:*` images;
  - in `artifacts/`:
    - `mutate15b2.py` (58 mutants) and its log;
    - `verify15b2.log`, `engines15b2.log` (the self-test);
    - `engines/lab-logs/` (S9's records from 53/56/68);
    - `poly-probe.py` (core-js modules of main for both platforms; see memory `iptv-tv-bundle-polyfills`).

## What step 15b2 built (for reference)
- **S9** (`spikes/s9.ts`, `arabic.ts`):
  - `fonts` (`document.fonts`, all four faces `loaded`);
  - `shaping` (`مسلسلات` and `لا` joined against ZWNJ-apart, under 95 % and 90 %; `shapingVerdict` fails when a fallback font was measured);
  - `bidi` (the harness's probe, ported);
  - `intl` (`info`: ar-SA, ar-AE, ar, en-US; the calendar, digits, outputs, `sameAsIntl`).
  
  The notes show the Arabic words, isolated, so a person sees them drawn.
- **New `Platform` calls** in all three adapters:
  - `setScreenSaver(allowed)`: Tizen `webapis.appcommon.setScreenSaver` in `packages/platform-tizen/src/tv-settings.ts`; webOS `unsupported` (no app API);
  - `screenReader()`: Tizen `tvinfo.getMenuValue(VOICE_GUIDE_KEY)`, raw answer kept; webOS `settingsservice` `audioGuidance` in `packages/platform-webos/src/speech.ts`;
  - `speak(text)`: webOS `com.webos.service.tts/speak`; Tizen `unsupported`.
  
  `jsonText` in `luna.ts` builds luna params without `JSON.stringify`.
- **S11** (`spikes/s11.ts`, `lifecycle.ts`):
  - `lifecycle`: `event` records as events happen, the time away, a 1 s heartbeat;
  - `screensaver`, `screen-reader`, `speech`;
  - `focus-reading` and `live-reading`: by ear, only when S11 is started from its row.
  
  The lab's webOS appinfo sets `accessibility.supportsAudioGuidance`; the app's does not yet.
- **Old engines:** fonts, shaping and bidi pass on 53/56/68. `Intl` there gives Arabic-Indic digits to every Arabic tag (ar-AE too); ar-SA is Gregorian on 53/56 and Hijri on 68; `PluralRules` exists only on 68. (format.ts's comment says Chromium 53's CLDR gave ar-SA the Hijri calendar; the harness's 53 snapshot didn't. The TVs decide.)
- **Sizes:** app main +1.6 KB (Tizen 180.1) and +1.0 KB (webOS 179.6), with the same core-js modules. Lab main 210.4 KB of its own code.

## Gotchas and lessons
**New in leg 29** (also saved to memory: `iptv-zoma-lab-gotchas`, `iptv-parser-test-patterns`, `iptv-tv-bundle-polyfills`, `use-write-tool-for-doc-batches`):
- **Two guards that each suffice hide each other's mutants** (the question screen had `tabIndex` only in focus mode AND `focus()` only in focus mode). Keep one guard.
- **Float boundaries in tests:** pick values where `x * ratio` is exact (200 × 0.95, 50 × 0.9).
- **A guard that never fires in the browser** (S9's fallback font) needs a pure verdict function to be tested.
- **Bundle statuses differ per platform now:** the e2e `BUNDLE` table, the harness `PLATFORM_STATUSES`. The harness test parses both e2e tables, and its regex takes two-digit spike ids (`S\d+`).
- **Python patch heredocs failed twice more** (long ones fail to parse; a TS `\n` never matched). Write the patch script to the job's tmp folder with the Write tool (`BS = chr(92)`), then run it.
- **Never commit while a mutation run is going:** it edits sources in place. Docs and RELAY.md edits are safe meanwhile.
- **Researching TV APIs with a background agent worked** (about 9 minutes, 120k tokens of its own). The findings are in architecture.md §5 "Built in step 15b2". webOS has no screensaver API for apps. The `com.webos.service.tvpower` veto is community-only and was deliberately left out.

**From earlier legs (still true):**
- **The lab under `pnpm dev` shares the dev app's origin:** for a manual lab run next to dev data, `pnpm --filter @zoma/app-tv exec vite --port 5174`.
- **IndexedDB:**
  - deletes go through `idb-delete.ts`, since `blocked` is not a failure;
  - never `await` inside a transaction.
- **Perf budgets:** calibrate on CI (the 2-vCPU runner at 4x is about 2x slower than Omar's PC).
- **The `RemoteDriver` contract:** a screen root has `data-screen/zone/index`, and its navigator goes to `showFocus`. `INTENT_KEYS`: BACK is Escape, RED is F1, GREEN is F2.
- **Polyfills:** Babel picks core-js polyfills by property name. Probe each new file that reaches the app's main bundle (`artifacts/poly-probe.py`, or `make-size-probe3.py` for one entry).
- **The Write tool turns `\uXXXX` escapes into raw characters.** Use `String.fromCharCode` in sources, and Python `chr()` in patches.
- **Text arguments carry isolate marks:** compare with `stripIsolates`. Chromium 53/56/68 ignore FSI/PDI.
- **Root `test/`** can't import `@zoma/ui` or `.tsx` files.
- **Code rules:** components stay hook-free (the lab's screens use hooks, as before); CSS uses physical properties only; TV code is `lib: ES2017`.
- **Old-engine harness:**
  - never edit the Docker image's `RUN apt-get` line;
  - engine runs overwrite `artifacts/engines`;
  - on the DevTools flake, rerun the whole self-test or the CI job.
- **The e2e mock** pins its clock to 2026-11-02 12:00 UTC (`mock({ now: Date.now })` for the real clock).
- **Mutation scripts** edit sources in place: run no tests, builds or Docker alongside. Run them with `python -I -u`.
- **New dependencies** must be ≥ 2 weeks old, transitive ones included. Smart App Control is on: never weaken lint.
- **Commits and merges:**
  - scoped `git add`, then `git commit -F -` ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and the harness's session line;
  - merge with `gh pr merge --merge` on green CI and keep the branch;
  - after `gh pr create`, wait about 30 s before reading the checks, and check that the run's `headSha` is the PR's head before merging;
  - a Monitor loop over `gh pr checks` worked for the 13-minute wait.
- **CLAUDE.md edits need Omar's direct word in your own tab.**

## The 3 riskiest changes in PR #28
1. **`Platform` gained three calls in every adapter, and the app's main bundle carries them** (unused by the app so far). webOS `speak` calls a luna service LG's TV docs don't list; S11 is where a TV first runs it.
2. **The lab's question screen moves real DOM focus** (`tabIndex=-1`, `focus()`). Outside text fields it is the first DOM focus in the TV code, but only in the lab, while a question is open.
3. **The harness's expected statuses are per platform now** (`expectedStatuses`). The e2e `DESKTOP`/`BUNDLE` tables must stay in step with them (a unit test checks).

## Verified vs not
- **Verified:**
  - S9 and S11 in desktop Chromium: dev and both bundles from `file://`. Every record was checked, and screenshots of the S9 results and the two questions were looked at.
  - S11 alone by keys: the hidden-and-back trip, both answers, DOM focus and the live region.
  - S9/S11 in Chromium 53/56/68: the local self-test (102 runs as expected, 74 seeds), and CI green.
  - `pnpm verify`: 2,257 tests in 131 files, e2e 50/50.
  - 58/58 mutants caught.
- **Not done:**
  - any real TV or emulator (15e, 16): S11's by-ear answers, Voice Guide/Audio Guidance, the screensaver hold and TTS all need a person at a TV;
  - S10 (15b3); S4, S5, S8 (15c); the docs (15d).
- **Migrations and deploys:** N/A (no backend until step 29).
- **"Press these keys" checklist for S9 and S11 (desktop):**
  1. Run `pnpm mock` in one terminal and `pnpm dev` in another. Open `http://localhost:5173/lab.html?server=http://127.0.0.1:8080&auto=0` at 1920x1080.
  2. Press ArrowDown 6 times (to S9), then Enter. S9 shows PASS 4/4. The shaping note shows `مسلسلات` joined, and `لا` as one glyph; the bidi note shows `MBC 1 · 240 قناة` in order.
  3. Press ArrowDown once (to S11), then Enter. A panel asks "Does the TV read each button as the focus moves?". Press ArrowRight: the second button gets the teal border. Press F2 (GREEN).
  4. The second panel shows the same buttons, with the focused button's name under them. Press ArrowRight twice: the name under them reads "Zoma Lab third button". Press F1 (RED).
  5. S11 shows PASS (`focus-reading` PASS, `live-reading` FAIL, the rest SKIP or INFO).
  6. On a TV (step 16): runbook lab.md "S11 by ear", with Voice Guide or Audio Guidance on.

## Open decisions and gates
- **Arabic digits** (decided in leg 19, reversible; ADR-011). Ask Omar when he is next in a tab, as a numbered list:
  1. keep Western digits everywhere (recommended: it matches Shahid, OSN+ and Netflix in Arabic, and the provider's channel numbers);
  2. Arabic-Indic digits for SA, KW, QA, BH and OM per CLDR (Western for AE);
  3. Western by default, plus a user setting later.
  
  New data from S9: the old engines' `Intl` gives Arabic-Indic digits to every Arabic tag, ar-AE included.
- **Later, after S11 runs on a TV:**
  - the app's own accessibility: DOM focus following the focus engine, an `aria-live` announcer, or `Platform.speak`;
  - `supportsAudioGuidance` in the app's appinfo.json;
  - Samsung's "autofocus an element at launch".
  
  These are product decisions for when the answers exist; nothing is blocking now.
- **Step 15e** (the lab in an emulator) likely needs Omar: VirtualBox, Tizen Studio, a Samsung account. Try first whatever needs none (the webOS TV Simulator). Note: the webOS emulator and simulator don't support accessibility (LG's docs), so S11's questions need a real TV.
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung route and the Samsung certificate.
- **Later gates:**
  - steps 21, 34, 44, 46 and 47;
  - before the first store submission: the final app IDs (the lab's too) and real icons.
- **Relay cap:** 40 legs; leg 29 was the 29th.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains. These also decide the final app IDs.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Ten CLAUDE.md gaps** are waiting for his word:
  1. `@zoma/data`'s extra entries;
  2. `pnpm epg:report` and `pnpm fonts` in the Commands table;
  3. the CSS pipeline and gate in the `build:tv` row;
  4. the `pnpm dev` row: it starts on onboarding, or on the live screen once a source is stored, with `?screen=hello` and `?screen=gallery` as developer screens, plus `lab.html`;
  5. the `verify:engines` row: the gallery checks, the CSS seeds, the Arabic phase, the onboarding walk to the live screen, the focus agreement, the lab runs (102 runs, 74 seeds);
  6. a Conventions line on UI text through `appI18n` (ADR-011), `zoma/no-hard-coded-text`, `isolateText` and `TextField`/`createTextEditor`;
  7. the `pnpm e2e` row: the `RemoteDriver`, `window.__ZOMA_TEST__` and the `throttled` project;
  8. the `build:tv` row's lab target and options, `pnpm device … --lab`, and the platform-globals line (`PalmServiceBridge` is webOS-adapter only);
  9. a `pnpm lab:scale` row (S6 on the fixtures; needs `pnpm fixtures`), and the mock row's `/__lab/source` and `/__lab/guide.xml.gz`;
  10. **new:** the `Platform` interface's new calls (`setScreenSaver`, `screenReader`, `speak`) and where each adapter gets them (Tizen `tv-settings.ts`, webOS `speech.ts`).
- **The Arabic digits question** (above). The default is set, so it is not blocking.
- No secrets have been shared, so nothing needs rotating.
