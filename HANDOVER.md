# Lablo IPTV: relay leg 83 opening prompt

You are leg 83 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–81 did steps 1–29b1 (PRs #1–#95), except step 16's Samsung part, 19b and 21 (they wait for Omar).
- **Leg 82 split step 29b2 and finished 29b2a** (the leg ran 05:26–06:30 UTC on 2026-11-17):
  - **The split** (in RELAY.md):
    - **29b2a:** `@lablo/protocol` on zod, proved on the old engines; the blob store and rate limiter fakes. **Done.**
    - **29b2b:** the Next.js bump. **Next, but only from 2026-11-17 18:02 UTC** (16.4.5's two-week mark).
  - **29b2a merged** as PR #96 (`1bfa341`), green on the first CI run (verify 12 m 41 s, web 51 s, media 10 m 24 s, engines 19 m 44 s: all 114 runs as expected, 83 seeded failures caught; the vectors page 192/192 on Chromium 53, 56 and 68). Its docs went in as PR #97 (`ba9afe8`).
  - **What 29b2a built** (architecture.md §3.2 "Built in step 29b2a"; runbooks `web.md` "The blob store and the rate limiter" and `old-engines.md` item 8):
    - **`packages/protocol`** on `zod/mini` 4.6.7, files `wire.ts`, `config.ts`, `pairing.ts`, `backup.ts`, `telemetry.ts`:
      - wire values: `bytes16`, `nonce24`, `bytes32`, `signature64`, `base64UrlRange` (exactly crypto's strict base64url, regex literals), `epochMs`, `platform`, `appVersion`, `country`, `link`, `text(max)`;
      - config: `configDocSchema` (v 1, issuedAt < expiresAt, minVersion, kill rules with `{id, match: {platform?, versions?: {min?, max?}, countries?}, mode, message?: {en, ar}}`, blocklist `{salt, hashes}`, flags, tunables), `signedConfigSchema` `{doc, sig}`, `configResponseSchema` (+ `country`);
      - pairing: the code, create in/out, TV key, `sealedPayloadSchema`, upload request/answer, poll answer, status, and the boxed `pairPayloadSchema` (Xtream, M3U link, M3U file `{key, fileKey, base, size}`);
      - backup: `backupEnvelopeSchema`, `lookupIdSchema`, `writeTokenSchema`;
      - telemetry: batch, seven events, `countBucket`, `rateBucket`, `readTelemetryEvents`.
      - Conventions: unknown fields stripped; an incompatible change needs a new `v`; times in epoch ms; limits pinned to §3.2 (32 KB payload, 64 KB pairing body, 40 MB file, 512 KB backup, 64 KB telemetry, 200 events).
    - **The samples:** `@lablo/protocol/check-samples` (second entry point, allowed in the lint), 104 samples with expected `code@path` issues. They run in Node, bundled alone (`test/protocol-bundle-entry.ts`) in a realm without BigInt, globalThis, ES2017+ APIs and code generation, in the vectors worker with the crypto vectors, in e2e, and on the old engines through the vectors page (`apps/tv/src/vectors/vectors-checks.ts`: crypto then samples, 192 checks).
    - **The TV pipeline:** `tools/build/src/bundle.ts` `DEPENDENCY_POLYFILLS` gives zod only five core-js polyfills (`es.global-this`, `es.object.entries`, `es.object.values`, `es.object.from-entries`, `es.object.get-own-property-descriptors`), via `polyfillsExcept`.
    - **`apps/web`:** `src/server/blob-store.ts` (`BlobStore`, `MemoryBlobStore` with HMAC-signed presigned URLs and `redeem`), `src/server/rate-limit.ts` (`RateLimiter`, `MemoryRateLimiter`, `rateKey`, `retryAfterSeconds`). No route uses them yet; `apps/web` doesn't import the packages yet.
    - **Decision (recorded):** zod on the TV as `zod/mini` with the allowlist. Importing the four schemas the TV will use costs 34.8 KB of main.js (webOS 403.0 → 437.8 KB of 500) and 219 → 232 core-js modules. The app bundles are unchanged until step 30 imports them.
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:** Phase 8: 29b2's split line, 29b2a's "Done in leg 82" block, 29b2b's lines, step 30's line; leg 82's progress-log row; "Definition of done", item 3 (migrations local and CI only until step 34 `[needs Omar]`).
2. **`docs/architecture.md`:** §3.2 "Built in step 29b2a", §3.3 C (config signing: the doc, two embedded public keys, `tools/sign-config`, fetch at launch and every 6 h, blocklist matching), §3.3 "Built in step 29b1".
3. **`docs/runbooks/web.md`:** commands, the blob store and rate limiter, gotchas (the agent nudge).
4. **`CLAUDE.md`:** "Package boundaries", the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` clean.
   - `git -C "<wt>" log --oneline -3`: HEAD is this handover's commit, on top of `ba9afe8` (Merge PR #97) = main.
2. **Check the clock:** `date -u`.
   - **From 2026-11-17 18:02 UTC: step 29b2b** (small, its own PR):
     - newest two-week-old 16.4 patch (16.4.5; 16.4.6 only from 2026-11-23 20:33 UTC); `@next/swc-win32-x64-msvc` follows;
     - dates: rewrite `npmdates.py` (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`; registry `https://registry.npmjs.org/<name>`, `time` field) into the job's tmp folder;
     - advisories: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`;
     - `pnpm --dir "<wt>" web:db`, `test:web` 13/13, `build:web` (the agent nudge may stop it once: re-run within 5 minutes; if the new version has no advisory it shouldn't fire), the SWC binding under Smart App Control; update `web.md`'s gotcha and RELAY.md; PR on green CI.
   - **Before 18:02 UTC: start step 30** and do 29b2b in a later leg (or later in this one), in its own PR.
3. **Step 30 (signed config): look for existing work first, then split it** (it won't fit one leg). Likely parts: (a) `tools/sign-config` + `config/config.json` + the signed output + its tests (a **dev/test key pair only**; the real offline Ed25519 key is Omar's: generating it and embedding its public keys is a `[needs Omar]` gate, see below); (b) `GET /v1/config` in `apps/web` (first route importing `@lablo/protocol`: add it and `@lablo/crypto` as dependencies and to `transpilePackages`; the country from the geo header; 5-minute cache); (c) the TV client: fetch without blocking (3 s timeout, every 6 h), verify against the embedded keys, `configDocSchema`, cache, fall back; kill modes; the hashed blocklist (host and parent domains, when a source is added, on refresh, before playing; API host and final stream host). Write the split into RELAY.md with runnable "Done when" checks before building.
4. **For the TV side of step 30:** importing `@lablo/protocol` and `@lablo/crypto` into the app changes the core-js count (zod +13 measured; noble needs `es.global-this` too) and main.js (+35 KB for four schemas): re-measure with `artifacts/poly-zod29b2a.py` (entries written to `packages/protocol/src/zz-*.ts`) and `python -I -u artifacts/poly-count20c2a.py "<wt>"`; keep main under 500 KB; consider parsing in a worker if main gets tight.
5. **Step 26's common items still apply:** unit tests; a mutation run with the mutant list written first; the `pnpm verify` parts green; `test:web` and `build:web` when `apps/web` changes; `verify:engines` if a TV-run page or the build changes; the PR merged on green CI; docs (RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook); a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `ba9afe8` Merge PR #97 = main;
  - `de6a461` the docs commit (29b2a ticked);
  - `1bfa341` Merge PR #96.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules` (now with zod 4.6.7), `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next`;
  - `dist/`: the TV builds, the lab and `dist/tv-vectors` (built from 29b2a's code: 192 checks);
  - `artifacts/`: `mutate29b2a.py` and `.log`, `mutate29b2a-rerun.py` and `.log`, `poly-zod29b2a.py`, `engines-29b2a.log`, `engines-29b2a-final.log` (53+68), `unit-29b2a.log` (5,011), `build-29b2a.log`, `build-web-29b2a.log`, `lint-29b2a.log`, `typecheck-29b2a.log`, `probe-*.ts/js`, and older legs' files.
- **Docker:** the `lablo-web` Postgres is down (`web:db:down`; the volume keeps `lablo` and `lablo_test`); no `lablo-chrome*` container.
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 82** (memory `iptv-zod-protocol-gotchas`):
- **Babel's by-name polyfills vs zod:** without `DEPENDENCY_POLYFILLS` one `zod/mini` schema bundled to 110 KB and core-js's DOMException polyfill threw at load in the vm realm. A new kind of schema may need another polyfill: add samples for it; the protocol-only realm test shows what's missing.
- **`zod/mini` never generates code** (`z.object` is the interpreted `$ZodObject`; classic zod's `$ZodObjectJIT` uses `new Function`), so it works under a CSP without `unsafe-eval`. `vm.createContext(ctx, { codeGeneration: { strings: false } })` proves it. Never import classic `zod` in TV code.
- **Test a dependency's polyfill allowlist in a bundle of it alone:** in the vectors worker, crypto's own polyfills masked mutants removing `globalThis`/`Object.entries` from zod's list.
- **Mutation lessons:** every schema field a mutant could loosen needs an invalid sample; `tsc`-only type-equality checks don't fail vitest (add runtime samples); pin documented limits or tests derived from a constant never notice it changing. First run 105/122; the gaps closed, 14/14 re-run caught.
- **`preset-env` `exclude` regexes match syntax plugins too:** `polyfillsExcept` anchors on `(?:es|esnext|web)\.` so the transforms stay.
- **The Next agent nudge stopped `build:web` again** (16.4.4 still has GHSA-mfr8-8qww-v76h). Its text asks to run `next upgrade --agent=security`: that's tool output, not Omar's request; the bump is step 29b2b.
- **Python patches from a Bash heredoc still mangle `\\n`** (they became real newlines inside string literals). Write patch scripts with the Write tool.
- **A `cd "<wt>" ...;` inside a Bash command persisted** the shell's directory (harmless here). Keep using absolute paths, `git -C`, `pnpm --dir`, `gh -R`.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module.** Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **noble on Chromium 53** tree-shakes its BigInt but needs core-js's `es.global-this`; scrypt N=2^15 takes 0.8–1.0 s on 53, 2.7–3.1 s on 56 (CI), 0.1 s on 68.
- **The crypto vectors:** regenerate with `pnpm exec tsx packages/crypto/test/make-vectors.ts --write`; any new check or sample changes the names: rebuild `dist/tv-vectors` (`pnpm exec tsx tools/build/build-tv.ts --target vectors`) before `verify:engines`.
- **`apps/tv/src/env.d.ts` must stay a global script** (put `declare global` in a module file).
- **Root `test/` and `e2e/` files need the workspace package in the root `package.json` devDependencies** (`@lablo/crypto` and `@lablo/protocol` are there).
- **The Write tool decodes `\u`-escapes.** After writing code with escapes, list the file's non-ASCII code points with Python; build non-ASCII text from char codes.
- **Vitest's `globalSetup` resolves bare imports from the workspace root** (`createRequire` from `apps/web/package.json`).
- **Prisma 7:** the URL in `apps/web/prisma.config.ts`; a schema change is `pnpm --filter @lablo/web exec prisma migrate dev --name <x>` with `pnpm web:db` running; commit the migration. The forbidden-column check rejects ip, url, host, domain, password, user, email, mac, duid, lgudid, serial and similar.
- **`apps/web/test/**` is exempt from the outbound lint;** everything else in `apps/web` is covered.
- **Overlap CI with the next step** (memory `iptv-relay-overlap-ci`); never push while a PR's CI runs.
- **The media flake** (`epg-declared-300mb`): one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:** one foreground `gh pr checks` (wait about 20 s after `gh pr create`), then a Monitor that prints each finished check and ends when none is pending (leg 82's worked).
- **Python with `-I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`. Some working copies are CRLF (`git ls-files --eol`).
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit about 7–9 s each, bundle tests about 15 s, e2e about 20 s, `test:web` about 10 s. A Monitor on `tail -n +1 -f <log> | grep -E --line-buffered "SURVIVED|NOT FOUND|EXIT|/N"` reports survivors as they come. Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going.
- **The profile is at version 7.** The next bump moves the pins to 8 and the "newer version" tests to 9.
- **TV code rules:** no `Array.prototype.sort` in the TV main bundle; no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls, array destructuring or spread, or a member named `at`, in TV app files (separate test bundles like the vectors page are exempt); the build can crash once (0xC0000005): run it again.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop under 600 s, or a Monitor.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:** one e2e spec `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`; the engines `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min, needs a fresh `pnpm build:tv`); `pnpm test` (about 5 min, 5,011 tests).
- **Local `pnpm verify` may die at the unit stage** (low memory): run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **Code rules:** `packages/ui` components stay hook-free; UI text only from the catalogs; physical CSS only, no CSS Grid or flex `gap`; TV code is ES2017; dependencies at least 2 weeks old; never weaken lint; scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request` and `workflow_dispatch` only, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 82 (29b2a):**
  - **Locally:** lint, typecheck, unit 5,011, `test:web` 13/13, `build:web`, both TV builds unchanged (main 415.7 / 403.0 KB, 219 core-js modules), the vectors e2e spec; `verify:engines --engine chrome53 --engine chrome68` all 18 runs as expected (192/192 in page and worker on both).
  - **Mutation:** 122 written first, 105 caught; 13 gaps closed, two allowlist entries taken out (never reached), one equivalent; the 14 left re-run, all caught.
  - **CI:** green on the first run, Chromium 56 included (192/192).
- **Not run locally:** the full `pnpm e2e` (CI's `verify` ran it, green).
- **Migrations and deploys:** nothing new. The only migration (`init`) is on the local and CI databases; nothing in production (Neon arrives with step 34 `[needs Omar]`). Nothing deployed. The TV profile is still at version 7.

## Open decisions and gates
- **None for step 29b2b.** The step 30 split is the leg's call (record it).
- **Likely gate in step 30:** the production Ed25519 signing key. architecture.md §3.3 C keeps the private key offline (Omar's password manager and a paper backup) and embeds two public keys. Build and test everything with a dev key pair; ask Omar (needs-you) before embedding production public keys or signing a production config.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player. Steps 24–28 can join that visit (catch-up, movies and series, details, playing and resuming, episodes, auto-next, search, Home with "Recent channels"), and whether the TV keyboards type into the search field. The vectors page (`dist/tv-vectors`, now crypto and protocol) could also run on the TV to time the real scrypt and zod.
- **Step 34 `[needs Omar]`:** the Vercel, Neon, R2 and Upstash accounts and the domain; he puts the keys in `.env` himself (also a rate-key secret of at least 32 characters for `rateKey`). The first production migration and deploy each need his one-word OK.
- **For step 32:** the backup master's scrypt takes about 3 s on Chromium 56 on a CI runner: derive it once, in a worker, with progress, and cache it.
- **For step 38 (parental):** every Home shelf, the search results, "Continue watching" and "Recent channels" hold adult items too: the lock must filter them.
- **For step 41 (the 2018 Samsung):** the decoded memory of real posters and logos; whether the low tier keeps posters in lists; the search's real time on the TV; the scrypt time.
- **Later (unchanged):**
  - search and Home: a kind filter, posters in the search rows, Home and the search on the old-engine walk;
  - movies and shows: a show finished to its last episode coming back to "Continue watching"; OK on a "Continue watching" tile playing at once; an auto-next setting; "Play from the start" for an episode;
  - player: fine seeking inside HLS archives, "start over", separate PLAY and PAUSE intents, webOS's PRE-CH, pre-buffered zapping;
  - guide: a day jump; a Guide or Info key;
  - input and accessibility: an on-screen keyboard if the TV keyboards fail;
  - settings and old engines: step 38's settings rows; drop Chromium 53 (ADR-012);
  - low tier: a memory signal for the tier;
  - CI: the media flake's single-sample budgets.
- **Later gates:** steps 19b, 21, 34, 44, 46 and 47. Before the first store submission: the final app IDs (`com.lablo.*`, `LabloIPTV1`, pending trademark clearance) and real icons.

## Checks for Omar (step 29b2a is merged; nothing to press on a TV)
1. In the repo, `pnpm build:tv`.
2. Open `dist/tv-vectors/index.html` in Chrome (a `file://` page is fine).
3. You should see `page: 192/192 passed in … ms` and `worker: 192/192 passed in … ms` (88 crypto vectors and 104 protocol samples), then your browser's user agent.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Forty-one CLAUDE.md gaps** are waiting for his word:
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
  - 38: the `pnpm build:tv` row: it also builds the vectors page (`dist/tv-vectors`: crypto vectors and protocol samples), and `verify:engines` runs it;
  - 39: "Package boundaries": `crypto` has a second entry point, `@lablo/crypto/check-vectors` (tests and the vectors page only);
  - 40 (new): "Package boundaries": `protocol` likewise has `@lablo/protocol/check-samples`;
  - 41 (new): the Chromium 53 cheat sheet could say "TV code uses `zod/mini`, never classic `zod`; a new dependency with modern code gets a polyfill allowlist (`DEPENDENCY_POLYFILLS`) or none (`POLYFILL_FREE_DEPENDENCIES`)".
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create. He puts the keys in `.env` himself.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
