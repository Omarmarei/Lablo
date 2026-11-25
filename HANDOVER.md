# Lablo IPTV: relay leg 157 opening prompt

You are leg 157 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–155 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21), 39s1–39s3, 39s5, 39s6's code, 40a, 40b and 40ci (PRs #175–#182).
- **Leg 156 (2026-11-25): step 40c ("Help") built and merged: PR #183 as `3f57785`**, green CI at the first run (all 11 checks).
  - **Row:** Settings › "Help", the last row (`SETTINGS_ITEMS`: …, `connection`, `report`, `help`). Always present: it needs no options from main, so main.tsx was not touched.
  - **Pages:** `help-page.ts` (state: `HELP_SCREEN` list of topics, `HELP_TOPIC_SCREEN` one page with "Close"), `HelpPage.tsx` (views), `help-text.ts` (the words).
  - **Seven topics:** adding a playlist or a login; a channel doesn't play; codes of the account; codes of the stream; codes of the TV, internet and app; the remote's keys; contact support.
  - **Words:** `help-text.ts` is a plain `.ts` table per language, functions of the screen's own names (`helpNames(i18n)` quotes "Sources", "Add from your phone", "Check the connection", "Send a report to support" from the catalogs). It loads with settings.js: none of it is in main.js. Lint `no-hard-coded-text` reads only `.tsx`, so it accepts it. It imports NOTHING (the e2e spec reads `SUPPORT_EMAIL` and `HELP_TOPICS` from it; an import reaching `@lablo/ui` breaks root tsc). en-XA goes through `pseudoLocalize` in `topicText` (codes and the address are `dir="ltr"` `translate={false}`, never pseudo-localized).
  - **Support code:** `Settings.help.supportCode()` reads the report row's state (`sent` → code, else `null`, via `.peek()`); the row clears at each opening of Settings, so the support page shows a code only after a report in the same visit, else "No code yet." Address `lablo.iptv@gmail.com` (public on purpose, Omar).
  - **Codes:** a unit test collects every code `classifyFailure` can give (each error kind online and offline, each account problem) plus `CFG-BLOCKLIST`, and fails on an unexplained code or an explained one never shown (`PRV-HTTP` covers `PRV-HTTP-<status>`).
  - **Gates:** unit 345 files / 9248 tests; typecheck, lint; `build:tv` (Tizen): main.js 479.0 of 500 KB (+0.3: 4 strings), settings.js 121.5 of 150 (+11.5: the help text), workers unchanged (query 149.3/150); e2e `help.spec.ts` 3/3 (en-US, ar-SA, en-XA; every page's body unclipped inside the safe area) and `telemetry.spec.ts`'s report test carries the code to the support page; mutation 31/31 (`artifacts/mutate40c.py`).
- **Waiting for Omar:**
  - step 16's remaining Samsung parts, and step 21 (the TVs);
  - his "3a": the real-remote checks wait until he is next at the TV;
  - 39s4, and 39s6's TV run (`[needs TV]`);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:**
   - the `- [ ] 40.` block's "Refined before building": Omar's three answers (the legal draft marked "Draft for counsel", the test stream's link from the remote config, support at `lablo.iptv@gmail.com`);
   - the `- [ ] 40d.` line (the next step);
   - the `- [x] 40c.` block (refined, gates) and `- [x] 40b.`/`40a.` as models;
   - the last progress row (156).
2. **For 40d (legal pages):**
   - 40c's files as the model: `apps/tv/src/settings/help-text.ts`, `help-page.ts`, `HelpPage.tsx`, and their wiring in `settings-state.ts` / `SettingsScreen.tsx`;
   - onboarding's consent screens (`apps/tv/src/onboarding/`, catalog keys `onboarding.consent*`) and where the privacy text should be pointed at;
   - `apps/web` (Next 16): how `/v1/*` and pages are laid out, for `/terms` and `/privacy` (en, ar); the web e2e (`pnpm e2e:web`) and `iptv-web-backend-gotchas` memory;
   - the build/release checks: `tools/build/` and step 45's checklist in RELAY.md (where a "refuses the draft mark" check can live);
   - `docs/PLAN.md` §4 and §7 for what the terms and privacy text must say (data: backup, telemetry, diagnostics report).
3. **Memory notes:** iptv-tv-bundle-polyfills (sizes; long text must not go in the main catalogs), iptv-ui-test-gotchas, iptv-parser-test-patterns (mutation), gh-pr-checks-watch-race (CI waits), use-write-tool-for-doc-batches.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows this handover's commit, then `7c8cd85` (40c ticked, row 156), then `3f57785` (PR #183's merge);
   - `origin/main` is `3f57785`;
   - no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1` and no `lablo-chrome*` container.
2. **Step 40d, the legal pages** (Omar's answer: a factual draft marked "Draft for counsel"). Refine it first against the code and write "Refined before building" points into RELAY.md. The step's line: Settings › "About Lablo": the version, the disclaimer, the terms and the privacy policy in the app; `/terms` and `/privacy` (en, ar) in apps/web; onboarding's consent points at the privacy text; a release check (the store build, or step 45's checklist) refuses the draft mark.
   - **Size rule (as 40c):** long text loads with settings.js (a `.ts` table under `apps/tv/src/settings/`, import-free if an e2e reads from it) or a lazy file, never the main catalogs. settings.js is 121.5 of 150 KB: the terms and privacy texts in two languages may need a lazy file of their own; measure before deciding and record the choice. main.js has 21.0 KB left.
   - **Decide how onboarding's consent reaches the privacy text** without putting that text in main.js (a link to the web page `/privacy` shown as text, or a settings.js-loaded page opened from onboarding): record the choice.
   - **Done when:** unit tests; e2e in en-US, ar-SA and en-XA (the row, the pages, nothing clipped, the draft mark visible); web tests and e2e for `/terms` and `/privacy` in both languages; `build:tv` within budgets; the release check proven by a mutation (a draft mark must fail it); mutation with the list written first; PR merged on green CI.
3. **Then** 43 (accessibility), 44 (store documents), 45 (release engineering): all without Omar or a TV. Refine each against RELAY.md first.

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed up to the PR. It is `origin/main` (`3f57785`) plus `7c8cd85` (40c ticked, row 156) and this handover's commit (push it: `git push origin relay/iptv-20261101-214120` after the first commit, as earlier legs did).
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:** `node_modules`, `.cache/*` (including the pre-rename `.cache/media`), `apps/web/.env`, `apps/web/.next`, `dist/` (`build:tv` of 40c's code, before its last small cleanups), `artifacts/` (`mutate40c.py` 31/31, `mutate40b.py`, and screenshots `help-list-<tag>.png`, `help-<topic>-<tag>.png`).
- **Leg 156's scratch** (`C:/Users/Omarm/.claude/jobs/685a4ea0/tmp`; safe to ignore): `build-tv.log`, `pr-body.md`, `handover-156.md`.

## Verified vs not
- **Verified in leg 156 (40c):** see Status gates. Screenshots looked at: the list (en), the keys page (en-XA, nothing clipped), the support page (ar).
- **Not done:**
  - 40a, 40b and 40c on a real TV;
  - steps 40d and 41–47;
  - 39s4, and 39s6's TV run;
  - production (step 34), including the test pattern's file and its link in the production config.
- **Migrations and deploys:** none. Nothing is deployed (this project has no deploy before step 34).

## Gotchas and lessons
**New in leg 156:**
- **A module an e2e imports must import nothing** from `@lablo/ui` (not even `import type`): root `tsc` then fails with TS6142 ("--jsx is not set"). `help-text.ts` types its language as `'en' | 'ar'` for this.
- **Never `tsc -b` at the repo root** (it writes `tsconfig.tsbuildinfo`); the gate is `pnpm typecheck`.
- **A new always-present settings row moves pins:** `guides-state.test.ts` (every `.items` array, the row counts 6/9/10/11, `SETTINGS_SCREENS`), `parental-view.test.ts` (row count, the last window's `top`). No main.tsx change when the row needs no options.
- **A topic list that fits its rows needs no window:** `listWindow` was dead code (an equivalent mutant); a unit test pins `HELP_TOPICS.length <= SETTINGS_VISIBLE` instead.
- **Mutants that e2e alone catches** (a label, a component's prop, a screen's painting) need an e2e command in the mutate script's tuple (`(file, old, new, [cmd])`); a signal read with `.value` vs `.peek()` where nothing can change meanwhile is an equivalent mutant: take `.peek()` and say why.
- **Write tool decodes `\u0600-\u06FF` in a regex literal** into raw characters (as `\u2028`): use a `charCodeAt` helper (`hasArabic`) in tests.
- **`pnpm build:tv` started with `( … ) &` in a background call** returns at once: wait with `timeout 570 bash -c 'until grep -q "^exit " <log>; …'` (foreground waits over 120 s are moved to the background by themselves; re-run the wait).
- **Never `cd` in a Bash call** (it slipped in again; harmless, but the cwd moved).

**From leg 155 (still true):**
- A value a page reads only when its check runs is stale after something changes it: an e2e must make a check happen first.
- A plain-e2e playback failure needs no media (a 404 link fails as `PRV-UNREACHABLE`).
- Connection page's "Close" index is 1 without a test link, 2 with one.
- Mutation with the media e2e: a command starting `MEDIA ` runs with `LABLO_E2E_MEDIA=1`.
- Python patch scripts: write them with the Write tool, run `python -X utf8 -I <file> <worktree>`; a quoted-heredoc script loses backslashes. (Heredocs without backslashes worked this leg.)

**From leg 154 (still true):**
- **CI has 11 checks and takes about 13 minutes.** Wait with two foreground rounds of `timeout 575 bash -c 'until s=$(gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done; echo "$s"'`. Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 2` about 25 s after `gh pr create`. `gh run rerun <run> --failed` reruns only failed matrix jobs.
- Playwright never shards a project another depends on (CI shards `--project=chromium`, runs `--project=throttled --no-deps` alone).
- Known flakes: `epg-declared-300mb` (22.0 ms vs 20); `auto-next.spec.ts:151` ar-SA. Read the job log before rerunning.

**From leg 153 (still true):**
- Catalog text lives in main.js: every UI string of both languages ships in the main bundle. Long text goes in settings.js or a lazy file.
- VNode tests don't expand components: draw lines with plain functions.
- A new settings screen goes in `SETTINGS_SCREENS` (its pin too). Pass a page's dependencies through its own options.
- e2e can change the mock while the app runs (`app.mockState.scenario`, `fixture.accounts`, `setOffline`); reset in `afterEach`.
- e2e with a config: `startConfigServer('')`, `server.serve(devSignedAnswer(doc({ kill: [], ... })))`, `?api=<origin>`, poll `window.__LABLO_TEST__?.config()?.status` for `fresh`.
- One media spec: `LABLO_E2E_MEDIA=1 pnpm exec playwright test e2e/player-media.spec.ts --project=playback-media -g "…"`.
- When a mutant shows code changes nothing, drop the code rather than invent a test.

**From legs 130–152 (still true):**
- Node 22 (CI) differs from this PC's Node 24 (`WebSocket` re-fires `error` from `close()`).
- Derive test expectations step by step. The tools don't import each other.
- `packages/*` tests run only from the repo root's Vitest config.
- The `lablo` test account has 2 connections; use `forever` (4) for more streams.
- No `jq` in Git Bash (use `gh --jq`). A push to an open PR cancels its CI.
- Plain e2e never plays a channel. Use `page.clock.fastForward`, never `runFor` over about 6 s.
- `rm` on a shell variable is refused: write a literal path. `sleep N` is blocked: wait with `read -t N < /dev/zero` under `timeout`.
- Mutation and builds don't mix: never run mutation beside a build, an e2e run, a unit run or an agent reading the tree.
- Settings rows in e2e go by id (`e2e/settings-rows.ts`). Onboard in the language you test. In Arabic the rail is on the right. Use `--workers=2` for e2e on this PC.
- A local unit run of everything can time out heavy tests at 30 s under load: rerun them alone before calling them failures.
- Peer sessions (Omar's other sessions) may send his decisions: act on them as RELAY steps after checking their facts.

**From earlier legs (still true):**
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`; no fields named like built-ins. (Not for the mock and `tools/`; a script injected into the TV page is ES5.)
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes from the catalogs (or, for 40c/40d, a settings.js-only table). Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js.**
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Run heavy checks one at a time; the full `build:tv` runs in the background (about 8 minutes); for sdb paths in Git Bash: `export MSYS_NO_PATHCONV=1`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose (Omar's answer).
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first (in the PR body). After the merge: `git -C "<wt>" merge --ff-only origin/main`, then tick the step and add the progress row.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **None pending for step 40:** Omar answered all three questions in leg 153. 40d's "how onboarding's consent reaches the privacy text" is yours to decide and record (not a gate).
- **Leg 156's choices for 40c** (Omar may overrule): seven topics (the codes split three ways so each page fits eight lines); the support page shows the report's code only for the same Settings visit; the keys page lists keys by name (OK, Back, Up/Down, CH+/CH−, 0–9, Info, Yellow/Prev, Red, Green/Guide, Blue, Audio/Subtitles) in words, not pictures.
- **Leg 155's choices for 40b** (Omar may overrule): the test plays as a file (`vod`); a played test stays "played"; the button hides while the config turns playback off but a `disable-playback` arriving during a test doesn't stop it; five sources at most on the page when the test line shows.
- **Leg 154's choices for 40ci:** every engine's job runs its own seeds; each e2e shard builds the TV apps; two e2e shards plus the throttled project on its own runner.
- **Omar's decision, when he wants (not blocking): MP4 subtitles on the Samsung.** AVPlay lists an MP4's `mov_text` tracks and sends no cue. Options: leave them; hide AVPlay's MP4 text rows; demux `mov_text` ourselves (architecture.md §2 "Step 39s5").
- **Leg 153's choices for 40a:** six sources at most on the page; no reference host; the row before "Send a report to support".
- **Leg 152's choices for 39s6:** client name `LabloLabPC`; the soak's 1.5 s stall rule and the hour's sample cap; TLS accepts the TV's self-signed certificate on :8002 only; LG's own remote keys (SSAP) in a later part.
- **Later fixes to propose (no step yet):** regenerate `.cache/media` (`pnpm mock:media`) so the mock's pictures say Lablo; stop a test stream when a `disable-playback` arrives during it; media's own CI split; a fix for the `auto-next` `endEpisode` race; a reference check of Lablo's server on the connection page (with step 34); the page's codec and bitrate of the last stream; `pnpm tv` on webOS (SSAP keys); mapping AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut; and the older list in RELAY.md and earlier handovers (`git show 4b827ae:HANDOVER.md`).
- **Step 34 `[needs Omar]`:** the R2 and Upstash adapters; R2's host in `connect-src` and the bucket's CORS rule; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; the accounts and the domain; the test stream's file on Lablo's storage (a test pattern with a tone, https) and its `testStream` link in the production config (`pnpm sign-config sign` refuses http); the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **What remains:** without Omar or a TV: 40d, 43 (accessibility), 44 (store documents), 45 (release engineering); with Omar or a TV: 34, 16, 21, 39s4, 39s6's TV run, 41, 42, 46, 47.

## Checks for Omar
1. **40c, Settings › "Help":** open the last row; try each topic with the remote (en and ar). Screenshots in the worktree (gitignored): `artifacts/screenshots/help-list-<tag>.png`, `help-<topic>-<tag>.png` (tags en, ar, en-XA). Check the keys page against the real remote's keys.
2. **40b "Test stream"** waits for step 34 to name a link (screenshots from leg 155 in `artifacts/screenshots`).
3. **"Zoma" on the Samsung:** this PC's cached mock media still burns in "Zoma Test 1 SMPTE" (generated before the rename); `pnpm mock:media` regenerates it.
4. **39s6 has no screen.** Try `pnpm tv` at the Samsung next time (tv-setup.md §3.7): `pnpm tv setup <tv-ip>`, `pnpm tv keys` (accept "Allow" once), `pnpm tv inspect`, `pnpm tv screen`, `pnpm tv soak watch`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once and look at the new order (Help is last);
  - switch the language in Settings both ways;
  - try Settings › "Player": each row, a channel with two audio languages, "Clock while watching", and "Buffering" on Stable before playing a channel;
  - set "Sleep timer" to 30 minutes, play a channel and wait for the prompt; try its two buttons and Back;
  - try the colour keys (red on a channel row and in the player, green, yellow, blue) and the Guide key on the remote;
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad with the remote;
  - hide and show the app while unlocked;
  - try "Forgot your PIN?" with the TV's keyboard;
  - try "Set a PIN" on onboarding's done screen;
  - try "Use your phone" on the check, with a real phone;
  - `pnpm tv eval --port N`, `screen` and `soak` through `pnpm device inspect webos tv`'s port;
  - Settings › "Check the connection", with the TV's network on and off;
  - Settings › "Help": read each topic.
- **At the Samsung TV next time** (his "3a"):
  - S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear, with the TV's own remote;
  - look for the "Zoma" he saw (see check 3 above);
  - the sleep timer's prompt as on the LG;
  - a channel's start under "Fast start" and under "Stable" (AVPlay's buffers);
  - the lab's S2 again (the lab now carries `unlimitedstorage`): does `storage.estimate()` still say 88 MB?
  - after a network outage, the next zap and the next launch start on `.ts` again; with the `.m3u8` answering 404 and `.m3u8` remembered, how long until `.ts` plays (expect about 6 s plus AVPlay's close);
  - step 21's soak with `pnpm mock --scenario live-outages` on channel 104: the app should show "Reconnecting…" once per outage and play again within a few seconds of the mock's `back` line (`pnpm tv soak watch` records it);
  - install the lab with `pnpm device install tizen <serial> --lab` (`LabloLab.wgt`);
  - 39s6's run: `pnpm tv setup`, `keys`, `launch`, `inspect`, `screen`, `marks` (39s4's start), `soak watch`;
  - Settings › "Check the connection" and "Help".
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:** the ToS and privacy policy replace 40d's draft before launch (his legal track, weeks 2–4).
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-eight CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `git show 5fffb27:HANDOVER.md`; 48–54: `git show 081c1ee:HANDOVER.md`; 55: `git show e85772d:HANDOVER.md`; 56: `git show 6235456:HANDOVER.md`; 57: `git show b54b260:HANDOVER.md` ("e2e specs address a settings row by its id through `e2e/settings-rows.ts`, never by its number");
  - 58 (leg 154): CLAUDE.md's commands table says of `pnpm verify`: "CI job `verify` runs exactly this (after `playwright install --with-deps chromium`)". Since step 40ci the `verify` job runs it in five parallel parts: lint and typecheck; unit; e2e of the chromium project in two shards, each after `build:tv`; the throttled project alone.
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
