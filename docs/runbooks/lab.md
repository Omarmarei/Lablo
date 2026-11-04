# Runbook: the Zoma Lab (hardware spikes)

The Zoma Lab is a separate TV build that answers the hardware spikes of [architecture.md §5](../architecture.md#5-hardware-spikes-weeks-12-the-four-must-own-tvs-are-needed-on-day-1) on a real TV, in an emulator, in the old-engine harness and in the desktop browser. Every result goes to the **LAN log collector** of the mock provider on this PC. Claude can't see the TV, so this is how results come back.

- **Built in step 15a:** the build, the runner and the runtime spikes S0, S1, S2, S3 and S7.
- **Built in step 15b:** S6, scale (below).
- **Coming:** S9–S11 (step 15b2), then the player batteries S4, S5 and S8 (step 15c).
- **Setting up the TVs and emulators:** `docs/runbooks/tv-setup.md` (step 15d).

## Quick start (a TV on the LAN)

1. **Start the collector** on this PC: `pnpm mock`. It listens on `0.0.0.0:8080` and prints the addresses a TV can use. Windows may ask once to let Node through the firewall: allow it on private networks.
2. **Build:** `pnpm build:tv`. It builds the app and the lab. The lab goes to `dist/tv-lab/{tizen,webos}`, with the webOS package at `dist/packages/com.zoma.iptv.lab_<version>_all.ipk`. The build prints the address the lab will report to (`Zoma Lab 0.1.0: results to http://192.168.1.3:8080`): this PC's first private IPv4 address.
3. **Install and launch:**
   - webOS: `pnpm device install webos tv --lab`, then `pnpm device launch webos tv --lab`;
   - Tizen: the same with `tizen <serial>` once the Tizen CLI and a certificate exist.
   
   The lab runs every spike at launch. Nobody needs to press anything.
4. **Read the results:** `artifacts/lab-logs/<session>.ndjson`, or `GET http://<pc>:8080/__lab/logs` (sessions, newest first) and `GET /__lab/logs/<session>`. On the TV, the screen shows each spike's status, and OK on a spike shows its checks.

The lab has its own app id (`com.zoma.iptv.lab` on webOS, `ZomaLab001.ZomaLab` on Tizen). Installing it never touches the app or the app's data.

## Build options

| Option | Effect |
|---|---|
| `--lab-server http://host:port` | Where the TV sends its results. Default: this PC's LAN address, port 8080. Use it when the PC has several networks (VPN, Docker) and the default guessed wrong. |
| `--lab-version x.y.z` | The lab's version, which defaults to the app's. Raise it to install a newer lab over an older one (S2). |
| `--lab-write-mb N` | S2's write test, 200 MB by default (S2's pass criterion). |
| `--lab-no-auto` | Waits for "Run all" instead of running at launch. |
| `--target app` / `--target lab` | Builds only one of them. The default builds both. |

The settings land in `dist/tv-lab/<platform>/lab-config.js` (`window.ZOMA_LAB_CONFIG`). Where the page has a URL of its own (`pnpm dev`, the e2e tests, the harness), URL parameters override them: `?server=http://127.0.0.1:8080&mb=16&auto=1`.

## In the desktop browser

Run `pnpm mock` and `pnpm dev`, then open `http://localhost:5173/lab.html?server=http://127.0.0.1:8080`. Press Enter on "Run all", or add `&auto=1`. The keys are the app's (arrows, Enter, Escape for Back).

A desktop browser gives different answers from a TV, on purpose:
- **S7's three no-CORS checks fail.** The browser enforces CORS; a packaged TV app is expected not to.
- **S3 is "skip".** A browser has no device ID.
- **In a TV bundle opened from `file://`, S3's device-id check fails.** The adapter finds no TV APIs there.

## The spikes in step 15a

Each check ends as one record: `pass`/`fail` against its criterion, `info` for a measurement that step 16 judges, `skip` when it doesn't apply.

