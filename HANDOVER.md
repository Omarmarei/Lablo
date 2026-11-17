# Lablo IPTV: relay leg 82 opening prompt

You are leg 82 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–80 did steps 1–29a (PRs #1–#93), except step 16's Samsung part, 19b and 21 (they wait for Omar).
- **Leg 81 split step 29b and finished 29b1:**
  - **The split** (in RELAY.md):
    - **29b1:** `@lablo/crypto` and its shared test vectors. **Done.**
    - **29b2:** `protocol` (zod schemas), the R2 and Upstash interfaces with local fakes, and the Next.js bump. **Next.**
  - **29b1 merged** as PR #94 (`c8267ab`), green on the first CI run (verify 10 m 25 s, web 49 s, media 11 m 56 s, engines 18 m 22 s: all 114 runs as expected, 83 seeded failures caught). Its docs went in as PR #95 (`8c8c1c0`).
  - **What 29b1 built** (architecture.md §3.3 "Built in step 29b1"; runbook `docs/runbooks/old-engines.md` item 8):
    - **`packages/crypto`** over tweetnacl 1.0.3 and @noble/hashes 2.4.0:
      - strict base64url (one spelling per byte string), `utf8`, `concatBytes`;
      - `sha256`, `hmacSha256`, `hkdfSha256` (no salt = zero salt), `scrypt` (async, progress);
      - backup: `backupSalt`, `deriveBackupMaster` (N=2^15, r=8, p=1), `backupKeys` (`lookupId`, `writeToken` as base64url; `encKey`, `localKey`), `tokenHash` (b64url(sha256(token bytes)), for the write token and pairing's poll token), `sealBackup`/`openBackup` (envelope `{v:1, kdf:"scrypt-15-8-1", nonce, ct}`; the gzip is step 32's);
      - pairing: `newBoxKeyPair`, `sealPairPayload`/`openPairPayload` (`{phonePk, nonce, ct}`), the 1 MiB file frames (`frameNonce` = base + index, little-endian with carry; `sealFile`/`openFile` checked against the plain size; `sealFileFrame`/`openFileFrame`);
      - `verifySignature(message, signature, publicKeys)` (Ed25519, false on bad lengths, never a throw), `signKeyPairFromSeed`, `signDetached`;
      - `blocklistHash(salt, host)` = b64url(sha256(UTF-8(salt + host))); `randomBytes`.
    - **The vectors:** `packages/crypto/test/vectors.json` (ASCII) from `make-vectors.ts` (Node's OpenSSL + tweetnacl directly, BigInt for nonces). `@lablo/crypto/check-vectors` (a second entry point, allowed in the lint's entry-point rule) runs 88 checks.
    - **Where they run:** `pnpm test`; `test/crypto-vectors-bundle.test.ts` (the worker bundle in a vm realm without `BigInt`, `globalThis` or the ES2017 APIs); `e2e/crypto-vectors.spec.ts`; `pnpm verify:engines` through the vectors page that `pnpm build:tv` now writes to `dist/tv-vectors` (`apps/tv/src/vectors`: page + Blob worker; a self-test seed `vectors-seed-changed` must fail).
    - **Measured:** the backup's scrypt (N=2^15) takes 0.8–1.0 s on Chromium 53, **3.1 s on 56** (CI), 0.1 s on 68.
    - The app doesn't import crypto yet: its bundles are unchanged (main 415.7 / 403.0 KB, 219 core-js modules).
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:** Phase 8: step 29b's split line, 29b1's "Done in leg 81" block (the pattern to follow), and 29b2's lines; leg 81's progress-log row; "Definition of done", item 3 (migrations local and CI only until step 34 `[needs Omar]`).
2. **`docs/architecture.md`:** §3.2 (the endpoints, for the schemas), §3.3 including "Built in step 29b1" (the envelope and payload shapes the schemas describe), §3.4 (telemetry events).
3. **`docs/runbooks/web.md`:** the backend's commands, database, lint and gotchas.
4. **`packages/protocol/src/index.ts`:** still the step-1 skeleton (`export {}`, `lib: ["ES2017"]`). `packages/crypto` is the model for layout (src tests, a `test/` folder with its own tsconfig, a second entry point if needed).
5. **`CLAUDE.md`:** "Package boundaries" (`protocol` and `crypto` import nothing internal; `apps/web` may import both), the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` should be clean.
   - `git -C "<wt>" log --oneline -3` should show HEAD as this handover's commit, on top of `8c8c1c0` (the merge of PR #95).
   - main is `8c8c1c0`.
2. **Set up the backend locally:** start Docker Desktop if needed, then `pnpm --dir "<wt>" web:db` (volume `lablo-web_postgres`, development database `lablo`, already migrated). `apps/web/.env` is present (gitignored). `pnpm --dir "<wt>" test:web` should give 13/13.
3. **Step 29b2: look for existing work first** (`git log`, grep `zod`, `BlobStore`, `RateLimiter`). Split it (29b2a/29b2b) if it won't fit one leg; write any split into RELAY.md with runnable "Done when" checks before building.
4. **The Next.js bump (do it first, if the clock allows):**
   - Pinned at 16.4.4 (moderate advisory GHSA-mfr8-8qww-v76h, `'use cache'` through `unstable_cache()`, which this app doesn't use).
   - 16.4.5 is two weeks old from **2026-11-17 18:02 UTC**; 16.4.6 from 2026-11-23 (20:33 UTC). Pick the newest two-week-old patch. Before 18:02 UTC on 2026-11-17, leave Next for later in the leg or the next one.
   - Check it with npm's bulk advisory API: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`. Leg 81's scripts (`npmdates.py`, `advisories.py`) were in its job's tmp folder and are gone: write them again (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`).
   - `@next/swc-win32-x64-msvc` follows Next's version: check it loads under Smart App Control (`pnpm build:web`). The agent nudge may stop the first `next build` once (re-run within 5 minutes).
5. **`protocol` with zod (the BigInt question):**
   - zod 4.6.7's `v4/core/util.js` has top-level `/* @__PURE__ */ BigInt(...)` (`BIGINT_FORMAT_RANGES`). Weigh `zod/mini` for the TV.
   - Prove it the way 29b1 proved noble: bundle a protocol-using entry with `bundleIife` and run it in a vm realm without `BigInt` (copy `test/crypto-vectors-bundle.test.ts`), then on Chromium 53 (the vectors page is the pattern: a page in `apps/tv/src/…`, a build target, a harness module). If zod can't be made BigInt-free, keep zod server-side and give the TV plain validators: a written decision either way.
   - Schemas: the config doc (§3.3 C), the pairing payload and the `{phonePk, nonce, ct}` post (§3.3 A; the file's `fileKey`, `base`, `size`, object key), the backup envelope (`{v:1, kdf, nonce, ct}` as `@lablo/crypto` makes it), the telemetry events (§3.4). zod 4.6.7 is old enough (2026-10-12).
6. **`apps/web`'s interfaces, local fakes only:** `BlobStore` (put, get, delete, a presigned PUT for the pairing file) and `RateLimiter` (limit a key: ok or retry-after). The real adapters (step 31 or 34) will need a narrow, tested exception in `NO_OUTBOUND_RULES`. When `apps/web` imports the packages: `transpilePackages: ['@lablo/protocol', '@lablo/crypto']` in `next.config.ts` and the workspace dependencies.
7. **Step 26's common items still apply:** unit tests; a mutation run with the mutant list written first; the `pnpm verify` parts green; `test:web` and `build:web` when `apps/web` changes; `verify:engines` if a TV-run page or the build changes; the PR merged on green CI; docs (RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook); a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `8c8c1c0` Merge PR #95 = main;
  - `5ddc4f1` the docs commit (29b1 ticked);
  - `c8267ab` Merge PR #94.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules` (now with tweetnacl 1.0.3 and @noble/hashes 2.4.0), `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`;
  - `dist/`: the TV builds, the lab and `dist/tv-vectors` (built from `5ddc4f1`'s code);
  - `artifacts/`: `mutate29b1.py` and `.log`, `unit-29b1.log` (4,963), `build-29b1.log`, `lint-29b1.log`, `typecheck-29b1.log`, `engines-29b1.log` (53+68), `engines-29b1-selftest.log` (53), and older legs' files.
- **Docker:** no `lablo-chrome*` container left. The `lablo-web-postgres-1` container is stopped; its volume keeps `lablo` and `lablo_test`.
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 81** (memory `iptv-crypto-gotchas`):
- **noble on Chromium 53:** its top-level PURE `BigInt` calls tree-shake out, but its scheduler reads `globalThis`, so it needs core-js's `es.global-this` (it can't join `POLYFILL_FREE_DEPENDENCIES`). zod is still unproven.
- **scrypt N=2^15 is slow on old engines:** 0.8–1.0 s on 53, 3.1 s on 56 (CI), 0.1 s on 68; a 2018 TV may need 10+ s. Step 32 derives the master once, in a worker, with progress.
- **The vectors:** regenerate with `pnpm exec tsx packages/crypto/test/make-vectors.ts --write`; `vectors.test.ts` fails if the file differs from the generator. A changed check list changes the expected names: rebuild `dist/tv-vectors` (`pnpm build:tv`, or `tsx tools/build/build-tv.ts --target vectors`) before `verify:engines`.
- **tweetnacl's Ed25519 verify accepts a non-canonical S; OpenSSL rejects it.** Keep such cases out of shared vectors.
- **`apps/tv/src/env.d.ts` must stay a global script** (lint forbids `import()` types; an `import` makes it a module): put `declare global` in a module file.
- **Root `test/` and `e2e/` files need the workspace package in the root `package.json` devDependencies** (`@lablo/crypto` was added).
- **Vitest's `toEqual` on MB-sized `Uint8Array`s is slow:** compare with a byte loop.
- **The Write tool decodes `\u`-escapes** (`\uffff`, `\u0660` this time). After writing code with escapes, list the file's non-ASCII code points with Python and re-escape with a `chr(92)` replace. A Bash heredoc fed to `python -` with `\uXXXX` text is a SyntaxError: write the script to a file.
- **The background CI poller was reaped for low memory again.** One foreground `gh pr checks`, then a Monitor (memory `bg-watcher-memory-reap`, leg 14's command) waited out CI.
- **The leg was cut once by a dropped connection (ECONNRESET)** and resumed from the uncommitted worktree. Nothing was lost.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module.** Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Next 16 stops `next build` once when an agent runs it** on a version with an npm advisory (`SecurityFatalError`): check the advisory yourself, re-run within 5 minutes; never set `experimental.agentUpgrade: false`.
- **Vitest's `globalSetup` resolves bare imports from the workspace root** (`createRequire` from `apps/web/package.json`).
- **Prisma 7:** the URL in `apps/web/prisma.config.ts`; a schema change is `pnpm --filter @lablo/web exec prisma migrate dev --name <x>` with `pnpm web:db` running; commit the migration. The forbidden-column check (`FORBIDDEN_COLUMN_WORDS`) rejects ip, url, host, domain, password, user, email, mac, duid, lgudid, serial and similar.
- **`apps/web/test/**` is exempt from the outbound lint;** everything else in `apps/web` is covered.
- **Overlap CI with the next step** (memory `iptv-relay-overlap-ci`): write the next step uncommitted while CI runs; `git merge --ff-only origin/main` after the merge; never push while a PR's CI runs.
- **The media flake** (`epg-declared-300mb`): one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller, never waited on in the foreground.**
- **Python patches:** write them with the Write tool as files (raw strings, `chr(92)` for backslashes), run `python -I <file>`; some working copies are CRLF (`git ls-files --eol`), so normalise line endings in the patch.
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit about 7–9 s each, e2e about 20 s, `test:web` about 10 s. A `Monitor` on `tail -n +1 -f <log> | grep -E --line-buffered "SURVIVED|EXIT|/N"` reports survivors as they come.
- **The profile is at version 7.** The next bump moves the pins to 8 and the "newer version" tests to 9.
- **TV code rules:** no `Array.prototype.sort` in the TV main bundle (the 219 gate); no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls, array destructuring or spread, or a member named `at`, in TV app files (separate test bundles like the vectors page are exempt); the build can crash once (0xC0000005): run it again.
- **`python -I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop under 600 s, or a background task.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:** one e2e spec `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`; the engines `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min, needs a fresh `pnpm build:tv`); the poly count `python -I -u artifacts/poly-count20c2a.py "<wt>"`.
- **Never `cd`.** Use absolute paths, `git -C`, `pnpm --dir`.
- **Local `pnpm verify` may die at the unit stage** (low memory): run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going.**
- **Code rules:** `packages/ui` components stay hook-free; UI text only from the catalogs; physical CSS only, no CSS Grid or flex `gap`; TV code is ES2017; dependencies at least 2 weeks old; never weaken lint; scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request` and `workflow_dispatch` only, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 81 (29b1):**
  - **Locally:** lint, typecheck, unit 4,963, both TV builds unchanged (219 core-js modules), the new e2e spec; `verify:engines --engine chrome53 --engine chrome68` all 18 runs as expected; `verify:engines --self-test --engine chrome53` all 38 runs as expected (29 seeds caught; vectors 88/88, the seed 87/88).
  - **Mutation:** 58 written first, 56 caught; one gap closed (re-run caught), one equivalent taken out.
  - **CI:** green on the first run, Chromium 56 included (88/88).
- **Not run locally:** the full `pnpm e2e` (no app code changed; CI's `verify` ran it, green).
- **Migrations and deploys:** nothing new. The only migration (`init`) is on the local and CI databases; nothing in production (Neon arrives with step 34 `[needs Omar]`). Nothing deployed. The TV profile is still at version 7.

## Open decisions and gates
- **None for step 29b2.** How to split it, and zod on the TV or not, are the leg's call (record the decision).
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player. Steps 24–28 can join that visit (catch-up, movies and series, details, playing and resuming, episodes, auto-next, search, Home with "Recent channels"), and whether the TV keyboards type into the search field. The crypto vectors page (`dist/tv-vectors`) could also be opened on the TV to time the real scrypt.
- **Step 34 `[needs Omar]`:** the Vercel, Neon, R2 and Upstash accounts and the domain; he puts the keys in `.env` himself. The first production migration and deploy each need his one-word OK.
- **For step 30:** the app will import `@lablo/crypto`: watch the 219 core-js gate (noble needs `es.global-this`; Babel injects by name).
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

## Checks for Omar (step 29b1 is merged; nothing to press on a TV)
1. In the repo, `pnpm build:tv`.
2. Open `dist/tv-vectors/index.html` in Chrome (a `file://` page is fine).
3. You should see `page: 88/88 passed in … ms` and `worker: 88/88 passed in … ms`, then your browser's user agent.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Thirty-nine CLAUDE.md gaps** are waiting for his word:
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
  - 38 (new): the `pnpm build:tv` row: it also builds the crypto vectors page (`dist/tv-vectors`), and `verify:engines` runs it;
  - 39 (new): "Package boundaries": `crypto` has a second entry point, `@lablo/crypto/check-vectors` (tests and the vectors page only).
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create. He puts the keys in `.env` himself.
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
