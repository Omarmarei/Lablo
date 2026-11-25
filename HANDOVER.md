# Lablo IPTV: relay leg 158 opening prompt

You are leg 158 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work. Legs 1–156 did steps 1–33, 35–39 (all sub-steps; step 39's real-TV proof waits for step 21), 39s1–39s3, 39s5, 39s6's code, 40a, 40b, 40ci and 40c (PRs #175–#183).
- **Leg 157 (2026-11-25): step 40d ("The legal pages") built and merged: PR #184 as `4c1d7d2`**, green CI at the first run (all 11 checks). RELAY.md is ticked (`5a33619`, row 157).
  - **One source:** `packages/protocol/src/legal.ts` (subpath `@lablo/protocol/legal`, allowed in eslint's `boundaries/entry-point` list in `eslint.config.js`; imports NOTHING). `LEGAL_DRAFT = true`, `LEGAL_DRAFT_MARK` ("Draft for counsel" / Arabic), `LEGAL_CONTACT` (`lablo.iptv@gmail.com`), `RETENTION_DAYS` (backup 180, telemetry 90, report 30), terms (6 sections) and privacy (7 sections) in en and ar, `LEGAL_CHROME` (Previous/Next/Close, `pageOf(n, total)` as a function, the About page's words), `legalDoc(lang, id)`.
  - **TV:** Settings › "About Lablo" is the new LAST row (`SETTINGS_ITEMS`: …, `report`, `help`, `about`). Files: `apps/tv/src/settings/about-page.ts` (state: list `info`/`terms`/`privacy`; `about-info` page; `about-doc` page with Previous/Next/Close, one section a page, the buttons dimmed and inert at the ends), `AboutPage.tsx` (views; `paragraphPieces` keeps the contact address whole and left to right in en-XA), CSS `.about__*` in `settings.css`. Catalog keys: `settings.about`, `settings.aboutHint`, `onboarding.privacyNote` (en, ar). `main.tsx` passes `version: __APP_VERSION__` into the settings options. Onboarding's consent has a new line under the telemetry note: "The full privacy policy is in Settings, under "About Lablo"." (my decision: no web link, since no domain exists before step 34).
  - **Web:** `apps/web/src/app/terms/page.tsx`, `.../privacy/page.tsx`, `apps/web/src/legal/LegalPage.tsx` + `legal.css`; language from `?lang=` else Accept-Language else English; draft mark; indexable (own robots tag); `pageHeaders` gives `/terms` and `/privacy` the phone page's CSP.
  - **Release check:** `tools/build/src/legal-gate.ts` (reads the legal file as text; refuses while `LEGAL_DRAFT` is true or "before launch" / "will be named" remain in the text); `pnpm build:tv --release` runs it first. `APP_LAZY.only` in `tools/build/src/lazy-files.ts` now also lists `packages/protocol/src/legal.ts` (main.js may not hold it). Step 45's checklist should call `checkLegalRelease(root)`.
  - **Gates:** unit 348 files / 9287 tests; typecheck, lint; `build:tv` (Tizen): main.js 479.6 of 500 KB (+0.6), settings.js 139.1 of 150 (+17.6; 10.9 KB left), workers unchanged (query 149.3/150); e2e `about.spec.ts` 3/3 (en-US, ar-SA, en-XA: every section of both documents unclipped in the safe area), onboarding/telemetry/help specs green; web e2e `legal.spec.ts` 9/9; mutation 66/66 (`artifacts/mutate40d.py`).
- **New steps from Omar's Samsung session (`iptv-df`, relayed by message; added to RELAY.md after 40d as `- [ ] 40e`, `40f`, `40g`):**
  - **40e: the app's own on-screen keyboard, Arabic and English** (Omar chose "Our own keyboard"). Lab evidence: the Samsung IME offered no Arabic and the TV's language setting is greyed out; Done arrives as key 65376 `Select`, Cancel as 65385 `Cancel`.
  - **40f: Sources on the TV: edit (server, login), remove, add on the TV itself** (Omar chose "Edit + remove + add"). Uses 40e's keyboard.
  - **40g: `pnpm tv` fixes (39s6):** (a) `sdb forward --remove` the serial's forwards before forwarding (else "cannot install forward listener"); (b) `sdb shell 0 kill LabloIPTV1` before `sdb shell 0 debug LabloIPTV1.Lablo` (it hangs while the app runs); (c) `vd_appuninstall` needs the full id `LabloIPTV1.Lablo`.
  - `iptv-df` promised a second message with the soak's results (S10, S11, S4, S2/39s1, 39s4 baseline, step 21's zaps and soak, update-in-place, the "Zoma" answer) around 16:45 UTC. Treat it as input to RELAY steps: check its facts, and ask Omar himself for any tick a handover reserved for his word.
- **Waiting for Omar:** step 16's remaining Samsung parts, step 21 (TVs); his "3a" real-remote checks; 39s4, 39s6's TV run (`[needs TV]`); step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says accounts and keys are ready: skip it.

## Read first
1. **RELAY.md:** the `- [x] 40d.` block (its 7 "Refined before building" points and what it left to counsel); the `- [ ] 40e.`, `40f.`, `40g.` lines (the next steps); `- [ ] 43.`–`45.`; the last progress row (157).
2. **For 40e (keyboard):** `packages/ui/src/focus/text-editor.ts` and architecture.md "Built in step 13a" (text input on a TV: the focus engine never uses DOM focus, but a native `<input>` needs it); every text field in the app (search, login forms, PIN-by-keyboard, backup code, channel rename/number, the onboarding source form `apps/tv/src/onboarding/form.ts`); `packages/platform-tizen` / `-webos` key maps (65376, 65385); architecture.md §5 (the fallback "+2 sessions" claim: I could not confirm it by grep, check).
3. **For 40g:** `tools/tv/` (39s6) and its fake-sdb tests; `docs/runbooks`/tv-setup.md §3.7.
4. **Memory notes:** iptv-tv-bundle-polyfills (sizes: main.js 479.6/500, settings.js 139.1/150), iptv-ui-test-gotchas, iptv-parser-test-patterns (mutation), gh-pr-checks-watch-race (CI waits), use-write-tool-for-doc-batches, relay-peer-session-decisions.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -3` shows the handover commit, then `5a33619` (40d ticked, row 157, 40e–40g added), then `4c1d7d2` (PR #184's merge);
   - `origin/main` is `4c1d7d2`; no `*.mutbak` anywhere;
   - `docker ps` shows `lablo-web-postgres-1`.
   - `apps/web/.next` holds a clean `build:web` of this code.
2. **Step 40e, the keyboard.** Refine against the code first and write "Refined before building" points into RELAY.md. Decide and record: layouts as lazy tables (Arabic, Latin, digits/symbols, shift), how a key press reaches the focused field without DOM focus, RTL mirroring, how it composes with the platform's own keyboard where that works (LG), and the 65376/65385 keys. Check which app text fields exist before choosing the API. Done when: unit and e2e in en-US, ar-SA, en-XA; budgets hold (main.js has 20.4 KB left, settings.js 10.9 KB: layouts must load lazily or sit in a file of their own); mutation with the list written first; PR merged on green CI.
3. **Step 40f** (needs 40e), then **40g** (no TV needed: can come first if 40e is large). Refine each first.
4. **Then** 43 (accessibility), 44 (store documents), 45 (release engineering, calling `checkLegalRelease`).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It is `origin/main` (`4c1d7d2`) plus `5a33619` and this handover's commit (push it: `git push origin relay/iptv-20261101-214120`).
- **No open PR.** The main checkout was not touched (its local `main` is old; never use it).
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:** `node_modules`, `.cache/*`, `apps/web/.env`, `apps/web/.next`, `dist/` (a `build:tv` of 40d's code), `artifacts/` (`mutate40d.py` 66/66, screenshots `about-*-<tag>.png`, `legal-*-<lang>.png`).
- **Leg 157's scratch** (`C:/Users/Omarm/.claude/jobs/ec7d4844/tmp`; safe to ignore): `relay40d.py`, `relay40e.py`, `pr-body.md`, logs.

## Verified vs not
- **Verified in leg 157 (40d):** see Status gates; screenshots looked at: the web privacy page (ar, phone width) and the en-XA last privacy page on the TV.
- **Not done:** 40a–40d on a real TV; steps 40e–40g and 41–47; counsel's final text and the DMCA agent; 39s4 and 39s6's TV run; production (step 34), including the test pattern's file and the web address in the app.
- **Migrations and deploys:** none. Nothing is deployed (no deploy before step 34).

## Gotchas and lessons
**New in leg 157:**
- **A new always-present settings row moves pins again:** `guides-state.test.ts` (`.items` arrays end in `'help', 'about'`; row counts 7/10/11/12/6; `SETTINGS_SCREENS`), `parental-view.test.ts` (13 rows; last window `top: 6`).
- **A workspace package subpath needs three things:** `exports` in its package.json, eslint's boundaries allow-list (`eslint.config.js`, the `protocol` entry-point rule), and the lazy rule if only the settings may hold it (`APP_LAZY.only` takes a file path too).
- **Playwright `extraHTTPHeaders: {'accept-language'}` does not change Chromium's language:** use `browser.newContext({ locale })` for Accept-Language tests.
- **Web mutants need `pnpm build:web` in their command** (`next start` serves the old build; all 8 survived until it did). Each such mutant takes ~1.5 min; waits over 120 s go to the background by themselves.
- **HTML escapes `'` and `"` in the sent text:** an e2e comparing raw HTML to text must skip those headings (the DOM test covers them).
- **Core-js per property name:** `.replace(` / `.split(` in shared TV code inject polyfills: `pageOf` is a function with a template literal, not a `{n}` template.
- **A heredoc python patch with `\\n` or a double-quoted JS template broke twice again** (a real newline landed inside a template literal in build-tv.ts): Write patch scripts with the Write tool; Edit any line with a backslash.
- **`cd` in a Bash call moved the cwd again** (twice): use absolute paths.
- **Mutation numbering is positional:** delete a placeholder entry from the list, don't filter it later.

**From leg 156 (still true):**
- A module an e2e imports must import nothing from `@lablo/ui` (root `tsc` fails TS6142). Never `tsc -b` at the root (the gate is `pnpm typecheck`).
- Mutants that e2e alone catches need an e2e command in the mutate script's tuple; a signal read with `.value` vs `.peek()` where nothing changes meanwhile is an equivalent mutant.
- Write tool decodes `\u0600-\u06FF` in a regex literal: use a `charCodeAt` helper (`hasArabic`).
- `pnpm build:tv` in a background call: wait with `timeout 570 bash -c 'until grep -q "^exit " <log>; …'`.

**From leg 155 and earlier (still true):**
- A value a page reads only when its check runs is stale after something changes it: an e2e must make a check happen first. A plain-e2e playback failure needs no media.
- Mutation with the media e2e: a command starting `MEDIA ` runs with `LABLO_E2E_MEDIA=1`.
- **CI has 11 checks and takes about 13 minutes.** Wait with `timeout 575 bash -c 'until s=$(gh api repos/Omarmarei/Lablo/actions/runs/<run> --jq ".status + \" \" + (.conclusion // \"\")") && [ "${s%% *}" = "completed" ]; do read -t 30 < /dev/zero; done; echo "$s"'` (it goes to the background after 120 s: poll with short `read -t 105` rounds and `gh run view <run> --json status,conclusion,jobs`). Find the run with `gh run list --repo Omarmarei/Lablo --branch relay/iptv-20261101-214120 --limit 2` about 25 s after `gh pr create`. Known flakes: `epg-declared-300mb`, `auto-next.spec.ts:151` ar-SA.
- Catalog text lives in main.js: every UI string of both languages ships in the main bundle; long text goes in settings.js or a lazy file.
- VNode tests don't expand components; a new settings screen goes in `SETTINGS_SCREENS`.
- Node 22 (CI) differs from this PC's Node 24. `packages/*` tests run only from the root Vitest config. The `lablo` test account has 2 connections (`forever` = 4).
- No `jq` in Git Bash (use `gh --jq`). A push to an open PR cancels its CI. `rm` on a shell variable is refused. Foreground `sleep` is blocked: use `read -t N < /dev/zero` under `timeout`.
- Mutation and builds don't mix: never run mutation beside a build, an e2e run, a unit run or an agent reading the tree. Settings rows in e2e go by id (`e2e/settings-rows.ts`); use `--workers=2` for e2e on this PC.
- **Main-safe code** (settings.js too): none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`; no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`; no array destructuring or spread, no object spread in new code, no fragments; no `Promise.prototype.finally`. (Not for the mock, `tools/`, `apps/web` or tests.)
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text from the catalogs (or a settings.js-only table). Preact: write `translate={false}`. Every file under `apps/tv/src/settings/` must stay in settings.js.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the attribution lines the session gives. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG or Samsung binaries or certificates, no personal data, no LAN addresses or TV tokens. The support address `lablo.iptv@gmail.com` is public on purpose.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first (in the PR body). After the merge: `git -C "<wt>" merge --ff-only origin/main`, then tick the step and add the progress row.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **None pending for step 40.** 40d's choices (Omar may overrule): the consent points at the policy by a sentence naming Settings › "About Lablo", not a web link; one section a page; the draft text says what the code does today; the web pages are indexable.
- **40e/40f/40g came from Omar via his Samsung session:** if anything in them looks wrong against the code, say so in RELAY.md and ask Omar himself.
- **Omar's decision, when he wants (not blocking): MP4 subtitles on the Samsung** (AVPlay lists `mov_text`, sends no cue): leave, hide, or demux ourselves (architecture.md §2 "Step 39s5").
- **Later fixes to propose (no step yet):** regenerate `.cache/media` (`pnpm mock:media`); stop a test stream on `disable-playback`; media's own CI split; the `auto-next` `endEpisode` race; a reference check of Lablo's server on the connection page (with step 34); `pnpm tv` on webOS (SSAP keys); map AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` away from `network` once step 21 shows a real cut; the older list in RELAY.md.
- **Step 34 `[needs Omar]`:** R2 and Upstash adapters; `connect-src` and the bucket's CORS; `LABLO_RATE_SECRET` in Vercel; the config key ceremony; accounts and domain; the test stream's file and its `testStream` link; the first production migration and the deploy, each with his one-word OK. The domain also lets the web address into the consent sentence and About page.
- **What remains:** without Omar or a TV: 40e, 40f, 40g, 43, 44, 45; with Omar or a TV: 34, 16, 21, 39s4, 39s6's TV run, 41, 42, 46, 47.

## Checks for Omar
1. **40d, Settings › "About Lablo":** open the last row; read each document page by page with the remote (en and ar); look at the draft mark. Screenshots (gitignored): `artifacts/screenshots/about-*-<tag>.png`; web: `legal-<terms|privacy>-<lang>.png`.
2. **Read the draft text itself** (`packages/protocol/src/legal.ts`): it is a factual draft for counsel, not legal advice.
3. **40c Help, 40b "Test stream"** (see earlier handovers), and **"Zoma" on the Samsung** (the cached mock media still burns in the old name; `pnpm mock:media` regenerates it).
4. **39s6 has no screen.** Try `pnpm tv` at the Samsung (tv-setup.md §3.7).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:** remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`); read Dev Mode's "Remain Session"; open the app in Arabic once; "Use a backup code" with the TV's keyboard; Settings once (Help, then About Lablo last) and both language switches; Settings › "Player" rows, a channel with two audio languages, "Clock while watching", "Buffering" on Stable; "Sleep timer" 30 min and its prompt; the colour keys and Guide key; the info bar's pencil and Settings › "Channels"; a radio channel for 10 minutes; the PIN pad, hide/show while unlocked, "Forgot your PIN?", "Set a PIN" on onboarding's done screen; "Use your phone" with a real phone; `pnpm tv eval --port N`, `screen`, `soak` through `pnpm device inspect webos tv`'s port; "Check the connection" on and off the network; Settings › "Help" and "About Lablo": read each page.
- **At the Samsung TV next time** (his "3a"): S4 `suspend`, S10 by hand, S11's lifecycle and reading by ear; the "Zoma" he saw; the sleep timer's prompt; "Fast start" vs "Stable" channel starts; the lab's S2 again (`unlimitedstorage`: does `storage.estimate()` still say 88 MB?); the `.ts`-first behaviour after an outage (about 6 s plus AVPlay's close); step 21's soak with `pnpm mock --scenario live-outages` on channel 104; install the lab with `pnpm device install tizen <serial> --lab`; 39s6's run; Settings › "Check the connection", "Help" and "About Lablo".
- **Samsung:** back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12` somewhere safe for good.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- **Counsel:** the ToS and privacy policy replace 40d's draft before launch (his legal track, weeks 2–4): counsel's text sets `LEGAL_DRAFT` to false and removes the placeholders (DMCA agent's name, governing law, legal bases); `build:tv --release` refuses until then. Also register the DMCA agent.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-eight CLAUDE.md gaps** wait for his word: 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `git show 5fffb27:HANDOVER.md`; 48–54: `git show 081c1ee:HANDOVER.md`; 55: `git show e85772d:HANDOVER.md`; 56: `git show 6235456:HANDOVER.md`; 57: `git show b54b260:HANDOVER.md`; 58 (leg 154): CLAUDE.md's commands table says `pnpm verify` is what the `verify` job runs; since step 40ci it runs in five parallel parts.
- **Step 34:** the accounts, the domain and the keys are his; he puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
