# Runbook: the mock provider (`pnpm mock`)

`apps/mock-provider` is a Fastify server that behaves like an Xtream Codes panel, an M3U/XMLTV host and a catch-up server, with fault injection (RELAY step 3, architecture.md §4). It is the test bed for the parsers, the player and the e2e tests, and how TV lab runs report back to Claude (the LAN log collector).

It imports **nothing** from our packages: it is an independent oracle, so a bug in a shared parser can't hide in both the app and the mock. It serves only our own ffmpeg test channels and files and, when fetched, the Blender open movies (credited at `/attribution`). Its test credentials live in `apps/mock-provider/fixtures/server.yaml` and nowhere else.

## Commands

| Command | What it does |
|---|---|
| `pnpm mock` | Serves on `0.0.0.0:8080` (all interfaces, so TVs on the LAN can reach it). Prints the LAN URLs and logs one line per request. |
| `pnpm mock --port 9000 --host 127.0.0.1` | Another port; loopback only (no Windows Firewall prompt). `MOCK_PORT` and `MOCK_HOST` work too. |
| `pnpm mock --scenario flaky-live` | Starts with a fault scenario (a name in `fixtures/scenarios/` or a path to a YAML file). |
| `pnpm mock --fixtures <dir>` | Another fixtures folder (`server.yaml`, `catalog.yaml`, `scenarios/`). |
| `pnpm mock --lab-log-dir <dir>` / `--no-lab-logs` | Moves or disables the log collector (disable it on any public server). |
| `pnpm mock --quiet` | No request log. |
| `pnpm mock --media <dir>` / `--no-media` | Where the generated media lives (default `.cache/media`, also `MOCK_MEDIA_DIR`). Without a `manifest.json` there, or with `--no-media`, streams are placeholder bytes. |
| `pnpm mock --catalog <file.json or .yaml>` | Another catalog, e.g. the 200k scale catalog `.cache/fixtures/catalog.json`. JSON is the fast path: about 0.3 s for 200k items. |
| `pnpm mock --xmltv <file.xml[.gz]>` | Serves this XMLTV file at `xmltv.php` and `/epg/guide.xml[.gz]` instead of the generated guide, gunzipping or gzipping on the fly as needed. |
| `pnpm mock:media [--force]` | Generates the test channels and files with ffmpeg into `.cache/media`. About 30 s on a fast PC; results are cached by hash (see Media). |
| `pnpm mock:open-movies [--only sintel,…] [--keep-downloads]` | Fetches the four Blender films (about 1.2 GB, pinned SHA-256) into `.cache/media/open-movies`. Opt-in; never run in CI. Restart the mock to serve them. |

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
| `GET /attribution` | Credits for the Blender open movies (CC BY) and a note on the generated media. |
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

