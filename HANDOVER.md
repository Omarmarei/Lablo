# Lablo IPTV: relay leg 174 opening prompt (written by leg 173, 2026-11-28)

You are leg 174 of relay run `iptv-20261101-214120`. The product, **Lablo**, is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. It ships Arabic (RTL) and English, and launches in the GCC and North America.

**Phase 2 is under way.** [docs/PLAN-2.md](docs/PLAN-2.md) (Omar, 2026-11-28) builds **Lablo 1.1**: a paid app (a 6-week trial from each TV's install, then a lock, with purchase in the launch build), 14 new features, Samsung 2020 and up, and the build retargeted to Chromium 68 first. **v1** is git tag `v1` at `daa8d58`: never move or delete it. A built copy is in `D:/Claude Code PlayGround/Lablo-v1/`. RELAY.md's "Phase 2: Omar's decisions" (above the steps) holds his nine decisions. Phases 11–19 hold steps 60–86.

## Status
- **Legs 1–172** did steps 1–33, 35–40, 39s1–39s7, 43–45 and 48–59. Detail of older steps is in `docs/relay-archive.md`: grep it, never read it whole. RELAY.md is about 170 KB: read the top, the "Standard done" block (phase 11), your step, and the last progress rows. Grep the rest.
- **Leg 173 (this one) did step 60 and closed step 16.** PR #205 merged as `b37d1d8` on 11/11 green CI. It also carried the planning session's phase 2 docs commits.
  - **ADR-015** (`docs/adr/ADR-015-samsung-minimum-tizen55.md`): Samsung starts at Tizen 5.5 (2020). `platforms/tizen/config.xml` has `required_version="5.5"`. `checkConfigXml` (`tools/build/src/platform-files.ts`, `TIZEN_REQUIRED_VERSION`), which both `build:tv` and `release:check` run, refuses any other value.
  - **The `low` tier stays as a seam with no supported TV in it.**
    - **No memory signal:** S0's records show `navigator.deviceMemory` = 1 on the 2020 Samsung and 2 on the LG. The Samsung passed every tier-gated S6 check in `full`.
    - **An unknown year and engine now give `full`.** Tizen user agents have no `Chrome/` token, so a Tizen newer than `TIZEN_RELEASES` (10.0) used to read `low`.
    - **`low` is still given for** a year before 2020 or an engine before Chromium 68.
  - **Docs:**
    - the store pack and the beta kit (en and ar) say 2020;
    - `docs/testing-without-tvs.md` has a "superseded" note;
    - PLAN, architecture, tv-setup and ADR-012 are amended;
    - results.md's "Still to run" now marks each row as run, moved (to 21, 41, 42 or 86's TV checks) or not needed.
  - Step 16 is ticked, and step 41's memory-signal line is answered.
- **You do step 61a: the build's retarget to Chromium 68** (one leg). Then 61b (the harness and CI), 61c (the rules, CLAUDE.md), 61d (only if 61a frees under 30 KB of main.js), and 62 onward, one sub-step a leg.

