# Lablo IPTV: relay leg 137 opening prompt

You are leg 137 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–135 did steps 1–33, 35, 35e, 36 and 37 (PRs #1–#161).
- **Leg 136 (2026-11-22) wrote step 38's shape and built 38a.**
  - **The shape** (RELAY.md, `- [ ] 38.`: "Facts found in leg 136", "Shape", "Split" into 38a–38d). Omar answered its three questions with option 1 each ("1 1 1"):
    - **Q1:** locked groups are **out of sight until the PIN**. The rail (live, movies, series) ends with one "Locked groups" entry; OK asks for the PIN; then the locked groups show in their places with an open lock, and the entry reads "Lock again".
    - **Q2:** the first PIN is **asked at add**: when a source just added has adult groups, the done screen (onboarding, and Settings' add from the phone) asks "Set a PIN" or "Later". With no PIN, locked groups stay out of sight, and setting one later asks for one source's login first.
    - **Q3:** a forgotten PIN is reset by **one source's login typed again** (Xtream user name and password, or the M3U link; typed or sent from the phone), compared on the TV with the stored one, then a new PIN.
  - **38a, the gate in the query worker, is built, verified, committed and pushed, NOT merged** (commits `8b1f3d1`, `aab9a9f`; architecture.md §1.4 item 10 "Built in step 38a"; RELAY `- [ ] 38a.` with "Refined while building", "Verified in leg 136", "Leads for 38b").
    - Adult categories by name (core `adultName`) or by the Xtream panel's `is_adult` (the ingest keeps it per category: `CategoryInfo.adult`, `INGEST_VERSION` 4).
    - The profile's `parental` field (`salt`, `hash`, `adult: false`, `groups`) and `ChannelEdit.locked` (`lock`/`unlock` channel changes, kept through the re-match).
    - The query worker marks `adult`/`locked` on every `categories` (places kept) and, while the session is locked, serves nothing locked (`chunk` `[]`, `items` `null`, `itemsByKey`, `search` via core's `hide`, `recent`, `unmatched` leave it out). `unlock(pin)` (five wrong in a row: a minute's wait), `relock()`, `lockState()`, `setPin(pin)`; `DataEngine` has the four calls.
    - **Why unmerged:** alone, main would list a locked group with an empty list, and about ten e2e specs use the 18+ channel. **38a merges with 38b in one PR** (38a's refinement 1).
- **Your step: 38b** (unlocking in main) on top of 38a, then **one PR for 38a + 38b**, merged on green CI.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:** step 38's "Shape" (with Omar's three decisions) and "Split"; `- [ ] 38a.`'s "Refined while building" and **"Leads for 38b"** (the e2e list, the marks main must read, the query worker's 1.6 KB, the re-reads after an unlock); the last progress row (136).
2. **docs/architecture.md:** §1.4 item 10 "Built in step 38a" (~954); the live screen's 36b block ("Built in step 36b", ~920: rows count shown channels, places count all, `railEntries`, number entry); §2 "Built in step 37b" as the latest UI block's style.
3. **The code:**
   - `packages/data/src/lock-view.ts`, `parental.ts`, `query-service.ts` (`unlock`, `relock`, `lockState`, `setPin`, `gate`);
   - `apps/tv/src/data/engine.ts` (`unlock`, `relock`, `lockState`, `setPin`);
   - `apps/tv/src/live/live-state.ts` (`railEntries` ~373, the hidden-group handling ~1061, `findNumber`, `playOver`);
   - `apps/tv/src/movies/movies-state.ts` (~405: the rail's categories) and the series screen;
   - the player's hide/show (`player-state.ts`, memory `iptv-hidden-app-position.md`);
   - onboarding's done screen (`OnboardingApp.tsx`) and the pairing done view (Q2's prompt).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean; `git -C "<wt>" log --oneline -6` shows this handover's commit, `aab9a9f`, `8b1f3d1`, `2817766`, `79e6efd`, `dd82363`;
   - `origin/main` is `7c46ff3`; no `*.mutbak`; `docker ps` shows only `lablo-web-postgres-1`; free memory.
2. **Write 38b's refinements first in RELAY.md** (as 37b's "Refined while building"), checking against the code:
   - how main leaves locked groups out of the rails while locked (live: like hidden groups, places kept; movies and series too) and shows them with an open lock once unlocked;
   - the "Locked groups" / "Lock again" rail entry (live, movies, series), and what it does with no PIN (Q2: a source's login first, which is 38c's check, or a pointer to Settings until 38c);
   - the PIN pad (main.js: four boxes, number keys type at once, a 3 × 4 `grid` zone left to right in Arabic too, the fourth digit submits; wrong; the minute's wait; Back cancels);
   - relock on hide (`engine.relock()`), and a locked channel playing when the app comes back (the pad over the black stage; Back closes to the list);
   - the re-reads after an unlock or relock (live as `channelsChanged`; movies, series, Home, search on their next read);
   - Q2's prompt on the done screens when the new source has adult groups (`lockState().kinds` or the categories' marks) — 38b or 38c, decide and write why.
