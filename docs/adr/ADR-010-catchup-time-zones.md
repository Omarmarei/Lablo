# ADR-010: Catch-up time zones and mode inference

- **Status:** Accepted
- **Date:** 2026-11-02
- **Amends:** docs/architecture.md §1.5 step 5 (XMLTV times), PLAN.md §4 (catch-up); implemented in RELAY step 6 (`packages/core/src/timezone.ts`, `catchup.ts`, `xmltv.ts`)

## Context
Xtream catch-up URLs (`/timeshift/{u}/{p}/{minutes}/{YYYY-MM-DD:HH-MM}/{id}.ts`) take the programme start as **wall time in the panel's zone**, which `player_api.php` reports as `server_info.timezone` (an IANA name) plus its clock (`time_now` as wall time, `timestamp_now` as epoch seconds). A wrong offset plays the wrong programme, or answers 404 at the edges of the archive.

`core` must run unchanged on Chromium 53 (webOS 4) and 56 (Tizen 4). `Intl.DateTimeFormat` with a `timeZone` exists there, but TV builds may ship trimmed ICU data, and `formatToParts`/`hourCycle` are missing. Bundling a time-zone database (tens of KB) for one URL format is not worth it.

M3U playlists state catch-up loosely: `catchup-days` with no mode, `catchup="default"` with no `catchup-source`, `append` with an absolute source. Players (Kodi IPTV Simple, TiviMate) guess; we have to guess the same way.

## Decision
**Panel zone (`panelZone`), best first:**
1. `Intl` with the panel's IANA name, when this engine supports it (a known-answer probe at first use) **and** it agrees with the panel's clock at "now". It gets DST right for past programmes.
2. The panel clock: `time_now − timestamp_now`, rounded to 15 minutes. A fixed offset: exact for zones without DST, an hour off for programmes on the other side of a DST change inside the archive window (the mock test shows both).
3. UTC.

Only `format()` is used, parsed from the `en-US` numeric form, and hour `24` is read as midnight.

**Xtream start and length:** the start is cut to the minute and written in the panel zone; the length is rounded up to whole minutes from that start, so the programme's end is always covered.

**M3U modes (`catchupMode`):**
- `shift`/`timeshift` → `?utc={start}&lutc={now}` on the stream URL.
- `default`/`vod` → the filled `catchup-source`; a relative source is appended instead.
- `append` → the filled source appended (`?` and `&` fixed up); an absolute source is used as `default`.
- `flussonic`/`flussonic-hls` → `{name}-{start}-{duration}.m3u8` for HLS streams, `timeshift_abs-{start}.ts` for the rest; `flussonic-ts`/`fs` → `timeshift_abs`. `archive-{start}-{duration}.ts` is available as a forced form.
- `xc`/`xtream` → the Xtream `/timeshift/` URL from an Xtream-shaped stream URL.
- **No mode** (days only), or `default`/`append` **without a source**: the source's own form when there is one; otherwise `xc` for an Xtream-shaped live URL; otherwise `shift`.
- Anything else → no catch-up.

Template placeholders follow Kodi's names (`{utc}`, `${start}`, `{utcend}`, `{lutc}`, `{duration:60}`, `{offset}`, `{Y}{m}{d}{H}{M}{S}`, `{utc:FORMAT}`…). Date parts default to UTC; callers pass the panel zone when the source is known to be Xtream.

**M3U `xc` channels on a non-UTC panel** need the panel zone, which only `player_api.php` gives. When the M3U URL is an Xtream `get.php` link (`xtreamFromM3uUrl`), the data layer logs in once and uses that zone; otherwise UTC.

