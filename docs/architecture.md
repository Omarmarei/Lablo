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
- `info()`: model, model year, firmware, Chromium version, tier (`low` for 2018–19, `full` for 2020+; since ADR-012 only Samsung has 2018–19 sets), locale, country
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
  - Left for step 12, done in 12a (below): isolating the provider's text inside our sentences (FSI/PDI) and the digit forms.
- **The gallery** (`?screen=gallery`, `readScreen` in `data/params.ts`): every component on one 1920x1080 screen inside the safe area, driven by the remote. Its zones are the buttons, a rail of 9 categories (6 shown), 240 channels (7 shown) and 3 × 2 tiles; OK opens a dialog.
  - A small en/ar text table stood in for step 12's catalogs until step 12a moved the gallery onto the runtime; `en-XA` runs the English through `pseudoLocalize`.
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

**Built in step 12a: the i18n runtime, the catalogs and the formats** (`packages/core/src/plural.ts`; `packages/ui/src/i18n`: `message.ts`, `format.ts`, `runtime.ts`; `apps/tv/src/i18n`; [ADR-011](adr/ADR-011-i18n-runtime-and-digits.md)):
- **Plural rules in `core`.** `pluralCategory(language, n)` has CLDR's English (one, other) and Arabic (zero, one, two, few, many, other) rules, written out because Chromium 53 has no `Intl.PluralRules`. `test/i18n-cldr.test.ts` compares them with Node's full ICU on 0–10,000, negatives and fractions.
- **Messages** (`parseMessage`, `formatMessage`): a subset of ICU MessageFormat.
  - `{name}`, `{n, number}`, `{n, plural, =N {…} one {…} … other {…}}` with `#`, and `{x, select, … other {…}}`.
  - No apostrophe quoting, so text can't contain braces. `#` counts only directly in a plural branch, as in ICU.
  - It fits `pseudoLocalize`'s brace rule: en-XA accents the branch texts and keeps the syntax.
  - A broken message shows as written, and a missing argument as `{name}`, so neither throws on a TV.
- **The runtime** (`createI18n(catalogs, locale)` → `I18n`): `t(key, args)`, `number`, `percent`, `time`, `weekday`, `date` (`day`/`full`) and `duration`. One `I18n` per locale; it parses each message once. A missing translation falls back to English.
  - **Text arguments are isolated** between FSI (U+2068) and PDI (U+2069), as Fluent does, so a Latin channel name keeps its direction inside an Arabic sentence. Numbers aren't isolated. Step 12b added the marks the TVs' old engines need (below).
  - en-XA runs the English catalog through `pseudoLocalize`; the arguments stay as they are.
