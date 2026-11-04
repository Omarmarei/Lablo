# Runbook: the Zoma Lab (hardware spikes)

The Zoma Lab is a separate TV build that answers the hardware spikes of [architecture.md §5](../architecture.md#5-hardware-spikes-weeks-12-the-four-must-own-tvs-are-needed-on-day-1) on a real TV, in an emulator, in the old-engine harness and in the desktop browser. Every result goes to the **LAN log collector** of the mock provider on this PC. Claude can't see the TV, so this is how results come back.

- **Built in step 15a:** the build, the runner and the runtime spikes S0, S1, S2, S3 and S7.
- **Coming:** S6 and S9–S11 (step 15b), then the player batteries S4, S5 and S8 (step 15c).
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

- **e2e** (`e2e/lab.spec.ts`): the dev page by keys, every record checked in the collector; an "update" from 0.1.0 to 0.1.1 (S2); the collector down, then up; both TV bundles from `file://`.
- **The old-engine harness** (`pnpm verify:engines`, docs/runbooks/old-engines.md): both lab bundles in Chromium 53, 56 and 68, reporting to a mock started on the host through `host.docker.internal`.
  - S1 must pass on every engine.
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
