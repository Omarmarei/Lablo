# ADR-014: Settings load on first open: a split TV build with an AMD loader of our own

- **Status:** Accepted
- **Date:** 2026-11-21
- **Source:** RELAY.md step 35e (Omar's option 1 of 2026-11-21, asked in leg 125 as step 36's size question), [ADR-003](ADR-003-chrome53-iife-syntax-gate.md)

## Context
After step 35d main.js had 487.6 KB of its 500 KB budget on Tizen (ADR-003). Steps 36 to 40 each add a screen, and one screen costs 15 to 18 KB of main.js. The settings (`apps/tv/src/settings`) were 66.1 KB of main.js, parsed at every start though most starts never open them. The 500 KB is a planning number; the real limit is S6's "cached cold start to usable ≤ 3 s" on the 2018 TV, measured only at step 41. Omar chose to load the settings on first open rather than raise the budget.

Chromium 53 (the oldest engine the build targets) has no `import()`: Chromium 63 added it. A second classic-script IIFE can't share main's modules: it would carry its own Preact and its own signals core, whose components and signals don't work with main's.

## Decision
- **The app build is split** (`tools/build/src/bundle.ts`, `split`): Rollup's own code splitting, written as **AMD** with `amd.autoId` and `amd.define: '__labloDefine'`. Each dynamic `import()` in the source becomes a file beside main.js. The app and its test copy are split; the lab, the vectors page and the workers stay one IIFE each.
- **A loader of our own at the top of main.js** (`tools/build/src/amd-loader.ts`, Rollup's `banner` for the entry, so terser minifies it with the chunk): plain ES5, about 700 bytes minified. The entry runs as soon as it is defined; a lazy file loads by a `<script>` tag (`<id>.js`, next to the page), once, a second request waiting for the same tag; a tag that fails rejects every waiting request and goes, so the next request loads it again. Its only global is `__labloDefine` (no `define` or `require` on `window`).
- **One shape only** (`checkChunks`): one entry, and lazy files that each need only main.js (none shared between lazy files, none loading another). The build fails on any other, so the loader never fetches a dependency.
- **Every file is checked:** terser, the inlined worker strings and the ES2016 gate run on each file; settings.js has its own budget (`lazy`, 150 KB, without its inlined workers); the ACG and foreign-code checks read every file.
- **settings.js holds all of `apps/tv/src/settings/`** (`APP_LAZY`, `tools/build/src/lazy-files.ts`): a module of that folder in main.js fails the build, naming it. What main keeps to open the settings lives elsewhere: `apps/tv/src/lazy/` (the loader and its loading screen), the guide's `MappingReading`, the backup code's `codeGroups`. `apps/tv/src/settings/settings.ts` is the file's entry; main imports only its types, and the `import()`.
- **The first open** (`apps/tv/src/lazy/lazy-file.ts`): a loading screen goes on the navigator. Its first 300 ms paint the screen under it (a load from the TV's own storage takes a few tens of ms, so the usual open shows nothing but Settings); then a spinner; a failed load (or one still on its way after 15 s) says "Couldn't open this screen." with "Try again". Back cancels the opening; a load still on its way keeps what it gives. Later opens are at once. The guide's "Guide channel" opens the mapping picker (in settings.js) the same way.
- **CSS is not split:** app.css keeps every rule, the settings' too. The loading screen has its own rules (`lazy.css`), because `pnpm dev` loads the settings' CSS with their file.
- **Steps 36, 38 and 40's screens** (channel management, the complete settings, diagnostics and the legal pages) go into settings.js.

## Consequences
- main.js lost 61.5 KB on both platforms: 426.1 KB on Tizen, 413.4 KB on webOS (step 35e's build). settings.js is 66.1 KB.
- The first open of Settings on a TV waits for the file (unmeasured on a TV until step 21's session; the harness opens it on Chromium 53, 56 and 68).
- A packaged app holds two script files: the webOS `.ipk` packages the folder (settings.js checked in it); the Tizen `.wgt` packages the folder the same way.
- A new lazy file needs `APP_LAZY` and the budget lines; a shape the loader can't load fails the build until the loader learns it.
- `pnpm dev` keeps native `import()` (Vite): the split is the TV build's only.