- **Locale settings** (`resolveLocale(tag, { country, digits, hourCycle })`): the catalog language (Arabic, else English), the direction from that language (a Hebrew TV gets English left to right), the region (from the tag, else the TV's country), the digits, the hour cycle and the date order.
- **Formats** (`format.ts`) are ours, not `Intl`'s: the TVs' ICU is old and may be cut down (Chromium 53's CLDR gave ar-SA the Hijri calendar). Gregorian calendar, the TV's time zone.
  - Numbers with grouping and up to 3 fraction digits; percent.
  - Times: 12-hour (`8:05 PM`, `8:05 م`, Canada's `p.m.`) or 24-hour with two-digit hours (`08:05`, en-GB and en-IE).
  - Weekday and month names, a guide's day (`Tue, Nov 3`, `Tue 3 Nov`, `الثلاثاء، 3 نوفمبر`), a full date, and playback durations (`1:13:12`).
  - The CLDR test checks them against Node's ICU for en-US, en-CA, en-GB, ar-AE and ar-SA, ignoring only ICU's bidi marks and narrow spaces.
- **Digits:** Arabic uses Western digits by default (ADR-011, reversible: `DEFAULT_DIGITS`). Arabic-Indic digits (`digits: 'arab'`, with ٬ ٫ ٪) are implemented and tested for a later setting. The provider's numbers are never reshaped.
- **The catalogs** (`apps/tv/src/i18n/en.ts`, `ar.ts`) are TypeScript: `MessageKey` is English's keys, and `ar.ts` is a `Record<MessageKey, string>`, so tsc rejects a missing key. Keys are `area.what` (`gallery.title`, `action.play`, `badge.expires`). `appI18n(locale)` makes the app's runtime.
  - `catalogs.test.ts`: the same keys and arguments in both languages; everything parses, en-XA too; every plural gives all of its language's categories (all six in Arabic); Arabic messages have no Latin words of their own; no placeholder is left unfilled in en, ar or en-XA; no bidi controls in the catalogs.
- **The gallery runs on it.** `gallery-text.ts` is gone. The gallery shows the plural channel count (`240 channels`, `240 قناةً`), the expiry badge (`Expires in 3 days`, `ينتهي خلال 3 أيام`), the percent and the media times from the formatters, and the selected item and the play dialog's channel name are isolated.
- **Size:** main's own code 121.2 → about 130 KB (tizen) of 500, with no new polyfill. `split` (about 2 KB) and `new RegExp` (about 7 KB of core-js) were avoided.
- **Left for step 12b:** the lint against hard-coded strings, the live language switch, and how Chromium 53/56/68 draw the isolates.

**Built in step 12b: the lint, the language switch, and Arabic on the old engines** ([ADR-011](adr/ADR-011-i18n-runtime-and-digits.md), "Isolation on the TVs' engines"):
- **The lint** `zoma/no-hard-coded-text` (a local rule in `eslint.config.js`, no plugin) runs on every `.tsx` in `apps/` and `packages/` except tests.
  - It reports JSX text with letters, and string or template literals with letters in a text prop (`label`, `title`, `subtitle`, `message`, `placeholder`, `nextLabel`, `alt`, `aria-label` and the other ARIA text) or in a child expression, through `?:`, `&&`, `||`, `??` and `+`. A call's arguments aren't text: `t('action.play')` passes.
  - Exempt: an element with `translate="no"` or `translate={false}`, or a bare `data` prop, and everything inside it (the provider's names and technical marks such as `HD`).
  - `test/lint-text.test.ts` lints seeded TSX through the ESLint API: 14 hard-coded forms are caught and 9 allowed forms pass.
  - The hello screen (`App.tsx`, `DataPanel.tsx`, `FocusPanel.tsx`, 29 developer diagnostics) is exempt in `eslint.config.js` until step 13 replaces it. Step 13 removes the exemption.
  - What a lint can't see (a string in a variable) is still caught at run time by the e2e en-XA check: any visible text of ours without the pseudo-locale's brackets.
- **The language switch** is on the gallery for now (there is no settings screen yet). It is a button at the inline end of the actions row (zone `language`, RIGHT from Record): a globe and the other language under its own name (`LANGUAGE_NAMES`: "English" / "العربية", with `lang` and never translated: `Button`'s new `lang` prop).
  - OK (or a Magic Remote click) counts a press in `gallery.languageSwitches`. `GalleryApp` subscribes to it, and on each press swaps the `I18n`, sets `lang` and `dir` on `<html>` and calls `nav.setDir` before the next key is handled. Nothing reloads: the navigator, and with it the focus and the lists' windows, stays as it was.
  - An odd count shows the other language in the TV's region (`switchedTag`: ar-SA ↔ en-SA; en-XA and a tag without a region give the bare language), so the formats keep the region's.
  - e2e: by keys in the dev app and in both TV bundles (the switch is the only way to Arabic there, since the TV adapters take `navigator.language`). They check `html[dir]`, `lang`, the catalog, the mirrored positions, the focus staying on the switch, the mirrored LEFT/RIGHT, and no reload.
- **Arabic on Chromium 53, 56 and 68.** The old-engine harness now switches every gallery run to Arabic by keys (ArrowUp ×3, ArrowRight ×4, Enter), then checks the switch, the focus, the same layout (7 rows of 88 px, everything in the safe area, nothing cut, no scrolling), the mirror (the channel list on the right), the plural `240 قناةً` and the fonts. It saves a second screenshot (`gallery-<engine>-<platform>-ar.png`). All of it passed on the first run.
- **Finding: the old engines ignore bidi isolates.** Chromium 53, 56 and 68 draw FSI/PDI at zero width (no tofu), but treat them as if they weren't there. In an RTL line, a Latin name ending in a digit followed by a count (`MBC 1 · 240 قناة`) joined the count to its run (rule W7), and a name starting with a digit (`1 Zoma`) split, exactly as without isolates. Current Chromium (156) isolates correctly. The harness measures this with `Range` rects in the gallery's font.
  - They honour LRM and RLM. So `isolateText` (now in `core/src/bidi.ts`) wraps each text argument as `outer + inner + FSI + text + PDI + inner + outer`. `inner` is the text's first-strong direction and `outer` is the sentence's.
  - With the inner mark inside the isolate, Chromium 53 still split the leading digit. Placed outside, both lines are right on 53, 56, 68 and current Chromium, and nothing is wider.
  - `firstStrongDirection` approximates the UAX #9 classes with code-point ranges (no RegExp in TV code). A test sweeps every BMP letter against its Unicode script; letterlike symbols and CJK punctuation-block letters count as neutral.
  - The harness's bidi probe builds its lines with the real `isolateText`. Each check has a control without isolation, which must show the problem, so the probe can't pass vacuously. e2e runs the same probe in current Chromium.
- **Size:** main's own code about 130 → 132.0 KB (tizen) of 500, with no new polyfill.

**Built in step 13a: onboarding's flow and text input on a TV** (`packages/ui/src/focus/text-editor.ts`, `components/TextField.tsx`; `Platform.textKey` and `onSoftKeyboard`; `apps/tv/src/onboarding`):
- **Text input (decision).** The focus engine never uses DOM focus, but a native `<input>` needs it: DOM focus is what opens the TV's on-screen keyboard (the Tizen IME, the webOS virtual keyboard, Arabic included). We keep native inputs and hand DOM focus over only while a field is edited. Our own on-screen keyboard is the fallback if spike S10 finds the IME unusable (§5, +2 sessions).
  - A `TextField` is an item of a zone like any other: the engine focuses it with a class. OK (or a click) calls `TextEditor.open(id)`, which focuses its input. Keys aimed at an editable element are the field's: `connectRemote` ignores them (`isEditable`), so Backspace deletes on the desktop, though it is Back elsewhere.
  - The input's own key handler ends the edit on the platform's text keys (`Platform.textKey` → `done`, `close`, `up`, `down`). `done` and `down` move the engine's focus down, to the next field or the buttons; `up` moves it up; `close` keeps it. The input is blurred, and the typed text is always kept: a stray Back must never throw away a URL typed on a remote.
  - Per platform: the desktop maps Enter, Escape and the vertical arrows. Tizen maps 13, the IME's Done (65376) and Cancel (65385), Back (10009) and the arrows. webOS maps 13, Back (461) and the arrows.
  - The edit also ends on a blur from elsewhere, and when the platform says its keyboard hid (webOS `keyboardStateChange`, `Platform.onSoftKeyboard`). Otherwise the arrows would move the caret of a field nobody sees.
  - A Magic Remote OK sends a click and key 13 (step 11b). When the click opens a field, its twin key 13 reaches the input as `done`. One that comes within `OK_CLICK_WINDOW_MS` of the open, with nothing typed yet, is the same press and is ignored.
  - Links, logins and passwords are `dir="ltr"` islands; a name is `dir="auto"`. The box's text-align is mirrored with the page, so a link sits on the label's side in Arabic and still reads left to right.
  - The inputs are out of Tab (`tabIndex -1`), with no spellcheck, autocomplete or autocapitalize.
  - **What the harness can't check:** whether the TVs open their keyboards on a programmatic `focus()`, which keys they send while it is up, and Arabic input. That is spike S10 on the real TVs (step 16). The key codes come from Samsung's and LG's documentation.
- **The start screen.** Onboarding opens by default (`readScreen`). The hello screen is now a developer screen behind `?screen=hello`: the old-engine harness's data runs and the hello e2e add it.
  - Its English diagnostics stay out of the catalogs, and its lint exemption stays, narrowed to its three files with a new reason. The e2e tests and the harness read that text, in its Arabic-locale runs too, and no user can reach the screen on a TV.
- **The flow** (`onboarding-state.ts`), on the router's back stack. Back goes one screen back; on the first screen it follows `rootBackPolicy`.
  1. Language: both languages' own words, the TV's language first and focused. Picking one switches the catalog, `<html lang/dir>` and `nav.setDir` live, in the TV's region (the gallery's pattern, step 12b).
  2. Disclaimer: "Zoma provides no content", and the user is responsible for what they add (PLAN line 246).
  3. Device-ID consent: what the ID is for (encrypting the backup; it never leaves the TV) and the backup disclosure (on by default, encrypted on the TV, off or without logins in Settings, §3.3 B). It is shown on both platforms. "Not now" means Settings shows a backup code instead. Step 13b saves the answer in the profile, and step 32 reads the ID only after "Allow".
  4. Source type: an Xtream login or an M3U link (the phone pairing comes at step 31).
  5. The form: Xtream (server, username, password) or M3U (playlist link), plus an optional guide link and name on both. "Add source" checks it on the TV first (`checkForm`): required fields, and links that are http(s) addresses without spaces or a login in them (`http://` is assumed when no scheme is typed). The server goes through core's `normalizeXtreamBase`, logins are trimmed, and a missing name becomes the host. A refused field shows its problem under the box and takes the focus.
  6. Loading: phase, item count and a bar (bytes of the size when the server sent one). Cancel and Back stop it. On failure, a message per `LoadErrorCode` and "Edit details" / "Try again".
  7. Done: the counts. It becomes the new root (`nav.reset`), so Back no longer goes into onboarding.
  - Step 13a loads through `createFakeLoader` (no network; 1,240 channels, 380 films, 45 series). Step 13b replaces it with the data engine against the provider, saves the answers and the source in the profile, and skips onboarding when a source exists. Until the live screen (step 14), "Start watching" opens the hello screen.
- **Text:** about 50 new catalog strings. Brand and format names (Xtream, M3U, XMLTV, `http://`) are arguments, so the runtime isolates them in Arabic and the Arabic catalog holds no Latin of its own.
- **Size:** main's own code 132.0 → 161.9 KB (tizen) of 500, with no new polyfill. Onboarding is about 16 KB of that, and the new catalog strings most of the rest.
  - Terser writes main.js `ascii_only`, so each Arabic character costs 6 bytes (`\uXXXX`): about 2,000 Arabic characters made 12 KB. If the catalogs grow much, ship them as a UTF-8 file instead.
- **Tests:** the text keys per adapter; `isEditable` and `connectRemote` ignoring a field's keys; the editor (open, every way to end, the click twin, a blur, the hidden keyboard, switching fields); `TextField` at VNode level; the form checks (with fast-check); the flow by keys with the fake loader (Back through every screen, the root policies, failure, retry, cancel, stale answers).
  - e2e `onboarding.spec.ts`, by keys only: the whole flow in English and in Arabic, typing on the keyboard, a refused guide link fixed with Backspace, an Arabic name. Also the live language switch, Back through every screen, the caret keys staying in a field, a click and its twin key, and the en-XA check on every screen.
  - Every screen inside the safe area, with screenshots in en, ar and en-XA (`artifacts/screenshots/onboarding-*.png`).
  - `tv-bundle.spec.ts`: both bundles start on onboarding from `file://` and type into a field by key codes.

**Built in step 13b: onboarding against the provider, saved in the profile** (`apps/tv/src/onboarding/engine-loader.ts`, `start.ts`, `main.tsx`; profile version 2 in `packages/data/src/profile.ts`; `profile` and `editProfile` in `query-service.ts`; core `xtreamAccountProblem`):
- **The loader** (`createEngineLoader`) replaces the fake one in the app; the fake stays for the unit tests.
  1. `checking`: the source gets its id. Ids are `s1`, `s2`… (`nextSourceId`): one past the highest id in the profile or in the catalog stores, so an id is never reused, not even one whose catalog a crash left without a profile entry. They are short on purpose, because every ContentKey carries one (ADR-009).
  2. `download` and `saving`: `DataEngine.refresh` in a fresh ingest worker, its `IngestProgress` mapped (`commit` is `saving`).
  3. `guide`: `refreshEpg` with `due`, listing every stored source's guides plus the new one's and the guide link typed in the form (a `UserGuide`, read first). Listing them all matters: a guide no longer listed is deleted. A guide that fails doesn't fail the source; the EPG refresh keeps its failure and retries later.
  4. The source goes into the profile (`editProfile`), then the counts show.
  - Cancel and Back cancel the refresh in its worker (`CancelSource` from `@zoma/data/client`, which exports it so main never imports the package index). A cancelled load never settles, and the next load waits until the cancelled one has let go of the refresh slot.
- **The Xtream account check is the ingest's first step**, so it needs no extra request and no Xtream code in main. A refused login is `auth` (the panel's `auth: 0`, or HTTP 401/403). A login the panel accepts whose `user_info.status` is `Expired` is `expired`; `Banned` or `Disabled` is `blocked` (new `IngestErrorCode`s, core `xtreamAccountProblem`). Panels let such accounts in but serve them empty lists, so without the check they showed as `empty`. Only the status decides: an `Active` account whose `exp_date` has passed still loads, because panels update it late or write it in another zone.
- **Errors across the worker boundary:** the RPC wire now carries a numeric `status`, so `RpcError.status` gives "error 404" its number. `loadError` maps the ingest's codes to the loader's: `superseded`, a worker that died and anything unknown are `other`. New messages: `error.blocked` and `loading.guide`.
- **Saved state:** profile version 2 adds `sources` (`SourceRecord`: id, type, name, the Xtream account or the M3U link, the guide link, when added) and `onboarding` (`language`, `disclaimerAt`, `consent`). The login is stored in IndexedDB only, in plain text until step 32 encrypts it with `localKey`.
  - The query worker serves it: `profile` (upgrades an older document in place, like every load) and `editProfile`, a read-modify-write in one transaction like the ingest worker's favourites update, so neither can lose the other's write. `updateProfile` gained `create`: onboarding's first answer creates the profile, a refresh never does. A profile from a newer app version is shown and never written.
  - Each answer is saved as it is given (`OnboardingOptions.answer`), so a relaunch before the source is added comes back in the language picked, with that language focused.
- **The start** (`main.tsx`, `start.ts`): the app asks the query worker for the profile before it picks a screen, behind a spinner. With a source stored it skips onboarding (to the hello screen until step 14's live screen). Without one, or when the profile can't be read within 10 s (no IndexedDB, a failed worker), onboarding starts. `?screen=hello` and `?screen=gallery` don't read the profile. One `DataEngine` is shared by every screen.
- **Size:** main's own code 161.9 → 166.3 KB (tizen) of 500, no new polyfill (219 core-js modules before and after). The query worker 89.8 → 96.2 KB of 150: `profile.ts` came with `es.json.stringify` (its migration copies through JSON; the ingest worker had it already).
- **Tests:** the profile's shapes pinned for both versions (with the real migration, `create`, `applyProfileEdit`); `profile`/`editProfile` over RPC; the account states against the mock (`test/ingest-mock.test.ts`); `RpcError.status`; the loader with a fake engine (phases, ids, guide listing, every error, a guide failure, cancel in each phase, the slot hand-over); `start.ts`; the answers in `onboarding-state.test.ts`.
  - `test/onboarding-loader-mock.test.ts`: the loader on the real services over message channels against the mock over a socket: the mock's counts, the panel's guide read and matched, the profile entry, a second source as `s2`, and each failure's code (wrong password, expired, banned, disabled, HTTP 404 with its status, a refused M3U login, no server).
  - e2e `onboarding.spec.ts` against the mock (in-process, its test logins from its fixtures): the whole flow in English and Arabic by keys, with the phases seen (download, guide), the mock's counts, the saved profile read back from IndexedDB, and a relaunch that skips onboarding; a wrong password in both languages with "Edit details" keeping the form and the fixed login loading; the banned and expired messages and "Try again"; the language back after a relaunch mid-onboarding. `tv-bundle.spec.ts`: both bundles add the mock's playlist from `file://` and skip onboarding on a relaunch. Screenshots `onboarding-{en-US,ar-SA}-failed.png` added; the Arabic done and failed screens looked at.

**Built in step 13c: onboarding on Chromium 53/56/68** (`tools/engines/src/onboarding.ts`; the walk seeds in `tools/engines/src/variants.ts`; [runbook](runbooks/old-engines.md) "How a run works", item 6):
- **The walk.** In each old engine the harness opens what a TV opens (no `?screen=`) in both bundles and walks onboarding by keys only, once in English and once in Arabic:
  - language (English is the engine's own and comes focused; ArrowRight to العربية switches the page to `dir="rtl"`), disclaimer, consent (the row is mirrored in Arabic), the M3U link, the form;
  - OK on the playlist field must give its input DOM focus;
  - the fixture playlist's link is typed without `http://` (the form adds it); Backspace deletes in the field, and OK ends the edit and moves on;
  - "Add source" loads through the real data workers, and the done screen shows the fixture's 2,400 channels and 600 films;
  - the profile read back from IndexedDB holds `s1`, named after the host, with the language and the consent;
  - "Start watching" opens the hello screen, and a relaunch skips onboarding.
  - Each screen is measured as in the e2e test (1920x1080, the safe area, no label cut), and the form and done screens are saved per engine, platform and language.
- **Typing in an old engine:** CDP `Input.insertText` doesn't exist in Chromium 53, so the harness types `Input.dispatchKeyEvent` `char` events, one per character, on all three engines. They reach the focused input as text (keypress and input events, no keydown), the way an IME's text does. Whether the real TVs' keyboards open on a programmatic `focus()`, and which keys they send, is still spike S10.
- **A fresh start per walk:** the containers keep their storage between runs, so the harness deletes the `zoma` database from a blank page of the same `file://` origin (`file:///app/blank.html`) before each walk and after the last, while no app page holds it open. The data workers' database is the page's: the delete reaches it.
- **The profile wait at the start (step 13b's riskiest change), measured 2026-11-03 with an empty database:** 0.1–0.2 s from the navigation to the first screen on Chromium 53, 56 and 68. The relaunch with a source stored reaches the hello screen in 0.2 s, and the 3,000-item fixture with its guide loads in about 2 s (0.8 s on Chromium 68). That is on a desktop CPU and disk; a 2018 TV's eMMC and CPU are slower, which spikes S1 and S6 measure on the sets.
- **Found:** nothing in the app needed a change. Every check passed in both languages on all three engines on the first local run.
  - On CI, Chromium 53 once left the harness's `deleteDatabase` with no answer at all for 10 s. The walk had left the relaunched hello screen 0.2 s after it showed, while its data workers were most likely still opening the database. The walk now waits for the hello screen's data panel to finish first.
  - A TV app never deletes its database. But if a worker killed in the middle of IndexedDB work can stall the next request on that engine, an app closed while loading could hit it too. Spike S1 should try it on the sets.
- **Seeds:** two TV faults prepended to the built `main.js`, which must fail the walk on every engine. `focus()` that does nothing (a keyboard that never opens) stops it at the playlist field. A database deleted at every start (a TV that keeps nothing between launches) stops it at the relaunch. Both are plain ES5, so only the walk can catch them. The self-test is now 72 runs, 50 of them seeded failures.

**Built in step 14a: the live screen** (`apps/tv/src/live`: `channel-index.ts`, `live-state.ts`, `LiveApp.tsx`, `live.css`; `DataEngine.categories` and `chunk`):
- **Layout** (1920x1080, inside the safe area, sizes from `LIVE` in `live-state.ts`, never measured):
  - a header: "Live TV", the category on show with its channel count, and the clock (the minute tick);
  - the rail at the inline start (440 px, 12 chips of 64 px shown);
  - the channel list (9 rows of 88 px shown).
  - In Arabic the rail is on the right. A provider's names keep their own direction (`dir="auto"`) but start on the screen's side, in the rail as in the list.
- **The rail (decision):** a vertical column of `Chip`s at the inline start, not the gallery's horizontal rail. Providers' category names are long ("AR | MBC Group HD"), and panels often have hundreds of categories, so a column shows 12 whole names with their counts.
  - It lists "All channels" first, then each stored source's live categories with channels, source by source, in the provider's order.
  - A group with no name is "Other channels".
  - OK shows a category and moves to the list's top. Moving through the rail reads nothing.
- **The list:** a `ChannelIndex` turns row `n` into (source, category, chunk, slot) by binary search over the categories' start rows. The screen reads only the chunks of the rows from one window above to one below (`chunk`), keeps at most 8 (least recently used first), and the query worker keeps its own 16.
  - A row whose chunk is still on its way is an empty row of the same height. A failed read is asked again when the window moves.
  - A channel's number is the provider's (`tvg-chno`, Xtream `num`), else its place in "All channels".
- **Now/next:** `nowNext` for the rows on show, 200 ms after the window rests (scrolling asks nothing). It is asked again on the minute tick once a row's programme has ended, and after 5 minutes otherwise.
  - The row shows the programme on now with its start time and a bar, and the next one. A channel without a guide says "No guide for this channel".
  - The focused channel goes to `focusChannel`, the short-EPG fallback of step 9c, after 600 ms. A panel's answer for a channel no guide matches shows on its row.
- **Keys:** LEFT and RIGHT go between the rail and the list (mirrored in Arabic). CH+ and CH− page the list by a window. Back in the list goes to the rail, on the category on show. Back on the rail follows `rootBackPolicy` (an exit dialog on Tizen and in the browser, the launcher on webOS). OK on a channel only marks it (`data-selected`); the player opens it from step 20 on. Keys reach `DataEngine.noteActivity`, so a running refresh pauses.
- **States:** a spinner while the profile and the categories load; "Your sources have no live channels."; and a failed read with "Try again".
- **Stale answers:** a reload, or the screen going away, drops what is still on its way: chunks, now/next, the focus's answer.
- **Idle:** `pending` counts the data requests in flight, the focus's 600 ms wait included, and the screen writes it as `data-pending`. The old-engine walk leaves the live screen only at `0` (step 13c's lesson: a page left while its workers were in IndexedDB stalled the next delete on Chromium 53).
- **In the app:** the live screen replaces the hello screen after "Start watching" and at a start with a stored source (`?screen=hello` stays a developer screen). It shows in the language picked in onboarding (the profile's), in the TV's region.
- **Size:** main's own code 166.3 → 178.0 KB (tizen) of 500, with no new polyfill (219 core-js modules before and after).
  - A field named `at` (when a row's now/next was asked) pulled in core-js's `Array.prototype.at` and `String.prototype.at` again. It is named `asked` now.
- **Tests:**
  - `channel-index.test.ts`: the addresses across sources, categories and chunks, empty categories, and fast-check against the flattened list.
  - `live-state.test.ts` (fake engine, hand-run timers): the rail, the window's chunk reads and the cache limit, now/next after the rest and again on the tick and after 5 minutes, a category by OK with its numbers, Back, the root policies, the RTL swap, the focus's short EPG through its source, `pending`, and answers dropped after a reload or after disposal. Also a failed read with "Try again", a failed chunk, and no live channels.
  - e2e `live.spec.ts` against the mock (an Xtream login added by keys in onboarding), with the mock on the real clock so its guide covers the browser's now. In en and ar: the 6 categories and their counts; the 12 channels with the panel's numbers in category order; now/next checked against the mock's own schedule (the 18+ channel has none); paging to the end; the kids' category; Back; the exit dialog; the mirror; the layout; the fonts; and a relaunch in the language picked. In en-XA: every string of ours is bracketed (the formatter's times aside).
  - `onboarding.spec.ts` and `tv-bundle.spec.ts`: "Start watching" and the relaunch open the live screen, from `file://` too.
  - Screenshots `live-{en-US,ar-SA,en-XA}.png` and `-category.png`, the Arabic ones looked at.
- **On Chromium 53/56/68:** the onboarding walk now ends on the live screen. It must be on `live · channels 0` in the walk's language, list the fixture's 2,400 channels, and be idle, both after "Start watching" and after the relaunch. A screenshot of it is saved per engine, platform and language. The live screen's own checks there (keys, layout, now/next) are step 14c.
- **Built in step 14b** (§4): `RemoteDriver` and `window.__ZOMA_TEST__.focusPath()`, and the 4x CPU-throttled and low-tier runs on a 20,000-channel catalog.
- **Built in step 14c** (§4): the live screen by the TVs' own keys on Chromium 53/56/68, both bundles, English and Arabic.

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
- **The profile document** is versioned on its own (`profile.ts`, version 1 = favourites; version 2, step 13b, adds the sources and the onboarding answers). Older documents are upgraded on load, and the old copy goes to a snapshot. A save snapshots the replaced document at most once a day, into 3 rolling slots, and a restore can itself be undone. A document from a newer app version is shown but never overwritten.

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
      - The hello screen's catalog panel drives it: `?q=<words>`, `?force=1` and `?source=<playlist URL>` as the last parameter. Since step 13a, onboarding is the start screen and the hello screen a developer screen, so these come after `?screen=hello`.
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
  load(source: EngineSource, token: number, opts?: { startMs?: number }): Promise<void>;  // one URL: the controller picks it
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
export type EngineSource = { url: string; container: Container; live: boolean };
export type Container = 'ts'|'hls'|'mp4'|'mkv'|'other';
// packages/player/src/request.ts
export type PlayRequest = { key: ContentKey; src: string; mode: 'live'|'vod'|'catchup';
  candidates: { url: string; container: Container }[];  // ordered fallbacks (streamCandidates)
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

**Built in step 17: PlayerController** (`packages/player/src`: `engine.ts`, `request.ts`, `failure.ts`, `ladder.ts`, `clock.ts`, `controller.ts`; the test doubles in `fake-engine.ts`, not exported):
- **Changes to the sketch above:**
  - `load` takes one `EngineSource` (URL, container, live), not the whole request: the controller owns the list of URLs and the order it tries them in.
  - `PlayRequest` gained `src`, the source id, because the URL strategy is remembered per source. Reading it out of the ContentKey would need `parseContentKey`, whose file brings core-js's `JSON.stringify` polyfill into the TV bundle (step 9c).
  - `Container` gained `'other'`, for URLs whose path names no known container. `preload` waits for pre-buffered zapping (S8, Samsung).
  - Engine errors are a `PlaybackError`: a kind (`network`, `http` with a status, `timeout`, `stall`, `unsupported`, `decode`, `app`) and the engine's own code for support. `load` rejects with one when the source can't be opened; later failures arrive as `error` events.
- **Session tokens and close-before-open:** every `load` gets the next token, and the controller keeps the one whose events count (0 between loads). It drops every other event, every late `load` result, and every probe answer that arrives after a newer `play`, `stop` or retry.
  - Before every load it awaits `engine.stop()`. A stop already under way is joined, not overtaken, so a zap never loads while the previous connection is still closing, even when an engine's second `stop()` returns at once.
  - Zaps that arrive while a stop runs are skipped: only the newest loads.
- **The URL strategy** (`streamCandidates`, `orderCandidates`, `SourceMemory`):
  - An Xtream live URL (`/live/u/p/1.ts`, its `.m3u8` form, or the short `/u/p/1`) gives the `.ts` form, then the `.m3u8` form, keeping only what `allowed_output_formats` allows when it names either. The playlist's own spelling is kept for its own container. Anything else plays as it is.
  - When a request has more than one URL, the container that showed a frame is remembered for its source, and that source's next requests try it first. A single-URL play (VOD) never changes it.
  - `MemorySourceMemory` keeps it for the app's run. Keeping it in the profile is step 20's wiring.
- **The watchdog** (`DEFAULT_WATCHDOG`, all tunable per model):
  - It reads `positionMs()` every 500 ms from the first frame.
  - **Live:** a stall when the position hasn't moved for 6 s while playing, or after 12 s of buffering. The frozen rule doesn't run while buffering, and both rules count again from a `playing` event or a resume.
  - **VOD and catch-up:** after 20 s of buffering only.
  - **No first frame within 10 s** of an attempt is an open timeout. The LG TV's three-302 chain took up to 4.1 s (docs/spikes/results.md).
  - It rests while paused and after a VOD's end. A live stream that ends is a stall.
- **The retry ladder** (`RetryLadder`):
  - While nothing has played on the current URL, the next untried URL goes first, at once.
  - Otherwise, from the first rung: reopen, re-probe (only where a `resolveUrl` probe is configured, Tizen in step 19), switch container (only with a second URL), then reopen after 1, 2 and 4 s (the last repeats).
  - A **definitive** error (`unsupported`, or HTTP 4xx other than 408 and 429) only tries untried URLs.
  - A frame on the screen starts the ladder again from its first rung, but attempts keep counting: the controller gives up when 4 attempts were made within the last 60 s.
  - Live reopens at the live edge; VOD and catch-up reopen at the last position the watchdog saw (or the requested start, before anything played).
  - The state is `opening` until the session's first frame, and `reconnecting` (the badge) for retries after it.
- **The error classifier** (`classifyFailure`), on giving up:
  - The order: offline is `internet` (`NET-OFFLINE`); `app` errors are `app` (`APP-ERROR`); then the account re-check: `PRV-AUTH`, `PRV-EXPIRED`, `PRV-BLOCKED`, `PRV-MAX-CONNECTIONS`; then `unsupported` is `device` (`TV-UNSUPPORTED`); everything else is `provider` (`PRV-HTTP-<status>`, `PRV-UNREACHABLE`, `PRV-TIMEOUT`, `PRV-STALLED`, `PRV-BAD-STREAM`).
  - The account is re-checked (`checkAccount`, the app's Xtream `player_api.php` call) after `provider` and `device` verdicts. Account problems come before `unsupported` because panels answer an expired account with an error page or an "expired" clip, which a `<video>` reports as an unsupported format.
  - The failure carries the engine's own code (`detail`) and the account's answer for the error card. A verdict that arrives after a zap is dropped.
- **Dependencies are callbacks** (ADR-008): `clock`, `memory`, `config`, `online` (the app's connectivity check; default: online), `checkAccount` and `resolveUrl`.
- **Not in step 17:** the engines (18, 19), debounced zapping, number entry and previous channel (20), tracks and language preferences (18, 20), subtitles (20), the lifecycle and the screensaver (18, 19), start-on-last-channel (20), and seeking (VOD, phase 7).
- **Tests:** 62 in `packages/player` (the URL strategy, the classifier, the ladder, and the controller on `FakeEngine` and `FakeClock`).
  - The engine counts open connections, and a stop closes its connection `stopMs` after it is called, so a load during a closing stop shows up as two connections at once.
  - The zapping races: three zaps in one stop, stale events from a leaky engine, a zap while the probe or a retry waits, a verdict that arrives after a zap, and 50 seeded random zaps. In every one, a connection is closed before the next opens and only the newest request ever shows as playing.
  - Mutation check: 77/77 mutants caught. The first run's four survivors were three test gaps (a zap while the old load is still pending, a timer left running while paused, the playlist's spelling of a URL) and one equivalent mutant, replaced.
- **TV bundle:** bundled beside `main.tsx` (a probe; the app wires the player in step 20), the player adds about 10.3 KB minified to main on both platforms, with the same 219 core-js modules.

**Built in step 18: Html5Engine** (`packages/player/src/html5-engine.ts`; the factory in `platform-api` and the adapters; the playback harness `apps/tv/playback.html`):
- **The factory (ADR-008):** `Platform.createEngines(stage)` (`EngineFactory`) returns the platform's engines, best first. `stage` is the app's player layer; `createStageVideo(stage)` puts the one app-wide `<video>` in it (inline, filling the stage; `setRect` moves it). webOS and the desktop return one `Html5Engine` (desktop Chromium plays HLS natively, so the dev build needs no hls.js); Tizen returns it too until AVPlay comes first in step 19. The app calls it in step 20; until then the engine is in both TV bundles but unused (about 7 KB minified, no new core-js module).
- **The first frame:** the first moment after `playing` that the element has a picture size and its clock has moved, polled every 50 ms (the lab's S5 rule). A stream that plays sound with no picture for 5 s of media fails as `unsupported`/`NO_PICTURE`: a video codec the TV can't decode (HEVC in headless desktop Chromium) is then "this TV can't play this", not a provider timeout. Audio-only streams (radio) need a request hint first (step 37).
- **Errors:** `MEDIA_ERR_DECODE` is `decode`; `MEDIA_ERR_NETWORK` and `MEDIA_ERR_ABORTED` are `network`. `MEDIA_ERR_SRC_NOT_SUPPORTED` is `unsupported` only when the element answers `canPlayType` '' for the container, and only for containers whose answer can be trusted (`CONTAINER_MIME`: TS, HLS, MP4). The LG TV answers '' for `video/x-matroska` and plays MKV, so MKV and `other` are `network` (retried), as are HTTP errors and panels' error pages, which look the same.
- **Loads and stop:** `load` points the element at the URL and calls `play()`; it resolves at the first `playing` and rejects with the error that comes before it (later errors are `error` events). `stop()` pauses, removes `src` and calls `load()`, which closes the connection; a pending `load` rejects with `app`/`ABORTED`. Events of a stopped or replaced load are dropped by the engine too. VOD and catch-up start at `startMs` once the metadata is in.
- **Tracks (S5's strategy):** audio through the element's `audioTracks` (the new track on before the others go off; 154–205 ms with no restart on the LG TV). Where the element has no list or ignores the switch, the platform's service by the element's `mediaId`: webOS passes luna `selectTrack`, a fallback only (ADR-012, not in LG's ACG table). `caps.trackSwitch` says which: `reliable` (`audioTracks`), `unreliable` (the service only) or `none` (desktop Chromium without its Blink flag). Text tracks are the element's own, drawn by the TV; the LG TV listed none for in-band SRT or mov_text, so the overlay (step 20) parses its own.
- **Lifecycle:** `suspend()` closes the connection and `resume()` reopens the same URL, live at the live edge and VOD where it was, with a new first frame. The controller's side of the lifecycle (resting the watchdog while hidden) is step 20's wiring.
- **Autoplay:** a desktop browser may refuse sound before a key press (`NotAllowedError`); the engine then plays muted. TVs don't refuse.
- **A change to step 17's ladder,** found by the first real-browser run: a URL that failed definitively stays out of the session's switch rung. On the desktop `.ts` is unsupported; when `.m3u8` then timed out, the switch went back to `.ts`, spent an attempt, and its "unsupported" became the verdict ("this TV can't play this") although the provider's HLS was at fault.
- **The playback harness:** `apps/tv/playback.html` (Vite only; the TV builds have just the app and lab entries) hands the browser platform's engines to a `PlayerController` and exposes `window.__ZOMA_PLAYBACK__` (`play`, `stop`, `snapshot` with the status history and the engine's trace, `selectAudio`, `canPlayType`).
- **Tests:**
  - 48 unit tests on a fake `<video>` (`fake-video.ts`) that keeps state changes and their events apart in time, one of them with the controller (`.ts` unsupported, `.m3u8` plays and is remembered); the adapters' factories; the ladder's dead-URL rule. Mutation check: 68/68 caught. The first run's six survivors were five test gaps (bad track ids on the service-only path, an old engine's `play()` returning nothing, a refusal other than `NotAllowedError`) and one equivalent mutant (a second `suspend`), replaced.
  - `e2e/playback.spec.ts` (`pnpm e2e`): a channel the panel lacks fails in about 3 s as the provider's fault, never the TV's.
  - `e2e/playback-media.spec.ts` (`pnpm e2e:media`, in `pnpm verify:media`, CI job `media`): live (TS refused, HLS at once and remembered), VOD from 20 s with its connection closed on stop, Xtream catch-up as HLS, the MKV's three AAC tracks switched without a restart, and 4K HEVC (no picture headless) failing as `TV-UNSUPPORTED`/`NO_PICTURE` without a retry.

**Built in step 19: AvplayEngine** (`packages/platform-tizen/src/avplay-engine.ts` and `redirect-probe.ts`; `FallbackEngine` in `packages/player/src/fallback-engine.ts`; the controller's `screenSaver`). No Samsung TV has run any of it yet (step 19b):
- **The Tizen factory:** `createEngines(stage)` gives one `FallbackEngine`: `AvplayEngine` first, and `Html5Engine` for an HLS URL that AVPlay refuses as unsupported (`hlsRefused`). Which AVPlay errors really call for the `<video>` is the TV's answer (step 21), so the rule is a constructor option.
  - AVPlay's `<object type="application/avplayer">` (`createAvplayPlane`) and the `<video>` both fill the stage. The `<video>` is hidden while AVPlay plays, because its black background would cover AVPlay's plane. The player route's transparent `html` and `body` come with the route (step 20).
  - Without `webapis.avplay` (a desktop browser, the old-engine harness) the factory gives `Html5Engine` alone.
- **`FallbackEngine`** (in `player`, for any two engines): the fallback gets the same source, token and start within the same `load()`, after the primary's `stop()`. Only the active engine's events go out. A stop or a newer load during the switch rejects the old load with `app`/`ABORTED`. `onActive` tells the platform which engine shows its picture. `stop()` stops both, and `setRect` goes to both.
- **AvplayEngine:**
  - **Open:** `open`, `setListener`, `setDisplayRect` (the rect `setRect` gave, in AVPlay's 1920×1080 space), `prepareAsync`, then `play`. `load()` resolves at `play` and rejects with the error that comes before it.
  - **First frame:** the clock moving while `PLAYING`, as in the lab's S4 player: two readings 50 ms apart, or two `oncurrentplaytime` calls, that differ. A VOD's start position is a `seekTo` after `play`, and the jump itself is no frame.
  - **The 302 freeze:** a prepare that hasn't answered in 8 s fails as `timeout`/`PREPARE_TIMEOUT`. The ladder's re-probe rung then runs the probe afresh.
  - **Errors** (`avplayError`; the name stays the code):
    - `PLAYER_ERROR_NOT_SUPPORTED_*` is `unsupported`;
    - `PLAYER_ERROR_GENEREIC` (Samsung's spelling) is `decode`;
    - `PLAYER_ERROR_INVALID_*`, `PLAYER_ERROR_SEEK_FAILED` and the exceptions a wrong call throws (`InvalidStateError`, `InvalidValuesError`, `TypeMismatchError`, `TypeError`) are `app`;
    - everything else is `network`, retried and the provider's fault: `PLAYER_ERROR_CONNECTION_FAILED`, `NO_SUCH_FILE`, `INVALID_URI`, and names another firmware may add.
  - **Stop:** `stop` and `close`, each on its own (a refused stop must not keep the connection open). A pending `load()` rejects with `app`/`ABORTED`. Callbacks of a closed open are dropped (each open has a number).
  - **Lifecycle:** `suspend()` is AVPlay's `suspend()`, and `resume()` its `restore()`: live with no resume time, VOD at its position (or at the start position a jump was still going to), never 0. A source that isn't prepared yet, or a player that refuses either call, is closed and opened again. Either way a new first frame follows.
  - **Tracks:** `getTotalTrackInfo` and `getCurrentStreamInfo`, ids are the streams' indexes, switched with `setSelectTrack`.
  - **Subtitles:** AVPlay draws none, so `selectText` turns on `onsubtitlechange` (`setSilentSubtitle(false)`), and the engine sends a new `cue` event (`text`, `durationMs`) for the overlay (step 20). Picture subtitles are skipped. Every load starts with subtitles hidden. `caps.deliversSubtitleText` is true.
- **The redirect probe** (`createRedirectProbe`; `Platform.resolveUrl`, a new optional member, set on Tizen only):
  - An XHR GET aborted at `readyState` 2, reading `responseURL`.
  - Per source (`RedirectMemory`): `unknown`, `none` or `redirects`. `redirects` probes before every play, because a redirect target often carries a short-lived token. `none` skips the probe unless the controller asks afresh. `MemoryRedirectMemory` keeps it for the app's run; the profile keeps it from step 20.
  - An error status (≥ 400) rejects as `http` with the status (`PROBE_HTTP`), so the card says `PRV-HTTP-404` where AVPlay would only say "connection failed".
  - No answer (a network error, the 5 s timeout, status 0, a refused open) gives the URL as it is: AVPlay tries it, and a probe that can't run on some TV never blocks playback.
- **The screensaver:** `ControllerOptions.screenSaver(allowed)`, called when the answer changes. It stays away while a stream opens, plays, buffers or reconnects, and comes back when it is paused, ended, failed or stopped (Samsung's certification rule). The app passes `Platform.setScreenSaver` (step 20).
- **Key registration:** nothing new. `registerTizenKeys` (steps 2 and 15b3) already registers every media, channel, digit, colour, Info, Guide and PRE-CH key the player handles. Samsung's MTS (audio), Caption and PictureSize keys would need new intents, which step 20's menus may want; a new intent also makes S10's key battery ask every TV for it.
- **Not done or not known yet:** `setStreamingProperty` (4K mode on older sets, adaptive HLS) and `setBufferingParam` (the "Fast start / Stable" setting, step 39) are not called. Unknown until a Samsung TV runs it (19b, 21): which errors AVPlay really reports, whether it refuses `suspend` while preparing, and whether the probe's short connection trips a one-connection account before AVPlay opens.
- **Tests:** 41 engine tests on a fake AVPlay (`fake-avplay.ts`, not exported) that keeps state changes and callbacks apart: the prepare answers, the clock moves and the listener fires when the test says. 7 for the probe on a fake XHR; 4 with the controller (a redirecting source probed before every play, one that doesn't probed once, a source that starts redirecting re-probed after two 8 s freezes, a probe's 404 shown as `PRV-HTTP-404` without opening AVPlay); 3 for the factory. In `player`, 13 for `FallbackEngine` and 2 for the screensaver (player 127 tests, platform-tizen 124). Mutation check: 133/133 caught. The first run's seven survivors were three test gaps (a hide during the start seek with the clock already moving, a second hide while reopening after a refused suspend, the poll left waiting after a callback's frame), three equivalent mutants (the code they changed was redundant and went), and one that only typecheck catches. Writing the stale-callback tests found a real gap: a hide during the start-position seek lost the target (the reopen started from 0).
- **TV bundle:** Tizen main 187.3 → 199.0 KB of its own code (+11.7 KB minified: the engine, the probe and `FallbackEngine`); webOS unchanged at 187.5 KB (the platform-isolation check knows AVPlay's `application/avplayer` and `getTotalTrackInfo`); the same 219 core-js modules on both.

**Built in step 20a: the player in the app** (`apps/tv/src/player`: `player-state.ts`, `PlayerScreen.tsx`, `app-player.ts`, `stage.ts`, `player.css`; the controller's lifecycle; the query worker's account check):
- **The route:** OK on a channel of the live screen pushes a `player` screen on the live navigator (zones `actions`: the info bar's "Previous channel"; `card`: the error card's "Try again" and "Channels"). `LiveApp` draws `PlayerScreen` instead of the live screen while it is on top. Back (or STOP) closes it: the stream stops and the list's focus goes to the row that played. Back during number entry only cancels the entry.
- **The stage:** `#stage` (`createStage`), made on the first play as the body's first child, under `#app`. `html[data-player='on']` makes `html` and `body` transparent and shows the stage (AVPlay paints under the page on Tizen); otherwise the stage is hidden.
- **The controller** (`appPlayer`): one for the app, made on the first play: `Platform.createEngines(stage)[0]`, `resolveUrl: platform.resolveUrl` where it exists, `screenSaver` → `Platform.setScreenSaver` (a refusal is logged), `online: navigator.onLine`, `checkAccount` → the query worker's new `account` call (`packages/data/src/account-check.ts`: the source's Xtream panel, or the panel of an M3U `get.php` link; HTTP 401/403 is a refused login; `null` for a plain playlist), and `onLifecycle` `hidden`/`visible` → `hide()`/`show()`.
- **Zapping:** CH+/CH− and UP/DOWN move through the category the live screen showed, wrapping. The info bar changes at once; the stream opens `ZAP_DELAY_MS` (350 ms) after the last key. A row whose chunk isn't loaded is read through the live screen (`Live.list.load`, joining a read already running).
- **Number entry:** digits collect for 1.5 s (OK ends it, Back cancels it, at most 4), then `Live.list.find(n)`: the row the number's place gives first (a row without a provider number is numbered by its place in "All channels"), then every chunk from that one outwards. "No channel N" for 2 s when none has it. A digit while it searches starts over and drops the old answer.
- **Previous channel:** PRE-CH or the info bar's button: the channel watched before (a retry of the same channel isn't a new one).
- **The info bar:** number, name (`dir=auto`), catch-up badge, clock, the programme on now (time range, progress) and the next one, from the live screen's now/next (asked for a channel the list never asked). It hides 5 s after the last key once the stream has a picture, stays while opening or failed, and INFO toggles it. The first OK or arrow on a hidden bar only shows it.
- **States:** "Connecting…" while opening or buffering, the "Reconnecting…" badge (top-start corner) while the ladder retries, the error card when it gives up: the category's title and advice (four categories), the account's own problem when the re-check found one (refused, expired, blocked, connections full), the expiry date and the connections in use, and the code. A zap hides the old channel's card at once.
- **The lifecycle** (`PlayerController.hide`/`show`): while hidden the watchdog rests and engine events are dropped. A stream with a picture is suspended in the engine (`suspend`/`resume`; `show` arms the open timeout and says `reconnecting` until the new first frame). A stream still opening or waiting out a backoff is closed and opened again on show. A stream that gave up while hidden isn't reopened.
- **A change to the ladder,** found by the media e2e: the remembered `.m3u8` played, its segments broke, the switch rung tried the `.ts` the desktop refuses, and the ladder gave up at once with "this TV can't play this". A URL that fails for good now hands the ladder to one that hasn't (backoff), and the player gives up only when every URL has.
- **Found on the way:** `@preact/signals` skips redrawing a child component whose props didn't change, so a child that reads plain data behind a version signal (the rows and guides) never updates. The info bar gets its row and now/next as props.
- **Not yet:** the picture goes black while the player reconnects (Html5Engine closes the connection before each reopen; keeping the last frame is later work); radio channels fail as `TV-UNSUPPORTED`/`NO_PICTURE` (step 37); `allowed_output_formats`, the profile's `SourceMemory` and redirect memory, start-on-last-channel (20c); tracks and subtitles (20b); the colour-key shortcut for the previous channel (step 39).
- **Tests:** `player-state.test.ts` (20: the debounce, wrapping, rows read on the way, number entry and its stale answers, previous channel, the bar's timer, the card's buttons, Back and STOP), `app-player.test.ts` (6), the live screen's list (6 in `live-state.test.ts`, `ChannelIndex.firstRow`), the controller's lifecycle (7) and the ladder fix (2), `account-check.test.ts` (5). e2e `player.spec.ts` (`pnpm e2e`: open, three CH+ to one stream, number 5, PRE-CH twice, "No channel 99", Back to the row; the 404 channel's card with the account in en and ar, Try again, a zap hiding it, Channels) and `player-media.spec.ts` (`pnpm e2e:media`: a real live play with HLS remembered, a zap, the badge through broken segments until the stream comes back, Back).
- **TV bundle:** main's own code 199.0 → 225.8 KB on Tizen and 187.5 → 214.4 KB on webOS (the controller, the player screen, the catalogs' new strings), the same 219 core-js modules on both.

**Built in step 20b1: the track menu and the language preferences** (`packages/core/src/language.ts`; `packages/player/src/tracks.ts` and the controller's tracks; `apps/tv/src/player`: `track-menu.ts`, `TrackMenuPanel.tsx`; the `AUDIO` and `SUBTITLES` intents):
- **Languages:** `normalizeLang` gives `''` or a lower-case code: the primary subtag of a tag (`ar-SA`, `en_GB`), 639-1 codes as they are (renamed ones renamed: `iw` → `he`), 639-2/T and /B codes and the Arabic and Chinese individual languages (`ara`, `arb`, `arz`, `fre`, `cmn`) to 639-1, other three-letter codes as they are, English and native names (`Arabic`, `عربي`, `العربية`, `Français`), and `''` for undetermined codes (`und`, `qaa`–`qtz`) and unknown names. Pure, ES2017, no `RegExp` constructor or `split`.
- **The controller:** `status.tracks` lists the stream's audio and subtitle tracks (`lang` normalized, `streamLang` as the stream wrote it, `switching` = the engine's `caps.trackSwitch` at the time). When a load's tracks appear (a `tracks` event, or the first frame), each kind is chosen once: the channel's remembered choice (`TrackMemory`; found by id, language and label, then language and label, then language), else the first preferred language (`ControllerOptions.preferences`, read each time), else the stream's own; a remembered "off" turns subtitles off. A retry or a resume (webOS reopens the stream) chooses again. `selectAudio`/`selectText` (the menu) switch through the engine and remember the choice for the channel when the engine took it; an automatic switch isn't remembered, and its answer is dropped once its load was left (tokens are never reused). `MemoryTrackMemory` keeps the choices for the app's run until the profile does (20c).
- **The app's preferences:** sound in the UI's language, then the other app language (`uiTrackPreferences(document.documentElement.lang)`: `['ar', 'en']` or `['en', 'ar']`); no subtitles until the user turns them on (a settings screen sets both lists later).
- **The menu:** a `tracks` screen on the live navigator over the player, zones `audio` and `text` ("Off" first), five rows each (longer lists scroll), as a panel at the inline end of the safe area. It opens from the info bar's new "Audio and subtitles" button (the `actions` zone now has two) or the remote's keys: `AUDIO` (Samsung `MTS` 10195, desktop `a`) on the audio list, `SUBTITLES` (`Caption` 10221, desktop `c`) on the subtitles. webOS maps neither key (S10 asks every TV for them; on webOS they are missing, like PRE-CH, until a TV run finds codes). OK switches to the focused track and the menu stays; "The TV didn't switch to it" when the engine refuses. Where `switching` is `none` (desktop Chromium without its Blink flag) the audio list is replaced by "Not supported on this TV". Back or the same key closes it (the other key moves to its list), STOP closes the player; the info bar hides while it shows, and it closes when the player gives up (the card takes the focus). A track's name is its language in the UI's words (20 languages in the catalogs), else the stream's own text (`dir=auto`), else "Track n"; a label that only repeats the language (`العربية`, `Español`) isn't shown.
- **Found on the way:** desktop Chromium's native HLS lists the bilingual channel's two audio tracks as one unnamed "Audio Track", so the media e2e routes channel 104 to the multi-audio MKV (Matroska lists its languages).
- **Not yet:** subtitles the app draws (AVPlay's `cue` events and external files, 20b2: until then a subtitle chosen on Tizen shows nothing; webOS draws embedded ones itself); the profile keeping the choices (20c); the settings screen for the language lists.
- **Tests:** `language.test.ts` (7), `controller-tracks.test.ts` (28: the lists, the preferences, once per load, retries and resumes, the channel's choice and "off", refusals, stale answers), the menu in `player-state.test.ts` (10), `track-name.test.ts` (6), `app-player.test.ts` (+2). e2e: `player.spec.ts` (the menu by keys in en and ar: "Not supported on this TV", the bar's button, the audio and subtitle keys, Back, STOP) and `player-media.spec.ts` (English chosen over the file's Arabic as the tracks appear, Arabic from the menu with no restart, kept across a zap). Mutation 28/28.
- **TV bundle:** main 225.8 → 242.8 KB on Tizen and 214.4 → 231.3 KB on webOS, the same 219 core-js modules; about 4 KB of it is the language names and Arabic strings (terser's `ascii_only` writes each non-ASCII character as 6 bytes).

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

**Built in step 14b: `RemoteDriver`, the throttled and low-tier runs:**
- **`window.__ZOMA_TEST__.focusPath()`** (`apps/tv/src/test-hook.ts`): `screen/zone/index` of the screen on show, read from its navigator's `snapshot()` (`live/channels/3`, `exit/buttons/0`), or null while the start reads the profile. `main.tsx` hands it each screen's navigator as it shows (onboarding, live, hello, gallery).
  - **Decision: every build carries it, the TV bundles included.** The old-engine harness tests the bundles that ship, so a hook behind a define would leave it testing another build. It is read-only and holds no data, only a screen, a zone and an index (main's own code grew by about 0.1 KB, with no new polyfill).
- **`e2e/remote-driver.ts`:**
  - `press(...intents)` through the browser adapter's keys (`e2e/remote-keys.ts`, kept equal to `browserKeyToIntent` by `test/remote-keys.test.ts`; BACK is Escape, since Backspace deletes in a field being edited);
  - `expectFocus(path)` waits until the engine has the path and the screen on show (`#app > [data-screen]`) draws the same focus;
  - `timedPress(intent, path)` times one press from its key event (`event.timeStamp`) to the end of the first frame showing the new focus (a `requestAnimationFrame`, then a task after its paint);
  - `watchLongTasks`/`longTasks`: a `PerformanceObserver` on `longtask`.
  - `live.spec.ts` and `onboarding.spec.ts` press and check the focus through it. Keys aimed at a field being edited (typing, Backspace, the caret's arrows) still go to the keyboard: they never reach the focus engine.
- **The throttled run** (`e2e/live-throttled.spec.ts`, its own Playwright project `throttled`, after every other test and one test at a time, so no other browser competes for the CPU):
  - A catalog built in-process (`e2e/big-catalog.ts`; `pnpm verify` has no `.cache/fixtures`): 20,000 live channels in 200 categories, provider-like names in English, Arabic and French, and a guide written for it (four 2-hour programmes around now for 9 channels in 10: the one before, the one on and two after, served with the mock's `xmltvFile`). It had three until a CI run started at 23:59:50 UTC and lost its next programme at midnight (fixed in step 14c; `test/big-guide.test.ts`).
  - Onboarding adds it by keys at full speed. Then each tier starts the app afresh with the source stored (a TV's usual start) and, at 4x CPU throttle (`Emulation.setCPUThrottlingRate`, with the CDP session kept open: detaching it ends the emulation), presses 74 timed keys: down the list, 15 pages of CH−, to the rail and 30 down it (past the 12 it shows), OK on a category, down, Back, and RIGHT into the list where it was.
  - **Budget:** every press ≤ 200 ms, spike S6's key-press threshold for the 2018 TVs (§5), and no main-thread task longer than that, so a key pressed at any moment waits at most as long. A fixed loop in the page must run at least twice as slow under the throttle, so a throttle that silently fell off fails the run.
  - **Why 200 ms and not 150:** the CI runner (2 vCPUs) at 4x is about twice as slow as a desktop at 4x. Its first run had a median of 39 ms and a slowest press of 121 ms in the full tier. That run started straight after the 20,000-channel onboarding; both tiers now start afresh. A desktop at 10x had presses up to 153 ms and sporadic long tasks of 140–279 ms. Step 23's grid budget (150 ms) should be calibrated against CI the same way.
  - **Measured locally (2026-11-04, five runs, the CPU 3.3–6x slower):** median 16–18 ms, max 30–47 ms in the full tier; median 9–13 ms, max 21–35 ms in the low tier; no long task. A report goes to `artifacts/perf/live-throttled.json`.
  - **The seeds:** a keydown listener that spins for 250 ms (on the gallery) must fail the budget and show as a long task, and a press whose focus never lands must fail.
  - **On CI (PR #24's green run):** full tier median 32 ms, slowest 94 ms (the first presses down the list); low tier median 11 ms, slowest 28 ms; no long task. Motion costs: with the focus transitions on, the median press is about three times the low tier's. That is a number for the low-tier tuning on the device (§6, 6.4).
  - **What the budget catches:** a list that draws 2,000 rows more than it shows (a mutant of `VirtualList`) made the median press 81–116 ms and the slowest 221–292 ms on the desktop: a few presses over 200 ms, more on the slower CI runner. A slowdown of two or three times would pass. The budget is a smoke check; the TVs' own numbers come from spike S6.
- **The forced low tier:** nothing applied the tier before this step, so `?tier=low` changed nothing on screen. `main.tsx` now writes the platform's tier on `<html data-tier>`, and tokens.css's `[data-tier='low']` turns motion off. The throttled run checks a row's transition (0.12 s in the full tier, 0 s in the low one) and runs the same presses in the low tier.

**Built in step 14c: the live screen on the old engines** (`tools/engines/src/live.ts`, the walk in `onboarding.ts`; runbook old-engines.md item 6):
- **Where:** the onboarding walk goes on from the relaunched live screen, so the live screen runs in Chromium 53, 56 and 68, in both bundles, in English and in Arabic, on the fixture's 2,400 channels in 14 categories, through the real data workers. A separate screen would have needed a second onboarding per run for the stored source.
- **The keys are the TVs' own** (`TV_KEYS`, kept equal to the adapters' maps by `test/engines-onboarding.test.ts`): CH− is 428 on Tizen and 34 on webOS, CH+ 427 and 33, Back 10009 and 461. The app reads the key code, as on the TV. The sequence: ArrowDown; CH− (a window of 9 rows further, `data-top` 9); CH+; LEFT to the rail (RIGHT in Arabic); ArrowDown five times and OK on "Group 5"; Back to the rail; Back again.
- **The way out:** on Tizen the second Back opens the exit dialog, and OK on "Stay" closes it. On webOS the root policy hands Back to the system through `PalmSystem.platformBack()`. The desktop engine has no `PalmSystem`, and the adapter's fallback (`window.close()`) would end the run, so the walk puts a counting stand-in on the page first (`PLATFORM_BACK_STUB`) and expects one call.
- **What each step checks:**
  - **The focus, engine and screen alike:** at every step of the walk, onboarding included, `window.__ZOMA_TEST__.focusPath()` must equal the screen root's `data-screen/zone/index`. This is the first time the focus engine and the DOM are compared on Chromium 53.
  - **Rows** (after the relaunch, after CH−, in the category): the window from `data-top`, each row's number (its place in "All channels": Group 5 starts at 618), its name, and now/next from the fixture's guide at the page's clock (`fixture.17 23h`, then `fixture.17 0h`), or the placeholder in the walk's language. The step waits until every row shows a programme or the placeholder.
  - **The rail** (after the relaunch, in the category): at the inline start (left in English, right in Arabic), its chips from the top with the fixture's names and counts (digits only, so `2,400` reads as 2400 and Arabic-Indic digits fail ADR-011), only the category on show selected, and the header naming it with its count.
  - **Layout** (the live screen, its next window, the category, the exit dialog): the boxes and labels of `layout()` in `e2e/live.spec.ts`, kept equal by the root test.
  - **Idle:** every step on the live screen waits for `data-pending="0"`, so the walk never leaves it while its workers are in the database.
- **Seeds:** `seed-css-no-live` (app.css without live.css), `seed-live-no-back-key` (a keydown listener that keeps 10009 and 461 from the app) and `seed-focus-engine-stuck` (a `window.__ZOMA_TEST__` whose path stays on the first focus while the screen moves on), all on every engine. The last one exists because the real app's engine and screen always agree: a probe that stopped reading the engine would pass the app, so only a seed can show that the agreement check works in a real engine.
- **Timing:** each key on the live screen waits up to 8 s for its data (`LIVE_TIMEOUT_MS`). On Chromium 53 locally, CH− and OK on a category each took 0.7 s to an idle screen: 600 ms of that is the focused channel's short-EPG wait.

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
| Minimum (must own) | 2018 Tizen 4.0, e.g. NU7100 | ~~2018 webOS 4.x low-end 1 GB, e.g. UK6300~~ 2020 webOS 5 since [ADR-012](adr/ADR-012-lg-minimum-webos5.md) (none owned; see below) |
| Mid (borrow or later) | 2020 Tizen 5.5, e.g. TU7000 | 2020 webOS 5, e.g. UN7300 |
| Current (must own) | 2023/24 Tizen 7/8 (DTS dropped) | 2023/24 webOS 23/24 (Back goes Home) |
| Emulators | Tizen Studio TV emulator | webOS TV Emulator 4.x + Simulator 22–24 |

Emulators are for syntax and API checks only, never media.

**The LG minimum is webOS 5 (2020) since [ADR-012](adr/ADR-012-lg-minimum-webos5.md)** (Omar, 2026-11-04). The TV we have is a 2021 OLED (OLED55A1PVA, webOS 6, Chromium 79), and every LG TV we support is in the `full` tier, so S6's low-tier run moves to the 2018 Samsung. The build and the old-engine harness still target Chromium 53 (stricter than any supported TV; ADR-012 says why). Results per device: [spikes/results.md](spikes/results.md).

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
| S6 | Scale on the low-end webOS 4 TV (since ADR-012: the 2018 Samsung for the low tier, the LG TV as a full-tier set) | 200k M3U ingest ≤ 90 s with no crash. Key press to focus move < 200 ms during ingest. 150 MB gzipped XMLTV filtered ingest ≤ 4 min. Cached cold start to usable ≤ 3 s. Search ≤ 200 ms | Low tier gets: lazy VOD/series per category, 24 h + 2 day EPG window, no posters in lists. If it still fails, raise the LG minimum to 2019/2020 (product decision) |
| S7 | Can packaged apps make cross-origin `http://` calls (no CORS headers, redirects, `responseURL`)? | Works on both | webOS: build the luna JS service relay (+2 sessions) |
| S8 | Tizen `avplaystore` pre-buffering (investigational) | Two instances prepare at once; switching to the prepared one ≤ 700 ms on 2020+ | Drop pre-buffered zapping from the post-launch list |
| S9 | Arabic text: bundled woff2 font shaping, bidi mixed names, `Intl` with `ar` | Correct rendering | Bundle fonts and own date/number formatters (already planned, so this only confirms) |
| S10 | Input: registering number, CH, colour and media keys; PRE-CH; Magic Remote pointer; Back behaviour; native IME in Arabic | All behave | IME unusable: build our own on-screen keyboard (+2 sessions) |
| S11 | Lifecycle and accessibility: screensaver control; Tizen Voice Guide reading focused `aria-label` on a US-region model | Works | Explicit TTS `speak()` through the adapter on focus change (+1 session before the US submission) |

**Old-engine harness finding for S1 (relay step 2b, 2026-11-02).** Desktop Chromium 53, 56 and 68 deny IndexedDB inside a Blob worker started from a `file://` page ("access to the Indexed Database API is denied in this context"; the Blob worker's origin is opaque). Main-thread IndexedDB works, and so does Blob-worker IndexedDB once file-URL access is granted (`--allow-file-access-from-files`). The TV runtimes load packaged apps from `file://` with file access granted, so the harness runs with that switch. S1 must confirm **IndexedDB inside a Blob worker on the real TVs**. If a TV denies it: give the data workers IndexedDB through a main-thread proxy, or start them from a packaged worker file instead of a Blob. See `docs/runbooks/old-engines.md`.

**The data layer in the harness (relay step 8b, 2026-11-02).** With that switch, the real data workers run as Blob workers from `file://` in Chromium 53, 56 and 68. They prune at start, then stream a 3,000-item playlist over HTTP: plain for the tizen app, and gzipped (through fflate) for the webos app. They write it to IndexedDB in 500-item chunks, swap generations, reload the query worker and search it, and the hit counts are exact (a Latin word, and an Arabic word that matches only through normalization). What S1 still has to show on the TVs is the switch's assumption (Blob-worker IndexedDB from a packaged app) and the speed on real hardware. The harness serves the playlist with CORS headers; whether packaged apps need none is S7.

**Built in step 15a: the Zoma Lab** (`apps/tv/src/lab`, runbook `docs/runbooks/lab.md`):
- **A separate TV build** (`pnpm build:tv` → `dist/tv-lab`, `tools/build/src/lab.ts`) with its own app id (`com.zoma.iptv.lab`, `ZomaLab001.ZomaLab`), so installing it leaves the app and its data alone. The lab server's address (the mock provider on the PC), the version and the write test's size are set at build time in `lab-config.js`. It runs every spike at launch.
- **The runner:** spikes made of checks, run one at a time, each with a timeout. A check that throws fails with the reason; it never stops the run. Each check ends as one record (`pass`/`fail` against its criterion, `info` for a measurement step 16 judges, `skip` where it doesn't apply). The records are posted as NDJSON to the LAN log collector, in order, retried with backoff and never dropped, and kept on `window.__ZOMA_LAB__` for the tests and the harness. A screen driven by the remote shows each spike's status and the focused spike's checks.
- **The spikes so far:**
  - **S0:** the device facts.
  - **S1:** the polyfills (a native probe in index.html runs before the bundle, so the record says which built-ins the engine lacked), the web APIs and CSS features present, Preact, a Blob worker, TextDecoder across every split of multi-byte text, `response.body` streaming on the page and in the worker, IndexedDB on the page, and a 10,000-item bulk write in 500-item transactions in the worker.
  - **S2:** markers in localStorage and IndexedDB read back by the next run with the version that wrote them (install a higher `--lab-version` over the lab to test an update), the quota, and a 200 MB write test.
  - **S3:** the DUID or LGUDID through the new `Platform.deviceSecret()`. Only a hash and the ID's format leave the TV; `stable` compares the hash with the last run's.
  - **S7:** XHR and fetch with and without CORS headers, and a 302 with `responseURL` / `response.url`.
- **The lab server's probes:** the mock answers the lab on `/__lab/bytes`, `/__lab/echo` and `/__lab/redirect`, so the lab holds no test account.
- **`Platform.deviceSecret()`:** Tizen `webapis.productinfo.getDuid()`; webOS luna `com.webos.service.sm/deviceid/getIDs` through `PalmServiceBridge` (`lunaRequest`, no webOSTV.js), which only the webOS adapter may touch; `null` in the browser.
- **Desktop answers:** S7's no-CORS checks fail there (a browser enforces CORS; a packaged app is expected not to), and S3 has no ID. The e2e test and the old-engine harness both require exactly that, which also shows the checks can fail.
- **In Chromium 53, 56 and 68** (the old-engine harness, reporting through `host.docker.internal` to a mock on the host), every check answered as expected. The bundle filled exactly the built-ins each engine lacks: 8 on 53, 6 on 56, 4 on 68. A whole lab run took about a second on Chromium 53.
- **Not yet:** S6, S9–S11 (step 15b), the player batteries S4, S5 and S8 (step 15c), DB8 for S2 on webOS, and any real TV (step 16).

**Built in step 15b: S6, scale** (`apps/tv/src/lab/spikes/s6.ts`, runbook `docs/runbooks/lab.md` "S6: scale"):
- **The app's own code at scale:** the lab bundle now carries the app's data engine with its three real workers and the app's live screen (`live-stage.tsx` mounts it over the lab screen). Lab main grew from 131.9 to 195.5 KB of its own code; the app's bundle is unchanged.
- **A source without an account in the lab:** the mock's `/__lab/source` hands out its test account's M3U and a guide moved by whole days to the TV's clock (the scale guide is dated around 2026-11-01, and an ingest keeps only the days around now).
- **The checks:** the M3U ingest, six searches, 35 key presses on the live screen while a refresh runs (each timed to the painted focus, then the refresh is cancelled), the guide's filtered ingest, a cached cold start, and cleanup. They judge against the table above only at scale (200k items, the 150 MB guide); against the mock's small catalog they report `info`.
- **Cold start, measured in two parts:** this launch's boot (navigation to the lab's script: the bundle's parse and run) plus a fresh data engine to the live screen's painted rows. A reload in the middle of a run would have had to resume the run after it. A real relaunch on the TV may still differ (code caches, flash reads): step 16 should time one app launch with a source stored too.
- **Safety:** S6 stores its data in the lab's copy of the app database, skips (and deletes nothing) where it finds a source that isn't its own (the dev app's origin under `pnpm dev`), and deletes the database when it is done.
- **On the desktop at scale** (`pnpm lab:scale`, desktop Chromium, 2026-11-04): ingest 200,000 items in 1.9 s, searches ≤ 6 ms, presses during the refresh ≤ 18 ms, the 150 MB guide in 5.2 s, cold start 194 ms. Every criterion passes by a wide margin there; the TVs decide (step 16).

**Built in step 15b2: S9, Arabic, and S11, lifecycle and accessibility** (`apps/tv/src/lab/spikes/s9.ts`, `s11.ts`; runbook `docs/runbooks/lab.md` "S9" and "S11"):
- **S9** checks the app's own choices: the four Zoma Sans faces load; Arabic joins and lam-alef ligates in them (widths joined against the letters kept apart by zero-width non-joiners); the old-engine harness's bidi probe passes (`isolateText` keeps `MBC 1 · 240 قناة` and `1 Zoma قناة` in order, against controls that show the problem); and `Intl`'s answers for ar-SA, ar-AE, ar and en-US are recorded beside the app's formatters (ADR-011).
- **In Chromium 53, 56 and 68** (the harness, both bundles), fonts, shaping and bidi pass. `مسلسلات` measured 198 px joined against 261 px apart, `لا` 28 against 44, the same on all three. `Intl` gives every Arabic tag Arabic-Indic digits there, ar-AE included; ar-SA's calendar is Gregorian on 53 and 56 and Hijri (islamic-umalqura) on 68; `Intl.PluralRules` exists only on 68. en-US is the only locale where `Intl` writes what the app does. The TVs' own ICU may differ again: S9 records it.
- **New in `Platform`** (all three adapters):
  - `setScreenSaver(allowed)`: Tizen `webapis.appcommon.setScreenSaver`, which Samsung's certification wants back on when playback pauses or stops. webOS has no API for apps (`unsupported`): LG's guide says full-screen video keeps the screensaver away. A community-only veto through `com.webos.service.tvpower` exists; it was left out (undocumented, store review unknown).
  - `screenReader()`: Tizen `webapis.tvinfo.getMenuValue(VOICE_GUIDE_KEY)` (the docs disagree on 1/0 against "true": both are read, and the raw answer is recorded); webOS `settingsservice` `getSystemSettings` (`option`/`audioGuidance`).
  - `speak(text)`: webOS `com.webos.service.tts/speak` (LG's Enact uses it; LG's TV docs don't list it). Tizen web apps have no speech API (`unsupported`); Voice Guide reads `aria-live` regions instead.
  - The app's main grew 1.6 KB (Tizen) and 1.0 KB (webOS), our own code with the same core-js modules as before.
- **S11** logs the lifecycle (each event also goes to the collector as an `event` record, with the time away and a 1-second heartbeat that shows whether scripts ran while hidden), turns the screensaver off, reads the screen reader's state, and tries the TV's speech. Two questions are answered by ear (GREEN, RED, Back), only when a person starts S11 from its row: does the screen reader read a focused button's `aria-label` when DOM focus follows the remote, and does it read an `aria-live` announcement of the focused label? The app's focus engine never moves DOM focus today, so one of the two (or `speak()`) must carry the app's accessibility. The lab's webOS manifest sets `accessibility.supportsAudioGuidance`; the app's waits for the answer.
- **Not yet:** S10 (input, step 15b3, below), the player batteries (15c), and any real TV (16). S11's answers need a person in front of a TV with Voice Guide or Audio Guidance on.

**Built in step 15b3: S10, input** (`apps/tv/src/lab/spikes/s10.ts`; runbook `docs/runbooks/lab.md` "S10"):
- **`Platform.registerKeys()` now says what it did** (`KeyRegistration`): on Tizen the TV's own key list (`tvinputdevice.getSupportedKeys()`), the keys registered, the app's keys the TV doesn't list, and the ones it refused with the reason (a Tizen `WebAPIException` may not be an `Error`; its name and message are kept). webOS and the desktop return `skipped` with nothing to register. The app ignores the answer; S10's `registration` records it. The app's main grew 0.5 KB (Tizen) and 0.1 KB (webOS).
- **The key tester** (`LabContext.testKeys`, its own navigator screen `keys`): a box per Intent (29) that lights up with its key code. A capture-phase `keydown` listener on the window hears every key before the remote wiring, so keys with no Intent are recorded with their codes too. The screen's `onIntent` takes every Intent, so nothing moves or leaves; Back is under test as well, so Back twice in a row ends it, or 5 minutes. The pointer is counted meanwhile: the system's shown and hidden events (webOS `cursorStateChange`), real moves (`watchPointerMoves`), clicks and wheel turns.
- **The keyboard test** (`LabContext.typeText`, screen `type`): the app's own `TextField` driven by `createTextEditor`, exactly as onboarding uses them. OK gives the input DOM focus, which should open the TV's keyboard; the record keeps the text and its scripts (Arabic and Latin letters), each edit's end with the keys the field saw (Tizen's IME Done 65376 and Cancel 65385 are still unchecked), and webOS's `keyboardStateChange` events. GREEN, RED or Back answers.
- **Only `registration` runs unattended.** The tester, the pointer and the keyboard need a person, so they run only when S10 is started from its row. In the harness Tizen's registration fails (no TV APIs) and webOS's is `info`.
- **Run order:** `[S0, S1, S2, S3, S7, S9, S10, S11, S6]`. Nine spike rows fill the list to 1010 of the 1026 px title-safe height: step 15c's S4, S5 and S8 need shorter rows or a paged list. Lab main 210.4 → 222.3 KB of its own code.
- **Not yet:** the player batteries (15c), and any real TV (16). S10's answers need a person with each TV's remote.

**Built in step 15c: S5, the `<video>` battery** (`apps/tv/src/lab/battery.ts`, `video-player.ts`, `spikes/s5.ts`; runbook `docs/runbooks/lab.md` "S5"):
- **One battery, two players.** The checks are written once against a small lab interface (`LabPlayer`: open, snapshot, events, tracks, suspend/resume, stop). S5 runs them on a `<video>` element; S4 will run the same checks on AVPlay (step 15c2), so the two TVs answer the same questions. It is a lab tool, not the app's `PlayerEngine` (steps 17–19), which will be written from its answers.
- **The rows:** live TS and HLS first frames (a frame counts once the picture has a size and the clock moved after `playing`, so sound alone never counts), a live stream through three 302s, 4K HEVC at 3840×2160, the MKV's audio tracks and a switch (< 2 s, no restart), AC3 and E-AC3 5.1, in-band SRT and mov_text cues, and two that need a person: Home and back (< 5 s, the webOS policy of stop on hide, reopen on show) and the soak with a stall every ~18 s of live TS (each recovered in < 10 s by a watchdog that reopens after 6 s without progress; 60 minutes by default).
- **The media without an account in the lab:** the mock's `/__lab/media` hands out the URLs (its test account), with what each file holds from the generated manifest. Against placeholder bytes every playback row skips: `pnpm e2e`'s mock and the old-engine harness (`--no-media`; its Chromium builds have no H.264 either) see only `formats`.
- **On the generated media:** `pnpm lab:media` (part of `pnpm verify:media`, CI job `media`) runs S5 in desktop Chromium. Chromium 156 plays HLS natively (first frame 150–210 ms), follows the 302s, switches audio tracks with `audioTracks` behind a Blink flag (265–370 ms, no restart), and recovers from every stall in about 6.1 s. It has no MPEG-TS, no AC3 or E-AC3 (it lists 3 of the MKV's 5 tracks), no in-band text tracks, and (headless) no HEVC picture: those rows fail, marked `unsupported`. A TV is expected to answer most of them differently (step 16).
- **The spike list:** rows are now 52 + 8 px, so 12 spikes fit the title-safe height (S4 and S8 come in 15c2), and a check with its note takes 64 px, so S5's ten checks fit under a one-line question. Run order: `[S0, S1, S2, S3, S7, S9, S10, S11, S5, S6]`.
- **Not yet:** S4 and S8 on AVPlay, S5's luna `selectTrack` route on webOS (15c2), and any real TV (16).

**Built in step 15c2: S4 and S8 on AVPlay, and S5's luna route** (`apps/tv/src/lab/avplay-player.ts`, `spikes/s4.ts`, `spikes/s8.ts`; `packages/platform-tizen/src/avplay.ts`; runbook `docs/runbooks/lab.md` "S4" and "S8"):
- **AVPlay typed in platform-tizen** (`avplay.ts`): the slice of `webapis.avplay` and `webapis.avplaystore` the lab uses, the accessors (`tizenAvplay()`, `tizenAvplayStore()`), `getTotalTrackInfo`'s `extra_info` read into tracks, AVPlay's error names (which ones mean "can't play this"). Step 19's AvplayEngine builds on it. The app's bundles are byte-for-byte unchanged.
- **The AVPlay `LabPlayer`** (lab): open, listener, display rect, `prepareAsync`, play; a frame is the clock moving while `PLAYING` (AVPlay paints under the page, so no pixel can be read); tracks and the switch through `setSelectTrack`; cues from `onsubtitlechange`; Home and back through `suspend`/`restore`; `stop` and `close`. The page turns transparent while its `<object type="application/avplayer">` shows (§2, "AVPlay layering"). Only the Tizen build reaches it; `pnpm build:tv` fails if it leaks into webOS.
- **S4** = S5's ten rows on AVPlay plus `redirect-probe`: the live stream at the URL the redirect probe found (§2, "Redirect handling": an XHR aborted at `readyState` 2, `responseURL`), compared with `redirect` (AVPlay's freeze on the 302s themselves).
- **S8**: two players from `avplaystore`; both prepare the live TS at once; three switches from the playing one to the prepared one, each ≤ 700 ms on a 2020+ TV (`info` before 2020).
- **S5's second track route:** luna `com.webos.media/selectTrack` with the element's `mediaId` (platform-webos `webosSelectTrack`), tried on the file opened again when `audioTracks` is missing or its switch fails; `ac3` uses it where the engine lists no tracks. The record's `route` says which worked. Both batteries now let the file play 2 s before the switch, so a switch that restarts the stream shows as the clock going back (AVPlay sends no event for it).
- **Off a TV** every S4 and S8 row skips with the reason (the desktop, both bundles in e2e, Chromium 53/56/68). The whole AVPlay battery runs in unit tests against a fake AVPlay (`fakes.ts`).
- **Run order:** `[S0, S1, S2, S3, S7, S9, S10, S11, S4, S5, S8, S6]`: twelve rows, the list's limit (it ends at 1002 of 1026 px). A check with its note now takes 60 px, so S4's eleven fit under its question (996 px); e2e measures both. Lab main 243.4 → 260.7 KB (Tizen), 251.8 KB (webOS) of its own code.
- **Not yet:** any real TV (step 16): whether AVPlay's clock moves for live TS, which `restore` arguments a TV takes, whether `avplaystore` players share the plane, and luna's answer on each webOS version.

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
| 2018 low-end TVs run out of memory or lag | Worker plus chunked IDB; ingest worker killed after use; tier gating; image caps (no server-side resizing is allowed, so caps are client-side); S6 thresholds as release gates; the LG minimum raised to 2020 (ADR-012) |
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
