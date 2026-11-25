# Samsung Seller Office submission pack

For **Samsung US first** (Public Seller). GCC and Canada follow once the Partner contract is signed (Omar's business track: the Partner application is waiting on him). Minimum: **Tizen 4.0 (2018)** and newer. The `.wgt` is signed with the Samsung author certificate (never committed; backup is Omar's, see RELAY carry-forward).

Samsung tests the upload with a pre-test, then a function test. **"Anything the testers can't test is a critical defect"**: the tester notes must hold a working account (`samsung-tester-notes.md`).

## 1. UI Description (the PPTX)
Samsung asks for a PowerPoint. The content below is the slide outline; building the `.pptx` from it is a mechanical step done with the real screenshots at step 47 (use the `pptx` skill, keep the file out of the public repo until approved). One slide per row; each slide: a screenshot on the left, the key map and the behaviour on the right.

| Slide | Title | Content |
|---|---|---|
| 1 | Lablo IPTV Player | App name, version, category, one-line description, "Lablo provides no content", support address |
| 2 | Launch and first run | Language choice, notice, empty state; where the test account is entered |
| 3 | Add a source | Phone pairing QR, on-TV entry (Xtream and M3U) |
| 4 | Live TV | Category rail, channel list, number keys, CH up/down, info banner |
| 5 | TV guide | Grid, day navigation, programme details, catch-up |
| 6 | Movies and series | Poster grid, detail, resume, next episode |
| 7 | Player | Audio, subtitles, picture size, stream info, reconnect state |
| 8 | Search | Global search, Arabic and Latin |
| 9 | Settings | Language, player, sources, parental, About Lablo (terms, privacy) |
| 10 | Remote keys | Table: arrows, OK, Back (one step back; exit confirmation popup on the first screen), numbers, CH, colour keys, Play/Pause/FF/REW, Info, Guide. **Exit key is not registered.** |
| 11 | Network and multitasking | Behaviour when the network drops; hide/show (position saved, resumes) |
| 12 | Accessibility | Voice Guide / captions (FCC model groups in the US need caption and TTS support: see step 43), large text, pointer |
| 13 | Privacy and data | What is stored on the TV, what leaves it (encrypted), retention days, the consent screen for the device ID |

## 2. Package and listing fields
| Field | Value / source |
|---|---|
| Package | `.wgt` from `pnpm build:tv` for Tizen, signed (step 45 adds the release script) |
| Name | Lablo IPTV Player (`listing-en.md`) |
| Description, keywords | `listing-en.md` |
| Icons, screenshots | `screenshots.md` |
| Age rating, countries | Questionnaire; **United States** only for a Public Seller |
| Privacy policy URL | `/privacy` on the official domain (counsel's final text) |
| Test info | `samsung-tester-notes.md` |
| Rollout | Samsung phases 3% → 10% → 100% (research); beta works on 2021+ TVs |

## 3. Self-checks (research 03 §E2, recheck against Samsung's current checklist at step 47)
| Rule | Our answer |
|---|---|
| Return key goes back one page; exit confirmation popup on the home screen; Exit key unregistered | `rootBackPolicy()` is `exit-dialog` on Tizen (architecture.md §1.1); the app does not register Exit |
| Network-drop and multitasking tests | Reconnect ladder; hidden app saves position (step 40h). The 2020 TV ends a hidden app: the next start resumes (step 40h) |
| Privacy policy URL when personal data is collected | Yes: device ID with consent screen; policy on the site |
| Caption and TTS on FCC model groups | Step 43 |
| No proxy or bandwidth-sharing SDK | None |
| Test account usable by the testers | `samsung-tester-notes.md` and `test-server.md` |
