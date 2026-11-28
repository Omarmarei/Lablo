# Lablo phase 2: the paid launch build

**Status:** approved by Omar on 2026-11-28 (planning session after relay leg 172).
**Relation to [PLAN.md](PLAN.md):** this plan extends it. Where they differ, this one wins. Mainly:
- Lablo is no longer free: a 6-week trial, then a lock.
- Accounts, sync and profiles move from v1.3 into the first store build.
- The Samsung minimum is 2020.
- The build targets Chromium 68.

**Steps:** RELAY.md phases 11–19 (steps 60–86) break this plan into session-sized steps.

## 1. Why
Steps 1–59 built v1 as a free player. What is left of v1 needs Omar or a TV: steps 16, 21, 34, 41, 42, 46 and 47.

On 2026-11-28 Omar chose three things:
- add 14 features;
- make Lablo a paid app;
- ship all of it in the first store build, rather than as updates.

## 2. Omar's decisions (2026-11-28)
1. **A paid app with no free tier.**
   - Every TV gets the full app for **6 weeks from its own install**. Then the app locks.
   - The trial length is a config value (`trialDays`).
   - A countdown shows from day 1, so the lock is never a surprise.
   - After the lock, Settings, diagnostics, support and backup stay open, so users can still reach their data and get help.
2. **The licence:**
   - 5 TVs, transferable, refundable within 14 days.
   - Two one-time products, each priced per country in the store dashboards: a **1-year pass** and **lifetime**.
   - No auto-renew. When a pass runs out, the countdown shows again.
3. **Purchase is in the launch build.**
   - The lock is switched per store and country by the signed config.
   - **On** where that store has approved payments: 6 weeks from install, then the lock.
   - **Off** where the store has not approved them yet: Lablo still launches there, with no countdown and no lock.
   - When the lock is switched on later, each TV there gets 6 weeks from that day.
4. **Closed-beta testers get a free lifetime licence** (vouchers).
5. **Samsung minimum: 2020** (Tizen 5.5, Chromium 69). 2018–2019 Samsung sets are dropped. ADR-015 (step 60) records it.
6. **Retarget the build from Chromium 53 to Chromium 68 first, before any feature.**
   - This changes CLAUDE.md's Chromium 53 rules. Omar gave his word by choosing this option.
7. **"These TVs are mine" is a Lablo code, with no email.**
   - The first TV makes a private code.
   - Other TVs join by QR, by a short code from a TV already in, or by typing the code.
   - We hold nothing that identifies the user.
8. **Everything first, launch later.**
   - All 14 features are in the first store build.
   - There is no Ramadan deadline.

**Not chosen, not planned:** faster zapping, multiview, USB recording, new platforms, B2B, DRM, white-label.

## 3. What exists (checked in the code at `7df8e7d`, 2026-11-28)
- **No licensing code.** The "Entitlements seam" that PLAN.md §5 and architecture.md (lines 33 and 3002) describe was never built.
  - The config's `flags` are signed and parsed into `policy.flags` (`packages/data/src/config-policy.ts:47,150`), but nothing in the app reads them.
- **The bundles have no room.**
  - Tizen main.js is 496.6 of 500 KB.
  - The query worker is 149.3 of 150 KB. Source removal already had to move to the ingest worker.
  - settings.js is 152.7 of 200 KB.
- **Pairing is one-shot.**
  - It carries one sealed payload from phone to TV, polled every 2 s, and one status word back (`apps/web/src/server/pair.ts:224-308`).
  - There is no long-term key on either side.
  - A lint rule bans WebSocket and EventSource in `apps/web` (`eslint.config.js:88,108-138`).
  - On the typed-code path, the phone gets the TV's key from our server (`apps/web/src/phone/code.ts:28-48`).
- **The backup gives a stable TV secret without the raw ID.**
  - It is `master = scrypt(DUID|LGUDID, …)`, cached in `kv` `backup.master` (`packages/crypto/src/backup.ts`, `packages/data/src/backup-service.ts:619-635`).
  - On the LG the LGUDID was the same after an update and after an uninstall and reinstall (`docs/spikes/results.md:31`).
  - A TV that answered "Not now" has a random backup code instead.
- **There is no production backend.**
  - `PRODUCTION_API_BASE` is `null` (`tv-defines.config.ts:25`).
  - R2 and Upstash exist only as interfaces with in-memory fakes (`apps/web/src/server/blob-store.ts`, `rate-limit.ts`).
  - `createServices` throws on Vercel (`apps/web/src/server/services.ts`).
