# LG Content Store submission pack

LG Seller Lounge needs a **UX scenario** and the **current self-checklist** with the package, or the app is rejected without QA (research 03 §E2). The checklist changes: **before step 47, download LG's current self-checklist** from the webOS TV developer site (`webostv.developer.lge.com/distribute/app-self-checklist`) and re-map every row below. This file is our answers as of 2026-11-25, from what the app does and what the research recorded.

- Listing minimum: **webOS 5.0** (2020) and newer (ADR-012). Countries: US, AE, SA, KW, QA, BH, OM.
- `requiredACG` is in the manifest and build-checked (`tools/build/src/acg.ts`).
- Real-TV evidence: marked **TV** where only Omar's LG (OLED55A1PVA, webOS 6) can prove it. Nothing here is "passed on TV" unless step 47 records it.

## 1. UX scenario (to upload)
A numbered walk a tester can follow with the Magic Remote. Use the **test server** (`test-server.md`) credentials from the tester notes.

1. Launch Lablo from the home bar. First launch shows language choice (English / Arabic), then the notice "Lablo provides no content", then the empty state.
2. Choose "Add a source". Either scan the QR code with a phone and enter the playlist on the phone, or choose "Type it on the TV" and enter: Xtream server, user, password from the tester notes.
3. The library loads; progress is shown; the app opens on Live TV.
4. Move with the 4-way keys across categories and channels; point with the Magic Remote at a channel (it takes focus on hover); press OK to play.
5. Press the number keys to zap; CH up/down; the info banner shows the programme.
6. Press the Guide key (or "Guide" in the menu): the grid shows now/next; move across a day; open a programme.
7. Open Movies, pick a title, play, press Back: the position is kept; reopen: "Continue watching" offers resume.
8. In the player: open the audio and subtitle picker; change the picture size; open stream info.
9. Open Settings: change the app language to Arabic; the layout flips and the remote's left/right follow. Open Settings › About Lablo: terms, privacy, the disclaimer.
10. Set a PIN; lock a category; confirm the PIN is asked on opening it.
11. Press Back repeatedly: each press goes back one screen; on the first screen Back returns to the LG home (webOS 23–25 rule) and the app does not trap the key.
12. Disconnect the network while playing: "reconnecting" shows, and playback resumes when the network returns.

## 2. Self-checklist: our answers
| Requirement (from research; recheck on LG's page) | Our behaviour | Evidence / where |
|---|---|---|
| Everything works with 4-way keys, OK and Back | Focus engine drives every screen | `docs/architecture.md` §1.1; e2e walks |
| Magic Remote pointer works, hover focuses | Pointer events move focus; the Magic Remote's OK (key 13) works while pointing | architecture.md §1.1 (step 11b) |
| Back on the entry page goes to the Home screen (webOS 23–25) | `rootBackPolicy()` is `platform-back` on webOS, which calls `PalmSystem.platformBack` | `packages/platform-webos`; `disableBackHistoryAPI: true` in appinfo |
| No hardcoded credentials | None in the package; test credentials live in the mock provider fixtures only | none in `apps/tv`; recheck with a grep at step 45 |
| Packaged app is a classic script (no ES modules from `file://`) | The build emits one IIFE bundle | `tools/build` bundle and syntax gates |
| `requiredACG` lists every luna call | Build refuses a missing group | `tools/build/src/acg.ts` |
| Memory and image budget | Image LRU, virtualized lists, budgets enforced in the build | steps 8, 12, 41 (41 is **TV**) |
| App does not use a residential-proxy or bandwidth-sharing SDK | None; all dependencies are listed in `pnpm-lock.yaml` | review at step 45 |
| Network loss handled | Reconnect ladder and a visible state | `packages/player`; soak is **TV** (step 42) |
| Exit / lifecycle (visibility, relaunch) | Pauses on hide, saves position, resumes on show | step 40h |
| Privacy policy URL, ToS | `/privacy`, `/terms`; in-app About Lablo | blocked on counsel's text and the domain |
| No offensive or infringing content; adult content | App ships with no content; adult-looking groups lock by default | step 38 |
| Language of the UI and the listing | English and Arabic | catalogs, `listing-*.md` |

Rows marked **TV** must be proven by Omar on the LG before step 47 ticks.