## Read first
1. **RELAY.md:**
   - "Phase 2: Omar's decisions" (decision 6 is the retarget, and his word for 61c's CLAUDE.md change);
   - the "Standard done" block at the top of phase 11;
   - **step 61** (all of it: 61a–61d), and leg 173's progress row.
2. `docs/PLAN-2.md` §6.0 and §7.
3. `docs/adr/ADR-003-chrome53-iife-syntax-gate.md`, and ADR-012's "Later cleanup". ADR-003's own amendment is 61c's job; 61a only changes the code and the numbers.
4. **The code:**
   - `tools/build/src/bundle.ts`: `TV_TARGETS = { chrome: '53' }` at line 24, used by every Babel `preset-env` call (lines 420, 435, 444), core-js `usage`, `UNUSED_POLYFILLS`, `polyfillsExcept`;
   - `tools/build/src/syntax-gate.ts` (`GATE_ECMA_VERSION = 2016`);
   - `tools/build/src/css-gate.ts`: grid refused at lines 29–31, `gap` at 32, logical properties at 34–37;
   - `tools/build/src/budgets.ts`, and the tests beside each file;
   - `tools/build/package.json`.
5. **Memory:** iptv-tv-bundle-polyfills (its module-diff probe and its "Leg 173" note), iptv-css-pipeline-gotchas, iptv-repo-public-lablo, gh-pr-checks-watch-race, iptv-ci-media-ffmpeg-apt.

## Next steps, in order
1. **Check the state.**
   - `git -C "<wt>" status` is clean.
   - `git log --oneline -3` shows `5764c4a` (tick 60) on top of `b37d1d8`.
   - origin/main is `b37d1d8`, with no open PR.
   - `gh repo view Omarmarei/Lablo --json visibility` says PRIVATE.
2. **Step 61a, refine first.** Write into the step:
   - what Babel stops transforming at Chromium 68;
   - which core-js polyfills drop (the module-diff probe in memory iptv-tv-bundle-polyfills);
   - what the gates allow.
   - **Found in leg 173 (Babel's `@babel/compat-data` 7.29.7):** at `chrome: 68`, Babel leaves untransformed:
     - optional catch binding (Chromium 66);
     - JSON strings (66);
     - object rest/spread (60);
     - async generators (63);
     - the regex `s` flag (62), named groups and `\p{}` (64);
     - async functions (55).
   - **The gate problem:** the code already writes `catch {` (for example `packages/platform-tizen/src/index.ts`'s `attempt`). acorn at `ecmaVersion: 2018` refuses optional catch binding, which is ES2019 syntax. So the gate must be **ES2019**, or 61a forces Babel's `transform-optional-catch-binding` and `transform-json-strings`.
     - ES2019's only syntax additions are those two, both in Chromium 66.
     - ES2020's `??` and `?.` need Chromium 80 and 91 (Babel's numbers), so Babel keeps transforming them.
     - Choose, and write the reason into the step. RELAY's "moves to ES2018" assumed ES2018 was all that Chromium 68 has.
   - **Library methods stay polyfilled or avoided:** `Array.prototype.flat`/`flatMap` (69), `Object.fromEntries` (73), `globalThis` (71), `queueMicrotask` (71), `String.prototype.matchAll` (73), `Promise.allSettled` (76). core-js `usage` handles them by target.
3. **Step 61a, build.**
   - `TV_TARGETS` → `{ chrome: '68' }`.
   - The syntax gate → 2019, or 2018 plus the two transforms; keep the gate's tests honest with a seed of the first refused syntax (ES2020 `?.`).
   - The CSS gate allows grid (Chromium 57). It still refuses flex `gap` (84) and logical properties and `inset` (87).
   - The sizes table, before and after, for main.js, settings.js and every worker, on both platforms. It goes in the progress row and in architecture.md.
   - **Before** (leg 173's `build:tv`, KB own code, same on both platforms unless two numbers):

     | File | Before | After |
     |---|---|---|
     | main.js | Tizen 496.6, webOS 482.9 (+909.6 of inlined workers) | |
     | settings.js | 152.7 | |
     | ingest worker | 142.4 | |
     | epg worker | 118.1 | |
     | telemetry worker | 79.3 | |
     | backup worker | 136.9 | |
     | query worker | 149.3 | |
     | pair worker | 143.2 | |
     | config worker | 139.3 | |
     | app.css | 117.8 | |

   - **The old-engine harness still runs Chromium 53 and 56 until 61b.** A 68-targeted build fails there by design (async functions are native from Chromium 55; object spread needs 60).
     - So **61a's PR will fail CI's `engines (chrome53)` and `(chrome56)` jobs.** Either fold 61b's harness change into the same PR (the step lists them apart; one PR for 61a+61b is fine if the leg has room), or have 61a's PR change the `engines` job's matrix to 68 only, as the first piece of 61b.
     - **Never merge on red.** `test/ci-changes.test.ts` and `.github/workflows/ci.yml` change with the matrix; a `.github/` change runs every job.
4. **Gates and merge** ("Standard done"):
   - lint, tsc, `pnpm test`, and mutation of any logic change (hand list first);
   - `pnpm build:tv` with sizes;
   - `pnpm verify:engines --self-test --engine chrome68` before CI (Docker).
   - **For CI:**
     - run a secrets scan of `b37d1d8..HEAD`;
     - `gh repo edit Omarmarei/Lablo --visibility public --accept-visibility-change-consequences`;
     - wait about 30 s, then push and create the PR;
     - one background watcher loop;
     - merge on green with a merge commit, keeping the branch;
     - make the repo private again at once.
   - **After the merge:** fetch, ff-only, tick 61a, add a progress row.
5. **Write leg 175's handover** for 61b (or 61c, if 61b went in with 61a).

## Git state to expect
- **The worktree:** `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`, pushed. It holds origin/main `b37d1d8` plus `5764c4a` (the RELAY tick), and this handover's commit on top.
- **The main checkout** (`D:/Claude Code PlayGround/IPTV`) is far behind and untouched.
- **Nothing is in production:** no deploy and no migration. The dev database is at `20261123160000_pair_purpose`.
- **The relay run:** session 173, cap 330 (Omar raised it from 200).
- **Gitignored but present:**
  - `node_modules`, `apps/web/.env`, `dist/` (leg 173's build), `.cache/fixtures`, `.cache/media`;
  - `artifacts/`: the 21L tools `mute.js`, `probe.js`, `launch.js`, `heap.mjs`, … and `lg-drive.ts`; the LG lab logs in `artifacts/lab-logs/`.
- **The Samsung's raw lab logs** are at `D:/tmp/lablo-samsung/artifacts/lab-logs/` (outside the repo; its scripts hold the TV's address: never copy them in).
- Nothing is running: no mock, inspector or soak.

## Verified vs not
- **Verified (leg 173):**
  - PR #205's CI 11/11 green on a public run (engines 53/56/68 9–13 min, media 12 min, e2e 10–11 min);
  - locally: lint and tsc; `pnpm test` 9,660 passed; `build:tv`;
  - 6/6 hand mutants killed;
  - the S0 `deviceMemory` values read from the raw logs.
- **Not verified:**
  - a 2026 Samsung's real user agent and platform version (the test assumes `Tizen 10.0` and an engine token with no `Chrome/`);
  - Samsung Checkout needing Partner status (Omar's ticket);
  - LG's payment coverage in the US and the Gulf;
  - the stores' view of trial-then-lock;
  - every leg estimate.
- Migrations and deploys: none.

## Gotchas and lessons (still true)
**This leg:**
- **The full `pnpm test` timed out five heavy tests at 30 s under load:**
  - `test/crypto-vectors-bundle.test.ts`;
  - `test/pair-worker-bundle.test.ts`;
  - `tools/fixtures/test/m3u-core.test.ts`;
  - `tools/fixtures/test/xtream-xmltv-core.test.ts` (twice).
  - Rerun those files alone (16/16 passed) before blaming a change. 61a rebuilds the worker bundles these tests make, so a real failure there would show alone too.
- **There is no mutation tool in the repo.** Mutation is a throwaway script that applies each mutant, runs the named vitest files, and restores the file in a `finally`. Write the list first.
- **Python patch scripts:** write them with the Write tool. A heredoc's `\\s` reached Python as `\s` (only a warning that time, but it can mangle).

**Driving the TVs:**
- **`performance.memory` on the TVs' Chromium is a coarse bucket.** For the exact heap, use `node artifacts/21L-tools/heap.mjs 9998 --gc`. Only one inspector client at a time.
- **The LG's video is on its own hardware plane:** a screenshot of the player with the overlay hidden is blank.
- **`ares-inspect` drops** after 25 min to 2 h: run `pnpm tv inspect --webos tv` again.
- **The LG goes to standby at night:** check `ares-device --system-info --device tv` first.
- **Keys and screenshots on the LG:**
  - `pnpm tv keys --webos DOWN OK BACK 1500 …` and `pnpm tv shot --webos <png>`; each command ends by itself;
  - `pnpm tv eval --webos @C:/path/file.js`.
- **Processes outlive TaskStop:** end `ares-inspect` and `pnpm mock` by pid (`Get-NetTCPConnection -LocalPort 8080,9998`).

**Build and CSS:**
- **Component CSS can blind the old-engine seeds.** After a change to VirtualList, ListRow or row heights, run `pnpm verify:engines --self-test` on the oldest engine before CI: Chromium 53 until 61b, then 68.
- **Main-safe code until 61c rewrites the list** (packages/player too). Avoid:
  - `trim`, `.sort(`, `.split(`, regex `.test`, `new RegExp`;
  - a new `for…of`, a `Uint8Array` value, `JSON.stringify`;
  - array spread or destructuring, object spread;
  - fragments, `finally`.
  - Write ES2017, with UI text from the catalogs. Tests, tools and CI are not bound.
- **Tizen main.js is at 496.6 of 500 KB, and the query worker at 149.3 of 150.** Add nothing to either before 61a frees room.
- **e2e and test limits:**
  - e2e can't import a module that imports CSS;
  - the Write tool decodes `\uXXXX` escapes;
  - never set ms budgets from this PC (memory timing-budgets-calibrated).
- **CI scope:**
  - a new package under `packages/` fails `test/ci-changes.test.ts` until it is listed;
  - a `.github/` change runs every job;
  - `packages/player/src/` runs the media job.

**CI and GitHub:**
- **Visibility:** the repo is PRIVATE except during CI. Flip it public before a push, rerun or PR create, and private right after (memory iptv-repo-public-lablo). A push seconds after the flip answered 403: wait about 30 s.
- **CI waits:**
  - one background watcher of the form `until gh pr checks N > file; grep -q -E "pass|fail" file && ! grep -q -E "pending|in_progress|queued" file; do read -t 45 < /dev/zero; done`;
  - wait about 20 s after `gh pr create`;
  - a 500 on `gh pr create/merge` often still succeeds: check REST.
  - Known flakes: Chromium 53/56 start-up, `auto-next` ar-SA, telemetry 30 s, `epg-declared-300mb`. Use `gh run rerun --failed`.

**The shell on this PC:**
- Heavy work one at a time; `--workers=2` for e2e; check free memory first (7.8 GB free of 31 GB this leg).
- **Smart App Control:** before every pnpm or node tool command, `export NODE_OPTIONS="--require \"D:/Claude Code PlayGround/IPTV-relay-20261101-214120/.cache/rollup-wasm/hook.cjs\""`.
  - `pnpm --dir "<wt>" -s <script>` works.
  - For vitest on single files: `node node_modules/vitest/vitest.mjs run <files>` from the worktree.
- Python: `newline=""` and `python -X utf8`. No `jq` (use `gh --jq` or node). `rm` on a shell variable is refused; foreground `sleep` is blocked (use `read -t N < /dev/zero`).

## Working rules
- Never call EnterWorktree. Use `git -C "<wt>"` and absolute paths.
- **Commits:**
  - a scoped `git add`, then check `git diff --cached --name-only`;
  - `git commit -F -` with the session's attribution lines;
  - never a bare `git stash`.
- **Keep the repo publish-safe** (it goes public during CI): no secrets, no LG or Samsung binaries or certificates, no personal data, no TV tokens or addresses.
- **IPTV PRs merge on green CI without Omar** (merge commit, branch kept). Never merge on red; a red caused by the CI environment is a needs-you. After the merge: fetch, ff-only, tick, progress row, and the repo private at once.
- **Production:** nothing before step 34. Each production deploy, migration and store submission needs his one-word OK.
- **CLAUDE.md:** edits need Omar's direct word. Step 61c's Chromium 68 rewrite has it (decision 6); 61a doesn't touch CLAUDE.md.
- **TVs, autonomous and muted** (memory iptv-tv-autonomous-muted):
  - never ask Omar to act at a TV;
  - use one only when it answers by itself;
  - mute Lablo after every launch;
  - no Wake-on-LAN at night;
  - never soak his real provider.

## Open decisions and gates
- **The store tickets** (PLAN-2 §9): their answers can change steps 72–76 (the lock rules, the products, the Samsung build flag).
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
3. **Audio Guidance** on an LG that offers it (his OLED55A1PVA doesn't). Now part of step 86's TV checks.
4. **The store pack and beta kit:** skim `docs/store/README.md` and `docs/store/beta.md` (now saying Samsung 2020+). The Arabic texts need a native read.
5. **Release:** `pnpm release:check --no-build`.

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- **Secrets: rotate the lionz IPTV provider password** (pasted 2026-11-25; never in the repo).
- **The phase 2 checklist** (RELAY.md, "Omar's parallel track"; PLAN-2 §8):
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
    - 61: the repo's visibility rule;
    - 62: the text-fit check as the gate for any new screen or row;
    - 63: row or list CSS changes run `pnpm verify:engines --self-test` before CI.
  - 61c rewrites the cheat sheet itself, under decision 6.