- **Guard tests that new server data will break on purpose:**
  - `apps/web/test/web-db.ts:59-87`, a list of forbidden column words that includes `email`, `duid` and `udid`;
  - `apps/web/test/database.web.test.ts:67`, which pins four tables.
- **"Free" and "no account" are promised** in these places:
  - `docs/store/listing-en.md` lines 10, 17 and 42;
  - `docs/store/listing-ar.md`, the same lines;
  - `docs/store/beta.md` lines 104 and 127;
  - `packages/protocol/src/legal.ts` lines 108 ("free of charge"), 121 ("We have no account for you"), 163, and the Arabic mirrors;
  - these sentences are pinned by `legal.test.ts:85-98`.
- **Pieces that already exist and can be reused:**
  - **Catch-up:** seek, pause, go-live and play-on (`apps/tv/src/player/player-state.ts:1005-1079`).
  - **Lineup edits:** list, item and group reorder, plus channel hide, rename, renumber and lock (`packages/data/src/favourite-edits.ts`, `channel-changes.ts`).
  - **Video placement:** `setRect` on both engines (`packages/player/src/engine.ts:202`). The Lab plays video in a box on both TVs.
  - **Theming:** colour tokens in `packages/ui/src/styles/tokens.css`.
  - **Larger text:** the row-scale mechanism (`packages/ui/src/design/tokens.ts`, `apps/tv/src/player/appearance.ts`).
  - **Timers:** the minute tick (`apps/tv/src/live/live-state.ts:1096`).
  - **Full-screen overlays:** the config gate's own root, which takes every key (`apps/tv/src/gate/gate-state.ts`).
- **Pieces that don't exist:**
  - start over for the programme on air (`apps/tv/src/player/catchup.ts:80-82` requires a programme that ended);
  - pause or rewind on live (`player-state.ts:1353-1361` routes PLAY_PAUSE only for catch-up and movies);
  - mute in any engine;
  - prayer times, a Hijri calendar or a city list;
  - search over programme titles;
  - reminders;
  - a second theme;
  - any language beyond en and ar. Five places hard-code the two languages, and architecture.md:2996's "the catalogs already exist" is wrong.

