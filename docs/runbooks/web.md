# Runbook: the backend (`apps/web`)

The backend is a Next.js app (App Router, route handlers on Vercel) over Postgres through Prisma
(docs/architecture.md §3). Until RELAY step 34 it runs **only on this machine and in CI**: there is
no production database and no deploy yet.

What it will serve (architecture.md §3.2): the signed config (step 30), the pairing relay and the
phone page `/p` (step 31), the encrypted backup (step 32), telemetry and diagnostics (step 33).
What it serves now: `GET /v1/health` (step 29a), `GET /v1/config` (step 30a: the committed signed
config and the caller's country; see [config.md](config.md)) and the pairing API's eight routes
(step 31a, "Pairing" below) and the phone page `/p` (step 31b, "The phone page" below; the TV's
screen comes with 31c). What it has ready for the later steps
(step 29b2a): the messages' schemas in `@lablo/protocol`, and the blob store and rate limiter
interfaces with their in-memory fakes (below). It imports `@lablo/protocol` and `@lablo/crypto`
(workspace dependencies, compiled by Next through `transpilePackages`).

**It never fetches a user-supplied URL and never relays a stream** (ADR-005). The lint enforces it:
see "No outbound network" below.

## Commands

| Command | What it does |
|---|---|
| `pnpm web:db` | Starts the local Postgres 17 in Docker (`apps/web/docker-compose.yml`) on `127.0.0.1:54329` and waits until it is ready. The data stays in the `lablo-web_postgres` volume. Needs Docker Desktop running. |
| `pnpm web:db:down` | Stops it (the volume stays; `docker compose -f apps/web/docker-compose.yml down -v` deletes the data too). |
| `pnpm web:dev` | `next dev` on http://localhost:3100. |
| `pnpm build:web` | `next build` (Turbopack). |
| `pnpm --filter @lablo/web start` | `next start` on port 3100, after a build. |
| `pnpm test:web` | The tests that need the database (`apps/web/test/*.web.test.ts`, `vitest.web.config.ts`). Each run drops, creates and migrates `lablo_test` first, so it never touches the development database `lablo`. |
| `pnpm e2e:web` | The phone page in a phone-sized Chromium (`playwright.web.config.ts`, `apps/web/e2e/`) against `next start` on port 3101 and a fresh `lablo_e2e` database. Needs `pnpm build:web` first and `pnpm web:db` up. |
| `pnpm verify:web` | `test:web`, `build:web`, then `e2e:web`. CI's `web` job runs the same. |

`pnpm lint`, `pnpm typecheck` and `pnpm test` cover `apps/web` too (its unit tests need no
database: `apps/web/test/*.test.ts`, and `test/lint-web-outbound.test.ts`).

## First time on a machine

1. `pnpm install`. The app's postinstall runs `prisma generate` into `apps/web/src/generated/prisma`
   (gitignored). Run `pnpm --filter @lablo/web exec prisma generate` by hand after a schema change.
2. `pnpm web:db`.
3. Copy `apps/web/.env.example` to `apps/web/.env` (gitignored). It holds only
   `DATABASE_URL=postgresql://lablo@127.0.0.1:54329/lablo`.
4. `pnpm --filter @lablo/web exec prisma migrate deploy` (the development database), then
   `pnpm web:dev` and open http://localhost:3100/v1/health: `{"ok":true,"db":"up"}`.

**No password exists anywhere.** The local Postgres listens on 127.0.0.1 only and trusts its
connections (`POSTGRES_HOST_AUTH_METHOD: trust`), and CI's service container does the same. The repo
is public and holds no credentials (CLAUDE.md "Legal guardrails"). Production's URL (Neon, step 34)
will live only in Vercel's settings and in a gitignored `.env`, which Omar fills in himself.

## The database

- **Prisma 7.** The client is Rust-free: the `prisma-client` generator writes TypeScript, a wasm
  query compiler runs the queries, and node-postgres connects (`@prisma/adapter-pg`). The CLI's
  schema engine (`schema-engine-windows.exe`, from `@prisma/engines`' postinstall, allowed in
  `pnpm-workspace.yaml`) runs the migrations; it starts under Smart App Control (checked 2026-11-16).
- **`apps/web/prisma.config.ts`** holds the URL (Prisma 7 keeps it out of the schema): the
  environment's `DATABASE_URL`, or else `apps/web/.env`. Without either, `prisma generate` still
  works (no datasource needed).
- **The tables** (`apps/web/prisma/schema.prisma`, architecture.md §3.2–3.4): `PairSession`,
  `Backup` (the metadata; the envelope goes to R2), `TelemetryEvent`, `DiagReport`. Steps 31–33
  change their own table with their own migration.
- **Never a column for an IP address, a URL, a host, a device id or a credential.**
  `database.web.test.ts` splits every column's name into words and rejects those
  (`FORBIDDEN_COLUMN_WORDS` in `apps/web/test/web-db.ts`).
- **A schema change:** edit `schema.prisma`, start `pnpm web:db`, then
  `pnpm --filter @lablo/web exec prisma migrate dev --name <what-changed>`. It writes
  `prisma/migrations/<timestamp>_<name>/migration.sql` and applies it to the development database.
  Commit the migration. `pnpm test:web` fails while the schema and the migrations differ (the drift
  check: `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`).
- **Production migrations** (Neon, from step 34) need Omar's one-word OK each time, and a schema
  query afterwards (RELAY "Definition of done", item 3). Never point `DATABASE_URL` at production
  from this machine without it.

## `GET /v1/health`

`{"ok":true,"db":"up"}` with status 200 when the database answers `SELECT 1` within 2 s
(`HEALTH_TIMEOUT_MS`), else `{"ok":false,"db":"down"}` with 503. Never cached
(`cache-control: no-store`). The answer never says why; the server log gets only the error's kind
(`health: the database is down (ECONNREFUSED)`, or Prisma's `P2010`), because a driver's message
can name the host. A missing `DATABASE_URL` is "down" too.

## No outbound network

`eslint.config.js`'s `NO_OUTBOUND_RULES`, for every file in `apps/web` except its tests and e2e
specs:

- the globals `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` (also as properties of
  `globalThis`, `window`, `self`);
- the modules `http`, `https`, `http2`, `net`, `tls`, `dgram`, `dns`, `child_process` and `module`
  (with or without `node:`), and the HTTP client libraries (`undici`, `node-fetch`, `axios`, `got`,
  `ky`, `ws` and others), in static imports, `export … from` and `import()`, including paths inside
  them;
- CommonJS's `require` and `module`.

The database connection goes through Prisma and node-postgres, which the lint doesn't see (they
are libraries, and the URL is ours). The real R2 and Upstash adapters (step 31 or 34) will need a
narrow exception for their own file, with a test that proves it is that narrow.
**The one exception so far (step 31b):** `apps/web/src/phone/api.ts`, the phone page's requests,
runs in the phone's browser and may call `fetch` (`PHONE_API_RULES`: everything else in the block
still holds there). It calls only relative `/v1/pair/` paths, and the page's content security
policy (`connect-src 'self'`) holds the browser to its own origin.
`test/lint-web-outbound.test.ts` proves each form is rejected in `apps/web` and still allowed in the
TV app, the mock, the tools and the tests.

