# Zoma IPTV — Research & Product Plan

## Context
Zoma IPTV is a new IPTV player for Samsung (Tizen) and LG (webOS) TVs, built to beat IPTV Smarters, IBO Player, BOB Player, Hot Player and the rest. It plays no content of its own: users bring their own M3U or Xtream playlists. The working folder `d:\Claude Code PlayGround\IPTV` is empty, so this starts from scratch.

The research covered about 20 competing apps, user reviews from Trustpilot, forums and app stores, and Samsung and LG's official developer and store documentation.

## Executive summary
- **The market is weak on trust and quality.** The incumbents score 1.6–2.2 on Trustpilot. Users complain about no support, licences locked to one TV, clone apps, reloading the whole playlist at every launch, no real TV guide, broken audio tracks and clunky remotes. The app everyone praises, **TiviMate**, runs only on Android, and Samsung and LG owners keep asking for it on their TVs.
- **Zoma's angle:** a TiviMate-class player for Samsung and LG.
  - **Instant start:** the channel list is cached, so the app opens straight to the last channel.
  - **A real grid TV guide with catch-up.**
  - **Phone setup:** scan a QR code on the TV and type the playlist on your phone.
  - **Arabic and English from day one**, with a right-to-left layout.
  - **Free with no ads**, and playlist logins encrypted end to end.
  - **An "is it the app or my provider?" check**, so provider outages don't land on Zoma.
- **The biggest risk is store access and legal exposure, not engineering.**
  - **Samsung:** only publishes new sellers in the **US** until a partner contract is signed. The GCC and Canada need that contract.
  - **LG:** lets us choose countries.
  - **Both stores:** have removed IPTV players before.
  - **How Zoma stays clean:** no bundled channels, our servers never touch provider links, and a remote kill-switch.
- **Tech:** one TypeScript codebase for both TVs (Preact). It supports **2018+ TVs**, with a full-feature tier for 2020+ models. It uses each TV's built-in video player (AVPlay on Samsung). The backend is small: Next.js, Prisma and Postgres.
- **Timeline:** about **17 weeks to store submission** (around 52 Claude Code sessions), plus store review time. Weeks 1–2 are tests on real TVs that can change the plan.

### Decisions from Omar (2026-11-01)
- Launch markets: **Middle East / GCC + North America** → Arabic (RTL) + English first, then Spanish/French
- v1 platforms: **Samsung Tizen + LG webOS only**
- Business model: **free for now** (no payments in v1; architecture keeps a licensing hook for later)
- Stalker/MAC portals: **dropped**, not planned for any version

## 1. Market research — competitors

| App | Samsung/LG | Price model | Playlist entry | Standout | Reputation |
|---|---|---|---|---|---|
| IPTV Smarters Pro | Samsung build stale (2023); LG flooded by clones | Free to users; providers pay ~$120 to register their server | Xtream login on TV | Best-known brand | Pulled from Google Play 3×; LaLiga court order (2022) |
| IBO Player / IBO Pro (+ ~24 "Ibosol" white-label skins incl. BOB Player) | Yes / Yes | ~€8–10 "lifetime" per device; reseller credits | Device ID + key on web portal only | Wide device reach | Trustpilot 1.6–2.0: no support, no transfers, no refunds, fake portals |
| BOB Player / BOB Pro | Yes / Yes | ~€8/yr or €13 lifetime | MAC at bobplayer.com | Watch history / resume | Little data; part of Ibosol family |
| Hot Player ("Hot IPTV") | Yes / Yes | 30-day trial → €5.99/yr or €19.99 one-time | MAC upload; 3 playlists | Longest trial | Trustpilot 2.2; lookalike scam sites |
| Smart IPTV (SIPTV) | Tizen 6.5+ / webOS 3+ | €5.49 one-time | MAC upload | Cheap, long-lived | Activation domain ISP-blocked in Spain since 2024 |
| SS IPTV | Yes / Yes | Free | Web playlist editor + code | Free, powerful editor | Dated UI |
| Smart STB / STB+ | 2020+ / webOS 3+ | €14.99/yr – €24.99 lifetime (5 devices) | Stalker / M3U | Only TV-native app with timeshift + recording | Clear transfer rules |
| SmartOne IPTV | Tizen+Orsay / webOS+Netcast + VIDAA | €2.50/yr or €12.99 lifetime | Web upload | TMDb metadata, reseller dashboard | Lags on big playlists [unverified] |
| Net IPTV / SET IPTV / Flix / Duplex / Room | Mixed, several aging out | €2–9 per device | MAC upload | Old-TV coverage | Duplex reportedly stopped selling licences |
| **TiviMate** (Android only — benchmark) | **No** | €9.99/yr or ~€34 lifetime, 5 devices | On device + Companion app | 14-day grid EPG, DVR, 9-way multiview, PiP, catch-up in grid | Loved; slow updates |
| New 2026 entrants: Easy IP TV, StreamHub (webOS 23–26) | LG first | Subscription / €10 for 3 TVs | Server-side processing | Pitch: "TiviMate for TVs" | Direct threat to Zoma |

