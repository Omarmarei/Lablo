# Lablo IPTV: relay leg 95 opening prompt

You are leg 95 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–93 did steps 1–31c1 (PRs #1–#118). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 94 (2026-11-18) split step 31c2 and built 31c2a, but did not finish it.** The relay's context check fired at 453k tokens, so the leg committed the work and stopped.
  - **The split** (RELAY.md, step 31c2):
    - 31c2a: the screen, its add path and its statuses, in current Chromium. **Built, not merged.**
    - 31c2b: the old-engine walk (`verify:engines` with the stand-in in `tools/engines`).
    - 31c2 is ticked once both are.
  - **Commit `2bc6afe`** (pushed to `relay/iptv-20261101-214120`, no PR yet). RELAY.md's 31c2a "Built in leg 94, not yet merged" lists what was done and what remains. architecture.md §3.2 "Built in step 31c2a" describes the code; its "Mutation", "Verify" and "Merged" lines are still to be written.
- **What 31c2a built:**
  - **`apps/tv/src/pairing/`:**
    - `pair-state.ts`: `createPairing({nav, session, base, loader, refusal, lifecycle, timers, busy, added})`. Views: `opening`, `code`, `unavailable`, `ended`, `loading`, `failed`, `refused`, `done`, each with its buttons (`pairActions`). It pushes the `pair` screen (`PAIR_SCREEN`) on the navigator it is given; its pair worker ends when the screen leaves the stack (`nav.subscribe` plus `screen.open`), after a status still being sent.
    - `pair-draft.ts`: `pairDraft(payload)` runs the payload through `checkForm`, at most four guide links (`PAIR_GUIDES_MAX`), duplicates dropped. `statusFor(code)` maps a load result to the phone's status.
    - `pair-qr.ts`: `qrPath(rows)` and `qrModulePx(size)` (`QR_QUIET` 4, `QR_MAX_PX` 460).
    - `PairPage.tsx`: the hook wrapper `PairPage`, and `PairContent` with no hooks (the tests call it as a function). Also `pair.css`.
  - **Onboarding:**
    - `onboarding/load-text.ts`: `errorText`, `refusalText` and `phaseText`, moved out of `OnboardingApp.tsx`.
    - The `pairing` option in `onboarding-state.ts`: the source screen's third row, `type-phone`. `added` resets the navigator to onboarding's done screen.
  - **The add path:**
    - `form.ts`: `SourceDraft.epgUrl` is now `epgUrls`.
    - `engine-loader.ts`: `typedGuides` names the guides `<id>`, `<id>-2` … `<id>-4`. The loader waits for the refresh slot (`refreshing`, `SLOT_WAIT_MS` 500).
  - **Settings:**
    - `sources-state.ts`: `addFromPhone` gives the screen a header zone, `canAdd`, and `reload()`.
    - `settings-state.ts`: the `pairing` and `sourceAdded` options. `PAIR_SCREEN` joins `SETTINGS_SCREENS`.
    - `SettingsScreen.tsx`: `AddFromPhone` (`sources-add-phone`) and the pair page.
  - **`main.tsx`:**
    - `pairingOn(nav, added, loader, busy?)` and `deviceTier()`.
    - Settings' `addLoader` and `holdRefreshes`, which stop the background refreshes while a paired source loads, unless `gateStopped`.
    - `sourceAdded`: the live screens read the catalogs and guides again.
  - **Catalogs:** 17 new keys in en and ar (`pair.*`, `onboarding.phone`, `onboarding.phoneHint`, `sources.addPhone`).
  - **E2E:**
    - `tools/engines/src/pair-stand-in.ts`: `PairStandIn`, 31a's routes in memory, with the TV's CORS and `expire(code)`.
    - `e2e/config-server.ts`: answers `/v1/pair*` from it (`server.pair`).
    - `e2e/pair-phone.ts`: `phoneSends` and `phoneSees` (the typed-code path).
    - `e2e/pairing.spec.ts`: 3 tests.
- **Verified in leg 94:**
  - lint and the full typecheck;
  - unit 6,025 (+163) before the last gap tests (the touched files pass after them);
  - `build:tv`: main.js's own code 455.4 KB Tizen and 442.7 KB webOS (+15.4 KB: the state ~4.6, the page ~4.1, the strings ~3.5, the wiring ~1.5; measured in the minified bundle, no leaked dependency). The pair worker is unchanged at 133.5 KB;
  - e2e `pairing.spec.ts` 3/3;
  - screenshots `pair-{code,loading,refused}-en` and `pair-{sources,code,failed,done}-ar` looked at: all right.
- **Mutation** (`artifacts/mutate31c2a.py`, 117 written first, five gaps closed while writing):
  - Batch A (0–39, `artifacts/mutate31c2a-a.log`): 38 caught.
  - #6 (`screen.focus('actions', 0)`) was a gap, now closed by a test and caught.
  - #33 (`poll()`'s `view.peek().kind !== 'code'`) is equivalent: a poll timer exists only while a code shows. Keep it with that reason in the docstring, or replace it with a mutant that changes behaviour.
  - **Batches B (40–79) and C (80–116) have not run.**

## Read first
1. **`RELAY.md`:**
   - step 31c2's split;
   - 31c2a's shape and its "Built in leg 94, not yet merged";
   - 31c2b, 31c3, 31d, 31e;
   - the leg-94 progress-log row (its commit cell says "(this leg's commit)": set it to `2bc6afe` when you record the merge).
2. **`docs/architecture.md`** §3.2: "Built in step 31c2a" (it ends after its E2E line), "Built in step 31c1", "Built in step 31a".
3. **The code:** `apps/tv/src/pairing/`, `e2e/pairing.spec.ts`, `tools/engines/src/pair-stand-in.ts`, and `artifacts/mutate31c2a.py`'s docstring.
4. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean apart from gitignored files.
   - `git -C "<wt>" log --oneline -3` should show this handover's commit, then `2bc6afe`, then `081c1ee`.
   - No `*.mutbak` should exist: `find apps packages -name "*.mutbak"`.
2. **Check memory before any heavy run:** `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). `voicebox-server` held 26 GB again in leg 94; free virtual memory ran 6–7 GB.
3. **Finish 31c2a:**
   1. **Mutation batches B and C**, each in the background or the foreground under `timeout 1500`. Nothing else may touch the sources meanwhile: no e2e, no build.

      ```
      export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""
      python -I -u artifacts/mutate31c2a.py --from 40 --to 79 > artifacts/mutate31c2a-b.log 2>&1
      python -I -u artifacts/mutate31c2a.py --from 80 --to 116 > artifacts/mutate31c2a-c.log 2>&1
      ```

      For each survivor: close the gap with a test, or record it as equivalent in the docstring. Then rerun the changed ones (`artifacts/mutate31c2a.py "<snippet>"`) into `mutate31c2a-rerun.log`.
   2. **The full unit suite:** `pnpm exec vitest run --maxWorkers=3`. Expect about 6,030.
   3. **The e2e near the change**, one spec at a time:

      ```
      pnpm exec playwright test --project=chromium e2e/onboarding.spec.ts e2e/config.spec.ts e2e/config-blocklist.spec.ts e2e/config-modes.spec.ts e2e/config-gate.spec.ts e2e/pairing.spec.ts
      ```

      Watch for the source screen's third row in `onboarding.spec.ts`, and for the Sources header in `config-blocklist.spec.ts` (it expects `sources/sources/0`, which should hold).
   4. **The engines:** `pnpm build:tv` (the dist from leg 94 holds the same source, but rebuild if anything changed), then `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` in the background (about 6 min). The onboarding walks must still pass with the third row. A failure before any check (Chromium 53's DevTools not up within 60 s): `docker ps -a`, then retry once.
   5. **The PR:**
      - The three riskiest changes: the loader's slot wait, Settings holding the background refreshes, and main.js +15.4 KB.
      - Then `gh pr create`; CI runs every job because `tools/engines` and the TV changed.
      - Merge on green with a merge commit, keeping the branch.
      - Record the merge: architecture.md's "Mutation", "Verify" and "Merged" lines; RELAY.md's "Done in leg …" and the tick of 31c2a; the progress-log commit cell.
4. **Then 31c2b:** the old-engine walk by phone.
   - The engines' fixture server is `serve-fixture.sh`, a static file server, so the stand-in needs a dynamic server. One option: a Node server on the host, reached from the container through `host.docker.internal`, passed as `?api=`.
   - A scripted phone in the harness.
   - Chromium 53 and 68: the QR drawn, the code shown, the source added.
5. **Then** 31c3 (the e2e against `next start` in CI's `web` job), 31d (the M3U file relay) and 31e (the "no plaintext" test end to end).
6. **Step 26's common items still apply to each step:**
   - unit tests;
   - mutation with the list written first (`artifacts/mutate31c2a.py` is the newest template);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page or the build changes;
   - the PR merged on green CI;
   - the docs;
   - the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of:
  - `2bc6afe` (31c2a's work, not merged);
  - `081c1ee` (the leg-93 handover);
  - `5ba82be`;
  - `d7f7c2e` Merge PR #118 = main.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/` (a build of `2bc6afe`'s source);
  - `artifacts/`:
    - `mutate31c2a.py`, `mutate31c2a-a.log`;
    - `build-tv-31c2a.log`, `unit-31c2a.log`, `typecheck-31c2a.log`, `lint-31c2a.log`, `e2e-pairing-31c2a.log`;
    - `screenshots/pair-*.png`, `playwright-results/` (the failed first e2e runs);
    - older legs' files.
- **The `lablo-web` Postgres container is up** (`pnpm web:db:down` stops it).
- **No Vite, `next start`, Playwright, engine container or `*.mutbak` is left.**

## Gotchas and lessons
**New in leg 94:**
- **The pairing payload's links must carry their scheme.** `pairPayloadSchema`'s `link` is `^https?://`. A scripted phone that sends `host/path` makes the TV treat the payload as unreadable: a new code with a note, no status. The phone page normalizes links first; test phones must too (`e2e/pair-phone.ts` callers pass `http://…`).
- **A component with a hook can't be called as a function in a VNode test.** Split it into a hook wrapper and a content component with no hooks (`PairPage` / `PairContent`, `AddFromPhone` checked only by its props).
- **`sources-screen.test.ts`'s `FakeEngine` computes a held answer when it is released.** To tell an older read from a newer one, release `engine.held` entries one by one (`splice(i, n)`), not with `release()`.
- **The navigator clamps a zone's position on `update`,** so a "focus the first button" call matters only when the old position still fits. Here: `failed` with "Try again" focused, straight to `refused`.
- **One screen cost 15.4 KB of main.js** (455.4 of 500). Watch the budget for steps 32 and 33. The TV build has no lazy chunks.
- **i18n arguments are isolated in English too:** a title with a name is `Adding ‎‎⁨Phone list⁩‎‎`. Compare with `stripIsolates`.
- **The relay context check can fire mid-step.** Commit the work, list what remains in RELAY.md, and hand over.

**From earlier legs (still true):**
- **New ways in go through the gates:**
  - any new way to play goes through `PlayerController.play` (it checks the blocklist);
  - any new way to add a source reads `refusalFor` and goes through `DataEngine.refresh`. 31c2a does both.
- **A new `FailureCategory` in `@lablo/player`** needs an entry in `PlayerScreen.tsx`'s `CATEGORY_TEXT`.
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src`.
- **`DataEngine`'s refreshes must claim the slot before any `await`.**
- **The mutation run edits source files:** never commit, build or run e2e while it runs, and check for `*.mutbak` after a stop.
- **Workers:** a worker started after the first paint needs its npm deps in `optimizeDeps.include`. Never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`.
- **Polyfill names to keep out of TV code:**
  - a member named `flags` or `at`;
  - `lastIndexOf` on arrays, `concat`, `URL`;
  - regex `.test`, `trim`.

  `artifacts/babel-polys30b2.ts <files>` lists a file's core-js modules.
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - none of these in new TV files: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, `for…of`, array destructuring or spread, object spread (JSX prop spread is fine);
  - physical CSS only; no CSS Grid or flex `gap`; ES2017;
  - `packages/ui` components stay hook-free; UI text only from the catalogs.
- **Python on Windows writes CRLF in text mode:** write with `open(p, 'wb')`. Bash heredocs to Python break on mixed quotes: use the Write tool for long scripts.
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""` (a `D:/` path, not `/d/`). Never delete files in `node_modules`.
- **CI:**
  - CI runs Node 22; this PC runs Node 24.
  - The known media flake: `epg-declared-300mb`. Run `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
  - One CI poller: wait ~45 s after `gh pr create`, then `gh run list --commit <sha> --event pull_request`, then one Monitor with the `comm -13` loop over `gh run view <run> --json status,conclusion,jobs`.
  - There is no `jq`: use `gh --jq`.
  - Never push while a PR's CI runs.
- **A bare `sleep` is blocked:** use `timeout N tail -f /dev/null` or an `until` loop.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it. The TV build can crash once (0xC0000005): run it again.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation. Use `git -C "<wt>"` and absolute paths; scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and is path-filtered;
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified (leg 94, locally):**
  - lint, typecheck;
  - unit 6,025, then the touched files after the gap tests;
  - `build:tv`;
  - e2e `pairing.spec.ts` 3/3;
  - screenshots;
  - mutation batch A 39/40, with one equivalent.
- **Not verified:**
  - mutation batches B and C;
  - the full unit suite after the last test edits;
  - the other e2e specs (`onboarding`, `config*`) and the full `pnpm e2e`;
  - `verify:engines`;
  - CI;
  - a real phone scanning a TV screen;
  - anything on Vercel (step 34).
- **Migrations and deploys:** none. Nothing is in production; nothing is deployed.

## Open decisions and gates
- **31c2b:** how the engines harness serves the stand-in (a host Node server through `host.docker.internal`, or something in the container). The leg's own call: record it in RELAY.md.
- **31d:** how the memory store's `http` development URLs pass `pairUploadResponseSchema`'s https rule.
- **Later UI fixes (no step yet):**
  - the guides screen's "read, last try failed" rows clip their third line;
  - the Arabic `done.body` (`{name} جاهز.`) is masculine for a feminine name like "قائمة".
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration and deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the 2018 set;
  - 30–45 minutes at the LG TV.

## Checks for Omar (nothing merged this leg)
1. In the worktree: `pnpm exec vitest run apps/tv/src/pairing`. Expect 4 files and 84 tests.
2. `pnpm exec playwright test --project=chromium e2e/pairing.spec.ts`. Expect 3 passed. Then look at `artifacts/screenshots/pair-code-en.png` and `pair-code-ar.png`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held **26 GB** of committed memory again this leg. Please close it, or restart it, during relay runs.
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session".
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-four CLAUDE.md gaps** wait for his word:
  - 1–28: leg 51's handover (`git show d05d5fd:HANDOVER.md`);
  - 29–47: leg 86's (`git show 5fffb27:HANDOVER.md`);
  - 48–54: leg 93's (`git show 081c1ee:HANDOVER.md`).
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
