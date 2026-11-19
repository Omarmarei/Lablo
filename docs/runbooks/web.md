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
| `pnpm e2e:web` | Against `next start` on port 3101 and a fresh `lablo_e2e` database (`playwright.web.config.ts`): the phone page in a phone-sized Chromium (`apps/web/e2e/`, project `phone`), and the TV's pairing screen in its dev app on port 5393 (`e2e/pairing-api.spec.ts`, project `tv`, step 31c3). Needs `pnpm build:web` first and `pnpm web:db` up. |
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
still holds there). It calls only relative `/v1/pair/` paths, plus the encrypted file's `PUT` to the
presigned URL they answer (step 31d1: only one `presignedUrlSchema` takes, a `/dev/blob/` path on the
same origin until R2), and the page's content security policy (`connect-src 'self'`) holds the
browser to its own origin.
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
  URLs are paths on the API's own origin, `/dev/blob/<key>?m=…&n=…&e=…&s=…` (step 31d1:
  `DEV_BLOB_PATH`; the phone page and the TV resolve them against the address they reach the API
  at), and carry an HMAC under a secret made at start; `redeem(method, url, body?)` answers them
  as R2 would (403 for a changed, expired or other-method URL, 400 for a PUT of another length,
  404 for no object), and the development route `/dev/blob/[...key]` serves them (below, "The M3U
  file"). `keys()` lists what it holds (tests). The routes get one per process from `services()`
  (step 31a).
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
  - (`LABLO_DEV_BLOB_URL` is gone since step 31d1: the memory store's URLs are paths on the
    API's own origin, so nothing needs setting for a phone on the LAN.)
  - On Vercel (`VERCEL` set) the routes answer 503 until step 34 adds the R2 and Upstash adapters:
    the memory fakes never run there.
- **Try it:** `pnpm web:db`, then `pnpm --filter @lablo/web exec prisma migrate deploy` (the
  `pair_progress` migration), `pnpm build:web` and `pnpm --filter @lablo/web start`; a scripted
  TV and phone (`@lablo/crypto`'s `newBoxKeyPair`, `sealPairPayload`, `openPairPayload`) can then
  pair over HTTP on port 3100. `pnpm test:web` runs `apps/web/test/pair.web.test.ts`, including the
  "only ciphertext" check over every row and blob.

## The M3U file (step 31d1)

A phone can send an M3U file instead of a link (architecture.md §3.3 A, step 4, and "Built in step
31d1"). The page encrypts it and uploads it straight to the blob store; the API only signs URLs.

- **On the phone** (`src/phone/flows.ts`): the file is read one 1 MiB frame at a time
  (`File.slice`), each frame sealed with `secretbox` under a fresh `fileKey` and nonce base
  (`@lablo/crypto`'s `sealFileFrame`), the frames joined into one `Blob`; then `POST
  /v1/pair/:code/upload-url {size}` (the encrypted length), the `PUT` to the URL it answers, and
  the payload, whose source `{type: "m3u-file", file: {key, fileKey, base, size}}` is sealed to the
  TV's key with the rest. The form takes files from 1 byte to 41,942,400 bytes (40 frames and
  their tags make the 40 MiB the upload allows); a file left unnamed names the source after itself
  (`Living room.m3u` → "Living room").
- **The URLs:** R2's own (https) in production, from step 34; in development and tests, paths on
  the API's origin (`/dev/blob/...`), which the upload and file answers' schema takes as exactly
  that shape (no other host, no dots, nothing escaped). The page's `connect-src 'self'` covers them;
  **step 34 adds R2's host to it**, and the R2 bucket needs a CORS rule allowing a `PUT` from the
  page's origin and a `GET` from any.
- **The development route** `src/app/dev/blob/[...key]/route.ts` (the work in
  `src/server/dev-blob.ts`): `PUT` (the body read with a cap of the URL's own size) and `GET`
  (`application/octet-stream`, `access-control-allow-origin: *`: the TV is another origin), both
  through `MemoryBlobStore.redeem`, every answer `no-store`. It answers 404 on Vercel (`VERCEL`
  set) and whenever the services' store isn't the memory one.
- **On the TV** (step 31d2a, architecture.md "Built in step 31d2a"): the pair worker asks
  `GET /v1/pair/s/:sid/file` with its poll token, resolves a relative URL against the API base it
  pairs with, downloads the file with no token (headers within 10 s; exactly the encrypted length)
  and opens it one frame at a time; the ingest worker reads the plain frames from a
  `MessageChannel` port and parses them as an M3U link's body. A frame that doesn't open fails
  the add with the ingest's `file` code. The pairing screen adds it as a source with no link
  (step 31d2b1, architecture.md "Built in step 31d2b1"): Settings › Sources shows it as
  "M3U file", the schedule never refreshes it, and the same file sent again under the same name
  replaces it in place. A file that fails says why on the TV ("The file from your phone couldn't
  be read. Send it again.") and sends the phone `unreachable`; the screen then offers only
  "Show a new code" (the status deleted the blob). Proven end to end against the stand-in in
  `e2e/pairing.spec.ts` and on Chromium 53 and 68 in the old-engine pairing walk (step 31d2b2a,
  architecture.md "Built in step 31d2b2a"), and through the real API in the `tv` project
  (step 31d2b2b, below). The phone page words `unreachable` after a file as "Your TV couldn't
  read the file…" (`done.unreachableFile`): the TV sends `unreachable` for every failure of a
  file but a refusal.
- **Try it:** as "The phone page" below; choose "M3U playlist file" and any `.m3u`. A scripted TV
  then reads the file's URL from `GET /v1/pair/s/:sid/file`, downloads it and opens it with the
  payload's `fileKey` and `base` (`openFile`); `apps/web/e2e/phone-file.spec.ts` does exactly that.

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
  `phone-file.spec.ts` (step 31d1) sends a file of three frames and opens what the store holds.

## The TV's pairing against the API (step 31c3)

`pnpm e2e:web`'s second project, `tv` (`e2e/pairing-api.spec.ts`): the TV's pairing screen in its
dev app against this server, end to end except for the phone, which is scripted
(`tools/engines/src/pair-phone.ts`: the typed-code path, the payload sealed in Node).

- **What runs:** `playwright.web.config.ts` starts two web servers: `next start` on 127.0.0.1:3101
  (as for the phone page) and the TV's Vite dev app on `localhost:5393`
  (`LABLO_WEB_E2E_TV_PORT`). The spec starts the mock provider in its own process, and a **test
  front** (`e2e/api-front.ts`) for each test.
- **The test front:** a pass-through on `127.0.0.1:<port>` before `next start`, given to the TV as
  `?api=`. Every request goes on unchanged (method, path, body, headers; only the connection
  headers and `host` are dropped), and its answer comes back as it is, so the TV meets the real
  routes' CORS headers and preflights (the dev app is another origin, like a TV build). It adds the
  test's own `x-forwarded-for`, so each test has its own rate limits; the scripted phone goes
  through it too. `GET /v1/config` goes on to the real route (the committed
  `config/config.signed.json`) unless the test serves its own (`serve(devSignedAnswer(doc(…)))`):
  the route bundles the committed file at build time, so a blocklist or a refusal mode can't come
  from the server itself. The front is test code: the product's servers never relay anything.
- **A served config goes in before the TV's first request:** the real route's answer may be kept
  5 minutes (`cache-control: private, max-age=300`), so a refresh after it reads the browser's copy
  and never reaches the front.
- **The cases:** onboarding by phone with an Xtream login (the phone reads `open`, `received`
  while the mock's API is held, then `ok`); Settings › Sources by phone in Arabic with an M3U link
  and a guide link (`ok`); one screen, a new code each time: a wrong password (`auth_failed`), the
  mock's `expired` account (`expired`), a closed port (`unreachable`); a served blocklist holding
  the mock's host (`blocked`, in Arabic); a served `block-new-sources` (`blocked`); an M3U file of
  three frames in onboarding (step 31d2b2b: the phone's PUT and the TV's GET of the blob through
  the front, the row holding the file's id while the TV's download is held, the blob 404 after
  the status), then a changed file under the same name from Settings replacing the source under
  its id. Each checks the session's row in `lablo_e2e` (the status, no payload or file id left,
  the read time set), the profile the TV kept, and that every preflight got the API's 204.
  Screenshots: `artifacts/screenshots/pair-api-*.png`.
- **Holding a request:** `front.hold({method, prefix, until})` keeps matching requests back until
  `until` settles (`null` stops holding), to look at a state they would end. Keep a hold short: the
  TV gives a file's headers 10 s.
- **Only this spec:** `pnpm build:web`, `pnpm web:db`, then `pnpm e2e:web --project tv` (about
  25 s). `pnpm e2e` doesn't list it (it needs the database).

## The "no plaintext" run (step 31e)

`e2e/no-plaintext.spec.ts`, in the same `tv` project: the proof that the web app never sees a
source in the clear (architecture.md "Built in step 31e").

- **What runs:** as above, plus the real phone page in a browser context of its own at a phone's
  size, opened at `<front>/p`; it types the code the TV shows. Three tests: an Xtream login, an M3U
  link with a guide link (Arabic), an M3U file of three frames.
- **What is searched:** `front.received` (each request's line, headers and whole body: the uploads'
  bodies are the blobs) and every row of every table in `lablo_e2e` (read while the front holds the
  TV's reads, so the payload is still in its row, and at the end), with `leaks` from
  `e2e/no-plaintext.ts`: each secret as text, JSON-escaped, percent-encoded and inside base64.
- **When it fails,** the message names the request (`POST /v1/pair/<code>/payload: its body`) or
  "the rows", and lists the secrets found. Look at what the phone page sends first: the server never
  has a plaintext to write.
- **Only this spec:** `pnpm build:web`, `pnpm web:db`, then
  `pnpm e2e:web --project=tv no-plaintext` (about 15 s).

## The backup (step 32a)

Where a TV keeps its encrypted profile (architecture.md §3.3 B and "Built in step 32a"). The work
is in `apps/web/src/server/backup.ts`; `src/app/v1/backup/[lookupId]/route.ts` is a thin wrapper.

| Call | Needs | Answers |
|---|---|---|
| `PUT /v1/backup/:lookupId` `{v, kdf, nonce, ct}` (at most 512 KB) | `X-Write-Token` | `{state: "stored"}` |
| `GET /v1/backup/:lookupId` | nothing more | the envelope as it was put, or 404 |
| `DELETE /v1/backup/:lookupId` | `X-Write-Token` | `{state: "deleted"}`, or 404 |

- **What the server holds:** the envelope in the blob store at `backup/<lookupId>`, and a `Backup`
  row with the lookup ID, the write token's SHA-256, the size and two dates. It can't open an
  envelope: the key is derived on the TV from its device secret and never leaves it.
- **The write token:** the first put claims the lookup ID for its token; every later put and every
  delete needs the same one (401 otherwise, and the stored envelope stays as it was).
- **Reading** needs only the lookup ID (a 256-bit secret from the TV's master key) and only the
  blob store, so a restore still answers while Postgres is down.
- **The refusals:** 404 a lookup ID that isn't 32 bytes of base64url (and a get or delete of
  nothing); 401 no token, a malformed one or another's; 400 a body that is no envelope; 413 over
  512 KB; 429 past 30 writes or 30 reads in 10 minutes from one address (`Retry-After`); 503 when
  the database or the store fails (only the error's kind is logged).
- **Retention:** each put sweeps at most 20 backups nobody updated for 180 days, the oldest first.
- **Every answer** carries `access-control-allow-origin: *` and `cache-control: no-store`; the
  preflight allows `content-type, x-write-token`.
- **Tests:** `pnpm test:web` (`apps/web/test/backup.web.test.ts`, 27 tests against Postgres);
  `pnpm e2e:web --project=phone backup` (one test over HTTP against `next start`, about 5 s).
- **By hand** (after `pnpm web:dev`): `curl -i http://localhost:3100/v1/backup/x` answers 404
  `{"error":"not_found"}` with the CORS header.
- **No migration:** the `Backup` table is step 29a's. Nothing here is in production before step 34.

## Telemetry (step 33a)

Where a TV sends its batches of events (architecture.md §3.4 and "Built in step 33a"). The work
is in `apps/web/src/server/telemetry.ts`; `src/app/v1/telemetry/route.ts` is a thin wrapper.

| Call | Body | Answers |
|---|---|---|
| `POST /v1/telemetry` | `{installId, platform, appVersion, events}`, 1 to 200 events, at most 64 KB | `{state: "stored", stored, dropped}` |

- **What the server keeps:** one `TelemetryEvent` row per event it can read: the install ID, the
  kind, the platform, the app version, the event's other fields (`data`), when it happened (`at`)
  and when it came (`receivedAt`, the server's clock). An event it can't read (a newer app's, or a
  broken one) is dropped and counted; fields it doesn't know are stripped. Nothing else: no
  address, no header, no body.
- **A crash's stack is scrubbed again** (`@lablo/protocol`'s `scrubText`, the rules without the
  user's logins, which only the TV knows): URLs become `[url]` except the app's own frames
  (`main.js:1:2345`, `worker:1:2`), `password=` and the like `[x]`, Xtream paths lose their login,
  e-mails `[email]`, IP addresses `[ip]`, hosts `[host]`.
- **The refusals:** 400 a body that isn't JSON or a batch; 413 over 64 KB; 429 past 60 posts in 10
  minutes from one address (`Retry-After`); 503 when the database fails (only the error's kind is
  logged).
- **Retention:** each post first sweeps at most 1,000 events received 90 days ago or more, the
  oldest first.
- **Every answer** carries `access-control-allow-origin: *` and `cache-control: no-store`; the
  preflight allows `content-type`.
- **Tests:** `pnpm test:web` (`apps/web/test/telemetry.web.test.ts`, 10 tests against Postgres);
  `pnpm e2e:web --project=phone telemetry` (one test over HTTP against `next start`, under 1 s);
  `pnpm test` runs the scrubber's own tests (`packages/protocol/src/scrub.test.ts`) and its bundle
  in the Chromium 53 stand-in realm (`test/scrub-bundle.test.ts`).
- **Reading it:** saved SQL to start with (§3.4), e.g. `SELECT kind, count(*) FROM "TelemetryEvent"
  WHERE "receivedAt" > now() - interval '1 day' GROUP BY kind`.
- **No migration:** the `TelemetryEvent` table is step 29a's. Nothing here is in production
  before step 34.

### What the TV sends (steps 33b1, 33b2, 33b3 and 33c)

architecture.md §3.4 "Built in step 33b1" has the design; this is how to see it work.

- **When:** from the live screen on, 60 s after the first event not yet sent, at most every 15
  minutes, and once when the app is hidden. Onboarding sends nothing (what it recorded goes after).
  The config's `disable-app` stops it.
- **What:** `app_start` and `capability` at each start; `capability` goes once per app version,
  model, firmware and probe set. Step 33b2 adds:
  - `ingest_done` after each catalog or guide download (none for a 304 or a failure);
  - `epg_match` after a guide refresh that changed the match;
  - `play_result` once per play (its first frame, or its give-up);
  - `stall` at the end of each "Reconnecting…".

  To see them in the dev app: add a playlist with a guide, play a channel, then
  `await window.__LABLO_TEST__.sendTelemetry()`; the stand-in or the network panel shows the
  batch.
- **Crashes (step 33c):** main's uncaught errors and unhandled rejections, and each data worker's
  uncaught error, as `crash` events: at most 3 a session, each once. Main holds the raw text until
  the next send; the telemetry worker scrubs it with the profile's own logins, links and hosts
  before it is queued, so the queue never holds a raw stack. To see one in the dev app:
  `setTimeout(() => { throw new Error('test http://example.com/x?password=secret') })` in the
  console, then `await window.__LABLO_TEST__.sendTelemetry()`: the batch holds
  `Uncaught Error: test [url]` with its frames.
- **Where it waits:** the TV's IndexedDB, store `kv`: `telemetry.id` (the install ID),
  `telemetry.queue` (at most 200 events not yet stored), `telemetry.capability` (the last one
  queued). The profile's `telemetry: false` deletes all three at the next send, and nothing is
  posted.
- **The switch (step 33b3):** Settings' fourth row, "Usage and crash reports": OK switches it in
  place. Off stores `telemetry: false` and sends once at once, so the three records above are gone
  before the row takes OK again; on again makes a new install ID at the next send. The consent
  screen says so in a note under its buttons. To check it by hand in the dev app: switch it off,
  then `await window.__LABLO_TEST__.sendTelemetry()` answers `{state: "off"}` and the `kv` store
  holds no `telemetry.*` key.
- **The dev app** posts as `platform: "browser"`, which this route refuses (400): the TV drops
  such a batch, so dev rows never land in the table. Plain `pnpm e2e` checks the batches against
  the stand-in on the config server (`e2e/telemetry.spec.ts`).
- **By hand in the dev app:** `await window.__LABLO_TEST__.sendTelemetry()` in the console sends
  now and answers `{state: "sent", sent, queued}` (or `failed`, `refused`, `empty`, `off`).
- **The worker:** `telemetry.worker.js`, 76 KB of its 150 KB budget (the scrubber included, step
  33c), started for each send.
  `test/telemetry-worker-bundle.test.ts` runs the bundle in the Chromium 53 stand-in realm and
  reads its post with this route's schema.

## Diagnostics reports (step 33d1)

Where a TV sends the report the user asks for in Settings ("Send a report to support", step
33d2), and gets the code the user gives to support (architecture.md §3.4 and "Built in step
33d1"). The work is in `apps/web/src/server/diag.ts`; `src/app/v1/diag/route.ts` is a thin wrapper.

| Call | Body | Answers |
|---|---|---|
| `POST /v1/diag` | `{platform, appVersion, report}`, at most 32 KB | 201 `{code}`: 6 characters of Crockford's base32 (no I, L, O, U) |

- **The report** (`@lablo/protocol`'s `diagReportSchema`): the TV's clock and UTC offset, its
  language, the device as telemetry's `capability` names it (tier, model, firmware, Chromium,
  probes), telemetry's switch, where the config came from (`fresh`, `cached`, `none`), up to 10
  sources (type, item bucket, time since checked, a missing login or link), up to 10 guides
  (programme bucket, match share, time since checked, the last failure's code and status) and up
  to 10 of the session's plays, stalls and crashes, as telemetry's events. **No ID at all:** a
  report can't be tied to telemetry rows or to the same TV's other reports.
- **What the server keeps:** one `DiagReport` row: the code, the platform, the app version, the
  report as the schema read it (unknown fields stripped), and `createdAt` (the server's clock;
  against the report's `at`, how far off the TV's clock is). Each crash's stack is scrubbed again,
  as telemetry's. Nothing else: no address, no header.
- **The code:** each of its 6 characters is one random byte's low 5 bits (30 bits). A code another
  report holds is made again, up to 5 tries, then 503.
- **The refusals:** 400 a body that isn't JSON or a report; 413 over 32 KB; 429 past 5 reports an
  hour from one address (`Retry-After`); 503 when the database fails or no free code was found
  (only the error's kind is logged).
- **Retention:** each post first sweeps at most 1,000 reports received 30 days ago or more, the
  oldest first. Support needs a report only while its ticket is open.
- **No route reads a report back,** so a guessed code shows nothing. Support reads it in the
  database: `SELECT "createdAt", platform, "appVersion", report FROM "DiagReport" WHERE code = 'K7M2Q9'`.
- **Every answer** carries `access-control-allow-origin: *` and `cache-control: no-store`; the
  preflight allows `content-type`.
- **Tests:** `pnpm test:web` (`apps/web/test/diag.web.test.ts`, 11 tests against Postgres);
  `pnpm e2e:web --project=phone diag` (one test over HTTP against `next start`); `pnpm test` runs
  the schema's (`packages/protocol/src/diag.test.ts`).
- **The migration** `diag_report_no_install` drops step 29a's `DiagReport.installId`. Nothing
  here is in production before step 34.

## The wipe restored from the real API (step 32d1)

`e2e/backup-api.spec.ts`, in the `tv` project: step 32's "Done when" against `next start`
(architecture.md §3.3 B "Built in step 32d1").

- **What runs:** the TV's dev app with a test device ID (`?device=e2e-api-32d1-<en|ar>`) and the
  test front as its `?api=`, the mock provider. Two tests: English (an Xtream login, then two
  favourites, a movie's place and a show's episode written into the stored profile from the gallery
  page) and Arabic (an M3U link, its guide link and an Arabic name).
- **What it checks:** the look-up's `GET 404`; the upload's `GET 404, PUT 200` (and a preflight);
  the envelope opened in Node (`deriveBackupMaster(<device>, 'browser', <the webOS app id>)`) equal
  to the stored document, its ciphertext no gzip stream, another device's key refused; the `Backup`
  row (`writeTokenHash`, `size`) and the blob (read straight from the API, as a caller of its own,
  so the front's log holds only the TV's requests); `leaks` over every request, row and the blob;
  then the wipe, "Welcome back" with the document back as the envelope held it, the live screen
  with no key, and `GET 200`.
- **Screenshots:** `artifacts/screenshots/backup-api-{welcome,live}-{en,ar}.png`.
- **Only this spec:** `pnpm build:web`, `pnpm web:db`, then
  `pnpm e2e:web --project=tv backup-api` (about 20 s).

## CI

The `web` job runs when a pull request changes `apps/web/`, `packages/protocol/`,
`packages/crypto/`, `config/` (the signed config is bundled into `/v1/config`),
`vitest.web.config.ts`, `playwright.web.config.ts`, or a shared file (`package.json`, the
lockfile, the workspace file, the workflows); since step 31c3 also the TV app, the packages'
sources, the mock provider, and the TV pairing spec's own files (`e2e/pairing-api.spec.ts` and
the helpers it imports, `tools/engines/src/pair-phone.ts` and the harness's config). It starts a
`postgres:17-alpine` service on port 54329, runs `pnpm test:web` and `pnpm build:web`, installs
Chromium and runs `pnpm e2e:web` (the phone page and the TV's pairing), and uploads both
projects' screenshots (`phone-screenshots`: `phone-*.png`, `pair-api-*.png`). Lint, typecheck and
the unit tests run in `verify`.

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
