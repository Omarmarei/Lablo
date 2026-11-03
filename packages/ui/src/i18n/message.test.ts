import { pluralCategory } from '@zoma/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { MessageArgs, MessageEnv } from './message';
import { MessageSyntaxError, formatMessage, messageArguments, parseMessage, pluralBranches } from './message';
import { pseudoLocalize } from './pseudo';

/** A plain environment: English or Arabic plurals, numbers as JS writes them, text in ‹›. */
function env(language: 'en' | 'ar' = 'en'): MessageEnv {
  return { plural: (n) => pluralCategory(language, n), number: (n) => `n${n}`, text: (value) => `‹${value}›` };
}

function format(source: string, args?: MessageArgs, language: 'en' | 'ar' = 'en'): string {
  return formatMessage(parseMessage(source), args, env(language));
}

function syntaxError(source: string): string {
  try {
    parseMessage(source);
  } catch (error) {
    if (error instanceof MessageSyntaxError) return `${error.reason} @${error.position}`;
    throw error;
  }
  return 'parsed';
}

describe('parseMessage', () => {
  it('reads plain text, arguments and numbers', () => {
    expect(parseMessage('')).toEqual([]);
    expect(parseMessage('Play')).toEqual(['Play']);
    expect(parseMessage('Play {name}?')).toEqual(['Play ', { type: 'argument', name: 'name' }, '?']);
    expect(parseMessage('{ size , number } MB')).toEqual([{ type: 'number', name: 'size' }, ' MB']);
    expect(parseMessage('#1 {a}{b}')).toEqual(['#1 ', { type: 'argument', name: 'a' }, { type: 'argument', name: 'b' }]);
  });

  it('reads plural branches with exact values and #, and select branches', () => {
    expect(parseMessage('{n, plural, =0 {none} one {# item} other {# items}}')).toEqual([
      {
        type: 'plural',
        name: 'n',
        branches: { '=0': ['none'], one: [{ type: 'count' }, ' item'], other: [{ type: 'count' }, ' items'] },
      },
    ]);
    expect(parseMessage('{kind,select,live{#live}other{x}}')).toEqual([
      { type: 'select', name: 'kind', branches: { live: ['#live'], other: ['x'] } },
    ]);
  });

  it('rejects broken messages with the reason and the position', () => {
    expect(syntaxError('Play {name')).toBe('unclosed argument @10');
    expect(syntaxError('Play {name x}')).toBe('expected , @11');
    expect(syntaxError('Play }')).toBe('unmatched } @5');
    expect(syntaxError('{}')).toBe('expected an argument name @1');
    expect(syntaxError('{n, date}')).toBe('unknown argument type "date" @8');
    expect(syntaxError('{n, plural, one {a}}')).toBe('a plural or select needs an other branch @19');
    expect(syntaxError('{n, plural, several {a} other {b}}')).toBe('unknown plural category "several" @19');
    expect(syntaxError('{n, plural, one {a} one {b} other {c}}')).toBe('duplicate branch "one" @23');
    expect(syntaxError('{n, plural, =x {a} other {b}}')).toBe('expected a branch key @14');
    expect(syntaxError('{n, plural, other {a}')).toBe('unclosed argument @21');
    expect(syntaxError('{n, plural, other a}')).toBe('expected { @18');
    expect(syntaxError('{k, select, =1 {a} other {b}}')).toBe('expected a branch key @12');
  });

  it('throws nothing but MessageSyntaxError on any input', () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom('{', '}', '#', ',', ' ', '=', '1', 'n', 'plural', 'select', 'one', 'other', 'a') }), (source) => {
        try {
          const parts = parseMessage(source);
          formatMessage(parts, { n: 3, a: 'x' }, env('ar'));
        } catch (error) {
          expect(error).toBeInstanceOf(MessageSyntaxError);
        }
      }),
    );
  });

  it('parses what pseudoLocalize makes of a valid message', () => {
    const messages = ['Play {name}?', '{n, plural, one {# channel} other {# channels}}', 'A {k, select, live {live {n} } other {other}} b'];
    for (const message of messages) {
      expect(messageArguments(parseMessage(pseudoLocalize(message)))).toEqual(messageArguments(parseMessage(message)));
    }
  });
});

describe('formatMessage', () => {
  it('fills text and number arguments the environment’s way', () => {
    expect(format('Play {name}?', { name: 'Zoma News' })).toBe('Play ‹Zoma News›?');
    expect(format('{count} channels', { count: 240 })).toBe('n240 channels');
    expect(format('{size, number} MB', { size: '12' })).toBe('n12 MB');
  });

  it('shows a missing argument as {name}', () => {
    expect(format('Play {name}?')).toBe('Play {name}?');
    expect(format('Play {name}?', { other: 'x' })).toBe('Play {name}?');
    expect(format('{n, plural, other {# items}}')).toBe('{n}');
  });

  it('picks an exact plural branch first, then the category, then other', () => {
    const message = '{n, plural, =0 {none} =12 {a dozen} one {one item} few {# (few)} other {# items}}';
    expect([0, 1, 2, 3, 12, 13].map((n) => format(message, { n }, 'ar'))).toEqual([
      'none',
      'one item',
      'n2 items',
      'n3 (few)',
      'a dozen',
      'n13 items',
    ]);
    expect(format(message, { n: 3 }, 'en')).toBe('n3 items');
    // An exact value wins over its own category.
    expect(format('{n, plural, =1 {just one} one {# one} other {#}}', { n: 1 })).toBe('just one');
    expect(format('{n, plural, =2 {a pair} two {# two} other {#}}', { n: 2 }, 'ar')).toBe('a pair');
  });

  it('gives every Arabic form its own branch', () => {
    const message = '{n, plural, zero {Z} one {O} two {T} few {F#} many {M#} other {X#}}';
    expect([0, 1, 2, 5, 11, 100, 103, 111, 1.5].map((n) => format(message, { n }, 'ar'))).toEqual([
      'Z',
      'O',
      'T',
      'Fn5',
      'Mn11',
      'Xn100',
      'Fn103',
      'Mn111',
      'Xn1.5',
    ]);
  });

  it('reads # as the number only directly in a plural branch, as ICU does', () => {
    expect(format('{n, plural, other {# {kind, select, live {# live} other {x}}}} #', { n: 4, kind: 'live' })).toBe('n4 # live #');
    expect(format('{kind, select, live {#} other {x}}', { kind: 'live' })).toBe('#');
  });

  it('selects by the argument’s text, else other', () => {
    const message = '{kind, select, live {Live TV} vod {Movies} other {Other}}';
    expect(['live', 'vod', 'series'].map((kind) => format(message, { kind }))).toEqual(['Live TV', 'Movies', 'Other']);
  });
});

describe('the catalog helpers', () => {
  it('lists the arguments and the plural branches, nested ones too', () => {
    const parts = parseMessage('{n, plural, one {{name} #} other {{kind, select, a {{x}} other {}}}} {size, number}');
    expect(messageArguments(parts).sort()).toEqual(['kind:select', 'n:plural', 'name:argument', 'size:number', 'x:argument']);
    expect(pluralBranches(parts)).toEqual(['n: one other']);
    expect(pluralBranches(parseMessage('{a, select, x {{n, plural, =0 {} other {}}} other {}}'))).toEqual(['n: =0 other']);
  });
});
