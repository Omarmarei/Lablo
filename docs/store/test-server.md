# Runbook: the permanent public test server `[needs Omar]`

Both stores need a working account that never lapses (Samsung: "anything the testers can't test is a critical defect"). It is **the mock provider** (`apps/mock-provider`, `docs/runbooks/mock-provider.md`) on a small VPS under a **separate domain** from the product's (PLAN.md §7: one domain's block must not take the other down).

Nothing in this runbook has been done. Every step that creates an account, a server, a domain or a DNS record is Omar's one-word OK (global rule: production effects).

## What it serves
Only our own ffmpeg test channels, the generated guide and (optionally) the four Blender films. No real logos, no real channels. The accounts for the stores are **new ones** with their own passwords: do NOT reuse the fixture passwords in `fixtures/server.yaml` (public in this repo).

## Steps (when Omar says go)
1. **Decide the host and the domain.** A small VPS (about 2 vCPU, 2 GB, 1 TB transfer is enough for a few testers), and a domain such as `test.<other-domain>`. Omar owns the accounts.
2. **Prepare the fixtures** in a private folder (not the repo): copy `apps/mock-provider/fixtures/`, replace `server.yaml`'s accounts with the store account (`forever`-style: `exp_date: null`, 4 connections, no unlimited-connection trick), keep one `expired` and one `maxed` account for the edge cases, all with fresh passwords.
3. **Install:** Node 22, ffmpeg, this repo at a release tag; `pnpm install`, `pnpm mock:media`, optionally `pnpm mock:open-movies`.
4. **Run:** `pnpm mock --host 127.0.0.1 --port 8080 --no-lab-logs --quiet --fixtures <private dir>` under systemd (restart on failure). `--no-lab-logs` is mandatory on a public server (the log collector is for LAN labs).
5. **TLS and proxy:** Caddy or nginx in front, HTTPS on the domain, proxy to `127.0.0.1:8080`, rate limit per IP. Note: TVs fetching an `https://` address from the app is fine; an `http://` panel would not be reachable from a hosted page, but ours is a packaged app, so either works. Use HTTPS.
6. **Check from a TV-free client:** `curl` `player_api.php?username=…&password=…` returns `user_info.auth: 1`; `get_live_streams` lists the channels; a stream URL answers 200 with video bytes.
7. **Check from the app:** add the account in the browser build and on a real TV (Omar's LG/Samsung), play a channel for a minute.
8. **Fill** the angle-bracket values in `samsung-tester-notes.md` in the submission form (not in the repo).
9. **Keep it up:** uptime check on `player_api.php` (a free monitor), a calendar reminder to renew the domain, and no deploys during review.

## Risks
- A review can last months (research: one week to 3+ months). Keep the server and the account alive the whole time.
- The server is public: nothing on it but test patterns. If a tester sees a real brand, it came from the fixtures: fix the catalog.
- Bandwidth: one test pattern at the mock's bitrate is small; cap the Blender films' bitrate or skip them.