## The blob store and the rate limiter (step 29b2a)

`apps/web/src/server/blob-store.ts` and `rate-limit.ts` (architecture.md §3.2, "Built in step
29b2a"). Production gets R2 and Upstash adapters in step 31 or 34, each with a narrow, tested
exception in `NO_OUTBOUND_RULES`; until then only the fakes exist.

- **`BlobStore`:** `put`, `get`, `delete`, `presignPut(key, size, ttlMs)` (exactly `size` bytes)
  and `presignGet(key, ttlMs)`, 1 s to 24 h. Large bodies never pass through the backend: the
  phone PUTs the encrypted M3U file to R2 and the TV GETs it from there. Keys are the server's
  own: a lower-case prefix and one to three base64url segments (`pair/<sid>/<id>`).
- **`MemoryBlobStore`:** in memory, so one process only: never in production. Its presigned
  URLs point at `http://127.0.0.1:3100/dev/blob/<key>` (`LABLO_DEV_BLOB_URL` changes it; no
  route answers them before step 31d) and carry an HMAC under a secret made at start;
  `redeem(method, url, body?)` answers them as R2 would (403 for a changed, expired or
  other-method URL, 400 for a PUT of another length, 404 for no object). `keys()` lists what it
  holds (tests). The routes get one per process from `services()` (step 31a).
- **`RateLimiter`:** `limit(key, {limit, windowMs})` gives `{ok: true, remaining}` or
  `{ok: false, retryAfterMs}`; `retryAfterSeconds` makes the `Retry-After` header.
  `MemoryRateLimiter` keeps an exact sliding-window log in memory.
- **IP addresses:** a route limits on `rateKey(scope, ip, secret)`, an HMAC of the address under
  a server secret (at least 32 characters; from the environment in step 34), so neither the
  database nor the limiter's store ever holds an IP (architecture.md §3.2, "Retention").

The routes will check every body against `@lablo/protocol`'s schemas (zod), the same ones the TV
and the phone page use. When the first route imports a workspace package (step 30), add it to
`apps/web`'s dependencies and to `transpilePackages` in `next.config.ts`.

## Pairing (step 31a)

The relay between the phone and the TV (architecture.md §3.2, §3.3 A and "Built in step 31a"). The
work is in `apps/web/src/server/pair.ts`; each route under `src/app/v1/pair/` is a thin wrapper.

| Route | Who | Answers |
|---|---|---|
| `POST /v1/pair` `{tvPk}` | TV | 201 `{sid, code, pollToken, exp}` |
| `GET /v1/pair/:code` | phone (typed code) | `{tvPk, exp}` |
| `POST /v1/pair/:code/upload-url` `{size}` | phone | a presigned PUT `{url, key, exp}`, before the payload |
| `POST /v1/pair/:code/payload` `{phonePk, nonce, ct}` | phone | `{state: "sent"}`, once |
| `GET /v1/pair/:code/status` | phone | `open` (+`exp`), `sent`, `received`, `done` (+`status`) |
| `GET /v1/pair/s/:sid` (Bearer poll token) | TV | `waiting` (+`exp`), then `ready` (+`payload`) once |
| `POST /v1/pair/s/:sid/status` `{status}` (Bearer) | TV | `{state: "done", status}`, once, after the read |
| `GET /v1/pair/s/:sid/file` (Bearer) | TV | a presigned GET `{url, key, exp}`, after the read |

- **Errors** are `{error}` with the status: 400 `bad_request`, 401 `unauthorized` (the poll token),
  404 `not_found` (a code unknown, malformed or past its 10 minutes), 409 `conflict` (already sent,
  read or reported; or too early), 410 `expired` (the TV's poll after the code ended with nothing
  sent), 413 `too_large`, 429 `rate_limited` (with `Retry-After`), 503 `unavailable` (the database
  or the services; the log says only the operation and the error's kind).
- **Kept:** hashes of the code and the token, the TV's public key, the sealed payload until the read,
  the category; the encrypted file in the blob store until the TV reports. Rows go an hour after
  they were made (each `POST /v1/pair` sweeps them). Never a body in a log.
- **Rate limits per address, per 10 minutes:** 20 new codes; 30 code guesses (the key, the upload,
  the payload together); 400 progress reads; 400 TV calls.
- **CORS:** the TV's routes answer any origin and their `OPTIONS` preflight; the phone's don't.
- **Environment** (both optional locally; Omar sets production's in step 34):
  - `LABLO_RATE_SECRET`: the secret the rate limiter hashes addresses under, at least 32
    characters. Without it each process makes a random one (fine for one process).
  - `LABLO_DEV_BLOB_URL`: where the memory blob store's presigned URLs point (default
    `http://127.0.0.1:3100/dev/blob`; a phone on the LAN needs this machine's address). No route
    answers them before step 31d, and the upload answer's schema takes https only (R2's): 31d
    decides how development passes.
  - On Vercel (`VERCEL` set) the routes answer 503 until step 34 adds the R2 and Upstash adapters:
    the memory fakes never run there.
- **Try it:** `pnpm web:db`, then `pnpm --filter @lablo/web exec prisma migrate deploy` (the
  `pair_progress` migration), `pnpm build:web` and `pnpm --filter @lablo/web start`; a scripted
  TV and phone (`@lablo/crypto`'s `newBoxKeyPair`, `sealPairPayload`, `openPairPayload`) can then
  pair over HTTP on port 3100. `pnpm test:web` runs `apps/web/test/pair.web.test.ts`, including the
  "only ciphertext" check over every row and blob.

## The phone page (step 31b)

`/p` is where a phone sends a source to a TV (architecture.md §3.3 A and "Built in step 31b"). The
server component (`src/app/p/page.tsx`) only picks the language; everything else runs in the
browser (`src/phone/`): the code, the forms, the sealing (`sealPairPayload` to the TV's key), the
post and the progress poll.

- **Reaching it:** the TV's QR code opens `https://<domain>/p#c=<code>&k=<tvPk>` (the fragment
  never reaches the server; the page reads it once and takes it out of the address bar), or a
  person opens `/p` and types the code (lower case, spaces, a dash, I/L for 1 and O for 0 are all
  fine). The QR path uses the key from the fragment; the typed path asks `GET /v1/pair/:code`.
- **Language:** `?lang=en|ar`, else `Accept-Language`, else English; the link at the top switches in
  place and keeps what was typed. Its text is `src/phone/catalog.ts` (its own: `apps/web` can't
  import the TV's catalogs), in the TV's terms.
- **Headers in a production build** (`next.config.ts` `pageHeaders`): `Content-Security-Policy`
  (`connect-src 'self'`, `default-src 'self'`, `frame-ancestors 'none'` and the rest),
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`. `next dev` gets none (its
  reloads need eval and a websocket), so check headers against `next start`.
- **Try it on the desktop:** `pnpm web:db`, `pnpm --filter @lablo/web exec prisma migrate deploy`,
  `pnpm build:web`, `pnpm --filter @lablo/web start`, then play the TV with a script (`POST
  /v1/pair` with a `newBoxKeyPair()` public key; `apps/web/e2e/support.ts`'s `Tv` shows the calls)
  and open `http://localhost:3100/p#c=<code>&k=<tvPk>` in a narrow window, or `/p` to type the code.
- **On a real phone** (before step 34): the phone must reach this PC: `next start --hostname
  0.0.0.0` and the PC's LAN address. The page needs a secure context for nothing it uses (it seals
  with tweetnacl, not WebCrypto), so plain http on the LAN works.
- **E2E (`pnpm e2e:web`):** each spec plays the TV over the API from Node and checks the payload it
  opens with its own secret key. Each test sends its own `x-forwarded-for` (Next's own server keeps
  a client's; Vercel's edge sets it), so the rate limits never meet across tests. Every request the
  page makes is checked against its origin. Screenshots: `artifacts/screenshots/phone-*.png`.

## CI

The `web` job runs when a pull request changes `apps/web/`, `packages/protocol/`,
`packages/crypto/`, `config/` (the signed config is bundled into `/v1/config`),
`vitest.web.config.ts`, `playwright.web.config.ts`, or a shared file (`package.json`, the
lockfile, the workspace file, the workflows). It starts a `postgres:17-alpine` service on port
54329, runs `pnpm test:web` and `pnpm build:web`, installs Chromium and runs `pnpm e2e:web`, and
uploads the phone page's screenshots (`phone-screenshots`). Lint, typecheck and the unit tests run
in `verify`.

## Gotchas

- **`next build` stops once when an AI agent runs it** (Next 16's upgrade nudge) while the installed
  Next.js has a known advisory, and asks to run `next upgrade`. Running the same command again
  within 5 minutes continues. It never stops in CI (no agent, no terminal). Step 29a pinned
  `next@16.4.4`, whose advisory (GHSA-mfr8-8qww-v76h, moderate: `'use cache'` through
  `unstable_cache()`) didn't touch this app. **Step 29b2b moved to `next@16.4.5`** (published
  2026-11-03 18:01 UTC, bumped once two weeks old): npm's bulk advisory API lists nothing for it,
  so the nudge no longer fires (checked 2026-11-17: `build:web` went through on the first run),
  and its native SWC binding (`@next/swc-win32-x64-msvc@16.4.5`) loads under Smart App Control.
  **Before the next bump,** ask the advisory API yourself: POST
  `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` with `{"next":["<version>"]}`
  (`{}` means none), and read the version's date from `https://registry.npmjs.org/next` (`time`).
  16.4.6 (2026-11-09 20:33 UTC) is two weeks old from 2026-11-23 20:33 UTC.
- **Vitest loads a global setup's bare imports from the workspace root**, which doesn't have
  `apps/web`'s dependencies: `global-setup.web.ts` loads `pg` with `createRequire` from
  `apps/web/package.json`. Test files resolve normally.
- **Next's telemetry:** CI sets `NEXT_TELEMETRY_DISABLED=1`. Locally, `pnpm --filter @lablo/web exec next telemetry disable` once.
- `next build` writes `apps/web/next-env.d.ts` and `.next/` (both gitignored, and ignored by lint).
- **`next build` type-checks every file `apps/web/tsconfig.json` includes, the e2e specs too:** a
  type error in `apps/web/e2e/` fails the build.
- **A running `next start` locks `.next` on Windows:** `next build` then fails with `EBUSY ...
  rmdir .next/static/chunks`. Stop the server first (and don't leave a shell's working directory
  inside `.next`).
- **`page.goto('/p#…')` from `/p` only changes the fragment** (no new load). The page reloads itself
  on `hashchange` so a second QR link in the same tab still starts over; the specs open a QR link
  after `about:blank` (`openQr`).
- **Next adds its own `role="alert"`** (the route announcer): look for the page's messages inside
  `[data-testid=phone]`.
- **Stopping a background `pnpm --filter @lablo/web start` (TaskStop) leaves `next start` running**
  on Windows (leg 83): port 3100 still answers. Find it (`netstat -ano | grep ":3100 "`, then the
  process's command line) and stop that pid.
