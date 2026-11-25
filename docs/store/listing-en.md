# Store listing: English

Used by both stores (LG Seller Lounge, Samsung Seller Office). Draft written in step 44; counsel and the native Arabic review (step 46) may change words. Facts in it come from `docs/PLAN.md` §4 and what the app does today; if a feature is cut, cut its line here too.

## Name
- **Store listing name:** Lablo IPTV Player (Omar's answer, 2026-11-25)
- **Title on the TV (app manifest):** Lablo

## Short description (max 80 characters)
> A fast, free player for your own IPTV playlist. English and Arabic.

## Tagline (one line, for banners)
> Your playlist. Your TV. Nothing in between.

## Long description

**Lablo provides no content.** Lablo is a player. You add your own playlist (an M3U link or an Xtream login) from a service you have the right to watch, and Lablo plays it. There are no channels, no playlists and no subscriptions inside the app.

**Starts fast.** Lablo opens on the channel you watched last. Your library is kept on the TV and refreshed in the background, so you never wait for a reload.

**A real TV guide.** Browse up to seven days of programmes in a grid, jump to what is on now, and watch past programmes where your provider offers catch-up.

**Set up with your phone.** Scan the code on the screen, then type or paste your playlist on your phone. Typing on the TV works too. A family member can set up a parent's TV from their own phone.

**Made for Arabic and English.** Choose Arabic (right to left) or English inside Lablo, whatever language the TV uses. The remote works the way you read, and the on-screen keyboard has an Arabic layout.

**Live TV, movies and series.**
- Category list that stays smooth with very large playlists
- Number keys, channel up and down, previous channel
- Several named favourites lists; hide, rename or renumber channels
- Movies and series with posters, resume, "Continue watching" and next episode
- One search across live channels, movies and series, in Arabic and Latin script

**Good player controls.** Pick the audio language and subtitles, load your own subtitle file, change the picture size, see stream details, and let Lablo reconnect when a stream stalls. A sleep timer asks "Still watching?".

**Is it the app or my provider?** A built-in check tells you whether a problem is the playlist server or the app.

**Yours to keep.** Favourites, hidden groups, locks and watch history come back after an update or a reinstall through an encrypted backup.

**Family controls.** Lock categories or channels behind a PIN. Adult-looking groups start locked.

**Private by design.** No ads and no sign-up. Your playlist address and login leave the TV only encrypted, and our servers cannot read them.

**Accessibility.** Larger text, captions and a Voice Guide that reads the screen (where the TV supports it), and full control from the Magic Remote pointer or the arrow keys.

### Important
Lablo does not provide, sell, host or link to any channels, streams, playlists or subscriptions, and it is not affiliated with any content provider. You are responsible for having the right to watch what you add. Support and notices: lablo.iptv@gmail.com

## Keywords (LG and Samsung search tags)
player, playlist, m3u, xtream, tv guide, epg, arabic, live tv, movies, series, favourites

Do NOT use: any broadcaster, league or provider name; "free channels"; "unlimited"; "codes"; "reseller".

## Category
Video / Entertainment (the store's player category). Not "News", not "Sports".

## Age rating
Answer the stores' questionnaires as **a general-purpose player with no content of its own**, user-supplied content, and a PIN-based parental lock. Do not claim a rating higher or lower than the questionnaire gives. Record the rating the store assigns in RELAY.md's progress row at step 47.

## What's new (first release)
> First release. Add your own M3U or Xtream playlist, browse the guide, and watch in English or Arabic.

## Links to give the store
- Privacy policy: `https://<official domain>/privacy` (apps/web serves `/privacy` and `/terms` from `packages/protocol/src/legal.ts`; the domain is step 34 and Omar's)
- Terms of service: `https://<official domain>/terms`
- Support: lablo.iptv@gmail.com
- **Blocked until counsel's text is in** (`LEGAL_DRAFT` false): do not submit with the draft mark on the pages.
