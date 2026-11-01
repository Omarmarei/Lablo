import { describe, expect, it } from 'vitest';
import { checkSyntax, formatViolation } from './syntax-gate';

describe('ES2016 syntax gate', () => {
  it.each([
    ['ES5', 'var a = [1, 2].map(function (x) { return x * 2; });'],
    ['ES2015 classes, arrows, let/const, templates, destructuring', 'class A { m() { const [x] = [1]; let f = (y) => `${x}${y}`; return f; } }'],
    ['ES2015 generators and spread in arrays/calls', 'function* g() { yield* [1]; } Math.max(...[1, 2]);'],
    ['ES2016 exponent operator', 'var n = 2 ** 10;'],
    ['regex sticky and unicode flags (ES2015)', 'var r = /a/yu;'],
  ])('passes %s', (_name, code) => {
    expect(checkSyntax(code, 'test.js')).toBeNull();
  });

  it.each([
    ['async functions (ES2017)', 'async function f() { await 1; }'],
    ['trailing comma in a call (ES2017)', 'f(1, 2,);'],
    ['object spread (ES2018)', 'var o = { ...a };'],
    ['object rest (ES2018)', 'var { a, ...rest } = o;'],
    ['regex lookbehind (ES2018)', 'var r = /(?<=\\$)\\d+/;'],
    ['regex named groups (ES2018)', 'var r = /(?<year>\\d{4})/;'],
    ['regex dotAll flag (ES2018)', 'var r = /a.b/s;'],
    ['async iteration (ES2018)', 'async function f() { for await (const x of y) {} }'],
    ['optional catch binding (ES2019)', 'try { f(); } catch { g(); }'],
    ['optional chaining (ES2020)', 'var x = a?.b;'],
    ['nullish coalescing (ES2020)', 'var x = a ?? b;'],
    ['logical assignment (ES2021)', 'a ||= b;'],
    ['ES modules', 'import x from "y";'],
  ])('rejects %s', (_name, code) => {
    const violation = checkSyntax(code, 'main.js');
    expect(violation).not.toBeNull();
    expect(violation?.label).toBe('main.js');
    expect(violation?.line).toBe(1);
  });

  it('reports where the violation is, with an excerpt', () => {
    const code = `${'var a = 1;'.repeat(20)}var o = { ...b };`;
    const violation = checkSyntax(code, 'worker:hello');
    expect(violation).toMatchObject({ line: 1, column: 210 });
    expect(violation?.excerpt).toContain('{ ...b }');
    expect(formatViolation(violation!)).toContain('ES2016 syntax gate failed for worker:hello at 1:210');
  });
});
