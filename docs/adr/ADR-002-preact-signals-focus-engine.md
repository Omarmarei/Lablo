# ADR-002: Preact + signals + custom index-based focus engine

- **Status:** Accepted
- **Date:** 2026-11-01
- **Source:** docs/architecture.md §1.2

## Context
The UI must run on 1 GB 2018 TVs (Chromium 53), render 200k-item catalogs and a 7-day EPG grid, support Arabic RTL and bidi text, and work with Voice Guide, which reads the DOM. Navigation is by remote control (5-way keys, Back, number and colour keys) plus the LG Magic Remote pointer.

Options considered:
- **React 18:** too heavy for 1 GB TVs.
- **Lightning / Blits (WebGL):** weak Arabic bidi handling and no DOM for Voice Guide.
- **Enact:** webOS only.
- **Off-the-shelf focus libraries (e.g. Norigin):** they measure the DOM on every move, which fights list virtualization and is slow on 2018 TVs.

## Decision
- **Preact 10 with `@preact/signals`**, rendering normal DOM. About 4 KB of runtime; signals update only the cells that change.
- **A custom focus engine** in `packages/ui` (about 600 lines of pure TS, unit-tested without a DOM):
  - Adapters map key codes to Intents; LEFT and RIGHT swap once for RTL in horizontal zones.
  - Zones use `list`, `grid`, `epg` or `free` strategies. Focus is a data index in a signal, not DOM focus. DOM `focus()` is used only for native text inputs, so the system keyboard (including Arabic) appears.
  - Per-zone focus memory, a router with a back stack and a platform `rootBackPolicy`, Magic Remote hover-to-focus.
- **State:** signals for UI and session state; domain stores are plain classes exposing signals. No Redux, react-query or comlink.

## Consequences
- We own and test the focus engine (RELAY step 10), including LTR and RTL behaviour.
- CSS is limited to what Chromium 53 supports (no Grid, flex `gap`, `sticky` or logical properties); see CLAUDE.md.
- Virtualized lists and the EPG grid work by index, without measuring the DOM on each key press.
