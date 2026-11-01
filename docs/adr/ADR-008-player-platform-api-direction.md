# ADR-008: `platform-api` depends on `player`, not the reverse

- **Status:** Accepted
- **Date:** 2026-11-01
- **Amends:** docs/architecture.md §1.1 boundary table (the `player` row)

## Context
architecture.md §1.1 lets `player` import `platform-api`, and also lets `platform-api` refer to player types: its `Platform.createEngines()` returns `PlayerEngine` instances, which `player` defines. Allowing both directions creates a dependency cycle between the two packages, which makes the boundary lint meaningless for that pair.

## Decision
- `player` may import **`core` only**. It owns the `PlayerEngine` interface, `PlayRequest`, engine events and `PlayerController`.
- `platform-api` may import `core`, and **types only** from `player` (`import type`), so it can declare `createEngines(): PlayerEngine[]` and `EngineFactory`.
- Platform adapters (`platform-tizen`, `platform-webos`, `platform-browser`) import `platform-api`, `player` and `core`, and construct the concrete engines.
- `apps/tv` wires it together: it asks the selected platform for its engines and hands them to `PlayerController` (constructor injection). The controller never asks the platform for anything directly. Anything platform-specific it needs (e.g. screensaver control) arrives as a small callback interface defined in `player`.

## Consequences
- The dependency graph stays acyclic: `core` ← `player` ← `platform-api` ← `platform-*` ← `apps/tv`.
- Enforced in `eslint.config.js` (an `importKind: 'type'` rule for `platform-api` → `player`) and covered by `test/lint-boundaries.test.ts`.
