# Lablo IPTV: relay leg 143 opening prompt

You are leg 143 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** leg 0 planned the work; legs 1–141 did steps 1–33, 35, 35e, 36, 37, 38a, 38b, 38c1, 38c2 and 38c3, and built 38c4.
- **Leg 142 (2026-11-23): two sub-steps merged.**
  - **38c4** (the PIN's login check sent from the phone): its gates done, merged in **PR #166** as `966f8e9`. 38c is ticked (all four sub-steps).
  - **38d split into three:** 38d1 (the order, the e2e paths by row id), 38d2 ("Language"), 38d3 ("Player"). The shapes of 38d2 and 38d3 are in RELAY.md.
  - **38d1** built and merged in **PR #167** as `8932057`: the settings rows are now Sources, TV guides, Channel groups, Channels, Parental control, Backup, Usage and crash reports, Send a report to support.
  - Docs: `f3054fe` (RELAY row 142, architecture.md), then this handover's commit.
- **Waiting for Omar:**
  - step 16's Samsung part, 19b and 21 (the TVs);
  - step 34 (production infrastructure), deferred by Omar on 2026-11-19 until he says the accounts and keys are ready. Skip it until then.

## Read first
1. **RELAY.md:** step 38's "Shape" ("The complete settings screen", "Player", "Language"); 38d's bullet and its **"Split in leg 142"**: 38d1's "Done in leg 142", then **38d2's shape** (the next step) and 38d3's; the last progress row (142).
2. **docs/architecture.md** §1.4 item 10: "Built in step 38d1" (after "Built in step 38c4").
3. **For 38d2:**
   - `apps/tv/src/settings/settings-items.ts` (the order), `settings-state.ts` (`SettingsOptions`, the optional rows, `createSettings`), `SettingsScreen.tsx` (`itemText`, `SettingsView`, the dialogs);
   - `apps/tv/src/live/LiveApp.tsx` (~321–343: the effect that sets the locale from `language`);
   - `apps/tv/src/main.tsx`: `showLive` (~397), its `render(<LiveApp …>)` (~712), `settingsOptions` (~561);
   - `onboarding/start.ts` (`answerEdit`), `onboarding/onboarding-state.ts` (`LANGUAGES`), `onboarding/OnboardingApp.tsx` (~78–106: the language buttons), `i18n/index.ts` (`LANGUAGE_NAMES`, `switchedTag`).
4. **e2e helper:** `e2e/settings-rows.ts`.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean;
   - `git -C "<wt>" log --oneline -4` shows this handover's commit, `f3054fe`, `8932057` and `6483da1`;
   - no `*.mutbak`;
   - `docker ps` shows `lablo-web-postgres-1` and no `lablo-chrome*` container.
2. **38d2: "Language"**, as RELAY's shape. Refine it against the code first and write the refinements in RELAY (as 38c4's "Refined before building"), then build:
   - the row after "Parental control" (add `'language'` to `settings-items.ts`), its line listing the languages by their own names;
   - the dialog (a `language` screen in settings.js, a button per language, the focus on the one showing);
   - main.tsx: the profile's `onboarding.language` written (`answerEdit`), then `LiveApp` painted again with the new language. **Prove the switch in place in e2e** (both ways, in Settings and after Back on the live screen; a restart keeps it); fall back to `location.reload()` only if a screen keeps the old language;
   - the gates: unit tests, e2e (en, ar, en-XA), lint, typecheck, `build:tv` and a module diff, mutation with the list written first, the PR, CI, merge on green.
3. **38d3: "Player"**, as RELAY's shape (it may take a leg of its own). Then tick 38d and 38 (38's own "Done when": the lock check on the mock).

