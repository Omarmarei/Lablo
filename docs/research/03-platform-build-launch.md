> **Research snapshot 2026-11-01** (Tizen & webOS: build, publish, legal). Gathered by web-research agents; **[U]** = unverified / single-source / vendor claim. Re-verify anything load-bearing before relying on it.

# Lablo IPTV: building and publishing on Samsung Tizen and LG webOS (research as of 2026-11-01)

The biggest risk is store access, not engineering. A new Samsung seller can only publish in the United States until it signs a partner contract with Samsung. Both stores have pulled IPTV players before. Rightsholders in Spain and Italy have gone after neutral IPTV players through court orders and domain blocking. The engineering side is manageable if you lean on each TV's built-in media player and treat lists of 50k+ items as a data-engineering problem.

## Recommendations

1. **Minimum TVs to support:** Tizen 4.0 (2018 models, Chromium 56) and webOS 4.x (2018–19 models, Chromium 53). Compile the code down to what Chrome 53 can run (`chrome53` target with core-js polyfills) and ship classic scripts, not ES modules. The full-feature tier (bigger caches, richer animation, fallback players) starts at 2020: Tizen 5.5 (M69) and webOS 5 (Chromium 68). Skip 2015–2017 sets in v1. Samsung's current SDK no longer supports building for 2015–16 (Tizen 2.3/2.4), and webOS 3.x (Chromium 38) needs ES5, which makes modern frameworks very painful.
2. **UI framework:** Preact or React plus Norigin Spatial Navigation, with your own virtualized lists. Business logic goes in plain TypeScript packages that don't depend on any UI framework. Keep LightningJS/Blits as a fallback if profiling on 2018 low-end TVs fails.
3. **Video player:** use each platform's built-in player first. That means AVPlay on Tizen and the HTML5 `<video src>` element on webOS, which hands off to LG's built-in media player. Use hls.js or mpegts.js only as a fallback.
4. **Device ID:** Tizen `webapis.productinfo.getDuid()` and webOS LGUDID (after the user consents), hashed into a short code shown on screen.
5. **Backend:** device activation, a web portal reached by QR code, encrypted cloud storage of playlists, and an optional EPG service. **Never relay video streams through your servers.**
6. **Store order:** LG first (individual sellers allowed, global countries chosen at submission). Samsung US launch as a Public Seller, while you pursue a Samsung partner contract for EU and other markets.

---

## A. Platform and app model

