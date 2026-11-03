/**
 * PostCSS for the TV app's CSS: the one plugin list that both the Vite dev loop
 * (apps/tv/vite.config.ts) and the TV build (tools/build/src/css.ts) use, so `pnpm dev`
 * mirrors right-to-left layouts exactly as the TVs get them.
 *
 * postcss-rtlcss in `combined` mode: every rule with a direction-dependent declaration
 * (margin-left, padding-right, text-align: left, left/right, border radii, translateX…)
 * becomes a `[dir="ltr"]` rule and a mirrored `[dir="rtl"]` one. The app sets `dir` on
 * `<html>` from the locale, so write physical properties for the left-to-right layout and
 * never logical ones (Chromium 53 has none). Two limits:
 * - an element inside the page that sets `dir` itself (an LTR URL field in Arabic) still
 *   matches the page's `[dir="rtl"]` rules, so keep direction-dependent CSS out of such islands
 *   or mark it with a `/*rtl:ignore*\/` comment;
 * - a rule without direction-dependent declarations is left as it is, so a mirrored rule's
 *   selector is one attribute more specific than the rule's other selectors.
 *
 * The TV build also copies the `url()` assets and runs the Chromium 53 CSS gate
 * (tools/build/src/css-gate.ts). ADR-003 has the background.
 */
import postcssRtlcss from 'postcss-rtlcss';

export const RTL_MODE = 'combined';

export function tvPostcssPlugins(): Array<ReturnType<typeof postcssRtlcss>> {
  return [postcssRtlcss({ mode: RTL_MODE })];
}
