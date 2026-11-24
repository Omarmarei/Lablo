import { describe, expect, it } from 'vitest';
import { formatJson } from './format';

describe('formatJson', () => {
  it('keeps arrays of one-line items on one line, objects indented', () => {
    expect(formatJson({ stalls: 1, heapMB: [[0, 10], [5, null]], state: 'PLAYING', list: [{ atMin: 0.2, states: { PAUSED: 16 } }] })).toBe(
      [
        '{',
        '  "stalls": 1,',
        '  "heapMB": [[0, 10], [5, null]],',
        '  "state": "PLAYING",',
        '  "list": [',
        '    {',
        '      "atMin": 0.2,',
        '      "states": {',
        '        "PAUSED": 16',
        '      }',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    );
  });

  it('breaks an array with any multi-line item', () => {
    expect(formatJson([1, { a: 1 }])).toBe('[\n  1,\n  {\n    "a": 1\n  }\n]');
  });

  it('stays JSON', () => {
    const value = { a: [1, 'two', [3, [4]], {}, [], null, true], b: { c: { d: [{ e: 'f' }] } }, g: 'quote " and \\ slash' };
    expect(JSON.parse(formatJson(value))).toEqual(value);
  });

  it('writes plain values, and leaves out undefined as JSON does', () => {
    expect(formatJson(5)).toBe('5');
    expect(formatJson('x')).toBe('"x"');
    expect(formatJson(null)).toBe('null');
    expect(formatJson(undefined)).toBe('undefined');
    expect(formatJson([])).toBe('[]');
    expect(formatJson({})).toBe('{}');
    expect(formatJson({ a: undefined, b: 1 })).toBe('{\n  "b": 1\n}');
    expect(formatJson({ a: undefined })).toBe('{}');
    expect(formatJson([undefined, 1])).toBe('[null, 1]');
  });
});
