# Lablo IPTV: relay leg 172 opening prompt (written at the end of leg 171)

You are leg 172 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

## Status
- **Earlier legs:** 1–170 did steps 1–33, 35–40h, 40ci, 40g(a–e), 39s1–39s7, 43–45 and 48–58. RELAY.md is about 115 KB; older steps' detail is in `docs/relay-archive.md` (grep it, never read it whole).
- **Leg 171 (2026-11-27/28): step 21L (step 21's LG half) is done; it found a bug, now step 59.** Docs only, commit `91aca66` (pushed, not on main: it reaches main with step 59's PR).
  - The LG was in standby when the leg began; Omar turned it on (his "1", 23:29). It went to standby again at about 01:34 and is off now.
  - **Launch to the last channel 4/4:** first frame 2335 / 1938 / 2085 / 2342 ms from navigation start (3.0–4.0 s from the PC's launch command, of which about 1.1 s is the CLI's own start and SSH call).
  - **100 rapid zaps pass:** no error, the channel shown is the one playing, the picture back 1.26–3.01 s after the last key, exact heap 2.08 → 2.15 MB.
  - **The soak:** with `ts` only it passed for 86 of 120 min (60 outages of 25 s, each stall ended 1.0–1.2 s after the stream came back). With a failing `.m3u8` the app **gives up** 4.0–4.6 s after the stream came back ("Your provider isn't sending this channel", `PRV-UNREACHABLE`) → **step 59**.
  - Detail: `docs/spikes/results.md`, "From the LG TV (2026-11-27)"; RELAY progress row 171.
- **You do step 59** (no TV needed). Step 21 itself stays open: its Samsung half and the LG's full 2 h re-run after 59 wait for Omar and a TV.

## Read first
1. RELAY.md: **step 59** (after 58), step 21 and 21L, progress row 171.
2. `docs/spikes/results.md`, "From the LG TV (2026-11-27)": the media-event sequence of the give-up.
3. `packages/player/src/ladder.ts` (the doc comment: rules 1–3, RELAY 20a, 39s2, 39s7) and `ladder.test.ts`; `packages/player/src/html5-engine.ts` `mediaError` (a `MEDIA_ERR_SRC_NOT_SUPPORTED` is `network` unless `canPlayType` says ''); `packages/player/src/controller.ts` and `controller.test.ts` (how a plan is applied, `framed`, `recovered`).
4. `apps/tv/src/main.tsx`: `readFacts` (line ~459), `sourceAdded` (~615), `refreshSource` (~752).
5. Memory: iptv-tv-soak-method (new), iptv-mock-provider-gotchas, iptv-playwright-chromium-media, iptv-ui-test-gotchas, iptv-repo-public-lablo, iptv-ci-media-ffmpeg-apt.

## Next steps, in order
1. **Check the state:**
   - `git -C "<wt>" status` is clean.
   - `git log --oneline -4` shows this handover's commit, `91aca66`, `f0e321e`, `972a68d`.
   - origin/main is `832d9c4`; no open PR; `gh repo view Omarmarei/Lablo --json visibility` says PRIVATE.
2. **Step 59 (a), the ladder:**
   - What happens: after the switch rung moves a framed `.ts` to `.m3u8`, and the `.m3u8` fails before a frame as `network`, `plan()` keeps `current = failed`. So the backoff reopens stay on the `.m3u8`, and the fourth attempt in 60 s gives up.
   - First write a failing test in `ladder.test.ts` (and one at the controller level if the controller is involved): candidates [ts, m3u8]; ts framed; a stall; `reopen` ts fails by timeout; `switch` to m3u8 fails with `{ kind: 'network' }` before a frame. The next plan should open ts.
   - Then the fix. For example: a URL that hasn't shown a frame in the session and failed before one hands the next attempts back to the URL that last showed a frame (or the backoff alternates between the two).
   - Keep these working: rule 1 (untried URLs before a first frame), the definitive path (20a), the 39s7 reset on the first frame, and AVPlay (a 404 there is `http`, definitive).
