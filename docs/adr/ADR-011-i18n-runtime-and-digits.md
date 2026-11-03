# ADR-011: The i18n runtime, our own formats, and Western digits in Arabic

- **Status:** Accepted (the digit default is reversible; see "Reversing the digit default")
- **Date:** 2026-11-03
- **Amends:** docs/architecture.md §1.2 (i18n runtime in `ui`, plural rules in `core`); implemented in RELAY step 12a (`packages/core/src/plural.ts`, `packages/ui/src/i18n/{message,format,runtime}.ts`, `apps/tv/src/i18n`)

## Context
v1 ships English and Arabic (RTL) from day one, on TV engines as old as Chromium 53 (2018 webOS 4).
- **`Intl.PluralRules` is missing on Chromium 53.** Arabic has six plural forms (zero, one, two, few, many, other), so a "plural" helper with two branches is wrong for most Arabic counts.
- **The TVs' ICU data is old and may be cut down.** Chromium 53's CLDR (about version 29) gave `ar-SA` the Islamic (Umm al-Qura) calendar by default; current CLDR gives it the Gregorian one. TV builds may also leave locales out of ICU. What `Intl.DateTimeFormat('ar-SA')` prints on a 2018 TV can't be tested without the TV.
- **Digits.** CLDR's defaults give Arabic-Indic digits (٠١٢٣) to ar-SA, ar-KW, ar-QA, ar-BH and ar-OM, and Western digits (0123) to ar-AE and plain `ar` (CLDR 42 and later). The plan doesn't choose. On our screens, several numbers are not ours to format: the provider's channel numbers (`tvg-chno`), the digits typed on the remote, years and episode numbers inside provider titles. They are all Western.
- A channel name from the provider inside one of our sentences ("Play {name}?") can reorder the punctuation around it when its direction differs from the UI's (a Latin name ending in a digit inside an Arabic sentence).

## Decision
**Plural rules in `core`** (`pluralCategory`, `PLURAL_CATEGORIES`): CLDR's English and Arabic rules written out. A test compares them with Node's full-ICU `Intl.PluralRules` on 0–10,000, negatives and fractions.

**Messages: a small ICU MessageFormat subset** (`parseMessage`, `formatMessage` in `ui`): `{name}`, `{n, number}`, `{n, plural, =N {…} one {…} … other {…}}` with `#`, and `{x, select, … other {…}}`. No apostrophe quoting. It fits `pseudoLocalize`'s brace rule, so en-XA accents only the message text. Each message is parsed once per locale; a message that fails to parse shows as written instead of throwing. A missing argument shows as `{name}`.

**Catalogs are the app's, as TypeScript** (`apps/tv/src/i18n/en.ts`, `ar.ts`): English is the source and the fallback, its keys are the `MessageKey` type, and `ar.ts` is a `Record<MessageKey, string>`, so tsc rejects a missing Arabic key. Tests check that both languages parse with the same arguments, that every plural gives each category its language has (all six in Arabic), that Arabic messages contain no Latin words of their own, and that no message leaves a placeholder unfilled in en, ar or en-XA. Both catalogs ship in main.js; with two languages, loading on demand isn't worth it.

**Formats are ours, not `Intl`'s** (`format.ts`): numbers (grouping, at most 3 fraction digits), percent, 12/24-hour times, weekday and month names, a guide's day ("Tue, Nov 3" / "Tue 3 Nov" / "الثلاثاء، 3 نوفمبر"), a full date, and playback durations ("1:13:12"). The same output on every TV and in tests. Gregorian calendar, the TV's own time zone (a `Date`'s local fields). Per locale:
- **The catalog and the direction** come from the language: Arabic is RTL, everything else gets the English catalog left to right (so a Hebrew TV doesn't get English text laid out right to left).
- **Hour cycle:** 24-hour for en-GB and en-IE, 12-hour for the rest of English and for Arabic (ص/م), as CLDR. Canadian English writes a.m./p.m. A 24-hour time keeps two-digit hours ("08:05"), so a guide's column lines up.
- **Date order:** day first for Arabic and for en-GB, en-IE, en-AE, en-AU, en-NZ, en-IN and en-ZA; month first otherwise.
- **The region** comes from the locale tag, else from the TV's country.
- A test compares numbers, percents, times, names and dates with Node's ICU for en-US, en-CA, en-GB, ar-AE and ar-SA (Western and Arabic-Indic digits), ignoring only ICU's bidi marks and narrow spaces.

**Arabic uses Western digits by default** (`DEFAULT_DIGITS = 'latn'`), with the Latin percent sign. Arabic-Indic digits are implemented (`digits: 'arab'`: ٠١٢٣, ٬ and ٫ separators, ٪) and tested, ready for a setting.
- Why: a channel row or the info bar would otherwise mix two digit forms (the provider's channel number "101" next to our time "٨:٠٥"). The remote's digits are Western, and so are most numbers inside provider titles. The GCC's big streaming apps (Shahid, OSN+, Netflix in Arabic) show Western digits in their Arabic UIs.
- Channel numbers and other provider data are never reshaped, in either mode.

**The provider's text is isolated in our sentences.** Every text argument goes in between FIRST STRONG ISOLATE (U+2068) and POP DIRECTIONAL ISOLATE (U+2069), as Mozilla's Fluent does for every placeable. Numbers aren't isolated. Components still put `dir="auto"` and `translate="no"` on provider text they show on its own (step 11b). Step 12b added marks around the isolate for the TVs' engines (below).

### Isolation on the TVs' engines (step 12b, 2026-11-03)
The old-engine harness measured it: **Chromium 53, 56 and 68 draw FSI/PDI at zero width but ignore them for bidi.** In an RTL line, a count after a Latin name ending in a digit joined the name's run (`MBC 1 · 240`, rule W7), and a name starting with a digit split, the same as with no isolates. Current Chromium isolates correctly. Those TVs (webOS 4–5, Tizen 4–5.5, 2018–2020) are much of the GCC's installed base.

They do honour LRM and RLM. So core's `isolateText(text, around)` writes `outer + inner + FSI + text + PDI + inner + outer`:
- `inner` is the text's first-strong direction, the one FSI would pick: the text's own leading and trailing digits and punctuation stay with it.
- `outer` is the sentence's direction: what follows sees a strong character of the sentence, not the text's last one.
- The marks must be outside the isolate: with the inner mark inside it, Chromium 53 still split a leading digit.

The harness checks both lines on every engine, each against a control without isolation that must show the problem, and e2e runs the same probe in current Chromium. Elements (`<bdi>`, `dir="auto"`) also isolate on Chromium 53, but `t()` returns strings, and the components take string labels.

## Consequences
- Adding a language means a catalog, its plural rule in `core`, and its names and formats in `format.ts`. That is the price of not trusting the TVs' ICU.
- Main's own code grew by about 9 KB (the runtime, the formats and the catalogs; Arabic text is `\uXXXX`-escaped by terser's `ascii_only`). No new core-js polyfill: `split` and `new RegExp` were avoided because their polyfills cost about 2 KB and 7 KB.
- Each text argument carries six invisible characters. Tests and code that compare text use core's `stripIsolates`, which also removes LRM and RLM (the provider's own included).
- e2e tests that read text must expect the isolation around names (`isolated()` in `e2e/gallery.spec.ts` calls `isolateText`).

### Reversing the digit default
Set `DEFAULT_DIGITS = 'arab'` in `packages/ui/src/i18n/format.ts`, or pass `{ digits: 'arab' }` from a settings screen through `resolveLocale`. Nothing else changes: the formatters, tests and fonts (U+0660–066C are in the Arabic subset) already handle it.
