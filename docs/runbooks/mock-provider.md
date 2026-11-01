# Runbook: the mock provider (`pnpm mock`)

`apps/mock-provider` is a Fastify server that behaves like an Xtream Codes panel, an M3U/XMLTV host and a catch-up server, with fault injection (RELAY step 3, architecture.md §4). It is the test bed for the parsers, the player and the e2e tests, and how TV lab runs report back to Claude (the LAN log collector).

It imports **nothing** from our packages: it is an independent oracle, so a bug in a shared parser can't hide in both the app and the mock. It serves only our own test channels and, from step 4, the Blender open movies. Its test credentials live in `apps/mock-provider/fixtures/server.yaml` and nowhere else.

## Commands

| Command | What it does |
|---|---|
| `pnpm mock` | Serves on `0.0.0.0:8080` (all interfaces, so TVs on the LAN can reach it). Prints the LAN URLs and logs one line per request. |
| `pnpm mock --port 9000 --host 127.0.0.1` | Another port; loopback only (no Windows Firewall prompt). `MOCK_PORT` and `MOCK_HOST` work too. |
| `pnpm mock --scenario flaky-live` | Starts with a fault scenario (a name in `fixtures/scenarios/` or a path to a YAML file). |
| `pnpm mock --fixtures <dir>` | Another fixtures folder (`server.yaml`, `catalog.yaml`, `scenarios/`). |
| `pnpm mock --lab-log-dir <dir>` / `--no-lab-logs` | Moves or disables the log collector (disable it on any public server). |
| `pnpm mock --quiet` | No request log. |

On Windows, the first `pnpm mock` on `0.0.0.0` makes Windows Firewall ask whether Node may accept connections: allow **private networks** so the TV can connect. The TV and the PC must be on the same LAN.

Tests don't need a running server: they build it in-process (`buildServer()` from `src/server.ts`, with `app.inject()` or a real socket on port 0).

## Accounts (`fixtures/server.yaml`)

| Username / password | State | Use it for |
|---|---|---|
| `zoma` / `zoma-test` | Active, expires in 365 days, 2 connections | The normal case. |
| `trial` / `trial-test` | Active trial, expires in 2 days, 1 connection | Trial banners, close-before-open. |
| `forever` / `forever-test` | Active, `exp_date: null`, 4 connections | "Never expires". |
| `expired` / `expired-test` | Expired 3 days ago | Expired-account UX. |
| `banned` / `banned-test` | Banned | Banned-account UX. |
| `disabled` / `disabled-test` | Disabled | Disabled-account UX. |
| `maxed` / `maxed-test` | Active, already at its 1 connection | Every stream answers **509**. |
| `special+user@zoma.test` / `p@ss/w0rd&?# é` | Active | Percent-encoding of credentials in paths and queries. |

Behaviour by state:
- **Unknown credentials:** `player_api.php` answers `{"user_info":{"auth":0}}` (HTTP 200); `get.php`, `xmltv.php` and streams answer 401.
- **Expired, Banned, Disabled:** `player_api.php` authenticates (`auth: 1`, `status` set) but every action returns `[]`; `get.php`, `xmltv.php` and streams answer 403.
- **Connections:** `active_cons` = the account's fixture value + the long-lived streams this server holds open (live TS, VOD, episodes, catch-up TS). Once that reaches `max_connections`, a stream gets `over_limit_status` (403 by default, 509 for `maxed`). `GET /__mock/connections` shows the open streams.

Dates are relative to "today" (UTC midnight), so `exp_date` stays fixed all day.

## Endpoints

