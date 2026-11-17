# Lablo IPTV: relay leg 94 opening prompt

You are leg 94 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–92 did steps 1–31b (PRs #1–#117). Three steps wait for Omar: step 16's Samsung part, 19b and 21.
- **Leg 93 (2026-11-17/18) split step 31c and built 31c1. 31c1 is merged and ticked.**
  - **The split** (RELAY.md, step 31c):
    - 31c1: the QR encoder and the pairing client in a worker. Done.
    - 31c2: the TV's pairing screen, its add path and its statuses. Next.
    - 31c3: the pairing e2e in CI's `web` job.
    - 31c is ticked once all three are.
  - **The leg's decisions** (RELAY.md, 31c "Decisions (leg 93)"):
    - **The QR encoder is our own,** not a dependency. It is proved against two test-only oracles (`uqr`, `jsqr`).
    - **The pairing client runs in a worker of its own** (`pair.worker.ts`). The key, the box and the zod schemas stay out of main.js.
    - **The QR link is `<api base>/p#c=<code>&k=<tvPk>`:** the phone page and the API are one origin. The screen shows `<host[:port]>/p` for typing.
  - **PR #118 (`d7f7c2e`), green on the first run:**
    - verify 14 m 51 s (e2e 145 passed; unit 5,861 with one skipped);
    - web 1 m 44 s;
    - media 12 m 14 s;
    - engines 19 m 31 s (all 114 runs as expected; the vectors page 209/209 on Chromium 53, 56 and 68).
  - Then `5ba82be` recorded the merge and ticked 31c1. That commit and this handover go to main with the next PR.
- **What 31c1 built** (architecture.md §3.2 "Built in step 31c1"):
  - **`packages/core/src/qr.ts`:**
    - `encodeQr(text, {mask?, minVersion?})` → `{size, version, level, mask, rows}`, where `rows[y]` is a string of `1` (dark) and `0` (light), with no quiet zone.
    - `qrFits(text)`: the text fits a QR code (213 bytes).
    - Byte mode, versions 1 to 10. Level M is raised to Q or H when the text still fits the same version. The mask is the one with the lowest penalty (the first of equals).
    - A production link (76 bytes) is version 5, 37 modules a side.
  - **`check-qr.ts`** (entry `@lablo/core/check-qr`): six golden cases. The vectors page runs them after the crypto vectors and the protocol samples.
  - **`packages/data/src/pair-service.ts`:** `PairService` and `pairHandlers`.
    - `open(base)`: a fresh key pair; `qrFits` checked before any request; then `POST /v1/pair`. It answers `{ok: true, code: {code, exp, link, typed, qr}}`, or `{ok: false, failure, retryMs}`. A new code forgets the session before it.
    - `poll()` answers one of:
      - `waiting`;
      - `ready` with the parsed `PairPayload`, once (the key is forgotten);
      - `unreadable` (the session ends; no status is possible);
      - `ended` (410, 404, 401 or 409; also with no session);
      - `wait` with `retryMs` (429);
      - `failed` with the failure (the session stays).
    - `status(category)`: once, after `ready`. On 200, 409, 404 or 401 the session ends. On a 429, a server error or no connection it stays, so the status can be sent again.
    - `close()`.
    - Each request has a 10 s limit and a 65 KB cap. Bodies are written by hand.
  - **`pair-constants.ts`:** `PAIR_POLL_MS` (2000), `PAIR_TIMEOUT_MS`, `PAIR_RETRY_MS`. `@lablo/data/client` re-exports them, with the result types and `createPairClient`.
  - **`pair.worker.ts`:** serves `pairHandlers` with `fetchTransport()`. `fetchTransport` now takes `method` and `body`.
  - **`apps/tv/src/data/engine.ts`:**
    - `pairing(): PairSession` (`open`, `poll`, `status`, `close`);
    - `startPairWorker` is optional in `DataEngineOptions`;
    - `workers.ts` passes `new PairWorker()`.
  - **Sizes:** main.js's own code is 440.0 KB on Tizen and 427.3 KB on webOS (+0.5 KB). The pair worker is 133.5 KB of its 150 KB budget, and it is already inlined in main.js and the lab.
  - **Tests:**
    - `qr.test.ts` 33 and `pair-service.test.ts` 31;
    - `test/pair-worker-bundle.test.ts`: the bundled worker in a Chromium-53 realm, through a whole pairing;
    - `test/tv-data-engine.test.ts`: the engine's pairing (`PAIR_KEYS`, `started.pair`).
  - **Mutation:** `artifacts/mutate31c1.py`, 152 written first, 152/152 at the end.

## Read first
1. **`RELAY.md`:**
   - step 31c's "Decisions (leg 93)", 31c2's shape (marked "to be refined before building"), 31c3, 31d, 31e;
   - 31c1's "The shape" and "Done in leg 93";
   - the leg-93 progress-log row.
2. **`docs/architecture.md`:**
   - §3.2 "Built in step 31c1", "Built in step 31a", "Built in step 31b";
   - §3.3 "A. Pairing".
3. **The client 31c2 drives:**
   - `packages/data/src/pair-service.ts` (the result types);
   - `apps/tv/src/data/engine.ts`'s `PairSession` and `pairing()`.
4. **The TV side 31c2 touches:**
   - **`apps/tv/src/onboarding/`:**
     - `onboarding-state.ts`: the `source` screen's two types and `begin`'s refusal check;
     - `form.ts`: `checkForm`, `SourceDraft` with its single `epgUrl`;
     - `engine-loader.ts`: `createEngineLoader`, `LoadErrorCode`, `typedGuide`;
     - `OnboardingApp.tsx`.
   - **Settings:** `apps/tv/src/settings/sources-state.ts` (no actions yet), `SettingsScreen.tsx`, `settings-state.ts`.
   - **`apps/tv/src/main.tsx`:**
     - `configRequest.base`: `readApiBase`, `?api=`;
     - `addRefusal` (`refusalFor(…, 'block-new-sources')`);
     - `showOnboarding`;
     - `showLive`'s `createSettings`;
     - `startRefreshes`'s `onCatalog` (what to call after an add from Settings).
   - **The language:** `apps/tv/src/i18n/en.ts` and `ar.ts` (`error.*`, `loading.*`, `onboarding.*`); `catalogs.test.ts` holds the two to the same keys.
   - **The phone's words** for the five statuses: `apps/web/src/phone/catalog.ts` (`done.*`).
5. **`CLAUDE.md`:** "Package boundaries", "Chromium 53 cheat sheet", "Legal guardrails". CLAUDE.md edits need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `5ba82be` (31c1 ticked), on top of `d7f7c2e` (Merge PR #118) = main.
2. **Check memory before any heavy run.**
   - The PC's commit charge was nearly full again: `voicebox-server` held 26 GB, and free virtual memory dropped to 2.5 GB at one point.
   - Check with PowerShell `Get-CimInstance Win32_OperatingSystem` (`FreeVirtualMemory`). See which process holds memory with `Get-Process | Sort-Object PrivateMemorySize64 -Descending`.
   - Run in the foreground with few workers: `vitest run --maxWorkers=3`, the typecheck with `pnpm -r --workspace-concurrency=1 run typecheck`, the mutation run in `--from`/`--to` batches under `timeout 580`.
   - If a background job is stopped for memory, don't restart it unasked; ask Omar.
3. **Step 31c2, the TV's pairing screen.** Refine its shape in RELAY.md before building, and split it if it is too large for one leg. A likely split:
   - **31c2a:** the state, the screen, the add path, en/ar, unit tests and screenshots;
   - **31c2b:** the old-engine walk, with a stand-in pairing API in `tools/engines`, modelled on the harness's config server (`e2e/config-server.ts`, `tools/engines/src/config.ts`).

   Decisions already written in the shape:
   - **The poll:** every `PAIR_POLL_MS`. On `wait`, as `retryMs` says. On `failed`, the next tick.
   - **A new code** when the poll says `ended`. At most three codes per opening, then "Show a new code".
   - **Hidden and shown:** the poll stops while the app is hidden (`platform.onLifecycle`) and asks at once when it shows.
   - **`unreadable`:** a new code with a note. No status goes back.
   - **The payload to a source:** through `checkForm` (`normalizeXtreamBase`, `normalizeLink`, the name or the host).
     - Up to four guide links: `SourceDraft`'s `epgUrl` becomes a list. This touches onboarding's tests and `typedGuide`.
     - `m3u-file` is treated as unreadable until 31d.
   - **Before anything is kept:** the `addRefusal` signal, then the engine loader (`DataEngine.refresh` checks the blocklist).
   - **The statuses:**

     | When | Status sent |
     |---|---|
     | the loader reaches its `guide` phase, or its end | `ok` |
     | `auth` | `auth_failed` |
     | `expired`, or the panel's `blocked` | `expired` |
     | `blocklisted`, or the config's refusal | `blocked` |
     | anything else | `unreachable` |
     | a load cancelled on the TV | nothing |

     A status that fails with `rate`, `network` or `status` (kept) can be sent again.
   - **Where it is reached:** a third choice on onboarding's source screen, and an "Add a source from your phone" row in Settings › Sources. After an add from Settings, the live screens refresh as `startRefreshes`' `onCatalog` does.
   - **The screen:**
     - the QR as one SVG `<path>` built from `rows`, with `shape-rendering="crispEdges"`, a light quiet zone of 4 modules, never mirrored in RTL;
     - the code in large text, in groups of four;
     - the typed address;
     - the state in words.
4. **Then 31c3** (the e2e in CI's `web` job), **31d** (the M3U file relay) and **31e** (the end-to-end "no plaintext" test).
5. **Step 26's common items still apply to each step:**
   - unit tests;
   - a mutation run with the list written first (`artifacts/mutate31c1.py` is the newest template);
   - the `pnpm verify` parts;
   - `verify:engines --engine chrome53 --engine chrome68` when a TV-run page, the build or the protocol's samples change;
   - the PR merged on green CI;
   - the docs (RELAY.md "Done in leg …", architecture.md "Built in step …");
   - the merge recorded.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** this handover's commit, on top of:
  - `5ba82be` (31c1 ticked);
  - `d7f7c2e` Merge PR #118 = main;
  - `224612b` (31c1's work).
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/` (a build of `224612b`'s code);
  - `artifacts/`:
    - `mutate31c1.py`, `mutate31c1-a/b/c.log`, `mutate31c1-rerun.log`;
    - `qr-goldens31c1.ts` (makes check-qr's cases from `uqr`), `qr-ties31c1.ts` (finds tied masks), `probe31c1.ts`;
    - `build-tv-31c1.log`, `unit-31c1.log`, `lint-31c1.log`, `typecheck-31c1.log`, `engines-31c1.log` (the failed first try), `engines-31c1-retry.log`;
    - older legs' files.
- **The `lablo-web` Postgres container is up** (`pnpm web:db:down` stops it).
- **No `next start`, Vite, Playwright, engine container or `*.mutbak` is left.**
- **On the TV:** only the old lab, under its old id.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 93:**
- **Python on Windows writes CRLF in text mode.** `open(p, 'w')` turned every edited file into CRLF (git warns "CRLF will be replaced by LF"). Write with `open(p, 'wb').write(s.encode('utf-8'))`, or `newline=''`. To check: `python -I -c "…b'\r\n' in open(f,'rb').read()…"`.
- **`$PWD` in Git Bash is `/d/…`.** `NODE_OPTIONS="--require …hook.cjs"` needs the `D:/…` path, or every pnpm command fails with MODULE_NOT_FOUND.
- **`verify:engines` can fail before any check:** Chromium 53's container didn't open DevTools within 60 s. Check `docker ps -a` for a leftover container, then retry once. The retry passed.
- **base64url test values must be canonical.** A 32-byte value's 43rd character carries two unused bits that must be 0 (`A`, `E`, `I` … `w`, `0`, `4`, `8`). `'p'.repeat(43)` is refused by `bytes32`. A 16-byte value's 22nd character carries four unused bits.
- **`@lablo/data/client` may re-export values only from modules with no service behind them.** A value re-export from `pair-service.ts` would have pulled zod and tweetnacl into main.js; constants go in a small module (`pair-constants.ts`, like `config-constants.ts`).
- **Polyfill names, two more:**
  - regex `.test` (use `exec(…) !== null`);
  - `String.prototype.trim` (`es.string.trim`). `fetch`'s `Headers` trims values already.
  - `artifacts/babel-polys30b2.ts <files>` lists a file's core-js modules.
- **`packages/data`'s `fakeTransport` records only the URL and headers.** `pair-service.test.ts` has its own `api()` wrapper: method, body, late headers and a cancel count.
- **`test/tv-data-engine.test.ts`'s exact `started` objects now include `pair`.** A new worker kind means updating them.
- **QR mutants:** a byte-mode segment is always 4 mod 8 bits, so a `<` against `<=` on a capacity is equivalent. Mutate the level or the version instead.
- **Equivalence by range:** the alignment step's `+5` and `+6` floor the same up to version 10.

**From earlier legs (still true):**
- **Any new way to play goes through `PlayerController.play`** (its `open` checks the blocklist).
- **Any new way to add a source** must read the config's refusal (`refusalFor`) and go through `DataEngine.refresh` (the blocklist). This holds for 31c2's paired sources.
- **A new `FailureCategory` in `@lablo/player` needs an entry in `PlayerScreen.tsx`'s `CATEGORY_TEXT`.**
- **In plain `pnpm e2e` the player never reaches `data-state="playing"`** on the mock's live streams: check `#stage video`'s `src` and `data-plays`.
- **An e2e stream host that differs from the source's host:** serve the mock's playlist from `config-server.ts`'s `file('/list.m3u', …)`.
- **`DataEngine`'s refreshes must claim the slot before any `await`.**
- **A settings, guide or source row is 120 px:** the name plus one line. The guides screen's "read, last try failed" rows clip their third line (a known UI bug).
- **Settings has two rows:** "TV guides" `settings/items/0`, "Sources" `settings/items/1`.
- **The e2e blocklist:** `doc({ blocklist: { salt: HARNESS_SALT, hashes: [blocklistHash(HARNESS_SALT, '127.0.0.1')] } })`, then `refreshConfig()`.
- **A player screen with no stream shows the page's white on the desktop;** `player__blank` paints black. Look at every screenshot.
- **The mutation run edits source files:** never commit, build or run e2e while it runs. Check for `*.mutbak` after a stop.
- **Onboarding's first screen is a horizontal row.** The gate has its own navigator (`[data-testid=gate]`).
- **Run the tests before taking out "dead" code.**
- **apps/tv's `tsc` checks test files.**
- **Workers:**
  - a worker the app starts on its own needs an "idle" signal for the old-engine walk;
  - a worker started after the first paint needs its npm deps in `optimizeDeps.include` (the pair worker's deps, tweetnacl and zod/mini, are listed);
  - never open the app's IndexedDB from a test page before `[data-testid="onboarding"][data-ready="true"]`.
- **Polyfill names out of TV code:** a member named `flags` or `at`, `lastIndexOf` on arrays, `concat`, `URL`, regex `.test`, `trim`.
- **CI runs Node 22; this PC runs Node 24.**
- **node-postgres reads a `timestamp` as local time:** read rows through Prisma in web tests.
- **TaskStop on a background `next start` leaves it running:** stop its pid.
- **`next build` type-checks `apps/web/e2e/`.**
- **A running `next start` locks `apps/web/.next`.**
- **Windows Smart App Control:** before every pnpm command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **zod on the TV:** `zod/mini` only. **`apps/tv/src/env.d.ts` must stay a global script.** Root `test/` and `e2e/` files import packages by relative `src` paths or package entries.
- **Overlap CI with the next step,** but never push while a PR's CI runs.
- **Known CI flake:** the media flake (`epg-declared-300mb`). Run `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:**
  1. after `gh pr create`, wait ~45 s (`timeout 45 tail -f /dev/null`), then `gh run list --commit <sha> --event pull_request`;
  2. start one Monitor with the `comm -13` loop over `gh run view <run> --json status,conclusion,jobs` (worked again this leg);
  3. read failures with `gh api repos/Omarmarei/Lablo/actions/jobs/<job id>/logs`.
- **Changing `pnpm-lock.yaml` or the root `package.json` runs every CI job:** about 20 minutes, with engines the longest.
- **Bash heredocs to Python break on mixed quotes and backslashes.** Write the script with the Write tool, with `chr(92)` for backslashes. The Write tool kept `\uD800` escapes this leg, but check: grep for raw `ED A0..BF` bytes.
- **The relay's context check fires at about 450k tokens.**
- **The profile is at version 7; the IDB schema is at version 2.**
- **TV code rules:**
  - no `Array.prototype.sort` in the main bundle;
  - none of these in new TV files: `Uint8Array` as a value, `JSON.stringify`, `new RegExp`, iterators/`for…of`, array destructuring or spread, object spread;
  - the build can crash once (0xC0000005): run it again.
- **`TaskStop` on `verify:engines` leaves its container:** `docker rm -f` it.
- **A bare `sleep N` is blocked:** use `timeout N tail -f /dev/null`, an `until` loop or a Monitor. There is no `jq`: use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:**
  - one TV e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - `pnpm e2e:web` (after `pnpm build:web`, with `pnpm web:db` up): 7 tests;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min, after `pnpm build:tv`; run it in the background and wait for its notice);
  - `pnpm test`: 5,862 tests (`--maxWorkers=3` about 4 min).
- **Code rules:**
  - `packages/ui` components stay hook-free; UI text only from the catalogs;
  - physical CSS only in TV code; no CSS Grid or flex `gap` there; TV code is ES2017;
  - dependencies at least 2 weeks old;
  - never weaken lint;
  - scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation.
- **Scripts:** one-off scripts run as `pnpm --dir "<wt>" exec tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch`, path-filtered;
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data; README.md stays "# Lablo";
  - no production signing seed ever enters the repo, a chat or CI.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 93:**
  - **Locally:**
    - lint, typecheck;
    - unit 5,862;
    - `build:tv` (sizes above);
    - e2e `crypto-vectors.spec.ts`;
    - `verify:engines` on chrome53 and chrome68: all 18 runs as expected, the vectors page 209/209 in page and worker;
    - mutation 152/152.
  - **On CI:** PR #118 green on the first run (all 114 engine runs; the vectors page 209/209 on 53, 56 and 68).
- **Not verified:**
  - the pair worker started by the app on a real engine. Nothing calls `pairing()` yet; 31c2's walk will. Its bundle ran a whole pairing in the Chromium-53 realm test only;
  - a QR code scanned by a real phone from a TV screen;
  - anything on Vercel (step 34).
- **Migrations and deploys:** none this leg. Nothing is in production; nothing is deployed.

## Open decisions and gates
- **For 31c2:**
  - the screen's split into legs;
  - the stand-in pairing API for the engines walk;
  - the screen's layout and words in en and ar.
  These are the leg's own calls: record them in RELAY.md.
- **For 31d:** how the memory store's `http` development URLs pass `pairUploadResponseSchema`'s https rule.
- **Later UI fix (no step yet):** the guides screen's "read, last try failed" rows clip their third line.
- **For step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - Omar creates the Vercel, Neon, R2 and Upstash accounts and the domain;
  - the first production migration and the first deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set;
  - about 30–45 minutes at the LG TV.
- **Later (unchanged):** step 32's backup master in a worker with an idle signal; step 38's parental lock everywhere; step 41's 2018 Samsung measurements; dropping Chromium 53 (ADR-012).

## Checks for Omar (31c1 is merged; nothing on a TV)
1. In the repo: `pnpm exec vitest run packages/core/src/qr.test.ts packages/data/src/pair-service.test.ts test/pair-worker-bundle.test.ts`. Expect 65 passed.
2. `pnpm build:tv`. Expect main.js 440.0 KB (Tizen) and 427.3 KB (webOS) own code, and `pair.worker.ts` 133.5 KB of 150 KB.
3. Nothing to click yet: the pairing screen comes with 31c2.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Memory:** `voicebox-server` held **26 GB** of committed memory this leg (9 GB last leg). The PC's commit charge was nearly full (2.5 GB free at one point). Please close it, or restart it, during relay runs.
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Fifty-four CLAUDE.md gaps** wait for his word:
  - 1–28: leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`);
  - 29–47: leg 86's handover (`git -C "<wt>" show 5fffb27:HANDOVER.md`);
  - 48–51: the gate folder; the refusal and black player rules; `DataEngine.refresh` for every catalog read; `PlayerController.play` for every play;
  - 52: the pairing routes answer 503 on Vercel until step 34; the memory fakes are development-only;
  - 53: `apps/web/src/phone/api.ts` is the backend's one `fetch`, for the phone page's own origin. The "no outbound network" rule could say so, along with `pnpm e2e:web` in the commands table;
  - **54 (new):** the Chromium 53 cheat sheet could add regex `.test` and `trim()` to its polyfill names. The package-boundaries table could name the new entries `@lablo/core/check-qr` and `@lablo/data/pair.worker`.
- **For step 34 (later):** the accounts and the domain are his to create. He puts the keys in `.env` himself, plus `LABLO_RATE_SECRET` (32+ characters) in Vercel. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
