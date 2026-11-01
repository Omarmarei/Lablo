import { parse } from 'acorn';

/**
 * The newest syntax the TV bundles may contain. Chromium 53 (2018 LG webOS 4) runs ES2016;
 * async functions, object rest/spread, trailing commas in calls, regex lookbehind and named
 * groups are all newer and must never reach the TV (ADR-003).
 */
export const GATE_ECMA_VERSION = 2016;

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

/** Parses `code` as an ES2016 classic script. Returns the first violation, or `null`. */
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
    '  Something newer than Chromium 53 supports reached the bundle. Babel could not',
    '  transpile it (e.g. a regex lookbehind) or it came from an untranspiled file.',
  ].join('\n');
}
