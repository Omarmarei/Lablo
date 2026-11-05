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
│  │                    streaming JSON-array splitter, subtitle parser, catch-up URL builders, search, EPG matcher,
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

**Built in step 23b: the grid guide's component** (`packages/ui/src/components`: `guide-cells.ts`, `guide-layout.ts`, `GuideGrid.tsx`, `GuideGrid.css`; the gallery page `apps/tv/src/gallery/guide-gallery.ts` and `GuideGalleryApp.tsx`, `?screen=gallery-guide`):
- **One function for the focus and the drawing:** `guideCellAt(schedule, range, minute)` gives the cell of a row that holds a minute. The `epg` zone's `cell(row, minute)` is that function (`guideZone(spec, schedule)` builds the zone), and the grid draws a row by walking it from the view's first minute (`guideCellsIn`). The focus engine's moves (LEFT/RIGHT from cell to cell, UP/DOWN keeping the cursor) therefore always land on a cell on screen, short ones included.
- **A row's cells cover the guide's `[from, to)` once:**
  - a programme from its start to its end, cut to the range and at the next programme's start (an overlap ends where the next one starts, as core's buckets do; of two with one start, the last wins);
  - a gap filled with placeholder cells cut at the slot boundaries (counted from `from`, as the zone's own slots), so the cursor crosses an empty stretch slot by slot, as it does in a row with no guide at all (`null`);
  - nothing shorter than `GUIDE_MIN_GAP` (5 minutes) stands alone: a short gap after a programme is part of that programme's cell (providers often leave a minute or two between programmes, and a sliver would cost a key press), and a slot boundary that close to a gap's end is skipped. Only a short gap at the guide's very start stays a placeholder of its own.
  - O(log n) per cell (a binary search on the starts), no cache and nothing built per row: the screen keeps the rows' schedules, and each draw walks the few cells in view.
- **The component** (`GuideGrid`, hook-free: `useZone` only):
  - virtualized on both axes: the zone's `visibleRows` rows from `ZonePosition.top` (`listWindow`), and in each only the cells that cross `view` to `view + span`;
  - sizes from `GUIDE_LAYOUT` (a 56 px time header; 80 px rows after 8 px gaps; a 400 px channel column and an 8 px gap; 11 px a minute, so two hours are 1,320 px and the grid 1,728, the safe area's width; 4 px between cells). `guideFits(height)` gives a screen its `visibleRows`, `guideWidth(span)` and `guideHeight(rows)` the box;
  - each cell placed by CSS variables (`--x`, `--w`) that the stylesheet turns into `left`/`width`. postcss-rtlcss mirrors `left` into `right` in Arabic, which it can't do for an inline `left`: the channels go to the right and time runs leftwards with no code of ours. The rows are flex rows in normal flow; only the cells, the slot labels and the now line are absolute. No Grid, no flex gap;
  - the focused cell is the focused row's cell that holds the zone's cursor (`is-focused`, or `is-memory` while another zone has the focus); the pointer focuses a cell at its drawn start, so a hover on a programme that began before the view doesn't scroll it;
  - the time header (the slots in view, each label at its boundary) and the day of the view in the corner (`formatDay`); the now line while now is in view and inside the guide; cells gone by (`is-past`) and on air (`is-now`); a small triangle where a programme goes on past the view's edge (`is-cut-start`, `is-cut-end`), mirrored with the rest;
  - titles are the provider's text (`dir="auto"`, `translate="no"`); the placeholder's words come from the catalogs (`guide.noInfo`: "No information", «لا توجد معلومات»).
- **Times and direction:** a slot label and a programme's range are written in the page's direction, as the player's info bar writes its range: in Arabic the start is on the right and is read first, and the period marker («م») sits after its time. Only the media timeline's position/length is forced left to right (step 11b).
- **The gallery page** (`?screen=gallery-guide`): 40 made-up rows on a fixed evening (20:17 on 2026-11-05 in the browser's own time zone, so the screenshots never change): a programme from before the view and one past it, a two-minute gap taken by the programme before it, 2 h 10 min of nothing, a channel with no guide, 5-minute programmes, Arabic and long titles, a long channel name. The header shows the focused programme with its own times, and what OK selected. Back follows the platform (no exit dialog on this page).
- **Tests:**
  - `guide-cells.test.ts` (15): the slots of a row with no data equal the zone's own (`epgCell`) at every minute; the cut to the guide, at the next start and for equal starts; gaps cut by the slots with the near boundaries skipped; short gaps given to the programme before; the guide's edges; slots counted from an unaligned `from`; the cells crossing a view; the slot labels; `guideZone`'s cells and the engine's RIGHT steps visiting exactly the drawn cells' starts. Three fast-check properties (300 runs each, any range from 1 to 400 minutes and slot from 1 to 90): schedules as core makes them equal a minute-by-minute oracle (owners, runs, short gaps merged, gaps cut); any schedule with sorted starts (ends before starts, overlaps, repeats) is covered once, each minute in the cell `guideCellAt` gives; and any view draws exactly the row's cells that cross it.
  - `guide-grid.test.ts` (14, the VNode walk): the rows and cells in view; `--x`/`--w` and the cut classes; titles and placeholders; the slot labels and the day as the view moves; the focus across rows and its agreement with the zone at every minute in view; CH± paging; memory; the now line's edges and gone-by/on-air; a guide shorter than the view; the arrows at the guide's own start and end (and none after a gap a programme took); a span shorter than a slot (a slot is drawn, as the zone scrolls by one); the pointer; Arabic draws the same cells (only LEFT/RIGHT swap); not an `epg` zone.
  - `guide-gallery.test.ts` (5): the page fits the safe area (9 rows, 1,728 px), its evening is 20:17 in the TV's own time, the demo rows keep the schedule contract (sorted, no overlap), OK selects the focused cell, Back follows the platform.
  - e2e `guide-gallery.spec.ts` in `en-US` and `ar-SA`: every cell, slot label and the now line measured against `GUIDE_LAYOUT` from the timeline's inline start (the left edge in English, the right in Arabic), rows at their heights, the channel column at the inline start, the safe area; the demo's cells (the absorbed gap, the 2 h 10 min of placeholders, no guide); a programme on and back, DOWN keeping the cursor, the view moving on by slots past its end (header and now line with it), CH− paging, OK selecting; the pointer on a cut cell keeping the view; en-XA: only bracketed strings (the locale's times and day aside). Screenshots `guide-gallery-{en-US,ar-SA}.png`, both looked at.
  - **Mutation:** `artifacts/mutate23b.py`, 70 unit mutants written before the run (two dead guards taken out first: a `Math.min` in `guideCellsIn` and a `Math.max(0, …)` on the width). 67 caught on the first run. One survivor was a masked guard (the focused-row check beside `state(row)`, which is idle off that row: removed). Two were a test gap (no programme went past the guide's own start or end: a test added). 69/69. The CSS against the e2e: `artifacts/mutate23b-e2e.py`, 12/12 (each position, width, the mirror, the rows' gaps, the channel column).
- **Size:** main's own code 294.6 → 304.3 KB (Tizen) and 282.0 → 291.7 KB (webOS), the gallery page and its made-up rows included; app.css 52.3 → 58.8 KB; 219 core-js modules on both (plain loops and arrays: no `.at`, `Array.from`, typed array or `for…of` in the grid's code).
- **Not yet:** the grid on Chromium 53/56/68 (step 23e). The guide screen with the engine's rows is step 23c, below; its throttled timings are step 23d (§4).

**Built in step 23c: the guide screen** (`apps/tv/src/guide`: `guide-state.ts`, `GuideScreen.tsx`, `guide.css`; the live screen's header; `e2e/guide.spec.ts`, with the grid readers shared with the gallery page's spec in `e2e/guide-grid.ts`):
- **The way in:** a "Guide" button in the live screen's header, before "Settings" (`HEADER_GUIDE` 0, `HEADER_SETTINGS` 1), so UP from the first row of the list or of the rail lands on it. There is no remote key for it: spike S10 would have to ask every TV for one. OK on it opens the guide on the category on show and on the row the list has focused, only while the list has channels (not while it loads, after it failed, or when it is empty).
- **The screen:** pushed on the live navigator (screen `guide`, one `epg` zone `grid`) and painted by `LiveApp` instead of the live screen, as the settings screens are; the player opens over it. A 110 px header: the title, the focused channel's number and name, the clock; under them the focused programme's title with its own start and end (not its cell's), in the page's direction. Then the grid (`GuideGrid`): 9 rows of two hours (1,728 px), the cursor at now, the view from the slot that holds it.
- **The range:** from local midnight one day before today to the end of the day seven days after it (three on the low tier). `GUIDE_DAYS` follows `EPG_WINDOWS`: the least past days (catch-up's past days come with step 25) and all the future ones. The slots count from that midnight. `guideDays` builds the days with `new Date(y, m, d)`, so a change of daylight saving time keeps each boundary at midnight.
- **The data, per channel-day** (one local day of the range for one row):
  - The rows in view and a page either side (27 rows) are asked for the days the view crosses (one or two): one `DataEngine.guide` call per day, once the view has rested 200 ms (`GUIDE_ASK_MS`), and when the screen opens on a 0 ms timer, so the press that opens it paints its first frame without waiting for the ask or an early answer (step 23d; a key pressed before the timer waits for the view to rest instead). A day already being asked is not asked again.
  - A row's days merge into one schedule (`mergeDays`: a programme across midnight is in both days' answers and is kept once). It is cached until one of its days changes, so the zone's `cell` stays one binary search.
  - Rows whose chunk the live list hasn't read are read first (`list.load`), then asked.
  - 216 channel-days are kept (`GUIDE_KEEP`), the least recently wanted dropped first. Everything goes when the screen closes.
- **Staleness:** after a guide swapped in (`guidesChanged`, which the refresh scheduler now calls beside the live list's), every day is asked again at the next rest. A row keeps its programmes until the new answer comes; an answer asked before the swap is drawn, then asked again. Answers for a closed screen, an older list or a disposed screen are dropped (`seq`).
- **Keys:** UP/DOWN change channel and keep the time, LEFT/RIGHT go a programme back or on (mirrored in Arabic), CH± page the rows (the focus engine's `epg` zone, step 10).
  - **OK** on the cell that holds now plays the channel: the programme on air, or the placeholder of a channel with no guide, so every channel can be played from the guide. The player opens over the guide, and Back from it returns to the guide on the channel that played (`follow`).
  - **OK on a programme gone by or to come** did nothing in 23c (decided in leg 52). Since step 24a it opens the programme's details (below); since step 25a their "From the start" plays a programme gone by from the channel's archive.
  - **Back** closes the guide, and the live list focuses the channel the guide had focused.
- **A catalog swap while it shows** (`listChanging`, before the live list is replaced): everything read is dropped. Once the new list is in (`list.locate` of the focused channel, or `list.ready()` when its row wasn't read yet), the zone takes the new list's count, the focus goes to that channel when the new list has it (else it stays on the same row), and the rows are asked again. The guide keeps its place in the stack, under the player too.
- **Redraws:** `@preact/signals` skips a child whose props didn't change. `GuideScreen` therefore reads the guide's `version` (bumped when programmes or channels arrive) and passes new `channel` and `schedule` functions to the grid on each draw; `LiveApp` passes it the live list's `version` too (the channels' names come from the list's chunks).
- **Tests:**
  - `guide-state.test.ts` (33, a real navigator, a held fake engine and list, hand-run timers, TZ-stable times from local midnight): the layout numbers; `guideDays` (the tiers' windows, DST) and `dayOf`; `mergeDays`; the first focus and view; what is asked on open, near the list's ends, across midnight, at the range's last day; nothing asked inside what was read, new rows only once the view rests; the next day; a swap before and after the answers; the merged cache; `GUIDE_KEEP` and the least-recently-wanted order; chunks read first, once; a failed read; a day asked once; OK on air (its first minute to the one before its end), on a programme to come or gone by, on a channel with no guide, before anything was read; Back; a closed guide's late answers; `follow` and the player over the guide; a catalog swap (the same channel, a channel the new list lacks, a row not read yet); `dispose`.
  - `guide-screen.test.ts` (2): the details line gives the programme's own times, a placeholder's cell, nothing outside the guide.
  - `live-state.test.ts` (+2): OK on "Guide" opens the guide on the list's focused row (from the list, the rail and a category), not while the screen loads, failed or is empty; `list.ready()` settles with the newest load. The Settings tests now go RIGHT to it.
  - e2e `guide.spec.ts` (3) against the mock on the real clock, in `en-US` and `ar-SA`: open from the header; every cell, slot and the now line against `GUIDE_LAYOUT` (`checkGeometry`) and the grid under the 110 px header; in every drawn row the mock's programmes over the view with their own times and titles, and only placeholders for the channel no guide matches (`checkSchedule`), at now, after a page of rows and after the view moved on; OK on air plays (the player on that row) and Back returns to the guide; OK on the next programme plays nothing; DOWN keeps the cursor; Back to the list on the channel focused; en-XA: only bracketed strings. `guides.spec.ts` now goes on to "Settings" at the header's end. Screenshots `guide-{en-US,ar-SA}.png`, both looked at.
  - **Mutation:** `artifacts/mutate23c.py`, 97 mutants written before the run. Writing the list first took out what it showed masked or dead: a length check in `mergeDays`, `disposed` checks that `seq` already covers, the view's end clamp that `dayOf` does, an early return in the trim, a second `seq` bump and `forget` on open. It also found a bug: `listChanging` called `close()` when the focused row wasn't read, and with the player over the guide that would have popped the player. It now waits for the new list (`list.ready()`) instead. Two mutants loop for ever (rows below 0 or past the list's end are never readable) and end at the 180 s timeout. 95 caught on the first run. The two survivors were masked code: the trim's check for wanted days, which the use order already keeps clear, and a redraw after a chunk read, which the asks' answers and the live list's version already make. Both removed: 95/95.
- **Size:** main's own code 304.3 → 311.3 KB (Tizen) and 291.7 → 298.7 KB (webOS); app.css 58.8 → 61.4 KB; 219 core-js modules on both.
- **Not yet:** the guide screen on a TV. Its throttled timings are step 23d (§4, "Built in step 23d"), and Chromium 53/56/68 step 23e (§4, "Built in step 23e").

**Built in step 24a: the programme details** (step 24 was split in leg 55 into 24a, the details; 24b, the time offset per guide; 24c, match diagnostics; 24d and 24e, manual mapping. Core `epgProgrammeAt`; `QueryService.programme` and `DataEngine.programme`; `apps/tv/src/guide`: `programme-details.ts`, `ProgrammeDialog.tsx`, the guide's OK; the `Dialog` component's `data`, `body` and `wide`):
- **The way in:** OK in the grid on a programme gone by or to come opens a dialog over the guide (screen `programme`, one horizontal zone `actions`). OK on the cell that holds now still plays its channel at once, and OK on a placeholder that doesn't hold now does nothing.
  - **Decided (not a gate):** there is no details view of the programme on air. OK there keeps the one-press play the guide had since 23c, and a TV remote's own "Info" or "Guide" key would need spike S10 to ask every TV for it. Its title and times are in the guide's header line already.
- **What it shows:**
  - **At once, from the grid:** the title (the provider's data: `dir="auto"`, never translated; "No information" when it has none), the channel's number and name, the day, the programme's own start and end (not its cell's: a programme that crosses the range's ends is cut there in the grid; the dialog's times are those the grid's schedule gives, so a programme cut by the next day's first one ends where that one starts, as in the header) and its length ("60 minutes", plural forms in Arabic).
  - **From the read:** the sub-title, the category and episode as tags, and the description, cut at eight lines with an ellipsis (`-webkit-line-clamp`, which Chromium 53 has; the full tier's ingest keeps at most 1,000 characters, about 13 lines). A spinner while the read is out; "No description" when the guide has none; "Couldn't read the details." when the read failed.
  - The panel is the Dialog's wide one (1,200 px). The title and the description start on the page's side whatever their own direction (`text-align: left`, mirrored by rtlcss), as the grid's titles do; the times follow the page's direction, as the header's.
- **The buttons:** "Watch the channel" (focused first) closes the dialog, then plays the channel the guide has focused, only while it is still the programme's channel (a catalog swap under the dialog may have moved the guide's focus: to the channel's new row when the new list has it, else to another channel on the same row, which then doesn't play). "Close" and Back close it on the same cell. Step 25a added catch-up's "From the start" for a programme gone by, first (below, "Built in step 25a").
- **The read** (`QueryService.programme({ key, start })`): the whole `EpgProgramme` of the channel's guide channel (the one its now/next and grid row come from) that starts at `start` (UTC minutes after the tvg-shift), from the one bucket that holds it: the start's day in guide time. Core `epgProgrammeAt` finds it by a binary search over the bucket's starts. `null` when no guide matches the channel, the day has no bucket, or no programme starts then. The read counts in the guide's `pending`; an answer for a dialog that closed, or after a dispose, is dropped (`seq`, bumped by each close and dispose: an open always follows one).
- **Painting:** `LiveApp` paints `GuideScreen` while the guide or the dialog is on top; under the dialog the header keeps the grid's focused programme (the guide screen's position, not the dialog's focus), and the grid draws its cell as the focus's memory.
- **Tests:**
  - **Unit:** core `epg-guide.test.ts` (+2: every programme found by its start and none at any other minute, for buckets of 0 to 7 programmes; shifts both ways in explicit minutes, 2.05 h rounded to 123); `query-guide.test.ts` (+3: the whole programme from the row's own guide over a stronger match in the second, the bucket's first and last, no start between, a day with no bucket, an unmatched channel; the start's day in the channel's own time three hours early and an hour late, a programme across midnight with its stored end; a new generation after a reload); `test/tv-data-engine.test.ts` (the call through the real query worker); `guide-state.test.ts` (+6: OK opens the details on a programme to come and gone by with the grid's channel, title and times; nothing before the days are read or on a placeholder; the programme's own times where the range cuts its cell at both ends; "Watch the channel" plays once the dialog has closed, "Close" plays nothing; a catalog swap under the dialog (the channel moved, the channel gone); the read counted as pending and dropped after a dispose); `programme-details.test.ts` (10: the dialog's state, its stale answers and failures, the buttons and keys; the dialog as drawn, called as a function: each line present or left out, the spinner and the notes, a title of ours); `components.test.ts` (+1: a data title, a body, the wide panel).
  - **e2e** `guide.spec.ts` (+2, en-US and ar-SA, by keys against the mock): the next programme's details with the mock's title, category and description, the grid's times and length, in the safe area with none of our texts cut, the panel 1,200 px wide, the title and description starting on the page's side, the time line's parts apart, "Watch the channel" first (on the right in Arabic), the header still on the programme under the dialog; a 1,000-character description on a copy of the dialog cut at eight lines of 38 px by the line clamp, the panel still in the safe area; "Close" and Back on the same cell; a programme gone by; "Watch the channel" plays, and Back returns to the guide. The first guide test's OK on the next programme now opens the details, and the pseudo-locale test walks the dialog too. Screenshots `guide-details-`, `guide-details-past-` and `guide-details-long-` with `en-US` and `ar-SA`, all looked at.
  - **Mutation:** `artifacts/mutate24a.py`, 62 unit mutants written before the run. Writing the list took out what other code already covered: the search's `lo < length` (past the last start the typed array gives `undefined`), the dialog's own `seq` bump on open (each close and dispose bumps it), a `status === 'read'` beside a description that only a read programme has, and a `text-align` on a flex item as wide as its text. It also showed test gaps, closed before the run: a shift where truncating and rounding differ, a day with no bucket, the range's ends, the untracked read's answer, an episode with spaces. 61 caught; the survivor is equivalent (the search's upper bound one lower still ends on the last start whenever every start before it is earlier). Left out as typecheck-only: `cell === null` (the cursor is always in the range), `programmes === null` and `row === null` beside `p < 0` (a programme cell needs a read schedule, read only for rows whose chunk is in), the watch's `?? -1`. `artifacts/mutate24a-e2e.py` runs the details e2e against 10 CSS and markup mutants (the dialog painted over the guide, the header under it, the wide panel, the data's side in Arabic, the time line's gaps, the line clamp): 10/10 caught. Writing it showed that a `max-height` beside the clamp masked the clamp's mutants, so it went and the e2e measures the clamp's own height.
- **Size:** main's own code 311.3 → 315.5 KB (Tizen) and 298.7 → 302.9 KB (webOS); the query worker 100.8 → 101.3 KB; app.css 61.4 → 64.6 KB; 219 core-js modules on both. 3,714 unit tests and 79 e2e in a green `pnpm verify`.
- **Not yet:** the dialog on a TV, and on Chromium 53/56/68 (the old-engine walk doesn't open it; it uses no layout technique the walk hasn't drawn, the line clamp aside).

**Built in step 24b: the time offset per guide** (`epg-sources.ts`: `EPG_OFFSET_STEP`, `EPG_OFFSET_MAX`, `isEpgOffset`, `epgOffsetsOf`; `profile.ts`: `epgOffsets`, the `epgOffset` edit, `readEpgOffsets`; `QueryService`'s reads; `apps/tv/src/settings`: the menu's "Time offset", the chooser, the row's offset; `main.tsx`'s `offsetChanged`):
- **The setting:** one per guide, for the user's guides (`u~<id>`) and the sources' own (`<src>:xmltv`, `<src>:tvg<n>`): a whole number of half hours from −12 h to +12 h (49 steps), added to every time the guide gives. The profile keeps it as `epgOffsets`, in minutes by guide id, with no entry for 0. The field is optional, so version 4 stays and nothing is migrated. Removing one of the user's guides drops its offset, since its id may be given to a new guide later.
- **Applied when reading** (decided in leg 55, not a gate):
  - The query worker adds it to each live channel's tvg-shift in whole minutes (`Math.round(tvgShift * 60) + offset`) for now/next, the grid's rows and the programme details. They choose their days and call core's `epgNowNext`, `epgSchedule` and `epgProgrammeAt` as they do with a tvg-shift alone.
  - Nothing is downloaded or read again after a change: the refresh's basis doesn't hold the offsets, and the stored records don't change. The ingest-time `shiftMinutes` (core's reader, `EpgGuide`, `UserGuide`) is gone, so no guide is shifted twice. A screen that tried +1 h, then +2 h, shows each at once, where reading a big guide again takes minutes on a TV.
  - The offsets are read from the profile at each reload (`readEpgOffsets`: read-only, no upgrade). An `editProfile` that writes takes the offsets of the document it wrote at once.
  - **A read that went out before an edit never undoes it.** Each edit bumps a number when its write starts. A read takes the number as it is: IndexedDB runs the two in the order they start, so the read sees that edit's write and none after. An answer with a lower number than the offsets held is dropped.
  - **Not changed:** the stored window. A guide keeps its tier's days around now, widened by the largest tvg-shift, but not by the offset. With an offset, one far edge (the oldest catch-up day, or the last future day) shows up to the offset's length less. The panel's short EPG (a focused channel that no stored guide matches) has no offset.
- **The screen:**
  - **The menu:** Move up, Move down, Time offset, Remove, Cancel for the user's guides. A source's own guide, which had no menu, now has Time offset and Cancel.
  - **The chooser** (`guide-offset`, one vertical zone `steps`): a dialog naming the guide's link, with the 49 steps (`+1:30`, `−0:30`, "No offset"). The digits are `dir="ltr"`, and the minus is U+2212, which the Latin font's subset has. Seven 64 px steps are in view. The guide's own step is marked (a check, bold) and focused near the middle: the list first scrolls to three past it, and the navigator stops at the last.
  - **OK on another step** saves it (`editProfile({ kind: 'epgOffset' })`, after the changes before it), reads the list again with the focus on the guide, and calls `offsetChanged`. The live screen and an open guide then ask their programmes again (`guidesChanged`, as after a guide swap). No refresh runs. OK on the guide's own step, or Back, closes the chooser with nothing saved.
  - **The row** shows "Time offset: +1:00" between its link and its owner when the offset isn't 0, the label first (on the right in Arabic).
- **Tests:**
  - **Unit:**
    - `profile.test.ts` (+6): set, change and take away an offset; -0; refused values; a removed guide's offset; `isEpgOffset`, `epgOffsetsOf` and `readEpgOffsets`.
    - `query-offset.test.ts` (7): the offset in now/next, the grid and the details, with a tvg-shift too, for one guide only; the stored offsets at the first read and at each reload; an edit that writes nothing; a removed guide; a read that went out before an edit. Then every one of the 49 steps at five times around midnight, with tvg-shifts of 0, −2.5 h and 2.05 h, against the guide read at the shifted time (70-minute programmes, so many cross midnight); and 23-hour programmes, whose one on air can have started two days back in guide time.
    - `catalogs.test.ts` (+16): the per-key checks for the four new keys.
    - `guides-state.test.ts` (+10): the steps, the rows' offsets, both menus, the chooser's focus and scroll, saving, the guide's own step and Back, the focus followed (a source's row too), failed and empty edits, a save after a dispose, saves in turn.
    - `settings-screen.test.ts` (+1): the offset's text, with Arabic-Indic digits too.
  - **e2e** `guide-offset.spec.ts` (2, en-US and ar-SA, by keys against the mock with requests counted):
    - The panel's guide's menu (Time offset, Cancel), and the chooser on "No offset": seven steps in view, one check, each step 64 px and as wide as the dialog, the check and the value on the screen's side, the list's end at +12:00. Back changes nothing.
    - +1:00: the row says it, and the profile holds it. The live list's now/next, every grid cell's times and title, and the next programme's details are the mock's an hour later, with no request to `xmltv.php`.
    - Back to no offset restores all three.
    - `guides.spec.ts` follows the menu's new action.
    - Screenshots `guides-offset-`, `guides-offset-row-` and `guide-offset-` with `en` and `ar`, all looked at.
  - **Mutation:** `artifacts/mutate24b.py`, 76 unit mutants written before the run. Writing the list took out six masked pieces: the load's own bump of the offsets' number, a `-0` check that `withOffset` already makes, the chooser's `Math.min` (the navigator clamps the focus), a screen check beside `chooser !== null`, a `text-align` on a step's value, and `hasOwnProperty` around the offsets' lookups. The first run caught 72. The four survivors were test gaps, now closed: an offsets record without the guide's entry; an edit that writes nothing after the first load (a load after the edits had read the profile again and hidden it); and the days that now/next and the grid read in guide time, which only programmes of many hours from two days back tell apart (23-hour slots). Then 76/76. Left out: `typeof stored !== 'object'` in `epgOffsetsOf` (equivalent), `row === undefined` in the menu (typecheck-only), the chooser's `- 1` (the navigator floors 3.5). `artifacts/mutate24b-e2e.py` runs `guide-offset.spec.ts` against 12 markup and CSS mutants: 12/12 caught. Writing it added the e2e checks of one check mark and of each step's 64 px.
- **Size:** main's own code 315.5 → 318.9 KB (Tizen) and 302.9 → 306.3 KB (webOS); the query worker 101.3 → 102.5 KB; app.css 64.6 → 66.2 KB; 219 core-js modules on both.
- **Not yet:** the setting on a TV, and on Chromium 53/56/68 (the old-engine walk doesn't open the settings).

**Built in step 24c: match diagnostics** (`catalog-store.ts`: `scanChunks`; `QueryService.unmatched`, `UNMATCHED_MAX_ROWS` and `DataEngine.unmatched`; `apps/tv/src/settings`: the menu's "Matches", the header's "Channels without a guide", `unmatched-state.ts` and its page in `SettingsScreen.tsx`):
- **A guide's matches** (`guide-matches`, one zone `actions` with "Close"): a dialog drawn from the summary the refresh stored with the guide (`EpgMeta.summary`), so nothing is read. It shows the rate ("Channels matched: 11 of 12 (92%)"), then one line per method in the order RELAY lists them (by channel ID, by the panel's channel ID, by name, by name without tags such as HD and FHD, set by you), the ties, and the guide's XMLTV channels declared and in use, each number at its line's end. The menu offers "Matches" after "Time offset" only for a guide that was read (`summaryOf`): Move up, Move down, Time offset, Matches, Remove, Cancel for the user's guides; Time offset, Matches, Cancel for a source's own.
- **The live channels without a guide** (`QueryService.unmatched({ sources, offset, limit })`):
  - The list is every live channel of the sources asked, in their order, that the combined match tables (`epgLinks`, as now/next uses them) don't have. The app passes the profile's sources, so the order is that of "All channels": source by source, then category by category (the chunks' key order: the ingest numbers categories as they first appear, and the live screen lists them by that number).
  - It is counted from the catalogs, not from the guides' own unmatched lists, so a channel added after the last guide refresh is listed, and a match of a channel no catalog has any more counts for nothing. With no guide stored, every live channel is listed.
  - Each source's live chunks are walked once after a reload, when that source is first asked for (`scanChunks`: one cursor in one transaction, one chunk held at a time), into flat chunk addresses (category, chunk, slot). A walk that fails is tried again at the next ask.
  - A page (at most `UNMATCHED_MAX_ROWS`, 500; a larger ask is refused, as `guide`'s) reads only the chunks its rows are in, through the worker's chunk cache. A limit of 0 gives the count alone. Each row is the channel's key, name, source and category (the item's `group`). A row whose chunk is gone is left out.
  - Each answer carries `version`, which bumps at every reload (a catalog or a guide swapped): the screen drops its pages when it changes.
- **The screen:**
  - **The guides screen's header** (zone `header`, was `add`): "Add a guide", then "Channels without a guide: n", counted (a page of 0 rows) after each read of the list, so it follows a change's refresh. The newest read's count wins. A failed count keeps the last one.
  - **"Channels without a guide"** (`unmatched`, one vertical zone `channels`, pushed on the live navigator): the title and the count ("1 channel") in the header, a line saying what the list is, then eight rows of 88 px in a `VirtualList`: the channel's name, then "From <source> · <category>" ("Other channels" for a channel with no category). Names and categories are data (`dir="auto"`, `translate=false`).
  - **Reads:** the profile first (the sources' order and names), then pages of 50 rows around the window: its eight rows and eight either side. Six pages are kept, the least recently wanted going first. A page that fails is asked again at the next move, and the screen says the list couldn't be read only when the first one fails. Back closes it, and the header's button keeps the focus.
  - **Versions:** an answer at a newer version drops every page held and every ask in flight, takes the new count (the focus clamps to it), and asks the window again. An answer older than the pages held is dropped.
  - OK on a row does nothing yet: step 24e maps the channel from there.
- **Tests:**
  - **Unit:**
    - `query-unmatched.test.ts` (10): the list against two guides (the channels every guide's own list leaves unmatched, in catalog order), the sources' order and a source with no catalog, pages across sources and chunks and past the end, the refused asks, one walk per reload (a chunk changed in place isn't read until the reload) and a new version after a guide or a catalog swap, a gone chunk, no guide stored, a failed walk tried again, and 20,000 channels (10,000 listed: the walk about 100 ms and a page of 50 under 1 ms in fake-indexeddb, every page of 500 making the whole list).
    - `tv-data-engine.test.ts` (+1 check): the call through the real query worker.
    - `unmatched-state.test.ts` (14) and `unmatched-screen.test.ts` (7): the layout numbers, the profile then the first page, the pages around the window and the six kept, a page wanted again, the list's end on a page boundary, newer and older versions, failures, a count of 0, Back, a reopening (afresh, and a page that was in flight asked again), dispose; the page in each state, a row, and the settings root's `data-pending`.
    - `guides-state.test.ts` (+7), `settings-screen.test.ts` (+2), `catalogs.test.ts` (per-key checks for the 16 new keys).
  - **e2e** `guide-matches.spec.ts` (3: en-US, ar-SA, and en-XA's walk over the dialog and the list): the header's buttons in the screen's direction, the panel's guide's menu, its matches against the mock (10 by the panel's channel ID, 1 by name without tags, 9 declared and used) with each number at its line's end, Close and Back, then the list with "18+ Test Pattern", its source and category on the screen's side, 88 px, and Back to the header. `guides.spec.ts` and `guide-offset.spec.ts` follow the menu and the header's zone. Screenshots `guide-matches-` and `unmatched-` with `en` and `ar`, all looked at.
  - **Mutation:** `artifacts/mutate24c.py`, 111 unit mutants written before the run. Writing the list took out eleven masked pieces (among them the category names read from the categories, where an item's `group` is its category's name; the walk's generation-0 shortcut; fill's ready check; the resets that `open` makes anyway). Claude Code stopped the first run for low memory after 33 mutants (it left one file mutated, restored from its backup); the rest ran in the foreground in batches. Two survived: a test gap (a page that was dropped and is wanted again must be asked again), closed, and `status === 'ready'` beside the list's `count > 0`, equivalent and taken out. Then 110/110, with the root's `data-pending` sum moved here from the e2e list (+1 unit test). `artifacts/mutate24c-e2e.py` runs `guide-matches.spec.ts` against the markup and CSS: writing it added the checks of the header button's focus and the row's 88 px. Of 24, the `data-pending` sum went to the unit list (the mock answers before any wait looks), `.settings__end`'s `display: flex` was equivalent and taken out, and `.unmatched__where`'s `white-space: nowrap` is left out (the mock has no line long enough): 21/21 caught.
- **Size:** main's own code 318.9 → 327.5 KB (Tizen) and 306.3 → 314.9 KB (webOS); the query worker 102.5 → 103.8 KB; app.css 66.2 → 69.0 KB; 219 core-js modules on both.
- **Not yet:** the screens on a TV and on Chromium 53/56/68 (the old-engine walk doesn't open the settings); a "loading" look for rows not read yet (they show as empty boxes).

**Built in step 24d: manual mapping, the data** (`epg-overrides.ts`: `EpgPin`, `isEpgPin`, `epgOverridesOf`, `epgMappingKey`, `NO_MAPPING`; `profile.ts`: `epgOverrides`, the `epgOverride` edit, `readEpgOverrides`; `epg-store.ts`: `epgDeclared`, `putEpgDeclared`, `readEpgDeclared`, `EpgMeta.mapping`; `epg-sources.ts`: `epgRefreshDue`'s `mapping`; core's `EpgMatcher.declaredChannels`; `QueryService.guideChannels`, `GUIDE_CHANNELS_MAX_ROWS` and `DataEngine.guideChannels`). Step 24e adds the screens.
- **The guides' channels:** each generation stores every XMLTV channel its guide declares, used or not, as columns in declaration order (`EpgDeclaredChannels`: `ids`, `names`, the name for the UI languages, and `search`), under its own key `[epgSrc, gen, 'declared']` beside the match table. A generation's and a guide's key ranges cover it, so it is pruned and deleted with them, and a reload never reads it. `search` is `normalizeName` of the id and of each display name, joined by a character no normalized name holds; it is built in the EPG worker when the guide is read, off the screens' way. Programme-only ids are there only when an id or a mapping matched them (the matcher declares no others). `EPG_INGEST_VERSION` is 2, so every guide is read again once (unchanged guides included).
- **The mappings** (`profile.epgOverrides`, by the live channel's ContentKey; optional, so version 4 documents need no migration):
  - A mapping pins the channel to one XMLTV channel of one guide (`{ epgSrc, channel }`, the channel's id as the guide declares it), or to no guide (`{ epgSrc: '', channel: null }`). Core's matcher already honoured them: no other guide or method can match a pinned channel.
  - The `epgOverride` edit sets one, or takes it away (`pin: null`: the guides match the channel again); one that isn't a mapping, or that holds already, changes nothing. A mapping to no guide is kept as `''` whichever guide it names. Removing a user's guide takes the mappings into it away with its offset: a channel mapped to a guide that is gone would never get one again.
  - A mapping stays when a newer guide no longer declares its channel: the channel is then without a guide (listed in step 24c's list), and gets the channel back if the guide declares it again.
- **The refresh** reads the mappings from the profile itself (`readEpgOverrides`), so every path that starts one honours them: the scheduler, the guides screen's `refreshNow`, onboarding. A job's own `overrides` replace them (tests). Their key (`epgMappingKey`: a hash of the mappings in key order, `-` for none) is in the basis, so a guide is read again even when its bytes or its 304 say nothing changed, and is stored with each committed guide (`EpgMeta.mapping`).
- **Due:** `epgStatus` gives the key of the profile's mappings now (read fresh), and `epgRefreshDue(meta, now, mapping)` says `mapping` for a guide matched with another key, after the 2 h hold of a failure and before every other reason. So the scheduler's next `due` pass, or `refreshNow` after an edit, reads every guide again; a guide stored before step 24d counts as matched with none.
- **The search** (`QueryService.guideChannels({ epgSrc?, query, offset, limit })`): the declared channels of the active guides in priority order (or of one guide), each guide's in its own order, whose `search` holds each word of the query (normalized as the matcher does; any order; anywhere in a name or the id). An empty query lists every channel. Pages of at most `GUIDE_CHANNELS_MAX_ROWS` (500; a larger ask is refused); a limit of 0 gives the count alone; rows are `{ epgSrc, id, name }`; `version` bumps at each reload, as `unmatched`'s. Each guide's record is read once per reload, when first asked; a failed read is tried again at the next ask. A generation read before step 24d has no record: its channels in use (the match table's) are listed until the guide is read again.
- **No guide means none:** a channel mapped to no guide gets no panel short EPG either (`shortEpg` answers `none` with no request). The query worker reads the mappings at each reload and applies an edit at once, with the offsets' ordering. A mapping to a guide's channel needs the guides read again.
- **Tests:**
  - **Unit:** `epg-overrides.test.ts` (7: what is a mapping, a document's mappings, the key's order, what it tells apart); `profile.test.ts` (+6: set, change, take away, no guide, refusals, a removed guide's mappings, `readEpgOverrides`); `epg-store.test.ts` (+3: the search text, the record beside the match table and with its generation and guide, the `mapping` due reason); `epg-match.test.ts` (+1); `epg-mapping.test.ts` (7, through `runEpgRefresh` and the query service: every declared channel stored; a channel mapped to a channel nothing used, to another channel's, and to no guide, in now/next and the grid's rows after the refresh and not before; the job's mappings against the profile's; a mapping to the second guide; a newer guide without the mapped channel; an unchanged guide read again with no validator after a mapping, the key stored, due until then, conditional again after); `query-channels.test.ts` (7: order, the words and their normalization, Arabic and accents, pages, refusals, one read per reload, a guide read before step 24d, a failed read); `short-epg.test.ts` (+1); `tv-data-engine.test.ts` (+1: both guides read again after a mapping, then nothing due, the search through the real worker); `guides-state.test.ts` follows `EpgStatus.mapping`.
  - **At scale** (`epg-declared-300mb.media.test.ts`, `test:media`): the 300 MB guide read as the EPG worker reads it, its 5,000 declared channels built and stored in 8.4 ms (limit 60), the first search 2.2 ms (limit 20), each later one 0.5 ms at most (limit 5): the first and last pages, a channel by number, digits, an English, an Arabic and an accent-free French title (250 channels each), checked against the fixture's own names.
  - **Mutation:** `artifacts/mutate24d.py`, 76 mutants written before the run. Writing the list took out three masked guards (`epgOverridesOf`'s `typeof doc === 'object'`, the removed guide's `channel === null` skip, the search's filter of guides never read) and closed two test gaps (a word across two names, `epgOverridesOf(undefined)`). The run caught 75; the survivor was a test gap (the short EPG's "no guide" from an edit was hidden by the query worker's lazy first load after it), closed: 76/76.
- **Size:** main's own code 327.5 → 327.6 KB (Tizen) and 314.9 → 315.0 KB (webOS); the query worker 103.8 → 107.2 KB (`normalizeName` for the search); the EPG worker 117.3 KB; 219 core-js modules on both.
- **Not yet:** the picker and its search field, OK on a row of the list, and the details dialog's entry (step 24e); the screens' "Reading…" while the guides are read again. All built in step 24e (below).

**Built in step 24e: manual mapping, the screens** (`apps/tv/src/settings/mapping-state.ts`, `MappingPage.tsx`, `mapping.css`; `unmatched-state.ts`, `guides-state.ts`, `settings-state.ts`, `SettingsScreen.tsx`; `guide/programme-details.ts`, `ProgrammeDialog.tsx`, `guide-state.ts`, `GuideScreen.tsx`).
- **Where it opens:** OK on a channel of "Channels without a guide" (24c), and "Guide channel", the details dialog's new middle button (24a: "Watch the channel", "Guide channel", "Close"), for a channel the guides matched wrongly. The dialog closes first; Back from the picker comes back to the list or to the guide on the same cell. The picker (`guide-map`) is a settings screen on the live navigator, painted by the settings root.
- **The picker:** the header (title, the count found), a line naming the live channel and its current guide channel ("no guide has it yet", "now X, found by the guides", "now X, set by you", "now no guide, set by you"; X is the guide channel's name, looked up by its id in its own guide, or the id), the search field (the text editor; each change searches again from the list's top, older answers dropped; its note says why nothing is listed, or that the channels couldn't be read), then "No guide", "Match automatically" (only for a channel with a mapping: `pin: null`), and the guides' channels (`guideChannels`, pages of 50 around the window, six kept, all dropped on a newer version), each with its name (data), its id and its guide's link (as the guides screen shows it), seven rows of 88 px. The current match is checked: the profile's mapping (read by the app's own `pinOf`: `@zoma/data`'s helper would bring its module's polyfills into main), else now/next's match.
- **Choosing:** the current match, or a row not read yet, changes nothing. Another saves the mapping (`epgOverride`), then `refreshNow` (every guide is due, its mappings changed): "Reading the guides…" on the list without a guide and in the guide's header until that pass settles (`reading`, also in both roots' `data-pending`), then the list (`reload`: the profile and the window again) and the guides screen (`matchesChanged`) read their matches again; the live list and the grid hear from the scheduler's `onGuides`. Back changes nothing.
- **The list without a guide** marks a channel mapped to no guide ("No guide, set by you"): it is still listed, since no guide has it.
- **Tests:** unit `mapping-state.test.ts` (42), `mapping-screen.test.ts` (10), and additions to `unmatched-state`, `unmatched-screen`, `guides-state`, `programme-details` and `guide-state`; e2e `guide-mapping.spec.ts` (en-US, ar-SA: the mock's "18+ Test Pattern" mapped to a guide channel found by words typed, "Kids" in English and Arabic words in Arabic, its row in the live list and the grid with that channel's programmes after the refresh, the guide's download held for the "Reading…" screenshots; Back while typing and Back from the picker change nothing; "No guide" from the details of "Zoma Test 1 SMPTE", marked as the guides' match, empties its row while its twin keeps it); `guide.spec.ts` follows the dialog's third button, `guide-matches.spec.ts` opens the picker and walks it in en-XA.
- **Size:** main's own code 327.6 → 339.8 KB (Tizen) and 315.0 → 327.2 KB (webOS); app.css 69.0 → 71.6 KB; the workers unchanged; 219 core-js modules on both.

**Built in step 25a: catch-up from the programme details, Xtream** (step 25 was split in leg 60 into 25a, this; 25b, the M3U modes and the zone of an Xtream-shaped playlist; 25c, the guide's catch-up days, the archive marks and the low-tier tuning; 25d, the catch-up player's seeking, pause and the programme's end. `packages/player/src/request.ts`: `catchupCandidates`; `apps/tv/src/player/catchup.ts`; `DataEngine.sourceFacts`; `guide/programme-details.ts`, `ProgrammeDialog.tsx`, `guide-state.ts`; `player/player-state.ts`, `PlayerScreen.tsx`; the wide `Dialog`'s buttons):
- **The URLs** (`catchupCandidates`, beside `streamCandidates`): an `xc` channel (every Xtream source's channel; an M3U channel with an Xtream-shaped URL) gives the `/timeshift/` URL, `.ts` first, then `.m3u8`, keeping to the account's `allowed_output_formats` as live does; its start is the panel's wall time. Every other M3U mode gives the one URL `m3uCatchupUrl` makes (UTC until 25b gives a playlist its panel's zone). The URLs hold credentials: never logged.
- **The panel's zone:** `DataEngine.sourceFacts` (it replaces `outputFormats`) gives each source's formats and `panelZone(server_info).offset`, read when the live screen opens and after a catalog refresh, as the formats were. Before that read a play uses UTC and every format.
- **Which programmes** (`canWatchFromStart`): the channel states catch-up its URL can carry, the programme has ended, and it started within the channel's archive days. A channel that states no days (an Xtream `tv_archive` with no `tv_archive_duration`, M3U attributes without `catchup-days`) is taken as far back as the guide reaches: the provider's answer decides. The times are the ones the guide shows, the tvg-shift and the guide's offset included (ADR-010, amended in 24b): the offset makes the guide match what aired, and the archive holds what aired.
- **The details:** for such a programme, "From the start" comes first and has the focus, before "Watch the channel", "Guide channel" and "Close" (`detailsActions`). The guide decides it when the dialog opens (`DetailsTarget.archive`), and hands the programme to `catchup` only while its focus is still on that channel (as "Watch the channel" does).
- **The label is "From the start"** (Arabic "من البداية"), not "Watch from the start": with it the four buttons needed 1,160 px of the 1,100 px inside the wide panel. The wide dialog's buttons now wrap in a language with longer words (the pseudo-locale wraps to two lines), each line starting at the panel's padding: every button carries the leading margin and the row takes one back (Chromium 53–68 have no flex `gap`).
- **The player** (`Player.catchup(index, programme)`): opens on the channel's row and plays the `mode: 'catchup'` request (the controller's VOD rules: 20 s of buffering, a reopen at the last position). The info bar shows the programme's day, times and title (`player-archive`, the root's `data-archive`) instead of the live now/next. A zap, a number, PRE-CH or the card's "Channels" leave it for the live channels; "Try again" plays the programme again. A catch-up play doesn't change the profile's last channel: the start always plays live. The three openers share `openScreen`.
- **Not yet:** the progress through the programme, pause and seeking, and its end (25d); the archive's days in the guide (one past day today) and its marks (25c); the M3U modes in the app and a playlist's panel zone (25b); a programme on air from its start ("start over").
- **Noted:** the container that showed a frame is remembered per source for catch-up as for live (`SourceMemory`), so on the desktop a catch-up that plays as HLS puts HLS first for that source's live channels too. On a TV both forms play; if one plays only one of them, the memory will say so.
- **Tests:** 4,050 unit tests (+27: `request.test.ts` catch-up 5, `catchup.test.ts` 6, `programme-details.test.ts` +4, `guide-state.test.ts` +3, `player-state.test.ts` +5, `tv-data-engine.test.ts` the facts); e2e `guide-catchup.spec.ts` (en-US, ar-SA: a gone-by programme on 101 has "From the start" first; OK plays it, and the mock's archive answers carry the programme's own start (the `.ts` timeshift, then the `.m3u8`); the info bar names it; Back to the same cell; no such button on 110, which has no archive. en-XA: the four buttons wrap inside the panel. A Kathmandu panel (+05:45, `odd-timezone`): the URL's start is that zone's wall time, the mock serves the programme's start); `guide.spec.ts` presses "Watch the channel" (second now on 101) and checks it plays live; `player-media.spec.ts` (`e2e:media`): the same play shows moving frames from the archive's HLS.
- **Size:** main's own code 339.8 → 346.3 KB (Tizen) and 327.2 → 333.7 KB (webOS): core's catch-up builders and the panel zone now ride in main; app.css 71.6 → 72.5 KB; the workers unchanged; 219 core-js modules on both.

**Built in step 25b: catch-up from an M3U source, and the panel behind a `get.php` link** (`packages/data/src/ingest.ts`: `panelLogin`, `PANEL_LOGIN_MS`, `IngestOptions.panelLoginMs`; `epg-sources.ts`'s zones). No app code changed: 25a's `catchupCandidates` and `catchupRequest` already made every M3U mode's URL; what a playlist lacked was its panel's zone.
- **The login:** an M3U source whose link is an Xtream `get.php` link (`xtreamFromM3uUrl`) logs in to that panel (`player_api.php`) once per refresh, before the playlist is asked for, so a 304 or an unchanged playlist still takes the newer facts. The source then keeps the login's `server_info` and the account's `allowed_output_formats`, as an Xtream source does: `DataEngine.sourceFacts` hands both to the player, so an `xc` channel's timeshift start is the panel's wall time, and its `.ts`/`.m3u8` forms follow the account (live's Xtream-shaped URLs too). A plain playlist has no login and `server: null`, as before.
- **It never fails the refresh** (ADR-010, "Applied in step 25b"): a refused login, an error status, a page that isn't JSON, an answer without `user_info`, a broken body, or one slower than 10 s (`PANEL_LOGIN_MS`) leaves the source's facts as its last login left them (UTC without one) and reads the playlist. A login past the limit is dropped: its open answer is cancelled, and an answer that comes later is cancelled unread. The login has its own transport: it isn't hashed (the panel's clock changes on every call), doesn't count in the progress, and doesn't take over `current`. A cancel during it stops the refresh before the playlist is asked for.
- **The playlist's own guide:** a guide the header names that is a panel's `xmltv.php` with a login is read in the source's panel zone (`epgGuides` gives `{ panel: <src> }`), as an Xtream source's own guide is. A panel that writes its XMLTV without offsets (Kathmandu's `odd-timezone`, or Riyadh in the e2e) then shows the programmes as they aired, and catch-up asks the archive for those times. Every other guide a playlist names stays UTC.
- **The modes, checked against the mock:** `xc` (101, 112) `/timeshift/` in the panel's zone; `default` (102) the filled `catchup-source`; `append` (103) and `shift` (105) `?utc=&lutc=` on the live URL (the mock plays on to now); `flussonic` (106) `timeshift_abs-{start}.ts` for the `mpegts` URL and `index-{start}-{dur}.m3u8` for the HLS one.
- **The offset:** with +1:00 on the playlist's guide, "From the start" asks for the shown start, an hour after the mock's own programme (ADR-010, 24b).
- **Tests:** `ingest.test.ts` (+7: one login before the playlist, the facts kept and the stamp the playlist's alone; a 304 and unchanged bytes still taking the newer login; six kinds of failed login keeping the last facts, and UTC without any; the time limit; an answer after it, cancelled unread; a gzipped answer; a cancel during the login. The generic M3U tests now use a plain playlist link); `epg-store.test.ts` (+1: a playlist's panel guide in its zone, other guides in UTC); `test/ingest-mock.test.ts` (+1: a Riyadh panel's zone and the account's formats from the mock's `get.php`); `test/tv-data-engine.test.ts` (+1: the login's zone and formats through `DataEngine.sourceFacts`); `test/catchup-m3u-mock.test.ts` (6: every mode's request from the stored items against the mock's `X-Mock-Archive-*` headers, on UTC and Riyadh panels with both `output` forms; +1:00 an hour later; a failed login: UTC, an `xc` start three hours early on a Riyadh panel, the epoch modes unchanged); `test/epg-ingest-mock.test.ts` follows the panel zone. e2e `guide-catchup-m3u.spec.ts` (en-US, ar-SA: onboarding by keys with the mock's `get.php` link on a Riyadh panel whose XMLTV has no offsets; a gone-by programme on 101, 102, 103, 105 and 106 matches the mock's own schedule and plays "From the start": each mode's URL, the archive answers from the programme's start for at least its length, the `xc` start in Riyadh's wall time. en-US: +1:00 on the playlist's guide by keys, then 101 and 102 ask for the shown start, an hour later); `e2e/onboard.ts`'s `addM3uAndWatch`. Screenshots `guide-catchup-m3u-{en-US,ar-SA}-{details,player}` looked at.
- **Mutation:** `artifacts/mutate25b.py`, 27 unit mutants written before the run, after closing two gaps the list showed (an answer after the time limit; a gzipped answer). 25 caught on the first run. The cancel listener's removal survived: the cancel test passed by waiting out the 10 s limit under the 30 s test timeout. It now sets a 5 s limit and wants the stop within 1 s, and the re-run catches it. The other survivor is equivalent (`'fflate'` for the caller's gunzip mode decodes the same bytes). `artifacts/mutate25b-e2e.py` runs the new spec against the chain's three links (no login, the playlist's guide in UTC, the request without the source's facts): 3/3 caught.
- **e2e note:** the mock's synthetic media fails at once, and an M3U mode has one URL to try (an Xtream channel tries `.ts`, then `.m3u8`), so under load the player's error card can take the focus before a check for the info bar's first button looks. The spec accepts either (`player/actions/0` or `player/card/0`); the archive line and the mock's answers are what it checks.
- **Size:** main's own code 346.3 → 346.9 KB (Tizen) and 333.7 → 334.3 KB (webOS); the ingest worker 126.0 → 127.9 KB (the panel login); the query and EPG workers and app.css (72.5 KB) unchanged; 219 core-js modules on both.

**Built in step 25c: the catch-up days in the guide, and the archive marks** (`apps/tv/src/player/catchup.ts`: `archiveDays`, `archiveFrom`, `inArchive`, `archiveDaysLeft`; `guide-state.ts`: `guideRange`, `GUIDE_REACH`, `Guide.archive`; `DataEngine.guidePastDays`; `GuideGrid`'s `archive`/`archiveName`; the details' days left):
- **The range:** the guide reaches back as far as the stored guides keep: their last refreshes' windows (`EpgSummary.pastDays`), which keep the matched channels' longest catch-up within the tier's limit (`EPG_WINDOWS`: 7 days in the full tier, 2 in the low one), at least the one day every window keeps (`guideRange(tier, pastDays)`). The guide reads them (`DataEngine.guidePastDays`: the longest over the guides) when it is made and after each guide swap; the guide opens at once on the range it has (no wait on a key press). An open guide whose range a read changes gets it at once: its zone's `from` moves, the focus and the view stay, and the days read are kept, because a row's days are kept by their local midnight (`row:midnight`) rather than by their place in the range. A read that answers after a newer one is dropped; a failed read keeps the range it had.
- **The archive marks:** a programme in its channel's archive (it has ended, and started within the channel's days: the test the details' "From the start" uses, now `archiveDays` + `archiveFrom` + `inArchive`) has `is-archive` and a mark: a span after the title holding "Catch-up" (`badge.catchUp`), so the cell's text names it after the title, drawn before the title by flex `order` as a 20 px circular arrow (a border with its top side clear, and a triangle) in the cell's text colour, its text pushed past the cell's far edge, where the cell cuts it off. The guide keeps each read row's archive days (`archiveDays` builds the channel's catch-up URL once, to see that it can carry one) until the rows change, and works out the first minute of the archive from the clock per drawn row (`Guide.archive`). A channel that states no days is taken as far back as the guide reaches. Placeholders and rows without programmes never ask.
- **The details** say how long a programme in the archive can still be watched: "Expires in N days" or "Expires today" (`badge.expires`), the local calendar days from today to the day it leaves the archive (`archiveDaysLeft`: its start plus the channel's days), in the line with its day, times and length. Nothing when the channel states no days.
- **Decided (not a gate):**
  - The range follows the stored guides, not the catalog's channels: the guide can't show programmes the store didn't keep, and the window already holds the longest catch-up of the channels the guides match.
  - Days are counted on the calendar ("Expires today" for one that leaves at 23:00 tonight, "in 1 day" for one that leaves at 01:00 tomorrow), as a TV guide's viewer reads them.
  - No day jump: reaching six days back takes about 140 presses of LEFT on an hourly channel (half that by holding the key). FF/RW or a day picker is a later decision (the Magic Remote has no FF/RW).
- **Tests:** `catchup.test.ts` (+5: the days by mode and URL, the first minute at a half minute, `inArchive` against `canWatchFromStart`, the calendar days left, across the four 2026 DST changes); `guide-state.test.ts` (+8: `guideRange` by tier, the range opened on 7/2/3 days, an open guide widened with the focus and the days kept, a guide swap's read and a stale answer dropped, a failed read, each row's archive and its cache, the days left in the details); `guide-grid.test.ts` (+4: the mark after the title and its class, nothing older or without an archive, from the minute a programme ends, never a placeholder, the range on the grid); `programme-details.test.ts` (+1: the days-left line in English and Arabic); `test/tv-data-engine.test.ts` (+1: 5 days from a 5-day catch-up channel, 2 in the low tier, 1 without catch-up). e2e `guide-catchup-days.spec.ts` (en-US, ar-SA): the range from local midnight seven days back (101's archive), the marks on every drawn cell against the mock's archives (a gone-by programme within its channel's days has it, named "Catch-up"; none on air, to come, or without catch-up), a programme six days back on 101: its mark inside its cell at the title's inline start, "Expires in 1 day" (or "today") in its details, its play from the mock's archive at its start; then on to the range's first minute. `e2e/guide-grid.ts` reads a cell's title from its title span and its mark's text. Screenshots `guide-catchup-days-{en-US,ar-SA}` and `-details` looked at: the mark is at the cell's right in Arabic, the arrow mirrored.
- **Mutation:** `artifacts/mutate25c.py`, 60 mutants written before the run, after closing four gaps the list showed (the mark's height, the walk's `earlier` checks, a mark on another guide step, the fixture playlist's catch-up attributes). 57 caught on the first run. `merged.clear()` on a range change survived, a real gap (a range that narrows and widens again drew the merge made over the narrow one): now tested. The range change's `scheduleAsk(0)` survived and was redundant (the view doesn't move; a cursor the new range moves asks through the focus listener): taken out. `markFailures` without `days > 0` is equivalent. The guide's 19 re-run: 19/19. `artifacts/mutate25c-e2e.py`: 4/5; the survivor (no re-read after a guide swap) is out of the e2e's reach, because onboarding stores the guide before the live screen, and the unit tests catch it.
- **Size:** main's own code 346.9 → 348.7 KB (Tizen) and 334.3 → 336.1 KB (webOS); app.css 72.5 → 73.9 KB (the mark and its mirrored rules); the workers unchanged; 219 core-js modules on both. Unit tests 4,066 → 4,095.

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
- **Database version 2** (step 9b, migration 2): `epg_meta` (keyPath `epgSrc`), `epg_buckets` (key `[epgSrc, gen, channel, day]`) and `epg_channels` (key `[epgSrc, gen]`; since step 24d also `[epgSrc, gen, 'declared']`, the guide's declared channels, with no migration: the store has no key path); §1.5 "Built in step 9b". `schema.test.ts` pins it and upgrades a seeded version 1 to it.
- **The profile document** is versioned on its own (`profile.ts`, version 1 = favourites; version 2, step 13b, adds the sources and the onboarding answers; version 3, step 20c1, what the player keeps; version 4, step 22b1, the user's guide list, §1.5 "Built in step 22b1"). Older documents are upgraded on load, and the old copy goes to a snapshot. A save snapshots the replaced document at most once a day, into 3 rolling slots, and a restore can itself be undone. A document from a newer app version is shown but never overwritten.

**Storage space.** On Tizen, request the `unlimitedstorage` privilege. Spike S2 measures webOS quota. Budget: catalog ≤ 60 MB; EPG ≤ 100 MB on full-tier TVs and ≤ 30 MB on low-tier ones.

### 1.4 Catalog pipeline (ingest worker)

1. **Trigger.** A refresh runs when a source is added, when the user asks, or at launch if the cache is stale (live after 12 h, VOD and series after 24 h; both values come from remote config). Startup always shows the cached generation immediately. Built in step 22a (§1.5 "Built in step 22a"): a source's lists come in one refresh, so a source is refreshed 12 h after its last check, at the start and while the app runs.
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

   The method used is stored for each channel. Diagnostics shows the match rate per source and lists unmatched channels for manual mapping (built in step 24c: each guide's matches from its summary, and the live channels no guide matches once they are combined; §1.2, "Built in step 24c"). The manual mapping's data is step 24d (the mappings in the profile, every declared channel stored and searched; §1.2, "Built in step 24d"), its screens step 24e.
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
  - An override pins a playlist channel to one guide channel (or to no EPG), and blocks it everywhere else. The user's are kept in the profile and read by each refresh (step 24d).
- **Reading a guide** (`EpgGuideReader`): decoded text in, buckets out.
  - The tokenizer hands each item over in document order (`onItem`), so its `wantChannel` sees every channel declared before the programme. Programmes of unmatched channels are skipped before they are tokenized.
  - Programmes of a channel declared later wait, up to 20,000 of them, and are dropped if their channel never comes. A programme-only id that matches by id alone is declared on the spot.
- **Times** are UTC epoch minutes.
  - A time without an offset is read in the fallback zone and settled to the earlier instant of a repeated DST hour (`parseXmltvTime` alone gives the later one east of UTC). A start that then falls before the channel's previous stop moves forward an hour, and so does a stop that ends before its start, or one of a programme whose start moved (ADR-010).
  - A lone boundary in the repeated hour, such as a 90-minute programme ending at the second 01:00 with the next one starting there, reads the same either way. It is taken as the earlier instant, an hour early; `test/epg-mock.test.ts` pins that case.
  - The user's time offset per guide (step 24b) isn't added here either: the query worker adds it with the tvg-shift when it reads (§1.2, "Built in step 24b"), so a change needs no download.
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
  - `epg_channels`, one record per guide generation: the match table (each live channel's XMLTV channel, method, tie flag and tvg-shift), the XMLTV channels it uses, and the unmatched live channels (for step 24's diagnostics). Since step 24d a second record per generation, `[epgSrc, gen, 'declared']`, keeps every XMLTV channel the guide declares, for the manual mapping's search.
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
- **Nothing new:** while the basis is the same (`EPG_INGEST_VERSION`, the tier, every source's active generation, the key of the user's mappings), a 304 for the guide's own validators, or the same bytes, keeps the stored generation and only prunes its past days. A new catalog generation reads the same bytes again, because new channels may match.
- **Failures:** each guide fails on its own, and its new generation is abandoned:
  - a guide cut short (the tokenizer ended inside an element) and a body that is not XMLTV (no channel and no programme) fail with `format`;
  - HTTP, auth and network errors fail with their own codes;
  - `failedAt` holds a failed guide back for 2 h;
  - a cancel stops the whole refresh;
  - messages never contain URLs.
- **When** (`epgRefreshDue`): a guide with no generation; 12 h after its last check; or when its programmes end less than 24 h ahead. Never within 2 h of the last check, or a guide that only covers a few hours would be fetched in a loop. The app asks with `refreshEpg(..., { due: true })`; the schedule that asks while the app runs is step 22a's (below).
- **One refresh at a time:** `DataEngine` runs catalog and EPG refreshes in one slot and refuses a second ("A guide refresh is already running"), so a low-tier TV never runs both at once. Remote keys pause an EPG refresh as they pause a catalog one.
- **Now/next** (`QueryService.nowNext`): the active generations' match tables are combined in guide order (`combineEpgMatches`) at each reload. For each live channel, the buckets of days `d - 1` to `d + 1` are read in one transaction, `d` being the UTC day at now minus the channel's tvg-shift (and, since step 24b, its guide's time offset). `epgStatus` lists the guides and sources fresh from IndexedDB.
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

**Built in step 22a: the refresh schedule in the running app** (step 22 was split in leg 46 into 22a and 22b, the guides screen; `apps/tv/src/data/refresh-scheduler.ts`; `DataEngine.sourceStatus`; the live screen's `guidesChanged` and `catalogChanged`; the player's `listChanging`):
- **What leg 46 found:** nothing refreshed anything after onboarding. `refreshEpg` had three callers (onboarding, the hello screen, the lab), and the catalog's "at launch if stale" (§1.4 item 1) had none.
- **When** (`createRefreshScheduler`, started by the app with the live screen):
  - a first check 15 s after the live screen opens (`FIRST_CHECK_MS`), so the start on the last channel and the first list stay fast;
  - then every 15 min (`CHECK_MS`), counted from the end of a pass, never two at once;
  - nothing while the app is hidden (`Platform.onLifecycle`); a check 15 s after it is visible again (a relaunch counts).
- **A pass:**
  1. **Catalogs:** each stored source whose last check (`SourceMeta.checkedAt`, else `updatedAt`) is 12 h old (`CATALOG_REFRESH_MS`), or that has no catalog at all (webOS may wipe the database on an update), is refreshed through `DataEngine.refresh`, one at a time, at the duty cycle on a low-tier TV.
     - A failure holds that source for 2 h (`CATALOG_RETRY_MS`). It is kept in memory, so a relaunch tries again.
     - PLAN.md's separate "VOD after 24 h" doesn't apply: a source's lists come in one refresh.
  2. **The screens hear of new catalogs** (`onCatalog`).
  3. **Guides:** `refreshEpg(..., { due: true })` for every source's guides and the user's.
     - After a catalog committed, every guide is read instead: new channels may match. The basis changed, so each guide is downloaded again (at most every 12 h, with the catalog).
     - When a guide swapped in, or one no longer listed was deleted, the screens hear of it (`onGuides`).
- **One refresh at a time:** the data engine's slot (§1.5, "One refresh at a time").
  - When something else holds it (onboarding, the hello screen), the pass stops and the next check comes in a minute (`BUSY_RETRY_MS`).
  - The catalogs that committed before it stopped are told at once, and the next pass reads every guide.
- **The live screen:**
  - **A guide swapped in** (`guidesChanged`):
    - every answer becomes stale (a guide epoch), and the rows on show are asked again after the 200 ms rest; each row keeps its old answer until the new one comes;
    - an answer asked before the swap is shown when it comes, then asked again;
    - the player's channels (the last 4 asked through `list.askGuide`, the info bar's) are asked with the rows, and from now on also at the minute tick once their programme has ended.
  - **A catalog swapped in** (`catalogChanged`):
    - the sources and categories are read again without the loading screen; a screen still loading, or failed, loads the usual way;
    - the rail entry on show stays (by source and name; "All channels" when it is gone);
    - the chunks are read again from the new generation, and now/next stays (ContentKeys don't change);
    - the focus follows the channel it is on when the new list comes, found from its row outwards as `locate` does. It stays on its row when the channel is gone, or when the focus moves while the channel is being found.
  - **The player** (`listChanging`, called while the old list can still be read):
    - the stream isn't touched;
    - the row playing is pinned (the start's mechanism, step 20c1) and moves to its row in the new list once `locate` finds it;
    - PRE-CH's channel moves too, or goes when it is gone;
    - a zap that waits plays the new list's row when it fires.
- **Not yet:**
  - the guides screen (22b): list, add, remove and order the user's XMLTV links, with a refresh after a change (built in 22b1 and 22b2a, tested in both languages in 22b2b, below);
  - a refresh while the app is closed (§7);
  - holding refreshes while a low-tier TV plays (step 41): the duty cycle and the busy pause are all there is;
  - a catalog change in e2e: the mock serves one catalog, so the quiet reload is covered by the unit tests only.
- **Tests:**
  - **Unit:** `refresh-scheduler.test.ts` (29: the 12 h and 2 h rules to the millisecond, the delays, the order, the job, every guide after a commit, the busy slot before a catalog and before the guides, failures, hidden and visible, dispose at each point), `live-state.test.ts` (+24: the catalog swap's category, focus, chunks, the player's turn, empty, loading, failed, stale answers; the guide swap's re-asks, stale answers, the player's channels, a panel's answer from before), `player-state.test.ts` (+7).
  - **e2e** `refresh.spec.ts` (`pnpm verify`'s 64 green locally): onboarding on a panel whose guide is off (scenario `no-xmltv`); the panel turns it on; the page's Playwright clock jumps 2 h and the app reads the guide by itself, and every row shows the mock's programme at the page's time; 12 h after the start it reads the catalog and the guides again, on the same focus. It fails with the scheduler off. The mock's row helpers moved from `live.spec.ts` to `e2e/live-rows.ts`.
  - **Mutation:** 82/85 on the first run (`artifacts/mutate22a.py`), then 84/84.
    - Before the run, guards that others mask went: the scheduler's checks for a disposed, hidden or busy state at a check (nothing schedules one then), a second dispose's, the lifecycle listener's after dispose, a separate busy flag, and clearing a failure on success (a failure is always 2 h old by the next try); the live screen's "on the list" check (the found row's own check covers it), the empty list's reset index, and `guidesChanged`'s own state checks (`askGuides` has them); the player's `-1` checks (no row is -1).
    - The three survivors: re-asking the oldest of the player's channels hid the list's de-duplication, and the "channel gone" test lost its row to clamping, which hid the `found === -1` check (two new test cases). The `bump()` after the swap was masked by the new rail, which redraws the screen anyway, and went.
- **TV bundle:** main's own code 272.9 → 276.6 KB on Tizen and 260.3 → 264.0 KB on webOS; 219 core-js modules on both.

**Built in step 22b1: the guide list in the profile, and what the guides screen needs from the refresh** (step 22b was split in leg 47 into 22b1 and 22b2, the screens; `packages/data/src`: `profile.ts`, `epg-store.ts`, `epg-ingest.ts`; `apps/tv/src`: `data/engine.ts`, `data/refresh-scheduler.ts`, `onboarding/engine-loader.ts`):
- **Profile version 4** keeps the user's guides as one list, `guides: UserGuide[]`, in the user's order (they come before every source's own guide, as before). `SourceRecord` has no `epgUrl` any more; the 3 → 4 migration moves each source's link to the list:
  - under the source's id, so the guide keeps its stored records (`u~<id>`) and nothing is downloaded again;
  - in source order, a link two sources shared listed once, under the first (the one the refresh had kept);
  - an empty or missing link gives no guide; sources that aren't a list, and entries that aren't records, stay as they are.
  - Guide ids: a guide moved from a source or typed in onboarding has its source's id (`s<n>`, never reused); one added on the guides screen gets `g<n>` (22b2). Neither may contain `:` or `~` (epg-sources.ts).
- **The edits** (`ProfileEdit` `{ kind: 'guide', change }`, applied in the query worker's read-modify-write): `add` at the end (an id or a link already listed changes nothing), `remove` by id, `move` to a place (clamped to the list). Each returns `null` when nothing changes, so nothing is written.
- **Onboarding** puts the typed link into the list after the source is saved (two edits), under the source's id, unless the list has the link already. A guide that fails to read stays in the list; the refresh tries it again 2 h later.
- **Why a guide failed:** `EpgMeta.failure` (`{ code, status }`: the ingest's code, `http` with its status, or `failed`), set by `markEpgFailed` and cleared by a refresh that finishes. Optional, so the schemaless `epg_meta` records need no database migration. The refresh's outcomes carry the status too.
- **A moved guide, with no download:** a guide's `rank` is its place in the list the refresh gets. The refresh's first step (which already deletes the guides no longer listed) now also sets each stored guide's rank to its place (`setEpgRank`), and lists them in `EpgRefreshResult.reranked`.
  - The data engine starts the EPG worker for a `due` refresh when a guide is due, or when a stored guide is no longer listed or not at its place (`listed.indexOf(epgSrc) !== rank`, one check for both). After a rank change it reloads the query worker, which orders the match tables by rank.
  - A refresh with nothing to read (`only: []`) returns after that first step, without reading the live items (the wanted set reads every live item of every source).
- **`RefreshScheduler.refreshNow()`** (for the guides screen): a pass of the guides alone, at once, or right after the pass running; calls made meanwhile share one pass. A catalog that is due waits for the next check, which comes `CHECK_MS` after this pass. It settles when its pass has ended, whatever it did (at once once disposed). In that pass a new guide is due at once (no record yet), a removed one is deleted, a moved one gets its rank, and `onGuides` tells the live screen when any of that happened.
  - A guide held back after a failure (2 h) is not read sooner: there is no "refresh now" that overrides the hold. Removing it and adding it again gives it a new id, read at once.
- **Decided for 22b2, where the guides screen opens:** a "Settings" button at the end of the live screen's header, reached with UP from the first row of the rail or of the list. It opens a small settings screen whose one row, "TV guides", opens the guides screen; step 38 adds the other settings to it. No new remote key: a new intent would make S10's key battery ask every TV for it.
- **Tests:**
  - **Unit:** `profile.test.ts` (version 4 pinned; the 3 → 4 migration: order, ids, a shared link, empty and missing links, odd sources, the input untouched; the edits: add, remove, move with clamps and fractions); `epg-store.test.ts` (the failure stored, replaced and cleared; `setEpgRank`); `epg-ingest.test.ts` (each failure's code and status kept; ranks set with no download and no swap; a refresh that reads a guide in its new place); `query-service.test.ts` (the guide edit over RPC; a stored version 3 profile upgraded); `refresh-scheduler.test.ts` (+9: `refreshNow`'s guides-only pass, its settling, calls during a pass, hidden, dispose; `onGuides` for a moved guide; a profile without a list); `engine-loader.test.ts` (+4: `userGuides`, `typedGuide`, the guide edit after the source); `test/tv-data-engine.test.ts` (+1: a moved guide's rank set with no download and the query worker reloaded, so now/next comes from the other guide; a removed one deleted; the same list again starts no worker); `test/onboarding-loader-mock.test.ts` (the typed link in the profile's list).
  - **e2e:** `onboarding.spec.ts` reads back profile version 4 with the typed link in `guides` and no `epgUrl` on the source, in English and Arabic. `pnpm verify` green locally (3,330 unit tests, 64 e2e).
  - **Mutation:** 60/60 on the first run (`artifacts/mutate22b1.py`). Before it, two guards that the tests would have masked got their cases: a move rounded down or clamped to its own place changes nothing (`Math.floor`, `Math.max`: `splice` rounds and clamps on its own), and a guides-only pass doesn't read the sources' status.
- **TV bundle:** main's own code 276.6 → 277.0 KB on Tizen and 264.0 → 264.4 KB on webOS, 219 core-js modules on both; the query worker 98.8 → 99.6 KB, the ingest worker 125.6 → 126.0 KB (it carries the profile's migrations for the favourites update), the EPG worker 115.2 → 115.6 KB. The migration copies the fields of a source one by one: an object rest or an array destructuring would bring Babel's helpers into the workers.

**Built in step 22b2a: the settings screen and the guides screen** (step 22b2 was split in leg 48 into 22b2a and 22b2b, the full e2e and the checklist; `apps/tv/src/settings`: `settings-state.ts`, `guides-state.ts`, `SettingsScreen.tsx`, `settings.css`; the live screen's `header` zone):
- **The way in:** the live screen's header ends with a "Settings" button (zone `header`), reached with UP from the first row of the rail, the list or "Try again" (each zone's `up` neighbour).
  - DOWN or Back goes back to the zone the focus was in last, on its item (the Magic Remote's pointer can take the focus there from any row). While the screen loads nothing is below: DOWN stays, and Back follows the platform.
  - OK opens the settings screen (`LiveOptions.openSettings`). No new remote key.
- **The settings screen** (`settings`, pushed on the live navigator) has one row, "TV guides". Step 38 adds the track languages, the subtitle style and the picture mode. The live screen paints the settings screens instead of its own (`SETTINGS_SCREENS`), as it does for the player.
- **The guides screen** (`guides`): "Add a guide" in the header, a line on how the order counts, then one list of 6 rows of 120 px:
  - the user's guides in their order, then each source's own in the refresh's order (`epgGuides`: a panel's `xmltv.php`, a playlist's `url-tvg`). A source's guide with the same link as one of the user's is read, and listed, once, as the user's;
  - each row: the link as host and path (`shownLink`: no scheme, query, fragment or login; an Xtream guide's login is in its query), and "Added by you" or "From <source>";
  - then what `guideState` says: `read` (the programmes' end in the TV's day and time, and "Channels matched: n of m (p%)" from the summary), `failed` (nothing stored, and the last try failed), `reading` ("Reading…": nothing stored while a change's refresh runs) or `unread` ("Not read yet");
  - a failure line says why the last try failed (`EpgMeta.failure`: the HTTP status, refused access, unreachable, not an XMLTV guide, no live channels to match; anything else is "tried again later"), on a read guide too.
- **Changes:**
  - OK on one of the user's guides opens its menu (`guide-menu`): Move up and Move down (only where the guide can go), Remove, Cancel. A source's guide has no menu.
  - "Add a guide" opens the form (`guide-add`): a link field (`TextField` and the text editor: Done moves to "Add") and Add / Cancel. `checkLink` refuses, on the field: nothing typed, spaces, not an http(s) link or a login in it (onboarding's `normalizeLink`), or a link already on the screen (the user's or a source's).
  - A new guide's id (`nextGuideId`): one past the highest `g<n>` among the list's ids, the stored guides' (`u~g<n>`) and the ids given out since the last read.
  - Each change runs after the one before: `editProfile({ kind: 'guide', change })`, then the list read again, then `refreshNow` ("Reading…" until it settles), then the status read again. The focus follows a moved or added guide; after a remove it stays on its place, and goes to "Add a guide" when none is left.
  - A read that a newer one replaced is dropped. A change is saved even when the screen went meanwhile. `pending` counts the reads, edits and refreshes (`data-pending` on the screen's root, for the e2e).
- **Tests:**
  - **Unit:** `guides-state.test.ts` (52: the layout numbers, `shownLink`, `nextGuideId`, `menuActions`, `checkLink`, `guideState`, `guideList`; the screen by keys: loading, empty, failed reads, stale reads, the menu, each move and remove with its edit, refresh and read, the focus after each, changes in turn, failed edits and refreshes, the add form's checks and ids, dispose at each point; the settings screen), `settings-screen.test.ts` (3: the failure and status text), `live-state.test.ts` (+5: the header from the list, the rail, "Try again" and while loading; the pointer's row; a screen pushed from it; no short guide asked).
  - **e2e** `guides.spec.ts` (English, by keys against the in-process mock on the real clock): UP to the header's "Settings", "TV guides", the panel's own guide read at onboarding (its host and path, no login on the screen), then "Add a guide" with the mock's `/epg/guide.xml`: it comes first, focused, read at once ("Channels matched: 11 of 12 (92%)"), and the profile holds it as `g1`; Back to the settings, then to the header. Screenshots `live-header-en.png`, `guides-en.png`, `guides-add-en.png`, `guides-added-en.png` in `artifacts/screenshots`. Step 22b2b replaced it with four tests (below).
  - **Mutation:** `artifacts/mutate22b2a.py`, written before the run with the guards other code covers already removed (the menu's and the form's own "on top" checks, a closed screen's check that `Screen` does itself, a source row's kind next to the id it never has, the active-zone check before "Add a guide"). 93 of 94 caught; the survivor was the "not while loading" check, which can never be false once `open` stopped placing the focus before the first read: removed, 93/93. The same pass found four test gaps first (a `?` before a `#` in a link, UP from the form's buttons, a followed guide's focus left alone at the next read, an id only the profile holds).
- **TV bundle:** main's own code 277.0 → 294.5 KB on Tizen and 264.4 → 281.9 KB on webOS, 219 core-js modules on both: about 6.6 KB is the 32 new strings in each catalog (terser's `ascii_only` writes each Arabic letter in 6 bytes) and 11 KB the screens. The workers didn't change.

**Built in step 22b2b: the guides screen's e2e in English and Arabic** (`e2e/guides.spec.ts`; one fix in `apps/tv/src/settings/settings.css`):
- **e2e** (by keys against the in-process mock on the real clock; each test in `en-US` and `ar-SA`, so four):
  - **Add, move, remove:** UP to the header's "Settings" and back down, "TV guides"; the panel's own guide (`dir=ltr`, host and path, no login; OK on it opens nothing); "Add a guide" with `/epg/guide.xml` (first, focused, read: its end and "11 of 12 (92%)"), then `/epg/guide.xml.gz` (second, focused, read). The second's menu offers Move up, Remove, Cancel (in that order, in the language); Move up puts it first with the focus, the first's menu offers Move down and puts it back; Cancel and Back change nothing; Remove drops it, the focus staying on its place (now the panel's guide). The profile is read back after each change (`id url` in order). Back to the settings, the header, the list.
  - **Failures and refusals:** `/epg/missing.xml` (the mock's 404) is `failed`, code `http`, "Couldn't read it: the server answered with error 404."; a playlist link (`get.php?…&type=m3u_plus`) is `failed`, code `format`, shown as `host/get.php` (never the login); the panel's own `xmltv.php` link with its login is refused on the field ("already in the list"), and Back closes the form with nothing added.
  - **Layout, in both directions:** every box inside the title-safe area, no page scroll, none of our texts cut (`layout()`, as `live.spec.ts`), with the add form, the menu and the refusal on screen too. In Arabic the links (`dir=ltr`), the status and failure lines start on the right and the owner sits on the left; the header's "Add a guide" sits on the side opposite the title; the form's "Add" comes first (on the right in Arabic) and the arrows follow (LEFT goes to "Cancel" in Arabic); the menu's buttons are as wide as the dialog, each label on the screen's side.
  - Screenshots in `artifacts/screenshots`: `live-header-`, `settings-`, `guides-`, `guides-add-`, `guides-added-`, `guides-menu-`, `guides-removed-`, `guides-failed-`, `guides-listed-` with `en` and `ar`, all looked at.
- **Fixed:** the menu's buttons stopped at a button's own 640 px cap (`.z-button { max-width }`) while the CSS meant them as wide as the dialog; `.guides__menu .z-button { max-width: none }`.
- **Found on the way (test only):** a row count read apart from the rows can race a remove (the count still 3, two rows drawn), and Playwright's auto-wait on the missing row hung the poll; the spec reads the rows in one `page.evaluate`.
- **Mutation:** `artifacts/mutate22b2b.py` runs the spec against 11 mutants of the CSS (the menu's width, the link's side in Arabic, the safe area, the header's order), the markup (the link's `dir`, the 404's text) and the state (the query left in a shown link, the "already listed" check, the focus following a change, Move up, Remove): 11/11 caught.
- **Checks:** 3,518 unit tests (unchanged); `pnpm verify` green (68 e2e, +3).
- **TV bundle:** main's own code unchanged (294.5 KB on Tizen, 281.9 KB on webOS): the CSS isn't in main.js, and no TV script changed.

**Built in step 23a: the grid guide's data** (step 23 was split in leg 50 into 23a, the data; 23b, the grid component; 23c, the guide screen; 23d, the throttled e2e; core `epgSchedule`; `QueryService.guide`; `DataEngine.guide`):
- **The ask:** `guide({ keys, from, to })`, live channels over `[from, to)` in UTC epoch minutes. Each answer row is `{ key, epgSrc, start[], end[], title[] }`: the programmes that end after `from` and start before `to`, uncut, in plain arrays.
  - **Titles only.** Programme details (step 24) will ask for one programme's description and episode on their own.
  - **No typed arrays leave the worker**, so the grid's code on the main thread never names one and pulls no typed-array polyfill (35 core-js modules).
- **Which guide:** the same rule as now/next. The match tables are combined at each reload (`combineEpgMatches`: the stronger method, then the guide listed first), so a channel's row and its now/next in the list always come from one guide channel. A lower guide doesn't fill hours the winning one lacks: placeholders show there (step 23b), as the list shows the placeholder for an unmatched now.
- **Reads:** the channel's buckets of the days the range covers in its own time (the range moved back by its tvg-shift), and the day before: a programme from the evening before can still be on at `from`. One transaction for every row. A channel no guide matches gets `epgSrc: null` and no programmes.
- **The cut across days:** each stored bucket is sorted with no overlap, but one day's last programme can run past the next day's first. `epgSchedule` ends it where that one starts (and drops it when that leaves it before the range), as the reader does inside a day.
- **A cap:** an ask of more than `GUIDE_MAX_READS` (2,000) channel-days is refused (`RangeError`) before anything is read, not cut, so a caller can't take part of an answer for the whole. A screen's rows and a page either side over two or three days is a few hundred.
- **Tests:**
  - core `epg-guide.test.ts` (+5): the range's edges, an empty range, the shift both ways, the cut across days (with the shift too), and a fast-check property (1,000 runs: up to four days of random programmes, some days missing, any range and shift) against a naive oracle (the programmes in order, each cut by the next, then filtered).
  - `query-guide.test.ts` (5, guides written straight into the store): the rank rule against a stronger method in the second guide, a shift of +1, unmatched and unknown channels, every minute agreeing with now/next; the day before, a channel three hours early whose range is tomorrow in the guide, one an hour late whose programme is stored under the day before; an empty range; the cap at exactly 2,000 reads, counted over every channel; a new generation after a reload.
  - `epg-ingest.test.ts` (+1): after a real refresh, five hours across midnight equal the reader's own buckets for every channel (the +1 copy shifted), and agree with now/next.
  - `test/tv-data-engine.test.ts`: the app's call through the real worker services, and the cap's error across the RPC.
  - **At scale** (`test/guide-300mb.media.test.ts`, `pnpm test:media`): the 300 MB guide read as the EPG worker reads it (every live channel of the 200k playlist wanted, the full tier: 1,331,136 programmes of 5,000 channels) and written into fake-indexeddb as the refresh writes it (7.2 s). 24 live channels in a row of the playlist (some unmatched, one with 150-minute slots that run across midnight), over the hours in view, two days ahead, and three catch-up days: every programme's times equal the fixture generator's schedule, and each window answers in ≤ 20 ms (best of 3). Measured on a desktop: 1.2–4.1 ms over four runs.
  - **Why 20 ms:** a page of new rows should fill within about 300 ms on a 2018 TV, taken as about 15 times slower than the CI runner (§1.5 step 10's factor). It is a smoke check against reading far more than the range needs; the TVs' own IndexedDB times come from spike S6.
  - **Mutation:** `artifacts/mutate23a.py`, 34 mutants written before the run (the cut's `>` against `>=` and its `last >= 0` check left out: both equivalent). 33 caught on the first run; the survivor dropped the day before, and the scale test missed it because its rows had no channel whose programmes run across midnight (only the fixture's 150-minute slots do; the others divide a day). The rows moved to a run that has one: 34/34.
- **Size:** the query worker 99.6 → 100.8 KB (Tizen and webOS); main's own code 294.5 → 294.6 KB (Tizen) and 281.9 → 282.0 KB (webOS), 219 core-js modules on both.

---

## 2. Player abstraction

```ts
// packages/player/src/engine.ts
export interface PlayerEngine {
  readonly kind: 'avplay' | 'html5' | 'mse';
  readonly caps: { maxHeight: number; trackSwitch: 'reliable'|'unreliable'|'none';
                   deliversSubtitleText: boolean; preloadSlots: number; rates: number[]; fits: PictureFit[] };
  load(source: EngineSource, token: number, opts?: { startMs?: number }): Promise<void>;  // one URL: the controller picks it
  play(): void; pause(): void; seek(ms: number): Promise<void>;
  stop(): Promise<void>;                 // must close the network connection (provider connection limits)
  setRect(r: Rect | 'full'): void;       // AVPlay setDisplayRect / CSS on the single <video>
  setFit(fit: 'contain'|'fill'|'cover'): void;  // AVPlay setDisplayMethod / object-fit (step 20c2b)
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

**Built in step 20b2a: the subtitle parser** (`packages/core/src/subtitles.ts`; step 20b2 was split in leg 41 into 20b2a, the parser, and 20b2b, the overlay and its feeds):
- **What it reads:** SRT, WebVTT and ASS/SSA, through a streaming parser fed string chunks like `M3uParser` (`SubtitleParser.push`/`end`; `parseSubtitles(text)` for a whole file). The first line that isn't blank picks the format: `WEBVTT` is WebVTT, a `[section]` header is ASS, and anything else is the caller's `format` (`srt` by default, or `vtt` from `PlayRequest.externalSubs`' `fmt`). SRT and WebVTT cues are read alike; only WebVTT decodes entities and skips `NOTE`/`STYLE`/`REGION` blocks.
- **Tolerance:**
  - CR, CRLF and LF line ends, split anywhere between chunks, and a BOM.
  - A timing line starts a cue wherever it is, so a file that lost the blank line between two cues keeps both; a number line just before it is the next cue's index, not text.
  - Clocks: one- or two-digit minutes and seconds up to 59, `,` or `.`, the hours optional, and a decimal fraction of 1 to 9 digits (`.5` = 500 ms).
  - WebVTT's header, blocks and cue settings (after a space or a tab).
  - ASS's `Format:` field order (v4's `Marked` too), commas in the text, `Comment:` lines, and a section header without its `]`.
  - Junk blocks, bad timings (an end not after its start included), empty cues, overlong lines (16 KiB) and cues past 20,000 are counted in `stats`, never thrown.
- **The text:** plain, its lines trimmed and joined by `\n`, cut to 2,000 code units:
  - HTML-like tags (`<i>`, `<font …>`, WebVTT's `<v …>`, `<c.…>` and timestamps) and `{\…}` override blocks are removed; in ASS, any `{…}` block is.
  - WebVTT's entities are decoded: the named ones subtitles use, and numeric ones, with surrogates and out-of-range ones becoming U+FFFD.
  - ASS's `\N`, `\n` and `\h` become a line break, a space and a no-break space.
  - Drawings (`{\p1}` up to `{\p0}`) are dropped.
  - Marks such as RLM stay, because the overlay draws each cue with `dir=auto`. SRT keeps `&amp;` and backslashes as written.
- **For the overlay:**
  - `SubtitleTrack` sorts a file's cues by start. The sort is stable on every engine through an index tie-break, because Chromium before 70 sorts unstably.
  - `cuesAt(ms)` gives the cues showing (start ≤ `ms` < end), through a binary search and a look back that stops where the running latest end doesn't reach `ms`. A text already showing isn't repeated (ASS layers).
  - `cueText(raw)` cleans an engine's cue text (AVPlay's `onsubtitlechange`) the same way.
- **Not yet (20b2b):** fetching and decoding the files (the charset), the controller's cue feed, the menu's external rows, and the overlay.
- **Tests:** `subtitles.test.ts` (60) and `test/subtitles-mock.test.ts` (8).
  - Mutation 105/105. The first run caught 100/105; the five test gaps it found are closed: a clock character below `0`, upper-case tags, an overlong line's tail held while it is skipped, the limit on a line held across chunks, and an ASS `Format:` without `End`.
  - The sort's index tie-break can't fail under Node, because V8 sorts stably since 7.0; only the old TVs need it.
  - `subtitles.test.ts` covers: golden SRT, WebVTT and ASS files with every tolerance rule; the same results in any chunks (empty ones kept) and character by character; never-throw on arbitrary and fragment-built text; an SRT/WebVTT/ASS writer round trip; the limits; the clock table; `cueText`; and `SubtitleTrack` against a filter oracle.
  - `test/subtitles-mock.test.ts` runs the mock provider's own `srtText`, in English and Arabic: every cue names its own start.
- **TV bundle:** not in main yet (20b2b imports it). A probe bundle that uses every export adds 8.0 KB before terser and no core-js module on either platform. A method named `at` had pulled in `es.array.at` and `es.string.at-alternative`, so it is `cuesAt`.

**Built in step 20b2b: the overlay and its feeds** (`packages/player/src`: `controller.ts`, `tracks.ts`; `apps/tv/src/player`: `subtitle-loader.ts`, `SubtitleOverlay.tsx`, the track menu's file rows and style rows; the mock's `/subtitles/` route; the playback harness's overlay):
- **Subtitle files in the track list:** a request's `externalSubs` (`ExternalSub`) follow the stream's own subtitles in `status.tracks.text` as `ext:0`, `ext:1`… (`lang` normalized, `streamLang` as the provider wrote it, no label). They are listed only where `ControllerOptions.loadSubtitles` exists, from the start of the session and through retries.
  - **Choosing one:** they are chosen like any track: `selectText('ext:n')` from the menu, the channel's `TrackMemory` choice, or a preferred language when the tracks appear. Choosing one loads it, turns the stream's own subtitles off (`engine.selectText(null)`) and shows it.
  - **Loading:** each file is loaded once per session; a failed load is tried again the next time it is chosen. A file that can't be loaded, or has no cues, makes `selectText` `false` and changes nothing.
  - **Off:** turning off a file that shows alone needs no engine call.
  - **Races:** a newer subtitle choice overtakes a slower one (a sequence number per session), and a choice that finishes after a zap is dropped. Both engines switch text tracks at once (`Promise.resolve`), so an own-track switch can't overlap a file's; an engine that switched slowly would need the switches queued.
  - **Retries:** a file still showing after a retry turns the new load's default subtitles off.
- **The feed:** `subtitles` and `subscribeSubtitles`, kept apart from the status so that cues don't make the status churn. A view is `{ feed: 'file' | 'engine' | null, cues: string[] }`, and listeners hear only changes.
  - **A file:** `SubtitleTrack.cuesAt(positionMs − delay)`, looked up every 250 ms (`CUE_TICK_MS`) while the stream plays, is paused or buffers. No cues show while it opens, reconnects, has ended or failed, or while the app is hidden. The lookups stop while hidden and on a zap or a stop.
  - **An engine's cues** (AVPlay's `cue` events): taken when `caps.deliversSubtitleText` is true and one of the stream's own subtitles is on. Each is cleaned with `cueText` and shows for its `durationMs`, or 5 s without one (`ENGINE_CUE_MS`). The same text again only stays longer, and at most 4 show at once (`MAX_ENGINE_CUES`). They are dropped on a subtitle switch, a retry, a zap, a stop and `hide()`; a stale load's cues never arrive (tokens).
  - **`setSubtitleDelay(ms)`** shows a file's cues later (negative: earlier), for every file until it is changed. It can't move an engine's cues: AVPlay delivers each one as it plays, so they can't come earlier, and holding them back isn't done.
- **The loader** (`subtitle-loader.ts`, `appPlayer`'s default `loadSubtitles`):
  - **The fetch:** an XHR GET for an `ArrayBuffer`, refused past 4 MB (`MAX_SUBTITLE_BYTES`: by the length header, as the bytes arrive, and on the body) or after 20 s. The request is aborted at once, and the error never holds the URL.
  - **The charset:** UTF-16 by its byte-order mark (either way round); else strict UTF-8; else Windows-1256 for Arabic, Persian, Urdu or a file whose language isn't known; else Windows-1252.
  - **The parse:** `parseSubtitles(text, { format: fmt })`, on the main thread.
  - **Why XHR and `DataView`:** a probe showed that a `Uint8Array` pulls 35 core-js modules (+13.9 KB) into main, and a `DataView` none. XHR's progress events count the bytes with no typed array at all.
- **The overlay** (`SubtitleOverlay`, hook-free, in `PlayerScreen`):
  - **Placement:** bottom-centre in the safe area. It shares a bottom stack (`.player__bottom`) with the info bar, so it rises above the bar while the bar shows. The track menu and the error card paint over it.
  - **Each cue** is a block with `dir=auto` and `translate=false`, its lines kept (`white-space: pre-line`), white with a shadow, on the scrim.
  - **Sizes:** S, M and L are 40, 52 and 64 px. The CSS is physical only.
  - **Cue positions** (WebVTT settings, ASS alignment) are ignored: every cue is drawn bottom-centre.
- **The menu:**
  - **File rows** come after the stream's own subtitles, with "File" after the name. A file that can't be loaded says "This subtitle file couldn't be loaded." (`refused: 'file'`). When two switches overlap, only the newest one's refusal shows.
  - **"Subtitle style"** is a third zone, `style`, shown while the app draws subtitles: "Size" for either feed, and "Timing" for a file only.
  - **LEFT and RIGHT** change a row towards the reading end: RIGHT in English, LEFT in Arabic. The size goes S–M–L and stops at the ends. The timing moves in 250 ms steps up to ±30 s ("No delay", "0.5 s later", "1.25 s earlier").
  - **OK** goes round the sizes, or puts the timing back to no delay.
  - **Memory:** both settings are kept in the menu for the app's run. The profile keeps them later (20c, or the settings screen).
- **The e2e:** before VOD (step 26) the app makes no request with files, and `window.__ZOMA_TEST__` is read-only.
  - **Where it runs:** so the playback harness (`playback.html`) draws the app's overlay, with the app's loader and `player.css` on the tokens. `selectText`, `setSubtitleDelay` and `setSubtitleSize` drive it.
  - **The files:** the mock serves them at `/subtitles/<u>/<p>/<id>.<eng|ara>.<srt|vtt>` (its `srtText` for the item's catalog duration). `?charset=windows-1256` sends an old Arabic file, with ASCII digits.
- **Not yet:**
  - **In a browser:** the menu's file rows and style rows have unit tests only. The first real files come with VOD (step 26), and AVPlay's cues with a Samsung TV (19b, 21).
  - **The profile** keeping the size, the timing and a content's file choice (20c).
  - **Settings:** a background setting for the subtitles.
  - **Performance:** parsing off the main thread (a 4 MB file parses on the UI thread).
- **Tests:**
  - `controller-subtitles.test.ts` (31): the file rows, choosing and loading, refusals, races, choices made by the player, the feed by the media clock, the delay, hide and zap, and AVPlay's cues.
  - `subtitle-loader.test.ts` (7): the charsets, and the fetch's limits on a fake XHR.
  - `subtitle-overlay.test.ts` (3).
  - The menu's file rows and style rows: 8 in `player-state.test.ts`.
  - `app-player.test.ts` (+1).
  - The mock: `subtitle-files.test.ts` (7) and the endpoint table; `test/subtitles-mock.test.ts` (+2: its WebVTT, and its Windows-1256 file through the app's charset fallback).
  - e2e: `playback-media.spec.ts`, on the multi-audio MKV with three files:
    - the English cue the media clock is in, then the next one;
    - bottom-centre in the safe area at 52 px;
    - a minute earlier;
    - the Windows-1256 Arabic file drawn right to left at 64 px;
    - a missing file refused, with the Arabic kept;
    - each file fetched once;
    - nothing drawn after Off or a stop.
  - **Mutation:** 99/99 caught. The first run caught 90/100: eight test gaps were closed (late answers after a zap, an ignored cue's timer, a cue with no duration, two cues ending 1 ms apart, the cues a retry and a zap drop, the menu's LEFT/RIGHT outside the style rows). One equivalent mutant was dropped (dispose's listener reset can't be seen afterwards), and one was replaced (the `ext:` prefix guard).
- **TV bundle:** main grew from 242.8 to 259.0 KB of its own code on Tizen and from 231.3 to 247.6 KB on webOS, with the same 219 core-js modules on both. That includes the parser (first imported here), the controller's feed, the loader, the overlay, the menu rows and the new catalog strings.

**Built in step 20c1: the profile's player memory and the start on the last channel** (step 20c was split in leg 43 into 20c1 and 20c2, aspect/zoom, stream info and `allowed_output_formats`; `packages/data/src/profile.ts`; `apps/tv/src`: `player/player-memory.ts`, `marks.ts`, the start, the live list's `locate`, the player's `resume`):
- **Profile version 3** adds `player` (`PlayerMemoryDoc`), with a 2 → 3 migration that keeps nothing yet:
  - `last`: the channel watched last (`LastChannel`): the whole catalog item, the number the bar showed, the rail entry it played from (a source's category by its name, or `null` for "All channels") and its row there, and when.
  - `containers` and `redirects`: per source, the container that played (the controller's `SourceMemory`) and the Tizen redirect probe's answer (`RedirectMemory`).
  - `tracks`: per ContentKey, the track choice (`TrackMemory`) and its subtitle timing, with the time it last changed. Past 300 contents the one changed longest ago goes.
  - `subtitleSize`: S, M or L, `null` until set.
  - The edit is `{ kind: 'player', change }`, one field at a time, each a read-modify-write in the query worker, so no change loses another. A change equal to what is kept writes nothing.
  - **Secrets:** `last.item.url` holds credentials like the source's login. Step 32 encrypts it with them.
- **Who holds what (ADR-008: the platform's work arrives as callbacks).** `createPlayerMemory` (`player-memory.ts`) reads the start's profile once (`load`) and hands out its parts:
  - `sources` and `tracks` go to the controller (`appPlayer`'s `memory`, `trackMemory`);
  - `redirects` goes to the platform. `RedirectMemory` moved to `platform-api`, and `createPlatform({ redirects })` hands it to `createTizenPlatform`'s probe. The memory is made before the platform and filled when the profile arrives, before anything plays;
  - the last channel and the subtitle size go to the app.
  - Reads never wait for IndexedDB. A failed write is logged and kept for the app's run. Stored entries this app can't use (an unknown container, a malformed choice, a non-live last channel) are skipped.
- **The subtitle timing belongs to the content** (a change to 20b2b, where one timing served every file until changed): it is a file's offset against its stream. `setSubtitleDelay` remembers it with the content's track choice (`TrackChoice.delayMs`), a play sets the content's own timing (else none), and `subtitleDelay` tells the menu, which shows it (`menu.showDelay`) without sending it back. The size stays one preference for every content, kept in the profile.
- **The start** (`startPoint`, `main.tsx`), following "Start on last channel" above: the profile's last channel, when its source is still stored, is played at once:
  1. `readStartProfile` (the query worker reads the profile only; no catalog segment is loaded for it).
  2. `showLive` creates the live screen, which starts reading its categories, with `startCategory` set to the rail entry the channel played from.
  3. `player.resume(row, index)` opens the player over it and plays the kept item's URL (`.ts` first, as always; the source's remembered container first). The bar shows the kept item at its old row.
  4. When the live screen's categories are in, it shows the kept category (by source and name; else "All channels"), and `list.locate(key, row)` looks for the channel from its old row's chunk outwards. Found, the player moves to that row: the kept item shows until the row's chunk is in, and the app is told the new row. Not found, the player keeps playing the kept item, and zapping goes from its old row.
  - Until the list is in there is nothing to zap through: CH+/CH− do nothing for that moment. A zap, a play or a close before the list answers wins over the answer.
  - The credentials come from the kept URL as it is. A source whose login changed would fail on it and show the error card, and the next channel played fixes the start (no source can be edited yet).
- **What is kept when:** the last channel when its stream opens (the debounce over), not when it first shows a frame: a channel that fails at the start shows its error card, with "Channels" one press away. The resumed channel isn't written again; its found row is.
- **User Timing marks** (`marks.ts`): `zoma:resume` when the start opens the last channel's stream, `zoma:resume-frame` at its first frame, `zoma:live-ready` when the live screen's categories are in. The e2e checks their order; step 21 reads the launch-to-frame time on the TV from them.
- **Tests:** `profile.test.ts` (+4 and the version pinned: the migration, the player edits, the cap), `query-service.test.ts` (an edit over RPC), `player-memory.test.ts` (7), `start.test.ts` (+1), `live-state.test.ts` (+7: the start category, `findEntry`, `locate` from the guess and past the end, its stale cases, the mark), `player-state.test.ts` (+11: `tuned`, the size, the timing shown per content, the resume and its races, a found row that can't be read), `app-player.test.ts` (+1), `controller-subtitles.test.ts` (+1: the timing per content, kept through audio and subtitle switches), and the Tizen platform's redirect memory (+1).
  - **Mutation:** 86/86 caught. Planning it showed nine pieces of code that could never change an outcome (each masked by another check, or by a later one), so they went before the run: an own-property check on a value never inherited, an array check, a finite-number check on our own timing, a copy of a choice that holds nothing extra, a disposed check after a load that a dispose already ends, two lower clamps (the chunk lookup and the profile's reader already refuse a negative row), a `playing` check the pinned row's identity covers, and an identity check before clearing a row nothing else can have set. The first run caught 85/86: the one survivor was a test that couldn't tell a repeated write from none (it now counts the writes).
- **TV bundle:** main's own code 259.0 → 264.0 KB on Tizen and 247.6 → 252.4 KB on webOS, with the same 219 core-js modules on both. The last channel's time was first a field named `at`: reading it as `last['at']` pulled in `es.array.at` and `es.string.at-alternative` (225 modules), so it is `started`. A per-file Babel probe (each changed file's injected polyfills against the 20b2b merge) found it.
- **Not yet:** the subtitle size and the audio choice after a relaunch can't be tried by hand in `pnpm dev` (no subtitle file in the app before VOD, step 26; desktop Chromium lists one unnamed audio track without its Blink flag); the start on a TV (step 21 measures it from the marks); the old-engine walk never plays a channel, so its relaunch still lands on the live screen. e2e `resume.spec.ts` (`pnpm e2e`): a channel played from "Test News" is kept; a relaunch opens the player on it at once, asks for its stream before the live screen's categories are read (the marks), finds its row in "Test News", Back lands on it; a channel zapped to is the next start's, and zapping goes on from it. `live.spec.ts`'s relaunch now opens the player on the kids' channel it played, and Back shows the kids' category. `player-media.spec.ts` (`pnpm e2e:media`): after the relaunch the multi-audio channel plays in the Arabic picked from the menu before it (the profile's `TrackMemory`).

**Built in step 20c2a: the account's output formats and the stream info** (step 20c2 was split in leg 44 into 20c2a and 20c2b, aspect/zoom and the full checklist; `packages/data`: `SourceMeta.outputFormats`; `packages/player`: `EngineStats`, `PlayerController.stats`; `apps/tv/src/player`: `stream-info.ts`, `StreamInfoPanel.tsx`; the mock's `output_formats`):
- **Where the formats live:** in `SourceMeta.outputFormats`, the ingest's record beside the panel's `server` facts.
  - They are the account's facts from its login, not the user's choices, so they stay out of the profile (the user's document, which is backed up).
  - Every Xtream refresh writes them, a refresh that found nothing new included (the login answer isn't hashed), so a panel that changes them is followed at the next refresh.
  - Playlists have none: an M3U `get.php` link names its own `output=`, and the source's remembered container (`SourceMemory`) learns the rest.
- **To the player:**
  - `DataEngine.outputFormats()` reads them from the query worker's `status` each time the live screen opens (the start, and after onboarding).
  - `createPlayer`'s `outputFormats(src)` hands them to `liveRequest` on every play, and `liveRequest` passes them to `streamCandidates`. An account that names only `m3u8` never gets a `.ts` request, nor a switch rung to one.
  - Until they are read (the start's last channel), both forms are tried, the remembered one first.
- **The mock:** `output_formats` per account (default `m3u8, ts`) is its `allowed_output_formats`, and a live stream in another format gets 403 (the mock's choice; real panels differ). The `hls` account allows HLS only.
- **What the engines say (`EngineStats`):**
  - **The `<video>` (Html5Engine):** the picture size; decoded frames (`getVideoPlaybackQuality().totalVideoFrames`, else Chromium's `webkitDecodedFrameCount`); dropped frames (the same two ways); decoded bytes (Chromium's `webkitVideoDecodedByteCount` plus `webkitAudioDecodedByteCount`). No codec, and no declared bitrate. Playwright's Chromium has every counter.
  - **AVPlay:** from the first frame on, the playing video stream's size, `fourCC` and `Bit_rate`, and the playing audio stream's `fourCC` and channels. It counts no frames or bytes.
  - `NO_STATS` is the empty answer.
- **The controller's `stats()`:** the engine's figures, the container of the URL that plays, the engine that plays it (`FallbackEngine.kind` is the active one's), and `load` (the load's token, new with each retry and zap). It is `null` unless a picture shows (playing, paused or buffering).
- **The panel** (`stream-info.ts`, `StreamInfoPanel`):
  - **On and off:** the info bar's third button, "Stream info" (no remote key: a new intent would make S10's battery ask every TV for it). It stays on through zaps, the menu and the bar hiding, and goes when the player closes. The error card replaces it while it shows.
  - **Reading:** while on, it reads `stats()` at once and then every second (`STATS_MS`).
  - **Measuring:** the frame rate and the bitrate are measured between the first and the last of the last 6 readings of one load (about 5 s). A new load, counters that went back (a reopen within one load), a moment with no picture, or the panel opening again start the measure afresh; a paused stream's still counters don't. A bitrate the stream declares (AVPlay) wins over a measured one.
  - **Where:** the top-start corner of the safe area, under the "Reconnecting…" badge (`.player__top`): the left in English, the right in Arabic.
  - **The rows, in order:** Resolution (`960×540`), Frame rate (`25 fps`), Bitrate (`286 kb/s`; from 1 Mb/s, `4.5 Mb/s`), Video (the codec), Audio (`AAC · 2.0`, `E-AC3 · 5.1`), Format (from the status, so it shows while the stream opens: `MPEG-TS`, `HLS`, `MP4`, `MKV`), Player (`AVPlay`, `HTML5`) and Dropped frames.
  - A row the engine has no figure for is left out, and "Waiting for the picture…" shows until a picture does.
  - Technical names are shown as they are (`dir=ltr`, `translate=false`). The units are in the catalogs (`fps` and `إطار/ث`, `Mb/s` and `ميغابت/ث`, `kb/s` and `كيلوبت/ث`).
- **Found on the way:** a fast-check seed in `normalize.test.ts` drew the word `x264`, a quality token the property's word filter missed. A name made only of quality tokens keeps them all, so `x264 HD` gave `x264hd`. The filter now leaves out every quality token the pattern can spell; `matchName` is unchanged.
- **Not yet:**
  - The codecs on the `<video>` (webOS): the element doesn't name them.
  - A frame rate on AVPlay: its `extra_info` names none in Samsung's reference; a TV run may find a field.
  - The panel on any TV (19b, 21).
  - Aspect and zoom (20c2b, below).
- **Tests:**
  - **Unit:** `stream-info.test.ts` (10: the figures, the sampler's timing and resets, the words, the rows in English and Arabic), `player-state.test.ts` (+3: the formats on every play, the button, nothing read before the first play), `controller.test.ts` (+2), the `<video>`'s and AVPlay's stats (rewritten), `test/ingest-mock.test.ts` (+1: the formats on every login, an unchanged refresh included), `test/tv-data-engine.test.ts` (+1) and the mock's `streams.test.ts` (+1).
  - **e2e:** `player.spec.ts` (+3): the `hls` account's two plays ask for `.m3u8` only (the test fails with the app's wiring removed); the panel by keys in English and Arabic (the third button, "Waiting for the picture…", the format, the corner, kept through a zap, off, gone with the player). `player-media.spec.ts` (+1): on the SMPTE channel 960×540, 22–28 fps, 200–2,000 kb/s, HLS, HTML5; after the number 6, the HD channel's 1280×720, 45–55 fps and over 1 Mb/s.
  - **Mutation:** 53/53 caught. The first run caught 51/53; the two test gaps are closed: a new load whose counters are already past the old ones (the byte counter's fall had masked the load check), and a picture with no bitrate yet.
- **TV bundle:** main's own code 264.0 → 270.4 KB on Tizen and 252.4 → 258.3 KB on webOS, with the same 219 core-js modules on both. A reading's time is `time`, not `at` (leg 43's lesson).

**Built in step 20c2b: the picture's mode** (`packages/player/src/picture.ts`; `PlayerEngine.setFit` and `EngineCaps.fits` in the three engines; `PlayerController.pictureModes` and `setPicture`; the info bar's "Picture" button; profile version 3's optional `player.picture`):
- **The modes:** four, each a rect on the 1920×1080 screen and a fit in it (`pictureLayout`):
  - **Fit** (the default): the whole picture in its own shape, with bars where its shape isn't the screen's. The `<video>`'s `object-fit: contain`; AVPlay's `PLAYER_DISPLAY_MODE_LETTER_BOX`.
  - **Zoom:** the screen filled in the picture's shape, its edges cropped. `object-fit: cover`, on the `<video>` only.
  - **Stretch:** the picture stretched to the screen. `object-fit: fill`; AVPlay's `PLAYER_DISPLAY_MODE_FULL_SCREEN`.
  - **4:3:** the picture stretched into a 1440×1080 window in the middle (`FOUR_THREE`: `setRect` 240, 0, 1440, 1080, with the fill), for a 4:3 broadcast sent stretched to 16:9.
  - No 16:9 mode: on a 16:9 TV it is Stretch.
- **The 4:3 side bars:** the player screen draws them itself, black, under its other parts (`.player__pillar`). Outside its box the `<video>` leaves the stage transparent, so the page's own colour would show (white on the desktop). Over AVPlay's plane, black outside its rect, they change nothing. `setRect` keeps meaning the picture's box and nothing else, which a preview window will need.
- **AVPlay** (Samsung's reference):
  - `setDisplayMethod` has `LETTER_BOX`, `FULL_SCREEN` and `AUTO_ASPECT_RATIO` ("based on the video's DAR/PAR"), in the states IDLE to PAUSED. Since Tizen 6.0 an unknown mode throws `TypeMismatchError`.
  - **No crop in a TV app:** `setVideoRoi` is for signage (LFD) and throws `NotSupportedError` in a TV app, and `setDisplayRect` refuses negative values.
  - So AVPlay's `caps.fits` is `contain` and `fill`, and a firmware without `setDisplayMethod` has `contain` only. The engine calls it at every open, after `setDisplayRect`, and on a change while a source is open; a refusal leaves the picture as it was.
  - `contain` is the letterbox, the mode Samsung's samples use. Whether `AUTO_ASPECT_RATIO` draws an anamorphic SD stream better is a TV run's answer (step 21).
- **The engines keep the rect and the fit for every later load,** so the controller sets them once per change:
  - `setPicture(mode)` gives the engine the mode's rect and fit and answers the mode shown: Fit for one the engine lacks.
  - `pictureModes` lists the modes the engine's fits allow, Fit always.
  - `FallbackEngine.caps.fits` is the fits both its engines have, because either may play the next channel. On Tizen that leaves no Zoom.
- **The control:** the info bar's fourth button, "Picture: Fit" (`PICTURE_ACTION`; `ACTIONS` is 4).
  - OK goes round Fit, Zoom, Stretch, 4:3 and back to Fit, skipping what the engine can't show (AVPlay: Fit, Stretch, 4:3).
  - The picture changes at once, the stream isn't touched, and the focus stays on the button.
  - No remote key: Samsung's `PictureSize` key would need a new intent, and S10's battery would then ask every TV for it (as with "Stream info").
- **Where it's kept:** one mode for every channel, like the subtitle size, in the profile's `player.picture`.
  - It is an optional field of version 3: a document without it reads as never set, so no migration.
  - A mode per channel was left out: the mode is mostly the viewer's taste (bars or a crop), and a channel that needs 4:3 is one press away.
  - The app gives the controller the kept mode when it is made, before the first play. A kept mode this TV's engine can't show plays as Fit and stays kept.
- **Not yet:**
  - The modes on a TV (19b, 21): AVPlay's letterbox against its auto aspect, and its plane outside a 4:3 rect.
  - A picture setting in the settings screen.
- **Tests:**
  - **Unit:** `picture.test.ts` (4: the layouts, the modes per engine, the round, a stored mode), the controller (+2), the `<video>` (+1, and its caps), AVPlay (+3: the fit kept for the next open, a refusal, a firmware without the call; the open's order), `FallbackEngine` (+1: the fits both have, whichever plays), `player-state.test.ts` (+2: the round from the fourth button, the kept mode and AVPlay's round), `player-memory.test.ts` (the mode read, written once, an unknown one skipped) and `profile.test.ts` (+1: no migration).
  - **e2e** (`pnpm verify`'s 63 and `pnpm e2e:media`'s 10 green locally): `player.spec.ts` (+2): the round by keys in English and Arabic, read off the `<video>`'s `object-fit` and box and the side bars (4:3 only), with the button's name, kept through a zap and a relaunch (the profile). `player-media.spec.ts` (+1): 4:3 on the SMPTE channel, read from the screen's pixels: grey edge to edge in Fit, black beside the 1440 px window in 4:3, the stream playing on.
  - **Mutation:** 42/42 caught on the first run. Two guards that couldn't change an outcome went before it: `nextPicture`'s branch for a mode not among the modes (they start with Fit, where the lookup lands anyway), and AVPlay's `typeof` check before `setDisplayMethod` (the call's own `attempt` swallows a missing method; it is an optional call now).
- **TV bundle:** main's own code 270.4 → 272.9 KB on Tizen and 258.3 → 260.3 KB on webOS, with the same 219 core-js modules on both.

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
  - **Why 200 ms and not 150:** the CI runner (2 vCPUs) at 4x is about twice as slow as a desktop at 4x. Its first run had a median of 39 ms and a slowest press of 121 ms in the full tier. That run started straight after the 20,000-channel onboarding; both tiers now start afresh. A desktop at 10x had presses up to 153 ms and sporadic long tasks of 140–279 ms. Step 23's grid budget (150 ms) was calibrated against CI the same way (step 23d, below).
  - **Measured locally (2026-11-04, five runs, the CPU 3.3–6x slower):** median 16–18 ms, max 30–47 ms in the full tier; median 9–13 ms, max 21–35 ms in the low tier; no long task. A report goes to `artifacts/perf/live-throttled.json`.
  - **The seeds:** a keydown listener that spins for 250 ms (on the gallery) must fail the budget and show as a long task, and a press whose focus never lands must fail.
  - **On CI (PR #24's green run):** full tier median 32 ms, slowest 94 ms (the first presses down the list); low tier median 11 ms, slowest 28 ms; no long task. Motion costs: with the focus transitions on, the median press is about three times the low tier's. That is a number for the low-tier tuning on the device (§6, 6.4).
  - **What the budget catches:** a list that draws 2,000 rows more than it shows (a mutant of `VirtualList`) made the median press 81–116 ms and the slowest 221–292 ms on the desktop: a few presses over 200 ms, more on the slower CI runner. A slowdown of two or three times would pass. The budget is a smoke check; the TVs' own numbers come from spike S6.
- **The forced low tier:** nothing applied the tier before this step, so `?tier=low` changed nothing on screen. `main.tsx` now writes the platform's tier on `<html data-tier>`, and tokens.css's `[data-tier='low']` turns motion off. The throttled run checks a row's transition (0.12 s in the full tier, 0 s in the low one) and runs the same presses in the low tier.

**Built in step 23d: the grid guide's throttled run** (`e2e/guide-throttled.spec.ts`, in the `throttled` project):
- **The catalog:** the live run's 20,000 channels in 200 categories, and the guide opened over "All channels" (20,000 rows). The rows the presses walk get a dense guide (`gridGuide` and `denseProgrammes` in `e2e/big-catalog.ts`): "All channels" rows 0–199 (the walk's pages end on row 155 and its asks reach row 173), from 2 days before now to 8 days after (the full tier's EPG window, a day back and 7 on, with a day's margin either side), programmes back to back in ten lengths taken in turn (15 to 90 minutes, about 33 a day), each channel starting at its own place so neighbouring rows' cells don't line up, some across midnight, with long titles the cells cut. The other channels keep the live run's four programmes around now. The guide file is about 130,000 programmes, and the whole test (onboarding included) takes about 20–30 s. `test/big-guide.test.ts` pins the dense guide: back to back over the full tier's window from any start, every length used, the other channels untouched.
- **The presses** (93 per tier, each tier from a fresh start with the source stored, as the live run): UP to the header and OK on "Guide" (the grid's first draw) on the live screen, then 91 in the grid: DOWN through 20 rows, 15 pages of CH−, 30 RIGHTs along the time on row 155 (the view moves on every two hours, and past midnight), 5 pages of CH+, 10 UPs, 10 LEFTs back on row 100 (while the rows CH+ reached are still being read), and Back to the list on row 100. The forced low tier (`?tier=low`) has motion off and a 3-day guide.
- **Time presses:** LEFT and RIGHT in an `epg` zone keep the focus path (`guide/grid/155`), so `RemoteDriver.timedPress(…, { timeMoves: true })` waits for the first frame that draws another time cursor (the screen root's `data-time`) too. After each one the spec checks the cursor moved the right way and, unless programmes arrived meanwhile (`data-version` changed), that it landed on the next cell's start (RIGHT) or the previous cell (LEFT). A seed on the gallery page: a press that keeps the time (DOWN) never ends with `timeMoves` and fails.
- **The checks:** after the time presses settle, every drawn row is the dense guide's programmes over the view with their own times and titles (placeholders for the channels without a guide id), so the timed frames drew real data; the throttle proof (a fixed loop at least twice as slow); the cells' focus transition (0.12 s, none on the low tier); no page error. The report goes to `artifacts/perf/guide-throttled.json`, and the numbers print before the checks, so a failing run still shows them.
- **Budget: 150 ms per press in the grid and per long task** (PLAN 6.2's grid budget, step 23's "each key press in the grid"), kept after calibrating on CI. **The two presses on the live screen that open it** (UP to the header, OK on "Guide") have the live screen's 200 ms (spike S6's threshold for the 2018 TVs), and so do the long tasks until the grid's first frame:
  - **On CI, PR #52's first run:** full tier median 27 ms, slowest 94 ms (LEFTs on row 100 while its rows were read, then the grid's first draw at 62 ms), one long task of 54 ms; low tier median 12 ms, slowest 46 ms, no long task. That leaves about 1.6 times the slowest press, as the live list's 200 ms left over its 121 ms.
  - **Its second run:** the grid's first draw ("OK opens the guide") took 155 ms in the full tier, and failed the 150 ms that every press then had; the slowest press in the grid was 89 ms (the first DOWNs), the median 36 ms. Locally the first draw ranged from 25 to 102 ms at 4x, slowest on the first start after onboarding (cold code) and when the first ask's answer came before the frame. A trace showed the key's task (the focus engine, `open`, Preact's first render of the screen) at 22 ms and the frame's style, layout and paint at 15 ms, then the worker's answer and its redraw at once after.
  - **What changed:** the open's first ask now goes out on a 0 ms timer (`scheduleAsk(0)`), after the press that opens the guide (§1.2, step 23c's data). Locally that took the first draw's mean over ten opens from 51 to 37 ms and its slowest from 76 to 52 ms; in a local `pnpm verify` from 105 and 114 ms to 41 and 29 ms. The opening presses moved to the 200 ms budget: they are presses on the live screen, the first draw is the screen's heaviest frame and the most variable (cold code), and the step's 150 ms is for presses in the grid.
  - **CI after the fix (PR #52's third run, merged as `dad3a7a`):** the opening 34 ms (full tier) and 17 ms (low); in the grid, full tier median 27 ms, slowest 67 ms, one long task of 52 ms; low tier median 9 ms, slowest 21 ms.
  - **Measured locally (2026-11-05, five runs, the CPU 5–10x slower):** full tier median 20–23 ms, slowest 45–89 ms; low tier median 14–16 ms, slowest 35–50 ms; a few long tasks of 50–71 ms. In a local `pnpm verify` (straight after the other e2e tests) the grid's first draw, "OK opens the guide", was the slowest press: 105 ms in the full tier and 114 ms in the low one. A desktop at 10x (15x measured) went over: full tier median 68 ms, slowest 255 ms. That desktop stand-in for CI overstated today's runner by more than 2x.
  - **Where a press goes** (a Chrome trace of the gallery page's grid at 5x): a quarter to a third in script (the key, the focus engine, Preact's diff), the rest in style, layout, paint and compositing. Motion costs too: on CI the full tier's median was about twice the low tier's.
  - **What the budget catches:** a grid that draws 200 rows more than it shows made the median 48–49 ms, the slowest 240–326 ms and long tasks up to 255 ms locally (both tiers fail). Working out every cell of the range and drawing only the view's is not caught (it costs little script); the drawing is what the budget watches.

**Built in step 23e: the grid guide on the old engines** (`tools/engines/src/guide.ts`, the walk's guide steps in `onboarding.ts`; runbook old-engines.md item 6):
- **Why:** the grid is the first screen placed by absolute positions from CSS variables. Each cell, slot label and the now line sits at `left: var(--x)` (with `width: var(--w)` on the cells), the values set inline per element by Preact (`style.setProperty('--x', …)`), and postcss-rtlcss turns `left` into `right` under `<html dir="rtl">`. Chromium has had custom properties since 49, but nothing had drawn the grid on 53, 56 or 68.
- **Where:** the onboarding walk goes on from where the live steps end (the rail, on "Group 5"), so the guide runs in Chromium 53, 56 and 68, in both bundles, in English and in Arabic, over the fixture's channels and guide, through the real data workers. The steps: to the list's first channel (RIGHT, or LEFT in Arabic), UP to the header's "Guide" (its first button), OK; then in the grid ArrowDown, a programme on (RIGHT, or LEFT in Arabic), CH− (the TV's own code: a page of 9 rows), three programmes on (the view moves past now) and Back (the TV's own code) to the list on the channel the guide had focused. Group 5's rows 1 and 10, where the time moves, have the fixture's hourly programmes; rows without a guide show "No information" placeholders cut at the 30-minute slots.
- **What each step in the grid checks** (`guideFailures`):
  - **Geometry** (`gridFailures`, the checks of `checkGeometry` in `e2e/guide-grid.ts` in an ES5 probe, `GRID_VIEW_FUNCTION`): the grid 1,728 px wide at the safe area's inline start and 110 px under its top (the header); the rows from `data-top`, each 80 px tall after an 8 px gap; the channel column 400 px at the inline start and the timeline 1,320 px after it; every cell at `(start − view) × 11` px from the timeline's inline start, `(end − start) × 11 − 4` px wide (at least 8), cut at the view's edges, as tall as its row; the slot labels at their boundaries; the now line's middle at now. Every position is measured from the inline start: the left edge in English, the right in Arabic.
  - **Schedule** (`scheduleFailures`, as `checkSchedule` in `e2e/guide.spec.ts`): each row's number (its place in "All channels") and name, and its cells the fixture's programmes over the view with their own times and titles (`fixture.17 3h`), or only placeholders in the walk's language.
  - **Focus:** one focused cell, on the focused row, holding the time cursor (`data-time`); and, as at every step of the walk, the focus engine's path equal to the screen's `data-screen/zone/index`.
  - **Now:** as it opens, the cursor on now and the view from now's slot; the now line where the page's clock says while the view holds it; after the three programmes on, the view past now and no now line.
  - **The cursor along the time:** a step's keys must take it to the start of the programme they lead to, worked out from the cursor read before them (`withCursor`), so a step lands only once all its presses are drawn.
  - **Layout and idle:** the guide, its next page and its later view are measured like any screen of the walk (1920x1080, no scroll, the boxes of the e2e test in the safe area, no label cut), and every step waits for the guide's `data-pending="0"`.
- **The seed:** `seed-css-no-guide-x` takes the cells' `left: var(--x)` and its mirror `right: var(--x)` out of app.css (both must be there, or staging fails). Every cell of a row then sits at its timeline's start, and every guide step fails on every engine, in both languages.
- **Kept equal** by `test/engines-onboarding.test.ts`: the layout constants with packages/ui's `GUIDE_LAYOUT` and the guide screen's sizes, the boxes and labels with the e2e test's, the marks the screen and the grid draw, our words with the catalogs, and the seed with GuideGrid.css as the TV build makes it.
- **Timing:** each step in the grid waits up to 8 s for its data (`LIVE_TIMEOUT_MS`). Locally on Chromium 53, 56 and 68, OK on "Guide" took 0.2–0.4 s to a settled grid with its programmes, and CH− 0.2–0.4 s.
- **First run (2026-11-05):** every check passed on all three engines, both bundles, both languages: the custom properties position on Chromium 53. The seed failed every guide step on every engine (`17 misplaced: row 0 cell 03:30 starts 0 px from the timeline's inline start, expected 330; …`). The self-test is now 108 runs, 80 of them failures that must be caught.
- **Found in that run (a harness bug, older than this step):** a walk's clean-up leaves the engine on `blank.html`, and the next run's reset navigated to the same address. Until the new document replaced it, the old one answered "blank page open", so the delete ran there and was lost with it (`could not be deleted before the walk (none)`, once on Chromium 53). The reset now marks the page first (`STALE_MARK`, as the relaunch does) and waits for an unmarked one; a fake page whose navigation lands late reproduces the race in `onboarding.test.ts`.
- **Tests:** `guide.test.ts` (the probe read against a stand-in DOM; each geometry, schedule and cursor check against a grid drawn as `GuideGrid` draws it, `guide-drawn.ts`, then with one thing broken), the walk's guide steps and their evaluation in `onboarding.test.ts`, the seed in `variants.test.ts` and against GuideGrid.css as the TV build makes it. **Mutation:** `artifacts/mutate23e.py`, 64 mutants written before the run. Writing the list first found a dozen checks no test made fail (a row without its timeline, channel column or cells; a grid without rows; the channel column's and the timeline's widths; a row's first cell missing; a grid off its inline start in Arabic; a minute-long cell's 8 px floor; a pixel's slack; a row past the category's end; a cursor before its cell; a view starting after the cursor; the cursor check in the walk's evaluation), and two pieces of code no test could reach (a placeholder marker the title already covered, a guard for a category the fixture always has), which were taken out. 63 caught on the first run; the survivor (a row's own height) was a test gap: 64/64.

**Built in step 25c: the catch-up days in the throttled run and on the old engines** (`e2e/guide-throttled.spec.ts`, `e2e/big-catalog.ts`'s `archive`; `tools/engines/src/guide.ts`'s `markFailures`, the walk's `guide-earlier`):
- **The throttled run:** "All channels" rows 0–99 get seven days of Xtream catch-up and the dense guide reaches 8 days back, so the store keeps 7 days back in the full tier and 2 in the low one, and each run checks the guide's range starts at that local midnight. Before the pages, each tier walks back in time twice, 20 LEFTs each (the view resting every five): on row 20, among the channels with catch-up (the gone-by programmes carry the mark: 30 marks drawn after the walk), and on row 155, among those without (none). Then 70 RIGHTs back past now. 171 presses per tier.
- **Measured locally (2026-11-05):** every press within the 150 ms budget. Full tier (CPU 3.2x slower): median 23 ms, p95 51 ms, max 104 ms (a LEFT on row 20). Low tier (4.5x): median 17 ms, p95 36 ms, max 63 ms.
- **The marks' cost in the low tier:** the walk with marks was slower than the one without in the same run (low tier median 29 against 21 ms, p95 62 against 33; full tier 38 against 26 ms). That gap is mostly the order of the walks: a control run with no catch-up channels (no marks anywhere) had the same gap in the full tier (39 against 29 ms) and 24 against 23 ms in the low one. Against that control, the marks add about 5 ms to the low tier's median press over marked rows (29 against 24 ms) and nothing to its slowest (63 against 65 ms), within the ±30% of local timings. Each mark is one span and one text node per marked cell; the grid asks each drawn row's archive once per frame, from a per-row cache.
- **For step 41 (the 2018 Samsung, Chromium 56 in the low tier):** a press stays within 150 ms while walking back two days over channels with catch-up, the view full of marks; the marks' circle and triangle drawn; holding LEFT across a day; and the store keeping two past days of a large guide with catch-up channels within the low tier's memory.
- **The old engines:** every other fixture channel with a guide has seven days of `shift` catch-up (`hasCatchup`), so Group 5's second page mixes rows with marks (row 15) and without. The walk's new step goes six programmes back after the three on (`guide-earlier`: the view all gone by, no now line, marks drawn), and every guide step checks the marks (`markFailures`): each programme gone by within its channel's days has one, named "Catch-up" in the walk's language, 20 px square, inside its cell within 40 px of its inline start; no other cell has one. The probe reads a cell's title from its title span (the mark's name follows it in the cell's text). **Local run (2026-11-05):** every walk passed on Chromium 53, 56 and 68, both bundles, both languages; the screenshots (`onboarding-chrome53-tizen-ar-guide-earlier.png` and the rest) show the marks mirrored in Arabic.

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
