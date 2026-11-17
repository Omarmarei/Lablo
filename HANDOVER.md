# Lablo IPTV: relay leg 84 opening prompt

You are leg 84 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–82 did steps 1–29b2a (PRs #1–#97), except step 16's Samsung part, 19b and 21 (they wait for Omar) and 29b2b (the Next.js bump, due from 2026-11-17 18:02 UTC).
- **Leg 83 split step 30 and finished 30a** (the leg ran 06:32–07:25 UTC on 2026-11-17):
  - **The split** (in RELAY.md):
    - **30a:** the signer, the config files and `GET /v1/config`. **Done.**
    - **30b:** the TV's config client, no UI. **Next.**
    - **30c:** enforcement in the app (kill modes, update screen, blocklist at add, refresh and play).
    - The production key ceremony moved into step 34's Omar list.
  - **30a merged** as PR #98 (`79f834b`), green on the first CI run (verify 9 m 40 s, web 37 s, media 9 m 35 s, engines 20 m 45 s). Its docs went in as PR #99 (`c2752e3`).
  - **What 30a built** (architecture.md §3.3 "Built in step 30a"; runbook `docs/runbooks/config.md`; `web.md` updated):
    - **`pnpm sign-config`** (`tools/sign-config`: `sign-config.ts`, `src/config.ts` pure functions, `src/cli.ts` with `runSignConfig(argv, env)`):
      - `keygen --out <file>`: writes a seed line `lablo-config-seed-v1:<43 b64url>`. Refuses a path inside the repo and an existing file. Prints the public key.
      - `pubkey --key <file>`.
      - `sign --key <file> | --dev [--days N]`: stamps `issuedAt` = now and `expiresAt` (180 days by default, 1 to 400). Refuses: what `configDocSchema` refuses, any field it would strip, dates already in the source, an unsorted or repeated blocklist, an untrusted key.
      - `verify`: a trusted signature, a valid doc, equal to `config.json`, not expired; prints the days left.
      - `block` / `unblock <host>...`.
    - **The files:**
      - `config/config.json`: the doc without its dates (no kill rules, an empty blocklist with its fixed salt, no flags or tunables);
      - `config/config.signed.json`: `{doc, sig}`, dev-signed, expires 2027-05-16;
      - `config/keys.json`: `{production: [], dev: "XSL7BTMmu8T8z5VeovgdDDUYpXucxAgRpaNV8mOUSxc"}`.
    - **The dev key:** its seed is SHA-256 of `lablo.config.dev-key.v1`, public on purpose. It is trusted only while `production` is empty; then `sign --dev` and a dev-signed file are refused. `tools/sign-config/test/committed.test.ts` checks that the committed signed file is `config.json` signed by a trusted key. It doesn't check the date, so CI can't fail on a calendar day.
    - **`@lablo/core`:** `blocklistHost(input)` (ASCII lowercase, one trailing dot dropped, IPv6 in brackets; `null` for a port, path, login, empty or long label (63) or host (253), and any non-ASCII) and `blocklistCandidates(host)` (the host and each parent down to the last label; an IP address alone). IP addresses are taken as written.
    - **`GET /v1/config`** (`apps/web/src/server/config.ts`, `src/app/v1/config/route.ts`):
      - the answer is `{doc, sig, country}`; the signed file is imported into the function and checked with `signedConfigSchema` when it loads;
      - `country` is `x-vercel-ip-country` when it is two capital letters, else `null`;
      - `cache-control: private, max-age=300` (not a CDN cache: the answer carries the country; the architecture.md §3.2 table is updated) and `access-control-allow-origin: *`.
      - `apps/web` depends on `@lablo/protocol` and `@lablo/crypto` (`transpilePackages`). Turbopack compiled them without it too; it's kept as a statement.
      - CI's `web` filter gained `config/`.
  - **Measured for 30b** (`artifacts/poly-config30b.py`, webOS; RELAY.md 30b "Measured in leg 83"):
    - **The whole client** (response and doc schemas, Ed25519 verify, the host form and hash):
      - in main.js, +89.6 KB (403.0 → 492.6 KB of 500);
      - in the query worker, +76.6 KB (116.6 → 193.2, over its 150 KB budget);
      - alone, 133.4 KB: a worker of its own fits.
    - **The blocklist check alone:**
      - +53.7 KB in main and +40.3 KB in the query worker, because importing anything from `@lablo/crypto`'s index keeps all of tweetnacl (CommonJS, kept for its side effects);
      - **with `"sideEffects": false` in `packages/crypto/package.json`:** +20.9 KB in main and **+8.2 KB in the query worker** (124.8 of 150).
- **Relay cap:** 100 legs.

## Read first
1. **`RELAY.md`:** Phase 8: step 30's split line, 30a's "Done in leg 83" block, **30b's lines and its "Measured in leg 83" block**, 30c's lines, 29b2b's lines, step 34's key ceremony line; leg 83's progress-log row.
2. **`docs/architecture.md`:** §3.3 C (config signing: fetch at launch without blocking, 3 s timeout, every 6 h; verify, cache, fall back; blocklist on add, refresh and play, the API host and the final stream host), §3.3 "Built in step 30a", §1.2–1.3 (workers, IndexedDB: the cache can always be rebuilt).
3. **`docs/runbooks/config.md`** (the files, commands, the doc's fields, the keys, `GET /v1/config`), `docs/runbooks/web.md`.
4. **`CLAUDE.md`:** "Package boundaries" (`data` may import `core`, `protocol`, `crypto`; `ui` uses `data` as a client only), the Chromium 53 cheat sheet, the project rules. Edits to CLAUDE.md need Omar's direct word in his own tab.
5. **Code to read before designing 30b:** `packages/data/src/client.ts`, `query.worker.ts`, `ingest-service.ts` (a short-lived worker's life), `idb.ts`/`schema.ts` (stores and versions), `profile.ts`; `apps/tv/src/data/workers.ts`, `engine.ts`, `refresh-scheduler.ts`; `apps/tv/src/main.tsx` (the boot); `tools/build/src/bundle.ts` (`__PLATFORM__` define, `DEPENDENCY_POLYFILLS`, `POLYFILL_FREE_DEPENDENCIES`) and `budgets.ts`; `packages/crypto/src/random.ts` (`randomBytes` and tweetnacl's PRNG); `packages/platform-tizen/src/redirect-probe.ts` (the final URL on Tizen, for 30c).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` clean.
   - `git -C "<wt>" log --oneline -3`: HEAD is this handover's commit, on top of `c2752e3` (Merge PR #99) = main.
2. **Check the clock:** `date -u`.
   - **From 2026-11-17 18:02 UTC, step 29b2b** (small, its own PR) can go first or after 30b's PR:
     - newest two-week-old 16.4 patch (16.4.5; 16.4.6 only from 2026-11-23 20:33 UTC); `@next/swc-win32-x64-msvc` follows;
     - dates: rewrite a tiny `npmdates.py` (Python `urllib`, `-I`, `sys.stdout.reconfigure(encoding='utf-8')`; registry `https://registry.npmjs.org/<name>`, `time` field) in the job's tmp folder;
     - advisories: POST `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`;
     - `pnpm --dir "<wt>" web:db`, `test:web` 13/13, `build:web` (the agent nudge may stop it once: re-run within 5 minutes; if the new version has no advisory it shouldn't fire), the SWC binding under Smart App Control; update `web.md`'s gotcha and RELAY.md; PR on green CI.
3. **Step 30b: look for existing work first** (`git log --oneline -20`; grep `config-worker`, `configClient`, `CONFIG_KEYS`, `sideEffects`), **then decide whether to split it** (likely: it is a full leg or more). A possible split, to write into RELAY.md with runnable "Done when" checks before building:
   - **30b1, the pure parts:**
     - `@lablo/crypto` gets `"sideEffects": false` (prove `randomBytes` still seeds tweetnacl where it is used, and that the vectors page and the crypto realm test still pass);
     - in `packages/data`: the policy (`{platform, version, country, now}` against the doc: the strongest matching kill mode, notices by rule id, update required below `minVersion`, semver compare) and the blocklist check (`blocklistHost` on the URL's host, a Unicode host turned to punycode first, then `blocklistCandidates`, hashed under the salt, against a Set);
     - unit tests and a mutation run.
   - **30b2, the client:**
     - a short-lived **config worker**: fetch `GET <api>/v1/config` (XHR, 3 s timeout), `configResponseSchema`, the signature against the embedded keys, `JSON.parse` then `configDocSchema`; refuse a doc already expired or older (`issuedAt`) than the cached one; cache the verified doc in IDB (a new store means a schema version bump, see `schema.ts`); post the policy to main and end;
     - started after the first paint and every 6 h;
     - the blocklist check in the query worker, reading the cached salt and hashes;
     - **the build:** the embedded keys from `config/keys.json` (production keys, plus the dev key in dev and test builds only; a store package must refuse the dev key) and the API base (`http://127.0.0.1:3100` in dev; the production domain arrives with step 34): a `__CONFIG__`-style define in `tools/build/src/bundle.ts`;
     - the worker bundled in a realm without `BigInt`, `globalThis`, the ES2017+ APIs and code generation; budgets (worker 150 KB, main 500 KB) and the core-js count re-measured (`python -I -u artifacts/poly-count20c2a.py "<wt>"`, `artifacts/poly-config30b.py`); `verify:engines --engine chrome53 --engine chrome68`.
   - **Decide while building (record them; no gate):** an expired cached doc stays in force until a newer one replaces it (a kill must not lapse because the TV is offline), while a doc that *arrives* already expired is refused (replays). A TV clock far behind must not refuse everything: only `now > expiresAt` refuses, never `issuedAt` in the future.
4. **Step 30c** (enforcement) after 30b, with e2e (a dev-signed config served by the test, signed with the dev seed at test time), en/ar screenshots, `verify:engines`, a "press these keys" list.
5. **Step 26's common items still apply:** unit tests; a mutation run with the mutant list written first; the `pnpm verify` parts green; `test:web` and `build:web` when `apps/web` changes; `verify:engines` if a TV-run page or the build changes; the PR merged on green CI; docs (RELAY.md "Done in leg …", architecture.md "Built in step …", the runbook); a docs PR recording the merge.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
- **HEAD:** the commit adding this HANDOVER.md, on top of:
  - `c2752e3` Merge PR #99 = main;
  - `4b0a2fc` the docs commit (30a ticked, 30b's measurements);
  - `79f834b` Merge PR #98.

  This handover commit goes to main with the next PR.
- **No PR is open.** The main checkout (`D:/Claude Code PlayGround/IPTV`) was not touched.
- **Gitignored but present:**
  - `node_modules` (now with `@lablo/tools-sign-config` linked), `.cache/rollup-wasm`, `.cache/engines`, `.cache/media`;
  - `apps/web/.env`, `apps/web/src/generated/prisma`, `apps/web/.next` (built from 30a's code);
  - `dist/`: the TV builds (unchanged by 30a), the lab, `dist/tv-vectors` (192 checks);
  - `artifacts/`: `mutate30a.py` and `.log` (96/96), `poly-config30b.py` and its two logs, `live-config-30a.ts` and `.log`, `unit-30a.log` (5,077), `build-30a.log`, `build-web-30a.log`, `build-web-30a-notranspile.log`, `test-web-30a.log`, `lint-30a.log`, `typecheck-30a.log`, `web-start-30a.log`, and older legs' files.
- **Docker:** the `lablo-web` Postgres is down (`web:db:down`; the volume keeps `lablo` and `lablo_test`); no `lablo-chrome*` container.
- **No `next start` left running** (the orphan from a TaskStop was killed; port 3100 free).
- **On the TV:** only the old lab, under its old id. The app was never installed on the TV.
- **Outside the repo:** the webOS Simulator in `D:/tools/webos-sim/`. Never commit it.

## Gotchas and lessons
**New in leg 83:**
- **Anything imported from `@lablo/crypto`'s index keeps all of tweetnacl** (CommonJS, kept for its side effects): the blocklist hash alone cost +40 KB in a worker. `"sideEffects": false` in its package.json brings it to +8 KB (measured, then reverted: 30b decides). Memory `iptv-crypto-gotchas`.
- **`fromBase64Url` returns `null`** for a bad string; it never throws.
- **TaskStop on a background `pnpm --filter @lablo/web start` leaves `next start` running** on Windows (port 3100 still answered). Find the pid with `netstat -ano | grep ":3100 "`, check its command line (`Get-CimInstance Win32_Process`), then `Stop-Process`. In `web.md`'s gotchas.
- **Turbopack compiles the workspace packages' TypeScript without `transpilePackages`** (they resolve outside `node_modules`); it is kept anyway.
- **Bash heredoc Python patches mangled backslashes again:** `'D:\\\\repo'` became `D:\repo` (a `\r` in JS). Python `\.` in a non-raw heredoc string happened to survive. Write patch scripts with the Write tool, use `r"..."` for regexes, and prefer forward slashes in test paths.
- **The Write tool decoded `\u212A`** (the Kelvin sign) into the raw character again: build such test strings with `String.fromCharCode`.
- **A CI wait loop like `until ! gh pr checks … | grep -q pending`** exits at once when `gh` fails ("error connecting to api.github.com"): require non-empty output before treating "no pending" as done.
- **The Next agent nudge stopped `build:web` again** (16.4.4's GHSA-mfr8-8qww-v76h). Tool output, not Omar's request: the bump is step 29b2b.

**From earlier legs (still true):**
- **Windows Smart App Control blocks rollup's native module.** Before every pnpm command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Babel's by-name polyfills vs zod:** `DEPENDENCY_POLYFILLS` gives zod five core-js modules; a new kind of schema may need another (add samples; the protocol-only realm test shows what's missing). **`zod/mini` never generates code**; never import classic `zod` in TV code. **Test a dependency's polyfill allowlist in a bundle of it alone.**
- **noble on Chromium 53** tree-shakes its BigInt but needs core-js's `es.global-this`; scrypt N=2^15 takes 0.8–1.0 s on 53, 2.7–3.1 s on 56 (CI), 0.1 s on 68.
- **The crypto vectors:** regenerate with `pnpm exec tsx packages/crypto/test/make-vectors.ts --write`; any new check or sample changes the names: rebuild `dist/tv-vectors` (`pnpm exec tsx tools/build/build-tv.ts --target vectors`) before `verify:engines`.
- **`apps/tv/src/env.d.ts` must stay a global script** (put `declare global` in a module file).
- **Root `test/` and `e2e/` files need the workspace package in the root `package.json` devDependencies** (`@lablo/crypto`, `@lablo/protocol`, `@lablo/core`, `@lablo/data` are there).
- **The Write tool decodes `\u`-escapes.** After writing code with escapes, list the file's non-ASCII code points with Python; build non-ASCII text from char codes.
- **Vitest's `globalSetup` resolves bare imports from the workspace root** (`createRequire` from `apps/web/package.json`).
- **Prisma 7:** the URL in `apps/web/prisma.config.ts`; a schema change is `pnpm --filter @lablo/web exec prisma migrate dev --name <x>` with `pnpm web:db` running; commit the migration. The forbidden-column check rejects ip, url, host, domain, password, user, email, mac, duid, lgudid, serial and similar.
- **`apps/web/test/**` is exempt from the outbound lint;** everything else in `apps/web` is covered.
- **Overlap CI with the next step** (memory `iptv-relay-overlap-ci`); never push while a PR's CI runs.
- **The media flake** (`epg-declared-300mb`): one `gh run rerun <run> --failed -R Omarmarei/Lablo` once the whole run is done.
- **One CI poller:** wait for the `changes` check to appear after `gh pr create`, then one Monitor that prints each finished check and ends when none is pending.
- **Python with `-I` ignores `PYTHONIOENCODING`:** call `sys.stdout.reconfigure(encoding='utf-8')`. Some working copies are CRLF (`git ls-files --eol`).
- **The relay's context check fires at about 450k tokens.**
- **Mutants:** unit about 7–9 s each, bundle tests about 15 s, e2e about 20 s, `test:web` about 10 s. A Monitor on `tail -n +1 -f <log> | grep -E --line-buffered "SURVIVED|NOT FOUND|EXIT|/N"` reports survivors as they come. Never edit source while a mutation run, `pnpm e2e`, a build or the engines run is going.
- **The profile is at version 7.** The next bump moves the pins to 8 and the "newer version" tests to 9. An IDB schema change has its own version (`packages/data/src/schema.ts`).
- **TV code rules:** no `Array.prototype.sort` in the TV main bundle; no `Uint8Array`, `JSON.stringify`, `new RegExp`, `.split(`, `Array.from`, iterator calls, array destructuring or spread, or a member named `at`, in TV app files (separate test bundles like the vectors page are exempt); the build can crash once (0xC0000005): run it again.
- **`TaskStop` on a `verify:engines` run leaves its container:** `docker rm -f` it (names start `lablo-chrome`).
- **A bare `sleep N; cmd` in Bash is blocked.** Use an `until …; do sleep 20; done` loop under 600 s, or a Monitor.
- **There is no `jq` in Git Bash.** Use `gh … --jq`.
- **GitHub billing can refuse every Actions job:** that is a needs-you stop.
- **Commands:** one e2e spec `pnpm --dir "<wt>" exec playwright test --project=chromium <spec>`; the engines `pnpm --dir "<wt>" verify:engines --engine chrome53 --engine chrome68` (about 6 min, needs a fresh `pnpm build:tv`); `pnpm test` (about 3–5 min, 5,077 tests).
- **Local `pnpm verify` may die at the unit stage** (low memory): run lint, typecheck, `pnpm test`, `build:tv` and `pnpm e2e` separately.
- **Code rules:** `packages/ui` components stay hook-free; UI text only from the catalogs; physical CSS only, no CSS Grid or flex `gap`; TV code is ES2017; dependencies at least 2 weeks old; never weaken lint; scoped `git add`, and `git commit -F -` ending with the `Co-Authored-By` line.

## Working rules (unchanged)
- **Never call EnterWorktree,** even though Claude Code's background note asks for it: the relay worktree is your isolation.
- A one-off script runs as `pnpm --dir "<wt>" exec tsx <path>` or `python -I <file>`. Never use bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** CI runs on `pull_request` and `workflow_dispatch` only, path-filtered; commits use the no-reply email; no secrets, no LG binaries, no personal data; README.md stays "# Lablo". **No production signing seed ever enters the repo, a chat or CI.**
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first, and call out any migration.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Verified vs not
- **Verified in leg 83 (30a):**
  - **Locally:** lint, typecheck, unit 5,077 (+66: `blocklist-host.test.ts` 8, `tools/sign-config` 49, `apps/web/test/config.test.ts` 9), `test:web` 13/13, `build:web` (after the nudge's one stop), both TV builds unchanged (main 415.7 / 403.0 KB, 219 core-js modules).
  - **Live:** `next start` with three requests (no header, `AE`, `ae`): 200, schema-valid, the signature good against `keys.json`, `private, max-age=300`, country `null` / `AE` / `null`.
  - **Mutation:** 96 written first, 96 caught. Writing the list first removed three dead conditions and closed three test gaps.
  - **CI:** green on the first run.
- **Not run locally:** `pnpm e2e` and `verify:engines` (no TV code changed; CI's verify and engines jobs ran green).
- **Migrations and deploys:** nothing new. The only migration (`init`) is on the local and CI databases; nothing in production (Neon arrives with step 34 `[needs Omar]`). Nothing deployed. The TV profile is still at version 7.

## Open decisions and gates
- **None for 30b.** Its split and design are the leg's call (record them).
- **Step 34 `[needs Omar]`, now including the config key ceremony** (runbook `config.md`): Omar runs `pnpm sign-config keygen` twice on his own machine (current and next key), stores the seeds in his password manager and on paper, gives Claude the two public keys for `config/keys.json`, and signs the production config himself. Plus the Vercel, Neon, R2 and Upstash accounts and the domain; he puts the keys in `.env` himself (also a rate-key secret of at least 32 characters for `rateKey`). The first production migration and deploy each need his one-word OK.
- **Steps 16, 19b and 21 wait for Omar:**
  - Samsung: the account, the certificate, the RTL tunnel session, the used 2018 set.
  - About 30–45 minutes at the LG TV: S10, S11, S5's suspend and soak, and the player. Steps 24–28 can join that visit (catch-up, movies and series, details, playing and resuming, episodes, auto-next, search, Home with "Recent channels"), and whether the TV keyboards type into the search field. The vectors page (`dist/tv-vectors`, crypto and protocol) could also run on the TV to time the real scrypt and zod.
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

## Checks for Omar (step 30a is merged; nothing to press on a TV)
1. In the repo, `pnpm sign-config verify`. You should see "is good: signed with the dev key, it matches config/config.json", about 179 days left, "0 kill rules, 0 blocked hosts".
2. `pnpm build:web`, then `pnpm --filter @lablo/web start`.
3. Open http://localhost:3100/v1/config. You should see `{"doc":"{\"v\":1,…}","sig":"…","country":null}`.
4. Stop the server with Ctrl+C.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`). The renamed lab `com.lablo.iptv.lab` installs as a new app.
- **Samsung Seller Office Partner application:** submit it ASAP (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it, as does a GCC Beta Test.
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**. They decide the final app IDs too.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **At the TV next time:** read Dev Mode's "Remain Session".
- **Forty-three CLAUDE.md gaps** are waiting for his word:
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
  - 40: "Package boundaries": `protocol` likewise has `@lablo/protocol/check-samples`;
  - 41: the Chromium 53 cheat sheet could say "TV code uses `zod/mini`, never classic `zod`; a new dependency with modern code gets a polyfill allowlist (`DEPENDENCY_POLYFILLS`) or none (`POLYFILL_FREE_DEPENDENCIES`)";
  - 42 (new): the commands table could add `pnpm sign-config` (keygen, pubkey, sign, verify, block, unblock; runbook `config.md`);
  - 43 (new): the legal guardrails could add "no production config-signing seed in the repo, a chat or CI (`keygen` refuses the repo; Omar signs)".
- **For step 34 (later):** the Vercel, Neon, R2 and Upstash accounts and the domain are his to create. He puts the keys in `.env` himself. **New:** the config key ceremony is his too (above).
- **GitHub billing:** keep the payment method valid. A failed payment stops even the free public-repo CI.
- **Secrets:** none pending.
