# Lablo IPTV: relay leg 173 opening prompt (written by the phase 2 planning session, 2026-11-28)

You are leg 173 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. It ships Arabic (RTL) and English, and launches in the GCC and North America.

**New since leg 172: phase 2.** On 2026-11-28 Omar approved [docs/PLAN-2.md](docs/PLAN-2.md). It makes three changes:
- **Lablo becomes a paid app:** a 6-week trial from each TV's install, then a lock, with purchase in the launch build.
- **The first store build carries 14 new features.**
- **Samsung's minimum is now 2020, and the build retargets to Chromium 68 first.**

RELAY.md has his eight decisions in "Phase 2: Omar's decisions", above the steps. Its new phases 11–19 hold steps 60–86, about 130 legs.

## Status
- **Earlier legs:** 1–172 did steps 1–33, 35–40 (all sub-steps), 39s1–39s7, 43–45 and 48–59.
  - Older steps' detail is in `docs/relay-archive.md`: grep it, never read it whole.
  - RELAY.md is about 167 KB: read the top, the "Standard done" block, your step, and the last progress rows. Grep the rest.
- **Leg 172:** merged step 59 (PR #204 as `daa8d58`) and stopped as needs-you: everything left needed a TV or Omar.
- **The planning session that followed** (not a leg; progress row "plan-2") did four things, docs only:
  - wrote `docs/PLAN-2.md`;
  - added phases 11–19;
  - ticked 39s and 40;
  - updated steps 16, 34, 41, 46 and 47.
- **You do step 60** (one leg): ADR-015 for Samsung 2020 and up, and closing step 16. Then the relay goes on with 61a, 61b and onward, one sub-step a leg.

## Read first
1. **RELAY.md:**
   - "Phase 2: Omar's decisions" (above the steps);
   - the "Standard done" block at the top of phase 11;
   - **step 60**, and steps 16, 41 and 47.
2. `docs/PLAN-2.md` §2, §3, §6.0 and §7.
3. `docs/adr/ADR-012-lg-minimum-webos5.md`. ADR-015 amends it the same way it amended PLAN.md.
4. **The code that reads the tier and the version:**
   - `packages/core/src/device.ts` (`deviceTier`);
   - `packages/platform-tizen/src/device.ts`;
   - every caller of `deviceTier` / `tier` (grep), such as the guide days in `packages/core/src/epg-guide.ts:65-86`;
   - `platforms/tizen/config.xml` (`required_version="4.0"`);
   - `tools/build/src/release-check.ts`.
5. **The docs that name 2018 for Samsung:**
   - `docs/store/beta.md` (lines 17, 107, 130 and 186);
   - `docs/store/samsung-submission.md`;
   - the listings;
   - `docs/testing-without-tvs.md`;
   - `docs/spikes/results.md`'s "Still to run (step 16)".
6. Memory: iptv-repo-public-lablo, iptv-ci-media-ffmpeg-apt, gh-pr-checks-watch-race, iptv-release-check, iptv-tv-autonomous-muted.

## Next steps, in order
1. **Check the state.**
   - `git -C "<wt>" status` is clean.
   - `git log --oneline -3` shows the phase 2 docs commit on top of `7df8e7d`.
   - origin/main is `daa8d58`, and there is no open PR.
   - `gh repo view Omarmarei/Lablo --json visibility` says PRIVATE.
2. **Step 60, refine first.**
   - List every place that reads the tier (`low`/`full`) and every place that names Tizen 4, Chromium 56 or 2018 for Samsung (code, tests, docs, store pack).
   - For each, decide what changes once the oldest Samsung is 2020 (Tizen 5.5, Chromium 69). Write the list into step 60 before building.
3. **Step 60, build.**
   - **ADR-015** (in `docs/adr/` and its README): Samsung needs Tizen 5.5 or newer. It also says what the `low` tier means now:
     - either a memory signal (`navigator.deviceMemory`, Chromium 63+; the LG reports 2);
     - or the tier is removed.
     - Choose by what each tier reader does with the 2020 Samsung's numbers in results.md: it holds about 668k programmes inside an 88 MB quota.
   - **The manifest:** `required_version="5.5"`, with a build test that pins it.
   - **The docs:**
     - the store pack and the beta kit say 2020, in en and ar;
     - `release:check` knows any line it pins;
     - `docs/testing-without-tvs.md` says no 2018 set is needed.
   - **Close step 16:**
     - mark each row of results.md's "Still to run" as run, moved (to 21, 41 or 42), or not needed;
     - tick 16.
4. **Gates and merge.** Follow "Standard done":
   - lint, tsc, `pnpm test`, and mutation of any logic change (hand list first);
   - `pnpm build:tv`, with the sizes in the row;
   - e2e only if a screen changed.
   - **For CI:**
     - run a secrets scan;
     - `gh repo edit Omarmarei/Lablo --visibility public --accept-visibility-change-consequences`;
     - push or create the PR about 30 s later (it carries the phase 2 docs commit too);
     - wait in foreground loops, and merge on green with a merge commit, keeping the branch;
     - make the repo private again.
   - **After the merge:** fetch, ff-only, tick 60, add a progress row.
5. **Write leg 174's handover for 61a** (the build's retarget):
   - It must have the before-sizes table to fill.
   - Note that CLAUDE.md's cheat-sheet change is 61c's, with Omar's word recorded in RELAY's decisions block.