## Git state to expect
- **Worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed: `origin/main` (`8932057`) plus `f3054fe` and this handover's commit.
- **No open PR.** The main checkout was not touched.
- **The dev database** (`lablo-web-postgres-1`) has migration `20261123160000_pair_purpose`. Nothing is in production.
- **Gitignored but present:**
  - `node_modules`, `.cache/*`, `apps/web/.env`;
  - `apps/web/.next` (built from the merged web code) and `dist/` (`build:tv` of 38d1);
  - in `artifacts/`: `mutate38c4.py`, `mutate38d1.py`, `mprobe-38c4.log`, `build-tv-38d1.log`, `engines-38c4-68b.log` (the good 68 run), `engines-38c4-68.log` and `engines-38c4-53.log` (the two disturbed runs);
  - screenshots `artifacts/screenshots/settings-en.png`, `settings-ar.png`, `parental-settings-list-en.png`, `parental-settings-list-ar.png` (the new order).

## Verified vs not
- **Verified in leg 142:**
  - 38c4: core-js modules unchanged (216 in main.js, 6 in settings.js); mutation 68 of 68; `verify:engines` on Chromium 68 13 of 13 locally; PR #166's CI green (unit 8,559, e2e 209, engines on 53, 56 and 68);
  - 38d1: the settings, lazy and live unit tests (654); e2e for every spec that opens Settings (chromium 70, the web-backed tv project 13, the built bundle's 10); mutation 7 of 7; lint and both type checks; `build:tv` with sizes unchanged (main.js 454.6 KB on Tizen, settings.js 93.4 KB); the list's screenshots looked at; PR #167's CI green (unit 8,559, e2e 209, engines).
- **Not completed locally:** `verify:engines` on Chromium 53. Its background run was stopped by Claude Code's low-memory guard (after its webOS backup walk had failed under that memory pressure). It was not restarted; both PRs' engines jobs passed on 53.
- **Not yet:** 38d2, 38d3; production (step 34); the PIN pad, the phone check and the new settings order on a real TV (step 21's session).
- **Migrations and deploys:** none in this leg. `pair_purpose` is on the local dev database only. Nothing is deployed.

## Gotchas and lessons
**New in leg 142:**
- **Run the engines check alone.** `verify:engines --engine chrome68` beside a single-worker vitest loop failed two webOS walks; alone it passed in about 4 minutes.
- **A background run reaped for low memory is not restarted** (the harness says so, and memory agrees). For the engines, the PR's `engines` job is the check. Remove the container a reaped run leaves (`docker rm -f lablo-chrome53-…`).
- **Waiting for CI:** a Monitor loop built on `comm` printed one check and expired. Use one background Bash `until` loop on the pending count (`gh pr checks <n> --json bucket --jq '[.[] | select(.bucket=="pending")] | length'` = 0, after a 30 s sleep), then print the checks. After `gh run rerun --failed`, wait on the new job's id.
- **Mutation and agents don't mix:** a mutation run rewrites source files while it runs. A fork reading the tree at that moment took a mutant for a real change. Run mutation only when no agent works in the tree.
- **A test whose navigator ends at its root can't see one screen too many closed** (38c4's one survivor). Push the page the flow really opens from, then assert that page.
- **The phone page's e2e mutants take about 45 s each** (`pnpm build:web` 21 s, then the phone e2e), not minutes.
- **A fork did the 22-file e2e rewrite well** (about 8 minutes). Its brief: edit only under `e2e/`, no Playwright or builds, then root `tsc` and `eslint e2e`, and a per-file report of anything non-mechanical. Review those diffs, then run the specs yourself.
- **Settings rows in e2e go by id:** `SETTINGS_FIRST` (the open), `settingsRow(id)`, `toSettingsRow(remote, id)`, `fromSettingsRow(remote, from, to)` from `e2e/settings-rows.ts`. Never write `settings/items/<n>`. The last row starts out of view (seven of eight show): move to a row before asserting on it.
- **An e2e file may import an app module that imports nothing** (`settings-items.ts`). Only an import that reaches `@lablo/ui` breaks the root tsc.
- **Settings unit tests** (`guides-state.test.ts`) pin the order and each optional row's place: a new row changes those pins.
- **CI's e2e count (209) includes the throttled project** (200 chromium + 9).
- **`build:tv` took 2 minutes** once memory was back (7 GB free); under load it took over 10.

**From legs 130–141 (still true):**
- **The profile keeps onboarding's language.** A restart with `?locale=ar-SA` after an en-US onboarding still shows English. Onboard in the language you test; en-XA is the exception (onboard in en-US, restart in en-XA). 38d2 changes this value from Settings.
- **This PC is loaded by other sessions.** Use `--workers=2` locally for e2e; CI decides.
- **A `cd` in any Bash call moves the session's working directory.** Never `cd`.
- **Bash heredocs carrying python with quotes or backslashes fail.** Write every patch script with the Write tool.
- **The mock's panel gives the done screens a PIN prompt.** The shared steps take "Later": `toStartButton` and `closeDone`.
- **`LoadResult` is compared whole in the root tests:** grep the root `test/` too when a shared type changes.
- **With two sources the live rail is windowed:** check for the `open <group>` chip, not the last chip.
- **A random property failing on CI in untouched code can be a real bug:** reproduce it, fix it, pin it.
- **A change under `packages/protocol` brings in the media job.** `epg-declared-300mb` may fail once or twice; rerun with `gh run rerun <run> --failed` only after the whole run is done.
- **Mutation chunks:** run in the foreground with `MUT_TIMEOUT=300`; an e2e mutant takes 40–60 s, or up to 5 minutes when it waits out timeouts. Keep e2e mutants in chunks of one or two.
- **Send the deciding key and BACK in separate `press` calls.**
- **e2e profile tricks:** `restartWith(page, { sources: [...] })`, `storedSources`, `ordered` / `allOrdered`, `ADULT_OPEN`, `pinFields`, and the steps in `e2e/parental-steps.ts`.
- **Sizes:** main.js has a 500 KB hard budget on Tizen (454.6 KB now). The query worker has 1.5 KB left (148.5 of 150). The pair worker is at 143.2 of 150 KB. settings.js is at 93.4 of 150 KB.
- **CI:** a run takes about 30 minutes. Known flakes: `auto-next.spec.ts:151` (ar-SA, and en-US in leg 142), `telemetry.spec.ts:202`, `epg-declared-300mb`, `guide-offset.spec.ts` en-US, `rpc.test.ts:179`, Chromium 53/56 start-up and stuck deletes. There is no `jq` in Git Bash (use `gh --jq`).

**From earlier legs (still true):**
- **Main-safe code** (settings.js too):
  - none of `trim`, `.sort(`, `.split(`, regex `.test` or `new RegExp`;
  - no new `for…of`, no `Uint8Array` as a value, no `JSON.stringify`;
  - no array destructuring or spread, no object spread, no fragments;
  - no `Promise.prototype.finally`.
- **Layout and text:** physical CSS only, no Grid or flex `gap`, ES2017. UI text comes only from the catalogs. Preact: write `translate={false}`.
- **Every file under `apps/tv/src/settings/` must stay in settings.js** (a static import from main's side fails `build:tv`). Helpers main needs live outside `settings/`.
- **Smart App Control:** before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- **Environment:** CI runs Node 22, this PC Node 24. Run heavy checks one at a time.

## Working rules (unchanged)
- **Never call EnterWorktree.** Use `git -C "<wt>"`, absolute paths, scoped `git add` (check `git diff --cached --name-only`), and `git commit -F -` ending with the `Co-Authored-By` line. Never a bare `git stash`.
- **The repo is public as `Omarmarei/Lablo`:** no secrets, no LG binaries, no personal data.
- **Merging:** IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Name the three riskiest changes first. A push to an open PR cancels its CI.
- **Production:** nothing goes to production before step 34. Its migrations (including `pair_purpose`) and its deploy each need Omar's one-word OK.
- **CLAUDE.md edits need Omar's direct word in his own tab.**

## Open decisions and gates
- **Leg 142's choices** (Omar may overrule; each is small to change):
  - the settings' order is the shape's order (Sources, TV guides, Channel groups, Channels, Parental control, then Backup and the two report rows); "Language" and "Player" go before "Backup";
  - 38d is three sub-steps;
  - 38d2's shape: a dialog with the languages' own names rather than a switch in place; the row's line lists both names; the switch happens in place, with no reload, if e2e proves it;
  - 38d3's shape: "Audio language" (Same as the app, Arabic, English), "Subtitles" (Off, Arabic, English), "Subtitle size", "Picture", each changed in place.
- **Earlier legs' choices stand** (38b, 38c1–38c4; see RELAY).
- **Step 34 `[needs Omar]`:**
  - the R2 and Upstash adapters;
  - R2's host in `connect-src` and the bucket's CORS rule;
  - `LABLO_RATE_SECRET` in Vercel;
  - the config key ceremony;
  - the accounts and the domain;
  - the first production migration (including `pair_purpose`) and the deploy, each with his one-word OK.
- **Steps 16, 19b and 21 wait for Omar** (Samsung, and 30–45 minutes at the LG TV). That session also covers step 38's pad, the done screen's "Set a PIN", "Use your phone" on the check with a real phone, and the new settings order.
- **What remains after 38:** 39 (clock, sleep timer, colour keys, buffer setting); 40 (diagnostics and legal pages); 43 (accessibility); 44 (store documents); 45 (release engineering). With Omar or a TV: 34, 16/19b/21, 41, 42, 46, 47.
- **Later fixes to propose (no step yet):**
  - the restored-source login gap;
  - renaming a source; there is no way to remove a source in the app;
  - the info bar overflowing in en-XA;
  - a renamed hidden channel's old name over the list;
  - CH+ after hiding the playing channel;
  - `editChannel.close`'s e2e;
  - the guides screen's third line;
  - `auto-next`'s `endEpisode` race (it failed PR #166's first CI run);
  - a best-of-3 for `epg-declared-300mb`;
  - `guide-offset` en-US;
  - `rpc.test.ts:179`;
  - caching ffmpeg in CI;
  - the engines job's 35-minute cap;
  - forwarding workers' unhandled rejections;
  - `epgOverrides` after a re-match;
  - `config-server.ts`'s `close()`;
  - ingest request timeouts;
  - the query worker's budget;
  - the start's resume before the worker's load;
  - a VNode test of the pad;
  - the local e2e worker count under load;
  - **new:** stored guides keep their titles' language after a language switch until their next read (38d2's known limit).

