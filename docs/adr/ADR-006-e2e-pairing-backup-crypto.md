# ADR-006: End-to-end pairing and backup crypto

- **Status:** Accepted
- **Date:** 2026-11-01
- **Source:** docs/architecture.md §3.3

## Context
Typing playlist URLs and passwords with a TV remote is the top onboarding complaint, so Zoma pairs with a phone. LG packaged apps lose local storage on app updates, so the user's profile (sources, favourites, settings) needs a cloud backup that restores automatically. Both features must work without our server ever seeing credentials (ADR-005). Chromium 53 and `file://` pages may lack WebCrypto `subtle`.

## Decision
All primitives come from **tweetnacl** (X25519, XSalsa20-Poly1305, Ed25519) and **@noble/hashes** (SHA-256, HMAC, HKDF, scrypt). Both are pure JavaScript, wrapped in `packages/crypto`, and shared by the TV and the phone page with common test vectors.

**A. Pairing.**
1. The TV makes an ephemeral X25519 keypair (memory only) and registers `tvPk`. The server stores `sha256(code)`, `tvPk` and `sha256(pollToken)`. The code is 8 Crockford base32 characters, valid for 10 minutes and rate-limited.
2. The QR code carries the code and `tvPk` in the URL fragment, which is never sent to the server.
3. The phone sends `nacl.box(payload, nonce, tvPk, phoneEphSk)`. M3U files are encrypted with a random `fileKey` in 1 MB `secretbox` frames and uploaded through a presigned PUT; the key travels inside the boxed payload.
4. The server deletes the payload once the TV reads it. The TV reports back only a status category.

**B. Backup.**
```
master     = scrypt(deviceSecret, salt="zoma.backup.v1|"+platform+"|"+appId, N=2^15, r=8, p=1, dkLen=32)
lookupId   = b64url(HMAC-SHA256(master, "lookup"))
writeToken = HMAC-SHA256(master, "write")      (server stores sha256(writeToken) on first write)
encKey     = HKDF-SHA256(master, info="enc")   localKey = HKDF-SHA256(master, info="local")
envelope   = {v:1, kdf:"scrypt-15-8-1", nonce:24B, ct: secretbox(gzip(profileJSON), nonce, encKey)}
```
- `deviceSecret` is the Samsung DUID or the LG LGUDID, or a random 128-bit "Backup code" shown in Settings when neither is available.
- At startup with no local profile, the TV derives `master`, fetches and decrypts the envelope, and restores automatically.
- Credentials on the TV are encrypted with `localKey`.

**C. Config signing.** An offline Ed25519 key signs `config/config.json` (`tools/sign-config`). The app embeds two public keys for rotation and rejects unsigned or expired config.

## Consequences
- **Protected:** database leaks, insiders, and requests for plaintext (we don't have it). **Not protected:** someone holding both our database and the physical TV's device ID. A later optional user PIN mixed into the KDF hardens this.
- scrypt with N=2^15 takes seconds on 2018 TVs, so it runs once in a worker and the result is cached in IndexedDB.
- An automated "no plaintext" test searches every DB row and stored object for the test password (RELAY step 31).
