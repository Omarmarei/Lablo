# Zoma IPTV: project rules for Claude sessions

Zoma IPTV is a content-free IPTV player (M3U and Xtream only) for Samsung Tizen and LG webOS TVs. v1 is free, launches in the GCC and North America, and ships Arabic (RTL) and English from day one.

- **Plan:** [docs/PLAN.md](docs/PLAN.md) (wins on any conflict). **Design:** [docs/architecture.md](docs/architecture.md). **Decisions:** [docs/adr/](docs/adr/). **Session checklist:** [RELAY.md](RELAY.md).
- Repo: private `Omarmarei/zoma-iptv`, default branch `main`.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install (pnpm 11, Node ≥ 22). Dependency build scripts must be allowed in `pnpm-workspace.yaml` → `allowBuilds`. |
| `pnpm lint` | ESLint flat config, including the package-boundary and platform-global rules. Zero warnings allowed. |
| `pnpm typecheck` | Root `tsc` (configs, `test/`) plus `tsc --noEmit` in every package via `pnpm -r`. |
| `pnpm test` | Vitest, run once from the root (`vitest.config.ts` lists the test globs). |
| `pnpm verify` | lint + typecheck + test. CI runs exactly this. Later steps add the TV builds, syntax gate, bundle budgets and old-engine runs to it. |

## Conventions

- **TypeScript everywhere**, `strict` plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (use `import type` for types) and `moduleResolution: Bundler`. Shared options live in `tsconfig.base.json`.
- **Packages are consumed as TypeScript source.** Each `@zoma/*` package points `main`, `types` and `exports` at `./src/index.ts`; there is no per-package build step. Import other packages only through `@zoma/<name>` (the entry point); deep imports are a lint error.
- **Declare workspace dependencies** (`"@zoma/core": "workspace:*"`) for every allowed import. The root `tsconfig.json` maps `@zoma/*` to every package only so that the boundary lint can resolve (and reject) forbidden imports.
- **`core` is pure:** `lib: ["ES2017"]`, no DOM, no `fetch`, no platform globals. It must run unchanged in Node, in workers and on the TV.
- **Platform globals** (`tizen`, `webapis`, `webOS`, `PalmSystem`) are lint errors outside their adapter: `tizen`/`webapis` only in `platform-tizen`, `webOS`/`PalmSystem` only in `platform-webos`.
- **Tests:** Vitest. Tests sit next to the code (`src/**/*.test.ts`) or in a package `test/` folder. No placeholder tests: every test must be able to fail. Tests pass before every commit.
- **Line endings:** LF everywhere (`.gitattributes` has `* text=auto eol=lf`; the Windows checkout has `core.autocrlf` on).
- **Shell:** the Bash tool is Git Bash on Windows. Use POSIX syntax there, never PowerShell syntax.
- **Nothing important in localStorage** (webOS wipes it on app updates; see architecture.md §1.3).

## Chromium 53 cheat sheet (the oldest engine: 2018 LG webOS 4)

The TV build targets Chromium 53 (webOS 4) and 56 (Tizen 4). Production code is transpiled by Babel `preset-env {chrome: 53}` with core-js `usage` polyfills and must pass an acorn ES2016 syntax gate, but some gaps are APIs that Babel cannot fix.

**Missing in Chromium 53: avoid, or rely on the listed polyfill.**

