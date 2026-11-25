# Samsung tester notes (and LG's "test info")

Paste into the store's test-information field at submission. The values in angle brackets are filled at step 47 from the live test server (`test-server.md`); never put real credentials in this public repo.

---

**About this app.** Lablo is a player for the user's own IPTV playlist. It ships with no content. To test it you add a playlist; a permanent test account is provided below. The test content is ffmpeg test patterns and the Blender open movies (Big Buck Bunny, Sintel, Tears of Steel, Cosmos Laundromat), credited in the app's About page.

**Test account (Xtream login)**
- Server: `<test server address>`
- Username: `<tester username>`
- Password: `<tester password>`
- The account never expires and allows unlimited device activations and 4 simultaneous streams.

**How to add it**
1. First launch: choose English or Arabic, press OK on the notice.
2. Choose "Add a source" › "Type it on the TV" (or scan the QR code and use a phone).
3. Pick Xtream, enter the server, user and password above, then Done. Wait for the library to load (about 10 seconds).
4. The app opens on Live TV.

**What to try**
- Live: numbers, CH up/down, OK on a channel, info banner.
- Guide: the Guide key opens the grid; move across days.
- Movies and series: play, press Back, reopen: resume is offered.
- Player: audio and subtitle picker (the mock's multi-audio and bilingual channels carry several languages), picture size, stream info.
- Settings › Language: switch to Arabic and back.
- Back key: goes back one screen; on the first screen an exit confirmation appears (Samsung) / returns to Home (LG).

**Network test.** Turn the network off while a channel plays: "Reconnecting" appears; turn it on: playback resumes.

**Special accounts for edge cases (optional).** `<expired account>` shows the expired-account message; `<maxed account>` shows the "too many connections" message.

**Contact.** lablo.iptv@gmail.com

---
Channel names in the mock catalog are generic test names. If a tester sees a real brand on screen, that is a bug in our catalog: tell us.