**XMLTV times without an offset** (the `timezone` fault's `none` style) are read in a fallback zone: a user's guide's own zone (`UserGuide.offsetMinutes`, which no screen sets yet; UTC), or the panel zone for an Xtream guide. In a DST zone the repeated hour is ambiguous. Step 9 repairs it from per-channel ordering (a start before the previous stop moves forward an hour).

**Amended in step 9 (2026-11-02):**
- `parseXmltvTime` alone does not always take the earlier instant. It settles the offset from the wall time read as UTC, so it gives the earlier instant west of UTC (New York) and the later one east of it (London). `EpgGuideReader` therefore first settles every offset-less time in the repeated hour to the earlier instant, then repairs from ordering:
  - a start before the channel's previous stop moves forward an hour;
  - so does a stop that would end before its start, or the stop of a programme whose start moved.
- **Limit:** a lone boundary in the repeated hour reads the same with either instant. An example is a 90-minute programme ending at the second 01:00 with the next one starting there. It is taken as the earlier instant, an hour early. `test/epg-mock.test.ts` checks that only that case stays off in a New York guide written without offsets, and `epg-guide.test.ts` checks the repair for London and New York.
- An offset stated in the guide is never repaired, and neither is a fixed fallback zone, which has no repeated hour.

**Amended in step 24b (2026-11-05):**
- The user's time offset is set per guide, not per source: a whole number of half hours from −12 h to +12 h. It is added to every time the guide gives, stated offset or not, and it is applied when the query worker reads, as the tvg-shift is, not at ingest. Times without an offset are still read in the fallback zone first: UTC for the user's guides and a playlist's own, the panel zone for an Xtream guide.
- The offset is fixed: it has no DST. A guide written in a DST zone without offsets stays an hour off for half the year until the user changes it. The fallback zone of a user's guide (`UserGuide.offsetMinutes`) exists, but no screen sets it yet.
- **For step 25:** catch-up should ask for the programme's time as shown, with the offset. The offset is there to make the guide match what the channel aired, and the archive holds what aired. Confirm this against the mock.

**Applied in step 25a (2026-11-05):**
- The app's catch-up (`catchupRequest`, `apps/tv/src/player/catchup.ts`) takes the programme's times as the guide shows them, tvg-shift and offset included, and the source's panel zone from `DataEngine.sourceFacts` (`panelZone` of the last login's `server_info`; UTC before it is read, and for playlists until step 25b).
- The e2e checks it against the mock on a UTC panel and on a Kathmandu one (+05:45, the `odd-timezone` scenario, XMLTV without offsets): the timeshift URL's start is the panel's wall time, and the mock serves the programme's own start. The +1:00 offset case is step 25b's e2e.

**Applied in step 25b (2026-11-05):**
- **The login:** an M3U source whose link is an Xtream `get.php` link (`xtreamFromM3uUrl`) logs in to the panel once per refresh, before the playlist download (`runIngest`'s `panelLogin`, 304 and unchanged refreshes included). The source keeps the login's `server_info` and the account's `allowed_output_formats`, as an Xtream source does, so an `xc` channel's timeshift start is written in the panel's zone and its `.ts`/`.m3u8` forms follow the account.
- **A failed login never fails the refresh:** refused, an error status, not JSON, no `user_info`, a broken answer, or longer than 10 s (`PANEL_LOGIN_MS`; its request is then dropped, and an answer after it is cancelled unread). The source then keeps the facts of its last login, and UTC without one. A cancel during the login stops the refresh before the playlist is asked for.
- **The playlist's own guide:** a guide the playlist's header names that is a panel's `xmltv.php` with a login is read in the source's panel zone (`epgGuides`), as an Xtream source's own guide is. Every other guide a playlist names stays UTC. The shown times then match what aired, and catch-up asks for them.
- **The offset:** with +1:00 on the playlist's guide, "From the start" asks the archive for the shown start, an hour after the mock's own programme, as decided in 24b. The e2e confirms it against the mock (`guide-catchup-m3u.spec.ts`).
- The other M3U modes (`default`, `append`, `shift`, `flussonic`) write epoch times, so no zone applies to them. `test/catchup-m3u-mock.test.ts` checks every mode's request from the stored items against the mock in UTC and Riyadh panels, both `output` forms, and with a failed login (an `xc` start then three hours early on a Riyadh panel).

**Applied in step 25d (2026-11-05):**
- **A seek by URL** asks the archive for the programme from the new start, rounded to the whole minute, to the programme's end (`catchupRequest`'s `fromMs`): Xtream's `/timeshift/` URL with the minutes left, the start as wall time in the panel's zone as before; each M3U mode's template filled from the new start. Its times are the shown ones, so the offset and tvg-shift still apply. The e2e checks the new start against the mock (`guide-catchup-seek.spec.ts`).
- **Playing on** past a programme (a `shift` or `timeshift_abs` stream) shows the programme aired then, read from the stored guide at that time (`DataEngine.nowNext`), shifted as the guide shows it.

## Consequences
- On engines with zone data, Xtream catch-up is exact across DST. Without it, DST zones are an hour off for archive programmes across a DST change, and the diagnostics screen (step 40) should show the zone source (`intl`/`clock`/`utc`).
- The time offset per guide (step 24b) also lets users fix a panel whose zone is simply wrong.
- Tests: `packages/core/src/{timezone,catchup}.test.ts` (goldens), and `test/core-mock.test.ts`, which checks every mode against the mock's `X-Mock-Archive-*` headers in UTC, +05:45, +03:00 and New York (DST) panels.