| Feature | Rule |
|---|---|
| `AbortController` | Missing. Don't rely on it for `fetch`; use our own cancel tokens, and XHR `abort()` where a request must really be cancelled. |
| `Object.values`, `Object.entries`, `Object.fromEntries` | core-js polyfill (usage-based). |
| `String.prototype.padStart` / `padEnd` | core-js polyfill. |
| `Promise.prototype.finally` | core-js polyfill. |
| `Array.prototype.flat` / `flatMap` | core-js polyfill. |
| `globalThis`, `queueMicrotask` | core-js polyfill. |
| `structuredClone` | Avoid; copy explicitly. |
| `Intl.PluralRules` | Missing. Plural rules (including Arabic's 6 forms) are implemented in `core`. |
| `ResizeObserver` | Missing. Don't use it; sizes come from layout constants. |
| `Blob.prototype.text()` / `arrayBuffer()` | Missing. Use `FileReader`. |
| `DecompressionStream` | Chromium 80+ only. Use fflate on older engines. |
| `ReadableStream` async iteration (`for await`) | Missing. Loop over `reader.read()`. |
| CSS Grid, flex `gap`, `position: sticky`, logical properties (`margin-inline-*` etc.) | Missing. Use flexbox with margins; `postcss-rtlcss` generates the RTL variants. |
| `loading="lazy"` on images | Missing. Use IntersectionObserver. |
| ES modules in pages and workers | The TV build is classic-script IIFEs; workers are inlined as Blob URLs. |

Newer syntax (`async`/`await`, object spread, `?.`, `??`, optional catch binding) is fine in source because Babel transpiles it; the syntax gate catches anything that slips through.

**Available in Chromium 53:** `fetch` with `response.body` streams, `TextDecoder`, IntersectionObserver, IndexedDB `getAll`, WebSocket, EventSource, CSS custom properties, Web Workers.

## Package boundaries

Enforced by `eslint-plugin-boundaries` (`boundaries/element-types`, `boundaries/entry-point`) in `eslint.config.js`, and proven by `test/lint-boundaries.test.ts`.

| Package | May import (internal) | Never |
|---|---|---|
| `core` | nothing | DOM, platform globals, `fetch` |
| `protocol`, `crypto` | nothing internal (external libraries only) | anything internal |
| `data` | `core`, `protocol`, `crypto` | `ui`, `player`, `platform-*` |
| `player` | `core` | `platform-api` (ADR-008), concrete platforms, `ui`, `data` |
| `platform-api` | `core`; `player` **types only** (`import type`) | `ui`, `data`, concrete platforms |
| `ui` | `core`, `player`, `data` (client only), `platform-api` | concrete platforms |
| `platform-tizen`, `platform-webos`, `platform-browser` | `platform-api`, `player`, `core` | `ui`, `data`, each other |
| `apps/tv` | every package | other apps, tools |
| `apps/web` | `protocol`, `crypto` | `core`, `data`, and outbound `fetch` to user-supplied URLs |
| `apps/mock-provider` | nothing internal (it is an independent oracle for the parsers) | — |
| `tools/*` | `core`, `protocol`, `crypto` | — |

Deliberate change from architecture.md §1.1: `player` does **not** import `platform-api`; `platform-api` imports `player` types instead. See [ADR-008](docs/adr/ADR-008-player-platform-api-direction.md).

## Legal guardrails (non-negotiable; see ADR-005 and ADR-007)

- **Our servers never fetch provider URLs and never relay, proxy or transcode streams.** The backend handles only ciphertext, signed config, telemetry and diagnostics. No image proxy, no server-side EPG processing of user sources.
- **No bundled, default or suggested playlists**, no provider affiliations, no reseller panels. Store screenshots use only our own legal demo content.
- **Stalker/MAG portals are dropped permanently.** Don't add them, don't stub them.
- **No residential-proxy, bandwidth-monetization or similar SDKs**, ever.
- **No hard-coded credentials** anywhere in the code (LG certification rule too). Test credentials for the mock provider live in its fixtures only.
- Telemetry never collects URLs, hostnames, channel or VOD names, credentials or IP addresses.

## Definition of done

A step or phase is done only when, in this order:
1. **Tests and build:** `pnpm verify` is green (lint incl. boundaries, typecheck, tests; plus both TV builds, the ES2016 syntax gate and bundle budgets once they exist).
2. **PR and CI:** a PR to `main` with green CI, merged with a merge commit (not squash).
3. **Migrations:** N/A until the backend exists (RELAY step 29). After that, Neon production migrations are applied and the schema is checked with a query. Each one needs Omar's word.
4. **Deploy:** backend production deploys (Vercel) need Omar's word and a live check afterwards. For the TV app, the "deploy" is a store submission (needs Omar); before that, check the change on a real TV once the test TVs exist.
5. **Handover** last.

UI steps also end with a short "press these keys" checklist Omar can run in the desktop browser (`pnpm dev`) or on a TV.

## Merge policy

- **Standing approval from Omar (2026-11-01):** relay PRs are merged by Claude once CI is green, with a merge commit (`gh pr merge --merge`, never squash, so the long-lived `relay/<run>` branch stays mergeable). The leg's handover lists the 3 riskiest changes that went in.
- **Still needs Omar's one-word OK every time:** production deploys, production migrations, production data writes, destructive DB actions.

## Commits

- Scoped `git add` (never `git add -A` in a shared checkout). Check `git status` for changes that aren't yours first.
- Message format: `type(scope): summary` (`feat`, `fix`, `docs`, `test`, `chore`, `ci`, `refactor`, `build`). Write it with a Git Bash heredoc:

  ```bash
  git commit -F - <<'EOF'
  feat(core): streaming M3U parser

  Why it was needed, in a line or two.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  ```
- End every commit message with the `Co-Authored-By` line above (plus any session attribution line the harness asks for).
