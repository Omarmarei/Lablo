# Testing on Samsung TVs without owning them

We have an LG TV (step 16) and no Samsung. The plan wants four test TVs, two of them Samsung: a 2018 Tizen 4.0 set (e.g. NU7100) and a 2023/24 one ([architecture.md §4](architecture.md), "Minimum (must own)" and "Current (must own)"). This doc compares the ways to run the Lablo Lab ([runbooks/lab.md](runbooks/lab.md)) on real Samsung hardware without buying both, with cost and coverage, and ends with a recommendation. How to set each one up is in [runbooks/tv-setup.md](runbooks/tv-setup.md).

**Since 2026-11-04 the LG minimum is webOS 5 (2020)** ([ADR-012](adr/ADR-012-lg-minimum-webos5.md)), so the used 2018 Samsung is the only low-tier set we will have: S6's low-tier thresholds are measured on it alone. Omar chose the Remote Test Lab plus that set (step 16).

**Sources.** Every claim and price links its source, all read on **2026-11-04** (relay step 15d). Retail prices move weekly: a price marked *(listing)* is a seller's asking price; one marked *(search snapshot)* comes from a search engine's copy of the page, not a live page load. Claims that no official page confirms are marked **unconfirmed**.

## Recommendation

1. **Start with Samsung's Remote Test Lab TVs (free).** 142 remote Samsung TVs from 2019 to 2026 (Tizen 5.0 to 10.0), free for Samsung developer accounts, 5 hours a day. It covers the engine, AVPlay and the zapping questions on every generation from 2019 on. It needs a lab server the internet can reach, because those TVs are in Korea (option 1).
2. **Buy one used 2018 Samsung in the UAE.** Nothing remote covers Tizen 4.0 (Chromium 56), a 2018 set's memory, the real remote in the hand or the sound in the room. A 2018 55" set is listed on dubizzle at AED 1,250; no smaller 2018 set was listed, and one should cost less (option 2). Check the model code before paying (`NU`/`N` = 2018).
3. **Leave the rest for later.** Seller Office Beta Test works only on 2021+ TVs, needs the app registered and approved, and outside the US needs Partner status (option 3). It suits a friends-and-family beta of the real app, not the lab. The paid labs (Suitest from €494 a month) add nothing we need now (option 4).
4. **A current (2024–2026) Samsung of our own** only if the Remote Test Lab's screen or remote turns out too limited: a new 43" set costs about AED 1,000–1,100 in the UAE or $250 in the US (option 2).

Omar picks the route at step 16 (RELAY.md). The questions to answer then are at the end.

## What the lab needs from a Samsung

| Spike ([lab.md](runbooks/lab.md)) | What it needs | 2018 set of our own | Remote Test Lab (2019+) | Beta Test (2021+) |
|---|---|---|---|---|
| S0, S1, S2, S3, S7 (device, runtime, storage, DUID, CORS) | the TV's engine and APIs | yes, Chromium 56 | yes, Chromium 63–130 | needs a store build |
| S4, S8 (AVPlay battery, pre-buffering) | AVPlay, our media, the collector | yes | yes, judged from records (the lab measures frames by the clock); whether the stream shows the picture is **unconfirmed** | needs a store build |
| S5's ear checks, S11 (Voice Guide) | someone listening | yes | sound over the stream **unconfirmed** | the tester |
| S6 (scale) | a low-memory 2018 set | yes (low-end models only) | no: only mid/high-end QLEDs | no (2021+) |
| S9 (Arabic) | the TV's fonts and engine | yes | yes, on Korean-market sets | needs a store build |
| S10 (keys) | the remote in the hand | yes | a virtual remote (key coverage **unconfirmed**) | the tester's remote |

## Option 1: Samsung Remote Test Lab (RTL) TVs

Samsung's Remote Test Lab lends real devices over the browser. It has **TVs again**.