3. **Step 59 (b), the formats after a login given again:**
   - Lead, unverified: `refreshSource` calls `sourceAdded()` (and so `readFacts`) only when the refresh's status is `committed`. The refresh result type is `'committed' | 'unchanged'` (packages/data/src/ingest.ts:138).
   - On the LG the catalog didn't change: the row still said "Updated 17:39" after the save. So the new `allowed_output_formats` were stored but never re-read until a relaunch.
   - Test first, then re-read the facts on `unchanged` too (check that the meta patch is written on `unchanged`).
4. **The scenario and an end-to-end check:**
   - Add `apps/mock-provider/fixtures/scenarios/live-outages-hls-404.yaml`, a copy of `artifacts/21L-tools/live-outages-ts.yaml` (live TS stalls 60 s in for 25 s; the live `.m3u8` answers 404; every matching rule applies, and a status fault answers before any outage hold).
   - Update `faults.test.ts`' shipped list and count, and the scenario table in `docs/runbooks/mock-provider.md`.
   - Playwright's Chromium plays no TS (memory iptv-playwright-chromium-media), so the desktop never frames a `.ts`. The controller test with a fake engine may be the right proof; add an e2e only if one can reach the path.
5. **Gates and merge:**
   - Run the local gates: lint, tsc, `pnpm test` (the player package at least), mutation of the fix (a hand list written first), and `pnpm build:tv` (bundle sizes).
   - Open a PR (it carries `91aca66` too). For CI: a secrets scan, then `gh repo edit Omarmarei/Lablo --visibility public --accept-visibility-change-consequences`, push or create the PR about 30 s later, wait in foreground loops, merge on green (merge commit, keep the branch), then make the repo private again.
   - After the merge: fetch, ff-only, tick 59, add a progress row.
6. **Then everything left needs Omar or a TV.** End as **needs-you** with a numbered list:
   - the LG's full 2 h soak again after 59: both containers working, and the `.m3u8` on 404; the TV must stay on (it went to standby at 01:34 last time);
   - a Samsung session: 39s7's "Reconnecting…", step 21's Samsung zaps and soak, step 58's look;
   - Audio Guidance on another LG;
   - step 34 (accounts, domain, keys);
   - counsel's text;
   - steps 41, 42, 46 and 47;
   - pause the relay.

