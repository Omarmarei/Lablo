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

**XMLTV times without an offset** (the `timezone` fault's `none` style) are read in a fallback zone: the source's time offset (step 24), or the panel zone for an Xtream guide. In a DST zone the repeated hour is ambiguous. Step 9 repairs it from per-channel ordering (a start before the previous stop moves forward an hour).

**Amended in step 9 (2026-11-02):**
- `parseXmltvTime` alone does not always take the earlier instant. It settles the offset from the wall time read as UTC, so it gives the earlier instant west of UTC (New York) and the later one east of it (London). `EpgGuideReader` therefore first settles every offset-less time in the repeated hour to the earlier instant, then repairs from ordering:
  - a start before the channel's previous stop moves forward an hour;
  - so does a stop that would end before its start, or the stop of a programme whose start moved.
- **Limit:** a lone boundary in the repeated hour reads the same with either instant. An example is a 90-minute programme ending at the second 01:00 with the next one starting there. It is taken as the earlier instant, an hour early. `test/epg-mock.test.ts` checks that only that case stays off in a New York guide written without offsets, and `epg-guide.test.ts` checks the repair for London and New York.
- An offset stated in the guide is never repaired, and neither is a fixed fallback zone, which has no repeated hour.

## Consequences
- On engines with zone data, Xtream catch-up is exact across DST. Without it, DST zones are an hour off for archive programmes across a DST change, and the diagnostics screen (step 40) should show the zone source (`intl`/`clock`/`utc`).
- The per-source time offset (step 24) also lets users fix a panel whose zone is simply wrong.
- Tests: `packages/core/src/{timezone,catchup}.test.ts` (goldens), and `test/core-mock.test.ts`, which checks every mode against the mock's `X-Mock-Archive-*` headers in UTC, +05:45, +03:00 and New York (DST) panels.