## Checks for Omar
1. The new settings order: `artifacts/screenshots/settings-en.png` and `parental-settings-list-ar.png` (in the worktree, gitignored). Nothing to decide unless he wants another order.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **At the LG TV next time:**
  - remove the old lab `com.zoma.iptv.lab` (`ares-install --device tv --remove com.zoma.iptv.lab`);
  - read Dev Mode's "Remain Session";
  - open the app in Arabic once;
  - try "Use a backup code" with the TV's keyboard;
  - open Settings once (step 35e's file) and look at the new order;
  - try the info bar's pencil and Settings › "Channels";
  - play a radio channel for 10 minutes;
  - try the PIN pad with the remote, hide/show the app while unlocked, "Forgot your PIN?" with the TV's keyboard, "Set a PIN" on onboarding's done screen, and "Use your phone" on the check with a real phone.
- **Samsung Seller Office Partner application:** submit it as soon as possible (Samsung Gulf).
- **Trademark clearance** (US, CA, AE, SA) and domains for **"Lablo"**.
- `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` was widened with his authorisation on 2026-11-02. Prune it when the relay run ends if he wants it tighter.
- **Fifty-seven CLAUDE.md gaps** wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`;
  - 29–47: `git show 5fffb27:HANDOVER.md`;
  - 48–54: `git show 081c1ee:HANDOVER.md`;
  - 55: `git show e85772d:HANDOVER.md`;
  - 56: `git show 6235456:HANDOVER.md`;
  - 57 (new, leg 142): "e2e specs address a settings row by its id through `e2e/settings-rows.ts`, never by its number."
- **Step 34:** the accounts, the domain and the keys are his. He puts them in `.env`, plus `LABLO_RATE_SECRET` in Vercel.
- **GitHub billing:** keep the payment method valid.
- **Secrets:** none pending.
