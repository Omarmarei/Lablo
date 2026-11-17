# Runbook: the backend (`apps/web`)

The backend is a Next.js app (App Router, route handlers on Vercel) over Postgres through Prisma
(docs/architecture.md §3). Until RELAY step 34 it runs **only on this machine and in CI**: there is
no production database and no deploy yet.

What it will serve (architecture.md §3.2): the signed config (step 30), the pairing relay and the
phone page `/p` (step 31), the encrypted backup (step 32), telemetry and diagnostics (step 33).
What it serves now: `GET /v1/health` (step 29a) and `GET /v1/config` (step 30a: the committed signed
config and the caller's country; see [config.md](config.md)). What it has ready for the later steps
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
| `pnpm verify:web` | `test:web`, then `build:web`. CI's `web` job runs the same. |

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

`eslint.config.js`'s `NO_OUTBOUND_RULES`, for every file in `apps/web` except its tests:

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
  URLs point at `http://127.0.0.1:3100/dev/blob/<key>` (no such route exists yet) and carry an
  HMAC under a secret made at start; `redeem(method, url, body?)` answers them as R2 would (403
  for a changed, expired or other-method URL, 400 for a PUT of another length, 404 for no object).
- **`RateLimiter`:** `limit(key, {limit, windowMs})` gives `{ok: true, remaining}` or
  `{ok: false, retryAfterMs}`; `retryAfterSeconds` makes the `Retry-After` header.
  `MemoryRateLimiter` keeps an exact sliding-window log in memory.
- **IP addresses:** a route limits on `rateKey(scope, ip, secret)`, an HMAC of the address under
  a server secret (at least 32 characters; from the environment in step 34), so neither the
  database nor the limiter's store ever holds an IP (architecture.md §3.2, "Retention").

The routes will check every body against `@lablo/protocol`'s schemas (zod), the same ones the TV
and the phone page use. When the first route imports a workspace package (step 30), add it to
`apps/web`'s dependencies and to `transpilePackages` in `next.config.ts`.

## CI

The `web` job runs when a pull request changes `apps/web/`, `packages/protocol/`,
`packages/crypto/`, `config/` (the signed config is bundled into `/v1/config`),
`vitest.web.config.ts`, or a shared file (`package.json`, the lockfile, the
workspace file, the workflows). It starts a `postgres:17-alpine` service on port 54329, runs
`pnpm test:web` and then `pnpm build:web`. Lint, typecheck and the unit tests run in `verify`.

## Gotchas

- **`next build` stops once when an AI agent runs it** (Next 16's upgrade nudge) while the installed
  Next.js has a known advisory, and asks to run `next upgrade`. Running the same command again
  within 5 minutes continues. It never stops in CI (no agent, no terminal). Step 29a pinned
  `next@16.4.4`: the advisory then (GHSA-mfr8-8qww-v76h, moderate: `'use cache'` through
  `unstable_cache()`) doesn't touch this app, and the fixed 16.4.5 was a day short of the
  two-week rule. Step 29b2b moves to the newest two-week-old patch.
- **Vitest loads a global setup's bare imports from the workspace root**, which doesn't have
  `apps/web`'s dependencies: `global-setup.web.ts` loads `pg` with `createRequire` from
  `apps/web/package.json`. Test files resolve normally.
- **Next's telemetry:** CI sets `NEXT_TELEMETRY_DISABLED=1`. Locally, `pnpm --filter @lablo/web exec next telemetry disable` once.
- `next build` writes `apps/web/next-env.d.ts` and `.next/` (both gitignored, and ignored by lint).
- **Stopping a background `pnpm --filter @lablo/web start` (TaskStop) leaves `next start` running**
  on Windows (leg 83): port 3100 still answers. Find it (`netstat -ano | grep ":3100 "`, then the
  process's command line) and stop that pid.