**Market gaps that nearly all TV players share:**
1. **Onboarding:** you copy a MAC address off the TV, go to a website on another device, paste the URL, then restart the app. The TV's MAC also differs between Wi-Fi and Ethernet. No incumbent has a verified QR or phone-pairing flow.
2. **Trust and privacy:** playlist credentials sit on the developer's server, fake portals exist, and about 24 clone "skins" of one app confuse buyers. Trust is the scarce resource here.
3. **Licensing anger:** "lifetime" means one device, with no transfers and no refunds. This is why Trustpilot scores sit at 1.6–2.2. (Zoma being free sidesteps all of it.)
4. **EPG:** usually a list or now/next only. No TV-native app has a 7–14-day grid EPG that matches TiviMate.
5. **Power features missing on TV:** multiview, PiP, timeshift, recording and saved layouts are essentially absent.
6. **Large playlists:** apps reportedly lag above about 20,000 channels.
7. **Stale builds and store fragility:** Smarters' 2023 build, apps that stop at 2020 TVs, apps removed from stores.
8. **Support:** WhatsApp-only, with no status page.

## 2. Voice of the user — complaints, praise, unmet needs
Sources: Trustpilot, App Store reviews, JustUseApp, AVForums, Boards.ie, RedFlagDeals, Dealabs, Whirlpool, Lemmy, GummySearch (Reddit aggregates), TorrentFreak and developer forums. Reddit itself blocked the crawler, so its content came through aggregators.

### Top complaints, most frequent first
1. **No support and refused refunds.** iboproapp scores 1.6/5 (84% one-star), iboplayer 2.0/5, Hot Player 2.2/5. Reviewers describe copy-paste replies and silence on WhatsApp.
2. **Buffering and freezing.** Often the provider's fault, but users blame the app. Users say TiviMate "buffers less, feels snappier" on the same playlist.
3. **Activation lost.** Licences are locked to a MAC and can't be transferred, so "lifetime" dies with the TV. The MAC also changes when switching between Wi-Fi and Ethernet. *(Doesn't apply to Zoma while it's free.)*
4. **Clone apps and fake sites.** bobplayer.org, iboplayer.net and dozens of Smarters lookalikes.
5. **Slow loading.** Apps reload the whole provider database at every launch (AVForums: "I want TiviMate's memory function on Tizen"). Users report 30–40 s channel loads.
6. **EPG problems.** It doesn't load, stops updating after 6 hours, or is per-channel only with no grid. International channels often have no EPG at all.
7. **Updates that break things.** An IBO update wiped favourites, parental locks and hidden groups.
8. **Missing basics.** Global search, resume, series progress, hiding and reordering groups, channel-number entry, previous channel.
9. **Audio.** 5.1 greyed out, audio dropouts, tracks that won't switch.
10. **Navigation and zapping.** Clunky remote navigation and 2-second freezes when changing channels.
11. **Ads, broken catch-up, no multiview** (less frequent).

### What makes users stay or switch
Users choose on stability, a usable guide and helpful setup, not on feature count. TiviMate is the benchmark (4.7/5 vs Smarters 3.8 in Reddit aggregates). Users praise:
- handling huge playlists
- a real grid guide that family members can use
- remembering the last channel
- background refresh
- recording
- multiview
- catch-up from the guide
- a fair 5-device licence

It is not on Samsung or LG, and Samsung's own community moderators tell users to buy an Android stick instead. **That gap is Zoma's opening.**

### Unmet needs from Samsung/LG owners
- TiviMate-class quality without an extra box
- Keep the data and refresh it in the background
- A full grid EPG with automatic refresh
- Recording on Tizen (nobody offers it)
- PiP and multiview
- Reliable audio and 5.1
- Settings that survive updates and sync across devices
- Parental and category locks
- Setup that needs no VPN or blocked website

### Segments
| Segment | Key needs |
|---|---|
| **Sports fans** | Fast zapping, stability at peak times, 50/60fps and 4K, sports-friendly EPG |
| **Arabic-speaking / GCC diaspora and expats** | Arabic RTL UI, multi-audio and subtitles, international EPG matching, language/country filters. Evidence: Haraj (Saudi Arabia) is full of IBO activation sellers |
| **Older, non-technical viewers set up by family** | Open on the last channel, number-pad zapping, big simple UI, setup done remotely from the helper's phone |
| **Power users** | Multiple playlists, external XMLTV, advanced options |

## 3. Platform, build & launch research

**The biggest risk is store access and legal exposure, not engineering.**

### Store access
- **Samsung "Public Seller" accounts can publish in the US only.** Canada, the GCC and any other region need **Partner** status: an offline contract with Samsung HQ or a local subsidiary (Samsung Gulf for us). A moderator called partnerships "a privilege, not a right," and approval takes weeks or longer.
- **LG Seller Lounge** accepts individual and corporate sellers, and you pick countries at submission.
- **Review times:** unofficial reports for Samsung range from about 1 week to 3+ months. Plan around that.

### Samsung certification must-haves
- Testers need a **working test playlist** with unlimited activations. If they can't test something, it is a critical defect. Use our own legally licensed demo streams.
- US (FCC) model groups require **captions and text-to-speech**.
- Return key goes back a page, with an exit popup on the home screen.
- Privacy policy URL.
- Back up the `author.p12` signing certificate forever. Updates signed with a different author certificate are rejected.

### LG certification must-haves
- Upload a UX scenario document and the *current* self-checklist.
- Everything must work with the 4-way keys, OK and Back, **and with the Magic Remote pointer** (hover-to-focus).
- On webOS 23–25, Back on the entry page goes to the Home screen.
- No hardcoded credentials in the code.

