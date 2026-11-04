# Runbook: the Zoma Lab (hardware spikes)

The Zoma Lab is a separate TV build that answers the hardware spikes of [architecture.md §5](../architecture.md#5-hardware-spikes-weeks-12-the-four-must-own-tvs-are-needed-on-day-1) on a real TV, in an emulator, in the old-engine harness and in the desktop browser. Every result goes to the **LAN log collector** of the mock provider on this PC. Claude can't see the TV, so this is how results come back.

- **Built in step 15a:** the build, the runner and the runtime spikes S0, S1, S2, S3 and S7.
- **Built in step 15b:** S6, scale (below).
- **Built in step 15b2:** S9, Arabic, and S11, lifecycle and accessibility (below).
- **Built in step 15b3:** S10, input: the remote's keys, the pointer and the TV's keyboard (below).
- **Built in step 15c:** S5, the `<video>` battery (below).
- **Built in step 15c2:** the AVPlay batteries S4 and S8, and S5's luna track route (below).
- **Setting up the TVs and emulators:** [tv-setup.md](tv-setup.md) (step 15d). Samsung options without a Samsung TV: [testing-without-tvs.md](../testing-without-tvs.md).

## Quick start (a TV on the LAN)

1. **Start the collector** on this PC: `pnpm mock`. It listens on `0.0.0.0:8080` and prints the addresses a TV can use. Windows may ask once to let Node through the firewall: allow it on private networks. Run `pnpm mock:media` once before, or the player batteries (S4, S5, S8) have nothing to play and skip.
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
- **S5 answers for this browser's codecs:** no MPEG-TS, no AC3, and HEVC only where the GPU decodes it (see S5). Against `pnpm mock` without `pnpm mock:media` it plays nothing and skips.

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

## S9: Arabic (step 15b2)

The app bundles its fonts (Zoma Sans), isolates the text it puts into sentences (core's `isolateText`) and formats dates and numbers without `Intl` (ADR-011). S9 checks those choices on the TV.

| Check | What it does | Pass |
|---|---|---|
| `fonts` | Asks `document.fonts` for both weights of the Latin and the Arabic Zoma Sans faces, then reads every face's status. | all four `loaded` |
| `shaping` | Draws `مسلسلات` and `لا` in Zoma Sans at 48 px, joined and with a zero-width non-joiner between their letters. Joined Arabic is narrower: the letters lose their tails, and lam-alef becomes one glyph. Fails when the Arabic face isn't loaded, since then a fallback font was measured. | the word under 95 % of its letters apart, lam-alef under 90 % |
| `bidi` | The old-engine harness's bidi probe: a Latin name ending in a digit before a count (`MBC 1 · 240 قناة`), and a name starting with a digit (`1 Zoma قناة`), in a right-to-left line, isolated by `isolateText` and not (the controls). The isolation must keep each name in one piece, and draw nothing. | both lines isolated, both controls showing the problem |
| `intl` | For `ar-SA`, `ar-AE`, `ar` and `en-US`: the calendar and digits `Intl` picks, its date, time and number, the app's own, and whether they match (`sameAsIntl`). Also `Intl.PluralRules` and the time zone. | `info` |

- The notes show the Arabic words, so a person in front of the TV sees them drawn: they must join, and read right to left.
- Desktop Chromium (2026-11-04): `مسلسلات` 197.6 px joined against 268.9 px apart, `لا` 28.8 against 44.8. `Intl` there gives ar-SA the Gregorian calendar with Arabic-Indic digits, and ar-AE and ar Western digits; the app writes Western digits for all of them.
- In the old-engine harness (Chromium 53, 56, 68, 2026-11-04): fonts, shaping and bidi pass on all three; `مسلسلات` 198 px against 261 apart, `لا` 28 against 44. `Intl` gives every Arabic tag Arabic-Indic digits, ar-AE included, and ar-SA the Gregorian calendar on 53 and 56 but the Hijri one (islamic-umalqura) on 68. S9 records what each TV's ICU does.

## S10: input (step 15b3)

The app turns each remote key into an Intent through its platform adapter (`Platform.keyToIntent`). On Tizen only the arrows, Enter and Back arrive unless the app registers each other key (`Platform.registerKeys`). A text field hands DOM focus to a native `<input>`, which should open the TV's own keyboard (`TextField`, `createTextEditor`, architecture.md §1.2). S10 checks both on the TV.

| Check | What it does | Pass |
|---|---|---|
| `registration` | What `Platform.registerKeys()` did when the lab started. On Tizen: the keys the TV lists (`tvinputdevice.getSupportedKeys()`, names and codes), the keys registered, the app's keys the TV doesn't list, and any it refused. webOS and a desktop browser deliver every key. | Tizen `pass` when the TV refused nothing (the note names the keys it lacks); webOS `info` |
| `keys` | **By hand** (below): the key tester. A box for each of the 29 Intents lights up with its key code when its key comes. Keys the adapter has no Intent for are listed with their codes and `key` names. The record has each distinct key (code, `key`, Intent, count), the codes per Intent and the missing Intents. | `pass` when a key came for every Intent; `fail` names the missing ones |
| `pointer` | Measured while the key tester is open: the system's pointer shown and hidden events (webOS `cursorStateChange`), real moves, clicks and wheel turns. | `pass` when the pointer moved and clicked; `info` otherwise; `skip` without a pointer |
| `keyboard` | **By hand**: the app's own text field. OK gives its input DOM focus, which should open the TV's keyboard. Type Arabic and English, press the keyboard's Done key, then answer. The record has the text, which scripts it has letters of, how each edit ended (`done`, `close`, `up`, `down`) with the keys the field saw, and webOS's `keyboardStateChange` events. Tizen's Done and Cancel are expected as 65376 and 65385 (Samsung's guide, never checked on a TV). | GREEN with Arabic and Latin letters typed: `pass`; GREEN without one of them, or RED: `fail` |

- **The key tester takes every key.** None moves the focus or leaves the lab, so Back is a key under test too: Back twice in a row ends the tester, and so does 5 minutes without that.
- **webOS has no PRE-CH Intent yet** (`WEBOS_KEYS`). Whatever LG's remote sends for it shows under "Keys with no action", as does any key the adapters don't know.
- **The fallbacks** (architecture.md §5): a key that never comes needs another way to its action in the app; a keyboard that won't open, or won't type Arabic, means an on-screen keyboard of our own (+2 sessions).
- **Desktop Chromium** (e2e, 2026-11-04): every Intent's key came, `q` (81) as a key with no action, two pointer moves, a click and a wheel turn, and the field typed `زوما Zoma` and ended with Enter (`done`), then a second edit closed with Escape (`close`, the text kept).

### S10 by hand (step 16)

The key tester and the keyboard test run only when a person starts S10 from its row. "Run all" and the run at launch skip them.

1. On the lab, go to S10 and press OK. The key tester opens.
2. Press each key on the remote once: the arrows, OK, the numbers 0 to 9, CH + and CH −, the four colours, play/pause, stop, forward, rewind, info, guide, PRE-CH (or the remote's "previous channel" key) and Back. Each box lights up with its code.
3. Then press the keys that have no box, except Home and the settings key, which may leave the lab. Note what "Keys with no action" lists.
4. With a Magic Remote (LG): move the pointer, click somewhere on the screen and turn the wheel. The pointer line counts each.
5. Press Back twice in a row. The keyboard test opens.
6. Press OK on the field. The TV's keyboard should open. Type زوما, switch the keyboard to English, type Zoma, then press the keyboard's Done key. The lines under the field show how the edit ended and the keys the field saw.
7. Press GREEN if both words were typed, RED if the keyboard didn't open or couldn't type one of them, or Back to skip.
8. S10 shows its result. `keys` names any key that never came, and the collector has every code.

Samsung's Smart Remote has no number or colour buttons; its 123 (or colour) button opens an on-screen pad. Note which keys came that way.

## S11: lifecycle and accessibility (step 15b2)

| Check | What it does | On a TV |
|---|---|---|
| `lifecycle` | The lifecycle events since the lab started (`Platform.onLifecycle`): hidden, visible, relaunch, with the time away and the heartbeats (one a second) that ran meanwhile. Each event also goes to the collector the moment it happens, as an `event` record. | `info` |
| `screensaver` | `Platform.setScreenSaver(false)`: Tizen's `webapis.appcommon.setScreenSaver`. The lab then keeps it off while it's open. webOS has no API for this: LG's guide says full-screen video keeps the screensaver away. | Tizen `pass`; webOS `info` |
| `screen-reader` | `Platform.screenReader()`: Tizen's Voice Guide setting (`webapis.tvinfo.getMenuValue(VOICE_GUIDE_KEY)`), webOS's Audio Guidance (`settingsservice` `getSystemSettings`, `option`/`audioGuidance`). | `info`: on, off, or why unknown |
| `speech` | `Platform.speak("Zoma Lab, spike S11")`: webOS's `com.webos.service.tts` luna service (LG's Enact uses it; LG's TV docs don't list it). Tizen has no speech API for web apps. | webOS `pass` if the TV takes it (listen); Tizen `info` |
| `focus-reading` | **By ear** (below): three buttons with an `aria-label` each, DOM focus following the remote. Does the screen reader read each one? | GREEN `pass`, RED `fail` |
| `live-reading` | **By ear**: the same buttons without DOM focus; an `aria-live` region says the focused one's name instead. | GREEN `pass`, RED `fail` |

- **The app's focus is the focus engine's, not the DOM's:** nothing on the app's screens has DOM focus today, so a screen reader has nothing to read. S11 tells which of the two ways a TV reads. If neither works, the plan's fallback is `Platform.speak()` on each focus change (architecture.md §5).
- **The lab's webOS manifest** sets `accessibility.supportsAudioGuidance`, without which Audio Guidance reads nothing of an app. The app's doesn't yet: it waits for S11's answer. Samsung asks for an element with focus at launch, or Voice Guide "behaves unexpectedly"; the lab has none until a question opens.

### S11 by ear (step 16)

The two questions run only when a person starts S11 from its row. "Run all" and the run at launch skip them, since nobody may be watching.

1. Turn on Voice Guide (Samsung) or Audio Guidance (LG) in the TV's accessibility settings.
2. On the lab, go to S11 and press OK.
3. The first question shows three buttons. Move left and right. Each button's name should be read. Press GREEN if it was, RED if not, Back to skip.
4. The second question shows the same buttons, now without DOM focus. Answer it the same way.
5. Also listen for "Zoma Lab, spike S11" while S11 starts: that is `speech` (webOS).
6. For the lifecycle log: press Home, wait about 30 seconds, go back to the lab (or launch it again), then run S11 alone. `lifecycle` lists the trips, and the collector has them as `event` records. A visible after a hidden shows the time away and the heartbeats in it. No heartbeats means the TV paused the lab's scripts (Samsung says Tizen does).
7. For the screensaver (Tizen): leave the TV untouched for longer than its screensaver delay while the lab is open. No screensaver should come.

## S5: the `<video>` battery (step 15c)

The player batteries ask each player the questions of architecture.md §5's S4 and S5 rows. The checks are written once (`battery.ts`) against a small player interface (`LabPlayer`, `player.ts`). S5 runs them on a `<video>` element (`video-player.ts`), the player webOS uses for everything, Tizen falls back to for HLS, and the desktop dev loop plays through. S4 runs the same checks on AVPlay (below). While a check plays, its picture shows in a box at the bottom right, with a caption naming the row.

The media comes from the lab server (`/__lab/media`, docs/runbooks/mock-provider.md). The URLs carry the mock's test account, so no record holds one. Without generated media (`pnpm mock:media`) the mock sends placeholder bytes, and every playback check skips with the reason.

| Check | What it does | Pass (architecture.md §5) |
|---|---|---|
| `formats` | Fetches the media list, and records what the engine says it plays (`canPlayType` for TS, HLS, H.264, HEVC, MKV, WebM, AC3, E-AC3, MP3; `MediaSource.isTypeSupported`) and which APIs it has (`audioTracks`, `textTracks`, frame counters). | `info` |
| `ts` | Live channel 104 as MPEG-TS: the time from setting the source to the first frame. A frame counts once the picture has a size and the clock moved after `playing`, checked every 50 ms, so sound without a picture never counts. | < 2.5 s (< 4 s on the low tier) |
| `hls` | The same channel as live HLS. | < 4 s |
| `redirect` | The live channel through three 302s (`mock_fault=redirect:hops=3`), in TS if `ts` played, else HLS. | it plays (redirects followed natively) |
| `hevc-4k` | Movie 205, 4K HEVC. | 3840×2160 frames (2020+ TVs only) |
| `audio-tracks` | Movie 206 (MKV: AAC ara, eng, spa, then AC3 and E-AC3 5.1): the tracks the engine lists, 2 s of play, and a switch to the second one, timed until it is the only one enabled and playback moved on 200 ms. The clock going back over 1 s, or the engine reloading the stream, is a restart. If that route fails or is missing, webOS's luna route (below) on the file opened again. The record's `route` says which worked (`audioTracks`, `luna`, AVPlay's `setSelectTrack`, or null). Whether the sound changed is for the ear. | < 2 s, no restart |
| `ac3` | The same file: the AC3 and the E-AC3 track each chosen and played for 2 s (through the luna route by their place in the file where the engine lists no tracks). An engine that lists fewer than the file's five tracks drops the ones it can't decode. | both play on |
| `subtitles` | Episodes 3001 (SRT in MKV) and 3011 (mov_text in MP4): the in-band text tracks the engine lists, the first one shown, and its first cue (one every 5 s). | both files give a cue |
| `suspend` | **A person** (below): the live channel plays, then Home and back. On hide the player stops (the webOS policy, architecture.md §2); on show it reopens at the live edge. | playing again < 5 s |
| `soak` | **A person starts it**: the live TS with a stall after every 600 KB of each response (about every 18 s of play) for `soak` minutes (60 by default). A watchdog reopens the stream after 6 s without progress, again every 6 s until a frame comes, as the app's PlayerController will. An engine without TS (a desktop browser) soaks on VOD file 3011 with a stall every 1 MB, reopened where it stopped. | every stall back to a picture < 10 s |

- **The lab's watchdog is not the app's.** It reopens the same URL; the app's retry ladder (redirect probe, container switch, backoff) is step 17. The soak shows whether this engine recovers from a stalled stream at all, and how fast.
- **The luna route (webOS, step 15c2).** Where `audioTracks` is missing or its switch fails, the battery asks luna `com.webos.media/selectTrack` with the element's `mediaId` (`{ mediaId, type: 'audio', index }`, `webosSelectTrack` in platform-webos), on the file opened again so the first try's track can't pass for luna's. The switch counts once luna accepted and playback moved on; luna gives no list to read back, so whether the language changed is for the ear. Only the webOS build has the route (`pnpm build:tv` fails if `com.webos.media` shows up in a Tizen bundle); the desktop has no `mediaId`.
- **Sound before a key press:** a desktop browser may refuse to play with sound when nobody pressed a key (a run at launch). The player then plays muted and the record says `muted: true`. TVs don't refuse.
- **Desktop Chromium 156** (headless, `pnpm lab:media`, 2026-11-04):
  - no MPEG-TS (an error after about 3 s) and no AC3 or E-AC3: it lists 3 of the MKV's 5 audio tracks;
  - HLS first frame in 150–210 ms; through the 302s in 150–360 ms;
  - HEVC: the sound plays, the picture doesn't (headless; a headed window decodes it on this PC's GPU);
  - the switch to the English track in 265–370 ms, no restart;
  - no in-band text tracks in either file;
  - Home and back in about 55 ms; the soak (1 min on the VOD stand-in): 2 stalls, each back in about 6.1 s (the watchdog's 6 s plus the reopen).
- **`audioTracks` in desktop Chromium** is behind a Blink flag (`--enable-blink-features=AudioVideoTracks`); `pnpm lab:media` turns it on. Without it, `audio-tracks` fails ("no audioTracks API") and `ac3` skips.

### S5 by hand (step 16)

1. Run `pnpm mock:media` once (about 30 s), then `pnpm mock`. Its start line must say `Media: files`.
2. On the lab, go to S5 and press OK. The rows play one after another in the box at the bottom right. Listen during `audio-tracks`: the sound should change from the Arabic track to the English one. Listen during `ac3`: a 5.1 tone per channel.
3. When the caption says "press Home…", press Home, wait a few seconds, and open the Zoma Lab again from the launcher.
4. The soak follows: 60 minutes, with a stall every 18 seconds or so. Leave the TV alone. (On a TV it is always 60 minutes; in a browser, `&soak=` in the URL shortens it.)
5. S5 shows its result; the collector has every row.

## S4: the AVPlay battery (step 15c2)

S4 asks Samsung's native player, AVPlay, the same questions as S5 (`batteryChecks('S4', …)`), plus one row of its own. The AVPlay player (`avplay-player.ts`) implements `LabPlayer` on platform-tizen's typed AVPlay (`packages/platform-tizen/src/avplay.ts`: `tizenAvplay()`, `avplayTracks()`, `avplayErrorText()`); the lab never touches `webapis` itself. Only the Tizen build reaches it (`avplay-deps.ts`, behind `__PLATFORM__ === 'tizen'`), and `pnpm build:tv` fails if `application/avplayer` or `getTotalTrackInfo` shows up in a webOS bundle.

How AVPlay answers the battery:
- **Open:** `open`, `setListener`, `setDisplayRect`, `prepareAsync`, then `play`. A prepare that never answers is AVPlay's 302 freeze: the row's 10 s wait runs out with "no answer".
- **First frame:** AVPlay paints on the TV's video plane, which the page can't read, so a frame is the clock moving while `PLAYING`: two readings of `getCurrentTime()` 50 ms apart (or two `oncurrentplaytime` calls) that differ. The size is the video stream's `Width` and `Height` from `getCurrentStreamInfo()`.
- **No `canPlayType`:** AVPlay says what it can't play by failing. `PLAYER_ERROR_NOT_SUPPORTED_FILE`, `_FORMAT`, `_AUDIO_CODEC` and `_VIDEO_CODEC` count as `unsupported`.
- **Tracks:** `getTotalTrackInfo()` (AUDIO, TEXT, with `extra_info` read), the selection from `getCurrentStreamInfo()`, and `setSelectTrack(type, stream index)`. The record's `route` says `setSelectTrack`.
- **Subtitles:** `setSelectTrack('TEXT', …)` and `setSilentSubtitle(false)`; each `onsubtitlechange` text is a cue.
- **Home and back:** `suspend()` on hide, then `restore()` on show: no resume time for live (it means nothing there), the position for VOD (never 0). A refused `restore` fails the row at once ("coming back failed: …").
- **Stop:** `stop` and `close`, which ends the connection.
- **The picture:** AVPlay's `<object type="application/avplayer">` in the same box at the bottom right as S5's. While it shows, `<html>` gets `lab--avplay`, which makes the page and the box transparent (architecture.md §2, "AVPlay layering"): the lab's background turns black, its rows keep their colours.

| Check | What it does | Pass |
|---|---|---|
| S5's ten rows | as in S5 above, on AVPlay | as in S5 |
| `redirect-probe` | The redirect probe first (`http.ts`): an XHR GET that follows the 302s and is aborted when the final answer's headers come (`readyState` 2), so no body is downloaded; then AVPlay opens `responseURL`. The note compares it with `redirect`, the same stream without the probe ("without the probe it froze"). No URL is recorded. | it plays |

- **The audio switch waits 2 s first** (both batteries): AVPlay sends no event when a switch starts the stream over, so the file plays 2 s and a restart shows as the clock going back.
- **Without AVPlay** (the desktop, a webOS TV, the Tizen bundle in a desktop engine, the old-engine harness) every row skips: "no webapis.avplay here (a Samsung TV has it)" in the Tizen bundle, "no AVPlay: this is not the Tizen build" elsewhere.
- **Unit tests** run the whole battery on a fake AVPlay (`fakes.ts`: its state machine, callbacks on a fake clock, streams as `extra_info` JSON) in `spikes/s4.test.ts`, including the 302 freeze, the probe, `setSelectTrack`, cues, suspend/restore and a soak.

### S4 by hand (step 16)

1. As for S5: `pnpm mock:media` once, then `pnpm mock` (`Media: files`).
2. On the Samsung TV, go to S4 and press OK. The rows play in the box at the bottom right; the rest of the screen is black while they do.
3. Listen during `audio-tracks` (Arabic to English) and `ac3` (a 5.1 tone per channel). During `subtitles` no text shows on the TV (the lab only records the callback's text).
4. When the caption says "press Home…", press Home, wait a few seconds, and open the Zoma Lab again.
5. The soak follows (60 minutes). Then S4 shows its result.

## S8: AVPlay pre-buffering (step 15c2)

Investigational: can a second AVPlay instance (`webapis.avplaystore.getPlayer()`, up to four) prepare the next channel while one plays, and how fast is the switch to it? Pre-buffered zapping (v1.2) ships only if it passes and the provider allows two connections (the mock's test account allows two).

| Check | What it does | Pass |
|---|---|---|
| `store` | Fetches the media list; two players from `avplaystore.getPlayer()`, each described. | both created |
| `prebuffer` | Both `prepareAsync` the live TS at once, without playing. | both prepared within 10 s |
| `switch` | One plays the live TS, the other prepares it; the switch stops the first and plays the second, timed to its first frame. Three times, each time preparing the stopped one again. | each ≤ 700 ms on a 2020+ TV; older TVs: `info` |

- Without `avplaystore` (the desktop, a webOS TV, older Samsungs) every row skips. `prebuffer` and `switch` skip on placeholder bytes.
- Unit tests: `spikes/s8.test.ts` on two fake AVPlay instances.

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
- **Each lifecycle event** (S11) gives one `event` record when it happens, between the others: `check: "lifecycle"`, the event in `note`, and in `value` its time since the start, the visibility, and on a return the time away and the heartbeats.
- **Sending:** in order, at most 50 records per request. A failed request is retried after 1, 2, 4… s (at most 30 s), and nothing is dropped, so the collector can be started after the lab.

## The lab server's probes

The lab needs no test account: the mock answers it on `/__lab/` (docs/runbooks/mock-provider.md, "Lab probes"):
- `/__lab/bytes?lines=N`: numbered UTF-8 lines with Arabic, a 3-byte and a 4-byte character, cut into 1,009-byte chunks;
- `/__lab/echo?cors=0`: a small JSON answer, with or without CORS headers;
- `/__lab/redirect?to=/__lab/…`: a 302 to another `/__lab/` path;
- `/__lab/source`: S6's source (an M3U of the test account, a guide moved to the TV's days);
- `/__lab/media`: the player batteries' media URLs, with what each file holds.

## Where else the lab runs

- **e2e** (`e2e/lab.spec.ts`):
  - the dev page by keys, every record checked in the collector (S6 against the mock's small catalog, S9's faces, widths and the app's own formats);
  - S10 alone by keys: every Intent's key and one with no action, the pointer, Back twice, then the keyboard test typing `زوما Zoma` and answering GREEN;
  - S11 alone by keys: a hidden-and-back trip logged as `event` records, both questions answered (DOM focus on the labelled button, then the live region saying the focused name);
  - an "update" from 0.1.0 to 0.1.1 (S2); the collector down, then up;
  - both TV bundles from `file://`.

  `pnpm e2e`'s mock sends placeholder bytes, so S5 describes the engine there and skips the rest. S4 and S8 skip every row with the reason (no AVPlay in a desktop engine; the Tizen bundle finds no `webapis`).

  S6 at scale: `pnpm lab:scale` (`e2e/lab-scale.spec.ts`, its own Playwright project, never part of `pnpm e2e`).

  S5 on the generated media: `pnpm lab:media` (`e2e/lab-media.spec.ts`, its own Playwright project, part of `pnpm verify:media` and CI job `media`). S5 alone by keys (a hidden-and-back trip for `suspend`, a 1-minute soak) and a run at launch; every row's status and value checked.
- **The old-engine harness** (`pnpm verify:engines`, docs/runbooks/old-engines.md): both lab bundles in Chromium 53, 56 and 68, reporting to a mock started on the host through `host.docker.internal`.
  - S1 and S9 must pass on every engine; S6 runs its checks against the host mock's small catalog (all `info`); S10 and S11 find no TV APIs (Tizen's key registration and screensaver checks fail, webOS's are `info`) and skip everything that needs a person.
  - S5: the host mock runs with `--no-media`, and these Chromium builds have no H.264 either, so `formats` records the engine and every playback check skips. S4 and S8 skip every row (no AVPlay). The batteries' first old-engine runs are a TV's (step 16).
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
