# ADR-003: Chromium 53 IIFE build + acorn ES2016 syntax gate

- **Status:** Accepted
- **Date:** 2026-11-01
- **Source:** docs/PLAN.md §3 "TV models to support", docs/architecture.md §4

## Context
TV web engines are never upgraded after the set ships. The minimum supported models are from 2018: Samsung Tizen 4.0 (Chromium 56) and LG webOS 4.x (Chromium 53). Chromium 53 lacks async functions, object spread, optional chaining and many newer APIs. A single modern construct that slips into the bundle gives a blank screen on those TVs, and we have few real devices to catch it.

## Decision
- **Production TV build** (`tools/build/build-tv.ts`): Rollup producing classic-script **IIFE** bundles, Babel `preset-env` with `targets: {chrome: '53'}`, core-js 3 with `useBuiltIns: 'usage'`. Workers are built the same way and inlined as Blob URLs. PostCSS runs `postcss-preset-env` (chrome 53) and `postcss-rtlcss`.
- **Syntax gate:** every output bundle (workers and main) is parsed with acorn at `ecmaVersion: 2016`. Any newer syntax fails the build and CI.
- **Bundle budgets:** main JS ≤ 500 KB minified, each worker ≤ 150 KB.
- **Desktop development** uses Vite with the browser platform adapter. It is not the shipping build.
- `eslint-plugin-compat` with browserslist `chrome 53` flags APIs that need a polyfill. The cheat sheet and polyfill rules live in CLAUDE.md.
- An old-engine harness (RELAY step 2b, `pnpm verify:engines`, [runbook](../runbooks/old-engines.md)) runs the built bundle in Chromium 53/56/68 snapshots, because Playwright cannot attach to those engines and test TVs are scarce. It runs the snapshots headed under Xvfb in a Debian 9 container, drives them over raw CDP, and proves with a self-test that it catches seeded ES2018/ES2020 syntax and a build without polyfills.

## Consequences
- Source can use modern syntax; the transpiler and the gate guarantee the output.
- API gaps that Babel cannot fix (e.g. `AbortController`, `ResizeObserver`, `Intl.PluralRules`, `DecompressionStream`) must be avoided or polyfilled explicitly.
- `pnpm verify` grows to include both TV builds, the gate and the budgets once step 2 lands.