## Git state to expect
- **The worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed.
  - It holds origin/main (`daa8d58`), plus `7df8e7d` (tick 59), plus the phase 2 docs commit (`docs/PLAN-2.md`, `RELAY.md`, `HANDOVER.md`).
  - The main checkout (`D:/Claude Code PlayGround/IPTV`) is far behind and was not touched.
- **The dev database:** migration `20261123160000_pair_purpose`. Nothing is in production; nothing deployed, no migrations.
- **The relay run:** at session 172 of its 200 cap. Phase 2 needs about 130 legs. Omar raises the cap or starts a new run; see "Open decisions".
- **Gitignored but present:**
  - `node_modules`, `apps/web/.env`, `dist/`, `.cache/fixtures`, `.cache/media`;
  - `artifacts/`, with the 21L raw files, `artifacts/21L-tools/` (`mute.js`, `probe.js`, `launch.js`, `evrec.js`/`evdump.js`, `heap.mjs`, `pair.mts`, …) and `lg-drive.ts`.
- **Nothing is running:** no mock, no inspector, no soak.

## Verified vs not
- **Verified (the planning session):**
  - the code facts in PLAN-2 §3: sizes, missing pieces, guard tests;
  - the store facts in PLAN-2 §4, read on Samsung's and LG's official pages on 2026-11-28.
- **Not verified:**
  - that Samsung Checkout needs Partner status: inferred from the `sso.partner` privilege; Omar's ticket confirms it;
  - LG's payment coverage in the US and the Gulf;
  - the stores' view of trial-then-lock;
  - every leg estimate.
- Migrations and deploys: none.

## Gotchas and lessons (still true)
**Driving the TVs:**
- **`performance.memory` on the TVs' Chromium is a coarse bucket.** For the exact heap, use `node artifacts/21L-tools/heap.mjs 9998 --gc`. Only one inspector client at a time.
- **The LG's video is on its own hardware plane:** a screenshot of the player with the overlay hidden is blank.
- **`ares-inspect` drops on its own** after 25 min to 2 h. Start `pnpm tv inspect --webos tv` again.
- **The LG goes to standby at night.** Check `ares-device --system-info --device tv` before relying on it.
- **Keys and screenshots on the LG:**
  - `pnpm tv keys --webos DOWN OK BACK 1500 …` and `pnpm tv shot --webos <png>`; each command ends by itself.
  - `pnpm tv eval --webos` takes a file: `@C:/path/file.js`.
  - The Settings › Language picker is horizontal.
- **Processes outlive TaskStop:** `ares-inspect` and `pnpm mock` must be ended by pid (`Get-NetTCPConnection -LocalPort 8080,9998`).

**Build and CSS:**
- **Component CSS can blind the old-engine seeds.** After a change to VirtualList, ListRow or row heights, run `pnpm verify:engines --self-test` on the oldest engine before CI: Chromium 53 until 61b, then 68.
- **Main-safe code, until 61c rewrites the list** (packages/player too: it ships in main.js). Avoid:
  - `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`;
  - a new `for…of`, a `Uint8Array` value, `JSON.stringify`;
  - array spread or destructuring, object spread;
  - fragments, `finally`.
  - Write ES2017, with UI text from the catalogs. Tests, tools and CI are not bound.
- **Tizen main.js is at 496.6 of 500 KB, and the query worker at 149.3 of 150.** Step 61 is there to make room; until then, add nothing to either.
- **e2e can't import a module that imports CSS.** The Write tool decodes `\uXXXX` escapes. Never set ms budgets from this PC (memory timing-budgets-calibrated).
- **New packages and CI scope:**
  - a new package under `packages/` (or an app) fails `test/ci-changes.test.ts` until it is listed;
  - a `.github/` change runs every job;
  - a change in `packages/player/src/` runs the media job.

**CI and GitHub:**
- **`git push` seconds after `--visibility public` answered 403:** retry after about 30 s.
- **CI waits:**
  - foreground loops (`gh pr checks … > file`, then `read -t 14 < /dev/zero`);
  - wait about 20 s after `gh pr create`;
  - a 500 on `gh pr create/merge` often still succeeds: check REST.
  - A public run takes 13–23 min.
  - Known flakes: Chromium 53/56 start-up, `auto-next` ar-SA, telemetry 30 s, `epg-declared-300mb`. Use `gh run rerun --failed`.

**The shell on this PC:**
- Heavy work one at a time; `--workers=2` for e2e; check free memory first.
- **Smart App Control:**
  - before every pnpm/npx command: `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`;
  - `.CMD` shims under a path with spaces fail in bash: call `node <pkg>/dist/cli.mjs` directly;
  - a `.ts` script with top-level await outside a module package needs the `.mts` extension.
