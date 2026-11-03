> **Snapshot 2026-11-01.** Detailed design produced during planning. Where it differs from [PLAN.md](PLAN.md) (e.g. features added to v1, Stalker dropped, Phase 9 = 6 sessions), **PLAN.md wins**. Record changes as ADRs in [adr/](adr/).

# Zoma IPTV: architecture and phased build plan

Paths below are relative to the repo root. Written before any code existed.

## Key decisions

- **Packaging:** packaged apps on both platforms (Tizen `.wgt`, webOS `.ipk`). No hosted app. Store reviews are slow, so every tunable setting comes from a signed remote config.
- **Code layout:** TypeScript monorepo using pnpm workspaces. All logic is platform-agnostic and runs in Node for tests. Thin platform adapters are the only code allowed to touch `tizen`, `webapis`, `webOS` or luna.
- **UI:** Preact 10 with `@preact/signals`, rendered as normal DOM, with a custom index-based focus engine. No CSS Grid, flex `gap`, `position: sticky` or logical CSS properties, because Chromium 53 lacks them.
- **Build:** Vite for desktop development. The production build is a Rollup IIFE run through Babel `preset-env` targeting `chrome 53`, plus core-js polyfills. Workers are built as IIFEs and inlined as Blob URLs. A syntax gate blocks any newer JavaScript.
- **Data:** Two workers. An ingest worker starts for each refresh and is killed afterwards to free memory. A query worker stays running. IndexedDB holds a cache that can always be rebuilt. The only data that can't be rebuilt is a small "profile" document, and it is mirrored to an end-to-end encrypted cloud backup.
- **EPG:** Streamed, filtered at ingest to the user's matched channels, stored in one record per channel per day, with a time window that depends on the TV's tier.
- **Player:** One controller handles state, the stall watchdog, retries, error classification and zapping. It sits on top of interchangeable engines: AVPlay on Tizen and an HTML5 `<video>` engine on webOS and desktop.
- **Backend:** Next.js, Prisma, Postgres (Neon), Cloudflare R2 and Vercel. It provides the signed config and kill-switch, an end-to-end encrypted pairing relay, encrypted backup, and telemetry. It never fetches a user-supplied URL, and a lint rule enforces that.

---

## 1. Architecture

### 1.1 Monorepo layout

```
zoma/
├─ apps/
│  ├─ tv/               Composition root: screens, router, wiring, one entry file per platform
│  ├─ web/              Next.js: /p pairing page, /v1/* API, legal pages, landing page
│  └─ mock-provider/    Node (Fastify): Xtream/M3U/XMLTV/HLS/TS emulator, fault injection, LAN log collector
├─ packages/
│  ├─ core/             Pure TS: models, ContentKey, Arabic/Latin normalization, M3U/Xtream/XMLTV parsers,
│  │                    streaming JSON-array splitter, catch-up URL builders, search, EPG matcher,
│  │                    plural rules, entitlements seam
│  ├─ data/             Workers: IDB schema and migrations, ingest pipeline, query service, typed RPC, DataClient
│  ├─ player/           PlayerController, PlayerEngine interface, Html5Engine, watchdog, error classifier,
│  │                    SRT/VTT parsing and cue sync
│  ├─ ui/               Focus engine, virtual list and EPG grid, design tokens, components, i18n runtime
│  ├─ platform-api/     Platform, EngineFactory and Intent interfaces only (no implementation)
│  ├─ platform-tizen/   Keys (tvinputdevice), DUID, lifecycle, screensaver, AvplayEngine, TTS hook
│  ├─ platform-webos/   Keys, LGUDID, Back policy, luna helpers, DB8 mirror, webOS track-switch strategy
│  ├─ platform-browser/ Desktop dev and test: keyboard as remote, fake device info, virtual remote overlay
│  ├─ crypto/           tweetnacl + @noble/hashes wrappers: envelopes, KDFs, Ed25519 verify (shared by TV and web)
│  └─ protocol/         zod schemas and types: config doc, pairing payload, backup envelope, telemetry events
├─ platforms/
│  ├─ tizen/            config.xml template, icons, privileges
│  └─ webos/            appinfo.json (disableBackHistoryAPI: true), icons, optional luna JS service
├─ tools/
│  ├─ build/            build-tv.ts (workers, gate, main, gate, package), syntax gate, bundle budgets
│  ├─ device/           install, launch and inspect wrappers around tizen/sdb and ares-*
│  ├─ fixtures/         Deterministic generators (200k catalog, 50–300 MB XMLTV)
│  └─ sign-config/      Offline Ed25519 signer for the remote config
├─ e2e/                 Playwright: RemoteDriver, flows, en/ar screenshots
├─ docs/                adr/, spikes/, store/ (LG UX scenario, self-checklists, Samsung tester notes), runbooks/
├─ CLAUDE.md            Conventions, Chromium 53 cheat sheet, boundaries, definition of done
└─ ROADMAP.md           One checkbox per session (works with your relay/handover workflow)
```

**What depends on what.** These rules are enforced with `eslint-plugin-boundaries` in CI.

| Package | May import | Never |
|---|---|---|
| core | nothing; tsconfig `lib: ES2017` with no DOM | DOM, platform globals, fetch |
| protocol, crypto | their own libraries only | anything else |
| data | core, protocol, crypto | ui, player, platform-* |
| player | core, platform-api | concrete platforms, ui |
| ui | core, player (controller and types), data (client only), platform-api | concrete platforms |
| platform-* | platform-api, player (to implement engines) | ui, data |
| apps/tv | everything; picks the platform via a `__PLATFORM__` build define, so unused platform code is removed | — |
| apps/web | protocol, crypto | core, data, and outbound `fetch` (only listed SDKs are allowed) |

**The Platform interface** is the only seam between platforms:
- `info()`: model, model year, firmware, Chromium version, tier (`low` for 2018–19, `full` for 2020+), locale, country
- `deviceSecret()`: DUID or LGUDID, or `null`
- key-to-Intent mapping and key registration
- `onLifecycle` (hidden, visible, relaunch)
- `rootBackPolicy()`: `exit-dialog` on Tizen, `platform-back` on webOS 23–25
- `exitApp()` and `setScreenSaver()`
- `createEngines()`
- optional extras: `persistentKV` (webOS DB8), `tts`, and an `http` transport (luna relay, only if spike S7 fails)

### 1.2 UI framework and state

**Preact with signals.** It is React-shaped, so it fits both your Next.js background and what Claude writes most reliably. The runtime is about 4 KB, which matters on 1 GB webOS 4 sets, and signals update only the cells that change, which matters for the EPG grid. I ruled out the alternatives:
- **Lightning/Blits (WebGL):** weak Arabic bidi handling and no DOM for Voice Guide.
- **React 18:** too heavy for 1 GB TVs.
- **Enact:** webOS only.

**Custom focus engine** (about 600 lines, pure TS, unit-tested without a DOM):
- **Intents.** Adapters turn key codes into Intents: `UP DOWN LEFT RIGHT OK BACK CH_UP CH_DOWN DIGIT_n PLAY_PAUSE STOP FF RW INFO GUIDE RED GREEN YELLOW BLUE PREV_CH`. In RTL, LEFT and RIGHT are swapped once at this layer for horizontal zones.
- **Zones.** Each screen is made of zones, and each zone uses one of these strategies:
  - `list`: index-based, which is what makes virtualized lists work
  - `grid`
  - `epg`: channel index plus a time cursor
  - `free`: geometry fallback, for small static screens only

  Focus is a data index held in a signal, not DOM focus. DOM `focus()` is used only for native text inputs, so the system on-screen keyboard (including Arabic) pops up. Each zone remembers its last focused index.
- **Magic Remote:** hovering over an item focuses it, the wheel scrolls the active list, and hiding the pointer keeps the current focus.
- **Router:** a back stack. At the root, Back is handled by the platform's `rootBackPolicy`.

Off-the-shelf libraries such as Norigin measure the DOM on every move. That fights virtualization and is slow on 2018 TVs.

