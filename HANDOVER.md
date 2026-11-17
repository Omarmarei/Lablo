# Lablo IPTV: relay leg 85 opening prompt

You are leg 85 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–83 did steps 1–30a (PRs #1–#99), except step 16's Samsung part, 19b and 21 (they wait for Omar) and 29b2b (the Next.js bump, due from 2026-11-17 18:02 UTC).
- **Leg 84 split step 30b and finished 30b1** (the leg ran 07:25–09:05 UTC on 2026-11-17):
  - **The split** (in RELAY.md):
    - **30b1:** the config client's pure parts and its service, in `packages/data`. **Done.**
    - **30b2:** the wiring (config worker, query worker blocklist call, engine schedule, build keys/API base/version). **Next.**
    - **30c:** enforcement in the app, unchanged.
  - **30b1 merged** as PR #100 (`32ae130`), green on the **third** CI run (verify 10 m 57 s, web 39 s, media 12 m 5 s, engines 20 m 5 s). The first two runs failed `verify` on the IDNA oracle tests: CI runs Node 22, whose `domainToASCII` has older tables (see "Gotchas"). Its docs went in as PR #101 (`871e829`).
  - **What 30b1 built** (architecture.md §3.3 "Built in step 30b1"; runbook `docs/runbooks/config.md` "On the TV"). Nothing in the app uses it yet, and the TV bundles are unchanged:
    - **`@lablo/crypto` is `"sideEffects": false`.** `randomBytes` alone still keeps tweetnacl and its PRNG; `blocklistHash` alone keeps none of tweetnacl. Both are proved in `test/crypto-vectors-bundle.test.ts`, with entries `test/crypto-random-entry.ts` and `test/crypto-blocklist-entry.ts`.
    - **`packages/data/src/config-policy.ts`:**
      - `configPolicy(doc, {platform: 'tizen'|'webos'|'browser', version, country})` returns `{kill, notices, updateRequired, minVersion, flags, tunables}`.
      - `kill` is the strongest matching non-notice rule. Each mode includes the weaker ones (`block-new-sources` < `disable-playback` < `disable-app`), and the doc's first rule wins among equals. Notices come in the doc's order.
      - Also: `policyStops(policy, mode)`, `KILL_STRENGTH`, `compareVersions` / `versionParts` (`NaN` when either side is not a version, so nothing version-conditioned matches), `ruleMatches`, `noPolicy()` (a fresh object each call).
      - A rule with `countries` needs a known country. `browser` matches only rules without a platform and has no `minVersion`.
    - **`packages/data/src/blocklist.ts`:**
      - `urlHost(url)` reads the host without `URL`: any `scheme://`; for http, https, ws, wss and ftp, `\` counts as `/` and any number of slashes may follow the colon; the last `@`; IPv6 kept in brackets.
      - `asciiHost(host)`: percent-decode, then for non-ASCII NFKC, per-code-point lowercase, the 13 ignored ranges (`IGNORED`), NFC, the ideographic dot, and `xn--` + `punycode(label)` (RFC 3492), then `blocklistHost`.
      - `new Blocklist(salt, hashes)` gives `.blocksUrl(url)` / `.blocksHost(host)` over `blocklistCandidates`, using an `Object.create(null)` table; an empty list answers without hashing.
      - It follows the **current UTS #46 (Unicode 17)**. Documented gaps: Greek letters with an iota subscript, U+0345, the lunate and mathematical sigmas, U+1C80–1C88, Cherokee, and marks newer than Unicode 15. No Latin host is affected.
    - **`packages/data/src/config-check.ts`:**
      - `checkConfigResponse(text, keys, cachedIssuedAt, now)` returns `{ok: true, config: {cached: {doc, sig, country, fetchedAt}, doc}}` or `{ok: false, refusal}`. The refusals are `not-json`, `bad-response`, `bad-signature`, `bad-doc`, `expired` (`now > expiresAt`) and `older` (`issuedAt` below the cached copy's; an equal one is taken).
      - `readCachedConfig(record, keys)` re-checks shape, signature and doc against the build's keys, **never age**: an expired cached copy stays in force.
    - **`packages/data/src/config-service.ts`:** `new ConfigService({openDb, transport: ByteTransport, keys: Uint8Array[], clock?})`.
      - `.load({platform, version})` reads the cache only.
      - `.refresh({base, platform, version})` does `GET <base>/v1/config` with 3 s for the whole answer and a 4 MiB cap, writes the verified copy to `kv` under `CONFIG_KEY` = `'config'`, and keeps the cache (or the defaults) on any failure.
      - The result is `{status: 'fresh'|'cached'|'none', policy, issuedAt, expiresAt, failure, stored}`. A good answer IDB can't keep still applies (`stored: false`).
      - Constants: `CONFIG_TIMEOUT_MS` 3000, `CONFIG_REFRESH_MS` 6 h, `CONFIG_MAX_BYTES` 4 MiB.
      - All of the above is exported from `@lablo/data`'s index, not from `@lablo/data/client`.
    - **Test helpers in `packages/data/src/test-support.ts`:** `configSigner(label?)` (the dev key by default), `configDocFields(fields)`, `configAnswer(doc, signer?, country?)`.

## Read first
1. **`RELAY.md`:** Phase 8: step 30b's split line, **30b1's "Done in leg 84" block**, **30b2's lines**, 30b's "Measured in leg 83" block, 30c's lines, 29b2b's lines; leg 84's progress-log row.
2. **`docs/architecture.md`:** §3.3 C, "Built in step 30a", **"Built in step 30b1"**, §1.2–1.3 (workers, IndexedDB).
3. **`docs/runbooks/config.md`** ("On the TV" is new), `docs/runbooks/web.md`.
4. **`CLAUDE.md`:** "Package boundaries", the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.
5. **Code to read before building 30b2:**
   - `packages/data`: the four new files above, `ingest-service.ts` + `ingest.worker.ts` (the short-lived worker pattern: `handlers()`, `serveRpc`), `query.worker.ts`, `query-service.ts` (its handlers, `reload`), `client.ts` (the `create*Client` pattern), `package.json` `exports`;
   - `apps/tv`: `src/data/workers.ts`, `engine.ts` (`withWorker`, `start`), `refresh-scheduler.ts`, `main.tsx` (the boot; where "after the first paint" is), `src/data/params.ts` (`readDebugParams`: the e2e override for the API base in 30c), `env.d.ts` (`__PLATFORM__`), `vite.config.ts` (the desktop define);
   - `tools/build`: `src/bundle.ts` (`__PLATFORM__` define, `DEPENDENCY_POLYFILLS`, `POLYFILL_FREE_DEPENDENCIES`), `budgets.ts`, `platform-files.ts` (Tizen `config.xml`: does `<access origin>` need the API host?), `build-tv.ts` (version from `apps/tv/package.json`, targets), `test/query-worker-bundle.test.ts` (a realm worker test template);
   - `artifacts/poly-config30b.py` (leg 83's size probe; adapt it to the real worker entry).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `871e829` (Merge PR #101) = main.
2. **Check the clock:** `date -u`.
   - **From 2026-11-17 18:02 UTC, step 29b2b** (small, its own PR) can go first or after 30b2's PR:
     - the newest two-week-old 16.4 patch (16.4.5; 16.4.6 only from 2026-11-23 20:33 UTC), with `@next/swc-win32-x64-msvc` following;
     - dates: write a tiny `npmdates.py` (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`; registry `https://registry.npmjs.org/<name>`, its `time` field) in the job's tmp folder;
     - advisories: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`;
     - then `pnpm --dir "<wt>" web:db`, `test:web` 13/13, `build:web` (the agent nudge may stop it once: re-run), the SWC binding under Smart App Control; update `web.md`'s gotcha and RELAY.md; PR on green CI.
3. **Step 30b2: look for existing work first** (`git log --oneline -10`; grep `config.worker`, `refreshConfig`, `__LABLO_CONFIG`, `blocked(`). Then **measure before building**: the config worker's size decides its shape.
   - Leg 83 measured "the whole client alone" at 133.4 KB (schemas, verify, host hash). The real worker adds the service, `bytes.ts`, IDB and the policy, but doesn't need `Blocklist`. The worker budget is 150 KB. If it's over, look at what `@lablo/protocol` pulls (it isn't marked `sideEffects: false`; zod/mini tree-shakes) and at duplicate polyfills, before splitting anything.
   - **The config worker:** `packages/data/src/config.worker.ts` plus `ConfigService.handlers()`, a `./config.worker` export, a `createConfigClient` in `client.ts`, and `startConfigWorker` in `apps/tv/src/data/workers.ts`. `DataEngine.refreshConfig(request)` runs a fresh worker per call (`withWorker`). It answers the cached policy first (an event) and then the fetched one, and the worker ends.
   - **The app:** starts it after the first paint and every 6 h (`CONFIG_REFRESH_MS`), never waiting on it, and keeps the policy in a signal. No UI (30c).
   - **The query worker's `blocked(urls)`:**
     - a `Blocklist` from the cached doc's salt and hashes (`JSON.parse` of the verified copy, no zod in this worker);
     - loaded lazily, and again after a config refresh (`reloadConfig`, or reuse `reload`);
     - leg 83 measured +8.2 KB for the hash; the host mapping adds a little.
   - **The build:**
     - a define with the embedded public keys: `config/keys.json`'s production keys; the dev key while there are none, and in the desktop dev app and test builds; a packaged build with production keys never embeds the dev key;
     - the API base: `http://127.0.0.1:3100` in dev; the production domain arrives with step 34; e2e can point it at the test's server through a debug param;
     - the app version from `apps/tv/package.json`;
     - put the defines in both `tools/build/src/bundle.ts` and `apps/tv/vite.config.ts`, and declare them in `env.d.ts`, which stays a global script;
     - check Tizen `config.xml`'s `<access>` for the API host.
   - **Done when** (RELAY 30b2): unit tests (the engine's start after the first paint and every 6 h with a fake clock, the policy signal, the worker ended after each run, `blocked` before and after a refresh); the config worker bundled in a realm without `BigInt`, `globalThis`, the ES2017+ APIs and code generation, answering a dev-signed config from a fake transport; main.js, both workers' budgets and the core-js count measured (`python -I -u artifacts/poly-count20c2a.py "<wt>"`); `verify:engines --engine chrome53 --engine chrome68`; `pnpm e2e`; plus the common items.
   - **If 30b2 is too big for one leg,** split it (for example: the worker and the build vs the query worker's `blocked` and the engine schedule) and write the split into RELAY.md with runnable "Done when" checks before building.
4. **Step 30c** (enforcement) after 30b2: e2e with a dev-signed config served by the test (signed at test time with the dev seed), en/ar screenshots, `verify:engines`, a "press these keys" list for Omar.
5. **Step 26's common items still apply:** unit tests; a mutation run with the mutant list written first; the `pnpm verify` parts green; `test:web` and `build:web` when `apps/web` changes; `verify:engines` if a TV-run page or the build changes; the PR merged on green CI; docs (RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook); a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `871e829` Merge PR #101 = main;
  - `4fed22f` the docs commit (30b1 ticked, leg 84's row);
  - `32ae130` Merge PR #100.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next` (built from 30b1's code);
  - `dist/`: the TV builds (rebuilt in leg 84, the same sizes as before), the lab, `dist/tv-vectors`;
  - `artifacts/`: `mutate30b1.py` and its logs (`mutate30b1.log` 207/220, `-b.log` 11/12, `-c.log` 21/21), `unit-30b1.log` (5,180), `build-30b1.log`, `build-web-30b1.log`, `lint-30b1.log`, `typecheck-30b1.log`, leg 83's `poly-config30b.py` and logs, and older legs' files.
- **Docker:** nothing started in leg 84 (the `lablo-web` Postgres is down; no `lablo-chrome*` container). **No `next start` running.**
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 84:**
- **CI runs Node 22; this PC runs Node 24.** `url.domainToASCII` uses Ada's own IDNA tables, not ICU's. Both report ICU 78, yet Node 22 maps U+1E9E to "ss" and refuses code points the current UTS #46 ignores. Oracle tests now pin literals and compare with Node only under a behaviour gate. Any test that uses Node as an oracle must not assume Node 24 behaviour. Memory `iptv-parser-test-patterns`.
- **A manual clock races fake-indexeddb:** when a service reads IDB before it registers its timer, wait until the sleep exists (`until(() => sleepers.length === 1)`) before advancing. Memory `iptv-data-layer-test-gotchas`.
- **Polyfill names:**
  - `lastIndexOf` pulls `es.array.last-index-of` even on a string, so write a loop;
  - `normalize`, `toLowerCase`, `charCodeAt`, `fromCharCode` and `decodeURIComponent` pull nothing;
  - never use `URL` in TV code (core-js's URL polyfill is about 25 KB).

  Memory `iptv-tv-bundle-polyfills`.
- **A Bash-heredoc Python patch turned `'\\n'` into a real newline again.** Use the Edit tool, or `String.fromCharCode` in tests.
- **The Next agent nudge stopped `build:web` once again.** It is tool output, not Omar's request: retry it; the bump is step 29b2b.
- **Equivalent mutants worth knowing:** punycode's initial bias anywhere from 71 to 82 gives the same output; `k > bias + TMAX` vs `>=`; lookups of 43-character hashes never hit `Object.prototype` names. They are listed in `artifacts/mutate30b1.py`.

**From earlier legs (still true):**
- **Anything imported from `@lablo/crypto`'s index used to keep all of tweetnacl.** It is now side-effect free (PR #100).
- **`fromBase64Url` returns `null`** for a bad string; it never throws.
- **TaskStop on a background `pnpm --filter @lablo/web start` leaves `next start` running:** `netstat -ano | grep ":3100 "`, then `Stop-Process` the pid.
- **Windows Smart App Control blocks rollup's native module.** Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Babel's by-name polyfills vs zod:** `DEPENDENCY_POLYFILLS` gives zod five core-js modules; a new kind of schema may need another. **`zod/mini` never generates code**; never import classic `zod` in TV code. Test a dependency's polyfill allowlist in a bundle of it alone.
- **noble on Chromium 53** tree-shakes its BigInt but needs core-js's `es.global-this`; scrypt N=2^15 takes 0.8–1.0 s on 53, 2.7–3.1 s on 56 (CI), 0.1 s on 68.
- **The crypto vectors:** regenerate with `pnpm exec tsx packages/crypto/test/make-vectors.ts --write`, and rebuild `dist/tv-vectors` (`pnpm exec tsx tools/build/build-tv.ts --target vectors`) before `verify:engines`.
- **`apps/tv/src/env.d.ts` must stay a global script** (put `declare global` in a module file).
- **Root `test/` and `e2e/` files need the workspace package in the root `package.json` devDependencies.**
- **The Write tool decodes `\u`-escapes:** build non-ASCII text from char codes; after writing, list the file's non-ASCII code points with Python.
- **Vitest's `globalSetup` resolves bare imports from the workspace root** (`createRequire`).
- **Prisma 7:** the URL is in `apps/web/prisma.config.ts`; a schema change is `pnpm --filter @lablo/web exec prisma migrate dev --name <x>` with `pnpm web:db` running.
- **Overlap CI with the next step** (memory `iptv-relay-overlap-ci`); never push while a PR's CI runs (a push cancels it).
- **The media flake** (`epg-declared-300mb`): one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:** after `gh pr create`, find the run by `gh run list --commit <sha> --event pull_request`, then one Monitor polling `gh run view <run> --json status,jobs` that prints each finished job and ends with the run.
- **Python with `-I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit tests take about 6–9 s each, bundle tests about 15 s. Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going.
- **The profile is at version 7; the IDB schema is at version 2** (`kv` holds the config, no change needed).
- **TV code rules:**
  - no `Array.prototype.sort` in the TV main bundle;
  - none of these in TV app files: `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls, array destructuring or spread, or a member named `at`;
  - the build can crash once (0xC0000005): run it again.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (names start with `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked:** use an `until` loop or a Monitor. **There is no `jq` in Git Bash:** use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:**
  - one e2e spec: `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`;
  - the engines: `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min, after a fresh `pnpm build:tv`);
  - `pnpm test` takes about 3–5 min (5,180 tests).
- **Local `pnpm verify` may die at the unit stage** (low memory): run its parts separately.
- **Code rules:** `packages/ui` components stay hook-free; UI text comes only from the catalogs; physical CSS only, no CSS Grid or flex `gap`; TV code is ES2017; dependencies at least 2 weeks old; never weaken lint; scoped `git add`; `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree:** the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:**
  - CI runs on `pull_request` and `workflow_dispatch` only, path-filtered (`web` includes `packages/(protocol|crypto)/` and `config/`);
  - commits use the no-reply email;
  - no secrets, no LG binaries, no personal data; README.md stays "# Lablo";
  - **no production signing seed ever enters the repo, a chat or CI.**
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 84 (30b1):**
  - **Locally:** lint, typecheck, unit 5,180 (+103), `build:tv` with every bundle the same size (main 415.7 / 403.0 KB; workers 116.6 / 129.3 / 117.2 KB; vectors worker 161.4 KB), `e2e/crypto-vectors.spec.ts`, `build:web` (after the nudge's one stop).
  - **Mutation:** 220 written first, 207 caught; 7 equivalent, 6 test gaps closed; rerun 11/12 (the survivor equivalent); the table and mapping mutants against the pinned tests 21/21.
  - **CI:** all green on the third run.
- **Not run locally:** `pnpm e2e` (no TV page changed), `verify:engines` (no TV bundle changed; CI's engines job was green), `test:web` (CI's `web` job was green).
- **Migrations and deploys:** nothing new. Nothing in production (Neon arrives with step 34 `[needs Omar]`). Nothing deployed. Profile still at version 7, IDB schema still at version 2.

## Open decisions and gates
- **None for 30b2.** Its shape is the leg's call (record it).
- **Step 34 `[needs Omar]`, including the config key ceremony** (runbook `config.md`):
  - Omar runs `pnpm sign-config keygen` twice on his own machine and keeps the seeds in his password manager and on paper;
  - he gives Claude the two public keys and signs the production config himself;
  - plus the Vercel, Neon, R2 and Upstash accounts and the domain, and the `.env` keys (including a rate-key secret of at least 32 characters);
  - the first production migration and deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player. Steps 24–28 can join that visit, along with whether the TV keyboards type into the search field. The vectors page could run on the TV to time scrypt and zod.
- **For step 32:** derive the backup master once, in a worker, with progress, and cache it (scrypt takes about 3 s on Chromium 56).
- **For step 38 (parental):** every Home shelf, the search results, "Continue watching" and "Recent channels" hold adult items too: the lock must filter them.
- **For step 41 (the 2018 Samsung):** decoded poster memory, posters in lists on the low tier, the search's real time, the scrypt time.
- **Later (unchanged):**
  - search and Home: a kind filter, posters in the search rows, Home and the search on the old-engine walk;
  - movies and shows: a show finished to its last episode coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start" for an episode;
  - player: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents, webOS's PRE-CH, pre-buffered zapping;
  - guide: a day jump; a Guide or Info key;
  - input and accessibility: an on-screen keyboard if the TV keyboards fail;
  - settings and old engines: step 38's settings rows; dropping Chromium 53 (ADR-012);
  - low tier: a memory signal for the tier;
  - CI: the media flake's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (step 30b1 is merged; nothing to press on a TV)
1. In the repo: `pnpm exec vitest run packages/data/src/blocklist.test.ts packages/data/src/config-service.test.ts`. You should see 28 + 37 tests pass.
2. `pnpm sign-config verify` should still say the committed config is good (dev key, about 179 days left).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Forty-five CLAUDE.md gaps** are waiting for his word:
  - 1–28: as listed in leg 51's handover (`git -C "<wt>" show d05d5fd:HANDOVER.md`, "Carry-forward reminders");
  - 29: the `pnpm dev` row should name the live header's "Guide";
  - 30: the `pnpm verify:engines` row's self-test description;
  - 31: the cheat sheet's CSS row could add "no CSS Grid in a poster grid";
  - 32: the commands table could add the one-engine and one-throttled-spec commands;
  - 33: its "Repo: private `Omarmarei/Lablo`" line (public since 2026-11-05);
  - 34: the header (now Guide, Movies, Series, Home, and the Search and Settings icons);
  - 35: the commands table needs the backend's rows (`web:db`, `web:db:down`, `web:dev`, `build:web`, `test:web`, `verify:web`), and the Definition of done's item 1 needs `pnpm verify:web` for backend changes;
  - 36: the "Package boundaries" row for `apps/web` could name the lint block (`NO_OUTBOUND_RULES`, its tests exempt);
  - 37: its Definition of done's item 3 says "N/A until the backend exists (step 29)". Since 29a: local and CI migrations exist; Neon from step 34;
  - 38: the `pnpm build:tv` row: it also builds the vectors page (`dist/tv-vectors`), and `verify:engines` runs it;
  - 39: "Package boundaries": `crypto` has a second entry point, `@lablo/crypto/check-vectors` (tests and the vectors page only);
  - 40: "Package boundaries": `protocol` likewise has `@lablo/protocol/check-samples`;
  - 41: the Chromium 53 cheat sheet could say "TV code uses `zod/mini`, never classic `zod`; a new dependency with modern code gets a polyfill allowlist (`DEPENDENCY_POLYFILLS`) or none (`POLYFILL_FREE_DEPENDENCIES`)";
  - 42: the commands table could add `pnpm sign-config` (keygen, pubkey, sign, verify, block, unblock; runbook `config.md`);
  - 43: the legal guardrails could add "no production config-signing seed in the repo, a chat or CI (`keygen` refuses the repo; Omar signs)";
  - 44 (new): the Chromium 53 cheat sheet could add "no `URL` in TV code (core-js's URL polyfill is about 25 KB) and no `lastIndexOf` (it pulls an array polyfill)";
  - 45 (new): the test notes could say "CI runs Node 22, this PC Node 24: a test that uses Node as an oracle (IDNA, Intl) must not depend on Node 24's tables".
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create, and he puts the keys in `.env` himself. The config key ceremony is his too.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