| Spike | Checks | What a TV should answer |
|---|---|---|
| S0 Device | `device`: model, OS, firmware, Chromium, tier, screen, cores, memory, languages, time zone | info |
| S1 Runtime | `boot`, `polyfills` (what works, and what the engine lacked before the bundle: `native-probe.js` runs first), `apis` (which web APIs and CSS features exist), `preact`, `blob-worker`, `text-decoder` (every split of multi-byte text), `fetch-stream` and `fetch-stream-worker` (`response.body` read in pieces, 600 KB from `/__lab/bytes`), `idb`, `idb-bulk-worker` (10,000 items in 500-item transactions, as the ingest writes) | all pass. A fail here is a blocker (architecture.md §5 lists the fallbacks) |
| S2 Storage | `local-storage` and `indexeddb` (a marker from the last run), `quota`, `write-test` (200 MB of incompressible 1 MB records, then deleted) | pass after an update (below); write-test pass |
| S3 Device IDs | `device-id` (DUID or LGUDID through the adapter; only a hash and the format are sent), `stable` (the same hash as the marker of the last run) | pass |
| S7 Cross-origin | XHR and fetch to the lab server with and without CORS headers; a 302 followed with `responseURL` / `response.url` | all pass (if not, webOS needs the luna relay) |

### S2: does storage survive an update?

1. Build and install the lab at one version: `pnpm build:tv --target lab --lab-version 0.1.0`, then install and launch. The first run finds no marker ("info").
2. Build a higher version: `pnpm build:tv --target lab --lab-version 0.1.1`, then install it over the first. Don't uninstall in between.
3. Launch it. `local-storage` and `indexeddb` now say "survived an update from 0.1.0 to 0.1.1" (pass), or "no marker" if the update wiped them.

A developer reinstall may behave differently from a store update. Repeat S2 after the first real store update (architecture.md §5).

### S3: is the ID stable across reinstalls?

Run the lab, **uninstall** it, install it again and run it. An uninstall wipes the lab's storage, so `stable` can't compare on the TV. Compare the `device-id` hash of the two sessions in `artifacts/lab-logs` instead: it must be the same. The raw ID never leaves the TV.

## S6: scale (step 15b)

S6 runs last, since on a TV it takes minutes. It uses the app's own data engine (its real query, ingest and EPG workers, inlined in the lab bundle as in the app) and the app's live screen, mounted over the lab screen while S6 presses keys on it.

| Check | What it does | Pass (architecture.md §5) |
|---|---|---|
| `source` | Asks the lab server for a source (`/__lab/source`, docs/runbooks/mock-provider.md): an M3U of the mock's test account and a guide moved to this TV's days. Only counts and sizes go into the record, never the URLs. | `pass` with the scale fixtures, `info` otherwise |
| `ingest` | Stores the source as S6's own source (`lab-s6`) and ingests the M3U through the data engine, in the TV's tier. | ≤ 90 s, no crash |
| `search` | Six searches through the app's search path: `zoma`, `sport`, `زوما`, `night`, `ki`, `الليل`. | each ≤ 200 ms |
| `keys` | Shows the live screen on the stored catalog, starts a refresh of the source, and while it runs presses 35 keys at a viewer's pace (down the list, CH− page by page, to the rail, OK on a category, back into the list). Each press is timed from the key to the end of the first frame that draws the new focus. The refresh is then cancelled. | each < 200 ms, all during the refresh |
| `guide` | The guide's filtered ingest through the data engine (only the stored live channels' programmes, in the tier's window). | ≤ 4 min, programmes kept |
| `cold-start` | This launch's boot (the page to the lab's script, the part a bundle's parse takes) plus a fresh data engine (no workers running) to the live screen's painted rows, as the app starts with a source stored. Also records when the screen went idle (its 600 ms focus wait included). | ≤ 3 s |
| `cleanup` | Deletes the lab's copy of the app database (`zoma`), so the TV's storage is free again for S2. | `info` (housekeeping) |

- **Judged only at scale:** the criteria are about 200,000 items and the 150 MB guide. Against the mock's own small catalog every check measures and reports `info` (that is what e2e and the old-engine harness see). For a judged run on a TV, start the mock with the scale fixtures:

  ```
  pnpm fixtures
  pnpm mock --catalog .cache/fixtures/catalog.json --xmltv .cache/fixtures/xmltv-150mb.xml.gz
  ```
