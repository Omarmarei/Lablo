# Lablo IPTV: relay leg 136 opening prompt

You are leg 136 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–134 did steps 1–33, 35, 35e, 36 and 37a (PRs #1–#160).
- **Leg 135 (2026-11-22) finished step 37b (radio), and so step 37.**
  - **The hint:** `PlayRequest.hints.audioOnly` comes from a channel's `radio`, in live and catch-up requests (`channelRequest` in `apps/tv/src/player/radio.ts`). The controller's `loadOptions(s)` passes it as `LoadOptions.audioOnly` on every load of the session.
  - **Html5Engine** frames an audio-only load by its clock moving and never fails it as `NO_PICTURE`. A stream not marked radio that has no picture still fails that way. AVPlay already framed by the clock.
  - **The radio card** (`RadioCard.tsx`): the logo whole, or a radio mark when the channel has none or its logo fails to load, plus the name and the "Radio" badge.
    - It sits in the middle of the dark stage while the radio plays (`playing`, `paused` or `reconnecting`), under the bar and the cards.
    - The player state's `radio()` picks it: the `playing` row (a zap that waits keeps it up), never over a movie. `failedLogo` and `logoFailed` handle a logo that fails.
  - **Checked first:** desktop Chromium plays the mock's MP3-in-TS radio HLS (clock moving, `videoWidth` 0).
  - **PR #161 merged as `7c46ff3`.** CI: changes, web, media and verify passed at the first run. engines hit its 35-minute cap on Chromium 53's stuck IndexedDB delete (shown as "cancelled") and passed on `gh run rerun --failed`.
  - **Step 38's leads** are written in RELAY.md (under `- [ ] 38.`), read from the code while CI ran.
- **Your step: 38** (parental PIN, adult groups auto-locked, the complete settings screen). Write its shape and split first, as 35, 36 and 37 had. Then build its first sub-step if the leg has room.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - step 38's "Leads for the leg that starts it" (the facts and the questions for the shape);
   - step 37's "Shape" and "Split" as the model for a shape (each choice with its why);
   - 37b's notes ("Refined while building", "Verified in leg 135");
   - the last progress row (135).
2. **docs/PLAN.md:** §4 "Parental" (~242), and line ~67 (users lost "favourites, parental locks and hidden groups" in a competitor's update).
3. **docs/architecture.md:**
   - the five "Parental control (step 38) must filter" notes (~645, ~726, ~741, ~756, ~769);
   - ~786: the profile doc's "parental PIN hash";
   - ~938 and ~1193: the settings screen's seven rows (888 of 892 px);
   - §2 "Built in step 37b" (~1642): the latest block, the style to follow.
4. **The code** (from the leads):
   - `packages/core/src/xtream.ts` (~188, ~276: `is_adult`, dropped at `packages/data/src/ingest.ts` ~498);
   - `packages/data/src/profile.ts` (version 9, `hiddenGroups`, `channelEdits`, `applyProfileEdit` ~678);
   - `apps/tv/src/live/live-state.ts` (~1061: hidden groups in main) and `packages/data/src/channel-view.ts` (~69: hidden channels in the worker);
   - `apps/tv/src/settings/settings-state.ts` (~40, ~47) and `SettingsScreen.tsx` (~514);
   - `apps/mock-provider/fixtures/catalog.yaml` (category 6 "18+ Test (lock check)", channel 109 `adult: true`).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `72688aa` (PR #161's merge recorded, 37b and 37 ticked, row 135, 38's leads), `7c46ff3` (PR #161's merge), `e68fd50`;
   - `origin/main` is `7c46ff3`;
   - no `*.mutbak` anywhere (`find` outside node_modules);
   - `docker ps` shows only `lablo-web-postgres-1`;
   - free memory (leg 135 started with 32.2 GB of free commit).
2. **Confirm step 38 isn't partly done:** grep `parental`, `adult`, `pin` (case-insensitive) in `packages/data/src` and `apps/tv/src`; `git log`.
3. **Write step 38's shape and split in RELAY.md,** answering the leads' questions from the code and PLAN.md, each choice with its why:
   - what counts as adult;
   - lock or hide;
   - how long an unlock lasts;
   - what search, Home and the guide show for locked items;
   - setting the PIN and a forgotten PIN;
   - PIN entry with the number keys;
   - locks following a provider's renaming;
   - the settings screen's order and scrolling;
   - which rows 38 adds.

   **Any choice with real trade-offs that PLAN.md doesn't settle** (the forgotten-PIN path is the likeliest) **goes to Omar as a needs-you numbered question**: stop the leg there.
4. **Then build the first sub-step**, under the usual gates:
   - unit tests;
   - e2e in en, ar and en-XA with screenshots looked at;
   - mutation with the list written first (copy `artifacts/mutate37b.py`);
   - `build:tv` sizes and a module diff;
   - `verify:engines --engine chrome53` and `--engine chrome68`, each alone;
   - full `pnpm test`, `pnpm typecheck`, `pnpm lint`;
   - architecture.md "Built in step 38…"; the RELAY ticks and a progress row;
   - the PR, merged on green CI.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`7c46ff3`) plus:
  - `72688aa` (docs: PR #161's merge, ticks, row 135, step 38's leads);
  - this handover's commit (docs: HANDOVER.md).
- **No PR is open.** `main` is `7c46ff3`; the main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (`.cache/media` holds the generated media), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 135's full `build:tv` (37b);
  - in `artifacts/`:
    - mutation: `mutate37b.py` (40/40, the runner to copy; it has e2e mutants), `mutate37b-list.md`, `mutate37b-a.log`, `-b.log`, `-c.log`;
    - engines: `engines-37b-53.log`, `engines-37b-68.log`;
    - build and checks: `build-tv-37b-leg135.log`, `unit-37b-leg135.log`, `typecheck-37b.log`, `lint-37b.log`, `mprobe-37b-before.log`, `mprobe-37b-after.log`;
    - e2e: `e2e-37b-radio.log`, `e2e-37b-media-full.log`, `e2e-37b-playback-radio.log`, `e2e-37b-player-plain.log`;
    - screenshots `artifacts/screenshots/player-radio-*`.

## Verified vs not
- **Verified (37b, on CI too):** PR #161 green: changes, web, media 11 min, verify 16 min at the first run; engines on the rerun.
- **Locally in leg 135:**
  - unit 8,090 (+17), typecheck and lint;
  - `build:tv`: main.js 435.4 KB on Tizen (+1.5), 422.7 KB on webOS; settings.js 78.5 KB; the workers unchanged; core-js unchanged (216 / 6, module diff);
  - e2e:
    - `e2e:media` (both specs): 18 passed;
    - the plain player and catch-up specs: 17 passed;
  - mutation 40/40;
  - `verify:engines` 53 13/13, 68 13/13.
- **Not yet:** step 38 (all of it); production (step 34); radio on a real TV (step 21: a radio channel for 10 minutes, and the screensaver).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 135:**
- **CI's engines job can end "cancelled", not failed.** Chromium 53's stuck IndexedDB delete makes every later run wait out its 60 s (the lab 140 s) and pushes `verify:engines --self-test` past the job's 35-minute cap.
  - Read the job's annotations and log (`gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`).
  - Then run `gh run rerun <run> --failed` once the run is complete. The rerun is attempt 2 with a new job id; watch it with `gh run view <run> --json jobs`.
- **e2e mutants through `cmd.exe`** (`set LABLO_E2E_MEDIA=1&& pnpm exec playwright test …`): a command that always fails would count every mutant as caught. Run each e2e command once on clean code from the same Python subprocess first (exit 0).
- **The mock's catalog is mutable at runtime:** `app.mockState.catalog = { ...plain, live: plain.live.map(…) }`, put back in `test.afterEach`.
  - Every logo and poster is a transparent 1×1 PNG at `/images/<name>.png`.
  - `page.route('**/images/channel-108.png', …404)` makes one logo fail; the browser logs the 404.
- **The media spec reaches the radio with `DIGIT_8`** (Xtream `num` 8, Lablo Radio Test). The first OK plays Lablo Test 1 SMPTE.
- **Testable wiring:** wiring that would sit only in a screen (PlayerScreen has no unit tests) goes in the state module as a method that reads signals (`player.radio()`), so unit tests and mutation reach it.
- **The mutation list finds dead code:** writing it showed two lines that could never decide anything (a refusal check where a refusal always stops the stream; a JSX `key` for state kept elsewhere). Both were taken out before the run.
- **A ~140-line bash heredoc patch script was cut at EOF** (truncated script, nothing applied). Write any patch script longer than a screen with the Write tool, then run it.

**From legs 130–134 (still true):**
- **Since 37a, the mock's `get.php` link added through the loader becomes an Xtream source.** Keep a playlist with `e2e/playlist-only.ts` (`playlistOnly()` as the scenario, or `PLAYLIST_ONLY_RULE`).
- **The stuck IndexedDB delete on Chromium 53 happens locally too:** rerun `--engine chrome53` alone before suspecting a change.
- **A time limit raced against a request:** clear the timer once the request wins; test a slow step after the limited one, and a cancel before the headers.
- **The `e2e:web` specs:** `pnpm exec playwright test -c playwright.web.config.ts <specs>`. They need the docker Postgres and `apps/web/.next`.
- **Main's module diff:**
  - the probe is `C:/Users/Omarm/.claude/jobs/d3490ac7/tmp/mprobe.mts` (job folders can vanish; memory `iptv-tv-bundle-polyfills.md` describes it);
  - run it as `pnpm exec tsx <probe>`, once with the change committed;
  - then `git checkout <base> -- <changed main files>`, probe again, `git checkout HEAD -- <files>`, and diff the `M`/`L` lines.
- **A second source in e2e needs no pairing:** push a record into the profile's `sources` from `/?screen=gallery` after `appIdle`; the schedule's first check (15 s) ingests it.
- **en-XA's pseudo labels end in `]`:** look for ` [` inside the text.
- **An e2e that refreshes the catalog** waits for the guides' `/xmltv.php` request, then `settled`, before playing.
- **A CI e2e failure's URLs:** `gh run download <run> -n playwright-report -D <dir>`, unzip `trace.zip`, read `*.network`.
- **Mutation:** write the list first; `--check` until every snippet is found once; run in foreground chunks with `MUT_TIMEOUT`; restore any `.mutbak` with `mv`.
- **Sizes:** main.js has a hard 500 KB budget on Tizen (435.4 now, 87%). The catalogs (all UI strings, settings.js's too) live in main. Mention sizes only when they decide something or near the budget; never put 0.5–2 KB in front of Omar as a reason.
- **The player:** its pin is a signal, cleared when the player closes. The info bar overflows the safe area in en-XA (since step 20c2b): scope en-XA `untranslated()` to a part of the player.
- **Forms:** a number form uses `type="tel"`; a TextField that starts filled needs `Control+A` before typing.
- **A local full `pnpm test`** can time out `xtream-xmltv-core.test.ts` under load: rerun the file alone first.
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
  - known flakes: `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 DevTools start-up and stuck deletes;
  - rerun after the whole run (`gh run rerun --failed`); a push cancels the PR's CI (keep docs uncommitted until the merge); no `jq` (use `gh --jq`);
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
- **Step 37's choices made in legs 134–135 from the code and PLAN.md** (Omar may overrule; each is small to change):
  1. only a source being added upgrades M3U→Xtream (stored and restored M3U sources keep their keys);
  2. silent (no "upgraded" line on screen; Settings shows "Xtream login");
  3. no way to keep an Xtream-looking link as a playlist in v1;
  4. radio stays in its groups (no "Radio" rail entry);
  5. the radio card shows the "Radio" badge, and "Connecting…" replaces it while the stream opens or stalls.
- **Step 38's shape** has real decisions; the forgotten-PIN path is the likeliest needs-you.
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
  - step 37: a `get.php` link typed on the TV (upgraded), and a radio channel played for 10 minutes (the card, and the screensaver).
- **What remains after 38:** 39 (clock, sleep timer, colour keys, buffer setting), 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering). With Omar or a TV: 34, 16/19b/21, 41 (performance), 42 (resilience), 46 (beta), 47 (store submissions).
- **Later fixes to propose (no step yet):**
  - renaming a source: two sources of one name get the same tag on the rail and read the same in Settings › "Sources";
  - the info bar overflows the safe area in en-XA (since step 20c2b);
  - a hidden channel playing over the list keeps its old name on the bar if renamed from the same pencil;
  - after hiding the channel that plays, CH+ skips one channel;
  - main's `editChannel.close` has no e2e path;
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset.spec.ts` en-US; `rpc.test.ts:179`'s 5 ms sleep;
  - caching ffmpeg in CI's media job; the engines job's 35-minute cap against Chromium 53's stuck delete (fail fast after the first `pending` delete, or a larger cap);
  - forwarding workers' unhandled rejections (33c);
  - the manual EPG mappings (`epgOverrides`) don't follow a refresh's re-match;
  - `e2e/config-server.ts`'s `close()` should call `server.closeAllConnections()` first;
  - the ingest has no request timeouts besides the logins' (a panel whose list hangs holds a refresh until cancelled).

## Checks for Omar
1. **Optional, to see 37b:**
   - open `artifacts/screenshots/player-radio-en.png` (the mark, the name, "Radio") and `player-radio-bar-ar.png` (the card under the info bar, «إذاعة»);
   - or run `pnpm e2e:media` in the worktree (needs `pnpm mock:media` media).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file);
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes.
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
