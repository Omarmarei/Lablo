# Runbook: setting up TVs, emulators and simulators

How to get the Zoma Lab (and later the app) onto each device we test on: an LG TV, the webOS Emulator and Simulator, a Samsung TV and the Tizen TV Emulator. What the lab does once it runs is in [lab.md](lab.md); how the builds and `pnpm device` work is in [tv-build.md](tv-build.md). Which Samsung hardware to test on without owning it is in [testing-without-tvs.md](../testing-without-tvs.md).

**Sources.** Every fact below links its source. All of them were read on **2026-11-04** (relay step 15d). Where only a forum, a GitHub issue or a third party says something, the text says so. Claims no official page confirms are marked **unconfirmed**. Vendor tools change often: check the linked page again before a long install.

## At a glance

| Device | What it needs | Oldest engine it gives | Media | How the lab gets there |
|---|---|---|---|---|
| **LG TV**, webOS 4+ (2018+) | The Developer Mode app, an LG developer account, the TV on the LAN | the TV's own (webOS 4 = Chromium 53) | the TV's own | `pnpm device install webos tv --lab` |
| **webOS TV Emulator** 1.2–6.0 | VirtualBox 6.1 | 4.0 = Chromium 53 | **no HLS before 5.0**, no DRM | `pnpm device install webos emulator --lab` |
| **webOS TV Simulator** 6.0, 22–26 | a zip from LG | 6.0 = Chromium 79 | "different from actual TV devices", no DRM | `ares-launch -s <version> … dist/tv-lab/webos` (an app folder, no `.ipk`); on this PC, the Linux build in Docker (2.4) |
| **Samsung TV**, Tizen 4+ (2018+) | the Tizen CLI, a Samsung certificate with the TV's DUID, Developer Mode | the TV's own (2018 = Chromium 56) | the TV's own (AVPlay) | `pnpm device install tizen <serial> --lab` |
| **Tizen TV Emulator** | the Tizen SDK, an Intel CPU with HAXM (Hyper-V off) | **TV 10.0 only = Chromium 130** | no DRM, no 4K; AVPlay unconfirmed | `pnpm device install tizen emulator-26101 --lab` |
| **Samsung Remote Test Lab TV**, Tizen 5.0+ (2019+) | as for a Samsung TV, plus RTL TV Tools and a public lab server | 2019 = Chromium 63 | the TV's own | the same, through sdbproxy (3.6) |

Emulators and simulators answer syntax and API questions, never media ones ([architecture.md §4](../architecture.md)). Of the lab's spikes, S1, S2, S7, S9 and S10/S11's API checks are worth running there; the player batteries (S4, S5, S8) and S6 at scale need a TV.

**This PC** (checked 2026-11-04): Intel Core Ultra 7 255H, 32 GB, with Hyper-V running (Docker Desktop and WSL 2 use it). That matters for both emulators:
- the Tizen emulator's HAXM needs Hyper-V off, which would stop Docker and with it `pnpm verify:engines`;
- the webOS Emulator needs VirtualBox 6.1, and whether it runs beside Hyper-V is unconfirmed;
- **Smart App Control blocks the webOS Simulator's Windows build** (6.0 and 24, step 15e, 2026-11-04). Its Linux build runs in Docker instead, and the lab ran there (2.4).

## 1. The lab server (every device)

1. `pnpm mock:media` once (the player batteries skip without it), then `pnpm mock`. It listens on `0.0.0.0:8080`.
2. Windows asks once whether Node may use the network: allow **private** networks.
3. `pnpm build:tv` writes this PC's first private IPv4 address into `dist/tv-lab/<platform>/lab-config.js` and prints it (`Zoma Lab 0.1.0: results to http://192.168.1.3:8080`). Use `--lab-server http://host:port` when that guess is wrong.

Which address each device uses:

