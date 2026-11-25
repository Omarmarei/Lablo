import { describe, expect, it } from 'vitest';
import type { ConfigDoc } from '@lablo/protocol';
import { configDocSchema } from '@lablo/protocol';
import type { PolicyInput } from './config-policy';
import { KILL_STRENGTH, compareVersions, configPolicy, noPolicy, policyStops, ruleMatches, versionParts } from './config-policy';

type Rule = ConfigDoc['kill'][number];

function doc(fields: Partial<ConfigDoc> = {}): ConfigDoc {
  const value: ConfigDoc = {
    v: 1,
    issuedAt: 1_000,
    expiresAt: 2_000,
    minVersion: {},
    kill: [],
    blocklist: { salt: 'QtHj17D-F3HxhSWwfvhERM83', hashes: [] },
    flags: {},
    tunables: {},
    ...fields,
  };
  // Every doc here is one the schema accepts, as the policy only ever sees those.
  return configDocSchema.parse(value);
}

const TV: PolicyInput = { platform: 'webos', version: '1.4.2', country: 'AE' };
const MESSAGE = { en: 'Read this', ar: 'اقرأ هذا' };

describe('versionParts and compareVersions', () => {
  it('reads major.minor.patch', () => {
    expect(versionParts('0.1.0')).toEqual([0, 1, 0]);
    expect(versionParts('12.345.65535')).toEqual([12, 345, 65535]);
    expect(versionParts('007.08.9')).toEqual([7, 8, 9]);
  });

  it('refuses anything else', () => {
    for (const bad of ['', '1', '1.2', '1.2.3.4', '1..3', '.1.2', '1.2.', '-1.2.3', '1.2.3-beta', 'v1.2.3', '1.2.a', '1.2.123456', ' 1.2.3', '1.2.3 ', '1.2/3', '1:2.3', '1.2:3', '1.2.3/', '1.2.3:', '1.2./']) {
      expect(versionParts(bad), bad).toBeNull();
    }
  });

  it('compares numerically, part by part', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.99')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '10.0.0')).toBeLessThan(0);
    expect(compareVersions('1.2.3', '1.3.0')).toBeLessThan(0);
    expect(compareVersions('01.2.3', '1.2.3')).toBe(0);
  });

  it('is NaN when either side is not a version', () => {
    expect(compareVersions('1.2', '1.2.3')).toBeNaN();
    expect(compareVersions('1.2.3', 'x')).toBeNaN();
  });
});

describe('ruleMatches', () => {
  const rule = (match: Rule['match']): Rule => ({ id: 'r', match, mode: 'disable-app' });

  it('matches everyone without conditions', () => {
    expect(ruleMatches(rule({}), TV)).toBe(true);
    expect(ruleMatches(rule({}), { platform: 'browser', version: '0.0.0', country: null })).toBe(true);
  });

  it('checks the platform', () => {
    expect(ruleMatches(rule({ platform: 'webos' }), TV)).toBe(true);
    expect(ruleMatches(rule({ platform: 'tizen' }), TV)).toBe(false);
    expect(ruleMatches(rule({ platform: 'webos' }), { ...TV, platform: 'browser' })).toBe(false);
    expect(ruleMatches(rule({ platform: 'tizen' }), { ...TV, platform: 'browser' })).toBe(false);
  });

  it('checks the versions, both ends included', () => {
    expect(ruleMatches(rule({ versions: { min: '1.4.2' } }), TV)).toBe(true);
    expect(ruleMatches(rule({ versions: { min: '1.4.3' } }), TV)).toBe(false);
    expect(ruleMatches(rule({ versions: { max: '1.4.2' } }), TV)).toBe(true);
    expect(ruleMatches(rule({ versions: { max: '1.4.1' } }), TV)).toBe(false);
    expect(ruleMatches(rule({ versions: { min: '1.0.0', max: '1.9.0' } }), TV)).toBe(true);
    expect(ruleMatches(rule({ versions: { min: '1.5.0', max: '1.9.0' } }), TV)).toBe(false);
    expect(ruleMatches(rule({ versions: { min: '1.0.0', max: '1.4.0' } }), TV)).toBe(false);
    expect(ruleMatches(rule({ versions: {} }), TV)).toBe(true);
  });

  it("doesn't match a version it can't read", () => {
    expect(ruleMatches(rule({ versions: { min: '0.0.0' } }), { ...TV, version: 'dev' })).toBe(false);
    expect(ruleMatches(rule({ versions: { max: '99.0.0' } }), { ...TV, version: 'dev' })).toBe(false);
  });

  it('checks the country, which must be known', () => {
    expect(ruleMatches(rule({ countries: ['SA', 'AE'] }), TV)).toBe(true);
    expect(ruleMatches(rule({ countries: ['SA', 'US'] }), TV)).toBe(false);
    expect(ruleMatches(rule({ countries: ['AE'] }), { ...TV, country: null })).toBe(false);
  });

  it('needs every condition', () => {
    const all = rule({ platform: 'webos', versions: { max: '1.4.2' }, countries: ['AE'] });
    expect(ruleMatches(all, TV)).toBe(true);
    expect(ruleMatches(all, { ...TV, platform: 'tizen' })).toBe(false);
    expect(ruleMatches(all, { ...TV, version: '1.4.3' })).toBe(false);
    expect(ruleMatches(all, { ...TV, country: 'US' })).toBe(false);
  });
});