## 4. What the stores say (read 2026-11-28)
### Samsung Checkout
**Facts from Samsung's pages:**
- **A Public Seller launches only in the US.** Partner status is needed to launch elsewhere or to "use certain APIs". ([entering application information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html), [becoming a partner](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-partner.html))
- **An app "with the 'Samsung Checkout' billing function" must declare `sso.partner`, `productinfo` and `billing`.** The SSO API's privilege level is "Partner". ([launch checklist](https://developer.samsung.com/smarttv/develop/distribute/launch-checklist.html), [SSO API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/sso-api.html))
- **Countries:** Checkout covers the US, CA, AE, SA, KW, QA, BH, OM and EG, in local currency. A Samsung account is mandatory. ([Samsung Checkout](https://developer.samsung.com/smarttv/develop/guides/samsung-checkout/samsung-checkout.html))
- **Product types:** Consumable, Non-Consumable, Limited Period (90 days at most), Paid App, Subscription and Dynamic Product. Prices are set per country, and a price can be changed only after 3 months. ([DPI portal](https://developer.samsung.com/smarttv/develop/guides/samsung-checkout/samsung-checkout-dpi-portal.html), [FAQ](https://developer.samsung.com/smarttv/develop/faq/samsung-checkout.html))
- **What the seller registers:** a bank account in DPI, a registration number for a company, and a tax email. ([managing a seller group](https://developer.samsung.com/tv-seller-office/guides/membership/managing-seller-group.html))
- **APIs:**
  - the Billing API: `buyItem`, `getProductsList`, `getUserPurchaseList`, `applyInvoice`, `verifyInvoice`, `getServiceCountryAvailability`;
  - REST at `checkoutapi.samsungcheckout.com/openapi`, signed with the DPI key. The key must never be exposed, so it belongs on our server.
  - ([Billing API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/billing-api.html), [purchase process](https://developer.samsung.com/smarttv/develop/guides/samsung-checkout/implementing-the-purchase-process.html))
- **Refunds** go through a Samsung ticket; there is no refund API.
- **Reviewers need:**
  - a test card and test buyers in the sandbox, which has no dummy pay;
  - a screenshot with the price;
  - vouchers for content behind payment.
  - "If a feature cannot be tested", certification fails. ([certification FAQ](https://developer.samsung.com/tv-seller-office/faq/certification-process.html))

**What we infer, to confirm by ticket:**
- **Samsung purchase most likely needs Partner status.** If so, Samsung US launches with the lock off until the Samsung Gulf contract is signed.
- **The 1-year pass:** Limited Period stops at 90 days, so the pass becomes a Consumable and our server keeps its year.
- **Lifetime** is a Non-Consumable.

### LG
**Facts:**
- "To provide paid products or content in your VOD or game app, In-App Purchase is required."
- "The LG Billing Service for In-App Purchase is no longer provided." LG recommends Paymentwall and "may ask you for a separate contract" for other providers. ([In-App Purchase guide](https://webostv.developer.lge.com/develop/guides/in-app-purchase))
- **Paymentwall's LG terms:** LG takes 20%; Paymentwall charges 3–5% plus $0.30 a card payment. There are payment QR codes and server pingbacks. ([Paymentwall LG TV](https://www.paymentwall.com/lg-tv), [Smart TV SDK](https://docs.paymentwall.com/integration/sdks/smart_tv))
- **webOS Pay is optional.** It is published for Europe and five Latin American countries only. ([Seller Lounge notice 7579](http://seller.lgappstv.com/seller/support/notification/RetrieveNoticeInfo.lge?seqNo=7579))

**Not found:**
- LG's payment coverage in the US or the Gulf;
- any written rule on trial-then-lock;
- any rule on a licence bought elsewhere. A forum question about this was sent to "Seller Lounge > 1:1 Q&A" ([forum](https://forum.webostv.developer.lge.com/t/in-app-purchase-policy-for-content-bought-on-our-website/28527)).

### Both
- Neither store has a written rule on IPTV players, on trial-then-lock apps, or on licences bought outside the store.
- Step 70 drafts the questions for Omar's two tickets (section 9).

## 5. Rules every step keeps
- **ADR-005 and ADR-006:**
  - Our servers never fetch provider URLs, and never hold URLs, channel names or logins in plaintext.
  - Everything new that crosses the server is sealed on the device. Each such step adds a "no plaintext" test (pattern: `e2e/no-plaintext.ts`).
  - Fixed store hosts are allowed (ADR-016). They are never a provider URL.
- **Telemetry** never carries URLs, hosts, channel names, credentials, IPs or a TV key. The licence's TV key is never sent as telemetry.
- **Store rules:**
  - Payments only through each store's approved route.
  - No league, team, broadcaster or provider names or logos in the app, the store copy or the screenshots.
  - No "free channels" wording.
- **Engines after the retarget:**
  - Chromium 68 is the floor. CSS grid is allowed.
  - Flex `gap` and logical properties are still out: Chromium 84 and 87 bring them.
  - Physical CSS with rtlcss stays.
- **New screens load on demand** (ADR-014). A lazy file may import only main.js.
- **TVs:**
  - Never ask Omar to act at a TV.
  - A `[needs TV]` check runs only when the TV answers by itself.
  - Mute Lablo after each launch.
- **Every step's "Done when"** covers:
  - failing tests first;
  - unit tests;
  - mutation for logic changes;
  - e2e in en and ar;
  - the text-fit check for new screens and rows;
  - budgets;
  - PR merged on green CI.

## 6. The features
All features are inside the one licence: on during the trial and with a licence, out of reach after the lock. They run on both platforms unless a feature says otherwise. Leg counts are estimated from the code; the reason is given where they differ from the rough chat numbers.

### 6.0 Enabling work (7 legs)
- **ADR-015, Samsung 2020 (step 60):**
  - amend ADR-012;
  - change `platforms/tizen/config.xml` `required_version="4.0"` to 5.5;
  - decide what `deviceTier`'s `low` tier means now (`packages/core/src/device.ts:25`): a memory signal, or nothing;
  - update the store pack and beta kit ("2018 or newer" becomes 2020);
  - close step 16 with the list of spikes that can no longer run.
- **Retarget to Chromium 68 (step 61), in four parts:**
  - Babel `preset-env` and core-js (`tools/build/src/bundle.ts`);
  - the syntax gate, ES2016 to ES2018 (`tools/build/src/syntax-gate.ts`, ADR-003);
  - the CSS gate (`css-gate.ts`), the engines harness (`tools/engines`: drop the 53 and 56 snapshots), and the CI `engines` job;
  - CLAUDE.md's cheat sheet.
  - Record the sizes. If main.js frees under 30 KB, catalogs and the pairing screen move into lazy files.
- **Shared pieces (step 62):**
  - an **alert host**: a card over any screen with a queue, on its own root like the gate's;
  - an **`extras` worker**: guide scan, reminders, prayer maths; its own 150 KB budget; it reads the guide stores read-only;
  - **`APP_LAZY` with several lazy files.**

### 6.1 Trial, licence, lock and purchase (#12 plus IAP): 20 legs
The rough estimate was 4–6 for the hook plus 6–10 for IAP. This plan adds the Lablo code and seats (3 legs) and two stores.

**What users get:**
- a countdown from day 1;
- a lock screen with "Buy" and "I already have a licence";
- a Licence page with their TVs (5 seats), where they add or remove a TV.

**Identity:**
- `licenceKey = HMAC(master, "licence")`.
- The server sees `tvId = b64url(HMAC(licenceKey, "id"))`, plus the hash of a secret that proves the TV owns it. That is the same "first writer claims it" pattern as the backup's `writeToken`.
- It never sees the raw device ID or the backup's `lookupId`.
- A TV that refused the device ID uses its backup code. A reinstall then resets that trial; counsel reviews the consent wording that explains this.

**Policy and state are kept apart:**
- **Policy** lives in the offline-signed config (`packages/protocol/src/config.ts`):
  - `licence.rules[]`: lock on or off, matched on platform, country and version, like the kill rules;
  - `trialDays`;
  - `graceDays` offline;
  - the accepted token keys.
- **State** is a per-TV **licence token**: `{tvIdHash, state: trial|licensed|locked|exempt, trialEnds, licence {kind, until}, seats, serverNow, expiresAt}`.
  - It is signed by an online Ed25519 key (`packages/crypto/src/sign.ts`), which rotates through the offline config.
  - A new licence worker verifies and caches it.
  - A clock that goes backwards never extends a trial: the worker keeps the largest `serverNow` it has seen.

**Server (`apps/web`):**
- Tables: Trial, Household, Licence, Seat, Voucher.
- Endpoints: check, redeem, household, seat, purchase, and the Paymentwall pingback.
- An admin CLI for vouchers, refunds and seat resets.
- Store verification calls go only to a fixed allow-list of store hosts (ADR-016).

**TV:**
- In main.js: a small state signal and the countdown chip.
- The lock is a gate that leaves Settings, Check the connection, Send a report, Help, Backup, About and Licence open.
- The lock, purchase and Licence screens are in a lazy `licence.js`.

**Stores:**
- `platform-tizen`: Checkout, with `sso.partner`, `productinfo` and `billing`. These are only in a Partner build flag, so the Public Seller build never declares them.
- `platform-webos`: Paymentwall, through the hosted form or a QR code to the phone.
- `platform-browser`: a fake store for development and e2e.

**Beta and reviewers:** vouchers for lifetime (testers) and for reviewers. A reviewer voucher can also show the locked state.

**Crosses the server:** the TV hash, the secret's hash, the platform, dates, licence kind and until, seats (with sealed labels) and store receipt references. No provider data.

**TV checks:**
- a sandbox purchase, the lock and restore after reinstall, on each TV;
- the Samsung half waits for Partner status and DPI.

**Risks:**
- The stores may refuse a trial-then-lock playlist player. No rule is written; ask first (section 9).
- Samsung Partner approval.
- Paymentwall's coverage in the Gulf.
- A merge or seat bug could lock a paying user. The server's state wins; there is a voucher and a support path.

### 6.2 The Lablo code and sync across TVs (#6): 12 legs
The rough estimate was 10–15. The code and seats are 3 legs inside 6.1; sync is 9.

**What users get:** one code that says "these TVs are mine". It carries the licence, and it keeps favourites, lists, channel edits, progress and settings the same on every TV.

**Design:**
- **The household key:**
  - It comes from a random Lablo code, in the format of `packages/crypto/src/backup-code.ts`.
  - It is kept in `kv` and sealed in the backup.
- **Joining a TV:**
  - by a QR or short code from a TV already in (a new pairing purpose, `link`, in `packages/protocol/src/pairing.ts`; the household key goes to the new TV sealed);
  - or by typing the Lablo code.
- **Sync:**
  - Profile sections are sealed under keys from the household key and stored by `HMAC(hk, "sync")` with a revision.
  - Each TV merges per section: items carry times, and deletes are tombstones.
  - Sources go only with "Include logins and links" on, as in the backup.

**Crosses the server:** ciphertext, sizes, revisions and dates.

**Risks:**
- Merge bugs that lose data: property tests, plus the 3 local snapshots that already exist.
- A lost code on a dead TV: the code is shown at purchase and in Settings behind the PIN.

### 6.3 Phone companion (#1): 15 legs
The rough estimate was 10–15. It needs a new real-time service (5 legs) that the family helper reuses.

**What users get:** the phone as a remote and a keyboard, search on the phone, and a lineup editor.

**Design:**
- **The relay:** `apps/relay`, a Cloudflare Worker with Durable Objects and WebSocket. It carries ciphertext frames only (ADR-017).
- **Keys:**
  - The QR fragment carries the TV's key.
  - X25519 gives a session key (`packages/crypto/src/pairing.ts`), with sealed frames, counters and a replay guard.
- **Remote and keyboard:**
  - Keys arrive as `Intent`s into `Navigator.handle` (`packages/ui/src/focus/navigator.ts`, `remote.ts:42`).
  - Typed text goes to the focused field.
- **Search:** it runs in the TV's query worker, and the sealed results are paged to the phone.
- **The lineup editor:**
  - It sends the existing `ProfileEdit` operations through `DataEngine.editProfile`.
  - The TV pages its lineup to the phone, group by group.
  - Reordering channels inside a provider group is a new data operation. It is in step 78g only if it fits the 2,000-edit cap.
- **The phone page** is `/r` in `apps/web`, in en and ar. The lint and CSP allow the relay host on that route only.

**TV checks:** key to focus move in under 300 ms on both TVs.

**Risks:** a new service and vendor; abuse of the relay (rate limits, short-lived rooms).

### 6.4 Family helper (#5): 6 legs
The rough estimate was 6–10.

**What users get:** a helper's phone stays trusted by a parent's TV. While Lablo is open there, the helper can edit favourites and settings and add sources from anywhere.

**Design:**
- It uses the companion's relay, plus a long-term phone key that the TV stores after an approval on the TV.
- **The typed-code path takes the TV's key from our server.** So enrolment shows a short number on both screens to compare.
- The TV shows "Helper connected", and lists trusted phones with a remove option.
- Parental changes still need the PIN on the TV.

**Risks:** misuse by someone the parent didn't approve. The approval on the TV and the visible mark are the guard.

### 6.5 Pause/rewind live and start over (#2): 7 legs
The rough estimate was 8–12. Catch-up seek and pause already exist.

**What users get:**
- "Start over" for the programme on air;
- pause on live, with "behind live" and "Go live";
- rewind on live inside the provider's catch-up window.

**Design:**
- **Start over:** `inArchive` accepts the programme on air. It is on the info bar and on the guide's current cell.
- **Pause and resume on live:**
  - When a channel has catch-up, resuming opens catch-up from the pause minute.
  - Without catch-up, pause is a plain pause: resuming reopens live, with a hint.
- **The newest minutes:** when the provider refuses them, the player steps back a minute, then falls back to live. The lag it found is remembered per source.
- **The mock** gets an in-progress archive with a lag setting (`apps/mock-provider/src/streams.ts:115-130`).
- The screensaver stays away while paused.

**TV checks:** both TVs, together with step 41's open catch-up list.

**Risks:** how late real providers' archives run is unknown; one-minute URL steps; one connection.

### 6.6 Live preview while browsing (#7): 5 legs
The rough estimate was 4–6.

**Design:**
- A preview rect in the controller, separate from the picture mode.
- The live screen gets a box with a transparent hole.
- A channel plays there once the focus rests on it.
- OK goes full screen without restarting the stream.
- Locked, adult and radio channels never preview. A setting turns the preview off.

**TV checks:** rect accuracy, black flashes, the 4:3 picture mode.

**Risks:** provider connection limits; starts take 1.3–1.9 s.

### 6.7 Follow my team and reminders (#4): 7 legs
The rough estimate was 6–9.

**What users get:** the user types a text. The app lists upcoming programmes that match it across all channels and can remind them.

**Design:**
- **The scan:**
  - The extras worker scans programme titles across the guide buckets (`packages/core/src/epg-guide.ts`, with the matching from `packages/core/src/search.ts`).
  - It works in chunks, per guide generation.
  - The result is cached per text and refreshed after each guide refresh.
- **"My teams"** is a lazy page; the matches are grouped by day.
- **Reminders:**
  - an optional profile field;
  - "Remind me" on a programme's details;
  - an alert through the alert host, only while Lablo is open (a closed app can't be woken).
- No names or logos ship with the app.

**Risks:** scan time over about 670k programmes on the Samsung. Benchmark first.

### 6.8 Ramadan and prayer pack (#3): 7 legs
The rough estimate was 4–6. It adds a mute that the engines don't have, and a city list.

**What users get:**
- prayer times for a city the user picks;
- an alert that can pause or mute;
- Iftar and Suhoor countdowns in Ramadan;
- the Hijri date.

**Design:**
- **Prayer maths** in `packages/core`:
  - methods: Umm al-Qura, MWL, ISNA, Egypt, Karachi, Gulf, Dubai;
  - Asr: Shafi'i or Hanafi;
  - a high-latitude rule;
  - published test vectors.
  - Times are computed in UTC from the coordinates and shown in the TV's own zone.
- **The Hijri date:** an Umm al-Qura table with a ±1 day adjust.
- **The city list:**
  - GeoNames (CC BY 4.0: credit in About), names in en and ar, in a lazy file.
  - The city never leaves the TV, except sealed in the backup and sync.
- **Mute:** `<video>.muted` on webOS and the desktop. On Tizen, the route is checked in refine-first (`tizen.tvaudiocontrol`, privilege `tv.audio`).

**Risks:** accuracy. Per-prayer minute adjusts, "follow your local mosque" wording, and a native review.

### 6.9 Viewer profiles and a kids profile (#8): 8 legs
The rough estimate was 5–8.

**Design:**
- **Profile document v11.** v10 is sync's item times.
- **Per viewer:** favourites, lists, recents, progress and player preferences.
- **Shared:** sources, guides, channel edits and parental.
- **Kids:** an allow-list of lists and groups, with exit by PIN.
- A "Who's watching?" picker.
- Limits on viewers and on each viewer's data keep the backup under its cap (`packages/protocol/src/backup-limits.ts`).

**Risks:** the migration (`profile.test.ts` pins every version's shape); compatibility with backup and sync.

### 6.10 Layouts, light theme, themes (#10): 6 legs
The rough estimate was 4–6.

**Design:**
- `html[data-theme]` palettes, with a contrast test for each theme (`test/ui-tokens.test.ts`). The player's overlays stay dark.
- Density, logo size and guide density through the row scale.
- An optional channel grid view.
- An Appearance page.

**Risks:** the text-fit matrix grows (density × Larger text × languages).

### 6.11 French (Canada) and Spanish (US) (#9): 8 legs plus a native review
The rough estimate was 4–6. The two-language assumption is in the runtime, `format.ts`, five language lists, the keyboard, track languages, help, legal, the phone page and the listings.

**Design:**
- An N-language runtime (`packages/ui/src/i18n/runtime.ts`, `format.ts`, `packages/core/src/plural.ts`).
- Catalogs beyond en load on demand.
- Accented keys on the app's own keyboard.
- Built last, so every string is translated once. Counsel reviews the legal text in both languages.

**Risks:** text fit; CI time (a separate shard).

### 6.12 Speed test (#11): 2 legs
- A signed-config field names a file on our CDN (`speedTest`, modelled on `testStream`, `packages/protocol/src/config.ts:59-66`).
- An XHR download is timed for a few seconds; the result and a verdict show on "Check the connection" (`apps/tv/src/settings/connection-check.ts`).
- Nothing is sent.

### 6.13 Growth links (#13, web): 3 legs
- A landing page `/` (none exists).
- On the phone page's success screen: "Share with family" and "Rate Lablo" (the store page for the TV's platform).
- An email opt-in:
  - a `Subscriber` table, apart from every TV and household record;
  - double opt-in and unsubscribe;
  - the guard tests allow `email` in that table only;
  - `legal.ts` says it.
- The email provider is Omar's (step 34).

### 6.14 Setup-funnel telemetry (#14): 2 legs
- A new event kind for install, first source, first play and day-7 return. Step 72 adds the trial, purchase and lock steps to it.
- Sending starts in onboarding, after the telemetry note has been shown. Today it starts at the live screen (`apps/tv/src/main.tsx:885`).
- It carries the random install ID only.

## 7. Order and size
| Phase | RELAY steps | Legs |
|---|---|---|
| 11 Enabling | 60 ADR-015; 61 Chromium 68; 62 alert host, extras worker, lazy files | 7 |
| 12 Small and server basics | 63 funnel telemetry; 64 speed test; 65 R2 and Upstash adapters | 6 |
| 13 Player | 66 start over and pause/rewind live; 67 live preview | 12 |
| 14 Guide and prayer | 68 reminders and follow my team; 69 Ramadan and prayer pack | 14 |
| 15 Licence and purchase | 70 design; 71 server; 72 TV state and lock; 73 Lablo code and seats; 74 purchase flow; 75 LG; 76 Samsung | 20 |
| 16 Real-time | 77 relay; 78 phone companion; 79 family helper | 21 |
| 17 Sync and profiles | 80 sync; 81 viewer profiles | 17 |
| 18 Appearance, growth, languages | 82 themes and layouts; 83 growth links; 84 French and Spanish | 17 |
| 19 Release | 85 texts, legal, store pack; 86 regression; TV checks (21, 41, 42, the LG soak after 59); 34; 46; 47 | 16 |
| **Total** | | **about 130 (115–145)** |

**Dependencies:**
- 61 comes before everything.
- 62 comes before 68, 69 and 72.
- 70 → 71 → 72.
- 73 comes before 80.
- 77 → 78 → 79.
- 80 comes before the sync part of 81.
- 84 comes after every string exists.
- 34 comes before 46.
- The store adapters' TV checks wait for Omar's store accounts.

**Time:**
- At the recent pace (legs 145–172: 5.6 a day) the build is about 23 days. At 4 a day it is 33.
- So code complete is late December at best, and mid-January is more likely.
- Then come a 2-week beta, the submissions, LG QA (2–3 weeks) and Samsung review (1 week to 3+ months).
- The relay run's cap is 200 sessions and it is at 172. Raise the cap or start a new run before phase 2.

## 8. Only Omar can do
| By | Item |
|---|---|
| now | Rotate the lionz provider password. Back up the Samsung `author.p12` in two places. |
| 1 Dec | Submit the Samsung Partner application (Samsung Gulf). Purchase on Samsung depends on it. |
| 3 Dec | Send the two store tickets from section 9 (Claude drafts them in step 70; if you send them earlier, use section 9 as it is). |
| 5 Dec | The publishing company, which the stores, Paymentwall and counsel all need. Brief counsel on: ToS and privacy for a paid app, the 14-day refund policy, the DMCA agent. |
| 10 Dec | Step 34: the domain, Vercel, Neon, R2, Upstash, Cloudflare Workers and an email provider. The config key ceremony and the licence-signing key, each backed up in two places. |
| 12 Dec | Samsung DPI: the bank account and registration number. A Paymentwall merchant account. Trademark clearance (US, CA, AE, SA). |
| 20 Dec | The public test server. The beta route per store and 10–30 testers. Native reviewers for Arabic, French (Canada) and Spanish (US). |
| 5 Jan | Counsel's text. Prices per country in both stores. Test buyers and a test card for the reviewers. |

Each production deploy, migration and store submission still needs his one-word OK.

## 9. The questions for the stores
**Samsung (Seller Office 1:1 Q&A):**
1. May a Public Seller app (US only) sell in-app products with Samsung Checkout? Or are `sso.partner` and Checkout limited to Partner sellers?
2. Is an app allowed that gives a full-featured free trial of a fixed length and then requires a purchase to keep working? Settings and support stay open after the trial. The app is a media player for the user's own playlists.
3. May a licence bought in the app on another TV brand, or on our website, unlock the app on a Samsung TV for the same user?
4. Can a 1-year, non-renewing licence be sold as a Consumable whose term our server keeps, since Limited Period products stop at 90 days?

**LG (Seller Lounge 1:1 Q&A):**
1. Is Paymentwall available for webOS apps sold in the US, UAE, Saudi Arabia, Kuwait, Qatar, Bahrain and Oman? Is webOS Pay offered to third-party apps there?
2. The same trial question as Samsung 2.
3. The same question as Samsung 3, from the LG side.
4. What should the submission form's "Test Account/Password" and "Voucher Code" fields hold for a paid feature that reviewers must unlock?
