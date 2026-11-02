import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { JsonSplitterOptions, JsonSplitterStats } from './json-splitter';
import { JsonArraySplitter, splitJsonArray } from './json-splitter';

const BOM = String.fromCharCode(0xfeff);

function splitChunks(chunks: string[], options?: JsonSplitterOptions): { elements: string[]; stats: JsonSplitterStats } {
  const splitter = new JsonArraySplitter(options);
  const elements: string[] = [];
  for (const chunk of chunks) elements.push(...splitter.push(chunk));
  elements.push(...splitter.end());
  return { elements, stats: { ...splitter.stats } };
}

/** Splits `text` at the given offsets (any order; repeated offsets give empty chunks). */
function cut(text: string, cuts: number[]): string[] {
  const points = cuts.map((c) => c % (text.length + 1)).sort((a, b) => a - b);
  const out: string[] = [];
  let last = 0;
  for (const p of points) {
    out.push(text.slice(last, p));
    last = p;
  }
  out.push(text.slice(last));
  return out;
}

const stats = (s: Partial<JsonSplitterStats>): JsonSplitterStats => ({
  shape: 'array',
  elements: 0,
  truncated: false,
  oversized: 0,
  stray: 0,
  trailing: 0,
  ...s,
});

describe('JsonArraySplitter golden', () => {
  it('yields each top-level element as text, whatever its type', () => {
    const text = '[{"a":1,"b":[2,{"c":"]}"}]}, [1,2] ,"s\\"t\\\\",-12.5e3,true,null , {"esc":"\\u0022{"}]';
    const { elements, stats: s } = splitJsonArray(text);
    expect(elements).toEqual(['{"a":1,"b":[2,{"c":"]}"}]}', '[1,2]', '"s\\"t\\\\"', '-12.5e3', 'true', 'null', '{"esc":"\\u0022{"}']);
    expect(s).toEqual(stats({ elements: 7 }));
    for (const e of elements) expect(() => JSON.parse(e)).not.toThrow();
  });

  it('skips a BOM and whitespace, and reads an empty array', () => {
    expect(splitJsonArray(`${BOM} \r\n\t[ ]\n`)).toEqual({ elements: [], stats: stats({}) });
    expect(splitJsonArray(`${BOM}[{"a":1}]`).elements).toEqual(['{"a":1}']);
  });

  it('reads the values of an object top level (empty, keyed lists, error objects)', () => {
    expect(splitJsonArray('{}')).toEqual({ elements: [], stats: stats({ shape: 'object' }) });
    expect(splitJsonArray('{"0":{"id":1},"1" : {"id":2}, "k\\"ey": [3]}').elements).toEqual(['{"id":1}', '{"id":2}', '[3]']);
    expect(splitJsonArray('{"user_info":{"auth":0}}')).toEqual({ elements: ['{"auth":0}'], stats: stats({ shape: 'object', elements: 1 }) });
    // A missing comma between members: the next string is still a key.
    expect(splitJsonArray('{"a":1 "b":2}').elements).toEqual(['1', '2']);
  });

  it('tolerates missing and doubled commas', () => {
    expect(splitJsonArray('[,{"a":1},,{"b":2}{"c":3},]').elements).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('drops the incomplete tail of a cut-off response and flags it', () => {
    expect(splitJsonArray('[{"a":1},{"b":"x')).toEqual({ elements: ['{"a":1}'], stats: stats({ elements: 1, truncated: true }) });
    expect(splitJsonArray('[{"a":1}')).toEqual({ elements: ['{"a":1}'], stats: stats({ elements: 1, truncated: true }) });
    // A number at the very end may be cut short too, so it is dropped.
    expect(splitJsonArray('[1,23').elements).toEqual(['1']);
    expect(splitJsonArray('[')).toEqual({ elements: [], stats: stats({ truncated: true }) });
  });

  it('reads nothing from a non-JSON or scalar body', () => {
    expect(splitJsonArray('<html><body>[{"a":1}]</body></html>')).toEqual({ elements: [], stats: stats({ shape: 'other' }) });
    expect(splitJsonArray('null')).toEqual({ elements: [], stats: stats({ shape: 'other' }) });
    expect(splitJsonArray('')).toEqual({ elements: [], stats: stats({ shape: 'unknown' }) });
    expect(splitJsonArray('  \n')).toEqual({ elements: [], stats: stats({ shape: 'unknown' }) });
  });

  it('counts stray and trailing characters', () => {
    expect(splitJsonArray('[1:2] x]')).toEqual({ elements: ['1', '2'], stats: stats({ elements: 2, stray: 1, trailing: 2 }) });
  });

  it('drops elements over the length limit, in one chunk or many', () => {
    const big = `{"name":"${'x'.repeat(100)}"}`;
    const text = `[{"a":1},${big},{"b":2}]`;
    const expected = { elements: ['{"a":1}', '{"b":2}'], stats: stats({ elements: 2, oversized: 1 }) };
    expect(splitJsonArray(text, { maxElementLength: 50 })).toEqual(expected);
    expect(splitChunks(cut(text, [12, 30, 60, 90]), { maxElementLength: 50 })).toEqual(expected);
    expect(splitChunks(text.split(''), { maxElementLength: 50 })).toEqual(expected);
    // An element exactly at the limit is kept.
    expect(splitJsonArray('["abcd"]', { maxElementLength: 6 }).elements).toEqual(['"abcd"']);
    expect(splitJsonArray('["abcde"]', { maxElementLength: 6 }).elements).toEqual([]);
  });

  it('keeps escape and string state across chunk boundaries', () => {
    const text = '[{"q":"a\\\\"},{"r":"\\"]}"}]';
    expect(splitChunks(text.split('')).elements).toEqual(['{"q":"a\\\\"}', '{"r":"\\"]}"}']);
  });
});

/** JSON values whose JSON.stringify round trip is stable (no `__proto__` keys). */
const jsonValue = fc.jsonValue().filter((v) => !JSON.stringify(v).includes('"__proto__"'));
const anyText = fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((c) => String.fromCharCode(c)), maxLength: 400 });
const cuts = fc.array(fc.nat(), { maxLength: 12 });

