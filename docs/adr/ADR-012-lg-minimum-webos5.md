# ADR-012: LG minimum webOS 5 (2020), the webOS model year, and LG's ACG

- **Status:** Accepted. Omar raised the LG minimum on 2026-11-04 (relay leg 34), and added LG's ACG (`requiredACG`) to the same step.
- **Date:** 2026-11-04 (relay step 16a)
- **Amends:** docs/PLAN.md §"Minimum supported" and spike S6 ("raise the LG minimum to 2019/2020 (I'll ask you first)"); docs/architecture.md §4 (device matrix) and §5 (S1, S5, S6); implemented in `packages/platform-webos/src/device.ts`, `platforms/webos/appinfo.json` and `tools/build/src/acg.ts`.

## Context
- **The plan's LG minimum was 2018 (webOS 4, Chromium 53).** Spike S6 was to measure scale on a low-end 2018 LG (1 GB, e.g. UK6300) and, if it failed, raise the LG minimum to 2019 or 2020 as a product decision.
- **The only LG TV we have is a 2021 OLED** (OLED55A1PVA: webOS 6, Chromium 79, 2 GB, 4 cores; relay leg 34). No low-end 2018 LG exists to run S6, so the choice was between buying one and raising the minimum.
- **The webOS model year was wrong on that TV.** The adapter read the year from `PalmSystem.deviceInfo.platformVersion`, which holds the firmware (`03.53.45`), so `webosModelYear` gave 2017 and the tier `low`. The webOS TV Simulators report firmware-like values there too (`02.00.94` for 6.0, `02.11.66` for 24). `ares-device --system-info` on the TV prints `sdkVersion : 6.5.3` and `firmwareVersion : 03.53.45`; LG's webOSTV.js reference calls `sdkVersion` "the webOS TV SDK version".
- **LG's Access Control Groups (ACG).** An app lists in appinfo.json's `requiredACG` the group of every luna API it calls. webOS TV 25 and older don't support it, 26 can enforce it, and 27+ requires it: apps without it "will fail validation and cannot be submitted" in the Seller Lounge, and a call without its group fails with errorCode -1 ([ACG guide](https://webostv.developer.lge.com/develop/guides/acg-guide), read 2026-11-04). webOS CLI 3.2.6 already warns when the field is missing.

## Decision
**LG: webOS 5 (2020) and newer.** Samsung keeps 2018 (Tizen 4, Chromium 56).
- The LG store listing declares webOS 5.0+ (RELAY steps 44 and 47).
- Every LG TV we support is in the `full` tier (2020+). The `low` tier now means Samsung 2018–2019 (Tizen 4–5, Chromium 56–63).
- **S6's low-tier run moves to the used 2018 Samsung** Omar buys (step 16). The LG TV runs S6 as a full-tier set.

**The webOS year comes from `sdkVersion`, else from the engine** (`webosVersionFacts`):
1. `sdkVersion` in `PalmSystem.deviceInfo`, when it names a release the table knows (`6.5.3` → webOS 6 → 2021).
2. Otherwise the user agent's Chromium: each webOS TV release ships its own (53 → 4 → 2018, 68 → 5 → 2020, 79 → 6 → 2021, 87 → 2022, 94 → 2023, 108 → 2024, 120 → 2025). For the supported range (2020+) the engine names the year exactly; 53 and 38 each span two years and give the earlier.
3. Otherwise unknown: no year, and the tier follows the engine (`deviceTier`).
- `platformVersion` never decides; it is kept as the firmware when `firmwareVersion` is absent.
- `DeviceInfo.details` (new, optional) records where the version came from and the keys `PalmSystem.deviceInfo` really has; spike S0 logs it, nothing decides on it.
- Not done: the luna route webOSTV.js uses (`com.webos.service.tv.systemproperty/getSystemInfo`, group `systemconfig.query`). It would add a luna round trip and an ACG group to the app's start for a fact the engine already gives on every supported TV.

**`requiredACG` in every webOS manifest, checked by the build** (`tools/build/src/acg.ts`):
- The app declares `[]`: no app code calls a luna API yet. The adapter's luna-backed `Platform` methods (`deviceSecret`, `screenReader`, `speak`) are in its bundle, but only the lab calls them; a test (`acg.test.ts`) fails when app or `ui` code starts calling one without its group in `platforms/webos/appinfo.json`.
- The lab declares `deviceinfo.query` (S3's LGUDID) and `settings.query` (S11's Audio Guidance).
- `pnpm build:tv` fails when a webOS bundle has a `luna://` URI missing from `LUNA_ACG`, when a manifest declares a group no known call needs, or when the lab misses a group of a call it carries.
- **The rule:** every new luna call goes into `LUNA_ACG` with LG's group, and the group into the manifest of each app that calls it. **Services LG's ACG table doesn't list are fallbacks only, never the primary route:** `com.webos.service.tts/speak` and `com.webos.media/selectTrack` will most likely be denied on webOS 27+. On the LG TV, `audioTracks` switched tracks in 154 ms without the luna route (S5), and LG's Audio Guidance reads labelled focus by itself (S11, with `supportsAudioGuidance`).

**The old-engine harness and the build keep Chromium 53.** Chromium 53 no longer matches a supported TV (Samsung 2018 is 56, LG 2020 is 68), but dropping it is not worth it in v1:
- Code that runs on 53 runs on 56 and 68, so 53 only makes the checks stricter.
- Retargeting the build to 56 would make async functions native (Chromium 55+): the ES2016 syntax gate (ADR-003) would have to become ES2017, and CLAUDE.md's Chromium 53 cheat sheet and commands change. That needs Omar's word.
- The saving is about a third of the `engines` CI job (one of three engines) and two polyfills (the bundle fills 8 built-ins on 53 and 6 on 56).
- **Later cleanup** (after v1, or when the `engines` job's time matters): drop the Chromium 53 snapshot, retarget Babel and the gates to Chromium 56, and update ADR-003 and CLAUDE.md together.

## Consequences
- LG 2018–2019 owners (webOS 4.x) can't install Zoma from LG's store.
- **A low-end 2020 LG** (webOS 5, about 1.5 GB) is in the `full` tier by its year, and we own none. The old-engine harness covers its engine (Chromium 68), not its memory or CPU. Step 41 should consider a memory signal for the tier (`navigator.deviceMemory`, Chromium 63+; the LG TV reports 2) before the release.
- The 2018 timing assumptions in architecture.md §3 (the EPG benchmark's "2018 webOS 4 core") stay as written: the 2018 Samsung's SoC is of the same class, and S6 checks them on it.
- Model years from sdkVersion or the engine are only as right as `WEBOS_MAJORS`. Each new TV's S0 record shows `details.versionFrom` and the raw keys, so a wrong table shows up in the lab.
- webOS 27+ will deny any luna call whose group the manifest lacks; the build check covers the URIs it can see in the bundle, and `acg.test.ts` the `Platform` calls the app makes.