| Device | Lab server address |
|---|---|
| A TV on the LAN | the default (this PC's LAN address) |
| webOS Simulator (runs on this PC) | the default, or `--lab-server http://127.0.0.1:8080` |
| webOS Emulator (VirtualBox, NAT) | the default should work through NAT; if not, try `http://10.0.2.2:8080`, VirtualBox NAT's address for the host (**untested here**) |
| Tizen Emulator (QEMU) | the default; `10.0.2.2` is the usual QEMU host address (**unconfirmed** for Samsung's image) |

Records arrive in `artifacts/lab-logs/<session>.ndjson` (lab.md, "Quick start").

## 2. LG webOS

### 2.1 The webOS CLI (already in the repo)

- The repo has **`@webos-tools/cli` 3.2.6** as a dependency of `tools/device` (`^3.2.6`). 3.2.6 is the latest on npm, published 2026-09-08 ([npm](https://www.npmjs.com/package/@webos-tools/cli)).
- It needs **Node ≥ 20**: "Raised the required Node.js version to >=20" ([v3.2.6 release notes](https://github.com/webos-tools/cli/releases/tag/v3.2.6)). LG's [install page](https://webostv.developer.lge.com/develop/tools/cli-installation) still recommends Node 14–16; that is out of date: `pnpm build:tv` runs its `ares-package` on our Node 24.
- LG has deprecated the old CLI: "The old webOS TV CLI and webOS TV Extension for VS Code are deprecated" ([SDK introduction](https://webostv.developer.lge.com/develop/tools/sdk-introduction)). Don't install it globally; it would shadow ours.
- **Run the ares-\* commands through pnpm**, so they use the repo's copy:

  ```bash
  pnpm --filter @zoma/tools-device exec ares-setup-device --list
  ```

  `pnpm device devices|install|launch|inspect webos …` wraps the four commands we use daily (tv-build.md).
- **New in 3.2.6:** `ares-package` warns when `appinfo.json` has no `requiredACG`, which "may be required to pass the webOS submission eligibility check" (release notes above). Ours has none yet. It doesn't block a dev install; it is a store-submission item (RELAY step 45).

### 2.2 An LG TV in Developer Mode

All quotes in this section are from LG's [Developer Mode app page](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) unless another link is given.

**One-time setup:**
1. **Account.** Create an LG developer account on [webostv.developer.lge.com](https://webostv.developer.lge.com) ("SIGN IN" at the top right).
2. **The app.** On the TV, open **LG Apps** (formerly the LG Content Store), search for **"Developer Mode"** and install it. Sign in with the developer account.
3. **Turn it on.** Press **Dev Mode Status**; "The TV will reboot." Open the app again and turn on the **Key Server**. The app shows the TV's IP address and a 6-character **passphrase** at the bottom left.
4. **Network.** The TV and this PC must be on the same network. This PC connects out to the TV on TCP **9922** (SSH, user `prisoner`) and **9991** (the key server); LG documents no ports, these come from the CLI's source ([novacom.js](https://github.com/webos-tools/cli/blob/main/lib/base/novacom.js)).
5. **Register the TV** with the CLI, as `tv` (the name `pnpm device` examples use):

   ```bash
   pnpm --filter @zoma/tools-device exec ares-setup-device --add tv --info "host=<tv-ip>" --info "port=9922" --info "username=prisoner"
   pnpm --filter @zoma/tools-device exec ares-novacom --device tv --getkey
   ```

   `--getkey` asks for the passphrase ("Enter the exact characters (case sensitive)") and saves the key as `%USERPROFILE%\.ssh\tv_webos`. "When using the Developer Mode app, a password is not required."
6. **Check:** `pnpm --filter @zoma/tools-device exec ares-device --system-info --device tv` prints the TV's model and webOS version. Note both for step 16.

**Then the lab:** `pnpm mock`, `pnpm build:tv`, `pnpm device install webos tv --lab`, `pnpm device launch webos tv --lab` (lab.md, "Quick start"). Remote DevTools: `pnpm device inspect webos tv --lab`. The inspector runs through the SSH tunnel (the TV's port 9998 forwarded to a local one; [inspect.js](https://github.com/webos-tools/cli/blob/main/lib/inspect.js)).

**The session timer:**
- Developer Mode lasts a limited time. LG's page gives no figure: "check the remaining session time on the **Remain Session** field."
- **1,000 hours** (about 41 days) is the current maximum according to a forum answer of 2025-12-22: "The maximum Developer Mode session time is now 1000 hours" ([LG forum](https://forum.webostv.developer.lge.com/t/whats-the-way-to-extend-dev-time-with-webos-cli/28033)), and [webOS Homebrew](https://www.webosbrew.org/devmode/) (community) says the same. Our older note of "about 50 hours" comes from a 2022 community blog about a webOS 5 TV ([elis.nu](https://elis.nu/blog/2022/07/keeping-webos-developer-mode-alive-with-home-assistant/)). Neither figure is on an LG page: **unconfirmed**.
- **Extend it on the TV:** "connect the TV to a network and click the **EXTEND** button. If the session time runs out, you cannot extend the session time."
- **Extend it from this PC** (same forum answer; not on LG's docs page):

  ```bash
  pnpm --filter @zoma/tools-device exec ares-launch --device tv com.palmdts.devmode --params "extend=true"
  ```

  Community reports say it "works even when the TV is sleeping", and that the timer on the TV only updates after a reboot ([dev-manager-desktop #256](https://github.com/webosbrew/dev-manager-desktop/issues/256)). The old `ares-extend-dev` command was removed in CLI 3.0. A community script calls an undocumented LG URL with the TV's session token (`ResetDevModeSession.dev`); reports say it answers 200 without extending anything, and its own author advises against it. Don't use it.
- **When the session ends** (the time runs out and the TV reboots, or "After the TV reboot ten times while the TV is not connected to a network"), Developer Mode turns off and "the installed apps that you were using on Developer Mode are uninstalled." The lab's records already on this PC are safe; anything only on the TV (S2's markers, S3's stored hash) is lost, so S2 and S3 restart from a first run.
- **One TV per account:** signing in to Developer Mode on a second TV with the same account ends the first TV's session: "only the session of the latest TV that you sign in to is maintained" ([LG forum](https://forum.webostv.developer.lge.com/t/developer-mode-keeps-login-me-out-before-999h-run-out/6428)). Use one LG developer account per TV.
- **Habit for the relay:** extend the session at the start of every TV session (the command above), and note the remaining time in the handover.

**Minimum version:** LG names none for the Developer Mode app. Community guides list "any webOS 4 or later TV (except for K5LP based TVs)" ([Kodi wiki](https://kodi.wiki/view/HOW-TO:Install_Kodi_for_webOS)), which covers our minimum.

### 2.3 The webOS TV Emulator (4.0 for Chromium 53)

- **Status:** "From webOS TV 22, Emulator will not be provided" ([emulator installation](https://webostv.developer.lge.com/develop/tools/emulator-installation)). Versions **1.2, 2.0, 3.0, 4.0, 5.0 and 6.0** are still offered there (`Emulator_tv_win_v4.0.0.zip` plus `Resources_win.zip`, behind a terms dialog).
- **Why we want it:** Emulator 4.0 is the only way to run webOS 4's Chromium 53 without a TV (the Simulator starts at 6.0). Our Docker harness already runs plain Chromium 53, so the emulator adds webOS's own runtime: `PalmSystem`, the luna bus, the app manager's lifecycle.
- **Requirements** (same page): 64-bit Windows 7 or later, 3 GB of RAM or more, **VirtualBox 6.1**. LG says nothing on VirtualBox 7, Hyper-V or VT-x. A forum reply suggests 6.1.30 over 6.1.46 ([LG forum](https://forum.webostv.developer.lge.com/t/can-not-run-an-emulator/1076)). **Unconfirmed on this PC**, which runs Hyper-V (see "At a glance").
- **Start it** (Windows, same page):
  1. Unzip `Emulator` and `Resources` under one folder and point `LG_WEBOS_TV_SDK_HOME` at it.
  2. Run `vm_register.bat` in `Emulator\v4.0.0`.
  3. Run `LG_webOS_TV_Emulator.exe`.
- **Connect:** the CLI has the device `emulator` preconfigured (`developer@127.0.0.1:6622`, our `pnpm device devices webos` shows it), with its own key: "Emulator does not require this process" (`ares-novacom --help`). So: `pnpm device install webos emulator --lab`, then `pnpm device launch webos emulator --lab`.
- **Limits:**
  - **HLS:** "Emulator 1.0 - 4.0: Not supported"; 5.0–6.0 supported ([streaming protocols and DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)). PlayReady and Widevine: not supported on the emulator or the simulator. HTTP/2 only on 5.0 and 6.0.
  - "The TV tuner is not supported", "LG Apps is not supported", media keys are mis-mapped on 6.0 ([emulator introduction](https://webostv.developer.lge.com/develop/tools/emulator-introduction)).
  - **LGUDID (S3):** LG forum answers contradict each other on Emulator 4.0 ([thread](https://forum.webostv.developer.lge.com/t/webosdev-lgudid-on-webos-3-0/1775)); our research of step 0 says it doesn't work there. Expect S3 to fail or skip.
  - The old App Manager GUI doesn't work with CLI 3.0 or later ([emulator guide](https://webostv.developer.lge.com/develop/tools/emulator-dev-guide)); use the CLI.

### 2.4 The webOS TV Simulator (22–26)

- **Versions** ([simulator installation](https://webostv.developer.lge.com/develop/tools/simulator-installation)): **26** (1.5.0, released March 2026), **25** (1.4.4), **24, 23, 22 and 6.0** (1.4.1). Windows: "Windows 7 or higher (64bit only)". Files: `webOS_TV_<version>_Simulator_<release>_win.zip`. There is no 4.x or 5.x simulator.
- **What it is:** an app on this PC that runs a web app folder. "The webOS TV Simulator does not use .ipk… ares-install command is not required. Use only the ares-launch command" ([LG forum](https://forum.webostv.developer.lge.com/t/how-can-i-use-ares-install-to-put-an-app-on-a-simulator/2476)). "The Web Inspector is launched automatically when the app is run" ([simulator guide](https://webostv.developer.lge.com/develop/tools/simulator-dev-guide)).
- **Run the lab in it:** unzip the simulator, build the lab for this PC, then launch the built folder (it holds `appinfo.json`, which the simulator needs as the root):

  ```bash
  pnpm build:tv --platform webos --target lab --lab-server http://127.0.0.1:8080
  pnpm --filter @zoma/tools-device exec ares-launch -s 24 -sp "C:/webOS_TV_SDK/Simulator/webOS_TV_24_Simulator_1.4.1" "D:/Claude Code PlayGround/IPTV/dist/tv-lab/webos"
  ```

  Use absolute paths: `pnpm --filter … exec` runs in `tools/device`. `-sp` is the folder holding `webOS_TV_24_Simulator_1.4.1.exe`. The CLI saves it, so later runs need only `-s 24` ([launch.js](https://github.com/webos-tools/cli/blob/main/lib/launch.js); `ares-launch --help`). `pnpm device` doesn't wrap the simulator.
- **Limits** ([simulator introduction](https://webostv.developer.lge.com/develop/tools/simulator-introduction)): "Some of luna API and webOSSystem API are not supported", "The video and audio specifications are different from actual TV devices", "It does not support DRM function". LG publishes no list of what is mocked. In step 15e the LGUDID (S3) answered, a new one in each fresh container, and the TTS service (S11) was missing. Treat any media answer as the PC's, not a TV's.
- **What it is good for:** the engines of 2021–2026 (Chromium 79–132) in one place: S1's runtime checks, S9's text and S10's keys on each webOS generation newer than our Docker snapshots (53/56/68).
- **On this PC (step 15e, 2026-11-04): Smart App Control blocks the Windows build, so the Linux build runs in Docker.**
  - **The download:**
    - The zips need no browser. The page's button makes two POSTs. `https://webostv.developer.lge.com/api/downloadSDK` with `{"fileId": "RF…"}` returns `fileIdEnc`. Then `https://developer.lge.com/common/file/DownloadFilePath.ajax` with `fileId=<fileIdEnc>` returns XML whose `gftsUrl` attribute is the file's URL on `gfts.lge.com`.
    - The file ids are in the page's `__NEXT_DATA__`:

      | Version | Windows | Linux |
      |---|---|---|
      | 6.0 | `RF00021083` | `RF00021098` |
      | 22 | `RF00021084` | `RF00021099` |
      | 23 | `RF00021085` | `RF00021100` |
      | 24 | `RF00021086` | `RF00021101` |
      | 25 | `RF00021087` | `RF00021102` |
      | 26 | `RF00021104` | `RF00021103` |

    - Downloading accepts LG's SDK License Agreement (the page's dialog shows it). Omar accepted it for step 15e.
    - On this PC the Simulators are outside the repo: Windows builds in `D:/tools/webos-sim/`, Linux builds in `D:/tools/webos-sim/linux/` (6.0 and 24).
    - The license forbids redistributing the SDK: never commit a Simulator or push an image that holds one.
  - **The Windows build is blocked.**
    - A Windows zip holds one `webOS_TV_<version>_Simulator_<release>.exe` (57 MB for 6.0, 73 MB for 24) and an OSS notice. The `.exe` files are **not signed** (`Get-AuthenticodeSignature`: `NotSigned`).
    - 6.0's `.exe` unpacks an unsigned `webOS_TV_6.0_Simulator.exe` to `%TEMP%`, and Code Integrity refuses to load that one. The process exits with code 1, with no output and no window.
    - For 24, Code Integrity refuses the `.exe` itself (exit 126).
    - Event Viewer logs both in `Microsoft-Windows-CodeIntegrity/Operational`, events 3033 and 3077: "did not meet the Enterprise signing level requirements". Smart App Control is on (`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy`, `VerifiedAndReputablePolicyState` = 1), with no per-app exception. Omar keeps SAC on: don't turn it off.
  - **The Linux build in Docker** (Omar chose this route in leg 34). A Linux zip holds one `.appimage` (an Electron app). `tools/engines/webos-sim/` runs it under Xvfb, the way the old-engine harness runs old Chromium builds:

    ```bash
    pnpm mock                       # the collector, in its own terminal
    pnpm build:tv --platform webos --target lab --lab-server http://host.docker.internal:8080
    docker build -t zoma-webos-sim:local tools/engines/webos-sim
    MSYS_NO_PATHCONV=1 docker run --rm -d --name zoma-websim --shm-size=1g \
      --add-host host.docker.internal:host-gateway \
      -v "D:/tools/webos-sim/linux/webOS_TV_6.0_Simulator_1.4.1/webOS_TV_6.0_Simulator_1.4.1.appimage:/sim.appimage:ro" \
      -v "$(pwd -W)/dist/tv-lab/webos:/app:ro" \
      zoma-webos-sim:local
    ```

    - **The image:** only the runtime libraries. The AppImage is mounted, extracted at start and opened with the lab folder, as `ares-launch` would pass it.
    - **The run:** the lab runs at launch. Its session (`webos-WEBOS6.0_SIMULATOR-…`) is in `artifacts/lab-logs/` about 30 s later. Stop it with `docker rm -f zoma-websim`.
    - **To look at the screen:**

      ```bash
      docker exec -e DISPLAY=:99 zoma-websim sh -c 'xwd -root -silent > /tmp/s.xwd'
      docker cp zoma-websim:/tmp/s.xwd s.xwd
      ffmpeg -i s.xwd s.png
      ```

      It shows the lab in the Simulator's window with LG's on-screen remote beside it.
    - **Commands:** `MSYS_NO_PATHCONV=1` keeps Git Bash from rewriting the container paths; `pwd -W` gives the repo's path as `D:/…`.
  - **Results** (leg 34, every spike, all records in the collector, run at launch):

    | | Simulator 6.0 (1.4.1) | Simulator 24 (1.4.1) |
    |---|---|---|
    | S0 | `WEBOS6.0_SIMULATOR`, OS 02.00.94, `Chrome/79.0.3945.79` | `WEBOS24_SIMULATOR`, OS 02.11.66, `Chrome/108.0.5359.211` |
    | Records, time | 70 in 26 s (a second run from the committed files: the same counts) | 71 (one lifecycle `event`) in 25 s |
    | Counts | 20 pass, 7 fail, 19 info, 22 skip | the same |
    | S1 | 10/10 pass, no polyfill needed; `DecompressionStream` and `structuredClone` missing | 10/10 pass, all APIs present |
    | S2 | a first run (no markers yet); 200 MB written in 1.8 s | 200 MB in 0.9 s |
    | S3 | an LGUDID answers, but **a fresh container gives a new one**: `stable` means nothing here | the same |
    | S7 | 6/6 pass: no CORS enforced, as expected of a packaged TV app | the same |
    | S9 | 4/4 pass; `Intl` gives Arabic-Indic digits for ar-SA (Hijri) and ar-AE | 4/4 pass; Arabic-Indic for ar-SA (Hijri), Western for ar-AE |
    | S10, S11 | key registration `info`; S11 `speech` **fails**: `com.webos.service.tts` does not exist here; the screen reader reads "off" | the same |
    | S4, S8 | every row skips (not the Tizen build) | the same |
    | S5 | Electron's Chromium, not a TV's: no MPEG-TS, no native HLS, sound but no picture for HEVC, no `audioTracks` (the luna route recorded no answer), no in-band text | the same |
    | S6 | the mock's small catalog (`info`): cold start 124 ms | 114 ms |

    **What it is good for:** S1, S2, S7, S9 and the key registration on webOS's own runtime (`PalmSystem`, the luna bus, `webOSSystem`) at Chromium 79 and 108. S5's answers come from the Simulator's Electron build, not from webOS's media pipeline: ignore them.
  - **`ares-launch -s` on Windows** runs the simulator as a child of its own process (`exec` in [launch.js](https://github.com/webos-tools/cli/blob/main/lib/launch.js)) and prints "Launched" at once. A tool that ends the command's process tree when the command returns also ends the simulator. From an agent's shell, start the `.exe` detached instead, with the arguments the CLI passes: `"<app folder>" "{}"`.

### 2.5 webOS Studio (optional)

A VS Code extension (`webOSSDK.webosstudio`, 2.1.3 of 2026-06-29) with a device list, a Simulator manager, an Emulator manager and a package manager for the SDK pieces ([webOS Studio](https://webostv.developer.lge.com/develop/tools/webos-studio-introduction), [installation](https://webostv.developer.lge.com/develop/tools/webos-studio-installation)). It needs the webOS CLI installed globally first, so it doesn't fit our repo-local CLI. Everything above works without it.

## 3. Samsung Tizen

### 3.1 The SDK: Tizen Studio is being retired

- **Tizen Studio 6.1** (2025-04-16) is the last one. Its release notes announced "the deprecation of Tizen Studio and Dynamic Analyzer in the next version" ([6.1 notes](https://samsungtizenos.com/release-notes/tizen-studio-6-1/)).
- **Tizen SDK 10.0** (2025-11-04) replaced it ([10.0 notes](https://samsungtizenos.com/release-notes/tizen-sdk-10-0/)). The IDE is now the VS Code **"Tizen Extension"** (`tizen.vscode-tizen-csharp`, 10.4.4 of 2026-10-23). It installs the SDK itself and has a Certificate Manager ("choose either **Tizen** or **Samsung**"), an Emulator Manager, a Package Manager with the TV repository and the TV Web Simulator ([Tizen docs](https://github.com/Samsung/tizen-docs/blob/master/docs/sdk-tools/vscode-ext/index-web-native.md)). The Tizen docs source (edited 2026-09-09) says: "Tizen Studio is deprecated and no longer supported" ([install-sdk.md](https://github.com/Samsung/tizen-docs/blob/master/docs/sdk-tools/baseline-sdk/setup/install-sdk.md)).
- **But Samsung's TV pages still describe Tizen Studio 6.1** and its Package Manager ([installing the TV SDK](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html)): "Click "install" next to `TV Extensions-<version>` and "Samsung Certificate Extension"" under the Extension SDK tab.
- **Requirements:** 64-bit Windows 10 or 11, 3 GB of RAM, 6 GB of disk; the JDK is bundled ([prerequisites](https://github.com/Samsung/tizen-docs/blob/master/docs/sdk-tools/baseline-sdk/setup/prerequisites.md); Windows 11 since [Tizen Studio 6.0](https://samsungtizenos.com/release-notes/tizen-studio-6-0/)).

**Which route for us:**
1. **Recommended: the SDK 10 CLI installer plus the VS Code Tizen Extension.**
   - The CLI installer, `web-cli_Tizen_SDK_10.0_windows-64.exe` (374 MB, [download.tizen.org](https://download.tizen.org/sdk/Installer/tizen-sdk_10.0/)), gives `tizen`, `sdb` and `package-manager-cli`, which is all `pnpm build:tv` and `pnpm device` call.
   - Add the TV packages with `package-manager-cli show-pkgs` and `package-manager-cli install --accept-license <package>` ("TV Extensions-10.0", "Samsung Certificate Extension").
   - Use the VS Code extension only for the Certificate Manager (3.2). The CLI can't issue Samsung certificates: `tizen certificate` makes Tizen ones only.
2. **Fallback: Tizen Studio 6.1** with "TV Extensions" and the "Samsung Certificate Extension" (Samsung's TV pages, above), if the VS Code route can't make a Samsung TV certificate.

Either way, put `<sdk>/tools/ide/bin` (for `tizen`) and `<sdk>/tools` (for `sdb`) on PATH. Check with `tizen version` and `sdb version`; `pnpm device` probes `tizen version` the same way.

**Smart App Control:** whether these installers and `sdb.exe` are signed is unknown. If SAC blocks one, stop and report it (the relay ends the leg as needs-you). Never turn SAC off (CLAUDE.md).

### 3.2 The Samsung certificate (author + distributor)

A Samsung TV installs only packages signed with a **Samsung** certificate profile (not a Tizen one) whose distributor certificate lists the TV's DUID ([creating certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)).

1. **The Certificate Extension must be 2.0.74 or newer:** "If you use Certificate Manager versions prior to 2.0.74, you will not be able to generate new certificates" ([Samsung notice, 2025-09-17](https://samsungtizenos.com/blog/update-samsung-certificate-extension-for-smart-tv-sdk/)).
   - Samsung's TV page still says 2.0.73, and so did our research (docs/research/03); 2.0.74 is the later, binding figure.
   - The repository has 2.0.73 (2025-09-16), 2.0.74 (2025-09-24) and **2.0.75 (2025-11-03)** ([download.tizen.org](https://download.tizen.org/sdk/extensions/)).
2. **Get each TV's DUID:** on the TV, Menu → Support → Contact Samsung → **Unique Device ID**, or "+" next to the connected TV in the Certificate Manager. A factory reset changes the DUID; a Smart Hub reset doesn't ([FAQ](https://developer.samsung.com/smarttv/develop/faq/device-information-and-firmware.html)).
3. **Create the profile:** Certificate Manager → "+" → **Samsung** → **TV**, named e.g. `zoma-dev`.
   - **Author certificate:** a new one (author name, a password, sign in with the Samsung account, a backup folder).
   - **Distributor certificate:** "Define the privilege level you need, and add the device ID (DUID) for the target device."
4. **Privilege level: choose Partner if the wizard offers it, else Public.**
   - Our `config.xml` asks only for `tv.inputdevice`, `internet` and `productinfo`, and ProductInfo is "Privilege Level : Public" ([ProductInfo API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/productinfo-api.html)). Partner level is for partner-only APIs (e.g. SSO, "Privilege Level : Partner", [SSO API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/sso-api.html)).
   - **But a 2018 TV may need Partner:** since Samsung's certificate change, "you may not be able to install apps on some of the Samsung Tizen devices (with Samsung Tizen 4.0 or older)" without a new Samsung profile with **Partner** privilege and "Permit to install applications" ([Suitest changelog, 2025-11-03](https://suitest.canny.io/changelog/samsung-tizen-action-needed); a third party, not Samsung).
   - Samsung's Watch version of the same wizard says Partner level can be requested by anyone ([Galaxy Watch certificates](https://developer.samsung.com/galaxy-watch/develop/getting-certificates/create)); for TVs that is **unconfirmed**. If the wizard refuses Partner, use Public and expect the 2018 TV to need another try.
5. **Back up `author.p12` and its password forever**, outside the repo (`.gitignore` blocks `*.p12`). Every update of a published app must be signed with the same author certificate (docs/research/03). The lab and the app can share it.
6. **More TVs later:** a distributor certificate holds up to 50 DUIDs according to the Watch page; for TVs that's **unconfirmed** (a forum post says 20). Adding a TV means issuing the distributor certificate again with the new DUID and keeping the author certificate (**unconfirmed**: forum posts and a [Dolby guide](https://ott.dolby.com/spott_releases/samsung_tizen_installation.html)).
7. **Profiles made elsewhere** (e.g. on another PC) can be imported on the command line: `tizen security-profiles add -n zoma-dev -a author.p12 -p <pw> -d distributor.p12 -dp <pw>` ([CLI](https://github.com/Samsung/tizen-docs/blob/master/docs/sdk-tools/baseline-sdk/common-tools/command-line-interface.md)).

### 3.3 A Samsung TV in Developer Mode

1. On the TV: open **Apps**, then enter **12345** with the remote or the on-screen keypad. Switch **Developer mode** On, enter **this PC's IP address**, press OK and **reboot the TV**. "Develop Mode" then shows at the top of the Apps panel ([using a TV](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)).
   - With **Samsung Instant On**, a reboot from the remote doesn't restart the TV: unplug it ([FAQ](https://developer.samsung.com/smarttv/develop/faq/application-testing.html)).
   - The TV accepts connections from the one PC address entered. It is **unconfirmed** that a second PC is refused (a [community report](https://forum.jellyfin.org/t-unable-to-connect-to-developer-mode-of-samsung-smart-tv) says so). If this PC's address changes (DHCP), enter the new one.
2. On this PC: `sdb connect <tv-ip>` (port **26101**, "an internal device port. It cannot be opened separately"; [using a TV](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)). Then `pnpm device devices tizen`: the first column is the **serial** (`192.168.1.20:26101`), the third the target name.
3. **Permit installs** once per TV and certificate: in the Device Manager (Tizen Studio) or the VS Code extension, right-click the TV, then **"Permit to install applications"**. This pushes the profile's `device-profile.xml` to the TV ([CLI page](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html), [Device Manager](https://github.com/Samsung/tizen-docs/blob/master/docs/sdk-tools/baseline-sdk/common-tools/device-manager.md)).
4. **Build, install, launch the lab:**

   ```bash
   TIZEN_SIGNING_PROFILE=zoma-dev pnpm build:tv --platform tizen --target lab
   pnpm device install tizen 192.168.1.20:26101 --lab
   pnpm device launch tizen 192.168.1.20:26101 --lab
   ```

   The build signs `dist/packages/Zoma Lab.wgt` with the profile (`tizen package -t wgt -s zoma-dev`). `pnpm device` runs `tizen install|run -s <serial>`.
   - "1010 : App install fail" means a certificate problem: a wrong profile, or a DUID missing from the distributor certificate ([using a TV](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)).
   - Until step 15d, `pnpm device` passed the serial to `-t`, which takes the target *name*; now it uses `-s` (the CLI page: "`-s`, `--serial`", "`-t`, `--target <target name>`").
5. **Installs don't survive a power-off:** "Applications installed to a TV through the Tizen Studio are uninstalled when the TV is switched off" ([FAQ](https://developer.samsung.com/smarttv/develop/faq/application-testing.html), Q7). Run S2's update test (install 0.1.0, run, install 0.1.1 over it) and S3's reinstall test without switching the TV off in between, and expect a fresh S2/S3 baseline after any power-off.
6. **Remote inspector:** `pnpm device inspect tizen <serial> --lab` runs `sdb -s <serial> shell 0 debug <app id>`, which prints a port (a new one per launch). Then `sdb -s <serial> forward tcp:<port> tcp:<port>` and open `http://localhost:<port>` in Chrome. The forward step comes from a [community guide](https://gist.github.com/laat/2b7107298593dca650062b7678279386); Samsung documents the inspector through the IDE only ("All Samsung TVs since 2015 support the Web Inspector", [Web Inspector](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/web-inspector.html)) and warns that it "does not work properly with Samsung TVs on later versions of Google Chrome". The lab doesn't need the inspector: its records reach the collector anyway.

### 3.4 The Tizen TV Emulator (2026's engine only)

- **Only a TV 10.0 image is offered:** the TV repository lists `tv-samsung-public-emulator-image-x86-64` 10.0.6, and the TV Extension page "TV Extension Image 10.0.0" (2026-02-26, "64-bit image supported and 32-image deprecated", "Chromiun upgrade to M130") ([TV extension download](https://developer.samsung.com/SmartTV/develop/tools/tv-extension/download.html)). Tizen Studio 6.0 "deprecated all Tizen profiles below 6.0". So there is **no 2018 (Chromium 56) or 2020 (Chromium 69) Tizen emulator**; the Docker harness's Chromium 56 snapshot stays our only Tizen 4 stand-in short of a TV.
- **Windows needs Intel VT-x and HAXM** ("If there is a warning message next to "CPU VT", install Intel® HAXM"); HAXM "will not work on AMD processors" and needs Hyper-V disabled. Intel has archived HAXM: "This project will no longer be maintained by Intel" ([intel/haxm](https://github.com/intel/haxm)). The Tizen docs describe a Hyper-V route (Windows Hypervisor Platform) for the VS Code extension ([Tizen docs](https://github.com/Samsung/tizen-docs/blob/master/docs/sdk-tools/vscode-ext/index-web-native.md)), but a Samsung forum post titled "Error launching TV Emulator on Win 11: -enable-whpx: invalid option" reports the TV emulator failing that way (seen in a search result; the forum thread itself now answers 404). **On this PC:** turning Hyper-V off stops Docker Desktop; don't do it without Omar's word.
- **Limits:** "DRM (Digital Rights Management) is not supported", "4K video playback is not supported", no Billing or SSO API (TV Extension page); no UHD, Bluetooth or secure WebSockets ([emulator limitations](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-emulator/emulator-limitations.html)). Third parties say AVPlay is unavailable there ([Dolby OptiView](https://optiview.dolby.com/docs/theoplayer/getting-started/sdks/tizen/setting-up-emulator/)); **unconfirmed** by Samsung.
- **Use:** its serial is `emulator-26101` (Samsung's CLI examples). `pnpm device install tizen emulator-26101 --lab`. Worth running only for S1/S9/S10 on Chromium 130, which the webOS Simulator 26 (Chromium 132) already approximates.

### 3.5 The TV Web Simulator (not useful for us)

"a WebKit-based application that simulates Samsung TV APIs using a JavaScript backend"; HLS is "simulated using dummy videos"; no Widevine or PlayReady ([TV Simulator](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-simulator.html)). It isn't Samsung's Chromium, so none of the lab's answers would hold for a TV. Skip it.

### 3.6 Samsung Remote Test Lab TVs

Free remote Samsung TVs from 2019 to 2026 in Korea; why and when to use them is in [testing-without-tvs.md](../testing-without-tvs.md) (option 1). The setup differs from a TV on the LAN in two ways:
1. **sdb goes through sdbproxy:** install **RTL TV Tools** from Tizen Studio's Package Manager (Extension SDK tab), book a TV on the [RTL TV page](https://developer.samsung.com/remotetestlab/devices/117/tv), press its **SDB** button and agree to open sdbproxy ([RTL sdb guide](https://developer.samsung.com/remotetestlab/document/sdb-guide.html)). Then `pnpm device devices tizen` shows the TV's serial, and 3.3 steps 3–4 apply. Whether RTL TV Tools work with the SDK 10 tools instead of Tizen Studio is **unconfirmed**.
2. **The lab server must be public:** the TVs reach the internet through RTL's own Wi-Fi, never our LAN. Build the lab with `--lab-server https://<public host>` (a tunnel to `pnpm mock`, or the mock's Docker image on a VPS); the lab accepts `https://` addresses.

## 4. Engines by model year

| Year | Samsung (Tizen) | LG (webOS) |
|---|---|---|
| 2018 | 4.0, Chromium 56 | 4.x, Chromium 53 (2018–2019) |
| 2019 | 5.0, Chromium 63 | 4.x, Chromium 53 |
| 2020 | 5.5, Chromium 69 | 5.x, Chromium 68 |
| 2021 | 6.0, Chromium 76 | 6.x, Chromium 79 |
| 2022 | 6.5, Chromium 85 | 22, Chromium 87 |
| 2023 | 7.0, Chromium 94 | 23, Chromium 94 |
| 2024 | 8.0, Chromium 108 | 24, Chromium 108 |
| 2025 | 9.0, Chromium 120 | 25, Chromium 120 |
| 2026 | 10.0, Chromium 130 | 26, Chromium 132 |

Sources: Samsung's [web engine specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html) (by TV model year) and LG's [web API and web engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) (by webOS release year).

**What each tool covers:**

| Engine | Docker harness (`verify:engines`) | Emulator / simulator | Needs a TV |
|---|---|---|---|
| Chromium 53 (LG 2018–19) | plain Chromium 53 | webOS Emulator 4.0 (no HLS) | media, memory, LGUDID, keys |
| Chromium 56 (Samsung 2018) | plain Chromium 56 | none | everything Samsung-specific (AVPlay, DUID, keys) |
| Chromium 63–69 (2019–20) | plain Chromium 68 | webOS Emulator 5.0 (68) | as above |
| Chromium 76–132 (2021+) | none | webOS Simulator 6.0–26, Tizen Emulator 10.0 | media, memory, AVPlay |

## 5. Troubleshooting

- **`ares-*` "Cannot connect" to the TV:** Developer Mode off or expired (open the app: is "Dev Mode Status" on, how much session is left?), the TV's IP changed (`ares-setup-device --modify tv --info "host=<new-ip>"`), or the key is stale after a Dev Mode reinstall (`--getkey` again).
- **The lab vanished from an LG TV:** the Dev Mode session ended and LG uninstalled it. Extend, then install again.
- **`sdb connect` times out:** the Host PC IP on the TV isn't this PC's current address, or the TV wasn't rebooted (unplugged) after setting it.
- **"1010 : App install fail" on Samsung:** the profile's distributor certificate lacks this TV's DUID, the build was signed with another profile, or "Permit to install applications" wasn't done for this TV.
- **The lab disappeared from a Samsung TV:** it was switched off (3.3, step 5). Install again.
- **The collector gets nothing:** lab.md, "Troubleshooting".

## Sources

All read on 2026-11-04.

| Topic | Source |
|---|---|
| webOS CLI version, Node ≥ 20, `requiredACG` warning | [npm](https://www.npmjs.com/package/@webos-tools/cli), [v3.2.6 release notes](https://github.com/webos-tools/cli/releases/tag/v3.2.6), [CLI install (LG)](https://webostv.developer.lge.com/develop/tools/cli-installation), [SDK introduction (LG)](https://webostv.developer.lge.com/develop/tools/sdk-introduction) |
| LG Developer Mode, key server, passphrase, expiry | [Developer Mode app (LG)](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app), [forum: 1000 h, extend via CLI](https://forum.webostv.developer.lge.com/t/whats-the-way-to-extend-dev-time-with-webos-cli/28033), [forum: one TV per account](https://forum.webostv.developer.lge.com/t/developer-mode-keeps-login-me-out-before-999h-run-out/6428), [webOS Homebrew](https://www.webosbrew.org/devmode/), [dev-manager-desktop #256](https://github.com/webosbrew/dev-manager-desktop/issues/256), [elis.nu (2022)](https://elis.nu/blog/2022/07/keeping-webos-developer-mode-alive-with-home-assistant/) |
| webOS Emulator | [installation](https://webostv.developer.lge.com/develop/tools/emulator-installation), [introduction](https://webostv.developer.lge.com/develop/tools/emulator-introduction), [guide](https://webostv.developer.lge.com/develop/tools/emulator-dev-guide), [streaming and DRM](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm), CLI source ([novacom-devices.json](https://github.com/webos-tools/cli/blob/main/files/conf/novacom-devices.json), [inspect.js](https://github.com/webos-tools/cli/blob/main/lib/inspect.js)) |
| webOS Simulator | [installation](https://webostv.developer.lge.com/develop/tools/simulator-installation), [introduction](https://webostv.developer.lge.com/develop/tools/simulator-introduction), [guide](https://webostv.developer.lge.com/develop/tools/simulator-dev-guide), [release notes](https://webostv.developer.lge.com/develop/tools/simulator-release-notes), [launch.js](https://github.com/webos-tools/cli/blob/main/lib/launch.js) |
| Tizen SDK and Studio | [Tizen Studio 6.1](https://samsungtizenos.com/release-notes/tizen-studio-6-1/), [Tizen SDK 10.0](https://samsungtizenos.com/release-notes/tizen-sdk-10-0/), [installers](https://download.tizen.org/sdk/Installer/tizen-sdk_10.0/), [install-sdk.md](https://github.com/Samsung/tizen-docs/blob/master/docs/sdk-tools/baseline-sdk/setup/install-sdk.md), [installing the TV SDK (Samsung)](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html) |
| Samsung certificates | [creating certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html), [2.0.74 notice](https://samsungtizenos.com/blog/update-samsung-certificate-extension-for-smart-tv-sdk/), [extension repository](https://download.tizen.org/sdk/extensions/), [ProductInfo privilege](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/productinfo-api.html), [DUID FAQ](https://developer.samsung.com/smarttv/develop/faq/device-information-and-firmware.html) |
| Samsung Developer Mode, CLI, inspector | [using a TV](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html), [CLI](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/command-line-interface.html), [testing FAQ](https://developer.samsung.com/smarttv/develop/faq/application-testing.html), [Web Inspector](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/web-inspector.html) |
| Remote Test Lab, Tizen 4.0 and Partner privilege | [RTL TV page](https://developer.samsung.com/remotetestlab/devices/117/tv), [RTL sdb guide](https://developer.samsung.com/remotetestlab/document/sdb-guide.html), [Suitest changelog](https://suitest.canny.io/changelog/samsung-tizen-action-needed) |
| Tizen Emulator and Simulator | [TV extension download](https://developer.samsung.com/SmartTV/develop/tools/tv-extension/download.html), [emulator limitations](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-emulator/emulator-limitations.html), [TV Simulator](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-simulator.html), [intel/haxm](https://github.com/intel/haxm) |
| Engines | [Samsung web engine specifications](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html), [LG web API and web engine](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) |