- **Never over the app's data:** under `pnpm dev` the lab page shares the dev app's origin and its database. If S6 finds a source there that isn't its own, it skips (every check, cleanup included) and deletes nothing. Open the lab on another origin instead, a second dev server on another port: `pnpm --filter @zoma/app-tv exec vite --port 5174`, then `http://localhost:5174/lab.html?server=http://127.0.0.1:8080`. On a TV the lab has its own storage.
- **In the desktop browser at scale:** `pnpm lab:scale` (after `pnpm fixtures`) runs S6 by the remote against an in-process mock with the scale fixtures, requires every check to pass, and writes `artifacts/lab-scale.json`. On this PC (2026-11-04, desktop Chromium, full tier):

  | Check | Result |
  |---|---|
  | ingest | 200,000 items in 1.9 s |
  | search | median 3 ms, slowest 6 ms |
  | keys | 35 presses, all during the refresh: median 11 ms, slowest 18 ms |
  | guide | 666,666 programmes kept for 7,079 of 20,000 channels in 5.2 s (148 MB, 10.5 MB gzipped) |
  | cold start | 194 ms: boot 109 ms, data to painted rows 85 ms (idle at 699 ms) |

  These are a smoke check of the lab at scale, not a TV's numbers: a 2018 TV is many times slower (step 16).

## Records

One NDJSON line per record, with `_received` added by the collector:

```json
{"type":"check","session":"webos-43UK6300PLB-20261104-023005-k3f9","seq":7,"at":"2026-11-04T02:30:07.120Z","spike":"S1","check":"blob-worker","status":"pass","value":{"startMs":41,"features":{"TextDecoder":true}},"note":"answered in 41 ms","ms":41}
```

- **Session:** platform, model, the TV's local time and four random characters. One session per launch.
- **The first record** is `start`: the lab version, the server, the write target, the device and the markers found.
- **Each check** gives one `check` record. A run ends with an `end` record: the counts per status and the run's time.
- **Sending:** in order, at most 50 records per request. A failed request is retried after 1, 2, 4… s (at most 30 s), and nothing is dropped, so the collector can be started after the lab.

## The lab server's probes

The lab needs no test account: the mock answers it on `/__lab/` (docs/runbooks/mock-provider.md, "Lab probes"):
- `/__lab/bytes?lines=N`: numbered UTF-8 lines with Arabic, a 3-byte and a 4-byte character, cut into 1,009-byte chunks;
- `/__lab/echo?cors=0`: a small JSON answer, with or without CORS headers;
- `/__lab/redirect?to=/__lab/…`: a 302 to another `/__lab/` path.

## Where else the lab runs

- **e2e** (`e2e/lab.spec.ts`): the dev page by keys, every record checked in the collector (S6 against the mock's small catalog); an "update" from 0.1.0 to 0.1.1 (S2); the collector down, then up; both TV bundles from `file://`. S6 at scale: `pnpm lab:scale` (`e2e/lab-scale.spec.ts`, its own Playwright project, never part of `pnpm e2e`).
- **The old-engine harness** (`pnpm verify:engines`, docs/runbooks/old-engines.md): both lab bundles in Chromium 53, 56 and 68, reporting to a mock started on the host through `host.docker.internal`.
  - S1 must pass on every engine; S6 runs its checks against the host mock's small catalog (all `info`).
  - The harness deletes the app's database before each lab run: the app's screens ran on the same `file://` origin first.
  - The polyfills the bundle filled must be exactly the built-ins that engine lacks.
  - Every record must reach the collector.
  - The self-test adds `lab-seed-no-worker`, which must fail.

## Troubleshooting

- **"Collector unreachable … retrying" on the TV:**
  - Check that `pnpm mock` runs and that the TV can reach the PC: the same network, and the firewall allowing Node.
  - The address the lab uses is on its screen ("Session … → http://…").
  - Rebuild with `--lab-server` if the address is wrong. The records wait on the TV while the lab stays open.
- **The lab shows "The lab could not start: …":** a bad `?server=` or `--lab-server` value. It must be `http://host:port`, with no path.
- **A boot error box instead of the lab:** the bundle failed on this engine. The text names the file, line and column. Report it with the session's model and firmware.
