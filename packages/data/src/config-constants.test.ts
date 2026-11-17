import { killRule } from '@lablo/protocol';
import { describe, expect, it } from 'vitest';
import { MAX_NOTICES, isRuleId } from './config-constants';

/**
 * The rule-id check the profile's notices use (RELAY step 30c2a): the same ids the config's
 * `killRule` schema takes, without its regex (the TV bundle takes no polyfill for it).
 */

/** Whether the protocol's schema takes `id` as a rule's id. */
const schemaTakes = (id: unknown): boolean => killRule.safeParse({ id, match: {}, mode: 'notice' }).success;

/** A seeded generator (no fast-check in this package). */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

describe('isRuleId', () => {
  it("takes exactly the ids the config's schema takes", () => {
    for (const id of ['a', 'fix-104', 'court-order-ae', '0', '-', 'x'.repeat(40)]) expect(isRuleId(id), id).toBe(true);
    for (const id of ['', 'x'.repeat(41), 'Fix', 'a_b', 'a b', 'a.b', 'é', 'ا', 7, null, undefined, ['a']]) expect(isRuleId(id), String(id)).toBe(false);
    // Every code point up to U+017F, alone and between two letters.
    for (let c = 0; c <= 0x17f; c++) {
      const one = String.fromCharCode(c);
      expect(isRuleId(one), `U+${c.toString(16)}`).toBe(schemaTakes(one));
      expect(isRuleId(`a${one}b`), `a U+${c.toString(16)} b`).toBe(schemaTakes(`a${one}b`));
    }
    // Random ids of 0 to 45 characters, mostly from the allowed ones.
    const next = seeded(30);
    const pool = 'abcdefghijklmnopqrstuvwxyz0123456789-_A.Z ';
    for (let n = 0; n < 2000; n++) {
      const length = Math.floor(next() * 46);
      let id = '';
      for (let i = 0; i < length; i++) id += pool.charAt(Math.floor(next() * (next() < 0.9 ? 37 : pool.length)));
      expect(isRuleId(id), id).toBe(schemaTakes(id));
    }
  });

  it('keeps as many notices as a config has rules', () => {
    expect(MAX_NOTICES).toBe(100);
    expect(schemaTakes('a')).toBe(true);
  });
});
