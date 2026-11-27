# Lablo IPTV: relay leg 171 opening prompt (written at the end of leg 170)

You are leg 171 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** 1–169 did steps 1–33, 35–40h, 40ci, 40g(a–e), 39s1–39s7, 43–45 and 48–57. RELAY.md is about 110 KB; older steps' detail is in `docs/relay-archive.md` (grep it, never read it whole).
- **Leg 170 (2026-11-27): step 58 is done and merged.** PR #203 merged as `832d9c4` (merge commit, branch kept).
  - Local gates: lint, tsc, `pnpm build:tv` (Tizen main.js 496.4/500 KB, settings.js 152.7/200), `pnpm test` 365 files / 9647 tests, 17 e2e specs 58/58.
  - Checked on Omar's LG with `pnpm tv keys|shot --webos` (`artifacts/lg-58-01..30.png`, gitignored): en/ar × normal/Larger text, all text in its box.
  - CI's first run: all three engine jobs red on one result, `seed-css-no-list-row` passed (rows now fill their VirtualList slot, so they are 88 px without ListRow.css). Fix `c1768a1`: the gallery probe's `stacked` check (each row's number beside the rest). The second run was 11/11.
  - Then **Omar answered "1": step 21's LG half next.** Leg 170 added it as **step 21L** (RELAY.md, under step 21), commit `972a68d`.
- **You do step 21L.** The LG is handed over for it: Omar answered at about 23:15 local (+02:00) on 2026-11-27 and left it on, in Lablo, for about 3 h. Check that the TV answers first, and stop as needs-you if it doesn't (it may be off or asleep this late).

## Read first
1. RELAY.md: step 21 and **21L** (Phase 5), progress rows 170 and 170 (cont.).
2. `docs/spikes/results.md`: the Samsung's step-21 runs (around line 100: 50 zaps, 1.2 s apart; around line 130: zaps every ~560 ms, the heap; line 140 on: session `iptv-b6`). Use the same rules and the same kind of numbers for the LG.
3. `docs/runbooks/tv-setup.md` §3.7 item 6 (`pnpm tv --webos`: inspect, keys, shot, marks, eval, soak).
4. Memory: **iptv-lg-tv-devmode** (the leg 168–170 sections), iptv-mock-provider-gotchas, iptv-samsung-tv (the soak lessons), bg-watcher-memory-reap, iptv-repo-public-lablo.
5. `apps/mock-provider/fixtures/scenarios/live-outages.yaml`: live goes down 60 s into each response, for 25 s (step 21's soak scenario). Others: `stalling-streams.yaml`, `flaky-live.yaml`.

## Next steps, in order
1. **Check the state:** `git -C "<wt>" status` is clean; `git log --oneline -4` shows this handover's commit, `972a68d`, `cabc22a`, `832d9c4`. origin/main is `832d9c4`; no open PR; `gh repo view Omarmarei/Lablo --json visibility` says PRIVATE.
2. **The LG, ready:**
   1. This PC's Wi-Fi address (it was 192.168.1.7: the source تجربة points at `http://192.168.1.7:8080`). Check that the TV answers: `tools/tv/node_modules/.bin/ares-device.CMD --system-info --device tv`. Ports 8080 and 9998 free.
   2. `pnpm build:tv --platform webos --target app`, then `pnpm device install webos tv` (in place; it keeps the data).
   3. `pnpm mock --scenario live-outages` in the background. `pnpm tv inspect --webos tv` in the background (it prints "the inspector of com.lablo.iptv is on port 9998").
3. **Launch to the last channel (≤ 4 s), three times:** play a channel first (OK on a row of Live TV), then close the app and relaunch it (`pnpm device launch webos tv`; `inspect --webos` again after each launch), then `pnpm tv marks --webos`. Report DOMContentLoaded and the `lablo:` marks up to playing.
4. **50 rapid zaps:** `pnpm tv keys --webos CH_UP 600 CH_DOWN 600 ...` in short sequences (about 10 keys per command). Read the focus path and text it prints. Check: no hang, no error card, the channel shown is the one playing, the picture back within a few seconds of the last key. Read the heap before and after with `pnpm tv eval --webos @<file.js>` (a file, not inline JS; see Gotchas). Take a screenshot at the end (`pnpm tv shot --webos artifacts/lg-21-XX.png`).
5. **The 2 h soak with stalls:** with a channel playing, run `pnpm tv soak watch --webos --minutes 120 --every 60` **in the background** (it writes `artifacts/tv-soak-<time>.ndjson` and prints one line per drain).
   - Wait in **foreground** loops of at most 9 minutes (read the newest drain line, `read -t 14 < /dev/zero` between checks). The watcher only waits an hour for a background command, and the soak runs two.
   - The inspector takes one client: no other `pnpm tv` while the soak drains.
   - Rule: each stall (position frozen ≥ 1.5 s while playing) must end within 10 s of the stream coming back. Under `live-outages` each outage lasts 25 s by design; report the stall lengths and any beyond outage + 10 s.
   - If `ares-inspect` drops: `inspect --webos` again and start a new soak; report both files. `pnpm tv soak report <file>` reads one again.
6. **Write it up:** a "From the LG TV (2026-11-27)" section in `docs/spikes/results.md` with the numbers (launch marks ×3, the zaps, the soak's stall counts, the longest stall, the heap). Tick **21L** (step 21 itself stays open: its Samsung half waits for Omar). Add a progress row, commit, push the relay branch.
   - This is docs-only, so **no PR is needed now.** It reaches main with the next code PR. If the leg ends with only docs, say so in the report.
   - Anything that fails becomes a new RELAY step with what you saw.
7. **Put the TV back:** English, Larger text off, on Live TV. End the mock and ares-inspect by their node pids (they outlive TaskStop; `Get-NetTCPConnection -LocalPort 8080,9998`, then `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` for the tsx/pnpm parents).
8. **Then everything left needs Omar or a TV:** end **needs-you** with a short numbered list:
   - a Samsung session (39s7's "Reconnecting…", step 21's Samsung zaps and soak);
   - Audio Guidance on another LG;
   - step 34 (accounts, domain, keys);
   - counsel's text;
   - steps 41, 42, 46 and 47;
   - pause the relay.

## Git state to expect
- Worktree `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed: origin/main (`832d9c4`), plus `cabc22a` (58's tick), `972a68d` (21L) and this handover's commit. The main checkout was not touched.
- Dev database: migration `20261123160000_pair_purpose`. Nothing in production, nothing deployed, no migrations.
- Gitignored but present: `node_modules`, `apps/web/.env`, `dist/` (built at `832d9c4`'s parent; rebuild), `.cache/fixtures`, `.cache/media`, `artifacts/` (lg-58-*.png, lg-drive.ts, mutate58.py, `engines/` from the local Chromium 53 run).
- GitHub: no scratch branches; scratch workflows disabled; only `CI` active.

## Verified vs not
- **Verified (leg 170):** everything in Status above. On Chromium 53 locally, `pnpm verify:engines --engine chrome53 --self-test` exited 0 with 32 seeds caught. CI 11/11 on `c1768a1`.
- **Not verified:** step 58 on the Samsung (the row scale and the key icons are generic; untried there); step 21 on either TV on today's main.
- Migrations and deploys: none.

## Gotchas and lessons
**New in leg 170:**
- **Component CSS can blind the old-engine seeds:** a change to VirtualList, ListRow or row heights → run `pnpm verify:engines --engine chrome53 --self-test` locally before CI (Docker, about 12 min; ends "N seeded failures caught as expected", exit 0). Read a red engine job with `gh run view <run> --job <id> --log` and grep `unexpected result`. The other seeds' FAIL lines are meant to fail.
- **`git push` seconds after `--visibility public` answered 403:** retry after about 30 s. Between two CI runs of one PR (a fix decided), make the repo private, then public again just before the next push.
- **`pnpm tv eval --webos '<js>'` with quotes or parentheses dies in cmd** ("The filename, directory name, or volume label syntax is incorrect"). Put the JS in a file and pass `@C:/path/file.js`; a bare expression like `document.documentElement.lang` works. `pnpm -s tv ...` keeps the output clean.
- **The Settings › Language picker is horizontal:** RIGHT/LEFT, not DOWN. In Arabic, English is to the RIGHT.
- Driving speed: one screen check (keys, shot, Read) takes about a minute.
- In أسرع the ع stands apart because ر never joins the next letter: shaping, not a bug. The keyboard panel covers the lower search results by design.

**From earlier legs (still true):**
- Driving the LG: `pnpm tv keys --webos DOWN OK BACK 1500 ...` (450 ms after each key, then it prints the focus path and the text); `pnpm tv shot --webos <png>`. Each command ends by itself. `Input.insertText` doesn't type into the app's keyboard: arrows to each key, then OK. In RTL the header mirrors. The screensaver comes but doesn't affect the page or screenshots. `ares-*` via `tools/tv/node_modules/.bin/ares-*.CMD`. ares-inspect and `pnpm mock` outlive TaskStop.
- The soak on webOS reads the `<video>` (no AVPlay), so it has no inflow reading (`"inflow": false`). A failed drain waits for the next one.
- The text-fit walk is order-sensitive (OK in the guide plays; after anything plays, the next start opens the player).
- A vertical list scales with Larger text automatically (VirtualList and zones). A fixed-height row outside VirtualList needs `settingsWindow`-style code, or text-fit fails.
- e2e can't import a module that imports CSS: keep shared constants in import-free modules.
- The Write tool decodes `\uXXXX` escapes: grep for raw marks after writing; use code points in tests.
- Timing budgets: never set ms budgets from this PC (memory timing-budgets-calibrated).
- A new package under `packages/` fails `test/ci-changes.test.ts` until listed; a `.github/` change runs every job.
- A new settings screen id must be in `SETTINGS_SCREENS` and `guides-state.test.ts`'s pin. Settings › Player is 9 rows.
- CI waits:
  - Use foreground loops (`gh pr checks … > file`, then `read -t 14 < /dev/zero`); wait ~20 s after `gh pr create`.
  - A 500 on `gh pr create/merge` often still succeeds: check REST.
  - CI takes 13–23 min public. Known flakes: Chromium 53/56 start-up, `auto-next` ar-SA, telemetry 30 s.
- Heavy work one at a time; `--workers=2` for e2e; check free memory first. Background processes can be reaped under memory pressure.
- Main-safe code (settings.js too): none of these: `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`, new `for…of`, a `Uint8Array` value, `JSON.stringify`, array spread or destructuring, object spread, fragments, `finally`. Physical CSS only, no Grid or flex `gap`, ES2017; UI text from catalogs. Tests, tools and CI are not bound.
- Smart App Control: before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
- Python patches: Write tool (or a quoted heredoc without backslashes), `newline=""`, `python -X utf8`. No `jq`; `rm` on a shell variable is refused; foreground `sleep` is blocked.

## Working rules (unchanged)
- Never call EnterWorktree. Use `git -C "<wt>"` and absolute paths. Scoped `git add`; check `git diff --cached --name-only`; commit with `git commit -F -` and the session's attribution lines. Never a bare `git stash`.
- Keep the repo publish-safe (it goes public during CI): no secrets, LG or Samsung binaries or certificates, new personal data, or TV tokens.
- IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Never merge on red; a red caused by the CI environment is a needs-you. After the merge: fetch, ff-only, tick, progress row, repo private at once.
- Production: nothing before step 34. CLAUDE.md edits need Omar's direct word in his own tab.
- TVs: the LG is handed over for step 21L (Omar's "1"). No `pnpm tv`, sdb or `ares-*` against the Samsung unless Omar hands it over. Never soak Omar's real provider (mobile data); use the mock.

## Open decisions and gates
- The beta route per store (step 46, `docs/store/beta.md`): Omar's.
- MP4 subtitles on the Samsung: leave, hide, or demux. Not blocking.
- Later fixes without a step: a reference check of Lablo's server on the connection page (needs step 34); AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` mapping; step 21's quirks (back-to-back outages can outlast the ladder; the switch rung moves the stream to HLS, where the scenario never stalls).
- Step 34 `[needs Omar]`: accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each needs his one-word OK).

## Checks for Omar
1. On the Samsung: 39s7's inflow rule ("Reconnecting…" within about 30 s); step 21's 50 zaps and the 2 h soak on today's main; step 58's Larger text and key icons.
2. Audio Guidance on an LG that offers it (his OLED55A1PVA doesn't).
3. Store pack and beta kit: skim `docs/store/README.md` and `docs/store/beta.md`; the Arabic texts need a native read.
4. Release: `pnpm release:check --no-build`.
5. Larger text (step 58): lists show fewer, taller rows. Wording changes:
   - English Player hint: "Languages, caption look, picture, clock, sleep timer, buffering and larger text".
   - Backup's intro: "An encrypted copy of your sources, favourites and settings, to bring back after a reset."
   - Say if you want other wording.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Secrets: rotate the lionz IPTV provider password** (pasted 2026-11-25; never in the repo).
- At the LG TV: read Dev Mode's "Remain Session" (extend it in the Developer Mode app).
- Samsung: back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12`. A signed `.wgt` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`. Submit the Seller Office Partner application (Samsung Gulf).
- Trademark clearance (US, CA, AE, SA) and domains for "Lablo".
- Counsel: the ToS and privacy text (`LEGAL_DRAFT` false, placeholders), the DMCA agent, the store docs' `<official domain>` and test-server placeholders.
- GitHub billing: CI on the private repo was refused on 2026-11-27; keep the payment method valid.
- Settings: prune `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` when the relay ends, if he wants it tighter.
- Sixty CLAUDE.md gaps wait for his word:
  - 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `5fffb27`; 48–54: `081c1ee`; 55: `e85772d`; 56: `6235456`; 57: `b54b260`.
  - 58–60: `pnpm verify` runs in five parts in CI; the budget line omits lazy files (200 KB); `pnpm release:check` is missing from the commands table.
  - Candidates: 61, the repo's visibility rule (private, public only during Claude's CI); 62, the text-fit check (`e2e/text-fit.spec.ts`) as the gate for any new screen or row; 63, row or list CSS changes run `pnpm verify:engines --engine chrome53 --self-test` before CI.
