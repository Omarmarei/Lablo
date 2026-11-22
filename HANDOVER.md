# Lablo IPTV: relay leg 134 opening prompt

You are leg 134 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–133 did steps 1–33, 35, 35e and 36 (PRs #1–#159).
- **Leg 133 (2026-11-22) finished step 36d and with it step 36.**
  - 36d is Omar's option 1, "label, don't merge": a group whose name another source's group on the rail has too (lower case, blanks folded: `groupNameKey`) shows its source's name in an outlined tag on its chip (`Chip`'s `source`) and in the header. The movies and series rails show it too. Settings › "Channel groups" was left unchanged, since it already names every group's source when there are two sources or more.
  - **PR #159 merged as `1ab5ef6`** on green CI at the first run.
  - Step 36 is ticked: 36a–36d are merged, and the phase's gate holds (`test/ingest-mock.test.ts`).
- **Your step: 37 (M3U→Xtream upgrade and radio).** It has no shape yet, only leads (RELAY.md step 37, "Leads for the leg that starts it", written in leg 133). Write the shape and split first, then build its first part.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **`RELAY.md` step 37's leads** (just under `- [ ] 37.`): the scope (docs/PLAN.md §4 lines 218 and 220), the code found (`xtreamFromM3uUrl` unused; where an M3U link enters; radio parsed and badged but failing as `NO_PICTURE`), and the questions the shape must answer. Also step 36's "Shape" and "Split" as the model for writing one, and the last progress row (133).
2. **`docs/PLAN.md` §4** (lines ~210–262: the feature list and the phase 9 row at ~394) and **`docs/architecture.md`**:
   - §1.2 (~647: a playlist's episodes listed flat, "step 37's M3U→Xtream upgrade turns those into real shows");
   - §2 (~1371 and ~1425: radio fails as `TV-UNSUPPORTED`/`NO_PICTURE`; "Audio-only streams (radio) need a request hint first (step 37)");
   - §1.4 item 10 "Built in step 36d" (the latest block, the style to follow).
3. **The code for the upgrade:**
   - `packages/core/src/xtream-url.ts` (`xtreamFromM3uUrl` ~147, its tests);
   - `apps/tv/src/onboarding/form.ts` (the M3U draft, `linkHost`);
   - `apps/tv/src/onboarding/engine-loader.ts` (`load`, `nextSourceId`, `sameFile`);
   - `apps/tv/src/pairing/pair-draft.ts`;
   - `apps/tv/src/settings/source-login.ts` and `sources-state.ts`;
   - `packages/data/src/profile.ts` (`SourceRecord`, `SourceWithoutLogin`).
4. **The code for radio:**
   - `packages/player/src/html5-engine.ts` (~532 `NO_PICTURE`, `NO_PICTURE_MS`) and `engine.ts` (`PlayRequest`);
   - `apps/tv/src/player/player-state.ts` and `PlayerScreen.tsx`;
   - the mock's radio channel (`apps/mock-provider/fixtures/catalog.yaml` id 108; `src/media-plan.ts` for what it serves).

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, then `93b82bd` (36d recorded, 36 ticked, 37's leads), `1ab5ef6` (PR #159's merge), `7a1b3ea`;
   - `origin/main` is `1ab5ef6`;
   - no `*.mutbak` anywhere (`find` outside node_modules);
   - `docker ps` shows only `lablo-web-postgres-1`;
   - free memory (leg 133 started with 33.3 GB of free commit).
2. **Confirm 37 isn't partly done** (`git log`, grep `xtreamFromM3uUrl` and `radio` in apps/ and packages/player).
3. **Write step 37's shape and split in RELAY.md** (each choice with its why), as 35 and 36 did. For each question in the leads:
   - decide it yourself when the code and PLAN.md settle it;
   - **end the leg as needs-you** with numbered options and a recommended one when it is a product trade-off. Likely candidates: upgrading stored M3U sources (their keys change, so favourites, lists, edits and places re-match by name), and whether an upgrade at add is silent or shown.
   - Split into sub-steps that each fit a leg (likely 37a the upgrade, 37b radio).
4. **Build the first sub-step that needs no decision** (radio may not need one), with:
   - unit tests and e2e in en and ar;
   - the en-XA walk for any new screen;
   - screenshots looked at;
   - the gates: mutation (list written first, `artifacts/mutate37x-list.md`, runner copied from `artifacts/mutate36d.py`); `build:tv` sizes and a module diff; `verify:engines --engine chrome53 --engine chrome68` alone; full `pnpm test`; `pnpm typecheck`; `pnpm lint`; architecture.md "Built in step 37x"; the RELAY.md tick and progress row;
   - the PR, merged on green CI (merge commit, keep the branch), with the three riskiest changes named first.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`1ab5ef6`) plus:
  - `93b82bd` (docs: PR #159's merge recorded, 36d and 36 ticked, progress row 133, step 37's leads);
  - this handover's commit (docs: HANDOVER.md).
- **No PR is open.** `main` is `1ab5ef6`; the main checkout was not touched.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`;
  - `dist/`: leg 133's full `build:tv` (36d);
  - in `artifacts/`: `mutate36d.py` (41/41, the runner to copy), `mutate36d-list.md`, `mutate36d-a.log`, `mutate36d-b.log`, `engines-36d.log`, `build-tv-36d-leg133.log`, `unit-36d-leg133.log`, `typecheck-36d-leg133.log`, `lint-36d-leg133.log`, `e2e-36d-leg133.log`; screenshots `artifacts/screenshots/two-sources-*`.

## Verified vs not
- **Verified (36d, on CI too):** PR #159 green at the first run: verify 18 m 38 s, engines 27 m, media 10 m 42 s, web 3 m 18 s.
- **Locally in leg 133:**
  - unit 8,054 (+7);
  - typecheck and lint;
  - `build:tv`: main.js 433.6 KB Tizen, 420.9 KB webOS; settings.js 78.5 KB; core-js unchanged (216 / 6);
  - e2e `two-sources.spec.ts` (en, ar, en-XA) plus live, movies, series, groups and tv-bundle: 25 passed;
  - mutation 41/41;
  - `verify:engines` 53/68: all 26 runs as expected.
- **Not yet:** step 37 (all of it); production (step 34).
- **Migrations and deploys:** none. Nothing is in production or deployed.

## Gotchas and lessons
**New in leg 133:**
- **A second source in e2e needs no pairing.** After `appIdle`, from `/?screen=gallery`, push a record into the profile's `sources` (`store.put(record)`, keyPath `id`; `{ id: 's2', type: 'm3u', name, url, added }`), then start normally. The schedule's first check (15 s after the live screen opens) ingests it, and `onCatalog` re-reads the rail: wait for a new chip with a 60 s timeout.
  - Two in-process mocks on their own ports (`mock({ now, catalog })` plus `listen` each) give two catalogs.
  - The M3U numbers by place after the first source's channels.
  - `e2e/two-sources.spec.ts` shows the whole pattern, about 22 s per locale.
- **en-XA's pseudo labels end in `]`:** to find a bracketed tag, look for ` [` inside the text, not `endsWith(']')`.
- **A TS union whose discriminant is itself a union in one member** (`RecentEntry.kind: 'recent' | 'continue'`) doesn't narrow across separate `===` checks. Give the other member the field as `?: undefined` (`RecentEntry.source`) rather than casting.
- **Reading a field directly beats threading it through a helper's branches** (the chip's `source={at.source}`, not `entryLabel`'s every branch): it leaves no branch that no e2e reaches.
- **A local full `pnpm test` can time out `xtream-xmltv-core.test.ts`'s 61-byte chunks at 30 s under load.** It passes alone in 0.9 s; rerun the file alone first.
- **Module diff with the change already committed:** `git checkout <base> -- <changed files>`, run the probe (`C:/Users/Omarm/.claude/jobs/cfbd6f18/tmp/mprobe.mts` may be gone: see memory `iptv-tv-bundle-polyfills.md`), then `git checkout HEAD -- <changed files>`.
- **Shell:** `python -c` with nested quotes and `bash` heredocs with quotes still fail. Write the patch script with the Write tool, then run it (an EDITS list with `assert s.count(a) == 1`, `newline=''` on read and write).

**From legs 130–132 (still true):**
- **An e2e that refreshes the catalog must wait for the live screen's swap before playing:** wait for the guides' `/xmltv.php` request (after `onCatalog`), then `settled`.
- **A CI e2e failure's URLs:** `gh run download <run> -n playwright-report -D <dir>`, unzip `trace.zip`, read `*.network`.
- **`gh run view --log-failed` gives nothing while another job runs:** use `gh api repos/Omarmarei/Lablo/actions/jobs/<id>/logs`.
- **Mutation found dead state in 36c:** when a guard's mutant survives, check whether another guard always decides first; if so, take the code out.
- **Sizes:** main.js has a hard 500 KB budget on Tizen (433.6 now, 87%). Mention sizes only when they decide something or near the budget; never put 0.5–2 KB in front of Omar as a reason.
- **The player's pin is a signal**, cleared when the player closes.
- **The info bar overflows the safe area in en-XA since step 20c2b:** scope en-XA `untranslated()` to `.player__actions`.
- A number form uses `type="tel"`. A TextField that starts filled needs `Control+A` before typing.
- **The relay context check fires at ~450k tokens.** A step with screens takes a whole leg for build plus e2e.

**From legs 125–129 (still true):**
- `ZapList.find` resolves to `number | LiveRow`.
- **e2e on the live screen:**
  - UP reaches the header only from the list's first row;
  - UP from the rail lands on the header's last-focused button;
  - in Arabic the rail is right of the list;
  - `[data-testid=live]` is absent while search, guide or settings paint.
- Settings' e2e paths: Home `live/header/3`, Search `4`, Settings `5`; "Channel groups" `settings/items/5`, "Channels" `settings/items/6`.
- **The mock:** `mock({ now, catalog })` serves any catalog; its M3U has no `tvg-chno`.
- **Main's module diff:** see memory `iptv-tv-bundle-polyfills.md` (a `.mts` probe, `bundleIife({ input: <main.tsx>, platform: 'webos', label: 'probe', split: true, lazyLabel: (f) => f })`, `pnpm exec tsx`).
- **CI:**
  - about 30 min in all;
  - known flakes: `telemetry.spec.ts:202`, `auto-next.spec.ts` ar-SA, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 DevTools start-up;
  - rerun after the whole run (`gh run rerun --failed`); a push cancels the PR's CI; no `jq` (use `gh --jq`);
  - watch with a Monitor loop over `gh pr checks <n> --json name,bucket --jq …`.

**From earlier legs (still true):**
- **Mutation:** list first, `--check` until every snippet is found once, foreground chunks, `MUT_TIMEOUT` per run, restore any `.mutbak` with `mv`.
- **Main-safe code** (settings.js too): none of
  - `trim`, `.sort(`, regex `.test`, `new RegExp`;
  - `for…of` (new ones), `Uint8Array` as a value, `JSON.stringify`;
  - array destructuring or spread, object spread, fragments;
  - `Promise.prototype.finally`.

  Count blanks by char code.
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
- **Step 37's product questions** (if the shape finds a real trade-off): ask Omar as needs-you with numbered options, recommended first.
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain;
  - the first production migration (with `diag_report_no_install`) and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers:
  - an Arabic onboarding; typing a backup code; a login and a guide link given again;
  - Settings' report rows; a telemetry send and a real TV's report once step 34 has an API;
  - the favourites star and "Channel groups"' move mode with the TV's remote;
  - Settings' first open on the TV (settings.js);
  - step 36's pencil, its forms with the TV's number keyboard, Settings › "Channels", and the rail's source tags.
- **What remains after 37:** 38 (parental PIN, adult groups, the complete settings screen: seven rows use 888 of 892 px, so 38 reorders it), 39 (clock, sleep timer, colour keys, buffer setting), 40 (diagnostics and legal pages), 43 (accessibility), 44 (store documents), 45 (release engineering). With Omar or a TV: 34, 16/19b/21, 41 (performance), 42 (resilience), 46 (beta), 47 (store submissions).
- **Later fixes to propose (no step yet):**
  - **renaming a source** (new in leg 133): two sources of one name (two accounts on one panel, each named after its host) get the same tag on the rail and read the same in Settings › "Sources";
  - the info bar overflows the safe area in en-XA (since step 20c2b);
  - a hidden channel playing over the list keeps its old name on the bar if renamed from the same pencil;
  - after hiding the channel that plays, CH+ skips one channel;
  - main's `editChannel.close` has no e2e path;
  - the guides screen's clipped third line;
  - `auto-next.spec.ts`'s `endEpisode` race; a best-of-3 for `epg-declared-300mb`; `guide-offset.spec.ts` en-US; `rpc.test.ts:179`'s 5 ms sleep;
  - caching ffmpeg in CI's media job;
  - forwarding workers' unhandled rejections (33c);
  - the manual EPG mappings (`epgOverrides`) don't follow a refresh's re-match;
  - `e2e/config-server.ts`'s `close()` should call `server.closeAllConnections()` first.

## Checks for Omar
1. **Optional, to see 36d:**
   - run `pnpm exec playwright test e2e/two-sources.spec.ts --project chromium` in the worktree;
   - or open the screenshots `artifacts/screenshots/two-sources-rail-en.png`, `two-sources-header-ar.png`, `two-sources-groups-en.png`, `two-sources-movies-ar.png`, `two-sources-rail-en-XA.png`.

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