- **Python patches:** use the Write tool (or a quoted heredoc without backslashes), `newline=""` and `python -X utf8`.
- No `jq`; `rm` on a shell variable is refused; foreground `sleep` is blocked.

## Working rules
- Never call EnterWorktree. Use `git -C "<wt>"` and absolute paths.
- **Commits:**
  - a scoped `git add`, then check `git diff --cached --name-only`;
  - commit with `git commit -F -` and the session's attribution lines;
  - never a bare `git stash`.
- **Keep the repo publish-safe** (it goes public during CI): no secrets, no LG or Samsung binaries or certificates, no new personal data, no TV tokens.
- IPTV PRs merge on green CI without Omar (merge commit, branch kept). Never merge on red; a red caused by the CI environment is a needs-you. After the merge: fetch, ff-only, tick, progress row, and the repo private at once.
- **Production:** nothing before step 34. Each production deploy, migration and store submission needs his one-word OK.
- **CLAUDE.md:** edits need Omar's direct word. Step 61c's Chromium 68 rewrite has it (RELAY's phase 2 decision 6).
- **TVs, autonomous and muted** (Omar, 2026-11-28; memory iptv-tv-autonomous-muted):
  - never ask him to act at a TV;
  - use a TV only when it answers by itself, and mute Lablo after every launch (`pnpm -s tv eval --webos @"<wt>/artifacts/21L-tools/mute.js"`);
  - no Wake-on-LAN at night;
  - never soak his real provider; use the mock.

## Open decisions and gates
- **The relay's cap:** 200 sessions, now at 172. Phase 2 needs about 130. Omar raises the cap or starts a new run (the `/relay` skill).
- **The store tickets** (PLAN-2 §9): their answers can change steps 72–76: the lock rules, the products, the Samsung build flag.
- **The beta route per store** (step 46, `docs/store/beta.md`): Omar's.
- **MP4 subtitles on the Samsung:** leave, hide, or demux. Not blocking.
- **Later fixes without a step:**
  - a reference check of Lablo's server on the connection page (needs step 34);
  - AVPlay's `UNKNOWN_ERROR_EVENT_FROM_PLAYER` mapping;
  - back-to-back outages can outlast the ladder (Samsung).

## Checks for Omar
1. **On the LG, after step 59:** the full 2 h soak again, under `live-outages-hls-404` and once with both containers working. Leave the TV on, and turn off auto standby for the evening.
2. **On the Samsung:**
   - 39s7's inflow rule ("Reconnecting…" within about 30 s);
   - step 21's 50 zaps and 2 h soak on today's main;
   - step 58's Larger text and key icons.
3. **Audio Guidance** on an LG that offers it (his OLED55A1PVA doesn't).
4. **The store pack and beta kit:** skim `docs/store/README.md` and `docs/store/beta.md`. The Arabic texts need a native read.
5. **Release:** `pnpm release:check --no-build`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Secrets: rotate the lionz IPTV provider password** (pasted 2026-11-25; never in the repo).
- **The phase 2 checklist** (RELAY.md, under "Omar's parallel track"; PLAN-2 §8). The first dates:
  - the Samsung Partner application by 1 Dec;
  - the two store tickets by 3 Dec;
  - the publishing company and counsel by 5 Dec;
  - step 34's accounts and keys by 10 Dec.
- **At the LG TV:** read Dev Mode's "Remain Session", and extend it in the Developer Mode app.
- **Samsung:**
  - back up `C:\Users\Omarm\SamsungCertificate\lablo-dev\author.p12`;
  - a signed `.wgt` needs the Tizen CLI + `TIZEN_SIGNING_PROFILE`.
- **Trademark clearance** (US, CA, AE, SA) and domains for "Lablo".
- **Counsel:** the ToS and privacy text for a paid app (`LEGAL_DRAFT` false, placeholders), the refund policy, the DMCA agent, and the store docs' `<official domain>` and test-server placeholders.
- **GitHub billing:** CI on the private repo was refused on 2026-11-27; keep the payment method valid.
- **Settings:** prune `D:\Claude Code PlayGround\IPTV\.claude\settings.local.json` when the relay ends, if he wants it tighter.
- **Sixty CLAUDE.md gaps wait for his word:**
  - 1–28: `git show d05d5fd:HANDOVER.md`; 29–47: `5fffb27`; 48–54: `081c1ee`; 55: `e85772d`; 56: `6235456`; 57: `b54b260`.
  - 58–60:
    - `pnpm verify` runs in five parts in CI;
    - the budget line omits lazy files (200 KB);
    - `pnpm release:check` is missing from the commands table.
  - Candidates:
    - 61: the repo's visibility rule (private, public only during Claude's CI);
    - 62: the text-fit check (`e2e/text-fit.spec.ts`) as the gate for any new screen or row;
    - 63: row or list CSS changes run `pnpm verify:engines --self-test` before CI.
