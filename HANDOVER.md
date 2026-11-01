# Zoma IPTV: relay leg 2 opening prompt

You are leg 2 of relay run `iptv-20261101-214120`, building **Zoma IPTV**: a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one. Leg 0 planned it. Leg 1 (2026-11-01) did **step 1, the workspace scaffold**, and merged it to `main` as PR #1 with green CI. **Your step is step 2: the TV build pipeline and hello app.**

## Read first, in this order
1. `CLAUDE.md` (repo root, new in leg 1): commands, conventions, the Chromium 53 cheat sheet, the package-boundary table, the Definition of Done, the merge policy, legal guardrails and the commit format. It is the project's rulebook.
2. `RELAY.md`: step 2's full text and its "Done when". Step 1 is ticked and has a progress-log row.
3. `docs/architecture.md` §4 (build pipeline, dev loops, keyboard-as-remote mapping, test layers), §1.1 (layout) and §1.2 (focus engine and Intents, which the hello app's key handling should match).
4. `docs/adr/ADR-003` (chrome53 IIFE and syntax gate) and `ADR-008` (player/platform-api direction).
5. `docs/PLAN.md` wins on any conflict.

## Git state to expect
- Worktree: `D:/Claude Code PlayGround/IPTV-relay-20261101-214120`, branch `relay/iptv-20261101-214120`. Work **only** there. Your session folder is the main checkout; never edit, commit in or switch branches there.
- `origin/main` = `42f1830`, the merge of PR #1. The relay branch is ahead by the commit that adds this `HANDOVER.md`, and the branch is pushed. The worktree is clean.
- The main checkout's local `main` was not pulled after the merge. Leave it alone.
- `node_modules` is already installed in the worktree (`pnpm install` done). `pnpm verify` is green there: lint, typecheck, and 29 tests.

## What exists (step 1)
- pnpm 11.1.2 workspace (`packages/*`, `apps/*`, `tools/*`), Node ≥ 22. `tsconfig.base.json` sets strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: Bundler` and `noEmit`.
- Ten skeleton packages under `packages/`. Each `src/index.ts` contains only `export {}`.
  - Each package's `main`, `types` and `exports` point at `./src/index.ts`, so there is no build step.
  - Allowed internal deps are declared as `workspace:*`.
  - `core`, `protocol` and `crypto` use `lib: ["ES2017"]` with no DOM. The rest add `DOM` and `DOM.Iterable`.
- `eslint.config.js` (flat config):
  - `typescript-eslint` recommended.
  - `eslint-plugin-boundaries` v5 with `element-types` (folder-mode elements per package, plus `app-tv`, `app-web`, `app-mock-provider` and `tools`) and `entry-point` (only `src/index.ts` may be imported across packages).
  - `no-restricted-globals` and `no-restricted-properties` for the platform globals.
  - `consistent-type-imports`.
- The root `tsconfig.json` maps `@zoma/*` to every package **only** so the ESLint resolver can resolve, and therefore report, undeclared forbidden imports.
- `test/lint-boundaries.test.ts`: 29 cases run through the ESLint API's `lintText` with virtual file paths.
- `vitest.config.ts` includes `packages/*/{src,test}/**/*.test.ts`, `apps/*/{src,test}/**`, `tools/*/{src,test}/**` and `test/**`.
- CI in `.github/workflows/ci.yml`: `actions/checkout@v7`, `pnpm/action-setup@v6` (reads `packageManager`), `actions/setup-node@v7` (Node 22, pnpm cache), `pnpm install --frozen-lockfile`, `pnpm verify`. It runs on PRs and on pushes to `main`.

## Step 2: TV build pipeline and hello app (RELAY.md has the full text)
Suggested order:
1. **`platform-api`:** a minimal `Platform` interface (architecture.md §1.1). The hello app needs `info()` (model, firmware, Chromium version, tier, locale), the key-to-Intent mapping with the Intent names from architecture.md §1.2, `onLifecycle` and `exitApp`.
   - Player types are `import type` only (ADR-008).
2. **`platform-browser`:** the keyboard-as-remote mapping from architecture.md §4 and fake device info.
   - Also add `platform-tizen` and `platform-webos` stubs, just enough for the hello screen: Tizen `tvinputdevice` key registration, and webOS `PalmSystem`/`webOS` device info when available.
3. **`apps/tv`:** a hello screen showing platform info, one entry per platform, platform chosen by a `__PLATFORM__` define.
   - Using Preact here doubles as an early check of spike S1's runtime baseline.
   - `apps/tv` may import every package.
4. **`tools/build/build-tv.ts`:**
   - Rollup IIFE output.
   - Babel `preset-env` with `targets: {chrome: '53'}` and core-js 3 `useBuiltIns: 'usage'`.
   - Workers built as IIFEs and inlined as Blob URLs. Include a trivial worker so this path is proven.
   - acorn `ecmaVersion: 2016` syntax gate on every bundle.
   - Bundle budgets: main ≤ 500 KB minified, worker ≤ 150 KB.
   - `pnpm build:tv` builds both platforms.
5. **Platform files:** `platforms/tizen/config.xml` and `platforms/webos/appinfo.json` (with `disableBackHistoryAPI: true`), plus placeholder icons.
6. **Packaging:**
   - `.ipk` via `@webos-tools/cli` (`ares-package`). It officially wants Node 14–16, so try it as a devDependency or through npx on Node 24 first.
   - `.wgt`: **the Tizen CLI is NOT installed** (checked in leg 1). Document the manual `tizen package -t wgt -s <profile>` path instead, and never install GUI tools unattended.
7. **`tools/device`:** install and launch wrappers (`ares-install`/`ares-launch`; `tizen`/`sdb` documented). **`pnpm dev`:** a Vite desktop loop with `platform-browser`.
8. **Playwright smoke test of the desktop hello app.**
   - Playwright Chromium builds are already cached locally (`ms-playwright/chromium-1223`, `-1228`). CI needs `pnpm exec playwright install --with-deps chromium`.
   - Wire the TV build, gate, budgets and smoke test into `pnpm verify` and CI.
9. **Done when:** `pnpm build:tv` passes the gate for both platforms, the `.ipk` is produced, and the Playwright smoke test passes, locally and on CI.
   - **Also prove the gate:** seed an ES2018 feature (e.g. object rest in a dependency-free spot, or a regex lookbehind) and show that the gate fails.
10. **Finish:**
    - Tick step 2 and add a progress-log row.
    - Push, run `gh pr create --base main`, wait for green CI, then `gh pr merge <n> --merge`. **Never squash, never `--delete-branch`**: the relay branch must survive.
    - If the session is still light, go on to step 2b, which needs a Chromium 53/56/68 snapshot harness. Otherwise end the leg.

## Gotchas and lessons from leg 1
- **The Bash tool's cwd resets to the main checkout after every call.** Always `cd "D:/Claude Code PlayGround/IPTV-relay-20261101-214120" && ...` or use `git -C`. Write and Edit on worktree paths work directly; no EnterWorktree is needed.
- **Use the Write tool for doc files**, not one big Bash command with many heredocs. A multi-file heredoc command failed with "unexpected EOF while looking for matching `'`".
- **pnpm 11 build scripts:**
  - pnpm 11 fails the install with `ERR_PNPM_IGNORED_BUILDS` when a dependency has a blocked build script.
  - The setting is `allowBuilds:` (a map of `name: true`) in `pnpm-workspace.yaml`. `esbuild: true` is already there.
  - On an ignored build, pnpm itself **appends a placeholder `allowBuilds:` block** to the file. Edit the existing block; a second `allowBuilds:` key is a YAML duplicate-key error.
  - New deps with build scripts (e.g. `@parcel/watcher`, `core-js` postinstall, Playwright) may need entries.
- **Version pins.** npm "latest" is now several majors ahead of the known-good pins:

  | Package | Pinned in leg 1 | npm latest |
  |---|---|---|
  | TypeScript | ~5.9.3 | 7.0.2 (native) |
  | ESLint | ^9.39 | 10 |
  | Vitest | ^3.2.7 | 5 |
  | eslint-plugin-boundaries | ^5.4 | 7 |
  | globals | ^16 | 17 |

  - For step 2, pick majors compatible with these: Vite must satisfy Vitest 3.2's peer range (check with `npm view vitest@3.2.7 peerDependencies`). Use Rollup 4, Babel 7, core-js 3 and acorn 8, and check each with `npm view` before adding it.
- **ESLint for new code:**
  - Node-side globals apply to `*.{js,ts}` at the root, `test/**`, `tools/**` and `apps/mock-provider/**`.
  - `apps/tv` and browser packages get no Node globals. Add browser globals for them if lint needs it.
  - Every new workspace package needs a `typecheck` script so `pnpm -r` covers it, plus its own `tsconfig.json` extending `../../tsconfig.base.json`.
- **Boundaries:**
  - `tools/*` may import only `core`, `protocol` and `crypto`.
  - `apps/tv` may import any package.
  - Cross-package imports must go through `@zoma/<name>`. Deep paths fail `boundaries/entry-point`.
  - Platform globals: `tizen`/`webapis` are allowed only in `platform-tizen`, and `webOS`/`PalmSystem` only in `platform-webos`.
- **CI annotation:** `ubuntu-latest` is migrating to Ubuntu 26 (from 2026-10-19). Watch for apt or library breakage in step 2b, where old Chromium snapshots need old shared libraries; pin `ubuntu-24.04` for that job if needed.
- **Commits** end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <the session URL the harness gives you>
  ```
  Use scoped `git add` and a `git commit -F - <<'EOF'` heredoc in Git Bash.
- **Environment (2026-11-01):** Windows 11, Node v24.14.1, pnpm 11.1.2, gh 2.92 (logged in as `Omarmarei`), Docker 29.4.2.
  - **ffmpeg 8.1.1 IS on PATH** (winget Gyan.FFmpeg), so step 4's "install ffmpeg" gate is already cleared.
  - Neither the Tizen CLI/sdb nor the webOS `ares-*` CLI is installed.

## The 3 riskiest changes merged in PR #1 (per the merge policy)
1. **The boundary rules go beyond architecture.md:**
   - `player` must not import `platform-api` (ADR-008).
   - A new `entry-point` rule forbids deep imports.
   - `apps/mock-provider` may import nothing internal, and `tools/*` only `core`/`protocol`/`crypto`.
   - Loosen these deliberately (with an ADR note) if a later step needs it.
2. **The root `tsconfig.json` maps every `@zoma/*` package for the ESLint resolver,** while packages type-check without paths. The strict base (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`) will add friction in the parser steps; that is intended.
3. **Toolchain pinned below npm latest** (TS 5.9, ESLint 9, Vitest 3, boundaries 5), with `allowBuilds: esbuild`. Upgrading is a deliberate future step, not a drive-by.

## Open decisions and gates (none block step 2)
- **Step 16 [needs Omar]:** the LG TV's model and year, LG Developer Mode, the Samsung testing route (from step 15's comparison) and the Samsung certificate.
- **Later gates:** steps 21, 34, 44, 46 and 47 (see RELAY.md).

## Carry-forward reminders for Omar (repeat in each handover until he confirms)
- Submit the **Samsung Seller Office Partner application ASAP** (Samsung Gulf). It takes weeks, and Samsung in the GCC and Canada depends on it.
- Share the **LG TV's model and year**.
- **"Zoma" trademark clearance** (US, CA, AE, SA) and domains.
- No secrets have been shared, so nothing needs rotating.
