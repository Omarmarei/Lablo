# Store screenshots

Rules (PLAN.md §7, research 03 "risk-minimization checklist"):
1. **Only our own test patterns and the Blender open movies** (credited at the mock provider's `/attribution`). No real channel logos, no broadcaster, league or provider names, no real playlist address or login on screen.
2. Channel names come from the mock catalog (`apps/mock-provider/fixtures/catalog.yaml`): check each frame before it goes in a store.
3. Every language gets its own set: English (LTR) and Arabic (RTL). The Arabic set is captured with the app language set to Arabic, not by flipping a picture.
4. Size 1920x1080, PNG or JPG as each store asks (check the store's current limits at upload: file size and count differ per store and change).
5. The listing's first image should show Live TV or the guide, not a settings page.

## Shot list (same six in each language)
| # | Screen | What it shows | Mock setup |
|---|---|---|---|
| 1 | Live TV with the channel list | Category rail, list, a test-pattern video behind | `lablo` account, a category with 8+ channels |
| 2 | Guide grid | Now/next across several channels, a catch-up mark | the generated guide |
| 3 | Movies | Poster grid with "Continue watching" | Blender titles |
| 4 | Series detail | Episode list with progress | a series in the catalog |
| 5 | Setup with the phone | QR code, the three ways to add a source | Onboarding |
| 6 | Player with info banner | Audio and subtitle picker open | a test channel with two audio tracks |

## How to capture (no TV needed)
The e2e harness already renders these screens at 1920x1080 in the browser build with the mock provider; the gallery pictures in `docs/design/` were made that way (`gallery-en-US.webp`, `gallery-ar-SA.webp`, `live-*.webp`, `onboarding-*.webp`).
1. `pnpm mock` (with `pnpm mock:media` run once) and the TV dev build per `docs/runbooks/tv-setup.md`.
2. Open the app at 1920x1080, set the app language in Settings (English, then Arabic) or as the e2e specs do, add the `lablo` account, and capture with Playwright's `page.screenshot` into `artifacts/store-shots/<lang>/NN-name.png`. `artifacts/` is gitignored; the final images are NOT committed to this public repo until Omar approves them (keep them with the store accounts).
3. Real-TV captures (the Samsung and LG remote screenshot tools) are better for the store's "device" frame and are an `[needs TV]` extra: do them at step 47 if a store asks.

## Checks before upload
- Open each image: no real logo, no LAN address, no token, no personal name.
- Arabic images read right to left, numbers and Latin names isolated correctly.
- Same account state in all shots (no "expired" banner).