### Both stores
- Both have removed IPTV players before (Smart IPTV, SS IPTV). Samsung's stated reason was "the content that could be obtained."
- In 2026 both stores banned residential-proxy SDKs. Never add bandwidth-monetization SDKs.

### Legal
- **EU:** the *Filmspeler* ruling (2017) found that a player **with pre-loaded links to infringing content** infringes copyright itself. A clean player with no bundled content stays outside that ruling.
- **US:** *Cox v. Sony* (Supreme Court, March 2026) says contributory liability needs **inducement or a service tailored to infringement**. That favours neutral players that never promote piracy.
- **Enforcement against neutral players:** LaLiga got Smarters removed in Spain, Spanish ISPs blocked SIPTV's domain, and Italy's Piracy Shield blocked SmartOne's TV subdomains.
- **Risk checklist:**
  1. No default or bundled playlists.
  2. Store screenshots show only our own demo content (no beIN, DAZN or Sky logos).
  3. No reseller panels and no provider affiliations.
  4. Disclaimer in the store listing and in the app.
  5. Terms of service that ban infringing use.
  6. A registered DMCA agent.
  7. A server kill-switch and domain blocklist for complying with orders.
  8. Encrypted playlist credentials.
  9. Separate API domains per platform behind a CDN.

### TV models to support
Samsung's web engine never gets upgraded after the TV ships, so each model year is stuck with the engine below. LG is assumed to be the same, but that is unconfirmed.

| Year | Samsung Tizen | Samsung engine | LG webOS | LG engine |
|---|---|---|---|---|
| 2018 | 4.0 | Chromium 56 | 4.x | Chromium 53 |
| 2020 | 5.5 | Chromium 69 | 5 | Chromium 68 |
| 2022 | 6.5 | Chromium 85 | 22 | Chromium 87 |
| 2024 | 8.0 | Chromium 108 | 24 | Chromium 108 |
| 2026 | 10.0 | Chromium 130 | 26 | Chromium 132 |

- **Minimum supported: 2018 models** (Tizen 4 / webOS 4). **LG since 2026-11-04: 2020 models (webOS 5)**, Omar's decision after S6 had no 2018 LG to run on ([ADR-012](adr/ADR-012-lg-minimum-webos5.md)); Samsung keeps 2018. The build is compiled down to what Chrome 53 understands, shipped as classic scripts (no ES modules), with polyfills.
- **Full-feature tier: 2020+ models.**
- **2015–2017 models are skipped.** Samsung's current SDK can't build for 2015–16 TVs, and 2016–17 LG TVs (Chromium 38) need ES5, which makes modern frameworks very painful.

### Playback facts
- **Built-in players first.** Samsung's player is **AVPlay**; LG's is the HTML5 `<video src>` element, which hands off to LG's built-in media player.
  - Pointing these at a direct `.ts` or `.m3u8` URL avoids the browser's cross-origin (CORS) restrictions entirely.
  - Both play TS, MKV, MP4 and AVI, with H.264/HEVC/AV1/VP9 video and AC3/E-AC3 audio. **No DTS on Samsung 2024+.**
