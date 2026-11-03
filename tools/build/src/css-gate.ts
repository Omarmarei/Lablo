import type { Root } from 'postcss';

/**
 * The CSS counterpart of the ES2016 syntax gate: the built app.css must not use CSS that
 * Chromium 53 (2018 LG webOS 4) lacks. An unknown property or value is dropped silently
 * there, so a layout that looks right on the desktop collapses on the TV with no error.
 * CLAUDE.md's cheat sheet lists the rules; this gate enforces them on the output, after
 * postcss-rtlcss, so whatever produced a rule is checked.
 */
export interface CssViolation {
  /** `file:line:column` of the source rule, or `app.css` when it has no source. */
  readonly where: string;
  /** What was found, e.g. `display: grid` or `:focus-visible`. */
  readonly found: string;
  readonly reason: string;
}

interface DeclarationRule {
  readonly prop: RegExp;
  /** Matched against the value; omitted means any value. */
  readonly value?: RegExp;
  readonly reason: string;
}

const LOGICAL =
  'logical properties are Chromium 87+: write the physical property (margin-left, padding-right…); postcss-rtlcss makes the RTL rule';

const DECLARATIONS: readonly DeclarationRule[] = [
  { prop: /^display$/, value: /\b(inline-)?grid\b/, reason: 'CSS Grid is Chromium 57+: use flexbox' },
  { prop: /^display$/, value: /\b(contents|flow-root)\b/, reason: 'display: contents/flow-root is Chromium 58+' },
  { prop: /^(grid|grid-.+|place-.+)$/, reason: 'CSS Grid is Chromium 57+: use flexbox' },
  { prop: /^(gap|row-gap|column-gap)$/, reason: 'flex gap is Chromium 84+: use margins' },
  { prop: /^position$/, value: /\bsticky\b/, reason: 'position: sticky is Chromium 56+' },
  { prop: /^(margin|padding|border|inset|scroll-margin|scroll-padding|overflow|overscroll-behavior)-(inline|block)(-.+)?$/, reason: LOGICAL },
  { prop: /^(min-|max-)?(inline|block)-size$/, reason: LOGICAL },
  { prop: /^border-(start|end)-(start|end)-radius$/, reason: LOGICAL },
  { prop: /^inset$/, reason: 'inset is Chromium 87+: write top/right/bottom/left' },
  { prop: /^(float|clear)$/, value: /\binline-(start|end)\b/, reason: LOGICAL },
  { prop: /^aspect-ratio$/, reason: 'aspect-ratio is Chromium 88+: size from layout constants' },
  { prop: /^backdrop-filter$/, reason: 'backdrop-filter is Chromium 76+ (and slow on TVs)' },
  { prop: /^(clip-path|user-select|mask|mask-.+|appearance|box-decoration-break)$/, reason: 'Chromium 53 needs the -webkit- prefix: write -webkit-<property>' },
  { prop: /^(translate|rotate|scale)$/, reason: 'individual transform properties are Chromium 104+: use transform' },
  { prop: /^content-visibility$|^container(-.+)?$/, reason: 'Chromium 85+/105+' },
];

interface ValueRule {
  readonly value: RegExp;
  readonly reason: string;
}