12 test channels (English, Arabic with Arabic-Indic digits, French, Spanish; a radio channel; an adult-flagged test pattern in an `18+` group; one channel without EPG; a duplicate of channel 101 in another group; channel 105's `tvg-id` `Zoma.Kids` differs from its XMLTV id `zoma.kids`), the four Blender open movies plus two test-pattern movies, and two series (one Arabic). EPG slots are 30, 60, 45 or 90 minutes depending on the channel, aligned to the epoch, so any "now" gives the same schedule. Each entry can name its media profile (`media:`, see Media). The 200k-item scale catalog comes from `pnpm fixtures`, not from this file (see Scale fixtures).

## Media

`pnpm mock:media` generates the media into `.cache/media` (gitignored):
- `src/media-plan.ts` (pure, unit-tested) turns the catalog into ffmpeg jobs;
- `src/media-gen.ts` runs them and writes a `manifest.json`;
- `FileMedia` (`src/file-media.ts`) serves what the manifest lists.

Each asset sits in a folder named by a hash of its ffmpeg arguments, so a rerun re-encodes only what changed and prunes the rest. `pnpm mock` serves this media when the manifest exists; otherwise it sends placeholder bytes. Anything the manifest lacks (an unknown extension, say) also gets placeholder bytes.

**Requirements:**
- **ffmpeg and ffprobe on PATH:** on Windows `winget install Gyan.FFmpeg`; on Debian or Ubuntu `apt-get install ffmpeg fonts-dejavu-core`. Or set `FFMPEG`.
- **A font file for the labels:** set `ZOMA_MEDIA_FONT`; otherwise the generator uses DejaVu Sans or Arial. The path must be explicit because ffmpeg's default font crashes on Windows.
- **ASCII labels only:** drawtext can't shape Arabic, so Arabic channel names appear as "Channel N (non-Latin name)".

### Live channels

Each live channel is a 60 s loop of ten 6 s MPEG-TS segments. The burned-in label shows:
- the channel number, id, profile and name;
- `sec SS.ff`, which equals the UTC second of the minute.

`src/ts-rewrite.ts` places the loop on the epoch timeline. Segment `seq` gets PTS, DTS and PCR for epoch second `seq × 6` (mod 2^33), and continuity counters as if the channel had always been running. Live TS, live HLS and catch-up therefore share one continuous timeline.

How each form is sent:
- **Live TS:** starts at the current segment and sends it at once, like a restreamer's initial buffer, then paces at real time.
- **Catch-up:** sends the window's segments without pacing.

Looped audio stops 100 ms before the lap ends. AAC can't end exactly on a 60 s boundary, so full-length audio would overlap the next lap and the timestamps would go backwards once a minute.

| Profile (`media:` in catalog.yaml) | Channels | Video | Audio |
|---|---|---|---|
| `clock` (default) | 102, 103, 105, 110, 111 | testsrc2 960×540 25p, H.264 | AAC stereo eng, with a beep each second |
| `bars` | 101, 109, 112 | SMPTE HD bars 960×540 25p | AAC eng |
| `bilingual` | 104 | testsrc2 960×540 | AAC **ara + eng**, for track switching on live |
| `hd` | 106 | testsrc2 1280×720 **50p** | AAC eng |
| `fhd` | 107 | testsrc2 1920×1080 25p | AAC eng |
| `radio` (default for radio channels) | 108 | none | **MP3**: 24 ms frames end exactly on 6 s; AAC frames can't |
| generic loop | every channel without a loop of its own (scale catalogs) | testsrc2 960×540 | AAC eng |

### VOD and episodes

Files up to 5 minutes long are encoded at full length, so the burned-in `HH:MM:SS.mmm` is the real position (useful for resume checks). Longer files repeat a short clip, joined by stream copy.

| Profile | Items | Contents |
|---|---|---|
| `vod` (default) | Episodes 3001–3022 | H.264 640×360 + AAC eng. Subtitles **ara + eng**: SRT in MKV (3001–3003), **mov_text** in MP4 (3011–3022). |
| `hevc-4k` | Movie 205 (MP4) | **HEVC 3840×2160** (`hvc1`) bars + AAC. |
| `multi-audio` | Movie 206 (MKV) | H.264; AAC **ara / eng / spa**; **AC3 5.1** and **E-AC3 5.1** with a different tone per channel; SRT ara + eng. |
| `open-movie:<key>` | Movies 201–204 | The Blender film once fetched. Until then, a labelled stand-in ("open movie not downloaded") of the catalog's length. |
| generic `mp4` / `mkv` | Any other movie or episode id with that extension | A 60 s test file. |

A file is served only under the extension the catalog lists, as `container_extension` says; other extensions answer 404.

### Open movies

`pnpm mock:open-movies` (`src/open-movies.ts`) fetches four films from download.blender.org:

| Film | Rendition | Size |
|---|---|---|
| Big Buck Bunny | 320×180 MP4 | 65 MB |
| Sintel | 720p MKV | 681 MB |
| Tears of Steel | 720p MOV, remuxed to MP4 | 372 MB |
| Elephants Dream | 480p MOV, remuxed to MP4 | 104 MB |

- Each download is pinned by URL and SHA-256, and the hash is checked while it streams.
- Zip files are unpacked. MOV files are remuxed by stream copy only, with no re-encoding.
- Downloads are deleted afterwards unless you pass `--keep-downloads`.
- `GET /attribution` carries the credits the CC BY licences require.

### Validation

`pnpm test:media` is part of `pnpm verify:media` and runs in CI job `media`. It generates the media, serves it from a real socket and checks it with ffprobe and ffmpeg:

| What | Checks |
|---|---|
| Every live channel | Codecs, sizes and audio languages; then 14 s decoded across a lap boundary with zero warnings. |
| Live HLS | Decodes cleanly. |
| Catch-up (TS and HLS) | Exact packet counts for a 120 s window. |
| Every movie and episode | Tracks, languages, subtitles and duration; then 14 s decoded cleanly. |
| Scale catalog | Served whole; the generic loop and generic files play. |

## Scale fixtures (`pnpm fixtures`, `tools/fixtures`)

The fixtures are deterministic: a seeded PRNG, default seed 20261102 (`--seed N` to change it). They are streamed to `.cache/fixtures/` along with a `manifest.json` of sizes and SHA-256 hashes.

Generation takes about 20 s on a fast PC. `pnpm fixtures` **fails if it takes over 2 minutes** (RELAY step 4).

| File | Contents |
|---|---|
| `playlist.m3u` | m3u_plus with 200,000 entries: 20k live, 120k movies and 60k episodes. Names are in ar/en/fr/es, with country and quality tags, duplicates, catch-up attributes and adult groups. URLs point at `http://127.0.0.1:8080` with the `zoma` test account. Also 400 malformed lines (listed below). |
| `xtream/*.json` | The Xtream list responses: `live_streams` (20k), `vod_streams` (120k), `series` (3k), plus the three category lists. |
| `catalog.json` | The same catalog in the mock's schema, for `pnpm mock --catalog .cache/fixtures/catalog.json`. Scale channels play the generic loop and files. |
| `xmltv-50mb.xml`, `-150mb`, `-300mb` (each + `.gz`) | 14 days of programmes. The 300 MB file covers all 5,000 EPG ids the catalog uses; the smaller ones cover fewer channels. They include entities, CDATA, second-language titles and offsets from −0800 to +0530. |

The malformed M3U lines:
- unbalanced quotes;
- entries without a URL, and URLs without an entry;
- bad durations;
- unquoted attributes;
- a 4,000-character name;
- `#EXTVLCOPT` and `#EXTGRP` lines.

Live channels reference the EPG in four ways: a matching id, the id in another case, an id that matches nothing, or no id at all.

`--only catalog` or `--only xmltv` writes just one half. To serve both:

```bash
pnpm mock --catalog .cache/fixtures/catalog.json --xmltv .cache/fixtures/xmltv-300mb.xml.gz
```

## Benchmarks (`pnpm bench`, `tools/bench`)

`pnpm bench [case…] [--iterations 3] [--json out.json]` runs each case over the scale fixtures and prints:
- MB/s and items/s;
- peak heap, sampled while the case runs, starting from a heap cleaned with `--expose-gc`;
- peak RSS.

The `*-scan` and `*-json-parse` cases are baselines (the naive way to read each input). The real parsers run next to them on the same inputs:

| Case | What it measures |
|---|---|
| `m3u-extinf-scan` | Baseline: a streamed line scan of the M3U. |
| `m3u-parse` | core's streaming `M3uCatalogParser` (step 5): bytes → TextDecoder → catalog items with keys, normalized names and match names, items dropped per chunk. About 74 MB/s and a 75 MB heap peak for the 200k playlist on a fast PC (2026-11-02), against about 640 MB/s for the scan. |
| `xtream-vod-json-parse` | Baseline: the whole-response `JSON.parse` that step 6's streaming splitter replaces. |
| `xmltv-gz-programme-scan` | Baseline: gunzip and scan of the 300 MB guide. |

Steps 6–9 add their parsers to `tools/bench/src/suites.ts` the same way. CI uploads the results as the `bench` artifact.

The 200k playlist is also a correctness test: `tools/fixtures/test/m3u-scale.media.test.ts` (`pnpm test:media`) checks that core's parser returns exactly the 200,000 entries that `catalog.json` lists, and that each of the 400 malformed lines has its documented effect (`MALFORMED_EFFECTS` in `tools/fixtures/test/m3u-oracle.ts`). `m3u-core.test.ts` runs the same check on a 9,000-entry catalog in `pnpm test`.

## Docker

`apps/mock-provider/Dockerfile` builds from the repo root as its context. It installs only the mock's own dependencies, adds ffmpeg, and generates the media at build time.

```bash
docker build -f apps/mock-provider/Dockerfile -t zoma-mock .
docker run --rm -p 8080:8080 zoma-mock                       # LAN lab use
docker run -d -p 8080:8080 zoma-mock --no-lab-logs           # a public test server
docker run ... -v "$PWD/.cache/media/open-movies:/app/.cache/media/open-movies" zoma-mock   # with the films
```

CI builds the image, starts it and probes it: health must report `files`, and channel 104 must have two audio tracks.

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
| `GET /__mock/health` | `{ ok, scenario, now, media, catalog }`. `media` is `files` or `placeholder`; `catalog` counts the live channels, movies and series. |
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

The plan puts this mock on a small VPS with its own clearly labelled test-signal domain, as the store testers' account. Run it there from the Docker image with `--no-lab-logs`, behind HTTPS, and never link it from the app. Consider fetching the open movies there, so testers see real films. The redirect chains use server-side tokens, so `/__mock/redirect` can't be used as an open redirect.