**The devices** (live list from RTL's own API, [products?os=117](https://developer.samsung.com/remotetestlab/rtl/api/v1/products?os=117), as rendered on the [RTL TV page](https://developer.samsung.com/remotetestlab/devices/117/tv)). All are in "Korea (Suwon-TV)":

| Tizen | Year | Model | Sets |
|---|---|---|---|
| 5.0 | 2019 | QN55Q89R (QLED) | 3 |
| 5.5 | 2020 | KQ55QT80 (QLED) | 17 |
| 6.0 | 2021 | KQ55QA80 (QLED) | 33 |
| 6.5 | 2022 | KQ55QB80 (QLED), KQ43LSB05 (The Sero) | 9 + 5 |
| 7.0 | 2023 | KQ55QC80 (QLED) | 21 |
| 8.0 | 2024 | Q80D (US, EU and Asia models) | 21 |
| 9.0 | 2025 | QN55QN80F | 23 |
| 10.0 | 2026 | QN55QN80H | 10 |

142 sets in all; **no 2018 (Tizen 4.0) set and no low-end model**. Year to Tizen version: [Samsung's web engine specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

**Cost:** "It's free of charge for Samsung Developer members." "You can get 20 Credits once a day by signing in" and "1 Credit = 15 min." That is 5 hours a day ([RTL FAQ](https://developer.samsung.com/remotetestlab/rtl/api/v1/faqs); [about RTL](https://developer.samsung.com/remotetestlab/document/about-remote-test-lab.html)).

**Installing our build** ([RTL sdb guide](https://developer.samsung.com/remotetestlab/document/sdb-guide.html)):
- "RTL TV is using sdbproxy when connecting SDB to the RTL TV target." sdbproxy runs on this PC (Windows 10 64-bit is listed). It comes with **"RTL TV Tools"**, installed from Tizen Studio's Package Manager (Extension SDK tab).
- Once sdb is connected, `pnpm device install tizen <serial> --lab` works as for our own TV ([tv-setup.md](runbooks/tv-setup.md) 3.3).
- **Unconfirmed:**
  - whether RTL TV Tools install into the Tizen SDK 10 tools (Samsung's page names only Tizen Studio);
  - how an RTL TV accepts our signature: its DUID in our distributor certificate, as for our own TV, is the likely route.

**Network:** "All RTL server locations have a dedicated WiFi hotspot" (RTL FAQ). The TVs reach the internet, **not our LAN**. The lab therefore needs a public server for its records and for the player batteries' media:
- **a tunnel** from this PC to `pnpm mock` (e.g. Cloudflare Tunnel or ngrok). It is a new native binary on this PC, which Smart App Control may block, and it exposes the mock to the internet while it runs;
- **or the mock's Docker image** (`apps/mock-provider/Dockerfile`) on a small VPS, which architecture.md §4 already plans for store testers.
- The lab accepts `https://host` as its server (`--lab-server`, `apps/tv/src/lab/config.ts`).
- Still to check: that the mock's media URLs, which follow the Host header, come out right behind a tunnel.
- Our legal guardrails are not touched: it is our own mock with our own legal media, never a provider's stream.

**Limits and caveats:**
- **Unconfirmed:** whether the screen stream shows AVPlay's video plane and plays sound, and which keys the virtual remote has. The lab's records answer S4 and S8 without anyone watching, but the ear checks (S5's language switch, S11's Voice Guide) need sound.
- The sets are Korean-market (KQ…) except the 2024 row; S9's fonts and the keyboard may differ from GCC models.
- Bookings are short, and the TVs are reset between users (**unconfirmed**), so S2's update test and S3's reinstall test must fit in one booking.
- RTL had a TV maintenance notice from 2026-10-30 to 2026-11-02 ([RTL notices](https://developer.samsung.com/remotetestlab/rtl/api/v1/notices)).

## Option 2: buy a cheap Samsung

**Reading the year from the model code.** The letters after the screen size give the year ([Samsung US](https://www.samsung.com/us/support/answer/ANS10006944/), [Samsung Canada](https://www.samsung.com/ca/support/tv-audio-video/tv-decipher-model-code/)):
- **N** = 2018 FHD, **NU** = 2018 UHD: Tizen 4.0, our minimum;
- **R/RU** = 2019, **T/TU** = 2020, **AU** = 2021, **BU** = 2022, **CU** = 2023;
- **DU** = 2024 (Samsung UAE: "Crystal UHD 4K DU7000 … (2024)", [UA65DU7000UXZN](https://www.samsung.com/ae_ar/support/model/UA65DU7000UXZN));
- from 2025 the year moves to a suffix: **U7900F/U8000F** = 2025, **U8000H** = 2026 ([Samsung US U8000H](https://www.samsung.com/us/tvs/uhd-4k-tv/43-inch-crystal-uhd-4k-tv-u8000h-sku-un43u8000hfxza/)).

Read the letters in their position: `UA43NU7100` is a 43" 2018 UHD set; `MU` (2017) and `F` (2013) are older than our minimum.

**Prices** (2026-11-04):

| Set | Where | Price |
|---|---|---|
| Used 2018: 55" UA55NU7100 | dubizzle UAE | AED 1,250 *(listing)*, [link](https://uae.dubizzle.com/classified/electronics/televisions/led-lcd/2026/7/10/samsung-ua55nu7100-2-435---06d4551c9f324be8b5c221e8007b6f94/) |
| Used 2020: 32" T5300 | dubizzle UAE | AED 400–470 *(listing, search snapshot)*, [link](https://uae.dubizzle.com/classified/electronics/televisions/led-lcd/2026/5/28/samsung-t5300-32-inch-hd-smart-tv-with-wal-2-217---f4266aaced694cd38cb18a8f5f155798/) |
| New 2020: 32" T5300 (still sold) | Danube Home UAE (third-party seller) | AED 881 *(search snapshot)*, [link](https://www.danubehome.com/ae/en/p/samsung-32-inch-or-hd-or-flat-smart-tv-or-2020or-32t5300-179900124152) |
| New 2024: 43" UA43DU7000 | Carrefour UAE | AED 1,008–1,099 *(search snapshot)*, [link](https://www.carrefouruae.com/mafuae/en/uhd-tv/43-crystal-uhd-ua43du7000uxzn-4k-smart-tv-2024-/p/8806095485737) |
| New 2026: 43" UN43U8000H | Samsung US | $249.99 (live page), [link](https://www.samsung.com/us/tvs/uhd-4k-tv/43-inch-crystal-uhd-4k-tv-u8000h-sku-un43u8000hfxza/) |

- **No listing was found for a small 2018 set** (32–43" N/NU) in the UAE. US used prices couldn't be read: eBay's sold view refused automated reads, and its search returns mostly spare parts.
- **A 2018 set is the one to buy:** low-end, ideally 1 GB like the plan's NU7100, for S6.
- **A new 2020 32" T5300** is cheap but Tizen 5.5. The Remote Test Lab already covers 2020, so it adds only the remote and the sound.

**Before paying for a used set:**
- Read the model code on the back label (`N`/`NU` in the year position).
- Check that Smart Hub opens and the Apps panel takes **12345** (the Developer Mode dialog, [tv-setup.md](runbooks/tv-setup.md) 3.3). No region lock on Developer Mode is documented (**unconfirmed**).
- Keep the remote: S10 tests the TV's own keys.

**Setting it up costs nothing extra:** the Samsung certificate is free with a Samsung account ([creating certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)). Two Samsung-specific catches, both in tv-setup.md:
- **Tizen 4.0 and certificates:** since Samsung's certificate change of 2025, some "Tizen 4.0 or older" TVs need a Samsung profile with **Partner** privilege and "Permit to install applications" ([Suitest changelog, 2025-11-03](https://suitest.canny.io/changelog/samsung-tizen-action-needed); third party).
- **Installs vanish on power-off:** "Applications installed to a TV through the Tizen Studio are uninstalled when the TV is switched off" ([testing FAQ](https://developer.samsung.com/smarttv/develop/faq/application-testing.html)).

## Option 3: Seller Office Beta Test on friends' and family's TVs

All quotes are from the [Beta Test FAQ](https://developer.samsung.com/tv-seller-office/faq/beta-test.html) unless another link is given.

- **TVs:** "Beta testing is available starting from Smart TVs released in 2021." No 2018–2020 set.
- **Testers:**
  - On the TV's Settings screen they enter the hidden key "134678" and a single-use activation code, which we hand out (a CSV from Seller Office).
  - The FAQ doesn't mention Developer Mode; the flow looks like a store install (**unconfirmed**).
  - Up to 100,000 more codes can be requested.
- **Before a beta can start:**
  - the app is registered in Seller Office ("The application information except 'Verification Info' must be fully entered", [distribution guide](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html));
  - the test is approved by Samsung's Content Manager. Samsung's verification team doesn't test beta versions.
  - A beta version can't later be released: "You cannot submit a version submitted for a beta or alpha test as a release version" (distribution guide).
- **Countries:** a beta works only in the app's service countries.
  - Public Sellers "can launch TV application services only in the United States" ([Seller Office membership](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-seller-office-member.html)).
  - The UAE, Saudi Arabia and Canada need **Partner Seller** status, which needs "an offline contract with Samsung HQ or a local subsidiary" ([becoming a partner](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-partner.html)). That is the Partner application Omar has been reminded about since leg 1.
- **Length:** up to 90 days per test, extendable to 180.
- **Alpha Test:** "exclusively available to partner sellers"; 50 TVs by DUID for up to 30 days, 2020 TVs and newer (distribution guide).
- **Fit:**
  - Good later, for a closed beta of the real app with GCC families once Partner status exists.
  - Poor for the lab: the lab would need registering as an app and Samsung's approval, and a tester's TV would post records to our server over the internet (as for option 1).
  - Whether Samsung would approve a test-harness app is **unconfirmed**.

## Option 4: commercial remote TV labs

| Lab | Samsung TVs | Our own .wgt, our server | Price |
|---|---|---|---|
| **Suitest** ([pricing](https://suite.st/pricing.html), [device lab](https://suite.st/docs/devices/device-lab/), [Tizen](https://suite.st/docs/devices/samsung-tizen/)) | Tizen TVs with "Real-time video streaming of the device screen" and a virtual remote; model years not published (**unconfirmed**) | installs apps whose privileges are on its allow-list (ours are: `internet`, `tv.inputdevice`; `productinfo` **unconfirmed**); the TVs reach the internet, not our LAN; can also drive our own TV over the LAN (SuitestDrive) | Free plan €0 (50 minutes, 1 device); Sweet **€494/month** (1,000 minutes); Super Sweet €935; The Sweetest €1,673 |
| **TV Labs** ([site](https://tvlabs.ai/), [Tizen docs](https://docs.tvlabs.ai/platform/platforms/tizen)) | Tizen TVs; years not published (**unconfirmed**) | sdb forwarding ("only requests to `localhost` will be forwarded to the TV Labs device `sdb` server"); packages re-signed by the platform; no documented route from the TV to our LAN | free trial ("2 devices", "No credit card required"); otherwise contact sales |
| **HeadSpin** ([smart TV](https://headspin.io/smart-tv-testing)) | "Samsung (Tizen), LG (WebOS), and Vizio" | not published | contact sales |
| **Sofia Digital** ([test service](https://sofiadigital.com/?p=7537)) | "Samsung Tizen, 2.3 (2015) to – 7.0 (2023)", "over 250 devices", but "Currently 10 of the most common devices are accessible remotely" | not published | quote |
| **RobusTest** ([TV testing](https://robustest.com/platform/tv-testing)) | on-premises software for TVs we own (2017–2019 listed) | — | quote |
| **BrowserStack** ([smart TV](https://www.browserstack.com/docs/app-automate/smart-tv/overview)), LambdaTest | Fire TV, Android TV, Apple TV, Roku: **no Tizen** | — | — |

None of them covers 2018 low-end sets better than a used TV, and the Remote Test Lab gives the 2019–2026 generations for free. Witbe and Eurofins offer no remote Tizen service that we found. Crowd-testing firms recruit Tizen owners by country (e.g. [Testlio, France](https://job-boards.greenhouse.io/testlio/jobs/8180060)); we found none in the GCC.

## Option 5: emulators and simulators

Covered in [tv-setup.md](runbooks/tv-setup.md) 3.4–3.5:
- The Tizen TV Emulator now ships only a TV 10.0 image (Chromium 130), with no DRM and no 4K. Third parties say it has no AVPlay. On Windows it needs Intel HAXM with Hyper-V off.
- "The emulator is slower than a real TV" ([emulator limitations](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-emulator/emulator-limitations.html)), so it says nothing about a 2018 set's speed or memory.
- The TV Web Simulator is WebKit with simulated APIs.
- Neither replaces a real Samsung. The Docker harness's Chromium 56 stays our best stand-in for the 2018 engine until a TV exists.

## Not available

- **Loans from Samsung:** only Samsung's Knox (enterprise) programme has a device-loan form ([Knox](https://docs.samsungknox.com/partner/knox-partner-program/borrow-a-samsung-device)). Partner Sellers get "dedicated technical support … from the Samsung Engineering team" ([becoming a partner](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-partner.html)). A TV loan through Samsung Gulf is **unconfirmed**; worth asking once the Partner application is in.
- **Renting a TV in the UAE:** no rental service found. e&'s "All-In TV" bundle is a 24-month instalment plan at AED 109 a month, not a rental ([Zawya, 2025](https://www.zawya.com/en/press-release/companies-news/e-and-partners-with-samsung-to-launch-all-in-tv-the-regions-first-all-in-one-tv-and-streaming-bundle-j9wk7c2y)).

## Comparison

| Option | Cost | Samsung years | 2018 / low-end | AVPlay media | Remote and sound | Reaches our LAN | Needs |
|---|---|---|---|---|---|---|---|
| 1. Remote Test Lab | free (5 h a day) | 2019–2026 | no | yes (by records) | virtual; sound **unconfirmed** | no: a tunnel or VPS | Samsung account, Tizen Studio + RTL TV Tools, a certificate |
| 2a. Used 2018 set | AED 1,250 for a 55" (listing); smaller sets unknown | 2018 | **yes** | yes | yes | yes | a certificate with its DUID (Partner level) |
| 2b. New 2024–26 set | AED 1,000–1,100 / $250 (43") | one year | no | yes | yes | yes | a certificate with its DUID |
| 3. Beta Test | free | 2021+ | no | yes | the testers' | no | a registered app, approval; Partner status outside the US |
| 4. Suitest | €494/month and up | unpublished | unknown | yes | virtual | no (cloud lab) | a paid plan |
| 4. TV Labs | trial, then quote | unpublished | unknown | unknown | unknown | no | sales contact |
| 5. Tizen Emulator | free | 2026 engine only | no | **no** (**unconfirmed**) | no | yes | HAXM, Hyper-V off |

## Questions for Omar at step 16

**Decided by Omar on 2026-11-04 (relay leg 34):**
- route **(a)**: the Remote Test Lab now, plus one used 2018 set;
- lab server **(a)**: a tunnel from this PC while a session runs.

The accounts (3) are still his to create.

1. **The Samsung route:**
   - (a) the Remote Test Lab now plus one used 2018 set (recommended);
   - (b) the Remote Test Lab only, and accept no Tizen 4.0 hardware coverage before launch;
   - (c) buy both a 2018 and a current set, as the plan said.
2. **The public lab server for the Remote Test Lab:**
   - (a) a tunnel from this PC while a session runs;
   - (b) the mock's Docker image on a small VPS (the store-tester server of architecture.md §4, earlier than planned).
3. **Accounts only Omar can create:**
   - a Samsung account for the certificate and the Remote Test Lab (sign in on [developer.samsung.com](https://developer.samsung.com));
   - the Samsung certificate itself (tv-setup.md 3.2).

## Could not confirm

- Whether the Remote Test Lab's TV stream shows AVPlay video and carries sound, which remote keys it offers, and whether its TVs are reset between bookings.
- Whether RTL TV Tools (sdbproxy) work with the Tizen SDK 10 tools rather than Tizen Studio, and how an RTL TV accepts a developer's signature.
- The model years in the Suitest and TV Labs device labs; whether either can reach a LAN server.
- Whether the Tizen TV Emulator plays MPEG-TS, AC3 or anything through AVPlay.
- Whether Beta testers need Developer Mode, and whether Samsung would approve a test-harness app for a beta.
- Any region lock on Developer Mode for a TV bought in the UAE.
- Current prices for a small 2018 Samsung (32–43") in the UAE, and US used prices (eBay sold listings).
- HeadSpin, TV Labs, Sofia Digital and RobusTest prices.
- A TV loan from Samsung Gulf.