const VALUES: readonly ValueRule[] = [
  { value: /\b(clamp|min|max)\(/, reason: 'clamp(), min() and max() are Chromium 79+: use calc() or a media query' },
  { value: /\benv\(/, reason: 'env() is Chromium 69+' },
  { value: /\b(lab|lch|oklab|oklch|hwb|color|color-mix|light-dark)\(/, reason: 'CSS Color 4/5 functions are Chromium 101+: use #rrggbb, rgb() or rgba()' },
  { value: /\bconic-gradient\(/, reason: 'conic-gradient() is Chromium 69+' },
  { value: /(^|[^-])\bimage-set\(/, reason: 'image-set() needs -webkit-image-set() in Chromium 53' },
  { value: /#([0-9a-f]{4}|[0-9a-f]{8})\b/i, reason: '#rgba and #rrggbbaa hex colours are Chromium 62+: use rgba()' },
  { value: /\b(rgba?|hsla?)\([^,()]*\s[^,()]*\)/, reason: 'space-separated colour syntax is Chromium 65+: use commas (rgba(0, 0, 0, 0.5))' },
  // vw, vh, vmin and vmax are fine (Chromium 26+).
  { value: /\d(s|d|l)v(i|b|h|w|min|max)\b|\dv(i|b)\b/, reason: 'small/large/dynamic viewport units (svh, dvh…) and vi/vb are Chromium 108+' },
  { value: /\d(cqw|cqh|cqi|cqb|cqmin|cqmax)\b/, reason: 'container query units are Chromium 105+' },
];

interface SelectorRule {
  readonly selector: RegExp;
  readonly reason: string;
}

const SELECTORS: readonly SelectorRule[] = [
  { selector: /:(is|where|has)\(/, reason: ':is(), :where() and :has() are Chromium 88+/105+' },
  { selector: /:focus-visible\b/, reason: ':focus-visible is Chromium 86+ (and the app never uses DOM focus for the remote)' },
  { selector: /:focus-within\b/, reason: ':focus-within is Chromium 60+' },
  { selector: /:not\([^)]*[,\s>+~][^)]*\)/, reason: ':not() with a list or a combinator is Chromium 88+: use one simple selector per :not()' },
  { selector: /:dir\(/, reason: ':dir() is Chromium 120+: use [dir="rtl"] (postcss-rtlcss does)' },
  { selector: /:any-link\b/, reason: ':any-link is Chromium 65+' },
  { selector: /(^|[^-])::placeholder\b/, reason: '::placeholder is Chromium 57+: use ::-webkit-input-placeholder' },
  { selector: /::marker\b/, reason: '::marker is Chromium 86+' },
  { selector: /:nth-(last-)?child\([^)]*\bof\b/, reason: ':nth-child(… of S) is Chromium 111+' },
  { selector: /&/, reason: 'CSS nesting is Chromium 112+: write flat rules' },
];

const AT_RULES: ReadonlySet<string> = new Set(['layer', 'container', 'property', 'scope', 'nest', 'custom-media', 'starting-style', 'counter-style']);

/** Media features compared with < > <= >= (range syntax) are Chromium 104+. */
const MEDIA_RANGE = /\([^)]*[<>]=?[^)]*\)/;

function where(node: { source?: { input: { file?: string }; start?: { line: number; column: number } } }): string {
  const file = node.source?.input.file;
  const start = node.source?.start;
  const name = file === undefined ? 'app.css' : file.split(/[\\/]/).slice(-3).join('/');
  return start === undefined ? name : `${name}:${start.line}:${start.column}`;
}

/** Every Chromium 53 incompatibility in `root`, in document order. */
export function checkCss(root: Root): CssViolation[] {
  const violations: CssViolation[] = [];
  root.walk((node) => {
    if (node.type === 'decl') {
      const found = `${node.prop}: ${node.value}`;
      const prop = node.prop.toLowerCase();
      // A custom property (a design token) is no property rule's business, but its value
      // still is: `--scrim: #0008` breaks wherever var(--scrim) lands.
      const rules = prop.startsWith('--') ? [] : DECLARATIONS;
      for (const rule of rules) {
        if (rule.prop.test(prop) && (rule.value === undefined || rule.value.test(node.value))) {
          violations.push({ where: where(node), found, reason: rule.reason });
        }
      }
      for (const rule of VALUES) {
        if (rule.value.test(node.value)) violations.push({ where: where(node), found, reason: rule.reason });
      }
    } else if (node.type === 'rule') {
      for (const rule of SELECTORS) {
        if (rule.selector.test(node.selector)) violations.push({ where: where(node), found: node.selector, reason: rule.reason });
      }
    } else if (node.type === 'atrule') {
      const name = node.name.toLowerCase();
      if (AT_RULES.has(name)) {
        violations.push({ where: where(node), found: `@${node.name} ${node.params}`.trim(), reason: `@${name} is not supported by Chromium 53` });
      } else if (name === 'media' && MEDIA_RANGE.test(node.params)) {
        violations.push({ where: where(node), found: `@media ${node.params}`, reason: 'media query range syntax is Chromium 104+: use min-width/max-width' });
      }
    }
  });
  return violations;
}

export class CssGateError extends Error {
  override readonly name = 'CssGateError';
}

export function formatCssViolations(label: string, violations: readonly CssViolation[]): string {
  const lines = violations.map((v) => `  ${v.where}  ${v.found}\n    ${v.reason}`);
  return `Chromium 53 CSS gate failed for ${label} (${violations.length}):\n${lines.join('\n')}`;
}