## Git state to expect
- Worktree `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed: origin/main (`832d9c4`), plus `cabc22a`, `972a68d`, `f0e321e`, `91aca66` (21L's results and step 59) and this handover's commit. The main checkout was not touched.
- Dev database: migration `20261123160000_pair_purpose`. Nothing in production, nothing deployed, no migrations.
- Gitignored but present:
  - `node_modules`, `apps/web/.env`, `dist/` (built at `f0e321e` for webOS), `.cache/fixtures`, `.cache/media`;
  - `artifacts/`:
    - the 21L raw files: `tv-soak-2026-11-27T*.ndjson`, `mock-21L-run{1,2,3}.log`, `events-21L-*.json`, `pair-21L-run3.txt`, `lg-21-0{1..4}.png`;
    - **`artifacts/21L-tools/`** (the leg's scripts: `probe.js`, `launch.js`, `zaprec.js`/`zapread.js`, `evrec.js`/`evdump.js`, `soakclear.js`, `heap.mjs`, `offset.mjs`, `pair.mts`, `live-outages-ts.yaml`, `fixtures-ts/`);
    - leg 170's `lg-58-*.png` and `lg-drive.ts`.
- No mock, ares-inspect or soak running (ports 8080 and 9998 free).
- **The LG's state:** in standby. Lablo was left in the player on channel 1 (English, Larger text off), not on the live screen. Its source تجربة has `allowed_output_formats` = `ts` stored (run 3 used a fixture copy with a TS-only `lablo` account). The next refresh against the normal mock stores `[m3u8, ts]` again.

## Verified vs not
- **Verified (leg 171):** everything in Status. The rule check (stall end − outage end) came from timestamped mock logs and the soak samples, with the TV's clock offset measured (358 ms behind the PC's).
- **Not verified:**
  - the LG soak for the full 2 h (86 min);
  - a soak with both containers working beyond its first outage;
  - step 59's fix (not started);
  - the (b) cause: a lead from reading the code;
  - anything on the Samsung with today's main.
- Migrations and deploys: none.

## Gotchas and lessons
**New in leg 171:**
- **`performance.memory` on the TVs' Chromium is a coarse bucket** (9.54 MB while the real heap was 2–4 MB). The soak's `heapMB` and the Samsung's "10 MB flat" can't show a leak. For the exact heap use `node artifacts/21L-tools/heap.mjs 9998 --gc` (CDP `Runtime.getHeapUsage` before and after `HeapProfiler.collectGarbage`). Only one inspector client at a time: not while a soak drains.
- **The LG's video is on its own hardware plane:** a screenshot of the player with the overlay hidden is blank (all transparent).
- **The ladder's attempts show in the page's media events:** `evrec.js` (via `pnpm tv eval --webos @file`) records `loadstart` (URL), `error` (code and message), `waiting`, `playing`, `emptied`, `abort` and keys with `Date.now()`; `evdump.js` reads them. A 404/403 on `.m3u8` shows as `MEDIA_ELEMENT_ERROR: Format error` (code 4).
- **Pairing stalls with outages:**
  - Run the mock through `| while IFS= read -r line; do printf '%s %s\n' "${EPOCHREALTIME/./}" "$line"; done`, which stamps each line in µs. The mock logs outages (`down`/`back`) and finished requests, never the live `.ts` responses.
  - `node node_modules/tsx/dist/cli.mjs artifacts/21L-tools/pair.mts <soak.ndjson> <mock.log> 358` replays the soak through `StallDetector` and prints each stall's freeze delay and its end after the outage.
- **A sampler left in the page from an earlier soak** feeds the next soak's first drain with old samples: run `soakclear.js` first, or relaunch.
- **`ares-inspect` drops on its own** after about 25 min to 2 h ("Unable to connect to the device", "Callback was already called"), with the TV still on. Start `pnpm tv inspect --webos tv` again; the soak's failed drains wait for it. The tunnel survives an app close and relaunch.
- **Launch timing:** `ares-launch` costs about 1.1 s of CLI start and SSH before the TV acts; launch with `tools/tv/node_modules/.bin/ares-launch.CMD` (not pnpm) and subtract a no-op `--running` call. `node artifacts/21L-tools/offset.mjs` measures the TV clock's offset.
- **A TS-only account without editing the repo:** copy `apps/mock-provider/fixtures` and add `output_formats: [ts]` to `lablo`, then `pnpm mock --fixtures <copy> --scenario live-outages`. Then re-save the login (Settings › Sources › row › "Change server and login" › Save, with DOWN×3 to Save) **and relaunch** (step 59 (b)).
- **The LG goes to standby at night** (it was off at 23:18 and at 01:34): check `ares-device --system-info --device tv` before relying on it. Ping doesn't answer; ARP does.
- `pnpm tv keys --webos` keys are about 570 ms apart (450 ms of the tool plus the round trip).

**From earlier legs (still true):**
- **Component CSS can blind the old-engine seeds:** after a change to VirtualList, ListRow or row heights, run `pnpm verify:engines --engine chrome53 --self-test` (about 12 min) before CI.
- **`git push` seconds after `--visibility public` answered 403:** retry after about 30 s.
- **`pnpm tv eval --webos '<js>'` with quotes or parentheses dies in cmd:** pass a file, `@C:/path/file.js` (a path without spaces is safest). `pnpm -s tv ...` keeps the output clean.
- Driving the LG:
  - `pnpm tv keys --webos DOWN OK BACK 1500 ...` (450 ms after each key, then the focus path and the text); `pnpm tv shot --webos <png>`. Each command ends by itself.
  - The Settings › Language picker is horizontal (RIGHT/LEFT). `ares-*` via `tools/tv/node_modules/.bin/ares-*.CMD`.
  - ares-inspect and `pnpm mock` outlive TaskStop: end them by pid (`Get-NetTCPConnection -LocalPort 8080,9998`, `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`).
- The soak on webOS reads the `<video>` (no AVPlay), so there is no inflow reading.
- e2e can't import a module that imports CSS; the Write tool decodes `\uXXXX` escapes; never set ms budgets from this PC (memory timing-budgets-calibrated).
- A new package under `packages/` fails `test/ci-changes.test.ts` until listed; a `.github/` change runs every job. A change in `packages/player/src/` runs the media job.
- CI waits:
  - Use foreground loops (`gh pr checks … > file`, then `read -t 14 < /dev/zero`); wait about 20 s after `gh pr create`.
  - A 500 on `gh pr create/merge` often still succeeds: check REST.
  - 13–23 min public. Known flakes: Chromium 53/56 start-up, `auto-next` ar-SA, telemetry 30 s, `epg-declared-300mb`. Use `gh run rerun --failed`.
- Heavy work one at a time; `--workers=2` for e2e; check free memory first.
- Main-safe code (packages/player too: it ships in main.js): none of these: `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`, new `for…of`, a `Uint8Array` value, `JSON.stringify`, array spread or destructuring, object spread, fragments, `finally`. ES2017; UI text from catalogs. Tests, tools and CI are not bound.
- Tizen main.js is at 496.4/500 KB: watch the budget.
- Smart App Control: before every pnpm/npx command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`. `.CMD` shims under a path with spaces fail in bash: call `node <pkg>/dist/cli.mjs` directly. A `.ts` script with top-level await outside a module package needs the `.mts` extension.
- Python patches: Write tool (or a quoted heredoc without backslashes), `newline=""`, `python -X utf8`. No `jq`; `rm` on a shell variable is refused; foreground `sleep` is blocked.

