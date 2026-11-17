# Runbook: the signed config

The remote config (architecture.md §3.3 C) is how Lablo changes behaviour without a store review:
kill rules, the minimum app version, the hashed domain blocklist, feature flags and tunables. It is
a JSON doc signed offline with an Ed25519 key; the backend serves it as committed
(`GET /v1/config`), and the TV checks the signature against the public keys it embeds before it
uses anything in it (RELAY step 30b), then enforces it (step 30c).

Built in RELAY step 30a: the files, `pnpm sign-config` (`tools/sign-config`), the host form in
`@lablo/core` (`blocklistHost`, `blocklistCandidates`) and `GET /v1/config` in `apps/web`.

## The files

| File | What it is |
|---|---|
| `config/config.json` | The doc **without its dates**. People edit this one (or `pnpm sign-config block`). |
| `config/config.signed.json` | `{doc, sig}`: the dated doc's exact text and its Ed25519 signature (base64url). Written only by `pnpm sign-config sign`. The backend serves it. |
| `config/keys.json` | `{production: [...], dev}`: the public keys. `production` holds the current key and the next one (rotation), **empty until step 34's key ceremony**; `dev` is the dev key's public key. |

Both config files are committed, so git history is the audit trail. `pnpm test` fails when
`config.signed.json` isn't `config.json` signed by a trusted key (`tools/sign-config/test/committed.test.ts`).

## Commands

| Command | What it does |
|---|---|
| `pnpm sign-config keygen --out <file>` | A new 32-byte signing seed in `<file>`, which must be **outside the repo** and must not exist yet. Prints its public key. |
| `pnpm sign-config pubkey --key <file>` | Prints a seed file's public key. |
| `pnpm sign-config sign --key <file>` | Dates `config/config.json` (`issuedAt` now, `expiresAt` in 180 days; `--days N` for 1 to 400), checks it and signs it into `config/config.signed.json`. The key must be one of `keys.json`'s production keys. |
| `pnpm sign-config sign --dev` | The same with the dev key, allowed only while there are no production keys. |
| `pnpm sign-config verify` | Checks `config.signed.json`: a trusted key's signature, a valid doc, the same doc as `config.json`, not expired. Prints the days left. |
| `pnpm sign-config block <host>...` | Adds the hosts' hashes to `config.json`'s blocklist (sorted, no duplicates). |
| `pnpm sign-config unblock <host>...` | Takes them out. |

`sign` refuses a doc the schema (`configDocSchema` in `@lablo/protocol`) refuses, a field the
schema doesn't know (a typo would otherwise be silently dropped), dates already in `config.json`,
and a blocklist that isn't sorted and unique.

## Changing the config

1. Edit `config/config.json` (or run `block` / `unblock`).
2. `pnpm sign-config sign --key <seed file>` (before step 34: `--dev`).
3. `pnpm sign-config verify`.
4. Commit both files in a PR; `pnpm test` checks them again. The change is live once the backend is
   deployed (step 34 on): the TVs pick it up at their next launch or 6-hourly refresh (step 30b).

**Re-sign before it expires.** A signature holds 180 days by default; `verify` prints the days
left. The TV refuses a config that arrives already expired (step 30b), so an expired committed
file means new installs get the defaults (nothing killed, nothing blocked). Re-signing an unchanged
config is a normal change: sign, verify, commit.

## The doc

```json
{
  "v": 1,
  "minVersion": { "webos": "1.2.0" },
  "kill": [
    {
      "id": "gcc-maintenance",
      "match": { "platform": "tizen", "versions": { "max": "1.0.3" }, "countries": ["AE", "SA"] },
      "mode": "notice",
      "message": { "en": "Lablo 1.0.4 fixes playback on this TV. Update it from the store.", "ar": "..." }
    }
  ],
  "blocklist": { "salt": "<fixed, never change it>", "hashes": ["<43 characters>", "..."] },
  "flags": { "newGuide": true },
  "tunables": { "liveBufferSeconds": 4 }
}
```

