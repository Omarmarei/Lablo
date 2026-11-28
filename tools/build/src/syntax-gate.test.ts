import { describe, expect, it } from 'vitest';
import { GATE_ECMA_VERSION, checkSyntax, formatViolation } from './syntax-gate';

describe('ES2019 syntax gate', () => {
  it('is ES2019: every syntax Chromium 68 runs, and nothing newer (RELAY step 61a)', () => {
    expect(GATE_ECMA_VERSION).toBe(2019);
  });

  it.each([
    ['ES5', 'var a = [1, 2].map(function (x) { return x * 2; });'],
    ['ES2015 classes, arrows, let/const, templates, destructuring', 'class A { m() { const [x] = [1]; let f = (y) => `${x}${y}`; return f; } }'],
    ['ES2015 generators and spread in arrays/calls', 'function* g() { yield* [1]; } Math.max(...[1, 2]);'],
    ['ES2016 exponent operator', 'var n = 2 ** 10;'],
    ['regex sticky and unicode flags (ES2015)', 'var r = /a/yu;'],
    // Chromium 55-66 added each of these; Babel leaves them as they are at chrome 68.
    ['async functions (ES2017)', 'async function f() { await 1; }'],
    ['trailing comma in a call (ES2017)', 'f(1, 2,);'],
    ['object spread (ES2018)', 'var o = { ...a };'],
    ['object rest (ES2018)', 'var { a, ...rest } = o;'],
    ['regex lookbehind (ES2018)', 'var r = /(?<=\\$)\\d+/;'],
    ['regex named groups (ES2018)', 'var r = /(?<year>\\d{4})/;'],
    ['regex dotAll flag (ES2018)', 'var r = /a.b/s;'],
    ['regex unicode property escapes (ES2018)', 'var r = /\\p{L}/u;'],
    ['async iteration (ES2018)', 'async function f() { for await (const x of y) {} }'],
    ['optional catch binding (ES2019)', 'try { f(); } catch { g(); }'],
    ['a line separator in a string (ES2019 JSON superset)', `var s = "a${String.fromCharCode(0x2028)}b";`],
  ])('passes %s', (_name, code) => {
    expect(checkSyntax(code, 'test.js')).toBeNull();
  });

  it.each([
    ['optional chaining (ES2020)', 'var x = a?.b;'],
    ['nullish coalescing (ES2020)', 'var x = a ?? b;'],
    ['a BigInt literal (ES2020)', 'var n = 1n;'],
    ['logical assignment (ES2021)', 'a ||= b;'],
    ['numeric separators (ES2021)', 'var n = 1_000;'],
    ['class fields (ES2022)', 'class A { x = 1; }'],
    ['regex match indices flag (ES2022)', 'var r = /a/d;'],
    ['ES modules', 'import x from "y";'],
  ])('rejects %s', (_name, code) => {
    const violation = checkSyntax(code, 'main.js');
    expect(violation).not.toBeNull();
    expect(violation?.label).toBe('main.js');
    expect(violation?.line).toBe(1);
  });

  it('reports where the violation is, with an excerpt', () => {
    const code = `${'var a = 1;'.repeat(20)}var o = b?.c;`;
    const violation = checkSyntax(code, 'worker:hello');
    expect(violation).toMatchObject({ line: 1, column: 210 });
    expect(violation?.excerpt).toContain('b?.c');
    const text = formatViolation(violation!);
    expect(text).toContain('ES2019 syntax gate failed for worker:hello at 1:210');
    expect(text).toContain('newer than Chromium 68 supports');
  });
});