### App types and packaging
- **Tizen web apps** are packaged as `.wgt` with a `config.xml`. **Tizen .NET** apps only run on 2018+ model groups ([distribution guide](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html)) and can't share code with webOS. Not recommended.
- **webOS web apps** are packaged as `.ipk` with an `appinfo.json`. They come in two forms ([web app types](https://webostv.developer.lge.com/develop/getting-started/web-app-types)):
  - *Packaged*: all code ships in the package.
  - *Hosted*: a local stub redirects to your server.
- Enact is LG's React-based framework with its Sandstone theme; webOS 25 pairs with Enact 4.9.5 / Sandstone 2.9.6 ([Enact guide](https://webostv.developer.lge.com/develop/guides/enyo-enact-guide)). Native webOS apps don't appear to be open to ordinary third parties. I did not verify this; plan for web only.

### Tooling
- **Samsung:**
  - Tizen Studio 6.1 with TV Extensions and the Samsung Certificate Extension. Certificate Extension versions older than 2.0.73 can't create certificates after September 2025.
  - There is also a VS Code extension, a CLI (`tizen`, `sdb`), a TV Emulator and a TV Simulator ([SDK install](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)).
  - Developer Mode on the TV: open the Apps panel, enter `12345`, set your PC's IP, reboot. Then `sdb connect <ip>` and `tizen install -n app.wgt -t <device>`.
- **Samsung signing:**
  - A Samsung certificate profile has an **author certificate** and a **distributor certificate**. The distributor certificate is tied to the DUIDs (device IDs) of your test TVs ([certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)).
  - **Back up `author.p12` forever.** Updates must be signed with the same author certificate. Developers report "Package corrupted… author certificate must be the same" rejections when it doesn't match.
- **LG:**
  - CLI is `npm i -g @webos-tools/cli`. Node 14.15–16.20 is recommended, and the older webOS TV CLI is deprecated ([CLI install](https://webostv.developer.lge.com/develop/tools/cli-installation)).
  - Main commands: `ares-setup-device`, `ares-package`, `ares-install`, `ares-launch`, `ares-inspect`.
  - **The emulator is gone from webOS 22 onward.** Use the version-specific Simulator, e.g. `ares-launch -s 24` ([emulator guide](https://webostv.developer.lge.com/develop/tools/emulator-dev-guide)).
  - Real TVs need the Developer Mode app, and the session expires unless extended. Community reports put it at 50 hours originally and ~1000 hours later; unverified.
  - LGUDID and DRM don't work in the emulator or simulator, so buy real TVs.

### Platform version matrix

Sources: [Samsung web engine specs](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html), [LG web engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine).

| Year | Tizen | Samsung engine | webOS | LG engine |
|---|---|---|---|---|
| 2015 | 2.3 | not listed | 2.x | WebKit 538 |
| 2016 | 2.4 | WebKit | 3.x | Chromium 38 |
| 2017 | 3.0 | M47 | 3.x | Chromium 38 |
| 2018 | 4.0 | M56 | 4.x | Chromium 53 |
| 2019 | 5.0 | M63 | 4.x | Chromium 53 |
| 2020 | 5.5 | M69 | 5.x | Chromium 68 |
| 2021 | 6.0 | M76 | 6.x | Chromium 79 |
| 2022 | 6.5 | M85 | 22 | Chromium 87 |
| 2023 | 7.0 | M94 | 23 | Chromium 94 |
| 2024 | 8.0 | M108 | 24 | Chromium 108 |
| 2025 | 9.0 | M120 | 25 | Chromium 120 |
| 2026 | 10.0 | M130 | 26 | Chromium 132 |

- **Engine upgrades are not documented.** Samsung promises 7 years of Tizen updates for 2024+ models (some 2023). LG's Re:New program gives 5 years of upgrades to 2022+ premium and all 2023–24 sets. Neither says whether the web engine is upgraded too; webosbrew says a TV keeps the engine it shipped with ([webosbrew](https://www.webosbrew.org/develop/guides/web-app/web-engine)). **Assume it is not upgraded.**
- **Syntax breaks silently.** On webOS 3.x, any ES2015 syntax fails to parse and you get a blank screen with no error.
- **Market share (shipments, not installed base):** Omdia puts Tizen at ~17% of global TV shipments in 2025, second after Android at 42% ([Omdia via Señal News](https://senalnews.com/en/data/the-operating-system-battle-vidaa-to-overtake-webos-in-europe-in-2025/amp)). Vidaa is forecast to overtake webOS in Europe in 2025. No public installed base by model year was found, so collect model and firmware analytics from day one.

### Memory and CPU
- **Samsung's memory guide** ([Samsung memory guide](https://developer.samsung.com/smarttv/develop/guides/web-app-memory-optimization-guide.html)):
  - Images are the largest memory consumer. One decoded 1080p image is about 8.3 MB; a 4K image is about 33 MB.
  - DOM node count comes next.
  - Virtualize any list longer than about 100 items.
  - Frame budget is 16 ms.
- **Launch time:** Samsung's target is 5–7 seconds, and Tizen supports prelaunching the app in the background ([launch time](https://developer.samsung.com/SmartTV/develop/guides/application-performance-improvement/launch-time-optimization.html)).
- **Low-memory TVs:** 2018 webOS 4 models had about 1 GB RAM (Oxagile). On low memory, LG TVs show "Restart the app to ensure efficient memory use" ([LG support](https://www.lg.com/us/support/help-library/lg-tv-troubleshooting-low-memory-notifications-and-apps-not-working-CT10000018-20153165912773)). `appinfo.json` has a `requiredMemory` field, and web apps render at 1920×1080 at most ([appinfo](https://webostv.developer.lge.com/develop/references/appinfo-json)).
- **Practices:**
  - Serve logos at their display size.
  - Keep a small LRU cache of decoded images (LRU = evict least recently used).
  - Use transform-only animations.
  - Don't use backdrop blur or big box-shadows on 2018–2020 sets.
  - Do parsing in Web Workers (background threads).
  - Keep the full channel list out of memory; keep it in IndexedDB.

## B. UI frameworks

| Option | Pros | Cons |
|---|---|---|
| **Preact/React + Norigin Spatial Navigation** | In production on Tizen, webOS, Vidaa, Vizio and Titan ([repo](https://github.com/NoriginMedia/Norigin-Spatial-Navigation)). Huge hiring pool. React also carries over to Amazon's React Native-based Vega OS for Fire TV and to React Native tvOS later. | DOM cost on 2018 TVs. You must build virtualization yourself (the library doesn't include it). |
| **LightningJS (Blits / Solid-Lightning)** | WebGL rendering, targets Chrome 38+. Used by Sky and Xfinity on 10M+ devices ([renderer](https://github.com/lightning-js/renderer)). Best frame rates on weak hardware. | The Lightning 3 renderer still carries a "beta" API warning. Text-heavy EPG grids, on-screen keyboards and accessibility are harder. Smaller talent pool. A 2026 LG forum thread shows a Blits app failing as a packaged webOS app because of ES-module loading. |
| **Enact** | Polished on LG, good focus handling (Spotlight). | Tied to LG's design. Running it on Tizen means re-theming, and you lose its main advantage. |
| Vue / plain TS | Light. | Focus management is entirely your own work. |

**What serious apps use:** big OTT apps mostly run their own engines. YouTube uses Cobalt, Netflix uses its own engine. Sky and Comcast use Lightning. Most agency-built apps use React plus a focus library. This is general knowledge, not something I verified for this report.

**Shared code across future platforms:**
- Android TV and Fire OS: a WebView wrapper works, but Media3/ExoPlayer gives much better playback.
- Fire TV on Vega OS: React Native only, and no sideloading ([itsfoss](https://itsfoss.com/news/amazon-vega-os/)).
- tvOS: no WebView, so native or React Native.
- Roku: BrightScript/SceneGraph, so no UI sharing.

The parsers, API clients, EPG and data layers are the shareable asset. **Recommendation:** a monorepo with `core` (TypeScript, no DOM), `ui-web` (Preact + Norigin) and thin `platform-tizen` / `platform-webos` adapters for keys, player, device ID and lifecycle.

## C. Video playback

- **Samsung AVPlay** ([guide](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html)):
  - It is an `<object type="application/avplayer">` overlay that plays below the web page.
  - Use `prepareAsync()`; `prepare()` blocks the UI thread.
  - Audio tracks: `getTotalTrackInfo()` / `setSelectTrack('AUDIO', i)`.
  - Subtitles: `setExternalSubtitlePath()` plus `onsubtitlechange`. The app renders the subtitle text itself.
  - Lifecycle: `suspend()` / `restore()` when the app is hidden or shown.
  - Call `stop()` at end of playback, or the last frame stays on screen.
- **What 2024 Samsung TVs play** ([2024 video spec](https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2024-tv-video-specifications.html)):
  - Containers: TS, MKV, MP4, AVI, FLV, VOB and more.
  - Video: H.264, HEVC Main/Main10 (only in MKV/MP4/TS), AV1, VP9.
  - Audio: AC3, DD+ (E-AC3), AC-4. **No DTS on 2024+.**
  - **"MSE supports resolutions up to FHD; it does not support UHD."** So hls.js on Samsung means no 4K.
  - Version-specific HLS/DASH gaps are catalogued by Dolby/THEOplayer ([AVPlay limitations](https://optiview.dolby.com/resources/blog/playback/going-big-screen-exhaustive-list-of-samsung-tizens-avplay-limitations/)).
- **webOS** ([formats](https://webostv.developer.lge.com/develop/specifications/video-audio-250), [protocols](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)):
  - Containers: TS, MKV, MP4, AVI.
  - Video: H.264, HEVC, AV1, VP9.
  - Audio: DD, DD+, AC-4. DTS is model-dependent.
  - **External subtitles: WebVTT only**, so convert SRT to VTT on the TV.
  - HLS up to version 7; HTTP/2 from webOS 5.
  - **No trick-play or playback rates other than 1.0x.**
  - Several HLS tags are unsupported (e.g., I-frames-only, DATERANGE).
  - Audio switching uses `audioTracks`, available from webOS 3.0. One IPTV developer reported switching had no audible effect ([forum](https://forum.webostv.developer.lge.com/t/video-multi-audio/24156)). Test it.
- **MPEG-TS over HTTP (Xtream live):**
  - Use the built-in player directly with the `.ts` URL, which avoids CORS entirely.
  - mpegts.js (which converts TS for the browser's MSE playback) works on webOS per a developer report, but needs CORS and doesn't support MPEG-2 video ([mpegts.js issue](https://www.github.com/xqq/mpegts.js/issues/169)).
  - Samsung forum users report AVPlay freezing after 3–15 minutes on some endless HTTP streams. Build a stall watchdog with automatic reconnect.
  - If `allowed_output_formats` includes `m3u8`, offer it as an alternative.
- **Not supported:**
  - RTMP and UDP/RTP multicast are not available to TV store apps. HTTP(S) only.
  - Custom User-Agent/Referer headers (`#EXTVLCOPT`) can't be set on `<video>` or XHR. AVPlay may support a `USER_AGENT` streaming property, but I did not verify it.
- **Fast channel zapping:**
  - Reuse a single player instance.
  - Show the channel banner immediately and start playback asynchronously.
  - Debounce rapid channel-up/down presses.
  - Remember the last working URL variant per provider.
  - On Tizen, `webapis.avplaystore.getPlayer()` allows up to 4 player instances "for parallel pre-buffering" ([AVPlayStore](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplaystore-api.html)), which could pre-buffer neighbouring channels. Memory permitting; test it.
- **Multiview / picture-in-picture:**
  - LG officially does not support two simultaneous `<video>` tags ([FAQ](https://webostv.developer.lge.com/faq/can-i-use-two-video-tags-at-the-same-time)).
  - On Samsung, simultaneous decoding with several AVPlay instances is undocumented, and Bitmovin reports single-decoder behaviour.
  - **Treat multiview as not possible in v1.**
- **Playback gotchas:**
  - Tizen: call `webapis.appcommon.setScreenSaver(OFF)` while playing.
  - Tizen: register media, colour, number and channel keys with `tizen.tvinputdevice.registerKey`.
  - VOD seeking in MP4/MKV needs HTTP Range support on the server. Some AVIs have the index at the end of the file, which makes them seek poorly.

## D. IPTV data protocols

- **Xtream Codes** (no official spec exists; the endpoints are reverse-engineered, e.g. [reference](https://drm-free.duckdns.org/thegame_1980/xtream-codes-api-documentation/src/branch/master/ENDPOINT_REFERENCE.md)):
  - **Login:** `player_api.php?username&password` with no action returns `user_info` (status, exp_date, max_connections, allowed_output_formats) and `server_info`. These field names are from my own knowledge, not the reference above.
  - **Actions:** `get_live_categories`, `get_live_streams[&category_id]`, `get_vod_categories`, `get_vod_streams`, `get_vod_info&vod_id`, `get_series_categories`, `get_series`, `get_series_info&series_id`, `get_short_epg&stream_id&limit`, `get_simple_data_table&stream_id`.
  - EPG titles and descriptions usually come back base64-encoded.
  - **Stream URLs:** `/live/u/p/{id}.ts|.m3u8`, `/movie/u/p/{id}.{ext}`, `/series/u/p/{id}.{ext}`.
  - **Full EPG:** `xmltv.php?username&password`. **M3U export:** `get.php?…&type=m3u_plus&output=ts|m3u8`.
  - **Catch-up:** available when `tv_archive`=1, for `tv_archive_duration` days. URL format is `/timeshift/u/p/{durationMin}/{YYYY-MM-DD:HH-MM}/{id}.ts`. Some panels also accept `streaming/timeshift.php?...&stream=&start=&duration=`.
  - Load categories first, then streams one category at a time, lazily.
- **M3U attributes:**
  - Header: `url-tvg` / `x-tvg-url`.
  - Per channel: `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-chno`, `tvg-shift`.
  - Catch-up: `catchup` (`default`, `append`, `shift`, `flussonic`, `xc`), `catchup-days`, `catchup-source` with placeholders `{utc}`, `{lutc}`, `${start}`, `{duration}`, `{offset}` ([Kodi IPTV Simple](https://github.com/5l1v3r1/pvr.iptvsimple), [UniPlayer spec](https://uniplayer.net/docs/specs/catchup/)).
  - Also expect `#EXTVLCOPT` and `#KODIPROP` lines.
- **Stalker/MAG portals:**
  - The flow works like this: the TV calls `portal.php` or `stalker_portal/server/load.php`, starts with `type=stb&action=handshake` to get a token, then calls `get_profile`. Channels come from `itv get_genres/get_all_channels/get_ordered_list`, and playback URLs from `create_link cmd=`.
  - The portal identifies the box by a MAC cookie in Infomir's `00:1A:79` range plus MAG model headers.
  - **Risk:** this works by pretending to be a MAG set-top box, and it is closely tied to piracy resellers. Defer it or leave it out of v1.
- **Scale (50k–200k items):**
  - Parse M3U and XMLTV as a stream, chunk by chunk, in a Web Worker. Write normalized records to IndexedDB.
  - Keep only category indexes and visible windows in memory. Build search indexes in the worker.
  - gzip: `DecompressionStream` exists only from Chromium 80, i.e. Tizen 6.5+ and webOS 22+ (my inference from the engine versions). Older TVs need fflate/pako.
  - XMLTV files are often 50–300 MB uncompressed. Parsing those on a 1 GB 2018 TV is risky, so do server-side compaction for large EPGs.
- **Storage:**
  - **webOS packaged apps lose localStorage on every app update.** The cap is 16 MB since webOS 3.5 ([LG sample](https://github.com/webOS-TV-app-samples/WebStorage)). Whether IndexedDB survives an update is unverified.
  - So store the user's playlists in the cloud and re-sync after updates.
  - Samsung storage quotas aren't documented. Measure with `navigator.storage.estimate()`.
- **CORS and mixed content (http streams):**
  - **Tizen:** needs `<tizen:privilege name="http://tizen.org/privilege/internet"/>` plus `<access origin="*" subdomains="true"/>` ([FAQ](https://developer.samsung.com/smarttv/develop/faq/networking-and-connectivity.html)). Servers may still reject the request; developers report an `Origin: file://` header on POST requests.
  - **webOS:** LG staff said in June 2026 that packaged apps "do not have a CORS origin" and recommended a hosted app ([thread](https://forum.webostv.developer.lge.com/t/how-are-we-supposted-to-handle-cors-with-a-non-hosted-app/28241)).
  - **But a hosted app served over HTTPS will block `fetch` calls to `http://` Xtream panels as mixed content.** Keep the packaged app.
  - Fallback for webOS: a bundled Node.js **JS service** that makes HTTP requests outside the browser context ([JS service](https://webostv.developer.lge.com/develop/guides/js-service-usage)). Verify that Node's `http` module works on the target firmware.
  - Plain media playback (AVPlay or `<video src>`) needs no CORS.
  - **webOS packaged apps can't load `<script type="module">` from `file://`.** Bundle as a classic IIFE script ([thread](https://forum.webostv.developer.lge.com/t/module-script-loads-blocked-under-file-origin-for-installed-webos-app-no-cors-workaround-found/28351)).
  - Old TVs may not trust Let's Encrypt's ISRG X1 root or newer roots. There is a 2026 LG thread about 2017–18 sets ([thread](https://forum.webostv.developer.lge.com/t/older-lg-webos-tvs-2017-2018-tls-roots-digicert-g2-let-s-encrypt-x1-looking-for-confirmation-workarounds/28174)). Test your backend's certificate chain on the oldest TVs you support.

## E. Device identity and payments

- **Tizen IDs:**
  - `webapis.productinfo.getDuid()` needs the public `productinfo` privilege and is available on all supported versions ([productinfo](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/productinfo-api.html)).
  - `webapis.network.getMac()` needs the public `network.public` privilege, **but it returns the MAC of whichever network is active, so the "ID" changes when the user switches between Wi-Fi and Ethernet** ([network](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/network-api.html)).
  - `appcommon.getUuid()` is unique per app, requires user consent, and may not be used for advertising.
  - Partner privileges are not needed for any of these.
- **webOS IDs:**
  - `luna://com.webos.service.sm` → `deviceid/getIDs` with `idType:["LGUDID"]` (webOS 3+, MAC-seeded UUIDv5, **requires user agreement**, not in the emulator). The `webOSDev.LGUDID` helper wraps the same thing ([Device Unique ID](https://webostv.developer.lge.com/develop/references/device-unique-id)).
  - LG staff say no MAC API is provided on webOS TV.
- **Recommendation:** hash the DUID or LGUDID together with an app salt into a "MAC-style" code for display, and pair it with a device key. Ask for consent on first run and list the ID in your privacy policy.
- **Payments:**
  - **Samsung Checkout:** available in 120 countries, requires a Samsung Account. Samsung's docs don't say it is mandatory, and the commission isn't published ([Checkout](https://developer.samsung.com/smarttv/develop/guides/samsung-checkout.html)).
  - **LG:** *"To provide paid products or content in your VOD or game app, In-App Purchase is required."* LG Billing has been discontinued. Paymentwall is recommended, and other providers "may" need a separate contract ([LG IAP](https://webostv.developer.lge.com/develop/guides/in-app-purchase)). Seller Lounge offers webOS Pay, 3rd-party billing, or both ([Aug 2026 thread](https://forum.webostv.developer.lge.com/t/in-app-purchase/28344)).
  - **Uncertain:** whether an activation fee paid on your website via QR code counts as "paid content." Competitors (Smart IPTV at about €5.49 one-time per MAC, IBO with a device-key portal) operate this way. Confirm through Seller Lounge 1:1 Q&A before launch, and keep a Paymentwall path ready for LG.

## E2. Store submission and policy

### Samsung
- **Seller levels** ([membership](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-seller-office-member.html), [partner](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-partner.html)):
  - Anyone with a Samsung Account can join, with no documented fee.
  - **Public Seller = US only.**
  - Other countries need **Partner** status: an offline contract with Samsung HQ or a local subsidiary, then approval by a Content Manager. A forum moderator called partnerships "a privilege and not a right," and partnership requests can sit pending for weeks.
- **Submission process** ([process](https://developer.samsung.com/tv-seller-office/application-publication-process.html)):
  - Upload the `.wgt` (a pre-test runs at upload), icons, screenshots, a UI Description PPTX, test info, age rating and countries. A pre-test runs again on release request, then verification, then launch.
  - Rollout is phased: 3% → 10% → 100%. Beta testing works on 2021+ TVs; alpha testing is partner-only.
- **Certification rules** ([registration FAQ](https://developer.samsung.com/tv-seller-office/faq/application-registration.html)):
  - **Anything the testers can't test is a critical defect.** You must give them a working test playlist or account with unlimited device activations ([UI description](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/application-ui-description.html)). Use your own legally licensed demo streams.
  - **Model groups under FCC rules (the US) require Caption and TTS support.**
  - Privacy policy URL required if you collect personal data.
  - Return key: go back a page, and show an exit confirmation popup on the home screen. Leave the Exit key unregistered ([termination](https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html)).
  - The checklist also tests multitasking and network-drop handling.
- **Review time:** no official figure. Developers report anywhere from about 1 week to 3+ months ([forum](https://forum.developer.samsung.com/t/app-review-time-3-months-and-counting/20062)).
- **IPTV history:**
  - I found no written Samsung rule specific to IPTV.
  - Samsung has removed IPTV players before (Smart IPTV, SS-IPTV). A moderator said the removal was "due to the content that could be obtained."
  - Availability varies by region.
- **2026 crackdown on proxy SDKs:**
  - **Samsung (Aug 2026) and LG (Jul 2026) banned residential-proxy SDKs** (e.g., Bright Data). These SDKs secretly sell the user's home internet connection, and Spur found them in 42% of LG apps and 26.5% of Samsung apps ([TechCrunch](https://techcrunch.com/2026/08/03/samsung-bans-smart-tv-apps-that-share-users-internet-connections-with-strangers/), [Krebs](https://krebsonsecurity.com/2026/07/lg-to-ban-residential-proxies-from-smart-tv-apps/)).
  - Never use bandwidth-monetization SDKs.

### LG
- **Accounts and countries:** Individual and Corporate sellers are both allowed. LG says its store covers 36 countries; that figure may be out of date ([ecosystem](https://webostv.developer.lge.com/distribute/app-ecosystem)).
- **QA stages:** pretest, function test, content test. You must upload a UX scenario and the *current* self-checklist, or the app is rejected without QA. The App CTS test suites run inside Seller Lounge ([approval](https://webostv.developer.lge.com/distribute/app-approval-process)).
- **Mandatory UX rules** ([self-checklist](https://webostv.developer.lge.com/distribute/app-self-checklist)):
  - Everything works with the 4-way keys, OK and Back.
  - **The Magic Remote pointer must work**, so add hover-to-focus.
  - On webOS 23–25, Back on the entry page must go to the Home screen.
  - No hardcoded credentials in the code.
- **Removal:** LG says approved apps "may be removed without notice."
- **Review time:** not published; unverified.

### Legal landscape
- **Spain:**
  - A Madrid court ordered Google to remove IPTV Smarters Pro from Google Play in Spain (Dec 2022), at LaLiga's request. LaLiga also targeted the company's related billing panels ([TF](https://torrentfreak.com/laliga-court-orders-google-to-wipe-iptv-smarters-pro-from-play-store-230102/)).
  - siptv.app was blocked by Spanish ISPs in 2024 even though the app carries no streams. It then rewrote its LG and Samsung listings to say it provides no content ([TF](https://torrentfreak.com/smart-iptv-app-blocked-by-isps-despite-it-carrying-zero-illegal-streams-240420/)).
- **Italy:**
  - Piracy Shield blocked SmartOne's `tizen.` and `lg.` subdomains in Aug 2024. AGCOM revoked the block, but **required "proactive" measures** from SmartOne ([TF](https://torrentfreak.com/dazns-piracy-shield-smart-tv-block-revoked-after-iptv-portal-complaint-241111/)).
  - Piracy Shield has blocked 65k+ domains. Italy now fines end users and has extended blocking duties to VPNs and DNS providers; Cloudflare was fined €14M (Jan 2026).
- **EU:**
  - In *Filmspeler* (C-527/15, 2017), the EU Court of Justice held that selling a media player **with pre-installed add-ons linking to infringing content** is itself a "communication to the public," i.e. infringement ([IPKat](https://ipkitten.blogspot.com/2017/04/breaking-cjeu-in-filmspeler-rules-that.html)).
  - The Commission's 2025 assessment of its live-piracy recommendation found IPTV and app-based piracy rising, but proposed no new law yet.
- **US:**
  - *Cox v. Sony* (Supreme Court, Mar 25 2026): contributory liability now requires **inducement or a service tailored to infringement**. Knowledge alone is not enough ([Cooley](https://www.cooley.com/news/insight/2026/2026-03-26-supreme-court-confirms-limits-on-contributory-liability-for-copyright-infringement)). This favours neutral players that avoid inducement.
  - IPTV operators, resellers and box sellers still lose big cases, e.g. an $18.75M judgment ([TF](https://torrentfreak.com/court-officially-orders-u-s-based-iptv-operator-to-pay-amazon-netflix-18-75-million/)).
- **Risk-minimization checklist:**
  1. No bundled or default playlists, and no "free channels" demo.
  2. Store screenshots show only your own legal demo content, with no Sky, beIN or DAZN logos.
  3. No links to, affiliation with, or reseller/billing panels for IPTV providers. Don't sell "codes" through resellers.
  4. A clear disclaimer in the store listing and in the app.
  5. Terms of service banning infringing use, plus account termination.
  6. A DMCA designated agent registered with the US Copyright Office, and an EU DSA notice-and-action process with a contact point.
  7. A server-side kill-switch and domain blocklist so you can comply with court orders or AGCOM-style demands.
  8. GDPR compliance: playlist URLs contain credentials, so encrypt them, minimize what you keep, and offer deletion.
  9. Separate API domains per platform, behind a CDN, so a block on one domain has limited blast radius.

## F. Backend

**What competitors run:**
- Device activation keyed by MAC or device ID plus a device key.
- A web portal to upload playlists (e.g., siptv.app/mylist, IBO's device login).
- A trial period (about 7 days), then a one-time or yearly fee.
- Cloud-synced playlists, favourites and parental PIN. Sometimes an EPG proxy.

**Suggested architecture:**
1. **Auth and device service:** registers devices, issues signed entitlement tokens (JWT), handles trial and plan, and links devices to an account.
2. **Pairing:** the TV shows a QR code and a short code (device-flow style). The portal (e.g., Next.js) adds or edits Xtream, M3U or Stalker sources, encrypted at rest.
3. **Sync API:** favourites, watch history, settings. Required because webOS wipes local storage on app updates.
4. **Optional EPG service:**
   - Ingest XMLTV by source-URL hash and deduplicate across users who share the same provider.
   - Normalize into gzipped JSON shards, one per channel per day window, on object storage plus CDN, refreshed every 6–12 hours.
   - This exposes your servers to infringing hosts, so isolate it on its own domain and IP range.
5. **Metadata:** TMDB. Commercial use needs a written licence; ask TMDB for terms ([TMDB FAQ](https://developer.themoviedb.org/docs/faq)).
6. **Payments:** Stripe or Paddle on the web, Paymentwall for LG, Samsung Checkout optional.
7. **Ops:** crash and capability telemetry, abuse controls, takedown tooling.

**Never proxy or relay streams.** It multiplies bandwidth cost, creates direct legal exposure, and providers ban datacenter IPs.

**Hosting cost (my rough estimates, not sourced):**
- At about 10k active TVs: €50–150/month (2 small VMs, managed Postgres, Redis, Cloudflare/R2).
- At about 100k: €300–1,000/month. EPG work dominates: 100k TVs pulling raw 10 MB gzipped XMLTV daily is about 30 TB/month, while compacted per-channel windows bring that down to roughly 1–3 TB.
- Add TMDB licence fees and payment processor fees on top.

---

## Known gotchas
- ES2015+ syntax gives a blank screen on webOS 3.x. ES modules don't load in webOS packaged apps.
- Chromium 53 (webOS 4) has no native async/await, so transpile.
- On Samsung, MSE playback (hls.js) is FHD-only, so 4K needs AVPlay. No DTS on Samsung 2024+.
- webOS: no playback rates other than 1.0x, WebVTT-only subtitles, one video at a time, localStorage wiped on app update.
- `getMac()` changes between Wi-Fi and Ethernet. LGUDID needs user consent and real hardware.
- Tizen: AVPlay overlays and layering, `prepareAsync`, suspend/restore on visibility change, screensaver off, key registration, Return/Exit key rules.
- A mismatched author certificate makes updates fail. Old Certificate Extension versions can't create certificates since September 2025.
- Samsung Public Seller is US-only. FCC model groups need captions and TTS.
- CORS behaviour differs between platforms. `http://` APIs break hosted apps served over HTTPS. Let's Encrypt and other newer roots can fail on 2017–18 TVs.
- AVPlay can stall on endless TS streams, so add a reconnect watchdog.
- No bandwidth-proxy SDKs. No preloaded content.

## What I'm unsure about
- Store review times (anecdotal only).
- How long webOS Developer Mode sessions last.
- Whether OS upgrades also upgrade the web engine.
- Simultaneous decoding with multiple AVPlay instances.
- Whether IndexedDB survives a webOS app update.
- AVPlay `USER_AGENT` support.
- Whether LG accepts web-portal activation fees, and whether Samsung requires Checkout.
- Whether native webOS apps are open to third parties.
- All cost figures.

I recommend spending week one buying a 2018 Samsung, a 2018 LG and one 2024+ model of each, and testing CORS, `.ts` playback, the ID APIs and parsing a 200k-item list before committing to the architecture.