## Working rules (unchanged)
- Never call EnterWorktree. Use `git -C "<wt>"` and absolute paths. Scoped `git add`; check `git diff --cached --name-only`; commit with `git commit -F -` and the session's attribution lines. Never a bare `git stash`.
- Keep the repo publish-safe (it goes public during CI): no secrets, LG or Samsung binaries or certificates, new personal data, or TV tokens.
- IPTV PRs merge on green CI without Omar (merge commit, keep the branch). Never merge on red; a red caused by the CI environment is a needs-you. After the merge: fetch, ff-only, tick, progress row, repo private at once.
- Production: nothing before step 34. CLAUDE.md edits need Omar's direct word in his own tab.
- TVs: the LG's hand-over for 21L is over (the TV is off). No `pnpm tv`, sdb or `ares-*` against either TV unless Omar hands it over. Never soak Omar's real provider (mobile data); use the mock.

## Open decisions and gates
- The beta route per store (step 46, `docs/store/beta.md`): Omar's.
- MP4 subtitles on the Samsung: leave, hide, or demux. Not blocking.
- Later fixes without a step:
  - a reference check of Lablo's server on the connection page (needs step 34);
  - AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` mapping;
  - back-to-back outages can outlast the ladder (Samsung).
- Step 34 `[needs Omar]`: accounts, domain, keys, `LABLO_RATE_SECRET` in Vercel, the first production migration and deploy (each needs his one-word OK).

## Checks for Omar
1. On the LG, after step 59: the full 2 h soak again (leave the TV on, and turn off any auto standby for the evening).
2. On the Samsung: 39s7's inflow rule ("Reconnecting…" within about 30 s); step 21's 50 zaps and the 2 h soak on today's main; step 58's Larger text and key icons.
3. Audio Guidance on an LG that offers it (his OLED55A1PVA doesn't).
4. Store pack and beta kit: skim `docs/store/README.md` and `docs/store/beta.md`; the Arabic texts need a native read.
5. Release: `pnpm release:check --no-build`.
6. Larger text (step 58): the wording changes ("Languages, caption look, picture, clock, sleep timer, buffering and larger text"; Backup's intro "An encrypted copy of your sources, favourites and settings, to bring back after a reset."). Say if you want other wording.

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