describe('JsonArraySplitter properties', () => {
  it('returns every element of any JSON array, however it is formatted and chunked', () => {
    fc.assert(
      fc.property(fc.array(jsonValue, { maxLength: 12 }), fc.boolean(), cuts, (values, pretty, at) => {
        const text = JSON.stringify(values, null, pretty ? 2 : undefined);
        const { elements, stats: s } = splitChunks(cut(text, at));
        expect(elements.map((e) => JSON.parse(e) as unknown)).toEqual(JSON.parse(text));
        expect(s).toEqual(stats({ elements: values.length }));
      }),
      { numRuns: 300 },
    );
  });

  it('returns the member values of any JSON object in order', () => {
    const object = fc.dictionary(fc.string({ maxLength: 8 }).filter((k) => k !== '__proto__'), jsonValue, { maxKeys: 8 });
    fc.assert(
      fc.property(object, cuts, (value, at) => {
        const text = JSON.stringify(value);
        const { elements, stats: s } = splitChunks(cut(text, at));
        expect(elements.map((e) => JSON.parse(e) as unknown)).toEqual(Object.values(JSON.parse(text) as object));
        expect(s.shape).toBe('object');
      }),
      { numRuns: 200 },
    );
  });

  it('a cut-off array yields a prefix of its elements', () => {
    fc.assert(
      fc.property(fc.array(jsonValue, { minLength: 1, maxLength: 10 }), fc.nat(), cuts, (values, at, chunkAt) => {
        const full = JSON.stringify(values);
        const text = full.slice(0, at % full.length);
        const { elements, stats: s } = splitChunks(cut(text, chunkAt));
        const parsed = elements.map((e) => JSON.parse(e) as unknown);
        expect(parsed).toEqual((JSON.parse(full) as unknown[]).slice(0, parsed.length));
        if (text.trim().length > 0) expect(s.truncated).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('never throws, and gives the same result for any chunking of any text', () => {
    fc.assert(
      fc.property(anyText, cuts, (text, at) => {
        const whole = splitChunks([text], { maxElementLength: 64 });
        expect(splitChunks(cut(text, at), { maxElementLength: 64 })).toEqual(whole);
      }),
      { numRuns: 500 },
    );
    // Text that looks like JSON reaches the deeper states more often than random UTF-16.
    const jsonish = fc.array(fc.constantFrom('[', ']', '{', '}', '"', '\\', ',', ':', ' ', 'a', '1', BOM), { maxLength: 60 }).map((a) => a.join(''));
    fc.assert(
      fc.property(jsonish, cuts, (text, at) => {
        expect(splitChunks(cut(text, at), { maxElementLength: 8 })).toEqual(splitChunks([text], { maxElementLength: 8 }));
      }),
      { numRuns: 1000 },
    );
  });
});