- **Samsung:** browser-based streaming libraries such as hls.js (which play through the browser's MSE pipeline) are **limited to Full HD**, so **4K must go through AVPlay**. AVPlay can freeze on endless TS streams, so Zoma needs a stall watchdog that reconnects automatically.
- **LG:**
  - External subtitles must be WebVTT, so SRT files are converted to VTT on the TV.
  - **No playback speeds other than 1.0x.**
  - **Only one video tag at a time**, so **multiview and PiP are not feasible in v1** on LG. Samsung is undocumented here.
  - Audio-track switching must be tested on real TVs. One developer reported it had no audible effect.
- **Not available to store apps:** RTMP, UDP/multicast, and custom User-Agent/Referer headers on `<video>`.
- **Faster zapping on Samsung:** `avplaystore` allows up to 4 player instances for pre-buffering neighbouring channels. Needs testing on hardware.

### Data facts
- **Xtream:** load categories first, then streams one category at a time, lazily. EPG text arrives base64-encoded.
  - Catch-up URL format: `/timeshift/u/p/{min}/{YYYY-MM-DD:HH-MM}/{id}.ts`.
- **M3U:** support the `tvg-*` attributes, `catchup` / `catchup-source` placeholders, and `#EXTVLCOPT` lines.
- **Large lists (50k–200k items):** parse as a stream in a Web Worker, store the records in IndexedDB, and keep only visible windows in memory.
  - Native gzip decompression exists only on Chromium 80+, so older TVs need the fflate library.
- **Large EPGs:** XMLTV files are often 50–300 MB. Parsing them on a 1 GB 2018 TV is risky, so compact them on the server.
- **LG storage wipe:** **LG packaged apps lose localStorage on every app update.** That is why cloud sync of user state is needed.
- **CORS on LG:** packaged apps have no CORS origin. A hosted app served over HTTPS can't call `http://` panels at all (mixed content). The fallback is a bundled webOS **JS service** (Node), which makes HTTP requests outside the browser context.
- **Stalker/MAG portals:** these work by pretending to be a MAG set-top box and are closely tied to piracy resellers. **Deferred, possibly never.**

### Device ID
- **Samsung:** `webapis.productinfo.getDuid()`, a public privilege. Don't use `getMac()`: it changes between Wi-Fi and Ethernet.
- **LG:** LGUDID via the luna `deviceid/getIDs` call. Needs **user consent** and doesn't work in the emulator.
- Hash either ID into a short pairing code to show on screen.

### Payments (for later, since v1 is free)
- **LG:** in-app purchase is **mandatory** for paid content (Paymentwall or webOS Pay).
- **Samsung:** Checkout is available in 120 countries.
- Whether a web or QR activation fee is allowed is unclear. Ask each store before ever charging.

## 4. Zoma IPTV — product definition

**Positioning:** *A TiviMate-class player for Samsung and LG TVs. Fast, Arabic-first, free, and trustworthy.* No incumbent on either TV platform combines a real grid guide, instant start, effortless setup and an RTL Arabic UI.

### Six product pillars, each answering a top complaint
1. **Instant.** Opens on the last channel in under 3 seconds on 2020+ TVs. The library is cached on the TV and refreshed in the background, never reloaded at launch. The channel banner appears the moment a key is pressed; the stream follows.
2. **Guide-first.** A real multi-day **grid EPG**:
   - catch-up straight from the grid
   - automatic EPG matching with manual override
   - a time offset per source
   - automatic refresh
3. **Effortless setup.** Scan a QR code on the TV, then type or paste the playlist on your phone. On-TV entry still works. **"Helper mode"** lets a family member set up a parent's TV from their own phone. No copying a MAC address and no website hunting.
4. **Trustworthy.**
   - Free, no ads, no sign-up.
   - Credentials are encrypted on the TV and **never stored in plaintext on our servers**.
   - One official domain.
   - A built-in **"Is it the app or my provider?" diagnostic**: HTTP status, server reachability, stream codec and bitrate. This protects our reviews from provider failures.
5. **Bilingual by design.** Arabic (RTL) and English at launch, including RTL-aware remote navigation and an Arabic on-screen keyboard. French and Spanish next.
6. **Never lose your setup.** Favourites, hidden groups, locks and the watch history survive app updates and reinstalls through an encrypted backup tied to the device.

### v1.0 feature set (launch)
- **Sources**
  - Unlimited playlists: M3U/M3U8 URL (or a file sent from your phone) and Xtream Codes login.
  - **Xtream-style M3U links (`get.php?username=…`) are upgraded automatically to the Xtream API**, which adds categories, metadata and catch-up.
  - External XMLTV EPG (xml, gz, zip), several sources per playlist, automatic refresh, per-source time offset, manual channel-to-EPG mapping.
  - Radio (audio-only) channels.
- **Live TV**
  - Category rail and virtualized channel list that scales to 200k items.
  - Number-pad zapping, channel up/down, previous-channel key.
  - Several named favourites lists, reorderable (these are also your custom groups). Hide or reorder groups.
  - Hide, rename or renumber individual channels. Optional "clean names" strips prefixes like `AR |` or `UK:`.
  - Mini info banner; option to start on the last channel.
  - On-screen clock. Sleep timer with a "Still watching?" prompt.
- **EPG**
  - Grid guide covering up to 7 days (whatever the source provides).
  - Now/next shown in the channel list; programme details.
  - Catch-up playback from past programmes (Xtream `tv_archive` and M3U `catchup` attributes).
- **Movies and series**
  - Poster grids and detail pages.
  - Resume, "Continue watching", "Recently added", series progress, auto-next episode.
- **Global search** across live channels, movies and series, Arabic and Latin script, diacritics-insensitive.
- **Player**
  - Audio track and subtitle selection. External SRT/VTT/ASS/SSA subtitles for VOD (ASS styling simplified), with size and timing offset.
  - Aspect/zoom, stream info overlay (codec, resolution, FPS, bitrate).
  - Automatic reconnect on stalls, with a visible "reconnecting" state. Buffer setting: "Fast start / Stable".
  - Colour-key shortcuts (e.g. red = favourites; Guide key opens the EPG).
- **App language** chosen inside Zoma (English / Arabic), independent of the TV's language.
- **Parental**
  - PIN, locked categories and channels.
  - Groups detected as adult are locked by default.
- **Accessibility:** TTS/Voice Guide, captions, Magic Remote pointer support, large-text option.
- **Legal surfaces:** in-app disclaimer ("Zoma provides no content"), ToS, privacy policy, consent screen for the device ID.

### Not in v1, and why
| Excluded | Reason |
|---|---|
| Stalker/MAG portals | **Dropped permanently** (Omar's decision). Works by impersonating a MAG box; closely tied to piracy resellers |
| Payments, reseller panel | v1 is free |
| Multiview / true PiP | LG supports only one video at a time; Samsung undocumented |
| Recording | No proven path to USB from a TV web app. Research spike after launch |
| TMDB enrichment | Needs a commercial licence, and Xtream already supplies most metadata |
| Cloud accounts / multi-TV sync, multiple viewer profiles | Post-launch |
| Live preview while browsing | v1.1. A single resizable video makes it feasible |

### Coverage of the full market feature list (Omar's Tier 1–4 list)
- **v1:**
  - **Sources:** M3U (URL + file from phone), Xtream, multiple playlists, M3U→Xtream auto-upgrade, multiple EPG sources + manual mapping, XMLTV xml/gz/zip + time offset + auto-refresh, radio.
  - **Browsing:** live with groups, movies & series by season/episode, global search, recently added.
  - **Personal:** favourites lists = custom groups, hide/rename/renumber/clean names, parental PIN, continue watching/resume/history, start on last channel, auto-next episode, encrypted backup & restore, in-app language switch.
  - **Player:** auto-reconnect + buffer setting, catch-up, audio tracks, subtitles (embedded + SRT/VTT/ASS/SSA, size + timing), aspect/zoom, stream info overlay, clock, sleep timer, colour-key shortcuts.
  - **Setup:** QR/phone setup + copy-paste.
- **Partial:**
  - **Formats:** HLS, MPEG-TS, MKV, MP4 and AVI all play. RTMP, UDP and MMS are impossible on TV store apps. RTSP is untested (spike S4).
  - **Decoder choice:** TVs only expose hardware decoding.
  - **Timeshift:** only within the provider's catch-up window, in v1.1.
  - **Audio-track switching on LG:** depends on the TV (spike S5).
  - **Subtitle timing:** applies to external subtitles only.
- **Later:**
  - **v1.1:** live preview window, reminders, layout customization, button remapping, speed test.
  - **v1.2:** automatic logos, teletext subtitles, recording spike.
  - **v1.3:** cross-device sync + user profiles.
  - **v2:** other platforms (VIDAA, Android TV/Fire TV, Apple TV).
- **Excluded:**
  - **Can't be built in a TV app:**
    - **Multiview and true PiP:** LG plays one video at a time.
    - **DVR to NAS / server DVR:** a server DVR would touch provider streams.
    - **Offline downloads:** storage is tiny, and there's legal exposure.
    - **Background audio, external player, DLNA/SMB, VPN:** the TV OS doesn't allow them.
    - **AFR:** not needed, because the TV decodes straight to its own panel.
    - **Brightness/contrast and A/V sync:** the TV's own settings, with no API for apps.
  - **Not worth it or risky:**
    - **Casting:** the TV is the cast receiver, not the sender.
    - **Raw playlist editor and FTP upload:** low value, security risk.
    - **Kodi integration:** out of scope.
    - **Watch stats:** low value.
    - **Real-Debrid:** piracy-associated, a store risk.
    - **Stalker/MAC portals:** dropped by Omar's decision.

## 5. Architecture & tech stack

### Key choices
| Area | Choice | Why |
|---|---|---|
| App type | **Packaged** web app on both TVs (Tizen `.wgt`, webOS `.ipk`) | A hosted HTTPS app can't call `http://` panels. Slow store reviews are offset by a signed remote config |
| Language | TypeScript monorepo (pnpm workspaces) | One codebase. Logic runs in Node for tests; thin platform adapters |
| UI | **Preact 10 + @preact/signals**, with a **custom index-based focus engine** | About 4 KB runtime for 1 GB TVs, React-shaped, and signals update only the changed EPG cells. Off-the-shelf focus libraries such as Norigin measure the DOM on every move, which breaks virtualization on 2018 TVs. The engine swaps left/right once for RTL |
| Build | Vite for desktop dev; production build is a Rollup **IIFE** through Babel `preset-env {chrome:53}` + core-js | Workers inlined as Blob URLs. A syntax gate (acorn, ES2016) fails CI on any newer syntax. `postcss-rtlcss` handles RTL. No CSS Grid, flex `gap` or logical properties, because Chromium 53 lacks them |
| Data | Ingest worker (one per refresh, then killed) + persistent query worker + **IndexedDB** cache that can always be rebuilt | Handles 200k items and EPGs of 50–300 MB. The only data that can't be rebuilt is a small "profile" doc, mirrored to an encrypted backup |
| Player | `PlayerController`, platform-agnostic, over swappable engines: **AvplayEngine** (Tizen) and **Html5Engine** (webOS/desktop); hls.js/mpegts.js only as a fallback | Watchdog, retry ladder, redirect probe, error classifier and zapping logic live in one tested place |
| Backend | **Next.js + Prisma + Neon Postgres + Cloudflare R2 + Upstash**, on Vercel | Your familiar stack. Never fetches a user-supplied URL, never relays streams (enforced by lint) |
| Crypto | tweetnacl + @noble/hashes, shared by the TV and the phone page | Pure JS, so it works on Chromium 53 / `file://` where WebCrypto is missing |

### Monorepo layout
```
zoma/
├─ apps/tv/               screens, router, wiring, one entry file per platform
├─ apps/web/              Next.js: /p phone pairing page, /v1/* API, legal pages, landing
├─ apps/mock-provider/    Fastify Xtream/M3U/XMLTV/HLS/TS emulator with legal content and fault injection
│                         (also the public store-certification test account)
├─ packages/core/         pure TS: models, ContentKey, Arabic/Latin normalization, parsers, catch-up URLs,
│                         search, EPG matcher, Entitlements seam (free tier in v1)
├─ packages/data/         IDB schema and migrations, ingest/query workers, typed RPC, DataClient
├─ packages/player/       PlayerController, engine interface, Html5Engine, watchdog, error classifier, SRT/VTT
├─ packages/ui/           focus engine, virtual list, EPG grid, design tokens, components, i18n runtime
├─ packages/platform-{api,tizen,webos,browser}/   keys, device ID, lifecycle, AVPlay, luna, desktop remote
├─ packages/crypto/       envelopes, KDFs, Ed25519 verify
├─ packages/protocol/     zod schemas: config, pairing payload, backup envelope, telemetry
├─ platforms/{tizen,webos}/   config.xml / appinfo.json, icons, privileges
├─ tools/{build,device,fixtures,sign-config}/
├─ e2e/                   Playwright RemoteDriver flows + en/ar screenshots
├─ docs/{research,adr,spikes,store,runbooks}/
├─ CLAUDE.md              conventions, Chromium 53 cheat sheet, boundaries, definition of done
└─ ROADMAP.md             one checkbox per session (compatible with /relay and /handover)
```
`eslint-plugin-boundaries` enforces the import rules. `core` has no DOM and no fetch. Only `platform-*` may touch `tizen`, `webapis`, `webOS` or luna. `apps/web` may not make outbound fetches to arbitrary URLs.

### Data pipeline (summary)
- **Startup:** show the cached data immediately. Refresh in a background worker when stale (live after 12 h, VOD after 24 h; both remote-configurable).
- **Parsing:** fetch with a streamed reader, gunzip (`DecompressionStream`, or fflate on old TVs), then a streaming M3U state machine or a streaming JSON-array splitter for Xtream.
- **Storage:** 500-item IDB chunks, swapped atomically by "generation", so a crash mid-refresh never loses the old data.
- **ContentKey** is never derived from the URL (URLs contain credentials and change). **Favourites survive provider renumbering** through a 30-day re-match by normalized name.
- **Search:** one normalized string plus offset arrays. Arabic normalization folds diacritics, alef forms, ة→ه, ى→ي, and Arabic-Indic digits. Target: ≤ 200 ms over 200k items on a 2018 TV.
- **EPG:** a streaming XMLTV tokenizer, filtered at ingest to matched channels only (usually drops over 90% of the file).
  - **Matching cascade:** user override → tvg-id → Xtream `epg_channel_id` → normalized name → name with quality/country tags stripped.
  - **Storage:** one record per channel per day.
  - **Window:** 7 days ahead plus catch-up days on 2020+ TVs, 3 days plus 1 on 2018–19 TVs.
  - **Fallback:** Xtream `get_short_epg` covers unmatched channels.
- **Storage plan for the webOS update wipe:** the profile (encrypted credentials, favourites, hidden groups, progress, settings; under 300 KB) is kept in IDB with 3 rolling snapshots, a DB8 mirror if spike S2 passes, and the encrypted cloud backup. **Nothing important goes in localStorage.**

### Player (summary)
- **Session tokens:** every load gets a token, and stale events are dropped, which prevents zapping race bugs.
- **Close before open:** the old stream is always stopped before the next one starts, because providers often allow only one connection.
- **URL strategy:** Xtream live tries `.ts` first, then `.m3u8`. The working format is remembered per source.
- **Tizen redirect probe:** a one-time check per source for HTTP 302 redirects, because AVPlay freezes on them.
- **Watchdog:**
  - **Stall definitions:** live is stalled after 6 s without progress or 12 s buffering; VOD after 20 s buffering.
  - **Retry ladder:** reopen → re-probe → switch container → backoff. It gives up after 4 tries in 60 s.
  - **UI:** a "Reconnecting…" badge, never a black screen.
- **Error classifier** shows one of four user-facing causes: **Your internet / Your provider (re-checks the account status, expiry and connection count) / This TV can't play this / App error.**
- **Zapping:** the info bar responds instantly; the stream loads after 350 ms of no key presses. Number entry with a 1.5 s window, previous channel, auto-preferred audio/subtitle languages (`ar`, `en`), and per-channel memory.
- **Start on last channel:** playback starts *before* the catalog loads. Target: first frame within 4 s on 2020+ TVs.
- **Subtitles:** our own overlay with `dir=auto` cues for Arabic. This also removes webOS's WebVTT-only limit for external files.

### Backend — v1 needs only four things
1. **Signed remote config + kill-switch + hashed domain blocklist.**
   - **Signing:** an offline Ed25519 key, with 2 public keys embedded for rotation.
   - **Kill modes:** notice / block new sources / disable playback / disable app, per platform, version and country.
   - **Blocklist:** checked on the TV against `sha256(salt+host)`, so our server never learns which provider a user has.
2. **End-to-end encrypted phone pairing.**
   1. The TV generates an ephemeral X25519 key.
   2. The TV shows a QR code `https://<domain>/p#c=<code>&k=<tvPk>` plus an 8-character code a remote family member can type.
   3. The phone encrypts the playlist (Xtream / M3U URL / M3U file up to 40 MB).
   4. The server relays only ciphertext and deletes it once the TV reads it (TTL 1 h).
   5. The TV validates the playlist against the provider and reports only a status category back to the phone.
3. **Encrypted backup with automatic restore.**
   - **Keys:** `master = scrypt(DUID|LGUDID, app salt)`. From it come `lookupId`, `writeToken` and `encKey`.
   - **Server side:** stores only the secretbox ciphertext. Restore after a webOS update wipe is automatic.
   - **Without a device ID:** if the device ID is unavailable, a "Backup code" is shown in Settings instead.
4. **Telemetry + crash reports + diagnostics support code.**
   - **Never collected:** URLs, hostnames, channel names, credentials or IPs.
   - **Identity:** a random install ID.
   - **Purpose:** how we learn which TV models misbehave.

**Hosting estimate:** about €50–150/month at 10k active TVs (rough).

## 6. Roadmap (≈ 17 weeks to store submission, ~52 Claude Code sessions)
Each session ends with `pnpm verify` green (lint, typecheck, tests, both TV builds, syntax gate, bundle budgets) plus evidence you can check: screenshots, on-TV self-test JSON, or a short click-through checklist.

| Phase | Goal | Sessions | Weeks | Exit criteria |
|---|---|---|---|---|
| **0 Foundations** | Repo, CI, build pipeline, CLAUDE.md, research saved to `docs/research/` | 2 | 1 | CI green; "hello" app installs on all 4 test TVs with one command |
| **1 Lab & hardware spikes** | Remove unknowns before building (spikes S0–S11 below) | 4 | 1–2 | Every spike recorded per TV; plan adjusted |
| **2 Mock provider & fixtures** | Legal test bed (Blender open movies, ffmpeg test channels, multi-audio Arabic/English/5.1, HEVC 4K, fault injection), 200k-item and 300 MB EPG fixtures | 2 | 2 | Every endpoint and fault reproducible |
| **3 Data engine** | Parsers, IDB, workers, search, EPG matcher | 5 | 3–4 | 200k items on webOS 4 in ≤ 90 s with no crash; search ≤ 200 ms |
| **4 UI shell** | Focus engine, RTL, i18n (en/ar), onboarding, live list | 5 | 4–5 | Keys-only flow passes in English and Arabic; smooth on 2018 TVs |
| **5 Player & live TV** | Engines, watchdog, zapping, tracks, start on last channel | 5 | 6–7 | 50 rapid zaps with no hang; 2 h soak recovers each stall in ≤ 10 s |
| **6 EPG + catch-up** | Grid guide, details, manual matching, **catch-up from the grid** | 5 | 8–9 | 7-day grid at ≤ 150 ms per key on a 2018 TV; catch-up plays from the mock provider |
| **7 VOD, series, search** | Movies, series, resume, continue watching, global search, home | 4 | 9–10 | Resume accurate to ±5 s; search ≤ 300 ms on a 2018 TV |
| **8 Backend** | Signed config, pairing + phone page, backup, telemetry | 5 | 10–11 | Automated test proves the server holds only ciphertext; webOS reinstall restores automatically |
| **9 Personalization** | Favourites lists, hide/rename/renumber channels, clean names, groups, multiple sources, M3U→Xtream upgrade, radio, parental PIN (adult groups locked by default), clock + sleep timer, diagnostics screen | 6 | 12–13 | Favourites survive a refresh where the provider renamed and reordered channels |
| **10 Hardening** | 2018 performance pass, 8 h soaks, network drops, Voice Guide/TTS + captions, native Arabic review, store documents, public test server | 5 | 13–14 | Release candidate passes the full device checklist |
| **11 Beta & submission** | Closed beta (10–30 users in GCC and North America), then LG and Samsung US submissions | 2 + 4 buffer | 15–16+ | Listings approved |

### Week 1–2 hardware spikes (pass/fail decides the plan)
| # | Question | If it fails |
|---|---|---|
| S0 | Signed sideload onto all 4 TVs | Blocker: fix certificates and Dev Mode first |
| S1 | Chromium 53/56 runtime: IIFE, Blob workers, streamed fetch, IDB bulk writes | Fall back to file workers, range XHR, or lazy per-category loading on old TVs |
| S2 | Does IndexedDB survive an app update? Storage quota? | Auto-restore becomes launch-blocking (already planned) |
| S3 | DUID / LGUDID stable across reinstalls | "Backup code" fallback |
| S4 | AVPlay: TS/HLS start time, 302 freeze vs probe, 60-min endless TS, 4K HEVC, AC3/E-AC3, track switch, suspend/restore | Per-model tuning through remote config; honest "not supported" UI |
| S5 | webOS `<video>`: same tests + audio-track switching API | "Audio track not switchable on this TV" message; evaluate the MSE engine for HLS |
| S6 | 2018 low-end LG: 200k ingest, 150 MB EPG, cold start ≤ 3 s, search ≤ 200 ms | Lighter low tier (lazy VOD, smaller EPG window), or **raise the LG minimum to 2019/2020** (I'll ask you first). **Done: LG minimum 2020, ADR-012**; the low tier is measured on the 2018 Samsung |
| S7 | Cross-origin `http://` calls from packaged apps | Build a webOS luna JS-service relay (+2 sessions) |
| S8 | Tizen `avplaystore` pre-buffering | Drop pre-buffered zapping from post-launch |
| S9–S11 | Arabic font shaping/bidi; number, colour, PRE-CH keys, Magic Remote, Arabic IME; screensaver, Voice Guide | Own on-screen keyboard (+2 sessions) / explicit TTS adapter (+1) |

### Post-launch roadmap
- **v1.1:**
  - live preview while browsing (single resizable video)
  - **timeshift through catch-up**: rewind or pause a live channel within the provider's archive window
  - programme reminders while Zoma is open (waking a closed app depends on Tizen's alarm API; needs investigation)
  - layout options: list/grid views, EPG density, logo size, light theme
  - button remapping
  - connection speed test in diagnostics
  - French (Canada) + Spanish (US); Canada listing
- **v1.2:**
  - pre-buffered zapping on Tizen (if S8 passed and the provider allows ≥ 2 connections)
  - **"Family helper"**: manage a parent's favourites and settings from a phone anywhere
  - USB M3U import on Tizen
  - automatic channel logos by name (public logo database, after a licensing check)
  - DVB teletext subtitles (investigate; Smart IPTV added them in 2026, so newer TVs can do it)
  - recording research spike (Tizen USB only)
- **v1.3:** optional account with multi-TV sync; viewer profiles; premium tier through **store IAP**. Basics never go behind a paywall.
- **v2 ports:** **Hisense VIDAA** (same web stack, about 4 sessions; Hisense is strong in the GCC), Android TV/Fire TV (native player wrapper), Apple TV (native).
- **Not feasible:** multiview/PiP on LG (single decoder); DVR recording; pause/rewind without provider catch-up; custom User-Agent headers; RTMP/UDP; DTS on Samsung 2024+; any server-side processing of provider URLs; Stalker.

## 7. Launch, store & legal plan

### Store order
1. **LG first.** Countries: US, AE, SA, KW, QA, BH, OM. Individual or corporate seller; we choose the countries.
2. **Samsung US** through Public Seller, at the same time.
3. **Samsung GCC + Canada** after the Partner contract is signed. **Apply on day 1.**
4. **Canada listings** wait for fr-CA (Quebec French-language rules) in v1.1.

### Submission pack
- Store copy in English and Arabic, with the disclaimer "Zoma does not provide any content".
- Screenshots using only test patterns and Blender content. **No real channel logos.**
- LG UX scenario document and the current self-checklist.
- Samsung UI Description PPTX and tester notes.
- A permanent public **test server** account (the mock provider on a small VPS and a separate domain).
- Privacy policy and ToS URLs; age rating.

### Your business & legal track (runs in parallel; you own it)
| When | Item |
|---|---|
| Week 0–1 | Decide the **publishing company**. **Order 4 test TVs**: a 2018 Samsung (e.g. NU7100), a 2018 LG low-end (e.g. UK6300), a 2023/24 Samsung and a 2023/24 LG. Open **Samsung Seller Office + submit the Partner application** (Samsung Gulf). Open the **LG Seller Lounge** account. Run a **"Zoma" trademark clearance** (US, Canada, UAE, KSA). Register domains and social handles |
| Week 2–4 | Counsel (US + one GCC jurisdiction): ToS, privacy policy (UAE/KSA PDPL, PIPEDA, Quebec Law 25), DMCA policy. **Register a DMCA agent** with the US Copyright Office. Court-order/kill-switch runbook |
| Week 4–8 | File trademarks; support mailbox and help pages |
| Week 12–14 | Legal pages live; test server live; **back up the Tizen author certificate + config signing key in two places** |

### Risks & mitigations (top)
| Risk | Mitigation |
|---|---|
| Store removal or rejection | Clean-player posture, LG submitted first, test-pattern screenshots, adult content locked, no proxy SDKs |
| Slow Samsung Partner approval | Apply day 1; launch LG GCC + Samsung US first |
| webOS data wipe on update | Encrypted backup with auto-restore from v1 |
| 2018 TVs too weak | Low tier, S6 thresholds as release gates, option to raise the minimum |
| AVPlay stalls | Watchdog, retry ladder and remote-config tuning; 8 h soak gate |
| Legal action against players | We never fetch provider URLs or relay streams; kill-switch + blocklist; DMCA agent; company entity; no piracy-flavoured marketing |
| Lost signing keys | Two backups + runbook; config key rotation |
| Quality drift across ~50 Claude sessions | CLAUDE.md rules, boundary/syntax/compat gates, ADRs, one ROADMAP checkbox per session |

## 8. Verification
- **Automated:**
  - **Unit tests (Vitest):** parsers, with fuzzing; normalization; EPG matching; search; player state machine with FakeEngine; focus engine in LTR and RTL; IDB migrations (fake-indexeddb); crypto test vectors.
  - **"No plaintext" backend test:** searches every DB row and R2 object for the test password.
  - **Playwright e2e:** key-driven flows against the mock provider, with en/ar screenshots and CPU-throttled smoke runs.
- **On-device:**
  - **Self-test runner:** a dev build injects remote-key sequences and posts results as JSON to a LAN log collector that Claude reads.
  - **Release checklist:** data survives an update, 200k ingest, 300 MB EPG, 50 rapid zaps, 8 h soak, 4K HEVC, multi-audio, subtitles, network pulled for 30 s, Magic Remote, RTL, Voice Guide.
- **UI changes:** per your rule, every UI phase ends with a short "press these keys on the TV" checklist for you.
- **Definition of Done mapping:** tests + build green → PR merged with CI green → backend deploy (Vercel/Neon; **I ask before each production deploy or migration**) → store submission (**I ask before each submission**) → live check on a real TV → handover.

## First steps after you approve
1. Create the project in `d:\Claude Code PlayGround\IPTV`: `git init`, private GitHub repo `zoma-iptv` (I'll confirm the GitHub owner), and the Phase 0.1 scaffold.
2. Save the full research reports into `docs/research/` and the architecture detail into `docs/architecture.md` and ADRs, so future sessions don't redo the research.
3. Write `ROADMAP.md` with one checkbox per session, ready for `/relay` or manual sessions.
4. You start the business track: test TVs, seller accounts, the Samsung Partner application, trademark check.