**Built in step 10: the focus engine** (`packages/ui/src/focus`: `types`, `zones`, `epg`, `free`, `navigator`, `pointer`; `Platform.onPointer`; the hello screen's focus panel, `apps/tv/src/focus-demo.ts` and `FocusPanel.tsx`):
- **Framework-free, with a listener API.** The engine is plain TypeScript with no Preact and no signals: `createNavigator(options)` returns a `Navigator`, and `subscribe(listener)` reports each change once (a key that pushes a screen is one notification). The app wraps it in a signal (`focus-demo.ts`: one `signal(nav.snapshot())`).
  - Why: it is tested in Node with no rendering, and the self-test runner (§4) can drive it with Intents.
  - Size is no reason either way: Preact and signals are already in main through `apps/tv`.
  - `ui` gets `preact` and `@preact/signals` with its first components (step 11), together with a `useFocus` binding.
- **Logical directions, one RTL swap.** `moveDirection(intent, dir)` turns UP/DOWN/LEFT/RIGHT into `up`/`down`/`start`/`end`. In RTL, LEFT is `end` and RIGHT is `start`; UP and DOWN never swap.
  - Everything after that is logical: zones, neighbours (`neighbours: { start: 'rail' }`) and free-zone rects (`x` grows from the inline start).
  - So the layout is written once, `dir="rtl"` mirrors it in CSS, and nothing swaps twice.
  - The swap covers every horizontal move: a horizontal list, a grid's columns, the guide's time axis, and leaving a vertical list sideways.
- **Zones** (`ZoneSpec`); each keeps a `ZonePosition` (`index`, `top`, and for the guide `time` and `view`):
  - `list`: `vertical` or `horizontal`, optional `wrap`. `visible` (a layout constant) gives the scroll window: `top` moves as little as possible to keep the focus in it, which is what a virtual list renders from.
  - `grid`: `columns`, `count`, optional `visibleRows`. Down from above a short last row lands on its last item.
  - `epg`: rows (channels) plus a time cursor in UTC minutes. The screen supplies `cell(row, minute)`.
    - UP and DOWN keep the cursor, so the focus doesn't drift across rows.
    - LEFT and RIGHT go to the previous or next cell and put the cursor at its start.
    - A row without data moves by slots (`slot`, default 30 min, counted from `from`). Cells are cut to the guide's `[from, to)`.
    - The view (`span` minutes) jumps to the cursor's slot when the cursor leaves it.
    - The screen must fill gaps between programmes with placeholder cells, or a move skips a short programme.
  - `free`: logical rects from layout constants (never DOM measurements). The nearest item in the direction wins: the gap ahead plus twice the sideways offset, with the centre required to be beyond. Ties go to the lower index.
- **Moves:**
  - Off a zone's edge, the focus goes to the zone's neighbour that way, skipping empty zones in the same direction (with a loop guard), and lands on that zone's remembered item (per-zone memory).
  - CH_UP and CH_DOWN page vertical lists, grids and the guide's rows by a viewport.
  - OK goes to the screen's `onSelect`. Every Intent first goes to the screen's `onIntent` (digits, colour keys, Back to close a menu).
  - `Screen.update(zone)` (new count) keeps each position where it still fits. An empty zone has index -1 and gets its first item when items arrive.
- **Router:** the root screen is given at creation, so the stack is never empty; `push`, `replace`, `reset` and `pop`.
  - A screen keeps its zones' positions while covered, so Back returns to the same item. A covered screen still takes `update`; a popped one ignores everything.
  - Back pops. On the root it follows `Platform.rootBackPolicy()`:
    - `exit-dialog` (Tizen, the browser) calls `exitDialog`, and the app pushes its exit screen;
    - `platform-back` (webOS) calls `exit`, that is `Platform.exitApp()` (`PalmSystem.platformBack`).
- **Magic Remote:**
  - `Screen.hover(zone, index)` focuses the item under the pointer, but only on the top screen and only while the pointer is in use. Items call it from `mousemove`, which also fires when the pointer moves onto them.
  - A key that moves the focus (the arrows, CH_UP/CH_DOWN) hides the pointer in the engine, and the focus stays on the hovered item. Step 11b narrowed this from every key: OK, Back and the other keys leave the pointer shown, because the Magic Remote's own OK button sends key 13 while pointing, and webOS hides its cursor on the 5-way keys only.
  - The pointer counts as shown again after a real move. `watchPointerMoves` listens to `mousemove` in the capture phase and skips the ones at unchanged coordinates, which Chromium sends after a scroll or layout change under a still pointer, so a list scrolling under a hidden pointer can't take the focus.
  - On webOS, `Platform.onPointer` adds the system's own `cursorStateChange` (the pointer hides after a few idle seconds); the other adapters have none.
  - `Navigator.wheel(steps)` scrolls the focused zone's view and keeps the focus inside it. The app turns each `wheel` event into one step and calls `preventDefault` (non-passive), so the page itself never scrolls.
  - Selecting with a pointer click came in step 11b (`Screen.click`, below).
- **Size:** main 459.1 → 470.3 KB of 500 (tizen), about 8 KB for the engine and 3 KB for the demo panel, with no new polyfills.
- **Dev loop:** `apps/tv/vite.config.ts` pre-bundles `fflate`. Vite's start-up scan doesn't follow `?worker` imports, so with a cold cache (as in CI) it found fflate late and reloaded every open page, which reset the app in the middle of key-driven e2e tests.
- **Tests:**
  - `zones.test.ts`: every zone kind, scrolling, paging, the wheel and clamping. `navigator.test.ts`: the same key sequences in LTR and RTL, the single swap, neighbours, memory, the router and both root policies, listeners, the Magic Remote.
  - Also `pointer.test.ts`, webOS `watchCursorState`, and `apps/tv/src/focus-demo.test.ts`.
  - e2e: keys, pointer, wheel, RTL and the exit dialog in dev; the focus moving in both built bundles.
  - The old-engine harness now requires each key step's focus (`home · rail 0`, then `details · buttons 0`) in Chromium 53/56/68.
  - The mutation script is `artifacts/mutate10.py`.

**Built in step 11a: the design system's foundations** (`packages/ui/src/styles`, `packages/ui/src/design`, `packages/ui/assets/fonts`, `tools/fonts`, `tv-css.config.ts`, `tools/build/src/css.ts` and `css-gate.ts`):
- **CSS comes from the modules.** A module imports its CSS (`import './x.css'`); `@zoma/ui`'s index imports the tokens and fonts first, and `apps/tv/src/main.tsx` imports `app.css` last.
  - In dev, Vite injects the files in that order.
  - The TV build lists them in the modules' evaluation order (a depth-first walk of the static imports, `collectCss` in `bundle.ts`) and writes one `app.css`. A worker that imports CSS fails the build.
- **RTL by `dir` on `<html>`.** `postcss-rtlcss` (`combined` mode) turns every rule with a direction-dependent declaration into a `[dir="ltr"]` rule and a mirrored `[dir="rtl"]` one. The app sets `lang` and `dir` on `<html>` from the locale. So CSS is written once, left to right, with physical properties.
  - The same plugin list (`tv-css.config.ts` at the root) runs in the Vite dev loop and in the TV build, so `pnpm dev` mirrors as the TVs do.
  - Limits: an element that sets `dir` itself inside the page (an LTR URL field in Arabic) still matches the page's `[dir="rtl"]` rules, so keep direction-dependent CSS out of such islands or mark it `/*rtl:ignore*/`. A mirrored rule's selector is one attribute more specific than the same rule's direction-free part.
- **The Chromium 53 CSS gate** runs on the built app.css (ADR-003 lists what it rejects). Remote `url()`s fail too (the app is packaged); local ones are copied to `assets/`.
- **Tokens** (`styles/tokens.css`): colours, type sizes for 3 m (22 px and up), a 4 px spacing grid, radii, the focus ring, the 1920x1080 canvas with its 5% safe area, list and tile sizes, and motion (none on the low tier). The numbers code needs (`SCREEN`, `LAYOUT`, `SPACE`, `fits()`) are in `design/tokens.ts`, and `test/ui-tokens.test.ts` keeps both equal. It also checks contrast: text and muted text at least 4.5:1 on every surface, the focus ring 3:1. That check darkened `--color-surface-focus`.
- **Fonts: Zoma Sans**, which is Noto Sans (Latin) plus Noto Sans Arabic UI (Arabic), 400 and 700.
  - Static woff2 subsets of about 25 KB each, picked per character by `unicode-range`. A page without Arabic never loads the Arabic files.
  - `pnpm fonts` makes them from sources pinned by commit and SHA-256, deterministically, and commits them with `fonts.json`. The licences ship as `assets/fonts-OFL.txt`.
  - The Arabic face is the UI variant, whose vertical metrics sit on one line with Latin text.
  - Tests:
    - `tools/fonts/src/fonts.test.ts`: the files match the manifest; each maps exactly its range; sample texts have glyphs; Arabic keeps its joining forms and the lam-alef ligature; `fonts.css` declares the same faces.
    - e2e: the title "Zoma زوما" is drawn with both web faces (CDP `CSS.getPlatformFontsForNode`) in dev and from both bundles on `file://`.
    - The old-engine harness: a Latin and an Arabic face load in Chromium 53/56/68.
- **Size:** main's own code 102.4 KB (tizen; 102.2 KB at the budget change); app.css 9.7 KB; the fonts 99 KB in `assets/`.

**Built in step 11b: components, the virtual list, the pseudo-locale and the gallery** (`packages/ui/src/components`, `focus/binding.ts`, `focus/remote.ts`, `i18n/`; `apps/tv/src/gallery`):
- **The Preact binding.** `ui` now depends on `preact` and `@preact/signals` (the versions `apps/tv` had, so the lockfile gained no package).
  - `bindFocus(nav)` turns the engine's `subscribe` into one signal of the `Focus`, with a new value on every change, zone positions included.
  - `useFocus(binding)` reads it. `useZone(binding, screen, zone)` gives a zone's spec, its position, whether it is active, and per item an `ItemBinding`: `state` (`focused`, `memory` or `idle`), `onHover` (`Screen.hover`) and `onPress` (`Screen.click`).
  - Neither is a Preact hook: both only read the signal, so the calling component re-renders on every engine change, and they work in Node tests.
  - `Screen.zone(id)` is new, so a virtual list reads its count and window from the zone itself.
  - `connectRemote({ platform, nav, target, onIntent })` is the keys, wheel and pointer wiring that the hello screen had inline. The hello screen and the gallery both use it.
- **Pointer click and the webOS OK key** (the open point from step 10). `Screen.click(zone, index)` focuses the item and calls `onSelect`. It works only on the top screen, and it shows the pointer.
  - For one press of the Magic Remote's OK, webOS sends both a click and key 13, in either order. So an OK key and a click within `OK_CLICK_WINDOW_MS` (500 ms) of each other count as one press. The second one is dropped: `handle` returns `duplicate`, and `click` returns false.
  - Each key pairs with at most one click. Two clicks, or two keys, are two presses.
  - The click checks for a pair before anything else, even on a covered screen. So when the first half of a press opens a dialog, its twin can't select a button in that dialog.
  - The clock is injectable (`NavigatorOptions.now`, default `performance.now`), so tests set the timing exactly.
  - Clicks go straight to `onSelect`, never to `onIntent`.
  - Not checked on a real LG TV yet: the order of the two events, and whether OK over an empty spot also sends key 13 (it would select the focused item). That is for the step-16 lab.
- **Components** (`components/*.tsx`, each importing its own CSS, all on the tokens):
  - Button: primary, secondary, danger and disabled; an optional SVG icon.
  - Chip: one category of a rail, `selected` apart from the focus, an optional count.
  - ListRow: a channel row (number, name, badges, now with a small bar, next), `--row-height` tall.
  - Tile: a poster or channel tile with a caption, a badge, an optional image and a resume bar.
  - Dialog: a scrim over the canvas, which also takes the pointer, and a centred panel.
  - ProgressBar, Spinner (a transform animation) and Badge.
  - **How they are built:**
    - Focus is a class (`is-focused`, `is-memory`) and a `data-state`, never DOM focus. The focus ring is an always-present 4 px border, so focusing moves nothing.
    - Components hold no text: every label is a prop (step 12's lint will check that).
    - The provider's text (channel names, titles) has `dir="auto"`, so each shows in its own direction in both UIs, and `translate="no"`. So do technical marks (`Badge data`, `Chip data`).
    - A ProgressBar's fill is a block in flow, so it fills from the inline start in both directions. `media` makes it a `dir="ltr"` island, because a video timeline runs left to right in Arabic too.
    - In a ListRow, the name keeps its width up to the whole line, and the badges take what is left and are cut at the row's end. The en-XA gallery showed the earlier version squeezing a name to nothing.
  - **Contrast:** `test/ui-tokens.test.ts` also checks the components' colour pairs: dark text on the accent, live, warn and focus fills at 4.5:1 (a light text on the live red would be 2.6:1), danger at 3:1 (bold 28 px), and the disabled label at 3:1.
- **VirtualList** renders a list zone's `visible` items from `ZonePosition.top`, each of a fixed size (`itemSize`, by default `LAYOUT.rowHeight`).
  - Vertical lists are channel lists. Horizontal lists are rails: the en-XA labels showed that a rail of natural-width chips runs off the screen, so rails scroll a window of fixed-width chips too.
  - Items are keyed by index and laid out in normal flow, with no absolute positions, no transforms and no DOM measuring.
  - The gap is a CSS variable used by a `margin-left` rule. postcss-rtlcss mirrors that rule, which it can't do for an inline style.
  - The box keeps the size of a full window. `listWindow`, and `listHeight`, whose result `fits()` turns back into the same `visible`, are exported for screens to size their zones.
- **The pseudo-locale `en-XA`** (`pseudoLocalize`):
  - The ASCII letters with a Latin-1 or Latin Extended-A form get it (f, b, m, q, v and x have none).
  - Words (`one two three…`) pad the text by 40% of its length, so it can still wrap. The result is bracketed.
  - Text at an even brace depth is message text and gets accented. An odd depth is a placeholder or ICU syntax and is kept, so `{n, plural, one {# channel} other {# channels}}` accents only the branch texts.
  - Tests: fast-check properties (the round trip, the expansion bound, placeholders kept, never throws), plus `test/ui-pseudo-glyphs.test.ts`, which checks that both Latin faces have every accented letter.
  - `localeDir` moved here from the app.
  - Left for step 12: isolating the provider's text inside our sentences (FSI/PDI, or `dir="auto"` spans) and the digit forms.
- **The gallery** (`?screen=gallery`, `readScreen` in `data/params.ts`): every component on one 1920x1080 screen inside the safe area, driven by the remote. Its zones are the buttons, a rail of 9 categories (6 shown), 240 channels (7 shown) and 3 × 2 tiles; OK opens a dialog.
  - A small en/ar text table stands in for step 12's catalogs, and `en-XA` runs the English through `pseudoLocalize`.
  - The demo names are made up, and Latin and Arabic are mixed on purpose. The times are fixed strings, so screenshots don't change.
  - It ships in the TV bundles (about 10 KB of main), so it can be checked on a real TV (spike S9). It starts no data workers.
- **Checks:**
  - Unit tests: VNode-level component tests (the components use no hooks, so they are called as functions), VirtualList windows on both axes, the binding, `connectRemote` on a Node `EventTarget`, the click pairing with an injected clock, the gallery's key paths and text table, and `readScreen`.
  - e2e (`e2e/gallery.spec.ts`), in en, ar and en-XA:
    - every component inside the safe area, no page scroll, and none of our labels cut;
    - every glyph from the two bundled faces (`renderedFontsUnder`: per element, because the CDP call doesn't descend into block children);
    - in en-XA, every text node with letters outside `translate="no"` is bracketed (the same check finds our strings in English);
    - the mirrored positions;
    - the virtual lists by keys and the wheel;
    - the pointer, including a click and an Enter in either order selecting once.
  - The screenshots (`gallery-<locale>.png` and `-dialog.png`) go to `artifacts/screenshots` on every run, and CI uploads them as `gallery-screenshots`. The step-11b ones are committed in `docs/design/`.
  - `e2e/tv-bundle.spec.ts` opens the gallery from both bundles on `file://`.
  - Step 11c: the old-engine harness opens it from both bundles in Chromium 53, 56 and 68, full screen at 1920x1080. The checks are the e2e layout ones (safe area, no scroll, nothing cut or squeezed), 7 rows of 88 px, ArrowDown focusing row 1, and both faces loaded. It saves a screenshot per engine and platform (CI artifact `old-engines-report`).
    - Two CSS seeds prove those checks catch a component's CSS missing from app.css and a lost safe area.
    - The layout matched current Chromium on all three engines the first time.
    - The gallery needs no polyfill: a build without core-js passes it on all three engines.
    - See runbook old-engines.md.
- **Size:** main's own code 102.4 → 121.2 KB (tizen; 119.8 KB webos) of 500: about 10 KB for the gallery and the rest for the components, the binding and the pseudo-locale, with no new polyfills. A field named `at` had pulled in core-js's `Array.prototype.at` and `String.prototype.at` (Babel detects usage by property name), so it is now named `time`. app.css 9.7 → 26.6 KB.

**State:**
- Signals hold UI and session state.
- Domain stores are plain classes that expose signals: `ProfileStore`, `SourceStore`, `PlayerStore` (mirrors the controller) and `SettingsStore`.
- Catalog and EPG data comes from the query worker through `DataClient`: typed postMessage RPC, an LRU page cache, de-duplication of in-flight requests, and a small `useQuery` hook.
- No Redux, no react-query, no comlink.

### 1.3 Storage design (assumes the worst case: webOS wipes everything on update)

| Data | Where it lives | Size | After a webOS wipe |
|---|---|---|---|
| **Profile doc**: sources (credentials encrypted), favourites lists, hidden and reordered groups, channel-number overrides, EPG match overrides, audio/subtitle preferences, VOD and series progress (latest 500), last channel, recent channels, settings, parental PIN hash | Memory (signals), IDB `profile` (current plus 3 rolling snapshots), webOS DB8 mirror if spike S2 shows it survives, encrypted cloud backup | < 300 KB gzipped | Restored automatically from the cloud at startup |
| Catalog (live, VOD, series, categories) | IDB `catalog_chunks`, 500 items per record, versioned by generation | 5–60 MB | Re-ingested from the provider |
| Search text and key index | IDB `catalog_index` (typed arrays) plus query-worker memory | 5–15 MB | Rebuilt with the catalog |
| EPG programmes | IDB `epg_buckets`, keyed `[epgSrc, gen, channel, day]` (step 9b: XMLTV channel id and UTC day, by generation) | 10–100 MB, by tier | Re-ingested |
| XMLTV channel list and match table | IDB `epg_channels` | < 5 MB | Re-ingested |
| M3U files sent from a phone | IDB `blobs` (gzipped); included in the backup if ≤ 5 MB gzipped | ≤ 30 MB | Backup, or re-send from the phone |
| Signed remote config | IDB `kv` plus memory | < 50 KB | Re-fetched |
| Current zap list, visible pages, images | Main-thread memory only | A few MB | n/a |
| localStorage | Not used for anything that matters | — | — |

Profile schema changes go through versioned migrations with fixture tests. A migration never drops data, and the 3 snapshots allow rollback. This addresses complaint #7 (updates wiping favourites).

**Built in step 7** (`packages/data`):
- **Database version 1** (`schema.ts`): `sources_meta`, `catalog_chunks`, `catalog_cats`, `catalog_index`, `profile` and `kv`. The EPG stores come with step 9b as migration 2, and `blobs` with the phone pairing.
- **Migrations** are an append-only list, and the database version is its length. They run inside the upgrade transaction. A migration that throws aborts the upgrade, so the old version and its data stay intact. `schema.test.ts` pins the shape of every version, and upgrades from each earlier version with seeded data.
- **Transactions** are callback-driven inside and promise-based outside (`transact`). Never `await` inside one: on Chromium 53 a transpiled `await` can resume on a later task, after IndexedDB has committed the transaction.
- **Database version 2** (step 9b, migration 2): `epg_meta` (keyPath `epgSrc`), `epg_buckets` (key `[epgSrc, gen, channel, day]`) and `epg_channels` (key `[epgSrc, gen]`); §1.5 "Built in step 9b". `schema.test.ts` pins it and upgrades a seeded version 1 to it.
- **The profile document** is versioned on its own (`profile.ts`, version 1 = favourites). Older documents are upgraded on load, and the old copy goes to a snapshot. A save snapshots the replaced document at most once a day, into 3 rolling slots, and a restore can itself be undone. A document from a newer app version is shown but never overwritten.

**Storage space.** On Tizen, request the `unlimitedstorage` privilege. Spike S2 measures webOS quota. Budget: catalog ≤ 60 MB; EPG ≤ 100 MB on full-tier TVs and ≤ 30 MB on low-tier ones.

### 1.4 Catalog pipeline (ingest worker)

1. **Trigger.** A refresh runs when a source is added, when the user asks, or at launch if the cache is stale (live after 12 h, VOD and series after 24 h; both values come from remote config). Startup always shows the cached generation immediately.
2. **Spawn.** A fresh ingest worker starts for each refresh and is terminated when done, which frees its whole heap.
3. **Fetch.** Use `fetch()` and read `response.body.getReader()` as a stream. Send ETag/If-Modified-Since where the server supports it, and compare an FNV-1a hash of the bytes with the previous generation; if unchanged, stop. Chromium 53 has no AbortController, so cancel with `reader.cancel()` or by aborting an XHR.
4. **Decode.** `TextDecoder({stream:true})`, tolerant of BOM and CRLF. If the file starts with the gzip magic bytes `1f 8b`, decompress with `DecompressionStream` when available (Chromium 80+) or fflate's streaming `Gunzip` otherwise.
5. **Parse.**
   - **M3U:** a line-by-line state machine.
     - Reads `#EXTINF` attributes (`tvg-id`, `tvg-name`, `tvg-logo`, `group-title`, `tvg-chno`, `tvg-shift`, `catchup*`), plus `#EXTGRP` and `#EXTVLCOPT`.
     - User-Agent hints can't be applied, so they are recorded and shown in diagnostics.
     - A header `url-tvg`/`x-tvg-url` automatically adds an EPG source.
     - Items are classified as live, movie or series from the Xtream path (`/movie/`, `/series/`) or the file extension. Anything unclear is treated as live.
   - **Xtream:** list endpoints go through a streaming JSON-array splitter. It tracks nesting depth and strings, yields the text of each top-level object, and runs `JSON.parse` on each one, so a 60 MB response never becomes one giant string. Parsing is tolerant: Xtream panels return numbers as strings and plenty of nulls. `get_series_info` and `get_vod_info` are fetched only when the user opens an item, and cached for 24 h. `server_info.timezone` is stored because catch-up URLs need it.
     - **Built in step 6** (`packages/core`): `XtreamClient` over an injected `TextTransport`, `XtreamListParser` on `JsonArraySplitter`, and `xtreamFromM3uUrl` for the M3U→Xtream upgrade. How the panel zone is worked out without full `Intl` support is [ADR-010](adr/ADR-010-catchup-time-zones.md).
6. **Keys and normalization.**
   - **ContentKey:** `x:<src>:<kind>:<stream_id>` for Xtream, or `m:<src>:<hash(tvg-id || normName+group)>:<dup#>` for M3U. A key is never derived from the URL, because URLs contain credentials and change.
     - **Amended by [ADR-009](adr/ADR-009-m3u-content-keys.md)** (step 5): the M3U hash covers tvg-id **plus** normName, so channel variants that share a tvg-id don't depend on playlist order. It is a 53-bit hash, and `normalizeName`, `hash53` and the key layout are frozen.
   - **Name normalization:** lowercase, Latin accents removed, Arabic normalized (diacritics and tatweel removed; أإآ become ا, ة becomes ه, ى becomes ي; Arabic-Indic digits become ASCII).
   - **`matchName`:** a separate field with quality and country tags (HD, FHD, 4K, `AR:`, `|UK|`) stripped, used for EPG matching.
7. **Write.**
   - Records hold 500 items each, keyed `[src, gen, kind, catIdx, chunk]`, with about 10 records per transaction. This cuts IndexedDB record overhead by about 500x on old LevelDB.
   - The worker yields between batches.
   - When the UI posts `busy` (zapping or starting playback), the worker pauses.
   - On low-tier TVs it runs a duty cycle of 50 ms work and 50 ms sleep.
8. **Index.** For each source and kind, all normalized names are joined into one search string with `\u0001` separators, plus a `Uint32Array` of offsets. A key-to-location map is also built. Both are stored as typed arrays.
   - **Built in step 7** (`packages/core/src/search.ts`):
     - The key map is the sorted `hash53` of each key plus the item index (12 bytes per item), and it compares hashes only. A collision inside one segment is about a one-in-a-million event at 200k items, and it would cost only a favourite boost.
     - Items are numbered in the order the 500-item chunks were written, and a chunk table maps an item to its `[catIdx, chunk, slot]`. Display names stay in the chunks, so the index for 200k items is about 12 MB in memory, not double that.
     - `CatalogChunker` (data) numbers categories by first appearance. When more than 5,000 items are waiting, it flushes the largest category early as a partial chunk.
9. **Swap.** One transaction sets `sources_meta.gen = new`. The query worker reloads its index and the old generation is deleted in the background. If the app crashes mid-ingest, the old generation is still intact.
10. **Favourites survive refreshes** because they reference ContentKeys. If a key disappears, it is kept as "unavailable" for 30 days and re-matched by normalized name, which covers providers renumbering their streams.
    - **Built in step 8** (`packages/data/src`: `bytes`, `gunzip`, `throttle`, `favourites`, `ingest`, `ingest-service`, `ingest.worker`):
      - **One refresh** is `runIngest(job)`: prune the source's leftovers, fetch, hash, gunzip, decode, parse, chunk, index, write, swap, reconcile favourites, delete the previous generation. Only one refresh per source may run at a time; a second one supersedes the first (`IngestError('superseded')`).
      - **Fetch** goes through an injected `ByteTransport`; the worker uses `fetchTransport` (`response.body.getReader()`, `reader.cancel()`). M3U sends the stored `ETag`/`Last-Modified` back, and a 304 ends the refresh before anything is written. Xtream panels don't send validators, so only the hash applies there; the login answer is left out of the hash because it carries the panel clock.
      - **Unchanged bytes:** `SourceMeta.fetch` stores the FNV-1a hash and length of the raw download plus `INGEST_VERSION`. The same bytes from the same ingest version drop the new generation and report `unchanged`. A newer app version rebuilds them, so parser fixes reach cached catalogs.
      - **Gzip** is detected by the magic bytes, then `DecompressionStream` (Chromium 80+) or fflate's `Gunzip`. A body cut short fails the refresh with `format` or `network`; it never commits a shorter catalog. Nothing parsed at all fails with `empty` (a single HLS stream gets its own message).
      - **Failure handling:** any failure before the swap abandons the new generation at once; a crash leaves it for the next refresh's prune. The ingest worker's `prune` handler does the same for every source at app start.
      - **Throttle:** `setBusy(true)` pauses at the next checkpoint, between network chunks and between write batches. A busy flag expires after 15 s. Low-tier TVs run 50 ms of work and 50 ms of sleep (`lowTier` on `run`). Otherwise a task is yielded every 50 ms.
      - **Favourites** (`reconcileFavourites`, run in the same refresh right after the swap through `updateProfile`, a read-modify-write in one transaction):
        - A missing key is re-matched only to an unambiguous successor: the same kind and normalized name, narrowed by the tvg-id and then by the group the favourite was in. If no item has that name, the same tvg-id is tried (an M3U rename, ADR-009).
        - Keys already used by another favourite never count. Unmatched favourites get `missingSince` and are dropped after 30 days.
        - `FavouriteRef` gained the optional `group` and `epgId` for this. That is not a profile migration: v1 hasn't shipped, and the fields are optional.
      - **Tests:**
        - `ingest.test.ts`: a crash mid-ingest (the database closes under the refresh) keeps the old generation serving exactly as before, and the next refresh cleans up;
        - `test/ingest-mock.test.ts`: favourites survive a mock refresh where every Xtream id moved by 1000, including a same-name, same-tvg-id twin in another group;
        - `test/ingest-worker-bundle.test.ts`: the bundled worker (128.8 KB) ingests from the mock with the ES2017 APIs and DecompressionStream removed;
        - `test/ingest-200k.media.test.ts`: the 200k playlist.
    - **Wired into the app in step 8b** (`apps/tv/src/data`):
      - `DataEngine` (`engine.ts`) starts the query worker once. At app start a short-lived ingest worker runs `prune`; each refresh gets a fresh ingest worker, terminated when the refresh ends. A refresh first waits for the start-up prune, because a prune abandons any generation being built next to it, and only one refresh runs at a time.
      - On `swapped`, the query worker `reload`s before the refresh resolves, so the next read sees the new catalog.
      - Remote keys call `noteActivity()`: `setBusy(true)` once per burst of keys and `setBusy(false)` 1 s after the last one. A refresh that starts mid-burst is told at once. Sending busy only once per burst keeps the worker's 15 s expiry meaningful, so endless key presses can't starve a refresh.
      - The workers come from `@zoma/data/query.worker?worker` and `@zoma/data/ingest.worker?worker` (package `exports`, allowed by the boundary lint). The RPC clients come from `@zoma/data/client`, because the package index would pull every data module's polyfills into the main bundle.
      - The hello screen's catalog panel drives it until onboarding (step 13) replaces it: `?q=<words>`, `?force=1` and `?source=<playlist URL>` as the last parameter.
      - Tests: `test/tv-data-engine.test.ts` runs the real services over message channels (9/9 mutants caught); e2e refreshes the mock's playlist in `pnpm dev` and in both built bundles from `file://`; the old-engine harness does it in Chromium 53, 56 and 68 (§5, S1).
11. **Search.** `indexOf` over the search string, then a binary search over offsets to find the item.
    - **Ranking:** word-prefix matches first, then substring matches; live before VOD before series; favourites boosted.
    - **Results** are capped at 200.
    - **Speed target:** under 200 ms for 200k items on 2018 TVs.
    - **Built in step 7:**
      - Query words are ANDed in any order.
      - The ranking is: word-prefix before substring, then favourites, then live, VOD, series, then exact, name-start, word, then source order and catalog order.
      - The query worker (`packages/data/src/query.worker.ts`, 75.8 KB of the 150 KB worker budget since step 8 trimmed the polyfills) loads the active generations' segments, and resolves hits to items through a 16-chunk cache.
      - In Node, 13 typical queries over the 200k fixture take 0.3–11 ms each (`test/search-200k.media.test.ts`, `pnpm bench search-200k`).
12. **Fallback if spike S1 or S6 fails** on webOS 4: VOD and series are fetched per category on demand (`&category_id=`), and search covers only loaded categories plus all live channels.

### 1.5 EPG pipeline

1. **Sources:**
   - Xtream `xmltv.php` and the M3U `url-tvg` header, both added automatically.
   - User-added XMLTV URLs, in priority order.
   - For unmatched channels, Xtream `get_short_epg` is used as a now/next fallback. It is called only after a channel has been focused for 600 ms, and cached for 30 minutes.
2. **Wanted set.** Before ingest, build the set of tvg-ids, `epg_channel_id`s and matchNames from all live channels in all sources.
3. **Tokenizer.** A purpose-built streaming XMLTV tokenizer, not DOMParser. It handles entities and CDATA, and when a programme has titles in several languages it prefers the UI language.
4. **Matching cascade** (first hit wins):
   1. User override
   2. Exact id (case-insensitive)
   3. Xtream `epg_channel_id`
   4. Normalized display name
   5. matchName with tags stripped
   6. No match

   The method used is stored for each channel. Diagnostics shows the match rate per source and lists unmatched channels for manual mapping.
5. **Filter.** Drop programmes for unmatched channels, which is usually over 90% of a big XMLTV file. Drop anything outside the window. Apply `tvg-shift`, and parse `YYYYMMDDhhmmss ±hhmm` to UTC minutes. Times without an offset use the source's time offset or the panel zone; in a DST zone the repeated hour is ambiguous, so repair it from per-channel ordering ([ADR-010](adr/ADR-010-catchup-time-zones.md)). The step-6 tokenizer (`XmltvTokenizer`) skips unwanted programmes by `wantChannel` before tokenizing them.
6. **Time window** (remote-configurable):

   | Tier | Past | Future | Descriptions |
   |---|---|---|---|
   | Full (2020+) | Longest catch-up days among matched channels (at least 1, at most 7) | 7 days | ≤ 1000 chars |
   | Low (2018–19) | 1 day (or catch-up days, at most 2) | 3 days | ≤ 300 chars |

7. **Storage.** One record per channel per day holding column arrays (`Int32Array` start/end, `title[]`, `desc[]`, flags). A typical grid screen is the visible rows times 1–2 days, so about 20 reads.
8. **Refresh.** Every 12 h, or sooner if less than 24 h of future data remains. Past days are pruned daily. Updates use the same generation swap as the catalog. On low-tier TVs, EPG and catalog ingest never run at the same time.
9. **XMLTV assumptions.** The parser assumes `<channel>` elements come before `<programme>` elements, which is the standard. If they are interleaved, a telemetry flag is recorded and those programmes are buffered with a size cap.

**Built in step 9** (`packages/core/src`: `epg-match.ts`, `epg-guide.ts`; storage, refresh, the short-EPG fallback and the app wiring are step 9b):
- **Wanted set** (`EpgWantedSet`): every live channel, indexed by its playlist id (case-insensitive), the normalized name and tvg-name, and their match names. It also carries each channel's catch-up days and tvg-shift.
- **Matching** (`EpgMatcher`, one per guide) runs as each `<channel>` is declared:
  - The cascade is override, id, `xtream-id` (the same id, from an Xtream source), normalized display name, then match name. The match-name level also tries the XMLTV id's stem (`BBCOne.uk@HD` → `bbcone`).
  - A stronger method later in the guide takes a playlist channel over from a weaker one. At the same level the first declared channel wins, and a tie at a name level is flagged `ambiguous`.
  - Across guides (`combineEpgMatches`), the stronger method beats guide priority; at the same level the guide listed first wins.
  - An override pins a playlist channel to one guide channel (or to no EPG), and blocks it everywhere else.
- **Reading a guide** (`EpgGuideReader`): decoded text in, buckets out.
  - The tokenizer hands each item over in document order (`onItem`), so its `wantChannel` sees every channel declared before the programme. Programmes of unmatched channels are skipped before they are tokenized.
  - Programmes of a channel declared later wait, up to 20,000 of them, and are dropped if their channel never comes. A programme-only id that matches by id alone is declared on the spot.
- **Times** are UTC epoch minutes.
  - A time without an offset is read in the fallback zone and settled to the earlier instant of a repeated DST hour (`parseXmltvTime` alone gives the later one east of UTC). A start that then falls before the channel's previous stop moves forward an hour, and so does a stop that ends before its start, or one of a programme whose start moved (ADR-010).
  - A lone boundary in the repeated hour, such as a 90-minute programme ending at the second 01:00 with the next one starting there, reads the same either way. It is taken as the earlier instant, an hour early; `test/epg-mock.test.ts` pins that case.
  - The user's per-source correction (`shiftMinutes`, step 24) is added to every time.
  - **tvg-shift is applied when reading, not here.** Several playlist channels can share one guide channel with different shifts (the `+1` variants), so `epgNowNext` takes the shift per playlist channel, and the window widens by the largest one.
  - A missing stop becomes the channel's next start, or one hour for the last programme (flagged). Lengths are capped at 24 h; an overlap is cut where the next programme starts; the first of equal starts wins.
- **Window** (`epgWindow`, `EPG_WINDOWS`): fixed when the first programme arrives, from the matched channels' longest catch-up. A programme is kept when it overlaps the window.
- **Buckets** (`EpgBucketBuilder`): one per guide channel per UTC day of the start, as column arrays (`Int32Array` start/end, title, sub, desc, category, episode, `Uint8Array` flags) sorted by start.
  - They are handed out every 20,000 programmes. The channel being read is kept back, so a guide grouped by channel gives one bucket per channel-day. A channel-day handed out before comes again with `merge: true` (`mergeEpgBuckets`), as in a time-sorted guide.
  - A reader takes days `d - 1` and `d`, because a programme from the evening before can still be on air.
- **Memory:** the reader keeps no id or time string of a programme (per-channel state is indexed by number), its texts only until their bucket is handed out, and each guide channel's id is an owned copy (`ownString`). A V8 substring keeps its whole decoded chunk alive, so one id kept per channel pinned a chunk per channel: the 300 MB guide ran out of a 160 MB heap before the fix, and fits in 96 MB after it.
- **Match-rate report:** `EpgGuideReader.report()` and `formatEpgReport` give, per guide, the match rate, the counts by method, ties, the unmatched channels, guide channels used, programmes skipped, outside the window or with bad times, DST repairs and bucket fragments. `pnpm epg:report` prints it for any playlist and guides (runbook mock-provider.md, "Benchmarks").
- **Tests:**
  - `epg-match.test.ts` and `epg-guide.test.ts`, including a fast-check property: the same merged buckets for any chunking, flush size and channel order. 28/28 mutants were caught.
  - `test/epg-mock.test.ts`: the mock's schedule exactly, in both tiers and in every offset style, including New York without offsets.
  - `test/epg-300mb.media.test.ts`: every number of the 300 MB report exact in a 96 MB heap.

10. **Benchmark limits** (step 9; `pnpm bench epg-ingest-*`, enforced in CI's `media` job). The Node benchmark reads the gunzipped 300 MB fixture guide through `EpgGuideReader` and drops the buckets. Its limits come from S6 (§5): a 150 MB gzipped guide's filtered ingest within 4 min on webOS 4.
    - **`epg-ingest-low-10pct`, S6's case: ≤ 8 s median on the CI runner.** The low tier, with a playlist matching a tenth of the guide.
      - The fixture is twice S6's guide, so the TV gets 8 min.
      - The low tier's 50/50 duty cycle leaves 4 min of CPU. Half of that is kept for what Node doesn't do here: fflate's JavaScript gunzip, IndexedDB writes and structured clones. That leaves 120 s for the read.
      - A 2018 webOS 4 core is taken as about 15x slower than the CI runner: about 10x for the SoC (a 1.x GHz Cortex-A53 class core) and 1.5x for V8 5.3 against today's V8. 120 s / 15 = 8 s.
      - Measured: 2.3 s on the CI runner and about 2.5–3 s on a fast PC under load (2026-11-02).
    - **`epg-ingest-full`, the worst case: ≤ 20 s median.** Every guide channel matched, the full tier's 7 + 7 days, 1.33 M programmes kept.
      - S6 sets no full-tier number, so the target chosen here is 4 min on a 2020 TV, with no duty cycle and half the CPU for gunzip and writes: 120 s.
      - A 2020 TV (Chromium 68+, 1.5–2 GHz cores) is taken as about 6x slower than the CI runner. 120 s / 6 = 20 s.
      - Measured: 5.9 s on the CI runner (the tokenizer alone: 4.0 s), about 7.5 s on a fast PC under load.
    - **Memory: the worst case runs in a 96 MB V8 heap** (`--max-old-space-size=96`), with the 200k playlist parse and its 20,000-channel wanted set in the same heap (`test/epg-300mb.media.test.ts`). It runs in about 24 s there, because the GC works harder.
      - A sampled heap peak isn't limited: uncapped, V8 lets garbage grow to 200 MB or more before collecting it.
      - 96 MB is the ingest worker's share on a 1–1.5 GB low-tier TV, next to the main thread and the query worker.
    - **The slowdown factors are estimates.** S6 measures the real ones: the lab build runs the same reader on the TV. If S6 measures a larger factor, lower the limits in `EPG_LIMITS` (`tools/bench/src/suites.ts`) to match, rather than raising the TV budget.

**Built in step 9b** (`packages/data/src`: `epg-store`, `epg-sources`, `epg-ingest`, `epg-service`, `epg.worker`, `ingest-errors`, now/next in `query-service`; `apps/tv/src/data/engine.ts` and the hello screen's catalog panel). The short-EPG fallback is step 9c (below).
- **Storage** (database version 2, §1.3):
  - `epg_meta`, one record per guide: the active and building generation, the fetch stamp, the basis it was matched against, `until` (the latest programme end, in UTC minutes), a summary of the match rate and the window, the guide's `rank`, and `failedAt`.
  - `epg_buckets`: core's column bucket without `channel`, `day` and `merge` (the key holds them). The `Int32Array` and `Uint8Array` columns are stored as they are; fake-indexeddb and Chromium 53/56/68 round-trip them.
  - `epg_channels`, one record per guide generation: the match table (each live channel's XMLTV channel, method, tie flag and tvg-shift), the XMLTV channels it uses, and the unmatched live channels (for step 24's diagnostics).
- **Guides** (`epgGuides`), in priority order:
  - the user's XMLTV URLs in the user's order;
  - then each catalog source's own guide: Xtream `xmltv.php`, or the URLs its M3U header names. Those are now kept in `SourceMeta.epgUrls` by the catalog ingest.
  - Ids are `<src>:xmltv`, `<src>:tvg<n>` and `u~<id>`; source ids can't contain `:` or `~`, so they never collide. A URL listed twice is read once.
  - The user's guides come first because a guide added by hand is there to win. Order only breaks ties between methods of equal strength (`combineEpgMatches`).
  - Times without an offset are read in the panel zone for an Xtream guide (`panelZone(SourceMeta.server)`, learnt at login), and in UTC for the others until step 24 adds per-guide offsets.
- **A refresh** (`runEpgRefresh`, in a fresh **EPG worker** that is terminated afterwards):
  1. Stored guides that are no longer listed are deleted. The others lose what a crashed refresh left behind and the past days they no longer need.
  2. The wanted set is read once: every live item of every source's active generation, in source and storage order.
  3. Each guide (`runEpgIngest`): conditional fetch, FNV-1a, gunzip and UTF-8 as in the catalog ingest, then `EpgGuideReader`. Buckets are written 10 per transaction, with the throttle's busy pause and low-tier duty cycle between batches.
  4. A `merge: true` fragment is merged into the stored record, which wins on equal starts. Fragments of one channel-day in the same batch are merged in memory first: inside one transaction, a second `get` of a key is answered before the `put` that the first `get`'s callback issues.
  5. The match table is written, one transaction swaps the generation in (the query worker reloads), and the previous one is deleted.
- **Nothing new:** while the basis is the same (`EPG_INGEST_VERSION`, the tier, every source's active generation, the overrides), a 304 for the guide's own validators, or the same bytes, keeps the stored generation and only prunes its past days. A new catalog generation reads the same bytes again, because new channels may match.
- **Failures:** each guide fails on its own, and its new generation is abandoned:
  - a guide cut short (the tokenizer ended inside an element) and a body that is not XMLTV (no channel and no programme) fail with `format`;
  - HTTP, auth and network errors fail with their own codes;
  - `failedAt` holds a failed guide back for 2 h;
  - a cancel stops the whole refresh;
  - messages never contain URLs.
- **When** (`epgRefreshDue`): a guide with no generation; 12 h after its last check; or when its programmes end less than 24 h ahead. Never within 2 h of the last check, or a guide that only covers a few hours would be fetched in a loop. The app asks with `refreshEpg(..., { due: true })`; the timer that asks while the app runs comes with the EPG screens (step 22).
- **One refresh at a time:** `DataEngine` runs catalog and EPG refreshes in one slot and refuses a second ("A guide refresh is already running"), so a low-tier TV never runs both at once. Remote keys pause an EPG refresh as they pause a catalog one.
- **Now/next** (`QueryService.nowNext`): the active generations' match tables are combined in guide order (`combineEpgMatches`) at each reload. For each live channel, the buckets of days `d - 1` to `d + 1` are read in one transaction, `d` being the UTC day at now minus the channel's tvg-shift. `epgStatus` lists the guides and sources fresh from IndexedDB.
- **Workers:**
  - With the reader inside, the ingest worker measured 159.6 KB, over its 150 KB budget. The reader therefore runs in its own worker, `@zoma/data/epg.worker` (118.8 KB): a package export, a boundary-lint entry point, and a `?worker` import in `apps/tv/src/data/workers.ts`.
  - `ingest-errors.ts` keeps the catalog ingest out of the EPG worker.
  - The query worker grew from 75.8 to 82.6 KB (now/next).
  - The main bundle inlines all three workers and is now about 440 KB of its 500 KB budget (runbook tv-build.md). That leaves little room for the UI steps: see RELAY.md's note on the main budget. (Since 2026-11-03 the main budget counts only main's own code, without the inlined workers: ADR-003.)
- **Found on the way:** with a tvg-shift, core's `epgNowNext` compared an unshifted start with a candidate it had already shifted, so the bucket order decided which programme came next. Fixed, with a test over shifts and bucket orders.
- **Tests:**
  - `epg-store.test.ts`: fragments merged across and within batches, typed columns round-tripped, generations, day pruning, failures, guide order, due rules.
  - `epg-ingest.test.ts`:
    - the stored buckets equal the reader's own, merged;
    - now/next with tvg-shift;
    - 304, unchanged bytes, a new catalog, `force`;
    - a crash mid-ingest (the database closes) keeps the old generation serving exactly as before, and the next refresh cleans up;
    - cut-short, non-XMLTV, 401, 404 and network failures, each on its own;
    - gzip, deleted guides, `only`, the panel zone, cancel.
  - `test/epg-ingest-mock.test.ts`: the mock's `url-tvg` guide, a gzipped user guide in the low tier, and an Xtream panel guide without offsets in Kathmandu time. Each stores exactly the mock's schedule, and now/next matches it for every live channel.
  - `test/tv-data-engine.test.ts`: the EPG worker, the `due` rule, one refresh at a time, and the busy pause.
  - e2e: the guide row in `pnpm dev` and in both built bundles.
  - The old-engine harness: a third Blob worker reads a generated guide in Chromium 53, 56 and 68 (runbook old-engines.md).

**Built in step 9c: the short-EPG fallback** (`packages/core/src`: `xtream-epg.ts`, `xtream-base.ts`; `packages/data/src/short-epg.ts` and `shortEpg` in `query-service`; `DataEngine.focusChannel` in `apps/tv/src/data/engine.ts`; the hello screen's catalog panel):
- **When it asks:** `DataEngine.focusChannel(channel)` starts a 600 ms timer (`FOCUS_MS`). A new focus, `focusChannel(null)` (the focus left the live channels) or `dispose` cancels it, and the waiting promise resolves with `null`, so scrolling through a list asks nothing. After 600 ms the query worker answers. An answer that arrives after the focus moved on is dropped by the engine, but the worker keeps it for the next focus.
- **Which channels:** the query worker first reads the stored now/next.
  - A channel that a guide matches gets the guide's now/next (`from: 'guide'`), with no request.
  - Otherwise the panel's `get_short_epg` is asked (`limit=4`, `from: 'panel'`), but only when the source is an Xtream panel and the channel's stream URL is an Xtream live URL (`…/live/{u}/{p}/{id}.ts`, or `…/{u}/{p}/{id}`). An Xtream panel is an Xtream source, or an M3U source whose URL is a `get.php` export.
  - Anything else gets `from: 'none'`.
- **Credentials:** the account always comes from the source, never from the stream URL, so the request goes only to the panel the user added, even when the stream URLs point at a load balancer. The cache is keyed by ContentKey, and errors carry a code and an HTTP status only.
- **Cache** (in the query worker, which keeps running):
  - 30 minutes per channel (`SHORT_EPG_TTL_MS`), up to 200 channels, the oldest answer dropped first;
  - an empty answer is kept too (the panel has nothing for that channel);
  - a failure isn't kept, so the next focus asks again;
  - two asks while a request runs share it.
- **Programmes** (`xtreamEpgProgrammes`): the entries become the guide's own `EpgProgramme` rows, so the UI shows one type.
  - Times are UTC minutes from `start_timestamp` and `stop_timestamp`, so no zone is needed. An entry without a start timestamp is skipped.
  - A missing stop becomes the next start, or 60 minutes for the last entry, and is flagged `EPG_FLAG_STOP_GUESSED`. Lengths are cut at 24 h, and of equal starts the first entry is kept.
  - Now/next is read the way the stored guides are (`buildEpgBucket`, then `epgNowNext`), at the caller's `at` or now, on a copy, so the kept answer never changes.
- **Size:** the query worker now has `fetchTransport`.
  - With `XtreamClient`, the worker measured 110.5 KB: the client brings the list parser and the JSON splitter.
  - So the short-EPG call and the plumbing it shares with the client moved out of `xtream.ts`, into `xtream-epg.ts` (decode, convert, `xtreamShortEpg`) and `xtream-base.ts` (tolerant values, the text transport, `XtreamError`, reading a small JSON answer). `xtream.ts` re-exports them, so no import changed.
  - The stream id comes from the URL rather than from `parseContentKey`, because `content-key.ts` would bring core-js's `JSON.stringify` polyfill (about 4 KB). `Fnv1a.digest` no longer uses `padStart`, whose polyfill came with `bytes.ts`.
  - Result (tizen): query 80.7 → 89.8 KB; main 449.4 → 459.1 KB of 500; EPG 116.0 → 115.1 KB; ingest 125.5 → 124.9 KB.
- **Mock:** the scenario `no-xmltv` turns `xmltv.php` off (404) while `get_short_epg` still answers, as on panels that disable their guide. Every live channel is then unmatched.
- **Tests:**
  - `xtream.test.ts`: the conversion (missing times, guessed stops, cuts, equal starts, seconds).
  - `short-epg.test.ts`:
    - which channels have a panel;
    - the cache: 30 minutes to the millisecond, eviction, shared requests, failures not kept;
    - now/next at any time without changing the kept rows;
    - `QueryService.shortEpg` with a stored guide: matched, unmatched, no panel, no transport, errors.
  - `test/short-epg-mock.test.ts`, the "done when": the real `DataEngine`, the services over message channels and fetch against the in-process mock over a socket, with only `setTimeout` faked.
    - On a `no-xmltv` panel, an unmatched channel gets the mock's own now/next after 600 ms of focus and not at 599 ms.
    - A second focus within 30 minutes makes no request, and the panel is asked again after 30 minutes.
    - A focus that moves on early asks nothing, and a late answer is dropped.
    - With the `get.php` guide, a matched channel asks nothing, and the unmatched one's empty answer is kept.
  - `test/query-worker-bundle.test.ts`: the bundled Chromium 53 worker asks with `fetch` and `TextDecoder`, then answers from its cache.
  - e2e, in `pnpm dev` and both built bundles: the mock's unmatched channel asks the panel. In dev, a `no-xmltv` panel gives `from: panel`.
  - 26/26 mutants caught (`artifacts/mutate9c.py`).

---

## 2. Player abstraction

```ts
// packages/player/src/engine.ts
export interface PlayerEngine {
  readonly kind: 'avplay' | 'html5' | 'mse';
  readonly caps: { maxHeight: number; trackSwitch: 'reliable'|'unreliable'|'none';
                   deliversSubtitleText: boolean; preloadSlots: number; rates: number[] };
  load(req: PlayRequest, token: number, opts?: { startMs?: number; preload?: boolean }): Promise<void>;
  play(): void; pause(): void; seek(ms: number): Promise<void>;
  stop(): Promise<void>;                 // must close the network connection (provider connection limits)
  setRect(r: Rect | 'full'): void;       // AVPlay setDisplayRect / CSS on the single <video>
  getTracks(): { audio: Track[]; text: Track[] };
  selectAudio(id: string): Promise<boolean>; selectText(id: string | null): Promise<boolean>;
  positionMs(): number; stats(): EngineStats;
  suspend(): void; resume(): void;
  on(cb: (e: EngineEvent & { token: number }) => void): () => void;
  destroy(): void;
}
export type PlayRequest = { key: ContentKey; mode: 'live'|'vod'|'catchup';
  candidates: { url: string; container: 'ts'|'hls'|'mp4'|'mkv' }[];  // ordered fallbacks
  externalSubs?: { lang: string; url: string; fmt: 'srt'|'vtt' }[]; hints?: { uhd?: boolean } };
```

**Engines:**
- **Tizen:** `AvplayEngine` (in platform-tizen) handles everything, including 4K, TS, AC3/E-AC3 and track switching. `Html5Engine` is a fallback for HLS only, used when AVPlay fails with specific error codes.
- **webOS:** `Html5Engine` with one app-wide `<video>` element shared by fullscreen and future preview. Audio-track switching uses `audioTracks` first, then luna `com.webos.media` `selectTrack` with `video.mediaId` (spike S5 decides). If neither works, the menu says "Not supported on this TV" instead of pretending.
- **Desktop:** `Html5Engine`, plus hls.js in dev builds only.
- **MSE engine** (hls.js or mpegts.js): only if S5 shows gaps in native HLS on webOS. It is never the default, because MSE is FHD-only and AC3 support is unreliable.
- **AVPlay layering:** AVPlay renders below the HTML, so the player route sets `html` and `body` to transparent backgrounds.

**PlayerController** is platform-agnostic and owns all of the following:
- **Session tokens.** Every `load` gets a new token, and events carrying an old token are dropped. This prevents race bugs during fast zapping.
- **Close-before-open.** `await stop()` always runs before the next `load`, because providers often allow only one connection.
- **URL strategy.**
  - Xtream live tries `.ts` first (faster start), then `.m3u8`, unless `allowed_output_formats` says otherwise.
  - The format that worked is remembered per source.
  - Catch-up and timeshift URL builders live in core (Xtream `timeshift` in the server's timezone; M3U `default/append/shift/flussonic/xc` templates).
- **Redirect handling (Tizen).** Each source has a `redirectMode`: `unknown`, `none` or `redirects`.
  - **First play:** an XHR GET is aborted as soon as headers arrive (`readyState 2`), and `responseURL` is read.
  - **If it redirected:** the source is marked `redirects` and AVPlay gets the final URL from then on.
  - **If not:** the source is marked `none` and later plays skip the probe.
  - **Re-probe:** if AVPlay hasn't prepared within 8 s.

  The webOS `<video>` element follows redirects itself, so no probe is needed unless S5 shows otherwise.
- **Watchdog.**
  - **Stall definition, live:** the position hasn't moved for 6 s while playing, or buffering has lasted more than 12 s.
  - **Stall definition, VOD:** buffering has lasted more than 20 s.
  - **Retry ladder:**
    1. Reopen the same URL (live jumps to the live edge; VOD resumes at the last position).
    2. Re-run the redirect probe.
    3. Switch container (`.ts` and `.m3u8`).
    4. Repeat with backoff of 1, 2 and 4 s.
  - **Give up:** after 4 attempts within 60 s, show the error card.
  - **While retrying:** the UI shows a small "Reconnecting…" badge, not a black screen.
  - **Thresholds** are tunable per model through remote config.
- **Error classifier** (complaint #9). It produces four user-facing categories, each with a diagnostic code:

  | Category | Examples |
  |---|---|
  | **Your internet** | Device offline, DNS failure for all hosts |
  | **Your provider** | Xtream `auth=0`, Expired, Banned, `active_cons >= max_connections`, HTTP 401/403/404/5xx/509 on the probe, timeouts |
  | **This TV can't play this** | Unsupported codec, e.g. DTS on Samsung 2024+ |
  | **App error** | Anything else |

  On a provider failure the controller re-checks `player_api.php` and shows the account status, expiry date and connection count.
- **Zapping (v1).**
  - The on-screen info bar updates instantly; loading starts after 350 ms with no new key press.
  - Number entry collects digits for 1.5 s. Channel numbers come from `tvg-chno`, then Xtream `num`, then list position, and user overrides win.
  - Previous channel uses the Samsung PRE-CH key where it can be registered, with an info-bar action and a configurable colour key elsewhere.
  - On AVPlay, `setBufferingParam` sets a lower first-play buffer. A "Fast start / Stable" setting controls this, and remote config can override it per model.
- **Tracks.**
  - Preferred audio and subtitle language lists, e.g. `['ar','en']`, are applied automatically when tracks appear.
  - The user's per-channel choice is remembered.
  - Language codes are normalized (`ar`, `ara`, `arb`, `Arabic` and `عربي` all become `ar`).
- **Subtitles.**
  - **Our overlay:** external SRT/VTT is parsed in core and drawn by our own overlay on both platforms, with `dir=auto` on each cue for Arabic, and size and background settings. AVPlay's embedded-subtitle text callback feeds the same overlay.
  - **webOS embedded subtitles** are left to the native renderer.
  - **No `<track>` element** is used on webOS, which removes the VTT-only limitation.
- **Lifecycle.**
  - **Tizen, on hide/show:** `suspend()` and `restore()`.
  - **webOS, on hide:** stop.
  - **webOS, on show:** live reloads at the live edge; VOD resumes from the saved position.
  - **Screensaver:** off while playing, on when stopped.
  - **VOD progress** is saved every 10 s.
- **Start on last channel.** At startup the controller reads the profile, decrypts that source's credentials, builds the URL and starts playback before the catalog has loaded. Target: first frame within 4 s on 2020+ TVs.

---

## 3. Backend (minimal)

### 3.1 What v1 needs

| Service | Why it's in v1 |
|---|---|
| Signed remote config, kill-switch, domain blocklist | Legal posture, and fixing behaviour without waiting for store review |
| End-to-end pairing relay (phone to TV) | Complaint #1, and remote family setup for older users |
| End-to-end encrypted backup and restore | Required on webOS because of the update wipe; also used on Tizen |
| Telemetry, crash reports, diagnostics code | You can't buy every TV model; this is how you learn what works |

**Not in v1:** user accounts, multi-TV sync, server-side EPG processing, image proxy or resizing (both would fetch provider URLs), payments.

### 3.2 Stack and endpoints

**Stack:**
- Next.js App Router route handlers on Vercel.
- Neon Postgres via Prisma: `PairSession`, `Backup` (metadata), `TelemetryEvent`, `DiagReport`.
- Cloudflare R2 for encrypted blobs (backups and pairing files), with lifecycle deletion.
- Upstash for rate limiting.
- The phone page and legal pages are part of the same Next.js app.

| Endpoint | Purpose |
|---|---|
| `GET /v1/config` | Signed config doc plus `country` from the request's geo header; 5-minute CDN cache |
| `POST /v1/pair` | TV registers `{tvPk}` and receives `{sid, code, pollToken, exp}` |
| `GET /v1/pair/:code` | Phone gets `tvPk` (manual-code path only) |
| `POST /v1/pair/:code/payload` | Phone sends `{phonePk, nonce, ct}` (≤ 64 KB) |
| `POST /v1/pair/:code/upload-url` | Presigned R2 PUT for an encrypted M3U file (≤ 40 MB) |
| `GET /v1/pair/s/:sid` | TV polls every 2 s with `pollToken`; payload is deleted on read |
| `POST /v1/pair/s/:sid/status` | TV reports `ok, auth_failed, expired, unreachable, blocked`; the phone displays it |
| `PUT/GET/DELETE /v1/backup/:lookupId` | Encrypted envelope (≤ 512 KB); `X-Write-Token` required for PUT and DELETE |
| `POST /v1/telemetry` | Batched, schema-validated events (≤ 64 KB) |
| `POST /v1/diag` | Scrubbed diagnostics report; returns a 6-character support code |

**Retention:** pairing rows are deleted after 1 h (R2 objects after 24 h); backups after 180 days without an update; telemetry after 90 days. IP addresses are used for rate limiting only and never stored.

### 3.3 Encryption and key scheme

All primitives come from **tweetnacl** (X25519, XSalsa20-Poly1305, Ed25519) and **@noble/hashes** (SHA-256, HMAC, HKDF, scrypt). Both are pure JavaScript, so they work on Chromium 53 and on `file://`, where WebCrypto `subtle` may not be available. The phone page uses the same `packages/crypto`, and test vectors are shared between TV and web.

**A. Pairing (end-to-end; the server only ever sees ciphertext)**
1. The TV generates an ephemeral X25519 keypair `(tvPk, tvSk)`, held in memory only. It calls `POST /v1/pair {tvPk}`. The server stores `sha256(code)`, `tvPk` and `sha256(pollToken)`. The code is 8 Crockford base32 characters (about 40 bits), expires after 10 minutes, and is rate-limited per IP.
2. The TV shows a QR code for `https://<domain>/p#c=<code>&k=<tvPk>`. The URL fragment is never sent to the server. It also shows the code in large text, so a family member elsewhere can type it at `<domain>/p`.
3. The phone page (English and Arabic, RTL) offers three forms: Xtream (server, user, password), M3U URL, or M3U file. Each takes optional EPG URLs and a name. The page never contacts the provider.
4. The phone runs `ct = nacl.box(JSON(payload), nonce, tvPk, phoneEphSk)` and posts `{phonePk, nonce, ct}`.
   - **File uploads:** a random `fileKey` encrypts the file in 1 MB `secretbox` frames (nonce = base + counter), uploaded through the presigned PUT.
   - **Decryption key:** `fileKey` and the object key travel inside the boxed payload.
   - **On the TV:** it decrypts and parses frame by frame.
5. The TV decrypts the payload, validates it against the provider directly, and posts only a status category back. The server deletes the payload once the TV reads it.

**B. Backup (restores automatically after the webOS wipe, no user action needed)**
```
deviceSecret = DUID (Tizen) | LGUDID (webOS) | fallback: random 128-bit "Backup code" shown in Settings
master     = scrypt(deviceSecret, salt="zoma.backup.v1|"+platform+"|"+appId, N=2^15, r=8, p=1, dkLen=32)
             (derived once in a worker, a few seconds on 2018 TVs, then cached in IDB)
lookupId   = b64url(HMAC-SHA256(master, "lookup"))
writeToken = HMAC-SHA256(master, "write")          server stores sha256(writeToken) on first write
encKey     = HKDF-SHA256(master, info="enc")       localKey = HKDF-SHA256(master, info="local")
envelope   = {v:1, kdf:"scrypt-15-8-1", nonce:24B, ct: secretbox(gzip(profileJSON), nonce, encKey)}
```
- **Restore.** At startup, if IDB has no profile, derive `master`, GET the envelope, decrypt it, show "Welcome back", and re-ingest catalogs in the background.
- **Upload.** 60 s after a change, at most once every 5 minutes, and whenever the app is hidden.
- **Credentials on the TV** are encrypted with `localKey` and decrypted only when building a URL.
- **Threat model, honestly stated.**
  - **Protected:** a database leak, insiders, and any request for plaintext (we don't have it).
  - **Not protected:** someone who has both our database and the physical TV's device ID.
  - **Later hardening:** an optional user PIN mixed into the KDF.
- **Settings.** The backup is on by default and disclosed during onboarding, with a toggle in Settings ("include login details" is a separate toggle).

**C. Config signing**
- **Keys.** An offline Ed25519 private key is kept in your password manager plus a paper backup. The app embeds two public keys so the key can be rotated.
- **Signing.** `tools/sign-config` signs `config/config.json` and the result is committed to the repo, which gives an audit trail.
- **Doc contents:**
  - `minVersion` per platform
  - `kill[]` rules, each with `{match:{platform, versions, countries}, mode: notice | block-new-sources | disable-playback | disable-app}`
  - `blocklist:{salt, hashes[]}`
  - feature flags and tunables (buffer seconds, watchdog thresholds, EPG windows, telemetry sampling)
  - `issuedAt` and `expiresAt`
- **Fetching.** The app fetches the config at launch without blocking (3 s timeout) and every 6 h. It verifies the signature, caches the result, and falls back to the cached copy if a fetch fails.
- **Blocklist matching.**
  - The client compares `sha256(salt + host)` against the host and each parent domain.
  - It checks when a source is added, on refresh, and before playing. Both the API host and the final stream host after redirects are checked.
  - The list never names domains publicly, and our server never learns which provider a user has.

### 3.4 Telemetry

- **Events:** `app_start` (tier, cold-start ms, catalog size bucket), `ingest_done` (kind, ms, size buckets), `play_result` (engine, container, ttffMs, error class and code), `stall` (recovered, attempts), `epg_match` (rate bucket), `capability` (model, firmware, Chromium version, spike-style feature probes), `crash` (scrubbed stack).
- **Never collected:** URLs, hostnames, channel or VOD names, credentials, or IP addresses.
- **Identity:** a random installId that changes after a wipe.
- **Scrubbing:** the server drops fields not in the schema, and a URL/credential scrubber with tests acts as defense in depth.
- **Control:** sampling per event via config; an opt-out toggle.
- **Reporting:** saved SQL views to start with.

---

## 4. Build tooling and test strategy

**Build pipeline** (`tools/build/build-tv.ts`):
1. Build each worker as an IIFE with Rollup and Babel (`targets: {chrome:'53'}`, `useBuiltIns:'usage'`, core-js 3). Async/await becomes generators, which Chromium 53 runs natively.
2. Run the syntax gate on the workers. It parses with acorn at `ecmaVersion: 2016` and fails on anything newer.
3. Build the main IIFE. Workers are imported as strings and started from Blob URLs, which avoids the `file://` worker question. The CSS the modules import becomes app.css through `postcss-rtlcss` and a Chromium 53 CSS gate (since step 11a, without `postcss-preset-env`: ADR-003).
4. Run the syntax gate on the main bundle. Check bundle budgets: main JS ≤ 500 KB minified (its own code, without the inlined workers: ADR-003), each worker ≤ 150 KB.
5. Copy the platform files and package: `tizen package -t wgt -s <profile>` and `ares-package`.

**Linting:** `eslint-plugin-compat` with browserslist `chrome 53`. The polyfill allowlist lives in CLAUDE.md.

**Dev loops:**
- **Desktop:** `pnpm dev` runs Vite with platform-browser and the mock provider.
- **On the TV:** `pnpm tv:watch` rebuilds the IIFE on every change and serves it over the LAN. A dev-only loader in the installed app pulls it and live-reloads via EventSource, so there's no reinstall per change.
- **Installed builds:** `pnpm device:install <alias>` wraps `sdb`/`tizen install` and `ares-install`. `ares-inspect` gives remote DevTools.
- **LG Dev Mode** expires after about 50 h; the runbook covers extending it.

**Chromium 53 cheat sheet for CLAUDE.md.** These are missing and must be avoided or polyfilled:
- AbortController
- `Object.values` and `Object.entries`
- `padStart`
- `Promise.finally`
- `Array.flat`
- `Object.fromEntries`
- `globalThis` and `queueMicrotask`
- `Intl.PluralRules`
- `ResizeObserver`
- `structuredClone`
- `Blob.text()`
- CSS Grid, flex `gap`, `position: sticky`, logical properties
- `loading="lazy"`

These are available: fetch with streams, TextDecoder, IntersectionObserver, IDB `getAll`, WebSocket/EventSource, CSS variables.

**Test layers:**

| Layer | Tool | Covers |
|---|---|---|
| core | Vitest (Node) | Golden tests and fast-check fuzzing for the M3U, Xtream, XMLTV and JSON splitter parsers; normalization; EPG matching; catch-up URLs; search ranking; Arabic plurals (6 forms) |
| data | Vitest + fake-indexeddb | Migrations, generation swap, crash mid-ingest, pruning, favourites surviving a refresh |
| player | Vitest + FakeEngine + fake timers | State machine, zapping races, watchdog ladder, error classifier |
| focus/ui | Vitest + happy-dom + @testing-library/preact | Focus moves in LTR and RTL, virtual-list windows, EPG grid cursor |
| crypto/backend | Vitest + Postgres in Docker | Shared vectors, rate limits, and a "no plaintext" test that searches every DB row and R2 object for the test password |
| e2e | Playwright + mock provider | Full flows driven by remote keys; en/ar screenshots; 4x CPU-throttle smoke run; forced low-tier mode |
| perf | Nightly Node benchmarks + on-device self-test | Parse throughput and memory against thresholds |

**Remote navigation in a desktop browser:**
- **Keyboard mapping (platform-browser):**
  - Arrow keys move focus; Enter is OK; Backspace or Escape is Back.
  - PageUp and PageDown are CH+ and CH−.
  - Digits enter channel numbers; F1–F4 are the colour keys.
  - Space is Play/Pause; `i` is Info; `g` is Guide.
- **`?remote=1`** shows a clickable virtual remote.
- **Playwright `RemoteDriver`** presses Intents and checks `window.__ZOMA_TEST__.focusPath()` (focus IDs from the engine, not the DOM). Viewport is 1920x1080.
- **Magic Remote** is covered by mouse-hover tests.

**Mock provider** (`apps/mock-provider`). It serves only legal open content and doubles as the store test account.
- **Xtream API:**
  - Every `player_api.php` action, plus `xmltv.php`, `get.php?type=m3u_plus`, `/live`, `/movie`, `/series` and `/timeshift`.
  - Configurable `user_info` (Active, Expired, Banned, `max_connections`) and base64 short EPG.
- **Media**, generated by ffmpeg scripts in Docker:
  - `testsrc2`/`smptehdbars` channels with the channel name and clock burned in.
  - Endless TS made by looping pre-encoded segments at real-time speed, plus sliding-window live HLS.
  - Multi-audio (ara/eng/spa tones plus a 5.1 AC3 and E-AC3 track), HEVC 4K, MKV with embedded SRT (ara/eng), MP4 with mov_text.
  - Blender open movies (Big Buck Bunny, Sintel, Tears of Steel, Elephants Dream; CC-BY) for VOD and series, with an attribution page.
- **Fault injection** via YAML scenarios or query flags:
  - 302 redirects and redirect chains; stalls after N seconds with the socket held open.
  - HTTP 401/403/404/509; slow headers.
  - Malformed M3U, BOM/CRLF, invalid UTF-8; gzip XMLTV; odd timezones.
- **LAN log collector:** it receives self-test and spike results from the TVs as JSON that Claude sessions can read. Since Claude can't see the TV, this is how results get back to it.
- **Public deployment** (small VPS, separate test domain, clearly labelled as a test-signal server) gives store testers working Xtream, M3U and EPG credentials with no activation limits. It is never shown or bundled in the app.

**Scale fixtures** (`tools/fixtures`), deterministic and seeded:
- **Catalog:** 200k items (20k live, 120k VOD, 60k episodes) as both M3U and Xtream JSON, with Arabic, English, French and Spanish names, duplicates and malformed lines.
- **XMLTV:** 50, 150 and 300 MB, plus gzip versions (5k channels × 14 days).

**On-device testing:**
- **Self-test runner:** dev builds include one. It injects Intent sequences into the focus engine, runs playback checks against the mock provider, and posts results to the log collector. Playwright can't attach to Chromium 53 over CDP, so this is how repeatable on-device tests work.
- **Release checklist:** a manual checklist per release covers data surviving an update, cold start, 200k ingest, 300 MB EPG, 50 rapid zaps, an 8 h live soak, 4K HEVC, multi-audio, subtitles, pulling the network cable for 30 s, provider auth failures, 50 Home/return cycles, Magic Remote, RTL screens and Voice Guide.

| Tier | Samsung | LG |
|---|---|---|
| Minimum (must own) | 2018 Tizen 4.0, e.g. NU7100 | 2018 webOS 4.x low-end 1 GB, e.g. UK6300 |
| Mid (borrow or later) | 2020 Tizen 5.5, e.g. TU7000 | 2020 webOS 5, e.g. UN7300 |
| Current (must own) | 2023/24 Tizen 7/8 (DTS dropped) | 2023/24 webOS 23/24 (Back goes Home) |
| Emulators | Tizen Studio TV emulator | webOS TV Emulator 4.x + Simulator 22–24 |

Emulators are for syntax and API checks only, never media.

---

## 5. Hardware spikes (weeks 1–2; the four "must own" TVs are needed on day 1)

All spikes run in a "Zoma Lab" build that posts results to the log collector. The results go into `docs/spikes/results.md` and ADRs.

| # | Question | Pass criteria | If it fails |
|---|---|---|---|
| S0 | Can we sideload signed builds onto all 4 TVs with one command? | The hello app shows model, firmware and Chromium version on each TV | Blocker. Fix certificates and Dev Mode before anything else |
| S1 | Does the runtime baseline work on Tizen 4 and webOS 4? (IIFE, polyfills, Preact, Blob worker, `response.body` streaming, TextDecoder, IDB bulk write) | All work | Blob worker fails: use a file worker. No streaming: 2 MB XHR range requests, or lazy per-category Xtream ingest on the low tier |
| S2 | Does storage survive an app update (localStorage, IDB, DB8)? What's the webOS quota? | IDB survives on both; ≥ 200 MB writable | webOS IDB wiped: auto-restore becomes launch-blocking (already planned); DB8 becomes the local mirror if it survives. Re-verify after the first real store update, since a dev reinstall may differ |
| S3 | Are the device IDs available and stable (DUID, LGUDID) across reinstalls? | Available and stable | Use the "Backup code" fallback, which the user photographs |
| S4 | AVPlay battery (2018 and 2023 Samsung) | TS first frame < 2.5 s (< 4 s on 2018), HLS < 4 s. The 302 freeze reproduces without the probe and plays with it. 60 min endless TS: every stall recovered in < 10 s. 4K HEVC VOD plays on 2020+. AC3/E-AC3 5.1 plays. `setSelectTrack` audio switch < 2 s with no restart. Subtitle text callback fires. suspend/restore after Home < 5 s | Stalls not recoverable: shorter watchdog and proactive reconnect, tuned by remote config per model. Track switch broken on a model: per-model flag and honest UI |
| S5 | webOS `<video>` battery (2018 and 2023 LG) | Same matrix, plus audio switch via `audioTracks` or luna `selectTrack`; 302 followed natively; MKV multi-audio | No working track API: ship "audio track not switchable on this TV" for those firmwares, and evaluate the MSE engine for HLS sources only |
| S6 | Scale on the low-end webOS 4 TV | 200k M3U ingest ≤ 90 s with no crash. Key press to focus move < 200 ms during ingest. 150 MB gzipped XMLTV filtered ingest ≤ 4 min. Cached cold start to usable ≤ 3 s. Search ≤ 200 ms | Low tier gets: lazy VOD/series per category, 24 h + 2 day EPG window, no posters in lists. If it still fails, raise the LG minimum to 2019/2020 (product decision) |
| S7 | Can packaged apps make cross-origin `http://` calls (no CORS headers, redirects, `responseURL`)? | Works on both | webOS: build the luna JS service relay (+2 sessions) |
| S8 | Tizen `avplaystore` pre-buffering (investigational) | Two instances prepare at once; switching to the prepared one ≤ 700 ms on 2020+ | Drop pre-buffered zapping from the post-launch list |
| S9 | Arabic text: bundled woff2 font shaping, bidi mixed names, `Intl` with `ar` | Correct rendering | Bundle fonts and own date/number formatters (already planned, so this only confirms) |
| S10 | Input: registering number, CH, colour and media keys; PRE-CH; Magic Remote pointer; Back behaviour; native IME in Arabic | All behave | IME unusable: build our own on-screen keyboard (+2 sessions) |
| S11 | Lifecycle and accessibility: screensaver control; Tizen Voice Guide reading focused `aria-label` on a US-region model | Works | Explicit TTS `speak()` through the adapter on focus change (+1 session before the US submission) |

**Old-engine harness finding for S1 (relay step 2b, 2026-11-02).** Desktop Chromium 53, 56 and 68 deny IndexedDB inside a Blob worker started from a `file://` page ("access to the Indexed Database API is denied in this context"; the Blob worker's origin is opaque). Main-thread IndexedDB works, and so does Blob-worker IndexedDB once file-URL access is granted (`--allow-file-access-from-files`). The TV runtimes load packaged apps from `file://` with file access granted, so the harness runs with that switch. S1 must confirm **IndexedDB inside a Blob worker on the real TVs**. If a TV denies it: give the data workers IndexedDB through a main-thread proxy, or start them from a packaged worker file instead of a Blob. See `docs/runbooks/old-engines.md`.

**The data layer in the harness (relay step 8b, 2026-11-02).** With that switch, the real data workers run as Blob workers from `file://` in Chromium 53, 56 and 68. They prune at start, then stream a 3,000-item playlist over HTTP: plain for the tizen app, and gzipped (through fflate) for the webos app. They write it to IndexedDB in 500-item chunks, swap generations, reload the query worker and search it, and the hit counts are exact (a Latin word, and an Arabic word that matches only through normalization). What S1 still has to show on the TVs is the switch's assumption (Blob-worker IndexedDB from a packaged app) and the speed on real hardware. The harness serves the playlist with CORS headers; whether packaged apps need none is S7.

---

## 6. Phased roadmap

Effort is counted in Claude Code sessions. A session ends only when `pnpm verify` is green (lint, typecheck, tests, both builds, syntax gate, budgets), ROADMAP.md is updated, and there is evidence a non-coder can check: Playwright screenshots in `artifacts/`, a self-test JSON from the TV, or a short on-TV checklist. At 3–4 sessions a week plus your device testing, that is about 16 weeks to submission.

| Phase | Goal | Sessions | Weeks | Exit criteria |
|---|---|---|---|---|
| 0 Foundations | Repo, CI, build pipeline | 2 | 1 | CI green; the hello app installs on all 4 TVs with one command each |
| 1 Lab and spikes | Remove hardware unknowns | 4 | 1–2 | Every spike recorded per device; ADRs updated; plan adjusted |
| 2 Mock provider and fixtures | Test bed and future store test account | 2 | 2 | `pnpm mock` covers every endpoint and fault; fixtures generate in < 2 min |
| 3 Data engine | Ingest, store and query at scale | 5 | 3–4 | 200k on webOS 4 ≤ 90 s with no crash; search ≤ 200 ms; crash-mid-ingest test passes |
| 4 UI shell | Focus, RTL, i18n, onboarding, live list | 5 | 4–5 | Playwright onboarding to live list in en and ar by keys only; smooth list on 2018 TVs |
| 5 Player and live TV | Playback, zapping, recovery | 5 | 6–7 | 50 rapid zaps without a hang; 2 h soak with injected stalls recovers each in ≤ 10 s; launch to last channel ≤ 4 s on 2020+ |
| 6 EPG | Ingest, now/next, grid guide | 4 | 8–9 | 7-day (full) / 3-day (low) grid on a 5k-channel fixture; ≤ 150 ms per key in the grid on 2018 |
| 7 VOD, series, search | Browsing, resume, progress | 4 | 9–10 | Resume accurate to ±5 s; search ≤ 300 ms on 2018 with 200k items |
| 8 Backend | Config, pairing, backup, telemetry | 5 | 10–11 | Phone adds a source with only ciphertext on the server (automated test); webOS reinstall restores automatically; kill-switch reaches the TV within one config refresh |
| 9 Personalization | Favourites, groups, multiple sources, parental, diagnostics | 4 | 12 | Favourites survive a renamed and reordered refresh fixture; profile migration test passes |
| 10 Hardening | Performance, soak, accessibility, localization, store docs | 5 | 13–14 | Release candidate passes the full device checklist; store docs complete |
| 11 Beta and submission | Real users, then the stores | 2 + 4 buffer | 15–16+ | Listings approved; dashboards live |

That totals about 47 sessions plus 4 held back for store QA feedback.

**Session breakdown** (one line each, so ROADMAP.md can list them directly):
- **Phase 0:**
  - **0.1** Workspace, tsconfigs, boundary lint, Vitest, CLAUDE.md, ADR-001..006, GitHub Actions.
  - **0.2** apps/tv hello screen, browser adapter, build-tv pipeline, syntax gate, `.wgt`/`.ipk` packaging, device scripts, LAN watch loader.
- **Phase 1:**
  - **1.1** ffmpeg media set, fault routes and log collector.
  - **1.2** Lab screens for S1–S3, S6, S7 and S9–S11.
  - **1.3** Lab player wrappers and the S4, S5 and S8 batteries.
  - **1.4** You run the batteries on the TVs; Claude analyses the results and writes the ADRs.
- **Phase 2:**
  - **2.1** Full Xtream, M3U and XMLTV emulation with scenarios.
  - **2.2** Fixture generators, Node benchmark harness, Dockerfile and deploy guide.
- **Phase 3:**
  - **3.1** Domain types, ContentKey, normalization, M3U parser.
  - **3.2** Xtream client, JSON splitter, XMLTV tokenizer, catch-up builders.
  - **3.3** IDB schema and migrations, RPC, query worker, search.
  - **3.4** Ingest worker (stream, decode, parse, chunk, swap), throttling, conditional fetch.
  - **3.5** EPG matcher, window and buckets, plus an on-device benchmark.
- **Phase 4:**
  - **4.1** Focus engine, intents, router, platform key, back and pointer handling.
  - **4.2** Tokens, fonts, components, virtual list, RTL CSS, pseudo-locales.
  - **4.3** i18n catalogs (en/ar), plurals, date and digit formatting, no-hard-coded-strings lint.
  - **4.4** Onboarding: language, disclaimer, add source on the TV, validation, load progress.
  - **4.5** Live browse screen, RemoteDriver e2e tests, CPU-throttled check.
- **Phase 5:**
  - **5.1** Controller and FakeEngine tests.
  - **5.2** AvplayEngine and redirect probe.
  - **5.3** Html5Engine and webOS track strategy.
  - **5.4** Watchdog, retry ladder, error classifier and error UI.
  - **5.5** Info bar, zapping, number entry, previous channel, track menu, start on last channel.
- **Phase 6:**
  - **6.1** EPG source management, refresh, now/next, short-EPG fallback.
  - **6.2** Grid guide.
  - **6.3** Programme details, manual matching, match diagnostics.
  - **6.4** Low-tier tuning on the device.
- **Phase 7:**
  - **7.1** Movies: lazy images capped by tier, details, resume.
  - **7.2** Series, progress, continue watching, next episode.
  - **7.3** Global search.
  - **7.4** Home screen and external subtitle renderer.
- **Phase 8:**
  - **8.1** Next.js, Prisma, Neon and R2 skeleton, protocol and crypto packages, Vercel deploy.
  - **8.2** Signed config, `sign-config`, client enforcement and blocklist.
  - **8.3** Pairing API, phone page (en/ar), TV QR screen, file relay.
  - **8.4** Backup and auto-restore.
  - **8.5** Telemetry, scrubber, crash handler, diagnostics code.
- **Phase 9:**
  - **9.1** Favourites lists, hide and reorder groups, channel numbers.
  - **9.2** Multiple sources and merged favourites.
  - **9.3** Parental PIN with adult groups hidden by default (keywords such as XXX, 18+, للكبار), and the full settings set.
  - **9.4** Diagnostics screen, "Test stream" button, help, in-app legal pages.
- **Phase 10:**
  - **10.1** 2018-tier performance and memory pass.
  - **10.2** 8 h soaks, network drops, update-in-place on both platforms.
  - **10.3** Voice Guide/TTS and captions.
  - **10.4** Arabic native review, store texts, test-pattern screenshots, LG UX scenario doc and self-checklist, Samsung tester notes, public test server with uptime monitoring.
  - **10.5** Release engineering and the release checklist script.
- **Phase 11:**
  - **11.1** Closed beta of 10–30 users in GCC and North America.
  - **11.2** Submissions: LG first; Samsung US through Public Seller.

**Business and legal track (runs in parallel; you own it):**

| When | Item |
|---|---|
| Week 0–1 | Pick the publishing company (needed for the Samsung Partner contract and to limit liability). Order the 4 TVs. Open Samsung Seller Office and **submit the Partner application on day 1** (GCC and Canada depend on it); use Public Seller for the US. Open an LG Seller Lounge account under the company. Run trademark clearance for "Zoma" (classes 9, 38, 41, 42) in the US, Canada, UAE and KSA. Register domains and handles |
| Week 2–4 | Engage counsel (US plus one GCC jurisdiction). Draft ToS, privacy policy, in-app and store disclaimers, and a DMCA policy. **Register a DMCA agent** with the US Copyright Office (renews every 3 years). Write the court-order and blocklist runbook. Review privacy obligations under UAE and KSA PDPL, PIPEDA and Quebec Law 25, and check the encryption export self-classification |
| Week 4–8 | File trademarks (US first; Madrid Protocol where available, national filings elsewhere, as counsel advises). Set up a support mailbox and help pages |
| Week 6–12 | Store listing copy in en and ar, screenshots using test patterns only (no real channel logos), age-rating questionnaires |
| Week 12–14 | Legal pages live on the domain and linked in the app. Test server live. Back up the Tizen author certificate and config signing key in two places (password manager plus offline) |
| Week 15+ | Submissions. LG countries: US, AE, SA, KW, QA, BH, OM. Add Canada when fr-CA ships, to satisfy Quebec's French-language requirement. Samsung: US now; GCC and CA after Partner approval |

---

## 7. Post-launch roadmap

| Release | Differentiator | Why it's feasible |
|---|---|---|
| v1.1 | Catch-up from the grid (Xtream `tv_archive`; M3U `catchup` modes) | URL builders are already in core from Phase 3; only the UI is left |
| v1.1 | fr-CA and es-US; Canada listing | The catalogs already exist; this unblocks Quebec |
| v1.1 | Live preview while browsing | AVPlay `setDisplayRect`, or resizing the single webOS `<video>` |
| v1.2 | Pre-buffered zapping on Tizen | Only if S8 passes and `max_connections ≥ 2`; opt-in |
| v1.2 | "Family helper": manage a parent's favourites, groups and settings from a phone anywhere | Reuses the end-to-end pairing channel; a strong fit for the older-user segment |
| v1.2 | USB M3U import on Tizen | Filesystem API for removable storage |
| v1.3 | Optional account with multi-TV sync | End-to-end, with a recovery key |
| v1.3 | Premium tier via store IAP | `Entitlements.has(feature)` exists in core from day 1 and returns free-tier values in v1. Later: Samsung Checkout and LG IAP adapters plus a receipt-verification endpoint. Never put a paywall on basics |
| v2 | Ports | VIDAA reuses the browser adapter (about 4 sessions). Android/Fire TV need a native player wrapper. Apple TV is native Swift reusing only the backend and protocol |

**Not feasible:**
- Multiview or picture-in-picture on webOS (only one `<video>` can play). Tizen-only is possible later as an experiment.
- Recording or DVR (no large media writes, and legal exposure).
- Pause or rewind of live TV without provider catch-up.
- Custom User-Agent or Referer headers on streams.
- RTMP and UDP multicast.
- Playback speed other than 1.0x on webOS.
- DTS on Samsung 2024+ (shown as a clear "this TV can't play this" message).
- Background refresh while the app is closed.
- Any server-side EPG, playlist or logo processing (it would fetch provider URLs).
- Stalker portals.

---

## 8. Top risks and mitigations

| Risk | Mitigation |
|---|---|
| Store rejects or removes the app, as has happened to IPTV players | No content or default lists; disclaimers; adult groups hidden behind a PIN; test-pattern screenshots; a working test server; LG submitted first; complete LG UX doc and checklist; no proxy SDKs; kill-switch and blocklist runbook ready |
| Samsung Partner approval is slow (GCC and Canada) | Apply on day 1; launch LG GCC and Samsung US first |
| webOS update wipes data | Cloud backup with auto-restore from v1; DB8 mirror if S2 passes; profile migrations and snapshots; first-update test via beta |
| 2018 low-end TVs run out of memory or lag | Worker plus chunked IDB; ingest worker killed after use; tier gating; image caps (no server-side resizing is allowed, so caps are client-side); S6 thresholds as release gates; option to raise the LG minimum |
| AVPlay stalls and 302 freezes | Watchdog, retry ladder and learned redirect probe, tuned per model by remote config; 8 h soak gate |
| webOS audio-track switching unreliable | S5 picks the working API; per-language auto-preference; honest UI on firmware where it fails |
| Legal action or court orders | Servers never fetch provider URLs or relay streams; end-to-end relay with short TTL; hashed blocklist and kill-switch; DMCA agent; company entity; counsel review; no piracy-flavoured marketing |
| Loss of the Tizen author certificate or config signing key | Two backups, recorded in a runbook; two embedded config keys for rotation |
| Code quality drifts across ~50 Claude sessions | CLAUDE.md rules, boundary lint, syntax and compat gates, `pnpm verify` as the definition of done, ADRs, one session per ROADMAP checkbox |
| Model fragmentation | Capability telemetry, per-model flags, the device matrix, the self-test runner |
| Provider connection limits or bans triggered by the app | Close before open; no speculative connections unless opted in; probe only until the redirect behaviour is learned; refresh TTLs and conditional fetch |
| Clones and impersonation | Early trademark filings, consistent brand and domain, store takedown requests |
| Arabic and RTL quality | Pseudo-locales in CI, en/ar screenshot tests, a native Arabic reviewer before submission |
| Privacy law (GCC PDPL, Quebec) | Minimal anonymous telemetry, end-to-end backups, counsel review, fr-CA before the Canada listing |

### Critical files for implementation (first to create)
- d:\Claude Code PlayGround\IPTV\CLAUDE.md
- d:\Claude Code PlayGround\IPTV\tools\build\build-tv.ts
- d:\Claude Code PlayGround\IPTV\packages\player\src\engine.ts
- d:\Claude Code PlayGround\IPTV\packages\data\src\idb\schema.ts
- d:\Claude Code PlayGround\IPTV\packages\crypto\src\backup.ts