- **`kill` rules** match when every condition they have holds (`platform`, an inclusive version
  range, a country list from the request's geo header); a rule with no conditions matches
  everyone. Modes, weakest to strongest: `notice` (shown once per rule `id`), `block-new-sources`,
  `disable-playback`, `disable-app`. The message is the doc's own, in English and Arabic.
- **`minVersion`** per platform: older apps ask to be updated.
- **`blocklist`:** `hashes` are `b64url(SHA-256(salt + host))` of the blocked hosts; the TV hashes a
  source's host and each parent domain, so blocking `example.com` blocks `tv.example.com` too. The
  doc never names a domain. **Keep the plain list of blocked hosts offline** (with the orders behind
  them): the repo has only hashes, so the list can't be rebuilt from it. **Never change the salt**:
  every hash would have to be made again from that plain list.
- **Hosts** (`blocklistHost`): lowercase ASCII, one trailing dot dropped, `[...]` around an IPv6
  address; a port, path or login is refused. Give a non-ASCII name in its `xn--` (punycode) form.
  IP addresses are taken as written (`127.1` is not `127.0.0.1`).
- Unknown fields are refused by `sign` and stripped by older apps; a change older apps must not
  misread needs a new `v` (they refuse it and keep their cached config).

## The keys

- **The dev key:** its seed is SHA-256 of `lablo.config.dev-key.v1`, public on purpose. Dev and test
  builds trust it; a store build never does (step 30b). While `keys.json` has no production keys,
  the committed config is dev-signed.
- **The production keys** are Omar's. Their seeds never enter the repo, a chat or a CI secret:
  `keygen` refuses a path inside the repo, and signing happens on his machine.

### The key ceremony (step 34, Omar)

1. On his own machine, outside the repo folder: `pnpm sign-config keygen --out <folder>/lablo-config-1.seed`,
   then the same for `lablo-config-2.seed`. Each prints its public key.
2. Store each seed file's one line in the password manager (one entry per key: "current" and
   "next") and on paper (the 43 characters after `lablo-config-seed-v1:`). Then delete the files, or
   keep them only on encrypted offline storage.
3. Give Claude the two **public** keys (safe to paste); they go into `keys.json`, current first.
4. Sign the production config himself: `pnpm sign-config sign --key <file of key 1>` (the seed file
   back from the password manager for the moment), `pnpm sign-config verify`, and commit
   `config.signed.json` with `keys.json`. From then on `verify` and `pnpm test` refuse a dev
   signature.

### Rotation

The apps embed both production keys, so either can sign. If the current key is lost or exposed:
sign with the next key at once (the apps already trust it); make a new "next" key; ship app
versions that embed the remaining good key and the new one; take the old key out of `keys.json`
once those versions have replaced the old ones. Until then, apps that still trust an exposed key
accept a config it signs, which matters only to someone who can also answer for the API host.

## `GET /v1/config`

`{"doc": "<the signed text>", "sig": "<base64url>", "country": "AE" | null}`, status 200.

- `doc` and `sig` are `config.signed.json`'s, bundled into the function at build time (no file
  read, no database). The function checks the file's shape when it loads (`loadSignedConfig`).
- `country` comes from Vercel's `x-vercel-ip-country` header when it is two capital letters, else
  `null` (locally there is no such header). It isn't signed: it only picks which kill rules apply,
  and it comes over HTTPS.
