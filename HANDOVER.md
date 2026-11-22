# Lablo IPTV: relay leg 135 opening prompt

You are leg 135 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–133 did steps 1–33, 35, 35e and 36 (PRs #1–#159).
- **Leg 134 (2026-11-22) shaped step 37 and finished 37a.**
  - **Step 37's shape and split** are in RELAY.md (under `- [ ] 37.`). Every question was settled from the code and PLAN.md, so no question went to Omar:
    - only a source being added upgrades; stored and restored M3U sources keep their type and keys (nothing has shipped, so no user has one);
    - the upgrade is silent (PLAN.md: "automatically"); Settings › "Sources" shows "Xtream login";
    - radio stays in its groups;
    - the TV's screensaver during radio waits for the TV session.
  - **37a, the M3U→Xtream upgrade at add:**
    - the loader (`engine-loader.ts`) tries the panel's API for an Xtream link given as a playlist (`xtreamFromM3uUrl`) and saves an Xtream source when that works;
    - on any failure but `expired`, `blocked` and `blocklisted` it reads the link as the playlist (`triesPlaylist`);
    - the upgrade's login gets the panel login's 10 s limit, and a cancel ends it (`IngestSource.upgrade`, `limited` in ingest.ts).
  - **PR #160 merged as `2d58ea7`** on green CI at the first run.
- **Your step: 37b (radio).** Its shape is in RELAY.md step 37's "Shape" (the radio bullets) and "Split"; its leads are under `- [ ] 37b.` Build it, then tick 37b and step 37.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - step 37's "Facts found in leg 134", "Shape" (radio: the hint, the stage card, no rail entry, the screensaver later) and "Split" (37b's "Done when");
   - 37b's "Leads for the leg that starts it";
   - 37a's notes as the model;
   - the last progress row (134).
2. **architecture.md:**
   - §2 around lines 1371 and 1425: the first frame and `NO_PICTURE`; radio in "Not yet";
   - §1.2 "Built in step 37a": the latest block, the style to follow.
3. **The code:**
   - `packages/player/src/request.ts` (`PlayRequest.hints` ~40), `engine.ts` (`LoadOptions` ~162), `controller.ts` (`engine.load` ~736), `html5-engine.ts` (`Load` ~137, `poll` ~520, `resume`), `fake-engine.ts`;
   - `packages/platform-tizen/src/avplay-engine.ts` (`observe` ~470: it frames by the clock already);
   - `apps/tv/src/player/player-state.ts` (`liveRequest` ~448), `catchup.ts` (`catchupRequest` ~108), `PlayerScreen.tsx` (the route ~360);
   - the mock's radio channel: `apps/mock-provider/fixtures/catalog.yaml` id 108, and `.cache/media/live/live-108-*` (HLS, MP3 in TS segments, no video);
   - `e2e/player-media.spec.ts` (`pnpm e2e:media`).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `a1e248c` (PR #160's merge recorded, 37a ticked, row 134, 37b's leads), `2d58ea7` (PR #160's merge), `b1ff834`;
   - `origin/main` is `2d58ea7`;
   - no `*.mutbak` anywhere (`find` outside node_modules);
   - `docker ps` shows only `lablo-web-postgres-1`;
   - free memory (leg 134 started with 32.3 GB of free commit).
2. **Confirm 37b isn't partly done:** grep `audioOnly` in packages/player and apps/tv; `git log`.
3. **Check first that desktop Chromium plays the mock's radio** (HLS with MP3 in TS segments) through Html5Engine. If it doesn't, `e2e:media` can't prove the play. Decide then: an AAC radio profile in the mock means a media regeneration, so see the memory on the CI media job first.
4. **Build 37b:**
   - the hint (`hints.audioOnly` from `item.radio`, in live and catch-up requests) → `LoadOptions.audioOnly` → Html5Engine frames by the clock and never reaches `NO_PICTURE`;
   - the stage's radio card: the logo, or a radio mark without one, and the name, centered, under the bar, badge and error card;
   - unit tests;
   - e2e in en and ar for the card (screenshots looked at), and the en-XA walk;
   - `e2e:media` for the play.
5. **The gates:**
   - mutation: the list written first (`artifacts/mutate37b-list.md`), the runner copied from `artifacts/mutate37a.py`;
   - `build:tv` sizes and a module diff;
   - `verify:engines --engine chrome53 --engine chrome68`, alone;
   - full `pnpm test`; `pnpm typecheck`; `pnpm lint`;
   - architecture.md "Built in step 37b" (radio out of §2's "Not yet");
   - the RELAY.md ticks (37b, then 37) and a progress row.
6. **The PR**, merged on green CI (merge commit, keep the branch), with the three riskiest changes named first.
7. **Then step 38** (parental PIN, adult groups, the complete settings screen) needs its shape written first, as 35, 36 and 37 had.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`2d58ea7`) plus:
  - `a1e248c` (docs: PR #160's merge recorded, 37a ticked, row 134, 37b's leads);
  - this handover's commit (docs: HANDOVER.md).
- **No PR is open.** `main` is `2d58ea7`; the main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (`.cache/media` holds the generated media), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 134's full `build:tv` (37a);
  - in `artifacts/`: `mutate37a.py` (27/27, the runner to copy), `mutate37a-list.md`, `mutate37a-a.log`, `-b.log`, `-c.log`, `engines-37a.log`, `engines-37a-53-again.log`, `build-tv-37a-leg134.log`, `unit-37a-leg134.log`, `typecheck-37a-leg134.log`, `lint-37a-leg134.log`, `e2e-37a-upgrade.log`, `e2e-37a-touched.log`, `e2e-37a-web.log`, `e2e-37a-web2.log`; screenshots `artifacts/screenshots/m3u-upgrade-*`.

## Verified vs not
- **Verified (37a, on CI too):** PR #160 green at the first run: verify 13 m 59 s, engines 27 m 2 s, media 11 m 23 s, web 3 m 6 s.
- **Locally in leg 134:**
  - unit 8,073 (+19), typecheck and lint;
  - `build:tv`: main.js 433.9 KB on Tizen (+0.3), 421.2 KB on webOS; settings.js 78.5 KB; the ingest worker 136.2 KB; core-js unchanged (216 / 6, module diff);
  - e2e: `m3u-upgrade.spec.ts` 4 passed, the touched chromium specs 24, the touched `e2e:web` specs 13;
  - mutation 27/27;
  - `verify:engines` 53/68: 26/26 (Chromium 53 rerun after the stuck-delete flake).
- **Not yet:** 37b (radio: all of it); production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 134:**
- **Since 37a, the mock's `get.php` link added through the loader (the form or the phone) becomes an Xtream source.**
  - To test a playlist's own behaviour, use `e2e/playlist-only.ts`: `playlistOnly()` as the mock's `scenario`, or `PLAYLIST_ONLY_RULE` beside other rules. It fails only `get_live_categories`, so the login (ADR-010's zone) still answers.
  - Where one mock also serves Xtream logins, set `app.mockState.scenario = playlistOnly()` just before the playlist's add, and reset it in `test.afterEach`.
  - Tests that call `runIngest` with `{type: 'm3u'}` directly are unaffected: the upgrade is the loader's.
- **The stuck IndexedDB delete on Chromium 53 happened locally** in a combined `--engine chrome53 --engine chrome68` run: the English walk passed, then every later run said "could not be deleted … (pending)". `--engine chrome53` alone passed 13/13. Rerun before suspecting the change.
- **A time limit raced against a request:**
  - clear the timer once the request wins, and test a slow step *after* the limited one (mutation found the gap: lists past 10 s would have been cut off);
  - race the cancel token too, since a cancel while `fetch` waits for headers has no response to cancel yet.
- **The loader still asks for the guide after a cancelled refresh resolves** (with the cancelled token). A loader test of a cancel checks only that nothing is saved.
- **The `e2e:web` specs** (pairing-api, no-plaintext, backup-api, backup-logins): `pnpm exec playwright test -c playwright.web.config.ts <specs>`. They need the docker Postgres and `apps/web/.next`.
- **Main's module diff:** a probe copy is at `C:/Users/Omarm/.claude/jobs/6d0bbb33/tmp/mprobe.mts` (job folders can vanish; memory `iptv-tv-bundle-polyfills.md` describes it). With the change committed: `git checkout <base> -- <changed main files>`, probe, `git checkout HEAD -- <files>`.

**From legs 130–133 (still true):**
- **A second source in e2e needs no pairing:** push a record into the profile's `sources` from `/?screen=gallery` after `appIdle`, then start; the schedule's first check (15 s) ingests it (`e2e/two-sources.spec.ts`).
- **en-XA's pseudo labels end in `]`:** look for ` [` inside the text.
- **An e2e that refreshes the catalog** waits for the guides' `/xmltv.php` request (after `onCatalog`), then `settled`, before playing.
- **A CI e2e failure's URLs:** `gh run download <run> -n playwright-report -D <dir>`, unzip `trace.zip`, read `*.network`. `gh run view --log-failed` gives nothing while another job runs: use `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`.
- **Mutation:**
  - when a guard's mutant survives, check whether another guard always decides first; if so, take the code out;
  - write the list first, `--check` until every snippet is found once, run in foreground chunks with `MUT_TIMEOUT`, and restore any `.mutbak` with `mv`.
- **Sizes:** main.js has a hard 500 KB budget on Tizen (433.9 now, 87%). Mention sizes only when they decide something or near the budget; never put 0.5–2 KB in front of Omar as a reason.
- **The player's pin is a signal,** cleared when the player closes. The info bar overflows the safe area in en-XA (since step 20c2b): scope en-XA `untranslated()` to `.player__actions`.
- **Forms:** a number form uses `type="tel"`; a TextField that starts filled needs `Control+A` before typing.
- **A local full `pnpm test`** can time out `xtream-xmltv-core.test.ts` under load: rerun the file alone first.
- **Shell:** `python -c` with nested quotes and bash heredocs with quotes fail. Write the patch script with the Write tool (an EDITS list with `assert s.count(a) == 1`, `newline=''` on read and write), then run it.
- **The relay context check fires at ~450k tokens.** A step with screens takes a whole leg for build plus e2e.

**From legs 125–129 (still true):**
- **e2e on the live screen:**
  - UP reaches the header only from the list's first row;
  - UP from the rail lands on the header's last-focused button;
  - in Arabic the rail is right of the list;
  - `[data-testid=live]` is absent while search, guide or settings paint.
- **Settings' e2e paths:** Home `live/header/3`, Search `4`, Settings `5`; Settings items: Sources `settings/items/1`, "Channel groups" `5`, "Channels" `6`.
- **The mock:** `mock({ now, catalog, scenario })` serves any catalog; its M3U has no `tvg-chno`; `app.mockState.scenario` can be swapped at runtime.
- **CI:**
  - about 30 min in all;
  - known flakes: `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 DevTools start-up;
  - rerun after the whole run (`gh run rerun --failed`); a push cancels the PR's CI; no `jq` (use `gh --jq`);
  - watch with a Monitor loop over `gh pr checks <n> --json name,bucket --jq …`.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of
  - `trim`, `.sort(`, regex `.test`, `new RegExp`;
  - `for…of` (new ones), `Uint8Array` as a value, `JSON.stringify`;
  - array destructuring or spread, object spread, fragments;
  - `Promise.prototype.finally`.

  Count blanks by char code. Core's existing functions already in main are fine (the module diff says so).
- **Layout and text:** physical CSS only, no Grid or flex `gap`; ES2017. `packages/ui` is hook-free. UI text only from the catalogs. Arabic on/off words agree with their noun. Preact: `translate={false}`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. Never delete files in `node_modules`.
- **Environment:** CI Node 22, this PC Node 24; a bare `sleep` is blocked; `TaskStop` on `verify:engines` leaves its container; the TV build can crash once (0xC0000005): rerun.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add`, `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data; README.md stays "# Lablo".
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first.
- **Production:** nothing goes to production before step 34; its migration and deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Step 37's choices made in leg 134 from the code and PLAN.md** (Omar may overrule; each is small to change):
  1. only a source being added upgrades (stored and restored M3U sources keep their keys);
  2. silent (no "upgraded" line on screen; Settings shows "Xtream login");
  3. no way to keep an Xtream-looking link as a playlist in v1;
  4. radio stays in its groups (no "Radio" rail entry).
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain;
  - the first production migration (with `diag_report_no_install`) and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding; typing a backup code; a login and a guide link given again;
  - Settings' report rows; a telemetry send and a real TV's report once step 34 has an API;
  - the favourites star and "Channel groups"' move mode with the TV's remote;
  - Settings' first open on the TV (settings.js);
  - step 36's pencil, its forms with the TV's number keyboard, Settings › "Channels", and the rail's source tags;
  - step 37: a `get.php` link typed on the TV (upgraded), and a radio channel played for 10 minutes (the screensaver).
- **What remains after 37:** 38 (parental PIN, adult groups, the complete settings screen: seven rows use 888 of 892 px, so 38 reorders it), 39 (clock, sleep timer, colour keys, buffer setting), 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering). With Omar or a TV: 34, 16/19b/21, 41 (performance), 42 (resilience), 46 (beta), 47 (store submissions).
- **Later fixes to propose (no step yet):**
  - renaming a source: two sources of one name get the same tag on the rail and read the same in Settings › "Sources";
  - the info bar overflows the safe area in en-XA (since step 20c2b);
  - a hidden channel playing over the list keeps its old name on the bar if renamed from the same pencil;
  - after hiding the channel that plays, CH+ skips one channel;
  - main's `editChannel.close` has no e2e path;
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset.spec.ts` en-US; `rpc.test.ts:179`'s 5 ms sleep;
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c);
  - the manual EPG mappings (`epgOverrides`) don't follow a refresh's re-match;
  - `e2e/config-server.ts`'s `close()` should call `server.closeAllConnections()` first;
  - the ingest has no request timeouts besides the logins' (a panel whose list hangs holds a refresh until cancelled).

## Checks for Omar
1. **Optional, to see 37a:**
   - run `pnpm exec playwright test e2e/m3u-upgrade.spec.ts --project chromium` in the worktree;
   - or open `artifacts/screenshots/m3u-upgrade-sources-upgraded-en-US.png` ("Xtream login") and `m3u-upgrade-sources-playlist-ar-SA.png` ("قائمة تشغيل M3U").

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file);
  - try the info bar's pencil and Settings › "Channels".
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-six CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`;
  - 56: `git show 6235456:HANDOVER.md`.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