describe('configPolicy', () => {
  it('is nothing for a doc without rules or a minimum version', () => {
    expect(configPolicy(doc(), TV)).toEqual(noPolicy());
  });

  it('takes the strongest matching rule, the first among equals', () => {
    const policy = configPolicy(
      doc({
        kill: [
          { id: 'a', match: {}, mode: 'block-new-sources' },
          { id: 'b', match: { platform: 'tizen' }, mode: 'disable-app' },
          { id: 'c', match: {}, mode: 'disable-playback', message: MESSAGE },
          { id: 'd', match: {}, mode: 'disable-playback' },
          { id: 'e', match: {}, mode: 'block-new-sources' },
        ],
      }),
      TV,
    );
    expect(policy.kill).toEqual({ id: 'c', mode: 'disable-playback', message: MESSAGE });
    expect(policy.notices).toEqual([]);
  });

  it('climbs to a stronger rule later in the doc', () => {
    const kill: Rule[] = [
      { id: 'a', match: {}, mode: 'block-new-sources' },
      { id: 'b', match: {}, mode: 'disable-app' },
    ];
    expect(configPolicy(doc({ kill }), TV).kill?.id).toBe('b');
    expect(configPolicy(doc({ kill: [kill[1]!, kill[0]!] }), TV).kill?.id).toBe('b');
  });

  it('lists the matching notices in order, apart from the kill rule', () => {
    const policy = configPolicy(
      doc({
        kill: [
          { id: 'n1', match: {}, mode: 'notice', message: MESSAGE },
          { id: 'n2', match: { countries: ['US'] }, mode: 'notice', message: MESSAGE },
          { id: 'k', match: {}, mode: 'block-new-sources' },
          { id: 'n3', match: { platform: 'webos' }, mode: 'notice' },
        ],
      }),
      TV,
    );
    expect(policy.notices).toEqual([
      { id: 'n1', mode: 'notice', message: MESSAGE },
      { id: 'n3', mode: 'notice', message: null },
    ]);
    expect(policy.kill).toEqual({ id: 'k', mode: 'block-new-sources', message: null });
  });

  it('copies the message rather than sharing the doc', () => {
    const d = doc({ kill: [{ id: 'k', match: {}, mode: 'disable-app', message: { ...MESSAGE } }] });
    const policy = configPolicy(d, TV);
    expect(policy.kill?.message).toEqual(MESSAGE);
    expect(policy.kill?.message).not.toBe(d.kill[0]!.message);
  });

  it('asks for an update below the platform minimum only', () => {
    const minVersion = { webos: '1.4.3', tizen: '2.0.0' };
    expect(configPolicy(doc({ minVersion }), TV)).toMatchObject({ updateRequired: true, minVersion: '1.4.3' });
    expect(configPolicy(doc({ minVersion }), { ...TV, version: '1.4.3' })).toMatchObject({ updateRequired: false, minVersion: '1.4.3' });
    expect(configPolicy(doc({ minVersion }), { ...TV, version: '1.5.0' })).toMatchObject({ updateRequired: false });
    expect(configPolicy(doc({ minVersion }), { ...TV, platform: 'tizen' })).toMatchObject({ updateRequired: true, minVersion: '2.0.0' });
    expect(configPolicy(doc({ minVersion: { tizen: '2.0.0' } }), TV)).toMatchObject({ updateRequired: false, minVersion: null });
    expect(configPolicy(doc({ minVersion }), { ...TV, platform: 'browser' })).toMatchObject({ updateRequired: false, minVersion: null });
    expect(configPolicy(doc({ minVersion }), { ...TV, version: 'dev' })).toMatchObject({ updateRequired: false, minVersion: '1.4.3' });
  });

  it('passes the flags and tunables through', () => {
    const policy = configPolicy(doc({ flags: { newGuide: true, oldPlayer: false }, tunables: { liveBufferSeconds: 8, telemetrySampling: { crash: 0.5 } } }), TV);
    expect(policy.flags).toEqual({ newGuide: true, oldPlayer: false });
    expect(policy.tunables).toEqual({ liveBufferSeconds: 8, telemetrySampling: { crash: 0.5 } });
  });

  it("gives the test stream's link, null without one (step 40b)", () => {
    const url = 'https://media.lablo.example/test/pattern.m3u8';
    expect(configPolicy(doc({ testStream: { url } }), TV).testStream).toBe(url);
    expect(configPolicy(doc(), TV).testStream).toBeNull();
    expect(noPolicy().testStream).toBeNull();
  });
});

describe('policyStops', () => {
  it('climbs the ladder: each mode includes the ones below it', () => {
    expect(KILL_STRENGTH).toEqual({ notice: 0, 'block-new-sources': 1, 'disable-playback': 2, 'disable-app': 3 });
    const at = (mode: Rule['mode']) => configPolicy(doc({ kill: [{ id: 'k', match: {}, mode }] }), TV);
    const stops = (mode: Rule['mode']) => [policyStops(at(mode), 'block-new-sources'), policyStops(at(mode), 'disable-playback'), policyStops(at(mode), 'disable-app')];
    expect(stops('notice')).toEqual([false, false, false]);
    expect(stops('block-new-sources')).toEqual([true, false, false]);
    expect(stops('disable-playback')).toEqual([true, true, false]);
    expect(stops('disable-app')).toEqual([true, true, true]);
    expect(policyStops(noPolicy(), 'block-new-sources')).toBe(false);
  });

  it('gives a fresh default each time', () => {
    const a = noPolicy();
    a.notices.push({ id: 'x', mode: 'notice', message: null });
    expect(noPolicy().notices).toEqual([]);
  });
});
