# ADR-013: Logins on the TV are not encrypted at rest; everything that leaves the TV is

- **Status:** Accepted. Omar chose this on 2026-11-19 (relay leg 115, RELAY step 32e, option A), over sealing every copy (B) and sealing the profile only (C).
- **Date:** 2026-11-19 (relay step 32e)
- **Amends:** ADR-006 B ("Credentials on the TV are encrypted with `localKey`"); docs/architecture.md §3.3 B ("Credentials on the TV are encrypted with `localKey` and decrypted only when building a URL") and the step notes that said "step 32 encrypts it"; docs/PLAN.md §4 "Trustworthy", the legal risk checklist's item 8 and the storage plan for the webOS update wipe.

## Context
- **The plan:** `localKey = HKDF-SHA256(master, info="local")`, and the logins on the TV sealed under it, opened only when a URL is built (ADR-006, architecture.md §3.3 B). Step 32 built the backup first and left this seal for last (32e).
- **The key would sit beside the logins.** The backup master is cached in IndexedDB (`kv` `backup.master`, step 32b), so a `localKey` derived from it protects nothing against a copied database. Not caching it means scrypt at every start before the first play: 1 s on Chromium 53, 3.4 s on 56, perhaps 10 s or more on a 2018 TV. That breaks the plan's "opens on the last channel in under 3 seconds". Wrapping the cached master under a key from the device ID, read at each start, avoids the cost. But whoever can copy a TV app's database (Dev Mode root, a dump of the TV's flash) holds the TV and its ID too. On a TV that answered "Not now", the only secret is the backup code, which sits in that same database.
- **The login isn't only in the profile.** Writing 32e's shape found it in plain text in:
  - **every stored stream URL:** `catalog_chunks`, up to 200k items a source. An Xtream item's `url` is `xtreamStreamUrl(account, …)`, that is `/live/<user>/<password>/<id>.ts`. An M3U item keeps the provider's URL as given, and nothing separates a login in its path or query from the rest;
  - `sources_meta.epgUrls` (an M3U's `url-tvg`, often a panel's `xmltv.php?username=…&password=…`);
  - the profile's sources and guides, `player.last.item` and every `channels[].item` (step 32d4a).

  Sealing the profile alone would leave the password beside it 200k times over.

## Decision
- **Logins on the TV are stored unencrypted in the app's IndexedDB:** the profile, the recent channels and the catalog's stream URLs. There is no seal under `localKey`, and no profile version 10 for one.
- **Everything that leaves the TV stays encrypted, and the logins never reach our servers in plain text:**
  - the phone pairing is end to end (ADR-006 A; step 31e's "no plaintext" test);
  - the backup is sealed on the TV under `encKey` (ADR-006 B; step 32d1's "no plaintext" test), and "Include logins and links" off leaves the logins out of it (step 32d4);
  - ADR-005: our servers never touch provider URLs.
- **They are never logged and never sent as telemetry.** CLAUDE.md's telemetry rule and step 33's URL and credential scrubber cover this.
- **`localKey` stays in `backupKeys`, derived and unused.** The shared vectors and the old engines' checks pin it, and removing it would change them for nothing.
- **How it is described:** never "encrypted on the TV". Say instead "encrypted end to end whenever they leave the TV; our servers never see them". The privacy policy and the store listing (written with counsel) say the same.

## Options not taken
- **(B) Seal every copy:** the profile's logins and links, the recent channels' URLs, `epgUrls`, and every stored stream URL (Xtream items stored without the account and built at play time, M3U URLs sealed in their chunks), under a `localKey` from a master wrapped by the device ID. It would take 4 to 6 relay legs (the catalog's ingest version and every reader: the query worker, the player, catch-up, the EPG, the recents, the backup, the old-engine proofs), plus a device-ID read and a decrypt before the first play at every start; main.js has 25 KB left on Tizen. It would protect a copied database only on a TV that allowed the device ID, and only against someone who doesn't also have the TV.
- **(C) Seal the profile only,** as first planned, under a `localKey` from the cached master. That is about 2 legs, and the password would stay in plain text in every stored stream URL beside it. Step 32's decision ruled out a seal that only pretends.

## Consequences
- **Whoever can read the app's storage can read the logins:** the TV in Dev Mode or rooted, or a copy of its flash. With the TV alone, they can watch the channels anyway. Each platform keeps a packaged app's storage to that app; we rely on that and have not tested it ourselves.
- **No start pays for a decrypt or a device-ID read before the first play.**
- **Later hardening, if wanted:** a user PIN mixed into a key (ADR-006's "later hardening" for the backup). It would be the one secret not stored on the TV, at the cost of typing it at every start. A platform key store bound to the device would do the same without a PIN. Either would need a new ADR.