| Endpoint | Notes |
|---|---|
| `GET/POST /player_api.php?username=&password=[&action=]` | No action: `user_info` + `server_info`. Actions: `get_live_categories`, `get_live_streams`, `get_vod_categories`, `get_vod_streams`, `get_vod_info&vod_id=`, `get_series_categories`, `get_series`, `get_series_info&series_id=`, `get_short_epg&stream_id=&limit=` (title and description base64), `get_simple_data_table&stream_id=` (with `now_playing`, `has_archive`). `category_id` filters the lists. Unknown actions and ids return `[]`. POST takes a form body. |
| `GET /get.php?username=&password=&type=m3u_plus\|m3u&output=ts\|m3u8` | Live channels, then movies, then episodes. `m3u_plus` has `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `radio="true"` and catch-up attributes (below). |
| `GET /xmltv.php?username=&password=` | XMLTV for every channel with an EPG id. Each channel's programmes cover its archive days (at least 1) behind now and `epg_future_days` (3) ahead. |
| `GET /epg/guide.xml`, `/epg/guide.xml.gz` | The same guide without credentials, like a standalone EPG URL; `.gz` is a raw gzip body. |
| `GET /live/{u}/{p}/{id}.ts\|.m3u8`, `/live/{u}/{p}/{id}`, `/{u}/{p}/{id}` | Live TS (paced, endless) or a sliding-window HLS playlist (6 × 6 s segments). |
| `GET /hls/{u}/{p}/{id}/{seq}.ts` | HLS segments; segment `seq` starts at epoch second `seq × 6`. |
| `GET /movie/{u}/{p}/{id}.{ext}`, `/series/{u}/{p}/{episodeId}.{ext}` | VOD and episodes with `Range` (206, 416) and `HEAD`. |
| `GET /timeshift/{u}/{p}/{minutes}/{YYYY-MM-DD:HH-MM}/{id}.ts` | Xtream catch-up. The start is wall time in the panel's zone (`server_info.timezone`). |
| `GET /streaming/timeshift.php?username=&password=&stream=&start=&duration=` | The same, query form. |
| `GET /catchup/{u}/{p}/{id}.ts?start={utc}&end={utcend}` | Target of the M3U `catchup="default"` template. |
| `GET /flussonic/{u}/{p}/{id}/index.m3u8\|mpegts\|index-{s}-{d}.m3u8\|archive-{s}-{d}.ts\|timeshift_abs-{s}.ts` | Flussonic-style live and catch-up (epoch seconds). |
| `GET /images/{kind}-{id}.png` | Logos and posters (a 1×1 PNG). |
| `POST/GET /__lab/logs[/{session}]` | LAN log collector (below). |
| `GET /__mock/health`, `/__mock/scenarios`, `/__mock/connections`; `PUT /__mock/scenario` | Control (below). |
| `GET /` | A text page with the endpoints and test accounts. |

Every response carries `Access-Control-Allow-Origin: *` (for the desktop dev loop; TV apps aren't subject to CORS), and `OPTIONS` preflights answer 204. The `no-cors` fault removes the header.

### Catch-up modes

Each catalog channel with `archive_days` advertises catch-up in the M3U in one mode, so one playlist covers all of them. Xtream clients always use `/timeshift`.

| Channel | M3U attributes | Catch-up URL the client builds |
|---|---|---|
| 101, 112 | `catchup="xc" catchup-days="7"` | `/timeshift/{u}/{p}/{min}/{start}/{id}.ts` |
| 102 | `catchup="default" catchup-source="…/catchup/{u}/{p}/102.ts?start={utc}&end={utcend}"` | The template, filled in. |
| 103 | `catchup="append" catchup-source="?utc={utc}&lutc={lutc}"` | Stream URL + source. |
| 105 | `catchup="shift"` | Stream URL + `?utc={utc}&lutc={lutc}`. |
| 106 | `catchup="flussonic"`, stream URL `…/flussonic/{u}/{p}/106/mpegts` | `…/archive-{utc}-{duration}.ts`, `…/index-{utc}-{duration}.m3u8`, `…/timeshift_abs-{utc}.ts` |

Archive responses carry `X-Mock-Archive-Channel`, `X-Mock-Archive-Start` (epoch s) and `X-Mock-Archive-Duration` (s), so a test can check exactly what a built URL resolved to. A start outside the archive window, or a channel without archive, answers 404; a malformed start or duration answers 400.

## Catalog (`fixtures/catalog.yaml`)

12 test channels (English, Arabic with Arabic-Indic digits, French, Spanish; a radio channel; an adult-flagged test pattern in an `18+` group; one channel without EPG; a duplicate of channel 101 in another group; channel 105's `tvg-id` `Zoma.Kids` differs from its XMLTV id `zoma.kids`), the four Blender open movies plus two test-pattern movies, and two series (one Arabic). EPG slots are 30, 60, 45 or 90 minutes depending on the channel, aligned to the epoch, so any "now" gives the same schedule. Step 4's 200k-item scale fixtures come from `tools/fixtures`, not from this file.

## Media

`src/media.ts` defines a `MediaSource` interface. Step 3 ships `PlaceholderMedia`: MPEG-TS null packets for live, HLS and catch-up (live is paced at about 1 Mbit/s and endless), and deterministic bytes for VOD (1 MiB + the id, so a range can be checked). The content types are right but nothing decodes. **RELAY step 4** adds the ffmpeg test channels and the open movies behind the same interface.

## Faults

Two ways to inject them:
1. **A scenario** (`--scenario`, or `PUT /__mock/scenario {"name": "…"}` at runtime): rules matched per request.
2. **`?mock_fault=` on any URL**, for one request: `mock_fault=status:509`, `mock_fault=redirect:hops=3:status=307,stall:after_bytes=4096`. Faults are separated by `,`, arguments by `:` (`key=value`, or one positional value). Query faults apply after scenario faults; for the same type the query wins. A bad value answers 400.

`/__mock/*` and `/__lab/*` are never faulted, so a scenario can always be switched off.

| Type | Arguments (positional first) | Effect |
|---|---|---|
| `status` | `status`, `body`, `content_type` | Answers that status (401/403/404/509/… or 200 with an HTML page) instead of the handler. |
| `redirect` | `hops` (1), `status` (302; 301/303/307/308), `host`, `relative` | A chain of `hops` redirects through `/__mock/redirect/…` back to the URL plus `mock_hop=done`. `host` sends the client to another host:port (a CDN hop); `relative` uses path-only `Location`s. |
| `slow-headers` | `delay_ms` | Waits before sending the headers. |
| `stall` | `after_bytes` (0), `after_ms`, `hold_ms` (120000) | Sends the headers (declaring the full `Content-Length`) and the first bytes, then nothing, holding the socket open until the client gives up or `hold_ms` passes. |
| `reset` | `after_bytes` | No `after_bytes`: drops the connection before any response. With it: sends that many bytes, then drops it. |
| `bom` | | Prefixes a UTF-8 BOM (on JSON that makes `JSON.parse` fail). |
| `crlf` | | LF → CRLF. |
| `invalid-utf8` | | Inserts invalid UTF-8 (lone `0xC3`, `0xFF`, an overlong `/`, a surrogate, a Latin-1 `é`) where the first name starts (M3U, XMLTV or JSON). |
| `malformed-m3u` | | Inserts broken entries after `#EXTM3U` (unbalanced quote, entry without URL, URL without entry, unquoted attributes, bad duration, duplicate attribute, comma in title, 5000-character name, `#EXTVLCOPT`/`#EXTGRP`, blank lines) and ends on an entry cut off with no URL and no final newline. |
| `truncate` | `bytes`, `fraction` (0.5) | Cuts the body short. |
| `gzip` | `mode`: `encoding` (default) or `raw` | `encoding`: `Content-Encoding: gzip`. `raw`: a gzip body served as `application/gzip` with no `Content-Encoding`, so the client must gunzip it itself. Works on streams too. |
| `timezone` | `tz`, `xmltv`: `local` (default), `utc`, `none`, `colon` | The panel's zone (`server_info.timezone`, short-EPG times, timeshift starts) and how XMLTV offsets are written: `+0545`, `+0000` (UTC times), no offset at all, or `+05:45`. |
| `json-quirks` | | Numbers ↔ numeric strings, `null` → `""`, and series `episodes` as an array of arrays instead of an object. |
| `no-cors` | | No `Access-Control-Allow-Origin`. |

### Scenario files

```yaml
# fixtures/scenarios/<name>.yaml
description: One line, shown by GET /__mock/scenarios.
rules:
  - match:              # all optional; every listed field must match
      path: /live/**    # glob or list: * within a segment, ** across
      method: GET
      action: get_live_streams
      username: zoma
      stream_id: [101, 102]
    after: 0            # skip the first N matching requests
    times: 2            # then apply to N matching requests (always, if absent)
    faults:
      - type: status
        status: 509
```

Unknown keys are errors, so a typo fails loudly. Shipped scenarios:

| Scenario | What it does |
|---|---|
| `flaky-live` | The first two live requests get 509, then live works (watchdog retry ladder). |
| `redirect-chain` | Live, VOD and episodes go through 3 × 302 (AVPlay redirect probe, spike S4). |
| `stalling-streams` | Live stalls after 64 KiB; the 3rd VOD/episode request resets after 32 KiB. |
| `slow-provider` | 3 s before headers on `player_api.php`, 8 s on `get.php` and `xmltv.php`. |
| `broken-playlist` | `get.php` with malformed entries, invalid UTF-8, CRLF and a BOM. |
| `gzip-epg` | `xmltv.php` gzip-encoded; `get.php` as a raw gzip body. |
| `odd-timezone` | A panel in Asia/Kathmandu (+05:45) whose XMLTV times have no offset. |
| `provider-errors` | Channels 101–104 answer 401/403/404/509; `get.php` cut at 60 %; quirky JSON types. |

### Control

| Request | Answer |
|---|---|
| `GET /__mock/health` | `{ ok, scenario, now }` |
| `GET /__mock/scenarios` | The active scenario and every shipped one, with descriptions. |
| `PUT /__mock/scenario` with `{"name": "flaky-live"}` | Switches scenario (and resets its counters); `{"name": null}` switches faults off. |
| `GET /__mock/connections` | Open streams per username. |

## LAN log collector

Lab builds and the on-TV self-test send results here, and Claude reads them back. Since Claude can't see the TV, this is how its results return.

| Request | Effect |
|---|---|
| `POST /__lab/logs/{session}` | Appends records to `artifacts/lab-logs/{session}.ndjson` (gitignored). The body is a JSON object, a JSON array, or NDJSON as `application/x-ndjson` or `text/plain` (a CORS-simple request, so no preflight). Each line gets `_received` (ISO time). Answers `{ ok, session, lines }`. |
| `GET /__lab/logs` | Sessions with line counts, sizes and modification times, newest first. |
| `GET /__lab/logs/{session}?since=N` | The NDJSON from line N on; `X-Lab-Lines` gives the total. |

Session names are letters, digits, `.`, `_` and `-` (max 64, no leading dot). Posts to one session are written in order, never interleaved. No IP addresses are stored. Claude can also just read the files in `artifacts/lab-logs/`.

## Public test server (later, RELAY step 44, needs Omar)

The plan puts this mock on a small VPS with its own clearly labelled test-signal domain, as the store testers' account. Run it there with `--no-lab-logs`, behind HTTPS, and never link it from the app. The redirect chains use server-side tokens, so `/__mock/redirect` can't be used as an open redirect.