3. **Build 38b, then update the e2e** (lead 1's list): channel 109 and "18+ Test (lock check)" are out of sight by default. A spec that needs channel 109 (guide-mapping, guide-matches, hello, tv-bundle, guide, live) turns "Lock adult groups" off by a profile write (`parental: {adult: false}`) or unlocks through the pad.
4. **The gates** (for the joined PR): unit tests; e2e in en, ar and en-XA with screenshots looked at (the rail without the 18+ group, the pad, unlocked groups); mutation with the list written first (copy `artifacts/mutate38a.py`; its `--clean` runs each command on clean code first); `build:tv` sizes and main's module diff; `verify:engines --engine chrome53` and `--engine chrome68`, each alone; full `pnpm test`, `pnpm typecheck`, `pnpm lint`; architecture.md "Built in step 38b"; RELAY ticks (38a and 38b) and a progress row.
5. **One PR for 38a + 38b**, merged on green CI (name the three riskiest changes first; one of them: `INGEST_VERSION` 4 rebuilds every stored catalog once).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`7c46ff3`) plus:
  - `72688aa`, `dd82363` (leg 135's docs);
  - `79e6efd` (step 38's shape), `2817766` (Omar's answers), `8b1f3d1` (38a's code and tests), `aab9a9f` (38a's docs);
  - this handover's commit (docs: HANDOVER.md).
- **No PR is open.** `main` is `7c46ff3`; the main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*` (`.cache/media` holds the generated media), `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 136's full `build:tv` (38a);
  - in `artifacts/`: `mutate38a.py` (97/97; has `--clean`), `mutate38a-list.md`, `mutate38a-a.log`, `-b.log`, `-c.log`; `build-tv-38a.log`; `unit-38a-leg136.log`; `typecheck-38a.log`; `lint-38a.log`; `engines-38a-53.log`, `-68.log`; `wprobe-38a-before.log`, `-after.log` (the query worker's module lists).

## Verified vs not
- **Verified locally in leg 136 (38a):**
  - unit 8,160 (+70), typecheck, lint;
  - `build:tv`: the query worker 141.6 → **148.4 KB of 150** (1.6 KB left; module diff: only the four new modules, no core-js); the ingest worker 136.5 KB; main.js 435.7 KB on Tizen (423.0 webOS); settings.js 78.5 KB;
  - mutation 97/97 (two test gaps closed);
  - `verify:engines`: 68 13/13; 53 13/13 on the second run (the first: the DevTools start-up flake).
- **Not yet:** 38a on CI (no PR: it would fail the e2e alone); 38b, 38c, 38d; production (step 34); the lock on a real TV (step 21's session).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 136:**
- **The 18+ channel is locked by default now** (in the data). Tests through a `QueryService` that count or list live channels see one fewer: `test/ingest-mock.test.ts` and `test/catchup-m3u-mock.test.ts` count `catalog.live.filter((c) => !c.adult)`; `test/short-epg-mock.test.ts` turns "Lock adult groups" off by `editProfile({kind: 'parental', change: {op: 'adult', on: false}})` to reach channel 109.
- **The query worker has 1.6 KB left** (148.4/150). Making methods non-async saved 22 bytes: the size is the code. Put new logic in main or another worker; ask before adding query-worker code.
- **A worker's module diff:** `C:/Users/Omarm/.claude/jobs/af741535/tmp/wprobe.mts` (job folders can vanish: memory `iptv-tv-bundle-polyfills.md` describes it): `bundleIife({ input, platform: 'webos' })`, printing the code length and the sorted modules. "Before": `git diff -- packages > p.patch; git checkout -- packages; probe; git apply p.patch`, with a copy of the changed files aside, checked with `cmp` after.
- **Minified bytes per file:** `C:/Users/Omarm/.claude/jobs/af741535/tmp/sizes.mts` imports esbuild's `transform` by its `.pnpm` path (`node_modules/.bin` has no esbuild) and compares each file with `git show HEAD:<f>`.
- **A test that a read is fresh must load the worker first:** the first call's lazy load reads the profile anyway, so a "held copy" mutant survived until the test called `q.reload()` before the change.
- **Channel edits are re-matched on two paths** (`channel-relink.ts`): an entry following a favourite goes through `changed(...)` with each field named (a new field must be added there), the others through `reconcileFavourites`. Test both.
- **A python patch run from a bash heredoc turned `'\\n'` into a real newline** inside a TS string (an unterminated literal). Use `[...].join('\n')` written with Edit, or Write the script.
- **A bash heredoc writing a `.mts` with `/\\/g` was mangled too:** Write probe scripts with the Write tool; split by `String.fromCharCode(92)` instead of a backslash regex.
- **Mutation `--clean`:** `artifacts/mutate38a.py --clean` runs every test command once on clean code (a command that always fails would count every mutant as caught).

**From legs 130–135 (still true):**
- **CI's engines job can end "cancelled"** (Chromium 53's stuck IndexedDB delete runs it past its 35-minute cap): read the job's log (`gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`), then `gh run rerun <run> --failed` once the run is complete; the rerun is a new job id (`gh run view <run> --json jobs`).
- **e2e mutants through `cmd.exe`:** run each e2e command once on clean code first (exit 0).
- **The mock's catalog is mutable at runtime** (`app.mockState.catalog = {...}`, put back in `afterEach`); logos are transparent 1×1 PNGs at `/images/<name>.png`; `page.route('**/images/…', 404)` fails one.
- **The media spec reaches the radio with `DIGIT_8`.** **Testable wiring** goes in the state module as a method reading signals (PlayerScreen has no unit tests).
- **The mutation list finds dead code:** remove a check that can never decide before the run.
- **Since 37a, the mock's `get.php` added through the loader becomes Xtream;** keep a playlist with `e2e/playlist-only.ts`.
- **The stuck IndexedDB delete and the DevTools start-up flake on Chromium 53 happen locally too:** rerun `--engine chrome53` alone first.
- **A time limit raced against a request:** clear the timer when the request wins; test a slow step after, and a cancel before the headers.
- **`e2e:web`:** `pnpm exec playwright test -c playwright.web.config.ts <specs>` (needs the docker Postgres and `apps/web/.next`).
- **Main's module diff:** the probe `C:/Users/Omarm/.claude/jobs/d3490ac7/tmp/mprobe.mts` (`pnpm exec tsx <probe>`), "before" by checking out the base's main files and back.
- **A second source in e2e needs no pairing:** push a record into the profile's `sources` from `/?screen=gallery` after `appIdle`; the schedule's first check (15 s) ingests it. A profile write the same way can set `parental: {adult: false}`.
- **en-XA's pseudo labels end in `]`.** **A catalog-refresh e2e** waits for the guides' `/xmltv.php` request, then `settled`. **CI e2e failures:** `gh run download <run> -n playwright-report -D <dir>`, `trace.zip`'s `*.network`.
- **Mutation:** list first; `--check` until every snippet is found once; foreground chunks with `MUT_TIMEOUT`; restore any `.mutbak` with `mv`.
- **Sizes:** main.js 500 KB hard budget on Tizen (435.7 now, 87%); the catalogs (all UI strings) live in main. Mention sizes only when they decide something or near a budget; never put 0.5–2 KB in front of Omar as a reason.
- **The player's pin is a signal**, cleared on close. The info bar overflows the safe area in en-XA: scope en-XA `untranslated()` to part of the player.
- **Forms:** numbers use `type="tel"`; a TextField that starts filled needs `Control+A` before typing.
- **A local full `pnpm test`** can time out `xtream-xmltv-core.test.ts` under load: rerun the file alone.
- **The relay context check fires at ~450k tokens.** A step with screens takes a whole leg for build plus e2e.

**From legs 125–129 (still true):**
- **e2e on the live screen:** UP reaches the header only from the list's first row; UP from the rail lands on the header's last-focused button; in Arabic the rail is right of the list; `[data-testid=live]` is absent while search, guide or settings paint.
- **Settings' e2e paths:** Home `live/header/3`, Search `4`, Settings `5`; Settings items: Sources `settings/items/1`, "Channel groups" `5`, "Channels" `6` (38d reorders them).
- **The mock:** `mock({ now, catalog, scenario })`; its M3U has no `tvg-chno`; `app.mockState.scenario` can be swapped.
- **CI:** about 30 min; known flakes `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes; rerun after the whole run; a push cancels the PR's CI (keep docs uncommitted until the merge); no `jq` (use `gh --jq`); watch with a Monitor loop over `gh pr checks <n> --json name,bucket --jq …`.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`; new `for…of`, `Uint8Array` as a value, `JSON.stringify`; array destructuring or spread, object spread, fragments; `Promise.prototype.finally`. Count blanks by char code. Core's functions already in main are fine (the module diff says so).
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
- **Step 38's three questions are decided** (Omar, 2026-11-22, option 1 each; above). 38b and 38c may still meet smaller choices; make them from the shape with a why, and send only real trade-offs to Omar.
- **Step 37's choices made in legs 134–135** (Omar may overrule; each is small to change): only a source being added upgrades M3U→Xtream; silent (Settings shows "Xtream login"); no way to keep an Xtream-looking link as a playlist in v1; radio stays in its groups; the radio card shows "Radio", "Connecting…" while it opens.
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the first production migration (with `diag_report_no_install`) and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers: an Arabic onboarding; typing a backup code; a login and a guide link given again; Settings' report rows; a telemetry send and a real TV's report once step 34 has an API; the favourites star and "Channel groups"' move mode; Settings' first open (settings.js); step 36's pencil, its forms with the TV's number keyboard, Settings › "Channels", the rail's source tags; step 37: a `get.php` link typed on the TV, a radio channel for 10 minutes (the card, the screensaver); step 38 (once built): the PIN pad with the TV's remote, with and without number keys.
- **What remains after 38:** 39 (clock, sleep timer, colour keys, buffer setting), 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering). With Omar or a TV: 34, 16/19b/21, 41 (performance), 42 (resilience), 46 (beta), 47 (store submissions).
- **Later fixes to propose (no step yet):** renaming a source (two sources of one name read the same); the info bar overflowing the safe area in en-XA; a hidden channel playing over the list keeps its old name if renamed from the same pencil; after hiding the channel that plays, CH+ skips one; main's `editChannel.close` has no e2e path; the guides screen's clipped third line; `auto-next.spec.ts`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset.spec.ts` en-US; `rpc.test.ts:179`'s 5 ms sleep; caching ffmpeg in CI's media job; the engines job's 35-minute cap against Chromium 53's stuck delete; forwarding workers' unhandled rejections (33c); `epgOverrides` not following a refresh's re-match; `e2e/config-server.ts`'s `close()` should call `server.closeAllConnections()` first; the ingest has no request timeouts besides the logins'; **no way to remove a source in the app** (Settings › Sources only gives a login again); **the query worker's 150 KB budget** (1.6 KB left after 38a).

## Checks for Omar
1. Nothing new to look at: 38a has no screen. The next leg's 38b adds the PIN pad and the rails' "Locked groups" entry, with screenshots.

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
