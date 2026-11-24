import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { formatMarks, MARKS_EXPRESSION, SCREEN_EXPRESSION, SCREEN_TEXT_LIMIT } from './probes';

function run(code: string, globals: Record<string, unknown>): unknown {
  const context = vm.createContext(globals);
  vm.runInContext('var window = this;', context);
  return JSON.parse(JSON.stringify(vm.runInContext(code, context)));
}

describe('SCREEN_EXPRESSION', () => {
  it('reads the focus path and the page text', () => {
    expect(run(SCREEN_EXPRESSION, { __LABLO_TEST__: { focusPath: () => 'live/channels/3' }, document: { body: { innerText: 'Live\nChannel 3' } } })).toEqual({
      focus: 'live/channels/3',
      text: 'Live\nChannel 3',
    });
  });

  it('cuts a long text, and works without the hook or a body', () => {
    expect(SCREEN_TEXT_LIMIT).toBe(2000);
    expect(run(SCREEN_EXPRESSION, { document: { body: { innerText: 'a'.repeat(SCREEN_TEXT_LIMIT) } } })).toEqual({ focus: null, text: 'a'.repeat(2000) });
    expect(run(SCREEN_EXPRESSION, { document: { body: { innerText: 'b'.repeat(SCREEN_TEXT_LIMIT + 1) } } })).toEqual({
      focus: null,
      text: `${'b'.repeat(2000)} [...]`,
    });
    expect(run(SCREEN_EXPRESSION, { document: { body: null } })).toEqual({ focus: null, text: '' });
  });
});

describe('MARKS_EXPRESSION', () => {
  it("gives the start's marks and DOMContentLoaded from the navigation start", () => {
    const performance = {
      timing: { navigationStart: 1000, domContentLoadedEventStart: 3400 },
      getEntriesByType: (type: string) =>
        type === 'mark'
          ? [
              { name: 'lablo:resume', startTime: 4812.6 },
              { name: 'other', startTime: 1 },
              { name: 'xlablo:fake', startTime: 2 },
              { name: 'lablo:live-ready', startTime: 4860.2 },
            ]
          : [],
    };
    expect(run(MARKS_EXPRESSION, { performance })).toEqual({
      domContentLoaded: 2400,
      marks: [
        ['lablo:resume', 4813],
        ['lablo:live-ready', 4860],
      ],
    });
  });

  it('prints as aligned lines', () => {
    expect(formatMarks({ domContentLoaded: 2400, marks: [['lablo:resume', 4813], ['lablo:resume-frame', 9612]] })).toBe(
      ['DOMContentLoaded     2400 ms', 'lablo:resume         4813 ms', 'lablo:resume-frame   9612 ms'].join('\n'),
    );
    expect(formatMarks({ domContentLoaded: null, marks: [] })).toBe('DOMContentLoaded         -');
    expect(formatMarks({ domContentLoaded: 5, marks: ['odd', ['x', 1]] })).toBe(['DOMContentLoaded      5 ms', 'x                     1 ms'].join('\n'));
    expect(formatMarks('nope')).toBe('"nope"');
    expect(formatMarks(null)).toBe('null');
  });

  it('gives null for DOMContentLoaded before it fires', () => {
    const performance = { timing: { navigationStart: 1000, domContentLoadedEventStart: 0 }, getEntriesByType: () => [] };
    expect(run(MARKS_EXPRESSION, { performance, Math })).toEqual({ domContentLoaded: null, marks: [] });
  });
});