- `cache-control: private, max-age=300`: a TV may keep the answer 5 minutes, a shared cache never
  (architecture.md §3.2 said "5-minute CDN cache", but the answer carries the caller's country);
  `access-control-allow-origin: *` (a public document, read without credentials, so the desktop
  dev app on another origin can read it).

Try it: `pnpm build:web`, `pnpm --filter @lablo/web start`, then
`curl -H "x-vercel-ip-country: AE" http://localhost:3100/v1/config`.

## On the TV

What the TV does with the answer (`packages/data`, step 30b1; the config worker and the app's
schedule, step 30b2; the enforcement comes with step 30c):

- **When** (`apps/tv/src/data/config-schedule.ts`): a config worker runs after the start's first
  screen has painted (never before it, never waited for), then 6 h after a run that brought a new
  doc, or 30 min after one that didn't (offline at boot, a time limit, a refusal) or whose worker
  died. A run that falls due while the app is hidden happens when it is visible again; a TV that
  slept past the due time runs one as it wakes. One run at a time.
- **The config worker** (`@lablo/data/config.worker`, 134 KB: the schemas and the signature
  check, which the main bundle can't take) starts for one run and is terminated after it. It reads
  the cached copy and sends its policy first (the app applies it at once), then fetches, and
  answers the fetched policy, or the cached one again with why. The app keeps the policy in a
  signal (`config.policy` in main.tsx); nothing shows it before step 30c.
- **The blocklist lives in the query worker** (`blocked(urls)`): it reads the salt and the hashes
  from the cached copy (no schema there: only the config worker writes that record, after its
  checks), when first asked and again after each config run (`reloadConfig`).
- **What the build embeds** (`tv-defines.config.ts`, read by tools/build and by Vite):
  - the keys: a TV build trusts `config/keys.json`'s production keys, or the dev key while there
    are none, **never both** (a build with production keys never trusts the dev key, whose seed is
    public); the desktop dev app (`pnpm dev`, the e2e tests) trusts both;
  - the API base: `http://127.0.0.1:3100` (the local backend) until step 34 sets the production
    domain in `PRODUCTION_API_BASE`. On a TV that address is the TV itself, so the fetch fails and
    the defaults stay: harmless until step 34;
  - the version: `apps/tv/package.json`'s (the doc's `minVersion` compares with it).
- **Checking it locally:** run the backend (`pnpm --filter @lablo/web start` on port 3100, or any
  server answering `/v1/config` with a dev-signed answer and `access-control-allow-origin: *`),
  then `pnpm dev`: after the first screen, the app's IndexedDB (`lablo`, store `kv`, key
  `config`) holds the copy. Without a backend the fetch fails quietly (the worker's failed
  request isn't a page console error).

- **Taking an answer** (`checkConfigResponse`): JSON, `configResponseSchema`, the signature against
  the keys the build embeds, the signed text's JSON, `configDocSchema`. Refused when it has expired
  (`now > expiresAt`: an old signed doc replayed) or is older (`issuedAt`) than the TV's cached copy.
  An equal `issuedAt` is taken (it refreshes the country). A TV clock running behind refuses
  nothing: an `issuedAt` in the TV's future is fine.
- **The fetch** (`ConfigService.refresh`): `GET <api>/v1/config`, the whole answer within 3 s and at
  most 4 MiB. A good answer replaces the cached copy (IndexedDB `kv`, key `config`: the exact text,
  the signature, the country, when it was fetched). On any failure (network, time limit, status,
  size, any refusal) the cached copy stays in force; with none, the defaults: nothing killed,
  nothing blocked. If IndexedDB can't keep a good answer, it still applies until the app closes.
- **The cached copy** is checked again against the build's keys when it is read (a key rotated out,
  or a dev-signed copy once a build trusts only production keys, is deleted, so the query worker's
  blocklist drops it too), but never for its
  age: **an expired cached config stays in force** until a newer one arrives, so a kill rule can't
  lapse while a TV is offline. Re-signing on time still matters for new installs and wiped TVs.
- **The policy** (`configPolicy`): the strongest matching rule other than a notice, each mode
  including the weaker ones (`block-new-sources` < `disable-playback` < `disable-app`; the doc's
  first among equals), the matching notices in the doc's order, `updateRequired` below the
  platform's `minVersion`, the flags and tunables. A rule with `countries` needs a known country
  (an answer with `country: null` matches no such rule). The desktop dev app (`browser`) matches
  only rules without a platform and has no `minVersion`.
- **The blocklist** (`Blocklist`): the URL's host (any `scheme://`, the login, port, path, query and
  fragment dropped; for http, https, ws, wss and ftp a `\` is a `/`, as browsers read them), percent
  escapes decoded, then a Unicode host mapped as browsers map it (NFKC, lowercase, the ignored
  code points dropped, NFC, the ideographic dots) and each non-ASCII label written as `xn--`
  punycode, then the host form above, then the host and each parent hashed under the salt. So
  `http://TV.Ｅｘample.com:8080/x` is blocked by `example.com`. It follows the current UTS #46
  (Unicode 17): it equals Node 24's `url.domainToASCII` wherever Node answers, except for letters UTS #46 case-folds beyond
  lowercase (Greek letters with an iota subscript, the lunate and mathematical sigmas, the old
  Cyrillic variants U+1C80 to U+1C88, Cherokee): for a host written with those, the TV's `xn--`
  form differs from Node's, and a block on Node's form misses it. A Latin host never has them. An
  IP address is taken as written, and a URL without a host blocks nothing.

## Gotchas

- **`config.json`'s formatting is the tool's** (`JSON.stringify(…, null, 2)` and a newline): the
  committed-file test checks it, so `block` and `sign` never leave stray diffs.
