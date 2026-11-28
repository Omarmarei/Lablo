import { parse } from 'acorn';

/**
 * The newest syntax the TV bundles may contain. The oldest TV engine is Chromium 68 (2020 LG
 * webOS 5; RELAY step 61a, ADR-003), which runs every ES2019 syntax addition: async functions,
 * object rest/spread, async iteration, the regex `s` flag, lookbehind and named groups (ES2017-18,
 * Chromium 55-64), optional catch binding and line separators in strings (ES2019, Chromium 66).
 * ES2020 and newer (`?.`, `??`, BigInt literals, class fields, the regex `d` flag…) must never
 * reach the TV: Babel transpiles most of it, and this gate catches what it can't.
 */
export const GATE_ECMA_VERSION = 2019;

/** The oldest engine the gate stands for, for its messages. */
const OLDEST_ENGINE = 'Chromium 68';

export interface GateViolation {
  readonly label: string;
  readonly message: string;
  readonly line: number;
  readonly column: number;
  /** Up to 60 characters either side of the failure (bundles are minified to one line). */
  readonly excerpt: string;
}

interface AcornSyntaxError extends SyntaxError {
  readonly pos: number;
  readonly loc: { readonly line: number; readonly column: number };
}

function isAcornError(error: unknown): error is AcornSyntaxError {
  return error instanceof SyntaxError && 'pos' in error && 'loc' in error;
}

/** Parses `code` as an ES2019 classic script. Returns the first violation, or `null`. */
export function checkSyntax(code: string, label: string): GateViolation | null {
  try {
    parse(code, { ecmaVersion: GATE_ECMA_VERSION, sourceType: 'script', locations: true });
    return null;
  } catch (error) {
    if (!isAcornError(error)) throw error;
    const start = Math.max(0, error.pos - 60);
    return {
      label,
      message: error.message,
      line: error.loc.line,
      column: error.loc.column,
      excerpt: code.slice(start, error.pos + 60).replace(/\s+/g, ' '),
    };
  }
}

export function formatViolation(v: GateViolation): string {
  return [
    `ES${GATE_ECMA_VERSION} syntax gate failed for ${v.label} at ${v.line}:${v.column}: ${v.message}`,
    `  near: ${v.excerpt}`,
    `  Something newer than ${OLDEST_ENGINE} supports reached the bundle. Babel could not`,
    '  transpile it (e.g. the regex d flag) or it came from an untranspiled file.',
  ].join('\n');
}
